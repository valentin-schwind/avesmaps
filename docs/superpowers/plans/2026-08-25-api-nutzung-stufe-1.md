# API-Nutzungstafel Stufe 1 — Bauplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Der Editor-Reiter *Status* bekommt einen dritten Unterreiter **API**, der zeigt, welche
Endpunkte wie oft gerufen werden, wie sie antworten — **einschließlich der leeren Antworten nach
einem Fatal Error** — und wann die Last liegt.

**Architektur:** Ein einziger Schreiber am Ende jeder Anfrage. `avesmapsJsonResponse` merkt sich
nur Status und Fehlercode; eine `register_shutdown_function` schreibt daraus **eine** Anweisung mit
bis zu drei Aggregatzeilen. Bricht die Anfrage vorher ab, trägt die Zeile `leer`. Gelesen wird über
einen `edit`-gesicherten Endpunkt, gezeichnet mit den vorhandenen `.va-*`-Karten.

**Technik:** PHP 8 (strict types) + PDO/MySQL, `CREATE TABLE IF NOT EXISTS` im Hausstil; Frontend
vanilla JS ohne Build; Tests sind nackte PHP-`assert`-Skripte und Node-Skripte.

**Entwurf:** `docs/superpowers/specs/2026-08-25-api-nutzung-design.md`
**Mockup:** `docs/api-nutzung-mockup.html`

**Umfang dieses Plans:** **nur Stufe 1** (Entwurf §12 Schritte 1 und 2). Stufe 2 (Antwortzeiten)
und Stufe 3 (Fremdnutzung) bekommen eigene Pläne. Die ausgehende Richtung ist ein eigenes
Vorhaben (Entwurf §11).

---

## Globale Randbedingungen

Diese gelten für **jede** Aufgabe und werden nicht wiederholt.

- **Kommentare, Doku und Commit-Betreffs auf Deutsch** (AGENTS.md §8). Maschinenlesbare
  `error.code`-Werte bleiben englisch.
- **Nur eigene Pfade stagen, niemals `git add -A`** (AGENTS.md §9). Der Baum ist mit anderen
  Sitzungen geteilt und trägt fremde unfertige Arbeit. Vor jedem Commit `git status`.
- **Der lokale Hauptbaum hängt weit hinter `origin/master`** (Stand 25.08.2026: 360 Commits).
  Gepusht wird über einen Wegwerf-Worktree auf `origin/master`, **nie** per Rebase im geteilten
  Baum, **nie** mit Force.
- **Vor jedem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests (AGENTS.md §9):
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  ```
  ```bash
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  ```
  ```bash
  for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
  ```
  ⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden 45 Tests rot, die nur die Erweiterung vermissen.
  Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Kein `?v=` von Hand.** Neue Dateien, die aus `index.html` verlinkt werden, stempelt der Deploy
  selbst. `ASSET_VERSION` ist hier **nicht** zu erhöhen — das gilt nur für die dynamisch geladenen
  Territorien-Editor-Assets.
- **Keine hartkodierte Farbe, kein hartkodierter Radius** (AGENTS.md §12) — Token aus
  `css/base/tokens.css`. Ausnahme: die kategorialen Serienfarben der Diagramme, die im
  Besucher-Dashboard bereits als bewusste Ausnahme kommentiert sind.
- **Untergrenze für Schriftgrößen: 11 px**, außer wo eine vorhandene Regel begründet darunter
  liegt (`.va-heat__hour` = 9 px, `.va-feed__tag` = 10 px — beide übernommen, nicht neu erfunden).
- **`AVESMAPS_API_METRICS_KEINE_STUNDE = 24`** ist der Platzhalter für „diese Zeile hat keine
  Stunde". Siehe die Falle in Aufgabe 1.

---

## Dateiübersicht

| Datei | Zuständig für | Aufgabe |
|---|---|---|
| `api/_internal/analytics/api-metrics.php` (neu) | Die ganze Bibliothek: Schlüssel, Zonen, Klassen, Zeilenbau, DDL, Schreiben, Aufräumen, Lesen | 1, 4, 5 |
| `api/_internal/bootstrap.php` (ändern) | Merkstelle für die PDO; Statusmerker in `avesmapsJsonResponse`; Registrierung der Abschlussroutine | 2, 3 |
| `api/app/api-metrics.php` (neu) | Der `edit`-gesicherte Leseendpunkt | 5 |
| `js/review/review-api-metrics.js` (neu) | Der Renderer der sechs Karten | 6 |
| `css/components/visitor-analytics.css` (ändern) | Die drei neuen Bauteile (Abschnittslinie, gestapelter Balken, Ampelzeile) | 6 |
| `js/review/review-status.js` (ändern) | Dritter Zweig in `activateStatusSubtab` | 6 |
| `index.html` (ändern) | Dritter Reiterknopf, dritter Abschnitt, Skript-Einbindung | 6 |

⚠️ **Abweichung vom Entwurf, bewusst:** Entwurf §10 nennt die Tests unter
`api/_internal/__tests__/`. Sie liegen hier bei ihrer Bibliothek in
`api/_internal/analytics/__tests__/` — dort steht schon der Test des Besucher-Moduls, und Tests
wohnen im Haus neben dem, was sie prüfen. Beide Verzeichnisse werden vom Testfeld gefunden.

---

## Aufgabe 1: Die Bibliothek — reine Funktionen und die Tabelle

**Dateien:**
- Anlegen: `api/_internal/analytics/api-metrics.php`
- Test: `api/_internal/analytics/__tests__/api-metrics-schluessel-test.php`

**Schnittstellen:**
- Verbraucht: nichts (die Datei hängt an keiner anderen).
- Liefert:
  - `const AVESMAPS_API_METRICS_KEINE_STUNDE = 24`
  - `avesmapsApiMetricsAktiv(array $config): bool`
  - `avesmapsApiMetricsEndpunktSchluessel(string $scriptName): string`
  - `avesmapsApiMetricsZone(string $schluessel): string`
  - `avesmapsApiMetricsStatusKlasse(?int $status, bool $abgeschlossen): string`
  - `avesmapsApiMetricsFehlerCode(mixed $code): string`
  - `avesmapsApiMetricsZeilenFuerAnfrage(string $scriptName, ?int $status, bool $abgeschlossen, ?string $fehlerCode, int $utcStunde): array`
    — liefert eine Liste von `['metric' => string, 'dimension' => string, 'hour' => int]`
  - `avesmapsApiMetricsEnsureTable(PDO $pdo): void`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `api/_internal/analytics/__tests__/api-metrics-schluessel-test.php`

```php
<?php

declare(strict_types=1);

