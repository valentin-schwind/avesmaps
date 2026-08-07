<?php

declare(strict_types=1);

// The APPLY half of the game-literature sync: it works through the rows an editor ticked in the
// Übernahme-Vorschau and writes exactly those. Design:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §4/§7, session 2.
//
// 💣 IT WRITES BY CALLING THE UNCHANGED avesmapsGameLiteratureReconcileEntity. Not a copy of it, not a
// simplified version: the same override-safe writer the sync has always used -- fields behind
// field_origins_json, places behind origin='wiki' AND status='approved', tombstones never revived,
// the cover fetched only when its wiki file changed. The only thing this change moves is WHO decides
// that it runs: the catalog before, a tick now. Every guarantee that writer carries therefore holds
// unchanged and needed no re-proving.
//
// It lives in its own file so the compute half can be shown not to reach a writer -- and, here, not
// to reach the cover download either (__tests__/sync-plan-purity-test.php walks the call graph from
// avesmapsGameLiteraturePlanStep).
//
// ⚠️ THERE IS NO DELETION BRANCH, and that is not an omission. An adventure is never deleted by the
// sync, not even when its wiki article disappears: game-literature-sync.php has no removal sweep and never
// had one. What the wiki CAN take away is places -- and a shrinking "Ort" list is a change to a
// living adventure, so it rides in that adventure's own row, named as "Orte entfallen" and painted in
// the warning colour. Session-2 plan, Entscheidung 1.
//
// Side-effect-free on include: function definitions only. The endpoint loads the rest of the chain.
//
// 💣 The audit library is required HERE rather than assumed from the caller -- the same decision, for
// the same reason, that citymap-plan-apply.php spells out: the audit writer swallows its own failures
// on purpose, so an assumed dependency would be an undefined function inside somebody's catch --
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
 * ⚠️ And no transaction around avesmapsGameLiteratureReconcileEntity either -- that one is the documented
 * exception (reconcile-transaction-test.php): it fetches the wiki cover over HTTP and writes it to
 * /uploads/questcovers in the middle of its writes, and a transaction there would hold a connection
 * open across unbounded network latency on a shared host without being able to roll the file back.
 *
 * @param array<string,mixed>|null $user the editor, for the audit row (NULL = not a person)
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsGameLiteratureApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_GAME_LITERATURE_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ DDL first and once, never inside the per-entity writes below: MySQL commits an open
    // transaction implicitly when it sees DDL.
    avesmapsEnsureGameLiteratureStagingTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    $totals = ['applied' => 0, 'stale' => 0, 'processed' => 0];
    $catalogFind = $pdo->prepare('SELECT * FROM wiki_adventure_catalog WHERE wiki_key = :wk LIMIT 1');

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];

        $catalogFind->execute(['wk' => $wikiKey]);
        $catalog = $catalogFind->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($catalog === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Im Dump nicht mehr enthalten.');
            $totals['stale']++;
        } else {
            // 💣 THE RE-CHECK (design §4a). A plan may lie around for days; between computing and
            // applying, somebody can edit the adventure by hand or a new dump can arrive. Recomputed
            // with the SAME function that built the row, so "unchanged" really means unchanged --
            // including the cover: if the wiki swapped the image in the meantime, the row's
            // "wird neu geladen" would fetch a different file than the one it was ticked for.
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsGameLiteraturePlanForCatalogRow($pdo, $catalog);
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $fresh['item']['after'] ?? null)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                avesmapsGameLiteratureReconcileEntity($pdo, $catalog, $userId);
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
        $closing = avesmapsGameLiteratureApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        // Always 0 -- kept in the envelope because the component and the endpoint speak one language
        // for all kinds, and a missing key would read as "unknown" rather than "none".
        'deleted' => 0,
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Everything that happens ONCE, after the last ticked row: the durable decisions, the run's state,
 * the closing acts the old reconcile step used to do, and the single audit row.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsGameLiteratureApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array
{
    $planned = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $run = avesmapsSyncPlanRunById($pdo, $runId);
    if ($run !== null) {
        $decoded = json_decode((string) ($run['counts_json'] ?? ''), true);
        if (is_array($decoded)) {
            $planned = array_merge($planned, $decoded);
        }
    }

    // What was left unticked, and what was taken. Same three statements as next door (design §2):
    //   an unticked change -> counted, comes back next run with its counter
    //   an applied change  -> its counter is forgotten, or the tag would lie about it forever
    // There is no unticked-deletion case here: this sync produces no deletion rows.
    $stmt = $pdo->prepare('SELECT entity_key, change_type, selected, apply_state FROM sync_plan_item WHERE run_id = :r');
    $stmt->execute(['r' => $runId]);
    $skipped = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['entity_key'];
        $type = (string) $row['change_type'];
        $isSelected = (int) $row['selected'] === 1;
        $applied = (string) ($row['apply_state'] ?? '') === 'applied';

        if (!$isSelected && $type === 'changed') {
            avesmapsSyncPlanRecordSkip($pdo, 'adventure', $key, $userId);
            $skipped++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'adventure', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // The closing acts of the former reconcile step, moved here because they mean "something was
    // written" -- and until now, nothing was.
    if (function_exists('avesmapsAppSettingSet')) {
        try {
            avesmapsAppSettingSet($pdo, AVESMAPS_GAME_LITERATURE_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
        } catch (Throwable) {
            // A missing timestamp is a cosmetic loss; it must never fail the Übernahme itself.
        }
    }
    // Resolve freshly-added wiki place names -> entities. NOT guarded away: a silently skipped resolve
    // looks exactly like a successful Übernahme while every new place stays unresolved.
    if (function_exists('avesmapsGameLiteratureResolveAll')) {
        avesmapsGameLiteratureResolveAll($pdo);
    }
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo); // adventures travel in the map-features payload
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    avesmapsLogSyncPlanApply(
        $pdo,
        'adventure',
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => 0,
            // Nothing is deleted by this sync, so the audit row names no titles -- and says so by
            // being empty rather than by omitting the key.
            'deleted_titles' => [],
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => 0];
}
