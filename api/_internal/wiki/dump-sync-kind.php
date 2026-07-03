<?php

declare(strict_types=1);

/**
 * WikiDump per-kind "Syncen" step + SHARP settlement-conflict generation.
 * ===========================================================================
 * Wave 1 (backend) of the 3-wave WikiDump "Syncen" rollout. This is the sharp
 * sibling of the read-only dry-run (settlement-conflicts-dryrun.php): where the
 * dry-run MIRRORS the settlement match+classify and writes NOTHING, this file
 * WRITES -- but only ever into STAGING and wiki_sync_cases (+ the territory
 * model on a territory sync), NEVER into map_features or the live
 * political_territory tables.
 *
 * WHAT "Dump holen" ALREADY DID (the sandbox this reads):
 *   The read pass (dump-hybrid-read.php) scanned the dump and staged every
 *   recognised page as a wiki_dump_hybrid_state row tagged with entity_kind
 *   ('path'|'region'|'settlement'|'building'|'territory') and its raw wikitext
 *   (wikitext_found_at IS NOT NULL). Those rows belong to a dump_read run
 *   (wiki_sync_runs.sync_type = 'dump_read'). This file reads the NEWEST
 *   COMPLETED dump_read run's rows, FILTERED to the requested kind, and turns
 *   them into staging rows using the EXACT SAME per-kind upserts the sharp
 *   apply path already uses (avesmapsWikiDumpHybridParseRow +
 *   avesmapsWikiDumpHybridUpsertParsedRow) -- zero new upsert/parse code.
 *
 * WHY A PER-KIND SIBLING TO apply/read_step (not a reuse of them):
 *   apply drives the WHOLE dump (every kind at once) off a shared processed_at
 *   cursor. The "Syncen" GUI (Wave 2) is per-kind: the owner clicks "Wege
 *   syncen", reviews, then "Regionen syncen", etc. So this step:
 *     - filters the sandbox rows to ONE kind's entity_kind set,
 *     - drives off an id > cursor high-water mark (client-loopable, like
 *       read_step), and
 *     - deliberately does NOT mark processed_at, so a per-kind sync is
 *       INDEPENDENT of the apply flow and idempotently re-runnable (every
 *       staging table is UNIQUE(wiki_key) / UNIQUE(title) -> a re-run is a
 *       last-write-wins no-op, never a duplicate).
 *   It reuses the apply path's upsert body VERBATIM
 *   (avesmapsWikiDumpHybridUpsertParsedRow), including the settlement->territory
 *   DUAL-PARSE, so a promoted Siedlung still lands in BOTH wiki_sync_pages and
 *   political_territory_wiki_test exactly as the online crawler did.
 *
 * THE 5 KINDS -> entity_kind SET:
 *   'path'       -> ['path']
 *   'region'     -> ['region']
 *   'settlement' -> ['settlement', 'building']  (buildings/gebaeude live on the
 *                   Siedlungen tab, plan §6.1; both write wiki_sync_pages)
 *   'territory'  -> ['territory']
 *
 * AFTER the last step of a kind (done=true):
 *   - territory   -> avesmapsWikiSyncMonitorRebuildModel($pdo) (refreshes
 *                    parent_conflict, PRESERVES parent_locked / metadata
 *                    overrides -- I4).
 *   - settlement  -> avesmapsWikiDumpSettlementConflictsGenerate($pdo, ...)
 *                    (the SHARP conflict-case writer -- section 2 below).
 *
 * EVERYTHING runs UNDER the single-flight dump lock (the dump.php action
 * acquires/heartbeats/releases it, mirroring read_step). strict_types +
 * parameterized PDO throughout.
 *
 * PURITY CONTRACT: side-effect-free on include (only const + function defs --
 * no top-level code, no DB connect, no headers), so
 * tools/wikidump/test-dump-sync-kind.php can `require` it with no MySQL and
 * drive the case writer against a fake PDO.
 *
 * DEPENDENCIES (dump.php loads these before requiring this file): the full wiki
 * parse chain (sync.php, sync-monitor.php, territories/paths/regions/
 * settlements/locations, dump-reader, dump-entity-scan, dump-hybrid-read) plus
 * settlement-conflicts-dryrun.php (the pure classifier reused by the sharp
 * writer). This file requires nothing on include.
 */

require_once __DIR__ . '/settlement-conflicts-dryrun.php';

// ===========================================================================
// Constants.
// ===========================================================================

/**
 * The four task-facing kinds the "Syncen" step accepts (the GUI's per-kind
 * buttons). NOTE: 'building'/gebaeude is NOT a separate task kind -- it is
 * folded into 'settlement' (plan §6.1), so the GUI never syncs buildings on
 * their own.
 */
const AVESMAPS_WIKI_DUMP_SYNC_KINDS = ['path', 'region', 'settlement', 'territory'];

/**
 * Max sandbox rows processed per sync_kind step. Kept identical to the apply
 * path's per-step page budget so one bounded step's DB work is the same order
 * of magnitude the apply loop already runs safely on STRATO (28s step deadline).
 */
const AVESMAPS_WIKI_DUMP_SYNC_KIND_STEP_BUDGET = AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET;

// ===========================================================================
// 1. PURE kind mapping.
// ===========================================================================

/**
 * PURE: map a task-facing kind to the set of wiki_dump_hybrid_state.entity_kind
 * values it consumes. Buildings are folded into 'settlement'; every other kind
 * maps to itself. Returns [] for an unknown kind so the caller can reject it.
 *
 * @return list<string> the entity_kind values to filter the sandbox by
 */
function avesmapsWikiDumpSyncKindEntityKinds(string $taskKind): array
{
    switch ($taskKind) {
        case 'path':
            return [AVESMAPS_WIKI_DUMP_ENTITY_PATH];
        case 'region':
            return [AVESMAPS_WIKI_DUMP_ENTITY_REGION];
        case 'settlement':
            // gebaeude are settlements for the Siedlungen tab (plan §6.1).
            return [AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT, AVESMAPS_WIKI_DUMP_ENTITY_BUILDING];
        case 'territory':
            return [AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY];
        default:
            return [];
    }
}

// ===========================================================================
// 2. Resolve the newest completed dump_read run (the sandbox to read).
// ===========================================================================

/**
 * Return the integer wiki_sync_runs.id of the NEWEST COMPLETED dump_read run
 * (sync_type = 'dump_read', status = 'completed', newest by completed_at). This
 * is the run whose wiki_dump_hybrid_state rows "Dump holen" left in the sandbox
 * (cleanup_state keeps exactly one such run's rows). Throws if none has ever
 * completed (nothing to sync).
 *
 * The id (not the public_id) is what wiki_dump_hybrid_state.run_id references,
 * so it is the join key for reading the sandbox rows.
 */
function avesmapsWikiDumpSyncKindResolveDumpRunId(PDO $pdo): int
{
    $statement = $pdo->prepare(
        "SELECT id
           FROM wiki_sync_runs
          WHERE sync_type = :sync_type AND status = 'completed'
          ORDER BY completed_at DESC, id DESC
          LIMIT 1"
    );
    $statement->execute(['sync_type' => AVESMAPS_WIKI_DUMP_SYNC_TYPE]);
    $runId = $statement->fetchColumn();
    if ($runId === false) {
        throw new RuntimeException('No completed dump_read run found - fetch and read a dump first ("Dump holen").');
    }

    return (int) $runId;
}

