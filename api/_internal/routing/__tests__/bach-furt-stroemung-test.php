<?php

declare(strict_types=1);

// DIE FURT KOSTET NACH DER STROEMUNG -- 3-fache Stroemung, 3-fache Kosten.
//
// 🔴 Owner 31.08.2026: „wir wollen dass die gewichtung der schwierigkeit der ueberquerung der furt
// an den stroemungsfaktor gekoppelt ist, 3-fache stroemung = 3-fache kosten". Bis dahin kostete
// JEDE Furt AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR = 3,0, egal wie stark das Wasser lief.
//
// 🔴 DER ANKER IST DIE VORGABE-STROEMUNG 2,0 (Owner-Entscheid „B mit Sockel"): ein Bach, an dem
// niemand etwas eingestellt hat, kostet weiterhin genau 3,0. Die Formel ist
//     furt = BACH_FACTOR * stroemung / BACH_FLOW_ANKER
// also 1,5 x Stroemung. Damit aendert sich an keiner Route etwas, solange kein Editor einen
// Faktor setzt -- und die Kopplung greift in dem Moment, in dem er es tut.
// ⚠️ Live gemessen am 31.08.2026: 49 Baeche, KEIN einziger mit eigenem `flow.factor` (alle auf der
// Vorgabe), aber alle mit Fliessrichtung. Die Wahl des Ankers war deshalb die ganze Entscheidung.
//
// ⚠️ EINE ZAHL, ZWEI ROLLEN (Owner: „passt so, eine zahl genuegt"): `flow.factor` heisst im Editor
// „Stroemungsfaktor (flussaufwaerts x)" und sagt, wie viel langsamer man GEGEN die Stroemung
// faehrt. Er sagt jetzt zusaetzlich, wie schwer man quer hindurchkommt.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/bach-furt-stroemung-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../offroad-data.php';
require_once __DIR__ . '/../offroad-leg.php';

$bach = static function (?float $faktor, string $dir = 'forward'): array {
    $flow = ['dir' => $dir];
    if ($faktor !== null) { $flow['factor'] = $faktor; }

    return [
        'subtype' => 'Flussweg',
        'flow' => $flow,
        'properties' => ['is_bach' => true, 'flow' => $flow],
        'geometry' => ['coordinates' => [[-200.0, 20.0], [200.0, 20.0]]],
    ];
};

// =================================================================================================
// A. Der Sammler haengt an jede Furt IHREN Faktor
// =================================================================================================
$gesammelt = avesmapsCollectRouteRiverBarrierLines([$bach(3.0), $bach(1.0), $bach(null)]);
assert(count($gesammelt['furt']) === 3, 'drei Baeche, drei Furten');
$faktoren = array_map(static fn(array $e): float => round((float) $e['faktor'], 4), $gesammelt['furt']);
assert($faktoren === [4.5, 1.5, 3.0],
    'Stroemung 3,0 / 1,0 / ohne Angabe ergeben 4,5 / 1,5 / 3,0 -- gemessen: ' . json_encode($faktoren));

// 🔴 DIE REGEL, NICHT DIE DREI ZAHLEN: doppelte Stroemung, doppelte Kosten.
$einzeln = static function (float $s) use ($bach): float {
    $r = avesmapsCollectRouteRiverBarrierLines([$bach($s)]);

    return (float) $r['furt'][0]['faktor'];
};
assert(abs($einzeln(2.0) - 2 * $einzeln(1.0)) < 1e-9, 'doppelte Stroemung = doppelte Kosten');
assert(abs($einzeln(3.0) - 3 * $einzeln(1.0)) < 1e-9, 'dreifache Stroemung = dreifache Kosten');

// ⚠️ Der Anker: die Vorgabe-Stroemung kostet genau so viel wie vor der Kopplung.
assert(abs($einzeln(2.0) - AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR) < 1e-9,
    'ein Bach auf der Vorgabe-Stroemung kostet unveraendert ' . AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR);

// 💣 DIE UNTERGRENZE KOMMT AUS DEM VORHANDENEN LESER, nicht aus einer eigenen Rechnung.
// ⚠️ Nach OBEN klemmt seit dem 31.08.2026 nichts mehr (Owner: „ganz weg, nur noch >= 1“); wo die
// Furt saettigt, misst stroemungsfaktor-ohne-deckel-test.php.
assert(abs($einzeln(0.1) - $einzeln(1.0)) < 1e-9, 'unter 1,0 klemmt der Leser');
assert($einzeln(4.0) > $einzeln(3.0), 'und darueber waechst die Furt weiter');

// 🔴 OHNE FLIESSRICHTUNG GILT DER ANKER, nicht „keine Erschwernis". Die sichere Richtung: lieber
// eine Furt zu teuer als ein Bach, den man gratis durchwatet.
$ohneRichtung = avesmapsCollectRouteRiverBarrierLines([$bach(3.0, '')]);
assert(abs((float) $ohneRichtung['furt'][0]['faktor'] - AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR) < 1e-9,
    'ohne Fliessrichtung faellt die Furt auf den Anker zurueck');

// =================================================================================================
// B. Der Faktor kommt wirklich im Raster an -- zwei Baeche, zwei Bytewerte
// =================================================================================================
$box = avesmapsBuildOffroadBox(0.0, 0.0, 40.0, 40.0);
$keinWasser = avesmapsPrepareRouteAreas([]);
$byteFuer = static fn(float $f): int
    => (int) round($f * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);

// 💣 Zwei Baeche in EINER Kiste, auf verschiedenen Hoehen -- laege nur einer darin, waere ein
// gemeinsamer Bytewert nicht von zwei eigenen zu unterscheiden.
$stark = $bach(3.0); $stark['geometry']['coordinates'] = [[-200.0, 12.0], [200.0, 12.0]];
$schwach = $bach(1.0); $schwach['geometry']['coordinates'] = [[-200.0, 28.0], [200.0, 28.0]];
$zwei = avesmapsCollectRouteRiverBarrierLines([$stark, $schwach]);
$ebenen = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => $zwei['furt']]);

assert(substr_count($ebenen['factors'], chr($byteFuer(4.5))) > 0,
    'die starke Stroemung steht als 4,5 im Raster');
assert(substr_count($ebenen['factors'], chr($byteFuer(1.5))) > 0,
    'die schwache als 1,5');
assert(substr_count($ebenen['factors'], chr($byteFuer(3.0))) === 0,
    'und der alte Einheitswert 3,0 steht nirgends mehr');

// =================================================================================================
// C. Die alte, flache Form bleibt lesbar -- und bedeutet den Anker
// =================================================================================================
// ⚠️ `['furt' => [[[x,y],[x,y]]]]` ist die Bauform von vor dem 31.08.2026 (und die, mit der
// bach-furt-test.php arbeitet). Sie darf nicht durchfallen, und sie bedeutet genau das, was sie
// vorher bedeutete: den Anker. Die sichere Richtung -- nie „kein Aufschlag".
$flach = avesmapsOffroadBuildPlanes($box, $keinWasser, null,
    ['wand' => [], 'furt' => [[[-200.0, 20.0], [200.0, 20.0]]]]);
assert(substr_count($flach['factors'], chr($byteFuer(AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR))) > 0,
    'die flache Altform ergibt weiterhin den Anker-Aufschlag');

fwrite(STDOUT, "bach-furt-stroemung-test: OK\n");
