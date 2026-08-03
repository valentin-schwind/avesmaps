<?php

declare(strict_types=1);

// Die Gebirgspass-Normierung: die zweite Bremse kommt wieder heraus.
//
// 🔴 DIE REGEL, wörtlich (Geographia Aventurica S. 123):
//    „Da für Gebirgslandschaften bereits die Beeinträchtigungen durch Anstiege und Gefälle
//     berücksichtigt sind, ist die Tagesleistung nicht noch einmal zu modifizieren."
// Der Wegtyp-Faktor eines Passes (0,4) enthält den Anstieg schon. Unsere Steigungsebene legte eine
// zweite Bremse darauf -- gemessen auf einer echten Route: Greifenfurt–Lowangen dauerte 20,07 Tage
// statt der 17,37, die die Regel hergibt.
//
// 💣 UND DIE ENTSCHEIDUNG DAHINTER (Owner, 2026-08-03, Variante C): normiert wird NUR, wo ein
// Höhenprofil vorliegt. Ein unvermessener Pass hat gar keinen Faktor; teilte man seine gedachte 1,0
// trotzdem, wäre er 22 % schneller als die Regel erlaubt -- am schnellsten dort, wo wir am
// wenigsten wissen. In einer Live-Stichprobe hatten 44 % der Passstrecke kein Profil, das ist also
// der Normalfall und nicht die Ecke.
//
// Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/pass-normalizer-test.php

require_once __DIR__ . '/../terrain-calibration.php';

function passNear(float $expected, float $actual, string $what): void
{
    assert(abs($expected - $actual) < 1e-9, $what . ' -- erwartet ' . $expected . ', bekommen ' . $actual);
}

// ---- 1. der Teiler wird GELESEN, nicht gerechnet ------------------------------------------------

$calibration = [
    'c' => 30.96,
    'reference_subtype' => 'Strasse',
    'by_subtype' => [
        'Strasse' => ['mean_factor' => 1.032, 'ways' => 124, 'relative_to_reference' => 1.0],
        'Gebirgspass' => ['mean_factor' => 1.323, 'ways' => 61, 'relative_to_reference' => 1.281],
    ],
];
passNear(1.281, avesmapsTerrainPassNormalizer($calibration), 'der Teiler kommt aus der gespeicherten Eichung');

// 💣 UND ZWAR AUS `relative_to_reference`, NICHT AUS `mean_factor`. Er gehört zur Eichungsart, die
// wir gebaut haben: `c` = 30 x mean_G ist die MITTELWERTeichung, ihr Partner ist das Verhältnis
// Pass zu G (1,281). Die Punkteichung (ebene Straße = 30) paart mit mean_pass selbst (1,323). Die
// Kreuzung beider macht Pässe 3,3 % zu schnell -- der eine Fehler, für den dieser Test da ist.
assert(
    abs(avesmapsTerrainPassNormalizer($calibration) - 1.323) > 0.03,
    'der Teiler darf NICHT mean_factor sein -- das wäre die Kreuzung zweier Eichungsarten'
);

// ---- 2. ohne brauchbare Eichung passiert GAR NICHTS ---------------------------------------------
// Der Rückfallwert ist ein exaktes 1,0, kein geratener Wert: ohne Messung ist das heutige Verhalten
// die ehrliche Antwort.
foreach ([
    'keine Eichung' => null,
    'leere Eichung' => [],
    'keine Passzeile' => ['by_subtype' => ['Strasse' => ['relative_to_reference' => 1.0]]],
    'Text statt Zahl' => ['by_subtype' => ['Gebirgspass' => ['relative_to_reference' => 'viel']]],
    'kleiner als 1 (ein Pass ist nie schneller als eine Strasse)' => ['by_subtype' => ['Gebirgspass' => ['relative_to_reference' => 0.8]]],
    'über dem Deckel' => ['by_subtype' => ['Gebirgspass' => ['relative_to_reference' => 9.9]]],
] as $what => $broken) {
    passNear(1.0, avesmapsTerrainPassNormalizer($broken), 'Rückfall auf 1,0 bei: ' . $what);
}

