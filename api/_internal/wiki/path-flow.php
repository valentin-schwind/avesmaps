<?php

declare(strict_types=1);

// River flow-direction engine (docs/superpowers/specs/2026-07-05-flussrichtung-design.md).
// Pure functions in this file are CLI-testable without a DB (pattern: path-verlauf.php);
// DB-backed derive/set actions are added by later tasks IN THIS FILE. No top-level requires.

const AVESMAPS_PATH_FLOW_FACTOR_DEFAULT = 1.5;
const AVESMAPS_PATH_FLOW_FACTOR_MIN = 1.0;
const AVESMAPS_PATH_FLOW_FACTOR_MAX = 3.0;

function avesmapsPathFlowClampFactor(float $factor): float {
    if (!is_finite($factor)) {
        return AVESMAPS_PATH_FLOW_FACTOR_DEFAULT;
    }
    return max(AVESMAPS_PATH_FLOW_FACTOR_MIN, min(AVESMAPS_PATH_FLOW_FACTOR_MAX, $factor));
}

// Normalizes a raw properties.flow value. Null unless dir is valid (missing dir => the
// segment is symmetric, requirement 4). factor defaults to 1.5 and is clamped; source
// defaults to 'editor'.
function avesmapsPathFlowNormalize(mixed $flow): ?array {
    if (!is_array($flow)) {
        return null;
    }
    $dir = (string) ($flow['dir'] ?? '');
    if ($dir !== 'forward' && $dir !== 'reverse') {
        return null;
    }
    $factorRaw = $flow['factor'] ?? null;
    $factor = is_numeric($factorRaw) ? avesmapsPathFlowClampFactor((float) $factorRaw) : AVESMAPS_PATH_FLOW_FACTOR_DEFAULT;
    $source = (string) ($flow['source'] ?? '');
    if ($source !== 'verlauf-sync' && $source !== 'editor') {
        $source = 'editor';
    }
    return ['dir' => $dir, 'factor' => $factor, 'source' => $source];
}

// Walks ONE routed hop's segments in route order and records, per traversed OCCURRENCE,
// whether the segment ran in stored coordinate order ('forward') or against it ('reverse').
// Router segments are raw graph connections: from_node/to_node carry the STORED slice
// orientation (from = earlier coordinate index) while the traversal is implied by the chain
// (the hop enters at $startNode). ok=false when the chain breaks -- callers must then drop
// the whole hop (safety rule: no dir from broken data).
function avesmapsPathFlowHopOrientations(array $segments, string $startNode): array {
    $occurrences = [];
    $current = $startNode;
    foreach ($segments as $segment) {
        $from = (string) ($segment['from_node'] ?? '');
        $to = (string) ($segment['to_node'] ?? '');
        $publicId = (string) ($segment['public_id'] ?? '');
        if ($from === '' || $to === '' || $from === $to) {
            return ['ok' => false, 'occurrences' => []];
        }
        if ($from === $current) {
            $orientation = 'forward';
            $current = $to;
        } elseif ($to === $current) {
            $orientation = 'reverse';
            $current = $from;
        } else {
            return ['ok' => false, 'occurrences' => []];
        }
        if ($publicId !== '') {
            $occurrences[] = ['public_id' => $publicId, 'orientation' => $orientation];
        }
    }
    return ['ok' => true, 'occurrences' => $occurrences];
}

// Merges occurrences across all routable hops into a per-feature verdict. $wayPublicIds
// restricts the result to segments assigned to the way (a hop may legitimately traverse
// FOREIGN segments -- tributaries -- which must not get a dir here). A public_id seen in
// more than one orientation (dead-end spur in/out, opposing hops) is ambiguous => no dir.
function avesmapsPathFlowCombineOrientations(array $occurrences, array $wayPublicIds): array {
    $wayIndex = array_fill_keys(array_map('strval', $wayPublicIds), true);
    $seen = [];
    foreach ($occurrences as $occurrence) {
        $publicId = (string) ($occurrence['public_id'] ?? '');
        $orientation = (string) ($occurrence['orientation'] ?? '');
        if ($publicId === '' || !isset($wayIndex[$publicId])) {
            continue;
        }
        if ($orientation !== 'forward' && $orientation !== 'reverse') {
            continue;
        }
        $seen[$publicId][$orientation] = true;
    }
    $dirByPublicId = [];
    $ambiguous = [];
    foreach ($seen as $publicId => $orientations) {
        if (count($orientations) === 1) {
            $dirByPublicId[$publicId] = array_key_first($orientations);
        } else {
            $ambiguous[] = $publicId;
        }
    }
    return ['dir_by_public_id' => $dirByPublicId, 'ambiguous' => $ambiguous];
}

