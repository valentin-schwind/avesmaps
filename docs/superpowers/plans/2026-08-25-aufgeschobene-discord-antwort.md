# Die aufgeschobene Discord-Antwort — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Der Discord-Bot quittiert jeden Befehl, der die Datenbank anfasst, sofort mit
„Avesmaps denkt nach …" und liefert das Ergebnis nach — damit eine Verzögerung von STRATO nicht
mehr als „hat nicht rechtzeitig reagiert" beim Nutzer landet.

**Architektur:** Zwei Aufrufe. `interactions.php` prüft die Signatur, fragt den (nebenwirkungsfreien)
Router, stößt bei Arbeitspfaden per HTTPS-Selbstaufruf `worker.php` an und antwortet Discord sofort
mit Typ 5. `worker.php` prüft ein HMAC, tut die Arbeit und ersetzt die Quittung per
`PATCH …/messages/@original` durch das Ergebnis.

**Technik:** PHP 8 (strict types), cURL, `hash_hmac`/`hash_equals`, kein Framework, kein Build.

**Entwurf:** `docs/superpowers/specs/2026-08-25-aufgeschobene-discord-antwort-design.md` — er ist
die Abnahmeliste. Jede Zeile mit 💣/⚠️/🔴 dort wird vor „fertig" einzeln abgehakt.

## Globale Vorgaben

- **Sprache:** Code-Kommentare, Tests und Commit-Nachrichten auf **Deutsch** (AGENTS.md §8).
  Bezeichner bleiben wie im Haus (`avesmapsDiscord…`).
- **Tests:** liegen seit dem 25.08.2026 in `api/_internal/discord/__tests__/` und heißen
  `<thema>-test.php`. Zusicherungen mit `t_ok`/`t_eq` aus `_assert.php`, Abschluss mit `t_done()`.
- **Testlauf vor JEDEM Push — das ganze Feld, nicht die eigenen Tests** (AGENTS.md §9):
  ```
  for t in $(find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) | sort); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_sodium.dll -d extension=php_curl.dll "$t" >/dev/null || echo "ROT: $t"; done
  for t in $(find js tools -path '*__tests__*' -name '*.test.js' | sort); do node "$t" >/dev/null || echo "ROT: $t"; done
  ```
  Stand 25.08.2026: **286 PHP grün, 267 JS grün, 0 rot.** Ein roter Test lädt **nichts** hoch.
- **Geteilter Arbeitsbaum:** niemals `git add -A` im Hauptcheckout, nur eigene Pfade. Bei
  abgelehntem Push den Wegwerf-Worktree benutzen, nicht `rebase --autostash`.
- **Discord-Konstanten** (aus der Doku, 25.08.2026 geprüft): Typ 5 =
  `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`, Frist für die initiale Antwort **3 s**,
  Interaction-Token **15 min** gültig, `flags: 64` = ephemer.
- 🔴 **Kein `fastcgi_finish_request`.** STRATO fährt `cgi-fcgi`; die Funktion existiert dort nicht
  und Puffer-Flushen wirkt nicht (gemessen: 3,07 s). Wer sie später „der Sauberkeit halber"
  einbaut, baut totes Holz — der Grund gehört als Kommentar an die Stelle.

---

## Abweichung vom Entwurf (§5), begründet

Der Entwurf beschreibt `deps['defer']` als Callback, der die Typ-5-Antwort **selbst hinausschickt**,
und leitet daraus die Falle ab: „wenn `defer` gerufen wurde, darf `interactions.php` nichts mehr
ausgeben."

**Dieser Plan macht es einfacher — und damit fällt die Falle ganz weg.** `deps['kick']` stößt nur
den Worker an; die Typ-5-Antwort bleibt der **normale Rückgabewert** von
`avesmapsDiscordProcessRequest`. `interactions.php` gibt weiterhin genau einen Rumpf aus und muss
über gar nichts Bescheid wissen. Ein Zustand, den man vergessen kann, ist ein Zustand, den man
vergisst — hier gibt es ihn nicht mehr.

Die übrigen Fallen des Entwurfs bleiben unverändert gültig.

---

## Dateiübersicht

| Datei | Zuständigkeit |
|---|---|
| `api/_internal/discord/worker-auth.php` | **neu** — HMAC über den weitergereichten Rumpf (bilden + prüfen). Rein, kein Netz. |
| `api/_internal/discord/responses.php` | +`avesmapsDiscordDeferredResponse()` — die Typ-5-Quittung. |
| `api/_internal/discord/router.php` | +`avesmapsDiscordActionIsDeferrable()` — die Weiche. Rein. |
| `api/_internal/discord/endpoint.php` | Arbeit wird zu `avesmapsDiscordRunAction()` herausgelöst; `…ProcessRequest` schiebt auf. |
| `api/_internal/discord/post-message.php` | +`avesmapsDiscordEditOriginalResponse()` (der `PATCH`) und +`avesmapsDiscordKickWorker()` (der Anstoß). |
| `api/discord/worker.php` | **neu** — Aufruf 2: HMAC, Config, Arbeit, Nachtrag. |
| `api/discord/interactions.php` | verdrahtet `kick`; sonst unverändert. |

---

## Task 1: Der Riegel für den Worker

**Dateien:**
- Anlegen: `api/_internal/discord/worker-auth.php`
- Test: `api/_internal/discord/__tests__/worker-auth-test.php`

**Schnittstellen:**
- Liefert an spätere Tasks: `avesmapsDiscordWorkerSignature(string $appToken, string $rumpf): string`
  und `avesmapsDiscordWorkerSignatureValid(string $appToken, string $rumpf, string $signatur): bool`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/worker-auth-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../worker-auth.php';

// Der Worker ist oeffentlich erreichbar und schreibt im Namen des Bots. Sein einziger Schutz ist
// dieses HMAC -- die Ed25519-Signatur von Discord laesst sich nicht weiterreichen, weil der Rumpf
// des zweiten Aufrufs ein anderer ist.
$rumpf = '{"type":2,"data":{"name":"erledigt"}}';
$sig = avesmapsDiscordWorkerSignature('geheim', $rumpf);

