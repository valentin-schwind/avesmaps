<?php

declare(strict_types=1);

// EIN BACH IST EINE FURT, KEINE WAND.
//
// 🔴 Owner 30.08.2026, woertlich: „ja ein bach wird ueberquert werden koennen, aber nur mit etwas
// erschwernis, ich wollte aber nicht, dass du ihn komplett aus der hinternis erkennung rausnimmst."
// Ein Bach ist seit 9131b3800 ein `Flussweg` mit `properties.is_bach` -- und lag damit als volle
// Wand im Gelaende, wie jeder Fluss seit dem 15.08.2026 (fluss-sperre-test.php).
//
// Er kommt deshalb aus der Sperrebene heraus und in die FAKTOR-Ebene hinein, mit
// AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR = 3,0.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/bach-furt-test.php

// 💣 OHNE assert() PRUEFT DIESE DATEI NICHTS und meldet trotzdem „all asserts passed".
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../offroad-data.php';
require_once __DIR__ . '/../offroad-leg.php';
require_once __DIR__ . '/../synthetic-refine.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 40.0, 40.0);
$tempo = 2.30;
$keinWasser = avesmapsPrepareRouteAreas([]);

// 💣 DIE LINIE MUSS WEIT UEBER BEIDE RAENDER HINAUSREICHEN -- dieselbe Fixture-Falle wie in
// fluss-sperre-test.php: avesmapsBuildOffroadBox legt hier rund 17 Einheiten Rand um die Punkte,
// und ein Gewaesser, das INNERHALB der Kiste endet, laesst den Suchlauf aussen herum.
$querLinie = [[[-200.0, 20.0], [200.0, 20.0]]];

// =================================================================================================
// A. Der Sammler trennt WAND und FURT -- und zwar er allein
// =================================================================================================
$wege = [
    ['subtype' => 'Flussweg', 'geometry' => ['coordinates' => [[1.0, 1.0], [2.0, 2.0]]]],
    ['subtype' => 'Flussweg', 'properties' => ['is_bach' => true],
        'geometry' => ['coordinates' => [[3.0, 3.0], [4.0, 4.0]]]],
    // ⚠️ Das Haekchen gilt NUR am Flussweg (avesmapsPathIstBach). An einer Strasse hat es keine
    // Bedeutung -- und eine Strasse ist ohnehin kein Gewaesser.
    ['subtype' => 'Strasse', 'properties' => ['is_bach' => true],
        'geometry' => ['coordinates' => [[5.0, 5.0], [6.0, 6.0]]]],
    // ⚠️ Seewege laufen ueber das Meer, das ohnehin gesperrt ist.
    ['subtype' => 'Seeweg', 'geometry' => ['coordinates' => [[7.0, 7.0], [8.0, 8.0]]]],
    ['subtype' => 'Flussweg', 'properties' => ['is_bach' => true],
        'geometry' => ['coordinates' => [[9.0, 9.0]]]],   // zu kurz
];
$gesammelt = avesmapsCollectRouteRiverBarrierLines($wege);
assert(avesmapsOffroadBarrierLines($gesammelt) === [[[1.0, 1.0], [2.0, 2.0]]],
    'genau ein Fluss ist Wand: ' . json_encode($gesammelt['wand']));
// 🔴 Die Furt traegt seit dem 31.08.2026 IHREN Faktor mit (bach-furt-stroemung-test.php). Dieser
// Bach hat keine Stroemungsangabe, faellt also auf den Anker AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR --
// genau der Wert, der vor der Kopplung fuer jede Furt galt.
assert(avesmapsOffroadFordLines($gesammelt)
        === [['coords' => [[3.0, 3.0], [4.0, 4.0]], 'faktor' => AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR]],
    'genau ein Bach ist Furt, und der Einpunkt-Bach faellt heraus: ' . json_encode($gesammelt['furt']));