/**
 * Fetch a dump_read run row by its integer id (for the endpoint's response
 * `run` object). Returns the raw wiki_sync_runs row, or null if it vanished.
 * Thin DB accessor.
 *
 * @return array<string, mixed>|null
 */
function avesmapsWikiDumpSyncKindFetchRunById(PDO $pdo, int $runId): ?array
{
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_runs WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $runId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? $row : null;
}

// ===========================================================================
// 3. Kind-filtered sandbox row reads (progress total + one bounded window).
// ===========================================================================

/**
 * Count the FILLED sandbox rows for a run in the given entity_kind set
 * (wikitext_found_at IS NOT NULL). With $maxIdInclusive = null this is the
 * sync's progress TOTAL (all filled rows of the kind). With $maxIdInclusive set
 * to the current cursor it is the accurate progress PROCESSED count (rows the
 * sync has already stepped past): the cursor is a row-id high-water mark and ids
 * are NOT contiguous within a kind (a settlement run's territory rows interleave
 * by id), so a raw cursor value is a poor "processed" proxy -- COUNT(id <= cursor)
 * is exact. Thin DB accessor.
 *
 * @param list<string> $entityKinds one or more wiki_dump_hybrid_state.entity_kind values
 * @param int|null $maxIdInclusive null = total; a value = count rows with id <= it
 */
function avesmapsWikiDumpSyncKindCountRows(PDO $pdo, int $runId, array $entityKinds, ?int $maxIdInclusive = null): int
{
    if ($entityKinds === []) {
        return 0;
    }

    [$placeholders, $params] = avesmapsWikiDumpSyncKindInClause($entityKinds);

    $sql = 'SELECT COUNT(*)
              FROM wiki_dump_hybrid_state
             WHERE run_id = :run_id
               AND entity_kind IN (' . $placeholders . ')
               AND wikitext_found_at IS NOT NULL';
    if ($maxIdInclusive !== null) {
        $sql .= ' AND id <= :max_id';
    }

    $statement = $pdo->prepare($sql);
    foreach ($params as $name => $value) {
        $statement->bindValue(':' . $name, $value, PDO::PARAM_STR);
    }
    $statement->bindValue(':run_id', $runId, PDO::PARAM_INT);
    if ($maxIdInclusive !== null) {
        $statement->bindValue(':max_id', max(0, $maxIdInclusive), PDO::PARAM_INT);
    }
    $statement->execute();

    return (int) $statement->fetchColumn();
}

/**
 * Fetch up to $budget FILLED sandbox rows for a run in the given entity_kind
 * set, past the id cursor, in id order. Mirrors
 * avesmapsWikiDumpHybridFetchProcessableRows (dump-hybrid-read.php) EXCEPT it
 * filters by entity_kind and does NOT require processed_at IS NULL -- a per-kind
 * sync is driven by the id cursor alone (it never marks processed_at), so it can
 * be re-run idempotently and is independent of the apply flow's processed_at.
 *
 * The selected columns are exactly what avesmapsWikiDumpHybridParseRow() needs
 * (normalized_title, override_*, wikitext) plus id (the cursor).
 *
 * @param list<string> $entityKinds one or more entity_kind values
 * @return list<array<string, mixed>>
 */
function avesmapsWikiDumpSyncKindFetchRows(PDO $pdo, int $runId, array $entityKinds, int $cursor, int $budget): array
{
    if ($entityKinds === []) {
        return [];
    }

    [$placeholders, $params] = avesmapsWikiDumpSyncKindInClause($entityKinds);

    $statement = $pdo->prepare(
        'SELECT id, normalized_title, override_class, override_building_type, override_continent, wikitext
           FROM wiki_dump_hybrid_state
          WHERE run_id = :run_id
            AND entity_kind IN (' . $placeholders . ')
            AND wikitext_found_at IS NOT NULL
            AND id > :cursor
          ORDER BY id
          LIMIT :budget'
    );
    foreach ($params as $name => $value) {
        $statement->bindValue(':' . $name, $value, PDO::PARAM_STR);
    }
    $statement->bindValue(':run_id', $runId, PDO::PARAM_INT);
    $statement->bindValue(':cursor', max(0, $cursor), PDO::PARAM_INT);
    $statement->bindValue(':budget', max(1, $budget), PDO::PARAM_INT);
    $statement->execute();

    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    return is_array($rows) ? $rows : [];
}

/**
 * PURE helper: build a positional-safe named IN() clause + bound params for a
 * list of entity_kind strings (e.g. :ek0, :ek1). Avoids interpolating the
 * values into SQL. Returns [placeholderString, name=>value map] where the names
 * are WITHOUT the leading ':'.
 *
 * @param list<string> $entityKinds
 * @return array{0:string, 1:array<string,string>}
 */
function avesmapsWikiDumpSyncKindInClause(array $entityKinds): array
{
    $placeholders = [];
    $params = [];
    $i = 0;
    foreach ($entityKinds as $entityKind) {
        $name = 'ek' . $i;
        $placeholders[] = ':' . $name;
        $params[$name] = (string) $entityKind;
        $i++;
    }

    return [implode(', ', $placeholders), $params];
}

// ===========================================================================
// 4. ONE bounded per-kind sync step (client-loopable; STAGING-only writes).
// ===========================================================================

/**
 * Process ONE bounded sync_kind step: read up to $budget filled sandbox rows for
 * $runId in the task kind's entity_kind set past $cursor, parse each with
 * avesmapsWikiDumpHybridParseRow() and upsert it with
 * avesmapsWikiDumpHybridUpsertParsedRow() -- the SHARP per-kind upsert the apply
 * path already uses (VERBATIM, including the settlement->territory dual-parse).
 * Writes ONLY staging tables. The cursor is a wiki_dump_hybrid_state.id
 * high-water mark; done=true when fewer than a full budget were scanned (the
 * kind's filled set is drained for this run).
 *
 * NOT marked processed_at (see file docblock): a per-kind sync is idempotent and
 * independent of the apply flow.
 *
 * The territory model rebuild + settlement conflict generation are triggered by
 * the CALLER on done (they are one-shot post-passes over the WHOLE staging
 * table, not per-step work) -- see the 'sync_kind' case in api/edit/wiki/dump.php.
 *
 * @param string        $taskKind        one of AVESMAPS_WIKI_DUMP_SYNC_KINDS
 * @param int           $cursor          state-row id high-water mark
 * @param int|null      $budget          rows this step (default AVESMAPS_WIKI_DUMP_SYNC_KIND_STEP_BUDGET)
 * @param callable|null $rowFetcher      test seam: (pdo, runId, entityKinds, cursor, budget) => list<row>
 * @param array<string, callable>|null $upsertOverrides test seam threaded to avesmapsWikiDumpHybridUpsertParsedRow (kind => spy)
 * @return array{ok:bool, done:bool, nextCursor:int, processed_this_step:int, kept:int, entity_kinds:list<string>}
 */
