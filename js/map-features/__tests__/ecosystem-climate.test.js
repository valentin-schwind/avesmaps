// Unit test for the PURE half of the climate-divider editor: where a dragged handle may go, and where
// a new point is inserted. Everything Leaflet-bound (panes, markers, drag events) is not testable here
// -- js/map-features/ is loaded as bare <script>, so this installs the file's globals by hand into a
// vm context, the house pattern of the other tests in this folder.
//
// 🔴 What this pins down: the handle STOPS at its neighbour instead of crossing it. That is where
// "Klimazonen überlappen sich nicht" becomes something the editor can feel, rather than an error
// message they get after the fact.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-climate.js"), "utf8");
const context = {
	console,
	window: {},
	// addEventListener nur, damit die Datei überhaupt lädt: sie hängt beim Laden EINEN Zuhörer ans
	// Dokument (der Klick, der die Hervorhebung wieder löscht). Der Zuhörer selbst wird hier NICHT
	// geprüft -- er ist DOM-Verdrahtung; geprüft wird die Regel darunter, die er aufruft.
	document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

// ---- Strecken-Schnitt ------------------------------------------------------------------------------
// Muss dasselbe verbieten wie avesmapsClimateSegmentsCross im PHP, sonst zieht man eine Linie, die beim
// Loslassen abgelehnt wird.

assert(context.climateSegmentsCross([0, 0], [10, 10], [0, 10], [10, 0]), "a clean X crosses");
assert(!context.climateSegmentsCross([0, 0], [10, 0], [0, 5], [10, 5]), "parallel segments do not");
assert(context.climateSegmentsCross([0, 0], [10, 0], [5, 0], [5, 10]), "a T counts as a crossing too");
assert(!context.climateSegmentsCross([0, 0], [10, 0], [20, 0], [30, 0]), "collinear but apart does not");

// ---- darf dieser Griff dorthin? --------------------------------------------------------------------
// 🔴 Seit den Überhängen ist DAS die Regel -- nicht mehr „y zwischen den Nachbarn, x zwischen den
// Nachbarpunkten". Erlaubt ist alles, was nichts schneidet.

const linie = [[0, 500], [300, 500], [600, 500], [1024, 500]];
const nachbarNord = [[0, 900], [1024, 900]];
const nachbarSued = [[0, 100], [1024, 100]];

assert(!context.climateVertexWouldCross(linie, 1, [300, 700], [nachbarNord, nachbarSued]),
	"moving a vertex inside the corridor is fine");

// 🔴 DER FALL DES OWNERS: der Punkt läuft nach LINKS an seinem Vorgänger vorbei -- ein Überhang.
// Genau das war bis heute verboten, und ohne diesen Test käme die Klemme still zurück.
assert(!context.climateVertexWouldCross(linie, 2, [150, 400], [nachbarNord, nachbarSued]),
	"a vertex may run back past its predecessor -- that is the bubble");

// Was weiterhin nicht geht: die Nachbarlinie durchstossen.
assert(context.climateVertexWouldCross(linie, 1, [300, 950], [nachbarNord, nachbarSued]),
	"pushing through the northern neighbour is refused");
assert(context.climateVertexWouldCross(linie, 1, [300, 50], [nachbarNord, nachbarSued]),
	"and through the southern one as well");

// Und die eigene Linie darf sich nicht selbst schneiden.
const zickzack = [[0, 500], [200, 300], [400, 700], [600, 300], [1024, 500]];
assert(context.climateVertexWouldCross(zickzack, 1, [500, 500], [ ]),
	"a vertex dragged across its own line is refused");

// ---- wo ein neuer Punkt landet ---------------------------------------------------------------------
// Über den ABSTAND zur Strecke, nicht über den x-Bereich: mit einem Überhang deckt derselbe x mehrere
// Strecken ab.

const bent = [[0, 900], [400, 880], [1024, 910]];
assert(context.climateInsertionIndex(bent, 200, 890) === 1, "a click near the first segment inserts at 1");
assert(context.climateInsertionIndex(bent, 700, 895) === 2, "a click near the second segment inserts at 2");

// 🔴 Beim Überhang entscheidet der Abstand, nicht x: bei x = 500 liegen ZWEI Strecken, und der Klick
// gehört zu der, die näher ist.
const ueberhang = [[0, 500], [600, 500], [400, 300], [1024, 300]];
assert(context.climateInsertionIndex(ueberhang, 500, 495) === 1, "a click just under the upper run picks it");
assert(context.climateInsertionIndex(ueberhang, 500, 305) === 3, "a click near the lower run picks that one");

// 🔴 Never 0 and never length: the two edge points are mandatory, and an insertion outside them would
// push one of them out of its corner -- the band below would then stop short of the map edge.
[[-100, 0], [0, 900], [512, 880], [1024, 910], [5000, 900]].forEach(([x, y]) => {
	const index = context.climateInsertionIndex(bent, x, y);
	assert(index >= 1 && index <= bent.length - 1, `insertion index for x=${x} stays inside the edges`);
});

// ---- Kartengrenzen ---------------------------------------------------------------------------------

assert(context.climateClampToMap(-40) === 0, "below the map clamps to 0");
assert(context.climateClampToMap(2000) === 1024, "above the map clamps to 1024");
assert(context.climateClampToMap(512) === 512, "inside stays put");

// ---- wo der Zonenname sitzt (2026-08-03) -----------------------------------------------------------
// 🔴 Aus der FLÄCHE gerechnet, nicht aus den Trennlinien: die Namen stehen auch im Frontend, und dort
// gibt es die Trennlinien nicht -- sie kommen vom Editor-Endpunkt. Ein Band beginnt und endet auf dem
// Kartenrand, sein Ring hat bei x = 0 deshalb genau zwei Ecken; deren Mitte ist die Bandmitte.

const band = { type: "Polygon", coordinates: [[[0, 900], [1024, 880], [1024, 700], [0, 700], [0, 900]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(band)) === JSON.stringify({ min: 700, max: 900 }),
	"the west edge span comes from the two ring corners at x = 0");

// 🪤 Eine SCHRÄGE Südgrenze darf das Ergebnis nicht verschieben -- genau deshalb wird an der Westkante
// gemessen und nicht über `bounds`, dessen Mitte hier 790 statt 800 wäre.
const schraeg = { type: "Polygon", coordinates: [[[0, 900], [1024, 880], [1024, 600], [0, 700], [0, 900]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(schraeg)) === JSON.stringify({ min: 700, max: 900 }),
	"a slanted southern boundary does not move the label");

// 🔴 BEIDE Kanten werden für sich gemessen (Owner 2026-08-03: Beschriftung links UND rechts). Bei einer
// schrägen Grenze liegt die Bandmitte rechts woanders als links -- ein gespiegelter Wert wäre daneben.
assert(JSON.stringify(context.climateAreaEdgeSpan(schraeg, 1024)) === JSON.stringify({ min: 600, max: 880 }),
	"the east edge span is measured on its own, not mirrored from the west");
assert(context.climateAreaEdgeSpan(schraeg, 0).min !== context.climateAreaEdgeSpan(schraeg, 1024).min,
	"and on a slanted band the two really do differ");

const multi = { type: "MultiPolygon", coordinates: [[[[0, 500], [1024, 500], [1024, 400], [0, 400], [0, 500]]]] };
assert(JSON.stringify(context.climateAreaWestEdgeSpan(multi)) === JSON.stringify({ min: 400, max: 500 }),
	"a MultiPolygon works the same way");

// Kein Punkt auf der Westkante: dann lieber kein Name als einer an geratener Stelle.
const abseits = { type: "Polygon", coordinates: [[[300, 500], [700, 500], [700, 400], [300, 400], [300, 500]]] };
assert(context.climateAreaWestEdgeSpan(abseits) === null, "an area that never touches the west edge gets no label");
assert(context.climateAreaWestEdgeSpan(undefined) === null, "and neither does a missing geometry");

// ---- wann ist die Ebene zu SEHEN und wann zu BEARBEITEN? --------------------------------------------
// 🔴 ZWEI Fragen, und seit dem 2026-08-04 fallen sie in „Alle" auseinander: die NAMEN werden dort
// gezeichnet (der Owner will die blasse Fläche zuordnen können), die Trennlinien und Griffe NICHT --
// die wären Werkzeug über drei fremden Ebenen.
//
// 💣 Die drei Umgebungsfunktionen werden hier ECHT gesetzt, nicht weggelassen. Beide geprüften
// Funktionen sind gegen fehlende Globals gehärtet (`typeof … === "function"`); ohne sie liefe der Test
// in die Notbremse und zertifizierte ein `false`, das gar nichts über die Regel aussagt.
let umgebung = { modus: true, alle: false, ebene: "klima", bearbeiten: false };
context.isEcosystemLayerModeActive = () => umgebung.modus;
context.isEcosystemShowAllLayers = () => umgebung.alle;
context.getActiveEcosystemLayerKind = () => umgebung.ebene;
Object.defineProperty(context, "IS_EDIT_MODE", { get: () => umgebung.bearbeiten, configurable: true });

const lage = (teil) => { umgebung = { ...umgebung, ...teil }; };

// Die gewählte Klima-Ebene: sichtbar, und im Bearbeiten-Modus auch bearbeitbar.
lage({ alle: false, ebene: "klima", bearbeiten: false });
assert(context.isClimateLayerVisible(), "auf der gewählten Klima-Ebene stehen die Namen");
assert(!context.isClimateEditorActive(), "ohne Bearbeiten-Modus aber keine Trennlinien");
lage({ bearbeiten: true });
assert(context.isClimateEditorActive(), "mit Bearbeiten-Modus schon");

// Eine andere Ebene: gar nichts.
lage({ ebene: "vegetation", bearbeiten: true });
assert(!context.isClimateLayerVisible(), "auf der Vegetationsebene hat das Klima nichts zu sagen");
assert(!context.isClimateEditorActive(), "und erst recht keine Griffe");

// 🔴 „ALLE": Namen ja, Werkzeug nein. Das ist der Kern der Änderung.
lage({ alle: true, ebene: "vegetation", bearbeiten: true });
assert(context.isClimateLayerVisible(), "in Alle werden die Zonennamen gezeichnet");
assert(!context.isClimateEditorActive(), "🔴 aber die Trennlinien nicht -- sie lägen über drei fremden Ebenen");

// 💣 Und zwar UNABHÄNGIG vom gemerkten Ebenenwert. „Alle" lässt den stehen; hinge es daran, wären die
// Namen mal da und mal nicht, je nachdem was zuletzt gewählt war.
lage({ alle: true, ebene: "klima" });
assert(context.isClimateLayerVisible(), "auch wenn zuletzt Klima gewählt war");
assert(!context.isClimateEditorActive(), "und auch dann keine Griffe in Alle");
lage({ alle: true, ebene: "topographie" });
assert(context.isClimateLayerVisible(), "und auch wenn zuletzt Topographie gewählt war -- derselbe Anblick");

// Ohne den Landschaften-Modus überhaupt: nichts, auch nicht in „Alle".
lage({ modus: false, alle: true });
assert(!context.isClimateLayerVisible(), "ohne Landschaften-Modus gibt es keine Zonennamen");

// ---- welche Fläche leuchtet, wenn man einen Namen anklickt? -----------------------------------------
// 🔴 Gemerkt wird die REGION, nicht die Fläche und schon gar nicht der Name. Eine Zone hat heute genau
// eine Fläche, aber die Zone ist das, was der Name meint -- und zwei Bänder dürfen gleich heissen, weil
// der Name im Regionen-Editor frei ist. Über den Text zu vergleichen liesse dann das falsche leuchten.
const klimaband = (regionId, kind = "klima") => ({ kind, region_public_id: regionId, region_name: "Gemäßigte Zone" });

assert(context.shouldHighlightClimateArea(klimaband("r-gemaessigt"), "r-gemaessigt"),
	"die Fläche der angeklickten Zone leuchtet");
assert(!context.shouldHighlightClimateArea(klimaband("r-tropisch"), "r-gemaessigt"),
	"die Nachbarzone nicht -- auch wenn sie genauso heisst");
assert(!context.shouldHighlightClimateArea(klimaband("r-gemaessigt"), ""),
	"ohne Auswahl leuchtet gar nichts (der Zustand nach einem Klick woanders hin)");
assert(!context.shouldHighlightClimateArea(klimaband("r-wald", "vegetation"), "r-wald"),
	"💣 und eine Fläche einer ANDEREN Ebene nie -- die Hervorhebung gehört den Klimazonen");
assert(!context.shouldHighlightClimateArea(null, "r-gemaessigt"), "keine Fläche, kein Leuchten");
assert(!context.shouldHighlightClimateArea(klimaband(""), ""), "und eine Fläche ohne Region auch nicht");

if (failures > 0) {
	console.error(`ecosystem-climate.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-climate.test: OK");
