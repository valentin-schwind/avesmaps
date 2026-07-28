<?php

declare(strict_types=1);

/**
 * Unit tests for the peak-height reader (api/_internal/map/features.php):
 * avesmapsReadOptionalPeakHeight.
 *
 * The function is pure. The guarded write paths in avesmapsUpdateLabelFeature and
 * avesmapsCreateLabelFeature take a PDO and are NOT covered here -- what they must do is
 * documented at the call sites: touch properties['height_schritt'] ONLY when the payload
 * carries the key. That rule is not decoration. On 2026-07-28 the neighbouring other_source
 * branch ran unconditionally, and every save of a label whose dialog had lost the field
 * silently deleted the stored source.
 *
 * The unit is Schritt (a DSA measure, not translated -- same class as the BF calendar suffix).
 * The upper bound is a typo guard, one zero too many, not a statement about Aventurien.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/map/__tests__/label-height-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// "Not recorded" is a state of its own. It is NOT zero: an unrecorded peak falls back to a
// placeholder when the height field is built, a peak recorded as 0 does not.
assert(avesmapsReadOptionalPeakHeight(null) === null, 'null stays null');
assert(avesmapsReadOptionalPeakHeight('') === null, 'empty string clears the field');
assert(avesmapsReadOptionalPeakHeight('  ') === null, 'blank string clears the field');

assert(avesmapsReadOptionalPeakHeight(3000) === 3000.0, 'plain number survives');
assert(avesmapsReadOptionalPeakHeight(3000.5) === 3000.5, 'float survives');
assert(avesmapsReadOptionalPeakHeight('3000') === 3000.0, 'numeric string survives');
assert(avesmapsReadOptionalPeakHeight(0) === 0.0, 'zero is a recorded height, not "unset"');

// The editors type German. A comma is a decimal point here, never a thousands separator --
// "3.000" would otherwise silently become 3 Schritt.
assert(avesmapsReadOptionalPeakHeight('3000,5') === 3000.5, 'German decimal comma is accepted');

assert(avesmapsReadOptionalPeakHeight(-1) === null, 'negative is rejected, not clamped to 0');
assert(avesmapsReadOptionalPeakHeight(20001) === 20000.0, 'typo guard clamps the upper end');
assert(avesmapsReadOptionalPeakHeight(20000) === 20000.0, 'the bound itself is allowed');
assert(avesmapsReadOptionalPeakHeight('abc') === null, 'garbage is rejected');
assert(avesmapsReadOptionalPeakHeight([]) === null, 'an array is rejected');
assert(avesmapsReadOptionalPeakHeight(true) === null, 'a boolean is rejected');
assert(avesmapsReadOptionalPeakHeight(INF) === null, 'non-finite is rejected');
assert(avesmapsReadOptionalPeakHeight(NAN) === null, 'NaN is rejected');

echo "label-height: all assertions passed\n";