// 💣 GELESEN WIRD STRIKT `=== true`, genau wie im Browser (map-features-path-domain.js). Eine
// grosszuegigere Lesart hier hiesse: die Karte zeichnet einen Fluss und der Router nimmt eine Furt
// an. Das sieht man nur als Reisezeit.
foreach ([false, null, 0, '', '1', 'true', 1] as $wert) {
    $probe = avesmapsCollectRouteRiverBarrierLines([
        ['subtype' => 'Flussweg', 'properties' => ['is_bach' => $wert],
            'geometry' => ['coordinates' => [[0.0, 0.0], [1.0, 1.0]]]],
    ]);
    assert($probe['furt'] === [], 'nur literales true macht eine Furt, nicht ' . var_export($wert, true));
    assert(count($probe['wand']) === 1, 'alles andere bleibt Wand: ' . var_export($wert, true));
}

// 💣 DIE ALTE, FLACHE FORM WIRD ALS WAND GELESEN -- die sichere Richtung. Mit `['wand'] ?? []`
// waere der schlimmste Fall „KEIN Fluss sperrt mehr"; so ist er „ein Bach sperrt wieder".
assert(avesmapsOffroadBarrierLines($querLinie) === $querLinie, 'flache Liste ist Wand');
assert(avesmapsOffroadFordLines($querLinie) === [], 'und niemals Furt');
assert(avesmapsOffroadBarrierLines([]) === [] && avesmapsOffroadFordLines([]) === [], 'leer bleibt leer');

// =================================================================================================
// B. 🔴 EIN BACH SPERRT NICHT -- und ein Fluss weiterhin schon
// =================================================================================================
$mitBach = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => $querLinie]);
$mitFluss = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => $querLinie, 'furt' => []]);

assert(substr_count($mitBach['blocked'], "\x01") === 0,
    'ein Bach schreibt KEINE Zelle in die Sperrebene: ' . substr_count($mitBach['blocked'], "\x01"));
$gesperrteZellen = substr_count($mitFluss['blocked'], "\x01");
assert($gesperrteZellen > 0, 'die Gegenprobe: ein Fluss schon (' . $gesperrteZellen . ')');

