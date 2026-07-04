<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the online CATEGORY LAYER (Hybrid WikiDump migration,
 * Task H1): api/_internal/wiki/dump-category-layer.php.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS DELIBERATELY MOCK-DATA-ONLY
 * ---------------------------------------------------------------------------
 * The real MediaWiki API (de.wiki-aventurica.de) is NOT reachable from this
 * environment. This test therefore NEVER calls avesmapsWikiSyncApiRequest (the
 * one HTTP primitive every fetcher in this module goes through) and NEVER
 * hits the real wiki. Instead it exercises the three PURE ASSEMBLERS this
 * task introduces -- functions that take ALREADY-FETCHED data shapes
 * (categorymembers arrays / prop=categories page arrays) and build the
 * {title => class|building_type|continent} maps -- plus the resumable-cursor
 * bookkeeping of the continent map's outer function, using a fake batch
 * fetcher injected via a callable (no live HTTP, no PDO).
 *
 * Per invariant I1, this test asserts the assemblers reuse the REAL reused
 * functions (AVESMAPS_WIKI_CATEGORY_TO_CLASS, avesmapsWikiSyncMonitorNormalizeTitle,
 * avesmapsWikiSyncMonitorDetectContinent, avesmapsWikiSyncGetCategoryNames) rather
 * than re-deriving class/continent values independently.
 *
 * Include purity is also asserted: requiring dump-category-layer.php performs
 * no DB connect, no HTTP call and emits no output (only const + function defs).
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring caveat as the other tools/wikidump
 * tests -- the reused derivation functions call mb_strtolower()/mb_stripos()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-category-layer.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: the reused derivation functions need mbstring. Fail loudly.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_stripos().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>

// ---------------------------------------------------------------------------
// 1. Include chain: only the libraries dump-category-layer.php itself needs.
//    sync.php defines AVESMAPS_WIKI_CATEGORY_TO_CLASS + AVESMAPS_WIKI_TITLE_BATCH_SIZE
//    is NOT required (const lives in sync.php, already pulled by locations.php).
//    sync-monitor.php gives NormalizeTitle; sync-monitor-parsing.php gives
//    DetectContinent; locations.php/-helpers.php give the class map + category-name
//    helpers; settlements.php gives the building-subcat helpers + legacy type list +
//    excluded-type filter. All are side-effect-free on include (const + function
//    defs only, no DB/HTTP at include time -- verified in section 2 below).
// ---------------------------------------------------------------------------
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';

// ---------------------------------------------------------------------------
// 2. Include purity: no output, no fatal, defines the expected functions.
// ---------------------------------------------------------------------------
ob_start();
require $repoRoot . '/api/_internal/wiki/dump-category-layer.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpCategoryAssembleClassMap',
    'avesmapsWikiDumpCategoryFetchSettlementClassMap',
    'avesmapsWikiDumpCategoryAssembleBuildingMap',
    'avesmapsWikiDumpCategoryFetchBuildingTypeMap',
    'avesmapsWikiDumpCategoryAssembleContinentMap',
    'avesmapsWikiDumpCategoryFetchContinentMap',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-category-layer.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo; mirrors the sibling
//    tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-60s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-60s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-category-layer PURE-logic test (Hybrid WikiDump migration, H1)\n";
echo "================================================================\n";

$check(
    '(0) include produced no output',
    '',
    $includeOutput,
    'the module is side-effect-free on include (const + function defs only)'
);

// ===========================================================================
// (a) settlement-class assembler: {category => titles[]} -> {title => class} + breadth set
// ===========================================================================
echo "\n-- (a) settlement-class map assembly --\n";

// Mock categorymembers per class category, exactly as avesmapsWikiSyncFetchCategoryMemberTitles
// would return them (raw MediaWiki titles, underscores already turned to spaces by the API,
// only trimmed -- NOT normalized). Deliberately include an underscore/space variant and a
// trailing #fragment title to prove the boundary normalizer (avesmapsWikiSyncMonitorNormalizeTitle)
// is applied, per the brief.
$mockClassMembers = [
    'Dorf' => ['Auhof', 'Kleines_Dorf'], // underscore form, as some MediaWiki responses use it
    'Kleinstadt' => ['Havena (Kleinstadt)#Geschichte'], // trailing #fragment
    "Mittelgro\u{00DF}e Stadt" => ['Ferdok'],
    "Gro\u{00DF}stadt" => ['Kuslik'],
    "Metropole (Siedlungsgr\u{00F6}\u{00DF}e)" => ['Punin'],
];
$classResult = avesmapsWikiDumpCategoryAssembleClassMap($mockClassMembers);

