"use strict";
// Der Dialog „Weg bearbeiten" fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5). AUSGEFUEHRT: die neuen Funktionen
// aus review-paths.js laufen gegen eine Dokument-Attrappe, der Rumpf kommt aus dem Modell des Wege-Editors.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-gruppe.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	const a = text.indexOf("function " + name + "(");
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const G = require(path.join(WURZEL, "js/review/path-gruppe.js"));
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));

// ---- 1. Rein: Zeilen, Rumpf, Texte ----------------------------------------------------------------------------
const pfad = (id, typ, zeige, transporte) => ({ properties: { public_id: id, name: "Reichsstrasse-" + id, display_name: "Reichsstraße 2",
	feature_subtype: typ, show_label: zeige, allowed_transports: transporte, wiki_path: { wiki_key: "reichsstrasse-2" } } });
const rs6 = pfad("rs-6", "Reichsstrasse", true, ["caravan", "groupFoot", "horseCarriage"]);
const rs7 = pfad("rs-7", "Reichsstrasse", true, ["caravan", "groupFoot"]);
const rs8 = pfad("rs-8", "Strasse", false, ["caravan", "groupFoot"]);
const lesen = { name: (p) => p.properties.display_name, zeigeName: (p) => p.properties.show_label === true, transporte: (p) => p.properties.allowed_transports };
const zeilen = G.avesmapsPathGruppeZeilen([rs6, rs7, rs8], lesen);
assert.deepStrictEqual(zeilen[2], { public_id: "rs-8", name: "Reichsstraße 2", show_label: false, feature_subtype: "Strasse", allowed_transports: ["caravan", "groupFoot"] });
assert.strictEqual(G.avesmapsPathGruppeZeilen([rs7])[0].name, "Reichsstraße 2", "ohne Leser der ECHTE Name, nie der Maschinenname");
const SCHLUESSEL = ["caravan", "groupFoot", "horseCarriage"];
const stand = M.wpGroupFieldStates(zeilen, SCHLUESSEL);
const unberuehrt = { name: "Reichsstraße 2", show_label: null, feature_subtype: null, transports: { caravan: "an", groupFoot: "an", horseCarriage: "teils" } };
assert.strictEqual(M.wpGroupRumpf(stand, unberuehrt, ["rs-6", "rs-7", "rs-8"]), null, "nichts angefasst: kein Rumpf");
const angefasst = { ...unberuehrt, name: "Reichsstraße II", transports: { ...unberuehrt.transports, horseCarriage: "an" } };
assert.deepStrictEqual(M.wpGroupRumpf(stand, angefasst, ["rs-6", "rs-7", "rs-8"]), {
	action: "update_path_group_details", public_ids: ["rs-6", "rs-7", "rs-8"], fields: ["name", "allowed_transports"],
	name: "Reichsstraße II", transport_decisions: { horseCarriage: true },
});
assert.strictEqual(G.avesmapsPathGruppeKnopfText(10), "Speichern für 10 Abschnitte");
assert.strictEqual(G.avesmapsPathGruppeKnopfText(1), "Speichern");
assert.strictEqual(G.avesmapsPathGruppeTeilsText({ zustand: "teils", an: 7, gesamt: 10 }), "teils · 7 von 10");

