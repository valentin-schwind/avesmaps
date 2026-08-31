// Die Karte wird beim Öffnen des Importers auf IMPORT-SICHT gestellt.
//
// Owner 31.08.2026: „da überwiegend landschaften importiert werden, sollte man beim öffnen des
// importers automatisch 'Alle' von 'Landschaften' wechseln. Außerdem kannst du 'Wege', 'Labels',
// 'Grenzen', 'Flüsse', 'Kreuzungen' und alle Ortstypen sichtbar machen, wenn man in den
// import-modus geht."
//
// 🔴 DIE REIHENFOLGE IST DIE EIGENTLICHE ZUSICHERUNG DIESER DATEI: Ansicht → Ebene → Sichtbarkeit.
// Die Landschaften-Ebene setzt beim Betreten ihr eigenes Anzeige-Profil, und für einen EDITOR
// heißt dieses Profil „leere Zeichenfläche": sie nimmt ihm ALLE Ortsklassen weg
// (syncEcosystemSettlementVisibility, map-features-ecosystem-layer-switch.js). Wer die
// Sichtbarkeit vorher setzt, sieht sie eine Zehntelsekunde später wieder verschwinden — und der
// Fehler ist von „hat nicht funktioniert" nicht zu unterscheiden.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-import-sicht.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

// ---- Eine ehrliche Attrappe des Anzeige-Menüs ---------------------------------------------------
// ⚠️ Ehrlich heißt: sie kennt den Unterschied zwischen einem Haken und seiner Zeile, denn genau
// daran hängt der Riegel „nur Schalter, die der Benutzer zurückstellen kann".
const protokoll = [];
function macheHaken(id, checked, zeileVersteckt) {
	const haken = {
		id, checked, tag: "input",
		dispatchEvent(ereignis) { protokoll.push("change:" + id + ":" + ereignis.type); return true; },
	};
	const zeile = { id: id + "Control", hidden: zeileVersteckt === true };
	return { haken, zeile };
}

const elemente = {};
const setzeElemente = (liste) => {
	Object.keys(elemente).forEach((k) => { delete elemente[k]; });
	liste.forEach((e) => { elemente[e.id] = e; });
};

let ansichtWert = "deregraphic";
const ansicht = {
	id: "mapLayerModeSelect",
	get value() { return ansichtWert; },
	set value(v) { ansichtWert = v; },
	querySelector(sel) { return sel === 'option[value="ecosystem"]' ? { value: "ecosystem" } : null; },
};

let alleTab = null;
global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return elemente[id] || null; },
	querySelector(sel) {
		return sel === "#ecosystem-layer-switch [data-ecosystem-show-all]" ? alleTab : null;
	},
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.Event = function (typ, opts) { this.type = typ; this.bubbles = !!(opts && opts.bubbles); };
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienKarteFuerImportRichten, garetienImportHakenSetzen, GARETIEN_IMPORT_HAKEN } = mod;

wahr(typeof garetienKarteFuerImportRichten === "function", "garetienKarteFuerImportRichten fehlt im Export");

// =================================================================================================
// 1. Die fünf Haken des Auftrags -- Wege, Labels, Grenzen, Flüsse, Kreuzungen
// =================================================================================================
assert.deepStrictEqual(GARETIEN_IMPORT_HAKEN,
	["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers", "toggleCrossings"],
	"genau die fünf aus dem Auftrag, in seiner Reihenfolge");
checks++;

// --- Alle aus, alle Zeilen sichtbar: alle fünf gehen an, jeder mit einem echten `change`.
protokoll.length = 0;
setzeElemente(GARETIEN_IMPORT_HAKEN.flatMap((id) => {
	const { haken, zeile } = macheHaken(id, false, false);
	return [haken, zeile];
}));
const gesetzt = garetienImportHakenSetzen(GARETIEN_IMPORT_HAKEN);
assert.deepStrictEqual(gesetzt, GARETIEN_IMPORT_HAKEN, "alle fünf werden angeschaltet");
checks++;
GARETIEN_IMPORT_HAKEN.forEach((id) => {
	gleich(elemente[id].checked, true, id + " steht auf an");
});
// 💣 EIN PROGRAMMATISCH GESETZTES `checked` FEUERT KEIN `change` -- und daran hängen die Zeichner
// (syncPathVisibility für die Wege, die Grenz-Leinwand für die Grenzen). Ohne das Signal stünde der
// Haken richtig und die Karte falsch.
gleich(protokoll.length, 5, "jeder gesetzte Haken feuert ein change: " + protokoll.join(", "));
wahr(protokoll.every((z) => z.endsWith(":change")), "und zwar ein `change`: " + protokoll.join(", "));

