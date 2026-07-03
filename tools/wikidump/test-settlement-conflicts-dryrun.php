<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the SETTLEMENT-CONFLICT DRY-RUN library
 * (api/_internal/wiki/settlement-conflicts-dryrun.php) -- the non-fetching,
 * non-persisting mirror of the live settlement conflict classifier
 * (avesmapsWikiSyncMatchMapPlaces + avesmapsWikiSyncBuildAndStoreCases,
 * api/_internal/wiki/locations.php) that
 * scripts/wikidump-settlement-conflicts-dryrun.php runs on STRATO.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS
 * ---------------------------------------------------------------------------
 * It feeds SYNTHETIC dump settlements + map places -- crafted so each triggers a
 * specific outcome -- through the mirrored match + classify + candidate-scan and
 * asserts the resulting COUNTS:
 *   (A) each of the 8 existing case types fires exactly as the live tree would
 *       (duplicate_avesmaps_name, canonical_name_difference[=0, never fires],
 *       type_conflict, probable_match, unresolved_without_candidate,
 *       duplicate_wiki_title, missing_wiki_with_coordinates,
 *       missing_wiki_without_coordinates);
 *   (B) each 9th-category candidate is counted honestly
 *       (coordinate_drift, continent_dump_nondefault, is_ruined_or_url_change,
 *       coat_presence_diff) and the gebaeude filter drops buildings.
 *
 * No DB, no dump, no MediaWiki API -- every function under test is pure and is
 * driven with in-memory arrays. The map-place shape mirrors
 * avesmapsWikiSyncReadMapPlaces() output; the dump-settlement shape mirrors
 * avesmapsWikiDumpParseSettlementPage() output. normalized_key values are built
 * with the REAL avesmapsWikiSyncCreateMatchKey() (not hand-typed) so the match
 * keying is exercised exactly as production keys it.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring caveat as every sibling
 * tools/wikidump test -- the reused derivations call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-settlement-conflicts-dryrun.php
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

// ---------------------------------------------------------------------------
// 1. Include chain: bootstrap + the WikiSync location classifier the mirror
//    reuses, plus the dry-run library under test. All side-effect-free on
//    include (function/const defs only).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/settlement-conflicts-dryrun.php';
$includeOutput = (string) ob_get_clean();

// Endpoint-only constants the reused helpers need (see the CLI file docblock 2b):
// defined only in api/edit/wiki/sync.php, which this test never loads. Mirror the
// SAME values (guarded) so match/classify/candidate-scan can run.
if (!defined('AVESMAPS_WIKI_SYNC_TYPE_LOCATION')) { define('AVESMAPS_WIKI_SYNC_TYPE_LOCATION', 'location'); }
if (!defined('AVESMAPS_WIKI_FUZZY_CUTOFF')) { define('AVESMAPS_WIKI_FUZZY_CUTOFF', 0.82); }
if (!defined('AVESMAPS_DEREGLOBUS_TO_MAP')) {
    define('AVESMAPS_DEREGLOBUS_TO_MAP', [
        'x_lon' => 30.3257445760, 'x_lat' => 0.0014126835, 'x_offset' => 438.0819758605,
        'y_lon' => 0.007511999997, 'y_lat' => 33.5769120338, 'y_offset' => -466.8085324960,
    ]);
}
if (!defined('AVESMAPS_POSITIONKARTE_TO_MAP')) {
    define('AVESMAPS_POSITIONKARTE_TO_MAP', [
        'x_x' => 2.1490004455, 'x_y' => 0.0010081646, 'x_offset' => 188.8734061695,
        'y_x' => -0.0024556121, 'y_y' => -2.1502199630, 'y_offset' => 1018.3819994023,
    ]);
}

$requiredFunctions = [
    'avesmapsWikiDumpDryRunWikiPlacesFromRecords',
    'avesmapsWikiDumpDryRunMatchMapPlaces',
    'avesmapsWikiDumpDryRunMissingWikiPlaces',
    'avesmapsWikiDumpDryRunBuildCases',
    'avesmapsWikiDumpDryRunCandidateScan',
    'avesmapsWikiDumpDryRunClassifySettlements',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by settlement-conflicts-dryrun.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors every sibling tools/wikidump test).
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
echo " settlement-conflicts-dryrun PURE-logic test (WikiDump migration)\n";
echo "================================================================\n";

$check(
    '(0) include produced no output',
    '',
    $includeOutput,
    'the library is side-effect-free on include (defs only) -- same PURITY CONTRACT as every sibling'
);

