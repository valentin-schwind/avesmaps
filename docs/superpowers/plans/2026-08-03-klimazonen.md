# Klimazonen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine vierte Landschaften-Ebene „Klimazonen" mit sieben Bändern, die aus sechs auf der Karte bearbeitbaren Trennlinien abgeleitet werden.

**Architecture:** Die sechs Trennlinien (`ecosystem_climate_divider`, GeoJSON LineString) sind die Wahrheit. Nach jedem Speichern leitet der Server daraus die sieben Bänder ab und schreibt sie als gewöhnliche `ecosystem_area`-Zeilen mit `kind='klima'`. Dadurch erbt die Ebene Rendering, Regionen-Editor, „Zugehörigkeit rechnen" und Wege-Zuordnung ohne eigenen Code; die Bänder selbst sind gegen jede Polygon-Bearbeitung verriegelt.

**Tech Stack:** PHP 8 (strict types) + MySQL/PDO, Vanilla JS, Leaflet 1.9.4 (`L.CRS.Simple`), kein Build-Schritt.

**Spec:** `docs/superpowers/specs/2026-08-03-klimazonen-design.md`

## Global Constraints

- **Sprache:** UI-Strings **Deutsch**, Code/Bezeichner/`error.code` **Englisch** (AGENTS.md §8). Domänen-Vokabular (`kind`-Werte, `type_key`) bleibt Deutsch und ASCII-gefaltet.
- **Koordinaten:** auf dem Draht GeoJSON `[x, y]`. Leaflet `L.CRS.Simple` will `[lat, lng] = [y, x]` — der **Client** dreht, der Server nie (AGENTS.md §5).
- **Norden ist hohes `y`.** `MAP_BOUNDS = [[0,0],[1024,1024]]`. Trennlinie 1 (Polar↔Subpolar) hat das höchste `y`, Trennlinie 6 das niedrigste.
- **Keine hartkodierten Farben/Radien/Trenner.** Erst Token in `css/base/tokens.css`, dann benutzen (AGENTS.md §12).
- **Kein `?v=` von Hand** in `index.html`/`html/*.html` (AGENTS.md §7). `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js:23` dagegen **muss** von Hand hoch, sobald Editor-Assets sich ändern.
- **Kein `git add -A`.** Geteilter Arbeitsbaum; nur die selbst angefassten Pfade einzeln stagen (AGENTS.md §9).
- **Kein politischer Code zur Laufzeit** aus Landschaften-Dateien heraus (Hauptplan-Regel 1; gelockert nur für vorhandene LESE-Wege).
- **Kein Aufruf von `avesmapsNextMapRevision()`** — die Landschaften haben ihren eigenen Zähler `avesmapsNextEcosystemRevision()`.
- **PHP-Testkommando** (immer so, sonst prüft `assert()` nichts):
  ```bash
  php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <testdatei>
  ```
- **JS-Testkommando:** `node js/map-features/__tests__/<x>.test.js` (keine Flags, kein Runner).
- **Es gibt keine lokale Datenbank.** Alles DB-Gebundene ist erst live prüfbar; deshalb liegt so viel wie möglich in reinen Funktionen.

---

## File Structure

**Neu:**

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/climate-zones.php` | reine Geometrie: Trennlinie normalisieren, Reihenfolge prüfen, Band ableiten, Startaufteilung. Keine DB, keine Includes außer `bootstrap.php`. |
| `api/_internal/app/__tests__/climate-zones-test.php` | Unit-Test dazu |
| `js/map-features/map-features-ecosystem-climate.js` | Linien-Editor auf der Karte: zeichnen, Griffe, Ziehen, Punkt setzen/löschen, speichern |
| `js/map-features/__tests__/ecosystem-climate.test.js` | Unit-Test der reinen Klemm-/Einfüge-Logik daraus |

**Geändert:**

| Datei | Änderung |
|---|---|
| `api/_internal/app/ecosystem.php` | `klima` im Vokabular, 7 Saatzeilen, DDL `ecosystem_climate_divider`, Saat + Ableitung, Riegel in create/delete |
| `api/edit/map/ecosystem.php` | drei Aktionen `climate_get` / `climate_save_divider` / `climate_reset` |
| `api/app/ecosystem-areas.php` | `AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION` 5 → 6 |
| `js/map-features/map-features-ecosystem-rendering.js` | vierter `kind` in fünf Tabellen |
| `js/app/bootstrap.js` | zwei neue Panes |
| `index.html` | vierte Umschalter-Kachel, ein `<script>`, Kommentar an Z. 627 |
| `css/base/tokens.css` | 7 Zonentöne + Linienfarbe |
| `css/features/ecosystem-layer.css` | Füllung der Klima-Pane, Linien, Zonennamen, gepinnte Griffe |
| `js/app/i18n-en.js` | neue Schlüssel + `ecosystem.kind.derographisch` |
| `js/map-features/map-features-ecosystem-transfer.js` | `klima` als Quelle und Ziel ausschließen |
| `js/map-features/map-features-ecosystem-territory-import.js` | `klima` nicht als Ziel-Ebene anbieten |
| `js/map-features/map-features-ecosystem-edit.js` | Ecken-Editor öffnet auf `klima` nicht |
| `js/map-features/map-features-ecosystem-context-action.js` | Flächenmenü auf `klima` ohne Verben |
| `html/landschaften-editor.html` | vierter Reiter, Eigenschaften-Sperren |
| `js/territory/territory-editor-inline-host.js` | `ASSET_VERSION` |
| `AGENTS.md` | §11-Eintrag für die neue Ebene |

---

## Task 1: Die reine Klimageometrie

Alles, was ohne Datenbank entscheidbar ist. Das ist der Kern des Features — hier wird festgenagelt, dass sich Bänder nicht überlappen können.

**Files:**
- Create: `api/_internal/app/climate-zones.php`
- Test: `api/_internal/app/__tests__/climate-zones-test.php`

**Interfaces:**
- Consumes: `avesmapsParseMapCoordinate(mixed, string): float` aus `api/_internal/bootstrap.php:294`
- Produces:
  - `AVESMAPS_CLIMATE_MIN_XY = 0.0`, `AVESMAPS_CLIMATE_MAX_XY = 1024.0`, `AVESMAPS_CLIMATE_MIN_GAP = 1.0`, `AVESMAPS_CLIMATE_MAX_POINTS = 500`
  - `avesmapsClimateNormalizeDivider(mixed $geometry): array` → `['type' => 'LineString', 'coordinates' => [[float,float], …]]`
  - `avesmapsClimateAssertOrder(array $dividers): void` — `$dividers` ist eine Liste normalisierter LineStrings, Index 0 = nördlichste
  - `avesmapsClimateBandGeometry(?array $upper, ?array $lower): array` → GeoJSON Polygon
  - `avesmapsClimateDefaultDividers(int $count): array` → Liste normalisierter LineStrings
  - `avesmapsClimateYAt(array $coordinates, float $x): float`

- [ ] **Step 1: Den Test schreiben**

`api/_internal/app/__tests__/climate-zones-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the PURE climate-zone geometry (spec docs/superpowers/specs/2026-08-03-klimazonen-design.md
 * §4). Everything DB-bound (the seed, the rebuild, the revision) is provable only in the owner's live
 * run -- there is no local MySQL. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/climate-zones-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../climate-zones.php';

function climateTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

function climateTestLine(array $points): array
{
    return avesmapsClimateNormalizeDivider(['type' => 'LineString', 'coordinates' => $points]);
}

// ---- normalising one divider -----------------------------------------------------------------------

$straight = climateTestLine([[0, 900], [1024, 900]]);
assert($straight['type'] === 'LineString', 'a normalised divider stays a LineString');
assert($straight['coordinates'] === [[0.0, 900.0], [1024.0, 900.0]], 'positions survive as floats');

$bent = climateTestLine([[0, 900], [300, 880], [1024, 910]]);
assert(count($bent['coordinates']) === 3, 'intermediate points survive');

climateTestThrows(static fn() => climateTestLine([[10, 900], [1024, 900]]),
    'the first point must sit on the left map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900], [1000, 900]]),
    'the last point must sit on the right map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900], [500, 880], [400, 890], [1024, 900]]),
    'x must strictly increase -- a backwards step folds the band');
climateTestThrows(static fn() => climateTestLine([[0, 900], [500, 880], [500, 870], [1024, 900]]),
    'two points at the same x are not strictly increasing either');
climateTestThrows(static fn() => climateTestLine([[0, 900]]),
    'a divider needs at least two points');
climateTestThrows(static fn() => climateTestLine([[0, 1100], [1024, 900]]),
    'y stays inside the map');
climateTestThrows(static fn() => avesmapsClimateNormalizeDivider(['type' => 'Polygon', 'coordinates' => []]),
    'only a LineString is a divider');

// ---- y at a given x --------------------------------------------------------------------------------

$ramp = climateTestLine([[0, 100], [1024, 1124 - 1024 + 100]]);   // straight, +100 over the width
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 0.0) - 100.0) < 1e-9, 'y at the left edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 1024.0) - 200.0) < 1e-9, 'y at the right edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 512.0) - 150.0) < 1e-9, 'y interpolates linearly');

// ---- the order guard -------------------------------------------------------------------------------
// 🔴 This is what makes "no overlap" a property of the construction rather than a rule someone checks.

$ok = [
    climateTestLine([[0, 900], [1024, 880]]),
    climateTestLine([[0, 700], [1024, 720]]),
    climateTestLine([[0, 500], [1024, 500]]),
];
avesmapsClimateAssertOrder($ok);   // must not throw

// Crossing INSIDE a segment, with no shared breakpoint: both lines are fine at x = 0 and x = 1024 of
// their own vertices, and they still cross. This is the case a naive endpoint check misses.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 900], [1024, 500]]),
    climateTestLine([[0, 600], [1024, 800]]),
]), 'two dividers crossing between their breakpoints are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 700], [1024, 700]]),
]), 'two dividers lying on top of each other are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 699.5], [1024, 699.5]]),
]), 'closer than the minimum gap is refused');

// The union of BOTH x sets is what gets sampled: line B's kink sits at an x that line A has no vertex
// at, and that kink is where they touch.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 800], [1024, 800]]),
    climateTestLine([[0, 400], [512, 799.9], [1024, 400]]),
]), 'a kink of the southern line reaching up to the northern one is refused');

// ---- band geometry ---------------------------------------------------------------------------------

$top = avesmapsClimateBandGeometry(null, $ok[0]);
assert($top['type'] === 'Polygon', 'a band is a Polygon');
$topRing = $top['coordinates'][0];
assert($topRing[0] === $topRing[count($topRing) - 1], 'the ring is closed');
assert(in_array([0.0, 1024.0], $topRing, true), 'the northernmost band reaches the top edge');

$bottom = avesmapsClimateBandGeometry($ok[2], null);
assert(in_array([0.0, 0.0], $bottom['coordinates'][0], true), 'the southernmost band reaches the bottom edge');

$middle = avesmapsClimateBandGeometry($ok[0], $ok[1]);
assert(count($middle['coordinates'][0]) === 5, 'two 2-point dividers make a 4-corner ring plus the closing point');

// 🔴 The whole point: n dividers make n+1 bands that tile the map exactly -- no gap, no overlap.
$dividers = avesmapsClimateDefaultDividers(6);
$total = 0.0;
for ($index = 0; $index <= count($dividers); $index++) {
    $band = avesmapsClimateBandGeometry(
        $index === 0 ? null : $dividers[$index - 1],
        $index === count($dividers) ? null : $dividers[$index]
    );
    $total += climateTestRingArea($band['coordinates'][0]);
}
assert(abs($total - 1024.0 * 1024.0) < 1e-6, 'the seven bands tile the whole map: ' . $total);

// Shoelace, unsigned. Local to the test -- the production code never needs an area.
function climateTestRingArea(array $ring): float
{
    $sum = 0.0;
    for ($index = 0; $index < count($ring) - 1; $index++) {
        $sum += $ring[$index][0] * $ring[$index + 1][1] - $ring[$index + 1][0] * $ring[$index][1];
    }

    return abs($sum) / 2.0;
}

// ---- the default split -----------------------------------------------------------------------------

assert(count($dividers) === 6, 'six dividers by default');
avesmapsClimateAssertOrder($dividers);   // the default must satisfy its own guard
assert(abs($dividers[0]['coordinates'][0][1] - 1024.0 * 6 / 7) < 1e-9, 'the first divider sits at 6/7 height');
assert(abs($dividers[5]['coordinates'][0][1] - 1024.0 * 1 / 7) < 1e-9, 'the last one at 1/7');
assert(avesmapsClimateDefaultDividers(0) === [], 'zero dividers is a valid degenerate answer');

