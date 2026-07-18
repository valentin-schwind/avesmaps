<?php

declare(strict_types=1);

/**
 * Unit test for the adventure-cover mass run's PURE part: the skip rule. The step itself (due query, fetch,
 * state write) is DB-bound and proven end-to-end only in the owner's live run (no local MySQL). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/adventure-cover-autoget-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../app-setting.php';
require __DIR__ . '/../adventures.php';

// "Own beats wiki" (spec §4, mirrors citymap "own beats auto"): a run NEVER overwrites a manual cover
// upload. The signal is the per-field origin field_origins_json['cover_url'] === 'manual', set by
// avesmapsSetAdventureCoverUrl on an editor upload.
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => 'manual']) === true, 'manual upload -> skip');
// A wiki-fetched cover may be refreshed.
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => 'wiki']) === false);
// No origin recorded yet -> not a manual override -> fetchable (the default is NOT manual here, unlike
// citymap's thumb_origin: an unset cover origin means "never set", so the run may fill it).
assert(avesmapsAdventureCoverAutogetSkips([]) === false);
assert(avesmapsAdventureCoverAutogetSkips(['cover_url' => '']) === false);
assert(avesmapsAdventureCoverAutogetSkips(['title' => 'manual']) === false, 'a different field being manual is irrelevant');
echo "adventure-cover skip rule ok\n";

echo "adventure-cover-autoget ok\n";
