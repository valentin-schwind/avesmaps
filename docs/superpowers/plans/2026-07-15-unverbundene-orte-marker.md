# Unverbundene Orte & Kreuzungen im Edit-Mode markieren — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an edit-mode-only "Unverbunden" checkbox that draws a clear red ring around every currently visible Ort/Kreuzung that has neither a real path/sea-path edge nor a powerline endpoint — a pure client-side diagnostic aid, no data or route changes.

**Architecture:** Extend the existing client routing graph builder (`createGraph`) with an options flag that builds an "all transports, no Querfeldein-synthetics" connectivity graph. Combine its degree-0 nodes with the powerline endpoint set into a cached `Set<public_id>`. Feed that Set into the existing DOM marker-icon renderer (edit mode never uses the Canvas marker path) as a CSS ring modifier class, gated by the same visibility predicates the rest of the map already uses (`isLocationTypeVisible` cascade / `toggleCrossings`).

**Tech Stack:** Vanilla JS (no build), jQuery for DOM/state wiring, Leaflet `L.divIcon` for markers, plain CSS custom properties (tokens.css). Tests: Node, no framework — the existing repo pattern of loading real browser scripts via `vm.runInThisContext` with `window`/`document`/`localStorage` stubs, asserting with `node:assert`.

## Global Constraints

- Design rule (AGENTS.md §12): no hardcoded hex — every colour is a token from `css/base/tokens.css`. The ring colour needs a **new** token (none of the existing ones fit); its exact value is gated on an owner-approved visual draft (Task 6) before Task 7 writes it.
- The "am Weg"-threshold for path-endpoint matching is the **existing** `THRESHOLD = 0.5` (`js/config.js:2`) — do not introduce a new value or measure anything (spec "Schwellwert").
- Non-goals (spec "Nicht-Ziele"): no island/component detection (only "0 real edges" counts), no server endpoint, no list/panel UI, no new distance threshold, Nodices are explicitly out of scope (a location visible *only* because of `toggleNodix` must never get the ring — see Task 7).
- Shared working tree: stage only the files this task touches, by explicit path, never `git add -A` (AGENTS.md §9).
- Asset versioning (AGENTS.md §7 / CLAUDE.md): `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` is for the *editor's dynamically-loaded* assets only — this feature touches none of them, so it is **not** bumped.
- STRATO caution: verification against `?edit=1` probes the map-features endpoint at most a couple of times, never in a loop.

---

## Design decisions carried over from exploration (read this before starting)

- **`getPathAllowedTransports(path)`** already exists in `js/review/review-paths.js:163` and does *exactly* what spec step 1 asks for ("does this path allow ANY transport", including the Wuestenpfad/horseCarriage exclusion and the `allowed_transports: []` "unbefahrbar" rule). Reuse it directly — do **not** write a parallel implementation or touch `isTransportAllowedForPath` in `route-engine.js`. This is a stronger match to "erweitern statt neu bauen" than the spec's own `{skipSyntheticConnections, transports:"all"}` sketch assumed.
- **`refreshPlannerAfterFeatureChange()`** (`js/routing/route-render.js:330`) is the *existing* single choke-point that already sets `graphData = null;` after every location/path edit **and** after every live-polled update from other editors (`pollLiveMapUpdates` in `js/routing/routing.js:181` calls it once after applying all incoming features). Piggy-back the new cache's invalidation on this exact line instead of hooking every individual editor-write call site. Powerline create/delete are the only two mutations that do **not** flow through this function (checked: `completePendingPowerlineAtEndpoint` and `deletePowerlineFeature` in `js/map-features/map-features-powerlines.js` do not call it) — those need one extra invalidation line each.
- Edit mode **never** uses the Canvas marker renderer (`LOCATION_CANVAS_MARKERS_ENABLED && !IS_EDIT_MODE` — canvas is force-disabled whenever `IS_EDIT_MODE` is true, per `js/map-features/map-features-location-marker-rendering.js:244`). So despite the spec's "Canvas-Marker-Renderer" phrasing, the actual integration point is the `L.divIcon` builder `createLocationMarkerIcon` in that same file, driven by `syncLocationMarkerVisibility`.
- `entry.iconZoomLevel` is a **shared** per-marker cache field also read/written by `js/map-features/map-features-location-lookup.js` and `js/map-features/map-features-location-canvas-layer.js`. Do not repurpose or rename it. Add a second, file-local field (`entry._unconnectedRingApplied`) instead, so a toggle flip (interactive click *or* an initial `?toggleUnconnected=1` URL restore, which happens **after** the first icon build — see Task 7 notes) reliably forces one icon rebuild without touching the other files' zoom-cache contract.

---

### Task 1: `createGraph` connectivity-graph option

