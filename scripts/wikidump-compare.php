<?php

declare(strict_types=1);

/**
 * WikiDump migration -- Section 9 COMPARE-TEST (READ-ONLY CLI).
 * ===========================================================================
 * The owner's CORE SAFETY GATE. Proves the dump-reader yields the SAME data the
 * ONLINE crawler put in the DB, BEFORE anything sharp (the read_step) writes real
 * staging / sandbox. Run it on STRATO via SSH:
 *
 *     php scripts/wikidump-compare.php
 *     php scripts/wikidump-compare.php --json          # machine-readable
 *     php scripts/wikidump-compare.php --dump=/abs/path/to/other.xml.bz2
 *     php scripts/wikidump-compare.php --samples=25    # sample size per list
 *
 * WHAT IT DOES (and nothing else):
 *   1. opens the fetched dump (compress.bzip2://) via the reader that Task 5a
 *      already placed at uploads/dumps/;
 *   2. runs the already-built DB-FREE collectors in memory
 *      (avesmapsWikiDumpCollect{Path,Region,Settlement,Building,Territory}Records
 *      + avesmapsWikiDumpCollectEntities for the A6 continent-filter count +
 *      avesmapsWikiDumpCollectRedirectAliases for A2 parent resolution);
 *   3. SELECTs the real rows the online crawler produced (READ-ONLY);
 *   4. calls the PURE compare core (api/_internal/wiki/dump-compare.php);
 *   5. prints a per-entity A1-A6 report (optionally as JSON).
 *
 * IT WRITES NOTHING. There is no INSERT / UPDATE / DELETE / CREATE / ALTER / TRUNCATE
 * anywhere in this file. It never calls a Persist* / Upsert* / RunPassX* function.
 * (O5 resolved: read-only in-memory compare, no shadow tables.) The persist layer
 * lives in dump-reader.php / dump-entity-scan.php and is deliberately NOT invoked
 * here. This is the gate that must pass BEFORE any of that runs for real.
 *
 * A1-A6 (per the §9 brief):
 *   A1  key coverage per entity -- headline: missing_in_dump (a DB row the dump did
 *       NOT re-create). This is the HARD assert; drive it to 0.
 *   A2  territory hierarchy drift (dump affiliation-resolved parent vs DB
 *       parent_id->wiki_key), modulo parent_locked editor overrides.
 *   A3  graph untouched -- BY CONSTRUCTION: the reader only fills staging/sandbox;
 *       the sole map write a path import would ever make is
 *       properties_json['wiki_path'] on an EXISTING map_features row (a separate
 *       assign step, never this reader). The route graph is built from map_features
 *       geometry, which the reader never writes. Stated + the path-staging count is
 *       reported; no DB write is needed to prove a negative.
 *   A4  field diff per entity -- the EDITORIAL REVIEW LIST (expected §9 divergences:
 *       settlement_class / building_type where the class category is template-set,
 *       I6; anything the online API enriched that the dump cannot).
 *   A5  coats -- count dump coat filenames present; license is PRESERVED (the dump
 *       has no file-license metadata, so the DB's existing classification stands, I5).
 *   A6  continent -- count records the collectors filtered as non-Aventurien.
 *
 * KEY ALIGNMENT (dump collector key <-> DB column), all reused, never re-derived:
 *   paths       wiki_key   <-> wiki_path_staging.wiki_key       (UNIQUE)
 *   regions     wiki_key   <-> wiki_region_staging.wiki_key     (UNIQUE)
 *   settlements title      <-> wiki_sync_pages.title            (UNIQUE, class<>gebaeude)
 *   buildings   title      <-> wiki_sync_pages.title            (UNIQUE, class =gebaeude)
 *   territories wiki_key   <-> political_territory_wiki.wiki_key (UNIQUE; 'wiki:'+slug)
 *
 * NOTE ON DUMP PASSES: the collectors consume an iterable ONCE, so the reader is
 * reopened per collector (one full stream per entity kind + one for redirect
 * aliases). That is ~6 streams over the ~315 MB dump for a one-off owner run --
 * acceptable, and far simpler than trying to fan one pass into five typed buckets.
 * @set_time_limit(0) is set for the CLI.
 */

