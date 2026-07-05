# Flussrichtung & asymmetrisches Fluss-Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rivers with a known flow direction cost `time × factor` (default 1.5) when travelled upstream, in BOTH routing engines, with editor arrows + a way-wide edit panel, and automatic direction derivation from the wiki `verlauf`.

**Architecture:** Per-segment `properties.flow = {dir, factor, source}` in `map_features.properties_json` (`dir` relative to drawn coordinate order — spec §2, approach A). A pure PHP engine (`api/_internal/wiki/path-flow.php`) derives `dir` by chain-walking the verlauf-sync hop router's segments; three new POST actions (`derive_flow`, `derive_flow_all`, `set_flow`) on `api/edit/wiki/paths.php`; both route graphs insert TWO directional edge variants (upstream time ×factor) instead of today's single shared connection object; a new edit-mode-only canvas overlay draws arrows; the path detail panel gets a "Strömung" section.

**Tech Stack:** PHP 8 (strict types, PDO), vanilla JS (no build), Leaflet 1.9.4 canvas overlays, CLI tests via plain `php` + `node`.

**Spec:** `docs/superpowers/specs/2026-07-05-flussrichtung-design.md` (owner-approved, commit 1a4698c1).

## Global Constraints

- `flow` schema exactly: `{"dir": "forward"|"reverse", "factor": <float>, "source": "verlauf-sync"|"editor"}`; missing `flow`/`dir` ⇒ symmetric (spec §2).
- Factor clamp **[1.0, 3.0]**, default **1.5**; derivation NEVER writes/changes `factor` (owner-owned).
- `dir` is relative to the segment's **drawn coordinate order** (`forward` = flows in coordinate order).
- Writes touch ONLY `properties_json` + `revision` — never geometry, `name` column, `public_id`, `feature_subtype`.
- Malus applies ONLY to time (`fastest` + displayed hours) on `Flussweg` edges; `shortest` distances, Seeweg, land, Querfeldein unchanged.
- **Regression duty:** paths without `flow` produce EXACTLY today's costs in both engines.
- Direction edits are **way-wide only** (no single-segment flip). Way identity = `avesmapsWikiPathRowMatchesWay` (name match-key ∪ wiki_key), restricted to `Flussweg`.
- Derivation qualification is independent of `wiki_path.source` (owner-curated rivers like Großer Fluss qualify); derivation overwrites manual `dir` (wiki wins, requirement 4).
- UI strings German (inline, like `review-path-wiki.js`); code comments/commits/API error messages English; conventional-commit prefixes; commits direct to `master`.
- STRATO: batch actions timeboxed (cursor pattern); never loop heavy endpoints in probes.
- New endpoint actions gated `dry_run:false` + `confirm:"apply"`, capability `review`, all writes audited (undo-able), cache invalidation via `avesmapsWikiSyncNextMapRevision`.
- Editor UI files here are **statically loaded from index.html** (auto-stamped on deploy) — NO `ASSET_VERSION` bump needed (verified: path detail panel + `js/review/*` + `js/map-features/*` are static; `ASSET_VERSION` governs only the political-territory editor).
- `map` is created LAST in bootstrap.js — never call `map.on(...)` top-level in map-features files; use the retry-poll pattern.

## Verified anchors (do not re-derive)

- Server edges: `avesmapsAddClientCompatiblePathSliceConnection` ([client-graph.php:134](api/_internal/routing/client-graph.php:134)) pushes the SAME connection array into both directions; `from` = node at the EARLIER coordinate index ⇒ the from→to edge travels in drawn order. Slices are cut in stored order ([client-graph.php:124-131](api/_internal/routing/client-graph.php:124)).
- Dijkstra weight: `$connection['time']` for fastest ([client-graph.php:390](api/_internal/routing/client-graph.php:390)); route segments = raw connection objects ([client-graph.php:407-427](api/_internal/routing/client-graph.php:407)); diagnostic segments expose `from_node`/`to_node` = STORED orientation, `cost_units` = time ([client-graph.php:430-454](api/_internal/routing/client-graph.php:430)).
- `avesmapsBuildRoutePathData` ([network-data.php:144](api/_internal/routing/network-data.php:144)) passes only the NESTED `properties.properties` through — top-level `flow` must be added explicitly.
- Verlauf hop router ([path-verlauf.php:705-757](api/_internal/wiki/path-verlauf.php:705)): `$router('fluss')` → `fn($from,$to): ['found','reason','segments']` where segments are full diagnostic segments (with `from_node`/`to_node`/`public_id`/`synthetic`). Hop entry node = the from-station's canonical name.
- Compute-case safety filters to copy: unroutable / synthetic / `count > AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS` ([path-verlauf.php:396-425](api/_internal/wiki/path-verlauf.php:396)). Station→location lookup: `$locationLookup[avesmapsWikiPathVerlaufLower($station)]`.
- Apply hook target: `avesmapsWikiPathVerlaufApplyCaseWithContext` ([path-verlauf.php:1061](api/_internal/wiki/path-verlauf.php:1061)), after restamp (line ~1151); called from `avesmapsWikiPathVerlaufApplyCase` (line 1043) and the bulk loop (grep second call site).
- Write/audit pattern: `avesmapsWikiSyncFetchAuditRow` + `UPDATE map_features SET properties_json=:pj, revision=:rev WHERE id=:id` + `avesmapsWikiSyncAuditFeaturePropsChange` ([paths.php:826-834](api/_internal/wiki/paths.php:826)); ONE `avesmapsWikiSyncNextMapRevision` per batch.
- Endpoint dispatch + gate + invalidation list: [api/edit/wiki/paths.php:46-140](api/edit/wiki/paths.php:46).
- Client edges: `addRegularPathToGraph` ([route-graph-routing.js:87-111](js/routing/route-graph-routing.js:87)) — same shared connection both directions; client does NOT split at interior vertices; `properties.flow` is available (map-features.php passes full properties_json through, verified).
- Client display segments = FULL `pathData` features (`getRouteSegments`, [route-engine.js:1-9](js/routing/route-engine.js:1)); plan display RECOMPUTES time from geometry ([route-plan.js:266-278](js/routing/route-plan.js:266)) — factor must be applied there too; traversal direction via `buildOrientedRouteSegmentEndpoints` ([route-node.js:70](js/routing/route-node.js:70)): `orientation.start` IS `coordinates[0]` (same array ref) when traversed in drawn order.
- Panel: `#path-edit-overlay` markup at [index.html:744-798](index.html:744); handlers/helpers in [js/review/review-path-wiki.js](js/review/review-path-wiki.js) (`pathWikiPost`, `pathWikiCurrentFeaturePublicId`, `applyWikiPathSegmentsUpdate`, `renderPathWikiReference`).
- CLI test harness pattern: `tools/paths/test-path-verlauf-engine.php` (`check()` + `require` of ONE lib, no DB). Node pattern for browser JS: `tools/paths/test-way-labels.mjs` (`extractFunction` + eval).
- Fixture shapes for routing tests: `avesmapsBuildClientCompatibleRouteGraph($networkData, $request)` needs `networkData['locations']` (each with `name` + `geometry.coordinates` `[x,y]`) and `networkData['paths']` (path-data arrays as built by `avesmapsBuildRoutePathData`); endpoint match tolerance 0.5.

---

### Task 1: Pure flow engine (`path-flow.php`) + CLI tests

**Files:**
- Create: `api/_internal/wiki/path-flow.php`
- Test: `tools/paths/test-path-flow-engine.php`

