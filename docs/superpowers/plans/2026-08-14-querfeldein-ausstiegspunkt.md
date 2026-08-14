# Querfeldein-Ausstiegspunkt — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Querfeldein-Etappe verlässt das Wegenetz an dem Punkt **auf einem Weg**, der die günstigste Gesamtreise ergibt — statt immer an der nächsten Ortschaft.

**Architecture:** Der vorhandene Fußpunkt-Sammler (`avesmapsCollectNearestClientLandPathAnchors`) bekommt eine Entdopplung pro Weg. Der Teiler wird aus `avesmapsAnchorClientWaypointToLandPath` herausgelöst, entfernt künftig die Ursprungskante und vergibt seine Knotennamen aus dem Graphen statt aus einem Zähler. Die beiden Erzeuger netzferner Anbindungen (Kartenpunkt, Wegpunkt ohne Weganbindung) bieten dem Dijkstra dann bis zu sechs Fußpunkte an statt einer Ortschaftenliste bzw. eines einzigen Fußpunkts.

**Tech Stack:** PHP 8, keine Bibliotheken. Tests sind `assert()`-Skripte ohne Framework. Entwurf: `docs/superpowers/specs/2026-08-14-querfeldein-ausstiegspunkt-design.md`.

## Global Constraints

- **Rein serverseitig.** Es gibt keinen Client-Zwilling des Ankers. `js/` wird nicht angefasst.
- **Der Anker-Knotenname bleibt `__wp_anchor_<Ziffern>`.** `js/map-features/map-features.js:236` beschriftet genau dieses Muster als „Kreuzung", `js/routing/route-engine.js:324` schlägt es bewusst nicht im Ortsbestand nach. Ziffern, kein anderer Suffix.
- **Kommentare, Commit-Meldungen und Doku auf Deutsch** in dieser Dateifamilie (der Bestand in `api/_internal/routing/` ist durchgehend deutsch kommentiert); `error.code`-Werte bleiben englisch und unverändert.
- **K = 6** (`AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT`), eine Konstante für beide Erzeuger.
- **Kein bestehender `error.code` und kein bestehender Antworttext ändert sich.**
- **Geteilter Arbeitsbaum:** niemals `git add -A`/`git add .`. Nur die im Task genannten Pfade einzeln stagen; fremde geänderte Dateien in Ruhe lassen.
- **Vor jedem Push das GANZE Testfeld**, nicht nur die eigenen Tests:
  - PHP: `for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll "$t"; done`
  - JS: `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`
  - ⚠️ `api/_internal/linkcheck/__tests__/link-url-test.php` ist auf diesem Rechner **vorher schon rot** (er löst einen echten DNS-Namen auf). Er ist kein Regressionssignal; alles andere muss grün sein.
- **STRATO:** Live-Proben immer als **eine** Anfrage, nie in einer Schleife.

---

### Task 1: Der Sammler entdoppelt pro Weg

**Files:**
- Create: `api/_internal/routing/__tests__/anchor-candidates-test.php`
- Modify: `api/_internal/routing/client-graph.php:849-894` (`avesmapsCollectNearestClientLandPathAnchors`)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces: `avesmapsCollectNearestClientLandPathAnchors(array $graph, float $px, float $py, int $limit): array` — Signatur unverändert. **Neue Zusicherung:** höchstens ein Eintrag je Wege-`id`, aufsteigend nach `distance`. Eintragsschlüssel unverändert: `from`, `to`, `connection`, `segment_index`, `t`, `proj_x`, `proj_y`, `distance`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/routing/__tests__/anchor-candidates-test.php`:

```php
<?php
// api/_internal/routing/__tests__/anchor-candidates-test.php
declare(strict_types=1);