// ---------------------------------------------------------------------------
// 0. CLI GUARD -- never run over HTTP. This reads the DB + parses the dump; it is
//    CLI-only. Over HTTP it 403s and exits before loading anything.
// ---------------------------------------------------------------------------
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['REQUEST_URI']) || isset($_SERVER['HTTP_HOST'])) { // STRATO CLI runs as cgi-fcgi (not 'cli'); detect a real HTTP request by its server markers instead
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden: wikidump-compare.php is a CLI-only tool.\n";
    exit(1);
}

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivations require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll scripts/wikidump-compare.php\n");
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
$options = avesmapsWikiDumpCompareParseArgs($argv ?? []);
if ($options['help']) {
    echo "Avesmaps WikiDump compare-test (READ-ONLY)\n\n";
    echo "Usage:\n";
    echo "  php scripts/wikidump-compare.php [--json] [--dump=<path>] [--samples=<n>]\n\n";
    echo "Options:\n";
    echo "  --json          Emit the full comparison as JSON (for tooling).\n";
    echo "  --dump=<path>   Override the dump path (default: uploads/dumps/<dump>).\n";
    echo "  --samples=<n>   Max keys/rows per sample list (default: 50).\n";
    echo "  --help          Show this help.\n";
    exit(0);
}
$emitJson = $options['json'];
$sampleLimit = $options['samples'];

// ---------------------------------------------------------------------------
// 2. Include chain -- all side-effect-free on include (const + function defs).
//    Same chain the Pass-B fixture test uses, plus the pure compare core. The
//    order is a known dependency chain (paths.php needs Clean* from
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
require_once $repoRoot . '/api/_internal/wiki/dump-fetch.php';   // avesmapsWikiDumpStoragePath()
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';  // reader + redirect collector
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php'; // entity collectors
require_once $repoRoot . '/api/_internal/wiki/dump-compare.php'; // PURE compare core

