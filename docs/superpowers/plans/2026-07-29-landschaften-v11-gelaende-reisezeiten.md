# Landschaften V11 — Gelände auf Reisezeiten — Umsetzungsplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Ein Weg bergauf kostet mehr Zeit, ein Weg bergab weniger — gerechnet aus einem
gespeicherten Höhenraster, hinter einem Owner-Schalter, der beim Ausschalten Zeile für Zeile
die heutigen Zahlen liefert.

**Architektur:** Der Browser rastert je Fläche ihr **eigenes** Höhenfeld in die Datenbank
(uint16 = Schritt, absolut). Eine owner-getriggerte, gestückelte Serveraktion leitet daraus je
Weg Anstieg/Gefälle ab (`path_terrain`). Der Routing-Kern liest nur noch diesen
Zwischenspeicher — **nie** ein Raster — und multipliziert den Steigungsfaktor auf die
Kantenzeit. Der Zwischenspeicher füllt sich **niemals** in einem Request.

**Technik:** PHP 8 (strict types) + MySQL/PDO, vanilla JS ohne Build, Leaflet `L.CRS.Simple`.
Tests: PHP-`assert()`-Skripte unter `__tests__/`, Node-Skripte unter `js/map-features/__tests__/`.

**Spec:** `docs/superpowers/specs/2026-07-29-landschaften-v11-gelaende-reisezeiten-design.md`
**Vorgänger-Figur:** `docs/superpowers/specs/2026-07-29-landschaften-v9-vorberechnung-design.md`

---

## Globale Randbedingungen

Diese gelten für **jede** Aufgabe. Sie werden nicht wiederholt.

- **Basis:** Worktree `.claude/worktrees/landschaften-v11-gelaende`, Zweig
  `worktree-landschaften-v11-gelaende`, gegründet auf `a7f3fe18`.
- 💣 **Geteilter Baum.** Nie `git add -A`, nie `git add .`, nie `git commit -a`. Immer erst
  `git status`, dann **pfadgenau** committen: `git commit --only -- <pfad> <pfad>`.
- 💣 **Kein DDL und keine `information_schema`-Sonde im Routing-Pfad oder in einer offenen
  Transaktion.** DDL läuft ausschließlich in `avesmapsEcosystemEnsureTables`, und das wird von
  keiner Schreibaktion dieses Plans aufgerufen.
- 💣 **Keine Schleifen gegen die Live-API** (STRATO). Eine Sonde, Antwort ablegen, offline
  auswerten.
- **Tests laufen so** — ohne `zend.assertions=1` prüft `assert()` **nichts**:
  ```bash
  php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring <datei>
  ```
  ```bash
  node <datei>
  ```
- **Sprache:** Code-Kommentare, Commit-Betreffs und interne Fehler-*Meldungen* **Englisch**;
  `error.code`-Werte bleiben wie sie sind. Sichtbare UI-Texte **Deutsch** (AGENTS.md §8).
- **Einheiten, festgeschrieben:** `1 Karteneinheit = 3.000 Schritt`. Höhen stehen überall in
  **Schritt**, Strecken in **Karteneinheiten**. Beide Einheiten stehen im Feldnamen.
- **Auflösung, festgeschrieben:** `AVESMAPS_TERRAIN_CELL_SIZE = 0.25` Karteneinheiten. Sie ist
  **nicht** je Anfrage einstellbar (§5.3) — der Anstieg ist auflösungsabhängig (×√2 je
  Halbierung), sonst ist der Zwischenspeicher wertlos.
- **Der Schalter geht in diesem Plan NICHT an.** Aufgabe 12 endet mit „AUS, dem Owner vorgelegt".
- **Handbuch (`html/editor-handbuch.html`) wird nicht angefasst** (AGENTS.md §9) — nur im
  Commit-Betreff angemeldet.
- **Nie ein `?v=` von Hand.** Neue `<script>`/`<link>` in `index.html` oder `html/*.html` werden
  ohne `?v=` eingetragen; der Deploy stempelt.

### 🔴 Zwei Spec-Behauptungen, die der Code nicht deckt — hier korrigiert

| | Spec sagt | Code sagt | Folge für diesen Plan |
|---|---|---|---|
| 1 | „`map_features.revision` reist in der Routing-Nutzlast bereits mit (`map-data.php:38`)" | `map-data.php` legt sie in `properties.revision` — aber **`avesmapsBuildRoutePathData` (`network-data.php:151-162`) lässt sie fallen**. Der Graph sieht sie nie. | Aufgabe 9a fädelt sie ausdrücklich durch. Ohne das ist `path_revision` ein toter Vergleich — dieselbe Falle wie Nr. 3 der Spec, eine Ebene tiefer. |
| 2 | `peaks_fingerprint` enthält „die zugeteilte `area_id`" | Die Zuteilung ist `assignEcosystemPeaksToAreas` — **Punkt-in-Polygon, nur in JS**. PHP hat keine solche Funktion. | Aufgabe 2 fingerprintet statt dessen **alle Gipfel + alle höhentragenden Flächen mit ihrer `geometry_revision`**. Das erfasst beide Kopplungen (§5.1 Punkt 1 und 2) ohne eine zweite Punkt-in-Polygon-Implementierung — Begründung steht in Aufgabe 2. |

### Was in V11 ausdrücklich NICHT gebaut wird

A\* / „Hierher reisen" (§10), V12-Pfeile, die 51 Gipfel ohne Höhe, die Handbuch-Tabelle, ein
Anfrageparameter `terrain_cell_size` (er steuerte laut §5.3 nur das A\*-Gitter — ein Parameter,
der nichts tut, ist schlimmer als keiner), und das Spiegeln des Faktors in die Client-Engine
(`js/routing/route-graph-routing.js`; live ist der Server primär, `shouldUseServerPrimaryRouting`
in `route-engine.js:40`, Client nur unter `?clientrouting=1`).

---

## Dateiplan

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `api/_internal/routing/terrain-factor.php` | **neu** — reine Kurve: (Anstieg, Gefälle, Strecke) → Faktor. Kein PDO, kein Blob. | 3 |
| `api/_internal/routing/__tests__/terrain-factor-test.php` | **neu** — Tests dazu | 3 |
| `api/_internal/app/heightmap.php` | **neu** — Blob-Leser: punktuell, summierend, ohne Materialisierung | 4 |
| `api/_internal/app/__tests__/heightmap-read-test.php` | **neu** — Tests dazu | 4 |
| `js/map-features/map-features-ecosystem-heightmap-raster.js` | **neu** — reiner Rasterkern im Browser | 5 |
| `js/map-features/__tests__/ecosystem-heightmap-raster.test.js` | **neu** — Tests dazu | 5 |
| `api/edit/map/peaks-geometry.php` | **neu** — Gipfel-Labels für den Editor (Vorbild: `paths-geometry.php`) | 6 |
| `api/_internal/app/terrain-store.php` | **neu** — Raster-Ablage + Fingerabdrücke + Profil-Lauf | 6, 8 |
| `api/_internal/app/__tests__/terrain-store-test.php` | **neu** — Tests dazu | 6, 8 |
| `api/_internal/app/ecosystem.php` | DDL der drei neuen Tabellen + `offroad_factor` | 2 |
| `api/edit/map/ecosystem.php` | fünf neue Aktionen im `match($action)` | 6, 8, 10 |
| `html/landschaften-editor.html` | zwei neue Kacheln + Rasterlauf + Profillauf | 7, 8, 10 |
| `api/_internal/app/app-setting.php` | `avesmapsAppSettingGetWithoutDdl` (eine Umsetzung, zwei Nutzer) | 10 |
| `api/_internal/app/path-landscapes.php` | delegiert an die neue Funktion statt eigener Kopie | 10 |
| `api/_internal/routing/map-data.php` | gibt sein PDO zurück | 9a |
| `api/_internal/routing/network-data.php` | reicht `revision` durch | 9a |
| `api/_internal/routing/response.php` | lädt `path_terrain`, stellt `debug`-Felder | 9a, 9b |
| `api/_internal/routing/client-graph.php` | Faktor an den zwei Zeitstellen, Teilstücke, Segmentfelder | 9b |
| `api/README.md` | neue Felder + der Satz aus §8.3 | 10 |
| `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md` | **neu** — die Messung und das Bild für den Owner | 1, 11, 12 |

---

## Aufgabe 1: Den Bestand nachzählen

Alle Zahlen der Spec stehen gegen `ecosystem_revision` 3983. Der Bestand wächst täglich, und die
Abnahme in Aufgabe 12 vergleicht gegen diese Zahlen. **Nicht neu rechnen — nachzählen.**

**Dateien:**
- Erstellen: `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md`
- Erstellen: `<scratchpad>/v11-count.js` (Wegwerf, nicht committen)

**Schnittstellen:**
- Liefert: die aktuellen Zahlen für Flächen, Gipfel-mit-Höhe, Wege, Wegstücke — Aufgabe 12
  vergleicht gegen sie.

- [ ] **Schritt 1: Zwei Sonden, je EINE Anfrage, Antwort ablegen**

💣 Nicht in einer Schleife. Zwei Aufrufe, mehr nicht.

```bash
curl -sS "https://avesmaps.de/api/app/ecosystem-areas.php" -o "$SCRATCH/areas.json" -w "%{size_download}\n"
```
```bash
curl -sS "https://avesmaps.de/api/app/map-features.php" -o "$SCRATCH/features.json" -w "%{size_download}\n"
```

Ersetze `$SCRATCH` durch das Scratchpad-Verzeichnis dieser Sitzung. `map-features.json` ist
gemessen ~17,8 MB — das ist erwartet, nicht kaputt.

- [ ] **Schritt 2: Offline auszählen**

```js
// <scratchpad>/v11-count.js
const fs = require("fs");
const dir = process.argv[2];
const areas = JSON.parse(fs.readFileSync(dir + "/areas.json", "utf8")).areas || [];
const features = JSON.parse(fs.readFileSync(dir + "/features.json", "utf8"));
const list = features.features || features.data || [];

const gebirge = areas.filter((a) => a.kind === "topographie" && a.region_type === "gebirge");
const peaks = list.filter((f) => {
	const p = f.properties || {};
	return p.feature_type === "label"
		&& ["berggipfel", "vulkan"].includes(String(p.feature_subtype || ""));
});
const withHeight = peaks.filter((f) => {
	const raw = ((f.properties || {}).properties || {}).height_schritt;
	return Number.isFinite(Number(raw)) && Number(raw) > 0;
});
const paths = list.filter((f) => (f.properties || {}).feature_type === "path");
const segments = paths.reduce(
	(sum, f) => sum + Math.max(0, (((f.geometry || {}).coordinates) || []).length - 1), 0);
const lengths = [];
paths.forEach((f) => {
	const c = ((f.geometry || {}).coordinates) || [];
	for (let i = 1; i < c.length; i++) {
		lengths.push(Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
	}
});
const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;

console.log(JSON.stringify({
	areas_total: areas.length,
	gebirge_areas: gebirge.length,
	peaks_total: peaks.length,
	peaks_with_height: withHeight.length,
	paths: paths.length,
	segments,
	mean_segment_mapunits: Number(mean.toFixed(4)),
	// Was ein Raster bei 0,25 E/px und 16 Bit roh kostet: Bytes = 32 * bbox-Fläche
	raster_bytes_raw: gebirge.reduce((sum, a) => {
		const b = a.bounds || {};
		return sum + 32 * (b.max_x - b.min_x) * (b.max_y - b.min_y);
	}, 0),
	largest_raster_bytes_raw: Math.max(0, ...gebirge.map((a) => {
		const b = a.bounds || {};
		return 32 * (b.max_x - b.min_x) * (b.max_y - b.min_y);
	})),
}, null, 2));
```

```bash
node "$SCRATCH/v11-count.js" "$SCRATCH"
```

- [ ] **Schritt 3: Erwartung prüfen**

Erwartet, gegen die Spec (Stand 3983): 15 Gebirgsflächen, 67 Gipfel, **16 mit Höhe**, 5.655 Wege,
36.139 Wegstücke, mittlere Länge 1,436 E, 15 Raster ≈ 1,01 MB roh, größtes 286 KB.

Weicht etwas um mehr als ~10 % ab, ist das **kein Fehler** — es ist der gewachsene Bestand. Es
wird notiert, nicht repariert. Weicht `peaks_with_height` nach **unten** ab, ist die Auslesung
falsch (der Pfad `properties.properties.height_schritt` ist verschachtelt) — dann erst den
Leseweg prüfen.

- [ ] **Schritt 4: Die Zahlen festhalten**

Lege `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md` an, mit genau diesem Kopf
und der Tabelle aus Schritt 3 (Spec-Wert gegen heutigen Wert, je Zeile):

```markdown
# Landschaften V11 — Messungen

**Diese Datei sammelt, was gemessen wurde — sie ist kein Entwurf.** Sie wächst in drei Schritten:
Aufgabe 1 (Bestand), Aufgabe 11 (Verteilung und Kurve), Aufgabe 12 (Abnahme).

## 1. Bestand, nachgezählt am <DATUM>

| | Spec (ecosystem_revision 3983) | heute | Abweichung |
|---|---|---|---|
| Gebirgsflächen | 15 | | |
| Gipfel gesamt | 67 | | |
| **Gipfel mit Höhe** | **16** | | |
| Wege | 5.655 | | |
| Wegstücke | 36.139 | | |
| mittlere Wegstücklänge | 1,436 E | | |
| Raster roh, alle | 1,01 MB | | |
| größtes Raster roh | 286 KB | | |

Verfahren: je eine Anfrage an `/api/app/ecosystem-areas.php` und `/api/app/map-features.php`,
danach offline ausgezählt. Keine Schleife gegen die API.
```

- [ ] **Schritt 5: Commit**

```bash
git commit --only -- docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md -m "docs(landschaften): recount the V11 stock against the live map before building"
```

---

## Aufgabe 2: Schema und Schreibwächter

**Dateien:**
- Ändern: `api/_internal/app/ecosystem.php` (in `avesmapsEcosystemEnsureTables`, hinter dem
  V9-Block, der mit `CREATE TABLE IF NOT EXISTS path_ecosystem` beginnt)
- Erstellen: `api/_internal/app/terrain-store.php` (nur die reinen Wächter; der Rest kommt in
  Aufgabe 6)
- Erstellen: `api/_internal/app/__tests__/terrain-store-test.php`

**Schnittstellen:**
- Liefert: Tabellen `ecosystem_area_heightmap`, `path_terrain`, `path_terrain_stamp`;
  Spalte `ecosystem_region_type.offroad_factor`.
- Liefert: `avesmapsTerrainGuardRasterShape(int $width, int $height, float $cellSize, int $byteLength): void`
  — wirft `InvalidArgumentException`, sonst still.
- Liefert: Konstanten `AVESMAPS_TERRAIN_CELL_SIZE`, `AVESMAPS_TERRAIN_MAX_PIXELS`,
  `AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
// api/_internal/app/__tests__/terrain-store-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 terrain store's PURE half (api/_internal/app/terrain-store.php).
 *
 * No DB, no HTTP: the file is side-effect-free on include. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';

$throws = static function (callable $run): bool {
    try { $run(); } catch (InvalidArgumentException) { return true; }
    return false;
};

// The invariant that makes a half-read raster impossible: 2 bytes per sample, no more, no less.
avesmapsTerrainGuardRasterShape(4, 3, 0.25, 24);
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.25, 23)),
    'byte length one short must be refused, not read half');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.25, 25)),
    'byte length one over must be refused');

// A cell size FINER than the stock resolution is refused: it would measure a larger ascent for
// the same ground (total variation grows with sampling density, x sqrt(2) per halving).
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(4, 3, 0.125, 24)),
    'cell size below the stock resolution must be refused');
avesmapsTerrainGuardRasterShape(4, 3, 0.5, 24);   // coarser is allowed

assert($throws(static fn() => avesmapsTerrainGuardRasterShape(0, 3, 0.25, 0)),
    'zero width must be refused');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(70000, 3, 0.25, 420000)),
    'width beyond SMALLINT UNSIGNED must be refused before MySQL truncates it');
assert($throws(static fn() => avesmapsTerrainGuardRasterShape(3000, 3000, 0.25, 18000000)),
    'pixel count beyond the per-area ceiling must be refused');

assert(AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT === 3000.0, '1 map unit is 3000 Schritt');
assert(AVESMAPS_TERRAIN_CELL_SIZE === 0.25, 'the stock resolution is fixed at 0.25 map units');

fwrite(STDOUT, "terrain-store-test: all asserts passed\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: FEHLER — `Failed opening required '.../terrain-store.php'`.

- [ ] **Schritt 3: `terrain-store.php` mit den Wächtern anlegen**

```php
<?php

declare(strict_types=1);

// V11: the store behind the Landschaften editor's terrain buttons.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v11-gelaende-reisezeiten-design.md
//
// PURITY CONTRACT (mirrors path-ecosystem.php): side-effect-free on include -- only const and
// function definitions, no DB connect, no headers. The offline-decidable half (the write guards,
// the fingerprint composition) is pure and unit-tested; the DB half takes a PDO explicitly.
//
// 💣 NO avesmapsEcosystemEnsureTables ANYWHERE IN THIS FILE. Its information_schema probes are the
// load of the pool incident of 2026-07-17, and DDL inside a transaction commits it silently. The
// tables come into being on the area read/write paths, long before anyone presses a button.

// The ONE resolution the whole feature integrates height at, in map units. It is NOT a per-request
// knob, and that is a deliberate departure from owner decision 8 (spec §5.3): the ascent over
// fractal ground is a TOTAL VARIATION and grows with sampling density -- x sqrt(2) per halving at a
// Hurst exponent near 0.5. A per-request resolution would mean a different ascent_schritt for the
// same ground, so either the knob does nothing or every request bypasses the cache.
const AVESMAPS_TERRAIN_CELL_SIZE = 0.25;

// 1 map unit = 3.000 Schritt. Written down because the unit trap is documented and expensive:
// reading a graph distance as miles overstates a gradient by 3x and the signal by 23x.
const AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT = 3000.0;

// Pixels one area's raster may hold. The largest measured area (Finsterkamm) is ~143.000; the whole
// map at 0,25 would be 16,7 million. This is a guard against a runaway client, not a design limit:
// 4 million pixels are 8 MB raw, far inside LONGBLOB and far above anything real.
const AVESMAPS_TERRAIN_MAX_PIXELS = 4000000;

// SMALLINT UNSIGNED. 💣 Without this check MySQL SILENTLY truncates without sql_mode=STRICT, and a
// half-stored raster looks exactly like a whole one.
const AVESMAPS_TERRAIN_MAX_SIDE = 65535;

/**
 * PURE: the three guards of spec §5.1, all three refusing rather than repairing.
 *
 * 💣 A raster that is wrong here is INVISIBLE later: a truncated blob reads as a mountain that
 * stops halfway, and nothing downstream re-checks. Refusing is the only honest answer.
 */
