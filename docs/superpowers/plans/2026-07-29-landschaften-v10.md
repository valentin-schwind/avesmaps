# Landschaften V10 — „Führt durch" — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus den in V9 gespeicherten Weg×Fläche-Intervallen wird eine lesbare Zeile an vier
Stellen — Routen-Zusammenfassung, Etappenzeile im Planer, Etappen-Infobox und Weg-Infobox —
mit Flora und Fauna darunter.

**Architecture:** Ein öffentlicher POST-Endpunkt nimmt eine Wege-Liste und liefert je Weg
die gedeckten Längen je Landschaft plus einen gemeinsamen Namenskatalog. Im Browser hält ein
Speicher die Antwort je Weg; **ein** reiner Rechner macht daraus eine sortierte Liste, und
drei dünne Schreiber setzen sie in die zwei Tonlagen (Planer ohne Prozente, Infobox mit).
Geholt wird **einmal je Route** beim Zeichnen und **einmal je Weg** beim Öffnen einer
Weg-Infobox, letzteres über einen DOM-Beobachter.

**Tech Stack:** Vanilla JS ohne Build (globale `<script>`-Reihenfolge in `index.html` ist ein
Vertrag), PHP 8 strict + PDO, MySQL. Tests: `node <datei>.test.js` mit `assert`,
`php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring <datei>-test.php`.

**Spec:** `docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md`
**Vorgänger:** V9, `docs/superpowers/specs/2026-07-29-landschaften-v9-vorberechnung-design.md`

## Global Constraints

- **Kein `git add -A`, kein `git add .`, kein `git commit -a`.** Der Arbeitsbaum wird geteilt;
  jeder Commit nennt seine Dateien einzeln (AGENTS.md §9).
- **Commits auf Englisch**, Conventional-Commit-Präfix (`feat`/`fix`/`docs`/`refactor`/`ui`).
  Code-Kommentare Englisch. **Sichtbare UI-Texte bleiben Deutsch** und werden nicht übersetzt
  (AGENTS.md §8).
- **Kein `?v=` von Hand.** Der Deploy stempelt alles, was von `index.html` erreichbar ist.
- **Kein `ASSET_VERSION`-Bump** — V10 fasst keine dynamisch geladenen Editor-Assets an.
- **Keine hartkodierten Farben/Radien.** Nur Tokens aus `css/base/tokens.css` (AGENTS.md §12).
- **Kein DDL, keine `information_schema`-Sonde** in irgendeinem V10-Pfad. V10 liest nur.
- **Kein zweites Quellen-/Namens-System.** Der Anzeigename kommt aus
  `ecosystemRegionDisplayName`; die Regel wird **nicht** in PHP nachgebaut.
- **Nie einen fremden Vorschau-Server stoppen.** Wird einer gebraucht, ein eigener Port.
- **Zahlen aus der Spec sind gegen `ecosystem_revision` 3890 / `map_revision` 46238 gemessen.**
  Vor der Abnahme neu zählen, nicht gegen die Konstante prüfen.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| **neu** `api/_internal/app/path-landscapes.php` | Anfrage-Prüfung (rein) + Leseabfrage (PDO) |
| **neu** `api/app/path-landscapes.php` | HTTP-Hülle: POST, CORS, Not-Aus, Envelope |
| **neu** `api/_internal/app/__tests__/path-landscapes-test.php` | Test des reinen Teils |
| **neu** `js/map-features/map-features-path-landscapes.js` | Rechner + drei Schreiber + Speicher + Abruf + Beobachter |
| **neu** `js/map-features/__tests__/path-landscapes.test.js` | Test von Rechner und Schreibern |
| **neu** `js/map-features/__tests__/lore-key.test.js` | Test der Kommaliste + Zeilenauswahl |
| `js/map-features/map-features-lore.js` | Kommalisten im Schlüssel, `data-lore-kinds` |
| `js/routing/route-plan.js` | drei Einbaustellen + Abruf beim Zeichnen |
| `js/map-features/map-features-path-rendering.js` | Zeile in der Weg-Infobox |
| `index.html` | ein `<script>`, nach `map-features-ecosystem-naming.js` |
| `css/…` | eine Regel für die Landschaftszeile im Planer |

**Warum der Rechner und die Schreiber in EINER Datei liegen:** sie ändern sich zusammen und
sind zusammen unter 250 Zeilen. Der Abruf gehört dazu, weil er nur den Speicher füllt, den
der Rechner liest — eine zweite Datei hätte keine eigene Grenze, nur einen zweiten Namen.

---

## Task 1: Die Leseabfrage (PHP)

**Files:**
- Create: `api/_internal/app/path-landscapes.php`
- Test: `api/_internal/app/__tests__/path-landscapes-test.php`

**Interfaces:**
- Consumes: `avesmapsPathEcosystemStatus(PDO)` aus `api/_internal/app/path-ecosystem.php` (V9)
- Produces:
  - `AVESMAPS_PATH_LANDSCAPES_MAX = 400`
  - `avesmapsPathLandscapesNormalizeRequest(mixed $payload): array` — Liste geprüfter
    `public_id`-Strings; wirft `InvalidArgumentException` bei leer / zu viele / kein Array
  - `avesmapsPathLandscapesRead(PDO $pdo, array $publicIds): array` —
    `['landscapes' => [...], 'paths' => [...]]`
  - `avesmapsPathLandscapesLineLength(array $coordinates): float`

- [ ] **Step 1: Write the failing test**

`api/_internal/app/__tests__/path-landscapes-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the V10 read: request validation and the arc length of a
 * coordinate list. Everything DB-bound is provable only against the live stock -- there is no
 * local MySQL here (api/config.local.php is absent), the same limit path-ecosystem-test.php has.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-landscapes-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../path-landscapes.php';

function pathLandscapesTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

// ---- request validation ------------------------------------------------------------------
$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    '  0166e831-1111-2222-3333-444455556666  ',
]]);
assert(count($ids) === 2, 'both ids survive');
assert($ids[1] === '0166e831-1111-2222-3333-444455556666', 'surrounding blanks are trimmed');

$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
]]);
assert(count($ids) === 1, 'the same way asked for twice is asked for once');

$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => [
    '8a502001-e3bd-5d9b-aae4-cae1a2ab519b',
    "<script>alert('x')</script>",
    '',
    42,
]]);
assert($ids === ['8a502001-e3bd-5d9b-aae4-cae1a2ab519b'],
    'anything that is not a public_id is dropped, not escaped and asked for');

pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => []]),
    'an empty list is a client mistake, not an empty answer'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => 'nope']),
    'paths must be a list'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest([]),
    'a missing paths key is the same mistake'
);
pathLandscapesTestThrows(
    static fn () => avesmapsPathLandscapesNormalizeRequest(['paths' => array_map(
        static fn (int $i) => sprintf('%08x-0000-0000-0000-000000000000', $i),
        range(1, AVESMAPS_PATH_LANDSCAPES_MAX + 1)
    )]),
    'over the ceiling the server refuses -- it never answers a truncated list, '
        . 'because half an answer looks exactly like a whole one'
);
// Exactly at the ceiling is still fine.
$ids = avesmapsPathLandscapesNormalizeRequest(['paths' => array_map(
    static fn (int $i) => sprintf('%08x-0000-0000-0000-000000000000', $i),
    range(1, AVESMAPS_PATH_LANDSCAPES_MAX)
)]);
assert(count($ids) === AVESMAPS_PATH_LANDSCAPES_MAX, 'the ceiling itself is allowed');

// ---- arc length --------------------------------------------------------------------------
assert(abs(avesmapsPathLandscapesLineLength([[0.0, 0.0], [3.0, 4.0]]) - 5.0) < 1e-9,
    'a 3-4-5 triangle');
assert(abs(avesmapsPathLandscapesLineLength([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]) - 2.0) < 1e-9,
    'the pieces add up');
assert(avesmapsPathLandscapesLineLength([[1.0, 1.0]]) === 0.0, 'a single point has no length');
assert(avesmapsPathLandscapesLineLength([]) === 0.0, 'no points, no length');
assert(avesmapsPathLandscapesLineLength([[0.0, 0.0], [0.0, 0.0]]) === 0.0,
    'a way that goes nowhere is length zero, not a division by zero later');

echo "OK: path-landscapes request validation and arc length\n";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-landscapes-test.php
```

Expected: FAIL — `Failed to open stream: ... path-landscapes.php` (die Datei gibt es noch nicht).

- [ ] **Step 3: Write minimal implementation**

`api/_internal/app/path-landscapes.php`:

