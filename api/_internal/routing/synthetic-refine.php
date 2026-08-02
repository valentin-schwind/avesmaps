<?php

declare(strict_types=1);

// Instruction C §3: der Anker und die Komponentenbrücke bekommen den A*.
//
// Beide ziehen bis heute GERADE SEHNEN. Sie kennen seit V13 die Wassersperre -- die Sehne wird
// geprüft, die Kante entsteht sonst gar nicht -- aber sie biegen nicht: kein Gelände, keine Höhe,
// keine Vereinfachung. Live gemessen (2026-08-02) lagen deshalb in EINER Route zwei fast gleich
// lange Querfeldein-Etappen nebeneinander: die Ankeretappe mit 2 Punkten, die A*-Etappe mit 16.
//
// Der Rechner dafür steht seit „Hierher reisen". Diese Datei ist nur die Stelle, an der er auf eine
// bereits gefundene Route angewandt wird.
//
// 🔴 UND GENAU DESHALB NACHTRÄGLICH, NICHT BEIM GRAPHBAU. Am Livebestand gemessen: 876 synthetische
// Kanten je Graph, aber NULL BIS EINE je Route (fünf Referenzrouten, 2026-08-02). Alle beim Bau zu
// biegen hieße, 876 Suchen samt Rasterabfragen für eine einzige benutzte Kante zu bezahlen -- und
// das bei jeder Anfrage, auch bei denen, die gar keine Notbrücke betreten.
//
// PURITY CONTRACT: side-effect-free on include. Ohne PDO rechnet der A* flach weiter.

require_once __DIR__ . '/offroad-leg.php';

/**
 * Ersetzt die geraden Sehnen der gefundenen Route durch A*-Wege. Gibt einen Bericht zurück; ist
 * `refined` > 0, muss der Aufrufer den Dijkstra erneut laufen lassen.
 *
 * ⚠️ Der neue Weg ist LÄNGER als die Sehne -- er weicht ja aus. Damit kann die Route eine andere
 * werden, und deshalb ist ein zweiter Dijkstra-Lauf kein Luxus, sondern die Bedingung dafür, dass
 * die Antwort noch die günstigste ist.
 */
function avesmapsRefineSyntheticRouteLegs(
    array &$clientGraph,
    array $request,
    array $water,
    ?PDO $pdo,
    array $segments,
    bool $terrainEnabled = true
): array {
    $report = ['examined' => 0, 'refined' => 0, 'legs' => []];

    foreach ($segments as $segment) {
        // Eine Sehne ist: synthetisch, noch nicht gebogen, und mit genau zwei Punkten. Die A*-Etappen
        // aus „Hierher reisen" und aus §2 tragen `offroad` und sind hier fertig.
        if (empty($segment['synthetic']) || !empty($segment['offroad'])) { continue; }
        $coordinates = $segment['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) !== 2) { continue; }

        $report['examined']++;
        $from = (string) ($segment['from'] ?? '');
        $to = (string) ($segment['to'] ?? '');
        $connectionId = (string) ($segment['id'] ?? '');
        if ($from === '' || $to === '' || $connectionId === '') { continue; }

        // 💣 DIE ENDPUNKTE KOMMEN AUS DER GESPEICHERTEN GEOMETRIE, NICHT AUS DEN GRAPH-SCHLÜSSELN.
        // Kanten liegen bidirektional als DASSELBE Objekt im Graphen; der äußere Schlüssel kann die
        // Umkehrung von `coordinates` sein. Genau daran ist der Wegpunkt-Anker schon einmal
        // gescheitert (87f24af5): der Split hing an den falschen Endknoten und die gezeichnete
        // Etappe sprang quer über die Karte. `from`/`to` im Objekt passen zu `coordinates[0]`/`[1]`.
        $path = avesmapsFindOffroadPathBetween(
            $request, $water, $pdo,
            (float) $coordinates[0][0], (float) $coordinates[0][1],
            (float) $coordinates[1][0], (float) $coordinates[1][1],
            $terrainEnabled
        );
        if ($path === null) {
            // Kein trockener Weg durch die Kiste. Die Sehne bleibt stehen -- V13 hat sie selbst
            // bereits gegen das Wasser geprüft, sie ist also grob, aber nicht falsch. Sie zu
            // entfernen hieße, eine fahrbare Route gegen gar keine zu tauschen.
            $report['legs'][] = ['edge_id' => $connectionId, 'refined' => false, 'reason' => 'no_offroad_route'];
            continue;
        }

        $transport = (string) ($segment['transport_option'] ?? '');
        if ($transport === '') { continue; }

        // Die Sehne raus, der gebogene Weg rein -- unter DERSELBEN Kanten-ID, damit nichts anderes im
        // Graphen sie erst suchen muss.
        avesmapsRemoveClientRouteConnectionById($clientGraph['graph'], $from, $to, $connectionId);
        avesmapsAddOffroadEdge(
            $clientGraph['graph'], $from, $to, $path, $transport, $connectionId,
            (float) ($segment['cost_factor'] ?? AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR)
        );

        $report['refined']++;
        $report['legs'][] = [
            'edge_id' => $connectionId,
            'refined' => true,
            'chord_units' => avesmapsCalculateClientRouteCoordinateDistance($coordinates),
            'distance_units' => $path['distance'],
            'point_count' => count($path['points']),
        ];
    }

    return $report;
}

/**
 * Der A*-Weg zwischen zwei Punkten, ohne ihn in einen Graphen zu hängen.
 *
 * ⭐ Dasselbe Muster wie avesmapsConnectOffroadPoints -- eine Kiste, ein Satz Rasterabfragen, eine
 * Suche. Getrennt davon, weil hier die KANTE schon existiert und nur ihre Geometrie ersetzt wird.
 */
function avesmapsFindOffroadPathBetween(
    array $request,
    array $water,
    ?PDO $pdo,
    float $x1,
    float $y1,
    float $x2,
    float $y2,
    bool $terrainEnabled = true
): ?array {
    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = $transport === null
        ? null
        : (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transport][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null);
    if ($speed === null || $speed <= 0.0) { return null; }

    $box = avesmapsBuildOffroadBox($x1, $y1, $x2, $y2);
    $blocked = avesmapsOffroadRasteriseBlocked($box, $water);
    $factors = $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '';
    // Der Gelände-Notschalter gilt auch hier (V11 §8.3) -- „Gelände aus" muss für eine Notbrücke
    // dasselbe bedeuten wie für einen gezeichneten Weg.
    $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];
    $heights = $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters);

    return avesmapsOffroadFindPath($box, $blocked, $factors, $heights, (float) $speed,
        $x1, $y1, $x2, $y2, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, $rasters);
}

/** Eine Kante beider Richtungen aus dem Graphen nehmen, an ihrer ID erkannt. */
function avesmapsRemoveClientRouteConnectionById(array &$graph, string $fromNode, string $toNode, string $connectionId): void
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
