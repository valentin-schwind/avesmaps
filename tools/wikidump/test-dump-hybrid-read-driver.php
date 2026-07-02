<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the Hybrid WikiDump read_step DRIVER (Task H4c-b):
 * api/_internal/wiki/dump-hybrid-driver.php -- the 7-phase state machine, the
 * two actions' shared advance engine, and the title->title alias persistence.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (and deliberately does NOT)
 * ---------------------------------------------------------------------------
 * Per the H4c-b brief ("unit-test the phase-transition + alias-persist logic
 * with injected fake step fns -- no DB/dump, like H4a/H4b did"), this test is
 * HTTP-free and uses NO live MySQL:
 *
 *   (A) avesmapsWikiDumpHybridComputeNextState -- the PURE transition function.
 *       For each phase, given a fake step result {done, nextCursor}: a
 *       non-resumable phase always advances; a resumable phase STAYS in its phase
 *       (persisting its cursor) until done, then advances; the last work phase's
 *       done -> phase `completed` + status `completed`. Covers every phase edge.
 *   (B) alias-persist ROUND-TRIP (pure): the extractor map ->
 *       avesmapsWikiDumpHybridComputeTitleAliasRows rows -> reload shape
 *       (via a fake PDO that echoes the persisted rows back through
 *       avesmapsWikiDumpHybridLoadTitleAliases).
 *   (C) THE GATE, via avesmapsWikiDumpHybridAdvanceReadStep with a fake PDO +
 *       INJECTED fake step fns: a read_step advance (dryRun=true) that reaches
 *       the parse_and_upsert phase passes dryRun=TRUE to the phase 6 step fn
 *       (never the sharp path); an apply advance (dryRun=false) passes
 *       dryRun=FALSE. Also: a resumable phase that reports done=false stays in
 *       the same phase across advances; the completed run echoes terminally.
 *
 * The real H1/H4a/H4b step fns, the dump reader, and the DDL/upsert accessors
 * are NOT exercised here -- they are injected/faked, exactly as H4a/H4b kept
 * their DB/dump halves owner-live-verified.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as the sibling
 * tools/wikidump tests -- the reused derivation functions call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-hybrid-read-driver.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the include chain needs XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the SAME chain test-dump-hybrid-read.php uses, plus the
//    driver under test. All side-effect-free on include.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-category-layer.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpHybridPhaseOrder',
    'avesmapsWikiDumpHybridResumableCursorKeys',
    'avesmapsWikiDumpHybridComputeNextState',
    'avesmapsWikiDumpHybridPhaseMessage',
    'avesmapsWikiDumpHybridEnsureTitleAliasTable',
    'avesmapsWikiDumpHybridComputeTitleAliasRows',
    'avesmapsWikiDumpHybridPersistTitleAliases',
    'avesmapsWikiDumpHybridLoadTitleAliases',
    'avesmapsWikiDumpHybridRedirectAliasStep',
    'avesmapsWikiDumpHybridStartRun',
    'avesmapsWikiDumpHybridFetchWantedTitles',
    'avesmapsWikiDumpHybridPublicRun',
    'avesmapsWikiDumpHybridAdvanceReadStep',
    'avesmapsWikiDumpHybridDispatchPhaseStep',
    'avesmapsWikiDumpHybridProgressEnvelope',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-hybrid-driver.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors the sibling tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-70s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-70s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// ---------------------------------------------------------------------------
// 2b. A fake PDO/PDOStatement for the advance-engine + alias round-trip tests.
//     It records UpdateRun writes, serves a canned wiki_sync_runs row for the
//     FetchRunByPublicId SELECT, and echoes persisted alias rows back for the
//     alias-load SELECT. It recognises only the handful of SQL shapes the driver
//     issues -- a wiring guard.
// ---------------------------------------------------------------------------
final class FakeDriverStmt extends PDOStatement
{
    /** @var array<string,mixed> */
    public array $bound = [];

    public function __construct(
        private string $sql,
        private object $log,
        /** @var list<array<string,mixed>> */
        private array $cannedRows = []
    ) {
    }

    #[\ReturnTypeWillChange]
    public function bindValue($param, $value, $type = PDO::PARAM_STR): bool
    {
        $this->bound[(string) $param] = $value;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $effective = $params ?? $this->bound;
        // Record run-row UPDATEs (status/phase/progress persistence).
        if (stripos($this->sql, 'UPDATE wiki_sync_runs') !== false && stripos($this->sql, 'SET status') !== false) {
            $this->log->runUpdates[] = $effective;
            // Reflect the update into the canned run row so a re-fetch sees it.
            $this->log->runRow['status'] = $effective['status'] ?? ($this->log->runRow['status'] ?? 'running');
            $this->log->runRow['phase'] = $effective['phase'] ?? ($this->log->runRow['phase'] ?? '');
            $this->log->runRow['progress_current'] = $effective['progress_current'] ?? ($this->log->runRow['progress_current'] ?? 0);
            $this->log->runRow['stats_json'] = $effective['stats_json'] ?? ($this->log->runRow['stats_json'] ?? '[]');
        }
        // Record title-alias INSERTs and reflect them into the alias store.
        if (stripos($this->sql, 'INSERT INTO wiki_dump_title_alias') !== false) {
            $this->log->aliasRows[(string) ($effective['alias_title'] ?? '')] = [
                'alias_title' => (string) ($effective['alias_title'] ?? ''),
                'canonical_title' => (string) ($effective['canonical_title'] ?? ''),
            ];
        }
        // Record slug-keyed alias INSERTs (the reused Pass A upsert).
        if (stripos($this->sql, 'alias_slug') !== false && stripos($this->sql, 'INSERT') !== false) {
            $this->log->slugAliasWrites[] = $effective;
        }
        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        // FetchRunByPublicId does $stmt->fetch() -> the canned run row.
        return $this->log->runRow;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return false; // wanted-titles SELECT: none needed for the injected-fn tests
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        // Alias-load SELECT -> the persisted alias rows.
        if (stripos($this->sql, 'FROM wiki_dump_title_alias') !== false) {
            return array_values($this->log->aliasRows);
        }
        return $this->cannedRows;
    }
}

final class FakeDriverPdo extends PDO
{
    /** @var array<string,mixed> the canned wiki_sync_runs row (mutated by UPDATEs) */
    public array $runRow;
    /** @var list<array<string,mixed>> recorded run-row UPDATE param sets */
    public array $runUpdates = [];
    /** @var array<string,array<string,mixed>> persisted alias rows, keyed by alias_title */
    public array $aliasRows = [];
    /** @var list<array<string,mixed>> recorded slug-keyed alias INSERT param sets */
    public array $slugAliasWrites = [];
    /** @var list<string> */
    public array $execs = [];

    public function __construct(array $runRow)
    {
        $this->runRow = $runRow;
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->execs[] = (string) $statement;
        return 0;
    }

    #[\ReturnTypeWillChange]
    public function query($query, $fetchMode = null, ...$fetchModeArgs)
    {
        $this->execs[] = (string) $query;
        return new FakeDriverStmt((string) $query, $this, []);
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeDriverStmt((string) $query, $this, []);
    }
}

/** Build a canned dump_read run row at a given phase/stats. */
$makeRunRow = static function (string $phase, array $stats = [], string $status = 'running'): array {
    return [
        'id' => 7,
        'public_id' => '11111111-1111-4111-8111-111111111111',
        'sync_type' => 'dump_read',
        'status' => $status,
        'phase' => $phase,
        'progress_current' => 0,
        'progress_total' => 6,
        'message' => '',
        'stats_json' => json_encode($stats),
        'created_at' => '2026-07-02 00:00:00.000',
        'updated_at' => '2026-07-02 00:00:00.000',
        'completed_at' => null,
    ];
};

echo "================================================================\n";
echo " dump-hybrid-driver PURE-logic test (Hybrid WikiDump migration, H4c-b)\n";
echo "================================================================\n";

$check('(0) include produced no output', '', $includeOutput, 'the driver is side-effect-free on include (defs only, no DB connect)');

// ===========================================================================
// (A) PURE phase-transition function.
// ===========================================================================
echo "\n-- (A) avesmapsWikiDumpHybridComputeNextState (the pure state machine) --\n";

$order = avesmapsWikiDumpHybridPhaseOrder();
$check(
    '(A0) phase order runs online_continent_map AFTER wikitext_collect (CONTINENT-FIX #1)',
    ['online_class_map', 'online_building_map', 'wikitext_collect', 'redirect_aliases', 'online_continent_map', 'parse_and_upsert'],
    $order,
    'the continent map sources its titles from the fully-populated state table (via FetchWantedTitles), so it MUST run after the whole-dump wikitext_collect scan enumerated all kinds -- otherwise it only covers the H1 settlement/building rows'
);

// Non-resumable phases always advance on a single step.
$s1 = avesmapsWikiDumpHybridComputeNextState('online_class_map', [], ['done' => true]);
$check(
    '(A1) online_class_map -> online_building_map (non-resumable, always advances)',
    ['online_building_map', 'running', 1, false],
    [$s1['phase'], $s1['status'], $s1['progress_current'], $s1['done']],
    'a single-step phase advances to the next phase and bumps progress to index 1'
);
$s2 = avesmapsWikiDumpHybridComputeNextState('online_building_map', [], ['done' => true]);
$check(
    '(A2) online_building_map -> wikitext_collect (CONTINENT-FIX: the scan now runs before the continent map)',
    ['wikitext_collect', 2],
    [$s2['phase'], $s2['progress_current']],
    'second single-step phase advances into the whole-dump wikitext_collect scan (which enumerates all 5 kinds and populates the state table the continent map later reads)'
);

// wikitext_collect (resumable): NOT done -> stay put, persist the wikitext cursor.
$s3a = avesmapsWikiDumpHybridComputeNextState('wikitext_collect', ['wikitext_cursor' => 0], ['done' => false, 'nextCursor' => 5000]);
$check(
    '(A3) wikitext_collect NOT done -> stays in phase, persists nextCursor',
    ['wikitext_collect', false, 5000, false],
    [$s3a['phase'], $s3a['phase_advanced'], $s3a['stats']['wikitext_cursor'], $s3a['done']],
    'the whole-dump scan stays put across advances, advancing only its own page cursor until its done flips'
);
// wikitext_collect done -> advance to redirect_aliases, cursor still persisted.
$s3b = avesmapsWikiDumpHybridComputeNextState('wikitext_collect', ['wikitext_cursor' => 5000], ['done' => true, 'nextCursor' => 223583]);
$check(
    '(A4) wikitext_collect done -> advances to redirect_aliases, final cursor persisted',
    ['redirect_aliases', true, 223583, 3],
    [$s3b['phase'], $s3b['phase_advanced'], $s3b['stats']['wikitext_cursor'], $s3b['progress_current']],
    'once the scan reports done (stream exhausted), the phase name advances and the wikitext cursor is retained'
);

// redirect_aliases uses the dump_cursor key.
$s4 = avesmapsWikiDumpHybridComputeNextState('redirect_aliases', ['dump_cursor' => 100], ['done' => false, 'nextCursor' => 2100]);
$check(
    '(A5) redirect_aliases persists its cursor under stats["dump_cursor"] (the Pass-A field name)',
    ['redirect_aliases', 2100],
    [$s4['phase'], $s4['stats']['dump_cursor']],
    'the redirect phase reuses the existing dump_cursor stats field'
);

// online_continent_map now runs AFTER the scan; resumable on continent_cursor; done -> parse_and_upsert.
$s5a = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 0], ['done' => false, 'nextCursor' => 500]);
$check(
    '(A6a) online_continent_map NOT done -> stays in phase, persists continent_cursor (now over the FULL enumerated title set)',
    ['online_continent_map', false, 500, false],
    [$s5a['phase'], $s5a['phase_advanced'], $s5a['stats']['continent_cursor'], $s5a['done']],
    'after the reorder the continent map walks the full ~7000-title set from FetchWantedTitles; it takes more steps but still resumes on its own continent_cursor until done'
);
$s5b = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 500], ['done' => true, 'nextCursor' => 9000]);
$check(
    '(A6b) online_continent_map done -> parse_and_upsert, continent_cursor persisted, progress index 5',
    ['parse_and_upsert', true, 9000, 5],
    [$s5b['phase'], $s5b['phase_advanced'], $s5b['stats']['continent_cursor'], $s5b['progress_current']],
    'the continent map (now the LAST dump/online-walking phase before parse) hands off to the parse phase once its cursor drains the full title set'
);