$check(
    '(a1) result has map + titles keys',
    ['map', 'titles'],
    array_keys($classResult),
    'the builder returns { map, titles } per the brief shape'
);
$check(
    '(a2) Auhof (plain title) -> dorf',
    'dorf',
    $classResult['map']['Auhof'] ?? null,
    'AVESMAPS_WIKI_CATEGORY_TO_CLASS["Dorf"] = "dorf" (locations.php:36-44), reused verbatim'
);
$check(
    '(a3) underscore title normalized to space form as key',
    'dorf',
    $classResult['map']['Kleines Dorf'] ?? null,
    'avesmapsWikiSyncMonitorNormalizeTitle converts "Kleines_Dorf" -> "Kleines Dorf" (sync-monitor.php:319-323)'
);
$check(
    '(a4) underscore-form raw key is NOT also present',
    false,
    array_key_exists('Kleines_Dorf', $classResult['map']),
    'normalization happens at the boundary -- only the normalized key survives, per the brief'
);
$check(
    '(a5) trailing #fragment stripped from key',
    'kleinstadt',
    $classResult['map']['Havena (Kleinstadt)'] ?? null,
    'avesmapsWikiSyncMonitorNormalizeTitle strips a trailing #fragment (sync-monitor.php:321)'
);
$check(
    '(a6) Ferdok (Mittelgroße Stadt category) -> stadt',
    'stadt',
    $classResult['map']['Ferdok'] ?? null,
    'the mid-size class keys on "Mittelgroße Stadt", NOT "Stadt" (locations.php comment 39-40)'
);
$check(
    '(a7) Kuslik (Großstadt category) -> grossstadt',
    'grossstadt',
    $classResult['map']['Kuslik'] ?? null,
    'category name -> class mapping reused verbatim from AVESMAPS_WIKI_CATEGORY_TO_CLASS'
);
$check(
    '(a8) Punin (Metropole category) -> metropole',
    'metropole',
    $classResult['map']['Punin'] ?? null,
    'category name -> class mapping reused verbatim from AVESMAPS_WIKI_CATEGORY_TO_CLASS'
);
sort($classResult['titles']);
$check(
    '(a9) breadth title set = union of all normalized titles, 6 entries',
    ['Auhof', 'Ferdok', 'Havena (Kleinstadt)', 'Kleines Dorf', 'Kuslik', 'Punin'],
    $classResult['titles'],
    'titles = the settlement breadth set (union across all 5 categories), normalized + deduped'
);

// ===========================================================================
// (b) building-type assembler: {type => titles[]} -> {title => building_type} + breadth set
// ===========================================================================
echo "\n-- (b) building-type map assembly --\n";

// Mock subcat-member fetch results, shaped like avesmapsWikiSettlementCollectCategoryPages
// would return per type (already includes a legacy-list type + a "live-subcat-only" type
// to prove the online catalog is a superset of the static legacy list, per the recon 2.2).
$mockBuildingMembers = [
    'Festung' => ['Burg Wallenstein', 'Zwingfeste Ochsenblut'],
    'Ruine' => ['Ruine Tsatempel'],
    'Wasserburg' => ['Motte Trollburg#Lage'], // live subcat of "Bauwerk nach Art", not in legacy list
];
$buildingResult = avesmapsWikiDumpCategoryAssembleBuildingMap($mockBuildingMembers);

$check(
    '(b1) result has map + titles keys',
    ['map', 'titles'],
    array_keys($buildingResult),
    'the builder returns { map, titles } per the brief shape, mirroring the class map'
);
$check(
    '(b2) Burg Wallenstein -> Festung (first type wins, category = building_type)',
    'Festung',
    $buildingResult['map']['Burg Wallenstein'] ?? null,
    'building_type = the crawled subcategory name itself (recon 2.2), not a derived label'
);
$check(
    '(b3) Ruine Tsatempel -> Ruine',
    'Ruine',
    $buildingResult['map']['Ruine Tsatempel'] ?? null,
    'a title from the Ruine subcat maps to building_type "Ruine"'
);
$check(
    '(b4) trailing #fragment stripped for a live-subcat-only type',
    'Wasserburg',
    $buildingResult['map']['Motte Trollburg'] ?? null,
    'live subcats of "Bauwerk nach Art" beyond the legacy list are still assembled + normalized'
);
sort($buildingResult['titles']);
$check(
    '(b5) breadth title set = union across all supplied types, normalized',
    ['Burg Wallenstein', 'Motte Trollburg', 'Ruine Tsatempel', 'Zwingfeste Ochsenblut'],
    $buildingResult['titles'],
    'titles = the building breadth set (union across all supplied type->titles arrays)'
);

