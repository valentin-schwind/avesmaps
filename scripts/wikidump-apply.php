<?php

declare(strict_types=1);

/**
 * WikiDump migration -- CLI driver for the HYBRID apply step (THE SHARP PATH).
 * ===========================================================================
 * THIS IS THE ONLY SHARP-WRITE PATH for the hybrid WikiDump migration. It runs
 * H4b's parse_and_upsert phase with dryRun=FALSE over an ALREADY-COMPLETED
 * dump_read run's wiki_dump_hybrid_state rows -- the SAME per-kind upserts Pass
 * B already uses, writing the real wiki_*_staging / political_territory_wiki
 * tables (api/_internal/wiki/dump-hybrid-read.php's
 * avesmapsWikiDumpHybridParseUpsertStep, dryRun=false branch).
 *
 * Run it on STRATO via SSH, in TWO steps:
 *
 *     php scripts/wikidump-apply.php --run=<public_id>              # PREVIEW (writes nothing)
 *     php scripts/wikidump-apply.php --run=<public_id> --confirm    # APPLY (writes to *_staging)
 *
 * WHAT "APPLY" MEANS HERE (deliberately narrow): reuse the READ result of a
 * dump_read run that has ALREADY run read_step to completion (status=
 * 'completed'), whose wiki_dump_hybrid_state rows are therefore already filled
 * with wikitext + the online-category overrides. This tool does NOT start a
 * fresh run, does NOT rebuild the online class/building/continent maps, does
 * NOT re-open the dump, and does NOT redo redirect_aliases/wikitext_collect --
 * all of that already happened when the run reached status=completed. It ONLY
 * loops phase 6 (parse_and_upsert) a second time over that SAME run's state
 * table, this time with dryRun=FALSE so the parse results are actually
 * persisted (and each row is marked processed_at). This mirrors exactly how
 * scripts/wikidump-compare.php --hybrid sources its records (via
 * avesmapsWikiDumpHybridParseUpsertStep looped to completion) -- the ONLY
 * difference is the dryRun flag.
 *
 * WHY NOT avesmapsWikiDumpHybridAdvanceReadStep() (the read_step/apply
 * dispatcher dump.php's actions use): that function's FIRST branch is an
 * idempotent-terminal short-circuit -- "if the run's status is already
 * 'completed', echo the final state and dispatch NO step at all" (see
 * dump-hybrid-driver.php's avesmapsWikiDumpHybridAdvanceReadStep and
 * tools/wikidump/test-dump-hybrid-read-driver.php check C7: "a completed run
 * echoes terminally and dispatches NO step ... so a stray apply on a done run
 * writes nothing"). Since the run this tool targets is BY DESIGN already
 * status=completed (the read pass finished), calling that dispatcher on it
 * would silently no-op -- never reach phase 6, never write anything. This tool
 * therefore calls avesmapsWikiDumpHybridParseUpsertStep() DIRECTLY (the same
 * function wikidump-compare.php --hybrid calls directly, for the same reason),
 * bypassing the phase-machine dispatcher entirely. It is still 100% the
 * REUSED, existing sharp path -- just invoked the way a completed run requires.
 *
 * SAFETY GATE: without --confirm, this tool prints a preview (run id/status,
 * how many wiki_dump_hybrid_state rows are still pending for THIS run --
 * wikitext_found_at IS NOT NULL AND processed_at IS NULL -- the exact WHERE
 * clause avesmapsWikiDumpHybridFetchProcessableRows() scans) and EXITS 0
 * WITHOUT calling the parse/upsert step even once. Only --confirm proceeds to
 * the write loop. There is no other way to make this tool write: dryRun is
 * NEVER a CLI flag (unlike scripts/wikidump-read.php, which hardcodes
 * dryRun=true, this file hardcodes dryRun=FALSE on the --confirm branch only --
 * the inverse hardcode, equally fixed).
 *
 * RUN VALIDATION: --run=<public_id> is REQUIRED (no "latest completed" auto-pick
 * -- unlike wikidump-compare.php --hybrid, a sharp write must never guess which
 * run to apply). The run must resolve, have sync_type=dump_read, and have
 * status=completed; each failure prints a clear, specific reason and exits
 * non-zero before touching wiki_dump_hybrid_state.
 *
 * IT NEVER RE-RUNS PHASES 1-5 AND NEVER RE-FETCHES THE DUMP: no dump path is
 * resolved, no dump file is opened, and none of online_class_map /
 * online_building_map / online_continent_map / redirect_aliases /
 * wikitext_collect are invoked anywhere in this file (grep it -- the only H4b
 * function this file calls is avesmapsWikiDumpHybridParseUpsertStep, and the
 * only *_step it needs from the include chain is that one -- dump-reader.php /
 * dump-category-layer.php / dump-hybrid-driver.php are NOT required here).
 */

