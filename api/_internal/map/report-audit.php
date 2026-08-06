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

// 💣 WER WAR ES, WENN ES KEIN MENSCH WAR (Befund A39, Owner-Entscheid (b) vom 06.08.2026).
// api/import/location-reports/update-status.php moderiert mit einem Token, und ein Token ist kein
// Benutzer. `actor_user_id` ist eine Zahl mit LEFT JOIN auf `users`; eine 0 findet dort niemanden,
// und die Oberflaeche schrieb dann „unbekannt" -- eine Behauptung ueber einen Menschen, den es nie
// gab. Der Vermerk reist deshalb im `after_json` mit und sagt, was zutrifft: es war der Import.
//
// 🔴 Bewusst KEIN technischer Benutzer und KEINE eigene Aktionsnamen-Familie. Ein Konto „Import"
// waere ein Mensch, den es nicht gibt -- und ein `report_approved_import` haette die Ableitung
// zerschlagen, aus der die setzbaren Status kommen (siehe avesmapsReportModerationStatuses) und
// ausserdem avesmapsCanUndoAuditAction() vor einen unbekannten Namen gestellt.
const AVESMAPS_REPORT_MODERATION_ACTOR_IMPORT = 'import';

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
    ?string $reviewNote,
    // Der Vermerk fuer eine Entscheidung ohne Menschen. Leer = ein Mensch war es (der uebliche Fall);
    // er steht dann in actor_user_id und braucht hier nichts.
    string $actorSource = ''
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

    // ⚠️ Nur im `after`. Der Vermerk beschreibt, WER diese Aenderung gemacht hat -- der Zustand
    // davor hatte damit nichts zu tun, und ihn dort mitzuschreiben hiesse, den Import auch fuer die
    // vorige Entscheidung verantwortlich zu machen.
    $after = [
        'status' => $newStatus,
        'review_note' => (string) $reviewNote,
    ];
    if ($actorSource !== '') {
        $after['actor_source'] = $actorSource;
    }

    return [
        'before' => avesmapsEncodeReportModerationSnapshot($identity + [
            'status' => (string) ($reportRow['status'] ?? 'neu'),
            'review_note' => (string) ($reportRow['review_note'] ?? ''),
        ]),
        'after' => avesmapsEncodeReportModerationSnapshot($identity + $after),
    ];
}

// A4: eine Zeile in map_audit_log je Moderationsentscheidung -- fuer BEIDE Tueren, den Editor und den
// Import (Befund A39). 💣 Bewusst NICHT fatal: eine Spur, die sich nicht schreiben laesst, darf keine
// Entscheidung rueckgaengig machen, die schon passiert ist. An jeder Aufrufstelle ist die Meldung
// bereits aktualisiert; ein Wurf hier antwortete 500 auf einen Klick, der GEWIRKT hat, und der
// Wiederholungsversuch liefe danach in den `AND status = 'neu'`-Riegel und meldete 404. Eine fehlende
// Zeile im Protokoll ist der kleinere Verlust.
//
// 💣 Diese Funktion stand bis zum 06.08.2026 in api/edit/reports/locations.php -- also HINTER der
// Anmeldung, wo der Import sie nicht erreichen konnte. Genau deshalb hatte die Import-Tuer gar keine
// Spur (A39). Sie ist hierher gezogen, weil beide Tueren diese Datei ohnehin laden; das ist dieselbe
// Bewegung wie bei A33, wo der Editor seine private Kopie der Statusliste abgegeben hat.
function avesmapsLogReportModeration(
    PDO $pdo,
    array $reportRow,
    string $reportSource,
    string $newStatus,
    // 💣 ?string, und das Fragezeichen ist die ganze Lehre. avesmapsNormalizeReviewNote() antwortet
    // NULL bei leerer Notiz, und KEIN Client schickt review_note ueberhaupt -- NULL ist also nicht der
    // Sonderfall, sondern jeder Fall. Unter strict_types=1 macht ein `string` daraus einen TypeError
    // AN DER AUFRUFSTELLE, ausserhalb des try unten: die „bewusst nicht fatal"-Bauart laeuft nie, der
    // oberste Handler antwortet 500, und die Meldung ist bereits geaendert. Am 05.08.2026 elf Minuten
    // lang so ausgeliefert.
    ?string $reviewNote,
    // 💣 ?array, und NULL heisst „kein Mensch" -- die Import-Tuer (A39, Owner-Entscheid (b)). Nicht
    // ein leeres Array: das waere ein Benutzer ohne Id und liefe still in dieselbe 0, ohne dass
    // irgendwo stuende, dass es keiner war.
    ?array $user
): void {
    $action = avesmapsReportModerationAuditAction($newStatus);
    if ($action === '') {
        return;
    }

    $actorSource = $user === null ? AVESMAPS_REPORT_MODERATION_ACTOR_IMPORT : '';
    $actorUserId = $user === null ? 0 : (int) ($user['id'] ?? 0);

    try {
        $snapshots = avesmapsBuildReportModerationAuditSnapshots($reportRow, $reportSource, $newStatus, $reviewNote, $actorSource);
        // feature_id NULL, because a moderation decision is not about a map object: the column is
        // nullable, the reader LEFT JOINs, and the name comes out of after_json. NULL and not 0 --
        // 0 would claim a feature that does not exist and would survive into every later query.
        avesmapsWriteMapAuditLog($pdo, null, $action, $actorUserId, $snapshots['before'], $snapshots['after']);
    } catch (Throwable $exception) {
        error_log('avesmaps report moderation audit failed: ' . $exception->getMessage());
    }
}

// ⚠️ JSON_THROW_ON_ERROR, like avesmapsEncodeAuditJson next door. A report name is community-supplied
// text; invalid UTF-8 in it makes json_encode return false, and `(string) false` is '' -- which lands in
// a JSON column as MySQL error 3140 and gets swallowed by the caller's catch. A throw is caught by that
// same catch and says what happened in the log.
function avesmapsEncodeReportModerationSnapshot(array $snapshot): string {
    return json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