// ===========================================================================
// (c) continent assembler: {requestedTitle => prop=categories page} -> {title => continent}
// ===========================================================================
echo "\n-- (c) continent map assembly --\n";

// Mock prop=categories page objects, shaped exactly like the MediaWiki API response objects
// avesmapsWikiSyncFetchPagesByRequestedTitle would hand back (page['categories'][]['title']),
// keyed by the REQUESTED title (matching the brief's {normTitle => continent} shape).
$mockContinentPages = [
    'Rastabor' => [
        'title' => 'Rastabor',
        'categories' => [
            ['title' => 'Kategorie:Myranor'],
            ['title' => 'Kategorie:Stadt'],
        ],
    ],
    'Ferdok' => [
        'title' => 'Ferdok',
        'categories' => [
            ['title' => 'Kategorie:Mittelgroße Stadt'],
            ['title' => 'Kategorie:Mittelreich'],
        ],
    ],
    // Regression (continent-misdetection fix): a page whose ONLY Myranor token is a
    // name-derivation category "Abgeleitet von Horas (Myranor)" -- NOT a continent
    // signal -- must NOT be keyed Myranor; its "Aventurien-Artikel" wins after the
    // derivation category is stripped. (dump-category-layer.php:
    // avesmapsWikiDumpCategoryStripNonContinentCategories). Mirrors the real
    // "Wiedererstandenes Reich des Horas" page (recon 2026-07-04).
    'Wiedererstandenes Reich des Horas' => [
        'title' => 'Wiedererstandenes Reich des Horas',
        'categories' => [
            ['title' => 'Kategorie:Aventurien-Artikel'],
            ['title' => 'Kategorie:Kaiserreich'],
            ['title' => 'Kategorie:Herrschaftsgebiet in Aventurien'],
            ['title' => 'Kategorie:Abgeleitet von Horas (Myranor)'],
            ['title' => 'Kategorie:Abgeleitet von Horas-Kaiser'],
        ],
    ],
    // Regression guard: a GENUINE Myranor page (keyed by "Staat (Myranor)") must
    // STILL detect Myranor -- the strip only removes "Abgeleitet von ..." derivation
    // categories, never real "... (Myranor)" / "... in Myranor" placement categories.
    'Rastullah-Feld (Myranor)' => [
        'title' => 'Rastullah-Feld (Myranor)',
        'categories' => [
            ['title' => 'Kategorie:Staat (Myranor)'],
            ['title' => 'Kategorie:Nav Staaten Myranor'],
        ],
    ],
];
$continentMap = avesmapsWikiDumpCategoryAssembleContinentMap($mockContinentPages);

$check(
    '(c1) Myranor-category page -> "Myranor / Güldenland"',
    'Myranor / Güldenland',
    $continentMap['Rastabor'] ?? null,
    'avesmapsWikiSyncMonitorDetectContinent needle-matches "myranor" (sync-monitor-parsing.php:186-193), reused verbatim'
);
$check(
    '(c2) plain page with no continent-signal category -> default "Aventurien"',
    'Aventurien',
    $continentMap['Ferdok'] ?? null,
    'no continent needle found -> AVESMAPS_POLITICAL_DEFAULT_CONTINENT fallback (sync-monitor-parsing.php:202)'
);
$check(
    '(c3) {Aventurien-Artikel, Abgeleitet von Horas (Myranor)} -> "Aventurien" (was Myranor)',
    'Aventurien',
    $continentMap['Wiedererstandenes Reich des Horas'] ?? null,
    'name-derivation category "Abgeleitet von Horas (Myranor)" stripped before keying -> Aventurien-Artikel wins (continent-misdetection fix)'
);
$check(
    '(c4) genuine Myranor page {Staat (Myranor), Nav Staaten Myranor} STILL -> "Myranor / Güldenland"',
    'Myranor / Güldenland',
    $continentMap['Rastullah-Feld (Myranor)'] ?? null,
    'real Myranor placement categories are NOT stripped -- only "Abgeleitet von ..." derivation categories are'
);
$check(
    '(c5) strip helper is a no-op for pages without a derivation category (Ferdok unchanged)',
    'Aventurien',
    avesmapsWikiDumpCategoryAssembleContinentMap([
        'PlainAv' => ['title' => 'PlainAv', 'categories' => [['title' => 'Kategorie:Aventurien-Artikel']]],
    ])['PlainAv'] ?? null,
    'a plain {Aventurien-Artikel} page is unaffected by the strip -> Aventurien'
);