// Write plan for one derivation run. The derivation OWNS the way's dir state:
//   determined   => dir = derived, source = 'verlauf-sync' (overwrites manual dir -- wiki wins)
//   undetermined => dir + source removed (a leftover editor dir would point against wiki-
//                   directed neighbours after a flip+sync sequence)
//   factor is NEVER touched; a flow object left empty is removed entirely (flow => null).
// $currentFlowByPublicId: public_id => raw properties.flow (array|null) for ALL way segments.
function avesmapsPathFlowPlanWrites(array $dirByPublicId, array $currentFlowByPublicId): array {
    $writes = [];
    $set = 0;
    $cleared = 0;
    $unchanged = 0;
    foreach ($currentFlowByPublicId as $publicId => $currentRaw) {
        $publicId = (string) $publicId;
        $current = is_array($currentRaw) ? $currentRaw : [];
        $new = $current;
        if (isset($dirByPublicId[$publicId])) {
            $new['dir'] = $dirByPublicId[$publicId];
            $new['source'] = 'verlauf-sync';
        } else {
            unset($new['dir'], $new['source']);
        }
        if ($new == $current) {  // loose compare: key order must not force a write
            $unchanged++;
            continue;
        }
        $writes[$publicId] = ['flow' => $new === [] ? null : $new];
        if (isset($dirByPublicId[$publicId])) {
            $set++;
        } else {
            $cleared++;
        }
    }
    return ['writes' => $writes, 'set' => $set, 'cleared' => $cleared, 'unchanged' => $unchanged];
}

// Way-wide flip: inverts dir on every segment that HAS one; undirected segments stay
// undirected (flip never invents direction). Flipped segments become source 'editor'.
function avesmapsPathFlowPlanFlip(array $currentFlowByPublicId): array {
    $writes = [];
    $flipped = 0;
    foreach ($currentFlowByPublicId as $publicId => $currentRaw) {
        $current = is_array($currentRaw) ? $currentRaw : [];
        $dir = (string) ($current['dir'] ?? '');
        if ($dir !== 'forward' && $dir !== 'reverse') {
            continue;
        }
        $new = $current;
        $new['dir'] = $dir === 'forward' ? 'reverse' : 'forward';
        $new['source'] = 'editor';
        $writes[(string) $publicId] = ['flow' => $new];
        $flipped++;
    }
    return ['writes' => $writes, 'flipped' => $flipped];
}

// Way-wide Stroemungsfaktor (owner-owned, spec §6). Written onto EVERY segment of the way --
// also dir-less ones, so a later derivation immediately travels with the owner's factor.
function avesmapsPathFlowPlanFactor(array $currentFlowByPublicId, float $factor): array {
    $factor = avesmapsPathFlowClampFactor($factor);
    $writes = [];
    $updated = 0;
    foreach ($currentFlowByPublicId as $publicId => $currentRaw) {
        $current = is_array($currentRaw) ? $currentRaw : [];
        $currentFactor = $current['factor'] ?? null;
        if (is_numeric($currentFactor) && abs((float) $currentFactor - $factor) < 0.000001) {
            continue;
        }
        $new = $current;
        $new['factor'] = $factor;
        $writes[(string) $publicId] = ['flow' => $new];
        $updated++;
    }
    return ['writes' => $writes, 'updated' => $updated, 'factor' => $factor];
}

// ---------------------------------------------------------------------------------------
// "Richtung festlegen" (spec §6): geometric main-chain orientation for undirected ways.
// ---------------------------------------------------------------------------------------

function avesmapsPathFlowEndpointKey(array $coordinate): string {
    return sprintf('%.5f:%.5f', (float) ($coordinate[0] ?? 0.0), (float) ($coordinate[1] ?? 0.0));
}

// Hand-drawn river segments rarely share EXACT endpoint coordinates: they meet with
// sub-unit gaps and connect in routing through shared location nodes (endpoint threshold
// 0.5 per side). Exact-key matching therefore fragments real chains into mini-pieces.
// Two endpoints within 0.5 of the same location are at most 1.0 apart.
const AVESMAPS_PATH_FLOW_ENDPOINT_EPS = 1.0;