t_ok($sig !== '', 'Signatur wird gebildet');
t_ok(avesmapsDiscordWorkerSignatureValid('geheim', $rumpf, $sig), 'eigene Signatur gilt');

// 💣 Die drei Absagen, auf die es ankommt.
t_ok(!avesmapsDiscordWorkerSignatureValid('geheim', $rumpf . 'x', $sig), 'veraenderter Rumpf faellt durch');
t_ok(!avesmapsDiscordWorkerSignatureValid('anderes', $rumpf, $sig), 'fremdes Geheimnis faellt durch');
t_ok(!avesmapsDiscordWorkerSignatureValid('geheim', $rumpf, ''), 'leere Signatur faellt durch');

// 🔴 Ohne konfiguriertes Geheimnis wird NICHTS durchgelassen -- sonst macht eine unvollstaendige
// config.local.php den Worker fuer jeden auf, und zwar lautlos.
t_ok(!avesmapsDiscordWorkerSignatureValid('', $rumpf, avesmapsDiscordWorkerSignature('', $rumpf)), 'ohne Geheimnis: zu');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/worker-auth-test.php`
Erwartet: FATAL — `failed to open stream: worker-auth.php` (die Datei gibt es noch nicht).

- [ ] **Schritt 3: Die minimale Umsetzung schreiben**

`api/_internal/discord/worker-auth.php`:

```php
<?php

declare(strict_types=1);

// Der Riegel vor api/discord/worker.php. Dieser Endpunkt nimmt eine bereits geprüfte Interaction
// entgegen und schreibt im Namen des Bots -- Discords Ed25519-Signatur laesst sich dafuer nicht
// wiederverwenden, weil der zweite Aufruf einen anderen Rumpf traegt. Also ein HMAC mit dem
// app_token, das ohnehin nur auf dem Server liegt.
function avesmapsDiscordWorkerSignature(string $appToken, string $rumpf): string {
    return hash_hmac('sha256', $rumpf, $appToken);
}

