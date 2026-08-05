<?php

declare(strict_types=1);

/**
 * Unit test for the pure report-outcome decisions. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/report-outcome-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../report-outcome.php';

// The endpoint is a SCRIPT -- requiring it would run the request handler. It is read as text so the
// structural claims below can be made about it without executing anything.
$endpointSource = file_get_contents(__DIR__ . '/../../../app/report-location.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'the endpoint source must be readable');

// --- A1: a discarded report and a stored one are indistinguishable from outside --------------------

assert(
    avesmapsReportAcceptedResponse() === [201, ['ok' => true, 'message' => 'Karteneintrag wurde gemeldet.']],
    'the accepted answer is 201 plus the success body'
);

// The property this whole library exists for: ONE producer. A second, hand-built copy of the answer is
// how the two drifted apart in the first place -- same sentence, but 200 for the discard and 201 for
// the store, which told every bot after one attempt which of its tricks got through.
assert(
    substr_count($endpointSource, AVESMAPS_REPORT_ACCEPTED_MESSAGE) === 0,
    'report-location.php must not build its own copy of the accepted-report sentence'
);
assert(
    substr_count($endpointSource, 'avesmapsRespondReportAccepted();') === 2,
    'exactly two answers say "arrived": the stored report and the silently discarded one -- nothing else'
);
assert(
    !str_contains($endpointSource, 'avesmapsJsonResponse(200'),
    'no report may be answered with 200 any more -- that status WAS the tell'
);

// The rejections a human walks into are honest instead: a real error the form shows without clearing.
assert(
    str_contains($endpointSource, "avesmapsErrorResponse(429, 'rate_limited'"),
    'the hourly limit answers 429, not a silent success'
);
assert(
    preg_match('/avesmapsIsLinkOnlyText\(\$comment\)\)\s*\{\s*throw new InvalidArgumentException/', $endpointSource) === 1,
    'a link-only explanation is a validation error (400), not a silent discard'
);
assert(
    preg_match('/avesmapsContainsSpamText\(\$spamText\)\s*\|\|/', $endpointSource) === 0,
    'the link-only check must no longer share the spam branch -- one is a bot trap, the other a human mistake'
);

// --- A1: the wait the reporter is told about -------------------------------------------------------

assert(avesmapsReportClampRetryAfterSeconds(null) === 0, 'no row -> unknown');
assert(avesmapsReportClampRetryAfterSeconds('') === 0, 'unusable value -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(-30) === 0, 'a window already passed -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(0) === 0, 'zero -> unknown');
assert(avesmapsReportClampRetryAfterSeconds('120.4') === 121, 'partial seconds round up, strings count');
assert(avesmapsReportClampRetryAfterSeconds(99999) === 3600, 'a wrong clock cannot promise longer than the window');

$message = avesmapsReportRateLimitMessage(2580);
assert(str_contains($message, '43 Minuten'), 'the reporter is told how long, not just "later"');
assert(str_contains($message, 'nicht annehmen'), 'the reporter is told the report did NOT arrive');
assert(
    !str_contains($message, AVESMAPS_REPORT_ACCEPTED_MESSAGE),
    'the rejection must not read like the acceptance'
);
assert(str_contains(avesmapsReportRateLimitMessage(45), 'einer Minute'), 'singular minute reads as German');
assert(str_contains(avesmapsReportRateLimitMessage(0), 'einer Stunde'), 'unknown wait falls back to the window');

// --- A2: the hourly bucket counts exactly what it blocks -------------------------------------------

$rateLimitSql = avesmapsReportRateLimitCountSql();
assert(
    str_contains($rateLimitSql, "report_mode <> 'change'"),
    'the bucket must exclude change reports -- they are exempt from the check, so counting them lets '
        . 'five corrections use up the allowance for new places'
);
assert(
    str_contains($rateLimitSql, 'ip_hash = :ip_hash') && str_contains($rateLimitSql, 'INTERVAL 1 HOUR'),
    'the bucket is still per IP and per hour'
);
assert(AVESMAPS_REPORT_RATE_LIMIT_PER_HOUR === 5, 'five reports per IP per hour');

// The retry-after query must describe the SAME set, or the minute count would name a row the bucket
// never counted.
$retryAfterSql = avesmapsReportRateLimitRetryAfterSql();
assert(
    str_contains($retryAfterSql, "report_mode <> 'change'")
        && str_contains($retryAfterSql, 'ip_hash = :ip_hash')
        && str_contains($retryAfterSql, 'INTERVAL 1 HOUR'),
    'the retry-after query filters the same rows as the count'
);

// ⚠️ What this file CANNOT prove: that MySQL then counts correctly, or that the retry-after query even
// parses. Both use INTERVAL, which sqlite cannot execute, so no local database can run them -- and a
// green run on a database that lacks the property under test proves nothing about the one that has it
// (the collation outage of 2026-08-05 stayed green throughout). A pass here means the clauses are in
// the strings that ship. The counting itself is measured against the live database, and the
// retry-after query is wrapped at its call site so a parse failure costs the minute count, not the
// answer.

echo "report-outcome ok\n";