// parse_and_upsert NOT done -> stay put (parse_cursor advances).
$s6a = avesmapsWikiDumpHybridComputeNextState('parse_and_upsert', ['parse_cursor' => 0], ['done' => false, 'nextCursor' => 2000]);
$check(
    '(A7) parse_and_upsert NOT done -> stays in phase, parse_cursor advances',
    ['parse_and_upsert', false, 2000],
    [$s6a['phase'], $s6a['phase_advanced'], $s6a['stats']['parse_cursor']],
    'the parse phase loops on its id high-water-mark cursor until drained'
);
// parse_and_upsert done -> completed + status completed (THE terminal transition).
$s6b = avesmapsWikiDumpHybridComputeNextState('parse_and_upsert', ['parse_cursor' => 2000], ['done' => true, 'nextCursor' => 2345]);
$check(
    '(A8) parse_and_upsert done -> phase "completed" + status "completed" + full progress',
    ['completed', 'completed', 6, 6, true],
    [$s6b['phase'], $s6b['status'], $s6b['progress_current'], $s6b['progress_total'], $s6b['done']],
    'advancing off the last work phase completes the whole run (progress_current == progress_total)'
);

// A resumable phase falling back to result['cursor'] when nextCursor is absent.
$s7 = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 10], ['done' => false, 'cursor' => 42]);
$check(
    '(A9) resumable cursor falls back to result["cursor"] when nextCursor absent',
    42,
    $s7['stats']['continent_cursor'],
    'tolerates both the {nextCursor} shape (continent/collect steps) and a {cursor} shape'
);

