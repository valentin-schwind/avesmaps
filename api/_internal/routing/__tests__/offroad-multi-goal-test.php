<?php
// api/_internal/routing/__tests__/offroad-multi-goal-test.php
declare(strict_types=1);

/**
 * Ein Suchlauf, viele Ziele -- statt eines A*-Laufs je Kandidat.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-abgangspunkt-design.md §3.3
 *
 * 🔴 ER BEPREIST JEDEN SCHRITT IN GEGENRICHTUNG. Der Reisende geht vom Ausstieg zum
 * Kartenpunkt; der Lauf geht andersherum. Steigung kostet mehr als Gefaelle
 * (avesmapsTerrainLeistungsFactor), also ist der Anstieg eines Suchschritts u->v der Abstieg
 * des Reisenden. Ohne den Tausch waehlt der Lauf die Strecke der RUECKREISE.
 *
 * ⚠️ Die Ziele in Abschnitt A liegen bewusst auf einer Diagonalen bzw. einer Achse zum
 * Startpunkt: dort ist der guenstigste Gitterweg EINDEUTIG. Bei schraeg liegenden Zielen gibt es
 * viele gleich teure Treppen, und A* und Dijkstra duerfen verschiedene davon waehlen -- nach der
 * Douglas-Peucker-Vereinfachung haetten die dann verschiedene Laengen, ohne dass einer falsch
 * rechnet.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-multi-goal-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../offroad-grid.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 20.0);
$flat = str_repeat("\x00", $box['cell_count']);
$speed = 2.30;

// ---- A: dasselbe Ergebnis wie der Einzellauf, fuer jedes Ziel ----------------------------
$goals = [
    'diagonal_nah'  => ['x' => 6.0,  'y' => 6.0],
    'diagonal_fern' => ['x' => 14.0, 'y' => 14.0],
    'senkrecht'     => ['x' => 4.0,  'y' => 12.0],
];
$many = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0, $goals);

foreach ($goals as $key => $goal) {
    $single = avesmapsOffroadFindPath($box, $flat, null, null, $speed, $goal['x'], $goal['y'], 4.0, 4.0);
    assert(is_array($many[$key]), "Ziel $key wird erreicht");
    assert(abs($many[$key]['time'] - $single['time']) < 1e-6,
        "Ziel $key: Mehrziel {$many[$key]['time']} gegen Einzellauf {$single['time']}");
    assert(abs($many[$key]['distance'] - $single['distance']) < 1e-6, "Ziel $key: gleiche Strecke");
}

// ---- B: die Punkte laufen VOM ZIEL zum Kartenpunkt ---------------------------------------
$first = $many['diagonal_nah']['points'][0];
$last = $many['diagonal_nah']['points'][count($many['diagonal_nah']['points']) - 1];
assert(abs($first[0] - 6.0) < 1e-9 && abs($first[1] - 6.0) < 1e-9, 'erster Punkt ist das ZIEL (der Ausstieg)');
assert(abs($last[0] - 4.0) < 1e-9 && abs($last[1] - 4.0) < 1e-9, 'letzter Punkt ist der Kartenpunkt');

// ---- C: ein unerreichbares Ziel ist null, die anderen bleiben ----------------------------
$walled = $flat;
$wallCol = (int) floor($box['cols'] / 2);
for ($row = 0; $row < $box['rows']; $row++) {
    $walled[$row * $box['cols'] + $wallCol] = "\x01";
}
$goals2 = ['diesseits' => ['x' => 5.0, 'y' => 5.0], 'jenseits' => ['x' => 18.0, 'y' => 18.0]];
$many2 = avesmapsOffroadFindPathsFromPoint($box, $walled, null, null, $speed, 4.0, 4.0, $goals2);
assert(is_array($many2['diesseits']), 'diesseits der Mauer erreichbar');
assert($many2['jenseits'] === null, 'jenseits der Mauer: null, nicht Ausnahme, nicht Abbruch');

// ---- D: der Lauf bricht ab, sobald das letzte Ziel steht ---------------------------------
$nurNah = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0,
    ['nah' => ['x' => 5.0, 'y' => 5.0]]);
$bisFern = avesmapsOffroadFindPathsFromPoint($box, $flat, null, null, $speed, 4.0, 4.0,
    ['fern' => ['x' => 19.0, 'y' => 19.0]]);
assert($nurNah['nah']['cells_opened'] < $bisFern['fern']['cells_opened'] / 2,
    'ein nahes Ziel oeffnet deutlich weniger Zellen als ein fernes -- der Abbruch greift ('
    . $nurNah['nah']['cells_opened'] . ' gegen ' . $bisFern['fern']['cells_opened'] . ')');

// ---- E: die Rueckwaertsbepreisung ---------------------------------------------------------
// Eine Hoehenebene mit gleichmaessiger Neigung: hoch im Norden, flach im Sueden. 300 Schritt je
// Karteneinheit sind 3.000 Schritt auf 10 Einheiten (= 30 km), also rund 10 % Steigung.
$heights = str_repeat("\x00", $box['cell_count'] * 2);
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        $centre = avesmapsOffroadCellCentre($box, $col, $row);
        $value = (int) round(max(0.0, $centre[1]) * 300.0);
        $index = $row * $box['cols'] + $col;
        $heights[$index * 2] = chr($value & 0xFF);
        $heights[$index * 2 + 1] = chr(($value >> 8) & 0xFF);
    }
}

// Kartenpunkt unten (y = 4), Ausstieg oben (y = 14): der Reisende geht bergAB.
$bergab = avesmapsOffroadFindPathsFromPoint($box, $flat, null, $heights, $speed, 6.0, 4.0,
    ['oben' => ['x' => 6.0, 'y' => 14.0]]);
// Kartenpunkt oben, Ausstieg unten: der Reisende geht bergAUF.
$bergauf = avesmapsOffroadFindPathsFromPoint($box, $flat, null, $heights, $speed, 6.0, 14.0,
    ['unten' => ['x' => 6.0, 'y' => 4.0]]);

assert(is_array($bergab['oben']) && is_array($bergauf['unten']), 'beide Richtungen finden einen Weg');
assert($bergab['oben']['time'] < $bergauf['unten']['time'],
    'von oben herunter ist billiger als von unten herauf ('
    . $bergab['oben']['time'] . ' gegen ' . $bergauf['unten']['time'] . ')');
assert($bergab['oben']['descent_schritt'] > $bergab['oben']['ascent_schritt'],
    'die Etappe vom hohen Ausstieg zum tiefen Kartenpunkt geht ueberwiegend bergAB ('
    . var_export($bergab['oben']['ascent_schritt'], true) . ' hinauf, '
    . var_export($bergab['oben']['descent_schritt'], true) . ' hinab)');

// ---- F: 🔴 DIE TOLERANZ EINES KANDIDATEN DARF KEINEN SEE FUER DIE ANDEREN OEFFNEN -------
// avesmapsOffroadFreeAround raeumt um jeden Endpunkt eine Scheibe von 2,0 Einheiten frei. Beim
// Einzellauf war das harmlos -- jeder Lauf bekam $blocked BY VALUE und legte nur um SEINE beiden
// Endpunkte frei. Im Mehrziellauf teilen sich alle Ziele EIN Gitter, und am 15.08.2026 wurde
// gemessen, was das anrichtet: ein Kandidat im See liess die Etappe eines FERNEN Kandidaten
// 14,01 statt 21,90 Einheiten MITTEN DURCH ein Band von 1,6 Einheiten laufen -- der Median der
// Seen (AGENTS.md §11). V13 hat das Wassermeiden gebaut; dies hatte es fuer schmale Seen aufgehoben.
//
// ⚠️ GEPRUEFT WIRD DIE STRECKE, NICHT DIE GEOMETRIE. Die ausgelieferte Linie ist
// Douglas-Peucker-vereinfacht (AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS) und schneidet Ecken -- eine
// Sehne darf die Seeecke also streifen, ohne dass der Weg durch den See fuehrt. Der Beleg ist
// deshalb: die Etappe des fernen Kandidaten aendert sich durch einen fremden Kandidaten NICHT.
$seeBox = avesmapsBuildOffroadBox(2.0, 2.0, 24.0, 24.0);
$seeGesperrt = str_repeat("\x00", $seeBox['cell_count']);
for ($row = 0; $row < $seeBox['rows']; $row++) {
    for ($col = 0; $col < $seeBox['cols']; $col++) {
        [$cx, $cy] = avesmapsOffroadCellCentre($seeBox, $col, $row);
        if ($cx >= 10.0 && $cx <= 11.6 && $cy >= 4.0 && $cy <= 20.0) {
            $seeGesperrt[$row * $seeBox['cols'] + $col] = "\x01";
        }
    }
}

$fern = ['x' => 20.0, 'y' => 12.0];
$nass = ['x' => 10.8, 'y' => 12.0];             // liegt MITTEN im See
$ufer = ['x' => 9.7, 'y' => 12.0];              // an Land, aber die Scheibe reicht ins Wasser

$alleine = avesmapsOffroadFindPathsFromPoint($seeBox, $seeGesperrt, null, null, $speed, 5.0, 12.0,
    ['fern' => $fern]);
assert(is_array($alleine['fern']), 'der ferne Kandidat wird erreicht');
// Um den See herum sind es rund 23,3 Einheiten; der Durchbruch mass 14,0. Die Schranke trennt beides.
assert($alleine['fern']['distance'] > 20.0,
    'ohne fremde Kandidaten laeuft die Etappe UM den See (' . $alleine['fern']['distance'] . ')');

$mitNassem = avesmapsOffroadFindPathsFromPoint($seeBox, $seeGesperrt, null, null, $speed, 5.0, 12.0,
    ['fern' => $fern, 'nass' => $nass]);
assert(abs($mitNassem['fern']['distance'] - $alleine['fern']['distance']) < 1e-9,
    'ein Kandidat IM See darf die Etappe des fernen um kein Haar veraendern: '
    . $mitNassem['fern']['distance'] . ' gegen ' . $alleine['fern']['distance']);
// ⚠️ Der nasse Kandidat wird trotzdem angebunden -- nicht fallengelassen, sondern in einem EIGENEN
// Lauf mit eigener Gitterkopie bedient, genau wie vor dem 15.08.2026.
assert(is_array($mitNassem['nass']), 'der nasse Kandidat wird weiterhin angebunden');

$mitUfer = avesmapsOffroadFindPathsFromPoint($seeBox, $seeGesperrt, null, null, $speed, 5.0, 12.0,
    ['fern' => $fern, 'ufer' => $ufer]);
assert(abs($mitUfer['fern']['distance'] - $alleine['fern']['distance']) < 1e-9,
    'auch ein Kandidat AM UFER veraendert die ferne Etappe nicht: '
    . $mitUfer['fern']['distance'] . ' gegen ' . $alleine['fern']['distance']);
assert(is_array($mitUfer['ufer']), 'und der Uferkandidat wird angebunden');

fwrite(STDOUT, "offroad-multi-goal-test: OK\n");