function avesmapsTerrainGuardRasterShape(int $width, int $height, float $cellSize, int $byteLength): void
{
    if ($width <= 0 || $height <= 0) {
        throw new InvalidArgumentException('A raster needs a positive width and height.');
    }
    if ($width > AVESMAPS_TERRAIN_MAX_SIDE || $height > AVESMAPS_TERRAIN_MAX_SIDE) {
        throw new InvalidArgumentException('A raster side may not exceed ' . AVESMAPS_TERRAIN_MAX_SIDE . ' pixels.');
    }
    if ($width * $height > AVESMAPS_TERRAIN_MAX_PIXELS) {
        throw new InvalidArgumentException('A raster may not exceed ' . AVESMAPS_TERRAIN_MAX_PIXELS . ' pixels.');
    }
    // Coarser than the stock resolution is a loss of detail; FINER is a different measurement of the
    // same ground and would make ascent_schritt incomparable between rows (§5.3).
    if ($cellSize < AVESMAPS_TERRAIN_CELL_SIZE) {
        throw new InvalidArgumentException('cell_size must not be finer than the stock resolution ' . AVESMAPS_TERRAIN_CELL_SIZE . '.');
    }
    if ($byteLength !== $width * $height * 2) {
        throw new InvalidArgumentException('samples must hold exactly width * height * 2 bytes (uint16).');
    }
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: `terrain-store-test: all asserts passed`, Exit 0.

- [ ] **Schritt 5: Die DDL in `avesmapsEcosystemEnsureTables` ergänzen**

Suche das Ende des V9-Blocks (`CREATE TABLE IF NOT EXISTS ecosystem_assignment_stamp`) und hänge
**dahinter** an:

```php
    // ---- V11: the stored terrain (spec 2026-07-29) -----------------------------------------------
    //
    // 💣 LONGBLOB, not MEDIUMBLOB. At 0,25 units per pixel and 16 bit, `bytes = 32 * bbox area` --
    // MEDIUMBLOB's 16 MB are exhausted at a bbox of 724 x 724 units. Unreachable today (only
    // `gebirge` gets a height field), but `huegelland: "warp"` already stands written in
    // map-features-ecosystem-height-combine.js and waits for the gate to open. Without
    // sql_mode=STRICT MySQL truncates SILENTLY, and half a raster looks like a whole one.
    //
    // 🔴 `samples` are uint16 and mean SCHRITT, absolute, little-endian, row-major. No white point,
    // no scale factor, no normalisation -- the display's two scales (a global 5.000er white point
    // and, while editing, a per-area stretch) are DISPLAY and must never reach the data (§3.2).
    // The blob is stored DEFLATE-compressed (gzdeflate); the length invariant is checked after
    // inflating.
    //
    // max_x / max_y are STORED generated columns so „which rasters cover this box" is an INDEXED
    // query that never touches the blob.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_area_heightmap (
            area_id INT UNSIGNED NOT NULL,
            cell_size_mapunits DECIMAL(6,4) NOT NULL,
            origin_x DECIMAL(10,4) NOT NULL,
            origin_y DECIMAL(10,4) NOT NULL,
            width_px SMALLINT UNSIGNED NOT NULL,
            height_px SMALLINT UNSIGNED NOT NULL,
            max_x DECIMAL(10,4) AS (origin_x + width_px  * cell_size_mapunits) STORED,
            max_y DECIMAL(10,4) AS (origin_y + height_px * cell_size_mapunits) STORED,
            samples LONGBLOB NOT NULL,
            sample_bytes INT UNSIGNED NOT NULL,
            geometry_revision INT UNSIGNED NOT NULL,
            terrain_fingerprint CHAR(40) NOT NULL,
            peaks_fingerprint CHAR(40) NOT NULL,
            computed_by BIGINT UNSIGNED NULL,
            computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (area_id),
            KEY idx_heightmap_bbox (origin_x, origin_y, max_x, max_y)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // The derived cache the ROUTER reads. It never reads a raster.
    //
    // 💣 `NULL` means „no height data", `0` means „measured and level". Never the same value: today
    // 16 of 67 peaks carry a height, and without the difference every reader would take the missing
    // 51 for measured flat ground.
    //
    // 🔴 `path_revision`, NOT `map_revision`. map_revision is a GLOBAL counter (features.php) bumped
    // by settlement, label, source and sync writes too -- AND peaks are `berggipfel` LABELS in
    // map_features, so entering one peak height, the most common V11 editorial act with 51 open
    // peaks, would have invalidated all 5.655 rows in one go.
    //
    // `heightmap_stamp` is the GLOBAL raster stamp, not a per-way one. A raster run is a rare,
    // owner-triggered act (unlike ecosystem_revision, which jumped 901 times in one working day) --
    // so global granularity costs nothing here, and after a raster run the profiles get recomputed
    // anyway. A stale stamp is REPORTED, not obeyed (see the reader in response.php).
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS path_terrain (
            path_id BIGINT UNSIGNED NOT NULL,
            ascent_schritt INT UNSIGNED NULL,
            descent_schritt INT UNSIGNED NULL,
            profile_json JSON NULL,
            path_revision BIGINT UNSIGNED NOT NULL,
            heightmap_stamp CHAR(40) NOT NULL,
            computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (path_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // One row, id always 1 -- same pattern as ecosystem_assignment_stamp. It carries the CURSOR,
    // because the profile derivation is a chunked owner action: the server computes here, and a
    // single request would face 5.655 misses inside a 30 s limit while every concurrent visitor
    // started the same fill. That is the shape of the pool incident of 2026-07-17.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS path_terrain_stamp (
            id TINYINT UNSIGNED NOT NULL,
            run_token CHAR(36) NULL,
            heightmap_stamp CHAR(40) NOT NULL DEFAULT '',
            cursor_path_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            ways_seen INT UNSIGNED NOT NULL DEFAULT 0,
            ways_with_profile INT UNSIGNED NOT NULL DEFAULT 0,
            duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
            completed TINYINT(1) NOT NULL DEFAULT 0,
            computed_by BIGINT UNSIGNED NULL,
            computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // ---- V11 §4.5: the cross-country factor per KIND of area ------------------------------------
    //
    // 🔴 IT IS WRITTEN AND MAINTAINED IN V11, BUT NOT READ. It works only cross-country (§4.2): a
    // road through the Reichsforst is a road, and the wood does not slow it -- roads exist precisely
    // to neutralise the terrain. It stands here so the values are already set when §10 arrives.
    //
    // 🔴 HOW THE THREE LAYERS COMBINE, decided here so nobody invents it later (§10.3): a cell is
    // „Kosch" AND „Wald" AND „Gebirge" at once (derographisch / vegetation / topographie lie on top
    // of one another -- V10 measured that the shares do not add up to 100 %). The combination is the
    // MAXIMUM of the three factors, NOT the product: multiplying „forest in a mountain range inside
    // a derographic region" gives a number nobody can explain any more.
    //
    // 💣 Its own column check, deliberately NOT folded into the terrain loop above -- a shared
    // "was anything new?" flag would re-run the terrain seed and silently reset every value the
    // owner has adjusted since.
    if (!$typeColumnExists($pdo, 'offroad_factor')) {
        $pdo->exec('ALTER TABLE ecosystem_region_type ADD COLUMN offroad_factor DECIMAL(4,2) NOT NULL DEFAULT 1.00');
        // Chosen, not measured -- owner's own example in spec §4.5 (Wald 1,4 · Gebirge 2,2 ·
        // Sumpf 3,0), the rest filled in around it. 🔧 They are DATA ROWS: the owner changes them
        // in the database, no code is touched.
        foreach ([
            ['topographie', 'gebirge', 2.20],
            ['topographie', 'huegelland', 1.30],
            ['topographie', 'schlucht', 2.60],
            ['topographie', 'wadi', 1.50],
            ['topographie', 'hochebene', 1.10],
            ['topographie', 'flussdelta', 2.00],
            ['vegetation', 'wald', 1.40],
            ['vegetation', 'dschungel', 2.40],
            ['vegetation', 'suempfe_moore', 3.00],
            ['vegetation', 'wueste', 1.60],
            ['vegetation', 'tundra', 1.30],
            ['vegetation', 'auenlandschaft', 1.30],
            ['vegetation', 'steppe', 1.10],
            ['vegetation', 'graslandschaft', 1.05],
        ] as [$kind, $typeKey, $factor]) {
            $statement = $pdo->prepare(
                'UPDATE ecosystem_region_type SET offroad_factor = :f WHERE kind = :k AND type_key = :t'
            );
            $statement->execute(['f' => $factor, 'k' => $kind, 't' => $typeKey]);
        }
    }
```

⚠️ `$typeColumnExists` ist die vorhandene Closure aus derselben Funktion (definiert vor dem
`terrain_grain`-Block). Nicht neu bauen — sie steht schon da.

- [ ] **Schritt 6: Syntax prüfen**

```bash
php -l api/_internal/app/ecosystem.php && php -l api/_internal/app/terrain-store.php
```
Erwartet: zweimal `No syntax errors detected`.

- [ ] **Schritt 7: Die bestehenden Ökosystem-Tests dürfen nicht brechen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-assignment-test.php
```
Erwartet: unverändert grün. (Existiert die Datei nicht, ist dieser Schritt erledigt — dann gibt
es dort nichts zu brechen.)

- [ ] **Schritt 8: Commit**

```bash
git commit --only -- api/_internal/app/ecosystem.php api/_internal/app/terrain-store.php api/_internal/app/__tests__/terrain-store-test.php -m "feat(landschaften): schema for the V11 height rasters, way profiles and the cross-country factor"
```

---

## Aufgabe 3: Der Steigungsfaktor

Das Stück, das die Messung in Aufgabe 11 später **allein durch Zahlen** nachjustiert — deshalb
steht die ganze Kurve in einem Konstantenblock und nirgends sonst.

**Dateien:**
- Erstellen: `api/_internal/routing/terrain-factor.php`
- Erstellen: `api/_internal/routing/__tests__/terrain-factor-test.php`

**Schnittstellen:**
- Liefert: `avesmapsTerrainTimeFactor(?float $ascentSchritt, ?float $descentSchritt, float $distanceMapunits): float`
  — `1.0` bei `null` oder bei Strecke ≤ 0.
- Liefert: `avesmapsTerrainHasData(?float $ascentSchritt, ?float $descentSchritt): bool`
  — trennt „keine Daten" von „gemessen und eben".
- Liefert: Konstanten `AVESMAPS_TERRAIN_UP_PENALTY`, `AVESMAPS_TERRAIN_DOWN_BONUS`,
  `AVESMAPS_TERRAIN_DOWN_PENALTY`, `AVESMAPS_TERRAIN_FACTOR_MIN`, `AVESMAPS_TERRAIN_FACTOR_MAX`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
// api/_internal/routing/__tests__/terrain-factor-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 slope factor (api/_internal/routing/terrain-factor.php).
 *
 * Pure: no DB, no HTTP, no blob. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-factor.php';

$near = static fn(float $a, float $b): bool => abs($a - $b) < 1e-9;

// --- flat ground is EXACTLY 1.0, and that is what makes „switch off" bit-identical -------------
assert(avesmapsTerrainTimeFactor(0.0, 0.0, 10.0) === 1.0, 'level ground must be exactly 1.0');

// --- no data is 1.0 too, but distinguishable ----------------------------------------------------
assert(avesmapsTerrainTimeFactor(null, null, 10.0) === 1.0, 'unknown terrain must not change the time');
assert(avesmapsTerrainHasData(null, null) === false, 'null must be readable as „unknown"');
assert(avesmapsTerrainHasData(0.0, 0.0) === true, 'measured level ground is DATA, not absence');
assert(avesmapsTerrainHasData(null, 12.0) === false, 'half a pair is not data');

// --- a degenerate distance cannot divide -------------------------------------------------------
assert(avesmapsTerrainTimeFactor(3000.0, 0.0, 0.0) === 1.0, 'zero distance must not divide');
assert(avesmapsTerrainTimeFactor(3000.0, 0.0, -1.0) === 1.0, 'negative distance must not divide');

// --- climbing costs; the anchor is the published table (Gebirgspass 1,5 vs Strasse 4,0 = 2,67x) --
// 3.000 Schritt of ascent over 3 map units = gradient 1/3 -> 1 + 5,0 * 0,3333 = 2,667
$pass = avesmapsTerrainTimeFactor(3000.0, 0.0, 3.0);
assert($pass > 2.6 && $pass < 2.75, 'a typical mountain leg must land near the published 2,67x, got ' . $pass);

// --- gentle descent is FASTER, not merely „not slower" (owner decision 3) ----------------------
$gentle = avesmapsTerrainTimeFactor(0.0, 300.0, 1.0);      // gradient 0,1 downhill
assert($gentle < 1.0, 'a gentle descent must be faster than level, got ' . $gentle);

// --- very steep descent is slower again than a gentle one --------------------------------------
$steep = avesmapsTerrainTimeFactor(0.0, 3000.0, 1.0);      // gradient 1,0 downhill
assert($steep > $gentle, 'a very steep descent must be slower than a gentle one');

// --- the clamp, in both directions -------------------------------------------------------------
$absurdUp = avesmapsTerrainTimeFactor(300000.0, 0.0, 1.0);
assert($near($absurdUp, AVESMAPS_TERRAIN_FACTOR_MAX), 'an absurd ascent must clamp at the ceiling');
assert(AVESMAPS_TERRAIN_FACTOR_MIN === 0.5 && AVESMAPS_TERRAIN_FACTOR_MAX === 4.0,
    'the clamp is [0,5 ... 4,0] -- 💣 NOT the river clamp [1,0 ... 3,0], which would silently undo owner decision 3');
foreach ([[0.0, 0.0], [9000.0, 0.0], [0.0, 9000.0], [4000.0, 4000.0]] as [$up, $down]) {
    $factor = avesmapsTerrainTimeFactor($up, $down, 1.0);
    assert($factor >= AVESMAPS_TERRAIN_FACTOR_MIN && $factor <= AVESMAPS_TERRAIN_FACTOR_MAX,
        'the factor must never leave the clamp');
}

// --- ascent and descent both act; a leg that climbs AND falls is not the same as either alone ---
$both = avesmapsTerrainTimeFactor(1500.0, 1500.0, 1.0);
$upOnly = avesmapsTerrainTimeFactor(1500.0, 0.0, 1.0);
assert($both < $upOnly, 'the descent half of a leg must give some of the climb back');

// --- the unit conversion is the documented one --------------------------------------------------
// 3.000 Schritt over 1 map unit is gradient 1,0; over 3 map units it is 1/3.
assert($near(
    avesmapsTerrainTimeFactor(3000.0, 0.0, 1.0),
    1.0 + AVESMAPS_TERRAIN_UP_PENALTY
), '3.000 Schritt over one map unit must be gradient 1,0 -- 1 map unit = 3.000 Schritt');

fwrite(STDOUT, "terrain-factor-test: all asserts passed\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
```
Erwartet: FEHLER — `Failed opening required '.../terrain-factor.php'`.

- [ ] **Schritt 3: `terrain-factor.php` schreiben**

```php
<?php

declare(strict_types=1);

// V11: how a slope becomes a time factor. Spec §4.4.
//
// PURITY CONTRACT: side-effect-free on include, no PDO, no blob, no I/O. This file is the ONE place
// the curve lives, so the measurement of §7.2 can retune it by editing four numbers and nothing else.
//
// 🔴 THE NUMBERS BELOW ARE CHOSEN, NOT MEASURED. They are start values, anchored on the one number
// the published speed table already asserts: a Gebirgspass is 1,5 km/h against a Strasse's 4,0, so a
// typical mountain leg is ALREADY 2,67x slower. The measurement (spec §7.2, this plan's task 11)
// lays the real distribution against them and the owner decides the ceiling BEFORE the switch goes on.

// 1 map unit = 3.000 Schritt (V9 §4.1; spec §10.2 says 0,5 units = 1.500 Schritt, same statement).
// 💣 The unit trap is documented and expensive: reading the graph distance as miles overstates a
// gradient by 3x and the signal by 23x.
const AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE = 3000.0;

// Uphill. Anchored so that 3.000 Schritt of climb over 3 map units lands at 2,667 -- exactly the
// ratio the speed table already carries between Gebirgspass and Strasse.
const AVESMAPS_TERRAIN_UP_PENALTY = 5.0;

// Downhill, linear part: gentle descent is FASTER (owner decision 3). At a 0,1 gradient this gives
// 0,85 -- noticeable, not dramatic.
const AVESMAPS_TERRAIN_DOWN_BONUS = 1.5;

// Downhill, quadratic part: very steep descent brakes again. With the two above, the curve turns at
// a downhill gradient of DOWN_BONUS / (2 * DOWN_PENALTY) = 0,25 and is back at 1,0 by 0,5.
const AVESMAPS_TERRAIN_DOWN_PENALTY = 3.0;

// 💣 NOT THE RIVER CLAMP. avesmapsRouteClientNormalizeFlow clamps to [1,0 ... 3,0] because a current
// only ever slows you down. Inheriting that bound here would clamp every descent up to 1,0 and
// downhill would never be faster than level -- owner decision 3 silently taken back.
// ⚠️ The ceiling is NOT decided. At 4,0 a steep pass computes to 0,375 km/h -- under 10 km a day.
// Whether it stays is the owner's call after seeing the picture of §7.2.
const AVESMAPS_TERRAIN_FACTOR_MIN = 0.5;
const AVESMAPS_TERRAIN_FACTOR_MAX = 4.0;

/**
 * PURE: does this pair carry a measurement at all?
 *
 * 💣 `null` means „no height data here", `0` means „measured and level". Never the same value.
 * Today 16 of 67 peaks carry a height; without the difference every reader takes the missing 51
 * for measured flat ground -- and a factor of 1,0 then means three different things at once.
 */
function avesmapsTerrainHasData(?float $ascentSchritt, ?float $descentSchritt): bool
{
    return $ascentSchritt !== null && $descentSchritt !== null;
}

/**
 * PURE: the slope factor for ONE traversal, in ONE direction.
 *
 * Ascent and descent are the sums along the traversal IN THAT DIRECTION, in Schritt; the distance is
 * the chord length in map units (the same measure the graph, the speed table and the leg distances
 * use -- NOT the drawn Catmull-Rom curve, which is longer).
 *
 * Returns EXACTLY 1.0 for level ground, for missing data and for a degenerate distance. That exact
 * 1.0 is what makes „switch off" bit-identical with today.
 */
function avesmapsTerrainTimeFactor(?float $ascentSchritt, ?float $descentSchritt, float $distanceMapunits): float
{
    if (!avesmapsTerrainHasData($ascentSchritt, $descentSchritt) || $distanceMapunits <= 0.0) {
        return 1.0;
    }

    $span = $distanceMapunits * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE;
    $up = max(0.0, (float) $ascentSchritt) / $span;
    $down = max(0.0, (float) $descentSchritt) / $span;
    if ($up === 0.0 && $down === 0.0) {
        return 1.0;
    }

    $factor = 1.0
        + AVESMAPS_TERRAIN_UP_PENALTY * $up
        - AVESMAPS_TERRAIN_DOWN_BONUS * $down
        + AVESMAPS_TERRAIN_DOWN_PENALTY * $down * $down;

    return max(AVESMAPS_TERRAIN_FACTOR_MIN, min(AVESMAPS_TERRAIN_FACTOR_MAX, $factor));
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
```
Erwartet: `terrain-factor-test: all asserts passed`, Exit 0.

- [ ] **Schritt 5: Commit**

```bash
git commit --only -- api/_internal/routing/terrain-factor.php api/_internal/routing/__tests__/terrain-factor-test.php -m "feat(routing): the V11 slope curve as one pure, retunable function"
```

---

## Aufgabe 4: Der Rasterleser

**Dateien:**
- Erstellen: `api/_internal/app/heightmap.php`
- Erstellen: `api/_internal/app/__tests__/heightmap-read-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsTerrainGuardRasterShape` (Aufgabe 2).
- Liefert: `avesmapsHeightmapDecode(array $row): array` — nimmt eine DB-Zeile, gibt
  `['origin_x','origin_y','cell','width','height','samples']` mit `samples` als **Binärstring**.
- Liefert: `avesmapsHeightmapSampleOne(array $raster, float $x, float $y): ?float` — bilinear,
  `null` außerhalb.
- Liefert: `avesmapsHeightmapSampleSum(array $rasters, float $x, float $y): ?float` — **Summe**
  über alle treffenden, `null` wenn keiner trifft.
- Liefert: `avesmapsHeightmapLoadAll(PDO $pdo): array` und
  `avesmapsHeightmapGlobalStamp(PDO $pdo): string`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
// api/_internal/app/__tests__/heightmap-read-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 height raster reader (api/_internal/app/heightmap.php).
 *
 * No DB: the pure half takes decoded raster arrays. Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/heightmap-read-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../terrain-store.php';
require __DIR__ . '/../heightmap.php';

$near = static fn(?float $a, float $b): bool => $a !== null && abs($a - $b) < 1e-6;
$throws = static function (callable $run): bool {
    try { $run(); } catch (InvalidArgumentException) { return true; }
    return false;
};

// A 3x2 raster at origin (10, 20), cell 0,25. Values in SCHRITT, row-major, little-endian uint16.
//   row 0 (y = 20,00):  100  200  300
//   row 1 (y = 20,25):  400  500  600
$raw = pack('v*', 100, 200, 300, 400, 500, 600);
$row = [
    'origin_x' => '10.0000', 'origin_y' => '20.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate($raw), 'sample_bytes' => strlen($raw),
];
$raster = avesmapsHeightmapDecode($row);

// 🔴 THE BLOB STAYS A STRING. unpack('v*') would cost a measured 43 bytes per element -- 42 to 95 MB
// at 78 areas against 5,25 MB of blob.
assert(is_string($raster['samples']), 'the raster must stay a binary string, never a PHP array');
assert(strlen($raster['samples']) === 12, 'inflate must restore exactly width * height * 2 bytes');

// --- grid points read EXACTLY what the browser wrote -------------------------------------------
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.00), 100.0), 'grid point (0,0)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.50, 20.00), 300.0), 'grid point (2,0)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.25), 400.0), 'grid point (0,1)');
assert($near(avesmapsHeightmapSampleOne($raster, 10.50, 20.25), 600.0), 'grid point (2,1)');

// --- between grid points it interpolates, so the ascent has no sub-cell staircase --------------
assert($near(avesmapsHeightmapSampleOne($raster, 10.125, 20.00), 150.0), 'halfway along x');
assert($near(avesmapsHeightmapSampleOne($raster, 10.00, 20.125), 250.0), 'halfway along y');
assert($near(avesmapsHeightmapSampleOne($raster, 10.125, 20.125), 300.0), 'centre of the first cell');

// --- outside the bbox is „no data", NOT 0 ------------------------------------------------------
assert(avesmapsHeightmapSampleOne($raster, 9.99, 20.0) === null, 'left of the bbox is unknown, not level');
assert(avesmapsHeightmapSampleOne($raster, 10.0, 21.0) === null, 'below the bbox is unknown, not level');
assert(avesmapsHeightmapSampleSum([], 10.0, 20.0) === null, 'no raster at all is unknown, not level');

// --- 💣 TWO OVERLAPPING RASTERS SUM. Reading only „the area that contains the point" gives a height
// that is too low in every overlap strip -- and looks perfectly ordinary while doing it (§5.0).
$second = avesmapsHeightmapDecode([
    'origin_x' => '10.0000', 'origin_y' => '20.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate(pack('v*', 7, 7, 7, 7, 7, 7)), 'sample_bytes' => 12,
]);
assert($near(avesmapsHeightmapSampleSum([$raster, $second], 10.00, 20.00), 107.0),
    'overlapping rasters must ADD, not shadow one another');
// A point only ONE of them covers still answers, with that one's value.
$far = avesmapsHeightmapDecode([
    'origin_x' => '500.0000', 'origin_y' => '500.0000',
    'cell_size_mapunits' => '0.2500', 'width_px' => 3, 'height_px' => 2,
    'samples' => gzdeflate(pack('v*', 1, 1, 1, 1, 1, 1)), 'sample_bytes' => 12,
]);
assert($near(avesmapsHeightmapSampleSum([$raster, $far], 10.00, 20.00), 100.0),
    'a raster that does not cover the point contributes nothing, and does not make the answer null');

// --- the invariant refuses rather than reading half --------------------------------------------
assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.2500',
    'width_px' => 3, 'height_px' => 2, 'samples' => gzdeflate(pack('v*', 1, 2, 3)), 'sample_bytes' => 6,
])), 'width * height * 2 != inflated length must be refused, not read half');

assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.1000',
    'width_px' => 3, 'height_px' => 2, 'samples' => gzdeflate($raw), 'sample_bytes' => 12,
])), 'a cell size below the stock resolution must be refused');

assert($throws(static fn() => avesmapsHeightmapDecode([
    'origin_x' => '0', 'origin_y' => '0', 'cell_size_mapunits' => '0.2500',
    'width_px' => 3, 'height_px' => 2, 'samples' => 'not deflate data', 'sample_bytes' => 12,
])), 'an undecompressable blob must be refused, not treated as zeros');

// --- 💣 CHECKED BY SEARCH, NOT AT RUNTIME (§9.1): the reader must never materialise the blob.
$source = (string) file_get_contents(__DIR__ . '/../heightmap.php');
assert(!preg_match("/unpack\\(\\s*'v\\*'/", $source),
    "heightmap.php must not contain unpack('v*') -- that materialises the blob as a PHP array");

fwrite(STDOUT, "heightmap-read-test: all asserts passed\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/heightmap-read-test.php
```
Erwartet: FEHLER — `Failed opening required '.../heightmap.php'`.

- [ ] **Schritt 3: `heightmap.php` schreiben**

```php
<?php

declare(strict_types=1);

// V11: reading the stored height rasters. Spec §3, §5.0, §5.4.
//
// PURITY CONTRACT: side-effect-free on include. The sampling half is pure and takes decoded raster
// arrays; the DB half takes a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE. This file only reads.
//
// 🔴 WHO READS THIS, AND WHO DOES NOT. The PROFILE RUN reads rasters (task 8). The ROUTING PATH
// never does -- it reads path_terrain and nothing else. Loading all rasters per route request is
// exactly what the derived cache exists to prevent.

require_once __DIR__ . '/terrain-store.php';

/**
 * PURE: one DB row -> a usable raster, with the blob left as a BINARY STRING.
 *
 * 💣 THE BLOB IS NEVER MATERIALISED AS A PHP ARRAY. Measured: unpack('v*') returns a 1-based,
 * unpacked array at 43 bytes per element -- 5,25 MB of blob become 42 to 95 MB of PHP at 78 areas.
 * A single point is read punctually instead, at a measured 0,08 microseconds and no extra memory.
 *
 * Refuses rather than repairs (§5.1): a truncated raster looks exactly like a whole one.
 */
function avesmapsHeightmapDecode(array $row): array
{
    $width = (int) ($row['width_px'] ?? 0);
    $height = (int) ($row['height_px'] ?? 0);
    $cell = (float) ($row['cell_size_mapunits'] ?? 0.0);

    $stored = (string) ($row['samples'] ?? '');
    // @ because gzinflate warns on garbage; the false return is the signal we act on.
    $samples = $stored === '' ? false : @gzinflate($stored);
    if ($samples === false) {
        throw new InvalidArgumentException('The raster blob could not be decompressed.');
    }
    avesmapsTerrainGuardRasterShape($width, $height, $cell, strlen($samples));

    return [
        'origin_x' => (float) ($row['origin_x'] ?? 0.0),
        'origin_y' => (float) ($row['origin_y'] ?? 0.0),
        'cell' => $cell,
        'width' => $width,
        'height' => $height,
        'samples' => $samples,
    ];
}

/**
 * PURE: read ONE sample, punctually, out of the binary string.
 *
 * ⚠️ Bilinear, not nearest. Nearest would quantise the height to the cell grid, and the ascent is a
 * TOTAL VARIATION -- a staircase would add or remove climb depending purely on where the way's
 * vertices fall inside a cell. At a grid point bilinear returns the stored value exactly, which is
 * what lets the test compare against a browser-produced blob.
 */
function avesmapsHeightmapSampleRaw(array $raster, int $col, int $row): float
{
    // 💣 unpack with an OFFSET, one element -- never unpack('v*') over the whole string.
    $offset = 2 * ($row * $raster['width'] + $col);

    return (float) unpack('v', $raster['samples'], $offset)[1];
}

function avesmapsHeightmapSampleOne(array $raster, float $x, float $y): ?float
{
    $cell = $raster['cell'];
    if ($cell <= 0.0) {
        return null;
    }
    $fx = ($x - $raster['origin_x']) / $cell;
    $fy = ($y - $raster['origin_y']) / $cell;
    // Outside is „no data", NOT 0 -- a point beyond every bbox is unknown ground, and calling it
    // level would make a missing raster indistinguishable from a plain.
    if ($fx < 0.0 || $fy < 0.0 || $fx > (float) ($raster['width'] - 1) || $fy > (float) ($raster['height'] - 1)) {
        return null;
    }

    $i = (int) floor($fx);
    $j = (int) floor($fy);
    if ($i > $raster['width'] - 2) { $i = max(0, $raster['width'] - 2); }
    if ($j > $raster['height'] - 2) { $j = max(0, $raster['height'] - 2); }
    $tx = $fx - $i;
    $ty = $fy - $j;

    $a = avesmapsHeightmapSampleRaw($raster, $i, $j);
    $b = avesmapsHeightmapSampleRaw($raster, min($i + 1, $raster['width'] - 1), $j);
    $c = avesmapsHeightmapSampleRaw($raster, $i, min($j + 1, $raster['height'] - 1));
    $d = avesmapsHeightmapSampleRaw($raster, min($i + 1, $raster['width'] - 1), min($j + 1, $raster['height'] - 1));

    $top = $a + ($b - $a) * $tx;
    $bottom = $c + ($d - $c) * $tx;

    return $top + ($bottom - $top) * $ty;
}

/**
 * PURE: the height at a point is the SUM over every raster that covers it (§5.0).
 *
 * 💣 THE READER MUST SUM. Each raster holds only its area's OWN field; V8's rule is
 * `h(x,y) = Sigma over all areas F: Feld_F(x, y, W(x,y))`
 * (map-features-ecosystem-height-combine.js:5-6). Reading „the raster of the area that contains the
 * point" gives a height that is too low in every overlap strip -- and shows nothing unusual doing it.
 *
 * `null` when no raster covers the point at all: that is „no height data", not „level".
 */
function avesmapsHeightmapSampleSum(array $rasters, float $x, float $y): ?float
{
    $sum = null;
    foreach ($rasters as $raster) {
        $value = avesmapsHeightmapSampleOne($raster, $x, $y);
        if ($value === null) {
            continue;
        }
        $sum = ($sum ?? 0.0) + $value;
    }

    return $sum;
}

/** Every stored raster, decoded. Used ONLY by the profile run -- never on the routing path. */
function avesmapsHeightmapLoadAll(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT area_id, origin_x, origin_y, cell_size_mapunits, width_px, height_px, sample_bytes, samples
           FROM ecosystem_area_heightmap ORDER BY area_id'
    );
    $rasters = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $raster = avesmapsHeightmapDecode($row);
        $raster['area_id'] = (int) $row['area_id'];
        $raster['min_x'] = $raster['origin_x'];
        $raster['min_y'] = $raster['origin_y'];
        $raster['max_x'] = $raster['origin_x'] + ($raster['width'] - 1) * $raster['cell'];
        $raster['max_y'] = $raster['origin_y'] + ($raster['height'] - 1) * $raster['cell'];
        $rasters[] = $raster;
    }

    return $rasters;
}

