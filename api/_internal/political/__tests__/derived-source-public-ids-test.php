<?php

declare(strict_types=1);

/**
 * Finding A20: the derived political layer resolved its source public_ids with TWO QUERIES PER
 * FEATURE. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/derived-source-public-ids-test.php
 * Exit 0 = all asserts passed.
 *
 * Two halves, and the split is deliberate:
 *   * The SOURCE asserts run everywhere, with no database. They are the guard against someone
 *     putting a per-feature read back into that loop -- which is the whole finding.
 *   * The BEHAVIOUR asserts need pdo_sqlite. They carry a literal copy of the two functions the
 *     change deleted and compare the batched answer against them, feature by feature. Without that
 *     oracle the test would only prove the new code agrees with itself.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-derived-geometry.php';
require_once __DIR__ . '/../territories-derived-geometry-shared.php';
require_once __DIR__ . '/../territories-derived-layer.php';

// ===== 1. THE SOURCE: no per-feature read may return to that loop =================================

$layerSource = file_get_contents(__DIR__ . '/../territories-derived-layer.php');
assert(is_string($layerSource) && $layerSource !== '', 'the layer source is readable');

// 💣 The two deleted names, asserted as ABSENT. They were the N+1: one IN-query each, for one
// feature, called from inside the foreach -- 244 queries on a zoom-3 cache miss.
assert(
    !str_contains($layerSource, 'function avesmapsPoliticalReadDerivedSourceTerritoryPublicIds'),
    'the per-feature territory reader is gone'
);
assert(
    !str_contains($layerSource, 'function avesmapsPoliticalReadDerivedSourceGeometryPublicIds'),
    'the per-feature geometry reader is gone'
);
assert(
    function_exists('avesmapsPoliticalResolveDerivedLayerSourcePublicIds'),
    'and one batched resolver stands in their place'
);

// 💣 The stronger guard, because a new name could repeat the same mistake: between the head of the
// derived loop and its closing `unset($feature);` there must be NO ->prepare( and no ->query(.
$loopAt = strpos($layerSource, 'foreach ($derivedFeatures as $featureKey => &$feature) {');
$loopEndAt = strpos($layerSource, 'unset($feature);', (int) $loopAt);
assert(is_int($loopAt) && is_int($loopEndAt), 'the derived loop is where it is expected');
$loopBody = substr($layerSource, $loopAt, $loopEndAt - $loopAt);
assert(
    !str_contains($loopBody, '->prepare(') && !str_contains($loopBody, '->query('),
    'no statement is prepared per derived feature any more'
);
// And the resolver is called BEFORE the loop, once.
assert(
    substr_count($layerSource, 'avesmapsPoliticalResolveDerivedLayerSourcePublicIds($pdo, $derivedFeatures') === 1,
    'the resolver runs exactly once, for all features together'
);
assert(
    strpos($layerSource, 'avesmapsPoliticalResolveDerivedLayerSourcePublicIds($pdo, $derivedFeatures') < (int) $loopAt,
    'and it runs before the loop, not inside it'
);

// 💣 Two prepares in the resolver, no more -- that IS the finding's number.
$resolverAt = strpos($layerSource, 'function avesmapsPoliticalResolveDerivedLayerSourcePublicIds');
$resolverEndAt = strpos($layerSource, 'function avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds', (int) $resolverAt);
$resolverBody = substr($layerSource, (int) $resolverAt, (int) $resolverEndAt - (int) $resolverAt);
assert(substr_count($resolverBody, '->prepare(') === 2, 'the resolver prepares exactly two statements');
// ⚠️ The batched geometry query must SELECT territory_id -- it is what assigns a geometry back to
// the feature that asked. The per-feature version could leave it out; this one cannot.
assert(
    str_contains($resolverBody, 'SELECT geometry.territory_id, geometry.public_id'),
    'the geometry query returns the territory_id it groups by'
);
// The two filters that decide what an active source is. Dropping either changes the payload.
assert(
    str_contains($resolverBody, 'geometry.is_active = 1') && str_contains($resolverBody, 'territory.is_active = 1'),
    'both is_active filters survive the batching'
);

// ===== 2. THE BEHAVIOUR: batched must equal the code it replaced =================================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    echo "derived-source-public-ids: source asserts ok (pdo_sqlite missing -- behaviour half skipped)\n";
    exit(0);
}

// --- the oracle: a literal copy of the two functions this change deleted -------------------------
function avesmapsTestOracleReadSourceTerritoryPublicIds(PDO $pdo, array $derivedFeature, ?array $territoriesSnapshot = null): array {
    $sourceTerritoryIds = avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds($pdo, $derivedFeature, $territoriesSnapshot);
    if ($sourceTerritoryIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($sourceTerritoryIds), '?'));
    $statement = $pdo->prepare(
        'SELECT public_id
        FROM political_territory
        WHERE id IN (' . $placeholders . ')
            AND is_active = 1'
    );
    $statement->execute($sourceTerritoryIds);

    $publicIds = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $publicIds[] = $publicId;
        }
    }

    return array_values(array_unique($publicIds));
}

function avesmapsTestOracleReadSourceGeometryPublicIds(PDO $pdo, array $derivedFeature, ?array $territoriesSnapshot = null): array {
    $sourceTerritoryIds = avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds($pdo, $derivedFeature, $territoriesSnapshot);
    if ($sourceTerritoryIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($sourceTerritoryIds), '?'));
    $statement = $pdo->prepare(
        'SELECT geometry.public_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1
            AND geometry.territory_id IN (' . $placeholders . ')'
    );
    $statement->execute($sourceTerritoryIds);

    $publicIds = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($publicId !== '') {
            $publicIds[] = $publicId;
        }
    }

    return array_values(array_unique($publicIds));
}

// Counts prepared statements, which is the unit the finding is stated in.
final class AvesmapsCountingPdo extends PDO
{
    public int $prepareCount = 0;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->prepareCount += 1;

        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsCountingPdo('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, slug TEXT, name TEXT,
        short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT, color TEXT,
        opacity REAL, valid_from_bf INTEGER, valid_to_bf INTEGER, min_zoom INTEGER,
        max_zoom INTEGER, sort_order INTEGER, is_active INTEGER
    )'
);
$pdo->exec('CREATE TABLE political_territory_geometry (id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER)');

// id | public_id | parent | continent  | active | what it is here for
//  1 | p1        | 0      | Aventurien |   1    | the parent of the aggregate
//  2 | p2        | 1      | Aventurien |   1    | its one active child, with TWO geometries
//  3 | p3        | 1      | Aventurien |   0    | an inactive child: not in the snapshot, no descendant
//  4 | p4        | 0      | Aventurien |   0    | inactive territory that still owns an ACTIVE geometry
//  5 | p5        | 0      | Aventurien |   1    | active territory whose only geometry is INACTIVE
//  6 | p6        | 0      | Myranor    |   1    | 💣 another continent -- absent from the snapshot
$territoryRows = [
    [1, 'p1', 0, 'Aventurien', 1],
    [2, 'p2', 1, 'Aventurien', 1],
    [3, 'p3', 1, 'Aventurien', 0],
    [4, 'p4', 0, 'Aventurien', 0],
    [5, 'p5', 0, 'Aventurien', 1],
    [6, 'p6', 0, 'Myranor', 1],
];
$insertTerritory = $pdo->prepare('INSERT INTO political_territory (id, public_id, parent_id, continent, is_active, sort_order, name) VALUES (?, ?, ?, ?, ?, 0, ?)');
foreach ($territoryRows as $row) {
    $insertTerritory->execute([$row[0], $row[1], $row[2], $row[3], $row[4], $row[1]]);
}

$geometryRows = [
    [10, 'g1', 1, 1],
    [11, 'g2a', 2, 1],
    [12, 'g2b', 2, 1],
    [13, 'g3', 3, 1],   // its territory is inactive -> the JOIN drops it
    [14, 'g4', 4, 1],   // same
    [15, 'g5', 5, 0],   // the geometry itself is inactive
    [16, 'g6', 6, 1],
];
$insertGeometry = $pdo->prepare('INSERT INTO political_territory_geometry (id, public_id, territory_id, is_active) VALUES (?, ?, ?, ?)');
foreach ($geometryRows as $row) {
    $insertGeometry->execute($row);
}

$derivedFeatures = [
    'a' => ['properties' => ['derived_territory_id' => 1]],   // parent + descendants
    'b' => ['properties' => ['derived_territory_id' => 2]],   // 💣 shares id 2 with 'a'
    'c' => ['properties' => ['derived_territory_id' => 5]],   // territory yes, geometry no
    'd' => ['properties' => ['derived_territory_id' => 4]],   // inactive territory
    'e' => ['properties' => []],                              // names nothing at all
    'f' => ['properties' => ['derived_territory_id' => 999]], // an id that does not exist
    'g' => ['properties' => ['derived_territory_id' => 6]],   // 💣 off-snapshot continent
];

$snapshot = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
// The premise of the 💣 comment in the resolver, asserted rather than assumed: the snapshot really
// does NOT contain every territory a source list can name. Whoever "optimises" the first query away
// by reading public_id out of it loses exactly these two.
assert(!isset($snapshot[6]), 'the snapshot is continent-filtered -- territory 6 is not in it');
assert(!isset($snapshot[4]), 'nor is the inactive territory 4');

// --- the oracle's answer, and what it costs ------------------------------------------------------
$pdo->prepareCount = 0;
$expected = [];
foreach ($derivedFeatures as $featureKey => $feature) {
    $expected[$featureKey] = [
        'territory' => avesmapsTestOracleReadSourceTerritoryPublicIds($pdo, $feature, $snapshot),
        'geometry' => avesmapsTestOracleReadSourceGeometryPublicIds($pdo, $feature, $snapshot),
    ];
}
$oracleQueries = $pdo->prepareCount;

// --- the batched answer, and what it costs -------------------------------------------------------
$pdo->prepareCount = 0;
$actual = avesmapsPoliticalResolveDerivedLayerSourcePublicIds($pdo, $derivedFeatures, $snapshot);
$batchedQueries = $pdo->prepareCount;

// Order is not part of the contract -- every consumer builds a Set (see the resolver's comment) --
// so compare as sets, which is what the change actually promises to preserve.
$sorted = static function (array $values): array {
    sort($values);

    return $values;
};
assert(array_keys($actual) === array_keys($expected), 'every feature gets an entry, under its own key');
foreach ($expected as $featureKey => $lists) {
    assert(
        $sorted($actual[$featureKey]['territory']) === $sorted($lists['territory']),
        "feature {$featureKey}: same source territories as before the batching"
    );
    assert(
        $sorted($actual[$featureKey]['geometry']) === $sorted($lists['geometry']),
        "feature {$featureKey}: same source geometries as before the batching"
    );
}

// The fixture is only worth something if it actually exercises the cases it names.
assert($sorted($actual['a']['territory']) === ['p1', 'p2'], 'a: parent and its one ACTIVE child');
assert($sorted($actual['a']['geometry']) === ['g1', 'g2a', 'g2b'], 'a: both of the child geometries');
assert($actual['b']['territory'] === ['p2'], 'b: the shared id resolves for b too, not only for a');
assert($sorted($actual['b']['geometry']) === ['g2a', 'g2b'], 'b: and it gets both geometries');
assert($actual['c']['territory'] === ['p5'], 'c: the territory is active');
assert($actual['c']['geometry'] === [], 'c: but its only geometry is not');
assert($actual['d']['territory'] === [], 'd: an inactive territory contributes no public_id');
assert($actual['d']['geometry'] === [], 'd: and the JOIN drops its active geometry with it');
assert($actual['e']['territory'] === [] && $actual['e']['geometry'] === [], 'e: nothing named, nothing returned');
assert($actual['f']['territory'] === [] && $actual['f']['geometry'] === [], 'f: an unknown id resolves to nothing');
assert($actual['g']['territory'] === ['p6'], '💣 g: off-snapshot, and still resolved');
assert($actual['g']['geometry'] === ['g6'], '💣 g: its geometry too');

// --- the point of the whole change ---------------------------------------------------------------
assert($oracleQueries === 12, "the deleted code cost 2 queries per feature that names a source (got {$oracleQueries})");
assert($batchedQueries === 2, "the batched resolver costs 2 for the whole layer (got {$batchedQueries})");

// And it stays 2 when the layer grows -- that is what "no N+1" means.
$manyFeatures = [];
for ($i = 0; $i < 60; $i += 1) {
    $manyFeatures[$i] = ['properties' => ['derived_territory_id' => ($i % 6) + 1]];
}
$pdo->prepareCount = 0;
$many = avesmapsPoliticalResolveDerivedLayerSourcePublicIds($pdo, $manyFeatures, $snapshot);
assert($pdo->prepareCount === 2, 'still two queries at 60 features, not 120');
assert(count($many) === 60, 'and every one of them gets its answer');

// The empty layer asks nothing at all, exactly as the old readers' empty guard did.
$pdo->prepareCount = 0;
$none = avesmapsPoliticalResolveDerivedLayerSourcePublicIds($pdo, ['x' => ['properties' => []]], $snapshot);
assert($pdo->prepareCount === 0, 'a layer whose features name no source runs no query');
assert($none === ['x' => ['territory' => [], 'geometry' => []]], 'and still answers in the agreed shape');

echo "derived-source-public-ids ok ({$oracleQueries} queries before, {$batchedQueries} after)\n";