**Files:**
- Modify: `js/routing/route-graph-routing.js:109-168` (`addRegularPathToGraph`, `createGraph`)
- Test: `js/routing/__tests__/create-graph-connectivity.test.js` (new)

**Interfaces:**
- Consumes: `getPathAllowedTransports(path)` from `js/review/review-paths.js` (existing, unchanged) — `path.properties` shape `{feature_subtype, allowed_transports?, transport_domain?}` → `string[]`.
- Produces: `createGraph(routeOptions, graphOptions = {})` where `graphOptions.skipSyntheticConnections: boolean` and `graphOptions.transports: "all" | undefined`. Default args preserve today's behaviour exactly (existing call sites in `js/routing/route-engine.js:483` and `js/routing/routing.js:1199` pass only `routeOptions` and are unaffected).

- [ ] **Step 1: Write the failing test**

Create `js/routing/__tests__/create-graph-connectivity.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// route-graph-routing.js and its deps are browser globals (no module system) -- load the REAL sources
// into this realm so the test exercises the shipped code. Mirrors js/review/__tests__/path-transport-options.test.js.
global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../../map-features/map-features-location-editing.js");
loadBrowserScript("../../review/review-paths.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// A--B: a normal Weg (no recorded restriction) -> an edge exists in the "all transports" graph.
// C: isolated, no path touches it -> stays disconnected.
// D--E: a Weg whose recorded allowed_transports is an explicit empty list ("unbefahrbar") -- the spec's
// "Kanten-Randfall": still counts as disconnected even though a path is drawn between them.
locationData = [loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0)];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Weg", [30, 0], [40, 0], { transport_domain: "land", allowed_transports: [] }),
];

const graph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });

assert.ok(Object.keys(graph.A).length > 0, "A connects to B");
assert.ok(Object.keys(graph.B).length > 0, "B connects to A");
assert.strictEqual(Object.keys(graph.C).length, 0, "C is isolated");
assert.strictEqual(Object.keys(graph.D).length, 0, "D: unbefahrbar path -> no edge (Kanten-Randfall)");
assert.strictEqual(Object.keys(graph.E).length, 0, "E: unbefahrbar path -> no edge (Kanten-Randfall)");
assert.strictEqual(syntheticPathSegments.size, 0, "skipSyntheticConnections: no Querfeldein edges added, C stays isolated");

console.log("create-graph connectivity tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/routing/__tests__/create-graph-connectivity.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined` or similar, because `createGraph` does not yet accept/honour a second argument and `graph.C`/`graph.D`/`graph.E` are built the old (default-transport) way, so at minimum the `skipSyntheticConnections` assertion fails (today's `createGraph` always calls `connectDetachedGraphComponents`, which would throw on the missing `getTransportOptionForRouteType` global since that file isn't loaded — confirming the test currently cannot pass).

- [ ] **Step 3: Implement the options flag**

In `js/routing/route-graph-routing.js`, replace `addRegularPathToGraph` (lines 109-149) with:

```js
function addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptions = {}) {
    const { geometry: { coordinates }, properties } = pathFeature;
    const startNode = getLocationAtPathEndpoint(coordinates[0]);
    const endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1]);
    if (!startNode || !endNode) {
        return;
    }

    if (graphOptions.transports === "all") {
        // Connectivity-only graph (unconnected-marker feature, docs/superpowers/specs/2026-07-15-
        // unverbundene-orte-marker-design.md): an edge exists whenever the path allows ANY transport,
        // independent of the planner's current selection. getPathAllowedTransports already encodes
        // exactly this rule (explicit allowed_transports, domain default, Wuestenpfad/horseCarriage
        // exclusion) -- an empty list ("unbefahrbar") correctly yields no edge (spec Kanten-Randfall).
        if (!getPathAllowedTransports(pathFeature).length) {
            return;
        }
        const connection = { routeType: normalizePathSubtype(properties?.feature_subtype || properties?.name), id: properties.id };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
        return;
    }

    const distance = calculatePathCoordinateDistance(coordinates),
        routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name),
        transportOption = getTransportOptionForRouteType(routeType, routeOptions);
    if (!transportOption) {
        console.warn(`Keine Transportoption für ${routeType} gefunden. Pfad wird übersprungen.`);
        return;
    }
    if (!isTransportAllowedForPath(properties, transportOption)) {
        return;
    }
    const speed = resolveSpeedForRouteType(routeType, transportOption);
    if (!speed) {
        console.warn(`Geschwindigkeit für ${transportOption} auf ${routeType} nicht definiert. Pfad wird übersprungen.`);
        return;
    }
    const baseTime = distance / speed;
    const flowFactors = getRiverFlowTimeFactors(properties, routeType);
    if (!flowFactors) {
        const connection = { distance, time: baseTime, routeType, id: properties.id, transportOption };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
        return;
    }
    addGraphConnection(graph, startNode.name, endNode.name, {
        distance, time: baseTime * flowFactors.forwardFactor, routeType, id: properties.id,
        transportOption, flowTimeFactor: flowFactors.forwardFactor,
    });
    addGraphConnection(graph, endNode.name, startNode.name, {
        distance, time: baseTime * flowFactors.backwardFactor, routeType, id: properties.id,
        transportOption, flowTimeFactor: flowFactors.backwardFactor,
    });
}
```