/**
 * Die Fusspunkt-Kandidaten einer Querfeldein-Anbindung.
 * Entwurf: docs/superpowers/specs/2026-08-14-querfeldein-ausstiegspunkt-design.md
 *
 * 💣 DIE ENTDOPPLUNG IST DER ANGELPUNKT, NICHT EIN DETAIL. Ohne sie liegen die K naechsten
 * Fusspunkte alle auf demselben Weg, ein paar Karteneinheiten auseinander -- K A*-Laeufe fuer
 * praktisch denselben Ausstieg, und die schnelle Strasse zwei Taeler weiter waere nie im Angebot.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';
// ⚠️ avesmapsPrepareRouteAreas() wohnt in land-areas.php, NICHT in water-areas.php (das
// client-graph.php ohnehin zieht). Ohne diese Zeile faellt Abschnitt G mit „undefined function".
require __DIR__ . '/../land-areas.php';

$road = static function (array &$graph, string $from, string $to, array $points, string $id): void {
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $id, 'path_id' => $id, 'from' => $from, 'to' => $to,
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    // 💣 Beide Richtungen teilen EIN Objekt, wie im echten Graphen (client-graph.php:411-413).
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};

// ============================================================ A. ein Kandidat je Weg

// Ein naher Weg mit VIER Segmenten und ein ferner Weg. Ohne Entdopplung fuellen die acht
// Projektionen des nahen Weges (vier Segmente x zwei Richtungen) die Liste, und der ferne Weg
// faellt heraus -- obwohl er die eigentliche Alternative waere.
$graph = [];
$road($graph, 'A', 'B', [[0.0, 0.0], [2.0, 0.0], [4.0, 0.0], [6.0, 0.0], [8.0, 0.0]], 'path-nah');
$road($graph, 'C', 'D', [[0.0, 20.0], [8.0, 20.0]], 'path-fern');

$candidates = avesmapsCollectNearestClientLandPathAnchors($graph, 4.0, 3.0, 6);
$ids = array_map(static fn(array $c): string => (string) $c['connection']['id'], $candidates);
assert(count($candidates) === 2, 'zwei Wege, zwei Kandidaten: ' . count($candidates));
assert($ids === ['path-nah', 'path-fern'],
    'aufsteigend nach Entfernung, jeder Weg einmal: ' . implode(',', $ids));
assert(count(array_unique($ids)) === count($ids), 'kein Weg steht doppelt in der Liste');

// Und der Fusspunkt liegt wirklich auf dem Weg, nicht auf einem seiner Endknoten.
assert(abs($candidates[0]['proj_x'] - 4.0) < 1e-9, 'Fusspunkt x: ' . $candidates[0]['proj_x']);
assert(abs($candidates[0]['proj_y'] - 0.0) < 1e-9, 'Fusspunkt y: ' . $candidates[0]['proj_y']);
assert(abs($candidates[0]['distance'] - 3.0) < 1e-9, 'Entfernung: ' . $candidates[0]['distance']);

// ============================================================ B. der Deckel bleibt ein Deckel

$graph2 = [];
for ($i = 0; $i < 9; $i++) {
    $y = 10.0 + $i;
    $road($graph2, 'S' . $i, 'T' . $i, [[0.0, $y], [8.0, $y]], 'path-' . $i);
}
$limited = avesmapsCollectNearestClientLandPathAnchors($graph2, 4.0, 0.0, 6);
assert(count($limited) === 6, 'nie mehr als der Deckel: ' . count($limited));
$limitedIds = array_map(static fn(array $c): string => (string) $c['connection']['id'], $limited);
assert($limitedIds[0] === 'path-0', 'und der naechste zuerst: ' . $limitedIds[0]);

// ============================================================ C. Nicht-Landwege bleiben draussen

$graph3 = [];
$road($graph3, 'A', 'B', [[0.0, 30.0], [8.0, 30.0]], 'path-land');
$fluss = [
    'route_type' => 'Flussweg', 'id' => 'path-fluss', 'from' => 'E', 'to' => 'F',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 1.0], [8.0, 1.0]]],
];
avesmapsAddClientCompatibleGraphConnection($graph3, 'E', 'F', $fluss);
avesmapsAddClientCompatibleGraphConnection($graph3, 'F', 'E', $fluss);
$dritte = avesmapsCollectNearestClientLandPathAnchors($graph3, 4.0, 0.0, 6);
assert(count($dritte) === 1, 'nur der Landweg zaehlt: ' . count($dritte));
assert((string) $dritte[0]['connection']['id'] === 'path-land', 'und zwar er: ' . $dritte[0]['connection']['id']);

echo "OK anchor-candidates-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
```

Erwartet: `AssertionError: zwei Wege, zwei Kandidaten: 6` — Abschnitt A fällt, weil alle sechs Plätze vom nahen Weg belegt sind.

- [ ] **Schritt 3: Den Sammler umbauen**

`api/_internal/routing/client-graph.php` — der Rumpf von `avesmapsCollectNearestClientLandPathAnchors` (heute Zeilen 849-894) wird vollständig ersetzt:

```php
function avesmapsCollectNearestClientLandPathAnchors(array $graph, float $px, float $py, int $limit): array {
    if ($limit <= 0) return [];
    // 💣 EIN KANDIDAT JE WEG, sonst ist die Auswahl eine Attrappe: die naechsten Fusspunkte liegen
    // alle auf demselben Weg, ein paar Karteneinheiten auseinander -- lauter A*-Laeufe fuer
    // praktisch denselben Ausstieg, und die schnelle Strasse zwei Taeler weiter waere nie dabei.
    // Erst die Entdopplung macht aus „K Punkte" ein „K Strassen zur Auswahl".
    // ⚠️ Sie faengt zugleich ab, dass jede Verbindung ZWEIMAL im Graphen steht: beide Richtungen
    // teilen ein Objekt (client-graph.php:411-413), ohne sie stuende jeder Weg doppelt in der Liste.
    $best = [];
    foreach ($graph as $fromName => $edges) {
        if (!is_array($edges)) continue;
        foreach ($edges as $toName => $connections) {
            if (!is_array($connections)) continue;
            foreach ($connections as $connection) {
                if (!is_array($connection)) continue;
                if (!in_array((string) ($connection['route_type'] ?? ''), AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES, true)) continue;
                $coordinates = $connection['geometry']['coordinates'] ?? null;
                if (!is_array($coordinates)) continue;
                $pathKey = (string) ($connection['id'] ?? ($fromName . '->' . $toName));
                $count = count($coordinates);
                for ($i = 0; $i < $count - 1; $i++) {
                    $projection = avesmapsRouteProjectPointOnSegment(
                        $px, $py,
                        (float) ($coordinates[$i][0] ?? 0.0), (float) ($coordinates[$i][1] ?? 0.0),
                        (float) ($coordinates[$i + 1][0] ?? 0.0), (float) ($coordinates[$i + 1][1] ?? 0.0)
                    );
                    if (isset($best[$pathKey]) && (float) $best[$pathKey]['distance'] <= $projection['distance']) continue;
                    // Die GESPEICHERTE Orientierung, nicht die Iterationsschluessel: beide Richtungen
                    // teilen ein Objekt, und mit dem vertauschten Namen haengte der Split die
                    // Teilstuecke an die falschen Enden -- die gezeichnete Etappe spraenge zum
                    // fernen Knoten.
                    $best[$pathKey] = [
                        'from' => (string) ($connection['from'] ?? $fromName),
                        'to' => (string) ($connection['to'] ?? $toName),
                        'connection' => $connection,
                        'segment_index' => $i,
                        't' => $projection['t'],
                        'proj_x' => $projection['x'],
                        'proj_y' => $projection['y'],
                        'distance' => $projection['distance'],
                    ];
                }
            }
        }
    }

    $candidates = array_values($best);
    usort($candidates, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);

    return array_slice($candidates, 0, $limit);
}
```

⚠️ **Die alte Abbruchschranke (`$worst`) entfällt ersatzlos, und das ist kein Rückschritt.** Sie sparte nie eine Projektion, nur das Einsortieren; die Projektion lief für jedes Segment ohnehin. Die Karte kostet dafür O(1) je Segment statt einer Einfügung in eine sortierte Liste. Bezahlt wird einmal am Ende mit einer Sortierung über die Zahl der Landwege (~5.900) — Millisekunden, und der Aufruf kommt höchstens fünfmal je Anfrage vor.

- [ ] **Schritt 4: Test laufen lassen, jetzt grün**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
```

Erwartet: `OK anchor-candidates-test`

- [ ] **Schritt 5: Die drei bestehenden Aufrufer prüfen**

Der Einzel-Anker hat Testaufrufer, die auf der alten Reihenfolge stehen könnten:

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/water-bridge-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/synthetic-distance-report-test.php
```

Erwartet: beide grün. Sind sie rot, ist es **kein** Anlass, den Test anzupassen — dann liefert der Sammler eine andere Reihenfolge als vorher, und das gehört verstanden, bevor es weitergeht.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/routing/client-graph.php api/_internal/routing/__tests__/anchor-candidates-test.php
git commit -m "feat(routing): der Fusspunkt-Sammler liefert einen Kandidaten je Weg statt K auf demselben"
```

---

### Task 2: Der Teiler wird herausgelöst und räumt hinter sich auf

**Files:**
- Modify: `api/_internal/routing/client-graph.php` (neue Konstante + zwei neue Funktionen; `avesmapsAnchorClientWaypointToLandPath:909-975` wird zum Aufrufer)
- Modify: `api/_internal/routing/detour.php:409-419` (`avesmapsRemoveClientRouteConnection` **umziehen**, keine Kopie)
- Modify: `api/_internal/routing/__tests__/anchor-candidates-test.php` (Abschnitte D-F)

**Interfaces:**
- Consumes: `avesmapsCollectNearestClientLandPathAnchors(...)` aus Task 1.
- Produces:
  - `const AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX = '__wp_anchor_';`
  - `const AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT = 6;`
  - `avesmapsAllocateClientAnchorIndex(array $graph): int`
  - `avesmapsSplitClientPathAtAnchor(array &$graph, array $anchor, int $anchorIndex): string` — liefert den Knotennamen, an dem angebunden wird.
  - `avesmapsRemoveClientRouteConnection(array &$graph, string $fromNode, string $toNode, string $connectionId): void` — jetzt in `client-graph.php`, Signatur unverändert.

- [ ] **Schritt 1: Die fehlschlagenden Tests schreiben**

An `anchor-candidates-test.php` anhängen, vor der `echo`-Zeile:

```php
// ============================================================ D. der Fusspunkt teilt den Weg

$graph4 = [];
$road($graph4, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$anker = avesmapsCollectNearestClientLandPathAnchors($graph4, 4.0, 3.0, 6)[0];
$index = avesmapsAllocateClientAnchorIndex($graph4);
assert($index === 0, 'der erste freie Index ist 0: ' . $index);
$knoten = avesmapsSplitClientPathAtAnchor($graph4, $anker, $index);
assert($knoten === '__wp_anchor_0', 'der Knotenname traegt Ziffern, wie das JS ihn liest: ' . $knoten);
assert(isset($graph4['A']['__wp_anchor_0']), 'die erste Haelfte haengt an A');
assert(isset($graph4['__wp_anchor_0']['B']), 'die zweite Haelfte haengt an B');

// 🔴 UND DIE URSPRUNGSKANTE IST WEG. Bliebe sie, saehe der Sammler des naechsten Endpunkts den
// ungeteilten Weg erneut und teilte ihn ein zweites Mal -- zwei Fusspunkte nebeneinander auf
// demselben Weg, ohne Verbindung untereinander.
assert(!isset($graph4['A']['B']), 'A->B ist ersetzt, nicht ergaenzt');
assert(!isset($graph4['B']['A']), 'und zwar in beiden Richtungen');

// ============================================================ E. zwei Anker ergeben eine Kette

$zweiter = avesmapsCollectNearestClientLandPathAnchors($graph4, 8.0, 3.0, 6)[0];
$index2 = avesmapsAllocateClientAnchorIndex($graph4);
assert($index2 === 1, 'der naechste freie Index kommt aus dem Graphen: ' . $index2);
$knoten2 = avesmapsSplitClientPathAtAnchor($graph4, $zweiter, $index2);
assert($knoten2 === '__wp_anchor_1', 'zweiter Knoten: ' . $knoten2);

// 💣 DIE KETTE IST DER GANZE PUNKT. Die beiden Fusspunkte muessen DIREKT aneinander haengen --
// haengen sie stattdessen beide nur an A und B, laeuft die Reise zwischen ihnen ueber den
// gemeinsamen Endknoten zurueck.
assert(isset($graph4['__wp_anchor_0']['__wp_anchor_1']) || isset($graph4['__wp_anchor_1']['__wp_anchor_0']),
    'die beiden Fusspunkte sind direkt verbunden');

// ============================================================ E2. Fusspunkt auf einem Endknoten

// ⚠️ Faellt die Projektion auf einen Endknoten, gibt es nichts zu teilen -- dann muss der Teiler
// DIESEN Knoten liefern und den Graphen in Ruhe lassen. Ohne den Fall entstuende ein Anker-Knoten
// auf demselben Punkt wie eine Ortschaft, mit einer Kante der Laenge null daneben.
$graph4b = [];
$road($graph4b, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$aufKnoten = avesmapsCollectNearestClientLandPathAnchors($graph4b, -3.0, 0.0, 6)[0];
assert(abs((float) $aufKnoten['t']) < 1e-7 && (int) $aufKnoten['segment_index'] === 0,
    'die Projektion liegt auf dem Anfangsknoten: t=' . $aufKnoten['t']);
$knotenName = avesmapsSplitClientPathAtAnchor($graph4b, $aufKnoten, 0);
assert($knotenName === 'A', 'der Endknoten selbst kommt zurueck: ' . $knotenName);
assert(!isset($graph4b['__wp_anchor_0']), 'und es entsteht kein Anker-Knoten');
assert(isset($graph4b['A']['B']), 'die Strasse bleibt ungeteilt');

// ============================================================ F. eine halbe Haelfte teilt nicht

// ⚠️ Ein Anker mit einem Segmentindex hinter dem letzten Segment kann aus dem Sammler nicht kommen;
// die Schutzbedingung im Teiler faengt ihn trotzdem ab. Ohne sie bliebe nach dem Entfernen eine
// LUECKE in der Strasse -- und die sucht niemand.
$graph5 = [];
$road($graph5, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$kaputt = [
    'from' => 'A', 'to' => 'B',
    'connection' => $graph5['A']['B'][0],
    'segment_index' => 5, 't' => 0.5, 'proj_x' => 4.0, 'proj_y' => 0.0, 'distance' => 3.0,
];
avesmapsSplitClientPathAtAnchor($graph5, $kaputt, 0);
assert(isset($graph5['A']['B']), 'ohne zwei vollstaendige Haelften bleibt die Ursprungskante stehen');
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
```

Erwartet: `Error: Call to undefined function avesmapsAllocateClientAnchorIndex()`

- [ ] **Schritt 3: `avesmapsRemoveClientRouteConnection` umziehen**

Die Funktion steht heute in `detour.php:409-419`. Sie wird **verschoben**, nicht kopiert — `client-graph.php` darf nichts aus `detour.php` aufrufen (`detour.php` → `offroad-leg.php` → `client-graph.php`, die Abhängigkeit läuft nur in eine Richtung).

In `detour.php` den Block ersatzlos löschen und an seine Stelle setzen:

```php
// avesmapsRemoveClientRouteConnection() ist am 14.08.2026 nach client-graph.php gewandert: der
// Teiler dort braucht sie ebenfalls, und die Abhaengigkeit laeuft nur in eine Richtung
// (detour.php -> offroad-leg.php -> client-graph.php). Zwei Abschriften derselben Graph-Operation
// waeren zwei Abschriften zu viel.
```

In `client-graph.php` unmittelbar hinter `avesmapsAddClientCompatibleGraphConnection` einfügen:

```php
/** Eine Kante beider Richtungen wieder aus dem Graphen nehmen, an ihrer ID erkannt. */
function avesmapsRemoveClientRouteConnection(array &$graph, string $fromNode, string $toNode, string $connectionId): void
{
    foreach ([[$fromNode, $toNode], [$toNode, $fromNode]] as [$a, $b]) {
        if (!isset($graph[$a][$b]) || !is_array($graph[$a][$b])) { continue; }
        $graph[$a][$b] = array_values(array_filter(
            $graph[$a][$b],
            static fn(array $connection): bool => (string) ($connection['id'] ?? '') !== $connectionId
        ));
        if ($graph[$a][$b] === []) { unset($graph[$a][$b]); }
    }
}
```

- [ ] **Schritt 4: Konstanten, Namensvergabe und Teiler bauen**

In `client-graph.php` neben `AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES` (Zeile 29):

```php
// 🔴 ZIFFERN, KEIN ANDERER SUFFIX. js/map-features/map-features.js:236 beschriftet genau
// `__wp_anchor_\d+` als „Kreuzung", js/routing/route-engine.js:324 schlaegt dasselbe Muster
// bewusst NICHT im Ortsbestand nach. Ein sprechenderer Name kostet beide Stellen.
const AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX = '__wp_anchor_';
// Wie viele Fusspunkte einem netzfernen Endpunkt hoechstens angeboten werden. Nach der
// Entdopplung sind das sechs VERSCHIEDENE Wege -- mehr echte Auswahl als die zwoelf Ortschaften,
// die der Kartenpunkt bis zum 14.08.2026 bekam, und weniger A*-Laeufe.
const AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT = 6;
```

Und hinter `avesmapsCollectNearestClientLandPathAnchors`:

```php
/**
 * PURE: der naechste freie Anker-Index in DIESEM Graphen.
 *
 * 💣 KEIN ZAEHLER IM MODUL. Zwei Erzeuger vergeben Anker-Namen (der Wegpunkt-Anker und die
 * Kartenpunkt-Anbindung); ein statischer Zaehler waere verborgener Zustand, den jeder Test
 * zuruecksetzen muesste und den zu vergessen erst live auffiele. Der Graph weiss selbst, welche
 * Namen vergeben sind, und die Suche ist eine Handvoll isset() je Anker.
 */
