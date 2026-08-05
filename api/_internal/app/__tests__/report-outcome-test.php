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
    'two call sites answer "arrived" -- the stored report and the silently discarded one'
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

// 💣 And it must run BEFORE the spam words. Behind them the two answers become a free oracle on the
// word list: a bare link answers 400, the same bare link carrying a spam word answers 201, and neither
// writes a row or touches the hourly limit. In front of them every link-only comment answers 400
// whatever it carries.
$linkOnlyCheckAt = strpos($endpointSource, 'avesmapsIsLinkOnlyText($comment)');
$spamWordCheckAt = strpos($endpointSource, 'avesmapsContainsSpamText($spamText)');
assert(
    is_int($linkOnlyCheckAt) && is_int($spamWordCheckAt) && $linkOnlyCheckAt < $spamWordCheckAt,
    'the link-only check runs before the spam words, or the pair of answers maps the word list for free'
);

// --- A1: the wait the reporter is told about -------------------------------------------------------

assert(avesmapsReportClampRetryAfterSeconds(null) === 0, 'MIN() over an empty set is SQL NULL -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(false) === 0, 'fetchColumn() on no row returns false -> unknown');
assert(avesmapsReportClampRetryAfterSeconds('') === 0, 'unusable value -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(-30) === 0, 'a window already passed -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(0) === 0, 'zero -> unknown');
assert(avesmapsReportClampRetryAfterSeconds(45) === 60, 'a partial minute rounds up to a whole one');
assert(avesmapsReportClampRetryAfterSeconds('120.4') === 180, 'partial seconds round up, strings count');
assert(avesmapsReportClampRetryAfterSeconds(2580) === 2580, 'a whole number of minutes passes through');
assert(avesmapsReportClampRetryAfterSeconds(99999) === 3600, 'a wrong clock cannot promise longer than the window');

// 💣 Minute granularity is not cosmetic. The raw value is CURRENT_TIMESTAMP subtracted from the oldest
// counted report, so a second-precise Retry-After hands that report's timestamp back to the second --
// and with a spoofable bucket key that can be someone else's report.
assert(
    avesmapsReportClampRetryAfterSeconds(2581) % 60 === 0 && avesmapsReportClampRetryAfterSeconds(1) % 60 === 0,
    'Retry-After is always a whole number of minutes'
);

$message = avesmapsReportRateLimitMessage(2580);
assert(str_contains($message, '43 Minuten'), 'the reporter is told how long, not just "later"');
assert(str_contains($message, 'nicht angenommen'), 'the reporter is told the report did NOT arrive');
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
// Pins the product decision, nothing more -- it proves neither fix.
assert(AVESMAPS_REPORT_RATE_LIMIT_PER_HOUR === 5, 'five reports per IP per hour');

// 💣 The two asserts below are the ones with teeth, and they were briefly missing: an adversarial
// review restored the A2 bug by pasting the old inline query back into the endpoint, and every OTHER
// assert in this file stayed green. Asserting a clause is in a library string proves nothing at all
// unless something also asserts the endpoint uses that string.
assert(
    str_contains($endpointSource, 'avesmapsReportRateLimitCountSql()'),
    'report-location.php must build the bucket query from this library'
);
assert(
    preg_match('/FROM\s+map_reports\s+WHERE\s+ip_hash/i', $endpointSource) === 0,
    'report-location.php must not keep a second copy of the bucket query'
);

// The retry-after query must describe the SAME set, or the minute count would name a row the bucket
// never counted.
$retryAfterSql = avesmapsReportRateLimitRetryAfterSql();
assert(
    str_contains($retryAfterSql, "report_mode <> 'change'")
        && str_contains($retryAfterSql, 'ip_hash = :ip_hash')
        && str_contains($retryAfterSql, 'INTERVAL 1 HOUR'),
    'the retry-after query filters the same rows as the count'
);
assert(
    str_contains($endpointSource, 'avesmapsReportRateLimitRetryAfterSql()'),
    'report-location.php must build the retry-after query from this library too'
);

// ⚠️ What this file CANNOT prove: that MySQL then counts correctly, or that the retry-after query even
// parses. Both use INTERVAL, which sqlite cannot execute -- and this project has no local MySQL to try
// them against, so no local database can run them at all. A green run on a database that lacks the
// property under test proves nothing about the one that has it (the collation outage of 2026-08-05
// stayed green throughout). A pass here means the clauses are in the strings that ship. The counting
// itself is measured against the live database, and the retry-after query is wrapped at its call site
// so a parse failure costs the minute count, not the answer.

echo "report-outcome ok\n";
