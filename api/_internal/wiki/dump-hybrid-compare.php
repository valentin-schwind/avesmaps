<?php

declare(strict_types=1);

/**
 * Hybrid WikiDump migration -- Task H5: the HYBRID record-sourcing adapter for
 * the §9 compare-test (scripts/wikidump-compare.php's `--hybrid` mode).
 * ---------------------------------------------------------------------------
 * Task 5b built the §9 compare-test's PURE comparison core (dump-compare.php)
 * and its CLI orchestration (scripts/wikidump-compare.php), which sources
 * dump-side records from the plain DB-free collectors
 * (avesmapsWikiDumpCollect{Path,Region,Settlement,Building,Territory}Records).
 * H5 adds a SECOND record source -- H4b's dryRun parse_and_upsert step, which
 * already carries the online-category class/building_type/continent overrides
 * -- WITHOUT changing the comparison core or the DB SELECTs at all. This file
 * is that record-sourcing layer: it turns H4b's flat dryRun output into the
 * SAME per-entity-kind identity-keyed shape the plain collectors produce, plus
 * the run-resolution and alias-reload helpers the CLI's hybrid branch needs.
 *
 * WHY A SEPARATE LIBRARY FILE (not inlined into the CLI script, mirroring every
 * other H-task's own file-split rationale): scripts/wikidump-compare.php is a
 * CLI ENTRY POINT -- it runs top-level orchestration (arg parsing, a DB
 * connect, the full compare) as soon as it is loaded, so it cannot safely be
 * `require`d by a unit test. Splitting the adapter functions into this
 * include-safe library file (zero top-level code) lets
 * tools/wikidump/test-dump-compare-hybrid.php exercise them directly with a
 * fake PDO and zero DB/dump, exactly as dump-compare.php's own split already
 * lets test-dump-compare.php test the comparison core without a live run. The
 * CLI script `require_once`s this file and calls these functions; it defines
 * none of its own logic for this concern.
 *
 * THE FOUR FUNCTIONS:
 *   avesmapsWikiDumpGroupHybridRecordsByKind()   PURE. Groups H4b's flat
 *       {kind, title, override, record} list into the five per-entity-kind
 *       record LISTS the plain collectors would have produced. This is the
 *       ONLY genuinely new comparison-adjacent logic H5 adds -- it never
 *       inspects, renames or transforms a single field inside a record (I1:
 *       the record shape is whatever avesmapsWikiDumpParse*Page() already
 *       produced, carried straight through by avesmapsWikiDumpHybridParseRow()).
 *   avesmapsWikiDumpCompareResolveHybridRun()    Resolves the dump_read run to
 *       compare (explicit --run=<public_id>, or the latest completed
 *       dump_read run). READ-ONLY (SELECT only).
 *   avesmapsWikiDumpHybridCollectAllRecords()    Loops H4b's
 *       avesmapsWikiDumpHybridParseUpsertStep(dryRun=true) to completion,
 *       aggregating every step's records. dryRun=true is HARDCODED in this
 *       call -- never threaded from a flag -- so this function can never
 *       become the sharp writer.
 *   avesmapsWikiDumpSelectRedirectAliasMap()     READ-ONLY reload of the
 *       slug-keyed redirect alias map (wiki_redirect_alias) A2's reused
 *       parent resolver expects, persisted by the SAME
 *       avesmapsWikiSyncMonitorStoreAlias() upsert both the online crawler and
 *       a hybrid run's redirect_aliases phase already write into -- never a
 *       re-derivation, never a new alias rule.
 *
 * IT WRITES NOTHING. Every DB statement in this file is a SELECT (the ONE H4b
 * function this file calls, avesmapsWikiDumpHybridParseUpsertStep, is ALWAYS
 * invoked with dryRun=true here -- hardcoded, never a parameter of any function
 * in this file). No INSERT / UPDATE / DELETE / CREATE / ALTER / TRUNCATE
 * anywhere in this file, and no Persist* / Upsert* / RunPassX* function is ever
 * called.
 *
 * PURITY CONTRACT: side-effect-free on include (only function definitions -- no
 * top-level code, no DB connect, no headers), so a test can `require` it with
 * no MySQL. Every DB touch lives in a function that takes a PDO explicitly.
 *
 * DEPENDENCIES (the caller loads these before invoking any function here --
 * the SAME chain scripts/wikidump-compare.php already loads, since this file
 * builds on H4b's step function + the online-crawl run/alias infrastructure):
 *   _internal/bootstrap.php, wiki/sync.php, wiki/sync-monitor.php,
 *   wiki/dump-reader.php (AVESMAPS_WIKI_DUMP_SYNC_TYPE),
 *   wiki/dump-entity-scan.php (the AVESMAPS_WIKI_DUMP_ENTITY_* constants),
 *   wiki/dump-hybrid-state.php, wiki/dump-hybrid-read.php (the dryRun step this
 *   file loops). This file requires nothing on include.
 */

