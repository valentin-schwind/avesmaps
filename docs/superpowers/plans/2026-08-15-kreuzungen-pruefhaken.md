# Prüfhaken „Kreuzungen mit 2 Wegen" — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der türkise Prüfhaken markiert nur noch auflösbare Durchgangsknoten (`----X----` → `----------`) — 95 statt 921 — und jede Kreuzung bekommt einen Knopf, der ihre Adresse kopierbar macht.

**Architecture:** Der Konnektivitätsgraph des Prüfhakens lernt den round-5-Split, den der Live-Router längst kann; danach entscheidet eine Drei-Regel-Prüfung im geteilten `computeLocationConnectivityIndex`, welche Kreuzung den Ring trägt. Der Melden-Knopf ist eine weitere Kachel im vorhandenen Editor-Band und benutzt den vorhandenen Pin-Link-Bauer.

**Tech Stack:** Vanilla JS ohne Build (Browser-Globals, klassische `<script>`-Reihenfolge), Node-`assert` + `vm.runInThisContext` als Testharnisch, Leaflet 1.9.4.

**Entwurf:** `docs/superpowers/specs/2026-08-15-kreuzungen-pruefhaken-design.md` — bei jedem Widerspruch gewinnt der Entwurf.

## Global Constraints

- 🔴 **Der Split gehört AUSSCHLIESSLICH in den `graphOptions.transports === "all"`-Zweig** von `addRegularPathToGraph`. Der Routing-Zweig darunter wird nicht angefasst; dort wurde derselbe Split am 20.06.2026 wegen nicht-deterministischer Routen zurückgerollt (Revert `1f9e0b9e`).
- 🔴 **Nur die Beschriftung wird umbenannt, keine Kennung.** `toggleSparseCrossings`, `toggleSparseCrossingsControl`, `.location-visual-marker__shape--sparse-crossing` und `--color-marker-sparse-crossing-ring` bleiben. Einzige Ausnahme: die Konstante `SPARSE_CROSSING_MAX_WAYS` → `SPARSE_CROSSING_WAY_COUNT`.
- 💣 **Geteilter Arbeitsbaum — niemals `git add -A`, `git add .` oder `git commit -a`.** Es laufen weitere Sitzungen in diesem Checkout. Immer nur die im Task genannten Pfade einzeln stagen.
- 💣 **`git add <pfad>` staged die GANZE Datei, auch fremde Zeilen darin.** Vor jedem Commit `git status --porcelain` lesen: steht eine Datei dieses Tasks dort mit ` M` aus fremder Hand, wird sie NICHT angefasst (siehe Task 5, Vorbedingung).
- 💣 **Kein `?v=` von Hand** irgendwo (AGENTS.md §7). Der Deploy stempelt.
- 💣 **Vor dem Push das GANZE Testfeld**, nicht nur die eigenen Tests: ein roter Test lädt nichts hoch, und der Fehlschlag vergiftet danach den `?v=`-Stempel.
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
  ```
- ⚠️ Deutsche Oberflächentexte bleiben deutsch; Kommentare und Commit-Rümpfe in der Sprache der Umgebung (dieses Repo schreibt deutsch).
- ⚠️ Windows/CRLF: bei Änderungen an bestehenden Dateien einzeilige Edits bevorzugen.

## Dateien

| Datei | Verantwortung nach dem Umbau |
|---|---|
| `js/routing/route-graph-routing.js` | Konnektivitätsgraph **mit** Split; Arm-Erhebung je Knoten; die drei Regeln; Segment-Gitter |
| `js/config.js` | `SPARSE_CROSSING_WAY_COUNT`, `SPARSE_CROSSING_OVERLAY_DISTANCE`, `SPARSE_CROSSING_SEGMENT_CELL` |
| `index.html` | Beschriftung der Menüzeile |
| `js/map-features/map-features-location-marker-rendering.js` | nur Kommentar (beschreibt heute die alte Regel) |
| `js/ui/popups.js` | Melden-Kachel im Kreuzungs-Band |
| `js/routing/routing.js` | Klick-Zweig `report-crossing` |
| `js/routing/__tests__/location-connectivity-index.test.js` | die drei Regeln + der Split, je Ausschlussgrund ein Fall |
| `js/ui/__tests__/popup-crossing-report.test.js` | **neu** — die Melden-Kachel |

---

### Task 1: Der Split im Konnektivitäts-Zweig

Ein Weg, der als innerer Stützpunkt durch eine Kreuzung läuft, gibt ihr künftig zwei Arme — genau wie beim Router. Das allein nimmt 182 Fehlalarme und 12 falsche „Unverbunden"-Ringe weg.

**Files:**
- Modify: `js/routing/route-graph-routing.js:111-130` (`addRegularPathToGraph`, nur der `transports === "all"`-Zweig) und `:172-180` (`createGraph`)
- Test: `js/routing/__tests__/location-connectivity-index.test.js`

**Interfaces:**
- Consumes: `locationData`, `pathData`, `addGraphConnection`, `normalizePathSubtype`, `getLocationAtPathEndpoint` (alle vorhandene Globals)
- Produces: `buildConnectivityCoordinateKey([x, y]) -> string`, `buildLocationCoordinateIndex() -> Map<string, location>`; `createGraph(routeOptions, {transports:"all"})` liefert für einen durchlaufenen Knoten ab jetzt Kanten statt Leere

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `js/routing/__tests__/location-connectivity-index.test.js` **ans Ende** (vor die `console.log`-Zeile) anfügen:

```js
// --- Der Split an aufliegenden Stuetzpunkten -----------------------------------------------------
// 💣 S1 liegt als INNERER Vertex auf dem Weg s-p (200,0)->(220,0). Der Router sieht dort einen
// vollwertigen Knoten (avesmapsAddClientCompatiblePathConnection splittet round-5), der Pruefhaken
// sah bis 2026-08-15 gar nichts -- und markierte die Kreuzung als "hat keine Wege".
locationData = [
	loc("Sa", 200, 0), crossing("S1", 210, 0), loc("Sb", 220, 0),
	loc("Ua", 300, 0), loc("Umitte", 310, 0), loc("Ub", 320, 0),
];
pathData = [
	{ geometry: { type: "LineString", coordinates: [[200, 0], [210, 0], [220, 0]] },
	  properties: { id: "sp", feature_subtype: "Weg" } },
	{ geometry: { type: "LineString", coordinates: [[300, 0], [310, 0], [320, 0]] },
	  properties: { id: "up", feature_subtype: "Weg" } },
];
powerlineData = [];
locationConnectivityIndex = null;

