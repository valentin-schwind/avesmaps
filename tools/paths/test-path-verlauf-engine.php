<?php

declare(strict_types=1);

/**
 * Unit test for the verlauf-sync course-hash helpers and the pure backfill
 * decision function (api/_internal/wiki/path-verlauf.php, spec doc
 * docs/refactoring-verlauf-sync.md, Task 2). Loads ONLY path-verlauf.php --
 * that file must stay DB-context-free at the top level so this test can run
 * standalone. Extended in Task 3 with more decision/diff coverage. Run:
 *     php tools/paths/test-path-verlauf-engine.php
 */

require __DIR__ . '/../../api/_internal/wiki/path-verlauf.php';

$failures = 0;
$total = 0;
function check(string $label, mixed $actual, mixed $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL {$label}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
        return;
    }
    echo "ok {$label}\n";
}

// --- avesmapsWikiPathCourseHash ---
check('hash of empty is empty', avesmapsWikiPathCourseHash('  '), '');
check('hash trims', avesmapsWikiPathCourseHash(' A → B '), sha1('A → B'));

// --- avesmapsWikiPathVerlaufStations ---
check('stations split', avesmapsWikiPathVerlaufStations('Punin → Ragath → Punin → Kuslik'), ['Punin', 'Ragath', 'Kuslik']);
check('stations empty', avesmapsWikiPathVerlaufStations(''), []);

// --- avesmapsWikiPathVerlaufBackfillDecision ---
$d = avesmapsWikiPathVerlaufBackfillDecision(null, 'k', 'A → B');
check('missing row skipped', $d['reason'], 'inactive_or_missing');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'other']], 'k', 'A → B');
check('reassigned skipped', $d['reason'], 'reassigned');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'editor']], 'k', 'A → B');
check('editor source protected', $d['reason'], 'editor_source');

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k']], 'k', 'A → B');
check('stamp sets source', $d['props']['wiki_path']['source'], 'verlauf-sync');
check('stamp sets hash', $d['props']['wiki_path']['course_hash'], sha1('A → B'));

$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync', 'course_hash' => 'old']], 'k', '');
check('empty verlauf keeps old hash', $d['props']['wiki_path']['course_hash'], 'old');
check('restamp allowed', $d['props']['wiki_path']['source'], 'verlauf-sync');

// Self-feed guard (Critical #1): an already-stamped segment whose stored hash already matches the
// audit verlauf is a no-op skip -- otherwise the backfill re-stamps its own audit rows forever.
// (a) already-stamped, SAME hash => skip already_stamped (no UPDATE, no audit row).
$sameHash = avesmapsWikiPathCourseHash('A → B');
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync', 'course_hash' => $sameHash]], 'k', 'A → B');
check('already-stamped same hash skipped', $d['action'], 'skip');
check('already-stamped same hash reason', $d['reason'], 'already_stamped');
check('already-stamped same hash no props', $d['props'], null);
// (b) already-stamped, DIFFERENT hash => still re-stamps (a legitimate later audit entry).
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync', 'course_hash' => 'stale']], 'k', 'A → B');
check('already-stamped different hash restamps', $d['action'], 'stamp');
check('already-stamped different hash new hash', $d['props']['wiki_path']['course_hash'], $sameHash);
// (c) stamped-no-hash + empty audit verlauf => skip already_stamped (both hash to '', nothing changes).
$d = avesmapsWikiPathVerlaufBackfillDecision(['wiki_path' => ['wiki_key' => 'k', 'source' => 'verlauf-sync']], 'k', '');
check('stamped-no-hash empty verlauf skipped', $d['action'], 'skip');
check('stamped-no-hash empty verlauf reason', $d['reason'], 'already_stamped');