// ===========================================================================
// 1. PURE adapter -- group H4b's flat dryRun records by entity kind.
// ===========================================================================

/**
 * PURE adapter (the one genuinely new piece of comparison-adjacent logic H5
 * adds): group a flat list of H4b avesmapsWikiDumpHybridParseUpsertStep(dryRun=
 * true) records -- each shaped {kind, title, override, record} -- into the FIVE
 * per-entity-kind record LISTS the plain-mode collectors would have produced
 * (avesmapsWikiDumpCollectPathRecords() etc. return exactly `list<array<string,
 * mixed>>` of the `record` field, nothing else). This function does nothing
 * MORE than that regrouping -- it never inspects, renames or transforms a single
 * field inside a record (I1: the record shape is whatever the SAME
 * avesmapsWikiDumpParse*Page() handlers plain mode calls already produced,
 * carried straight through by avesmapsWikiDumpHybridParseRow()). A record whose
 * `kind` is not one of the five recognised entity constants, or whose `record`
 * is not an array, is skipped (defensive -- the real dispatch in
 * avesmapsWikiDumpHybridParseRow() never emits such a shape, but a fixture/mock
 * feeding this adapter directly might).
 *
 * No DB, no dump, no I/O -- callable with a synthetic list for a unit test with
 * zero MySQL/dump, exactly like the pure compare core itself.
 *
 * @param list<array{kind:string, title:string, override:array<string,string>, record:array<string,mixed>}> $records
 * @return array<string, list<array<string,mixed>>> entity kind constant => list of `record` payloads
 */
function avesmapsWikiDumpGroupHybridRecordsByKind(array $records): array
{
    $byKind = [
        AVESMAPS_WIKI_DUMP_ENTITY_PATH => [],
        AVESMAPS_WIKI_DUMP_ENTITY_REGION => [],
        AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT => [],
        AVESMAPS_WIKI_DUMP_ENTITY_BUILDING => [],
        AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY => [],
    ];

    foreach ($records as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $kind = (string) ($entry['kind'] ?? '');
        if (!array_key_exists($kind, $byKind)) {
            continue; // unrecognised kind -- defensive, never emitted by the real dispatch
        }
        $record = $entry['record'] ?? null;
        if (!is_array($record)) {
            continue; // defensive -- avesmapsWikiDumpHybridParseUpsertStep() only appends kept records
        }
        $byKind[$kind][] = $record;
    }

    return $byKind;
}

// ===========================================================================
// 2. Run resolution (READ-ONLY SELECT).
// ===========================================================================

/**
 * Resolve the dump_read run to compare: an explicit --run=<public_id>, or (when
 * omitted) the LATEST run with sync_type=dump_read AND status=completed. Unlike
 * avesmapsWikiSyncFetchLatestCompletedRun() (sync.php), which is NOT sync_type-
 * filtered (it would also happily return a completed ONLINE crawl run, which
 * carries no wiki_dump_hybrid_state rows at all), this helper filters explicitly
 * so an owner who forgets --run never silently compares against the wrong run
 * type. READ-ONLY (SELECT only). Throws (caught by the caller's normal PHP fatal
 * path -- this is a CLI tool, an uncaught exception is an acceptable, visible
 * failure here) if no matching run exists, or if --run=<id> does not resolve.
 *
 * @return array<string, mixed> a wiki_sync_runs row
 */
function avesmapsWikiDumpCompareResolveHybridRun(PDO $pdo, string $runOption): array
{
    if ($runOption !== '') {
        return avesmapsWikiSyncFetchRunByPublicId($pdo, avesmapsWikiSyncReadPublicId($runOption));
    }

    $statement = $pdo->prepare(
        "SELECT * FROM wiki_sync_runs
          WHERE sync_type = :sync_type AND status = 'completed'
          ORDER BY completed_at DESC, id DESC
          LIMIT 1"
    );
    $statement->execute(['sync_type' => AVESMAPS_WIKI_DUMP_SYNC_TYPE]);
    $run = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($run)) {
        throw new RuntimeException(
            'No completed dump_read run found. Run --run=<public_id> to target a specific run, '
            . 'or drive a read_step run to completion first (see the CLI file docblock OWNER-RUN RECIPE).'
        );
    }

    return $run;
}