// ---------------------------------------------------------------------------
// 3. Fixture builders (production-shaped).
// ---------------------------------------------------------------------------

/** A map place shaped like avesmapsWikiSyncReadMapPlaces() output. */
$mapPlace = static function (
    int $id,
    string $name,
    string $settlementClass = 'dorf',
    ?array $geometryXY = null,
    array $properties = [],
    string $wikiUrl = ''
): array {
    return [
        'id' => $id,
        'public_id' => sprintf('map-%04d', $id),
        'name' => $name,
        'normalized_key' => avesmapsWikiSyncCreateMatchKey($name),
        'settlement_class' => $settlementClass,
        'feature_subtype' => $settlementClass,
        'wiki_url' => $wikiUrl,
        'geometry' => $geometryXY !== null ? ['type' => 'Point', 'coordinates' => $geometryXY] : [],
        'properties' => $properties,
        'revision' => 1,
    ];
};

/** A dump settlement record shaped like avesmapsWikiDumpParseSettlementPage() output. */
$dumpRecord = static function (
    string $title,
    string $settlementClass = 'dorf',
    array $coordinates = ['source' => 'none', 'x' => null, 'y' => null],
    string $continent = 'Aventurien',
    bool $isRuined = false,
    string $coatUrl = '',
    string $wikiUrl = ''
): array {
    return [
        'title' => $title,
        'normalized_key' => avesmapsWikiSyncCreateMatchKey($title),
        'wiki_key' => avesmapsPoliticalSlug($title),
        'wiki_url' => $wikiUrl !== '' ? $wikiUrl : avesmapsWikiSyncPageUrl($title),
        'settlement_class' => $settlementClass,
        'settlement_label' => '',
        'categories_json' => [],
        'coordinates_json' => $coordinates,
        'continent' => $continent,
        'is_ruined' => $isRuined,
        'coat_url' => $coatUrl,
        'coat_license_status' => null,
    ];
};

// ===========================================================================
// (A) THE 8 EXISTING CASE TYPES -- each triggered in isolation, counts asserted.
// ===========================================================================
echo "\n-- (A) the 8 existing case types --\n";

// --- type_conflict: exact match, classes differ (both non-empty). ---
// map "Ferdok"=stadt <-> dump "Ferdok"=metropole.
$mapPlacesTC = [$mapPlace(1, 'Ferdok', 'stadt')];
$recordsTC = [$dumpRecord('Ferdok', 'metropole')];
$wikiTC = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsTC);
$matchTC = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesTC, $wikiTC);
$missingTC = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiTC, $matchTC['matched_titles']);
$casesTC = avesmapsWikiDumpDryRunBuildCases($matchTC, $mapPlacesTC, $missingTC);
$check('(A1) type_conflict fires on class mismatch', 1, count($casesTC['type_conflict']),
    'wiki.settlement_class (metropole) != map.settlement_class (stadt), both non-empty -> exactly locations.php:492-496');
$check('(A1b) exact match recorded (1)', 1, count($matchTC['matches']),
    'a single wiki candidate for the map key -> exact match, locations.php:302-312');
$check('(A1c) canonical_name_difference never fires (kept for fidelity)', 0, count($casesTC['canonical_name_difference']),
    'the match loop only appends match_kind=exact, so this branch is dead -- as in the live tree');

// --- probable_match: 0 exact candidates, >=1 fuzzy >= AVESMAPS_WIKI_FUZZY_CUTOFF. ---
// map "Gareth" has no exact wiki; dump "Garethh" is fuzzy-similar (similar_text high).
$mapPlacesPM = [$mapPlace(2, 'Gareth', 'grossstadt')];
$recordsPM = [$dumpRecord('Garethh', 'grossstadt')];
$wikiPM = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsPM);
$matchPM = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesPM, $wikiPM);
$missingPM = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiPM, $matchPM['matched_titles']);
$casesPM = avesmapsWikiDumpDryRunBuildCases($matchPM, $mapPlacesPM, $missingPM);
$check('(A2) probable_match fires when only a fuzzy candidate exists', 1, count($casesPM['probable_match']),
    'no exact key match but similar_text("gareth","garethh") >= cutoff -> unresolved WITH candidate, locations.php:499-501');
$check('(A2b) no exact match for the fuzzy case', 0, count($matchPM['matches']),
    'the keys differ (gareth vs garethh) so it is unresolved, not exact');