function avesmapsDiscordWorkerSignatureValid(string $appToken, string $rumpf, string $signatur): bool {
    // 🔴 Ohne Geheimnis bleibt zu. Eine unvollstaendige config.local.php darf den Worker nicht
    // oeffnen -- und ohne diese Zeile taete sie es, weil hash_hmac auch mit leerem Schluessel
    // rechnet und beide Seiten dann denselben Wert bilden.
    if ($appToken === '' || $signatur === '') {
        return false;
    }

    return hash_equals(avesmapsDiscordWorkerSignature($appToken, $rumpf), $signatur);
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS bestehen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/worker-auth-test.php`
Erwartet: `RESULT: ALL PASS` (6 PASS-Zeilen).

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/discord/worker-auth.php api/_internal/discord/__tests__/worker-auth-test.php
git commit -m "feat(discord): der Riegel fuer den Worker -- HMAC statt weitergereichter Signatur"
```

---

## Task 2: Die Weiche und die Quittung

**Dateien:**
- Ändern: `api/_internal/discord/router.php` (anhängen)
- Ändern: `api/_internal/discord/responses.php` (anhängen)
- Test: `api/_internal/discord/__tests__/deferrable-test.php`

**Schnittstellen:**
- Verbraucht: die bestehenden Router-Ausgabetypen `respond` / `submit_case` / `close_case` /
  `list_open_cases`.
- Liefert: `avesmapsDiscordActionIsDeferrable(string $typ): bool` und
  `avesmapsDiscordDeferredResponse(): array`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/deferrable-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../responses.php';
require __DIR__ . '/../faq.php';
require __DIR__ . '/../router.php';

// Die drei Arbeitspfade werden aufgeschoben.
t_ok(avesmapsDiscordActionIsDeferrable('submit_case'), 'Formular absenden: aufschieben');
t_ok(avesmapsDiscordActionIsDeferrable('close_case'), '/erledigt: aufschieben');
t_ok(avesmapsDiscordActionIsDeferrable('list_open_cases'), '/offen: aufschieben');

// 💣 `respond` NIE. Dahinter stecken PING (Discord erwartet PONG) und die drei Modal-Oeffner --
// und ein Modal kann nach einem Defer nicht mehr kommen, weil das Aufschieben genau den Platz
// der initialen Antwort verbraucht. Wer /bug aufschiebt, hat das Formular fuer immer verloren.
t_ok(!avesmapsDiscordActionIsDeferrable('respond'), 'sofort-Antworten: nie aufschieben');
t_ok(!avesmapsDiscordActionIsDeferrable(''), 'unbekannt: nie aufschieben');

// Und dieselbe Regel am echten Router, nicht nur an der Liste: das ist die Verdrahtung.
$faq = [['id' => 'kostenlos', 'q' => 'Ist Avesmaps kostenlos?', 'a' => 'Ja.']];
$config = ['bug_channel_id' => '111', 'idea_channel_id' => '222', 'faq_channel_id' => '333'];

foreach (['bug', 'idee', 'frage'] as $befehl) {
    $r = avesmapsDiscordRouteInteraction(['type' => 2, 'data' => ['name' => $befehl]], $faq, $config);
    t_ok(!avesmapsDiscordActionIsDeferrable((string) $r['type']), "/{$befehl} oeffnet ein Modal und bleibt sofort");
}
$ping = avesmapsDiscordRouteInteraction(['type' => 1], $faq, $config);
t_ok(!avesmapsDiscordActionIsDeferrable((string) $ping['type']), 'PING bleibt sofort');

$erledigt = avesmapsDiscordRouteInteraction(
    ['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 7]]]],
    $faq,
    $config
);
t_ok(avesmapsDiscordActionIsDeferrable((string) $erledigt['type']), '/erledigt wird aufgeschoben');

// Die Quittung selbst.
$quittung = avesmapsDiscordDeferredResponse();
t_eq($quittung['type'], 5, 'Typ 5 = aufgeschoben');
// 💣 Die 64 MUSS hier stehen. Beim Typ 5 ist EPHEMERAL das einzige gueltige Flag, und die
// Entscheidung ist danach nicht mehr aenderbar -- fehlt sie, wird die Antwort oeffentlich und
// laesst sich nicht mehr einfangen.
t_eq($quittung['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'ephemer, wie alle Bot-Antworten');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/deferrable-test.php`
Erwartet: FATAL — `Call to undefined function avesmapsDiscordActionIsDeferrable()`.

- [ ] **Schritt 3: Die minimale Umsetzung schreiben**

Ans Ende von `api/_internal/discord/router.php`:

```php
// Welche Router-Ausgabe wird aufgeschoben? Die Grenze liegt nicht neu -- der Router trennt seit
// jeher "antworte aus dem Speicher" (`respond`) von "tu etwas" (alles andere). Genau diese Grenze
// ist die richtige: 💣 hinter `respond` stecken PING (Discord erwartet PONG) und die drei
// Modal-Oeffner, und ein Modal darf NICHT aufgeschoben werden -- das Aufschieben verbraucht den
// Platz der initialen Antwort, und Discord laesst danach kein Modal mehr zu.
const AVESMAPS_DISCORD_DEFERRABLE_ACTIONS = ['submit_case', 'close_case', 'list_open_cases'];

function avesmapsDiscordActionIsDeferrable(string $typ): bool {
    return in_array($typ, AVESMAPS_DISCORD_DEFERRABLE_ACTIONS, true);
}
```

Ans Ende von `api/_internal/discord/responses.php`:

```php
const AVESMAPS_DISCORD_DEFERRED_MESSAGE = 5;

// Die Quittung: "Avesmaps denkt nach ...". Sie ersetzt die Arbeit im ersten Aufruf; das Ergebnis
// kommt spaeter per PATCH auf dieselbe Nachricht.
function avesmapsDiscordDeferredResponse(): array {
    // 💣 Die Flags gehoeren HIERHIN. Beim Typ 5 ist EPHEMERAL das einzige gueltige Flag, und ob
    // eine Antwort ephemer ist, entscheidet sich mit dieser einen Nachricht -- der Nachtrag kann
    // es nicht mehr aendern. Alle Antworten dieses Bots sind ephemer.
    return ['type' => AVESMAPS_DISCORD_DEFERRED_MESSAGE, 'data' => ['flags' => AVESMAPS_DISCORD_EPHEMERAL_FLAG]];
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS bestehen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/deferrable-test.php`
Erwartet: `RESULT: ALL PASS`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/discord/router.php api/_internal/discord/responses.php api/_internal/discord/__tests__/deferrable-test.php
git commit -m "feat(discord): die Weiche fuers Aufschieben -- Modal-Oeffner bleiben ausdruecklich sofort"
```

---

## Task 3: Die Arbeit aus dem Prozessor herauslösen

Reiner Umbau, **kein Verhaltenswechsel**. Danach existiert die Arbeit als eigene Funktion, die
sowohl der alte synchrone Weg als auch später der Worker aufrufen kann.

**Dateien:**
- Ändern: `api/_internal/discord/endpoint.php`
- Test: `api/_internal/discord/__tests__/endpoint-test.php` (bestehend, muss unverändert grün bleiben)
- Test: `api/_internal/discord/__tests__/run-action-test.php` (neu)

**Schnittstellen:**
- Verbraucht: die Router-Ausgabe aus Task 2.
- Liefert: `avesmapsDiscordRunAction(array $ergebnis, array $deps): array` — nimmt eine
  Router-Ausgabe, tut die Arbeit, gibt die **fertige Discord-Antwort** zurück (kein `status`).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/run-action-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../responses.php';
require __DIR__ . '/../faq.php';
require __DIR__ . '/../router.php';
require __DIR__ . '/../endpoint.php';

// /erledigt, erfolgreich
$antwort = avesmapsDiscordRunAction(
    ['type' => 'close_case', 'case_id' => 7, 'closed_by' => 'Valentin'],
    ['close' => static fn(int $id, string $by): bool => $id === 7]
);
t_ok(str_contains($antwort['data']['content'], '#7'), 'Erfolgsmeldung nennt die Fallnummer');
t_eq($antwort['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'ephemer');

// /erledigt, Fall gibt es nicht
$fehlt = avesmapsDiscordRunAction(
    ['type' => 'close_case', 'case_id' => 99, 'closed_by' => 'Valentin'],
    ['close' => static fn(int $id, string $by): bool => false]
);
t_ok(str_contains($fehlt['data']['content'], 'nicht gefunden'), 'unbekannter Fall wird benannt');

// 💣 Ein Fehler der Ablage wird zu einer SICHTBAREN Meldung, nie zu einer Ausnahme: der Worker
// haengt daran, dass hier immer eine Antwort herauskommt -- sonst bliebe beim Nutzer fuer immer
// "denkt nach ..." stehen.
$kaputt = avesmapsDiscordRunAction(
    ['type' => 'close_case', 'case_id' => 7, 'closed_by' => 'V'],
    ['close' => static function (int $id, string $by): bool { throw new RuntimeException('DB weg'); }]
);
t_ok(str_contains($kaputt['data']['content'], 'nicht aktualisieren'), 'DB-Fehler wird zur Meldung');

// /offen
$offen = avesmapsDiscordRunAction(
    ['type' => 'list_open_cases'],
    ['open_cases' => static fn(): array => []]
);
t_ok(str_contains($offen['data']['content'], 'keine'), 'leere Liste sagt es');

// Ein unbekannter Typ darf nicht ins Leere laufen.
$unbekannt = avesmapsDiscordRunAction(['type' => 'gibtsnicht'], []);
t_ok(isset($unbekannt['data']['content']) && $unbekannt['data']['content'] !== '', 'unbekannt -> Meldung, nicht leer');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/run-action-test.php`
Erwartet: FATAL — `Call to undefined function avesmapsDiscordRunAction()`.

- [ ] **Schritt 3: Die Arbeit herauslösen**

In `api/_internal/discord/endpoint.php` die drei Arbeitsblöcke aus `avesmapsDiscordProcessRequest`
in eine neue Funktion verschieben (Text unverändert übernehmen) und dort aufrufen:

```php
// Die eigentliche Arbeit hinter einer Router-Ausgabe -- getrennt vom Empfang, weil sie ab jetzt
// aus ZWEI Richtungen gerufen wird: heute synchron aus dem Endpunkt, nach dem Aufschieben aus
// api/discord/worker.php. Sie gibt IMMER eine fertige Discord-Antwort zurueck und wirft nie:
// 💣 haette sie einen Pfad ohne Antwort, bliebe beim Nutzer "denkt nach ..." stehen -- schlimmer
// als die Fehlermeldung, die er heute bekommt.
function avesmapsDiscordRunAction(array $ergebnis, array $deps): array {
    $type = (string) ($ergebnis['type'] ?? '');

    if ($type === 'submit_case') {
        try {
            $caseId = (int) $deps['insert']([
                'kind' => (string) $ergebnis['kind'],
                'title' => (string) ($ergebnis['values']['title'] ?? ''),
                'body' => (string) ($ergebnis['values']['description'] ?? ''),
                'location' => (string) ($ergebnis['values']['location'] ?? ''),
                'reporter' => (string) $ergebnis['reporter'],
                'reporter_id' => (string) $ergebnis['reporter_id'],
                'channel_id' => (string) $ergebnis['channel_id'],
            ]);
        } catch (Throwable) {
            return avesmapsDiscordErrorResponse('Konnte gerade nicht gespeichert werden – bitte später erneut versuchen.');
        }

        // Der Kanal-Post bleibt best effort; der Fall steht ohnehin schon in der Ablage.
        try {
            $deps['post'](
                (string) $ergebnis['channel_id'],
                avesmapsDiscordCaseEmbedMessage((string) $ergebnis['kind'], $caseId, (array) $ergebnis['values'], (string) $ergebnis['reporter'])
            );
        } catch (Throwable) {
            // best effort: der Fall ist gespeichert, ein misslungener Post aendert daran nichts
        }

        return avesmapsDiscordCaseConfirmResponse((string) $ergebnis['kind'], $caseId);
    }

    if ($type === 'close_case') {
        $caseId = (int) ($ergebnis['case_id'] ?? 0);
        try {
            $found = $caseId > 0 && (bool) $deps['close']($caseId, (string) ($ergebnis['closed_by'] ?? ''));
        } catch (Throwable) {
            return avesmapsDiscordErrorResponse('Konnte den Fall gerade nicht aktualisieren.');
        }

        return avesmapsDiscordCloseConfirmResponse($caseId, $found);
    }

    if ($type === 'list_open_cases') {
        try {
            $cases = (array) $deps['open_cases']();
        } catch (Throwable) {
            return avesmapsDiscordErrorResponse('Konnte die offenen Fälle gerade nicht laden.');
        }

        return avesmapsDiscordOpenCasesResponse($cases);
    }

    return $ergebnis['response'] ?? avesmapsDiscordErrorResponse('Nicht unterstützt.');
}
```

Und `avesmapsDiscordProcessRequest` endet ab jetzt mit:

```php
    return ['status' => 200, 'body' => avesmapsDiscordRunAction($result, $deps)];
```

- [ ] **Schritt 4: Beide Tests laufen lassen**

Lauf:
```
php -d extension=php_mbstring.dll api/_internal/discord/__tests__/run-action-test.php
php -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/discord/__tests__/endpoint-test.php
```
Erwartet: beide `RESULT: ALL PASS`. ⚠️ Der bestehende `endpoint-test.php` ist hier der eigentliche
Zeuge: er muss **ohne jede Änderung** grün bleiben, sonst war der Umbau kein Umbau.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/discord/endpoint.php api/_internal/discord/__tests__/run-action-test.php
git commit -m "refactor(discord): die Arbeit als eigene Funktion -- gleiches Verhalten, zwei Aufrufer"
```

---

## Task 4: Der Prozessor schiebt auf

**Dateien:**
- Ändern: `api/_internal/discord/endpoint.php`
- Test: `api/_internal/discord/__tests__/defer-flow-test.php` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsDiscordActionIsDeferrable()` (Task 2), `avesmapsDiscordDeferredResponse()`
  (Task 2), `avesmapsDiscordRunAction()` (Task 3).
- Liefert: `avesmapsDiscordProcessRequest` akzeptiert jetzt `deps['kick']` —
  `fn(array $interaction): void`. Fehlt der Eintrag, arbeitet der Prozessor wie bisher synchron.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/defer-flow-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../responses.php';
require __DIR__ . '/../faq.php';
require __DIR__ . '/../router.php';
require __DIR__ . '/../endpoint.php';
require __DIR__ . '/../signature.php';

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDOUT, "SKIP: sodium not loaded\n");
    exit(0);
}

// Eine echt signierte Interaction bauen, damit der Prozessor sie annimmt.
$paar = sodium_crypto_sign_keypair();
$oeffentlich = bin2hex(sodium_crypto_sign_publickey($paar));
$geheim = sodium_crypto_sign_secretkey($paar);
$config = ['public_key' => $oeffentlich, 'bug_channel_id' => '111', 'idea_channel_id' => '222', 'faq_channel_id' => '333'];
$faq = [['id' => 'kostenlos', 'q' => 'Ist Avesmaps kostenlos?', 'a' => 'Ja.']];

$sende = static function (array $interaction, array $deps) use ($geheim, $config, $faq): array {
    $rumpf = json_encode($interaction, JSON_UNESCAPED_UNICODE);
    $ts = '1700000000';
    $sig = bin2hex(sodium_crypto_sign_detached($ts . $rumpf, $geheim));

    return avesmapsDiscordProcessRequest($rumpf, $sig, $ts, $config, $faq, $deps);
};

// --- /erledigt wird aufgeschoben -----------------------------------------------------------
$angestossen = [];
$gearbeitet = false;
$antwort = $sende(
    ['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 7]]]],
    [
        'kick' => static function (array $i) use (&$angestossen): void { $angestossen[] = $i; },
        'close' => static function (int $id, string $by) use (&$gearbeitet): bool { $gearbeitet = true; return true; },
    ]
);
t_eq($antwort['body']['type'], 5, '/erledigt antwortet mit der Quittung');
t_eq($antwort['body']['data']['flags'], AVESMAPS_DISCORD_EPHEMERAL_FLAG, 'Quittung ist ephemer');
t_eq(count($angestossen), 1, 'der Worker wurde genau einmal angestossen');
// 💣 Der Kern: im ERSTEN Aufruf wird nicht gearbeitet. Genau das ist der Sinn -- die Datenbank
// darf die Frist von drei Sekunden nicht mehr beruehren.
t_ok($gearbeitet === false, 'im ersten Aufruf wird NICHT gearbeitet');

// --- /hilfe wird NICHT aufgeschoben --------------------------------------------------------
$angestossen = [];
$hilfe = $sende(['type' => 2, 'data' => ['name' => 'hilfe']], ['kick' => static function (array $i) use (&$angestossen): void { $angestossen[] = $i; }]);
t_eq($hilfe['body']['type'], AVESMAPS_DISCORD_CHANNEL_MESSAGE, '/hilfe antwortet sofort');
t_eq(count($angestossen), 0, '/hilfe stoesst keinen Worker an');

// --- 💣 /bug oeffnet ein Modal und darf NIEMALS aufgeschoben werden -------------------------
$angestossen = [];
$bug = $sende(['type' => 2, 'data' => ['name' => 'bug']], ['kick' => static function (array $i) use (&$angestossen): void { $angestossen[] = $i; }]);
t_eq($bug['body']['type'], AVESMAPS_DISCORD_MODAL, '/bug liefert das Modal');
t_eq(count($angestossen), 0, '/bug stoesst keinen Worker an');

// --- PING bleibt PONG ------------------------------------------------------------------------
$ping = $sende(['type' => 1], ['kick' => static function (array $i): void { throw new RuntimeException('PING darf nie anstossen'); }]);
t_eq($ping['body']['type'], AVESMAPS_DISCORD_PONG, 'PING -> PONG, ohne Umweg');

// --- Ohne 'kick' bleibt alles beim Alten (der Worker ist noch nicht verdrahtet) --------------
$synchron = $sende(
    ['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 7]]]],
    ['close' => static fn(int $id, string $by): bool => true]
);
t_ok(str_contains($synchron['body']['data']['content'], '#7'), 'ohne kick: arbeitet wie bisher');

// --- 💣 Ein misslungener Anstoss darf den Nutzer nicht ohne Antwort lassen -------------------
$notfall = $sende(
    ['type' => 2, 'data' => ['name' => 'erledigt', 'options' => [['name' => 'nummer', 'value' => 7]]]],
    [
        'kick' => static function (array $i): void { throw new RuntimeException('Netz weg'); },
        'close' => static fn(int $id, string $by): bool => true,
    ]
);
t_ok(str_contains((string) ($notfall['body']['data']['content'] ?? ''), '#7'), 'Anstoss kaputt -> synchron erledigt statt gar nicht');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=sodium -d extension=php_mbstring.dll api/_internal/discord/__tests__/defer-flow-test.php`
Erwartet: FAIL bei „/erledigt antwortet mit der Quittung" (erwartet 5, tatsächlich 4).

- [ ] **Schritt 3: Das Aufschieben einbauen**

In `avesmapsDiscordProcessRequest`, direkt nach `$result = avesmapsDiscordRouteInteraction(...)`:

```php
    $type = (string) ($result['type'] ?? '');

    // Aufschieben, sobald die Aktion Arbeit bedeutet -- und nur dann. Die Quittung geht raus,
    // ohne dass die Datenbank angefasst wurde; das Ergebnis traegt der Worker nach.
    if (isset($deps['kick']) && avesmapsDiscordActionIsDeferrable($type)) {
        try {
            $deps['kick']($interaction);

            return ['status' => 200, 'body' => avesmapsDiscordDeferredResponse()];
        } catch (Throwable) {
            // 💣 Der Anstoss ist misslungen -- dann NICHT quittieren. Eine Quittung ohne Worker
            // laesst beim Nutzer fuer immer "denkt nach ..." stehen; synchron zu arbeiten ist der
            // schlechtere, aber ehrliche Weg und genau das Verhalten von vor diesem Umbau.
        }
    }
```

⚠️ Das `catch` ist kein Beiwerk: ohne es ist ein misslungener Anstoß der **einzige** Weg, bei dem
der Nutzer nie eine Antwort sieht.

- [ ] **Schritt 4: Test laufen lassen, er MUSS bestehen**

Lauf: `php -d extension=sodium -d extension=php_mbstring.dll api/_internal/discord/__tests__/defer-flow-test.php`
Erwartet: `RESULT: ALL PASS`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/discord/endpoint.php api/_internal/discord/__tests__/defer-flow-test.php
git commit -m "feat(discord): der Empfang schiebt Arbeit auf, statt sie in die 3-Sekunden-Frist zu legen"
```

---

## Task 5: Anstoß und Nachtrag

**Dateien:**
- Ändern: `api/_internal/discord/post-message.php` (anhängen)
- Test: `api/_internal/discord/__tests__/followup-test.php` (neu)

**Schnittstellen:**
- Liefert: `avesmapsDiscordEditOriginalResponse(string $appId, string $token, array $antwort): array`
  (Rückgabe wie `avesmapsDiscordPostMessage`: `ok`, `status`, `error`) und
  `avesmapsDiscordKickWorker(string $url, string $rumpf, string $signatur): void`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/followup-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';
require __DIR__ . '/../post-message.php';

// Wie beim Kanal-Post wird hier nur geprueft, was OHNE Netz pruefbar ist: die Absagen davor.
$ohneId = avesmapsDiscordEditOriginalResponse('', 'token', ['content' => 'x']);
t_ok($ohneId['ok'] === false, 'ohne application_id: nicht ok');

$ohneToken = avesmapsDiscordEditOriginalResponse('123', '', ['content' => 'x']);
t_ok($ohneToken['ok'] === false, 'ohne Interaction-Token: nicht ok');

// 🔴 Der Nachtrag darf den Bot-Token nicht brauchen und nicht benutzen: der Interaction-Token
// authentifiziert diesen Webhook-Pfad allein. Die Signatur nimmt deshalb gar keinen Bot-Token an.
$r = new ReflectionFunction('avesmapsDiscordEditOriginalResponse');
$namen = array_map(static fn(ReflectionParameter $p): string => $p->getName(), $r->getParameters());
t_ok(!in_array('botToken', $namen, true), 'der Nachtrag kennt keinen Bot-Token');
t_eq($namen, ['appId', 'token', 'antwort'], 'Signatur wie vereinbart');

// Der Anstoss meldet nichts zurueck -- er ist absichtlich blind.
$r2 = new ReflectionFunction('avesmapsDiscordKickWorker');
t_eq((string) $r2->getReturnType(), 'void', 'der Anstoss liefert nichts');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=php_curl.dll -d extension=php_mbstring.dll api/_internal/discord/__tests__/followup-test.php`
Erwartet: FATAL — `Call to undefined function avesmapsDiscordEditOriginalResponse()`.

- [ ] **Schritt 3: Beide Funktionen schreiben**

Ans Ende von `api/_internal/discord/post-message.php`:

```php
// Der Nachtrag: ersetzt die Quittung ("denkt nach ...") durch das Ergebnis.
// 🔴 Ohne Bot-Token, und das ist keine Sparsamkeit, sondern der Vertrag: dieser Webhook-Pfad wird
// vom Interaction-Token authentifiziert. Beide Werte stehen im Interaction-Rumpf.
// ⚠️ Der Token ist 15 Minuten gueltig -- reichlich fuer eine Arbeit von Millisekunden.
function avesmapsDiscordEditOriginalResponse(string $appId, string $token, array $antwort): array {
    if ($appId === '' || $token === '') {
        return ['ok' => false, 'status' => 0, 'error' => 'missing application id or token'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'error' => 'curl unavailable'];
    }

    $url = AVESMAPS_DISCORD_API_BASE . '/webhooks/' . rawurlencode($appId) . '/' . rawurlencode($token) . '/messages/@original';
    $payload = json_encode($antwort['data'] ?? $antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'payload encode failed'];
    }

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => 'PATCH',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'User-Agent: AvesmapsBot (https://avesmaps.de, 1.0)',
        ],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    $ok = $status >= 200 && $status < 300;

    return ['ok' => $ok, 'status' => $status, 'error' => $ok ? '' : ($curlError !== '' ? $curlError : (string) $body)];
}

// Der Anstoss: schickt die Interaction an den Worker und bricht absichtlich ab, sobald sie drueben
// ist. Gemessen am 25.08.2026: der Gerufene arbeitet nach dem Abbruch zu Ende (2 s gelaufen, Spur
// geschrieben), der Anstoss kostet nur sein eigenes Zeitlimit.
// 💣 Ein Zeitlimit-Abbruch (curl-Fehler 28) ist hier der ERFOLG, nicht der Fehler. Wer auf `ok`
// prueft, haelt jeden gelungenen Anstoss fuer gescheitert.
// ⚠️ 300 ms sind gemessen; ob 150 ms noch zuverlaessig einen Worker starten, ist es NICHT.
const AVESMAPS_DISCORD_KICK_TIMEOUT_MS = 300;

function avesmapsDiscordKickWorker(string $url, string $rumpf, string $signatur): void {
    if (!function_exists('curl_init')) {
        return;
    }

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => AVESMAPS_DISCORD_KICK_TIMEOUT_MS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Avesmaps-Worker-Signature: ' . $signatur,
        ],
        CURLOPT_POSTFIELDS => $rumpf,
    ]);
    curl_exec($handle);
    curl_close($handle);
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS bestehen**

