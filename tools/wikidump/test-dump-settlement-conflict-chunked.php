<?php

declare(strict_types=1);

/**
 * Unit test for the CHUNKED (client-loopable) WikiDump settlement-conflict
 * generator -- avesmapsWikiDumpSettlementConflictsGenerateStep() +
 * avesmapsWikiDumpSettlementExactMatchesForFinalize() in
 * api/_internal/wiki/dump-sync-kind.php.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The one-shot avesmapsWikiDumpSettlementConflictsGenerate() ran the whole
 * O(n*m) fuzzy match SYNCHRONOUSLY and PHP-fatalled on STRATO's
 * max_execution_time (the "hang at 4000/5040" bug). The stepper spreads that
 * exact same match/classify across client-driven steps keyed by a map-place id
 * cursor. This test proves the DRIVING changed but the OUTPUT did not:
 *
 *   (A) CURSOR + TERMINATION: with a tiny batch size the stepper advances a
 *       strictly-increasing map-place id cursor across several MATCH steps and
 *       then fires exactly one FINALIZE step (done=true), in a bounded number of
 *       steps. It never loops forever.
 *   (B) PARITY: the UNION of everything a full chunked run upserts equals what a
 *       single one-shot avesmapsWikiDumpSettlementConflictsGenerate() upserts --
 *       byte-for-byte per case (same case_keys, same case_type, same payload_json).
 *       This is checked on a crafted set that fires BOTH per-batch case types
 *       (type_conflict / probable_match / unresolved_without_candidate /
 *       field_divergence / coat_available / coordinate_drift) AND the cross-batch
 *       types the finalize phase owns (duplicate_avesmaps_name /
 *       duplicate_wiki_title / missing_wiki_with/without_coordinates).
 *   (C) MATCHED-TITLE ACCUMULATION: a wiki title that only ever appears as a
 *       FUZZY candidate (never an exact match), in a LATE batch, is still not
 *       mis-reported as missing -- i.e. the durable matched-title accumulator is
 *       unioned across batches (both exact matches and fuzzy candidates mark a
 *       title matched).
 *   (D) STAGING guard: the stepper writes ONLY wiki_sync_cases (the accumulator
 *       lives in the in-memory state seam here, so no other table is touched).
 *
 * The map places + dump settlement records are injected via the stepper's
 * override seams and the matched-title accumulator via its in-memory $stateSeam,
 * so NO live DB / sandbox / MediaWiki API is needed -- same fake-PDO approach as
 * tools/wikidump/test-dump-sync-kind.php (whose FakeCasesPdo/FakeCasesStmt this
 * test re-declares locally, since that sibling test is a script, not a library).
 *
 * HOW TO RUN (reused derivations call mb_*, same caveat as every sibling):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-settlement-conflict-chunked.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2);
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';
require_once $repoRoot . '/api/_internal/wiki/settlement-conflicts-dryrun.php';
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-sync-kind.php';

// Cross-cutting WikiSync constants the reused helpers need. Load the REAL
// production source (api/_internal/wiki/sync-constants.php) instead of
// mirroring define() shims -- a shim here previously masked the live gap where
// api/edit/wiki/dump.php's require graph never defined these (settlement
// conflict-analysis phase -> HTTP 500).
require_once $repoRoot . '/api/_internal/wiki/sync-constants.php';

foreach ([
    'avesmapsWikiDumpSettlementConflictsGenerate',
    'avesmapsWikiDumpSettlementConflictsGenerateStep',
    'avesmapsWikiDumpSettlementExactMatchesForFinalize',
    'avesmapsWikiDumpSettlementWikiPlacesFromRecords',
    'avesmapsWikiDumpSettlementUpsertCaseSubset',
] as $fn) {
    if (!function_exists($fn)) {
        fwrite(STDERR, "FATAL: expected function {$fn}() was not defined by dump-sync-kind.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// Assertion harness.
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
echo " dump-sync-kind CHUNKED settlement-conflict generator test\n";
echo "================================================================\n";

// ---------------------------------------------------------------------------
// Fake PDO/PDOStatement modelling ONLY the wiki_sync_cases upsert path (SELECT
// existing by case_key + INSERT + UPDATE with CASE-WHEN preservation) + no-op
// DDL. Records executed SQL for the STAGING guard. (Copied from the sibling
// test-dump-sync-kind.php -- that is a script, not an includable library.)
// ---------------------------------------------------------------------------
final class FakeCasesStmt extends PDOStatement
{
    private array $bound = [];
    private array $fetchRow = [];

    public function __construct(private string $sql, private FakeCasesPdo $pdo)
    {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $this->bound = (array) ($params ?? []);
        $sql = $this->sql;
        $this->pdo->executedSql[] = $sql;
        $this->fetchRow = [];

        if (stripos($sql, 'SELECT id, status, signature_hash') !== false
            && stripos($sql, 'FROM wiki_sync_cases') !== false) {
            $caseKey = (string) ($this->bound['case_key'] ?? '');
            if (isset($this->pdo->cases[$caseKey])) {
                $row = $this->pdo->cases[$caseKey];
                $this->fetchRow = [
                    'id' => $row['id'],
                    'status' => $row['status'],
                    'signature_hash' => $row['signature_hash'],
                ];
            }
            return true;
        }

        if (stripos($sql, 'INSERT INTO wiki_sync_cases') !== false) {
            $caseKey = (string) ($this->bound['case_key'] ?? '');
            $id = ++$this->pdo->autoId;
            $this->pdo->cases[$caseKey] = [
                'id' => $id,
                'case_type' => (string) ($this->bound['case_type'] ?? ''),
                'status' => (string) ($this->bound['status'] ?? 'open'),
                'signature_hash' => (string) ($this->bound['signature_hash'] ?? ''),
                'payload_json' => (string) ($this->bound['payload_json'] ?? ''),
                'reviewed_at' => null,
                'reviewed_by' => null,
                'resolution_json' => null,
            ];
            $this->pdo->casesById[$id] = $caseKey;
            return true;
        }

        if (stripos($sql, 'UPDATE wiki_sync_cases') !== false && isset($this->bound['id'])) {
            $id = (int) $this->bound['id'];
            $caseKey = $this->pdo->casesById[$id] ?? '';
            if ($caseKey !== '' && isset($this->pdo->cases[$caseKey])) {
                $row = &$this->pdo->cases[$caseKey];
                $row['case_type'] = (string) ($this->bound['case_type'] ?? $row['case_type']);
                $row['status'] = (string) ($this->bound['status'] ?? $row['status']);
                $row['signature_hash'] = (string) ($this->bound['signature_hash'] ?? $row['signature_hash']);
                $row['payload_json'] = (string) ($this->bound['payload_json'] ?? $row['payload_json']);
                unset($row);
            }
            return true;
        }

        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        return $this->fetchRow === [] ? false : $this->fetchRow;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return false;
    }
}

final class FakeCasesPdo extends PDO
{
    public array $cases = [];
    public array $casesById = [];
    public int $autoId = 0;
    public array $executedSql = [];

    public function __construct()
    {
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeCasesStmt((string) $query, $this);
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->executedSql[] = (string) $statement;
        return 0;
    }

    #[\ReturnTypeWillChange]
    public function query($statement, $mode = PDO::ATTR_DEFAULT_FETCH_MODE, ...$fetchModeArgs)
    {
        $this->executedSql[] = (string) $statement;
        return new FakeCasesStmt((string) $statement, $this);
    }

    #[\ReturnTypeWillChange]
    public function lastInsertId($name = null)
    {
        return (string) $this->autoId;
    }
}

// ---------------------------------------------------------------------------
// Fixture builders (same shapes as test-dump-sync-kind.php).
// ---------------------------------------------------------------------------
$mapPlace = static function (
    int $id,
    string $name,
    string $settlementClass = 'dorf',
    ?array $geometryXY = null,
    array $properties = [],
    string $wikiUrl = '',
    int $revision = 1
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
        'revision' => $revision,
    ];
};

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

$RUN_ID = 4242;

// A crafted set that fires per-batch AND cross-batch case types (mirrors the
// (C) "all types" set in test-dump-sync-kind.php). NOTE ids are deliberately NOT
// in name order, to exercise the id-cursor batching independent of name order.
$C = ['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0]; // -> ~(741.3, 36.9)

$mapPlaces = [
    $mapPlace(31, 'Konfliktstadt', 'stadt', [741.3 + 30.0, 36.9], ['wiki_settlement' => ['wappen_url' => '']]), // type_conflict + coordinate_drift + coat_available
    $mapPlace(12, 'Ruinenstadt', 'dorf', null, ['is_ruined' => false]),   // field_divergence (is_ruined)
    $mapPlace(45, 'Twinburg', 'dorf'),                                    // duplicate_avesmaps_name (with id 7)
    $mapPlace(7,  'Twinburg', 'dorf'),                                    // duplicate_avesmaps_name partner (EARLIER id, LATER name-neighbour)
    $mapPlace(28, "Al'Anfa", 'metropole'),                               // duplicate_wiki_title
    $mapPlace(9,  'AlAnfa', 'metropole'),                                // duplicate_wiki_title partner
    $mapPlace(40, 'Gareth', 'grossstadt'),                               // probable_match (fuzzy)
    $mapPlace(3,  'Zzqxyville', 'dorf'),                                 // unresolved_without_candidate
];
$records = [
    $dumpRecord('Konfliktstadt', 'metropole', $C, 'Aventurien', false, 'https://wiki/File:W.svg'),
    $dumpRecord('Ruinenstadt', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', true),
    $dumpRecord("Al'Anfa", 'metropole'),
    $dumpRecord('Garethh', 'grossstadt'),                               // fuzzy -> probable_match for 'Gareth'
    $dumpRecord('Lonelytown', 'dorf', $C),                              // missing_wiki_with_coordinates
    $dumpRecord('Nowhereton', 'dorf', ['source' => 'none', 'x' => null, 'y' => null]), // missing_wiki_without_coordinates
];

// ---------------------------------------------------------------------------
// Run the ONE-SHOT (the parity reference).
// ---------------------------------------------------------------------------
$pdoOneShot = new FakeCasesPdo();
$resOneShot = avesmapsWikiDumpSettlementConflictsGenerate($pdoOneShot, $RUN_ID, 0, $mapPlaces, $records);

// ---------------------------------------------------------------------------
// Run the CHUNKED stepper with batchSize=1 and an in-memory accumulator seam.
// ---------------------------------------------------------------------------
echo "\n-- (A) cursor advances across batches and terminates on finalize --\n";

$pdoChunked = new FakeCasesPdo();
$state = [];               // in-memory matched-title accumulator seam
$cursor = 0;
$steps = 0;
$phases = [];
$cursors = [$cursor];
$sawFinalize = false;
$done = false;
$MAX = 50;
while (!$done) {
    if ($steps > $MAX) {
        $check('(A0) stepper terminates within a bounded number of steps', true, false,
            'the loop ran away -- cursor/termination is broken');
        break;
    }
    $steps++;
    $step = avesmapsWikiDumpSettlementConflictsGenerateStep(
        $pdoChunked,
        $RUN_ID,
        0,
        $cursor,
        $mapPlaces,   // map-place override
        $records,     // settlement-record override
        1,            // batchSize = 1 (force many MATCH steps)
        $state        // in-memory accumulator seam (no DB table)
    );
    $phases[] = (string) ($step['phase'] ?? '');
    if (($step['phase'] ?? '') === 'finalize') {
        $sawFinalize = true;
    }
    $cursor = (int) ($step['cursor'] ?? $cursor);
    $cursors[] = $cursor;
    $done = ($step['done'] ?? false) === true;
}

$check('(A1) the run terminated (done=true) within the step ceiling', true, $done,
    'the chunked loop must reach a finalize step that reports done');
$check('(A2) the LAST step was the finalize phase', 'finalize', end($phases),
    'exactly one finalize step ends the chain');
$check('(A3) exactly one finalize step fired', 1, count(array_filter($phases, static fn($p) => $p === 'finalize')),
    'finalize is a single terminal pass, not repeated');
// MATCH steps == number of map places (batchSize 1, 8 places) -> 8 match + 1 finalize.
$check('(A4) MATCH steps == number of map places (batchSize 1)', count($mapPlaces),
    count(array_filter($phases, static fn($p) => $p === 'match')),
    'with a batch of 1, each map place is one MATCH step');

// Cursor over the MATCH steps must be strictly increasing (id high-water mark).
$matchCursorsIncrease = true;
$prev = -1;
$matchCount = count(array_filter($phases, static fn($p) => $p === 'match'));
for ($i = 0; $i < $matchCount; $i++) {
    $c = $cursors[$i + 1]; // cursors[0] is the initial 0
    if ($c <= $prev) {
        $matchCursorsIncrease = false;
        break;
    }
    $prev = $c;
}
$check('(A5) the map-place id cursor strictly increases across MATCH steps', true, $matchCursorsIncrease,
    'the cursor is a monotonic id high-water mark, so batches never overlap or stall');

// ---------------------------------------------------------------------------
// (B) PARITY: chunked union == one-shot, byte-for-byte per case.
// ---------------------------------------------------------------------------
echo "\n-- (B) chunked union == one-shot (same case_keys + case_type + payload) --\n";

$normalize = static function (FakeCasesPdo $pdo): array {
    $out = [];
    foreach ($pdo->cases as $caseKey => $row) {
        $out[$caseKey] = [
            'case_type' => (string) $row['case_type'],
            'payload_json' => (string) $row['payload_json'],
        ];
    }
    ksort($out);
    return $out;
};

$oneShotCases = $normalize($pdoOneShot);
$chunkedCases = $normalize($pdoChunked);

$check('(B1) same number of distinct cases persisted', count($oneShotCases), count($chunkedCases),
    'the chunked run writes neither more nor fewer cases than the one-shot');
$check('(B2) same set of case_keys', array_keys($oneShotCases), array_keys($chunkedCases),
    'every case_key the one-shot writes is written by the chunked run, and no extras');
$check('(B3) every case has an identical case_type + payload_json', $oneShotCases, $chunkedCases,
    'the chunked run reproduces each case byte-for-byte (identical signature/payload)');

// Sanity: prove the crafted set actually exercised BOTH per-batch and cross-batch
// types (otherwise parity would be vacuous). Count case types in the one-shot.
$typesSeen = [];
foreach ($pdoOneShot->cases as $row) {
    $typesSeen[(string) $row['case_type']] = true;
}
foreach ([
    'type_conflict', 'probable_match', 'unresolved_without_candidate', 'field_divergence',
    'coat_available', 'coordinate_drift',
    'duplicate_avesmaps_name', 'duplicate_wiki_title',
    'missing_wiki_with_coordinates', 'missing_wiki_without_coordinates',
] as $type) {
    $check("(B-sanity:$type) fired in the fixture", true, isset($typesSeen[$type]),
        "the crafted set exercises $type so parity is meaningful");
}

// ---------------------------------------------------------------------------
// (C) A wiki title that appears ONLY as a fuzzy candidate in a LATE batch is not
//     mis-reported missing (matched-title accumulator is unioned across batches).
// ---------------------------------------------------------------------------
echo "\n-- (C) fuzzy-only candidate in a late batch is not mis-reported missing --\n";

// 'Garethh' (the dump title) is only ever a FUZZY candidate of map 'Gareth'. If
// the accumulator did NOT union fuzzy candidates across batches, 'Garethh' would
// surface as a missing_wiki_* case. Assert NO missing case has wiki_title 'Garethh'
// in EITHER run (one-shot is the oracle; chunked must match it).
$hasMissingGarethh = static function (FakeCasesPdo $pdo): bool {
    foreach ($pdo->cases as $row) {
        $type = (string) $row['case_type'];
        if ($type !== 'missing_wiki_with_coordinates' && $type !== 'missing_wiki_without_coordinates') {
            continue;
        }
        $payload = json_decode((string) $row['payload_json'], true);
        $title = is_array($payload) ? (string) ($payload['wiki']['title'] ?? '') : '';
        if ($title === 'Garethh') {
            return true;
        }
    }
    return false;
};
$check('(C1) one-shot does NOT emit a missing case for the fuzzy-only title', false,
    $hasMissingGarethh($pdoOneShot), 'a fuzzily-matched title is "matched", never missing (oracle)');
$check('(C2) chunked does NOT emit a missing case for the fuzzy-only title', false,
    $hasMissingGarethh($pdoChunked),
    'the matched-title accumulator unions fuzzy candidates across batches, so it matches the oracle');

// ---------------------------------------------------------------------------
// (D) STAGING guard: the stepper writes ONLY wiki_sync_cases.
// ---------------------------------------------------------------------------
echo "\n-- (D) chunked stepper writes wiki_sync_cases only --\n";

$leaked = [];
foreach ($pdoChunked->executedSql as $sql) {
    if (preg_match('/^\s*(INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+([A-Za-z_][A-Za-z0-9_]*)/i', $sql, $m) === 1) {
        $verb = strtoupper($m[1]);
        $table = strtolower($m[2]);
        if ($table !== 'wiki_sync_cases') {
            $leaked[] = $verb . ' ' . $table;
        }
    }
}
$check('(D1) the ONLY write target was wiki_sync_cases', [], $leaked,
    'with an explicit run id + in-memory accumulator seam, wiki_sync_cases is the sole DML target');

echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
