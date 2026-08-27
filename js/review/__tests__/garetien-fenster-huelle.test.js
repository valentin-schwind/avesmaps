// Aufgabe 10 des Garetien Importers -- der Knopf und die verschiebbare Fensterhuelle.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md
// Mockup:  docs/garetien-importer-mockup.html
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-fenster-huelle.test.js
//
// ⚠️ CRLF-Falle (AGENTS.md §9): die Arbeitskopie traegt CRLF, `actions/checkout` in der CI legt LF
// hin. Ein Muster mit rohem "\n" faende den Block hier je nach Zeilenende an einer ANDEREN Stelle
// (oder gar nicht) -- lokal gruen, in der CI rot, oder umgekehrt. Deshalb wird jede gelesene Datei
// sofort auf LF normalisiert, bevor irgendein Muster damit sucht.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

// Der Knopf steht unter „Dump holen" und ist NUR fuer Admins da (Owner 27.08.2026).
//
// 🪤 REVIEW-FUND F3 (27.08.2026): ein `indexOf("</div>\n\t\t\t\t</div>")`-Anker traf nicht das
// Ende von `.wiki-sync-dump-central`, sondern eine zufaellige Fundstelle 25.341 Zeichen weiter
// hinten, mitten im Siedlungen-Markup -- die Zusicherung pruefte damit nur, dass der Knopf
// IRGENDWO in einem ~25 KB grossen Fenster liegt, das mehrere komplette Editor-Abschnitte
// umfasst, nicht "im Block unter Dump holen". Die dritte Runde derselben Fehlerklasse in diesem
// Haus (AGENTS.md §9). Jetzt ein echter Textanker (der naechste Kommentar NACH dem Block) PLUS
// eine Laengenprobe, die den eigenen Ausschnitt kennt statt ihn blind zu glauben.
const html = read("index.html");
assert.ok(html.includes('id="garetien-importer-open"'), "Der Knopf fehlt in index.html.");
const restNachDump = html.slice(html.indexOf('class="wiki-sync-dump-central"'));
const dumpBlockEnde = restNachDump.indexOf("<!-- Global WikiSync status line");
assert.ok(dumpBlockEnde > 0,
	"Der Anker fuer das Ende von \"Dump holen\" (der Kommentar zur globalen WikiSync-Statuszeile) "
	+ "wurde nicht gefunden -- ist er umbenannt oder verschoben worden?");
const dumpBlock = restNachDump.slice(0, dumpBlockEnde);
assert.ok(dumpBlock.length < 5000,
	`Der geschnittene "Dump holen"-Block ist ${dumpBlock.length} Zeichen lang -- das ist kein `
	+ "\"Dump holen\"-Block mehr (erwartet: ein paar Tausend Zeichen, nicht zehntausende). Eine "
	+ "Zusicherung, die ihren eigenen Ausschnitt nicht kennt, ist keine.");
assert.ok(dumpBlock.includes("garetien-importer-open"),
	"Der Knopf steht nicht im Block unter „Dump holen\" -- der Owner hat genau dort danach gefragt.");
assert.ok(/id="garetien-importer-open"[^>]*hidden/.test(html),
	"Der Knopf muss HIDDEN starten. Der Riegel faellt geschlossen aus: bis die Rechteauskunft da "
	+ "ist -- und fuer immer, wenn sie nie kommt -- gilt „nicht freigeschaltet\".");

// Die Huelle ist ein role=dialog mit __head -- damit ist sie ohne eine Zeile Verdrahtung
// verschiebbar (js/ui/dialog-drag.js sucht nach der FORM, nicht nach einer Namensliste).
assert.ok(/id="garetien-importer"[^>]*role="dialog"/.test(html),
	"Die Huelle braucht role=dialog, sonst greift dialog-drag.js nicht.");
assert.ok(html.includes('class="gi-win__head"'),
	"Die Kopfzeile muss auf __head enden -- danach sucht AVESMAPS_DIALOG_DRAG_HANDLES.");

// 🔴 KEIN Scrim, KEIN mittiges Modal: der Owner will die Karte SEHEN, waehrend er die Liste
// durchgeht. Deshalb ist die Huelle NICHT .avm-editor-dialog.
const css = read("css", "components", "garetien-importer.css");
assert.ok(!/backdrop-filter|\.gi-win__scrim/.test(css),
	"Ein Scrim verdeckt die Karte -- genau das soll dieses Fenster nicht.");
assert.ok(/\.gi-win\s*\{[^}]*position:\s*fixed/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
	"Das Fenster schwebt ueber der Karte, es sitzt nicht im Fluss.");

// Der Riegel steht im JS und faellt geschlossen aus.
const js = read("js", "review", "review-garetien-importer.js");
assert.ok(js.includes("capabilities.admin === true"),
	"Der Knopf muss ausdruecklich auf `=== true` pruefen. Eine als JSON geparste Fehlerseite, "
	+ "eine 1 statt true, ein Proxy mit \"0\" -- alles davon ist truthy.");

console.log("garetien-fenster-huelle: Knopf, Huelle und Riegel stehen wie im Auftrag verlangt.");
