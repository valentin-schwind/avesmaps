<?php

declare(strict_types=1);

/**
 * Geometric outlier detection for wiki way assignments (Bug #39).
 *
 * A way's segments should form ONE connected chain. A segment sitting in a separate, distant
 * cluster does not belong to that way -- that is the reported bug: an "Eisenstraße" segment on
 * the beach near Qinsay, 334 map units off its corridor.
 *
 * WHY GEOMETRY AND NOT THE WIKI COURSE (measured 2026-07-22):
 *   - The course-based diff only sees ways whose parsed chain changed; 354 of 596 ways produce
 *     no case at all and would never be checked.
 *   - Worse, the course diff cannot tell a road's own CONTINUATION from a stray: where the wiki
 *     lists only part of a road, everything beyond the first/last listed station falls out of
 *     the Soll and looks removable. "Alle unstrittigen übernehmen" would have cut 17 contiguous
 *     Lettastieg segments on exactly that mistake.
 * Connectivity has neither problem: an extension is attached, a stray is not.
 *
 * The detector never accuses on its own -- it reports clusters and their distance and lets the
 * editor decide. No writes, no map_features access; the caller supplies plain point lists.
 */

// Endpoints this close count as joined. Matches the routing engine's own weld tolerance, so a
// cluster here means the same thing routing means by "connected". A wider value would hide real
// breaks; a hairline gap instead shows up as a separate cluster with a tiny distance and sinks
// to the bottom of the distance-ranked list on its own.
const AVESMAPS_WIKI_PATH_OUTLIER_WELD = 0.05;

// A wiki course station this close to a detached cluster's drawn line counts as lying ON it, so the
// cluster is a real section of the described road, not a stray. Tight on purpose: a misresolved
// station (e.g. the wrong "Grünau", 121 units off) lands far and is ignored -- one true station is
// enough. Owner-set starting value 2026-07-23; adjustable if a real stray is ever wrongly cleared.
const AVESMAPS_WIKI_PATH_OUTLIER_ONCOURSE_TOL = 2.0;

/**
 * Splits one way's segments into connected clusters and measures how far each detached cluster
 * sits from the biggest one.
 *
 * $segments: [ ['public_id'=>string, 'name'=>string, 'source'=>string, 'points'=>[[x,y], ...]], ... ]
 *            Segments without usable geometry are ignored: they cannot be judged and must never
 *            be accused.
 *
 * Returns:
 *   'components'    => [ ['segments'=>[public_id,...], 'size'=>int, 'distance'=>float|null], ... ]
 *                      index 0 is the biggest cluster (distance null); the rest are sorted by
 *                      distance, farthest first.
 *   'outlier_count' => segments outside the biggest cluster
 *   'max_distance'  => farthest detached cluster's distance, or null when everything is joined
 *   'ambiguous'     => true when the biggest cluster is not strictly bigger than the runner-up;
 *                      the way is then split evenly and NOTHING should be presented as the
 *                      wrong half without a human look.
 */