**Interfaces:**
- Consumes: nothing (pure; DB parts come in Tasks 2–4 in the same file).
- Produces (later tasks call these EXACT signatures):
  - `avesmapsPathFlowClampFactor(float $factor): float`
  - `avesmapsPathFlowNormalize(mixed $flow): ?array` — `['dir','factor','source']` or null
  - `avesmapsPathFlowHopOrientations(array $segments, string $startNode): array` — `['ok'=>bool,'occurrences'=>[['public_id','orientation'],...]]`
  - `avesmapsPathFlowCombineOrientations(array $occurrences, array $wayPublicIds): array` — `['dir_by_public_id'=>[pid=>dir],'ambiguous'=>[pid,...]]`
  - `avesmapsPathFlowPlanWrites(array $dirByPublicId, array $currentFlowByPublicId): array` — `['writes'=>[pid=>['flow'=>array|null]],'set','cleared','unchanged']`
  - `avesmapsPathFlowPlanFlip(array $currentFlowByPublicId): array` — `['writes'=>...,'flipped'=>int]`
  - `avesmapsPathFlowPlanFactor(array $currentFlowByPublicId, float $factor): array` — `['writes'=>...,'updated'=>int,'factor'=>float]`
  - `avesmapsPathFlowChainOrientation(array $coordinatesByPublicId): array` — `[pid=>'forward'|'reverse']` (main chain only)

- [ ] **Step 1: Write the failing test**

Create `tools/paths/test-path-flow-engine.php` (harness pattern from `test-path-verlauf-engine.php`):

```php
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php tools/paths/test-path-flow-engine.php`
Expected: FAIL — `require` errors (file missing).

- [ ] **Step 3: Write the implementation**

Create `api/_internal/wiki/path-flow.php`:

```php
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php tools/paths/test-path-flow-engine.php`
Expected: all `ok`, exit 0. Also run `php -l api/_internal/wiki/path-flow.php` (no syntax errors) and `php tools/paths/test-path-verlauf-engine.php` (still green, 51 checks).

- [ ] **Step 5: Commit**

```bash
git add api/_internal/wiki/path-flow.php tools/paths/test-path-flow-engine.php
git commit -m "feat(flow): pure river-flow engine (normalize, hop orientation, write plans, chain walk)"
```

---

### Task 2: `derive_flow` — direction from the wiki course, one way

**Files:**
- Modify: `api/_internal/wiki/path-flow.php` (append DB functions)
- Modify: `api/edit/wiki/paths.php` (require + action + invalidation list)

**Interfaces:**
- Consumes: Task 1 pure functions; `avesmapsWikiPathVerlaufBuildRoutingContext(array $config)`, `avesmapsWikiPathVerlaufStations(string)`, `avesmapsWikiPathVerlaufLower(string)`, `AVESMAPS_WIKI_PATH_VERLAUF_MAX_HOP_SEGMENTS`, `AVESMAPS_WIKI_PATH_STAGING_TABLE` (path-verlauf.php / paths.php); `avesmapsWikiSyncDecodeJson/EncodeJson`, `avesmapsWikiSyncNextMapRevision`, `avesmapsWikiSyncFetchAuditRow`, `avesmapsWikiSyncAuditFeaturePropsChange`.
- Produces:
  - `avesmapsWikiPathFlowReadWaySegments(PDO $pdo, string $wikiKey): array` — `pid => ['id'=>int,'name'=>string,'flow'=>array|null]`
  - `avesmapsWikiPathFlowApplyWrites(PDO $pdo, array $writes, array $waySegments, int $userId): array` — segments_updated list
  - `avesmapsWikiPathFlowDeriveForWay(PDO $pdo, array $config, string $wikiKey, bool $dryRun, int $userId, ?array $routingContext = null): array`
  - POST action `derive_flow {wiki_key, dry_run, confirm}`

- [ ] **Step 1: Append the DB functions to `api/_internal/wiki/path-flow.php`**

```php
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
        "SELECT id, public_id, name, properties_json FROM map_features
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
        $segments[(string) $row['public_id']] = [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'flow' => is_array($props['flow'] ?? null) ? $props['flow'] : null,
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
        'ambiguous' => [], 'hops_routable' => 0, 'hops_skipped' => 0, 'segments_updated' => [],
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
    $currentFlowByPublicId = array_map(static fn(array $segment) => $segment['flow'], $waySegments);
    $plan = avesmapsPathFlowPlanWrites($combined['dir_by_public_id'], $currentFlowByPublicId);

    $segmentsUpdated = [];
    if (!$dryRun && $plan['writes'] !== []) {
        $segmentsUpdated = avesmapsWikiPathFlowApplyWrites($pdo, $plan['writes'], $waySegments, $userId);
    }
    return array_merge($base, [
        'directed' => $plan['set'], 'cleared' => $plan['cleared'], 'unchanged' => $plan['unchanged'],
        'ambiguous' => $combined['ambiguous'],
        'hops_routable' => $hopsRoutable, 'hops_skipped' => $hopsSkipped,
        'segments_updated' => $segmentsUpdated,
    ]);
}
```

- [ ] **Step 2: Register the action in `api/edit/wiki/paths.php`**

Add `require_once __DIR__ . '/../../_internal/wiki/path-flow.php';` after the `path-verlauf.php` require (line 15). In the POST `match ($action)` add (before `default => null,`):

```php
            // Flussrichtung (spec §3 trigger 1): derive flow.dir for one river way from its
            // staging verlauf. Same dry_run+confirm gate as the other map_features writers.
            'derive_flow' => avesmapsWikiPathFlowDeriveForWay(
                $pdo,
                $config,
                (string) ($payload['wiki_key'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0)
            ),
```

Extend the invalidation list (line ~138) to:

```php
        if (in_array($action, ['assign', 'clear_assign', 'assign_all', 'assign_to', 'backfill_verlauf_source', 'apply_verlauf_case', 'apply_verlauf_cases_clean', 'derive_flow', 'derive_flow_all', 'set_flow'], true) && is_array($response) && ($response['dry_run'] ?? true) === false) {
```

(`derive_flow_all`/`set_flow` land in Tasks 3/4 — listing them now is harmless: unknown actions return 400 before the list is consulted.)

- [ ] **Step 3: Verify**

Run: `php -l api/_internal/wiki/path-flow.php` and `php -l api/edit/wiki/paths.php` — both OK. Run `php tools/paths/test-path-flow-engine.php` — still green (the appended DB functions must not break the require-without-DB property; they reference PDO only inside bodies).

- [ ] **Step 4: Commit**

```bash
git add api/_internal/wiki/path-flow.php api/edit/wiki/paths.php
git commit -m "feat(flow): derive_flow action - flow direction from the wiki course for one river"
```

---

### Task 3: `derive_flow_all` (timeboxed) + `apply_verlauf_case` integration

**Files:**
- Modify: `api/_internal/wiki/path-flow.php` (append batch function)
- Modify: `api/_internal/wiki/path-verlauf.php` (apply hook)
- Modify: `api/edit/wiki/paths.php` (action)

**Interfaces:**
- Consumes: `avesmapsWikiPathFlowDeriveForWay` (Task 2), cursor/timebox pattern from `avesmapsWikiPathVerlaufListCases` ([path-verlauf.php:814-906](api/_internal/wiki/path-verlauf.php:814)).
- Produces:
  - `avesmapsWikiPathFlowDeriveAll(PDO $pdo, array $config, bool $dryRun, int $userId, array $options = []): array` — `{ok, dry_run, results, scanned, next_cursor, complete, runtime_seconds}`
  - `avesmapsWikiPathVerlaufApplyCaseWithContext(...)` gains `array $config = [], ?array $routingContext = null` and a `'flow'` key in its response.
  - POST action `derive_flow_all {cursor, limit, step_runtime, dry_run, confirm}`