Lauf: `php -d extension=php_curl.dll -d extension=php_mbstring.dll api/_internal/discord/__tests__/followup-test.php`
Erwartet: `RESULT: ALL PASS`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/discord/post-message.php api/_internal/discord/__tests__/followup-test.php
git commit -m "feat(discord): Anstoss und Nachtrag -- der PATCH kommt ohne Bot-Token aus"
```

---

## Task 6: Der Worker und die Verdrahtung

**Dateien:**
- Anlegen: `api/discord/worker.php`
- Ändern: `api/discord/interactions.php`
- Test: `api/_internal/discord/__tests__/worker-endpunkt-test.php` (neu)

**Schnittstellen:**
- Verbraucht: alles aus Task 1–5.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/discord/__tests__/worker-endpunkt-test.php`:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/_assert.php';

// Der Endpunkt selbst laesst sich nicht requiren -- er beantwortet beim Laden eine Anfrage, die es
// hier nicht gibt. Geprueft wird deshalb die VERDRAHTUNG am Quelltext. Das ist die Sorte Test, die
// im Haus schon `changelog-token-gate-test.php` faehrt.
$worker = (string) file_get_contents(__DIR__ . '/../../../discord/worker.php');
$empfang = (string) file_get_contents(__DIR__ . '/../../../discord/interactions.php');

