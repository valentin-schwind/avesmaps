// Der Minimieren-Knopf des Garetien Importers -- das Fenster rollt auf seine Titelleiste zusammen.
// Owner 04.09.2026: „kannst du den garetien importer eine minimieren button geben, dass das fenster
// auf die titelleiste zusammenrollt (wie konflikte)".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-fenster-einklappen.test.js
//
// ⭐ GEMESSEN WIRD AM ERGEBNIS in einem gefaelschten `document`, nicht an einer Zeile im Quelltext:
//    ein Regex kennt keinen Geltungsbereich (die Lehre vom 03.09.2026, `quellenSchluessel`). Der
//    Knopf wird wirklich geklickt, und der Oeffner wirklich gefahren.
// 💣 `hasDocument` wird beim LADEN ausgewertet -- das `document` muss VOR dem `require` stehen.
// 💣 UND DIE CSS-HAELFTE WIRD MITGEPRUEFT, obwohl sie nach blosser Optik aussieht: ohne
//    `!important` an der Hoehe ist das Merkmal fuer jeden STILL kaputt, der das Fenster je an der
//    Ecke aufgezogen hat (`resize: both` schreibt eine Inline-Hoehe, und die schlaegt jede
//    Klassenregel). Die Klasse wird gesetzt, der Inhalt verschwindet -- und der leere Kasten bleibt
//    in voller Hoehe stehen. Genau dieser Fall faellt in einem reinen Verhaltenstest nie auf.
// 🪤 KOMMENTARE ZUERST WEG. Die Regeln in garetien-importer.css ERKLAEREN sich ausfuehrlich und
//    nennen `height: auto`, `!important` und `resize` woertlich im Fliesstext -- ohne das Strippen
//    faenden die Zusicherungen darunter ihre Zeichenfolge im KOMMENTAR und blieben gruen, waehrend
//    die Regel fehlt. Dieselbe Falle wie in garetien-fenster-huelle.test.js.
// ⚠️ CRLF-Falle (AGENTS.md §9): jede gelesene Datei wird sofort auf LF normalisiert.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

// ---- Das gefaelschte `document` ---------------------------------------------------------------
//
// ⚠️ Absichtlich mager -- `getElementById` liefert die drei Elemente, um die es geht, und `null`
// fuer alles andere. Jede beruehrte Stelle des Oeffners ist gegen `null` abgesichert.
// 🔴 `classList` MERKT SICH ETWAS. Eine Attrappe mit leeren Methoden (wie in den Nachbartests)
// waere hier genau die Attrappe, die den Fehler verschluckt: der Zustand IST die Klasse.
function macheElement(id) {
	const klassen = new Set();
	return {
		id,
		hidden: false,
		textContent: "",
		innerHTML: "",
		title: "",
		dataset: {},
		style: {},
		_attr: {},
		_hoerer: {},
		classList: {
			add(k) { klassen.add(k); },
			remove(k) { klassen.delete(k); },
			contains(k) { return klassen.has(k); },
			toggle(k, an) {
				if (an === true) { klassen.add(k); }
				else if (an === false) { klassen.delete(k); }
				else if (klassen.has(k)) { klassen.delete(k); }
				else { klassen.add(k); }
				return klassen.has(k);
			},
		},
		setAttribute(name, wert) { this._attr[name] = wert; },
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(this._attr, name) ? this._attr[name] : null;
		},
		addEventListener(art, fn) { (this._hoerer[art] = this._hoerer[art] || []).push(fn); },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		/** Einen echten Klick zustellen, so wie der Browser es taete. */
		klick() {
			(this._hoerer.click || []).forEach((fn) => fn({ target: this }));
			return (this._hoerer.click || []).length;
		},
	};
}

const ELEMENTE = {};
["garetien-importer", "garetien-importer-min", "garetien-importer-close"]
	.forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: {},
	// „complete": boot() laeuft schon beim `require`, die Verdrahtung steht vor der ersten Zusicherung.
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelector() { return null; },
	querySelectorAll() { return []; },
};
global.window = global.window || {};
// Der Oeffner fuellt das Fenster ueber das Netz. Eine wohlgeformte, leere Antwort haelt die Kette
// ruhig -- gemessen wird hier die SYNCHRONE Haelfte, die davor laeuft.
global.fetch = function () {
	return Promise.resolve({ json() { return Promise.resolve({ ok: true }); } });
};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienFensterEinklappen, garetienFensterEingeklappt } = mod;

wahr(typeof garetienFensterEinklappen === "function", "garetienFensterEinklappen fehlt im Export");
wahr(typeof garetienFensterEingeklappt === "function", "garetienFensterEingeklappt fehlt im Export");

const WIN = ELEMENTE["garetien-importer"];
const KNOPF = ELEMENTE["garetien-importer-min"];