// --- avesmapsWikiPathVerlaufComputeCase (Task 3 diff engine) ---
// Fake router over a fixture map: no DB, no routing lib -- exercises the 13 rules directly.
$lookup = ['punin' => 'Punin', 'ragath' => 'Ragath', 'kuslik' => 'Kuslik'];
$routes = [
    'Punin|Ragath' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'Reichsstraße 12'], ['public_id' => 's2', 'name' => 'Reichsstraße 12']]],
    'Ragath|Kuslik' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's3', 'name' => 'Reichsstraße 12']]],
];
$router = static fn(string $f, string $t): array => $routes[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$staging = ['id' => 7, 'wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'kind' => 'strasse', 'wiki_url' => 'https://x/wiki/R12', 'verlauf' => 'Punin → Ragath → Kuslik'];
$assignments = ['byWikiKey' => ['w1' => ['s1' => ['public_id' => 's1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash'], 's9' => ['public_id' => 's9', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash']]], 'byPublicId' => ['s1' => ['wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync'], 's9' => ['wiki_key' => 'w1', 'name' => 'Reichsstraße 12', 'source' => 'verlauf-sync']]];

$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments, $lookup, $router);
check('case type changed', $case['type'], 'verlauf_changed');
check('adds are s2,s3', array_column($case['adds'], 'public_id'), ['s2', 's3']);
check('remove s9', array_column($case['removes'], 'public_id'), ['s9']);
check('clean', $case['clean'], true);
check('add hop labels', $case['adds'][0]['hops'], ['Punin → Ragath']);
check('add names from router segments', array_column($case['adds'], 'name'), ['Reichsstraße 12', 'Reichsstraße 12']);
check('keeps s1 with hop', $case['keeps'], [['public_id' => 's1', 'hops' => ['Punin → Ragath']]]);

// unchanged hash => null
$assignments2 = $assignments;
$assignments2['byWikiKey']['w1']['s1']['course_hash'] = avesmapsWikiPathCourseHash($staging['verlauf']);
$assignments2['byWikiKey']['w1']['s9']['course_hash'] = avesmapsWikiPathCourseHash($staging['verlauf']);
check('unchanged is null', avesmapsWikiPathVerlaufComputeCase($staging, $assignments2, $lookup, $router), null);

// owner-curated remove => conflict, type course_conflict, not clean
$assignments3 = $assignments;
$assignments3['byWikiKey']['w1']['s9']['source'] = 'editor';
$assignments3['byPublicId']['s9']['source'] = 'editor';
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments3, $lookup, $router);
check('owner conflict type', $case['type'], 'course_conflict');
check('owner conflict flagged', $case['flags']['conflicts'][0]['conflict'], 'owner');
check('owner segment not in removes', $case['removes'], []);
check('conflict not clean', $case['clean'], false);

// foreign add => conflict + gap
$assignments4 = $assignments;
$assignments4['byPublicId']['s2'] = ['wiki_key' => 'OTHER', 'name' => 'Fremdweg', 'source' => 'editor'];
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments4, $lookup, $router);
check('foreign conflict', $case['flags']['conflicts'][0]['conflict'], 'foreign');
check('foreign not added', in_array('s2', array_column($case['adds'], 'public_id'), true), false);

// missing station => flagged, chain shrinks
$staging5 = $staging; $staging5['verlauf'] = 'Punin → Phantasia → Kuslik';
$routes['Punin|Kuslik'] = ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'x']]];
$router5 = static fn(string $f, string $t): array => $routes[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($staging5, $assignments, $lookup, $router5);
check('missing station flagged', $case['flags']['missing_stations'], ['Phantasia']);
check('missing station not clean', $case['clean'], false);
// Rule 8b: a station the map does not know shrinks the chain, so the Soll is provably
// incomplete -- segments only the dropped station would have justified must never be
// removed (Bug #39: Eisenstraße's three pass stations carried 10 of its 21 segments).
check('removes suppressed on missing station', $case['removes'], []);
// Suppressed is not the same as gone: the held-back segments stay visible so the editor sees
// WHY a way reports nothing to clear, and so a scan can find them again after the repair.
check('suppressed removes stay reported', array_column($case['flags']['removes_suppressed'], 'public_id'), ['s9']);

// unroutable hop => removes suppressed
$staging6 = $staging;
$router6 = static fn(string $f, string $t): array => $f === 'Punin' && $t === 'Ragath' ? $routes['Punin|Ragath'] : ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($staging6, $assignments, $lookup, $router6);
check('unroutable flagged', $case['flags']['unroutable_hops'][0]['reason'], 'no_route');
check('removes suppressed on unroutable', $case['removes'], []);
check('suppressed removes reported on unroutable too', array_column($case['flags']['removes_suppressed'], 'public_id'), ['s9']);

// never-synced way (no stored hash) => manual (not clean)
$assignments7 = $assignments;
unset($assignments7['byWikiKey']['w1']['s1']['course_hash'], $assignments7['byWikiKey']['w1']['s9']['course_hash']);
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignments7, $lookup, $router);
check('never-synced not clean', $case['clean'], false);

// zero current segments => null
$case = avesmapsWikiPathVerlaufComputeCase($staging, ['byWikiKey' => [], 'byPublicId' => []], $lookup, $router);
check('unassigned way skipped', $case, null);

