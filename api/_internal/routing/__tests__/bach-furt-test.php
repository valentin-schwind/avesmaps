<?php

declare(strict_types=1);

// EIN BACH IST EINE FURT, KEINE WAND.
//
// 🔴 Owner 30.08.2026, woertlich: „ja ein bach wird ueberquert werden koennen, aber nur mit etwas
// erschwernis, ich wollte aber nicht, dass du ihn komplett aus der hinternis erkennung rausnimmst."
// Ein Bach ist seit 9131b3800 ein `Flussweg` mit `properties.is_bach` -- und lag damit als volle
// Wand im Gelaende, wie jeder Fluss seit dem 15.08.2026 (fluss-sperre-test.php).
//
// Er kommt deshalb aus der Sperrebene heraus.
//
// 🔴 SEIT DEM 31.08.2026 IST DER PREIS EIN QUERUNGS-AUFSCHLAG, KEIN ZELLFAKTOR MEHR (Owner: „ich
// will dass der bach ein hindernis ist / er geht aber nicht drumrum / sondern durch"). Der alte
// Zellfaktor konnte nie lenken -- er war an die Zellbreite gefesselt, waehrend der Umweg mit der
// Geometrie waechst. Die Furt hat jetzt eine EIGENE Ebene (avesmapsOffroadRasteriseFurtPlane) und
// kostet an der Kante: halb beim Hinein, halb beim Hinaus. Was das im Ganzen heisst, misst
// bach-querung-hindernis-test.php; hier bleibt, was den Bach von der Wand unterscheidet.
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
// 🔴 Die Furt traegt IHREN Querungsfaktor mit. Dieser Bach hat keine Stroemungsangabe, faellt also
// auf den Anker: Vorgabe-Stroemung = Faktor 1,0 = eine Querung zum vollen Preis.
assert(avesmapsOffroadFordLines($gesammelt)
        === [['coords' => [[3.0, 3.0], [4.0, 4.0]], 'faktor' => 1.0]],
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
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], false, $mitBach['furtplane']);
assert(is_array($ueberBach), 'die Reise quert den Bach');

// 🔴 UND DER FLUSS BLEIBT DIE WAND, DIE ER SEIT DEM 15.08.2026 IST. Ohne diese Zusicherung waere
// „Bach raus" nicht von „Gewaesser raus" zu unterscheiden.
$ueberFluss = avesmapsOffroadFindPath($box, $mitFluss['blocked'], $mitFluss['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], false, $mitFluss['furtplane']);
assert($ueberFluss === null, 'ein Fluss quer durch die Kiste bleibt eine Wand');

// =================================================================================================
// C. 🔴 ABER ER KOSTET -- mit der Gegenprobe gegen DIESELBE Strecke ohne Bach
// =================================================================================================
// 💣 OHNE DIE GEGENPROBE IST DAS VAKUUM: eine Zahl allein sagt nicht, dass der Bach sie erzeugt hat.
// Gefahren wird deshalb zweimal ueber dieselbe Sperrebene, einmal mit und einmal ohne Faktorebene.
$ohneAufschlag = avesmapsOffroadFindPath($box, $mitBach['blocked'], null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0);   // ohne Furt-Ebene = ohne Querungspreis
assert(is_array($ohneAufschlag), 'die Gegenprobe faehrt dieselbe Strecke');
assert(abs($ohneAufschlag['distance'] - $ueberBach['distance']) < 1e-9,
    'und sie ist geometrisch dieselbe: ' . $ohneAufschlag['distance'] . ' gegen ' . $ueberBach['distance']);
assert($ueberBach['time'] > $ohneAufschlag['time'] + 1e-9,
    'aber sie kostet mehr Zeit: ' . $ueberBach['time'] . ' gegen ' . $ohneAufschlag['time']);

// ⭐ WAS DAS HEISST, IN DER SPRACHE DER KARTE: eine Querung kostet wie
// AVESMAPS_ROUTE_OFFROAD_BACH_CROSSING_UNITS Karteneinheiten offenen Gelaendes -- bei
// Vorgabe-Stroemung die 15 Meilen, die der Owner am 31.08.2026 genannt hat.
// ⚠️ Die Schranken sind weit: gezaehlt werden RASTERKANTEN, und eine schraege Querung beruehrt mehr
// Bandzellen als eine gerade. Sie sollen den Betrag einordnen, nicht die Rasterung nachrechnen.
$mehrMeilen = ($ueberBach['time'] - $ohneAufschlag['time']) * $tempo * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;
assert($mehrMeilen > 10.0 && $mehrMeilen < 45.0,
    'ein Bach kostet die Groessenordnung einer Querung: ' . $mehrMeilen . ' Meilen');

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
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], false, $halb['furtplane']);
$geradeaus = avesmapsOffroadFindPath($box, $halb['blocked'], null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0);
assert(is_array($ausweichen) && is_array($geradeaus), 'beide Wege gibt es');
assert($ausweichen['distance'] > $geradeaus['distance'] + 1e-9,
    'der Bogen um das Bachende ist LAENGER: ' . $ausweichen['distance'] . ' gegen ' . $geradeaus['distance']);
