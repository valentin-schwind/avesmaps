// Ein Auto-Name bekommt keine Beschriftung.
//
// 🔴 Owner 26.08.2026: „landschaften die autonamen haben, dürfen keine beschriftung bekommen (der
// button 'Beschriftung anlegen' muss ausgegraut sein + hinweistext) bis auto-name wieder aus ist."
//
// ⭐ Die Begründung steht seit jeher im Namensmodul: „Ein Auto-Name ist interne Buchführung und darf
// nie nach aussen dringen" (map-features-ecosystem-naming.js, ecosystemRegionDisplayName). Die
// Beschriftung IST das Nachaussendringen — sie schreibt den Namen auf die Karte. „Wald-001" gehört
// dort nicht hin.
//
// 💣 Der Haken wird NICHT gespeichert, er wird ABGELEITET: trägt der Name die Form `<Art>-<Zahl>`,
// ist er gesetzt (isEcosystemRegionAutoName). „Auto-Name ist an" heisst also nichts anderes als
// „der Name ist ein Griff, kein Name".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-autoname.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsLandschaftDialogAnlegenSperre } = require("../landschaft-dialog.js");
const { isEcosystemRegionAutoName } = require("../map-features-ecosystem-naming.js");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// ── A. DIE REGEL ─────────────────────────────────────────────────────────────────────────────
// 🔴 Gesperrt heisst: ein SATZ, nicht bloss ein toter Knopf. Ein ausgegrauter Knopf ohne Grund ist
// die Sorte Sackgasse, an der ein Editor rätselt, was er falsch macht.
const gesperrt = avesmapsLandschaftDialogAnlegenSperre(true);
assert.ok(gesperrt !== "", "mit Auto-Name ist das Anlegen gesperrt"); checks++;
assert.ok(/Auto-Name/.test(gesperrt), "…und der Satz nennt den Haken beim Namen"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAnlegenSperre(false), "",
	"ohne Auto-Name ist nichts gesperrt"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAnlegenSperre(undefined), "",
	"ohne Angabe wird nicht gesperrt -- im Zweifel bleibt die Handlung erreichbar"); checks++;

// ── B. „AUTO-NAME AN" IST EINE FRAGE AN DEN NAMEN ────────────────────────────────────────────
// ⚠️ Als Zusicherung festgenagelt, weil die ganze Regel darauf steht: gäbe es irgendwo einen
// zweiten Begriff von „auto", liefen Sperre und Haken auseinander.
assert.strictEqual(isEcosystemRegionAutoName("Wald-001", "Wald"), true); checks++;
assert.strictEqual(isEcosystemRegionAutoName("Farindel", "Wald"), false); checks++;
assert.strictEqual(isEcosystemRegionAutoName("Wald der Wälder-2", "Wald"), false,
	"ein echter Name, der auf eine Zahl endet, bleibt ein echter Name"); checks++;

// ── C. DIE VERDRAHTUNG ───────────────────────────────────────────────────────────────────────
// 🔴 Die Sperre haengt an `syncPropertiesAutoName` -- der EINEN Stelle, die den Haken ohnehin bei
// jeder Aenderung und beim Oeffnen nachzieht. An den Aufrufern haengte sie beim ersten vergessenen
// Pfad schief.
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
const vonS = eco.indexOf("function syncPropertiesAutoName(");
assert.ok(vonS >= 0, "den Nachzieher gibt es"); checks++;
const nachS = eco.slice(vonS + 10).match(/\n\t(?:async )?function [A-Za-z]/);
const sync = nachS ? eco.slice(vonS, vonS + 10 + nachS.index) : eco.slice(vonS);
assert.ok(/avesmapsLandschaftDialogAnlegenSperre|avesmapsLandschaftDialogAnlegenKnopf/.test(sync),
	"der Nachzieher setzt die Sperre"); checks++;

// ── D. DER KNOPF UND SEIN SATZ STEHEN IM MARKUP ──────────────────────────────────────────────
const markup = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
assert.ok(markup.indexOf('id="landschaft-dialog-label-anlegen"') !== -1,
	"den Knopf gibt es"); checks++;
assert.ok(markup.indexOf("data-landschaft-anlegen-hinweis") !== -1,
	"…und den Platz fuer seinen Grund"); checks++;

console.log("landschaft-dialog-autoname: " + checks + " Zusicherungen gruen");
