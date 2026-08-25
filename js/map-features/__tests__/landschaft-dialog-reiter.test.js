// Die Hülle des vereinigten Landschaftsfensters: Reiter und Einstieg.
//
// 🔴 Geprüft wird die REINE Hälfte plus die DOM-Hälfte gegen ein Minimal-Dokument. Was ein
// Emulator nicht beantwortet — ob sich das Fenster im Browser auch bedienen lässt —, beantwortet
// der Ablauf, nicht dieser Test (AGENTS.md §9: „Abnahme heisst ABLAUF, nicht Mass").
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-reiter.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	AVESMAPS_LANDSCHAFT_DIALOG_REITER,
	avesmapsLandschaftDialogStartReiter,
} = require("../landschaft-dialog.js");

const wurzel = path.join(__dirname, "..", "..", "..");
let checks = 0;

// ── A. DER EINSTIEG BESTIMMT DEN REITER ──────────────────────────────────────────────────────
// 🔴 Owner 25.08.2026, wörtlich: „Klick ich auf ein Label komm ich auf den neuen Dialog und
// automatisch auf ‚Beschriftung', klick ich auf die Eigenschaften der Fläche, komm ich auf Fläche."
assert.strictEqual(avesmapsLandschaftDialogStartReiter("label"), "beschriftung",
	"Klick auf die Beschriftung oeffnet ihren Reiter"); checks++;
assert.strictEqual(avesmapsLandschaftDialogStartReiter("flaeche"), "flaeche",
	"Eigenschaften der Flaeche oeffnen ihren Reiter"); checks++;

// 🔴 KEIN RATEN. Ein unbekannter oder fehlender Einstieg faellt auf „flaeche" -- der Reiter, der
// bei JEDER Datenlage etwas zeigt.
assert.strictEqual(avesmapsLandschaftDialogStartReiter("quatsch"), "flaeche",
	"unbekannter Einstieg faellt auf flaeche"); checks++;
assert.strictEqual(avesmapsLandschaftDialogStartReiter(undefined), "flaeche",
	"fehlender Einstieg faellt auf flaeche"); checks++;
assert.strictEqual(avesmapsLandschaftDialogStartReiter(null), "flaeche",
	"null faellt auf flaeche"); checks++;

// ── B. DIE DREI REITER STEHEN AN EINER STELLE ────────────────────────────────────────────────
assert.deepStrictEqual(AVESMAPS_LANDSCHAFT_DIALOG_REITER, ["flaeche", "beschriftung", "wiki"],
	"drei Reiter, flaeche zuerst"); checks++;

// ── C. DAS FENSTER STEHT IN ALLEN SECHS LISTEN ───────────────────────────────────────────────
// 💣 Ein Overlay-<div> erbt NICHTS. Fehlt es in einer der Listen, ist es kein Fenster: ein Klick
// darin schliesst die Karte, oder die Tastaturbefehle laufen weiter, waehrend es offen ist.
// ⚠️ Diese Zusicherung zaehlt die Vorkommen, statt sie zu glauben -- dieselbe Sorte Fehler wie das
// vergessene `#social-hub-overlay` in einer von drei Selektorlisten (AGENTS.md §11).
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const bootstrap = lies("js/app/bootstrap.js");
assert.ok(bootstrap.includes("#landschaft-dialog-overlay"),
	"bootstrap.js: das Fenster steht in der Klick-Ausnahmeliste"); checks++;

const reviewCore = lies("js/review/review-core.js");
const coreTreffer = reviewCore.split("#landschaft-dialog-overlay").length - 1;
assert.ok(coreTreffer >= 2,
	"review-core.js: das Fenster steht in BEIDEN Abfragen, gefunden: " + coreTreffer); checks++;

const overlaysCss = lies("css/components/dialog-overlays.css");
const cssTreffer = overlaysCss.split("#landschaft-dialog-overlay").length - 1;
assert.strictEqual(cssTreffer, 3,
	"dialog-overlays.css: alle DREI Selektorlisten, gefunden: " + cssTreffer); checks++;

// ── D. Das Markup traegt die Reiter und ihre Bereiche ────────────────────────────────────────
const markup = lies("index.html");
assert.ok(markup.includes('id="landschaft-dialog-overlay"'), "das Overlay gibt es"); checks++;
for (const name of AVESMAPS_LANDSCHAFT_DIALOG_REITER) {
	assert.ok(markup.includes('data-landschaft-reiter="' + name + '"'),
		"Reiterknopf " + name); checks++;
	assert.ok(markup.includes('data-landschaft-bereich="' + name + '"'),
		"Reiterbereich " + name); checks++;
}

// ⚠️ Genau EIN Knopf startet ausgewaehlt -- zwei `aria-selected="true"` sind fuer ein Hilfsmittel
// zwei offene Reiter.
const kopfBlock = markup.slice(markup.indexOf('id="landschaft-dialog-reiter"'),
	markup.indexOf('data-landschaft-bereich="flaeche"'));
const ausgewaehlt = kopfBlock.split('aria-selected="true"').length - 1;
assert.strictEqual(ausgewaehlt, 1,
	"genau ein Reiter startet ausgewaehlt, gefunden: " + ausgewaehlt); checks++;

// ── E. Das Stylesheet ist eingebunden ────────────────────────────────────────────────────────
// 🪤 Eine CSS-Datei, die niemand importiert, ist im Repo und wirkungslos -- und der `?v=`-Stempler
// erreicht sie nie, weil er der Kette aus index.html folgt (AGENTS.md §7).
const styles = lies("css/styles.css");
assert.ok(/components\/landschaft-dialog\.css/.test(styles),
	"css/styles.css importiert das Stylesheet des Fensters"); checks++;

console.log("landschaft-dialog-reiter: " + checks + " Zusicherungen gruen");
