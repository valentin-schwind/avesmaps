<?php

declare(strict_types=1);

// What becomes of a submitted community report -- the pure decisions behind api/app/report-location.php.
// No PDO handle, no superglobals, no output: everything here can be asserted in isolation (see
// __tests__/report-outcome-test.php), which is the only kind of proof available in a project without a
// local database.

// Reports per IP per hour. The bucket exists to slow a flood of NEW proposals down.
const AVESMAPS_REPORT_RATE_LIMIT_PER_HOUR = 5;
const AVESMAPS_REPORT_RATE_LIMIT_WINDOW_SECONDS = 3600;

const AVESMAPS_REPORT_ACCEPTED_STATUS = 201;
const AVESMAPS_REPORT_ACCEPTED_MESSAGE = 'Karteneintrag wurde gemeldet.';

// 💣 The ONE producer of the "your report arrived" answer. Both a stored report and a silently
// discarded one answer with it, so the two cannot drift apart -- and until 2026-08-05 they had drifted:
// same sentence, but 200 for the discard against 201 for the store. That put the protection exactly
// upside down. The HUMAN reads the sentence, believes the report arrived and has nothing left in hand
// (the form clears itself on success); the BOT reads the status code and knows after ONE attempt which
// of its tricks got through. So the bot traps -- honeypot, "submitted in under three seconds", spam
// word -- now answer byte for byte AND code for code like a success, while the two rejections a human
// walks into (the hourly limit, an explanation made of nothing but a link) get a real error that the
// form shows without clearing what was typed.
//
// ⚠️ This closes the status-code tell and ONLY that. Read no further than that: two older channels
// still separate a discard from a store, and neither is this function's to fix.
//   * The 409 duplicate-name answer sits BEFORE the filters in the flow (report-location.php:94
//     against :88). Probing with a name that exists answers 409 when nothing was filtered and 201
//     when something was -- one request per property, no row, and the hourly limit never sees it.
//   * The silent path returns before avesmapsCreatePdo(), so it answers in a fraction of the time a
//     stored report takes (9 metadata queries plus two full table scans).
// So: a bot learns nothing FROM THE STATUS CODE. It is not blind. Saying otherwise here would be the
// kind of confident, wrong sentence this project's own system test went looking for.
//
// @return array{0: int, 1: array{ok: bool, message: string}}
function avesmapsReportAcceptedResponse(): array {
    return [
        AVESMAPS_REPORT_ACCEPTED_STATUS,
        [
            'ok' => true,
            'message' => AVESMAPS_REPORT_ACCEPTED_MESSAGE,
        ],
    ];
}

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

// How long until the oldest counted report ages out of the window -- the number that turns "please try
// later" into "please try in 43 minutes".
//
// 💣 Deliberately a SECOND query rather than a second column on the one above. It runs only when the
// limit has already been hit (rare), so the hot path every new report walks stays the plain COUNT; and
// arithmetic that spans a clock stays inside the database, because the PHP process and MySQL need not
// agree on a timezone. There is no local MySQL to try this against, so the caller treats a failure here
// as "unknown" -- a rejected report must be rejected with a sentence, never with a 500.
function avesmapsReportRateLimitRetryAfterSql(): string {
    return "SELECT TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, DATE_ADD(MIN(created_at), INTERVAL 1 HOUR))
        FROM map_reports
        WHERE ip_hash = :ip_hash
            AND report_mode <> 'change'
            AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)";
}

// 0 means "unknown" -- no row, an unusable value, or a window that has already passed. Everything else
// is capped at the window, so a wrong clock cannot promise a wait longer than the limit itself lasts.
//
// ⚠️ Rounded UP to a whole minute on purpose. The raw value is CURRENT_TIMESTAMP subtracted from the
// oldest counted report, so a second-precise answer hands the caller that report's timestamp back to
// the second. The reader is told minutes anyway, so the precision bought nothing and told something.
function avesmapsReportClampRetryAfterSeconds(mixed $rawSeconds): int {
    if (!is_numeric($rawSeconds)) {
        return 0;
    }

    $seconds = (int) ceil((float) $rawSeconds);
    if ($seconds <= 0) {
        return 0;
    }

    return min((int) ceil($seconds / 60) * 60, AVESMAPS_REPORT_RATE_LIMIT_WINDOW_SECONDS);
}

// The sentence a rate-limited reporter reads. It has one job the old silent 200 could not do: say
// plainly that this report was NOT accepted, and that what was typed is still there.
function avesmapsReportRateLimitMessage(int $retryAfterSeconds): string {
    $wait = $retryAfterSeconds <= 0
        ? 'einer Stunde'
        : avesmapsReportFormatWaitPhrase($retryAfterSeconds);

    // ⚠️ "Von dieser Verbindung aus", not "from this address" and not "from this network": the bucket
    // keys on one hashed address, but behind a shared NAT that address is a whole household or campus,
    // so naming either mechanism would be wrong for half the readers. And it names the LIMIT, never a
    // count -- the check is >= 5, so the actual number of reports may be higher.
    return 'Von dieser Verbindung aus sind '
        . AVESMAPS_REPORT_RATE_LIMIT_PER_HOUR
        . ' Meldungen pro Stunde moeglich, und die sind gerade aufgebraucht. Diese Meldung wurde deshalb'
        . ' nicht angenommen. Bitte in '
        . $wait
        . ' noch einmal senden - der Text bleibt so lange im Formular stehen.';
}

function avesmapsReportFormatWaitPhrase(int $retryAfterSeconds): string {
    $minutes = max(1, (int) ceil($retryAfterSeconds / 60));

    return $minutes === 1 ? 'einer Minute' : $minutes . ' Minuten';
}