```php
<?php

declare(strict_types=1);

// V10: the public read behind the „Führt durch" line. It answers ONE question -- which landscapes
// does each of these ways run through, and over how much of its length.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// PURITY CONTRACT (mirrors path-ecosystem.php): side-effect-free on include -- only const and
// function definitions, no DB connect, no headers. The offline-decidable half (request validation,
// arc length) is pure and unit-tested; the DB half takes a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE. This endpoint only reads. The tables are created in the
// editor's write path, and an information_schema probe on a public read is exactly the load that
// saturated the PHP pool on 2026-07-17.

require_once __DIR__ . '/path-ecosystem.php';

// Ways one request may ask about. A measured route (Gareth -> Thorwal) has 45 legs, so this is far
// above anything real -- it exists so a single request stays small however the stock grows. Over the
// ceiling the server REFUSES; it never answers a shortened list, because a half answer to
// „Führt durch" is indistinguishable from a whole one.
const AVESMAPS_PATH_LANDSCAPES_MAX = 400;

/**
 * PURE: validate the request body and hand back the ways worth asking about.
 *
 * Anything that cannot be a public_id is DROPPED, not rejected: between the client building its
 * list and the request arriving, nothing can turn a good id into rubbish, so rubbish means a
 * confused caller, and a confused caller still deserves the answer for its good ids. An EMPTY list
 * is different -- that is a caller asking nothing at all, and answering `{}` would let a bug look
 * like „this route touches no landscape".
 *
 * @return list<string>
 */
function avesmapsPathLandscapesNormalizeRequest(mixed $payload): array
{
    $raw = is_array($payload) ? ($payload['paths'] ?? null) : null;
    if (!is_array($raw)) {
        throw new InvalidArgumentException('paths must be a list of public ids.');
    }
    if (count($raw) > AVESMAPS_PATH_LANDSCAPES_MAX) {
        throw new InvalidArgumentException(
            'paths holds more than ' . AVESMAPS_PATH_LANDSCAPES_MAX . ' entries.'
        );
    }

    $ids = [];
    foreach ($raw as $candidate) {
        if (!is_string($candidate)) {
            continue;
        }
        $trimmed = trim($candidate);
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $trimmed) !== 1) {
            continue;
        }
        $ids[strtolower($trimmed)] = true;
    }
    if ($ids === []) {
        throw new InvalidArgumentException('paths holds no usable public id.');
    }

    return array_keys($ids);
}

/**
 * PURE: arc length of a coordinate list, in MAP UNITS.
 *
 * ⚠️ The same measure as `calculatePathCoordinateDistance` in the browser and as basis 0 in
 * path_ecosystem: plain hypot over the STORED support points. Not the drawn Catmull-Rom curve --
 * that one is longer, and a share measured against it would silently shrink every percentage.
 */
function avesmapsPathLandscapesLineLength(array $coordinates): float
{
    $total = 0.0;
    $count = count($coordinates);
    for ($index = 0; $index < $count - 1; $index++) {
        $from = $coordinates[$index];
        $to = $coordinates[$index + 1];
        if (!is_array($from) || !is_array($to) || count($from) < 2 || count($to) < 2) {
            continue;
        }
        $total += hypot((float) $to[0] - (float) $from[0], (float) $to[1] - (float) $from[1]);
    }

    return $total;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-landscapes-test.php
```

Expected: `OK: path-landscapes request validation and arc length`

- [ ] **Step 5: Add the DB half**

An `api/_internal/app/path-landscapes.php` anhängen:

```php
/**
 * The read itself. Two queries, both bounded by the requested ways:
 *   1. the ways -- their internal id, their geometry (for the length) ;
 *   2. their stored intervals at basis 0, joined up to the region that owns the area.
 *
 * `basis = 0` is not a preference. It is the CHORD, the measure the routing graph and the leg
 * distances use. basis 1 is the drawn curve and belongs to anything drawn -- colouring a stretch,
 * placing a marker. Mixing them would not throw; it would just make every share a little wrong.
 *
 * The region name travels RAW, together with its kind label. Choosing between „Farindelwald" and
 * „Wald" is `ecosystemRegionDisplayName` in the browser -- rebuilding that rule here would be a
 * second copy of it, and the two would drift.
 *
 * @param list<string> $publicIds
 * @return array{landscapes: array<string, array<string, mixed>>, paths: array<string, array<string, mixed>>}
 */
function avesmapsPathLandscapesRead(PDO $pdo, array $publicIds): array
{
    if ($publicIds === []) {
        return ['landscapes' => [], 'paths' => []];
    }

    $placeholders = implode(',', array_fill(0, count($publicIds), '?'));

    $pathStatement = $pdo->prepare(
        "SELECT id, public_id, geometry_json FROM map_features
         WHERE public_id IN ({$placeholders}) AND feature_type = 'path' AND is_active = 1"
    );
    $pathStatement->execute($publicIds);

    $paths = [];
    $publicIdByInternalId = [];
    foreach ($pathStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
        $publicId = (string) $row['public_id'];
        $publicIdByInternalId[(int) $row['id']] = $publicId;
        $paths[$publicId] = [
            'length' => round(avesmapsPathLandscapesLineLength($coordinates), 4),
            'in' => [],
        ];
    }
    if ($publicIdByInternalId === []) {
        return ['landscapes' => [], 'paths' => []];
    }

    $internalIds = array_keys($publicIdByInternalId);
    $idPlaceholders = implode(',', array_fill(0, count($internalIds), '?'));
    $intervalStatement = $pdo->prepare(
        "SELECT pe.path_id,
                r.public_id AS region_public_id,
                r.name AS region_name,
                r.kind AS region_kind,
                r.wiki_region_key,
                r.wiki_url,
                COALESCE(rt.label, '') AS region_type_label,
                SUM(pe.exit_distance_mapunits - pe.enter_distance_mapunits) AS covered
         FROM path_ecosystem pe
         JOIN ecosystem_area a ON a.id = pe.area_id AND a.is_active = 1
         JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
         LEFT JOIN ecosystem_region_type rt ON rt.kind = r.kind AND rt.type_key = r.region_type
         WHERE pe.basis = 0 AND pe.path_id IN ({$idPlaceholders})
         GROUP BY pe.path_id, r.public_id, r.name, r.kind, r.wiki_region_key, r.wiki_url, rt.label"
    );
    $intervalStatement->execute($internalIds);

    $landscapes = [];
    foreach ($intervalStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = $publicIdByInternalId[(int) $row['path_id']] ?? '';
        if ($publicId === '' || !isset($paths[$publicId])) {
            continue;
        }
        $regionId = (string) $row['region_public_id'];
        $landscapes[$regionId] ??= [
            'name' => (string) $row['region_name'],
            'art' => (string) $row['region_type_label'],
            'kind' => (string) $row['region_kind'],
            'wiki_key' => (string) ($row['wiki_region_key'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
        $paths[$publicId]['in'][] = [$regionId, round((float) $row['covered'], 4)];
    }

    return ['landscapes' => $landscapes, 'paths' => $paths];
}
```

> 💣 **Die Aggregation steht im SQL, nicht im PHP.** Ein Weg kann dieselbe Fläche bis zu
> **13-mal** durchqueren (V9 §5.5, Flusswege sind oft selbst die Grenze). Ohne `SUM … GROUP BY`
> kämen 40 Zeilen für einen einzigen Flussweg zurück, und der Client müsste dieselbe Summe
> noch einmal bilden. Und es sind **mehrere Flächen je Region** möglich — deshalb gruppiert
> es über `r.public_id`, nicht über `a.id`.

- [ ] **Step 6: Commit**

```bash
git add api/_internal/app/path-landscapes.php api/_internal/app/__tests__/path-landscapes-test.php
git commit --only -- api/_internal/app/path-landscapes.php api/_internal/app/__tests__/path-landscapes-test.php
```

Commit message:

```
feat(landschaften): read which landscapes a list of ways runs through

The V9 intervals summed per region, at basis 0 -- the chord, the measure the
routing graph and the leg distances use. The region name travels raw next to its
kind label; choosing between "Farindelwald" and "Wald" is the browser's job and
already written down once, in map-features-ecosystem-naming.js.

The sum is in the SQL because a river way crosses the same area up to thirteen
times, and because one region can own several areas.
```

---

## Task 2: Der Endpunkt (PHP)

**Files:**
- Create: `api/app/path-landscapes.php`

**Interfaces:**
- Consumes: `avesmapsPathLandscapesNormalizeRequest`, `avesmapsPathLandscapesRead` (Task 1);
  `avesmapsEcosystemEnabled(PDO)`, `avesmapsReadEcosystemRevision(PDO)` aus
  `api/_internal/app/ecosystem.php`; `avesmapsPathEcosystemStatus(PDO)` aus V9
- Produces: `POST /api/app/path-landscapes.php` mit dem Antwortschema aus Spec §5.2

- [ ] **Step 1: Write the endpoint**

`api/app/path-landscapes.php`:

```php
<?php

declare(strict_types=1);

// V10: which landscapes do these ways run through? Public read behind the „Führt durch" line in the
// route planner, the leg infobox and the way infobox.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// POST /api/app/path-landscapes.php   { "paths": ["<public_id>", …] }
//   -> { ok:true, payload_version:1,
//        stamp:{ computed_at, ecosystem_revision, map_revision, stale:bool } | null,
//        landscapes:{ "<region_public_id>": { name, art, kind, wiki_key, wiki_url } },
//        paths:{ "<path_public_id>": { length: 12.3456, in: [ ["<region_public_id>", 4.21], … ] } } }
//
// 🔴 POST on a READ. Deliberate, and there is a precedent in the same house: POST /api/route/. A
// route of 45 legs is 1.6 KB of ids, and long ones would burst the address line. The price is no
// ETag -- paid knowingly, because the client keeps the answer per WAY and a second route over the
// same road fetches nothing.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/ecosystem.php';
require_once __DIR__ . '/../_internal/app/path-landscapes.php';

const AVESMAPS_PATH_LANDSCAPES_PAYLOAD_VERSION = 1;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load path landscapes.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only POST is allowed for path landscapes.');
    }

    try {
        $publicIds = avesmapsPathLandscapesNormalizeRequest(avesmapsReadJsonRequest());
    } catch (InvalidArgumentException $exception) {
        avesmapsErrorResponse(400, 'paths_invalid', $exception->getMessage());
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 🔴 KILL SWITCH FIRST, exactly as in ecosystem-areas.php. If the owner pulls the Landschaften
    // layer, this line has to vanish with it -- otherwise the layer is "off" and still talking.
    if (!avesmapsEcosystemEnabled($pdo)) {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'payload_version' => AVESMAPS_PATH_LANDSCAPES_PAYLOAD_VERSION,
            'ecosystem_enabled' => false,
            'stamp' => null,
            'landscapes' => (object) [],
            'paths' => (object) [],
        ]);
    }

    // The stamp says WHEN the stored answer was computed and against which revisions. A visitor
    // never sees it; it exists so „why does it still say the old thing?" has an answer that does
    // not need guessing. A missing stamp is a valid state: nothing computed yet -> no line.
    $status = avesmapsPathEcosystemStatus($pdo);
    $stamp = null;
    if (is_array($status['stamp'] ?? null)) {
        $stamp = [
            'computed_at' => (string) $status['stamp']['computed_at'],
            'ecosystem_revision' => (int) $status['stamp']['ecosystem_revision'],
            'map_revision' => (int) $status['stamp']['map_revision'],
            'stale' => $status['stamp']['ecosystem_revision'] !== $status['current']['ecosystem_revision']
                || $status['stamp']['map_revision'] !== $status['current']['map_revision'],
        ];
    }

    $result = $stamp === null
        ? ['landscapes' => [], 'paths' => []]
        : avesmapsPathLandscapesRead($pdo, $publicIds);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'payload_version' => AVESMAPS_PATH_LANDSCAPES_PAYLOAD_VERSION,
        'ecosystem_enabled' => true,
        'stamp' => $stamp,
        // (object) so an empty result is `{}` in JSON, never `[]` -- the client indexes both by key.
        'landscapes' => $result['landscapes'] === [] ? (object) [] : $result['landscapes'],
        'paths' => $result['paths'] === [] ? (object) [] : $result['paths'],
    ]);
} catch (Throwable $exception) {
    // No getMessage() to the client: several edit endpoints leak exception text and that is
    // milestone M1's open bug. A public read does not add to it.
    error_log('path-landscapes failed: ' . $exception->getMessage());
    avesmapsErrorResponse(500, 'path_landscapes_failed', 'Path landscapes could not be read.');
}
```

- [ ] **Step 2: Check the syntax**

```bash
php -l api/app/path-landscapes.php
```

Expected: `No syntax errors detected`

- [ ] **Step 3: Commit**

```bash
git add api/app/path-landscapes.php
git commit --only -- api/app/path-landscapes.php
```

Commit message:

```
feat(landschaften): a public read for the landscapes along a list of ways

POST, like /api/route/ and for the same reason: a route of 45 legs is 1.6 KB of
ids and a long one would burst the address line. The kill switch runs first, so
pulling the Landschaften layer also silences this line instead of leaving it
talking about a layer that is off.
```

---

## Task 3: Der Rechner und die drei Schreiber (JS, rein)

**Files:**
- Create: `js/map-features/map-features-path-landscapes.js`
- Test: `js/map-features/__tests__/path-landscapes.test.js`

**Interfaces:**
- Consumes: `ecosystemRegionDisplayName(name, artLabel)` und
  `isEcosystemRegionAutoName(name, artLabel)` aus `map-features-ecosystem-naming.js`
- Produces:
  - `buildLandscapeLine(pathIds, payload)` → `[{ key, name, art, kind, wikiKey, share }, …]`,
    absteigend nach `share`, unter 0,05 verworfen, gleiche Anzeigenamen verschmolzen
  - `formatLandscapesForInfobox(list)` → `"Weiden · Finsterkamm (84 %)"`
  - `formatLandscapesForPlanner(list)` → `"Weiden, Finsterkamm"`
  - `pickFreshLandscapes(list, previousList)` → Teilliste
  - `landscapeWikiKeyList(list)` → `"weiden,finsterkamm"`

- [ ] **Step 1: Write the failing test**

`js/map-features/__tests__/path-landscapes.test.js`:

```js
const assert = require("assert");
const {
	buildLandscapeLine,
	formatLandscapesForInfobox,
	formatLandscapesForPlanner,
	pickFreshLandscapes,
	landscapeWikiKeyList,
} = require("../map-features-path-landscapes.js");

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// A payload in the exact shape api/app/path-landscapes.php answers with.
const payload = {
	landscapes: {
		"r-weiden": { name: "Weiden", art: "Region", kind: "derographisch", wiki_key: "weiden" },
		"r-finsterkamm": { name: "Finsterkamm", art: "Gebirge", kind: "topographie", wiki_key: "finsterkamm" },
		"r-see-a": { name: "See-042", art: "See", kind: "topographie", wiki_key: "" },
		"r-see-b": { name: "See-107", art: "See", kind: "topographie", wiki_key: "" },
		"r-nameless": { name: "Fläche-011", art: "", kind: "derographisch", wiki_key: "" },
	},
	paths: {
		"p-1": { length: 10, in: [["r-weiden", 10], ["r-finsterkamm", 8.4]] },
		"p-2": { length: 10, in: [["r-weiden", 0.4]] },
		"p-3": { length: 10, in: [["r-see-a", 3], ["r-see-b", 2]] },
		"p-4": { length: 10, in: [["r-nameless", 10]] },
		"p-5": { length: 10, in: [["r-weiden", 10.0004]] },
		"p-6": { length: 0, in: [["r-weiden", 0]] },
		"p-7": { length: 10, in: [["r-gone", 5]] },
		"p-8": { length: 30, in: [["r-finsterkamm", 30]] },
	},
};

// ---- the builder --------------------------------------------------------------------------
let line = buildLandscapeLine(["p-1"], payload);
assert.strictEqual(line.length, 2, "both landscapes of this way");
assert.strictEqual(line[0].name, "Weiden", "the bigger share leads");
near(line[0].share, 1, "the whole way lies in Weiden");
near(line[1].share, 0.84, "and 84 % of it in the Finsterkamm");
assert.strictEqual(line[1].art, "Gebirge", "the kind travels along, for the tooltip");

assert.deepStrictEqual(buildLandscapeLine(["p-2"], payload), [],
	"4 % is below the threshold -- 274 of 3.995 measured hits look like this");

line = buildLandscapeLine(["p-3"], payload);
assert.strictEqual(line.length, 1, "two nameless lakes are ONE entry, not 'See · See'");
assert.strictEqual(line[0].name, "See", "an auto name shows its kind -- the house rule");
near(line[0].share, 0.5, "and their covered lengths add up");

assert.deepStrictEqual(buildLandscapeLine(["p-4"], payload), [],
	"neither a name nor a kind -- there is literally nothing to print");

line = buildLandscapeLine(["p-5"], payload);
near(line[0].share, 1, "rounding may push the sum past the length; the share is capped at 1");

assert.deepStrictEqual(buildLandscapeLine(["p-6"], payload), [],
	"a way of length zero yields no share, and no division by zero");
assert.deepStrictEqual(buildLandscapeLine(["p-7"], payload), [],
	"a region missing from the catalogue is skipped, not crashed on");
assert.deepStrictEqual(buildLandscapeLine(["p-unknown"], payload), [],
	"a way we know nothing about is an empty line, not an error");
assert.deepStrictEqual(buildLandscapeLine([], payload), [], "no ways, no line");
assert.deepStrictEqual(buildLandscapeLine(["p-1"], null), [], "no payload, no line");

// Several ways -- a route, or a water leg made of several ways. Weighted by LENGTH.
line = buildLandscapeLine(["p-1", "p-8"], payload);
assert.strictEqual(line[0].name, "Finsterkamm",
	"8.4 + 30 of 40 beats 10 of 40 -- the longer way carries more weight");
near(line[0].share, 38.4 / 40, "share of the WHOLE distance, not the average of two shares");
near(line[1].share, 10 / 40, "and Weiden covers a quarter of it");

// ---- the writers --------------------------------------------------------------------------
assert.strictEqual(
	formatLandscapesForInfobox(buildLandscapeLine(["p-1"], payload)),
	"Weiden · Finsterkamm (84 %)",
	"100 % carries no number -- it is the median case and would say nothing"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.93 }]),
	"Weiden",
	"0,93 is still 'the whole leg' -- the 90 % rule"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.895 }]),
	"Weiden (90 %)",
	"just under the rule the number returns, rounded"
);
assert.strictEqual(formatLandscapesForInfobox([]), "", "an empty line is empty, not 'keine'");

assert.strictEqual(
	formatLandscapesForPlanner(buildLandscapeLine(["p-1"], payload)),
	"Weiden, Finsterkamm",
	"the planner never prints a percentage and never an article"
);
assert.strictEqual(formatLandscapesForPlanner([]), "", "nothing to say, nothing printed");

// ---- only what is new -----------------------------------------------------------------------
const weiden = [{ name: "Weiden", share: 1 }];
const weidenAndWood = [{ name: "Weiden", share: 1 }, { name: "Reichsforst", share: 0.2 }];
assert.deepStrictEqual(pickFreshLandscapes(weiden, []).map((e) => e.name), ["Weiden"],
	"the first row names everything");
assert.deepStrictEqual(pickFreshLandscapes(weiden, weiden), [],
	"the same names as the row above -- say nothing");
assert.deepStrictEqual(pickFreshLandscapes(weidenAndWood, weiden).map((e) => e.name), ["Reichsforst"],
	"only the one that joined");
assert.deepStrictEqual(pickFreshLandscapes(weiden, weidenAndWood), [],
	"leaving a landscape is not announced -- only entering one is");
assert.deepStrictEqual(pickFreshLandscapes(weidenAndWood, null).map((e) => e.name),
	["Weiden", "Reichsforst"], "no predecessor at all is the same as an empty one");

// ---- the lore key ---------------------------------------------------------------------------
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-1"], payload)), "weiden,finsterkamm",
	"one comma list -> ONE lore request for the whole leg");
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-3"], payload)), "",
	"a landscape without a wiki key contributes nothing");

console.log("OK: path-landscapes builder, writers and the fresh-only rule");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node js/map-features/__tests__/path-landscapes.test.js
```

