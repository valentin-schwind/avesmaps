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
    string $reviewNote
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
            'review_note' => $reviewNote,
        ]),
    ];
}

function avesmapsEncodeReportModerationSnapshot(array $snapshot): string {
    return (string) json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
