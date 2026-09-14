"use strict";
// Wegpunkte zu `via`-Anfragen buendeln (Entwurf 2026-09-14 §5.3): die Regel AUSGEFUEHRT, dazu der echte
// buildRouteResultFromSelectedLocationsServer gegen eine Server-Attrappe -- gebuendelt und paarweise gleich.
// Aus der Wurzel: node js/routing/__tests__/route-buendel.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const B = require(path.join(WURZEL, "js/routing/route-buendel.js"));
const orte = (n, kartenpunkte = []) => Array.from({ length: n }, (_, i) => ({ name: "Ort" + i, ...(kartenpunkte.includes(i) ? { isMapPoint: true } : {}) }));

// 1. Die Regel
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(2), 10), [{ von: 0, bis: 1 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(40), 10),
	[{ von: 0, bis: 11 }, { von: 11, bis: 22 }, { von: 22, bis: 33 }, { von: 33, bis: 39 }], "40 Wegpunkte -> 4 Anfragen (§6 D)");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(12), 10), [{ von: 0, bis: 11 }], "12 Orte = 10 Zwischenhalte = eine Anfrage");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(13), 10), [{ von: 0, bis: 11 }, { von: 11, bis: 12 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(8, [5]), 10), [{ von: 0, bis: 5 }, { von: 5, bis: 7 }], "ein Kartenpunkt ist Buendelgrenze");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(8, [0, 7]), 10), [{ von: 0, bis: 7 }], "am Anfang und am Ende darf er stehen");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(6, [3, 4]), 10), [{ von: 0, bis: 3 }, { von: 3, bis: 4 }, { von: 4, bis: 5 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(4), 0), [{ von: 0, bis: 1 }, { von: 1, bis: 2 }, { von: 2, bis: 3 }], "Deckel 0: Paare");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(1), 10), []);
assert.deepStrictEqual(B.avesmapsRouteBuendel([], 10), []);
for (const n of [2, 3, 11, 12, 13, 24, 25, 39, 40, 41]) {
	const buendel = B.avesmapsRouteBuendel(orte(n, [7, 19]), 10);
	assert.strictEqual(buendel[0].von, 0);
	assert.strictEqual(buendel[buendel.length - 1].bis, n - 1, "das letzte Buendel endet am Ziel");
	buendel.forEach((b, i) => {
		assert.ok(b.bis - b.von - 1 <= 10, "hoechstens 10 Zwischenhalte: " + JSON.stringify(b));
		if (i > 0) { assert.strictEqual(b.von, buendel[i - 1].bis, "lueckenlos"); }
		for (let k = b.von + 1; k < b.bis; k += 1) { assert.ok(![7, 19].includes(k), "kein Kartenpunkt in via: " + n); }
	});
}

// 2. Der Zwilling des Server-Deckels
const php = lies("api/_internal/routing/request.php").match(/const AVESMAPS_ROUTE_MAX_VIA = (\d+);/);
assert.ok(php, "AVESMAPS_ROUTE_MAX_VIA in request.php nicht gefunden");
assert.strictEqual(B.AVESMAPS_ROUTE_MAX_VIA, Number(php[1]), "Client- und Server-Deckel sind EIN Wert");

// 3. Gebuendelt und paarweise dasselbe -- der echte Aufrufer gegen eine Server-Attrappe
global.window = { location: { search: "" }, setTimeout: () => 0 };
global.tr = (key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, n) => (vars && vars[n] !== undefined ? vars[n] : ""));
global.showRouteNotice = () => {};
global.$ = () => ({ is: () => false, val: () => "fastest", text: () => {} });
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "groupFoot" });
global.getPlannerRestHoursPerDay = () => 16;
global.normalizePathSubtype = (v) => String(v || "Weg");
global.findPathByPublicId = () => null;
global.pathData = [];
global.syntheticPathSegments = new Map();
global.getTransportOptionForRouteType = () => "groupFoot";
global.routePlanDepartureFromPanel = () => null;
vm.runInThisContext(lies("js/routing/route-engine.js"), { filename: "route-engine.js" });

const etappe = (von, nach) => ({ edge_id: von + ">" + nach, from_node: von, to_node: nach, subtype: "Strasse",
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } });
let anfragen = [];
global.calculateRouteServer = async (anfrage) => {
	anfragen.push(JSON.parse(JSON.stringify(anfrage)));
	const stationen = [anfrage.from, ...anfrage.via, anfrage.to];
	const segmente = stationen.slice(1).map((nach, i) => etappe(stationen[i], nach));
	return { source: "server", ok: true, found: true, segments: segmente,
		route: { found: true, segments: segmente, duration: { travel_days: segmente.length }, closures: [] } };
};
global.selectedLocations = orte(25, [13]);
global.avesmapsRouteBuendel = B.avesmapsRouteBuendel;
global.AVESMAPS_ROUTE_MAX_VIA = B.AVESMAPS_ROUTE_MAX_VIA;

(async () => {
	const gebuendelt = await buildRouteResultFromSelectedLocationsServer(false);
	const gebuendeltAnfragen = anfragen;
	anfragen = [];
	delete global.avesmapsRouteBuendel;
	const paarweise = await buildRouteResultFromSelectedLocationsServer(false);

	assert.strictEqual(gebuendeltAnfragen.length, 3, "25 Orte mit Kartenpunkt bei 13: [0..11] [11..13] [13..24]");
	assert.deepStrictEqual([gebuendeltAnfragen[0].from, gebuendeltAnfragen[0].via.length, gebuendeltAnfragen[0].to], ["Ort0", 10, "Ort11"]);
	assert.deepStrictEqual(gebuendeltAnfragen[1].via, ["Ort12"]);
	assert.strictEqual(anfragen.length, 24, "ohne route-buendel.js je Paar eine Anfrage (Rueckfall)");
	assert.deepStrictEqual(gebuendelt.routeNodeNames, paarweise.routeNodeNames, "dieselben Knotennamen");
	assert.deepStrictEqual(gebuendelt.segments, paarweise.segments, "dieselben Etappen");
	assert.strictEqual(gebuendelt.segments.length, 24);

	// 4. Ladereihenfolge
	const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	const buendelTag = seite.indexOf('<script src="js/routing/route-buendel.js"></script>');
	assert.ok(buendelTag > 0 && buendelTag < seite.indexOf('<script src="js/routing/route-engine.js"></script>'), "route-buendel.js laedt vor route-engine.js");

	console.log("route-buendel.test.js: ok");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