// hash-only: same sets, different hash
$stagingH = $staging; // Soll = s1,s2,s3
$assignH = ['byWikiKey' => ['w1' => ['s1' => ['public_id' => 's1', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old'], 's2' => ['public_id' => 's2', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old'], 's3' => ['public_id' => 's3', 'name' => 'n', 'source' => 'verlauf-sync', 'course_hash' => 'old']]], 'byPublicId' => ['s1' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync'], 's2' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync'], 's3' => ['wiki_key' => 'w1', 'name' => 'n', 'source' => 'verlauf-sync']]];
$case = avesmapsWikiPathVerlaufComputeCase($stagingH, $assignH, $lookup, $router);
check('hash-only detected', $case['hash_only'], true);
check('hash-only clean', $case['clean'], true);
check('hash-only empty diff', [$case['adds'], $case['removes']], [[], []]);

// --- avesmapsWikiPathVerlaufPlanWrites (Task 5 pure write planner) ---
// The plan is what ApplyCase turns into single-segment assigns/clears/restamps. It is recomputed
// from the case (Soll) and the current Ist ($currentByPublicId) so an owner edit between compute
// and write is honoured: removes drop when source flipped away from 'verlauf-sync'; restamps skip
// keeps whose stored course already matches.
$planCase = [
    'staging_hash' => 'newhash',
    'hash_only' => false,
    'adds' => [['public_id' => 's2', 'name' => 'n', 'hops' => ['A → B']]],
    'removes' => [['public_id' => 's9', 'name' => 'n']],
    'keeps' => [['public_id' => 's1', 'hops' => ['A → B']]],
];
$planCurrent = [
    's1' => ['source' => 'editor', 'course_hash' => 'old', 'course_hops' => []],
    's9' => ['source' => 'verlauf-sync', 'course_hash' => 'old', 'course_hops' => []],
];
$plan = avesmapsWikiPathVerlaufPlanWrites($planCase, $planCurrent);
check('plan adds', $plan['adds'], ['s2' => ['A → B']]);
check('plan removes only sync source', $plan['removes'], ['s9']);
check('plan restamps stale keep', $plan['restamps'], ['s1' => ['A → B']]);
// keep already current => no restamp
$planCurrent2 = $planCurrent;
$planCurrent2['s1'] = ['source' => 'editor', 'course_hash' => 'newhash', 'course_hops' => ['A → B']];
$plan = avesmapsWikiPathVerlaufPlanWrites($planCase, $planCurrent2);
check('no restamp when current', $plan['restamps'], []);
// keep with matching hash but different hops => restamp (hops label drift)
$planCurrent2b = $planCurrent;
$planCurrent2b['s1'] = ['source' => 'editor', 'course_hash' => 'newhash', 'course_hops' => ['X → Y']];
$plan = avesmapsWikiPathVerlaufPlanWrites($planCase, $planCurrent2b);
check('restamp on hop drift', $plan['restamps'], ['s1' => ['A → B']]);
// remove whose source flipped to editor since compute => dropped
$planCurrent3 = $planCurrent;
$planCurrent3['s9']['source'] = 'editor';
$plan = avesmapsWikiPathVerlaufPlanWrites($planCase, $planCurrent3);
check('editor-flipped remove dropped', $plan['removes'], []);
// remove whose row vanished from Ist since compute => dropped (no source to verify)
$planCurrent3b = $planCurrent;
unset($planCurrent3b['s9']);
$plan = avesmapsWikiPathVerlaufPlanWrites($planCase, $planCurrent3b);
check('vanished remove dropped', $plan['removes'], []);
// hash-only case: no adds/removes, keeps restamp
$hashOnlyCase = [
    'staging_hash' => 'newhash',
    'hash_only' => true,
    'adds' => [],
    'removes' => [],
    'keeps' => [['public_id' => 's1', 'hops' => ['A → B']], ['public_id' => 's2', 'hops' => ['B → C']]],
];
$hashOnlyCurrent = [
    's1' => ['source' => 'verlauf-sync', 'course_hash' => 'old', 'course_hops' => ['A → B']],
    's2' => ['source' => 'editor', 'course_hash' => 'newhash', 'course_hops' => ['B → C']],
];
$plan = avesmapsWikiPathVerlaufPlanWrites($hashOnlyCase, $hashOnlyCurrent);
check('hash-only no adds', $plan['adds'], []);
check('hash-only no removes', $plan['removes'], []);
check('hash-only restamps only stale keep', $plan['restamps'], ['s1' => ['A → B']]);