/**
 * The GLOBAL raster stamp: „which rasters, in which state, does the stored stock describe".
 *
 * One indexed read, NO blob -- that is what the separate stamp columns are for. Global rather than
 * per way on purpose: a raster run is a rare, owner-triggered act, unlike ecosystem_revision, which
 * jumped 901 times in one working day. After a raster run every profile is recomputed anyway.
 */
function avesmapsHeightmapGlobalStamp(PDO $pdo): string
{
    $statement = $pdo->query(
        'SELECT area_id, geometry_revision, terrain_fingerprint, peaks_fingerprint
           FROM ecosystem_area_heightmap ORDER BY area_id'
    );
    $parts = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $parts[] = $row['area_id'] . ':' . $row['geometry_revision'] . ':'
            . $row['terrain_fingerprint'] . ':' . $row['peaks_fingerprint'];
    }

    return sha1(implode('|', $parts));
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/heightmap-read-test.php
```
Erwartet: `heightmap-read-test: all asserts passed`, Exit 0.

- [ ] **Schritt 5: Commit**

```bash
git commit --only -- api/_internal/app/heightmap.php api/_internal/app/__tests__/heightmap-read-test.php -m "feat(landschaften): read the stored height rasters punctually and by SUM over overlaps"
```

---

## Aufgabe 5: Der Rasterkern im Browser

Der reine Teil: aus einem gebauten Höhenfeld und einer bbox ein `Uint16Array`. Kein DOM, kein
`fetch`, keine Fortschrittsanzeige — die kommen in Aufgabe 7.

**Dateien:**
- Erstellen: `js/map-features/map-features-ecosystem-heightmap-raster.js`
- Erstellen: `js/map-features/__tests__/ecosystem-heightmap-raster.test.js`

**Schnittstellen:**
- Verbraucht: `buildEcosystemHeightStack`, `sampleEcosystemHeightField` (vorhanden),
  `ecosystemGeometryBounds` (vorhanden).
- Liefert: `ecosystemHeightmapGrid(bounds, cellSize)` →
  `{originX, originY, width, height, cellSize}` — die **deterministische** Gitterausrichtung.
- Liefert: `async rasterizeEcosystemHeightField(field, peakWindow, grid, options)` →
  `Uint16Array` der Länge `width * height`; `options.onRowBand(done, total)` und
  `options.yield` geben den Haupt-Thread frei.
- Liefert: `ecosystemHeightmapToBase64(samples)` → base64 des little-endian-Byte-Puffers.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```js
// js/map-features/__tests__/ecosystem-heightmap-raster.test.js
//
// V11: the pure browser-side rasteriser. Run from the repo root:
//   node js/map-features/__tests__/ecosystem-heightmap-raster.test.js
// Exit 0 = all asserts passed.
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

// The height modules are plain <script> files with module.exports at the bottom; the geometry helpers
// they call are globals. Load them into ONE shared context so the globals resolve.
// 💣 A stub in the sandbox would swallow the very rule under test -- these are the REAL files.
const context = { module: { exports: {} }, Math, Number, Array, Map, Float64Array, Uint16Array, Infinity, String, Boolean, console };
context.globalThis = context;
vm.createContext(context);
["map-features-ecosystem-geometry.js",
 "map-features-ecosystem-height-field.js",
 "map-features-ecosystem-height-combine.js",
 "map-features-ecosystem-heightmap-raster.js"].forEach((file) => {
	const full = path.join(__dirname, "..", file);
	context.module = { exports: {} };
	vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: full });
});

const square = (minX, minY, size) => ({
	type: "Polygon",
	coordinates: [[[minX, minY], [minX + size, minY], [minX + size, minY + size], [minX, minY + size], [minX, minY]]],
});

// --- the grid is DETERMINISTIC and snapped to the cell lattice ---------------------------------
// 💣 Two rasters that do not share a lattice still sum correctly (each is sampled on its own), but
// an unsnapped origin makes the same area produce a different grid after a bbox nudge -- and then
// „did the raster change?" has no stable answer.
const grid = context.ecosystemHeightmapGrid({ min_x: 10.1, min_y: 20.3, max_x: 11.1, max_y: 21.3 }, 0.25);
assert.strictEqual(grid.originX, 10.0, "the origin snaps DOWN to the cell lattice");
assert.strictEqual(grid.originY, 20.25, "the origin snaps DOWN to the cell lattice");
assert.ok(grid.originX + (grid.width - 1) * 0.25 >= 11.1, "the grid must cover the whole bbox in x");
assert.ok(grid.originY + (grid.height - 1) * 0.25 >= 21.3, "the grid must cover the whole bbox in y");
assert.strictEqual(grid.cellSize, 0.25, "the cell size travels with the grid");

// The same bbox twice gives the same grid -- no drift, no rounding wobble.
const again = context.ecosystemHeightmapGrid({ min_x: 10.1, min_y: 20.3, max_x: 11.1, max_y: 21.3 }, 0.25);
assert.deepStrictEqual(again, grid, "the grid is a function of the bbox alone");

(async () => {
	const area = { public_id: "a", geometry_revision: 1, geometry: square(0, 0, 40), region_type: "gebirge" };
	const peaks = [{ publicId: "p", x: 20, y: 20, height: 3000 }];
	const stack = context.buildEcosystemHeightStack([area], peaks);
	assert.strictEqual(stack.fields.length, 1, "the test area must actually carry a field");
	const field = stack.fields[0];
	const box = context.ecosystemGeometryBounds(area.geometry);
	const g = context.ecosystemHeightmapGrid(box, 0.25);

	let bands = 0;
	let yields = 0;
	const samples = await context.rasterizeEcosystemHeightField(field, stack.peakWindow, g, {
		onRowBand: () => { bands += 1; },
		yield: async () => { yields += 1; },
	});

	// --- shape ---------------------------------------------------------------------------------
	assert.ok(samples instanceof Uint16Array, "the raster is a Uint16Array, not an array of numbers");
	assert.strictEqual(samples.length, g.width * g.height, "one sample per grid point");

	// --- 💣 THE PIXEL IS THE HEIGHT IN SCHRITT. No white point, no per-area stretch. The display
	// knows two scales (a global 5.000er white point and, while editing, max(100, tallest peak of the
	// stack)); storing THOSE pixels would give every mountain range a different scale and gradients
	// wrong by exactly that stretch -- differently wrong per area, and visible to nobody.
	const peakIndex = Math.round((20 - g.originY) / 0.25) * g.width + Math.round((20 - g.originX) / 0.25);
	assert.ok(samples[peakIndex] > 2900 && samples[peakIndex] <= 3000,
		"the peak cell must read its entered height in Schritt, got " + samples[peakIndex]);

	// --- the foot-height-0 invariant survives rasterising -----------------------------------------
	assert.strictEqual(samples[0], 0, "the bbox corner lies outside the area and must be 0");

	// --- every value matches a direct field sample, to the rounding ------------------------------
	for (const [col, row] of [[3, 3], [10, 12], [g.width - 4, g.height - 4]]) {
		const x = g.originX + col * 0.25;
		const y = g.originY + row * 0.25;
		const direct = context.sampleEcosystemHeightField(field, x, y, stack.peakWindow.sample(x, y));
		assert.strictEqual(samples[row * g.width + col], Math.max(0, Math.min(65535, Math.round(direct))),
			"the raster must be the field, rounded -- nothing else");
	}

	// --- 💣 the main thread is released per row band. Without it 1,4 million pixels at 40 areas
	// freeze the tab for seconds and Chrome offers „page unresponsive".
	assert.ok(yields > 0, "the rasteriser must yield the main thread at least once");
	assert.ok(bands > 0, "the rasteriser must report progress per row band");

	// --- clamping is explicit, never a silent wrap ------------------------------------------------
	// 65.535 Schritt is four times the owner's 15.000 ceiling; a value above it is a data fault, and
	// wrapping to a low number would turn a mountain into a valley.
	const tall = { public_id: "b", geometry_revision: 1, geometry: square(0, 0, 40), region_type: "gebirge" };
	const tallStack = context.buildEcosystemHeightStack([tall], [{ publicId: "q", x: 20, y: 20, height: 90000 }]);
	const tallSamples = await context.rasterizeEcosystemHeightField(
		tallStack.fields[0], tallStack.peakWindow, g, {});
	assert.ok(Math.max(...tallSamples) === 65535, "an over-tall value clamps at 65535, it does not wrap");

	// --- base64 round trip, little-endian -----------------------------------------------------
	const encoded = context.ecosystemHeightmapToBase64(new Uint16Array([1, 258]));
	const bytes = Buffer.from(encoded, "base64");
	assert.strictEqual(bytes.length, 4, "two uint16 are four bytes");
	assert.deepStrictEqual([...bytes], [1, 0, 2, 1], "little-endian, as the PHP reader's unpack('v') expects");

	console.log("ecosystem-heightmap-raster.test: all asserts passed");
})().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/ecosystem-heightmap-raster.test.js
```
Erwartet: FEHLER — `ENOENT ... map-features-ecosystem-heightmap-raster.js`.

- [ ] **Schritt 3: Den Rasterkern schreiben**

```js
// Landschaften — das Höhenfeld EINER Fläche als gespeichertes Raster (V11).
//
// 🔴 WARUM ÜBERHAUPT GESPEICHERT WIRD. Der Server kann dieses Feld nicht selbst erzeugen und darf es
// nie versuchen: map-features-ecosystem-height-field.js benutzt je Zelle `Math.pow` mit gebrochenem
// Exponenten (:768) sowie `Math.exp` (:972) und `Math.hypot` (:970). ECMAScript erlaubt dort
// implementierungsabhängige Ergebnisse, PHP nimmt die libm des Systems, und auf STRATO weiß niemand,
// welche läuft. Das bliebe nicht klein: `field.noiseScale = target / Math.pow(loudest, exponent)`
// (:663) hängt an einem ARGMAX -- ein anderes letztes Bit in EINER Zelle entscheidet, welche die
// lauteste ist, und verschiebt damit die Skalierung der GANZEN Fläche. Also rechnet der Browser
// einmal, das Ergebnis wird gespeichert, alle lesen es.
//
// 🔴 EIN RASTER TRÄGT NUR DAS EIGENE FELD, nicht die Stapelsumme (Spec §5.0). Der Leser summiert
// überlappende Raster; dafür bezahlt er einen Zugriff je Raster und bekommt dreierlei zurück: der
// Rasterlauf kostet bei 40 Flächen ~0,2 s statt ~7 s, und eine geänderte Nachbarfläche macht KEIN
// fremdes Raster ungültig.
//
// 🔴 DER PIXELWERT IST DIE HÖHE IN SCHRITT. Kein Weißpunkt, kein Maßstab, keine Normierung. Was auf
// dem Bildschirm steht, ist NICHT die Höhe: die Anzeige kennt zwei Bezüge
// (map-features-ecosystem-height-render.js:298-300) -- den festen `HEIGHT_WHITE_SCHRITT = 5000` und,
// beim Bearbeiten, `max(100, höchster Gipfel des Stapels)`, also je Fläche GEDEHNT. Wer diese Pixel
// speicherte, bekäme je Gebirge einen anderen Maßstab und Steigungen, die um genau diesen Dehnfaktor
// falsch sind -- unterschiedlich falsch je Fläche, und für niemanden sichtbar.

// 0..65.535 fasst die 15.000 Schritt aus Owner-Entscheid 5 auf einen Schritt genau, mit vierfachem
// Spielraum. Ein Wert darüber ist ein Datenfehler; er wird GEKLEMMT, nie umgebrochen -- ein Umbruch
// machte aus einem Berg ein Tal.
const ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT = 65535;
// Wie viele Zeilen am Stück, bevor der Haupt-Thread freigegeben wird. 💣 V9 §1 hat diese Regel
// wörtlich: 529.531 Pixel bei 15 Flächen, 1,4 Mio bei 40 -- ohne Freigabe sind das mehrere Sekunden
// eingefrorener Tab, und Chrome bietet „Seite reagiert nicht" an.
const ECOSYSTEM_HEIGHTMAP_ROW_BAND = 32;

// Das Gitter EINER Fläche: deterministisch, am Zellraster ausgerichtet, allein aus der bbox.
//
// 🪤 Die Ausrichtung ist kein Schmuck. Ohne sie verschöbe schon eine winzige bbox-Änderung das ganze
// Gitter, und „hat sich das Raster geändert?" hätte keine stabile Antwort mehr.
function ecosystemHeightmapGrid(bounds, cellSize) {
	const cell = Number(cellSize) > 0 ? Number(cellSize) : 0.25;
	const originX = Math.floor(bounds.min_x / cell) * cell;
	const originY = Math.floor(bounds.min_y / cell) * cell;

	return {
		originX,
		originY,
		cellSize: cell,
		width: Math.ceil((bounds.max_x - originX) / cell) + 1,
		height: Math.ceil((bounds.max_y - originY) / cell) + 1,
	};
}

// Das Feld EINER Fläche über ihr Gitter, zeilenweise, uint16 = Schritt.
//
// `peakWindow` kommt vom Stapel und gilt über ALLE Gipfel ALLER Flächen -- je Fläche gerechnet wäre
// es wertlos, weil der Nachbargipfel dann nicht mitzählte (buildEcosystemPeakWindow).
async function rasterizeEcosystemHeightField(field, peakWindow, grid, options) {
	const settings = options || {};
	const samples = new Uint16Array(grid.width * grid.height);
	const bandCount = Math.max(1, Math.ceil(grid.height / ECOSYSTEM_HEIGHTMAP_ROW_BAND));
	const release = typeof settings.yield === "function"
		? settings.yield
		: () => new Promise((resolve) => setTimeout(resolve, 0));

	for (let band = 0; band < bandCount; band++) {
		const firstRow = band * ECOSYSTEM_HEIGHTMAP_ROW_BAND;
		const lastRow = Math.min(grid.height, firstRow + ECOSYSTEM_HEIGHTMAP_ROW_BAND);
		for (let row = firstRow; row < lastRow; row++) {
			const y = grid.originY + row * grid.cellSize;
			const offset = row * grid.width;
			for (let col = 0; col < grid.width; col++) {
				const x = grid.originX + col * grid.cellSize;
				// Genau die Abfrage, die auch die Malschleife benutzt -- das Fenster EINMAL je Punkt,
				// dann das Feld. Wer hier etwas anderes rechnet, speichert ein anderes Gelände als das
				// gezeichnete.
				const value = sampleEcosystemHeightField(field, x, y, peakWindow ? peakWindow.sample(x, y) : 1);
				const rounded = Math.round(value);
				samples[offset + col] = rounded > ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
					? ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
					: (rounded > 0 ? rounded : 0);
			}
		}
		if (typeof settings.onRowBand === "function") {
			settings.onRowBand(band + 1, bandCount);
		}
		await release();
	}

	return samples;
}

// Little-endian Bytes, base64. 🔴 Der Browser komprimiert NICHT: der Server deflatet beim Schreiben
// (`gzdeflate`) und inflatet beim Lesen. Das erspart eine Formatabsprache zwischen
// `CompressionStream` und PHPs zlib -- und je Fläche sind es höchstens 286 KB roh, also 382 KB
// base64, weit unter dem üblichen `post_max_size` von 8 MB.
function ecosystemHeightmapToBase64(samples) {
	const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	let binary = "";
	// In Blöcken, nicht in einem Rutsch: `String.fromCharCode(...bytes)` sprengt bei 572.000 Bytes
	// den Argumentstapel.
	for (let i = 0; i < bytes.length; i += 8192) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
	}

	return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT,
		ECOSYSTEM_HEIGHTMAP_ROW_BAND,
		ecosystemHeightmapGrid,
		rasterizeEcosystemHeightField,
		ecosystemHeightmapToBase64,
	};
}
```

⚠️ Die drei Funktionen müssen auch als **Globale** sichtbar sein (die Datei wird als `<script>`
geladen, ohne Modulsystem) — deklariert mit `function` auf oberster Ebene sind sie das
automatisch. 💣 **Kein zweites `const` auf oberster Ebene mit einem Namen, den ein anderes
Skript schon führt** — das ist ein harter `SyntaxError` für die ganze Seite. Vor dem Commit
prüfen:

```bash
grep -rn "ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT\|ECOSYSTEM_HEIGHTMAP_ROW_BAND\|ecosystemHeightmapGrid\|rasterizeEcosystemHeightField\|ecosystemHeightmapToBase64" js/ --include=*.js | grep -v heightmap-raster
```
Erwartet: keine Treffer außer im Test.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/ecosystem-heightmap-raster.test.js
```
Erwartet: `ecosystem-heightmap-raster.test: all asserts passed`, Exit 0.

- [ ] **Schritt 5: Die bestehenden Höhen-Tests dürfen nicht brechen**

```bash
node js/map-features/__tests__/ecosystem-height-field.test.js && node js/map-features/__tests__/ecosystem-height-combine.test.js
```
Erwartet: beide unverändert grün.

- [ ] **Schritt 6: Commit**

```bash
git commit --only -- js/map-features/map-features-ecosystem-heightmap-raster.js js/map-features/__tests__/ecosystem-heightmap-raster.test.js -m "feat(landschaften): rasterise one area's own height field to uint16 Schritt, yielding per row band"
```

---

## Aufgabe 6: Gipfel-Endpunkt und Raster-Ablage

**Dateien:**
- Erstellen: `api/edit/map/peaks-geometry.php`
- Ändern: `api/_internal/app/terrain-store.php` (Fingerabdrücke + `heightmap_put/status/cleanup`)
- Ändern: `api/_internal/app/__tests__/terrain-store-test.php` (Fingerabdruck-Tests anhängen)
- Ändern: `api/edit/map/ecosystem.php` (drei Aktionen im `match($action)`)

**Schnittstellen:**
- Verbraucht: `avesmapsTerrainGuardRasterShape` (Aufgabe 2), `avesmapsUuidV4` (bereits über
  `features.php` im Dispatcher geladen).
- Liefert: `GET /api/edit/map/peaks-geometry.php` →
  `{ ok, map_revision, peaks:[{public_id, x, y, height_schritt|null}] }`.
- Liefert: `avesmapsTerrainAreaFingerprint(array $areaRow): string`,
  `avesmapsTerrainPeaksFingerprint(array $peaks, array $heightAreas): string` (beide **rein**).
- Liefert: Aktionen `heightmap_put`, `heightmap_status`, `heightmap_cleanup`.

- [ ] **Schritt 1: Den Gipfel-Endpunkt schreiben**

Vorbild ist `api/edit/map/paths-geometry.php` — gleiche Form, gleicher Wächter, gleiche
Begründung.

```php
<?php

declare(strict_types=1);

// V11: the peak labels for the Landschaften editor's „Höhenraster rechnen" button.
//
// WHY A SEPARATE ENDPOINT, and the same reasoning as paths-geometry.php: the editor loads no
// map_features at all, and the map payload is 17,79 MB for a fraction of what is wanted here --
// 67 label points out of 11.054 features. This answers with a few kilobytes.
//
// WHY api/edit/ AND NOT api/app/. One editor button behind one capability. The public read surface
// does not grow for it (AGENTS.md §4).
//
// 💣 THE SUBTYPE LIST IS THE MODULE'S, NOT A SECOND ONE. `berggipfel` and `vulkan` are what
// ECOSYSTEM_PEAK_SUBTYPES in map-features-ecosystem-height-field.js reads, and a second list here is
// exactly the double bookkeeping `vulkan` already failed once. It is repeated as a literal because
// PHP cannot read the JS constant -- and it is repeated WITH this note, so the next change touches
// both.

require __DIR__ . '/../../_internal/auth.php';

const AVESMAPS_PEAK_LABEL_SUBTYPES = ['berggipfel', 'vulkan'];

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load peak geometry.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for peak geometry.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // No EnsureTables: map_features has existed since the beginning, and this stays a plain read.
    $placeholders = implode(',', array_fill(0, count(AVESMAPS_PEAK_LABEL_SUBTYPES), '?'));
    $statement = $pdo->prepare(
        "SELECT public_id, geometry_json, properties_json
           FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND feature_subtype IN ({$placeholders})
          ORDER BY id"
    );
    $statement->execute(AVESMAPS_PEAK_LABEL_SUBTYPES);

    $peaks = [];
    $skipped = 0;
    $withHeight = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
        if (($geometry['type'] ?? '') !== 'Point' || !is_array($coordinates) || count($coordinates) < 2) {
            $skipped++;
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $rawHeight = is_array($properties) ? ($properties['height_schritt'] ?? null) : null;
        // 🪤 A peak WITHOUT a height is not an error and not a zero: it travels as null, and the field
        // module substitutes its own default (5.000). Today 16 of 67 carry a height, so this is the
        // normal case, not the exception.
        $height = is_numeric($rawHeight) && (float) $rawHeight > 0.0 ? (float) $rawHeight : null;
        if ($height !== null) {
            $withHeight++;
        }
        // 💣 GeoJSON stores [x, y]. The label layer in the browser carries [lat, lng] = [y, x] and
        // swaps on the way in (peakList in map-features-ecosystem-height-render.js). This endpoint
        // answers in GEOMETRY order, x first -- the order the raster grid wants.
        $peaks[] = [
            'public_id' => (string) $row['public_id'],
            'x' => (float) $coordinates[0],
            'y' => (float) $coordinates[1],
            'height_schritt' => $height,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'skipped' => $skipped,
        'with_height' => $withHeight,
        'peaks' => $peaks,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Peak geometry could not be loaded from the database.');
} catch (Throwable) {
    // No getMessage() to the client: several edit endpoints leak exception text (milestone M1) and
    // this is not the place to add another one.
    avesmapsErrorResponse(500, 'server_error', 'Peak geometry could not be loaded.');
}
```

- [ ] **Schritt 2: Den Fingerabdruck-Test anhängen**

An `api/_internal/app/__tests__/terrain-store-test.php`, **vor** die abschließende
`fwrite(STDOUT, ...)`-Zeile:

