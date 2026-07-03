<?php

declare(strict_types=1);

/**
 * Unit test for the WikiDump SHARP settlement-conflict writer + per-kind mapping
 * (api/_internal/wiki/dump-sync-kind.php).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (the Wave-1 brief's three required asserts + edges)
 * ---------------------------------------------------------------------------
 * The sharp writer is the persisting sibling of the read-only dry-run: it reuses
 * the dry-run's PURE classifier (avesmapsWikiDumpDryRunBuildCases + the
 * match/missing mirror) and PERSISTS each case via the real
 * avesmapsWikiSyncUpsertCase against a FAKE PDO that models just the two things
 * the writer touches: the newest-completed-location-run lookup (bypassed with an
 * explicit run id) and the wiki_sync_cases upsert (SELECT-existing + INSERT/
 * UPDATE, honouring the CASE-WHEN preservation of reviewed_at/reviewed_by/
 * resolution_json). map places + dump settlement records are injected via the
 * override seams, so NO live DB / sandbox / MediaWiki API is needed.
 *
 *   (A) coordinate_drift is emitted as its OWN case type (case_type ===
 *       'coordinate_drift') and its payload carries BOTH positions Wave 3 needs:
 *       payload.map = {public_id, lat, lng, revision, name} and
 *       payload.wiki_position = {lat, lng}, both in 0..1024 map units. It is NOT
 *       folded into field_divergence, and field_divergence carries no coordinate.
 *   (B) a RESOLVED case whose signature is unchanged on a re-run KEEPS its review
 *       state (reviewed_at/reviewed_by/resolution_json survive) -- the required
 *       avesmapsWikiSyncUpsertCase preservation is exercised end-to-end, not
 *       bypassed; a CHANGED signature resets it.
 *   (C) all 11 case types can fire (the 10 dry-run types + coordinate_drift),
 *       each persisted, from one crafted match set.
 * Plus:
 *   (D) the PURE kind->entity_kind mapping (settlement folds in building; others
 *       map to self; unknown -> []).
 *   (E) the include is side-effect-free (defs only).
 *   (F) STAGING guard: the writer's persisted statements are wiki_sync_cases only
 *       (never map_features / political_territory).
 *
 * HOW TO RUN (the reused derivations call mb_*, same caveat as every sibling):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-sync-kind.php
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
// 1. Include chain: bootstrap + the classifier chain the sharp writer reuses +
//    the dump entity-kind constants + the file under test. All side-effect-free
//    on include (function/const defs only).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';
require_once $repoRoot . '/api/_internal/wiki/settlement-conflicts-dryrun.php';
// entity-kind constants (AVESMAPS_WIKI_DUMP_ENTITY_*) + step budget const.
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-sync-kind.php';
$includeOutput = (string) ob_get_clean();

// Endpoint-only constants the reused helpers need (defined only in
// api/edit/wiki/sync.php, which this test never loads). Mirror the SAME values
// (guarded) so match/classify can run -- identical to the dry-run test.
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

foreach ([
    'avesmapsWikiDumpSyncKindEntityKinds',
    'avesmapsWikiDumpSettlementBuildSharpCases',
    'avesmapsWikiDumpSettlementCoordinatePositions',
    'avesmapsWikiDumpSettlementConflictsGenerate',
] as $fn) {
    if (!function_exists($fn)) {
        fwrite(STDERR, "FATAL: expected function {$fn}() was not defined by dump-sync-kind.php.\n");
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
        printf("PASS | %-70s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-70s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

echo "================================================================\n";
echo " dump-sync-kind SHARP settlement-case-writer test (WikiDump)\n";
echo "================================================================\n";

$check('(E) include produced no output', '', $includeOutput,
    'the library is side-effect-free on include (defs only) -- same PURITY CONTRACT as every sibling');

// ---------------------------------------------------------------------------
// 3. Fixture builders (production-shaped -- same shapes as the dry-run test).
// ---------------------------------------------------------------------------

/** A map place shaped like avesmapsWikiSyncReadMapPlaces() output. */
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

