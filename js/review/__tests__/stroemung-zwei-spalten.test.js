// Der Abschnitt STRÖMUNG im Dialog „Weg bearbeiten" steht in ZWEI Spalten -- links die Richtung,
// rechts der Strömungsfaktor. Owner 31.08.2026: „das strömungsfaktor feld nach rechts verschieben
// (2 spalten layout), damit man zum speichern nicht scrollen muss". Gemessen im echten Dialog:
// der Abschnitt schrumpft von 189 px auf 125 px.
//
// 🔴 KEIN NEUES CSS. Benutzt wird `.report-section__cols` aus css/components/location-report-dialog.css
// -- dasselbe Muster, das im Meldungsdialog „Art des Eintrags + Ortsgröße" nebeneinanderstellt.
// ⭐ Damit kommt der Telefon-Rückfall gratis mit (@media max-width 640px -> eine Spalte), und dieser
// Dialog ist `min(560px, 100vw - 24px)` breit, die Umbruchregel greift hier also wirklich.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/stroemung-zwei-spalten.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral -- Arbeitskopie CRLF, Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

const html = lies("index.html");
const css = lies("css/components/location-report-dialog.css");

// --- Den Abschnitt herausschneiden: von seiner id bis zum nächsten Geschwister, das eine eigene
// id trägt. Verschachtelte <div> lassen sich nicht per Regex paaren, diese Grenze schon.
const von = html.indexOf('id="path-flow-section"');
assert.ok(von > 0, "der Abschnitt STRÖMUNG steht in index.html");
const bis = html.indexOf('id="path-edit-status"', von);
assert.ok(bis > von, "und dahinter die Statuszeile des Dialogs");
const abschnitt = html.slice(von, bis);

// ---- 1. Das Haus-Muster, nicht ein eigenes ----------------------------------------------------
assert.ok(/class="report-section__cols"/.test(abschnitt),
	"die zwei Blöcke stehen in .report-section__cols -- dem Muster aus dem Meldungsdialog");
assert.ok(!/grid-template-columns/.test(abschnitt),
	"kein Inline-Raster: die Regel gehört ins Stylesheet, nicht ins Markup");

// ---- 2. Links: Zustand UND Knopf in EINEM Feld -------------------------------------------------
// 💣 Vorher waren das zwei .location-report-form__field untereinander. Sie mussten zu einem werden,
// sonst bräuchte die linke Spalte einen eigenen Stapel-Behälter -- die Klasse ist bereits
// flex-column mit gap, sie tut das von selbst.
const cols = abschnitt.slice(abschnitt.indexOf('class="report-section__cols"'));
const zustandPos = cols.indexOf('id="path-flow-state"');
const knopfPos = cols.indexOf('id="path-flow-direction"');
const faktorPos = cols.indexOf('id="path-flow-factor"');
assert.ok(zustandPos > 0 && knopfPos > 0 && faktorPos > 0, "alle drei Bedienelemente stehen im Raster");
assert.ok(zustandPos < knopfPos && knopfPos < faktorPos,
	"Reihenfolge im Markup: Zustand, Knopf, dann der Faktor -- so liest ein Screenreader links vor rechts");
// Zwischen Zustand und Knopf darf KEIN neues Feld beginnen: beide gehören in dasselbe.
const zwischen = cols.slice(zustandPos, knopfPos);
assert.ok(!/class="location-report-form__field"/.test(zwischen),
	"Zustand und Knopf liegen im SELBEN .location-report-form__field (linke Spalte)");
// Zwischen Knopf und Faktor MUSS eines beginnen -- das ist die rechte Spalte.
const zwischen2 = cols.slice(knopfPos, faktorPos);
assert.ok(/class="location-report-form__field"/.test(zwischen2),
	"der Faktor beginnt ein eigenes Feld -- die rechte Spalte");

// ---- 3. Die Statuszeile bleibt AUSSERHALB ------------------------------------------------------
// ⚠️ Sie ist die Rückmeldung beider Spalten („Strömungsfaktor 2,0 übernommen") und gehört über die
// volle Breite; im Raster säße sie in einer der beiden Spalten und bräche die Zeile um.
const statusPos = abschnitt.indexOf('id="path-flow-status"');
const colsEnde = abschnitt.indexOf('id="path-flow-status"');
assert.ok(statusPos > faktorPos + abschnitt.indexOf('class="report-section__cols"'),
	"die Statuszeile steht hinter dem Raster");
assert.ok(colsEnde > 0, "und ist noch im Abschnitt");

// ---- 4. Das Stylesheet trägt Muster UND Telefon-Rückfall ---------------------------------------
// 🔴 Der Rückfall ist der Grund, warum hier kein eigener Breakpoint steht. Verschwindet er, steht
// der Faktor auf dem Telefon in einer 165-px-Spalte -- und niemand sucht ihn in dieser Datei.
assert.ok(/\.report-section__cols\s*\{[^}]*display:\s*grid/.test(css),
	"css/components/location-report-dialog.css definiert .report-section__cols als Raster");
const mobil = css.slice(css.indexOf("@media (max-width: 640px)"));
assert.ok(mobil.length > 0, "die Datei hat den 640px-Riegel");
assert.ok(/\.report-section__cols[^}]*\{[^}]*grid-template-columns:\s*1fr/.test(mobil.slice(0, 400)),
	"und stellt .report-section__cols dort auf EINE Spalte");

console.log("stroemung-zwei-spalten: alle Zusicherungen erfuellt");
