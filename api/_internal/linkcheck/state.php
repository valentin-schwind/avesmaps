<?php

declare(strict_types=1);

// Linkchecker: the PURE state transition (Spec §1.3). No DB, no HTTP -- unit-tested against fixtures in
// __tests__/link-state-test.php. Every DB touch lives in store.php, every HTTP touch in probe.php; this
// file is the only place that decides what a probe result MEANS.

// Three consecutive inconclusive failures before we call a link dead. The reason this is not 1: a single
// 500/timeout is almost always transient, and a link flickering between green and grey would be worse
// than a verdict that arrives a day or two late.
const AVESMAPS_LINK_DEAD_STREAK = 3;

// Recheck cadence in days. Dead links are re-probed too (they do come back), just not as eagerly.
const AVESMAPS_LINK_RECHECK_ONLINE_DAYS = 7;
const AVESMAPS_LINK_RECHECK_DEAD_DAYS = 14;
const AVESMAPS_LINK_RECHECK_THROTTLED_DAYS = 1;
// Not in the spec table: how soon to re-probe a link that is mid-streak (failed once or twice but is not
// dead yet). One day, not the 7-day online cadence -- otherwise a genuinely dead link would need three
// weeks to be recognised as dead.
const AVESMAPS_LINK_RECHECK_FAILING_DAYS = 1;

// The server answered, and the answer is final: the resource is gone (404/410) or shut to us (401/403).
// No streak needed -- this IS the verdict.
const AVESMAPS_LINK_DEAD_HTTP_CODES = [401, 403, 404, 410];
// The server answered "not now": we were rate-limited or the request timed out server-side. That is a
// statement about US, not about the link -- so we pass no judgement at all.
const AVESMAPS_LINK_THROTTLED_HTTP_CODES = [408, 429];

// Decide what one probe result means for one link.
//
// $current: ['state' => 'unchecked'|'online'|'dead', 'fail_streak' => int] -- the stored row.
// $httpStatus: the final status after redirects; 0 = no HTTP at all (timeout, DNS, TLS).
//
// Returns:
//   verdict      false = we learned nothing (throttled). The store must then move check_after ONLY and
//                leave state/http_status/last_checked_at at their last real finding.
//   state        the new state to store.
//   fail_streak  the new consecutive-failure count (0 after any success).
//   online       true only on a 2xx -> the store stamps last_online_at and clears first_failed_at.
//   recheck_days when to make the row due again.
function avesmapsLinkCheckDecide(array $current, int $httpStatus): array
{
    $state = (string) ($current['state'] ?? 'unchecked');
    $streak = (int) ($current['fail_streak'] ?? 0);

    // 2xx (after however many redirects cURL followed): alive. Clears the streak, so a link that
    // recovers on its third strike starts counting from zero again -- and a dead one comes back.
    if ($httpStatus >= 200 && $httpStatus < 300) {
        return [
            'verdict' => true,
            'state' => 'online',
            'fail_streak' => 0,
            'online' => true,
            'recheck_days' => AVESMAPS_LINK_RECHECK_ONLINE_DAYS,
        ];
    }

    // Throttled -> no verdict. Deliberately BEFORE the dead-code check: 429 must never be read as death.
    if (in_array($httpStatus, AVESMAPS_LINK_THROTTLED_HTTP_CODES, true)) {
        return [
            'verdict' => false,
            'state' => $state,
            'fail_streak' => $streak,
            'online' => false,
            'recheck_days' => AVESMAPS_LINK_RECHECK_THROTTLED_DAYS,
        ];
    }

    // Definitive answer -> dead immediately, whatever the streak was.
    if (in_array($httpStatus, AVESMAPS_LINK_DEAD_HTTP_CODES, true)) {
        return [
            'verdict' => true,
            'state' => 'dead',
            'fail_streak' => $streak + 1,
            'online' => false,
            'recheck_days' => AVESMAPS_LINK_RECHECK_DEAD_DAYS,
        ];
    }

    // Everything else (5xx, timeout/DNS = 0, a redirect loop past MAXREDIRS, an odd 400/405/418): we did
    // not prove anything. Count the strike; only the third one is fatal. Until then the link KEEPS its
    // previous state -- a live link stays green through a 500, an unchecked one stays unchecked.
    $streak++;
    $dead = $streak >= AVESMAPS_LINK_DEAD_STREAK;
    return [
        'verdict' => true,
        'state' => $dead ? 'dead' : $state,
        'fail_streak' => $streak,
        'online' => false,
        'recheck_days' => $dead ? AVESMAPS_LINK_RECHECK_DEAD_DAYS : AVESMAPS_LINK_RECHECK_FAILING_DAYS,
    ];
}
