<?php

declare(strict_types=1);

/**
 * WikiDump migration -- SETTLEMENT-CONFLICT DRY-RUN (READ-ONLY CLI, no API).
 * ===========================================================================
 * A decision aid for the owner, run on STRATO via SSH BEFORE the sharp
 * settlement-Syncen is built:
 *
 *     php scripts/wikidump-settlement-conflicts-dryrun.php
 *     php scripts/wikidump-settlement-conflicts-dryrun.php --run=<public_id>
 *     php scripts/wikidump-settlement-conflicts-dryrun.php --json
 *
 * WHAT IT DOES
 *   1. Resolves the newest COMPLETED `dump_read` run (or --run=<public_id>),
 *      exactly like scripts/wikidump-compare.php's --hybrid mode
 *      (avesmapsWikiDumpCompareResolveHybridRun).
 *   2. Loops that run's READ-ONLY dryRun parse_and_upsert step to completion
 *      (avesmapsWikiDumpHybridCollectAllRecords, dryRun=true HARDCODED -- writes
 *      NOTHING) and takes the SETTLEMENT records
 *      (avesmapsWikiDumpGroupHybridRecordsByKind), the SAME record source the
 *      compare-test uses.
 *   3. Reads the live map places (avesmapsWikiSyncReadMapPlaces -- a pure SELECT
 *      on map_features, REUSED verbatim; no API).
 *   4. Classifies (dump settlements x map places) into the EXISTING 8 settlement
 *      case types by REPRODUCING the live decision tree
 *      (avesmapsWikiSyncMatchMapPlaces + avesmapsWikiSyncBuildAndStoreCases,
 *      locations.php) as NON-FETCHING, NON-PERSISTING mirrors
 *      (settlement-conflicts-dryrun.php), and additionally counts the
 *      "9th-category candidates" -- the divergences NONE of the 8 types compares.
 *   5. Prints a report: count per the 8 types + candidate counts (with example
 *      titles) + totals. Optionally --json.
 *
 * IT WRITES NOTHING AND CALLS NO MEDIAWIKI API. There is no INSERT / UPDATE /
 * DELETE / CREATE / ALTER / TRUNCATE anywhere in this file or the library it
 * calls; no avesmapsWikiSyncApiRequest / avesmapsWikiSyncFetchPagesByTitle /
 * avesmapsWikiSyncUpsertCase is reachable. The ONE dump-side step it calls
 * (avesmapsWikiDumpHybridParseUpsertStep, via
 * avesmapsWikiDumpHybridCollectAllRecords) is ALWAYS invoked dryRun=true
 * (hardcoded inside that wrapper -- there is no flag to make this tool write). The
 * only DB touch is the reused read-only avesmapsWikiSyncReadMapPlaces SELECT and
 * the compare helpers' own SELECTs.
 *
 * WHY IT EXISTS: the owner runs it on STRATO to decide, from REAL data, whether
 * the 8 existing settlement conflict categories are enough or a 9th is needed. So
 * the classification is byte-faithful to what the live
 * avesmapsWikiSyncBuildAndStoreCases would produce (counts are trustworthy), and
 * the candidate detection is honest (it never invents a conflict and never hides
 * one -- see settlement-conflicts-dryrun.php).
 *
 * OWNER-RUN RECIPE -- READ THIS BEFORE RUNNING:
 *   1. The dump settlement records come from the wiki_dump_hybrid_state sandbox.
 *      It is EMPTY until an owner has driven a 'Dump holen' / read_step run (the
 *      editor's dump panel, or POST /api/edit/wiki/dump.php {action:"start_read"}
 *      then repeated {action:"read_step", run_id}) all the way through its phases
 *      into parse_and_upsert, so the settlement wikitext is staged. A run that is
 *      only status='running' has not finished; this tool will then see fewer/zero
 *      settlements (not an error -- finish the read_step loop first).
 *   2. THEN run:  php scripts/wikidump-settlement-conflicts-dryrun.php [--run=<id>]
 *      (omit --run to auto-pick the latest completed dump_read run).
 *   3. Read the report:
 *        Section A -- how many cases each of the 8 EXISTING types would fire on
 *          this data (the counts a live crawl would upsert). If a type is 0
 *          everywhere and stays 0 across dumps, it is not load-bearing for
 *          settlements; if type_conflict / unresolved dominate, the 8 types are
 *          doing real work.
 *        Section B -- the 9th-category CANDIDATES: divergences the 8 types do NOT
 *          model (coordinate_drift, continent, is_ruined/url change, coat presence
 *          diff) + how many exact matches would need a NEW category. THIS is the
 *          signal for whether a 9th type is worth building: a non-trivial
 *          `exact_matches_needing_9th` means real conflicts are being dropped
 *          today.
 *        Section C -- totals: clean exact matches vs. those needing a 9th, plus
 *          dual-parse promotions (settlements that also became territories -- no
 *          analogue among the 8).
 *   4. Nothing here writes, so it is always safe to run and re-run.
 */