const splitGraph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
assert.strictEqual(countGraphNodePathEdges(splitGraph, "S1"), 2, "eine aufliegende Kreuzung hat ZWEI Arme, nicht null");
assert.deepStrictEqual(Object.keys(splitGraph.S1).sort(), ["Sa", "Sb"], "und sie fuehren zu beiden Seiten");
assert.strictEqual(countGraphNodePathEdges(splitGraph, "Sa"), 1, "der Weganfang behaelt seinen einen Arm");

// Und derselbe Split heilt den pinken Ring: ein ORT, der nur als Stuetzpunkt an einem Weg haengt,
// ist nicht unverbunden. Live waren das 12 von 182.
assert.strictEqual(getUnconnectedLocationPublicIds().has("pid-Umitte"), false, "ein aufliegender Ort haengt am Netz");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js
```

Erwartet: ROT mit `eine aufliegende Kreuzung hat ZWEI Arme, nicht null` — `0 !== 2`.

- [ ] **Step 3: Den Split bauen**

In `js/routing/route-graph-routing.js` **vor** `addRegularPathToGraph` einfügen:

```js
// Zwilling zu avesmapsAddClientCompatiblePathConnection (api/_internal/routing/client-graph.php):
// derselbe round-5-Schluessel, damit Pruefhaken und Router dieselben Knoten sehen. Eine andere
// Rundung hier waere eine zweite Wahrheit ueber denselben Punkt.
function buildConnectivityCoordinateKey([x, y]) {
	return `${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
}

// ⚠️ Bei round-5-Kollision gewinnt der letzte Ort. Live sind das 5 Punkte, auf denen jeweils
// mehrere Kreuzungen exakt uebereinander liegen -- fuer die Armzahl ist das gleichgueltig, weil
// koinzidente Knoten ohnehin denselben Weg tragen.
function buildLocationCoordinateIndex() {
	const index = new Map();
	locationData.forEach((location) => {
		if (!Array.isArray(location?.coordinates)) {
			return;
		}
		const [lat, lng] = location.coordinates;
		index.set(buildConnectivityCoordinateKey([lng, lat]), location);
	});
	return index;
}
```

Den `transports === "all"`-Zweig in `addRegularPathToGraph` ersetzen (der Kommentarblock darüber bleibt, die Kette darunter ebenfalls):

```js
	if (graphOptions.transports === "all") {
		const routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name);
		// 🔴 Knoten ENTLANG des Weges, nicht nur an seinen Enden: Start, jeder innere Stuetzpunkt,
		// der round-5 exakt auf einem Ort liegt, dann das Ende. Genau diese Bauform erzeugt der
		// Editor-Knopf „Ort verbinden und Strasse weiterfuehren" -- und sie war fuer den Pruefhaken
		// unsichtbar, waehrend der Router laengst dort abbiegt.
		const nodeNames = [startNode.name];
		const coordinateIndex = graphOptions.locationCoordinateIndex;
		if (coordinateIndex) {
			for (let index = 1; index < coordinates.length - 1; index++) {
				const hit = coordinateIndex.get(buildConnectivityCoordinateKey(coordinates[index]));
				if (hit) {
					nodeNames.push(hit.name);
				}
			}
		}
		nodeNames.push(endNode.name);
		for (let index = 1; index < nodeNames.length; index++) {
			// Teilkanten tragen „<pfad>#<n>", damit sie unterscheidbar bleiben; der Stamm vor dem
			// „#" ist die Weg-id und wird in Task 3 zurueckgelesen.
			const connection = {
				routeType,
				id: nodeNames.length > 2 ? `${properties.id}#${index}` : properties.id,
			};
			addGraphConnection(graph, nodeNames[index - 1], nodeNames[index], connection);
			addGraphConnection(graph, nodeNames[index], nodeNames[index - 1], connection);
		}
		return;
	}
```

In `createGraph` die `pathData.forEach`-Zeile ersetzen:

```js
	// Der Koordinaten-Index kostet nur den Konnektivitaets-Graphen etwas; der Routing-Zweig
	// bekommt ihn nicht und bleibt damit Zeile fuer Zeile der alte.
	const graphOptionsForPaths = graphOptions.transports === "all"
		? { ...graphOptions, locationCoordinateIndex: buildLocationCoordinateIndex() }
		: graphOptions;
	pathData.forEach((pathFeature) => {
		addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptionsForPaths);
	});
```

- [ ] **Step 4: Tests laufen lassen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js && node js/routing/__tests__/create-graph-connectivity.test.js
```

