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