// Kommentare heraustrennen, sonst prueft die Suche den Kommentar statt des Codes.
$nurCode = static function (string $q): string {
    $out = '';
    foreach (token_get_all($q) as $t) {
        if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $out .= is_array($t) ? $t[1] : $t;
    }
    return $out;
};
$workerCode = $nurCode($worker);
$empfangCode = $nurCode($empfang);

// 🔴 Der Riegel muss da sein, und zwar VOR jeder Arbeit.
t_ok(str_contains($workerCode, 'avesmapsDiscordWorkerSignatureValid'), 'Worker prueft das HMAC');
$posRiegel = strpos($workerCode, 'avesmapsDiscordWorkerSignatureValid');
$posArbeit = strpos($workerCode, 'avesmapsDiscordRunAction');
t_ok($posRiegel !== false && $posArbeit !== false && $posRiegel < $posArbeit, 'Riegel steht VOR der Arbeit');

// 💣 Der Worker MUSS die Config laden. Gemessen am 25.08.2026: ohne sie schreibt er zwei Stunden
// in die Vergangenheit (23:12 statt 01:12) -- und `discord_cases.solved_at` uebernimmt das lautlos.
t_ok(str_contains($workerCode, 'avesmapsLoadApiConfig'), 'Worker laedt die Config (Zeitzone!)');

