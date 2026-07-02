<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the HYBRID record-sourcing adapter H5 adds
 * (api/_internal/wiki/dump-hybrid-compare.php) -- the library the §9
 * compare-test's `--hybrid` mode (scripts/wikidump-compare.php) uses to source
 * dump-side records from H4b's dryRun parse_and_upsert step instead of the
 * plain DB-free collectors.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (and deliberately does NOT)
 * ---------------------------------------------------------------------------
 * H5 reuses the 5b compare CORE (api/_internal/wiki/dump-compare.php) and the
 * 5b DB SELECTs VERBATIM -- unchanged, and already covered by
 * tools/wikidump/test-dump-compare.php (still 39/39 green, untouched by this
 * task). What is GENUINELY NEW in H5 is the record-SOURCING library
 * (dump-hybrid-compare.php), so this file targets exactly that:
 *
 *   (a) avesmapsWikiDumpGroupHybridRecordsByKind() -- the PURE adapter that
 *       groups H4b's flat {kind, title, override, record} list into the five
 *       per-entity-kind record lists the plain collectors would have produced.
 *       No DB, no dump -- synthetic records only. Also proves the adapter's
 *       output round-trips correctly through the UNCHANGED
 *       avesmapsWikiDumpIndexRecordsByKey() (the pure core) into identity-keyed
 *       maps -- i.e. exactly what scripts/wikidump-compare.php's hybrid branch
 *       hands to A1/A4, proving the wiring, not just the grouping in isolation.
 *   (b) avesmapsWikiDumpCompareResolveHybridRun() -- run resolution with a fake
 *       PDO: an explicit --run=<public_id> resolves via the reused
 *       avesmapsWikiSyncFetchRunByPublicId(); no --run auto-selects the LATEST
 *       run with sync_type=dump_read AND status=completed (the reason this
 *       function exists instead of reusing avesmapsWikiSyncFetchLatestCompletedRun()
 *       directly -- that one is NOT sync_type-filtered and would happily return
 *       a completed ONLINE crawl run); no matching run -> throws.
 *   (c) avesmapsWikiDumpHybridCollectAllRecords() -- the loop-to-completion
 *       wrapper around H4b's avesmapsWikiDumpHybridParseUpsertStep(dryRun=true):
 *       a fake PDO serves a batch of processable state rows, and the wrapper is
 *       proven to (i) aggregate the step's records, (ii) carry an OVERRIDDEN
 *       field through unmodified, and (iii) write NOTHING (dryRun=true is
 *       hardcoded inside the wrapper, never threaded from a flag). A second
 *       scenario drives avesmapsWikiDumpHybridParseUpsertStep() directly with a
 *       tiny budget to prove the underlying done/nextCursor contract genuinely
 *       composes across MULTIPLE steps (the mechanism the wrapper's do/while
 *       loop relies on).
 *
 * The H4b step function itself (dryRun/override wiring, per-kind dispatch) is
 * NOT re-tested here -- that is tools/wikidump/test-dump-hybrid-read.php's job
 * (unchanged, still exercised, not duplicated). This file tests ONLY the H5
 * adapter/orchestration layer built on top of it.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as every sibling
 * tools/wikidump test -- the reused derivation functions call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-compare-hybrid.php
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
// 1. Include chain: the SAME chain test-dump-hybrid-read.php uses (the H3
//    handlers + Pass B upserts + H4a/H4b the adapter builds on), plus the H5
//    adapter library under test and the pure compare core (for the round-trip
//    assertion in (a)). All side-effect-free on include -- unlike
//    scripts/wikidump-compare.php (a CLI entry point that runs top-level
//    orchestration on load), dump-hybrid-compare.php defines only functions,
//    so it is directly `require`-able here with no eval/subprocess trickery.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
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
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';
require_once $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';
require_once $repoRoot . '/api/_internal/wiki/dump-compare.php'; // pure core (round-trip assertion)

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-compare.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpGroupHybridRecordsByKind',
    'avesmapsWikiDumpCompareResolveHybridRun',
    'avesmapsWikiDumpHybridCollectAllRecords',
    'avesmapsWikiDumpSelectRedirectAliasMap',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-hybrid-compare.php.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors every sibling tools/wikidump test).
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