// ---------------------------------------------------------------------------
// 0. CLI GUARD -- never run over HTTP. This reads/writes real *_staging tables
//    via the DB; it is CLI-only. Over HTTP it 403s and exits before loading
//    anything.
// ---------------------------------------------------------------------------
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['REQUEST_URI']) || isset($_SERVER['HTTP_HOST'])) { // STRATO CLI runs as cgi-fcgi (not 'cli'); detect a real HTTP request by its server markers instead
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden: wikidump-apply.php is a CLI-only tool.\n";
    exit(1);
}

// STRATO CLI runs under the cgi-fcgi SAPI, where the cli-only STDERR/STDOUT constants
// are undefined. Define them (fallback to php://output) so fwrite(STDERR,...) works.
if (!defined('STDERR')) { define('STDERR', fopen('php://stderr', 'wb') ?: fopen('php://output', 'wb')); }
if (!defined('STDOUT')) { define('STDOUT', fopen('php://stdout', 'wb') ?: fopen('php://output', 'wb')); }

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivations require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll scripts/wikidump-apply.php\n");
    exit(2);
}

@set_time_limit(0);

// ---------------------------------------------------------------------------
// 1. Argument parsing. --run= is REQUIRED (checked after parsing, so --help
//    still works without it).
// ---------------------------------------------------------------------------
$options = avesmapsWikiDumpApplyParseArgs($argv ?? []);
if ($options['help']) {
    echo "Avesmaps WikiDump HYBRID apply CLI driver -- THE SHARP PATH (writes *_staging)\n\n";
    echo "Usage:\n";
    echo "  php scripts/wikidump-apply.php --run=<public_id>              # preview only, writes nothing\n";
    echo "  php scripts/wikidump-apply.php --run=<public_id> --confirm    # APPLY: writes to *_staging\n\n";
    echo "Options:\n";
    echo "  --run=<id>   REQUIRED. The public_id of an ALREADY-COMPLETED dump_read run\n";
    echo "               (sync_type=dump_read, status=completed) whose\n";
    echo "               wiki_dump_hybrid_state rows are already filled. No fresh-run\n";
    echo "               fallback -- this tool never starts a new run.\n";
    echo "  --confirm    Without this flag: preview only (run info + pending row count),\n";
    echo "               exits 0, writes NOTHING. With this flag: runs the sharp\n";
    echo "               parse_and_upsert(dryRun=false) loop over the run's state rows.\n";
    echo "  --help       Show this help.\n\n";
    echo "This tool reuses the run's ALREADY-COLLECTED wikitext + overrides -- it never\n";
    echo "re-fetches the dump and never re-runs phases 1-5 (online maps, redirect\n";
    echo "aliases, wikitext_collect). It only loops phase 6 (parse_and_upsert) a SECOND\n";
    echo "time over the same state table, this time with dryRun=false.\n";
    exit(0);
}
if ($options['run'] === '') {
    fwrite(STDERR, "FATAL: --run=<public_id> is required (no fresh-run fallback). Use --help for usage.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Include chain -- all side-effect-free on include (const + function defs).
//    Deliberately NARROWER than wikidump-read.php's chain: this tool never
//    opens the dump and never re-runs phases 1-5, so it requires neither
//    dump-reader.php nor dump-category-layer.php nor dump-hybrid-driver.php --
//    only what avesmapsWikiDumpHybridParseUpsertStep() itself needs (the H3
//    parse handlers + the per-kind Pass B upserts it reuses verbatim), plus
//    dump-entity-scan.php for the AVESMAPS_WIKI_DUMP_ENTITY_* / SYNC_TYPE
//    constants and the classifier the parse step calls.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__); // scripts/ -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require_once $repoRoot . '/api/_internal/wiki/territories-tree.php';
require_once $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require_once $repoRoot . '/api/_internal/wiki/territories.php';
require_once $repoRoot . '/api/_internal/wiki/paths.php';
require_once $repoRoot . '/api/_internal/wiki/regions.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';        // AVESMAPS_WIKI_DUMP_SYNC_TYPE + page/classify helpers the H3 handlers use
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';   // AVESMAPS_WIKI_DUMP_ENTITY_* + classifier + H3 parse handlers + Pass B upserts (reused)
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';  // H4a state table (wiki_dump_hybrid_state)
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';   // H4b parse_and_upsert(dryRun) -- THE reused sharp function

// ---------------------------------------------------------------------------
// 3. Connect -- config + PDO via the standard CLI harness.
// ---------------------------------------------------------------------------
$config = avesmapsLoadApiConfig($repoRoot . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);

// ---------------------------------------------------------------------------
// 4. Resolve + validate the target run. REQUIRED --run=, no auto-pick. Every
//    failure mode gets a specific, clear message before anything else happens.
// ---------------------------------------------------------------------------
try {
    $runPublicId = avesmapsWikiSyncReadPublicId($options['run']);
} catch (\InvalidArgumentException $exception) {
    fwrite(STDERR, 'FATAL: --run=' . $options['run'] . ' is not a valid run id: ' . $exception->getMessage() . "\n");
    exit(2);
}

try {
    $run = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
} catch (\InvalidArgumentException $exception) {
    fwrite(STDERR, "FATAL: run {$runPublicId} was not found (wiki_sync_runs has no such public_id).\n");
    exit(2);
}

$runSyncType = (string) ($run['sync_type'] ?? '');
if ($runSyncType !== AVESMAPS_WIKI_DUMP_SYNC_TYPE) {
    fwrite(STDERR, "FATAL: run {$runPublicId} is not a dump_read run (sync_type={$runSyncType}, expected " . AVESMAPS_WIKI_DUMP_SYNC_TYPE . ").\n");
    fwrite(STDERR, "This tool only applies a HYBRID dump-read run's already-collected state -- not an online-crawl run.\n");
    exit(2);
}

$runStatus = (string) ($run['status'] ?? '');
if ($runStatus !== 'completed') {
    fwrite(STDERR, "FATAL: run {$runPublicId} is not completed (status={$runStatus}).\n");
    fwrite(STDERR, "Apply must target a FINISHED read pass: drive read_step (php scripts/wikidump-read.php --run={$runPublicId}, or the editor's dump panel) to completion first, so wiki_dump_hybrid_state is fully filled.\n");
    exit(2);
}

$runId = (int) $run['id'];

// ---------------------------------------------------------------------------
// 5. Count pending rows for this run -- the exact WHERE clause
//    avesmapsWikiDumpHybridFetchProcessableRows() scans (wikitext_found_at IS
//    NOT NULL AND processed_at IS NULL). Shown in BOTH preview and --confirm
//    runs, as a before/after progress reference.
// ---------------------------------------------------------------------------
avesmapsWikiDumpHybridEnsureStateTable($pdo);
$pendingCountStatement = $pdo->prepare(
    'SELECT COUNT(*) FROM wiki_dump_hybrid_state
      WHERE run_id = :run_id AND wikitext_found_at IS NOT NULL AND processed_at IS NULL'
);
$pendingCountStatement->execute(['run_id' => $runId]);
$pendingCount = (int) $pendingCountStatement->fetchColumn();

echo str_repeat('=', 72), "\n";
echo " WikiDump HYBRID apply CLI driver -- THE SHARP PATH\n";
echo str_repeat('=', 72), "\n";
echo "Run           : {$runPublicId}\n";
echo "Run status    : {$runStatus} (sync_type={$runSyncType})\n";
echo "Pending rows  : {$pendingCount}  (wikitext_found_at IS NOT NULL AND processed_at IS NULL)\n";
echo "Time          : " . date('c') . "\n\n";

// ---------------------------------------------------------------------------
// 6. THE GATE. Without --confirm: preview only, exit 0, write NOTHING.
// ---------------------------------------------------------------------------
if (!$options['confirm']) {
    echo "PREVIEW ONLY -- nothing has been written.\n";
    echo "This WRITES to the real wiki_*_staging / political_territory_wiki tables.\n";
    echo "Re-run with --confirm to APPLY:\n\n";
    echo "    php scripts/wikidump-apply.php --run={$runPublicId} --confirm\n\n";
    exit(0);
}

if ($pendingCount === 0) {
    echo "Nothing to apply: 0 pending rows for this run (already fully processed, or\n";
    echo "read_step never finished collecting wikitext for any row). No writes made.\n";
    exit(0);
}

echo "--confirm given -- APPLYING now (dryRun=false, the sole sharp *_staging writer).\n\n";

// ---------------------------------------------------------------------------
// 7. THE SHARP LOOP. Calls avesmapsWikiDumpHybridParseUpsertStep() DIRECTLY
//    (dryRun=false) -- NOT avesmapsWikiDumpHybridAdvanceReadStep(), which would
//    idempotent-terminal-echo and dispatch nothing for an already-completed
//    run (see the file docblock WHY NOT section + test C7). This mirrors
//    scripts/wikidump-compare.php --hybrid's avesmapsWikiDumpHybridCollectAllRecords()
//    loop shape exactly, with dryRun=false instead of true. Only phase 6 runs;
//    phases 1-5 are never touched, no dump path is resolved or opened.
// ---------------------------------------------------------------------------
$stepNumber = 0;
$cursor = 0;
$totalProcessed = 0;
$totalKept = 0;
try {
    do {
        $stepNumber++;
        $result = avesmapsWikiDumpHybridParseUpsertStep($pdo, $runId, $cursor, false);

        $processedThisStep = (int) ($result['processed_this_step'] ?? 0);
        $keptThisStep = (int) ($result['kept'] ?? 0);
        $done = (bool) ($result['done'] ?? false);
        $cursor = (int) ($result['nextCursor'] ?? $cursor);
        $totalProcessed += $processedThisStep;
        $totalKept += $keptThisStep;

        printf(
            "[step %4d] processed=%-6d kept=%-6d cursor=%-8d total_processed=%-8d total_kept=%-8d%s\n",
            $stepNumber,
            $processedThisStep,
            $keptThisStep,
            $cursor,
            $totalProcessed,
            $totalKept,
            $done ? '  DONE' : ''
        );
    } while (!$done);
} catch (\Throwable $error) {
    fwrite(STDERR, "\nFATAL: parse_and_upsert(dryRun=false) failed at step {$stepNumber} (cursor={$cursor}): " . $error->getMessage() . "\n");
    fwrite(STDERR, 'Type: ' . get_class($error) . "\n");
    fwrite(STDERR, "Rows already upserted in EARLIER steps of this run are already committed (each step\n");
    fwrite(STDERR, "commits its own upserts + processed_at marks); re-running --confirm resumes from the\n");
    fwrite(STDERR, "remaining pending rows (processed_at IS NULL), it does not redo completed rows.\n");
    exit(1);
}

echo "\n", str_repeat('=', 72), "\n";
echo " APPLIED: {$totalKept} records written to staging.\n";
echo " Run public_id  : {$runPublicId}\n";
echo " Rows processed : {$totalProcessed}\n";
echo str_repeat('=', 72), "\n";
echo "Next: re-run the plain (non-hybrid) compare to verify against the now-updated DB:\n";
echo "    php scripts/wikidump-compare.php\n";
echo "Or check the results in the editor's WikiSync review panel.\n";
exit(0);

// ===========================================================================
// Argument parser.
// ===========================================================================

/**
 * @param array<int, string> $argv
 * @return array{help:bool, run:string, confirm:bool}
 */
function avesmapsWikiDumpApplyParseArgs(array $argv): array
{
    $options = ['help' => false, 'run' => '', 'confirm' => false];
    foreach (array_slice($argv, 1) as $token) {
        $token = (string) $token;
        if ($token === '--help' || $token === '-h') {
            $options['help'] = true;
        } elseif ($token === '--confirm') {
            $options['confirm'] = true;
        } elseif (str_starts_with($token, '--run=')) {
            $options['run'] = trim(substr($token, strlen('--run=')));
        } else {
            fwrite(STDERR, "Unknown option: {$token} (use --help)\n");
            exit(2);
        }
    }

    return $options;
}
