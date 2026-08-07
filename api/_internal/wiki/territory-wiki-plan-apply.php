<?php

declare(strict_types=1);

// The APPLY half of the territory WIKI COPY sync: it works through the rows an editor ticked and
// writes exactly those. Design: …/2026-08-06-sync-uebernahme-territorien-design.md §4, session 4.
//
// 💣 IT WRITES BY CALLING THE UNCHANGED avesmapsPoliticalUpsertWikiRecord -- the same function that
// filled political_territory_wiki for as long as it had a writer. The only thing this change moves is
// WHO decides that it runs: the crawler before, a tick now.
//
// It lives in its own file so the compute half can be shown not to reach a writer
// (__tests__/sync-plan-purity-test.php walks the call graph from avesmapsTerritoryWikiPlanStep).
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * Is a staging value "nothing"? PURE.
 *
 * 💣 IT IS THE COMPUTE HALF'S TEST, ON PURPOSE. avesmapsTerritoryWikiPlanItem refuses to name a field
 * whose fresh value is `trim((string) $fresh) === ''` (design §4). If the two halves used different
 * notions of empty, the preview would name a field the apply keeps -- or, worse, keep one the preview
 * named. A preview that does not describe the write is not a preview.
 *
 * 💣 `0` IS A VALUE HERE, NOT NOTHING -- even though the parser writes 0 into founded_start_bf when the
 * article carries no date at all (`(int) $temporal['founded_start_bf']`, sync-monitor-parsing.php:542).
 * Calling 0 empty is tempting and wrong: the compute half compares '0' as a value, so a copy holding
 * 1050 against a staging 0 IS offered as "Gegründet: 1050 → 0". Swallowing it here would leave that
 * ticked row reported as `applied` while nothing was written -- the same silent lie in the other
 * direction. A bogus 0 is a parser problem and belongs in the parser, not in a second, invisible rule
 * on the write path.
 *
 * The *_json columns come out of PDO as strings and are compared as strings by the compute half, so
 * they follow the same rule. An array (a caller that decoded first) is empty only when it is [] --
 * exactly what avesmapsPoliticalEncodeJsonOrNull turns into NULL.
 */
function avesmapsTerritoryWikiStagingValueIsEmpty(mixed $value): bool {
    if ($value === null) {
        return true;
    }
    if (is_array($value)) {
        return $value === [];
    }

    return trim((string) $value) === '';
}

/**
 * A staging row, shaped into the record avesmapsPoliticalUpsertWikiRecord expects. PURE.
 *
 * 💣 THE MIRROR ROW IS NOT OPTIONAL DECORATION. The upsert writes ALL 36 columns
 * (`ON DUPLICATE KEY UPDATE <col> = VALUES(<col>)`), and avesmapsPoliticalNullableString('') is NULL --
 * so handing it the raw staging row NULLs every field the dump happens not to carry, no matter what the
 * preview said. The copy is the live source of Hauptstadt, Oberhaupt, Sprache, Währung, Handelswaren
 * and Blasonierung, and it has no backup: a row whose preview showed one line ("Oberhaupt: A → B")
 * would silently empty five others. So for every column the staging leaves empty, the mirror's value
 * is carried over -- which is design §4's "ein leerer frischer Wert ist keine Änderung", applied to the
 * write instead of only to the list.
 *
 * 💣 THE JSON COLUMNS MUST BE DECODED FIRST. The upsert pushes every *_json value through
 * avesmapsPoliticalEncodeJsonOrNull, which calls json_encode -- hand it the staging column verbatim
 * and the copy stores a DOUBLE-encoded string. Silent: the field is filled, the preview row looked
 * right, and only the infobox shows the quotes. The carry-over above happens BEFORE the decoding, so a
 * value taken from the mirror (also a JSON string) goes through the same decode.
 *
 * id and synced_at are dropped: the first is the staging table's own identity, the second its clock --
 * and because the loop below walks the trimmed record, neither can be carried back in from the mirror.
 *
 * @param array<string,mixed> $row
 * @param array<string,mixed>|null $mirror the political_territory_wiki row, NULL for a NEW copy
 * @return array<string,mixed>
 */
function avesmapsTerritoryWikiRecordFromStagingRow(array $row, ?array $mirror = null): array {
    $jsonColumns = ['affiliation_path_json', 'affiliation_json', 'founded_json', 'dissolved_json', 'raw_json'];
    $record = $row;
    unset($record['id'], $record['synced_at']);

    if ($mirror !== null) {
        foreach ($record as $column => $value) {
            if (!array_key_exists($column, $mirror) || !avesmapsTerritoryWikiStagingValueIsEmpty($value)) {
                continue;
            }
            $record[$column] = $mirror[$column];
        }
    }

    foreach ($jsonColumns as $column) {
        $value = $record[$column] ?? null;
        if (is_array($value)) {
            continue;
        }
        $decoded = ($value === null || $value === '') ? null : json_decode((string) $value, true);
        $record[$column] = is_array($decoded) ? $decoded : [];
    }

    // The upsert reads 'slug' for nothing on this path, but avesmapsPoliticalNormalizeWikiRecord's
    // consumers expect the key to exist. Derive it the same way the normaliser does.
    if (!isset($record['slug']) || (string) $record['slug'] === '') {
        $record['slug'] = avesmapsPoliticalSlug((string) ($record['name'] ?? ''));
    }

    return $record;
}