function avesmapsWikiDumpSyncKindStep(
    PDO $pdo,
    int $runId,
    string $taskKind,
    int $cursor = 0,
    ?int $budget = null,
    ?callable $rowFetcher = null,
    ?array $upsertOverrides = null
): array {
    $budget = $budget ?? AVESMAPS_WIKI_DUMP_SYNC_KIND_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);

    $entityKinds = avesmapsWikiDumpSyncKindEntityKinds($taskKind);
    if ($entityKinds === []) {
        throw new InvalidArgumentException('Unknown WikiDump sync kind: ' . $taskKind);
    }

    // Guard the settlement enrichment/schema columns exactly as the apply path
    // does before its settlement/building upserts (idempotent, harmless for the
    // other kinds -- the same call the sharp parse_and_upsert makes).
    avesmapsWikiSettlementEnsureSchema($pdo);

    $rows = $rowFetcher !== null
        ? $rowFetcher($pdo, $runId, $entityKinds, $cursor, $budget)
        : avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, $entityKinds, $cursor, $budget);

    $processedThisStep = 0;
    $kept = 0;
    $maxId = max(0, $cursor);

    foreach ($rows as $row) {
        $processedThisStep++;
        $rowId = (int) ($row['id'] ?? 0);
        if ($rowId > $maxId) {
            $maxId = $rowId;
        }

        // Parse via the SAME classifier+handler the apply path uses (with the
        // row's override triple). Then upsert VERBATIM via the shared sharp
        // dispatcher -- including the settlement->territory dual-parse, which
        // emits the promoted territory row into political_territory_wiki_test.
        $parsed = avesmapsWikiDumpHybridParseRow($row);

        if ($parsed['kept'] && is_array($parsed['record'])) {
            avesmapsWikiDumpHybridUpsertParsedRow($pdo, $parsed, $upsertOverrides);
            $kept++;
        }
        if (is_array($parsed['territory_record'] ?? null)) {
            avesmapsWikiDumpHybridUpsertParsedRow(
                $pdo,
                [
                    'kind' => AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY,
                    'title' => $parsed['title'],
                    'record' => $parsed['territory_record'],
                ],
                $upsertOverrides
            );
            $kept++;
        }
    }

    $done = $processedThisStep < $budget; // fewer than a full batch -> kind drained

    return [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $maxId,
        'processed_this_step' => $processedThisStep,
        'kept' => $kept,
        'entity_kinds' => $entityKinds,
    ];
}

// ===========================================================================
// 5. SHARP settlement-conflict generation (the ONE new sharp classifier write).
// ===========================================================================

/**
 * coordinate_drift threshold (image-space 0..1024 units) for the SHARP
 * standalone `coordinate_drift` case. Reuses the SAME field_divergence bar the
 * dry-run promoted (20.0u): comfortably clears rounding + positionskarte
 * coarseness, still catches a marker dragged tens of units off. Named here so
 * the sharp writer's coordinate bar is tunable from one place, independent of
 * the dry-run's own (unchanged) 5.0u informational scan.
 */
const AVESMAPS_WIKI_DUMP_COORD_DRIFT_CASE_UNITS = AVESMAPS_WIKIDUMP_FIELD_DIVERGENCE_COORD_UNITS;

/**
 * Resolve the integer wiki_sync_runs.id the settlement conflict cases key to.
 * The cases live in wiki_sync_cases keyed by first_seen_run_id/last_seen_run_id
 * (a LOCATION run, sync_type = 'location' -- the SAME run type the online
 * settlement crawl used, so the existing cases-list endpoint / summary, which
 * read the latest completed location run, surface these cases unchanged).
 *
 * REUSE-OR-MINT: prefer the newest COMPLETED location run (so repeated dump
 * settlement syncs append to the SAME run the frontend shows, and
 * avesmapsWikiSyncUpsertCase's signature-based preservation of reviewed_at/
 * reviewed_by/resolution_json works across runs). If none has ever completed,
 * mint a fresh completed location run so there is a run to key to (and for the
 * cases-list endpoint to find). The minted row is minimal but valid
 * (status='completed', completed_at now) so ListCases treats it as the latest.
 *
 * @param int $userId acting editor id (created_by on a minted run); 0 -> NULL
 */
function avesmapsWikiDumpSettlementCaseRunId(PDO $pdo, int $userId): int
{
    avesmapsWikiSyncEnsureLocationTables($pdo);

    // Newest COMPLETED *location* run specifically. NB: avesmapsWikiSyncFetchLatestCompletedRun()
    // is NOT type-filtered -- it would return the newer completed dump_read run, which
    // is the WRONG run to key location cases to. So this queries sync_type = 'location'.
    $existingStatement = $pdo->prepare(
        "SELECT id
           FROM wiki_sync_runs
          WHERE sync_type = :sync_type AND status = 'completed'
          ORDER BY completed_at DESC, id DESC
          LIMIT 1"
    );
    $existingStatement->execute(['sync_type' => AVESMAPS_WIKI_SYNC_TYPE_LOCATION]);
    $existingId = $existingStatement->fetchColumn();
    if ($existingId !== false) {
        return (int) $existingId;
    }

    // Mint a fresh completed location run to key the cases to.
    $publicId = avesmapsWikiSyncUuidV4();
    $statement = $pdo->prepare(
        'INSERT INTO wiki_sync_runs
            (public_id, sync_type, status, phase, progress_current, progress_total, message, stats_json, created_by, completed_at)
         VALUES
            (:public_id, :sync_type, :status, :phase, :progress_current, :progress_total, :message, :stats_json, :created_by, CURRENT_TIMESTAMP(3))'
    );
    $statement->execute([
        'public_id' => $publicId,
        'sync_type' => AVESMAPS_WIKI_SYNC_TYPE_LOCATION,
        'status' => 'completed',
        'phase' => 'completed',
        'progress_current' => 4,
        'progress_total' => 4,
        'message' => 'WikiDump settlement conflicts.',
        'stats_json' => avesmapsWikiSyncEncodeJson([]),
        'created_by' => $userId > 0 ? $userId : null,
    ]);

    return (int) $pdo->lastInsertId();
}

/**
 * Read the FILLED settlement sandbox records for a dump_read run and return them
 * as avesmapsWikiDumpParseSettlementPage-shaped records (the shape the dry-run
 * classifier consumes: title, normalized_key, settlement_class, wiki_url,
 * coordinates_json, is_ruined, coat_url, continent, ...). Buildings are INCLUDED
 * here (settlement_class='gebaeude') because the dry-run orchestration filters
 * them out itself (avesmapsWikiDumpDryRunClassifySettlements), so passing them in
 * keeps that gebaeude-filter accounting honest.
 *
 * These are the SAME records the sharp settlement upsert wrote, re-derived from
 * the SAME sandbox wikitext via avesmapsWikiDumpHybridParseRow -- so the cases
 * describe exactly the settlement rows the sync just staged.
 *
 * @return list<array<string, mixed>>
 */