Replace `createGraph` (lines 151-168) with:

```js
// Erzeugt einen gewichteten Graphen aus den Locations und Pfaden.
// graphOptions.transports === "all" + graphOptions.skipSyntheticConnections: the connectivity-only
// variant used by the unconnected-marker feature (getUnconnectedLocationPublicIds below). Default args
// (no graphOptions) reproduce today's routing-graph behaviour exactly.
function createGraph(routeOptions, graphOptions = {}) {
    syntheticPathSegments.clear();
    const graph = {};
    locationData.forEach((location) => {
        graph[location.name] = {};
    });
    pathData.forEach((pathFeature) => {
        addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptions);
    });
    if (!graphOptions.skipSyntheticConnections) {
        connectDetachedGraphComponents(graph, routeOptions);
    }

    const unconnectedNames = Object.keys(graph).filter((locName) => !Object.keys(graph[locName]).length);
    if (unconnectedNames.length) {
        console.warn(`${unconnectedNames.length} Locations sind nicht verbunden:\n${unconnectedNames.join("\n")}`);
    }
    return graph;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/routing/__tests__/create-graph-connectivity.test.js`
Expected: PASS, prints `create-graph connectivity tests passed`.

- [ ] **Step 5: Syntax-check the touched file and confirm existing route tests still pass**

Run: `node --check js/routing/route-graph-routing.js`
Run: `node tools/routing/test-client-route-flow.mjs`
Expected: both OK / all assertions pass (this task did not touch `getRiverFlowTimeFactors`, but confirms the file still parses and the existing river-flow suite is unaffected).

- [ ] **Step 6: Commit**

```bash
git add js/routing/route-graph-routing.js js/routing/__tests__/create-graph-connectivity.test.js
git commit -m "feat(routing): add all-transports connectivity graph option to createGraph"
```

---

### Task 2: Powerline endpoint helper

**Files:**
- Modify: `js/map-features/map-features-powerlines.js` (add near `getConnectedPowerlinesForPublicId`, line ~377)
- Test: `js/map-features/__tests__/powerline-connected-endpoints.test.js` (new)

**Interfaces:**
- Consumes: global `powerlineData` (array of `{properties: {from_public_id, to_public_id}}`, existing shape).
- Produces: `getPowerlineConnectedLocationPublicIds(): Set<string>` — every location `public_id` that is a powerline `from_public_id` or `to_public_id`.

- [ ] **Step 1: Write the failing test**

Create `js/map-features/__tests__/powerline-connected-endpoints.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../map-features-powerlines.js");

powerlineData = [
	{ properties: { from_public_id: "pid-A", to_public_id: "pid-C" } },
	{ properties: { from_public_id: "pid-D" } },
];

const endpoints = getPowerlineConnectedLocationPublicIds();
assert.deepStrictEqual([...endpoints].sort(), ["pid-A", "pid-C", "pid-D"]);
assert.strictEqual(endpoints.has("pid-B"), false, "pid-B is not a powerline endpoint");

console.log("powerline endpoint helper tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/map-features/__tests__/powerline-connected-endpoints.test.js`
Expected: FAIL — `ReferenceError: getPowerlineConnectedLocationPublicIds is not defined`.

- [ ] **Step 3: Implement the helper**

In `js/map-features/map-features-powerlines.js`, add directly after `getConnectedPowerlinesForPublicId` (after line 379):

```js
function getPowerlineConnectedLocationPublicIds() {
	const publicIds = new Set();
	powerlineData.forEach((powerline) => {
		const fromPublicId = powerline.properties?.from_public_id;
		const toPublicId = powerline.properties?.to_public_id;
		if (fromPublicId) {
			publicIds.add(fromPublicId);
		}
		if (toPublicId) {
			publicIds.add(toPublicId);
		}
	});
	return publicIds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/map-features/__tests__/powerline-connected-endpoints.test.js`
Expected: PASS.

- [ ] **Step 5: Syntax-check**

Run: `node --check js/map-features/map-features-powerlines.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add js/map-features/map-features-powerlines.js js/map-features/__tests__/powerline-connected-endpoints.test.js
git commit -m "feat(powerlines): add powerline-endpoint public-id set helper"
```

---

### Task 3: Cached `getUnconnectedLocationPublicIds()` + invalidation hooks

