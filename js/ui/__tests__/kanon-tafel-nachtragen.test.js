"use strict";

/**
 * DAS ETIKETT NACHTRAGEN -- EIN Bauer, und ein vierter Schreiber faellt auf.
 *
 * 🔴 Owner 10.09.2026: „aktualisierungen sollen gleich sichtbar sein - ohne dass der browser neu
 * geladen werden muss", „so wie normale mapaenderungen auch". Eine normale Kartenaenderung reist
 * ueber den Live-Abgleich -- der holt aber ein DELTA, und ein Delta traegt seit dem 03.09.2026
 * keinen Kanon. Das Etikett kommt deshalb in der Antwort des Schreibvorgangs mit.
 *
 * 💣 DREI SCHREIBER, EINE REGEL. Dieselben drei Zeilen standen schon in review-settlement-wiki.js
 * (02.09.2026) und review-feature-sources.js (09.09.2026); die Landschaftsflaeche waere die dritte
 * Abschrift gewesen. Abschnitt 3 zaehlt sie repoweit und haelt sie gegen eine ausgeschriebene Liste
 * -- ein VIERTER Schreiber faellt damit auf, statt still danebenzustehen.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
// 💣 ZEILENENDENNEUTRAL, und das ist hier tragend (AGENTS.md §9): die Arbeitskopie traegt CRLF,
// `actions/checkout` legt LF hin. Gesucht wird unten nach `\n}\n` -- in einer CRLF-Datei steht dort
// `\r\n}\r\n`, der Anker wird NIE gefunden, und `-1 + 3` ist **2**: `slice(25200, 2)` ergibt die
// LEERE Zeichenkette, das vm fuehrt nichts aus, und der Test fiel mit „nachtragen is not a
// function" um -- auf jedem Windows-Checkout rot, in der CI gruen. Das ist die Spiegelform der
// Falle, die §9 beschreibt, und sie kostet dieselbe Zeit: wer das Feld rot sieht, haelt es fuer
// kaputt oder sich selbst fuer den Verursacher. Gemessen 12.09.2026: popups.js 1376 CRLF, 0 nackte
// LF. Normalisiert wird die ganze Quelle, nicht der Anker -- ein Anker, der beide Formen kennen
// muss, ist die naechste Abschrift dieser Falle.
const quelle = fs.readFileSync(path.join(WURZEL, "js", "ui", "popups.js"), "utf8")
	.replace(/\r\n/g, "\n");

// Nur den Bauer ausschneiden und WIRKLICH fahren -- ein Regex kennt keinen Geltungsbereich
// (die Lehre vom 03.09.2026, als ein ReferenceError zwei Stunden lang die Beschriftungen nahm).
const anfang = quelle.indexOf("function avesmapsKanonTafelNachtragen(");
assert.ok(anfang > 0, "0: der Bauer muss in js/ui/popups.js stehen");
const ende = quelle.indexOf("\n}\n", anfang);
// 💣 UND DER FEHLENDE ANKER WIRD AUSGESPROCHEN, nie gerechnet. `-1` ueberlebt jede Addition ab +1
// als gueltig aussehende Zahl (§9, wo derselbe Fehler ueber `||` gebaut war und zwei Deploys
// kostete) -- ohne diese Zeile misst der Test bei jedem kuenftigen Ankerbruch wieder NICHTS und
// meldet den Bauer als fehlend, statt den Anker.
assert.ok(ende > anfang, "0b: das Ende des Bauers muss gefunden werden -- sonst faehrt der Test nichts");
const kontext = { console };
vm.createContext(kontext);
const ausschnitt = quelle.slice(anfang, ende + 3);
assert.ok(ausschnitt.length > 100, "0c: der Ausschnitt muss den ganzen Bauer tragen, nicht zwei Zeichen");
vm.runInContext(ausschnitt, kontext);
const nachtragen = kontext.avesmapsKanonTafelNachtragen;
assert.strictEqual(typeof nachtragen, "function", "0d: der ausgeschnittene Bauer muss wirklich laufen");

// ---- 1. Die drei Zustaende ---------------------------------------------------------------------

const welt = { __featureKanon: { vorgabe: "offiziell", abweichungen: {
	"ecosystem:bleibt": { kanon: "inoffiziell" },
	"ecosystem:geht": { kanon: "inoffiziell" },
} } };

const gesetzt = nachtragen("ecosystem", {
	neu: { kanon: "offiziell" },
	leer: { kanon: "" },
	geht: null,
}, welt);

assert.strictEqual(welt.__featureKanon.abweichungen["ecosystem:neu"].kanon, "offiziell",
	"1a: ein Objekt SETZT -- das ist der gemeldete Fall (die Flaeche sagt nach der Zuweisung wieder „offiziell\")");
assert.strictEqual(welt.__featureKanon.abweichungen["ecosystem:leer"].kanon, "",
	"1b: auch `{kanon: \"\"}` wird gesetzt -- „nachgesehen, kein Etikett\" ist eine Auskunft, kein Nichts");
assert.ok(!("ecosystem:geht" in welt.__featureKanon.abweichungen),
	"1c: `null` LOESCHT -- ein liegengebliebenes Etikett behauptet etwas, das nicht mehr gilt");
assert.strictEqual(welt.__featureKanon.abweichungen["ecosystem:bleibt"].kanon, "inoffiziell",
	"1d: 💣 ein NICHT GENANNTER Schluessel bleibt unberuehrt -- „nicht gefragt\" ist nicht "
	+ "„ausdruecklich keins\"");
assert.strictEqual(gesetzt, 3, "1e: gezaehlt wird, was angefasst wurde");

// ---- 2. Faellt offen aus -------------------------------------------------------------------------

assert.strictEqual(nachtragen("ecosystem", null, {}), 0, "2a: ohne Woerterbuch passiert nichts");
assert.strictEqual(nachtragen("ecosystem", undefined, {}), 0, "2b: und `undefined` ebenso");
const leereWelt = {};
nachtragen("ecosystem", { a: { kanon: "offiziell" } }, leereWelt);
assert.strictEqual(leereWelt.__featureKanon.abweichungen["ecosystem:a"].kanon, "offiziell",
	"2c: eine fehlende Tafel wird angelegt, nicht verweigert");

// ---- 3. Der Riegel gegen den VIERTEN Schreiber ---------------------------------------------------
//
// 💣 Gezaehlt wird repoweit, wer `__featureKanon.abweichungen[...] =` schreibt oder daraus loescht.
// Kommt ein vierter dazu, ohne diesen Bauer zu rufen, faellt dieser Test -- und der naechste Autor
// liest hier, warum. Dieselbe Bauform wie der Riegel-Test der Verweistafel (09.09.2026).

const ERLAUBT = new Set([
	"js/ui/popups.js",                       // DER Bauer
	"js/review/review-settlement-wiki.js",   // Wiki-Zuweisung eines Ortes (02.09.2026)
	"js/review/review-feature-sources.js",   // Quellen-Schreibaktion (09.09.2026)
]);

function jsDateien(verzeichnis, treffer = []) {
	for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			if (eintrag.name === "third-party" || eintrag.name === "__tests__") continue;
			jsDateien(voll, treffer);
		} else if (eintrag.name.endsWith(".js")) {
			treffer.push(voll);
		}
	}
	return treffer;
}

const schreiber = [];
for (const datei of jsDateien(path.join(WURZEL, "js"))) {
	// ⚠️ Kommentare raus: die Begruendungen dieses Umbaus nennen die Zeile woertlich.
	const text = fs.readFileSync(datei, "utf8").replace(/\r\n/g, "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n").map((z) => z.replace(/^\s*\/\/.*$/, "")).join("\n");
	if (/__featureKanon\.abweichungen\[[^\]]+\]\s*=/.test(text)
		|| /delete\s+[A-Za-z_$][\w$]*\.__featureKanon\.abweichungen\[/.test(text)) {
		schreiber.push(path.relative(WURZEL, datei).split(path.sep).join("/"));
	}
}

for (const datei of schreiber) {
	assert.ok(ERLAUBT.has(datei),
		`3a: NEUER Schreiber der Kanon-Tafel: ${datei}. Er muss avesmapsKanonTafelNachtragen rufen `
		+ "statt die drei Zeilen abzuschreiben -- sonst laufen die Zustaende beim naechsten Riegel "
		+ "auseinander (dieselbe Lehre wie bei der Listenzeile, sieben Rezepturen)");
}
assert.ok(schreiber.includes("js/ui/popups.js"), "3b: der Bauer selbst muss darunter sein");

// ---- 4. Und die zwei neuen Aufrufer reichen ihr Woerterbuch wirklich weiter -----------------------

for (const [datei, hinweis] of [
	["js/map-features/map-features-ecosystem-properties.js", "der Flaechendialog"],
	["js/review/review-region-sync-ecosystem.js", "der Panel-Weg „Flaeche zuweisen\""],
]) {
	const text = fs.readFileSync(path.join(WURZEL, datei), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n").map((z) => z.replace(/^\s*\/\/.*$/, "")).join("\n");
	assert.ok(/avesmapsKanonTafelNachtragen\("ecosystem",\s*\w+\?\.kanon_je_kennung\)/.test(text),
		`4: ${hinweis} muss das Etikett aus der Antwort nachtragen -- sonst bleibt der Kopf stehen, `
		+ "bis jemand F5 drueckt (genau die Meldung vom 10.09.2026)");
}

console.log("OK: kanon-tafel-nachtragen.test.js");