// Clusters all segment endpoints within EPS map units (union-find) and returns, per
// public_id, the node ids of its two ends: [pid => ['a' => nodeId, 'b' => nodeId]].
// Node ids are deterministic (lexicographically smallest exact key in the cluster).
// A segment shorter than the cluster radius ends up with a === b (node-internal stub).
function avesmapsPathFlowEndpointNodes(array $coordinatesByPublicId, float $eps = AVESMAPS_PATH_FLOW_ENDPOINT_EPS): array {
    $points = [];
    foreach ($coordinatesByPublicId as $publicId => $coordinates) {
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        $first = is_array($coordinates[0]) ? $coordinates[0] : [];
        $last = is_array($coordinates[count($coordinates) - 1]) ? $coordinates[count($coordinates) - 1] : [];
        $points[] = ['pid' => (string) $publicId, 'end' => 'a', 'x' => (float) ($first[0] ?? 0.0), 'y' => (float) ($first[1] ?? 0.0)];
        $points[] = ['pid' => (string) $publicId, 'end' => 'b', 'x' => (float) ($last[0] ?? 0.0), 'y' => (float) ($last[1] ?? 0.0)];
    }
    $count = count($points);
    if ($count === 0) {
        return [];
    }
    $parent = range(0, $count - 1);
    $find = static function (int $i) use (&$parent): int {
        while ($parent[$i] !== $i) {
            $parent[$i] = $parent[$parent[$i]];
            $i = $parent[$i];
        }
        return $i;
    };
    for ($i = 0; $i < $count; $i++) {
        for ($j = $i + 1; $j < $count; $j++) {
            if (hypot($points[$i]['x'] - $points[$j]['x'], $points[$i]['y'] - $points[$j]['y']) <= $eps) {
                $parent[$find($j)] = $find($i);
            }
        }
    }
    $clusterKeys = [];
    for ($i = 0; $i < $count; $i++) {
        $root = $find($i);
        $key = avesmapsPathFlowEndpointKey([$points[$i]['x'], $points[$i]['y']]);
        if (!isset($clusterKeys[$root]) || strcmp($key, $clusterKeys[$root]) < 0) {
            $clusterKeys[$root] = $key;
        }
    }
    $nodes = [];
    for ($i = 0; $i < $count; $i++) {
        $nodes[$points[$i]['pid']][$points[$i]['end']] = $clusterKeys[$find($i)];
    }
    return $nodes;
}

// Orients the way's MAIN CHAIN from one loose end to the other. The main chain is the pair
// of loose ends with the LONGEST connecting path (drawn length, Dijkstra) -- which end
// becomes the source is arbitrary (owner decision: the editor checks the arrows and presses
// flip once if wrong). Spur segments off the chain stay undirected; cycles yield nothing.
// Input: public_id => LineString coordinates ([[x,y],...], stored drawing order).
function avesmapsPathFlowChainOrientation(array $coordinatesByPublicId): array {
    $edges = [];
    $adjacency = [];
    $endpointNodes = avesmapsPathFlowEndpointNodes($coordinatesByPublicId);
    foreach ($coordinatesByPublicId as $publicId => $coordinates) {
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        $nodePair = $endpointNodes[(string) $publicId] ?? null;
        if ($nodePair === null) {
            continue;
        }
        $keyA = $nodePair['a'];
        $keyB = $nodePair['b'];
        if ($keyA === $keyB) {
            continue;  // node-internal stub or degenerate loop segment
        }
        $length = 0.0;
        for ($i = 0; $i < count($coordinates) - 1; $i++) {
            $dx = (float) ($coordinates[$i + 1][0] ?? 0) - (float) ($coordinates[$i][0] ?? 0);
            $dy = (float) ($coordinates[$i + 1][1] ?? 0) - (float) ($coordinates[$i][1] ?? 0);
            $length += hypot($dx, $dy);
        }
        $edges[(string) $publicId] = ['a' => $keyA, 'b' => $keyB, 'length' => $length];
        $adjacency[$keyA][] = (string) $publicId;
        $adjacency[$keyB][] = (string) $publicId;
    }
    if ($edges === []) {
        return [];
    }

    $looseEnds = [];
    foreach ($adjacency as $key => $publicIds) {
        if (count($publicIds) === 1) {
            $looseEnds[] = (string) $key;
        }
    }
    sort($looseEnds, SORT_STRING);
    if (count($looseEnds) < 2) {
        return [];  // pure cycle -> nothing safe to orient
    }

    $bestPath = null;
    $bestDistance = -1.0;
    foreach ($looseEnds as $sourceKey) {
        [$distances, $previousEdge] = avesmapsPathFlowDijkstra($sourceKey, $edges, $adjacency);
        foreach ($looseEnds as $targetKey) {
            if ($targetKey === $sourceKey || !isset($distances[$targetKey])) {
                continue;
            }
            if ($distances[$targetKey] > $bestDistance) {
                $bestDistance = $distances[$targetKey];
                $bestPath = avesmapsPathFlowTracePath($sourceKey, $targetKey, $edges, $previousEdge);
            }
        }
    }
    if (!is_array($bestPath) || $bestPath === []) {
        return [];
    }

    $result = [];
    foreach ($bestPath as $step) {
        $edge = $edges[$step['public_id']];
        $result[$step['public_id']] = $edge['a'] === $step['enter'] ? 'forward' : 'reverse';
    }
    return $result;
}

