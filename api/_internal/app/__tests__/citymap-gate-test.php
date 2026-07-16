<?php

declare(strict_types=1);

/**
 * Unit test for the Kartensammlung's licence gate + three-valued properties. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/citymap-gate-test.php
 * Exit 0 = all asserts passed.
 *
 * Two rules are worth a test rather than a comment, because both fail SILENTLY and in the expensive
 * direction:
 *
 *  - THE IMAGE GATE (Spec §3.3). A wrong answer here publishes third-party cartography we have no right
 *    to serve. It is also the literal §8 smoke test for task C: "Lizenz auf unknown_other -> lokales Bild
 *    verschwindet aus dem Payload, externer Link bleibt".
 *  - THREE-VALUED PROPERTIES (Spec §3.1). NULL means "nobody recorded this" and must never collapse into
 *    false: a (bool) cast would turn "unknown" into a definite "nicht farbig" that nobody asserted, and
 *    the reader would be shown a fact we invented.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymaps.php';

// ---- licence vocabulary ------------------------------------------------------------------------------
assert(avesmapsCitymapNormalizeLicense('public_domain') === 'public_domain');
assert(avesmapsCitymapNormalizeLicense('permission_granted') === 'permission_granted');
// Unknown/garbage/empty/wrong-type all fall back to the NON-free default. This is the direction that
// matters: a typo in a licence string must never be the reason something gets published.
assert(avesmapsCitymapNormalizeLicense('cc-by-sa') === 'unknown_other');
assert(avesmapsCitymapNormalizeLicense('') === 'unknown_other');
assert(avesmapsCitymapNormalizeLicense(null) === 'unknown_other');
assert(avesmapsCitymapNormalizeLicense(42) === 'unknown_other');
assert(AVESMAPS_CITYMAP_LICENSE_DEFAULT === 'unknown_other');
// The default must not be free -- the whole gate hinges on it. (The settlement-image system defaults the
// other way, to 'ai_generated' = shown; that is safe for our own generated pictures and NOT for
// third-party maps, which is why the two differ on purpose.)
assert(!in_array(AVESMAPS_CITYMAP_LICENSE_DEFAULT, AVESMAPS_CITYMAP_LICENSES_FREE, true));
// Every free licence is a member of the vocabulary (a typo in one list only shows up here).
foreach (AVESMAPS_CITYMAP_LICENSES_FREE as $free) {
    assert(in_array($free, AVESMAPS_CITYMAP_LICENSES, true));
}
assert(avesmapsCitymapLicenseIsFree('cc0'));
assert(avesmapsCitymapLicenseIsFree('ai_generated'));
assert(!avesmapsCitymapLicenseIsFree('unknown_other'));
assert(!avesmapsCitymapLicenseIsFree('nonsense'));

// ---- the image gate (Spec §3.3 / §8 smoke test) -----------------------------------------------------
$freeRow = [
    'map_url' => 'https://example.org/gareth-gesamtplan',
    'map_local_url' => '/uploads/kartensammlungen/abc/map-1234.png',
    'map_license' => 'public_domain',
    'thumb_url' => '',
    'thumb_local_url' => '/uploads/kartensammlungen/abc/thumb-5678.png',
    'thumb_license' => 'cc0',
];
assert(avesmapsCitymapPublicMapLocalUrl($freeRow) === '/uploads/kartensammlungen/abc/map-1234.png');
assert(avesmapsCitymapPublicThumbUrl($freeRow) === '/uploads/kartensammlungen/abc/thumb-5678.png');

// The §8 smoke test, exactly: flip the licence to unknown_other -> our stored copies disappear...
$gatedRow = $freeRow;
$gatedRow['map_license'] = 'unknown_other';
$gatedRow['thumb_license'] = 'unknown_other';
assert(avesmapsCitymapPublicMapLocalUrl($gatedRow) === '');
assert(avesmapsCitymapPublicThumbUrl($gatedRow) === '');
// ...while the EXTERNAL link stays. map_url is a hyperlink we offer, not an image we serve, so it is
// never gated (§3.3: "immer gespeichert, immer ausgeliefert").
assert(avesmapsCitymapLinks($gatedRow)[0]['url'] === 'https://example.org/gareth-gesamtplan');

// Thumb and map are gated INDEPENDENTLY (owner decision): a source may have a free cover and a protected
// map. A single shared licence check would silently couple them.
$splitRow = $freeRow;
$splitRow['map_license'] = 'unknown_other';
assert(avesmapsCitymapPublicMapLocalUrl($splitRow) === '');
assert(avesmapsCitymapPublicThumbUrl($splitRow) === '/uploads/kartensammlungen/abc/thumb-5678.png');

// An EXTERNAL thumb is gated too -- deliberately beyond §3.3's literal wording, which names only the
// *_local_url fields. A hot-linked protected preview breaks §3.7's promise ("Vorschau nur bei freier
// Lizenz") exactly as thoroughly as serving our own copy would.
$externalThumb = [
    'thumb_url' => 'https://example.org/protected-thumb.jpg',
    'thumb_local_url' => '',
    'thumb_license' => 'unknown_other',
];
assert(avesmapsCitymapPublicThumbUrl($externalThumb) === '');
$externalThumb['thumb_license'] = 'permission_granted';
assert(avesmapsCitymapPublicThumbUrl($externalThumb) === 'https://example.org/protected-thumb.jpg');
// Our own upload outranks an external thumb when both are present and free.
$bothThumbs = ['thumb_url' => 'https://example.org/t.jpg', 'thumb_local_url' => '/uploads/kartensammlungen/x/thumb-9.png', 'thumb_license' => 'cc0'];
assert(avesmapsCitymapPublicThumbUrl($bothThumbs) === '/uploads/kartensammlungen/x/thumb-9.png');

// A row with no images at all is a valid row, not an error.
assert(avesmapsCitymapPublicThumbUrl(['thumb_license' => 'cc0']) === '');
assert(avesmapsCitymapPublicMapLocalUrl(['map_license' => 'cc0']) === '');

// ---- links -------------------------------------------------------------------------------------------
$linked = avesmapsCitymapLinks(['map_url' => 'https://example.org/plan.png']);
assert(count($linked) === 1);
assert($linked[0]['key'] === 'map');
assert($linked[0]['url_hash'] === hash('sha256', 'https://example.org/plan.png'));
// No map_url -> NO link. An empty url would still hash (sha256 of "") and then be probed forever.
assert(avesmapsCitymapLinks(['map_url' => '']) === []);
assert(avesmapsCitymapLinks([]) === []);

// ---- three-valued booleans (Spec §3.1) ---------------------------------------------------------------
// unknown
assert(avesmapsCitymapTriBool(null) === null);
assert(avesmapsCitymapTriBool('') === null);
assert(avesmapsCitymapTriBool('unknown') === null);
// false -- and note '0' is a STRING here: a naive (bool) '0' is false in PHP but (bool) 'false' is TRUE,
// which is why the string forms are spelled out rather than cast.
assert(avesmapsCitymapTriBool('0') === 0);
assert(avesmapsCitymapTriBool('false') === 0);
assert(avesmapsCitymapTriBool('nein') === 0);
assert(avesmapsCitymapTriBool(false) === 0);
assert(avesmapsCitymapTriBool(0) === 0);
// true
assert(avesmapsCitymapTriBool('1') === 1);
assert(avesmapsCitymapTriBool(true) === 1);
assert(avesmapsCitymapTriBool(1) === 1);

// The read direction: NULL must survive as null, NOT become false.
assert(avesmapsCitymapTriBoolOut(null) === null);
assert(avesmapsCitymapTriBoolOut(0) === false);
assert(avesmapsCitymapTriBoolOut(1) === true);
assert(avesmapsCitymapTriBoolOut('1') === true);

// ---- ints --------------------------------------------------------------------------------------------
assert(avesmapsCitymapIntOrNull('') === null);
assert(avesmapsCitymapIntOrNull(null) === null);
assert(avesmapsCitymapIntOrNull('1027') === 1027);
assert(avesmapsCitymapIntOrNull(0) === 0); // a real 0 is a value, not "unknown"

// ---- url normalisation -------------------------------------------------------------------------------
assert(avesmapsCitymapNormalizeUrl('', 'x') === '');
assert(avesmapsCitymapNormalizeUrl('  https://example.org/a  ', 'x') === 'https://example.org/a');
assert(avesmapsCitymapNormalizeUrl('http://example.org/a', 'x') === 'http://example.org/a');
$rejected = 0;
foreach (['javascript:alert(1)', 'ftp://example.org/a', 'mailto:a@b.c', 'data:text/html,x'] as $bad) {
    try {
        avesmapsCitymapNormalizeUrl($bad, 'Karten-Link');
    } catch (InvalidArgumentException) {
        $rejected++;
    }
}
assert($rejected === 4);
// Too long is refused, not truncated: a silently truncated URL is a broken link.
try {
    avesmapsCitymapNormalizeUrl('https://example.org/' . str_repeat('a', AVESMAPS_CITYMAP_URL_MAX), 'x');
    assert(false);
} catch (InvalidArgumentException) {
}

// ---- vocabulary sanity -------------------------------------------------------------------------------
// '' is NOT a member of the art list: unknown is expressed as NULL, never as an empty enum value.
assert(!in_array('', AVESMAPS_CITYMAP_ARTS, true));
assert(count(AVESMAPS_CITYMAP_TYPE_KEYS) === count(array_unique(AVESMAPS_CITYMAP_TYPE_KEYS)));
assert(count(AVESMAPS_CITYMAP_LICENSES) === count(array_unique(AVESMAPS_CITYMAP_LICENSES)));

echo "citymap-gate ok\n";