// --- Foreign-town guard (owner rule 2026-07-06: a hop route may not pass through a town
// --- that the wiki chain does not list; Reichsstrasse 3 detoured via Alfenmohn/Winhall) ---

$ftStaging = ['id' => 9, 'wiki_key' => 'ft1', 'name' => 'Teststraße', 'kind' => 'strasse', 'wiki_url' => 'https://x/wiki/T', 'verlauf' => 'Punin → Ragath → Kuslik'];
$ftAssignments = [
    'byWikiKey' => ['ft1' => [
        's1' => ['public_id' => 's1', 'name' => 'Teststraße', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash', 'course_hops' => []],
        's9' => ['public_id' => 's9', 'name' => 'Teststraße', 'source' => 'verlauf-sync', 'course_hash' => 'oldhash', 'course_hops' => []],
    ]],
    'byPublicId' => [
        's1' => ['wiki_key' => 'ft1', 'name' => 'Teststraße', 'source' => 'verlauf-sync'],
        's9' => ['wiki_key' => 'ft1', 'name' => 'Teststraße', 'source' => 'verlauf-sync'],
    ],
];
$ftLookup = ['punin' => 'Punin', 'ragath' => 'Ragath', 'kuslik' => 'Kuslik'];
// Town lookup carries coordinates: the guard checks BOTH route nodes and geometry proximity
// (a road can pass through a town without splitting at its node - Alfenmohn case).
$ftTowns = [
    'winhall' => ['name' => 'Winhall', 'x' => 500.0, 'y' => 500.0],
    'kuslik' => ['name' => 'Kuslik', 'x' => 300.0, 'y' => 300.0],
    'punin' => ['name' => 'Punin', 'x' => 100.0, 'y' => 100.0],
    'ragath' => ['name' => 'Ragath', 'x' => 200.0, 'y' => 200.0],
];

$ftRoutes = [
    'Punin|Ragath' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'Teststraße'], ['public_id' => 's2', 'name' => 'Teststraße']], 'via' => ['Kreuzung-7', 'Winhall']],
    'Ragath|Kuslik' => ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's3', 'name' => 'Teststraße']], 'via' => ['Dorfhausen']],
];
$ftRouter = static fn(string $f, string $t): array => $ftRoutes[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];

$case = avesmapsWikiPathVerlaufComputeCase($ftStaging, $ftAssignments, $ftLookup, $ftRouter, $ftTowns);
check('foreign town flags exactly one hop', count($case['flags']['unroutable_hops']), 1);
check('foreign town reason', $case['flags']['unroutable_hops'][0]['reason'], 'foreign_town');
check('foreign town names listed', $case['flags']['unroutable_hops'][0]['towns'], ['Winhall']);
check('foreign-town hop segments not added', in_array('s2', array_column($case['adds'], 'public_id'), true), false);
check('village via never flags', in_array('s3', array_column($case['adds'], 'public_id'), true), true);
check('removes suppressed while foreign-town hop open', $case['removes'], []);
check('foreign-town case not clean', $case['clean'], false);