// ---------------------------------------------------------------------------
// 0. CLI GUARD -- never run over HTTP. This reads the DB; it is CLI-only. Over
//    HTTP it 403s and exits before loading anything. (STRATO CLI runs as
//    cgi-fcgi, not 'cli', so detect a real HTTP request by its server markers.)
// ---------------------------------------------------------------------------
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['REQUEST_URI']) || isset($_SERVER['HTTP_HOST'])) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden: wikidump-settlement-conflicts-dryrun.php is a CLI-only tool.\n";
    exit(1);
}

// STRATO CLI runs under the cgi-fcgi SAPI, where the cli-only STDERR/STDOUT
// constants are undefined. Define them (fallback to php://output).
if (!defined('STDERR')) { define('STDERR', fopen('php://stderr', 'wb') ?: fopen('php://output', 'wb')); }
if (!defined('STDOUT')) { define('STDOUT', fopen('php://stdout', 'wb') ?: fopen('php://output', 'wb')); }

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivations require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll scripts/wikidump-settlement-conflicts-dryrun.php\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the include chain requires XMLReader.\n");
    exit(2);
}

@set_time_limit(0);

// ---------------------------------------------------------------------------
// 1. Argument parsing (all optional).
// ---------------------------------------------------------------------------
$options = avesmapsWikiDumpDryRunParseArgs($argv ?? []);
if ($options['help']) {
    echo "Avesmaps WikiDump settlement-conflict DRY-RUN (READ-ONLY, no API)\n\n";
    echo "Usage:\n";
    echo "  php scripts/wikidump-settlement-conflicts-dryrun.php [--run=<public_id>] [--samples=<n>] [--json]\n\n";
    echo "Options:\n";
    echo "  --run=<id>      dump_read run public_id to analyse. Omit to auto-select the\n";
    echo "                  latest completed dump_read run.\n";
    echo "  --samples=<n>   Max example titles per section (default 8).\n";
    echo "  --json          Emit the full report as JSON (for tooling).\n";
    echo "  --help          Show this help.\n\n";
    echo "Requires a completed 'Dump holen' / read_step run to have filled the\n";
    echo "wiki_dump_hybrid_state sandbox first (see the file docblock OWNER-RUN RECIPE).\n";
    exit(0);
}
$emitJson = $options['json'];
$sampleLimit = $options['samples'];
$runOption = $options['run'];

// ---------------------------------------------------------------------------
// 2. Include chain -- all side-effect-free on include (const + function defs).
//    The SAME chain scripts/wikidump-compare.php loads (a known dependency
//    order), plus this feature's own dry-run library.
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
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';        // AVESMAPS_WIKI_DUMP_SYNC_TYPE + reader
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';   // AVESMAPS_WIKI_DUMP_ENTITY_* + parse handlers
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';  // dryRun step's state-table dep
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';   // dryRun parse_and_upsert step (settlement record source)
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-compare.php'; // run resolution + record collection/grouping
require_once $repoRoot . '/api/_internal/wiki/settlement-conflicts-dryrun.php'; // this feature's mirrored classifier

