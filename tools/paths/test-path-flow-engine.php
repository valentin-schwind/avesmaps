<?php

declare(strict_types=1);

// CLI tests for the pure river-flow engine (Flussrichtung spec §2/§3/§6).
// Run: php tools/paths/test-path-flow-engine.php

require __DIR__ . '/../../api/_internal/wiki/path-flow.php';

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

// --- avesmapsPathFlowNormalize ---
check('normalize: null on non-array', avesmapsPathFlowNormalize(null), null);
check('normalize: null without dir', avesmapsPathFlowNormalize(['factor' => 2.0]), null);
check('normalize: null on bad dir', avesmapsPathFlowNormalize(['dir' => 'up']), null);
check('normalize: defaults', avesmapsPathFlowNormalize(['dir' => 'forward']),
    ['dir' => 'forward', 'factor' => 1.5, 'source' => 'editor']);
check('normalize: clamps high factor', avesmapsPathFlowNormalize(['dir' => 'reverse', 'factor' => 9, 'source' => 'verlauf-sync']),
    ['dir' => 'reverse', 'factor' => 3.0, 'source' => 'verlauf-sync']);
check('normalize: clamps low factor', avesmapsPathFlowNormalize(['dir' => 'forward', 'factor' => 0.5]),
    ['dir' => 'forward', 'factor' => 1.0, 'source' => 'editor']);

// --- avesmapsPathFlowHopOrientations ---
// Hop Havena -> Angbar over three segments; middle one drawn AGAINST travel direction.
$hop = avesmapsPathFlowHopOrientations([
    ['public_id' => 's1', 'from_node' => 'Havena', 'to_node' => 'K1'],
    ['public_id' => 's2', 'from_node' => 'K2', 'to_node' => 'K1'],     // drawn K2->K1, travelled K1->K2
    ['public_id' => 's3', 'from_node' => 'K2', 'to_node' => 'Angbar'],
], 'Havena');
check('hop: ok', $hop['ok'], true);
check('hop: orientations', $hop['occurrences'], [
    ['public_id' => 's1', 'orientation' => 'forward'],
    ['public_id' => 's2', 'orientation' => 'reverse'],
    ['public_id' => 's3', 'orientation' => 'forward'],
]);
$broken = avesmapsPathFlowHopOrientations([
    ['public_id' => 's1', 'from_node' => 'Havena', 'to_node' => 'K1'],
    ['public_id' => 's2', 'from_node' => 'X', 'to_node' => 'Y'],
], 'Havena');
check('hop: broken chain rejected', $broken, ['ok' => false, 'occurrences' => []]);
// Dead-end spur: same segment in and out -> two opposing occurrences.
$spur = avesmapsPathFlowHopOrientations([
    ['public_id' => 'spur', 'from_node' => 'K1', 'to_node' => 'Dorf'],
    ['public_id' => 'spur', 'from_node' => 'K1', 'to_node' => 'Dorf'],
], 'K1');
check('hop: spur in+out recorded', $spur['occurrences'], [
    ['public_id' => 'spur', 'orientation' => 'forward'],
    ['public_id' => 'spur', 'orientation' => 'reverse'],
]);

// --- avesmapsPathFlowCombineOrientations ---
$combined = avesmapsPathFlowCombineOrientations([
    ['public_id' => 'a', 'orientation' => 'forward'],
    ['public_id' => 'a', 'orientation' => 'forward'],
    ['public_id' => 'b', 'orientation' => 'reverse'],
    ['public_id' => 'c', 'orientation' => 'forward'],
    ['public_id' => 'c', 'orientation' => 'reverse'],
    ['public_id' => 'foreign', 'orientation' => 'forward'],
], ['a', 'b', 'c']);
check('combine: dirs', $combined['dir_by_public_id'], ['a' => 'forward', 'b' => 'reverse']);
check('combine: ambiguous', $combined['ambiguous'], ['c']);

