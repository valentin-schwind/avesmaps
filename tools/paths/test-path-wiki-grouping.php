<?php

declare(strict_types=1);

/**
 * Characterization test: the number-sensitive grouping key used by the wiki path
 * assign/clear flows (avesmapsWikiSyncCreateMatchKey, api/_internal/wiki/sync.php).
 * Spelling variants of the SAME way number must group together; different way
 * numbers must NEVER collapse (the getPathDisplayName digit-strip trap must not
 * exist here). Umlaut handling is iconv/environment-dependent (see
 * tools/wikidump/test-wiki-key-derivation.php) -- so this test only asserts
 * equality/inequality BETWEEN keys plus literal values for pure-ASCII/ss cases.
 * Run:
 *     php -d extension=mbstring tools/paths/test-path-wiki-grouping.php
 */

require __DIR__ . '/../../api/_internal/wiki/sync.php';

$failures = 0;
$total = 0;
function check(string $label, bool $condition): void {
    global $failures, $total;
    $total++;
    if (!$condition) {
        $failures++;
        echo "FAIL {$label}\n";
        return;
    }
    echo "ok {$label}\n";
}

$key = static fn(string $value): string => avesmapsWikiSyncCreateMatchKey($value);

check('ss/space/hyphen variants of the same way group together',
    $key('Reichsstrasse-1') === $key('Reichsstrasse 1')
    && $key('Reichsstrasse 1') === $key("Reichsstra\u{00DF}e 1"));
check('literal key for the ss case is stable ascii', $key("Reichsstra\u{00DF}e 1") === 'reichsstrasse1');
check('way 1 never groups with way 2', $key("Reichsstra\u{00DF}e 1") !== $key("Reichsstra\u{00DF}e 2"));
check('trailing digits are preserved, not stripped', $key('Reichsstrasse-2715') === 'reichsstrasse2715');
check('documented hazard: leftover random name collides with the real way of that number',
    $key('Reichsstrasse-16') === $key("Reichsstra\u{00DF}e 16"));
check('subtype prefix alone does not group with a numbered way', $key('Reichsstrasse') !== $key('Reichsstrasse-1'));

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
