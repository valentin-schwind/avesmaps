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

fwrite(STDOUT, "offroad-multi-goal-test: OK\n");