// ---------------------------------------------------------------------------
// 2b. Endpoint-only constants the REUSED _internal helpers depend on. SOURCE OF
//     TRUTH: api/edit/wiki/sync.php (the live WikiSync endpoint defines these at
//     its top BEFORE it reaches locations.php, so the LIVE crawl always has them).
//     This CLI never loads that endpoint (it runs top-level dispatch code), so
//     mirror the SAME values here, each guarded by defined() so if a constant is
//     ever moved into the _internal chain this block silently yields to the
//     canonical definition (no double-define; the only drift risk is a value diff
//     a reviewer can catch against sync.php). Without these the reused helpers
//     fatal:
//       - AVESMAPS_WIKI_SYNC_TYPE_LOCATION  -> avesmapsWikiSyncBuildCase (locations.php:603)
//       - AVESMAPS_WIKI_FUZZY_CUTOFF        -> avesmapsWikiSyncFindProbableWikiMatches (locations.php:377)
//       - AVESMAPS_DEREGLOBUS/POSITIONKARTE -> avesmapsWikiSyncCoordinatesToMapLocation (missing_with_coords + coordinate_drift)
// ---------------------------------------------------------------------------
if (!defined('AVESMAPS_WIKI_SYNC_TYPE_LOCATION')) { define('AVESMAPS_WIKI_SYNC_TYPE_LOCATION', 'location'); } // api/edit/wiki/sync.php:8
if (!defined('AVESMAPS_WIKI_FUZZY_CUTOFF')) { define('AVESMAPS_WIKI_FUZZY_CUTOFF', 0.82); }                 // api/edit/wiki/sync.php:7
if (!defined('AVESMAPS_DEREGLOBUS_TO_MAP')) {
    define('AVESMAPS_DEREGLOBUS_TO_MAP', [
        'x_lon' => 30.3257445760,
        'x_lat' => 0.0014126835,
        'x_offset' => 438.0819758605,
        'y_lon' => 0.007511999997,
        'y_lat' => 33.5769120338,
        'y_offset' => -466.8085324960,
    ]);
}
if (!defined('AVESMAPS_POSITIONKARTE_TO_MAP')) {
    define('AVESMAPS_POSITIONKARTE_TO_MAP', [
        'x_x' => 2.1490004455,
        'x_y' => 0.0010081646,
        'x_offset' => 188.8734061695,
        'y_x' => -0.0024556121,
        'y_y' => -2.1502199630,
        'y_offset' => 1018.3819994023,
    ]);
}

// ---------------------------------------------------------------------------
// 3. Connect (read-only usage) -- config + PDO via the standard CLI harness.
// ---------------------------------------------------------------------------
$config = avesmapsLoadApiConfig($repoRoot . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);

// ---------------------------------------------------------------------------
// 4. Resolve the dump_read run + collect its SETTLEMENT records (READ-ONLY,
//    dryRun=true). Reuses the compare-test's run resolution + record collection
//    + grouping VERBATIM; only the SETTLEMENT bucket is consumed here.
// ---------------------------------------------------------------------------
if (!$emitJson) {
    fwrite(STDERR, "Sourcing settlement records from wiki_dump_hybrid_state via parse_and_upsert(dryRun=true)...\n");
}

$run = avesmapsWikiDumpCompareResolveHybridRun($pdo, $runOption);
$runId = (int) $run['id'];
$runPublicId = (string) $run['public_id'];
if (!$emitJson) {
    fwrite(STDERR, "  run: {$runPublicId}  (status={$run['status']}, phase={$run['phase']})\n");
}

$hybridRecords = avesmapsWikiDumpHybridCollectAllRecords($pdo, $runId, $emitJson ? null : STDERR);
$byKind = avesmapsWikiDumpGroupHybridRecordsByKind($hybridRecords);
$settlementRecords = $byKind[AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT] ?? [];

// ---------------------------------------------------------------------------
// 5. Read the live map places (pure SELECT, reused verbatim -- no API).
// ---------------------------------------------------------------------------
$mapPlaces = avesmapsWikiSyncReadMapPlaces($pdo);