/**
 * ONE bounded apply step. Resumable: every handled row carries its apply_state.
 *
 * 💣 NO try/catch AROUND THE ROW. A "this one is broken, carry on" catch would move the run past a
 * row that was rolled back; here an exception leaves the loop, the client reports it, and a second
 * click resumes exactly there.
 *
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsTerritoryWikiApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array {
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    avesmapsEnsureSyncPlanTables($pdo);

    $totals = ['applied' => 0, 'deleted' => 0, 'stale' => 0, 'processed' => 0];
    $stagingFind = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
        . ' WHERE wiki_key = :wk LIMIT 1');
    $mirrorFind = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE wiki_key = :wk LIMIT 1');
    $usedBy = $pdo->prepare('SELECT COUNT(*) FROM political_territory t
        JOIN political_territory_wiki w ON w.wiki_key = :wk
        WHERE t.is_active = 1 AND (t.wiki_id = w.id OR t.wiki_key = :wk2)');
    $deleteMirror = $pdo->prepare('DELETE FROM political_territory_wiki WHERE wiki_key = :wk');
    $declined = array_flip(avesmapsSyncPlanDeclinedKeys($pdo, 'territory_wiki'));

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];
        $changeType = (string) $row['change_type'];

        $stagingFind->execute(['wk' => $wikiKey]);
        $staging = $stagingFind->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($changeType === 'deleted') {
            $usedBy->execute(['wk' => $wikiKey, 'wk2' => $wikiKey]);
            $refusal = '';
            if ($staging !== null) {
                $refusal = 'Der Artikel steht wieder im Wiki.';
            } elseif (isset($declined[$wikiKey])) {
                $refusal = 'Die Loeschung wurde inzwischen abgelehnt.';
            } elseif ((int) $usedBy->fetchColumn() > 0) {
                // 💣 The re-check that matters most: a territory was linked to this copy since the
                // preview was computed. Deleting now would strip six infobox lines off a live object.
                $refusal = 'Inzwischen haengt ein Gebiet der Karte an dieser Kopie.';
            }
            if ($refusal !== '') {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $refusal);
                $totals['stale']++;
            } else {
                $deleteMirror->execute(['wk' => $wikiKey]);
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['deleted']++;
            }
        } elseif ($staging === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Im Staging nicht mehr enthalten.');
            $totals['stale']++;
        } else {
            // 💣 THE RE-CHECK (design §6f), recomputed with the SAME function that built the row.
            $mirrorFind->execute(['wk' => $wikiKey]);
            $mirror = $mirrorFind->fetch(PDO::FETCH_ASSOC) ?: null;
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsTerritoryWikiPlanItem($mirror, $staging);
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $fresh['after'] ?? null)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                // 💣 The mirror row goes WITH the staging row: without it the upsert NULLs every column
                // the dump left empty, including the ones the preview promised to leave alone.
                avesmapsPoliticalUpsertWikiRecord($pdo, avesmapsTerritoryWikiRecordFromStagingRow($staging, $mirror));
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
        $closing = avesmapsTerritoryWikiApplyFinish($pdo, $runId, $userId, $user);
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
 * Everything that happens ONCE, after the last ticked row.
 *
 * Structure- and word-for-word with avesmapsCitymapApplyFinish (citymap-plan-apply.php:145-234), with
 * three differences: the sync kind name, the closing act (a relink instead of a place resolve and a
 * "last synced" setting), and busting BOTH caches instead of one.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsTerritoryWikiApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array {
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
            avesmapsSyncPlanRecordSkip($pdo, 'territory_wiki', $key, $userId);
            $skipped++;
        } elseif (!$isSelected && $type === 'deleted') {
            avesmapsSyncPlanRecordDecline($pdo, 'territory_wiki', $key, $userId);
            $declined++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'territory_wiki', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // Freshly created copies get their territory link. The same relink the old crawl ended with -- a
    // copy nobody points at is invisible to territory-detail, and that is where the infobox reads.
    avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey($pdo);

    // 💣 BOTH caches. political_territory_wiki is LEFT JOINed by map-features (the "Liegt in" resolver,
    // map-features.php:589) AND by the political layer, which keeps a 300 s file cache of its own. A
    // revision bump alone would leave the layer serving the pre-Übernahme payload for five minutes.
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }
    if (function_exists('avesmapsPoliticalInvalidateLayerCache')) {
        avesmapsPoliticalInvalidateLayerCache();
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
        'territory_wiki',
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