// Anchor-aware set_dir plan (spec 2026-07-06): orients the way's main chain like
// avesmapsPathFlowChainOrientation, but aligns the walk with the dirs the way ALREADY has.
// Anchors are never rewritten -- the plan covers only previously undirected chain segments.
// Anchors off the chain (spurs) carry no alignment information (whether an arm flows into
// or out of the chain is geometrically undecidable) and are only protected, never consulted.
function avesmapsPathFlowPlanSetDir(array $coordinatesByPublicId, array $anchorDirByPublicId): array {
    $chain = avesmapsPathFlowChainOrientation($coordinatesByPublicId);
    if ($chain === []) {
        return ['ok' => false, 'reason' => 'no_chain', 'dir_by_public_id' => []];
    }
    $agree = 0;
    $disagree = 0;
    foreach ($anchorDirByPublicId as $publicId => $anchorDir) {
        if ($anchorDir !== 'forward' && $anchorDir !== 'reverse') {
            continue;
        }
        $chainDir = $chain[(string) $publicId] ?? null;
        if ($chainDir === null) {
            continue;
        }
        if ($chainDir === $anchorDir) {
            $agree++;
        } else {
            $disagree++;
        }
    }
    if ($agree > 0 && $disagree > 0) {
        return ['ok' => false, 'reason' => 'anchors_conflict', 'dir_by_public_id' => []];
    }
    if ($anchorDirByPublicId !== [] && $agree === 0 && $disagree === 0) {
        return ['ok' => false, 'reason' => 'no_anchor_on_chain', 'dir_by_public_id' => []];
    }
    $dirByPublicId = [];
    foreach ($chain as $publicId => $dir) {
        if (isset($anchorDirByPublicId[$publicId])) {
            continue;
        }
        $dirByPublicId[$publicId] = $disagree > 0 ? ($dir === 'forward' ? 'reverse' : 'forward') : $dir;
    }
    return ['ok' => true, 'reason' => null, 'dir_by_public_id' => $dirByPublicId];
}

// Derivation consistency (Yaquir lesson): independent hops can disagree (a mis-matched
// station routes a hop backwards along the river), which would write head-on arrows onto
// ONE physical chain. Project every derived dir onto the way's main chain: the majority
// flow direction wins, the conflicting minority is DROPPED (PlanWrites then clears any
// previously written dir on those segments). A tie drops all chain dirs (no safe majority).
// Dirs on segments off the chain (spurs, node-internal stubs) are never touched.
function avesmapsPathFlowReconcileChainDirs(array $coordinatesByPublicId, array $dirByPublicId): array {
    $chain = avesmapsPathFlowChainOrientation($coordinatesByPublicId);
    if ($chain === []) {
        return ['dir_by_public_id' => $dirByPublicId, 'dropped' => []];
    }
    $with = [];
    $against = [];
    foreach ($dirByPublicId as $publicId => $dir) {
        if ($dir !== 'forward' && $dir !== 'reverse') {
            continue;
        }
        $chainDir = $chain[(string) $publicId] ?? null;
        if ($chainDir === null) {
            continue;
        }
        if ($chainDir === $dir) {
            $with[] = (string) $publicId;
        } else {
            $against[] = (string) $publicId;
        }
    }
    if ($with === [] || $against === []) {
        return ['dir_by_public_id' => $dirByPublicId, 'dropped' => []];
    }
    if (count($with) === count($against)) {
        $dropped = array_merge($with, $against);
    } else {
        $dropped = count($with) > count($against) ? $against : $with;
    }
    sort($dropped, SORT_STRING);
    $filtered = [];
    foreach ($dirByPublicId as $publicId => $dir) {
        if (!in_array((string) $publicId, $dropped, true)) {
            $filtered[(string) $publicId] = $dir;
        }
    }
    return ['dir_by_public_id' => $filtered, 'dropped' => $dropped];
}