echo "================================================================\n";
echo " dump-hybrid-compare PURE-logic test (WikiDump migration, H5)\n";
echo "================================================================\n";

$check(
    '(0) include produced no output',
    '',
    $includeOutput,
    'the module is side-effect-free on include (function defs only, no DB connect) -- same PURITY CONTRACT every sibling H-task file uses'
);

// ===========================================================================
// (a) avesmapsWikiDumpGroupHybridRecordsByKind -- PURE, no DB, no dump.
// ===========================================================================
echo "\n-- (a) avesmapsWikiDumpGroupHybridRecordsByKind (pure adapter) --\n";

$check(
    '(a1) empty input -> all five kind buckets present and empty',
    [
        AVESMAPS_WIKI_DUMP_ENTITY_PATH => [],
        AVESMAPS_WIKI_DUMP_ENTITY_REGION => [],
        AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT => [],
        AVESMAPS_WIKI_DUMP_ENTITY_BUILDING => [],
        AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY => [],
    ],
    avesmapsWikiDumpGroupHybridRecordsByKind([]),
    'a run with no kept records still yields the full bucket shape (so the CLI never touches an undefined index)'
);

$syntheticRecords = [
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT, 'title' => 'Ferdok', 'override' => ['class' => 'metropole'], 'record' => ['title' => 'Ferdok', 'settlement_class' => 'metropole']],
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_BUILDING, 'title' => 'Burg Wallenstein', 'override' => [], 'record' => ['title' => 'Burg Wallenstein', 'building_type' => 'Burg']],
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY, 'title' => 'Kosch', 'override' => [], 'record' => ['wiki_key' => 'wiki:kosch', 'name' => 'Kosch']],
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_PATH, 'title' => 'Breite', 'override' => [], 'record' => ['wiki_key' => 'breite', 'name' => 'Breite']],
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_REGION, 'title' => 'Koschtal', 'override' => [], 'record' => ['wiki_key' => 'koschtal', 'name' => 'Koschtal']],
    // A second settlement -> proves multiple records of the SAME kind accumulate.
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT, 'title' => 'Kuslik', 'override' => [], 'record' => ['title' => 'Kuslik', 'settlement_class' => 'grossstadt']],
    // Defensive cases: unrecognised kind + non-array record -- both dropped.
    ['kind' => 'unknown_kind', 'title' => 'Ghost', 'override' => [], 'record' => ['title' => 'Ghost']],
    ['kind' => AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT, 'title' => 'Broken', 'override' => [], 'record' => null],
];
$grouped = avesmapsWikiDumpGroupHybridRecordsByKind($syntheticRecords);

