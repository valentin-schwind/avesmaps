// Mehrere Beschriftungen an EINER Fläche — die Wahl im Reiter „Beschriftung".
//
// 🔴 Live gemessen am 25.08.2026: 13 der 1026 Flächen tragen zwei oder drei Beschriftungen, das
// Ingvaltal und das Yaquirtal je drei. Genau dafür wurde die Beziehung am 28.07.2026 auf 1:N
// gestellt (Owner: „der Finsterkamm will im Norden UND im Süden beschriftet werden, jedes mit
// eigener Drehung/Position/Größe"). Ein vereinigtes Fenster, das nur die erste zeigt, nähme dem
// Ingvaltal zwei Beschriftungen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-geschwister.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
let checks = 0;

// ── A. DER SAMMLER, AUSGEFÜHRT ───────────────────────────────────────────────────────────────
// Er wird aus der Datei geschnitten und in einem Sandkasten mit einem Schein-Bestand gefahren --
// dieselbe Bauform wie in label-vorgabemarke.test.js.
const skript = lies("js/map-features/map-features-labels.js");
const von = skript.indexOf("function findLabelEntriesByEcosystemRegion(");
assert.ok(von >= 0, "der Sammler steht als eigene Funktion da"); checks++;
const rumpf = skript.slice(von, skript.indexOf("\n}", von) + 2);

const eintrag = (id, region, text) => ({ label: { publicId: id, ecosystemRegionPublicId: region, text: text } });
const sandkasten = {
	labelMarkers: [
		eintrag("l-c", "r-1", "südlich"),
		eintrag("l-a", "r-1", "nördlich"),
		eintrag("l-x", "r-2", "anderswo"),
		eintrag("l-b", "r-1", "mittig"),
		eintrag("l-ohne", "", "heimatlos"),
	],
};
vm.createContext(sandkasten);
vm.runInContext(rumpf + "; this.finde = findLabelEntriesByEcosystemRegion;", sandkasten);

const drei = sandkasten.finde("r-1");
assert.strictEqual(drei.length, 3, "drei Beschriftungen an derselben Fläche"); checks++;
// 💣 Sortiert wird nach der `publicId`, NICHT nach der Reihenfolge im Bestand: die hängt an der
// Ladereihenfolge der Nutzlast und rutscht, sobald jemand eine Beschriftung anlegt -- dann zeigte
// „2 von 3" beim nächsten Öffnen auf eine andere. Dieselbe Falle wie bei `Kreuzung-N`.
// 🪤 Verglichen wird ueber eine Zeichenkette, nicht per deepStrictEqual: der Sandkasten ist ein
// eigener Realm, seine Arrays haben einen anderen `Array`-Prototyp -- `deepStrictEqual([], [])`
// schlaegt dort fehl, und die Meldung zeigt zweimal `[]`.
assert.strictEqual(drei.map((e) => e.label.publicId).join(","), "l-a,l-b,l-c",
	"stabile Reihenfolge über die public_id, nicht über den Bestand"); checks++;
assert.strictEqual(sandkasten.finde("r-2").length, 1, "eine Fläche mit einer Beschriftung"); checks++;
assert.strictEqual(sandkasten.finde("").length, 0, "ohne Fläche kein Treffer"); checks++;
assert.strictEqual(sandkasten.finde("gibt-es-nicht").length, 0, "unbekannte Fläche: leer"); checks++;
// ⚠️ Eine Beschriftung OHNE Zeiger gehört zu keiner Fläche und darf nie mitgezählt werden -- sonst
// stünde sie in der Auswahl einer fremden Region.
assert.ok(!drei.some((e) => e.label.publicId === "l-ohne"), "heimatlose zählen nicht mit"); checks++;

// ── B. DIE AUSWAHL ERSCHEINT NUR BEI MEHREREN ────────────────────────────────────────────────
// Bei einer einzigen wäre ein Auswahlfeld mit einem Eintrag ein Bedienelement für nichts.
const labels = lies("js/review/review-labels.js");
assert.ok(/kasten\.hidden = geschwister\.length < 2/.test(labels),
	"unter zwei Beschriftungen bleibt die Wahl verborgen"); checks++;

// ── C. EIN WECHSEL FRAGT ZURÜCK ──────────────────────────────────────────────────────────────
// 💣 Das Fenster führt keine Änderungsverfolgung. Es wird deshalb GEFRAGT statt geraten -- lieber
// eine Rückfrage zu viel als eine verlorene Drehung. Der Fall ist selten genug (13 von 1026), dass
// die Frage niemanden ermüdet.
assert.ok(/window\.confirm\(/.test(labels), "ein Wechsel fragt zurück"); checks++;
assert.ok(/Ungespeicherte Änderungen an der jetzigen gehen verloren/.test(labels),
	"und sagt, was auf dem Spiel steht"); checks++;
// ⚠️ Bei „Abbrechen" springt die Auswahl auf die offene Beschriftung zurück -- sonst zeigte sie
// eine andere an, als der Dialog bearbeitet.
const vonW = labels.indexOf("wahl.addEventListener(\"change\"");
const rumpfW = labels.slice(vonW, labels.indexOf("\t\t});", vonW));
assert.ok(/syncLabelEditGeschwisterwahl\(labelEntry\)/.test(rumpfW),
	"ein abgelehnter Wechsel stellt die Auswahl zurück"); checks++;

// ── D. GEWECHSELT WIRD ÜBER DEN VORHANDENEN WEG ──────────────────────────────────────────────
// ⚠️ `openLabelEditDialog` ist derselbe Weg, den jeder Klick auf eine Beschriftung geht. Ein
// zweiter Füllweg wäre die zweite Wahrheit über denselben Zustand.
assert.ok(/openLabelEditDialog\(\{ labelEntry: ziel, reiter: "beschriftung" \}\)/.test(rumpfW),
	"gewechselt wird über den vorhandenen Öffner"); checks++;

// ── E. DIE NUMMER IST EINE ANZEIGE, KEINE ADRESSE ────────────────────────────────────────────
// 💣 Dieselbe Falle wie bei `Kreuzung-N`: ein laufender Zähler ist kein Schlüssel. Gewählt wird
// über die public_id, die Nummer steht nur im Text.
assert.ok(/option\.value = String\(eintrag\.label\.publicId/.test(labels),
	"gewählt wird über die public_id"); checks++;

// ── F. DAS MARKUP ────────────────────────────────────────────────────────────────────────────
const markup = lies("index.html");
const fenster = markup.slice(markup.indexOf('<div id="landschaft-dialog-overlay"'),
	markup.indexOf('<div id="region-edit-overlay"'));
assert.ok(fenster.includes('id="landschaft-dialog-labelwahl"'), "den Kasten gibt es"); checks++;
assert.ok(fenster.includes('id="landschaft-dialog-labelwahl-select"'), "und das Auswahlfeld"); checks++;
// Er steht IM Reiter „Beschriftung" und VOR dem Formular -- er sagt, worauf sich alles darunter
// bezieht.
const iWahl = fenster.indexOf('id="landschaft-dialog-labelwahl"');
const iForm = fenster.indexOf('id="label-edit-form"');
assert.ok(iWahl > 0 && iForm > iWahl,
	"die Wahl steht vor dem Formular, auf das sie sich bezieht"); checks++;

console.log("landschaft-dialog-geschwister: " + checks + " Zusicherungen gruen");
