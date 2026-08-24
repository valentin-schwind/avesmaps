const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 BESCHRIFTUNG WANDERT, KENNUNG NICHT (Entwurf §1,
// docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md).
// Derselbe Schnitt wie bei „Neuigkeiten"/`changelog`: der Deploy loescht nie, eine umgetaufte
// Adresse liesse eine gecachte Seite ins Leere greifen.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/landschaften-beschriftung.test.js

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", "..", "..", p), "utf8");

const index = lies("index.html");
const editor = lies("html/landschaften-editor.html");
const liste = lies("js/review/review-ecosystem-list.js");
const englisch = lies("js/app/i18n-en.js");
const orte = lies("html/wiki-sync-settlement-editor.html");

// ---- Die neuen Woerter stehen da -------------------------------------------------------------
assert.ok(/>Landschaften bearbeiten</.test(index), "der Knopf heisst „Landschaften bearbeiten“");
assert.ok(/Landschaften bearbeiten/.test(editor), "der Fenstertitel ebenso");
assert.ok(/"Landschaften bearbeiten"/.test(liste), "und die Ueberschrift im Listen-Editor");
assert.ok(/"ecosystem\.editor\.title":\s*"Edit landscapes"/.test(englisch),
	"die englische Fassung heisst „Edit landscapes“");

// ---- Die alten Woerter sind weg, wo sie Beschriftung waren ------------------------------------
assert.ok(!/>Regionen bearbeiten</.test(index), "„Regionen bearbeiten“ steht nicht mehr im Knopf");
assert.ok(!/<title>[^<]*Regionen bearbeiten/.test(editor), "und nicht mehr im Fenstertitel");
assert.ok(!/t\("ecosystem\.editor\.title",\s*"Regionen bearbeiten"\)/.test(liste),
	"und nicht mehr als Rueckfalltext");

// ---- 💣 Und die KENNUNGEN sind unveraendert ---------------------------------------------------
// Wer hier mit umbenennt, laesst eine gecachte index.html ins Leere greifen -- der Deploy loescht
// nie, die alte Adresse bleibt also bestehen und muss weiter passen.
assert.ok(/ecosystem\.editor\.title/.test(liste), "der i18n-Schluessel bleibt ecosystem.editor.title");
assert.ok(/ecosystem\.editor\.title/.test(englisch), "auch in der englischen Tafel");
assert.ok(/id="ecosystem-editor-open"/.test(index), "die Knopf-Kennung bleibt");

// ---- Der Knopf unter „Orte" heisst ebenfalls „Darstellung" ------------------------------------
// ⚠️ Er trug den Namen schon vor diesem Umbau (eine andere Sitzung hat ihn umbenannt). Die
// Zusicherung bleibt trotzdem stehen: ab jetzt heissen ZWEI Kacheln so, und das ist gewollt.
assert.ok(/id="seZoomBands"/.test(orte), "die Kennung des Orte-Knopfs bleibt seZoomBands");
assert.ok(/id="seZoomBandsDialog"/.test(orte), "und die des Fensters ebenso");

// 🪤 Zwei Kacheln heissen „Darstellung" und zeigen Verschiedenes. Das ist gewollt (der Ort sagt,
// worum es geht) -- aber der `title` MUSS es aussprechen, sonst ist es eine Falle fuer den Editor.
const orteTitel = orte.match(/id="seZoomBands"[^>]*title="([^"]*)"/);
assert.ok(orteTitel, "der Orte-Knopf traegt einen title");
assert.ok(/Ort/.test(orteTitel[1]), "und der title sagt, dass es um ORTE geht");

console.log("landschaften-beschriftung: alle Zusicherungen gruen");
