<?php

declare(strict_types=1);

/**
 * Hybrid WikiDump migration -- Task H4b: the two RESUMABLE "dump-compute" steps
 * that H4c's driving endpoint will loop over the sandbox state table H4a built.
 * ---------------------------------------------------------------------------
 * H4a (dump-hybrid-state.php) filled `wiki_dump_hybrid_state` -- one row per
 * (run_id, normalized_title) -- with the online override triple
 * (override_class / override_building_type / override_continent) and the
 * title->title redirect alias map. H4b adds the two steps that turn those rows
 * into records:
 *
 *   (5) wikitext_collect  -- fill each pending state row's `wikitext` from the
 *       dump. Reopen+skip the reader like Pass A/B, stream pages, and for every
 *       page whose NORMALIZED title is a still-wanted state row, write the page
 *       body + wikitext_found_at. Writes ONLY the sandbox state table, so it is
 *       SAFE to run before the H5 compare-test is green.
 *
 *   (6) parse_and_upsert -- turn filled rows into records via the H3 parse
 *       handlers WITH each row's override, then EITHER (dryRun=true) RETURN the
 *       records and write nothing -- what the H5 compare-test consumes read-only
 *       -- OR (dryRun=false) call the SAME per-kind upserts Pass B already uses
 *       and mark the row processed. dryRun=false is the ONE sharp writer H4b
 *       introduces; H4c/H5 gate it behind a green compare-test.
 *
 * WHY A SEPARATE FILE (not folded into dump-entity-scan.php): the brief allows
 * either; a new file is chosen so it can be LF (no CRLF-edit trap on the large
 * CRLF dump-entity-scan.php) and so the "orchestration over state rows" concern
 * stays visually separate from Pass B's "walk the raw dump stream" concern. This
 * file adds NO new field-mapping, key-derivation or upsert logic: the only
 * genuinely new code is the two step loops + the wanted-set/cursor bookkeeping +
 * the dryRun branch. Everything else is a verbatim reuse of H2 (the title-set
 * wikitext collector + the reopen/skip/time-budget discipline), H3 (the
 * override-aware parse handlers), H4a (the state table), and the exact per-kind
 * upserts Pass B (avesmapsWikiDumpRunPassBStep) already calls.
 *
 * ADJUDICATED STOPPING RULE (progress.md "CONTROLLER ADJUDICATION"): XMLReader
 * is not seekable, so each chunked wikitext_collect step reopens+skips from page
 * 0 -- an O(n^2) skip cost if a full pass needs many steps. To MINIMISE the step
 * count (and thus that cost), wikitext_collect's PRIMARY cap is the TIME budget
 * (AVESMAPS_WIKI_DUMP_STEP_SECONDS, with a ~25s margin below it), NOT the fixed
 * 2000-page budget: scan as many pages as fit the time window, plus H2's
 * early-exit once every wanted title is found. It logs pages_scanned + a running
 * step counter so the owner can see whether one full pass takes 1 step or many
 * (the signal for whether the byte-offset-seek follow-up is ever needed).
 *
 * INVARIANTS (verified in tools/wikidump/test-dump-hybrid-read.php):
 *
 *   I2  parse_and_upsert writes ONLY what Pass B already writes (the *_staging /
 *       sandbox tables via the reused per-kind upserts) -- never geometry,
 *       feature_subtype or coordinates on a map feature. wikitext_collect writes
 *       ONLY wiki_dump_hybrid_state (the isolated sandbox).
 *
 *   I1  Title normalization is NEVER re-implemented -- every normalized title
 *       comes from avesmapsWikiSyncMonitorNormalizeTitle() (sync-monitor.php),
 *       the SAME normalizer H2's collector and H4a's fills already use.
 *
 *   The kind of a filled row is determined EXACTLY as Pass B determines it:
 *       avesmapsWikiDumpClassifyPage() on the reconstructed dump page, then the
 *       matching handler -- no bespoke re-classification.
 *
 * RUN-ID TYPE NOTE (deviation from the brief's `string $runId`, deliberate):
 * these two steps query the SAME wiki_dump_hybrid_state rows H4a wrote, and
 * H4a's own writer avesmapsWikiDumpHybridUpsertRows() takes `int $runId` (the
 * numeric wiki_sync_runs.id the table's run_id column references -- NOT the
 * random public_id string). To join those rows they MUST use the same int
 * run_id H4a used, so this file takes `int $runId`. H4c resolves the public run
 * id to its numeric id (avesmapsWikiSyncFetchRunByPublicId) once, exactly as it
 * already must to update the run row, and passes the int down.
 *
 * PURITY CONTRACT: side-effect-free on include (only function definitions -- no
 * top-level code, no DB connect, no headers), so a test can `require` it with no
 * MySQL. Every DB / dump touch lives in a function that takes a PDO explicitly.
 *
 * DEPENDENCIES (the caller loads these before invoking either step -- same
 * contract as dump-entity-scan.php, whose handlers + upserts this reuses):
 *   _internal/bootstrap.php, political/territory.php, wiki/sync.php,
 *   wiki/sync-monitor.php, wiki/locations.php, wiki/settlements.php,
 *   wiki/paths.php, wiki/regions.php, wiki/territories.php, wiki/dump-reader.php,
 *   wiki/dump-entity-scan.php (the H3 handlers + Pass B upserts),
 *   wiki/dump-hybrid-state.php (the state table). This file requires nothing on
 *   include.
 */

