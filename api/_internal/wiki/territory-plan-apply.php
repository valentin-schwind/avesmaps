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
 * Whether a 'changed' row is fully applied, and if not, which half is to blame. PURE -- no DB, no
 * side effects, split out specifically so the two combo-row cases can be unit-tested without a database
 * (task-6 quality review, 2026-08-07).
 *
 * 💣 EVERY proposed part must have taken effect. Design §6f checks staleness per proposed CHANGE, not
 * per row-as-a-whole: an OR here (either half succeeding is enough) would let a combo row whose data
 * landed but whose parent still diverges report as fully `applied` -- its skip counter gets cleared,
 * and the unresolved parent half is named nowhere until somebody rebuilds the plan by hand. That is
 * exactly the silence design §6f forbids ("was nicht mehr passt, wird stale ... und wird hinterher
 * genannt").
 *
 * @return array{applied:bool, note:string} note is '' when applied is true
 */
function avesmapsTerritoryApplyClassifyChangedRow(
    bool $hasParentMove,
    bool $parentDivergent,
    bool $hasDataChange,
    bool $dataWritten
): array {
    $parentOk = !$hasParentMove || !$parentDivergent;
    $dataOk = !$hasDataChange || $dataWritten;

    if ($parentOk && $dataOk) {
        return ['applied' => true, 'note' => ''];
    }

    if ($hasParentMove && $hasDataChange) {
        // A combo row: name exactly which half failed -- the other one succeeded silently and needs no
        // mention. (Both failing at once falls through to the generic note: naming two absent things is
        // no more informative than naming none.)
        $note = $dataOk
            ? 'Die Daten wurden geschrieben, der Elternteil ließ sich nicht auflösen.'
            : ($parentOk
                ? 'Der Elternteil wurde übernommen, die Daten ließen sich nicht mehr schreiben.'
                : 'Der Stand hat sich seit der Vorschau geändert.');
    } elseif ($hasParentMove) {
        $note = 'Der Elternteil war nicht auflösbar.';
    } else {
        $note = 'Der Stand hat sich seit der Vorschau geändert.';
    }

    return ['applied' => false, 'note' => $note];
}

/**
 * Which planned parent moves the TREE has moved on from since the preview. PURE.
 *
 * 💣 THE CHECK THE APPLY HALF WAS MISSING. `$parentStill` only asks "is there still a divergence?" --
 * and after the writer has run there is none, whatever parent it wrote. So: the row says
 * „Baronie X: A → B", somebody drags X under C in the tree, the writer sets C, the divergence is gone
 * and the row reports `applied` under a text that promised B. Word for word the silent lie the whole
 * Übernahme exists to end. Design §6f: every ticked row is re-checked against the CURRENT state, and
 * what no longer matches is left standing and named afterwards.
 *
 * ⚠️ Matched by KEY, never by the name in the row. Territory names are not unique in this data (that
 * is what the conflict centre is for), and the identity writer renames territories in the SAME run --
 * a name comparison would be both too coarse and too jumpy. avesmapsTerritoryPlanStep therefore writes
 * `parent_key` next to the display name.
 *
 * ⚠️ A row without a promised key (a plan computed before this check existed) is NOT flagged: nothing
 * can be said about it, and inventing drift would strand rows nobody can apply. It keeps the older,
 * weaker check -- and the next computed plan carries the key.
 *
 * @param array<string,string> $promised child wiki_key => the parent key its plan row promised
 * @param array<string,string> $current  child wiki_key => the parent key the model holds NOW ('' = root)
 * @return array<string,string> child wiki_key => the parent the model holds now ('' = none)
 */
function avesmapsTerritoryApplyParentDrift(array $promised, array $current): array {
    $drift = [];
    foreach ($promised as $child => $promisedParent) {
        $promisedParent = (string) $promisedParent;
        if ($promisedParent === '') {
            continue;
        }
        $currentParent = (string) ($current[(string) $child] ?? '');
        if ($currentParent !== $promisedParent) {
            $drift[(string) $child] = $currentParent;
        }
    }

    return $drift;
}

/**
 * What a row says when the tree moved under it. PURE.
 *
 * The data half is named separately because it is written independently: a combo row can perfectly
 * well have had its fields written while its parent move was withdrawn.
 */
function avesmapsTerritoryApplyParentDriftNote(bool $hasDataChange, bool $dataWritten, string $currentParent): string {
    $where = $currentParent === ''
        ? 'gar keinen Elternteil mehr'
        : sprintf('„%s"', $currentParent);

    if ($hasDataChange && $dataWritten) {
        return sprintf(
            'Der Baum wurde seit der Vorschau geändert und nennt jetzt %s. Die Daten wurden geschrieben, '
            . 'der Elternteil nicht.',
            $where
        );
    }

    return sprintf(
        'Der Baum wurde seit der Vorschau geändert und nennt jetzt %s — der Elternteil wurde nicht gesetzt.',
        $where
    );
}

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
    // Decoded ONCE, up front: the drift check below needs the promised parent BEFORE the writers run,
    // and the per-row loop needs the same array afterwards. Two decodings would be two chances to read
    // the row differently.
    $afterByItem = [];
    $promisedParents = [];
    foreach ($pending as $row) {
        $key = (string) $row['entity_key'];
        $after = json_decode((string) ($row['after_json'] ?? ''), true);
        $after = is_array($after) ? $after : [];
        $afterByItem[(int) $row['id']] = $after;
        if ((string) $row['change_type'] === 'new') {
            $newKeys[] = $key;
            continue;
        }
        $changedKeys[] = $key;
        if (($after['parent_key'] ?? '') !== '') {
            $promisedParents[$key] = (string) $after['parent_key'];
        }
    }

    // 💣 WAS DIE ZEILE VERSPROCHEN HAT, GEGEN DAS, WAS DER BAUM JETZT SAGT. Der Baum lässt sich
    // zwischen Vorschau und Übernahme ziehen (set_parent schreibt parent_wiki_key) -- und weil das
    // Kuratieren unangetastet bleiben soll (Entwurf §9), wird eine offene Vorschau davon NICHT
    // zurückgezogen. Stattdessen: die abgedrifteten Schlüssel fliegen aus der only-Liste des
    // Eltern-Schreibers (Entwurf §6a: was nach der Vorschau entsteht, wird nicht geschrieben) und ihre
    // Zeile wird hinterher benannt. EINE Sammelabfrage, kein N+1.
    $modelParents = [];
    if ($promisedParents !== []) {
        $keys = array_keys($promisedParents);
        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $modelStmt = $pdo->prepare(
            'SELECT wiki_key, parent_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE
            . ' WHERE wiki_key IN (' . $placeholders . ')'
        );
        $modelStmt->execute($keys);
        foreach ($modelStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $modelRow) {
            $modelParents[(string) $modelRow['wiki_key']] = (string) ($modelRow['parent_wiki_key'] ?? '');
        }
    }
    $parentDrift = avesmapsTerritoryApplyParentDrift($promisedParents, $modelParents);
    $parentCacheKeys = array_values(array_filter(
        $changedKeys,
        static fn(string $key): bool => !array_key_exists($key, $parentDrift)
    ));

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
        //
        // Both bulk writers are gated on their OWN key list being non-empty: `only = []` correctly means
        // "select nothing" (avesmapsWikiSyncMonitorSelectionClause turns it into `1 = 0`), so an
        // unguarded call is not wrong, only three no-op SELECTs and a no-op UPDATE for nothing -- and a
        // budget page of pure 'new' rows (reachable: the compute half inserts all 'changed' rows before
        // all 'new' ones, the pending reader goes by ascending id) hits exactly that every time.
        // ⚠️ $parentCacheKeys, nicht $changedKeys: eine Zeile, deren Elternteil seit der Vorschau
        // umgezogen ist, bekommt hier gar nichts geschrieben -- der Schreiber nähme den Elternteil, den
        // das Modell JETZT nennt, und das ist nicht der, der in der Liste steht.
        if ($parentCacheKeys !== []) {
            avesmapsWikiSyncMonitorApplyParentCache($pdo, [], false, $parentCacheKeys);
        }
        if ($newKeys !== []) {
            // 💣 THE WHOLE RUN'S ticked own nodes, not this page's. avesmapsWikiSyncMonitorApplyCustomNodes
            // supports custom→custom through two passes over the rows IT was given -- and a page is not
            // the chain: the pending reader goes by ascending id (= wiki_key order), so a child can be on
            // page 6 and its parent on page 7. With the page as its world, page 6 creates the child, finds
            // no parent, drops it into `unresolved_parents` (which nobody reads), and marks it `applied`
            // because the row now exists; page 7 creates the parent and never links the child. Parentless
            // forever -- and no later plan offers it, because it exists.
            //
            // The alternative (mark the row stale when unresolved_parents names it) was rejected: the row
            // IS created either way, so the next plan would not propose it again anyway -- the stale note
            // would describe the damage instead of preventing it.
            //
            // ⚠️ It ignores the step budget for this one writer, and that is affordable HERE and only
            // here: own nodes are made by hand in the tree editor, so the run's whole "Neu" group is a
            // handful of rows, not the thousand-row category the copy sync has.
            avesmapsWikiSyncMonitorApplyCustomNodes($pdo, false, avesmapsSyncPlanSelectedKeys($pdo, $runId, 'new'));
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

        // 'changed': decide on each of the row's OWN components, never on the other's evidence, then
        // require EVERY proposed part to have taken effect -- avesmapsTerritoryApplyClassifyChangedRow
        // above has the reasoning (design §6f) and the per-half notes.
        //
        // Both halves are read from what the PLAN offered: 'parent' in after_json is written only for
        // rows a parent move actually touched, and every other key of before_json is an identity-field
        // change. ⚠️ NOT from `pin_fields`: that list is filtered down to what can actually be frozen
        // (avesmapsTerritoryPlanPinnableFields), so a row whose only change is an empty Gründungsjahr
        // carries no pin_fields at all -- and would silently drop out of the data check.
        $after = $afterByItem[$itemId] ?? [];
        $before = json_decode((string) ($row['before_json'] ?? ''), true);
        $before = is_array($before) ? $before : [];
        $hasParentMove = array_key_exists('parent', $after);
        $hasDataChange = array_diff(array_keys($before), ['parent']) !== [];
        $dataWritten = isset($writtenKeySet[$key]);

        // 💣 ZUERST DER BAUM. Ein abgedrifteter Elternteil ist kein „nicht auflösbar", sondern
        // „inzwischen woanders" -- und $parentStill könnte es gar nicht sehen: es fragt nur, OB noch
        // eine Abweichung besteht, nicht ob der geschriebene Elternteil der versprochene war. Diese
        // Zeile wurde vom Eltern-Schreiber ausgenommen, steht also unverändert da.
        if ($hasParentMove && array_key_exists($key, $parentDrift)) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', avesmapsTerritoryApplyParentDriftNote(
                $hasDataChange,
                $dataWritten,
                $parentDrift[$key]
            ));
            $stale++;
            continue;
        }

        $parentDivergent = false;
        if ($hasParentMove) {
            $parentStill->execute(['wk' => $key]);
            $parentDivergent = (int) $parentStill->fetchColumn() > 0;
        }

        $classification = avesmapsTerritoryApplyClassifyChangedRow(
            $hasParentMove, $parentDivergent, $hasDataChange, $dataWritten
        );
        if ($classification['applied']) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
            $applied++;
        } else {
            // 💣 A row that lands here is NOT applied, so avesmapsSyncPlanClearSkip (in
            // avesmapsTerritoryApplyFinish below) never fires for it and any existing skip counter
            // survives untouched; it is also still `selected = 1` (avesmapsSyncPlanMarkItem never
            // touches that column), so avesmapsSyncPlanRecordSkip never fires either. It simply stays
            // unresolved with apply_state='stale' -- the NEXT computed plan re-derives everything from
            // live state, so it proposes only whatever is still actually outstanding; the half that
            // already landed will no longer produce a divergent row and so will not reappear (verified
            // by tracing avesmapsTerritoryApplyFinish's classification loop -- see task-6-report.md).
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $classification['note']);
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