Erwartet: beide GRÜN. `create-graph-connectivity.test.js` benutzt nur Zwei-Punkt-Wege, hat also keine inneren Stützpunkte und ändert sich nicht.

> ⚠️ Die Zusicherung in Zeile 74 (`["pid-K0", "pid-K1", "pid-K2"]`) bleibt in diesem Task **grün** — der Split ändert an K0/K1/K2 nichts, weil auch dort nur Zwei-Punkt-Wege stehen. Sie fällt erst in Task 2.

- [ ] **Step 5: Committen**

```bash
git status --porcelain
git add js/routing/route-graph-routing.js js/routing/__tests__/location-connectivity-index.test.js
git commit -F - <<'EOF'
fix(pruefhaken): der Konnektivitaetsgraph lernt den Split, den der Router laengst kann

Ein Weg, der als innerer Stuetzpunkt durch eine Kreuzung laeuft, gab ihr im
Pruefhaken null Arme -- waehrend avesmapsAddClientCompatiblePathConnection dort
seit Juni round-5 splittet und der Router abbiegt. Derselbe Schluessel jetzt auch
hier, ausschliesslich im transports:"all"-Zweig; der Routing-Zweig bleibt
unberuehrt (Revert 1f9e0b9e, nicht-deterministische Routen).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Genau zwei Arme, und beide derselben Wegart

Regel 1 und Regel 3 des Entwurfs. Danach markiert der Haken 126 statt 921 (Regel 2 folgt in Task 3).

**Files:**
- Modify: `js/config.js:74-78`, `js/routing/route-graph-routing.js:192-231`
- Test: `js/routing/__tests__/location-connectivity-index.test.js`

**Interfaces:**
- Consumes: `buildLocationCoordinateIndex` (Task 1), `isCrossingLocation`, `getPowerlineConnectedLocationPublicIds`
- Produces: `collectGraphNodeArms(graph, nodeName) -> { count: number, routeTypes: Set<string>, pathIds: Set<string> }`; `countGraphNodePathEdges` bleibt als dünner Aufruf darüber erhalten; `SPARSE_CROSSING_WAY_COUNT = 2`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `js/routing/__tests__/location-connectivity-index.test.js` die Zeile 74 ersetzen —

```js
assert.deepStrictEqual([...sparse].sort(), ["pid-K0", "pid-K1", "pid-K2"], "crossings with <= 2 ways");
```

— durch:

```js
// 🔴 Seit 2026-08-15: GENAU zwei Arme. K0 (null) und K1 (einer) sind Sackgasse bzw. Datenleiche und
// gehoeren nicht mehr diesem Haken -- die 0-Arm-Faelle traegt der pinke „Unverbunden"-Ring.
assert.deepStrictEqual([...sparse].sort(), ["pid-K2"], "genau zwei Arme, sonst nichts");
assert.strictEqual(sparse.has("pid-K0"), false, "null Arme ist keine aufloesbare Kreuzung, sondern eine Leiche");
assert.strictEqual(sparse.has("pid-K1"), false, "ein Arm ist eine Sackgasse, kein Durchgangsknoten");
```

Und ans Ende (vor `console.log`) anfügen:

```js
// --- Regel 3: beide Arme derselben Wegart -------------------------------------------------------
// 💣 Ein Knoten, an dem Pfad in Strasse uebergeht, traegt Information -- `----------` gaebe es dort
// nicht, weil die zusammengelegte Linie eine Wegart verloere. Live sind das 31 von 126.
locationData = [
	crossing("Tgleich", 400, 0), loc("Tga", 401, 0), loc("Tgb", 402, 0),
	crossing("Twechsel", 410, 0), loc("Twa", 411, 0), loc("Twb", 412, 0),
];
pathData = [
	path_("tg1", "Weg", [400, 0], [401, 0]),
	path_("tg2", "Weg", [400, 0], [402, 0]),
	path_("tw1", "Pfad", [410, 0], [411, 0]),
	path_("tw2", "Strasse", [410, 0], [412, 0]),
];
powerlineData = [];
locationConnectivityIndex = null;

const nachWegart = getSparseCrossingPublicIds();
assert.strictEqual(nachWegart.has("pid-Tgleich"), true, "zwei Wege derselben Art sind aufloesbar");
assert.strictEqual(nachWegart.has("pid-Twechsel"), false, "ein Artwechsel Pfad->Strasse ist ein tragender Knoten");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js
```

Erwartet: ROT — `["pid-K0","pid-K1","pid-K2"]` statt `["pid-K2"]`.

- [ ] **Step 3: Die Konstante umbenennen**

In `js/config.js` die Zeilen 75–78 ersetzen:

```js
// Editor-Markierung "Kreuzungen mit 2 Wegen" (Discord #25, neu gefasst 2026-08-15): markiert wird
// der AUFLOESBARE Durchgangsknoten -- ----X---- soll ---------- werden. Drei Bedingungen, alle in
// computeLocationConnectivityIndex: genau so viele Arme wie hier steht, kein fremder Weg laeuft
// ueber den Punkt hinweg, und beide Arme sind dieselbe Wegart.
// 💣 GENAU, nicht hoechstens: null oder ein Arm ist eine Sackgasse bzw. Datenleiche und gehoert
// nicht diesem Haken (die traegt der pinke „Unverbunden"-Ring). Der alte Name lautete
// SPARSE_CROSSING_MAX_WAYS und sagte damit das Gegenteil des Vergleichs.
const SPARSE_CROSSING_WAY_COUNT = 2;
```

- [ ] **Step 4: Arm-Erhebung und die zwei Regeln bauen**

In `js/routing/route-graph-routing.js` `countGraphNodePathEdges` (Zeile 192–201) ersetzen:

```js
// Was an einem Knoten zusammenkommt: die Zahl der ARME (Teilkanten-Enden, nicht Nachbarn -- zwei
// getrennte Wege zum selben Nachbarn sind zwei Arme), die beteiligten Wegarten und die Weg-ids.
// Ein durchlaufender Weg liefert hier zwei Arme, weil er links und rechts je eine Teilkante hat.
function collectGraphNodeArms(graph, nodeName) {
	const neighbours = graph[nodeName];
	const arms = { count: 0, routeTypes: new Set(), pathIds: new Set() };
	if (!neighbours) {
		return arms;
	}
	Object.values(neighbours).forEach((connections) => {
		connections.forEach((connection) => {
			arms.count++;
			if (connection.routeType) {
				arms.routeTypes.add(connection.routeType);
			}
			// „<pfad>#<n>" -> „<pfad>": Task 3 vergleicht gegen properties.id.
			arms.pathIds.add(String(connection.id ?? "").split("#")[0]);
		});
	});
	return arms;
}