// ---------------------------------------------------------------------------
// 6. Classify (all pure from here -- no DB, no API).
// ---------------------------------------------------------------------------
$report = avesmapsWikiDumpDryRunClassifySettlements($mapPlaces, $settlementRecords, $sampleLimit);
$report['run_id'] = $runPublicId;
$report['generated_at'] = date('c');

// ---------------------------------------------------------------------------
// 7. Report.
// ---------------------------------------------------------------------------
if ($emitJson) {
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    exit(0);
}

avesmapsWikiDumpDryRunPrintReport($report);
exit(0);

// ===========================================================================
// Human-readable report printer.
// ===========================================================================

/** @param array<string,mixed> $report */
function avesmapsWikiDumpDryRunPrintReport(array $report): void
{
    $line = str_repeat('=', 72);
    $header = (array) ($report['header'] ?? []);
    echo $line, "\n";
    echo " WikiDump SETTLEMENT-CONFLICT DRY-RUN (READ-ONLY, no API)\n";
    echo $line, "\n";
    echo 'Run  : ' . (string) ($report['run_id'] ?? '(unknown)') . "\n";
    echo 'When : ' . (string) ($report['generated_at'] ?? '') . "\n";
    echo 'Dump settlements (excl. gebaeude): ' . (int) ($header['dump_settlements_excl_gebaeude'] ?? 0)
        . '   (gebaeude filtered out: ' . (int) ($header['gebaeude_filtered_out'] ?? 0) . ")\n";
    echo 'Map places (map_features location, active): ' . (int) ($header['map_places'] ?? 0) . "\n";
    echo "This tool writes NOTHING and calls no MediaWiki API.\n\n";

    // --- Section A: the 8 existing case types ------------------------------
    $sectionA = (array) ($report['section_a_case_types'] ?? []);
    echo "-- SECTION A  THE 8 EXISTING CASE TYPES (counts a live crawl would fire) --\n";
    printf("  %-32s | %6s | %s\n", 'case_type', 'count', 'examples');
    foreach ((array) ($sectionA['by_type'] ?? []) as $caseType => $info) {
        $samples = (array) ($info['samples'] ?? []);
        printf(
            "  %-32s | %6d | %s\n",
            $caseType,
            (int) ($info['count'] ?? 0),
            $samples === [] ? '-' : implode(', ', array_map('strval', $samples))
        );
    }
    echo '  ' . str_repeat('-', 44) . "\n";
    printf("  %-32s | %6d |\n", 'TOTAL cases (all 8 types)', (int) ($sectionA['total_cases'] ?? 0));
    echo "\n";

    // --- Section B: 9th-category candidates --------------------------------
    $sectionB = (array) ($report['section_b_candidates'] ?? []);
    echo "-- SECTION B  9th-CATEGORY CANDIDATES (divergences the 8 types do NOT compare) --\n";
    echo '  coordinate_drift threshold: > ' . (float) ($header['coord_drift_threshold_units'] ?? 0)
        . " image units (0..1024 space)\n\n";

    $drift = (array) ($sectionB['coordinate_drift'] ?? []);
    printf("  coordinate_drift .............. %6d  (max drift %.1f units)\n",
        (int) ($drift['count'] ?? 0), (float) ($drift['max_drift'] ?? 0));
    avesmapsWikiDumpDryRunPrintSamples($drift['samples'] ?? []);

    $continent = (array) ($sectionB['continent_dump_nondefault'] ?? []);
    printf("  continent_dump_nondefault ..... %6d\n", (int) ($continent['count'] ?? 0));
    if (isset($continent['note'])) {
        echo '      note: ' . (string) $continent['note'] . "\n";
    }
    avesmapsWikiDumpDryRunPrintSamples($continent['samples'] ?? []);

    $ruinUrl = (array) ($sectionB['is_ruined_or_url_change'] ?? []);
    printf("  is_ruined_or_url_change ....... %6d  (is_ruined diff %d, wiki_url diff %d)\n",
        (int) ($ruinUrl['count'] ?? 0), (int) ($ruinUrl['ruined_diff'] ?? 0), (int) ($ruinUrl['url_diff'] ?? 0));
    avesmapsWikiDumpDryRunPrintSamples($ruinUrl['samples'] ?? []);

    $coat = (array) ($sectionB['coat_presence_diff'] ?? []);
    printf("  coat_presence_diff ............ %6d  (dump-only %d, map-only %d)\n",
        (int) ($coat['count'] ?? 0), (int) ($coat['dump_only'] ?? 0), (int) ($coat['map_only'] ?? 0));
    avesmapsWikiDumpDryRunPrintSamples($coat['samples'] ?? []);

    $anyCandidate = (array) ($sectionB['matched_no_case_but_candidate'] ?? []);
    printf("  => exact matches with >=1 candidate flag: %d\n", (int) ($anyCandidate['count'] ?? 0));
    avesmapsWikiDumpDryRunPrintSamples($anyCandidate['samples'] ?? []);
    echo "\n";

    // --- Section C: totals -------------------------------------------------
    $sectionC = (array) ($report['section_c_totals'] ?? []);
    echo "-- SECTION C  TOTALS --\n";
    printf("  exact matches ................. %6d\n", (int) ($sectionC['exact_matches'] ?? 0));
    printf("    clean (none of 8, no candidate) %6d\n", (int) ($sectionC['clean_exact_matches'] ?? 0));
    printf("    would need a 9th category ..... %6d\n", (int) ($sectionC['exact_matches_needing_9th'] ?? 0));
    printf("  unresolved map places ......... %6d\n", (int) ($sectionC['unresolved'] ?? 0));
    printf("  missing wiki settlements ...... %6d\n", (int) ($sectionC['missing_wiki'] ?? 0));
    printf("  dual-parse promotions (obs.) .. %6d  (settlements also promoted to a territory; no analogue in the 8)\n",
        (int) ($sectionC['dual_parse_promotions'] ?? 0));
    echo "\n";

    echo $line, "\n";
    $needNinth = (int) ($sectionC['exact_matches_needing_9th'] ?? 0);
    echo $needNinth > 0
        ? " READ: {$needNinth} exact match(es) carry a divergence NONE of the 8 types models.\n"
            . "       Review Section B to decide whether a 9th settlement category is warranted.\n"
        : " READ: every exact match is fully described by the 8 existing types on this data.\n"
            . "       No 9th settlement category is indicated by this run.\n";
    echo "       This is a DRY-RUN: it wrote nothing and fetched nothing.\n";
    echo $line, "\n";
}