// --- Was schon an ist, wird NICHT angefasst: ein blindes Setzen zeichnete ~6.000 Wege neu.
protokoll.length = 0;
gleich(garetienImportHakenSetzen(GARETIEN_IMPORT_HAKEN).length, 0, "ein zweiter Lauf ändert nichts");
gleich(protokoll.length, 0, "und feuert deshalb auch nichts");

// --- 🔴 UND ZWAR ÜBER DIE HAUSFASSUNG DIESER GESTE, wenn es sie gibt. Sie steht in
// map-features-ecosystem-layer-switch.js (`ecosystemSetzeAnzeigeHaken`) und trägt die Begründung,
// warum das `change` sein muss. Ohne diesen Zeugen prüfen die Zeilen darüber nur den Rückfall --
// also genau den Zweig, den die Karte nie geht.
const hausRufe = [];
global.ecosystemSetzeAnzeigeHaken = function (id, soll) {
	hausRufe.push(id + "=" + soll);
	const el = elemente[id];
	if (el) { el.checked = Boolean(soll); }
	return true;
};
setzeElemente(GARETIEN_IMPORT_HAKEN.flatMap((id) => {
	const { haken, zeile } = macheHaken(id, false, false);
	return [haken, zeile];
}));
protokoll.length = 0;
garetienImportHakenSetzen(GARETIEN_IMPORT_HAKEN);
assert.deepStrictEqual(hausRufe, GARETIEN_IMPORT_HAKEN.map((id) => id + "=true"),
	"die Hausfassung wird gerufen, nicht die eigene: " + hausRufe.join(", "));
checks++;
gleich(protokoll.length, 0, "und der eigene Rueckfall dann NICHT zusaetzlich -- sonst zwei change je Haken");
delete global.ecosystemSetzeAnzeigeHaken;

// =================================================================================================
// 2. 💣 NUR SCHALTER, DIE DER BENUTZER AUCH ZURÜCKSTELLEN KANN
// =================================================================================================
// Drei Zeilen des Anzeige-Menüs stehen `hidden`, solange die Seite nicht im Bearbeiten-Modus ist
// (js/app/bootstrap.js entfernt das Attribut dort). Einen davon anzuschalten erzeugte einen
// Zustand, den niemand mehr sieht und deshalb auch nicht mehr loswird.
protokoll.length = 0;
const paare = [
	macheHaken("togglePaths", false, false),
	macheHaken("toggleMapLabels", false, false),
	macheHaken("toggleTerritoryBorders", false, false),
	macheHaken("toggleRivers", false, false),
	macheHaken("toggleCrossings", false, true), // die versteckte Zeile
];
setzeElemente(paare.flatMap((p) => [p.haken, p.zeile]));
const ohneEdit = garetienImportHakenSetzen(GARETIEN_IMPORT_HAKEN);
wahr(!ohneEdit.includes("toggleCrossings"),
	"eine versteckte Zeile bleibt unangetastet: " + ohneEdit.join(", "));
gleich(elemente.toggleCrossings.checked, false,
	"und ihr Haken bleibt aus -- sonst gäbe es Kreuzungen, die niemand wieder wegbekommt");
gleich(ohneEdit.length, 4, "die vier sichtbaren gehen trotzdem an");

// ⚠️ Der Riegel liest die ZEILE, nicht den Haken: das `hidden` sitzt am umschliessenden <label>
// (`<id>Control`), der Haken selbst ist immer da. Der Zeuge: derselbe Haken mit sichtbarer Zeile
// geht an.
paare[4].zeile.hidden = false;
wahr(garetienImportHakenSetzen(["toggleCrossings"]).includes("toggleCrossings"),
	"mit sichtbarer Zeile geht derselbe Haken an -- der Riegel hängt an der Zeile, nicht am Haken");

