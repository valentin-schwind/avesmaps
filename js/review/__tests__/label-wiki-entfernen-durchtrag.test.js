// Die Wiki-Zuweisung der Beschriftung reist nur noch mit, wenn sie ANGEFASST wurde -- und dann in
// beide Richtungen bis zur Flaeche.
//
// 🔴 DER BEFUND (Owner 03.09.2026, am Bild): „Lawaralîr" sollte vom Wiki geloest und in „Cronwald"
// umbenannt werden. Das vereinigte Fenster schickt BEIDE Formulare ab; der Kasten der Beschriftung
// ist verborgen, sobald eine Flaeche da ist („es gewinnt die Flaeche"), ihr Formular schickte aber
// trotzdem das GELADENE Nest mit -- und schrieb damit zurueck, was die Flaeche im selben Speichern
// gerade entfernt hatte. Danach stand in der Infobox weiter der alte Artikel, und je nachdem, ob man
// Flaeche oder Beschriftung anklickte, war die Landschaft geloest oder nicht.
//
// Drei Stationen, jede echt ausgefuehrt, keine nachgebaut:
//   1. review-label-wiki.js   -> `getLabelWikiRegionGeaendert` rechnet „seit dem Laden angefasst"
//   2. review-labels.js       -> `buildLabelEditPayload` schickt `wiki_region` nur dann (oder beim Anlegen)
//   3. review-editor-submit.js -> reicht genau dieses Signal als `wikiGeaendert` an die Flaeche weiter
//
// Run: node js/review/__tests__/label-wiki-entfernen-durchtrag.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
const ohneKommentare = (text) => text.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
let checks = 0;

// ---- Station 1: der Datenweg der Beschriftung, echt ausgefuehrt ----------------------------------

const dokument = {
	readyState: "complete",
	getElementById: () => null,
	querySelectorAll: () => [],
	querySelector: () => null,
	addEventListener: () => {},
};
const wiki = { console, document: dokument, window: {}, JSON, Set };
wiki.globalThis = wiki;
vm.createContext(wiki);
// ⚠️ Der reine Datenweg zuerst: `assignLabelWikiRegionToForm` ruft die Art-Ordnung daraus.
vm.runInContext(lies("js/ui/wiki-assign-landschaft.js"), wiki, { filename: "wiki-assign-landschaft.js" });
vm.runInContext(lies("js/review/review-label-wiki.js"), wiki, { filename: "review-label-wiki.js" });

const nest = { wiki_key: "lawaral-r", name: "Lawaralîr", art: "Wald", wiki_url: "https://de.wiki-aventurica.de/wiki/Lawaral%C3%AEr" };

wiki.setLabelWikiRegion(nest, false, null);
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), false, "geladen und nicht angefasst: nichts geaendert"); checks++;

wiki.labelWikiAssignLoesen();
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), true, "Entfernen ist eine Aenderung"); checks++;
assert.strictEqual(wiki.getLabelWikiRegionPayload(), null, "und der Rumpf traegt dann null -- die Ruecknahme"); checks++;

// „Abbrechen" im Kasten stellt den geladenen Stand wieder her -- und damit ist nichts mehr geaendert.
wiki.labelWikiAssignVerwerfen();
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), false, "verworfen heisst: wieder der geladene Stand"); checks++;

// 💣 INHALT, nicht Schluessel: „Sync uebernehmen" baut das Nest aus dem frischen Schnappschuss neu --
// derselbe Schluessel, andere Werte -- und genau die soll die Infobox bekommen.
vm.runInContext('currentLabelWikiRegion = Object.assign({}, currentLabelWikiRegion, { description: "Der Lawaralîr ist ein Waldgebiet." });', wiki);
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), true, "ein aufgefrischtes Nest mit demselben Schluessel ist eine Aenderung"); checks++;

// Ohne Zuweisung geladen und ohne Zuweisung gelassen: nichts.
wiki.setLabelWikiRegion(null, false, null);
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), false, "leer geladen, leer gelassen"); checks++;
wiki.labelWikiAssignLoesen();
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), false, "Entfernen ohne Zuweisung aendert nichts"); checks++;

// Der WikiSync-Weg von aussen (Region auf die Karte ziehen) setzt geladen UND aktuell -- das ist
// ein ANLEGEN, und beim Anlegen schickt der Rumpf die Zuweisung ohnehin (Station 2).
wiki.assignLabelWikiRegionToForm(nest);
assert.strictEqual(wiki.getLabelWikiRegionGeaendert(), false, "von aussen gesetzt gilt als geladen"); checks++;
assert.deepStrictEqual(wiki.getLabelWikiRegionPayload(), nest, "und der Rumpf traegt sie trotzdem"); checks++;