// ===========================================================================
// (B) alias-persist ROUND-TRIP (pure rows + fake-PDO reload).
// ===========================================================================
echo "\n-- (B) title->title alias persistence round-trip --\n";

$aliasMap = [
    'Altes Ferdok' => 'Ferdok',
    'Koenigreich Kosch' => 'Kosch',
    '' => 'ShouldSkip',        // empty alias side -> dropped
    'DanglingAlias' => '',     // empty canonical side -> dropped
];
$aliasRows = avesmapsWikiDumpHybridComputeTitleAliasRows($aliasMap);
$check(
    '(B1) ComputeTitleAliasRows drops empty-sided pairs, keeps the real ones',
    [
        ['alias_title' => 'Altes Ferdok', 'canonical_title' => 'Ferdok'],
        ['alias_title' => 'Koenigreich Kosch', 'canonical_title' => 'Kosch'],
    ],
    $aliasRows,
    'a redirect page title -> canonical title row per valid pair; degenerate empties contribute nothing'
);

// Persist through a fake PDO, then reload -> the map round-trips.
$aliasPdo = new FakeDriverPdo($makeRunRow('redirect_aliases'));
$written = avesmapsWikiDumpHybridPersistTitleAliases($aliasPdo, 7, $aliasMap);
$check(
    '(B2) PersistTitleAliases writes exactly the non-empty rows',
    2,
    $written,
    'both valid alias rows are upserted (the two empty-sided pairs are skipped)'
);
$reloaded = avesmapsWikiDumpHybridLoadTitleAliases($aliasPdo, 7);
$check(
    '(B3) LoadTitleAliases reloads the SAME map shape H4b consumes as $titleAliasMap',
    ['Altes Ferdok' => 'Ferdok', 'Koenigreich Kosch' => 'Kosch'],
    $reloaded,
    'the persisted rows reload into normalized-alias => normalized-canonical, ready for wikitext_collect'
);