function avesmapsWikiDumpSettlementRecordsFromSandbox(PDO $pdo, int $runId): array
{
    $records = [];
    $cursor = 0;
    $budget = AVESMAPS_WIKI_DUMP_SYNC_KIND_STEP_BUDGET;
    $entityKinds = avesmapsWikiDumpSyncKindEntityKinds('settlement');

    // Page through every filled settlement/building row (bounded windows, but no
    // time cap: this runs once on `done`, over the same set the sync just staged).
    while (true) {
        $rows = avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, $entityKinds, $cursor, $budget);
        if ($rows === []) {
            break;
        }
        foreach ($rows as $row) {
            $rowId = (int) ($row['id'] ?? 0);
            if ($rowId > $cursor) {
                $cursor = $rowId;
            }
            $parsed = avesmapsWikiDumpHybridParseRow($row);
            // Only the settlement/building record feeds the settlement classifier
            // (a promoted Siedlung's territory_record is NOT a settlement case).
            if (
                in_array((string) ($parsed['kind'] ?? ''), $entityKinds, true)
                && $parsed['kept']
                && is_array($parsed['record'])
            ) {
                $records[] = $parsed['record'];
            }
        }
        if (count($rows) < $budget) {
            break;
        }
    }

    return $records;
}

/**
 * PURE: euclidean drift (image-space units) between a dump settlement's converted
 * wiki coordinate and its matched map feature geometry, PLUS both endpoints in
 * 0..1024 map units (pre-converted), so the sharp coordinate_drift case can carry
 * them for Wave 3 to draw a line WITHOUT re-deriving. Reuses
 * avesmapsWikiDumpDryRunCoordinateDrift (the dry-run's own drift measure) for the
 * distance, and avesmapsWikiSyncCoordinatesToMapLocation (the same transform) for
 * the wiki endpoint -- both VERBATIM, so the sharp positions match the dry-run's.
 *
 * Returns null when either side has no usable coordinate (no case). On success:
 *   {
 *     drift_units: float,
 *     map:  {lat: float, lng: float},   // the map feature geometry [y,x] in 0..1024
 *     wiki: {lat: float, lng: float},   // the wiki coordinate converted into 0..1024
 *   }
 *
 * @param array<string, mixed> $mapPlace   avesmapsWikiSyncReadMapPlaces() entry (carries 'geometry')
 * @param array<string, mixed> $wikiRecord dump settlement record (carries 'coordinates_json')
 * @return array{drift_units:float, map:array{lat:float,lng:float}, wiki:array{lat:float,lng:float}}|null
 */
function avesmapsWikiDumpSettlementCoordinatePositions(array $mapPlace, array $wikiRecord): ?array
{
    $drift = avesmapsWikiDumpDryRunCoordinateDrift($mapPlace, $wikiRecord);
    if ($drift === null) {
        return null;
    }

    $coordinates = is_array($wikiRecord['coordinates_json'] ?? null) ? $wikiRecord['coordinates_json'] : null;
    if ($coordinates === null) {
        return null;
    }
    $wikiLocation = avesmapsWikiSyncCoordinatesToMapLocation($coordinates); // -> {lat, lng} in 0..1024, or null
    if (!is_array($wikiLocation)) {
        return null;
    }

    $geometry = is_array($mapPlace['geometry'] ?? null) ? $mapPlace['geometry'] : null;
    $mapCoords = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : null;
    if ($mapCoords === null || count($mapCoords) < 2 || !is_numeric($mapCoords[0]) || !is_numeric($mapCoords[1])) {
        return null;
    }

    // GeoJSON stores [x, y] = [lng, lat] (AGENTS.md §5).
    return [
        'drift_units' => round($drift, 3),
        'map' => [
            'lat' => round((float) $mapCoords[1], 3),
            'lng' => round((float) $mapCoords[0], 3),
        ],
        'wiki' => [
            'lat' => round((float) ($wikiLocation['lat'] ?? 0.0), 3),
            'lng' => round((float) ($wikiLocation['lng'] ?? 0.0), 3),
        ],
    ];
}

/**
 * Build the SHARP settlement conflict cases from a match result + dump records.
 * This REUSES the dry-run's pure classifier VERBATIM
 * (avesmapsWikiDumpDryRunBuildCases) for the 10 dry-run case types, then ADDS the
 * one Wave-3 case type the dry-run folds into field_divergence: a standalone
 * `coordinate_drift` case carrying BOTH positions in the exact shape Wave 3
 * needs. field_divergence is therefore reduced to its is_ruined/wiki_url
 * divergences (coordinates are handled by the dedicated coordinate_drift case),
 * so the two are cleanly separable and the coordinate ones are identifiable.
 *
 * WHY a dedicated coordinate_drift case (not just field_divergence):
 *   Wave 3 draws a drift line between the map marker and the wiki position. It
 *   needs a case whose case_type is EXACTLY "coordinate_drift" and whose
 *   payload carries payload.map = {public_id, lat, lng, revision, name} and
 *   payload.wiki_position = {lat, lng}, both in 0..1024 map units, pre-converted.
 *   field_divergence's payload does not carry those (it names a field list); so
 *   the coordinate divergence gets its own case type, and field_divergence keeps
 *   the NON-coordinate divergences only.
 *
 * Returns the SAME grouped shape avesmapsWikiDumpDryRunBuildCases returns
 * (case_type => list<built case>) with an extra 'coordinate_drift' bucket, so the
 * persister below can loop it and call avesmapsWikiSyncUpsertCase per case.
 *
 * @param array{matches:list<array<string,mixed>>, unresolved:list<array<string,mixed>>} $matchResult
 * @param list<array<string,mixed>> $mapPlaces
 * @param list<array{wiki:array<string,mixed>}> $missingPlaces
 * @return array<string, list<array<string,mixed>>>
 */