/**
 * Die reinen Funktionen der API-Zaehlbibliothek: Endpunktschluessel, Zone, Statusklasse und der
 * Zeilenbau. Kein Datenbankzugriff -- alles hier ist eine Abbildung von Eingabe auf Ausgabe.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-schluessel-test.php
 * Exit 0 = alle Zusicherungen halten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../api-metrics.php';

// --- Der Endpunktschluessel ------------------------------------------------------------------
assert(avesmapsApiMetricsEndpunktSchluessel('/api/app/map-features.php') === 'app/map-features');
assert(avesmapsApiMetricsEndpunktSchluessel('/api/route/index.php') === 'route/index');
assert(avesmapsApiMetricsEndpunktSchluessel('/api/edit/map/features.php') === 'edit/map/features');
// Ein Unterverzeichnis der Seite davor darf nicht durchschlagen.
assert(avesmapsApiMetricsEndpunktSchluessel('/kunden/web/api/app/coat.php') === 'app/coat');

// 💣 NIEMALS DIE ABFRAGE. Kaeme der Schluessel aus REQUEST_URI, stuenden Suchbegriffe und
// Kennungen echter Besucher in einer Betriebstabelle, und die Dimension waere unbegrenzt.
// Der Test haelt fest, dass ein Fragezeichen es nie in den Schluessel schafft.
assert(!str_contains(avesmapsApiMetricsEndpunktSchluessel('/api/app/coat.php?wiki_key=geheim'), '?'));
assert(!str_contains(avesmapsApiMetricsEndpunktSchluessel('/api/app/map-search.php?q=Gareth'), 'Gareth'));

// Unbrauchbares faellt auf einen festen Namen, nie auf die Adresse.
assert(avesmapsApiMetricsEndpunktSchluessel('') === 'unbekannt');
assert(avesmapsApiMetricsEndpunktSchluessel('/nichts/dergleichen.php') === 'unbekannt');

// --- Die vier Zonen --------------------------------------------------------------------------
assert(avesmapsApiMetricsZone('route/index') === 'offen');
assert(avesmapsApiMetricsZone('locations/index') === 'offen');
assert(avesmapsApiMetricsZone('app/map-features') === 'app');
assert(avesmapsApiMetricsZone('edit/map/features') === 'edit');
assert(avesmapsApiMetricsZone('discord/interactions') === 'sonstige');
assert(avesmapsApiMetricsZone('unbekannt') === 'sonstige');

// --- Die Statusklassen -----------------------------------------------------------------------
assert(avesmapsApiMetricsStatusKlasse(200, true) === '2xx');
assert(avesmapsApiMetricsStatusKlasse(204, true) === '2xx');
assert(avesmapsApiMetricsStatusKlasse(304, true) === '3xx');
assert(avesmapsApiMetricsStatusKlasse(404, true) === '4xx');
assert(avesmapsApiMetricsStatusKlasse(500, true) === '5xx');

// 🔴 DER FALL, FUER DEN DIE TAFEL GEBAUT WIRD: die Anfrage ist nie durch den Trichter gekommen.
// Ein Fatal Error antwortet mit leerem Rumpf, und der Statuscode ist dann bedeutungslos --
// PHP meldet in diesem Zustand oft weiterhin 200.
assert(avesmapsApiMetricsStatusKlasse(200, false) === 'leer');
assert(avesmapsApiMetricsStatusKlasse(500, false) === 'leer');
assert(avesmapsApiMetricsStatusKlasse(null, false) === 'leer');

// --- Der Fehlercode ist ein geschlossenes Vokabular -------------------------------------------
// 💣 Ein dynamisch gebauter Code (mit einer Kennung darin) blaehte die Dimension auf wie
// REQUEST_URI. Alles ausserhalb von ^[a-z0-9_]{1,40}$ wird eingesammelt.
assert(avesmapsApiMetricsFehlerCode('server_error') === 'server_error');
assert(avesmapsApiMetricsFehlerCode('not_found') === 'not_found');
assert(avesmapsApiMetricsFehlerCode('Fehler bei Gareth (id 4711)') === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(str_repeat('a', 41)) === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(null) === 'sonstiger_code');
assert(avesmapsApiMetricsFehlerCode(42) === 'sonstiger_code');

// --- Der Zeilenbau ---------------------------------------------------------------------------
$KEINE = AVESMAPS_API_METRICS_KEINE_STUNDE;

// Eine gesunde Antwort: zwei Zeilen, kein Fehlereintrag.
$gut = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/map-features.php', 200, true, null, 14);
assert(count($gut) === 2, 'gesunde Antwort: antwort + stunde');
assert($gut[0] === ['metric' => 'antwort', 'dimension' => 'app/map-features|2xx', 'hour' => $KEINE]);
assert($gut[1] === ['metric' => 'stunde', 'dimension' => '', 'hour' => 14]);

// Ein Fehler: die dritte Zeile kommt dazu.
$schlecht = avesmapsApiMetricsZeilenFuerAnfrage('/api/edit/wiki/sync.php', 500, true, 'server_error', 3);
assert(count($schlecht) === 3, 'Fehler: antwort + stunde + fehler');
assert($schlecht[2] === ['metric' => 'fehler', 'dimension' => 'edit/wiki/sync|server_error', 'hour' => $KEINE]);

// Eine leere Antwort zaehlt als Fehler -- sonst faehrt der schlimmste Fall ohne Eintrag.
$leer = avesmapsApiMetricsZeilenFuerAnfrage('/api/edit/map/paths-editor.php', 200, false, null, 9);
assert(count($leer) === 3);
assert($leer[0]['dimension'] === 'edit/map/paths-editor|leer');
assert($leer[2] === ['metric' => 'fehler', 'dimension' => 'edit/map/paths-editor|fatal', 'hour' => $KEINE]);

// 2xx und 3xx erzeugen NIE eine Fehlerzeile, auch wenn versehentlich ein Code mitkommt.
$mitCode = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 200, true, 'server_error', 1);
assert(count($mitCode) === 2, '2xx bekommt keine Fehlerzeile');

// Die Stunde ist auf 0..23 begrenzt; alles andere waere ein Datenfehler in der Tabelle.
foreach ([0, 23] as $h) {
    $z = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 200, true, null, $h);
    assert($z[1]['hour'] === $h);
}

// --- Der Notausschalter liest zur LAUFZEIT aus der Konfiguration ------------------------------
// 💣 KEINE Konstante beim Einbinden. Genau daran haengt der Verdacht, dass der Schalter des
// Besucher-Moduls wirkungslos ist: dort wird die Konstante definiert, BEVOR config.local.php
// geladen ist, und ein `define(..., false)` dort kaeme zu spaet.
assert(avesmapsApiMetricsAktiv([]) === true, 'ohne Eintrag: an');
assert(avesmapsApiMetricsAktiv(['api_metrics' => ['enabled' => false]]) === false);
assert(avesmapsApiMetricsAktiv(['api_metrics' => ['enabled' => true]]) === true);

echo "OK: api-metrics-schluessel-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-schluessel-test.php
```

Erwartet: **Fehlschlag** mit `Failed opening required '.../api-metrics.php'` — die Bibliothek gibt
es noch nicht.

- [ ] **Schritt 3: Die Bibliothek anlegen**

Anlegen: `api/_internal/analytics/api-metrics.php`

```php
<?php

declare(strict_types=1);

/**
 * Zaehlwerk fuer die EINGEHENDE API-Nutzung.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
 *
 * Diese Datei enthaelt die reinen Abbildungen (Schluessel, Zone, Klasse, Zeilenbau) und die
 * Datenbankwege. Verdrahtet wird sie in api/_internal/bootstrap.php -- dort merkt sich
 * avesmapsJsonResponse den Status, und eine Abschlussroutine schreibt die Zeilen.
 */

// 💣 DER PLATZHALTER IST TRAGEND, ER IST KEINE KOSMETIK.
//
// Die Tabelle hat einen UNIQUE-Schluessel ueber (day, hour, metric, dimension), und `hour` ist bei
// zwei von drei Metriken bedeutungslos. Waere die Spalte NULL-faehig, wuerde ON DUPLICATE KEY
// UPDATE dort NIE greifen: nach dem SQL-Standard gelten zwei NULL als VERSCHIEDEN, MySQL erlaubt
// im UNIQUE-Index beliebig viele davon. Jede Anfrage legte dann eine NEUE Zeile an statt eine
// vorhandene hochzuzaehlen -- und weil der Lesepfad ohnehin `SUM(count) GROUP BY dimension`
// rechnet, waeren die angezeigten Zahlen trotzdem richtig. Der Fehler waere unsichtbar und nur an
// der Zeilenzahl zu erkennen.
//
// Gegenprobe, die das festhaelt: 3x dasselbe mit hour=NULL ergibt 3 Zeilen, mit hour=24 eine.
const AVESMAPS_API_METRICS_KEINE_STUNDE = 24;

/** Aufbewahrung. Aelteres wird faul beim Schreiben entfernt (es gibt keinen Zeitplan-Laeufer). */
const AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE = 400;

/**
 * 💣 Zur LAUFZEIT aus der Konfiguration, nicht als Konstante beim Einbinden.
 * Vorgabe „an": ein Betriebszaehler, der still aus ist, verfehlt seinen Zweck.
 */
function avesmapsApiMetricsAktiv(array $config): bool {
    $wert = $config['api_metrics']['enabled'] ?? true;
    return $wert !== false && $wert !== 0 && $wert !== '0';
}

/**
 * Aus SCRIPT_NAME, nie aus REQUEST_URI: `/api/app/map-features.php` -> `app/map-features`.
 *
 * 💣 REQUEST_URI traegt die Abfrageparameter mit. Das haette zwei Folgen, beide schlimm: eine neue
 * Zeile je Suchbegriff (die Tabelle wuechse mit dem Verkehr statt mit den Endpunkten), und
 * Suchbegriffe und Kennungen echter Besucher stuenden in einer Betriebstabelle.
 */
function avesmapsApiMetricsEndpunktSchluessel(string $scriptName): string {
    $pfad = strtok($scriptName, '?');
    if (!is_string($pfad) || $pfad === '') {
        return 'unbekannt';
    }
    $pfad = str_replace('\\', '/', $pfad);
    $stelle = strrpos($pfad, '/api/');
    if ($stelle === false) {
        return 'unbekannt';
    }
    $rest = substr($pfad, $stelle + 5);
    if (str_ends_with($rest, '.php')) {
        $rest = substr($rest, 0, -4);
    }
    $rest = trim($rest, '/');
    if ($rest === '' || !preg_match('/^[A-Za-z0-9_\/-]{1,180}$/', $rest)) {
        return 'unbekannt';
    }
    return $rest;
}

/**
 * Vier Zonen, und vier ist die Obergrenze: der Ring im Panel zeichnet sie als vier Segmente, und
 * vier Reihen ist die gerechnete Grenze der Projektpalette. Eine fuenfte Zone braucht erst eine
 * fuenfte Farbe.
 */
function avesmapsApiMetricsZone(string $schluessel): string {
    if (str_starts_with($schluessel, 'route/') || str_starts_with($schluessel, 'locations/')) {
        return 'offen';
    }
    if (str_starts_with($schluessel, 'app/')) {
        return 'app';
    }
    if (str_starts_with($schluessel, 'edit/')) {
        return 'edit';
    }
    return 'sonstige';
}

/**
 * 🔴 `$abgeschlossen` schlaegt den Statuscode. Ist die Anfrage nie durch avesmapsJsonResponse
 * gekommen, ist sie an einem Fatal Error, einem Speicherueberlauf oder einem Zeitlimit gestorben
 * -- und PHP meldet in diesem Zustand oft weiterhin 200. Der Code luegt dann; das Flag nicht.
 */
function avesmapsApiMetricsStatusKlasse(?int $status, bool $abgeschlossen): string {
    if (!$abgeschlossen) {
        return 'leer';
    }
    $hundert = (int) floor(((int) $status) / 100);
    return match ($hundert) {
        2 => '2xx',
        3 => '3xx',
        4 => '4xx',
        5 => '5xx',
        default => 'leer',
    };
}

/** Geschlossenes Vokabular -- alles andere wird eingesammelt, statt die Dimension aufzublaehen. */
function avesmapsApiMetricsFehlerCode(mixed $code): string {
    if (!is_string($code) || !preg_match('/^[a-z0-9_]{1,40}$/', $code)) {
        return 'sonstiger_code';
    }
    return $code;
}

/**
 * Baut die Zeilen einer Anfrage. Rein -- kein $_SERVER, keine Uhr, keine Datenbank; alles kommt
 * als Argument. Genau deshalb ist die ganze interessante Logik pruefbar, ohne eine Datenbank
 * anzufassen.
 *
 * @return list<array{metric: string, dimension: string, hour: int}>
 */
