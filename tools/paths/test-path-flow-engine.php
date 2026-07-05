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

// --- avesmapsPathFlowPlanSetDir ---
// Baseline first: the diameter walk's end choice is arbitrary, so anchors are pinned
// RELATIVE to the baseline result to keep every check deterministic.
$setDirCoordinates = [
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[20.0, 0.0], [10.0, 0.0]],   // drawn against the line
    's3' => [[20.0, 0.0], [30.0, 0.0]],
    's4' => [[30.0, 0.0], [40.0, 0.0]],
];
$baseline = avesmapsPathFlowChainOrientation($setDirCoordinates);
$invert = static fn(string $dir): string => $dir === 'forward' ? 'reverse' : 'forward';

$noAnchors = avesmapsPathFlowPlanSetDir($setDirCoordinates, []);
check('set_dir plan: no anchors = baseline walk', [$noAnchors['ok'], $noAnchors['reason'], $noAnchors['dir_by_public_id']], [true, null, $baseline]);

$expectedRest = $baseline;
unset($expectedRest['s2']);
$agreeing = avesmapsPathFlowPlanSetDir($setDirCoordinates, ['s2' => $baseline['s2']]);
check('set_dir plan: agreeing anchor keeps walk, anchor excluded', [$agreeing['ok'], $agreeing['dir_by_public_id']], [true, $expectedRest]);

$opposing = avesmapsPathFlowPlanSetDir($setDirCoordinates, ['s2' => $invert($baseline['s2'])]);
check('set_dir plan: opposing anchor inverts the walk', [$opposing['ok'], $opposing['dir_by_public_id']], [true, array_map($invert, $expectedRest)]);

$conflict = avesmapsPathFlowPlanSetDir($setDirCoordinates, ['s1' => $baseline['s1'], 's3' => $invert($baseline['s3'])]);
check('set_dir plan: conflicting anchors rejected', $conflict, ['ok' => false, 'reason' => 'anchors_conflict', 'dir_by_public_id' => []]);

$fullyAnchored = avesmapsPathFlowPlanSetDir($setDirCoordinates, $baseline);
check('set_dir plan: fully anchored chain -> empty plan', [$fullyAnchored['ok'], $fullyAnchored['dir_by_public_id']], [true, []]);

// Anchor only on a spur: arm flow relative to the chain is undecidable -> refuse.
$offChain = avesmapsPathFlowPlanSetDir([
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[10.0, 0.0], [20.0, 0.0]],
    'spur' => [[10.0, 0.0], [10.0, 3.0]],
], ['spur' => 'forward']);
check('set_dir plan: anchor only on spur rejected', $offChain, ['ok' => false, 'reason' => 'no_anchor_on_chain', 'dir_by_public_id' => []]);

$cyclePlan = avesmapsPathFlowPlanSetDir([
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    's2' => [[10.0, 0.0], [10.0, 10.0]],
    's3' => [[10.0, 10.0], [0.0, 0.0]],
], ['s1' => 'forward']);
check('set_dir plan: cycle rejected', $cyclePlan, ['ok' => false, 'reason' => 'no_chain', 'dir_by_public_id' => []]);

// GF shape: long course, two mid-course anchors pinning downstream, junction arm.
$gfCoordinates = [
    'c1' => [[0.0, 0.0], [10.0, 0.0]],
    'c2' => [[10.0, 0.0], [20.0, 0.0]],
    'c3' => [[30.0, 0.0], [20.0, 0.0]],   // drawn against the course
    'c4' => [[30.0, 0.0], [40.0, 0.0]],
    'c5' => [[40.0, 0.0], [50.0, 0.0]],
    'arm' => [[20.0, 0.0], [20.0, 8.0]],
];
$gf = avesmapsPathFlowPlanSetDir($gfCoordinates, ['c2' => 'forward', 'c3' => 'reverse']);
$gfDirs = $gf['dir_by_public_id'];
ksort($gfDirs);
check('set_dir plan: gf rest directed downstream, arm untouched', [$gf['ok'], $gfDirs],
    [true, ['c1' => 'forward', 'c4' => 'forward', 'c5' => 'forward']]);

// --- tolerant endpoint clustering (hand-drawn rivers meet with sub-unit gaps) ---
// Yaquir pattern: consecutive segments whose endpoints do NOT coincide exactly (~0.5-0.9
// map units apart, bridged in routing through shared location nodes). Exact-key matching
// fragmented such ways into mini-chains; endpoint clustering must chain them through.
$gapChain = [
    'g1' => [[0.0, 0.0], [10.0, 0.0]],
    'g2' => [[10.7, 0.3], [20.0, 0.0]],
    'g3' => [[20.4, -0.4], [30.0, 0.0]],
];
$gapOriented = avesmapsPathFlowChainOrientation($gapChain);
check('gap chain: all three oriented', count($gapOriented), 3);
$gapConsistent = ($gapOriented === ['g1' => 'forward', 'g2' => 'forward', 'g3' => 'forward'])
    || ($gapOriented === ['g1' => 'reverse', 'g2' => 'reverse', 'g3' => 'reverse']);
check('gap chain: consistent orientation', $gapConsistent, true);

// A tiny stub whose endpoints fall into ONE node cluster is node-internal: excluded from
// the chain walk, but the chain still passes through the shared node.
$stubChain = [
    's1' => [[0.0, 0.0], [10.0, 0.0]],
    'stub' => [[10.2, 0.1], [10.6, 0.4]],
    's2' => [[10.5, 0.2], [20.0, 0.0]],
];
$stubOriented = avesmapsPathFlowChainOrientation($stubChain);
check('stub: node-internal segment excluded', isset($stubOriented['stub']), false);
check('stub: chain passes through the node', count($stubOriented), 2);