function avesmapsWikiDumpSettlementBuildSharpCases(array $matchResult, array $mapPlaces, array $missingPlaces): array
{
    // The 10 dry-run case types, VERBATIM (including field_divergence which still
    // folds coordinates at 20u -- we OVERRIDE that below by stripping the
    // coordinate part and emitting a dedicated coordinate_drift case instead).
    $byType = avesmapsWikiDumpDryRunBuildCases($matchResult, $mapPlaces, $missingPlaces);

    // Ensure the extra bucket exists even when nothing drifts.
    if (!isset($byType['coordinate_drift'])) {
        $byType['coordinate_drift'] = [];
    }

    $matches = $matchResult['matches'] ?? [];
    $rebuiltFieldDivergence = [];

    foreach ($matches as $match) {
        $mapPlace = is_array($match['map'] ?? null) ? $match['map'] : [];
        $wikiRecord = is_array($match['wiki_record'] ?? null) ? $match['wiki_record'] : [];

        // --- dedicated coordinate_drift case (Wave 3): BOTH positions in payload. ---
        $positions = avesmapsWikiDumpSettlementCoordinatePositions($mapPlace, $wikiRecord);
        if ($positions !== null && $positions['drift_units'] > AVESMAPS_WIKI_DUMP_COORD_DRIFT_CASE_UNITS) {
            $byType['coordinate_drift'][] = avesmapsWikiSyncBuildCase('coordinate_drift', [
                'map' => [
                    // Standard case-builder fields (public_id/id/name feed case_key
                    // + map_public_id/map_feature_id) AND the Wave-3 payload.map shape.
                    'public_id' => (string) ($mapPlace['public_id'] ?? ''),
                    'id' => (int) ($mapPlace['id'] ?? 0),
                    'name' => (string) ($mapPlace['name'] ?? ''),
                    'lat' => $positions['map']['lat'],
                    'lng' => $positions['map']['lng'],
                    'revision' => (int) ($mapPlace['revision'] ?? 0),
                ],
                'wiki' => $match['wiki'] ?? [],
                // Wave-3 line endpoints, pre-converted to 0..1024, ready to draw.
                'wiki_position' => [
                    'lat' => $positions['wiki']['lat'],
                    'lng' => $positions['wiki']['lng'],
                ],
                'drift_units' => $positions['drift_units'],
                'threshold_units' => AVESMAPS_WIKI_DUMP_COORD_DRIFT_CASE_UNITS,
            ]);
        }

        // --- field_divergence WITHOUT the coordinate part (is_ruined/wiki_url only). ---
        $snapshot = avesmapsWikiDumpDryRunMapSnapshot($mapPlace);
        $divergingFields = [];
        $fieldValues = [];

        $dumpRuined = (bool) ($wikiRecord['is_ruined'] ?? false);
        if ($snapshot['is_ruined'] !== null && $snapshot['is_ruined'] !== $dumpRuined) {
            $divergingFields[] = 'is_ruined';
            $fieldValues['is_ruined'] = ['map' => $snapshot['is_ruined'], 'wiki' => $dumpRuined];
        }

        $dumpUrl = trim((string) ($wikiRecord['wiki_url'] ?? ''));
        if ($dumpUrl !== '' && $snapshot['wiki_url'] !== '' && $dumpUrl !== $snapshot['wiki_url']) {
            $divergingFields[] = 'wiki_url';
            $fieldValues['wiki_url'] = ['map' => $snapshot['wiki_url'], 'wiki' => $dumpUrl];
        }

        if ($divergingFields !== []) {
            $rebuiltFieldDivergence[] = avesmapsWikiSyncBuildCase('field_divergence', [
                'map' => $match['map'] ?? [],
                'wiki' => $match['wiki'] ?? [],
                'diverging_fields' => $divergingFields,
                'field_values' => $fieldValues,
            ]);
        }
    }

    // Replace the dry-run's (coordinate-inclusive) field_divergence bucket with the
    // coordinate-free rebuild, so coordinates live ONLY in coordinate_drift.
    $byType['field_divergence'] = $rebuiltFieldDivergence;

    return $byType;
}

/**
 * THE SHARP SETTLEMENT-CONFLICT WRITER. Reproduces the online settlement crawl's
 * match+classify -- sourced from the DUMP sandbox instead of a live fetch --
 * and PERSISTS the resulting cases into wiki_sync_cases via the existing
 * avesmapsWikiSyncUpsertCase (which PRESERVES reviewed_at/reviewed_by/
 * resolution_json when a case's signature is unchanged or the case is archived;
 * that preservation is REQUIRED and is NOT bypassed here).
 *
 * FLOW (each step reuses an existing pure/read-only function):
 *   1. Read the live map places (avesmapsWikiSyncReadMapPlaces -- a pure SELECT
 *      on map_features; the ONLY live-table read, no write).
 *   2. Read the dump settlement records from the sandbox
 *      (avesmapsWikiDumpSettlementRecordsFromSandbox).
 *   3. Match + classify via the dry-run's pure mirror
 *      (avesmapsWikiDumpDryRunWikiPlacesFromRecords / ...MatchMapPlaces /
 *      ...MissingWikiPlaces) -- gebaeude filtered out exactly as the dry-run
 *      orchestration does.
 *   4. Build cases via avesmapsWikiDumpSettlementBuildSharpCases (the 10 dry-run
 *      types + the dedicated coordinate_drift), then UPSERT each keyed to a
 *      location run id (avesmapsWikiDumpSettlementCaseRunId).
 *
 * Writes ONLY wiki_sync_cases (+ possibly one minted wiki_sync_runs row). Never
 * map_features, never political_territory.
 *
 * @param int|null $runId location run id to key the cases to; null -> resolve/mint
 * @param int      $userId acting editor id (for a minted run's created_by)
 * @param list<array<string,mixed>>|null $mapPlacesOverride test seam (skip the live SELECT)
 * @param list<array<string,mixed>>|null $settlementRecordsOverride test seam (skip the sandbox read)
 * @return array{ok:bool, run_id:int, stored:int, by_type:array<string,int>}
 */
function avesmapsWikiDumpSettlementConflictsGenerate(
    PDO $pdo,
    ?int $runId = null,
    int $userId = 0,
    ?array $mapPlacesOverride = null,
    ?array $settlementRecordsOverride = null
): array {
    avesmapsWikiSyncEnsureLocationTables($pdo);

    $caseRunId = $runId ?? avesmapsWikiDumpSettlementCaseRunId($pdo, $userId);

    $mapPlaces = $mapPlacesOverride ?? avesmapsWikiSyncReadMapPlaces($pdo);
    $settlementRecordsAll = $settlementRecordsOverride
        ?? avesmapsWikiDumpSettlementRecordsFromSandbox($pdo, avesmapsWikiDumpSyncKindResolveDumpRunId($pdo));

    // gebaeude are buildings, not settlements -- drop them so they never inflate
    // type_conflict/unresolved (identical to the dry-run orchestration).
    $settlementRecords = [];
    foreach ($settlementRecordsAll as $record) {
        if (!is_array($record)) {
            continue;
        }
        if ((string) ($record['settlement_class'] ?? '') === 'gebaeude') {
            continue;
        }
        $settlementRecords[] = $record;
    }

    $wikiPlaces = avesmapsWikiDumpDryRunWikiPlacesFromRecords($settlementRecords);
    $matchResult = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlaces, $wikiPlaces);
    $missingPlaces = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiPlaces, $matchResult['matched_titles']);
    $casesByType = avesmapsWikiDumpSettlementBuildSharpCases($matchResult, $mapPlaces, $missingPlaces);

    $stored = 0;
    $byType = [];
    foreach ($casesByType as $caseType => $cases) {
        $byType[$caseType] = count($cases);
        foreach ($cases as $case) {
            try {
                avesmapsWikiSyncUpsertCase($pdo, $caseRunId, $case);
                $stored++;
            } catch (Throwable $exception) {
                // Match the live crawl's tolerance: a duplicate_avesmaps_name
                // collision is logged and skipped; anything else re-throws.
                if ((string) ($case['case_type'] ?? '') !== 'duplicate_avesmaps_name') {
                    throw $exception;
                }
                avesmapsWikiSyncLogServerError('dump_settlement_case_store_error', [
                    'exception_class' => $exception::class,
                    'exception_message' => $exception->getMessage(),
                ]);
            }
        }
    }

    return [
        'ok' => true,
        'run_id' => $caseRunId,
        'stored' => $stored,
        'by_type' => $byType,
    ];
}

