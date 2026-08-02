<?php

declare(strict_types=1);

// V14 §5.5 / Instruction C §2: der automatische Umweg-Auslöser.
//
// Der zweite Aufrufer desselben A*, der „Hierher reisen" trägt. Kein Knopf, kein Rechtsklick: er
// prüft jede normal geplante Route und bietet dem Dijkstra einen Querweg an, wenn das gezeichnete
// Netz einen absurden Bogen fährt.
//
// PURITY CONTRACT: side-effect-free on include. Ohne PDO rechnet der A* auf flachem, landschaftslosem
// Grund weiter -- dieselbe gewollte Ausfallart wie bei „Hierher reisen".
//
// ⭐ DER VORFILTER IST GRATIS. Luftlinie und gefahrene Strecke liegen nach dem ersten Dijkstra beide
// vor; erst darüber kostet etwas. Am Livebestand gemessen (V14 §4.2/§4.3): 9,1 % der nahen Ortspaare
// lösen aus, die Suchkiste dabei p50 1.125 Zellen, die Suche p50 14 ms. Die Kisten sind hier KLEIN,
// nicht groß -- eine Route sieht nur dann absurd aus, wenn die beiden Orte nah beieinander liegen,
// und nah heißt kleine Kiste. Die Schwelle begrenzt die Kiste, ohne dass man sie begrenzen muss.

require_once __DIR__ . '/offroad-leg.php';

// Ab welchem Verhältnis „gefahrene Strecke : Luftlinie" überhaupt quer gerechnet wird.
//
// ⚠️ Die Schwelle entscheidet NICHT allein, und sie soll es auch nicht. Querfeldein ist mit 1,25
// gegen 4,0 auf der Straße gut dreimal langsamer, ein Bogen von exakt 3x also über die Zeit immer
// noch der bessere Weg. Die Schwelle sagt nur, wann sich das NACHRECHNEN lohnt; entschieden wird
// danach über die Zeit.
const AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD = 3.0;

/**
 * PURE: die tatsächlich gefahrene Strecke einer Route, aus den Etappen-Geometrien.
 *
 * 💣 NICHT `cost` und NICHT `distance`. `cost` ist im Regelfall eine Zeit, und `distance` trug bis
 * Instruction C §1 den x25-Aufschlag der Notbrücken -- mit ihm käme für Gulbladdirstadir -> Rekheim
 * ein Verhältnis von 77x heraus statt 18x, und der Auslöser feuerte an Stellen, an denen gar kein
 * Bogen ist.
 */
