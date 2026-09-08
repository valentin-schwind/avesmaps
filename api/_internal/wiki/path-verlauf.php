<?php

declare(strict_types=1);

// Verlauf-Sync server logic (docs/refactoring-verlauf-sync.md). Diffs the wiki
// staging `verlauf` course against what map_features carries, so a later wiki
// course edit surfaces as a review case instead of silently drifting. Task 2
// lays the ground helpers (course hashing/station split) and the one-off
// audit-log backfill that stamps `wiki_path.source`/`course_hash` onto
// segments the 2026-07-05 bulk assign already wrote. Tasks 3-5 extend this
// file with the diff/case-building engine and the apply flow.
//
// Deliberately no top-level requires except the sibling path-verlauf-faelle.php
// (which has none of its own): this file must be loadable standalone (see
// tools/paths/test-path-verlauf-engine.php, pure-function tests only, no PDO).
// The DB-touching functions below reference avesmapsWikiSyncDecodeJson /
// avesmapsWikiSyncEncodeJson (sync.php) and avesmapsWikiSyncFetchAuditRow /
// avesmapsWikiSyncAuditFeaturePropsChange / avesmapsWikiSyncNextMapRevision
// (locations-helpers.php) only inside function bodies -- the including
// endpoint (api/edit/wiki/paths.php) already loads sync.php and, via
// paths.php/locations.php, locations-helpers.php before this file runs.

// Stable hash of a staging `verlauf` string at a point in time, used to detect
// whether the wiki course changed since a segment was assigned. Empty (after
// trim) verlauf hashes to '' rather than sha1('') so "no course recorded" and
// "course hashed to something" stay distinguishable.
function avesmapsWikiPathCourseHash(string $verlauf): string {
    $trimmed = trim($verlauf);
    return $trimmed === '' ? '' : sha1($trimmed);
}

// Splits a staging `verlauf` string into its ordered station names. Storage
// format is stations joined by ' → ' (U+2192 arrow with surrounding spaces,
// written by avesmapsWikiPathParsePage, api/_internal/wiki/paths.php line
// ~372). Trims each station, drops empties, de-dupes while preserving order.
function avesmapsWikiPathVerlaufStations(string $verlauf): array {
    $stations = [];
    foreach (explode(' → ', $verlauf) as $part) {
        $station = trim($part);
        if ($station !== '' && !in_array($station, $stations, true)) {
            $stations[] = $station;
        }
    }
    return $stations;
}

// Decides the backfill action for one feature. $currentProps = decoded properties_json
// (or null when the row is missing/inactive). Returns ['action' => 'stamp'|'skip',
// 'reason' => ''|'inactive_or_missing'|'reassigned'|'editor_source'|'already_stamped',
// 'props' => array|null].
function avesmapsWikiPathVerlaufBackfillDecision(?array $currentProps, string $auditWikiKey, string $auditVerlauf): array {
    if ($currentProps === null) {
        return ['action' => 'skip', 'reason' => 'inactive_or_missing', 'props' => null];
    }
    $wikiPath = $currentProps['wiki_path'] ?? null;
    if (!is_array($wikiPath) || (string) ($wikiPath['wiki_key'] ?? '') !== $auditWikiKey || $auditWikiKey === '') {
        return ['action' => 'skip', 'reason' => 'reassigned', 'props' => null];
    }
    if ((string) ($wikiPath['source'] ?? '') === 'editor') {
        return ['action' => 'skip', 'reason' => 'editor_source', 'props' => null];
    }
    $hash = avesmapsWikiPathCourseHash($auditVerlauf);
    // Self-feed guard: a segment already stamped by verlauf-sync whose stored course_hash already
    // matches this audit verlauf is a no-op -- re-stamping it would write a fresh audit row that the
    // backfill's own scan filter then matches, so the cursor never reaches `complete`. Skip it
    // without an UPDATE. The empty/absent case (no stored hash, empty audit verlauf) also matches:
    // both sides hash to '' and nothing would change.
    if ((string) ($wikiPath['source'] ?? '') === 'verlauf-sync' && (string) ($wikiPath['course_hash'] ?? '') === $hash) {
        return ['action' => 'skip', 'reason' => 'already_stamped', 'props' => null];
    }
    $wikiPath['source'] = 'verlauf-sync';
    if ($hash !== '') {
        $wikiPath['course_hash'] = $hash;
    }
    $currentProps['wiki_path'] = $wikiPath;
    return ['action' => 'stamp', 'reason' => '', 'props' => $currentProps];
}

