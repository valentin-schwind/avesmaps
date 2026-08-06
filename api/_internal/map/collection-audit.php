<?php

declare(strict_types=1);

// Finding A16: the trail a deletion leaves in the citymap, adventure and lore libraries.
//
// Move a label by three pixels and it is in the change log and can be taken back. Delete an adventure
// (1.352 rows), a citymap (457) or an occurrence (5.104) and it was, until this file existed, simply
// gone -- no entry, no way back, nothing that says who or when. This is stage 1 of
// docs/superpowers/specs/2026-08-06-a16-aenderungsprotokoll-design.md: the three HARD deletions get a
// trail. Stage 2 (the remaining 23 write actions) and stage 3 (an actual undo, which needs a soft
// delete these tables do not have) are their own work.
//
// Built like api/_internal/map/report-audit.php next door (finding A4/A39) and writing into the SAME
// map_audit_log every editor action goes into -- one change log, not a fourth one.
//
// 💣 features.php is required HERE rather than assumed from the caller. report-audit.php gets away with
// assuming it because both its callers are editor endpoints that load it anyway; this library is pulled
// in from inside three delete FUNCTIONS, two of which live in files that public read paths include. An
// assumed dependency would be an undefined function inside the writer's own try/catch: caught, logged,
// and silently traceless -- which is the finding, reintroduced.
require_once __DIR__ . '/features.php';

// 💣 THESE MUST NEVER BECOME UNDOABLE. Stage 1 writes a trail, it does not build a way back: none of
// the three tables has a soft delete, so a "Rückgängig" button would promise something no code can
// deliver. avesmapsCanUndoAuditAction() already answers no -- they are neither in the create LIST, nor
// delete_feature, nor do they carry undo columns -- but the unit test asserts it rather than trusting
// it, because a future name beginning with "create" would flip the answer silently.
//
// Two names for the one occurrence removal on purpose: a wiki row becomes a tombstone that "Ort wieder
// aufnehmen" can undo, a manual row is deleted outright. Whether there is a way back is the question
// A16 exists for; one shared name would hide the answer in the JSON.
//
// 'apply_sync_plan' joined on 2026-08-06 and is the odd one out: not a deletion but a whole
// Übernahme-Vorschau being confirmed, ONE row per run (see avesmapsLogSyncPlanApply at the bottom of
// this file for why it must never be one per entry). It is in this list, and therefore under the same
// no-undo rule, for the same reason as its neighbours: the Übernahme has no way back either -- that is
// A16 stage 3 and needs a soft delete these tables do not have.
const AVESMAPS_COLLECTION_AUDIT_ACTIONS = [
    'delete_citymap',
    'delete_adventure',
    'delete_lore_place',
    'suppress_lore_place',
    'apply_sync_plan',
];

// 💣 THE KEYS THAT WOULD TURN AN HONEST ENTRY INTO A LYING ONE.
//
// The design warns about feature_id: a citymap id there LEFT JOINs onto an unrelated map object,
// because the id spaces are separate and the numbers overlap. It stays NULL. But the reader
// (avesmapsNormalizeAuditRow, api/edit/map/audit-log.php:109-111) also lifts `public_id`,
// `feature_type` and `feature_subtype` OUT OF after_json when that join finds nothing -- and a citymap
// public_id landing there makes renderChangeLog treat the row as focusable. The editor then gets a
// button that answers "Objekt ist nicht mehr aktiv oder wurde noch nicht neu geladen." for a deletion
// that worked perfectly. That is the false error A4 wrote its "Nur was sich zeigen lässt, ist ein
// Knopf" comment about, arriving through the back door.
//
// geometry_json is in the list for the same reason: avesmapsBuildAuditFocusTarget reads it and would
// build a map position for something that has none.
//
// The identity travels under its own name instead -- citymap_public_id, adventure_public_id,
// lore_entry_key -- and these are dropped whatever a caller passes.
const AVESMAPS_COLLECTION_AUDIT_RESERVED_KEYS = ['public_id', 'feature_type', 'feature_subtype', 'geometry_json'];

// 💣 The note for a deletion that no person made. Nothing passes NULL today (all three doors sit behind
// the editor login), but the wiki citymap sync deletes citymaps through its own path
// (api/_internal/wiki/citymap-sync.php) and is the obvious next caller. A signature that cannot say "it
// was not a person" is exactly how the import door in A39 ended up writing "unbekannt" about a human
// who never existed.
const AVESMAPS_COLLECTION_AUDIT_ACTOR_SYSTEM = 'system';