// ===========================================================================
// 1. PURE selection helpers (DB-free, unit-tested without a real DB/dump).
// ===========================================================================

/**
 * Build the wikitext_collect wanted-title SET from a list of still-pending
 * normalized titles, resolving each through the H4a title->title redirect alias
 * map FIRST so a wanted title that is itself a wiki redirect matches its
 * canonical dump <title>.
 *
 * This is the wikitext_collect analogue of Pass B's
 * avesmapsWikiDumpResolveWantedTitlesThroughAliases() -- but against the
 * TITLE-keyed map H4a's avesmapsWikiDumpCollectRedirectTitleAliases() produces
 * (normalized alias title => normalized canonical title), NOT the slug-keyed
 * alias_slug => wiki_key map (which cannot be reversed to a title). The dump
 * stores an article only under its canonical <title>, so an unresolved alias
 * title would simply never be found by avesmapsWikiDumpCollectWikitextForTitles().
 *
 * The returned SET is what avesmapsWikiDumpCollectWikitextForTitles() membership-
 * tests against: keys are normalized titles (already normalized -- both the DB's
 * stored normalized_title and the alias map's sides come from
 * avesmapsWikiSyncMonitorNormalizeTitle(), I1), values are the ORIGINAL pending
 * title so a caller can trace a found canonical page back to the state row that
 * requested it. When several pending titles alias to the same canonical title,
 * the LAST one wins the trace slot (upsert-consistent last-write-wins); every
 * pending title still contributes its own membership key.
 *
 * A pending title that is NOT an alias passes through unchanged (its own
 * normalized title is both the membership key and the trace value). A title that
 * normalizes to '' contributes nothing.
 *
 * @param list<string>          $pendingTitles normalized titles with wikitext_found_at IS NULL
 * @param array<string, string> $titleAliasMap normalized alias title => normalized canonical title (H4a)
 * @return array<string, string> canonical normalized title => the original requested title
 */
function avesmapsWikiDumpHybridBuildWantedSet(array $pendingTitles, array $titleAliasMap): array
{
    $wanted = [];

    foreach ($pendingTitles as $pendingTitle) {
        $normalized = avesmapsWikiSyncMonitorNormalizeTitle((string) $pendingTitle);
        if ($normalized === '') {
            continue;
        }

        // Resolve through the title->title alias map so a redirect wanted-title
        // becomes its canonical dump <title> before the membership test.
        $canonical = $titleAliasMap[$normalized] ?? $normalized;
        if ($canonical === '') {
            $canonical = $normalized; // never let a degenerate '' alias target erase the key
        }

        // Trace value = the ORIGINAL requested title (the state-row key), so the
        // caller can write the found wikitext back onto that row.
        $wanted[$canonical] = $normalized;
    }

    return $wanted;
}