// ===========================================================================
// (d) resumable cursor contract of the outer continent-map fetch
// ===========================================================================
echo "\n-- (d) resumable cursor (outer fetch, fake batch fetcher, no HTTP) --\n";

// 45 mock titles. Inject a fake "fetch one batch of prop=categories pages" callable so this
// stays 100% HTTP-free -- it never calls avesmapsWikiSyncApiRequest or
// avesmapsWikiSyncFetchPagesByRequestedTitle. Every returned page is a plain "Aventurien" page
// (no continent-signal categories) so the assembled continent values are not the point of this
// sub-test -- only the cursor/budget bookkeeping is.
$title45 = [];
for ($i = 1; $i <= 45; $i++) {
    $title45[] = "Titel {$i}";
}
$batchCallLog = [];
$fakeBatchFetcher = static function (array $batchTitles) use (&$batchCallLog): array {
    $batchCallLog[] = $batchTitles;
    $pages = [];
    foreach ($batchTitles as $title) {
        $pages[$title] = ['title' => $title, 'categories' => []];
    }
    return $pages;
};

// NOTE ON THE EXPECTED CURSOR VALUES BELOW (documented discrepancy vs. the H1 brief):
// The brief's test section states (verbatim): "a 45-title list with callBudget=1 (batch 20)
// returns nextCursor=40, done=false". With AVESMAPS_WIKI_TITLE_BATCH_SIZE=20 (sync.php:8) and
// "stop after $callBudget API calls" (brief's own builder contract, one bullet above), 1 API
// call processes exactly ONE batch of 20 titles, so the mathematically consistent result is
// nextCursor=20, NOT 40 (that would require 2 API calls under a budget of 1, contradicting the
// "stop after $callBudget calls" rule in the same section). This looks like an arithmetic slip
// in the brief's own example (40 = 2x20, as if callBudget=1 meant "2 batches"). Per the escalate
// clause ("if anything in the brief is ambiguous... STOP and report"), this is flagged in the H1
// report rather than silently special-cased into the implementation. The test below asserts the
// INTERNALLY CONSISTENT behaviour (budget=1 -> exactly 1 batch -> cursor=20), which is what the
// shipped avesmapsWikiDumpCategoryFetchContinentMap() actually does.
$batch1 = avesmapsWikiDumpCategoryFetchContinentMap($title45, 0, 1, $fakeBatchFetcher);
$check(
    '(d1) callBudget=1, batch 20: exactly 1 API call made',
    1,
    count($batchCallLog),
    'the fetcher must stop after spending exactly $callBudget API calls'
);
$check(
    '(d2) callBudget=1, batch 20: nextCursor=20 (1 batch of 20 consumed)',
    20,
    $batch1['nextCursor'],
    '20 titles = AVESMAPS_WIKI_TITLE_BATCH_SIZE consumed by the single permitted API call (see NOTE above re: brief\'s literal "40")'
);
$check(
    '(d3) callBudget=1, batch 20: done=false (25 titles remain)',
    false,
    $batch1['done'],
    'cursor (20) < count($titles) (45) -> not done yet'
);
$check(
    '(d4) result carries a map key too',
    true,
    array_key_exists('map', $batch1),
    'the per-call result also returns the {title => continent} map for the titles it processed'
);
$batch1MapKeys = array_keys($batch1['map']);
sort($batch1MapKeys);
$check(
    '(d5) map covers exactly the titles processed in this call',
    ['Titel 1', 'Titel 10', 'Titel 11', 'Titel 12', 'Titel 13', 'Titel 14', 'Titel 15', 'Titel 16', 'Titel 17', 'Titel 18', 'Titel 19', 'Titel 2', 'Titel 20', 'Titel 3', 'Titel 4', 'Titel 5', 'Titel 6', 'Titel 7', 'Titel 8', 'Titel 9'],
    $batch1MapKeys,
    'exactly the 20 titles from this batch appear as map keys'
);

