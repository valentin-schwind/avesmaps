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

echo "terrain-text-claims-test: all asserts passed\n";
