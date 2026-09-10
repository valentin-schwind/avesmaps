// Aufgabe 9 des Bauplans „Garetien-Fragment-Verbund" (Commit e81a4bbb4): auf dem Reiter „Offen"
// blendet garetienEingefuegtWirdMarkup Block D (Darstellung) und Block E (Wiki & Quellen) aus --
// „Offen zeigt die Entscheidung, die Stage die Einstellungen" (Entwurf §9; Owner 09.09.2026:
// "die sind alle auf der stage erst wichtig"). Ueberhaupt? und als was? bleiben auch auf „Offen"
// stehen (Form/Art) -- alles danach ist Einstellung, nicht Entscheidung.
//
// 🔴 FIXRUNDE 1 (Pruefbefund): die urspruengliche Fassung dieses Tests las nur Quelltext
// (`indexOf`) und fuehrte garetienEingefuegtWirdMarkup NIE aus. Der Pruefagent hat per Mutation
// belegt, dass eine VOLLSTAENDIG umgekehrte Regel ("Offen zeigt alles, Stage zeigt weniger")
// beide alten Zusicherungen gruen liess -- der Test massg nichts. Jetzt wird die Funktion
// wirklich gerufen: einmal fuer ein Objekt NICHT auf der Stage, einmal fuer dasselbe Objekt AUF
// der Stage, und geprueft wird das gebaute Markup.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-bloecke.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet
// (`typeof document !== "undefined"`) -- `global.document` muss deshalb VOR dem `require` stehen
// (Vorbild: garetien-fussknopf-dom.test.js, garetien-eingefuegt-wird.test.js).

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

// ---- Das gefaelschte `document`/`window` -- Vorbild garetien-eingefuegt-wird.test.js, dieselbe
// Bauform (mager: nur die Elemente, die dieser Ablauf wirklich anfasst).
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

// ---- Die Vorgabetafeln, ECHT geladen (kein Abschreiben ihrer Zahlen), Ladereihenfolge exakt wie
// garetien-eingefuegt-wird.test.js -- ohne sie klafft ecosystem-display.js/location-zoom-bands.js
// als blanker Bezeichner, sobald garetienEingefuegtWirdMarkup wirklich laeuft.
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
	avesmapsGaretienStageHinzufuegen,
	avesmapsGaretienStageHat,
} = mod;

wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof avesmapsGaretienStageHinzufuegen === "function", "avesmapsGaretienStageHinzufuegen fehlt im Export");
wahr(typeof avesmapsGaretienStageHat === "function", "avesmapsGaretienStageHat fehlt im Export");

// =================================================================================================
// Fixture: eine Flaeche (ziel='region'), Owner-Beispiel Huegel -> huegelland -- sie traegt sowohl
// Block D (Flaeche + Beschriftung) als auch Block E (Wiki-Landschaft) und ist damit die schaerfste
// Probe fuer die Stage-Weiche.
// =================================================================================================

const huegel = {
	key: "ggp:Berge:Huegel:Garetien:Bloecketesthuegel", name: "Bloecketesthuegel", typ: "Huegel",
	subtyp: "huegelland", kind: "topographie", ziel: "region", wiki: "ggp",
	quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
		license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
	abschnitte: [],
	items: [{ id: 1, change_type: "new", anlass: null }],
};

gleich(avesmapsGaretienStageHat(huegel.key), false,
	"Testvoraussetzung: das Fragment darf beim Start nicht auf der Stage liegen");

// =================================================================================================
// A. OFFEN (nicht auf der Stage) -- Bloecke D und E fehlen, der Hinweis steht, Form/Art bleiben.
// =================================================================================================

const mOffen = garetienEingefuegtWirdMarkup(huegel);

wahr(mOffen.includes("Eingefügt wird"), "die Ueberschrift fehlt");
wahr(mOffen.includes('data-gi-feld="zielForm"') && mOffen.includes('data-gi-feld="zielArt"'),
	"Form und Art muessen auch auf 'Offen' stehen -- sie beantworten 'ueberhaupt?' und 'als was?': "
	+ mOffen);
wahr(mOffen.includes("Darstellung sowie Wiki") && mOffen.includes("erscheinen, sobald das")
	&& mOffen.includes("Objekt auf der Stage liegt"),
	"der erklaerende Hinweistext fehlt auf 'Offen': " + mOffen);

// Block D (Darstellung): die Flaechen-Unterueberschrift und ihr Haekchen duerfen nicht erscheinen.
wahr(!mOffen.includes('class="gi-insert__sub">Fläche<'),
	"Block D (Flaeche) darf auf 'Offen' nicht erscheinen: " + mOffen);
wahr(!mOffen.includes("für Klicks gesperrt"),
	"das Flaechen-Haekchen (Block D) darf auf 'Offen' nicht erscheinen: " + mOffen);
wahr(!mOffen.includes("Größe") && !mOffen.includes("Sichtbar ab Zoom"),
	"die Beschriftungsfelder (Block D) duerfen auf 'Offen' nicht erscheinen: " + mOffen);

// Block E (Wiki & Quellen): weder die Unterueberschrift noch die Wiki-Landschaft-Zeile.
wahr(!mOffen.includes("Wiki und Quellen"),
	"die Ueberschrift von Block E (Wiki & Quellen) darf auf 'Offen' nicht erscheinen: " + mOffen);
wahr(!mOffen.includes("Wiki-Landschaft"),
	"Block E (Wiki-Landschaft) darf auf 'Offen' nicht erscheinen: " + mOffen);

// =================================================================================================
// B. STAGE (dasselbe Objekt, jetzt hereingeholt) -- Bloecke D und E erscheinen, der Hinweis
//    verschwindet, Form/Art bleiben unveraendert stehen.
// =================================================================================================

avesmapsGaretienStageHinzufuegen([huegel]);
gleich(avesmapsGaretienStageHat(huegel.key), true, "das Fragment muss jetzt auf der Stage liegen");

const mStage = garetienEingefuegtWirdMarkup(huegel);

wahr(mStage.includes('data-gi-feld="zielForm"') && mStage.includes('data-gi-feld="zielArt"'),
	"Form und Art bleiben stehen, wenn das Objekt auf die Stage kommt: " + mStage);
wahr(!mStage.includes("erscheinen, sobald das Objekt auf der Stage liegt"),
	"der Hinweistext darf auf der Stage nicht mehr stehen: " + mStage);
wahr(mStage.includes('class="gi-insert__sub">Fläche<') && mStage.includes("für Klicks gesperrt"),
	"Block D (Flaeche) muss auf der Stage erscheinen: " + mStage);
wahr(mStage.includes("Wiki und Quellen") && mStage.includes("Wiki-Landschaft"),
	"Block E (Wiki & Quellen, samt Wiki-Landschaft) muss auf der Stage erscheinen: " + mStage);

console.log("OK -- garetien-bloecke (" + checks + " Zusicherungen)");