fwrite(STDOUT, "climate-zones-test: OK\n");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/climate-zones-test.php
```

Erwartet: FATAL — `climate-zones.php` gibt es nicht.

- [ ] **Step 3: `api/_internal/app/climate-zones.php` schreiben**

```php
<?php

declare(strict_types=1);

// Klimazonen -- die REINE Geometrie (Entwurf docs/superpowers/specs/2026-08-03-klimazonen-design.md §4).
// Keine Datenbank, keine Includes ausser bootstrap.php: das ist die Hälfte des Features, die sich ohne
// MySQL beweisen lässt, und sie ist genau die Hälfte, in der die Fehler wehtun.
//
// 🔴 DER TRAGENDE SATZ: die Trennlinien sind die Wahrheit, die Bänder sind abgeleitet. „Keine
// Überlappung" ist deshalb keine Prüfung, sondern Bauart -- ein Band IST der Raum zwischen zwei Linien.
//
// 🔴 KOORDINATEN sind GeoJSON [x, y], nie gedreht. Der Client dreht auf [y, x] (AGENTS.md §5).
// 🔴 NORDEN IST HOHES y. Trennlinie 0 ist die nördlichste und hat das höchste y.

require_once __DIR__ . '/../bootstrap.php';

const AVESMAPS_CLIMATE_MIN_XY = 0.0;
const AVESMAPS_CLIMATE_MAX_XY = 1024.0;

// Der Mindestabstand zweier Trennlinien, in Karteneinheiten. Er ist der Unterschied zwischen „ein Band
// ist dünn" und „ein Band ist ein entartetes Polygon, das sich selbst berührt": zwei Linien, die
// einander auch nur an einer Stelle küssen, machen aus dem Ring eine Acht, und jeder Verschnitt danach
// liefert Unsinn. 1,0 von 1024 ist etwa ein Tausendstel der Karte -- eng genug, um eine Zone praktisch
// verschwinden zu lassen, weit genug, um gültig zu bleiben.
const AVESMAPS_CLIMATE_MIN_GAP = 1.0;

// Deckel gegen einen durchgedrehten Client, keine Gestaltungsgrenze. Eine Klimagrenze mit 500 Ecken ist
// bereits weit jenseits dessen, was ein Mensch von Hand zieht.
const AVESMAPS_CLIMATE_MAX_POINTS = 500;

/**
 * Eine Trennlinie prüfen und in Gestalt bringen.
 *
 * 💣 „x streng steigend" ist die Bedingung, an der alles Weitere hängt. Nur so ist die Linie eine
 * Funktion y(x); nur dann lässt sich „liegt B überall unter A" exakt beantworten (siehe
 * avesmapsClimateAssertOrder), und nur dann ergeben zwei Linien ein Polygon ohne Selbstschnitt. Wer
 * freie Punktreihenfolge zulässt, braucht stattdessen echte Linien-Schnitttests und bekommt Bänder,
 * die sich zu Achterschleifen falten.
 *
 * @return array{type: string, coordinates: list<array{0: float, 1: float}>}
 */
function avesmapsClimateNormalizeDivider(mixed $geometry): array
{
    if (!is_array($geometry)) {
        throw new InvalidArgumentException('divider geometry must be a GeoJSON object.');
    }
    if ((string) ($geometry['type'] ?? '') !== 'LineString') {
        throw new InvalidArgumentException('divider geometry must be of type LineString.');
    }

    $positions = $geometry['coordinates'] ?? null;
    if (!is_array($positions) || count($positions) < 2) {
        throw new InvalidArgumentException('a divider needs at least two positions.');
    }
    if (count($positions) > AVESMAPS_CLIMATE_MAX_POINTS) {
        throw new InvalidArgumentException('a divider may not have more than '
            . AVESMAPS_CLIMATE_MAX_POINTS . ' positions.');
    }

    $coordinates = [];
    $previousX = null;
    foreach (array_values($positions) as $index => $position) {
        if (!is_array($position) || count($position) < 2) {
            throw new InvalidArgumentException("divider position {$index} is invalid.");
        }
        $x = avesmapsParseMapCoordinate($position[0] ?? null, "divider[{$index}].x");
        $y = avesmapsParseMapCoordinate($position[1] ?? null, "divider[{$index}].y");
        if ($y < AVESMAPS_CLIMATE_MIN_XY || $y > AVESMAPS_CLIMATE_MAX_XY) {
            throw new InvalidArgumentException("divider position {$index} lies outside the map.");
        }
        if ($previousX !== null && $x <= $previousX) {
            throw new InvalidArgumentException('divider positions must have strictly increasing x.');
        }
        $previousX = $x;
        $coordinates[] = [$x, $y];
    }

    $first = $coordinates[0][0];
    $last = $coordinates[count($coordinates) - 1][0];
    if (abs($first - AVESMAPS_CLIMATE_MIN_XY) > 1e-9) {
        throw new InvalidArgumentException('the first divider position must sit on the left map edge.');
    }
    if (abs($last - AVESMAPS_CLIMATE_MAX_XY) > 1e-9) {
        throw new InvalidArgumentException('the last divider position must sit on the right map edge.');
    }

    return ['type' => 'LineString', 'coordinates' => $coordinates];
}

/**
 * y der Linie an der Stelle x. Setzt eine normalisierte Linie voraus (x streng steigend, Rand zu Rand).
 */
function avesmapsClimateYAt(array $coordinates, float $x): float
{
    $count = count($coordinates);
    for ($index = 0; $index < $count - 1; $index++) {
        [$ax, $ay] = $coordinates[$index];
        [$bx, $by] = $coordinates[$index + 1];
        if ($x >= $ax && $x <= $bx) {
            $span = $bx - $ax;

            return $span <= 0.0 ? $ay : $ay + ($x - $ax) / $span * ($by - $ay);
        }
    }

    return (float) $coordinates[$count - 1][1];
}

/**
 * Liegt jede Trennlinie überall unter ihrer nördlichen Nachbarin, mit Mindestabstand?
 *
 * 🔴 EXAKT, KEIN SAMPLING-RASTER. Beide Linien sind stückweise linear und x-monoton. Zwischen zwei
 * benachbarten Knickstellen ist die Differenz beider Funktionen selbst linear -- ihr Minimum liegt
 * also immer an einer Knickstelle. Es genügt deshalb, an der VEREINIGUNG der x-Werte beider Linien zu
 * prüfen; ein feineres Raster fände nichts dazu, ein gröberes übersähe eine Kreuzung zwischen zwei
 * Stützstellen.
 *
 * @param list<array{type: string, coordinates: list<array{0: float, 1: float}>}> $dividers Index 0 = nördlichste
 */
function avesmapsClimateAssertOrder(array $dividers): void
{
    $dividers = array_values($dividers);
    for ($index = 0; $index < count($dividers) - 1; $index++) {
        $north = $dividers[$index]['coordinates'];
        $south = $dividers[$index + 1]['coordinates'];

        $samples = [];
        foreach ([...$north, ...$south] as [$x, $unusedY]) {
            $samples[(string) $x] = $x;
        }
        foreach ($samples as $x) {
            $gap = avesmapsClimateYAt($north, $x) - avesmapsClimateYAt($south, $x);
            if ($gap < AVESMAPS_CLIMATE_MIN_GAP) {
                throw new InvalidArgumentException(sprintf(
                    'divider %d comes closer than %.1f to divider %d at x = %.4f.',
                    $index + 2,
                    AVESMAPS_CLIMATE_MIN_GAP,
                    $index + 1,
                    $x
                ));
            }
        }
    }
}

/**
 * Aus zwei Kanten ein Band. `null` heisst „der Kartenrand": oben für die nördlichste Zone, unten für
 * die südlichste.
 *
 * Der Ring läuft obere Kante nach Osten, untere Kante nach Westen zurück, dann zu. Weil beide Kanten
 * exakt am Kartenrand beginnen und enden, teilen sich zwei benachbarte Bänder ihre Linie PUNKTGLEICH --
 * es entsteht kein Spalt, den ein Verschnitt später als „gehört zu keiner Zone" meldet.
 *
 * @return array{type: string, coordinates: list<list<array{0: float, 1: float}>>}
 */
function avesmapsClimateBandGeometry(?array $upper, ?array $lower): array
{
    $top = $upper === null
        ? [[AVESMAPS_CLIMATE_MIN_XY, AVESMAPS_CLIMATE_MAX_XY], [AVESMAPS_CLIMATE_MAX_XY, AVESMAPS_CLIMATE_MAX_XY]]
        : $upper['coordinates'];
    $bottom = $lower === null
        ? [[AVESMAPS_CLIMATE_MIN_XY, AVESMAPS_CLIMATE_MIN_XY], [AVESMAPS_CLIMATE_MAX_XY, AVESMAPS_CLIMATE_MIN_XY]]
        : $lower['coordinates'];

    $ring = [];
    foreach ($top as $position) {
        $ring[] = [(float) $position[0], (float) $position[1]];
    }
    foreach (array_reverse($bottom) as $position) {
        $ring[] = [(float) $position[0], (float) $position[1]];
    }
    $ring[] = $ring[0];

    return ['type' => 'Polygon', 'coordinates' => [$ring]];
}

/**
 * Die gleichmäßige Startaufteilung: `$count` gerade Linien, die die Karte in `$count + 1` gleich hohe
 * Bänder teilen. Index 0 ist die nördlichste und liegt am höchsten.
 *
 * @return list<array{type: string, coordinates: list<array{0: float, 1: float}>}>
 */