/**
 * Reconstruct the MINIMAL dump-page shape avesmapsWikiDumpClassifyPage() and the
 * H3 parse handlers expect, from a filled state row (which stores only the
 * canonical title + the collected wikitext -- never the original <ns>/<redirect>
 * envelope). A collected page is, BY CONSTRUCTION, a wanted Main-namespace
 * article body (redirects were resolved away in the wanted-set build; only ns=0
 * articles carry the infoboxes the classifier reads), so ns=0 / redirect=null is
 * the faithful reconstruction -- the same "the dump page is canonical" stance the
 * Pass B handlers already take (title === canonicalTitle). This keeps kind
 * determination identical to Pass B without re-classifying by any other means.
 *
 * @param string $normalizedTitle the state row's normalized_title (canonical)
 * @param string $wikitext        the collected page body
 * @return array{title:string, ns:int, redirect:null, wikitext:string}
 */
function avesmapsWikiDumpHybridPageFromRow(string $normalizedTitle, string $wikitext): array
{
    return [
        'title' => $normalizedTitle,
        'ns' => 0,
        'redirect' => null,
        'wikitext' => $wikitext,
    ];
}

/**
 * Assemble the H3 override array for one state row from its three override
 * columns -- the ONE new wiring H4b adds on top of H3's already-built hook. A
 * NULL / empty column contributes nothing (the handlers already treat an absent
 * or empty-string override as "no override, keep the dump-derived value"), so an
 * all-NULL row yields [] and the handler reproduces Pass B's dump-only behaviour
 * bit-for-bit.
 *
 * @param array<string, mixed> $row a wiki_dump_hybrid_state row
 * @return array{class?: string, building_type?: string, continent?: string}
 */
function avesmapsWikiDumpHybridOverrideFromRow(array $row): array
{
    $override = [];

    $class = (string) ($row['override_class'] ?? '');
    if ($class !== '') {
        $override['class'] = $class;
    }

    $buildingType = (string) ($row['override_building_type'] ?? '');
    if ($buildingType !== '') {
        $override['building_type'] = $buildingType;
    }

    $continent = (string) ($row['override_continent'] ?? '');
    if ($continent !== '') {
        $override['continent'] = $continent;
    }

    return $override;
}

/**
 * Parse ONE filled state row into a record, applying the row's override via the
 * matching H3 handler chosen by the SAME classifier Pass B uses. Pure: no DB, no
 * dump -- it consumes an already-fetched row and returns a description of what
 * would be upserted. This is the shared core of BOTH parse_and_upsert modes: the
 * dryRun branch RETURNS these records; the sharp branch feeds `record` straight
 * into the reused per-kind upsert.
 *
 * The override is threaded ONLY into the four override-aware handlers
 * (settlement/building/region/territory); the path handler has no override
 * triple and is called exactly as Pass B calls it. A row whose reconstructed
 * page classifies as '' (no recognised infobox) or whose handler returns
 * kept=false (e.g. a non-Aventurien continent, or a Landschaft that is not a
 * real Infobox Region) yields kept=false and is NOT upserted -- identical to
 * Pass B's own skip behaviour.
 *
 * @param array<string, mixed> $row a wiki_dump_hybrid_state row (needs normalized_title + wikitext + override_*)
 * @return array{
 *   kind: string,
 *   kept: bool,
 *   title: string,
 *   override: array<string, string>,
 *   record: array<string, mixed>|null,
 *   page: array{title:string, ns:int, redirect:null, wikitext:string}
 * }
 */