// ---- 3. die Formel ------------------------------------------------------------------------------

$n = 1.281;

// Ein durchschnittlicher Pass landet exakt auf dem Wegtyp-Faktor -- das ist der ganze Zweck.
passNear(1.0, avesmapsTerrainNormalizePassFactor($n, 'Gebirgspass', $n), 'der Durchschnittspass wird 1,0');

// Ein steilerer bleibt langsamer, ein flacherer wird schneller. Bei alpha = 1 ist das eine glatte
// Division, die Spreizung zwischen den Pässen bleibt also erhalten.
passNear(1.546 / $n, avesmapsTerrainNormalizePassFactor(1.546, 'Gebirgspass', $n), 'ein steiler Pass bleibt über 1,0');
assert(avesmapsTerrainNormalizePassFactor(1.546, 'Gebirgspass', $n) > 1.0, 'und zwar wirklich langsamer als die Ebene');
passNear(1.045 / $n, avesmapsTerrainNormalizePassFactor(1.045, 'Gebirgspass', $n), 'ein flacher Pass kommt unter 1,0');
assert(avesmapsTerrainNormalizePassFactor(1.045, 'Gebirgspass', $n) < 1.0, 'ein vermessen flacher Pass ist schneller als der Durchschnitt');

// ---- 4. ALLE anderen Wegarten bleiben unnormiert -------------------------------------------------
// 🔴 Die Regel gilt Gebirgslandschaften. Eine Reichsstraße über einen Berg -- der Greifenpass ist
// bei uns genau das -- trägt ihren Steigungsfaktor unverändert, weil ihr Wegtyp-Faktor 1,1 den
// Anstieg eben NICHT enthält.
foreach (['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Wuestenpfad', 'Querfeldein', 'Flussweg', 'Seeweg', ''] as $subtype) {
    passNear(2.5, avesmapsTerrainNormalizePassFactor(2.5, $subtype, $n), $subtype . ' wird nicht normiert');
}

// Ein Teiler von 1,0 (kein Kalibrat) ist auch auf dem Pass ein exaktes No-op.
passNear(2.5, avesmapsTerrainNormalizePassFactor(2.5, 'Gebirgspass', 1.0), 'Teiler 1,0 lässt den Faktor unangetastet');
passNear(2.5, avesmapsTerrainNormalizePassFactor(2.5, 'Gebirgspass', 0.0), 'ein kaputter Teiler ebenso');

// ---- 5. der unvermessene Pass -- Entscheidung C --------------------------------------------------
//
// 🔴 DAS IST DIE ZEILE, UM DIE ES BEI C GING. Sie prüft die Bauweise, nicht die Formel: der Aufrufer
// erreicht die Normierung ausschließlich im Zweig `$sliceTerrain !== null`. Stünde sie außerhalb,
// bekäme ein Pass ohne Profil den Faktor 1/1,281 = 0,781 und wäre 22 % schneller als die Quelle
// erlaubt -- ein Rabatt fürs Nichtvermessensein.
$graphSource = (string) file_get_contents(__DIR__ . '/../client-graph.php');
assert($graphSource !== '', 'client-graph.php ist lesbar');
assert(
    preg_match('/\$sliceTerrain === null \? 1\.0\s*:\s*avesmapsTerrainNormalizePassFactor\(/', $graphSource) === 1,
    'die Normierung muss INNERHALB des „es gibt ein Profil"-Zweigs stehen. Außerhalb bekommt jeder '
    . 'unvermessene Pass 0,781 statt 1,0 -- und 44 % der Passstrecke sind unvermessen.'
);
// Und was der Faktor am Ende gilt, entscheidet ohnehin die Anwendung: ein null-Slice lässt die
// Verbindung UNBERÜHRT, sie trägt dann gar keinen `terrain_time_factor`.
assert(
    str_contains($graphSource, 'if ($sliceTerrain === null) {'),
    'avesmapsRouteApplyTerrainToConnection lässt eine profillose Verbindung unberührt'
);

