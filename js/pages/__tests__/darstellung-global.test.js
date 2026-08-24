const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die globale Deckkraft im Fenster „Darstellung" (Entwurf §5.3).
//
// 💣 DIE REGEL: der globale Wert UEBERSCHREIBT den Zeilenwert, er LOESCHT ihn nicht. Ein Haekchen
// ist keine Datenaenderung -- Zeile auf 15 %, global an, global aus, und die 15 % steht noch da.
// 🔴 „Global" heisst FUER DIESE EBENE. Die vier Vorgaben sagen Verschiedenes (0,16 / 0,72 / 0,72 /
// 0,30); eine Zahl ueber alle vier zoege sie zusammen und aenderte das heutige Bild.
//
// 🪤 Der Test SCHNEIDET die Regel aus dem Fenster und FUEHRT SIE AUS. Eine im Test nachgebaute
// Fassung waere gruen geblieben, egal was das Fenster tut -- die Lehre aus dem Bandtest.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-global.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");

function schneide(name) {
	const von = editor.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht im Fenster");
	const bis = editor.indexOf("\n}", von);
	assert.ok(bis > von, name + " hat ein Ende");
	return editor.slice(von, bis + 2);
}

// Der Zustand, den die vier Funktionen sehen: ein Teilbaum und die Vorgabe der Ebene.
let zustand = {};
const ecoDisplayTeil = (name) => zustand[name] || {};
const ecoDisplayKeyFl = (kind, art) => kind + ":" + art;
const VORGABE = { derographisch: 0.16, vegetation: 0.72, topographie: 0.72, klima: 0.3 };
const avesmapsEcosystemDisplayDeckkraft = (kind) => VORGABE[kind];

const gebaut = new Function(
	"ecoDisplayTeil", "ecoDisplayKeyFl", "avesmapsEcosystemDisplayDeckkraft",
	[
		schneide("ecoDisplayGlobalAn"),
		schneide("ecoDisplayGlobalWert"),
		schneide("ecoDisplayDeckWirkt"),
		schneide("ecoDisplayDeckZeile"),
		"return { ecoDisplayGlobalAn, ecoDisplayGlobalWert, ecoDisplayDeckWirkt, ecoDisplayDeckZeile };"
	].join("\n")
)(ecoDisplayTeil, ecoDisplayKeyFl, avesmapsEcosystemDisplayDeckkraft);

// ---- A. Ohne alles gilt die Vorgabe DER EBENE --------------------------------------------------
zustand = {};
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("vegetation", "wald"), 0.72, "Vegetation bleibt bei 0,72");
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("derographisch", "sumpf"), 0.16, "Derographie bleibt bei 0,16");
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("klima", "polar"), 0.3, "Klima bleibt bei 0,30");

// ---- B. 🔴 Das Haekchen ist ANFANGS AN ----------------------------------------------------------
// Sonst oeffnete das erste Aufschlagen des Fensters alle Werte je Art -- und das heutige Bild der
// Karte ist genau eine Deckkraft je Ebene.
assert.strictEqual(gebaut.ecoDisplayGlobalAn("vegetation"), true, "das Haekchen startet an");

// ---- C. Global gewinnt, waehrend es an ist ------------------------------------------------------
zustand = { global: { vegetation: { an: true, wert: 0.9 } }, deckkraft: { "vegetation:wald": 0.15 } };
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("vegetation", "wald"), 0.9, "global ueberschreibt");
// 💣 ...und der Zeilenwert steht die ganze Zeit unveraendert daneben.
assert.strictEqual(gebaut.ecoDisplayDeckZeile("vegetation", "wald"), 0.15,
	"die Zeile traegt ihre 15 %, auch waehrend global wirkt");

// ---- D. Abgehakt kommt der Zeilenwert UNVERAENDERT zurueck --------------------------------------
zustand.global.vegetation.an = false;
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("vegetation", "wald"), 0.15,
	"abgehakt gilt wieder die Zeile -- nichts wurde geloescht");

// ---- E. Die Ebene daneben bleibt unberuehrt ------------------------------------------------------
// 🔴 Ein globaler Wert der Vegetation darf die Topographie nicht mitziehen.
assert.strictEqual(gebaut.ecoDisplayDeckWirkt("topographie", "gebirge"), 0.72,
	"die Topographie kennt den Wert der Vegetation nicht");

// ---- F. Der globale Wert einer Ebene faellt auf DEREN Vorgabe zurueck ---------------------------
zustand = { global: { derographisch: { an: true } } };
assert.strictEqual(gebaut.ecoDisplayGlobalWert("derographisch"), 0.16,
	"ohne eigene Zahl nimmt global die Vorgabe der Ebene, nicht die einer anderen");

console.log("darstellung-global: alle Zusicherungen gruen");
