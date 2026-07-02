<?php

declare(strict_types=1);

/**
 * Hybrid WikiDump migration -- Task H4a: the SANDBOX STATE TABLE + the
 * title->title redirect extractor + the online-map FILL helpers.
 * ---------------------------------------------------------------------------
 * H1 (dump-category-layer.php) builds three ONLINE override maps
 * {normTitle => class|building_type|continent} plus the wanted-title breadth
 * those maps establish. H2 (dump-entity-scan.php) can later collect dump
 * wikitext for a title-set. H3 lets the dump parse-handlers accept an
 * `$override` array. H4a is the DATA layer H4b/H4c will orchestrate across
 * request-bounded steps: a disposable per-run state table (one row per
 * (run_id, normalized_title)), a title-keyed redirect extractor that closes a
 * gap H2's own docblock flags (dump-entity-scan.php:1259-1287: "no function
 * that recovers a literal dump <title> string from a wiki_key"), and the
 * FILL functions that write H1's maps into the state table.
 *
 * SCOPE: this file writes ONLY to `wiki_dump_hybrid_state` -- an ISOLATED
 * SANDBOX, never `wiki_*_staging`, `map_features`, or `political_*`. It does
 * NOT build the phase state-machine / driving endpoint / frontend loop (H4c)
 * and does NOT build the dump-wikitext pass or the real-staging upsert
 * (H4b's parse_and_upsert, gated behind the green compare-test). It is SAFE
 * to run before that compare-test is green because nothing it writes is
 * live/staging.
 *
 * PURE-ASSEMBLER / THIN-DB-WRAPPER SPLIT (mirrors H1's own split, per the H4a
 * brief): every "fill" is split into
 *   (1) a PURE row-computation helper that takes an ALREADY-FETCHED H1 map
 *       shape and returns the list of rows to upsert -- zero DB, fully
 *       unit-testable, and
 *   (2) a thin DB-upsert wrapper that calls the real H1 builder (or an
 *       injected fake, for tests) and feeds every returned row through one
 *       parameterized `INSERT ... ON DUPLICATE KEY UPDATE`.
 * This mirrors tools/wikidump/test-dump-hybrid-state.php's own split: the
 * pure helpers are exercised with mock H1 maps and no PDO at all; only the
 * DDL/upsert wrapper needs a live DB and is owner-verified separately (see
 * that test file's banner for the exact split statement).
 *
 * THE TITLE->TITLE REDIRECT EXTRACTOR (design report §4, option (a)):
 * `avesmapsWikiDumpCollectRedirectAliases()` (dump-reader.php:379) already
 * walks the SAME Pass-A page stream and derives `alias_slug =>
 * canonical_wiki_key` -- but BOTH sides are slugged before the map is
 * returned, and no function anywhere recovers a literal dump <title> string
 * from a wiki_key (the slug transform is lossy). The raw canonical redirect
 * TITLE is a plain string, available in the exact same loop iteration, one
 * line before it gets slugged (dump-reader.php:287-289: `$target =
 * $reader->getAttribute('title')`, then $page['redirect'] = $target
 * verbatim, dump-reader.php:312). `avesmapsWikiDumpCollectRedirectTitleAliases()`
 * below is a SECOND, PARALLEL collector over that same raw field -- it does
 * NOT modify, wrap or risk `avesmapsWikiDumpCollectRedirectAliases()` (regions/
 * paths/territories still need the existing slug-keyed map unchanged). Both
 * sides are normalized with the SAME `avesmapsWikiSyncMonitorNormalizeTitle()`
 * H2 uses for its own title-set membership test (dump-entity-scan.php:1196),
 * so a wanted title that is itself a wiki redirect can be resolved to its
 * canonical dump <title> BEFORE the wikitext-collection membership test runs
 * (H4b's job; this file only produces the map).
 *
 * INVARIANTS (verified in tools/wikidump/test-dump-hybrid-state.php):
 *
 *   I1  Never re-derive title normalization -- every normalized title in this
 *       file comes from calling the real avesmapsWikiSyncMonitorNormalizeTitle()
 *       (sync-monitor.php:319), never a re-implemented trim/lowercase.
 *
 *   I8  Reuse H1's builders verbatim (avesmapsWikiDumpCategoryFetchSettlementClassMap /
 *       -FetchBuildingTypeMap / -FetchContinentMap) -- only the row-computation
 *       + upsert logic below is NEW code; the override VALUES themselves are
 *       whatever H1 already computed.
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level executable code, no DB connect), so a test can
 * `require` it with no MySQL. Every DB touch lives in a function that takes a
 * PDO explicitly.
 */