function avesmapsApiMetricsZeilenFuerAnfrage(
    string $scriptName,
    ?int $status,
    bool $abgeschlossen,
    ?string $fehlerCode,
    int $utcStunde
): array {
    $schluessel = avesmapsApiMetricsEndpunktSchluessel($scriptName);
    $klasse = avesmapsApiMetricsStatusKlasse($status, $abgeschlossen);
    $stunde = max(0, min(23, $utcStunde));

    $zeilen = [
        ['metric' => 'antwort', 'dimension' => $schluessel . '|' . $klasse, 'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE],
        ['metric' => 'stunde', 'dimension' => '', 'hour' => $stunde],
    ];

    if ($klasse === 'leer') {
        // Der Fatal Error hat keinen Fehlercode -- er ist ja nie beim Antworten angekommen.
        $zeilen[] = ['metric' => 'fehler', 'dimension' => $schluessel . '|fatal', 'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE];
    } elseif ($klasse === '4xx' || $klasse === '5xx') {
        $zeilen[] = [
            'metric' => 'fehler',
            'dimension' => $schluessel . '|' . avesmapsApiMetricsFehlerCode($fehlerCode),
            'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE,
        ];
    }

    return $zeilen;
}

function avesmapsApiMetricsEnsureTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS api_metric (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            day DATE NOT NULL,
            hour TINYINT UNSIGNED NOT NULL DEFAULT 24,
            metric VARCHAR(40) NOT NULL,
            dimension VARCHAR(190) NOT NULL DEFAULT '',
            count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uq_api_metric (day, hour, metric, dimension),
            KEY idx_api_metric_metric (metric, day)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}
```

- [ ] **Schritt 4: Test laufen lassen und den Erfolg sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-schluessel-test.php
```

Erwartet: `OK: api-metrics-schluessel-test`, Exit 0.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/analytics/api-metrics.php api/_internal/analytics/__tests__/api-metrics-schluessel-test.php
git commit -m "feat(api-nutzung): Zaehlbibliothek -- Schluessel, Zonen, Klassen, Zeilenbau"
```

---

## Aufgabe 2: Die PDO-Merkstelle in `bootstrap.php`

Der Schreiber sitzt in `bootstrap.php` und hat dort keine Datenbankverbindung — die legt jeder
Endpunkt selbst an. Eine **zweite** Verbindung je Anfrage wäre auf einem Shared-Hosting teuer.
Also merkt sich `avesmapsCreatePdo` ihre Rückgabe.

**Dateien:**
- Ändern: `api/_internal/bootstrap.php` (in `avesmapsCreatePdo`, ab Zeile 194)
- Test: `api/_internal/__tests__/letzte-verbindung-test.php`

**Schnittstellen:**
- Verbraucht: nichts.
- Liefert: `avesmapsLetzteDatenbankverbindung(): ?PDO`

⚠️ **Die Signatur von `avesmapsCreatePdo` bleibt unverändert.** Es gibt bereits
`api/_internal/__tests__/create-pdo-argument-test.php`, der festhält, dass jeder Aufrufer den
Datenbank-**Teilbaum** übergibt. Diese Aufgabe ändert nur das Innere.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `api/_internal/__tests__/letzte-verbindung-test.php`

```php
<?php

declare(strict_types=1);

/**
 * avesmapsCreatePdo merkt sich ihre Rueckgabe, damit die Abschlussroutine in bootstrap.php nicht
 * eine ZWEITE Verbindung je Anfrage aufmachen muss.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/__tests__/letzte-verbindung-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "UEBERSPRUNGEN: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(0);
}

require __DIR__ . '/../bootstrap.php';

// Vor dem ersten Verbindungsaufbau gibt es nichts zu merken.
assert(avesmapsLetzteDatenbankverbindung() === null, 'anfangs leer');

$pdo = avesmapsCreatePdo([
    'driver' => 'sqlite',
    'host' => 'x', 'port' => '0', 'name' => ':memory:', 'user' => 'x', 'password' => '',
]);

// 🔴 Dieselbe INSTANZ, keine Kopie -- eine zweite Verbindung waere genau das, was das hier
// vermeiden soll.
assert(avesmapsLetzteDatenbankverbindung() === $pdo, 'gemerkt wird die Instanz selbst');

echo "OK: letzte-verbindung-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/__tests__/letzte-verbindung-test.php
```

Erwartet: **Fehlschlag** mit `Call to undefined function avesmapsLetzteDatenbankverbindung()`.

- [ ] **Schritt 3: `bootstrap.php` erweitern**

`avesmapsCreatePdo` endet heute mit `return new PDO(...)` (Zeile ~213). Diesen Abschluss ersetzen:

```php
    $verbindung = new PDO(
        $dsn,
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );

    // Fuer den API-Zaehler am Ende der Anfrage: er sitzt in dieser Datei und haette sonst keine
    // Verbindung -- eine ZWEITE je Anfrage waere auf dem Shared-Hosting spuerbar.
    avesmapsMerkeDatenbankverbindung($verbindung);

    return $verbindung;
}

/**
 * Die zuletzt von avesmapsCreatePdo erzeugte Verbindung, oder null, wenn diese Anfrage noch keine
 * gebraucht hat. Bewusst „die letzte" und nicht „eine Sammlung": im Haus erzeugt eine Anfrage
 * entweder keine oder eine Verbindung auf dieselbe Datenbank.
 */
function avesmapsMerkeDatenbankverbindung(?PDO $verbindung): void {
    static $gemerkt = null;
    if ($verbindung !== null) {
        $gemerkt = $verbindung;
    }
    $GLOBALS['avesmapsLetztePdo'] = $gemerkt;
}

function avesmapsLetzteDatenbankverbindung(): ?PDO {
    $wert = $GLOBALS['avesmapsLetztePdo'] ?? null;
    return $wert instanceof PDO ? $wert : null;
}
```

- [ ] **Schritt 4: Beide Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/__tests__/letzte-verbindung-test.php
```
Erwartet: `OK: letzte-verbindung-test`.

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/create-pdo-argument-test.php
```
Erwartet: weiterhin grün — die Signatur wurde nicht angefasst.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/bootstrap.php api/_internal/__tests__/letzte-verbindung-test.php
git commit -m "feat(api-nutzung): avesmapsCreatePdo merkt sich ihre Verbindung fuer den Zaehler"
```

---

## Aufgabe 3: Der Schreiber — Statusmerker und Abschlussroutine

**Dateien:**
- Ändern: `api/_internal/bootstrap.php` (`avesmapsJsonResponse`, Zeile 164–173; neue Funktionen ans Dateiende)
- Ergänzen: `api/_internal/analytics/api-metrics.php` (Schreiben und Aufräumen)
- Test: `api/_internal/analytics/__tests__/api-metrics-schreiber-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsApiMetricsZeilenFuerAnfrage`, `avesmapsApiMetricsEnsureTable`,
  `avesmapsApiMetricsAktiv` (Aufgabe 1); `avesmapsLetzteDatenbankverbindung` (Aufgabe 2)
- Liefert:
  - `avesmapsApiMetricsMerkeAntwort(int $status, ?string $fehlerCode): void`
  - `avesmapsApiMetricsRegistrieren(): void`
  - `avesmapsApiMetricsSchreiben(PDO $pdo, array $zeilen): void`
  - `avesmapsApiMetricsAufraeumen(PDO $pdo): void`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `api/_internal/analytics/__tests__/api-metrics-schreiber-test.php`

```php
<?php

declare(strict_types=1);

/**
 * Der Schreiber: eine Anweisung je Anfrage, und er wirft NIEMALS nach aussen.
 *
 * 🔴 WARUM HIER SQLITE STEHT UND WAS DAS NICHT BEDEUTET. Die Produktionsanweisung ist MySQLs
 * `INSERT ... ON DUPLICATE KEY UPDATE`; SQLite kennt das nicht. Dieser Test biegt sie deshalb
 * NICHT zurecht -- das waere die Falle aus AGENTS.md (ein SQLite-Test, der eine MySQL-Regression
 * erzwingt). Er nutzt SQLite ausschliesslich als „eine Datenbank, die wirft", um die Zusicherung
 * zu pruefen, auf die es ankommt: dass der Zaehler seinen Fehler fuer sich behaelt. Die
 * Zusammensetzung der Zeilen prueft api-metrics-schluessel-test.php ohne jede Datenbank.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/analytics/__tests__/api-metrics-schreiber-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "UEBERSPRUNGEN: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(0);
}

require __DIR__ . '/../api-metrics.php';

// --- 🔴 Der Zaehler darf einen Fehler NIE nach aussen tragen -----------------------------------
// Er laeuft am Ende JEDER Anfrage, auch der bereits gescheiterten. Eine Ausnahme aus ihm wuerde
// einen echten Fehler ueberschreiben oder eine gesunde Antwort nachtraeglich zerstoeren.
// Die Tabelle gibt es hier absichtlich nicht -- die Anweisung MUSS scheitern.
$ohneTabelle = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$zeilen = avesmapsApiMetricsZeilenFuerAnfrage('/api/app/coat.php', 500, true, 'server_error', 12);

$geworfen = false;
try {
    avesmapsApiMetricsSchreiben($ohneTabelle, $zeilen);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'der Schreiber schweigt, wenn die Datenbank zickt');

// Dasselbe fuer das Aufraeumen -- es laeuft am selben Ort und unter derselben Regel.
$geworfen = false;
try {
    avesmapsApiMetricsAufraeumen($ohneTabelle);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'das Aufraeumen schweigt ebenfalls');

// Eine leere Zeilenliste ist kein Grund, ueberhaupt etwas zu schicken.
$geworfen = false;
try {
    avesmapsApiMetricsSchreiben($ohneTabelle, []);
} catch (Throwable $fehler) {
    $geworfen = true;
}
assert($geworfen === false, 'leere Liste: nichts passiert');

// --- Die Anweisung ist EINE, nicht drei ---------------------------------------------------------
// 💣 Drei Zeilen duerfen nicht drei Rundreisen zur Datenbank kosten -- der Zaehler liegt auf dem
// kritischen Pfad (fastcgi_finish_request gibt es auf STRATO nicht). Geprueft am Quelltext, weil
// SQLite die MySQL-Anweisung nicht ausfuehren kann.
$quelle = file_get_contents(__DIR__ . '/../api-metrics.php');
$schreiber = substr($quelle, strpos($quelle, 'function avesmapsApiMetricsSchreiben'));
$schreiber = substr($schreiber, 0, strpos($schreiber, "\n}") + 2);
assert(substr_count($schreiber, '->prepare(') === 1, 'genau eine vorbereitete Anweisung');
assert(substr_count($schreiber, '->execute(') === 1, 'genau eine Ausfuehrung');
assert(str_contains($schreiber, 'ON DUPLICATE KEY UPDATE'), 'MySQL-Aufwaertszaehlung, nicht wegvereinfacht');
assert(str_contains($schreiber, 'count = count + 1'), 'jede eingefuegte Zeile traegt count=1');

echo "OK: api-metrics-schreiber-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/analytics/__tests__/api-metrics-schreiber-test.php
```

Erwartet: **Fehlschlag** mit `Call to undefined function avesmapsApiMetricsSchreiben()`.

- [ ] **Schritt 3: Schreiben und Aufräumen in die Bibliothek**

An `api/_internal/analytics/api-metrics.php` anhängen:

```php
/**
 * Schreibt alle Zeilen einer Anfrage in EINER Anweisung.
 *
 * 💣 EINE Rundreise, nicht drei. Der Zaehler laeuft am Ende der Anfrage, und auf diesem Server
 * wartet der Benutzer darauf: `fastcgi_finish_request` gibt es auf STRATO nicht (SAPI cgi-fcgi,
 * gemessen 24.08.2026), frueh abschliessen traegt auch sonst nicht.
 *
 * ⚠️ `count = count + 1` und nicht `count + VALUES(count)`: jede eingefuegte Zeile traegt count=1,
 * also ist die einfache Form richtig -- und sie kommt ohne das in MySQL 8.0.20 abgekuendigte
 * VALUES() aus.
 *
 * 🔴 Das try/catch ist die Zusicherung, nicht die Bequemlichkeit: diese Funktion darf niemals
 * werfen. Sie laeuft am Ende JEDER Anfrage, auch einer bereits gescheiterten.
 */
function avesmapsApiMetricsSchreiben(PDO $pdo, array $zeilen): void {
    if ($zeilen === []) {
        return;
    }
    try {
        $platzhalter = implode(', ', array_fill(0, count($zeilen), '(UTC_DATE(), ?, ?, ?, 1)'));
        $anweisung = $pdo->prepare(
            'INSERT INTO api_metric (day, hour, metric, dimension, count) VALUES '
            . $platzhalter
            . ' ON DUPLICATE KEY UPDATE count = count + 1'
        );
        $werte = [];
        foreach ($zeilen as $zeile) {
            $werte[] = (int) $zeile['hour'];
            $werte[] = substr((string) $zeile['metric'], 0, 40);
            $werte[] = substr((string) $zeile['dimension'], 0, 190);
        }
        $anweisung->execute($werte);
    } catch (Throwable $fehler) {
        // Absicht: siehe oben. Ein stummer Zaehler ist im Panel an `letzte_zaehlung` erkennbar.
    }
}

/**
 * Faules Aufraeumen: es gibt keinen Zeitplan-Laeufer auf STRATO.
 *
 * ⚠️ Hoechstens einmal am Tag, erkannt an einer Markerzeile in derselben Tabelle -- sonst zahlte
 * jede Anfrage ein DELETE. Die Markerzeile ist eine gewoehnliche Metrikzeile und faellt beim Lesen
 * durch den Metrikfilter heraus.
 */
function avesmapsApiMetricsAufraeumen(PDO $pdo): void {
    try {
        $marke = $pdo->prepare(
            "INSERT INTO api_metric (day, hour, metric, dimension, count)
             VALUES (UTC_DATE(), ?, 'aufraeumen', '', 1)
             ON DUPLICATE KEY UPDATE count = count + 1"
        );
        $marke->execute([AVESMAPS_API_METRICS_KEINE_STUNDE]);
        if ($marke->rowCount() !== 1) {
            // rowCount() == 1 heisst „neu eingefuegt", 2 heisst „hochgezaehlt" (MySQL-Eigenart).
            // Nur beim ersten Mal am Tag wird geraeumt.
            return;
        }
        $pdo->exec(
            'DELETE FROM api_metric WHERE day < UTC_DATE() - INTERVAL '
            . AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE . ' DAY'
        );
    } catch (Throwable $fehler) {
        // Absicht: dieselbe Regel wie beim Schreiben.
    }
}
```

- [ ] **Schritt 4: Test laufen lassen und den Erfolg sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/analytics/__tests__/api-metrics-schreiber-test.php
```

Erwartet: `OK: api-metrics-schreiber-test`.

- [ ] **Schritt 5: Die Verdrahtung in `bootstrap.php`**

`avesmapsJsonResponse` (Zeile 164–173) so ersetzen:

```php
function avesmapsJsonResponse(int $statusCode, array $payload = []): never {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    // Der API-Zaehler schreibt NICHT hier, sondern in der Abschlussroutine -- nur so wird auch die
    // Anfrage gezaehlt, die diese Funktion nie erreicht (Fatal Error, leerer Rumpf). Hier wird nur
    // hinterlegt, WAS geantwortet wurde. Der Fehlercode steht bereits im Rumpf, den
    // avesmapsErrorResponse gebaut hat -- er muss nicht durchgereicht werden.
    if (function_exists('avesmapsApiMetricsMerkeAntwort')) {
        $code = $payload['error']['code'] ?? null;
        avesmapsApiMetricsMerkeAntwort($statusCode, is_string($code) ? $code : null);
    }

    if ($statusCode !== 204) {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    exit;
}
```

Ans **Ende** von `api/_internal/bootstrap.php` anhängen:

```php
// --- Der API-Zaehler -------------------------------------------------------------------------
// Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
require_once __DIR__ . '/analytics/api-metrics.php';

/**
 * Hinterlegt, was geantwortet wurde. Geschrieben wird erst in der Abschlussroutine.
 */
function avesmapsApiMetricsMerkeAntwort(int $status, ?string $fehlerCode): void {
    $GLOBALS['avesmapsApiMetricsAntwort'] = ['status' => $status, 'code' => $fehlerCode];
}

/**
 * 💣 DER WAECHTER IST PFLICHT. bootstrap.php wird an 52 Stellen mit `require` (nicht
 * `require_once`) eingebunden. Dass heute nichts doppelt laedt, ist Praxis, keine Zusicherung --
 * und zwei Registrierungen zaehlten jede Anfrage doppelt. Das saehe nach mehr Verkehr aus, nicht
 * nach einem Fehler, und niemand wuerde es bemerken.
 */
function avesmapsApiMetricsRegistrieren(): void {
    if (defined('AVESMAPS_API_METRICS_REGISTRIERT')) {
        return;
    }
    define('AVESMAPS_API_METRICS_REGISTRIERT', true);

    register_shutdown_function(static function (): void {
        try {
            $antwort = $GLOBALS['avesmapsApiMetricsAntwort'] ?? null;
            $abgeschlossen = is_array($antwort);

            $pdo = avesmapsLetzteDatenbankverbindung();
            if ($pdo === null) {
                // Diese Anfrage hat gar keine Datenbank gebraucht. Selbst eine zu oeffnen ist der
                // einzige Punkt, an dem der Zaehler etwas kostet, was die Anfrage sonst nicht
                // gebraucht haette -- deshalb bekommt der Fall eine eigene Dimension und misst
                // sich selbst. Ohne Konfiguration geht auch das nicht; dann wird geschwiegen.
                $config = $GLOBALS['avesmapsApiMetricsConfig'] ?? null;
                if (!is_array($config)) {
                    return;
                }
                $pdo = avesmapsCreatePdo($config['database'] ?? []);
                $ohneVerbindung = true;
            } else {
                $ohneVerbindung = false;
            }

            $zeilen = avesmapsApiMetricsZeilenFuerAnfrage(
                (string) ($_SERVER['SCRIPT_NAME'] ?? ''),
                $abgeschlossen ? (int) $antwort['status'] : null,
                $abgeschlossen,
                $abgeschlossen ? ($antwort['code'] ?? null) : null,
                (int) gmdate('G')
            );
            if ($ohneVerbindung) {
                $zeilen[] = [
                    'metric' => 'antwort',
                    'dimension' => 'ohne_verbindung|' . ($abgeschlossen ? 'ja' : 'leer'),
                    'hour' => AVESMAPS_API_METRICS_KEINE_STUNDE,
                ];
            }

            avesmapsApiMetricsEnsureTable($pdo);
            avesmapsApiMetricsSchreiben($pdo, $zeilen);
            avesmapsApiMetricsAufraeumen($pdo);
        } catch (Throwable $fehler) {
            // Die Abschlussroutine darf unter keinen Umstaenden etwas nach aussen tragen.
        }
    });
}
```

Und in `avesmapsLoadApiConfig` (Zeile 20) direkt vor jedem `return $config;` die Konfiguration
hinterlegen und den Zähler starten — die Funktion hat **zwei** Rückgabestellen mit einem
gefundenen Array (Zeile ~29 und der Umgebungszweig); beide bekommen dieselben zwei Zeilen:

```php
            $GLOBALS['avesmapsApiMetricsConfig'] = $config;
            if (avesmapsApiMetricsAktiv($config)) {
                avesmapsApiMetricsRegistrieren();
            }
            return $config;
```

- [ ] **Schritt 6: Das ganze Testfeld laufen lassen**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```

Erwartet: nur `linkcheck/link-url-test.php` rot (vorbestehend, echter DNS-Abruf). ⚠️ Diese Aufgabe
fasst `bootstrap.php` an — die Datei, die **jeder** Endpunkt lädt. Ein roter Test irgendwo anders
ist hier kein Zufall, sondern der Beweis, dass die Änderung etwas gebrochen hat.

- [ ] **Schritt 7: Committen**

```bash
git add api/_internal/bootstrap.php api/_internal/analytics/api-metrics.php api/_internal/analytics/__tests__/api-metrics-schreiber-test.php
git commit -m "feat(api-nutzung): der Zaehler laeuft -- eine Anweisung am Ende jeder Anfrage"
```

🔴 **Diese Aufgabe geht ALLEIN live** (Entwurf §12 Schritt 1). Sie ändert nichts Sichtbares, aber
sie fasst `bootstrap.php` an; wenn sie etwas bricht, bricht sie alles. Nach dem Push: den
Workflow-Lauf prüfen (`gh run list --limit 3`) **und** einen echten Endpunkt anfassen, etwa
`https://avesmaps.de/api/app/map-revision.php` — er muss unverändert antworten.

⚠️ Danach ein bis zwei Tage laufen lassen, bevor Aufgabe 5 gebaut wird. Dann zeigt die Oberfläche
beim Fertigwerden echte Zahlen statt einer leeren Tafel — und man sieht am Bestand, ob die
Kardinalität stimmt.

---

## Aufgabe 4: Der Leser in der Bibliothek

**Dateien:**
- Ändern: `api/_internal/analytics/api-metrics.php` (anhängen)
- Test: `api/_internal/analytics/__tests__/api-metrics-lesen-test.php`

**Schnittstellen:**
- Verbraucht: `AVESMAPS_API_METRICS_KEINE_STUNDE`, `avesmapsApiMetricsZone` (Aufgabe 1)
- Liefert:
  - `avesmapsApiMetricsTageGrenze(mixed $tage): int`
  - `avesmapsApiMetricsAufteilen(array $zeilen): array` — formt die rohen `antwort`-Zeilen zu
    `['endpunkte' => [...], 'klassen' => [...], 'zonen' => [...]]`
  - `avesmapsApiMetricsLesen(PDO $pdo, int $tage): array`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `api/_internal/analytics/__tests__/api-metrics-lesen-test.php`

```php
<?php

declare(strict_types=1);

/**
 * Der Lesepfad: Zeitraumschranken und das Aufteilen der rohen `antwort`-Zeilen auf die drei
 * Karten (Endpunkte, Klassen, Zonen).
 *
 * ⚠️ Die SQL selbst ist nur angemeldet gegen MySQL pruefbar -- eine unangemeldete Probe endet am
 * edit-Riegel. Deshalb steht die ganze Formung hier in einer reinen Funktion, die ohne Datenbank
 * geprueft wird, und avesmapsApiMetricsLesen holt nur die Zeilen.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-lesen-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../api-metrics.php';

// --- Die Zeitraumschranke ----------------------------------------------------------------------
assert(avesmapsApiMetricsTageGrenze(7) === 7);
assert(avesmapsApiMetricsTageGrenze('30') === 30);
assert(avesmapsApiMetricsTageGrenze(0) === 1, 'unter 1 wird 1');
assert(avesmapsApiMetricsTageGrenze(-5) === 1);
assert(avesmapsApiMetricsTageGrenze(99999) === 400, 'nie ueber die Aufbewahrung hinaus');
assert(avesmapsApiMetricsTageGrenze('keine Zahl') === 1);

// --- Das Aufteilen -----------------------------------------------------------------------------
$roh = [
    ['dimension' => 'app/map-features|2xx', 'c' => 100],
    ['dimension' => 'app/map-features|5xx', 'c' => 5],
    ['dimension' => 'route/index|2xx', 'c' => 20],
    ['dimension' => 'edit/map/features|leer', 'c' => 3],
    ['dimension' => 'kaputt-ohne-trenner', 'c' => 9],
];
$auf = avesmapsApiMetricsAufteilen($roh);

// Endpunkte: ueber die Klassen summiert, absteigend.
assert($auf['endpunkte'][0] === ['dimension' => 'app/map-features', 'c' => 105]);
assert($auf['endpunkte'][1] === ['dimension' => 'route/index', 'c' => 20]);
assert($auf['endpunkte'][2] === ['dimension' => 'edit/map/features', 'c' => 3]);

// Klassen: ueber die Endpunkte summiert.
$klassen = [];
foreach ($auf['klassen'] as $zeile) {
    $klassen[$zeile['dimension']] = $zeile['c'];
}
assert($klassen['2xx'] === 120);
assert($klassen['5xx'] === 5);
assert($klassen['leer'] === 3, 'die leeren Antworten sind eine eigene Klasse');

// Zonen: aus dem Endpunktschluessel abgeleitet, NICHT gespeichert -- zwei Speicherorte fuer
// dieselbe Aussage laufen auseinander.
$zonen = [];
foreach ($auf['zonen'] as $zeile) {
    $zonen[$zeile['dimension']] = $zeile['c'];
}
assert($zonen['app'] === 105);
assert($zonen['offen'] === 20);
assert($zonen['edit'] === 3);

// 🪤 Eine Zeile ohne Trenner darf nichts umbringen und nichts erfinden.
assert(!isset($zonen['kaputt-ohne-trenner']), 'unbrauchbare Zeilen fallen heraus');
assert(count($auf['endpunkte']) === 3, 'und tauchen auch bei den Endpunkten nicht auf');

echo "OK: api-metrics-lesen-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-lesen-test.php
```

Erwartet: **Fehlschlag** mit `Call to undefined function avesmapsApiMetricsTageGrenze()`.

- [ ] **Schritt 3: Den Leser anhängen**

An `api/_internal/analytics/api-metrics.php` anhängen:

```php
function avesmapsApiMetricsTageGrenze(mixed $tage): int {
    $zahl = is_numeric($tage) ? (int) $tage : 1;
    return max(1, min(AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE, $zahl));
}

/**
 * Formt die rohen `antwort`-Zeilen (`<endpunkt>|<klasse>`) zu den drei Karten.
 *
 * 🔴 Die Zone wird hier ABGELEITET und nicht gespeichert: zwei Speicherorte fuer dieselbe Aussage
 * laufen auseinander, sobald jemand die Zonenregel aendert und die Altdaten stehen laesst.
 */
function avesmapsApiMetricsAufteilen(array $zeilen): array {
    $endpunkte = [];
    $klassen = [];
    $zonen = [];

    foreach ($zeilen as $zeile) {
        $dimension = (string) ($zeile['dimension'] ?? '');
        $anzahl = (int) ($zeile['c'] ?? 0);
        $trenner = strrpos($dimension, '|');
        if ($trenner === false || $trenner === 0) {
            continue;
        }
        $schluessel = substr($dimension, 0, $trenner);
        $klasse = substr($dimension, $trenner + 1);

        $endpunkte[$schluessel] = ($endpunkte[$schluessel] ?? 0) + $anzahl;
        $klassen[$klasse] = ($klassen[$klasse] ?? 0) + $anzahl;
        $zone = avesmapsApiMetricsZone($schluessel);
        $zonen[$zone] = ($zonen[$zone] ?? 0) + $anzahl;
    }

    $alsListe = static function (array $karte): array {
        arsort($karte);
        $liste = [];
        foreach ($karte as $dimension => $anzahl) {
            $liste[] = ['dimension' => (string) $dimension, 'c' => $anzahl];
        }
        return $liste;
    };

    return [
        'endpunkte' => $alsListe($endpunkte),
        'klassen' => $alsListe($klassen),
        'zonen' => $alsListe($zonen),
    ];
}

/**
 * ⚠️ JEDE Abfrage bekommt ihren EIGENEN catch. Ein gemeinsamer riss beim Besucher-Modul zwei
 * gesunde Abfragen mit, weil eine dritte einen MySQL-Fehler 1247 warf -- die Karte stand leer da,
 * obwohl die Daten stimmten.
 *
 * 💣 Und deshalb steht in keiner dieser Abfragen ein Aggregat-ALIAS in HAVING oder ORDER BY: genau
 * das ist Fehler 1247. Wo sortiert wird, steht der rohe SUM()-Ausdruck noch einmal.
 */
function avesmapsApiMetricsLesen(PDO $pdo, int $tage): array {
    $tage = avesmapsApiMetricsTageGrenze($tage);
    $keineStunde = AVESMAPS_API_METRICS_KEINE_STUNDE;

    $holen = static function (string $sql, array $werte) use ($pdo): array {
        try {
            $anweisung = $pdo->prepare($sql);
            $anweisung->execute($werte);
            return $anweisung->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $fehler) {
            return [];
        }
    };

    $antwortZeilen = $holen(
        "SELECT dimension, SUM(count) AS c FROM api_metric
         WHERE metric = 'antwort' AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY dimension
         ORDER BY SUM(count) DESC
         LIMIT 400",
        [$tage]
    );

    $fehlerZeilen = $holen(
        "SELECT dimension, SUM(count) AS c FROM api_metric
         WHERE metric = 'fehler' AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY dimension
         ORDER BY SUM(count) DESC
         LIMIT 20",
        [$tage]
    );

    // 💣 DIE SPALTE HEISST `hour` UND DARF NICHT UMBENANNT WERDEN. Der vorhandene Zeichner
    // vaHeatmapGrid (js/review/review-visitor-analytics.js:156) liest `r.dow`, `r.hour` und `r.c`.
    // Ein Alias `hour AS h` waere kein Schoenheitsfehler: `Number(undefined) || 0` ergibt 0, alle
    // Zellen landeten in Stunde 0, und die Karte zeigte einen soliden Streifen, der auf den ersten
    // Blick wie ein Befund aussieht statt wie ein Fehler.
    $stundenZeilen = $holen(
        "SELECT DAYOFWEEK(day) AS dow, hour, SUM(count) AS c FROM api_metric
         WHERE metric = 'stunde' AND hour < ? AND day >= UTC_DATE() - INTERVAL ? DAY
         GROUP BY DAYOFWEEK(day), hour",
        [$keineStunde, $tage]
    );

    // 🪤 Der Beleg dafuer, dass ueberhaupt noch gezaehlt wird. Entzieht STRATO bei voller Quote die
    // Schreibrechte, verschluckt der Schreiber den Fehler pflichtgemaess -- und leere Balken sind
    // von „keine Anfragen" nicht zu unterscheiden. Das Panel sagt es deshalb ausdruecklich.
    $letzte = $holen("SELECT MAX(day) AS tag FROM api_metric WHERE metric = 'antwort'", []);

    $aufgeteilt = avesmapsApiMetricsAufteilen($antwortZeilen);
    $aufgeteilt['fehler'] = $fehlerZeilen;
    $aufgeteilt['stunden'] = $stundenZeilen;
    $aufgeteilt['letzte_zaehlung'] = $letzte[0]['tag'] ?? null;

    return $aufgeteilt;
}

/** Groesse der eigenen Tabelle, fuer die Karte „Die Tafel selbst". */
function avesmapsApiMetricsSpeicher(PDO $pdo): array {
    try {
        // ⚠️ `rows` ist in MySQL 8 ein reserviertes Wort und MUSS in Graviszeichen stehen -- ohne
        // sie wirft die Abfrage einen Syntaxfehler und reisst den ganzen Lesevorgang mit.
        $zeilen = $pdo->query(
            "SELECT table_name AS t, table_rows AS `rows`, data_length + index_length AS bytes
             FROM information_schema.TABLES
             WHERE table_schema = DATABASE() AND table_name = 'api_metric'"
        )->fetchAll(PDO::FETCH_ASSOC);
        return ['tables' => $zeilen];
    } catch (Throwable $fehler) {
        return ['tables' => []];
    }
}
```

- [ ] **Schritt 4: Test laufen lassen und den Erfolg sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-lesen-test.php
```

Erwartet: `OK: api-metrics-lesen-test`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/analytics/api-metrics.php api/_internal/analytics/__tests__/api-metrics-lesen-test.php
git commit -m "feat(api-nutzung): Lesepfad -- Zeitraumschranke, Aufteilung, Speicherangabe"
```

---

## Aufgabe 5: Der Leseendpunkt

**Dateien:**
- Anlegen: `api/app/api-metrics.php`
- Test: `api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsApiMetricsLesen`, `avesmapsApiMetricsSpeicher`,
  `avesmapsApiMetricsEnsureTable`, `avesmapsApiMetricsAktiv`
- Liefert: `GET /api/app/api-metrics.php?days=N` →
  `{ ok, enabled, days, letzte_zaehlung, metrics: { endpunkte, klassen, zonen, fehler, stunden }, storage }`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php`

```php
<?php

declare(strict_types=1);

/**
 * Der Leseendpunkt, am Quelltext geprueft.
 *
 * ⚠️ WARUM AM QUELLTEXT: der Endpunkt beendet sich selbst (avesmapsRequireUserWithCapability EXITet,
 * avesmapsJsonResponse ist `: never`) und braucht eine Sitzung samt Datenbank. Ein Ausfuehren im
 * Test ginge nicht. Geprueft wird deshalb, was ohne Sitzung pruefbar ist -- und das sind genau die
 * Fehler, die das Besucher-Modul zweimal gekostet haben.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$quelle = file_get_contents(__DIR__ . '/../../../app/api-metrics.php');
assert(is_string($quelle) && $quelle !== '', 'api/app/api-metrics.php existiert');

// 🔴 Der Riegel. Ohne ihn stehen Betriebszahlen offen im Netz.
assert(str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"), 'edit-Riegel vorhanden');

// 💣 Helfer brauchen ihre Argumente. Beim Besucher-Modul war genau das eine wiederkehrende
// Fehlerquelle, und `avesmapsCreatePdo($config)` statt `$config['database']` kostete dem
// Tempowerte-Fenster jede einzelne Ladung -- die Funktion nimmt ein Array, PHP beschwert sich
// nicht, und drinnen ist alles leer.
assert(str_contains($quelle, 'avesmapsApplyCorsPolicy($config)'), 'CORS mit Argument');
assert(preg_match('/avesmapsCreatePdo\(\s*\$config\[.database.\]/', $quelle) === 1, 'PDO mit Teilbaum');

// Der Endpunkt macht kein DDL ausserhalb seiner eigenen Tabelle und faellt bei abgeschaltetem
// Zaehler sauber aus.
assert(str_contains($quelle, 'avesmapsApiMetricsAktiv($config)'), 'Notausschalter beachtet');
assert(str_contains($quelle, "'enabled' => false"), 'abgeschaltet wird gemeldet, nicht geschwiegen');

// 💣 Kein getMessage() nach draussen (Informationsabfluss, Meilenstein M1).
assert(!str_contains($quelle, 'getMessage()'), 'keine Ausnahmetexte an den Client');

echo "OK: api-metrics-endpunkt-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php
```

Erwartet: **Fehlschlag** an der ersten Zusicherung — die Datei gibt es nicht.

- [ ] **Schritt 3: Den Endpunkt anlegen**

Anlegen: `api/app/api-metrics.php`

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/api-metrics.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden', 'Origin not allowed.');
    }

    // 🔴 Derselbe Riegel wie bei den Besucherzahlen: Betriebsdaten gehen niemanden sonst an.
    avesmapsRequireUserWithCapability('edit');

    if (!avesmapsApiMetricsAktiv($config)) {
        avesmapsJsonResponse(200, ['ok' => true, 'enabled' => false]);
    }

    $tage = avesmapsApiMetricsTageGrenze($_GET['days'] ?? 7);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsApiMetricsEnsureTable($pdo);

    $gelesen = avesmapsApiMetricsLesen($pdo, $tage);
    $letzte = $gelesen['letzte_zaehlung'] ?? null;
    unset($gelesen['letzte_zaehlung']);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'enabled' => true,
        'days' => $tage,
        // 🪤 Der Beleg, dass ueberhaupt gezaehlt wird. Ohne ihn ist „der Zaehler schreibt nicht
        // mehr" von „es kamen keine Anfragen" nicht zu unterscheiden.
        'letzte_zaehlung' => $letzte,
        'metrics' => $gelesen,
        'storage' => avesmapsApiMetricsSpeicher($pdo),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'API statistics could not be loaded.');
}
```

- [ ] **Schritt 4: Test laufen lassen und den Erfolg sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php
php -l api/app/api-metrics.php
```

Erwartet: `OK: api-metrics-endpunkt-test` und `No syntax errors detected`.

- [ ] **Schritt 5: Committen**

```bash
git add api/app/api-metrics.php api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php
git commit -m "feat(api-nutzung): Leseendpunkt api/app/api-metrics.php, edit-gesichert"
```

---

## Aufgabe 6: Der Unterreiter und die sechs Karten

**Dateien:**
- Anlegen: `js/review/review-api-metrics.js`
- Ändern: `js/review/review-status.js:1-24` (dritter Zweig)
- Ändern: `index.html:741-743` (Reiterknöpfe), `index.html:753` (neuer Abschnitt),
  `index.html:3258` (Skript nach `review-visitor-analytics.js`)
- Ändern: `css/components/visitor-analytics.css` (drei neue Bauteile ans Ende)
- Test: `js/review/__tests__/api-metrics-render.test.js`

**Schnittstellen:**
- Verbraucht: `GET /api/app/api-metrics.php` (Aufgabe 5); die vorhandenen `vaEscape`, `vaBars`,
  `vaBytes`, `vaLocalHourShift`, `vaHeatmapGrid` aus `review-visitor-analytics.js` (dieselbe
  Dokumentumgebung, keine Module).
- Liefert: `renderApiDashboard(mount, data)`, `loadApiDashboard()`, `apiEscape(wert)`,
  `apiKlassenBalken(klassen)`, `apiZaehlstandSatz(letzteZaehlung)`, `apiEndpunktKarte(endpunkte)`,
  `apiFehlerKarte(fehler)`, `apiZonenKarte(zonen)`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Anlegen: `js/review/__tests__/api-metrics-render.test.js`

```javascript
// 🪤 Kein "use strict": in strict mode bekommt eval() seinen EIGENEN Variablenraum, die unten
// herausgeschnittenen Funktionen erreichten diese Datei nie und jede Pruefung staerbe an
// "not defined". Dieselbe Zeile steht aus demselben Grund ueber visitor-analytics-render.test.js.
//
// Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/api-metrics-render.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const src = read("js", "review", "review-api-metrics.js");
const css = read("css", "components", "visitor-analytics.css");
const indexHtml = read("index.html");
const statusJs = read("js", "review", "review-status.js");

let fehler = 0;
function pruefe(bedingung, was) {
	if (!bedingung) {
		console.error("FAIL: " + was);
		fehler++;
	}
}

function extract(name) {
	const match = src.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " nicht in js/review/review-api-metrics.js gefunden");
		process.exit(1);
	}
	return match[0];
}

// Die reinen Zeichenfunktionen in diesen Namensraum holen.
eval(extract("apiEscape"));
eval(extract("apiKlassenBalken"));
eval(extract("apiZaehlstandSatz"));

// --- Der gestapelte Balken ---------------------------------------------------------------------
const klassen = [
	{ dimension: "2xx", c: 900 },
	{ dimension: "4xx", c: 60 },
	{ dimension: "5xx", c: 30 },
	{ dimension: "leer", c: 10 },
];
const balken = apiKlassenBalken(klassen);
pruefe(balken.includes("90%"), "2xx nimmt 90 % der Breite");
pruefe(/leer/.test(balken), "die leeren Antworten stehen in der Legende");

// 🔴 Die leere Klasse ist der Grund fuer die ganze Tafel -- sie darf nie stillschweigend fehlen.
pruefe(apiKlassenBalken([{ dimension: "2xx", c: 5 }]).includes("leer") === false,
	"ohne leere Antworten steht auch keine leere Legende da");

// Leere Daten ergeben einen Satz, KEINE Nullbalken -- „Zahl da, Balken leer" liest sich wie
// „Wert ist 0", und genau daran standen im Besucher-Dashboard acht Listen monatelang unbemerkt.
pruefe(/noch keine Daten/.test(apiKlassenBalken([])), "leere Daten sagen es");

// --- 🪤 Der Zaehlstand -------------------------------------------------------------------------
// Ein stummer Zaehler sieht aus wie Ruhe. Das Panel muss den Unterschied benennen.
pruefe(apiZaehlstandSatz(null) !== "", "ohne jede Zaehlung wird etwas gesagt");
pruefe(/nichts gez/i.test(apiZaehlstandSatz("2026-08-01")), "ein alter Stand wird als Warnung gelesen");
pruefe(apiZaehlstandSatz(new Date().toISOString().slice(0, 10)) === "", "ein heutiger Stand schweigt");

// --- Die Verdrahtung ---------------------------------------------------------------------------
pruefe(/data-status-subtab="api"/.test(indexHtml), "der dritte Reiterknopf steht in index.html");
pruefe(/data-status-subsection="api"/.test(indexHtml), "und sein Abschnitt");
pruefe(indexHtml.includes("js/review/review-api-metrics.js"), "das Skript wird geladen");
pruefe(/"api"/.test(statusJs), "activateStatusSubtab kennt den dritten Namen");

// 💣 EIN Schreiber auf den Speicherschluessel. Der Reiterzustand gehoert der Kaskadentabelle
// REVIEW_TAB_FAMILIES in js/ui/ui-controls.js; ein zweiter Schreiber hier war schon einmal da.
pruefe(!/localStorage/.test(statusJs), "review-status.js schreibt den Reiter NICHT selbst");

// --- Die Bauteile im CSS ------------------------------------------------------------------------
// ⭐ Der Ring kommt vom vorhandenen vaDonut, nicht aus einer zweiten Fassung.
pruefe(/vaDonut\(/.test(src), "apiZonenKarte benutzt den vorhandenen vaDonut");
pruefe(!/stroke-dasharray/.test(src), "kein zweiter Ring von Hand");

// 💣 vaHeatmapGrid liest r.dow / r.hour / r.c. Ein Alias `hour AS h` im Leser laesst jede Zelle in
// Stunde 0 landen -- die Karte zeigte dann einen soliden Streifen und saehe wie ein Befund aus
// statt wie ein Fehler.
const leser = read("api", "_internal", "analytics", "api-metrics.php");
pruefe(!/hour\s+AS\s+h\b/i.test(leser), "die Stundenspalte wird NICHT umbenannt");

pruefe(/\.va-sect__t\b/.test(css), "die Abschnittsueberschrift hat eine Regel");
pruefe(/\.va-stack\b/.test(css), "der gestapelte Balken hat eine Regel");
pruefe(/\.va-feed__tag--bad\b/.test(css), "die Plakettenklassen sind da");

// 💣 Die Plakette traegt ihre Schriftfarbe je Thema selbst: --color-warn und --color-danger werden
// im dunklen Thema HELLER, weisse Schrift darauf faellt auf 2,36 Kontrast. Eine pauschale Regel
// bricht immer eine der beiden Haelften, weil --color-button in beiden Themen mitteldunkel bleibt.
pruefe(/\[data-theme="dark"\][^{]*\.va-feed__tag--(bad|warn)/.test(css),
	"das dunkle Thema dreht die Schriftfarbe der Warn-/Fehlerplakette");

// 💣 Keine hartkodierte Farbe in den neuen Regeln (AGENTS.md §12).
const neueRegeln = css.slice(css.indexOf(".va-sect"));
pruefe(!/#[0-9a-fA-F]{6}\s*;/.test(neueRegeln.replace(/#fff\b|#23201a\b/g, "")),
	"die neuen Regeln nehmen Token, keine Hexwerte");

if (fehler > 0) {
	console.error(fehler + " Pruefung(en) fehlgeschlagen");
	process.exit(1);
}
console.log("OK: api-metrics-render");
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
node js/review/__tests__/api-metrics-render.test.js
```

Erwartet: **Fehlschlag** mit `ENOENT ... review-api-metrics.js`.

- [ ] **Schritt 3: Den Renderer anlegen**

Anlegen: `js/review/review-api-metrics.js`

```javascript
// Die API-Nutzungstafel im Reiter Status.
// Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
//
// ⚠️ Kein Modul, kein Build -- die Datei laeuft im selben Dokument wie
// review-visitor-analytics.js und benutzt deren vaBars/vaLocalHourShift/vaHeatmapGrid mit.
// Sie wird in index.html NACH jener Datei geladen.

const API_METRICS_URL = "api/app/api-metrics.php";
let apiDashboardTage = 7;

function apiEscape(wert) {
	const halter = document.createElement("div");
	halter.textContent = String(wert === null || wert === undefined ? "" : wert);
	return halter.innerHTML;
}

// Die Farben der vier Klassen. 🔴 „leer" ist die wichtigste und bekommt deshalb den neutralen,
// kraeftigen Ton -- sie ist kein Fehlerzustand des Servers, sondern ein Ausfall VOR jeder Antwort.
const API_KLASSEN_FARBEN = {
	"2xx": "var(--color-success)",
	"3xx": "var(--color-text-muted)",
	"4xx": "var(--color-warn)",
	"5xx": "var(--color-danger)",
	leer: "var(--color-button)",
};

function apiKlassenBalken(klassen) {
	const zeilen = (klassen || []).filter((z) => Number(z.c) > 0);
	if (zeilen.length === 0) {
		return '<div class="va-storage">noch keine Daten</div>';
	}
	const summe = zeilen.reduce((a, z) => a + Number(z.c), 0);
	const stapel = zeilen.map((z) => {
		const anteil = (Number(z.c) / summe) * 100;
		const farbe = API_KLASSEN_FARBEN[z.dimension] || "var(--color-text-muted)";
		return '<i style="width:' + (Math.round(anteil * 10) / 10) + "%;background:" + farbe + '"></i>';
	}).join("");
	const legende = zeilen.map((z) => {
		const farbe = API_KLASSEN_FARBEN[z.dimension] || "var(--color-text-muted)";
		return '<span><i style="background:' + farbe + '"></i>' + apiEscape(z.dimension)
			+ "&nbsp;" + Number(z.c).toLocaleString("de-DE") + "</span>";
	}).join("");
	return '<div class="va-stack">' + stapel + '</div><div class="va-legend">' + legende + "</div>";
}

// 🪤 Ein stummer Zaehler sieht aus wie Ruhe. Entzieht STRATO bei voller Quote die Schreibrechte,
// verschluckt der Schreiber den Fehler pflichtgemaess -- und leere Balken sind von „keine
// Anfragen" nicht zu unterscheiden. Diese Zeile ist der Unterschied.
function apiZaehlstandSatz(letzteZaehlung) {
	if (!letzteZaehlung) {
		return "Es wurde noch nichts gezählt.";
	}
	const heute = new Date().toISOString().slice(0, 10);
	if (String(letzteZaehlung) === heute) {
		return "";
	}
	return "Zuletzt gezählt am " + apiEscape(letzteZaehlung) + " — seither nichts gezählt. Zählt der Server noch?";
}

function apiEndpunktKarte(endpunkte) {
	return '<div class="va-card"><p class="va-card__label">Meistgerufene Endpunkte</p>'
		+ vaBars((endpunkte || []).slice(0, 10), "var(--color-accent-brown)") + "</div>";
}

function apiFehlerKarte(fehler) {
	const zeilen = fehler || [];
	if (zeilen.length === 0) {
		return '<div class="va-card"><p class="va-card__label">Häufigste Fehler</p>'
			+ '<div class="va-storage">keine Fehler im Zeitraum</div></div>';
	}
	const liste = zeilen.slice(0, 8).map((z) => {
		const teile = String(z.dimension).split("|");
		const code = teile.length > 1 ? teile.pop() : "";
		const endpunkt = teile.join("|");
		const art = code === "fatal" ? "neutral" : "warn";
		return '<div class="va-feed"><span class="va-feed__tag va-feed__tag--' + art + '">'
			+ apiEscape(code === "fatal" ? "leer" : code) + "</span>"
			+ '<span class="va-feed__label">' + apiEscape(endpunkt) + "</span>"
			+ '<span class="va-feed__meta">' + Number(z.c).toLocaleString("de-DE") + "×</span></div>";
	}).join("");
	return '<div class="va-card"><p class="va-card__label">Häufigste Fehler</p>' + liste + "</div>";
}

// ⭐ Der Ring wird NICHT nachgebaut: vaDonut(rows, cols) steht bereits in
// review-visitor-analytics.js und zeichnet genau diese Form samt Legende. Eine zweite Fassung
// liefe beim ersten Nachbessern auseinander.
//
// 🔴 Genau vier Farben, weil es genau vier Zonen sind -- vier Reihen ist die gerechnete Grenze der
// Projektpalette. Eine fuenfte Zone braucht erst eine fuenfte Farbe. vaDonut wiederholt sie sonst
// still (`cols[i % cols.length]`), und Segment 5 saehe aus wie Segment 1.
const API_ZONEN_FARBEN = ["#2a78d6", "#1baf7a", "#b8792c", "#7c4fa6"];
const API_ZONEN_NAMEN = { app: "eigene Karte", edit: "Editoren", offen: "offene API", sonstige: "übrige" };

function apiZonenKarte(zonen) {
	const zeilen = (zonen || []).filter((z) => Number(z.c) > 0);
	if (zeilen.length === 0) {
		return '<div class="va-card"><p class="va-card__label">Wer ruft an</p>'
			+ '<div class="va-storage">noch keine Daten</div></div>';
	}
	// vaDonut liest `r.dimension` als Beschriftung -- die Klarnamen also VOR der Uebergabe setzen,
	// nicht danach im Markup suchen.
	const benannt = zeilen.map((z) => ({
		dimension: API_ZONEN_NAMEN[z.dimension] || z.dimension,
		c: Number(z.c),
	}));
	return '<div class="va-card"><p class="va-card__label">Wer ruft an</p>'
		+ vaDonut(benannt, API_ZONEN_FARBEN) + "</div>";
}

function renderApiDashboard(mount, data) {
	const m = (data && data.metrics) || {};
	const gesamt = (m.klassen || []).reduce((a, z) => a + Number(z.c), 0);
	const schlecht = (m.klassen || [])
		.filter((z) => z.dimension === "4xx" || z.dimension === "5xx" || z.dimension === "leer")
		.reduce((a, z) => a + Number(z.c), 0);
	const quote = gesamt > 0 ? ((schlecht / gesamt) * 100).toFixed(1).replace(".", ",") : "0,0";

	const hinweis = apiZaehlstandSatz(data && data.letzte_zaehlung);
	const speicher = ((data && data.storage && data.storage.tables) || [])[0];

	mount.innerHTML =
		(hinweis ? '<div class="va-card"><p class="va-storage">⚠️ ' + hinweis + "</p></div>" : "")
		+ '<div class="va-kpis">'
		+ '<div class="va-kpi"><div class="va-kpi__label">Anfragen</div><div class="va-kpi__value">'
		+ gesamt.toLocaleString("de-DE") + "</div></div>"
		+ '<div class="va-kpi"><div class="va-kpi__label">Fehlerquote</div><div class="va-kpi__value">'
		+ quote + " %</div></div>"
		+ '<div class="va-kpi"><div class="va-kpi__label">Zeitraum</div><div class="va-kpi__value">'
		+ apiEscape(data && data.days) + '<span style="font-size:12px"> Tage</span></div></div>'
		+ "</div>"
		+ apiEndpunktKarte(m.endpunkte)
		+ '<div class="va-card"><p class="va-card__label">Wie geantwortet wurde</p>'
		+ apiKlassenBalken(m.klassen)
		+ '<p class="va-storage" style="margin-top:9px">„leer" = die Antwort ging nie durch den '
		+ "Trichter. Ein Fatal Error sieht im Browser aus wie ein Netzfehler.</p></div>"
		+ apiFehlerKarte(m.fehler)
		+ apiZonenKarte(m.zonen)
		+ '<div class="va-card"><p class="va-card__label">Wann die Last liegt (Ortszeit)</p>'
		+ vaHeatmap(m.stunden || []) + "</div>"
		+ '<div class="va-card"><p class="va-card__label">Die Tafel selbst</p><p class="va-storage">'
		+ (speicher
			? "api_metric · " + Number(speicher.rows || 0).toLocaleString("de-DE") + " Zeilen · "
				+ vaBytes(speicher.bytes)
			: "keine Angabe")
		+ "</p></div>";
}

async function loadApiDashboard() {
	const mount = document.getElementById("api-dashboard");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	mount.innerHTML = '<div class="va-off">Wird geladen ...</div>';
	let data;
	try {
		const response = await fetch(API_METRICS_URL + "?days=" + apiDashboardTage + "&_=" + Date.now(), {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		data = await response.json();
	} catch (error) {
		mount.innerHTML = '<div class="va-off">Konnte die API-Statistik nicht laden.</div>';
		return;
	}
	if (!data || data.ok !== true) {
		mount.innerHTML = '<div class="va-off">Konnte die API-Statistik nicht laden.</div>';
		return;
	}
	if (data.enabled === false) {
		mount.innerHTML = '<div class="va-off">Die API-Zählung ist ausgeschaltet.</div>';
		return;
	}
	renderApiDashboard(mount, data);
}
```

- [ ] **Schritt 4: Die Verdrahtung**

In `index.html`, den Reiterblock (Zeile 741–743) ergänzen:

```html
				<nav class="status-subtabs" aria-label="Status-Bereiche">
					<button class="status-subtab is-active" type="button" data-status-subtab="besucher">Besucher</button>
					<button class="status-subtab" type="button" data-status-subtab="editoren">Editoren</button>
					<button class="status-subtab" type="button" data-status-subtab="api">API</button>
				</nav>
```

Und nach dem Abschnitt `data-status-subsection="besucher"` einen dritten einfügen:

```html
				<div class="status-subsection" data-status-subsection="api">
					<div id="api-dashboard"></div>
				</div>
```

Nach `<script src="js/review/review-visitor-analytics.js"></script>` (Zeile 3258):

```html
		<script src="js/review/review-api-metrics.js"></script>
```

In `js/review/review-status.js` die ersten beiden Funktionen ersetzen:

```javascript
let statusDashboardLoaded = false;
let apiDashboardLoaded = false;

const STATUS_SUBTABS = ["besucher", "editoren", "api"];

function activateStatusSubtab(name) {
	const target = STATUS_SUBTABS.includes(name) ? name : "editoren";
	const nav = document.querySelector(".status-subtabs");
	if (!nav) {
		return;
	}
	nav.querySelectorAll("[data-status-subtab]").forEach((b) => b.classList.toggle("is-active", b.dataset.statusSubtab === target));
	document.querySelectorAll("[data-status-subsection]").forEach((s) => s.classList.toggle("is-active", s.dataset.statusSubsection === target));
	if (target === "besucher" && !statusDashboardLoaded) {
		statusDashboardLoaded = true;
		void loadVisitorDashboard();
	}
	// Beide Tafeln laden faul und genau einmal -- der schwere Lesevorgang gehoert nicht in den
	// Start des Editiermodus.
	if (target === "api" && !apiDashboardLoaded) {
		apiDashboardLoaded = true;
		void loadApiDashboard();
	}
}
```

⚠️ Weiter unten im Klick-Verdrahter steht `button.dataset.statusSubtab === "besucher" ? "besucher" : "editoren"` — das wird zu `button.dataset.statusSubtab`, sonst ist der dritte Reiter nicht anklickbar.

An `css/components/visitor-analytics.css` anhängen (die drei Bauteile aus dem Mockup, unverändert
übernommen — sie sind dort in hell und dunkel gemessen):

```css
/* --- API-Tafel (Entwurf 2026-08-25) ---------------------------------------------------------- */
/* Abschnittsueberschrift: Trennlinie + Ueberschrift, kein gerahmter Kasten (AGENTS.md §12). */
.va-sect { display: flex; align-items: center; gap: 9px; margin: 16px 0 9px; }
.va-sect:first-child { margin-top: 0; }
.va-sect__t { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
	color: var(--color-text-muted); white-space: nowrap; }
.va-sect__l { flex: 1; height: 1px; background: var(--color-divider); }

.va-stack { display: flex; height: 22px; border-radius: 5px; overflow: hidden; margin: 2px 0 9px; }
.va-stack i { display: block; height: 100%; }
.va-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11.5px; color: var(--color-text-muted); }
.va-legend span { display: inline-flex; align-items: center; gap: 5px; }
.va-legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

.ring-legend { font-size: 12px; }
.ring-legend div { display: flex; align-items: center; gap: 6px; margin: 4px 0; color: var(--color-button-soft-text); }
.ring-legend i { width: 9px; height: 9px; border-radius: 2px; flex: none; }
.ring-legend b { margin-left: auto; color: var(--color-text-muted); font-weight: 400; }

/* 💣 Die Plakette traegt ihre Schriftfarbe je Thema selbst. --color-warn und --color-danger werden
   im dunklen Thema HELLER (#d3a04a / #e08272) -- weisse Schrift darauf faellt auf 2,36 bzw. 2,76
   Kontrast. Die neutrale Plakette geht den anderen Weg: --color-button bleibt in beiden Themen
   mitteldunkel, dort ist helle Schrift richtig. Eine pauschale Regel bricht also immer eine der
   beiden Haelften; deshalb drei Klassen. Gemessen im Mockup docs/api-nutzung-mockup.html. */
.va-feed__tag--bad { background: var(--color-danger); color: #fff; }
.va-feed__tag--warn { background: var(--color-warn); color: #fff; }
.va-feed__tag--neutral { background: var(--color-button); color: var(--color-button-text); }
:root[data-theme="dark"] .va-feed__tag--bad,
:root[data-theme="dark"] .va-feed__tag--warn { color: #23201a; }
```

- [ ] **Schritt 5: Test laufen lassen und den Erfolg sehen**

```bash
node js/review/__tests__/api-metrics-render.test.js
```

Erwartet: `OK: api-metrics-render`.

- [ ] **Schritt 6: Im Browser ansehen — die Handgriffe, nicht die Maße**

💣 **Abnahme heißt ABLAUF, nicht Maß** (AGENTS.md §9). Eine Prüfseite, die Rechtecke misst, belegt
nicht, dass etwas funktioniert. Diese vier Handgriffe werden ausgeführt und benannt:

```bash
# Vorschau starten (Eintrag „avesmaps-php" in .claude/launch.json, Wurzel „.")
```
1. Editiermodus öffnen, Reiter **Status** → auf **API** klicken. Die Tafel lädt.
2. Von API auf **Besucher** und zurück — die Tafel lädt **kein zweites Mal** (der Faul-Lade-Riegel).
3. Neu laden: der zuletzt gewählte Reiter kommt zurück (das macht `REVIEW_TAB_FAMILIES`).
4. **Dunkles Thema** umschalten und dieselben drei Handgriffe wiederholen — besonders die
   Fehlerplaketten ansehen.

⚠️ Was der Emulator nicht beantworten kann, wird als offene Frage gemeldet, nicht als bestanden.

- [ ] **Schritt 7: Das ganze Testfeld, dann committen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```

```bash
git add js/review/review-api-metrics.js js/review/review-status.js js/review/__tests__/api-metrics-render.test.js css/components/visitor-analytics.css index.html
git commit -m "feat(api-nutzung): dritter Unterreiter API im Status-Panel mit sechs Karten"
```

🔴 **Diese Aufgabe geht ALLEIN live und der Owner sieht sie** (AGENTS.md §9) — sie ändert eine
sichtbare Oberfläche.

---

## Selbstprüfung des Plans

**Abdeckung des Entwurfs.** §3.1 Schreiber → Aufgabe 3 · §3.2 Verbindung → Aufgabe 2 ·
§3.3 Schlüssel → Aufgabe 1 · §3.4 Zonen → Aufgabe 1 · §3.5 Metriken → Aufgabe 1 ·
§3.6 Notausschalter → Aufgabe 1 und 5 · §3.7 stummer Zähler → Aufgabe 4 und 6 ·
§4 Tabelle → Aufgabe 1 · §5 Leseendpunkt → Aufgabe 4 und 5 · §6 Oberfläche → Aufgabe 6 ·
§9 Fallen 1–11 → alle in Code oder Test verankert · §12 Reihenfolge → Aufgaben 1–3 gehen vor 4–6
live.

**Nicht abgedeckt, absichtlich:** §7 (Stufe 2) und §8 (Stufe 3) sind eigene Pläne; §11 (ausgehend)
ist ein eigenes Vorhaben.

🔧 **Zwei Punkte, die beim Bauen entschieden werden müssen und die kein Plan vorwegnehmen kann:**

1. **Der Zeitraum.** Das Mockup zeigt eigene Pillen (24 h / 7 / 30 / 90 Tage); dieser Plan baut sie
   **nicht** — die Tafel läuft fest auf 7 Tagen. Ob die Pillen fehlen, entscheidet sich am fertigen
   Bild; sie nachzurüsten ist eine halbe Stunde und braucht keinen zweiten Entwurf.
2. **Die Kardinalität am Bestand.** Nach ein bis zwei Tagen Laufzeit (Ende Aufgabe 3) zeigt
   `SELECT metric, COUNT(*) FROM api_metric GROUP BY metric`, ob die geschätzten 200–600 Zeilen am
   Tag stimmen. Weicht es stark ab, ist das ein Befund und kein Grund weiterzubauen.
