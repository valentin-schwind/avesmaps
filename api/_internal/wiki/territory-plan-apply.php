<?php

declare(strict_types=1);

// The APPLY half of the territory MAP sync. Design: …-territorien-design.md §5, session 4.
//
// 💣 IT WRITES BY CALLING THE THREE UNCHANGED WRITERS -- avesmapsWikiSyncMonitorApplyParentCache,
// …ApplyCustomNodes, …ApplyIdentity. Not copies of them: the same functions, with a POSITIVE selection
// (design §6a). Every guarantee they carry -- the override precedence, the identity backup, the
// excluded-node skip -- therefore holds unchanged and needed no re-proving.
//
// It lives in its own file so the compute half can be shown not to reach a writer
// (__tests__/sync-plan-purity-test.php walks the call graph from avesmapsTerritoryPlanStep).
//
// 🔴 IT CALLS NOTHING FROM THE DERIVED-BOUNDARY SYSTEM. See territory-plan.php for why.
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * ONE bounded apply step: it takes up to $budget ticked rows and hands their keys to the three
 * writers as an `only` list. Bulk writers, bounded by the subset -- not by a cursor.
 *
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsTerritoryApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array {
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    avesmapsEnsureSyncPlanTables($pdo);

    $pending = avesmapsSyncPlanPendingItems($pdo, $runId, $budget);
    $changedKeys = [];
    $newKeys = [];
    foreach ($pending as $row) {
        $key = (string) $row['entity_key'];
        if ((string) $row['change_type'] === 'new') {
            $newKeys[] = $key;
            continue;
        }
        $changedKeys[] = $key;
    }

    $applied = 0;
    // 💣 The key of the required deviation from the brief (see task-6-report.md): a 'changed' row can
    // carry a data change, a parent move, or both -- and the only PROOF that the data half actually
    // wrote is written_keys, not "no parent divergence left" (a data-only row has none of that to begin
    // with, so that check alone would call it applied even when nothing was written for it).
    $writtenKeySet = [];
    if ($newKeys !== [] || $changedKeys !== []) {
        // 💣 THE ORDER IS LOAD-BEARING. Parents first, then the own nodes (they create AND link), then
        // the data fields. The other way round, a parent assignment pointing at an own node that does
        // not exist yet lands in `unresolved` instead of taking effect.
        avesmapsWikiSyncMonitorApplyParentCache($pdo, [], false, $changedKeys);
        if ($newKeys !== []) {
            avesmapsWikiSyncMonitorApplyCustomNodes($pdo, false, $newKeys);
        }
        // ⚠️ ApplyIdentity recomputes its own preview and filters by `only`. That IS the re-check
        // (design §6f): a key whose change has vanished since the plan was built simply produces no
        // target, so it is never written -- and its wiki_key never lands in written_keys.
        if ($changedKeys !== []) {
            $identityResult = avesmapsWikiSyncMonitorApplyIdentity($pdo, [], $changedKeys, 0, false);
            foreach ((array) ($identityResult['written_keys'] ?? []) as $wk) {
                $writtenKeySet[(string) $wk] = true;
            }
        }
    }

    // What actually happened, read back per row rather than assumed: the writers are bulk, so the only
    // honest per-row answer comes from the current state (plus, for the data half, written_keys above).
    $stale = 0;
    $parentStill = $pdo->prepare(
        'SELECT COUNT(*) FROM political_territory child
           JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
           JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key
                AND parent.is_active = 1 AND parent.id <> child.id
          WHERE child.is_active = 1 AND child.wiki_key = :wk AND m.parent_wiki_key IS NOT NULL
            AND (child.parent_id IS NULL OR child.parent_id <> parent.id)'
    );
    $exists = $pdo->prepare('SELECT COUNT(*) FROM political_territory WHERE wiki_key = :wk AND is_active = 1');

    foreach ($pending as $row) {
        $key = (string) $row['entity_key'];
        $itemId = (int) $row['id'];
        if ((string) $row['change_type'] === 'new') {
            $exists->execute(['wk' => $key]);
            if ((int) $exists->fetchColumn() > 0) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $applied++;
            } else {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der eigene Knoten ließ sich nicht anlegen.');
                $stale++;
            }
            continue;
        }

        // 'changed': decide on each of the row's OWN components, never on the other's evidence.
        // hasParentMove comes straight from the planned after_json -- the same 'parent' key
        // avesmapsTerritoryPlanStep writes only for rows a parent move actually touched, so a data-only
        // row never triggers the (irrelevant, always-zero) parent query at all.
        $after = json_decode((string) ($row['after_json'] ?? ''), true);
        $after = is_array($after) ? $after : [];
        $hasParentMove = array_key_exists('parent', $after);

        $parentDivergent = false;
        if ($hasParentMove) {
            $parentStill->execute(['wk' => $key]);
            $parentDivergent = (int) $parentStill->fetchColumn() > 0;
        }
        $dataWritten = isset($writtenKeySet[$key]);

        if ($dataWritten || ($hasParentMove && !$parentDivergent)) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
            $applied++;
        } else {
            $note = ($hasParentMove && $parentDivergent)
                ? 'Der Elternteil war nicht auflösbar.'
                : 'Der Stand hat sich seit der Vorschau geändert.';
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $note);
            $stale++;
        }
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];
    if ($done) {
        $closing = avesmapsTerritoryApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $applied,
        'deleted' => 0,
        'stale' => $stale,
        'processed' => count($pending),
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Everything that happens ONCE, after the last ticked row: the durable decisions, the run's state,
 * cache invalidation and the single audit row.
 *
 * Structure- and largely word-for-word with avesmapsCitymapApplyFinish (citymap-plan-apply.php:145-234),
 * with three differences: the sync kind name ('territory'), no relink (the map sync writes
 * political_territory directly -- there is no separate copy table to point back at afterwards, unlike
 * the wiki-copy sync), and busting THREE caches instead of one/two (see the calls below for why each is
 * needed). There is also no `deleted_titles`: the map sync never deletes a territory
 * (territory-plan.php: "NO deleted rows, ever") -- the key stays present as an empty list so
 * avesmapsLogSyncPlanApply's payload shape matches every sibling.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsTerritoryApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array {
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
    //
    // 💣 There is no 'deleted' change_type to hit here -- territory-plan.php never emits one -- but the
    // branch stays written so a future deleted row (were one ever added) is not silently skipped.
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
            avesmapsSyncPlanRecordSkip($pdo, 'territory', $key, $userId);
            $skipped++;
        } elseif (!$isSelected && $type === 'deleted') {
            avesmapsSyncPlanRecordDecline($pdo, 'territory', $key, $userId);
            $declined++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'territory', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // The map payload carries name, type, validity and the parent backbone -- all three writers changed
    // them, so both caches have to be told (the political layer keeps its own 300 s file cache), plus
    // the model tree cache the drag'n'drop editor reads, plus a note in the editor's activity log.
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }
    if (function_exists('avesmapsPoliticalInvalidateLayerCache')) {
        avesmapsPoliticalInvalidateLayerCache();
    }
    if (function_exists('avesmapsWikiSyncMonitorInvalidateModelTreeCache')) {
        avesmapsWikiSyncMonitorInvalidateModelTreeCache($pdo);
    }
    if (function_exists('avesmapsWikiSyncMonitorRecordEditorAction')) {
        avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    // ⚠️ No deleted_titles -- the map sync deletes nothing (territory-plan.php: "NO deleted rows,
    // ever"). Passed as [] so the payload shape is identical to every sibling apply.
    avesmapsLogSyncPlanApply(
        $pdo,
        'territory',
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => $declined,
            'deleted_titles' => [],
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => $declined];
}
