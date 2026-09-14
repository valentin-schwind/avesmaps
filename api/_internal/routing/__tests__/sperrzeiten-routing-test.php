<?php
// api/_internal/routing/__tests__/sperrzeiten-routing-test.php
declare(strict_types=1);

/**
 * Sperrzeiten und Reisemittel-Sperren in der Routenwahl (Entwurf
 * docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md).
 *
 * 🔴 DER ABLAUF WIRD AUSGEFUEHRT, nicht der Quelltext gelesen: echte Graphbauten ueber
 * `avesmapsBuildClientCompatibleRouteGraph`, echte Dijkstra-Laeufe, echte Teilung am Wegpunkt-Anker.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/routing/__tests__/sperrzeiten-routing-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../request.php';
require_once __DIR__ . '/../client-graph.php';
require_once __DIR__ . '/../transport-season.php';

const SPERRTEST_LAND = ['caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider'];

$wirft = static function (callable $lauf): bool {
    try {
        $lauf();
    } catch (InvalidArgumentException) {
        return true;
    }
    return false;
};

// =====================================================================================================
// A. Die Anfrage: `departure` ist optional, und ohne es aendert sich nichts
// =====================================================================================================
$ohne = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B']);
assert(array_key_exists('departure', $ohne) && $ohne['departure'] === null, 'ohne departure steht null da');

$mit = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['month' => ' Firun ', 'day' => 31]]);
assert($mit['departure']['month'] === 'firun', 'der Monat wird normalisiert: ' . json_encode($mit['departure']));
assert($mit['departure']['day'] === 30, 'der Tag wird auf 30 geklemmt, wie im Kalender');
assert($mit['departure']['elapsed_hours'] === 0.0, 'ohne elapsed_hours beginnt die Uhr bei null');
assert($mit['departure']['day_of_year'] === avesmapsTravelCalendarDayOfYear('firun', 30), 'der Jahrestag steht dabei');

$weiter = avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['month' => 'peraine', 'day' => '15', 'elapsed_hours' => '86.5']]);
assert($weiter['departure']['day'] === 15 && abs($weiter['departure']['elapsed_hours'] - 86.5) < 1e-9, 'Zahlen als Zeichenkette gehen');

assert($wirft(fn () => avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['month' => 'namenlos', 'day' => 1]])), 'unbekannter Monat ist invalid_request');
assert($wirft(fn () => avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['month' => 'firun', 'day' => 'x']])), 'ein Tag, der keine Zahl ist, ist invalid_request');
assert($wirft(fn () => avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['month' => 'firun', 'day' => 1, 'elapsed_hours' => -1]])), 'negative Stunden sind invalid_request');
assert($wirft(fn () => avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => 'firun'])), 'departure muss ein Objekt sein');
assert($wirft(fn () => avesmapsNormalizeRouteRequest(['from' => 'A', 'to' => 'B', 'departure' => ['day' => 3]])), 'ohne Monat ist departure unbrauchbar');
echo "A. departure ok\n";

// =====================================================================================================
// B. Die Kante traegt ihr Fenster, die Nebenliste die gesperrten Reisemittel
// =====================================================================================================
$fensterSommer = ['from_month' => 'praios', 'from_day' => 1, 'to_month' => 'efferd', 'to_day' => 30];
$ort = static fn (string $name, float $x, float $y): array => ['name' => $name, 'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]]];
$weg = static function (string $id, string $subtype, array $punkte, array $properties = [], string $anzeige = '') {
    return [
        'id' => 'feature-' . $id,
        'public_id' => 'pub-' . $id,
        'client_path_id' => 'path-' . $id,
        'name' => $subtype,
        'subtype' => $subtype,
        'display_name' => $anzeige !== '' ? $anzeige : $subtype . '-' . $id,
        'geometry' => ['type' => 'LineString', 'coordinates' => $punkte],
        'properties' => $properties,
    ];
};
$anfrage = static fn (string $land = 'groupFoot', ?array $departure = null): array => [
    'optimize' => 'fastest',
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true],
    'transports' => ['land' => $land, 'river' => 'riverSailer', 'sea' => 'cargoShip', 'synthetic' => $land],
    'departure' => $departure,
];

// A ---Pass P (10)--- B, und ein Umweg A --- C --- B ueber Strassen.
$passProperties = [
    'transport_domain' => 'land',
    'allowed_transports' => SPERRTEST_LAND,
    'transport_seasons' => array_fill_keys(SPERRTEST_LAND, $fensterSommer),
    'wiki_path' => ['wiki_key' => 'saljethweg', 'name' => 'Saljethweg'],
];
$netz = [
    'locations' => [$ort('A', 0.0, 0.0), $ort('B', 10.0, 0.0), $ort('C', 5.0, 20.0)],
    'paths' => [
        $weg('P', 'Gebirgspass', [[0.0, 0.0], [10.0, 0.0]], $passProperties, 'Saljethweg'),
        $weg('S1', 'Strasse', [[0.0, 0.0], [5.0, 20.0]]),
        $weg('S2', 'Strasse', [[5.0, 20.0], [10.0, 0.0]]),
    ],
];
$bau = avesmapsBuildClientCompatibleRouteGraph($netz, $anfrage());
$passHin = $bau['graph']['A']['B'][0] ?? null;
$passZurueck = $bau['graph']['B']['A'][0] ?? null;
assert(is_array($passHin) && is_array($passZurueck), 'die Passkante steht in beiden Richtungen im Graphen');
assert(($passHin['season_window']['from_day_of_year'] ?? null) === 1 && ($passHin['season_window']['to_day_of_year'] ?? null) === 90,
    'B1: die Kante traegt das Fenster ihres Reisemittels: ' . json_encode($passHin['season_window'] ?? null));
assert(isset($passZurueck['season_window']), 'B1: auch die Gegenrichtung');
assert(($passHin['sperr_weg']['key'] ?? '') === 'wiki:saljethweg' && ($passHin['sperr_weg']['name'] ?? '') === 'Saljethweg',
    'B1: und sagt, zu welchem Weg sie gehoert: ' . json_encode($passHin['sperr_weg'] ?? null));
$strasse = $bau['graph']['A']['C'][0] ?? [];
assert(!array_key_exists('season_window', $strasse) && !array_key_exists('sperr_weg', $strasse),
    'B1: eine Strasse ohne Fenster bleibt Byte fuer Byte, was sie war');

// Ein Fenster fuer ein ANDERES Reisemittel gilt dieser Kante nicht.
$nurReiter = $passProperties;
$nurReiter['transport_seasons'] = ['groupHorse' => $fensterSommer];
$bauReiter = avesmapsBuildClientCompatibleRouteGraph(
    ['locations' => $netz['locations'], 'paths' => [$weg('P', 'Gebirgspass', [[0.0, 0.0], [10.0, 0.0]], $nurReiter)]],
    $anfrage('groupFoot')
);
assert(!isset($bauReiter['graph']['A']['B'][0]['season_window']), 'B1: das Fenster eines fremden Reisemittels bleibt draussen');

// 💣 B2: DIE TEILKANTE. Ein Wegpunkt-Anker teilt den Pass -- beide Haelften muessen Fenster und Weg erben.
$geteilt = $bau['graph'];
$anker = avesmapsSplitClientPathAtAnchor($geteilt, [
    'connection' => $passHin, 'from' => 'A', 'to' => 'B',
    'segment_index' => 0, 't' => 0.5, 'proj_x' => 5.0, 'proj_y' => 0.0,
], 1);
$haelfteA = $geteilt['A'][$anker][0] ?? [];
$haelfteB = $geteilt[$anker]['B'][0] ?? [];
$haelfteRueck = $geteilt[$anker]['A'][0] ?? [];
foreach (['A->Anker' => $haelfteA, 'Anker->B' => $haelfteB, 'Anker->A' => $haelfteRueck] as $wo => $haelfte) {
    assert(isset($haelfte['season_window']) && ($haelfte['season_window']['to_day_of_year'] ?? 0) === 90,
        "B2: die Teilkante {$wo} erbt das Fenster: " . json_encode($haelfte['season_window'] ?? null));
    assert(($haelfte['sperr_weg']['key'] ?? '') === 'wiki:saljethweg', "B2: und den Weg ({$wo})");
}

// B3: die Nebenliste -- nur LAND-Reisemittel-Sperren, nur was die Wegart sonst trueg.
$nurZuFuss = ['transport_domain' => 'land', 'allowed_transports' => ['groupFoot', 'lightWalker']];
$netzKutsche = [
    'locations' => [$ort('A', 0.0, 0.0), $ort('B', 10.0, 0.0), $ort('D', 0.0, 10.0), $ort('E', 10.0, 10.0), $ort('F', 0.0, -10.0), $ort('G', 10.0, -10.0)],
    'paths' => [
        $weg('Q', 'Gebirgspass', [[0.0, 0.0], [10.0, 0.0]], $nurZuFuss, 'Schattenbachpass'),
        $weg('R', 'Flussweg', [[0.0, 10.0], [10.0, 10.0]], ['transport_domain' => 'river', 'allowed_transports' => ['riverBarge']]),
        $weg('T', 'Pfad', [[0.0, -10.0], [10.0, -10.0]]),
    ],
];
$bauKutsche = avesmapsBuildClientCompatibleRouteGraph($netzKutsche, $anfrage('horseCarriage'));
$echt = array_filter($bauKutsche['graph']['A']['B'] ?? [], static fn (array $v): bool => ($v['synthetic'] ?? false) === false);
assert($echt === [], 'B3: die Kutsche bekommt die Passkante im Graphen nicht -- wie heute');
$gesperrt = $bauKutsche['gesperrt']['A']['B'][0] ?? null;
assert(is_array($gesperrt), 'B3: sie steht in der Nebenliste: ' . json_encode(array_keys($bauKutsche['gesperrt'] ?? [])));
assert(($gesperrt['sperre']['kind'] ?? '') === 'transport' && ($gesperrt['sperre']['allowed'] ?? []) === ['groupFoot', 'lightWalker'],
    'B3: mit Art und erlaubten Mitteln: ' . json_encode($gesperrt['sperre'] ?? null));
assert(($gesperrt['sperr_weg']['name'] ?? '') === 'Schattenbachpass', 'B3: und dem Namen des Weges (Anzeigename, ohne Wiki)');
assert(isset($bauKutsche['gesperrt']['B']['A'][0]), 'B3: in beiden Richtungen');
$flussRiverSailer = avesmapsBuildClientCompatibleRouteGraph($netzKutsche, $anfrage('groupFoot'));
assert(!isset($flussRiverSailer['gesperrt']['D']), 'B3: eine Wasser-Sperre kommt NICHT in die Nebenliste');
assert(!isset($bauKutsche['gesperrt']['F']), 'B3: ein Pfad, der die Kutsche von Hause aus nicht traegt, ist keine Sperre');
assert(!isset($flussRiverSailer['gesperrt']['A']), 'B3: ein erlaubtes Mittel steht nicht in der Nebenliste');
// Auto-Name ohne Wiki: kein Name im Bericht, aber ein eigener Schluessel.
$autoWeg = avesmapsBuildClientCompatibleRouteGraph(
    ['locations' => $netzKutsche['locations'], 'paths' => [$weg('Z', 'Gebirgspass', [[0.0, 0.0], [10.0, 0.0]], $nurZuFuss, 'Gebirgspass-5372')]],
    $anfrage('horseCarriage')
);
assert(($autoWeg['gesperrt']['A']['B'][0]['sperr_weg']['name'] ?? 'x') === '', 'B3: ein Auto-Name ist kein Name');
assert(($autoWeg['gesperrt']['A']['B'][0]['sperr_weg']['key'] ?? '') === 'name:Gebirgspass:Gebirgspass-5372', 'B3: aber ein Schluessel');
echo "B. Kanten ok\n";

// =====================================================================================================
// C. Die Uhr im Dijkstra -- exakt je Kante, gegen die mitlaufende Kalenderzeit (Owner 03.08.2026)
// =====================================================================================================
$tag = static fn (string $m, int $d): array => ['month' => $m, 'day' => $d, 'elapsed_hours' => 0.0, 'day_of_year' => (int) avesmapsTravelCalendarDayOfYear($m, $d)];
$g = avesmapsBuildClientCompatibleRouteGraph($netz, $anfrage());

$sommer = avesmapsFindClientCompatibleRoute($g, 'A', 'B', $anfrage('groupFoot', $tag('rondra', 5)));
assert($sommer['found'] === true && $sommer['node_ids'] === ['A', 'B'], 'C1: im Fenster ueber den Pass: ' . json_encode($sommer['node_ids']));
assert($sommer['touched'] === false, 'C1: nichts gesperrt, nichts beruehrt');

$winter = avesmapsFindClientCompatibleRoute($g, 'A', 'B', $anfrage('groupFoot', $tag('firun', 3)));
assert($winter['found'] === true && $winter['node_ids'] === ['A', 'C', 'B'], 'C2: im Firun ueber den Umweg: ' . json_encode($winter['node_ids']));
assert($winter['touched'] === true, 'C2: und der Lauf hat die Sperre beruehrt');
assert($winter['cost'] > $sommer['cost'], 'C2: der Umweg kostet');

$ohneDatum = avesmapsFindClientCompatibleRoute($g, 'A', 'B', $anfrage());
$ohneFeld = avesmapsFindClientCompatibleRoute($g, 'A', 'B', array_diff_key($anfrage(), ['departure' => true]));
assert($ohneDatum['node_ids'] === ['A', 'B'] && $ohneDatum['touched'] === false, 'C5: ohne Reisebeginn wird kein Fenster gefragt');
assert($ohneDatum['node_ids'] === $ohneFeld['node_ids'] && abs($ohneDatum['cost'] - $ohneFeld['cost']) < 1e-12,
    'C5: identisch mit einer Anfrage ganz ohne das Feld');

$ignoriert = avesmapsFindClientCompatibleRoute($g, 'A', 'B', $anfrage('groupFoot', $tag('firun', 3)), ['ignore_closures' => true]);
assert($ignoriert['node_ids'] === ['A', 'B'], 'C4: der Vergleichslauf faehrt ueber den Pass');
assert(abs($ignoriert['cost'] - $sommer['cost']) < 1e-9, 'C4: zum selben Preis wie im Sommer');

// C3: DIE UHR. Aufbruch am letzten Tag des Fensters, gut zwei Kalendertage bis zum Pass -> dort ist zu.
// Gegen den AUFBRUCHStag geprueft waere er offen -- genau das unterscheidet „exakt je Kante" von „grob".
$stundenJeEinheit = avesmapsRouteConnectionCalendarHours([
    'time' => 1.0 / (float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'],
    'transport_option' => 'groupFoot',
]);
assert($stundenJeEinheit > 0.0, 'C3: die Uhr rechnet Kalenderstunden je Karteneinheit');
$laenge = 50.0 / $stundenJeEinheit;
$netzUhr = $netz;
$netzUhr['locations'][] = $ort('X', -$laenge, 0.0);
$netzUhr['paths'][] = $weg('SX', 'Strasse', [[-$laenge, 0.0], [0.0, 0.0]]);
$gUhr = avesmapsBuildClientCompatibleRouteGraph($netzUhr, $anfrage());
$amLetztenTag = avesmapsFindClientCompatibleRoute($gUhr, 'X', 'B', $anfrage('groupFoot', $tag('efferd', 30)));
assert($amLetztenTag['node_ids'] === ['X', 'A', 'C', 'B'], 'C3: am Pass ist schon Travia -- Umweg: ' . json_encode($amLetztenTag['node_ids']));
$frueher = avesmapsFindClientCompatibleRoute($gUhr, 'X', 'B', $anfrage('groupFoot', $tag('efferd', 20)));
assert($frueher['node_ids'] === ['X', 'A', 'B'], 'C3: zehn Tage frueher ist er noch offen: ' . json_encode($frueher['node_ids']));
assert($amLetztenTag['end_hours'] > 50.0, 'C3: end_hours zaehlt die Kalenderstunden: ' . $amLetztenTag['end_hours']);
$aufgelaufen = avesmapsFindClientCompatibleRoute($g, 'A', 'B', $anfrage('groupFoot', ['elapsed_hours' => 60.0] + $tag('efferd', 30)));
assert($aufgelaufen['node_ids'] === ['A', 'C', 'B'], 'C3: elapsed_hours schiebt die Uhr -- das zweite Wegpunktpaar');

// C4: die Nebenliste im Vergleichslauf. Die Kutsche kommt ueber den Pass nicht, OHNE jedes Datum.
$gKutsche = avesmapsBuildClientCompatibleRouteGraph($netzKutsche, $anfrage('horseCarriage'));
$kutsche = avesmapsFindClientCompatibleRoute($gKutsche, 'A', 'B', $anfrage('horseCarriage'));
assert($kutsche['found'] === false, 'C4: die Kutsche kommt nicht ueber den Pass');
assert($kutsche['touched'] === true, 'C4: aber der Lauf weiss, dass eine Sperre im Weg lag');
$kutscheOffen = avesmapsFindClientCompatibleRoute($gKutsche, 'A', 'B', $anfrage('horseCarriage'), ['ignore_closures' => true]);
assert($kutscheOffen['found'] === true && $kutscheOffen['node_ids'] === ['A', 'B'], 'C4: der Vergleichslauf oeffnet die Nebenliste');

// C6: via -- die Uhr laeuft ueber die Station hinweg.
$ueberA = avesmapsFindClientCompatibleRouteLegs($gUhr, ['X', 'A', 'B'], $anfrage('groupFoot', $tag('efferd', 30)));
assert($ueberA['found'] === true && count($ueberA['legs']) === 2, 'C6: zwei Etappen');
// ⚠️ Die Strasse X-A ist als genau 50 Kalenderstunden gebaut; Fliesskomma liefert 49,999999999999.
// Tragend ist „mehr als zwei volle Tage" -- das legt den Pass auf den 2. Travia.
assert($ueberA['legs'][1]['start_hours'] > 48.0, 'C6: die zweite beginnt nach der ersten: ' . $ueberA['legs'][1]['start_hours']);
assert($ueberA['node_ids'] === ['X', 'A', 'C', 'B'], 'C6: am Pass ist es auch ueber die Station hinweg Travia');
assert($ueberA['failed_leg_index'] === null, 'C6: keine Etappe fehlt');
$kutscheLegs = avesmapsFindClientCompatibleRouteLegs($gKutsche, ['A', 'B'], $anfrage('horseCarriage'));
assert($kutscheLegs['found'] === false && $kutscheLegs['failed_leg_index'] === 0, 'C6: die ungefundene Etappe nennt sich');
assert($kutscheLegs['legs'][0]['result']['touched'] === true, 'C6: samt Beruehrung');

// C7: die Notbruecke -- ihr x25 ist Abschreckung, keine Reisezeit. Die Uhr rechnet ihn heraus.
$bruecke = avesmapsRouteConnectionCalendarHours(['time' => 25.0, 'cost_factor' => 25.0, 'transport_option' => 'groupFoot']);
$ohneAufschlag = avesmapsRouteConnectionCalendarHours(['time' => 1.0, 'transport_option' => 'groupFoot']);
assert(abs($bruecke - $ohneAufschlag) < 1e-9, "C7: die Uhr rechnet den Aufschlag heraus ({$bruecke} gegen {$ohneAufschlag})");
echo "C. Uhr ok\n";

// =====================================================================================================
// D. Der Sperrbericht (closures.php) und die Antwort
// =====================================================================================================
// ⚠️ response.php zieht closures.php nach; der Bericht nutzt die Dauerrechnung der Antwort -- eine
// zweite Formel waere die, die beim naechsten Umbau still auseinanderlaeuft.
require_once __DIR__ . '/../response.php';

$bericht = static function (array $clientGraph, array $stationen, array $anfrageDaten): array {
    $legs = avesmapsFindClientCompatibleRouteLegs($clientGraph, $stationen, $anfrageDaten);
    return ['legs' => $legs, 'bericht' => avesmapsRouteClosureReports($clientGraph, $legs, $anfrageDaten)];
};

// D1: Umweg wegen des Fensters.
$w = $bericht($g, ['A', 'B'], $anfrage('groupFoot', $tag('firun', 3)));
assert(count($w['bericht']['reports']) === 1, 'D1: ein Bericht: ' . json_encode($w['bericht']));
$r = $w['bericht']['reports'][0];
assert($r['leg_index'] === 0 && $r['blocked'] === false, 'D1: Etappe 0, nicht blockiert');
assert($r['diverges_at_node'] === 'A', 'D1: Abzweig in A: ' . $r['diverges_at_node']);
assert($r['diverges_at_edge_id'] === $w['legs']['edge_ids'][0], 'D1: an der ersten Kante der echten Route: ' . $r['diverges_at_edge_id']);
assert(count($r['avoided']) === 1, 'D1: ein umgangener Weg');
$u = $r['avoided'][0];
assert($u['kind'] === 'season' && $u['path_name'] === 'Saljethweg' && $u['public_ids'] === ['pub-P'], 'D1: ' . json_encode($u));
assert($u['transport'] === 'groupFoot' && $u['from_node'] === 'A' && $u['subtype'] === 'Gebirgspass', 'D1: Mittel, Ort, Wegart');
assert($u['reached_on'] === ['month' => 'firun', 'day' => 3, 'nameless' => false], 'D1: erreicht am 3. Firun: ' . json_encode($u['reached_on']));
assert($u['open_from'] === ['month' => 'praios', 'day' => 1] && $u['open_to'] === ['month' => 'efferd', 'day' => 30], 'D1: das Fenster');
assert($r['unrestricted']['travel_days'] < $r['actual']['travel_days'], 'D1: ohne Sperre kuerzer: ' . json_encode([$r['unrestricted'], $r['actual']]));
assert($r['unrestricted']['distance_units'] < $r['actual']['distance_units'], 'D1: und weniger Strecke');
assert($w['bericht']['stats']['compared'] === 1, 'D1: genau ein Vergleichslauf');

// D1b: der Abzweig liegt MITTEN in der Route -- X faehrt erst nach A, dort trennen sich die Wege.
$mitte = $bericht($gUhr, ['X', 'B'], $anfrage('groupFoot', $tag('efferd', 30)));
$mitteBericht = $mitte['bericht']['reports'][0] ?? [];
assert(($mitteBericht['diverges_at_node'] ?? '') === 'A', 'D1b: Abzweig in A, nicht am Start: ' . json_encode($mitteBericht));
assert(($mitteBericht['diverges_at_edge_id'] ?? '') === $mitte['legs']['edge_ids'][1], 'D1b: an der ZWEITEN Kante der echten Route');
assert(($mitteBericht['avoided'][0]['reached_on'] ?? null) === ['month' => 'travia', 'day' => 2, 'nameless' => false],
    'D1b: ohne Sperre waere der Pass am 2. Travia erreicht worden: ' . json_encode($mitteBericht['avoided'][0]['reached_on'] ?? null));
assert(($mitteBericht['avoided'][0]['from_node'] ?? '') === 'A', 'D1b: in Reiserichtung ab A');

// D8: die Sperre lag im Weg, hat aber nichts veraendert -> verglichen, kein Bericht.
$netzUnnoetig = ['locations' => [$ort('A', 0.0, 0.0), $ort('B', 10.0, 0.0), $ort('C', 5.0, 30.0)], 'paths' => [
    $weg('S0', 'Reichsstrasse', [[0.0, 0.0], [10.0, 0.0]]),
    $weg('PU', 'Gebirgspass', [[0.0, 0.0], [5.0, 30.0]], $passProperties, 'Saljethweg'),
    $weg('SU', 'Strasse', [[5.0, 30.0], [10.0, 0.0]]),
]];
$gUnnoetig = avesmapsBuildClientCompatibleRouteGraph($netzUnnoetig, $anfrage());
$unnoetig = $bericht($gUnnoetig, ['A', 'B'], $anfrage('groupFoot', $tag('firun', 3)));
assert($unnoetig['legs']['legs'][0]['result']['touched'] === true, 'D8: der Lauf hat die Sperre beruehrt');
assert($unnoetig['bericht']['reports'] === [] && $unnoetig['bericht']['stats']['compared'] === 1, 'D8: verglichen, aber kein Bericht: ' . json_encode($unnoetig['bericht']));

// D2: nichts beruehrt -> kein Vergleich, kein Bericht.
$s = $bericht($g, ['A', 'B'], $anfrage('groupFoot', $tag('rondra', 5)));
assert($s['bericht']['reports'] === [] && $s['bericht']['stats']['compared'] === 0, 'D2: im Fenster nichts verglichen');
$o = $bericht($g, ['A', 'B'], $anfrage());
assert($o['bericht']['reports'] === [] && $o['bericht']['stats']['compared'] === 0, 'D2: ohne Reisebeginn ebenso');

// D3: kein offener Weg -> Absage mit Grund, keine Notbruecke.
$netzNurPass = ['locations' => [$ort('A', 0.0, 0.0), $ort('B', 10.0, 0.0)], 'paths' => [$netz['paths'][0]]];
$gNurPass = avesmapsBuildClientCompatibleRouteGraph($netzNurPass, $anfrage());
$b = $bericht($gNurPass, ['A', 'B'], $anfrage('groupFoot', $tag('firun', 3)));
assert($b['legs']['found'] === false, 'D3: im Firun kein offener Weg');
assert(count($b['bericht']['reports']) === 1 && $b['bericht']['reports'][0]['blocked'] === true, 'D3: Absage mit Grund: ' . json_encode($b['bericht']));
assert($b['bericht']['reports'][0]['actual'] === null && $b['bericht']['reports'][0]['diverges_at_edge_id'] === '', 'D3: keine echte Route, kein Abzweig');
assert($b['bericht']['reports'][0]['avoided'][0]['kind'] === 'season', 'D3: der Grund ist das Fenster');

// D4: Reisemittel-Sperre -- die Kutsche faehrt den Umweg wie heute, und jetzt steht es da.
$netzKutscheUmweg = ['locations' => [$ort('A', 0.0, 0.0), $ort('B', 10.0, 0.0), $ort('C', 5.0, 60.0)], 'paths' => [
    $weg('Q', 'Gebirgspass', [[0.0, 0.0], [10.0, 0.0]], $nurZuFuss, 'Schattenbachpass'),
    $weg('S1', 'Strasse', [[0.0, 0.0], [5.0, 60.0]]),
    $weg('S2', 'Strasse', [[5.0, 60.0], [10.0, 0.0]]),
]];
$gKU = avesmapsBuildClientCompatibleRouteGraph($netzKutscheUmweg, $anfrage('horseCarriage'));
$k = $bericht($gKU, ['A', 'B'], $anfrage('horseCarriage'));
assert($k['legs']['found'] === true && $k['legs']['node_ids'] === ['A', 'C', 'B'], 'D4: die Kutsche faehrt den Umweg wie heute: ' . json_encode($k['legs']['node_ids']));
assert(count($k['bericht']['reports']) === 1, 'D4: und es gibt einen Bericht -- ohne Reisebeginn: ' . json_encode($k['bericht']));
$ku = $k['bericht']['reports'][0]['avoided'][0];
assert($ku['kind'] === 'transport' && $ku['allowed'] === ['groupFoot', 'lightWalker'] && $ku['path_name'] === 'Schattenbachpass', 'D4: ' . json_encode($ku));
assert($ku['transport'] === 'horseCarriage' && !array_key_exists('reached_on', $ku), 'D4: eine Reisemittel-Sperre hat kein Datum');

// D5: zwei Abschnitte desselben Weges sind EIN umgangener Weg.
$netzZwei = ['locations' => [$ort('A', 0.0, 0.0), $ort('M', 5.0, 0.0), $ort('B', 10.0, 0.0), $ort('C', 5.0, 20.0)], 'paths' => [
    $weg('P1', 'Gebirgspass', [[0.0, 0.0], [5.0, 0.0]], $passProperties, 'Saljethweg'),
    $weg('P2', 'Gebirgspass', [[5.0, 0.0], [10.0, 0.0]], $passProperties, 'Saljethweg'),
    $weg('S1', 'Strasse', [[0.0, 0.0], [5.0, 20.0]]),
    $weg('S2', 'Strasse', [[5.0, 20.0], [10.0, 0.0]]),
]];
$gZwei = avesmapsBuildClientCompatibleRouteGraph($netzZwei, $anfrage());
$z = $bericht($gZwei, ['A', 'B'], $anfrage('groupFoot', $tag('firun', 3)));
assert(count($z['bericht']['reports'][0]['avoided'] ?? []) === 1, 'D5: zwei Abschnitte, EIN Weg: ' . json_encode($z['bericht']));
assert($z['bericht']['reports'][0]['avoided'][0]['public_ids'] === ['pub-P1', 'pub-P2'], 'D5: beide Abschnitte genannt');

// D6: die Antwort -- ohne Datum und Bericht Zeichen fuer Zeichen die alte.
$route = ['found' => true, 'from' => 'A', 'to' => 'B', 'cost' => 1.0, 'node_count' => 2, 'edge_count' => 1,
    'from_node' => 'A', 'to_node' => 'B', 'node_ids' => ['A', 'B'], 'edge_ids' => ['e'], 'segments' => [],
    'duration' => [], 'air_distance_units' => null, 'distance_units' => 1.0, 'debug_context' => []];
$alt = avesmapsBuildMinimalRouteResponse($route, ['debug' => false]);
assert(!array_key_exists('departure', $alt) && !array_key_exists('closures', $alt), 'D6: ohne Datum und Bericht keine neuen Schluessel');
$mitDatum = avesmapsBuildMinimalRouteResponse(['closures' => []] + $route, ['debug' => false, 'departure' => $tag('firun', 3)]);
assert(!array_key_exists('closures', $mitDatum), 'D6: ein leerer Bericht faellt heraus');
assert(($mitDatum['departure'] ?? null) === ['month' => 'firun', 'day' => 3, 'elapsed_hours' => 0.0], 'D6: das Datum wird zurueckgemeldet: ' . json_encode($mitDatum['departure'] ?? null));
$mitBericht = avesmapsBuildMinimalRouteResponse(['closures' => $w['bericht']['reports']] + $route, ['debug' => false]);
assert(($mitBericht['closures'] ?? null) === $w['bericht']['reports'], 'D6: der Bericht reist in der Antwort');

// D7: die Verdrahtung in response.php -- kommentarfrei gelesen, damit keine Warnung als Treffer zaehlt.
$code = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../response.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $code .= is_array($token) ? $token[1] : $token;
}
$posVerfeinerung = strpos($code, 'avesmapsRefineSyntheticRouteLegs(');
$posBericht = strpos($code, 'avesmapsRouteClosureReports(');
assert($posVerfeinerung !== false && $posBericht !== false && $posBericht > $posVerfeinerung,
    'D7: der Bericht wird NACH der Sehnen-Verfeinerung gerechnet -- sonst vergleicht er einen anderen Graphen');
assert(preg_match('/\'closures\'\s*=>\s*\$sperrbericht\[\'reports\'\]/', $code) === 1, 'D7: und landet am Routenobjekt');
assert(AVESMAPS_ROUTE_API_CODE_REVISION === 16, 'D7: API-Revision 16');
echo "D. Bericht ok\n";

echo "ALL OK\n";