function avesmapsAllocateClientAnchorIndex(array $graph): int {
    $index = 0;
    while (isset($graph[AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX . $index])) { $index++; }
    return $index;
}

/**
 * Teilt den Weg eines Ankers an seinem Fusspunkt und liefert den Knoten, an dem dort angebunden
 * wird. Faellt der Fusspunkt auf einen Endknoten, wird nicht geteilt und dieser Endknoten kommt
 * zurueck -- der Aufrufer haengt seine Querfeldein-Kante dann direkt dorthin.
 *
 * 🔴 DIE URSPRUNGSKANTE WIRD ENTFERNT, sobald beide Haelften stehen. Bis zum 14.08.2026 blieb sie
 * liegen; bei EINEM Anker je Anfrage war das harmlos. Bei mehreren nicht: der Sammler des naechsten
 * Endpunkts saehe den ungeteilten Weg erneut, teilte ihn ein zweites Mal, und die beiden Fusspunkte
 * haengen nebeneinander am selben Weg OHNE Verbindung untereinander -- die Reise zwischen ihnen
 * liefe ueber den gemeinsamen Endknoten zurueck.
 *
 * 💣 „Sobald beide Haelften stehen" ist die Bedingung, nicht die Beschreibung. Faellt eine Haelfte
 * weg, bliebe nach dem Entfernen eine LUECKE in der Strasse. Lieber eine ueberfluessige Dopplung
 * als ein Netz, das an einer Stelle reisst, die niemand sucht.
 */