/**
 * Print a short indented example list (shared by the Section B candidates).
 * @param mixed $samples
 */
function avesmapsWikiDumpDryRunPrintSamples($samples): void
{
    $samples = is_array($samples) ? $samples : [];
    if ($samples === []) {
        return;
    }
    echo '      e.g. ' . implode(', ', array_map('strval', $samples)) . "\n";
}

// ===========================================================================
// Argument parser.
// ===========================================================================

/**
 * @param array<int, string> $argv
 * @return array{help:bool, json:bool, samples:int, run:string}
 */
function avesmapsWikiDumpDryRunParseArgs(array $argv): array
{
    // Default sample count is 8 (matches AVESMAPS_WIKIDUMP_DRYRUN_SAMPLE_LIMIT, but
    // that const's library is required AFTER arg parsing, so use the literal here).
    $options = ['help' => false, 'json' => false, 'samples' => 8, 'run' => ''];
    foreach (array_slice($argv, 1) as $token) {
        $token = (string) $token;
        if ($token === '--help' || $token === '-h') {
            $options['help'] = true;
        } elseif ($token === '--json') {
            $options['json'] = true;
        } elseif (str_starts_with($token, '--samples=')) {
            $options['samples'] = max(0, (int) substr($token, strlen('--samples=')));
        } elseif (str_starts_with($token, '--run=')) {
            $options['run'] = trim(substr($token, strlen('--run=')));
        } else {
            fwrite(STDERR, "Unknown option: {$token} (use --help)\n");
            exit(2);
        }
    }

    return $options;
}