// Plain-array Dijkstra over the endpoint graph (way-sized inputs; no heap needed).
function avesmapsPathFlowDijkstra(string $sourceKey, array $edges, array $adjacency): array {
    $distances = [$sourceKey => 0.0];
    $previousEdge = [];
    $visited = [];
    while (true) {
        $currentKey = null;
        $currentDistance = INF;
        foreach ($distances as $key => $distance) {
            if (!isset($visited[$key]) && $distance < $currentDistance) {
                $currentKey = (string) $key;
                $currentDistance = $distance;
            }
        }
        if ($currentKey === null) {
            break;
        }
        $visited[$currentKey] = true;
        $publicIds = $adjacency[$currentKey] ?? [];
        sort($publicIds, SORT_STRING);  // deterministic among parallel edges
        foreach ($publicIds as $publicId) {
            $edge = $edges[$publicId];
            $neighborKey = $edge['a'] === $currentKey ? $edge['b'] : $edge['a'];
            $alternative = $currentDistance + $edge['length'];
            if ($alternative < ($distances[$neighborKey] ?? INF)) {
                $distances[$neighborKey] = $alternative;
                $previousEdge[$neighborKey] = $publicId;
            }
        }
    }
    return [$distances, $previousEdge];
}

// Reconstructs the walk source -> target as [['public_id', 'enter' => nodeKey], ...];
// 'enter' is the node the walk ENTERS the segment from.
function avesmapsPathFlowTracePath(string $sourceKey, string $targetKey, array $edges, array $previousEdge): array {
    $steps = [];
    $cursor = $targetKey;
    while ($cursor !== $sourceKey) {
        $publicId = $previousEdge[$cursor] ?? null;
        if ($publicId === null) {
            return [];
        }
        $edge = $edges[$publicId];
        $enterKey = $edge['a'] === $cursor ? $edge['b'] : $edge['a'];
        array_unshift($steps, ['public_id' => $publicId, 'enter' => $enterKey]);
        $cursor = $enterKey;
    }
    return $steps;
}

// ---------------------------------------------------------------------------------------
// DB-backed derivation (spec §3). Callers (api/edit/wiki/paths.php) provide the wiki-sync
// helpers via their own requires; this file stays require-free at top level.
// ---------------------------------------------------------------------------------------

// Fresh read of the way's current Flussweg segments (public_id => id/name/raw flow).
// Deliberately NOT the assignments snapshot: the apply_verlauf_case hook runs AFTER
// adds/removes changed the very assignment this derivation must see.
function avesmapsWikiPathFlowReadWaySegments(PDO $pdo, string $wikiKey): array {
    $needle = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], '"wiki_key":"' . $wikiKey . '"') . '%';
    $statement = $pdo->prepare(
        "SELECT id, public_id, name, properties_json, geometry_json FROM map_features
         WHERE is_active = 1 AND feature_type = 'path' AND feature_subtype = 'Flussweg'
           AND properties_json LIKE :needle"
    );
    $statement->execute(['needle' => $needle]);
    $segments = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        if ((string) ($props['wiki_path']['wiki_key'] ?? '') !== $wikiKey) {
            continue;  // LIKE prefilter hit inside a text field -> exact check rejects
        }
        $geometry = avesmapsWikiSyncDecodeJson($row['geometry_json'] ?? null);
        $segments[(string) $row['public_id']] = [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'flow' => is_array($props['flow'] ?? null) ? $props['flow'] : null,
            // Geometry feeds the chain-consistency reconciliation of the derivation.
            'coordinates' => is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [],
        ];
    }
    return $segments;
}

// Applies planned flow writes (public_id => ['flow' => array|null]) to map_features:
// properties_json-only UPDATE (name/geometry untouched), ONE revision per batch, full audit
// per row (undo restores the whole previous properties JSON). Props are re-read from the
// fresh audit row so concurrent edits between plan and write are not clobbered.
function avesmapsWikiPathFlowApplyWrites(PDO $pdo, array $writes, array $waySegments, int $userId): array {
    $segmentsUpdated = [];
    if ($writes === []) {
        return $segmentsUpdated;
    }
    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    foreach ($writes as $publicId => $write) {
        $segment = $waySegments[(string) $publicId] ?? null;
        if (!is_array($segment)) {
            continue;
        }
        $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $segment['id']);
        if ($auditBefore === []) {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($auditBefore['properties_json'] ?? null);
        if ($write['flow'] === null) {
            unset($props['flow']);
        } else {
            $props['flow'] = $write['flow'];
        }
        $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $segment['id']]);
        avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, (string) ($auditBefore['name'] ?? ''));
        $segmentsUpdated[] = [
            'public_id' => (string) $publicId,
            'revision' => $revision,
            'name' => (string) ($auditBefore['name'] ?? ''),
            'display_name' => (string) ($props['display_name'] ?? ($auditBefore['name'] ?? '')),
            'wiki_path' => is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : null,
            'flow' => $write['flow'],
        ];
    }
    return $segmentsUpdated;
}

