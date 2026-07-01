<?php

declare(strict_types=1);

/**
 * Fixture-based unit test for Pass B of the dump-reader (WikiDump migration,
 * Tasks 4a + 4b + 4c + 4c2 + 4d): entity-infobox ENUMERATION + the PATH handler (Fluss /
 * Straße), the REGION handler (Infobox Region / Landschaft), the SETTLEMENT handler
 * (Infobox Siedlung), the BUILDING handler (Infobox Bauwerk / Festung / Burg) and the
 * TERRITORY handler (Infobox Staat / Herrschaftsgebiet / Reich), plus the Aventurien
 * continent filter. Exercises the DB-FREE core of
 * api/_internal/wiki/dump-entity-scan.php against the canonical hand-written
 * MediaWiki-export fixture (tools/wikidump/fixtures/mini-dump.xml), which Task 4a
 * extended with three ns0 path pages, Task 4b with three ns0 region pages, Task 4c
 * with settlement pages, Task 4c2 with building pages and Task 4d with four ns0
 * territory pages:
 *
 *   Breite           {{Infobox Fluss}}      -> path,   Aventurien   (KEPT, 4a)
 *   Reichsstraße 1   {{Infobox Straße}}     -> path,   Aventurien   (KEPT, 4a)
 *   Rastullah-Strom  {{Infobox Fluss}}      -> path,   Myranor      (FILTERED, 4a)
 *   Koschberge       {{Infobox Region}}     -> region, Aventurien   (KEPT, 4b)
 *   Rote Sichel      {{Infobox Region}}     -> region, Myranor      (FILTERED, 4b)
 *   Windhag          {{Infobox Landschaft}} -> region (CLASSIFIED), but the real
 *                    region parser only accepts an Infobox *Region* -> no record,
 *                    proving the handler CALLS the real parse rather than
 *                    re-implementing/loosening its gate (4b).
 *   Ferdok           {{Infobox Siedlung}}   -> settlement, Aventurien, class stadt
 *                    (from [[Kategorie:Mittelgroße Stadt]]), DereGlobus coords,
 *                    Wappen (KEPT, 4c).
 *   Auhof            {{Infobox Siedlung}}   -> settlement, Aventurien, class dorf (KEPT, 4c)
 *   Xarxaron         {{Infobox Siedlung}}   -> settlement, Aventurien, is_ruined
 *                    (Siedlungsart=Ruine); no class category -> 'dorf' fallback (KEPT, 4c)
 *   Angbar           {{Infobox Siedlung}}   -> settlement, Aventurien, no class
 *                    category -> 'dorf' fallback (KEPT, 4c; previously only "recognised")
 *   Selem            {{Infobox Siedlung}}   -> settlement, Myranor            (FILTERED, 4c)
 *   Burg Wallenstein {{Infobox Bauwerk}}    -> building, Aventurien, Art=Burg; "Burg" not in
 *                    the reused type list -> building_type from the Art fallback (KEPT, 4c2)
 *   Zwingfeste Ochsenblut {{Infobox Festung}} -> building, Aventurien, building_type=Festung
 *                    (from [[Kategorie:Festung]], reused type list), is_ruined=false (KEPT, 4c2)
 *   Ruine Tsatempel  {{Infobox Bauwerk}}    -> building, Aventurien, building_type=Ruine
 *                    (from [[Kategorie:Ruine]]), is_ruined=true (Art=Ruine) (KEPT, 4c2)
 *   Xarsnamoth       {{Infobox Bauwerk}}    -> building, Myranor              (FILTERED, 4c2)
 *   Kosch            {{Infobox Staat}}      -> territory, Aventurien; |Zugehörigkeit= (not
 *                    |Staat=) -> empty affiliation (KEPT, 4d; previously only "recognised")
 *   Grafschaft Ferdok {{Infobox Staat}}     -> territory, Aventurien; |Staat=[[Mittelreich]]
 *                    (SIMPLE), founded {{BF|1050}} -> founded_start_bf=1050 (KEPT, 4d)
 *   Baronie Hügelland {{Infobox Staat}}     -> territory, Aventurien; |Staat=[[Grafschaft
 *                    Ferdok]]: [[Mittelreich]] (COLON-PATH) -> path of 2 (KEPT, 4d)
 *   Sokramor         {{Infobox Staat}}      -> territory, Aventurien; |Staat=(beansprucht
 *                    von: [[Horasreich]], [[Mittelreich]]) (CONFLICT) -> empty path +
 *                    conflicts + independent (KEPT, 4d)
 *   Rastanreich      {{Infobox Staat}}      -> territory, Myranor              (FILTERED, 4d)
 *
 * plus the pre-existing pages exercising the "skipped" branches:
 *   Horasreich / Königreich Kosch (historisch) -> redirects (skipped)
 *   Vorlage:Infobox Staat (ns 10)         -> non-Main namespace (skipped)
 *
 * WHAT THIS PROVES (per the Task-4a..4d briefs):
 *   (a) infobox-name enumeration classifies the fixture pages correctly
 *       (Fluss/Straße -> path; Region/Landschaft -> region; Siedlung -> settlement;
 *       Bauwerk/Festung/Burg -> building; Staat/Herrschaftsgebiet/Reich -> territory;
 *       ns10 and redirects -> skipped);
 *   (b) the path handler produces staging records whose fields match the REAL
 *       mapping -- name, art, kind ('fluss'/'strasse'), lage, laenge, verlauf,
 *       match_key (= avesmapsWikiSyncCreateMatchKey(name)), wiki_key
 *       (= avesmapsPoliticalSlug(canonical)); expected key values are HAND-DERIVED
 *       via the real functions (like Task 1), never asserted equal to the
 *       function's own output;
 *   (c) the non-Aventurien path page (Rastullah-Strom, Myranor) is FILTERED OUT
 *       (continent != Aventurien -> not in the produced records);
 *   (d) a non-path infobox page (Kosch / Staat) is NOT turned into a path record;
 *   (f) the region handler mirrors the path handler: the Aventurien region
 *       (Koschberge) produces a staging record with the REAL field/key mapping
 *       (name, art -> label_subtype path, region_parent, affiliation_staat,
 *       match_key, wiki_key), the Myranor region (Rote Sichel) is FILTERED OUT,
 *       the Landschaft page classifies as region yet yields no record (faithful to
 *       the real parser's gate), and path<->region are never cross-mishandled.
 *   (g) the SETTLEMENT handler builds a wiki_sync_pages REGISTRY record by REUSING
 *       the real settlement functions (avesmapsWikiSettlementParseInfobox +
 *       avesmapsWikiSettlementBuildEnrichment + avesmapsWikiSyncSettlementClassFromPage +
 *       avesmapsWikiSyncExtractCoordinatesFromContent): normalized_key (=
 *       CreateMatchKey(title), hand-derived), wiki_url, settlement_class (from the
 *       class category), coordinates (DereGlobus x/y -- exact numbers asserted),
 *       continent, coat_url, is_ruined; coat_license_* = NULL (I5, dump has no
 *       license metadata). The Myranor settlement (Selem) is FILTERED OUT; a
 *       {{Infobox Bauwerk}} page (Burg Wallenstein) is CLASSIFIED building and is
 *       NOT mis-handled as a settlement (building = separate Task 4c2); and
 *       settlement<->path/region are never cross-mishandled.
 *   (i) the TERRITORY handler (Task 4d) builds the political_territory_wiki_test
 *       SANDBOX record by REUSING the real avesmapsWikiSyncMonitorParsePage (which
 *       derives wiki_key via avesmapsPoliticalBuildWikiKey, type from Art, the
 *       |Staat=->affiliation via avesmapsWikiSyncMonitorParseAffiliation, and the
 *       BF-year founded_*_bf via avesmapsWikiSyncBuildPoliticalTemporalPayload):
 *       affiliation_root/affiliation_path_json for the SIMPLE, COLON-PATH and
 *       CONFLICT/independent |Staat= forms + founded_start_bf (=1050 for {{BF|1050}})
 *       are asserted with HAND-DERIVED values; the Myranor territory (Rastanreich) is
 *       FILTERED OUT; the (title,title)->wiki_key StoreAlias pair that feeds REBUILD's
 *       ResolveParentKey (I7) is proven coherent at the record level; a Siedlung/
 *       Bauwerk is NOT mis-handled as a territory; and territory<->other kinds are
 *       never cross-mishandled. NO geometry / wiki_territory_model / political_territory
 *       is touched (I3/I4); the DB StoreAlias/UpsertTestRecord live in the deferred
 *       persist this DB-free test never runs.
 *
 * NO database and NO STRATO are touched: the tested functions (classify / parse /
 * collect) are DB-free; the DB persist path (avesmapsWikiDumpPersistPathRecords /
 * avesmapsWikiDumpPersistTerritoryRecords / avesmapsWikiDumpRunPassBStep) is a separate
 * thin layer this test never calls.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring caveat as Task 1/3 -- the reused
 * derivation functions call mb_strtolower()/mb_substr()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-entities.php
 *
 * (A plain `php tools/wikidump/test-dump-entities.php` works iff mbstring is
 * enabled globally.) Exit code 0 iff every assert passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: the reused derivation functions need mbstring. Fail loudly.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the dump reader requires XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: dump-reader (page stream) + the real path lib it reuses +
//    that lib's own dependencies + the new Pass-B scaffold. All are
//    side-effect-free on include (const + function defs, no DB/headers). This
//    exact chain was found via TDD (paths.php needs Clean* from
//    territories-parsing.php, which needs a helper from territories-tree.php).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
// bootstrap.php defines avesmapsNormalizeSingleLine(), which the TERRITORY handler's
// reused avesmapsPoliticalNormalizeWikiRecord() needs (the path/region/settlement
// handlers never call it, so Tasks 4a-4c2 did not require it). Side-effect-free on
// include: it only defines the AVESMAPS_API_ROOT const (guarded) + functions -- no
// CORS/headers/DB run at include time (those are explicit function calls).
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
// sync-monitor.php require_once's sync-monitor-parsing.php (avesmapsWikiSyncMonitorParsePage),
// sync-monitor-licenses.php (avesmapsWikiSyncMonitorUpsertTestRecord) and
// sync-monitor-model.php (avesmapsWikiSyncMonitorStoreAlias) -- the three functions the
// TERRITORY handler (4d) reuses. All side-effect-free on include.
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
// territories.php defines avesmapsWikiSyncBuildPoliticalTemporalPayload (BF-year parse),
// which the TERRITORY handler's reused avesmapsWikiSyncMonitorParsePage calls. In
// production it is loaded by endpoint.php; the test loads it explicitly (4d). It
// require_once's the two territories-* siblings above (idempotent) and is
// side-effect-free on include.
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
// locations.php auto-requires locations-helpers.php (avesmapsWikiSyncUpsertPageCache /
// avesmapsWikiSyncSettlementClassFromPage / avesmapsWikiSyncGetCategoryNames /
// avesmapsWikiSyncExtractCoordinatesFromContent); settlements.php adds the reused
// ParseInfobox / BuildEnrichment the settlement handler calls (Task 4c).
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';

foreach ([
    // Pass-B scaffold under test:
    'avesmapsWikiDumpClassifyEntityKind',
    'avesmapsWikiDumpClassifyPage',
    'avesmapsWikiDumpExtractCategoryNames',
    'avesmapsWikiDumpParsePathPage',
    'avesmapsWikiDumpParseRegionPage',
    'avesmapsWikiDumpParseSettlementPage',
    'avesmapsWikiDumpParseBuildingPage',
    'avesmapsWikiDumpParseTerritoryPage',
    'avesmapsWikiDumpCollectEntities',
    'avesmapsWikiDumpCollectPathRecords',
    'avesmapsWikiDumpCollectRegionRecords',
    'avesmapsWikiDumpCollectSettlementRecords',
    'avesmapsWikiDumpCollectBuildingRecords',
    'avesmapsWikiDumpCollectTerritoryRecords',
    'avesmapsWikiDumpBuildApiPageFromDump',
    // reused real functions (must be visible so the handlers can call them):
    'avesmapsWikiPathParsePage',
    'avesmapsWikiPathUpsertRecord',
    'avesmapsWikiRegionParsePage',
    'avesmapsWikiRegionUpsertRecord',
    'avesmapsWikiRegionArtToSubtype',
    // reused settlement functions (Task 4c handler calls these -- must be visible):
    'avesmapsWikiSettlementParseInfobox',
    'avesmapsWikiSettlementBuildEnrichment',
    'avesmapsWikiSettlementMatchBuildingType',
    'avesmapsWikiSettlementClassLabel',
    'avesmapsWikiSyncSettlementClassFromPage',
    // reused TERRITORY functions (Task 4d handler calls these -- must be visible):
    'avesmapsWikiSyncMonitorParsePage',
    'avesmapsWikiSyncMonitorUpsertTestRecord',
    'avesmapsWikiSyncMonitorStoreAlias',
    'avesmapsWikiSyncMonitorParseAffiliation',
    'avesmapsPoliticalNormalizeWikiRecord',
    'avesmapsPoliticalBuildWikiKey',
    'avesmapsWikiSyncBuildPoliticalTemporalPayload',
    'avesmapsWikiSyncMonitorNormalizeTitle',
    'avesmapsWikiSyncGetCategoryNames',
    'avesmapsWikiSyncExtractCoordinatesFromContent',
    'avesmapsWikiSyncUpsertPageCache',
    'avesmapsWikiSyncMonitorInfoboxName',
    'avesmapsWikiSyncMonitorDetectContinent',
    'avesmapsWikiSyncCreateMatchKey',
    'avesmapsPoliticalSlug',
    // dump-reader page stream:
    'avesmapsWikiDumpOpenReader',
    'avesmapsWikiDumpIteratePages',
] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Diagnostic banner -- record the environment (the iconv umlaut behaviour is
//    what makes the key derivations environment-dependent; see Task 1's banner).
// ---------------------------------------------------------------------------
$iconvSample = function_exists('iconv')
    ? (static function (string $s): string {
        $r = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        return is_string($r) ? $r : '(iconv false)';
    })('Reichsstraße')
    : '(iconv unavailable)';

echo "================================================================\n";
echo " dump-reader Pass B unit test (WikiDump migration, Tasks 4a-4d)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'xmlreader loaded   : ' . (extension_loaded('xmlreader') ? 'yes' : 'no') . "\n";
echo "iconv('Reichsstrasse') = '{$iconvSample}'  (umlaut outcome is env-dependent)\n";
echo 'default continent  : ' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT . "\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-54s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-54s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// Helper: fully drain the page iterator into an array of page rows.
$readAll = static function (string $path): array {
    $reader = avesmapsWikiDumpOpenReader($path);
    $rows = [];
    foreach (avesmapsWikiDumpIteratePages($reader) as $page) {
        $rows[] = $page;
    }
    $reader->close();
    return $rows;
};

$pages = $readAll($fixturePath);
// Index the page rows by title for targeted per-page assertions.
$byTitle = [];
foreach ($pages as $p) {
    $byTitle[$p['title']] = $p;
}

// ===========================================================================
// (a) infobox-name ENUMERATION: classify each fixture page correctly.
// ===========================================================================
echo "-- (a) entity enumeration (infobox-presence classification, O4) --\n";

// Raw infobox-name -> entity kind (independent of ns/redirect gating).
$check(
    '(a1) Infobox Fluss -> path',
    'path',
    avesmapsWikiDumpClassifyEntityKind('Fluss'),
    'Fluss infobox is a PATH entity'
);
$check(
    '(a2) Infobox Straße -> path',
    'path',
    avesmapsWikiDumpClassifyEntityKind('Straße'),
    'Straße infobox is a PATH entity (key strasse)'
);
$check(
    '(a3) Infobox Staat -> territory (recognised, unhandled in 4a)',
    'territory',
    avesmapsWikiDumpClassifyEntityKind('Staat'),
    'Staat is recognised but NOT handled here'
);
$check(
    '(a4) Infobox Siedlung -> settlement (recognised, unhandled in 4a)',
    'settlement',
    avesmapsWikiDumpClassifyEntityKind('Siedlung'),
    'Siedlung is recognised but NOT handled here'
);
$check(
    '(a5) unknown/empty infobox -> "" (skip)',
    '',
    avesmapsWikiDumpClassifyEntityKind(''),
    'no infobox name -> no entity kind'
);

// Full page-level classification (ns + redirect gating applied):
$check(
    '(a6) page Breite classified as path',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Breite']),
    'ns0 non-redirect Fluss page -> path'
);
$check(
    '(a7) page Reichsstraße 1 classified as path',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Reichsstraße 1']),
    'ns0 non-redirect Straße page -> path'
);
$check(
    '(a8) page Kosch classified as territory (not path)',
    'territory',
    avesmapsWikiDumpClassifyPage($byTitle['Kosch']),
    'Staat page recognised as territory, not a path'
);
$check(
    '(a9) redirect page (Horasreich) skipped -> ""',
    '',
    avesmapsWikiDumpClassifyPage($byTitle['Horasreich']),
    'a redirect is a Pass-A alias, never an entity'
);
$check(
    '(a10) ns10 page (Vorlage:Infobox Staat) skipped -> ""',
    '',
    avesmapsWikiDumpClassifyPage($byTitle['Vorlage:Infobox Staat']),
    'non-Main namespace is not an entity even though it names an infobox'
);

// ===========================================================================
// (b) PATH handler: kept records + field mapping via the REAL functions.
//     Expected key values are HAND-DERIVED (see the derivation notes inline),
//     NOT asserted equal to the function's own output.
// ===========================================================================
echo "\n-- (b) path handler: staging records + real field/key mapping --\n";

$collected = avesmapsWikiDumpCollectEntities($pages);
// PATH-only kept records (the dedicated collector filters out regions/other kinds;
// $collected['records'] mixes path + region, so use the typed collector here so
// section (b) and $recByKey stay strictly about PATH staging records).
$records = avesmapsWikiDumpCollectPathRecords($pages);

// Two Aventurien path pages kept (Breite + Reichsstraße 1); the Myranor river
// (Rastullah-Strom) is filtered -> exactly 2 kept records.
$check(
    '(b1) exactly 2 Aventurien path records kept',
    2,
    count($records),
    'Breite + Reichsstraße 1 kept; Rastullah-Strom (Myranor) filtered out'
);

// Index kept records by wiki_key for targeted assertions.
$recByKey = [];
foreach ($records as $r) {
    $recByKey[(string) ($r['wiki_key'] ?? '')] = $r;
}

// -- Breite (Fluss). Hand-derivation via the REAL funcs (see Task 1 banner):
//    canonical 'Breite' -> avesmapsPoliticalSlug -> 'breite' (plain ASCII)
//    avesmapsWikiSyncCreateMatchKey('Breite') -> 'breite'
$breite = $recByKey['breite'] ?? null;
$check(
    '(b2) Breite record present under wiki_key "breite"',
    true,
    is_array($breite),
    "wiki_key = avesmapsPoliticalSlug('Breite') = 'breite'"
);
$check('(b3) Breite.name', 'Breite', (string) ($breite['name'] ?? '(none)'), 'Name field from the infobox');
$check('(b4) Breite.kind', 'fluss', (string) ($breite['kind'] ?? '(none)'), 'Infobox Fluss -> kind fluss');
$check('(b5) Breite.art', 'Fluss', (string) ($breite['art'] ?? '(none)'), 'Art field from the infobox');
$check('(b6) Breite.lage', 'Kosch, Mittelreich', (string) ($breite['lage'] ?? '(none)'), 'Regionen -> lage (links stripped to names)');
$check('(b7) Breite.laenge', '900 Meilen', (string) ($breite['laenge'] ?? '(none)'), 'Länge field from the infobox');
$check('(b8) Breite.verlauf', 'Angbar → Ferdok → Elenvina', (string) ($breite['verlauf'] ?? '(none)'), 'Verlauf stations joined with →');
$check(
    '(b9) Breite.match_key (real avesmapsWikiSyncCreateMatchKey)',
    'breite',
    (string) ($breite['match_key'] ?? '(none)'),
    "hand-derived: avesmapsWikiSyncCreateMatchKey('Breite') = 'breite'"
);
$check('(b10) Breite.continent', 'Aventurien', (string) ($breite['continent'] ?? '(none)'), 'DetectContinent default -> Aventurien');

// -- Reichsstraße 1 (Straße). This page is the KEY CONTRAST proving BOTH real
//    key funcs are used (not one substituted for the other):
//      wiki_key  = avesmapsPoliticalSlug('Reichsstraße 1') = 'reichsstrasse-1'  (space -> HYPHEN, ß -> ss)
//      match_key = avesmapsWikiSyncCreateMatchKey('Reichsstraße 1') = 'reichsstrasse1' (space VANISHES)
$strasse = $recByKey['reichsstrasse-1'] ?? null;
$check(
    '(b11) Reichsstraße 1 record present under wiki_key "reichsstrasse-1"',
    true,
    is_array($strasse),
    "wiki_key = avesmapsPoliticalSlug('Reichsstraße 1') = 'reichsstrasse-1' (space->hyphen)"
);
$check('(b12) Reichsstraße 1 .kind', 'strasse', (string) ($strasse['kind'] ?? '(none)'), 'Infobox Straße -> kind strasse');
$check('(b13) Reichsstraße 1 .art', 'Reichsstraße', (string) ($strasse['art'] ?? '(none)'), 'Art field from the infobox');
$check('(b14) Reichsstraße 1 .laenge', '400 Meilen', (string) ($strasse['laenge'] ?? '(none)'), 'Länge field from the infobox');
$check(
    '(b15) Reichsstraße 1 .match_key (VANISHING space, contrast wiki_key)',
    'reichsstrasse1',
    (string) ($strasse['match_key'] ?? '(none)'),
    "match_key drops the space ('reichsstrasse1') where wiki_key hyphenates it ('reichsstrasse-1')"
);
$check('(b16) Reichsstraße 1 .continent', 'Aventurien', (string) ($strasse['continent'] ?? '(none)'), 'no foreign-continent signal -> Aventurien default');

// Independent re-derivation cross-check: rebuild both keys via the real funcs and
// confirm the collected record used them (proves NOT a hard-coded literal, I1).
$reWikiKey = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Reichsstraße 1'));
$reMatchKey = avesmapsWikiSyncCreateMatchKey('Reichsstraße 1');
$check(
    '(b17) collected keys == independent real-function re-derivation',
    ['wiki_key' => $reWikiKey, 'match_key' => $reMatchKey],
    ['wiki_key' => (string) ($strasse['wiki_key'] ?? ''), 'match_key' => (string) ($strasse['match_key'] ?? '')],
    'record keys match avesmapsPoliticalSlug + avesmapsWikiSyncCreateMatchKey (I1)'
);

// ===========================================================================
// (c) continent filter: the Myranor river is FILTERED OUT of the records but
//     reported in the `filtered` bucket (so the drop is intentional, not a
//     parse failure). Hand-derivation: DetectContinent sees the category
//     "Fluss (Myranor)" + "{{Nav Staaten Myranor}}" -> "Myranor / Güldenland".
// ===========================================================================
echo "\n-- (c) continent filter (Aventurien only) --\n";

$check(
    '(c1) Rastullah-Strom NOT among kept records',
    false,
    array_key_exists('rastullah-strom', $recByKey),
    'a Myranor river is not staged (continent != Aventurien)'
);

$filteredTitles = array_map(static fn(array $f): string => $f['title'], $collected['filtered']);
$check(
    '(c2) Rastullah-Strom reported in the filtered bucket',
    true,
    in_array('Rastullah-Strom', $filteredTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);

// The pure handler on that page directly: parsed as a path, but not kept.
$rastullah = avesmapsWikiDumpParsePathPage($byTitle['Rastullah-Strom']);
$check(
    '(c3) Rastullah-Strom handler: kept=false',
    false,
    $rastullah['kept'],
    'handler decides keep=false for a non-Aventurien path'
);
$check(
    '(c4) Rastullah-Strom detected continent != Aventurien',
    true,
    $rastullah['continent'] !== '' && $rastullah['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$rastullah['continent']}' (Myranor), so it is filtered"
);
// And it WAS a genuine path record (record present) -- proves it was dropped by
// the CONTINENT filter, not rejected as a non-path.
$check(
    '(c5) Rastullah-Strom was a real path record before filtering',
    'fluss',
    (string) ($rastullah['record']['kind'] ?? '(none)'),
    'record exists with kind=fluss; only the continent filter removed it'
);

// ===========================================================================
// (d) a non-path infobox (Kosch / Staat) is NOT turned into a path record.
// ===========================================================================
echo "\n-- (d) non-path infobox is not mis-handled as a path --\n";

$koschAsPath = avesmapsWikiDumpParsePathPage($byTitle['Kosch']);
$check(
    '(d1) Kosch (Staat) path handler: kept=false, no record',
    true,
    $koschAsPath['kept'] === false && $koschAsPath['record'] === null,
    'ParsePage returns is_path=false for a Staat infobox -> no path record'
);
$check(
    '(d2) no Kosch record leaked into the kept path records',
    false,
    array_key_exists('kosch', $recByKey),
    'a territory infobox never yields a path staging record (O4/I2)'
);
// Kosch is recognised (and, since Task 4d, HANDLED) as a territory by the
// enumeration -- but the PATH handler still must not touch it (cross-handling guard).
$classifiedByTitle = [];
foreach ($collected['classified'] as $c) {
    $classifiedByTitle[$c['title']] = $c['kind'];
}
$check(
    '(d3) Kosch classified as territory, Burg Wallenstein as building',
    ['Kosch' => 'territory', 'Burg Wallenstein' => 'building'],
    ['Kosch' => $classifiedByTitle['Kosch'] ?? '(missing)', 'Burg Wallenstein' => $classifiedByTitle['Burg Wallenstein'] ?? '(missing)'],
    'Kosch classifies as territory (handled by the territory handler, section (i)); Burg Wallenstein classifies as building (its own handler, not the settlement one)'
);
$check(
    '(d4) per-kind counts: 3 paths, 5 territories, 5 settlements, 4 buildings, 3 regions recognised',
    ['path' => 3, 'territory' => 5, 'settlement' => 5, 'building' => 4, 'region' => 3],
    [
        'path' => $collected['counts']['path'] ?? 0,
        'territory' => $collected['counts']['territory'] ?? 0,
        'settlement' => $collected['counts']['settlement'] ?? 0,
        'building' => $collected['counts']['building'] ?? 0,
        'region' => $collected['counts']['region'] ?? 0,
    ],
    '3 path + 5 Staat infoboxes (Kosch, Grafschaft Ferdok, Baronie Hügelland, Sokramor, Rastanreich) + 5 Siedlung (Angbar, Ferdok, Auhof, Xarxaron, Selem) + 4 Bauwerk/Festung (Burg Wallenstein, Zwingfeste, Ruine Tsatempel, Xarsnamoth) + 3 region infoboxes'
);

// ===========================================================================
// (e) O4 sanity: category links do NOT drive classification (infobox does).
//     Rastullah-Strom carries [[Kategorie:Fluss (Myranor)]] yet is classified by
//     its INFOBOX (Fluss) as a path -- the category only shapes the continent.
// ===========================================================================
echo "\n-- (e) O4: enumeration is by infobox, categories only feed continent --\n";
$check(
    '(e1) category extraction reads the dump category link',
    'Fluss (Myranor)',
    avesmapsWikiDumpExtractCategoryNames($byTitle['Rastullah-Strom']['wikitext']),
    'dump-native category assembly (equiv. of the online category fetch)'
);
$check(
    '(e2) classification still uses the INFOBOX (path), not the category',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Rastullah-Strom']),
    'O4: infobox-presence decides the kind; the category only affects continent'
);

// ===========================================================================
// (f) REGION handler (Task 4b): mirrors the path handler. Kept Aventurien region
//     record via the REAL avesmapsWikiRegionParsePage() field/key mapping; the
//     Myranor region filtered by continent; the Landschaft variant classified as
//     region but faithfully rejected by the real parser (no record); and
//     path<->region never cross-mishandled. Expected keys are HAND-DERIVED via the
//     real functions (I1), never asserted equal to the handler's own output.
// ===========================================================================
echo "\n-- (f) region handler: staging record + real field/key mapping --\n";

// The DB-free region collector returns exactly the kept Aventurien region records.
$regionRecords = avesmapsWikiDumpCollectRegionRecords($pages);

// Two Aventurien {{Infobox Region}} pages exist (Koschberge kept; Rote Sichel is
// Myranor -> filtered); Windhag is {{Infobox Landschaft}} -> classified region but
// rejected by the real parser -> not a record. So exactly 1 kept region record.
$check(
    '(f1) exactly 1 Aventurien region record kept',
    1,
    count($regionRecords),
    'Koschberge kept; Rote Sichel (Myranor) filtered; Windhag (Landschaft) not accepted by the real parser'
);

// Index kept region records by wiki_key.
$regByKey = [];
foreach ($regionRecords as $r) {
    $regByKey[(string) ($r['wiki_key'] ?? '')] = $r;
}

// -- Koschberge (Infobox Region). Hand-derivation via the REAL funcs:
//    canonical 'Koschberge' -> avesmapsPoliticalSlug -> 'koschberge' (plain ASCII)
//    avesmapsWikiSyncCreateMatchKey('Koschberge') -> 'koschberge'
$kosch = $regByKey['koschberge'] ?? null;
$check(
    '(f2) Koschberge record present under wiki_key "koschberge"',
    true,
    is_array($kosch),
    "wiki_key = avesmapsPoliticalSlug('Koschberge') = 'koschberge'"
);
$check('(f3) Koschberge.name', 'Koschberge', (string) ($kosch['name'] ?? '(none)'), 'Name field from the Infobox Region');
$check('(f4) Koschberge.art', 'Gebirge', (string) ($kosch['art'] ?? '(none)'), 'Art field from the infobox');
$check('(f5) Koschberge.region_parent', 'Kosch', (string) ($kosch['region_parent'] ?? '(none)'), 'Region= -> region_parent (link stripped to name)');
$check('(f6) Koschberge.affiliation_staat', 'Mittelreich', (string) ($kosch['affiliation_staat'] ?? '(none)'), 'Staat= -> affiliation_staat');
$check('(f7) Koschberge.vegetation', 'Bergwald', (string) ($kosch['vegetation'] ?? '(none)'), 'Vegetationszonen= -> vegetation');
$check('(f8) Koschberge.verkehrswege', 'Reichsstraße 1', (string) ($kosch['verkehrswege'] ?? '(none)'), 'Verkehrswege= (link stripped to name)');
$check(
    '(f9) Koschberge.match_key (real avesmapsWikiSyncCreateMatchKey)',
    'koschberge',
    (string) ($kosch['match_key'] ?? '(none)'),
    "hand-derived: avesmapsWikiSyncCreateMatchKey('Koschberge') = 'koschberge'"
);
$check('(f10) Koschberge.continent', 'Aventurien', (string) ($kosch['continent'] ?? '(none)'), 'DetectContinent default -> Aventurien');

// art -> label_subtype path (the region-specific mapping the brief calls out):
//   avesmapsWikiRegionArtToSubtype('Gebirge') -> 'gebirge'
$check(
    '(f11) Koschberge art -> label_subtype path (real avesmapsWikiRegionArtToSubtype)',
    'gebirge',
    avesmapsWikiRegionArtToSubtype((string) ($kosch['art'] ?? '')),
    "hand-derived: avesmapsWikiRegionArtToSubtype('Gebirge') = 'gebirge'"
);

// Independent re-derivation cross-check: rebuild both keys via the real funcs and
// confirm the collected region record used them (proves NOT a literal, I1). NB the
// key CONTRAST also holds for regions (Rote Sichel below): slug hyphenates a space,
// match_key drops it -- same distinction the path handler proves for Reichsstraße 1.
$reRegWikiKey = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Koschberge'));
$reRegMatchKey = avesmapsWikiSyncCreateMatchKey('Koschberge');
$check(
    '(f12) collected region keys == independent real-function re-derivation',
    ['wiki_key' => $reRegWikiKey, 'match_key' => $reRegMatchKey],
    ['wiki_key' => (string) ($kosch['wiki_key'] ?? ''), 'match_key' => (string) ($kosch['match_key'] ?? '')],
    'record keys match avesmapsPoliticalSlug + avesmapsWikiSyncCreateMatchKey (I1)'
);

// -- Continent filter: the Myranor region (Rote Sichel) is FILTERED OUT of the
//    kept records but reported in the `filtered` bucket (intentional drop, not a
//    parse failure). Hand-derivation: DetectContinent sees "Gebirge (Myranor)" +
//    "{{Nav Staaten Myranor}}" -> "Myranor / Güldenland".
echo "\n-- (f/c) region continent filter (Aventurien only) --\n";

$collectedAll = avesmapsWikiDumpCollectEntities($pages);
$filteredRegionTitles = array_map(
    static fn(array $x): string => $x['title'],
    array_filter($collectedAll['filtered'], static fn(array $x): bool => ($x['kind'] ?? '') === 'region')
);
$check(
    '(f13) Rote Sichel NOT among kept region records',
    false,
    array_key_exists('rote-sichel', $regByKey),
    'a Myranor region is not staged (continent != Aventurien)'
);
$check(
    '(f14) Rote Sichel reported in the filtered bucket (as a region)',
    true,
    in_array('Rote Sichel', $filteredRegionTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);

// The pure handler on that page directly: parsed as a region, but not kept.
$roteSichel = avesmapsWikiDumpParseRegionPage($byTitle['Rote Sichel']);
$check(
    '(f15) Rote Sichel handler: kept=false',
    false,
    $roteSichel['kept'],
    'handler decides keep=false for a non-Aventurien region'
);
$check(
    '(f16) Rote Sichel detected continent != Aventurien',
    true,
    $roteSichel['continent'] !== '' && $roteSichel['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$roteSichel['continent']}' (Myranor), so it is filtered"
);
// And it WAS a genuine region record (record present) -- proves it was dropped by
// the CONTINENT filter, not rejected as a non-region. Also proves the region
// wiki_key/match_key CONTRAST: slug('Rote Sichel')='rote-sichel' (space->hyphen),
// match_key='rotesichel' (space vanishes).
$check(
    '(f17) Rote Sichel was a real region record before filtering (key contrast)',
    ['wiki_key' => 'rote-sichel', 'match_key' => 'rotesichel'],
    [
        'wiki_key' => (string) ($roteSichel['record']['wiki_key'] ?? '(none)'),
        'match_key' => (string) ($roteSichel['record']['match_key'] ?? '(none)'),
    ],
    'record exists (kind=region) with space->hyphen wiki_key vs vanishing-space match_key; only the continent filter removed it'
);

// -- Landschaft variant: classifies as region, but the real parser accepts only an
//    Infobox *Region* (its gate is str_contains(infoboxKey,'region')). So Windhag
//    is CLASSIFIED region yet yields NO record -- the handler faithfully reports the
//    real parser's is_region=false rather than re-implementing/loosening the gate.
echo "\n-- (f/L) Landschaft variant: classified region, real parser rejects --\n";
$check(
    '(f18) Windhag ({{Infobox Landschaft}}) classifies as region',
    'region',
    avesmapsWikiDumpClassifyPage($byTitle['Windhag']),
    'the classifier needle "landschaft" routes it to region kind'
);
$windhag = avesmapsWikiDumpParseRegionPage($byTitle['Windhag']);
$check(
    '(f19) Windhag region handler: kept=false, no record (real parser gate)',
    true,
    $windhag['kept'] === false && $windhag['record'] === null,
    'the real avesmapsWikiRegionParsePage accepts only Infobox Region -> no staging record'
);
$check(
    '(f20) Windhag NOT among kept region records',
    false,
    array_key_exists('windhag', $regByKey),
    'no record leaks for a Landschaft infobox (handler calls the real parse, not a loosened copy)'
);

// -- path <-> region are never cross-mishandled.
echo "\n-- (f/x) path <-> region are not cross-mishandled --\n";
// A region page fed to the PATH handler yields no path record...
$koschbergeAsPath = avesmapsWikiDumpParsePathPage($byTitle['Koschberge']);
$check(
    '(f21) Koschberge (region) via path handler: kept=false, no record',
    true,
    $koschbergeAsPath['kept'] === false && $koschbergeAsPath['record'] === null,
    'a region infobox never yields a path staging record'
);
// ...and a path page fed to the REGION handler yields no region record.
$breiteAsRegion = avesmapsWikiDumpParseRegionPage($byTitle['Breite']);
$check(
    '(f22) Breite (path) via region handler: kept=false, no record',
    true,
    $breiteAsRegion['kept'] === false && $breiteAsRegion['record'] === null,
    'a path infobox never yields a region staging record'
);
// Neither region key leaked into the kept PATH records, nor a path key into regions.
$check(
    '(f23) no region key leaked into kept path records (and vice versa)',
    true,
    !array_key_exists('koschberge', $recByKey) && !array_key_exists('breite', $regByKey),
    'kept path records exclude regions; kept region records exclude paths (O4/I2)'
);

// ===========================================================================
// (g) SETTLEMENT handler (Task 4c): builds a wiki_sync_pages registry record by
//     REUSING the real settlement parse/enrich/class/coordinate functions. Kept
//     Aventurien settlements with the REAL field/key mapping + parsed DereGlobus
//     coordinates (exact numbers) + is_ruined + NULL coat license (I5); the Myranor
//     settlement filtered; a Bauwerk page NOT mis-handled; and settlement<->path/
//     region never cross-mishandled. Expected keys are HAND-DERIVED via the real
//     functions (I1), never asserted equal to the handler's own output.
// ===========================================================================
echo "\n-- (g) settlement handler: registry record + real field/key mapping --\n";

// The DB-free settlement collector returns exactly the kept Aventurien settlement
// records. Kept: Angbar, Ferdok, Auhof, Xarxaron (Aventurien). Selem is Myranor ->
// filtered. Burg Wallenstein is {{Infobox Bauwerk}} -> classified building, not a
// settlement. So exactly 4 kept settlement records.
$settlementRecords = avesmapsWikiDumpCollectSettlementRecords($pages);
$check(
    '(g1) exactly 4 Aventurien settlement records kept',
    4,
    count($settlementRecords),
    'Angbar + Ferdok + Auhof + Xarxaron kept; Selem (Myranor) filtered; Burg Wallenstein is a building'
);

// Index kept settlement records by normalized_key (= CreateMatchKey(title)).
$setByKey = [];
foreach ($settlementRecords as $r) {
    $setByKey[(string) ($r['normalized_key'] ?? '')] = $r;
}

// -- Ferdok (Infobox Siedlung). Hand-derivation via the REAL funcs:
//    normalized_key = avesmapsWikiSyncCreateMatchKey('Ferdok') = 'ferdok'
//    wiki_key       = avesmapsPoliticalSlug('Ferdok')          = 'ferdok'
//    settlement_class from [[Kategorie:Mittelgroße Stadt]] -> 'stadt' (label 'Stadt')
//    coordinates from {{DereGlobus-Link|Länge(x)=520.5|Breite(y)=305.25}} -> x=520.5, y=305.25
//    coat_url from |Wappen={{Boximage|Wappen Ferdok.webp}} -> Spezial:Dateipfad file URL
$ferdok = $setByKey['ferdok'] ?? null;
$check(
    '(g2) Ferdok record present under normalized_key "ferdok"',
    true,
    is_array($ferdok),
    "normalized_key = avesmapsWikiSyncCreateMatchKey('Ferdok') = 'ferdok'"
);
$check('(g3) Ferdok.title', 'Ferdok', (string) ($ferdok['title'] ?? '(none)'), 'title from the page');
$check(
    '(g4) Ferdok.settlement_class = stadt (from class category)',
    'stadt',
    (string) ($ferdok['settlement_class'] ?? '(none)'),
    "[[Kategorie:Mittelgroße Stadt]] -> AVESMAPS_WIKI_CATEGORY_TO_CLASS -> 'stadt'"
);
$check(
    '(g5) Ferdok.settlement_label = Stadt',
    'Stadt',
    (string) ($ferdok['settlement_label'] ?? '(none)'),
    "class 'stadt' -> label 'Stadt' (real avesmapsWikiSyncLocationSubtypeLabel)"
);
$check(
    '(g6) Ferdok.wiki_key (real avesmapsPoliticalSlug)',
    'ferdok',
    (string) ($ferdok['wiki_key'] ?? '(none)'),
    "hand-derived: avesmapsPoliticalSlug('Ferdok') = 'ferdok'"
);
$check(
    '(g7) Ferdok.wiki_url',
    'https://de.wiki-aventurica.de/wiki/Ferdok',
    (string) ($ferdok['wiki_url'] ?? '(none)'),
    'reused avesmapsWikiSyncMonitorPageUrl(title)'
);
// EXACT parsed DereGlobus coordinates (the coordinate-parsing proof).
$check(
    '(g8) Ferdok.coordinates_json (exact DereGlobus x/y)',
    ['source' => 'dereglobus', 'x' => 520.5, 'y' => 305.25],
    $ferdok['coordinates_json'] ?? null,
    "avesmapsWikiSyncExtractCoordinatesFromContent parsed Länge(x)=520.5, Breite(y)=305.25"
);
$check('(g9) Ferdok.continent', 'Aventurien', (string) ($ferdok['continent'] ?? '(none)'), 'real DetectContinent default -> Aventurien');
$check(
    '(g10) Ferdok.coat_url (filename extracted from Boximage)',
    'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Ferdok.webp',
    (string) ($ferdok['coat_url'] ?? '(none)'),
    'reused avesmapsWikiSyncMonitorCoatOfArmsUrl -> Spezial:Dateipfad file URL'
);
// I5: the dump has no file-license metadata -> all coat license columns NULL.
// Assert BOTH that all four keys exist (present in the record) AND that each holds a
// strict null (array_key_exists, not ??, so an explicit null is not read as "absent").
$coatLicenseState = [
    'all_keys_present' => is_array($ferdok)
        && array_key_exists('coat_license_status', $ferdok)
        && array_key_exists('coat_author', $ferdok)
        && array_key_exists('coat_attribution', $ferdok)
        && array_key_exists('coat_license_url', $ferdok),
    'all_strict_null' => is_array($ferdok)
        && $ferdok['coat_license_status'] === null
        && $ferdok['coat_author'] === null
        && $ferdok['coat_attribution'] === null
        && $ferdok['coat_license_url'] === null,
];
$check(
    '(g11) Ferdok coat license columns present and strictly NULL (I5)',
    ['all_keys_present' => true, 'all_strict_null' => true],
    $coatLicenseState,
    'dump carries no license metadata -> the 4 coat_license_* keys exist and are strictly NULL, never invented (coat_url filename is fine)'
);
$check('(g12) Ferdok.is_ruined false', false, (bool) ($ferdok['is_ruined'] ?? true), 'Siedlungsart=Stadt is not a ruin');
// categories_json filled from the dump's literal [[Kategorie:]] links.
$check(
    '(g13) Ferdok.categories_json from dump literal categories',
    ['Mittelgroße Stadt', 'Kosch'],
    $ferdok['categories_json'] ?? null,
    'reused avesmapsWikiSyncGetCategoryNames over the reconstructed API page'
);

// Independent re-derivation cross-check (proves NOT a hard-coded literal, I1):
$reSetKey = avesmapsWikiSyncCreateMatchKey('Ferdok');
$reSetWikiKey = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Ferdok'));
$check(
    '(g14) collected settlement keys == independent real-function re-derivation',
    ['normalized_key' => $reSetKey, 'wiki_key' => $reSetWikiKey],
    ['normalized_key' => (string) ($ferdok['normalized_key'] ?? ''), 'wiki_key' => (string) ($ferdok['wiki_key'] ?? '')],
    'record keys match avesmapsWikiSyncCreateMatchKey + avesmapsPoliticalSlug (I1)'
);

// -- Auhof (Dorf): class from [[Kategorie:Dorf]] -> 'dorf'.
$auhof = $setByKey['auhof'] ?? null;
$check(
    '(g15) Auhof.settlement_class = dorf (from [[Kategorie:Dorf]])',
    'dorf',
    (string) ($auhof['settlement_class'] ?? '(none)'),
    "AVESMAPS_WIKI_CATEGORY_TO_CLASS['Dorf'] = 'dorf'"
);
$check(
    '(g16) Auhof.coordinates_json = none (no DereGlobus/Positionskarte)',
    ['source' => 'none', 'x' => null, 'y' => null],
    $auhof['coordinates_json'] ?? null,
    'no coordinate block -> reused extractor returns source=none'
);

// -- Xarxaron (Ruine): no class category -> 'dorf' fallback; is_ruined=true.
$xarxaron = $setByKey['xarxaron'] ?? null;
$check(
    '(g17) Xarxaron.is_ruined = true (Siedlungsart=Ruine)',
    true,
    (bool) ($xarxaron['is_ruined'] ?? false),
    'reused avesmapsWikiSettlementBuildEnrichment reads Siedlungsart ruine -> is_ruined'
);
$check(
    '(g18) Xarxaron.settlement_class = dorf (no class category -> fallback)',
    'dorf',
    (string) ($xarxaron['settlement_class'] ?? '(none)'),
    "[[Kategorie:Ruine]] is not a class category -> ParseInfobox 'dorf' fallback"
);

// -- Angbar: pre-existing Siedlung page, no class category -> 'dorf' fallback, no coords.
$angbar = $setByKey['angbar'] ?? null;
$check(
    '(g19) Angbar kept as settlement, class dorf (no class category)',
    ['present' => true, 'class' => 'dorf'],
    ['present' => is_array($angbar), 'class' => (string) ($angbar['settlement_class'] ?? '(none)')],
    'a Siedlung page with no class category falls back to dorf; Aventurien default -> kept'
);

// -- Continent filter: the Myranor settlement (Selem) is FILTERED OUT of the kept
//    records but reported in the `filtered` bucket (intentional drop, not a parse miss).
echo "\n-- (g/c) settlement continent filter (Aventurien only) --\n";
$check(
    '(g20) Selem NOT among kept settlement records',
    false,
    array_key_exists('selem', $setByKey),
    'a Myranor settlement is not staged (continent != Aventurien)'
);
$filteredSettlementTitles = array_map(
    static fn(array $x): string => $x['title'],
    array_filter($collected['filtered'], static fn(array $x): bool => ($x['kind'] ?? '') === 'settlement')
);
$check(
    '(g21) Selem reported in the filtered bucket (as a settlement)',
    true,
    in_array('Selem', $filteredSettlementTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);
$selem = avesmapsWikiDumpParseSettlementPage($byTitle['Selem']);
$check(
    '(g22) Selem handler: kept=false but record present (real record, continent-dropped)',
    true,
    $selem['kept'] === false && is_array($selem['record']) && $selem['continent'] !== '' && $selem['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$selem['continent']}' (Myranor); record exists, only the continent filter removed it"
);

// -- A {{Infobox Bauwerk}} page is CLASSIFIED building and NOT mis-handled as a
//    settlement (building = separate Task 4c2 -> recognised-but-unhandled here).
echo "\n-- (g/b) building infobox is not mis-handled as a settlement --\n";
$check(
    '(g23) Burg Wallenstein ({{Infobox Bauwerk}}) classifies as building',
    'building',
    avesmapsWikiDumpClassifyPage($byTitle['Burg Wallenstein']),
    'the classifier needle "burg" routes it to building kind (checked before settlement)'
);
$burgAsSettlement = avesmapsWikiDumpParseSettlementPage($byTitle['Burg Wallenstein']);
$check(
    '(g24) Burg Wallenstein via settlement handler: kept=false, no record',
    true,
    $burgAsSettlement['kept'] === false && $burgAsSettlement['record'] === null,
    'the settlement handler gate rejects a non-settlement infobox -> no registry record'
);
$check(
    '(g25) Burg Wallenstein NOT among kept settlement records',
    false,
    array_key_exists(avesmapsWikiSyncCreateMatchKey('Burg Wallenstein'), $setByKey),
    'a building infobox never yields a settlement registry record (building handler is out of scope)'
);

// -- settlement <-> path/region are never cross-mishandled.
echo "\n-- (g/x) settlement <-> path/region are not cross-mishandled --\n";
$breiteAsSettlement = avesmapsWikiDumpParseSettlementPage($byTitle['Breite']);
$check(
    '(g26) Breite (path) via settlement handler: kept=false, no record',
    true,
    $breiteAsSettlement['kept'] === false && $breiteAsSettlement['record'] === null,
    'a path infobox never yields a settlement registry record'
);
$koschbergeAsSettlement = avesmapsWikiDumpParseSettlementPage($byTitle['Koschberge']);
$check(
    '(g27) Koschberge (region) via settlement handler: kept=false, no record',
    true,
    $koschbergeAsSettlement['kept'] === false && $koschbergeAsSettlement['record'] === null,
    'a region infobox never yields a settlement registry record'
);
$ferdokAsPath = avesmapsWikiDumpParsePathPage($byTitle['Ferdok']);
$ferdokAsRegion = avesmapsWikiDumpParseRegionPage($byTitle['Ferdok']);
$check(
    '(g28) Ferdok (settlement) via path AND region handlers: no record',
    true,
    $ferdokAsPath['record'] === null && $ferdokAsRegion['record'] === null,
    'a settlement infobox never yields a path or region record (O4/I2)'
);

// ===========================================================================
// (h) BUILDING handler (Task 4c2): the SIMPLEST entity. Builds a wiki_sync_pages
//     record with settlement_class='gebaeude', the existing gebaeude label, a
//     building_type derived from the page's literal [[Kategorie:]] links matched
//     against the REUSED legacy type list (avesmapsWikiSettlementMatchBuildingType),
//     with the infobox Art as fallback, plus is_ruined (reused Art-based detection
//     via avesmapsWikiSettlementBuildEnrichment, OR the building_type contains
//     "ruine"), keyed off the title (normalized_key = CreateMatchKey(title),
//     wiki_key = slug(title)). Aventurien-only. NO map_features / case flow (I2).
//     Expected values are HAND-DERIVED via the real functions (I1).
// ===========================================================================
echo "\n-- (h) building handler: gebaeude record + reused type list + is_ruined --\n";

// The DB-free building collector returns exactly the kept Aventurien building
// records. Kept: Burg Wallenstein (Art=Burg), Zwingfeste Ochsenblut (Kat=Festung),
// Ruine Tsatempel (Art=Ruine). Xarsnamoth is Myranor -> filtered. So exactly 3.
$buildingRecords = avesmapsWikiDumpCollectBuildingRecords($pages);
$check(
    '(h1) exactly 3 Aventurien building records kept',
    3,
    count($buildingRecords),
    'Burg Wallenstein + Zwingfeste Ochsenblut + Ruine Tsatempel kept; Xarsnamoth (Myranor) filtered'
);

// Index kept building records by normalized_key (= CreateMatchKey(title)).
$bldByKey = [];
foreach ($buildingRecords as $r) {
    $bldByKey[(string) ($r['normalized_key'] ?? '')] = $r;
}

// -- Zwingfeste Ochsenblut ({{Infobox Festung}}, [[Kategorie:Festung]]). Hand-derived:
//    normalized_key = avesmapsWikiSyncCreateMatchKey('Zwingfeste Ochsenblut') = 'zwingfesteochsenblut'
//    wiki_key       = avesmapsPoliticalSlug('Zwingfeste Ochsenblut')          = 'zwingfeste-ochsenblut'
//    building_type  = avesmapsWikiSettlementMatchBuildingType(['Festung','Kosch']) = 'Festung' (from CATEGORY)
//    is_ruined      = false ; settlement_class = 'gebaeude' ; label 'Besondere Bauwerke/Stätten'
$zwing = $bldByKey['zwingfesteochsenblut'] ?? null;
$check(
    '(h2) Zwingfeste record present under normalized_key "zwingfesteochsenblut"',
    true,
    is_array($zwing),
    "normalized_key = avesmapsWikiSyncCreateMatchKey('Zwingfeste Ochsenblut') = 'zwingfesteochsenblut'"
);
$check('(h3) Zwingfeste.title', 'Zwingfeste Ochsenblut', (string) ($zwing['title'] ?? '(none)'), 'title from the page');
$check(
    '(h4) Zwingfeste.settlement_class = gebaeude',
    'gebaeude',
    (string) ($zwing['settlement_class'] ?? '(none)'),
    'a building is surfaced as gebaeude (like the online building crawler)'
);
$check(
    '(h5) Zwingfeste.settlement_label = Besondere Bauwerke/Stätten (reused constant)',
    avesmapsWikiSettlementClassLabel('gebaeude'),
    (string) ($zwing['settlement_label'] ?? '(none)'),
    "reused avesmapsWikiSettlementClassLabel('gebaeude')"
);
$check(
    '(h6) Zwingfeste.building_type = Festung (from literal category, reused type list)',
    'Festung',
    (string) ($zwing['building_type'] ?? '(none)'),
    "avesmapsWikiSettlementMatchBuildingType(['Festung','Kosch']) -> 'Festung' (CATEGORY-derived)"
);
$check('(h7) Zwingfeste.is_ruined = false', false, (bool) ($zwing['is_ruined'] ?? true), 'Festung is not a ruin');
$check(
    '(h8) Zwingfeste.wiki_key (real avesmapsPoliticalSlug)',
    'zwingfeste-ochsenblut',
    (string) ($zwing['wiki_key'] ?? '(none)'),
    "hand-derived: avesmapsPoliticalSlug('Zwingfeste Ochsenblut') = 'zwingfeste-ochsenblut' (space->hyphen)"
);
$check(
    '(h9) Zwingfeste.wiki_url (reused avesmapsWikiSyncMonitorPageUrl)',
    'https://de.wiki-aventurica.de/wiki/Zwingfeste_Ochsenblut',
    (string) ($zwing['wiki_url'] ?? '(none)'),
    'reused avesmapsWikiSyncMonitorPageUrl(title) (space->underscore)'
);
$check('(h10) Zwingfeste.continent = Aventurien', 'Aventurien', (string) ($zwing['continent'] ?? '(none)'), 'reused DetectContinent default -> Aventurien');
$check(
    '(h11) Zwingfeste.categories_json from dump literal categories',
    ['Festung', 'Kosch'],
    $zwing['categories_json'] ?? null,
    'reused avesmapsWikiSyncGetCategoryNames over the reconstructed API page (literal links, I6)'
);

// Independent re-derivation cross-check (proves NOT a hard-coded literal, I1):
$reBldKey = avesmapsWikiSyncCreateMatchKey('Zwingfeste Ochsenblut');
$reBldWikiKey = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Zwingfeste Ochsenblut'));
$check(
    '(h12) collected building keys == independent real-function re-derivation',
    ['normalized_key' => $reBldKey, 'wiki_key' => $reBldWikiKey],
    ['normalized_key' => (string) ($zwing['normalized_key'] ?? ''), 'wiki_key' => (string) ($zwing['wiki_key'] ?? '')],
    'record keys match avesmapsWikiSyncCreateMatchKey + avesmapsPoliticalSlug (I1)'
);

// -- Ruine Tsatempel ({{Infobox Bauwerk}}, Art=Ruine, [[Kategorie:Ruine]]). Proves BOTH
//    that a category matching the type list yields building_type='Ruine' AND that
//    is_ruined is detected (Art=Ruine via the reused BuildEnrichment; the type also
//    contains "ruine"). Hand-derived normalized_key = 'ruinetsatempel'.
$ruine = $bldByKey['ruinetsatempel'] ?? null;
$check(
    '(h13) Ruine Tsatempel record present under normalized_key "ruinetsatempel"',
    true,
    is_array($ruine),
    "normalized_key = avesmapsWikiSyncCreateMatchKey('Ruine Tsatempel') = 'ruinetsatempel'"
);
$check(
    '(h14) Ruine Tsatempel.building_type = Ruine (from literal category, reused type list)',
    'Ruine',
    (string) ($ruine['building_type'] ?? '(none)'),
    "avesmapsWikiSettlementMatchBuildingType(['Ruine','Kosch']) -> 'Ruine'"
);
$check(
    '(h15) Ruine Tsatempel.is_ruined = true (reused Art-based detection)',
    true,
    (bool) ($ruine['is_ruined'] ?? false),
    'reused avesmapsWikiSettlementBuildEnrichment reads Art=Ruine -> is_ruined (type also contains "ruine")'
);
$check('(h16) Ruine Tsatempel.settlement_class = gebaeude', 'gebaeude', (string) ($ruine['settlement_class'] ?? '(none)'), 'building surfaced as gebaeude');
$check('(h17) Ruine Tsatempel.continent = Aventurien', 'Aventurien', (string) ($ruine['continent'] ?? '(none)'), 'reused DetectContinent -> Aventurien');

// -- Burg Wallenstein ({{Infobox Bauwerk}}, Art=Burg, [[Kategorie:Burg]]). THE online-vs-dump
//    divergence proof: "Burg" is NOT in the legacy type list, so the literal-category match
//    returns '' and building_type falls back to the infobox Art = 'Burg'. (Online, the crawler
//    would have recorded building_type from the crawled CATEGORY name "Burg" -- same value, but
//    via a category enumeration the dump lacks. Documented as the A4 watch-item.)
$burg = $bldByKey['burgwallenstein'] ?? null;
$check(
    '(h18) Burg Wallenstein record present under normalized_key "burgwallenstein"',
    true,
    is_array($burg),
    "activating the handler stages the previously recognised-but-unhandled Bauwerk page"
);
$check(
    '(h19) Burg Wallenstein.building_type = Burg (Art fallback; "Burg" not in the reused type list)',
    'Burg',
    (string) ($burg['building_type'] ?? '(none)'),
    "MatchBuildingType(['Burg']) = '' -> Art fallback 'Burg' (online-vs-dump divergence, A4 watch-item)"
);
$check('(h20) Burg Wallenstein.settlement_class = gebaeude', 'gebaeude', (string) ($burg['settlement_class'] ?? '(none)'), 'building surfaced as gebaeude');
$check('(h21) Burg Wallenstein.is_ruined = false', false, (bool) ($burg['is_ruined'] ?? true), 'Art=Burg is not a ruin (no ruine/zerstor)');

// I5 (coat license): buildings carry no file-license metadata -> the 4 coat_license_* keys
// exist and are strictly NULL, never invented (mirrors the settlement handler's I5 handling).
$bldCoatState = [
    'all_keys_present' => is_array($zwing)
        && array_key_exists('coat_license_status', $zwing)
        && array_key_exists('coat_author', $zwing)
        && array_key_exists('coat_attribution', $zwing)
        && array_key_exists('coat_license_url', $zwing),
    'all_strict_null' => is_array($zwing)
        && $zwing['coat_license_status'] === null
        && $zwing['coat_author'] === null
        && $zwing['coat_attribution'] === null
        && $zwing['coat_license_url'] === null,
];
$check(
    '(h22) building coat license columns present and strictly NULL (I5)',
    ['all_keys_present' => true, 'all_strict_null' => true],
    $bldCoatState,
    'dump carries no license metadata -> the 4 coat_license_* keys exist and are strictly NULL (I5)'
);

// -- Continent filter: the Myranor building (Xarsnamoth) is FILTERED OUT of the kept
//    records but reported in the `filtered` bucket (intentional drop, not a parse miss).
echo "\n-- (h/c) building continent filter (Aventurien only) --\n";
$check(
    '(h23) Xarsnamoth NOT among kept building records',
    false,
    array_key_exists(avesmapsWikiSyncCreateMatchKey('Xarsnamoth'), $bldByKey),
    'a Myranor building is not staged (continent != Aventurien)'
);
$filteredBuildingTitles = array_map(
    static fn(array $x): string => $x['title'],
    array_filter($collected['filtered'], static fn(array $x): bool => ($x['kind'] ?? '') === 'building')
);
$check(
    '(h24) Xarsnamoth reported in the filtered bucket (as a building)',
    true,
    in_array('Xarsnamoth', $filteredBuildingTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);
$xarsnamoth = avesmapsWikiDumpParseBuildingPage($byTitle['Xarsnamoth']);
$check(
    '(h25) Xarsnamoth handler: kept=false but record present (real record, continent-dropped)',
    true,
    $xarsnamoth['kept'] === false && is_array($xarsnamoth['record']) && $xarsnamoth['continent'] !== '' && $xarsnamoth['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$xarsnamoth['continent']}' (Myranor); record exists, only the continent filter removed it"
);

// -- Cross-handling: a building is NOT mis-handled by settlement/path/region, and a
//    settlement/path/region infobox is NOT mis-handled as a building.
echo "\n-- (h/x) building <-> settlement/path/region are not cross-mishandled --\n";
$zwingAsSettlement = avesmapsWikiDumpParseSettlementPage($byTitle['Zwingfeste Ochsenblut']);
$zwingAsPath = avesmapsWikiDumpParsePathPage($byTitle['Zwingfeste Ochsenblut']);
$zwingAsRegion = avesmapsWikiDumpParseRegionPage($byTitle['Zwingfeste Ochsenblut']);
$check(
    '(h26) Zwingfeste (building) via settlement/path/region handlers: no record',
    true,
    $zwingAsSettlement['record'] === null && $zwingAsPath['record'] === null && $zwingAsRegion['record'] === null,
    'a building infobox never yields a settlement/path/region record (O4/I2)'
);
$ferdokAsBuilding = avesmapsWikiDumpParseBuildingPage($byTitle['Ferdok']);
$breiteAsBuilding = avesmapsWikiDumpParseBuildingPage($byTitle['Breite']);
$koschbergeAsBuilding = avesmapsWikiDumpParseBuildingPage($byTitle['Koschberge']);
$check(
    '(h27) settlement/path/region pages via building handler: kept=false, no record',
    true,
    $ferdokAsBuilding['kept'] === false && $ferdokAsBuilding['record'] === null
        && $breiteAsBuilding['kept'] === false && $breiteAsBuilding['record'] === null
        && $koschbergeAsBuilding['kept'] === false && $koschbergeAsBuilding['record'] === null,
    'the building handler gate rejects non-building infoboxes -> no gebaeude record'
);
$check(
    '(h28) no building key leaked into kept settlement records (and vice versa)',
    true,
    !array_key_exists('zwingfesteochsenblut', $setByKey)
        && !array_key_exists('ruinetsatempel', $setByKey)
        && !array_key_exists('ferdok', $bldByKey),
    'kept settlement records exclude buildings; kept building records exclude settlements (O4/I2)'
);

// ===========================================================================
// (i) TERRITORY handler (Task 4d): the highest-risk entity (hierarchy + wiki_key),
//     but a clean reuse. Builds the political_territory_wiki_test SANDBOX record by
//     REUSING the real avesmapsWikiSyncMonitorParsePage() verbatim -- NO field
//     mapping, key derivation or |Staat=->affiliation parse is duplicated here (I1).
//     Inside that reused parse:
//       - wiki_key             = avesmapsPoliticalBuildWikiKey(wiki_url, name) -> 'wiki:'.slug
//       - type                 <- Art field
//       - affiliation_root / affiliation_path_json <- avesmapsWikiSyncMonitorParseAffiliation(|Staat=)
//       - founded_*_bf         <- avesmapsWikiSyncBuildPoliticalTemporalPayload({{BF|...}})
//     The record is Aventurien-filtered (real DetectContinent verdict) exactly like the
//     other handlers. Expected values are HAND-DERIVED via the real functions (see the
//     scratchpad derivation), never asserted equal to the handler's own output.
//
//     I3 (geometry untouched): the handler/collector read/write NO geometry.
//     I4/I7: the collector NEVER writes wiki_territory_model / political_territory; the
//     StoreAlias (title,title)->wiki_key pairs that feed REBUILD's ResolveParentKey are
//     asserted at the record level below (the DB StoreAlias call lives in the deferred
//     persist, which this DB-free test never runs).
// ===========================================================================
echo "\n-- (i) territory handler: sandbox record + real affiliation/key/temporal --\n";

// The DB-free territory collector returns exactly the kept Aventurien territory
// records. Kept: Kosch (Zugehörigkeit=, empty affiliation), Grafschaft Ferdok (simple),
// Baronie Hügelland (colon-path), Sokramor (conflict/independent). Rastanreich is
// Myranor -> filtered. So exactly 4 kept territory records.
$territoryRecords = avesmapsWikiDumpCollectTerritoryRecords($pages);
$check(
    '(i1) exactly 4 Aventurien territory records kept',
    4,
    count($territoryRecords),
    'Kosch + Grafschaft Ferdok + Baronie Hügelland + Sokramor kept; Rastanreich (Myranor) filtered'
);

// Index kept territory records by wiki_key.
$terByKey = [];
foreach ($territoryRecords as $r) {
    $terByKey[(string) ($r['wiki_key'] ?? '')] = $r;
}

// -- Grafschaft Ferdok (SIMPLE affiliation |Staat=[[Mittelreich]], founded {{BF|1050}}).
//    Hand-derived via the REAL funcs:
//      wiki_url  = avesmapsWikiSyncMonitorPageUrl('Grafschaft Ferdok') = .../wiki/Grafschaft_Ferdok
//      wiki_key  = avesmapsPoliticalBuildWikiKey(wiki_url, name)       = 'wiki:grafschaft-ferdok'
//      type      = 'Grafschaft' (Art)
//      affiliation_root='Mittelreich', affiliation_path_json=['Mittelreich']
//      founded_start_bf = 1050 (temporal payload from {{BF|1050}})
$graf = $terByKey['wiki:grafschaft-ferdok'] ?? null;
$check(
    '(i2) Grafschaft Ferdok present under wiki_key "wiki:grafschaft-ferdok"',
    true,
    is_array($graf),
    "wiki_key = avesmapsPoliticalBuildWikiKey(pageUrl, name) = 'wiki:grafschaft-ferdok'"
);
$check('(i3) Grafschaft Ferdok.name', 'Grafschaft Ferdok', (string) ($graf['name'] ?? '(none)'), 'Name field from the Infobox Staat');
$check('(i4) Grafschaft Ferdok.type', 'Grafschaft', (string) ($graf['type'] ?? '(none)'), 'Art= -> type (real NormalizeWikiRecord)');
$check('(i5) Grafschaft Ferdok.continent', 'Aventurien', (string) ($graf['continent'] ?? '(none)'), 'real DetectContinent default -> Aventurien');
$check(
    '(i6) Grafschaft Ferdok.affiliation_root = Mittelreich (SIMPLE form)',
    'Mittelreich',
    (string) ($graf['affiliation_root'] ?? '(none)'),
    "|Staat=[[Mittelreich]] -> ParseAffiliation root 'Mittelreich'"
);
$check(
    '(i7) Grafschaft Ferdok.affiliation_path_json = [Mittelreich] (SIMPLE form)',
    ['Mittelreich'],
    $graf['affiliation_path_json'] ?? null,
    "single-parent path (no ':' chain)"
);
$check(
    '(i8) Grafschaft Ferdok.founded_start_bf = 1050 ({{BF|1050}})',
    1050,
    (int) ($graf['founded_start_bf'] ?? -1),
    'reused avesmapsWikiSyncBuildPoliticalTemporalPayload parsed {{BF|1050}} -> 1050'
);
$check(
    '(i9) Grafschaft Ferdok.founded_type = exact ({{BF|1050}})',
    'exact',
    (string) ($graf['founded_type'] ?? '(none)'),
    'a single BF year is an exact founding date'
);

// Independent re-derivation cross-check: rebuild the wiki_key via the real funcs and
// confirm the collected record used it (proves NOT a hard-coded literal, I1).
$reTerWikiKey = avesmapsPoliticalBuildWikiKey(
    avesmapsWikiSyncMonitorPageUrl('Grafschaft Ferdok'),
    'Grafschaft Ferdok'
);
$check(
    '(i10) collected territory wiki_key == independent real-function re-derivation',
    $reTerWikiKey,
    (string) ($graf['wiki_key'] ?? ''),
    'record wiki_key matches avesmapsPoliticalBuildWikiKey(pageUrl, name) (I1)'
);

// -- Baronie Hügelland (COLON-PATH |Staat=[[Grafschaft Ferdok]]: [[Mittelreich]]).
//    Hand-derived: affiliation splits on ':' -> path ['Grafschaft Ferdok','Mittelreich'],
//    root 'Grafschaft Ferdok'; wiki_key 'wiki:baronie-h-ugelland' (umlaut ü -> '-u' via
//    iconv, env-dependent -- the same env this test's other umlaut keys rely on).
$baronie = $terByKey['wiki:baronie-h-ugelland'] ?? null;
$check(
    '(i11) Baronie Hügelland present under wiki_key "wiki:baronie-h-ugelland"',
    true,
    is_array($baronie),
    "wiki_key = 'wiki:'.slug('Baronie Hügelland') = 'wiki:baronie-h-ugelland' (umlaut -> '-u')"
);
$check('(i12) Baronie Hügelland.type', 'Baronie', (string) ($baronie['type'] ?? '(none)'), 'Art= -> type');
$check(
    '(i13) Baronie Hügelland.affiliation_root = Grafschaft Ferdok (COLON-PATH form)',
    'Grafschaft Ferdok',
    (string) ($baronie['affiliation_root'] ?? '(none)'),
    "|Staat=[[Grafschaft Ferdok]]: [[Mittelreich]] -> root is the FIRST ':' segment"
);
$check(
    '(i14) Baronie Hügelland.affiliation_path_json = [Grafschaft Ferdok, Mittelreich] (COLON-PATH)',
    ['Grafschaft Ferdok', 'Mittelreich'],
    $baronie['affiliation_path_json'] ?? null,
    "the ':' chain becomes a two-element affiliation path (real ParseAffiliation)"
);

// -- Sokramor (CONFLICT/INDEPENDENT |Staat=(beansprucht von: [[Horasreich]], [[Mittelreich]])).
//    Hand-derived: the parenthetical claim yields conflicts ['Horasreich','Mittelreich'],
//    NO primary parent -> empty path, empty root, independent=true. The record still
//    carries the claimants in raw_json.affiliation.conflicts (for the editor's
//    contested-territory handling), but affiliation_path_json is [] (no parent chain).
$sokramor = $terByKey['wiki:sokramor'] ?? null;
$check(
    '(i15) Sokramor present under wiki_key "wiki:sokramor"',
    true,
    is_array($sokramor),
    "wiki_key = 'wiki:sokramor'"
);
$check(
    '(i16) Sokramor.affiliation_path_json = [] (CONFLICT -> no parent chain)',
    [],
    $sokramor['affiliation_path_json'] ?? '(none)',
    "'(beansprucht von: ...)' produces conflicts, not a primary parent -> empty path"
);
$check(
    '(i17) Sokramor.affiliation_root = "" (CONFLICT -> independent)',
    '',
    (string) ($sokramor['affiliation_root'] ?? '(none)'),
    'no primary parent -> empty root'
);
// The conflicts + independent flag survive in the raw_json affiliation payload.
$sokramorAffiliation = $sokramor['raw_json']['affiliation'] ?? [];
$check(
    '(i18) Sokramor conflicts = [Horasreich, Mittelreich], independent=true (raw_json)',
    ['conflicts' => ['Horasreich', 'Mittelreich'], 'independent' => true],
    [
        'conflicts' => $sokramorAffiliation['conflicts'] ?? '(missing)',
        'independent' => $sokramorAffiliation['independent'] ?? '(missing)',
    ],
    'the claimants are captured as conflicts and the territory is flagged independent'
);

// -- Kosch (the PRE-EXISTING fixture Staat page). It uses |Zugehörigkeit= (NOT |Staat=),
//    which the affiliation field-alias set does NOT read -> empty affiliation. Activating
//    the handler stages it as a valid Aventurien territory with an empty parent chain.
$koschTer = $terByKey['wiki:kosch'] ?? null;
$check(
    '(i19) Kosch staged as a territory (empty affiliation; |Zugehörigkeit= is not |Staat=)',
    ['present' => true, 'type' => 'Fürstentum', 'root' => '', 'path' => []],
    [
        'present' => is_array($koschTer),
        'type' => (string) ($koschTer['type'] ?? '(none)'),
        'root' => (string) ($koschTer['affiliation_root'] ?? '(none)'),
        'path' => $koschTer['affiliation_path_json'] ?? '(none)',
    ],
    'the previously recognised-but-unhandled Kosch page is now a kept sandbox record'
);

// -- Continent filter: the Myranor territory (Rastanreich) is FILTERED OUT of the kept
//    records but reported in the `filtered` bucket (intentional drop, not a parse miss).
echo "\n-- (i/c) territory continent filter (Aventurien only) --\n";
$check(
    '(i20) Rastanreich NOT among kept territory records',
    false,
    array_key_exists('wiki:rastanreich', $terByKey),
    'a Myranor territory is not staged (continent != Aventurien)'
);
$filteredTerritoryTitles = array_map(
    static fn(array $x): string => $x['title'],
    array_filter($collected['filtered'], static fn(array $x): bool => ($x['kind'] ?? '') === 'territory')
);
$check(
    '(i21) Rastanreich reported in the filtered bucket (as a territory)',
    true,
    in_array('Rastanreich', $filteredTerritoryTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);
$rastanreich = avesmapsWikiDumpParseTerritoryPage($byTitle['Rastanreich']);
$check(
    '(i22) Rastanreich handler: kept=false but record present (real record, continent-dropped)',
    true,
    $rastanreich['kept'] === false && is_array($rastanreich['record']) && $rastanreich['continent'] !== '' && $rastanreich['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$rastanreich['continent']}' (Myranor); record exists, only the continent filter removed it"
);

// -- I7 / parent resolution: StoreAlias would register (title,title)->wiki_key so
//    REBUILD's ResolveParentKey can resolve a child's |Staat= parent NAME to the parent's
//    canonical wiki_key. Assert the intended mapping at the record level for the
//    parent-linked case: Baronie Hügelland's root "Grafschaft Ferdok" slugs to the alias
//    slug the persist would register for the Grafschaft Ferdok PAGE, and that alias points
//    at the Grafschaft Ferdok record's wiki_key. (The DB StoreAlias call lives in the
//    deferred persist; here we prove the pair it WOULD feed is coherent.)
echo "\n-- (i/I7) StoreAlias (title,title)->wiki_key feeds parent resolution --\n";
$grafAliasSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Grafschaft Ferdok'));
$baronieParentSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle((string) ($baronie['affiliation_root'] ?? '')));
$check(
    '(i23) Baronie parent root slug == Grafschaft Ferdok alias slug',
    $grafAliasSlug,
    $baronieParentSlug,
    "child's affiliation_root 'Grafschaft Ferdok' slugs to the same alias_slug the parent page registers"
);
$check(
    '(i24) that alias slug maps to the Grafschaft Ferdok wiki_key (I7 chain)',
    (string) ($graf['wiki_key'] ?? '(none)'),
    'wiki:' . $grafAliasSlug,
    'StoreAlias([title,title], wiki_key) registers alias_slug -> the record wiki_key, so ResolveParentKey resolves the parent'
);

// -- A non-territory infobox (Siedlung / Bauwerk) is NOT mis-handled as a territory.
echo "\n-- (i/x) non-territory infoboxes are not mis-handled as territories --\n";
$auhofAsTerritory = avesmapsWikiDumpParseTerritoryPage($byTitle['Auhof']);
$burgAsTerritory = avesmapsWikiDumpParseTerritoryPage($byTitle['Burg Wallenstein']);
$check(
    '(i25) Auhof (Siedlung) + Burg Wallenstein (Bauwerk) via territory handler: kept=false, no record',
    true,
    $auhofAsTerritory['kept'] === false && $auhofAsTerritory['record'] === null
        && $burgAsTerritory['kept'] === false && $burgAsTerritory['record'] === null,
    'the territory handler gate (infobox staat/herrschaftsgebiet/reich) rejects a Siedlung/Bauwerk -> no sandbox record'
);
// ...and a Staat page fed to the settlement/path/region/building handlers yields no record.
$grafAsSettlement = avesmapsWikiDumpParseSettlementPage($byTitle['Grafschaft Ferdok']);
$grafAsPath = avesmapsWikiDumpParsePathPage($byTitle['Grafschaft Ferdok']);
$grafAsRegion = avesmapsWikiDumpParseRegionPage($byTitle['Grafschaft Ferdok']);
$grafAsBuilding = avesmapsWikiDumpParseBuildingPage($byTitle['Grafschaft Ferdok']);
$check(
    '(i26) Grafschaft Ferdok (territory) via settlement/path/region/building handlers: no record',
    true,
    $grafAsSettlement['record'] === null && $grafAsPath['record'] === null
        && $grafAsRegion['record'] === null && $grafAsBuilding['record'] === null,
    'a territory infobox never yields a settlement/path/region/building record (O4/I2)'
);
$check(
    '(i27) no territory key leaked into kept settlement/path/region records',
    true,
    !array_key_exists('grafschaft-ferdok', $setByKey)
        && !array_key_exists('grafschaft-ferdok', $recByKey)
        && !array_key_exists('grafschaft-ferdok', $regByKey),
    'kept settlement/path/region records exclude territories (O4/I2/I3)'
);

// ---------------------------------------------------------------------------
// 4. Summary + exit code.
// ---------------------------------------------------------------------------
$total = $passCount + $failCount;
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d/%d passing (%d failing)\n", $passCount, $total, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