// ---------------------------------------------------------------------------
// 3. Resolve + validate the dump path (read-only existence check).
// ---------------------------------------------------------------------------
$dumpPath = $options['dump'] !== '' ? $options['dump'] : avesmapsWikiDumpStoragePath();
if (!is_file($dumpPath)) {
    fwrite(STDERR, "FATAL: dump file not found: {$dumpPath}\n");
    fwrite(STDERR, "Fetch it first (Task 5a) or pass --dump=<abs path>.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 4. Connect (read-only usage) -- config + PDO via the standard CLI harness.
// ---------------------------------------------------------------------------
$config = avesmapsLoadApiConfig($repoRoot . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);

// ===========================================================================
// 5. Build the DUMP-side maps (in memory, DB-free collectors, reopen per pass).
// ===========================================================================
if (!$emitJson) {
    fwrite(STDERR, "Reading dump (this streams the whole file per entity kind)...\n");
}

// Each collector consumes the stream once -> reopen for each.
$pathRecords = avesmapsWikiDumpCollectPathRecords(avesmapsWikiDumpStreamPages($dumpPath));
$regionRecords = avesmapsWikiDumpCollectRegionRecords(avesmapsWikiDumpStreamPages($dumpPath));
$settlementRecords = avesmapsWikiDumpCollectSettlementRecords(avesmapsWikiDumpStreamPages($dumpPath));
$buildingRecords = avesmapsWikiDumpCollectBuildingRecords(avesmapsWikiDumpStreamPages($dumpPath));
$territoryRecords = avesmapsWikiDumpCollectTerritoryRecords(avesmapsWikiDumpStreamPages($dumpPath));

// One CollectEntities pass for the A6 non-Aventurien filter count (tagged by kind).
$entities = avesmapsWikiDumpCollectEntities(avesmapsWikiDumpStreamPages($dumpPath));
$filtered = is_array($entities['filtered'] ?? null) ? $entities['filtered'] : [];

// Redirect aliases (Pass A) -- needed to resolve dump affiliation parents (A2).
$aliasMap = avesmapsWikiDumpCollectRedirectAliases(avesmapsWikiDumpStreamPages($dumpPath));

// Territory parent CANDIDATES from the dump (affiliation_root / last link per key),
// captured while collecting so A2 can resolve them via the reused resolver.
$dumpTerritoryAffiliation = avesmapsWikiDumpCollectTerritoryAffiliation(avesmapsWikiDumpStreamPages($dumpPath));

// Index the dump records by their identity key (paths/regions/territories: wiki_key;
// settlements/buildings: title). keyList carries duplicates for A1 dup detection.
$pathDump = avesmapsWikiDumpIndexRecordsByKey($pathRecords, 'wiki_key');
$regionDump = avesmapsWikiDumpIndexRecordsByKey($regionRecords, 'wiki_key');
$settlementDump = avesmapsWikiDumpIndexRecordsByKey($settlementRecords, 'title');
$buildingDump = avesmapsWikiDumpIndexRecordsByKey($buildingRecords, 'title');
$territoryDump = avesmapsWikiDumpIndexRecordsByKey($territoryRecords, 'wiki_key');

// ===========================================================================
// 6. Load the DB-side maps (READ-ONLY SELECTs).
// ===========================================================================
$pathDb = avesmapsWikiDumpSelectPaths($pdo);
$regionDb = avesmapsWikiDumpSelectRegions($pdo);
$settlementDb = avesmapsWikiDumpSelectSettlements($pdo);
$buildingDb = avesmapsWikiDumpSelectBuildings($pdo);
$territoryDb = avesmapsWikiDumpSelectTerritories($pdo);           // political_territory_wiki (LIVE)
$dbParentByKey = avesmapsWikiDumpSelectHierarchyParents($pdo);    // political_territory self-join
$parentLocked = avesmapsWikiDumpSelectParentLocked($pdo);         // wiki_territory_model.parent_locked

// ===========================================================================
// 7. A1 -- key coverage per entity.
// ===========================================================================
$a1 = [
    'paths' => avesmapsWikiDumpCompareKeyCoverage($pathDump['map'], $pathDb, $pathDump['keyList'], $sampleLimit),
    'regions' => avesmapsWikiDumpCompareKeyCoverage($regionDump['map'], $regionDb, $regionDump['keyList'], $sampleLimit),
    'settlements' => avesmapsWikiDumpCompareKeyCoverage($settlementDump['map'], $settlementDb, $settlementDump['keyList'], $sampleLimit),
    'buildings' => avesmapsWikiDumpCompareKeyCoverage($buildingDump['map'], $buildingDb, $buildingDump['keyList'], $sampleLimit),
    'territories' => avesmapsWikiDumpCompareKeyCoverage($territoryDump['map'], $territoryDb, $territoryDump['keyList'], $sampleLimit),
];

// ===========================================================================
// 8. A4 -- field diff per entity (matched keys only). Fields = the columns the
//    reused upserts actually write; the identity key is excluded (A1 owns it).
// ===========================================================================
$a4 = [
    'paths' => avesmapsWikiDumpCompareFields(
        $pathDump['map'], $pathDb,
        ['name', 'match_key', 'kind', 'art', 'lage', 'laenge', 'continent', 'image_url'],
        [], $sampleLimit
    ),
    'regions' => avesmapsWikiDumpCompareFields(
        $regionDump['map'], $regionDb,
        ['name', 'match_key', 'art', 'region_parent', 'affiliation_staat', 'continent'],
        [], $sampleLimit
    ),
    'settlements' => avesmapsWikiDumpCompareFields(
        $settlementDump['map'], $settlementDb,
        ['normalized_key', 'settlement_class', 'continent'],
        [], $sampleLimit
    ),
    'buildings' => avesmapsWikiDumpCompareFields(
        $buildingDump['map'], $buildingDb,
        ['normalized_key', 'building_type', 'is_ruined'],
        // is_ruined: DB stores 0/1, dump record is bool -> normalise both to 0/1.
        ['is_ruined' => static fn(mixed $v): string => !empty($v) && $v !== '0' ? '1' : '0'],
        $sampleLimit
    ),
    'territories' => avesmapsWikiDumpCompareFields(
        $territoryDump['map'], $territoryDb,
        ['name', 'type', 'affiliation_root', 'continent'],
        [], $sampleLimit
    ),
];

// ===========================================================================
// 9. A2 -- territory hierarchy drift. Resolve the DUMP parent per territory via
//    the REUSED avesmapsWikiSyncMonitorResolveParentKey() (never a bespoke map):
//    build a slug->wiki_key index from the DB's own territory keys, then resolve
//    each dump territory's affiliation_root/last-link through the alias map.
// ===========================================================================
$dbKeyIndex = avesmapsWikiDumpBuildSlugIndex(array_keys($territoryDb)); // slug -> 'wiki:'+slug
$dumpParentByKey = [];
foreach ($dumpTerritoryAffiliation as $childKey => $affiliation) {
    $parentName = (string) ($affiliation['parent_name'] ?? '');
    if ($parentName === '') {
        $dumpParentByKey[$childKey] = null; // root (no affiliation)
        continue;
    }
    $resolved = avesmapsWikiSyncMonitorResolveParentKey($parentName, $dbKeyIndex, $aliasMap);
    $dumpParentByKey[$childKey] = is_string($resolved['wiki_key'] ?? null) ? $resolved['wiki_key'] : null;
}
$a2 = avesmapsWikiDumpCompareHierarchy($dumpParentByKey, $dbParentByKey, $parentLocked, $sampleLimit);

// ===========================================================================
// 10. A3 -- graph untouched (by construction). A5 -- coats. A6 -- continent.
// ===========================================================================
$a3 = [
    'path_staging_rows_in_dump' => count($pathDump['map']),
    'note' => 'By construction: the reader fills staging/sandbox only. The sole map '
        . 'write a path import performs is properties_json[wiki_path] on an EXISTING '
        . 'map_features row (a separate assign step, not this reader). The route graph '
        . 'is built from map_features geometry, which the reader never writes. No DB '
        . 'write is needed to prove this negative.',
];

$a5 = avesmapsWikiDumpCoatSummary($settlementDump['map'], $settlementDb);

$a6 = avesmapsWikiDumpContinentFilterSummary($filtered);

// ===========================================================================
// 11. Report.
// ===========================================================================
$report = [
    'dump_path' => $dumpPath,
    'generated_at' => date('c'),
    'a1_key_coverage' => $a1,
    'a2_hierarchy' => $a2,
    'a3_graph_untouched' => $a3,
    'a4_field_diff' => $a4,
    'a5_coats' => $a5,
    'a6_continent_filter' => $a6,
];

if ($emitJson) {
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    exit(avesmapsWikiDumpCompareExitCode($a1));
}

avesmapsWikiDumpComparePrintReport($report);
exit(avesmapsWikiDumpCompareExitCode($a1));

// ===========================================================================
// Streaming helper -- a fresh generator over the dump for each collector pass.
// ===========================================================================

/**
 * Yield the dump's pages from a freshly opened reader, closing it when the
 * generator is exhausted or abandoned. Each collector needs its own stream (an
 * iterable is consumed once), so callers call this per pass. Read-only.
 *
 * @return \Generator<int, array{title:string, ns:int, redirect:?string, wikitext:string}>
 */
function avesmapsWikiDumpStreamPages(string $dumpPath): \Generator
{
    $reader = avesmapsWikiDumpOpenReader($dumpPath);
    try {
        foreach (avesmapsWikiDumpIteratePages($reader) as $page) {
            yield $page;
        }
    } finally {
        $reader->close();
    }
}

/**
 * Collect, per dump TERRITORY, the parent-candidate name A2 will resolve: the
 * affiliation_root the reused parser produced (the last colon-path segment / the
 * simple [[X]]), keyed by the territory's own wiki_key. This REUSES
 * avesmapsWikiDumpParseTerritoryPage() (which reuses the real parser), so no
 * affiliation logic is re-implemented -- it only forwards the parsed root. A
 * conflict/independent affiliation yields an empty root (treated as a DB-root by
 * A2, i.e. no parent to compare). Read-only.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<string, array{parent_name:string}>
 */
function avesmapsWikiDumpCollectTerritoryAffiliation(iterable $pages): array
{
    $out = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY) {
            continue;
        }
        $result = avesmapsWikiDumpParseTerritoryPage($page);
        if (!$result['kept'] || !is_array($result['record'] ?? null)) {
            continue;
        }
        $record = $result['record'];
        $wikiKey = trim((string) ($record['wiki_key'] ?? ''));
        if ($wikiKey === '') {
            continue;
        }
        // affiliation_root is the parser's resolved parent NAME (empty for roots /
        // conflicts). A2 resolves it to a wiki_key via the reused resolver.
        $out[$wikiKey] = ['parent_name' => (string) ($record['affiliation_root'] ?? '')];
    }

    return $out;
}

