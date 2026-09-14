"use strict";
// „Weg als Route" (Entwurf 2026-09-14 §5): welche Orte in welcher Reihenfolge -- AUSGEFUEHRT, rein und gegen eine
// kleine Karte; dazu die Kachel und der Klickzweig.
// Aus der Wurzel: node js/routing/__tests__/weg-als-route.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt fehlt: " + anfang);
	return text.slice(a, e);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w),
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: (ort) => ort.kreuzung === true,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: false,
});
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
// Attrappe fuer avesmapsWegTraegerIndex (entsteht in weg-weitere-anzeige.js, Task 11): gleiche Bedeutung --
// wiki_key -> Pfade, die den Artikel als WEITERE Zuweisung tragen.
global.avesmapsWegTraegerIndex = () => {
	const nachKey = new Map();
	(Array.isArray(global.pathData) ? global.pathData : []).forEach((pfad) => {
		(Array.isArray(pfad.properties.wiki_path_weitere) ? pfad.properties.wiki_path_weitere : []).forEach((eintrag) => {
			const key = String((eintrag && eintrag.wiki_key) || "");
			if (!key) { return; }
			if (!nachKey.has(key)) { nachKey.set(key, []); }
			nachKey.get(key).push(pfad);
		});
	});
	return nachKey;
};
const R = require(path.join(WURZEL, "js/routing/weg-als-route.js"));

// 1. Rein
const w = (von, bis, a, b) => ({ ends: { from: von, to: bis }, enden: { von: a, bis: b } });
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([2, 0], [1, 0], "Wieha", "Silkwiesen"), w([2, 0], [3, 0], "Wieha", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ein gedrehter Abschnitt laeuft rueckwaerts mit");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([1, 0], [2, 0], "Silkwiesen", "Wieha"), w([10, 0], [3, 0], "Ferne", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl", "Ferne"], "ueber die Luecke zum naechsten Ende, das Stueck dafuer umgedreht");
const auslassen = (name) => name === "Kreuzung" || name === "Wegende" || name === "Versteck";
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Kreuzung"), w([1, 0], [2, 0], "Kreuzung", "Versteck"),
	w([2, 0], [3, 0], "Versteck", "Perz"), w([3, 0], [4, 0], "Perz", "Wegende"),
], auslassen), ["Perz"], "Kreuzung, Wegende, Verborgenes fallen weg, und Dopplungen hintereinander auch");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([]), []);
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([{ public_id: "ohne" }]), [], "ohne Enden nichts");

// 2. Gegen eine kleine Karte: der Baerenpfad laeuft ueber den Reichsstrassen-Abschnitt, der ihn als weitere Zuweisung traegt
global.locationData = [
	{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] }, { name: "Wieha", coordinates: [0, 2] },
	{ name: "Helmdahl", coordinates: [0, 3] }, { name: "Rudein", coordinates: [5, 0] }, { name: "Espen", coordinates: [5, 3] },
];
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const RS = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const BP = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
const weg = (id, von, bis, haupt, weitere = []) => ({
	properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "M-" + id, display_name: haupt.name,
		wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] },
});
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], RS),
	weg("rs-7", [1, 0], [2, 0], RS, [{ wiki_key: BP.key, name: BP.name, wiki_url: url(BP.seite) }]),
	weg("rs-8", [2, 0], [3, 0], RS),
	weg("bp-1", [0, 5], [1, 0], BP),
	weg("bp-2", [2, 0], [3, 5], BP),
	weg("x-1", [8, 8], [9, 9], { key: "x", name: "X", seite: "X" }),
];
const [rs6, rs7, rs8, bp1] = global.pathData;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"]);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(bp1), ["Rudein", "Silkwiesen", "Wieha", "Espen"], "der Baerenpfad-Fall (§6 D)");

// 3. Editoren: das Markierte -- am Abschnitt nur er
global.IS_EDIT_MODE = true;
global.avesmapsWegAuswahlFuerPfad = (p) => (p === rs7 ? { gruppe: "wiki:reichsstrasse-2", publicId: "rs-7" } : null);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs7), ["Silkwiesen", "Wieha"]);
global.avesmapsWegAuswahlFuerPfad = () => ({ gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs8), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ganze Strasse markiert: die ganze Strasse");
global.IS_EDIT_MODE = false;

// 4. Verborgene Orte und Kreuzungen werden uebersprungen
global.locationData.find((o) => o.name === "Wieha").isHidden = true;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Helmdahl"], "ein verborgener Ort heisst wie der Ort -- und wird uebersprungen");
global.locationData.find((o) => o.name === "Silkwiesen").kreuzung = true;
global.mapDataSourceStatus = { revision: 2 };   // neuer Kartenstand: der Ortsindex rechnet neu
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Helmdahl"], "eine Kreuzung heisst „Kreuzung\" und faellt weg");

