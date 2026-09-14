"use strict";
// Die Klickfolge auf der Karte (Entwurf 2026-09-14 §3): Zustand, gelbe Linie, gestrichelte Traeger, Aufheben,
// Markierungszeile und Editorband. AUSGEFUEHRT: updatePathLayerStyle und createPathPopupMarkup werden aus
// map-features-path-rendering.js geschnitten und mit Attrappen gefahren.
// Aus der Wurzel: node js/map-features/__tests__/weg-auswahl-karte.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt nicht gefunden: " + anfang);
	return text.slice(a, e);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	pathItemStationLinkMarkup: (text) => text,
	wikiUrlToDeeplinkKey: (url) => String(url || "").split("/wiki/")[1] || "",
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: true,
	SPOTLIGHT_PATH_HIGHLIGHT_STYLE: { color: "#ffd72e" },
	getPathStyleColors: () => ({ outline: "#rand", outlineWeight: 4, outlineOpacity: 1, center: "#mitte", centerWeight: 2 }),
	refreshPathLayerText: () => {},
	window: {},
});
const neuGebaut = [];
global.refreshPathLayerPopup = (p) => { neuGebaut.push(p.properties.public_id); p._popupMarkup = "neu"; };
global.findPathByPublicId = (id) => global.pathData.find((p) => p.properties.public_id === id) || null;
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-weitere-anzeige.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-auswahl.js")));
const K = require(path.join(WURZEL, "js/map-features/map-features-weg-auswahl.js"));
Object.assign(global, K);

const rendering = lies("js/map-features/map-features-path-rendering.js");
vm.runInThisContext(schneide(rendering, "function updatePathLayerStyle(path) {", "\nfunction getPathVisualLatLngCoordinates"));

global.locationData = [
	{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] },
	{ name: "Wieha", coordinates: [0, 2] }, { name: "Helmdahl", coordinates: [0, 3] },
];
const linie = () => ({ options: {}, setStyle(o) { Object.assign(this.options, o); } });
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const RS = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const BP = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
const weg = (id, von, bis, haupt, weitere = []) => ({
	properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id, display_name: haupt.name,
		wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] },
	_pathLines: [linie(), linie()],
});
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], RS),
	weg("rs-7", [1, 0], [2, 0], RS, [{ wiki_key: BP.key, name: BP.name, wiki_url: url(BP.seite) }]),
	weg("rs-8", [2, 0], [3, 0], RS),
	weg("bp-1", [5, 5], [6, 6], BP),
];
const [rs6, rs7, rs8, bp1] = global.pathData;
const farbe = (p) => p._pathLines[1].options.color;
const strich = (p) => p._pathLines[1].options.dashArray || null;
global.pathData.forEach((p) => updatePathLayerStyle(p));
assert.strictEqual(farbe(rs7), "#mitte");

// 1. Erster Klick: die ganze Strasse gelb, der fremde Weg nicht, die Aussenlinie unveraendert
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), ["#ffd72e", "#ffd72e", "#ffd72e"]);
assert.strictEqual(farbe(bp1), "#mitte");
assert.strictEqual(rs7._pathLines[0].options.color, "#rand", "keine Umrandung: die Aussenlinie bleibt");
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(bp1), null);
assert.ok(neuGebaut.includes("rs-7"), "das Markup des geklickten Wegs wird neu gebaut");

// 2. Zweiter Klick: nur der Abschnitt
neuGebaut.length = 0;
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "wiki:reichsstrasse-2", publicId: "rs-7" });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), ["#mitte", "#ffd72e", "#mitte"]);
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null, "ein abgewaehlter Abschnitt meldet keine Auswahl");
assert.ok(neuGebaut.includes("rs-6") && neuGebaut.includes("rs-8"), "die abgewaehlten Abschnitte bekommen ihr Markup zurueck");

// 3. Der Baerenpfad: seine ganze Strasse gelb, der Reichsstrassen-Abschnitt mit ihm als weiterer Zuweisung gestrichelt
K.avesmapsWegAuswahlKlick(bp1);
assert.strictEqual(farbe(bp1), "#ffd72e");
assert.strictEqual(strich(bp1), null);
assert.strictEqual(farbe(rs7), "#ffd72e");
assert.strictEqual(strich(rs7), "8 8", "fremder Traeger: gestrichelt");
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs7), null, "ein Traeger ist angezeigt, nicht markiert");

// 4. Neufaerben (Live-Abgleich, Pruefhaken) laesst die Markierung stehen
updatePathLayerStyle(bp1);
updatePathLayerStyle(rs7);
assert.strictEqual(farbe(bp1), "#ffd72e");
assert.strictEqual(strich(rs7), "8 8");

// 5. Ein Klick daneben hebt alles auf -- auch den Strich; einmal verdrahtet
const anmeldungen = [];
global.map = { on: (ereignis, fn) => { anmeldungen.push([ereignis, fn]); } };
let aufgefrischt = 0;
global.window.avesmapsRefreshInfopanel = () => { aufgefrischt += 1; };
K.avesmapsWegAuswahlVerdrahten();
K.avesmapsWegAuswahlVerdrahten();
assert.strictEqual(anmeldungen.length, 1, "genau ein Zuhoerer");
assert.strictEqual(anmeldungen[0][0], "click");
anmeldungen[0][1]();
assert.deepStrictEqual([rs6, rs7, rs8, bp1].map(farbe), ["#mitte", "#mitte", "#mitte", "#mitte"]);
assert.strictEqual(strich(rs7), null, "der Strich geht mit");
assert.strictEqual(aufgefrischt, 1, "das Infopanel zieht die Zeile nach");
anmeldungen[0][1]();
assert.strictEqual(aufgefrischt, 1, "ohne Markierung tut der Klick nichts");