// ===========================================================================
// READ-ONLY DB SELECTs -- one per entity. These are the ONLY DB statements in the
// tool, and every one is a SELECT. No write statement exists anywhere here.
// ===========================================================================

/** @return array<string, array<string,mixed>> wiki_key => row (paths staging). */
function avesmapsWikiDumpSelectPaths(PDO $pdo): array
{
    $sql = 'SELECT wiki_key, name, match_key, kind, art, lage, laenge, continent, image_url
            FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE;
    return avesmapsWikiDumpFetchKeyed($pdo, $sql, 'wiki_key');
}

/** @return array<string, array<string,mixed>> wiki_key => row (regions staging). */
function avesmapsWikiDumpSelectRegions(PDO $pdo): array
{
    $sql = 'SELECT wiki_key, name, match_key, art, region_parent, affiliation_staat, continent
            FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE;
    return avesmapsWikiDumpFetchKeyed($pdo, $sql, 'wiki_key');
}

/** @return array<string, array<string,mixed>> title => row (settlements, class<>gebaeude). */
function avesmapsWikiDumpSelectSettlements(PDO $pdo): array
{
    $sql = "SELECT title, normalized_key, settlement_class, coordinates_json, continent,
                   coat_url, coat_license_status
            FROM " . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . "
            WHERE settlement_class IS NULL OR settlement_class <> 'gebaeude'";
    return avesmapsWikiDumpFetchKeyed($pdo, $sql, 'title');
}