function countGraphNodePathEdges(graph, nodeName) {
	return collectGraphNodeArms(graph, nodeName).count;
}
```

In `computeLocationConnectivityIndex` den `forEach`-Rumpf ersetzen:

```js
	locationData.forEach((location) => {
		if (!location.publicId) {
			return;
		}
		const arms = collectGraphNodeArms(connectivityGraph, location.name);
		if (!arms.count && !powerlineConnectedPublicIds.has(location.publicId)) {
			unconnected.add(location.publicId);
		}
		// Regel 1: genau zwei Arme. Regel 3: beide derselben Wegart. (Regel 2 folgt.)
		if (isCrossingLocation(location)
			&& arms.count === SPARSE_CROSSING_WAY_COUNT
			&& arms.routeTypes.size === 1) {
			sparseCrossings.add(location.publicId);
		}
	});
```

Den Kommentarblock über `computeLocationConnectivityIndex` (Zeile 203–212) in der Beschreibung nachziehen: `sparseCrossings -- ein aufloesbarer Durchgangsknoten: genau SPARSE_CROSSING_WAY_COUNT Arme, eine Wegart.`

- [ ] **Step 5: Tests laufen lassen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js && node js/routing/__tests__/create-graph-connectivity.test.js && node js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js
```

Erwartet: alle drei GRÜN. `pruefhaken-sichtbarkeit.test.js` schiebt die Menge selbst hinein und ist von der Regel unabhängig.

- [ ] **Step 6: Committen**

```bash
git status --porcelain
git add js/config.js js/routing/route-graph-routing.js js/routing/__tests__/location-connectivity-index.test.js
git commit -F - <<'EOF'
fix(pruefhaken): genau zwei Arme, und beide derselben Wegart

Der Haken sucht den aufloesbaren Durchgangsknoten, nicht "hoechstens zwei".
Null oder ein Arm ist Sackgasse bzw. Datenleiche und gehoert dem pinken Ring;
ein Artwechsel Pfad->Strasse ist ein tragender Knoten. SPARSE_CROSSING_MAX_WAYS
heisst deshalb jetzt SPARSE_CROSSING_WAY_COUNT -- der alte Name sagte das
Gegenteil des Vergleichs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Kein fremder Weg läuft über den Punkt hinweg

Regel 2. 19 Kreuzungen haben zwar zwei Arme, aber ein dritter Weg zieht über sie hinweg, ohne dort einen Stützpunkt zu haben — auflösen würde ihn abschneiden. 126 → 95.

**Files:**
- Modify: `js/config.js` (zwei Konstanten), `js/routing/route-graph-routing.js` (`computeLocationConnectivityIndex` + zwei Helfer)
- Test: `js/routing/__tests__/location-connectivity-index.test.js`

**Interfaces:**
- Consumes: `collectGraphNodeArms` (Task 2, liefert `pathIds`)
- Produces: `buildPathSegmentGrid() -> Map<string, Array<{pathId, ax, ay, bx, by}>>`, `hasForeignPathOverPoint(grid, lat, lng, ownPathIds) -> boolean`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ans Ende von `js/routing/__tests__/location-connectivity-index.test.js` (vor `console.log`):

```js
// --- Regel 2: ein fremder Weg laeuft ueber den Punkt hinweg -------------------------------------
// 💣 Vgeht hat zwei eigene Arme -- aber „vquer" zieht als gerade Strecke ueber sie hinweg, ohne dort
// einen Stuetzpunkt zu haben. Weder Router noch Pruefhaken sehen diesen dritten Weg. Aufloesen waere
// falsch herum: fehlt hier etwas, dann dem WEG ein Stuetzpunkt, nicht der Kreuzung ihr Dasein.
locationData = [
	crossing("Vfrei", 500, 0), loc("Vfa", 501, 0), loc("Vfb", 502, 0),
	crossing("Vquerbelegt", 510, 0), loc("Vqa", 511, 0), loc("Vqb", 512, 0),
	loc("Qstart", 510, -5), loc("Qziel", 510, 5),
];
pathData = [
	path_("vf1", "Weg", [500, 0], [501, 0]),
	path_("vf2", "Weg", [500, 0], [502, 0]),
	path_("vq1", "Weg", [510, 0], [511, 0]),
	path_("vq2", "Weg", [510, 0], [512, 0]),
	// laeuft senkrecht durch (510,0) -- ohne Vertex dort
	path_("vquer", "Weg", [510, -5], [510, 5]),
];
powerlineData = [];
locationConnectivityIndex = null;