// One-off backfill: stamps wiki_path.source='verlauf-sync' (+ course_hash, when the
// audit verlauf is non-empty) onto segments that the 2026-07-05 assign_all bulk pipeline
// already wrote, using the map_audit_log trail (avesmapsWikiSyncAuditFeaturePropsChange's
// 'wiki_sync_update_point' entries) rather than re-deriving state from map_features alone
// (properties_json.wiki_path never carried `source` before Task 1). Batched via an
// after_id cursor + limit -- STRATO shared hosting, never scan the whole audit table
// unbounded in one request.
//
// $options: date (default '2026-07-05'), after_id (audit-id cursor, default 0),
// limit (default 400, max 800, clamped to >= 1).
function avesmapsWikiPathVerlaufBackfillSource(PDO $pdo, bool $dryRun, int $userId, array $options = []): array {
    $date = trim((string) ($options['date'] ?? '2026-07-05'));
    $afterId = max(0, (int) ($options['after_id'] ?? 0));
    $limit = max(1, min(800, (int) ($options['limit'] ?? 400)));

    $d0 = new DateTimeImmutable($date . ' 00:00:00');
    $d1 = $d0->modify('+1 day');

    $select = $pdo->prepare(
        "SELECT id, feature_id, after_json FROM map_audit_log
        WHERE action = 'wiki_sync_update_point'
          AND created_at >= :d0 AND created_at < :d1
          AND id > :after_id
          AND JSON_EXTRACT(after_json, '$.properties_json.wiki_path.wiki_key') IS NOT NULL
        ORDER BY id ASC
        LIMIT " . $limit
    );
    $select->execute([
        'd0' => $d0->format('Y-m-d H:i:s'),
        'd1' => $d1->format('Y-m-d H:i:s'),
        'after_id' => $afterId,
    ]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $scanned = count($rows);
    $lastAuditId = $afterId;
    $byFeature = [];
    foreach ($rows as $row) {
        $lastAuditId = max($lastAuditId, (int) $row['id']);
        $featureId = (int) $row['feature_id'];
        $after = avesmapsWikiSyncDecodeJson($row['after_json'] ?? null);
        $props = is_array($after['properties_json'] ?? null) ? $after['properties_json'] : [];
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        // Keep the LAST (highest id) entry per feature within this batch.
        $byFeature[$featureId] = [
            'wiki_key' => $wikiKey,
            'verlauf' => (string) ($wikiPath['verlauf'] ?? ''),
        ];
    }

    $skipped = ['inactive_or_missing' => 0, 'reassigned' => 0, 'editor_source' => 0, 'already_stamped' => 0];
    $stamped = 0;
    $sample = [];
    $revision = null;

    if ($byFeature !== []) {
        $featureIds = array_keys($byFeature);
        $placeholders = implode(',', array_fill(0, count($featureIds), '?'));
        $rowsStatement = $pdo->prepare(
            "SELECT id, public_id, name, properties_json FROM map_features
            WHERE feature_type = 'path' AND is_active = 1 AND id IN (" . $placeholders . ')'
        );
        $rowsStatement->execute($featureIds);
        $currentById = [];
        foreach ($rowsStatement->fetchAll(PDO::FETCH_ASSOC) as $currentRow) {
            $currentById[(int) $currentRow['id']] = $currentRow;
        }

        $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');

        foreach ($byFeature as $featureId => $entry) {
            $currentRow = $currentById[$featureId] ?? null;
            $currentProps = $currentRow !== null ? avesmapsWikiSyncDecodeJson($currentRow['properties_json'] ?? null) : null;
            $decision = avesmapsWikiPathVerlaufBackfillDecision($currentProps, $entry['wiki_key'], $entry['verlauf']);

            if ($decision['action'] !== 'stamp') {
                $reason = (string) $decision['reason'];
                if (isset($skipped[$reason])) {
                    $skipped[$reason]++;
                }
                continue;
            }

            $stamped++;
            if (count($sample) < 10) {
                $sample[] = [
                    'public_id' => (string) ($currentRow['public_id'] ?? ''),
                    'name' => (string) ($currentRow['name'] ?? ''),
                    'wiki_key' => $entry['wiki_key'],
                ];
            }

            if (!$dryRun) {
                $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, $featureId);
                $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
                $props = $decision['props'];
                $update->execute([
                    'pj' => avesmapsWikiSyncEncodeJson($props),
                    'rev' => $revision,
                    'id' => $featureId,
                ]);
                // NAME UNCHANGED: this backfill only stamps provenance/course_hash onto
                // wiki_path, never the name column.
                avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId, (string) ($auditBefore['name'] ?? ''));
            }
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'scanned' => $scanned,
        'stamped' => $stamped,
        'skipped' => $skipped,
        'next_after_id' => $lastAuditId,
        'complete' => $scanned < $limit,
        'sample' => $sample,
    ];
}

// A hop whose Soll route exceeds this many segments is treated as a routing detour rather than a
// faithful match of the wiki course, and reported as an unroutable hop (reason 'detour'). Keeps a
// wrong Dijkstra shortcut from silently pulling a long unrelated chain into the target set.
const AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS = 15;

// Line-tracer bounds: max graph edges per traced hop (a slice-split road produces several edges
// per map segment), state-expansion safety cap, and the soft cost for changing the path subtype
// mid-trace (staying on the same kind of road is part of "following the drawn line").
const AVESMAPS_WIKI_PATH_VERLAUF_TRACE_MAX_EDGES = 40;
const AVESMAPS_WIKI_PATH_VERLAUF_TRACE_MAX_STATES = 4000;
const AVESMAPS_WIKI_PATH_VERLAUF_TRACE_SUBTYPE_PENALTY = 25.0;

// Follows the DRAWN road from one wiki station to the next (owner model: "sich an der
// Kanon-Strasse entlanghangeln"): Dijkstra over accumulated BEND degrees instead of travel
// time, so continuing straight on the same line is nearly free while turning off onto a
// different road costs its deflection angle (+ a soft penalty when the subtype changes).
// Places that lie ON the line are simply passed through - they are not corridor errors.
// Returns ['found', 'segments' => [['public_id','geometry']], 'via' => [interior node names]].
function avesmapsWikiPathVerlaufTraceHop(array $graph, string $fromName, string $toName, int $maxSegments = AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS): array {
    // The graph builder returns a wrapper ['graph' => adjacency, 'statistics' => ...]; accept
    // both shapes (the bare adjacency is what the fixtures pass). Indexing the wrapper made
    // every production trace fail instantly and fall back to Dijkstra + foreign-town block.
    if (!isset($graph[$fromName]) && is_array($graph['graph'] ?? null)) {
        $graph = $graph['graph'];
    }
    $fail = ['found' => false, 'reason' => 'no_route', 'segments' => [], 'via' => []];
    if ($fromName === $toName || !isset($graph[$fromName])) {
        return $fail;
    }

    // Heading (degrees) of the first/last step of a connection traversed $from -> neighbour;
    // stored orientation may be either way, so reverse the coordinates when needed.
    $orient = static function (array $connection, string $travelFrom): ?array {
        $coordinates = $connection['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) {
            return null;
        }
        if ((string) ($connection['from'] ?? '') !== $travelFrom) {
            $coordinates = array_reverse($coordinates);
        }
        $first = null;
        $last = null;
        for ($i = 1, $n = count($coordinates); $i < $n; $i++) {
            $dx = (float) $coordinates[$i][0] - (float) $coordinates[$i - 1][0];
            $dy = (float) $coordinates[$i][1] - (float) $coordinates[$i - 1][1];
            if ($dx === 0.0 && $dy === 0.0) {
                continue;
            }
            $heading = rad2deg(atan2($dy, $dx));
            $first ??= $heading;
            $last = $heading;
        }

        return $first === null ? null : ['depart' => $first, 'arrive' => $last];
    };
    $bend = static function (float $a, float $b): float {
        $delta = fmod(abs($a - $b), 360.0);

        return $delta > 180.0 ? 360.0 - $delta : $delta;
    };

    $queue = new SplPriorityQueue();
    $states = [];
    $stateCount = 0;
    $pushArms = static function (string $node, ?string $prevKey, float $baseCost, ?float $arriveHeading, ?string $prevType, int $edges, array $ids) use (&$graph, &$states, &$queue, $orient, $bend, $maxSegments): void {
        foreach ($graph[$node] ?? [] as $neighbour => $connections) {
            foreach ((is_array($connections) ? $connections : []) as $connection) {
                if (!empty($connection['synthetic']) || (string) ($connection['public_id'] ?? '') === '') {
                    continue;
                }
                $headings = $orient($connection, $node);
                if ($headings === null) {
                    continue;
                }
                $publicId = (string) $connection['public_id'];
                $nextIds = $ids;
                $nextIds[$publicId] = true;
                if (count($nextIds) > $maxSegments || $edges + 1 > AVESMAPS_WIKI_PATH_VERLAUF_TRACE_MAX_EDGES) {
                    continue;
                }
                $cost = $baseCost + 0.1; // per-edge epsilon: prefer fewer edges on straight ties
                if ($arriveHeading !== null) {
                    $turn = $bend($arriveHeading, (float) $headings['depart']);
                    if ($turn > 179.0) {
                        continue; // hard U-turn back over the junction never follows the line
                    }
                    $cost += $turn;
                }
                if ($prevType !== null && (string) ($connection['route_type'] ?? '') !== $prevType) {
                    $cost += AVESMAPS_WIKI_PATH_VERLAUF_TRACE_SUBTYPE_PENALTY;
                }
                $stateKey = (string) ($connection['id'] ?? $publicId) . '|' . $node . '>' . (string) $neighbour;
                if (isset($states[$stateKey]) && $states[$stateKey]['cost'] <= $cost) {
                    continue;
                }
                $states[$stateKey] = [
                    'cost' => $cost, 'settled' => false, 'prev' => $prevKey, 'node' => (string) $neighbour,
                    'arrive' => (float) $headings['arrive'], 'type' => (string) ($connection['route_type'] ?? ''),
                    'edges' => $edges + 1, 'ids' => $nextIds, 'public_id' => $publicId,
                    'geometry' => $connection['geometry'] ?? null, 'from_node' => $node,
                ];
                $queue->insert($stateKey, -$cost);
            }
        }
    };

    $pushArms($fromName, null, 0.0, null, null, 0, []);
    $goalKey = null;
    while (!$queue->isEmpty() && $stateCount < AVESMAPS_WIKI_PATH_VERLAUF_TRACE_MAX_STATES) {
        $stateKey = $queue->extract();
        $state = $states[$stateKey] ?? null;
        if ($state === null || $state['settled']) {
            continue;
        }
        $states[$stateKey]['settled'] = true;
        $stateCount++;
        if ($state['node'] === $toName) {
            $goalKey = $stateKey;
            break;
        }
        $pushArms($state['node'], $stateKey, $state['cost'], $state['arrive'], $state['type'], $state['edges'], $state['ids']);
    }
    if ($goalKey === null) {
        return $fail;
    }

    $orderedStates = [];
    for ($key = $goalKey; $key !== null; $key = $states[$key]['prev']) {
        array_unshift($orderedStates, $states[$key]);
    }
    $segments = [];
    $seenIds = [];
    $via = [];
    foreach ($orderedStates as $index => $state) {
        if (!isset($seenIds[$state['public_id']])) {
            $seenIds[$state['public_id']] = true;
            $segments[] = ['public_id' => $state['public_id'], 'geometry' => $state['geometry']];
        }
        if ($index < count($orderedStates) - 1) {
            $via[] = $state['node'];
        }
    }

    return ['found' => true, 'reason' => '', 'segments' => $segments, 'via' => $via];
}

// Assignment-context gap snapping (owner decision 2026-07-06, "ignore the gap"): the routing
// COPY of the network pulls path vertices within DOCK_RADIUS exactly onto a nearby location
// point (covers hairline rifts like Elenvina at 0.00054 units AND places drawn beside their
// road like Zinnen am Ratsforst at 2.77) and welds path endpoints within WELD_RADIUS of each
// other (pure float-drift rifts between two drawn lines). Stored geometry, the public route
// planner and both live routing engines stay untouched; the global synthetic Querfeldein
// bridges (median length ~172 units) remain excluded from course computation.
const AVESMAPS_WIKI_PATH_VERLAUF_DOCK_RADIUS = 3.5;
const AVESMAPS_WIKI_PATH_VERLAUF_WELD_RADIUS = 0.05;

function avesmapsWikiPathVerlaufSnapNetworkGaps(array $networkData): array {
    $locations = is_array($networkData['locations'] ?? null) ? $networkData['locations'] : [];
    $paths = is_array($networkData['paths'] ?? null) ? $networkData['paths'] : [];
    $cellSize = 8.0; // spatial-hash cell, must stay >= DOCK_RADIUS

    $locationGrid = [];
    foreach ($locations as $location) {
        $point = $location['geometry']['coordinates'] ?? null;
        if (!is_array($point) || !is_numeric($point[0] ?? null) || !is_numeric($point[1] ?? null)) {
            continue;
        }
        $x = (float) $point[0];
        $y = (float) $point[1];
        $locationGrid[((int) floor($x / $cellSize)) . ':' . ((int) floor($y / $cellSize))][] = [$x, $y];
    }
    $nearestLocation = static function (float $x, float $y) use ($locationGrid, $cellSize): ?array {
        $cellX = (int) floor($x / $cellSize);
        $cellY = (int) floor($y / $cellSize);
        $best = null;
        $bestDistance = AVESMAPS_WIKI_PATH_VERLAUF_DOCK_RADIUS;
        for ($dx = -1; $dx <= 1; $dx++) {
            for ($dy = -1; $dy <= 1; $dy++) {
                foreach ($locationGrid[($cellX + $dx) . ':' . ($cellY + $dy)] ?? [] as $point) {
                    $distance = hypot($x - $point[0], $y - $point[1]);
                    if ($distance <= $bestDistance) {
                        $bestDistance = $distance;
                        $best = $point;
                    }
                }
            }
        }

        return $best;
    };

    // Pass 1 (dock): per path, pull for each nearby location only the NEAREST vertex onto the
    // location point (one junction per place, no degenerate duplicate vertices).
    foreach ($paths as $pathIndex => $path) {
        $coordinates = $path['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates)) {
            continue;
        }
        $bestByLocation = [];
        foreach ($coordinates as $vertexIndex => $coordinate) {
            if (!is_array($coordinate) || !is_numeric($coordinate[0] ?? null) || !is_numeric($coordinate[1] ?? null)) {
                continue;
            }
            $location = $nearestLocation((float) $coordinate[0], (float) $coordinate[1]);
            if ($location === null) {
                continue;
            }
            $locationKey = $location[0] . ':' . $location[1];
            $distance = hypot((float) $coordinate[0] - $location[0], (float) $coordinate[1] - $location[1]);
            if (!isset($bestByLocation[$locationKey]) || $distance < $bestByLocation[$locationKey]['distance']) {
                $bestByLocation[$locationKey] = ['index' => $vertexIndex, 'distance' => $distance, 'point' => $location];
            }
        }
        foreach ($bestByLocation as $dock) {
            $paths[$pathIndex]['geometry']['coordinates'][$dock['index']] = [$dock['point'][0], $dock['point'][1]];
        }
    }

    // Pass 2 (weld): unify path ENDPOINTS within WELD_RADIUS (first endpoint seen wins).
    $endpointGrid = [];
    $weldCell = 1.0;
    $canonical = static function (float $x, float $y) use (&$endpointGrid, $weldCell): array {
        $cellX = (int) floor($x / $weldCell);
        $cellY = (int) floor($y / $weldCell);
        for ($dx = -1; $dx <= 1; $dx++) {
            for ($dy = -1; $dy <= 1; $dy++) {
                foreach ($endpointGrid[($cellX + $dx) . ':' . ($cellY + $dy)] ?? [] as $point) {
                    if (hypot($x - $point[0], $y - $point[1]) <= AVESMAPS_WIKI_PATH_VERLAUF_WELD_RADIUS) {
                        return $point;
                    }
                }
            }
        }
        $endpointGrid[$cellX . ':' . $cellY][] = [$x, $y];

        return [$x, $y];
    };
    foreach ($paths as $pathIndex => $path) {
        $coordinates = $path['geometry']['coordinates'] ?? null;
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        foreach ([0, count($coordinates) - 1] as $endIndex) {
            $coordinate = $coordinates[$endIndex];
            if (!is_array($coordinate) || !is_numeric($coordinate[0] ?? null) || !is_numeric($coordinate[1] ?? null)) {
                continue;
            }
            $paths[$pathIndex]['geometry']['coordinates'][$endIndex] = $canonical((float) $coordinate[0], (float) $coordinate[1]);
        }
    }

    $networkData['paths'] = $paths;

    return $networkData;
}

// Foreign-town guard passage radius (map units): a hop segment whose geometry comes this close
// to a town's point counts as passing THROUGH that town (towns often sit on a spur beside the
// through-line, so route-node names alone miss them - the Alfenmohn case on Reichsstrasse 3).
const AVESMAPS_WIKI_PATH_VERLAUF_TOWN_RADIUS = 1.5;
// Spatial-hash cell size for the town prefilter; must stay well above the radius.
const AVESMAPS_WIKI_PATH_VERLAUF_TOWN_GRID = 8.0;

// UTF-8-aware lowercasing for case-insensitive station matching (spec: mb_strtolower, UTF-8).
// Falls back to strtolower when the mbstring extension is not loaded, so the standalone engine
// test (tools/paths/test-path-verlauf-engine.php, plain `php`) stays runnable; production always
// has mbstring (used across api/), where German umlauts fold correctly.
function avesmapsWikiPathVerlaufLower(string $value): string {
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

// Reads the current wiki_path assignment of every active path feature, so the diff engine can
// compare the stored course against the staging verlauf without re-querying per case. Decodes
// properties_json once per row; rows without a wiki_path.wiki_key are absent from both indices
// (a segment that carries no wiki assignment is neither part of any way's Ist nor a conflict
// candidate). Returns two views of the same data:
//   byWikiKey[wiki_key][public_id] => ['public_id','name','subtype','source','course_hash','course_hops']
//   byPublicId[public_id]          => ['wiki_key','name','source']
function avesmapsWikiPathVerlaufReadAssignments(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json
        FROM map_features
        WHERE is_active = 1 AND feature_type = 'path'"
    );

    $byWikiKey = [];
    $byPublicId = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $name = (string) ($row['name'] ?? '');
        $source = (string) ($wikiPath['source'] ?? 'editor');
        $courseHash = (string) ($wikiPath['course_hash'] ?? '');
        // Current hop labels for this segment (Task 5 restamp compares stored vs. Soll hops to skip
        // a no-op restamp when both hash and hops already match).
        $courseHops = is_array($wikiPath['course_hops'] ?? null) ? array_values(array_map('strval', $wikiPath['course_hops'])) : [];

        $byWikiKey[$wikiKey][$publicId] = [
            'public_id' => $publicId,
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'source' => $source,
            'course_hash' => $courseHash,
            'course_hops' => $courseHops,
        ];
        $byPublicId[$publicId] = [
            'wiki_key' => $wikiKey,
            'name' => $name,
            'source' => $source,
        ];
    }

    return ['byWikiKey' => $byWikiKey, 'byPublicId' => $byPublicId];
}

