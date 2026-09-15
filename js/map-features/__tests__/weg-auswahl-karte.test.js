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
// Owner 15.09.2026 abends: die Auswahl traegt das Gelb der Suche (SPOTLIGHT_PATH_HIGHLIGHT_STYLE), Kontur UND Mitte.
const GELB = "#ffd72e";

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke, wpGruppeHauptzuweisungen: M.wpGruppeHauptzuweisungen,
	escapeHtml: (w) => String(w).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	pathItemStationLinkMarkup: (text) => text,
	wikiUrlToDeeplinkKey: (url) => String(url || "").split("/wiki/")[1] || "",
	getPathPublicId: (p) => p.properties.public_id,
	// Der echte Name (map-features-path-domain.js); die Fixtures tragen ihn in display_name.
	getPathTitleName: (p) => p.properties.display_name,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: true,
	SPOTLIGHT_PATH_HIGHLIGHT_STYLE: { color: GELB },
	// Das Gold markierter Orte darf die Auswahl nicht mehr faerben (Owner 15.09.2026 abends).
	getLocationMarkerActiveColor: () => "#f0b429",
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
const rand = (p) => p._pathLines[0].options.color;
global.pathData.forEach((p) => updatePathLayerStyle(p));
assert.strictEqual(farbe(rs7), "#mitte");

// 1. Erster Klick: die ganze Strasse gelb -- Kontur UND Mitte (Owner 15.09.2026 abends), der fremde Weg nicht
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "name:Reichsstraße 2", publicId: null });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), [GELB, GELB, GELB]);
assert.deepStrictEqual([rs6, rs7, rs8].map(rand), [GELB, GELB, GELB], "die Kontur wird mit gelb");
assert.strictEqual(farbe(bp1), "#mitte");
assert.strictEqual(rand(bp1), "#rand", "der fremde Weg behaelt seine Kontur");
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), { gruppe: "name:Reichsstraße 2", publicId: null });
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(bp1), null);
assert.ok(neuGebaut.includes("rs-7"), "das Markup des geklickten Wegs wird neu gebaut");

// 2. Zweiter Klick: nur der Abschnitt
neuGebaut.length = 0;
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "name:Reichsstraße 2", publicId: "rs-7" });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), ["#mitte", GELB, "#mitte"]);
assert.deepStrictEqual([rs6, rs7, rs8].map(rand), ["#rand", GELB, "#rand"], "die abgewaehlten Abschnitte bekommen ihre Kontur zurueck");
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null, "ein abgewaehlter Abschnitt meldet keine Auswahl");
assert.ok(neuGebaut.includes("rs-6") && neuGebaut.includes("rs-8"), "die abgewaehlten Abschnitte bekommen ihr Markup zurueck");

// 3. Der Baerenpfad: seine ganze Strasse gelb, der Reichsstrassen-Abschnitt mit ihm als weiterer Zuweisung gestrichelt
K.avesmapsWegAuswahlKlick(bp1);
assert.strictEqual(farbe(bp1), GELB);
assert.strictEqual(rand(bp1), GELB);
assert.strictEqual(strich(bp1), null);
// Gelb gestrichelt auf gelber Kontur saehe durchgezogen aus: die Mitte behaelt ihre Farbe, in den Luecken scheint die Kontur.
assert.strictEqual(rand(rs7), GELB, "fremder Traeger: gelbe Kontur");
assert.strictEqual(farbe(rs7), "#mitte", "fremder Traeger: die Mitte behaelt ihre eigene Farbe");
assert.strictEqual(strich(rs7), "8 8", "fremder Traeger: gestrichelt");
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs7), null, "ein Traeger ist angezeigt, nicht markiert");

// 4. Neufaerben (Live-Abgleich, Pruefhaken) laesst die Markierung stehen
updatePathLayerStyle(bp1);
updatePathLayerStyle(rs7);
assert.strictEqual(farbe(bp1), GELB);
assert.strictEqual(rand(bp1), GELB);
assert.strictEqual(strich(rs7), "8 8");
assert.strictEqual(farbe(rs7), "#mitte");

// 4b. Unsichtbare Kontur (Zoom <= 2, Fluss im Landschaftsmodus: Deckkraft 0): der Traeger traegt den gelben Strich in der Mitte
const stilVorher = global.getPathStyleColors;
global.getPathStyleColors = () => ({ outline: "#rand", outlineWeight: 4, outlineOpacity: 0, center: "#mitte", centerWeight: 2 });
updatePathLayerStyle(rs7);
assert.strictEqual(farbe(rs7), GELB, "ohne sichtbare Kontur: gelber Strich in der Mitte");
assert.strictEqual(strich(rs7), "8 8");
global.getPathStyleColors = stilVorher;
updatePathLayerStyle(rs7);
assert.strictEqual(farbe(rs7), "#mitte", "mit sichtbarer Kontur wieder die eigene Mitte");