// Derives flow.dir for ONE wiki way from its staging verlauf (spec §3). Reuses the
// verlauf-sync hop router. Safety rules: only routable, non-synthetic, non-detour hops with
// an unbroken chain contribute; a segment gets a dir only when traversed in exactly ONE
// orientation; only segments CURRENTLY assigned to the way are written. Qualification is
// deliberately independent of wiki_path.source (owner-curated rivers qualify too; only
// `flow` is written, never the assignment).
function avesmapsWikiPathFlowDeriveForWay(PDO $pdo, array $config, string $wikiKey, bool $dryRun, int $userId, ?array $routingContext = null): array {
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key missing.');
    }
    $stagingStatement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $stagingStatement->execute(['k' => $wikiKey]);
    $stagingRow = $stagingStatement->fetch(PDO::FETCH_ASSOC);
    if (!$stagingRow) {
        throw new RuntimeException('Wiki way not in staging: ' . $wikiKey);
    }

    $base = [
        'ok' => true, 'dry_run' => $dryRun, 'wiki_key' => $wikiKey,
        'segments_total' => 0, 'directed' => 0, 'cleared' => 0, 'unchanged' => 0,
        'ambiguous' => [], 'conflicting' => [], 'hops_routable' => 0, 'hops_skipped' => 0, 'segments_updated' => [],
    ];
    if ((string) ($stagingRow['kind'] ?? '') !== 'fluss') {
        return $base + ['skipped' => 'not_a_river'];
    }
    $waySegments = avesmapsWikiPathFlowReadWaySegments($pdo, $wikiKey);
    $base['segments_total'] = count($waySegments);
    if ($waySegments === []) {
        return $base + ['skipped' => 'no_assigned_segments'];
    }
    $stations = avesmapsWikiPathVerlaufStations((string) ($stagingRow['verlauf'] ?? ''));
    if (count($stations) < 2) {
        return $base + ['skipped' => 'no_course'];
    }

    $routingContext ??= avesmapsWikiPathVerlaufBuildRoutingContext($config);
    $router = $routingContext['router']('fluss');
    $locationLookup = $routingContext['lookup']();

    $matchedChain = [];
    foreach ($stations as $station) {
        $canonical = $locationLookup[avesmapsWikiPathVerlaufLower($station)] ?? null;
        if ($canonical !== null) {
            $matchedChain[] = (string) $canonical;
        }
    }
    if (count($matchedChain) < 2) {
        return $base + ['skipped' => 'stations_not_found'];
    }

    $occurrences = [];
    $hopsRoutable = 0;
    $hopsSkipped = 0;
    for ($i = 0; $i < count($matchedChain) - 1; $i++) {
        $result = $router($matchedChain[$i], $matchedChain[$i + 1]);
        $segments = is_array($result['segments'] ?? null) ? $result['segments'] : [];
        if (empty($result['found']) || $segments === []) {
            $hopsSkipped++;
            continue;
        }
        $hasSynthetic = false;
        foreach ($segments as $segment) {
            if (!empty($segment['synthetic']) || (string) ($segment['public_id'] ?? '') === '') {
                $hasSynthetic = true;
                break;
            }
        }
        if ($hasSynthetic || count($segments) > AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS) {
            $hopsSkipped++;
            continue;
        }
        $hop = avesmapsPathFlowHopOrientations($segments, $matchedChain[$i]);
        if (!$hop['ok']) {
            $hopsSkipped++;
            continue;
        }
        foreach ($hop['occurrences'] as $occurrence) {
            $occurrences[] = $occurrence;
        }
        $hopsRoutable++;
    }

    $combined = avesmapsPathFlowCombineOrientations($occurrences, array_keys($waySegments));
    // Chain-consistency reconciliation (Yaquir lesson): hops that ran backwards along the
    // river must not write head-on arrows -- the minority against the chain majority is
    // dropped, and PlanWrites clears any dir previously written on those segments.
    $coordinatesByPublicId = array_map(static fn(array $segment) => $segment['coordinates'] ?? [], $waySegments);
    $reconciled = avesmapsPathFlowReconcileChainDirs($coordinatesByPublicId, $combined['dir_by_public_id']);
    $currentFlowByPublicId = array_map(static fn(array $segment) => $segment['flow'], $waySegments);
    $plan = avesmapsPathFlowPlanWrites($reconciled['dir_by_public_id'], $currentFlowByPublicId);

    $segmentsUpdated = [];
    if (!$dryRun && $plan['writes'] !== []) {
        $segmentsUpdated = avesmapsWikiPathFlowApplyWrites($pdo, $plan['writes'], $waySegments, $userId);
    }
    return array_merge($base, [
        'directed' => $plan['set'], 'cleared' => $plan['cleared'], 'unchanged' => $plan['unchanged'],
        'ambiguous' => $combined['ambiguous'],
        'conflicting' => $reconciled['dropped'],
        'hops_routable' => $hopsRoutable, 'hops_skipped' => $hopsSkipped,
        'segments_updated' => $segmentsUpdated,
    ]);
}

