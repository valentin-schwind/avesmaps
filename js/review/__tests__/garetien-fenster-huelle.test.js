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
const html = read("index.html");
assert.ok(html.includes('id="garetien-importer-open"'), "Der Knopf fehlt in index.html.");
const block = html.slice(html.indexOf('class="wiki-sync-dump-central"'));
assert.ok(block.slice(0, block.indexOf("</div>\n\t\t\t\t</div>")).includes("garetien-importer-open"),
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