function avesmapsWikiDumpHybridParseRow(array $row): array
{
    $normalizedTitle = (string) ($row['normalized_title'] ?? '');
    $wikitext = (string) ($row['wikitext'] ?? '');
    $override = avesmapsWikiDumpHybridOverrideFromRow($row);

    $page = avesmapsWikiDumpHybridPageFromRow($normalizedTitle, $wikitext);
    $kind = avesmapsWikiDumpClassifyPage($page);

    $result = ['kept' => false, 'record' => null];
    switch ($kind) {
        case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
            // Paths carry no override triple -- called exactly as Pass B calls it.
            $result = avesmapsWikiDumpParsePathPage($page);
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
            $result = avesmapsWikiDumpParseRegionPage($page, $override);
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:
            $result = avesmapsWikiDumpParseSettlementPage($page, $override);
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_BUILDING:
            $result = avesmapsWikiDumpParseBuildingPage($page, $override);
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:
            $result = avesmapsWikiDumpParseTerritoryPage($page, $override);
            break;
    }

    $record = (!empty($result['kept']) && is_array($result['record'] ?? null)) ? $result['record'] : null;

    return [
        'kind' => $kind,
        'kept' => $record !== null,
        'title' => $normalizedTitle,
        'override' => $override,
        'record' => $record,
        'page' => $page, // the reconstructed dump page (reused by the sharp settlement base-upsert)
    ];
}

// ===========================================================================
// 2. wikitext_collect STEP (DB + dump; resumable; SANDBOX-only writes).
// ===========================================================================

/**
 * Process ONE bounded wikitext_collect step: fill the `wikitext` column of the
 * still-pending state rows for $runId from the dump, resuming from a page-counter
 * cursor. Mirrors avesmapsWikiDumpRunPassBStep's reopen+skip discipline, but with
 * the ADJUDICATED time-budget-primary stopping rule (see the file docblock) and
 * writing ONLY the sandbox wiki_dump_hybrid_state table.
 *
 * Per step:
 *   1. Rebuild the wanted-title SET FRESH from a bounded
 *      `SELECT normalized_title ... WHERE run_id=? AND wikitext_found_at IS NULL`
 *      (never held resident across steps -- PHP memory stays bounded regardless
 *      of the total wanted-set size), resolved through the H4a title->title alias
 *      map via avesmapsWikiDumpHybridBuildWantedSet().
 *   2. If the wanted set is empty, return done=true immediately (nothing left to
 *      collect -- do not even open the dump).
 *   3. Reopen the reader, skip $cursor pages, then stream pages, running H2's
 *      avesmapsWikiDumpCollectWikitextForTitles() semantics inline (normalize
 *      each dump title, membership-test, collect) and writing wikitext +
 *      wikitext_found_at to the matching state row as each is found. Stop when
 *      the TIME budget is hit (primary cap, ~25s margin), when every wanted title
 *      has been found (H2 early-exit), or when the stream ends (done).
 *
 * nextCursor = $cursor + pages_scanned so the caller resumes past the pages this
 * step consumed. done=true when the stream ends OR the fresh wanted set was empty
 * (i.e. every row already has wikitext). pages_scanned + step_counter are logged
 * via error_log so the owner can see whether one full pass takes 1 step or many.
 *
 * @param PDO      $pdo
 * @param string   $dumpPath  path to the .bz2 / .gz / .xml dump
 * @param int      $runId     numeric wiki_sync_runs.id (see file docblock RUN-ID NOTE)
 * @param int      $cursor    number of leading <page> elements already consumed
 * @param int      $stepIndex 0-based running step counter, for the log line only
 * @param float|null $marginSeconds time margin below STEP_SECONDS to stop at (default ~25s of the 28s budget)
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows; default = real reader
 * @param array<string,string>|null $titleAliasMap H4a title->title redirect map (normalized alias => normalized canonical); null/[] = no alias resolution
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int, wanted_remaining:int, step:int}
 */
