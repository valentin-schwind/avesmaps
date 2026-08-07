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
 * or a ROOT. So a move can flip THREE roles, not two:
 *
 *   - the MOVED node itself: a root is eligible on that ground alone, whatever its geometry. Gaining a
 *     parent ends that -- and in this project's model, most territories are CREATED parent-less by hand
 *     and linked in later, so "was root, gains its first parent" is the common path, not an edge case.
 *   - the OLD parent losing its last child stops being a container.
 *   - the NEW parent gaining its first one becomes one.
 *
 * Returns '' when nothing flips. 💣 That matters: a note on every row is a note nobody reads.
 *
 * 💣 $wasRoot is NOT "$oldParent === null". A wiki_key is not a parent: political_territory rows exist
 * whose parent carries no wiki_key at all (own nodes predate one, hand-made rows may never get one), and
 * for those the old parent's KEY is null while the node very much had a parent. Reading the missing key
 * as "was a root" produced the note "verliert seinen Wurzelstatus" right underneath a rendered
 * "Eltern: <the old parent's name> → …" -- two lines of the same row contradicting each other.
 * Callers with the live parent_id at hand pass it; null keeps the old two-valued reading for the pure
 * callers (tests) where a null key really does mean "no parent".
 *
 * @param array<string,array{name:string,own_geometry:int,children:int}> $counts keyed by wiki_key
 * @param bool|null $wasRoot whether the child had NO live parent at all; null = derive from $oldParent
 */
