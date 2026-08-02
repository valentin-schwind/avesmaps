<?php

declare(strict_types=1);

// 🔴 THE TEST THAT WAS MISSING. `terrain-factor-test.php` covers the arithmetic; nothing covered the
// SENTENCES. That is the exact gap all three contradictions of 2026-07-31 slipped through: the numbers
// in the speed dialog were right the whole time, the words around them were not, and no test went red.
//
// This file binds the two together in BOTH directions:
//   1. every numeric claim the dialog makes is recomputed from the model,
//   2. the dialog string is read and asserted to still MAKE that claim.
// Change the text without the code -> (2) fails. Change the code without the text -> (1) fails.
//
// ⚠️ Run it with assertions on, or it proves nothing:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-text-claims-test.php

require_once __DIR__ . '/../terrain-factor.php';

/** The factor of a leg of `$miles` miles at a constant ascent of `$gradient`. */
function terrainClaimAscentFactor(float $gradient, float $miles = 10.0): float
{
    // 1 Meile = 1.000 Schritt (a map unit is 3.000 Schritt AND 3 miles), so the climb of a leg at a
    // constant gradient is gradient x miles x 1.000.
    return avesmapsTerrainLeistungsFactor(
        $gradient * $miles * 1000.0,
        0.0,
        $miles / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT
    );
}

/** The factor of the same leg travelled DOWN at a constant gradient. */
function terrainClaimDescentFactor(float $gradient, float $miles = 10.0): float
{
    // Steepness is decided per sample step (0,25 map units); at a constant gradient every step is
    // equally steep, so the whole drop either counts or none of it does.
    $isSteep = avesmapsTerrainDescentIsSteep($gradient * 0.25 * AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT_ROUTE, 0.25);

    return avesmapsTerrainLeistungsFactor(
        0.0,
        $isSteep ? $gradient * $miles * 1000.0 : 0.0,
        $miles / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT
    );
}

function terrainClaimNear(float $expected, float $actual, string $what): void
{
    assert(abs($expected - $actual) < 1e-9, $what . ' -- expected ' . $expected . ', got ' . $actual);
}

// ---- 1. the arithmetic behind every number in the dialog ----------------------------------------

terrainClaimNear(1.5, terrainClaimAscentFactor(0.05), '„bei 5 % Steigung die Hälfte länger"');
terrainClaimNear(2.0, terrainClaimAscentFactor(0.10), '„bei 10 % doppelt so lang"');
terrainClaimNear(3.0, terrainClaimAscentFactor(0.20), '„bei 20 % dreifach"');
terrainClaimNear(4.0, terrainClaimAscentFactor(0.30), '„ab 30 % vierfach"');
terrainClaimNear(4.0, terrainClaimAscentFactor(0.60), '„— mehr nicht": the ceiling holds');

// „je 100 Schritt Aufstieg kostet eine Meile zusätzlich"
terrainClaimNear(2.0, avesmapsTerrainLeistungsFactor(1000.0, 0.0, 10.0 / 3.0), '100 Schritt Aufstieg = 1 Meile');
// „je 150 Schritt Abstieg ebenso"
terrainClaimNear(2.0, avesmapsTerrainLeistungsFactor(0.0, 1500.0, 10.0 / 3.0), '150 Schritt Abstieg = 1 Meile');

// „Gefälle unter 20 % aber gar nichts" -- and the threshold is strict: 20 % itself is still free.
terrainClaimNear(1.0, terrainClaimDescentFactor(0.10), 'Gefälle 10 % kostet nichts');
terrainClaimNear(1.0, terrainClaimDescentFactor(0.20), 'Gefälle von genau 20 % kostet nichts');
assert(terrainClaimDescentFactor(0.2001) > 1.0, 'Gefälle knapp über 20 % kostet');

// „schneller als die Ebene wird es nie"
foreach ([0.0, 0.01, 0.1, 0.25, 0.5, 1.0] as $g) {
    assert(terrainClaimAscentFactor($g) >= 1.0, 'kein Faktor unter 1,0 bergauf bei ' . $g);
    assert(terrainClaimDescentFactor($g) >= 1.0, 'kein Faktor unter 1,0 bergab bei ' . $g);
}

// „Über den Koschberge-Pass (24 %) wird aus einer Reichsstraße rund 1,3 statt 4,5 Meilen/h"
// 668,98 Schritt Aufstieg auf 2,799 Meilen, live gemessen.
$koschberge = avesmapsTerrainLeistungsFactor(668.98, 0.0, 2.799 / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT);
assert(abs(668.98 / 2799.0 - 0.239) < 0.001, 'Koschberge ist eine 24-%-Steigung');
assert(abs(4.5 / $koschberge - 1.3) < 0.05, 'Koschberge: 4,5 Meilen/h werden rund 1,3 -- ist ' . (4.5 / $koschberge));