// Vervollstaendigen must work across gaps too (anchor on one side of a gap).
$gapPlan = avesmapsPathFlowPlanSetDir($gapChain, ['g1' => $gapOriented['g1'] ?? 'forward']);
check('set_dir plan: anchor aligns across endpoint gaps', [$gapPlan['ok'], count($gapPlan['dir_by_public_id'])], [true, 2]);

// --- avesmapsPathFlowReconcileChainDirs (derivation consistency) ---
// Hops can disagree (mis-matched stations route a hop backwards); on ONE chain the flow
// must be consistent: majority wins, the conflicting minority is DROPPED (their existing
// dirs get cleared by PlanWrites), off-chain dirs stay untouched.
$reconcileWay = [
    'r1' => [[0.0, 0.0], [10.0, 0.0]],
    'r2' => [[10.6, 0.2], [20.0, 0.0]],
    'r3' => [[20.5, 0.3], [30.0, 0.0]],
    'r4' => [[30.2, -0.2], [40.0, 0.0]],
    'spur' => [[20.0, 0.0], [20.0, 8.0]],
];
$reconciled = avesmapsPathFlowReconcileChainDirs($reconcileWay, [
    'r1' => 'forward', 'r2' => 'forward', 'r3' => 'reverse', 'r4' => 'forward', 'spur' => 'forward',
]);
check('reconcile: minority dropped', $reconciled['dropped'], ['r3']);
check('reconcile: majority + spur kept', array_keys($reconciled['dir_by_public_id']), ['r1', 'r2', 'r4', 'spur']);
check('reconcile: kept dirs unchanged', $reconciled['dir_by_public_id']['r4'], 'forward');

$reconcileTie = avesmapsPathFlowReconcileChainDirs($reconcileWay, [
    'r1' => 'forward', 'r3' => 'reverse', 'spur' => 'forward',
]);
check('reconcile tie: all chain dirs dropped', $reconcileTie['dropped'], ['r1', 'r3']);
check('reconcile tie: spur survives', array_keys($reconcileTie['dir_by_public_id']), ['spur']);

$reconcileClean = avesmapsPathFlowReconcileChainDirs($reconcileWay, ['r1' => 'forward', 'r2' => 'forward']);
check('reconcile: consistent dirs pass through', [$reconcileClean['dropped'], count($reconcileClean['dir_by_public_id'])], [[], 2]);

$reconcileNoChain = avesmapsPathFlowReconcileChainDirs([], ['x' => 'forward']);
check('reconcile: no chain -> unchanged', $reconcileNoChain, ['dir_by_public_id' => ['x' => 'forward'], 'dropped' => []]);

// --- multi-component ways (Cresval pattern: gap wider than the endpoint EPS) ---
// A river drawn as two disconnected pieces must still get ONE consistent flow: every
// component's main chain is oriented, and unanchored components are aligned across a
// virtual bridge (closest terminals; the flow leaves one sink and enters the next source).
$twoComponents = [
    'a1' => [[0.0, 0.0], [10.0, 0.0]],
    'a2' => [[10.0, 0.0], [20.0, 0.0]],
    'b1' => [[23.0, 0.0], [33.0, 0.0]],
    'b2' => [[33.0, 0.0], [43.0, 0.0]],
];
$twoOriented = avesmapsPathFlowChainOrientation($twoComponents);
check('components: all four oriented', count($twoOriented), 4);
$twoConsistent = ($twoOriented === ['a1' => 'forward', 'a2' => 'forward', 'b1' => 'forward', 'b2' => 'forward'])
    || ($twoOriented === ['a1' => 'reverse', 'a2' => 'reverse', 'b1' => 'reverse', 'b2' => 'reverse']);
check('components: serial flow across the gap', $twoConsistent, true);

$componentPlan = avesmapsPathFlowPlanSetDir($twoComponents, ['a1' => 'forward']);
$componentDirs = $componentPlan['dir_by_public_id'];
ksort($componentDirs);
check('components: anchor in one component aligns the other', [$componentPlan['ok'], $componentDirs],
    [true, ['a2' => 'forward', 'b1' => 'forward', 'b2' => 'forward']]);

$componentPlanReverse = avesmapsPathFlowPlanSetDir($twoComponents, ['a1' => 'reverse']);
$componentDirsReverse = $componentPlanReverse['dir_by_public_id'];
ksort($componentDirsReverse);
check('components: reversed anchor propagates across the bridge', [$componentPlanReverse['ok'], $componentDirsReverse],
    [true, ['a2' => 'reverse', 'b1' => 'reverse', 'b2' => 'reverse']]);

// Bridge rule with an opposed drawing direction: a1 flows 0->10 (sink at 10); the second
// piece is drawn 25->13, so continuing the flow (13->25) means dir 'reverse' for it.
$opposedPlan = avesmapsPathFlowPlanSetDir([
    'a1' => [[0.0, 0.0], [10.0, 0.0]],
    'b1' => [[25.0, 0.0], [13.0, 0.0]],
], ['a1' => 'forward']);
check('components: sink-to-source bridge respects drawing direction', [$opposedPlan['ok'], $opposedPlan['dir_by_public_id']],
    [true, ['b1' => 'reverse']]);

echo "\n{$total} checks, {$failures} failures\n";
exit($failures === 0 ? 0 : 1);