function avesmapsSplitClientPathAtAnchor(array &$graph, array $anchor, int $anchorIndex): string {
    $original = $anchor['connection'] ?? null;
    $fromName = (string) ($anchor['from'] ?? '');
    $toName = (string) ($anchor['to'] ?? '');
    $coordinates = is_array($original) ? ($original['geometry']['coordinates'] ?? []) : [];
    if (!is_array($coordinates) || count($coordinates) < 2) return $fromName;

    $count = count($coordinates);
    $i = (int) ($anchor['segment_index'] ?? 0);
    $t = (float) ($anchor['t'] ?? 0.0);
    $projX = (float) ($anchor['proj_x'] ?? 0.0);
    $projY = (float) ($anchor['proj_y'] ?? 0.0);
    $epsilon = 1e-7;

    if ($i === 0 && $t <= $epsilon) return $fromName;                       // P == Anfangsknoten
    if ($i === $count - 2 && $t >= 1.0 - $epsilon) return $toName;          // P == Endknoten

    $anchorNodeName = AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX . $anchorIndex;
    $graph[$anchorNodeName] ??= [];

    $sliceFrom = array_slice($coordinates, 0, $i + 1);
    if ($t > $epsilon) { $sliceFrom[] = [$projX, $projY]; }
    $sliceTo = [];
    if ($t < 1.0 - $epsilon) { $sliceTo[] = [$projX, $projY]; }
    $sliceTo = array_merge($sliceTo, array_slice($coordinates, $i + 1));

    // V11: das Profil des Elternwegs, am Fusspunkt geschnitten. `$i` ist das geteilte Segment und
    // `$t` der Anteil, der auf das erste Stueck faellt.
    [$profileFrom, $profileTo] = avesmapsRouteSplitTerrainProfile($original['terrain_profile'] ?? null, $i, $t);

    $addedFrom = false;
    $addedTo = false;
    if (count($sliceFrom) >= 2) {
        $connectionFrom = avesmapsBuildClientRouteSubPathConnection($original, $fromName, $anchorNodeName, $sliceFrom, 'wp-slice-' . $anchorIndex . '-a', $profileFrom);
        avesmapsAddClientCompatibleGraphConnection($graph, $fromName, $anchorNodeName, $connectionFrom);
        avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $fromName, avesmapsRouteReverseSubPathConnection($connectionFrom));
        $addedFrom = true;
    }
    if (count($sliceTo) >= 2) {
        $connectionTo = avesmapsBuildClientRouteSubPathConnection($original, $anchorNodeName, $toName, $sliceTo, 'wp-slice-' . $anchorIndex . '-b', $profileTo);
        avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $toName, $connectionTo);
        avesmapsAddClientCompatibleGraphConnection($graph, $toName, $anchorNodeName, avesmapsRouteReverseSubPathConnection($connectionTo));
        $addedTo = true;
    }

    if ($addedFrom && $addedTo) {
        avesmapsRemoveClientRouteConnection($graph, $fromName, $toName, (string) ($original['id'] ?? ''));
    }

    return $anchorNodeName;
}
```

- [ ] **Schritt 5: `avesmapsAnchorClientWaypointToLandPath` auf den Teiler umstellen**

In `client-graph.php` den Rumpf von `avesmapsAnchorClientWaypointToLandPath` (Zeilen 909-975) ersetzen. Der letzte Parameter heißt jetzt `$anchorIndex` statt `$waypointIndex` — er nummeriert Anker, nicht Wegpunkte:

```php
function avesmapsAnchorClientWaypointToLandPath(array &$graph, string $waypointName, float $wx, float $wy, array $anchor, string $syntheticTransport, float $syntheticSpeed, int $anchorIndex): void {
    $anchorNodeName = avesmapsSplitClientPathAtAnchor($graph, $anchor, $anchorIndex);
    if ($anchorNodeName === $waypointName || $anchorNodeName === '') return;

    $projX = (float) ($anchor['proj_x'] ?? 0.0);
    $projY = (float) ($anchor['proj_y'] ?? 0.0);
    $airDistance = hypot($wx - $projX, $wy - $projY);
    $cost = $airDistance * AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR;
    $connectionId = 'synthetic-' . $waypointName . '->' . $anchorNodeName;
    $syntheticConnection = [
        'distance' => $cost,
        'time' => $cost / $syntheticSpeed,
        // Wie die Komponentenbruecke: der Faktor reist mit der Kante, damit der Bericht ihn
        // herausrechnen kann.
        'cost_factor' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR,
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
        'transport_option' => $syntheticTransport,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => '',
        'public_id' => '',
        'from' => $waypointName,
        'to' => $anchorNodeName,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[$wx, $wy], [$projX, $projY]]],
        'synthetic' => true,
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $waypointName, $anchorNodeName, $syntheticConnection);
    avesmapsAddClientCompatibleGraphConnection($graph, $anchorNodeName, $waypointName, $syntheticConnection);
}
```

Der einzige Aufrufer steht in `avesmapsConnectClientRouteWaypointsToNearestLandPath:764` und übergibt dort noch `(int) $waypointIndex` — das bleibt in diesem Task unverändert und wird in Task 3 ersetzt.

- [ ] **Schritt 6: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/detour-trigger-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/detour-chords-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/water-bridge-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/synthetic-distance-report-test.php
```