Expected: FAIL — `Cannot find module '../map-features-path-landscapes.js'`

- [ ] **Step 3: Write the module (builder + writers only)**

`js/map-features/map-features-path-landscapes.js`:

```js
// V10: „Führt durch" -- which landscapes a leg, a route or a single way runs through.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// 🔴 ONE calculation, three writers. The planner and the infobox say the same thing in two
// tones -- the planner narrates (bare names, no percentages, only what is new), the infobox
// proves (shares, „·"). Both read the SAME list out of buildLandscapeLine. A second calculation
// „for the planner" would drift from this one the first time a rule changes.
//
// ⚠️ Weighted by the `length` the endpoint ships, never by the planner's leg distance in miles.
// They are proportional -- until a water leg merges several ways into ONE entry with one distance
// and several lengths. Mixing them there would multiply miles by map units.

"use strict";

// Below this share a landscape is not named. Calibrated against the live stock (2026-07-29,
// ecosystem_revision 3890): 5 % drops 274 of 3.995 hits, 3 % would drop 167, 10 % would drop 426.
// The curve is flat here -- there is no edge the choice tips over, which is why it is a round number.
var AVESMAPS_LANDSCAPE_MIN_SHARE = 0.05;

// At or above this the share is not printed. The MEDIAN share is 100 % -- without this rule most
// lines would end in „(100 %)", and the number would stop carrying information.
var AVESMAPS_LANDSCAPE_FULL_SHARE = 0.9;

// The naming rule lives in map-features-ecosystem-naming.js and is NOT rebuilt here: an auto name
// („Wald-001") is internal bookkeeping and a reader gets the kind instead („Wald"). index.html
// loads that file at 2168, long before this one.
function avesmapsLandscapeNaming() {
	if (typeof module !== "undefined" && module.exports) {
		return require("./map-features-ecosystem-naming.js");
	}
	return {
		isEcosystemRegionAutoName: typeof isEcosystemRegionAutoName === "function" ? isEcosystemRegionAutoName : null,
		ecosystemRegionDisplayName: typeof ecosystemRegionDisplayName === "function" ? ecosystemRegionDisplayName : null,
	};
}

// What a reader should see -- or "" when there is nothing to print. A region with neither a name
// nor a kind („Fläche-011") is the only case that vanishes: 395 of 3.995 measured hits, and none
// of them has anything to say.
function avesmapsLandscapeDisplayName(entry) {
	var naming = avesmapsLandscapeNaming();
	var name = String((entry && entry.name) || "").trim();
	var art = String((entry && entry.art) || "").trim();
	var isAuto = naming.isEcosystemRegionAutoName
		? naming.isEcosystemRegionAutoName(name, art)
		: false;
	if (art === "" && (name === "" || isAuto)) {
		return "";
	}
	return naming.ecosystemRegionDisplayName
		? naming.ecosystemRegionDisplayName(name, art)
		: (name || art);
}

// The one calculation. `pathIds` is a list of way public ids -- one for a leg or a way infobox,
// forty-five for a route. `payload` is exactly what api/app/path-landscapes.php answers.
function buildLandscapeLine(pathIds, payload) {
	var paths = (payload && payload.paths) || null;
	var landscapes = (payload && payload.landscapes) || null;
	if (!paths || !landscapes || !pathIds || !pathIds.length) {
		return [];
	}

	var totalLength = 0;
	var covered = {};   // display name -> { entry, covered }
	pathIds.forEach(function (pathId) {
		var path = paths[pathId];
		if (!path || !(Number(path.length) > 0)) {
			return;
		}
		totalLength += Number(path.length);
		(path.in || []).forEach(function (pair) {
			var region = landscapes[pair && pair[0]];
			if (!region) {
				return;   // catalogue and assignment disagree -- skip, never guess a name
			}
			var name = avesmapsLandscapeDisplayName(region);
			if (name === "") {
				return;
			}
			// Two nameless lakes along one leg are ONE entry: „See", not „See · See".
			var bucket = covered[name] || (covered[name] = {
				key: String(pair[0]),
				name: name,
				art: String(region.art || ""),
				kind: String(region.kind || ""),
				wikiKey: String(region.wiki_key || ""),
				covered: 0,
			});
			bucket.covered += Math.max(0, Number(pair[1]) || 0);
		});
	});
	if (!(totalLength > 0)) {
		return [];
	}

	return Object.keys(covered).map(function (name) {
		var bucket = covered[name];
		return {
			key: bucket.key,
			name: bucket.name,
			art: bucket.art,
			kind: bucket.kind,
			wikiKey: bucket.wikiKey,
			// Capped: rounding on the server can push a full-length cover a hair past the length.
			share: Math.min(1, bucket.covered / totalLength),
		};
	}).filter(function (entry) {
		return entry.share >= AVESMAPS_LANDSCAPE_MIN_SHARE;
	}).sort(function (left, right) {
		return right.share - left.share || left.name.localeCompare(right.name, "de");
	});
}

// Infobox tone: shares, „·" as the separator. The separator is not a comma on purpose -- these
// names are not the parts of one whole (a leg can be 100 % in Darpatien AND 68 % in the
// Reichsforst, they are overlapping layers), and a comma would sit too close to the bracket.
function formatLandscapesForInfobox(list) {
	return (list || []).map(function (entry) {
		return entry.share >= AVESMAPS_LANDSCAPE_FULL_SHARE
			? entry.name
			: entry.name + " (" + Math.round(entry.share * 100) + " %)";
	}).join(" · ");
}

// Planner tone: bare names, comma separated, never a percentage.
// 💣 And never an article. „durch den Reichsforst" is right, but gender is in no field -- das Herz
// des Kontinents, die Flusslande, der Farindelwald, and Weiden with none at all. A guessed article
// would be visibly wrong German on about a third of the names. The caller writes „durch: " in
// front, and a colon expects no article.
function formatLandscapesForPlanner(list) {
	return (list || []).map(function (entry) { return entry.name; }).join(", ");
}

// Only what the row above did not already say. Entering a landscape is announced, leaving it is
// not -- that is what makes the plan read like a journey instead of stuttering: measured on
// Gareth -> Thorwal, 16 of 31 labelled rows were word for word their predecessor.
function pickFreshLandscapes(list, previousList) {
	var seen = {};
	(previousList || []).forEach(function (entry) { seen[entry.name] = true; });
	return (list || []).filter(function (entry) { return !seen[entry.name]; });
}

// The comma list api/app/lore.php takes for „give me the flora of all these places at once".
function landscapeWikiKeyList(list) {
	return (list || []).map(function (entry) { return entry.wikiKey; })
		.filter(Boolean).join(",");
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_LANDSCAPE_MIN_SHARE,
		AVESMAPS_LANDSCAPE_FULL_SHARE,
		buildLandscapeLine,
		formatLandscapesForInfobox,
		formatLandscapesForPlanner,
		pickFreshLandscapes,
		landscapeWikiKeyList,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node js/map-features/__tests__/path-landscapes.test.js
```

Expected: `OK: path-landscapes builder, writers and the fresh-only rule`

- [ ] **Step 5: Commit**

```bash
git add js/map-features/map-features-path-landscapes.js js/map-features/__tests__/path-landscapes.test.js
git commit --only -- js/map-features/map-features-path-landscapes.js js/map-features/__tests__/path-landscapes.test.js
```

Commit message:

```
feat(landschaften): one calculation for the "Führt durch" line, three writers over it

The planner narrates and the infobox proves, but both read the same sorted list.
A second calculation for the planner's toneless variant would drift from this one
the first time a rule changed.

An unnamed area shows its kind ("Wald") through the rule that was already written
down in map-features-ecosystem-naming.js; only an area with neither name nor kind
disappears, because there is nothing to print. Two nameless lakes along one leg
are one entry, not "See · See".
```

---