$ueberBach = avesmapsOffroadFindPath($box, $mitBach['blocked'], $mitBach['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($ueberBach), 'die Reise quert den Bach');

// 🔴 UND DER FLUSS BLEIBT DIE WAND, DIE ER SEIT DEM 15.08.2026 IST. Ohne diese Zusicherung waere
// „Bach raus" nicht von „Gewaesser raus" zu unterscheiden.
$ueberFluss = avesmapsOffroadFindPath($box, $mitFluss['blocked'], $mitFluss['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
assert($ueberFluss === null, 'ein Fluss quer durch die Kiste bleibt eine Wand');

// =================================================================================================
// C. 🔴 ABER ER KOSTET -- mit der Gegenprobe gegen DIESELBE Strecke ohne Bach
// =================================================================================================
// 💣 OHNE DIE GEGENPROBE IST DAS VAKUUM: eine Zahl allein sagt nicht, dass der Bach sie erzeugt hat.
// Gefahren wird deshalb zweimal ueber dieselbe Sperrebene, einmal mit und einmal ohne Faktorebene.
$ohneAufschlag = avesmapsOffroadFindPath($box, $mitBach['blocked'], null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($ohneAufschlag), 'die Gegenprobe faehrt dieselbe Strecke');
assert(abs($ohneAufschlag['distance'] - $ueberBach['distance']) < 1e-9,
    'und sie ist geometrisch dieselbe: ' . $ohneAufschlag['distance'] . ' gegen ' . $ueberBach['distance']);
assert($ueberBach['time'] > $ohneAufschlag['time'] + 1e-9,
    'aber sie kostet mehr Zeit: ' . $ueberBach['time'] . ' gegen ' . $ohneAufschlag['time']);

// ⭐ WAS DAS HEISST, IN DER SPRACHE DER KARTE. Gemessen 30.08.2026 an dieser Fixture: eine
// Gelaendeetappe von 30,11 Einheiten (rund 90 Meilen), die EINEN Bach quert, wird um 3,3 % teurer --
// das sind 4,6 Meilen offenen Gelaendes. Die Zahl steht hier, damit ein spaeterer Leser sieht, was
// AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR = 3,0 wirklich bedeutet; die Schranken sind weit, sie sollen
// den Betrag einordnen und nicht die Rundung der Rasterung nachrechnen.
$mehrMeilen = ($ueberBach['time'] - $ohneAufschlag['time']) * $tempo * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;
assert($mehrMeilen > 2.0 && $mehrMeilen < 9.0,
    'ein Bach kostet die Groessenordnung weniger Meilen offenen Gelaendes: ' . $mehrMeilen);

// 💣 UND KEINE STRECKE. Der Aufschlag ist ein Zeitfaktor; `distance` ist eine Meilenzahl und wird
// von keiner Gelaenderegel angefasst (dieselbe Trennung wie beim Laengenaufschlag).
assert($ueberBach['distance'] === $ohneAufschlag['distance'], 'die Strecke bleibt unberuehrt');

// =================================================================================================
// D. 🔴 DER FAKTOR STEHT IM GEWICHT, NICHT NUR IN DER MESSUNG
// =================================================================================================
// Ein Bach, der bei x = 20 ENDET -- die Gerade quert ihn, ein kleiner Bogen um sein Ende herum
// nicht. Weicht der Suchlauf aus, liegt der Aufschlag wirklich in den Schrittkosten; stuende er nur
// in avesmapsOffroadFinishPath, liefe die Reise geradeaus und waere trotzdem teurer -- und C waere
// gruen, ohne dass die Suche je etwas gemerkt haette.
$halberBach = [[[-200.0, 20.0], [20.0, 20.0]]];
$halb = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => $halberBach]);
$ausweichen = avesmapsOffroadFindPath($box, $halb['blocked'], $halb['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
$geradeaus = avesmapsOffroadFindPath($box, $halb['blocked'], null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($ausweichen) && is_array($geradeaus), 'beide Wege gibt es');
assert($ausweichen['distance'] > $geradeaus['distance'] + 1e-9,
    'der Bogen um das Bachende ist LAENGER: ' . $ausweichen['distance'] . ' gegen ' . $geradeaus['distance']);
assert($ausweichen['time'] < $ueberBach['time'],
    'und trotzdem billiger als das Queren: ' . $ausweichen['time'] . ' gegen ' . $ueberBach['time']);

// =================================================================================================
// E. 🔴 UNTER „KUERZESTE" WIRKT ER NICHT -- und das ist die HAUSREGEL, kein Fehler
// =================================================================================================
// avesmapsOffroadFindPath neutralisiert Boden UND Steigung, sobald das Gewicht die Strecke ist
// ($weightByDistance). Wald, Sumpf und Gebirge bremsen dort ebenso wenig: auf eine Meilenzahl haben
// sie keinen Einfluss, also hat eine kuerzeste Linie keinen Grund, ihnen auszuweichen. Nur Wasser
// sperrt, und das steht in $blocked -- weshalb ein FLUSS auch unter „Kuerzeste" eine Wand bleibt.
//
// ⚠️ Wer das fuer einen Fehler haelt und den Bach dort „auch wirken laesst", dreht die Bedeutung des
// Knopfes um. Diese Zusicherung steht hier, damit das eine Entscheidung bleibt und kein Versehen.
$kuerzeste = avesmapsOffroadFindPath($box, $halb['blocked'], $halb['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert(is_array($kuerzeste), 'die kuerzeste Linie gibt es');
assert(abs($kuerzeste['distance'] - $geradeaus['distance']) < 1e-9,
    'sie geht GERADEAUS durch den Bach, sie weicht ihm nicht aus: '
    . $kuerzeste['distance'] . ' gegen ' . $geradeaus['distance']);
// 💣 Die MESSUNG traegt den Aufschlag trotzdem -- die Ebenen fliessen unveraendert an
// avesmapsOffroadFinishPath weiter. Eine kuerzeste Etappe haette sonst eine Laenge, aber keine
// ehrliche Reisezeit.
assert($kuerzeste['time'] > $geradeaus['time'] + 1e-9,
    'aber ihre gemeldete ZEIT traegt ihn: ' . $kuerzeste['time'] . ' gegen ' . $geradeaus['time']);

// =================================================================================================
// F. 🔴 UEBERLAGERT WIRD PER MAXIMUM -- eine Bachzelle im Sumpf bleibt Sumpf
// =================================================================================================
$bachByte = (int) round(AVESMAPS_ROUTE_OFFROAD_BACH_FACTOR * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
assert($bachByte > 0 && $bachByte < 256, 'der Bach passt in ein Byte: ' . $bachByte);

$sumpfByte = $bachByte + 40;                       // teurer als der Bach
$sumpf = str_repeat(chr($sumpfByte), $box['cell_count']);
$sumpfUndBach = avesmapsOffroadRasteriseBachFactor($box, $sumpf, $querLinie);
assert(substr_count($sumpfUndBach, chr($bachByte)) === 0,
    'im Sumpf setzt sich der Bach NICHT durch');
assert(substr_count($sumpfUndBach, chr($sumpfByte)) === $box['cell_count'], 'der Sumpf bleibt vollstaendig');

$wieseByte = $bachByte - 40;                       // billiger als der Bach
$wiese = str_repeat(chr($wieseByte), $box['cell_count']);
$wieseUndBach = avesmapsOffroadRasteriseBachFactor($box, $wiese, $querLinie);
$bachZellen = substr_count($wieseUndBach, chr($bachByte));
assert($bachZellen > 0, 'auf der billigeren Flaeche schon: ' . $bachZellen);
assert(substr_count($wieseUndBach, chr($wieseByte)) === $box['cell_count'] - $bachZellen,
    'und genau dort, sonst nirgends');

// =================================================================================================
// G. 💣 AUCH DIAGONAL KEINE LUECKE -- die Eckzellen des Treppenschritts
// =================================================================================================
// Der Suchlauf geht ueber ACHT Nachbarn. Zwischen zwei diagonal benachbarten Zellen schluepft er
// hindurch, solange die beiden Eckzellen frei bleiben. Bei der WAND macht das die Sperre
// wirkungslos (fluss-sperre-test.php C); bei der FURT laeuft der Schritt kostenlos vorbei -- und
// weil nichts fehlt, faellt es an genau einer Route auf.
$schraeg = [[[-200.0, -190.0], [200.0, 210.0]]];
$diagonal = avesmapsOffroadBuildPlanes($box, $keinWasser, null, ['wand' => [], 'furt' => $schraeg]);
$schraegMit = avesmapsOffroadFindPath($box, $diagonal['blocked'], $diagonal['factors'], null,
    $tempo, 30.0, 5.0, 5.0, 30.0);
$schraegOhne = avesmapsOffroadFindPath($box, $diagonal['blocked'], null, null,
    $tempo, 30.0, 5.0, 5.0, 30.0);
assert(is_array($schraegMit) && is_array($schraegOhne), 'die schraege Furt sperrt nicht');
assert($schraegMit['time'] > $schraegOhne['time'] + 1e-9,
    'aber auch schraeg kostet sie: ' . $schraegMit['time'] . ' gegen ' . $schraegOhne['time']);

// 🔴 UND DAS BAND HAT KEIN DIAGONALES LOCH. Das ist die scharfe Form der Zusicherung: die Zeile
// darueber bleibt naemlich gruen, wenn die Eckzellen fehlen -- die Reise zahlt dann eben irgendwo
// anders. Gesucht wird deshalb die Bauform selbst: ein 2x2-Block, in dem NUR die beiden Zellen
// EINER Diagonale markiert sind, ist genau der Schlupf, durch den ein Achter-Nachbarschritt
// kostenlos hindurchgeht.
// ⚠️ Bei der WAND faengt fluss-sperre-test.php (Abschnitt C) denselben Fehler ueber die Route --
// die Schrittlogik ist seit dem 30.08.2026 geteilt, der Fehler waere also derselbe. Hier steht er
// trotzdem noch einmal, weil die FURT ihn nicht als fehlenden Weg zeigt, sondern nur als eine
// Reisezeit, die niemand nachrechnet.
$istFurt = static fn(int $index): bool => ord($diagonal['factors'][$index]) === $bachByte;
$loecher = 0;
for ($row = 0; $row < $box['rows'] - 1; $row++) {
    for ($col = 0; $col < $box['cols'] - 1; $col++) {
        $obenLinks  = $istFurt($row * $box['cols'] + $col);
        $obenRechts = $istFurt($row * $box['cols'] + $col + 1);
        $untenLinks  = $istFurt(($row + 1) * $box['cols'] + $col);
        $untenRechts = $istFurt(($row + 1) * $box['cols'] + $col + 1);
        if ($obenLinks && $untenRechts && !$obenRechts && !$untenLinks) { $loecher++; }
        if ($obenRechts && $untenLinks && !$obenLinks && !$untenRechts) { $loecher++; }
    }
}
assert($loecher === 0, 'die schraege Furt hat keine diagonale Luecke: ' . $loecher);

// 🪤 GEGENPROBE, damit die Null oben nicht bloss heisst „hier ist gar nichts markiert".
$furtZellen = substr_count($diagonal['factors'], chr($bachByte));
assert($furtZellen > $box['rows'], 'und sie ist wirklich da: ' . $furtZellen . ' Zellen');

// =================================================================================================
// H. Grenzfaelle des Rasterers
// =================================================================================================
assert(avesmapsOffroadRasteriseBachFactor($box, '', []) === '',
    'ohne Bach entsteht keine Ebene aus dem Nichts');
$leerAberBach = avesmapsOffroadRasteriseBachFactor($box, '', $querLinie);
assert(strlen($leerAberBach) === $box['cell_count'],
    'aber MIT Bach entsteht eine -- sonst waere er dort wirkungslos, wo sonst nichts bremst');
assert(substr_count($leerAberBach, chr($bachByte)) > 0, 'und sie traegt ihn');

// 💣 Eine Ebene falscher Laenge wird NICHT angefasst: ein Schreibzugriff hinter dem Ende einer
// PHP-Zeichenkette verlaengert sie mit LEERZEICHEN (Byte 32 = Faktor 1,28) auf jeder Zelle
// dazwischen -- ein stiller Gelaendeaufschlag ueber die halbe Kiste.
$zuKurz = str_repeat("\x00", 5);
assert(avesmapsOffroadRasteriseBachFactor($box, $zuKurz, $querLinie) === $zuKurz,
    'eine Ebene falscher Laenge bleibt unberuehrt');

// =================================================================================================
// I. 💣 DIE GERADE LINIE GEHT AM RASTER VORBEI -- und braucht die Wand eigens
// =================================================================================================
// avesmapsOffroadStraightPathIfDry ist der Weg unter „Kuerzeste", wenn die Verbindung trocken ist.
// Sie sieht die Sperrebene nie, fragt die Fluesse also selbst. Ein Bach darf sie NICHT aufhalten --
// und weil sie durch avesmapsOffroadFinishPath geht, traegt sie den Aufschlag trotzdem.
$geradeUeberBach = avesmapsOffroadStraightPathIfDry($box, $keinWasser, $mitBach['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], $mitBach['wand']);
assert(is_array($geradeUeberBach), 'die Gerade quert einen Bach');
$geradeOhne = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], []);
assert(is_array($geradeOhne), 'die Gegenprobe ohne alles auch');
assert($geradeUeberBach['time'] > $geradeOhne['time'] + 1e-9,
    'und traegt seinen Aufschlag: ' . $geradeUeberBach['time'] . ' gegen ' . $geradeOhne['time']);

$geradeUeberFluss = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], $mitFluss['wand']);
assert($geradeUeberFluss === null, 'einen Fluss quert sie weiterhin nicht');

// 🔴 UND DIE WAND-HAELFTE KOMMT AUS DEM ERZEUGER MIT ZURUECK, damit sie hier nicht von Hand aus dem
// Bund gezogen werden muss -- das Auspacken geschieht an genau einer Stelle.
assert($mitFluss['wand'] === $querLinie, 'avesmapsOffroadBuildPlanes reicht die Wand durch');
assert($mitBach['wand'] === [], 'und ein Bach steht nicht darin');

// =================================================================================================
// J. LAUFZEIT: „Hierher reisen" ueber einen Bach
// =================================================================================================
// 💣 ALLES BISHERIGE PRUEFT DIE REGEL, NICHT IHRE VERDRAHTUNG. Dieser Abschnitt faehrt einen
// Kartenpunkt wirklich an -- dieselbe Bauform wie carriage-offroad-test.php --, damit die Kette
// response.php -> avesmapsAttachOffroadPointToGraph -> avesmapsOffroadBuildPlanes belegt ist.
$quadrat = static fn(float $x1, float $y1, float $x2, float $y2): array => [
    'geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]],
    'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2,
];
$land = avesmapsPrepareRouteAreas([$quadrat(-100.0, -100.0, 200.0, 200.0)]);
$orte = [
    ['name' => 'A', 'geometry' => ['type' => 'Point', 'coordinates' => [5.0, 10.0]]],
    ['name' => 'B', 'geometry' => ['type' => 'Point', 'coordinates' => [25.0, 10.0]]],
];
$baueGraph = static function (): array {
    $strasse = [
        'route_type' => 'Strasse', 'transport_option' => 'groupFoot',
        'id' => 'path-AB', 'path_id' => 'path-AB', 'from' => 'A', 'to' => 'B',
        'distance' => 20.0,
        'time' => 20.0 / (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'],
        'geometry' => ['type' => 'LineString', 'coordinates' => [[5.0, 10.0], [25.0, 10.0]]],
    ];
    $graph = ['A' => [], 'B' => []];
    avesmapsAddClientCompatibleGraphConnection($graph, 'A', 'B', $strasse);
    avesmapsAddClientCompatibleGraphConnection($graph, 'B', 'A', $strasse);
    return ['graph' => $graph, 'statistics' => []];
};
$anfrage = [
    'optimize' => 'fastest',
    'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true],
];
// Das Gewaesser liegt zwischen der Strasse (y = 10) und dem Kartenpunkt (y = 16).
$dazwischen = [[[-400.0, 13.0], [400.0, 13.0]]];

// ⭐ ERST DIE GEGENPROBE OHNE GEWAESSER -- ohne sie belegt der Vergleich unten nichts.
$g1 = $baueGraph();
$trocken = avesmapsAttachOffroadPointToGraph($g1, $orte, $anfrage, [], $land, null,
    15.0, 16.0, '__offroad_to', true, []);
assert($trocken['ok'] === true, 'der Kartenpunkt ist trocken erreichbar: ' . json_encode($trocken));

$g2 = $baueGraph();
$mitFurt = avesmapsAttachOffroadPointToGraph($g2, $orte, $anfrage, [], $land, null,
    15.0, 16.0, '__offroad_to', true, ['wand' => [], 'furt' => $dazwischen]);
assert($mitFurt['ok'] === true, 'ueber einen Bach auch: ' . json_encode($mitFurt));
$kostenTrocken = (float) $trocken['exit_nodes'][0]['cost_units'];
$kostenFurt = (float) $mitFurt['exit_nodes'][0]['cost_units'];
assert($kostenFurt > $kostenTrocken + 1e-9,
    'und die Kante ist teurer: ' . $kostenFurt . ' gegen ' . $kostenTrocken);

// 🔴 Ein FLUSS an derselben Stelle schneidet den Punkt weiterhin ab.
$g3 = $baueGraph();
$mitWand = avesmapsAttachOffroadPointToGraph($g3, $orte, $anfrage, [], $land, null,
    15.0, 16.0, '__offroad_to', true, ['wand' => $dazwischen, 'furt' => []]);
assert($mitWand['ok'] === false, 'hinter einem Fluss nicht: ' . json_encode($mitWand));
assert($mitWand['error'] === 'no_offroad_route', 'und zwar mangels Weges: ' . $mitWand['error']);

// ---- und dieselbe Probe an den beiden UEBRIGEN Zusammenbau-Stellen -------------------------------
// 🔴 EINE REGEL, DIE EINEN VON DREI ERZEUGERN BINDET, IST KEINE REGEL. K zaehlt sie im Quelltext;
// hier werden sie GEFAHREN -- der Zaehler sieht nicht, ob der Aufruf auch wirkt.

// Stelle 2: die direkte Kante zwischen zwei Kartenpunkten (avesmapsConnectOffroadPoints).
$vonPunkt = ['x' => 15.0, 'y' => 8.0];
$nachPunkt = ['x' => 15.0, 'y' => 18.0];
$kante = static function (array $gewaesser) use ($anfrage, $vonPunkt, $nachPunkt): array {
    $graph = ['P' => [], 'Q' => []];
    $huelle = ['graph' => $graph, 'statistics' => []];
    $bericht = avesmapsConnectOffroadPoints($huelle, $anfrage, [], null, $vonPunkt, $nachPunkt,
        'P', 'Q', true, 'offroad-direct', $gewaesser);
    return $bericht;
};
$kanteTrocken = $kante([]);
assert($kanteTrocken['ok'] === true, 'die direkte Kante entsteht trocken: ' . json_encode($kanteTrocken));
$kanteFurt = $kante(['wand' => [], 'furt' => $dazwischen]);
assert($kanteFurt['ok'] === true, 'und ueber einen Bach auch: ' . json_encode($kanteFurt));
assert((float) $kanteFurt['cost_units'] > (float) $kanteTrocken['cost_units'] + 1e-9,
    'aber teurer: ' . $kanteFurt['cost_units'] . ' gegen ' . $kanteTrocken['cost_units']);
$kanteWand = $kante(['wand' => $dazwischen, 'furt' => []]);
assert($kanteWand['ok'] === false, 'hinter einem Fluss gar nicht: ' . json_encode($kanteWand));

// Stelle 3: das Nachbiegen einer Sehne (avesmapsFindOffroadPathBetween, synthetic-refine.php).
$biegen = static fn(array $gewaesser): ?array => avesmapsFindOffroadPathBetween(
    $anfrage, [], null, 15.0, 8.0, 15.0, 18.0, true, $gewaesser);
$bogenTrocken = $biegen([]);
assert(is_array($bogenTrocken), 'die Sehne laesst sich trocken biegen');
$bogenFurt = $biegen(['wand' => [], 'furt' => $dazwischen]);
assert(is_array($bogenFurt), 'ueber einen Bach auch');
assert($bogenFurt['time'] > $bogenTrocken['time'] + 1e-9,
    'und kostet mehr: ' . $bogenFurt['time'] . ' gegen ' . $bogenTrocken['time']);
assert($biegen(['wand' => $dazwischen, 'furt' => []]) === null, 'hinter einem Fluss nicht');

// =================================================================================================
// K. 🔴 ALLE ZUSAMMENBAU-STELLEN GEHEN DURCH DEN EINEN ERZEUGER -- gezaehlt, nicht aufgezaehlt
// =================================================================================================
// Die vier Zeilen „Sperre, Faktoren, Raster, Hoehen" standen bis zum 30.08.2026 dreimal da. Der
// Bach-Aufschlag waere die naechste Regel gewesen, die man an jeder einzeln haette nachziehen
// muessen -- die Fehlerklasse, die dieses Haus zweimal bezahlt hat (Verkehrsmittel-Sperre
// 14.08.2026, Ausstiegsregel 15.08.2026).
//
// 🪤 KOMMENTARE WERDEN VORHER ENTFERNT: dieser Test schluege sonst an den Hinweisen an, die auf den
// Erzeuger VERWEISEN -- und der naechste Leser loescht dann den Kommentar.
// 🪤 UND ZEILENENDEN WERDEN VEREINHEITLICHT: die Arbeitskopie traegt hier CRLF, die CI LF.
$lies = static function (string $datei): string {
    $quelle = (string) file_get_contents(__DIR__ . '/../' . $datei);
    $quelle = str_replace("\r\n", "\n", $quelle);
    $quelle = (string) preg_replace('~/\*.*?\*/~s', '', $quelle);

    return (string) preg_replace('~^\s*//.*$~m', '', $quelle);
};
$zusammenbau = $lies('offroad-leg.php') . "\n" . $lies('synthetic-refine.php');

// 🔴 DIE INVARIANTE: wer eine Suchkiste baut, braucht Ebenen -- und holt sie beim Erzeuger.
// Gezaehlt wird eine Zahl gegen eine andere, damit hier keine feste Zahl steht, die beim naechsten
// Erzeuger falsch ist (dieselbe Lehre wie bei „ERZEUGER 1 VON 2").
$kisten = preg_match_all('~avesmapsBuildOffroadBox\s*\(~', $zusammenbau);
$erzeuger = preg_match_all('~avesmapsOffroadBuildPlanes\s*\(~', $zusammenbau);
assert($kisten > 0, 'es gibt ueberhaupt Zusammenbau-Stellen: ' . $kisten);
assert($erzeuger === $kisten,
    "jede Suchkiste holt ihre Ebenen beim gemeinsamen Erzeuger (Kisten: $kisten, Erzeuger: $erzeuger)");

// 🔴 UND NIEMAND BAUT SIE SELBST. Das ist die schaerfere Haelfte: eine zusaetzliche eigene Rasterung
// neben dem Erzeuger wuerde die Zahlen oben unberuehrt lassen.
foreach ([
    'avesmapsOffroadRasteriseBlocked',
    'avesmapsOffroadLoadFactorPlane',
    'avesmapsOffroadLoadHeightRasters',
    'avesmapsOffroadSampleHeights',
] as $selbstbau) {
    $treffer = preg_match_all('~' . $selbstbau . '\s*\(~', $zusammenbau);
    assert($treffer === 0,
        "$selbstbau gehoert in avesmapsOffroadBuildPlanes und nirgends sonst (gefunden: $treffer)");
}

// 🔴 UND DIE GERADE BEKOMMT IHRE WAND AUS DEMSELBEN RUECKGABEWERT. avesmapsOffroadStraightPathIfDry
// geht am Raster vorbei und muss die Fluesse eigens gefragt bekommen; naehme ein Aufrufer sie
// woanders her (oder gar nicht), querte die kuerzeste Linie wieder Fluesse -- der Befund vom
// 15.08.2026, nur an einer Stelle weiter. Auch hier eine Zahl gegen eine Zahl.
$leg = $lies('offroad-leg.php');
$geraden = preg_match_all('~avesmapsOffroadStraightPathIfDry\s*\(~', $leg);
$wandDurchgereicht = substr_count($leg, "\$ebenen['wand']");
assert($geraden > 0, 'es gibt Aufrufe der Geraden: ' . $geraden);
assert($wandDurchgereicht === $geraden,
    "jede Gerade bekommt die Wand aus dem Erzeuger (Geraden: $geraden, durchgereicht: $wandDurchgereicht)");

// 🪤 ZEUGE: der Erzeuger muss die beiden Ebenen wirklich bauen -- sonst waeren die vier Nullen oben
// auch von einem Erzeuger erfuellt, der gar nichts tut.
$daten = $lies('offroad-data.php');
$stelle = strpos($daten, 'function avesmapsOffroadBuildPlanes');
assert($stelle !== false, 'avesmapsOffroadBuildPlanes muss es geben');
$rumpf = substr($daten, $stelle);
foreach (['avesmapsOffroadRasteriseBlocked(', 'avesmapsOffroadRasteriseBachFactor(',
    'avesmapsOffroadLoadFactorPlane(', 'avesmapsOffroadLoadHeightRasters(',
    'avesmapsOffroadSampleHeights('] as $noetig) {
    assert(str_contains($rumpf, $noetig), "der Erzeuger ruft $noetig selbst");
}

// 🪤 UND EIN LAUFZEIT-ZEUGE DAZU: der Quelltext-Zaehler oben sieht nicht, OB der Aufruf wirkt.
$zeuge = avesmapsOffroadBuildPlanes($box, $keinWasser, null,
    ['wand' => $querLinie, 'furt' => [[[-200.0, 30.0], [200.0, 30.0]]]]);
assert(substr_count($zeuge['blocked'], "\x01") > 0, 'der Erzeuger sperrt die Wand');
assert(substr_count($zeuge['factors'], chr($bachByte)) > 0, 'und bepreist die Furt');
assert($zeuge['heights'] === null && $zeuge['rasters'] === [], 'ohne PDO bleiben die Hoehen inert');

fwrite(STDOUT, "bach-furt-test: OK\n");