Erwartet: alle fünf grün. Die beiden Umweg-Tests prüfen mit, dass die verschobene `avesmapsRemoveClientRouteConnection` dort weiterhin gefunden wird.

- [ ] **Schritt 7: Commit**

```bash
git add api/_internal/routing/client-graph.php api/_internal/routing/detour.php api/_internal/routing/__tests__/anchor-candidates-test.php
git commit -m "refactor(routing): ein Teiler fuer beide Erzeuger -- und er entfernt die Ursprungskante"
```

---

### Task 3: Der Wegpunkt-Anker bietet sechs Fußpunkte an statt einen

**Files:**
- Modify: `api/_internal/routing/client-graph.php` (neue Funktion `avesmapsFindNearestDryClientLandPathAnchors`; `avesmapsFindNearestClientLandPathAnchor:838-845` wird zur Hülle; `avesmapsConnectClientRouteWaypointsToNearestLandPath:754-765`)
- Modify: `api/_internal/routing/__tests__/anchor-candidates-test.php` (Abschnitt G)

**Interfaces:**
- Consumes: `avesmapsCollectNearestClientLandPathAnchors(...)`, `avesmapsSplitClientPathAtAnchor(...)`, `avesmapsAllocateClientAnchorIndex(...)`, `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT`.
- Produces: `avesmapsFindNearestDryClientLandPathAnchors(array $graph, float $px, float $py, array $water, int $limit): array` — bis zu `$limit` Anker, deren Sehne zum Fußpunkt trocken ist, aufsteigend nach Entfernung.

🔴 **`avesmapsFindNearestClientLandPathAnchor` (Einzahl) bleibt bestehen.** Drei Tests rufen sie auf (`water-bridge-test.php:184,191,199`, `synthetic-distance-report-test.php:128`). Sie wird zur Hülle über der Mehrzahl-Variante — sie zu löschen reißt das Testfeld und damit den Deploy.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `anchor-candidates-test.php` anhängen, vor der `echo`-Zeile:

```php
// ============================================================ G. mehrere trockene Anker

$graph6 = [];
$road($graph6, 'A', 'B', [[0.0, 0.0], [10.0, 0.0]], 'path-eins');
$road($graph6, 'C', 'D', [[0.0, 12.0], [10.0, 12.0]], 'path-zwei');

$trocken = avesmapsFindNearestDryClientLandPathAnchors($graph6, 5.0, 4.0, [], 6);
assert(count($trocken) === 2, 'beide Wege sind trocken erreichbar: ' . count($trocken));
assert((string) $trocken[0]['connection']['id'] === 'path-eins', 'der naechste zuerst');

// Ein Wasserband quer ueber den naechsten Weg: der faellt heraus, der zweite bleibt.
$band = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-5.0, 1.0], [15.0, 1.0], [15.0, 3.0], [-5.0, 3.0], [-5.0, 1.0]]]],
    'min_x' => -5.0, 'min_y' => 1.0, 'max_x' => 15.0, 'max_y' => 3.0,
]]);
$trockenMitSee = avesmapsFindNearestDryClientLandPathAnchors($graph6, 5.0, 4.0, $band, 6);
$idsTrocken = array_map(static fn(array $c): string => (string) $c['connection']['id'], $trockenMitSee);
assert($idsTrocken === ['path-zwei'], 'nur der trocken erreichbare Weg bleibt: ' . implode(',', $idsTrocken));

// Und die Einzahl-Huelle liefert weiterhin genau den ersten davon.
$einzeln = avesmapsFindNearestClientLandPathAnchor($graph6, 5.0, 4.0, $band);
assert(is_array($einzeln) && (string) $einzeln['connection']['id'] === 'path-zwei',
    'die Einzahl-Huelle bleibt, drei Tests haengen an ihr');
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
```

Erwartet: `Error: Call to undefined function avesmapsFindNearestDryClientLandPathAnchors()`

- [ ] **Schritt 3: Mehrzahl bauen, Einzahl zur Hülle machen**

In `client-graph.php` `avesmapsFindNearestClientLandPathAnchor` (Zeilen 838-845) ersetzen durch:

```php
/**
 * Bis zu $limit Fusspunkte, deren Sehne vom Punkt zum Fusspunkt NICHT durch offenes Wasser laeuft,
 * aufsteigend nach Entfernung.
 *
 * 💣 V13, Entwurf §4.6: das ist der ZWEITE Erzeuger von Querfeldein-Kanten. Ohne den Wassertest hier
 * waere die Sperre halb gebaut -- und halb gebaut genau an den Stellen, die der Nutzer selbst in den
 * Planer tippt.
 *
 * Mit leerem $water ist das Ergebnis bitgleich zum Verhalten vor V13: der Test faellt sofort mit
 * false zurueck, und die naechsten Projektionen gewinnen, wie sie es immer taten.
 */
function avesmapsFindNearestDryClientLandPathAnchors(array $graph, float $px, float $py, array $water, int $limit): array {
    if ($limit <= 0) return [];
    $dry = [];
    foreach (avesmapsCollectNearestClientLandPathAnchors($graph, $px, $py, AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT) as $candidate) {
        if (avesmapsRouteChordCrossesWater($px, $py, (float) $candidate['proj_x'], (float) $candidate['proj_y'], $water)) continue;
        $dry[] = $candidate;
        if (count($dry) >= $limit) break;
    }
    return $dry;
}

/**
 * Der naechste trockene Fusspunkt, oder null.
 *
 * ⚠️ Bleibt als Huelle bestehen, obwohl der Bestand seit dem 14.08.2026 mit der Mehrzahl arbeitet:
 * water-bridge-test.php und synthetic-distance-report-test.php pruefen an ihr, dass der Wassertest
 * greift. Sie zu loeschen hiesse, drei gruene Zusicherungen fuer nichts wegzuwerfen.
 */
function avesmapsFindNearestClientLandPathAnchor(array $graph, float $px, float $py, array $water = []): ?array {
    return avesmapsFindNearestDryClientLandPathAnchors($graph, $px, $py, $water, 1)[0] ?? null;
}
```

⚠️ **Der Sammler wird weiterhin mit `AVESMAPS_ROUTE_CLIENT_WATER_DRY_SEARCH_LIMIT` befüllt, nicht mit `$limit`** — sonst blieben bei nassen Fußpunkten keine trockenen mehr übrig. Genau dafür gibt es die Konstante.

- [ ] **Schritt 4: Die Anbindungsschleife auf K Anker umstellen**

In `avesmapsConnectClientRouteWaypointsToNearestLandPath` die Schleife über die Wegpunkte (Zeilen 754-765) ersetzen:

```php
    foreach ($waypointNames as $name) {
        if (!isset($graph[$name])) continue;
        if (avesmapsClientNodeHasLandPathEdge($graph, $name)) continue;
        if (isset($seaBoundLocationNames[$name])) continue;
        $location = $locationLookup[$name] ?? null;
        if (!is_array($location)) continue;
        // 🔴 K ANKER, NICHT EINER. Der naechste Fusspunkt ist nicht zwangslaeufig der beste: er kann
        // auf einem Weg liegen, der von der falschen Seite kommt, und dann faehrt die Reise erst hin
        // und wieder zurueck. Welcher gewinnt, entscheidet der Dijkstra -- wie ueberall sonst hier.
        // V13 §4.6: kein trockener Anker -> kein Anker. Der Wegpunkt behaelt, was die
        // Komponentenbruecke ihm gab, und das ist nichts, wenn auch die nass war.
        $anchors = avesmapsFindNearestDryClientLandPathAnchors(
            $graph, (float) $location['route_x'], (float) $location['route_y'], $water,
            AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT
        );
        foreach ($anchors as $anchor) {
            // 💣 Der Index kommt je Anker frisch aus dem GRAPHEN, nicht aus der Wegpunkt-Nummer:
            // der vorige Anker hat gerade einen Knoten angelegt, und zwei Anker unter demselben
            // Namen ueberschrieben einander.
            $anchorIndex = avesmapsAllocateClientAnchorIndex($graph);
            avesmapsAnchorClientWaypointToLandPath($graph, $name, (float) $location['route_x'], (float) $location['route_y'], $anchor, (string) $syntheticTransport, (float) $syntheticSpeed, $anchorIndex);
        }
    }
```

⚠️ **`$waypointIndex` entfällt aus dem `foreach`-Kopf** (`foreach ($waypointNames as $waypointIndex => $name)` wird zu `foreach ($waypointNames as $name)`) — die Nummerierung kommt jetzt aus dem Graphen.

💣 **Die Anker werden nacheinander gesammelt und gesetzt.** `$anchors` wird einmal vor der inneren Schleife geholt: der erste Split verändert den Graphen, und ein zweiter Sammlerlauf würde die frisch entstandenen Hälften als eigene Wege sehen und den Wegpunkt ein zweites Mal an denselben Weg hängen.

- [ ] **Schritt 5: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/anchor-candidates-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/water-bridge-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/synthetic-distance-report-test.php
```

Erwartet: alle drei grün.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/routing/client-graph.php api/_internal/routing/__tests__/anchor-candidates-test.php
git commit -m "feat(routing): ein Ort ohne Weganbindung bekommt sechs Fusspunkte zur Wahl statt einen"
```

---

### Task 4: Der Kartenpunkt steigt am Fußpunkt aus, mit Rückfall auf die Ortschaften

**Files:**
- Modify: `api/_internal/routing/offroad-leg.php:122-146` (`avesmapsAttachOffroadPointToGraph`)
- Modify: `api/_internal/routing/__tests__/offroad-leg-test.php` (zwei neue Abschnitte am Ende)

**Interfaces:**
- Consumes: `avesmapsCollectNearestClientLandPathAnchors(...)`, `avesmapsSplitClientPathAtAnchor(...)`, `avesmapsAllocateClientAnchorIndex(...)`, `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT`.
- Produces: keine neue öffentliche Funktion. `avesmapsAttachOffroadPointToGraph` behält Signatur, Rückgabeschlüssel und alle `error`-Codes.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `api/_internal/routing/__tests__/offroad-leg-test.php` anhängen, vor der abschließenden `echo`-Zeile:

```php
// ============================================================ Ausstieg am Fusspunkt

// Eine lange Strasse zwischen zwei FERNEN Ortschaften, der Kartenpunkt liegt in ihrer Mitte.
// Bis zum 14.08.2026 waren nur A und B Ausstiegskandidaten -- die Reise lief also erst 50 Einheiten
// die Strasse entlang, bevor sie 4 Einheiten querfeldein ging.
$fussGraph = ['A' => [], 'B' => []];
$fussWeg = [
    'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'path-lang', 'path_id' => 'path-lang', 'from' => 'A', 'to' => 'B',
    'distance' => 100.0, 'time' => 100.0 / 3.07,
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [100.0, 0.0]]],
];
avesmapsAddClientCompatibleGraphConnection($fussGraph, 'A', 'B', $fussWeg);
avesmapsAddClientCompatibleGraphConnection($fussGraph, 'B', 'A', $fussWeg);
$fussLocations = [
    ['name' => 'A', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]], 'route_x' => 0.0, 'route_y' => 0.0],
    ['name' => 'B', 'geometry' => ['type' => 'Point', 'coordinates' => [100.0, 0.0]], 'route_x' => 100.0, 'route_y' => 0.0],
];
$fussClientGraph = ['graph' => $fussGraph, 'statistics' => []];
$fussLand = avesmapsPrepareRouteAreas([[
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-20.0, -20.0], [120.0, -20.0], [120.0, 20.0], [-20.0, 20.0], [-20.0, -20.0]]]],
    'min_x' => -20.0, 'min_y' => -20.0, 'max_x' => 120.0, 'max_y' => 20.0,
]]);

$fussReport = avesmapsAttachOffroadPointToGraph(
    $fussClientGraph, $fussLocations, $request, [], $fussLand, null, 50.0, 4.0, '__offroad_to', false
);
assert($fussReport['ok'] === true, 'der Kartenpunkt haengt am Netz: ' . json_encode($fussReport));

// 🔴 DER AUSSTIEG IST EIN PUNKT AUF DER STRASSE, keine Ortschaft.
$fussKnoten = array_map(static fn(array $e): string => (string) $e['node'], $fussReport['exit_nodes']);
assert($fussKnoten !== [], 'es gibt einen Ausstieg');
assert(str_starts_with($fussKnoten[0], AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX),
    'und er ist ein Fusspunkt, keine Ortschaft: ' . $fussKnoten[0]);
assert(!in_array('A', $fussKnoten, true) && !in_array('B', $fussKnoten, true),
    'die fernen Ortschaften stehen nicht mehr im Angebot: ' . implode(',', $fussKnoten));
// Und die Luftlinie zum Ausstieg ist die 4, nicht die 50.
assert(abs((float) $fussReport['exit_nodes'][0]['air_distance'] - 4.0) < 1e-6,
    'Luftlinie zum Ausstieg: ' . $fussReport['exit_nodes'][0]['air_distance']);

// ============================================================ Rueckfall auf die Ortschaften

// ⭐ DER RUECKFALL IST DER GRUND, WARUM DAS NICHTS KAPUTT MACHEN KANN. Ein Graph ganz OHNE Landweg
// hat keine Fusspunkte -- dann muss die alte Ortschaftenliste greifen, sonst verschwaende eine
// Route, die es heute gibt.
$seeGraph = ['A' => [], 'B' => []];
$seeWeg = [
    'route_type' => 'Seeweg', 'transport_option' => 'cargoShip',
    'id' => 'path-see', 'path_id' => 'path-see', 'from' => 'A', 'to' => 'B',
    'distance' => 100.0, 'time' => 10.0,
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [100.0, 0.0]]],
];
avesmapsAddClientCompatibleGraphConnection($seeGraph, 'A', 'B', $seeWeg);
avesmapsAddClientCompatibleGraphConnection($seeGraph, 'B', 'A', $seeWeg);
$seeClientGraph = ['graph' => $seeGraph, 'statistics' => []];
$seeReport = avesmapsAttachOffroadPointToGraph(
    $seeClientGraph, $fussLocations, $request, [], $fussLand, null, 4.0, 4.0, '__offroad_to', false
);
assert($seeReport['ok'] === true, 'ohne Landweg greift der Rueckfall: ' . json_encode($seeReport));
$seeKnoten = array_map(static fn(array $e): string => (string) $e['node'], $seeReport['exit_nodes']);
assert(in_array('A', $seeKnoten, true), 'und bietet die Ortschaften an: ' . implode(',', $seeKnoten));
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-leg-test.php
```

Erwartet: `AssertionError: und er ist ein Fusspunkt, keine Ortschaft: A`

- [ ] **Schritt 3: Die Kandidatenwahl umbauen**

In `offroad-leg.php` den Block ab `$graph = is_array($clientGraph['graph'] ?? null) ...` (Zeile 122) bis einschließlich der Zeile `$near = array_values(array_filter(...));` (Zeile 135) ersetzen:

```php
    $graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];

    // 🔴 DIE AUSSTIEGE SIND PUNKTE AUF WEGEN, NICHT ORTSCHAFTEN (Owner, 14.08.2026: „den
    // straßenpunkt zu nehmen, der am schnellste/kürzesten zum querfeldein punkt entfernt ist").
    // Bis dahin waren die 12 naechsten ORTE die einzigen Kandidaten -- die Reise verliess die
    // Strasse deshalb immer an einer Ortschaft, auch wenn sie hundert Meter weiter haette abbiegen
    // koennen.
    // 💣 Geteilt wird in $clientGraph['graph'], NICHT in $graph -- das ist eine Kopie, und ein Split
    // darin waere nach der Funktion verschwunden.
    $anchorCandidates = [];
    foreach (avesmapsCollectNearestClientLandPathAnchors($graph, $x, $y, AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT) as $anchor) {
        $anchorIndex = avesmapsAllocateClientAnchorIndex($clientGraph['graph']);
        $anchorNodeName = avesmapsSplitClientPathAtAnchor($clientGraph['graph'], $anchor, $anchorIndex);
        if ($anchorNodeName === '') continue;
        $anchorCandidates[] = [
            'name' => $anchorNodeName,
            'x' => (float) $anchor['proj_x'],
            'y' => (float) $anchor['proj_y'],
            'distance' => (float) $anchor['distance'],
        ];
    }

    // ⭐ UND DIE ORTSCHAFTEN BLEIBEN ALS RUECKFALL. Findet kein Fusspunkt einen trockenen A*-Weg,
    // laeuft die Liste von vorher -- die Antwort kann also nie schlechter werden als bis zum
    // 14.08.2026, hoechstens besser.
    $nodeCandidates = avesmapsFindNearestOffroadExitNodes($graph, $locations, $x, $y);
    if ($anchorCandidates === [] && $nodeCandidates === []) {
        return ['ok' => false, 'error' => 'no_exit_node'];
    }

    // ⚠️ ZWEI STUFEN JE FAMILIE, und die zweite ist eine Rettung, kein Luxus. Die
    // Entfernungsschranke haelt die gemeinsame Suchkiste klein -- sie spannt ueber den Punkt UND
    // alle Kandidaten, ein weit entfernter Knoten zoege sie auf. Wenn aber KEINER der nahen
    // erreichbar ist (ein Punkt mitten in einem See), waere die Antwort sonst „kein Weg", obwohl
    // der uebernaechste gegangen waere.
    $stage = static function (array $set): array {
        if ($set === []) return [];
        $nearest = (float) $set[0]['distance'];
        $reach = max($nearest * AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR, $nearest);
        $near = array_values(array_filter($set, static fn(array $c): bool => (float) $c['distance'] <= $reach + 1e-9));
        return count($near) === count($set) ? [$near] : [$near, $set];
    };
    $stages = array_merge($stage($anchorCandidates), $stage($nodeCandidates));
```

Danach die bestehende Schleife anpassen: `foreach ([$near, $candidates] as $stage => $set) {` wird zu

```php
    foreach ($stages as $set) {
        if ($exits !== []) break;
```

und die alte Zeile `if ($stage === 1 && ($exits !== [] || count($set) === count($near))) { break; }` entfällt ersatzlos (die Stufenliste ist bereits entdoppelt).