## Task 4: Speicher, Abruf und der Beobachter (JS)

**Files:**
- Modify: `js/map-features/map-features-path-landscapes.js` (anhängen)
- Modify: `index.html` (ein `<script>`)

**Interfaces:**
- Consumes: `buildLandscapeLine` (Task 3), `POST /api/app/path-landscapes.php` (Task 2)
- Produces:
  - `avesmapsPathLandscapesEnsure(pathIds)` → `Promise<payload>` — holt nur, was fehlt
  - `avesmapsPathLandscapesPayload()` → der zusammengeführte Speicher (für `buildLandscapeLine`)
  - `avesmapsPathLandscapesLineFor(pathIds)` → Kurzform für `buildLandscapeLine(ids, store)`
  - Beobachter füllt jedes `[data-path-landscapes]:not([data-path-landscapes-loaded])`

- [ ] **Step 1: Append the store and the fetch**

An `js/map-features/map-features-path-landscapes.js` anhängen:

```js
// ---- the store ------------------------------------------------------------------------------
// Kept per WAY, not per route: two routes over the same Reichsstraße fetch it once. Thrown away
// when the stamp changes revision -- a stored answer is a SNAPSHOT of the last time the editor
// pressed „Zugehörigkeit rechnen", and a snapshot that quietly outlives its facts is worse than
// none. Memory only, no localStorage: the stock moves with every editor run, and 2 KB is cheaper
// to fetch again than a day-old answer is to trust.
var AVESMAPS_PATH_LANDSCAPES_URL = "api/app/path-landscapes.php";
var AVESMAPS_PATH_LANDSCAPES_TIMEOUT_MS = 8000;
var AVESMAPS_PATH_LANDSCAPES_CHUNK = 400;   // matches AVESMAPS_PATH_LANDSCAPES_MAX on the server

var avesmapsPathLandscapesStore = { landscapes: {}, paths: {}, stamp: null, pending: {} };

function avesmapsPathLandscapesPayload() {
	return avesmapsPathLandscapesStore;
}

function avesmapsPathLandscapesLineFor(pathIds) {
	return buildLandscapeLine(pathIds, avesmapsPathLandscapesStore);
}

function avesmapsPathLandscapesReset() {
	avesmapsPathLandscapesStore = { landscapes: {}, paths: {}, stamp: null, pending: {} };
}

function avesmapsPathLandscapesMerge(data) {
	if (!data || data.ok !== true) {
		return;
	}
	var stamp = data.stamp || null;
	var known = avesmapsPathLandscapesStore.stamp;
	// A new computation invalidates everything held so far -- keeping half of an old answer next
	// to half of a new one would be a line nobody could reproduce.
	if (known && stamp && (known.ecosystem_revision !== stamp.ecosystem_revision
		|| known.map_revision !== stamp.map_revision)) {
		avesmapsPathLandscapesReset();
	}
	avesmapsPathLandscapesStore.stamp = stamp;
	Object.keys(data.landscapes || {}).forEach(function (key) {
		avesmapsPathLandscapesStore.landscapes[key] = data.landscapes[key];
	});
	Object.keys(data.paths || {}).forEach(function (key) {
		avesmapsPathLandscapesStore.paths[key] = data.paths[key];
	});
}

function avesmapsPathLandscapesPost(pathIds) {
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var timer = controller
		? window.setTimeout(function () { controller.abort(); }, AVESMAPS_PATH_LANDSCAPES_TIMEOUT_MS)
		: null;
	return fetch(AVESMAPS_PATH_LANDSCAPES_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ paths: pathIds }),
		signal: controller ? controller.signal : undefined,
	}).then(function (response) {
		if (timer) { window.clearTimeout(timer); }
		return response.ok ? response.json() : null;
	}).then(function (data) {
		avesmapsPathLandscapesMerge(data);
		return data;
	}).catch(function () {
		// A network error must not take the route plan with it: the line is a decoration on a
		// panel whose numbers are all computed locally. Same rule as the lore section.
		return null;
	});
}

// Fetches only the ways not already held, in server-sized chunks. NEVER truncates: a shortened
// „Führt durch" looks exactly like a complete one.
function avesmapsPathLandscapesEnsure(pathIds) {
	var missing = (pathIds || []).filter(function (pathId) {
		return pathId
			&& !avesmapsPathLandscapesStore.paths[pathId]
			&& !avesmapsPathLandscapesStore.pending[pathId];
	});
	// Duplicates inside one route (the same way twice) must not be asked for twice.
	missing = missing.filter(function (pathId, index) { return missing.indexOf(pathId) === index; });
	if (!missing.length) {
		return Promise.resolve(avesmapsPathLandscapesStore);
	}

	missing.forEach(function (pathId) { avesmapsPathLandscapesStore.pending[pathId] = true; });
	var chunks = [];
	for (var index = 0; index < missing.length; index += AVESMAPS_PATH_LANDSCAPES_CHUNK) {
		chunks.push(missing.slice(index, index + AVESMAPS_PATH_LANDSCAPES_CHUNK));
	}
	return Promise.all(chunks.map(avesmapsPathLandscapesPost)).then(function () {
		missing.forEach(function (pathId) {
			delete avesmapsPathLandscapesStore.pending[pathId];
			// A way the server did not answer for gets an empty record, so it is not asked for
			// again on every popup: „no landscapes here" is a valid answer, and 2.813 of 5.655
			// ways give it.
			if (!avesmapsPathLandscapesStore.paths[pathId]) {
				avesmapsPathLandscapesStore.paths[pathId] = { length: 0, in: [] };
			}
		});
		return avesmapsPathLandscapesStore;
	});
}
```

- [ ] **Step 2: Append the observer**

Weiter an dieselbe Datei:

```js
// ---- the observer ---------------------------------------------------------------------------
// 💣 THE FETCH DOES NOT START WHEN THE MARKUP IS BUILT. bindPopup gets finished HTML for every one
// of 5.655 ways while the map is still assembling -- a fetch at that point would be 5.655
// simultaneous requests, which is the 2026-07-21 pool incident word for word. A container is
// filled only once it actually stands in the DOM, i.e. once a popup was really opened.
//
// The route planner does NOT go through here: it fetches once when a route is drawn, which is a
// user action that happens exactly once and covers all its legs in one request.
function avesmapsPathLandscapesFillPending() {
	var pending = document.querySelectorAll("[data-path-landscapes]:not([data-path-landscapes-loaded])");
	for (var index = 0; index < pending.length; index++) {
		var element = pending[index];
		element.setAttribute("data-path-landscapes-loaded", "1");   // mark first: no double fetch
		(function (container) {
			var pathId = container.getAttribute("data-path-landscapes") || "";
			if (!pathId) {
				return;
			}
			avesmapsPathLandscapesEnsure([pathId]).then(function () {
				var line = avesmapsPathLandscapesLineFor([pathId]);
				if (!line.length) {
					return;   // nothing to say -- the row stays absent, no „keine Angabe"
				}
				container.innerHTML = avesmapsPathLandscapesRowMarkup(line);
			});
		})(element);
	}
}

// ONE infobox row in the house format (.region-info-box__row + dt/dd), so it lines up with
// von/bis/Distanz/Reisezeit instead of standing beside them. The kind is the title tooltip:
// „Finsterkamm" then says „Gebirge" on hover, which answers „does this way run through a
// mountain range" without making the line longer.
function avesmapsPathLandscapesRowMarkup(line) {
	var escape = typeof escapeHtml === "function" ? escapeHtml : function (value) { return String(value); };
	var names = line.map(function (entry) {
		var text = entry.share >= AVESMAPS_LANDSCAPE_FULL_SHARE
			? entry.name
			: entry.name + " (" + Math.round(entry.share * 100) + " %)";
		return entry.art
			? '<span title="' + escape(entry.art) + '">' + escape(text) + "</span>"
			: escape(text);
	}).join(" · ");
	return '<div class="region-info-box__row"><dt>Führt durch</dt><dd>' + names + "</dd></div>";
}

if (typeof document !== "undefined" && !document.__avesmapsPathLandscapesObserverBound) {
	document.__avesmapsPathLandscapesObserverBound = true;
	var avesmapsPathLandscapesScanQueued = false;
	var avesmapsPathLandscapesScheduleScan = function () {
		if (avesmapsPathLandscapesScanQueued) {
			return;
		}
		avesmapsPathLandscapesScanQueued = true;
		window.setTimeout(function () {
			avesmapsPathLandscapesScanQueued = false;
			avesmapsPathLandscapesFillPending();
		}, 0);
	};
	if (typeof MutationObserver === "function") {
		new MutationObserver(avesmapsPathLandscapesScheduleScan)
			.observe(document.documentElement, { childList: true, subtree: true });
	}
	avesmapsPathLandscapesScheduleScan();
}
```

- [ ] **Step 3: Verify the module still parses and the tests still pass**

```bash
node -e "require('./js/map-features/map-features-path-landscapes.js'); console.log('module loads in node')"
node js/map-features/__tests__/path-landscapes.test.js
```

Expected: `module loads in node`, dann `OK: path-landscapes builder, writers and the fresh-only rule`

> Wenn `document` in Node fehlschlägt: der Beobachter-Block steht hinter
> `typeof document !== "undefined"` — er darf in Node gar nicht laufen. Schlägt es doch
> fehl, ist die Wache falsch gesetzt, nicht der Test.