// ===========================================================================
// 6. CHUNKED settlement-conflict generation (client-loopable, STRATO-safe).
// ===========================================================================
//
// WHY: avesmapsWikiDumpSettlementConflictsGenerate() above runs the WHOLE
// O(n*m) fuzzy match (avesmapsWikiSyncFindProbableWikiMatches / similar_text over
// ~2464 map_features x ~2650 settlements) SYNCHRONOUSLY in one request. On STRATO
// that PHP-fatals on max_execution_time and the response never returns, so the
// per-kind "Syncen" tab freezes on its final step. The stepper below spreads that
// exact same match/classify across client-driven steps, keyed by a map-place id
// cursor, WITHOUT changing the classifier: it reuses avesmapsWikiDumpDryRun*
// (match/missing) and avesmapsWikiDumpSettlementBuildSharpCases VERBATIM, only
// controlling WHICH cases each phase upserts.
//
// CHUNKING MODEL (proven identical to the one-shot):
//   - MATCH phase (repeated): each step matches ONE bounded batch of map places
//     (id > cursor) against ALL wiki places and upserts only the PER-MAP-PLACE
//     case types for that batch (type_conflict, canonical_name_difference,
//     probable_match, unresolved_without_candidate, field_divergence,
//     coat_available, coordinate_drift -- each depends solely on its own match/
//     unresolved entry). It ACCUMULATES the batch's matched wiki titles (exact
//     matches AND fuzzy candidates -- both mark a title "matched", so a title that
//     only ever appears as a fuzzy candidate is not later mis-reported missing).
//   - FINALIZE phase (once, after every map place is processed): recomputes the
//     three CROSS-BATCH case types over the WHOLE set -- duplicate_avesmaps_name
//     (all map places), duplicate_wiki_title (all EXACT matches, re-derived in the
//     SAME name-order avesmapsWikiSyncReadMapPlaces returns so the representative
//     $titleMatches[0] payload is byte-identical to the one-shot), and
//     missing_wiki_with/without_coordinates (wiki titles NOT in the accumulated
//     matched-title set). Fuzzy matching is NOT re-run here (that cost already ran
//     across the match batches); finalize only does cheap exact-key work + reads
//     the durable matched-title set.
//
// Case-upsert is per-case autocommit (avesmapsWikiSyncUpsertCase) exactly as the
// one-shot, so partial progress is durable; a resumed/re-run step is idempotent
// (deterministic case_key). Writes ONLY wiki_sync_cases (+ the small accumulator
// table below, + possibly one minted wiki_sync_runs row) -- never map_features,
// never political_territory.

/**
 * The PER-MAP-PLACE case types a MATCH-phase batch may upsert (each depends only
 * on its own match/unresolved entry -- see the cross-batch audit in the section
 * docblock). The three EXCLUDED types (duplicate_avesmaps_name / duplicate_wiki_title
 * / missing_wiki_*) are cross-batch and are emitted ONLY by the finalize phase.
 */
const AVESMAPS_WIKI_DUMP_SETTLEMENT_PER_BATCH_CASE_TYPES = [
    'canonical_name_difference',
    'type_conflict',
    'probable_match',
    'unresolved_without_candidate',
    'field_divergence',
    'coat_available',
    'coordinate_drift',
];

/** The CROSS-BATCH case types the finalize phase owns (over the WHOLE data set). */
const AVESMAPS_WIKI_DUMP_SETTLEMENT_FINALIZE_CASE_TYPES = [
    'duplicate_avesmaps_name',
    'duplicate_wiki_title',
    'missing_wiki_with_coordinates',
    'missing_wiki_without_coordinates',
];

/**
 * Map places per MATCH-phase step. Deliberately SMALL relative to the sync_kind
 * budget: each map place fuzzy-matches against ~2.6k wiki places (similar_text),
 * so ~200 map places per step is ~520k comparisons -- well inside one STRATO step
 * (28s) with wide margin, while keeping the number of steps modest (~13 steps for
 * ~2.5k map places). Tunable from one place.
 */
const AVESMAPS_WIKI_DUMP_SETTLEMENT_MATCH_BATCH = 200;

/**
 * Self-healing DDL for the tiny per-run accumulator that carries the MATCH-phase's
 * running set of matched wiki titles into the FINALIZE phase (which needs the
 * union across ALL batches to compute missing_wiki_*, and cannot recompute it
 * itself without re-running the fuzzy match). One row per location run; disposable
 * (cleared when finalize completes). Mirrors the sandbox tables' self-healing
 * pattern (schema-in-code). Idempotent.
 */
