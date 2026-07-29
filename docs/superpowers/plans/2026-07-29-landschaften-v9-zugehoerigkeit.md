# Landschaften V9 — Zugehörigkeit rechnen und speichern — Implementation Plan

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen Checkboxen (`- [ ]`).
> **Eigener Worktree auf `origin/master`** (`git fetch` zuerst).

**Ziel:** Der vorhandene Knopf „Zugehörigkeit rechnen" im Landschaften-Editor rechnet
zusätzlich **Weg × Fläche** und speichert alle drei Zuordnungen serverseitig — damit
gemessen werden kann, wie lange das überhaupt dauert.

**Architektur:** Gerechnet wird im **Browser**, wo die beiden vorhandenen Zuordnungen
schon laufen. Kein serverseitiger Stapellauf. Der Server bekommt nur einen schlanken
Lese-Endpunkt für die Weg-Geometrie und vier Schreib-Aktionen am vorhandenen
Ökosystem-Endpunkt. Ergebnis sind vier Tabellen und **eine** Stempelzeile.

**Tech-Stack:** Vanilla JS ohne Bauschritt (CommonJS-Export nur für die Node-Tests),
PHP 8 strict types + PDO, MySQL mit Inline-DDL.

**Spec:** `docs/superpowers/specs/2026-07-29-landschaften-v9-vorberechnung-design.md` —
sie enthält alle Messungen und Begründungen. Dieser Plan wiederholt sie nicht.

## Global Constraints

- **Sprache:** Oberfläche **Deutsch**, Code-Kommentare / Commit-Nachrichten / interne
  Fehlermeldungen **Englisch**. `error.code`-Werte bleiben englische Maschinen-Codes.
- **Geteilter Arbeitsbaum:** niemals `git add -A` / `git add .` / `git commit -a`.
  Immer `git commit --only -m "<msg>" -- <pfad> [<pfad>…]` mit ausschließlich den
  Dateien, die dieser Task anfasst.
- **Kein `?v=` von Hand.** Der Deploy stempelt alles, was von `index.html` oder
  `html/*.html` erreichbar ist — `html/landschaften-editor.html` gehört dazu.
  `js/territory/territory-editor-inline-host.js` muss **nicht** angefasst werden: der
  Landschaften-Editor wird in `js/review/review-ecosystem-list.js:25` mit
  `?v=Date.now()` geladen.
- **Einheit:** alle Bogenlängen in **Karteneinheiten** (`1 KE = 3.000 Schritt`), und die
  Einheit steht im Feldnamen (`*_mapunits`).
- **`basis`:** `0` = Sehne (rohe Stützpunkte), `1` = gezeichnete Catmull-Rom-Kurve.
- **Keine hartkodierten Inhalte:** welche Flächenarten mitrechnen, steht in
  `ecosystem_region_type.affects_paths`, nicht im Code.
- **Kein DDL in einer offenen Transaktion** (implizites Commit) und **kein
  `EnsureTables` in den Chunk-Schreibpfaden**.
- **Testbefehle:**
  - JS: `node js/map-features/__tests__/<name>.test.js`
  - PHP: `php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring <datei>`
  - Syntax: `php -l <datei>`
- **STRATO:** schwere Endpunkte nie in einer Schleife proben. Eine Anfrage genügt.

---

## Dateiübersicht

| Datei | Verantwortung | Task |
|---|---|---|
| `js/map-features/map-features-line-catmull.js` | **neu** — die Catmull-Rom-Abtastung, EINE Umsetzung für beide Fenster | 1 |
| `js/routing/route-graph-core.js` | delegiert an das neue Modul statt eigener Kopie | 1 |
| `js/config.js` | `VISUAL_LINE_CATMULL_ROM_CONFIG` übernimmt die Vorgaben des Moduls | 1 |
| `index.html` | lädt das neue Modul **vor** `js/config.js` | 1 |
| `js/map-features/map-features-ecosystem-path-assign.js` | **neu** — der reine Rechenkern (Kanten, Ray-Cast, Intervalle) | 2 |
| `api/_internal/app/ecosystem.php` | DDL der vier Tabellen + `affects_paths`, Lesepfad reicht das Flag durch | 3 |
| `api/app/ecosystem-areas.php` | Nutzlast-Version 5 (`affects_paths` je Fläche) | 3 |
| `api/_internal/app/path-ecosystem.php` | **neu** — Schreiblogik der vier Aktionen, testbar | 5 |
| `api/edit/map/paths-geometry.php` | **neu** — schlanke Weg-Geometrie für den Editor | 4 |
| `api/edit/map/ecosystem.php` | vier neue Aktionen im vorhandenen Verteiler | 5 |
| `html/landschaften-editor.html` | Knopf rechnet Teil C mit, misst, speichert, zeigt den Stand | 6, 7 |

---

## Task 1: Eine Catmull-Rom-Umsetzung für beide Fenster

Die Abtastung der gezeichneten Kurve steckt heute in `js/routing/route-graph-core.js`.
Der Landschaften-Editor lädt diese Datei nicht und kann es auch nicht (sie hängt am
Routing). Ohne Extraktion entstünde eine **zweite Umsetzung derselben Kurve** — und
zwei Kurven, die auseinanderlaufen können, wären genau der Fehler, den die ganze
`basis`-Unterscheidung vermeiden soll.

**Files:**
- Create: `js/map-features/map-features-line-catmull.js`
- Create: `js/map-features/__tests__/line-catmull.test.js`
- Modify: `js/routing/route-graph-core.js:247-282` (beide Funktionen entfernen)
- Modify: `js/config.js:364-369`
- Modify: `index.html` (ein `<script>` vor `js/config.js`)
- Modify: `html/landschaften-editor.html` (ein `<script>` bei den übrigen Modulen)

**Interfaces:**
- Produces:
  - `AVESMAPS_CATMULL_DEFAULTS = { samples: 8, tension: 0.5 }`
  - `getCatmullRomSplineCoordinates(coordinates, config)` → `[[x,y], …]`
  - `getCatmullRomPoint(previous, current, next, following, t, tension)` → `[x, y]`
  - (beide Namen **unverändert**, damit `smoothLineCoordinatesForDisplay` und jeder
    andere heutige Aufrufer weiterläuft)

- [ ] **Schritt 1: Den Golden-Test schreiben, der die Extraktion absichert**

`js/map-features/__tests__/line-catmull.test.js`:

```js
const assert = require("assert");
const {
	AVESMAPS_CATMULL_DEFAULTS,
	getCatmullRomSplineCoordinates,
	getCatmullRomPoint,
} = require("../map-features-line-catmull.js");

// The values below are NOT invented: they are what route-graph-core.js produced before the
// extraction. If the extraction changes a single coordinate, every stored basis=1 row would
// describe a line the map does not draw -- so this test is the whole point of Task 1.
assert.deepStrictEqual(AVESMAPS_CATMULL_DEFAULTS, { samples: 8, tension: 0.5 });

// Fewer than three points -> untouched (the guard lives in smoothLineCoordinatesForDisplay,
// but the sampler must not invent points either).
assert.deepStrictEqual(
	getCatmullRomSplineCoordinates([[0, 0], [10, 0]], { samples: 2, tension: 0.5 }),
	[[0, 0], [5, 0], [10, 0]],
	"two points, two samples: the straight midpoint"
);

// A straight line stays straight, whatever the tension.
const straight = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [20, 0]], { samples: 4, tension: 0.5 });
assert.strictEqual(straight.length, 1 + 2 * 4, "one start point plus samples per segment");
straight.forEach(([, y]) => assert.ok(Math.abs(y) < 1e-12, "a straight line must not bulge"));
assert.deepStrictEqual(straight[straight.length - 1], [20, 0], "ends exactly on the last vertex");

// The corner case that matters: a right angle bulges OUTWARD, and by how much is what the
// stored curve intervals depend on.
const corner = getCatmullRomSplineCoordinates([[0, 0], [10, 0], [10, 10]], AVESMAPS_CATMULL_DEFAULTS);
const mid = corner[Math.floor(corner.length / 2)];
assert.ok(mid[0] > 10, "the curve overshoots the corner in x, it does not cut it");
assert.deepStrictEqual(corner[0], [0, 0], "starts on the first vertex");
assert.deepStrictEqual(corner[corner.length - 1], [10, 10], "ends on the last vertex");

// Every sampled point of a segment must reproduce the Hermite basis exactly.
const p = getCatmullRomPoint([0, 0], [10, 0], [10, 10], [0, 10], 0.5, 0.5);
assert.ok(Math.abs(p[0] - 11.25) < 1e-9, "x at t=0.5, got " + p[0]);
assert.ok(Math.abs(p[1] - 3.75) < 1e-9, "y at t=0.5, got " + p[1]);

console.log("line-catmull: alle Prüfungen bestanden");
```

- [ ] **Schritt 2: Test laufen lassen — er MUSS scheitern**

```bash
node js/map-features/__tests__/line-catmull.test.js
```

Erwartet: `Cannot find module '../map-features-line-catmull.js'`.

- [ ] **Schritt 3: Vor dem Verschieben die Erwartungswerte gegen den HEUTIGEN Code prüfen**

Die Zahlen `11.25` / `3.75` in Schritt 1 sind aus der Hermite-Form hergeleitet. Sie
müssen gegen die **vorhandene** Umsetzung geprüft werden, bevor sie als Golden-Werte
taugen:

```bash
node -e "
const src = require('fs').readFileSync('js/routing/route-graph-core.js','utf8');
const from = src.indexOf('function getCatmullRomPoint');
eval(src.slice(from, src.indexOf('function getCoordinateDistance')));
console.log(getCatmullRomPoint([0,0],[10,0],[10,10],[0,10],0.5,0.5));
"
```

