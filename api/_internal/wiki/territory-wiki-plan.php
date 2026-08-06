<?php

declare(strict_types=1);

// The COMPUTE half of the territory WIKI COPY sync: it says what political_territory_wiki would get
// from the freshly staged dump, and writes nothing but plan rows. Design:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-territorien-design.md §4, session 4.
//
// 💣 WHY THIS SYNC EXISTS AT ALL: political_territory_wiki lost its writer when sync_territories was
// retired (review-wiki-sync.js:3516 ff.) -- but it is still read live: Hauptstadt, Oberhaupt, Sprache,
// Währung, Handelswaren, Blasonierung and the "Liegt in" resolver all come from it. The old
// "Unterschiede" button counted a gap no button could close.
//
// Side-effect-free on include: function definitions only.

/**
 * What is compared. Without id/synced_at: the first is identity, the second a clock. Without raw_json:
 * it is the RAW wikitext, it differs after every dump, and it would put every single territory into
 * the "Geändert" group forever. The WRITE still carries it -- only the comparison ignores it.
 */
const AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS = [
    'name', 'type', 'continent', 'affiliation_raw', 'affiliation_key', 'affiliation_root',
    'affiliation_path_json', 'affiliation_json', 'status', 'form_of_government', 'capital_name',
    'seat_name', 'ruler', 'language', 'currency', 'trade_goods', 'population', 'founded_text',
    'founded_type', 'founded_start_bf', 'founded_end_bf', 'founded_display_bf', 'founded_json',
    'founder', 'dissolved_text', 'dissolved_type', 'dissolved_start_bf', 'dissolved_end_bf',
    'dissolved_display_bf', 'dissolved_json', 'geographic', 'political', 'trade_zone', 'blazon',
    'wiki_url', 'coat_of_arms_url',
];

/** How many changed fields a row names before it says "+ N weitere Felder". */
const AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT = 6;

/**
 * One row of the copy preview. PURE.
 *
 * 💣 AN EMPTY FRESH VALUE IS NOT A CHANGE. If the dump has nothing for a field and the copy holds a
 * value, the value stays and the field is not named at all. Anything else offers an editor a tick that
 * throws away good data -- the trap that already sprang once on `continent`, where the apply UPDATE
 * still carries a COALESCE because of it (sync-monitor-identity.php).
 *
 * @param array<string,mixed>|null $mirror the political_territory_wiki row, NULL if there is none yet
 * @param array<string,mixed> $staging the political_territory_wiki_test row
 * @return array{change_type:string, before:array<string,string>, after:array<string,string>,
 *               override:array<string,string>}|null NULL = nothing to do
 */
function avesmapsTerritoryWikiPlanItem(?array $mirror, array $staging): ?array {
    $text = static fn($value): string => $value === null ? '' : trim((string) $value);

    if ($mirror === null) {
        $after = [];
        foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $field) {
            $fresh = $text($staging[$field] ?? null);
            if ($fresh !== '') {
                $after[$field] = $fresh;
            }
        }

        return ['change_type' => 'new', 'before' => [], 'after' => $after, 'override' => []];
    }

    $before = [];
    $after = [];
    foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $field) {
        $fresh = $text($staging[$field] ?? null);
        if ($fresh === '' || $fresh === $text($mirror[$field] ?? null)) {
            continue;
        }
        $before[$field] = $text($mirror[$field] ?? null);
        $after[$field] = $fresh;
    }

    if ($after === []) {
        return null;
    }

    $total = count($after);
    if ($total > AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT) {
        $after = array_slice($after, 0, AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT, true);
        $before = array_intersect_key($before, $after);
        // ⚠️ The counter is not decoration: the apply half compares this very array against a fresh
        // one, so a change in a field BEYOND the limit still shows up -- as a different count.
        $after['fields_more'] = (string) ($total - AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT);
    }

    return ['change_type' => 'changed', 'before' => $before, 'after' => $after, 'override' => []];
}

