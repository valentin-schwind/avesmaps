<?php
// api/_internal/routing/__tests__/kuerzeste-etappe-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL. Unter optimize=shortest ist die Querfeldein-Etappe die GERADE, nicht der
 * zeitoptimale Bogen.
 * Entwurf: docs/superpowers/specs/2026-08-15-kuerzeste-route-gerade-linie-design.md §1/§6
 *
 * 🔴 Bis zum 15.08.2026 war der Querweg unter „Kuerzeste" zeichengleich mit dem unter
 * „Schnellste" -- an der Referenzroute des Owners 12,217 Einheiten gegen eine Luftlinie von
 * 8,609, also 41,9 % Umweg in einem Modus, der Meilen minimieren soll.
 *
 * 💣 DIE FIXTURE DARF KEINEN GLEICHSTAND ERZEUGEN. Der Bauplan setzte Salmingen auf (20,60),
 * senkrecht ueber das Ziel -- dann kostet der Weg bis (20,52) plus Luftlinie GENAU so viel wie
 * die direkte Linie (8 + 12 = 20 = 20), und welche der Dijkstra nimmt, ist Zufall. Salmingen
 * steht deshalb auf (26,60): direkt 20,881 gegen 22,0 ueber die Strasse.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/kuerzeste-etappe-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-leg.php';
// Abschnitt F prueft die Sehnen-Verfeinerung; offroad-leg.php zieht sie nicht mit.
require_once __DIR__ . '/../synthetic-refine.php';

$quadrat = static function (float $x1, float $y1, float $x2, float $y2): array {
    return ['geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]], 'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2];
};
$ort = static fn(string $name, float $x, float $y): array => [
    'name' => $name, 'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
];

$land = avesmapsPrepareRouteAreas([$quadrat(0.0, 0.0, 100.0, 100.0)]);
$wasser = avesmapsPrepareRouteAreas([$quadrat(90.0, 90.0, 95.0, 95.0)]);   // weit weg

$punkte = [[26.0, 60.0], [20.0, 52.0], [28.0, 54.0], [26.0, 50.0], [32.0, 50.0]];
$roadSpeed = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];
$verbindung = [
    'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
    'id' => 'huegelsteig#0', 'path_id' => 'huegelsteig#0',
    'from' => 'Salmingen', 'to' => 'Tarnelfurt',
    'distance' => avesmapsCalculateClientRouteCoordinateDistance($punkte),
    'time' => avesmapsCalculateClientRouteCoordinateDistance($punkte) / $roadSpeed,
    'geometry' => ['type' => 'LineString', 'coordinates' => $punkte],
];
$graph = ['Salmingen' => [], 'Tarnelfurt' => []];
avesmapsAddClientCompatibleGraphConnection($graph, 'Salmingen', 'Tarnelfurt', $verbindung);
avesmapsAddClientCompatibleGraphConnection($graph, 'Tarnelfurt', 'Salmingen', $verbindung);
$orte = [$ort('Salmingen', 26.0, 60.0), $ort('Tarnelfurt', 32.0, 50.0)];
$ziel = [20.0, 40.0];
$luft = hypot(26.0 - $ziel[0], 60.0 - $ziel[1]);      // = 20,8806...