Erwartet: `[ 11.25, 3.75 ]`. Weicht es ab, **die Testwerte anpassen — nicht den Code**.

- [ ] **Schritt 4: Das Modul anlegen**

`js/map-features/map-features-line-catmull.js`:

```js
// The Catmull-Rom sampling of a drawn line -- ONE implementation, used by two windows.
//
// It used to live inside js/routing/route-graph-core.js, which the Landschaften editor cannot load
// (that file belongs to the routing engine). V9 stores intervals along the DRAWN curve as well as
// along the raw chord, so the editor has to sample exactly the curve the map draws. A second copy
// of these ~30 lines would be two curves that can drift apart -- and every stored basis=1 row would
// then describe a line nobody draws.
//
// Loaded BEFORE js/config.js in index.html, because VISUAL_LINE_CATMULL_ROM_CONFIG spreads the
// defaults below. It has no dependencies of its own, so being first is free.

// The two numbers that define the drawn curve. They live HERE and are spread into the config, so
// there is exactly one place to change them.
const AVESMAPS_CATMULL_DEFAULTS = { samples: 8, tension: 0.5 };

// One sampled point of the segment current->next, using previous/following as the tangent
// neighbours. Plain cubic Hermite; `tension` scales both tangents.
function getCatmullRomPoint(previous, current, next, following, t, tension) {
	const t2 = t * t;
	const t3 = t2 * t;
	const tangentScale = tension;
	const tangentStartX = (Number(next[0]) - Number(previous[0])) * tangentScale;
	const tangentStartY = (Number(next[1]) - Number(previous[1])) * tangentScale;
	const tangentEndX = (Number(following[0]) - Number(current[0])) * tangentScale;
	const tangentEndY = (Number(following[1]) - Number(current[1])) * tangentScale;
	const basisStart = 2 * t3 - 3 * t2 + 1;
	const basisTangentStart = t3 - 2 * t2 + t;
	const basisEnd = -2 * t3 + 3 * t2;
	const basisTangentEnd = t3 - t2;

	return [
		basisStart * Number(current[0]) + basisTangentStart * tangentStartX + basisEnd * Number(next[0]) + basisTangentEnd * tangentEndX,
		basisStart * Number(current[1]) + basisTangentStart * tangentStartY + basisEnd * Number(next[1]) + basisTangentEnd * tangentEndY,
	];
}

// The whole line: the first vertex, then `samples` points per segment. The last sample of the last
// segment lands exactly on the last vertex (t = 1), so start and end are never moved.
function getCatmullRomSplineCoordinates(coordinates, config = AVESMAPS_CATMULL_DEFAULTS) {
	const sampleCount = Math.max(1, Number.parseInt(config.samples, 10) || 8);
	const tension = Math.max(0, Math.min(1, Number(config.tension) || 0.5));
	const smoothedCoordinates = [coordinates[0]];

	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const previous = coordinates[Math.max(0, index - 1)];
		const current = coordinates[index];
		const next = coordinates[index + 1];
		const following = coordinates[Math.min(coordinates.length - 1, index + 2)];

		for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
			smoothedCoordinates.push(getCatmullRomPoint(previous, current, next, following, sampleIndex / sampleCount, tension));
		}
	}

	return smoothedCoordinates;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_CATMULL_DEFAULTS, getCatmullRomSplineCoordinates, getCatmullRomPoint };
}
```

- [ ] **Schritt 5: Test laufen lassen — er MUSS bestehen**

```bash
node js/map-features/__tests__/line-catmull.test.js
```

Erwartet: `line-catmull: alle Prüfungen bestanden`.

- [ ] **Schritt 6: Die alten Kopien entfernen**

In `js/routing/route-graph-core.js` die beiden Funktionen `getCatmullRomSplineCoordinates`
und `getCatmullRomPoint` **vollständig löschen** (heute Zeilen 247–282) und an ihrer
Stelle den Verweis hinterlassen:

```js
// getCatmullRomSplineCoordinates / getCatmullRomPoint live in
// js/map-features/map-features-line-catmull.js since V9 -- the Landschaften editor needs the exact
// same sampling and cannot load this file. Loaded before js/config.js, so both globals exist here.
```

`smoothLineCoordinatesForDisplay` bleibt unverändert, wo es ist; es ruft die Globals auf.

- [ ] **Schritt 7: `js/config.js` auf die Vorgaben des Moduls umstellen**

```js
const VISUAL_LINE_CATMULL_ROM_CONFIG = {
	enabled: INITIAL_SEARCH_PARAMS.get("smoothRoute") !== "0" && INITIAL_SEARCH_PARAMS.get("smoothLines") !== "0",
	method: "catmullRom",
	// samples/tension come from map-features-line-catmull.js (loaded before this file) so the editor
	// and the map cannot drift apart on the shape of the drawn curve.
	...AVESMAPS_CATMULL_DEFAULTS,
};
```

- [ ] **Schritt 8: Beide Seiten laden lassen**

In `index.html` **unmittelbar vor** dem `<script src="js/config.js">`:

```html
<script src="js/map-features/map-features-line-catmull.js"></script>
```

In `html/landschaften-editor.html` bei den übrigen Modulen (nach
`polygon-clipping.umd.min.js`, vor `map-features-ecosystem-geometry.js`):

```html
<script src="/js/map-features/map-features-line-catmull.js"></script>
```

- [ ] **Schritt 9: Syntax und Regression prüfen**

```bash
node -e "require('./js/map-features/map-features-line-catmull.js'); console.log('ok')"
```

Danach im Browser (Vorschau-Server, siehe Task 7 Schritt 1): eine Route berechnen und
prüfen, dass die Routenlinie **weiterhin geglättet** gezeichnet wird. Bricht hier etwas,
ist Schritt 6 zu weit gegangen.

- [ ] **Schritt 10: Commit**

```bash
git commit --only -m "refactor(lines): the Catmull-Rom sampling becomes one module both windows can load" -- js/map-features/map-features-line-catmull.js js/map-features/__tests__/line-catmull.test.js js/routing/route-graph-core.js js/config.js index.html html/landschaften-editor.html
```

---

## Task 2: Der Rechenkern — Intervalle einer Linie in einer Fläche

**Files:**
- Create: `js/map-features/map-features-ecosystem-path-assign.js`
- Create: `js/map-features/__tests__/ecosystem-path-assign.test.js`

**Interfaces:**
- Consumes: nichts (rein).
- Produces:
  - `ecosystemAreaEdges(geometry)` → `Float64Array`-freies `[[x1,y1,x2,y2], …]` über **alle**
    Ringe (Außenringe und Löcher gleichermaßen)
  - `ecosystemLineBounds(coordinates)` → `{ min_x, min_y, max_x, max_y }`
  - `ecosystemPointInEdges(x, y, edges)` → `boolean`
  - `ecosystemLineIntervals(coordinates, edges)` → `[{ enter, exit }, …]`, Bogenlängen ab
    Linienbeginn, aufsteigend, nie überlappend

- [ ] **Schritt 1: Den Test schreiben**

`js/map-features/__tests__/ecosystem-path-assign.test.js`:

```js
const assert = require("assert");
const {
	ecosystemAreaEdges,
	ecosystemLineBounds,
	ecosystemPointInEdges,
	ecosystemLineIntervals,
} = require("../map-features-ecosystem-path-assign.js");

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// A square 0..100.
const square = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] };
const squareEdges = ecosystemAreaEdges(square);
assert.strictEqual(squareEdges.length, 4, "four edges, the closing point is not a fifth");

// A wood with a clearing -- the same fixture the geometry test uses.
const woodWithClearing = {
	type: "Polygon",
	coordinates: [
		[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
		[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
	],
};

// Two separate squares -- one line, two crossings of the SAME area.
const twoSquares = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
	],
};

// ---- bounds ----------------------------------------------------------------------------------
assert.deepStrictEqual(
	ecosystemLineBounds([[5, 7], [-3, 20], [11, 2]]),
	{ min_x: -3, min_y: 2, max_x: 11, max_y: 20 }
);

// ---- ray cast --------------------------------------------------------------------------------
assert.strictEqual(ecosystemPointInEdges(50, 50, squareEdges), true, "middle of the square");
assert.strictEqual(ecosystemPointInEdges(150, 50, squareEdges), false, "right of the square");
assert.strictEqual(
	ecosystemPointInEdges(50, 50, ecosystemAreaEdges(woodWithClearing)), false,
	"the clearing is a hole -- a hole is outside"
);

// ---- no intersection -------------------------------------------------------------------------
assert.deepStrictEqual(ecosystemLineIntervals([[200, 50], [300, 50]], squareEdges), []);

// ---- straight through ------------------------------------------------------------------------
let intervals = ecosystemLineIntervals([[-10, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1, "one crossing");
near(intervals[0].enter, 10, "enters 10 units after the start");
near(intervals[0].exit, 110, "leaves 110 units after the start");

// ---- starts inside ---------------------------------------------------------------------------
intervals = ecosystemLineIntervals([[50, 50], [110, 50]], squareEdges);
assert.strictEqual(intervals.length, 1);
near(intervals[0].enter, 0, "a line that starts inside enters at 0");
near(intervals[0].exit, 50, "and leaves at the boundary");

// ---- entirely inside -------------------------------------------------------------------------
intervals = ecosystemLineIntervals([[10, 50], [90, 50]], squareEdges);
assert.strictEqual(intervals.length, 1);
near(intervals[0].enter, 0, "no boundary at all");
near(intervals[0].exit, 80, "so the interval is the whole line");

// ---- the hole makes a gap --------------------------------------------------------------------
intervals = ecosystemLineIntervals([[-10, 50], [110, 50]], ecosystemAreaEdges(woodWithClearing));
assert.strictEqual(intervals.length, 2, "wood, clearing, wood");
near(intervals[0].enter, 10, "enters the wood");
near(intervals[0].exit, 50, "reaches the clearing");
near(intervals[1].enter, 70, "leaves the clearing");
near(intervals[1].exit, 110, "leaves the wood");

// ---- the same area twice ---------------------------------------------------------------------
intervals = ecosystemLineIntervals([[-5, 5], [35, 5]], ecosystemAreaEdges(twoSquares));
assert.strictEqual(intervals.length, 2, "two squares, two intervals, one area");
near(intervals[0].enter, 5, "first square");
near(intervals[0].exit, 15, "");
near(intervals[1].enter, 25, "second square");
near(intervals[1].exit, 35, "");

// ---- 💣 exactly through a corner ---------------------------------------------------------------
// (100,100) is the END of the right edge and the START of the top edge. With u half-open on BOTH
// sides it counts ONCE. Counting it twice would toggle the state back and produce zero intervals
// for a line that visibly leaves the square.
intervals = ecosystemLineIntervals([[50, 50], [150, 150]], squareEdges);
assert.strictEqual(intervals.length, 1, "a corner crossing counts once, not twice");
near(intervals[0].enter, 0, "starts inside");
near(intervals[0].exit, Math.hypot(50, 50), "leaves exactly at the corner");

// ---- degenerate ------------------------------------------------------------------------------
assert.deepStrictEqual(ecosystemLineIntervals([[50, 50], [50, 50]], squareEdges), [],
	"a zero-length line has no interval, and must not throw");
assert.deepStrictEqual(ecosystemLineIntervals([[-10, 50], [110, 50]], []), [],
	"an area without edges is skipped, not an error");

// A tangent that grazes a corner produces an interval shorter than the epsilon -> dropped.
const tangent = ecosystemLineIntervals([[-10, 0], [110, 0]], squareEdges);
tangent.forEach((interval) => assert.ok(interval.exit - interval.enter > 1e-9, "no zero-length intervals"));

console.log("ecosystem-path-assign: alle Prüfungen bestanden");
```

