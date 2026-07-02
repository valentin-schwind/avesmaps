<?php

declare(strict_types=1);

/**
 * WikiDump migration -- CLI driver for the HYBRID read_step (SANDBOX-ONLY).
 * ===========================================================================
 * The hybrid read_step is normally driven via the web endpoint
 * (api/edit/wiki/dump.php {action:"start_read"} then repeated
 * {action:"read_step"} calls) + the editor's dump panel loop. This CLI gives
 * the owner an SSH-only way to drive the SAME loop without opening a browser --
 * e.g. to fill wiki_dump_hybrid_state so scripts/wikidump-compare.php --hybrid
 * has a completed dump_read run to compare against ("No completed dump_read
 * run found" until one exists).
 *
 * Run it on STRATO via SSH:
 *
 *     php scripts/wikidump-read.php
 *     php scripts/wikidump-read.php --user=<name> --pass=<pass>   # refresh dump creds first
 *     php scripts/wikidump-read.php --run=<public_id>             # resume an existing run
 *
 * WHAT IT DOES, per step, in a loop:
 *   1. starts a NEW dump_read run (avesmapsWikiDumpHybridStartRun -- the SAME
 *      call dump.php's start_read action makes) -- unless --run=<public_id> is
 *      given, in which case that EXISTING run is resumed instead (every phase
 *      is idempotent/resumable by design, so resuming is safe);
 *   2. loops avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runId, $dumpPath,
 *      dryRun=true) -- the IDENTICAL function + dryRun value dump.php's
 *      read_step action uses -- printing the phase, cursor, and progress
 *      fields after every step, until the response says done;
 *   3. prints the run's public_id + the follow-up compare-test command.
 *
 * IT WRITES NOTHING SHARP. dryRun=true is HARDCODED below -- never a CLI flag
 * -- exactly like dump.php's read_step action (never its apply action, which
 * this file does not call and does not import). Phases 1-5 write only the
 * state/alias sandbox tables; phase 6 (parse_and_upsert) with dryRun=true
 * writes NOTHING at all (see dump-hybrid-driver.php's THE GATE docblock). The
 * sharp *_staging apply path stays the gated UI-only "apply" action; this tool
 * neither calls nor imports avesmapsWikiDumpHybridAdvanceReadStep with
 * dryRun=false anywhere.
 *
 * CREDENTIALS: the dump fetch reuses the stored last-working DB credential
 * pair (the SAME avesmapsWikiDumpFetch() the endpoint's fetch_dump/read_step
 * actions call). If that pair is stale, the wiki server returns 401 and this
 * tool exits with a message telling the owner to re-run with --user=/--pass=
 * (which calls avesmapsWikiDumpSetCredentials() FIRST, the same persist
 * set_dump_credentials uses) or to set fresh credentials in the editor UI.
 */

// ---------------------------------------------------------------------------
// 0. CLI GUARD -- never run over HTTP. This reads/writes sandbox tables via the
//    DB; it is CLI-only. Over HTTP it 403s and exits before loading anything.
// ---------------------------------------------------------------------------
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['REQUEST_URI']) || isset($_SERVER['HTTP_HOST'])) { // STRATO CLI runs as cgi-fcgi (not 'cli'); detect a real HTTP request by its server markers instead
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden: wikidump-read.php is a CLI-only tool.\n";
    exit(1);
}

// STRATO CLI runs under the cgi-fcgi SAPI, where the cli-only STDERR/STDOUT constants
// are undefined. Define them (fallback to php://output) so fwrite(STDERR,...) works.
if (!defined('STDERR')) { define('STDERR', fopen('php://stderr', 'wb') ?: fopen('php://output', 'wb')); }
if (!defined('STDOUT')) { define('STDOUT', fopen('php://stdout', 'wb') ?: fopen('php://output', 'wb')); }

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivations require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll scripts/wikidump-read.php\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the dump reader requires XMLReader.\n");
    exit(2);
}

@set_time_limit(0);