function avesmapsWikiDumpHybridWikitextCollectStep(
    PDO $pdo,
    string $dumpPath,
    int $runId,
    int $cursor = 0,
    int $stepIndex = 0,
    ?float $marginSeconds = null,
    ?callable $pageSource = null,
    ?array $titleAliasMap = null
): array {
    avesmapsWikiDumpHybridEnsureStateTable($pdo);

    // ~25s margin under the 28s step budget: scan as many pages as fit the time
    // window (adjudicated primary cap), NOT the fixed 2000-page budget.
    $margin = $marginSeconds ?? (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + $margin;

    // (1) Fresh pending-title set for this run, resolved through H4a's title->title
    //     redirect alias map. The map is passed in by the caller (H4c owns where
    //     the redirect_aliases phase produces/persists
    //     avesmapsWikiDumpCollectRedirectTitleAliases()'s output); [] = no alias
    //     resolution, which is correct when no wanted title is a redirect.
    $pendingTitles = avesmapsWikiDumpHybridFetchPendingTitles($pdo, $runId);
    $wantedSet = avesmapsWikiDumpHybridBuildWantedSet($pendingTitles, $titleAliasMap ?? []);
    $wantedRemaining = count($wantedSet);

    if ($wantedRemaining === 0) {
        avesmapsWikiDumpHybridLogCollectStep($stepIndex, $cursor, 0, 0, 0, true);
        return [
            'ok' => true,
            'done' => true, // nothing pending -> the collect phase is complete
            'nextCursor' => max(0, $cursor),
            'pages_scanned' => 0,
            'found_this_step' => 0,
            'wanted_remaining' => 0,
            'step' => $stepIndex,
        ];
    }

    // (3) Reopen + skip + stream. The page source is injectable for tests; the
    //     default reopens the real reader and skips $cursor pages (Pass A/B model).
    $source = $pageSource ?? static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            // No maxPages: the TIME budget (not a page count) is the primary cap.
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };

    $upsertWikitext = $pdo->prepare(
        'UPDATE wiki_dump_hybrid_state
            SET wikitext = :wikitext, wikitext_found_at = CURRENT_TIMESTAMP(3)
          WHERE run_id = :run_id AND normalized_title = :normalized_title'
    );

    $pagesScanned = 0;
    $foundThisStep = 0;
    $found = [];                 // canonical normalized title => true (H2 early-exit tracker)
    $streamExhausted = true;     // stays true iff the foreach falls through without any break

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        // H2 collector semantics, inline: normalize the dump title, membership-test.
        $key = avesmapsWikiSyncMonitorNormalizeTitle((string) ($page['title'] ?? ''));
        if ($key !== '' && isset($wantedSet[$key]) && !isset($found[$key])) {
            $found[$key] = true;
            // Write the body back onto the ORIGINAL requested state row (the trace
            // value), which is the row whose wikitext_found_at is still NULL.
            $upsertWikitext->execute([
                'wikitext' => (string) ($page['wikitext'] ?? ''),
                'run_id' => $runId,
                'normalized_title' => $wantedSet[$key],
            ]);
            $foundThisStep++;

            if (count($found) === $wantedRemaining) {
                $streamExhausted = false; // H2 early-exit -- more pages may remain
                break; // every wanted title found in this pass
            }
        }

        // Adjudicated PRIMARY cap: the time budget, not a fixed page count.
        if (microtime(true) >= $deadline) {
            $streamExhausted = false; // ran out of time, not out of pages
            break;
        }
    }

    // done iff the stream ran to exhaustion (the foreach fell through with neither
    // the time budget nor the early-exit breaking it). When the phase early-exits
    // because every wanted title was found, the NEXT step's fresh wanted-set will
    // be empty and return done=true via the empty-set path above -- so an early
    // exit never wrongly reports the whole collect phase complete here.
    $done = $streamExhausted;

    $nextCursor = max(0, $cursor) + $pagesScanned;
    avesmapsWikiDumpHybridLogCollectStep($stepIndex, $cursor, $pagesScanned, $foundThisStep, $wantedRemaining, $done);

    return [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $nextCursor,
        'pages_scanned' => $pagesScanned,
        'found_this_step' => $foundThisStep,
        'wanted_remaining' => $wantedRemaining,
        'step' => $stepIndex,
    ];
}

/**
 * Fetch the still-pending normalized titles for a run (wikitext_found_at IS NULL)
 * as a plain list -- the bounded SELECT wikitext_collect rebuilds fresh each step
 * so the wanted set is never held resident across steps. Thin DB accessor;
 * owner-live-verified (a fixture test injects a fake page source instead).
 *
 * @return list<string>
 */