$anfrage = static fn(string $modus): array => ['optimize' => $modus,
    'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

$hole = static function (string $modus) use ($graph, $orte, $anfrage, $wasser, $land, $ziel): array {
    $clientGraph = ['graph' => $graph, 'statistics' => []];
    $bericht = avesmapsAttachOffroadPointToGraph($clientGraph, $orte, $anfrage($modus),
        $wasser, $land, null, $ziel[0], $ziel[1], '__offroad_to', false);
    assert($bericht['ok'] === true, "$modus: der Punkt wird angebunden: " . json_encode($bericht));
    return [$clientGraph, $bericht];
};
$ausstieg = static function (array $bericht, string $knoten): ?array {
    foreach ($bericht['exit_nodes'] as $eintrag) {
        if ((string) $eintrag['node'] === $knoten) { return $eintrag; }
    }
    return null;
};

// 🪤 SEIT DEM 15.08.2026 GIBT ES NUR EINEN AUSSTIEG -- den zielnaechsten Punkt des Netzes,
// hier (26,50). Bis dahin fragte dieser Test nach dem Ausstieg „Salmingen", weil damals jeder
// Kandidat eine Kante bekam. Woran er PRUEFT, aendert das nicht: unter „Kuerzeste" ist die
// Querfeldein-Etappe die GERADE, egal wo sie beginnt.
$luftAusstieg = hypot(26.0 - $ziel[0], 50.0 - $ziel[1]);   // = 11,6619...

// ---- A: unter „Kuerzeste" ist die Etappe die GERADE ---------------------------------------
[$kurzGraph, $kurzBericht] = $hole('shortest');
assert(count($kurzBericht['exit_nodes']) === 1,
    'genau ein Ausstieg: ' . implode(', ', array_column($kurzBericht['exit_nodes'], 'node')));
$abAusstieg = $kurzBericht['exit_nodes'][0];
assert(abs((float) $abAusstieg['air_distance'] - $luftAusstieg) < 1e-9,
    'und er ist der zielnaechste Punkt (26,50): ' . $abAusstieg['air_distance']);
assert(abs((float) $abAusstieg['distance_units'] - $luftAusstieg) < 1e-9,
    'die Etappe ist die Luftlinie: ' . $abAusstieg['distance_units'] . ' gegen ' . $luftAusstieg);
assert((int) $abAusstieg['point_count'] === 2, 'und sie besteht aus genau zwei Punkten');

// ---- B: unter „Schnellste" bleibt alles, wie es war ---------------------------------------
[$schnellGraph, $schnellBericht] = $hole('fastest');
$schnellAbAusstieg = $schnellBericht['exit_nodes'][0];
assert(abs((float) $schnellAbAusstieg['air_distance'] - $luftAusstieg) < 1e-9,
    'derselbe Ausstieg, denn der haengt am Ziel und nicht am Modus: ' . $schnellAbAusstieg['air_distance']);
assert((float) $schnellAbAusstieg['distance_units'] >= $luftAusstieg - 1e-9,
    'der Zeitmodus ist nie kuerzer als die Luftlinie: ' . $schnellAbAusstieg['distance_units']);

// ---- C: 🔴 die letzte Etappe der Reise ist unter „Kuerzeste" die Gerade ------------------
// 🪤 Hier stand: „die Gerade schlaegt den Umweg ueber die Strasse (20,881 gegen 22,0)" -- also
// eine Reise aus EINER Etappe, direkt ab Salmingen. Genau diese Wahl gibt es nicht mehr: die Reise
// bleibt auf der Strasse bis zum zielnaechsten Punkt. Sie ist dadurch LAENGER (32,4 gegen 20,9),
// und das ist der Preis der Regel, nicht ein Fehler.
$route = avesmapsFindClientCompatibleRoute($kurzGraph, 'Salmingen', '__offroad_to', $anfrage('shortest'));
assert($route['found'] === true, 'die Reise wird gefunden');
$letzte = $route['segments'][count($route['segments']) - 1];
assert((string) $letzte['route_type'] === AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE,
    'die letzte Etappe ist Querfeldein');
assert(abs((float) $letzte['distance'] - $luftAusstieg) < 1e-9,
    'und sie ist die Gerade: ' . $letzte['distance'] . ' gegen ' . $luftAusstieg);
// Unter „Kuerzeste" IST das Gewicht die Strecke, also muessen Kosten und Summe uebereinstimmen.
$summe = array_sum(array_map(static fn(array $s): float => (float) $s['distance'], $route['segments']));
assert(abs((float) $route['cost'] - $summe) < 1e-9,
    'ihre Kosten sind die Strecke: ' . $route['cost'] . ' gegen ' . $summe);
assert((float) $route['cost'] > $luft,
    'und die erzwungene Reise ist laenger als die abgeschaffte Gerade ab Salmingen: '
    . round((float) $route['cost'], 4) . ' gegen ' . round($luft, 4));

// ---- D: die Auskunft bleibt vollstaendig --------------------------------------------------
// ⚠️ Ohne Hoehenraster ist ascent_schritt zu Recht null (die null/0-Regel aus V11). Was hier
// zaehlt: die Etappe traegt ihre Messwerte ueberhaupt, nicht nur eine Laenge.
$etappe = $letzte;
// ⚠️ Auf GRAPH-Ebene heissen die Felder "time" und "distance"; "cost_units" und "distance_units"
// sind erst die Namen des Antwortbauers (response.php). Wer sie hier prueft, prueft null.
assert(array_key_exists('time', $etappe) && (float) $etappe['time'] > 0.0,
    'die Etappe traegt eine gemessene Zeit, nicht nur eine Laenge: ' . json_encode($etappe['time'] ?? null));
assert(abs((float) $etappe['distance'] - $luftAusstieg) < 1e-9,
    'und ihre Laenge ist die Luftlinie ab dem Ausstieg: ' . $etappe['distance']);

// ---- E: zwei Kartenpunkte -- auch die direkte Kante ist im Streckenmodus gerade ------------
$paarGraph = ['graph' => []];
$paarBericht = avesmapsConnectOffroadPoints($paarGraph, $anfrage('shortest'), $wasser, null,
    ['x' => 10.0, 'y' => 10.0], ['x' => 18.0, 'y' => 16.0], '__offroad_from', '__offroad_to', false);
assert($paarBericht['ok'] === true, 'die direkte Kante entsteht: ' . json_encode($paarBericht));
assert(abs((float) $paarBericht['distance_units'] - hypot(8.0, 6.0)) < 1e-9,
    'und sie ist die Luftlinie: ' . $paarBericht['distance_units'] . ' gegen ' . hypot(8.0, 6.0));
assert((int) $paarBericht['point_count'] === 2, 'zwei Punkte, kein Bogen');

// ---- F: die Sehnen-Verfeinerung biegt im Streckenmodus NICHT ------------------------------
// 🔴 avesmapsRefineSyntheticRouteLegs ersetzt die gerade Notkante durch den A*-Bogen. Ihr eigener
// Docblock sagt, warum das unter "Kuerzeste" falsch ist: "Der neue Weg ist LAENGER als die Sehne
// -- er weicht ja aus." Genau das darf ein Modus, der Meilen minimiert, nicht tun.
$notKante = static function (): array {
    return [
        'distance' => 25.0 * hypot(6.0, 8.0), 'time' => 25.0 * hypot(6.0, 8.0) / 2.30,
        'cost_factor' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR,
        'route_type' => AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE, 'transport_option' => 'groupFoot',
        'id' => 'synthetic-A->B', 'path_id' => 'synthetic-A->B', 'from' => 'A', 'to' => 'B',
        'geometry' => ['type' => 'LineString', 'coordinates' => [[10.0, 10.0], [16.0, 18.0]]],
        'synthetic' => true,
    ];
};
$bauNotGraph = static function () use ($notKante): array {
    $g = ['graph' => ['A' => [], 'B' => []]];
    avesmapsAddClientCompatibleGraphConnection($g['graph'], 'A', 'B', $notKante());
    avesmapsAddClientCompatibleGraphConnection($g['graph'], 'B', 'A', $notKante());
    return $g;
};
$segmente = [$notKante()];

$kurzGraph2 = $bauNotGraph();
$kurzRefine = avesmapsRefineSyntheticRouteLegs($kurzGraph2, $anfrage('shortest'), $wasser, null,
    $segmente, false);
assert((int) $kurzRefine['refined'] === 0,
    'unter "Kuerzeste" wird keine einzige Sehne gebogen, gebogen: ' . $kurzRefine['refined']);

// 🔴 DIE GEGENPROBE IST TRAGEND: ohne sie waere F auch dann gruen, wenn die Funktion aus einem
// ganz anderen Grund nichts taete.
$schnellGraph2 = $bauNotGraph();
$schnellRefine = avesmapsRefineSyntheticRouteLegs($schnellGraph2, $anfrage('fastest'), $wasser, null,
    $segmente, false);
assert((int) $schnellRefine['examined'] > 0,
    'im Zeitmodus schaut sie sich die Sehne ueberhaupt an: ' . $schnellRefine['examined']);

fwrite(STDOUT, "kuerzeste-etappe-test: OK (gerade " . round((float) $abAusstieg['distance_units'], 4)
    . " gegen zeitoptimal " . round((float) $schnellAbAusstieg['distance_units'], 4) . ")\n");