assert($ausweichen['time'] < $ueberBach['time'],
    'und trotzdem billiger als das Queren: ' . $ausweichen['time'] . ' gegen ' . $ueberBach['time']);

// =================================================================================================
// E. 🔴 UNTER „KUERZESTE" WIRKT ER JETZT AUCH -- und das war eine ENTSCHEIDUNG
// =================================================================================================
// 🪤 HIER STAND DAS GEGENTEIL, und der Kommentar verlangte ausdruecklich: „Wer das fuer einen Fehler
// haelt und den Bach dort auch wirken laesst, dreht die Bedeutung des Knopfes um. Diese Zusicherung
// steht hier, damit das eine Entscheidung bleibt und kein Versehen." Genau das ist am 31.08.2026
// passiert -- der Owner hat entschieden: „ich will dass der bach ein hindernis ist".
//
// ⭐ Moeglich wurde es OHNE die Hausregel anzufassen: der Querungspreis ist kein FAKTOR, also fasst
// ihn die Neutralisierung ($slopeFactor/$groundFactor = 1.0) nicht an. Wald, Sumpf und Gebirge
// bremsen unter „Kuerzeste" weiterhin nicht -- Wasser schon, und das tat es dort mit der WAND seit
// jeher.
// ⚠️ Der Preis: „Kuerzeste" ist nicht mehr die kuerzeste, wenn ein Bach im Weg liegt.
$kuerzeste = avesmapsOffroadFindPath($box, $halb['blocked'], $halb['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true, $halb['furtplane']);
assert(is_array($kuerzeste), 'die kuerzeste Linie gibt es');
assert($kuerzeste['distance'] > $geradeaus['distance'] + 1e-9,
    'sie weicht dem Bach aus und ist damit LAENGER als die Gerade: '
    . $kuerzeste['distance'] . ' gegen ' . $geradeaus['distance']);
// 🔴 Und die Gegenprobe, ohne die das auch von einem kaputten Suchlauf erfuellt waere: OHNE die
// Furt-Ebene nimmt derselbe Aufruf weiterhin die Gerade.
$kuerzesteOhne = avesmapsOffroadFindPath($box, $halb['blocked'], $halb['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert(abs($kuerzesteOhne['distance'] - $geradeaus['distance']) < 1e-9,
    'ohne Furt-Ebene bleibt die kuerzeste Linie gerade: ' . $kuerzesteOhne['distance']);

// =================================================================================================
// F. 🔴 UEBERLAGERT WIRD PER MAXIMUM -- wo zwei Baeche liegen, gilt der teurere
// =================================================================================================
// 🪤 HIER STAND „eine Bachzelle im Sumpf bleibt Sumpf". Das gibt es nicht mehr: die Furt liegt seit
// dem 31.08.2026 in einer EIGENEN Ebene und ueberlagert die Landschaft nicht mehr -- ein Bach im
// Sumpf kostet jetzt BEIDES, den Sumpf als Untergrund und die Querung an der Kante. Die
// Maximum-Regel bleibt trotzdem noetig: zwei Baeche koennen dieselbe Zelle treffen.
$bachByte = (int) round(1.0 * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);   // Anker = Querungsfaktor 1,0
assert($bachByte > 0 && $bachByte < 256, 'der Anker passt in ein Byte: ' . $bachByte);

$furtEbene = avesmapsOffroadRasteriseFurtPlane($box, $querLinie);
assert(substr_count($furtEbene, chr($bachByte)) > 0, 'die flache Altform ergibt den Anker');

$stark = [['coords' => $querLinie[0], 'faktor' => 3.0], ['coords' => $querLinie[0], 'faktor' => 1.0]];
$zweiBaeche = avesmapsOffroadRasteriseFurtPlane($box, $stark);
$starkByte = (int) round(3.0 * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE);
assert(substr_count($zweiBaeche, chr($starkByte)) > 0, 'der teurere setzt sich durch');
assert(substr_count($zweiBaeche, chr($bachByte)) === 0,
    'und der billigere steht auf denselben Zellen NICHT mehr daneben');

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
    $tempo, 30.0, 5.0, 5.0, 30.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], false, $diagonal['furtplane']);
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
$istFurt = static fn(int $index): bool => ord($diagonal['furtplane'][$index]) === $bachByte;
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
$furtZellen = substr_count($diagonal['furtplane'], chr($bachByte));
assert($furtZellen > $box['rows'], 'und sie ist wirklich da: ' . $furtZellen . ' Zellen');

// =================================================================================================
// H. Grenzfaelle des Rasterers
// =================================================================================================
assert(avesmapsOffroadRasteriseFurtPlane($box, []) === '',
    'ohne Bach entsteht keine Ebene aus dem Nichts');
$leerAberBach = avesmapsOffroadRasteriseFurtPlane($box, $querLinie);
assert(strlen($leerAberBach) === $box['cell_count'],
    'aber MIT Bach entsteht eine -- in voller Kistenlaenge, sonst zeigt sie an der falschen Stelle');
assert(substr_count($leerAberBach, chr($bachByte)) > 0, 'und sie traegt ihn');

// ⭐ Die alte Falle „eine Ebene falscher Laenge wird nicht angefasst" gibt es hier nicht mehr: die
// Furt-Ebene wird IMMER selbst angelegt und nie in eine fremde hineingeschrieben. Genau das war der
// Grund, sie zu trennen -- ein Schreibzugriff hinter dem Ende einer PHP-Zeichenkette verlaengert sie
// mit LEERZEICHEN (Byte 32) und legte einen stillen Aufschlag ueber die halbe Kiste.

// =================================================================================================
// I. 💣 DIE GERADE LINIE GEHT AM RASTER VORBEI -- und braucht die Wand eigens
// =================================================================================================
// avesmapsOffroadStraightPathIfDry ist der Weg unter „Kuerzeste", wenn die Verbindung trocken ist.
// Sie sieht die Sperrebene nie, fragt die Gewaesser also selbst.
// 🪤 HIER STAND „Ein Bach darf sie NICHT aufhalten" -- und genau das war der Fehler, den der Owner
// am 31.08.2026 im Bild hatte: eine schnurgerade Linie quer durch den Bach, bei jedem
// Stroemungsfaktor. Die Abkuerzung nahm die Gerade, BEVOR der A* ueberhaupt lief.
// 🔴 Sie wird jetzt verworfen, nicht bepreist: eine Gerade kann nicht ausweichen. Faellt sie weg,
// entscheidet der A* -- und der wiegt den Querungspreis gegen den Umweg.
$geradeUeberBach = avesmapsOffroadStraightPathIfDry($box, $keinWasser, $mitBach['factors'], null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], $mitBach['wand'],
    $mitBach['furtlinien']);