// 6. Die ganze Strasse als Pfade (fuer den Dialog)
assert.deepStrictEqual(K.avesmapsWegAuswahlGruppenPfade(rs8).map((p) => p.properties.public_id), ["rs-6", "rs-7", "rs-8"]);

// 7. Besucher: kein Zustand, keine Farbe
global.IS_EDIT_MODE = false;
assert.strictEqual(K.avesmapsWegAuswahlKlick(rs7), null);
assert.strictEqual(farbe(rs7), "#mitte");
global.IS_EDIT_MODE = true;

// 8. Markierungszeile und Editorband -- createPathPopupMarkup mit Attrappen gefahren
Object.assign(global, {
	normalizePathSubtype: (v) => String(v || "Weg"),
	pathIstBach: () => false,
	getPathTitleName: (p) => p.properties.display_name,
	getPathTypeLabel: (t) => t,
	getUnnamedPathTitle: (t) => "Unbenannt " + t,
	renderFeatureKanonBadge: () => "",
	pathHeaderImageBasename: () => "strasse",
	pathHeaderIconMarkup: () => "",
	infoHeaderImageMarkup: (bild, titel, untertitel, wappen, bilder, zusatz, kanon) => "KOPF[" + kanon + "]",
	locationPopupMarkup: (o) => o.headerImageMarkup + "|" + o.actionsMarkup,
	pathShowActionButtonMarkup: () => "",
	pathShareButtonMarkup: () => "",
	popupActionButtonMarkup: (spec) => "<" + spec.label + " " + JSON.stringify(spec.attributes || {}) + ">",
	popupActionGlyphMarkup: () => "",
	locationPopupActionsMarkup: (knoepfe) => knoepfe.join(""),
	locationPopupEditorBandMarkup: (knoepfe) => "BAND[" + knoepfe.join("") + "]",
	pathWikiInfoboxMarkup: () => "",
});
vm.runInThisContext(schneide(rendering, "function createPathPopupMarkup(path) {", "\n// Zeichen-Reihenfolge der Wege"));

const ohne = createPathPopupMarkup(rs7);
assert.ok(ohne.startsWith("KOPF[]"), "ohne Markierung keine Zeile: " + ohne);
assert.ok(ohne.includes('"data-weg-umfang":"abschnitt"') && ohne.includes("<Verlauf bearbeiten"), ohne);

K.avesmapsWegAuswahlKlick(rs7);
const ganz = createPathPopupMarkup(rs7);
assert.ok(ganz.startsWith('KOPF[<div class="info-header__markierung"><b>Ganze Straße:</b> Perz – Helmdahl</div>]'), ganz);
assert.ok(ganz.includes('"data-weg-umfang":"strasse"'), "Bearbeiten bearbeitet die ganze Strasse");
assert.ok(!ganz.includes("<Verlauf bearbeiten"), "Verlauf bearbeiten nur am Abschnitt");

K.avesmapsWegAuswahlKlick(rs7);
const teil = createPathPopupMarkup(rs7);
assert.ok(teil.startsWith('KOPF[<div class="info-header__markierung"><b>Abschnitt:</b> Silkwiesen – Wieha</div>]'), teil);
assert.ok(teil.includes('"data-weg-umfang":"abschnitt"') && teil.includes("<Verlauf bearbeiten"), teil);

global.IS_EDIT_MODE = false;
assert.ok(createPathPopupMarkup(rs7).startsWith("KOPF[]"), "Besucher sehen keine Zeile");
global.IS_EDIT_MODE = true;

// 9. Verdrahtung: Reihenfolge im Klick-Zuhoerer, Aufheben beim Start
const layer = schneide(rendering, "function createPathLayer(path) {", "\nfunction updatePathLayerGeometry");
const schiedsrichter = layer.indexOf("avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)");
const auswahl = layer.indexOf("avesmapsWegAuswahlKlick(path)");
const panel = layer.indexOf("avesmapsShowPathInInfopanel(path)");
assert.ok(schiedsrichter > 0 && auswahl > schiedsrichter && panel > auswahl, "Klick: erst der Schiedsrichter, dann die Auswahl, dann die Infobox");
assert.ok(/avesmapsWegAuswahlVerdrahten\(\);/.test(lies("js/routing/routing.js")), "der Start verdrahtet das Aufheben");

// 10. CSS mit Tokens, Ladereihenfolge
const regel = schneide(lies("css/features/location-popups-markers.css"), ".info-header__markierung {", "}");
assert.ok(regel.includes("var(--font-size-small)") && regel.includes("var(--color-text)"), regel);
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(regel), "keine feste Farbe: " + regel);
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const regelTag = seite.indexOf('<script src="js/map-features/weg-auswahl.js"></script>');
const karteTag = seite.indexOf('<script src="js/map-features/map-features-weg-auswahl.js"></script>');
assert.ok(regelTag > 0 && karteTag > regelTag, "index.html laedt erst die Regel, dann den Kartenteil");

console.log("weg-auswahl-karte.test.js: ok");