function avesmapsWikiDumpHybridFetchPendingTitles(PDO $pdo, int $runId): array
{
    $statement = $pdo->prepare(
        'SELECT normalized_title
           FROM wiki_dump_hybrid_state
          WHERE run_id = :run_id AND wikitext_found_at IS NULL'
    );
    $statement->execute(['run_id' => $runId]);

    $titles = [];
    while (($title = $statement->fetchColumn()) !== false) {
        $titles[] = (string) $title;
    }

    return $titles;
}

/**
 * Emit ONE structured log line per wikitext_collect step so the owner can see,
 * across a run, whether a full dump pass took 1 step or many (the adjudicated
 * signal for whether the byte-offset-seek follow-up is ever worth building). Uses
 * error_log (never echo -- this file is include-safe and endpoint-driven).
 */
function avesmapsWikiDumpHybridLogCollectStep(
    int $stepIndex,
    int $cursor,
    int $pagesScanned,
    int $foundThisStep,
    int $wantedRemaining,
    bool $done
): void {
    error_log(sprintf(
        '[wikidump/hybrid] wikitext_collect step=%d cursor=%d pages_scanned=%d found=%d wanted_remaining=%d done=%s',
        $stepIndex,
        $cursor,
        $pagesScanned,
        $foundThisStep,
        $wantedRemaining,
        $done ? 'true' : 'false'
    ));
}

// ===========================================================================
// 3. parse_and_upsert STEP (dryRun read-only OR the ONE sharp writer).
// ===========================================================================

/**
 * Process ONE bounded parse_and_upsert step over the FILLED state rows for
 * $runId. This phase NEVER reopens the dump -- the wikitext is already staged in
 * the state table -- so its cursor is a wiki_dump_hybrid_state.id high-water mark,
 * not a page counter.
 *
 * Iterates rows `WHERE run_id=? AND wikitext_found_at IS NOT NULL AND processed_at
 * IS NULL AND id > :cursor ORDER BY id LIMIT :budget`, and for each row parses it
 * via avesmapsWikiDumpHybridParseRow() (the H3 handler chosen by the SAME
 * classifier Pass B uses, WITH the row's override).
 *
 *   $dryRun = true  -> DO NOT call any upsert and DO NOT mark processed_at.
 *       Collect the parsed records and RETURN them under 'records'. This is what
 *       the H5 compare-test consumes read-only (hybrid-derived records vs. the
 *       live DB), honouring "nothing sharp before the compare-test is green". A
 *       later real (dryRun=false) run still processes the row (it is untouched).
 *
 *   $dryRun = false -> call the SAME per-kind upsert Pass B
 *       (avesmapsWikiDumpRunPassBStep) already uses for the row's kind -- zero new
 *       upsert code -- then mark the row processed_at. This is the ONE sharp step
 *       H4b introduces (it writes the real wiki_*_staging), gated by H4c/H5 behind
 *       a green compare-test.
 *
 * In BOTH modes the cursor advances by the ROWS SCANNED this step (the max id
 * seen), so a dry run can be looped to completion for the compare-test without
 * ever writing, and the same loop with dryRun=false performs the sharp writes.
 * done=true when fewer than $budget rows were scanned (the pending set is
 * exhausted for this run).
 *
 * @param PDO      $pdo
 * @param int      $runId  numeric wiki_sync_runs.id (see file docblock RUN-ID NOTE)
 * @param int      $cursor state-row id high-water mark (rows with id > cursor are scanned)
 * @param bool     $dryRun true = parse + return records + write NOTHING; false = reuse Pass B upserts + mark processed
 * @param int|null $budget max rows to scan this step (default AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET)
 * @param callable|null $rowFetcher test seam: (pdo, runId, cursor, budget) => list<row>; default = real SELECT
 * @param array<string, callable>|null $upsertOverrides test seam: kind => upsert spy (dryRun=false only)
 * @return array{
 *   ok:bool, done:bool, nextCursor:int, processed_this_step:int, kept:int,
 *   dry_run:bool, records?: list<array{kind:string, title:string, override:array<string,string>, record:array<string,mixed>}>
 * }
 */