// --- unresolved_without_candidate: no exact, no fuzzy. ---
$mapPlacesUN = [$mapPlace(3, 'Zzqxyville', 'dorf')];
$recordsUN = [$dumpRecord('Ferdok', 'stadt')]; // totally dissimilar
$wikiUN = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsUN);
$matchUN = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesUN, $wikiUN);
$missingUN = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiUN, $matchUN['matched_titles']);
$casesUN = avesmapsWikiDumpDryRunBuildCases($matchUN, $mapPlacesUN, $missingUN);
$check('(A3) unresolved_without_candidate fires when nothing matches', 1, count($casesUN['unresolved_without_candidate']),
    'no exact + no fuzzy candidate -> unresolved WITHOUT candidate, locations.php:499-501');

// --- duplicate_avesmaps_name: two active map rows share a literal name. ---
$mapPlacesDN = [$mapPlace(4, 'Twinburg', 'dorf'), $mapPlace(5, 'Twinburg', 'dorf')];
$recordsDN = []; // wiki side irrelevant for this type
$wikiDN = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsDN);
$matchDN = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesDN, $wikiDN);
$missingDN = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiDN, $matchDN['matched_titles']);
$casesDN = avesmapsWikiDumpDryRunBuildCases($matchDN, $mapPlacesDN, $missingDN);
$check('(A4) duplicate_avesmaps_name fires on two same-named map rows', 1, count($casesDN['duplicate_avesmaps_name']),
    'avesmapsWikiSyncFindDuplicateMapPlaceNames groups the two "Twinburg" rows -> one case, locations.php:478-480');

// --- duplicate_wiki_title: two DIFFERENT map names normalise to the same key,
//     both matching the SAME single wiki title. "Al'Anfa" and "AlAnfa" -> "alanfa". ---
$check('(A5-precond) both map names share a normalized key', true,
    avesmapsWikiSyncCreateMatchKey("Al'Anfa") === avesmapsWikiSyncCreateMatchKey('AlAnfa'),
    'the apostrophe is stripped by the match-key normaliser, so both key to the same wiki place');
$mapPlacesDW = [$mapPlace(6, "Al'Anfa", 'metropole'), $mapPlace(7, 'AlAnfa', 'metropole')];
$recordsDW = [$dumpRecord("Al'Anfa", 'metropole')];
$wikiDW = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsDW);
$matchDW = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesDW, $wikiDW);
$missingDW = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiDW, $matchDW['matched_titles']);
$casesDW = avesmapsWikiDumpDryRunBuildCases($matchDW, $mapPlacesDW, $missingDW);
$check('(A5) duplicate_wiki_title fires when two map names share one wiki title', 1, count($casesDW['duplicate_wiki_title']),
    'two distinct map.name both matched the one wiki.title -> locations.php:504-523');
$check('(A5b) both are exact matches', 2, count($matchDW['matches']),
    'each map row keys to the single wiki candidate -> two exact matches sharing a title');

