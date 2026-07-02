<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the Hybrid WikiDump dump-compute layer (Task H4b):
 * api/_internal/wiki/dump-hybrid-read.php -- the two resumable steps
 * wikitext_collect + parse_and_upsert.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (and deliberately does NOT)
 * ---------------------------------------------------------------------------
 * Per the H4b brief ("keep the reopen/skip/DB parts thin + owner-live; unit-test
 * the pure selection/collection/override/dryRun logic"), this test is HTTP-free
 * and uses NO live MySQL: the two DB-backed steps are driven with a tiny FAKE
 * PDO (records the writes) + injected page/row sources, so the collection loop,
 * the alias resolution, the override wiring and the dryRun branch are all
 * exercised without a real DB or a real dump. The thin DB accessors
 * (avesmapsWikiDumpHybridFetchPendingTitles / -FetchProcessableRows /
 * -MarkProcessed and the DDL) are bypassed via injection and stay owner-live-
 * verified, exactly as H4a/H2 kept their DB halves.
 *
 *   (a) avesmapsWikiDumpHybridBuildWantedSet -- pending titles resolved through
 *       the H4a title->title redirect alias map (present / absent / redirect
 *       cases), keyed by canonical title with the ORIGINAL requested title as
 *       the trace value.
 *   (b) avesmapsWikiDumpHybridOverrideFromRow -- NULL/empty columns -> [] (so a
 *       row with no overrides reproduces Pass B's dump-only behaviour); populated
 *       columns -> the class/building_type/continent triple.
 *   (c) avesmapsWikiDumpHybridParseRow against REAL fixture wikitext (Ferdok
 *       settlement, Burg Wallenstein building, Koschberge region, Kosch
 *       territory) -- the kind is determined by the SAME classifier Pass B uses,
 *       and the OVERRIDE propagates into the produced record (class, building_type,
 *       continent) -- proving the H3 hook is wired.
 *   (d) avesmapsWikiDumpHybridWikitextCollectStep (fake PDO + fake page source):
 *       the right rows get wikitext, a redirect alias resolves, H2's early-exit
 *       fires when all wanted are found, and nextCursor = cursor + pages_scanned.
 *   (e) avesmapsWikiDumpHybridParseUpsertStep (fake PDO + injected rows):
 *       dryRun=true RETURNS records carrying the OVERRIDDEN values and writes
 *       nothing (no upsert, no processed_at); dryRun=false routes each kind to
 *       the correct upsert (via injected spies) and marks processed_at.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as the sibling
 * tools/wikidump tests -- the reused derivation functions call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-hybrid-read.php
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
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the fixture read needs XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the SAME chain test-dump-entities.php uses (the H3 handlers
//    + Pass B upserts this file reuses), plus dump-hybrid-state.php (the state
//    table DDL) and the file under test. All side-effect-free on include.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';          // avesmapsNormalizeSingleLine (territory handler)
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';  // require_once's -parsing/-licenses/-model
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpHybridBuildWantedSet',
    'avesmapsWikiDumpHybridPageFromRow',
    'avesmapsWikiDumpHybridOverrideFromRow',
    'avesmapsWikiDumpHybridParseRow',
    'avesmapsWikiDumpHybridWikitextCollectStep',
    'avesmapsWikiDumpHybridFetchPendingTitles',
    'avesmapsWikiDumpHybridParseUpsertStep',
    'avesmapsWikiDumpHybridUpsertParsedRow',
    'avesmapsWikiDumpHybridFetchProcessableRows',
    'avesmapsWikiDumpHybridMarkProcessed',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-hybrid-read.php.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors the sibling tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-66s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-66s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// ---------------------------------------------------------------------------
// 2b. A tiny FAKE PDO/PDOStatement (records executes; returns canned SELECTs).
//     Enough to drive the two steps without a live MySQL. It recognises the
//     handful of SQL shapes the steps issue and no more -- if the steps' SQL
//     changes shape, a test relying on it fails loudly (a wiring guard).
// ---------------------------------------------------------------------------
final class FakeHybridStmt extends PDOStatement
{
    /** @var array<string,mixed> */
    public array $bound = [];
    /** @var list<array<string,mixed>> */
    public array $executions = [];

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
        $this->executions[] = $effective;
        // Record UPDATE ... SET wikitext writes + processed_at writes on the log.
        if (stripos($this->sql, 'SET wikitext') !== false) {
            $this->log->wikitextWrites[] = $effective;
        }
        if (stripos($this->sql, 'SET processed_at') !== false) {
            $this->log->processedWrites[] = $effective;
        }
        $this->cannedCursor = 0;
        return true;
    }

    private int $cannedCursor = 0;

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        if ($this->cannedCursor >= count($this->cannedRows)) {
            return false;
        }
        $row = $this->cannedRows[$this->cannedCursor++];
        return array_values($row)[$column] ?? false;
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        return $this->cannedRows;
    }
}

final class FakeHybridPdo extends PDO
{
    /** @var list<array<string,mixed>> */
    public array $wikitextWrites = [];
    /** @var list<array<string,mixed>> */
    public array $processedWrites = [];
    /** @var list<string> */
    public array $execs = [];
    /** @var list<string> */
    public array $prepared = [];
    /** @var list<array<string,mixed>> */
    public array $cannedSelectRows = [];

    public function __construct()
    {
        // Do NOT call parent::__construct -- no real DSN. PDO subclassing allows
        // overriding methods; we never touch a real connection.
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
        // avesmapsWikiSettlementEnsureSchema() probes the schema via query(); on
        // this fake it is a no-op returning an empty statement (no live DB).
        $this->execs[] = (string) $query;
        return new FakeHybridStmt((string) $query, $this, []);
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        $this->prepared[] = (string) $query;
        // The pending-title SELECT and the processable-row SELECT both read canned
        // rows; the wikitext UPDATE + processed UPDATE record their params.
        $canned = [];
        if (stripos((string) $query, 'FROM wiki_dump_hybrid_state') !== false
            && stripos((string) $query, 'SELECT') !== false) {
            $canned = $this->cannedSelectRows;
        }
        return new FakeHybridStmt((string) $query, $this, $canned);
    }
}

echo "================================================================\n";
echo " dump-hybrid-read PURE-logic test (Hybrid WikiDump migration, H4b)\n";
echo "================================================================\n";

$check(
    '(0) include produced no output',
    '',
    $includeOutput,
    'the module is side-effect-free on include (function defs only, no DB connect)'
);

// ===========================================================================
// (a) wanted-set build + title->title alias resolution.
// ===========================================================================
echo "\n-- (a) avesmapsWikiDumpHybridBuildWantedSet (alias resolution) --\n";

// One redirect alias: "Altes Ferdok" (a wanted title) is a redirect to "Ferdok"
// (its canonical dump <title>). "Kuslik" is not an alias (passes through).
$pending = ['Ferdok', 'Kuslik', 'Altes Ferdok'];
$aliasMap = ['Altes Ferdok' => 'Ferdok']; // H4a title->title map (normalized both sides)
$wanted = avesmapsWikiDumpHybridBuildWantedSet($pending, $aliasMap);

$check(
    '(a1) non-alias titles map canonical->original (identity)',
    'Kuslik',
    $wanted['Kuslik'] ?? '(missing)',
    'a pending title that is not a redirect passes through: its own normalized title is both key and trace value'
);
$check(
    '(a2) a redirect wanted-title resolves to its canonical dump title',
    true,
    isset($wanted['Ferdok']),
    '"Altes Ferdok" -> canonical "Ferdok": the membership key is the CANONICAL title (what the dump stores the body under)'
);
$check(
    '(a3) the resolved canonical key traces back to the ORIGINAL requested title',
    'Altes Ferdok',
    $wanted['Ferdok'] ?? '(missing)',
    'so wikitext_collect writes the found body onto the row that ASKED for it ("Altes Ferdok"), not a phantom "Ferdok" row'
);
$check(
    '(a4) an empty pending title contributes nothing',
    ['Ferdok', 'Kuslik'],
    array_keys(avesmapsWikiDumpHybridBuildWantedSet(['Ferdok', '', 'Kuslik'], [])),
    'a title normalizing to "" is skipped (never a degenerate "" membership key)'
);
$check(
    '(a5) no alias map -> every pending title passes through unchanged',
    ['Ferdok' => 'Ferdok', 'Kuslik' => 'Kuslik'],
    avesmapsWikiDumpHybridBuildWantedSet(['Ferdok', 'Kuslik'], []),
    'the common case (no redirects among wanted titles): identity mapping'
);

// ===========================================================================
// (b) override assembly from a state row.
// ===========================================================================
echo "\n-- (b) avesmapsWikiDumpHybridOverrideFromRow --\n";

$check(
    '(b1) all-NULL override columns -> [] (reproduces Pass B dump-only behaviour)',
    [],
    avesmapsWikiDumpHybridOverrideFromRow([
        'override_class' => null,
        'override_building_type' => null,
        'override_continent' => null,
    ]),
    'a row with no online overrides must parse exactly like Pass B (empty override array)'
);
$check(
    '(b2) empty-string override columns -> [] (empty treated as absent)',
    [],
    avesmapsWikiDumpHybridOverrideFromRow([
        'override_class' => '',
        'override_building_type' => '',
        'override_continent' => '',
    ]),
    'matches the H3 handlers own "if set + non-empty" rule -- an empty string never overrides a real value'
);
$check(
    '(b3) populated columns -> the class/building_type/continent triple',
    ['class' => 'metropole', 'building_type' => 'Tempel', 'continent' => 'Aventurien'],
    avesmapsWikiDumpHybridOverrideFromRow([
        'override_class' => 'metropole',
        'override_building_type' => 'Tempel',
        'override_continent' => 'Aventurien',
    ]),
    'the three override columns become the exact keys the H3 handlers read'
);

// ===========================================================================
// (c) parse-one-row: real fixture wikitext + the override hook.
// ===========================================================================
echo "\n-- (c) avesmapsWikiDumpHybridParseRow (real fixture wikitext + H3 override) --\n";

/** Read the real fixture pages into a title => page map. */
$fixturePages = [];
$reader = avesmapsWikiDumpOpenReader($fixturePath);
try {
    foreach (avesmapsWikiDumpIteratePages($reader) as $p) {
        $fixturePages[(string) $p['title']] = $p;
    }
} finally {
    $reader->close();
}

/** Build a state row from a real fixture page's wikitext + a synthetic override. */
$rowFromFixture = static function (string $title, array $override) use ($fixturePages): array {
    $wikitext = (string) ($fixturePages[$title]['wikitext'] ?? '');
    return [
        'id' => 1,
        'normalized_title' => avesmapsWikiSyncMonitorNormalizeTitle($title),
        'wikitext' => $wikitext,
        'override_class' => $override['class'] ?? null,
        'override_building_type' => $override['building_type'] ?? null,
        'override_continent' => $override['continent'] ?? null,
    ];
};

// Settlement (Ferdok): dump-derived class is 'stadt'; the override forces 'metropole'.
$ferdokDefault = avesmapsWikiDumpHybridParseRow($rowFromFixture('Ferdok', []));
$ferdokOverride = avesmapsWikiDumpHybridParseRow($rowFromFixture('Ferdok', ['class' => 'metropole', 'continent' => 'Aventurien']));
$check(
    '(c1) settlement classified + kept (real Infobox Siedlung)',
    ['settlement', true],
    [$ferdokDefault['kind'], $ferdokDefault['kept']],
    'the row kind is decided by the SAME classifier Pass B uses -- no bespoke re-classification'
);
$check(
    '(c2) settlement default class = dump-derived (no override) = stadt',
    'stadt',
    (string) ($ferdokDefault['record']['settlement_class'] ?? '(none)'),
    'with override=[] the record is byte-identical to Pass B dump-only output'
);
$check(
    '(c3) settlement override class propagates INTO the record (H3 hook wired)',
    'metropole',
    (string) ($ferdokOverride['record']['settlement_class'] ?? '(none)'),
    'override_class=metropole reaches avesmapsWikiDumpParseSettlementPage($page, $override) and wins'
);

// Building (Burg Wallenstein): dump building_type='Burg'; override forces 'Tempel'.
$burgDefault = avesmapsWikiDumpHybridParseRow($rowFromFixture('Burg Wallenstein', []));
$burgOverride = avesmapsWikiDumpHybridParseRow($rowFromFixture('Burg Wallenstein', ['building_type' => 'Tempel', 'continent' => 'Aventurien']));
$check(
    '(c4) building classified + kept (real Infobox Bauwerk)',
    ['building', true],
    [$burgDefault['kind'], $burgDefault['kept']],
    'building is checked before settlement so a Burg is not swallowed by the settlement needle'
);
$check(
    '(c5) building override building_type propagates INTO the record (H3 hook wired)',
    'Tempel',
    (string) ($burgOverride['record']['building_type'] ?? '(none)'),
    'override_building_type=Tempel reaches avesmapsWikiDumpParseBuildingPage($page, $override) and wins over the dump-derived Burg'
);

// Region (Koschberge): a continent override to Myranor FILTERS the record out.
$koschbergeKept = avesmapsWikiDumpHybridParseRow($rowFromFixture('Koschberge', ['continent' => 'Aventurien']));
$koschbergeFiltered = avesmapsWikiDumpHybridParseRow($rowFromFixture('Koschberge', ['continent' => 'Myranor']));
$check(
    '(c6) region kept when continent override = Aventurien',
    ['region', true],
    [$koschbergeKept['kind'], $koschbergeKept['kept']],
    'the region handler keeps an Aventurien region and produces a wiki_region_staging record'
);
$check(
    '(c7) region override continent=Myranor FILTERS the row out (kept=false)',
    ['region', false, null],
    [$koschbergeFiltered['kind'], $koschbergeFiltered['kept'], $koschbergeFiltered['record']],
    'the override continent wins, then the Aventurien-only filter drops it -- exactly the H3 handler behaviour'
);

// Territory (Kosch): classified + kept; record carries a wiki_key for the alias write.
$koschTerr = avesmapsWikiDumpHybridParseRow($rowFromFixture('Kosch', ['continent' => 'Aventurien']));
$check(
    '(c8) territory classified + kept, record carries a wiki_key',
    ['territory', true, true],
    [$koschTerr['kind'], $koschTerr['kept'], isset($koschTerr['record']['wiki_key']) && $koschTerr['record']['wiki_key'] !== ''],
    'the territory handler produces the sandbox record (with wiki_key) the sharp path feeds to UpsertTestRecord + StoreAlias'
);

// A row whose wikitext carries no recognised infobox -> kind '' -> kept=false.
$noInfobox = avesmapsWikiDumpHybridParseRow([
    'id' => 9,
    'normalized_title' => 'Leerseite',
    'wikitext' => "Nur Fließtext, kein Infobox-Template.\n[[Kategorie:Aventurien]]",
    'override_class' => null,
    'override_building_type' => null,
    'override_continent' => null,
]);
$check(
    '(c9) a page with no recognised infobox -> kind "" and kept=false (no record)',
    ['', false, null],
    [$noInfobox['kind'], $noInfobox['kept'], $noInfobox['record']],
    'mirrors Pass B: an unrecognised page is silently skipped, never upserted'
);

// ===========================================================================
// (d) wikitext_collect step: collection loop + early-exit + nextCursor.
// ===========================================================================
echo "\n-- (d) avesmapsWikiDumpHybridWikitextCollectStep (fake PDO + fake page source) --\n";

// Fake dump stream: 5 pages; two of them ("Ferdok", "Kosch") are wanted, one
// wanted title ("Altes Ferdok") is a redirect alias to "Ferdok".
$fakePages = [
    ['title' => 'Irrelevant Eins', 'ns' => 0, 'redirect' => null, 'wikitext' => 'x'],
    ['title' => 'Ferdok', 'ns' => 0, 'redirect' => null, 'wikitext' => 'FERDOK-BODY'],
    ['title' => 'Irrelevant Zwei', 'ns' => 0, 'redirect' => null, 'wikitext' => 'y'],
    ['title' => 'Kosch', 'ns' => 0, 'redirect' => null, 'wikitext' => 'KOSCH-BODY'],
    ['title' => 'Irrelevant Drei', 'ns' => 0, 'redirect' => null, 'wikitext' => 'z'],
];
$fakePageSource = static function (string $path, int $skip) use ($fakePages): iterable {
    $i = 0;
    foreach ($fakePages as $page) {
        if ($i++ < $skip) {
            continue; // honour the skip-to-cursor contract
        }
        yield $page;
    }
};

// The state table has exactly 2 pending rows, BOTH findable: "Altes Ferdok"
// (alias of Ferdok) and "Kosch". Because every wanted title is present, H2's
// early-exit can fire once both are found (Kosch is page 4 of 5).
$pdoCollect = new FakeHybridPdo();
$pdoCollect->cannedSelectRows = [
    ['normalized_title' => 'Altes Ferdok'],
    ['normalized_title' => 'Kosch'],
];
$collect = avesmapsWikiDumpHybridWikitextCollectStep(
    $pdoCollect,
    '/unused/dump.xml',
    42,               // runId
    0,                // cursor
    0,                // stepIndex
    999.0,            // generous time margin (never the cap in this test)
    $fakePageSource,
    ['Altes Ferdok' => 'Ferdok'] // H4a title->title alias map
);

$check(
    '(d1) found_this_step counts both matched pages (alias + direct)',
    2,
    $collect['found_this_step'],
    '"Ferdok" (via the "Altes Ferdok" alias) and "Kosch" are both found in the stream'
);
$check(
    '(d2) the alias-resolved body is written back onto the ORIGINAL requested row',
    ['run_id' => 42, 'normalized_title' => 'Altes Ferdok', 'wikitext' => 'FERDOK-BODY'],
    (static function () use ($pdoCollect): array {
        foreach ($pdoCollect->wikitextWrites as $w) {
            if (($w['normalized_title'] ?? '') === 'Altes Ferdok') {
                return ['run_id' => $w['run_id'], 'normalized_title' => $w['normalized_title'], 'wikitext' => $w['wikitext']];
            }
        }
        return [];
    })(),
    'the dump body found under canonical "Ferdok" is UPDATEd onto the "Altes Ferdok" row that asked for it'
);
$check(
    '(d3) the direct-match body is written onto its own row',
    'KOSCH-BODY',
    (static function () use ($pdoCollect): string {
        foreach ($pdoCollect->wikitextWrites as $w) {
            if (($w['normalized_title'] ?? '') === 'Kosch') {
                return (string) $w['wikitext'];
            }
        }
        return '(none)';
    })(),
    'a non-alias wanted title gets its body written onto its own normalized_title row'
);
$check(
    '(d4) nextCursor = cursor + pages_scanned',
    true,
    $collect['nextCursor'] === (0 + $collect['pages_scanned']),
    'the caller resumes past exactly the pages this step consumed (the adjudicated resume contract)'
);
$check(
    '(d5) early-exit fired: not all 5 pages scanned once both wanted found',
    true,
    $collect['pages_scanned'] < count($fakePages),
    'H2 early-exit stops pulling the stream once every wanted title is found (Kosch is page 4 of 5) -- done stays false (more may remain in a later step)'
);
$check(
    '(d6) done=false after an early-exit (the NEXT step decides completion)',
    false,
    $collect['done'],
    'early-exit means the stream was NOT exhausted; the fresh wanted-set on the next step drives done=true'
);

// Empty pending set -> done=true immediately, no dump opened.
$pdoEmpty = new FakeHybridPdo();
$pdoEmpty->cannedSelectRows = [];
$collectEmpty = avesmapsWikiDumpHybridWikitextCollectStep(
    $pdoEmpty,
    '/unused/dump.xml',
    42,
    7,     // a non-zero cursor to prove it is preserved
    3,
    999.0,
    static function (): iterable { yield from []; }
);
$check(
    '(d7) empty pending set -> done=true, cursor preserved, nothing scanned',
    ['done' => true, 'nextCursor' => 7, 'pages_scanned' => 0],
    ['done' => $collectEmpty['done'], 'nextCursor' => $collectEmpty['nextCursor'], 'pages_scanned' => $collectEmpty['pages_scanned']],
    'when every row already has wikitext the collect phase is complete without touching the dump'
);

// Stream exhausted (all wanted found is NOT the case here: one wanted stays
// missing) -> done=true because the iterator ran out.
$pdoExhaust = new FakeHybridPdo();
$pdoExhaust->cannedSelectRows = [['normalized_title' => 'Nur Dieser Fehlt']];
$collectExhaust = avesmapsWikiDumpHybridWikitextCollectStep(
    $pdoExhaust,
    '/unused/dump.xml',
    42,
    0,
    0,
    999.0,
    $fakePageSource, // none of the 5 pages match "Nur Dieser Fehlt"
    []
);
$check(
    '(d8) stream exhausted with a wanted title never found -> done=true, 0 found',
    ['done' => true, 'found_this_step' => 0, 'pages_scanned' => 5],
    ['done' => $collectExhaust['done'], 'found_this_step' => $collectExhaust['found_this_step'], 'pages_scanned' => $collectExhaust['pages_scanned']],
    'running off the end of the dump (no early-exit, no deadline) is the ONLY way this step reports the phase done'
);

// ===========================================================================
// (e) parse_and_upsert step: dryRun read-only vs the sharp path.
// ===========================================================================
echo "\n-- (e) avesmapsWikiDumpHybridParseUpsertStep (dryRun vs sharp) --\n";

// Injected processable rows: one settlement (Ferdok, class override) + one
// building (Burg Wallenstein, building_type override), each with real wikitext.
$processableRows = [
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
$fakeRowFetcher = static function (PDO $pdo, int $runId, int $cursor, int $budget) use ($processableRows): array {
    return $processableRows; // ignore paging -- return the fixed pair
};

// ---- dryRun = TRUE: returns records with OVERRIDDEN values, writes NOTHING. ----
$pdoDry = new FakeHybridPdo();
$dry = avesmapsWikiDumpHybridParseUpsertStep(
    $pdoDry,
    42,
    0,
    true,          // dryRun
    2000,
    $fakeRowFetcher
);
$dryByTitle = [];
foreach ($dry['records'] as $rec) {
    $dryByTitle[$rec['title']] = $rec;
}
$check(
    '(e1) dryRun returns a records array (what the H5 compare-test consumes)',
    true,
    isset($dry['records']) && is_array($dry['records']) && count($dry['records']) === 2,
    'both kept rows are returned read-only for the compare-test'
);
$check(
    '(e2) dryRun settlement record carries the OVERRIDDEN class (metropole, not stadt)',
    'metropole',
    (string) ($dryByTitle['Ferdok']['record']['settlement_class'] ?? '(none)'),
    'proves the override triple from the state row reaches the H3 handler on the dryRun path'
);
$check(
    '(e3) dryRun building record carries the OVERRIDDEN building_type (Tempel, not Burg)',
    'Tempel',
    (string) ($dryByTitle['Burg Wallenstein']['record']['building_type'] ?? '(none)'),
    'the H3 hook is wired identically for every kind on the dryRun path'
);
$check(
    '(e4) dryRun writes NOTHING sharp and marks NOTHING processed',
    ['wikitextWrites' => 0, 'processedWrites' => 0],
    ['wikitextWrites' => count($pdoDry->wikitextWrites), 'processedWrites' => count($pdoDry->processedWrites)],
    'honours "nothing sharp before the compare-test is green": no upsert, no processed_at -- a later real run still processes the row'
);
$check(
    '(e5) dryRun nextCursor = the max state-row id scanned',
    12,
    $dry['nextCursor'],
    'the id high-water mark advances so a dry run can be looped to completion without writing'
);
$check(
    '(e6) dryRun reports dry_run=true and kept=2',
    ['dry_run' => true, 'kept' => 2],
    ['dry_run' => $dry['dry_run'], 'kept' => $dry['kept']],
    'both rows classify + keep; the flag marks this as the read-only mode'
);

// ---- dryRun = FALSE: routes each kind to the RIGHT upsert + marks processed. ----
$sharpCalls = [];
$upsertSpies = [
    AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT => static function (PDO $pdo, array $record) use (&$sharpCalls): void {
        $sharpCalls[] = ['kind' => 'settlement', 'settlement_class' => $record['settlement_class'] ?? null];
    },
    AVESMAPS_WIKI_DUMP_ENTITY_BUILDING => static function (PDO $pdo, array $record) use (&$sharpCalls): void {
        $sharpCalls[] = ['kind' => 'building', 'building_type' => $record['building_type'] ?? null];
    },
];
$pdoSharp = new FakeHybridPdo();
$sharp = avesmapsWikiDumpHybridParseUpsertStep(
    $pdoSharp,
    42,
    0,
    false,         // dryRun = false -> SHARP
    2000,
    $fakeRowFetcher,
    $upsertSpies
);
$check(
    '(e7) sharp path routes the settlement row to the settlement upsert (with overridden class)',
    ['kind' => 'settlement', 'settlement_class' => 'metropole'],
    (static function () use ($sharpCalls): array {
        foreach ($sharpCalls as $c) {
            if ($c['kind'] === 'settlement') {
                return $c;
            }
        }
        return [];
    })(),
    'dryRun=false calls the SAME per-kind upsert Pass B uses (here a spy), fed the overridden record'
);
$check(
    '(e8) sharp path routes the building row to the building upsert (with overridden type)',
    ['kind' => 'building', 'building_type' => 'Tempel'],
    (static function () use ($sharpCalls): array {
        foreach ($sharpCalls as $c) {
            if ($c['kind'] === 'building') {
                return $c;
            }
        }
        return [];
    })(),
    'each kind is dispatched to its own reused upsert -- zero new upsert code'
);
$check(
    '(e9) sharp path marks BOTH rows processed_at (ids 11 + 12)',
    [11, 12],
    (static function () use ($pdoSharp): array {
        $ids = [];
        foreach ($pdoSharp->processedWrites as $w) {
            $ids[] = (int) ($w['id'] ?? 0);
        }
        sort($ids);
        return $ids;
    })(),
    'the ONE sharp step marks each consumed row so a re-run does not double-process it'
);
$check(
    '(e10) sharp path returns no records array (records are dryRun-only)',
    false,
    isset($sharp['records']),
    'the sharp mode performs writes; it does not return the read-only compare-test payload'
);

// A row that does NOT keep (region filtered to Myranor) is still marked processed
// on the sharp path (so it is not re-scanned forever) but triggers no upsert.
$filteredRows = [[
    'id' => 20,
    'normalized_title' => 'Koschberge',
    'wikitext' => (string) ($fixturePages['Koschberge']['wikitext'] ?? ''),
    'override_class' => null,
    'override_building_type' => null,
    'override_continent' => 'Myranor', // filters the region out
]];
$regionSpyCalls = 0;
$pdoFiltered = new FakeHybridPdo();
$sharpFiltered = avesmapsWikiDumpHybridParseUpsertStep(
    $pdoFiltered,
    42,
    0,
    false,
    2000,
    static function () use ($filteredRows): array { return $filteredRows; },
    [AVESMAPS_WIKI_DUMP_ENTITY_REGION => static function () use (&$regionSpyCalls): void { $regionSpyCalls++; }]
);
$check(
    '(e11) sharp path: a filtered (kept=false) row is marked processed but NOT upserted',
    ['kept' => 0, 'regionUpserts' => 0, 'processed' => [20]],
    [
        'kept' => $sharpFiltered['kept'],
        'regionUpserts' => $regionSpyCalls,
        'processed' => array_map(static fn(array $w): int => (int) ($w['id'] ?? 0), $pdoFiltered->processedWrites),
    ],
    'a continent-filtered row writes nothing sharp yet is consumed (processed_at set) so it is not re-scanned every step'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
