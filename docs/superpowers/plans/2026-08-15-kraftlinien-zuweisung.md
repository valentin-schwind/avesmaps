# Kraftlinien-Wiki-Zuweisung — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE UNTER-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Eine Kraftlinie lässt sich von Hand einem Wiki-Artikel zuweisen — der Abgleich holt danach
ihre Daten, ohne dass die Linie ihren Namen ändert.

**Architektur:** Der Kraftlinien-Abgleich bekommt eine Rangfolge (Zuweisung schlägt Namen schlägt
nichts) als **reine Funktion**, die getrennt testbar ist. Gespeichert wird in zwei bereits
vorhandenen Feldern (`properties.wiki_url`, `properties.wiki_no_article`) — kein neues Feld, kein
neuer Endpunkt. Die Oberfläche ist eine erweiterte Zeile im vorhandenen Kraftlinien-Editor.

**Werkzeuge:** PHP 8 (strict types), kein Build-Schritt, `assert()`-Tests ohne Framework, Vanilla-JS
im Editor-iframe.

**Entwurf:** `docs/superpowers/specs/2026-08-15-kraftlinien-zuweisung-design.md` — **vor Aufgabe 1
lesen.** Jede Zeile darin mit 💣 / ⚠️ / 🔴 ist Teil der Abnahme (AGENTS.md §9).

## Globale Vorgaben

- **Sprache:** Kommentare, Commit-Nachrichten und Doku auf **Deutsch** (AGENTS.md §8). Sichtbare
  Beschriftungen sind Deutsch. `error.code`-Werte bleiben Englisch.
- **Zeilenenden: gemischt, also je Datei prüfen und nicht annehmen.** Die Dateien unter
  `api/_internal/conflicts/` und `api/_internal/wiki/` sind LF, **`api/_internal/map/features.php`
  und `api/edit/map/powerlines.php` sind durchgehend CRLF** (am 15.08.2026 nachgemessen). Wer dort
  mit LF hineinschreibt, erzeugt gemischte Zeilenenden und einen Diff, der die halbe Datei anfasst.
- **Nur eigene Pfade stagen.** Der Arbeitsbaum wird von mehreren Sitzungen geteilt — **niemals**
  `git add -A`, `git add .` oder `git commit -a` (AGENTS.md §9). Vor jedem Commit `git status`, und
  nur die in der Aufgabe genannten Dateien per Pfad hinzufügen.
- **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests:
  ```bash
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  ```
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  ```
  ⚠️ Vorbestehend rot ist genau **einer**: `api/_internal/linkcheck/__tests__/link-url-test.php`
  (echter DNS-Abruf). Alles andere ist eine Regression.
- **Keine Farbe, kein Radius, kein Trenner hartkodiert** — nur Token aus `css/base/tokens.css`
  (AGENTS.md §12).
- **Kein `?v=` von Hand** (AGENTS.md §7). Der Kraftlinien-Editor ist **nicht** der Inline-Host des
  Territorien-Editors: hier gilt **kein** `ASSET_VERSION`-Bump.
- **STRATO:** keine Endpunkte in Schleifen abfragen. Eine Probe genügt.

---

## Dateiübersicht

| Datei | Rolle | Aufgabe |
|---|---|---|
| `api/_internal/wiki/powerlines.php` | reine Rangfolge-Funktion + Verdrahtung im Abgleich | 1, 2 |
| `api/_internal/wiki/__tests__/powerline-claim-test.php` | **neu** — Tests der Rangfolge | 1 |
| `api/_internal/conflicts/rules.php` | „kein Artikel" verstummt in `wiki.missing_key` | 3 |
| `api/_internal/conflicts/__tests__/conflict-rules-test.php` | Test dazu | 3 |
| `api/_internal/map/features.php` | Schreibweg nimmt `wiki_no_article`, Widerspruch abgelehnt | 4 |
| `api/edit/map/powerlines.php` | Leseweg liefert Artikelliste + Dump-Zustand | 5 |
| `html/wiki-sync-powerline-editor.html` | die drei Zustände, Waisenliste, Zähler | 6 |

---

## Aufgabe 1: Die Rangfolge als reine Funktion

**Dateien:**
- Ändern: `api/_internal/wiki/powerlines.php` (nur Ergänzung, nichts Bestehendes anfassen)
- Test (neu): `api/_internal/wiki/__tests__/powerline-claim-test.php`

**Schnittstellen:**
- Verwendet: `avesmapsConflictArticleKey(string): string` aus `api/_internal/conflicts/core.php`
  (normiert eine Wiki-Adresse auf den kleingeschriebenen Seitentitel) und
  `avesmapsWikiSyncCreateMatchKey(string): string` aus `api/_internal/wiki/sync.php`.
- Liefert an Aufgabe 2:
  `avesmapsWikiPowerlineResolveSegment(string $name, array $properties, array $stagedByMatchKey, array $stagedByArticleKey): array`
  mit den Schlüsseln `entry` (`?array` — der `['name'=>..,'nest'=>..]`-Eintrag oder `null`),
  `source` (`'claim'|'name'|'none'`), `claim_unresolved` (`bool`), `clear_no_article` (`bool`).

- [ ] **Schritt 1: Prüfen, dass die beiden benutzten Funktionen wirklich so heißen**

```bash
grep -n "function avesmapsConflictArticleKey" api/_internal/conflicts/core.php
grep -n "function avesmapsWikiSyncCreateMatchKey" api/_internal/wiki/sync.php
grep -n "^require" api/_internal/wiki/powerlines.php
grep -n "^require" api/_internal/wiki/__tests__/powerline-parsing-test.php
```

Erwartet: beide Funktionen existieren; `powerlines.php` lädt selbst nur `paths.php` und
`../app/app-setting.php`; `conflicts/core.php` fehlt noch und kommt in Schritt 4 dazu.

💣 **`powerlines.php` bringt seine Kette NICHT mit, und das ist Absicht.** Sein Docblock sagt
wörtlich: „Like paths.php, this expects the including endpoint to have loaded first: sync.php,
sync-monitor.php, sync-monitor-parsing.php, territories-parsing.php and political/territory.php."
Ein Test, der nur `powerlines.php` lädt, stirbt deshalb an `avesmapsWikiSyncCreateMatchKey()` —
und zwar **bevor** er die neue Funktion überhaupt erreicht, also mit der falschen Fehlermeldung.
Der vierte `grep` zeigt die Kette, die der Nachbartest dafür lädt: **abschreiben, nicht raten.**
🔴 Diese Kette gehört in den TEST, nicht in `powerlines.php` — sie dort zu ergänzen bräche eine
dokumentierte Zusage und änderte die Ladereihenfolge für alle echten Aufrufer.

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Neu anlegen: `api/_internal/wiki/__tests__/powerline-claim-test.php`

```php
<?php