function avesmapsWikiDumpSettlementConflictStateEnsure(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_dump_settlement_conflict_state (
            run_id BIGINT UNSIGNED NOT NULL,
            matched_titles_json LONGTEXT NOT NULL,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (run_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * Read the accumulated matched-title set for a run as an associative set
 * (title => true), so callers can O(1)-test membership. Empty when no row yet.
 *
 * When $stateSeam is provided (test seam), the accumulator lives in that array
 * under key 'matched_titles' instead of the DB -- so the stepper is drivable
 * against a fake PDO with no accumulator table.
 *
 * @param array<string,mixed>|null $stateSeam
 * @return array<string,bool>
 */
function avesmapsWikiDumpSettlementConflictStateReadSet(PDO $pdo, int $runId, ?array &$stateSeam = null): array
{
    if ($stateSeam !== null) {
        $titles = is_array($stateSeam['matched_titles'] ?? null) ? $stateSeam['matched_titles'] : [];
        return $titles;
    }

    $statement = $pdo->prepare(
        'SELECT matched_titles_json FROM wiki_dump_settlement_conflict_state WHERE run_id = :run_id LIMIT 1'
    );
    $statement->execute(['run_id' => $runId]);
    $json = $statement->fetchColumn();
    if ($json === false || $json === null || $json === '') {
        return [];
    }

    $decoded = json_decode((string) $json, true);
    if (!is_array($decoded)) {
        return [];
    }

    // Stored as a list of titles; rehydrate to a set for membership tests.
    $set = [];
    foreach ($decoded as $title) {
        $title = (string) $title;
        if ($title !== '') {
            $set[$title] = true;
        }
    }

    return $set;
}

/**
 * Persist the matched-title set for a run (as a title list). UPSERT so repeated
 * MATCH steps grow the same row. Honours the same $stateSeam test seam as the
 * reader.
 *
 * @param array<string,bool>       $set       title => true
 * @param array<string,mixed>|null $stateSeam
 */
function avesmapsWikiDumpSettlementConflictStateWriteSet(PDO $pdo, int $runId, array $set, ?array &$stateSeam = null): void
{
    if ($stateSeam !== null) {
        $stateSeam['matched_titles'] = $set;
        return;
    }

    $json = avesmapsWikiSyncEncodeJson(array_keys($set));
    $statement = $pdo->prepare(
        'INSERT INTO wiki_dump_settlement_conflict_state (run_id, matched_titles_json)
         VALUES (:run_id, :json)
         ON DUPLICATE KEY UPDATE matched_titles_json = VALUES(matched_titles_json)'
    );
    $statement->execute(['run_id' => $runId, 'json' => $json]);
}

/**
 * Drop the accumulator row for a run (called when finalize completes -- the set
 * has served its purpose). Honours the $stateSeam test seam. Best-effort.
 *
 * @param array<string,mixed>|null $stateSeam
 */
function avesmapsWikiDumpSettlementConflictStateClear(PDO $pdo, int $runId, ?array &$stateSeam = null): void
{
    if ($stateSeam !== null) {
        unset($stateSeam['matched_titles']);
        return;
    }

    $statement = $pdo->prepare('DELETE FROM wiki_dump_settlement_conflict_state WHERE run_id = :run_id');
    $statement->execute(['run_id' => $runId]);
}

/**
 * PURE: filter gebaeude out of the raw settlement records and build the wiki-place
 * list (the exact two steps avesmapsWikiDumpSettlementConflictsGenerate does
 * before matching). Extracted so the one-shot and the stepper build the SAME wiki
 * places from the SAME records. gebaeude are buildings, not settlements -- dropping
 * them here is identical to the one-shot / dry-run orchestration.
 *
 * @param list<array<string,mixed>> $settlementRecordsAll
 * @return list<array<string,mixed>> wiki places (avesmapsWikiDumpDryRunWikiPlacesFromRecords shape)
 */
function avesmapsWikiDumpSettlementWikiPlacesFromRecords(array $settlementRecordsAll): array
{
    $settlementRecords = [];
    foreach ($settlementRecordsAll as $record) {
        if (!is_array($record)) {
            continue;
        }
        if ((string) ($record['settlement_class'] ?? '') === 'gebaeude') {
            continue;
        }
        $settlementRecords[] = $record;
    }

    return avesmapsWikiDumpDryRunWikiPlacesFromRecords($settlementRecords);
}

/**
 * Upsert a grouped case set (case_type => list<built case>), but ONLY the buckets
 * whose case_type is in $allowedTypes. Reuses the one-shot's per-case try/catch
 * tolerance VERBATIM (a duplicate_avesmaps_name collision is logged + skipped;
 * anything else re-throws). Returns [storedCount, byTypeCounts].
 *
 * @param array<string, list<array<string,mixed>>> $casesByType
 * @param list<string> $allowedTypes
 * @return array{0:int, 1:array<string,int>}
 */
function avesmapsWikiDumpSettlementUpsertCaseSubset(PDO $pdo, int $caseRunId, array $casesByType, array $allowedTypes): array
{
    $allowed = array_fill_keys($allowedTypes, true);
    $stored = 0;
    $byType = [];

    foreach ($casesByType as $caseType => $cases) {
        if (!isset($allowed[$caseType])) {
            continue;
        }
        $byType[$caseType] = count($cases);
        foreach ($cases as $case) {
            try {
                avesmapsWikiSyncUpsertCase($pdo, $caseRunId, $case);
                $stored++;
            } catch (Throwable $exception) {
                if ((string) ($case['case_type'] ?? '') !== 'duplicate_avesmaps_name') {
                    throw $exception;
                }
                avesmapsWikiSyncLogServerError('dump_settlement_case_store_error', [
                    'exception_class' => $exception::class,
                    'exception_message' => $exception->getMessage(),
                ]);
            }
        }
    }

    return [$stored, $byType];
}

/**
 * Build the EXACT-match subset of avesmapsWikiDumpDryRunMatchMapPlaces WITHOUT the
 * fuzzy pass -- the FINALIZE phase's cheap re-derivation. Reproduces ONLY the
 * exact-key branches (the count($candidates)===1 "one match" and the >1 "ambiguous"
 * branch) of that function VERBATIM; it SKIPS the 0-candidate fuzzy branch (the
 * similar_text O(n*m) cost, already paid across the MATCH batches). Only the
 * count===1 branch feeds $matches, which is exactly what duplicate_wiki_title
 * groups; the >1 branch (unresolved) and matched_titles are not read by any
 * finalize case type, so this is a faithful, cheaper stand-in for finalize's needs.
 *
 * @param list<array<string,mixed>> $mapPlaces  full map-place list (name-ordered)
 * @param list<array<string,mixed>> $wikiPlaces full wiki-place list
 * @return array{matches:list<array<string,mixed>>, unresolved:list<array<string,mixed>>, matched_titles:list<string>}
 */
function avesmapsWikiDumpSettlementExactMatchesForFinalize(array $mapPlaces, array $wikiPlaces): array
{
    // Group wiki places by normalized_key (verbatim: settlement-conflicts-dryrun.php:197-203).
    $wikiByKey = [];
    foreach ($wikiPlaces as $wikiPlace) {
        $key = (string) ($wikiPlace['normalized_key'] ?? '');
        if ($key !== '') {
            $wikiByKey[$key][] = $wikiPlace;
        }
    }

    $matchedWikiTitles = [];
    $matches = [];
    $unresolved = [];

    foreach ($mapPlaces as $mapPlace) {
        $mapKey = (string) ($mapPlace['normalized_key'] ?? '');
        $candidates = $mapKey !== '' ? ($wikiByKey[$mapKey] ?? []) : [];

        if (count($candidates) === 1) {
            $wikiPlace = $candidates[0];
            $matchedWikiTitles[(string) $wikiPlace['title']] = true;
            $matches[] = [
                'match_kind' => 'exact',
                'score' => 1.0,
                'map' => $mapPlace,
                'wiki' => avesmapsWikiSyncBuildPublicWikiPlace($wikiPlace),
                'wiki_record' => is_array($wikiPlace['record'] ?? null) ? $wikiPlace['record'] : [],
            ];
            continue;
        }

        if (count($candidates) > 1) {
            $candidatePayloads = array_map(
                static fn(array $candidate): array => [
                    'match_kind' => 'exact',
                    'score' => 1.0,
                    'wiki' => avesmapsWikiSyncBuildPublicWikiPlace($candidate),
                ],
                $candidates
            );
            foreach ($candidates as $candidate) {
                $matchedWikiTitles[(string) $candidate['title']] = true;
            }
            $unresolved[] = [
                'map' => $mapPlace,
                'candidates' => $candidatePayloads,
            ];
            continue;
        }

        // 0 exact candidates: the fuzzy branch is intentionally SKIPPED here (see
        // docblock) -- finalize does not need fuzzy unresolved/matched_titles.
    }

    return [
        'matches' => $matches,
        'unresolved' => $unresolved,
        'matched_titles' => array_keys($matchedWikiTitles),
    ];
}

/**
 * ONE chunked step of settlement-conflict generation. Client-loopable exactly like
 * avesmapsWikiDumpSyncKindStep: the caller loops it, advancing the returned cursor,
 * until done=true. See the section docblock for the MATCH/FINALIZE model and the
 * proof that the union of all steps' writes equals a one-shot
 * avesmapsWikiDumpSettlementConflictsGenerate.
 *
 * PHASES:
 *   - phase='match'   : cursor is a map-place id high-water mark. Processes the
 *                       next AVESMAPS_WIKI_DUMP_SETTLEMENT_MATCH_BATCH map places
 *                       (id > cursor), upserts the per-batch case types, grows the
 *                       matched-title accumulator. done=false.
 *   - phase='finalize': fired once, when no map place has id > cursor (all done).
 *                       Upserts the cross-batch case types over the whole set and
 *                       clears the accumulator. done=true.
 *
 * @param int|null $runId location run id to key cases to; null -> resolve/mint (once)
 * @param int      $userId acting editor id (for a minted run's created_by)
 * @param int      $cursor map-place id high-water mark (0 to start)
 * @param list<array<string,mixed>>|null $mapPlacesOverride     test seam (skip the live SELECT)
 * @param list<array<string,mixed>>|null $settlementRecordsOverride test seam (skip the sandbox read)
 * @param int|null $batchSize override the map-place batch size (tests use a tiny one)
 * @param array<string,mixed>|null $stateSeam in-memory accumulator seam (tests; null -> DB table)
 * @return array{ok:bool, done:bool, phase:string, run_id:int, cursor:int, stored:int, by_type:array<string,int>, progress:array{processed:int,total:int}}
 */
function avesmapsWikiDumpSettlementConflictsGenerateStep(
    PDO $pdo,
    ?int $runId = null,
    int $userId = 0,
    int $cursor = 0,
    ?array $mapPlacesOverride = null,
    ?array $settlementRecordsOverride = null,
    ?int $batchSize = null,
    ?array &$stateSeam = null
): array {
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    avesmapsWikiSyncEnsureLocationTables($pdo);
    if ($stateSeam === null) {
        avesmapsWikiDumpSettlementConflictStateEnsure($pdo);
    }

    $caseRunId = $runId ?? avesmapsWikiDumpSettlementCaseRunId($pdo, $userId);
    $batchSize = $batchSize !== null && $batchSize > 0 ? $batchSize : AVESMAPS_WIKI_DUMP_SETTLEMENT_MATCH_BATCH;

    // Read the map places ONCE per step. avesmapsWikiSyncReadMapPlaces returns them
    // in name-order (name ASC, id ASC); the heavy cost is the fuzzy match, not this
    // SELECT, so re-reading each step is cheap.
    $mapPlaces = $mapPlacesOverride ?? avesmapsWikiSyncReadMapPlaces($pdo);
    $total = count($mapPlaces);

    // Build the wiki places ONCE per step (all batches match against the full set).
    $settlementRecordsAll = $settlementRecordsOverride
        ?? avesmapsWikiDumpSettlementRecordsFromSandbox($pdo, avesmapsWikiDumpSyncKindResolveDumpRunId($pdo));
    $wikiPlaces = avesmapsWikiDumpSettlementWikiPlacesFromRecords($settlementRecordsAll);

    // Iterate the batches in strict ID ORDER so the id cursor is a monotonic,
    // GAP-FREE high-water mark: a map place with a small id but a late name-position
    // must not be skipped by an earlier-named batch whose max id ran ahead. Batching
    // order is independent of the finalize phase, which re-derives over ALL map
    // places in avesmapsWikiSyncReadMapPlaces's own name-order (so the order-sensitive
    // duplicate_wiki_title representative still matches the one-shot).
    $mapPlacesById = $mapPlaces;
    usort($mapPlacesById, static fn(array $a, array $b): int => ((int) ($a['id'] ?? 0)) <=> ((int) ($b['id'] ?? 0)));

    $batch = [];
    $maxId = $cursor;
    foreach ($mapPlacesById as $mapPlace) {
        $id = (int) ($mapPlace['id'] ?? 0);
        if ($id <= $cursor) {
            continue;
        }
        $batch[] = $mapPlace;
        if ($id > $maxId) {
            $maxId = $id;
        }
        if (count($batch) >= $batchSize) {
            break;
        }
    }

    // ----------------------------------------------------------------- MATCH ---
    if ($batch !== []) {
        // Match ONLY this batch against ALL wiki places (fuzzy included). Build the
        // sharp cases for the batch, then upsert ONLY the per-map-place buckets.
        $matchResult = avesmapsWikiDumpDryRunMatchMapPlaces($batch, $wikiPlaces);
        // missingPlaces is a FINALIZE concern; pass [] so no missing case is built here.
        $casesByType = avesmapsWikiDumpSettlementBuildSharpCases($matchResult, $batch, []);
        [$stored, $byType] = avesmapsWikiDumpSettlementUpsertCaseSubset(
            $pdo,
            $caseRunId,
            $casesByType,
            AVESMAPS_WIKI_DUMP_SETTLEMENT_PER_BATCH_CASE_TYPES
        );

        // Grow the durable matched-title set with THIS batch's matched titles
        // (exact + fuzzy candidates -- avesmapsWikiDumpDryRunMatchMapPlaces already
        // unions both into matched_titles).
        $set = avesmapsWikiDumpSettlementConflictStateReadSet($pdo, $caseRunId, $stateSeam);
        foreach (($matchResult['matched_titles'] ?? []) as $title) {
            $title = (string) $title;
            if ($title !== '') {
                $set[$title] = true;
            }
        }
        avesmapsWikiDumpSettlementConflictStateWriteSet($pdo, $caseRunId, $set, $stateSeam);

        $processed = 0;
        foreach ($mapPlaces as $mapPlace) {
            if ((int) ($mapPlace['id'] ?? 0) <= $maxId) {
                $processed++;
            }
        }

        return [
            'ok' => true,
            'done' => false,
            'phase' => 'match',
            'run_id' => $caseRunId,
            'cursor' => $maxId,
            'stored' => $stored,
            'by_type' => $byType,
            'progress' => ['processed' => $processed, 'total' => $total],
        ];
    }

    // -------------------------------------------------------------- FINALIZE ---
    // No map place past the cursor -> every batch is done. Emit the three
    // cross-batch case types over the WHOLE data set.
    //
    // Build an EXACT-ONLY match result over ALL map places in the one-shot's
    // name-order. This is the cheap part of the matcher (exact-key bucket lookups,
    // NO similar_text) -- the expensive fuzzy pass already ran, spread across the
    // MATCH batches, so finalize must NOT re-run it (that would reintroduce the very
    // one-shot O(n*m) hang this change removes). The exact matches are all
    // duplicate_wiki_title needs, and iterating map places in name-order makes its
    // representative ($titleMatches[0]) byte-identical to the one-shot.
    // missing_wiki_* is driven by the durable accumulated matched-title set (which
    // DID include fuzzy candidates from every batch), NOT by this exact-only pass.
    $matchedSet = avesmapsWikiDumpSettlementConflictStateReadSet($pdo, $caseRunId, $stateSeam);
    $matchResult = avesmapsWikiDumpSettlementExactMatchesForFinalize($mapPlaces, $wikiPlaces);
    $missingPlaces = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiPlaces, array_keys($matchedSet));
    $casesByType = avesmapsWikiDumpSettlementBuildSharpCases($matchResult, $mapPlaces, $missingPlaces);
    [$stored, $byType] = avesmapsWikiDumpSettlementUpsertCaseSubset(
        $pdo,
        $caseRunId,
        $casesByType,
        AVESMAPS_WIKI_DUMP_SETTLEMENT_FINALIZE_CASE_TYPES
    );

    avesmapsWikiDumpSettlementConflictStateClear($pdo, $caseRunId, $stateSeam);

    return [
        'ok' => true,
        'done' => true,
        'phase' => 'finalize',
        'run_id' => $caseRunId,
        'cursor' => $cursor,
        'stored' => $stored,
        'by_type' => $byType,
        'progress' => ['processed' => $total, 'total' => $total],
    ];
}
