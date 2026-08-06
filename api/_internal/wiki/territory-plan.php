<?php

declare(strict_types=1);

// The COMPUTE half of the territory MAP sync: what "3 · Übernehmen" would write into
// political_territory. Design: docs/superpowers/specs/2026-08-06-sync-uebernahme-territorien-design.md
// §5, session 4.
//
// 🔴 IT CALLS NOTHING FROM THE DERIVED-BOUNDARY SYSTEM. A parent move changes which nodes may own an
// outer boundary -- four bugs hung on that one predicate, the last of them fail-OPEN, and since
// 6e8fcccc the recomputation hangs in the save path as a before-save transform WITHOUT try/catch, so a
// throw there takes the whole save with it. This file NAMES the consequence in a sentence and stops.
//
// Side-effect-free on include: function definitions only.

/**
 * What a parent move does to the outer-boundary ROLE of up to three nodes. PURE, and a sentence.
 *
 * The rule (territory-derived-geometry-editor.js, isOwnDerivedBoundaryForbidden): a node owns a
 * derived outer boundary only if it is a pure container -- no own polygon AND it aggregates children --
 * or a root. So a move can flip two neighbours: the OLD parent losing its last child stops being a
 * container, and the NEW parent gaining its first one becomes one.
 *
 * Returns '' when nothing flips. 💣 That matters: a note on every row is a note nobody reads.
 *
 * @param array<string,array{name:string,own_geometry:int,children:int}> $counts keyed by wiki_key
 */
function avesmapsTerritoryPlanRoleShift(array $counts, string $child, ?string $oldParent, ?string $newParent): string {
    if ($oldParent === $newParent || $newParent === $child) {
        return '';
    }

    $isContainer = static fn(array $node): bool => (int) $node['own_geometry'] === 0 && (int) $node['children'] > 0;
    $parts = [];

    if ($oldParent !== null && isset($counts[$oldParent])) {
        $before = $counts[$oldParent];
        $after = $before;
        $after['children'] = max(0, (int) $before['children'] - 1);
        if ($isContainer($before) && !$isContainer($after)) {
            $parts[] = sprintf(
                '%s verliert sein letztes Kind und ist danach kein Behälter mehr — eine bestehende '
                . 'Außengrenze wird dadurch überflüssig.',
                $before['name']
            );
        }
    }

    if ($newParent !== null && isset($counts[$newParent])) {
        $before = $counts[$newParent];
        $after = $before;
        $after['children'] = (int) $before['children'] + 1;
        if (!$isContainer($before) && $isContainer($after)) {
            $parts[] = sprintf('%s wird zum Behälter und darf danach eine eigene Außengrenze haben.', $before['name']);
        }
    }

    if ($parts === []) {
        return '';
    }

    return 'Ändert die Außengrenzen-Rolle: ' . implode(' ', $parts)
        . ' Die Übernahme rechnet nichts nach und löscht nichts — sie setzt den Elternteil.';
}

/**
 * Own polygons and child count per territory, keyed by wiki_key. TWO aggregate queries, no N+1 --
 * this runs on STRATO, and the derived layer next door is already a known hotspot (AGENTS.md §10).
 *
 * @return array<string,array{name:string,own_geometry:int,children:int}>
 */
function avesmapsTerritoryPlanNodeCounts(PDO $pdo): array {
    $counts = [];
    $rows = $pdo->query(
        "SELECT t.wiki_key, t.name,
                (SELECT COUNT(*) FROM political_territory_geometry g
                  WHERE g.territory_id = t.id AND g.is_active = 1) AS own_geometry,
                (SELECT COUNT(*) FROM political_territory c
                  WHERE c.parent_id = t.id AND c.is_active = 1) AS children
           FROM political_territory t
          WHERE t.is_active = 1 AND t.wiki_key IS NOT NULL AND t.wiki_key <> ''"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    foreach ($rows as $row) {
        $counts[(string) $row['wiki_key']] = [
            'name' => (string) $row['name'],
            'own_geometry' => (int) $row['own_geometry'],
            'children' => (int) $row['children'],
        ];
    }

    return $counts;
}

