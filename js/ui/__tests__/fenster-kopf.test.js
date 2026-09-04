"use strict";

/*
 * Der EINE Bauer der Fenster-Kopfleiste (js/ui/fenster-kopf.js).
 *
 * 💣 WARUM. Am 04.09.2026 stand derselbe Kopf SIEBENMAL im JavaScript, in vier Dateien. Dieser
 *    Test haelt zweierlei fest: dass der Bauer baut, was das Bauteil erwartet -- und dass die
 *    sieben Erzeuger ihn wirklich RUFEN, statt wieder abzuschreiben. Die zweite Haelfte ist die
 *    wichtigere: ein Bauteil, das niemand benutzt, verhindert keine Divergenz.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8");

let n = 0;
const wahr = (b, t) => { assert.ok(b, t); n++; };

// ---- 1) Der Bauer wird WIRKLICH AUSGEFUEHRT, nicht nur gelesen -------------------------------
// 💣 Ein Regex ueber den Quelltext kennt keinen Geltungsbereich und keine Reihenfolge. Also
//    laeuft er hier gegen eine Dokument-Attrappe -- dieselbe Lehre wie bei den Popup-Bauern
//    (AGENTS.md §11, Regression vom 03.09.2026: gruener Quelltext-Test, kaputte Seite).
const kinder = [];
function macheElement(tag) {
	const el = {
		tagName: tag.toUpperCase(), className: "", textContent: "", id: "", type: "",
		_attr: {}, _kinder: [], _hoerer: [],
		setAttribute(k, v) { this._attr[k] = v; },
		getAttribute(k) { return this._attr[k]; },
		addEventListener(art, fn) { this._hoerer.push([art, fn]); },
		appendChild(kind) { this._kinder.push(kind); return kind; },
	};
	kinder.push(el);
	return el;
}
global.document = { createElement: macheElement };
const { avesmapsFensterKopf } = require(path.join(WURZEL, "js", "ui", "fenster-kopf.js"));

let geklickt = 0;
const teile = avesmapsFensterKopf("Landschaften bearbeiten", {
	wirtsklasse: "avm-editor-dialog__header",
	titelId: "test-titel",
	schliessenAria: "Schließen",
	aufSchliessen: () => { geklickt++; },
});

wahr(teile.kopf.className === "avm-editor-dialog__header avm-fenster__kopf",
	"die Leiste traegt Wirtsklasse UND Bauteilklasse -- an der Wirtsklasse haengen die eigenen "
	+ "Regeln des Fensters (Zieh-Verhalten, Grund), an der Bauteilklasse die Form");
wahr(teile.kopf._kinder.length === 3, "Kopfleiste hat Griff, Titel und Schliessknopf");

const [griff, titel, schliessen] = teile.kopf._kinder;
wahr(griff.className === "avm-fenster__griff", "der Griff traegt seine Bauteilklasse");
wahr(griff.textContent === "⁝⁝", "der Griff sind ZWEI Punktspalten (U+205D zweimal) -- Owner 04.09.2026");
wahr(griff.getAttribute("aria-hidden") === "true",
	"der Griff ist Zierat fuers Auge, kein Bedienelement -- ein Screenreader, der "
	+ "„Doppelpunkt Doppelpunkt\" vorliest, hat nichts gewonnen");

wahr(titel.tagName === "H2" && titel.className === "avm-fenster__titel", "der Titel ist ein h2 mit Bauteilklasse");
wahr(titel.textContent === "Landschaften bearbeiten", "der Titel steht drin");
wahr(titel.id === "test-titel", "die titelId wird gesetzt -- die Huelle zeigt per aria-labelledby darauf");

// 🔴 GEFASST: alle sieben Aufrufer sind Werkzeugfenster. Ein Blatt baut seinen Kopf im Markup
//    und nimmt dort `--nackt` (docs/design-language.md §Fenster, Owner-Entscheid B3).
wahr(schliessen.className === "avm-fenster__knopf avm-fenster__knopf--gefasst",
	"der Schliessknopf ist GEFASST -- im Blatt waere er nackt, aber das baut sein Markup selbst");
wahr(schliessen.type === "button",
	"type=button -- sonst sendet er in einem <form> ab, statt zu schliessen");
wahr(schliessen.getAttribute("aria-label") === "Schließen", "der Schliessknopf hat eine Beschriftung");

schliessen._hoerer.forEach(([art, fn]) => { if (art === "click") fn(); });
wahr(geklickt === 1, "aufSchliessen wird verdrahtet");

// Ohne Handler darf er nicht werfen -- vier der sieben Aufrufer verdrahten spaeter selbst,
// weil ihr `closeOverlay` erst darunter entsteht.
const ohne = avesmapsFensterKopf("Ohne Handler", {});
wahr(ohne.kopf.className === "avm-fenster__kopf", "ohne Wirtsklasse steht nur die Bauteilklasse");
wahr(ohne.schliessen._hoerer.length === 0, "ohne aufSchliessen wird nichts verdrahtet");

// ---- 2) Die sieben Erzeuger rufen ihn auch ----------------------------------------------------
// 💣 DIE WICHTIGERE HAELFTE. Ein Bauteil, das niemand benutzt, verhindert keine Divergenz --
//    genau so sind die 13 Schliessknopf-Rezepturen im CSS entstanden.
const ERZEUGER = [
	["js/review/review-ecosystem-list.js", 1],
	["js/review/review-path-editor-list.js", 1],
	["js/review/review-powerline-list.js", 1],
	["js/review/review-settlement-list.js", 3],
	["js/review/review-wiki-sync.js", 1],
];
let summe = 0;
for (const [datei, erwartet] of ERZEUGER) {
	const quelle = lies(...datei.split("/"));
	const rufe = (quelle.match(/avesmapsFensterKopf\(/g) || []).length;
	wahr(rufe === erwartet,
		`${datei} ruft den Bauer ${rufe}x, erwartet ${erwartet} -- entweder ist ein Fenster `
		+ "dazugekommen oder eines schreibt wieder ab");
	summe += rufe;
	// Und keine Abschrift daneben.
	wahr(!/header\.className\s*=\s*"[^"]*__header"/.test(quelle),
		`${datei} baut wieder eine eigene Kopfleiste -- das ist die achte Abschrift`);
}
wahr(summe === 7, `sieben Fenster-Koepfe erwartet, gezaehlt ${summe}`);

// ---- 3) Der Bauer ist eingebunden, und VOR seinen Nutzern -------------------------------------
// 💣 Nur script-TAGS vergleichen: ein Dateiname in einem Kommentar steht frueher und macht aus
//    einer richtigen Reihenfolge einen Fehlalarm -- beim Bau am 04.09.2026 genau so passiert.
const html = lies("index.html");
const tag = (d) => html.indexOf('<script src="' + d + '">');
const kopfPos = tag("js/ui/fenster-kopf.js");
wahr(kopfPos > 0, "js/ui/fenster-kopf.js ist nicht in index.html eingebunden -- dann wirft der "
	+ "erste Klick auf einen Editor `avesmapsFensterKopf is not defined`");
for (const [datei] of ERZEUGER) {
	wahr(tag(datei) > kopfPos, `${datei} laedt VOR dem Bauer`);
}

console.log(`fenster-kopf: ${n} Zusicherungen gruen.`);