assert($geradeUeberBach === null, 'die Gerade wird verworfen, wenn sie einen Bach quert');
$geradeOhne = avesmapsOffroadStraightPathIfDry($box, $keinWasser, null, null,
    $tempo, 20.0, 5.0, 20.0, 35.0, AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], []);
assert(is_array($geradeOhne), 'die Gegenprobe ohne alles bleibt erhalten');

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
foreach (['avesmapsOffroadRasteriseBlocked(', 'avesmapsOffroadRasteriseFurtPlane(',
    'avesmapsOffroadLoadFactorPlane(', 'avesmapsOffroadLoadHeightRasters(',
    'avesmapsOffroadSampleHeights('] as $noetig) {
    assert(str_contains($rumpf, $noetig), "der Erzeuger ruft $noetig selbst");
}

// 🪤 UND EIN LAUFZEIT-ZEUGE DAZU: der Quelltext-Zaehler oben sieht nicht, OB der Aufruf wirkt.
$zeuge = avesmapsOffroadBuildPlanes($box, $keinWasser, null,
    ['wand' => $querLinie, 'furt' => [[[-200.0, 30.0], [200.0, 30.0]]]]);
assert(substr_count($zeuge['blocked'], "\x01") > 0, 'der Erzeuger sperrt die Wand');
assert(substr_count($zeuge['furtplane'], chr($bachByte)) > 0, 'und bepreist die Furt');
assert($zeuge['heights'] === null && $zeuge['rasters'] === [], 'ohne PDO bleiben die Hoehen inert');

fwrite(STDOUT, "bach-furt-test: OK\n");