// =================================================================================================
// A. Der Zustand IST die Klasse -- und der Knopf sagt, was der naechste Klick tut
// =================================================================================================

gleich(garetienFensterEingeklappt(), false, "frisch geladen ist nichts eingeklappt");

garetienFensterEinklappen(true);
gleich(WIN.classList.contains("is-minimized"), true,
	"eingeklappt traegt die Huelle `is-minimized` -- daran haengt die ganze CSS-Haelfte");
gleich(garetienFensterEingeklappt(), true, "und der Leser liest genau diese Klasse");
gleich(KNOPF.textContent, "□", "eingeklappt zeigt der Knopf U+25A1, wie im Konflikte-Fenster");
gleich(KNOPF.getAttribute("aria-label"), "Fenster ausklappen",
	"💣 die Beschriftung sagt, was der KLICK tut, nicht wie das Fenster gerade steht -- sonst liest "
	+ "ein Screenreader den Ist-Zustand vor und der Benutzer klappt zu, statt aufzumachen");
wahr(/wieder auf/.test(KNOPF.title), "und der Titel wandert mit der Beschriftung");

garetienFensterEinklappen(false);
gleich(WIN.classList.contains("is-minimized"), false, "ausgeklappt faellt die Klasse weg");
gleich(garetienFensterEingeklappt(), false, "und der Leser sagt es auch");
gleich(KNOPF.textContent, "−", "ausgeklappt zeigt der Knopf U+2212 (das Minuszeichen)");
gleich(KNOPF.getAttribute("aria-label"), "Fenster einklappen", "und die Beschriftung dreht mit");
wahr(/Titelleiste/.test(KNOPF.title), "der Titel nennt die Titelleiste beim Namen");

// 💣 GEPRUEFT WIRD AUF `=== true`, nicht wahrheitswertig. Der realistische Fehlgriff ist
// `addEventListener("click", garetienFensterEinklappen)` -- dann kommt das EREIGNIS herein, ein
// Objekt und damit truthy, und das Fenster klappte bei jedem Klick ein und nie wieder aus. Mit
// `undefined` allein liesse sich das nicht unterscheiden (`!!undefined` ist ebenfalls false).
garetienFensterEinklappen({ type: "click" });
gleich(WIN.classList.contains("is-minimized"), false,
	"ein hereingereichtes Ereignis ist KEIN Einklapp-Wunsch");
garetienFensterEinklappen(undefined);
gleich(WIN.classList.contains("is-minimized"), false,
	"und ohne Argument wird ebenso wenig eingeklappt -- der Riegel faellt offen aus");

// =================================================================================================
// B. Der Knopf ist verdrahtet, und er SCHALTET UM (nicht: klappt immer ein)
// =================================================================================================

gleich(KNOPF.klick(), 1, "genau EIN Klick-Hoerer haengt am Knopf -- zwei hoben sich gegenseitig auf");
gleich(garetienFensterEingeklappt(), true, "der erste Klick klappt ein");
KNOPF.klick();
gleich(garetienFensterEingeklappt(), false,
	"und der zweite wieder aus -- der Knopf liest seinen Zustand aus der Klasse, die er selbst setzt");

// =================================================================================================
// C. Geoeffnet wird AUSGEKLAPPT
// =================================================================================================
//
// Wer den Importer aufmacht und eine blosse Titelleiste bekaeme, hielte das fuer einen Fehlklick.
// Dieselbe Regel wie im Konflikte-Fenster (setWikiSyncConflictsDialogOpen ruft dort sein
// setConflictDialogMinimized(false)). Der Oeffner wird WIRKLICH gefahren, nicht gelesen.

garetienFensterEinklappen(true);
WIN.hidden = true;
gleich(garetienFensterEingeklappt(), true, "Vorbedingung: eingeklappt und zu");
global.window.avesmapsGaretienImporter.oeffnen();
gleich(garetienFensterEingeklappt(), false, "das Oeffnen klappt das Fenster wieder auf");
gleich(WIN.hidden, false, "und macht es sichtbar (die Gegenprobe, dass der Oeffner wirklich lief)");

// =================================================================================================
// D. Die CSS-Haelfte -- ohne sie ist der Klick oben folgenlos
// =================================================================================================

const cssOhneKommentar = lies("css", "components", "garetien-importer.css")
	.replace(/\/\*[\s\S]*?\*\//g, "");

const rollRegel = /\.gi-win\.is-minimized\s*\{([^}]*)\}/.exec(cssOhneKommentar);
wahr(rollRegel, "`.gi-win.is-minimized` fehlt -- die Klasse aus Abschnitt A haette keine Wirkung");