/**
 * The map plan, in ONE step: the three sources are each a single pass over the whole set, so there is
 * nothing to resume. ONE ROW PER TERRITORY (design §5) -- data fields and the parent move travel
 * together, because the entity is the territory.
 *
 * 🔴 Writes plan rows only.
 *
 * @return array{done:bool, nextCursor:string, run_id:int, planned:int, processed:int, counts:array}
 */
function avesmapsTerritoryPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array {
    unset($cursor, $budget); // one pass; the signature matches its neighbours on purpose
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    avesmapsEnsureSyncPlanTables($pdo);

    $stamp = (string) ($pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
        ->fetchColumn() ?: '');
    $runId = avesmapsSyncPlanStartRun($pdo, 'territory', $userId, $stamp === '' ? null : $stamp);
    $decisions = avesmapsSyncPlanDecisions($pdo, 'territory');
    $nodeCounts = avesmapsTerritoryPlanNodeCounts($pdo);

    // --- the three read-only sources -------------------------------------------------------------
    //
    // 💣 NOT the dry-run branches of the three writers. AGENTS.md §11: "Wo eine Vorlage durch SCHREIBEN
    // antwortet, braucht die Rechen-Hälfte einen read-only Zwilling." A $dryRun flag is a promise made
    // at runtime; the purity walk sees the writer's body either way, and the guarantee this whole
    // rebuild is about would rest on a boolean argument nobody re-checks.
    $identity = avesmapsWikiSyncMonitorApplyIdentityPreview($pdo);   // already pure, its own function
    $parentMoves = avesmapsTerritoryPlanParentMoves($pdo);           // twin of ApplyParentCache
    $toCreate = avesmapsTerritoryPlanCustomNodesToCreate($pdo);      // twin of ApplyCustomNodes

    // --- Geändert: one row per territory ----------------------------------------------------------
    $rows = [];
    foreach (($identity['changed'] ?? []) as $entry) {
        $wikiKey = (string) $entry['wiki_key'];
        $before = [];
        $after = [];
        foreach (($entry['changes'] ?? []) as $field => $change) {
            $before[$field] = $change['from'] === null ? '' : (string) $change['from'];
            $after[$field] = $change['to'] === null ? '' : (string) $change['to'];
        }
        $rows[$wikiKey] = [
            'label' => (string) $entry['name'],
            'public_id' => null,
            'before' => $before,
            'after' => $after,
            // Every named data field can be pinned at its CURRENT live value. ⚠️ No claim about where
            // that value came from: political_territory carries no "edited by hand" mark, so a tag
            // saying so would be a guess (design §5).
            'pin_fields' => array_keys($before),
        ];
    }

    foreach ($parentMoves as $wikiKey => $move) {
        if (!isset($rows[$wikiKey])) {
            $rows[$wikiKey] = ['label' => $move['name'], 'public_id' => null,
                'before' => [], 'after' => [], 'pin_fields' => []];
        }
        $rows[$wikiKey]['before']['parent'] = $move['old_name'];
        $rows[$wikiKey]['after']['parent'] = $move['new_name'];
        $note = avesmapsTerritoryPlanRoleShift($nodeCounts, $wikiKey, $move['old_key'], $move['new_key']);
        if ($note !== '') {
            $rows[$wikiKey]['after']['boundary_note'] = $note;
        }
    }

    $planned = 0;
    foreach ($rows as $wikiKey => $row) {
        $after = $row['after'];
        if ($row['pin_fields'] !== []) {
            $after['pin_fields'] = implode(',', $row['pin_fields']);
        }
        $decision = $decisions[avesmapsSyncPlanDecisionKey((string) $wikiKey, 'changed')] ?? null;
        avesmapsSyncPlanAddItem($pdo, $runId, [
            'entity_key' => (string) $wikiKey,
            'entity_public_id' => $row['public_id'],
            'change_type' => 'changed',
            'label' => $row['label'],
            'before' => $row['before'],
            'after' => $after,
            'override' => [],
            'selected' => avesmapsSyncPlanDefaultSelected('changed', (int) ($decision['skipped_count'] ?? 0)),
        ]);
        $planned++;
    }

    // --- Neu: the own nodes that do not exist on the map yet --------------------------------------
    foreach ($toCreate as $node) {
        $parentKey = $node['parent_wiki_key'] === null ? '' : (string) $node['parent_wiki_key'];
        avesmapsSyncPlanAddItem($pdo, $runId, [
            'entity_key' => (string) $node['wiki_key'],
            'entity_public_id' => null,
            'change_type' => 'new',
            'label' => (string) $node['name'],
            'before' => [],
            'after' => ['parent' => $parentKey === ''
                ? '(Wurzel)'
                : (string) ($nodeCounts[$parentKey]['name'] ?? $parentKey)],
            'override' => [],
            'selected' => avesmapsSyncPlanDefaultSelected('new', 0),
        ]);
        $planned++;
    }

    // 💣 NO deleted rows, ever. A territory is never deleted by this sync -- the group says so itself
    // (SYNC_PLAN_KIND_NO_DELETION_NOTE.territory).
    $counts = avesmapsSyncPlanFinishBuild($pdo, $runId);

    return [
        'done' => true,
        'nextCursor' => '',
        'run_id' => $runId,
        'planned' => $planned,
        'processed' => count($rows) + count($toCreate),
        'counts' => $counts,
    ];
}