- [ ] **Schritt 2: Test laufen lassen — er MUSS scheitern**

```bash
node js/map-features/__tests__/ecosystem-path-assign.test.js
```

Erwartet: `Cannot find module '../map-features-ecosystem-path-assign.js'`.

- [ ] **Schritt 3: Das Modul schreiben**

`js/map-features/map-features-ecosystem-path-assign.js`:

```js
// V9: where does a LINE run through an area, measured as arc length from the line's start.
//
// 🔴 BINDING RULE: everything here takes a COORDINATE LIST, never a path object. A cross-country
// edge is a list of two points, and "does it cross water" is this same function asked whether any
// interval came back at all (spec §5). Binding this to stored paths would make V13 a second copy
// of the same maths.
//
// Deliberately NOT built on polygon-clipping: that answers "how much AREA overlaps", and this
// question is "where along a LINE" -- a boolean clip cannot give an arc length, and going through
// one would be orders of magnitude more expensive.

// Every edge of every ring, outer rings and holes alike. A hole needs no special case: its edges
// flip the inside/outside state exactly like an outer ring's do, and the ray cast counts them by
// parity. The closing point of a ring is not a fifth edge.
function ecosystemAreaEdges(geometry) {
	const type = geometry && geometry.type;
	const rings = type === "Polygon" ? geometry.coordinates
		: type === "MultiPolygon" ? geometry.coordinates.reduce((all, part) => all.concat(part), [])
		: [];
	const edges = [];
	rings.forEach((ring) => {
		for (let index = 0; index < ring.length - 1; index += 1) {
			edges.push([ring[index][0], ring[index][1], ring[index + 1][0], ring[index + 1][1]]);
		}
	});
	return edges;
}

function ecosystemLineBounds(coordinates) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	coordinates.forEach((point) => {
		if (point[0] < minX) { minX = point[0]; }
		if (point[0] > maxX) { maxX = point[0]; }
		if (point[1] < minY) { minY = point[1]; }
		if (point[1] > maxY) { maxY = point[1]; }
	});
	return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
}

// Ray cast towards +x, counting crossings by parity. The `(y1 > py) !== (y2 > py)` test is the
// half-open rule for the ray as well: a vertex exactly at py belongs to one edge, not to both.
function ecosystemPointInEdges(x, y, edges) {
	let inside = false;
	for (let index = 0; index < edges.length; index += 1) {
		const edge = edges[index];
		const y1 = edge[1];
		const y2 = edge[3];
		if ((y1 > y) === (y2 > y)) { continue; }
		const crossX = edge[0] + ((y - y1) / (y2 - y1)) * (edge[2] - edge[0]);
		if (crossX > x) { inside = !inside; }
	}
	return inside;
}

// Intervals shorter than this are dropped: they are a line grazing a corner, not a passage.
const ECOSYSTEM_INTERVAL_EPSILON = 1e-9;

function ecosystemLineIntervals(coordinates, edges) {
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !edges || edges.length === 0) {
		return [];
	}

	// Cumulative arc length, so a crossing found inside segment i becomes an absolute distance.
	const cumulative = [0];
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		cumulative.push(cumulative[index] + Math.hypot(
			coordinates[index + 1][0] - coordinates[index][0],
			coordinates[index + 1][1] - coordinates[index][1]
		));
	}
	const total = cumulative[coordinates.length - 1];
	if (!(total > 0)) { return []; }

	const cuts = [];
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const ax = coordinates[index][0];
		const ay = coordinates[index][1];
		const rx = coordinates[index + 1][0] - ax;
		const ry = coordinates[index + 1][1] - ay;
		const segmentLength = Math.hypot(rx, ry);
		if (segmentLength === 0) { continue; }
		// Segment bbox, so the inner loop can reject most edges with four comparisons instead of
		// the full parametric solve. This is what keeps a 3.000-edge area affordable.
		const sMinX = rx >= 0 ? ax : ax + rx;
		const sMaxX = rx >= 0 ? ax + rx : ax;
		const sMinY = ry >= 0 ? ay : ay + ry;
		const sMaxY = ry >= 0 ? ay + ry : ay;

		for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
			const edge = edges[edgeIndex];
			const ex1 = edge[0], ey1 = edge[1], ex2 = edge[2], ey2 = edge[3];
			if (Math.min(ex1, ex2) > sMaxX || Math.max(ex1, ex2) < sMinX) { continue; }
			if (Math.min(ey1, ey2) > sMaxY || Math.max(ey1, ey2) < sMinY) { continue; }

			const sx = ex2 - ex1;
			const sy = ey2 - ey1;
			const denominator = rx * sy - ry * sx;
			if (denominator === 0) { continue; }          // parallel or collinear -> no single crossing
			const qx = ex1 - ax;
			const qy = ey1 - ay;
			const t = (qx * sy - qy * sx) / denominator;
			const u = (qx * ry - qy * rx) / denominator;
			// 💣 HALF-OPEN ON BOTH SIDES. A line through a polygon corner otherwise meets both edges
			// that share it, toggles twice, and the passage disappears.
			if (t < 0 || t >= 1 || u < 0 || u >= 1) { continue; }
			cuts.push(cumulative[index] + t * segmentLength);
		}
	}

	cuts.sort((left, right) => left - right);

	const intervals = [];
	const marks = [0].concat(cuts, [total]);
	let inside = ecosystemPointInEdges(coordinates[0][0], coordinates[0][1], edges);
	for (let index = 0; index < marks.length - 1; index += 1) {
		if (inside && marks[index + 1] - marks[index] > ECOSYSTEM_INTERVAL_EPSILON) {
			intervals.push({ enter: marks[index], exit: marks[index + 1] });
		}
		inside = !inside;
	}
	return intervals;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_INTERVAL_EPSILON,
		ecosystemAreaEdges,
		ecosystemLineBounds,
		ecosystemPointInEdges,
		ecosystemLineIntervals,
	};
}
```

- [ ] **Schritt 4: Test laufen lassen — er MUSS bestehen**

```bash
node js/map-features/__tests__/ecosystem-path-assign.test.js
```

Erwartet: `ecosystem-path-assign: alle Prüfungen bestanden`.

- [ ] **Schritt 5: Alle Landschaften-Tests laufen lassen (keine Regression)**

```bash
for f in js/map-features/__tests__/ecosystem-*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo fertig
```

Erwartet: nur `fertig`, keine `FAIL`-Zeile.

- [ ] **Schritt 6: Das Modul in den Editor laden**

In `html/landschaften-editor.html` direkt nach `map-features-line-catmull.js`:

```html
<script src="/js/map-features/map-features-ecosystem-path-assign.js"></script>
```

- [ ] **Schritt 7: Commit**

```bash
git commit --only -m "feat(ecosystem): a pure kernel for where a line runs through an area" -- js/map-features/map-features-ecosystem-path-assign.js js/map-features/__tests__/ecosystem-path-assign.test.js html/landschaften-editor.html
```

---

## Task 3: Die Tabellen und `affects_paths`

**Files:**
- Modify: `api/_internal/app/ecosystem.php` (in `avesmapsEcosystemEnsureTables`, hinter
  dem `ecosystem_region_type`-Block; und in `avesmapsEcosystemReadAreas`)
- Modify: `api/app/ecosystem-areas.php` (Nutzlast-Version 4 → 5)

