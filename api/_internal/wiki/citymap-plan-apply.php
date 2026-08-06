<?php

declare(strict_types=1);

// The APPLY half of the Kartensammlung sync: it works through the rows an editor ticked in the
// Übernahme-Vorschau and writes exactly those. Design:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §4/§7, session 1.
//
// 💣 IT WRITES BY CALLING THE UNCHANGED avesmapsCitymapReconcileEntity. Not a copy of it, not a
// simplified version: the same override-safe, per-entity-transactional writer the sync has always
// used. The only thing this change moves is WHO decides that it runs -- the catalog before, a tick
// now. Every guarantee that writer carries (never touch manual/community, never resurrect a
// tombstone, never duplicate on a re-run) therefore holds unchanged and needed no re-proving.
//
// It lives in its own file so the compute half can be shown not to reach a writer
// (__tests__/sync-plan-purity-test.php walks the call graph from avesmapsCitymapPlanStep).
//
// Side-effect-free on include: function definitions only. The endpoint loads the rest of the chain.
//
// 💣 The audit library is required HERE rather than assumed from the caller -- the same decision, for
// the same reason, that api/_internal/map/collection-audit.php spells out about features.php. The
// audit writer swallows its own failures on purpose (a lost log line must never fail a write that
// already happened), so an assumed dependency would be an undefined function inside somebody's catch:
// caught, logged, and silently traceless. Which is finding A16, reintroduced.
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * ONE bounded apply step. Resumable: every handled row carries its apply_state, so the next call
 * simply picks up the ones that have none.
 *
 * 💣 NO try/catch AROUND THE ROW, and that is deliberate. A "this one is broken, carry on" catch is
 * exactly the shape finding A21 argued against: the run would move past an entity that was rolled
 * back. Here an exception leaves the loop, the step never returns, the client reports the failure --
 * and because everything already done is marked 'applied', a second click resumes precisely there.
 *
 * @param array<string,mixed>|null $user the editor, for the audit row (NULL = not a person)
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsCitymapApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ DDL first and once, never inside the per-entity transactions below: MySQL commits an open
    // transaction implicitly when it sees DDL.
    avesmapsEnsureCitymapStagingTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    $totals = ['applied' => 0, 'deleted' => 0, 'stale' => 0, 'processed' => 0];

    $catalogFind = $pdo->prepare('SELECT * FROM wiki_citymap_catalog WHERE wiki_key = :wk LIMIT 1');
    $liveFind = $pdo->prepare('SELECT origin, status FROM citymap WHERE wiki_key = :wk LIMIT 1');
    // Read once per step, not per row: an editor could have declined this very deletion by applying
    // another run in between.
    $declined = array_flip(avesmapsSyncPlanDeclinedKeys($pdo, 'citymap'));

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];
        $changeType = (string) $row['change_type'];

        $catalogFind->execute(['wk' => $wikiKey]);
        $catalog = $catalogFind->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($changeType === 'deleted') {
            $liveFind->execute(['wk' => $wikiKey]);
            $live = $liveFind->fetch(PDO::FETCH_ASSOC) ?: null;

            // Four ways a deletion can have stopped being the right answer since the plan was made.
            $refusal = '';
            if ($catalog !== null) {
                $refusal = 'Die Karte steht wieder im Dump.';
            } elseif (isset($declined[$wikiKey])) {
                $refusal = 'Die Loeschung wurde inzwischen abgelehnt.';
            } elseif ($live === null) {
                $refusal = 'Die Karte ist bereits weg.';
            } elseif ((string) $live['origin'] !== 'wiki' || (string) $live['status'] !== 'approved') {
                $refusal = 'Die Karte wurde inzwischen von Hand bearbeitet.';
            }
            if ($refusal !== '') {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $refusal);
                $totals['stale']++;
            } elseif (avesmapsCitymapDeleteWikiRow($pdo, $wikiKey)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['deleted']++;
            } else {
                // The origin guard on the DELETE itself refused -- the second safeguard, and the only
                // one that can still fire after the four checks above.
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Riegel am Loeschen hat abgelehnt.');
                $totals['stale']++;
            }
        } elseif ($catalog === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Im Dump nicht mehr enthalten.');
            $totals['stale']++;
        } else {
            // 💣 THE RE-CHECK (design §4a). A plan may lie around for days; between computing and
            // applying, somebody can edit the card by hand or a new dump can arrive. Recomputed with
            // the SAME function that built the row, so "unchanged" really means unchanged.
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsCitymapPlanForCatalogRow($pdo, $catalog);
            $freshAfter = $fresh['item']['after'] ?? null;
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $freshAfter)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                avesmapsCitymapReconcileEntity($pdo, $catalog, $userId);
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['applied']++;
            }
        }

        if (microtime(true) >= $deadline) {
            break;
        }
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];

    if ($done) {
        $closing = avesmapsCitymapApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        'deleted' => $totals['deleted'],
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Everything that happens ONCE, after the last ticked row: the durable decisions, the run's state,
 * the three closing acts the old reconcile step used to do, and the single audit row.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsCitymapApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array
{
    $planned = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $run = avesmapsSyncPlanRunById($pdo, $runId);
    if ($run !== null) {
        $decoded = json_decode((string) ($run['counts_json'] ?? ''), true);
        if (is_array($decoded)) {
            $planned = array_merge($planned, $decoded);
        }
    }

    // What was left unticked, and what was taken. The three statements below ARE design §2:
    //   an unticked change  -> counted, comes back next run with its counter
    //   an unticked deletion -> declined for good, but the row stays origin='wiki'
    //   an applied change    -> its counter is forgotten, or the tag would lie about it forever
    $stmt = $pdo->prepare(
        'SELECT entity_key, change_type, selected, apply_state FROM sync_plan_item WHERE run_id = :r'
    );
    $stmt->execute(['r' => $runId]);
    $skipped = 0;
    $declined = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['entity_key'];
        $type = (string) $row['change_type'];
        $isSelected = (int) $row['selected'] === 1;
        $applied = (string) ($row['apply_state'] ?? '') === 'applied';

        if (!$isSelected && $type === 'changed') {
            avesmapsSyncPlanRecordSkip($pdo, 'citymap', $key, $userId);
            $skipped++;
        } elseif (!$isSelected && $type === 'deleted') {
            avesmapsSyncPlanRecordDecline($pdo, 'citymap', $key, $userId);
            $declined++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'citymap', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // The three closing acts of the former reconcile step, moved here because they mean "something was
    // written" -- and until now, nothing was.
    if (function_exists('avesmapsAppSettingSet')) {
        try {
            avesmapsAppSettingSet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
        } catch (Throwable) {
            // A missing timestamp is a cosmetic loss; it must never fail the Übernahme itself.
        }
    }
    // Resolve freshly-added wiki place names -> entities. NOT optional and NOT guarded: a silently
    // skipped resolve looks exactly like a successful Übernahme while every new card stays invisible.
    avesmapsResolvePlacesInTable($pdo, 'citymap_place');
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo); // bust the map-features ETag
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    // ⚠️ The deleted titles are read from the ROWS, not accumulated in the step that happened to be
    // last: a run of 46 deletions spans several requests, and a list built in memory would name only
    // the handful the final step got to -- the audit row would understate what was deleted.
    $titles = $pdo->prepare(
        "SELECT label FROM sync_plan_item
          WHERE run_id = :r AND change_type = 'deleted' AND apply_state = 'applied' ORDER BY id ASC"
    );
    $titles->execute(['r' => $runId]);
    $deletedTitles = array_map('strval', $titles->fetchAll(PDO::FETCH_COLUMN) ?: []);

    avesmapsLogSyncPlanApply(
        $pdo,
        'citymap',
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => $declined,
            'deleted_titles' => $deletedTitles,
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => $declined];
}