/** How many deleted titles the single Übernahme row names before it says "und N weitere". */
const AVESMAPS_COLLECTION_AUDIT_TITLE_LIMIT = 20;

/** What the Übernahme row calls the sync it belongs to. Grows with session 2-4 (design §7). */
const AVESMAPS_COLLECTION_AUDIT_KIND_LABELS = [
    'citymap' => 'Stadtkarten',
    'adventure' => 'Abenteuer',
    'publication' => 'Publikationsquellen',
    'lore' => 'Vorkommen',
    'territory_wiki' => 'Wiki-Kopie der Herrschaftsgebiete',
    'territory' => 'Herrschaftsgebiete',
];

/**
 * What the deletions of THIS sync are called.
 *
 * ⚠️ Not decoration. For the Vorkommen a "deletion" sets status='retired' and the very next sync can
 * revive it, so "gelöscht" would be the single most misleading word available here -- this log is read
 * months later, by somebody deciding whether something is recoverable. Anything not listed keeps
 * 'gelöscht', because for the other kinds that is exactly what happened.
 */
const AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB = [
    'lore' => 'stillgelegt',
];

function avesmapsCollectionAuditActionIsKnown(string $action): bool
{
    return in_array($action, AVESMAPS_COLLECTION_AUDIT_ACTIONS, true);
}

/**
 * One snapshot, made safe to store: reserved keys dropped, everything cast to a string, nulls and
 * non-scalars left out rather than serialised as "" or "Array".
 *
 * ⚠️ A field list, not the whole row (design §4). map_audit_log is read by another endpoint, keeps 200
 * entries and rides along in every database backup -- what does not answer "which object, and what
 * happened to it" has no business being copied into it. The callers pass named fields for that reason;
 * this function is the second line, not the first.
 *
 * @return array<string,string>
 */
function avesmapsCollectionAuditSnapshot(array $snapshot): array
{
    $clean = [];
    foreach ($snapshot as $key => $value) {
        if (in_array((string) $key, AVESMAPS_COLLECTION_AUDIT_RESERVED_KEYS, true)) {
            continue;
        }
        if ($value === null || !is_scalar($value)) {
            continue;
        }
        $clean[(string) $key] = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
    }

    return $clean;
}

/**
 * The before/after pair for one deletion, JSON-encoded and ready for the audit writer.
 *
 * @return array{before: string, after: string}
 */
function avesmapsBuildCollectionAuditSnapshots(array $before, array $after, string $actorSource): array
{
    $cleanAfter = avesmapsCollectionAuditSnapshot($after);
    // ⚠️ Only in the after. The note says who made THIS change; putting it in the before would blame it
    // for the state that existed earlier.
    if ($actorSource !== '') {
        $cleanAfter['actor_source'] = $actorSource;
    }

    return [
        'before' => avesmapsEncodeCollectionAuditSnapshot(avesmapsCollectionAuditSnapshot($before)),
        'after' => avesmapsEncodeCollectionAuditSnapshot($cleanAfter),
    ];
}