// A via town that IS a wiki chain station is allowed (chain membership beats town status).
$ftRoutes2 = $ftRoutes;
$ftRoutes2['Punin|Ragath'] = ['found' => true, 'reason' => '', 'segments' => [['public_id' => 's1', 'name' => 'Teststraße'], ['public_id' => 's2', 'name' => 'Teststraße']], 'via' => ['Kuslik']];
$ftRouter2 = static fn(string $f, string $t): array => $ftRoutes2[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($ftStaging, $ftAssignments, $ftLookup, $ftRouter2, $ftTowns);
check('chain-listed via town allowed', $case['flags']['unroutable_hops'], []);
check('chain-listed via keeps hops routable', count($case['adds']) >= 1, true);

// BC: omitting the town lookup keeps the old behaviour (no foreign_town flags at all).
$case = avesmapsWikiPathVerlaufComputeCase($ftStaging, $ftAssignments, $ftLookup, $ftRouter);
check('no town lookup => guard off', $case['flags']['unroutable_hops'], []);

// Geometry proximity: the hop does NOT touch the town's node, but a segment passes within
// the town radius (Alfenmohn case: town sits on a spur beside the through-line).
$ftRoutes3 = [
    'Punin|Ragath' => ['found' => true, 'reason' => '', 'segments' => [
        ['public_id' => 's1', 'name' => 'Teststraße', 'geometry' => ['type' => 'LineString', 'coordinates' => [[100, 100], [499.2, 500.8], [200, 200]]]],
    ], 'via' => ['Kreuzung-9']],
    'Ragath|Kuslik' => ['found' => true, 'reason' => '', 'segments' => [
        ['public_id' => 's3', 'name' => 'Teststraße', 'geometry' => ['type' => 'LineString', 'coordinates' => [[200, 200], [250, 250], [300, 300]]]],
    ], 'via' => []],
];
$ftRouter3 = static fn(string $f, string $t): array => $ftRoutes3[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($ftStaging, $ftAssignments, $ftLookup, $ftRouter3, $ftTowns);
check('geometry passage flags foreign town', $case['flags']['unroutable_hops'][0]['reason'] ?? '', 'foreign_town');
check('geometry passage names the town', $case['flags']['unroutable_hops'][0]['towns'] ?? [], ['Winhall']);
check('geometry passage flags only that hop', count($case['flags']['unroutable_hops']), 1);
// Chain endpoints (Ragath/Kuslik at the segment ends) never count as passage even though
// their coordinates lie on the geometry.
check('second hop stays routable', in_array('s3', array_column($case['adds'], 'public_id'), true), true);

// --- Line tracer: follow the drawn road (minimal bend), not the fastest corridor ---

// Fixture graph in client-graph adjacency shape. Main line A-J-K-B runs straight along y=0;
// at junction J a branch turns 90 degrees to X and continues diagonally to B (fewer edges,
// i.e. a time-Dijkstra shortcut). The tracer must stay on the straight line through K.
// The J-K connection is stored in REVERSED drawing order (from=K) to prove orientation handling.
function traceConn(string $id, string $publicId, string $from, string $to, array $coords, string $type = 'Reichsstrasse', bool $synthetic = false): array {
    return ['id' => $id, 'path_id' => $id, 'public_id' => $publicId, 'from' => $from, 'to' => $to,
        'route_type' => $type, 'geometry' => ['type' => 'LineString', 'coordinates' => $coords], 'synthetic' => $synthetic];
}
$traceGraph = [];
$addBoth = static function (array $conn) use (&$traceGraph): void {
    $traceGraph[$conn['from']][$conn['to']][] = $conn;
    $traceGraph[$conn['to']][$conn['from']][] = $conn;
};
$addBoth(traceConn('e1', 'seg-aj', 'A', 'J', [[0, 0], [10, 0]]));
$addBoth(traceConn('e2', 'seg-jk', 'K', 'J', [[20, 0], [10, 0]]));       // stored reversed
$addBoth(traceConn('e3', 'seg-kb', 'K', 'B', [[20, 0], [30, 0]]));
$addBoth(traceConn('e4', 'seg-jx', 'J', 'X', [[10, 0], [10, 10]], 'Weg'));
$addBoth(traceConn('e5', 'seg-xb', 'X', 'B', [[10, 10], [30, 0]], 'Weg'));

$trace = avesmapsWikiPathVerlaufTraceHop($traceGraph, 'A', 'B');
check('trace found', $trace['found'], true);
check('trace follows the straight line', array_column($trace['segments'], 'public_id'), ['seg-aj', 'seg-jk', 'seg-kb']);
check('trace via lists interior nodes', $trace['via'], ['J', 'K']);
check('trace unreachable', avesmapsWikiPathVerlaufTraceHop($traceGraph, 'A', 'Nirgendwo')['found'], false);

// --- Gap snapping (owner decision 2026-07-06: "ignore the gap"): locations dock onto
// nearby line vertices, hairline path-endpoint rifts get welded - assignment context only ---

$snapNetwork = [
    'locations' => [
        ['name' => 'Elenvina', 'geometry' => ['type' => 'Point', 'coordinates' => [10.0005, 20.0]]],
        ['name' => 'Zinnen', 'geometry' => ['type' => 'Point', 'coordinates' => [30.0, 22.8]]],
        ['name' => 'Fernab', 'geometry' => ['type' => 'Point', 'coordinates' => [50.0, 30.0]]],
    ],
    'paths' => [
        // endpoint misses Elenvina by 0.0005; interior vertex misses Zinnen by 2.8; nothing near Fernab (4.0 off)
        ['name' => 'L1', 'geometry' => ['type' => 'LineString', 'coordinates' => [[10.0, 20.0], [30.0, 20.0], [50.0, 26.0]]]],
        // hairline rift far from any location: L2 start is 0.03 away from L4 start
        ['name' => 'L2', 'geometry' => ['type' => 'LineString', 'coordinates' => [[70.0, 20.03], [60.0, 20.0]]]],
        ['name' => 'L4', 'geometry' => ['type' => 'LineString', 'coordinates' => [[70.0, 20.0], [75.0, 20.0]]]],
        // clearly separate endpoints (0.5 apart, no location nearby) must NOT be welded
        ['name' => 'L3', 'geometry' => ['type' => 'LineString', 'coordinates' => [[80.0, 20.5], [80.0, 10.0]]]],
        ['name' => 'L5', 'geometry' => ['type' => 'LineString', 'coordinates' => [[80.0, 20.0], [85.0, 20.0]]]],
    ],
];
$snapped = avesmapsWikiPathVerlaufSnapNetworkGaps($snapNetwork);
check('snap docks hairline location', $snapped['paths'][0]['geometry']['coordinates'][0], [10.0005, 20.0]);
check('snap docks nearby location onto interior vertex', $snapped['paths'][0]['geometry']['coordinates'][1], [30.0, 22.8]);
check('snap leaves far location alone', $snapped['paths'][0]['geometry']['coordinates'][2], [50.0, 26.0]);
check('snap welds hairline endpoints', $snapped['paths'][1]['geometry']['coordinates'][0] === $snapped['paths'][2]['geometry']['coordinates'][0], true);
check('snap keeps separate endpoints apart', $snapped['paths'][3]['geometry']['coordinates'][0], [80.0, 20.5]);
check('snap does not mutate the input', $snapNetwork['paths'][0]['geometry']['coordinates'][1], [30.0, 20.0]);

// Regression: the production graph builder returns a WRAPPER ['graph' => adjacency,
// 'statistics' => ...]; the tracer must unwrap it (indexing the wrapper made every live
// trace fail instantly and fall back to Dijkstra + foreign-town block).
$wrapped = ['graph' => $traceGraph, 'statistics' => ['nodes' => 5]];
$trace = avesmapsWikiPathVerlaufTraceHop($wrapped, 'A', 'B');
check('trace unwraps builder wrapper', array_column($trace['segments'], 'public_id'), ['seg-aj', 'seg-jk', 'seg-kb']);

// Synthetic edges never participate.
$traceGraph2 = $traceGraph;
$addBoth2 = static function (array $conn) use (&$traceGraph2): void {
    $traceGraph2[$conn['from']][$conn['to']][] = $conn;
    $traceGraph2[$conn['to']][$conn['from']][] = $conn;
};
$addBoth2(traceConn('e6', '', 'A', 'B', [[0, 0], [30, 0]], 'Querfeldein', true));
$trace = avesmapsWikiPathVerlaufTraceHop($traceGraph2, 'A', 'B');
check('trace skips synthetic edges', array_column($trace['segments'], 'public_id'), ['seg-aj', 'seg-jk', 'seg-kb']);

// --- ComputeCase: traced hops downgrade foreign towns to passage info (owner rule: places ON
// the drawn line belong to the road; only the Dijkstra fallback keeps the hard guard) ---

$ftRoutes4 = [
    'Punin|Ragath' => ['found' => true, 'reason' => '', 'method' => 'trace', 'segments' => [
        ['public_id' => 's1', 'name' => 'Teststraße', 'geometry' => ['type' => 'LineString', 'coordinates' => [[100, 100], [499.2, 500.8], [200, 200]]]],
    ], 'via' => ['Winhall']],
    'Ragath|Kuslik' => ['found' => true, 'reason' => '', 'method' => 'trace', 'segments' => [
        ['public_id' => 's3', 'name' => 'Teststraße', 'geometry' => ['type' => 'LineString', 'coordinates' => [[200, 200], [250, 250], [300, 300]]]],
    ], 'via' => []],
];
$ftRouter4 = static fn(string $f, string $t): array => $ftRoutes4[$f . '|' . $t] ?? ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($ftStaging, $ftAssignments, $ftLookup, $ftRouter4, $ftTowns);
check('traced hop has no unroutable flag', $case['flags']['unroutable_hops'], []);
check('traced hop reports passage info', $case['flags']['passage_towns'][0]['towns'] ?? [], ['Winhall']);
// s1 is already assigned in the fixture => it lands in keeps (Soll includes the traced hop).
check('traced hop segments enter the Soll', in_array('s1', array_column($case['keeps'], 'public_id'), true), true);
check('traced hop new segments become adds', in_array('s3', array_column($case['adds'], 'public_id'), true), true);
check('passage info does not block clean', $case['clean'], true);

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
