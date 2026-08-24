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

// ---- G. 🪤 DAS FENSTER SCHIEBT NUR DIE KURVENWERTE INS GETEILTE MODUL ---------------------------
// Die Vorschau der Kurvenfeinheiten braucht sie dort, weil avesmapsCurveLabelFit sie von dort
// liest. Der erste Bau schob die GANZE Arbeitstafel hinein -- und damit war das Modul kein
// Vorgabengeber mehr, sondern ein SPIEGEL des Fensters: `ecoDisplayDeckZeile` fragt es nach der
// VORGABE einer Art und bekam den gerade getippten Wert zurueck.
//
// 💣 Sichtbar wurde das erst beim Zuruecksetzen: die Farbe sprang zurueck, die Deckkraft blieb auf
// 82 % stehen, und der Kurvenwert des Moduls ueberdauerte ueberhaupt. Am 24.08.2026 im Browser
// gemessen, von keinem Test.
const vonI = editor.indexOf("function ecoDisplayInstalliereKurve");
assert.ok(vonI >= 0, "es gibt einen eigenen Installierer");
const rumpfI = editor.slice(vonI, editor.indexOf(String.fromCharCode(10) + "}", vonI));
assert.ok(/\{ kurve: ecoDisplayTeil\("kurve"\) \}/.test(rumpfI),
	"er gibt NUR die Kurvenwerte weiter");

// 🔴 Und sonst installiert NIEMAND -- eine zweite Stelle mit der ganzen Tafel holte den Fehler
// zurueck. Erlaubt ist genau der Installierer.
let vonA = editor.indexOf("avesmapsEcosystemDisplayInstall(");
while (vonA !== -1) {
	const zeile = editor.slice(editor.lastIndexOf(String.fromCharCode(10), vonA) + 1,
		editor.indexOf(String.fromCharCode(10), vonA));
	// 🪤 Ein Kommentar zaehlt nicht: die Begruendung im Installierer NENNT den alten Aufruf, und
	// ein Test, der ihn trifft, prueft seine eigene Prosa. Vierter Fall derselben Falle in diesem
	// Umbau -- deshalb steht sie hier ausdruecklich.
	const getrimmt = zeile.trim();
	const istKommentar = getrimmt.charAt(0) === "*" || getrimmt.slice(0, 2) === "//";
	assert.ok(istKommentar || (vonA > vonI && vonA < vonI + rumpfI.length),
		"avesmapsEcosystemDisplayInstall steht NUR im Installierer, nicht bei: " + zeile.trim());
	vonA = editor.indexOf("avesmapsEcosystemDisplayInstall(", vonA + 1);
}

// ---- H. Zuruecksetzen nimmt das Modul MIT --------------------------------------------------------
const vonR = editor.indexOf('$("ecoDisplayReset").addEventListener');
assert.ok(vonR >= 0, "der Ruecksetzer steht in der Datei");
// ⚠️ Bis zur ERFOLGSMELDUNG, nicht bis zum ersten `});` -- `ecoDisplayPost({ action: "reset" });
// endet selbst darauf und schnitt den Rumpf vor der gesuchten Zeile ab.
const rumpfR = editor.slice(vonR, editor.indexOf("Auf Vorgabe zur", vonR));
assert.ok(/ecoDisplayInstalliereKurve\(\)/.test(rumpfR),
	"nach dem Zuruecksetzen wird das geteilte Modul geleert -- sonst zeichnet die Vorschau weiter");

console.log("darstellung-global: alle Zusicherungen gruen");
