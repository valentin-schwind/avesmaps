// Reisekosten: Muenzformat, die drei Zustaende der Zollzeile und die Grenzzaehlung.
//
// 💣 Die Grenzzahl ist eine LAUFLAENGE, keine Schnittzahl. Eine Strasse, die an einer Grenze hin- und
// herpendelt, erzeugt Dutzende Geometrieschnitte -- der Reisende zahlt einmal. Ohne den Rauschfilter
// meldete die echte Route Gareth->Fasar 39 Uebertritte statt 4.
//
// 💣 Und „nicht abrufbar" ist nicht „null Grenzen". Ohne Herrschaftsgebiete (lokal ohne Datenbank)
// saehe eine Reise quer durch drei Reiche zollfrei aus -- das waere keine fehlende Angabe, sondern
// eine falsche.
//
// Run from the repo root:  node js/routing/__tests__/travel-costs.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "", hostname: "localhost" }, addEventListener() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [] };

// Die ECHTEN Preistabellen aus config.js, nicht nachgebaute: ein Nachbau wuerde genau die
// Zahlendreher verstecken, die dieser Test finden soll.
const configSource = fs.readFileSync(path.join(__dirname, "..", "..", "config.js"), "utf8");
function exportConstBlock(source, firstName, lastName) {
	const start = source.indexOf(`const ${firstName}`);
	assert.notStrictEqual(start, -1, `${firstName} not found in config.js`);
	const lastStart = source.indexOf(`const ${lastName}`, start);
	assert.notStrictEqual(lastStart, -1, `${lastName} not found in config.js`);
	const end = source.indexOf("\n};", lastStart);
	assert.notStrictEqual(end, -1, `end of ${lastName} not found`);
	return source.slice(start, end + 3);
}
const costTables = exportConstBlock(configSource, "TRAVEL_COST_LODGING_KEYS", "TRAVEL_COST_MOUNTS_PER_TRAVELLER");
vm.runInThisContext(`${costTables}
global.TRAVEL_COST_LODGING_KEYS = TRAVEL_COST_LODGING_KEYS;
global.TRAVEL_COST_LODGING = TRAVEL_COST_LODGING;
global.TRAVEL_COST_SHOE_PER_HOOF = TRAVEL_COST_SHOE_PER_HOOF;
global.TRAVEL_COST_HOOVES_PER_MOUNT = TRAVEL_COST_HOOVES_PER_MOUNT;
global.TRAVEL_COST_RIVER_UPSTREAM_FACTOR = TRAVEL_COST_RIVER_UPSTREAM_FACTOR;
global.TRAVEL_COST_SHELTER_BY_SUBTYPE = TRAVEL_COST_SHELTER_BY_SUBTYPE;
global.TRAVEL_COST_MOUNTS_PER_TRAVELLER = TRAVEL_COST_MOUNTS_PER_TRAVELLER;`);
global.DISTANCE_SCALING_FACTOR = 3;
global.DEFAULT_PLANNER_STATE = { lodging: "bett", restHours: 12 };

// Der echte Zahlenformatierer und der echte Muenzformatierer aus utils.js.
const utilsSource = fs.readFileSync(path.join(__dirname, "..", "..", "app", "utils.js"), "utf8");
function exportFunction(source, name) {
	const start = source.indexOf(`function ${name}(`);
	assert.notStrictEqual(start, -1, `${name} not found in utils.js`);
	const end = source.indexOf("\n}", start);
	return `${source.slice(start, end + 2)}\nglobal.${name} = ${name};`;
}
global.tr = (key, fallback, params) => {
	let text = String(fallback === undefined ? key : fallback);
	Object.entries(params || {}).forEach(([name, value]) => {
		text = text.split(`{${name}}`).join(String(value));
	});
	return text;
};
vm.runInThisContext(exportFunction(utilsSource, "formatDecimalNumber"));
vm.runInThisContext(exportFunction(utilsSource, "formatAventurianMoney"));

global.getPlannerLodging = () => "bett";
global.getPlannerTravelHoursPerDay = () => 12;
global.getTransportOption = () => "groupHorse";
global.POLITICAL_TERRITORIES_API_URL = "";
global.fetchPoliticalTerritories = undefined;
global.console = console;

const costsSource = fs.readFileSync(path.join(__dirname, "..", "route-costs.js"), "utf8");
vm.runInThisContext(`${costsSource}
global.buildTravelCostRows = buildTravelCostRows;
global.avesmapsCountRouteStateBorders = avesmapsCountRouteStateBorders;
global.avesmapsTravelCostPrepareTerritory = avesmapsTravelCostPrepareTerritory;`);