function avesmapsWikiPathOutlierAnalyseWay(array $segments, array $stationCoords = [], float $weld = AVESMAPS_WIKI_PATH_OUTLIER_WELD, float $onCourseTol = AVESMAPS_WIKI_PATH_OUTLIER_ONCOURSE_TOL): array {
    $usable = [];
    foreach ($segments as $segment) {
        $points = [];
        foreach (is_array($segment['points'] ?? null) ? $segment['points'] : [] as $point) {
            if (is_array($point) && is_numeric($point[0] ?? null) && is_numeric($point[1] ?? null)) {
                $points[] = [(float) $point[0], (float) $point[1]];
            }
        }
        if ($points === []) {
            continue;
        }
        $usable[] = [
            'public_id' => (string) ($segment['public_id'] ?? ''),
            'name' => (string) ($segment['name'] ?? ''),
            'source' => (string) ($segment['source'] ?? ''),
            'points' => $points,
            // Connectivity is decided on endpoints only. Paths are split at crossings, so ends
            // are where they meet -- and comparing every vertex of every pair would be O(n^2) in
            // vertices per way for no gain.
            'ends' => [$points[0], $points[count($points) - 1]],
        ];
    }

    $count = count($usable);
    if ($count === 0) {
        return ['components' => [], 'outlier_count' => 0, 'max_distance' => null, 'ambiguous' => false];
    }

    // Union-find over segments joined at their endpoints.
    $parent = range(0, $count - 1);
    $find = static function (int $i) use (&$parent, &$find): int {
        while ($parent[$i] !== $i) {
            $parent[$i] = $parent[$parent[$i]];
            $i = $parent[$i];
        }
        return $i;
    };
    for ($i = 0; $i < $count; $i++) {
        for ($j = $i + 1; $j < $count; $j++) {
            $joined = false;
            foreach ($usable[$i]['ends'] as $a) {
                foreach ($usable[$j]['ends'] as $b) {
                    if (hypot($a[0] - $b[0], $a[1] - $b[1]) <= $weld) {
                        $joined = true;
                        break 2;
                    }
                }
            }
            if ($joined) {
                $rootA = $find($i);
                $rootB = $find($j);
                if ($rootA !== $rootB) {
                    $parent[$rootB] = $rootA;
                }
            }
        }
    }

    // Group by root, preserving first-seen order so ties stay deterministic.
    $groups = [];
    for ($i = 0; $i < $count; $i++) {
        $groups[$find($i)][] = $i;
    }
    $groups = array_values($groups);
    usort($groups, static fn(array $a, array $b): int => count($b) <=> count($a) ?: $a[0] <=> $b[0]);

    $main = $groups[0];
    $mainPoints = [];
    foreach ($main as $index) {
        foreach ($usable[$index]['points'] as $point) {
            $mainPoints[] = $point;
        }
    }

    $components = [[
        'segments' => array_map(static fn(int $i): string => $usable[$i]['public_id'], $main),
        'size' => count($main),
        'distance' => null,
    ]];

    $detached = [];
    foreach (array_slice($groups, 1) as $group) {
        $groupPoints = [];
        foreach ($group as $index) {
            foreach ($usable[$index]['points'] as $point) {
                $groupPoints[] = $point;
            }
        }
        $best = INF;
        foreach ($groupPoints as $a) {
            foreach ($mainPoints as $b) {
                $d = hypot($a[0] - $b[0], $a[1] - $b[1]);
                if ($d < $best) {
                    $best = $d;
                }
            }
        }
        // On-course: does at least one wiki course station lie essentially ON this cluster's drawn
        // geometry? Endpoints are not enough here -- a station can sit mid-segment -- so every vertex
        // is a candidate. One hit is enough; a misresolved station lands far and never counts.
        $onCourseCount = 0;
        foreach ($stationCoords as $st) {
            if (!is_array($st) || !is_numeric($st[0] ?? null) || !is_numeric($st[1] ?? null)) {
                continue;
            }
            foreach ($groupPoints as $p) {
                if (hypot((float) $st[0] - $p[0], (float) $st[1] - $p[1]) <= $onCourseTol) {
                    $onCourseCount++;
                    break;
                }
            }
        }
        $detached[] = [
            'segments' => array_map(static fn(int $i): string => $usable[$i]['public_id'], $group),
            'size' => count($group),
            'distance' => $best === INF ? null : $best,
            'on_course' => $onCourseCount > 0,
            'on_course_count' => $onCourseCount,
        ];
    }
    usort($detached, static fn(array $a, array $b): int => ($b['distance'] ?? 0.0) <=> ($a['distance'] ?? 0.0));

    $outlierCount = 0;
    $maxDistance = null;
    foreach ($detached as $component) {
        $outlierCount += $component['size'];
        if ($component['distance'] !== null && ($maxDistance === null || $component['distance'] > $maxDistance)) {
            $maxDistance = $component['distance'];
        }
    }

    return [
        'components' => array_merge($components, $detached),
        'outlier_count' => $outlierCount,
        'max_distance' => $maxDistance,
        'ambiguous' => count($groups) > 1 && count($groups[0]) === count($groups[1]),
    ];
}

// Flattens any GeoJSON geometry to a plain point list. Only coordinates matter here.
function avesmapsWikiPathOutlierPoints(?array $geometry): array {
    $type = (string) ($geometry['type'] ?? '');
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) {
        return [];
    }
    if ($type === 'Point') {
        return [$coordinates];
    }
    if ($type === 'LineString' || $type === 'MultiPoint') {
        return $coordinates;
    }
    if ($type === 'MultiLineString' || $type === 'Polygon') {
        return array_merge(...array_values(array_filter($coordinates, 'is_array')));
    }
    return [];
}

// Stable identity of ONE detached cluster: the way plus its segment set, order-independent. A
// sha256 so it drops straight into the shared conflict_decision.fingerprint (CHAR(64)). When the
// cluster's segments change (a segment reassigned, split or moved), the fingerprint stops matching
// and the "approved" decision correctly reopens the case.
function avesmapsWikiPathOutlierFingerprint(string $wikiKey, array $segmentIds): string {
    $ids = array_values(array_filter(array_map('strval', $segmentIds), static fn(string $s): bool => $s !== ''));
    sort($ids, SORT_STRING);
    return hash('sha256', $wikiKey . '|' . implode(',', $ids));
}