function avesmapsRouteMeasureTravelledDistance(array $segments): float
{
    $distance = 0.0;
    foreach ($segments as $segment) {
        $coordinates = $segment['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates)) { continue; }
        $distance += avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    }

    return $distance;
}

/**
 * PURE: was die gefundene Route an ZEIT kostet, in der Einheit des Graphen.
 *
 * 💣 Nicht `route['cost']`: das ist bei `optimize=shortest` eine Strecke und bei
 * `minimize_transfers` zusätzlich mit Umsteigezuschlägen versetzt. Der Vergleich unten muss aber in
 * beiden Modi derselbe sein -- eine Abkürzung, die länger DAUERT, ist auch dann keine, wenn der
 * Reisende „Kürzeste" angehakt hat.
 *
 * 💣 UND DER x25 MUSS AUCH HIER HERAUS. `time` ist `distance / Tempo`, erbt den Aufschlag der
 * Notbrücken also mit -- live gemessen trug Gulbladdirstadir -> Rekheim dadurch 405,09 statt der
 * echten 32,9. Das ist dieselbe Verwechslung wie in §1, nur eine Division später: eine Route mit
 * einer kurzen Notbrücke sähe zeitlich so teuer aus, dass ein tatsächlich LANGSAMERER Querweg
 * gewönne. Der Aufschlag ist eine Abschreckung für den Dijkstra, keine Reisezeit.
 */
function avesmapsRouteMeasureTravelledTime(array $segments): float
{
    $time = 0.0;
    foreach ($segments as $segment) {
        $factor = (float) ($segment['cost_factor'] ?? 1.0);
        if ($factor <= 0.0) { $factor = 1.0; }
        $time += (float) ($segment['time'] ?? 0.0) / $factor;
    }

    return $time;
}

/**
 * Prüft die gefundene Route auf einen absurden Bogen und hängt bei Bedarf einen A*-Querweg als
 * ANGEBOT in den Graphen. Gibt einen Bericht zurück; ist `offered` wahr, muss der Aufrufer den
 * Dijkstra erneut laufen lassen.
 *
 * 🔴 ANGEBOT, NICHT VORSCHRIFT -- und deshalb gibt es hier keinen zweiten Routenzusammenbau. Die
 * Kante kostet, was sie kostet; welche Reise gewinnt, entscheidet derselbe Dijkstra wie sonst. Er
 * darf dabei auch etwas Drittes wählen (ein Stück Straße, dann quer), und das wäre dann die richtige
 * Antwort, nicht ein Fehler.
 *
 * $fromPoint/$toPoint sind die Koordinaten der beiden Endknoten -- bei einem Ort seine eigenen, bei
 * einem angeklickten Kartenpunkt dessen.
 */
function avesmapsMaybeOfferOffroadDetour(
    array &$clientGraph,
    array $request,
    array $water,
    ?PDO $pdo,
    array $segments,
    array $fromPoint,
    array $toPoint,
    string $fromNode,
    string $toNode,
    bool $terrainEnabled = true
): array {
    $x1 = (float) ($fromPoint['x'] ?? 0.0);
    $y1 = (float) ($fromPoint['y'] ?? 0.0);
    $x2 = (float) ($toPoint['x'] ?? 0.0);
    $y2 = (float) ($toPoint['y'] ?? 0.0);
    $air = hypot($x2 - $x1, $y2 - $y1);
    $travelled = avesmapsRouteMeasureTravelledDistance($segments);
    $graphTime = avesmapsRouteMeasureTravelledTime($segments);

    $report = [
        'checked' => true,
        'air_distance' => $air,
        'travelled_units' => $travelled,
        'graph_cost_units' => $graphTime,
        'threshold' => AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD,
        'ratio' => $air > 1e-9 ? $travelled / $air : null,
        'triggered' => false,
        'offered' => false,
        'reason' => '',
    ];

    if ($segments === []) {
        $report['reason'] = 'no_route';
        return $report;
    }
    // Zwei Orte auf demselben Punkt (und der Fall „Route der Länge null"). Kein Verhältnis, keine
    // Division -- und nichts, was ein Querweg verbessern könnte.
    if ($air <= 1e-9) {
        $report['reason'] = 'no_air_distance';
        return $report;
    }
    if ($report['ratio'] <= AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD) {
        $report['reason'] = 'below_threshold';
        return $report;
    }

    $report['triggered'] = true;

    // ⭐ WAS DER QUERWEG BESTENFALLS SCHAFFT -- und das weiß man vor der Suche. Der A*-Weg ist nie
    // kürzer als die Luftlinie, und sein kleinster möglicher Faktor ist EXAKT 1,0: das
    // Leistungskilometer-Modell hat keinen Boden (`terrain-factor.php:60-63`) und Landschaftsfaktoren
    // werden nur mit `offroad_factor > 1.00` geladen (`offroad-data.php:106`). Das ist dieselbe
    // Ungleichung, mit der `offroad-grid.php:315` die A*-Heuristik als zulässig begründet -- hier
    // einmal auf die ganze Strecke angewandt statt je Zelle.
    //
    // Liegt schon diese Bestzeit über der Graph-Route, KANN die Suche nicht gewinnen. Sie zu
    // starten hieße, eine Kiste zu rastern und zwei Rasterabfragen zu stellen, um am Ende `slower`
    // zu sagen -- gemessen 0,15 s je Anfrage.
    //
    // ⚠️ Praktisch trifft das Wasserwege, ohne ein Sonderfall für sie zu sein: bei Tempo 4 auf der
    // Straße greift die Schranke nur zwischen dem 3,0- und dem 3,2-fachen Bogen, bei einem Seeweg
    // mit Tempo 10 bis zum ACHTFACHEN. Genau dort läuft der A* heute leer -- Flüsse mäandern,
    // Küsten sind gebogen, die Schwelle wird dauernd überschritten. Ein Filter „Route ist
    // überwiegend Wasser" wäre dagegen falsch: ein Flussweg um einen kleinen See, an dem ein kurzer
    // Landweg wirklich schneller ist, fiele mit heraus.
    $transport = avesmapsResolveClientRouteTransportOption(AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, $request);
    $speed = $transport === null
        ? null
        : (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$transport][AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE] ?? null);
    if ($speed === null || $speed <= 0.0) {
        // Querfeldein ist für dieses Verkehrsmittel gar nicht vorgesehen. Dann gibt es nichts
        // anzubieten -- und der A* würde unten ohnehin an derselben Stelle aussteigen.
        $report['reason'] = 'no_offroad_route';
        return $report;
    }
    // 💣 DASSELBE TEMPO WIE DIE SUCHE, aus derselben Tabelle. Ein anderes -- etwa das der Straße --
    // machte die Schranke unscharf, und unscharf heißt hier: sie schnitte einen Querweg ab, der
    // gewonnen hätte.
    $report['best_possible_cost_units'] = $air / (float) $speed;
    if ($report['best_possible_cost_units'] >= $graphTime) {
        $report['reason'] = 'cannot_win';
        return $report;
    }

    // Ab hier kostet es. Ein eigener Kantenname, damit der Querweg zweier Kartenpunkte
    // (`offroad-direct`) nicht überschrieben wird, wenn beides in derselben Anfrage zusammentrifft.
    $offroad = avesmapsConnectOffroadPoints(
        $clientGraph, $request, $water, $pdo,
        ['x' => $x1, 'y' => $y1], ['x' => $x2, 'y' => $y2],
        $fromNode, $toNode, $terrainEnabled,
        'offroad-detour'
    );
    if (empty($offroad['ok'])) {
        // Kein trockener Weg durch die Kiste. Die gezeichnete Route bleibt die Antwort -- das ist
        // dieselbe Owner-Entscheidung wie bei den Notbrücken: lieber der Umweg als eine Linie, die
        // durchs Wasser führt.
        $report['reason'] = (string) ($offroad['error'] ?? 'no_offroad_route');
        return $report;
    }

    // 💣 DIE ZWEITE PRÜFUNG IST DIE ZEIT, und ohne sie wäre der Auslöser falsch. Ein Bogen von 3x
    // ist gegen ein dreimal langsameres Gelände immer noch die schnellere Reise. Verliert der
    // Querweg, wird die Kante wieder ausgehängt -- ein Angebot, das nie gewinnen kann, ist nur
    // Gewicht im Graphen und würde bei „Kürzeste" sogar fälschlich gewinnen.
    if ((float) $offroad['cost_units'] >= $graphTime) {
        avesmapsRemoveClientRouteConnection($clientGraph['graph'], $fromNode, $toNode, 'offroad-detour');
        $report['reason'] = 'slower';
        $report['offroad'] = $offroad;
        return $report;
    }

    $report['offered'] = true;
    $report['reason'] = 'offered';
    $report['offroad'] = $offroad;

    return $report;
}