```php
// ---- fingerprints ---------------------------------------------------------------------------
// 🔴 `ecosystem_revision` IS NOT IN ANY STAMP. It is ONE GLOBAL counter (ecosystem.php, id = 1,
// 11 call sites): every edit to any of the 686 areas bumps it, a lake included, a rename included.
// Measured in these very specs: V9 read 3082 on 2026-07-29, V11 read 3983 the SAME DAY -- 901 jumps
// in one working day. The raster stock would have been „stale" 901 times, at 8 s of recomputation
// each. After the third time nobody presses the button, and then a raster whose stamp says „stale"
// is what the map runs on.
$area = ['geometry_revision' => 4, 'terrain_grain' => 3.2, 'terrain_levels' => 3,
    'terrain_avg_height' => 2000.0, 'terrain_mean_height' => 500.0, 'region_type' => 'gebirge'];
$base = avesmapsTerrainAreaFingerprint($area);
assert(strlen($base) === 40, 'a fingerprint is a sha1');
assert(avesmapsTerrainAreaFingerprint($area) === $base, 'the same area gives the same fingerprint');
assert(avesmapsTerrainAreaFingerprint(['terrain_grain' => 4.0] + $area) !== $base,
    'turning a terrain knob must change the area fingerprint');
assert(avesmapsTerrainAreaFingerprint(['region_type' => 'huegelland'] + $area) !== $base,
    'the drawing method follows the KIND, so the kind belongs in the fingerprint');
// geometry_revision has its own column and is compared separately -- it is deliberately NOT folded in.
assert(avesmapsTerrainAreaFingerprint(['geometry_revision' => 9] + $area) === $base,
    'geometry_revision is its own column, not part of this fingerprint');

$peaks = [
    ['public_id' => 'p1', 'x' => 10.0, 'y' => 20.0, 'height_schritt' => 3000.0],
    ['public_id' => 'p2', 'x' => 30.0, 'y' => 40.0, 'height_schritt' => null],
];
$heightAreas = [['public_id' => 'a1', 'geometry_revision' => 2]];
$peakStamp = avesmapsTerrainPeaksFingerprint($peaks, $heightAreas);
assert(strlen($peakStamp) === 40, 'the peaks fingerprint is a sha1');
assert(avesmapsTerrainPeaksFingerprint(array_reverse($peaks), $heightAreas) === $peakStamp,
    'the order the rows arrive in must not change the fingerprint');

// 💣 IT MUST BE GLOBAL. `separationAt` has NO distance limit
// (map-features-ecosystem-height-field.js:198-211): delete a peak and its neighbour's separation
// jumps to the next one, wherever that is -- which moves that neighbour's radius, and through
// `field.hmax` and `noiseScale` the SCALING OF THE WHOLE AREA. Same argmax trap as §2.
$moved = $peaks;
$moved[1]['x'] = 900.0;
assert(avesmapsTerrainPeaksFingerprint($moved, $heightAreas) !== $peakStamp,
    'a peak moving ANYWHERE must invalidate every raster');
$raised = $peaks;
$raised[0]['height_schritt'] = 3100.0;
assert(avesmapsTerrainPeaksFingerprint($raised, $heightAreas) !== $peakStamp,
    'a changed peak height must invalidate');

// 💣 AND IT MUST COVER THE ASSIGNMENT. `assignEcosystemPeaksToAreas`
// (map-features-ecosystem-height-combine.js:88) gives each peak to the SMALLEST CONTAINING area.
// Draw a new, smaller overlapping area and it STEALS the old one's peaks -- while the old area's
// geometry_revision and its knobs do not change at all. Without this its raster would claim to be
// current and be wrong. This case bites TODAY, not once the stock grows.
//
// ⚠️ DEVIATION FROM THE SPEC, on purpose. §5.1 asks for „the assigned area_id" in the fingerprint.
// That assignment is point-in-polygon and exists only in JS; reproducing it in PHP would be a second
// implementation of a rule that has to agree exactly. Instead the fingerprint carries every
// HEIGHT-BEARING area with its geometry_revision -- the assignment can only change when one of those
// is redrawn, added, removed or changes kind, so this covers the same cases without the second copy.
assert(avesmapsTerrainPeaksFingerprint($peaks, [['public_id' => 'a1', 'geometry_revision' => 3]]) !== $peakStamp,
    'redrawing a height-bearing area can steal peaks and must invalidate');
assert(avesmapsTerrainPeaksFingerprint($peaks, [
    ['public_id' => 'a1', 'geometry_revision' => 2],
    ['public_id' => 'a2', 'geometry_revision' => 1],
]) !== $peakStamp, 'a NEW height-bearing area can steal peaks and must invalidate');
// A lake being redrawn does NOT appear here at all -- it carries no height field, so it cannot steal
// a peak. That is the whole point of restricting the list.
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: FEHLER — `Call to undefined function avesmapsTerrainAreaFingerprint()`.

- [ ] **Schritt 4: Fingerabdrücke und Ablage in `terrain-store.php` ergänzen**

Ans Ende von `api/_internal/app/terrain-store.php` anhängen:

```php
/**
 * PURE: what THIS area was rasterised against, apart from its geometry revision.
 *
 * geometry_revision stays its own column: it is compared on its own and reads better in a query.
 */
function avesmapsTerrainAreaFingerprint(array $areaRow): string
{
    $number = static function (mixed $value): string {
        return $value === null ? 'null' : rtrim(rtrim(sprintf('%.4F', (float) $value), '0'), '.');
    };

    return sha1(implode('|', [
        'grain=' . $number($areaRow['terrain_grain'] ?? null),
        'levels=' . ($areaRow['terrain_levels'] === null ? 'null' : (string) (int) $areaRow['terrain_levels']),
        'avg=' . $number($areaRow['terrain_avg_height'] ?? null),
        'mean=' . $number($areaRow['terrain_mean_height'] ?? null),
        // The drawing method follows the KIND (ECOSYSTEM_TERRAIN_METHOD_BY_TYPE), so a changed kind
        // is a changed field even when every knob stands still.
        'type=' . (string) ($areaRow['region_type'] ?? ''),
    ]));
}

/**
 * PURE: the GLOBAL peak state -- every peak, plus every HEIGHT-BEARING area's geometry revision.
 *
 * 💣 GLOBAL IS NOT AN OVERSIGHT, IT IS THE POINT. Two couplings reach across the whole map:
 *  1. `separationAt` has no distance limit (map-features-ecosystem-height-field.js:198-211). Delete
 *     a peak and its neighbour's separation jumps to the next one, wherever that lies -- which moves
 *     that neighbour's bump radius and, through `field.hmax` and `noiseScale`, the scaling of the
 *     whole area.
 *  2. `assignEcosystemPeaksToAreas` gives each peak to the SMALLEST CONTAINING area. A new, smaller
 *     overlapping area STEALS the old one's peaks while the old one's revision and knobs stand still.
 *
 * ⚠️ Spec §5.1 asks for the assigned area_id here. That assignment is point-in-polygon and lives only
 * in JS; carrying the height-bearing areas' geometry revisions instead covers the same set of causes
 * without a second implementation of a rule that would have to agree exactly. A lake being redrawn
 * does not appear at all -- it carries no field and cannot steal a peak.
 *
 * @param list<array{public_id:string,x:float,y:float,height_schritt:?float}> $peaks
 * @param list<array{public_id:string,geometry_revision:int}> $heightAreas
 */
function avesmapsTerrainPeaksFingerprint(array $peaks, array $heightAreas): string
{
    $peakParts = [];
    foreach ($peaks as $peak) {
        $height = $peak['height_schritt'] ?? null;
        $peakParts[] = (string) ($peak['public_id'] ?? '')
            . ':' . sprintf('%.4F', (float) ($peak['x'] ?? 0.0))
            . ':' . sprintf('%.4F', (float) ($peak['y'] ?? 0.0))
            . ':' . ($height === null ? 'null' : sprintf('%.2F', (float) $height));
    }
    $areaParts = [];
    foreach ($heightAreas as $area) {
        $areaParts[] = (string) ($area['public_id'] ?? '') . ':' . (int) ($area['geometry_revision'] ?? 0);
    }
    // Sorted, so the order rows arrive in cannot change the answer -- the same reason
    // assignEcosystemPeaksToAreas breaks ties by public_id rather than by load order.
    sort($peakParts);
    sort($areaParts);

    return sha1(implode('|', $peakParts) . '#' . implode('|', $areaParts));
}

// ---- the raster store ------------------------------------------------------------------------
// 💣 STILL NO EnsureTables. See the note at the top of this file.

/** Peaks and height-bearing areas, in the shape the two fingerprints want. */
function avesmapsTerrainReadStampInputs(PDO $pdo): array
{
    $peaks = [];
    $statement = $pdo->query(
        "SELECT public_id, geometry_json, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND feature_subtype IN ('berggipfel', 'vulkan')"
    );
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $rawHeight = is_array($properties) ? ($properties['height_schritt'] ?? null) : null;
        $peaks[] = [
            'public_id' => (string) $row['public_id'],
            'x' => (float) $coordinates[0],
            'y' => (float) $coordinates[1],
            'height_schritt' => is_numeric($rawHeight) && (float) $rawHeight > 0.0 ? (float) $rawHeight : null,
        ];
    }

    // Which areas carry a height field at all: the gate is region_type = 'gebirge'
    // (map-features-ecosystem-loader.js:330 and -height-render.js). `huegelland: "warp"` already
    // stands written in -height-combine.js:57 and waits for the gate to open -- when it does, this
    // list grows HERE and nowhere else.
    $heightAreas = [];
    $statement = $pdo->query(
        "SELECT a.public_id, a.geometry_revision FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE a.is_active = 1 AND r.kind = 'topographie' AND r.region_type = 'gebirge'"
    );
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $heightAreas[] = [
            'public_id' => (string) $row['public_id'],
            'geometry_revision' => (int) $row['geometry_revision'],
        ];
    }

    return ['peaks' => $peaks, 'height_areas' => $heightAreas];
}

/**
 * Store ONE area's raster. 🔴 ONE REQUEST PER AREA (§3.3).
 *
 * 78 areas would be 5,25 MB raw and 7,0 MB base64 in one request -- over the usual post_max_size of
 * 8 MB. Per area it is at most 286 KB raw. And an abort no longer voids the whole stock: the areas
 * already written stand.
 *
 * 💣 THE SERVER STAMPS, NOT THE CLIENT. Both fingerprints are derived here, from this database --
 * a client-supplied stamp could claim currency the raster does not have, and nothing downstream
 * re-checks.
 */
function avesmapsTerrainHeightmapPut(PDO $pdo, array $payload, int $userId): array
{
    $areaPublicId = avesmapsNormalizeSingleLine((string) ($payload['area'] ?? ''), 36);
    if ($areaPublicId === '') {
        throw new InvalidArgumentException('area must be a public id.');
    }
    $width = filter_var($payload['width'] ?? null, FILTER_VALIDATE_INT);
    $height = filter_var($payload['height'] ?? null, FILTER_VALIDATE_INT);
    $cell = filter_var($payload['cell_size'] ?? null, FILTER_VALIDATE_FLOAT);
    $originX = filter_var($payload['origin_x'] ?? null, FILTER_VALIDATE_FLOAT);
    $originY = filter_var($payload['origin_y'] ?? null, FILTER_VALIDATE_FLOAT);
    if ($width === false || $height === false || $cell === false || $originX === false || $originY === false) {
        throw new InvalidArgumentException('width, height, cell_size, origin_x and origin_y are required.');
    }
    $samples = base64_decode((string) ($payload['samples'] ?? ''), true);
    if ($samples === false) {
        throw new InvalidArgumentException('samples must be base64.');
    }
    avesmapsTerrainGuardRasterShape((int) $width, (int) $height, (float) $cell, strlen($samples));

    $statement = $pdo->prepare(
        "SELECT a.id, a.geometry_revision, r.region_type
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE a.public_id = :p AND a.is_active = 1 LIMIT 1"
    );
    $statement->execute(['p' => $areaPublicId]);
    $areaRow = $statement->fetch(PDO::FETCH_ASSOC);
    if ($areaRow === false) {
        // Dropped, not thrown: between computing and saving, an editor in another window may have
        // deleted the area. Losing the run over it would be the wrong trade -- the count travels back.
        return ['written' => 0, 'skipped' => 1];
    }
    $knobs = $pdo->prepare(
        'SELECT terrain_grain, terrain_levels, terrain_avg_height, terrain_mean_height
           FROM ecosystem_area WHERE id = :id'
    );
    $knobs->execute(['id' => (int) $areaRow['id']]);
    $areaRow += (array) $knobs->fetch(PDO::FETCH_ASSOC);

    $inputs = avesmapsTerrainReadStampInputs($pdo);
    $insert = $pdo->prepare(
        'INSERT INTO ecosystem_area_heightmap
             (area_id, cell_size_mapunits, origin_x, origin_y, width_px, height_px, samples,
              sample_bytes, geometry_revision, terrain_fingerprint, peaks_fingerprint, computed_by)
         VALUES (:area, :cell, :ox, :oy, :w, :h, :blob, :bytes, :rev, :terrain, :peaks, :user)
         ON DUPLICATE KEY UPDATE cell_size_mapunits = VALUES(cell_size_mapunits),
             origin_x = VALUES(origin_x), origin_y = VALUES(origin_y),
             width_px = VALUES(width_px), height_px = VALUES(height_px),
             samples = VALUES(samples), sample_bytes = VALUES(sample_bytes),
             geometry_revision = VALUES(geometry_revision),
             terrain_fingerprint = VALUES(terrain_fingerprint),
             peaks_fingerprint = VALUES(peaks_fingerprint),
             computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
    );
    // Deflate HERE, not in the browser: smooth 16-bit terrain and the empty bbox corners (60 to 70 %
    // of the area on a diagonal range) give a typical 3 to 6x, and it spares a compression-format
    // agreement between CompressionStream and PHP's zlib.
    $compressed = gzdeflate($samples, 6);
    $insert->execute([
        'area' => (int) $areaRow['id'], 'cell' => $cell, 'ox' => $originX, 'oy' => $originY,
        'w' => (int) $width, 'h' => (int) $height,
        'blob' => $compressed, 'bytes' => strlen($samples),
        'rev' => (int) $areaRow['geometry_revision'],
        'terrain' => avesmapsTerrainAreaFingerprint($areaRow),
        'peaks' => avesmapsTerrainPeaksFingerprint($inputs['peaks'], $inputs['height_areas']),
        'user' => $userId > 0 ? $userId : null,
    ]);

    return ['written' => 1, 'skipped' => 0, 'stored_bytes' => strlen($compressed)];
}

/**
 * §5.7: rasters of areas that are gone or no longer carry a field.
 *
 * Without it every „load all rasters" drags blobs of deleted areas along -- and the row goes on
 * claiming validity.
 */
function avesmapsTerrainHeightmapCleanup(PDO $pdo): array
{
    $removed = $pdo->exec(
        "DELETE h FROM ecosystem_area_heightmap h
           LEFT JOIN ecosystem_area a ON a.id = h.area_id AND a.is_active = 1
           LEFT JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
                 AND r.kind = 'topographie' AND r.region_type = 'gebirge'
          WHERE a.id IS NULL OR r.id IS NULL"
    );

    return ['removed' => (int) $removed];
}

/**
 * Per area: is there a raster, and does its stamp still match? For the tile, and for the acceptance.
 *
 * „Stale" is a COMPARISON, never a guess.
 */
function avesmapsTerrainHeightmapStatus(PDO $pdo): array
{
    $inputs = avesmapsTerrainReadStampInputs($pdo);
    $currentPeaks = avesmapsTerrainPeaksFingerprint($inputs['peaks'], $inputs['height_areas']);

    $statement = $pdo->query(
        "SELECT a.public_id, a.geometry_revision, r.name AS region_name, r.region_type,
                a.terrain_grain, a.terrain_levels, a.terrain_avg_height, a.terrain_mean_height,
                h.geometry_revision AS stamped_revision, h.terrain_fingerprint, h.peaks_fingerprint,
                h.width_px, h.height_px, h.sample_bytes, h.computed_at
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
           LEFT JOIN ecosystem_area_heightmap h ON h.area_id = a.id
          WHERE a.is_active = 1 AND r.kind = 'topographie' AND r.region_type = 'gebirge'
          ORDER BY r.name, a.public_id"
    );

    $areas = [];
    $missing = 0;
    $stale = 0;
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $hasRaster = $row['terrain_fingerprint'] !== null;
        $isStale = $hasRaster && (
            (int) $row['stamped_revision'] !== (int) $row['geometry_revision']
            || (string) $row['terrain_fingerprint'] !== avesmapsTerrainAreaFingerprint($row)
            || (string) $row['peaks_fingerprint'] !== $currentPeaks
        );
        if (!$hasRaster) { $missing++; } elseif ($isStale) { $stale++; }
        $areas[] = [
            'public_id' => (string) $row['public_id'],
            'region_name' => (string) $row['region_name'],
            'has_raster' => $hasRaster,
            'stale' => $isStale,
            'width_px' => $hasRaster ? (int) $row['width_px'] : 0,
            'height_px' => $hasRaster ? (int) $row['height_px'] : 0,
            'sample_bytes' => $hasRaster ? (int) $row['sample_bytes'] : 0,
            'computed_at' => $hasRaster ? (string) $row['computed_at'] : '',
        ];
    }

    return [
        'areas' => $areas,
        'area_count' => count($areas),
        'missing' => $missing,
        'stale' => $stale,
        'peaks_with_height' => count(array_filter($inputs['peaks'], static fn(array $p): bool => $p['height_schritt'] !== null)),
        'peaks_total' => count($inputs['peaks']),
    ];
}
```

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: `terrain-store-test: all asserts passed`, Exit 0.

- [ ] **Schritt 6: Die drei Aktionen im Dispatcher anmelden**

In `api/edit/map/ecosystem.php`: nach der `require_once`-Zeile für `path-ecosystem.php` ergänzen

```php
// V11: the terrain store. It needs avesmapsUuidV4 from features.php above, like V9's store does.
require_once __DIR__ . '/../../_internal/app/terrain-store.php';
require_once __DIR__ . '/../../_internal/app/heightmap.php';
```

und im `match($action)` **hinter** `'assignment_status'`:

```php
        // V11: the height rasters. The BROWSER rasterises (spec §2: PHP cannot reproduce the field
        // -- Math.pow with a fractional exponent per cell, and an argmax that would rescale a whole
        // area from one differing last bit); these three only take the result in, one area per
        // request, and stamp it against THIS database.
        'heightmap_put' => avesmapsTerrainHeightmapPut($pdo, $payload, $userId),
        'heightmap_cleanup' => avesmapsTerrainHeightmapCleanup($pdo),
        'heightmap_status' => avesmapsTerrainHeightmapStatus($pdo),
```

- [ ] **Schritt 7: Syntax prüfen**

```bash
php -l api/edit/map/peaks-geometry.php && php -l api/_internal/app/terrain-store.php && php -l api/edit/map/ecosystem.php
```
Erwartet: dreimal `No syntax errors detected`.

- [ ] **Schritt 8: Commit**

```bash
git commit --only -- api/edit/map/peaks-geometry.php api/_internal/app/terrain-store.php api/_internal/app/__tests__/terrain-store-test.php api/edit/map/ecosystem.php -m "feat(landschaften): store one height raster per area, stamped server-side against peaks and knobs"
```

---

## Aufgabe 7: Der Knopf „Höhenraster rechnen"

**Dateien:**
- Ändern: `html/landschaften-editor.html` (eine Kachel im Menüband, drei Skript-Einbindungen,
  der Lauf, die Statuszeile der Kachel)

**Schnittstellen:**
- Verbraucht: `ecosystemHeightmapGrid`, `rasterizeEcosystemHeightField`,
  `ecosystemHeightmapToBase64` (Aufgabe 5); `buildEcosystemHeightStack` (vorhanden);
  `GET /api/edit/map/peaks-geometry.php` und die Aktionen `heightmap_*` (Aufgabe 6).
- Liefert: nichts für spätere Aufgaben — außer den gefüllten Rastern, die Aufgabe 8 liest.

⚠️ **Menüband-Regel:** die Kacheln des Landschaften-Editors sind **gleich breit** und tragen
alle dieselbe Form (`.avm-tile`, `<span class="t1">` Titel, `<span class="t2">` Status). Der
Status steht **in der Kachel**, nicht daneben (Hausregel).

- [ ] **Schritt 1: Die drei Skripte einbinden**

In `html/landschaften-editor.html`, direkt **nach**
`<script src="/js/map-features/map-features-ecosystem-geometry.js"></script>` (Zeile ~105):

```html
<!-- V11: das Höhenfeld und sein Raster. 🔴 Der Server kann dieses Feld nicht erzeugen (Spec §2) --
     `Math.pow` mit gebrochenem Exponenten je Zelle, und `noiseScale` hängt an einem ARGMAX, sodass
     ein anderes letztes Bit in EINER Zelle die Skalierung der ganzen Fläche verschiebt. Also
     rechnet der Browser einmal und lädt das Ergebnis hoch.
     Reihenfolge zwingend: -geometry.js (oben) liefert pointInGeometry / distanceToEcosystemEdge /
     ecosystemGeometryBounds, auf denen -height-field.js steht. -->
<script src="/js/map-features/map-features-ecosystem-height-field.js"></script>
<script src="/js/map-features/map-features-ecosystem-height-combine.js"></script>
<script src="/js/map-features/map-features-ecosystem-heightmap-raster.js"></script>
```

- [ ] **Schritt 2: Die Kachel ins Menüband**

Im `<div class="avm-ribbon">` **hinter** der `ecoRaycast`-Kachel:

```html
    <button type="button" class="avm-tile" id="ecoHeightmap" title="Rechnet je Gebirgsfläche ihr Höhenraster im Browser und speichert es — eine Anfrage je Fläche. Der Pixelwert ist die Höhe in Schritt."><span class="t1">Höhenraster rechnen</span><span class="t2" id="ecoHeightmapInfo">noch nicht gerechnet</span></button>
```

⚠️ Kein `data-i18n` — die vier vorhandenen Kacheln tragen es, aber die englische Tabelle
(`js/app/i18n-en.js`) wird in diesem Plan nicht gepflegt, und ein `data-i18n` ohne Eintrag
zeigt nichts. Der deutsche Literaltext ist die Vorgabe (AGENTS.md §8).

- [ ] **Schritt 3: Zustand, Laden und Lauf**

Bei den anderen Modul-Variablen (nach `let assignmentStamp = null;`, Zeile ~516) ergänzen:

```js
// ---- V11: Höhenraster ---------------------------------------------------------------------
const PEAKS_API = "/api/edit/map/peaks-geometry.php";
let allPeaks = null;             // null = in dieser Sitzung noch nicht geholt
let heightmapStatus = null;      // was der Server über die gespeicherten Raster sagt

async function loadPeaks() {
	const response = await fetch(PEAKS_API, { credentials: "same-origin", headers: { Accept: "application/json" } });
	const data = await response.json();
	if (!response.ok || data.ok !== true) {
		throw new Error((data.error && data.error.message) || "Gipfel konnten nicht geladen werden.");
	}
	return data.peaks || [];
}
```

Und den Lauf selbst, hinter `renderAssignmentTile()` (Zeile ~954):

```js
// 🔴 EINE ANFRAGE JE FLÄCHE (Spec §3.3). 78 Flächen wären 5,25 MB roh und 7,0 MB base64 -- über
// dem üblichen `post_max_size` von 8 MB. Je Fläche sind es höchstens 286 KB roh. Und ein Abbruch
// entwertet dann nicht den ganzen Bestand, sondern lässt die schon geschriebenen Flächen stehen.
async function runHeightmaps() {
	const tile = $("ecoHeightmap");
	const info = $("ecoHeightmapInfo");
	tile.disabled = true;
	const started = Date.now();
	try {
		setStatus("Flächen werden geladen …");
		if (allAreas === null) { allAreas = await loadAreas(); }
		if (allPeaks === null) {
			setStatus("Gipfel werden geladen …");
			allPeaks = await loadPeaks();
		}

		// Die Gebirgsflächen -- dieselbe Weiche wie in map-features-ecosystem-height-render.js.
		// 💣 Sie steht damit an drei Stellen (Karte, Editor, terrain-store.php). Das ist der Preis
		// dafür, dass die Karte kein Editor-Modul lädt; wer `huegelland` aufmacht, macht es dreimal.
		const gebirge = (allAreas || []).filter((area) =>
			area && area.kind === "topographie" && String(area.region_type || "") === "gebirge");
		if (gebirge.length === 0) {
			info.textContent = "keine Gebirgsfläche vorhanden";
			flashStatus("Es gibt keine Gebirgsfläche — nichts zu rastern.", "ok");
			return;
		}

		// 🔴 EIN Fenster über ALLE Gipfel ALLER Flächen, und die Zuteilung je kleinster enthaltender
		// Fläche -- genau der Stapel, den die Karte baut. Ein je Fläche gebautes Fenster wäre wertlos,
		// weil der Nachbargipfel dann nicht mitzählte.
		const stack = buildEcosystemHeightStack(gebirge, (allPeaks || []).map((peak) => ({
			publicId: peak.public_id, x: peak.x, y: peak.y, height: peak.height_schritt,
		})));

		await ecoPost("heightmap_cleanup", {});

		let written = 0;
		let skipped = 0;
		let bytes = 0;
		for (let index = 0; index < stack.fields.length; index++) {
			const field = stack.fields[index];
			const areaId = stack.areaIdsByField[index];
			const area = gebirge.find((candidate) => String(candidate.public_id) === areaId);
			if (!area || !area.bounds) { continue; }
			const label = (area.region_name || areaId);
			const grid = ecosystemHeightmapGrid(area.bounds, 0.25);
			// 💣 Der Fortschritt steht IM KNOPF, und der Haupt-Thread wird je Zeilenband freigegeben.
			// Hochgerechnet aus der V8-Messung (203.520 Rasterpunkte = 249 ms): 529.531 Pixel bei 15
			// Flächen, 1,4 Mio bei 40 -- ohne Freigabe sind das mehrere Sekunden eingefrorener Tab.
			const samples = await rasterizeEcosystemHeightField(field, stack.peakWindow, grid, {
				onRowBand: (done, total) => {
					info.textContent = "Raster " + (index + 1) + "/" + stack.fields.length
						+ " · " + label + " · " + done + "/" + total;
				},
			});
			const result = await ecoPost("heightmap_put", {
				area: areaId,
				cell_size: grid.cellSize,
				origin_x: grid.originX,
				origin_y: grid.originY,
				width: grid.width,
				height: grid.height,
				samples: ecosystemHeightmapToBase64(samples),
			});
			written += Number(result.written || 0);
			skipped += Number(result.skipped || 0);
			bytes += Number(result.stored_bytes || 0);
		}

		heightmapStatus = await ecoPost("heightmap_status", {});
		renderHeightmapTile();
		const seconds = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",");
		flashStatus(written + " Raster gespeichert (" + Math.round(bytes / 1024) + " KB) in " + seconds + " s"
			+ (skipped > 0 ? " · " + skipped + " Fläche(n) verschwunden" : ""), "ok");
	} catch (error) {
		info.textContent = "fehlgeschlagen";
		flashStatus("Höhenraster: " + (error && error.message ? error.message : String(error)), "error");
	} finally {
		tile.disabled = false;
	}
}