- [ ] **Step 1: Append the batch function to `path-flow.php`**

```php
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
        if (($result['directed'] ?? 0) > 0 || ($result['cleared'] ?? 0) > 0 || ($result['ok'] ?? false) === false || count($result['ambiguous'] ?? []) > 0) {
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
```

- [ ] **Step 2: Apply hook in `path-verlauf.php`**

Change the signature of `avesmapsWikiPathVerlaufApplyCaseWithContext` (line 1061) to:

```php
function avesmapsWikiPathVerlaufApplyCaseWithContext(PDO $pdo, string $wikiKey, array $case, bool $dryRun, int $userId, array $assignments, array $config = [], ?array $routingContext = null): array {
```

After Step 5 (the `$restamped = ...RestampKeeps(...)` line, ~1151) and BEFORE Step 6, insert:

```php
    // Step 5b (Flussrichtung spec §3 trigger 3): after a river way's course was applied,
    // derive its flow direction from the FRESH assignment. Never fails the apply -- the
    // course writes above are already committed; a derivation problem is reported, not thrown.
    // Dry-run applies return before this point: the flow preview is derive_flow's own dry-run.
    $flowResult = null;
    if ((string) ($case['kind'] ?? '') === 'fluss' && $routingContext !== null) {
        try {
            $flowResult = avesmapsWikiPathFlowDeriveForWay($pdo, $config, $wikiKey, false, $userId, $routingContext);
            foreach (($flowResult['segments_updated'] ?? []) as $segment) {
                $segmentsUpdated[] = $segment;
            }
            unset($flowResult['segments_updated']);
        } catch (Throwable $error) {
            $flowResult = ['ok' => false, 'error' => 'derive_failed'];
        }
    }
```

Add `'flow' => $flowResult,` to the returned array (after `'segments_updated' => $segmentsUpdated,`). Update BOTH call sites (grep `avesmapsWikiPathVerlaufApplyCaseWithContext(`): the single-case wrapper (line 1043) passes `, $config, $routingContext` (it already has both); the bulk loop in `avesmapsWikiPathVerlaufApplyCleanCases` passes its `$config` and its shared routing context variable (read the surrounding code for the exact variable name).

`path-verlauf.php` calls a `path-flow.php` function now — `api/edit/wiki/paths.php` requires both (Task 2), so no new require is needed there; ADD a defensive `require_once __DIR__ . '/path-flow.php';` next to the routing requires INSIDE `avesmapsWikiPathVerlaufBuildRoutingContext`? **No** — keep the pattern: path-verlauf.php has no top-level requires and its test must stay runnable. Instead guard the hook: `if (... && function_exists('avesmapsWikiPathFlowDeriveForWay'))` added to the condition. (The endpoint always has it loaded; the CLI test never passes a routing context, so the hook is skipped there anyway — add the guard regardless.)

- [ ] **Step 3: Register the action in `api/edit/wiki/paths.php`**

```php
            // Flussrichtung (spec §3 trigger 2): timeboxed first-run derivation over all
            // wiki river ways; cursor loop pattern like verlauf_cases.
            'derive_flow_all' => avesmapsWikiPathFlowDeriveAll(
                $pdo,
                $config,
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0),
                [
                    'cursor' => (int) ($payload['cursor'] ?? 0),
                    'limit' => (int) ($payload['limit'] ?? 10),
                    'step_runtime' => (int) ($payload['step_runtime'] ?? 15),
                ]
            ),
```

- [ ] **Step 4: Verify**

`php -l` on all three touched files; `php tools/paths/test-path-flow-engine.php` and `php tools/paths/test-path-verlauf-engine.php` green (the signature change has defaults — existing test calls stay valid; if the verlauf test calls ApplyCaseWithContext directly, its calls still match).

- [ ] **Step 5: Commit**

```bash
git add api/_internal/wiki/path-flow.php api/_internal/wiki/path-verlauf.php api/edit/wiki/paths.php
git commit -m "feat(flow): derive_flow_all batch + flow derivation after apply_verlauf_case"
```

---

### Task 4: `set_flow` — way-wide flip / festlegen / factor

**Files:**
- Modify: `api/_internal/wiki/path-flow.php` (append)
- Modify: `api/edit/wiki/paths.php` (action)

**Interfaces:**
- Consumes: Task 1 plans + chain walk; `avesmapsWikiPathRowMatchesWay(string,?string,string,string)` (paths.php:773), `avesmapsWikiSyncCreateMatchKey`, `avesmapsWikiPathFlowApplyWrites` (Task 2).
- Produces:
  - `avesmapsWikiPathSetFlow(PDO $pdo, string $publicId, array $options, bool $dryRun, int $userId): array`
  - POST action `set_flow {public_id, flip?:bool, set_dir?:bool, factor?:number, dry_run, confirm}`
  - Response: `{ok, dry_run, public_id, name, segments, directed_before, flipped, directed, factor_updated, factor?, writes, segments_updated}`

- [ ] **Step 1: Append to `path-flow.php`**

```php
// POST set_flow (spec §6): way-wide flow edits from the path detail panel.
//   {public_id, flip:true}     invert dir on every directed segment of the way
//   {public_id, set_dir:true}  "Richtung festlegen": orient the undirected way's main chain
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
        $chain = avesmapsPathFlowChainOrientation($coordinatesByPublicId);
        if ($chain === []) {
            throw new RuntimeException('No unambiguous segment chain found.');
        }
        foreach ($chain as $pid => $dir) {
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
```

- [ ] **Step 2: Register the action**

```php
            // Flussrichtung (spec §6): way-wide flip / festlegen / Stroemungsfaktor from the
            // path detail panel.
            'set_flow' => avesmapsWikiPathSetFlow(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                [
                    'flip' => ($payload['flip'] ?? false) === true,
                    'set_dir' => ($payload['set_dir'] ?? false) === true,
                    'factor' => $payload['factor'] ?? null,
                ],
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0)
            ),
```

- [ ] **Step 3: Verify + Commit**

`php -l` both files; both CLI test suites green.

```bash
git add api/_internal/wiki/path-flow.php api/edit/wiki/paths.php
git commit -m "feat(flow): set_flow action - way-wide flip, geometric festlegen, Stroemungsfaktor"
```

---

### Task 5: Server routing — asymmetric river edges

**Files:**
- Modify: `api/_internal/routing/network-data.php:144-157` (`avesmapsBuildRoutePathData`)
- Modify: `api/_internal/routing/client-graph.php:134-153` (slice connection) + `:430` (diagnostic segments)
- Test: `tools/routing/test-client-graph-flow.php` (new dir `tools/routing/`)

**Interfaces:**
- Consumes: path-data arrays now carry top-level `'flow' => array|null`.
- Produces: `avesmapsRouteClientNormalizeFlow(array $path, string $routeType): ?array` (self-contained — routing must NOT require the wiki lib); connections may carry `'flow_time_factor' => float`; diagnostic segments expose `flow_time_factor`.

- [ ] **Step 1: Write the failing test**

Create `tools/routing/test-client-graph-flow.php`:

```php
<?php

declare(strict_types=1);

// CLI regression test for asymmetric river-flow edges in the server route graph
// (Flussrichtung spec §4). Pure fixtures, no DB. Run: php tools/routing/test-client-graph-flow.php

require __DIR__ . '/../../api/_internal/routing/request.php';
require __DIR__ . '/../../api/_internal/routing/network-data.php';
require __DIR__ . '/../../api/_internal/routing/client-graph.php';

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

function makeLocation(string $name, float $x, float $y): array {
    return [
        'id' => $name, 'public_id' => $name, 'name' => $name, 'subtype' => 'stadt',
        'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]], 'properties' => [],
    ];
}

function makePath(string $publicId, string $subtype, array $coordinates, ?array $flow): array {
    return [
        'id' => $publicId, 'public_id' => $publicId, 'client_path_id' => $publicId,
        'name' => $subtype, 'subtype' => $subtype,
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'properties' => [], 'flow' => $flow,
    ];
}

function riverRequest(): array {
    return avesmapsNormalizeRouteRequest([
        'from' => 'test', 'to' => 'test',
        'enabled_transports' => ['land' => false, 'river' => true, 'sea' => false],
    ]);
}

function routeCost(array $paths, string $from, string $to, array $request): float {
    $networkData = ['locations' => [makeLocation('A', 0.0, 0.0), makeLocation('B', 10.0, 0.0)], 'paths' => $paths];
    $graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
    $result = avesmapsFindClientCompatibleRoute($graph, $from, $to, $request);
    if (empty($result['found'])) {
        return -1.0;
    }
    return (float) $result['cost'];
}

$request = riverRequest();
$line = [[0.0, 0.0], [10.0, 0.0]];

// Regression: river WITHOUT flow -> identical cost both directions.
$noFlowAB = routeCost([makePath('r1', 'Flussweg', $line, null)], 'A', 'B', $request);
$noFlowBA = routeCost([makePath('r1', 'Flussweg', $line, null)], 'B', 'A', $request);
check('no flow: found', $noFlowAB > 0, true);
check('no flow: symmetric', round($noFlowBA / $noFlowAB, 9), 1.0);

// dir=forward (flows A->B): downstream A->B unchanged, upstream B->A x1.5 (default factor).
$flowForward = ['dir' => 'forward', 'factor' => 1.5, 'source' => 'verlauf-sync'];
$downAB = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'A', 'B', $request);
$upBA = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'B', 'A', $request);
check('forward: downstream unchanged', round($downAB / $noFlowAB, 9), 1.0);
check('forward: upstream x1.5', round($upBA / $noFlowAB, 6), 1.5);

// dir=reverse (flows B->A): mirrored.
$flowReverse = ['dir' => 'reverse', 'factor' => 2.0, 'source' => 'editor'];
$upAB = routeCost([makePath('r1', 'Flussweg', $line, $flowReverse)], 'A', 'B', $request);
$downBA = routeCost([makePath('r1', 'Flussweg', $line, $flowReverse)], 'B', 'A', $request);
check('reverse: upstream x2.0', round($upAB / $noFlowAB, 6), 2.0);
check('reverse: downstream unchanged', round($downBA / $noFlowAB, 9), 1.0);

// Missing factor -> default 1.5; oversized factor -> clamped to 3.0.
$upDefault = routeCost([makePath('r1', 'Flussweg', $line, ['dir' => 'forward'])], 'B', 'A', $request);
check('default factor 1.5', round($upDefault / $noFlowAB, 6), 1.5);
$upClamped = routeCost([makePath('r1', 'Flussweg', $line, ['dir' => 'forward', 'factor' => 9])], 'B', 'A', $request);
check('factor clamped to 3.0', round($upClamped / $noFlowAB, 6), 3.0);

// shortest: distance stays symmetric even with flow.
$shortestRequest = avesmapsNormalizeRouteRequest([
    'from' => 'test', 'to' => 'test', 'optimize' => 'shortest',
    'enabled_transports' => ['land' => false, 'river' => true, 'sea' => false],
]);
$shortAB = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'A', 'B', $shortestRequest);
$shortBA = routeCost([makePath('r1', 'Flussweg', $line, $flowForward)], 'B', 'A', $shortestRequest);
check('shortest: symmetric despite flow', round($shortBA / $shortAB, 9), 1.0);

// Seeweg: flow object is IGNORED on non-river subtypes.
$seaRequest = avesmapsNormalizeRouteRequest([
    'from' => 'test', 'to' => 'test',
    'enabled_transports' => ['land' => false, 'river' => false, 'sea' => true],
]);
$seaAB = routeCost([makePath('s1', 'Seeweg', $line, $flowForward)], 'A', 'B', $seaRequest);
$seaBA = routeCost([makePath('s1', 'Seeweg', $line, $flowForward)], 'B', 'A', $seaRequest);
check('seaweg: flow ignored', round($seaBA / $seaAB, 9), 1.0);

// avesmapsBuildRoutePathData extracts top-level properties.flow.
$pathData = avesmapsBuildRoutePathData([
    'id' => 'f1',
    'geometry' => ['type' => 'LineString', 'coordinates' => $line],
    'properties' => ['public_id' => 'f1', 'feature_subtype' => 'Flussweg', 'flow' => $flowForward],
], 'path-1');
check('path data carries flow', $pathData['flow'], $flowForward);

// Diagnostic segments expose the applied factor.
$networkData = ['locations' => [makeLocation('A', 0.0, 0.0), makeLocation('B', 10.0, 0.0)], 'paths' => [makePath('r1', 'Flussweg', $line, $flowForward)]];
$graph = avesmapsBuildClientCompatibleRouteGraph($networkData, $request);
$route = avesmapsFindClientCompatibleRoute($graph, 'B', 'A', $request);
$diag = avesmapsBuildClientRouteDiagnosticSegments($route['segments']);
check('diagnostic flow_time_factor', round((float) ($diag[0]['flow_time_factor'] ?? 0.0), 6), 1.5);

echo "\n{$total} checks, {$failures} failures\n";
exit($failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php tools/routing/test-client-graph-flow.php`
Expected: FAIL on the flow-related checks (`forward: upstream x1.5` etc.); the two regression checks (`no flow: symmetric`, `seaweg`) should already pass.

- [ ] **Step 3: Implement**

**network-data.php** — in `avesmapsBuildRoutePathData` (line 148-156) add one line to the returned array:

```php
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
		// Flussrichtung spec §2: top-level properties.flow, needed by the graph builder.
		'flow' => is_array($properties['flow'] ?? null) ? $properties['flow'] : null,
```

**client-graph.php** — add above `avesmapsAddClientCompatiblePathSliceConnection`:

```php
// Normalized river-flow object for a route path (properties.flow, Flussrichtung spec §2/§4).
// Null unless the path is a Flussweg with a valid dir; factor clamped to [1.0, 3.0], default
// 1.5. Self-contained mirror of the wiki lib's avesmapsPathFlowNormalize (routing must not
// depend on the wiki lib) and of js/routing/route-graph-routing.js getRiverFlowTimeFactors.
function avesmapsRouteClientNormalizeFlow(array $path, string $routeType): ?array {
    if ($routeType !== 'Flussweg') {
        return null;
    }
    $flow = $path['flow'] ?? null;
    if (!is_array($flow)) {
        return null;
    }
    $dir = (string) ($flow['dir'] ?? '');
    if ($dir !== 'forward' && $dir !== 'reverse') {
        return null;
    }
    $factor = is_numeric($flow['factor'] ?? null) ? (float) $flow['factor'] : 1.5;
    $factor = max(1.0, min(3.0, $factor));
    return ['dir' => $dir, 'factor' => $factor];
}
```

Replace the body end of `avesmapsAddClientCompatiblePathSliceConnection` (lines 134-153) so the connection insertion becomes:

```php
function avesmapsAddClientCompatiblePathSliceConnection(array &$graph, array $fromNode, array $toNode, array $coordinates, string $routeType, string $transportOption, float $speed, string $connectionId, array $path): void {
    $distance = avesmapsCalculateClientRouteCoordinateDistance($coordinates);
    $connection = [
        'distance' => $distance,
        'time' => $distance / $speed,
        'route_type' => $routeType,
        'transport_option' => $transportOption,
        'id' => $connectionId,
        'path_id' => $connectionId,
        'feature_id' => (string) ($path['id'] ?? ''),
        'public_id' => (string) ($path['public_id'] ?? ''),
        'from' => (string) $fromNode['name'],
        'to' => (string) $toNode['name'],
        'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
        'synthetic' => false,
    ];

    $flow = avesmapsRouteClientNormalizeFlow($path, $routeType);
    if ($flow === null) {
        // No known flow direction: symmetric, EXACTLY today's behaviour (shared object).
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $connection);
        avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $connection);
        return;
    }

    // Asymmetric river edge (spec §4): slice coordinates are in stored drawing order and
    // from/to follow that order, so the from->to edge travels WITH dir 'forward' and AGAINST
    // dir 'reverse'. Upstream legs cost time * factor; downstream stays the exact base time.
    // from/to fields stay the STORED orientation on both variants -- the verlauf flow
    // derivation's chain walk depends on that.
    $upstreamTime = $connection['time'] * $flow['factor'];
    $forwardConnection = $connection;
    $forwardConnection['time'] = $flow['dir'] === 'reverse' ? $upstreamTime : $connection['time'];
    $forwardConnection['flow_time_factor'] = $flow['dir'] === 'reverse' ? $flow['factor'] : 1.0;
    $reverseConnection = $connection;
    $reverseConnection['time'] = $flow['dir'] === 'forward' ? $upstreamTime : $connection['time'];
    $reverseConnection['flow_time_factor'] = $flow['dir'] === 'forward' ? $flow['factor'] : 1.0;

    avesmapsAddClientCompatibleGraphConnection($graph, $connection['from'], $connection['to'], $forwardConnection);
    avesmapsAddClientCompatibleGraphConnection($graph, $connection['to'], $connection['from'], $reverseConnection);
}
```

**Diagnostic segments** (line ~451, inside the returned array of `avesmapsBuildClientRouteDiagnosticSegments`) add:

```php
            'flow_time_factor' => (float) ($segment['flow_time_factor'] ?? 1.0),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php tools/routing/test-client-graph-flow.php` — all green. Also `php -l` on both modified files and `php tools/paths/test-path-verlauf-engine.php` (the verlauf engine routes over this graph builder — must stay green).

- [ ] **Step 5: Commit**

```bash
git add api/_internal/routing/network-data.php api/_internal/routing/client-graph.php tools/routing/test-client-graph-flow.php
git commit -m "feat(routing): asymmetric river time costs in the server route graph"
```

---

### Task 6: Client routing + planner display

**Files:**
- Modify: `js/routing/route-graph-routing.js:87-111` (`addRegularPathToGraph`)
- Modify: `js/routing/route-node.js` (append `getRouteSegmentUpstreamFactor`)
- Modify: `js/routing/route-plan.js:266-280` (apply factor in `buildRoutePlanEntries`)
- Test: `tools/routing/test-client-route-flow.mjs`

**Interfaces:**
- Consumes: `properties.flow` on `pathData` features (arrives automatically via map-features.php, verified).
- Produces: `getRiverFlowTimeFactors(properties, routeType): {forwardFactor, backwardFactor} | null` (route-graph-routing.js); `getRouteSegmentUpstreamFactor(segment, orientation, type): number` (route-node.js).

- [ ] **Step 1: Write the failing test**

Create `tools/routing/test-client-route-flow.mjs` (extractFunction pattern from `tools/paths/test-way-labels.mjs`):

```javascript
// Unit test (Node, no build) for the client river-flow helpers (Flussrichtung spec §4):
//   - getRiverFlowTimeFactors (js/routing/route-graph-routing.js): per-direction time
//     factors for the graph edges (forward = stored drawing order).
//   - getRouteSegmentUpstreamFactor (js/routing/route-node.js): upstream factor for the
//     plan display recomputation (traversal from buildOrientedRouteSegmentEndpoints).
// Run: node tools/routing/test-client-route-flow.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function extractFunction(source, name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

const graphSource = readFileSync(path.join(repoRoot, "js", "routing", "route-graph-routing.js"), "utf8");
const nodeSource = readFileSync(path.join(repoRoot, "js", "routing", "route-node.js"), "utf8");
const getRiverFlowTimeFactors = new Function(`${extractFunction(graphSource, "getRiverFlowTimeFactors")}; return getRiverFlowTimeFactors;`)();
const getRouteSegmentUpstreamFactor = new Function(`${extractFunction(nodeSource, "getRouteSegmentUpstreamFactor")}; return getRouteSegmentUpstreamFactor;`)();

// --- getRiverFlowTimeFactors ---
assert.equal(getRiverFlowTimeFactors({ flow: { dir: "forward" } }, "Weg"), null, "non-river ignored");
assert.equal(getRiverFlowTimeFactors({}, "Flussweg"), null, "missing flow ignored");
assert.equal(getRiverFlowTimeFactors({ flow: { factor: 2 } }, "Flussweg"), null, "missing dir ignored");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "forward" } }, "Flussweg"),
	{ forwardFactor: 1, backwardFactor: 1.5 }, "forward default");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "reverse", factor: 2 } }, "Flussweg"),
	{ forwardFactor: 2, backwardFactor: 1 }, "reverse custom factor");
assert.deepEqual(getRiverFlowTimeFactors({ flow: { dir: "forward", factor: 9 } }, "Flussweg"),
	{ forwardFactor: 1, backwardFactor: 3 }, "factor clamped");

// --- getRouteSegmentUpstreamFactor ---
const coords = [[0, 0], [10, 0]];
const riverSegment = (flow) => ({ properties: { flow }, geometry: { coordinates: coords } });
const forwardTraversal = { start: coords[0], end: coords[1] };
const reverseTraversal = { start: coords[1], end: coords[0] };
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), forwardTraversal, "Flussweg"), 1, "downstream forward");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), reverseTraversal, "Flussweg"), 1.5, "upstream default");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "reverse", factor: 2 }), forwardTraversal, "Flussweg"), 2, "upstream reverse-dir");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "reverse" }), reverseTraversal, "Flussweg"), 1, "downstream reverse-dir");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward", factor: 9 }), reverseTraversal, "Flussweg"), 3, "clamped");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), null, "Flussweg"), 1, "no orientation -> neutral");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment({ dir: "forward" }), reverseTraversal, "Seeweg"), 1, "non-river neutral");
assert.equal(getRouteSegmentUpstreamFactor(riverSegment(undefined), reverseTraversal, "Flussweg"), 1, "no flow neutral");

console.log("test-client-route-flow: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/routing/test-client-route-flow.mjs`
Expected: FAIL — `function getRiverFlowTimeFactors not found in source`.

- [ ] **Step 3: Implement**

**route-graph-routing.js** — add above `addRegularPathToGraph`:

```javascript
// Normalized river-flow time factors for a path feature (properties.flow, spec §2/§4).
// Null unless routeType is Flussweg and flow.dir is valid. forwardFactor applies to the
// start->end edge (stored drawing order), backwardFactor to end->start; the upstream
// direction costs time * factor, downstream keeps the plain time. Mirrors the server's
// avesmapsRouteClientNormalizeFlow (api/_internal/routing/client-graph.php).
function getRiverFlowTimeFactors(properties, routeType) {
    if (routeType !== "Flussweg") {
        return null;
    }
    const flow = properties?.flow;
    const dir = flow?.dir;
    if (dir !== "forward" && dir !== "reverse") {
        return null;
    }
    const rawFactor = Number(flow?.factor);
    const factor = Number.isFinite(rawFactor) ? Math.min(3.0, Math.max(1.0, rawFactor)) : 1.5;
    return {
        forwardFactor: dir === "reverse" ? factor : 1,
        backwardFactor: dir === "forward" ? factor : 1,
    };
}
```