// ===========================================================================
// (1) STATE TABLE -- self-healing DDL.
// ===========================================================================

/**
 * Idempotently create `wiki_dump_hybrid_state` if it does not already exist.
 * Same inline self-healing `CREATE TABLE IF NOT EXISTS` pattern the rest of
 * this codebase uses (e.g. avesmapsWikiSyncEnsureCoreTables, sync.php:262).
 * Call this before any write to the table -- every function below that writes
 * calls it first, so a caller never needs to remember to call it separately.
 *
 * Schema (design report §3, used verbatim): one row per (run_id,
 * normalized_title). `run_id` is a plain BIGINT UNSIGNED referencing
 * `wiki_sync_runs.id` (no FOREIGN KEY constraint -- this table is disposable
 * per-run scratch state, mirroring how `wiki_sync_cases`/`wiki_path_queue`
 * reference a run by plain id without an FK). `entity_kind` is nullable
 * free-form classification (settlement|building|region|territory), optional
 * for filtering -- H4a itself never writes it (H1's maps don't carry a kind);
 * left for H4b/H4c to populate if they need it. `wikitext`/`wikitext_found_at`
 * are H2's payload, both NULL until H4b's wikitext-collection phase fills
 * them -- H4a never writes them either. `processed_at` is set once H4b's
 * parse_and_upsert has consumed the row; H4a never sets it.
 */
function avesmapsWikiDumpHybridEnsureStateTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_dump_hybrid_state (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            normalized_title VARCHAR(255) NOT NULL,
            entity_kind VARCHAR(20) NULL,
            override_class VARCHAR(60) NULL,
            override_building_type VARCHAR(120) NULL,
            override_continent VARCHAR(120) NULL,
            wikitext MEDIUMTEXT NULL,
            wikitext_found_at DATETIME(3) NULL,
            processed_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_hybrid_state_run_title (run_id, normalized_title),
            KEY idx_hybrid_state_run_pending (run_id, wikitext_found_at, processed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

// ===========================================================================
// (2) TITLE->TITLE REDIRECT EXTRACTOR (design §4, option a).
// ===========================================================================

/**
 * PURE (DB-free) Pass-A collector: from the SAME stream of page arrays
 * `avesmapsWikiDumpIteratePages()` yields (and
 * `avesmapsWikiDumpCollectRedirectAliases()` already walks for the slug-keyed
 * map), build a TITLE-KEYED alias map
 *
 *   normalized(alias page title) => normalized(canonical redirect target)
 *
 * for every page carrying a non-empty `<redirect title="...">`. Both sides go
 * through `avesmapsWikiSyncMonitorNormalizeTitle()` ONLY -- no slugging, no
 * wiki_key derivation -- unlike the existing
 * `avesmapsWikiDumpCollectRedirectAliases()`, which this function does NOT
 * call, wrap, modify or duplicate the persistence of. Both collectors read the
 * exact same `$page['redirect']` / `$page['title']` fields; running both over
 * the same page stream costs nothing extra against the dump file.
 *
 * On a duplicate alias title (the same normalized alias appearing twice --
 * a stale dump artifact), the LAST write wins, matching the upsert-consistent
 * "last write wins" semantics `avesmapsWikiDumpCollectRedirectAliases()`
 * itself documents (dump-reader.php:374/400).
 *
 * A page with an empty/whitespace-only title, or a redirect target that
 * normalizes to '', contributes nothing (mirrors the existing collector's
 * skip conditions, dump-reader.php:385-397, minus the slug-specific empty
 * checks which do not apply here).
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<string, string> normalized alias title => normalized canonical title
 */
function avesmapsWikiDumpCollectRedirectTitleAliases(iterable $pages): array
{
    $map = [];

    foreach ($pages as $page) {
        $target = $page['redirect'] ?? null;
        if (!is_string($target) || $target === '') {
            continue; // not a redirect page
        }

        $aliasTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) ($page['title'] ?? ''));
        if ($aliasTitle === '') {
            continue;
        }

        $canonicalTitle = avesmapsWikiSyncMonitorNormalizeTitle($target);
        if ($canonicalTitle === '') {
            continue;
        }

        $map[$aliasTitle] = $canonicalTitle; // last write wins (upsert-consistent)
    }

    return $map;
}

// ===========================================================================
// (3) ONLINE-MAP FILL HELPERS -- pure row-computation + thin DB upsert.
// ===========================================================================