// Die Kachel IST die Zustandsanzeige. „veraltet" ist ein Vergleich, keine Vermutung: der Server
// rechnet beide Fingerabdrücke neu und stellt sie dem Stempel gegenüber.
//
// ⚠️ Die Gipfelzahl steht mit dabei, weil sie die Aussagekraft begrenzt: heute tragen 16 von 67
// Gipfeln eine Höhe, und ein Raster ohne Gipfelhöhen rechnet mit der Vorgabe 5.000, nicht mit
// erfassten Daten.
function renderHeightmapTile() {
	const info = $("ecoHeightmapInfo");
	if (!info || !heightmapStatus) { return; }
	const total = Number(heightmapStatus.area_count || 0);
	const missing = Number(heightmapStatus.missing || 0);
	const stale = Number(heightmapStatus.stale || 0);
	if (total === 0) { info.textContent = "keine Gebirgsfläche vorhanden"; return; }
	if (missing === total) { info.textContent = "noch nicht gerechnet · " + total + " Flächen"; return; }
	const parts = [(total - missing - stale) + "/" + total + " Raster"];
	if (stale > 0) { parts.push("**" + stale + " veraltet**".replace(/\*\*/g, "")); }
	if (missing > 0) { parts.push(missing + " fehlen"); }
	parts.push(heightmapStatus.peaks_with_height + "/" + heightmapStatus.peaks_total + " Gipfel mit Höhe");
	info.textContent = parts.join(" · ");
}
```

- [ ] **Schritt 4: Kachel verdrahten und beim Öffnen den Stand holen**

Bei den übrigen `addEventListener`-Zeilen (nach Zeile ~1408) ergänzen:

```js
	$("ecoHeightmap").addEventListener("click", () => { void runHeightmaps(); });
```

Und dort, wo `assignmentStamp = await ecoPost("assignment_status", {});` steht (Zeile ~1738),
direkt dahinter:

```js
		heightmapStatus = await ecoPost("heightmap_status", {});
		renderHeightmapTile();
```

- [ ] **Schritt 5: Der Editor darf nicht mehr laden als nötig — nachsehen**

```bash
grep -n "map-features-ecosystem-height" html/landschaften-editor.html
```
Erwartet: genau die drei Zeilen aus Schritt 1, **ohne** `?v=`.

```bash
grep -c "avm-tile\"" html/landschaften-editor.html
```
Erwartet: 3 (Raycast, Höhenraster, Landschaftsmodul) — `ecoSync` trägt `avm-tile--primary`.

- [ ] **Schritt 6: Am echten Editor prüfen**

💣 Ein `?edit=1` genügt hier nicht: der Landschaften-Editor ist ein Overlay-iframe im Hauptfenster
(`js/review/review-ecosystem-list.js`), und `ecoPost` läuft über `window.parent.postEcosystemEdit`.
Also im **eingeloggten** Editor öffnen: Editor → WikiSync → Regionen → „Regionen bearbeiten".

Zu prüfen, in dieser Reihenfolge:
1. Die Kachel steht da, gleich breit wie die Nachbarn, zweite Zeile „noch nicht gerechnet · N Flächen".
2. Klick: die zweite Zeile zählt sichtbar hoch („Raster 3/15 · Finsterkamm · 12/29"). Bleibt die
   Zeile stehen und der Tab hängt, fehlt die Freigabe des Haupt-Threads.
3. Nach dem Lauf: „15/15 Raster · 16/67 Gipfel mit Höhe" (oder die Zahlen aus Aufgabe 1).
4. Zweiter Klick: dasselbe Bild, keine Fehler (der Lauf ist idempotent — `ON DUPLICATE KEY UPDATE`).
5. Eine Gipfelhöhe im Label-Dialog ändern, Editor neu öffnen: die Kachel sagt **„15 veraltet"**.
   Sagt sie das nicht, greift der Gipfel-Fingerabdruck nicht.

- [ ] **Schritt 7: Commit**

```bash
git commit --only -- html/landschaften-editor.html -m "feat(landschaften): new editor tile computes and stores one height raster per mountain area"
```

---

## Aufgabe 8: Die Profil-Ableitung als gestückelte Owner-Aktion

💣 **Der Zwischenspeicher füllt sich NIE in einem Request.** Gemessen wäre das gewesen: der erste
Aufruf nach einem Rasterlauf hat 5.655 Fehlschläge, lädt alle Raster, tastet zehntausende Punkte
ab und schreibt 5.655 Zeilen — 1,7 bis 5,7 s bei 30 s Zeitlimit. Und ein Fehlschlag trifft nie
einen: **alle gleichzeitigen Besucher** starten dieselbe Füllung und halten je einen PHP-Worker.
Das ist die Form des Pool-Vorfalls vom 2026-07-17. V9 durfte die Stapellauf-Maschinerie streichen,
weil dort der **Browser** in 0,4 s rechnete — hier rechnet der Server, und die Begründung überträgt
sich nicht.

**Dateien:**
- Ändern: `api/_internal/app/terrain-store.php` (der Lauf)
- Ändern: `api/_internal/app/__tests__/terrain-store-test.php` (Profil-Tests anhängen)
- Ändern: `api/edit/map/ecosystem.php` (drei Aktionen)
- Ändern: `html/landschaften-editor.html` (eine Kachel, der schrittweise Lauf)

**Schnittstellen:**
- Verbraucht: `avesmapsHeightmapLoadAll`, `avesmapsHeightmapSampleSum`,
  `avesmapsHeightmapGlobalStamp` (Aufgabe 4); `AVESMAPS_TERRAIN_CELL_SIZE` (Aufgabe 2).
- Liefert: `avesmapsTerrainProfileForLine(array $rasters, array $coordinates): ?array` — **rein**,
  gibt `['ascent','descent','profile']` oder `null`.
- Liefert: Aktionen `terrain_profile_begin`, `terrain_profile_step`, `terrain_profile_status`.
- Liefert: `path_terrain`-Zeilen — Aufgabe 9a liest sie.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An `api/_internal/app/__tests__/terrain-store-test.php`, vor der abschließenden
`fwrite(STDOUT, ...)`-Zeile:

```php
// ---- the profile derivation -------------------------------------------------------------------
require_once __DIR__ . '/../heightmap.php';

// A 5x1 ramp along x at origin (0,0), cell 1,0 (coarser than the stock resolution, allowed):
//   0  1000  2000  1000  0     -- up then down, so ascent and descent are both non-zero.
$ramp = avesmapsHeightmapDecode([
    'origin_x' => '0.0000', 'origin_y' => '0.0000', 'cell_size_mapunits' => '1.0000',
    'width_px' => 5, 'height_px' => 1,
    'samples' => gzdeflate(pack('v*', 0, 1000, 2000, 1000, 0)), 'sample_bytes' => 10,
]);
$ramp['area_id'] = 1;
$ramp['min_x'] = 0.0; $ramp['min_y'] = 0.0; $ramp['max_x'] = 4.0; $ramp['max_y'] = 0.0;

// A way straight along the ridge: 0 -> 4 in x.
$profile = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [4.0, 0.0]]);
assert(is_array($profile), 'a way over a raster must produce a profile');
assert(abs($profile['ascent'] - 2000.0) < 1.0, 'climb 0 -> 2000 is 2000 Schritt, got ' . $profile['ascent']);
assert(abs($profile['descent'] - 2000.0) < 1.0, 'fall 2000 -> 0 is 2000 Schritt, got ' . $profile['descent']);
assert(count($profile['profile']) === 1, 'one segment gives one profile pair');

// Per SEGMENT, not per way: a way with three vertices gives three pairs, and their sum is the total.
$threeLegs = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [2.0, 0.0], [3.0, 0.0], [4.0, 0.0]]);
assert(count($threeLegs['profile']) === 3, 'three segments give three profile pairs');
$sumUp = array_sum(array_column($threeLegs['profile'], 0));
assert(abs($sumUp - $threeLegs['ascent']) < 1.0, 'the per-segment pairs must sum to the total ascent');
assert(abs($threeLegs['profile'][0][0] - 2000.0) < 1.0, 'the first leg carries the whole climb');
assert($threeLegs['profile'][0][1] < 1.0, 'the first leg falls nowhere');
assert($threeLegs['profile'][1][0] < 1.0, 'the second leg climbs nowhere');
assert(abs($threeLegs['profile'][1][1] - 1000.0) < 1.0, 'the second leg carries half the fall');

// 💣 A WAY OUTSIDE EVERY RASTER IS null, NOT ZERO. „No height data" and „measured and level" are
// different answers, and today 51 of 67 peaks carry no height at all.
assert(avesmapsTerrainProfileForLine([$ramp], [[900.0, 900.0], [901.0, 900.0]]) === null,
    'a way beyond every bbox has NO data -- it is not level ground');
assert(avesmapsTerrainProfileForLine([], [[0.0, 0.0], [4.0, 0.0]]) === null,
    'no raster at all is no data');

// A way that only PARTLY overlaps still answers, for the part it can measure.
$partly = avesmapsTerrainProfileForLine([$ramp], [[2.0, 0.0], [900.0, 0.0]]);
assert(is_array($partly), 'a way that touches a raster at all must answer');

// Degenerate input does not throw and does not divide.
assert(avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0]]) === null, 'a single point is not a line');
assert(avesmapsTerrainProfileForLine([$ramp], []) === null, 'an empty line is not a line');

// 💣 THE INTEGRATION RESOLUTION IS FIXED. The ascent over fractal ground is a TOTAL VARIATION: it
// grows with sampling density (x sqrt(2) per halving). Sampling a segment only at its endpoints
// would measure a fraction of the climb a finer walk sees -- and A* at 0,5 cells would then prefer
// cross-country EXACTLY in the mountains, out of a pure sampling artefact (§5.3).
$coarse = avesmapsTerrainProfileForLine([$ramp], [[0.0, 0.0], [4.0, 0.0]]);
assert($coarse['samples'] > 4, 'the walk must sample INSIDE a segment, not just its ends, got '
    . $coarse['samples']);

fwrite(STDOUT, "terrain-store-test: all asserts passed\n");
```

⚠️ Die vorhandene Schluss-Zeile `fwrite(STDOUT, "terrain-store-test: all asserts passed\n");`
steht danach nur **einmal** in der Datei — die alte wird durch diesen Block ersetzt, nicht
verdoppelt.

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: FEHLER — `Call to undefined function avesmapsTerrainProfileForLine()`.

- [ ] **Schritt 3: Den reinen Profil-Kern und den Lauf schreiben**

Ans Ende von `api/_internal/app/terrain-store.php` anhängen:

```php
// ---- the profile derivation --------------------------------------------------------------------

// Ways per step. With a 4 s wall-clock budget on top, whichever comes first. The whole run is a
// handful of requests, and each stays far inside a FastCGI limit.
const AVESMAPS_TERRAIN_PROFILE_BATCH = 400;
const AVESMAPS_TERRAIN_PROFILE_BUDGET_MS = 4000;

/**
 * PURE: walk a line over the summed rasters and add up climb and fall.
 *
 * 🔴 THE LINE IS THE CHORD, not the drawn Catmull-Rom curve. Everything that turns these numbers
 * into a time measures on the raw support points -- avesmapsCalculateClientRouteCoordinateDistance
 * sums plain hypot over the STORED vertices, and that is what the graph distance, the travel time
 * and the legs are made of. A curve length would be a different measure system for the same name.
 *
 * 🔴 SAMPLED EVERY AVESMAPS_TERRAIN_CELL_SIZE ALONG THE SEGMENT, never just at its ends. The ascent
 * is a total variation and grows with sampling density (§5.3); a fixed integration step is what
 * makes one row comparable with the next, and with A* later.
 *
 * ⚠️ This is more work than spec §5.4 estimated (it counted 72.278 points = two per segment; a
 * 0,25-step walk over 36.139 segments of mean length 1,436 is closer to 207.000). At a measured
 * 0,08 microseconds per punctual read that is ~17 ms of sampling for the whole stock -- and almost
 * every way skips it entirely, because its bbox touches no raster at all.
 *
 * Returns null when the line touches no raster anywhere: „no height data", NOT level ground.
 *
 * @return array{ascent:float,descent:float,profile:list<array{0:float,1:float}>,samples:int}|null
 */
function avesmapsTerrainProfileForLine(array $rasters, array $coordinates): ?array
{
    $count = count($coordinates);
    if ($count < 2 || $rasters === []) {
        return null;
    }

    $profile = [];
    $totalUp = 0.0;
    $totalDown = 0.0;
    $sampleCount = 0;
    $touched = false;

    for ($index = 0; $index < $count - 1; $index++) {
        $from = $coordinates[$index];
        $to = $coordinates[$index + 1];
        if (!is_array($from) || !is_array($to) || count($from) < 2 || count($to) < 2) {
            $profile[] = [0.0, 0.0];
            continue;
        }
        $fromX = (float) $from[0]; $fromY = (float) $from[1];
        $toX = (float) $to[0]; $toY = (float) $to[1];
        $length = hypot($toX - $fromX, $toY - $fromY);
        // At least the two ends; otherwise one sample per cell along the segment.
        $steps = max(1, (int) ceil($length / AVESMAPS_TERRAIN_CELL_SIZE));

        $up = 0.0;
        $down = 0.0;
        $previous = null;
        for ($step = 0; $step <= $steps; $step++) {
            $t = $steps > 0 ? $step / $steps : 0.0;
            // 💣 THE READER SUMS over every raster covering the point (§5.0). Each raster holds only
            // its area's OWN field; reading „the one that contains the point" gives a height that is
            // too low in every overlap strip, and shows nothing unusual doing it.
            $height = avesmapsHeightmapSampleSum($rasters, $fromX + ($toX - $fromX) * $t, $fromY + ($toY - $fromY) * $t);
            $sampleCount++;
            if ($height === null) {
                // A gap in coverage breaks the chain rather than inventing a step down to nothing.
                $previous = null;
                continue;
            }
            $touched = true;
            if ($previous !== null) {
                $delta = $height - $previous;
                if ($delta > 0.0) { $up += $delta; } else { $down -= $delta; }
            }
            $previous = $height;
        }
        $profile[] = [round($up, 2), round($down, 2)];
        $totalUp += $up;
        $totalDown += $down;
    }

    if (!$touched) {
        return null;
    }

    return [
        'ascent' => round($totalUp, 2),
        'descent' => round($totalDown, 2),
        'profile' => $profile,
        'samples' => $sampleCount,
    ];
}

/** Start a profile run: a token, a cursor at zero, the raster stamp this run describes. */
function avesmapsTerrainProfileBegin(PDO $pdo, int $userId): array
{
    $runToken = avesmapsUuidV4();
    $stamp = avesmapsHeightmapGlobalStamp($pdo);

    // Orphans first: a path_terrain row whose way is gone would otherwise be dragged along forever.
    $pdo->exec(
        'DELETE t FROM path_terrain t
           LEFT JOIN map_features f ON f.id = t.path_id AND f.is_active = 1 AND f.feature_type = \'path\'
          WHERE f.id IS NULL'
    );

    // 🔴 The rows are NOT cleared. Unlike V9's run, every row here carries its OWN validity
    // (path_revision + heightmap_stamp), so a half-finished run leaves a usable mixture rather than
    // a hole -- and an interrupted run can simply be continued.
    $statement = $pdo->prepare(
        'INSERT INTO path_terrain_stamp
             (id, run_token, heightmap_stamp, cursor_path_id, ways_seen, ways_with_profile, duration_ms, completed, computed_by)
         VALUES (1, :token, :stamp, 0, 0, 0, 0, 0, :user)
         ON DUPLICATE KEY UPDATE run_token = VALUES(run_token), heightmap_stamp = VALUES(heightmap_stamp),
             cursor_path_id = 0, ways_seen = 0, ways_with_profile = 0, duration_ms = 0, completed = 0,
             computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['token' => $runToken, 'stamp' => $stamp, 'user' => $userId > 0 ? $userId : null]);

    $total = (int) $pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'path' AND is_active = 1")->fetchColumn();

    return ['run_token' => $runToken, 'heightmap_stamp' => $stamp, 'ways_total' => $total];
}

/**
 * One step of the run: up to AVESMAPS_TERRAIN_PROFILE_BATCH ways past the cursor, or 4 s, whichever
 * comes first.
 *
 * 💣 A CURSOR, NOT AN OFFSET. `LIMIT ... OFFSET` re-reads everything before it on every step; over a
 * whole run that is quadratic. The cursor is the last id written.
 *
 * 💣 The token is what a GET_LOCK cannot do here: a connection-scoped lock dies with its request and
 * a run spans many. Two editors running at once would otherwise interleave their steps. The second
 * `begin` wins the token and the first one's next step gets a clean 409.
 */
