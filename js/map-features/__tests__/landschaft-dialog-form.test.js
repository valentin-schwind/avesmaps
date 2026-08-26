// Die FORM des vereinigten Fensters — eine Abschnittsrezeptur, ein aktiver Reiter, ein Titel.
//
// 🔴 Owner am 26.08.2026, im offenen Fenster gesehen: „um 'Fläche' gibt es keine so schöne box wie
// um 'Beschriftung' oder 'Quellen'" · „was mich auch stört ist der fehlende abstand zwischen quellen
// und wiki-landschaft" · „was auch fehlt ist dass die tabs gehighlighted bleiben" · „Zwischen
// 'Fläche' und 'Für Klicks gesperrt' ist kaum platz" · „Das Fenster soll 'Region bearbeiten' heißen".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-form.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

const markup = lies("index.html");
const von = markup.indexOf('<div id="landschaft-dialog-overlay"');
const bis = markup.indexOf('<div id="region-edit-overlay"');
assert.ok(von > 0 && bis > von, "das Fenster steht in der Seite"); checks++;
// 🪤 KOMMENTARE RAUS, BEVOR GEZÄHLT WIRD — und zwar mehrzeilig. Der Kommentar, der vor der alten
// Rezeptur WARNT, nennt sie beim Namen; ohne diesen Schnitt schlägt der Test auf seine eigene
// Warnung an und verlangt, dass man sie löscht. Genau das ist beim ersten Lauf passiert.
const fenster = markup.slice(von, bis).replace(/<!--[\s\S]*?-->/g, "");

// ── A. EINE ABSCHNITTSREZEPTUR ───────────────────────────────────────────────────────────────
// 🔴 Drei Rezepturen standen in EINEM Fenster: `.label-edit-section` (Beschriftung, Quellen),
// `.label-wiki-reference` (Gelände, Höhenskala, Gipfel) und ein `<fieldset
// class="ecosystem-properties-dialog__group">` mit `<legend>` für „Fläche" — die einzige OHNE
// Kasten, weshalb sie als einzige nackt dastand. Dieselbe Krankheit wie die sieben Listenzeilen
// und die sechs Wiki-Zuweisungen (AGENTS.md §11): abgeschrieben statt geteilt.
assert.ok(!/ecosystem-properties-dialog__group/.test(fenster),
	"die eigene Flächen-Rezeptur ist weg"); checks++;
assert.ok(!/<legend/.test(fenster),
	"…samt ihrer <legend>"); checks++;
// Die Überschrift „Fläche" trägt jetzt die geteilte Form.
// ⚠️ Als Zeichenkette gesucht, nicht als RegExp: Markup steckt voller Zeichen, die in einem
// RegExp-Literal etwas anderes bedeuten -- der erste Versuch scheiterte schon beim Einlesen.
assert.ok(fenster.indexOf('<div class="label-edit-section-title" data-i18n="ecosystem.properties.identity">') !== -1,
	"„Fläche\" ist eine geteilte Abschnittsüberschrift"); checks++;

// ── B. DIE KÖPFE DER DREI KÄSTEN SEHEN AUS WIE IHRE NACHBARN ─────────────────────────────────
// ⭐ Dieselbe Lösung wie beim Wege-Dialog (region-sync.css, `#path-edit-dialog
// .label-wiki-reference__title`): die sechs typografischen Werte stehen EINMAL in der gemeinsamen
// Regel, das Fenster hängt sich nur an. Eine Abschrift daneben wäre die Divergenz, die §12 meint.
const regionSync = lies("css/components/region-sync.css");
assert.ok(/#landschaft-dialog \.label-wiki-reference__title/.test(regionSync),
	"das Fenster hängt sich an die geteilte Kopf-Typografie"); checks++;
const gemeinsam = regionSync.slice(regionSync.indexOf(".label-edit-section-title,"));
assert.ok(/#landschaft-dialog \.label-wiki-reference__title/.test(gemeinsam.slice(0, 400)),
	"…und zwar in DERSELBEN Regel, nicht in einer eigenen"); checks++;

// ── C. DER AKTIVE REITER BLEIBT SICHTBAR ─────────────────────────────────────────────────────
// 💣 Die Reiter tragen `.ecosystem-layer-switch__tab`, die Reiterform des Hauses — und deren
// aktiver Zustand haengt an `.is-active`. Die Hülle setzte nur `aria-selected`, also war der
// „gehighlightete" Reiter in Wahrheit immer nur der ueberfahrene (`:hover`), und beim Wegziehen der
// Maus sah das Fenster aus, als sei kein Reiter gewaehlt.
// ⭐ Gesetzt werden BEIDE, in einem Zug — genau wie es die Ebenenleiste desselben Bauteils tut
// (map-features-ecosystem-layer-switch.js: classList.toggle + setAttribute nebeneinander).
const huelle = lies("js/map-features/landschaft-dialog.js");
assert.ok(/classList\.toggle\("is-active"/.test(huelle),
	"die Hülle setzt den aktiven Zustand der geteilten Reiterform"); checks++;
assert.ok(/setAttribute\("aria-selected"/.test(huelle),
	"…und die ARIA-Angabe daneben"); checks++;

// ── D. ABSTAND ZWISCHEN DEN BLÖCKEN EINES REITERS ────────────────────────────────────────────
// 🔴 Der Reiter „Wiki & Quellen" stapelt vier Blöcke ohne einen einzigen Aussenrand: die
// Wiki-Zuweisung, „Andere Quelle", „Quellen" und den Zuweisungskasten der Fläche. Sie klebten
// aneinander. Der Abstand gehört dem BEHÄLTER, nicht den Blöcken — sonst braucht jeder neue Block
// seine eigene Regel, und der erste, den jemand vergisst, klebt wieder.
const stil = lies("css/components/landschaft-dialog.css");
assert.ok(/\[data-landschaft-bereich\]/.test(stil),
	"der Behälter eines Reiters trägt den Abstand"); checks++;

// ── E. DER TITEL ─────────────────────────────────────────────────────────────────────────────
// 🔴 Owner 26.08.2026: „Das Fenster soll außerdem 'Region bearbeiten' heißen." Das ist auch das
// Wort, das der Landschaften-Editor daneben benutzt („2854 Regionen · 1027 gezeichnet").
assert.ok(/<h2 id="label-edit-title">Region bearbeiten<\/h2>/.test(fenster),
	"das Markup nennt es „Region bearbeiten\""); checks++;
const { avesmapsLandschaftDialogTitel } = require("../landschaft-dialog.js");
assert.strictEqual(avesmapsLandschaftDialogTitel({ hatFlaeche: true, hatLabel: true }),
	"Region bearbeiten", "…und die Hülle auch"); checks++;
assert.strictEqual(avesmapsLandschaftDialogTitel({ hatFlaeche: false, hatLabel: true }), "",
	"ohne Fläche bleibt der eigene Titel der Beschriftung stehen"); checks++;

console.log("landschaft-dialog-form: " + checks + " Zusicherungen gruen");
