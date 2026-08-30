// Zwei Owner-Auftraege vom 30.08.2026, beide im Fussknopf-Bund des Garetien-Importers:
//
//   1. „Beim Klick auf 'Markierte anzeigen' kannst du auf das 'Anzeigen'-Tab gehen."
//   2. „außerdem wär ein button mit 'Alle zentrieren' hilfreich, wo die ansicht auf alle in
//      'Anzeigen' gelisteten objekte zoomt (gemeinsamer mittelpunkt und vermutlich herauszoomt)"
//
// 🔴 GEPRUEFT WIRD DER ECHTE KLICK, nicht die reine Funktion daneben. Beide Auftraege sind
// VERDRAHTUNG: die eine setzt einen Zustand, die andere ruft den Zeichner -- eine Zusicherung ueber
// „die Funktion tut das Richtige" liesse offen, ob der Knopf sie ueberhaupt erreicht. Genau diese
// Luecke hat eine Mutationsprobe hier aufgedeckt: der Reiterwechsel liess sich entfernen, ohne dass
// ein einziger Test rot wurde.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-zentrieren-und-reiter.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen (Vorbild: garetien-fussknopf-dom.test.js).

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

// ---- Das gefaelschte `document` -- VOR dem require ---------------------------------------------
function macheElement(id) {
	return {
		id: id, hidden: false, disabled: false, textContent: "", innerHTML: "", value: "",
		dataset: {}, _hoerer: {},
		addEventListener(art, fn) {
			this._hoerer[art] = this._hoerer[art] || [];
			this._hoerer[art].push(fn);
		},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
		/** Einen echten Klick ausloesen -- so, wie ihn der Browser zustellt. */
		klick() {
			(this._hoerer.click || []).forEach((fn) => fn({ target: this }));
			return (this._hoerer.click || []).length;
		},
	};
}

const ELEMENTE = {};
[
	"garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-list", "garetien-sheet",
	"garetien-mark-all", "garetien-mark-none", "garetien-mark-show", "garetien-anzeige-clear",
	"garetien-zentrieren-alle", "garetien-detailcol", "garetien-tabs",
].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: {},
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienAlleZentrierenZustand,
	garetienAlleZentrierenKnopfSetzen,
	avesmapsGaretienAnzeigeLeeren,
	avesmapsGaretienAnzeigeHinzufuegen,
	avesmapsGaretienMarkierungUmschalten,
	avesmapsGaretienFensterZustand,
} = mod;

wahr(typeof garetienAlleZentrierenZustand === "function", "garetienAlleZentrierenZustand fehlt im Export");
wahr(typeof garetienAlleZentrierenKnopfSetzen === "function", "garetienAlleZentrierenKnopfSetzen fehlt im Export");

const ZENTRIEREN = ELEMENTE["garetien-zentrieren-alle"];
const MARK_SHOW = ELEMENTE["garetien-mark-show"];

// =================================================================================================
// A. „Alle zentrieren" -- REIN: Beschriftung ohne Zahl, gesperrt bei leerer Anzeige
// =================================================================================================
const zLeer = garetienAlleZentrierenZustand(0);
gleich(zLeer.beschriftung, "Alle zentrieren", "die Beschriftung ist die des Auftrags, ohne Zahl");
gleich(zLeer.gesperrt, true, "liegt nichts auf der Karte, gibt es nichts zu zentrieren");
gleich(garetienAlleZentrierenZustand().gesperrt, true, "ganz ohne Argument gilt dasselbe wie 0");
gleich(garetienAlleZentrierenZustand(3).gesperrt, false, "mit Objekten auf der Karte ist er bedienbar");
// 🔴 OHNE Hinweistext -- wie seine Nachbarn seit dem 30.08.2026 (Owner: „verbraucht nur platz").
gleich(zLeer.hinweis, undefined, "der Zustand traegt keinen Hinweistext");

// =================================================================================================
// B. Die DOM-Haelfte schreibt beides an den Knopf
// =================================================================================================
garetienAlleZentrierenKnopfSetzen(0);
gleich(ZENTRIEREN.textContent, "Alle zentrieren", "die Beschriftung steht am Knopf");
gleich(ZENTRIEREN.disabled, true, "und die Sperre auch");
garetienAlleZentrierenKnopfSetzen(2);
gleich(ZENTRIEREN.disabled, false, "zwei Objekte auf der Karte oeffnen ihn -- sonst waere es Vakuum");

// =================================================================================================
// C. Der KLICK ruft den Zeichner -- mit dem, was wirklich auf der Karte liegt
// =================================================================================================
avesmapsGaretienAnzeigeLeeren();
const eins = { key: "z:1", name: "Eins", geometrie: [[10, 10]], items: [] };
const zwei = { key: "z:2", name: "Zwei", geometrie: [[20, 20]], items: [] };
avesmapsGaretienAnzeigeHinzufuegen([eins, zwei]);

let gerufenMit = null;
let rufe = 0;
global.window.avesmapsGaretienKarteAlleZentrieren = function (objekte) {
	rufe++; gerufenMit = objekte; return { kasten: true };
};

garetienAlleZentrierenKnopfSetzen(2);   // damit er nicht gesperrt ist
wahr(MARK_SHOW._hoerer.click && ZENTRIEREN._hoerer.click,
	"beide Knoepfe muessen ueberhaupt einen Zuhoerer tragen -- sonst misst der Rest nichts");
ZENTRIEREN.klick();
gleich(rufe, 1, "ein Klick ruft den Zeichner GENAU einmal");
gleich((gerufenMit || []).length, 2, "und reicht ihm beide angezeigten Objekte");

// 🔴 Ein GESPERRTER Knopf tut nichts -- das Attribut ist die Anzeige, der Riegel steht im Handler
// (dieselbe Hausform wie beim Fussknopf „Angehakte übernehmen").
ZENTRIEREN.disabled = true;
ZENTRIEREN.klick();
gleich(rufe, 1, "der gesperrte Knopf ruft nicht");
ZENTRIEREN.disabled = false;

// ⚠️ Und ohne den Zeichner (Importer auf einer Seite ohne Karte) bricht nichts.
delete global.window.avesmapsGaretienKarteAlleZentrieren;
ZENTRIEREN.klick();
gleich(rufe, 1, "ohne geladenen Zeichner passiert nichts, und es wirft auch nichts");

// =================================================================================================
// D. „Markierte anzeigen" wechselt auf den Reiter „Anzeigen"
// =================================================================================================
// 💣 DIESER ABSCHNITT IST DER GRUND FUER DIESE DATEI. Vor ihm liess sich die Zeile
// `zustand.stand = "anzeigen"` entfernen, ohne dass irgendein Test im Repo rot wurde.
avesmapsGaretienAnzeigeLeeren();
avesmapsGaretienMarkierungUmschalten("z:1");
wahr(avesmapsGaretienFensterZustand().stand !== "anzeigen",
	"Zeuge: vorher steht der Reiter NICHT auf „Anzeigen\" -- sonst belegt die Zeile darunter nichts");
MARK_SHOW.klick();
gleich(avesmapsGaretienFensterZustand().stand, "anzeigen",
	"nach dem Klick steht der Reiter auf „Anzeigen\" -- dort liegt, was der Knopf gerade "
	+ "hineingelegt hat");

avesmapsGaretienAnzeigeLeeren();

console.log(`garetien-zentrieren-und-reiter: ${checks} Pruefungen bestanden.`);