function avesmapsTerrainProfileStep(PDO $pdo, array $payload): array
{
    $offered = trim((string) ($payload['run_token'] ?? ''));
    $row = $pdo->query('SELECT run_token, heightmap_stamp, cursor_path_id, ways_seen, ways_with_profile, duration_ms FROM path_terrain_stamp WHERE id = 1')
        ->fetch(PDO::FETCH_ASSOC);
    if ($row === false || !avesmapsPathEcosystemTokenMatches($row['run_token'] ?? null, $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another terrain profile run has started. Start over.');
    }

    // Loaded ONCE per step, not per way. At 15 areas that is ~1 MB of blob and stays a string.
    $rasters = avesmapsHeightmapLoadAll($pdo);
    $stamp = (string) $row['heightmap_stamp'];
    $cursor = (int) $row['cursor_path_id'];
    $startedMs = (int) (microtime(true) * 1000);

    $statement = $pdo->prepare(
        "SELECT id, revision, geometry_json, min_x, min_y, max_x, max_y
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND id > :cursor
          ORDER BY id LIMIT " . AVESMAPS_TERRAIN_PROFILE_BATCH
    );
    $statement->execute(['cursor' => $cursor]);
    $ways = $statement->fetchAll(PDO::FETCH_ASSOC);

    $insert = $pdo->prepare(
        'INSERT INTO path_terrain (path_id, ascent_schritt, descent_schritt, profile_json, path_revision, heightmap_stamp)
         VALUES (:path, :ascent, :descent, :profile, :rev, :stamp)
         ON DUPLICATE KEY UPDATE ascent_schritt = VALUES(ascent_schritt), descent_schritt = VALUES(descent_schritt),
             profile_json = VALUES(profile_json), path_revision = VALUES(path_revision),
             heightmap_stamp = VALUES(heightmap_stamp), computed_at = CURRENT_TIMESTAMP(3)'
    );

    $seen = 0;
    $withProfile = 0;
    foreach ($ways as $way) {
        $cursor = (int) $way['id'];
        $seen++;
        // The cheap pre-filter: does this way's bbox touch ANY raster? Most ways touch none, and
        // then there is nothing to walk.
        $touchesRaster = false;
        foreach ($rasters as $raster) {
            if (!((float) $way['max_x'] < $raster['min_x'] || $raster['max_x'] < (float) $way['min_x']
                || (float) $way['max_y'] < $raster['min_y'] || $raster['max_y'] < (float) $way['min_y'])) {
                $touchesRaster = true;
                break;
            }
        }
        $profile = null;
        if ($touchesRaster) {
            $geometry = json_decode((string) $way['geometry_json'], true);
            $coordinates = is_array($geometry) && ($geometry['type'] ?? '') === 'LineString'
                && is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
            $profile = avesmapsTerrainProfileForLine($rasters, $coordinates);
        }
        // 💣 NULL, NEVER 0. „No height data" and „measured and level" are two different statements,
        // and with 51 of 67 peaks carrying no height the first one is the common case.
        $insert->execute([
            'path' => (int) $way['id'],
            'ascent' => $profile === null ? null : (int) round($profile['ascent']),
            'descent' => $profile === null ? null : (int) round($profile['descent']),
            'profile' => $profile === null ? null : json_encode($profile['profile']),
            // 🔴 The way's OWN revision, NOT map_revision. map_revision is a global counter bumped by
            // settlement, label, source and sync writes -- and peaks are `berggipfel` LABELS in
            // map_features, so entering one peak height would invalidate all 5.655 rows in one go.
            'rev' => (int) $way['revision'],
            'stamp' => $stamp,
        ]);
        if ($profile !== null) {
            $withProfile++;
        }
        if ((int) (microtime(true) * 1000) - $startedMs > AVESMAPS_TERRAIN_PROFILE_BUDGET_MS) {
            break;
        }
    }

    $done = count($ways) < AVESMAPS_TERRAIN_PROFILE_BATCH && $seen === count($ways);
    $update = $pdo->prepare(
        'UPDATE path_terrain_stamp
            SET cursor_path_id = :cursor, ways_seen = ways_seen + :seen,
                ways_with_profile = ways_with_profile + :hit,
                duration_ms = duration_ms + :ms, completed = :done,
                computed_at = CURRENT_TIMESTAMP(3)
          WHERE id = 1'
    );
    $elapsed = (int) (microtime(true) * 1000) - $startedMs;
    $update->execute([
        'cursor' => $cursor, 'seen' => $seen, 'hit' => $withProfile,
        'ms' => max(0, $elapsed), 'done' => $done ? 1 : 0,
    ]);

    return [
        'done' => $done,
        'cursor' => $cursor,
        'seen' => $seen,
        'with_profile' => $withProfile,
        'elapsed_ms' => max(0, $elapsed),
    ];
}

/** The stamp plus the CURRENT raster stamp, so the tile can say „veraltet" without a second request. */
function avesmapsTerrainProfileStatus(PDO $pdo): array
{
    $row = $pdo->query('SELECT * FROM path_terrain_stamp WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    $rows = (int) $pdo->query('SELECT COUNT(*) FROM path_terrain')->fetchColumn();
    // The HARD COUNTER of §9.2 step 2: how many ways actually carry a profile. Without it a green
    // „switch off is bit-identical" says nothing -- it is also green when every lookup missed.
    $withProfile = (int) $pdo->query('SELECT COUNT(*) FROM path_terrain WHERE ascent_schritt IS NOT NULL')->fetchColumn();

    return [
        'stamp' => $row === false ? null : [
            'heightmap_stamp' => (string) $row['heightmap_stamp'],
            'cursor_path_id' => (int) $row['cursor_path_id'],
            'ways_seen' => (int) $row['ways_seen'],
            'ways_with_profile' => (int) $row['ways_with_profile'],
            'duration_ms' => (int) $row['duration_ms'],
            'completed' => (int) $row['completed'] === 1,
            'computed_at' => (string) $row['computed_at'],
        ],
        'rows' => $rows,
        'rows_with_profile' => $withProfile,
        'current_heightmap_stamp' => avesmapsHeightmapGlobalStamp($pdo),
    ];
}
```

⚠️ `avesmapsPathEcosystemTokenMatches` und `avesmapsUuidV4` kommen aus `path-ecosystem.php` bzw.
`features.php`, die der Dispatcher schon lädt. `terrain-store.php` **darf sie nicht selbst
requiren** — das zöge `ecosystem.php` in den Include-Baum und damit dessen DDL in die Nähe des
Routing-Pfads. Statt dessen oben in `terrain-store.php` ein Hinweis:

```php
// ⚠️ avesmapsUuidV4 (features.php) and avesmapsPathEcosystemTokenMatches (path-ecosystem.php) are
// NOT required here on purpose: the dispatcher api/edit/map/ecosystem.php loads both before this
// file, and requiring them would drag ecosystem.php's DDL into this include tree. The routing path
// includes heightmap.php, never this file.
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/terrain-store-test.php
```
Erwartet: `terrain-store-test: all asserts passed`, Exit 0.

⚠️ Der Test lädt `terrain-store.php` ohne den Dispatcher, ruft aber nur die **reinen** Funktionen
auf. Bricht er mit `undefined function avesmapsUuidV4`, wird versehentlich eine DB-Funktion
aufgerufen — dann gehört sie nicht in den Testpfad.

- [ ] **Schritt 5: Die drei Aktionen anmelden**

In `api/edit/map/ecosystem.php`, im `match($action)` hinter `'heightmap_status'`:

```php
        // V11: the way profiles. 💣 The cache NEVER fills itself inside a request -- 5.655 misses
        // after a raster run, every concurrent visitor starting the same fill, each holding a PHP
        // worker. That is the shape of the pool incident of 2026-07-17. It is an owner-triggered,
        // chunked run with a token, a budget and a cursor, exactly like V9's and the dump phases.
        'terrain_profile_begin' => avesmapsTerrainProfileBegin($pdo, $userId),
        'terrain_profile_step' => avesmapsTerrainProfileStep($pdo, $payload),
        'terrain_profile_status' => avesmapsTerrainProfileStatus($pdo),
```

- [ ] **Schritt 6: Die Kachel im Editor**

In `html/landschaften-editor.html`, hinter der `ecoHeightmap`-Kachel:

```html
    <button type="button" class="avm-tile" id="ecoProfiles" title="Leitet aus den gespeicherten Höhenrastern je Weg Anstieg und Gefälle ab. Läuft in Stücken auf dem Server; nichts davon wird beim Routen nachgerechnet."><span class="t1">Wegprofile rechnen</span><span class="t2" id="ecoProfilesInfo">noch nicht gerechnet</span></button>
```

Und der Lauf, hinter `renderHeightmapTile()`:

```js
// 🔴 Gestückelt, mit Lauf-Token, Budget und Cursor. Der Browser ruft nur wiederholt auf; gerechnet
// wird auf dem Server, und jeder Schritt bleibt weit unter jedem FastCGI-Limit.
async function runTerrainProfiles() {
	const tile = $("ecoProfiles");
	const info = $("ecoProfilesInfo");
	tile.disabled = true;
	const started = Date.now();
	try {
		const begun = await ecoPost("terrain_profile_begin", {});
		const runToken = String(begun.run_token || "");
		if (runToken === "") { throw new Error("Der Server hat kein Lauf-Kennzeichen geliefert."); }
		const total = Number(begun.ways_total || 0);

		let seen = 0;
		let withProfile = 0;
		// Ein Riegel gegen eine Endlosschleife, falls der Cursor je stehen bliebe: bei 400 Wegen je
		// Schritt sind 5.655 Wege 15 Schritte, 200 sind Faktor 13 Luft.
		for (let step = 0; step < 200; step++) {
			const result = await ecoPost("terrain_profile_step", { run_token: runToken });
			seen += Number(result.seen || 0);
			withProfile += Number(result.with_profile || 0);
			info.textContent = "Wege " + seen + "/" + total + " · " + withProfile + " mit Profil";
			if (result.done === true || Number(result.seen || 0) === 0) { break; }
		}

		terrainProfileStatus = await ecoPost("terrain_profile_status", {});
		renderProfileTile();
		const seconds = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",");
		flashStatus(withProfile + " von " + seen + " Wegen tragen ein Profil · " + seconds + " s", "ok");
	} catch (error) {
		info.textContent = "fehlgeschlagen";
		flashStatus("Wegprofile: " + (error && error.message ? error.message : String(error)), "error");
	} finally {
		tile.disabled = false;
	}
}

// ⚠️ „0 Wege mit Profil" ist die Zahl, auf die es ankommt (Abnahmeschritt 2). Steht sie auf 0,
// obwohl Raster da sind, verfehlt die Suche die Wege -- und das sähe sonst aus wie ein Kurvenproblem.
function renderProfileTile() {
	const info = $("ecoProfilesInfo");
	if (!info || !terrainProfileStatus) { return; }
	const stamp = terrainProfileStatus.stamp;
	if (!stamp || stamp.ways_seen === 0) { info.textContent = "noch nicht gerechnet"; return; }
	if (!stamp.completed) {
		info.textContent = "unvollständig bei Weg " + stamp.cursor_path_id + " — bitte neu rechnen";
		return;
	}
	const stale = stamp.heightmap_stamp !== terrainProfileStatus.current_heightmap_stamp;
	const base = terrainProfileStatus.rows_with_profile + " von " + terrainProfileStatus.rows + " Wegen mit Profil · "
		+ (stamp.duration_ms / 1000).toFixed(1).replace(".", ",") + " s";
	info.textContent = stale ? base + " · Raster seither geändert" : base;
}
```

Bei den Modul-Variablen ergänzen: `let terrainProfileStatus = null;`
Bei den `addEventListener`-Zeilen: `$("ecoProfiles").addEventListener("click", () => { void runTerrainProfiles(); });`
Beim Öffnen, neben `heightmapStatus`: `terrainProfileStatus = await ecoPost("terrain_profile_status", {}); renderProfileTile();`

- [ ] **Schritt 7: Syntax prüfen**

```bash
php -l api/_internal/app/terrain-store.php && php -l api/edit/map/ecosystem.php
```
Erwartet: zweimal `No syntax errors detected`.

- [ ] **Schritt 8: Am echten Editor prüfen**

Editor → WikiSync → Regionen → „Regionen bearbeiten" (eingeloggt).

1. Erst „Höhenraster rechnen", dann „Wegprofile rechnen".
2. Die zweite Zeile zählt in Sprüngen hoch („Wege 1.200/5.655 · 43 mit Profil").
3. **Der harte Zähler am Ende muss > 0 sein.** Steht er auf 0, obwohl Raster existieren, ist der
   bbox-Vorfilter oder die Summenregel falsch — und **erst das** ist zu klären, nicht die Kurve.
4. Ein zweiter Lauf ergibt dieselben Zahlen (idempotent).
5. Eine Gipfelhöhe ändern → „Höhenraster rechnen" → die Profil-Kachel sagt
   „Raster seither geändert".

- [ ] **Schritt 9: Commit**

```bash
git commit --only -- api/_internal/app/terrain-store.php api/_internal/app/__tests__/terrain-store-test.php api/edit/map/ecosystem.php html/landschaften-editor.html -m "feat(landschaften): derive ascent and descent per way as a chunked, owner-triggered run"
```

---

## Aufgabe 9a: Routing-Verkabelung — und der harte Zähler

🔴 **In dieser Aufgabe wird der Faktor noch NICHT angewandt.** Sie stellt nur die Leitung her und
beweist mit einer Zahl, dass sie trägt. Das ist mit Absicht ein eigener Prüfpunkt: Abnahmeschritt 1
(„Schalter aus = bit-identisch") ist auch dann grün, wenn der Verbundschlüssel jede einzelne Zeile
verfehlt — und Abnahmeschritt 3 sähe dann aus wie ein Kurvenproblem.

💣 **Der Verbundschlüssel existiert in der Routing-Nutzlast NICHT.**
`avesmapsFetchRouteMapFeatures` (`map-data.php:29-44`) selektiert `public_id`, `revision`,
Geometrie — **nie die interne `id`** —, und `avesmapsBuildRoutePathData` (`network-data.php:152`)
setzt `'id' => public_id`. Ein naheliegendes `$terrain[$path['id']]` übersetzt, läuft und verfehlt
jede Zeile. Das Ergebnis ist Faktor 1,0 überall — **genau der Wert, der auch „Schalter aus" und
„hier ist es flach" bedeutet**. Dieselbe Fehlerklasse hat V10 am 2026-07-29 live einen Totalausfall
gekostet.

💣 **Und `revision` reist NICHT mit, anders als die Spec sagt.** `map-data.php:61` legt sie in
`properties.revision`, aber `avesmapsBuildRoutePathData` gibt sie nicht weiter. Ohne den Durchstich
ist `path_revision` ein toter Vergleich.

**Dateien:**
- Ändern: `api/_internal/routing/map-data.php` (PDO zurückgeben)
- Ändern: `api/_internal/routing/network-data.php` (`revision` durchreichen)
- Erstellen: `api/_internal/routing/terrain-read.php` (der vorverbundene Lesezugriff)
- Ändern: `api/_internal/routing/response.php` (laden, `debug`-Felder)
- Erstellen: `api/_internal/routing/__tests__/terrain-read-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsAppSettingGetWithoutDdl` — **wird in Aufgabe 10 gebaut**; bis dahin liest
  9a den Schalter über eine lokale, gleich geformte Funktion und Aufgabe 10 ersetzt sie. ⚠️ Nicht
  vergessen: Aufgabe 10 Schritt 3 löscht sie wieder.
- Liefert: `avesmapsRouteLoadTerrain(PDO $pdo): array` — `public_id` → `['ascent','descent','profile','revision']`.
- Liefert: `avesmapsRouteTerrainEnabled(PDO $pdo): bool`.
- Liefert: `debug_context.terrain` mit `enabled`, `profile_rows`, `matched_ways`, `stale`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
// api/_internal/routing/__tests__/terrain-read-test.php
declare(strict_types=1);

/**
 * Unit tests for the V11 terrain lookup on the routing path
 * (api/_internal/routing/terrain-read.php).
 *
 * The DB half is not exercised here; what is tested is the PURE matching rule -- the one that made
 * V10 fail live on the same day: a field called `id` that is not the `id`.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../request.php';
require __DIR__ . '/../client-graph.php';
require __DIR__ . '/../terrain-read.php';
require __DIR__ . '/../map-data.php';
require __DIR__ . '/../network-data.php';

// --- 💣 THE KEY IS public_id, AND `id` IS NOT THE id ---------------------------------------------
// avesmapsBuildRoutePathData sets 'id' => public_id. A lookup by $path['id'] would translate, run,
// and miss every row -- landing on factor 1,0, the value that also means „switch off".
$feature = [
    'id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0]]],
    'properties' => [
        'public_id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'feature_type' => 'path', 'feature_subtype' => 'Strasse', 'name' => 'Strasse',
        'geometry_type' => 'LineString', 'properties' => [], 'style' => [],
        'revision' => 42, 'updated_at' => '',
    ],
];
$pathData = avesmapsBuildRoutePathData($feature, 'path-1');

// 💣 THE ONE THAT WAS MISSING: the way's own revision must survive the trip into the graph payload.
// map-data.php puts it in properties.revision; before this task avesmapsBuildRoutePathData dropped
// it, so path_revision would have been a dead comparison.
assert(array_key_exists('revision', $pathData),
    'avesmapsBuildRoutePathData must carry the way OWN revision -- path_revision compares against it');
assert($pathData['revision'] === 42, 'the revision must arrive unchanged, got ' . var_export($pathData['revision'] ?? null, true));

// --- the attachment rule -----------------------------------------------------------------------
$terrain = [
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => [
        'ascent' => 1200.0, 'descent' => 300.0, 'profile' => [[1200.0, 300.0]], 'revision' => 42,
    ],
];
$attached = avesmapsRouteAttachTerrain($pathData, $terrain);
assert($attached !== null, 'a way with a matching, current profile must get its terrain');
assert($attached['ascent'] === 1200.0, 'the ascent must arrive');

// A stale path_revision means the stored profile describes a DIFFERENT geometry -- local, specific,
// and self-healing: it is dropped, and the way falls back to factor 1,0.
$stale = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => ['ascent' => 1.0, 'descent' => 0.0, 'profile' => [[1.0, 0.0]], 'revision' => 41]];
assert(avesmapsRouteAttachTerrain($pathData, $stale) === null,
    'a profile computed against another revision of THIS way must not be used');

// An unknown way is null, not zero.
assert(avesmapsRouteAttachTerrain($pathData, []) === null, 'no row means no data, not level ground');

// A row that carries null ascent (measured: no height data here) stays null, and stays
// distinguishable from „not stored".
$noData = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' => ['ascent' => null, 'descent' => null, 'profile' => null, 'revision' => 42]];
assert(avesmapsRouteAttachTerrain($pathData, $noData) === null,
    'a stored row with no height data behaves like no data');

// --- 💣 CHECKED BY SEARCH: nothing on the routing path may key terrain by $path['id'] ------------
foreach (['terrain-read.php', 'client-graph.php', 'response.php'] as $file) {
    $source = (string) file_get_contents(__DIR__ . '/../' . $file);
    assert(!preg_match('/\\$terrain\\s*\\[\\s*\\$path\\s*\\[\\s*.id.\\s*\\]/', $source),
        $file . " must not key terrain by \$path['id'] -- that field IS the public_id, and the lookup "
        . 'would miss every row while looking perfectly fine');
}

fwrite(STDOUT, "terrain-read-test: all asserts passed\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
```
Erwartet: FEHLER — `Failed opening required '.../terrain-read.php'`.

- [ ] **Schritt 3: `revision` durchreichen**

In `api/_internal/routing/network-data.php`, in `avesmapsBuildRoutePathData`, hinter
`'public_id' => ...`:

```php
		// 🔴 V11: the way's OWN revision, threaded through on purpose. map-data.php puts it in
		// properties.revision, and this builder used to drop it -- so path_terrain.path_revision
		// would have compared against nothing. It is the way's own counter, NOT the global
		// map_revision: that one is bumped by settlement, label, source and sync writes too, and
		// peaks are `berggipfel` LABELS in map_features, so one peak height would have invalidated
		// every way at once.
		'revision' => (int) ($properties['revision'] ?? 0),
```

- [ ] **Schritt 4: Das PDO zurückgeben**

In `api/_internal/routing/map-data.php`:

```php
function avesmapsLoadRouteMapData(array $config): array {
	$pdo = avesmapsCreatePdo($config['database'] ?? []);
	$revision = avesmapsFetchRouteMapRevision($pdo);
	$features = avesmapsFetchRouteMapFeatures($pdo);

	return [
		'features' => $features,
		'revision' => $revision,
		'feature_count' => count($features),
		// ⚠️ V11: handed back rather than opened a second time. The terrain switch and path_terrain
		// read naively would be two to three connections per route, on hosting with
		// max_user_connections. Returning it is one line; a new key breaks no existing caller.
		'pdo' => $pdo,
	];
}
```

- [ ] **Schritt 5: `terrain-read.php` schreiben**

```php
<?php

declare(strict_types=1);

// V11: what the ROUTING path knows about terrain. Spec §5.5, §7.1.
//
// PURITY CONTRACT: side-effect-free on include. The matching rule is pure and unit-tested; the two
// DB reads take a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE, NO RASTER. This runs on every route a visitor plans. The
// rasters are read ONLY by the owner-triggered profile run (api/_internal/app/terrain-store.php);
// loading them here is exactly what path_terrain exists to prevent.
//
// 💣 AND IT NEVER FILLS THE CACHE. A missing row answers „no data" and the leg keeps today's time.
// Recomputing on demand would mean 5.655 misses on the first request after a raster run, with every
// concurrent visitor starting the same fill and holding a PHP worker -- the shape of the pool
// incident of 2026-07-17.

const AVESMAPS_TERRAIN_SETTING = 'terrain_travel_enabled';

/**
 * The switch, read WITHOUT the self-healing DDL.
 *
 * 💣 `avesmapsAppSettingGet` would be the obvious call and it is the wrong one HERE: it runs
 * `CREATE TABLE IF NOT EXISTS app_setting` on every single call, and a DDL statement in front of a
 * public read is precisely the hotspot AGENTS.md §10 lists for territories-endpoint.php. The shape
 * is copied from avesmapsPathLandscapesEcosystemEnabled (V10) -- and task 10 of this plan folds
 * both into ONE implementation.
 *
 * A missing table means OFF, not „create it and look again": if it does not exist, nobody ever
 * switched anything on.
 */
function avesmapsRouteTerrainEnabled(PDO $pdo): bool
{
    try {
        $statement = $pdo->prepare('SELECT setting_value FROM app_setting WHERE setting_key = :k LIMIT 1');
        $statement->execute(['k' => AVESMAPS_TERRAIN_SETTING]);
        $value = $statement->fetchColumn();
    } catch (PDOException) {
        return false;
    }

    // 🔴 DEFAULT OFF. The ecosystem convention, not the citymaps one: an unfinished layer must not
    // change published travel times because somebody deployed it.
    return $value !== false && (string) $value !== '0';
}

/**
 * Every stored way profile, keyed by public_id.
 *
 * 💣 PRE-JOINED. path_terrain.path_id is map_features.id, the INTERNAL key -- and the routing
 * payload does not carry it: avesmapsFetchRouteMapFeatures selects public_id and never the id, and
 * avesmapsBuildRoutePathData sets 'id' => public_id. Keying by that field would translate, run and
 * miss every single row, landing on factor 1,0 -- the value that also means „switch off" and „it is
 * flat here". THE SAME ERROR CLASS COST V10 A LIVE OUTAGE ON 2026-07-29.
 *
 * 💣 A MISSING TABLE IS NOT AN ERROR. On a database where the profile run has never happened the
 * table does not exist, and PDO is in ERRMODE_EXCEPTION -- the plain read would throw and the route
 * endpoint would answer 500 for a state that is perfectly normal.
 */
function avesmapsRouteLoadTerrain(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            'SELECT f.public_id, t.ascent_schritt, t.descent_schritt, t.profile_json,
                    t.path_revision, t.heightmap_stamp
               FROM path_terrain t
               JOIN map_features f ON f.id = t.path_id
              WHERE f.is_active = 1'
        );
    } catch (PDOException) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $terrain = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ascent = $row['ascent_schritt'];
        $profile = $row['profile_json'] === null ? null : json_decode((string) $row['profile_json'], true);
        $terrain[(string) $row['public_id']] = [
            // 💣 null stays null. „No height data" and „measured and level" are two different
            // statements -- today 51 of 67 peaks carry no height at all, and folding them into 0
            // would make every one of those ways read as measured flat ground.
            'ascent' => $ascent === null ? null : (float) $ascent,
            'descent' => $row['descent_schritt'] === null ? null : (float) $row['descent_schritt'],
            'profile' => is_array($profile) ? $profile : null,
            'revision' => (int) $row['path_revision'],
            'stamp' => (string) $row['heightmap_stamp'],
        ];
    }

    return $terrain;
}

/**
 * PURE: the terrain entry for ONE path of the routing payload, or null.
 *
 * Two different kinds of staleness, answered differently and on purpose:
 *
 *  - `path_revision` mismatch -> DROPPED. The stored profile describes a different geometry of THIS
 *    way. That is local, specific and self-healing: the way falls back to factor 1,0 and the next
 *    profile run repairs it.
 *  - `heightmap_stamp` mismatch -> STILL USED, and reported in `debug` (spec §9.1: „als veraltet
 *    gemeldet, Antwort trotzdem geliefert"). It is GLOBAL: refusing it would turn one raster edit
 *    into a map-wide flattening, and the stamp exists to be readable, not to be a trigger.
 */
function avesmapsRouteAttachTerrain(array $path, array $terrain): ?array
{
    // 🔴 public_id, explicitly -- NOT $path['id'].
    $publicId = (string) ($path['public_id'] ?? '');
    if ($publicId === '' || !isset($terrain[$publicId])) {
        return null;
    }
    $entry = $terrain[$publicId];
    if ($entry['ascent'] === null || $entry['descent'] === null) {
        return null;
    }
    if ((int) $entry['revision'] !== (int) ($path['revision'] ?? -1)) {
        return null;
    }

    return $entry;
}

/** How many of the payload's ways actually matched -- the hard counter of spec §9.2 step 2. */
function avesmapsRouteCountTerrainMatches(array $paths, array $terrain): int
{
    $matched = 0;
    foreach ($paths as $path) {
        if (is_array($path) && avesmapsRouteAttachTerrain($path, $terrain) !== null) {
            $matched++;
        }
    }

    return $matched;
}
```

- [ ] **Schritt 6: In `response.php` laden und in `debug` ausweisen**

In `api/_internal/routing/response.php`: oben neben `require_once __DIR__ . '/client-graph.php';`

```php
require_once __DIR__ . '/terrain-read.php';
```

In `avesmapsBuildMinimalRouteResultFromRequest`, nach
`$routeNetworkData = avesmapsBuildRouteNetworkData($routeMapData);`:

```php
	// V11. The PDO comes back from avesmapsLoadRouteMapData rather than being opened again -- the
	// switch and path_terrain read naively would be two to three connections per route.
	$routePdo = $routeMapData['pdo'] ?? null;
	// 🔴 The API switch may only turn terrain OFF, never on (§8.3): the editor switch is an
	// emergency stop, and a stranger must not be able to switch on what the owner switched off.
	$terrainRequested = ($request['terrain'] ?? true) !== false;
	$terrainEnabled = $routePdo instanceof PDO && $terrainRequested && avesmapsRouteTerrainEnabled($routePdo);
	$terrain = $terrainEnabled ? avesmapsRouteLoadTerrain($routePdo) : [];
	$terrainMatched = avesmapsRouteCountTerrainMatches($routeNetworkData['paths'] ?? [], $terrain);
```

Dann in `debug_context` (im `return`-Block) ergänzen:

```php
				// 🔴 THE HARD COUNTER. „cost is unchanged with the switch off" is ALSO green when the
				// lookup missed every row -- and then a wrong picture later looks like a curve
				// problem instead of a join problem. `matched_ways` must be > 0 once profiles exist.
				// `1.0` otherwise means three different things at once: terrain is off, it is flat
				// here, or nothing is known here. `enabled` separates the first, `ascent_schritt:
				// null` per segment separates the third from the second.
				'terrain' => [
					'enabled' => $terrainEnabled,
					'requested' => $terrainRequested,
					'profile_rows' => count($terrain),
					'matched_ways' => $terrainMatched,
				],
```

⚠️ `$terrain` wird in dieser Aufgabe **noch nicht** an
`avesmapsBuildClientCompatibleRouteGraph` weitergereicht. Das ist Aufgabe 9b. Bis dahin ändert
sich an keiner einzigen Zahl etwas — genau das ist der Prüfpunkt.

- [ ] **Schritt 7: Den Anfrage-Schalter aufnehmen**

In `api/_internal/routing/request.php`, in `avesmapsNormalizeRouteRequest`:

```php
	// V11 §8.3: this may only switch terrain OFF. Default true means „follow the global switch".
	$terrain = avesmapsRouteNormalizeBoolean($payload['terrain'] ?? true, 'terrain');
```
und im `return`-Block `'terrain' => $terrain,`.

- [ ] **Schritt 8: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
```
Erwartet: `terrain-read-test: all asserts passed`.

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/transport-restriction-test.php
```
Erwartet: **unverändert grün.** Bricht er, hat der Durchstich das Graph-Verhalten angefasst — und
das darf er in 9a nicht.

- [ ] **Schritt 9: Am Livebestand messen — Abnahmeschritt 1 und 2, zum ersten Mal**

💣 Eine Sonde je Zeile, keine Schleife.

Vorher `cost` festhalten (der Zustand VOR dem Deploy — die Zahl aus dem Live-System):

```bash
curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).route;console.log('cost',r.cost,'segments',r.segments.length);})"
```

Nach Push und Deploy (~1–2 min) dieselbe Anfrage, plus der Zähler:

```bash
curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).route;console.log('cost',r.cost,'terrain',JSON.stringify(r.debug.context.terrain));})"
```

Erwartet:
1. **`cost` bit-identisch** mit der Zahl von vorher. Das ist der wichtigste Test des ganzen Plans.
2. `terrain.enabled` = `false` (der Schalter steht auf AUS und wird in Aufgabe 10 erst angelegt).
3. `terrain.profile_rows` und `matched_ways` sind hier noch `0`, weil bei ausgeschaltetem Schalter
   gar nicht geladen wird. **Der scharfe Zähler kommt in Aufgabe 10 Schritt 6**, sobald der
   Schalter existiert und einmal auf AN gestellt werden kann.

- [ ] **Schritt 10: Commit**

```bash
git commit --only -- api/_internal/routing/map-data.php api/_internal/routing/network-data.php api/_internal/routing/terrain-read.php api/_internal/routing/request.php api/_internal/routing/response.php api/_internal/routing/__tests__/terrain-read-test.php -m "feat(routing): thread the way revision and the terrain lookup into the route payload, keyed by public_id"
```

---

## Aufgabe 9b: Der Faktor an den zwei Zeitstellen

⭐ **Es sind nicht drei Stellen, sondern zwei.** Die beiden Zweige in
`avesmapsAddClientCompatiblePathConnection` (ganzer Weg `:152`, Teilstücke an Kreuzungen `:165`)
münden beide in `avesmapsAddClientCompatiblePathSliceConnection`, und die Zeitrechnung steht dort
**einmal**, in `:194`. Die zweite ist die Rückrechnung im Wegpunkt-Anker (`:546` / `:549`).

💣 **Die Rückrechnung ist mit Gelände nicht reparierbar, sondern überflüssig.**
`$speed = $originalDistance / $originalTime` ist keine Geschwindigkeit, sondern Geschwindigkeit
geteilt durch den **Durchschnittsfaktor der Elternkante**; `:549` wendet sie auf ein Teilstück an
und schiebt damit das Gelände des *ganzen* Wegs auf ein Stück mit anderer Steigung. Heute ist das
korrekt, weil der einzige Faktor in `time` der **Flussfaktor** ist — und der ist über den ganzen
Weg konstant und kürzt sich heraus. **Die Regel dahinter:** die Rückrechnung gilt genau so lange,
wie der Faktor entlang des Wegs konstant ist. Für den Fluss ist er das. Für die Steigung nie.

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php`
- Ändern: `api/_internal/routing/response.php` (Terrain durchreichen)
- Ändern: `api/_internal/routing/__tests__/terrain-read-test.php` (Graph-Tests anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsTerrainTimeFactor`, `avesmapsTerrainHasData` (Aufgabe 3);
  `avesmapsRouteAttachTerrain` (Aufgabe 9a).
- Liefert: `avesmapsBuildClientCompatibleRouteGraph($networkData, $request, array $terrain = [])`
  — der leere Vorgabewert hält jeden bestehenden Aufrufer und den vorhandenen Test unverändert.
- Liefert: Segmentfelder `terrain_time_factor`, `ascent_schritt`, `descent_schritt`.

- [ ] **Schritt 1: Die Graph-Tests anhängen**

An `api/_internal/routing/__tests__/terrain-read-test.php`, vor der Schluss-Zeile:

```php
// ---- the factor in the graph -------------------------------------------------------------------
require_once __DIR__ . '/../terrain-factor.php';

// One way, three vertices, no interior node: Anfang -> Ende over 20 units, climbing 3.000 Schritt
// on the first half and falling 3.000 on the second.
$network = [
    'locations' => [
        ['name' => 'Anfang', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'Ende', 'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 0.0]]],
    ],
    'paths' => [[
        'id' => 'w1', 'public_id' => 'w1', 'client_path_id' => 'path-1',
        'name' => 'Strasse', 'subtype' => 'Strasse', 'revision' => 7,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]],
        'properties' => [], 'flow' => null,
    ]],
];
$plainRequest = ['transports' => AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'], 'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

// --- 💣 THE EMPTY DEFAULT IS BIT-IDENTICAL WITH TODAY --------------------------------------------
$without = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest);
$edgeWithout = $without['graph']['Anfang']['Ende'][0];
assert(!array_key_exists('terrain_time_factor', $edgeWithout),
    'with no terrain the edge must be EXACTLY the object it is today -- no new keys');
