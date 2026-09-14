// Die Bloecke C, D und E der Einzelansicht (Bauplan 2026-09-14, Aufgabe 11) -- was aus dem Objekt wird.
//
// 🔴 D (Darstellung) und E (Wiki & Quellen) gibt es nur auf der Stage (Owner 09.09.2026: „die sind
// alle auf der stage erst wichtig"); auf „Offen" steht allein C, und zwar als Text.
// 🔴 Ein uebernommenes Objekt bekommt KEINEN der drei Bloecke (Bestand, Owner 14.09.2026).
//
// 🔴 FIXRUNDE 1 (Pruefbefund vom 09.09.2026) gilt weiter: die Funktion wird WIRKLICH gerufen, und
// geprueft wird das gebaute Markup. Eine Fassung, die nur Quelltext las, liess eine vollstaendig
// umgekehrte Regel gruen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-bloecke.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

function macheElement(id) {
	return {
		id: id, hidden: false, innerHTML: "", textContent: "",
		disabled: false, checked: false, value: "",
		addEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienEingefuegtWirdMarkup,
	garetienVorschlagMarkup,
	avesmapsGaretienStageHinzufuegen,
	avesmapsGaretienStageHat,
} = mod;

wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof garetienVorschlagMarkup === "function", "garetienVorschlagMarkup fehlt im Export (Aufgabe 10)");

// Die Buchstaben eines gebauten Markups, in ihrer Reihenfolge.
function buchstaben(markup) {
	return (markup.match(/<span class="gi-block__zahl">([^<]*)<\/span>/g) || [])
		.map((t) => t.replace(/<[^>]*>/g, "")).join("");
}

// =================================================================================================
// Fixture: eine Flaeche (ziel='region') -- sie traegt D (Flaeche + Beschriftung) und E (Wiki-Landschaft)
// und ist damit die schaerfste Probe fuer die Stage-Weiche.
// =================================================================================================

const huegel = {
	key: "ggp:Berge:Huegel:Garetien:Bloecketesthuegel", name: "Bloecketesthuegel", typ: "Huegel",
	subtyp: "huegelland", kind: "topographie", ziel: "region", wiki: "ggp", stand: "offen",
	quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
		license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
	abschnitte: [],
	items: [{ id: 1, change_type: "new", anlass: null }],
};

gleich(avesmapsGaretienStageHat(huegel.key), false,
	"Testvoraussetzung: das Objekt darf beim Start nicht auf der Stage liegen");

// =================================================================================================
// A. OFFEN -- nur Block C, und C ist Text
// =================================================================================================

const mOffen = garetienEingefuegtWirdMarkup(huegel);
gleich(buchstaben(mOffen), "C", "auf „Offen\" steht allein Block C: " + mOffen);
wahr(mOffen.includes('<span class="gi-block__zahl">C</span>Ziel &amp; Identität'), "Block C heisst „Ziel & Identität\"");
wahr(mOffen.includes(garetienVorschlagMarkup(huegel)), "C traegt den Vorschlag als Text");
wahr(!/data-gi-feld/.test(mOffen), "🔴 auf „Offen\" kein Einstellfeld: " + mOffen);
wahr(!mOffen.includes("für Klicks gesperrt") && !mOffen.includes("Größe"),
	"die Felder von Block D fehlen auf „Offen\"");
wahr(!mOffen.includes("Wiki-Landschaft") && !mOffen.includes("Die Quelle, die mitreist"),
	"Block E fehlt auf „Offen\"");

// =================================================================================================
// B. STAGE -- C, D und E
// =================================================================================================

avesmapsGaretienStageHinzufuegen([huegel]);
gleich(avesmapsGaretienStageHat(huegel.key), true, "das Objekt muss jetzt auf der Stage liegen");

const mStage = garetienEingefuegtWirdMarkup(huegel);
gleich(buchstaben(mStage), "CDE", "auf der Stage C, D und E: " + buchstaben(mStage));
wahr(mStage.includes('data-gi-feld="zielForm"') && mStage.includes('data-gi-feld="zielArt"'),
	"Form und Art stehen in C: " + mStage);
wahr(mStage.includes('class="gi-insert__sub">Fläche<') && mStage.includes("für Klicks gesperrt"),
	"Block D (Flaeche) erscheint auf der Stage");
wahr(mStage.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen') && mStage.includes("Wiki-Landschaft"),
	"Block E (Wiki & Quellen, samt Wiki-Landschaft) erscheint auf der Stage");
wahr(!mStage.includes("Erst auf der Stage einstellbar."), "der Vorschlags-Satz steht auf der Stage nicht mehr");

// =================================================================================================
// C. UEBERNOMMEN (Bestand) -- keiner der drei Bloecke, auch nicht auf der Stage
// =================================================================================================

const huegelUebernommen = Object.assign({}, huegel, {
	key: "ggp:Berge:Huegel:Garetien:Bloecketesthuegel-uebernommen", stand: "uebernommen",
	items: [{ id: 2, change_type: "new", anlass: null, apply_state: "done" }],
});
gleich(garetienEingefuegtWirdMarkup(huegelUebernommen), "", "uebernommen: kein Block C, D oder E");
avesmapsGaretienStageHinzufuegen([huegelUebernommen]);
gleich(garetienEingefuegtWirdMarkup(huegelUebernommen), "", "⚠️ auch wenn es noch auf der Stage liegt");

console.log("OK -- garetien-bloecke (" + checks + " Zusicherungen)");