const nachUeberdeckung = getSparseCrossingPublicIds();
assert.strictEqual(nachUeberdeckung.has("pid-Vfrei"), true, "ohne fremden Weg darueber bleibt sie aufloesbar");
assert.strictEqual(nachUeberdeckung.has("pid-Vquerbelegt"), false, "ein Weg, der darueber hinweglaeuft, macht sie untastbar");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js
```

Erwartet: ROT bei `ein Weg, der darueber hinweglaeuft, macht sie untastbar` — `true !== false`.

- [ ] **Step 3: Die zwei Konstanten anlegen**

In `js/config.js` direkt unter `SPARSE_CROSSING_WAY_COUNT`:

```js
// Regel 2 des Hakens: naeher als das an einer FREMDEN Wegstrecke = der Weg laeuft ueber die Kreuzung
// hinweg. 0,02 Einheiten sind 0,06 Meilen -- eng genug, dass eine danebenlaufende Parallelstrasse
// nicht mitzaehlt, weit genug fuer die Zeichenungenauigkeit eines Editors.
const SPARSE_CROSSING_OVERLAY_DISTANCE = 0.02;
// Zellkante des Segment-Gitters. 💣 Ohne Gitter ist die Pruefung O(Kreuzungen x Segmente) und lief
// gemessen sekundenlang (2090 x 5929) -- der Index wird bei JEDER Feature-Aenderung verworfen, im
// Editor also oft. Die Zelle MUSS groesser sein als SPARSE_CROSSING_OVERLAY_DISTANCE, sonst reichen
// die drei mal drei abgefragten Zellen nicht bis an den Suchradius heran.
const SPARSE_CROSSING_SEGMENT_CELL = 0.5;
```

- [ ] **Step 4: Gitter und Prüfung bauen**

In `js/routing/route-graph-routing.js` vor `computeLocationConnectivityIndex`:

```js
// Alle Wegstrecken in ein Gitter, einmal je Indexbau. Ein Segment wird in JEDE Zelle gelegt, die
// seine Huellbox beruehrt -- schraeg liegende Segmente haengen dadurch in ein paar Zellen zu viel,
// was nur die Trefferliste laenger macht, nie kuerzer.
function buildPathSegmentGrid() {
	const grid = new Map();
	pathData.forEach((pathFeature) => {
		const coordinates = pathFeature?.geometry?.coordinates;
		if (!Array.isArray(coordinates)) {
			return;
		}
		const pathId = String(pathFeature.properties?.id ?? "");
		for (let index = 1; index < coordinates.length; index++) {
			const [ax, ay] = coordinates[index - 1];
			const [bx, by] = coordinates[index];
			const segment = { pathId, ax, ay, bx, by };
			const cellXFrom = Math.floor(Math.min(ax, bx) / SPARSE_CROSSING_SEGMENT_CELL);
			const cellXTo = Math.floor(Math.max(ax, bx) / SPARSE_CROSSING_SEGMENT_CELL);
			const cellYFrom = Math.floor(Math.min(ay, by) / SPARSE_CROSSING_SEGMENT_CELL);
			const cellYTo = Math.floor(Math.max(ay, by) / SPARSE_CROSSING_SEGMENT_CELL);
			for (let cellX = cellXFrom; cellX <= cellXTo; cellX++) {
				for (let cellY = cellYFrom; cellY <= cellYTo; cellY++) {
					const key = `${cellX}|${cellY}`;
					if (!grid.has(key)) {
						grid.set(key, []);
					}
					grid.get(key).push(segment);
				}
			}
		}
	});
	return grid;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = (dx * dx) + (dy * dy);
	if (!lengthSquared) {
		return Math.hypot(px - ax, py - ay);
	}
	const rawT = (((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared;
	const t = Math.max(0, Math.min(1, rawT));
	return Math.hypot(px - (ax + (t * dx)), py - (ay + (t * dy)));
}

// Laeuft ein Weg ueber den Punkt, der ihm KEINEN Arm gibt? Dann ist der Punkt kein Auflöse-Fall,
// sondern ein fehlender Stuetzpunkt an jenem Weg -- der umgekehrte Handgriff.
function hasForeignPathOverPoint(grid, lat, lng, ownPathIds) {
	const cellX = Math.floor(lng / SPARSE_CROSSING_SEGMENT_CELL);
	const cellY = Math.floor(lat / SPARSE_CROSSING_SEGMENT_CELL);
	for (let offsetX = -1; offsetX <= 1; offsetX++) {
		for (let offsetY = -1; offsetY <= 1; offsetY++) {
			const segments = grid.get(`${cellX + offsetX}|${cellY + offsetY}`) || [];
			for (const segment of segments) {
				if (ownPathIds.has(segment.pathId)) {
					continue;
				}
				if (distanceToSegment(lng, lat, segment.ax, segment.ay, segment.bx, segment.by) < SPARSE_CROSSING_OVERLAY_DISTANCE) {
					return true;
				}
			}
		}
	}
	return false;
}
```

In `computeLocationConnectivityIndex` das Gitter **einmal** vor dem `forEach` bauen und die Bedingung erweitern:

```js
	const segmentGrid = buildPathSegmentGrid();
```

```js
		if (isCrossingLocation(location)
			&& arms.count === SPARSE_CROSSING_WAY_COUNT
			&& arms.routeTypes.size === 1
			&& !hasForeignPathOverPoint(segmentGrid, location.coordinates[0], location.coordinates[1], arms.pathIds)) {
			sparseCrossings.add(location.publicId);
		}
```

- [ ] **Step 5: Tests laufen lassen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js && node js/routing/__tests__/create-graph-connectivity.test.js
```

Erwartet: beide GRÜN.

- [ ] **Step 6: Committen**

```bash
git status --porcelain
git add js/config.js js/routing/route-graph-routing.js js/routing/__tests__/location-connectivity-index.test.js
git commit -F - <<'EOF'
fix(pruefhaken): eine Kreuzung, ueber die ein Weg hinweglaeuft, ist kein Aufloese-Fall

19 der verbliebenen Funde haben zwei eigene Arme, aber ein dritter Weg zieht
ohne Stuetzpunkt ueber sie hinweg -- weder Router noch Haken sehen ihn. Dort
fehlt dem WEG ein Stuetzpunkt, nicht der Kreuzung ihr Dasein; aufloesen wuerde
den Weg abschneiden. Segment-Gitter, weil die Pruefung sonst O(n x m) ist und
der Index bei jeder Feature-Aenderung neu gebaut wird.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Die Beschriftung

**Files:**
- Modify: `index.html:2544`, `js/map-features/map-features-location-marker-rendering.js:198`
- Test: `js/routing/__tests__/location-connectivity-index.test.js` (Beschriftungswächter)

**Interfaces:**
- Consumes: nichts
- Produces: nichts (reine Textänderung)

> ⚠️ `css/base/tokens.css:162` und `css/features/location-popups-markers.css:887` tragen die alte Beschriftung ebenfalls im Kommentar. **`location-popups-markers.css` wird NICHT angefasst** — sie hat fremde uncommittete Änderungen (siehe Global Constraints). `tokens.css` ist sauber und wird mitgezogen.

- [ ] **Step 1: Den fehlschlagenden Wächter schreiben**

Ans Ende von `js/routing/__tests__/location-connectivity-index.test.js` (vor `console.log`):

```js
// --- Die Beschriftung ---------------------------------------------------------------------------
// 💣 Sie traegt KEIN data-i18n (die Nachbarn im selben Menue schon) und steht in keiner
// Uebersetzungstabelle -- hier wird Text ersetzt, kein Schluessel gepflegt. Der Waechter faengt das
// „≤", das die alte Regel meinte.
const indexHtml = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(indexHtml.includes("Kreuzungen mit 2 Wegen"), "die Menuezeile traegt die neue Beschriftung");
assert.ok(!indexHtml.includes("Kreuzungen ≤ 2 Wege"), "und nicht mehr die alte");
assert.ok(indexHtml.includes('id="toggleSparseCrossings"'), "🔴 die Kennung bleibt, nur die Beschriftung wandert");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js
```

Erwartet: ROT bei `die Menuezeile traegt die neue Beschriftung`.

- [ ] **Step 3: Die Beschriftung ändern**

`index.html:2544` — eine Zeile:

```html
							<span class="map-display-menu__name">Kreuzungen mit 2 Wegen</span>
```

`js/map-features/map-features-location-marker-rendering.js:198` — im Kommentar `"Kreuzungen <= 2 Wege"` zu `"Kreuzungen mit 2 Wegen"` machen.

`css/base/tokens.css:162` — im Kommentar ebenso.

- [ ] **Step 4: Tests laufen lassen**

```bash
node js/routing/__tests__/location-connectivity-index.test.js && node js/map-features/__tests__/pruefringe-css.test.js
```

Erwartet: beide GRÜN — `pruefringe-css.test.js` prüft Token- und Klassennamen, die sich nicht geändert haben.

- [ ] **Step 5: Committen**

```bash
git status --porcelain
git add index.html js/map-features/map-features-location-marker-rendering.js css/base/tokens.css js/routing/__tests__/location-connectivity-index.test.js
git commit -F - <<'EOF'
ui(pruefhaken): die Menuezeile heisst "Kreuzungen mit 2 Wegen"

Das "≤" war die alte Regel. Beschriftung gewandert, Kennung nicht:
toggleSparseCrossings, die Marker-Klasse und --color-marker-sparse-crossing-ring
bleiben, wie sie heissen -- dieselbe Trennung wie bei "Neuigkeiten"/changelog.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Der Melden-Knopf

> 🔴 **VORBEDINGUNG.** `js/ui/popups.js` und `js/routing/routing.js` hatten am 15.08.2026 **fremde uncommittete Änderungen**. `git add <pfad>` würde diese mit einbuchen. **Erst prüfen:**
> ```bash
> git status --porcelain js/ui/popups.js js/routing/routing.js
> ```
> Meldet das Kommando irgendetwas, ist dieser Task **blockiert** — melden und Task 6 ohne ihn ausführen. Nur bei leerer Ausgabe weiterbauen.

**Files:**
- Modify: `js/ui/popups.js:638` (`crossingActionsMarkup`), `js/routing/routing.js:~966` (Klick-Zweig)
- Create: `js/ui/__tests__/popup-crossing-report.test.js`

**Interfaces:**
- Consumes: `popupActionButtonMarkup`, `popupActionGlyphMarkup`, `locationPopupEditorBandMarkup` (popups.js); `findLocationMarkerByPublicId`, `buildSharePinLink`, `copyTextToClipboard`, `showFeedbackToast`, `getSparseCrossingPublicIds`, `locationConnectivityIndex`
- Produces: Kachel mit `data-popup-action="report-crossing"` + `data-public-id`; Klick-Zweig `report-crossing`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/ui/__tests__/popup-crossing-report.test.js`.

💣 **Der Harnisch wird aus `js/ui/__tests__/popup-editor-band.test.js:20-46` wörtlich übernommen** — jene Datei ruft `crossingActionsMarkup` bereits auf, ihre Attrappenliste ist also erprobt. Eine zweite, selbst erfundene Liste wäre die nächste Divergenz (und fiele beim ersten fehlenden Global auf die Nase).

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

// Woertlich aus popup-editor-band.test.js -- dort laeuft crossingActionsMarkup schon durch.
function ladePopups({ editMode }) {
	const sandbox = {
		IS_EDIT_MODE: editMode,
		CROSSING_LOCATION_TYPE: "kreuzung",
		pendingPathCreationStart: null,
		pendingPowerlineCreationStart: null,
		escapeHtml: (v) => String(v == null ? "" : v)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		buildHtmlAttributes: (attrs) => Object.entries(attrs || {})
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => ` ${k}="${String(v)}"`).join(""),
		tr: (key, german) => german,
		withAssetVersion: (u) => u,
		findWaypointIdByLocationName: () => "",
		findLocationMarkerByPublicId: () => null,
		findLabelEntryByPublicId: () => null,
		buildSuggestChangeButtonSpec: () => null,
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "ui", "popups.js"), sandbox, { filename: "popups.js" });
	return sandbox;
}

const editor = ladePopups({ editMode: true });
const markup = editor.crossingActionsMarkup("Kreuzung-2090", "pid-kr");

// 💣 NUR die Melden-Kachel herausschneiden. „Kreuzung verschieben" und „Kreuzung loeschen" tragen
// data-location-name zu Recht -- sie fassen den Marker ueber seinen Namen an. Ein Vergleich gegen
// das GANZE Markup wuerde deshalb immer anschlagen und nichts beweisen.
const kachel = /<button[^>]*data-popup-action="report-crossing"[^>]*>/.exec(markup);
assert.ok(kachel, "der Editor bekommt die Melden-Kachel");
assert.ok(kachel[0].includes('data-public-id="pid-kr"'), "sie traegt die stabile publicId");
assert.ok(!kachel[0].includes("data-location-name"),
	"💣 und NICHT den angezeigten Namen: „Kreuzung-2090\" ist ein laufender Zaehler ueber die Payload-Reihenfolge und verschiebt sich, sobald jemand eine Kreuzung anlegt, die frueher einsortiert");

const besucher = ladePopups({ editMode: false });
assert.strictEqual(besucher.crossingActionsMarkup("Kreuzung-2090", "pid-kr"), "",
	"ein Besucher sieht das Band gar nicht");

// Der Klick-Zweig ist verdrahtet und benutzt den VORHANDENEN Pin-Link-Bauer.
const routing = read("js", "routing", "routing.js");
assert.ok(routing.includes('action === "report-crossing"'), "der Klick-Zweig existiert");
assert.ok(/report-crossing[\s\S]{0,1200}buildSharePinLink/.test(routing),
	"und baut die Adresse mit buildSharePinLink, keinem zweiten Link-Bauer");

console.log("popup crossing report tests passed");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/ui/__tests__/popup-crossing-report.test.js
```

Erwartet: ROT bei `der Editor bekommt die Melden-Kachel`.

- [ ] **Step 3: Die Kachel bauen**

In `js/ui/popups.js`, in `crossingActionsMarkup`, als **vorletzte** Kachel — direkt vor „Kreuzung löschen". Die Handlungen stehen dort nach Gewicht, und die gefährliche bleibt letzte; Melden ist die leiseste und drängt sich nicht vor „Zu Ort konvertieren":

```js
		popupActionButtonMarkup({
			// 💣 Die Kachel traegt die publicId, NICHT den angezeigten Namen. „Kreuzung-2090" entsteht
			// erst im Browser als laufender Zaehler ueber die Payload-Reihenfolge (prepareLocationData,
			// js/routing/routing.js): legt jemand eine Kreuzung an, die frueher einsortiert, rutscht
			// jede folgende Nummer um eins. Als Meldung an den Owner waere sie damit unbrauchbar.
			label: "Kreuzung melden",
			iconMarkup: popupActionGlyphMarkup("bearbeiten"),
			attributes: {
				"data-popup-action": "report-crossing",
				"data-public-id": publicId,
			},
		}),
```

- [ ] **Step 4: Den Klick-Zweig bauen**

In `js/routing/routing.js` direkt **vor** dem `if (action === "share-place-link")`-Block:

```js
	// „Kreuzung melden": legt eine Zeile in die Zwischenablage, mit der ein Editor dem Owner eine
	// STELLE nennen kann statt einer Nummer, die sich verschiebt.
	//
	// 💣 Baut den Index NICHT. Die Armzahl ist Beiwerk und wird nur gelesen, wenn er ohnehin schon
	// steht (ein Pruefhaken ist an); getLocationConnectivityIndex() hier aufzurufen hiesse, einen
	// Popup-Klick mit einem Graphbau ueber 5929 Wege zu bezahlen.
	if (action === "report-crossing") {
		const publicId = this.dataset.publicId;
		const markerEntry = publicId ? findLocationMarkerByPublicId(publicId) : null;
		const koordinaten = markerEntry?.location?.coordinates;
		if (Array.isArray(koordinaten)) {
			const stelle = { lat: koordinaten[0], lng: koordinaten[1] };
			const istMarkiert = locationConnectivityIndex
				&& locationConnectivityIndex.sparseCrossings.has(publicId);
			const befund = istMarkiert ? ` · ${SPARSE_CROSSING_WAY_COUNT} Arme` : "";
			void copyTextToClipboard(`Kreuzung${befund} · ${buildSharePinLink(stelle)}`).then((didCopy) => {
				showFeedbackToast(
					didCopy ? "Kreuzung in die Zwischenablage kopiert." : "Konnte nicht automatisch kopiert werden.",
					didCopy ? "success" : "warning"
				);
			});
		}
		return;
	}
```

- [ ] **Step 5: Tests laufen lassen**

```bash
node js/ui/__tests__/popup-crossing-report.test.js && node js/ui/__tests__/popup-editor-band.test.js
```

Erwartet: beide GRÜN. `popup-editor-band.test.js` zählt keine Kacheln, sondern prüft, dass das Band existiert — eine Kachel mehr stört es nicht.

- [ ] **Step 6: Committen**

```bash
git status --porcelain
git add js/ui/popups.js js/routing/routing.js js/ui/__tests__/popup-crossing-report.test.js
git commit -F - <<'EOF'
feat(pruefhaken): Editoren melden eine Kreuzung als Stelle, nicht als Nummer

"Kreuzung-2090" entsteht erst im Browser, als laufender Zaehler ueber die
Payload-Reihenfolge -- legt jemand eine Kreuzung an, die frueher einsortiert,
rutscht jede folgende Nummer um eins. Der Melden-Knopf kopiert deshalb den
vorhandenen Pin-Deep-Link. Er baut den Konnektivitaetsindex nicht: die Armzahl
steht in der Zeile, wenn ein Pruefhaken ohnehin an ist, sonst nicht.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Abnahme am laufenden Ding, dann live

💣 **Eine Tabelle mit 95 statt 921 belegt nichts.** Abnahme heißt ABLAUF: die Handgriffe werden ausgeführt und benannt.

**Files:** keine

- [ ] **Step 1: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

Erwartet: keine `ROT:`-Zeile. Bei rot: **nicht pushen** — der Deploy ist ein Tor, und ein Fehlschlag vergiftet danach den `?v=`-Stempel.

- [ ] **Step 2: Lokal gegen die Live-Daten messen**

`index.html` im Browser mit `?edit=1`, Haken an, in der Konsole:

```js
JSON.stringify({
  tuerkis: [...getSparseCrossingPublicIds()].length,
  pink: [...getUnconnectedLocationPublicIds()].length,
})
```

Erwartet: türkis ≈ **95** (vorher 921), pink ≈ **170** (vorher 182). Weicht eine Zahl um mehr als ein paar Stück ab, ist eine Regel anders getroffen als gemessen — **nicht** die Erwartung anpassen, sondern nachsehen.

- [ ] **Step 3: Die fünf Handgriffe (Entwurf §9)**

1. `?edit=1`, Menü öffnen → die Zeile heißt **„Kreuzungen mit 2 Wegen"**.
2. `?pin=677.850,662.555` → an Kreuzung-2090 **kein** türkiser Ring.
3. Eine markierte Kreuzung anklicken → Popup öffnet, „Kreuzung melden" ist da, Klick → Toast erscheint, Zwischenablage trägt die Zeile, der Link führt zurück auf die Stelle.
4. Haken „Unverbunden" an → die 12 verschwundenen Ringe liegen nachweislich auf einem Weg.
5. Eine Route über eine aufliegende Kreuzung rechnen → **unverändert** (Beweis, dass der Routing-Zweig nicht berührt wurde).

Jeden Handgriff mit Ergebnis benennen. Was ein Emulator nicht beantworten kann, wird als offene Frage gemeldet, nicht als bestanden.

- [ ] **Step 4: Die zwei Prüf-Subagenten**

`usability-konsistenz` (Entwurf gegen Diff, gekoppelte Werte) und `usability-design` (gebauter Zustand gegen Designsprache, hell UND dunkel). Sie ersetzen das Abhaken nicht, sie fangen das Überlesene.

- [ ] **Step 5: Push — und der Owner sieht es**

💣 **Sichtbare Änderungen gehen EINZELN live.** Das ist eine Editor-Oberfläche: Beschriftung, Ringmenge, neue Kachel. Push, Remote-SHA prüfen, dem Owner sagen, was er ansehen soll — und **warten**, bevor irgendetwas anderes hinterhergeht.

```bash
git fetch origin && git push origin master && git rev-parse --short HEAD origin/master
```

Nach ~1–2 Minuten Deploy: Schritt 3 noch einmal auf `https://avesmaps.de/index.html?edit=1`, weil erst dort der gestempelte Stand läuft.

---

## Was dieser Plan NICHT tut

- **Keine Datenänderung.** Die 13 fehlgeschnappten Wegenden, die 19 fehlenden Stützpunkte, die 523 Sackgassen und Lonatfurts Zweier-Insel bleiben unberührt — der Haken hört nur auf, falsch über sie zu reden.
- **Kein neuer Haken** für Sackgassen oder Stütz-Fälle.
- **Kein Eingriff in `getLocationAtPathEndpoint`** und keiner in den Routing-Zweig von `addRegularPathToGraph`.
- **Kein Anfassen von `html/editor-handbuch.html`** — das gehört der nächtlichen Routine. Die Commit-Betreffs in Task 4 und 5 nennen die sichtbare Wirkung, das ist die ganze Pflicht.