// Both directions still SHARE one object when there is no terrain (today's behaviour).
assert($without['graph']['Anfang']['Ende'][0] === $without['graph']['Ende']['Anfang'][0],
    'without terrain the two directions stay the same shared object');

$terrainMap = ['w1' => ['ascent' => 3000.0, 'descent' => 3000.0,
    'profile' => [[3000.0, 0.0], [0.0, 3000.0]], 'revision' => 7, 'stamp' => 'x']];
$with = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $terrainMap);
$forward = $with['graph']['Anfang']['Ende'][0];
$backward = $with['graph']['Ende']['Anfang'][0];

// --- the factor is applied, and the same one both ways here (equal up and down) ------------------
assert(isset($forward['terrain_time_factor']), 'a way with a profile must carry its factor');
assert(abs($forward['time'] - $edgeWithout['time'] * $forward['terrain_time_factor']) < 1e-9,
    'the time must be the base time times the factor -- nothing else');
assert($forward['ascent_schritt'] === 3000.0 && $forward['descent_schritt'] === 3000.0,
    'ascent and descent travel with the edge');

// --- 💣 DIRECTION. from/to stay the STORED orientation on both variants (the verlauf flow
// derivation's chain walk depends on that, client-graph.php:218-219). Ascent one way is descent the
// other -- that is the whole rule, and from/to are NOT swapped.
assert($forward['from'] === 'Anfang' && $backward['from'] === 'Anfang',
    'from/to must stay the stored orientation on BOTH variants');
$asym = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0,
    'profile' => [[1500.0, 0.0], [1500.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];
$asymGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $asym);
$up = $asymGraph['graph']['Anfang']['Ende'][0];
$down = $asymGraph['graph']['Ende']['Anfang'][0];
assert($up['terrain_time_factor'] > 1.0, 'going up must cost more');
assert($down['terrain_time_factor'] < 1.0, 'the same way downhill must be faster');
assert($up['ascent_schritt'] === 3000.0 && $down['ascent_schritt'] === 0.0,
    'the reverse variant climbs what the forward one falls');

// --- a stale path_revision falls back to today's number, silently and correctly ------------------
$staleMap = ['w1' => ['ascent' => 3000.0, 'descent' => 0.0, 'profile' => [[3000.0, 0.0]], 'revision' => 6, 'stamp' => 'x']];
$staleGraph = avesmapsBuildClientCompatibleRouteGraph($network, $plainRequest, $staleMap);
assert(abs($staleGraph['graph']['Anfang']['Ende'][0]['time'] - $edgeWithout['time']) < 1e-12,
    'a profile computed against another revision of this way must not change its time');

// --- 💣 A SLICE USES ITS OWN SEGMENTS, NEVER THE PARENT AVERAGE ---------------------------------
// Split the way at an interior node sitting on the middle vertex. The first half climbs, the second
// falls -- with a parent average both halves would come out identical, and that is exactly the
// error the back-computation makes.
$split = $network;
$split['locations'][] = ['name' => 'Mitte', 'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 0.0]]];
$splitGraph = avesmapsBuildClientCompatibleRouteGraph($split, $plainRequest, $terrainMap);
$firstHalf = $splitGraph['graph']['Anfang']['Mitte'][0];
$secondHalf = $splitGraph['graph']['Mitte']['Ende'][0];
assert($firstHalf['ascent_schritt'] === 3000.0 && $firstHalf['descent_schritt'] === 0.0,
    'the first half must carry ITS climb, not half the way average');
assert($secondHalf['ascent_schritt'] === 0.0 && $secondHalf['descent_schritt'] === 3000.0,
    'the second half must carry ITS fall');
assert($firstHalf['terrain_time_factor'] > $secondHalf['terrain_time_factor'],
    'climbing half and falling half must not come out equal');

// --- 💣 THE RIVER CLAMP STAYS THE RIVER CLAMP ---------------------------------------------------
// Flow and slope MULTIPLY, and the flow factor keeps its own [1,0 ... 3,0]. Inheriting that bound
// for the slope would clamp every descent up to 1,0 and downhill would never be faster than level.
$river = $network;
$river['paths'][0]['subtype'] = 'Flussweg';
$river['paths'][0]['name'] = 'Flussweg';
$river['paths'][0]['flow'] = ['dir' => 'forward', 'factor' => 2.0];
$riverGraph = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest, $asym);
$riverUp = $riverGraph['graph']['Anfang']['Ende'][0];
assert($riverUp['flow_time_factor'] === 1.0, 'travelling WITH the current stays the base flow factor');
$riverBack = $riverGraph['graph']['Ende']['Anfang'][0];
assert($riverBack['flow_time_factor'] === 2.0, 'against the current the flow factor applies');
assert($riverBack['terrain_time_factor'] < 1.0, 'and the slope factor applies on top, independently');
$riverBase = avesmapsBuildClientCompatibleRouteGraph($river, $plainRequest)['graph']['Ende']['Anfang'][0];
assert(abs($riverBack['time'] - $riverBase['time'] * $riverBack['terrain_time_factor']) < 1e-9,
    'flow and slope must multiply, each with its own clamp');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