$check(
    '(a2) settlements bucket holds both settlement records (accumulates across entries)',
    ['Ferdok', 'Kuslik'],
    array_column($grouped[AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT], 'title'),
    'two settlement entries in the flat list -> two records in the settlements bucket, in encounter order'
);
$check(
    '(a3) each bucket holds ONLY the record payload, not the {kind,title,override,record} wrapper',
    ['title' => 'Ferdok', 'settlement_class' => 'metropole'],
    $grouped[AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT][0] ?? null,
    'the adapter unwraps to the record shape avesmapsWikiDumpCollectSettlementRecords() would have returned'
);
$check(
    '(a4) building bucket gets exactly its one record',
    1,
    count($grouped[AVESMAPS_WIKI_DUMP_ENTITY_BUILDING]),
    'kind dispatch is exact -- a building never leaks into another bucket'
);
$check(
    '(a5) territory bucket gets exactly its one record',
    'wiki:kosch',
    $grouped[AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY][0]['wiki_key'] ?? null,
    'territory records keep their wiki_key field intact (identity key A1 will index on)'
);
$check(
    '(a6) path + region buckets get exactly their one record each',
    ['breite', 'koschtal'],
    [
        $grouped[AVESMAPS_WIKI_DUMP_ENTITY_PATH][0]['wiki_key'] ?? null,
        $grouped[AVESMAPS_WIKI_DUMP_ENTITY_REGION][0]['wiki_key'] ?? null,
    ],
    'all five kinds route correctly, not just the three exercised above'
);
$check(
    '(a7) total kept records across all buckets = 6 (8 input entries - 1 unknown-kind - 1 null-record)',
    6,
    array_sum(array_map('count', $grouped)),
    'exactly the two defensive-drop cases are excluded; every other entry is kept'
);
$check(
    '(a8) the unknown-kind entry ("Ghost") never appears in any bucket',
    false,
    in_array(
        'Ghost',
        array_merge(...array_values(array_map(static fn(array $bucket): array => array_column($bucket, 'title'), $grouped))),
        true
    ),
    'confirms (a7) by title, not just by count -- the unrecognised kind is silently and completely dropped'
);

// Round-trip: the adapter's per-kind output feeds the UNCHANGED
// avesmapsWikiDumpIndexRecordsByKey() (the pure compare core) exactly as
// the CLI's hybrid branch does -- proving the WIRING, not just the grouping
// in isolation.
$settlementIndexed = avesmapsWikiDumpIndexRecordsByKey($grouped[AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT], 'title');
$territoryIndexed = avesmapsWikiDumpIndexRecordsByKey($grouped[AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY], 'wiki_key');
$check(
    '(a9) round-trip through avesmapsWikiDumpIndexRecordsByKey: settlements index by title',
    ['Ferdok', 'Kuslik'],
    array_keys($settlementIndexed['map']),
    'exactly what the CLI hands to avesmapsWikiDumpCompareKeyCoverage() as $settlementDump[\'map\']'
);
$check(
    '(a10) round-trip: territories index by wiki_key (not title)',
    ['wiki:kosch'],
    array_keys($territoryIndexed['map']),
    'territories use wiki_key as the identity key -- IDENTICAL to plain mode (the KEY ALIGNMENT table)'
);
$check(
    '(a11) round-trip: the overridden settlement_class survives grouping + indexing intact',
    'metropole',
    $settlementIndexed['map']['Ferdok']['settlement_class'] ?? null,
    'the whole point of the hybrid pipeline -- the online-category override reaches A4 field-diffing unmodified'
);

// ===========================================================================
// (b) avesmapsWikiDumpCompareResolveHybridRun -- run resolution (fake PDO).
// ===========================================================================
echo "\n-- (b) avesmapsWikiDumpCompareResolveHybridRun (run resolution) --\n";

/**
 * Minimal fake PDO/PDOStatement recognising ONLY the SQL shapes
 * avesmapsWikiDumpCompareResolveHybridRun() (via avesmapsWikiSyncFetchRunByPublicId)
 * and avesmapsWikiDumpHybridCollectAllRecords() (via
 * avesmapsWikiDumpHybridParseUpsertStep -> avesmapsWikiDumpHybridFetchProcessableRows
 * + avesmapsWikiDumpHybridEnsureStateTable's DDL) issue. A wiring guard: if the
 * real SQL shape ever changes, a test relying on this fake fails loudly instead
 * of silently passing on a stale assumption. Mirrors tools/wikidump/
 * test-dump-hybrid-read.php's own FakeHybridPdo/FakeHybridStmt pattern.
 */
