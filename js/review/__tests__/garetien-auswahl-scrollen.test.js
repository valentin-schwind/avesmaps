// Die Liste scrollt zur gewählten Zeile -- Owner 30.08.2026: "klicken zum auswählen geht, aber ich
// will, dass die liste auch zur auswahl hinscrollt".
//
// Der Anlass ist die KARTE: wer dort ein Objekt anklickt, bekommt seine Einzelansicht -- und die
// zugehörige Zeile stand irgendwo unter 8000 anderen, seit die Seitengröße auf 10000 steht.
//
// 🔴 UND DIESELBE ÄNDERUNG MACHT DIE MARKIERUNG O(1). Die alte Fassung ging bei JEDER Auswahl über
// alle Zeilen und rief für jede `classList.toggle` -- bei 8212 Zeilen 8212 Aufrufe für ein
// Ergebnis, das genau zwei betrifft. Beides steckt in derselben Funktion, deshalb prüft diese
// Datei beides.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-auswahl-scrollen.test.js

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

// ---- Das gefälschte DOM: eine Liste mit Zeilen, die mitzählen, was mit ihnen geschieht --------
let toggleRufe = 0;
function macheZeile(key) {
	const klassen = new Set();
	return {
		_key: key,
		_scrolls: [],
		getAttribute(name) { return name === "data-key" ? key : null; },
		classList: {
			add(k) { klassen.add(k); },
			remove(k) { klassen.delete(k); },
			contains(k) { return klassen.has(k); },
			toggle() { toggleRufe++; },
		},
		scrollIntoView(opt) { this._scrolls.push(opt); },
	};
}

const ZEILEN = ["a", "b", "c"].map(macheZeile);
const LISTE = {
	id: "garetien-list",
	hidden: false, innerHTML: "", textContent: "",
	addEventListener() {},
	// 🔴 Der Selektor wird MITGESCHRIEBEN: nur so lässt sich belegen, dass die Funktion gezielt
	// zugreift statt über alle Zeilen zu laufen.
	_selektoren: [],
	querySelector(sel) {
		this._selektoren.push(sel);
		if (sel.indexOf("is-selected") !== -1) {
			return ZEILEN.filter((z) => z.classList.contains("is-selected"))[0] || null;
		}
		const treffer = /\[data-key="(.*)"\]/.exec(sel);
		return treffer ? (ZEILEN.filter((z) => z._key === treffer[1])[0] || null) : null;
	},
	querySelectorAll() { return []; },
	getAttribute() { return null; },
	classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
};

const ELEMENTE = { "garetien-list": LISTE };
["garetien-detailcol", "garetien-listcol", "garetien-apply", "garetien-sheet"].forEach((id) => {
	ELEMENTE[id] = {
		id: id, hidden: false, disabled: false, innerHTML: "", textContent: "",
		addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
});

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienKeySelektor, garetienAuswahlMarkieren, garetienDetailWaehlen } = mod;

wahr(typeof garetienKeySelektor === "function", "garetienKeySelektor fehlt im Export");
wahr(typeof garetienAuswahlMarkieren === "function", "garetienAuswahlMarkieren fehlt im Export");

// =================================================================================================
// 1. Der Selektor -- die Schlüssel tragen `:` und `!`, das muss ein gültiger Selektor bleiben
// =================================================================================================
gleich(garetienKeySelektor("ggp:Gewaesser:Fluss:Garetien:Alling"),
	'[data-key="ggp:Gewaesser:Fluss:Garetien:Alling"]',
	"Doppelpunkte im Wert sind in Anführungszeichen harmlos");
// ⚠️ Ein Anführungszeichen im Wert bräche den Selektor und damit die ganze Auswahl -- deshalb
// entkommt er, obwohl heute kein Schlüssel eines trägt.
wahr(garetienKeySelektor('mit"Anfuehrung').indexOf('mit\\"Anfuehrung') !== -1,
	"ein Anführungszeichen wird entkommen: " + garetienKeySelektor('mit"Anfuehrung'));

// =================================================================================================
// 2. Die Auswahl markiert GENAU eine Zeile und scrollt sie ins Bild
// =================================================================================================
LISTE._selektoren = [];
toggleRufe = 0;
garetienDetailWaehlen("b", [{ key: "b" }]);

gleich(ZEILEN[1].classList.contains("is-selected"), true, "die gewählte Zeile ist markiert");
gleich(ZEILEN[0].classList.contains("is-selected"), false, "die anderen nicht");
gleich(ZEILEN[1]._scrolls.length, 1, "und sie wurde ins Bild gescrollt");
// 🔴 `block: "nearest"` und NICHT "center": eine Zeile, die ohnehin im Bild steht, darf sich nicht
// bewegen -- sonst springt die Liste bei jedem Zeilenklick unter dem Finger weg.
gleich((ZEILEN[1]._scrolls[0] || {}).block, "nearest",
	"gescrollt wird mit block:nearest: " + JSON.stringify(ZEILEN[1]._scrolls[0]));

// =================================================================================================
// 3. 🔴 O(1): kein Lauf über alle Zeilen
// =================================================================================================
gleich(toggleRufe, 0,
	"die Markierung darf NICHT mehr über jede Zeile togglen -- bei 8212 Zeilen sind das 8212 "
	+ "Aufrufe für ein Ergebnis, das zwei betrifft");
wahr(LISTE._selektoren.length <= 2,
	"zwei gezielte Zugriffe genügen (die alte Markierung, die neue Zeile): "
	+ JSON.stringify(LISTE._selektoren));

// =================================================================================================
// 4. Ein Wechsel nimmt die alte Markierung mit -- sonst blieben zwei Zeilen hervorgehoben
// =================================================================================================
garetienDetailWaehlen("c", [{ key: "c" }]);
gleich(ZEILEN[1].classList.contains("is-selected"), false, "die vorherige Zeile ist nicht mehr markiert");
gleich(ZEILEN[2].classList.contains("is-selected"), true, "die neue schon");
gleich(ZEILEN[2]._scrolls.length, 1, "und auch sie wurde gescrollt");

// ---- Abwählen: nichts markiert, nichts gescrollt.
const vorherC = ZEILEN[2]._scrolls.length;
garetienDetailWaehlen(null, []);
gleich(ZEILEN[2].classList.contains("is-selected"), false, "ohne Auswahl ist keine Zeile markiert");
gleich(ZEILEN[2]._scrolls.length, vorherC, "und es wird nichts gescrollt");

// ---- Ein Schlüssel, zu dem es keine Zeile gibt, bricht nichts.
garetienDetailWaehlen("gibtsnicht", []);
gleich(ZEILEN.filter((z) => z.classList.contains("is-selected")).length, 0,
	"ein unbekannter Schlüssel markiert nichts und wirft nicht");

console.log(`garetien-auswahl-scrollen: ${checks} Pruefungen bestanden.`);