/**
 * PURE row-computation: given H1's settlement-class map (the `map` half of
 * `avesmapsWikiDumpCategoryFetchSettlementClassMap()`'s return shape --
 * `{normTitle => class}`), return the list of rows to upsert into
 * `wiki_dump_hybrid_state`. Every title in the map becomes exactly one row
 * (this establishes wanted-set membership: a row's mere EXISTENCE for a
 * `run_id` is the membership test, per design §3), with `override_class` set
 * to the map's value and every other override column left absent (so a
 * later fill for a different signal can merge into the SAME row instead of
 * clobbering it -- see the upsert wrapper below).
 *
 * Titles are NOT re-normalized here -- `avesmapsWikiDumpCategoryAssembleClassMap()`
 * already normalized every key via `avesmapsWikiSyncMonitorNormalizeTitle()`
 * (dump-category-layer.php:176) before H1 returned the map, so re-normalizing
 * would be redundant re-derivation (I1). A title that normalizes to '' cannot
 * occur in H1's own map (H1 already guards `$normTitle === ''`), so no such
 * guard is repeated here.
 *
 * @param array<string, string> $classMap normalized title => class
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeClassMapRows(array $classMap): array
{
    $rows = [];
    foreach ($classMap as $normTitle => $class) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => (string) $class,
            'override_building_type' => null,
            'override_continent' => null,
        ];
    }

    return $rows;
}

/**
 * PURE row-computation: the building-type analogue of
 * `avesmapsWikiDumpHybridComputeClassMapRows()` above, for H1's building-type
 * map (the `map` half of `avesmapsWikiDumpCategoryFetchBuildingTypeMap()`'s
 * return shape -- `{normTitle => building_type}`). Same shape, same
 * "override_class left null so a merge doesn't clobber it" rule, mirrored for
 * `override_building_type`.
 *
 * @param array<string, string> $buildingMap normalized title => building_type
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeBuildingMapRows(array $buildingMap): array
{
    $rows = [];
    foreach ($buildingMap as $normTitle => $buildingType) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => null,
            'override_building_type' => (string) $buildingType,
            'override_continent' => null,
        ];
    }

    return $rows;
}

/**
 * PURE row-computation: the continent analogue, for ONE partial batch of H1's
 * resumable continent map (the `map` half of ONE
 * `avesmapsWikiDumpCategoryFetchContinentMap()` call's return shape --
 * `{normTitle => continent}`, already merged across whatever batches that
 * call made internally). Same row shape, `override_continent` set, the other
 * two override columns left null.
 *
 * Unlike the class/building fills, the continent fill is called once PER
 * STEP against a PARTIAL map (H1's own cursor/callBudget contract, design §3
 * "RESUMABLE-CURSOR CONTRACT") -- this function does not know or care whether
 * the map it is given is the full title set or one budget-limited slice; it
 * always returns rows for exactly the titles present in the map it was
 * given, which is the correct behaviour for both a full and a partial map.
 *
 * @param array<string, string> $continentMap normalized title => continent
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeContinentMapRows(array $continentMap): array
{
    $rows = [];
    foreach ($continentMap as $normTitle => $continent) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => null,
            'override_building_type' => null,
            'override_continent' => (string) $continent,
        ];
    }

    return $rows;
}

/**
 * THIN DB upsert: write a list of rows (as `avesmapsWikiDumpHybridComputeClassMapRows()`
 * / `-ComputeBuildingMapRows()` / `-ComputeContinentMapRows()` return) into
 * `wiki_dump_hybrid_state` for the given `run_id`, via one parameterized
 * `INSERT ... ON DUPLICATE KEY UPDATE` per row keyed on
 * `(run_id, normalized_title)` (the table's own UNIQUE KEY, design §3).
 *
 * A NULL override column in the given row does NOT clobber an existing
 * non-NULL value already stored for that title -- `COALESCE(VALUES(col),
 * col)` on every override column, so this function is safe to call multiple
 * times for the SAME title across different fills (class, then building,
 * then continent) and each fill only ever ADDS its own override, never wipes
 * a sibling fill's earlier write. This is what lets the three single-purpose
 * pure computers above merge into one row per title without needing to know
 * about each other's calls or their ordering.
 *
 * Calls `avesmapsWikiDumpHybridEnsureStateTable()` first (idempotent), so a
 * caller never needs to remember to call it separately.
 *
 * @param list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}> $rows
 * @return int number of rows written (INSERT+UPDATE combined; 0 if $rows is empty)
 */