- [ ] **Step 4: Add the script tag**

In `index.html` **direkt nach** der Zeile mit `map-features-ecosystem-naming.js` einfügen:

```html
		<script src="js/map-features/map-features-path-landscapes.js"></script>
```

Grund für genau diese Stelle: die Datei ruft `ecosystemRegionDisplayName` und
`isEcosystemRegionAutoName` auf (Naming, 2168) und wird ihrerseits von
`map-features-path-rendering.js` (2226) und `route-plan.js` (2274) gebraucht.

- [ ] **Step 5: Check the load order did not break a harness**

```bash
node js/map-features/__tests__/adventure-links-render.test.js
node js/map-features/__tests__/citymaps-render.test.js
node js/routing/__tests__/create-graph-connectivity.test.js
```

Expected: alle drei laufen wie zuvor durch. (V9 musste sechs Gerüste nachziehen, weil sie die
Reihenfolge aus `index.html` nachbilden — `c914234b`, `15af1250`.)

- [ ] **Step 6: Commit**

```bash
git add js/map-features/map-features-path-landscapes.js index.html
git commit --only -- js/map-features/map-features-path-landscapes.js index.html
```

Commit message:

```
feat(landschaften): hold the landscape answer per way, and fetch it lazily

The store is keyed by way, not by route, so a second route over the same road
fetches nothing. A new stamp throws the whole store away: half an old answer next
to half a new one would be a line nobody could reproduce.

The observer exists for one reason. bindPopup gets finished HTML for every one of
5.655 ways while the map is still assembling; a fetch built into that markup would
be the 2026-07-21 pool incident again. The planner does not go through here -- it
fetches once per drawn route.
```

---

## Task 5: Kommalisten und Zeilenauswahl im Lore-Modul

**Files:**
- Modify: `js/map-features/map-features-lore.js:91` (`avesmapsLoreNormalizeKey`) und `:302`
  (`avesmapsLoreFillContainers`) und `:417` (`buildLoreMarkup`)
- Test: `js/map-features/__tests__/lore-key.test.js`

**Interfaces:**
- Produces: `avesmapsLoreNormalizeKey` akzeptiert `"a,b"`; `buildLoreMarkup({..., kinds})`
  schreibt `data-lore-kinds`; `avesmapsLoreFillContainers` respektiert es

- [ ] **Step 1: Write the failing test**

`js/map-features/__tests__/lore-key.test.js`:

```js
// map-features-lore.js is a browser file without module.exports (it is loaded by a <script>
// tag). The harness evaluates it with a minimal document/window stub, the same way the other
// render harnesses in this folder do.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-lore.js"), "utf8");

const elements = [];
function makeElement(attributes) {
	const own = Object.assign({}, attributes);
	return {
		innerHTML: "",
		getAttribute: (name) => (name in own ? own[name] : null),
		setAttribute: (name, value) => { own[name] = value; },
	};
}

const context = {
	console,
	window: {
		location: { search: "" },
		localStorage: { getItem: () => null, setItem: () => {} },
		setTimeout: (fn) => fn(),
		clearTimeout: () => {},
	},
	document: {
		querySelectorAll: (selector) => elements.filter((entry) => entry.matches(selector))
			.map((entry) => entry.element),
		addEventListener: () => {},
		documentElement: {},
	},
	fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
	MutationObserver: function () { this.observe = () => {}; },
	AbortController: function () { this.abort = () => {}; this.signal = null; },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

// ---- the key ---------------------------------------------------------------------------------
const normalize = context.avesmapsLoreNormalizeKey;
assert.strictEqual(normalize("darpatien"), "darpatien", "a single key is untouched");
assert.strictEqual(normalize("darpatien,reichsforst"), "darpatien,reichsforst",
	"a comma list survives -- api/app/lore.php has taken them since 2026-07-21");
assert.strictEqual(normalize("darpatien, reichsforst"), "darpatien,reichsforst",
	"blanks around the comma are trimmed");
assert.strictEqual(normalize("Darpatien,REICHSFORST"), "darpatien,reichsforst", "lower cased");
assert.strictEqual(normalize("darpatien,,"), "darpatien", "empty parts are dropped");
assert.strictEqual(normalize("darpatien,<script>"), "darpatien",
	"the bad part falls, the good one stays -- one broken name must not silence the whole leg");
assert.strictEqual(normalize("<script>"), "", "nothing usable -> no key, no request");
assert.strictEqual(normalize("wiki:darpatien"), "darpatien", "the wiki: prefix is still stripped");
assert.strictEqual(normalize(""), "", "empty stays empty");
assert.strictEqual(normalize(null), "", "null stays empty");

// ---- the row selection -------------------------------------------------------------------------
const data = {
	ok: true,
	total: 3,
	sections: {
		ware: [{ name: "Garether Bier", wiki_url: "", rank: 0 }],
		fauna: [{ name: "Waldwolf", wiki_url: "", rank: 0 }],
		flora: [{ name: "Blautanne", wiki_url: "", rank: 0 }],
	},
	counts: { ware: 1, fauna: 1, flora: 1 },
};

const settlement = makeElement({ "data-lore-place": "punin" });
elements.push({ element: settlement, matches: (s) => s.indexOf('"punin"') >= 0 });
context.avesmapsLoreFillContainers("punin", "Punin", data);
assert.ok(settlement.innerHTML.indexOf("Waren") >= 0,
	"a settlement keeps its goods row -- the leg's choice must not have taken it along");
assert.ok(settlement.innerHTML.indexOf("Fauna") >= 0 && settlement.innerHTML.indexOf("Flora") >= 0,
	"and its fauna and flora");

const leg = makeElement({ "data-lore-place": "leg-1", "data-lore-kinds": "flora|fauna" });
elements.push({ element: leg, matches: (s) => s.indexOf('"leg-1"') >= 0 });
context.avesmapsLoreFillContainers("leg-1", "Etappe", data);
assert.strictEqual(leg.innerHTML.indexOf("Waren"), -1,
	"a leg shows no goods row (owner 2026-07-29: „Flora und Fauna is richtig")');
assert.ok(leg.innerHTML.indexOf("Fauna") >= 0 && leg.innerHTML.indexOf("Flora") >= 0,
	"but both of the two it should");

console.log("OK: lore comma keys and the per-container row selection");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node js/map-features/__tests__/lore-key.test.js
```

Expected: FAIL bei `normalize("darpatien,reichsforst")` — die Zeichenklasse kennt heute kein Komma.

> ⚠️ Läuft das Gerüst schon vorher nicht (Stub unvollständig), **erst den Stub reparieren**.
> Ein Gerüst, das aus dem falschen Grund rot ist, beweist nichts.

- [ ] **Step 3: Widen the key**

`js/map-features/map-features-lore.js`, `avesmapsLoreNormalizeKey` (Zeile 91) ersetzen durch:

```js
// Ein Schlüssel -- oder mehrere, kommagetrennt. api/app/lore.php nimmt Listen schon
// entgegen (es teilt selbst an Kommas) und avesmapsLoreFetch reicht sie durch; nur
// hier fielen sie bisher durch, weil die Zeichenklasse kein Komma kannte. V10 braucht
// das: eine Etappe hat mehrere Landschaften und soll EINEN Abruf auslösen, nicht drei.
//
// 💣 Jeder Teil wird EINZELN geprüft, und ein schlechter Teil verwirft nur sich selbst.
// „darpatien,<script>" wird „darpatien" -- ein kaputter Name darf nicht die Flora der
// ganzen Etappe verstummen lassen.
function avesmapsLoreNormalizeKey(raw) {
	var parts = String(raw == null ? "" : raw).split(",");
	var keys = [];
	for (var index = 0; index < parts.length; index++) {
		var key = parts[index].trim().toLowerCase();
		if (key.indexOf("wiki:") === 0) {
			key = key.slice(5);
		}
		if (key.indexOf("name:") === 0) {
			key = key.slice(5);
		}
		if (/^[a-z0-9_-]{1,190}$/.test(key) && keys.indexOf(key) < 0) {
			keys.push(key);
		}
	}
	return keys.join(",");
}
```

- [ ] **Step 4: Honour `data-lore-kinds`**

In `avesmapsLoreFillContainers` (Zeile 302) die Schleife über `AVESMAPS_LORE_ROWS` ersetzen:

```js
		// Welche Zeilen dieser Container zeigen will. Ohne Angabe: alle -- die Siedlungs-
		// Infobox ändert sich dadurch nicht.
		// 💣 NICHT AVESMAPS_LORE_ROWS ANFASSEN. Die Liste steht auf Modulebene und speist
		// AUCH die Siedlungs-Infobox; wer die Waren dort herausnimmt, nimmt sie überall
		// heraus, und niemand sieht den Zusammenhang. Die Auswahl gehört an den Container.
		var wanted = "";
		for (var containerIndex = 0; containerIndex < containers.length; containerIndex++) {
			wanted = containers[containerIndex].getAttribute("data-lore-kinds") || wanted;
		}
		var wantedKinds = wanted ? wanted.split("|") : null;
		AVESMAPS_LORE_ROWS.forEach(function (row) {
			if (wantedKinds && wantedKinds.indexOf(row.kind) < 0) {
				return;
			}
			markup += avesmapsLoreInfoRowMarkup(
				row,
				data.sections[row.kind] || [],
				(data.counts && data.counts[row.kind]) || 0,
				placeKey,
				row.kind === "ware" ? goodsLead : null
			);
		});
```