// ===========================================================================
// 3. Loop the dryRun step to completion (READ-ONLY -- dryRun=true hardcoded).
// ===========================================================================

/**
 * Loop H4b's avesmapsWikiDumpHybridParseUpsertStep($pdo, $runId, $cursor,
 * dryRun=true) to completion, collecting every returned record. dryRun=true is
 * HARDCODED in this call -- it is never threaded from a CLI flag, so this
 * function can never become the sharp writer (see the file docblock IT WRITES
 * NOTHING paragraph). Each step call is itself read-only (dryRun=true writes
 * nothing at all -- no upsert, no processed_at); looping it merely re-reads the
 * SAME already-filled wiki_dump_hybrid_state rows repeatedly until the state
 * table's processable set is exhausted for this run (cursor-bounded, so it never
 * re-returns a row already scanned in an earlier step of this same loop). The
 * calling CLI script has no request-time budget (@set_time_limit(0) is set at
 * its top), so looping to completion in-process is appropriate there (unlike
 * the HTTP-bounded read_step/apply actions, which must return after one bounded
 * step).
 *
 * @param resource|null $progressStream fwrite() target for a one-line-per-step progress log, or null to stay silent (JSON mode)
 * @return list<array{kind:string, title:string, override:array<string,string>, record:array<string,mixed>}>
 */
function avesmapsWikiDumpHybridCollectAllRecords(PDO $pdo, int $runId, $progressStream): array
{
    $all = [];
    $cursor = 0;
    $step = 0;
    do {
        $result = avesmapsWikiDumpHybridParseUpsertStep($pdo, $runId, $cursor, true);
        $stepRecords = is_array($result['records'] ?? null) ? $result['records'] : [];
        foreach ($stepRecords as $record) {
            $all[] = $record;
        }
        if ($progressStream !== null) {
            fwrite(
                $progressStream,
                sprintf(
                    "  parse_and_upsert(dryRun) step=%d processed=%d kept=%d total_kept=%d done=%s\n",
                    $step,
                    (int) ($result['processed_this_step'] ?? 0),
                    (int) ($result['kept'] ?? 0),
                    count($all),
                    !empty($result['done']) ? 'true' : 'false'
                )
            );
        }
        $cursor = (int) ($result['nextCursor'] ?? $cursor);
        $done = !empty($result['done']);
        $step++;
    } while (!$done);

    return $all;
}

// ===========================================================================
// 4. Redirect alias map reload (READ-ONLY SELECT).
// ===========================================================================

/**
 * READ-ONLY reload of the slug-keyed redirect alias map avesmapsWikiSyncMonitor
 * StoreAlias() persists into wiki_redirect_alias (alias_slug => canonical_
 * wiki_key) -- the SAME shape and the SAME table avesmapsWikiSyncMonitorResolve
 * ParentKey() (A2) already expects, and the SAME table BOTH the online crawler
 * and a hybrid run's redirect_aliases phase write into via that one shared
 * upsert function (dump-hybrid-driver.php's avesmapsWikiDumpHybridRedirectAliasStep()
 * calls it verbatim). Plain mode instead recomputes the equivalent map in memory
 * straight from the dump (avesmapsWikiDumpCollectRedirectAliases()); hybrid mode
 * has no dump stream open, so it reads the already-persisted result of that same
 * derivation back out -- never a re-derivation, never a new alias rule. A SELECT
 * only.
 *
 * @return array<string, string> alias_slug => canonical_wiki_key
 */
function avesmapsWikiDumpSelectRedirectAliasMap(PDO $pdo): array
{
    $map = [];
    try {
        $statement = $pdo->query('SELECT alias_slug, canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE);
    } catch (\Throwable $error) {
        // Table missing (e.g. no crawl/hybrid run has ever created it yet) -> no
        // aliases to resolve; A2 falls back to unresolved-parent-name treatment,
        // same precedent as scripts/wikidump-compare.php's own
        // avesmapsWikiDumpSelectParentLocked() try/catch for a possibly-absent table.
        return $map;
    }
    if ($statement === false) {
        return $map;
    }
    foreach ($statement as $row) {
        $slug = trim((string) ($row['alias_slug'] ?? ''));
        if ($slug === '') {
            continue;
        }
        $map[$slug] = (string) ($row['canonical_wiki_key'] ?? '');
    }

    return $map;
}
