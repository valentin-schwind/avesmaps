<?php

declare(strict_types=1);

// The Übernahme-Vorschau, editor side: read the plan a sync computed, tick what may happen, apply it.
// Design: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md, session 1 (city maps).
//
// One door for all nine syncs -- 'kind' says which. Session 1 fills 'citymap'; sessions 2-4 add
// adventures, publications, occurrences, ways/regions/places and territories without touching this
// dispatcher beyond the two match arms at the bottom.
//
// 🔴 CAPABILITY 'edit', DELETIONS INCLUDED (owner decision 2026-08-06, design §10.1). The hand-delete
// path (api/edit/map/citymaps.php -> avesmapsDeleteCitymap) removes the very same card immediately,
// behind a single browser confirm, and has been an 'edit' action all along. This way round is the more
// careful of the two -- a preview, a second explicit confirmation, an audit row and a permanent
// keep-decision -- so gating it harder than the fast path would lock the slow door and leave the quick
// one open. 'admin' exists (3 endpoints) but almost nobody holds it; deletions would simply pile up.

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync-plan.php';
// The pipeline lock: 'apply' is a real production write, so it takes the same single-flight lock the
// dump actions take. Reading and ticking do not -- they write nothing anyone else could lose.
require_once __DIR__ . '/../../_internal/wiki/dump-lock.php';
// The citymap apply half + everything it calls at runtime (the reconcile writer, the live tables, the
// shared place resolver, the source catalogue). Same chain the dump endpoint assembles for its own
// citymap actions -- see __tests__/citymap-sync-test.php, which asserts that nothing is missing.
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/feature-sources.php';
require_once __DIR__ . '/../../_internal/app/adventure-resolve.php';
require_once __DIR__ . '/../../_internal/app/citymaps.php';
require_once __DIR__ . '/../../_internal/wiki/publication-parsing.php';
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';
require_once __DIR__ . '/../../_internal/wiki/citymap-sync.php';
require_once __DIR__ . '/../../_internal/wiki/citymap-plan-apply.php';

/** The syncs that have a preview. Grows one entry per session (design §7). */
const AVESMAPS_SYNC_PLAN_KINDS = ['citymap'];

/**
 * One plan row, shaped for the component. The JSON columns are decoded HERE so the client never
 * parses a string out of a string.
 */