- [ ] **Step 5: Carry `kinds` through `buildLoreMarkup`**

In `buildLoreMarkup` (Zeile 417) das zurückgegebene Markup um ein Attribut ergänzen:

```js
	// Welche Arten dieser Container zeigen soll („flora|fauna" an einer Routen-Etappe).
	// Leer = alle, also unverändert für jede bestehende Aufrufstelle.
	var kinds = String((placeRef && placeRef.kinds) || "");

	return '<div class="avesmaps-lore-rows" data-lore-place="' + avesmapsLoreEscape(containerKey)
		+ '" data-lore-fetch="' + avesmapsLoreEscape(key)
		+ '" data-lore-name="' + avesmapsLoreEscape(name)
		+ '" data-lore-kinds="' + avesmapsLoreEscape(kinds)
		+ '" data-lore-goods="' + avesmapsLoreEscape(goods)
		+ '" data-lore-titles="' + avesmapsLoreEscape(titles) + '"></div>';
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node js/map-features/__tests__/lore-key.test.js
```

Expected: `OK: lore comma keys and the per-container row selection`

- [ ] **Step 7: Commit**

```bash
git add js/map-features/map-features-lore.js js/map-features/__tests__/lore-key.test.js
git commit --only -- js/map-features/map-features-lore.js js/map-features/__tests__/lore-key.test.js
```

Commit message:

```
feat(lore): take several places in one key, and let a container pick its rows

api/app/lore.php has taken comma lists since it was written, and avesmapsLoreFetch
passes them through -- only the key normaliser dropped them, because its character
class knew no comma. A route leg has several landscapes and should cost one request,
not three. A broken part now discards only itself.

The row selection sits on the container, never on AVESMAPS_LORE_ROWS: that list also
feeds the settlement infobox, and taking Waren out of it would take them out
everywhere with nothing to show the connection.
```

---

## Task 6: Die drei Einbaustellen im Routenplaner

**Files:**
- Modify: `js/routing/route-plan.js` — `buildRouteLegPopupHtml` (196), `showRoutePlan` (523),
  Etappenzeile (560), Zusammenfassungskasten (597)
- Modify: `css/` — eine Regel für die Landschaftszeile (Datei in Schritt 4 bestimmt)

**Interfaces:**
- Consumes: `avesmapsPathLandscapesEnsure`, `avesmapsPathLandscapesLineFor`,
  `formatLandscapesForInfobox`, `formatLandscapesForPlanner`, `pickFreshLandscapes`,
  `landscapeWikiKeyList` (Tasks 3+4); `buildLoreMarkup` mit `kinds` (Task 5)

- [ ] **Step 1: Add a helper that turns leg entries into way ids**

In `js/routing/route-plan.js` **vor** `buildRouteLegPopupHtml` einfügen:

```js
// Die Weg-Kennungen einer Etappe. Eine Etappe ist immer ein GANZER Weg (der Graph legt je Weg
// genau eine Kante an, addRegularPathToGraph) -- aber eine Wasser-Etappe fasst mehrere Wege zu
// EINEM Eintrag zusammen, deshalb eine Liste und keine einzelne Kennung.
function routeEntryPathIds(entry, segments) {
	return (entry?.segmentIndexes || [])
		.map((segmentIndex) => String(segments?.[segmentIndex]?.properties?.public_id
			|| segments?.[segmentIndex]?.properties?.id || ""))
		.filter(Boolean);
}
```

- [ ] **Step 2: The leg infobox row**

In `buildRouteLegPopupHtml` **nach** der Reisezeit-Zeile (`rows += row(tr("planner.summary.travelTime"…)`)
einfügen:

```js
	// „Führt durch" (V10). Die Daten liegen bereits im Speicher: der Abruf lief einmal, als die
	// Route gezeichnet wurde -- eine Etappen-Infobox kann gar nicht aufgehen, bevor es eine Route
	// gibt. Deshalb hier synchron und ohne Container, anders als in der Weg-Infobox.
	let loreMarkup = "";
	if (typeof avesmapsPathLandscapesLineFor === "function") {
		const landscapes = avesmapsPathLandscapesLineFor(routeEntryPathIds(entry, currentRouteSegments));
		if (landscapes.length) {
			const names = landscapes.map((landscape) => {
				const text = formatLandscapesForInfobox([landscape]);
				return landscape.art
					? `<span title="${escapeHtml(landscape.art)}">${escapeHtml(text)}</span>`
					: escapeHtml(text);
			}).join(" · ");
			rows += `<div class="region-info-box__row"><dt>${tr("planner.leg.through", "Führt durch")}</dt><dd>${names}</dd></div>`;
			// Flora und Fauna der genannten Landschaften -- EIN Abruf für alle zusammen, und
			// ausdrücklich ohne die Waren-Zeile (Owner 2026-07-29).
			const wikiKeys = landscapeWikiKeyList(landscapes);
			if (wikiKeys && typeof buildLoreMarkup === "function") {
				loreMarkup = buildLoreMarkup({ key: wikiKeys, name: title, kinds: "flora|fauna" });
			}
		}
	}
```

und die Rückgabe von `actionsMarkup` um `loreMarkup` erweitern:

```js
		actionsMarkup: `<div class="region-info-box region-info-box--settlement"><dl class="region-info-box__data">${rows}${loreMarkup}</dl></div>`,
```

> ⚠️ `currentRouteSegments` muss existieren. Gibt es die Variable nicht, in `showRoutePlan`
> ein `currentRouteSegments = segments;` neben `currentRoutePlanEntries = planEntries;`
> setzen und oben bei den übrigen Modul-Variablen deklarieren — **nicht** die Segmente durch
> jeden Aufrufer reichen.

- [ ] **Step 3: The planner rows and the summary**

In `showRoutePlan`, **nach** `currentRoutePlanEntries = planEntries;`:

```js
	currentRouteSegments = segments;
	// V10: EIN Abruf für die ganze Route, hier und nicht im Markup. Das Zeichnen einer Route ist
	// eine Nutzeraktion, die genau einmal stattfindet -- 45 Etappen kosten eine Anfrage, und jede
	// danach geöffnete Etappen-Infobox kostet keine mehr.
	if (typeof avesmapsPathLandscapesEnsure === "function") {
		const routePathIds = planEntries.flatMap((entry) => routeEntryPathIds(entry, segments));
		if (routePathIds.length) {
			void avesmapsPathLandscapesEnsure(routePathIds).then(() => {
				fillRoutePlanLandscapes(planEntries, segments);
			});
		}
	}
```

In der Etappenzeile (`$overview.append`) einen leeren Platzhalter ergänzen — **direkt vor**
dem schließenden `</div>`:

```html
			<span class="route-plan-entry__landscapes" data-route-landscapes-index="${entryIndex}"></span>
```

Im Zusammenfassungskasten (`$overview.prepend`) **zwischen** Rastzeit und Gesamtzeit:

```js
			<span class="route-plan-summary__landscapes"></span>
```

Und die Füllfunktion **nach** `showRoutePlan` einfügen:

```js
// Füllt die Landschaftszeilen, sobald der Abruf da ist. Ein Durchgang über alle Etappen IN
// REIHENFOLGE, weil „nur nennen, was neu ist" die Vorgängerzeile braucht.
//
// 💣 Eine Etappe OHNE Daten setzt das Gedächtnis NICHT zurück. Nur 34 % der Wegstrecke liegt
// überhaupt in einer Fläche -- „leer" heißt hier fast immer NOCH NICHT GEZEICHNET, nicht
// „draußen". Zurückzusetzen machte aus einer Lücke im Bestand eine Ankündigung („du betrittst
// das Herz des Kontinents"), die nie stattfand.
function fillRoutePlanLandscapes(planEntries, segments) {
	if (typeof avesmapsPathLandscapesLineFor !== "function") {
		return;
	}
	let previous = [];
	planEntries.forEach((entry, entryIndex) => {
		const line = avesmapsPathLandscapesLineFor(routeEntryPathIds(entry, segments));
		const target = document.querySelector(`[data-route-landscapes-index="${entryIndex}"]`);
		if (!line.length) {
			return;   // Gedächtnis bleibt stehen, Zeile bleibt leer
		}
		const fresh = pickFreshLandscapes(line, previous);
		previous = line;
		if (target && fresh.length) {
			target.textContent = `${tr("planner.leg.through.short", "durch")}: ${formatLandscapesForPlanner(fresh)}`;
		}
	});

	// Die Routen-Zeile: dieselbe Rechnung über ALLE Wege, nach Anteil sortiert, ohne Prozente.
	const summaryTarget = document.querySelector(".route-plan-summary__landscapes");
	const routeLine = avesmapsPathLandscapesLineFor(
		planEntries.flatMap((entry) => routeEntryPathIds(entry, segments))
	);
	if (summaryTarget && routeLine.length) {
		summaryTarget.innerHTML = `<br>${escapeHtml(tr("planner.summary.landscapes", "Landschaften"))}: `
			+ escapeHtml(formatLandscapesForPlanner(routeLine));
	}
}
```