// 5. Die Kachel: dieselbe Bedingung wie „Anzeigen"
const rendering = lies("js/map-features/map-features-path-rendering.js");
const kachelKontext = vm.createContext({
	popupActionButtonMarkup: (spec) => JSON.stringify(spec),
	pathSupportsItemLinks: (p) => p.properties.feature_subtype !== "Seeweg",
	getPathPublicId: (p) => p.properties.public_id,
	tr: (key, fallback) => fallback,
});
vm.runInContext(schneide(rendering, "function pathWegAktionErlaubt(path) {", "\n// Kopf-Icon fuer den Weg-Kopf"), kachelKontext);
const kachelBauen = vm.runInContext("pathAlsRouteKachelMarkup", kachelKontext);
const kachel = JSON.parse(kachelBauen(rs6));
assert.strictEqual(kachel.label, "Weg als Route");
assert.ok(kachel.iconMarkup.includes('src="img/menu/waypoint-end.webp"'), kachel.iconMarkup);
assert.deepStrictEqual(kachel.attributes, { "data-popup-action": "path-as-route", "data-public-id": "rs-6" });
assert.strictEqual(kachelBauen({ properties: { public_id: "s", feature_subtype: "Seeweg", wiki_path: { wiki_url: url("Meer") } } }), "", "kein Seeweg");
assert.strictEqual(kachelBauen({ properties: { public_id: "o", feature_subtype: "Weg" } }), "", "ohne Wiki-Artikel keine Kachel (§8)");
const popup = schneide(rendering, "function createPathPopupMarkup(path) {", "\n// Zeichen-Reihenfolge der Wege");
assert.ok(popup.indexOf("pathAlsRouteKachelMarkup(path)") > popup.indexOf("buildSuggestChangeButtonSpec"), "die Kachel steht nach „Änderungen vorschlagen\" (§5.1)");

// 6. Der Klickzweig: die Orte ERSETZEN die Wegpunkte (§5.2), ausgefuehrt
const routing = lies("js/routing/routing.js");
const zweig = schneide(routing, 'if (action === "path-as-route") {', "\n\t}\n");
const lauf = [];
const zweigKontext = vm.createContext({
	findPathByPublicId: (id) => global.pathData.find((p) => p.properties.public_id === id) || null,
	avesmapsWegAlsRouteFuerPfad: R.avesmapsWegAlsRouteFuerPfad,
	resetWaypointInputs: (namen) => { lauf.push(["ersetzen", [...namen]]); },
	updateMapView: () => { lauf.push(["rechnen"]); },
	showFeedbackToast: (text) => { lauf.push(["meldung", text]); },
	tr: (key, fallback) => fallback,
});
const klicke = vm.runInContext("(function (action) {\n\t" + zweig + "\n\t}\n})", zweigKontext);
klicke.call({ dataset: { publicId: "rs-6" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["ersetzen", ["Perz", "Helmdahl"]], ["rechnen"]]);
lauf.length = 0;
klicke.call({ dataset: { publicId: "x-1" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["meldung", "Dieser Weg verbindet keine zwei Orte."]], "unter zwei Orten wird nichts ersetzt");

// 7. Englisch und Ladereihenfolge
const en = lies("js/app/i18n-en.js");
assert.ok(en.includes('"popup.pathAsRoute": "Way as route",'), "i18n popup.pathAsRoute");
assert.ok(en.includes('"toast.path.asRouteTooShort": "This way does not connect two places.",'), "i18n toast.path.asRouteTooShort");
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const tag = seite.indexOf('<script src="js/routing/weg-als-route.js"></script>');
assert.ok(tag > 0 && tag > seite.indexOf('<script src="js/map-features/weg-abschnitte.js"></script>'), "index.html laedt weg-als-route.js nach dem Weg-Abschnittsnamen-Modul");

console.log("weg-als-route.test.js: ok");
