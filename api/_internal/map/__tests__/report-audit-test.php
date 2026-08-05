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

// --- 💣 A missing review note is NULL, and NULL is the normal case ----------------------------------
//
// avesmapsNormalizeReviewNote() answers NULL for an empty note, and no client sends the field at all.
// Under strict_types=1 a plain `string` parameter turns that into a TypeError thrown AT THE CALL SITE,
// where the caller's own catch cannot reach it -- so the endpoint answered 500 on every approve, reject
// and defer, AFTER the decision had already been written. That is exactly how A4 shipped on 2026-08-05,
// with this test green, because it only ever passed a string.
$withoutNote = avesmapsBuildReportModerationAuditSnapshots(
    ['id' => 7, 'name' => 'Ohne Notiz', 'status' => 'neu'],
    'map_reports',
    'approved',
    null
);
$withoutNoteAfter = json_decode($withoutNote['after'], true);
assert($withoutNoteAfter['review_note'] === '', 'a missing note is an empty string, never a TypeError');
assert($withoutNoteAfter['status'] === 'approved', 'and the decision is still recorded');

// The same, asserted at the signature so a future edit cannot quietly narrow it back.
$builderParams = (new ReflectionFunction('avesmapsBuildReportModerationAuditSnapshots'))->getParameters();
assert($builderParams[3]->allowsNull(), 'the review note parameter accepts null');

// 💣 The audit writer must accept a NULL feature id. A moderation decision is about no map object, and
// narrowing this back to `int` makes every write a TypeError -- caught, logged, and silently dead, with
// the rest of this file still green. Asserted through reflection rather than text: it is the behaviour
// that matters, not the spelling.
$writerParams = (new ReflectionFunction('avesmapsWriteMapAuditLog'))->getParameters();
assert($writerParams[1]->getName() === 'featureId', 'the second parameter is the feature id');
assert($writerParams[1]->allowsNull(), 'and it accepts null, or no moderation decision can be logged');

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
    'four occurrences: the definition plus three call sites -- update_status, the citymap claim and the '
        . 'fundort claim. The last two set status=approved themselves and consumed a report silently '
        . 'before A4'
);
// 💣 The signature the endpoint declares, not the one the library declares. This is the exact spelling
// that answered 500 on every moderation decision when it read `string $reviewNote`.
assert(
    preg_match('/function avesmapsLogReportModeration\(.*?\?string \$reviewNote/s', $endpointSource) === 1,
    'the endpoint helper accepts a NULL review note -- a plain string is a TypeError at the call site, '
        . 'outside its own catch, on a decision that has already taken effect'
);
assert(
    str_contains($endpointSource, "require_once __DIR__ . '/../../_internal/map/report-audit.php';"),
    'the endpoint loads this library rather than carrying its own copy of the action names'
);
// The trail is written AFTER the report is updated, and a failure to write it must not undo the
// decision: the caller catches, because the row is already changed at that point and a 500 would send
// the reviewer into a retry that then answers 404 on the `status = 'neu'` guard.
// ⚠️ Anchored on the function BODY, not on "somewhere after the signature": the file's top-level
// dispatch also contains `catch (Throwable`, and a loose pattern would pass on whichever happened to
// come first in the file.
$moderationBody = null;
if (preg_match('/function avesmapsLogReportModeration\(.*?\)\s*:\s*void\s*\{(.*?)\n\}/s', $endpointSource, $bodyMatch) === 1) {
    $moderationBody = $bodyMatch[1];
}
assert(is_string($moderationBody), 'the writer is a void function whose body can be isolated');
assert(
    str_contains($moderationBody, 'catch (Throwable'),
    'a trail that cannot be written must not undo a decision that already happened'
);
assert(
    str_contains($moderationBody, 'avesmapsWriteMapAuditLog($pdo, null,'),
    'and it writes a NULL feature id, because a decision is about no map object'
);