**Interfaces:**
- Produces: die Tabellen `path_ecosystem`, `ecosystem_region_overlap`,
  `ecosystem_region_territory`, `ecosystem_assignment_stamp`; die Spalte
  `ecosystem_region_type.affects_paths`; das Feld `affects_paths` je Fläche im
  öffentlichen Lesepfad.

- [ ] **Schritt 1: Die vier Tabellen anlegen**

In `avesmapsEcosystemEnsureTables`, **nach** dem `ecosystem_region_type`-Block und
**vor** dem Startwert-Seed:

```php
    // ---- V9: the stored assignments (spec 2026-07-29) -------------------------------------------
    // They live in THIS function, not in a file of their own, for two reasons: the step paths that
    // write them must run no DDL at all (an ALTER inside a transaction commits it silently), and the
    // write paths for areas already call this function -- so the tables exist before anyone writes.
    //
    // path_id is map_features.id and area_id is ecosystem_area.id -- the INTERNAL ids, not the
    // public_ids this house usually joins on. This is a derived cache, not a domain link: a
    // CHAR(36) key would make the PK 41 bytes instead of 14 and every secondary index carry it.
    //
    // 💣 `basis` is in the KEY, not two extra columns: the raw chord and the drawn Catmull-Rom curve
    // produce different interval SETS (measured: 6 pairs only the chord hits, 4 only the curve), so
    // a paired-column row would force a match that does not exist.
    //   0 = chord (the raw vertices; the unit the graph, the travel time and the edge weights use)
    //   1 = curve (the drawn line; what a marker, a coloured stretch or the route simulator needs)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS path_ecosystem (
            path_id BIGINT UNSIGNED NOT NULL,
            area_id INT UNSIGNED NOT NULL,
            basis TINYINT UNSIGNED NOT NULL,
            seq TINYINT UNSIGNED NOT NULL,
            enter_distance_mapunits DECIMAL(10,4) NOT NULL,
            exit_distance_mapunits DECIMAL(10,4) NOT NULL,
            PRIMARY KEY (path_id, area_id, basis, seq),
            KEY idx_path_ecosystem_area (area_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // Both directions are written -- a reader always asks "what lies in THIS region", never "does
    // this pair exist". share = the fraction of the SMALLER of the two regions, threshold 10 %.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_region_overlap (
            region_id INT UNSIGNED NOT NULL,
            other_region_id INT UNSIGNED NOT NULL,
            share DECIMAL(6,5) NOT NULL,
            PRIMARY KEY (region_id, other_region_id),
            KEY idx_ecosystem_overlap_other (other_region_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // 🔴 territory_public_id, NOT an internal id -- deliberately the opposite choice from
    // path_ecosystem. The political layer is a foreign module read through
    // api/app/political-territories.php, which speaks public_ids; pointing at its internal key would
    // add a coupling nothing else needs. Here it is hundreds of rows, not tens of thousands, so the
    // key width does not matter.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_region_territory (
            region_id INT UNSIGNED NOT NULL,
            territory_public_id CHAR(36) NOT NULL,
            share DECIMAL(6,5) NOT NULL,
            is_aggregate TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (region_id, territory_public_id),
            KEY idx_ecosystem_territory (territory_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // 💣 ONE row (id = 1), and it exists because of the ZERO. Of 5.650 ways only 3.829 cross any
    // area at all -- 1.821 produce no rows, and that is a valid, final result. Deriving "was it
    // computed?" from the presence of rows would call every one of those 1.821 uncomputed, and an
    // empty run failed. The same lesson is written out in api/_internal/app/citymaps.php.
    //
    // duration_ms is not decoration: it is the answer to "how long does this take", and it must
    // still be readable tomorrow, not only in the moment of the click.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_assignment_stamp (
            id TINYINT UNSIGNED NOT NULL,
            ecosystem_revision INT UNSIGNED NOT NULL,
            map_revision BIGINT UNSIGNED NOT NULL,
            area_count INT UNSIGNED NOT NULL,
            path_count INT UNSIGNED NOT NULL,
            overlap_rows INT UNSIGNED NOT NULL,
            territory_rows INT UNSIGNED NOT NULL,
            path_rows_chord INT UNSIGNED NOT NULL,
            path_rows_curve INT UNSIGNED NOT NULL,
            duration_ms INT UNSIGNED NOT NULL,
            run_token CHAR(36) NULL,
            completed TINYINT(1) NOT NULL DEFAULT 0,
            computed_by BIGINT UNSIGNED NULL,
            computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
```

- [ ] **Schritt 2: `affects_paths` nachrüsten — mit dem Wächter PRO SPALTE**

Im vorhandenen `foreach`-Block über `$typeColumnExists` **die neue Spalte NICHT
mit aufnehmen** (der Block darunter schreibt Geländevorgaben). Stattdessen direkt
dahinter ein eigener Block:

```php
    // V9: does this KIND of area take part in the way x area assignment at all?
    //
    // Measured 2026-07-29 on the live stock: `Meer-001` (3.050 corners) and the continent
    // `Aventurien` (1.539) alone cause 90 % of the whole computation and 64 % of the rows -- and
    // they say nothing: "this route runs through Aventurien" is true of every route on the map.
    // Off for meer/kontinent/kueste, on for everything else.
    //
    // 💣 A separate flag from the block above, and its seed is guarded by ITS OWN column check. The
    // comment there says why: a shared "was anything new?" flag would re-run the terrain seed and
    // silently reset every value the owner has since adjusted.
    if (!$typeColumnExists($pdo, 'affects_paths')) {
        $pdo->exec('ALTER TABLE ecosystem_region_type ADD COLUMN affects_paths TINYINT(1) NOT NULL DEFAULT 1');
        $pdo->exec("UPDATE ecosystem_region_type SET affects_paths = 0
                     WHERE type_key IN ('meer', 'kontinent', 'kueste')");
    }
```

- [ ] **Schritt 3: Das Flag in den Lesepfad reichen**

In `avesmapsEcosystemReadAreas` die Abfrage um den Typ-Join erweitern und das Feld
ausgeben. Die Fläche ohne `region_type` (live 13 Stück) hat keine Typzeile:

```php
// COALESCE, not a plain join value: an area whose region carries no type has no type row, and
// "unknown kind" must mean "takes part", never "silently left out".
'affects_paths' => (int) ($row['affects_paths'] ?? 1) === 1,
```

Der SQL-Teil:

```sql
LEFT JOIN ecosystem_region_type t ON t.kind = r.kind AND t.type_key = a_region_type
```

— exakt nach dem Muster, das `avesmapsEcosystemReadRegionTypeLabels` schon benutzt; die
Spalte in der Auswahlliste als `COALESCE(t.affects_paths, 1) AS affects_paths`.

- [ ] **Schritt 4: Nutzlast-Version hochsetzen**

In `api/app/ecosystem-areas.php`:

```php
// 5 (2026-07-29): every area row carries `affects_paths`. Same revision, new shape -- without the
// bump a warm client keeps the old body through a 304, sees no flag, and would compute the way
// assignment for the sea and the continent as well: measured 90 % of the work for rows that say
// "this route runs through Aventurien".
const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 5;
```

- [ ] **Schritt 5: Syntax prüfen**

```bash
php -l api/_internal/app/ecosystem.php && php -l api/app/ecosystem-areas.php
```

Erwartet: zweimal `No syntax errors detected`.

- [ ] **Schritt 6: Die vorhandenen PHP-Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/ecosystem-geometry-test.php
```

Erwartet: der Test läuft durch wie zuvor.

- [ ] **Schritt 7: Commit**

```bash
git commit --only -m "feat(ecosystem): store the three assignments, and let a type opt out of the way pass" -- api/_internal/app/ecosystem.php api/app/ecosystem-areas.php
```

---

## Task 4: Weg-Geometrie für den Editor

**Files:**
- Create: `api/edit/map/paths-geometry.php`

**Interfaces:**
- Produces: `GET /api/edit/map/paths-geometry.php` (cap `edit`) →
  `{ ok:true, map_revision:int, paths:[ { public_id, geometry, bounds } ] }`

- [ ] **Schritt 1: Den Endpunkt schreiben**

```php
<?php

declare(strict_types=1);

// V9: the way geometry for the Landschaften editor's "Zugehörigkeit rechnen" button.
//
// WHY A SEPARATE ENDPOINT. The editor loads no map_features at all today, and the map payload is
// measured 17,79 MB uncompressed for a fraction of what is needed here -- 5.650 LineStrings out of
// 11.054 features, without properties, sources or styles. This returns ~1,5 MB.
//
// WHY api/edit/ AND NOT api/app/. It serves one editor button. The public read surface does not
// grow for it (AGENTS.md §4), which is the same reasoning that put `list_regions` behind the
// capability gate rather than on the public path.
//
// NO INTERNAL IDS IN THE PAYLOAD. The client computes with public_ids; the save action resolves them
// server-side (api/_internal/app/path-ecosystem.php). Internal keys stay internal.