// Resolves a way's parsed verlauf ("A → B → C") to the coordinates of the stations that exist as
// places on the map. Names that do not resolve (wiki typos, "(Almada)"-style disambiguators lost
// from the display text) are dropped -- the on-course test needs only ONE real station on a cluster,
// so a partial resolution is enough and a wrong one lands far away and is ignored.
function avesmapsWikiPathOutlierStationCoords(string $verlauf, array $nameIndex): array {
    $coords = [];
    foreach (explode('→', $verlauf) as $rawName) {
        $name = trim($rawName);
        if ($name === '' || !isset($nameIndex[$name])) {
            continue;
        }
        foreach ($nameIndex[$name] as $coord) {
            $coords[] = $coord;
        }
    }
    return $coords;
}

/**
 * Builds the editor-facing outlier list over every wiki-assigned path segment.
 *
 * Read-only, one pass, no routing -- unlike the verlauf scan this never loads the route graph,
 * so it stays cheap on shared hosting. Only ids, counts and distances leave the server; the
 * geometry is consumed here.
 *
 * Returns ways that have at least one detached cluster, worst distance first.
 */
function avesmapsWikiPathOutlierList(PDO $pdo): array {
    // The LIKE prefilter keeps the JSON decode off the ~3400 unassigned segments (STRATO).
    $statement = $pdo->query(
        "SELECT public_id, name, geometry_json, properties_json
        FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND properties_json LIKE '%\"wiki_key\"%'"
    );

    $byWay = [];
    $scanned = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        $wikiPath = is_array($props) && is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $scanned++;
        $geometry = json_decode((string) ($row['geometry_json'] ?? ''), true);
        $byWay[$wikiKey]['name'] = (string) ($wikiPath['name'] ?? $wikiPath['wiki_name'] ?? $row['name'] ?? '');
        // Carried for the editor's map link: the shell at /edit/ has no Leaflet, so a row opens
        // the map page's ?strasse=/?fluss= deep link -- which resolves by WIKI PAGE NAME taken
        // from wiki_url, not by wiki_key.
        $byWay[$wikiKey]['wiki_url'] = (string) ($wikiPath['wiki_url'] ?? '');
        $byWay[$wikiKey]['kind'] = (string) ($wikiPath['kind'] ?? '');
        $byWay[$wikiKey]['segments'][] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'source' => (string) ($wikiPath['source'] ?? 'editor'),
            'points' => avesmapsWikiPathOutlierPoints(is_array($geometry) ? $geometry : null),
        ];
    }

    $ways = [];
    foreach ($byWay as $wikiKey => $way) {
        $analysis = avesmapsWikiPathOutlierAnalyseWay($way['segments']);
        if ($analysis['outlier_count'] === 0) {
            continue;
        }
        // Editors need to know whether they may repair a segment at all: only 'verlauf-sync'
        // members can also be cleared by the sync; everything else is theirs alone.
        $sourceById = [];
        foreach ($way['segments'] as $segment) {
            $sourceById[$segment['public_id']] = $segment['source'];
        }
        $detached = [];
        foreach (array_slice($analysis['components'], 1) as $component) {
            $detached[] = [
                'size' => $component['size'],
                'distance' => $component['distance'] === null ? null : round($component['distance'], 2),
                'segments' => array_map(
                    static fn(string $id): array => ['public_id' => $id, 'source' => $sourceById[$id] ?? ''],
                    $component['segments']
                ),
            ];
        }
        $ways[] = [
            'wiki_key' => (string) $wikiKey,
            'name' => (string) ($way['name'] ?? ''),
            'wiki_url' => (string) ($way['wiki_url'] ?? ''),
            'kind' => (string) ($way['kind'] ?? ''),
            'total' => count($way['segments']),
            'main_size' => $analysis['components'][0]['size'],
            'outlier_count' => $analysis['outlier_count'],
            'max_distance' => $analysis['max_distance'] === null ? null : round($analysis['max_distance'], 2),
            'ambiguous' => $analysis['ambiguous'],
            'detached' => $detached,
        ];
    }
    usort($ways, static fn(array $a, array $b): int => ($b['max_distance'] ?? 0.0) <=> ($a['max_distance'] ?? 0.0));

    return ['ok' => true, 'ways' => $ways, 'scanned' => $scanned, 'flagged' => count($ways)];
}