// ===== ONE STATUS VOCABULARY, FOR BOTH DOORS ======================================================
//
// 💣 Finding A33: api/import/location-reports/update-status.php cut the incoming status to 20
// characters and wrote it. No whitelist at all -- while the editor endpoint next door checked
// against a literal list of three. A typo in the import tool therefore stored a status no surface
// in the project knows; the report then appears under "Bearbeitet" (that list asks for
// status <> 'neu'), wearing a label nobody chose, and A32 means it cannot be moved back.
$expectedStatuses = ['approved', 'rejected', 'in_review'];
$actualStatuses = avesmapsReportModerationStatuses();
sort($expectedStatuses);
sort($actualStatuses);
assert($actualStatuses === $expectedStatuses, 'the three statuses a moderation path may set');
// ⚠️ The assert that used to stand here compared avesmapsReportModerationStatuses() against
// array_keys(AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS) -- which is what the function RETURNS. It was
// a tautology and could never go red. The literal list above is the one with teeth; this is what it
// was meant to say, expressed so it can actually fail:
$sortedStatuses = avesmapsReportModerationStatuses();
$sortedActions = array_keys(AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS);
sort($sortedStatuses);
sort($sortedActions);
assert($sortedStatuses === $sortedActions, 'settable and audited name the same set');
// ⚠️ Compared as SETS. The order inside the audit map carries no meaning, and an assert that goes
// red when someone reorders it teaches people to edit the test instead of reading it.
foreach (avesmapsReportModerationStatuses() as $status) {
    assert(
        avesmapsReportModerationAuditAction($status) !== '',
        "every settable status writes an audit action ({$status})"
    );
}

assert(avesmapsReportModerationStatusIsAllowed('approved'), 'approved passes');
assert(avesmapsReportModerationStatusIsAllowed('in_review'), 'in_review passes -- a deferred report is a decision too');
assert(!avesmapsReportModerationStatusIsAllowed('erledigt'), 'a plausible German synonym is not a status');
assert(!avesmapsReportModerationStatusIsAllowed('APPROVED'), 'the comparison is strict, not case-folded');
assert(!avesmapsReportModerationStatusIsAllowed(''), 'and empty is not one either');
// ⚠️ 'neu' is the state a report ARRIVES in, not one a moderator chooses. Whether a decided report
// may go back to it is finding A32 and an open owner question -- this assert is the marker for it.
assert(!avesmapsReportModerationStatusIsAllowed('neu'), "'neu' is not settable (see A32)");

// --- Both endpoints must actually use it ----------------------------------------------------------
//
// 💣 Asserting the library alone proves nothing about what ships: this project has already had a
// green test sitting on top of a live bug for exactly that reason.
$importSource = file_get_contents(__DIR__ . '/../../../import/location-reports/update-status.php');
assert(is_string($importSource) && $importSource !== '', 'the import endpoint is readable');
assert(
    str_contains($importSource, "require_once __DIR__ . '/../../_internal/map/report-audit.php';"),
    'the import endpoint loads the vocabulary'
);
// 💣 THE WHOLE CONDITION, not just the call. A `false &&` in front leaves the name present and still
// positioned before the write, while the gate never fires -- verified: that exact mutation passed an
// earlier version of this assert. Position is not effect, and this project has now been caught by
// that three times.
assert(
    str_contains($importSource, 'if (!avesmapsReportModerationStatusIsAllowed($newStatus)) {'),
    'and gates the incoming status on it -- with the condition intact'
);
// The gate has to come BEFORE the write, or it is decoration.
$gateAt = strpos($importSource, 'if (!avesmapsReportModerationStatusIsAllowed($newStatus)) {');
$writeAt = strpos($importSource, 'UPDATE location_reports');
assert(is_int($gateAt) && is_int($writeAt) && $gateAt < $writeAt, 'the status is checked before anything is written');

// 💣 And it has to REFUSE, not merely notice. An adversarial pass replaced avesmapsErrorResponse
// with error_log inside the gate and every assert here stayed green: the call was present, the
// position right, and the write happened anyway. avesmapsErrorResponse is `: never`, so naming it
// inside the block is what makes the gate terminal.
$gateBlock = substr($importSource, $gateAt, $writeAt - $gateAt);
assert(
    str_contains($gateBlock, 'avesmapsErrorResponse('),
    'the gate answers and stops -- it does not log and carry on'
);