// ---- 6. UND ES KOMMT AUCH WIRKLICH DURCH ---------------------------------------------------------
//
// 🪤 GENAU HIER WAR DER FEHLER. Der Teiler wird durch DREI Funktionen gereicht --
// BuildClientCompatibleRouteGraph -> AddClientCompatiblePathConnection -> AddClientCompatiblePath
// SliceConnection -- und beim Bauen war die dritte vergessen. Die reinen Tests oben blieben alle
// grün; aufgefallen ist es nur, weil ein Nachbartest an einem TypeError starb. Ein Test auf die
// Formel allein beweist nichts über die Verdrahtung.

require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../client-graph.php';

$passNetwork = [
    'locations' => [
        ['name' => 'Talort', 'geometry' => ['type' => 'Point', 'coordinates' => [0.0, 0.0]]],
        ['name' => 'Bergort', 'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 0.0]]],
    ],
    'paths' => [[
        'id' => 'p1', 'public_id' => 'p1', 'client_path_id' => 'path-1',
        'name' => 'Pass', 'subtype' => 'Gebirgspass', 'revision' => 7,
        'geometry' => ['type' => 'LineString', 'coordinates' => [[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]]],
        'properties' => [], 'flow' => null,
    ]],
];
$passRequest = ['transports' => AVESMAPS_ROUTE_DEFAULT_REQUEST['transports'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];
$passTerrain = ['p1' => ['ascent' => 3000.0, 'descent' => 3000.0,
    'profile' => [[3000.0, 0.0, 0.0, 0.0], [0.0, 3000.0, 0.0, 0.0]], 'revision' => 7, 'stamp' => 'x']];

$plain = avesmapsBuildClientCompatibleRouteGraph($passNetwork, $passRequest, $passTerrain);
$normed = avesmapsBuildClientCompatibleRouteGraph($passNetwork, $passRequest, $passTerrain, [], $n);
$plainEdge = $plain['graph']['Talort']['Bergort'][0];
$normedEdge = $normed['graph']['Talort']['Bergort'][0];

assert(isset($plainEdge['terrain_time_factor']), 'der Pass traegt ueberhaupt einen Geländefaktor');
passNear($plainEdge['terrain_time_factor'] / $n, $normedEdge['terrain_time_factor'],
    'der Teiler erreicht den Graphen und teilt den Faktor der Passkante');
// 🔴 Und die ZEIT muss mitgehen, nicht nur die gemeldete Zahl. Liefen sie auseinander, wählte der
// Dijkstra nach der einen und der Reiseplan zeigte die andere -- der Fehler, den V11 schon hatte.
passNear($plainEdge['time'] / $n, $normedEdge['time'], 'und die Kantenzeit geht mit');

// Dieselbe Geometrie als Strasse: der Teiler darf sie nicht anfassen.
$roadNetwork = $passNetwork;
$roadNetwork['paths'][0]['subtype'] = 'Strasse';
$roadNetwork['paths'][0]['name'] = 'Strasse';
$road = avesmapsBuildClientCompatibleRouteGraph($roadNetwork, $passRequest, $passTerrain, [], $n);
$roadPlain = avesmapsBuildClientCompatibleRouteGraph($roadNetwork, $passRequest, $passTerrain);
passNear($roadPlain['graph']['Talort']['Bergort'][0]['terrain_time_factor'],
    $road['graph']['Talort']['Bergort'][0]['terrain_time_factor'],
    'dieselbe Steigung als Strasse bleibt unnormiert');

// Und ohne Profil bleibt die Kante unberührt -- kein Faktor, also auch kein Rabatt.
$noProfile = avesmapsBuildClientCompatibleRouteGraph($passNetwork, $passRequest, [], [], $n);
assert(
    !array_key_exists('terrain_time_factor', $noProfile['graph']['Talort']['Bergort'][0]),
    'ein Pass ohne Höhenprofil bekommt gar keinen Faktor -- und damit auch keinen 22-%-Rabatt'
);

echo "pass-normalizer-test: all asserts passed\n";
