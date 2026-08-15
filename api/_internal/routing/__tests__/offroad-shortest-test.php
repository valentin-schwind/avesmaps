<?php
// api/_internal/routing/__tests__/offroad-shortest-test.php
declare(strict_types=1);

/**
 * „Kuerzeste" im Gelaende: das Gewicht ist die Strecke, nicht die Zeit.
 * Entwurf: docs/superpowers/specs/2026-08-15-kuerzeste-route-gerade-linie-design.md §3.2/§3.3
 *
 * 💣 DIE MESSUNG BLEIBT EHRLICH. Neutralisiert werden die beiden Faktoren NUR in der Entspannung.
 * Die Ebenen fliessen unveraendert an avesmapsOffroadFinishPath -- eine kuerzeste Etappe ohne
 * Reisezeit und ohne Anstieg waere die halbe Auskunft.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-shortest-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

// ⚠️ NUR DIESE EINE ZEILE. avesmapsPrepareRouteAreas wohnt zwar in land-areas.php und nicht in
// water-areas.php (die Falle aus anchor-candidates-test.php), aber offroad-grid.php zieht
// land-areas.php bereits selbst -- ein zweites `require` daneben ist ein „Cannot redeclare".
require __DIR__ . '/../offroad-grid.php';

$box = avesmapsBuildOffroadBox(0.0, 0.0, 20.0, 20.0);
$frei = str_repeat("\x00", $box['cell_count']);
$speed = 2.30;

// Ein langsamer Streifen quer im Weg: Faktor 4,0 zwischen y = 8 und y = 12, nur bis x = 12.
// Der Zeitmodus geht rechts darum herum, der Streckenmodus mitten hindurch.
$faktoren = str_repeat("\x00", $box['cell_count']);
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        [$cx, $cy] = avesmapsOffroadCellCentre($box, $col, $row);
        if ($cy >= 8.0 && $cy <= 12.0 && $cx <= 12.0) {
            $faktoren[$row * $box['cols'] + $col] = chr((int) round(4.0 * AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE));
        }
    }
}

// ---- A: der Streckenmodus ist kuerzer, der Zeitmodus schneller ---------------------------
$zeit = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0);
$strecke = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);

assert(is_array($zeit) && is_array($strecke), 'beide Modi finden einen Weg');
assert($strecke['distance'] < $zeit['distance'] - 1e-6,
    'der Streckenmodus ist kuerzer: ' . $strecke['distance'] . ' gegen ' . $zeit['distance']);
assert($zeit['time'] < $strecke['time'] - 1e-6,
    'der Zeitmodus ist schneller: ' . $zeit['time'] . ' gegen ' . $strecke['time']);
// Die Luftlinie ist 12,0 -- der Streckenmodus muss ihr sehr nahe kommen.
assert($strecke['distance'] < 12.6,
    'der Streckenmodus geht praktisch gerade (Luftlinie 12,0): ' . $strecke['distance']);

// ---- B: 🔴 die Messung bleibt ehrlich ----------------------------------------------------
// Der Streckenmodus laeuft DURCH den teuren Streifen, also muss seine gemeldete Zeit den Faktor
// sehen. Waere die Faktorebene auch der Messung entzogen worden, kaeme Strecke/Tempo heraus.
assert($strecke['time'] > $strecke['distance'] / $speed + 1e-6,
    'die gemeldete Zeit traegt den Gelaendefaktor: ' . $strecke['time']
    . ' gegen ' . ($strecke['distance'] / $speed) . ' bei Faktor 1');

// ---- C: dasselbe mit Hoehen -- der Anstieg wird weiterhin gemeldet ------------------------
$hoehen = str_repeat("\x00", $box['cell_count'] * 2);
for ($row = 0; $row < $box['rows']; $row++) {
    for ($col = 0; $col < $box['cols']; $col++) {
        [$cx, $cy] = avesmapsOffroadCellCentre($box, $col, $row);
        $wert = (int) round(max(0.0, $cy) * 200.0);
        $index = $row * $box['cols'] + $col;
        $hoehen[$index * 2] = chr($wert & 0xFF);
        $hoehen[$index * 2 + 1] = chr(($wert >> 8) & 0xFF);
    }
}
$mitHoehe = avesmapsOffroadFindPath($box, $frei, null, $hoehen, $speed, 4.0, 4.0, 4.0, 16.0,
    AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert($mitHoehe['ascent_schritt'] !== null && $mitHoehe['ascent_schritt'] > 0,
    'der Anstieg wird gemeldet, auch im Streckenmodus: ' . var_export($mitHoehe['ascent_schritt'], true));

// ---- D: der Mehrziel-Lauf kennt dasselbe Argument ----------------------------------------
$viele = avesmapsOffroadFindPathsFromPoint($box, $frei, $faktoren, null, $speed, 4.0, 16.0,
    ['a' => ['x' => 4.0, 'y' => 4.0]], AVESMAPS_ROUTE_OFFROAD_SIMPLIFY_EPS, [], true);
assert(abs($viele['a']['distance'] - $strecke['distance']) < 1e-6,
    'Mehrziel-Lauf und Einzellauf liefern im Streckenmodus dieselbe Laenge: '
    . $viele['a']['distance'] . ' gegen ' . $strecke['distance']);

// ---- E: ohne das Argument aendert sich NICHTS --------------------------------------------
$altAufruf = avesmapsOffroadFindPath($box, $frei, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0);
assert(abs($altAufruf['distance'] - $zeit['distance']) < 1e-12,
    'der Vorgabewert laesst den Zeitmodus voellig unberuehrt');

// ---- F: die trockene Gerade braucht keinen Suchlauf --------------------------------------
// 🔴 Der Nass-Test fragt die POLYGONE, nicht das Raster. Gemessen am 15.08.2026 an 5.903 Linien:
// die beiden gehen in 0,92 % der Faelle auseinander (3,07 % in Wassernaehe), und zwar IMMER in
// dieselbe Richtung -- das Raster sperrt eine Zelle, sobald Wasser sie beruehrt, ist also strenger
// als die Flaeche selbst. Ein Modus, der Meilen minimieren soll, darf keine Meilen fuer ein
// Rasterungsartefakt dazulegen (Entwurf §5).
$quadrat = static function (float $x1, float $y1, float $x2, float $y2): array {
    return ['geometry' => ['type' => 'Polygon', 'coordinates' => [[
        [$x1, $y1], [$x2, $y1], [$x2, $y2], [$x1, $y2], [$x1, $y1],
    ]]], 'min_x' => $x1, 'min_y' => $y1, 'max_x' => $x2, 'max_y' => $y2];
};
$ohneWasser = avesmapsPrepareRouteAreas([$quadrat(90.0, 90.0, 95.0, 95.0)]);

$gerade = avesmapsOffroadStraightPathIfDry($box, $ohneWasser, $faktoren, null, $speed,
    4.0, 4.0, 4.0, 16.0);
assert(is_array($gerade), 'ohne Wasser im Weg gibt es eine Gerade');
assert(count($gerade['points']) === 2, 'und sie hat genau zwei Punkte');
assert(abs($gerade['distance'] - 12.0) < 1e-9,
    'ihre Laenge ist die Luftlinie: ' . $gerade['distance']);
// Sie laeuft durch den teuren Streifen, also traegt ihre Zeit den Faktor.
assert($gerade['time'] > $gerade['distance'] / $speed + 1e-6,
    'auch die Gerade wird mit dem echten Gelaende bepreist: ' . $gerade['time']);

// ---- G: eine nasse Gerade gibt null zurueck ----------------------------------------------
$mitSee = avesmapsPrepareRouteAreas([$quadrat(0.0, 9.0, 20.0, 11.0)]);
assert(avesmapsOffroadStraightPathIfDry($box, $mitSee, $faktoren, null, $speed, 4.0, 4.0, 4.0, 16.0) === null,
    'quer durch einen See gibt es keine gerade Antwort');

fwrite(STDOUT, "offroad-shortest-test: OK\n");