function avesmapsClimateDefaultDividers(int $count): array
{
    $dividers = [];
    for ($index = 0; $index < $count; $index++) {
        $y = AVESMAPS_CLIMATE_MAX_XY * ($count - $index) / ($count + 1);
        $dividers[] = avesmapsClimateNormalizeDivider([
            'type' => 'LineString',
            'coordinates' => [[AVESMAPS_CLIMATE_MIN_XY, $y], [AVESMAPS_CLIMATE_MAX_XY, $y]],
        ]);
    }

    return $dividers;
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/climate-zones-test.php
```

Erwartet: `climate-zones-test: OK`

- [ ] **Step 5: Committen**

```bash
git add api/_internal/app/climate-zones.php api/_internal/app/__tests__/climate-zones-test.php
git commit -m "feat(landschaften): die reine Geometrie der Klimazonen - 6 Linien werden 7 Baender"
```

---

## Task 2: Vokabular, Tabelle, Saat und Ableitung

**Files:**
- Modify: `api/_internal/app/ecosystem.php:61` (Vokabular), `:76-159` (Saat), `:174` (DDL), Ende der Datei (neue Funktionen), `:1622` + `:2102` + `:1776` + `:2206` (Riegel)
- Test: `api/_internal/app/__tests__/climate-zones-test.php` (erweitern)

**Interfaces:**
- Consumes: Task 1 vollständig; `avesmapsNextEcosystemRevision(PDO): int`, `avesmapsUuidV4(): string`, `avesmapsEcosystemEnsureTables(PDO): void`
- Produces:
  - `AVESMAPS_ECOSYSTEM_KINDS` enthält `'klima'`
  - `avesmapsEcosystemClimateZones(PDO $pdo): array` → Liste `['type_key' => string, 'label' => string, 'sort_order' => int, 'region_public_id' => string]`, nach `sort_order` (Nord → Süd)
  - `avesmapsEcosystemClimateReadDividers(PDO $pdo): array` → Liste `['seq' => int, 'geometry' => array, 'revision' => int]`
  - `avesmapsEcosystemClimateEnsure(PDO $pdo, int $userId): bool` — `true`, wenn etwas geschrieben wurde
  - `avesmapsEcosystemClimateRebuildBands(PDO $pdo, int $userId): bool`
  - `avesmapsClimateIsDerivedKind(string $kind): bool`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ans Ende von `api/_internal/app/__tests__/climate-zones-test.php`, **vor** die `climateTestRingArea`-Definition ist nicht nötig (PHP hebt Funktionsdeklarationen), also einfach ans Dateiende vor die `fwrite(STDOUT, …)`-Zeile:

```php
// ---- vocabulary (Task 2) ---------------------------------------------------------------------------
// Nur die Vokabel-Hälfte: alles mit PDO ist lokal nicht prüfbar (keine lokale MySQL).

require __DIR__ . '/../ecosystem.php';

assert(in_array('klima', AVESMAPS_ECOSYSTEM_KINDS, true), 'klima is a known kind');
assert(count(AVESMAPS_ECOSYSTEM_KINDS) === 4, 'and it is the fourth');

$climateSeed = array_values(array_filter(
    AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED,
    static fn(array $row): bool => $row[0] === 'klima'
));
assert(count($climateSeed) === 7, 'seven climate zones are seeded');

$sortOrders = array_column($climateSeed, 3);
$sorted = $sortOrders;
sort($sorted);
assert($sortOrders === $sorted, 'the seed is written in north-to-south order');
assert(count(array_unique($sortOrders)) === 7, 'no two zones share a sort_order -- it decides which is north of which');

$keys = array_column($climateSeed, 1);
assert($keys === ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht', 'subtropisch', 'tropisch'],
    'the zone keys are the agreed ones, ASCII-folded');
foreach ($keys as $key) {
    assert(preg_match('/^[a-z_]+$/', $key) === 1, "zone key {$key} is ASCII-folded (AGENTS.md §5)");
}

assert(avesmapsClimateIsDerivedKind('klima') === true, 'klima areas are derived');
assert(avesmapsClimateIsDerivedKind('vegetation') === false, 'the other three are drawn');

// 🔴 Die Riegel. Sie sind der eigentliche Schutz -- ein UI-Riegel schützt vor dem Verklicken, nicht vor
// einem alten Tab, der eine Aktion noch kennt.
climateTestThrows(static fn() => avesmapsClimateAssertNotDerived('klima', 'create_area'),
    'creating a klima area by hand is refused');
avesmapsClimateAssertNotDerived('vegetation', 'create_area');   // must not throw
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/climate-zones-test.php
```

Erwartet: FAIL bei `in_array('klima', AVESMAPS_ECOSYSTEM_KINDS, true)`.

- [ ] **Step 3a: Vokabular in `api/_internal/app/ecosystem.php`**

Zeile 61 ersetzen:

```php
// 2026-08-03: `klima` ist der VIERTE Wert. Anders als die drei anderen wird er nicht gezeichnet,
// sondern ABGELEITET -- aus den Trennlinien in ecosystem_climate_divider (climate-zones.php). Für alles
// Lesende ist er trotzdem eine Ebene wie jede andere, und genau darum erben Regionen-Editor,
// „Zugehörigkeit rechnen" und die Wege-Zuordnung ihn ohne eine Zeile eigenen Code.
const AVESMAPS_ECOSYSTEM_KINDS = ['derographisch', 'vegetation', 'topographie', 'klima'];
```

Hinter der letzten Vegetations-Saatzeile (`wuestenoase`, Z. 158) einfügen:

```php
    // ---- Klimazonen (Owner 2026-08-03) --------------------------------------------------------------
    // Sieben Zonen von Nord nach Süd, abgeleitet aus sechs Trennlinien. Namen und Töne vom Owner
    // abgenommen; die Untertitel („Eiswüstenklima") stehen als Untertitel im Editor, nicht im `label`.
    //
    // 🔴 `sort_order` IST TRAGEND. Die Reihenfolge sagt, welche Zone nördlich welcher liegt, und daraus
    // folgt, welche Trennlinie welches Band begrenzt. Wer sie umsortiert, sortiert die Karte um --
    // dieselbe Falle wie beim Ortsart-Katalog (api/_internal/wiki/place-kinds.php).
    //
    // 🔴 `affects_paths` bleibt auf dem Vorgabewert 1. Anders als bei `meer` und `kontinent` sagt
    // „dieser Weg verläuft in der Tropischen Zone" etwas, und die Rechnung ist billig: ein Band hat
    // Dutzende Ecken, `Meer-001` hat 3.050.
    //
    // 💣 Jede Art braucht ihr Farbtoken --color-ecosystem-klima-<key mit - statt _>, sonst fällt
    // ecosystemAreaColor() auf den Ebenenton zurück und alle sieben Bänder sehen gleich aus.
    ['klima', 'polar', 'Polare Zone', 10],
    ['klima', 'subpolar', 'Subpolare Zone', 20],
    ['klima', 'boreal', 'Boreale Zone', 30],
    ['klima', 'gemaessigt', 'Gemäßigte Zone', 40],
    ['klima', 'subtropen_winterfeucht', 'Winterfeuchte Subtropen', 50],
    ['klima', 'subtropisch', 'Subtropische Zone', 60],
    ['klima', 'tropisch', 'Tropische Zone', 70],
```

Und oben, hinter `require_once __DIR__ . '/../text/ascii-fold.php';` (Z. 43):

```php
// Klimazonen: die reine Geometrie (Trennlinie normalisieren, Reihenfolge prüfen, Band ableiten). Eigene
// Datei, weil sie ohne Datenbank auskommt und genau deshalb lokal beweisbar ist -- hier liegt nichts,
// was ein PDO braucht.
require_once __DIR__ . '/climate-zones.php';
```

- [ ] **Step 3b: Riegel-Prädikat und DDL**

Ans Ende von `climate-zones.php` (es ist reine Logik, gehört dorthin):

```php
/**
 * Wird diese Ebene ABGELEITET statt gezeichnet?
 *
 * 🔴 Der Riegel sitzt hier und wird vom Server erzwungen, nicht nur im Menü versteckt. Ein UI-Riegel
 * schützt vor dem Verklicken; er schützt nicht vor einem Tab, der seit gestern offen ist und die alte
 * Aktion noch kennt. Und er ist die einzige Stelle, die verhindert, dass es zwei Wahrheiten über
 * dieselbe Klimagrenze gibt: die Linie und ein von Hand verschobenes Band.
 */
function avesmapsClimateIsDerivedKind(string $kind): bool
{
    return $kind === 'klima';
}

function avesmapsClimateAssertNotDerived(string $kind, string $action): void
{
    if (avesmapsClimateIsDerivedKind($kind)) {
        throw new InvalidArgumentException(
            "{$action} is not available for climate zones -- they are derived from the dividers."
        );
    }
}
```

In `avesmapsEcosystemEnsureTables()`, hinter dem `ecosystem_region_type`-Block (nach Z. 301):

```php
    // ---- Klimazonen: die Trennlinien (Owner 2026-08-03) -----------------------------------------
    // Sechs Zeilen. `seq = k` trennt Zone k (nördlich) von Zone k+1 (südlich); die Zonen sind nach
    // ecosystem_region_type.sort_order geordnet.
    //
    // 🔴 EIGENE TABELLE, und das ist kein zweites Flächensystem. Eine Trennlinie ist ein anderes Ding
    // als eine Fläche: eine Linie mit eigenen Regeln (Rand zu Rand, x streng steigend). Die BÄNDER
    // dagegen sind ganz gewöhnliche ecosystem_area-Zeilen -- dafür wird hier nichts Neues gebaut.
    //
    // 💣 UND NICHT in map_features. Dort wäre eine Klimagrenze ein WEG: routbar, suchbar, im
    // Kartenpayload, mit Label und Infobox.
    //
    // `revision` ist der optimistische Wächter, gleiche Bauart wie ecosystem_area.geometry_revision.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_climate_divider (
            seq TINYINT UNSIGNED NOT NULL,
            geometry_geojson JSON NOT NULL,
            revision INT UNSIGNED NOT NULL DEFAULT 1,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (seq)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
```

- [ ] **Step 3c: Saat und Ableitung ans Ende von `api/_internal/app/ecosystem.php`**

```php
// ---- Klimazonen: Saat und Ableitung (Owner 2026-08-03) ---------------------------------------------
//
// 💣 KEINE DIESER FUNKTIONEN LÄUFT IN avesmapsEcosystemEnsureTables(). Die DDL-Selbstheilung hebt die
// Revision nicht -- ein dort angelegter Bestand käme bei jedem warmen Client als 304 an und wäre
// unsichtbar. Genau diese Falle hat die Insel/Inselgruppe-Umstellung gekostet. Die Saat läuft im
// SCHREIB-Dispatcher, hinter der Fähigkeitsprüfung, und hebt die Revision, wenn sie etwas getan hat.

/**
 * Die sieben Klimazonen mit ihrer Region. Nach sort_order, also Nord nach Süd.
 *
 * @return list<array{type_key: string, label: string, sort_order: int, region_public_id: string}>
 */
function avesmapsEcosystemClimateZones(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT t.type_key, t.label, t.sort_order, r.public_id AS region_public_id
           FROM ecosystem_region_type t
           LEFT JOIN ecosystem_region r ON r.kind = 'klima' AND r.region_type = t.type_key AND r.is_active = 1
          WHERE t.kind = 'klima' AND t.is_active = 1
          ORDER BY t.sort_order ASC"
    );

    $zones = [];
    foreach ($statement->fetchAll() as $row) {
        $zones[] = [
            'type_key' => (string) $row['type_key'],
            'label' => (string) $row['label'],
            'sort_order' => (int) $row['sort_order'],
            'region_public_id' => $row['region_public_id'] === null ? '' : (string) $row['region_public_id'],
        ];
    }

    return $zones;
}

/**
 * Die Trennlinien, nach seq. Eine unlesbare Zeile ist ein Fehler, kein stiller Ausfall: fiele sie
 * heraus, hätte der Bestand plötzlich ein Band weniger, und die Zuordnung aller Flächen darunter
 * verschöbe sich um eine Zone.
 *
 * @return list<array{seq: int, geometry: array, revision: int}>
 */
function avesmapsEcosystemClimateReadDividers(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT seq, geometry_geojson, revision FROM ecosystem_climate_divider ORDER BY seq ASC'
    );

    $dividers = [];
    foreach ($statement->fetchAll() as $row) {
        $dividers[] = [
            'seq' => (int) $row['seq'],
            'geometry' => avesmapsClimateNormalizeDivider(
                json_decode((string) $row['geometry_geojson'], true, 512, JSON_THROW_ON_ERROR)
            ),
            'revision' => (int) $row['revision'],
        ];
    }

    return $dividers;
}

/**
 * Regionen und Trennlinien anlegen, falls sie fehlen, und danach die Bänder ableiten. Idempotent.
 *
 * @return bool ob etwas geschrieben wurde (dann hat der Aufrufer die Revision zu heben)
 */