final class FakeH5Stmt extends PDOStatement
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
        $this->bound[ltrim((string) $param, ':')] = $value;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $effective = $params !== null ? $params : $this->bound;
        $this->bound = array_merge($this->bound, is_array($effective) ? $effective : []);
        $this->log->executions[] = ['sql' => $this->sql, 'params' => $this->bound];
        if (stripos($this->sql, 'SET wikitext') !== false) {
            $this->log->wikitextWrites[] = $this->bound;
        }
        if (stripos($this->sql, 'SET processed_at') !== false) {
            $this->log->processedWrites[] = $this->bound;
        }
        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, ...$args)
    {
        return $this->cannedRows[0] ?? false;
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        return $this->cannedRows;
    }
}

final class FakeH5Pdo extends PDO
{
    /** @var list<array<string,mixed>> */
    public array $executions = [];
    /** @var list<array<string,mixed>> */
    public array $wikitextWrites = [];
    /** @var list<array<string,mixed>> */
    public array $processedWrites = [];
    /** @var list<string> */
    public array $execs = [];

    /** @var array<string,mixed>|null a single row to serve for a public_id lookup */
    public ?array $publicIdRow = null;
    /** @var array<string,mixed>|null a single row to serve for the latest-completed-run lookup */
    public ?array $latestCompletedRow = null;
    /** @var list<array<string,mixed>> rows to serve for the parse_and_upsert processable-rows SELECT */
    public array $processableRows = [];

    public function __construct()
    {
        // Do NOT call parent::__construct -- no real DSN.
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
        // DDL probes (avesmapsWikiDumpHybridEnsureStateTable / avesmapsWikiSettlementEnsureSchema)
        // issue exec()/query() calls this fake just needs to no-op safely.
        $this->execs[] = (string) $query;
        return new FakeH5Stmt((string) $query, $this, []);
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        $sql = (string) $query;

        if (stripos($sql, 'WHERE public_id') !== false) {
            $rows = $this->publicIdRow !== null ? [$this->publicIdRow] : [];
            return new FakeH5Stmt($sql, $this, $rows);
        }

        if (stripos($sql, 'sync_type = :sync_type') !== false) {
            $rows = $this->latestCompletedRow !== null ? [$this->latestCompletedRow] : [];
            return new FakeH5Stmt($sql, $this, $rows);
        }

        if (stripos($sql, 'FROM wiki_dump_hybrid_state') !== false && stripos($sql, 'SELECT') !== false) {
            return new FakeH5Stmt($sql, $this, $this->processableRows);
        }

        // Any other prepared statement (e.g. the wikitext/processed UPDATEs) is
        // recorded via execute()'s own SQL-sniffing; return a generic stmt.
        return new FakeH5Stmt($sql, $this, []);
    }
}

// (b1) explicit --run=<public_id> resolves via avesmapsWikiSyncFetchRunByPublicId.
$pdoRunLookup = new FakeH5Pdo();
$pdoRunLookup->publicIdRow = [
    'id' => 7,
    'public_id' => '11111111-1111-4111-8111-111111111111',
    'sync_type' => 'dump_read',
    'status' => 'completed',
    'phase' => 'completed',
];
$resolvedByRun = avesmapsWikiDumpCompareResolveHybridRun($pdoRunLookup, '11111111-1111-4111-8111-111111111111');
$check(
    '(b1) explicit --run=<public_id> resolves that exact run',
    7,
    (int) ($resolvedByRun['id'] ?? 0),
    'reuses the SAME avesmapsWikiSyncFetchRunByPublicId() the rest of the codebase uses to locate a run -- no bespoke lookup'
);

