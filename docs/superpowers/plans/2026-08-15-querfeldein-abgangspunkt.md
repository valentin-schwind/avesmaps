# Abgangspunkt — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE UNTER-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> `- [ ]` zum Abhaken.

**Ziel:** Eine Reise zu einem angeklickten Kartenpunkt darf die Straße an **jedem gezeichneten
Punkt** verlassen, nicht nur am zielnächsten — und ein einziger Suchlauf bepreist alle
Kandidaten statt einer je Kandidat.

**Bauart:** Drei serverseitige Bauteile in `api/_internal/routing/` (Kandidatensammler,
Mehrpunkt-Teiler, Mehrziel-Suchlauf), zusammengeführt in `avesmapsAttachOffroadPointToGraph`.
Dazu eine richtungsabhängige Beschriftung des Ausstiegsknotens in der Etappenliste.

**Werkzeug:** PHP 8 (strict types), kein Framework, Tests sind nackte `assert()`-Skripte unter
`api/_internal/routing/__tests__/`. Client: reines JS ohne Bundler, Tests unter
`js/routing/__tests__/` mit `node <datei>`.

**Entwurf:** [2026-08-15-querfeldein-abgangspunkt-design.md](../specs/2026-08-15-querfeldein-abgangspunkt-design.md)

## Globale Randbedingungen

- **Geteilter Arbeitsbaum.** Niemals `git add -A`, `git add .`, `git commit -a`. Vor jedem
  Commit `git status`, und **nur die selbst angefassten Pfade** einzeln stagen. Fremde
  geänderte/ungetrackte Dateien in Ruhe lassen (AGENTS.md §9).
- **STRATO.** Einzelne API-Proben, niemals Schleifen über `POST /api/route/`.
- **Vor dem Push das GANZE Testfeld**, PHP und JS:
  `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`
  und `for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 "$t"; done`.
  ⚠️ `linkcheck/link-url-test.php` ist auf dem Entwicklungsrechner vorbestehend rot (echter
  DNS-Abruf) — kein Regressionssignal.
- **Ein Deploy je sichtbarer Änderung**, und der Owner sieht jede (AGENTS.md §9).
- **Kommentare** in dieser Codebasis: Deutsch im Routing-Umfeld, wie die Nachbarzeilen.
  Fallen mit 💣/⚠️/🔴 markieren, wie es die Nachbardateien tun.
- **Keine Zahl glattziehen.** Tempowerte, Schranken und Konstanten kommen aus den bestehenden
  Konstanten, nie neu erfunden.
- Die Fallenliste in §7 des Entwurfs ist die Abnahmeliste. Jede Zeile wird vor „fertig"
  einzeln abgehakt.

---

## Dateiübersicht

| Datei | Rolle | Aufgabe |
|---|---|---|
| `api/_internal/routing/client-graph.php` | ändern | neu: `avesmapsSplitClientPathAtPoints`, `avesmapsCollectClientLandPathExitCandidates`, Konstante `AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT` |
| `api/_internal/routing/offroad-grid.php` | ändern | neu: `avesmapsOffroadFindPathsFromPoint` |
| `api/_internal/routing/offroad-leg.php` | ändern | `avesmapsAttachOffroadPointToGraph` nutzt die drei neuen Bauteile |
| `api/_internal/routing/__tests__/path-multisplit-test.php` | neu | Aufgabe 1 |
| `api/_internal/routing/__tests__/exit-vertices-test.php` | neu | Aufgabe 2 |
| `api/_internal/routing/__tests__/offroad-multi-goal-test.php` | neu | Aufgabe 3 |
| `api/_internal/routing/__tests__/abgangspunkt-test.php` | neu | Aufgabe 4 — der Abnahmefall, rot gegen HEAD |
| `js/routing/route-plan.js` | ändern | richtungsabhängige Beschriftung nach der Aggregation |
| `js/routing/__tests__/abgangspunkt-label.test.js` | neu | Aufgabe 6 |

---

## Aufgabe 1: Der Mehrpunkt-Teiler

Schneidet **eine** Graphkante in **einem** Durchgang an k Punkten.

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php` (neue Funktion nach
  `avesmapsSplitClientPathAtAnchor`, etwa Zeile 1055)
- Test: `api/_internal/routing/__tests__/path-multisplit-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsBuildClientRouteSubPathConnection(array $original, string $from, string $to, array $coordinates, string $connectionId, ?array $terrainProfile = null): array`,
  `avesmapsRouteReverseSubPathConnection(array $connection): array`,
  `avesmapsAddClientCompatibleGraphConnection(array &$graph, string $fromName, string $toName, array $connection): void`,
  `avesmapsRemoveClientRouteConnection(array &$graph, string $fromNode, string $toNode, string $connectionId): void`,
  `avesmapsRouteSplitTerrainProfile(?array $profile, int $segmentIndex, float $t): array`,
  `avesmapsAllocateClientAnchorIndex(array $graph): int`,
  Konstante `AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX = '__wp_anchor_'`
- Liefert: `avesmapsSplitClientPathAtPoints(array &$graph, array $anchor, array $cuts): array`
  — `$anchor` ist ein Eintrag aus `avesmapsCollectNearestClientLandPathAnchors` (Schlüssel
  `from`, `to`, `connection`), `$cuts` eine Liste von `['segment_index' => int, 't' => float]`.
  Rückgabe: Liste gleicher Länge und Reihenfolge wie `$cuts` mit
  `['name' => string, 'x' => float, 'y' => float]` je Schnitt.

- [ ] **Schritt 1: Den roten Test schreiben**

Datei `api/_internal/routing/__tests__/path-multisplit-test.php`:

```php
<?php
// api/_internal/routing/__tests__/path-multisplit-test.php
declare(strict_types=1);

/**
 * Der Mehrpunkt-Teiler: EINE Kante, k Schnitte, EIN Durchgang.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.2
 *
 * 💣 WARUM NICHT k-MAL DER EINZELTEILER: avesmapsSplitClientPathAtAnchor entfernt die
 * Ursprungskante, sobald beide Haelften stehen. Der zweite Aufruf faende sie nicht mehr und
 * haengte seinen Punkt ins Leere -- genau die Doppelteilung, die am 14.08.2026 zwei
 * unverbundene Fusspunkte an derselben Strasse erzeugt hat.
 *
 * Aus dem Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/path-multisplit-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';

$makeGraph = static function (array $points): array {
    $graph = [];
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => 'weg#0', 'path_id' => 'weg#0', 'from' => 'A', 'to' => 'B',
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    // Beide Richtungen teilen EIN Objekt, wie im echten Graphen (client-graph.php:411-413).
    avesmapsAddClientCompatibleGraphConnection($graph, 'A', 'B', $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'A', $connection);
    return [$graph, $connection];
};

$edgeIds = static function (array $graph, string $from): array {
    $ids = [];
    foreach ($graph[$from] ?? [] as $connections) {
        foreach ($connections as $connection) { $ids[] = (string) $connection['id']; }
    }
    sort($ids);
    return $ids;
};

// ---- A: zwei Schnitte auf einer geraden Kante -------------------------------------------
$points = [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0]];
[$graph, $connection] = $makeGraph($points);
$anchor = ['from' => 'A', 'to' => 'B', 'connection' => $connection];

$cuts = avesmapsSplitClientPathAtPoints($graph, $anchor, [
    ['segment_index' => 1, 't' => 0.0],   // Vertex (4,0)
    ['segment_index' => 2, 't' => 0.0],   // Vertex (8,0)
]);

assert(count($cuts) === 2, 'zwei Schnitte, zwei Knoten');
assert($cuts[0]['name'] !== $cuts[1]['name'], 'jeder Schnitt bekommt einen EIGENEN Knoten');
assert(abs($cuts[0]['x'] - 4.0) < 1e-9 && abs($cuts[0]['y']) < 1e-9, 'Schnitt 0 liegt auf dem Vertex');
assert(abs($cuts[1]['x'] - 8.0) < 1e-9, 'Schnitt 1 liegt auf dem Vertex');

// 🔴 Die Ursprungskante ist WEG, und zwar genau einmal.
$idsFromA = $edgeIds($graph, 'A');
assert(!in_array('weg#0', $idsFromA, true), 'Ursprungskante entfernt');
assert(count($idsFromA) === 1, 'A haengt an genau einem Teilstueck');

// Die drei Teilstuecke haengen IN REIHE: A -> c0 -> c1 -> B, und zurueck.
assert(isset($graph['A'][$cuts[0]['name']]), 'A -> Schnitt 0');
assert(isset($graph[$cuts[0]['name']][$cuts[1]['name']]), 'Schnitt 0 -> Schnitt 1');
assert(isset($graph[$cuts[1]['name']]['B']), 'Schnitt 1 -> B');
assert(isset($graph[$cuts[1]['name']][$cuts[0]['name']]), 'und zurueck');
assert(isset($graph['B'][$cuts[1]['name']]), 'und zurueck bis B');

// Die Laengen summieren sich auf die Ursprungslaenge -- kein Stueck verloren, keins doppelt.
$sum = 0.0;
foreach ([['A', $cuts[0]['name']], [$cuts[0]['name'], $cuts[1]['name']], [$cuts[1]['name'], 'B']] as [$f, $t]) {
    foreach ($graph[$f][$t] as $c) { $sum += (float) $c['distance']; }
}
assert(abs($sum - 12.0) < 1e-6, "Summe der Teilstuecke = 12, gemessen $sum");

// ---- B: ein Schnitt auf einem Endknoten wird NICHT geschnitten ---------------------------
[$graph2, $connection2] = $makeGraph($points);
$anchor2 = ['from' => 'A', 'to' => 'B', 'connection' => $connection2];
$cuts2 = avesmapsSplitClientPathAtPoints($graph2, $anchor2, [
    ['segment_index' => 0, 't' => 0.0],   // == A
    ['segment_index' => 2, 't' => 1.0],   // == B
]);
assert($cuts2[0]['name'] === 'A', 'Anfangsknoten kommt unveraendert zurueck');
assert($cuts2[1]['name'] === 'B', 'Endknoten kommt unveraendert zurueck');
assert(in_array('weg#0', $edgeIds($graph2, 'A'), true), 'ohne echten Schnitt bleibt die Kante stehen');

// ---- C: zwei Schnitte im SELBEN Segment, t neu skaliert ----------------------------------
[$graph3, $connection3] = $makeGraph($points);
$anchor3 = ['from' => 'A', 'to' => 'B', 'connection' => $connection3];
$cuts3 = avesmapsSplitClientPathAtPoints($graph3, $anchor3, [
    ['segment_index' => 0, 't' => 0.25],  // (1,0)
    ['segment_index' => 0, 't' => 0.75],  // (3,0)
]);
assert(abs($cuts3[0]['x'] - 1.0) < 1e-9, 'erster Schnitt bei (1,0)');
assert(abs($cuts3[1]['x'] - 3.0) < 1e-9, 'zweiter Schnitt bei (3,0)');
$sum3 = 0.0;
foreach ([['A', $cuts3[0]['name']], [$cuts3[0]['name'], $cuts3[1]['name']], [$cuts3[1]['name'], 'B']] as [$f, $t]) {
    foreach ($graph3[$f][$t] as $c) { $sum3 += (float) $c['distance']; }
}
assert(abs($sum3 - 12.0) < 1e-6, "auch bei zwei Schnitten im selben Segment: Summe 12, gemessen $sum3");

// ---- D: unsortierte Eingabe wird sortiert verarbeitet, Rueckgabe bleibt in Eingabefolge ---
[$graph4, $connection4] = $makeGraph($points);
$anchor4 = ['from' => 'A', 'to' => 'B', 'connection' => $connection4];
$cuts4 = avesmapsSplitClientPathAtPoints($graph4, $anchor4, [
    ['segment_index' => 2, 't' => 0.0],
    ['segment_index' => 1, 't' => 0.0],
]);
assert(abs($cuts4[0]['x'] - 8.0) < 1e-9, 'Rueckgabe folgt der EINGABE, nicht der Sortierung');
assert(abs($cuts4[1]['x'] - 4.0) < 1e-9, 'Rueckgabe folgt der EINGABE, nicht der Sortierung');
assert(isset($graph4[$cuts4[1]['name']][$cuts4[0]['name']]), 'im Graphen stehen sie trotzdem in Reihe');

fwrite(STDOUT, "path-multisplit-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/path-multisplit-test.php
```

Erwartet: `Error: Call to undefined function avesmapsSplitClientPathAtPoints()`

- [ ] **Schritt 3: Den Teiler bauen**

In `api/_internal/routing/client-graph.php`, direkt nach `avesmapsSplitClientPathAtAnchor`:

```php
/**
 * Teilt EINE Kante an k Punkten in EINEM Durchgang und liefert die Knoten in Eingabefolge.
 *
 * 💣 NICHT k-MAL DEN EINZELTEILER. avesmapsSplitClientPathAtAnchor entfernt die Ursprungskante,
 * sobald beide Haelften stehen -- der zweite Aufruf suchte danach eine Kante, die es nicht mehr
 * gibt. Genau diese Doppelteilung hat am 14.08.2026 zwei unverbundene Fusspunkte an derselben
 * Strasse erzeugt (Entwurf 2026-08-14 §5).
 *
 * 🔴 DER EINZELTEILER BLEIBT. Er traegt den Wegpunkt-Anker (Erzeuger 2) und vier Tests; dieser
 * hier steht daneben, er ersetzt ihn nicht.
 *
 * ⚠️ Ein Schnitt auf einem Endknoten wird nicht geschnitten -- sein Knotenname kommt unveraendert
 * zurueck, wie beim Einzelteiler.
 */