require __DIR__ . '/../../_internal/auth.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not load way geometry.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for way geometry.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // No EnsureTables: map_features has existed since the beginning, and this endpoint must stay a
    // plain read -- its whole point is to be cheap enough to call behind one click.
    $statement = $pdo->query(
        "SELECT public_id, geometry_json, min_x, min_y, max_x, max_y
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1
          ORDER BY id"
    );

    $paths = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        // A way whose geometry does not decode is skipped rather than aborting the whole read: one
        // broken row must not cost the editor the other 5.649.
        if (!is_array($geometry) || ($geometry['type'] ?? '') !== 'LineString') {
            continue;
        }
        $paths[] = [
            'public_id' => (string) $row['public_id'],
            'geometry' => $geometry,
            'bounds' => [
                'min_x' => (float) $row['min_x'],
                'min_y' => (float) $row['min_y'],
                'max_x' => (float) $row['max_x'],
                'max_y' => (float) $row['max_y'],
            ],
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        // The client stamps this into the run, so a later reader can tell which map stand the stored
        // intervals describe.
        'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'paths' => $paths,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Way geometry could not be loaded from the database.');
} catch (Throwable) {
    // No getMessage() to the client -- several edit endpoints leak exception text (milestone M1) and
    // this is not the place to add another one.
    avesmapsErrorResponse(500, 'server_error', 'Way geometry could not be loaded.');
}
```

- [ ] **Schritt 2: Syntax prüfen**

```bash
php -l api/edit/map/paths-geometry.php
```

Erwartet: `No syntax errors detected`.

- [ ] **Schritt 3: Gegen einen Nachbarn gegenlesen**

```bash
head -30 api/edit/map/citymap-autoget.php
```

Prüfen, dass Reihenfolge und Form übereinstimmen: `require _internal/auth.php` → Config →
CORS → OPTIONS → Methode → Capability → PDO. Weicht etwas ab, dem Nachbarn folgen.

- [ ] **Schritt 4: Commit**

```bash
git commit --only -m "feat(ecosystem): a slim way-geometry read for the assignment run" -- api/edit/map/paths-geometry.php
```

---

## Task 5: Speichern — vier Aktionen mit Lauf-Token

**Files:**
- Create: `api/_internal/app/path-ecosystem.php`
- Create: `api/_internal/app/__tests__/path-ecosystem-test.php`
- Modify: `api/edit/map/ecosystem.php` (vier Zeilen im `match($action)`)

**Interfaces:**
- Consumes: die Tabellen aus Task 3.
- Produces:
  - `avesmapsPathEcosystemBegin(PDO, int $userId): array` → `['run_token' => string]`
  - `avesmapsPathEcosystemChunk(PDO, array $payload): array` → `['written' => int, 'skipped' => int]`
  - `avesmapsPathEcosystemCommit(PDO, array $payload, int $userId): array`
  - `avesmapsPathEcosystemStatus(PDO): array`
  - `avesmapsPathEcosystemNormalizeRows(string $kind, mixed $rows): array` (**rein**, testbar)

- [ ] **Schritt 1: Den Test schreiben — nur der reine Teil**

`api/_internal/app/__tests__/path-ecosystem-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the PURE part of the V9 assignment store: row normalisation and the token guard.
 * Everything DB-bound (the transactions, the id resolution) is provable only in the owner's live
 * run -- there is no local MySQL. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-ecosystem-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../path-ecosystem.php';

function pathEcosystemTestThrows(callable $callback, string $why): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    fwrite(STDERR, "FAIL: expected an InvalidArgumentException -- {$why}\n");
    exit(1);
}

// ---- path rows -------------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('path', [
    ['path' => 'p-1', 'area' => 'a-1', 'basis' => 0, 'seq' => 0, 'enter' => 3.2812, 'exit' => 3.6789],
    ['path' => 'p-1', 'area' => 'a-1', 'basis' => 1, 'seq' => 0, 'enter' => 3.3, 'exit' => 3.7],
]);
assert(count($rows) === 2);
assert($rows[0]['basis'] === 0 && $rows[1]['basis'] === 1);
assert(abs($rows[0]['enter'] - 3.2812) < 1e-9);

// basis is 0 or 1 -- nothing else. A third value would silently create a key nobody reads.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 2, 'seq' => 0, 'enter' => 0, 'exit' => 1]]),
    'basis must be 0 or 1'
);

// exit before enter is not a rounding artefact, it is a broken row.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 0, 'enter' => 5, 'exit' => 4]]),
    'exit must not precede enter'
);

// seq is a TINYINT. 255 intervals for one pair is a data anomaly, not something to truncate.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('path', [['path' => 'p', 'area' => 'a', 'basis' => 0, 'seq' => 256, 'enter' => 0, 'exit' => 1]]),
    'seq must fit a TINYINT'
);

// ---- overlap rows ----------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-2', 'share' => 0.62]]);
assert(count($rows) === 1 && abs($rows[0]['share'] - 0.62) < 1e-9);

// A share outside [0,1] means the caller measured against the wrong total.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-2', 'share' => 1.4]]),
    'share must be a fraction'
);

// A region cannot overlap itself -- that pair would be 100 % for every region and mean nothing.
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('overlap', [['region' => 'r-1', 'other' => 'r-1', 'share' => 0.5]]),
    'a region may not overlap itself'
);

// ---- territory rows --------------------------------------------------------------------------
$rows = avesmapsPathEcosystemNormalizeRows('territory', [
    ['region' => 'r-1', 'territory' => 't-1', 'share' => 0.5, 'aggregate' => true],
]);
assert($rows[0]['is_aggregate'] === 1, 'aggregate travels as 0/1');

// ---- the empty run IS a result ---------------------------------------------------------------
assert(avesmapsPathEcosystemNormalizeRows('path', []) === [], 'an empty chunk is legal, not an error');

// ---- unknown kind ----------------------------------------------------------------------------
pathEcosystemTestThrows(
    static fn() => avesmapsPathEcosystemNormalizeRows('nonsense', []),
    'kind must be path, overlap or territory'
);

// ---- the token guard -------------------------------------------------------------------------
assert(avesmapsPathEcosystemTokenMatches('abc', 'abc') === true);
assert(avesmapsPathEcosystemTokenMatches('abc', 'def') === false);
assert(avesmapsPathEcosystemTokenMatches(null, 'abc') === false, 'no run in flight -> no chunk accepted');
assert(avesmapsPathEcosystemTokenMatches('abc', '') === false, 'an empty token never matches');

echo "path-ecosystem: alle Prüfungen bestanden\n";
```

- [ ] **Schritt 2: Test laufen lassen — er MUSS scheitern**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-ecosystem-test.php
```

Erwartet: `Failed opening required '.../path-ecosystem.php'`.

- [ ] **Schritt 3: Die reine Hälfte schreiben**

`api/_internal/app/path-ecosystem.php`, Kopf und reine Funktionen:

```php
<?php

declare(strict_types=1);

// V9: the store behind the Landschaften editor's "Zugehörigkeit rechnen" button. The BROWSER
// computes (spec 2026-07-29); this file only takes the result, in chunks, and stamps the run.
//
// PURITY CONTRACT (mirrors autoget-run.php): side-effect-free on include -- only const and function
// definitions, no DB connect, no headers. The offline-decidable half (row normalisation, the token
// guard) is pure and unit-tested; the DB touches take a PDO explicitly.

require_once __DIR__ . '/ecosystem.php';
require_once __DIR__ . '/app-setting.php';

// The in-flight run token. app_setting, not a column: it is one string that outlives no request and
// belongs to no row.
const AVESMAPS_PATH_ECOSYSTEM_RUN_SETTING = 'path_ecosystem_run_token';

// Rows per chunk the client may send. Not a limit the server enforces for correctness -- the client
// slices -- but a ceiling that keeps one request small however large the stock grows.
const AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX = 2000;

/**
 * PURE: does the chunk carry the token of the run currently in flight?
 *
 * 💣 This is what a GET_LOCK cannot do here. A connection-scoped lock dies with its request, and a
 * run spans many -- the same reason dump-lock.php keeps a DB row instead. Two editors computing at
 * once would otherwise interleave their chunks into one nonsensical result. The second
 * `assignment_begin` wins the token; the first one's next chunk gets a clean 409.
 */
function avesmapsPathEcosystemTokenMatches(?string $current, string $offered): bool
{
    return $current !== null && $current !== '' && $offered !== '' && hash_equals($current, $offered);
}

/**
 * PURE: validate and normalise one chunk's rows. Throws InvalidArgumentException on anything a
 * correct client cannot have produced -- a wrong `basis`, an inverted interval, a share outside
 * [0,1] -- because silently storing it would make a wrong answer look like a computed one.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsPathEcosystemNormalizeRows(string $kind, mixed $rows): array
{
    if (!in_array($kind, ['path', 'overlap', 'territory'], true)) {
        throw new InvalidArgumentException('kind must be path, overlap or territory.');
    }
    if ($rows === null || $rows === '') {
        return [];
    }
    if (!is_array($rows)) {
        throw new InvalidArgumentException('rows must be a list.');
    }
    if (count($rows) > AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX) {
        throw new InvalidArgumentException('A chunk carries at most ' . AVESMAPS_PATH_ECOSYSTEM_CHUNK_MAX . ' rows.');
    }

    $readId = static function (mixed $value, string $field): string {
        $id = trim((string) $value);
        if ($id === '' || strlen($id) > 36) {
            throw new InvalidArgumentException($field . ' must be a public id.');
        }
        return $id;
    };
    $readShare = static function (mixed $value): float {
        $share = filter_var($value, FILTER_VALIDATE_FLOAT);
        if ($share === false || $share < 0.0 || $share > 1.0) {
            throw new InvalidArgumentException('share must be a fraction between 0 and 1.');
        }
        return (float) $share;
    };

    $normalized = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            throw new InvalidArgumentException('Every row must be an object.');
        }
        if ($kind === 'path') {
            $basis = filter_var($row['basis'] ?? null, FILTER_VALIDATE_INT);
            if ($basis !== 0 && $basis !== 1) {
                throw new InvalidArgumentException('basis must be 0 (chord) or 1 (curve).');
            }
            $seq = filter_var($row['seq'] ?? null, FILTER_VALIDATE_INT);
            // 💣 Not truncated. More than 255 crossings of one area by one way is a broken geometry,
            // and cutting it off would store a plausible-looking half answer.
            if ($seq === false || $seq < 0 || $seq > 255) {
                throw new InvalidArgumentException('seq must be between 0 and 255.');
            }
            $enter = filter_var($row['enter'] ?? null, FILTER_VALIDATE_FLOAT);
            $exit = filter_var($row['exit'] ?? null, FILTER_VALIDATE_FLOAT);
            if ($enter === false || $exit === false || $enter < 0.0 || $exit < $enter) {
                throw new InvalidArgumentException('enter and exit must be arc lengths with exit >= enter.');
            }
            $normalized[] = [
                'path' => $readId($row['path'] ?? null, 'path'),
                'area' => $readId($row['area'] ?? null, 'area'),
                'basis' => (int) $basis,
                'seq' => (int) $seq,
                'enter' => (float) $enter,
                'exit' => (float) $exit,
            ];
            continue;
        }
        if ($kind === 'overlap') {
            $region = $readId($row['region'] ?? null, 'region');
            $other = $readId($row['other'] ?? null, 'other');
            if ($region === $other) {
                throw new InvalidArgumentException('A region cannot overlap itself.');
            }
            $normalized[] = ['region' => $region, 'other' => $other, 'share' => $readShare($row['share'] ?? null)];
            continue;
        }
        $normalized[] = [
            'region' => $readId($row['region'] ?? null, 'region'),
            'territory' => $readId($row['territory'] ?? null, 'territory'),
            'share' => $readShare($row['share'] ?? null),
            'is_aggregate' => !empty($row['aggregate']) ? 1 : 0,
        ];
    }

    return $normalized;
}
```