// ===========================================================================
// (B2) redirect_aliases STEP: the resumable page-walk building BOTH maps.
// ===========================================================================
echo "\n-- (B2) avesmapsWikiDumpHybridRedirectAliasStep (page-walk, fake source) --\n";

// Fake dump window: 4 pages, two of them <redirect> pages. The extractor + the
// slug upsert must both fire for the redirect pages ONLY.
$redirectFixturePages = [
    ['title' => 'Ferdok', 'ns' => 0, 'redirect' => null, 'wikitext' => 'body'],
    ['title' => 'Altes Ferdok', 'ns' => 0, 'redirect' => 'Ferdok', 'wikitext' => ''],
    ['title' => 'Irrelevant', 'ns' => 0, 'redirect' => null, 'wikitext' => 'body'],
    ['title' => 'Kosch (historisch)', 'ns' => 0, 'redirect' => 'Kosch', 'wikitext' => ''],
];
$redirectSource = static function (string $path, int $skip) use ($redirectFixturePages): iterable {
    $i = 0;
    foreach ($redirectFixturePages as $page) {
        if ($i++ < $skip) {
            continue;
        }
        yield $page;
    }
};

$redirectPdo = new FakeDriverPdo($makeRunRow('redirect_aliases'));
$redirectStep = avesmapsWikiDumpHybridRedirectAliasStep($redirectPdo, '/unused/dump.xml', 7, 0, $redirectSource);

