<?php

declare(strict_types=1);

/**
 * Unit tests for the location duplicate-name rule (api/_internal/map/features.php):
 * avesmapsNormalizeDuplicateLocationName + avesmapsDuplicateLocationNameMessage.
 *
 * Both are pure. avesmapsAssertUniqueLocationName itself takes a PDO and is NOT covered here.
 *
 * The normalizer is the AUTHORITY for the rule; js/routing/routing.js mirrors it and
 * js/routing/__tests__/duplicate-location-name.test.js asserts the SAME corpus against that
 * mirror. Discord #46: the two had silently drifted -- the client also folded accents, so it
 * refused "Grotz" while "Grötz" existed even though the server would have accepted it. Keep the
 * corpus below in sync with the JS test; a change to either normalizer must break one of them.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/map/__tests__/duplicate-location-name-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded -- the normalizer needs mb_strtolower.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// name => expected normalized key. MUST match js/routing/__tests__/duplicate-location-name.test.js.
const AVESMAPS_DUPLICATE_NAME_CORPUS = [
    'Neu-Sirensteen'     => 'neusirensteen',
    'neusirensteen'      => 'neusirensteen',
    'Neu Sirensteen'     => 'neusirensteen',
    'Havena'             => 'havena',
    '  Havena  '         => 'havena',
    'Punin (Horasreich)' => 'puninhorasreich',
    // Accents are PRESERVED: "Grötz" and "Grotz" are different names in a German setting.
    // This is the pair the client used to fold together (Discord #46).
    'Grötz'              => 'grötz',
    'Grotz'              => 'grotz',
    'Ödland'             => 'ödland',
    'Odland'             => 'odland',
    'Straße'             => 'straße',
    'Strasse'            => 'strasse',
    'Ort-42'             => 'ort42',
    ''                   => '',
    '---'                => '',
];

foreach (AVESMAPS_DUPLICATE_NAME_CORPUS as $input => $expected) {
    $actual = avesmapsNormalizeDuplicateLocationName((string) $input);
    assert(
        $actual === $expected,
        sprintf('normalize(%s): expected "%s", got "%s"', var_export($input, true), $expected, $actual)
    );
}
echo 'normalizer maps ' . count(AVESMAPS_DUPLICATE_NAME_CORPUS) . " inputs as specified ok\n";

// The pairs that decide whether a second place may exist.
assert(avesmapsNormalizeDuplicateLocationName('Neu-Sirensteen') === avesmapsNormalizeDuplicateLocationName('neusirensteen'));
assert(avesmapsNormalizeDuplicateLocationName('Grötz') !== avesmapsNormalizeDuplicateLocationName('Grotz'));
assert(avesmapsNormalizeDuplicateLocationName('Straße') !== avesmapsNormalizeDuplicateLocationName('Strasse'));
// The whole point of the fix: a parenthetical qualifier makes the second place a DIFFERENT name.
assert(avesmapsNormalizeDuplicateLocationName('Sirensteen') !== avesmapsNormalizeDuplicateLocationName('Sirensteen (Almada)'));
echo "collision verdicts ok (qualifier frees the name)\n";

// The message must name the blocking place and show the pattern -- not merely refuse.
$message = avesmapsDuplicateLocationNameMessage('Sirensteen');
assert(str_contains($message, 'Sirensteen'));
assert(str_contains($message, 'Sirensteen (Region)'));      // the concrete, copyable pattern
assert(str_contains($message, 'Klammern'));
assert(substr_count($message, 'Sirensteen') === 2);
// Guard the ASCII convention this file uses for every other user-facing message.
assert(preg_match('/[^\x20-\x7E]/', $message) !== 1, 'message must stay ASCII like its neighbours');
echo "message names the blocker and shows the qualifier pattern ok\n";

// A name that is empty after normalization must not produce a message path at all -- the assert
// helper returns early, so nothing downstream ever sees it. Documented here as behaviour.
assert(avesmapsNormalizeDuplicateLocationName('!!!') === '');
echo "punctuation-only name normalizes to empty (check is skipped) ok\n";

echo "ALL OK\n";