function avesmapsWikiDumpHybridParseUpsertStep(
    PDO $pdo,
    int $runId,
    int $cursor = 0,
    bool $dryRun = true,
    ?int $budget = null,
    ?callable $rowFetcher = null,
    ?array $upsertOverrides = null
): array {
    $budget = $budget ?? AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);

    if (!$dryRun) {
        // Guard the enrichment/schema columns exactly as Pass B does before its
        // settlement/building upserts (idempotent).
        avesmapsWikiSettlementEnsureSchema($pdo);
    } else {
        avesmapsWikiDumpHybridEnsureStateTable($pdo);
    }

    $rows = $rowFetcher !== null
        ? $rowFetcher($pdo, $runId, $cursor, $budget)
        : avesmapsWikiDumpHybridFetchProcessableRows($pdo, $runId, $cursor, $budget);

    $processedThisStep = 0;
    $kept = 0;
    $maxId = max(0, $cursor);
    $records = [];

    foreach ($rows as $row) {
        $processedThisStep++;
        $rowId = (int) ($row['id'] ?? 0);
        if ($rowId > $maxId) {
            $maxId = $rowId;
        }

        $parsed = avesmapsWikiDumpHybridParseRow($row);

        if ($dryRun) {
            // Read-only: collect kept records, write NOTHING, do NOT mark processed.
            if ($parsed['kept'] && is_array($parsed['record'])) {
                $kept++;
                $records[] = [
                    'kind' => $parsed['kind'],
                    'title' => $parsed['title'],
                    'override' => $parsed['override'],
                    'record' => $parsed['record'],
                ];
            }
            continue;
        }

        // Sharp: reuse the EXACT per-kind Pass B upsert, then mark processed.
        if ($parsed['kept'] && is_array($parsed['record'])) {
            avesmapsWikiDumpHybridUpsertParsedRow($pdo, $parsed, $upsertOverrides);
            $kept++;
        }
        avesmapsWikiDumpHybridMarkProcessed($pdo, $rowId); // runs even when kept=false (e.g. continent-filtered) -- intentional: the row was still validly examined, so it must not be rescanned every step.
    }

    $done = $processedThisStep < $budget; // fewer than a full batch -> pending set drained

    $result = [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $maxId,
        'processed_this_step' => $processedThisStep,
        'kept' => $kept,
        'dry_run' => $dryRun,
    ];
    if ($dryRun) {
        $result['records'] = $records;
    }

    return $result;
}

/**
 * Upsert ONE parsed row via the SAME per-kind upsert avesmapsWikiDumpRunPassBStep
 * already calls -- the sharp write. This is a straight lift of Pass B's
 * switch/case persistence body (dump-entity-scan.php), reusing every existing
 * upsert VERBATIM; it invents no new upsert. Only reached on the dryRun=false
 * path.
 *
 * The settlement + building paths reuse the exact reused upserts (base
 * UpsertPageCache + the enrich UPDATE, license NULL per I5; the online
 * building-row upsert). The $upsertOverrides seam lets a test inject a spy per
 * kind (proving the sharp path routes to the right upsert) without a live DB; in
 * production it is null and the real reused upserts run.
 *
 * @param array{kind:string, title:string, record:array<string,mixed>|null, page?:array<string,mixed>} $parsed the avesmapsWikiDumpHybridParseRow() result (carries the reconstructed dump page)
 * @param array<string, callable>|null $upsertOverrides kind => spy(pdo, record)
 */
