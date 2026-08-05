<?php

declare(strict_types=1);

// The trail a moderation decision leaves behind. Pure: this builds the action name and the two JSON
// snapshots; the caller writes them with avesmapsWriteMapAuditLog() (api/_internal/map/features.php),
// into the SAME map_audit_log every other editor action goes into. Approving, rejecting and deferring a
// community report used to leave no trace at all -- on a map that carries 11.500 objects from community
// contributions, "who decided this, and why" was simply not answerable (finding A4).
//
// 💣 THESE ENTRIES MUST NEVER BECOME UNDOABLE. They carry feature_id = NULL and there is nothing to take
// back: what an approval PRODUCED (a point, a citymap) writes its own audit entry, and that one is the
// undoable one. avesmapsCanUndoAuditAction() already answers no to these three names -- they are neither
// a create action, nor delete_feature, nor do they carry undo columns -- but the unit test asserts it
// rather than trusting it, because a future name beginning with "create" would flip the answer silently
// and Ctrl+Z walks the history DOWNWARDS, across users.
const AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS = [
    'approved' => 'report_approved',
    'rejected' => 'report_rejected',
    'in_review' => 'report_in_review',
];

// 💣 The allowlist is the point of this file. The moderation path has the WHOLE report row in hand --
// including ip_hash, remote_ip, user_agent and request_origin. Copying a row into an audit table is
// exactly how personal data ends up somewhere nobody remembers to look: map_audit_log is read by a
// different endpoint, keeps 200 entries, and rides along in every database backup. Only what answers
// "which report, and what was decided" travels; everything else stays in map_reports.
const AVESMAPS_REPORT_MODERATION_AUDIT_FIELDS = [
    'id',
    'name',
    'reporter_name',
    'report_type',
    'report_subtype',
    'report_mode',
    'entity_type',
    'entity_public_id',
];

// Which statuses a moderation path may set. 💣 DERIVED from the audit map above, never written
// out a second time -- and that is the whole design, not tidiness. A status that can be SET but
// has no audit action would be a moderation decision that leaves no trace, which is finding A4
// reopened; a status with an action but no way to set it would be dead vocabulary. Deriving one
// from the other makes both impossible.
//
// ⚠️ 'neu' is deliberately absent: it is the state a report ARRIVES in, not one a moderator
// chooses. Whether a decided report can be put back to 'neu' is finding A32 and an open owner
// question -- if it is ever answered yes, the entry belongs in the audit map above and appears
// here by itself.
function avesmapsReportModerationStatuses(): array {
    return array_keys(AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS);
}

function avesmapsReportModerationStatusIsAllowed(string $status): bool {
    return in_array($status, avesmapsReportModerationStatuses(), true);
}

function avesmapsReportModerationAuditAction(string $status): string {
    return AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS[$status] ?? '';
}

/**
 * The before/after pair for one moderation decision, JSON-encoded and ready for the audit writer.
 *
 * @return array{before: string, after: string}
 */
function avesmapsBuildReportModerationAuditSnapshots(
    array $reportRow,
    string $reportSource,
    string $newStatus,
    // 💣 ?string. avesmapsNormalizeReviewNote() answers NULL for an empty note, and no client sends the
    // field at all -- under strict_types=1 a plain `string` here is a TypeError thrown at the call site,
    // where no catch of this file's can reach it. That is how A4 shipped a 500 on every moderation
    // decision, after the decision had already taken effect.
    ?string $reviewNote
): array {
    $identity = [];
    foreach (AVESMAPS_REPORT_MODERATION_AUDIT_FIELDS as $field) {
        if (!array_key_exists($field, $reportRow) || $reportRow[$field] === null) {
            continue;
        }
        $identity[$field] = is_scalar($reportRow[$field]) ? (string) $reportRow[$field] : '';
    }
    // report_id under its own name as well: the audit reader hands 'id' to the audit ROW, so a consumer
    // reading after_json needs an unambiguous key for the report it describes.
    $identity['report_id'] = (string) ($reportRow['id'] ?? '');
    $identity['report_source'] = $reportSource;

    return [
        'before' => avesmapsEncodeReportModerationSnapshot($identity + [
            'status' => (string) ($reportRow['status'] ?? 'neu'),
            'review_note' => (string) ($reportRow['review_note'] ?? ''),
        ]),
        'after' => avesmapsEncodeReportModerationSnapshot($identity + [
            'status' => $newStatus,
            'review_note' => (string) $reviewNote,
        ]),
    ];
}

// ⚠️ JSON_THROW_ON_ERROR, like avesmapsEncodeAuditJson next door. A report name is community-supplied
// text; invalid UTF-8 in it makes json_encode return false, and `(string) false` is '' -- which lands in
// a JSON column as MySQL error 3140 and gets swallowed by the caller's catch. A throw is caught by that
// same catch and says what happened in the log.
function avesmapsEncodeReportModerationSnapshot(array $snapshot): string {
    return json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