declare(strict_types=1);

/**
 * Die Rangfolge der Kraftlinien-Zuweisung, rein und ohne Datenbank.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/powerline-claim-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-08-15-kraftlinien-zuweisung-design.md §4.
 * Gemessen am Livebestand 15.08.2026: der Namensabgleich ist erschoepft (0 Linien warten auf
 * einen Namenstreffer), die Zuweisung ist also der einzige Weg, der noch eine Linie verknuepft.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// Dieselbe Ladekette wie im Nachbartest powerline-parsing-test.php: powerlines.php erwartet laut
// eigenem Docblock, dass der Aufrufer sie mitbringt. Die genaue Liste aus Schritt 1 uebernehmen --
// hier steht der Stand vom 15.08.2026.
require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-parsing.php';
require_once __DIR__ . '/../territories-tree.php';
require_once __DIR__ . '/../territories-parsing.php';
require_once __DIR__ . '/../../political/territory.php';
require __DIR__ . '/../powerlines.php';

$hexenband = ['name' => 'Hexenband', 'nest' => ['wiki_key' => 'hexenband', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband', 'name' => 'Hexenband']];
$satinav = ['name' => 'Satinavs Ketten', 'nest' => ['wiki_key' => 'satinavs-ketten', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)', 'name' => 'Satinavs Ketten']];

$byMatchKey = [
    avesmapsWikiSyncCreateMatchKey('Hexenband') => $hexenband,
    avesmapsWikiSyncCreateMatchKey('Satinavs Ketten (Kraftlinien)') => $satinav,
];
$byArticleKey = [
    avesmapsConflictArticleKey($hexenband['nest']['wiki_url']) => $hexenband,
    avesmapsConflictArticleKey($satinav['nest']['wiki_url']) => $satinav,
];

// 1) Der Name allein trifft -- das ist der heutige Weg und er bleibt.
$byName = avesmapsWikiPowerlineResolveSegment('Hexenband', [], $byMatchKey, $byArticleKey);
assert($byName['source'] === 'name');
assert($byName['entry']['name'] === 'Hexenband');
assert($byName['claim_unresolved'] === false);

// 2) Die Zuweisung schlaegt den Namen. Der Abnahmefall des Entwurfs: EIN Artikel, ZWEI Linien --
//    "Satinavs Kette I" und "II" zeigen beide auf "Satinavs Ketten", ohne umbenannt zu werden.
$claimed = avesmapsWikiPowerlineResolveSegment(
    'Satinavs Kette I',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($claimed['source'] === 'claim');
assert($claimed['entry']['name'] === 'Satinavs Ketten');

// 3) Die Zuweisung gewinnt auch dann, wenn der Name etwas ANDERES treffen wuerde.
$overrides = avesmapsWikiPowerlineResolveSegment(
    'Hexenband',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($overrides['source'] === 'claim');
assert($overrides['entry']['name'] === 'Satinavs Ketten');

// 4) Verglichen wird ueber den Artikelschluessel, nicht ueber die rohe Adresse:
//    Unterstrich gegen Leerzeichen-Kodierung darf sich nicht verfehlen.
$encoded = avesmapsWikiPowerlineResolveSegment(
    'Irgendwas',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs%20Ketten%20(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($encoded['source'] === 'claim');

// 5) Eine Adresse ins Leere: faellt auf den Namen zurueck UND wird gemeldet. Ohne die Meldung
//    saehe die Linie erledigt aus und waere es nicht (Entwurf §4).
$typo = avesmapsWikiPowerlineResolveSegment(
    'Hexenband',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexnband'],
    $byMatchKey,
    $byArticleKey
);
assert($typo['claim_unresolved'] === true);
assert($typo['source'] === 'name');          // der Name traegt weiter
$typoNoName = avesmapsWikiPowerlineResolveSegment(
    'Drachenblick',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexnband'],
    $byMatchKey,
    $byArticleKey
);
assert($typoNoName['claim_unresolved'] === true);
assert($typoNoName['source'] === 'none');
assert($typoNoName['entry'] === null);

// 6) Gar nichts trifft -- 37 Linien stehen live genau so da.
$nothing = avesmapsWikiPowerlineResolveSegment('Drachenblick', [], $byMatchKey, $byArticleKey);
assert($nothing['source'] === 'none');
assert($nothing['entry'] === null);
assert($nothing['claim_unresolved'] === false);

// 7) "Das Wiki fasst nach": traegt die Linie den Merker und der Dump kennt jetzt einen Artikel
//    mit passendem Namen, faellt der Merker. Er weist NICHT von selbst zu -- das Nest kommt aus
//    dem Namenstreffer, wie immer, und properties.wiki_url bleibt leer.
$reopen = avesmapsWikiPowerlineResolveSegment('Hexenband', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($reopen['clear_no_article'] === true);
assert($reopen['source'] === 'name');

// 8) Der Merker bleibt, solange nichts trifft -- sonst waere er wertlos.
$stays = avesmapsWikiPowerlineResolveSegment('Drachenblick', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($stays['clear_no_article'] === false);
assert($stays['source'] === 'none');

fwrite(STDOUT, "powerline-claim-test: alle Zusicherungen erfuellt\n");
```

- [ ] **Schritt 3: Test laufen lassen und scheitern sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/powerline-claim-test.php
```

Erwartet: `Call to undefined function avesmapsWikiPowerlineResolveSegment()`.

- [ ] **Schritt 4: Die Funktion schreiben**

In `api/_internal/wiki/powerlines.php` das `require_once` ergänzen (zu den bestehenden dazu, keines
ersetzen) und die Funktion **hinter** `avesmapsWikiPowerlineDesiredNestsByMatchKey()` einfügen:

```php
// Der Artikelschluessel-Normierer des Konfliktzentrums wird WIEDERVERWENDET, nicht nachgebaut:
// er ist rein, ohne Datenbank, und loest genau die Falle, die dort schon gestellt war --
// `Feste_Hohenstein` und `Feste%20Hohenstein` sind dieselbe Seite.
require_once __DIR__ . '/../conflicts/core.php';
```

```php
/**
 * REIN: Welcher Wiki-Artikel gehoert zu diesem Segment, und was ist dabei zu melden?
 *
 * Die Rangfolge (Entwurf §4):
 *   1. Zuweisung -- properties.wiki_url zeigt auf einen gestagten Artikel: DIE gilt, egal wie die
 *      Linie heisst. Nur so ist "ein Artikel, zwei Linien" ueberhaupt erreichbar
 *      (Satinavs Ketten gegen "Kette I"/"Kette II").
 *   2. Name -- avesmapsWikiSyncCreateMatchKey trifft einen gestagten Artikel (der bisherige Weg).
 *   3. nichts.
 *
 * 💣 Eine Adresse, die auf nichts zeigt, ist KEIN Fehler und KEINE Zuweisung -- sie kann ein
 * brandneuer Artikel sein, den der letzte Dump nicht kannte. Sie faellt auf Stufe 2 zurueck und
 * bleibt unangetastet stehen. Aber sie MUSS gemeldet werden: fuer das Konfliktzentrum gilt die
 * Linie als zugewiesen, sobald das Feld gefuellt ist -- ein Tippfehler nimmt sie also aus der
 * Beobachtungsliste, waehrend der Abgleich nichts holt. Sie saehe erledigt aus und waere es nicht.
 *
 * 💣 `clear_no_article` macht den Merker nur AUF, es weist nichts zu. Nach einem Namen zu raten und
 * daraus echte Daten zu machen ist die Fehlerklasse aus Discord #38.
 *
 * @param array<string, array{name:string, nest:array}> $stagedByMatchKey
 * @param array<string, array{name:string, nest:array}> $stagedByArticleKey
 * @return array{entry: ?array, source: string, claim_unresolved: bool, clear_no_article: bool}
 */
