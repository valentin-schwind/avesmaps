<?php

declare(strict_types=1);

// What becomes of a submitted community report -- the pure decisions behind api/app/report-location.php.
// No PDO handle, no superglobals, no output: everything here can be asserted in isolation (see
// __tests__/report-outcome-test.php), which is the only kind of proof available in a project without a
// local database.

// Reports per IP per hour. The bucket exists to slow a flood of NEW proposals down.
const AVESMAPS_REPORT_RATE_LIMIT_PER_HOUR = 5;

// 💣 The bucket must count exactly what it blocks. Change reports ("Änderung vorschlagen") are
// deliberately EXEMPT from the limit -- an active contributor legitimately files several corrections in
// a row -- but until 2026-08-05 the exemption sat on the CHECK only, never on the COUNT: every
// correction still filled the bucket, so five corrections used up the allowance for new places and the
// sixth report was dropped. An exemption belongs in both halves or in neither.
//
// ⚠️ MySQL only (INTERVAL). No sqlite test can execute this string, so the unit test asserts that the
// clause is PRESENT and says so plainly -- what the query counts at runtime is provable against the
// live database and nowhere else.
function avesmapsReportRateLimitCountSql(): string {
    return "SELECT COUNT(*)
        FROM map_reports
        WHERE ip_hash = :ip_hash
            AND report_mode <> 'change'
            AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)";
}