/** @return array<string, array<string,mixed>> title => row (buildings, class=gebaeude). */
function avesmapsWikiDumpSelectBuildings(PDO $pdo): array
{
    $sql = "SELECT title, normalized_key, building_type, is_ruined
            FROM " . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . "
            WHERE settlement_class = 'gebaeude'";
    return avesmapsWikiDumpFetchKeyed($pdo, $sql, 'title');
}

/** @return array<string, array<string,mixed>> wiki_key => row (political_territory_wiki LIVE). */
function avesmapsWikiDumpSelectTerritories(PDO $pdo): array
{
    $sql = 'SELECT wiki_key, name, type, affiliation_root, affiliation_path_json,
                   founded_start_bf, continent
            FROM political_territory_wiki';
    return avesmapsWikiDumpFetchKeyed($pdo, $sql, 'wiki_key');
}

/**
 * DB territory hierarchy: child.wiki_key => parent.wiki_key, from the
 * political_territory self-join (parent.id = child.parent_id). A root (no parent,
 * or a parent without a wiki_key) maps to null. Only active rows with a non-empty
 * child wiki_key are included. Read-only.
 *
 * @return array<string, ?string>
 */
function avesmapsWikiDumpSelectHierarchyParents(PDO $pdo): array
{
    $sql = 'SELECT child.wiki_key AS child_key, parent.wiki_key AS parent_key
            FROM political_territory child
            LEFT JOIN political_territory parent
                   ON parent.id = child.parent_id AND parent.is_active = 1
            WHERE child.is_active = 1 AND child.wiki_key IS NOT NULL AND child.wiki_key <> \'\'';
    $out = [];
    foreach ($pdo->query($sql) as $row) {
        $childKey = trim((string) ($row['child_key'] ?? ''));
        if ($childKey === '') {
            continue;
        }
        $parentKey = $row['parent_key'] ?? null;
        $out[$childKey] = is_string($parentKey) && trim($parentKey) !== '' ? trim($parentKey) : null;
    }

    return $out;
}

/**
 * The set of territory wiki_keys whose parent the editor has LOCKED
 * (wiki_territory_model.parent_locked = 1). A2 excludes these -- a locked parent is
 * an intentional override the dump is not expected to reproduce. Returns [] if the
 * model table is absent. Read-only.
 *
 * @return array<int, string>
 */
function avesmapsWikiDumpSelectParentLocked(PDO $pdo): array
{
    try {
        $sql = 'SELECT wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE parent_locked = 1';
        $keys = [];
        foreach ($pdo->query($sql) as $row) {
            $key = trim((string) ($row['wiki_key'] ?? ''));
            if ($key !== '') {
                $keys[] = $key;
            }
        }
        return $keys;
    } catch (\Throwable $error) {
        // Table missing on this DB -> no locked overrides to exclude.
        return [];
    }
}