```
Erwartet: FEHLER — `avesmapsBuildClientCompatibleRouteGraph() expects 2 arguments`, oder ein
fehlgeschlagenes `assert` an der ersten Terrain-Zeile.

- [ ] **Schritt 3: `client-graph.php` — Terrain aufnehmen und weiterreichen**

Oben, neben den anderen `require`-freien Konstanten, die Faktor-Datei einbinden:

```php
require_once __DIR__ . '/terrain-factor.php';
require_once __DIR__ . '/terrain-read.php';
```

`avesmapsBuildClientCompatibleRouteGraph` bekommt den dritten Parameter:

```php
function avesmapsBuildClientCompatibleRouteGraph(array $networkData, array $request, array $terrain = []): array {
```

💣 **Der Vorgabewert `[]` ist tragend:** er hält `avesmapsBuildMinimalRouteResultFromRequest` in
den Diagnose-Zweigen von `api/route/index.php` und den vorhandenen
`transport-restriction-test.php` unverändert lauffähig — und er ist zugleich der Zustand
„Schalter aus".

In der Weg-Schleife, an der Aufrufstelle (`:81`):

```php
        avesmapsAddClientCompatiblePathConnection($graph, $locations, $locationCoordinateIndex, $locationCellIndex, $path, $pathIndex, $request, $terrain);
```

- [ ] **Schritt 4: Das Profil an den Weg heften und die Teilstücke schneiden**

`avesmapsAddClientCompatiblePathConnection` bekommt den Parameter und heftet **einmal** an:

```php
function avesmapsAddClientCompatiblePathConnection(array &$graph, array $locations, array $locationCoordinateIndex, array $locationCellIndex, array $path, int $pathIndex, array $request, array $terrain = []): void {
```

Direkt nach `$clientPathId`-Ermittlung (vor dem `$nodeVertices`-Block):

```php
    // V11: this way's own profile, or null. Attached ONCE per way, and only when there is one --
    // most ways touch no raster at all, and an absent key keeps the connection object exactly as it
    // is today.
    $pathTerrain = avesmapsRouteAttachTerrain($path, $terrain);
```

Die beiden Aufrufe von `avesmapsAddClientCompatiblePathSliceConnection` bekommen den
Stützpunktbereich mit:

```php
    // No interior node -> single edge over the whole path (unchanged behaviour, no regression).
    if (count($nodeVertices) <= 2) {
        avesmapsAddClientCompatiblePathSliceConnection($graph, $startNode, $endNode, $coordinates, $routeType, $transportOption, (float) $speed, $clientPathId, $path, $pathTerrain, 0, $coordinateCount - 1);
        return;
    }
```

und im Teilstück-Zweig:

```php
        avesmapsAddClientCompatiblePathSliceConnection($graph, $fromVertex['location'], $toVertex['location'], $sliceCoordinates, $routeType, $transportOption, (float) $speed, $clientPathId . '#' . $segmentIndex, $path, $pathTerrain, (int) $fromVertex['index'], (int) $toVertex['index']);
```

- [ ] **Schritt 5: Die erste Zeitstelle**

`avesmapsAddClientCompatiblePathSliceConnection` — Signatur und Kopf:

```php
function avesmapsAddClientCompatiblePathSliceConnection(array &$graph, array $fromNode, array $toNode, array $coordinates, string $routeType, string $transportOption, float $speed, string $connectionId, array $path, ?array $pathTerrain = null, int $fromVertexIndex = 0, int $toVertexIndex = 0): void {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    // V11: the slice's OWN climb and fall, summed from ITS segments of profile_json -- never the
    // parent way's average. `profile_json` holds one [ascent, descent] pair per stored segment, so
    // the vertex range IS the slice.
    $sliceTerrain = avesmapsRouteSliceTerrain($pathTerrain, $fromVertexIndex, $toVertexIndex);
    $connection = [
        'distance' => $distance,
        'time' => $distance / $speed,
        ...
```

Und **nach** dem Aufbau von `$connection`: der vorhandene `$flow`-Block wird durch diese
Dreiteilung ersetzt. ⚠️ Der bisherige Zweig `if ($flow === null) { … return; }` bleibt **wörtlich
erhalten** — er ist nur um eine zweite Bedingung enger geworden.

```php
    // ---- V11: the slope ------------------------------------------------------------------------
    // 💣 The direction rule is the SAME as the river's (:218-219): from/to keep the STORED
    // orientation on BOTH variants -- the verlauf flow derivation's chain walk depends on it.
    // Ascent in drawing direction is descent against it. That is the whole rule.
    $forwardFactor = $sliceTerrain === null ? 1.0
        : avesmapsTerrainTimeFactor($sliceTerrain['ascent'], $sliceTerrain['descent'], $distance);
    $reverseFactor = $sliceTerrain === null ? 1.0
        : avesmapsTerrainTimeFactor($sliceTerrain['descent'], $sliceTerrain['ascent'], $distance);
    if ($sliceTerrain !== null) {
        // Carried so the waypoint anchor can cut it; only present when there IS a profile.
        $connection['terrain_profile'] = $sliceTerrain['profile'];
    }

    $flow = avesmapsRouteClientNormalizeFlow($path, $routeType);

    // 🔴 NO FLOW AND NO TERRAIN: byte for byte today's branch -- no new key, ONE shared object in
    // both directions. This is the line that makes „switch off" bit-identical, and it is why the
    // terrain block above adds nothing to $connection when $sliceTerrain is null.
    if ($flow === null && $sliceTerrain === null) {
        // No known flow direction: symmetric, EXACTLY today's behaviour (shared object).
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $connection);
        return;
    }

    // Terrain but no flow: two objects instead of one shared, because the directions now differ.
    if ($flow === null) {
        $forwardConnection = avesmapsRouteApplyTerrainToConnection($connection, $forwardFactor, $sliceTerrain, false);
        $reverseConnection = avesmapsRouteApplyTerrainToConnection($connection, $reverseFactor, $sliceTerrain, true);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $forwardConnection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $reverseConnection);
        return;
    }
```

Der vorhandene Fluss-Block darunter bleibt **unverändert** bis zu den beiden
`avesmapsAddClientCompatibleGraphConnection`-Aufrufen; direkt **davor** kommt:

```php
    // V11: flow and slope MULTIPLY, each keeping its own clamp -- the river's [1,0 ... 3,0] (a
    // current only ever slows you down) and the slope's [0,5 ... 4,0]. Inheriting the river clamp
    // for the slope would pull every descent up to 1,0, and downhill would never be faster than
    // level: owner decision 3 silently taken back.
    $forwardConnection = avesmapsRouteApplyTerrainToConnection($forwardConnection, $forwardFactor, $sliceTerrain, false);
    $reverseConnection = avesmapsRouteApplyTerrainToConnection($reverseConnection, $reverseFactor, $sliceTerrain, true);
```

Und der Helfer, neben `avesmapsRouteSliceTerrain`:

```php
/**
 * PURE: multiply one connection's time by its slope factor and attach what the API reports.
 *
 * A null slice is a no-op that returns the connection UNTOUCHED -- not "times 1.0", untouched. The
 * difference matters: an untouched object carries no `terrain_time_factor` key at all, and that is
 * what keeps „switch off" byte-identical with today.
 *
 * `$reversed` swaps ascent and descent, because the reverse variant travels the stored line
 * backwards. from/to are NOT swapped (client-graph.php:218-219).
 */
function avesmapsRouteApplyTerrainToConnection(array $connection, float $factor, ?array $sliceTerrain, bool $reversed): array
{
    if ($sliceTerrain === null) {
        return $connection;
    }
    $connection['time'] = (float) $connection['time'] * $factor;
    $connection['terrain_time_factor'] = $factor;
    $connection['ascent_schritt'] = $reversed ? $sliceTerrain['descent'] : $sliceTerrain['ascent'];
    $connection['descent_schritt'] = $reversed ? $sliceTerrain['ascent'] : $sliceTerrain['descent'];

    return $connection;
}
```

- [ ] **Schritt 6: Den Teilstück-Schneider schreiben**

Neben `avesmapsRouteClientNormalizeFlow` in `client-graph.php`:

```php
/**
 * PURE: the climb and fall of ONE slice, summed from its own segments.
 *
 * `profile_json` holds one [ascent, descent] pair per STORED segment of the way, so a vertex range
 * is exactly a run of pairs -- no interpolation, no averaging. `$toVertexIndex` is exclusive as a
 * segment bound: segments [from, to) lie between vertex `from` and vertex `to`.
 *
 * Returns null when there is no profile, so the caller adds nothing at all to the connection.
 */
function avesmapsRouteSliceTerrain(?array $pathTerrain, int $fromVertexIndex, int $toVertexIndex): ?array
{
    if ($pathTerrain === null || !is_array($pathTerrain['profile'] ?? null)) {
        return null;
    }
    $profile = $pathTerrain['profile'];
    $ascent = 0.0;
    $descent = 0.0;
    $slice = [];
    for ($index = $fromVertexIndex; $index < $toVertexIndex; $index++) {
        $pair = $profile[$index] ?? null;
        if (!is_array($pair) || count($pair) < 2) {
            // A gap in the profile is not a zero: the stored geometry and the payload's disagree,
            // and inventing level ground would hide that. The whole slice goes unknown.
            return null;
        }
        $slice[] = [(float) $pair[0], (float) $pair[1]];
        $ascent += (float) $pair[0];
        $descent += (float) $pair[1];
    }
    if ($slice === []) {
        return null;
    }

    return ['ascent' => $ascent, 'descent' => $descent, 'profile' => $slice];
}

/**
 * PURE: split a slice's profile at a fraction of ONE segment, for the waypoint anchor.
 *
 * 💣 THIS IS WHAT REPLACES THE BACK-COMPUTATION. `$speed = $originalDistance / $originalTime`
 * (:546) is not a speed but a speed divided by the parent edge's AVERAGE factor; applying it to a
 * sub-slice pushes the whole way's terrain onto a piece with a different gradient. Today that is
 * correct -- the only factor in `time` is the river's, and that one is CONSTANT along the way, so
 * it cancels. The rule underneath: the back-computation holds exactly as long as the factor is
 * constant along the way. For the current it is. For the slope it never is.
 *
 * `$segmentIndex` is the segment being cut, `$t` the fraction of it that falls to the FIRST piece.
 *
 * @return array{0:?array,1:?array} the profile of the first and the second piece
 */
function avesmapsRouteSplitTerrainProfile(?array $profile, int $segmentIndex, float $t): array
{
    if (!is_array($profile)) {
        return [null, null];
    }
    $first = [];
    $second = [];
    foreach ($profile as $index => $pair) {
        if (!is_array($pair) || count($pair) < 2) {
            return [null, null];
        }
        if ($index < $segmentIndex) {
            $first[] = [(float) $pair[0], (float) $pair[1]];
        } elseif ($index > $segmentIndex) {
            $second[] = [(float) $pair[0], (float) $pair[1]];
        } else {
            // Split proportionally by length. The profile stores the SUM over a segment, not its
            // shape, so a proportional share is the only honest answer -- and it is exact in the
            // one property that matters: the two halves add back up to the whole.
            $share = max(0.0, min(1.0, $t));
            $first[] = [(float) $pair[0] * $share, (float) $pair[1] * $share];
            $second[] = [(float) $pair[0] * (1.0 - $share), (float) $pair[1] * (1.0 - $share)];
        }
    }

    return [$first === [] ? null : $first, $second === [] ? null : $second];
}
```

- [ ] **Schritt 7: Die zweite Zeitstelle — die Rückrechnung ersetzen**

`avesmapsBuildClientRouteSubPathConnection` bekommt das Profil des Teilstücks und rechnet daraus:

```php
function avesmapsBuildClientRouteSubPathConnection(array $original, string $from, string $to, array $coordinates, string $connectionId, ?array $terrainProfile = null): array {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $originalDistance = (float) ($original['distance'] ?? 0.0);
    $originalTime = (float) ($original['time'] ?? 0.0);

    // 💣 THE BACK-COMPUTATION IS NOT REPAIRED, IT IS MADE UNNECESSARY. `$originalDistance /
    // $originalTime` is not a speed: it is a speed divided by the parent edge's AVERAGE factor.
    // With a river that cancels, because the flow factor is constant along the way. With a slope it
    // never does -- it would push the whole way's terrain onto a piece with a different gradient.
    // So: undo the parent's OWN terrain factor first, then apply the slice's own.
    $parentFactor = (float) ($original['terrain_time_factor'] ?? 1.0);
    $baseTime = $parentFactor > 0.0 ? $originalTime / $parentFactor : $originalTime;
    $baseSpeed = $baseTime > 0.0 ? $originalDistance / $baseTime : 0.0;
    $sliceBaseTime = $baseSpeed > 0.0 ? $distance / $baseSpeed : $baseTime;

    $ascent = null;
    $descent = null;
    $factor = 1.0;
    if (is_array($terrainProfile) && $terrainProfile !== []) {
        $ascent = 0.0;
        $descent = 0.0;
        foreach ($terrainProfile as $pair) {
            $ascent += (float) ($pair[0] ?? 0.0);
            $descent += (float) ($pair[1] ?? 0.0);
        }
        $factor = avesmapsTerrainTimeFactor($ascent, $descent, $distance);
    }

    $connection = [
        'distance' => $distance,
        'time' => $sliceBaseTime * $factor,
        'route_type' => (string) ($original['route_type'] ?? ''),
        'transport_option' => (string) ($original['transport_option'] ?? ''),
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => (string) ($original['feature_id'] ?? ''),
        'public_id' => (string) ($original['public_id'] ?? ''),
        'from' => $from,
        'to' => $to,
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'synthetic' => false,
    ];
    // Only when there IS terrain -- otherwise the object stays exactly what it is today.
    if ($ascent !== null) {
        $connection['terrain_time_factor'] = $factor;
        $connection['ascent_schritt'] = $ascent;
        $connection['descent_schritt'] = $descent;
        $connection['terrain_profile'] = $terrainProfile;
    }

    return $connection;
}
```

⚠️ **`$original` ist bereits eine der beiden Richtungsvarianten** — das Teilstück erbt damit auch
deren Richtung, und `terrain_profile` steht auf ihr schon richtig herum.

In `avesmapsAnchorClientWaypointToLandPath`, im `else`-Zweig, vor den beiden `slice`-Aufbauten:

```php
        // V11: the parent's profile, cut at the projected point. `$i` is the segment being cut and
        // `$t` the fraction of it that falls to the first piece.
        [$profileFrom, $profileTo] = avesmapsRouteSplitTerrainProfile($original['terrain_profile'] ?? null, $i, $t);
```

und die beiden Aufrufe:

```php
            $connectionFrom = avesmapsBuildClientRouteSubPathConnection($original, $fromName, $anchorNodeName, $sliceFrom, 'wp-slice-' . $waypointIndex . '-a', $profileFrom);
```
```php
            $connectionTo = avesmapsBuildClientRouteSubPathConnection($original, $anchorNodeName, $toName, $sliceTo, 'wp-slice-' . $waypointIndex . '-b', $profileTo);
```

- [ ] **Schritt 8: Die Segmentfelder in die Antwort**

In `avesmapsBuildClientRouteDiagnosticSegments`, neben `flow_time_factor`:

```php
            // V11. 💣 `1.0` means three different things -- terrain off, flat here, nothing known
            // here. `debug.terrain.enabled` separates the first; `null` on ascent/descent separates
            // the third from the second. Without both, a changed number is not explainable to a
            // consumer of the public API.
            'terrain_time_factor' => (float) ($segment['terrain_time_factor'] ?? 1.0),
            'ascent_schritt' => array_key_exists('ascent_schritt', $segment) ? (float) $segment['ascent_schritt'] : null,
            'descent_schritt' => array_key_exists('descent_schritt', $segment) ? (float) $segment['descent_schritt'] : null,
```

- [ ] **Schritt 9: Das Terrain in `response.php` durchreichen**

```php
	$clientGraph = avesmapsBuildClientCompatibleRouteGraph($routeNetworkData, $request, $terrain);
```

- [ ] **Schritt 10: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php && php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php && php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/transport-restriction-test.php
```
Erwartet: dreimal grün. 💣 Bricht `transport-restriction-test.php`, ist der Vorgabewert `[]`
irgendwo nicht durchgehalten — und dann ist „Schalter aus" nicht mehr bit-identisch.

- [ ] **Schritt 11: Commit**

```bash
git commit --only -- api/_internal/routing/client-graph.php api/_internal/routing/response.php api/_internal/routing/__tests__/terrain-read-test.php -m "feat(routing): apply the slope factor at both time sites; a sub-slice uses its own profile, not the parent average"
```

---

## Aufgabe 10: Der Schalter, die eine Leseregel, und `api/README.md`

**Dateien:**
- Ändern: `api/_internal/app/app-setting.php` (`avesmapsAppSettingGetWithoutDdl`)
- Ändern: `api/_internal/app/path-landscapes.php` (delegiert statt eigener Kopie)
- Ändern: `api/_internal/routing/terrain-read.php` (delegiert ebenfalls)
- Ändern: `api/_internal/app/terrain-store.php` (`terrain_travel_set`)
- Ändern: `api/edit/map/ecosystem.php` (eine Aktion)
- Ändern: `html/landschaften-editor.html` (eine Kachel)
- Ändern: `api/README.md`

**Schnittstellen:**
- Liefert: `avesmapsAppSettingGetWithoutDdl(PDO $pdo, string $key, string $default): string`
  — **eine** Umsetzung der Regel „lesen ohne die selbstheilende DDL", drei Nutzer.
- Liefert: Aktion `terrain_travel_set` → `{ terrain_travel_enabled: bool }`.

- [ ] **Schritt 1: Die eine Leseregel**

An `api/_internal/app/app-setting.php` anhängen:

```php
/**
 * Read a setting WITHOUT the self-healing DDL. For read paths that run on every visitor request.
 *
 * 💣 `avesmapsAppSettingGet` runs `CREATE TABLE IF NOT EXISTS app_setting` on EVERY call. In an
 * editor path that is fine and deliberate; in front of a public read it is precisely the hotspot
 * AGENTS.md §10 already lists for territories-endpoint.php, and the information_schema load of the
 * pool incident of 2026-07-17.
 *
 * A missing table returns the default, it does not create one: if the table does not exist, nobody
 * has ever switched anything on.
 *
 * ⚠️ This function exists BECAUSE the rule was about to be written a third time. V10 wrote it as
 * avesmapsPathLandscapesEcosystemEnabled and V11 needed the same thing for its own key -- so it
 * moved here and both call it. There is no fourth copy to write.
 */
function avesmapsAppSettingGetWithoutDdl(PDO $pdo, string $key, string $default = ''): string
{
    try {
        $statement = $pdo->prepare('SELECT setting_value FROM app_setting WHERE setting_key = :k LIMIT 1');
        $statement->execute(['k' => $key]);
        $value = $statement->fetchColumn();
    } catch (PDOException) {
        return $default;
    }

    return $value === false ? $default : (string) $value;
}
```

- [ ] **Schritt 2: V10 auf dieselbe Funktion umstellen**

In `api/_internal/app/path-landscapes.php` den Rumpf von
`avesmapsPathLandscapesEcosystemEnabled` ersetzen (der erklärende Kommentar darüber **bleibt**,
er beschreibt weiterhin genau die Regel):

```php
function avesmapsPathLandscapesEcosystemEnabled(PDO $pdo): bool
{
    // One implementation of „read without the DDL", in app-setting.php. It used to live here; V11
    // needed the same rule for its own key, and a second copy is how two answers to one question
    // start drifting.
    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ECOSYSTEM_SETTING, '0') !== '0';
}
```

⚠️ `path-ecosystem.php` → `ecosystem.php` zieht `app-setting.php` bereits herein. Nachsehen:

```bash
grep -rn "app-setting.php" api/_internal/app/*.php | head
```

- [ ] **Schritt 3: Die lokale Kopie aus 9a ersetzen**

In `api/_internal/routing/terrain-read.php` oben:

```php
require_once __DIR__ . '/../app/app-setting.php';
```

und den Rumpf von `avesmapsRouteTerrainEnabled`:

```php
function avesmapsRouteTerrainEnabled(PDO $pdo): bool
{
    // 🔴 DEFAULT OFF. The ecosystem convention, not the citymaps one: an unfinished layer must not
    // change published travel times because somebody deployed it.
    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_TERRAIN_SETTING, '0') !== '0';
}
```

⚠️ `app-setting.php` ist eigenständig (nur PDO) — es zieht nichts Schweres in den Routing-Pfad.
Nachsehen:

```bash
grep -n "require\|include" api/_internal/app/app-setting.php
```
Erwartet: keine Treffer.

- [ ] **Schritt 4: Der Schreibweg**

An `api/_internal/app/terrain-store.php` anhängen:

```php
/**
 * The owner switch „Geländeabhängiges Reisen".
 *
 * 🔴 AN heisst FÜR ALLE (owner decision 1: „ist es AN wird es für alle berechnet") -- no test
 * parameter, no quiet rollout. AUS heisst line for line today's numbers.
 *
 * 💣 IT IS AN EMERGENCY STOP, AND THE API SWITCH IS NOT ITS EQUAL. `terrain: false` in a request
 * may only switch OFF; global OFF always wins. Otherwise a stranger could switch on what the owner
 * switched off, and the emergency stop would not be one.
 *
 * The DDL runs HERE, on the owner's deliberate action -- never on a read path.
 */
function avesmapsTerrainTravelSet(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingEnsureTable($pdo);
    avesmapsAppSettingSet($pdo, 'terrain_travel_enabled', $enabled ? '1' : '0');

    return ['terrain_travel_enabled' => $enabled];
}

function avesmapsTerrainTravelStatus(PDO $pdo): array
{
    return ['terrain_travel_enabled' => avesmapsAppSettingGetWithoutDdl($pdo, 'terrain_travel_enabled', '0') !== '0'];
}
```

⚠️ Der Schlüsselname steht hier als Literal, weil `terrain-read.php` (Routing) und
`terrain-store.php` (Editor) sich nicht gegenseitig laden dürfen. Beide tragen denselben Wert und
den Hinweis darauf — nachsehen:

```bash
grep -rn "terrain_travel_enabled" api/ | grep -v README
```
Erwartet: genau drei Stellen (Konstante in `terrain-read.php`, zweimal Literal in
`terrain-store.php`).

Im Dispatcher `api/edit/map/ecosystem.php`, hinter `'terrain_profile_status'`:

```php
        // V11 §7.1: „Geländeabhängiges Reisen: AN/AUS". AN = for everyone.
        'terrain_travel_set' => avesmapsTerrainTravelSet($pdo, (bool) ($payload['enabled'] ?? false)),
        'terrain_travel_status' => avesmapsTerrainTravelStatus($pdo),
```

- [ ] **Schritt 5: Die Kachel**

In `html/landschaften-editor.html`, hinter `ecoProfiles`:

```html
    <button type="button" class="avm-tile" id="ecoTerrainTravel" title="Rechnet Anstieg und Gefälle in die Reisezeiten ein — für alle Besucher. AUS heisst Zeile für Zeile die heutigen Zahlen."><span class="t1">Geländeabhängiges Reisen</span><span class="t2" id="ecoTerrainTravelInfo">Zustand unbekannt</span></button>
```

Und die Verdrahtung, nach `renderProfileTile()`:

```js
// 🔴 Der Schalter wirkt FÜR ALLE (Owner-Entscheid 1). ⚠️ Er geht erst an, wenn der Owner das Bild
// aus §7.2 gesehen hat: eine Zahl, die leise falsch ist, merkt niemand -- und Reisezeiten sind die
// eine Zahl, die Leute aus dieser Karte übernehmen.
let terrainTravelEnabled = null;

function renderTerrainTravelTile() {
	const tile = $("ecoTerrainTravel");
	const info = $("ecoTerrainTravelInfo");
	if (!tile || !info) { return; }
	if (terrainTravelEnabled === null) { info.textContent = "Zustand unbekannt"; return; }
	tile.classList.toggle("avm-tile--on", terrainTravelEnabled === true);
	info.textContent = terrainTravelEnabled ? "AN — für alle Besucher" : "AUS — heutige Zahlen";
}

async function toggleTerrainTravel() {
	const tile = $("ecoTerrainTravel");
	tile.disabled = true;
	try {
		const next = terrainTravelEnabled !== true;
		if (next && !window.confirm(
			"Geländeabhängiges Reisen einschalten?\n\n"
			+ "Das ändert die veröffentlichten Reisezeiten für ALLE Besucher, sofort.")) {
			return;
		}
		const result = await ecoPost("terrain_travel_set", { enabled: next });
		terrainTravelEnabled = result.terrain_travel_enabled === true;
		renderTerrainTravelTile();
		flashStatus("Geländeabhängiges Reisen ist jetzt " + (terrainTravelEnabled ? "AN" : "AUS") + ".", "ok");
	} catch (error) {
		flashStatus("Schalter: " + (error && error.message ? error.message : String(error)), "error");
	} finally {
		tile.disabled = false;
	}
}
```

Bei den `addEventListener`-Zeilen:
`$("ecoTerrainTravel").addEventListener("click", () => { void toggleTerrainTravel(); });`
Beim Öffnen, neben den anderen Statusabfragen:
```js
		const travel = await ecoPost("terrain_travel_status", {});
		terrainTravelEnabled = travel.terrain_travel_enabled === true;
		renderTerrainTravelTile();
```

⚠️ Das Menüband hat damit **sechs** Kacheln. Nachsehen, dass sie gleich breit bleiben und nicht
umbrechen — die Regel „drei gleiche Spalten" gilt für die Spalten, nicht für das Band; bricht das
Band, gehört `flex-wrap` in `css/pages/landschaften-editor.css` geprüft, **nicht** eine Kachel
schmaler gemacht.

- [ ] **Schritt 6: 🔧 DU (Owner) — der scharfe Zähler, einmalig**

Nach dem Deploy: den Schalter im Editor **einmal AN**, sofort eine Sonde, dann **wieder AUS**.
Das ist der einzige Weg, Abnahmeschritt 2 scharf zu stellen, bevor die Kurve entschieden ist.

```bash
curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).route;console.log(JSON.stringify(r.debug.context.terrain));console.log('cost',r.cost);})"
```

💣 **`matched_ways` muss > 0 sein.** Steht er auf 0, obwohl `profile_rows` > 0 ist, verfehlt der
Verbund jede Zeile — und **das** ist zu klären, nicht die Kurve. Steht `profile_rows` auf 0, ist
der Profillauf nicht gelaufen.

- [ ] **Schritt 7: `api/README.md`**

Im Abschnitt zu `POST /api/route/` ergänzen:

```markdown
### Terrain (V11)

The travel time of a leg is multiplied by a **slope factor** derived from the stored height
rasters, when the owner switch `terrain_travel_enabled` is on. The **shape** of the response is
unchanged; the **values** of `cost` and `segments[].cost_units` change. `distance_units` does not —
distance is geometry.

| Field | Where | Meaning |
|---|---|---|
| `terrain_time_factor` | per segment | the applied factor; `1.0` when it had no effect |
| `ascent_schritt` / `descent_schritt` | per segment | climb and fall in Schritt, in the direction travelled; **`null`** where no height data exists |
| `debug.context.terrain.enabled` | debug | was the switch on |
| `terrain` | **request** | `false` switches terrain **off**; it can never switch it on |

⚠️ **`terrain: false` does not give you the same route with different numbers — it gives you a
DIFFERENT ROUTE.** The planner looks for the cheapest way; change the price of the mountains and
the choice changes with it. With terrain the route goes around, without it over the pass. Both are
correct — but they are two journeys, not two price tags for one.

💣 `terrain_time_factor: 1.0` means three different things: terrain is off, the ground is level
here, or nothing is known here. `debug.context.terrain.enabled` separates the first;
`ascent_schritt: null` separates the third from the second.

The speed table (`Gebirgspass` 1,5 km/h, `Strasse` 4,0 …) is the **base speed BEFORE terrain**.
```

- [ ] **Schritt 8: Prüfen und committen**

```bash
php -l api/_internal/app/app-setting.php && php -l api/_internal/app/path-landscapes.php && php -l api/_internal/routing/terrain-read.php && php -l api/_internal/app/terrain-store.php
```

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-landscapes-test.php 2>/dev/null || echo "(kein solcher Test -- dann entfaellt dieser Schritt)"
```

```bash
git commit --only -- api/_internal/app/app-setting.php api/_internal/app/path-landscapes.php api/_internal/routing/terrain-read.php api/_internal/app/terrain-store.php api/edit/map/ecosystem.php html/landschaften-editor.html api/README.md -m "feat(landschaften): owner switch for terrain-dependent travel, and ONE implementation of the DDL-free setting read"
```

---

## Aufgabe 11: Die Messung, die vor dem Einschalten steht

⚠️ **Der Schalter geht nicht an, bevor der Owner dieses Bild gesehen hat.** Eine Zahl, die leise
falsch ist, merkt niemand — und Reisezeiten sind die eine Zahl, die Leute aus dieser Karte
übernehmen.

**Dateien:**
- Ändern: `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md`
- Ggf. ändern: `api/_internal/routing/terrain-factor.php` (nur die vier Konstanten)
- Erstellen: `<scratchpad>/v11-distribution.js` (Wegwerf)

**Schnittstellen:**
- Verbraucht: gefüllte `path_terrain`-Zeilen (Aufgabe 8), der Faktor (Aufgabe 3).
- Liefert: die Entscheidungsgrundlage für die obere Klemme — Owner-Entscheid, nicht Agent-Entscheid.

- [ ] **Schritt 1: Die Verteilung holen**

Ein neuer, kleiner Diagnose-Zweig ist dafür **nicht** nötig — `terrain_profile_status` liefert die
Zählwerte, und die Verteilung kommt aus einer einzelnen Abfrage. 🔧 **DU (Owner):** in phpMyAdmin

```sql
SELECT
  COUNT(*)                                                  AS ways,
  SUM(ascent_schritt IS NOT NULL)                           AS with_profile,
  ROUND(AVG(ascent_schritt), 1)                             AS mean_ascent,
  MAX(ascent_schritt)                                       AS max_ascent,
  MAX(descent_schritt)                                      AS max_descent
FROM path_terrain;
```

und, für die zehn am stärksten verlangsamten Wege mit Namen:

```sql
SELECT f.name, f.feature_subtype, f.public_id,
       t.ascent_schritt, t.descent_schritt,
       ROUND(t.ascent_schritt / 3000.0, 3) AS ascent_mapunits
FROM path_terrain t
JOIN map_features f ON f.id = t.path_id
WHERE t.ascent_schritt IS NOT NULL
ORDER BY t.ascent_schritt DESC
LIMIT 10;
```

- [ ] **Schritt 2: Die Kurve gegen die Verteilung legen**

Aus den Zahlen von Schritt 1 die Steigung je Weg berechnen (`ascent_schritt / (3000 · Länge)`),
Median, p90 und Maximum bilden, und daraus den Faktor an den vier Stellen ablesen. Das Ziel steht
in §7.2: **ein typischer Bergweg landet nahe der 2,67×**, die die veröffentlichte Tabelle heute
schon unterstellt.

Wird nachjustiert, dann **nur** `AVESMAPS_TERRAIN_UP_PENALTY`, `_DOWN_BONUS`, `_DOWN_PENALTY`,
`_FACTOR_MIN`, `_FACTOR_MAX` in `terrain-factor.php` — und danach:

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
```
💣 Der Test hält die 2,67×-Verankerung fest. Bricht er, ist entweder die Kurve zu weit weg vom
Anker oder der Anker selbst zur Diskussion gestellt — beides ist eine **Owner-Frage**, keine
stille Anpassung des Tests.

- [ ] **Schritt 3: Dasselbe Bild mit und ohne Schalter**

🔧 **DU (Owner):** Schalter einmal AN, dann zwei Sonden, dann wieder AUS.

```bash
curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}' -o with.json && curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal","terrain":false}' -o without.json
```

```bash
node -e "const a=require('./with.json').route,b=require('./without.json').route;console.log('mit',a.cost.toFixed(2),a.segments.length,'Etappen');console.log('ohne',b.cost.toFixed(2),b.segments.length,'Etappen');console.log('Faktoren',a.segments.map(s=>s.terrain_time_factor.toFixed(2)).join(' '));"
```

⚠️ **Unterschiedliche Etappenzahlen sind kein Fehler.** `terrain: false` liefert eine ANDERE
ROUTE, nicht dieselbe mit anderen Zahlen — mit Gelände geht sie außen herum, ohne über den Pass.

- [ ] **Schritt 4: Dem Owner vorlegen und in die Messdatei schreiben**

An `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md` anhängen:

```markdown
## 2. Verteilung und Kurve, gemessen am <DATUM>

| | Anstieg (Schritt) | Gefälle (Schritt) |
|---|---|---|
| Wege mit Profil | | |
| Median | | |
| p90 | | |
| Maximum | | |

Steigung (Anstieg / (3.000 · Länge)) → Faktor:

| | Steigung | Faktor |
|---|---|---|
| Median | | |
| p90 | | |
| Maximum | | |

### Die zehn am stärksten verlangsamten Wege

| Name | Art | Anstieg | Faktor |
|---|---|---|---|

### Gareth → Thorwal, mit und ohne Schalter

| | cost | Etappen |
|---|---|---|
| mit Gelände | | |
| ohne Gelände | | |

⚠️ Unterschiedliche Etappenzahlen sind kein Fehler: `terrain: false` liefert eine andere Route.

### 🔧 Owner-Entscheid: die obere Klemme

Vorgabe `4,0`. Bei voller Klemme läge ein steiler Pass bei **0,375 km/h** — keine 10 km am Tag.
Der Owner entscheidet nach diesem Bild, nicht die Spec.

- [ ] gesehen und entschieden am __________, Klemme bleibt / wird ______
```

- [ ] **Schritt 5: Commit**

```bash
git commit --only -- docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md api/_internal/routing/terrain-factor.php -m "docs(landschaften): the measured slope distribution and the picture the owner decides the clamp on"
```

---

## Aufgabe 12: Abnahme am Livebestand

⚠️ **Vor der Abnahme neu zählen** — die Zahlen aus Aufgabe 1 gelten, nicht die der Spec.
💣 Eine Sonde je Zeile. Keine Schleife.

**Dateien:**
- Ändern: `docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md`

- [ ] **Schritt 1: Schalter AUS — `cost` bit-identisch**

```bash
curl -sS -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).route;console.log('cost',r.cost);})"
```
Erwartet: **exakt** die Zahl aus Aufgabe 9a Schritt 9. Der wichtigste Test des ganzen Plans — er
beweist, dass V11 im Ruhezustand nichts anfasst.

- [ ] **Schritt 2: 🔴 Der harte Zähler ZUERST** (Schalter kurz AN)

Erwartet: `matched_ways` > 0. Ohne ihn ist Schritt 1 auch dann grün, wenn der Verbundschlüssel
jede Zeile verfehlt — und Schritt 3 sähe dann aus wie ein Kurvenproblem.

- [ ] **Schritt 3: Schalter AN — dieselbe Route, plausible Faktoren**

Erwartet: `terrain_time_factor` je Segment plausibel, die Koschberge-Etappe **langsamer** als
vorher.

- [ ] **Schritt 4: Ein Weg ohne Höhendaten**

Ein Segment weit ab von jedem Gebirge heraussuchen: `ascent_schritt: null`,
`terrain_time_factor: 1.0`.

- [ ] **Schritt 5: Ein Wegpunkt mitten auf einer Bergstraße** — der Test, der die Rückrechnung erschlägt

Route mit `via` an einem Punkt auf einer Bergstraße. Erwartet: die beiden Teilstücke ergeben
zusammen **dieselbe Zeit wie die ungeteilte Kante** (±Rundung). ⚠️ `via` wirft heute
`via_not_supported` — dann statt dessen einen abgelegenen Ort als `to` wählen, der über
`avesmapsConnectClientRouteWaypointsToNearestLandPath` angebunden wird, und die beiden
`wp-slice-*`-Segmente gegen die ungeteilte Kante rechnen.

- [ ] **Schritt 6: Ein Weg durch einen Überlappungsstreifen zweier Gebirge**

Erwartet: der Anstieg ist **größer** als der aus einem der beiden Raster allein (§5.0). Wird er
gleich, summiert der Leser nicht — und das ist in jedem Überlappungsstreifen still falsch.

- [ ] **Schritt 7: Zeit und Speicher**

```bash
curl -sS -o /dev/null -w "%{time_total}\n" -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Gareth","to":"Thorwal"}'
```
Je eine Anfrage mit und ohne Schalter. Der Endpunkt hält heute schon 62 MB, gemessen 152 MB
Spitze; erwartet ist ein Aufschlag von wenigen Prozent (der warme Pfad kostet gemessen ~2 % einer
Route).

- [ ] **Schritt 8: Nach einem Rasterlauf antwortet die erste Route normal schnell**

Rasterlauf drücken, **ohne** Profillauf, dann eine Route. Erwartet: normale Antwortzeit, Faktor
1,0 wo kein Profil steht — **sie füllt nichts nach** (§5.6). Dauert sie merklich länger, füllt
irgendetwas doch im Request, und das ist die Form des Pool-Vorfalls.

- [ ] **Schritt 9: Schalter wieder AUS, und dem Owner vorlegen**

🔧 **DU (Owner):** Der Schalter bleibt **AUS**, bis du das Bild aus Aufgabe 11 gesehen und die
obere Klemme entschieden hast. Dieser Plan schaltet ihn nicht ein.

- [ ] **Schritt 10: Abnahme festhalten und committen**

Die acht Zeilen mit ihrem Ergebnis in `2026-07-29-landschaften-v11-messung.md`, Abschnitt 3.

```bash
git commit --only -- docs/superpowers/plans/2026-07-29-landschaften-v11-messung.md -m "docs(landschaften): V11 acceptance on the live stock -- switch stays OFF pending the owner's decision"
```

---

## Selbstprüfung des Plans

**Spec-Abdeckung.** §1 Entscheide 1–9: 1 → A10, 2 → A3 (der Faktor nimmt `Gebirgspass` nicht aus),
3 → A3 (Klemme unter 1, eigener Test), 4 → A2 (DB statt Datei), 5 → A5 (uint16 = Schritt, keine
Normierung), 6 → **nicht in V11** (A\*, §10), 7 → A2 (`offroad_factor` angelegt, nicht gelesen),
8 → A9a (Anfrage-Schalter) **mit der dokumentierten Abweichung** aus §5.3 (keine Auflösung je
Anfrage), 9 → Zuschnitt. §2 → A5-Kopf. §3 → A2/A5/A6/A7. §4 → A3/A2. §5.0 → A4/A8. §5.1 → A2/A6.
§5.2 → A2/A8. §5.3 → A2 (feste Auflösung). §5.4 → A4. §5.5 → A9a. §5.6 → A8. §5.7 → A6
(`heightmap_cleanup`). §6 → A9b. §7 → A10/A11. §8 → A9a/A9b/A10. §9.1 → A3/A4 (beide
Tabellen vollständig). §9.2 → A12 (alle acht Schritte). §10 → ausdrücklich nicht.
§11 → Aufwand entspricht.

**Bekannte Lücken, benannt statt verschwiegen:**
- §8.2 nennt `terrain_cell_size` als Anfragefeld. Es wird **nicht** gebaut — laut §5.3 stellte es
  nur das A\*-Suchgitter, und A\* ist nicht in V11. Ein Parameter, der nichts tut, ist schlimmer
  als keiner.
- §5.6 sagt „Zeile veraltet → Faktor 1,0", §9.1 sagt „Stempel passt nicht → als veraltet gemeldet,
  Antwort trotzdem geliefert". A9a löst den Widerspruch ausdrücklich: `path_revision`-Abweichung
  verwirft (lokal, selbstheilend), `heightmap_stamp`-Abweichung liefert und meldet (global — sonst
  legt eine Rasteränderung die ganze Karte flach).
- Die Client-Engine (`?clientrouting=1`) bekommt kein Gelände. Live ist der Server primär; die
  Abweichung ist vorbestehend und wird hier nur benannt.

**Typkonsistenz.** `avesmapsTerrainTimeFactor(?float, ?float, float): float` — gleich in A3, A9b.
`avesmapsRouteAttachTerrain(array, array): ?array` — gleich in A9a, A9b.
`avesmapsRouteSliceTerrain(?array, int, int): ?array` — nur A9b. `ecosystemHeightmapGrid(bounds,
cellSize)` liefert `{originX, originY, cellSize, width, height}` — gleich in A5, A7.
`avesmapsTerrainProfileForLine` liefert `ascent/descent/profile/samples` — gleich in A8-Test und
A8-Code. `path_terrain.profile_json` ist überall eine Liste `[ascent, descent]` **je Wegstück**.

---

## Ausführung

**Plan fertig und gespeichert unter
`docs/superpowers/plans/2026-07-29-landschaften-v11-gelaende-reisezeiten.md`.**

Zwei Wege:

1. **Subagenten-getrieben (empfohlen)** — je Aufgabe ein frischer Subagent, Prüfung dazwischen,
   schnelle Runden.
2. **Inline** — die Aufgaben in dieser Sitzung, mit Haltepunkten zur Durchsicht.

Aufgaben 1–9b sind Code und laufen ohne Owner. **Aufgaben 10 Schritt 6, 11 und 12 brauchen den
Owner** (Schalter, Kurve, Klemme) und sind entsprechend markiert.
