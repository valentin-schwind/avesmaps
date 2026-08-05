<?php

declare(strict_types=1);

/**
 * Unit test for the moderation trail of a community report (finding A4). No DB, no HTTP. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/report-audit-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../report-audit.php';
// The undo gate lives here, and it is the reason this file exists.
require __DIR__ . '/../features.php';

// --- 💣 The property that matters most: a moderation entry can never be undone ---------------------
//
// map_audit_log is what Ctrl+Z used to walk, and an undo of "report approved" would mean nothing --
// there is no map object to restore. What an approval PRODUCED writes its own entry, and that one is
// the undoable one. avesmapsCanUndoAuditAction() says no to these names because they are neither a
// create action, nor delete_feature, nor carry undo columns. That is a consequence, not a decision, so
// it is asserted rather than trusted: a future action named "create_report_..." would flip it silently.
foreach (AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS as $status => $action) {
    assert(
        avesmapsCanUndoAuditAction($action) === false,
        "the moderation action {$action} (status {$status}) must never be undoable"
    );
}

// --- The action names -------------------------------------------------------------------------------

assert(avesmapsReportModerationAuditAction('approved') === 'report_approved', 'approved -> report_approved');
assert(avesmapsReportModerationAuditAction('rejected') === 'report_rejected', 'rejected -> report_rejected');
assert(avesmapsReportModerationAuditAction('in_review') === 'report_in_review', 'deferred -> report_in_review');
// An unknown status yields no action -- the caller then writes nothing rather than an entry named "".
assert(avesmapsReportModerationAuditAction('geloescht') === '', 'an unknown status produces no action');
assert(avesmapsReportModerationAuditAction('') === '', 'an empty status produces no action');

// --- 💣 The allowlist: personal data stays in map_reports --------------------------------------------
//
// The moderation path holds the WHOLE report row. map_audit_log is read by a different endpoint, keeps
// 200 rows and travels in every database backup -- copying the row wholesale is how an ip_hash ends up
// somewhere nobody remembers to look.
$reportRow = [
    'id' => 281,
    'name' => 'Ambosshain',
    'reporter_name' => 'Melderin',
    'report_type' => 'location',
    'report_subtype' => 'dorf',
    'report_mode' => 'new',
    'entity_type' => null,
    'entity_public_id' => null,
    'status' => 'neu',
    'review_note' => 'Moegliches Duplikat.',
    // everything below must NOT reach the log
    'ip_hash' => 'c0ffee' . str_repeat('a', 58),
    'remote_ip' => '203.0.113.7',
    'user_agent' => 'Mozilla/5.0 (ZZ-Test)',
    'request_origin' => 'https://avesmaps.de',
    'comment' => 'Bitte diesen Ort aufnehmen, Quelle liegt bei.',
    'lat' => '536.1350',
    'lng' => '457.1250',
];

$snapshots = avesmapsBuildReportModerationAuditSnapshots($reportRow, 'map_reports', 'rejected', 'Keine belastbare Quelle.');
$before = json_decode($snapshots['before'], true);
$after = json_decode($snapshots['after'], true);

foreach (['ip_hash', 'remote_ip', 'user_agent', 'request_origin', 'comment', 'lat', 'lng'] as $forbidden) {
    assert(!array_key_exists($forbidden, $before), "{$forbidden} must not reach the audit log (before)");
    assert(!array_key_exists($forbidden, $after), "{$forbidden} must not reach the audit log (after)");
}
// Belt and braces: the encoded strings must not contain the values either, whatever the key was called.
foreach (['c0ffee', '203.0.113.7', 'Mozilla', 'Quelle liegt bei'] as $needle) {
    assert(!str_contains($snapshots['before'], $needle), "the before snapshot must not carry: {$needle}");
    assert(!str_contains($snapshots['after'], $needle), "the after snapshot must not carry: {$needle}");
}

// --- What the trail must answer: which report, decided how, from what --------------------------------

assert($before['status'] === 'neu', 'the before snapshot keeps the status the report had');
assert($before['review_note'] === 'Moegliches Duplikat.', 'and the note it had');
assert($after['status'] === 'rejected', 'the after snapshot carries the decision');
assert($after['review_note'] === 'Keine belastbare Quelle.', 'and the reason given for it');
assert($after['report_id'] === '281' && $after['report_source'] === 'map_reports', 'the report is identifiable');
// The audit reader falls back to after_json for the displayed name, because the LEFT JOIN finds no
// feature (audit-log.php: `$row['name'] ?? ($after['name'] ?? ...)`). Without this the entry reads
// "Unbenannt" and the log answers "someone decided something".
assert($after['name'] === 'Ambosshain', 'the report name travels, or the change log shows "Unbenannt"');
assert($after['report_type'] === 'location' && $after['report_subtype'] === 'dorf', 'what kind of report it was');
assert($after['reporter_name'] === 'Melderin', 'who filed it');
// Null columns are dropped rather than serialised as empty strings.
assert(!array_key_exists('entity_type', $after), 'a null column is left out, not written as ""');

// A legacy location_reports row has fewer columns; the builder must not care.
$legacy = avesmapsBuildReportModerationAuditSnapshots(
    ['id' => 42, 'name' => 'Altfall', 'status' => 'neu'],
    'location_reports',
    'approved',
    ''
);
$legacyAfter = json_decode($legacy['after'], true);
assert($legacyAfter['report_source'] === 'location_reports', 'the legacy table is named as the source');
assert($legacyAfter['report_id'] === '42' && $legacyAfter['status'] === 'approved', 'and the decision is recorded');
assert(!array_key_exists('report_type', $legacyAfter), 'columns the legacy table lacks are simply absent');

// --- The endpoint must actually call this, on every path that consumes a report ----------------------
//
// 💣 Asserting the library alone proves nothing about what ships -- that lesson cost a green test while
// bug A2 was live (see api/_internal/app/__tests__/report-outcome-test.php). The endpoint is a script,
// so it is read as text and never required.
$endpointSource = file_get_contents(__DIR__ . '/../../../edit/reports/locations.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'the endpoint source must be readable');
assert(
    substr_count($endpointSource, 'avesmapsLogReportModeration(') === 4,
    'three calls plus the definition: update_status, the citymap claim and the fundort claim -- the last '
        . 'two set status=approved themselves and consumed a report silently before A4'
);
assert(
    str_contains($endpointSource, "require_once __DIR__ . '/../../_internal/map/report-audit.php';"),
    'the endpoint loads this library rather than carrying its own copy of the action names'
);
// The trail is written AFTER the report is updated, and a failure to write it must not undo the
// decision: the caller catches, because the row is already changed at that point and a 500 would send
// the reviewer into a retry that then answers 404 on the `status = 'neu'` guard.
assert(
    preg_match('/function avesmapsLogReportModeration\(.*?\)\s*:\s*void\s*\{.*?catch \(Throwable/s', $endpointSource) === 1,
    'a trail that cannot be written must not undo a decision that already happened'
);

echo "report-audit ok\n";