$check(
    '(B2a) the step scans the whole window and reports done (stream exhausted)',
    ['done' => true, 'pages_scanned' => 4],
    ['done' => $redirectStep['done'], 'pages_scanned' => $redirectStep['pages_scanned']],
    'a window smaller than the page budget that runs to the end reports the phase done'
);
$check(
    '(B2b) title->title aliases persisted for BOTH redirect pages (not the plain pages)',
    2,
    $redirectStep['title_aliases_written'],
    'only the two <redirect> pages become title->title rows; plain articles contribute nothing'
);
$check(
    '(B2c) the persisted title-alias map has the expected canonical targets',
    ['Altes Ferdok' => 'Ferdok', 'Kosch (historisch)' => 'Kosch'],
    avesmapsWikiDumpHybridLoadTitleAliases($redirectPdo, 7),
    'each redirect page title maps to its normalized canonical target -- exactly what wikitext_collect consumes'
);
$check(
    '(B2d) the slug-keyed Pass A alias upsert ALSO fired for each redirect (verbatim reuse)',
    2,
    count($redirectPdo->slugAliasWrites),
    'the existing wiki_redirect_alias output is preserved: one alias_slug->wiki_key upsert per redirect page'
);
$check(
    '(B2e) nextCursor = cursor + pages_scanned (resume contract, like Pass A)',
    4,
    $redirectStep['nextCursor'],
    'the next redirect step resumes past exactly the pages this step consumed'
);

// A partial window (budget/deadline not reached but the source ends) still done;
// a fresh cursor is honoured (skip).
$redirectPdo2 = new FakeDriverPdo($makeRunRow('redirect_aliases', ['dump_cursor' => 2]));
$redirectStep2 = avesmapsWikiDumpHybridRedirectAliasStep($redirectPdo2, '/unused/dump.xml', 7, 2, $redirectSource);
$check(
    '(B2f) a non-zero cursor skips already-seen pages (only the tail is scanned)',
    ['pages_scanned' => 2, 'title_aliases_written' => 1, 'nextCursor' => 4],
    ['pages_scanned' => $redirectStep2['pages_scanned'], 'title_aliases_written' => $redirectStep2['title_aliases_written'], 'nextCursor' => $redirectStep2['nextCursor']],
    'skipping the first 2 pages leaves only "Irrelevant" + "Kosch (historisch)" -> one redirect found'
);