// ⚠️ JSON_THROW_ON_ERROR, like avesmapsEncodeAuditJson. A citymap title is community-supplied text;
// invalid UTF-8 in it makes json_encode return false, and `(string) false` is '' -- which lands in a
// JSON column as MySQL error 3140 and gets swallowed by the caller's catch. A throw is caught by that
// same catch and says what happened in the log.
function avesmapsEncodeCollectionAuditSnapshot(array $snapshot): string
{
    return json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/**
 * One row in map_audit_log per deletion.
 *
 * 💣 Deliberately NOT fatal, and deliberately called AFTER the delete has committed. The row is already
 * gone by the time this runs: a throw here would answer 500 for something that WORKED, and the retry
 * would then answer 404 because the object is no longer there. A missing line in the log is the smaller
 * loss -- the same trade report-audit.php makes, for the same reason.
 *
 * 💣 feature_id is NULL, never 0. A 0 claims a map feature that does not exist and survives into every
 * later query; NULL is what the reader's LEFT JOIN is built for.
 *
 * @param array<string,mixed> $before the object as it stood, identity included
 * @param array<string,mixed> $after  what is left of it, identity included
 * @param array<string,mixed>|null $user NULL means "no human did this" -- see the actor constant above
 */
function avesmapsLogCollectionDeletion(
    PDO $pdo,
    string $action,
    array $before,
    array $after,
    ?array $user
): void {
    // An unknown name writes nothing at all: better no trail than a nameless one that
    // avesmapsCanUndoAuditAction has never been asked about.
    if (!avesmapsCollectionAuditActionIsKnown($action)) {
        return;
    }

    $actorSource = $user === null ? AVESMAPS_COLLECTION_AUDIT_ACTOR_SYSTEM : '';
    $actorUserId = $user === null ? 0 : (int) ($user['id'] ?? 0);

    try {
        $snapshots = avesmapsBuildCollectionAuditSnapshots($before, $after, $actorSource);
        avesmapsWriteMapAuditLog($pdo, null, $action, $actorUserId, $snapshots['before'], $snapshots['after']);
    } catch (Throwable $exception) {
        error_log('avesmaps collection deletion audit failed: ' . $exception->getMessage());
    }
}

/**
 * ONE row per confirmed Übernahme-Vorschau -- never one per entry.
 *
 * 💣 THIS IS THE WHOLE POINT OF THE FUNCTION. map_audit_log keeps 200 entries. An Übernahme with 46
 * deletions writing 46 rows would flush yesterday's own edits out of the log in the same breath in
 * which the sync is confirmed -- the trail A16 added would erase the trail it was added to protect.
 * The detail is not lost: it stays in sync_plan_item, which is not truncated and does not travel in
 * the backup the way this table does.
 *
 * ⚠️ It writes through avesmapsLogCollectionDeletion despite the name. That writer is the right one
 * here for two reasons that have nothing to do with deletion: it drops the keys that would turn the
 * row into a focus button for an object with no map position (see the reserved-key block above), and
 * it never throws -- the Übernahme has already happened by the time this runs.
 *
 * @param array{new?:int,changed?:int,deleted?:int,total?:int} $planned what the preview offered
 * @param array{run_id:int, applied:int, stale:int, skipped:int, declined:int,
 *              deleted_titles:array<int,string>} $result what came of it
 */
function avesmapsLogSyncPlanApply(PDO $pdo, string $kind, array $planned, array $result, ?array $user): void
{
    $titles = array_values(array_filter(array_map('strval', (array) ($result['deleted_titles'] ?? []))));
    $shown = array_slice($titles, 0, AVESMAPS_COLLECTION_AUDIT_TITLE_LIMIT);
    $rest = count($titles) - count($shown);
    $titleLine = implode(' · ', $shown);
    if ($rest > 0) {
        $titleLine .= ' · … und ' . $rest . ' weitere';
    }

    $applied = (int) ($result['applied'] ?? 0);
    // ⚠️ `name` is the one key the reader renders as the entry's TARGET (avesmapsNormalizeAuditRow
    // lifts it out of after_json). Without it the line would read "Unbenannt" -- true of an object,
    // wrong for a run. German, like every other reader-facing string; the keys stay English.
    $name = AVESMAPS_COLLECTION_AUDIT_KIND_LABELS[$kind] ?? $kind;
    $name .= ' · ' . $applied . ' übernommen';
    if (count($titles) > 0) {
        $name .= ', ' . count($titles) . ' ' . (AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB[$kind] ?? 'gelöscht');
    }

    avesmapsLogCollectionDeletion(
        $pdo,
        'apply_sync_plan',
        [
            'kind' => $kind,
            'planned_new' => (int) ($planned['new'] ?? 0),
            'planned_changed' => (int) ($planned['changed'] ?? 0),
            'planned_deleted' => (int) ($planned['deleted'] ?? 0),
        ],
        [
            'name' => $name,
            'kind' => $kind,
            'run_id' => (int) ($result['run_id'] ?? 0),
            'applied' => $applied,
            'deleted' => count($titles),
            'stale' => (int) ($result['stale'] ?? 0),
            'skipped' => (int) ($result['skipped'] ?? 0),
            'declined' => (int) ($result['declined'] ?? 0),
            // Only the deletions are named: they are the irreversible half, and a list of 200 changed
            // titles in a 200-row log is the flood this function exists to prevent.
            'deleted_titles' => $titleLine,
        ],
        $user
    );
}