// --- missing_wiki_with_coordinates: an unmatched dump settlement with usable coords. ---
// dereglobus x=0,y=0 -> lng≈438.08, lat≈-466.8 ... lat<0 is out of bounds. Use a
// dereglobus point that lands in [0,1024]: pick x,y so both axes are in range.
// x=10,y=15 -> lng≈438.08+303.26=741.3, lat≈-466.8+503.7=36.9 -> in bounds.
$mapPlacesMW = []; // nothing matches -> the dump settlement is "missing"
$recordsMW = [$dumpRecord('Lonelytown', 'dorf', ['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0])];
$wikiMW = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsMW);
$matchMW = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlacesMW, $wikiMW);
$missingMW = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiMW, $matchMW['matched_titles']);
$casesMW = avesmapsWikiDumpDryRunBuildCases($matchMW, $mapPlacesMW, $missingMW);
$check('(A6-precond) the dereglobus point converts in-bounds', true,
    avesmapsWikiSyncCoordinatesToMapLocation(['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0]) !== null,
    'sanity: the crafted coordinate lands inside 0..1024 so it counts as "with coordinates"');
$check('(A6) missing_wiki_with_coordinates fires for an unmatched coord-bearing wiki', 1, count($casesMW['missing_wiki_with_coordinates']),
    'unmatched title + convertible coordinates -> locations.php:525-533 with_coordinates branch');
$check('(A6b) missing_wiki_without_coordinates is 0 here', 0, count($casesMW['missing_wiki_without_coordinates']),
    'the coordinates were usable, so the without-branch does not fire');

// --- missing_wiki_without_coordinates: an unmatched dump settlement, source=none. ---
$recordsMWno = [$dumpRecord('Nowhereton', 'dorf', ['source' => 'none', 'x' => null, 'y' => null])];
$wikiMWno = avesmapsWikiDumpDryRunWikiPlacesFromRecords($recordsMWno);
$matchMWno = avesmapsWikiDumpDryRunMatchMapPlaces([], $wikiMWno);
$missingMWno = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiMWno, $matchMWno['matched_titles']);
$casesMWno = avesmapsWikiDumpDryRunBuildCases($matchMWno, [], $missingMWno);
$check('(A7) missing_wiki_without_coordinates fires for an unmatched coordless wiki', 1, count($casesMWno['missing_wiki_without_coordinates']),
    'unmatched title + source=none -> locations.php:525-533 without_coordinates branch');

// ===========================================================================
// (B) 9th-CATEGORY CANDIDATES -- each triggered on an EXACT match, counts asserted.
// ===========================================================================
echo "\n-- (B) 9th-category candidates --\n";

// --- coordinate_drift: exact match, dump coords far from the map geometry. ---
// map geometry at [x=741, y=37] ~ where the dereglobus (10,15) point lands, so a
// CLOSE match does NOT drift; a FAR map geometry [x=100,y=100] DOES.
$driftCoords = ['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0]; // -> ~ (741.3, 36.9)
$mapClose = [$mapPlace(10, 'Closetown', 'dorf', [741.3, 36.9])];
$recClose = [$dumpRecord('Closetown', 'dorf', $driftCoords)];
$scanClose = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapClose, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recClose))['matches']
);
$check('(B1) coordinate_drift does NOT fire when map ~ wiki position', 0, $scanClose['coordinate_drift']['count'],
    'geometry within the 5.0-unit threshold of the converted wiki coordinate is clean');

$mapFar = [$mapPlace(11, 'Fartown', 'dorf', [100.0, 100.0])];
$recFar = [$dumpRecord('Fartown', 'dorf', $driftCoords)]; // wiki ~ (741,37), map (100,100) -> big drift
$scanFar = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapFar, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recFar))['matches']
);
$check('(B1b) coordinate_drift fires when map is far from wiki position', 1, $scanFar['coordinate_drift']['count'],
    'geometry hundreds of units from the converted wiki coordinate exceeds the 5.0-unit threshold');
$check('(B1c) coordinate_drift records a max_drift > threshold', true,
    $scanFar['coordinate_drift']['max_drift'] > AVESMAPS_WIKIDUMP_DRYRUN_COORD_DRIFT_UNITS,
    'the reported max drift reflects the real euclidean distance in image space');

// --- continent_dump_nondefault: exact match, dump continent != default. ---
$mapCont = [$mapPlace(12, 'Myranorville', 'dorf')];
$recCont = [$dumpRecord('Myranorville', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Myranor')];
$scanCont = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapCont, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recCont))['matches']
);
$check('(B2) continent_dump_nondefault counts a non-Aventurien dump continent', 1, $scanCont['continent_dump_nondefault']['count'],
    'dump continent "Myranor" != default "' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT . '" -> informational candidate');
$check('(B2b) a default-continent match is NOT counted', 0,
    avesmapsWikiDumpDryRunCandidateScan(
        avesmapsWikiDumpDryRunMatchMapPlaces(
            [$mapPlace(13, 'Aventown', 'dorf')],
            avesmapsWikiDumpDryRunWikiPlacesFromRecords([$dumpRecord('Aventown', 'dorf')])
        )['matches']
    )['continent_dump_nondefault']['count'],
    'the default continent is the common case and must not be flagged');

// --- is_ruined_or_url_change: exact match, dump is_ruined differs from map property. ---
$mapRuin = [$mapPlace(14, 'Ruinstadt', 'dorf', null, ['is_ruined' => false])];
$recRuin = [$dumpRecord('Ruinstadt', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', true)];
$scanRuin = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapRuin, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recRuin))['matches']
);
$check('(B3) is_ruined_or_url_change fires on an is_ruined mismatch', 1, $scanRuin['is_ruined_or_url_change']['count'],
    'map properties.is_ruined=false vs dump is_ruined=true -> flagged');
$check('(B3b) the is_ruined sub-counter incremented', 1, $scanRuin['is_ruined_or_url_change']['ruined_diff'],
    'the ruin-specific tally is reported separately from url changes');

// --- is_ruined_or_url_change via a wiki_url change (map snapshot url != dump url). ---
$mapUrl = [$mapPlace(15, 'Urlstadt', 'dorf', null,
    ['is_ruined' => false, 'wiki_settlement' => ['wiki_url' => 'https://wiki/old']],
    'https://wiki/old')];
