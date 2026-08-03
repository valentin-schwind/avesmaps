<?php

declare(strict_types=1);

/**
 * Unit test for the PURE climate-zone geometry (spec docs/superpowers/specs/2026-08-03-klimazonen-design.md
 * §4). Everything DB-bound (the seed, the rebuild, the revision) is provable only in the owner's live
 * run -- there is no local MySQL (api/config.local.php is absent). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/climate-zones-test.php
 *
 * 🔴 What this file exists to nail down: seven bands derived from six dividers TILE THE MAP -- no gap,
 * no overlap -- and two dividers can never cross. That is the whole "Klimazonen überlappen sich nicht"
 * requirement, and it is a property of the construction rather than a rule someone remembers to check.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../climate-zones.php';

function climateTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

function climateTestLine(array $points): array
{
    return avesmapsClimateNormalizeDivider(['type' => 'LineString', 'coordinates' => $points]);
}

// Shoelace, unsigned. Local to the test -- the production code never needs an area.
function climateTestRingArea(array $ring): float
{
    $sum = 0.0;
    for ($index = 0; $index < count($ring) - 1; $index++) {
        $sum += $ring[$index][0] * $ring[$index + 1][1] - $ring[$index + 1][0] * $ring[$index][1];
    }

    return abs($sum) / 2.0;
}

// ---- normalising one divider -----------------------------------------------------------------------

$straight = climateTestLine([[0, 900], [1024, 900]]);
assert($straight['type'] === 'LineString', 'a normalised divider stays a LineString');
assert($straight['coordinates'] === [[0.0, 900.0], [1024.0, 900.0]], 'positions survive as floats');

$bent = climateTestLine([[0, 900], [300, 880], [1024, 910]]);
assert(count($bent['coordinates']) === 3, 'intermediate points survive');

climateTestThrows(static fn() => climateTestLine([[10, 900], [1024, 900]]),
    'the first point must sit on the left map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900], [1000, 900]]),
    'the last point must sit on the right map edge');
climateTestThrows(static fn() => climateTestLine([[0, 900]]),
    'a divider needs at least two points');

// ---- ÜBERHÄNGE (Owner 2026-08-03) ------------------------------------------------------------------
// 🔴 Bis heute galt „x muss streng steigen". Das war eine VEREINFACHUNG, keine Eigenschaft der Sache:
// sie machte jede Linie zu einer Funktion y(x) und die Reihenfolgeprüfung damit trivial -- verbot aber
// genau das, was eine Klimagrenze um die Wüste Khôm braucht: eine Blase, bei der die Linie ein Stück
// nach links zurückläuft. Der Owner ist beim Zeichnen genau dagegen gelaufen.
//
// An ihre Stelle tritt die Bedingung, um die es wirklich geht: die Linie darf sich nicht selbst
// schneiden, und zwei benachbarte Linien dürfen sich nicht schneiden. Das lässt Überhänge zu und hält
// die Bänder trotzdem überschneidungsfrei.

$ueberhang = climateTestLine([[0, 500], [600, 500], [400, 400], [1024, 400]]);
assert(count($ueberhang['coordinates']) === 4, 'a divider may run backwards in x -- that is an overhang');

// Eine echte Blase: rechts hinaus, hinunter, ein Stück zurück nach links, dann weiter nach rechts.
$blase = climateTestLine([[0, 600], [300, 600], [500, 420], [380, 360], [640, 340], [760, 520], [1024, 560]]);
assert(count($blase['coordinates']) === 7, 'a bubble is a valid divider');

// 💣 Was NICHT mehr geht: sich selbst schneiden. Vorher war das durch die Monotonie ausgeschlossen,
// jetzt braucht es eine eigene Prüfung -- ohne sie wäre das Band eine Acht, und jeder Verschnitt
// darauf liefert Unsinn.
climateTestThrows(static fn() => climateTestLine([[0, 500], [600, 300], [400, 600], [500, 200], [1024, 400]]),
    'a divider that crosses itself is refused');

// Zwei Punkte übereinander sind erlaubt (eine senkrechte Kante), solange nichts sich schneidet.
$senkrecht = climateTestLine([[0, 500], [500, 500], [500, 300], [1024, 300]]);
assert(count($senkrecht['coordinates']) === 4, 'two points at the same x are fine now -- that is a vertical edge');

// Ein Punkt genau auf dem Vorgänger ist trotzdem sinnlos und fliegt raus.
climateTestThrows(static fn() => climateTestLine([[0, 500], [500, 500], [500, 500], [1024, 300]]),
    'a repeated position is refused');
climateTestThrows(static fn() => climateTestLine([[0, 1100], [1024, 900]]),
    'y stays inside the map');
climateTestThrows(static fn() => avesmapsClimateNormalizeDivider(['type' => 'Polygon', 'coordinates' => []]),
    'only a LineString is a divider');
climateTestThrows(static fn() => avesmapsClimateNormalizeDivider('nope'),
    'a string is not a geometry');

// ---- y at a given x --------------------------------------------------------------------------------

$ramp = climateTestLine([[0, 100], [1024, 200]]);
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 0.0) - 100.0) < 1e-9, 'y at the left edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 1024.0) - 200.0) < 1e-9, 'y at the right edge');
assert(abs(avesmapsClimateYAt($ramp['coordinates'], 512.0) - 150.0) < 1e-9, 'y interpolates linearly');

// ---- the order guard -------------------------------------------------------------------------------
// 🔴 Hier lebt „keine Überlappung", seit x nicht mehr steigen muss. Die Aussage ist topologisch statt
// rechnerisch: zwei Linien, die BEIDE von Rand zu Rand laufen, sich nicht selbst und einander nicht
// schneiden, teilen das Rechteck in genau zwei Teile -- und welche oben liegt, entscheidet dann EIN
// Punkt, nämlich der am Westrand. Ein Überhang ändert daran nichts.

$ok = [
    climateTestLine([[0, 900], [1024, 880]]),
    climateTestLine([[0, 700], [1024, 720]]),
    climateTestLine([[0, 500], [1024, 500]]),
];
avesmapsClimateAssertOrder($ok);   // must not throw

// Und mit Überhang genauso, solange sich nichts schneidet.
avesmapsClimateAssertOrder([
    climateTestLine([[0, 900], [1024, 880]]),
    climateTestLine([[0, 600], [700, 600], [500, 500], [1024, 520]]),
]);

// Crossing INSIDE a segment: both lines are fine at their own vertices taken alone, and they still
// cross. This is the case a naive per-vertex check on one line misses.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 900], [1024, 500]]),
    climateTestLine([[0, 600], [1024, 800]]),
]), 'two dividers crossing between their breakpoints are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 700], [1024, 700]]),
]), 'two dividers lying on top of each other are refused');

climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 699.5], [1024, 699.5]]),
]), 'closer than the minimum gap at the west edge is refused');

// 💣 Der Fall, der die Umstellung gefährlich macht: eine BLASE der südlichen Linie, die nach oben durch
// die nördliche stösst. An den Randpunkten ist die Reihenfolge völlig in Ordnung -- nur mittendrin
// nicht. Ohne den Schnitttest liefe genau das durch.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 800], [1024, 800]]),
    climateTestLine([[0, 400], [500, 900], [600, 900], [1024, 400]]),
]), 'a bubble of the southern line poking through the northern one is refused');

// Und dasselbe, wenn die NÖRDLICHE Linie nach unten durchstösst.
climateTestThrows(static fn() => avesmapsClimateAssertOrder([
    climateTestLine([[0, 800], [500, 300], [600, 300], [1024, 800]]),
    climateTestLine([[0, 400], [1024, 400]]),
]), 'and the same when the northern line dips through the southern one');

// ---- band geometry ---------------------------------------------------------------------------------

$top = avesmapsClimateBandGeometry(null, $ok[0]);
assert($top['type'] === 'Polygon', 'a band is a Polygon');
$topRing = $top['coordinates'][0];
assert($topRing[0] === $topRing[count($topRing) - 1], 'the ring is closed');
assert(in_array([0.0, 1024.0], $topRing, true), 'the northernmost band reaches the top edge');

$bottom = avesmapsClimateBandGeometry($ok[2], null);
assert(in_array([0.0, 0.0], $bottom['coordinates'][0], true), 'the southernmost band reaches the bottom edge');

$middle = avesmapsClimateBandGeometry($ok[0], $ok[1]);
assert(count($middle['coordinates'][0]) === 5, 'two 2-point dividers make a 4-corner ring plus the closing point');

// 🔴 The whole point: n dividers make n+1 bands that tile the map exactly -- no gap, no overlap.
$dividers = avesmapsClimateDefaultDividers(6);
$total = 0.0;
for ($index = 0; $index <= count($dividers); $index++) {
    $band = avesmapsClimateBandGeometry(
        $index === 0 ? null : $dividers[$index - 1],
        $index === count($dividers) ? null : $dividers[$index]
    );
    $total += climateTestRingArea($band['coordinates'][0]);
}
assert(abs($total - 1024.0 * 1024.0) < 1e-6, 'the seven bands tile the whole map: ' . $total);

// 🔴 UND MIT ÜBERHANG GENAUSO. Das ist der eigentliche Beweis der Umstellung: die Bänder decken die
// Karte weiterhin lückenlos und doppelungsfrei, auch wenn eine Grenze eine Blase schlägt. Die
// Ringkonstruktion ist davon unberührt -- sie läuft die obere Kante vorwärts und die untere rückwärts,
// und beide beginnen und enden weiterhin auf dem Kartenrand.
$mitBlase = [
    climateTestLine([[0, 700], [1024, 700]]),
    climateTestLine([[0, 400], [300, 400], [500, 250], [380, 190], [640, 170], [1024, 300]]),
];
avesmapsClimateAssertOrder($mitBlase);
$summe = 0.0;
for ($index = 0; $index <= count($mitBlase); $index++) {
    $band = avesmapsClimateBandGeometry(
        $index === 0 ? null : $mitBlase[$index - 1],
        $index === count($mitBlase) ? null : $mitBlase[$index]
    );
    $summe += climateTestRingArea($band['coordinates'][0]);
}
assert(abs($summe - 1024.0 * 1024.0) < 1e-6, 'bands with an overhang still tile the map exactly: ' . $summe);

// ---- the default split -----------------------------------------------------------------------------

assert(count($dividers) === 6, 'six dividers by default');
avesmapsClimateAssertOrder($dividers);   // the default must satisfy its own guard
// 🪤 avesmapsParseMapCoordinate ROUNDS to three decimals, so the comparison rounds too. Asserting
// against the raw fraction would fail by 0.0003 and look like a formula error.
assert($dividers[0]['coordinates'][0][1] === round(1024.0 * 6 / 7, 3), 'the first divider sits at 6/7 height');
assert($dividers[5]['coordinates'][0][1] === round(1024.0 * 1 / 7, 3), 'the last one at 1/7');
assert(avesmapsClimateDefaultDividers(0) === [], 'zero dividers is a valid degenerate answer');

// ---- vocabulary and the guards (Task 2) ------------------------------------------------------------
// Only the vocabulary half: everything with a PDO is not provable locally (no local MySQL).

require __DIR__ . '/../ecosystem.php';

assert(in_array('klima', AVESMAPS_ECOSYSTEM_KINDS, true), 'klima is a known kind');
assert(count(AVESMAPS_ECOSYSTEM_KINDS) === 4, 'and it is the fourth');

$climateSeed = array_values(array_filter(
    AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED,
    static fn(array $row): bool => $row[0] === 'klima'
));
// 8 seit 2026-08-03: „Trockene Subtropen" wurde zwischen die winterfeuchten Subtropen und die
// Subtropische Zone geschoben (sort_order 55, in die Lücke der Zehnerschritte).
assert(count($climateSeed) === 8, 'eight climate zones are seeded');

// 🔴 sort_order is LOAD-BEARING: it says which zone lies north of which, and from that follows which
// divider bounds which band. A duplicate or a shuffled order re-sorts the map.
$sortOrders = array_column($climateSeed, 3);
$sorted = $sortOrders;
sort($sorted);
assert($sortOrders === $sorted, 'the seed is written in north-to-south order');
assert(count(array_unique($sortOrders)) === 8, 'no two zones share a sort_order');

$keys = array_column($climateSeed, 1);
assert($keys === ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'],
    'the zone keys are the agreed ones, ASCII-folded, north to south');
foreach ($keys as $key) {
    assert(preg_match('/^[a-z_]+$/', $key) === 1, "zone key {$key} is ASCII-folded (AGENTS.md §5)");
}

assert(avesmapsClimateIsDerivedKind('klima') === true, 'klima areas are derived');
assert(avesmapsClimateIsDerivedKind('vegetation') === false, 'the other three are drawn');

// The guards. They are the real protection -- a UI guard protects against a misclick, not against a
// tab that has been open since yesterday and still knows the old action.
climateTestThrows(static fn() => avesmapsClimateAssertNotDerived('klima', 'create_area'),
    'creating a klima area by hand is refused');
avesmapsClimateAssertNotDerived('vegetation', 'create_area');   // must not throw

// A klima kind survives the ecosystem kind reader, so the layer switch can send it.
assert(avesmapsEcosystemReadKind('klima') === 'klima', 'klima passes the kind reader');

// ---- Which zone does a point sit in? (added 2026-08-03 for the departure date) -----------------
// The travel-time feature asks this per LEG, so it has to be cheap: six comparisons, no polygon test.
$sixDividers = avesmapsClimateDefaultDividers(6);   // even bands at y = 878, 731, 585, 439, 293, 146

assert(avesmapsClimateZoneIndexAt($sixDividers, 500.0, 1000.0) === 0, 'the far north is zone 0');
assert(avesmapsClimateZoneIndexAt($sixDividers, 500.0, 0.0) === 6, 'the far south is the last zone');
assert(avesmapsClimateZoneIndexAt($sixDividers, 500.0, 800.0) === 1, 'just below the first divider is zone 1');
assert(avesmapsClimateZoneIndexAt($sixDividers, 500.0, 512.0) === 3, 'the middle of the map is the middle zone');

// Every point belongs to exactly one zone, and the index never leaves 0..n. That is the promise the
// derived bands make ("no gap, no double coverage") -- asked here of the lines themselves.
for ($y = 0; $y <= 1024; $y += 8) {
    $zone = avesmapsClimateZoneIndexAt($sixDividers, 300.0, (float) $y);
    assert($zone >= 0 && $zone <= 6, "y={$y} lands in a real zone");
}

// Moving south never moves north in the list -- the index is monotone in y, which is what makes it a
// band at all.
$previous = -1;
for ($y = 1024; $y >= 0; $y -= 4) {
    $zone = avesmapsClimateZoneIndexAt($sixDividers, 700.0, (float) $y);
    assert($zone >= $previous, "y={$y}: der Index waechst nach Sueden, er springt nicht zurueck");
    $previous = $zone;
}

// A point exactly ON a divider falls into the southern zone -- it has to go somewhere, and this way
// every point belongs to exactly one.
$onTheLine = avesmapsClimateYAt($sixDividers[0]['coordinates'], 400.0);
assert(avesmapsClimateZoneIndexAt($sixDividers, 400.0, $onTheLine) === 1, 'genau auf der Linie zaehlt suedlich');

// A bent divider is followed, not averaged: same y, different x, different zone.
$bent = [['type' => 'LineString', 'coordinates' => [[0.0, 900.0], [512.0, 900.0], [512.0, 300.0], [1024.0, 300.0]]]];
assert(avesmapsClimateZoneIndexAt($bent, 100.0, 600.0) === 1, 'im Westen liegt die Grenze hoch -- der Punkt ist suedlich');
assert(avesmapsClimateZoneIndexAt($bent, 900.0, 600.0) === 0, 'im Osten liegt sie tief -- derselbe y-Wert ist noerdlich');

// ---- eine Zone einschieben, ohne eine einzige vorhandene Linie zu bewegen (Owner 2026-08-03) -------
// 🔴 Der Auftrag war ausdruecklich minimalinvasiv: „Die vorhandenen Klimazonen und ihre Grenzlinien
// sind bereits korrekt und duerfen nicht veraendert, verschoben oder neu berechnet werden."
// Die neue Linie ist deshalb die FORM ihrer suedlichen Nachbarin, angehoben -- das neue Band folgt der
// bestehenden Grenze exakt und nimmt seinen Platz von der Zone DARUEBER.

$unten = climateTestLine([[0, 400], [300, 380], [700, 420], [1024, 400]]);
$oben = climateTestLine([[0, 700], [1024, 700]]);

$neu = avesmapsClimateInsertedDividerAbove($unten, $oben, 60.0);
assert($neu !== null, 'there is room for the inserted band');
assert(count($neu['coordinates']) === count($unten['coordinates']), 'the inserted line copies the shape below it');
foreach ($neu['coordinates'] as $index => [$x, $y]) {
    assert(abs($x - $unten['coordinates'][$index][0]) < 1e-9, 'x is untouched -- the shape is only lifted');
    assert(abs(($y - $unten['coordinates'][$index][1]) - 60.0) < 1e-9, 'and lifted by exactly the offset');
}
// Die Randpunkte bleiben am Kartenrand -- sonst haetten die Baender eine Luecke.
assert($neu['coordinates'][0][0] === 0.0 && $neu['coordinates'][count($neu['coordinates']) - 1][0] === 1024.0,
    'the inserted line still spans edge to edge');
avesmapsClimateAssertOrder([$oben, $neu, $unten]);   // drei Linien, saubere Reihenfolge

// Ist oben wenig Platz, wird der Versatz kleiner statt die Nachbarn zu schieben.
$eng = climateTestLine([[0, 430], [1024, 430]]);
$gequetscht = avesmapsClimateInsertedDividerAbove($unten, $eng, 60.0);
assert($gequetscht !== null, 'a narrow gap still takes a band');
assert($gequetscht['coordinates'][0][1] < $eng['coordinates'][0][1], 'the inserted line stays below its upper neighbour');
avesmapsClimateAssertOrder([$eng, $gequetscht, $unten]);

// 💣 Und wenn gar kein Platz ist, kommt null -- der Aufrufer bricht dann ab, statt etwas zu verschieben.
$dichtDrauf = climateTestLine([[0, 401], [1024, 401]]);
assert(avesmapsClimateInsertedDividerAbove($unten, $dichtDrauf, 60.0) === null,
    'no room at all: null, so the caller refuses instead of moving something');

// 💣 DER FALL, DER DEN ZWEITEN WEG BRAUCHT: eine Linie mit BLASE. Ihre parallel angehobene Kopie
// schneidet ihr eigenes Original -- der Ueberhang laeuft nach links zurueck und kreuzt dabei den
// steilen Abstieg. Kein Versatz behebt das, der Schnitt wandert nur mit. Dann muss eine GERADE in den
// freien Streifen, und die kann per Bauart nichts schneiden.
$mitBlase = climateTestLine([[0, 380], [300, 375], [520, 330], [430, 300], [660, 295], [1024, 360]]);
$darueber = climateTestLine([[0, 505], [1024, 495]]);
$eingeschoben = avesmapsClimateInsertedDividerAbove($mitBlase, $darueber, 45.0);
assert($eingeschoben !== null, 'a bubble still gets a band above it');
assert(count($eingeschoben['coordinates']) === 2, 'and it is a straight line, because the parallel copy would self-cross');
$hoechsteBlase = max(array_column($mitBlase['coordinates'], 1));
assert($eingeschoben['coordinates'][0][1] > $hoechsteBlase, 'the straight line clears the whole bubble');
assert(!avesmapsClimatePolylinesCross($eingeschoben['coordinates'], $mitBlase['coordinates']),
    'and crosses it nowhere');
avesmapsClimateAssertOrder([$darueber, $eingeschoben, $mitBlase]);

// Ohne obere Nachbarin gilt der Kartenrand.
$obenFrei = avesmapsClimateInsertedDividerAbove($unten, null, 60.0);
assert($obenFrei !== null && abs($obenFrei['coordinates'][0][1] - 460.0) < 1e-9, 'without an upper neighbour the full offset applies');

fwrite(STDOUT, "climate-zones-test: OK\n");