// 💣 And the value that was checked has to be the value that gets written. Reassigning $newStatus
// between the two -- re-reading it from the payload, say -- leaves every assertion above true while
// the check applies to something the database never sees. Also caught green once.
assert(
    !preg_match('/\$newStatus\s*=[^=]/', $gateBlock),
    'nothing reassigns $newStatus between the check and the write'
);
// ⚠️ The accepted values are named in the answer: this endpoint replies to a machine whose operator
// reads a log, and "ungueltig" alone sends them to the source to find out what is valid.
assert(
    str_contains($importSource, "implode(', ', avesmapsReportModerationStatuses())"),
    'the refusal names what would have been accepted'
);

$editorSource = file_get_contents(__DIR__ . '/../../../edit/reports/locations.php');
assert(is_string($editorSource) && $editorSource !== '', 'the editor endpoint is readable');
assert(
    str_contains($editorSource, 'if (!avesmapsReportModerationStatusIsAllowed($newStatus)) {'),
    'the editor endpoint uses the shared list too -- with the condition intact'
);
// ⚠️ Matched by SHAPE, not by one spelling. The first version of this assert compared against a
// single literal string, so the same list with double quotes, other spacing or another order slipped
// straight past it -- verified.
assert(
    preg_match('/[\'"]approved[\'"]\s*,\s*[\'"]rejected[\'"]/', $editorSource) !== 1
        && preg_match('/[\'"]rejected[\'"]\s*,\s*[\'"]approved[\'"]/', $editorSource) !== 1
        && preg_match('/[\'"]in_review[\'"]\s*,\s*[\'"]approved[\'"]/', $editorSource) !== 1,
    'and keeps no second copy of it in any spelling -- the copy IS the finding'
);

// ⚠️ WHAT THIS FILE STILL CANNOT SAY, written down rather than left to be discovered again.
//
// 💣 The import endpoint writes NO audit entry at all -- no avesmapsLogReportModeration, no
// avesmapsWriteMapAuditLog. So "settable implies audited", which is how the shared list was
// justified, is true of the editor door and NOT of the one this list was added to. With a valid
// token a report can still be moved to approved/rejected/in_review leaving no trace, which is A4
// through the other door. Its UPDATE also lacks the `AND status = 'neu'` guard the editor carries in
// three places, so an already decided report can be silently overwritten. Filed as A39; this assert
// is the marker, and it is meant to be INVERTED when that lands, not deleted.
assert(
    !str_contains($importSource, 'avesmapsLogReportModeration'),
    'the import door still writes no audit entry (A39) -- flip this assert when it does'
);

// --- 💣 A39, the half that needed no decision: no overwriting a decision already made -------------
//
// The editor guards every write path with `AND status = 'neu'`; the import door did not, so a token
// could move an approved report to rejected -- silently, without reviewed_by, review_note or any
// audit entry. Each assertion below names the mutation it exists to catch, and each of those was
// actually run.
$updateAt = strpos($importSource, 'UPDATE location_reports');
$updateEndAt = strpos($importSource, '$statement->execute(', (int) $updateAt);
assert(is_int($updateAt) && is_int($updateEndAt), 'the import UPDATE is where it is expected');
$updateSql = substr($importSource, (int) $updateAt, (int) $updateEndAt - (int) $updateAt);

// Catches: the guard deleted outright.
assert(
    str_contains($updateSql, "AND status = 'neu'"),
    'the import UPDATE only touches a report that is still open'
);
// Catches: the guard weakened to something that matches every row (`status <> ''`, `status LIKE '%'`).
assert(
    preg_match("/WHERE id = :report_id\s*\n\s*AND status = 'neu'/", $updateSql) === 1,
    'and the guard sits in the WHERE next to the id, not somewhere it matches everything'
);
// Catches: the zero-row check removed, which would report success for a row that never changed.
assert(
    str_contains($importSource, '$statement->rowCount() < 1'),
    'zero changed rows is still a refusal, not a success'
);
// ⚠️ Catches: the old message left in place. With the guard, zero rows means EITHER no such report OR
// one that is no longer open -- "nicht gefunden" alone became a lie for the more interesting case,
// and it is the same fact the editor already words honestly.
assert(
    str_contains($importSource, 'bereits verarbeitet oder nicht gefunden'),
    'and the refusal says which two cases it covers'
);
// Catches: the editor losing its own guard, which is what the import door was measured against.
assert(
    preg_match("/WHERE id = :report_id\s*\n\s*AND status = 'neu'/", $editorSource) === 1,
    'the editor still carries the guard this was mirrored from'
);

echo "report-audit ok\n";