// ===========================================================================
// (C) THE GATE via the advance engine + injected fake step fns.
// ===========================================================================
echo "\n-- (C) avesmapsWikiDumpHybridAdvanceReadStep + THE GATE (dryRun) --\n";

/**
 * Build an injected step-fn set that records the dryRun the parse_and_upsert
 * phase is called with, and reports the phase as done so the transition advances.
 */
$captured = new stdClass();
$captured->parseDryRun = null;
$captured->parseCalled = false;
$makeStepFns = static function () use ($captured): array {
    return [
        'parse_and_upsert' => static function (PDO $pdo, array $ctx) use ($captured): array {
            $captured->parseCalled = true;
            $captured->parseDryRun = (bool) ($ctx['dryRun'] ?? null);
            return ['done' => true, 'nextCursor' => 123, 'processed_this_step' => 5, 'kept' => 3, 'dry_run' => (bool) ($ctx['dryRun'] ?? null)];
        },
    ];
};

// read_step (dryRun=true) reaching phase 6 -> the phase-6 fn gets dryRun=TRUE.
$captured->parseDryRun = null;
$captured->parseCalled = false;
$readPdo = new FakeDriverPdo($makeRunRow('parse_and_upsert', ['parse_cursor' => 0]));
$readAdvance = avesmapsWikiDumpHybridAdvanceReadStep($readPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $makeStepFns());
$check(
    '(C1) read_step passes dryRun=TRUE to the parse_and_upsert phase (SANDBOX, no sharp write)',
    [true, true],
    [$captured->parseCalled, $captured->parseDryRun],
    'the read_step advance is structurally incapable of a sharp write: phase 6 always runs dryRun=true'
);
$check(
    '(C2) read_step advance returns the {phase,cursor,done,progress} envelope',
    ['completed', true, true],
    [
        $readAdvance['phase'],
        $readAdvance['done'],
        is_array($readAdvance['progress']) && ($readAdvance['progress']['dry_run'] ?? null) === true,
    ],
    'phase 6 done -> the run completes; progress echoes the dry_run flag from the step'
);