- [ ] **Step 4: Add the CSS**

Die Datei finden, die `.route-plan-entry` stylt, und dort anhängen:

```bash
grep -rn "route-plan-entry" css/ | head -5
```

Dann in derselben Datei:

```css
/* V10: die Landschaftszeile einer Etappe. Eigene Zeile, damit sie den Fluss der
   Etappenbeschreibung nicht zerreisst; leiser als der Rest, weil sie Beiwerk ist. */
.route-plan-entry__landscapes:not(:empty) {
	display: block;
	margin-top: 0.25em;
	color: var(--color-text-muted);
	font-size: 0.9em;
}
```

> 💣 **Kein Literal.** Gibt es `--color-text-muted` nicht, **erst** in `css/base/tokens.css`
> das passende vorhandene Token heraussuchen (`grep -n "muted\|secondary" css/base/tokens.css`)
> und dessen Namen verwenden — nie einen Hexwert schreiben (AGENTS.md §12).

- [ ] **Step 5: Verify in the browser**

```bash
grep -n "route-plan-entry__landscapes\|route-plan-summary__landscapes" js/routing/route-plan.js
```

Dann den Vorschau-Server dieser Sitzung starten (`preview_start`), Gareth → Thorwal planen und
prüfen: elf Namen ohne Prozente oben, neun Zeilen mit `durch:` in der Liste, und im
Netzwerk-Register **eine** Anfrage an `path-landscapes.php`.

- [ ] **Step 6: Commit**

```bash
git add js/routing/route-plan.js css/<datei-aus-schritt-4>.css
git commit --only -- js/routing/route-plan.js css/<datei-aus-schritt-4>.css
```

Commit message:

```
feat(routenplaner): the route and its legs say which landscapes they run through

Three places, two tones. The summary and the leg rows print bare names -- and a leg
row names only what the row above it did not, which turns 31 near-identical rows
into 9 on a measured Gareth->Thorwal. The leg infobox keeps the shares.

One fetch per drawn route covers all of it, so opening a leg infobox afterwards
costs nothing.
```

---

## Task 7: Die Weg-Infobox

**Files:**
- Modify: `js/map-features/map-features-path-rendering.js:99` (`createPathPopupMarkup`)

**Interfaces:**
- Consumes: der Beobachter aus Task 4 (`data-path-landscapes`)

- [ ] **Step 1: Add the lazy container**

In `createPathPopupMarkup`, im `actionsMarkup`-Block **nach** den Knöpfen, einen Container
einfügen:

```js
			// V10 „Führt durch": ein LEERER, markierter Container -- hier wird NICHT geladen.
			// Dieses Markup entsteht für alle 5.655 Wege beim Kartenaufbau (bindPopup bekommt
			// fertiges HTML); ein Abruf an dieser Stelle wären 5.655 gleichzeitige Anfragen.
			// Der Beobachter in map-features-path-landscapes.js füllt ihn, sobald der Container
			// wirklich im DOM steht -- also erst, wenn jemand die Infobox geöffnet hat.
			const landscapeContainer = `<div class="region-info-box region-info-box--settlement"><dl class="region-info-box__data" data-path-landscapes="${escapeHtml(getPathPublicId(path))}"></dl></div>`;
```

und ihn an das zurückgegebene `actionsMarkup` anhängen.

- [ ] **Step 2: Verify in the browser**

Vorschau öffnen, **ohne** eine Route zu planen einen Weg auf der Karte anklicken. Erwartung:
im Netzwerk-Register **eine** Anfrage an `path-landscapes.php`, und beim Kartenaufbau vorher
**null**.

- [ ] **Step 3: Commit**

```bash
git add js/map-features/map-features-path-rendering.js
git commit --only -- js/map-features/map-features-path-rendering.js
```

Commit message:

```
feat(wege): a way's infobox says which landscapes it runs through

An empty marked container, filled by the observer once the popup is really open.
Not a fetch in the markup: this markup is built for all 5.655 ways while the map
is still assembling.
```

---

## Task 8: Abnahme am Livebestand

**Files:** keine — dieser Task schreibt nur das Ergebnis auf.

- [ ] **Step 1: Deploy and wait**

```bash
git push
```

Danach ~1–2 min warten und die entfernte SHA prüfen:

```bash
git ls-remote origin master
```

- [ ] **Step 2: Probe the endpoint once**

```bash
curl -s --compressed -X POST -H "Content-Type: application/json" -d '{"paths":["8a502001-e3bd-5d9b-aae4-cae1a2ab519b"]}' "https://avesmaps.de/api/app/path-landscapes.php"
```

Erwartung: `{"ok":true,"payload_version":1,"ecosystem_enabled":true,"stamp":{…},"landscapes":{…},"paths":{…}}`

> ⚠️ **Eine Anfrage, keine Schleife.** STRATO ist geteilter Boden; eine Sonde reicht.

- [ ] **Step 3: Walk the seven acceptance steps from Spec §8.3**

1. Gareth → Thorwal: elf Namen in der Routen-Zeile, **ohne** Prozente.
2. Etappenliste: neun beschriftete Zeilen, zwölf Nennungen, keine zwei gleichen untereinander.
3. Etappen-Infobox: „Führt durch" mit Prozenten, vollständig; darunter **Flora und Fauna, keine
   Waren**; **eine** Anfrage an `lore.php` für beide Landschaften zusammen.
4. **Siedlung öffnen (Gegenprobe):** Waren, Fauna, Flora unverändert.
5. Netzwerk: **eine** Anfrage an `path-landscapes.php` je Route; ein zweites Etappen-Popup
   erzeugt keine.
6. Kartenaufbau ohne Route: **null** Anfragen.
7. Weg anklicken: eine Anfrage, danach keine mehr für denselben Weg.

> ⚠️ **Die Zahlen vorher neu rechnen.** Die Erwartungen stehen gegen `ecosystem_revision` 3890
> und `map_revision` 46238. Ist der Bestand gewachsen, sind es andere Zahlen — das Verfahren
> gilt, die Konstante nicht. Nachrechnen wie in der Spec: je eine Anfrage an
> `ecosystem-areas.php`, `map-features.php` und `POST /api/route/`, danach offline mit
> `js/map-features/map-features-ecosystem-path-assign.js` in Node.

- [ ] **Step 4: Report to the owner**

Ergebnis jedes der sieben Schritte, mit den tatsächlich gesehenen Zahlen — nicht mit den
erwarteten. Weicht etwas ab, **erst** die Ursache benennen, dann fragen.

---

## Self-Review

**1. Spec-Abdeckung**

| Spec | Task |
|---|---|
| §2 vier Anzeigeflächen | 6 (drei) + 7 (Weg-Infobox) |
| §3.1 Sortierung, 5-%-Schwelle, Tooltip | 3 (Rechner), 4 (Tooltip im Zeilen-Markup), 6 |
| §3.1a Prozente, 90-%-Regel, `·` | 3 (`formatLandscapesForInfobox`) |
| §3.1b `durch:`, Kommas, kein Artikel | 3 (`formatLandscapesForPlanner`) + 6 |
| §3.1c nur was neu ist, leere Etappe | 3 (`pickFreshLandscapes`) + 6 (`fillRoutePlanLandscapes`) |
| §3.2 Name sonst Art, Verschmelzen | 3 (`avesmapsLandscapeDisplayName`, Bucket je Anzeigename) |
| §3.3 überlagernde Ebenen | 3 (`kind` reist mit, keine Normierung) |
| §5.2 Endpunkt, POST, 400er-Decke, roher Name | 1 + 2 |
| §5.3 einmal je Route, Beobachter am Weg | 4 + 6 + 7 |
| §5.4 Speicher je Weg, Stempelwechsel verwirft | 4 (`avesmapsPathLandscapesMerge`) |
| §5.5 Schnappschuss, kein Stempel → keine Zeile | 2 (`$stamp === null`) |
| §6.1 nur Flora und Fauna, `AVESMAPS_LORE_ROWS` unangetastet | 5 |
| §6.2 Kommaliste, ein Abruf | 5 + 6 |
| §8.1/8.2 Tests | 1, 3, 5 |
| §8.3 Abnahme | 8 |

**2. Platzhalter** — keine. Zwei Stellen sind bewusst *ermittelt statt geraten*: die
CSS-Datei (Task 6, Schritt 4 hat den `grep`, der sie bestimmt) und `currentRouteSegments`
(Task 6, Schritt 2 sagt, was zu tun ist, falls es die Variable nicht gibt). Beide nennen den
Befund-Weg, nicht ein „TODO".

**3. Typkonsistenz** — `buildLandscapeLine` liefert `{key, name, art, kind, wikiKey, share}`;
alle drei Schreiber lesen nur `name`, `share` und (für den Tooltip) `art`. `avesmapsPathLandscapes*`
ist der Präfix aller Speicherfunktionen, `formatLandscapesFor*` der der Schreiber. Die
Payload-Form `{landscapes, paths:{id:{length,in:[[key,covered]]}}}` ist in Task 1 (PHP), Task 3
(Test-Fixture) und Task 4 (Speicher) identisch.
