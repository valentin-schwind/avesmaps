<?php
// api/_internal/routing/__tests__/fluss-sperre-test.php
declare(strict_types=1);

/**
 * Ein Fluss ist im Gelaende eine Wand.
 * Entwurf: docs/superpowers/specs/2026-08-15-fluesse-sperren-gelaende-design.md
 *
 * 🔴 Der Befund, der das ausloest: AVESMAPS_ROUTE_WATER_REGION_TYPES = ['meer','see']. Ein Fluss
 * ist bei uns keine Flaeche, sondern ein Flussweg-WEG -- eine Linie. Die Sperrebene rasterte nur
 * Polygone. Live gemessen am 15.08.2026: ?s=w38RkXYP lief 61,8 Meilen in EINER Etappe quer ueber
 * die Rakula.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/fluss-sperre-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-grid.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 40.0, 40.0);
$tempo = 2.30;
$keinWasser = avesmapsPrepareRouteAreas([]);

// Ein Fluss quer ueber die ganze Kiste, bei y = 20.
// 💣 ER MUSS WEIT UEBER BEIDE RAENDER HINAUSREICHEN. avesmapsBuildOffroadBox legt einen Rand von
// hier rund 17 Einheiten um die Punkte -- ein Fluss von -10 bis 50 endet INNERHALB der Kiste, und
// der Suchlauf laeuft aussen herum (gemessen: 121 gesperrte Zellen, Weg 73,1 statt keiner). Das
// sah aus wie ein Loch in der Wand und war eine zu kurze Fixture.
$fluss = [[[-200.0, 20.0], [200.0, 20.0]]];

// ---- A: ohne Fluss geht es geradeaus hindurch --------------------------------------------
$frei = avesmapsOffroadRasteriseBlocked($box, $keinWasser);
$ohne = avesmapsOffroadFindPath($box, $frei, null, null, $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($ohne), 'ohne Fluss gibt es einen Weg');
assert(abs($ohne['distance'] - 30.0) < 0.5,
    'und er ist praktisch die Gerade: ' . $ohne['distance']);

// ---- B: 🔴 MIT Fluss gibt es keinen ------------------------------------------------------
$gesperrt = avesmapsOffroadRasteriseBlocked($box, $keinWasser, $fluss);
$mit = avesmapsOffroadFindPath($box, $gesperrt, null, null, $tempo, 20.0, 5.0, 20.0, 35.0);
assert($mit === null, 'ein Fluss quer durch die Kiste ist eine Wand, kein Umweg');

// ---- C: 💣 AUCH DIAGONAL NICHT ------------------------------------------------------------
// Eine schraege Linie markiert eine Treppe aus Zellen. Der Suchlauf geht ueber ACHT Nachbarn --
// zwischen zwei diagonal benachbarten gesperrten Zellen schluepft er hindurch, wenn die beiden
// Eckzellen frei bleiben. Eine einzige durchlaessige Zelle macht die ganze Wand wirkungslos, und
// es faellt an genau einer Route auf.
$schraeg = [[[-200.0, -190.0], [200.0, 210.0]]];
$gesperrtSchraeg = avesmapsOffroadRasteriseBlocked($box, $keinWasser, $schraeg);
$durch = avesmapsOffroadFindPath($box, $gesperrtSchraeg, null, null, $tempo, 30.0, 5.0, 5.0, 30.0);
assert($durch === null, 'auch eine schraege Wand hat keine diagonale Luecke');

// ---- D: ein Fluss, der die Kiste nur streift, sperrt nichts -------------------------------
$fern = [[[-10.0, 39.9], [50.0, 39.9]]];
$kaum = avesmapsOffroadFindPath($box, avesmapsOffroadRasteriseBlocked($box, $keinWasser, $fern),
    null, null, $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($kaum), 'ein Fluss am Rand laesst die Reise in der Mitte in Ruhe');

// ---- E: 💣 DIE GERADE LINIE GEHT AM RASTER VORBEI ------------------------------------------
// avesmapsOffroadStraightPathIfDry fragt die POLYGONE. Wer nur die Sperrebene repariert,
// verhindert das Durchwaten unter „Schnellste" und laesst es unter „Kuerzeste" stehen.
$gerade = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null, $tempo,
    20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], $fluss);
assert($gerade === null, 'die trockene Gerade quert keinen Fluss');

// 🔴 DIE GEGENPROBE IST TRAGEND: ohne Fluss muss sie eine Antwort geben, sonst waere E auch dann
// gruen, wenn die Funktion aus einem ganz anderen Grund nichts liefert.
$geradeOhne = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null, $tempo,
    20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], []);
assert(is_array($geradeOhne) && count($geradeOhne['points']) === 2,
    'ohne Fluss bleibt die Gerade die Antwort');

// ---- F: ein Fluss NEBEN der Geraden stoert sie nicht --------------------------------------
$geradeFern = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null, $tempo,
    20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], [[[0.0, 39.5], [40.0, 39.5]]]);
assert(is_array($geradeFern), 'ein Fluss, den sie nicht kreuzt, geht sie nichts an');

// ---- G: der Sammler nimmt Fluesse und sonst nichts ----------------------------------------
// ⚠️ Seit dem 30.08.2026 liefert er ZWEI Faecher: 'wand' (Fluss) und 'furt' (Bach). Hier wird nur
// die Wand geprueft -- die Furt hat ihren eigenen Test (bach-furt-test.php).
$wege = [
    ['subtype' => 'Flussweg', 'geometry' => ['coordinates' => [[1.0, 1.0], [2.0, 2.0]]]],
    ['subtype' => 'Strasse',  'geometry' => ['coordinates' => [[3.0, 3.0], [4.0, 4.0]]]],
    // ⚠️ Seewege laufen ueber das Meer, das ohnehin gesperrt ist. Sie zusaetzlich als Wand zu
    // rastern wuerde Kuestenrouten zerschneiden.
    ['subtype' => 'Seeweg',   'geometry' => ['coordinates' => [[5.0, 5.0], [6.0, 6.0]]]],
    ['subtype' => 'Flussweg', 'geometry' => ['coordinates' => [[7.0, 7.0]]]],   // zu kurz
];
$gesammelt = avesmapsCollectRouteRiverBarrierLines($wege);
$wand = avesmapsOffroadBarrierLines($gesammelt);
assert(count($wand) === 1, 'genau ein Fluss, und der Einpunkt-Fluss faellt heraus: ' . count($wand));
assert($wand[0] === [[1.0, 1.0], [2.0, 2.0]], 'mit seiner Geometrie: ' . json_encode($wand[0]));
assert(avesmapsOffroadFordLines($gesammelt) === [], 'ohne Haekchen gibt es keine Furt');

fwrite(STDOUT, "fluss-sperre-test: OK\n");