⚠️ **`$offered = count($set);` bleibt, wo es steht** — `exit_nodes_offered` in der Antwort meint weiterhin „wie viele Kandidaten die zuletzt gelaufene Stufe hatte".

- [ ] **Schritt 4: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-leg-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-astar-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/carriage-offroad-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/land-check-test.php
```

Erwartet: alle vier grün. `carriage-offroad-test.php` ist der Beleg, dass die Kutschen-Sperre den neuen Kandidatenweg nicht umgeht — sie sitzt vor der Kandidatensuche (`$speed === null` → `no_offroad_route`) und bleibt unberührt.

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/routing/offroad-leg.php api/_internal/routing/__tests__/offroad-leg-test.php
git commit -m "feat(routing): „Hierher reisen\" verlaesst die Strasse am Fusspunkt statt an der letzten Ortschaft"
```

---

### Task 5: Abnahme und Deploy

**Files:**
- Modify: `AGENTS.md:362` (den 🔧-Vermerk „Entwurf freigegeben, nichts gebaut" auf „live" umschreiben)

**Interfaces:**
- Consumes: alles aus Task 1-4.
- Produces: nichts.

- [ ] **Schritt 1: Das ganze Testfeld**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll "$t" || echo "RED $t"; done
```

Erwartet: nur `RED api/_internal/linkcheck/__tests__/link-url-test.php` (vorher schon rot, echter DNS-Abruf). Alles andere grün.

- [ ] **Schritt 2: Das JS-Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "RED $t"; done
```

Erwartet: 130/130 grün, keine `RED`-Zeile. `js/` wurde nicht angefasst; ein roter Test hier hieße, dass etwas anderes im geteilten Arbeitsbaum kaputt ist — dann **nicht** pushen.

- [ ] **Schritt 3: Die Vorher-Werte sichern**

Vor dem Push, gegen den noch alten Live-Stand, **je eine** Anfrage:

```bash
curl -s -m 90 -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" -d '{"from":"Luring","to":"Salmingen","optimize":"fastest","include_geometry":false,"transports":{"land":"groupHorse","river":"riverSailer","sea":"cargoShip","synthetic":"groupHorse"}}' | php -r '$r=json_decode(stream_get_contents(STDIN),true); echo $r["route"]["cost"]," ",implode(",",$r["route"]["debug"]["edge_ids"]),"\n";'
```

Den Wert notieren. 💣 Keine Schleife, keine Wiederholung — auf STRATO sättigt das die PHP-Worker.

- [ ] **Schritt 4: Push und Deploy abwarten**

```bash
git push origin master
```

Danach ~2 Minuten warten, dann `git --no-pager log --oneline origin/master -1` gegen den lokalen Stand prüfen.

- [ ] **Schritt 5: Die fünf Handgriffe live**

Nicht messen, sondern **machen** — jeder Punkt ist ein Klick und ein Blick auf die Etappenliste:

1. Rechtsklick auf einen freien Punkt zwischen Spinnried und Salmingen → Wanderschuh. **Erwartet:** der Querweg startet auf der Straße, nicht in Spinnried; die Etappenliste nennt dort „Kreuzung".
2. Dieselbe Stelle, Landtransport auf **Kutsche**. **Erwartet:** keine Querfeldein-Etappe, dieselbe Absage wie vorher.
3. Ein Ort aus der Editor-Markierung „unverbundene Orte" als Ziel. **Erwartet:** kurzer Anker zum nächsten Weg statt Reise zur fernen Ortschaft.
4. Gareth → Punin, nur Land. **Erwartet:** unverändert reine Straßenroute, 0 Querfeldein.
5. Rechtsklick aufs offene Meer. **Erwartet:** weiterhin „Dorthin führt kein Landweg" — kein Fußpunkt im Wasser.

⚠️ Punkt 1 ist zugleich die einzige Prüfung, die ein Test nicht leisten kann: ob die gezeichnete Linie an der neuen Nahtstelle mitten auf der Straße sauber von durchgezogen auf gestrichelt wechselt. Wenn nicht, ist das ein Befund und gehört gemeldet, nicht überdeckt.

- [ ] **Schritt 6: Die Nachher-Werte gegen die Vorher-Werte**

Dieselbe Anfrage wie in Schritt 3, einmal. **Erwartet:** Luring → Salmingen unverändert (beide Orte hängen am Netz, die Owner-Regel greift dort — dieser Bau ändert daran nichts). Weicht der Wert ab, ist das eine Regression und **kein** Erfolg.

- [ ] **Schritt 7: `AGENTS.md` nachziehen und committen**

In Abschnitt 11, im Absatz „Hierher reisen + der Querfeldein-A*", den Vermerk

> 🔧 **Entwurf freigegeben, nichts gebaut:** `docs/superpowers/specs/2026-08-14-querfeldein-ausstiegspunkt-design.md` — eine Querfeldein-Etappe soll das Netz am günstigsten **Punkt auf einem Weg** verlassen statt an der nächsten Ortschaft. Der Sammler dafür existiert (`avesmapsCollectNearestClientLandPathAnchors`) und braucht eine Entdopplung pro Weg; der Teiler wird aus `avesmapsAnchorClientWaypointToLandPath` herausgelöst und entfernt künftig die Ursprungskante.

ersetzen durch (Entwurf: `docs/superpowers/specs/2026-08-14-querfeldein-ausstiegspunkt-design.md`, Plan: `docs/superpowers/plans/2026-08-14-querfeldein-ausstiegspunkt.md`):

> 🔴 **Der Ausstieg einer Querfeldein-Etappe ist ein Punkt AUF einem Weg, nicht die nächste Ortschaft** (live 14.08.2026). Beide Erzeuger netzferner Anbindungen — der Kartenpunkt und der Wegpunkt ohne Weganbindung — bekommen bis zu `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT` (6) Fußpunkte als **Angebot**, je einen pro Weg (`avesmapsCollectNearestClientLandPathAnchors` entdoppelt über die Kanten-`id`); welcher gewinnt, entscheidet der Dijkstra. 💣 `avesmapsSplitClientPathAtAnchor` **entfernt die Ursprungskante**, sobald beide Hälften stehen — sonst teilt der nächste Endpunkt denselben Weg ein zweites Mal und die Fußpunkte hängen unverbunden nebeneinander. ⭐ Die alte Ortschaftenliste bleibt als **Rückfall**: findet kein Fußpunkt einen trockenen A\*-Weg, läuft sie wie vorher — die Antwort kann nie schlechter werden als davor.

```bash
git add AGENTS.md
git commit -m "docs(agents): der Querfeldein-Ausstieg ist ein Fusspunkt auf einem Weg, nicht die naechste Ortschaft"
git push origin master
```