// ---- 2. Die Dokument-Attrappe ---------------------------------------------------------------------------------
class Klassen {
	constructor() { this.menge = new Set(); }
	add(n) { this.menge.add(n); }
	remove(n) { this.menge.delete(n); }
	contains(n) { return this.menge.has(n); }
	toggle(n, an) { if (an === undefined ? !this.menge.has(n) : an) { this.menge.add(n); } else { this.menge.delete(n); } }
}
class El {
	constructor(tag, attr = {}) {
		this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.zuhoerer = [];
		this.hidden = false; this.dataset = {}; this.classList = new Klassen();
		this.value = ""; this.checked = false; this.indeterminate = false; this.disabled = false;
		this.required = false; this.readOnly = false; this.placeholder = ""; this.textContent = ""; this.innerHTML = "";
		Object.assign(this, attr);
	}
	set className(text) { this.classList = new Klassen(); String(text).split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n)); }
	get firstChild() { return this.children[0] || null; }
	addEventListener(typ, fn) { this.zuhoerer.push([typ, fn]); }
	removeEventListener(typ, fn) { this.zuhoerer = this.zuhoerer.filter(([t, f]) => t !== typ || f !== fn); }
	appendChild(kind) { kind.parentElement = this; this.children.push(kind); return kind; }
	insertBefore(kind, vor) { kind.parentElement = this; const i = this.children.indexOf(vor); this.children.splice(i < 0 ? 0 : i, 0, kind); return kind; }
	remove() { if (this.parentElement) { const c = this.parentElement.children; c.splice(c.indexOf(this), 1); this.parentElement = null; } }
	passt(sel) {
		if (sel === "label") { return this.tagName === "LABEL"; }
		if (sel.startsWith(".")) { return this.classList.contains(sel.slice(1)); }
		if (sel === 'input[name="allowed_transport"]') { return this.tagName === "INPUT" && this.name === "allowed_transport"; }
		if (sel === "option[data-gemischt]") { return this.tagName === "OPTION" && Boolean(this.dataset.gemischt); }
		throw new Error("Selektor unbekannt: " + sel);
	}
	alle(sel, aus = []) { this.children.forEach((k) => { if (k.passt(sel)) { aus.push(k); } k.alle(sel, aus); }); return aus; }
	querySelector(sel) { return this.alle(sel)[0] || null; }
	querySelectorAll(sel) { return this.alle(sel); }
	closest(sel) { let el = this; while (el) { if (el.passt(sel)) { return el; } el = el.parentElement; } return null; }
}
const elemente = {};
const mit = (el) => { if (el.id) { elemente[el.id] = el; } return el; };
const formular = mit(new El("form", { id: "path-edit-form" }));
const nameFeld = formular.appendChild(mit(new El("input", { id: "path-edit-name", required: true })));
const autoLabel = formular.appendChild(new El("label"));
autoLabel.appendChild(mit(new El("input", { id: "path-edit-autoname", checked: true })));
const zeigeLabel = formular.appendChild(new El("label"));
const zeige = zeigeLabel.appendChild(mit(new El("input", { id: "path-edit-show-label" })));
const typ = formular.appendChild(mit(new El("select", { id: "path-edit-type", required: true, value: "Weg" })));
["Reichsstrasse", "Strasse", "Weg"].forEach((wert) => typ.appendChild(new El("option", { value: wert })));
const bach = formular.appendChild(mit(new El("div", { id: "path-edit-is-bach-row" })));
const stroemung = formular.appendChild(mit(new El("div", { id: "path-flow-section" })));
const transportKasten = formular.appendChild(mit(new El("div", { id: "path-edit-transport-options" })));
const haken = {};
SCHLUESSEL.forEach((k) => {
	const zeile = transportKasten.appendChild(new El("div", { className: "path-transport-row" }));
	const label = zeile.appendChild(new El("label"));
	haken[k] = label.appendChild(new El("input", { name: "allowed_transport", value: k }));
});
const umfang = formular.appendChild(mit(new El("p", { id: "path-edit-umfang", hidden: true })));
const knopf = formular.appendChild(mit(new El("button", { id: "path-edit-submit", textContent: "Speichern" })));
const dokument = {
	getElementById: (id) => elemente[id] || null,
	createElement: (tag) => new El(tag),
	querySelectorAll: (sel) => {
		const vorsatz = "#path-edit-transport-options ";
		assert.ok(sel.startsWith(vorsatz), "unerwarteter Dokument-Selektor: " + sel);
		return transportKasten.querySelectorAll(sel.slice(vorsatz.length));
	},
};