wahr(/\bheight:\s*auto\s*!important\b/.test(rollRegel[1]),
	"💣 OHNE `!important` ist das Merkmal fuer jeden still kaputt, der das Fenster je an der Ecke "
	+ "aufgezogen hat: `resize: both` schreibt eine INLINE-Hoehe, und die schlaegt jede "
	+ "Klassenregel. Der Inhalt verschwindet, der leere Kasten bleibt in voller Hoehe stehen.");
wahr(/\bmin-height:\s*0\b/.test(rollRegel[1]),
	"💣 die 360px Mindesthoehe der Huelle muessen mitfallen -- gegen sie kann nichts auf eine "
	+ "Titelleiste schrumpfen");
wahr(/\bresize:\s*none\b/.test(rollRegel[1]),
	"💣 eine Zieh-Ecke an einer blossen Titelleiste schriebe eine Inline-Hoehe, die das !important "
	+ "daneben sofort ueberstimmt -- ein Zug, der nichts tut, liest sich als Fehler");

// 🔴 EIN Selektor statt einer Liste der vier Bloecke: eine Liste veraltet lautlos, und der naechste
// Block stuende eingeklappt sichtbar da. Geprueft wird deshalb die FORM, nicht die Wirkung auf die
// heutigen vier.
// 🔴 SEIT 04.09.2026 IM BAUTEIL (css/components/fenster.css): die Huelle traegt
// `.avm-fenster`, und dort steht `.avm-fenster.is-minimized > :not(.avm-fenster__kopf)`.
// Geprueft wird weiterhin die FORM -- EIN Selektor statt einer Liste der heutigen Bloecke --,
// nur eben in der Datei, die sie jetzt haelt. Haenge die Regel nie wieder hierher zurueck:
// zwei Fassungen derselben Regel sind genau die Divergenz, die das Bauteil beendet.
const bauteilCss = lies("css/components/fenster.css").replace(/\/\*[\s\S]*?\*\//g, "");
wahr(/\.avm-fenster\.is-minimized\s*>\s*:not\(\.avm-fenster__kopf\)\s*\{[^}]*display:\s*none/.test(bauteilCss),
	"eingeklappt bleibt GENAU die Kopfzeile stehen -- ueber `> :not(.avm-fenster__kopf)` im "
	+ "Bauteil, nicht ueber eine Liste der heutigen Bloecke, die beim naechsten Zuwachs "
	+ "lautlos veraltet");
wahr(!/\.gi-win\.is-minimized\s*>\s*:not\(/.test(cssOhneKommentar),
	"die alte Zonen-Regel steht noch in garetien-importer.css -- zwei Fassungen derselben Regel");

// Die Basisregel bleibt unberuehrt: ausgeklappt ist das Fenster weiter aufziehbar.
const basis = cssOhneKommentar.slice(
	cssOhneKommentar.indexOf(".gi-win {"), cssOhneKommentar.indexOf(".gi-win[hidden]"));
wahr(/\bresize:\s*both\b/.test(basis) && /\bmin-height:\s*\d/.test(basis),
	"die Huelle behaelt ausgeklappt ihre Zieh-Ecke und ihren Boden");

// =================================================================================================
// E. Der Knopf steht in der Titelleiste, VOR dem Schliessen-Kreuz
// =================================================================================================

const html = lies("index.html");
const kopfVon = html.indexOf('<div class="avm-fenster__kopf">');
wahr(kopfVon > 0, "die Titelleiste des Importers fehlt in index.html");
const kopf = html.slice(kopfVon, html.indexOf("</div>", kopfVon));
wahr(kopf.length < 1500,
	`der geschnittene Kopf ist ${kopf.length} Zeichen lang -- das ist keine Titelleiste mehr. Eine `
	+ "Zusicherung, die ihren eigenen Ausschnitt nicht kennt, ist keine.");
wahr(kopf.includes('id="garetien-importer-min"'),
	"der Knopf gehoert IN die Titelleiste -- dort nimmt dialog-drag.js ihn als Bedienelement aus "
	+ "(AVESMAPS_DIALOG_DRAG_IGNORE), statt bei seinem Klick das Fenster zu verschieben");
wahr(kopf.indexOf('id="garetien-importer-min"') < kopf.indexOf('id="garetien-importer-close"'),
	"⚠️ Einklappen steht LINKS vom Schliessen -- dieselbe Reihenfolge wie im Konflikte-Fenster und "
	+ "wie in jedem Fensterrahmen: rechts aussen liegt das Kreuz");
wahr(/id="garetien-importer-min"[\s\S]{0,300}?aria-label="Fenster einklappen"/.test(kopf),
	"der Knopf startet mit der ausgeklappten Beschriftung -- so, wie das Fenster oeffnet");

console.log(`garetien-fenster-einklappen: ${checks} Zusicherungen gruen.`);
