// Die vier Datenlagen des vereinigten Landschaftsfensters.
//
// 🔴 Live gemessen am 25.08.2026: 679 Flächen mit genau einer Beschriftung, 334 OHNE Beschriftung,
// 254 Beschriftungen OHNE Fläche, 13 Flächen mit zwei oder drei. Ein Drittel jeder Seite hat keine
// Gegenseite — ein Fenster, das diesen Zustand nicht kann, ist für ein Drittel falsch.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-lagen.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsLandschaftDialogLeertext } = require("../landschaft-dialog.js");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
let checks = 0;

// ── A. EIN SATZ, KEINE STATISTIK ─────────────────────────────────────────────────────────────
// 🔴 Owner 25.08.2026, wörtlich: „Diese Beschriftung liegt auf keiner Fläche. / Diese Fläche trägt
// keine Beschriftung. — Reicht". Ein zweiter Satz mit Zahlen stand im Entwurf und ist gefallen.
assert.strictEqual(avesmapsLandschaftDialogLeertext("flaeche", { hatFlaeche: false }),
	"Diese Beschriftung liegt auf keiner Fläche."); checks++;
assert.strictEqual(avesmapsLandschaftDialogLeertext("beschriftung", { hatLabel: false }),
	"Diese Fläche trägt keine Beschriftung."); checks++;

// ── B. IST DIE HÄLFTE DA, GIBT ES KEINEN LEEREN ZUSTAND ──────────────────────────────────────
assert.strictEqual(avesmapsLandschaftDialogLeertext("flaeche", { hatFlaeche: true }), ""); checks++;
assert.strictEqual(avesmapsLandschaftDialogLeertext("beschriftung", { hatLabel: true }), ""); checks++;
// ⚠️ Und der dritte Reiter hat keinen leeren Zustand: Wiki und Quellen gibt es zu beiden Hälften.
assert.strictEqual(avesmapsLandschaftDialogLeertext("wiki", {}), ""); checks++;
assert.strictEqual(avesmapsLandschaftDialogLeertext("flaeche", undefined),
	"Diese Beschriftung liegt auf keiner Fläche.",
	"ohne Angabe gilt die Hälfte als abwesend — die sichere Richtung"); checks++;

// ── C. DER SATZ STEHT AN EINER STELLE ────────────────────────────────────────────────────────
// 💣 Zwei Wortlaute im Markup liefen beim ersten geänderten Satz auseinander. Das Markup trägt
// deshalb nur einen leeren Absatz mit einem Griff; den Text setzt die Hülle.
const markup = lies("index.html");
const von = markup.indexOf('<div id="landschaft-dialog-overlay"');
const bis = markup.indexOf('<div id="region-edit-overlay"');
const fenster = markup.slice(von, bis);
assert.ok(!fenster.includes("Diese Fläche trägt keine Beschriftung"),
	"der Satz steht NICHT im Markup"); checks++;
assert.ok(!fenster.includes("Diese Beschriftung liegt auf keiner Fläche"),
	"und der andere auch nicht"); checks++;
assert.strictEqual((fenster.match(/data-landschaft-leertext/g) || []).length, 2,
	"zwei leere Absätze, je einer pro Hälfte"); checks++;

// ── D. DER INHALT WIRD VERBORGEN, NICHT GELEERT ──────────────────────────────────────────────
// 💣 Ein geleertes Formular sähe aus wie ein Objekt ohne Werte. Verborgen heißt „gibt es nicht",
// leer hieße „ist leer" — das ist ein Unterschied, den ein Editor sofort sieht. Und die Felder
// gehören zwei fremden Modulen; sie zu leeren hieße, in ihren Zustand zu greifen.
const huelle = lies("js/map-features/landschaft-dialog.js");
assert.ok(/teil\.hidden = text !== ""/.test(huelle),
	"der Inhalt wird verborgen"); checks++;
assert.ok(!/\.value = ""/.test(huelle),
	"die Hülle leert kein einziges Feld"); checks++;
assert.strictEqual((fenster.match(/data-landschaft-inhalt/g) || []).length, 3,
	"drei Inhaltsgriffe: die zwei Formulare und der Anzeige-Haken"); checks++;

// ⚠️ „Gehört zu" trägt bewusst KEINEN Inhaltsgriff: es steht gerade dann da, wenn die Fläche
// FEHLT — es ist Teil des Angebots, nicht des Inhalts.
const iRegionSection = fenster.indexOf('id="label-edit-region-section"');
const zeile = fenster.slice(fenster.lastIndexOf("<", iRegionSection), iRegionSection + 120);
assert.ok(!zeile.includes("data-landschaft-inhalt"),
	"die Zuordnung „Gehört zu\" gehört zum Angebot, nicht zum Inhalt"); checks++;

// ── E. „BESCHRIFTUNG ANLEGEN" GEHT ÜBER DEN VORHANDENEN ERZEUGER ─────────────────────────────
// ⭐ `createEcosystemRegionLabel` rechnet den Punkt der Unzugänglichkeit aus und schreibt über den
// vorhandenen Weg — samt der Rücknahme, die der Server nötig macht (er lässt eine Region höchstens
// EIN primäres Label tragen). Ein zweiter Anlegeweg wäre die zweite Wahrheit.
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
assert.ok(fenster.includes('id="landschaft-dialog-label-anlegen"'), "den Knopf gibt es"); checks++;
assert.ok(/createEcosystemRegionLabel\(/.test(eco),
	"er geht über den vorhandenen Erzeuger"); checks++;
assert.ok(!/action: "create_label"/.test(eco),
	"und baut keinen zweiten Anlegeweg"); checks++;

// 🔴 Die MELDUNG nennt den Punkt (Owner 25.08.2026) und kommt NACH dem Anlegen.
assert.ok(/Beschriftung am Punkt der Unzugänglichkeit/.test(eco),
	"die Meldung nennt den Punkt der Unzugänglichkeit"); checks++;
const iAwait = eco.indexOf("await createEcosystemRegionLabel(");
const iMeldung = eco.indexOf("Beschriftung am Punkt der Unzugänglichkeit");
assert.ok(iAwait > 0 && iMeldung > iAwait,
	"die Meldung steht NACH dem Anlegen — davor wäre sie eine Behauptung"); checks++;
// ⚠️ Und ein Fehlschlag meldet den Fehlschlag, nicht den Erfolg.
assert.ok(/Die Beschriftung liess sich nicht anlegen\./.test(eco),
	"ein Fehlschlag sagt es"); checks++;

console.log("landschaft-dialog-lagen: " + checks + " Zusicherungen gruen");