const aufrufe = { einzel: 0, quellen: [], kasten: [], zerstoert: 0, popups: [], suche: 0, panel: 0 };
const kontext = vm.createContext({
	document: dokument, window: {}, console,
	wpGroupFieldStates: M.wpGroupFieldStates,
	avesmapsPathGruppeZeilen: G.avesmapsPathGruppeZeilen,
	avesmapsPathGruppeKnopfText: G.avesmapsPathGruppeKnopfText,
	avesmapsPathGruppeTeilsText: G.avesmapsPathGruppeTeilsText,
	avesmapsWegMarkierungszeileMarkup: A.avesmapsWegMarkierungszeileMarkup,
	avesmapsWegGanzeStreckeAufKarte: () => "Perz – Helmdahl",
	avesmapsWegStreckeAufKarte: () => "Silkwiesen – Wieha",
	avesmapsWegAbschnittLabelAufKarte: (p) => "Abschnitt " + p.properties.public_id.slice(3) + ": X – Y",
	getPathPublicId: (p) => p.properties.public_id,
	getPathDisplayName: lesen.name,
	shouldPathNameBeDisplayed: lesen.zeigeName,
	getPathAllowedTransports: lesen.transporte,
	getTransportOptionsForPathSubtype: () => SCHLUESSEL.slice(),
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathEditFormElement: () => formular,
	populatePathEditForm: () => { aufrufe.einzel += 1; },
	mountPathEditFeatureSources: (p, ids) => { aufrufe.quellen.push([p.properties.public_id, ids]); },
	syncPathAutoNameControls: () => {},
	avesmapsWikiWeitereKastenMount: (host, opts) => { aufrufe.kasten.push(opts); return { neuZeichnen() {}, zerstoeren() { aufrufe.zerstoert += 1; } }; },
	findPathByPublicId: (id) => [rs6, rs7, rs8].find((p) => p.properties.public_id === id) || null,
	refreshPathLayerPopup: (p) => { aufrufe.popups.push(p.properties.public_id); },
	invalidateSpotlightSearchEntryCache: () => { aufrufe.suche += 1; },
	pollLiveMapUpdates: () => Promise.resolve(),
});
kontext.window.avesmapsRefreshInfopanel = () => { aufrufe.panel += 1; };

const pfadeQuelle = lies("js/review/review-paths.js");
const kopfAnfang = pfadeQuelle.indexOf("// ── Der Dialog fuer die GANZE Strasse");
assert.ok(kopfAnfang >= 0, "der Block fuer die ganze Strasse fehlt in review-paths.js");
const kopf = pfadeQuelle.slice(kopfAnfang, pfadeQuelle.indexOf("function pathEditTransportSchluessel("));
const NAMEN = ["pathEditTransportSchluessel", "pathEditSpeicherText", "pathEditUmfangZeigen", "pathEditGruppenModus",
	"populatePathEditFormGruppe", "pathGruppeHakenGeaendert", "readPathGruppeEntwurf", "mountPathWikiWeitere", "pathWikiWeitereAnhang", "pathEditGruppeNachWikiSchreiben",
	"pathWikiWeitereUebernehmen", "pathEditGruppenModusBeenden"];
vm.runInContext(kopf + NAMEN.map((name) => funktion(pfadeQuelle, name)).join("\n"), kontext);
const rufe = (name) => vm.runInContext(name, kontext);