// First-run batch derivation over ALL wiki river ways (spec §3 trigger 2). Walks
// wiki_path_staging by id cursor exactly like verlauf_cases, timeboxed for STRATO; ONE
// routing context is shared across the batch. Ways without assignment/course are cheap
// skips inside DeriveForWay. Response mirrors the ListCases envelope.
function avesmapsWikiPathFlowDeriveAll(PDO $pdo, array $config, bool $dryRun, int $userId, array $options = []): array {
    $cursor = max(0, (int) ($options['cursor'] ?? 0));
    $limit = max(1, min(50, (int) ($options['limit'] ?? 10)));
    $stepRuntime = max(3, min(25, (int) ($options['step_runtime'] ?? 15)));
    $startedAt = microtime(true);
    @set_time_limit($stepRuntime + 15);

    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE .
        " WHERE id > :cursor AND kind = 'fluss' ORDER BY id ASC LIMIT " . $limit);
    $statement->bindValue('cursor', $cursor, PDO::PARAM_INT);
    $statement->execute();
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    $routingContext = avesmapsWikiPathVerlaufBuildRoutingContext($config);
    $results = [];
    $scanned = 0;
    $nextCursor = $cursor;
    $stoppedEarly = false;
    foreach ($rows as $row) {
        if ((microtime(true) - $startedAt) >= $stepRuntime) {
            $stoppedEarly = true;
            break;
        }
        $scanned++;
        $nextCursor = (int) $row['id'];
        $rowWikiKey = (string) ($row['wiki_key'] ?? '');
        if ($rowWikiKey === '') {
            continue;
        }
        try {
            $result = avesmapsWikiPathFlowDeriveForWay($pdo, $config, $rowWikiKey, $dryRun, $userId, $routingContext);
        } catch (Throwable $error) {
            $result = ['ok' => false, 'wiki_key' => $rowWikiKey, 'error' => 'derive_failed'];
        }
        unset($result['segments_updated']);  // keep batch responses small
        if (($result['directed'] ?? 0) > 0 || ($result['cleared'] ?? 0) > 0 || ($result['ok'] ?? false) === false || count($result['ambiguous'] ?? []) > 0 || count($result['conflicting'] ?? []) > 0) {
            $results[] = $result;
        }
    }
    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'results' => $results,
        'scanned' => $scanned,
        'next_cursor' => $nextCursor,
        'complete' => !$stoppedEarly && count($rows) < $limit,
        'runtime_seconds' => round(microtime(true) - $startedAt, 2),
    ];
}