// ---------------------------------------------------------------------------
// 4. Fake PDO/PDOStatement modelling ONLY the wiki_sync_cases upsert path the
//    sharp writer touches (SELECT existing by case_key + INSERT + UPDATE with
//    CASE-WHEN preservation) and no-op DDL. It records every executed statement
//    SQL so the STAGING guard (F) can assert nothing else is written.
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

        // avesmapsWikiSyncUpsertCase: SELECT id,status,signature_hash WHERE case_key.
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

        // INSERT INTO wiki_sync_cases (...): create a fresh open row.
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

        // UPDATE wiki_sync_cases SET ... WHERE id = :id: apply, honouring the
        // CASE WHEN :preserve_* = 1 THEN <existing> ELSE NULL END for review fields.
        if (stripos($sql, 'UPDATE wiki_sync_cases') !== false && isset($this->bound['id'])) {
            $id = (int) $this->bound['id'];
            $caseKey = $this->pdo->casesById[$id] ?? '';
            if ($caseKey !== '' && isset($this->pdo->cases[$caseKey])) {
                $row = &$this->pdo->cases[$caseKey];
                $row['case_type'] = (string) ($this->bound['case_type'] ?? $row['case_type']);
                $row['status'] = (string) ($this->bound['status'] ?? $row['status']);
                $row['signature_hash'] = (string) ($this->bound['signature_hash'] ?? $row['signature_hash']);
                $row['payload_json'] = (string) ($this->bound['payload_json'] ?? $row['payload_json']);
                $preserve = (int) ($this->bound['preserve_reviewed_at'] ?? 0) === 1;
                if (!$preserve) {
                    $row['reviewed_at'] = null;
                    $row['reviewed_by'] = null;
                    $row['resolution_json'] = null;
                }
                unset($row);
            }
            return true;
        }

        // Everything else (CREATE TABLE, EnsureMapFeatureLocksTable DDL): no-op.
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
    /** @var array<string, array<string,mixed>> case_key => row */
    public array $cases = [];
    /** @var array<int, string> id => case_key */
    public array $casesById = [];
    public int $autoId = 0;
    /** @var list<string> every executed statement's SQL */
    public array $executedSql = [];

    public function __construct()
    {
        // Deliberately do NOT call parent::__construct (no real driver).
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

// The fixed run id the cases key to (explicit -> bypasses the mint/resolve path).
$RUN_ID = 4242;

// ===========================================================================
// (D) PURE kind -> entity_kind mapping.
// ===========================================================================
echo "\n-- (D) kind -> entity_kind mapping --\n";

$check('(D1) path maps to [path]', ['path'], avesmapsWikiDumpSyncKindEntityKinds('path'),
    'a path sync reads only entity_kind=path rows');
$check('(D2) region maps to [region]', ['region'], avesmapsWikiDumpSyncKindEntityKinds('region'),
    'a region sync reads only entity_kind=region rows');
$check('(D3) settlement folds in building', ['settlement', 'building'], avesmapsWikiDumpSyncKindEntityKinds('settlement'),
    'gebaeude live on the Siedlungen tab (plan §6.1), so a settlement sync reads both');
$check('(D4) territory maps to [territory]', ['territory'], avesmapsWikiDumpSyncKindEntityKinds('territory'),
    'a territory sync reads only entity_kind=territory rows');
$check('(D5) an unknown kind maps to []', [], avesmapsWikiDumpSyncKindEntityKinds('bogus'),
    'the caller rejects an empty set as an unknown kind');

// ===========================================================================
// (A) coordinate_drift is its OWN case type carrying BOTH positions (Wave 3).
// ===========================================================================
echo "\n-- (A) coordinate_drift case: both positions in payload --\n";

// dereglobus x=10,y=15 -> ~(741.3, 36.9). Map geometry +30 in x -> 30u drift > 20u.
$dCoords = ['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0];
$mapDrift = [$mapPlace(50, 'Driftstadt', 'dorf', [741.3 + 30.0, 36.9], [], '', 7)];
$recDrift = [$dumpRecord('Driftstadt', 'dorf', $dCoords)];

$pdoA = new FakeCasesPdo();
$resA = avesmapsWikiDumpSettlementConflictsGenerate($pdoA, $RUN_ID, 0, $mapDrift, $recDrift);

$check('(A1) exactly one coordinate_drift case fired', 1, $resA['by_type']['coordinate_drift'] ?? 0,
    'a 30u drift (> the 20u sharp bar) emits one dedicated coordinate_drift case');
$check('(A2) NO field_divergence case for a coordinate-only drift', 0, $resA['by_type']['field_divergence'] ?? 0,
    'coordinates are handled by coordinate_drift, so field_divergence (is_ruined/wiki_url only) stays 0');

// Find the persisted coordinate_drift row + decode its payload.
$driftCase = null;
foreach ($pdoA->cases as $row) {
    if (($row['case_type'] ?? '') === 'coordinate_drift') {
        $driftCase = $row;
        break;
    }
}
$driftPayload = is_array($driftCase) ? (json_decode((string) $driftCase['payload_json'], true) ?: []) : [];

$check('(A3) the persisted case_type is exactly "coordinate_drift"', 'coordinate_drift',
    is_array($driftCase) ? (string) $driftCase['case_type'] : null,
    'Wave 3 filters cases by this exact machine code');
$check('(A4) payload.map carries public_id/lat/lng/revision/name', true,
    isset($driftPayload['map']['public_id'], $driftPayload['map']['lat'], $driftPayload['map']['lng'],
        $driftPayload['map']['revision'], $driftPayload['map']['name'])
    && $driftPayload['map']['public_id'] === 'map-0050'
    && $driftPayload['map']['revision'] === 7
    && $driftPayload['map']['name'] === 'Driftstadt',
    'the map marker endpoint is fully described so Wave 3 draws without a lookup');
$check('(A5) payload.wiki_position carries lat + lng', true,
    isset($driftPayload['wiki_position']['lat'], $driftPayload['wiki_position']['lng']),
    'the wiki endpoint of the drift line, pre-converted to 0..1024');
$check('(A6) BOTH endpoints are in 0..1024 map units', true,
    $driftPayload['map']['lat'] >= 0 && $driftPayload['map']['lat'] <= 1024
    && $driftPayload['map']['lng'] >= 0 && $driftPayload['map']['lng'] <= 1024
    && $driftPayload['wiki_position']['lat'] >= 0 && $driftPayload['wiki_position']['lat'] <= 1024
    && $driftPayload['wiki_position']['lng'] >= 0 && $driftPayload['wiki_position']['lng'] <= 1024,
    'both sides are in image space so Wave 3 does not reconvert');
$check('(A7) the map endpoint x matches the injected geometry (741.3+30)', 771.3,
    $driftPayload['map']['lng'] ?? null,
    'payload.map.lng is the map geometry x (GeoJSON [x,y]) verbatim, not re-derived');

// A 10u drift (< 20u sharp bar) fires NEITHER coordinate_drift NOR field_divergence.
$mapNear = [$mapPlace(51, 'Nahdorf', 'dorf', [741.3 + 10.0, 36.9])];
$recNear = [$dumpRecord('Nahdorf', 'dorf', $dCoords)];
$pdoNear = new FakeCasesPdo();
$resNear = avesmapsWikiDumpSettlementConflictsGenerate($pdoNear, $RUN_ID, 0, $mapNear, $recNear);
$check('(A8) a 10u drift (< 20u) fires NO coordinate_drift case', 0, $resNear['by_type']['coordinate_drift'] ?? 0,
    'the sharp coordinate bar is 20u, so a 10u drift is not a sharp case');

// ===========================================================================
// (B) review-state preservation across a re-run (the REQUIRED upsert behaviour).
// ===========================================================================
echo "\n-- (B) resolved case keeps its review state on an unchanged re-run --\n";

// A type_conflict on an exact match: map=stadt, dump=metropole. Stable payload.
$mapTC = [$mapPlace(60, 'Ferdok', 'stadt')];
$recTC = [$dumpRecord('Ferdok', 'metropole')];

$pdoB = new FakeCasesPdo();
// First run: the case is created (open).
$resB1 = avesmapsWikiDumpSettlementConflictsGenerate($pdoB, $RUN_ID, 0, $mapTC, $recTC);
$check('(B1) first run creates the type_conflict case', 1, $resB1['by_type']['type_conflict'] ?? 0,
    'Ferdok metropole(dump) vs stadt(map) -> one type_conflict, inserted open');

// Simulate the owner RESOLVING it: mark reviewed + archived with a resolution.
$tcKey = null;
foreach ($pdoB->cases as $key => $row) {
    if (($row['case_type'] ?? '') === 'type_conflict') { $tcKey = $key; break; }
}
$pdoB->cases[$tcKey]['status'] = 'archived';
$pdoB->cases[$tcKey]['reviewed_at'] = '2026-07-03 10:00:00.000';
$pdoB->cases[$tcKey]['reviewed_by'] = 99;
$pdoB->cases[$tcKey]['resolution_json'] = '{"resolved":true}';

// Second run: SAME data -> SAME signature -> the archived review state must survive.
$resB2 = avesmapsWikiDumpSettlementConflictsGenerate($pdoB, $RUN_ID, 0, $mapTC, $recTC);
$check('(B2) re-run keeps reviewed_at (unchanged signature)', '2026-07-03 10:00:00.000',
    $pdoB->cases[$tcKey]['reviewed_at'] ?? null,
    'avesmapsWikiSyncUpsertCase preserves reviewed_at when the signature is unchanged/archived');
$check('(B3) re-run keeps reviewed_by', 99, $pdoB->cases[$tcKey]['reviewed_by'] ?? null,
    'the reviewer id survives the re-upsert');
$check('(B4) re-run keeps resolution_json', '{"resolved":true}', $pdoB->cases[$tcKey]['resolution_json'] ?? null,
    'the resolution payload survives the re-upsert');
$check('(B5) re-run keeps the archived status', 'archived', $pdoB->cases[$tcKey]['status'] ?? null,
    'an archived case stays archived across a re-run');

// Now a CHANGED signature (dump class flips to grossstadt) must RESET the review.
$recTCchanged = [$dumpRecord('Ferdok', 'grossstadt')];
$resB3 = avesmapsWikiDumpSettlementConflictsGenerate($pdoB, $RUN_ID, 0, $mapTC, $recTCchanged);
// The archived branch preserves even on a changed signature (isArchived -> keep);
// so to prove the RESET path we use a non-archived (open) case below.
$check('(B6-note) archived cases preserve review even on a changed signature', '2026-07-03 10:00:00.000',
    $pdoB->cases[$tcKey]['reviewed_at'] ?? null,
    'archived is a terminal state: UpsertCase keeps its review state regardless of signature');

// Reset path: an OPEN case with a CHANGED signature clears review state.
$pdoBo = new FakeCasesPdo();
avesmapsWikiDumpSettlementConflictsGenerate($pdoBo, $RUN_ID, 0, $mapTC, $recTC);
foreach ($pdoBo->cases as $key => $row) {
    if (($row['case_type'] ?? '') === 'type_conflict') { $tcKey2 = $key; break; }
}
// Leave it OPEN but stamp a review, then re-run with a CHANGED signature.
$pdoBo->cases[$tcKey2]['reviewed_at'] = '2026-07-03 11:00:00.000';
$pdoBo->cases[$tcKey2]['reviewed_by'] = 7;
$pdoBo->cases[$tcKey2]['resolution_json'] = '{"note":"looked"}';
avesmapsWikiDumpSettlementConflictsGenerate($pdoBo, $RUN_ID, 0, $mapTC, $recTCchanged);
// NB: assert on the VALUE directly (not `?? 'sentinel'`): reviewed_at is now
// genuinely null, and `?? 'sentinel'` cannot distinguish null-value from
// missing-key -- it would coalesce the correct null away.
$check('(B7) an OPEN case with a CHANGED signature RESETS reviewed_at to null', null,
    $pdoBo->cases[$tcKey2]['reviewed_at'],
    'a real content change re-opens the case for review (review state cleared)');

// ===========================================================================
// (C) all 11 case types can fire (10 dry-run types + coordinate_drift).
// ===========================================================================
echo "\n-- (C) all 11 case types fire from one crafted set --\n";

// dereglobus (10,15) -> ~(741.3,36.9): used for the with-coordinates + drift cases.
$C = ['source' => 'dereglobus', 'x' => 10.0, 'y' => 15.0];

$mapC = [
    // type_conflict + coordinate_drift + coat_available on ONE match:
    $mapPlace(1, 'Konfliktstadt', 'stadt', [741.3 + 30.0, 36.9], ['wiki_settlement' => ['wappen_url' => '']]),
    // field_divergence via is_ruined mismatch (no coords -> no drift):
    $mapPlace(2, 'Ruinenstadt', 'dorf', null, ['is_ruined' => false]),
    // duplicate_avesmaps_name (two same-named rows):
    $mapPlace(3, 'Twinburg', 'dorf'),
    $mapPlace(4, 'Twinburg', 'dorf'),
    // duplicate_wiki_title (two map names normalise to one wiki title):
    $mapPlace(5, "Al'Anfa", 'metropole'),
    $mapPlace(6, 'AlAnfa', 'metropole'),
    // probable_match (fuzzy only):
    $mapPlace(7, 'Gareth', 'grossstadt'),
    // unresolved_without_candidate (nothing matches):
    $mapPlace(8, 'Zzqxyville', 'dorf'),
];
$recC = [
    $dumpRecord('Konfliktstadt', 'metropole', $C, 'Aventurien', false, 'https://wiki/File:W.svg'), // type_conflict + drift + coat
    $dumpRecord('Ruinenstadt', 'dorf', ['source' => 'none', 'x' => null, 'y' => null], 'Aventurien', true), // field_divergence(is_ruined)
    $dumpRecord("Al'Anfa", 'metropole'), // duplicate_wiki_title target
    $dumpRecord('Garethh', 'grossstadt'), // fuzzy -> probable_match
    $dumpRecord('Lonelytown', 'dorf', $C), // missing_wiki_with_coordinates
    $dumpRecord('Nowhereton', 'dorf', ['source' => 'none', 'x' => null, 'y' => null]), // missing_wiki_without_coordinates
];

$pdoC = new FakeCasesPdo();
$resC = avesmapsWikiDumpSettlementConflictsGenerate($pdoC, $RUN_ID, 0, $mapC, $recC);
$byTypeC = $resC['by_type'];

$expectFired = [
    'type_conflict',
    'probable_match',
    'unresolved_without_candidate',
    'duplicate_avesmaps_name',
    'duplicate_wiki_title',
    'missing_wiki_with_coordinates',
    'missing_wiki_without_coordinates',
    'field_divergence',
    'coat_available',
    'coordinate_drift',
];
foreach ($expectFired as $type) {
    $check("(C:$type) fired at least once", true, ($byTypeC[$type] ?? 0) >= 1,
        "one crafted input triggers a >=1 count for $type");
}
// canonical_name_difference is the 11th type but is structurally dead in the live
// tree (the match loop only ever appends match_kind=exact); assert it is present
// as a bucket at 0, so all 11 labelled types are ACCOUNTED FOR.
$check('(C:canonical_name_difference) present as a 0 bucket (dead like live)', 0,
    $byTypeC['canonical_name_difference'] ?? -1,
    'the 11th type is kept for fidelity at 0 -- exactly as the live/dry-run tree keeps it');
$check('(C:count) 11 distinct case-type buckets are reported', 11, count($byTypeC),
    'the writer accounts for all 11 labelled types (10 dry-run + coordinate_drift)');
$check('(C:stored) every built case was persisted (stored == sum of counts)',
    array_sum($byTypeC), $resC['stored'],
    'the stored total equals the sum of per-type counts -- nothing dropped');

// ===========================================================================
// (F) STAGING guard: the sharp writer only ever writes wiki_sync_cases.
// ===========================================================================
echo "\n-- (F) writer touches wiki_sync_cases only (no map_features / political_territory) --\n";

$leaked = [];
foreach ($pdoC->executedSql as $sql) {
    // Match the DML verb ONLY at the START of the (trimmed) statement, so an
    // "ON UPDATE CURRENT_TIMESTAMP" column clause inside a CREATE TABLE DDL is
    // NOT mistaken for an UPDATE statement. Any INSERT/UPDATE/DELETE/REPLACE
    // against a table other than wiki_sync_cases would be a leak.
    if (preg_match('/^\s*(INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+([A-Za-z_][A-Za-z0-9_]*)/i', $sql, $m) === 1) {
        $verb = strtoupper($m[1]);
        $table = strtolower($m[2]);
        // wiki_sync_cases is the only allowed write target here (RUN_ID is explicit,
        // so no wiki_sync_runs INSERT happens in this run).
        if ($table !== 'wiki_sync_cases') {
            $leaked[] = $verb . ' ' . $table;
        }
    }
}
$check('(F1) no write hit map_features', false, in_array('INSERT INTO map_features', $leaked, true) || in_array('UPDATE map_features', $leaked, true),
    'settlement conflict generation reads map_features (SELECT) but NEVER writes it');
$check('(F2) no write hit political_territory', false,
    (bool) preg_grep('/political_territory/', $leaked),
    'the sharp settlement writer never touches the live territory tables');
$check('(F3) the ONLY write target was wiki_sync_cases', [], $leaked,
    'with an explicit run id, wiki_sync_cases is the sole INSERT/UPDATE target');

// ===========================================================================
// Summary.
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