// =================================================================================================
// 3. 🔴 DIE REIHENFOLGE: Ansicht → Ebene → Sichtbarkeit
// =================================================================================================
const reihenfolge = [];
ansichtWert = "deregraphic";
alleTab = {
	getAttribute(name) { return name === "aria-selected" ? "false" : null; },
	click() { reihenfolge.push("ebene"); },
};
setzeElemente([
	ansicht,
	...paare.flatMap((p) => { p.haken.checked = false; return [p.haken, p.zeile]; }),
]);
global.window.jQuery = function (el) {
	return {
		val(v) { el.value = v; return this; },
		trigger(typ) { if (typ === "change") { reihenfolge.push("ansicht"); } return this; },
	};
};
global.setAllLocationTypesVisible = function () { reihenfolge.push("orte"); };
garetienKarteFuerImportRichten();
assert.deepStrictEqual(reihenfolge, ["ansicht", "ebene", "orte"],
	"ZUERST die Ansicht, DANN die Ebene, ZULETZT die Sichtbarkeit -- andersherum nimmt das Profil"
	+ " der Landschaften-Ebene dem Editor die Ortsklassen gleich wieder weg: " + reihenfolge.join(" → "));
checks++;
gleich(ansichtWert, "ecosystem", "die Ansicht steht auf Landschaften");

// --- Steht schon alles richtig, passiert nichts: kein zweiter Ansichtswechsel, kein zweiter Klick.
reihenfolge.length = 0;
alleTab.getAttribute = (name) => (name === "aria-selected" ? "true" : null);
garetienKarteFuerImportRichten();
assert.deepStrictEqual(reihenfolge, ["orte"],
	"eine bereits richtige Ansicht und eine bereits offene Ebene werden nicht noch einmal geschaltet");
checks++;

// ⚠️ `setAllLocationTypesVisible` läuft bewusst IMMER: sie ist die einzige der drei, die keine
// Vorher-Frage stellen kann (die Kaskade hat sechs Knöpfe, nicht einen Zustand), und sie schreibt
// weder URL noch Ereignis -- ein zweiter Lauf kostet nichts.

// =================================================================================================
// 4. 🔴 KEINE ADRESSZEILE
// =================================================================================================
// `setAllLocationTypesVisible` (map-features-display-mode.js) schreibt bewusst kein
// `syncPlannerStateToUrl`; ein Klick auf die Ortsklassen-Kachel täte es. Würde der Importer klicken
// statt zu rufen, stünde der Teilen-Link des Editors hinter seinem Rücken anders da -- genau aus
// diesem Grund verzichtet auch die Landschaften-Ebene darauf.
// 🪤 Kommentare vorher weg, sonst schlägt dies an der Erklärung an.
const quelle = lies("js", "review", "review-garetien-importer.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const richten = quelle.slice(quelle.indexOf("function garetienKarteFuerImportRichten"));
const rumpf = richten.slice(0, richten.indexOf("\n\t}"));
wahr(!/location-toggle/.test(rumpf),
	"die Ortsklassen werden NICHT per Klick auf ihre Kachel gesetzt: " + rumpf);
wahr(/setAllLocationTypesVisible\(true\)/.test(rumpf),
	"sondern über die Hausfunktion, die die Adresszeile in Ruhe lässt");

// 💣 UND DAS ÖFFNEN RUFT ES WIRKLICH. Ohne diese Zeile könnte die Funktion tadellos sein und von
// niemandem gerufen werden -- dieselbe Lücke, die in diesem Fenster schon mehrfach aufgetreten ist.
wahr(/function avesmapsGaretienFensterOeffnen\(\)[\s\S]{0,400}garetienKarteFuerImportRichten\(\);/.test(quelle),
	"avesmapsGaretienFensterOeffnen muss die Karte wirklich auf Import-Sicht stellen");

// 🔴 UND DAS SCHLIESSEN NIMMT SIE NICHT ZURÜCK -- wie die beiseitegeschobenen Panels. Die
// Ortsklassen kommen trotzdem von selbst zurück: die Landschaften-Ebene hat sie sich nur GELIEHEN
// (ecosystemSettlementMemory) und gibt beim Verlassen den Stand von vor dem Import zurück.
const schliessen = quelle.slice(quelle.indexOf("function avesmapsGaretienFensterSchliessen"));
wahr(!/garetienKarteFuerImportRichten|setAllLocationTypesVisible/.test(schliessen.slice(0, 600)),
	"das Schliessen stellt die Karte nicht zurück");

console.log(`garetien-import-sicht: ${checks} Pruefungen bestanden.`);
