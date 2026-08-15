<?php
// api/_internal/routing/__tests__/ausstiegsregel-alle-erzeuger-test.php
declare(strict_types=1);

/**
 * DIE AUSSTIEGSREGEL GILT FUER ALLE ERZEUGER, NICHT NUR FUER DIE ANBINDUNG.
 *
 * 🔴 Owner-Entscheid 15.08.2026: der Ausstieg ist der naechste erreichbare Punkt des Netzes. Die
 * Regel wurde zuerst nur in avesmapsAttachOffroadPointToGraph gebaut -- und war damit an zwei
 * Stellen wirkungslos, beide live gemessen:
 *
 *   1. Die UMWEG-SEHNEN (detour.php) legten weiterhin Kanten an den Kartenpunkt. Gemessen an
 *      Kartenpunkt 475.458/479.833 -> 521.542/488.083: die Anbindung bot EINEN Ausstieg bei 5,04
 *      Einheiten, und die Reise nahm `offroad-detour-12-21` -- Jurios -> Ziel, 34,4 Meilen quer.
 *   2. Die DIREKTE KANTE zwischen zwei Kartenpunkten gewann unter „Kuerzeste" IMMER: dort ist das
 *      Gewicht die Strecke, und eine Gerade ist per Definition kuerzer als jede Strasse. Dieselbe
 *      Anfrage lieferte EINE Etappe ueber 148,5 Meilen bei 140,4 Meilen Luftlinie -- die Kuerzeste
 *      war zum Drachenflug geworden. Owner: „hier macht er scheiss"; der einzige Unterschied zu dem
 *      Fall, den er „richtig" nannte, war `pathType=shortest`.
 *
 * 🪤 DIE LEHRE IST DIE VOM 14.08.2026, ZUM ZWEITEN MAL: eine Regel, die nur einen von vier
 * Erzeugern bindet, ist keine Regel. Damals war es die Verkehrsmittel-Sperre.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/ausstiegsregel-alle-erzeuger-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../detour.php';

// ---- A: die direkte Kante folgt derselben Regel -------------------------------------------
$bericht = static fn(?float $luft): array => $luft === null
    ? ['exit_nodes' => []]
    : ['exit_nodes' => [['node' => '__wp_anchor_0', 'air_distance' => $luft]]];
$vonP = ['x' => 0.0, 'y' => 0.0];
$nachP = ['x' => 10.0, 'y' => 0.0];   // Abstand 10

// Beide haengen dicht am Netz (2 bzw. 5) -- der andere Punkt ist fuer keinen der naechste.
assert(avesmapsOffroadDirectEdgeAllowed($bericht(2.0), $bericht(5.0), $vonP, $nachP) === false,
    'liegt das Netz naeher, gibt es keine direkte Kante');

// 🔴 DER FALL VOM 14.08.2026: zwei Kartenpunkte nah beieinander, die Strasse weit weg. Ohne die
// Kante liefe die Reise hinunter auf den Weg und wieder hinauf -- ein V statt einer Linie.
assert(avesmapsOffroadDirectEdgeAllowed($bericht(30.0), $bericht(30.0), $vonP, $nachP) === true,
    'liegen die Punkte naeher beieinander als am Netz, entsteht sie');

// ⚠️ `max`, nicht `min`: es genuegt, dass der andere Punkt fuer EINEN der beiden der naechste ist.
assert(avesmapsOffroadDirectEdgeAllowed($bericht(1.0), $bericht(30.0), $vonP, $nachP) === true,
    'A dicht an der Strasse, B weit ab -- fuer B ist A das Naechstliegende');

// ⚠️ Ein Bericht ohne Ausstieg zaehlt als unendlich weit: die Kante ist dann die einzige
// Verbindung, die dieser Punkt hat, und sie zu verweigern hiesse, ihn abzuschneiden.
assert(avesmapsOffroadDirectEdgeAllowed($bericht(null), $bericht(2.0), $vonP, $nachP) === true,
    'ohne jeden Ausstieg bleibt nur die direkte Kante');

// 💣 GENAU AUF DER GRENZE ZAEHLT SIE ALS ERLAUBT. Ein Gleichstand darf nicht davon abhaengen, ob
// eine Wurzel in der letzten Stelle nach oben oder unten rundet.
assert(avesmapsOffroadDirectEdgeAllowed($bericht(10.0), $bericht(3.0), $vonP, $nachP) === true,
    'bei Gleichstand entsteht sie');

// ---- B: keine Umweg-Sehne an einen Kartenpunkt --------------------------------------------
// Kette: A -- M -- B. Die gefahrene Strecke ist doppelt so lang wie die Luftlinie A->B, also ist
// A->B ein Sehnen-Kandidat, solange kein Ende ein Kartenpunkt ist.
$kette = static fn(string $letzter): array => [
    ['name' => 'A', 'x' => 0.0, 'y' => 0.0, 'distance' => 0.0, 'time' => 0.0],
    ['name' => 'M', 'x' => 50.0, 'y' => 50.0, 'distance' => 100.0, 'time' => 50.0],
    ['name' => $letzter, 'x' => 0.0, 'y' => 100.0, 'distance' => 200.0, 'time' => 100.0],
];
$tempo = 2.30;
$schwelle = 1.5;

// 🔴 DIE GEGENPROBE ZUERST: mit gewoehnlichen Namen MUSS die Sehne entstehen. Ohne sie waere der
// Test unten auch dann gruen, wenn die Kandidatensuche aus einem ganz anderen Grund nichts liefert.
$gewoehnlich = avesmapsRouteChordCandidates($kette('B'), $tempo, $schwelle);
$paare = array_map(static fn(array $c): string => $c['from_node'] . '->' . $c['to_node'], $gewoehnlich);
assert(in_array('A->B', $paare, true),
    'zwischen gewoehnlichen Knoten entsteht die Sehne: ' . implode(', ', $paare));

$mitKartenpunkt = avesmapsRouteChordCandidates(
    $kette(AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'to'), $tempo, $schwelle
);
foreach ($mitKartenpunkt as $kandidat) {
    assert(!str_starts_with((string) $kandidat['from_node'], AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX)
        && !str_starts_with((string) $kandidat['to_node'], AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX),
        'keine Sehne beruehrt einen Kartenpunkt: '
        . $kandidat['from_node'] . '->' . $kandidat['to_node']);
}
// Und die eine, um die es geht, ist wirklich weg -- nicht nur umbenannt.
$paare2 = array_map(static fn(array $c): string => $c['from_node'] . '->' . $c['to_node'], $mitKartenpunkt);
assert(!in_array('A->' . AVESMAPS_ROUTE_OFFROAD_NODE_PREFIX . 'to', $paare2, true),
    'die Sehne an den Kartenpunkt fehlt: ' . implode(', ', $paare2));

fwrite(STDOUT, "ausstiegsregel-alle-erzeuger-test: OK (ohne Kartenpunkt " . count($gewoehnlich)
    . " Sehnen, mit " . count($mitKartenpunkt) . ")\n");