// Und er muss nachtragen, sonst bleibt "denkt nach ..." stehen.
t_ok(str_contains($workerCode, 'avesmapsDiscordEditOriginalResponse'), 'Worker traegt das Ergebnis nach');

// Der Empfang verdrahtet den Anstoss.
t_ok(str_contains($empfangCode, "'kick'"), 'interactions.php reicht kick herein');
t_ok(str_contains($empfangCode, 'avesmapsDiscordKickWorker'), 'interactions.php stoesst den Worker an');

// 🔴 Gegenprobe, damit die Suche nicht nur Text findet: der Bot-Token darf im Nachtragsweg des
// Workers nicht auftauchen.
t_ok(!str_contains($workerCode, "'Authorization: Bot"), 'kein Bot-Token im Worker-Nachtrag');

t_done();
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/worker-endpunkt-test.php`
Erwartet: FATAL — `file_get_contents(...worker.php): Failed to open stream`.

- [ ] **Schritt 3: Den Worker schreiben**

`api/discord/worker.php`:

```php
<?php

declare(strict_types=1);

// AUFRUF 2 der aufgeschobenen Antwort. Aufruf 1 (interactions.php) hat Discord bereits quittiert
// und diesen hier angestossen; er tut die Arbeit und ersetzt die Quittung durch das Ergebnis.
//
// 🔴 Warum ueberhaupt zwei Aufrufe: STRATO faehrt cgi-fcgi. `fastcgi_finish_request` gibt es dort
// nicht, und Puffer-Flushen wirkt nicht -- gemessen am 25.08.2026 kam eine Antwort, die vor drei
// Sekunden Arbeit abgeschickt wurde, trotzdem erst nach 3,07 s an. Antworten und danach
// weiterarbeiten ist auf diesem Server also unmoeglich. Wer das "vereinfacht", baut totes Holz.
//
// ⚠️ Der Aufrufer bricht die Verbindung absichtlich nach 300 ms ab. `ignore_user_abort(true)` ist
// deshalb tragend -- ohne die Zeile beendet PHP diesen Prozess, und die Arbeit geschieht nie.
ignore_user_abort(true);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/signature.php';
require __DIR__ . '/../_internal/discord/worker-auth.php';
require __DIR__ . '/../_internal/discord/faq.php';
require __DIR__ . '/../_internal/discord/store.php';
require __DIR__ . '/../_internal/discord/responses.php';
require __DIR__ . '/../_internal/discord/router.php';
require __DIR__ . '/../_internal/discord/post-message.php';
require __DIR__ . '/../_internal/discord/endpoint.php';