function avesmapsSyncPlanPresentItem(array $row): array
{
    $decode = static function ($value): array {
        if ($value === null || $value === '') {
            return [];
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : [];
    };

    return [
        'id' => (int) $row['id'],
        'entity_key' => (string) $row['entity_key'],
        'change_type' => (string) $row['change_type'],
        'label' => (string) $row['label'],
        'before' => $decode($row['before_json'] ?? null),
        'after' => $decode($row['after_json'] ?? null),
        'override' => $decode($row['override_json'] ?? null),
        'selected' => (int) $row['selected'] === 1,
        // The decision rides along so the row can show "⤴ 3× übersprungen" without a second request.
        'skipped_count' => (int) ($row['skipped_count'] ?? 0),
        'last_skipped_at' => (string) ($row['last_skipped_at'] ?? ''),
    ];
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not use the sync-plan endpoint.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only POST is allowed for the sync-plan endpoint.');
    }

    // ⚠️ The capability check stands BEFORE the body is read, so an anonymous caller gets 401 rather
    // than 400 -- and so the probe that proves it can tell the two apart (see the note in
    // docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-1.md, task 5).
    $currentUser = avesmapsRequireUserWithCapability('edit');
    $userId = (int) ($currentUser['id'] ?? 0);
    $username = (string) ($currentUser['username'] ?? '');

    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);
    $kind = avesmapsNormalizeSingleLine((string) ($payload['kind'] ?? ''), 24);
    if (!in_array($kind, AVESMAPS_SYNC_PLAN_KINDS, true)) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unknown sync kind.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $lockHeldByThisRequest = false;

    switch ($action) {
        case 'get':
            // 💣 NO DDL ON THIS PATH. The preview is opened far more often than a sync runs, and DDL on
            // a read path is the mistake territories-endpoint.php still pays for (AGENTS.md §10). A
            // missing table simply means "no plan yet" -- which is the truthful answer before the first
            // sync has ever run, and it keeps this branch testable without a live database.
            try {
                $run = avesmapsSyncPlanOpenRun($pdo, $kind);
            } catch (PDOException $exception) {
                if ((string) $exception->getCode() !== '42S02') {
                    throw $exception;
                }
                $run = null;
            }
            if ($run === null) {
                avesmapsJsonResponse(200, ['ok' => true, 'run' => null]);
            }

            $runId = (int) $run['id'];
            $counts = json_decode((string) ($run['counts_json'] ?? ''), true);
            $counts = is_array($counts) ? $counts : ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];

            $items = [];
            $truncated = [];
            foreach (AVESMAPS_SYNC_PLAN_CHANGE_TYPES as $changeType) {
                $rows = avesmapsSyncPlanItems($pdo, $runId, $kind, $changeType, AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT);
                $items[$changeType] = array_map('avesmapsSyncPlanPresentItem', $rows);
                // The cap is on what is SHOWN, never on what exists: the hidden rows keep their tick,
                // so "alle übernehmen" reaches them. The number says so out loud (design §10.2).
                $truncated[$changeType] = max(0, (int) ($counts[$changeType] ?? 0) - count($rows));
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'run' => [
                    'id' => $runId,
                    'state' => (string) $run['state'],
                    'created_at' => (string) $run['created_at'],
                    'source_stamp' => (string) ($run['source_stamp'] ?? ''),
                    'counts' => $counts,
                ],
                'items' => $items,
                'truncated' => $truncated,
                'category_limit' => AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT,
                'declined_count' => count(avesmapsSyncPlanDeclinedKeys($pdo, $kind)),
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'select':
            // Ticking writes straight through, which is what makes "Später" work: the list is left
            // lying about WITH the ticks, and nothing was written to the live tables anyway (design §2).
            $runId = (int) ($payload['run_id'] ?? 0);
            $run = $runId > 0 ? avesmapsSyncPlanRunById($pdo, $runId) : null;
            if ($run === null || (string) $run['kind'] !== $kind) {
                avesmapsErrorResponse(404, 'not_found', 'This plan does not exist.');
            }
            if ((string) $run['state'] !== 'open') {
                // An applied or superseded plan's ticks are history, not a control.
                avesmapsErrorResponse(409, 'plan_not_open', 'This plan can no longer be changed.');
            }

            $ids = isset($payload['ids']) && is_array($payload['ids']) ? $payload['ids'] : null;
            $changeType = isset($payload['change_type'])
                ? avesmapsNormalizeSingleLine((string) $payload['change_type'], 8)
                : null;
            $selected = ($payload['selected'] ?? false) === true ? 1 : 0;
            $changed = avesmapsSyncPlanSetSelection($pdo, $runId, $ids, $changeType, $selected);

            avesmapsJsonResponse(200, [
                'ok' => true,
                'changed' => $changed,
                'selected_deletions' => avesmapsSyncPlanSelectedDeletionCount($pdo, $runId),
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'apply':
            $runId = (int) ($payload['run_id'] ?? 0);
            $run = $runId > 0 ? avesmapsSyncPlanRunById($pdo, $runId) : null;
            if ($run === null || (string) $run['kind'] !== $kind) {
                avesmapsErrorResponse(404, 'not_found', 'This plan does not exist.');
            }
            if ((string) $run['state'] !== 'open') {
                avesmapsErrorResponse(409, 'plan_not_open', 'This plan has already been applied or replaced.');
            }

            // 🔴 THE SECOND CONFIRMATION IS A SERVER RULE, NOT A DISABLED BUTTON. A greyed-out button is
            // a suggestion: it lives in the one place an editor cannot be held to. Every step of the
            // apply asks again, so a client that skips the checkbox -- or a second tab, or a replayed
            // request -- gets 400 rather than a deletion.
            if (
                avesmapsSyncPlanSelectedDeletionCount($pdo, $runId) > 0
                && ($payload['confirm_delete'] ?? false) !== true
            ) {
                avesmapsErrorResponse(
                    400,
                    'delete_not_confirmed',
                    'Ticked deletions need the explicit second confirmation.'
                );
            }

            // A real production write -> single-flight, like every other write on this pipeline.
            avesmapsWikiDumpLockAcquireOrThrow($pdo, $userId, $username, 'apply_sync_plan');
            $lockHeldByThisRequest = true;

            $step = match ($kind) {
                'citymap' => avesmapsCitymapApplyStep($pdo, $runId, $userId, $currentUser),
            };
            $done = ($step['done'] ?? false) === true;

            avesmapsWikiDumpLockHeartbeat($pdo, $userId, 'apply_sync_plan');
            if ($done) {
                avesmapsWikiDumpLockRelease($pdo, $userId);
                $lockHeldByThisRequest = false;
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'done' => $done,
                // Per-STEP deltas; the client sums them for the run total.
                'applied' => (int) ($step['applied'] ?? 0),
                'deleted' => (int) ($step['deleted'] ?? 0),
                // Rows the world moved on from between preview and Übernahme -- left standing, named
                // afterwards (design §4a).
                'stale' => (int) ($step['stale'] ?? 0),
                'processed' => (int) ($step['processed'] ?? 0),
                'remaining' => (int) ($step['remaining'] ?? 0),
                'skipped' => (int) ($step['skipped'] ?? 0),
                'declined' => (int) ($step['declined'] ?? 0),
            ]);
            // no break -- avesmapsJsonResponse exits.

        case 'declined':
            // ⚠️ A permanent decision nobody can look at any more is a black hole (design §5).
            try {
                $list = avesmapsSyncPlanDeclinedList($pdo, $kind, AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT);
            } catch (PDOException $exception) {
                if ((string) $exception->getCode() !== '42S02') {
                    throw $exception;
                }
                $list = [];
            }
            avesmapsJsonResponse(200, ['ok' => true, 'declined' => $list]);
            // no break -- avesmapsJsonResponse exits.

        case 'undecline':
            $keys = isset($payload['entity_keys']) && is_array($payload['entity_keys'])
                ? $payload['entity_keys']
                : [];
            avesmapsEnsureSyncPlanTables($pdo);
            avesmapsJsonResponse(200, [
                'ok' => true,
                'cleared' => avesmapsSyncPlanUndecline($pdo, $kind, $keys),
            ]);
            // no break -- avesmapsJsonResponse exits.

        default:
            avesmapsErrorResponse(400, 'invalid_request', 'Unknown sync-plan action.');
    }
} catch (WikiDumpLockBusyException $busy) {
    // Another editor holds the pipeline. 409 + machine code, so the client loop stops gracefully
    // instead of spinning. This request never held the lock (it lost the race).
    avesmapsErrorResponse(409, 'dump_locked', $busy->getMessage());
} catch (InvalidArgumentException $exception) {
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $userId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (Throwable $error) {
    // Any failure mid-apply releases the lock so a crash cannot wedge the pipeline, and answers with
    // the generic server envelope -- never getMessage(), which is finding M1 next door.
    if (isset($pdo, $lockHeldByThisRequest) && $lockHeldByThisRequest) {
        try { avesmapsWikiDumpLockRelease($pdo, $userId); } catch (Throwable) { /* best-effort */ }
    }
    avesmapsServerErrorResponse($error, 'sync-plan');
}
