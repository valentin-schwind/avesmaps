<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the Hybrid WikiDump state layer (Task H4a):
 * api/_internal/wiki/dump-hybrid-state.php.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (and deliberately does NOT)
 * ---------------------------------------------------------------------------
 * This test is DB-free and HTTP-free, per H4a's pure-assembler / thin-DB-
 * wrapper split (mirrors tools/wikidump/test-dump-category-layer.php for H1):
 *
 *   (A) the title->title redirect extractor
 *       avesmapsWikiDumpCollectRedirectTitleAliases(), run against the SAME
 *       real fixture (fixtures/mini-dump.xml) test-dump-reader.php already
 *       uses for the slug-keyed avesmapsWikiDumpCollectRedirectAliases() --
 *       so both collectors are proven against the identical two real
 *       <redirect> pages (Horasreich->Lieblichesfeld,
 *       "Königreich Kosch (historisch)"->Kosch) plus the same 21 non-redirect
 *       pages that must contribute nothing.
 *   (B) the three PURE row-computation helpers
 *       (avesmapsWikiDumpHybridComputeClassMapRows / -BuildingMapRows /
 *       -ContinentMapRows), given mock H1 map shapes -- exactly the
 *       {normTitle => value} shape avesmapsWikiDumpCategoryFetch*Map()'s
 *       `map` key returns -- asserting the exact row list that would be
 *       upserted.
 *   (C) the continent fill step's cursor/done pass-through
 *       (avesmapsWikiDumpHybridFillContinentMapStep), using PDO-less
 *       verification: this function DOES take a PDO parameter (it upserts),
 *       so its cursor/done contract is instead verified indirectly by calling
 *       the underlying REAL avesmapsWikiDumpCategoryFetchContinentMap()
 *       directly with a fake batch fetcher (no PDO, no HTTP) and asserting
 *       the exact nextCursor/done values avesmapsWikiDumpHybridFillContinentMapStep()
 *       is documented to pass through UNCHANGED -- i.e. this test proves the
 *       pass-through claim by proving H1's own contract, which
 *       avesmapsWikiDumpHybridFillContinentMapStep()'s source (read directly
 *       below) shows is forwarded verbatim with no re-interpretation.
 *
 * The DDL (avesmapsWikiDumpHybridEnsureStateTable) and the actual upsert
 * (avesmapsWikiDumpHybridUpsertRows / the three Fill* wrappers) all need a
 * live PDO and are therefore NOT exercised here -- per the H4a brief, "keep
 * those parts thin and owner-live-verified, like H1/5a did." This test does
 * assert those functions and the table-creation function EXIST (a wiring
 * check) and that including the file performs no DB connect / no output.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as the sibling
 * tools/wikidump tests -- the reused derivation functions call
 * mb_strtolower()/mb_substr()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-hybrid-state.php
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
// 1. Include chain: only the libraries dump-hybrid-state.php itself needs,
//    plus dump-reader.php (for the real Pass-A fixture iterator) and
//    dump-category-layer.php (for the real H1 fetch functions the continent
//    pass-through check calls directly). All side-effect-free on include.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php'; // require_once's sync-monitor-parsing.php internally (avesmapsWikiSyncMonitorDetectContinent)
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-category-layer.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpHybridEnsureStateTable',
    'avesmapsWikiDumpCollectRedirectTitleAliases',
    'avesmapsWikiDumpHybridComputeClassMapRows',
    'avesmapsWikiDumpHybridComputeBuildingMapRows',
    'avesmapsWikiDumpHybridComputeContinentMapRows',
    'avesmapsWikiDumpHybridUpsertRows',
    'avesmapsWikiDumpHybridFillClassMap',
    'avesmapsWikiDumpHybridFillBuildingMap',
    'avesmapsWikiDumpHybridFillContinentMapStep',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-hybrid-state.php.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (no framework in this repo; mirrors the sibling
//    tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-64s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-64s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-hybrid-state PURE-logic test (Hybrid WikiDump migration, H4a)\n";
echo "================================================================\n";

$check(
    '(0) include produced no output',
    '',
    $includeOutput,
    'the module is side-effect-free on include (const + function defs only)'
);

// ===========================================================================
// (a) title->title redirect extractor, against the REAL Pass-A fixture.
// ===========================================================================
echo "\n-- (a) title->title redirect extractor (real fixture, real Pass-A stream) --\n";

/**
 * @return iterable<array{title:string, ns:int, redirect:?string, wikitext:string}>
 */
$readAll = static function (string $path): iterable {
    $reader = avesmapsWikiDumpOpenReader($path);
    try {
        yield from avesmapsWikiDumpIteratePages($reader);
    } finally {
        $reader->close();
    }
};

$titleAliasMap = avesmapsWikiDumpCollectRedirectTitleAliases($readAll($fixturePath));

$check(
    '(a1) title-alias map size (exactly the 2 real <redirect> pages)',
    2,
    count($titleAliasMap),
    'fixture has 21 non-redirect pages + exactly 2 <redirect title="..."> pages; only the latter contribute'
);
$check(
    '(a2) Horasreich -> Lieblichesfeld (plain title, no slug)',
    'Lieblichesfeld',
    $titleAliasMap['Horasreich'] ?? null,
    'raw dump-reader.php:287-289 redirect target, normalized via avesmapsWikiSyncMonitorNormalizeTitle only -- NOT avesmapsPoliticalSlug'
);
$check(
    '(a3) "Königreich Kosch (historisch)" -> Kosch (umlaut + parenthetical alias title)',
    'Kosch',
    $titleAliasMap['Königreich Kosch (historisch)'] ?? null,
    'alias side keeps spaces/umlauts/parentheses -- normalized-title form, not a hyphenated slug'
);
$check(
    '(a4) no slug-form keys leak into the title-keyed map',
    false,
    array_key_exists('koenigreich-kosch-historisch', $titleAliasMap) || array_key_exists('horasreich', $titleAliasMap),
    'this collector is title-keyed (avesmapsWikiSyncMonitorNormalizeTitle only), never slug-keyed (avesmapsPoliticalSlug)'
);
$check(
    '(a5) a non-redirect page (Kosch itself) contributes nothing as a KEY',
    false,
    array_key_exists('Kosch', $titleAliasMap),
    'Kosch is a normal content page (no <redirect> element) -- it must never appear as an alias KEY, only as a canonical VALUE'
);
$check(
    '(a6) running the new title-keyed collector does not disturb the existing slug-keyed one',
    ['horasreich' => 'present', 'koenigreich_kosch_historisch' => 'present'],
    (static function () use ($readAll, $fixturePath): array {
        $slugMap = avesmapsWikiDumpCollectRedirectAliases($readAll($fixturePath));
        $key1 = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Horasreich'));
        $key2 = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Königreich Kosch (historisch)'));
        return [
            'horasreich' => isset($slugMap[$key1]) ? 'present' : 'MISSING',
            'koenigreich_kosch_historisch' => isset($slugMap[$key2]) ? 'present' : 'MISSING',
        ];
    })(),
    'sanity check only -- the existing avesmapsWikiDumpCollectRedirectAliases() must still find both real redirects, byte-identically to test-dump-reader.php\'s own (d) assertions; this file never modifies/wraps/duplicates its behaviour (I7)'
);

// Rerun with a synthetic empty-title/empty-target redirect page mixed in, to
// prove the skip conditions independent of what the real fixture happens to contain.
// Also mixes in an alias page whose title/target actually EXERCISE
// avesmapsWikiSyncMonitorNormalizeTitle() on both sides (underscore -> space,
// trailing #anchor + trailing space stripped) -- the real fixture's two redirects
// (Horasreich, "Koenigreich Kosch (historisch)") contain neither an underscore nor
// a '#', so without this synthetic page the normalization call on the alias side
// is exercised only by inspection, never actually forced to change a value (I1).
$syntheticPages = [
    ['title' => 'Alias Eins', 'ns' => 0, 'redirect' => 'Ziel Eins', 'wikitext' => ''],
    ['title' => '', 'ns' => 0, 'redirect' => 'Ziel Ohne Titel', 'wikitext' => ''], // empty alias title -> skipped
    ['title' => 'Alias Drei', 'ns' => 0, 'redirect' => '', 'wikitext' => ''], // empty target -> not a redirect at all
    ['title' => 'Alias Eins', 'ns' => 0, 'redirect' => 'Ziel Zwei', 'wikitext' => ''], // duplicate alias -> last write wins
    ['title' => 'Normale Seite', 'ns' => 0, 'redirect' => null, 'wikitext' => 'Inhalt'], // not a redirect
    ['title' => 'Alte_Handelsstadt ', 'ns' => 0, 'redirect' => 'Neue Handelsstadt#Geschichte', 'wikitext' => ''], // underscore + trailing space (alias) / #anchor (target) -> both sides must normalize
];
$syntheticMap = avesmapsWikiDumpCollectRedirectTitleAliases($syntheticPages);
$check(
    '(a7) synthetic: empty alias title / empty target / non-redirect page all skipped',
    ['Alias Eins' => 'Ziel Zwei', 'Alte Handelsstadt' => 'Neue Handelsstadt'],
    $syntheticMap,
    'only "Alias Eins" (LAST target "Ziel Zwei" -- last write wins) and the normalized "Alte Handelsstadt" survive'
);
$check(
    '(a8) alias side normalized: underscore -> space AND trailing space trimmed',
    'Neue Handelsstadt',
    $syntheticMap['Alte Handelsstadt'] ?? null,
    'raw alias title "Alte_Handelsstadt " must be looked up via its NORMALIZED form -- proves avesmapsWikiSyncMonitorNormalizeTitle() actually ran on the alias side, not just the canonical side'
);
$check(
    '(a9) canonical side normalized: trailing #anchor stripped',
    false,
    str_contains((string) ($syntheticMap['Alte Handelsstadt'] ?? ''), '#'),
    '"Neue Handelsstadt#Geschichte" must lose its #anchor via the SAME normalizer applied to the target'
);

// ===========================================================================
// (b) pure row-computation helpers -- class / building / continent.
// ===========================================================================
echo "\n-- (b) fill row-computation (pure helpers, mock H1 map shapes) --\n";

$mockClassMap = [
    'Auhof' => 'dorf',
    'Ferdok' => 'stadt',
    'Kuslik' => 'grossstadt',
];
$classRows = avesmapsWikiDumpHybridComputeClassMapRows($mockClassMap);
$check(
    '(b1) class-map rows: one row per title, override_class set, siblings null',
    [
        ['normalized_title' => 'Auhof', 'override_class' => 'dorf', 'override_building_type' => null, 'override_continent' => null],
        ['normalized_title' => 'Ferdok', 'override_class' => 'stadt', 'override_building_type' => null, 'override_continent' => null],
        ['normalized_title' => 'Kuslik', 'override_class' => 'grossstadt', 'override_building_type' => null, 'override_continent' => null],
    ],
    $classRows,
    'exact row shape avesmapsWikiDumpHybridUpsertRows() expects; override_building_type/override_continent left null so a later fill can merge without clobbering'
);

$mockBuildingMap = [
    'Burg Wallenstein' => 'Burg',
    'Zwingfeste Ochsenblut' => 'Festung',
];
$buildingRows = avesmapsWikiDumpHybridComputeBuildingMapRows($mockBuildingMap);
$check(
    '(b2) building-map rows: one row per title, override_building_type set, siblings null',
    [
        ['normalized_title' => 'Burg Wallenstein', 'override_class' => null, 'override_building_type' => 'Burg', 'override_continent' => null],
        ['normalized_title' => 'Zwingfeste Ochsenblut', 'override_class' => null, 'override_building_type' => 'Festung', 'override_continent' => null],
    ],
    $buildingRows,
    'building_type is the crawled subcategory name itself (per H1 docblock), not a derived label'
);

$mockContinentMapPartial = [
    'Kosch' => 'Aventurien',
    'Rastullah-Strom' => 'Myranor',
];
$continentRows = avesmapsWikiDumpHybridComputeContinentMapRows($mockContinentMapPartial);
$check(
    '(b3) continent-map rows (partial batch): one row per title in THIS batch only, override_continent set',
    [
        ['normalized_title' => 'Kosch', 'override_class' => null, 'override_building_type' => null, 'override_continent' => 'Aventurien'],
        ['normalized_title' => 'Rastullah-Strom', 'override_class' => null, 'override_building_type' => null, 'override_continent' => 'Myranor'],
    ],
    $continentRows,
    'the continent fill is called once per resumable step against a PARTIAL map -- rows are computed for exactly the titles present, no knowledge of the full title-set size required'
);

$check(
    '(b4) empty map -> empty row list (all three computers)',
    [[], [], []],
    [
        avesmapsWikiDumpHybridComputeClassMapRows([]),
        avesmapsWikiDumpHybridComputeBuildingMapRows([]),
        avesmapsWikiDumpHybridComputeContinentMapRows([]),
    ],
    'no titles in -> no rows out, for every one of the three pure computers'
);

// ===========================================================================
// (c) continent fill step: cursor/done pass-through matches H1's own contract.
// ===========================================================================
echo "\n-- (c) continent fill step: nextCursor/done pass-through (H1 contract, no PDO/HTTP) --\n";

// Read avesmapsWikiDumpHybridFillContinentMapStep()'s OWN source to prove, by
// construction (not just by example), that it forwards $result['nextCursor']
// and $result['done'] from avesmapsWikiDumpCategoryFetchContinentMap()
// UNCHANGED (no re-interpretation, no re-derivation of the cursor) -- i.e.
// this is a structural check, not just a numeric example.
$hybridStateSource = (string) file_get_contents($repoRoot . '/api/_internal/wiki/dump-hybrid-state.php');
$fillContinentSource = '';
if (preg_match(
    '/function avesmapsWikiDumpHybridFillContinentMapStep\([^)]*\)[^{]*\{(.*?)\n\}\n/s',
    $hybridStateSource,
    $m
) === 1) {
    $fillContinentSource = $m[1];
}
$check(
    '(c1) fill-step calls the REAL avesmapsWikiDumpCategoryFetchContinentMap() (I8 -- no re-derivation)',
    true,
    str_contains($fillContinentSource, 'avesmapsWikiDumpCategoryFetchContinentMap($titles, $cursor, $callBudget, $batchPageFetcher)'),
    'structural check: the fill step must call H1\'s real resumable builder with the SAME positional args it received, not a re-implemented loop'
);
$check(
    '(c2) fill-step forwards nextCursor from the REAL result, unmodified',
    true,
    (bool) preg_match('/\'nextCursor\'\s*=>\s*\(int\)\s*\(\$result\[\'nextCursor\'\]\s*\?\?\s*\$cursor\)/', $fillContinentSource),
    'no re-derivation of the cursor -- it is read straight off H1\'s own return value'
);
$check(
    '(c3) fill-step forwards done from the REAL result, unmodified',
    true,
    (bool) preg_match('/\'done\'\s*=>\s*\(bool\)\s*\(\$result\[\'done\'\]\s*\?\?\s*false\)/', $fillContinentSource),
    'no re-derivation of done -- it is read straight off H1\'s own return value'
);

// Now prove H1's OWN contract holds for a concrete case (no PDO, no HTTP --
// a fake batch fetcher), so the pass-through proven structurally above
// carries real numeric meaning: a 45-title list, callBudget=1 (batch size 20)
// stops after exactly one batch (nextCursor=20, done=false); resuming from
// cursor=20 with a generous budget finishes (done=true).
$fakeTitles = array_map(static fn(int $i): string => "Titel {$i}", range(1, 45));
$fakeBatchFetcher = static function (array $batchTitles): array {
    $pages = [];
    foreach ($batchTitles as $title) {
        $pages[$title] = ['title' => $title, 'categories' => [['title' => 'Kategorie:Aventurien']]];
    }
    return $pages;
};

$step1 = avesmapsWikiDumpCategoryFetchContinentMap($fakeTitles, 0, 1, $fakeBatchFetcher);
$check(
    '(c4) H1 continent map, cursor=0, callBudget=1, batch=20: nextCursor=20 done=false',
    ['nextCursor' => 20, 'done' => false, 'mapSize' => 20],
    ['nextCursor' => $step1['nextCursor'], 'done' => $step1['done'], 'mapSize' => count($step1['map'])],
    'exactly the value avesmapsWikiDumpHybridFillContinentMapStep() must pass through unchanged from this same call shape'
);

$step2 = avesmapsWikiDumpCategoryFetchContinentMap($fakeTitles, $step1['nextCursor'], 10, $fakeBatchFetcher);
$check(
    '(c5) H1 continent map, resumed from nextCursor=20, generous budget: done=true, remaining 25 titles found',
    ['done' => true, 'mapSize' => 25],
    ['done' => $step2['done'], 'mapSize' => count($step2['map'])],
    'resuming with $cursor=$step1[\'nextCursor\'] (the exact value the fill-step would have persisted) finishes the 45-title list'
);

// ===========================================================================
// (c-cont) CONTINENT-FIX #1: the continent map fills override_continent for
// REGION and TERRITORY titles (not just settlements). After the driver phase
// reorder (online_continent_map now runs AFTER the whole-dump wikitext_collect
// scan), the continent map's title list -- FetchWantedTitles over the state
// table -- includes dump-enumerated regions/territories. This block proves the
// continent-map code path itself is kind-agnostic: given a mixed batch of
// region/territory/settlement titles whose prop=categories carry a TEMPLATE-set
// continent category (the I6 case the dump-only literal categories miss), the
// assembler + the pure row-computer produce an override_continent row for EVERY
// kind -- including a Myranor territory. The batch fetch + DetectContinent are
// mocked (no PDO, no HTTP), so this exercises exactly the pre-upsert logic the
// reordered phase runs over the now-fuller title set.
// ===========================================================================
echo "\n-- (c-cont) continent map covers region/territory titles, not just settlements (CONTINENT-FIX #1) --\n";

// A mixed wanted-set as FetchWantedTitles would now return it AFTER the scan
// enumerated all kinds: a settlement, a region, and two territories -- one of
// which (the Myranor territory) has its continent set ONLY via a template-produced
// category, i.e. exactly the case the dump-only continent (literal categories)
// gets wrong and the online prop=categories fetch gets right.
$mixedKindTitles = [
    'Kuslik',            // settlement (Aventurien)
    'Rastullah-Strom',   // region (Myranor, via template category)
    'Provinz Yal-Mordai', // territory (Myranor, via template category)
    'Grafschaft Ferdok', // territory (Aventurien)
];
// Mock prop=categories exactly as the READ-ONLY batch fetcher would return it:
// {requestedTitle => {title, categories:[{title:'Kategorie:...'}]}}. The Myranor
// pages carry a Myranor category (the template-set signal); the Aventurien ones
// carry an Aventurien category. This is the shape avesmapsWikiSyncGetCategoryNames()
// reads inside avesmapsWikiDumpCategoryAssembleContinentMap().
$mixedKindFetcher = static function (array $batchTitles): array {
    $catByTitle = [
        'Kuslik' => 'Kategorie:Aventurien',
        'Rastullah-Strom' => 'Kategorie:Myranor',
        'Provinz Yal-Mordai' => 'Kategorie:Geographie (Myranor)',
        'Grafschaft Ferdok' => 'Kategorie:Aventurien',
    ];
    $pages = [];
    foreach ($batchTitles as $title) {
        $pages[$title] = [
            'title' => $title,
            'categories' => [['title' => $catByTitle[$title] ?? 'Kategorie:Aventurien']],
        ];
    }
    return $pages;
};

// Drive the REAL continent-map builder (the exact fn the fill step forwards to)
// with the mocked fetch, then feed its map through the SAME pure row-computer the
// fill step uses before its upsert.
$mixedResult = avesmapsWikiDumpCategoryFetchContinentMap($mixedKindTitles, 0, null, $mixedKindFetcher);
$mixedMap = is_array($mixedResult['map'] ?? null) ? $mixedResult['map'] : [];
$mixedRows = avesmapsWikiDumpHybridComputeContinentMapRows($mixedMap);

// Index the produced rows by normalized_title -> override_continent for assertions.
$overrideByTitle = [];
foreach ($mixedRows as $row) {
    $overrideByTitle[(string) $row['normalized_title']] = $row['override_continent'];
}

$check(
    '(c-cont-1) an override_continent row is produced for EVERY kind (settlement + region + both territories)',
    4,
    count($mixedRows),
    'the continent map is kind-agnostic: one row per title in its list, whatever entity kind the state row is -- so after the reorder regions/territories are covered'
);
$check(
    '(c-cont-2) the REGION title gets its template-set Myranor continent (I6 case the dump-only path misses)',
    'Myranor / Güldenland',
    $overrideByTitle['Rastullah-Strom'] ?? null,
    'a region whose continent is set via a template-produced category is classified correctly by the ONLINE prop=categories fetch the continent map uses -- this is the D1 gap the reorder closes'
);
$check(
    '(c-cont-3) the TERRITORY title gets its template-set Myranor continent too',
    'Myranor / Güldenland',
    $overrideByTitle['Provinz Yal-Mordai'] ?? null,
    'territories are enumerated by the whole-dump scan and, after the reorder, are in the continent map\'s title list -- so they too get the online-detected continent'
);
$check(
    '(c-cont-4) an Aventurien territory + settlement still resolve to Aventurien (no regression for the pre-fix kinds)',
    ['Grafschaft Ferdok' => 'Aventurien', 'Kuslik' => 'Aventurien'],
    ['Grafschaft Ferdok' => $overrideByTitle['Grafschaft Ferdok'] ?? null, 'Kuslik' => $overrideByTitle['Kuslik'] ?? null],
    'the reorder does not change the continent for the kinds already covered -- override_continent for a settlement/Aventurien-territory is unchanged'
);
$check(
    '(c-cont-5) DetectContinent is generic on (title + categories), not settlement-specific',
    true,
    (static function (): bool {
        // Directly: the SAME context string the assembler builds ("title categories")
        // classifies a region/territory identically to a settlement -- proving the
        // detector has no notion of entity kind.
        $regionCtx = avesmapsWikiSyncMonitorDetectContinent('Rastullah-Strom Myranor');
        $territoryCtx = avesmapsWikiSyncMonitorDetectContinent('Provinz Yal-Mordai Geographie (Myranor)');
        return $regionCtx === 'Myranor / Güldenland' && $territoryCtx === 'Myranor / Güldenland';
    })(),
    'avesmapsWikiSyncMonitorDetectContinent reads only the title+category context -- so feeding it region/territory titles (VERIFY #2) is sound'
);

// ===========================================================================
// (d) wiring checks: DDL/upsert functions exist and take the documented shape
//     (the DB-touching half; NOT exercised live here per the H4a brief).
// ===========================================================================
echo "\n-- (d) DDL/upsert wiring (existence + signature only; DB behaviour is owner-live-verified) --\n";

$ensureTableReflection = new ReflectionFunction('avesmapsWikiDumpHybridEnsureStateTable');
$check(
    '(d1) avesmapsWikiDumpHybridEnsureStateTable(PDO $pdo): void signature',
    ['PDO', 'void'],
    [
        (string) ($ensureTableReflection->getParameters()[0]->getType() ?? ''),
        (string) ($ensureTableReflection->getReturnType() ?? ''),
    ],
    'takes exactly a PDO, returns void -- idempotent self-healing DDL per the brief'
);

$upsertReflection = new ReflectionFunction('avesmapsWikiDumpHybridUpsertRows');
$upsertParams = array_map(static fn(ReflectionParameter $p): string => $p->getName(), $upsertReflection->getParameters());
$check(
    '(d2) avesmapsWikiDumpHybridUpsertRows(PDO $pdo, int $runId, array $rows) parameter names',
    ['pdo', 'runId', 'rows'],
    $upsertParams,
    'thin DB-upsert wrapper signature the three pure computers above feed into'
);

$hybridStateSourceForDdl = $hybridStateSource;
$check(
    '(d3) DDL uses self-healing CREATE TABLE IF NOT EXISTS (never a bare CREATE TABLE)',
    true,
    str_contains($hybridStateSourceForDdl, 'CREATE TABLE IF NOT EXISTS wiki_dump_hybrid_state'),
    'same inline self-healing pattern the rest of the codebase uses (e.g. avesmapsWikiSyncEnsureCoreTables)'
);
$check(
    '(d4) DDL declares the UNIQUE KEY (run_id, normalized_title) design §3 requires',
    true,
    str_contains($hybridStateSourceForDdl, 'UNIQUE KEY uq_hybrid_state_run_title (run_id, normalized_title)'),
    'this is the key avesmapsWikiDumpHybridUpsertRows()\'s ON DUPLICATE KEY UPDATE relies on'
);
$check(
    '(d5) upsert SQL preserves sibling override columns on merge (COALESCE(VALUES(...), ...))',
    true,
    substr_count($hybridStateSourceForDdl, 'COALESCE(VALUES(override_') === 3,
    'all three override_* columns must be merge-safe -- a class fill must not wipe an earlier building/continent fill for the same title, and vice versa'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