$recUrl = [$dumpRecord('Urlstadt', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', false, '', 'https://wiki/new')];
$scanUrl = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapUrl, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recUrl))['matches']
);
$check('(B3c) a wiki_url change also flags is_ruined_or_url_change', 1, $scanUrl['is_ruined_or_url_change']['url_diff'],
    'dump wiki_url differs from the map feature\'s current wiki_url -> url_diff counted');

// --- coat_presence_diff: dump has a coat, map has none. ---
$mapCoat = [$mapPlace(16, 'Wappenstadt', 'dorf', null, ['wiki_settlement' => ['wappen_url' => '']])];
$recCoat = [$dumpRecord('Wappenstadt', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', false, 'https://wiki/File:Wappen.svg')];
$scanCoat = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapCoat, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recCoat))['matches']
);
$check('(B4) coat_presence_diff fires when dump has a coat and map does not', 1, $scanCoat['coat_presence_diff']['count'],
    'dump coat_url present, map wiki_settlement.wappen_url empty -> presence differs');
$check('(B4b) the dump-only sub-counter incremented', 1, $scanCoat['coat_presence_diff']['dump_only'],
    'the direction (dump has it, map does not) is reported');

// --- a genuinely CLEAN exact match flags NOTHING. ---
$mapClean = [$mapPlace(17, 'Cleanton', 'dorf', null, ['is_ruined' => false, 'wiki_settlement' => ['wappen_url' => '', 'wiki_url' => 'https://wiki/Cleanton']], 'https://wiki/Cleanton')];
$recClean = [$dumpRecord('Cleanton', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', false, '', 'https://wiki/Cleanton')];
$scanClean = avesmapsWikiDumpDryRunCandidateScan(
    avesmapsWikiDumpDryRunMatchMapPlaces($mapClean, avesmapsWikiDumpDryRunWikiPlacesFromRecords($recClean))['matches']
);
$check('(B5) a clean exact match flags NO candidate', 0, $scanClean['matched_no_case_but_candidate']['count'],
    'same class, same continent(default), same url, no coat either side, no coords -> nothing to flag');

// ===========================================================================
// (C) gebaeude filter + end-to-end orchestration counts.
// ===========================================================================
echo "\n-- (C) gebaeude filter + orchestration --\n";

$allRecords = [
    $dumpRecord('Ferdok', 'metropole'),                 // will type_conflict vs map stadt
    $dumpRecord('Burg Wallenstein', 'gebaeude'),        // FILTERED OUT (building)
    $dumpRecord('Orphantown', 'dorf'),                  // unmatched -> missing_without_coordinates
];
$mapForOrchestration = [$mapPlace(20, 'Ferdok', 'stadt')];
$report = avesmapsWikiDumpDryRunClassifySettlements($mapForOrchestration, $allRecords, 8);

$check('(C1) gebaeude is filtered out of the settlement set', 1, $report['header']['gebaeude_filtered_out'],
    'the one settlement_class=gebaeude record is dropped so it never inflates type_conflict/unresolved');
$check('(C2) dump settlement count excludes gebaeude', 2, $report['header']['dump_settlements_excl_gebaeude'],
    '3 records - 1 gebaeude = 2 settlements considered');
$check('(C3) type_conflict count surfaces in section A', 1,
    $report['section_a_case_types']['by_type']['type_conflict']['count'],
    'Ferdok metropole(dump) vs stadt(map) -> one type_conflict, reported in the canonical order');
$check('(C4) the unmatched non-coord settlement is a missing_without_coordinates', 1,
    $report['section_a_case_types']['by_type']['missing_wiki_without_coordinates']['count'],
    'Orphantown never matched + no coords -> missing_without_coordinates');
$check('(C5) exact matches total = 1 (only Ferdok)', 1, $report['section_c_totals']['exact_matches'],
    'the section-C rollup counts the single exact match');
$check('(C6) the report carries the tuned coord-drift threshold in its header', AVESMAPS_WIKIDUMP_DRYRUN_COORD_DRIFT_UNITS,
    $report['header']['coord_drift_threshold_units'],
    'the threshold is surfaced so the owner sees which value produced the counts');
$check('(C7) all 8 case types are present in section A (even at 0)', 8,
    count($report['section_a_case_types']['by_type']),
    'the report always shows the full 8-type shape so a 0 is visible, not omitted');

// ===========================================================================
// Summary.
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