In `addRegularPathToGraph`, replace the last three statements (lines 107-109):

```javascript
        const baseTime = distance / speed;
        const flowFactors = getRiverFlowTimeFactors(properties, routeType);
        if (!flowFactors) {
            // No known flow direction: symmetric shared connection, exactly today's behaviour.
            const connection = { distance, time: baseTime, routeType, id: properties.id, transportOption };
            addGraphConnection(graph, startNode.name, endNode.name, connection);
            addGraphConnection(graph, endNode.name, startNode.name, connection);
            return;
        }
        // Asymmetric river edge (spec §4): the start->end edge follows the stored drawing
        // order; upstream legs cost time * factor, downstream stays the plain time.
        addGraphConnection(graph, startNode.name, endNode.name, {
            distance, time: baseTime * flowFactors.forwardFactor, routeType, id: properties.id,
            transportOption, flowTimeFactor: flowFactors.forwardFactor,
        });
        addGraphConnection(graph, endNode.name, startNode.name, {
            distance, time: baseTime * flowFactors.backwardFactor, routeType, id: properties.id,
            transportOption, flowTimeFactor: flowFactors.backwardFactor,
        });
```

**route-node.js** — append after `buildOrientedRouteSegmentEndpoints`:

```javascript
// Upstream factor for a DISPLAYED route segment (Flussrichtung spec §4): 1 unless the
// segment is a Flussweg with a known flow.dir that the route traverses AGAINST. The graph
// edge already carried the factored time (route CHOICE); the plan recomputes display time
// from geometry, so the same factor must be applied there. Traversal comes from
// buildOrientedRouteSegmentEndpoints: orientation.start equals the first stored coordinate
// when the segment is traversed in drawing order.
function getRouteSegmentUpstreamFactor(segment, orientation, type) {
	if (type !== "Flussweg") {
		return 1;
	}
	const flow = segment?.properties?.flow;
	const dir = flow?.dir;
	if (dir !== "forward" && dir !== "reverse") {
		return 1;
	}
	const coordinates = segment?.geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !orientation || !Array.isArray(orientation.start)) {
		return 1;
	}
	const first = coordinates[0];
	const traversedForward = Array.isArray(first)
		&& Number(orientation.start[0]) === Number(first[0])
		&& Number(orientation.start[1]) === Number(first[1]);
	const upstream = traversedForward ? dir === "reverse" : dir === "forward";
	if (!upstream) {
		return 1;
	}
	const rawFactor = Number(flow.factor);
	return Number.isFinite(rawFactor) ? Math.min(3.0, Math.max(1.0, rawFactor)) : 1.5;
}
```

**route-plan.js** — in `buildRoutePlanEntries`: move the `const orientation = orientedSegmentEndpoints[index];` declaration (currently line 280) UP so it sits directly after the `const segTravelTime = ...` line becomes flow-aware; concretely replace lines 278-280:

```javascript
		const segTravelTime = (segDistance / speedMiles) * TIME_SCALE_FACTOR;
		const isWaterRoute = type === "Flussweg" || type === "Seeweg";
		const orientation = orientedSegmentEndpoints[index];
```

with:

```javascript
		const isWaterRoute = type === "Flussweg" || type === "Seeweg";
		const orientation = orientedSegmentEndpoints[index];
		// Upstream river legs display time * flow.factor (spec §4) -- must match the graph
		// edge cost or the shown hours would contradict the chosen route.
		const segTravelTime = (segDistance / speedMiles) * TIME_SCALE_FACTOR
			* getRouteSegmentUpstreamFactor(segment, orientation, type);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/routing/test-client-route-flow.mjs` — all assertions pass. Run `node --check js/routing/route-graph-routing.js`, `node --check js/routing/route-node.js`, `node --check js/routing/route-plan.js` (syntax). Run `node tools/paths/test-way-labels.mjs` (still green).

- [ ] **Step 5: Verify graph freshness after edits**

Grep where the client graph is (re)built: `Grep "createGraph(" js/`. Confirm the graph is rebuilt per route calculation (or on planner open). If it is cached in a `graphData` global that is NOT rebuilt per calculation, note it in the commit message — set_flow edits then need a page reload to affect client routes (acceptable; server routes are always fresh). Do NOT add invalidation machinery in this task.

- [ ] **Step 6: Commit**

```bash
git add js/routing/route-graph-routing.js js/routing/route-node.js js/routing/route-plan.js tools/routing/test-client-route-flow.mjs
git commit -m "feat(routing): asymmetric river time costs in the client engine + plan display"
```

---

### Task 7: Edit-mode flow arrows (canvas overlay)

**Files:**
- Create: `js/map-features/map-features-river-flow-arrows.js`
- Modify: `index.html` (script tag)

**Interfaces:**
- Consumes: globals `map`, `L`, `IS_EDIT_MODE` (config.js:176), `pathData` (runtime-state.js), `normalizePathSubtype`.
- Produces: `window.avesmapsRedrawRiverFlowArrows()` (called by Task 8 after set_flow writes).

- [ ] **Step 1: Create the overlay file**

`js/map-features/map-features-river-flow-arrows.js`:

```javascript
// Flow-direction arrows on rivers, EDIT MODE ONLY (Flussrichtung spec §5). One canvas pane;
// arrows are placed at a fixed SCREEN spacing along every Flussweg with a valid flow.dir
// (screen spacing = zoom-dependent density for free). Segments without a dir stay arrow-less
// on purpose: editors see immediately where the direction is unknown. `map` is created LAST
// in bootstrap.js -- poll until it exists (same pattern as the label canvas overlay).
(function initRiverFlowArrowOverlay() {
	"use strict";

	const PANE_NAME = "avesmapsRiverFlowArrowPane";
	const ARROW_SPACING_PX = 56;
	const ARROW_MIN_ZOOM = 1;

	function ready() {
		return typeof map !== "undefined" && map && typeof L !== "undefined"
			&& typeof IS_EDIT_MODE !== "undefined" && typeof pathData !== "undefined";
	}

	function start() {
		if (!ready()) {
			window.setTimeout(start, 100);
			return;
		}
		if (!IS_EDIT_MODE) {
			return;
		}

		if (!map.getPane(PANE_NAME)) {
			map.createPane(PANE_NAME);
			const pane = map.getPane(PANE_NAME);
			pane.style.zIndex = 639;
			pane.style.pointerEvents = "none";
		}
		const canvas = document.createElement("canvas");
		canvas.style.position = "absolute";
		canvas.style.top = "0";
		canvas.style.left = "0";
		canvas.style.pointerEvents = "none";
		canvas.style.transformOrigin = "0 0";
		canvas.classList.add("leaflet-zoom-animated");
		map.getPane(PANE_NAME).appendChild(canvas);
		const ctx = canvas.getContext("2d");
		let canvasTopLeftLatLng = null;

		function riverFlowDir(properties) {
			const dir = properties?.flow?.dir;
			return dir === "forward" || dir === "reverse" ? dir : null;
		}

		function drawArrow(x, y, angle, viewWidth, viewHeight) {
			if (x < -20 || y < -20 || x > viewWidth + 20 || y > viewHeight + 20) {
				return;
			}
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(angle);
			ctx.beginPath();
			ctx.moveTo(5, 0);
			ctx.lineTo(-3, -3.5);
			ctx.lineTo(-3, 3.5);
			ctx.closePath();
			ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
			ctx.strokeStyle = "rgba(15, 60, 110, 0.9)";
			ctx.lineWidth = 1;
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}

		function redraw() {
			const size = map.getSize();
			const topLeft = map.containerPointToLayerPoint([0, 0]);
			L.DomUtil.setPosition(canvas, topLeft);
			canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
			const dpr = window.devicePixelRatio || 1;
			const pixelWidth = Math.round(size.x * dpr);
			const pixelHeight = Math.round(size.y * dpr);
			if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
			if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
			if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
			if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			if (!Array.isArray(pathData) || map.getZoom() < ARROW_MIN_ZOOM) {
				return;
			}

			pathData.forEach((path) => {
				if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
					return;
				}
				const dir = riverFlowDir(path.properties);
				if (!dir) {
					return;
				}
				const rawCoordinates = path.geometry?.coordinates;
				if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
					return;
				}
				// Walk in FLOW direction: reverse-drawn rivers are walked back-to-front.
				const coordinates = dir === "forward" ? rawCoordinates : [...rawCoordinates].reverse();
				let carried = 0;
				let previousPoint = map.latLngToContainerPoint(L.latLng(coordinates[0][1], coordinates[0][0]));
				for (let i = 1; i < coordinates.length; i++) {
					const point = map.latLngToContainerPoint(L.latLng(coordinates[i][1], coordinates[i][0]));
					const dx = point.x - previousPoint.x;
					const dy = point.y - previousPoint.y;
					const length = Math.hypot(dx, dy);
					if (length > 0) {
						const angle = Math.atan2(dy, dx);
						let offset = ARROW_SPACING_PX - carried;
						while (offset <= length) {
							const t = offset / length;
							drawArrow(previousPoint.x + dx * t, previousPoint.y + dy * t, angle, size.x, size.y);
							offset += ARROW_SPACING_PX;
						}
						carried = (carried + length) % ARROW_SPACING_PX;
					}
					previousPoint = point;
				}
			});
		}

		map.on("moveend zoomend viewreset resize", () => {
			canvas.style.transition = "";
			redraw();
		});
		map.on("zoomanim", (event) => {
			if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
				return;
			}
			canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
			const scale = map.getZoomScale(event.zoom);
			const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
			L.DomUtil.setTransform(canvas, offset, scale);
		});

		window.avesmapsRedrawRiverFlowArrows = redraw;
		[200, 800, 2000].forEach((delay) => window.setTimeout(redraw, delay));
	}

	start();
})();
```

