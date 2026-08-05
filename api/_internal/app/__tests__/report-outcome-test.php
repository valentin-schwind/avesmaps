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

// ⚠️ What this file CANNOT prove: that MySQL then counts correctly. The query above uses INTERVAL,
// which sqlite cannot execute, so no local database can run it -- and a green run on a database that
// lacks the property under test proves nothing about the one that has it (the collation outage of
// 2026-08-05 stayed green throughout). A pass here means the clause is in the string that ships; the
// counting itself is measured against the live database.

// One definition, one caller: the endpoint must not carry a second copy of the query that could drift.
assert(
    str_contains($endpointSource, 'avesmapsReportRateLimitCountSql()'),
    'report-location.php must build the bucket query from this library'
);
assert(
    preg_match('/FROM\s+map_reports\s+WHERE\s+ip_hash/i', $endpointSource) === 0,
    'report-location.php must not keep a second copy of the bucket query'
);

echo "report-outcome ok\n";