header('Content-Type: application/json');

// 💣 Die Config wird hier nicht nur wegen der Zugangsdaten geladen, sondern wegen der ZEITZONE:
// ohne sie datiert dieser Prozess zwei Stunden in die Vergangenheit (gemessen 25.08.2026: 23:12
// statt 01:12), und `discord_cases.created_at`/`solved_at` uebernehmen das, ohne dass es auffaellt.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false]);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$rawBody = file_get_contents('php://input');
if ($rawBody === false) {
    $rawBody = '';
}

// 🔴 Der Riegel, und zwar vor allem anderen: dieser Endpunkt ist oeffentlich erreichbar und
// schreibt im Namen des Bots. Discords Ed25519-Signatur laesst sich nicht weiterreichen, weil der
// Rumpf dieses Aufrufs ein anderer ist -- deshalb das HMAC mit dem app_token.
$signatur = (string) ($_SERVER['HTTP_X_AVESMAPS_WORKER_SIGNATURE'] ?? '');
if (!avesmapsDiscordWorkerSignatureValid((string) ($discord['app_token'] ?? ''), $rawBody, $signatur)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

try {
    $interaction = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid json']);
    exit;
}
if (!is_array($interaction)) {
    $interaction = [];
}

$faq = avesmapsDiscordLoadFaq(__DIR__ . '/faq.de.json');
$botToken = (string) ($discord['bot_token'] ?? '');

$pdo = null;
$pdoProvider = static function () use (&$pdo, $config): PDO {
    if ($pdo === null) {
        $pdo = avesmapsCreatePdo(is_array($config['database'] ?? null) ? $config['database'] : []);
        avesmapsDiscordEnsureCasesTable($pdo);
    }

    return $pdo;
};

$deps = [
    'post' => static fn(string $channelId, array $message): array => avesmapsDiscordPostMessage($botToken, $channelId, $message),
    'insert' => static function (array $case) use ($pdoProvider): int {
        $case['created_at'] = date('Y-m-d H:i:s');
        return avesmapsDiscordInsertCase($pdoProvider(), $case);
    },
    'close' => static function (int $id, string $by) use ($pdoProvider): bool {
        return avesmapsDiscordCloseCase($pdoProvider(), $id, $by, date('Y-m-d H:i:s'));
    },
    'open_cases' => static function () use ($pdoProvider): array {
        return avesmapsDiscordOpenCases($pdoProvider());
    },
];

// Der Router ist rein und billig -- ihn ein zweites Mal zu fragen ist einfacher und ehrlicher, als
// die Entscheidung von Aufruf 1 durch die Leitung zu tragen.
$ergebnis = avesmapsDiscordRouteInteraction($interaction, $faq, $discord);
$antwort = avesmapsDiscordRunAction($ergebnis, $deps);

// 💣 Hier MUSS immer etwas hinausgehen. Bleibt der Nachtrag aus, sieht der Nutzer fuer immer
// "Avesmaps denkt nach ..." -- schlimmer als die Fehlermeldung, die er vor diesem Umbau bekam.
// `avesmapsDiscordRunAction` wirft deshalb nie; jeder Fehler ist dort schon eine Meldung.
$appId = (string) ($interaction['application_id'] ?? ($discord['application_id'] ?? ''));
$ergebnisNachtrag = avesmapsDiscordEditOriginalResponse($appId, (string) ($interaction['token'] ?? ''), $antwort);

echo json_encode(['ok' => (bool) $ergebnisNachtrag['ok']]);
```

- [ ] **Schritt 4: `interactions.php` verdrahten**

In `api/discord/interactions.php` im `$deps`-Feld ergänzen:

```php
    // Der Anstoss fuer Aufruf 2. Die Adresse wird aus dem laufenden Request gebildet, damit sie
    // nicht ein zweites Mal konfiguriert werden muss und auf jeder Umgebung stimmt.
    'kick' => static function (array $interaction) use ($rawBody, $discord): void {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'avesmaps.de');
        $url = 'https://' . $host . dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/discord/interactions.php')) . '/worker.php';
        avesmapsDiscordKickWorker($url, $rawBody, avesmapsDiscordWorkerSignature((string) ($discord['app_token'] ?? ''), $rawBody));
    },