function avesmapsEcosystemClimateEnsure(PDO $pdo, int $userId): bool
{
    avesmapsEcosystemEnsureTables($pdo);
    avesmapsEcosystemSeedRegionTypes($pdo);

    $changed = false;
    $zones = avesmapsEcosystemClimateZones($pdo);

    // 1. Fehlende Regionen. Eine je Zone, Name = das Label der Art. Der Name darf danach im
    //    Regionen-Editor geändert werden -- die Art bleibt die Wahrheit über die Zonenzugehörigkeit.
    $insertRegion = $pdo->prepare(
        "INSERT INTO ecosystem_region (public_id, name, kind, region_type, created_by, updated_by)
         VALUES (:public_id, :name, 'klima', :region_type, :user_id, :user_id2)"
    );
    foreach ($zones as $zone) {
        if ($zone['region_public_id'] !== '') {
            continue;
        }
        $insertRegion->execute([
            'public_id' => avesmapsUuidV4(),
            'name' => $zone['label'],
            'region_type' => $zone['type_key'],
            'user_id' => $userId > 0 ? $userId : null,
            'user_id2' => $userId > 0 ? $userId : null,
        ]);
        $changed = true;
    }

    // 2. Trennlinien auf die richtige Anzahl bringen: eine weniger als Zonen.
    $wanted = max(0, count($zones) - 1);
    $existing = avesmapsEcosystemClimateReadDividers($pdo);
    if (count($existing) !== $wanted) {
        // Neu aufteilen statt einzelne Zeilen anzustückeln: eine Linie, die zwischen zwei fremden
        // eingefügt wird, hat keine sinnvolle Höhe, und „irgendwo in die Mitte" wäre geraten. Der Fall
        // tritt nur auf, wenn jemand die Zonenliste ändert -- dann ist eine saubere Gleichverteilung
        // die ehrlichere Antwort als sechs alte Linien plus eine geratene.
        $pdo->exec('DELETE FROM ecosystem_climate_divider');
        $insertDivider = $pdo->prepare(
            'INSERT INTO ecosystem_climate_divider (seq, geometry_geojson, updated_by)
             VALUES (:seq, :geometry, :user_id)'
        );
        foreach (avesmapsClimateDefaultDividers($wanted) as $index => $divider) {
            $insertDivider->execute([
                'seq' => $index + 1,
                'geometry' => json_encode($divider, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'user_id' => $userId > 0 ? $userId : null,
            ]);
        }
        $changed = true;
    }

    return avesmapsEcosystemClimateRebuildBands($pdo, $userId) || $changed;
}

/**
 * Die Bänder aus den Trennlinien neu rechnen: je Zone genau EINE Fläche.
 *
 * 🔴 Die Geometrie wird nur geschrieben, wenn sie sich unterscheidet. Sonst hätte jeder Aufruf von
 * climate_get die Revision gehoben und damit jedem Besucher den Flächen-Cache entwertet.
 *
 * 💣 Ohne Transaktion um DDL herum -- ein ALTER innerhalb einer Transaktion committet sie still (siehe
 * ddl-in-transaction). avesmapsEcosystemEnsureTables läuft deshalb VOR dem beginTransaction, im
 * Aufrufer.
 *
 * @return bool ob etwas geschrieben wurde
 */
function avesmapsEcosystemClimateRebuildBands(PDO $pdo, int $userId): bool
{
    $zones = avesmapsEcosystemClimateZones($pdo);
    $dividers = avesmapsEcosystemClimateReadDividers($pdo);
    if ($zones === []) {
        return false;
    }
    avesmapsClimateAssertOrder(array_column($dividers, 'geometry'));

    $changed = false;
    $findArea = $pdo->prepare(
        'SELECT a.id, a.public_id, a.geometry_geojson
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id
          WHERE r.public_id = :region AND a.is_active = 1
          ORDER BY a.id ASC LIMIT 1'
    );

    foreach ($zones as $index => $zone) {
        if ($zone['region_public_id'] === '') {
            continue;
        }
        $band = avesmapsClimateBandGeometry(
            $index === 0 ? null : ($dividers[$index - 1]['geometry'] ?? null),
            $index >= count($dividers) ? null : ($dividers[$index]['geometry'] ?? null)
        );
        $normalized = avesmapsEcosystemNormalizeGeometry($band);
        $encoded = json_encode($normalized['geometry'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        $findArea->execute(['region' => $zone['region_public_id']]);
        $row = $findArea->fetch();

        if ($row === false) {
            $region = avesmapsEcosystemRegionRow($pdo, $zone['region_public_id']);
            $statement = $pdo->prepare(
                'INSERT INTO ecosystem_area
                    (public_id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, created_by, updated_by)
                 VALUES (:public_id, :region_id, :geometry, :min_x, :min_y, :max_x, :max_y, :user_id, :user_id2)'
            );
            $statement->execute([
                'public_id' => avesmapsUuidV4(),
                'region_id' => (int) $region['id'],
                'geometry' => $encoded,
                'min_x' => $normalized['bounds']['min_x'],
                'min_y' => $normalized['bounds']['min_y'],
                'max_x' => $normalized['bounds']['max_x'],
                'max_y' => $normalized['bounds']['max_y'],
                'user_id' => $userId > 0 ? $userId : null,
                'user_id2' => $userId > 0 ? $userId : null,
            ]);
            $changed = true;
            continue;
        }

        if ((string) $row['geometry_geojson'] === $encoded) {
            continue;
        }
        $statement = $pdo->prepare(
            'UPDATE ecosystem_area
                SET geometry_geojson = :geometry, min_x = :min_x, min_y = :min_y,
                    max_x = :max_x, max_y = :max_y,
                    geometry_revision = geometry_revision + 1, updated_by = :user_id
              WHERE id = :id'
        );
        $statement->execute([
            'geometry' => $encoded,
            'min_x' => $normalized['bounds']['min_x'],
            'min_y' => $normalized['bounds']['min_y'],
            'max_x' => $normalized['bounds']['max_x'],
            'max_y' => $normalized['bounds']['max_y'],
            'user_id' => $userId > 0 ? $userId : null,
            'id' => (int) $row['id'],
        ]);
        $changed = true;
    }

    return $changed;
}
```

- [ ] **Step 3d: Die vier Riegel setzen**

In `avesmapsCreateEcosystemRegion` (Z. 1622), direkt hinter dem `kind is required`-Wurf:

```php
    avesmapsClimateAssertNotDerived($fields['kind'], 'create_region');
```

In `avesmapsCreateEcosystemArea` (Z. 2102), direkt hinter `$region = avesmapsEcosystemRegionRow(...)`:

```php
    // 🪤 Die ABGELEITETE Ableitung selbst geht an dieser Funktion vorbei (avesmapsEcosystemClimateRebuildBands
    // schreibt direkt), genau damit dieser Riegel keine Ausnahme braucht.
    avesmapsClimateAssertNotDerived((string) $region['kind'], 'create_area');
```

In `avesmapsDeleteEcosystemRegion` (Z. 1776) und `avesmapsDeleteEcosystemArea` (Z. 2206), jeweils direkt hinter dem Laden der Zeile (`$row = avesmapsEcosystem…Row(…)`):

```php
    avesmapsClimateAssertNotDerived((string) ($row['kind'] ?? ''), 'delete_region');
```
bzw. — `avesmapsEcosystemAreaRow` liefert `kind` nicht mit, also über die Region:
```php
    avesmapsClimateAssertNotDerived(
        (string) (avesmapsEcosystemRegionRow($pdo, (string) $row['region_public_id'], false)['kind'] ?? ''),
        'delete_area'
    );
```

> **Prüfen beim Bauen:** ob `avesmapsEcosystemAreaRow()` bereits `region_public_id` und/oder `kind` mitliefert. Wenn `kind` dabei ist, den direkten Weg nehmen; wenn nicht einmal `region_public_id`, den JOIN in `avesmapsEcosystemAreaRow` um `r.kind AS kind` erweitern und den Riegel darauf setzen. Kein zweiter Query, wenn ein Feld reicht.

Ebenso in `avesmapsUpdateEcosystemAreaGeometry` (Z. 2153) und `avesmapsUpdateEcosystemAreaTerrain` (Z. 2331) — dieselbe Zeile mit `'update_area_geometry'` bzw. `'update_area_terrain'`.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/climate-zones-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/ecosystem-geometry-test.php
```

Erwartet: beide OK. Der zweite prüft, dass die vier neuen Saatzeilen den bestehenden Vokabeltest nicht brechen.

- [ ] **Step 5: Committen**

```bash
git add api/_internal/app/climate-zones.php api/_internal/app/ecosystem.php api/_internal/app/__tests__/climate-zones-test.php
git commit -m "feat(landschaften): Klimazonen als vierte Ebene im Vokabular, mit Saat und Ableitung"
```

---

## Task 3: Die drei API-Aktionen

**Files:**
- Modify: `api/edit/map/ecosystem.php:56-128` (Dispatcher), `api/_internal/app/ecosystem.php` (Handler ans Ende)
- Modify: `api/app/ecosystem-areas.php:44`

**Interfaces:**
- Consumes: Task 2 vollständig
- Produces:
  - `avesmapsEcosystemClimateGet(PDO $pdo, int $userId): array` → `['dividers' => […], 'zones' => […], 'revision' => int]`
  - `avesmapsEcosystemClimateSaveDivider(PDO $pdo, array $payload, int $userId): array`
  - `avesmapsEcosystemClimateReset(PDO $pdo, int $userId): array`

- [ ] **Step 1: Handler schreiben** (`api/_internal/app/ecosystem.php`, ans Ende)

```php
/**
 * Was der Karten-Editor beim Betreten der Ebene holt. Sät nebenbei, falls noch nichts da ist.
 */
function avesmapsEcosystemClimateGet(PDO $pdo, int $userId): array
{
    $changed = avesmapsEcosystemClimateEnsure($pdo, $userId);
    $revision = $changed ? avesmapsNextEcosystemRevision($pdo) : avesmapsReadEcosystemRevision($pdo);

    return [
        'dividers' => avesmapsEcosystemClimateReadDividers($pdo),
        'zones' => avesmapsEcosystemClimateZones($pdo),
        'revision' => $revision,
    ];
}

/**
 * Eine Trennlinie speichern. Prüft die Linie für sich, danach die Reihenfolge im Verbund, leitet die
 * Bänder ab und hebt die Revision.
 *
 * 🔴 Die Reihenfolge wird gegen den SCHON GESPEICHERTEN Verbund geprüft, mit der neuen Linie an ihrem
 * Platz -- nicht gegen das, was der Client mitschickt. Der Client klemmt beim Ziehen, aber ein zweiter
 * Editor kann die Nachbarlinie inzwischen verschoben haben.
 */
function avesmapsEcosystemClimateSaveDivider(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $seq = filter_var($payload['seq'] ?? null, FILTER_VALIDATE_INT);
    if ($seq === false || $seq < 1) {
        throw new InvalidArgumentException('seq must be the 1-based index of the divider.');
    }
    $expectedRevision = avesmapsEcosystemReadExpectedRevision($payload['expected_revision'] ?? null);
    $geometry = avesmapsClimateNormalizeDivider($payload['geometry_geojson'] ?? $payload['geometry'] ?? null);

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'SELECT seq, geometry_geojson, revision FROM ecosystem_climate_divider WHERE seq = :seq FOR UPDATE'
        );
        $statement->execute(['seq' => $seq]);
        $row = $statement->fetch();
        if ($row === false) {
            throw new InvalidArgumentException("There is no divider with seq {$seq}.");
        }
        if ((int) $row['revision'] !== $expectedRevision) {
            throw new AvesmapsConflictException(
                'This divider was changed by someone else. Reload and try again.'
            );
        }

        $before = ['geometry' => json_decode((string) $row['geometry_geojson'], true, 512, JSON_THROW_ON_ERROR)];

        $dividers = avesmapsEcosystemClimateReadDividers($pdo);
        foreach ($dividers as $index => $divider) {
            if ($divider['seq'] === $seq) {
                $dividers[$index]['geometry'] = $geometry;
            }
        }
        avesmapsClimateAssertOrder(array_column($dividers, 'geometry'));

        $update = $pdo->prepare(
            'UPDATE ecosystem_climate_divider
                SET geometry_geojson = :geometry, revision = revision + 1, updated_by = :user_id
              WHERE seq = :seq'
        );
        $update->execute([
            'geometry' => json_encode($geometry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'user_id' => $userId > 0 ? $userId : null,
            'seq' => $seq,
        ]);

        avesmapsEcosystemClimateRebuildBands($pdo, $userId);
        // Die Bewegung wird protokolliert; RÜCKGÄNGIG nimmt sie in dieser Fassung nicht zurück
        // (Entwurf §11) -- avesmapsEcosystemCanUndoAction kennt 'update_climate_divider' nicht.
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'update_climate_divider',
            $userId,
            null,
            null,
            $before,
            ['geometry' => $geometry]
        );
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'dividers' => avesmapsEcosystemClimateReadDividers($pdo),
        'revision' => $revision,
    ];
}

/**
 * Alle Trennlinien zurück auf die gleichmäßige Startaufteilung.
 */
function avesmapsEcosystemClimateReset(PDO $pdo, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $count = max(0, count(avesmapsEcosystemClimateZones($pdo)) - 1);
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM ecosystem_climate_divider');
        $insert = $pdo->prepare(
            'INSERT INTO ecosystem_climate_divider (seq, geometry_geojson, updated_by)
             VALUES (:seq, :geometry, :user_id)'
        );
        foreach (avesmapsClimateDefaultDividers($count) as $index => $divider) {
            $insert->execute([
                'seq' => $index + 1,
                'geometry' => json_encode($divider, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'user_id' => $userId > 0 ? $userId : null,
            ]);
        }
        avesmapsEcosystemClimateRebuildBands($pdo, $userId);
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['dividers' => avesmapsEcosystemClimateReadDividers($pdo), 'revision' => $revision];
}
```

- [ ] **Step 2: In den Dispatcher hängen** (`api/edit/map/ecosystem.php`, im `match ($action)` vor `default`)

```php
        // Klimazonen (Owner 2026-08-03). Die sechs Trennlinien sind die Wahrheit; die sieben Bänder
        // entstehen daraus bei jedem Speichern. Es gibt bewusst KEIN climate_delete: wie viele Linien
        // es gibt, folgt aus wie vielen Zonen es gibt.
        //
        // 💣 `climate_get` SÄT. Das gehört hierher und nicht in die DDL-Selbstheilung: die hebt die
        // Revision nicht, und ein dort angelegter Bestand käme bei jedem warmen Client als 304 an.
        'climate_get' => avesmapsEcosystemClimateGet($pdo, $userId),
        'climate_save_divider' => avesmapsEcosystemClimateSaveDivider($pdo, $payload, $userId),
        'climate_reset' => avesmapsEcosystemClimateReset($pdo, $userId),
```

- [ ] **Step 3: Payload-Version heben** (`api/app/ecosystem-areas.php:44`)

```php
// 6 (2026-08-03): die vierte Ebene `klima`. Die FORM ändert sich nicht -- ein Band ist eine Fläche wie
// jede andere --, aber ein warmer Client bekäme über 304 einen Bestand ohne die neuen Bänder und
// zeigte einen leeren Reiter „Klimazonen", während der Server sie längst hat.
const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 6;
```

- [ ] **Step 4: Prüfen, dass die Datei syntaktisch heil ist und der Dispatcher lokal antwortet**

```bash
php -l api/_internal/app/ecosystem.php && php -l api/edit/map/ecosystem.php && php -l api/app/ecosystem-areas.php && php -l api/_internal/app/climate-zones.php
```

Erwartet: viermal `No syntax errors detected`.

Dann die Sonde nach `php-js-test-commands` — sie beweist, dass die neue Aktion hinter der Fähigkeitsprüfung liegt (anonym 401, nicht 400):

```bash
AVESMAPS_DB_DRIVER=mysql AVESMAPS_DB_HOST=127.0.0.1 AVESMAPS_DB_PORT=1 AVESMAPS_DB_NAME=x \
AVESMAPS_DB_USER=x AVESMAPS_DB_PASSWORD=x php -d extension=php_mbstring.dll -r '
$_SERVER["REQUEST_METHOD"]="POST";
register_shutdown_function(function(){ fwrite(STDERR, "status=".http_response_code()."\n"); });
require "api/edit/map/ecosystem.php";'
```

Erwartet: `status=401` — die Rechteprüfung (Z. 42) steht **vor** `avesmapsReadJsonRequest` (Z. 43), ein anonymer Aufruf kommt also nie an der Aktion an.

- [ ] **Step 5: Committen**

```bash
git add api/_internal/app/ecosystem.php api/edit/map/ecosystem.php api/app/ecosystem-areas.php
git commit -m "feat(landschaften): Klimazonen holen, Trennlinie speichern, Aufteilung zuruecksetzen"
```

---

## Task 4: Die vierte Ebene auf der Karte sichtbar machen

Nach dieser Aufgabe zeigt der Umschalter „Klimazonen" und die Bänder werden gezeichnet — noch ohne Bearbeitung.

**Files:**
- Modify: `js/map-features/map-features-ecosystem-rendering.js:17-58`
- Modify: `js/app/bootstrap.js:75-84`
- Modify: `index.html:627-638`
- Modify: `css/base/tokens.css` (hinter `--color-ecosystem-topographie-insel`)
- Modify: `css/features/ecosystem-layer.css` (hinter der derographischen 0,1-Regel, Z. 1254)
- Modify: `js/app/i18n-en.js:134-137`

**Interfaces:**
- Consumes: Task 3 (die Bänder liegen in der Datenbank)
- Produces: `ECOSYSTEM_KINDS` enthält `"klima"`; Pane `ecosystemPaneKlima` (z-index 253) und `ecosystemPaneKlimaLines` (z-index 455)

- [ ] **Step 1: Tokens** (`css/base/tokens.css`, hinter `--color-ecosystem-topographie-insel`)

```css
	/* Klimazonen (Owner 2026-08-03). Sieben Bänder von Nord nach Süd, abgeleitet aus sechs
	   Trennlinien. Bewusst KEINE Grün-Skala: Grün gehört der Vegetation, und beide Ebenen müssen
	   nebeneinander unterscheidbar bleiben. Dies ist eine reine TEMPERATURSKALA -- Eis, blass, neutral,
	   gold, warm --, die von selbst „oben kalt, unten heiss" liest.
	   💣 Die Namensregel ist bindend: --color-ecosystem-klima-<type_key mit - statt _>. Fehlt ein Ton,
	   fällt ecosystemAreaColor() auf den Ebenenton zurück und alle sieben Bänder sehen gleich aus.
	   Die kühlen Töne sind dieselbe bewusste Ausnahme von „kein Blau" wie See und Meer: gemalte
	   KARTENDATEN, nicht UI-Chrom (§12). Gepinnt, sie liegen auf den immer hellen Kacheln. */
	--color-ecosystem-klima: #C9CF9B;
	--color-ecosystem-klima-polar: #E6EEF3;
	--color-ecosystem-klima-subpolar: #BCD3DC;
	--color-ecosystem-klima-boreal: #8FB6B4;
	--color-ecosystem-klima-gemaessigt: #C9CF9B;
	--color-ecosystem-klima-subtropen-winterfeucht: #E0C274;
	--color-ecosystem-klima-subtropisch: #DD9C55;
	--color-ecosystem-klima-tropisch: #CC6F45;
	/* Die Trennlinie selbst und ihre Beschriftung. Ein neutrales Dunkel, das auf allen sieben Tönen
	   sitzt -- dieselbe Begründung wie bei --color-ecosystem-topographie-contour. */
	--color-ecosystem-klima-divider: #2b3138;
	--color-ecosystem-klima-label: #33302b;
```

- [ ] **Step 2: Die fünf Tabellen erweitern** (`js/map-features/map-features-ecosystem-rendering.js`)

```javascript
// Display order of the segment switch AND the pane stack, low to high: the derographic containers
// (continents, islands) sit at the bottom, topography on top, and the climate bands above all of them --
// sie decken die ganze Karte und wären unter allem anderen nicht zu sehen.
const ECOSYSTEM_KINDS = ["derographisch", "vegetation", "topographie", "klima"];

const ECOSYSTEM_KIND_LABELS = {
	derographisch: "Derographie",
	vegetation: "Vegetation",
	topographie: "Topographie",
	klima: "Klimazonen",
};
```

und in `ECOSYSTEM_KIND_PREFIX` `klima: "Klima"`, in `ECOSYSTEM_KIND_PANES` `klima: "ecosystemPaneKlima"`, in `ECOSYSTEM_KIND_COLOR_TOKENS` `klima: "--color-ecosystem-klima"`.

- [ ] **Step 3: Panes** (`js/app/bootstrap.js`, hinter Z. 77)

```javascript
// V-Klima (2026-08-03): die Bänder liegen ÜBER den drei gezeichneten Ebenen -- sie decken die ganze
// Karte, unter Vegetation und Topographie wären sie nicht zu sehen. Ihre Füllung ist dafür sehr leicht
// (css/features/ecosystem-layer.css).
map.getPane("ecosystemPaneKlima").style.zIndex = 253;
// Die Trennlinien und die Zonennamen: eigene Pane, damit sie NICHT die Ebenen-Zustandsklassen der
// ecosystem-panes tragen (blass/ruhend). Sie sind Bedienelemente, keine Daten -- und sie müssen über
// den Wegen liegen, sonst zieht man eine Linie, die unter einer Reichsstraße verschwindet.
map.getPane("ecosystemPaneKlimaLines").style.zIndex = 455;
```

und in der Klassenliste darunter `["ecosystemPaneKlima", "klima"]` ergänzen.

- [ ] **Step 4: Umschalter-Kachel** (`index.html`, hinter Z. 637)

Den irreführenden Kommentar an Z. 629 zuerst berichtigen:

```html
					<!-- 💣 „Alle" trägt BEWUSST KEIN data-ecosystem-kind. Dieses Attribut ist der Schlüssel des
					     Ebenen-Zustands: er reist zum Server (list_regions, create_region), und
					     AVESMAPS_ECOSYSTEM_KINDS kennt genau VIER Werte (seit 2026-08-03 auch `klima`) --
					     „alle" ist keiner davon, gäbe dort 400, und isKnownEcosystemKind("alle") ist falsch,
					     also fiele der gemerkte Wert still auf die Vorgabe zurück. „Alle" ist deshalb ein
					     ANZEIGE-Flag neben dem Ebenen-Zustand, kein weiterer Wert davon. Ausserdem stempelt
					     syncEcosystemLayerSwitchControls jedes [data-ecosystem-kind] im ganzen Dokument. -->
```

und die Kachel:

```html
					<button class="ecosystem-layer-switch__tab" type="button" role="tab" data-ecosystem-kind="klima" aria-selected="false" tabindex="-1" data-i18n="ecosystem.kind.klima">Klimazonen</button>
```

Im selben Zug die Derographie-Kachel (Z. 635) auf `Derographie` umschreiben — das ist die Umbenennung aus §10 des Entwurfs, sie gehört in dieselbe Zeilengruppe.

- [ ] **Step 5: CSS** (`css/features/ecosystem-layer.css`, hinter der derographischen Regel Z. 1254)

```css
/* 🔴 DIE KLIMA-EBENE NIMMT SICH NOCH STÄRKER ZURÜCK ALS DIE DEROGRAPHISCHE. Ein Band deckt die GANZE
   Karte in seiner Höhe -- bei voller Füllung sieht man weder die Kacheln noch irgendeine andere Ebene.
   0,18 lässt das Gelände durch und macht die Zone trotzdem auf einen Blick lesbar.

   🪤 KEINE KONTUR. Die Kante eines Bandes IST die Trennlinie, und die wird in ihrer eigenen Pane
   gezeichnet (map-features-ecosystem-climate.js). Eine zweite Linie an derselben Stelle wäre dieselbe
   Aussage doppelt -- und sie würde beim Ziehen der Griffe hinterherhinken.

   Die Bedingung ist `--active`, was BEIDE Fälle deckt: in „Alle" trägt jede Pane zusätzlich `--active`
   (syncEcosystemPaneStates). Dieselbe Bauart wie bei der derographischen Regel darüber. */
.ecosystem-pane--klima.ecosystem-pane--active > svg path.leaflet-interactive {
	fill-opacity: 0.18;
	stroke-opacity: 0;
}
```

- [ ] **Step 6: i18n** (`js/app/i18n-en.js`)

```javascript
	"ecosystem.kind.derographisch": "Derography",
	"ecosystem.kind.klima": "Climate zones",
```

- [ ] **Step 7: Prüfen**

```bash
node -e "require('fs').readFileSync('js/map-features/map-features-ecosystem-rendering.js','utf8'); console.log('read ok')"
node --check js/map-features/map-features-ecosystem-rendering.js && node --check js/app/bootstrap.js && node --check js/app/i18n-en.js
```

Erwartet: keine Syntaxfehler. Dann `grep`-Gegenprobe, dass jede Zonenart ihr Token hat:

```bash
for k in polar subpolar boreal gemaessigt subtropen-winterfeucht subtropisch tropisch; do
  grep -q -- "--color-ecosystem-klima-$k:" css/base/tokens.css || echo "FEHLT: $k"
done; echo "Token-Probe fertig"
```

Erwartet: nur `Token-Probe fertig`.

- [ ] **Step 8: Committen**

```bash
git add js/map-features/map-features-ecosystem-rendering.js js/app/bootstrap.js index.html css/base/tokens.css css/features/ecosystem-layer.css js/app/i18n-en.js
git commit -m "feat(landschaften): der Karten-Umschalter bekommt die vierte Ebene \"Klimazonen\""
```

---

## Task 5: Der Trennlinien-Editor auf der Karte

**Files:**
- Create: `js/map-features/map-features-ecosystem-climate.js`
- Test: `js/map-features/__tests__/ecosystem-climate.test.js`
- Modify: `index.html` (ein `<script>` hinter `map-features-ecosystem-edit.js`, Z. 2214)
- Modify: `js/map-features/map-features-ecosystem-layer-switch.js` (Aufruf in `syncEcosystemPaneStates`)
- Modify: `css/features/ecosystem-layer.css` (gepinnter Griff, Zonenname)

**Interfaces:**
- Consumes: `postEcosystemEdit(action, payload)` aus `js/map-features/map-features-ecosystem-region-store.js:82`; `getActiveEcosystemLayerKind()`, `isEcosystemLayerModeActive()` aus dem Layer-Switch; `scheduleEcosystemAreaReload({immediate})` aus dem Loader; `IS_EDIT_MODE`
- Produces: globale reine Funktionen `climateClampVertexY`, `climateClampVertexX`, `climateInsertionIndex`, `climateYAtX` (für den Test), und `window.AvesmapsEcosystemClimate = { sync }`

- [ ] **Step 1: Den Test der reinen Logik schreiben**

`js/map-features/__tests__/ecosystem-climate.test.js`:

```javascript
// Unit test for the PURE half of the climate-divider editor: where a dragged handle may go, and where
// a new point is inserted. Everything Leaflet-bound (panes, markers, drag events) is not testable here
// -- js/map-features/ is loaded as bare <script>, so the test installs the file's globals by hand.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-climate.js"), "utf8");
const context = {
	console,
	window: {},
	document: { getElementById: () => null, querySelectorAll: () => [] },
	L: undefined,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		process.exit(1);
	}
}

// ---- y at x --------------------------------------------------------------------------------------

const straight = [[0, 800], [1024, 800]];
assert(context.climateYAtX(straight, 512) === 800, "y is constant on a straight divider");

const ramp = [[0, 100], [1024, 200]];
assert(Math.abs(context.climateYAtX(ramp, 512) - 150) < 1e-9, "y interpolates linearly");
assert(context.climateYAtX(ramp, -50) === 100, "left of the line: the first y");
assert(context.climateYAtX(ramp, 2000) === 200, "right of the line: the last y");

// ---- clamping a dragged handle ---------------------------------------------------------------------
// 🔴 Das ist die Stelle, an der „keine Überlappung" für den Benutzer FÜHLBAR wird: der Griff stoppt am
// Nachbarn, statt hinterher eine Fehlermeldung zu bekommen.

const north = [[0, 900], [1024, 900]];
const south = [[0, 500], [1024, 500]];

assert(context.climateClampVertexY(700, 512, north, south) === 700, "inside the corridor: unchanged");
assert(context.climateClampVertexY(950, 512, north, south) === 900 - 1, "clamped one unit below the northern neighbour");
assert(context.climateClampVertexY(400, 512, north, south) === 500 + 1, "clamped one unit above the southern neighbour");
assert(context.climateClampVertexY(2000, 512, null, south) === 1024, "no northern neighbour: the map edge");
assert(context.climateClampVertexY(-40, 512, north, null) === 0, "no southern neighbour: the map edge");

// ---- clamping x ------------------------------------------------------------------------------------

assert(context.climateClampVertexX(400, 300, 600) === 400, "inside: unchanged");
assert(context.climateClampVertexX(290, 300, 600) === 300 + 1, "cannot pass the previous point");
assert(context.climateClampVertexX(700, 300, 600) === 600 - 1, "cannot pass the next point");

// ---- where a new point goes ------------------------------------------------------------------------

const bent = [[0, 900], [400, 880], [1024, 910]];
assert(context.climateInsertionIndex(bent, 200) === 1, "a click in the first segment inserts at 1");
assert(context.climateInsertionIndex(bent, 700) === 2, "a click in the second segment inserts at 2");
assert(context.climateInsertionIndex(bent, 0) === 1, "exactly on the left end still lands inside");
assert(context.climateInsertionIndex(bent, 1024) === 2, "exactly on the right end lands in the last segment");

console.log("ecosystem-climate.test: OK");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/ecosystem-climate.test.js
```

Erwartet: `ENOENT` — die Modul-Datei fehlt noch.

- [ ] **Step 3: `js/map-features/map-features-ecosystem-climate.js` schreiben**

```javascript
// Klimazonen -- der Trennlinien-Editor auf der Karte (Entwurf
// docs/superpowers/specs/2026-08-03-klimazonen-design.md §8.4).
//
// 🔴 DIESE DATEI BEARBEITET LINIEN, NIE FLÄCHEN. Die sieben Bänder sind abgeleitet; sie kommen als
// gewöhnliche Flächen aus dem Loader und werden hier nur neu geladen, nachdem der Server sie
// nachgerechnet hat. Wer hier anfängt, ein Band anzufassen, baut die zweite Wahrheit ein, die der
// ganze Entwurf vermeidet.
//
// 🔴 KOORDINATEN. Auf dem Draht GeoJSON [x, y]; Leaflet will [lat, lng] = [y, x]. Gedreht wird HIER
// und nur hier (AGENTS.md §5). Norden ist hohes y.

const CLIMATE_MIN_XY = 0;
const CLIMATE_MAX_XY = 1024;

// Derselbe Mindestabstand, den der Server erzwingt (AVESMAPS_CLIMATE_MIN_GAP). Der Client klemmt
// damit VOR dem Speichern, statt eine Fehlermeldung abzuholen -- aber die Wahrheit steht auf dem
// Server, und der prüft noch einmal: ein zweiter Editor kann die Nachbarlinie inzwischen bewegt haben.
const CLIMATE_MIN_GAP = 1;

// ---- reine Rechnerei (unit-getestet) ---------------------------------------------------------------

function climateYAtX(coordinates, x) {
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return 0;
	}
	if (x <= coordinates[0][0]) {
		return coordinates[0][1];
	}
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const [ax, ay] = coordinates[index];
		const [bx, by] = coordinates[index + 1];
		if (x >= ax && x <= bx) {
			const span = bx - ax;
			return span <= 0 ? ay : ay + ((x - ax) / span) * (by - ay);
		}
	}
	return coordinates[coordinates.length - 1][1];
}

// Wohin darf dieser Griff senkrecht? `north`/`south` sind die Nachbarlinien als Koordinatenlisten oder
// null (dann gilt der Kartenrand).
function climateClampVertexY(y, x, north, south) {
	const upper = north ? climateYAtX(north, x) - CLIMATE_MIN_GAP : CLIMATE_MAX_XY;
	const lower = south ? climateYAtX(south, x) + CLIMATE_MIN_GAP : CLIMATE_MIN_XY;
	return Math.max(lower, Math.min(upper, y));
}

// Und waagerecht? Ein Griff darf seine Nachbarn nicht überholen -- sonst wäre x nicht mehr streng
// steigend, und genau daran hängt die ganze Konstruktion (siehe climate-zones.php).
function climateClampVertexX(x, previousX, nextX) {
	return Math.max(previousX + CLIMATE_MIN_GAP, Math.min(nextX - CLIMATE_MIN_GAP, x));
}

// An welcher Stelle der Punktliste landet ein Klick bei x? Immer mindestens 1 und höchstens
// length - 1: die beiden Randpunkte sind Pflicht und dürfen nicht verdrängt werden.
function climateInsertionIndex(coordinates, x) {
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		if (x > coordinates[index][0] && x < coordinates[index + 1][0]) {
			return index + 1;
		}
	}
	return x <= coordinates[0][0] ? 1 : coordinates.length - 1;
}

// ---- Zustand ---------------------------------------------------------------------------------------

let climateDividers = null;      // [{seq, geometry:{type,coordinates}, revision}] -- null = nie geholt
let climateZones = [];           // [{type_key, label, sort_order, region_public_id}]
let climateLineLayers = [];
let climateHandles = [];
let climateLabelMarkers = [];
let climateSaving = false;

function isClimateEditorActive() {
	return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		&& typeof getActiveEcosystemLayerKind === "function" && getActiveEcosystemLayerKind() === "klima"
		&& typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
}

function climateNeighbour(index, offset) {
	const neighbour = (climateDividers || [])[index + offset];
	return neighbour ? neighbour.geometry.coordinates : null;
}

// ---- Zeichnen --------------------------------------------------------------------------------------

function clearClimateOverlay() {
	[...climateLineLayers, ...climateHandles, ...climateLabelMarkers].forEach((layer) => {
		if (typeof map !== "undefined" && map && map.hasLayer(layer)) {
			map.removeLayer(layer);
		}
	});
	climateLineLayers = [];
	climateHandles = [];
	climateLabelMarkers = [];
}

function drawClimateOverlay() {
	clearClimateOverlay();
	if (typeof map === "undefined" || !map || !Array.isArray(climateDividers)) {
		return;
	}

	const color = getComputedStyle(document.documentElement)
		.getPropertyValue("--color-ecosystem-klima-divider").trim();

	climateDividers.forEach((divider, dividerIndex) => {
		const latlngs = divider.geometry.coordinates.map(([x, y]) => [y, x]);
		const line = L.polyline(latlngs, {
			pane: "ecosystemPaneKlimaLines",
			color,
			weight: 2,
			interactive: true,
		}).addTo(map);
		// Klick auf die Linie setzt einen Punkt. `L.DomEvent.stop` verhindert, dass derselbe Klick
		// zusätzlich die Karte trifft und dort die Flächenauswahl aufhebt.
		line.on("click", (event) => {
			L.DomEvent.stop(event);
			insertClimateVertex(dividerIndex, event.latlng);
		});
		climateLineLayers.push(line);

		divider.geometry.coordinates.forEach((position, pointIndex) => {
			const isEdge = pointIndex === 0 || pointIndex === divider.geometry.coordinates.length - 1;
			const handle = L.marker([position[1], position[0]], {
				pane: "markerPane",
				draggable: true,
				keyboard: false,
				bubblingMouseEvents: false,
				icon: L.divIcon({
					className: "path-edit-handle-marker ecosystem-edit-handle-marker"
						+ (isEdge ? " ecosystem-climate-handle--pinned" : ""),
					html: '<span class="path-edit-handle-marker__dot"></span>',
					iconSize: [14, 14],
					iconAnchor: [7, 7],
				}),
			}).addTo(map);

			handle.on("drag", (event) => {
				const target = event.target.getLatLng();
				const moved = climateVertexTarget(dividerIndex, pointIndex, isEdge, target);
				event.target.setLatLng([moved[1], moved[0]]);
				divider.geometry.coordinates[pointIndex] = moved;
				climateLineLayers[dividerIndex].setLatLngs(
					divider.geometry.coordinates.map(([x, y]) => [y, x])
				);
			});
			// 💣 Beim dragend NICHT synchron neu zeichnen -- der Kartenpunkt-Editor hat genau das
			// gekostet. Speichern anstossen, Antwort abwarten, dann zeichnen (siehe saveClimateDivider).
			handle.on("dragend", () => { void saveClimateDivider(dividerIndex); });

			const element = handle.getElement?.();
			if (element) {
				L.DomEvent.disableClickPropagation(element);
				// 💣 LÖSCHEN HÄNGT AN EINEM NATIVEN LISTENER. `handle.on("dblclick")` feuert hier nicht
				// zuverlässig -- an genau dieser Stelle ist der Flächen-Editor schon einmal
				// gescheitert (map-features-ecosystem-edit.js:576).
				if (!isEdge) {
					element.addEventListener("dblclick", (nativeEvent) => {
						nativeEvent.preventDefault();
						nativeEvent.stopPropagation();
						removeClimateVertex(dividerIndex, pointIndex);
					});
				}
			}
			climateHandles.push(handle);
		});
	});

	drawClimateZoneNames();
}

// Der Zonenname am Westrand seines Bandes.
// 🔴 KEIN map_features-Label. Ein echtes Karten-Label bräuchte einen neuen Subtyp in der Allowlist,
// liefe durch die Kollisionsauflösung und stünde auf der normalen Karte. Der Name gehört zur Ebene,
// nicht zur Karte -- er verschwindet mit ihr.
function drawClimateZoneNames() {
	const anchorX = 40;
	climateZones.forEach((zone, zoneIndex) => {
		const north = zoneIndex === 0 ? null : climateNeighbour(zoneIndex - 1, 0);
		const south = zoneIndex >= (climateDividers || []).length ? null : climateNeighbour(zoneIndex, 0);
		const top = north ? climateYAtX(north, anchorX) : CLIMATE_MAX_XY;
		const bottom = south ? climateYAtX(south, anchorX) : CLIMATE_MIN_XY;
		if (top - bottom < 8) {
			return;
		}
		const marker = L.marker([(top + bottom) / 2, anchorX], {
			pane: "ecosystemPaneKlimaLines",
			interactive: false,
			keyboard: false,
			icon: L.divIcon({
				className: "ecosystem-climate-name",
				html: `<span>${escapeHtml(zone.label)}</span>`,
				iconSize: null,
			}),
		}).addTo(map);
		climateLabelMarkers.push(marker);
	});
}

// ---- Gesten ----------------------------------------------------------------------------------------

function climateVertexTarget(dividerIndex, pointIndex, isEdge, latlng) {
	const coordinates = climateDividers[dividerIndex].geometry.coordinates;
	// Ein Randgriff behält sein x. Deshalb wird auch der Korridor an seinem ALTEN x gemessen, nicht
	// dort, wo die Maus gerade steht.
	const x = isEdge
		? coordinates[pointIndex][0]
		: climateClampVertexX(latlng.lng, coordinates[pointIndex - 1][0], coordinates[pointIndex + 1][0]);
	const y = climateClampVertexY(
		latlng.lat,
		x,
		climateNeighbour(dividerIndex, -1),
		climateNeighbour(dividerIndex, 1)
	);
	return [x, y];
}

function insertClimateVertex(dividerIndex, latlng) {
	const divider = climateDividers[dividerIndex];
	const index = climateInsertionIndex(divider.geometry.coordinates, latlng.lng);
	const x = climateClampVertexX(
		latlng.lng,
		divider.geometry.coordinates[index - 1][0],
		divider.geometry.coordinates[index][0]
	);
	const y = climateClampVertexY(latlng.lat, x, climateNeighbour(dividerIndex, -1), climateNeighbour(dividerIndex, 1));
	divider.geometry.coordinates.splice(index, 0, [x, y]);
	void saveClimateDivider(dividerIndex);
}

function removeClimateVertex(dividerIndex, pointIndex) {
	const divider = climateDividers[dividerIndex];
	// Die beiden Randpunkte sind Pflicht: ohne sie hört die Linie vor dem Kartenrand auf, und das Band
	// darunter bekäme eine Lücke. Der Doppelklick-Listener wird für sie gar nicht erst gehängt; diese
	// Prüfung ist der zweite Riegel für den Fall, dass jemand die Funktion anderswoher ruft.
	if (pointIndex <= 0 || pointIndex >= divider.geometry.coordinates.length - 1) {
		return;
	}
	divider.geometry.coordinates.splice(pointIndex, 1);
	void saveClimateDivider(dividerIndex);
}

// ---- Speichern -------------------------------------------------------------------------------------

async function saveClimateDivider(dividerIndex) {
	if (climateSaving) {
		return;
	}
	const divider = climateDividers[dividerIndex];
	climateSaving = true;
	try {
		const result = await postEcosystemEdit("climate_save_divider", {
			seq: divider.seq,
			geometry_geojson: divider.geometry,
			expected_revision: divider.revision,
		});
		climateDividers = result.dividers || climateDividers;
		drawClimateOverlay();
		// Die Bänder hat der Server nachgerechnet -- sie kommen über den gewöhnlichen Flächenweg zurück.
		if (typeof scheduleEcosystemAreaReload === "function") {
			scheduleEcosystemAreaReload({ immediate: true });
		}
	} catch (error) {
		// 🔴 Bei einem Fehlschlag den SERVERSTAND wiederherstellen, nicht den lokalen behalten. Sonst
		// sieht der Editor eine Linie, die es nicht gibt, und jeder weitere Zug baut darauf auf.
		console.warn("Klimazone konnte nicht gespeichert werden:", error);
		if (typeof showToast === "function") {
			showToast("Die Trennlinie konnte nicht gespeichert werden: " + (error?.message || ""), "warning");
		}
		climateDividers = null;
		await loadClimateDividers();
	} finally {
		climateSaving = false;
	}
}

async function loadClimateDividers() {
	const result = await postEcosystemEdit("climate_get", {});
	climateDividers = result.dividers || [];
	climateZones = result.zones || [];
	drawClimateOverlay();
}

// ---- Eintrittspunkt --------------------------------------------------------------------------------
// Von syncEcosystemPaneStates gerufen, also bei jedem Ebenenwechsel und bei jedem Moduswechsel.

function syncEcosystemClimateEditor() {
	if (!isClimateEditorActive()) {
		clearClimateOverlay();
		return;
	}
	if (climateDividers === null) {
		void loadClimateDividers().catch((error) => {
			console.warn("Klimazonen konnten nicht geladen werden:", error);
			climateDividers = null;
		});
		return;
	}
	drawClimateOverlay();
}

window.AvesmapsEcosystemClimate = { sync: syncEcosystemClimateEditor };
```

- [ ] **Step 4: Einhängen**

In `js/map-features/map-features-ecosystem-layer-switch.js`, in `syncEcosystemPaneStates()` direkt hinter `window.AvesmapsEcosystemHeightRender?.redraw?.();`:

```javascript
	// V-Klima: die Trennlinien hängen an derselben Frage wie das Relief -- welche Ebene liegt vorn. Sie
	// räumen sich bei jeder anderen Lage selbst ab, das Umschalten löscht sie also von allein.
	window.AvesmapsEcosystemClimate?.sync?.();
```

In `index.html` hinter Z. 2214 (`map-features-ecosystem-edit.js`):

```html
		<!-- V-Klima (2026-08-03): der Trennlinien-Editor. MUSS nach ecosystem-region-store.js stehen
		     (ruft postEcosystemEdit) und nach ecosystem-layer-switch.js, dessen syncEcosystemPaneStates
		     ihn anstösst. Er bearbeitet LINIEN -- die sieben Bänder sind abgeleitet und kommen über den
		     gewöhnlichen Flächenweg. -->
		<script src="js/map-features/map-features-ecosystem-climate.js"></script>
```

In `css/features/ecosystem-layer.css`, ans Ende:

```css
/* ---- Klimazonen: Trennlinien (Owner 2026-08-03) ---------------------------------------------------
   Ein Randgriff ist ECKIG statt rund. Das ist keine Verzierung: er lässt sich nur senkrecht bewegen,
   und die Form ist die einzige Stelle, an der das VOR dem ersten Ziehversuch zu sehen ist. Er behält
   dieselbe Farbe wie jeder andere Bearbeitungsgriff im Haus -- gleiche Bedeutung, gleicher Ton. */
.ecosystem-climate-handle--pinned .path-edit-handle-marker__dot {
	border-radius: var(--radius-xs);
}

/* Der Zonenname am Westrand seines Bandes. Kein Karten-Label: er gehört zur Ebene und verschwindet
   mit ihr, läuft also auch nicht durch die Kollisionsauflösung. */
.ecosystem-climate-name {
	pointer-events: none;
	white-space: nowrap;
	font-size: var(--font-size-sm);
	color: var(--color-ecosystem-klima-label);
}
```

> **Prüfen beim Bauen:** ob `--radius-xs` und `--font-size-sm` in `css/base/tokens.css` existieren. Wenn nicht, den nächstliegenden vorhandenen Token nehmen — **keinen Literalwert** (AGENTS.md §12).

- [ ] **Step 5: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/ecosystem-climate.test.js
node --check js/map-features/map-features-ecosystem-climate.js
node --check js/map-features/map-features-ecosystem-layer-switch.js
```

Erwartet: `ecosystem-climate.test: OK`, keine Syntaxfehler.

- [ ] **Step 6: Committen**

```bash
git add js/map-features/map-features-ecosystem-climate.js js/map-features/__tests__/ecosystem-climate.test.js js/map-features/map-features-ecosystem-layer-switch.js index.html css/features/ecosystem-layer.css
git commit -m "feat(landschaften): die Klimagrenzen lassen sich auf der Karte ziehen"
```

---

## Task 6: Die Riegel im Client

Der Server verweigert schon (Task 2). Hier verschwinden die Verben aus dem Menü, damit niemand sie erst anbietet und dann kassiert.

**Files:**
- Modify: `js/map-features/map-features-ecosystem-transfer.js:71` (`ecosystemTransferTargetKinds`)
- Modify: `js/map-features/map-features-ecosystem-territory-import.js:585`
- Modify: `js/map-features/map-features-ecosystem-edit.js:907` (`openEcosystemGeometryEdit`)
- Modify: `js/map-features/map-features-ecosystem-context-action.js:146` (Flächenmenü)
- Test: `js/map-features/__tests__/ecosystem-transfer.test.js` (erweitern)

**Interfaces:**
- Consumes: `ECOSYSTEM_KINDS` aus Task 4; `avesmapsClimateIsDerivedKind` hat kein JS-Gegenstück — hier reicht der Vergleich gegen `"klima"`, EINMAL als Prädikat.
- Produces: `isDerivedEcosystemKind(kind): boolean` in `map-features-ecosystem-rendering.js`

- [ ] **Step 1: Das Prädikat und den Test**

In `js/map-features/map-features-ecosystem-rendering.js`, direkt hinter `isKnownEcosystemKind`:

```javascript
// Wird diese Ebene ABGELEITET statt gezeichnet? Heute genau eine: die Klimazonen entstehen aus ihren
// Trennlinien (map-features-ecosystem-climate.js). Eine Funktion statt eines verstreuten Vergleichs
// gegen "klima", weil fünf Aufrufstellen dieselbe Frage stellen und die fünfte sonst vergessen wird.
//
// 🔴 Der Riegel, der zählt, steht auf dem SERVER (avesmapsClimateAssertNotDerived). Dieser hier
// verhindert nur, dass ein Verb angeboten wird, das gleich darauf abgelehnt würde.
function isDerivedEcosystemKind(kind) {
	return String(kind || "") === "klima";
}
```

Und ans Ende des Exportobjekts (Z. 464) `isDerivedEcosystemKind,` ergänzen.

In `js/map-features/__tests__/ecosystem-transfer.test.js`, ans Ende vor die Erfolgsmeldung:

```javascript
// ---- Klimazonen sind weder Quelle noch Ziel (2026-08-03) --------------------------------------------
// Ein abgeleitetes Band lässt sich nicht in eine andere Ebene schicken, und in ein abgeleitetes Band
// lässt sich nichts hineinschicken -- beides wäre eine Fläche, die die Trennlinien nicht kennen.
const allFour = ["derographisch", "vegetation", "topographie", "klima"];
assert(!ecosystemTransferTargetKinds("vegetation", allFour).includes("klima"),
	"klima is not offered as a transfer target");
assert(ecosystemTransferTargetKinds("klima", allFour).length === 0,
	"a climate band cannot be transferred anywhere");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/ecosystem-transfer.test.js
```

Erwartet: FAIL bei `klima is not offered as a transfer target`.

- [ ] **Step 3: Die vier Riegel setzen**

`map-features-ecosystem-transfer.js`, in `ecosystemTransferTargetKinds`, ganz am Anfang:

```javascript
	// Eine abgeleitete Ebene ist weder Quelle noch Ziel: ihre Flächen entstehen aus den Trennlinien,
	// eine hineingeschobene fremde Fläche wäre beim nächsten Ableiten weg oder doppelt.
	if (isDerivedEcosystemKind(sourceKind)) {
		return [];
	}
```

und im `filter`, der die Zielliste baut, zusätzlich `&& !isDerivedEcosystemKind(kind)`.

`map-features-ecosystem-territory-import.js:585`:

```javascript
		const kinds = (typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [DEFAULT_IMPORT_KIND])
			.filter((kind) => typeof isDerivedEcosystemKind !== "function" || !isDerivedEcosystemKind(kind));
```

`map-features-ecosystem-edit.js`, in `openEcosystemGeometryEdit(publicId)` als erste Prüfung nach dem Laden der Fläche:

```javascript
	// 🔴 Ein Klimaband hat keine Ecken, die man ziehen dürfte -- seine Kante IST die Trennlinie, und die
	// wird in ihrer eigenen Ebene bearbeitet. Ein Eckzug hier wäre die zweite Wahrheit über dieselbe
	// Grenze, und sie wäre beim nächsten Ableiten stillschweigend wieder weg.
	if (isDerivedEcosystemKind(area?.kind)) {
		return;
	}
```

`map-features-ecosystem-context-action.js`, in der Funktion, die das Flächenmenü baut (um Z. 146): vor dem Anhängen der Verben

```javascript
		// Auf einem abgeleiteten Band gibt es nichts zu vereinigen, zerschneiden oder löschen.
		if (typeof isDerivedEcosystemKind === "function" && isDerivedEcosystemKind(area?.kind)) {
			return;
		}
```

> **Prüfen beim Bauen:** an welcher Stelle genau die Verben angehängt werden. Der Riegel gehört **vor** das erste `addEntry`, aber **nach** dem Kopf, der den Flächennamen zeigt — die Auskunft „das ist die Gemäßigte Zone" soll bleiben.

- [ ] **Step 4: Tests laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/ecosystem-transfer.test.js
node js/map-features/__tests__/ecosystem-edit.test.js
node --check js/map-features/map-features-ecosystem-context-action.js
node --check js/map-features/map-features-ecosystem-territory-import.js
```

Erwartet: beide Tests OK, keine Syntaxfehler.

- [ ] **Step 5: Committen**

```bash
git add js/map-features/map-features-ecosystem-rendering.js js/map-features/map-features-ecosystem-transfer.js js/map-features/map-features-ecosystem-territory-import.js js/map-features/map-features-ecosystem-edit.js js/map-features/map-features-ecosystem-context-action.js js/map-features/__tests__/ecosystem-transfer.test.js
git commit -m "fix(landschaften): ein Klimaband bietet keine Verben an, die es gleich ablehnen wuerde"
```

---

## Task 7: Der Regionen-Editor

**Files:**
- Modify: `html/landschaften-editor.html:64-69` (Reiter), `:1220` (`KIND_LABEL`), Eigenschaften-Spalte
- Modify: `js/territory/territory-editor-inline-host.js:23` (`ASSET_VERSION`)

**Interfaces:**
- Consumes: Task 3 (die Bänder liegen in der Datenbank und kommen über `/api/app/ecosystem-areas.php` mit)
- Produces: nichts, was eine spätere Aufgabe liest

- [ ] **Step 1: Reiter und Beschriftung**

`html/landschaften-editor.html`, Z. 66-68 ersetzen:

```html
      <button type="button" class="avm-tab" data-kind="derographisch" data-i18n="ecosystem.kind.derographisch">Derographie</button>
      <button type="button" class="avm-tab" data-kind="vegetation" data-i18n="ecosystem.kind.vegetation">Vegetation</button>
      <button type="button" class="avm-tab" data-kind="topographie" data-i18n="ecosystem.kind.topographie">Topographie</button>
      <button type="button" class="avm-tab" data-kind="klima" data-i18n="ecosystem.kind.klima">Klimazonen</button>
```

Z. 1220:

```javascript
const KIND_LABEL = { derographisch: "Derographie", vegetation: "Vegetation", topographie: "Topographie", klima: "Klimazonen" };
```

> Der Filter „Art" braucht **keine** Änderung: `artOptions` leitet seine Werte aus den geladenen Zeilen ab und bietet die sieben Zonen dadurch von selbst an, sobald der Reiter „Klimazonen" gewählt ist.

- [ ] **Step 2: Die Sperren in der Eigenschaften-Spalte**

In der Funktion, die Spalte 2 rendert (`renderDetail` o. ä. — beim Bauen an `ecoDetail` entlanglesen), am Anfang:

```javascript
	// Klimazonen sind ABGELEITET: Name und Wiki-Eintrag gehören dem Editor, Ebene und Art nicht.
	// Die Art ist die Wahrheit über die Zonenzugehörigkeit, und die Geometrie entsteht aus den
	// Trennlinien auf der Karte -- „Löschen" wäre hier eine Zusage, die der Server ablehnt.
	const istAbgeleitet = String(row.kind || "") === "klima";
```

und damit: das Art-Auswahlfeld auf `disabled` setzen, den Löschen-Knopf nicht rendern und stattdessen eine Zeile zeigen:

```javascript
	if (istAbgeleitet) {
		parts.push('<p class="avm-note">Die Fläche dieser Zone entsteht aus den Trennlinien auf der Karte '
			+ '(Landschaften → Klimazonen). Name und Wiki-Eintrag lassen sich hier ändern, '
			+ 'Art und Umriss nicht.</p>');
	}
```

> **Prüfen beim Bauen:** ob `.avm-note` in `css/pages/landschaften-editor.css` existiert. Wenn nicht, die vorhandene Hinweis-Klasse der Seite benutzen — **keine neue Klasse mit Literalfarben**.

- [ ] **Step 3: `ASSET_VERSION` heben**

`js/territory/territory-editor-inline-host.js:23`:

```javascript
	const ASSET_VERSION = "20260803b";
```

> 🔴 Ohne diesen Schritt liefert der Browser die alte `landschaften-editor.html` aus dem Cache und der Reiter „Klimazonen" fehlt — obwohl der Deploy grün ist (AGENTS.md §7).

- [ ] **Step 4: Prüfen**

```bash
node --check js/territory/territory-editor-inline-host.js
grep -c 'data-kind="klima"' html/landschaften-editor.html
grep -n 'ASSET_VERSION = ' js/territory/territory-editor-inline-host.js
```

Erwartet: kein Syntaxfehler, `1`, und die neue Version.

- [ ] **Step 5: Committen**

```bash
git add html/landschaften-editor.html js/territory/territory-editor-inline-host.js
git commit -m "feat(editor): der Regionen-Editor bekommt den Reiter \"Klimazonen\" mit den 7 Zonen als Filter"
```

---

## Task 8: Umbenennung abschließen und dokumentieren

Die sichtbaren Stellen von „Derographische Region" sind in Task 4 und 7 schon mitgezogen. Hier die letzten beiden plus der Eintrag im Projektbrief.

**Files:**
- Modify: `js/map-features/map-features-ecosystem-rendering.js:20` (in Task 4 erledigt — nur gegenprüfen)
- Modify: `js/app/i18n-en.js:135` (in Task 4 erledigt — nur gegenprüfen)
- Modify: `docs/oekosystem-editor-verhalten.md` (§1–§4a nennen die alte Beschriftung)
- Modify: `AGENTS.md` §11

- [ ] **Step 1: Gegenprobe, dass keine sichtbare Stelle übrig ist**

```bash
grep -rn "Derographische Region" --include=*.html --include=*.js --include=*.php . | grep -v "^./.claude/" | grep -v "^./docs/"
```

Erwartet: **keine Treffer**. Jeder Treffer ist eine vergessene Beschriftung.

```bash
grep -rn "derographisch" --include=*.js --include=*.php --include=*.css . | grep -v "^./.claude/" | wc -l
```

Erwartet: eine zweistellige Zahl — der **Schlüssel** bleibt überall, nur die Beschriftung ändert sich.

- [ ] **Step 2: Die Verhaltensdoku nachziehen**

In `docs/oekosystem-editor-verhalten.md` „Derographische Region" → „Derographie" ersetzen, **außer** in Zitaten des Kontextmenüs („Neue Derographische Region") — dieser Eintrag bleibt, wie er ist (`NEW_AREA_ENTRIES` wurde nicht angefasst). Zusätzlich in §2 die Tabelle um die vierte Ebene ergänzen:

```markdown
| **Klimazonen** | sieben Bänder, sehr blass; die sechs Trennlinien mit Griffen | nur die Trennlinien |
```

- [ ] **Step 3: `AGENTS.md` §11**

In der Dokumentenliste, hinter dem Landschaften-Block:

```markdown
- **Klimazonen** (Entwurf `docs/superpowers/specs/2026-08-03-klimazonen-design.md`, Bauplan
  `docs/superpowers/plans/2026-08-03-klimazonen.md`) — die **vierte** Landschaften-Ebene: sieben Zonen
  von Nord nach Süd. 💣 **Die sechs Trennlinien (`ecosystem_climate_divider`) sind die Wahrheit; die
  sieben Bänder sind abgeleitet** und werden bei jedem Speichern neu gerechnet. Dadurch ist „keine
  Überlappung" Bauart statt Regel — und weil die Bänder gewöhnliche `ecosystem_area`-Zeilen mit
  `kind='klima'` sind, erben Regionen-Editor, „Zugehörigkeit rechnen" und die Wege-Zuordnung sie ohne
  eigenen Code. 💣 **Ein Band darf nie als Polygon bearbeitet werden** (`avesmapsClimateAssertNotDerived`
  verweigert create/update/delete serverseitig) — sonst gäbe es zwei Wahrheiten über dieselbe Grenze.
  💣 **`x` muss auf jeder Trennlinie streng steigen**, sonst ist sie keine Funktion `y(x)` und der
  Reihenfolge-Wächter kann nicht mehr exakt prüfen. ⚠️ Die Saat läuft im SCHREIB-Dispatcher, nie in
  `EnsureTables` — die hebt die Revision nicht, und der Bestand käme als 304 an. Kein Reise-Effekt in
  dieser Fassung; das ist eine eigene Sitzung.
```

- [ ] **Step 4: Prüfen**

```bash
grep -n "Klimazonen" AGENTS.md | head -3
```

Erwartet: der neue Eintrag.

- [ ] **Step 5: Committen und pushen**

```bash
git add docs/oekosystem-editor-verhalten.md AGENTS.md
git commit -m "docs(landschaften): \"Derographie\" statt \"Derographische Region\", plus die Klimazonen im Projektbrief"
git push origin master
git log origin/master --oneline -1
```

Nach dem Push: **Remote-SHA prüfen** (die letzte Zeile), dann ~1–2 min Deploy abwarten. PHP wirkt auf STRATO **2–4 Minuten verzögert** (OPcache) — ein grüner Deploy mit alter Antwort ist kein Fehler.

---

## Abschlussprüfung auf der Live-Seite

Erst nach dem Deploy, in dieser Reihenfolge. Alles bis hierher war lokal beweisbar; das hier ist der Teil, der eine Datenbank braucht.

- [ ] Editor öffnen, Modus **Landschaften** → Kachel **Klimazonen**. Erwartet: sieben blasse Bänder, sechs dunkle Linien mit Griffen, sieben Namen am Westrand. Die Randgriffe sind eckig.
- [ ] Einen **mittleren** Griff ziehen. Das Band folgt beim Loslassen. Neu laden → die Linie steht, wo sie stand.
- [ ] Einen **Randgriff** ziehen. Er geht nur hoch und runter, x bleibt am Kartenrand.
- [ ] Einen Griff **gegen die Nachbarlinie** ziehen. Er stoppt, statt sie zu kreuzen.
- [ ] Auf eine Linie **klicken** → neuer Punkt. **Doppelklick** darauf → weg. Doppelklick auf einen Randgriff → nichts.
- [ ] Auf ein Band rechtsklicken. Erwartet: der Name der Zone, **keine** Verben (kein Zerschneiden, kein Löschen).
- [ ] Auf ein Band doppelklicken. Erwartet: **kein** Ecken-Editor.
- [ ] Editor → WikiSync → **Regionen bearbeiten** → Reiter **Klimazonen**. Erwartet: sieben Zeilen, Filter „Art" bietet die sieben Zonen.
- [ ] **„Zugehörigkeit rechnen"** drücken. Danach bei einer beliebigen Vegetationsfläche unter „Gemeinsame Regionen mit" die Klimazone mit ihrem Anteil prüfen. **Die Zahlen in der Kachel notieren** („Paare geprüft / verschnitten") — der Entwurf §9 sagt, dass hier nachzumessen ist.
- [ ] Umschalter prüfen: die zweite Kachel heißt **„Derographie"**, nicht mehr „Derographische Region".

---

## Self-Review

**Spec-Abdeckung**

| Entwurfs-Abschnitt | Aufgabe |
|---|---|
| §2 Linien sind die Wahrheit | 1, 2 |
| §3 sieben Zonen, Namen, Farben | 2 (Vokabel), 4 (Tokens) |
| §4 Linienform, Reihenfolge-Prüfung, Ableitung, ganze Karte | 1 |
| §5 Datenmodell | 2 |
| §6 Saat und Ableitung | 2 |
| §7 API | 3 |
| §8.1 Umschalter, Panes, Kommentar | 4 |
| §8.2 Darstellung | 4 (Bänder), 5 (Linien, Namen) |
| §8.3 Riegel | 2 (Server), 6 (Client) |
| §8.4 Linien-Editor | 5 |
| §9 Regionen-Editor | 7 |
| §10 Umbenennung | 4, 7, 8 |
| §11 Was nicht gebaut wird | überall bewusst ausgelassen; Audit ohne Undo in 3 |
| §12 Prüfung | 1, 2, 5, 6 + Abschlussprüfung |
| §13 Merkposten | 7 (`ASSET_VERSION`), 8 (Push/SHA), 4 (Tokens), Global Constraints (`git add`) |

**Platzhalter:** keine. Drei Stellen sind bewusst als „Prüfen beim Bauen" markiert (Spaltenbestand von `avesmapsEcosystemAreaRow`, Existenz von `--radius-xs`/`--font-size-sm`, Einhängepunkt im Flächenmenü) — jeweils mit der Entscheidungsregel dazu, nicht als offene Frage.

**Typ-Konsistenz:** `avesmapsClimateNormalizeDivider` liefert überall `['type' => 'LineString', 'coordinates' => …]`; `avesmapsClimateAssertOrder` bekommt an beiden Aufrufstellen `array_column($dividers, 'geometry')`, also Listen genau dieser Form. `avesmapsEcosystemClimateReadDividers` liefert `geometry` bereits normalisiert, deshalb ist das Durchreichen an `avesmapsClimateBandGeometry` typrichtig. Client-seitig heißt das Prädikat in **allen** fünf Aufrufstellen `isDerivedEcosystemKind`, serverseitig in allen sechs `avesmapsClimateAssertNotDerived`.