// ---------------------------------------------------------------------------
// 1. Argument parsing (all optional).
// ---------------------------------------------------------------------------
$options = avesmapsWikiDumpReadParseArgs($argv ?? []);
if ($options['help']) {
    echo "Avesmaps WikiDump hybrid read_step CLI driver (SANDBOX-ONLY, dryRun=true)\n\n";
    echo "Usage:\n";
    echo "  php scripts/wikidump-read.php [--run=<public_id>] [--user=<name> --pass=<pass>]\n\n";
    echo "Options:\n";
    echo "  --run=<id>      Resume an existing dump_read run's public_id instead of starting\n";
    echo "                  a fresh one. Every phase is idempotent/resumable by design.\n";
    echo "  --user=<name>   Store this dump-download username BEFORE the first step (same\n";
    echo "                  effect as the UI's set_dump_credentials action). Requires --pass=.\n";
    echo "  --pass=<pass>   Store this dump-download password BEFORE the first step. Requires\n";
    echo "                  --user=.\n";
    echo "  --help          Show this help.\n\n";
    echo "This tool NEVER runs the sharp apply path. dryRun=true is hardcoded; phase 6\n";
    echo "(parse_and_upsert) writes NOTHING even in sandbox form while dryRun=true.\n";
    exit(0);
}
if (($options['user'] !== '') xor ($options['pass'] !== '')) {
    fwrite(STDERR, "FATAL: --user= and --pass= must be given together.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Include chain -- all side-effect-free on include (const + function defs).
//    Same chain scripts/wikidump-compare.php uses, plus the hybrid driver
//    (dump-hybrid-driver.php) that owns start_read/read_step. The order is a
//    known dependency chain (paths.php needs Clean* from
//    territories-parsing.php, which needs a helper from territories-tree.php).
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
require_once $repoRoot . '/api/_internal/wiki/dump-fetch.php';          // avesmapsWikiDumpFetch/SetCredentials/StoragePath
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';         // reader + redirect collector
require_once $repoRoot . '/api/_internal/wiki/dump-category-layer.php'; // H1 online override maps
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';    // entity collectors
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';   // H4a state table
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';    // H4b parse_and_upsert(dryRun)
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php';  // start_read + read_step orchestration

// ---------------------------------------------------------------------------
// 3. Connect -- config + PDO via the standard CLI harness.
// ---------------------------------------------------------------------------
$config = avesmapsLoadApiConfig($repoRoot . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);

// ---------------------------------------------------------------------------
// 4. Optional credential refresh -- BEFORE the first step, so a stale DB pair
//    never causes a 401 mid-run. Same persist avesmapsWikiDumpSetCredentials()
//    the endpoint's set_dump_credentials action uses.
// ---------------------------------------------------------------------------
if ($options['user'] !== '' && $options['pass'] !== '') {
    try {
        avesmapsWikiDumpSetCredentials($pdo, $options['user'], $options['pass']);
        fwrite(STDERR, "Dump credentials updated for user '{$options['user']}'.\n");
    } catch (\InvalidArgumentException $exception) {
        fwrite(STDERR, 'FATAL: could not store dump credentials: ' . $exception->getMessage() . "\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 5. Resolve the local dump file, auto-fetching it (Task 5a) if absent -- the
//    SAME avesmapsWikiDumpFetch() call dump.php's avesmapsWikiDumpEnsureDumpPresentOrFail()
//    makes, just without the HTTP-response/exit side effect (CLI reports and
//    exits non-zero on failure instead).
// ---------------------------------------------------------------------------
$dumpPath = avesmapsWikiDumpStoragePath();
if (!is_file($dumpPath)) {
    fwrite(STDERR, "Dump not present locally -- fetching it now...\n");
    $fetchResult = avesmapsWikiDumpFetch($pdo, false);
    if (($fetchResult['ok'] ?? false) !== true || !is_file($dumpPath)) {
        $code = (string) ($fetchResult['code'] ?? 'dump_fetch_failed');
        if ($code === 'dump_unauthorized') {
            fwrite(STDERR, "FATAL: dump_unauthorized -- the dump server rejected the stored credentials (HTTP 401).\n");
            fwrite(STDERR, "Pass --user=<name> --pass=<pass> to store fresh credentials, or set them in the editor UI, then re-run.\n");
        } else {
            fwrite(STDERR, "FATAL: the dump could not be downloaded from the wiki server (code={$code}).\n");
        }
        exit(2);
    }
    fwrite(STDERR, "Dump fetched: {$dumpPath}\n");
}

// ---------------------------------------------------------------------------
// 6. Start or resume the dump_read run.
// ---------------------------------------------------------------------------
if ($options['run'] !== '') {
    try {
        $runPublicId = avesmapsWikiSyncReadPublicId($options['run']);
    } catch (\InvalidArgumentException $exception) {
        fwrite(STDERR, 'FATAL: --run=' . $options['run'] . ' is not a valid run id: ' . $exception->getMessage() . "\n");
        exit(2);
    }
    fwrite(STDERR, "Resuming existing dump_read run: {$runPublicId}\n");
} else {
    $startResult = avesmapsWikiDumpHybridStartRun($pdo, null);
    $runPublicId = (string) $startResult['run']['public_id'];
    fwrite(STDERR, "Started new dump_read run: {$runPublicId}\n");
}

echo str_repeat('=', 72), "\n";
echo " WikiDump HYBRID read_step CLI driver -- SANDBOX ONLY (dryRun=true)\n";
echo str_repeat('=', 72), "\n";
echo "Run   : {$runPublicId}\n";
echo "Dump  : {$dumpPath}\n";
echo "Start : " . date('c') . "\n\n";

// ---------------------------------------------------------------------------
// 7. Loop the step function to completion. dryRun=true is HARDCODED -- never a
//    CLI flag -- so this call can never become the sharp apply writer (see the
//    file docblock). On an exception mid-step, print it + the phase reached so
//    far and exit non-zero so the owner sees WHERE the first real run failed.
// ---------------------------------------------------------------------------
$stepNumber = 0;
$lastPhase = '(not started)';
try {
    while (true) {
        $stepNumber++;
        $lastPhase = avesmapsWikiDumpReadCurrentPhase($pdo, $runPublicId, $lastPhase);

        $result = avesmapsWikiDumpHybridAdvanceReadStep($pdo, $runPublicId, $dumpPath, true);

        $phase = (string) ($result['phase'] ?? '?');
        $cursor = (int) ($result['cursor'] ?? 0);
        $done = (bool) ($result['done'] ?? false);
        $progress = (array) ($result['progress'] ?? []);
        $lastPhase = $phase;

        printf(
            "[step %4d] phase=%-22s cursor=%-8d progress=%d/%d%s\n",
            $stepNumber,
            $phase,
            $cursor,
            (int) ($progress['progress_current'] ?? 0),
            (int) ($progress['progress_total'] ?? 0),
            $done ? '  DONE' : ''
        );
        foreach (['pages_scanned', 'found_this_step', 'written', 'processed_this_step', 'kept', 'title_count', 'title_aliases_written'] as $key) {
            if (array_key_exists($key, $progress)) {
                echo "             {$key}=" . var_export($progress[$key], true) . "\n";
            }
        }

        if ($done) {
            break;
        }
    }
} catch (\Throwable $error) {
    fwrite(STDERR, "\nFATAL: read_step failed at phase '{$lastPhase}' (step {$stepNumber}): " . $error->getMessage() . "\n");
    fwrite(STDERR, 'Type: ' . get_class($error) . "\n");
    exit(1);
}

echo "\n", str_repeat('=', 72), "\n";
echo " RESULT: dump_read run completed (sandbox only -- nothing sharp written).\n";
echo " Run public_id: {$runPublicId}\n";
echo " Next: php scripts/wikidump-compare.php --hybrid --run={$runPublicId}\n";
echo "       (or without --run to auto-pick the latest completed dump_read run)\n";
echo str_repeat('=', 72), "\n";
exit(0);

// ===========================================================================
// Helpers.
// ===========================================================================

/**
 * Best-effort read of the run's CURRENT phase before the next step runs, purely
 * for a more accurate "failed at phase X" message if this very step throws
 * (the step that throws never returns a $result to read the phase from). Falls
 * back to the previously known phase on any lookup trouble -- this is a
 * diagnostic nicety, never allowed to itself throw and mask the real error.
 */
function avesmapsWikiDumpReadCurrentPhase(PDO $pdo, string $runPublicId, string $fallback): string
{
    try {
        $run = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
        $phase = (string) ($run['phase'] ?? '');
        return $phase !== '' ? $phase : $fallback;
    } catch (\Throwable $error) {
        return $fallback;
    }
}

// ===========================================================================
// Argument parser.
// ===========================================================================

/**
 * @param array<int, string> $argv
 * @return array{help:bool, run:string, user:string, pass:string}
 */
function avesmapsWikiDumpReadParseArgs(array $argv): array
{
    $options = ['help' => false, 'run' => '', 'user' => '', 'pass' => ''];
    foreach (array_slice($argv, 1) as $token) {
        $token = (string) $token;
        if ($token === '--help' || $token === '-h') {
            $options['help'] = true;
        } elseif (str_starts_with($token, '--run=')) {
            $options['run'] = trim(substr($token, strlen('--run=')));
        } elseif (str_starts_with($token, '--user=')) {
            $options['user'] = trim(substr($token, strlen('--user=')));
        } elseif (str_starts_with($token, '--pass=')) {
            $options['pass'] = substr($token, strlen('--pass=')); // not trimmed: a leading/trailing space could be significant
        } else {
            fwrite(STDERR, "Unknown option: {$token} (use --help)\n");
            exit(2);
        }
    }

    return $options;
}
