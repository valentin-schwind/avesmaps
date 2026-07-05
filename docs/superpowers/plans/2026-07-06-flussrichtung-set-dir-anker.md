# Anchor-Aware set_dir (Richtung vervollständigen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `set_flow {set_dir:true}` orients the undirected rest of a partially directed river's main chain consistently with its existing directed segments (anchors) instead of throwing.

**Architecture:** One new pure function `avesmapsPathFlowPlanSetDir` in the require-free engine lib wraps the existing diameter-chain walk and aligns it with anchor dirs; `avesmapsWikiPathSetFlow` swaps its `directedBefore > 0` throw for that plan. The panel gains a third way-state (partial) with a second button posting the same `set_dir` action. Endpoint unchanged.

**Tech Stack:** PHP 8 (strict types, no framework), vanilla JS (no build), CLI test harness `tools/paths/test-path-flow-engine.php`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-flussrichtung-set-dir-anker-design.md` (+ Mutter-Spec 2026-07-05 §6).
- Anchors are NEVER rewritten — not dir, not source, not factor; plan covers only previously undirected chain segments.
- Newly directed segments get `source: "editor"`.
- Spurs off the diameter chain stay undirected (owner rule; GF-Drift).
- API error messages English; UI strings German (never translate inline).
- `api/_internal/wiki/path-flow.php` stays require-free at top level; pure functions CLI-testable without DB.
- Panel HTML + `js/review/review-path-flow.js` load from `index.html` (auto-stamped — NO `ASSET_VERSION` bump).
- PHP CLI locally: `php -d extension=mbstring …`.
- Commits: conventional prefixes, small verified commits; branch == origin/master tip (fast-forward push allowed per standing workflow).

---

### Task 1: Pure engine function `avesmapsPathFlowPlanSetDir`

**Files:**
- Modify: `api/_internal/wiki/path-flow.php` (after `avesmapsPathFlowChainOrientation`, before the Dijkstra helper)
- Test: `tools/paths/test-path-flow-engine.php` (append after the ChainOrientation block, before the summary lines)

**Interfaces:**
- Consumes: `avesmapsPathFlowChainOrientation(array $coordinatesByPublicId): array` (existing; `[]` on cycle/degenerate, else `pid => 'forward'|'reverse'` in walk order).
- Produces: `avesmapsPathFlowPlanSetDir(array $coordinatesByPublicId, array $anchorDirByPublicId): array` returning `['ok' => bool, 'reason' => null|'no_chain'|'anchors_conflict'|'no_anchor_on_chain', 'dir_by_public_id' => array]` — `dir_by_public_id` contains ONLY non-anchor chain segments. Task 2 consumes exactly this shape.

- [x] **Step 1: Write the failing tests** — insert before `echo "\n{$total} checks, {$failures} failures\n";`:

```php
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
```

- [x] **Step 2: Run to verify it fails**

Run: `php -d extension=mbstring tools/paths/test-path-flow-engine.php`
Expected: existing 30 checks `ok`, then fatal `Call to undefined function avesmapsPathFlowPlanSetDir()`.

- [x] **Step 3: Implement** — in `api/_internal/wiki/path-flow.php`, directly after `avesmapsPathFlowChainOrientation`:

```php
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
```

- [x] **Step 4: Run to verify it passes**

Run: `php -d extension=mbstring tools/paths/test-path-flow-engine.php`
Expected: `38 checks, 0 failures`, exit 0.

- [x] **Step 5: Commit**

```bash
git add api/_internal/wiki/path-flow.php tools/paths/test-path-flow-engine.php
git commit -m "feat(flow): anchor-aware set_dir plan for partially directed rivers"
```

---

### Task 2: Wire `avesmapsWikiPathSetFlow` to the anchor-aware plan

**Files:**
- Modify: `api/_internal/wiki/path-flow.php` (`avesmapsWikiPathSetFlow`, the `} elseif ($setDir) {` branch, currently ~line 611)

**Interfaces:**
- Consumes: `avesmapsPathFlowPlanSetDir` (Task 1), `avesmapsPathFlowNormalize` (existing).
- Produces: unchanged `set_flow` response shape; `directed_before` (already present) now doubles as the UI's "was partially directed" signal. Endpoint `api/edit/wiki/paths.php` passes the same params — no change there.

- [x] **Step 1: Replace the guard + chain call** — old code:

```php
    } elseif ($setDir) {
        // Stale-panel guard: a way that already has a direction must be flipped, not re-oriented.
        if ($directedBefore > 0) {
            throw new RuntimeException('Way already has a direction (use flip).');
        }
        $chain = avesmapsPathFlowChainOrientation($coordinatesByPublicId);
        if ($chain === []) {
            throw new RuntimeException('No unambiguous segment chain found.');
        }
        foreach ($chain as $pid => $dir) {
```

new code (merge loop body below stays identical):

```php
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
```

Also update the function docblock line `//   {public_id, set_dir:true}  "Richtung festlegen": orient the undirected way's main chain` to `//   {public_id, set_dir:true}  "Richtung festlegen/vervollstaendigen": orient the way's main chain, anchored on existing dirs`.

- [x] **Step 2: Verify**

Run: `php -l api/_internal/wiki/path-flow.php` → `No syntax errors detected`.
Run: `php -d extension=mbstring tools/paths/test-path-flow-engine.php` → `38 checks, 0 failures`.
Run the sibling suites (regression, they require the same lib family): `php -d extension=mbstring tools/paths/test-path-verlauf-engine.php` etc. → all green.

- [x] **Step 3: Commit**

```bash
git add api/_internal/wiki/path-flow.php
git commit -m "feat(flow): set_flow completes partially directed rivers via anchors"
```

---

### Task 3: Panel button „Richtung vervollständigen"

**Files:**
- Modify: `index.html` (line ~791, `path-flow-section`: second button after `path-flow-direction`)
- Modify: `js/review/review-path-flow.js` (`renderPathFlowSection` + click handler + head comment)

**Interfaces:**
- Consumes: `set_flow` response fields `flipped`, `directed`, `directed_before`, `segments` (Tasks 1–2); existing helpers `pathFlowWaySegments`, `pathWikiCurrentFeaturePublicId`, `submitPathFlowAction`.
- Produces: button `#path-flow-complete` (hidden unless the way is partially directed), posts `{action:"set_flow", public_id, set_dir:true}`.

- [x] **Step 1: index.html** — inside the `label-wiki-reference__buttons` span of `path-flow-section`, after the `path-flow-direction` button:

```html
<button type="button" id="path-flow-complete" class="location-report-form__button location-report-form__button--secondary" hidden>Richtung vervollst&auml;ndigen</button>
```

- [x] **Step 2: review-path-flow.js** — in `renderPathFlowSection`, replace the `waySegments`/`wayHasDirection`/`directionButton` block with:

```js
	const waySegments = pathFlowWaySegments();
	const directedCount = waySegments.filter((path) => {
		const wayDir = path.properties?.flow?.dir;
		return wayDir === "forward" || wayDir === "reverse";
	}).length;
	const wayHasDirection = directedCount > 0;
	const directionButton = pathFlowElement("path-flow-direction");
	if (directionButton) {
		directionButton.textContent = wayHasDirection ? "Richtung umdrehen (ganzer Fluss)" : "Richtung festlegen";
		directionButton.dataset.flowMode = wayHasDirection ? "flip" : "set_dir";
	}
	// Teilgerichteter Weg (z. B. Grosser Fluss: nur die wiki-ableitbaren Etappen tragen dir):
	// Rest der Hauptkette anker-konsistent vervollstaendigen. Abzweige bleiben immer dirlos,
	// daher kann der Button auch bei voll gerichteter Kette sichtbar sein -- der Server
	// antwortet dann mit dem klaren "already fully directed"-Fehler (Server ist autoritativ).
	const completeButton = pathFlowElement("path-flow-complete");
	if (completeButton) {
		completeButton.hidden = !(wayHasDirection && directedCount < waySegments.length);
	}
```

In the click handler, replace the `#path-flow-direction` branch with:

```js
	const directionTrigger = event.target.closest("#path-flow-direction, #path-flow-complete");
	if (directionTrigger) {
		const mode = directionTrigger.id === "path-flow-complete" ? "set_dir"
			: (directionTrigger.dataset.flowMode === "flip" ? "flip" : "set_dir");
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, [mode]: true },
			(result) => {
				if (mode === "flip") {
					return `Richtung umgedreht (${result.flipped} Segmente).`;
				}
				if (Number(result.directed_before) > 0) {
					return `Richtung vervollständigt (${result.directed} Segmente ergänzt, ${result.directed_before} waren schon gerichtet — Abzweige bleiben ohne Richtung).`;
				}
				return `Richtung festgelegt (${result.directed} von ${result.segments} Segmenten${result.segments > result.directed ? " — Abzweige bleiben ohne Richtung" : ""}).`;
			}
		);
		return;
	}
```

Update the head comment `(set_flow: flip | set_dir)` mention to include „vervollständigen" (set_dir auf teilgerichtetem Weg richtet nur die dirlosen Ketten-Segmente, Anker bleiben unangetastet).

- [x] **Step 3: Verify**

Run: `node --check js/review/review-path-flow.js` → silent success.

- [x] **Step 4: Commit**

```bash
git add index.html js/review/review-path-flow.js
git commit -m "ui(editor): Richtung-vervollstaendigen button for partially directed rivers"
```

---

### Task 4: Final verification + push

- [x] Run all `tools/paths/test-*.php` suites → green.
- [x] `git push` (fast-forward auf master per Standing-Workflow), Remote-SHA verifizieren.
- [x] 🔧 Owner-Punkte im Abschlussbericht: Wording-Freigabe Button/Meldung; GF-Vervollständigung + Undo-Probe (DoD §8 der Spec).
