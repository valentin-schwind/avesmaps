// Die VERDRAHTUNG der fünf Lizenz-Dialoge, nicht nur ihr Markup-Bauer.
//
// 🔴 WARUM ES DIESEN TEST GIBT: js/ui/media-license-fields.js war vollständig gebaut und
// unit-getestet (media-license-fields.test.js) -- avesmapsMediaLicenseNoteVorschlag prüfte sich
// selbst korrekt, wurde aber in KEINEM der fünf Editor-Dialoge aufgerufen. Ein grüner Funktionstest
// beweist nur, dass die Funktion tut, was sie soll, wenn man sie aufruft -- nichts darüber, ob sie
// je aufgerufen wird. Dasselbe traf auf avesmapsMediaLicenseSyncSelectHidden im Karten-Dialog zu:
// ein Commit ("stille Lizenz wird am Auswahlfeld selbst sichtbar") behauptete in seiner Nachricht,
// alle fünf Dialoge an ihren change-Zuhörer zu hängen, fügte in html/citymap-editor.html aber nur
// einen CSS-Kommentar ein (Designprüfung 16.08.2026, Befund 1+2).
//
// Dieser Test liest die vier Editorseiten als TEXT (kein DOM, kein Browser nötig) und zählt echte
// Aufrufe -- Funktionsname direkt gefolgt von "(". Eine Erwähnung in einem Kommentar ("...Funktion
// gebaut und getestet, aber noch nirgends verdrahtet") trägt die Klammer nicht direkt hinterm Namen
// und zählt deshalb nicht mit; das ist an genau diesen Kommentaren in der Historie geprüft.
//
// Run: node js/ui/__tests__/media-license-fields-wiring.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (datei) => fs.readFileSync(path.join(ROOT, "html", datei), "utf8");

const zaehleAufrufe = (text, funktionsname) => {
	const treffer = text.match(new RegExp(funktionsname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\(", "g"));
	return treffer ? treffer.length : 0;
};

// Je Datei die Zahl der Lizenz-DIALOGE, die sie trägt -- macht in Summe die fünf aus dem Entwurf:
// Karten (2 Slots teilen sich EINEN Zuhörer), Siedlungsbilder + Siedlungs-Wappen (2 getrennte
// Zuhörer in derselben Datei), Territoriums-Wappen (1), Literatur-Cover (1).
const DIALOGE = {
	"citymap-editor.html": 1,
	"wiki-sync-settlement-editor.html": 2,
	"wiki-sync-monitor.html": 1,
	"game-literature-editor.html": 1,
};

let checks = 0;
let summeDialoge = 0;

for (const [datei, erwarteteDialoge] of Object.entries(DIALOGE)) {
	const html = lies(datei);

	const syncAufrufe = zaehleAufrufe(html, "avesmapsMediaLicenseSyncSelectHidden");
	assert.ok(syncAufrufe >= erwarteteDialoge,
		`${datei}: avesmapsMediaLicenseSyncSelectHidden wird nur ${syncAufrufe}x aufgerufen, erwartet `
		+ `mindestens ${erwarteteDialoge} (je Lizenz-Dialog in dieser Datei einer). Ohne den Aufruf `
		+ "bleibt die \"nicht öffentlich\"-Kennzeichnung am Auswahlfeld bis zum nächsten Neu-Rendern "
		+ "unsichtbar.");
	checks++;

	const noteAufrufe = zaehleAufrufe(html, "avesmapsMediaLicenseNoteVorschlag");
	assert.ok(noteAufrufe >= erwarteteDialoge,
		`${datei}: avesmapsMediaLicenseNoteVorschlag wird nur ${noteAufrufe}x aufgerufen, erwartet `
		+ `mindestens ${erwarteteDialoge} (je Lizenz-Dialog in dieser Datei einer). Ohne den Aufruf `
		+ "füllt sich der Kommentar bei \"Genehmigung erteilt\" nicht vor -- der erste Handgriff der "
		+ "Abnahme (Bauplan) schlägt fehl.");
	checks++;

	summeDialoge += erwarteteDialoge;
}

assert.strictEqual(summeDialoge, 5, "Die Dialogzahl in DIALOGE summiert sich nicht mehr auf fünf -- "
	+ "diese Konstante selbst nachziehen, wenn ein sechster Lizenz-Dialog dazukommt.");
checks++;

// ---- die Datei, die den Katalog um seine Vorschlagsfunktion erweitert, lädt auch alle vier -----------
// Kein separates Setup nötig -- media-license-fields.js exportiert die Funktion bereits fürs echte
// DOM; dieser Test prüft nur, dass jede Seite sie auch BENUTZT.
for (const datei of Object.keys(DIALOGE)) {
	assert.ok(/<script src="\/js\/ui\/media-license-fields\.js">/.test(lies(datei)),
		`${datei} lädt js/ui/media-license-fields.js nicht -- ohne die Datei gibt es die beiden `
		+ "Funktionen im Browser gar nicht, unabhängig von der Verdrahtung.");
	checks++;
}

console.log(`media-license-fields-wiring: ${checks} Prüfungen bestanden (${summeDialoge} Lizenz-Dialoge in ${Object.keys(DIALOGE).length} Dateien).`);
