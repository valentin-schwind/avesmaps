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
// V9: index.html laedt dieses Modul VOR config.js -- dort werden samples/tension hineingespreizt.
loadBrowserScript("../../map-features/map-features-line-catmull.js");
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../../map-features/map-features-location-editing.js");
loadBrowserScript("../../map-features/map-features-location-lookup.js");
loadBrowserScript("../../map-features/map-features-powerlines.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y, locationType = "dorf") => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType });
const crossing = (name, x, y) => loc(name, x, y, "crossing");
const path_ = (id, subtype, [x1, y1], [x2, y2], extraProperties = {}) => ({
	geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
	properties: { id, feature_subtype: subtype, ...extraProperties },
});

// --- unconnected ---
// A--B connected by a path. C isolated (no path, no powerline) -> unconnected. D--E joined by an
// unbefahrbar river (a river source): DRAWN, so NOT unconnected (Owner 2026-07-16). F has no path
// but IS a powerline endpoint -> not unconnected.
// --- sparse crossings (<= 2 ways) ---
// K0: crossing, no ways at all      -> sparse (and unconnected)
// K1: crossing, 1 way               -> sparse
// K2: crossing, 2 ways              -> sparse
// K3: crossing, 3 ways              -> NOT sparse (a real crossing)
locationData = [
	loc("A", 0, 0), loc("B", 10, 0), loc("C", 20, 0), loc("D", 30, 0), loc("E", 40, 0), loc("F", 50, 0),
	crossing("K0", 100, 0),
	crossing("K1", 110, 0), loc("K1end", 111, 0),
	crossing("K2", 120, 0), loc("K2a", 121, 0), loc("K2b", 122, 0),
	crossing("K3", 130, 0), loc("K3a", 131, 0), loc("K3b", 132, 0), loc("K3c", 133, 0),
];
pathData = [
	path_("p1", "Weg", [0, 0], [10, 0]),
	path_("p2", "Flussweg", [30, 0], [40, 0], { transport_domain: "river", allowed_transports: [] }),
	path_("k1a", "Weg", [110, 0], [111, 0]),
	path_("k2a", "Weg", [120, 0], [121, 0]),
	path_("k2b", "Weg", [120, 0], [122, 0]),
	path_("k3a", "Weg", [130, 0], [131, 0]),
	path_("k3b", "Weg", [130, 0], [132, 0]),
	path_("k3c", "Weg", [130, 0], [133, 0]),
];
powerlineData = [{ properties: { from_public_id: "pid-F", to_public_id: "pid-A" } }];
locationConnectivityIndex = null;

const unconnected = getUnconnectedLocationPublicIds();
assert.deepStrictEqual([...unconnected].sort(), ["pid-C", "pid-K0"], "only genuinely way-less, powerline-less nodes");
assert.strictEqual(unconnected.has("pid-D"), false, "a drawn but unbefahrbar river is a connection");
assert.strictEqual(unconnected.has("pid-E"), false, "a drawn but unbefahrbar river is a connection");
assert.strictEqual(unconnected.has("pid-F"), false, "powerline endpoint counts as connected");

const sparse = getSparseCrossingPublicIds();
// 🔴 Seit 2026-08-15: GENAU zwei Arme. K0 (null) und K1 (einer) sind Sackgasse bzw. Datenleiche und
// gehoeren nicht mehr diesem Haken -- die 0-Arm-Faelle traegt der pinke „Unverbunden"-Ring.
assert.deepStrictEqual([...sparse].sort(), ["pid-K2"], "genau zwei Arme, sonst nichts");
assert.strictEqual(sparse.has("pid-K0"), false, "null Arme ist keine aufloesbare Kreuzung, sondern eine Leiche");
assert.strictEqual(sparse.has("pid-K1"), false, "ein Arm ist eine Sackgasse, kein Durchgangsknoten");
assert.strictEqual(sparse.has("pid-K3"), false, "a 3-way crossing is a real crossing");
assert.strictEqual(sparse.has("pid-C"), false, "sparse marks CROSSINGS only, never settlements");

// --- cache ---
assert.strictEqual(getUnconnectedLocationPublicIds(), unconnected, "cached: same Set instance until invalidated");
assert.strictEqual(getSparseCrossingPublicIds(), sparse, "cached: same Set instance until invalidated");

locationConnectivityIndex = null;
const rebuilt = getUnconnectedLocationPublicIds();
assert.notStrictEqual(rebuilt, unconnected, "invalidation forces a fresh index");
assert.deepStrictEqual([...rebuilt].sort(), ["pid-C", "pid-K0"]);

// --- Der Split an aufliegenden Stuetzpunkten -----------------------------------------------------
// 💣 S1 liegt als INNERER Vertex auf dem Weg s-p (200,0)->(220,0). Der Router sieht dort einen
// vollwertigen Knoten (avesmapsAddClientCompatiblePathConnection splittet round-5), der Pruefhaken
// sah bis 2026-08-15 gar nichts -- und markierte die Kreuzung als "hat keine Wege".
locationData = [
	loc("Sa", 200, 0), crossing("S1", 210, 0), loc("Sb", 220, 0),
	loc("Ua", 300, 0), loc("Umitte", 310, 0), loc("Ub", 320, 0),
	loc("Xa", 400, 0), loc("Xb", 410, 0),
];
pathData = [
	{ geometry: { type: "LineString", coordinates: [[200, 0], [210, 0], [220, 0]] },
	  properties: { id: "sp", feature_subtype: "Weg" } },
	{ geometry: { type: "LineString", coordinates: [[300, 0], [310, 0], [320, 0]] },
	  properties: { id: "up", feature_subtype: "Weg" } },
	// Zwei-Punkt-Weg OHNE inneren Stuetzpunkt -- der Kontrastfall zu "sp"/"up" fuer die id-Form.
	{ geometry: { type: "LineString", coordinates: [[400, 0], [410, 0]] },
	  properties: { id: "xy", feature_subtype: "Weg" } },
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

// Die id-Form ist load-bearing: Task 3 liest den Weg-Stamm vor dem "#" zurueck. Ein geteilter Weg
// zaehlt seine Teilkanten hoch, ein ungeteilter behaelt seine reine Weg-id.
assert.strictEqual(splitGraph.Sa.S1[0].id, "sp#1", "erste Teilkante: Weg-Stamm plus Segmentnummer 1");
assert.strictEqual(splitGraph.S1.Sb[0].id, "sp#2", "zweite Teilkante: Segmentnummer hochgezaehlt");
assert.strictEqual(splitGraph.Xa.Xb[0].id, "xy", "ein Weg ohne inneren Stuetzpunkt behaelt seine reine Weg-id");

// collectGraphNodeArms().pathIds muss denselben Stamm liefern, egal ob der Weg gesplittet wurde oder
// nicht -- genau die Eigenschaft, auf die sich Task 3 verlaesst (Vergleich gegen properties.id).
assert.deepStrictEqual(collectGraphNodeArms(splitGraph, "S1").pathIds, new Set(["sp"]), "beide Teilkanten-Enden an S1 tragen denselben Weg-Stamm, nicht die id#n-Form");
assert.deepStrictEqual(collectGraphNodeArms(splitGraph, "Xa").pathIds, new Set(["xy"]), "ein ungeteilter Weg liefert seine reine id als Stamm");

// --- Die Wache gegen doppelte Stuetzpunkte -------------------------------------------------------
// 💣 Zwilling der PHP-Wachen in client-graph.php:204-207 (beim Einsammeln) und :223 (vor jeder
// Teilkante). Der Weg "dd" traegt einen inneren Vertex, der round-5 exakt auf denselben Ort faellt
// wie sein eigener Start (ein doppelt gezeichneter Punkt) -- ohne die erste Wache wuerde das eine
// Selbstkante Da-Da ziehen und Da zwei Phantomarme bescheren, obwohl der Weg tatsaechlich nur nach
// Db fuehrt.
locationData = [loc("Da", 500, 0), loc("Db", 520, 0)];
pathData = [
	{ geometry: { type: "LineString", coordinates: [[500, 0], [500, 0], [520, 0]] },
	  properties: { id: "dd", feature_subtype: "Weg" } },
];
powerlineData = [];
locationConnectivityIndex = null;

const dedupGraph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
assert.strictEqual(countGraphNodePathEdges(dedupGraph, "Da"), 1, "ein doppelter Stuetzpunkt am Start darf keine Phantomarme erzeugen");
assert.deepStrictEqual(Object.keys(dedupGraph.Da), ["Db"], "keine Selbstkante Da-Da im Graphen");
assert.strictEqual(dedupGraph.Da.Db[0].id, "dd", "der Duplikat-Vertex faellt heraus, der Weg bleibt unsplit");

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

console.log("location connectivity index tests passed");