```

und oben den neuen `require` ergänzen:

```php
require __DIR__ . '/../_internal/discord/worker-auth.php';
```

⚠️ Der Anstoß schickt **denselben Rumpf**, den Discord geschickt hat (`$rawBody`) — nur so passt
das HMAC, und nur so sieht der Worker exakt dieselbe Interaction.

- [ ] **Schritt 5: Test laufen lassen, er MUSS bestehen**

Lauf: `php -d extension=php_mbstring.dll api/_internal/discord/__tests__/worker-endpunkt-test.php`
Erwartet: `RESULT: ALL PASS`.

- [ ] **Schritt 6: Das GANZE Testfeld fahren, dann committen**

Beide Schleifen aus „Globale Vorgaben". Erwartet: 0 rot.

```bash
git add api/discord/worker.php api/discord/interactions.php api/_internal/discord/__tests__/worker-endpunkt-test.php
git commit -m "feat(discord): der Worker traegt das Ergebnis nach -- Befehle verlassen die 3-Sekunden-Frist"
```

---

## Task 7: Abnahme am lebenden Bot

🔴 Kein Schritt dieses Plans ist je gegen die echte Datenbank oder gegen Discord gelaufen. Abnahme
heißt **Ablauf**, nicht Maß (AGENTS.md §9) — die folgenden Handgriffe werden wirklich ausgeführt
und einzeln benannt.

- [ ] **Schritt 1: Deploy abwarten und den Empfang prüfen**

```bash
gh run list --limit 3 --json status,conclusion,headSha
curl.exe -s -o /dev/null -X POST "https://avesmaps.de/api/discord/interactions.php" -H "X-Signature-Ed25519: 00" -H "X-Signature-Timestamp: 1" -d '{}' --max-time 25 -w "%{http_code} in %{time_total}s\n"
```
Erwartet: `401` in unter 1 s (der Endpunkt lebt).

- [ ] **Schritt 2: Der Riegel des Workers hält**

```bash
curl.exe -s -X POST "https://avesmaps.de/api/discord/worker.php" -H "Content-Type: application/json" -d '{"type":2}' --max-time 25
```
Erwartet: `{"ok":false,"error":"unauthorized"}` — ohne gültiges HMAC passiert nichts.

- [ ] **Schritt 3: Die vier Handgriffe in Discord, von Hand**

| Handgriff | Erwartet |
|---|---|
| `/hilfe` | Menü erscheint **sofort**, ohne „denkt nach" |
| `/bug` | **Formular öffnet sich** — der Beweis, dass Modale nicht aufgeschoben wurden |
| Formular absenden | kurz „denkt nach …", dann die Bestätigung mit Fallnummer; Eintrag im Bugs-Kanal |
| `/offen` | kurz „denkt nach …", dann die Liste |
| `/erledigt nummer:<die neue Nummer>` | kurz „denkt nach …", dann „als erledigt markiert ✅" |

- [ ] **Schritt 4: Die Zeitstempel prüfen — die Falle, die man nicht sieht**

```bash
TOKEN=$(cat "/c/Users/mail/.claude/avesmaps-triage-token.txt" | tr -d '\r\n')
curl.exe -s "https://avesmaps.de/api/discord/cases-export.php" -H "X-Avesmaps-Token: $TOKEN" --max-time 30 | tail -c 400
```
💣 Erwartet: `created_at` des soeben angelegten Falls stimmt mit der **lokalen Uhrzeit** überein.
Liegt er zwei Stunden zurück, lädt der Worker die Config nicht — genau der gemessene Fehler aus §6.

- [ ] **Schritt 5: Den Entwurf als Abnahmeliste abhaken**

Jede Zeile mit 💣/⚠️/🔴 im Entwurf einzeln: erfüllt, oder ausdrücklich verworfen mit Begründung.

- [ ] **Schritt 6: Das Ergebnis melden**

Dem Owner die vier Handgriffe aus Schritt 3 **benannt** melden (nicht „getestet"), plus die
Zeitstempel-Probe. Offene Fragen, die kein Test beantworten kann, als offen melden.