// ---- 3. Oeffnen fuer die ganze Strasse ------------------------------------------------------------------------
rufe("populatePathEditFormGruppe")(rs7, [rs6, rs7, rs8]);
assert.strictEqual(aufrufe.einzel, 1, "erst der Grundstand des Abschnitts (Sperre, Wiki-Kasten)");
assert.ok(formular.classList.contains("is-gruppe"));
assert.strictEqual(autoLabel.hidden, true, "Auto-Name gibt es fuer die ganze Strasse nicht");
assert.strictEqual(bach.hidden, true, "Bach bleibt am Abschnitt");
assert.strictEqual(stroemung.hidden, true, "Stroemung bleibt am Abschnitt");
assert.strictEqual(nameFeld.value, "Reichsstraße 2");
assert.strictEqual(nameFeld.required, false);
assert.strictEqual(zeige.indeterminate, true, "uneinig: halber Haken");
assert.strictEqual(typ.value, "", "uneinig: gemischt lassen");
assert.strictEqual(typ.required, false);
assert.strictEqual(typ.firstChild.textContent, "— gemischt lassen —");
assert.strictEqual(haken.caravan.checked, true);
assert.strictEqual(haken.caravan.indeterminate, false);
assert.strictEqual(haken.horseCarriage.indeterminate, true);
assert.strictEqual(haken.horseCarriage.parentElement.querySelector(".path-transport-teils").textContent, "teils · 1 von 3");
assert.strictEqual(umfang.hidden, false);
assert.strictEqual(umfang.innerHTML, "<b>Ganze Straße:</b> Perz – Helmdahl");
assert.strictEqual(knopf.textContent, "Speichern für 3 Abschnitte");
const quellen = aufrufe.quellen[aufrufe.quellen.length - 1];
assert.deepStrictEqual([quellen[0], [...quellen[1]]], ["rs-7", ["rs-7", "rs-6", "rs-8"]], "Quellen fest an allen Abschnitten, der geklickte vorn");
const kastenOpts = aufrufe.kasten[aufrufe.kasten.length - 1];
assert.strictEqual(kastenOpts.skin, "label-wiki");
assert.strictEqual(kastenOpts.umfangText(), "die ganze Straße");
assert.strictEqual(kastenOpts.hauptKey(), "reichsstrasse-2");
// Fix-Runde 1, Punkt 2 (R30): der Kasten „Wiki-Weg" (#path-wiki-assign-host) zeigt die Hauptzuweisung schon --
// auch im Gruppenmodus, weil populatePathEditFormGruppe zuerst populatePathEditForm(path) ruft und ihn stehen
// laesst. `haupt` fehlt deshalb GANZ (nicht nur `null`), sonst stuende der Artikel zweimal auf der Seite.
assert.ok(!("haupt" in kastenOpts), "keine Hauptzuweisungs-Zeile im Gruppendialog -- der Kasten „Wiki-Weg“ zeigt sie schon");
assert.deepStrictEqual([...kastenOpts.abschnitte().map((a) => a.public_id)], ["rs-6", "rs-7", "rs-8"]);
assert.strictEqual(transportKasten.zuhoerer.length, 1, "der Haken-Zuhoerer haengt einmal");

// ---- 4. Lesen: unberuehrt -> kein Rumpf; angefasst -> nur das Angefasste ------------------------------------
const gruppe = rufe("pathEditGruppe");
assert.strictEqual(M.wpGroupRumpf(gruppe.stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]), null, "nur geoeffnet: nichts wird geschrieben");
haken.horseCarriage.indeterminate = false;   // ein Klick nimmt den halben Haken ...
haken.horseCarriage.checked = true;
rufe("pathGruppeHakenGeaendert")({ target: haken.horseCarriage });
assert.strictEqual(haken.horseCarriage.parentElement.querySelector(".path-transport-teils"), null, "... und sein „teils-Hinweis geht");
const rumpf = M.wpGroupRumpf(gruppe.stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]);
assert.deepStrictEqual([...rumpf.fields], ["allowed_transports"]);
assert.deepStrictEqual({ ...rumpf.transport_decisions }, { horseCarriage: true });

// ---- 5. Die Antwort einer weiteren Zuweisung landet sofort in den Kartendaten --------------------------------
rs6.properties.wiki_path_weitere = [{ wiki_key: "alt" }];
rufe("pathWikiWeitereUebernehmen")({ segments_updated: [
	{ public_id: "rs-7", wiki_path_weitere: [{ wiki_key: "b-renpfad", name: "Bärenpfad" }] },
	{ public_id: "rs-6", wiki_path_weitere: [] },
] });
assert.strictEqual(rs7.properties.wiki_path_weitere[0].wiki_key, "b-renpfad");
assert.deepStrictEqual([...rs6.properties.wiki_path_weitere], [], "eine leere Liste bleibt als [] stehen (Nachtrag §9.2)");
assert.deepStrictEqual(aufrufe.popups, ["rs-7", "rs-6"]);
assert.strictEqual(aufrufe.suche, 1, "die Suche vergisst ihren Zwischenspeicher");
assert.strictEqual(aufrufe.panel, 1, "das Infopanel zieht nach");