// ---------------------------------------------------------------------------------------------
// 1. Muenzschreibweise
// ---------------------------------------------------------------------------------------------
assert.strictEqual(formatAventurianMoney(0), "—", "nichts zu zahlen ist ein Gedankenstrich, keine Null");
assert.strictEqual(formatAventurianMoney(4), "4 H");
assert.strictEqual(formatAventurianMoney(30), "3 S");
assert.strictEqual(formatAventurianMoney(846), "8 D 4 S 6 H");
// 💣 Die leere Zwischenstelle faellt WEG. 403 Heller sind „4 D 3 H", nicht „4 D 0 S 3 H".
assert.strictEqual(formatAventurianMoney(403), "4 D 3 H");
// Tausendertrennung im deutschen Panel -- der Dukatenteil laeuft ueber formatDecimalNumber.
assert.strictEqual(formatAventurianMoney(123456), "1.234 D 5 S 6 H");

// ---------------------------------------------------------------------------------------------
// 2. Die drei Zustaende der Zollzeile
// ---------------------------------------------------------------------------------------------
const entries = [
	{ type: "Reichsstrasse", distance: 300, travelTime: 60 },
	{ type: "Strasse", distance: 200, travelTime: 40 },
];
const summary = { totalHours: 216 };   // 9 Tage, 9 Naechte

const pending = buildTravelCostRows(entries, summary, { stateBorders: null });
const pendingToll = pending.rows.find((row) => row.key === "tolls");
assert.strictEqual(pendingToll.heller, null, "solange die Grenzen laufen, gibt es keinen Betrag");
assert.match(pendingToll.note, /ermittelt/, "und die Zeile sagt, dass sie noch laeuft");

const unavailable = buildTravelCostRows(entries, summary, { stateBorders: false });
const unavailableToll = unavailable.rows.find((row) => row.key === "tolls");
assert.strictEqual(unavailableToll.heller, null, "nicht abrufbar ist NICHT null Zoll");
assert.match(unavailableToll.note, /nicht ermittelbar/);

const known = buildTravelCostRows(entries, summary, { stateBorders: 4 });
const knownToll = known.rows.find((row) => row.key === "tolls");
// 💣 JE PERSON. 4 Grenzen × 1 Dukat (Soeldner-Veranlagung bei „bett") = 400 Heller -- eine
// Gruppengroesse gibt es bewusst nicht, sie waere ein Feld fuer eine Kopfrechnung.
assert.strictEqual(knownToll.heller, 400, "vier Grenzen zum Soeldnersatz, je Person");
assert.match(knownToll.note, /4 Landesgrenzen/);

// ---------------------------------------------------------------------------------------------
// 3. „Im Freien" kostet kein Bett -- auch wo eine Herberge stuende
// ---------------------------------------------------------------------------------------------
const outdoors = buildTravelCostRows(entries, summary, { stateBorders: 0, lodging: "frei" });
const outdoorBed = outdoors.rows.find((row) => row.key === "lodging");
assert.strictEqual(outdoorBed.heller, 0, "wer im Freien schlaeft, zahlt auch an der Reichsstrasse nichts");
assert.strictEqual(outdoors.innNights, 0);
assert.strictEqual(outdoors.openNights, 9, "alle neun Naechte im Freien");

// Und umgekehrt: auf einem Pfad gibt es kein Bett, egal was gewaehlt ist.
const trackOnly = buildTravelCostRows(
	[{ type: "Pfad", distance: 400, travelTime: 108 }],
	summary,
	{ stateBorders: 0, lodging: "zimmer" }
);
assert.strictEqual(trackOnly.innNights, 0, "der Pfad bietet kein Dach, auch nicht fuer Zahlungskraeftige");
assert.strictEqual(trackOnly.rows.find((row) => row.key === "lodging").heller, 0);

// ---------------------------------------------------------------------------------------------
// 4. Grenzzaehlung: Lauflaenge, nicht Schnittzahl
// ---------------------------------------------------------------------------------------------
const square = (x0, y0, x1, y1) => ({
	type: "Feature",
	properties: { name: `${x0}-${x1}` },
	geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
});
const westEast = [
	avesmapsTravelCostPrepareTerritory(square(0, 0, 100, 100)),
	avesmapsTravelCostPrepareTerritory(square(100, 0, 200, 100)),
];

// Eine gerade Linie quer durch beide Reiche: genau ein Uebertritt.
const straight = [{ geometry: { type: "LineString", coordinates: [[10, 50], [190, 50]] } }];
assert.strictEqual(avesmapsCountRouteStateBorders(straight, westEast), 1, "eine Grenze, einmal ueberschritten");