// 5. Ein Klick daneben hebt alles auf -- auch den Strich; einmal verdrahtet
const anmeldungen = [];
global.map = { on: (ereignis, fn) => { anmeldungen.push([ereignis, fn]); } };
let aufgefrischt = 0;
global.window.avesmapsRefreshInfopanel = () => { aufgefrischt += 1; };
K.avesmapsWegAuswahlVerdrahten();
K.avesmapsWegAuswahlVerdrahten();
// Dazu der preclick-Merker des Menue-Riegels (weg-namensklick.test.js §5); aufheben tut nur der EINE click-Zuhoerer.
assert.deepStrictEqual(anmeldungen.map((a) => a[0]), ["preclick", "click"], "genau ein Klick-Zuhoerer, einmal verdrahtet");
const kartenKlick = anmeldungen[1][1];
kartenKlick();
assert.deepStrictEqual([rs6, rs7, rs8, bp1].map(farbe), ["#mitte", "#mitte", "#mitte", "#mitte"]);
assert.deepStrictEqual([rs6, rs7, rs8, bp1].map(rand), ["#rand", "#rand", "#rand", "#rand"], "die Kontur geht mit");
assert.strictEqual(strich(rs7), null, "der Strich geht mit");
assert.strictEqual(aufgefrischt, 1, "das Infopanel zieht die Zeile nach");
kartenKlick();
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
// Owner 15.09.2026: nach dem zweiten Klick „Abschnitt N: … – …" -- und KEIN Text der ganzen Strasse.
assert.ok(teil.startsWith('KOPF[<div class="info-header__markierung"><b>Abschnitt 2:</b> Silkwiesen – Wieha</div>]'), teil);
assert.ok(!teil.includes("Ganze Straße"), "nach dem zweiten Klick nie „Ganze Straße“: " + teil);
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

// 11. Owner 15.09.2026 abends: „dasselbe gelb wie bei der spotlight suche" -- gelesen aus SPOTLIGHT_PATH_HIGHLIGHT_STYLE, und
// ohne Markierung wird die Farbe gar nicht gelesen (syncPathRendering faehrt alle ~6.000 Wege je Zoomschritt).
let farbLesungen = 0;
global.SPOTLIGHT_PATH_HIGHLIGHT_STYLE = { get color() { farbLesungen += 1; return GELB; } };
K.avesmapsWegAuswahlAufheben();
farbLesungen = 0;
global.pathData.forEach((p) => updatePathLayerStyle(p));
assert.strictEqual(farbLesungen, 0, "ohne Markierung liest das Neufaerben keine Farbe");
K.avesmapsWegAuswahlKlick(rs7);
assert.strictEqual(farbe(rs7), GELB);
assert.strictEqual(rand(rs7), GELB);
assert.ok(farbLesungen > 0 && farbLesungen <= 8, "gelesen wird nur fuer markierte Abschnitte: " + farbLesungen);
const auswahlQuelle = lies("js/map-features/map-features-weg-auswahl.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(auswahlQuelle.includes("SPOTLIGHT_PATH_HIGHLIGHT_STYLE"), "die Auswahl liest die Suchfarbe");
assert.ok(!auswahlQuelle.includes("getLocationMarkerActiveColor"), "das Gold markierter Orte faerbt die Auswahl nicht mehr");
assert.ok(new RegExp('color:\\s*"' + GELB + '"').test(lies("js/ui/spotlight-search.js")), "„Anzeigen“ traegt dasselbe Gelb");
global.SPOTLIGHT_PATH_HIGHLIGHT_STYLE = { color: GELB };
K.avesmapsWegAuswahlAufheben();

// 12. Owner 15.09.2026: „ganze Straße" ist der NAME, nicht die Wiki-Zuweisung. Ein Abschnitt OHNE Zuweisung (und mit anderer
// Wegart) gehoert dazu; der erste Klick auf IHN markiert alles, die fremden Traeger kommen trotzdem gestrichelt, und die Zeile
// nennt die entferntesten Orte.
const ohneWiki = {
	properties: { public_id: "rs-9", feature_subtype: "Strasse", name: "Strasse-rs-9", display_name: RS.name, wiki_path: null, wiki_path_weitere: [] },
	geometry: { coordinates: [[3, 0], [4, 0]] },
	_pathLines: [linie(), linie()],
};
global.pathData.push(ohneWiki);
global.locationData.push({ name: "Rudein", coordinates: [0, 4] });
bp1.properties.wiki_path_weitere = [{ wiki_key: RS.key, name: RS.name, wiki_url: url(RS.seite) }];
global.mapDataSourceStatus = { revision: 2 };
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(ohneWiki), { gruppe: "name:Reichsstraße 2", publicId: null });
assert.deepStrictEqual([rs6, rs7, rs8, ohneWiki].map(farbe), [GELB, GELB, GELB, GELB], "alles, was den Namen traegt -- mit und ohne Zuweisung");
assert.strictEqual(strich(bp1), "8 8", "der fremde Traeger des Artikels, obwohl der geklickte Abschnitt selbst keinen traegt");
const ganzOhne = createPathPopupMarkup(ohneWiki);
assert.ok(ganzOhne.startsWith('KOPF[<div class="info-header__markierung"><b>Ganze Straße:</b> Perz – Rudein</div>]'), ganzOhne);
K.avesmapsWegAuswahlKlick(ohneWiki);
assert.deepStrictEqual([rs6, rs7, rs8, ohneWiki].map(farbe), ["#mitte", "#mitte", "#mitte", GELB], "zweiter Klick: nur dieser Abschnitt golden");
const teilOhne = createPathPopupMarkup(ohneWiki);
assert.ok(teilOhne.startsWith('KOPF[<div class="info-header__markierung"><b>Abschnitt 4:</b> Helmdahl – Rudein</div>]'), teilOhne);
assert.ok(!teilOhne.includes("Ganze Straße"), teilOhne);
K.avesmapsWegAuswahlAufheben();

console.log("weg-auswahl-karte.test.js: ok");