// ---- 5b. Nachtrag 15.09.2026 §9.6: nach Zuweisen/Entfernen im Gruppendialog rechnet der Vergleichsstand neu ------------
// R2 hat jedem Abschnitt einen eigenen generischen Namen gegeben. Ohne Neurechnen stuende der alte gemeinsame Name als Stand
// da, und das naechste „Speichern fuer N Abschnitte“ schriebe einen Namen auf alle.
kontext.pathEditFeature = rs7;
rs6.properties.display_name = "Strasse-11";
rs7.properties.display_name = "Strasse-12";
rs8.properties.display_name = "Strasse-13";
rufe("pathEditGruppeNachWikiSchreiben")();
assert.strictEqual(rufe("pathEditGruppe").stand.name.gleich, false, "die Namen sind jetzt uneins");
assert.strictEqual(nameFeld.value, "", "das Namensfeld zeigt „gemischt“ statt des alten Namens");
const nachLoesen = M.wpGroupRumpf(rufe("pathEditGruppe").stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]);
assert.ok(!nachLoesen || !nachLoesen.fields.includes("name"), "das Sammel-Speichern schreibt keinen Namen auf alle");
assert.strictEqual(umfang.innerHTML, "<b>Ganze Straße:</b> Perz – Helmdahl", "die Zeile oben bleibt die der ganzen Strasse");

// ---- 6. Schliessen beendet den Gruppenmodus; der Abschnitt zeigt seine eigene Zeile ---------------------------
rufe("pathEditGruppenModusBeenden")();
assert.strictEqual(rufe("pathEditGruppe"), null);
assert.ok(!formular.classList.contains("is-gruppe"));
assert.strictEqual(nameFeld.required, true);
assert.strictEqual(typ.required, true);
assert.strictEqual(typ.querySelector("option[data-gemischt]"), null);
assert.strictEqual(transportKasten.querySelectorAll(".path-transport-teils").length, 0);
assert.strictEqual(zeige.indeterminate, false);
assert.strictEqual(knopf.textContent, "Speichern");
assert.strictEqual(umfang.hidden, true);
assert.strictEqual(autoLabel.hidden, false);
assert.strictEqual(aufrufe.zerstoert, 1, "der Kasten wird abgebaut");
rufe("pathEditUmfangZeigen")(rs7, false);
assert.strictEqual(umfang.innerHTML, "<b>Abschnitt:</b> Silkwiesen – Wieha");