function avesmapsWikiDumpHybridUpsertRows(PDO $pdo, int $runId, array $rows): int
{
    if ($rows === []) {
        return 0;
    }

    avesmapsWikiDumpHybridEnsureStateTable($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO wiki_dump_hybrid_state
            (run_id, normalized_title, override_class, override_building_type, override_continent)
        VALUES
            (:run_id, :normalized_title, :override_class, :override_building_type, :override_continent)
        ON DUPLICATE KEY UPDATE
            override_class = COALESCE(VALUES(override_class), override_class),
            override_building_type = COALESCE(VALUES(override_building_type), override_building_type),
            override_continent = COALESCE(VALUES(override_continent), override_continent)'
    );

    $written = 0;
    foreach ($rows as $row) {
        $normalizedTitle = (string) ($row['normalized_title'] ?? '');
        if ($normalizedTitle === '') {
            continue;
        }
        $statement->execute([
            'run_id' => $runId,
            'normalized_title' => $normalizedTitle,
            'override_class' => $row['override_class'] ?? null,
            'override_building_type' => $row['override_building_type'] ?? null,
            'override_continent' => $row['override_continent'] ?? null,
        ]);
        $written++;
    }

    return $written;
}

/**
 * FILL (class map): thin wrapper chaining H1's real builder
 * `avesmapsWikiDumpCategoryFetchSettlementClassMap()` (dump-category-layer.php:
 * 202) into the pure row-computer + the DB upsert above. Single-step, mirrors
 * H1's own single-step class-map builder (no cursor -- H1's class map is one
 * call that internally walks all 5 class categories).
 *
 * $categoryMemberFetcher is forwarded to H1's builder unchanged (default: the
 * real reused fetcher; a caller/test may inject a fake to avoid live HTTP,
 * exactly as H1's own test does).
 *
 * @return array{written: int, titles: list<string>} rows written + the title breadth this fill established
 */
function avesmapsWikiDumpHybridFillClassMap(PDO $pdo, int $runId, ?callable $categoryMemberFetcher = null): array
{
    $result = avesmapsWikiDumpCategoryFetchSettlementClassMap($categoryMemberFetcher);
    $classMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeClassMapRows($classMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return ['written' => $written, 'titles' => array_column($rows, 'normalized_title')];
}

/**
 * FILL (building-type map): thin wrapper chaining H1's real builder
 * `avesmapsWikiDumpCategoryFetchBuildingTypeMap()` (dump-category-layer.php:
 * 276) into the pure row-computer + the DB upsert above. Single-step, mirrors
 * H1's own single-step building-map builder.
 *
 * $subcategoryFetcher / $categoryMemberFetcher are forwarded to H1's builder
 * unchanged (defaults: the real reused fetchers; a caller/test may inject
 * fakes).
 *
 * @return array{written: int, titles: list<string>} rows written + the title breadth this fill established
 */
function avesmapsWikiDumpHybridFillBuildingMap(
    PDO $pdo,
    int $runId,
    ?callable $subcategoryFetcher = null,
    ?callable $categoryMemberFetcher = null
): array {
    $result = avesmapsWikiDumpCategoryFetchBuildingTypeMap($subcategoryFetcher, $categoryMemberFetcher);
    $buildingMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeBuildingMapRows($buildingMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return ['written' => $written, 'titles' => array_column($rows, 'normalized_title')];
}

/**
 * FILL (continent map, RESUMABLE): thin wrapper chaining H1's real resumable
 * builder `avesmapsWikiDumpCategoryFetchContinentMap()`
 * (dump-category-layer.php:429) into the pure row-computer + the DB upsert
 * above, threading H1's OWN cursor/callBudget/done contract straight through
 * unchanged so a caller (H4c) can loop this exactly the way it already loops
 * H1's builder directly -- this wrapper adds NOTHING to that contract except
 * "also persist the partial map returned by this call".
 *
 * $titles is the full title list to walk (H4c's job to assemble -- typically
 * the union of the class-map + building-map title breadth, per design §5);
 * $cursor/$callBudget/$batchPageFetcher are forwarded to H1's builder
 * unchanged (same meaning, same defaults).
 *
 * @param string[] $titles
 * @return array{written: int, nextCursor: int, done: bool} rows written this step + H1's own pass-through cursor/done
 */
function avesmapsWikiDumpHybridFillContinentMapStep(
    PDO $pdo,
    int $runId,
    array $titles,
    int $cursor = 0,
    ?int $callBudget = null,
    ?callable $batchPageFetcher = null
): array {
    $result = avesmapsWikiDumpCategoryFetchContinentMap($titles, $cursor, $callBudget, $batchPageFetcher);
    $continentMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeContinentMapRows($continentMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return [
        'written' => $written,
        'nextCursor' => (int) ($result['nextCursor'] ?? $cursor),
        'done' => (bool) ($result['done'] ?? false),
    ];
}
