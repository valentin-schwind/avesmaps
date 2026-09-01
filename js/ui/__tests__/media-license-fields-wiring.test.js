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
// 🔴 PFADE AB DER WURZEL, nicht mehr blosse Dateinamen unter html/ (01.09.2026). Der sechste Dialog
// dieser Reihe liegt NICHT dort: er ist die Wappen-Box des Karten-Bearbeiten-Dialogs, und die wohnt
// in index.html mit ihrem Verhalten in js/review/review-locations.js. Solange dieser Leser fest
// „html/" davorschrieb, konnte der Test sie gar nicht sehen -- ein Dialog, den ein
// Verdrahtungstest nicht erreicht, ist genau der, in dem die Verdrahtung dann fehlt.
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), "utf8");

const zaehleAufrufe = (text, funktionsname) => {
	const treffer = text.match(new RegExp(funktionsname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\(", "g"));
	return treffer ? treffer.length : 0;
};

// Je Datei die Zahl der Lizenz-DIALOGE, die sie trägt -- macht in Summe die SECHS:
// Karten (2 Slots teilen sich EINEN Zuhörer), Siedlungsbilder + Siedlungs-Wappen (2 getrennte
// Zuhörer in derselben Datei), Territoriums-Wappen (1), Literatur-Cover (1) und seit dem
// 01.09.2026 die Wappen-Box des Karten-Bearbeiten-Dialogs (1).
// ⚠️ Bei der sechsten liegen Markup und Verhalten in ZWEI Dateien: index.html trägt den Kasten,
// js/review/review-locations.js die Zuhörer. Gezählt wird dort, wo die Aufrufe stehen.
const DIALOGE = {
	"html/citymap-editor.html": 1,
	"html/wiki-sync-settlement-editor.html": 2,
	"html/wiki-sync-monitor.html": 1,
	"html/game-literature-editor.html": 1,
	"js/review/review-locations.js": 1,
};

// Wo die Datei steht, die die beiden Funktionen ueberhaupt bereitstellt -- je Dialog-Datei die
// Seite, die das <script> tragen muss. 💣 Die vier Editorseiten binden es mit fuehrendem Slash,
// index.html ohne: sie liegt im Wurzelverzeichnis, die Editorseiten in html/. Ein Muster, das
// „/js/..." verlangt, haette den sechsten Dialog faelschlich als unversorgt gemeldet.
const LADER = {
	"html/citymap-editor.html": ["html/citymap-editor.html", '<script src="/js/ui/media-license-fields.js">'],
	"html/wiki-sync-settlement-editor.html": ["html/wiki-sync-settlement-editor.html", '<script src="/js/ui/media-license-fields.js">'],
	"html/wiki-sync-monitor.html": ["html/wiki-sync-monitor.html", '<script src="/js/ui/media-license-fields.js">'],
	"html/game-literature-editor.html": ["html/game-literature-editor.html", '<script src="/js/ui/media-license-fields.js">'],
	"js/review/review-locations.js": ["index.html", '<script src="js/ui/media-license-fields.js">'],
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

assert.strictEqual(summeDialoge, 6, "Die Dialogzahl in DIALOGE summiert sich nicht mehr auf sechs -- "
	+ "diese Konstante selbst nachziehen, wenn ein siebter Lizenz-Dialog dazukommt.");
checks++;

// ---- die Datei, die den Katalog um seine Vorschlagsfunktion erweitert, lädt auch jede Seite ----------
// Kein separates Setup nötig -- media-license-fields.js exportiert die Funktion bereits fürs echte
// DOM; dieser Test prüft nur, dass jede Seite sie auch BENUTZT.
for (const datei of Object.keys(DIALOGE)) {
	const [seite, tag] = LADER[datei];
	assert.ok(lies(seite).includes(tag),
		`${seite} lädt js/ui/media-license-fields.js nicht (erwartet: ${tag}) -- ohne die Datei gibt es `
		+ `die beiden Funktionen im Browser gar nicht, unabhängig von der Verdrahtung in ${datei}.`);
	checks++;
	// 🔴 KATALOG VOR BAUER: media-license-fields.js liest AVESMAPS_MEDIA_LICENSES beim Laden. Steht
	// media-licenses.js dahinter, ist die Optionsliste leer -- und zwar lautlos, denn das Markup
	// entsteht trotzdem, nur ohne eine einzige Lizenz zur Auswahl.
	// 🪤 GEMESSEN WERDEN DIE <script>-TAGS, nicht die blossen Dateinamen. Ueber jedem der vier
	// Ladepaare steht ein Kommentar, der „media-license-fields.js" nennt -- ein indexOf auf den
	// Dateinamen findet DEN und meldet die Reihenfolge als vertauscht, obwohl sie stimmt. Genau
	// diese Messung war beim Schreiben dieses Blocks zuerst drin und hat vier heile Seiten
	// angeschwaerzt.
	const seitenText = lies(seite);
	const katalogTag = seitenText.search(/<script src="\/?js\/app\/media-licenses\.js"><\/script>/);
	const bauerTag = seitenText.search(/<script src="\/?js\/ui\/media-license-fields\.js"><\/script>/);
	assert.ok(katalogTag !== -1 && katalogTag < bauerTag,
		`${seite} lädt js/app/media-licenses.js nicht VOR js/ui/media-license-fields.js -- die `
		+ "Lizenzliste wäre leer, ohne dass irgendetwas fehlschlägt.");
	checks++;
}

console.log(`media-license-fields-wiring: ${checks} Prüfungen bestanden (${summeDialoge} Lizenz-Dialoge in ${Object.keys(DIALOGE).length} Dateien).`);
