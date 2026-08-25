<?php
// api/_internal/routing/__tests__/etappenrichtung-test.php
declare(strict_types=1);

/**
 * DER ABNAHMEFALL ZU MELDUNG #98: eine Etappe meldet die Richtung, in die GEREIST wird -- nicht die,
 * in der ihr Weg gespeichert ist.
 *
 * 💣 DIE URSACHE IST KEIN FEHLER IM GRAPHEN, UND SIE DARF DORT AUCH NICHT REPARIERT WERDEN.
 * `avesmapsAddClientCompatiblePathSliceConnection` haengt DASSELBE Verbindungsobjekt unter beide
 * Richtungen in den Graphen und laesst `from`/`to` in der SPEICHERrichtung stehen -- absichtlich:
 * die Kettenwanderung der Verlauf-Ableitung (api/_internal/wiki/path-verlauf.php) haengt daran, und
 * der Kommentar an der Stelle sagt es woertlich. Wer dort dreht, dreht die Flussrichtungs-Ableitung
 * der Wege mit.
 * ⭐ Gedreht wird deshalb in der ANTWORT, wo die Durchlaufrichtung ohnehin bekannt ist: `node_ids`
 * ist die geordnete Knotenliste, Etappe i laeuft von node_ids[i] nach node_ids[i+1].
 *
 * 🔴 UND DIE GELAENDEWERTE DUERFEN DABEI NICHT MITGEDREHT WERDEN. Steht das Gelaende an, legt der
 * Graphbau zwei VERSCHIEDENE Objekte ab (`avesmapsRouteApplyTerrainToConnection(..., $reversed)`);
 * `ascent_schritt` steht dann bereits in Reiserichtung. Wer hier ein zweites Mal tauscht, macht aus
 * einem Anstieg wieder ein Gefaelle -- die Fehlerklasse, die V11 §6.3 beschreibt.
 *
 * ⚠️ Ohne `node_ids` bleibt der Bauer Zeichen fuer Zeichen bei seinem alten Verhalten. Das ist der
 * zweite Aufrufer, `path-verlauf.php`, der die Felder gar nicht liest -- er soll sich nicht aendern.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/etappenrichtung-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../client-graph.php';

$tempo = (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'];

// Zwei Wegstuecke, BEIDE gegen die Reiserichtung gespeichert: A <- B <- C. Gereist wird A -> C.
$stueck = static function (string $von, string $nach, array $punkte) use ($tempo): array {
    $strecke = avesmapsCalculateClientRouteCoordinateDistance($punkte);
    return [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => $von . '>' . $nach, 'path_id' => $von . '>' . $nach,
        'public_id' => 'pub-' . $von . $nach,
        'from' => $von, 'to' => $nach,
        'distance' => $strecke, 'time' => $strecke / $tempo,
        'geometry' => ['type' => 'LineString', 'coordinates' => $punkte],
    ];
};

$ba = $stueck('B', 'A', [[10.0, 0.0], [5.0, 0.0], [0.0, 0.0]]);
$cb = $stueck('C', 'B', [[20.0, 0.0], [10.0, 0.0]]);

$graph = ['A' => [], 'B' => [], 'C' => []];
avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'A', $ba);
avesmapsAddClientCompatibleGraphConnection($graph, 'A', 'B', $ba);
avesmapsAddClientCompatibleGraphConnection($graph, 'C', 'B', $cb);
avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'C', $cb);

$anfrage = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];
$ergebnis = avesmapsFindClientCompatibleRoute(['graph' => $graph, 'statistics' => []], 'A', 'C', $anfrage);

assert($ergebnis['found'] === true, 'die Fixture findet ueberhaupt eine Route');
assert($ergebnis['node_ids'] === ['A', 'B', 'C'], 'die Knotenliste laeuft A -> B -> C: ' . json_encode($ergebnis['node_ids']));

// ---- 1. Der Befund von Melder Stane: ohne node_ids stehen die Enden verkehrt herum --------------
// Das ist KEINE Zusicherung an die Zukunft, sondern der Zeuge des alten Verhaltens -- er belegt,
// dass der Test unten wirklich etwas misst und nicht zufaellig gruen ist.
$alt = avesmapsBuildClientRouteDiagnosticSegments($ergebnis['segments']);
assert($alt[0]['from_node'] === 'B' && $alt[0]['to_node'] === 'A',
    'ohne node_ids bleibt die Speicherrichtung stehen (der gemeldete Zustand)');

// ---- 2. Mit der Knotenliste laeuft jede Etappe in Reiserichtung ---------------------------------
$neu = avesmapsBuildClientRouteDiagnosticSegments($ergebnis['segments'], $ergebnis['node_ids']);
assert(count($neu) === 2, 'zwei Etappen');

$erwartet = [['A', 'B'], ['B', 'C']];
foreach ($neu as $i => $etappe) {
    assert($etappe['from_node'] === $erwartet[$i][0],
        "Etappe $i beginnt bei {$erwartet[$i][0]}, gemeldet: {$etappe['from_node']}");
    assert($etappe['to_node'] === $erwartet[$i][1],
        "Etappe $i endet bei {$erwartet[$i][1]}, gemeldet: {$etappe['to_node']}");
}

// ---- 3. Und die Kette schliesst: das Ende einer Etappe ist der Anfang der naechsten -------------
// Genau diese Eigenschaft hat der Melder vermisst; sie ist staerker als die Namen einzeln zu pruefen.
for ($i = 1, $n = count($neu); $i < $n; $i++) {
    assert($neu[$i - 1]['to_node'] === $neu[$i]['from_node'],
        "die Etappenkette schliesst zwischen $i und " . ($i - 1));
}

// ---- 4. Die GEOMETRIE dreht mit ----------------------------------------------------------------
// 💣 Sonst laeuft die gezeichnete Linie der Beschriftung entgegen -- und das faellt beim Zeichnen
// nicht auf, weil eine Linie in beide Richtungen gleich aussieht. Erst wer den ersten Punkt als
// „hier beginnt die Etappe" liest, bekommt den Anfang der NAECHSTEN Etappe.
assert($neu[0]['geometry']['coordinates'][0] === [0.0, 0.0],
    'Etappe 0 beginnt geometrisch bei A: ' . json_encode($neu[0]['geometry']['coordinates'][0]));
assert(end($neu[0]['geometry']['coordinates']) === [10.0, 0.0], 'Etappe 0 endet geometrisch bei B');
assert($neu[1]['geometry']['coordinates'][0] === [10.0, 0.0], 'Etappe 1 beginnt geometrisch bei B');
assert(end($neu[1]['geometry']['coordinates']) === [20.0, 0.0], 'Etappe 1 endet geometrisch bei C');

// Und die Anzahl bleibt: gedreht wird die Reihenfolge, nichts faellt weg.
assert($neu[0]['coordinate_count'] === 3, 'die drei Stuetzpunkte bleiben drei');

// ---- 5. Eine Etappe, die ohnehin richtig herum liegt, wird NICHT angefasst ----------------------
$vorwaerts = avesmapsFindClientCompatibleRoute(['graph' => $graph, 'statistics' => []], 'C', 'A', $anfrage);
$vs = avesmapsBuildClientRouteDiagnosticSegments($vorwaerts['segments'], $vorwaerts['node_ids']);
assert($vs[0]['from_node'] === 'C' && $vs[0]['to_node'] === 'B', 'C -> B steht schon richtig');
assert($vs[0]['geometry']['coordinates'][0] === [20.0, 0.0], 'und seine Geometrie bleibt unberuehrt');

// ---- 6. Die richtungsabhaengigen Gelaendewerte werden NICHT ein zweites Mal getauscht ------------
// 🔴 Der Graphbau legt fuer die Gegenrichtung ein EIGENES Objekt ab, in dem Anstieg und Gefaelle
// bereits vertauscht sind. Der Dreher hier sieht nur Beschriftung und Geometrie.
$mitGelaende = $ba;
$mitGelaende['ascent_schritt'] = 40.0;    // wie es avesmapsRouteApplyTerrainToConnection fuer die
$mitGelaende['descent_schritt'] = 120.0;  // Gegenrichtung B->A ablegt: schon in Reiserichtung
$mitGelaende['terrain_time_factor'] = 1.25;
$gedreht = avesmapsBuildClientRouteDiagnosticSegments([$mitGelaende], ['A', 'B']);
assert($gedreht[0]['from_node'] === 'A', 'auch mit Gelaende dreht die Beschriftung');
assert($gedreht[0]['ascent_schritt'] === 40.0, 'der Anstieg bleibt, wie der Graphbau ihn gelegt hat');
assert($gedreht[0]['descent_schritt'] === 120.0, 'und das Gefaelle ebenso');
assert($gedreht[0]['terrain_time_factor'] === 1.25, 'und der Faktor auch');

// ---- 7. Passt die Knotenliste nicht zur Etappenzahl, wird gar nichts gedreht --------------------
// Lieber die alte Beschriftung als eine falsch gedrehte: eine unpassende Liste ist kein Beweis.
$unpassend = avesmapsBuildClientRouteDiagnosticSegments($ergebnis['segments'], ['A', 'B', 'C', 'D']);
assert($unpassend[0]['from_node'] === 'B', 'bei unpassender Knotenliste bleibt alles, wie es war');

fwrite(STDOUT, "OK etappenrichtung-test\n");