function avesmapsWikiPowerlineResolveSegment(
    string $name,
    array $properties,
    array $stagedByMatchKey,
    array $stagedByArticleKey
): array {
    $claimUnresolved = false;
    $claim = trim((string) ($properties['wiki_url'] ?? ''));
    if ($claim !== '') {
        $articleKey = avesmapsConflictArticleKey($claim);
        if ($articleKey !== '' && isset($stagedByArticleKey[$articleKey])) {
            return [
                'entry' => $stagedByArticleKey[$articleKey],
                'source' => 'claim',
                'claim_unresolved' => false,
                // Zuweisung und Merker schliessen einander aus (der Schreibweg lehnt es ab);
                // faende sich doch beides, gewinnt die Zuweisung und der Merker faellt.
                'clear_no_article' => !empty($properties['wiki_no_article']),
            ];
        }
        $claimUnresolved = true;
    }

    $matchKey = avesmapsWikiSyncCreateMatchKey($name);
    $entry = ($matchKey !== '' && isset($stagedByMatchKey[$matchKey])) ? $stagedByMatchKey[$matchKey] : null;

    return [
        'entry' => $entry,
        'source' => $entry === null ? 'none' : 'name',
        'claim_unresolved' => $claimUnresolved,
        'clear_no_article' => $entry !== null && !empty($properties['wiki_no_article']),
    ];
}
```

- [ ] **Schritt 5: Test laufen lassen und bestehen sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/powerline-claim-test.php
```

Erwartet: `powerline-claim-test: alle Zusicherungen erfuellt`

- [ ] **Schritt 6: Prüfen, dass das neue `require_once` nichts doppelt lädt**

```bash
php -l api/_internal/wiki/powerlines.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/powerline-parsing-test.php
```

Erwartet: keine Syntaxfehler, und der bestehende Kraftlinien-Test bleibt grün (er lädt dieselbe
Datei — eine Konstanten-Neudefinition würde hier sofort auffallen).

- [ ] **Schritt 7: Committen**

```bash
git status --porcelain
```
```bash
git add api/_internal/wiki/powerlines.php api/_internal/wiki/__tests__/powerline-claim-test.php
git commit -m "feat(kraftlinien): die Rangfolge der Wiki-Zuweisung als reine Funktion"
```

---

## Aufgabe 2: Den Abgleich auf die Rangfolge umstellen

**Dateien:**
- Ändern: `api/_internal/wiki/powerlines.php`, Funktion `avesmapsWikiPowerlineReconcile()`

**Schnittstellen:**
- Verwendet aus Aufgabe 1: `avesmapsWikiPowerlineResolveSegment(...)`.
- Liefert an Aufgabe 6: die Antwort des Abgleichs bekommt drei neue Schlüssel —
  `claims_unresolved` (`int`), `claims_orphaned` (`list<array{name:string, wiki_url:string}>`),
  `no_article_reopened` (`list<string>`, Liniennamen).

- [ ] **Schritt 1: Die Stelle finden, die umgebaut wird**

```bash
grep -n "avesmapsWikiSyncCreateMatchKey\|\$staged\[\$matchKey\]\|counts\[" api/_internal/wiki/powerlines.php
```

Erwartet: eine Schleife über die Segmente, die `$matchKey` bildet und `$staged[$matchKey]` liest,
sowie ein `$counts`-Feld mit `linked/updated/cleared/unchanged`. **Genau diese Schleife** wird
ersetzt; alles davor (Sandbox lesen, `$staged` bauen) und danach (`unmatched_names`, Zeitstempel,
Diagnose) bleibt unangetastet.

- [ ] **Schritt 2: Zusicherung, dass die Zählung stimmig bleibt, in den Test aufnehmen**

Ans Ende von `api/_internal/wiki/__tests__/powerline-claim-test.php`, **vor** die Erfolgsmeldung:

```php
// Der Zweitindex, den Aufgabe 2 im Abgleich baut: aus demselben $staged, ueber die Adresse im
// Nest. Hier festgenagelt, weil ein leerer Zweitindex jede Zuweisung lautlos wirkungslos machte --
// alles fiele auf den Namen zurueck und saehe aus wie "die Zuweisung wird ignoriert".
$rebuilt = [];
foreach ($byMatchKey as $entry) {
    $url = trim((string) ($entry['nest']['wiki_url'] ?? ''));
    if ($url !== '') {
        $rebuilt[avesmapsConflictArticleKey($url)] = $entry;
    }
}
assert(count($rebuilt) === 2);
assert(isset($rebuilt[avesmapsConflictArticleKey('https://de.wiki-aventurica.de/wiki/Hexenband')]));
```