// 💣 Der Kern: eine Strasse, die sechsmal um die Grenze pendelt -- aber immer nur ein oder zwei
// Meilen weit. Das sind Zacken des Grenzverlaufs, keine Zollhaeuschen.
const wobble = [{
	geometry: {
		type: "LineString",
		coordinates: [[10, 50], [99, 50], [100.3, 50], [99, 50], [100.3, 50], [99, 50], [190, 50]],
	},
}];
assert.strictEqual(avesmapsCountRouteStateBorders(wobble, westEast), 1,
	"das Pendeln an der Grenze ist EIN Uebertritt, nicht fuenf");

// Ein echter Wiedereintritt bleibt dagegen stehen: weit genug hinein, um kein Rauschen zu sein.
const realReturn = [{
	geometry: { type: "LineString", coordinates: [[10, 50], [150, 50], [50, 50], [190, 50]] },
}];
assert.strictEqual(avesmapsCountRouteStateBorders(realReturn, westEast), 3,
	"hinueber, zurueck, wieder hinueber -- drei echte Uebertritte");

// Offene See traegt keinen Zoll: ein Wechsel von oder zu „kein Gebiet" ist kein Uebertritt.
const intoTheSea = [{ geometry: { type: "LineString", coordinates: [[10, 50], [90, 50], [90, 500], [10, 500]] } }];
assert.strictEqual(avesmapsCountRouteStateBorders(intoTheSea, westEast), 0,
	"das Verlassen des Landes ist kein Grenzuebertritt");

// Ohne Herrschaftsgebiete gibt es KEIN Ergebnis -- nicht die Zahl null.
assert.strictEqual(avesmapsCountRouteStateBorders(straight, []), null,
	"ohne Gebiete bleibt die Antwort offen, sie wird nicht zu 0");

// ---------------------------------------------------------------------------------------------
// 5. Was die Kostenrechnung aus der ETAPPENART liest (Meldung #102)
// ---------------------------------------------------------------------------------------------
// 💣 DIESE ZWEI ZEILEN SIND DER GRUND, WARUM DER GRENZ-LAUF LAND UND WASSER TRENNEN MUSS.
// `buildTravelCostRows` zaehlt Flussmeilen an `type === "Flussweg"`, und die Frage nach dem Dach
// ueber Nacht geht ueber `TRAVEL_COST_SHELTER_BY_SUBTYPE[type]`. Verschmilzt eine kurze Landetappe
// mit der Flussfahrt dahinter, erbt diese „Weg" -- und beide Rechnungen antworten still falsch.
// Live gemessen am 26.08.2026 (Gareth -> Perricum): 3,042 Meilen Weg vor dem Anleger, 187,667
// Meilen Fluss dahinter; angezeigt wurden 8 x Gemeinschaftszimmer und keine Flusspassage.
// ⭐ Gegenstueck in js/routing/__tests__/land-wasser-etappe-trennen.test.js -- dort steht, dass die
// zwei Etappen getrennt bleiben; hier steht, WARUM das eine Rechnung und keine Beschriftung ist.
const gemischteReise = [
	{ type: "Weg", transport: "groupFoot", distance: 3.042, travelTime: 0.896 },
	{ type: "Flussweg", transport: "riverSailer", flowState: "downstream", distance: 187.667, travelTime: 37.221 },
];
const gemischt = buildTravelCostRows(gemischteReise, { totalHours: 216 }, { stateBorders: 0 });
const flussZeile = gemischt.rows.find((row) => row.key === "river");
assert.ok(flussZeile, "die getrennte Flussetappe erzeugt die Zeile Flusspassage");
assert.ok(flussZeile.heller > 0, "und sie kostet etwas");
assert.match(flussZeile.note, /187,7/, "ueber ihre eigenen Meilen, nicht ueber die der ganzen Reise");
assert.ok(gemischt.aboardNights > 0, "und es wird an Bord geschlafen");

// Und derselbe Weg mit verschmolzener Art -- der Zustand VOR der Reparatur. Er steht hier, damit
// niemand die Trennung fuer Kosmetik haelt: dieselbe Reise, dieselbe Strecke, andere Rechnung.
const verschmolzen = buildTravelCostRows(
	[{ type: "Weg", transport: "groupFoot", distance: 190.709, travelTime: 38.117 }],
	{ totalHours: 216 },
	{ stateBorders: 0 }
);
assert.strictEqual(verschmolzen.rows.find((row) => row.key === "river"), undefined,
	"als Landetappe getarnt faellt die Flusspassage ersatzlos weg");
assert.strictEqual(verschmolzen.aboardNights, 0, "und aus den Naechten an Bord werden Wirtshausnaechte");
assert.ok(verschmolzen.innNights > gemischt.innNights,
	"die Verschmelzung macht die Reise teurer, nicht nur ungenauer");

console.log("travel-costs.test.js: alle Prüfungen bestanden");