// ---- 7. Verdrahtung ---------------------------------------------------------------------------------------------
const routing = lies("js/routing/routing.js");
const zweig = routing.slice(routing.indexOf('if (action === "edit-path-details") {'), routing.indexOf('if (action === "edit-path-geometry") {'));
assert.ok(zweig.includes('this.dataset.wegUmfang === "strasse"') && zweig.includes("openPathEditDialog(path, { gruppe })"), zweig);
const submit = lies("js/review/review-editor-submit.js");
const handler = funktion(submit, "handlePathEditFormSubmit");
const abzweig = handler.indexOf("handlePathGroupEditSubmit()");
assert.ok(abzweig > 0 && abzweig < handler.indexOf("buildPathEditPayload(formElement)"), "die ganze Strasse zweigt VOR dem Abschnitts-Rumpf ab");
const gruppenSpeichern = funktion(submit, "handlePathGroupEditSubmit");
assert.ok(gruppenSpeichern.includes("wpGroupRumpf(") && gruppenSpeichern.includes("await pollLiveMapUpdates()"), gruppenSpeichern);
assert.ok(!gruppenSpeichern.includes("updateRevisionFromEditResponse"), "die Antwort traegt keine Features -- ein Revisionssprung liesse den Live-Abgleich nichts finden");
assert.ok(funktion(lies("js/review/review-pending.js"), "setPathEditSubmitPending").includes("pathEditSpeicherText()"));
assert.ok(funktion(lies("js/review/review-dialog-state.js"), "resetPathEditForm").includes("pathEditGruppenModusBeenden()"));
assert.ok(/if \(pathEditGruppe\) \{\s*return;/.test(funktion(pfadeQuelle, "syncPathTransportOptions")), "im Gruppenmodus setzt der Wegtyp-Wechsel die halben Haken nicht zurueck");
assert.ok(funktion(pfadeQuelle, "openPathEditDialog").includes("populatePathEditFormGruppe(path, gruppe)"));
const einzel = funktion(pfadeQuelle, "populatePathEditForm");
assert.ok(einzel.includes("pathEditUmfangZeigen(path, false)") && einzel.includes("mountPathWikiWeitere(path, [path], false)"), "auch der Abschnitt zeigt Zeile und Kasten");
assert.ok(lies("js/pages/wege-editor.js").includes("wpGroupRumpf(state.groupStand, state.groupDraft,"), "der Wege-Editor baut mit demselben Bauer");

const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const i = (text) => seite.indexOf(text);
assert.ok(i('id="path-edit-umfang"') > i('id="path-edit-public-id"') && i('id="path-edit-umfang"') < i('id="path-edit-name"'), "die Zeile steht oben im Dialog");
assert.ok(i('id="path-wiki-weitere-host"') < 0, "der zweite Kasten ist gefallen -- die weiteren Zuweisungen haengen im Kasten „Wiki-Weg“ (Nachtrag §9.5)");
assert.ok(i('id="path-wiki-assign-host"') > 0 && i('id="path-wiki-assign-host"') < i('id="path-edit-feature-sources"'), "der Kasten „Wiki-Weg“ steht ueber den Quellen");
assert.ok(i('<script src="js/ui/wiki-weitere-kasten.js"></script>') > i('<script src="js/ui/wiki-assign-weg.js"></script>'));
assert.ok(i('<script src="js/review/path-gruppe.js"></script>') > 0 && i('<script src="js/review/path-gruppe.js"></script>') < i('<script src="js/review/review-paths.js"></script>'));
assert.ok(/#path-edit-form\.is-gruppe \.path-season \{\s*display: none;/.test(lies("css/features/path-editor.css")), "Zeitfenster gibt es im Gruppenmodus nicht");

// ---- 8. Fix-Runde 1, Punkt 1+2: ALLE DREI Oeffner montieren den Kasten wirklich, und nie mit „Hauptzuweisung" --
// AUSGEFUEHRT gegen die ECHTE avesmapsWikiWeitereKastenMount (js/ui/wiki-weitere-kasten.js), nicht die Attrappe
// von oben: eine leere, aber gerahmte Karte (#path-wiki-weitere-host traegt class="label-edit-section" unabhaengig
// vom Inhalt) sieht ein Quelltext-Test nie, nur ein wirklich gezeichnetes innerHTML.
const W = require(path.join(WURZEL, "js/ui/wiki-weitere-kasten.js"));

/** Ein frischer Kontext mit einer PERSISTENTEN Element-Kartei (anders als oben: derselbe Aufruf liefert
 * dasselbe Objekt zurueck, sonst liesse sich #path-wiki-weitere-host hinterher nicht auslesen). */
function frischerOeffnerKontext() {
	const elemente8 = {};
	const holen = (id) => { if (!elemente8[id]) { elemente8[id] = new El("div", { id }); } return elemente8[id]; };
	const dok8 = { getElementById: holen, createElement: (tag) => new El(tag), querySelectorAll: () => [] };
	const kontext8 = vm.createContext({
		document: dok8, window: {}, console, pathData: [], lastPathEditSettings: null,
		getPathEditFormElement: () => holen("__form"),
		wpGroupFieldStates: M.wpGroupFieldStates,
		avesmapsPathGruppeZeilen: G.avesmapsPathGruppeZeilen,
		avesmapsPathGruppeKnopfText: G.avesmapsPathGruppeKnopfText,
		avesmapsPathGruppeTeilsText: G.avesmapsPathGruppeTeilsText,
		getPathDisplayName: lesen.name, shouldPathNameBeDisplayed: lesen.zeigeName, getPathAllowedTransports: lesen.transporte,
		getTransportOptionsForPathSubtype: () => SCHLUESSEL.slice(),
		normalizePathSubtype: (wert) => String(wert || "Weg"),
		getPathPublicId: (p) => p.properties.public_id,
		avesmapsWegGanzeStreckeAufKarte: () => "Perz – Helmdahl",
		avesmapsWegStreckeAufKarte: () => "Silkwiesen – Wieha",
		avesmapsWegAbschnittLabelAufKarte: (p) => "Abschnitt " + p.properties.public_id,
		avesmapsWegMarkierungszeileMarkup: A.avesmapsWegMarkierungszeileMarkup,
		// Die ECHTE Umsetzung -- keine Attrappe, die nur Optionen aufzeichnet.
		avesmapsWikiWeitereKastenMount: W.avesmapsWikiWeitereKastenMount,
		findPathByPublicId: (id) => [t8rs6, t8rs7, t8rs8].find((p) => p.properties.public_id === id) || null,
		refreshPathLayerPopup: () => {}, invalidateSpotlightSearchEntryCache: () => {}, pollLiveMapUpdates: () => Promise.resolve(),
		// 💣 KEIN mountFeatureSourceEditor: der Quellenkasten ist hier nicht das Thema, und ohne ihn faellt
		// mountPathEditFeatureSources ueber seinen eigenen typeof-Riegel fruehzeitig heraus -- sonst braeuchte
		// dieses El auch noch cloneNode()/replaceWith(), die es nicht hat.
	});
	kontext8.window.avesmapsRefreshInfopanel = () => {};
	return { kontext: kontext8, holen };
}

/** Retry-Schleife wie in quellen-im-wegedialog.test.js §4: eine ECHTE ReferenceError wird durch einen stillen
 * Rueckfall ersetzt, damit fehlende FREMDE Funktionen (aus anderen Dateien) den Lauf nicht abbrechen. */
function fahreOeffner(kontext, ausdruck) {
	for (let versuch = 0; versuch < 80; versuch += 1) {
		try { vm.runInContext(ausdruck, kontext); return; }
		catch (fehler) {
			const treffer = /^(\w+) is not defined$/.exec(fehler.message);
			if (!treffer) { throw new Error(ausdruck + ": " + fehler.message); }
			kontext[treffer[1]] = function () { return ""; };
		}
	}
	throw new Error(ausdruck + " laeuft nicht durch");
}

// Frische, unabhaengige Pfade -- die von oben tragen inzwischen Mutationen aus Abschnitt 5.
const t8rs6 = pfad("t8-6", "Reichsstrasse", true, ["caravan"]);
const t8rs7 = pfad("t8-7", "Reichsstrasse", true, ["caravan"]);
const t8rs8 = pfad("t8-8", "Strasse", false, ["caravan"]);

[
	["populatePathEditForm", "populatePathEditForm(" + JSON.stringify(t8rs7) + ");"],
	["populatePathEditFormGruppe", "populatePathEditFormGruppe(" + JSON.stringify(t8rs7) + ", " + JSON.stringify([t8rs6, t8rs7, t8rs8]) + ");"],
	["populatePathEditFormFromLastSettings", "populatePathEditFormFromLastSettings(" + JSON.stringify(t8rs7) + ");"],
].forEach(([name, ausdruck]) => {
	const { kontext, holen } = frischerOeffnerKontext();
	vm.runInContext(pfadeQuelle, kontext);
	fahreOeffner(kontext, ausdruck);
	const host = vm.runInContext("pathWikiWeitereAnhang()", kontext);
	assert.ok(typeof host.innerHTML === "string" && host.innerHTML.length > 0,
		name + ": der Kasten „Weitere Wiki-Zuweisungen“ bleibt keine leere, aber gerahmte Karte (Fix-Runde 1, Punkt 1)");
	assert.ok(!host.innerHTML.includes("Hauptzuweisung"),
		name + ": keine zweite „Hauptzuweisung“-Zeile -- der Kasten „Wiki-Weg“ zeigt sie schon (Fix-Runde 1, Punkt 2)");
});

console.log("weg-dialog-gruppe.test.js: ok");