function avesmapsWikiDumpHybridUpsertParsedRow(PDO $pdo, array $parsed, ?array $upsertOverrides = null): void
{
    $kind = (string) ($parsed['kind'] ?? '');
    $record = $parsed['record'];
    if (!is_array($record)) {
        return;
    }

    // Test seam: a spy for this kind short-circuits the real upsert.
    if ($upsertOverrides !== null && isset($upsertOverrides[$kind]) && is_callable($upsertOverrides[$kind])) {
        ($upsertOverrides[$kind])($pdo, $record);
        return;
    }

    switch ($kind) {
        case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
            avesmapsWikiPathUpsertRecord($pdo, $record); // reused Pass B upsert
            break;

        case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
            avesmapsWikiRegionUpsertRecord($pdo, $record); // reused Pass B upsert
            break;

        case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:
            // Exactly Pass B's two-step settlement persistence: base cols via the
            // reused UpsertPageCache fed the API-shaped page rebuilt from the SAME
            // reconstructed dump page the parse used (so coords + content_hash come
            // from the real body), then the reused enrich UPDATE (license NULL, I5).
            $settlementPage = is_array($parsed['page'] ?? null) ? $parsed['page'] : [];
            avesmapsWikiSyncUpsertPageCache($pdo, avesmapsWikiDumpBuildApiPageFromDump($settlementPage), true);
            $settlementCoat = (string) ($record['coat_url'] ?? '');
            $settlementContinent = (string) ($record['continent'] ?? '');
            $settlementEnrich = $pdo->prepare(
                'UPDATE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' SET
                    continent = :continent, is_ruined = :is_ruined, coat_url = :coat_url,
                    coat_license_status = NULL, coat_author = NULL,
                    coat_attribution = NULL, coat_license_url = NULL,
                    enriched_at = CURRENT_TIMESTAMP()
                 WHERE title = :title'
            );
            $settlementEnrich->execute([
                'continent' => $settlementContinent !== '' ? $settlementContinent : AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
                'is_ruined' => !empty($record['is_ruined']) ? 1 : 0,
                'coat_url' => $settlementCoat !== '' ? $settlementCoat : null,
                'title' => (string) ($record['title'] ?? ''),
            ]);
            break;

        case AVESMAPS_WIKI_DUMP_ENTITY_BUILDING:
            avesmapsWikiSettlementUpsertBuildingRow(
                $pdo,
                (string) ($record['title'] ?? ''),
                (string) ($record['building_type'] ?? ''),
                !empty($record['is_ruined'])
            );
            break;

        case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:
            // Reused sandbox upsert + title->key alias (I7) -- exactly Pass B.
            avesmapsWikiSyncMonitorUpsertTestRecord($pdo, $record);
            $territoryTitle = (string) ($record['title'] ?? ($parsed['title'] ?? ''));
            avesmapsWikiSyncMonitorStoreAlias(
                $pdo,
                [$territoryTitle, $territoryTitle],
                (string) ($record['wiki_key'] ?? '')
            );
            break;
    }
}

/**
 * Fetch up to $budget PROCESSABLE state rows for a run: filled (wikitext_found_at
 * IS NOT NULL) but not yet consumed (processed_at IS NULL), past the id cursor,
 * in id order. Thin DB accessor; owner-live-verified (a fixture test injects a
 * fake row list instead).
 *
 * @return list<array<string, mixed>>
 */
function avesmapsWikiDumpHybridFetchProcessableRows(PDO $pdo, int $runId, int $cursor, int $budget): array
{
    $statement = $pdo->prepare(
        'SELECT id, normalized_title, override_class, override_building_type, override_continent, wikitext
           FROM wiki_dump_hybrid_state
          WHERE run_id = :run_id
            AND wikitext_found_at IS NOT NULL
            AND processed_at IS NULL
            AND id > :cursor
          ORDER BY id
          LIMIT :budget'
    );
    $statement->bindValue(':run_id', $runId, PDO::PARAM_INT);
    $statement->bindValue(':cursor', max(0, $cursor), PDO::PARAM_INT);
    $statement->bindValue(':budget', max(1, $budget), PDO::PARAM_INT);
    $statement->execute();

    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    return is_array($rows) ? $rows : [];
}

/**
 * Mark a state row consumed (processed_at = now). Sharp-path only: a dry run
 * NEVER calls this, so a later real run still processes the row. Thin DB
 * accessor; owner-live-verified.
 */
function avesmapsWikiDumpHybridMarkProcessed(PDO $pdo, int $rowId): void
{
    $statement = $pdo->prepare(
        'UPDATE wiki_dump_hybrid_state SET processed_at = CURRENT_TIMESTAMP(3) WHERE id = :id'
    );
    $statement->execute(['id' => $rowId]);
}