**Files:**
- Modify: `js/app/runtime-state.js` (add cache variable, near `graphData = null,`)
- Modify: `js/routing/route-graph-routing.js` (add the combining function, after `createGraph`)
- Modify: `js/routing/route-render.js:330-338` (`refreshPlannerAfterFeatureChange` — invalidate)
- Modify: `js/map-features/map-features-powerlines.js` (invalidate after own powerline create/delete)
- Test: `js/routing/__tests__/unconnected-locations-cache.test.js` (new)

**Interfaces:**
- Consumes: `createGraph` (Task 1), `getPowerlineConnectedLocationPublicIds` (Task 2), global `locationData`.
- Produces: `getUnconnectedLocationPublicIds(): Set<string>` (cached; rebuilds lazily after any invalidation), backed by module-global `unconnectedLocationPublicIds` (`Set|null`).

- [ ] **Step 1: Write the failing test**

Create `js/routing/__tests__/unconnected-locations-cache.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../../map-features/map-features-location-editing.js");
loadBrowserScript("../../review/review-paths.js");
loadBrowserScript("../../map-features/map-features-powerlines.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// A--B connected by path. C isolated (no path, no powerline) -> unconnected. D--E connected only by an
// unbefahrbar path -> both unconnected. F is isolated by path but IS a powerline endpoint -> NOT unconnected.
locationData = [loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0), loc("F", 50, 0)];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Weg", [30, 0], [40, 0], { transport_domain: "land", allowed_transports: [] }),
];
powerlineData = [{ properties: { from_public_id: "pid-F", to_public_id: "pid-A" } }];
unconnectedLocationPublicIds = null;

const first = getUnconnectedLocationPublicIds();
assert.deepStrictEqual([...first].sort(), ["pid-C", "pid-D", "pid-E"]);

const second = getUnconnectedLocationPublicIds();
assert.strictEqual(second, first, "cached: same Set instance until invalidated");

unconnectedLocationPublicIds = null;
const third = getUnconnectedLocationPublicIds();
assert.notStrictEqual(third, first, "invalidation forces a fresh Set");
assert.deepStrictEqual([...third].sort(), ["pid-C", "pid-D", "pid-E"]);

console.log("unconnected-locations cache tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/routing/__tests__/unconnected-locations-cache.test.js`
Expected: FAIL — `ReferenceError: getUnconnectedLocationPublicIds is not defined` (and `unconnectedLocationPublicIds` doesn't exist yet either).

- [ ] **Step 3: Add the cache variable**

In `js/app/runtime-state.js`, in the big `let` chain, add `unconnectedLocationPublicIds = null,` right after `graphData = null,` (currently line 85):

```js
	graphData = null,
	unconnectedLocationPublicIds = null,
	invalidLocationInputs = [],
```

- [ ] **Step 4: Add the combining function**

In `js/routing/route-graph-routing.js`, add after `createGraph`:

```js
// Unconnected-marker feature (docs/superpowers/specs/2026-07-15-unverbundene-orte-marker-design.md):
// a location is "unverbunden" iff it has 0 real path/sea-path edges in the all-transports,
// no-Querfeldein connectivity graph AND is not a powerline endpoint. Cached in
// unconnectedLocationPublicIds (js/app/runtime-state.js); invalidated in refreshPlannerAfterFeatureChange
// (js/routing/route-render.js) plus the two powerline mutation sites that don't flow through it.
function computeUnconnectedLocationPublicIds() {
    const connectivityGraph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
    const powerlineConnectedPublicIds = getPowerlineConnectedLocationPublicIds();
    const unconnectedPublicIds = new Set();
    locationData.forEach((location) => {
        if (!location.publicId) {
            return;
        }
        const hasPathEdge = Object.keys(connectivityGraph[location.name] || {}).length > 0;
        if (!hasPathEdge && !powerlineConnectedPublicIds.has(location.publicId)) {
            unconnectedPublicIds.add(location.publicId);
        }
    });
    return unconnectedPublicIds;
}

function getUnconnectedLocationPublicIds() {
    if (!unconnectedLocationPublicIds) {
        unconnectedLocationPublicIds = computeUnconnectedLocationPublicIds();
    }
    return unconnectedLocationPublicIds;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node js/routing/__tests__/unconnected-locations-cache.test.js`
Expected: PASS.

- [ ] **Step 6: Wire invalidation into the existing choke points**

In `js/routing/route-render.js`, `refreshPlannerAfterFeatureChange` (lines 330-338), add the new cache reset right next to the existing one:

```js
function refreshPlannerAfterFeatureChange({ updateRoute = false } = {}) {
	graphData = null;
	unconnectedLocationPublicIds = null;
	refreshWaypointAutocompleteSources();
	syncPlannerStateToUrl();

	if (updateRoute && getWaypointInputValues().length) {
		updateRouteKeepingCurrentMapView();
	}
}
```

In `js/map-features/map-features-powerlines.js`, `completePendingPowerlineAtEndpoint` (own powerline create — the live-poll path already goes through `refreshPlannerAfterFeatureChange`), add the invalidation line right after `applyLivePowerlineFeature(result.feature);`:

```js
		applyLivePowerlineFeature(result.feature);
		unconnectedLocationPublicIds = null;
		updateRevisionFromEditResponse(result);
```

In the same file, `deletePowerlineFeature`, add it right after the `powerlineData = powerlineData.filter(...)` line:

```js
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		unconnectedLocationPublicIds = null;
		updateRevisionFromEditResponse(result);
```

- [ ] **Step 7: Syntax-check all touched files**

Run: `node --check js/app/runtime-state.js`
Run: `node --check js/routing/route-graph-routing.js`
Run: `node --check js/routing/route-render.js`
Run: `node --check js/map-features/map-features-powerlines.js`
Expected: all OK.

- [ ] **Step 8: Commit**

```bash
git add js/app/runtime-state.js js/routing/route-graph-routing.js js/routing/route-render.js js/map-features/map-features-powerlines.js js/routing/__tests__/unconnected-locations-cache.test.js
git commit -m "feat(routing): cache unconnected-location public ids with editor-write invalidation"
```

---

### Task 4: `#toggleUnconnected` checkbox — edit-mode UI wiring

**Files:**
- Modify: `index.html:1264` (checkbox markup)
- Modify: `js/config.js:471` (`DEFAULT_PLANNER_STATE`)
- Modify: `js/app/bootstrap.js:212-215,226-227` (edit-mode show/hide)
- Modify: `js/map-features/map-features-layer-state.js:108,255-257` (URL restore/persist)
- Modify: `js/map-features/map-features.js:95-98` (change handler)

**Interfaces:**
- Consumes: `DEFAULT_PLANNER_STATE.toggleUnconnected` (new key), `parseBooleanQueryParam` (existing).
- Produces: `$("#toggleUnconnected")` checkbox, checked/hidden state following exactly the `toggleCrossings` pattern; on change, calls `syncLocationMarkerVisibility()` + `syncPlannerStateToUrl()` (Task 7 makes the marker re-render actually reflect it).

No dedicated automated test — this is DOM/jQuery wiring mirroring an existing, already-covered pattern (`toggleCrossings`). Verified live in Task 8.

- [ ] **Step 1: Add the checkbox markup**

In `index.html`, after line 1264 (`toggleCrossingsControl`), add:

```html
					<label id="toggleCrossingsControl" hidden><input type="checkbox" id="toggleCrossings" /> Kreuzungen</label>
					<label id="toggleUnconnectedControl" hidden><input type="checkbox" id="toggleUnconnected" /> Unverbunden</label>
					<label id="toggleNodixControl" hidden><input type="checkbox" id="toggleNodix" /> Nodices</label>
```

(Only the new middle line is new; the other two already exist at that spot — reproduced here to show exact placement.)

- [ ] **Step 2: Add the default-state key**

In `js/config.js`, in `DEFAULT_PLANNER_STATE` (line 471), add right after `toggleCrossings: false,`:

```js
	toggleCrossings: false,
	toggleUnconnected: false,
	toggleNodix: false,
```

- [ ] **Step 3: Show/hide + enable/disable in edit-mode bootstrap**

In `js/app/bootstrap.js`, inside the `if (IS_EDIT_MODE) { ... }` block (lines 212-215), add after the `toggleCrossings` lines:

```js
    document.getElementById("toggleCrossingsControl")?.removeAttribute("hidden");
    document.getElementById("toggleCrossings")?.removeAttribute("disabled");
    document.getElementById("toggleUnconnectedControl")?.removeAttribute("hidden");
    document.getElementById("toggleUnconnected")?.removeAttribute("disabled");
    document.getElementById("toggleNodixControl")?.removeAttribute("hidden");
```

In the `else` branch (lines 226-227), add:

```js
    document.getElementById("toggleCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleUnconnected")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleNodix")?.setAttribute("disabled", "disabled");
```

- [ ] **Step 4: URL restore + persist**

In `js/map-features/map-features-layer-state.js`, in `applyPlannerStateFromUrl` (after line 108), add:

```js
	$("#toggleCrossings").prop("checked", parseBooleanQueryParam(searchParams.get("toggleCrossings"), DEFAULT_PLANNER_STATE.toggleCrossings));
	$("#toggleUnconnected").prop("checked", parseBooleanQueryParam(searchParams.get("toggleUnconnected"), DEFAULT_PLANNER_STATE.toggleUnconnected));
	$("#toggleNodix").prop("checked", parseBooleanQueryParam(searchParams.get("toggleNodix"), DEFAULT_PLANNER_STATE.toggleNodix));
```

In the URL-persist function (after the `toggleCrossings` block, lines 255-257), add:

```js
	if (IS_EDIT_MODE && $("#toggleCrossings").is(":checked") !== DEFAULT_PLANNER_STATE.toggleCrossings) {
		searchParams.set("toggleCrossings", $("#toggleCrossings").is(":checked") ? "1" : "0");
	}
	if (IS_EDIT_MODE && $("#toggleUnconnected").is(":checked") !== DEFAULT_PLANNER_STATE.toggleUnconnected) {
		searchParams.set("toggleUnconnected", $("#toggleUnconnected").is(":checked") ? "1" : "0");
	}
```

- [ ] **Step 5: Change handler**

In `js/map-features/map-features.js`, after the `#toggleCrossings` handler (lines 95-98), add:

```js
$("#toggleCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleUnconnected").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleNodix").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
```

(Only the middle handler is new.)

- [ ] **Step 6: Syntax-check touched JS files**

Run: `node --check js/config.js`
Run: `node --check js/app/bootstrap.js`
Run: `node --check js/map-features/map-features-layer-state.js`
Run: `node --check js/map-features/map-features.js`
Expected: all OK. (`index.html` has no JS syntax checker; visually re-read the diff.)

- [ ] **Step 7: Commit**

```bash
git add index.html js/config.js js/app/bootstrap.js js/map-features/map-features-layer-state.js js/map-features/map-features.js
git commit -m "feat(editor): add Unverbunden filter checkbox (hidden outside edit mode)"
```

---

### Task 5: Visual draft of the red ring — STOP for owner approval

**No file changes in this task.** Per the owner's standing "show a draft first" rule and the explicit instruction in this request, build 2-3 candidate ring styles as a visual mockup and present them before writing any CSS/rendering code.

- [ ] **Step 1: Build a static HTML/CSS mockup**

Reproduce the *actual* marker shapes at their real sizes/colours (`.location-visual-marker__shape` base fill `#cc2f2a`, white border, `--color-marker-active` gold ring for capitals, the dark `.location-visual-marker__shape--crossing` dot) from `css/features/location-popups-markers.css`, each shown with 2-3 candidate ring treatments (varying width / colour / offset, all as `box-shadow` rings — no blur/filter, matching the existing perf-motivated pattern for every other marker ring in that file). Include a dorf circle, a metropole (capital gold ring) to check for ring-on-ring collision, and a crossing dot, each against a light and a dark background swatch (the ring sits on the always-light map tiles, but check readability regardless).

- [ ] **Step 2: Show the draft and stop**

Present the mockup to the owner (Artifact or inline widget). Do not proceed to Task 6 until they pick a candidate (colour + width) or request changes. Record the approved values (they become the `--color-marker-unconnected-ring` token value and the ring width in `location-popups-markers.css`).

---

### Task 6: Finalize the token + ring CSS + wire rendering (post-approval)

**Files:**
- Modify: `css/base/tokens.css` (new token, light block near line 121; dark-block comment near line 281)
- Modify: `css/features/location-popups-markers.css` (new ring rule, after the `--crossing` block, line ~696)
- Modify: `js/map-features/map-features-location-marker-rendering.js` (`createLocationMarkerIcon`, `createLocationVisibilityContext`, `syncLocationMarkerVisibility`)

**Interfaces:**
- Consumes: `getUnconnectedLocationPublicIds()` (Task 3), `$("#toggleUnconnected")` (Task 4), `IS_EDIT_MODE`, `CROSSING_LOCATION_TYPE`.
- Produces: `createLocationMarkerIcon(locationType, zoomLevel = map.getZoom(), isUnconnected = false)` (new third parameter, default `false` keeps every other call site — including `prepareLocationData` in `js/routing/routing.js:94`, which never needs the ring on first paint — unchanged).

- [x] **Step 1: Add the token** — owner picked candidate D (warm pink, 5px ring) from the Task 5 draft

In `css/base/tokens.css`, light `:root` block, after `--color-marker-active: #f0b429;` (line 121):

```css
	/* Unverbundene Orte/Kreuzungen (Edit-Mode-Häkchen "Unverbunden", Discord #25) -- deutlicher
	   pinker Warnring. Pinned wie --color-marker-waypoint oben: der Ring sitzt auf den IMMER-hellen
	   Kartenkacheln, nicht auf einem Theme-Panel, also kein Dark-Override. */
	--color-marker-unconnected-ring: #e0559a;
```

In the dark block, extend the existing "no dark override" comment (near line 281-282) to mention it:

```css
	/* No dark override for the waypoint marks (or --color-marker-unconnected-ring below) on purpose --
	   the SAME mark appears on the always-light map tiles and on the dark panels; a theme-shifted red
	   would make the planner (or the editor) disagree with the map. */
```

- [ ] **Step 2: Add the ring CSS rule**

In `css/features/location-popups-markers.css`, directly after the `.location-visual-marker__shape--crossing` block (after line 696), add:

```css
/* Unverbundene Orte/Kreuzungen -- deutlicher roter Warnring (Edit-Mode-Häkchen "Unverbunden", #25).
   Muss NACH --capital/--crossing im Stylesheet stehen, damit die Regel bei Kombination gewinnt.
   Nur box-shadow-Ringe, kein Blur/Filter (Perf, wie jeder andere Marker-Ring in dieser Datei). */
.location-visual-marker__shape--unconnected {
	box-shadow:
		0 0 0 1px rgba(0, 0, 0, 0.55),
		0 0 0 5px var(--color-marker-unconnected-ring),
		0 0 0 6px rgba(0, 0, 0, 0.35);
}
```

- [ ] **Step 3: Thread `isUnconnected` through icon creation**

In `js/map-features/map-features-location-marker-rendering.js`, change the `createLocationMarkerIcon` signature and both branches:

```js
function createLocationMarkerIcon(locationType, zoomLevel = map.getZoom(), isUnconnected = false) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		const markerSize = getLocationMarkerSize(locationType, zoomLevel);
		const isSimpleMarker = getVisualZoomLevel(zoomLevel) <= 3;
		const shapeClasses = ["location-visual-marker__shape", "location-visual-marker__shape--crossing"];
		if (isSimpleMarker) {
			shapeClasses.push("location-visual-marker__shape--simple");
		}
		if (isUnconnected) {
			shapeClasses.push("location-visual-marker__shape--unconnected");
		}
		const iconHtml = `<span class="${shapeClasses.join(" ")}" style="width:${markerSize}px;height:${markerSize}px;"></span>`;

		return L.divIcon({
			className: `location-visual-marker location-visual-marker--crossing${isSimpleMarker ? " location-visual-marker--simple" : ""}`,
			html: iconHtml,
			iconSize: [markerSize, markerSize],
			iconAnchor: [markerSize / 2, markerSize / 2],
			popupAnchor: [0, -(markerSize / 2)],
		});
	}

	const markerSize = getLocationMarkerSize(locationType, zoomLevel);
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	const isSite = locationType === "gebaeude";
	const isDiamond = isSite && visualZoomLevel >= 4;
	const isCapital = locationType === "metropole" && visualZoomLevel >= 3 && markerSize >= 14;

	const shapeClasses = ["location-visual-marker__shape"];
	shapeClasses.push(isDiamond ? "location-visual-marker__shape--diamond" : "location-visual-marker__shape--circle");
	if (isSite) {
		shapeClasses.push("location-visual-marker__shape--site");
	}
	if (isCapital) {
		shapeClasses.push("location-visual-marker__shape--capital");
	}
	if (isUnconnected) {
		shapeClasses.push("location-visual-marker__shape--unconnected");
	}

	const styleDeclarations = [
		`width:${markerSize}px`,
		`height:${markerSize}px`,
		`border-width:${getLocationMarkerBorderWidth(locationType, zoomLevel)}px`,
	];
	if (isCapital) {
		styleDeclarations.push(`--accent-ring-width:${Math.round(markerSize * 0.12)}px`);
	}

	const iconHtml = `<span${buildHtmlAttributes({
		class: shapeClasses.join(" "),
		style: `${styleDeclarations.join(";")};`,
	})}></span>`;

	return L.divIcon({
		className: "location-visual-marker",
		html: iconHtml,
		iconSize: [markerSize, markerSize],
		iconAnchor: [markerSize / 2, markerSize / 2],
		popupAnchor: [0, -(markerSize / 2)],
	});
}
```

(The crossing branch is rewritten to build its class list the same way as the non-crossing branch, so the new modifier slots in cleanly — behaviourally identical to the old template-literal version for `isUnconnected = false`.)

- [ ] **Step 4: Compute eligibility + wire into `createLocationVisibilityContext`/`syncLocationMarkerVisibility`**

Add a small eligibility helper right above `createLocationVisibilityContext` — the spec's non-goal "Nodices bleiben außen vor" means the ring must only ever apply to a marker that is visible *because of* the type cascade / `toggleCrossings`, never one visible only via `toggleNodix`:

```js
// Nicht-Ziel (spec): Nodices bleiben außen vor -- der Ring gilt nur fuer Marker, die ueber die normale
// Typ-Kaskade bzw. "Kreuzungen" sichtbar sind, NIE nur ueber "Nodices".
function isMarkerUnconnectedRingEligible(entry, visibilityContext) {
	if (entry.locationType === CROSSING_LOCATION_TYPE) {
		return visibilityContext.crossingsToggleChecked;
	}
	return visibilityContext.isTypeVisible(entry.locationType);
}
```

Change `createLocationVisibilityContext`:

```js
function createLocationVisibilityContext() {
	const visibleTypeCache = {};
	const unconnectedToggleChecked = IS_EDIT_MODE && $("#toggleUnconnected").is(":checked");
	return {
		mapLayerMode: typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "",
		nodixToggleChecked: IS_EDIT_MODE && $("#toggleNodix").is(":checked"),
		crossingsToggleChecked: IS_EDIT_MODE && $("#toggleCrossings").is(":checked"),
		unconnectedPublicIds: unconnectedToggleChecked ? getUnconnectedLocationPublicIds() : null,
		isTypeVisible(locationType) {
			if (!(locationType in visibleTypeCache)) {
				visibleTypeCache[locationType] = isLocationTypeVisible(locationType);
			}
			return visibleTypeCache[locationType];
		},
	};
}
```

Change the marker loop in `syncLocationMarkerVisibility` (replace the icon-rebuild block):

```js
		const isUnconnected = Boolean(visibilityContext.unconnectedPublicIds)
			&& isMarkerUnconnectedRingEligible(entry, visibilityContext)
			&& visibilityContext.unconnectedPublicIds.has(entry.publicId);
		if (shouldShow && (entry.iconZoomLevel !== zoomLevel || entry._unconnectedRingApplied !== isUnconnected)) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, zoomLevel, isUnconnected));
			entry.iconZoomLevel = zoomLevel;
			entry._unconnectedRingApplied = isUnconnected;
		}
```

(`entry._unconnectedRingApplied` is a new, file-local field — comparing it forces exactly one icon rebuild whenever the toggle state or the marker's unconnected-membership changes, even when the zoom level itself didn't, including the very first `syncLocationMarkerVisibility()` call after `applyPlannerStateFromUrl()` restores `?toggleUnconnected=1` from a shared link.)

- [ ] **Step 5: Syntax-check**

Run: `node --check js/map-features/map-features-location-marker-rendering.js`
Expected: OK. (CSS has no syntax checker here; visually re-read the diff.)

- [ ] **Step 6: Commit**

```bash
git add css/base/tokens.css css/features/location-popups-markers.css js/map-features/map-features-location-marker-rendering.js
git commit -m "feat(editor): render a red ring on unconnected locations/crossings when toggled"
```

---

### Task 7: Live verification in `?edit=1`

Per spec "Verifikation" — DOM/JS measurement, **not** a live screenshot (Canvas-rAF trap, see memory `verify-ui-fix-via-localhost-repro`; also moot here since edit mode uses DOM markers, not Canvas, but the map's own tile/pan rendering still runs on rAF).

- [ ] **Step 1:** Open the deployed (or a local static-served) app with `?edit=1`. Confirm `#toggleUnconnectedControl` is hidden without `?edit=1` and visible with it (`document.getElementById("toggleUnconnectedControl").hidden`).
- [ ] **Step 2:** Check `#toggleUnconnected` via JS, not a click: `document.getElementById("toggleUnconnected").checked = true; document.getElementById("toggleUnconnected").dispatchEvent(new Event("change"));`. Read `document.querySelectorAll(".location-visual-marker__shape--unconnected").length` — plausibilise against `getUnconnectedLocationPublicIds().size` (accounting for the visibility/cascade gate: not every unconnected location is currently visible).
- [ ] **Step 3:** Toggle the settlement-size cascade down/up (click a lower type button) and confirm the rendered unconnected-ring count changes accordingly (only currently-visible types keep their ring).
- [ ] **Step 4:** Uncheck `#toggleCrossings` and confirm `document.querySelectorAll(".location-visual-marker--crossing .location-visual-marker__shape--unconnected").length === 0`.
- [ ] **Step 5:** Uncheck `#toggleUnconnected` and confirm the count drops to 0.
- [ ] **Step 6:** Reload without `?edit=1` (plain map) and confirm no `.location-visual-marker__shape--unconnected` elements exist regardless of toggle state (control doesn't exist / is disabled).
- [ ] **Step 7:** Spot-check 2-3 known cases (a location the owner already flagged in Discord #25) render with the ring, and one clearly well-connected settlement (e.g. the current capital) does not.

---

### Task 8: Push and verify deploy

- [ ] **Step 1:** `git status` — confirm only this feature's files are staged/committed (shared working tree — never `git add -A`).
- [ ] **Step 2:** `git push`. On rejection: `git fetch && git rebase origin/master --autostash` then retry (never force-push).
- [ ] **Step 3:** Note the pushed commit SHA; wait ~1-2 minutes for the GitHub Action deploy.
- [ ] **Step 4:** Verify the remote SHA matches (per the repo's push-workflow convention), then re-run Task 7's live checks against the deployed site.
