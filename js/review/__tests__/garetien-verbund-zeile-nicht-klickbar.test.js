// Fixrunde 1, Befund F2 -- die Verbund-Zeile (`.gi-seg` im Verbund-Block, ein `<div>`) erbte den
// Zeiger UND den Hover-Grund der Abschnittszeile daneben (dasselbe `.gi-seg`, aber dort ein
// `<label>`, dessen GANZE Zeile den Haken auslöst). Nur der ✕ tut in der Verbund-Zeile etwas --
// die geteilte Regel bleibt unangetastet (sie trägt weiterhin die wirklich klickbare
// Abschnittszeile), ein Modifikator `.gi-seg--verbund` nimmt Zeiger und Hover-Grund NUR dort
// zurück.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-zeile-nicht-klickbar.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }

// ---- A. Das Markup: die Verbund-Zeile traegt den Modifikator, die Abschnittszeile NICHT --------

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const api = mod;

const objekte = [1, 2].map((i) => ({
	key: "ggp:felsried:" + i, name: "Felsried " + i, ebene: "Waelder", typ: "Wald",
	verbund_stamm: "Felsried", verbund_n: 2, geometrie: [[0, 0]],
}));

// 🔴 Aufgabe 7 (14.09.2026): der Bauer ist exportiert und liest die STAGE -- die Fragmente liegen
// darauf, damit ihr ✕ (und damit die ganze Zeilenform) wirklich gezeichnet wird. Der `vm`-Schnitt von
// vorher kannte die Stage nicht und fiele mit einem ReferenceError um.
api.avesmapsGaretienStageHinzufuegen(objekte);
const markup = api.garetienVerbundBlockMarkup(objekte[0], objekte);
wahr(markup.indexOf('class="gi-seg gi-seg--verbund"') > -1,
	"jede Verbund-Zeile traegt gi-seg--verbund: " + markup.slice(0, 300));
wahr((markup.match(/class="gi-seg gi-seg--verbund"/g) || []).length === 2,
	"beide Fragmentzeilen tragen den Modifikator, nicht nur die erste");
wahr(!/class="gi-seg"[^-]/.test(markup),
	"keine Verbund-Zeile bleibt bei der blossen .gi-seg-Klasse (dann saehe sie klickbar aus)");

// ---- B. Die Abschnittszeile (garetienAbschnittMarkup) traegt den Modifikator NICHT -- sie ist die
// wirklich klickbare Zeile und darf ihn nicht verlieren. Gemessen an der ECHTEN Funktion (nicht am
// obigen Bauer), damit eine Verwechslung der beiden .gi-seg-Erzeuger auffiele. -------------------

const objektMitAbschnitt = {
	key: "ggp:abschnitt:1", name: "Abschnitt-Objekt",
	abschnitte: [{ public_id: "a1", name: "", punkte: 3 }],
	probepunkte: 3,
};
// garetienAbschnittsItems/-Lage/-Felder haengen an Modulinternem (unser*Items); der einfachste,
// stabile Weg ist derselbe wie in garetien-einzelansicht.test.js: die ECHTE garetienDetailMarkup
// ueber ein Objekt OHNE Verbund fahren und die Abschnittszeile darin pruefen.
delete objektMitAbschnitt.verbund_stamm;
const spalteMitAbschnitt = api.garetienDetailMarkup(objektMitAbschnitt, null, false);
if (spalteMitAbschnitt.indexOf("gi-seg") > -1) {
	wahr(spalteMitAbschnitt.indexOf("gi-seg--verbund") === -1,
		"die Abschnittszeile bleibt bei der geteilten .gi-seg-Regel: " + spalteMitAbschnitt.slice(0, 500));
}

// ---- C. Das CSS: die geteilte `.gi-seg`-Regel ist UNVERAENDERT (kein `cursor: default` darin),
// und der Modifikator steht als EIGENE Regel daneben. ---------------------------------------------

const cssRoh = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8");
const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, "");

const geteilteRegel = (css.match(/(?<!--verbund)\.gi-seg\s*\{[^}]*\}/) || [""])[0];
wahr(geteilteRegel !== "", "die geteilte .gi-seg-Regel fehlt -- die Gegenprobe misst sonst nichts");
wahr(!/cursor:\s*default/.test(geteilteRegel),
	"die geteilte .gi-seg-Regel bleibt anfassbar -- F2 loest ueber einen Modifikator, nicht hier");
wahr(/cursor:\s*pointer/.test(geteilteRegel),
	"die Abschnittszeile bleibt klickbar (cursor: pointer) -- unveraendert");

const modifikatorRegel = (css.match(/\.gi-seg--verbund\s*\{[^}]*\}/) || [""])[0];
wahr(modifikatorRegel !== "", "die Regel .gi-seg--verbund fehlt");
wahr(/cursor:\s*default/.test(modifikatorRegel),
	"die Verbund-Zeile setzt ihren Zeiger auf default zurueck");

const hoverRegel = (css.match(/\.gi-seg--verbund:hover\s*\{[^}]*\}/) || [""])[0];
wahr(hoverRegel !== "", "die Hover-Regel .gi-seg--verbund:hover fehlt");
wahr(/background:\s*none/.test(hoverRegel),
	"der Hover-Grund der Verbund-Zeile ist zurueckgenommen -- sonst haellte sie hovering, wo nichts passiert");

// 💣 Keine Farbe, kein Radius hartkodiert (AGENTS.md §12) -- gemessen am neuen Block.
const neuerBlock = modifikatorRegel + "\n" + hoverRegel;
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(neuerBlock), "kein hartkodierter Farbwert im neuen Block");
wahr(!/\brgba?\(/.test(neuerBlock), "kein hartkodiertes rgb()/rgba() im neuen Block");

console.log(`garetien-verbund-zeile-nicht-klickbar: ${checks} Pruefungen bestanden.`);