// --- avesmapsPathFlowPlanWrites ---
$plan = avesmapsPathFlowPlanWrites(
    ['a' => 'forward', 'b' => 'reverse'],
    [
        'a' => null,                                                       // fresh dir
        'b' => ['dir' => 'forward', 'factor' => 2.0, 'source' => 'editor'], // wiki overrides manual, factor kept
        'c' => ['dir' => 'reverse', 'source' => 'verlauf-sync'],           // undetermined -> dir cleared, empty -> flow removed
        'd' => null,                                                       // undetermined, nothing there -> unchanged
        'e' => ['factor' => 2.5],                                          // factor-only object survives untouched
    ]
);
check('plan: set a', $plan['writes']['a'], ['flow' => ['dir' => 'forward', 'source' => 'verlauf-sync']]);
check('plan: b keeps factor', $plan['writes']['b'], ['flow' => ['dir' => 'reverse', 'factor' => 2.0, 'source' => 'verlauf-sync']]);
check('plan: c cleared to null', $plan['writes']['c'], ['flow' => null]);
check('plan: d/e untouched', isset($plan['writes']['d']) || isset($plan['writes']['e']), false);
check('plan: counters', [$plan['set'], $plan['cleared'], $plan['unchanged']], [2, 1, 2]);

// --- avesmapsPathFlowPlanFlip ---
$flip = avesmapsPathFlowPlanFlip([
    'a' => ['dir' => 'forward', 'factor' => 2.0, 'source' => 'verlauf-sync'],
    'b' => ['dir' => 'reverse', 'source' => 'editor'],
    'c' => null,
    'd' => ['factor' => 1.5],
]);
check('flip: inverts + editor source', $flip['writes']['a'], ['flow' => ['dir' => 'reverse', 'factor' => 2.0, 'source' => 'editor']]);
check('flip: b', $flip['writes']['b'], ['flow' => ['dir' => 'forward', 'source' => 'editor']]);
check('flip: skips undirected', isset($flip['writes']['c']) || isset($flip['writes']['d']), false);
check('flip: count', $flip['flipped'], 2);

// --- avesmapsPathFlowPlanFactor ---
$factorPlan = avesmapsPathFlowPlanFactor([
    'a' => ['dir' => 'forward', 'factor' => 1.5, 'source' => 'editor'],
    'b' => null,
    'c' => ['dir' => 'reverse', 'factor' => 2.0, 'source' => 'verlauf-sync'],
], 2.0);
check('factor: updates a', $factorPlan['writes']['a'], ['flow' => ['dir' => 'forward', 'factor' => 2.0, 'source' => 'editor']]);
check('factor: creates on empty', $factorPlan['writes']['b'], ['flow' => ['factor' => 2.0]]);
check('factor: skips equal', isset($factorPlan['writes']['c']), false);
check('factor: clamp result', avesmapsPathFlowPlanFactor(['a' => null], 9.0)['factor'], 3.0);

// --- avesmapsPathFlowChainOrientation ---
// Three-segment line A--B--C--D, middle segment drawn backwards. Consistent walk expected.
$chain = avesmapsPathFlowChainOrientation([
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[20.0, 0.0], [10.0, 0.0]],   // drawn C->B
    's3' => [[20.0, 0.0], [30.0, 0.0]],
]);
$consistent = ($chain === ['s1' => 'forward', 's2' => 'reverse', 's3' => 'forward'])
    || ($chain === ['s1' => 'reverse', 's2' => 'forward', 's3' => 'reverse']);
check('chain: consistent orientation, either end', $consistent, true);
check('chain: all three oriented', count($chain), 3);
// T-junction: spur off the middle stays undirected; main (longest) chain oriented.
$tee = avesmapsPathFlowChainOrientation([
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[10.0, 0.0], [20.0, 0.0]],
    'spur' => [[10.0, 0.0], [10.0, 3.0]],
]);
check('chain: spur excluded', isset($tee['spur']), false);
check('chain: main chain oriented', count($tee), 2);
// Pure cycle -> nothing.
$cycle = avesmapsPathFlowChainOrientation([
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[10.0, 0.0], [10.0, 10.0]],
    's3' => [[10.0, 10.0], [0.0, 0.0]],
]);
check('chain: cycle yields nothing', $cycle, []);

echo "\n{$total} checks, {$failures} failures\n";
exit($failures === 0 ? 0 : 1);