/**
 * Run a SELECT and index the rows by $keyField. Shared read-only fetch helper.
 *
 * @return array<string, array<string,mixed>>
 */
function avesmapsWikiDumpFetchKeyed(PDO $pdo, string $sql, string $keyField): array
{
    $out = [];
    foreach ($pdo->query($sql) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $key = trim((string) ($row[$keyField] ?? ''));
        if ($key === '') {
            continue;
        }
        $out[$key] = $row;
    }

    return $out;
}

// ===========================================================================
// A2 helper -- slug index from DB wiki_keys, for the reused parent resolver.
// ===========================================================================

/**
 * Build the slug->wiki_key index avesmapsWikiSyncMonitorResolveParentKey() expects:
 * it looks a parent name's slug up in this index. The DB territory keys are of the
 * form 'wiki:<slug>', so we strip the 'wiki:' prefix to key by the bare slug and
 * map back to the full key. Pure string logic. Reuses no bespoke mapping -- the
 * resolver itself does the slugging + alias lookup.
 *
 * @param array<int, string> $wikiKeys territory wiki_keys ('wiki:'+slug)
 * @return array<string, string> slug => full wiki_key
 */
function avesmapsWikiDumpBuildSlugIndex(array $wikiKeys): array
{
    $index = [];
    foreach ($wikiKeys as $wikiKey) {
        $wikiKey = (string) $wikiKey;
        $slug = preg_replace('/^wiki:/', '', $wikiKey) ?? $wikiKey;
        if ($slug !== '') {
            $index[$slug] = $wikiKey;
        }
    }

    return $index;
}

// ===========================================================================
// A5 -- coat summary (license preserved; dump only supplies filenames).
// ===========================================================================

/**
 * A5: count how many dump settlement records carry a coat filename/URL, and how
 * many DB rows already have a coat_license_status classification. The dump has NO
 * file-license metadata (I5), so the compare-test does not touch the DB's existing
 * classification -- it is PRESERVED. This is a count + a note, never a diff that
 * could imply overwriting a license.
 *
 * @param array<string, array<string,mixed>> $dumpByTitle
 * @param array<string, array<string,mixed>> $dbByTitle
 * @return array{dump_coats:int, db_classified:int, note:string}
 */
function avesmapsWikiDumpCoatSummary(array $dumpByTitle, array $dbByTitle): array
{
    $dumpCoats = 0;
    foreach ($dumpByTitle as $record) {
        if (is_array($record) && trim((string) ($record['coat_url'] ?? '')) !== '') {
            $dumpCoats++;
        }
    }
    $dbClassified = 0;
    foreach ($dbByTitle as $row) {
        if (is_array($row) && trim((string) ($row['coat_license_status'] ?? '')) !== '') {
            $dbClassified++;
        }
    }

    return [
        'dump_coats' => $dumpCoats,
        'db_classified' => $dbClassified,
        'note' => 'The dump supplies coat FILENAMES only, no license metadata (I5). The '
            . "DB's existing coat_license_status classification is PRESERVED; the reader "
            . 'writes coat_license_* = NULL and never overwrites a classification.',
    ];
}

// ===========================================================================
// A6 -- continent filter count (from CollectEntities['filtered']).
// ===========================================================================

/**
 * A6: how many records the DB-free collectors dropped as non-Aventurien, split by
 * entity kind. These never reach staging/sandbox -- exactly the online crawler's
 * Aventurien-only behaviour, reproduced from the dump.
 *
 * @param array<int, array{title:string, kind:string, continent:string, reason:string}> $filtered
 * @return array{total:int, by_kind:array<string,int>, samples:array<int,array{title:string,kind:string,continent:string}>}
 */
function avesmapsWikiDumpContinentFilterSummary(array $filtered): array
{
    $byKind = [];
    $samples = [];
    foreach ($filtered as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $kind = (string) ($entry['kind'] ?? '');
        $byKind[$kind] = ($byKind[$kind] ?? 0) + 1;
        if (count($samples) < 20) {
            $samples[] = [
                'title' => (string) ($entry['title'] ?? ''),
                'kind' => $kind,
                'continent' => (string) ($entry['continent'] ?? ''),
            ];
        }
    }
    ksort($byKind);

    return ['total' => count($filtered), 'by_kind' => $byKind, 'samples' => $samples];
}