- [ ] **Schritt 3: Test laufen lassen (muss weiter bestehen)**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/powerline-claim-test.php
```

Erwartet: grün. (Dieser Schritt prüft die Index-Bauvorschrift, noch nicht den Abgleich.)

- [ ] **Schritt 4: Den Abgleich umbauen**

In `avesmapsWikiPowerlineReconcile()`:

1. Nach dem Bauen von `$staged` den Zweitindex ergänzen — **genau die Vorschrift aus Schritt 2**:
   über alle `$staged`-Einträge, `avesmapsConflictArticleKey($entry['nest']['wiki_url'])` als
   Schlüssel, leere Adressen überspringen.
2. Drei Sammler anlegen: `$claimsUnresolved = 0;`, `$claimsOrphaned = [];`,
   `$noArticleReopened = [];`.
3. In der Segment-Schleife den handgebauten `$matchKey`/`$entry`-Zweig durch einen Aufruf von
   `avesmapsWikiPowerlineResolveSegment((string) $row['name'], $properties, $staged, $stagedByArticleKey)`
   ersetzen. `$entry = $resolved['entry']`.
4. `$matchedKeys` bei **beiden** Quellen füllen — bei `source === 'name'` **und** bei
   `source === 'claim'`. Begründung: `unmatched_names` treibt die Waisenliste im Editor („Wiki-Linien
   ohne Kartenlinie"), und eine zugewiesene Linie **ist** die Kartenlinie dieses Artikels. Bliebe sie
   ungezählt, stünde „Brücke von Akrabaal" nach der Zuweisung für immer als Waise da — die Liste
   würde nie kürzer und wäre damit als Arbeitsliste wertlos.
   Der Schlüssel ist in beiden Fällen der des **gefundenen Artikels**, nicht der der Linie:
   `$matchedKeys[avesmapsWikiSyncCreateMatchKey((string) $entry['name'])] = true;`
   💣 Nicht `$matchKey` der Kartenlinie nehmen. Bei einer Zuweisung heißt die Linie ja gerade
   **anders** als der Artikel — das ist der ganze Zweck —, und der Artikel bliebe als Waise stehen.
5. Bei `$resolved['claim_unresolved']`: `$claimsUnresolved++`, und wenn das Segment **bereits ein
   Nest trug** (`isset($properties['wiki_powerline'])`), zusätzlich
   `$claimsOrphaned[] = ['name' => (string) $row['name'], 'wiki_url' => trim((string) ($properties['wiki_url'] ?? ''))];`
   — das ist der Fall „Artikel verschwunden" aus Entwurf §4.
6. Bei `$resolved['clear_no_article']`: `unset($properties['wiki_no_article']);`, den Namen in
   `$noArticleReopened` aufnehmen, und sicherstellen, dass das Segment **auch dann geschrieben wird**,
   wenn `avesmapsWikiPowerlineMergeProperties()` `changed = false` meldet.
   💣 **Das ist die leicht zu übersehende Stelle:** die Schleife überspringt heute jedes unveränderte
   Segment mit `continue`. Fällt nur der Merker, ist das Nest gleich geblieben — ohne eine eigene
   Schreibbedingung bliebe der Merker für immer stehen und die Nachfass-Zusage wäre wirkungslos.
7. Die drei Sammler in das Rückgabefeld aufnehmen, neben `unmatched_names`.

🔴 **Nicht anfassen:** `properties.wiki_url` und `properties.wiki_no_article` werden vom Abgleich
**nie geschrieben**, mit der einen Ausnahme aus Punkt 6 (Merker löschen). Die Zuweisung ist die
Entscheidung eines Menschen; ein Lauf kassiert sie nicht.

- [ ] **Schritt 5: Syntax und Nachbartests**

```bash
php -l api/_internal/wiki/powerlines.php
```
```bash
for t in api/_internal/wiki/__tests__/*-test.php; do echo "--- $t"; php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" 2>&1 | tail -2; done
```

Erwartet: keine Syntaxfehler, alle Wiki-Tests grün.

- [ ] **Schritt 6: Committen**

```bash
git status --porcelain
```
```bash
git add api/_internal/wiki/powerlines.php api/_internal/wiki/__tests__/powerline-claim-test.php
git commit -m "feat(kraftlinien): der Abgleich folgt der Zuweisung, nicht mehr nur dem Namen"
```

---

## Aufgabe 3: „Kein Wiki-Artikel" verstummt im Konfliktzentrum

**Dateien:**
- Ändern: `api/_internal/conflicts/rules.php` (zwei Stellen: `avesmapsConflictLoadMapRows()` und
  `avesmapsConflictRuleMissingKey()`)
- Test: `api/_internal/conflicts/__tests__/conflict-rules-test.php`

**Schnittstellen:**
- Die von `avesmapsConflictLoadMapRows()` gelieferten Zeilen tragen einen neuen Schlüssel
  `no_article` (`bool`). `avesmapsConflictRuleMissingKey()` überspringt Zeilen, bei denen er `true`
  ist.

- [ ] **Schritt 1: Prüfen, wo der Merker heißt, wie er heißt, und dass die Regel ihn wirklich nicht liest**

```bash
grep -n "AVESMAPS_CONFLICT_NO_ARTICLE_FLAG" api/_internal/conflicts/repair.php
grep -n "wiki_no_article\|no_article" api/_internal/conflicts/rules.php
```

Erwartet: die Konstante ist `'wiki_no_article'` und steht in `repair.php`; in `rules.php` gibt es
**keinen** Treffer. Genau das ist der Befund — der Merker ist dort heute wirkungslos.

⚠️ `rules.php` lädt `repair.php` **nicht** (umgekehrt: `repair.php` lädt `rules.php`). Die Konstante
ist in `rules.php` also **nicht** verfügbar — dort wird der Feldname als Zeichenkette gelesen, so wie
`rules.php` auch `wiki_url` als Zeichenkette liest. Kein Verschieben der Konstante, kein neues
`require`: das würde eine Ringabhängigkeit bauen.

- [ ] **Schritt 2: Den scheiternden Test schreiben**

In `api/_internal/conflicts/__tests__/conflict-rules-test.php`, direkt **vor** den Abschnitt
`// ---- fingerprints are stable across runs`:

```php
// ---- rule 2: "kein Wiki-Artikel" verstummt (Discord-Fall #71) -----------------------------------
// Der Merker wird vom Konfliktzentrum selbst geschrieben (Knopf "Kein Wiki-Eintrag",
// AVESMAPS_CONFLICT_NO_ARTICLE_FLAG in repair.php) -- und von dieser Regel bis 15.08.2026 fuer
// KEINE Objektart gelesen. Live trug eine Kraftlinie ihn bereits und stand trotzdem auf der
// Beobachtungsliste: jemand hatte sie stillgelegt, und sie kam zurueck.
$noArticleRows = [
    ['type' => 'location', 'id' => 'n1', 'label' => 'Handgemacht', 'subtype' => 'dorf', 'wiki_url' => '', 'no_article' => true],
    ['type' => 'powerline', 'id' => 'n2', 'label' => 'Drachenblick', 'subtype' => '', 'wiki_url' => '', 'no_article' => true],
    ['type' => 'location', 'id' => 'n3', 'label' => 'Noch offen', 'subtype' => 'dorf', 'wiki_url' => ''],
];
$noArticle = avesmapsConflictRuleMissingKey($noArticleRows);
assert(count($noArticle) === 1);
assert($noArticle[0]['title'] === 'Noch offen');
// Fehlt der Schluessel ganz (Altbestand), aendert sich nichts -- er ist kein Pflichtfeld.
assert(count(avesmapsConflictRuleMissingKey([
    ['type' => 'location', 'id' => 'n4', 'label' => 'Ohne Schluessel', 'subtype' => 'dorf', 'wiki_url' => ''],
])) === 1);
```

- [ ] **Schritt 3: Test laufen lassen und scheitern sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/conflicts/__tests__/conflict-rules-test.php
```

Erwartet: `assert()`-Fehlschlag bei `count($noArticle) === 1` (es sind 3).

- [ ] **Schritt 4: Die Regel ändern**

In `avesmapsConflictRuleMissingKey()` gleich hinter der bestehenden Prüfung auf einen gesetzten
`wiki_url` eine zweite Prüfung ergänzen:

```php
        // Ein Editor hat festgehalten, dass es im Wiki nichts dazu gibt (Knopf "Kein Wiki-Eintrag",
        // oder das Haekchen im Kraftlinien-Editor). Das IST die Antwort auf "kein Wiki-Schluessel",
        // also gehoert der Fall nicht mehr auf die Beobachtungsliste. Bis 15.08.2026 las diese
        // Regel den Merker fuer KEINE Objektart -- eine stillgelegte Kraftlinie kam deshalb zurueck.
        if (!empty($row['no_article'])) {
            continue;
        }
```

- [ ] **Schritt 5: Den Merker in `avesmapsConflictLoadMapRows()` mitlesen**

```bash
grep -n "'claim_source' => \$claimSource" api/_internal/conflicts/rules.php
```

Neben `'claim_source'` in dasselbe Zeilen-Feld aufnehmen:

```php
            'no_article' => !empty($properties['wiki_no_article']),
```

⚠️ Territorien und Literatur (`avesmapsConflictLoadTerritoryRows`,
`avesmapsConflictLoadGameLiteratureRows`) bekommen den Schlüssel **nicht** — sie erreichen
`avesmapsConflictRuleMissingKey()` gar nicht (nur `$rows` geht dorthin, siehe
`avesmapsConflictDetectAll`), und `!empty()` auf einem fehlenden Schlüssel ist ohnehin `false`.

- [ ] **Schritt 6: Tests laufen lassen**

```bash
for t in api/_internal/conflicts/__tests__/*.php; do echo "--- $(basename $t)"; php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll "$t" 2>&1 | tail -2; done
```

Erwartet: alle drei grün.

- [ ] **Schritt 7: Die Reichweite nachmessen, nicht glauben**

```bash
curl -s "https://avesmaps.de/api/app/map-features.php" -o "$TMP/mf.json" && node -e "const d=require('$TMP/mf.json');let n=0,t={};d.features.forEach(f=>{const p=f.properties||{};if(!p.wiki_no_article)return;n++;t[p.feature_type]=(t[p.feature_type]||0)+1});console.log(n,JSON.stringify(t))"
```

Erwartet (Stand 15.08.2026): `6 {"location":5,"powerline":1}`. Weicht die Zahl deutlich ab, **nicht
weiterbauen** — dann hat jemand den Merker inzwischen breit gesetzt, und die Regeländerung verstummt
mehr als gedacht. ⚠️ **Ein einziger Abruf**, keine Schleife (AGENTS.md §9).

- [ ] **Schritt 8: Committen**

```bash
git status --porcelain
```
```bash
git add api/_internal/conflicts/rules.php api/_internal/conflicts/__tests__/conflict-rules-test.php
git commit -m "fix(konflikte): 'Kein Wiki-Eintrag' nimmt den Fall wirklich von der Beobachtungsliste"
```

---

## Aufgabe 4: Der Schreibweg nimmt den dritten Zustand an

**Dateien:**
- Ändern: `api/_internal/map/features.php`, Funktion `avesmapsUpdatePowerlineLine()`

**Schnittstellen:**
- Die Aktion `update_powerline_line` nimmt zusätzlich `wiki_no_article` (`bool`) entgegen und
  schreibt sie wie die übrigen Linienfelder auf **alle** Segmente des Namens.
- Widerspruch (`wiki_url` gefüllt **und** `wiki_no_article` wahr) wird mit
  `InvalidArgumentException` abgelehnt.

- [ ] **Schritt 1: Den Schreibweg nachlesen, bevor er angefasst wird**

```bash
grep -n "function avesmapsUpdatePowerlineLine" -A 12 api/_internal/map/features.php
grep -n "properties\['wiki_url'\] = \$wikiUrl" api/_internal/map/features.php
grep -n "avesmapsReadBoolean" api/_internal/map/features.php | head -3
```

Erwartet: die Funktion liest `current_name`, `new_name`, `show_label`, `description`, `wiki_url` aus
der Nutzlast und schreibt sie in einer Schleife über **alle** Segmente in die `properties`.
`avesmapsReadBoolean()` existiert und wird für `show_label` bereits benutzt — **dieselbe** Funktion
für den neuen Merker verwenden, keine eigene Wahrheitsprüfung.

- [ ] **Schritt 2: Widerspruchsprüfung und Merker ergänzen**

Direkt hinter das Einlesen von `$wikiUrl`:

```php
    $noArticle = avesmapsReadBoolean($payload['wiki_no_article'] ?? false);
    // 💣 Abgelehnt, nicht aufgeloest. Ein stummer Vorrang waere eine Regel, die niemand kennt --
    // und der Merker wird an DREI Stellen gelesen (Editor, Konfliktzentrum, Abgleich), die dann
    // verschiedener Meinung sein koennten.
    if ($noArticle && $wikiUrl !== '') {
        throw new InvalidArgumentException(
            'Eine Kraftlinie kann nicht gleichzeitig einen Wiki-Artikel haben und keinen. Bitte den Link leeren oder das Häkchen entfernen.'
        );
    }
```

In der Segment-Schleife, neben `$properties['wiki_url'] = $wikiUrl;`:

```php
            if ($noArticle) {
                $properties['wiki_no_article'] = true;
            } else {
                unset($properties['wiki_no_article']);
            }
```

⚠️ **Entfernen statt `false` schreiben.** Das Konfliktzentrum prüft mit `!empty()`; ein gespeichertes
`false` wäre gleichwertig, aber es hinterließe in jedem Segment ein Feld, das nichts aussagt — und
`avesmapsEnrichMapFeatureWikiUrl()` liest denselben Merker.

- [ ] **Schritt 3: Den Merker in die Protokollzeile aufnehmen**

```bash
grep -n "'update_powerline_line'," -A 14 api/_internal/map/features.php
```

Im Nachher-Abbild der Protokollzeile `'wiki_no_article' => $noArticle,` neben `'wiki_url'`
ergänzen. Ohne das steht im Protokoll eine Änderung, die man nicht sieht.

- [ ] **Schritt 4: Syntax prüfen**

```bash
php -l api/_internal/map/features.php
```

- [ ] **Schritt 5: Widerspruch von Hand durchspielen**

Da diese Funktion eine Datenbank braucht, wird sie hier **nicht** per Unit-Test abgedeckt (das
Testfeld der Kartenfeatures ist ebenfalls DB-frei). Stattdessen in Aufgabe 7 am echten Ablauf: das
Häkchen bei gefülltem Link setzen und speichern ⇒ die Meldung muss im Editor erscheinen, und die
Linie darf sich **nicht** geändert haben.

- [ ] **Schritt 6: Committen**

```bash
git status --porcelain
```
```bash
git add api/_internal/map/features.php
git commit -m "feat(kraftlinien): der Linien-Schreibweg kennt 'kein Wiki-Artikel' und lehnt den Widerspruch ab"
```

---

## Aufgabe 5: Der Leseweg liefert Artikel und Dump-Zustand

**Dateien:**
- Ändern: `api/edit/map/powerlines.php`

**Schnittstellen:**
- Die Antwort bekommt zwei Schlüssel:
  `wiki_articles`: `list<array{name:string, wiki_url:string, wiki_key:string}>`, nach Namen sortiert.
  `dump_state`: `array{has_run:bool, completed_at:string, article_count:int}`.

- [ ] **Schritt 1: Prüfen, wie der Abgleich an die Sandbox kommt**

```bash
grep -n "avesmapsWikiDumpSyncKindResolveDumpRunId\|avesmapsWikiDumpSyncKindFetchRows\|AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE" api/_internal/wiki/powerlines.php
grep -n "function avesmapsWikiDumpSyncKindFetchRows" api/_internal/wiki/dump-sync-kind.php
grep -n "avesmapsJsonResponse(200" -A 8 api/edit/map/powerlines.php
```

Erwartet: der Abgleich löst erst eine `run_id` auf und holt damit die Sandbox-Zeilen; die Antwort
des Lesewegs endet heute mit `ok/segments/nodes/nodix_candidates`.

- [ ] **Schritt 2: Die Artikelliste ergänzen**

In `api/edit/map/powerlines.php` vor dem `avesmapsJsonResponse(200, …)`:

- `require_once` für die Kraftlinien-Bibliothek ergänzen (Pfad aus Schritt 1 ablesen).
- Die gestagten Artikel über **denselben** Weg holen, den der Abgleich benutzt: `run_id` auflösen,
  Sandbox-Zeilen holen, durch `avesmapsWikiPowerlineDesiredNestsByMatchKey()` schicken. Daraus
  `name` + `wiki_url` + `wiki_key` je Eintrag, nach `name` sortiert (`strcoll`/`localeCompare`-Ersatz:
  `usort` mit `strcmp` auf der kleingeschriebenen Form genügt — die Liste hat 23 Zeilen).
- 💣 **Der ganze Block läuft in `try { } catch (Throwable) { }`** und liefert im Fehlerfall eine leere
  Liste plus `dump_state.has_run = false`. Ist noch nie ein Dump gelaufen, **wirft** die Auflösung
  der `run_id` — und ohne diesen Fang stürbe der Leseweg, der heute den ganzen Editor füllt. Der
  Editor wäre dann leer, und die Ursache läge in einer ganz anderen Ecke.

Gerüst (die `require`-Zeile und die drei Funktionsnamen **aus Schritt 1 übernehmen**, nicht von hier
abschreiben — sie stehen dort, weil dieser Plan sie nicht garantieren kann):

```php
    // Die Vorschlagsliste des Editors. AUS DERSELBEN QUELLE wie der Abgleich -- sonst koennten
    // Vorschlag und Ergebnis verschiedener Meinung sein. 23 Zeilen, kein Blaettern noetig.
    $wikiArticles = [];
    $dumpState = ['has_run' => false, 'completed_at' => '', 'article_count' => 0];
    try {
        $runId = avesmapsWikiDumpSyncKindResolveDumpRunId($pdo);
        $sandboxRows = avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, [AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE], 0, 5000);
        foreach (avesmapsWikiPowerlineDesiredNestsByMatchKey($sandboxRows) as $entry) {
            $wikiArticles[] = [
                'name' => (string) ($entry['name'] ?? ''),
                'wiki_url' => (string) ($entry['nest']['wiki_url'] ?? ''),
                'wiki_key' => (string) ($entry['nest']['wiki_key'] ?? ''),
            ];
        }
        usort($wikiArticles, static fn(array $a, array $b): int => strcmp(mb_strtolower($a['name']), mb_strtolower($b['name'])));
        $runRow = avesmapsWikiDumpSyncKindFetchRunById($pdo, $runId);
        $dumpState = [
            'has_run' => true,
            'completed_at' => (string) ($runRow['completed_at'] ?? ''),
            'article_count' => count($wikiArticles),
        ];
    } catch (Throwable) {
        // 💣 Ist noch nie ein Dump gelaufen, WIRFT die Aufloesung der run_id. Ohne diesen Fang
        // stuerbe der Leseweg, der heute den ganzen Editor fuellt -- das Fenster waere leer, und
        // niemand suchte die Ursache bei einer Vorschlagsliste. Leere Liste ist die richtige
        // Antwort; has_run:false sagt der Oberflaeche, wie sie das erklaeren soll.
    }
```

- [ ] **Schritt 3: Probe gegen den echten Zustand**

Nach dem Deploy (PHP kommt durch den Opcache 2–4 Minuten später), **einmal** aufrufen — der Endpunkt
verlangt eine angemeldete Sitzung, also im Browser über den geöffneten Editor prüfen:

```javascript
fetch('/api/edit/map/powerlines.php',{credentials:'same-origin'}).then(r=>r.json()).then(d=>console.log(d.dump_state, d.wiki_articles.length, d.wiki_articles.slice(0,3)))
```

Erwartet: `article_count` 23 (Stand 15.08.2026), `has_run: true`, und die ersten Einträge tragen
Name und Adresse.

- [ ] **Schritt 4: Committen**

```bash
git status --porcelain
```
```bash
git add api/edit/map/powerlines.php
git commit -m "feat(kraftlinien): der Editor-Leseweg liefert die bekannten Wiki-Artikel mit"
```

---

## Aufgabe 6: Die drei Zustände im Editor

**Dateien:**
- Ändern: `html/wiki-sync-powerline-editor.html` (Funktionen `renderDetail()` und `saveLine()`)

**Schnittstellen:**
- Verwendet aus Aufgabe 5: `wiki_articles`, `dump_state` aus der Leseweg-Antwort.
- Verwendet aus Aufgabe 4: `wiki_no_article` in der Nutzlast von `update_powerline_line`.

- [ ] **Schritt 1: Die zu ändernden Stellen nachlesen**

```bash
grep -n "plWikiUrl\|renderDetail\|async function saveLine\|action: \"update_powerline_line\"" html/wiki-sync-powerline-editor.html
grep -n "fieldSample" html/wiki-sync-powerline-editor.html | head -3
```

Erwartet: `renderDetail()` baut die Zeile „Wiki-Link" mit `<input type="url" id="plWikiUrl">`;
`saveLine()` schickt `wiki_url: $("plWikiUrl").value.trim()`. `fieldSample(line, feld)` liest ein
Linienfeld aus einem beliebigen Segment — **damit** wird auch der neue Merker gelesen.

- [ ] **Schritt 2: Die neuen Daten im Lader festhalten**

```bash
grep -n "const response = await fetch(READ_API" -A 8 html/wiki-sync-powerline-editor.html
```

Neben den vorhandenen Modul-Variablen (`let segments = [];` …) zwei weitere anlegen und im Lader aus
der Antwort füllen:

```javascript
let wikiArticles = [];      // [{name, wiki_url, wiki_key}] -- Vorschlaege fuer die Zuweisung
let dumpState = { has_run: false, completed_at: "", article_count: 0 };
```

```javascript
	wikiArticles = Array.isArray(data.wiki_articles) ? data.wiki_articles : [];
	dumpState = data.dump_state || { has_run: false, completed_at: "", article_count: 0 };
```

- [ ] **Schritt 3: Die Zeile umbauen**

Der heutige Block in `renderDetail()` (Zeile „Wiki-Link", `<input type="url" id="plWikiUrl">` plus
`pl-hint`) wird ersetzt durch:

```javascript
		+ '<div class="dt-grid"><div class="k">Wiki-Artikel</div><div>'
			+ '<input type="url" id="plWikiUrl" maxlength="500" list="plWikiList" placeholder="https://de.wiki-aventurica.de/wiki/…" value="' + esc(wikiUrl) + '"' + (noArticle ? " disabled" : "") + ">"
			// <datalist> SCHLAEGT VOR und schraenkt nicht ein -- eine eigene Adresse einzufuegen
			// muss moeglich bleiben (ein brandneuer Artikel steht noch in keinem Dump).
			+ '<datalist id="plWikiList">'
				+ wikiArticles.map((a) => '<option value="' + esc(a.wiki_url) + '" label="' + esc(a.name) + '"></option>').join("")
			+ "</datalist>"
			+ '<div class="pl-hint">'
				+ (dumpState.has_run
					? "Ausdrücklich gesetzt, nie geraten. Der Abgleich folgt der Zuweisung, auch wenn die Linie anders heißt."
					: "Noch kein Dump geholt — deshalb keine Artikel zur Auswahl.")
				+ (wikiUrl ? ' <a class="dt-link" href="' + esc(wikiUrl) + '" target="_blank" rel="noopener">Öffnen ↗</a>' : "")
			+ "</div>"
		+ "</div></div>"
		+ '<div class="dt-check"><input type="checkbox" id="plNoArticle"' + (noArticle ? " checked" : "") + (wikiUrl ? " disabled" : "") + "><span>Kein Wiki-Artikel vorhanden</span></div>"
		// 🔴 Der zweite Halbsatz ist tragend: der Merker ist NICHT endgueltig -- der Abgleich macht
		// ihn wieder auf, sobald im Wiki ein passender Artikel auftaucht (Entwurf §4). Ohne ihn
		// liest er sich als endgueltig, und die Wiedervorlage wirkt wie ein Fehler.
		+ '<div class="pl-hint">Nimmt die Linie aus der Konfliktliste — bis im Wiki einer auftaucht.</div>'

Dazu oben in `renderDetail()`, neben `const wikiUrl = fieldSample(line, "wiki_url");`:

```javascript
	const noArticle = line.segments.some((s) => s.wiki_no_article === true);
```

⚠️ **`some`, nicht `fieldSample`.** Der Merker ist ein Wahrheitswert; `fieldSample` liefert das erste
**nicht-leere** Feld und verhielte sich bei `false` unvorhersehbar.

⚠️ Häkchen und Feld sperren einander schon in der Oberfläche (das `disabled` oben). Das **ersetzt die
Prüfung im Server nicht** (Aufgabe 4) — es erspart nur den Fehlschlag.

- [ ] **Schritt 4: Das Speichern erweitern**

In `saveLine()` die Nutzlast um `wiki_no_article: $("plNoArticle").checked` ergänzen. Nichts
Bestehendes entfernen.

- [ ] **Schritt 5: Die Gegenrichtung anzeigen**

Unter dem Wiki-Block („Aus dem Wiki") einen Abschnitt **„Wiki-Linien ohne Kartenlinie"** mit den
Namen aus `unmatched_names` des letzten Abgleichs, plus — wenn größer als 0 — die Zeile
**„N Zuweisungen zeigen ins Leere"** aus `claims_unresolved`.

⚠️ Beide Werte stehen heute **nur in der Antwort des Sync-Aufrufs** und verfallen mit ihr. Sie werden
deshalb beim Abschluss eines Laufs im Editor festgehalten (Modul-Variable) und angezeigt, solange das
Fenster offen ist. Ein Wert, der noch nie gefüllt wurde, zeigt gar nichts an — **keine 0, kein
Platzhalter**.

- [ ] **Schritt 6: Designsprache prüfen**

```bash
grep -n "dt-check\|dt-grid\|dt-grp\|pl-hint" html/wiki-sync-powerline-editor.html | head -10
```

Die neuen Elemente benutzen **ausschließlich** diese vorhandenen Klassen. Kein gefüllter
Akzentknopf in einer Eigenschaftszeile — die Haupthandlung des Fensters ist „⚡ Kraftlinien syncen"
(AGENTS.md §12). Keine hartkodierte Farbe.

- [ ] **Schritt 7: Vor dem Commit die zwei Prüf-Unteragenten laufen lassen**

`usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (gebauter Zustand gegen
Designsprache, hell **und** dunkel) — AGENTS.md §9.

- [ ] **Schritt 8: Committen**

```bash
git status --porcelain
```
```bash
git add html/wiki-sync-powerline-editor.html
git commit -m "feat(kraftlinien): Wiki-Artikel im Editor zuweisen, 'kein Artikel' festhalten"
```

---

## Aufgabe 7: Abnahme am echten Ablauf

**Dateien:** keine — hier wird gemessen, nicht gebaut.

🔴 **Abnahme heißt ABLAUF, nicht Maß** (AGENTS.md §9). Eine grüne Testtabelle ist kein Beleg, dass
das Ding funktioniert.

- [ ] **Schritt 1: Das ganze Testfeld**

Beide Läufe aus „Globale Vorgaben". Ein einziger roter Test außer `link-url-test.php` heißt: **nicht
pushen**. ⚠️ Ein fehlgeschlagener Deploy vergiftet den `?v=`-Stempel — der nächste grüne Lauf hält
nie hochgeladene Dateien für aktuell, und nur eine Inhaltsänderung heilt das.

- [ ] **Schritt 2: Der Abnahmefall aus dem Entwurf**

Im Editor die Linie **„Brücke nach Akrabaal"** (2 Segmente) auswählen, ihr den Artikel
**„Brücke von Akrabaal"** zuweisen, speichern, **„⚡ Kraftlinien syncen"** anstoßen, dann auf der
Karte die Infobox dieser Linie öffnen.

Erwartet: Stärke, Affinität, Länge, Regionen und Verlauf stehen da — und die Linie heißt
**weiterhin „Brücke nach Akrabaal"**. Heißt sie plötzlich anders, ist Owner-Entscheidung §2.1
verletzt und die Arbeit ist nicht fertig.

- [ ] **Schritt 3: Der Fall, den es ohne Zuweisung nicht geben kann**

**„Satinavs Kette I"** und **„Satinavs Kette II"** beide dem Artikel **„Satinavs Ketten"** zuweisen.

Erwartet: beide Linien zeigen die Wiki-Daten, bleiben **zwei** Linien, und im Konfliktzentrum
erscheint **kein** Eintrag „Mehrere Objekte beanspruchen denselben Wiki-Artikel" (seit `fb8a4985`
ist `powerline|powerline` legitim).

- [ ] **Schritt 4: Der dritte Zustand**

Bei **„Drachenblick"** im **Kraftlinien-Editor** das Häkchen „Kein Wiki-Artikel vorhanden" setzen
und speichern. Dann im Konfliktzentrum (WikiSync → ⚖️ Konflikte → „Kein Wiki-Schlüssel") nachsehen.

Erwartet: „Drachenblick" ist weg. Vorher waren es 37 Kraftlinien-Fälle.

💣 **Der Weg führt über den EDITOR, nicht über das Konfliktzentrum** — dort gibt es den Knopf
„Kein Wiki-Eintrag" auf einem Beobachtungslisten-Fall gar nicht. `isRepairable`
(`js/review/review-conflicts.js`) verlangt eine geteilte Adresse **und** mehr als eine Partei;
ein `wiki.missing_key`-Fall hat `wiki_url = ''` und genau eine Partei, seine Aktionen sind laut
Katalog nur `defer` und `ignore`. Eine frühere Fassung dieses Schrittes ließ hier im
Konfliktzentrum klicken — der Knopf ist dort nicht, der Schritt wäre unerfüllbar gewesen.
🔧 **Offen für den Owner:** damit lässt sich ein Fall der Beobachtungsliste nur aus dem jeweiligen
Editor stilllegen. Bei 37 Kraftlinien ist das je Linie ein Fenster­wechsel. Ob die Liste einen
eigenen Weg dafür bekommen soll, ist eine Produktentscheidung und steht hier bewusst offen.

- [ ] **Schritt 5: Der Widerspruch**

Bei derselben Linie zusätzlich eine Adresse eintragen und speichern.

Erwartet: eine Meldung im Editor, **keine** Änderung an der Linie.

- [ ] **Schritt 6: Die Zahl, die niemand sehen würde**

Bei einer beliebigen Linie eine Fantasie-Adresse eintragen (`…/wiki/Gibtesnicht`), speichern, syncen.

Erwartet: der Editor zeigt „1 Zuweisung zeigt ins Leere". Danach wieder leeren.
💣 Genau hier saß das stille Loch aus Entwurf §4 — die Linie gilt überall als zugewiesen, während
der Abgleich nichts holt.

- [ ] **Schritt 7: Zählen, was übrig ist**

```bash
curl -s "https://avesmaps.de/api/app/map-features.php" -o "$TMP/mf.json" && node -e "const d=require('$TMP/mf.json');const m=new Map();d.features.forEach(f=>{const p=f.properties||{};if(p.feature_type!=='powerline')return;const n=String(p.name||'').trim();if(!n||n.startsWith('Kreuzung'))return;const has=String(p.wiki_url||'').trim()||String((p.wiki_powerline||{}).wiki_url||'').trim()||p.wiki_no_article;if(!has)m.set(n,1)});console.log('noch offen:',m.size,[...m.keys()])"
```

⚠️ **Ein einziger Abruf.** Erwartet: deutlich unter 37 — jede Linie, die noch dasteht, ist eine, die
weder zugewiesen noch als artikellos markiert wurde.

- [ ] **Schritt 8: Pushen und den entfernten Stand prüfen**

```bash
git fetch origin --quiet && git log --oneline HEAD..origin/master
```

💣 **Bei abgelehntem Push NICHT `rebase --autostash`**, obwohl AGENTS.md §9 das sagt. Im geteilten
Arbeitsbaum liegt fremde offene Arbeit; hat die Parallelsitzung Änderungen in genau den Dateien ihres
eigenen frisch gepushten Commits, wendet der Stash-Rücklauf einen Diff gegen den **alten** Stand auf
den **neuen** an — ein Konflikt mitten in halbfertiger fremder Arbeit. Stattdessen:

1. `git diff --name-only <eigener-commit>~1 origin/master` — überschneiden sich die neuen Commits mit
   den eigenen Dateien? Dann **halten** und mit dem Owner klären.
2. Ohne Überschneidung: `git reset --mixed origin/master` (⚠️ **nie `--hard`**, das löscht die fremde
   Arbeit), eigene Pfade nach Namen erneut stagen, neu committen, pushen.

```bash
git push origin master
```
```bash
git fetch origin --quiet && git log --oneline -1 HEAD && git log --oneline -1 origin/master
```

Beide SHAs müssen gleich sein. Danach ~1–2 Minuten Deploy, PHP durch den Opcache 2–4 Minuten.

---

## Was dieser Plan NICHT baut

Aus dem Entwurf §9, hier zur Erinnerung, damit niemand es „nebenbei" mitnimmt:

- 🪤 ~~kein Massen-Zuweisen (`assign_all`) — die Arbeitsliste sind vier Fälle~~ **— revidiert
  18.08.2026.** Die Arbeitsliste waren nicht vier, sondern **16** wortgleiche Treffer (live
  gemessen); die vier waren die Ähnlichkeitsfälle. Gebaut in `ce9fee27`, Begründung im Entwurf §9.
  ⚠️ Der Lauf fasst **nur** wortgleiche Treffer an — würde er je auf ähnliche ausgeweitet, gälte
  die ursprüngliche Regel sofort wieder.
- keine Übernahme-Vorschau (`sync_plan_item`) für den Kraftlinien-Abgleich
- kein Zusammenführen zweier Linien über die Zuweisung — das kann der Editor bereits übers
  Umbenennen, und es getrennt zu halten **ist** Owner-Entscheidung §2.1
- aus einer Wiki-Waise eine Linie zeichnen — das ist Kartenarbeit
