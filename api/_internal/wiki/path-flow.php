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

// Orients the way's MAIN CHAIN from one loose end to the other. The main chain is the pair
// of loose ends with the LONGEST connecting path (drawn length, Dijkstra) -- which end
// becomes the source is arbitrary (owner decision: the editor checks the arrows and presses
// flip once if wrong). Spur segments off the chain stay undirected; cycles yield nothing.
// Input: public_id => LineString coordinates ([[x,y],...], stored drawing order).
function avesmapsPathFlowChainOrientation(array $coordinatesByPublicId): array {
    $edges = [];
    $adjacency = [];
    foreach ($coordinatesByPublicId as $publicId => $coordinates) {
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        $first = is_array($coordinates[0]) ? $coordinates[0] : [];
        $last = is_array($coordinates[count($coordinates) - 1]) ? $coordinates[count($coordinates) - 1] : [];
        $keyA = avesmapsPathFlowEndpointKey($first);
        $keyB = avesmapsPathFlowEndpointKey($last);
        if ($keyA === $keyB) {
            continue;  // degenerate loop segment
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