// ===========================================================================
// Exit code -- 0 iff every entity's A1 missing_in_dump is 0 (the hard gate).
// ===========================================================================

/**
 * Exit code for the run: 0 (green) iff no entity has any missing_in_dump key (the
 * dump re-created every DB row). Non-zero (red) otherwise. A4 diffs / A2 drifts /
 * new_in_dump are informational and do NOT fail the run -- they are the owner's
 * review list, not a coverage failure.
 *
 * @param array<string, array{missing_in_dump_count:int}> $a1
 */
function avesmapsWikiDumpCompareExitCode(array $a1): int
{
    foreach ($a1 as $entity) {
        if ((int) ($entity['missing_in_dump_count'] ?? 0) > 0) {
            return 1;
        }
    }

    return 0;
}

// ===========================================================================
// Human-readable report printer.
// ===========================================================================

/** @param array<string,mixed> $report */
function avesmapsWikiDumpComparePrintReport(array $report): void
{
    $line = str_repeat('=', 72);
    echo $line, "\n";
    echo " WikiDump COMPARE-TEST (READ-ONLY) -- dump vs. real DB\n";
    echo $line, "\n";
    echo 'Dump : ' . (string) ($report['dump_path'] ?? '') . "\n";
    echo 'When : ' . (string) ($report['generated_at'] ?? '') . "\n";
    echo "This tool writes NOTHING. It is the safety gate before any real write.\n\n";

    // --- A1 ---------------------------------------------------------------
    echo "-- A1  KEY COVERAGE (headline: missing_in_dump -> drive to 0) --\n";
    printf(
        "%-12s | %8s | %8s | %8s | %-16s | %-11s | %s\n",
        'entity', 'db', 'dump', 'matched', 'missing_in_dump', 'new_in_dump', 'dups'
    );
    $hardFail = false;
    foreach ((array) ($report['a1_key_coverage'] ?? []) as $entity => $cov) {
        $missing = (int) ($cov['missing_in_dump_count'] ?? 0);
        if ($missing > 0) {
            $hardFail = true;
        }
        printf(
            "%-12s | %8d | %8d | %8d | %-16s | %-11d | %d\n",
            $entity,
            (int) ($cov['db_total'] ?? 0),
            (int) ($cov['dump_total'] ?? 0),
            (int) ($cov['matched'] ?? 0),
            $missing . ($missing > 0 ? ' <-- RED' : ''),
            (int) ($cov['new_in_dump_count'] ?? 0),
            count((array) ($cov['dup_keys'] ?? []))
        );
    }
    echo "\n";
    foreach ((array) ($report['a1_key_coverage'] ?? []) as $entity => $cov) {
        $missing = (array) ($cov['missing_in_dump'] ?? []);
        if ($missing !== []) {
            echo "  {$entity}: missing_in_dump sample (DB rows the dump did NOT re-create):\n";
            foreach ($missing as $key) {
                echo "    - {$key}\n";
            }
        }
        $dups = (array) ($cov['dup_keys'] ?? []);
        if ($dups !== []) {
            echo "  {$entity}: DUPLICATE dump keys (two pages -> one key -- a defect):\n";
            foreach ($dups as $key) {
                echo "    ! {$key}\n";
            }
        }
    }
    echo "\n";

    // --- A2 ---------------------------------------------------------------
    $a2 = (array) ($report['a2_hierarchy'] ?? []);
    echo "-- A2  TERRITORY HIERARCHY DRIFT (modulo parent_locked) --\n";
    printf(
        "compared=%d  agree=%d  both_root=%d  locked_excluded=%d  drifts=%d\n",
        (int) ($a2['compared'] ?? 0),
        (int) ($a2['agree'] ?? 0),
        (int) ($a2['both_root'] ?? 0),
        (int) ($a2['locked_excluded'] ?? 0),
        (int) ($a2['drift_count'] ?? 0)
    );
    foreach ((array) ($a2['drifts'] ?? []) as $drift) {
        printf(
            "  ~ %-40s  db=[%s]  dump=[%s]  (%s)\n",
            (string) ($drift['key'] ?? ''),
            (string) ($drift['db_parent'] ?? ''),
            (string) ($drift['dump_parent'] ?? ''),
            (string) ($drift['kind'] ?? '')
        );
    }
    echo "\n";

    // --- A3 ---------------------------------------------------------------
    $a3 = (array) ($report['a3_graph_untouched'] ?? []);
    echo "-- A3  ROUTE GRAPH UNTOUCHED (by construction) --\n";
    echo '  path staging rows the dump would write: ' . (int) ($a3['path_staging_rows_in_dump'] ?? 0) . "\n";
    echo '  ' . (string) ($a3['note'] ?? '') . "\n\n";

    // --- A4 ---------------------------------------------------------------
    echo "-- A4  FIELD DIFF (EDITORIAL REVIEW LIST -- expected §9 divergences) --\n";
    foreach ((array) ($report['a4_field_diff'] ?? []) as $entity => $diff) {
        $totals = (array) ($diff['field_diff_totals'] ?? []);
        $totalsStr = [];
        foreach ($totals as $field => $count) {
            $totalsStr[] = "{$field}={$count}";
        }
        printf(
            "  %-12s compared=%d  diff_rows=%d  [%s]\n",
            $entity,
            (int) ($diff['compared'] ?? 0),
            (int) ($diff['diff_row_count'] ?? 0),
            implode(', ', $totalsStr)
        );
        foreach ((array) ($diff['diffs'] ?? []) as $row) {
            $fieldParts = [];
            foreach ((array) ($row['fields'] ?? []) as $field => $vals) {
                $fieldParts[] = sprintf(
                    '%s: db[%s] -> dump[%s]',
                    $field,
                    (string) ($vals['old'] ?? ''),
                    (string) ($vals['new'] ?? '')
                );
            }
            echo '      ' . (string) ($row['key'] ?? '') . ' | ' . implode(' ; ', $fieldParts) . "\n";
        }
    }
    echo "\n";

    // --- A5 ---------------------------------------------------------------
    $a5 = (array) ($report['a5_coats'] ?? []);
    echo "-- A5  COATS (license PRESERVED) --\n";
    echo '  dump settlement coats (filenames): ' . (int) ($a5['dump_coats'] ?? 0) . "\n";
    echo '  DB rows already license-classified: ' . (int) ($a5['db_classified'] ?? 0) . "\n";
    echo '  ' . (string) ($a5['note'] ?? '') . "\n\n";

    // --- A6 ---------------------------------------------------------------
    $a6 = (array) ($report['a6_continent_filter'] ?? []);
    echo "-- A6  CONTINENT FILTER (non-Aventurien dropped by the collectors) --\n";
    echo '  total filtered: ' . (int) ($a6['total'] ?? 0) . "\n";
    foreach ((array) ($a6['by_kind'] ?? []) as $kind => $count) {
        echo "    {$kind}: {$count}\n";
    }
    echo "\n";

    echo $line, "\n";
    echo $hardFail
        ? " RESULT: RED -- at least one entity has missing_in_dump > 0. See A1 above.\n"
        : " RESULT: GREEN -- every DB row was re-created by the dump (A1 missing_in_dump = 0).\n";
    echo "         A2 drifts / A4 diffs / new_in_dump are the review list, not failures.\n";
    echo $line, "\n";
}

// ===========================================================================
// Argument parser.
// ===========================================================================

/**
 * @param array<int, string> $argv
 * @return array{help:bool, json:bool, dump:string, samples:int}
 */
function avesmapsWikiDumpCompareParseArgs(array $argv): array
{
    $options = ['help' => false, 'json' => false, 'dump' => '', 'samples' => 50];
    foreach (array_slice($argv, 1) as $token) {
        $token = (string) $token;
        if ($token === '--help' || $token === '-h') {
            $options['help'] = true;
        } elseif ($token === '--json') {
            $options['json'] = true;
        } elseif (str_starts_with($token, '--dump=')) {
            $options['dump'] = trim(substr($token, strlen('--dump=')));
        } elseif (str_starts_with($token, '--samples=')) {
            $options['samples'] = max(0, (int) substr($token, strlen('--samples=')));
        } else {
            fwrite(STDERR, "Unknown option: {$token} (use --help)\n");
            exit(2);
        }
    }

    return $options;
}