// Stored hash of a way = the most frequent non-empty course_hash among its current segments
// (engine rule 1). Empty string when the way has no hashed segment (never synced). Ties are
// broken by first-seen order (deterministic for a stable segment iteration).
function avesmapsWikiPathVerlaufStoredHash(array $currentSegments): string {
    $counts = [];
    $order = [];
    foreach ($currentSegments as $segment) {
        $hash = (string) ($segment['course_hash'] ?? '');
        if ($hash === '') {
            continue;
        }
        if (!isset($counts[$hash])) {
            $counts[$hash] = 0;
            $order[$hash] = count($order);
        }
        $counts[$hash]++;
    }
    if ($counts === []) {
        return '';
    }
    $best = '';
    $bestCount = -1;
    $bestOrder = PHP_INT_MAX;
    foreach ($counts as $hash => $count) {
        if ($count > $bestCount || ($count === $bestCount && $order[$hash] < $bestOrder)) {
            $best = (string) $hash;
            $bestCount = $count;
            $bestOrder = $order[$hash];
        }
    }
    return $best;
}

// The core diff engine (engine rules 1-13, docs/refactoring-verlauf-sync.md). PURE apart from the
// injected $router and $locationLookup, so the pipeline tests drive it with fixtures (no DB, no
// routing lib). Compares one staging row's `verlauf` course (Soll) against the way's current
// segment assignment (Ist = $assignments['byWikiKey'][wiki_key]) and returns a review case, or
// null when nothing is actionable / the way is not verlauf-syncable.
//
//   $router(string $fromName, string $toName): array -> ['found'=>bool, 'reason'=>string,
//       'segments'=>[['public_id'=>string, 'name'=>string], ...], 'via'=>[node names between the
//       endpoints]]  (synthetic Querfeldein already post-filtered out by the caller in
//       avesmapsWikiPathVerlaufListCases).
//   $locationLookup[mb_strtolower(name)] => canonicalName  (case-insensitive station match).
//   $townLookup[mb_strtolower(name)] => true for settlements of rank kleinstadt and above.
//       When non-empty, a hop whose route passes THROUGH such a town that the wiki chain does
//       not list is unroutable (reason 'foreign_town') -- owner rule 2026-07-06: assignment may
//       only run on routes between the wiki-listed cities (Reichsstrasse 3 detoured via
//       Alfenmohn/Winhall corridors otherwise).
function avesmapsWikiPathVerlaufComputeCase(array $stagingRow, array $assignments, array $locationLookup, callable $router, array $townLookup = []): ?array {
    $wikiKey = (string) ($stagingRow['wiki_key'] ?? '');
    $verlauf = (string) ($stagingRow['verlauf'] ?? '');
    $stagingHash = avesmapsWikiPathCourseHash($verlauf);

    $byWikiKey = is_array($assignments['byWikiKey'] ?? null) ? $assignments['byWikiKey'] : [];
    $byPublicId = is_array($assignments['byPublicId'] ?? null) ? $assignments['byPublicId'] : [];
    $currentSegments = is_array($byWikiKey[$wikiKey] ?? null) ? $byWikiKey[$wikiKey] : [];

    // Rule 13: ways with ZERO current segments are skipped entirely -- verlauf sync updates
    // ASSIGNED ways; initial assignment stays with the existing panel/pipeline.
    if ($currentSegments === []) {
        return null;
    }

    // Rule 1: stored hash = most frequent non-empty course_hash among current segments.
    $storedHash = avesmapsWikiPathVerlaufStoredHash($currentSegments);

    // Rule 2: staging_hash === stored_hash and both non-empty => unchanged (the only cheap exit).
    if ($stagingHash !== '' && $stagingHash === $storedHash) {
        return null;
    }

    // Rule 3: < 2 parsed stations => not routable by definition; never propose removals from an
    // uncomputable course.
    $stations = avesmapsWikiPathVerlaufStations($verlauf);
    if (count($stations) < 2) {
        return null;
    }

    // Rule 4: station -> location by case-insensitive name; unmatched -> flags.missing_stations,
    // chain keeps only matched stations.
    $missingStations = [];
    $matchedChain = [];
    foreach ($stations as $station) {
        $canonical = $locationLookup[avesmapsWikiPathVerlaufLower($station)] ?? null;
        if ($canonical === null) {
            $missingStations[] = $station;
            continue;
        }
        $matchedChain[] = (string) $canonical;
    }

    // Foreign-town guard whitelist: every wiki-listed station (matched or not) is a
    // legitimate through-town; everything else of town rank flags the hop.
    $stationKeys = [];
    foreach ($stations as $station) {
        $stationKeys[avesmapsWikiPathVerlaufLower($station)] = true;
    }

    // Spatial hash over the foreign-town coordinates (grid prefilter keeps the per-vertex
    // proximity check O(1); town entries without coordinates stay via-name-only).
    $townGrid = [];
    foreach ($townLookup as $townKey => $townEntry) {
        if (!is_array($townEntry) || isset($stationKeys[$townKey])) {
            continue;
        }
        $townX = $townEntry['x'] ?? null;
        $townY = $townEntry['y'] ?? null;
        if (!is_numeric($townX) || !is_numeric($townY)) {
            continue;
        }
        $cell = (int) floor(((float) $townX) / AVESMAPS_WIKI_PATH_VERLAUF_TOWN_GRID) . ':' . (int) floor(((float) $townY) / AVESMAPS_WIKI_PATH_VERLAUF_TOWN_GRID);
        $townGrid[$cell][] = ['name' => (string) ($townEntry['name'] ?? $townKey), 'x' => (float) $townX, 'y' => (float) $townY];
    }

    $flags = [
        'missing_stations' => $missingStations,
        'unroutable_hops' => [],
        'conflicts' => [],
        'backtrack_hops' => [],
        // Info only (owner rule): towns the DRAWN line passes through on a traced hop belong
        // to the road even when the wiki box does not list them. Never affects clean.
        'passage_towns' => [],
        // Info only: removals rules 8/8b held back. Suppressed must not mean invisible -- the
        // editor needs to see WHY a way reports nothing to clear, and a scan needs to find these
        // again once the chain is repaired. Never affects clean (its causes already do).
        'removes_suppressed' => [],
    ];

    $baseCase = [
        'wiki_key' => $wikiKey,
        'name' => (string) ($stagingRow['name'] ?? ''),
        'kind' => (string) ($stagingRow['kind'] ?? '') === 'fluss' ? 'fluss' : 'strasse',
        'wiki_url' => (string) ($stagingRow['wiki_url'] ?? ''),
        'staging_id' => (int) ($stagingRow['id'] ?? 0),
        'staging_hash' => $stagingHash,
        'stored_hash' => $storedHash,
        'stations' => $matchedChain,
        'status' => 'open',
    ];

    // Rule 5: matched chain < 2 stations => hint case station_missing, adds/removes empty.
    if (count($matchedChain) < 2) {
        return $baseCase + [
            'type' => 'station_missing',
            'clean' => false,
            'hash_only' => false,
            'flags' => $flags,
            'adds' => [],
            'removes' => [],
            'keeps' => [],
        ];
    }

    // Rule 6: hops = consecutive matched-station pairs. Route each; classify unroutable reasons.
    // Rule 7: Soll = union of routable hops' segment public_ids, with the hop labels that justify
    // each segment (course_hops / adds[].hops / keeps[].hops).
    $sollHops = [];             // public_id => [hop label, ...] (insertion order preserved)
    $sollNames = [];            // public_id => router-provided segment name (first non-empty wins)
    $hopSegmentIds = [];        // per hop index => [public_id, ...] (for backtrack detection)
    $anyUnroutable = false;
    for ($i = 0; $i < count($matchedChain) - 1; $i++) {
        $fromName = $matchedChain[$i];
        $toName = $matchedChain[$i + 1];
        $label = $fromName . ' → ' . $toName;
        $result = $router($fromName, $toName);

        $found = (bool) ($result['found'] ?? false);
        $segments = is_array($result['segments'] ?? null) ? $result['segments'] : [];
        if (!$found) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'no_route'];
            $anyUnroutable = true;
            continue;
        }

        // Synthetic gap: any segment is a Querfeldein bridge (synthetic true or empty public_id).
        $hasSynthetic = false;
        foreach ($segments as $segment) {
            if (!empty($segment['synthetic']) || (string) ($segment['public_id'] ?? '') === '') {
                $hasSynthetic = true;
                break;
            }
        }
        if ($hasSynthetic) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'synthetic_gap'];
            $anyUnroutable = true;
            continue;
        }

        // Detour: too many segments for a faithful course match.
        if (count($segments) > AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS) {
            $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'detour'];
            $anyUnroutable = true;
            continue;
        }

        // Foreign-town guard: the hop must not pass THROUGH a town the wiki chain does not
        // list (routing "fastest" otherwise drags the way over foreign corridors). Two
        // detectors: route-node names (towns the graph splits at) and geometry proximity
        // (towns on a spur beside the through-line never appear as route nodes).
        if ($townLookup !== []) {
            $foreignTowns = [];
            foreach ((is_array($result['via'] ?? null) ? $result['via'] : []) as $viaName) {
                $viaKey = avesmapsWikiPathVerlaufLower((string) $viaName);
                if (isset($townLookup[$viaKey]) && !isset($stationKeys[$viaKey]) && !in_array((string) $viaName, $foreignTowns, true)) {
                    $foreignTowns[] = (string) $viaName;
                }
            }
            if ($townGrid !== []) {
                foreach ($segments as $segment) {
                    $coordinates = $segment['geometry']['coordinates'] ?? null;
                    if (!is_array($coordinates)) {
                        continue;
                    }
                    foreach ($coordinates as $coordinate) {
                        if (!is_array($coordinate) || !is_numeric($coordinate[0] ?? null) || !is_numeric($coordinate[1] ?? null)) {
                            continue;
                        }
                        $x = (float) $coordinate[0];
                        $y = (float) $coordinate[1];
                        $cellX = (int) floor($x / AVESMAPS_WIKI_PATH_VERLAUF_TOWN_GRID);
                        $cellY = (int) floor($y / AVESMAPS_WIKI_PATH_VERLAUF_TOWN_GRID);
                        for ($dx = -1; $dx <= 1; $dx++) {
                            for ($dy = -1; $dy <= 1; $dy++) {
                                foreach (($townGrid[($cellX + $dx) . ':' . ($cellY + $dy)] ?? []) as $town) {
                                    if (hypot($x - $town['x'], $y - $town['y']) <= AVESMAPS_WIKI_PATH_VERLAUF_TOWN_RADIUS
                                        && !in_array($town['name'], $foreignTowns, true)) {
                                        $foreignTowns[] = $town['name'];
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if ($foreignTowns !== []) {
                if ((string) ($result['method'] ?? 'dijkstra') === 'trace') {
                    // Traced hop = we followed the drawn road itself; towns on the line are
                    // legitimate passage (owner rule), reported as info, never a failure.
                    $flags['passage_towns'][] = ['from' => $fromName, 'to' => $toName, 'towns' => $foreignTowns];
                } else {
                    $flags['unroutable_hops'][] = ['from' => $fromName, 'to' => $toName, 'reason' => 'foreign_town', 'towns' => $foreignTowns];
                    $anyUnroutable = true;
                    continue;
                }
            }
        }

        $thisHopIds = [];
        foreach ($segments as $segment) {
            $publicId = (string) ($segment['public_id'] ?? '');
            if ($publicId === '') {
                continue;
            }
            $thisHopIds[] = $publicId;
            if (!isset($sollHops[$publicId])) {
                $sollHops[$publicId] = [];
            }
            if (!in_array($label, $sollHops[$publicId], true)) {
                $sollHops[$publicId][] = $label;
            }
            if (($sollNames[$publicId] ?? '') === '') {
                $segmentName = (string) ($segment['name'] ?? '');
                if ($segmentName !== '') {
                    $sollNames[$publicId] = $segmentName;
                }
            }
        }
        $hopSegmentIds[$i] = $thisHopIds;
    }

    // Rule 10: consecutive routable hops sharing >= 1 segment id => the shared middle station is a
    // backtrack (info only, no effect on clean).
    $hopIndices = array_keys($hopSegmentIds);
    for ($j = 0; $j < count($hopIndices) - 1; $j++) {
        $indexA = $hopIndices[$j];
        $indexB = $hopIndices[$j + 1];
        if ($indexB !== $indexA + 1) {
            continue;
        }
        if (array_intersect($hopSegmentIds[$indexA], $hopSegmentIds[$indexB]) !== []) {
            $flags['backtrack_hops'][] = $matchedChain[$indexB];
        }
    }

    // Rule 9 (diff vs current Ist):
    //   adds = Soll - Ist; a Soll segment owned by ANOTHER wiki way is NOT added -> flags.conflicts
    //          (conflict 'foreign'); the sync leaves the gap (invariant 3).
    //   removes = Ist - Soll with source 'verlauf-sync'; owner-curated (source != 'verlauf-sync')
    //          members of Ist - Soll go to flags.conflicts (conflict 'owner'), never removed.
    //   keeps = Soll ∩ Ist (routable), with the hop labels justifying each kept segment.
    $adds = [];
    $keeps = [];
    foreach ($sollHops as $publicId => $hops) {
        $inIst = isset($currentSegments[$publicId]);
        if ($inIst) {
            $keeps[] = ['public_id' => (string) $publicId, 'hops' => $hops];
            continue;
        }
        $foreign = $byPublicId[$publicId] ?? null;
        if (is_array($foreign) && (string) ($foreign['wiki_key'] ?? '') !== $wikiKey && (string) ($foreign['wiki_key'] ?? '') !== '') {
            $flags['conflicts'][] = [
                'public_id' => (string) $publicId,
                'name' => (string) ($foreign['name'] ?? ''),
                'conflict' => 'foreign',
                'other_wiki_key' => (string) ($foreign['wiki_key'] ?? ''),
            ];
            continue;
        }
        // Prefer the router's own segment name (rule 7 data); fall back to the current
        // assignment index for completeness (e.g. a foreign-owned segment we skipped above,
        // or a router result that omitted the name).
        $addName = $sollNames[$publicId] ?? '';
        if ($addName === '') {
            $addName = (string) ($foreign['name'] ?? '');
        }
        $adds[] = ['public_id' => (string) $publicId, 'name' => $addName, 'hops' => $hops];
    }

    $removes = [];
    foreach ($currentSegments as $publicId => $segment) {
        if (isset($sollHops[$publicId])) {
            continue;
        }
        if ((string) ($segment['source'] ?? '') === 'verlauf-sync') {
            $removes[] = ['public_id' => (string) $publicId, 'name' => (string) ($segment['name'] ?? '')];
            continue;
        }
        $flags['conflicts'][] = [
            'public_id' => (string) $publicId,
            'name' => (string) ($segment['name'] ?? ''),
            'conflict' => 'owner',
            'other_wiki_key' => $wikiKey,
        ];
    }

    // Rule 8: any unroutable hop forces removes empty (a partial Soll must never trigger removals);
    // adds stay (additive is safe). The case is not clean anyway.
    //
    // Rule 8b (same reason, second cause): a station the map does not know is dropped from the chain
    // in rule 4, so the hops that station would have anchored are never routed and their segments
    // never enter the Soll -- they would look like strays and be removed. Bug #39 hit exactly this:
    // the Eisenstraße is missing Pass von Amradosch / Burg Harschberg / Hexenschritt, whose pass
    // section holds 10 of its 21 segments. Removals therefore wait until the chain resolves fully
    // (create or alias the location, then recompute), which is the documented repair order anyway.
    if ($anyUnroutable || $missingStations !== []) {
        $flags['removes_suppressed'] = $removes;
        $removes = [];
    }

    // Rule 11: type precedence.
    $hasConflicts = $flags['conflicts'] !== [];
    $hasDiff = $adds !== [] || $removes !== [];
    $hashOnly = false;
    if ($hasConflicts) {
        $type = 'course_conflict';
    } elseif ($hasDiff) {
        $type = 'verlauf_changed';
    } elseif ($missingStations !== []) {
        $type = 'station_missing';
    } elseif ($flags['unroutable_hops'] !== []) {
        $type = 'hops_unroutable';
    } else {
        // Hash changed, segment sets identical, no flags => restamp only.
        $type = 'verlauf_changed';
        $hashOnly = true;
    }

    // Rule 12: clean = verlauf_changed AND all flags empty AND stored_hash != '' (never-synced ways
    // are always manual) AND (adds/removes non-empty OR hash_only).
    $allFlagsEmpty = $missingStations === []
        && $flags['unroutable_hops'] === []
        && $flags['conflicts'] === []
        && $flags['backtrack_hops'] === [];
    $clean = $type === 'verlauf_changed'
        && $allFlagsEmpty
        && $storedHash !== ''
        && ($hasDiff || $hashOnly);

    return $baseCase + [
        'type' => $type,
        'clean' => $clean,
        'hash_only' => $hashOnly,
        'flags' => $flags,
        'adds' => $adds,
        'removes' => $removes,
        'keeps' => $keeps,
    ];
}

// Pure write planner (Task 5). Turns a recomputed case (Soll) plus the way's CURRENT segment state
// into the exact set of writes ApplyCase executes, honouring the owner-edit-since-compute traps:
//   - adds     => [public_id => hops]  every routable Soll-Add (always written single-segment).
//   - removes  => [public_id, ...]      Ist-Removes whose CURRENT source is STILL 'verlauf-sync'
//                                        (owner may have flipped it or the row may have vanished
//                                        from Ist between compute and write -> drop it, never clear).
//   - restamps => [public_id => hops]   Soll ∩ Ist keeps whose stored course_hash != staging_hash OR
//                                        whose stored course_hops differ from this keep's hops
//                                        (hash-only cases restamp here; provenance/source untouched).
// $currentByPublicId[public_id] => ['source' => s, 'course_hash' => s, 'course_hops' => array].
function avesmapsWikiPathVerlaufPlanWrites(array $case, array $currentByPublicId): array {
    $stagingHash = (string) ($case['staging_hash'] ?? '');

    $adds = [];
    foreach (is_array($case['adds'] ?? null) ? $case['adds'] : [] as $add) {
        $publicId = (string) ($add['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $adds[$publicId] = is_array($add['hops'] ?? null) ? array_values(array_map('strval', $add['hops'])) : [];
    }

    $removes = [];
    foreach (is_array($case['removes'] ?? null) ? $case['removes'] : [] as $remove) {
        $publicId = (string) ($remove['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $current = $currentByPublicId[$publicId] ?? null;
        // Owner may have re-touched (source flipped) or unassigned the segment between compute and
        // write: only clear rows still owned by verlauf-sync (invariant 2 / spec §3 remove rule).
        if (is_array($current) && (string) ($current['source'] ?? '') === 'verlauf-sync') {
            $removes[] = $publicId;
        }
    }

    $restamps = [];
    foreach (is_array($case['keeps'] ?? null) ? $case['keeps'] : [] as $keep) {
        $publicId = (string) ($keep['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $current = $currentByPublicId[$publicId] ?? null;
        if (!is_array($current)) {
            continue;
        }
        $hops = is_array($keep['hops'] ?? null) ? array_values(array_map('strval', $keep['hops'])) : [];
        $currentHops = is_array($current['course_hops'] ?? null) ? array_values(array_map('strval', $current['course_hops'])) : [];
        $hashMatches = (string) ($current['course_hash'] ?? '') === $stagingHash;
        if ($hashMatches && $currentHops === $hops) {
            continue;
        }
        $restamps[$publicId] = $hops;
    }

    return ['adds' => $adds, 'removes' => $removes, 'restamps' => $restamps];
}

// Case-status side-table (Task 4): persists ONLY the user's review decision (deferred/archived) per
// wiki way, keyed by wiki_key. "open" cases are computed live in avesmapsWikiPathVerlaufListCases (a
// staging row whose hash differs from the way's current stored hash); a persisted status applies only
// while its stored course_hash still matches that staging hash -- a later wiki course edit changes the
// staging hash and the case reopens automatically (deviation from the political_capital_case_status
// pattern, justified because verlauf cases are versioned by course). Convention as elsewhere in the
// schema: no FK constraints.
function avesmapsWikiPathVerlaufEnsureCaseTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_path_verlauf_case_status (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            course_hash CHAR(40) NOT NULL DEFAULT '',
            resolution_json JSON NULL,
            reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            reviewed_by BIGINT UNSIGNED NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_path_verlauf_case_key (wiki_key),
            KEY idx_wiki_path_verlauf_case_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

// Persists the user's review decision for a verlauf-sync case. defer/archive upsert the override,
// stamped with the wiki way's CURRENT staging hash (so a later wiki edit auto-reopens the case, see
// the table comment above); reopen ('open') removes it so the case falls back to its live-computed
// open state. The apply path (Task 5) deletes the row entirely on a successful sync, same as
// avesmapsPoliticalAssignCapital does for political_capital_case_status.
function avesmapsWikiPathVerlaufUpdateCaseStatus(PDO $pdo, string $wikiKey, string $status, ?array $resolution, int $userId): array {
    avesmapsWikiPathVerlaufEnsureCaseTable($pdo);

    if (!in_array($status, ['open', 'deferred', 'archived'], true)) {
        throw new RuntimeException('Unknown case status.');
    }

    if ($status === 'open') {
        $pdo->prepare('DELETE FROM wiki_path_verlauf_case_status WHERE wiki_key = :k')
            ->execute(['k' => $wikiKey]);
        return ['ok' => true, 'wiki_key' => $wikiKey, 'status' => 'open'];
    }

    $stagingStatement = $pdo->prepare('SELECT verlauf FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $stagingStatement->execute(['k' => $wikiKey]);
    $stagingRow = $stagingStatement->fetch(PDO::FETCH_ASSOC);
    if ($stagingRow === false) {
        throw new RuntimeException('Unknown wiki way: ' . $wikiKey);
    }
    $courseHash = avesmapsWikiPathCourseHash((string) ($stagingRow['verlauf'] ?? ''));

    $resolutionJson = $resolution !== null
        ? json_encode($resolution, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        : null;
    $reviewedBy = $userId > 0 ? $userId : null;

    $statement = $pdo->prepare(
        'INSERT INTO wiki_path_verlauf_case_status (wiki_key, status, course_hash, resolution_json, reviewed_by)
        VALUES (:wiki_key, :status, :course_hash, :resolution_json, :reviewed_by)
        ON DUPLICATE KEY UPDATE status = VALUES(status), course_hash = VALUES(course_hash), resolution_json = VALUES(resolution_json), reviewed_by = VALUES(reviewed_by)'
    );
    $statement->execute([
        'wiki_key' => $wikiKey,
        'status' => $status,
        'course_hash' => $courseHash,
        'resolution_json' => $resolutionJson,
        'reviewed_by' => $reviewedBy,
    ]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'status' => $status];
}

// Paginated case scan for the review UI (GET ?action=verlauf_cases). Walks wiki_path_staging by an
// id cursor, computes a case per row, and time-boxes the batch (STRATO shared hosting). Builds the
// routing context lazily and at most once per kind per request: the expensive full map load
// (avesmapsLoadRouteMapData) and network build happen only when >= 1 way actually needs routing.
//
// $options: cursor (staging id, default 0), limit (default 20, max 50), step_runtime (seconds,
// default 15, max 25). Response: {ok, cases, scanned, next_cursor, complete, runtime_seconds}.
// Shared lazy routing context for the verlauf-sync case engine (used by both ListCases and the
// ApplyCase/ApplyCleanCases flow). Loads the routing libs, then builds -- at most once per kind per
// request, and only when actually asked -- a router closure per transport kind plus the station
// name lookup. The expensive avesmapsLoadRouteMapData / network build happen lazily on first
// router() call, so a scan that never needs routing never pays for them. Returns:
//   ['router' => fn(string $kind): callable,  'lookup' => fn(): array (name-lower => canonicalName)]
// The lookup is populated as a side effect of the first router() call (it needs the loaded network);
// callers pass lookup() into avesmapsWikiPathVerlaufComputeCase AFTER building the kind's router.
function avesmapsWikiPathVerlaufBuildRoutingContext(array $config): array {
    require_once __DIR__ . '/../routing/request.php';
    require_once __DIR__ . '/../routing/map-data.php';
    require_once __DIR__ . '/../routing/network-data.php';
    require_once __DIR__ . '/../routing/client-graph.php';

    $mapData = null;
    $networkData = null;
    $locationLookup = null;
    $townLookup = null;    // lowered name => town entry for kleinstadt and above (foreign-town guard)
    $routersByKind = [];   // kind => callable
    $connectedByKind = []; // kind => [lowered node name => true] for nodes with >=1 REAL edge

    $router = static function (string $kind) use ($config, &$mapData, &$networkData, &$locationLookup, &$townLookup, &$routersByKind, &$connectedByKind): callable {
        if (isset($routersByKind[$kind])) {
            return $routersByKind[$kind];
        }
        $rawRequest = [
            'from' => 'verlauf-sync',
            'to' => 'verlauf-sync',
            'enabled_transports' => $kind === 'fluss'
                ? ['land' => false, 'river' => true, 'sea' => false]
                : ['land' => true, 'river' => false, 'sea' => false],
        ];
        $request = avesmapsNormalizeRouteRequest($rawRequest);
        $mapData ??= avesmapsLoadRouteMapData($config);
        if ($networkData === null) {
            // Gap snapping on the routing copy only (dock places onto nearby lines, weld
            // hairline rifts) - owner decision 2026-07-06, see the snap function's comment.
            $networkData = avesmapsWikiPathVerlaufSnapNetworkGaps(avesmapsBuildRouteNetworkData($mapData));
        }
        if ($locationLookup === null) {
            $locationLookup = [];
            $townLookup = [];
            foreach ($networkData['locations'] as $location) {
                $name = (string) ($location['name'] ?? '');
                if ($name === '') {
                    continue;
                }
                $locationLookup[avesmapsWikiPathVerlaufLower($name)] = $name;
                if (in_array(strtolower((string) ($location['subtype'] ?? '')), ['metropole', 'grossstadt', 'stadt', 'kleinstadt'], true)) {
                    // Point geometry [x, y]; the coordinates feed the guard's proximity detector.
                    $coordinates = $location['geometry']['coordinates'] ?? null;
                    $townLookup[avesmapsWikiPathVerlaufLower($name)] = [
                        'name' => $name,
                        'x' => is_array($coordinates) && is_numeric($coordinates[0] ?? null) ? (float) $coordinates[0] : null,
                        'y' => is_array($coordinates) && is_numeric($coordinates[1] ?? null) ? (float) $coordinates[1] : null,
                    ];
                }
            }
        }
        $graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
        // Nodes reachable over at least one REAL (non-synthetic) edge in THIS kind's network.
        // Stations whose place has no real edge get dropped from the kind's location lookup so
        // the chain bridges across them (they surface as missing stations - map-care hint).
        $adjacency = is_array($graph['graph'] ?? null) ? $graph['graph'] : $graph;
        $connected = [];
        foreach ($adjacency as $node => $arms) {
            foreach ((is_array($arms) ? $arms : []) as $connections) {
                foreach ((is_array($connections) ? $connections : []) as $connection) {
                    if (empty($connection['synthetic'])) {
                        $connected[avesmapsWikiPathVerlaufLower((string) $node)] = true;
                        continue 3;
                    }
                }
            }
        }
        $connectedByKind[$kind] = $connected;
        $kindRouter = static function (string $from, string $to) use ($graph, $request, $kind): array {
            // Roads: follow the DRAWN line first (owner model "an der Kanon-Strasse
            // entlanghangeln") - places on the line are passage, not corridor errors.
            // Rivers deliberately keep pure Dijkstra: the flow-direction derivation
            // depends on its traversal semantics, and rivers are their own corridor.
            if ($kind !== 'fluss') {
                $trace = avesmapsWikiPathVerlaufTraceHop($graph, $from, $to);
                if (!empty($trace['found'])) {
                    return ['found' => true, 'reason' => '', 'method' => 'trace', 'segments' => $trace['segments'], 'via' => $trace['via']];
                }
            }
            $result = avesmapsFindClientCompatibleRoute($graph, $from, $to, $request);
            if (empty($result['found'])) {
                return ['found' => false, 'reason' => 'no_route', 'segments' => []];
            }
            $segments = avesmapsBuildClientRouteDiagnosticSegments(is_array($result['segments'] ?? null) ? $result['segments'] : []);
            // node_ids are graph node NAMES; the intermediate ones feed the foreign-town guard.
            $nodeIds = is_array($result['node_ids'] ?? null) ? $result['node_ids'] : [];
            $via = array_map('strval', array_slice($nodeIds, 1, max(0, count($nodeIds) - 2)));
            return ['found' => true, 'reason' => '', 'method' => 'dijkstra', 'segments' => $segments, 'via' => $via];
        };
        $routersByKind[$kind] = $kindRouter;
        return $kindRouter;
    };

    $lookup = static function (string $kind = '') use (&$locationLookup, &$connectedByKind, $router): array {
        $base = $locationLookup ?? [];
        if ($kind === '') {
            return $base;
        }
        if (!isset($connectedByKind[$kind])) {
            $router($kind); // builds the graph (memoized) and with it the connectivity set
        }

        return array_intersect_key($base, $connectedByKind[$kind] ?? []);
    };
    $towns = static function () use (&$townLookup): array {
        return $townLookup ?? [];
    };

    return ['router' => $router, 'lookup' => $lookup, 'towns' => $towns];
}

// Batch-fills missing adds[].name across a set of cases from map_features in ONE bounded IN-query.
// The real router segments (avesmapsBuildClientRouteDiagnosticSegments) carry no `name` key, so the
// rule-7 router-name channel comes up empty in production and adds[].name is often '' (a foreign
// row's name from $byPublicId is the only other source, and that rarely fires). This restores the
// UI label without touching the routing lib: collect every add id whose name is still empty across
// all $cases, resolve names once, then patch the case arrays in place. Cases are passed by reference.
function avesmapsWikiPathVerlaufFillAddNames(PDO $pdo, array &$cases): void {
    $missingIds = [];
    foreach ($cases as $case) {
        foreach (is_array($case['adds'] ?? null) ? $case['adds'] : [] as $add) {
            $publicId = (string) ($add['public_id'] ?? '');
            if ($publicId !== '' && (string) ($add['name'] ?? '') === '') {
                $missingIds[$publicId] = true;
            }
        }
    }
    if ($missingIds === []) {
        return;
    }

    $ids = array_keys($missingIds);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $select = $pdo->prepare(
        "SELECT public_id, name FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND public_id IN (" . $placeholders . ')'
    );
    $select->execute($ids);
    $nameById = [];
    foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $nameById[(string) ($row['public_id'] ?? '')] = (string) ($row['name'] ?? '');
    }

    foreach ($cases as &$case) {
        if (!is_array($case['adds'] ?? null)) {
            continue;
        }
        foreach ($case['adds'] as &$add) {
            $publicId = (string) ($add['public_id'] ?? '');
            if ($publicId !== '' && (string) ($add['name'] ?? '') === '' && ($nameById[$publicId] ?? '') !== '') {
                $add['name'] = $nameById[$publicId];
            }
        }
        unset($add);
    }
    unset($case);
}

// Single-case convenience wrapper for avesmapsWikiPathVerlaufFillAddNames: patches one case's
// adds[].name in place via the same one-query path.
function avesmapsWikiPathVerlaufFillAddNamesForCase(PDO $pdo, array &$case): void {
    $wrapper = [$case];
    avesmapsWikiPathVerlaufFillAddNames($pdo, $wrapper);
    $case = $wrapper[0];
}

// Case list, recompute and apply flow -- moved to the sibling file so this one stays readable.
// The require_once stands where the block stood; the sibling has no requires of its own.
require_once __DIR__ . '/path-verlauf-faelle.php';

