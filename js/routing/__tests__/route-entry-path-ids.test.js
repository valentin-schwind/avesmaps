// Regression: die Weg-Kennung einer Etappe.
//
// 💣 Gefunden bei der Live-Abnahme von V10 (2026-07-29). Die Spec behauptete, `properties.id` einer
// Routen-Etappe sei die `public_id` des Wegs. Das stimmt fuer die CLIENT-Engine -- die Live-Seite
// faehrt aber server-primaer (`shouldUseServerPrimaryRouting`, nur `?clientrouting=1` schaltet um),
// und dort baut buildServerGeometryRouteSegment die Eigenschaften neu auf: `id` ist die KANTEN-
// Kennung „path-2661", und `public_id` fehlte ganz. Die „Führt durch"-Anfrage fragte damit nach
// erfundenen Kennungen, der Server lehnte ab, der Client schluckte es -- und die leere Zeile sah
// aus wie „hier gibt es keine Landschaft".
//
// Dieser Test haelt beide Haelften fest: der Bauer traegt die public_id, und der Leser nimmt NUR sie.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// setTimeout als No-Op: route-engine.js stellt beim Laden die server-primaere Verdrahtung her
// (installServerPrimaryRouting) und schiebt das ans Ende der Warteschlange. Hier soll nichts davon
// laufen -- geprueft werden zwei reine Funktionen.
global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };
// Was route-engine.js beim Bauen eines Anzeige-Segments anfasst.
global.normalizePathSubtype = (value) => String(value || "Weg");
global.getTransportOption = () => "groupFoot";
global.findPathByPublicId = (publicId) => (publicId === "8a502001-e3bd-5d9b-aae4-cae1a2ab519b"
	? { properties: { public_id: publicId, display_name: "Reichsstraße 3", original_name: "" } }
	: null);

const load = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
load("../route-engine.js");
load("../route-plan.js");

// ---- der Bauer: eine server-primaere Etappe kennt ihren Weg ------------------------------------
const serverSegment = {
	edge_id: "path-2661",
	public_id: "8a502001-e3bd-5d9b-aae4-cae1a2ab519b",
	subtype: "Reichsstrasse",
	transport_type: "groupFoot",
};
const built = buildServerGeometryRouteSegment(serverSegment, [[544.9, 532.4], [551.5, 532.9]]);
assert.strictEqual(built.properties.public_id, "8a502001-e3bd-5d9b-aae4-cae1a2ab519b",
	"das Anzeige-Segment traegt die public_id des Wegs");
assert.strictEqual(built.properties.id, "path-2661",
	"und daneben weiterhin die Kanten-Kennung -- die beiden sind NICHT dasselbe");

const cloned = clonePathSegmentForServerRoute(
	{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { public_id: "aaaaaaaa-0000-0000-0000-000000000000", feature_subtype: "Pfad" } },
	serverSegment
);
assert.strictEqual(cloned.properties.public_id, "8a502001-e3bd-5d9b-aae4-cae1a2ab519b",
	"die Server-Kennung sticht die lokale, wenn es beide gibt");

// ---- der Leser: NUR public_id, niemals die Kanten-Kennung ---------------------------------------
const segments = [
	{ properties: { public_id: "8a502001-e3bd-5d9b-aae4-cae1a2ab519b", id: "path-2661" } },
	{ properties: { public_id: "bbbbbbbb-0000-0000-0000-000000000000", id: "path-2674" } },
	{ properties: { id: "path-9999" } },                       // nur Kanten-Kennung
	{ properties: { synthetic: true, id: "synthetic-a->b" } },  // Querfeldein, kein Weg
];
assert.deepStrictEqual(
	routeEntryPathIds({ segmentIndexes: [0, 1] }, segments),
	["8a502001-e3bd-5d9b-aae4-cae1a2ab519b", "bbbbbbbb-0000-0000-0000-000000000000"],
	"eine Wasser-Etappe aus zwei Wegen liefert beide Kennungen"
);
assert.deepStrictEqual(routeEntryPathIds({ segmentIndexes: [2] }, segments), [],
	"ohne public_id KEINE Anfrage -- lieber gar keine als eine nach „path-9999\"");
assert.deepStrictEqual(routeEntryPathIds({ segmentIndexes: [3] }, segments), [],
	"Querfeldein ist kein Weg und hat keine Kennung");
assert.deepStrictEqual(routeEntryPathIds({ segmentIndexes: [0, 2] }, segments),
	["8a502001-e3bd-5d9b-aae4-cae1a2ab519b"],
	"eine kennungslose Haelfte verschweigt die andere nicht");
assert.deepStrictEqual(routeEntryPathIds({}, segments), [], "eine Etappe ohne segmentIndexes");
assert.deepStrictEqual(routeEntryPathIds(null, segments), [], "gar keine Etappe");
assert.deepStrictEqual(routeEntryPathIds({ segmentIndexes: [99] }, segments), [],
	"ein Index ins Leere ist kein Absturz");

console.log("OK: route entry path ids -- public_id only, and the display segment carries it");