/**
 * PURE: die Koordinaten eines Routen-Endpunkts als `['x' => .., 'y' => ..]`, oder null.
 *
 * Ein angeklickter Kartenpunkt bringt sie mit; ein Ort wird im Bestand nachgeschlagen. `null` heißt
 * „nicht auffindbar" und schaltet den Auslöser für diese Anfrage einfach ab -- ein Endpunkt ohne
 * Koordinaten hat keine Luftlinie, über die sich ein Bogen beurteilen ließe.
 */
function avesmapsRouteResolveEndpointPoint(array $locations, string $name, ?array $mapPoint): ?array
{
    if (is_array($mapPoint) && isset($mapPoint['x'], $mapPoint['y'])) {
        return ['x' => (float) $mapPoint['x'], 'y' => (float) $mapPoint['y']];
    }
    foreach ($locations as $location) {
        if (trim((string) ($location['name'] ?? '')) !== $name) { continue; }
        $coordinates = $location['geometry']['coordinates'] ?? null;
        if (is_array($coordinates) && count($coordinates) >= 2) {
            return ['x' => (float) $coordinates[0], 'y' => (float) $coordinates[1]];
        }
        if (isset($location['route_x'], $location['route_y'])) {
            return ['x' => (float) $location['route_x'], 'y' => (float) $location['route_y']];
        }
    }

    return null;
}

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