/**
 * The own nodes that are placed in the tree but have no row on the map yet. READ-ONLY TWIN of
 * avesmapsWikiSyncMonitorApplyCustomNodes' dry-run branch -- see the note at its only caller for why
 * the flag would not do.
 *
 * @return list<array{wiki_key:string, name:string, parent_wiki_key:?string}>
 */
function avesmapsTerritoryPlanCustomNodesToCreate(PDO $pdo): array {
    $rows = $pdo->query(
        "SELECT wiki_key, parent_wiki_key, metadata_overrides_json
           FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . "
          WHERE wiki_key LIKE 'eigener-knoten:%' AND excluded = 0
          ORDER BY wiki_key ASC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $existing = [];
    foreach ($pdo->query("SELECT wiki_key FROM political_territory
        WHERE wiki_key LIKE 'eigener-knoten:%' AND is_active = 1")->fetchAll(PDO::FETCH_COLUMN) ?: [] as $key) {
        $existing[(string) $key] = true;
    }

    $toCreate = [];
    foreach ($rows as $row) {
        $key = (string) $row['wiki_key'];
        if (isset($existing[$key])) {
            continue;
        }
        $overrides = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
        $name = trim((string) ((is_array($overrides) ? $overrides : [])['name'] ?? ''));
        if ($name === '') {
            // The writer skips a nameless node too (missing_name). A row proposing "" would be a tick
            // an editor cannot judge.
            continue;
        }
        $toCreate[] = [
            'wiki_key' => $key,
            'name' => $name,
            'parent_wiki_key' => $row['parent_wiki_key'] === null ? null : (string) $row['parent_wiki_key'],
        ];
    }

    return $toCreate;
}

/**
 * The parent moves the model would apply, with both names. Read-only; the same join the dry-run of
 * avesmapsWikiSyncMonitorApplyParentCache counts, plus the CURRENT parent's name for the "alt → neu".
 *
 * @return array<string,array{name:string,old_key:?string,old_name:string,new_key:string,new_name:string}>
 */
function avesmapsTerritoryPlanParentMoves(PDO $pdo): array {
    $rows = $pdo->query(
        'SELECT child.wiki_key AS child_key, child.name AS child_name,
                oldp.wiki_key AS old_key, oldp.name AS old_name,
                parent.wiki_key AS new_key, parent.name AS new_name
           FROM political_territory child
           JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
           JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key
                AND parent.is_active = 1 AND parent.id <> child.id
           LEFT JOIN political_territory oldp ON oldp.id = child.parent_id
          WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL
            AND (child.parent_id IS NULL OR child.parent_id <> parent.id)
          ORDER BY child.name ASC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $moves = [];
    foreach ($rows as $row) {
        $moves[(string) $row['child_key']] = [
            'name' => (string) $row['child_name'],
            'old_key' => $row['old_key'] === null ? null : (string) $row['old_key'],
            'old_name' => $row['old_name'] === null ? '(keiner)' : (string) $row['old_name'],
            'new_key' => (string) $row['new_key'],
            'new_name' => (string) $row['new_name'],
        ];
    }

    return $moves;
}