function avesmapsSplitClientPathAtPoints(array &$graph, array $anchor, array $cuts): array {
    $original = $anchor['connection'] ?? null;
    $fromName = (string) ($anchor['from'] ?? '');
    $toName = (string) ($anchor['to'] ?? '');
    $coordinates = is_array($original) ? ($original['geometry']['coordinates'] ?? []) : [];
    $count = is_array($coordinates) ? count($coordinates) : 0;
    if ($count < 2) { return array_map(static fn(): array => ['name' => $fromName, 'x' => 0.0, 'y' => 0.0], $cuts); }

    $epsilon = 1e-7;
    $result = [];
    $inner = [];   // die echten Schnitte, in Eingabe-Position gemerkt
    foreach ($cuts as $position => $cut) {
        $i = max(0, min($count - 2, (int) ($cut['segment_index'] ?? 0)));
        $t = max(0.0, min(1.0, (float) ($cut['t'] ?? 0.0)));
        [$ax, $ay] = [(float) $coordinates[$i][0], (float) $coordinates[$i][1]];
        [$bx, $by] = [(float) $coordinates[$i + 1][0], (float) $coordinates[$i + 1][1]];
        $px = $ax + $t * ($bx - $ax);
        $py = $ay + $t * ($by - $ay);

        if ($i === 0 && $t <= $epsilon) { $result[$position] = ['name' => $fromName, 'x' => $ax, 'y' => $ay]; continue; }
        if ($i === $count - 2 && $t >= 1.0 - $epsilon) { $result[$position] = ['name' => $toName, 'x' => $bx, 'y' => $by]; continue; }
        $inner[] = ['position' => $position, 'i' => $i, 't' => $t, 'x' => $px, 'y' => $py];
    }
    if ($inner === []) { ksort($result); return array_values($result); }

    usort($inner, static fn(array $a, array $b): int => [$a['i'], $a['t']] <=> [$b['i'], $b['t']]);

    // Entdopplung: zwei Schnitte auf demselben Punkt teilen sich einen Knoten.
    $unique = [];
    foreach ($inner as $cut) {
        $last = $unique === [] ? null : $unique[count($unique) - 1];
        if ($last !== null && $last['i'] === $cut['i'] && abs($last['t'] - $cut['t']) <= $epsilon) {
            $unique[count($unique) - 1]['positions'][] = $cut['position'];
            continue;
        }
        $cut['positions'] = [$cut['position']];
        $unique[] = $cut;
    }

    foreach ($unique as $index => $cut) {
        $unique[$index]['name'] = AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX . avesmapsAllocateClientAnchorIndex($graph);
        $graph[$unique[$index]['name']] ??= [];
    }

    // Ein Durchgang ueber die Geometrie: Teilstueck k laeuft vom vorigen Schnitt bis zu diesem.
    $profile = $original['terrain_profile'] ?? null;
    $slices = [];
    $prevName = $fromName;
    $prevIndex = 0;      // erster Koordinatenindex des laufenden Teilstuecks
    $prevPoint = null;   // eingefuegter Punkt am Anfang des Teilstuecks
    $prevI = 0; $prevT = 0.0;
    foreach ($unique as $cut) {
        $piece = $prevPoint === null ? [] : [[$prevPoint[0], $prevPoint[1]]];
        // 💣 max(0, …): liegen zwei Schnitte im SELBEN Segment, ist die Laenge hier 0. Eine
        // negative Laenge wuerde array_slice vom ENDE her schneiden -- ein stiller Falschschnitt.
        $piece = array_merge($piece, array_slice($coordinates, $prevIndex, max(0, $cut['i'] - $prevIndex + 1)));
        if ($cut['t'] > $epsilon) { $piece[] = [$cut['x'], $cut['y']]; }

        // ⚠️ Das Hoehenprofil wird am RESTPROFIL geschnitten, mit LOKALEM Segmentindex. Faellt der
        // Schnitt in dasselbe Segment wie der vorige, muss t neu skaliert werden -- der vordere
        // Teil dieses Segments ist bereits verbraucht.
        $localIndex = $cut['i'] - $prevI;
        $localT = ($localIndex === 0 && $prevT < 1.0 - $epsilon)
            ? ($cut['t'] - $prevT) / (1.0 - $prevT)
            : $cut['t'];
        [$head, $profile] = avesmapsRouteSplitTerrainProfile($profile, $localIndex, $localT);

        $slices[] = ['from' => $prevName, 'to' => $cut['name'], 'points' => $piece, 'profile' => $head];
        $prevName = $cut['name'];
        // Immer i+1, ob der Schnitt auf dem Vertex lag oder mitten im Segment: der Schnittpunkt
        // selbst wird als $prevPoint vorangestellt, also darf er nicht ein zweites Mal aus den
        // Koordinaten kommen.
        $prevIndex = $cut['i'] + 1;
        $prevPoint = [$cut['x'], $cut['y']];
        $prevI = $cut['i']; $prevT = $cut['t'];
    }
    $tail = array_merge([[$prevPoint[0], $prevPoint[1]]], array_slice($coordinates, $prevIndex));
    $slices[] = ['from' => $prevName, 'to' => $toName, 'points' => $tail, 'profile' => $profile];

    // 💣 ERST ALLE TEILSTUECKE, DANN DIE URSPRUNGSKANTE WEG. Faellt eines aus, bleibt sie stehen --
    // lieber eine ueberfluessige Dopplung als eine Luecke im Netz (Regel des Einzelteilers).
    $added = 0;
    foreach ($slices as $sliceIndex => $slice) {
        if (count($slice['points']) < 2) { continue; }
        $connectionId = 'wp-mslice-' . $slice['to'] . '-' . $sliceIndex;
        $connection = avesmapsBuildClientRouteSubPathConnection(
            $original, $slice['from'], $slice['to'], $slice['points'], $connectionId, $slice['profile']
        );
        avesmapsAddClientCompatibleGraphConnection($graph, $slice['from'], $slice['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $slice['to'], $slice['from'], avesmapsRouteReverseSubPathConnection($connection));
        $added++;
    }
    if ($added === count($slices)) {
        avesmapsRemoveClientRouteConnection($graph, $fromName, $toName, (string) ($original['id'] ?? ''));
    }

    foreach ($unique as $cut) {
        foreach ($cut['positions'] as $position) {
            $result[$position] = ['name' => $cut['name'], 'x' => $cut['x'], 'y' => $cut['y']];
        }
    }
    ksort($result);
    return array_values($result);
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/path-multisplit-test.php
```

Erwartet: `path-multisplit-test: OK`

- [ ] **Schritt 5: Die Nachbartests laufen lassen**

```bash
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 "$t" || echo "ROT: $t"; done
```

Erwartet: kein `ROT:`. Der Einzelteiler ist unangetastet, `water-bridge-test.php` und
`synthetic-distance-report-test.php` bleiben grün.

- [ ] **Schritt 6: Committen**

```bash
git status
git add api/_internal/routing/client-graph.php api/_internal/routing/__tests__/path-multisplit-test.php
git commit -F - <<'MSG'
feat(routing): der Mehrpunkt-Teiler -- eine Kante, k Schnitte, EIN Durchgang

Der Einzelteiler entfernt die Ursprungskante, sobald beide Haelften stehen. Ihn k-mal
aufzurufen laesst den zweiten Schnitt eine Kante suchen, die es nicht mehr gibt -- genau die
Doppelteilung, die am 14.08.2026 zwei unverbundene Fusspunkte an derselben Strasse erzeugt hat.

Der Einzelteiler bleibt unangetastet; er traegt den Wegpunkt-Anker und vier Tests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 2: Der Kandidatensammler

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php` (Konstante bei den übrigen Anker-Konstanten,
  Zeile ~44; Funktion nach `avesmapsCollectNearestClientLandPathAnchors`, Zeile ~960)
- Test: `api/_internal/routing/__tests__/exit-vertices-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsCollectNearestClientLandPathAnchors(array $graph, float $px, float $py, int $limit): array`
  — liefert je Kante einen Eintrag mit `from`, `to`, `connection`, `segment_index`, `t`,
  `proj_x`, `proj_y`, `distance`.
- Liefert: `avesmapsCollectClientLandPathExitCandidates(array $graph, float $px, float $py, int $limit): array`
  — Liste je Kante: `['anchor' => <Eintrag des Sammlers>, 'cuts' => [['segment_index' => int, 't' => float, 'x' => float, 'y' => float, 'distance' => float], …], 'capped' => int]`.
  `cuts` ist absteigend nach Nähe zum Ziel sortiert; `capped` zählt die weggefallenen Vertices.
- Neue Konstante: `AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT = 24`

- [ ] **Schritt 1: Den roten Test schreiben**

Datei `api/_internal/routing/__tests__/exit-vertices-test.php`:

```php
<?php
// api/_internal/routing/__tests__/exit-vertices-test.php
declare(strict_types=1);

/**
 * Ausstiegskandidaten: jeder gezeichnete Vertex eines Wegstuecks PLUS der Fusspunkt.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.1
 *
 * 💣 DIE ENTDOPPLUNG JE KANTE BLEIBT DER ANGELPUNKT. Sie ist der Grund, warum sechs
 * VERSCHIEDENE Strassen im Angebot stehen und nicht sechs Punkte auf derselben.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/exit-vertices-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';

$road = static function (array &$graph, string $from, string $to, array $points, string $id): void {
    $connection = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $id, 'path_id' => $id, 'from' => $from, 'to' => $to,
        'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
        'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
        'geometry' => ['type' => 'LineString', 'coordinates' => $points],
    ];
    avesmapsAddClientCompatibleGraphConnection($graph, $from, $to, $connection);
    avesmapsAddClientCompatibleGraphConnection($graph, $to, $from, $connection);
};

// ---- A: eine Strasse mit drei inneren Vertices -------------------------------------------
$graph = [];
$road($graph, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0], [16.0, 0.0]], 'weg#0');
$sets = avesmapsCollectClientLandPathExitCandidates($graph, 8.0, 6.0, 6);

assert(count($sets) === 1, 'eine Kante, ein Satz');
$cuts = $sets[0]['cuts'];

// Innere Vertices: (4,0), (8,0), (12,0). Der Fusspunkt liegt auf (8,0) und faellt mit einem
// Vertex zusammen -- er wird nicht doppelt gefuehrt.
$xs = array_map(static fn(array $c): float => round($c['x'], 6), $cuts);
sort($xs);
assert($xs === [4.0, 8.0, 12.0], 'genau die drei inneren Vertices, Fusspunkt entdoppelt: ' . json_encode($xs));

// 🔴 Endpunkte sind KEINE Kandidaten -- das sind bereits Graphknoten.
assert(!in_array(0.0, $xs, true) && !in_array(16.0, $xs, true), 'Endpunkte bleiben draussen');

// ---- B: der Fusspunkt liegt ZWISCHEN zwei Vertices und kommt zusaetzlich ins Angebot ------
$graph2 = [];
$road($graph2, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]], 'weg#0');
$sets2 = avesmapsCollectClientLandPathExitCandidates($graph2, 6.0, 3.0, 6);
$xs2 = array_map(static fn(array $c): float => round($c['x'], 6), $sets2[0]['cuts']);
sort($xs2);
assert($xs2 === [4.0, 6.0], 'innerer Vertex (4,0) UND Fusspunkt (6,0): ' . json_encode($xs2));

// ---- C: die Entdopplung je Kante bleibt --------------------------------------------------
$graph3 = [];
$road($graph3, 'A', 'B', [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]], 'weg#0');
$road($graph3, 'C', 'D', [[0.0, 20.0], [4.0, 20.0], [8.0, 20.0]], 'weg#1');
$sets3 = avesmapsCollectClientLandPathExitCandidates($graph3, 4.0, 2.0, 6);
assert(count($sets3) === 2, 'zwei Kanten, zwei Saetze -- nicht ein Satz mit allen Punkten');
$ids = array_map(static fn(array $s): string => (string) $s['anchor']['connection']['id'], $sets3);
assert($ids === ['weg#0', 'weg#1'], 'nach Naehe sortiert, je Kante einer: ' . json_encode($ids));

// ---- D: der Deckel greift und meldet sich ------------------------------------------------
$many = [];
for ($i = 0; $i <= 40; $i++) { $many[] = [(float) $i, 0.0]; }
$graph4 = [];
$road($graph4, 'A', 'B', $many, 'weg#0');
$sets4 = avesmapsCollectClientLandPathExitCandidates($graph4, 20.0, 5.0, 6);
assert(count($sets4[0]['cuts']) === AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT,
    'der Deckel begrenzt auf ' . AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT);
assert($sets4[0]['capped'] > 0, 'und die Kappung wird GEZAEHLT, nicht verschwiegen');
// Die zielnaechsten bleiben: (20,0) liegt genau unter dem Ziel.
$kept = array_map(static fn(array $c): float => $c['x'], $sets4[0]['cuts']);
assert(in_array(20.0, $kept, true), 'der zielnaechste Punkt ueberlebt den Deckel');

fwrite(STDOUT, "exit-vertices-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/exit-vertices-test.php
```

Erwartet: `Error: Call to undefined function avesmapsCollectClientLandPathExitCandidates()`

- [ ] **Schritt 3: Die Konstante setzen**

In `api/_internal/routing/client-graph.php` bei den übrigen Anker-Konstanten (~Zeile 44):

```php
// Wie viele gezeichnete Vertices EIN Wegstueck als Ausstieg beisteuern darf.
//
// ⚠️ Am Livebestand gemessen, nicht geraten (3.538 Landwege, innere Vertices je Feature):
// p50 = 3, p75 = 6, p90 = 10, p95 = 13, p99 = 23, max = 53. 32 Wege von 3.538 liegen darueber,
// keiner ueber 60. Ein Graph-Wegstueck ist kuerzer als sein Feature (an Kreuzungen geschnitten),
// die echten Zahlen liegen also darunter. Bei 24 bleiben 99 % der Wege unangetastet.
// 💣 Greift der Deckel, wird das GEZAEHLT und wandert in die Antwort -- eine stille Kappung
// liest sich wie „alles betrachtet" (AGENTS.md: „No silent caps").
const AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT = 24;
```

- [ ] **Schritt 4: Den Sammler bauen**

Nach `avesmapsCollectNearestClientLandPathAnchors` in derselben Datei:

```php
/**
 * Je Wegstueck ALLE gezeichneten inneren Vertices plus den Fusspunkt, als Ausstiegsangebot.
 *
 * 🔴 DAS IST DER KERN DES ABGANGSPUNKTS. Bis zum 15.08.2026 bot ein Wegstueck GENAU EINEN
 * Ausstieg an -- die Projektion des Ziels. Verlor der gegen den Direktweg, existierte die
 * Strasse fuer diese Reise nicht mehr. Owner, wortwoertlich: „es gibt kein ausstieg heute."
 *
 * ⚠️ DIE WEGAUSWAHL BLEIBT WIE SIE WAR: der Sammler darunter liefert weiter die $limit naechsten
 * KANTEN, eine je Kanten-id. Nur was eine Kante LIEFERT, aendert sich. Wer die Entdopplung
 * loest, weil ja jetzt ohnehin viele Punkte je Strasse kommen, bekommt sechs Nachbarn auf einem
 * Weg und sieht die schnelle Strasse zwei Taeler weiter nie (anchor-candidates-test.php).
 *
 * ⚠️ ENDPUNKTE SIND KEINE KANDIDATEN. Das sind bereits Graphknoten (Ortschaften oder
 * Kreuzungen) und stehen ueber den zweiten Topf zur Wahl; hier gefuehrt bekaemen sie einen
 * zweiten Namen.
 *
 * ⚠️ DER FUSSPUNKT BLEIBT IM ANGEBOT. Ohne ihn koennte eine Route schlechter werden als vor
 * dem Umbau. Das Angebot waechst, es wird nie kleiner.
 */
function avesmapsCollectClientLandPathExitCandidates(array $graph, float $px, float $py, int $limit): array {
    $sets = [];
    foreach (avesmapsCollectNearestClientLandPathAnchors($graph, $px, $py, $limit) as $anchor) {
        $coordinates = $anchor['connection']['geometry']['coordinates'] ?? [];
        if (!is_array($coordinates) || count($coordinates) < 2) { continue; }
        $count = count($coordinates);
        $epsilon = 1e-7;

        $cuts = [];
        $seen = [];
        $add = static function (int $i, float $t, float $x, float $y) use (&$cuts, &$seen, $px, $py, $epsilon): void {
            $key = sprintf('%.6f:%.6f', $x, $y);
            if (isset($seen[$key])) { return; }
            $seen[$key] = true;
            $cuts[] = ['segment_index' => $i, 't' => $t, 'x' => $x, 'y' => $y, 'distance' => hypot($x - $px, $y - $py)];
        };

        // Der Fusspunkt zuerst -- faellt er mit einem Vertex zusammen, gewinnt er den Platz und
        // der Vertex wird als Dublette verworfen (gleiche Koordinate, gleicher Schnitt).
        $projX = (float) ($anchor['proj_x'] ?? 0.0);
        $projY = (float) ($anchor['proj_y'] ?? 0.0);
        $projI = (int) ($anchor['segment_index'] ?? 0);
        $projT = (float) ($anchor['t'] ?? 0.0);
        $isEndpoint = ($projI === 0 && $projT <= $epsilon) || ($projI === $count - 2 && $projT >= 1.0 - $epsilon);
        if (!$isEndpoint) { $add($projI, $projT, $projX, $projY); }

        for ($i = 1; $i <= $count - 2; $i++) {
            $add($i, 0.0, (float) $coordinates[$i][0], (float) $coordinates[$i][1]);
        }

        usort($cuts, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);
        $capped = max(0, count($cuts) - AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT);
        if ($capped > 0) { $cuts = array_slice($cuts, 0, AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT); }
        if ($cuts === []) { continue; }

        $sets[] = ['anchor' => $anchor, 'cuts' => $cuts, 'capped' => $capped];
    }

    return $sets;
}
```

- [ ] **Schritt 5: Test laufen lassen, er muss grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/exit-vertices-test.php
```

Erwartet: `exit-vertices-test: OK`

- [ ] **Schritt 6: Alle PHP-Tests, dann committen**

```bash
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 "$t" || echo "ROT: $t"; done
git status
git add api/_internal/routing/client-graph.php api/_internal/routing/__tests__/exit-vertices-test.php
git commit -F - <<'MSG'
feat(routing): jeder gezeichnete Vertex eines Wegstuecks wird Ausstiegskandidat

Bis heute bot ein Wegstueck GENAU EINEN Ausstieg an, die Projektion des Ziels. Verlor der
gegen den Direktweg, war die Strasse fuer diese Reise verschwunden -- kein zweiter Vorschlag.
Die Wegauswahl bleibt unveraendert (die 6 naechsten Kanten, eine je id); nur was eine Kante
liefert, aendert sich.

Deckel je Wegstueck: 24 Vertices, am Livebestand gemessen (p99 = 23, max = 53, 32 von 3.538
Wegen darueber). Eine Kappung wird gezaehlt, nicht verschwiegen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 3: Der Mehrziel-Suchlauf

**Dateien:**
- Ändern: `api/_internal/routing/offroad-grid.php` (neue Funktion nach `avesmapsOffroadFindPath`,
  Zeile ~490)
- Test: `api/_internal/routing/__tests__/offroad-multi-goal-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsBuildOffroadBox`, `avesmapsOffroadCellOf`, `avesmapsOffroadCellCentre`,
  `avesmapsOffroadFreeAround`, `avesmapsOffroadHeightAtCell`, `avesmapsTerrainLeistungsFactor`,
  `avesmapsTerrainDescentIsSteep`, `avesmapsOffroadFinishPath`
- Liefert: `avesmapsOffroadFindPathsFromPoint(array $box, string $blocked, ?string $factors, ?string $heights, float $speed, float $x, float $y, array $goals, float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, array $rasters = []): array`
  — `$goals` ist `[$key => ['x' => float, 'y' => float], …]`; Rückgabe `[$key => <Pfad>|null]`
  mit derselben Struktur, die `avesmapsOffroadFindPath` liefert
  (`points`, `distance`, `time`, `ascent_schritt`, `descent_schritt`, `cells_opened`, …).
  Die `points` laufen **vom Ziel zum Kartenpunkt** — die Richtung, in die der Reisende geht.

- [ ] **Schritt 1: Den roten Test schreiben**

Datei `api/_internal/routing/__tests__/offroad-multi-goal-test.php`:

```php
<?php
// api/_internal/routing/__tests__/offroad-multi-goal-test.php
declare(strict_types=1);

/**
 * Ein Suchlauf, viele Ziele -- statt eines A*-Laufs je Kandidat.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.3
 *
 * 🔴 ER BEPREIST JEDEN SCHRITT IN GEGENRICHTUNG. Der Reisende geht vom Ausstieg zum
 * Kartenpunkt; der Lauf geht andersherum. Steigung kostet mehr als Gefaelle
 * (avesmapsTerrainLeistungsFactor), also ist der Anstieg eines Suchschritts u->v der Abstieg
 * des Reisenden. Ohne den Tausch waehlt der Lauf die Strecke der RUECKREISE.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-multi-goal-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-grid.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 20.0);
$flat = str_repeat("\x00", $box['cell_count']);
$speed = 2.30;

// ---- A: dasselbe Ergebnis wie der Einzellauf, fuer jedes Ziel ----------------------------
$goals = [
    'nah'  => ['x' => 6.0, 'y' => 6.0],
    'fern' => ['x' => 14.0, 'y' => 13.0],
];
$many = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0, $goals);

foreach ($goals as $key => $goal) {
    $single = avesmapsOffroadFindPath($box, $flat, null, null, $speed, $goal['x'], $goal['y'], 4.0, 4.0);
    assert(is_array($many[$key]), "Ziel $key wird erreicht");
    assert(abs($many[$key]['time'] - $single['time']) < 1e-6,
        "Ziel $key: Mehrziel {$many[$key]['time']} gegen Einzellauf {$single['time']}");
    assert(abs($many[$key]['distance'] - $single['distance']) < 1e-6, "Ziel $key: gleiche Strecke");
}

// ---- B: die Punkte laufen VOM ZIEL zum Kartenpunkt ---------------------------------------
$first = $many['nah']['points'][0];
$last = $many['nah']['points'][count($many['nah']['points']) - 1];
assert(abs($first[0] - 6.0) < 1e-9 && abs($first[1] - 6.0) < 1e-9, 'erster Punkt ist das ZIEL (der Ausstieg)');
assert(abs($last[0] - 4.0) < 1e-9 && abs($last[1] - 4.0) < 1e-9, 'letzter Punkt ist der Kartenpunkt');

// ---- C: ein unerreichbares Ziel ist null, die anderen bleiben ----------------------------
// Eine Mauer quer durch die Kiste, hinter der das dritte Ziel liegt.
$walled = $flat;
for ($row = 0; $row < $box['rows']; $row++) {
    $col = (int) floor($box['cols'] / 2);
    $walled[$row * $box['cols'] + $col] = "\x01";
}
$goals2 = ['diesseits' => ['x' => 5.0, 'y' => 5.0], 'jenseits' => ['x' => 18.0, 'y' => 18.0]];
$many2 = avesmapsOffroadFindPathsFromPoint($box, $walled, null, null, $speed, 4.0, 4.0, $goals2);
assert(is_array($many2['diesseits']), 'diesseits der Mauer erreichbar');
assert($many2['jenseits'] === null, 'jenseits der Mauer: null, nicht Ausnahme, nicht Abbruch');

// ---- D: der Lauf bricht ab, sobald das letzte Ziel steht ---------------------------------
$nurNah = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0,
    ['nah' => ['x' => 5.0, 'y' => 5.0]]);
$bisFern = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0,
    ['fern' => ['x' => 19.0, 'y' => 19.0]]);
assert($nurNah['nah']['cells_opened'] < $bisFern['fern']['cells_opened'] / 2,
    'ein nahes Ziel oeffnet deutlich weniger Zellen als ein fernes -- der Abbruch greift ('
    . $nurNah['nah']['cells_opened'] . ' gegen ' . $bisFern['fern']['cells_opened'] . ')');

// ---- E: die Rueckwaertsbepreisung ---------------------------------------------------------
// Eine Hoehenebene mit einer Stufe: der Kartenpunkt liegt TIEF, das Ziel HOCH. Der Reisende
// geht also bergAB. Die Zeit muss kleiner sein als im umgekehrten Fall.
$heights = str_repeat("\x00", $box['cell_count'] * 2);
$writeHeight = static function (string &$plane, int $index, int $value): void {
    $plane[$index * 2] = chr($value & 0xFF);
    $plane[$index * 2 + 1] = chr(($value >> 8) & 0xFF);
};
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        $centre = avesmapsOffroadCellCentre($box, $col, $row);
        $writeHeight($heights, $row * $box['cols'] + $col, (int) round($centre[1] * 60.0));
    }
}
$bergab = avesmapsOffroadFindPathsFromPoint($box, $flat, null, $heights, $speed, 6.0, 4.0,
    ['oben' => ['x' => 6.0, 'y' => 14.0]]);
$bergauf = avesmapsOffroadFindPathsFromPoint($box, $flat, null, $heights, $speed, 6.0, 14.0,
    ['unten' => ['x' => 6.0, 'y' => 4.0]]);
assert($bergab['oben']['time'] < $bergauf['unten']['time'],
    'von oben herunter ist billiger als von unten herauf ('
    . $bergab['oben']['time'] . ' gegen ' . $bergauf['unten']['time'] . ')');
assert($bergab['oben']['descent_schritt'] > $bergab['oben']['ascent_schritt'],
    'die Etappe vom hohen Ausstieg zum tiefen Kartenpunkt geht ueberwiegend bergAB');

fwrite(STDOUT, "offroad-multi-goal-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-multi-goal-test.php
```

Erwartet: `Error: Call to undefined function avesmapsOffroadFindPathsFromPoint()`

- [ ] **Schritt 3: Den Suchlauf bauen**

In `api/_internal/routing/offroad-grid.php`, nach `avesmapsOffroadFindPath`:

```php
/**
 * EIN Dijkstra-Lauf vom Kartenpunkt nach aussen, der ALLE Ausstiegskandidaten bedient.
 *
 * 🔴 ER ERSETZT EINEN LAUF JE KANDIDAT. Gemessen an der Route des Owners waren das 15 Laeufe
 * je Anfrage, die alle dasselbe Gelaende durchsuchen. Genau das macht „jeder gezeichnete Punkt
 * ist ein Kandidat" ueberhaupt bezahlbar: ein zusaetzlicher Kandidat ist ein Nachschlagen.
 *
 * 🔴 JEDER SCHRITT WIRD IN GEGENRICHTUNG BEPREIST. Der Reisende geht vom Ausstieg ZUM
 * Kartenpunkt; dieser Lauf geht vom Kartenpunkt WEG. Die Schrittkosten sind nicht symmetrisch --
 * avesmapsTerrainLeistungsFactor bestraft Steigung anders als Gefaelle. Der Anstieg eines
 * Suchschritts u->v ist deshalb `Hoehe(u) - Hoehe(v)`, nicht umgekehrt. Ohne den Tausch waehlt
 * der Lauf die guenstigste RUECKREISE. (avesmapsAddOffroadEdge behandelt denselben Tausch beim
 * Umdrehen der Kante.)
 *
 * ⚠️ KEINE HEURISTIK. Ohne einzelnes Ziel gibt es keine zulaessige Schaetzung; der Lauf ist ein
 * reiner Dijkstra. Die Bremse dagegen ist der Abbruch, sobald das letzte Ziel geschlossen ist --
 * NICHT die volle Kiste. Ohne ihn laeuft er ueber bis zu 150.000 Zellen und ist langsamer als
 * die Laeufe, die er ersetzt.
 *
 * @param array $goals [$key => ['x' => float, 'y' => float], ...]
 * @return array [$key => <Pfad wie avesmapsOffroadFindPath> | null]
 */
function avesmapsOffroadFindPathsFromPoint(
    array $box,
    string $blocked,
    ?string $factors,
    ?string $heights,
    float $speed,
    float $x,
    float $y,
    array $goals,
    float $eps = AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS,
    array $rasters = []
): array {
    $result = [];
    foreach ($goals as $key => $goal) { $result[$key] = null; }
    if ($speed <= 0.0 || $goals === []) { return $result; }

    $cols = $box['cols'];
    $cell = $box['cell'];
    [$startCol, $startRow] = avesmapsOffroadCellOf($box, $x, $y);
    $start = $startRow * $cols + $startCol;

    // ⚠️ Freigelegt wird um den Kartenpunkt UND um jedes Ziel. Ein Ausstieg, dessen Zelle im
    // Wasserpolygon liegt (Ufer-Zeichenspiel), waere sonst von der ersten Zelle an eingemauert --
    // dieselbe Begruendung wie beim Einzellauf (§5.2).
    avesmapsOffroadFreeAround($box, $blocked, $x, $y);
    $goalCells = [];
    $openGoals = [];
    foreach ($goals as $key => $goal) {
        avesmapsOffroadFreeAround($box, $blocked, (float) $goal['x'], (float) $goal['y']);
        [$goalCol, $goalRow] = avesmapsOffroadCellOf($box, (float) $goal['x'], (float) $goal['y']);
        $goalCell = $goalRow * $cols + $goalCol;
        $goalCells[$key] = $goalCell;
        $openGoals[$goalCell] = true;
    }

    $best = [$start => 0.0];
    $cameFrom = [];
    $closed = str_repeat("\x00", $box['cell_count']);
    $queue = new SplPriorityQueue();
    $queue->setExtractFlags(SplPriorityQueue::EXTR_DATA);
    $queue->insert($start, 0.0);
    $opened = 0;
    $remaining = count($openGoals);
    if (isset($openGoals[$start])) { $remaining--; unset($openGoals[$start]); }

    $neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (!$queue->isEmpty() && $remaining > 0) {
        $current = $queue->extract();
        if ($closed[$current] === "\x01") { continue; }
        $closed[$current] = "\x01";
        $opened++;
        if (isset($openGoals[$current])) { unset($openGoals[$current]); $remaining--; }

        $currentRow = intdiv($current, $cols);
        $currentCol = $current - $currentRow * $cols;
        $currentHeight = avesmapsOffroadHeightAtCell($heights, $current);
        $currentFactor = $factors === null || $factors === ''
            ? 1.0
            : (ord($factors[$current]) === 0 ? 1.0 : ord($factors[$current]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);

        foreach ($neighbours as [$deltaCol, $deltaRow]) {
            $nextCol = $currentCol + $deltaCol;
            $nextRow = $currentRow + $deltaRow;
            if ($nextCol < 0 || $nextRow < 0 || $nextCol >= $cols || $nextRow >= $box['rows']) { continue; }
            $next = $nextRow * $cols + $nextCol;
            if ($blocked[$next] === "\x01" || $closed[$next] === "\x01") { continue; }

            $distance = ($deltaCol !== 0 && $deltaRow !== 0) ? $cell * M_SQRT2 : $cell;

            $nextHeight = avesmapsOffroadHeightAtCell($heights, $next);
            $slopeFactor = 1.0;
            if ($currentHeight !== null && $nextHeight !== null) {
                // 🔴 GEGENRICHTUNG: der Reisende geht $next -> $current.
                $ascent = max(0.0, $currentHeight - $nextHeight);
                $drop = max(0.0, $nextHeight - $currentHeight);
                $steepDrop = avesmapsTerrainDescentIsSteep($drop, $distance) ? $drop : 0.0;
                $slopeFactor = avesmapsTerrainLeistungsFactor($ascent, $steepDrop, $distance);
            }

            $nextFactor = $factors === null || $factors === ''
                ? 1.0
                : (ord($factors[$next]) === 0 ? 1.0 : ord($factors[$next]) / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
            $groundFactor = max($currentFactor, $nextFactor);

            $cost = ($best[$current] ?? INF) + ($distance / $speed) * $slopeFactor * $groundFactor;
            if ($cost >= ($best[$next] ?? INF)) { continue; }

            $best[$next] = $cost;
            $cameFrom[$next] = $current;
            $queue->insert($next, -$cost);
        }
    }

    foreach ($goalCells as $key => $goalCell) {
        if ($goalCell !== $start && !isset($cameFrom[$goalCell])) { continue; }

        // Von der Zielzelle zurueck zum Start: die Reihenfolge ist bereits die des Reisenden.
        $cells = [];
        for ($node = $goalCell; $node !== $start; $node = $cameFrom[$node]) { $cells[] = $node; }
        $cells[] = $start;

        $points = [];
        foreach ($cells as $node) {
            $nodeRow = intdiv($node, $cols);
            $points[] = avesmapsOffroadCellCentre($box, $node - $nodeRow * $cols, $nodeRow);
        }
        if (count($points) < 2) { $points = [[(float) $goals[$key]['x'], (float) $goals[$key]['y']], [$x, $y]]; }

        // An die echten Endpunkte vernaeht (§5.4), wie beim Einzellauf.
        $points[0] = [(float) $goals[$key]['x'], (float) $goals[$key]['y']];
        $points[count($points) - 1] = [$x, $y];

        $result[$key] = avesmapsOffroadFinishPath($points, $speed, $factors, $heights, $box, $eps, $opened, $rasters);
    }

    return $result;
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-multi-goal-test.php
```

Erwartet: `offroad-multi-goal-test: OK`

⚠️ Sollte Abschnitt A um mehr als `1e-6` abweichen, ist die Ursache mit hoher Wahrscheinlichkeit
**nicht** ein Fehler, sondern der Unterschied zwischen A\*-Pfad und Dijkstra-Pfad bei
Kostengleichstand (zwei gleich teure Treppen). Dann die Toleranz **nicht** aufweichen, sondern
die Behauptung auf `time` prüfen und die Punktfolge aus der Zusicherung nehmen — beide Wege sind
gleich teuer, und der Test soll die Kosten sichern, nicht eine von zwei gleichwertigen Treppen.

- [ ] **Schritt 5: Alle PHP-Tests, dann committen**

```bash
for t in api/_internal/routing/__tests__/*-test.php; do php -d zend.assertions=1 -d assert.exception=1 "$t" || echo "ROT: $t"; done
git status
git add api/_internal/routing/offroad-grid.php api/_internal/routing/__tests__/offroad-multi-goal-test.php
git commit -F - <<'MSG'
feat(routing): ein Suchlauf vom Kartenpunkt statt eines A*-Laufs je Kandidat

Gemessen an der Route Salmingen -> Kartenpunkt liefen bisher 15 A*-Suchen je Anfrage durch
dasselbe Gelaende. Ein Dijkstra vom Kartenpunkt nach aussen bedient sie alle; ein zusaetzlicher
Kandidat ist danach ein Nachschlagen. Bremse ist der Abbruch beim letzten erreichten Ziel,
nicht die volle Suchkiste.

Er bepreist jeden Schritt in Gegenrichtung: der Reisende geht vom Ausstieg zum Kartenpunkt,
der Lauf geht andersherum, und Steigung kostet mehr als Gefaelle.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 4: Der Umbau des Aufrufers — und der Abnahmefall

**Dateien:**
- Ändern: `api/_internal/routing/offroad-leg.php:101-285` (`avesmapsAttachOffroadPointToGraph`)
- Test: `api/_internal/routing/__tests__/abgangspunkt-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsCollectClientLandPathExitCandidates` (Aufgabe 2),
  `avesmapsSplitClientPathAtPoints` (Aufgabe 1),
  `avesmapsOffroadFindPathsFromPoint` (Aufgabe 3),
  unverändert `avesmapsFindNearestOffroadExitNodes`, `avesmapsAddOffroadEdge`,
  `avesmapsBuildOffroadBox`, `avesmapsOffroadRasteriseBlocked`, `avesmapsOffroadLoadFactorPlane`,
  `avesmapsOffroadLoadHeightRasters`, `avesmapsOffroadSampleHeights`
- Liefert: `avesmapsAttachOffroadPointToGraph(...)` mit unveränderter Signatur und unverändertem
  Rückgabevertrag, ergänzt um `exit_vertices_capped` (int) im Erfolgsfall.

- [ ] **Schritt 1: Den Abnahmetest schreiben**

Datei `api/_internal/routing/__tests__/abgangspunkt-test.php`:

```php
<?php
// api/_internal/routing/__tests__/abgangspunkt-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL. Eine Strasse fuehrt schraeg am Ziel vorbei; der zielnaechste Punkt liegt
 * kurz vor ihrem Ende und verliert gegen den Direktweg. Vor dem 15.08.2026 war er der EINZIGE
 * Vorschlag -- die Reise lief deshalb vom Startort querfeldein, neben der Strasse her.
 *
 * Nachbau der Route des Owners: Salmingen -> Kartenpunkt (504.530, 501.076), Talloner
 * Huegelsteig. Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §1
 *
 * 🔴 GEGEN DEN ALTEN STAND ROT. Nachweis:
 *   git show HEAD:api/_internal/routing/offroad-leg.php > /tmp/alt.php
 *   ... alte Fassung einspielen, Test laufen lassen, zurueckkopieren.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/abgangspunkt-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-leg.php';

// Eine Strasse, die vom Startort weg erst auf das Ziel zulaeuft und dann seitlich abknickt --
// die Gestalt des Talloner Huegelsteigs, auf runde Zahlen gebracht.
$graph = [];
$points = [[0.0, 0.0], [0.0, -6.0], [4.0, -9.0], [8.0, -10.0]];
$connection = [
    'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'huegelsteig#0', 'path_id' => 'huegelsteig#0', 'from' => 'Salmingen', 'to' => 'Tarnelfurt',
    'distance' => avesmapsCalculateClientRouteCoordinateDistance($points),
    'time' => avesmapsCalculateClientRouteCoordinateDistance($points) / 3.07,
    'geometry' => ['type' => 'LineString', 'coordinates' => $points],
];
avesmapsAddClientCompatibleGraphConnection($graph, 'Salmingen', 'Tarnelfurt', $connection);
avesmapsAddClientCompatibleGraphConnection($graph, 'Tarnelfurt', 'Salmingen', $connection);

$locations = [
    ['name' => 'Salmingen', 'geometry' => ['coordinates' => [0.0, 0.0]]],
    ['name' => 'Tarnelfurt', 'geometry' => ['coordinates' => [8.0, -10.0]]],
];
$clientGraph = ['graph' => $graph];
$request = [
    'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'synthetic' => true],
];

// Das Ziel liegt links neben dem Knick -- so, dass der zielnaechste Punkt weit hinten liegt.
$targetX = -9.0; $targetY = -7.0;
$report = avesmapsAttachOffroadPointToGraph(
    $clientGraph, $locations, $request, [], [], null, $targetX, $targetY, '__offroad_to', false
);

assert($report['ok'] === true, 'der Punkt wird angebunden: ' . json_encode($report));

// 🔴 DER KERN: es gibt MEHR ALS EINEN Ausstieg auf dieser Strasse.
$anchorExits = array_values(array_filter(
    $report['exit_nodes'],
    static fn(array $exit): bool => str_starts_with((string) $exit['node'], AVESMAPS_ROUTE_CLIENT_ANCHOR_NODE_PREFIX)
));
assert(count($anchorExits) >= 2,
    'die Strasse bietet mehr als EINEN Ausstieg an, gefunden: ' . count($anchorExits));

// Und der Dijkstra findet einen, der billiger ist als der Direktweg ab Salmingen.
$direct = null;
foreach ($report['exit_nodes'] as $exit) {
    if ($exit['node'] === 'Salmingen') { $direct = (float) $exit['cost_units']; }
}
assert($direct !== null, 'der Direktweg ab Salmingen steht weiter im Angebot');

$roadSpeed = 3.07;
$bestTotal = $direct;
$bestNode = 'Salmingen';
foreach ($anchorExits as $exit) {
    // Strassenkosten Salmingen -> Ausstieg, aus dem geteilten Graphen summiert.
    $roadCost = 0.0;
    $node = 'Salmingen';
    $seen = [];
    while ($node !== $exit['node']) {
        $stepped = false;
        foreach ($clientGraph['graph'][$node] ?? [] as $to => $connections) {
            if (isset($seen[$to])) { continue; }
            foreach ($connections as $c) {
                if ((string) ($c['route_type'] ?? '') !== 'Strasse') { continue; }
                $seen[$node] = true;
                $roadCost += (float) $c['distance'] / $roadSpeed;
                $node = (string) $to;
                $stepped = true;
                break 2;
            }
        }
        if (!$stepped) { break; }
    }
    $total = $roadCost + (float) $exit['cost_units'];
    if ($total < $bestTotal) { $bestTotal = $total; $bestNode = (string) $exit['node']; }
}

assert($bestNode !== 'Salmingen',
    'ein Ausstieg AUF der Strasse schlaegt den Direktweg -- gewaehlt: ' . $bestNode);
assert($bestTotal < $direct - 1e-9,
    "billiger als der Direktweg: $bestTotal gegen $direct");

// ⚠️ Alle heutigen Kandidaten bleiben: die Ortschaften stehen weiter im Angebot.
$names = array_map(static fn(array $e): string => (string) $e['node'], $report['exit_nodes']);
assert(in_array('Tarnelfurt', $names, true), 'die Ortschaften bleiben im Angebot');

// Der Zaehler der gekappten Vertices ist da, auch wenn er 0 ist.
assert(array_key_exists('exit_vertices_capped', $report), 'die Kappung wird gemeldet');

fwrite(STDOUT, "abgangspunkt-test: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/abgangspunkt-test.php
```

Erwartet: `assert(count($anchorExits) >= 2)` schlägt fehl mit `gefunden: 1` — der heutige Stand
bietet genau einen Ausstieg je Straße.

🔴 **Das ist der Rot-Beleg gegen den alten Stand** (Abnahmekriterium 3 des Entwurfs). Diesen
Fehlschlag mit der Ausgabe ins Commit-Protokoll aufnehmen.

- [ ] **Schritt 3: Den Aufrufer umbauen**

In `api/_internal/routing/offroad-leg.php`, `avesmapsAttachOffroadPointToGraph`: der Block
zwischen der Verkehrsmittel-Prüfung und dem Rückgabewert wird ersetzt. Die Landprüfung, die
Sperre und die Tempo-Auflösung darüber bleiben **unverändert**.

```php
    $graph = is_array($clientGraph['graph'] ?? null) ? $clientGraph['graph'] : [];

    // 🔴 DIE AUSSTIEGE SIND PUNKTE AUF WEGEN, NICHT ORTSCHAFTEN -- und seit dem 15.08.2026 ist es
    // JEDER GEZEICHNETE PUNKT eines Wegstuecks, nicht nur der zielnaechste. Vorher bot ein
    // Wegstueck genau einen an; verlor der gegen den Direktweg, war die Strasse fuer diese Reise
    // verschwunden. Owner, wortwoertlich: „es gibt kein ausstieg heute."
    //
    // ⚠️ ERST SAMMELN UND FILTERN, DANN TEILEN. Bis zum 15.08.2026 wurde geteilt und danach
    // gefiltert; bei EINEM Kandidaten je Weg war das gleichgueltig, bei bis zu 24 hiesse es, eine
    // Strasse fuer Punkte zu zerschneiden, die ohnehin herausfallen.
    $candidateSets = avesmapsCollectClientLandPathExitCandidates($graph, $x, $y, AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT);
    $nodeCandidates = avesmapsFindNearestOffroadExitNodes($graph, $locations, $x, $y);

    $anchorPointCount = 0;
    foreach ($candidateSets as $set) { $anchorPointCount += count($set['cuts']); }
    if ($anchorPointCount === 0 && $nodeCandidates === []) {
        return ['ok' => false, 'error' => 'no_exit_node'];
    }

    // 💣 DER MASSSTAB DER REICHWEITE IST DER NAECHSTE ORTSKNOTEN, nicht der naechste Kandidat
    // ueberhaupt. Ihre Aufgabe ist die GROESSE DER SUCHKISTE, und die spannten seit jeher die
    // Ortschaften auf. Beide falschen Fassungen sind am 14.08.2026 live gemessen worden
    // (AGENTS.md §11). Die neuen Vertices sind Kandidaten wie alle anderen und SETZEN den
    // Massstab nie -- ausser es gibt ueberhaupt keine Ortschaft im Angebot.
    $nearestVertexDistance = INF;
    foreach ($candidateSets as $set) {
        foreach ($set['cuts'] as $cut) { $nearestVertexDistance = min($nearestVertexDistance, (float) $cut['distance']); }
    }
    $reference = $nodeCandidates !== []
        ? (float) $nodeCandidates[0]['distance']
        : $nearestVertexDistance;
    $reach = max($reference * AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR, $reference);

    // Zwei Stufen wie bisher: erst die nahen, und nur wenn keiner traegt, alle.
    $verticesCapped = 0;
    foreach ($candidateSets as $set) { $verticesCapped += (int) $set['capped']; }

    $buildCandidates = static function (float $limit) use (&$clientGraph, $candidateSets, $nodeCandidates): array {
        $candidates = [];
        foreach ($candidateSets as $set) {
            $kept = array_values(array_filter(
                $set['cuts'],
                static fn(array $cut): bool => (float) $cut['distance'] <= $limit + 1e-9
            ));
            if ($kept === []) { continue; }
            // 💣 EIN DURCHGANG JE WEGSTUECK. Der Einzelteiler entfernt die Ursprungskante, sobald
            // beide Haelften stehen -- k Aufrufe hintereinander haengen die Punkte ins Leere.
            $split = avesmapsSplitClientPathAtPoints($clientGraph['graph'], $set['anchor'], $kept);
            foreach ($split as $index => $node) {
                if ($node['name'] === '') { continue; }
                $candidates[] = [
                    'name' => $node['name'], 'x' => $node['x'], 'y' => $node['y'],
                    'distance' => (float) $kept[$index]['distance'],
                ];
            }
        }
        foreach ($nodeCandidates as $node) {
            if ((float) $node['distance'] > $limit + 1e-9) { continue; }
            $candidates[] = $node;
        }
        // Ein Fusspunkt, der auf einem Endknoten liegt, TRAEGT dessen Namen -- ohne Entdopplung
        // liefe der Suchlauf zweimal zum selben Ziel.
        $byName = [];
        foreach ($candidates as $candidate) {
            $name = (string) $candidate['name'];
            if (!isset($byName[$name]) || (float) $byName[$name]['distance'] > (float) $candidate['distance']) {
                $byName[$name] = $candidate;
            }
        }
        $out = array_values($byName);
        usort($out, static fn(array $a, array $b): int => $a['distance'] <=> $b['distance']);
        return $out;
    };

    $box = [];
    $rasters = [];
    $factors = '';
    $exits = [];
    $offered = 0;
    foreach ([$reach, INF] as $stageLimit) {
        if ($exits !== []) { break; }
        $set = $buildCandidates($stageLimit);
        if ($set === []) { continue; }
        $offered = count($set);

        $spanMinX = $x; $spanMaxX = $x; $spanMinY = $y; $spanMaxY = $y;
        foreach ($set as $candidate) {
            $spanMinX = min($spanMinX, $candidate['x']); $spanMaxX = max($spanMaxX, $candidate['x']);
            $spanMinY = min($spanMinY, $candidate['y']); $spanMaxY = max($spanMaxY, $candidate['y']);
        }
        $box = avesmapsBuildOffroadBox($spanMinX, $spanMinY, $spanMaxX, $spanMaxY);
        $blocked = avesmapsOffroadRasteriseBlocked($box, $water);
        $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
        $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
        $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);

        $clientGraph['graph'][$nodeName] ??= [];

        // 🔴 EIN LAUF FUER ALLE. Bis zum 15.08.2026 lief hier ein A* JE KANDIDAT -- gemessen 15
        // Suchen je Anfrage durch dasselbe Gelaende.
        $goals = [];
        foreach ($set as $index => $candidate) { $goals[$index] = ['x' => $candidate['x'], 'y' => $candidate['y']]; }
        $paths = avesmapsOffroadFindPathsFromPoint($box, $blocked, $factors, $heights, (float) $speed, $x, $y, $goals,
            AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);

        foreach ($set as $index => $candidate) {
            $path = $paths[$index] ?? null;
            if ($path === null) { continue; }
            avesmapsAddOffroadEdge($clientGraph['graph'], $candidate['name'], $nodeName, $path, (string) $transport, 'offroad-' . $nodeName . '-' . $index);
            $exits[] = [
                'node' => $candidate['name'],
                'air_distance' => $candidate['distance'],
                'distance_units' => $path['distance'],
                'cost_units' => $path['time'],
                'point_count' => count($path['points']),
            ];
        }
    }
```

Im Erfolgsfall wird der Rückgabewert um eine Zeile ergänzt (die übrigen Schlüssel bleiben):

```php
        'exit_vertices_capped' => $verticesCapped,
```

Und im `no_offroad_route`-Fall ebenso, damit die Diagnose beide Wege trägt.

- [ ] **Schritt 4: Test laufen lassen, er muss grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/abgangspunkt-test.php
```

Erwartet: `abgangspunkt-test: OK`

- [ ] **Schritt 5: Das ganze PHP-Testfeld**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: nur der vorbestehend rote `linkcheck/link-url-test.php`, sonst nichts.

- [ ] **Schritt 6: Committen**

```bash
git status
git add api/_internal/routing/offroad-leg.php api/_internal/routing/__tests__/abgangspunkt-test.php
git commit -F - <<'MSG'
fix(routing): eine Strasse bietet jetzt jeden ihrer Punkte als Ausstieg an, nicht einen

Der Abnahmefall des Owners: Salmingen -> Kartenpunkt (504.530, 501.076) lief 42,06 Meilen
querfeldein NEBEN dem Talloner Huegelsteig her, weil dessen einziger Vorschlag -- der
zielnaechste Punkt kurz vor Tarnelfurt -- gegen den Direktweg verlor und es keinen zweiten gab.

Gesammelt und gefiltert wird jetzt VOR dem Teilen, geteilt in einem Durchgang je Wegstueck,
und ein einziger Suchlauf bepreist alle Kandidaten statt einer je Kandidat.

Die Reichweitenschranke und ihr Massstab (naechster Ortsknoten, x2,5) sind unangetastet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 5: Live messen, bevor irgendetwas hochgeht

Kein Code. Dieser Schritt ist ein **Tor**: das Ergebnis geht an den Owner, bevor gepusht wird
(Abnahmekriterium 5 des Entwurfs).

- [ ] **Schritt 1: Den heutigen Stand messen** (die Live-Seite trägt noch den alten Code)

```bash
curl -s -o /dev/null -w "alt: HTTP %{http_code}  %{time_total}s\n" -X POST https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{"from":"Salmingen","to":"Kartenpunkt","to_point":{"x":501.076,"y":504.530},"optimize":"fastest","include_geometry":false,"include_steps":true,"minimize_transfers":false,"transports":{"land":"groupFoot","river":"riverSailer","sea":"cargoShip","synthetic":"groupFoot"},"enabled_transports":{"land":true,"river":true,"sea":true,"synthetic":true}}'
```

🪤 **Eine Probe, keine Schleife.** Der Endpunkt lädt die volle Feature-Tabelle; das Projekt hat
auf STRATO damit schon einmal die PHP-Worker gesättigt.

- [ ] **Schritt 2: Den neuen Stand lokal gegen dieselbe Anfrage messen**

Erfordert eine lokale PHP-Ausführung des Endpunkts. Steht keine bereit, wird stattdessen die
Zahl der geöffneten Zellen verglichen: `cells_opened` des einen Laufs gegen die Summe der
`cells_opened` aller Läufe des alten Stands, gemessen mit einem Wegwerf-Skript im
Scratchpad-Verzeichnis über `avesmapsOffroadFindPath` bzw. `avesmapsOffroadFindPathsFromPoint`
mit derselben Kiste. ⚠️ Diese Ersatzmessung ist als Ersatzmessung zu **benennen**, nicht als
Laufzeit auszugeben.

- [ ] **Schritt 3: Dem Owner beide Zahlen nennen**, bevor gepusht wird. Steigt die Laufzeit,
      wird nicht gepusht, sondern gemeldet.

---

## Aufgabe 6: Die richtungsabhängige Beschriftung

**Dateien:**
- Ändern: `js/routing/route-plan.js` (neue Funktion neben `cleanRoutePlanNoiseEntries`,
  aufgerufen am Ende von `buildRoutePlanEntries`-Nachbearbeitung)
- Test: `js/routing/__tests__/abgangspunkt-label.test.js`

**Schnittstellen:**
- Verbraucht: `SYNTHETIC_ROUTE_TYPE` (aus `js/config.js`), `isRoutePlanMarkerName(name)`
- Liefert: `nameRoutePlanTransferPoints(entries)` — nimmt die fertige Anzeige-Etappenliste und
  gibt sie mit benannten Übergangspunkten zurück.

⚠️ **Was der Reisende heute sieht, ist „Markierung", nicht „Kreuzung".**
`normalizeNodeName` macht aus `__wp_anchor_7` zunächst „Kreuzung", und
`formatRoutePlanNodeName` zeigt „Kreuzung" als **„Markierung"** an. Beide bleiben stehen — sie
bedienen auch Beschriftungen außerhalb der Etappenliste, und ein rohes `__wp_anchor_7` darf
nirgends auftauchen.

🔴 **Die Benennung läuft NACH `cleanRoutePlanNoiseEntries`.** Diese Funktion entscheidet über
`isRoutePlanMarkerName(open.endName)`, ob eine Etappe geschlossen wird. Würde vorher umbenannt,
änderte sich die Aggregation — und genau die sorgt dafür, dass Straße und Querfeldein zwei
Etappen bleiben (`entryIsSynthetic !== openIsSynthetic`).

- [ ] **Schritt 1: Den roten Test schreiben**

Datei `js/routing/__tests__/abgangspunkt-label.test.js`:

```js
// js/routing/__tests__/abgangspunkt-label.test.js
// Der Uebergang zwischen Strasse und Querfeldein bekommt einen NAMEN, und der haengt an der
// Richtung: "Abgangspunkt" wo die Reise die Strasse verlaesst, "Anschlusspunkt" wo sie auf sie
// trifft. Owner-Entscheid 15.08.2026.
//
// Lauf: node js/routing/__tests__/abgangspunkt-label.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "route-plan.js"), "utf8");
const context = {
	SYNTHETIC_ROUTE_TYPE: "Querfeldein",
	console,
	normalizeNodeName: (name) => String(name || "").replace(/Kreuzung-\d+/i, "Kreuzung").replace(/__wp_anchor_\d+/i, "Kreuzung"),
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "route-plan.js" });

const strasse = (startName, endName) => ({ type: "Strasse", startName, endName });
const quer = (startName, endName) => ({ type: "Querfeldein", startName, endName });

// ---- A: Strasse -> Querfeldein = Abgangspunkt --------------------------------------------
let entries = context.nameRoutePlanTransferPoints([
	strasse("Salmingen", "Kreuzung"),
	quer("Kreuzung", "Kartenpunkt (504.530, 501.076)"),
]);
assert.strictEqual(entries[0].endName, "Abgangspunkt", "die Strasse endet am Abgangspunkt");
assert.strictEqual(entries[1].startName, "Abgangspunkt", "und das Gelaende beginnt dort");
assert.strictEqual(entries[0].startName, "Salmingen", "der echte Ort bleibt unangetastet");

// ---- B: Querfeldein -> Strasse = Anschlusspunkt -------------------------------------------
entries = context.nameRoutePlanTransferPoints([
	quer("Kartenpunkt (504.530, 501.076)", "Kreuzung"),
	strasse("Kreuzung", "Salmingen"),
]);
assert.strictEqual(entries[0].endName, "Anschlusspunkt", "das Gelaende endet am Anschlusspunkt");
assert.strictEqual(entries[1].startName, "Anschlusspunkt", "und die Strasse beginnt dort");

// ---- C: zwei Landetappen an einer echten Kreuzung bleiben, wie sie sind -------------------
entries = context.nameRoutePlanTransferPoints([
	strasse("Salmingen", "Kreuzung"),
	strasse("Kreuzung", "Tarnelfurt"),
]);
assert.strictEqual(entries[0].endName, "Kreuzung", "ohne Querfeldein daneben wird nichts umbenannt");

// ---- D: ein echter ORT am Uebergang behaelt seinen Namen ----------------------------------
entries = context.nameRoutePlanTransferPoints([
	strasse("Salmingen", "Tarnelfurt"),
	quer("Tarnelfurt", "Kartenpunkt (504.530, 501.076)"),
]);
assert.strictEqual(entries[0].endName, "Tarnelfurt", "ein Ort ist kein Abgangspunkt");
assert.strictEqual(entries[1].startName, "Tarnelfurt", "und bleibt es auf beiden Seiten");

// ---- E: eine einzelne Querfeldein-Etappe bleibt unberuehrt --------------------------------
entries = context.nameRoutePlanTransferPoints([quer("Salmingen", "Kartenpunkt (504.530, 501.076)")]);
assert.strictEqual(entries[0].startName, "Salmingen", "nichts zu benennen");

console.log("abgangspunkt-label.test.js: OK");
```

- [ ] **Schritt 2: Test laufen lassen, er muss fehlschlagen**

```bash
node js/routing/__tests__/abgangspunkt-label.test.js
```

Erwartet: `TypeError: context.nameRoutePlanTransferPoints is not a function`

- [ ] **Schritt 3: Die Benennung bauen**

In `js/routing/route-plan.js`, direkt nach `cleanRoutePlanNoiseEntries`:

```js
// Der Uebergang zwischen einem gezeichneten Weg und einer Querfeldein-Etappe bekommt einen
// NAMEN -- und der haengt an der Richtung (Owner-Entscheid 15.08.2026):
//   Weg -> Gelaende  = "Abgangspunkt"   (dort verlaesst die Reise die Strasse)
//   Gelaende -> Weg  = "Anschlusspunkt" (dort trifft sie auf sie)
//
// 🔴 LAEUFT NACH cleanRoutePlanNoiseEntries. Jene Funktion entscheidet ueber
// isRoutePlanMarkerName(open.endName), ob eine Etappe geschlossen wird; ein frueherer
// Umbenennung aenderte die Aggregation, und genau die haelt Weg und Gelaende auseinander.
//
// ⚠️ Nur an einer MARKIERUNG. Ein echter Ort am Uebergang behaelt seinen Namen -- „von
// Salmingen bis Abgangspunkt" ist eine Auskunft, „von Salmingen bis Tarnelfurt" ist eine
// bessere.
function nameRoutePlanTransferPoints(entries) {
	if (!Array.isArray(entries) || entries.length < 2) {
		return (entries || []).map((entry) => ({ ...entry }));
	}
	const result = entries.map((entry) => ({ ...entry }));
	for (let index = 0; index < result.length - 1; index++) {
		const current = result[index];
		const next = result[index + 1];
		const currentIsOffroad = current.type === SYNTHETIC_ROUTE_TYPE;
		const nextIsOffroad = next.type === SYNTHETIC_ROUTE_TYPE;
		if (currentIsOffroad === nextIsOffroad) {
			continue;
		}
		if (!isRoutePlanMarkerName(current.endName)) {
			continue;
		}
		const label = nextIsOffroad
			? tr("planner.leg.exitPoint", "Abgangspunkt")
			: tr("planner.leg.joinPoint", "Anschlusspunkt");
		current.endName = label;
		next.startName = label;
	}
	return result;
}
```

⚠️ Der Testkontext stellt `tr` nicht bereit — im Test wird `tr` deshalb als Durchreiche
ergänzt. Dazu in `abgangspunkt-label.test.js` vor `vm.runInContext` in `context` aufnehmen:

```js
	tr: (key, fallback) => fallback,
```

Und die Aufrufstelle. In `js/routing/route-plan.js:855` steht heute

```js
	const cleaned = cleanRoutePlanNoiseEntries(entries);
```

daraus wird

```js
	const cleaned = nameRoutePlanTransferPoints(cleanRoutePlanNoiseEntries(entries));
```

⚠️ `route-plan-offroad-tail.test.js` ruft `cleanRoutePlanNoiseEntries` **direkt** auf, an elf
Stellen. Diese Aufrufe bleiben unangetastet und müssen grün bleiben — der Beleg dafür, dass die
Aggregation selbst nicht angefasst wurde.

- [ ] **Schritt 4: Test laufen lassen, er muss grün sein**

```bash
node js/routing/__tests__/abgangspunkt-label.test.js
```

Erwartet: `abgangspunkt-label.test.js: OK`

- [ ] **Schritt 5: Die englischen Zeichenketten nachziehen**

In `js/app/i18n-en.js` die beiden Schlüssel ergänzen (die Datei wird gerade von einer anderen
Sitzung angefasst — 🔴 vor dem Bearbeiten `git status` prüfen und, falls sie fremd geändert ist,
diesen Schritt **auslassen** und dem Owner melden):

```js
	"planner.leg.exitPoint": "Exit point",
	"planner.leg.joinPoint": "Junction point",
```

- [ ] **Schritt 6: Das ganze JS-Testfeld, dann committen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
git status
git add js/routing/route-plan.js js/routing/__tests__/abgangspunkt-label.test.js
git commit -F - <<'MSG'
ui(routing): der Uebergang zwischen Weg und Gelaende heisst Abgangspunkt bzw. Anschlusspunkt

Bisher stand dort "Markierung" -- der Ausstiegsknoten wurde global auf "Kreuzung" normalisiert
und fuer die Anzeige noch einmal umbenannt. Auf freier Strecke ist dort keine Kreuzung, und die
Richtung entscheidet: die Reise verlaesst die Strasse (Abgangspunkt) oder trifft auf sie
(Anschlusspunkt). Owner-Entscheid 15.08.2026.

Die Benennung laeuft NACH der Etappenaggregation: jene entscheidet an isRoutePlanMarkerName,
ob eine Etappe geschlossen wird, und genau das haelt Weg und Gelaende auseinander.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 7: Abnahme am lebenden Objekt

Kein Code. 🔴 Ohne diesen Schritt gilt nichts als fertig (AGENTS.md §9: *Abnahme heißt ABLAUF,
nicht Maß*).

- [ ] **Schritt 1: Die Fallenliste des Entwurfs abhaken.** §7 des Entwurfs, elf Zeilen, jede
      einzeln: erfüllt, oder ausdrücklich verworfen mit Begründung. Das Ergebnis geht in die
      Nachricht an den Owner.

- [ ] **Schritt 2: Das ganze Testfeld, PHP und JS**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT JS: $t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 "$t" >/dev/null || echo "ROT PHP: $t"; done
```

💣 Ein einziger roter Test lädt **nichts** hoch, und der Fehlschlag vergiftet danach den
`?v=`-Stempel (AGENTS.md §9). Ausnahme: der vorbestehend rote `linkcheck/link-url-test.php`.

- [ ] **Schritt 3: Pushen**

```bash
git fetch origin && git rebase origin/master --autostash
git push origin master
git log origin/master --oneline -1
```

⚠️ Bei Zurückweisung: `fetch` + `rebase` + erneut. **Niemals** `--force`.

- [ ] **Schritt 4: 1–2 Minuten warten, dann die Route live prüfen**

```bash
curl -s -X POST https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{"from":"Salmingen","to":"Kartenpunkt","to_point":{"x":501.076,"y":504.530},"optimize":"fastest","include_geometry":false,"include_steps":true,"minimize_transfers":false,"transports":{"land":"groupFoot","river":"riverSailer","sea":"cargoShip","synthetic":"groupFoot"},"enabled_transports":{"land":true,"river":true,"sea":true,"synthetic":true}}'
```

Erwartet: **zwei** Segmente — `Strasse` rund 2,6 Karteneinheiten (7,8 Meilen) von `Salmingen`
nach `__wp_anchor_N`, dann `Querfeldein` rund 11,2 Einheiten (33,7 Meilen) nach `__offroad_to`.
Gesamtkosten rund 6,18 statt 6,5396.

🪤 **`to_point` will `{x: lng, y: lat}`.** Die Oberfläche zeigt „Kartenpunkt (504.530, 501.076)"
als **lat, lng**. Wer die Zahlen ungedreht übernimmt, misst eine gespiegelte Stelle der Karte —
das hat am 15.08.2026 eine Stunde gekostet.

- [ ] **Schritt 5: Die Route im Browser ansehen**, unter `https://avesmaps.de/?s=9PtTgmCH`:
      - Läuft die Linie erst auf dem Talloner Hügelsteig und knickt dann ab, oder klafft an der
        Naht etwas?
      - Wechselt sie dort sauber von durchgezogen auf gestrichelt (`SYNTHETIC_ROUTE_STYLE`)?
      - Zeigt die Etappenliste **zwei** Zeilen, und heißt der Übergang „Abgangspunkt"?
      - Stimmt die Summe der Etappen mit der Reiseübersicht?

      ⚠️ Was ein Emulator nicht beantworten kann, wird als offene Frage gemeldet, nicht als
      bestanden.

- [ ] **Schritt 6: Dem Owner melden** — mit der Etappenliste, den beiden Meilenzahlen, der
      Laufzeit gegen vorher und der abgehakten Fallenliste. Erst danach ist die Aufgabe fertig.

---

## Was dieser Bauplan NICHT tut

- Er fasst **„kürzeste" gegen „schnellste"** nicht an (Owner, 15.08.2026).
- Er rührt die drei anderen Querfeldein-Erzeuger nicht an — Wegpunkt-Anker, direkte Kante
  zwischen zwei Kartenpunkten, Umweg-Sehnen. Sie leiden am selben Fehler und ziehen nach, wenn
  dieser hier steht und gemessen ist.
- Er erfindet keine Punkte auf Straßen. Nur gezeichnete Vertices.
- Er verschiebt keine Schranke, um ein Ergebnis zu erzwingen.