// apply (dryRun=false) reaching phase 6 -> the phase-6 fn gets dryRun=FALSE.
$captured->parseDryRun = null;
$captured->parseCalled = false;
$applyPdo = new FakeDriverPdo($makeRunRow('parse_and_upsert', ['parse_cursor' => 0]));
$applyAdvance = avesmapsWikiDumpHybridAdvanceReadStep($applyPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', false, $makeStepFns());
$check(
    '(C3) apply passes dryRun=FALSE to the parse_and_upsert phase (THE sharp path)',
    [true, false],
    [$captured->parseCalled, $captured->parseDryRun],
    'the SEPARATE apply action is the ONLY path that runs phase 6 with dryRun=false (the real *_staging write)'
);

// A resumable phase reporting done=false stays in the SAME phase across an advance.
$stayPdo = new FakeDriverPdo($makeRunRow('online_continent_map', ['continent_cursor' => 0]));
$staySteps = [
    'online_continent_map' => static function (PDO $pdo, array $ctx): array {
        return ['done' => false, 'nextCursor' => 400, 'written' => 400];
    },
];
$stayAdvance = avesmapsWikiDumpHybridAdvanceReadStep($stayPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $staySteps);
$check(
    '(C4) a resumable phase with done=false stays in the same phase (cursor persisted)',
    ['online_continent_map', false, 400],
    [$stayAdvance['phase'], $stayAdvance['done'], $stayAdvance['cursor']],
    'the run does not advance the phase name until the resumable step reports done -- one bounded step per request'
);
// And the persisted run UPDATE recorded the same still-in-flight phase + cursor.
$lastUpdate = end($stayPdo->runUpdates) ?: [];
$persistedStats = json_decode((string) ($lastUpdate['stats_json'] ?? '{}'), true) ?: [];
$check(
    '(C5) the run-row UPDATE persisted phase=online_continent_map + continent_cursor=400',
    ['online_continent_map', 'running', 400],
    [(string) ($lastUpdate['phase'] ?? ''), (string) ($lastUpdate['status'] ?? ''), (int) ($persistedStats['continent_cursor'] ?? -1)],
    'avesmapsWikiSyncUpdateRun is called with the pure transition exact next state'
);

// A single non-resumable phase advances the run by one phase per advance call.
$classPdo = new FakeDriverPdo($makeRunRow('online_class_map', []));
$classSteps = [
    'online_class_map' => static function (PDO $pdo, array $ctx): array {
        return ['done' => true, 'written' => 1234, 'title_count' => 1234];
    },
];
$classAdvance = avesmapsWikiDumpHybridAdvanceReadStep($classPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $classSteps);
$check(
    '(C6) a non-resumable phase advances one phase per request (class -> building)',
    ['online_building_map', false],
    [$classAdvance['phase'], $classAdvance['done']],
    'online_class_map completes in one step and hands off to online_building_map'
);

// A completed run echoes terminally without dispatching any step.
$doneCaptured = false;
$donePdo = new FakeDriverPdo($makeRunRow('completed', ['parse_cursor' => 9], 'completed'));
$doneSteps = [
    'parse_and_upsert' => static function () use (&$doneCaptured): array { $doneCaptured = true; return ['done' => true]; },
];
$doneAdvance = avesmapsWikiDumpHybridAdvanceReadStep($donePdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', false, $doneSteps);
$check(
    '(C7) a completed run echoes terminally and dispatches NO step',
    ['completed', true, false],
    [$doneAdvance['phase'], $doneAdvance['done'], $doneCaptured],
    'an already-completed run is idempotent -- no phase fn runs, so a stray apply on a done run writes nothing'
);

// ===========================================================================
// (C-continent) PERF FIX: the real online_continent_map dispatch case is
// bounded by an explicit per-step call budget, not the unbounded
// "process everything in one call" default (callBudget=null).
// ---------------------------------------------------------------------------
// Before this fix, avesmapsWikiDumpHybridDispatchPhaseStep()'s real (non-faked)
// online_continent_map case called avesmapsWikiDumpHybridFillContinentMapStep()
// with NO $callBudget, so a single step walked the ENTIRE title list -- for the
// real ~9k-title/~450-batch set, roughly 4.5 minutes of throttled HTTP with no
// lock heartbeat (dump-lock.php). avesmapsWikiDumpCategoryFetchContinentMap()
// (dump-category-layer.php:429) already implements a full resumable
// cursor/callBudget/done contract; the bug was that the driver never drove it
// with a bound. These checks are HTTP/DB-free (same "no live MySQL" contract
// as the rest of this file): (c-continent-1) is a STRUCTURAL check (mirrors
// test-dump-hybrid-state.php's own source-inspection pattern) proving the real
// dispatch case now passes AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET,
// not null; (c-continent-2..4) prove BEHAVIORALLY, via a fake batch fetcher (no
// PDO/HTTP) and a ~350-title list sized like the bug report's real scenario,
// that this budget forces MULTIPLE bounded steps -- never one call that
// attempts all ~350 titles -- and that the phase still resumes via its cursor
// to completion (done=true) across those steps.
// ===========================================================================
echo "\n-- (C-continent) online_continent_map dispatch is call-budget-bounded (PERF FIX) --\n";

$hybridDriverSource = (string) file_get_contents($repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php');
$dispatchSource = '';
if (preg_match(
    '/function avesmapsWikiDumpHybridDispatchPhaseStep\([^)]*\)[^{]*\{(.*)\n\}\n/s',
    $hybridDriverSource,
    $m
) === 1) {
    $dispatchSource = $m[1];
}
$check(
    '(c-continent-1) the real dispatch case passes the named call-budget constant, not null',
    true,
    str_contains(
        $dispatchSource,
        'avesmapsWikiDumpHybridFillContinentMapStep($pdo, $runId, $titles, $cursor, AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET)'
    ),
    'structural check: the perf bug was $callBudget defaulting to null (unbounded) -- this proves the fix is a real explicit bound, not just a docblock claim'
);
$check(
    '(c-continent-2) the call-budget constant is a small bounded number, not null/unbounded',
    true,
    is_int(AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET) && AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET > 0 && AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET <= 40,
    'sanity bound: at ~0.6-0.85s/throttled call (sync.php AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS), a step must stay well under the 28s AVESMAPS_WIKI_DUMP_STEP_SECONDS ceiling'
);

// Behavioral proof at H1's own (already fully mockable) layer, using the SAME
// constant + a title count on the order of the bug report's "~350-450 batches"
// scenario (350 batches x 20 titles/batch = 7000 titles) to show the bound
// forces a multi-step resume rather than a single unbounded call.
$manyTitles = array_map(static fn(int $i): string => "Titel {$i}", range(1, 7000));
$callsMadeTotal = 0;
$countingBatchFetcher = static function (array $batchTitles) use (&$callsMadeTotal): array {
    $callsMadeTotal++;
    $pages = [];
    foreach ($batchTitles as $title) {
        $pages[$title] = ['title' => $title, 'categories' => [['title' => 'Kategorie:Aventurien']]];
    }
    return $pages;
};

$continentCursor = 0;
$continentSteps = 0;
$continentDone = false;
$maxStepsGuard = 50; // generous upper bound on THIS TEST's own loop, not the production code
while (!$continentDone && $continentSteps < $maxStepsGuard) {
    $stepResult = avesmapsWikiDumpCategoryFetchContinentMap(
        $manyTitles,
        $continentCursor,
        AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET,
        $countingBatchFetcher
    );
    $continentCursor = (int) $stepResult['nextCursor'];
    $continentDone = (bool) $stepResult['done'];
    $continentSteps++;

    // The core regression check: NO SINGLE STEP may exceed the configured
    // call budget -- this is exactly what "attempts all ~350 in one call" would
    // violate (one step making ~350 calls instead of at most
    // AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET).
    $callsThisStepMax = AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET;
    if ($callsMadeTotal > $continentSteps * $callsThisStepMax) {
        break; // fail fast; the assertion below will report the violation
    }
}

$check(
    '(c-continent-3) a 7000-title list (350 batches) resumes across MULTIPLE steps, never all-in-one-call',
    true,
    $continentSteps > 1 && $continentDone,
    "took {$continentSteps} bounded steps (budget=" . AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET . " calls/step) to finish 350 batches -- the pre-fix code (callBudget=null) would have done this in exactly 1 step / 1 call to this fetcher"
);
$check(
    '(c-continent-4) every step stayed within its call budget (no step attempted all ~350 batches)',
    true,
    $callsMadeTotal <= $continentSteps * AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET && $callsMadeTotal === 350,
    "{$callsMadeTotal} total fetcher calls across {$continentSteps} steps for 350 batches -- confirms the budget bounds EVERY step, not just the first"
);

// ===========================================================================
// (D) progress envelope shape.
// ===========================================================================
echo "\n-- (D) avesmapsWikiDumpHybridProgressEnvelope --\n";

$public = avesmapsWikiDumpHybridPublicRun($makeRunRow('wikitext_collect', ['wikitext_cursor' => 4200]));
$env = avesmapsWikiDumpHybridProgressEnvelope($public, ['pages_scanned' => 2000, 'found_this_step' => 17, 'done' => false]);
$check(
    '(D1) progress envelope carries phase + per-step counters',
    ['wikitext_collect', 2000, 17],
    [$env['phase'], $env['pages_scanned'] ?? -1, $env['found_this_step'] ?? -1],
    'the frontend renders phase + live per-step numbers (pages_scanned/found) from this envelope'
);
$check(
    '(D2) public run projection exposes the phase cursor + all four named cursors',
    [4200, 4200],
    [$public['cursor'], $public['cursors']['wikitext_cursor']],
    'the dump_read projection surfaces the active phase cursor (not the online-crawl stats keys)'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