function avesmapsTerritoryPlanRoleShift(array $counts, string $child, ?string $oldParent, ?string $newParent, ?bool $wasRoot = null): string {
    if ($oldParent === $newParent || $newParent === $child) {
        return '';
    }

    $isContainer = static fn(array $node): bool => (int) $node['own_geometry'] === 0 && (int) $node['children'] > 0;
    $parts = [];

    // --- the moved node itself: does gaining a parent cost it its ROOT eligibility? -------------------
    //
    // Its own geometry/children counts are unaffected by whose child it is -- only the "is it a root"
    // half of the rule changes. A move that ATTACHES a former root (was root, gains $newParent) can
    // therefore lose eligibility; a container stays eligible either way, so this only fires when the
    // moved node is NOT also a pure container.
    if (isset($counts[$child])) {
        $node = $counts[$child];
        $wasEligible = ($wasRoot ?? ($oldParent === null)) || $isContainer($node);
        $staysEligible = $newParent === null || $isContainer($node);
        if ($wasEligible && !$staysEligible) {
            $parts[] = sprintf(
                '%s verliert mit dem Umzug seinen Wurzelstatus und darf danach keine eigene Außengrenze '
                . 'mehr haben — eine bestehende wird dadurch überflüssig.',
                $node['name']
            );
        }
    }

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
 * The newest NON-REVERTED apply_identity write per territory, from political_territory_identity_backup.
 * ONE grouped query, no N+1.
 *
 * This is the only PROVABLE source for a "von Hand geändert" marker: political_territory itself carries
 * no "edited by hand" column, so "live differs from wiki AND override" cannot tell a human edit from a
 * value the sync never got round to (design doc §1.9: "Direkt im Politik-Editor geändert … es gibt kein
 * Merkmal, der Abgleich setzt es wortlos zurück"). But apply_identity is the ONLY other writer of these
 * columns, and it snapshots exactly what it wrote -- so if the live value now differs from the newest
 * snapshot's new_<field>, something wrote it that was NOT apply_identity, i.e. a human, in the political
 * editor. That is proof, not inference.
 *
 * 💣 The filter is kind = 'identity' AND reverted_at IS NULL, BOTH:
 *   - kind = 'identity': the same table also carries kind = 'coat' rows (a different write, coat-of-arms
 *     backups) whose new_name/new_type/… columns are not what apply_identity wrote.
 *   - reverted_at IS NULL: avesmapsWikiSyncMonitorRevertIdentity (sync-monitor-identity.php ~850) sets
 *     reverted_at per row when a batch is undone -- a reverted batch put the OLD value back, so treating
 *     its new_* as "what the sync wrote" would label every reverted territory as hand-edited.
 *
 * @return array<int, array{new_name:?string, new_type:?string, new_status:?string, new_valid_from_bf:?int, new_valid_to_bf:?int}>
 */
function avesmapsTerritoryPlanLastSyncWrote(PDO $pdo): array {
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $rows = $pdo->query(
        'SELECT b.territory_id, b.new_name, b.new_type, b.new_status, b.new_valid_from_bf, b.new_valid_to_bf
           FROM ' . $tbl . ' b
           JOIN (
               SELECT territory_id, MAX(id) AS max_id
                 FROM ' . $tbl . "
                WHERE kind = 'identity' AND reverted_at IS NULL
                GROUP BY territory_id
           ) latest ON latest.territory_id = b.territory_id AND latest.max_id = b.id"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $out = [];
    foreach ($rows as $row) {
        $out[(int) $row['territory_id']] = [
            'new_name' => $row['new_name'] === null ? null : (string) $row['new_name'],
            'new_type' => $row['new_type'] === null ? null : (string) $row['new_type'],
            'new_status' => $row['new_status'] === null ? null : (string) $row['new_status'],
            'new_valid_from_bf' => $row['new_valid_from_bf'] === null ? null : (int) $row['new_valid_from_bf'],
            'new_valid_to_bf' => $row['new_valid_to_bf'] === null ? null : (int) $row['new_valid_to_bf'],
        ];
    }

    return $out;
}

/**
 * Which of a row's ALREADY-CHANGING fields a human edited after the sync last wrote them. PURE.
 *
 * Provable only: without a backup row for this territory, apply_identity has never written it, so
 * nothing can be said -- returns [], silence rather than a guess. `continent` never appears in the
 * result: it is deliberately not part of the backup snapshot (sync-monitor-identity.php: "continent ist
 * … NICHT Teil des Undo-Snapshots"), so there is nothing provable to compare it against.
 *
 * Only fields already present in $changes are considered -- a hand-edit on a field the sync does not
 * currently want to touch is not this row's business.
 *
 * 💣 valid_to_bf is compared as the RAW 9999 sentinel on BOTH sides, never the null-normalised form
 * avesmapsWikiSyncMonitorApplyIdentityPreview computes for its own "from"/"to": both the live column and
 * the backup snapshot store literal 9999 for "still exists". Comparing normalised-null against raw-9999
 * would flag every currently-valid, ever-synced territory as hand-edited.
 *
 * name/type/status are compared through the SAME null-as-'' convention the identity preview's own
 * cmpStr() uses for deciding "changed" in the first place -- otherwise PHP's null-vs-'' distinction
 * alone (not a real difference: political_territory.type stores NULL, the preview's diff casts it to
 * '') would flag a field that was, and still is, simply unset.
 *
 * @param array<string,array{from:mixed,to:mixed}> $changes this row's already-proposed changes
 * @param array{new_name:?string,new_type:?string,new_status:?string,new_valid_from_bf:?int,new_valid_to_bf:?int}|null $lastWrote
 * @return list<string> the affected field keys
 */
function avesmapsTerritoryPlanHandEditedFields(array $changes, ?array $lastWrote): array {
    if ($lastWrote === null) {
        return [];
    }

    $edited = [];

    foreach (['name' => 'new_name', 'type' => 'new_type', 'status' => 'new_status'] as $field => $backupKey) {
        if (!array_key_exists($field, $changes)) {
            continue;
        }
        $live = (string) ($changes[$field]['from'] ?? '');
        $written = (string) ($lastWrote[$backupKey] ?? '');
        if ($live !== $written) {
            $edited[] = $field;
        }
    }

    if (array_key_exists('valid_from_bf', $changes)) {
        if ($changes['valid_from_bf']['from'] !== ($lastWrote['new_valid_from_bf'] ?? null)) {
            $edited[] = 'valid_from_bf';
        }
    }

    if (array_key_exists('valid_to_bf', $changes)) {
        $liveFrom = $changes['valid_to_bf']['from'];
        $liveRaw = $liveFrom === null ? 9999 : (int) $liveFrom;
        if ($liveRaw !== ($lastWrote['new_valid_to_bf'] ?? null)) {
            $edited[] = 'valid_to_bf';
        }
    }

    return $edited;
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
    $lastSyncWrote = avesmapsTerritoryPlanLastSyncWrote($pdo);       // the provable "von Hand geändert" source

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
            // The provable subset of the above: fields the identity backup shows a HUMAN changed after
            // apply_identity last wrote them (avesmapsTerritoryPlanHandEditedFields). [] when there is no
            // backup row for this territory (nothing provable) -- never a guess from the live value alone.
            'hand_edited' => avesmapsTerritoryPlanHandEditedFields(
                (array) ($entry['changes'] ?? []),
                $lastSyncWrote[(int) $entry['id']] ?? null
            ),
        ];
    }

    foreach ($parentMoves as $wikiKey => $move) {
        if (!isset($rows[$wikiKey])) {
            $rows[$wikiKey] = ['label' => $move['name'], 'public_id' => null,
                'before' => [], 'after' => [], 'pin_fields' => [], 'hand_edited' => []];
        }
        $rows[$wikiKey]['before']['parent'] = $move['old_name'];
        $rows[$wikiKey]['after']['parent'] = $move['new_name'];
        $note = avesmapsTerritoryPlanRoleShift($nodeCounts, $wikiKey, $move['old_key'], $move['new_key'], $move['was_root']);
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
        // A pseudo-field like pin_fields above -- it informs the row and must never render as a
        // comparison (there is no "from"/"to" for "was this hand-edited").
        if (!empty($row['hand_edited'])) {
            $after['hand_edited'] = implode(',', $row['hand_edited']);
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
    //
    // A custom node's parent can be ANOTHER not-yet-created custom node -- the writer supports this
    // ("custom->custom funktioniert durch zwei Passes", its own comment on ApplyCustomNodes). $nodeCounts
    // only knows LIVE territories, so such a parent needs a second lookup: the to-create list itself.
    $toCreateNames = [];
    foreach ($toCreate as $node) {
        $toCreateNames[(string) $node['wiki_key']] = (string) $node['name'];
    }
    foreach ($toCreate as $node) {
        $parentKey = $node['parent_wiki_key'] === null ? null : (string) $node['parent_wiki_key'];
        avesmapsSyncPlanAddItem($pdo, $runId, [
            'entity_key' => (string) $node['wiki_key'],
            'entity_public_id' => null,
            'change_type' => 'new',
            'label' => (string) $node['name'],
            'before' => [],
            'after' => ['parent' => avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, $toCreateNames, $parentKey)],
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
 * The display name for a Neu-row's parent. PURE, and split out of avesmapsTerritoryPlanStep specifically
 * so it can be tested without a database: a LIVE territory (from $nodeCounts) if there is one, else the
 * matching entry in the SAME to-create list (a custom node chained under another not-yet-created custom
 * node -- see the note at avesmapsTerritoryPlanStep's "Neu" loop), else the raw key as a last resort (more
 * useful shown than swallowed, even though every key this is called with should resolve to one of the two).
 *
 * @param array<string,array{name:string,own_geometry:int,children:int}> $nodeCounts
 * @param array<string,string> $toCreateNames wiki_key => name, built from the SAME to-create list
 */
function avesmapsTerritoryPlanCustomNodeParentName(array $nodeCounts, array $toCreateNames, ?string $parentKey): string {
    if ($parentKey === null || $parentKey === '') {
        return '(Wurzel)';
    }

    return (string) ($nodeCounts[$parentKey]['name'] ?? $toCreateNames[$parentKey] ?? $parentKey);
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
 * 💣 old_key and was_root are two different questions. child.parent_id answers "did it have a parent";
 * oldp.wiki_key answers "does that parent have a wiki key", and a live territory is allowed to have
 * none. Conflating them turned "the old parent is not in the wiki" into "it was a root" and put a
 * spurious Wurzelstatus note under a row that names its old parent one line above.
 *
 * @return array<string,array{name:string,old_key:?string,old_name:string,new_key:string,new_name:string,was_root:bool}>
 */
function avesmapsTerritoryPlanParentMoves(PDO $pdo): array {
    $rows = $pdo->query(
        'SELECT child.wiki_key AS child_key, child.name AS child_name, child.parent_id AS old_parent_id,
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
            // „(keiner)" gilt nur ohne parent_id. Ein vorhandener Elternteil ohne Namen ist ein
            // Datenfehler und wird als solcher gezeigt, nicht als Wurzel weggeschrieben.
            'old_name' => $row['old_parent_id'] === null
                ? '(keiner)'
                : (string) ($row['old_name'] ?? '(unbekannt)'),
            'was_root' => $row['old_parent_id'] === null,
            'new_key' => (string) $row['new_key'],
            'new_name' => (string) $row['new_name'],
        ];
    }

    return $moves;
}
