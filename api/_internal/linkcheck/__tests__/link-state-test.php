<?php

declare(strict_types=1);

/**
 * Unit test for the pure link-state transition. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/linkcheck/__tests__/link-state-test.php
 * Exit 0 = all asserts passed.
 *
 * The transition table is Spec §1.3. The whole point of this unit is that it is NOT naive: a single
 * timeout must never kill a living link, and only a definitive 4xx is instant death.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../state.php';

$current = static fn(string $state, int $streak = 0): array => ['state' => $state, 'fail_streak' => $streak];

// ---- 2xx: alive, streak cleared, recheck in a week ------------------------------------------------
foreach ([200, 204, 299] as $status) {
    $d = avesmapsLinkCheckDecide($current('unchecked'), $status);
    assert($d['verdict'] === true && $d['state'] === 'online' && $d['fail_streak'] === 0);
    assert($d['online'] === true && $d['recheck_days'] === AVESMAPS_LINK_RECHECK_ONLINE_DAYS);
}
// A dead link that answers again comes back to life (dead is a cache, not a tombstone).
$d = avesmapsLinkCheckDecide($current('dead', 5), 200);
assert($d['state'] === 'online' && $d['fail_streak'] === 0 && $d['online'] === true);

// ---- definitive 4xx: instant death, no streak needed ----------------------------------------------
foreach ([401, 403, 404, 410] as $status) {
    $d = avesmapsLinkCheckDecide($current('online'), $status);
    assert($d['verdict'] === true && $d['state'] === 'dead');
    assert($d['online'] === false && $d['recheck_days'] === AVESMAPS_LINK_RECHECK_DEAD_DAYS);
}
// Even a brand-new link dies instantly on a 404 -- no three strikes for a definitive answer.
assert(avesmapsLinkCheckDecide($current('unchecked'), 404)['state'] === 'dead');

// ---- 429/408: we were throttled -> NO verdict, only check_after moves -----------------------------
// verdict=false tells the store to touch check_after ONLY: state, http_status and last_checked_at keep
// their last real finding. Being rate-limited is a statement about us, not about the link.
foreach ([408, 429] as $status) {
    $d = avesmapsLinkCheckDecide($current('online', 0), $status);
    assert($d['verdict'] === false);
    assert($d['state'] === 'online' && $d['fail_streak'] === 0);
    assert($d['recheck_days'] === AVESMAPS_LINK_RECHECK_THROTTLED_DAYS);
    // It must not disturb a pending failure streak either.
    assert(avesmapsLinkCheckDecide($current('unchecked', 2), $status)['fail_streak'] === 2);
}

// ---- 5xx / timeout / DNS: three strikes ----------------------------------------------------------
// THE core guarantee: one 500 does NOT flip a live link to dead. It stays green (Spec §1.3 -- a
// flickering display would be worse than a slightly delayed one) and is re-probed the next day.
$d = avesmapsLinkCheckDecide($current('online', 0), 500);
assert($d['verdict'] === true && $d['state'] === 'online' && $d['fail_streak'] === 1);
assert($d['online'] === false && $d['recheck_days'] === AVESMAPS_LINK_RECHECK_FAILING_DAYS);

$d = avesmapsLinkCheckDecide($current('online', 1), 503);
assert($d['state'] === 'online' && $d['fail_streak'] === 2);

// The third consecutive failure is the one that kills it.
$d = avesmapsLinkCheckDecide($current('online', 2), 500);
assert($d['state'] === 'dead' && $d['fail_streak'] === 3);
assert($d['recheck_days'] === AVESMAPS_LINK_RECHECK_DEAD_DAYS);
assert(AVESMAPS_LINK_DEAD_STREAK === 3);

// http_status 0 = no HTTP at all (timeout, DNS, TLS) -- same three-strikes path, never instant death.
$d = avesmapsLinkCheckDecide($current('online', 0), 0);
assert($d['verdict'] === true && $d['state'] === 'online' && $d['fail_streak'] === 1);
assert(avesmapsLinkCheckDecide($current('unchecked', 2), 0)['state'] === 'dead');

// An unchecked link stays unchecked while the streak builds -- it was never judged, so it is not "dead"
// yet, it is still simply unknown.
assert(avesmapsLinkCheckDecide($current('unchecked', 0), 500)['state'] === 'unchecked');
assert(avesmapsLinkCheckDecide($current('unchecked', 1), 500)['state'] === 'unchecked');

// ---- anything else is treated as inconclusive, never as death ------------------------------------
// 3xx (redirect loop past MAXREDIRS), 400, 405, 418 ... none of these prove the link is gone. Only the
// four codes above are definitive; everything else takes the three-strikes path.
foreach ([301, 400, 405, 418, 451] as $status) {
    $d = avesmapsLinkCheckDecide($current('online', 0), $status);
    assert($d['state'] === 'online' && $d['fail_streak'] === 1);
    assert(avesmapsLinkCheckDecide($current('online', 2), $status)['state'] === 'dead');
}

echo "link-state ok\n";