// (b2) no --run -> auto-select via sync_type=dump_read AND status=completed.
$pdoAuto = new FakeH5Pdo();
$pdoAuto->latestCompletedRow = [
    'id' => 9,
    'public_id' => '22222222-2222-4222-8222-222222222222',
    'sync_type' => 'dump_read',
    'status' => 'completed',
    'phase' => 'completed',
];
$resolvedAuto = avesmapsWikiDumpCompareResolveHybridRun($pdoAuto, '');
$check(
    '(b2) omitting --run auto-selects the latest completed dump_read run',
    9,
    (int) ($resolvedAuto['id'] ?? 0),
    'the SQL binds sync_type=dump_read explicitly -- an online-crawl run of a DIFFERENT sync_type is never picked up here'
);
$check(
    '(b3) the auto-select SQL explicitly filters sync_type=dump_read (not just any completed run)',
    true,
    (static function () use ($pdoAuto): bool {
        foreach ($pdoAuto->executions as $exec) {
            if (stripos((string) $exec['sql'], 'sync_type = :sync_type') !== false
                && ($exec['params']['sync_type'] ?? null) === AVESMAPS_WIKI_DUMP_SYNC_TYPE) {
                return true;
            }
        }
        return false;
    })(),
    'proves this differs from avesmapsWikiSyncFetchLatestCompletedRun() (sync.php), which is NOT sync_type-filtered'
);

// (b4) no matching run -> throws (never silently proceeds with an empty run).
$pdoNone = new FakeH5Pdo();
$threw = false;
try {
    avesmapsWikiDumpCompareResolveHybridRun($pdoNone, '');
} catch (\RuntimeException $e) {
    $threw = true;
}
$check(
    '(b4) no completed dump_read run and no explicit --run -> throws RuntimeException',
    true,
    $threw,
    'a missing run must fail loudly (an uncaught CLI exception), never silently compare against nothing'
);

// ===========================================================================
// (c) avesmapsWikiDumpHybridCollectAllRecords -- aggregation + zero writes.
// ===========================================================================
echo "\n-- (c) avesmapsWikiDumpHybridCollectAllRecords (aggregate + zero writes) --\n";

/** Read the real fixture pages into a title => page map (reused across (c1)/(c2)). */
$fixturePages = [];
$reader = avesmapsWikiDumpOpenReader($fixturePath);
try {
    foreach (avesmapsWikiDumpIteratePages($reader) as $p) {
        $fixturePages[(string) $p['title']] = $p;
    }
} finally {
    $reader->close();
}

// (c1) single-batch scenario: the common real-world shape -- one processable
// batch smaller than AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET, so
// avesmapsWikiDumpHybridParseUpsertStep() reports done=true on its FIRST call
// and the wrapper's do/while loop runs exactly once.
$pdoLoop = new FakeH5Pdo();
$pdoLoop->processableRows = [
    [
        'id' => 11,
        'normalized_title' => 'Ferdok',
        'wikitext' => (string) ($fixturePages['Ferdok']['wikitext'] ?? ''),
        'override_class' => 'metropole',
        'override_building_type' => null,
        'override_continent' => 'Aventurien',
    ],
    [
        'id' => 12,
        'normalized_title' => 'Burg Wallenstein',
        'wikitext' => (string) ($fixturePages['Burg Wallenstein']['wikitext'] ?? ''),
        'override_class' => null,
        'override_building_type' => 'Tempel',
        'override_continent' => 'Aventurien',
    ],
];
$collected = avesmapsWikiDumpHybridCollectAllRecords($pdoLoop, 42, null);

$check(
    '(c1) collects both kept records from the single processable batch',
    2,
    count($collected),
    'both the settlement and the building row parse to a kept record'
);
$titlesCollected = array_column($collected, 'title');
sort($titlesCollected);
$check(
    '(c1b) both titles are present in the aggregated output',
    ['Burg Wallenstein', 'Ferdok'],
    $titlesCollected,
    'aggregation preserves every kept record from the step'
);
$check(
    '(c1c) the settlement record carries the OVERRIDDEN class (proves override propagates through the loop wrapper too)',
    'metropole',
    (static function () use ($collected): ?string {
        foreach ($collected as $rec) {
            if (($rec['title'] ?? null) === 'Ferdok') {
                return (string) ($rec['record']['settlement_class'] ?? null);
            }
        }
        return null;
    })(),
    'the loop wrapper does not touch record contents -- it only aggregates what avesmapsWikiDumpHybridParseUpsertStep(dryRun=true) returns'
);
$check(
    '(c1d) ZERO writes across the whole loop (dryRun=true is hardcoded in the wrapper)',
    ['wikitextWrites' => 0, 'processedWrites' => 0],
    ['wikitextWrites' => count($pdoLoop->wikitextWrites), 'processedWrites' => count($pdoLoop->processedWrites)],
    'no UPDATE...wikitext and no UPDATE...processed_at fired -- the wrapper can never become the sharp writer'
);

