<?php

declare(strict_types=1);

/**
 * Unit test for the pure part of the global "Wappen: An/Aus" switch. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/coat-display-test.php
 *
 * The two rules worth a guard are the ones a careless edit would break silently:
 *   1. '' stays '' -- a territory WITHOUT a coat must not grow a shield. Get this wrong and the map
 *      sprouts hundreds of empty shields the moment the switch is flipped, which looks like data loss.
 *   2. ON is the identity. The switch may never rewrite a URL it is not turning off, or the cache-bust
 *      (?v=<mtime>) that api/_internal/coat-url.php appends would be dropped and re-uploaded coats
 *      would go stale again (Discord #32).
 *
 * The DB-bound half (avesmapsCoatSwitchEnabledFast) is not covered here: there is no local MySQL, and
 * its only real logic -- default ON, fail-open -- is a one-liner over app_setting.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../coat-display.php';

$REAL = '/uploads/wappen/bergk-nigreich-isnatosch-custom.png?v=1750000000';
$WIKI = 'https://de.wiki-aventurica.de/images/a/ab/Wappen.png';

// --- avesmapsCoatDisplayUrl -------------------------------------------------------------------------

assert(avesmapsCoatDisplayUrl('', false) === '',
    'no coat stays no coat -- the switch replaces a coat, it never invents one');

assert(avesmapsCoatDisplayUrl('   ', false) === '',
    'a whitespace-only URL is no coat either');

assert(avesmapsCoatDisplayUrl($REAL, true) === $REAL,
    'switch ON is the identity, cache-bust query included');

assert(avesmapsCoatDisplayUrl($WIKI, true) === $WIKI,
    'switch ON does not touch a remote coat either');

assert(avesmapsCoatDisplayUrl($REAL, false) === AVESMAPS_COAT_PLACEHOLDER_URL,
    'switch OFF replaces an existing coat with the placeholder');

assert(avesmapsCoatDisplayUrl($WIKI, false) === AVESMAPS_COAT_PLACEHOLDER_URL,
    'a remote coat is replaced too -- its URL must not reach the public payload');

assert(AVESMAPS_COAT_PLACEHOLDER_URL === '/img/wappen.png',
    'the placeholder path is the file the deploy ships; changing it needs the asset to move with it');

// --- avesmapsPoliticalApplyCoatDisplaySwitch --------------------------------------------------------

$features = [
    ['properties' => ['name' => 'Isnatosch', 'coat_of_arms_url' => $REAL, 'label_coat_of_arms_url' => $REAL]],
    ['properties' => ['name' => 'Ohne Wappen', 'coat_of_arms_url' => '', 'label_coat_of_arms_url' => '']],
    ['properties' => ['name' => 'Nur Label', 'label_coat_of_arms_url' => $WIKI]],
    ['properties' => ['name' => 'Gar keine Wappen-Schluessel']],
    ['no_properties' => true],
];

assert(avesmapsPoliticalApplyCoatDisplaySwitch($features, true) === $features,
    'switch ON hands the feature list back untouched -- no rebuild, no reordering');

$off = avesmapsPoliticalApplyCoatDisplaySwitch($features, false);

assert($off[0]['properties']['coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL
    && $off[0]['properties']['label_coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL,
    'both coat keys are replaced -- the map label reads one, the infobox the other');

assert($off[0]['properties']['name'] === 'Isnatosch',
    'nothing but the coat keys is touched');

assert($off[1]['properties']['coat_of_arms_url'] === ''
    && $off[1]['properties']['label_coat_of_arms_url'] === '',
    'a territory without a coat keeps none -- THE regression to fear');

assert($off[2]['properties']['label_coat_of_arms_url'] === AVESMAPS_COAT_PLACEHOLDER_URL
    && !array_key_exists('coat_of_arms_url', $off[2]['properties']),
    'a missing key is not created, only an existing one is rewritten');

assert($off[3]['properties'] === ['name' => 'Gar keine Wappen-Schluessel'],
    'a feature with no coat keys at all comes through unchanged');

assert($off[4] === ['no_properties' => true],
    'a malformed feature is skipped instead of fatalling the whole layer');

assert(count($off) === count($features),
    'the feature count never changes -- this is a rewrite, not a filter');

echo "coat-display-test: all assertions passed\n";