// POST set_flow (spec §6): way-wide flow edits from the path detail panel.
//   {public_id, flip:true}     invert dir on every directed segment of the way
//   {public_id, set_dir:true}  "Richtung festlegen/vervollstaendigen": orient the way's main
//                              chain, aligned with (and never rewriting) existing dirs
//   {public_id, factor:2.0}    way-wide Stroemungsfaktor (clamped)
// flip/set_dir are mutually exclusive; factor may combine with either. Way identity =
// avesmapsWikiPathRowMatchesWay (name match-key UNION wiki_key) restricted to Flussweg --
// a lone generically-named segment thus deliberately matches only itself.
function avesmapsWikiPathSetFlow(PDO $pdo, string $publicId, array $options, bool $dryRun, int $userId): array {
    $publicId = trim($publicId);
    if ($publicId === '') {
        throw new RuntimeException('public_id missing.');
    }
    $flip = ($options['flip'] ?? false) === true;
    $setDir = ($options['set_dir'] ?? false) === true;
    $factorRaw = $options['factor'] ?? null;
    $hasFactor = is_numeric($factorRaw);
    if ($flip && $setDir) {
        throw new RuntimeException('flip and set_dir are mutually exclusive.');
    }
    if (!$flip && !$setDir && !$hasFactor) {
        throw new RuntimeException('No flow change requested.');
    }

    $targetStatement = $pdo->prepare("SELECT id, name, feature_subtype, properties_json FROM map_features WHERE public_id = :p AND feature_type = 'path' AND is_active = 1 LIMIT 1");
    $targetStatement->execute(['p' => $publicId]);
    $target = $targetStatement->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        throw new RuntimeException('Target path not found.');
    }
    if ((string) $target['feature_subtype'] !== 'Flussweg') {
        throw new RuntimeException('Flow direction only applies to rivers (Flussweg).');
    }

    $targetProps = avesmapsWikiSyncDecodeJson($target['properties_json'] ?? null);
    $targetKey = avesmapsWikiSyncCreateMatchKey((string) $target['name']);
    $targetWikiKey = (string) ($targetProps['wiki_path']['wiki_key'] ?? '');

    // Way-wide target set; geometry needed for the set_dir chain walk.
    $rows = $pdo->query("SELECT id, public_id, name, properties_json, geometry_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND feature_subtype = 'Flussweg'")->fetchAll(PDO::FETCH_ASSOC);
    $waySegments = [];
    $coordinatesByPublicId = [];
    foreach ($rows as $row) {
        if (!avesmapsWikiPathRowMatchesWay((string) $row['name'], $row['properties_json'] ?? null, $targetKey, $targetWikiKey)) {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $rowPublicId = (string) $row['public_id'];
        $waySegments[$rowPublicId] = [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'flow' => is_array($props['flow'] ?? null) ? $props['flow'] : null,
        ];
        $geometry = avesmapsWikiSyncDecodeJson($row['geometry_json'] ?? null);
        $coordinatesByPublicId[$rowPublicId] = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
    }
    if ($waySegments === []) {
        throw new RuntimeException('No river segments found for this way.');
    }

    $currentFlow = array_map(static fn(array $segment) => $segment['flow'], $waySegments);
    $directedBefore = 0;
    foreach ($currentFlow as $flowRaw) {
        if (avesmapsPathFlowNormalize($flowRaw) !== null) {
            $directedBefore++;
        }
    }

    // Compose on a working copy: direction change first, factor applied to the RESULT.
    $working = $currentFlow;
    $writes = [];
    $summary = ['flipped' => 0, 'directed' => 0, 'factor_updated' => 0];
    if ($flip) {
        if ($directedBefore === 0) {
            throw new RuntimeException('This river has no direction yet (use set_dir).');
        }
        $plan = avesmapsPathFlowPlanFlip($working);
        $summary['flipped'] = $plan['flipped'];
        foreach ($plan['writes'] as $pid => $write) {
            $working[$pid] = $write['flow'];
            $writes[$pid] = $write;
        }
    } elseif ($setDir) {
        // Anchor-aware (spec 2026-07-06): existing dirs act as alignment anchors and are
        // never rewritten here -- a partially wiki-derived river gets the undirected rest
        // of its main chain completed consistently instead of erroring out.
        $anchorDirs = [];
        foreach ($working as $pid => $flowRaw) {
            $normalized = avesmapsPathFlowNormalize($flowRaw);
            if ($normalized !== null) {
                $anchorDirs[(string) $pid] = $normalized['dir'];
            }
        }
        $plan = avesmapsPathFlowPlanSetDir($coordinatesByPublicId, $anchorDirs);
        if (!$plan['ok']) {
            throw new RuntimeException(match ($plan['reason']) {
                'anchors_conflict' => 'Directed segments on the main chain disagree -- re-derive or flip first.',
                'no_anchor_on_chain' => 'No directed segment lies on the main chain; cannot orient the rest consistently.',
                default => 'No unambiguous segment chain found.',
            });
        }
        if ($plan['dir_by_public_id'] === []) {
            throw new RuntimeException('Main chain is already fully directed (use flip).');
        }
        foreach ($plan['dir_by_public_id'] as $pid => $dir) {
            $new = is_array($working[$pid] ?? null) ? $working[$pid] : [];
            $new['dir'] = $dir;
            $new['source'] = 'editor';
            $working[$pid] = $new;
            $writes[$pid] = ['flow' => $new];
            $summary['directed']++;
        }
    }
    if ($hasFactor) {
        $plan = avesmapsPathFlowPlanFactor($working, (float) $factorRaw);
        $summary['factor_updated'] = $plan['updated'];
        $summary['factor'] = $plan['factor'];
        foreach ($plan['writes'] as $pid => $write) {
            $working[$pid] = $write['flow'];
            $writes[$pid] = $write;
        }
    }

    $segmentsUpdated = [];
    if (!$dryRun && $writes !== []) {
        $segmentsUpdated = avesmapsWikiPathFlowApplyWrites($pdo, $writes, $waySegments, $userId);
    }
    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'public_id' => $publicId,
        'name' => (string) $target['name'],
        'segments' => count($waySegments),
        'directed_before' => $directedBefore,
    ] + $summary + [
        'writes' => count($writes),
        'segments_updated' => $segmentsUpdated,
    ];
}
