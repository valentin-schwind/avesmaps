// V11: „Auf und ab" — die Höhen EINER ETAPPE.
//
// 💣 EINE ETAPPE IST KEINE KANTE. showRoutePlan fasst aufeinanderfolgende Segmente gleicher Art und
// gleichen Transports zu EINEM Eintrag zusammen; „Saljethweg, Schattenbachpass, 38,30 Meilen" sind
// ein Dutzend Segmente in einer Zeile. Wer die Zahl eines einzelnen Segments anzeigt, zeigt einen
// Bruchteil und nennt ihn die Etappe. Deshalb wird über `entry.segmentIndexes` SUMMIERT.
//
// 💣 UND DIE ZWEITE HÄLFTE: `null` heisst „keine Höhendaten", `0` heisst „gemessen und eben".
// Eine Umsetzung mit `Number(x) || 0` — genau die Form, in der direkt daneben `flow_time_factor`
// durchgereicht wird — macht aus beidem dieselbe 0 und behauptet 37 von 45 Etappen als vermessene
// Ebene. Dieser Test prüft beide Hälften strikt, Bauer und Leser.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Wie im Nachbartest: route-engine.js verdrahtet beim Laden die server-primäre Route und schiebt das
// ans Ende der Warteschlange. Hier soll nichts davon laufen — geprüft werden zwei reine Funktionen.
global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.getTransportOption = () => "groupFoot";
global.findPathByPublicId = () => null;

const load = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
load("../route-engine.js");
load("../route-plan.js");

// ---- der Bauer: das Anzeige-Segment trägt die Höhen des Servers --------------------------------
// 🪤 `transport_type` gehört zwingend in die Vorlage. Ohne ihn fällt der Bauer auf das echte
// `getTransportOption` aus route-engine.js zurück — das die Planer-Bedienelemente aus dem DOM liest
// und hier mit „getTransportOptionForRouteType is not defined" abbricht. Ein `global`-Stub hilft
// nicht: die Datei definiert die Funktion beim Laden selbst und überschreibt ihn. Der Nachbartest
// macht es aus demselben Grund so.
const build = (extra) => buildServerGeometryRouteSegment(
	{
		edge_id: "path-1", public_id: "aaaaaaaa-0000-0000-0000-000000000000",
		subtype: "Reichsstrasse", transport_type: "groupFoot", ...extra,
	},
	[[0, 0], [1, 0]]
);

const measured = build({ ascent_schritt: 669, descent_schritt: 0 });
assert.strictEqual(measured.properties.ascent_schritt, 669, "der Anstieg reist mit");
assert.strictEqual(measured.properties.descent_schritt, 0, "und ein gemessenes Gefälle von 0 auch");

// 💣 Der Kern: gemessen-eben bleibt 0 und wird NICHT zu null, ohne Daten bleibt null und wird NICHT
// zu 0. Eine `Number(x) || 0`-Fassung bestünde die erste Zeile und fiele über die zweite.
const flat = build({ ascent_schritt: 0, descent_schritt: 0 });
assert.strictEqual(flat.properties.ascent_schritt, 0, "gemessen eben ist 0, nicht null");
const unknown = build({});
assert.strictEqual(unknown.properties.ascent_schritt, null, "ohne Höhendaten ist es null, NICHT 0");
assert.strictEqual(unknown.properties.descent_schritt, null, "beide Hälften");

// ---- der Leser: summiert über die Segmente DER ETAPPE -------------------------------------------
const segments = [
	{ properties: { ascent_schritt: 669, descent_schritt: 0 } },     // 0: bergauf
	{ properties: { ascent_schritt: 52, descent_schritt: 1930 } },   // 1: bergab
	{ properties: { ascent_schritt: null, descent_schritt: null } }, // 2: keine Daten
	{ properties: { ascent_schritt: 0, descent_schritt: 0 } },       // 3: gemessen eben
	{ properties: { ascent_schritt: 100 } },                         // 4: halbes Paar, kaputt
	{ properties: {} },                                              // 5: gar nichts
];

// 💣 DIE ZUSICHERUNG, UM DIE ES GEHT: zwei Segmente, EIN Eintrag, BEIDE Zahlen addiert. Wer nur das
// erste Segment liest, bekommt 669/0 und behauptet, es gehe nur bergauf.
assert.deepStrictEqual(routeEntryTerrain({ segmentIndexes: [0, 1] }, segments),
	{ ascent: 721, descent: 1930, known: 2 },
	"eine Etappe aus zwei Segmenten addiert Anstieg UND Gefälle");

assert.deepStrictEqual(routeEntryTerrain({ segmentIndexes: [0] }, segments),
	{ ascent: 669, descent: 0, known: 1 }, "ein einzelnes Segment");

// Teilabdeckung: die unbekannten Segmente tragen NICHTS bei — keine geratene Null. Die Summe ist
// damit eine Untergrenze, und `known` sagt, aus wie vielen Segmenten sie stammt.
assert.deepStrictEqual(routeEntryTerrain({ segmentIndexes: [0, 2] }, segments),
	{ ascent: 669, descent: 0, known: 1 },
	"ein Segment ohne Höhendaten steuert nichts bei, statt als 0 zu zählen");

// Gemessen eben ist ein ERGEBNIS und liefert ein Objekt — nicht null. Ob daraus eine Zeile wird,
// entscheidet die Anzeige, nicht der Rechner.
assert.deepStrictEqual(routeEntryTerrain({ segmentIndexes: [3] }, segments),
	{ ascent: 0, descent: 0, known: 1 },
	"gemessen eben ist ein Ergebnis, kein Fehlen");

// 🪤 Ein halbes Paar ist keine halbe Messung, sondern eine kaputte Zeile — komplett verwerfen,
// sonst erfindet die fehlende Hälfte ein Gefälle von 0 und damit eine Steigung.
assert.strictEqual(routeEntryTerrain({ segmentIndexes: [4] }, segments), null,
	"ein Segment mit nur einer Hälfte wird ganz verworfen");

assert.strictEqual(routeEntryTerrain({ segmentIndexes: [2, 5] }, segments), null,
	"keine Höhendaten in der ganzen Etappe -> null, und die Infobox lässt die Zeile weg");
assert.strictEqual(routeEntryTerrain({}, segments), null, "eine Etappe ohne segmentIndexes");
assert.strictEqual(routeEntryTerrain(null, segments), null, "gar keine Etappe");
assert.strictEqual(routeEntryTerrain({ segmentIndexes: [99] }, segments), null,
	"ein Index ins Leere ist kein Absturz");

console.log("OK: route entry terrain -- summed over the leg, and null stays apart from zero");