// (c2) MULTI-STEP composition: avesmapsWikiDumpHybridCollectAllRecords() does not
// expose a $budget parameter (by design -- the CLI always wants the real
// default), so this scenario drives avesmapsWikiDumpHybridParseUpsertStep()
// directly with budget=1 in the SAME do/while shape the wrapper uses, proving
// the underlying done/nextCursor contract genuinely composes across MULTIPLE
// steps -- the exact mechanism the wrapper's loop relies on to eventually drain
// a real (much larger) processable set without the wrapper needing to know
// anything about pagination itself. done = (processedThisStep < budget), so a
// FULL batch (processedThisStep === budget) never self-reports done -- it takes
// one further, EMPTY step to confirm exhaustion. With budget=1 and 2 rows, that
// is 3 steps: [row 21] done=false, [row 22] done=false, [] done=true.
$pdoMultiStep = new FakeH5Pdo();
$allRowsForBudgetTest = [
    ['id' => 21, 'normalized_title' => 'Ferdok', 'wikitext' => (string) ($fixturePages['Ferdok']['wikitext'] ?? ''), 'override_class' => null, 'override_building_type' => null, 'override_continent' => 'Aventurien'],
    ['id' => 22, 'normalized_title' => 'Burg Wallenstein', 'wikitext' => (string) ($fixturePages['Burg Wallenstein']['wikitext'] ?? ''), 'override_class' => null, 'override_building_type' => null, 'override_continent' => 'Aventurien'],
];
// A cursor-aware fetcher honouring id > cursor, mirroring the real accessor's
// WHERE clause -- so budget=1 genuinely forces two steps instead of the fake
// just replaying the same full list twice.
$cursorAwareFetcher = static function (PDO $pdo, int $runId, int $cursor, int $budget) use ($allRowsForBudgetTest): array {
    $remaining = array_values(array_filter($allRowsForBudgetTest, static fn(array $r): bool => (int) $r['id'] > $cursor));
    return array_slice($remaining, 0, $budget);
};
$multiStepAll = [];
$multiCursor = 0;
$multiSteps = 0;
do {
    $stepResult = avesmapsWikiDumpHybridParseUpsertStep($pdoMultiStep, 42, $multiCursor, true, 1, $cursorAwareFetcher);
    foreach ((array) ($stepResult['records'] ?? []) as $rec) {
        $multiStepAll[] = $rec;
    }
    $multiCursor = (int) ($stepResult['nextCursor'] ?? $multiCursor);
    $multiSteps++;
} while (empty($stepResult['done']) && $multiSteps < 10);

$check(
    '(c2) budget=1 forces exactly 3 steps for 2 processable rows (a full batch needs one more empty step to confirm done)',
    3,
    $multiSteps,
    'proves the done/nextCursor contract genuinely iterates -- not a single call that happens to return everything'
);
$check(
    '(c2b) records aggregate across the two content-bearing steps (2 total; the 3rd step is the empty confirmation step)',
    2,
    count($multiStepAll),
    'the SAME accumulation pattern avesmapsWikiDumpHybridCollectAllRecords() uses (append every step\'s records)'
);
$check(
    '(c2c) zero writes across the multi-step composition too',
    ['wikitextWrites' => 0, 'processedWrites' => 0],
    ['wikitextWrites' => count($pdoMultiStep->wikitextWrites), 'processedWrites' => count($pdoMultiStep->processedWrites)],
    'dryRun=true holds across every step of the pagination, not just the first'
);

// ===========================================================================
// Summary.
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