- [ ] **Schritt 4: Test laufen lassen — er MUSS bestehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-ecosystem-test.php
```

Erwartet: `path-ecosystem: alle Prüfungen bestanden`.

- [ ] **Schritt 5: Commit des reinen Teils**

```bash
git commit --only -m "feat(ecosystem): validate an assignment chunk before it can look computed" -- api/_internal/app/path-ecosystem.php api/_internal/app/__tests__/path-ecosystem-test.php
```

- [ ] **Schritt 6: Die DB-Hälfte anhängen**

An dieselbe Datei:

```php
// ---- the run --------------------------------------------------------------------------------
// 💣 NO avesmapsEcosystemEnsureTables ANYWHERE BELOW. Two reasons, both real: its information_schema
// probes are exactly the load of the pool incident of 2026-07-17, and DDL inside a transaction
// commits it silently -- an ALTER in the middle of a chunk would end the transaction the chunk is
// relying on. The tables come into being on the area read/write paths, which run long before anyone
// presses the button.

function avesmapsPathEcosystemBegin(PDO $pdo, int $userId): array
{
    $runToken = avesmapsGenerateUuid();

    $pdo->beginTransaction();
    try {
        // The previous result goes as a whole. A run replaces, it never merges: half of yesterday's
        // answer beside half of today's would be indistinguishable from a complete one.
        $pdo->exec('DELETE FROM path_ecosystem');
        $pdo->exec('DELETE FROM ecosystem_region_overlap');
        $pdo->exec('DELETE FROM ecosystem_region_territory');
        $statement = $pdo->prepare(
            'INSERT INTO ecosystem_assignment_stamp
                 (id, ecosystem_revision, map_revision, area_count, path_count, overlap_rows,
                  territory_rows, path_rows_chord, path_rows_curve, duration_ms, run_token, completed, computed_by)
             VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0, :token, 0, :user)
             ON DUPLICATE KEY UPDATE run_token = VALUES(run_token), completed = 0,
                                     computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
        );
        $statement->execute(['token' => $runToken, 'user' => $userId > 0 ? $userId : null]);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['run_token' => $runToken];
}

function avesmapsPathEcosystemCurrentToken(PDO $pdo): ?string
{
    $statement = $pdo->query('SELECT run_token FROM ecosystem_assignment_stamp WHERE id = 1');
    $token = $statement !== false ? $statement->fetchColumn() : false;

    return ($token === false || $token === null) ? null : (string) $token;
}

/**
 * One chunk. Rows whose public_id no longer resolves are DROPPED AND COUNTED, never thrown: between
 * computing and saving an editor in another window may have deleted a way or an area, and losing the
 * other 1.999 rows over it would be the wrong trade.
 */