// ---- 2. the dialog still MAKES those claims -----------------------------------------------------
//
// 🔴 THIS HALF IS THE POINT OF THE FILE. Without it the test only re-proves terrain-factor-test.php.
// Each needle is a claim above; deleting or editing one turns this red and sends the author back to
// the block above to decide which of the two is now wrong.

$surfaces = [
    'transport-speed-info.js (DE)' => __DIR__ . '/../../../../js/routing/transport-speed-info.js',
    'i18n-en.js (EN)' => __DIR__ . '/../../../../js/app/i18n-en.js',
];
$needles = [
    'DE' => [
        'Leistungskilometer',
        'in <b>Leistungskilometern</b>',
        'je 100 Schritt Aufstieg',
        'Langmuirs Zusatz zu Naismiths Wanderregel',
        'je 150 Schritt Abstieg',
        'unter 20 % aber gar nichts',
        'schneller als die Ebene wird es nie',
        '5 % Steigung die Hälfte länger, bei 10 % doppelt so lang, bei 20 % dreifach, ab 30 % vierfach',
        'Koschberge-Pass (24 %)',
        '1,3 statt 4,5 Meilen/h',
        'je Teilstück, nicht im Etappenmittel',
    ],
    'EN' => [
        'Leistungskilometer',
        'the surcharge arithmetic hikers use for mountain tours',
        'every 100 Schritt of climb',
        "Langmuir's addition to Naismith's rule",
        'every 150 Schritt of descent',
        'gentler than 20 % costs nothing',
        'never quicker than the level',
        'half again as long at 5 %, twice as long at 10 %, three times at 20 %, four times from 30 %',
        'Koschberge pass (24 %)',
        '1.3 instead of 4.5 miles/h',
        'per stretch, not from a leg',
    ],
];

// 💣 The dialog writes „100&nbsp;Schritt" with a LITERAL non-breaking space (U+00A0), not the HTML
// entity -- a needle typed with a plain space misses it and the test would fail on correct text.
function terrainClaimNormalize(string $text): string
{
    return str_replace(["\xC2\xA0", '&nbsp;'], ' ', $text);
}

foreach ($surfaces as $label => $file) {
    $source = terrainClaimNormalize((string) file_get_contents($file));
    assert($source !== '', $label . ' is readable');
    $lang = str_contains($label, '(EN)') ? 'EN' : 'DE';
    foreach ($needles[$lang] as $needle) {
        assert(
            str_contains($source, $needle),
            $label . ': the slope rule no longer says „' . $needle . '". Either the text drifted from the '
            . 'model or the model changed -- decide which, then fix BOTH.'
        );
    }
}

// 💣 THE ONE THAT ALREADY FIRED IN PUBLIC. „Leistungskilometer (DIN 33466, Marschzeitrechnung der
// Alpenvereine)" names three different procedures as one. DIN 33466 and the SAC method are TIME
// formulas (300/400 Hm/h up, a halving rule); what is implemented adds to the DISTANCE. Two players
// found it independently on 2026-07-31. Nothing in this repo may claim the model IS DIN 33466 again.
$forbidden = ['DIN 33466', 'Marschzeitrechnung der Alpenvereine', 'alpine clubs'];
foreach ($surfaces as $label => $file) {
    $source = terrainClaimNormalize((string) file_get_contents($file));
    foreach ($forbidden as $claim) {
        assert(
            !str_contains($source, $claim),
            $label . ': claims „' . $claim . '". The Leistungskilometer is a DISTANCE surcharge; '
            . 'DIN 33466 and the alpine-club method are TIME formulas and neither is implemented here.'
        );
    }
}

// ---- 3. the water and carriage sentences ---------------------------------------------------------
//
// 🔴 ADDED 2026-08-02. Parts 1 and 2 bound the SLOPE sentence to the model and left three others
// unguarded, and all three were wrong at once: riverNote named „das 1,5-fache" while the routing
// default was 1,5 for no reason anyone had written down (the source says 2,0 throughout), restRule
// claimed „auf dem Wasser wird durchgefahren" while S. 129 puts rivers on a 12-hour day, and the
// carriage's half speed on Karrenweg/Pass was missing from the table entirely. Same construction as
// above: the number is recomputed from the constant, and the sentence is asserted to still say it.

require_once __DIR__ . '/../../wiki/path-flow.php';
require_once __DIR__ . '/../client-graph.php';

