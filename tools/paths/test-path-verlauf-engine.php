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

// unroutable hop => removes suppressed
$staging6 = $staging;
$router6 = static fn(string $f, string $t): array => $f === 'Punin' && $t === 'Ragath' ? $routes['Punin|Ragath'] : ['found' => false, 'reason' => 'no_route', 'segments' => []];
$case = avesmapsWikiPathVerlaufComputeCase($staging6, $assignments, $lookup, $router6);
check('unroutable flagged', $case['flags']['unroutable_hops'][0]['reason'], 'no_route');
check('removes suppressed on unroutable', $case['removes'], []);

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

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