- [ ] **Step 2: Register in index.html**

Grep index.html for `map-features-path-label-canvas-overlay.js` and add directly AFTER that script tag:

```html
	<script src="js/map-features/map-features-river-flow-arrows.js"></script>
```

- [ ] **Step 3: Verify**

`node --check js/map-features/map-features-river-flow-arrows.js`. Static syntax only — visual verification happens in Task 9 (needs deployed flow data or a local `?edit=1` session with hand-patched properties).

- [ ] **Step 4: Commit**

```bash
git add js/map-features/map-features-river-flow-arrows.js index.html
git commit -m "feat(editor): flow-direction arrows on rivers in edit mode (canvas overlay)"
```

---

### Task 8: Detail panel "Strömung" section

**Files:**
- Modify: `index.html:791` (insert section into `#path-edit-form`)
- Create: `js/review/review-path-flow.js`
- Modify: `js/review/review-path-wiki.js` (`applyWikiPathSegmentsUpdate` learns `flow`)
- Modify: `index.html` (script tag after `review-path-wiki.js`)

**Interfaces:**
- Consumes: `pathWikiPost`, `pathWikiCurrentFeaturePublicId`, `applyWikiPathSegmentsUpdate`, `renderPathWikiReference` (review-path-wiki.js); `pathEditFeature` (review-paths.js); `set_flow` action (Task 4); `window.avesmapsRedrawRiverFlowArrows` (Task 7).
- Produces: `renderPathFlowSection()` — must be called wherever the panel renders (same call sites as `renderPathWikiReference()`).

- [ ] **Step 1: index.html markup**

In line 791, between the wiki section's closing `</div></div>` and `<p id="path-edit-status"`, insert (Edit on the minified line; old_string anchor: `</div></div><p id="path-edit-status"`):

```html
</div></div><div class="label-edit-section" id="path-flow-section" hidden><div class="label-edit-section-title">Str&ouml;mung</div><div class="location-report-form__field"><span>Richtung: <strong id="path-flow-state">unbekannt</strong></span></div><div class="location-report-form__field"><span class="label-wiki-reference__buttons"><button type="button" id="path-flow-direction" class="location-report-form__button location-report-form__button--secondary">Richtung festlegen</button></span></div><label class="location-report-form__field"><span>Str&ouml;mungsfaktor (flussaufw&auml;rts &times;)</span><div class="location-edit-fieldrow"><input id="path-flow-factor" type="number" min="1" max="3" step="0.1" inputmode="decimal" /><button type="button" id="path-flow-factor-save" class="location-report-form__button location-report-form__button--secondary">&Uuml;bernehmen</button></div></label><p id="path-flow-status" class="location-report-form__status" role="status" aria-live="polite"></p></div><p id="path-edit-status"
```

- [ ] **Step 2: Create `js/review/review-path-flow.js`**