// ---- Station 2: der Speicher-Rumpf, echt ausgefuehrt -------------------------------------------------

function baueRumpfSandkasten(leser) {
	const kasten = {
		console,
		document: dokument,
		window: { addEventListener: () => {} },
		JSON,
		Number,
		String,
		FormData: class {
			constructor(form) { this.werte = form.werte; }
			get(name) { return Object.prototype.hasOwnProperty.call(this.werte, name) ? this.werte[name] : null; }
		},
		...leser,
	};
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	vm.runInContext(lies("js/review/review-labels.js"), kasten, { filename: "review-labels.js" });
	return kasten;
}

const formular = (publicId) => ({
	werte: { public_id: publicId, text: "Cronwald", feature_subtype: "wald", size: "18", rotation: "0", min_zoom: "2", max_zoom: "7", priority: "3", lat: "500", lng: "500" },
});

// (a) update, nicht angefasst -> KEIN Schluessel. Ein fehlender Schluessel heisst bei update_label
//     „nicht geaendert"; genau so bleibt das geladene Nest aus dem Rumpf heraus.
let rumpf = baueRumpfSandkasten({ getLabelWikiRegionPayload: () => nest, getLabelWikiRegionGeaendert: () => false })
	.buildLabelEditPayload(formular("lbl-1"));
assert.strictEqual(rumpf.action, "update_label"); checks++;
assert.ok(!Object.prototype.hasOwnProperty.call(rumpf, "wiki_region"),
	"nicht angefasst: `wiki_region` darf NICHT im Rumpf stehen -- sonst schreibt das Formular das geladene Nest zurueck"); checks++;

// (b) update, angefasst -> das Nest.
rumpf = baueRumpfSandkasten({ getLabelWikiRegionPayload: () => nest, getLabelWikiRegionGeaendert: () => true })
	.buildLabelEditPayload(formular("lbl-1"));
assert.deepStrictEqual(rumpf.wiki_region, nest, "angefasst: das Nest reist mit"); checks++;

// (c) update, angefasst und geloest -> ausdruecklich null (die Ruecknahme).
rumpf = baueRumpfSandkasten({ getLabelWikiRegionPayload: () => null, getLabelWikiRegionGeaendert: () => true })
	.buildLabelEditPayload(formular("lbl-1"));
assert.ok(Object.prototype.hasOwnProperty.call(rumpf, "wiki_region") && rumpf.wiki_region === null,
	"geloest: `wiki_region: null` steht ausdruecklich im Rumpf"); checks++;

// (d) create -> immer, es gibt keinen geladenen Stand.
rumpf = baueRumpfSandkasten({ getLabelWikiRegionPayload: () => nest, getLabelWikiRegionGeaendert: () => false })
	.buildLabelEditPayload(formular(""));
assert.strictEqual(rumpf.action, "create_label"); checks++;
assert.deepStrictEqual(rumpf.wiki_region, nest, "beim Anlegen reist die Zuweisung immer mit"); checks++;

// (e) 💣 Fehlt der Leser (review-label-wiki.js nicht geladen), reist beim Aendern NICHTS -- ein `null`
//     an seiner Stelle loeschte die Zuweisung bei jedem Speichern.
rumpf = baueRumpfSandkasten({}).buildLabelEditPayload(formular("lbl-1"));
assert.ok(!Object.prototype.hasOwnProperty.call(rumpf, "wiki_region"),
	"ohne Leser darf ein update_label die Zuweisung nicht anfassen"); checks++;

// ---- Station 3: das Signal erreicht die Flaeche ----------------------------------------------------
// 💣 Aus dem gespeicherten Stand ist „entfernt" von „nie eines gehabt" nicht zu unterscheiden -- nur der
// Rumpf weiss es. Gelesen ohne Kommentare: die Begruendung darueber nennt den Schluessel ebenfalls.
const submit = ohneKommentare(lies("js/review/review-editor-submit.js"));
assert.ok(/ecosystemPushLabelChangesToRegion\(savedLabelEntry\.label,\s*\{[\s\S]*?wikiGeaendert:\s*Object\.prototype\.hasOwnProperty\.call\(payload,\s*"wiki_region"\)/.test(submit),
	"review-editor-submit.js reicht `wikiGeaendert` aus dem Rumpf an ecosystemPushLabelChangesToRegion"); checks++;

console.log("label-wiki-entfernen-durchtrag: " + checks + " Zusicherungen gruen");