function avesmapsPathEcosystemChunk(PDO $pdo, array $payload): array
{
    $kind = avesmapsNormalizeSingleLine((string) ($payload['kind'] ?? ''), 16);
    $rows = avesmapsPathEcosystemNormalizeRows($kind, $payload['rows'] ?? []);
    $offered = trim((string) ($payload['run_token'] ?? ''));
    if (!avesmapsPathEcosystemTokenMatches(avesmapsPathEcosystemCurrentToken($pdo), $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another assignment run has started. Start over.');
    }
    if ($rows === []) {
        return ['written' => 0, 'skipped' => 0];
    }

    $written = 0;
    $skipped = 0;
    $pdo->beginTransaction();
    try {
        if ($kind === 'path') {
            $pathIds = avesmapsPathEcosystemIdMap($pdo, 'map_features', array_column($rows, 'path'), "feature_type = 'path' AND is_active = 1");
            $areaIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_area', array_column($rows, 'area'), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO path_ecosystem (path_id, area_id, basis, seq, enter_distance_mapunits, exit_distance_mapunits)
                 VALUES (:path, :area, :basis, :seq, :enter, :exit)
                 ON DUPLICATE KEY UPDATE enter_distance_mapunits = VALUES(enter_distance_mapunits),
                                         exit_distance_mapunits = VALUES(exit_distance_mapunits)'
            );
            foreach ($rows as $row) {
                if (!isset($pathIds[$row['path']], $areaIds[$row['area']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute([
                    'path' => $pathIds[$row['path']],
                    'area' => $areaIds[$row['area']],
                    'basis' => $row['basis'],
                    'seq' => $row['seq'],
                    'enter' => $row['enter'],
                    'exit' => $row['exit'],
                ]);
                $written++;
            }
        } elseif ($kind === 'overlap') {
            $regionIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_region', array_merge(array_column($rows, 'region'), array_column($rows, 'other')), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO ecosystem_region_overlap (region_id, other_region_id, share) VALUES (:region, :other, :share)
                 ON DUPLICATE KEY UPDATE share = VALUES(share)'
            );
            foreach ($rows as $row) {
                if (!isset($regionIds[$row['region']], $regionIds[$row['other']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute(['region' => $regionIds[$row['region']], 'other' => $regionIds[$row['other']], 'share' => $row['share']]);
                $written++;
            }
        } else {
            $regionIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_region', array_column($rows, 'region'), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO ecosystem_region_territory (region_id, territory_public_id, share, is_aggregate)
                 VALUES (:region, :territory, :share, :aggregate)
                 ON DUPLICATE KEY UPDATE share = VALUES(share), is_aggregate = VALUES(is_aggregate)'
            );
            foreach ($rows as $row) {
                if (!isset($regionIds[$row['region']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute([
                    'region' => $regionIds[$row['region']],
                    'territory' => $row['territory'],
                    'share' => $row['share'],
                    'aggregate' => $row['is_aggregate'],
                ]);
                $written++;
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['written' => $written, 'skipped' => $skipped];
}

/** public_id -> internal id, for the public_ids of ONE chunk. */
function avesmapsPathEcosystemIdMap(PDO $pdo, string $table, array $publicIds, string $where): array
{
    $unique = array_values(array_unique(array_filter($publicIds, static fn($id) => $id !== '')));
    if ($unique === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($unique), '?'));
    $statement = $pdo->prepare("SELECT id, public_id FROM {$table} WHERE {$where} AND public_id IN ({$placeholders})");
    $statement->execute($unique);

    $map = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $map[(string) $row['public_id']] = (int) $row['id'];
    }

    return $map;
}

function avesmapsPathEcosystemCommit(PDO $pdo, array $payload, int $userId): array
{
    $offered = trim((string) ($payload['run_token'] ?? ''));
    if (!avesmapsPathEcosystemTokenMatches(avesmapsPathEcosystemCurrentToken($pdo), $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another assignment run has started. Start over.');
    }

    $count = static fn(string $sql): int => (int) $pdo->query($sql)->fetchColumn();
    $statement = $pdo->prepare(
        'UPDATE ecosystem_assignment_stamp
            SET ecosystem_revision = :eco, map_revision = :map, area_count = :areas, path_count = :paths,
                overlap_rows = :overlap, territory_rows = :territory,
                path_rows_chord = :chord, path_rows_curve = :curve,
                duration_ms = :duration, completed = 1, computed_by = :user, computed_at = CURRENT_TIMESTAMP(3)
          WHERE id = 1'
    );
    $statement->execute([
        'eco' => avesmapsReadEcosystemRevision($pdo),
        'map' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        'areas' => max(0, (int) ($payload['area_count'] ?? 0)),
        'paths' => max(0, (int) ($payload['path_count'] ?? 0)),
        'overlap' => $count('SELECT COUNT(*) FROM ecosystem_region_overlap'),
        'territory' => $count('SELECT COUNT(*) FROM ecosystem_region_territory'),
        'chord' => $count('SELECT COUNT(*) FROM path_ecosystem WHERE basis = 0'),
        'curve' => $count('SELECT COUNT(*) FROM path_ecosystem WHERE basis = 1'),
        'duration' => max(0, (int) ($payload['duration_ms'] ?? 0)),
        'user' => $userId > 0 ? $userId : null,
    ]);

    return avesmapsPathEcosystemStatus($pdo);
}

/**
 * The stamp plus the CURRENT revisions, so the button can say "veraltet" without a second request.
 * A run that never committed comes back with completed = false -- readable as "incomplete", which is
 * a different thing from "empty".
 */
function avesmapsPathEcosystemStatus(PDO $pdo): array
{
    $statement = $pdo->query('SELECT * FROM ecosystem_assignment_stamp WHERE id = 1');
    $stamp = $statement !== false ? $statement->fetch(PDO::FETCH_ASSOC) : false;

    return [
        'stamp' => $stamp === false ? null : [
            'ecosystem_revision' => (int) $stamp['ecosystem_revision'],
            'map_revision' => (int) $stamp['map_revision'],
            'area_count' => (int) $stamp['area_count'],
            'path_count' => (int) $stamp['path_count'],
            'overlap_rows' => (int) $stamp['overlap_rows'],
            'territory_rows' => (int) $stamp['territory_rows'],
            'path_rows_chord' => (int) $stamp['path_rows_chord'],
            'path_rows_curve' => (int) $stamp['path_rows_curve'],
            'duration_ms' => (int) $stamp['duration_ms'],
            'completed' => (int) $stamp['completed'] === 1,
            'computed_at' => (string) $stamp['computed_at'],
        ],
        'current' => [
            'ecosystem_revision' => avesmapsReadEcosystemRevision($pdo),
            'map_revision' => (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0),
        ],
    ];
}
```

- [ ] **Schritt 7: `avesmapsGenerateUuid` überprüfen, nicht annehmen**

```bash
grep -rn "function avesmapsGenerateUuid\|function avesmapsUuid" api/_internal/ | head -3
```

Gibt es die Funktion **nicht** unter diesem Namen, den tatsächlichen Namen einsetzen —
**keine eigene UUID-Erzeugung schreiben**.

- [ ] **Schritt 8: Die vier Aktionen im Verteiler eintragen**

In `api/edit/map/ecosystem.php` oben:

```php
require_once __DIR__ . '/../../_internal/app/path-ecosystem.php';
```

und im `match ($action)` vor `default`:

```php
        // V9: the "Zugehörigkeit rechnen" result. The BROWSER computes; these four take it in.
        // begin clears and hands out a run token, chunk appends under that token, commit stamps.
        // A second editor's begin wins the token and the first one's next chunk gets 409 -- see
        // avesmapsPathEcosystemTokenMatches for why a GET_LOCK cannot do this job.
        'assignment_begin' => avesmapsPathEcosystemBegin($pdo, $userId),
        'assignment_chunk' => avesmapsPathEcosystemChunk($pdo, $payload),
        'assignment_commit' => avesmapsPathEcosystemCommit($pdo, $payload, $userId),
        'assignment_status' => avesmapsPathEcosystemStatus($pdo),
```

- [ ] **Schritt 9: Syntax prüfen und Test erneut laufen lassen**

```bash
php -l api/_internal/app/path-ecosystem.php && php -l api/edit/map/ecosystem.php && php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/path-ecosystem-test.php
```

Erwartet: zweimal `No syntax errors detected`, dann `alle Prüfungen bestanden`.

- [ ] **Schritt 10: Commit**

```bash
git commit --only -m "feat(ecosystem): take the assignment result in chunks under a run token" -- api/_internal/app/path-ecosystem.php api/edit/map/ecosystem.php
```

---

## Task 6: Der Knopf rechnet Teil C — und sagt, wie lange es gedauert hat

Dieser Task **speichert noch nicht**. Er liefert genau das, wonach der Auftrag verlangt:
die Messung.

**Files:**
- Modify: `html/landschaften-editor.html` (`runRaycast` und Umfeld)

**Interfaces:**
- Consumes: `ecosystemAreaEdges`, `ecosystemLineBounds`, `ecosystemLineIntervals` (Task 2),
  `getCatmullRomSplineCoordinates` (Task 1), `GET /api/edit/map/paths-geometry.php` (Task 4).
- Produces: `computePathAssignments(areas, paths, onProgress)` →
  `{ rows: [{path, area, basis, seq, enter, exit}], stats: {chordMs, curveMs, chordRows, curveRows} }`

- [ ] **Schritt 1: Die Wege laden**

Neben `loadAreas()`:

```js
const PATHS_API = "/api/edit/map/paths-geometry.php";

let allPaths = null;         // null = never loaded
let mapRevision = null;

// Only behind the explicit click, at most once per session -- the same rule the political-layer fan
// already lives under here. ~1,5 MB against the 17,79 MB of the full map payload.
async function loadPaths() {
	const response = await fetch(PATHS_API, { credentials: "same-origin", headers: { Accept: "application/json" } });
	const data = await response.json();
	if (!response.ok || data.ok === false) {
		throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
	}
	mapRevision = Number(data.map_revision || 0);
	return Array.isArray(data.paths) ? data.paths : [];
}
```

- [ ] **Schritt 2: Den Durchgang schreiben**

```js
// 💣 Yield to the main thread every so many ways. A 30 s uninterrupted loop freezes the tab and
// Chrome offers "page unresponsive" -- and without the yield the progress counter never paints.
const PATH_ASSIGN_YIELD_EVERY = 200;

// The drawn curve strays up to ~2,12 map units from the chord, so its bounding box is NOT the way's
// bounding box. Reusing the raw one for the curve pass drops exactly the pairs only the curve hits
// (measured: 4). The margin is free -- the smoothed list is already built.
function boundsOfList(list) { return ecosystemLineBounds(list); }

async function computePathAssignments(areas, paths, onProgress) {
	// Prepare each participating area ONCE: its edges and its bounds. Doing this per way would
	// rebuild 31.797 edges 5.650 times.
	const prepared = areas
		.filter((area) => area.affects_paths !== false)
		.map((area) => ({
			publicId: String(area.public_id),
			bounds: area.bounds,
			edges: ecosystemAreaEdges(area.geometry),
		}))
		.filter((area) => area.edges.length > 0);

	const rows = [];
	const stats = { chordMs: 0, curveMs: 0, chordRows: 0, curveRows: 0, areas: prepared.length, paths: paths.length };

	const pass = (coordinates, bounds, pathId, basis) => {
		let written = 0;
		for (let index = 0; index < prepared.length; index += 1) {
			const area = prepared[index];
			if (bounds.min_x > area.bounds.max_x || bounds.max_x < area.bounds.min_x) { continue; }
			if (bounds.min_y > area.bounds.max_y || bounds.max_y < area.bounds.min_y) { continue; }
			const intervals = ecosystemLineIntervals(coordinates, area.edges);
			for (let seq = 0; seq < intervals.length && seq < 256; seq += 1) {
				rows.push({
					path: pathId, area: area.publicId, basis, seq,
					enter: intervals[seq].enter, exit: intervals[seq].exit,
				});
				written += 1;
			}
		}
		return written;
	};

	for (let index = 0; index < paths.length; index += 1) {
		const path = paths[index];
		const coordinates = path.geometry && path.geometry.coordinates;
		if (!Array.isArray(coordinates) || coordinates.length < 2) { continue; }

		let started = performance.now();
		stats.chordRows += pass(coordinates, path.bounds, path.public_id, 0);
		stats.chordMs += performance.now() - started;

		const smoothed = coordinates.length >= 3 ? getCatmullRomSplineCoordinates(coordinates) : coordinates;
		started = performance.now();
		stats.curveRows += pass(smoothed, boundsOfList(smoothed), path.public_id, 1);
		stats.curveMs += performance.now() - started;

		if (index % PATH_ASSIGN_YIELD_EVERY === 0) {
			if (onProgress) { onProgress(index, paths.length); }
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	return { rows, stats };
}
```

- [ ] **Schritt 3: In `runRaycast` einhängen**

Nach dem vorhandenen `computeRaycast`/`computeTerritoryHits`-Block, im `else`-Zweig:

```js
			if (allPaths === null) {
				setStatus("Wege werden geladen …");
				allPaths = await loadPaths();
			}
			setStatus("Wege × Flächen wird gerechnet …");
			pathAssignments = await computePathAssignments(allAreas, allPaths, (done, total) => {
				setStatus("Wege × Flächen … " + done + "/" + total);
			});
```

und die Meldung erweitern:

```js
			flashStatus("Gerechnet: " + raycastNote
				+ (territoryNote ? " · " + territoryNote : "")
				+ " · Wege: " + pathAssignments.stats.chordRows + " Sehne / " + pathAssignments.stats.curveRows + " Kurve"
				+ " (" + Math.round(pathAssignments.stats.chordMs) + " ms + " + Math.round(pathAssignments.stats.curveMs) + " ms)", "ok");
```

Dazu oben `let pathAssignments = null;` neben den übrigen Zustandsvariablen.

- [ ] **Schritt 4: Im Browser messen**

Vorschau starten (Task 7 Schritt 1 beschreibt den Server), Editor öffnen, Knopf drücken.
Die Meldung nennt Zeilenzahlen und Millisekunden **je Bezug**.

Erwartet nach den Offline-Messungen: Sehne ~4.400 Zeilen, Kurve ~4.400 Zeilen,
zusammen unter 30 s.

> 🔴 **Geht es über 30 s, hier anhalten und den Owner fragen.** Dann fällt zuerst der
> Kurven-Durchgang (`basis=1`), nicht der ganze Lauf — die Spec §5.2 sagt, warum und was
> stattdessen gilt. Nicht eigenmächtig optimieren, bevor die Zahl bekannt ist.

- [ ] **Schritt 5: Commit**

```bash
git commit --only -m "feat(ecosystem): the assignment button also works out which ways run through which areas" -- html/landschaften-editor.html
```

---

## Task 7: Speichern, Stand anzeigen, Abnahme

**Files:**
- Modify: `html/landschaften-editor.html`

**Interfaces:**
- Consumes: `postEcosystemEdit(action, payload)` (vorhanden, aus dem Elternfenster),
  die vier Aktionen aus Task 5, `computePathAssignments` aus Task 6.

- [ ] **Schritt 1: Vorschau-Server starten**

`.claude/launch.json` anlegen oder ergänzen, dann über das Vorschau-Werkzeug starten —
**niemals einen Server über die Shell starten**. Der Editor ist ohne Anmeldung über
`?edit=1` erreichbar; das Speichern braucht eine angemeldete Sitzung.

- [ ] **Schritt 2: Die Speicher-Schleife schreiben**

```js
// Chunked on purpose: today the three results are ~250 KB together, at the drawn-out stock they are
// over a megabyte. Slicing keeps every single request small however far the map grows -- and it is
// the reason there is no server-side batch machinery at all.
const ASSIGNMENT_CHUNK = 2000;

async function saveAssignments(pathRows, overlapRows, territoryRows, durationMs, onProgress) {
	const begun = await postEcosystemEdit("assignment_begin", {});
	const runToken = String(begun.run_token || "");
	if (runToken === "") { throw new Error("Der Server hat kein Lauf-Kennzeichen geliefert."); }

	const batches = [];
	const slice = (kind, rows) => {
		for (let index = 0; index < rows.length; index += ASSIGNMENT_CHUNK) {
			batches.push({ kind, rows: rows.slice(index, index + ASSIGNMENT_CHUNK) });
		}
	};
	slice("overlap", overlapRows);
	slice("territory", territoryRows);
	slice("path", pathRows);

	let skipped = 0;
	for (let index = 0; index < batches.length; index += 1) {
		if (onProgress) { onProgress(index + 1, batches.length); }
		const result = await postEcosystemEdit("assignment_chunk", {
			run_token: runToken, kind: batches[index].kind, rows: batches[index].rows,
		});
		skipped += Number(result.skipped || 0);
	}

	// 💣 Even with nothing to write the commit MUST run: the stamp is what says "computed", and an
	// empty result is a result. Without it the next open would report "noch nicht gerechnet".
	const status = await postEcosystemEdit("assignment_commit", {
		run_token: runToken,
		duration_ms: Math.round(durationMs),
		area_count: (allAreas || []).length,
		path_count: (allPaths || []).length,
	});
	return { status, skipped, batches: batches.length };
}
```

- [ ] **Schritt 3: Die drei Ergebnisse in Zeilen übersetzen**

```js
// The two existing raycasts keep their in-memory shape; this only projects them onto the wire
// format. `raycast` holds every pair twice already (a -> b and b -> a), which is exactly what
// ecosystem_region_overlap stores -- a reader always asks "what lies in THIS region".
function overlapRowsFromRaycast() {
	const rows = [];
	(raycast || new Map()).forEach((hits, regionId) => {
		hits.forEach((hit) => rows.push({ region: regionId, other: hit.regionId, share: hit.share }));
	});
	return rows;
}

function territoryRowsFromHits() {
	const rows = [];
	(territoryHits || new Map()).forEach((hits, regionId) => {
		hits.forEach((hit) => rows.push({
			region: regionId, territory: hit.territory.publicId,
			share: hit.share, aggregate: hit.territory.isAggregate === true,
		}));
	});
	return rows;
}
```

- [ ] **Schritt 4: Den Knopf abschließen lassen**

Im `else`-Zweig von `runRaycast`, nach der Rechnung:

```js
			setStatus("Wird gespeichert …");
			const saved = await saveAssignments(
				pathAssignments.rows, overlapRowsFromRaycast(), territoryRowsFromHits(),
				pathAssignments.stats.chordMs + pathAssignments.stats.curveMs,
				(done, total) => setStatus("Speichert … " + done + "/" + total)
			);
			assignmentStamp = saved.status;
			if (saved.skipped > 0) {
				flashStatus(saved.skipped + " Zeilen verworfen — ihr Ort oder ihre Fläche existiert nicht mehr.", "warn");
			}
```

- [ ] **Schritt 5: Den Stand IN den Knopf schreiben**

```js
// The tile IS the state display (house rule). „veraltet" is a comparison, never a guess: the stamp
// carries the revisions it was computed against, and the status action returns the current ones.
function renderAssignmentTile() {
	const info = $("ecoRaycastInfo");
	const stamp = assignmentStamp && assignmentStamp.stamp;
	if (!stamp || !stamp.completed) {
		info.textContent = stamp ? "unvollständig — bitte neu rechnen" : "noch nicht gerechnet";
		return;
	}
	const current = assignmentStamp.current || {};
	const stale = stamp.ecosystem_revision !== current.ecosystem_revision
		|| stamp.map_revision !== current.map_revision;
	const rows = stamp.path_rows_chord + stamp.path_rows_curve;
	const seconds = (stamp.duration_ms / 1000).toFixed(1).replace(".", ",");
	info.textContent = stale
		? "gerechnet " + stamp.computed_at.slice(11, 16) + " · Stand veraltet"
		: rows + " Wegabschnitte · " + seconds + " s";
}
```

Aufgerufen am Ende von `runRaycast` und beim Öffnen des Editors, dort nach

```js
	assignmentStamp = await postEcosystemEdit("assignment_status", {});
	renderAssignmentTile();
```

- [ ] **Schritt 6: Den Tooltip des Knopfes berichtigen**

Er behauptet heute „Gerechnet, nie gespeichert." Das stimmt nicht mehr:

```
title="Rechnet, welche Flächen ineinander liegen, in welchem Territorium sie liegen und welche Wege durch sie führen — und speichert das Ergebnis. Anteil an der KLEINEREN der beiden Flächen, Schwelle 10 %."
```

Ebenso den Kommentar bei `computeRaycast` („NEVER stored") auf den neuen Stand bringen
und auf die Spec verweisen.

- [ ] **Schritt 7: Im Browser prüfen**

Knopf drücken, dann:

```js
await postEcosystemEdit("assignment_status", {})
```

in der Konsole des Editor-Fensters. Erwartet: `completed: true`,
`path_rows_chord` ≈ 4.400, `path_rows_curve` ≈ 4.400, `duration_ms` > 0.
Danach den Editor neu öffnen — die Kachel muss den Stand **ohne** neue Rechnung zeigen.

- [ ] **Schritt 8: Gegen die Offline-Messung abgleichen**

Die Zeilenzahlen gegen die Spec §8.2 halten (`4.426` / `4.407` beim Stand vom
2026-07-29). Weichen sie um mehr als ±5 % ab, **nicht** weiterbauen, sondern die
Nutzlast neu ziehen und offline nachrechnen — eine Abweichung heißt, dass eine Annahme
nicht stimmt, nicht dass der Bestand gewachsen ist.

- [ ] **Schritt 9: Commit**

```bash
git commit --only -m "feat(ecosystem): the assignment run is stored and the tile says when it was computed" -- html/landschaften-editor.html
```

- [ ] **Schritt 10: 🔧 DU (Owner) — Abnahme**

1. Editor öffnen, „Zugehörigkeit rechnen" drücken.
2. **Die Zahl in der Kachel notieren** — das ist die Antwort auf „wie lang dauert das".
3. Editor schließen und neu öffnen: der Stand steht ohne Rechnung da.
4. Eine Fläche verschieben und speichern, Editor neu öffnen: die Kachel sagt
   **„Stand veraltet"**.

---

## Selbstprüfung

**Abdeckung der Spec.** §4.1 `path_ecosystem` + `basis` → Task 3 · §4.2/§4.3 die beiden
Zuordnungstabellen → Task 3 · §4.4 Stempel → Task 3, geschrieben in Task 5 · §4.5
`affects_paths` → Task 3 · §5.1–5.4 Rechenkern, halboffene Regel, Entartungen → Task 2 ·
§5.2 zweiter Bezug + Kurve → Task 1 (eine Umsetzung) und Task 6 (zweiter Durchgang) ·
§6.1 Weg-Geometrie → Task 4 · §6.2 Token, Stückelung, Auflösung → Task 5 · §6.3
Idempotenz → Task 5 (`begin` leert, `ON DUPLICATE KEY UPDATE`) · §7 Knopf und Stand →
Task 6/7 · §8.1 Tests → Task 1/2/5 · §8.2 Abnahme → Task 7 Schritt 8/10 · §8.3 Messung im
Browser → Task 6 Schritt 4.

**Nicht abgedeckt, absichtlich:** §9 Abgrenzung (V10/V11/V13), §9.0 Routensimulator,
§9.1 Idee #44 — alles ausdrücklich außerhalb von V9.

**Typ-Abgleich.** `ecosystemLineIntervals` liefert `{enter, exit}` (Task 2) und wird in
Task 6 genau so gelesen. `computePathAssignments` liefert `{rows, stats}`; Task 7 liest
`pathAssignments.rows` und `stats.chordMs`/`stats.curveMs` — beide in Task 6 definiert.
`postEcosystemEdit` heißt in beiden Tasks gleich und existiert bereits.
`avesmapsPathEcosystemNormalizeRows` nimmt `('path'|'overlap'|'territory', array)` und
liefert Zeilen mit den Schlüsseln, die `avesmapsPathEcosystemChunk` liest.

**Offene Unsicherheit, bewusst als Schritt statt als Annahme:** der genaue Name der
UUID-Funktion (Task 5 Schritt 7) und die genaue Form des Typ-Joins in
`avesmapsEcosystemReadAreas` (Task 3 Schritt 3) werden im Code nachgesehen, nicht geraten.