```javascript
// Stroemungs-Sektion im "Weg bearbeiten"-Dialog (Flussrichtung spec §6): zeigt den
// Richtungsstatus des angeklickten Fluss-Segments, dreht/setzt die Richtung WEG-WEIT
// (set_flow: flip | set_dir) und pflegt den weg-weiten Stroemungsfaktor (Clamp 1,0-3,0).
// Nur fuer Flussweg-Segmente sichtbar. Writes: dry_run:false + confirm:"apply" (weg-weit
// ist hier das DESIGN, kein Blast-Radius-Dialog wie beim Entfernen noetig).

function pathFlowElement(id) {
	return document.getElementById(id);
}

function pathFlowCurrentFlow() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		return null;
	}
	return pathEditFeature.properties.flow || null;
}

function pathFlowIsRiverSegment() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return false;
	}
	return normalizePathSubtype(pathEditFeature.properties?.feature_subtype) === "Flussweg";
}

// Weg-weiter Blick: das angeklickte Segment kann selbst richtungslos sein (Zufahrt), obwohl
// der Weg gerichtet ist -> Button-Beschriftung am WEG festmachen. Client-Spiegel der
// Weg-Identitaet (exakter Name ODER gleicher wiki_key); autoritativ entscheidet der Server.
function pathFlowWaySegments() {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return [];
	}
	const name = String(pathEditFeature.properties?.name || "");
	const wikiKey = String(pathEditFeature.properties?.wiki_path?.wiki_key || "");
	return pathData.filter((path) => {
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return false;
		}
		const sameName = name !== "" && String(path.properties?.name || "") === name;
		const sameWiki = wikiKey !== "" && String(path.properties?.wiki_path?.wiki_key || "") === wikiKey;
		return sameName || sameWiki;
	});
}

function renderPathFlowSection() {
	const section = pathFlowElement("path-flow-section");
	if (!section) {
		return;
	}
	if (!pathFlowIsRiverSegment()) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	const flow = pathFlowCurrentFlow();
	const dir = flow?.dir === "forward" || flow?.dir === "reverse" ? flow.dir : null;
	const stateElement = pathFlowElement("path-flow-state");
	if (stateElement) {
		stateElement.textContent = dir
			? (flow?.source === "verlauf-sync" ? "bekannt (aus Wiki)" : "bekannt (manuell)")
			: "unbekannt";
	}
	const waySegments = pathFlowWaySegments();
	const wayHasDirection = waySegments.some((path) => {
		const wayDir = path.properties?.flow?.dir;
		return wayDir === "forward" || wayDir === "reverse";
	});
	const directionButton = pathFlowElement("path-flow-direction");
	if (directionButton) {
		directionButton.textContent = wayHasDirection ? "Richtung umdrehen (ganzer Fluss)" : "Richtung festlegen";
		directionButton.dataset.flowMode = wayHasDirection ? "flip" : "set_dir";
	}
	const factorInput = pathFlowElement("path-flow-factor");
	const saveButton = pathFlowElement("path-flow-factor-save");
	if (factorInput) {
		const rawFactor = Number(flow?.factor);
		factorInput.value = (Number.isFinite(rawFactor) ? Math.min(3, Math.max(1, rawFactor)) : 1.5).toFixed(1);
		// Faktor editierbar, sobald ein Wiki-Weg zugewiesen ODER der Weg gerichtet ist
		// (Owner-Anforderung 3).
		const hasWiki = Boolean(pathEditFeature.properties?.wiki_path?.wiki_key);
		factorInput.disabled = !hasWiki && !wayHasDirection;
		if (saveButton) {
			saveButton.disabled = factorInput.disabled;
		}
	}
}

async function submitPathFlowAction(body, buildSuccessMessage) {
	const status = pathFlowElement("path-flow-status");
	try {
		const result = await pathWikiPost({ ...body, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(result?.error?.message || result?.error || "Aktion fehlgeschlagen");
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		renderPathFlowSection();
		if (typeof window.avesmapsRedrawRiverFlowArrows === "function") {
			window.avesmapsRedrawRiverFlowArrows();
		}
		const message = buildSuccessMessage(result);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "info");
	} catch (error) {
		const message = "Fehler: " + (error.message || error);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "error");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#path-flow-direction")) {
		const button = pathFlowElement("path-flow-direction");
		const mode = button?.dataset.flowMode === "flip" ? "flip" : "set_dir";
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, [mode]: true },
			(result) => mode === "flip"
				? `Richtung umgedreht (${result.flipped} Segmente).`
				: `Richtung festgelegt (${result.directed} von ${result.segments} Segmenten${result.segments > result.directed ? " — Abzweige bleiben ohne Richtung" : ""}).`
		);
	}
	if (event.target.closest("#path-flow-factor-save")) {
		const publicId = pathWikiCurrentFeaturePublicId();
		const factorInput = pathFlowElement("path-flow-factor");
		if (!publicId || !factorInput) {
			return;
		}
		const factor = Number(factorInput.value);
		if (!Number.isFinite(factor)) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, factor },
			(result) => `Strömungsfaktor ${Number(result.factor ?? factor).toFixed(1)} übernommen (${result.factor_updated} Segmente).`
		);
	}
});
```

- [ ] **Step 3: Wire rendering + flow updates**

1. Grep `renderPathWikiReference()` call sites (in `js/review/` — panel-open flow in review-paths.js and the handlers in review-path-wiki.js). After EACH call site that renders the panel on open, add:

```javascript
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
```

2. In `applyWikiPathSegmentsUpdate` (review-path-wiki.js:69-94), inside the `forEach` after the `wiki_path` block, add:

```javascript
		if ("flow" in segment) {
			if (segment.flow) {
				path.properties.flow = segment.flow;
			} else {
				delete path.properties.flow;
			}
		}
```

3. index.html: add after the `review-path-wiki.js` script tag:

```html
	<script src="js/review/review-path-flow.js"></script>
```

- [ ] **Step 4: Verify + Commit**

`node --check js/review/review-path-flow.js`; `node --check js/review/review-path-wiki.js`.

```bash
git add index.html js/review/review-path-flow.js js/review/review-path-wiki.js
git commit -m "feat(editor): Stroemung section in the path detail panel (flip/festlegen/factor)"
```

---

### Task 9: Docs, deploy, live verification (DoD)

**Files:**
- Modify: `docs/routing-featurestand.md` (Flussrichtung section: data model, actions, engines, arrows, panel — a compact pointer to the spec)

- [ ] **Step 1: Docs + final local test sweep**

Run ALL suites: `php tools/paths/test-path-flow-engine.php`, `php tools/paths/test-path-verlauf-engine.php`, `php tools/paths/test-path-verlauf-source.php`, `php tools/routing/test-client-graph-flow.php`, `node tools/routing/test-client-route-flow.mjs`, `node tools/paths/test-way-labels.mjs`. All green.

- [ ] **Step 2: Commit docs, push, verify deploy**

```bash
git add docs/routing-featurestand.md
git commit -m "docs(flow): river flow direction feature state"
git push origin master
git rev-parse HEAD   # verify against remote SHA
```

Wait ~2 minutes (deploy delay) before ANY live PHP probe.

- [ ] **Step 3: Live read-only probes (single requests, STRATO rule)**

1. `GET /api/edit/wiki/paths.php?action=status` — endpoint alive after deploy.
2. POST `{action:"derive_flow", wiki_key:"<Großer-Fluss-wiki_key>", dry_run:true}` — expect `directed > 0`, mixed forward/reverse in a follow-up map-features check, `ambiguous` list small (Zufahrten). (Find the wiki_key via `GET ?action=search&q=Gro`.)
3. POST `{action:"set_flow", public_id:"<GF segment public_id>", factor:1.5, dry_run:true}` — expect `segments` = way size, no writes.
4. POST `{action:"derive_flow_all", dry_run:true, limit:5}` — ONE page only; expect envelope with `next_cursor`/`complete`.
5. POST `/api/route/` Angbar→Havena and Havena→Angbar (river transport) — times still EQUAL (no flow written yet) and identical to pre-deploy values (regression check before any apply).

- [ ] **Step 4: 🔧 DU (owner console — classifier blocks agent prod writes)**

Present these as copyable steps, then STOP and wait:
1. `derive_flow` mit `dry_run:false, confirm:"apply"` auf dem Großen Fluss; danach Editmode öffnen → Pfeile zeigen durchgehend Richtung Havena (DoD 1).
2. Route Angbar→Havena vs. Havena→Angbar: abwärts exakt wie vorher, aufwärts ×1,5, Client == Server (DoD 2).
3. Faktor im Panel auf 2,0 → Aufwärtszeit skaliert; Audit-Eintrag im Änderungs-Verlauf; Undo stellt her (DoD 3).
4. Nicht-Wiki-Fluss: „Richtung festlegen" + Flip; dann `apply_verlauf_case` eines Wiki-Flusses → Wiki-Richtung überschreibt, Faktor bleibt (DoD 4).
5. `derive_flow_all`-Cursor-Loop in der Konsole bis `complete:true` (Einzelrequests, DoD 6).

- [ ] **Step 5: Memory update** — record delivery state, open owner steps, and any new traps in the session memory.

---

## Self-Review (done at plan time)

- **Spec coverage:** Req 1→T2/T3; Req 2→T7; Req 3→T1 (factor plans) + T4/T8; Req 4→normalize-null symmetry + PlanWrites overwrite semantics + T4 set_dir/flip. §2→T1; §3→T2/T3; §4→T5/T6 (+regression tests both engines); §5→T7 (ASSET_VERSION question resolved: static/auto-stamped); §6→T4/T8; §7 non-goals respected (no public arrows, no per-segment flip, no Seeweg/land/shortest changes, no geometry/name writes); §8→T9.
- **Open semantic decision encoded (flag to owner in review):** derivation CLEARS `dir` on way segments it cannot determine (including manual dirs) — keeps ways consistent after flip→sync sequences; factor always survives.
- **Type consistency:** all cross-task names listed in Interfaces blocks; `flow_time_factor` (PHP) vs `flowTimeFactor` (JS) are intentionally per-convention.
- **Placeholder scan:** none — every step carries complete code or an exact command.