/**
 * The copies whose wiki article is gone, split into "may be removed" and "a territory hangs off it".
 *
 * 💣 AN EMPTY STAGING TABLE NEVER MEANS "DELETE EVERYTHING". It means the sync did not run. The same
 * gate the citymaps carry (avesmapsCitymapRemovableKeys) -- there the damage would have been a preview
 * proposing 457 deletions, here it would be every territory copy we have.
 *
 * 💣 A COPY A TERRITORY POINTS AT IS NEVER OFFERED. Six infobox lines hang off it and there is no wiki
 * article left to restore them from. It is still NAMED, in the group's lead: a number nobody can see
 * reads as "all done".
 *
 * @param list<string> $declinedKeys deletions an editor already refused, permanently
 * @return array{orphans:list<array{id:int,wiki_key:string,name:string}>,
 *               in_use:list<array{id:int,wiki_key:string,name:string}>}
 */
function avesmapsTerritoryWikiVanishedRows(PDO $pdo, array $declinedKeys): array {
    $staged = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
        ->fetchColumn() ?: 0);
    if ($staged === 0) {
        return ['orphans' => [], 'in_use' => []];
    }

    $declined = array_flip(array_map('strval', $declinedKeys));
    $rows = $pdo->query(
        'SELECT w.id, w.wiki_key, w.name,
                (SELECT COUNT(*) FROM political_territory t
                  WHERE t.is_active = 1 AND (t.wiki_id = w.id OR t.wiki_key = w.wiki_key)) AS map_count
           FROM political_territory_wiki w
          WHERE NOT EXISTS (SELECT 1 FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s
                             WHERE s.wiki_key = w.wiki_key)
          ORDER BY w.name ASC, w.id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $orphans = [];
    $inUse = [];
    foreach ($rows as $row) {
        $entry = ['id' => (int) $row['id'], 'wiki_key' => (string) $row['wiki_key'], 'name' => (string) $row['name']];
        if ((int) $row['map_count'] > 0) {
            $inUse[] = $entry;
            continue;
        }
        if (isset($declined[$entry['wiki_key']])) {
            continue;
        }
        $orphans[] = $entry;
    }

    return ['orphans' => $orphans, 'in_use' => $inUse];
}

/**
 * ONE bounded COMPUTE step over the staging table, resumable via a wiki_key high-water cursor.
 *
 * 🔴 THE HALF THAT DOES NOT WRITE. Plan rows only; sync-plan-purity-test.php walks everything this
 * reaches, at any depth, and asserts no live table is touched.
 *
 * The vanished rows are added in the FIRST step (empty cursor): they are one query over the whole
 * mirror, not a per-entity job, and doing them once keeps them out of every later step.
 *
 * @return array{done:bool, nextCursor:string, run_id:int, planned:int, processed:int,
 *               counts:array{new:int,changed:int,deleted:int,total:int}, in_use:list<array>}
 */
function avesmapsTerritoryWikiPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array {
    $budget = $budget ?? 200;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ DDL first and once: MySQL commits an open transaction implicitly when it sees DDL.
    avesmapsEnsureSyncPlanTables($pdo);

    // The run is derived from the cursor, never named by the client -- a run id off the wire would let
    // one editor write into another's plan.
    if ($cursor === '') {
        $stamp = (string) ($pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
            ->fetchColumn() ?: '');
        $runId = avesmapsSyncPlanStartRun($pdo, 'territory_wiki', $userId, $stamp === '' ? null : $stamp);
    } else {
        $runId = (int) (avesmapsSyncPlanBuildingRun($pdo, 'territory_wiki')['id'] ?? 0);
    }
    if ($runId <= 0) {
        throw new RuntimeException('Der Abgleich wurde von einem zweiten Lauf abgeloest. Bitte neu starten.');
    }

    // ONE read of the decision table per step, not one per row: the loop STRATO cannot take.
    $decisions = avesmapsSyncPlanDecisions($pdo, 'territory_wiki');
    $inUse = [];

    if ($cursor === '') {
        $vanished = avesmapsTerritoryWikiVanishedRows($pdo, avesmapsSyncPlanDeclinedKeys($pdo, 'territory_wiki'));
        $inUse = $vanished['in_use'];
        foreach ($vanished['orphans'] as $orphan) {
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $orphan['wiki_key'],
                'entity_public_id' => null,
                'change_type' => 'deleted',
                'label' => $orphan['name'],
                'before' => [],
                'after' => [],
                'override' => [],
                'selected' => avesmapsSyncPlanDefaultSelected('deleted', 0),
            ]);
        }
    }

    $select = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
        . ' WHERE wiki_key > :cur ORDER BY wiki_key ASC LIMIT :lim'
    );
    $select->bindValue(':cur', $cursor, PDO::PARAM_STR);
    $select->bindValue(':lim', max(1, $budget), PDO::PARAM_INT);
    $select->execute();
    $stagingRows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $mirrorFind = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE wiki_key = :wk LIMIT 1');
    $planned = 0;
    $processed = 0;
    $nextCursor = $cursor;
    $timedOut = false;

    foreach ($stagingRows as $staging) {
        $nextCursor = (string) $staging['wiki_key'];
        $processed++;

        $mirrorFind->execute(['wk' => $nextCursor]);
        $mirror = $mirrorFind->fetch(PDO::FETCH_ASSOC) ?: null;
        $item = avesmapsTerritoryWikiPlanItem($mirror, $staging);

        if ($item !== null) {
            $decision = $decisions[avesmapsSyncPlanDecisionKey($nextCursor, $item['change_type'])] ?? null;
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $nextCursor,
                'entity_public_id' => null,
                'change_type' => $item['change_type'],
                'label' => (string) ($staging['name'] ?? $nextCursor),
                'before' => $item['before'],
                'after' => $item['after'],
                'override' => $item['override'],
                'selected' => avesmapsSyncPlanDefaultSelected($item['change_type'], (int) ($decision['skipped_count'] ?? 0)),
            ]);
            $planned++;
        }

        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }

    $done = !$timedOut && count($stagingRows) < max(1, $budget);
    $counts = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    if ($done) {
        $counts = avesmapsSyncPlanFinishBuild($pdo, $runId);
        // 💣 Der Satz über die NICHT angebotenen Kopien reist in counts_json mit -- er ist das einzige
        // Stück der Vorschau, das der Server formulieren muss, weil nur er weiss, welche Kopie ein
        // Kartengebiet benutzt. Neu gerechnet statt über die Schritte getragen: dieselbe eine Abfrage,
        // einmal am Ende, und kein Zustand, der zwischen Requests verlorengehen kann.
        $protected = avesmapsTerritoryWikiVanishedRows($pdo, [])['in_use'];
        // 💣 The terminating response must carry the SAME rows the sentence below talks about. Leaving
        // $inUse at whatever the first step (cursor === '') set left it EMPTY on every later step's
        // terminating response -- the normal path, since the territory table is far above the 200-row
        // budget -- while counts['protected_note'] stayed correct. A caller reading the raw rows off
        // that response got nothing: exactly the "looks like all done" failure the 💣 comment on
        // avesmapsTerritoryWikiVanishedRows warns about.
        $inUse = $protected;
        if ($protected !== []) {
            $isSingle = count($protected) === 1;
            $names = array_map(static fn(array $r): string => $r['name'], array_slice($protected, 0, 10));
            $counts['protected_note'] = sprintf(
                '%d weitere %s ebenfalls keinen Artikel mehr, %s aber an einem Gebiet auf der Karte '
                . '(%s%s). %s stehen und %s hier nicht angeboten.',
                count($protected),
                $isSingle ? 'Kopie hat' : 'Kopien haben',
                $isSingle ? 'hängt' : 'hängen',
                implode(', ', $names),
                count($protected) > 10 ? ', …' : '',
                $isSingle ? 'Sie bleibt' : 'Sie bleiben',
                $isSingle ? 'wird' : 'werden'
            );
            $pdo->prepare('UPDATE sync_plan_run SET counts_json = :c WHERE id = :id')->execute([
                'c' => json_encode($counts, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'id' => $runId,
            ]);
        }
    }

    return [
        'done' => $done,
        'nextCursor' => $nextCursor,
        'run_id' => $runId,
        'planned' => $planned,
        'processed' => $processed,
        'counts' => $counts,
        'in_use' => $inUse,
    ];
}
