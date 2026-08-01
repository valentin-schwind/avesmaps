// Ein angeklickter Kartenpunkt ist ein Wegpunkt, und ein Wegpunkt ist ein STÜCK TEXT.
//
// 💣 DIESES MUSTER TRAEGT JETZT DEN PLANER. `validateLocation` faellt darauf zurueck, wenn kein Ort
// des Namens existiert -- ohne das fliegt die Kartenpunkt-Zeile beim naechsten Neuberechnen als „Ort
// nicht gefunden" heraus. Umgekehrt darf es keinen ECHTEN Ortsnamen verschlucken: „Nostria (Stadt)"
// ist die uebliche Wiki-Klammer, und ein Ort, der versehentlich als Koordinate gelesen wird, landet
// mitten im Meer.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {} };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
global.tr = (key, fallback) => fallback;
global.L = { latLng: (lat, lng) => ({ lat, lng }) };

const file = path.join(__dirname, "../route-travel-here.js");
vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });

// ---- was ein Kartenpunkt ist --------------------------------------------------------------------
assert.deepStrictEqual(
	parseMapPointWaypoint("Kartenpunkt (657.150, 270.990)"),
	{ name: "Kartenpunkt (657.150, 270.990)", coordinates: [657.15, 270.99], isMapPoint: true },
	"der Text traegt lat und lng"
);

// ⚠️ Das Wort ist uebersetzbar (`?lang=en` -> „Map point"), die Zahlen sind es nicht. Das Muster
// haengt deshalb an den Klammern am Ende, nicht am Wort.
assert.strictEqual(parseMapPointWaypoint("Map point (12, 34)")?.isMapPoint, true, "auch mit englischem Wort");
assert.deepStrictEqual(parseMapPointWaypoint("Map point (12, 34)").coordinates, [12, 34], "und mit denselben Zahlen");

// Deutsches Zahlformat und Semikolon -- was jemand von Hand eintippt, soll auch gelesen werden.
assert.deepStrictEqual(parseMapPointWaypoint("Kartenpunkt (657,150; 270,990)").coordinates, [657.15, 270.99],
	"Komma als Dezimaltrenner, Semikolon als Trennzeichen");

// ---- und was KEINER ist -------------------------------------------------------------------------
// 💣 Die wichtigste Zusicherung dieser Datei. Die Wiki-Klammer ist ein WORT, keine Zahl -- und der
// Bestand ist voll davon.
for (const name of ["Nostria (Stadt)", "Gareth", "", "Auge des Riesen (Ruine)", "Havena (Hafen, Nordost)"]) {
	assert.strictEqual(parseMapPointWaypoint(name), null, `„${name}" ist ein Ortsname, kein Kartenpunkt`);
}

// Halbe Klammern sind auch keine.
assert.strictEqual(parseMapPointWaypoint("Kartenpunkt (657.150)"), null, "eine Zahl allein ist keine Koordinate");
assert.strictEqual(parseMapPointWaypoint("Kartenpunkt (657.150, 270.990) Zusatz"), null, "die Klammer steht am ENDE");

// ---- die Koordinate reist neben der Beschriftung ------------------------------------------------
// 💣 x = lng, y = lat. GeoJSON gegen Leaflet -- die eine Vertauschung dieses Features, und sie wird
// hier festgehalten, weil eine vertauschte Route auf einer 1024er-Karte irgendwo landet statt zu
// scheitern.
const punkt = parseMapPointWaypoint("Kartenpunkt (657.150, 270.990)");
assert.deepStrictEqual(applyMapPointRouteEndpoints({}, null, punkt), { to_point: { x: 270.99, y: 657.15 } },
	"das Ziel wird zu to_point, x aus lng");
assert.deepStrictEqual(applyMapPointRouteEndpoints({}, punkt, null), { from_point: { x: 270.99, y: 657.15 } },
	"und der Start zu from_point");

// Zwei Kartenpunkte hintereinander sind erlaubt -- der Server haengt beide Enden an.
assert.deepStrictEqual(applyMapPointRouteEndpoints({}, punkt, punkt),
	{ from_point: { x: 270.99, y: 657.15 }, to_point: { x: 270.99, y: 657.15 } }, "beide Enden");

// Ein gewoehnlicher Ort ruehrt die Anfrage nicht an.
assert.deepStrictEqual(applyMapPointRouteEndpoints({ from: "Gareth" }, { name: "Gareth", coordinates: [1, 2] }, null),
	{ from: "Gareth" }, "ein Ort bleibt ein Name");

// ---- die drei Ablehnungsgruende -----------------------------------------------------------------
// Nur diese drei bekommen einen deutschen Satz; alles andere ist ein echter Fehler und behaelt seine
// eigene Meldung.
for (const code of ["point_not_on_land", "no_exit_node", "no_offroad_route"]) {
	assert.strictEqual(isTravelHereErrorCode(code), true, `${code} ist eine Auskunft ueber die Welt`);
	assert.notStrictEqual(travelHereErrorMessage(code), travelHereErrorMessage("generisch"), `${code} hat einen eigenen Satz`);
}
for (const code of ["server_error", "location_not_found", "", undefined]) {
	assert.strictEqual(isTravelHereErrorCode(code), false, `${code} ist ein Fehler, keine Auskunft`);
}

console.log("map-point-waypoint: OK");