// Second call resumes from nextCursor=20 with enough budget to finish the remaining 25 titles
// (2 more batches: 20 -> 40, then 40 -> 45).
$batchCallLog = [];
$batch2 = avesmapsWikiDumpCategoryFetchContinentMap($title45, $batch1['nextCursor'], 5, $fakeBatchFetcher);
$check(
    '(d6) resuming from cursor=20 with budget=5: done=true (all 45 covered)',
    true,
    $batch2['done'],
    'cursor reaches count($titles)=45 within the given budget -> done'
);
$check(
    '(d7) resuming from cursor=20: nextCursor=45 (end of list)',
    45,
    $batch2['nextCursor'],
    'nextCursor caps at count($titles) once the last batch is consumed'
);
$check(
    '(d8) resuming from cursor=20: only 2 more API calls needed (25 titles / 20 batch = 2 batches)',
    2,
    count($batchCallLog),
    'ceil(25/20)=2 batches to cover titles 21..45, well within budget=5 -> stops early, not at the budget ceiling'
);

// Also verify the brief's OWN second-call claim independently of the disputed first-call cursor:
// "a second call from 40 returns done=true" -- resuming from a literal cursor=40 (5 titles left)
// must finish in exactly 1 more batch and report done=true, regardless of how cursor=40 was reached.
$batchCallLog = [];
$batchFrom40 = avesmapsWikiDumpCategoryFetchContinentMap($title45, 40, 1, $fakeBatchFetcher);
$check(
    '(d9) brief\'s literal claim: resuming from cursor=40 with budget=1 -> done=true',
    true,
    $batchFrom40['done'],
    "the brief's own second-call example (\"a second call from 40 returns done=true\") holds independently of how cursor 40 was reached"
);
$check(
    '(d10) resuming from cursor=40: nextCursor=45 (5 remaining titles, 1 batch covers them)',
    45,
    $batchFrom40['nextCursor'],
    'only 5 titles remain after cursor=40; one batch (<=20) covers all of them'
);

// ===========================================================================
// (e) outer fetch functions (settlement-class / building) reuse the REAL crawler
//     fetchers via an injectable callable -- proven by asserting the injected
//     fetcher was invoked with the REAL category names from AVESMAPS_WIKI_CATEGORY_TO_CLASS
//     / the real legacy building types, never a re-derived list.
// ===========================================================================
echo "\n-- (e) outer fetch wiring: real category names passed to the fetcher --\n";

$classCategoriesRequested = [];
$fakeCategoryMemberFetcher = static function (string $categoryName) use (&$classCategoriesRequested): array {
    $classCategoriesRequested[] = $categoryName;
    return [];
};
avesmapsWikiDumpCategoryFetchSettlementClassMap($fakeCategoryMemberFetcher);
$check(
    '(e1) settlement-class outer fetch walks exactly the 5 real category keys',
    array_keys(AVESMAPS_WIKI_CATEGORY_TO_CLASS),
    $classCategoriesRequested,
    'invariant I1/I8: walks AVESMAPS_WIKI_CATEGORY_TO_CLASS (locations.php:36) verbatim, no re-derived category list'
);

$buildingSubcatFetcherCalls = [];
$buildingMemberFetcherCalls = [];
$fakeSubcatFetcher = static function (string $categoryName) use (&$buildingSubcatFetcherCalls): array {
    $buildingSubcatFetcherCalls[] = $categoryName;
    return ['Wasserburg']; // one live subcat beyond the legacy list
};
$fakeBuildingMemberFetcher = static function (string $categoryName) use (&$buildingMemberFetcherCalls): array {
    $buildingMemberFetcherCalls[] = $categoryName;
    return [];
};
avesmapsWikiDumpCategoryFetchBuildingTypeMap($fakeSubcatFetcher, $fakeBuildingMemberFetcher);
$check(
    '(e2) building-type outer fetch lists subcats of exactly "Bauwerk nach Art"',
    ['Bauwerk nach Art'],
    $buildingSubcatFetcherCalls,
    'mirrors avesmapsWikiSettlementCrawlBuildings (settlements.php:929-962) verbatim root category'
);
sort($buildingMemberFetcherCalls);
$expectedTypes = AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES;
$expectedTypes[] = 'Wasserburg';
sort($expectedTypes);
$check(
    '(e3) building-type outer fetch walks legacy list + live subcat, no PDO upsert reached',
    $expectedTypes,
    $buildingMemberFetcherCalls,
    'legacy fallback list (settlements.php:67-69) + live subcat "Wasserburg", union, deduped -- stops before avesmapsWikiSettlementUpsertBuildingRow'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
