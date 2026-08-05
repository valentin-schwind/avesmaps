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


// ===== THE ENCODED PAYLOAD MUST FIT ITS COLUMN =====================================================
//
// 💣 A ROW CAP IS NOT A SIZE CAP. AVESMAPS_CITYMAP_LINK_ROWS_MAX bounds how many link rows a report
// may carry (20, finding A30); it says nothing about how many BYTES they encode to, and the two
// guards on a row measure different units without measuring this one -- the label with mb_strlen
// (CHARACTERS), the url with strlen (BYTES). json_encode has to write every C0 control character as
// \u00XX, six bytes for one, and neither trim() nor the \s+ collapse strips \x01. Measured against
// the shipped code: twenty rows, every one inside its limits, encode to over 83.000 bytes.
//
// payload_json is TEXT (65.535). In strict mode that is error 1406 and a 500 for a reporter whose
// report looked fine; without strict mode it is worse and silent -- truncated row, json_decode
// returns null in the review screen, and the approval answers "Zu welcher Karte gehoert der
// Fundort?" forever. The report can then never be approved AND never be deleted, because
// map_reports has no delete path (A3/A28).
assert(
    AVESMAPS_REPORT_PAYLOAD_JSON_MAX_BYTES === 60000,
    'the ceiling leaves room below the column rather than racing it'
);
assert(
    AVESMAPS_REPORT_PAYLOAD_JSON_MAX_BYTES < 65535,
    'and it is BELOW the TEXT column -- a guard at exactly the column still hands MySQL a row it rejects'
);

// A payload that is nothing is still nothing: no report type but karte/fundort fills this column.
assert(avesmapsEncodeReportPayloadJson(null) === null, 'no payload encodes to no column value');

// The ordinary case passes untouched, and the encoding flags are the ones the column has always
// held -- unescaped slashes and unicode, or every umlaut would silently triple in size.
$ordinary = ['citymap_public_id' => 'ABC', 'links' => [['label' => 'Wiki', 'url' => 'https://example.org/a']]];
$encoded = avesmapsEncodeReportPayloadJson($ordinary);
assert(is_string($encoded) && json_decode($encoded, true) === $ordinary, 'an ordinary payload survives the round trip');
assert(str_contains($encoded, 'https://example.org/a'), 'slashes stay unescaped');

// 💣 The case the guard exists for, built the way the attack does: every value inside its own limit.
// ⚠️ The two sizes mirror AVESMAPS_CITYMAP_LINK_LABEL_MAX (200 CHARACTERS) and
// AVESMAPS_CITYMAP_URL_MAX (500 BYTES) -- written out rather than imported, because this file tests
// the outcome library and must not drag the whole citymap library in to do it. Every value here is
// INSIDE its own guard; that is the entire point.
$controlLabel = str_repeat("\x01", 200);
$controlUrl = 'https://e.org/' . str_repeat("\x01", 486);
$fat = ['citymap_public_id' => 'ABC', 'links' => []];
for ($i = 0; $i < 20; $i++) {
    $fat['links'][] = ['label' => $controlLabel, 'url' => $controlUrl, 'is_paid' => null, 'sort_order' => $i];
}
$rawSize = strlen(json_encode($fat, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
assert($rawSize > 65535, "the fixture really does burst the column (got {$rawSize} bytes)");
$threw = false;
try {
    avesmapsEncodeReportPayloadJson($fat);
} catch (InvalidArgumentException) {
    $threw = true;
}
assert($threw, 'a payload over the ceiling is REFUSED, not stored and truncated');

// ⚠️ Refused, not shortened. Cutting it would store a link list the reporter never wrote, under
// their name -- the same reasoning as every other length guard on this path.
assert(
    !str_contains(file_get_contents(__DIR__ . '/../report-outcome.php'), 'substr($json'),
    'the guard never truncates the encoded payload'
);

// And the endpoint has to USE it -- a green library on top of an endpoint that still calls
// json_encode by hand is exactly the shape this file was burned by once before.
$endpointSource = file_get_contents(__DIR__ . '/../../../app/report-location.php');
assert(
    str_contains($endpointSource, "'payload_json' => avesmapsEncodeReportPayloadJson("),
    'the endpoint encodes through the guard'
);
assert(
    !preg_match('/payload_json[^\n]*\n[^\n]*json_encode\(/', $endpointSource),
    'and no longer encodes that column by hand'
);


// ===== THE THROTTLE RUNS BEFORE THE EXPENSIVE WORK ================================================
//
// 💣 ORDER, not presence -- and the order is the whole finding (A31). avesmapsLocationNameExists
// reads EVERY active place out of map_features and EVERY open location report out of map_reports,
// two queries with no LIMIT, and normalises each row in PHP. Until 2026-08-05 it ran BEFORE the
// hourly limit, so a caller already over that limit paid both scans on every request and got a 429
// for it. A throttle that costs more than the work it declines is not a throttle, and this host has
// gone down under load three times.
$reportEndpoint = file_get_contents(__DIR__ . '/../../../app/report-location.php');
assert(is_string($reportEndpoint) && $reportEndpoint !== '', 'the report endpoint is readable');

$ensureAt = strpos($reportEndpoint, 'avesmapsEnsureMapReportsTable($pdo);');
$throttleAt = strpos($reportEndpoint, 'avesmapsReportRateLimitExceeded($pdo, $ipHash)');
$nameCheckAt = strpos($reportEndpoint, 'avesmapsLocationNameExists($pdo, $mapReport[');
$duplicateAt = strpos($reportEndpoint, 'avesmapsIsNearDuplicateReport($pdo, $mapReport)');
$insertAt = strpos($reportEndpoint, '$insertStatement = $pdo->prepare(');
assert(
    is_int($ensureAt) && is_int($throttleAt) && is_int($nameCheckAt) && is_int($duplicateAt) && is_int($insertAt),
    'all five steps are present in the endpoint'
);

// ⚠️ The DDL stays ABOVE the throttle: the rate-limit query reads map_reports, so on a fresh
// installation a throttle moved any earlier answers 500 instead of throttling.
assert($ensureAt < $throttleAt, 'the table is ensured before anything queries it');
// 💣 THE SWAP ITSELF.
assert($throttleAt < $nameCheckAt, 'the hourly limit is decided BEFORE the two full scans, not after');
assert($throttleAt < $duplicateAt, 'and before the duplicate probe as well');
assert($nameCheckAt < $insertAt, 'the name conflict is still decided before anything is written');

// ⭐ The swap also closes an oracle: while the 409 was decided first, a caller could ask "does this
// place exist?" without limit -- the throttle came afterwards and stopped the report, never the
// question. This assert is what keeps the answer behind the throttle.
assert(
    strpos($reportEndpoint, "avesmapsErrorResponse(429, 'rate_limited'") < strpos($reportEndpoint, "avesmapsErrorResponse(409, 'conflict'"),
    'an over-limit caller is turned away before it learns whether the name exists'
);

// The two scans really are unbounded -- that is why their position matters. If someone ever gives
// them a LIMIT this assert should be revisited, not deleted: the order would still be right.
$nameFn = substr($reportEndpoint, (int) strpos($reportEndpoint, 'function avesmapsLocationNameExists'));
$nameFn = substr($nameFn, 0, (int) strpos($nameFn, "\n}"));
assert(substr_count($nameFn, '$pdo->prepare(') === 2, 'the name check runs two queries');
assert(!str_contains($nameFn, 'LIMIT'), 'neither of them is bounded -- the reason the throttle must come first');

echo "report-outcome ok\n";