$jsRoot = __DIR__ . '/../../../../js/';
$readJs = static function (string $relative) use ($jsRoot): string {
    $source = (string) file_get_contents($jsRoot . $relative);
    assert($source !== '', $relative . ' is readable');

    return terrainClaimNormalize($source);
};

// „in der Regel das 2-fache … bis zum 3-fachen der Zeit" = the routing default and its clamp ceiling.
terrainClaimNear(2.0, AVESMAPS_PATH_FLOW_FACTOR_DEFAULT, 'upstream default = the source ratio (S. 129: Kahn 20/40, Segler 30/60)');
terrainClaimNear(3.0, AVESMAPS_PATH_FLOW_FACTOR_MAX, 'upstream ceiling = the „bis zum 3-fachen" of the dialog');

// The river speeds carry the source's day performance at the 12-hour travel day of S. 129 (Kahn 40,
// Segler 60 downstream). TIME_SCALE_FACTOR is read from js/config.js because the SERVER never
// applies it -- it is a display multiplier on the client (route-plan.js) and only the two together
// produce the number a traveller sees.
$configSource = $readJs('config.js');
assert((bool) preg_match('/const TIME_SCALE_FACTOR = ([0-9.]+);/', $configSource, $timeScaleMatch), 'TIME_SCALE_FACTOR readable from config.js');
$timeScale = (float) $timeScaleMatch[1];
$riverDayPerformance = static fn(float $speed): float => $speed / $timeScale * 12.0;
foreach ([['riverBarge', 40.0], ['riverSailer', 60.0]] as [$mode, $expectedDay]) {
    $actualDay = $riverDayPerformance((float) AVESMAPS_ROUTE_CLIENT_SPEED_TABLE[$mode]['Flussweg']);
    assert(
        abs($actualDay / $expectedDay - 1.0) < 0.01,
        $mode . ' downstream must hit the source\'s ' . $expectedDay . ' miles/day at a 12-hour travel day -- is ' . round($actualDay, 2)
    );
}

// „auf Karrenwegen und Pässen nur halbe Geschwindigkeit" (S. 123). Measured RELATIVE to Strasse, so
// the assertion survives a future rescaling of the whole table and still catches an un-halving:
// the source's path-type factors are 0,8 for Weg/Karrenweg and 0,4 for the Passstrecke, halved.
$carriage = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['horseCarriage'];
foreach ([['Weg', 0.8 * 0.5], ['Gebirgspass', 0.4 * 0.5]] as [$subtype, $expectedRatio]) {
    $actualRatio = $carriage[$subtype] / $carriage['Strasse'];
    assert(
        abs($actualRatio - $expectedRatio) < 0.03,
        'the carriage must travel ' . $subtype . ' at half the path-type speed (' . $expectedRatio
        . ' of Strasse) -- is ' . round($actualRatio, 3) . '. Un-halving it drops a rule of S. 123.'
    );
}

// restRule's „nur auf offener See wird durchgefahren" IS this one condition. Seeweg alone travels
// around the clock; Flussweg sat beside it until 2026-08-02 and made every river 2,52x the source.
$restSource = $readJs('routing/route-result.js');
assert(str_contains($restSource, 'entry.type !== "Seeweg"'), 'route-result.js: the no-rest rule must name Seeweg and nothing else');
assert(!str_contains($restSource, '"Seeweg", "Flussweg"'), 'route-result.js: Flussweg is back in the no-rest list -- rivers rest (S. 129), only the sea does not (S. 131)');

$waterNeedles = [
    'DE' => [
        'in der Regel das 2-fache, bei starker Strömung bis zum 3-fachen',
        'Das gilt an Land und auf Flüssen — nur auf offener See wird durchgefahren',
        // seaNote is deliberately unchanged: per hour we are SLOWER than the source, and its
        // 24-hour operation is documented (S. 131: Schnellsegler 250, Kurier-Dromone 200).
        'Auf offener See wird Tag und Nacht durchgesegelt',
    ],
    'EN' => [
        'as a rule twice the duration, and up to 3 times in strong currents',
        'This applies on land and on rivers — only on the open sea',
        'On the open sea, travel continues day and night',
    ],
];

foreach ($surfaces as $label => $file) {
    $source = terrainClaimNormalize((string) file_get_contents($file));
    $lang = str_contains($label, '(EN)') ? 'EN' : 'DE';
    foreach ($waterNeedles[$lang] as $needle) {
        assert(
            str_contains($source, $needle),
            $label . ': the water/rest rule no longer says „' . $needle . '". Either the text drifted '
            . 'from the model or the model changed -- decide which, then fix BOTH.'
        );
    }
}

echo "terrain-text-claims-test: all asserts passed\n";
