// Der Einstieg bestimmt den offenen Reiter — und zwar an EINER Stelle je Weg.
//
// 🔴 Owner-Regel 25.08.2026, wörtlich: „Klick ich auf ein Label komm ich auf den neuen Dialog und
// automatisch auf ‚Beschriftung', klick ich auf die Eigenschaften der Fläche, komm ich auf Fläche."
//
// 🪤 ABWEICHUNG VOM BAUPLAN, mit Grund. Der Plan verlangte, dass JEDER der fünf Aufrufer von
// `openLabelEditDialog` seinen Reiter ausdrücklich NENNT, und wollte das hier zählen. Das ist die
// schwächere Regel: fünf Stellen sind fünf Gelegenheiten, eine zu vergessen, und der nächste
// Aufrufer erbt gar nichts. Die stärkere ist der TRICHTER — `openLabelEditDialog` setzt den Reiter
// selbst, und wer diesen Öffner ruft, meint eine Beschriftung. Genau ein Weg weicht ab, und der
// nennt seinen Reiter ausdrücklich.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-einstieg.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsLandschaftDialogStartReiter } = require("../landschaft-dialog.js");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
let checks = 0;

// ── A. DIE REGEL SELBST ──────────────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsLandschaftDialogStartReiter("label"), "beschriftung"); checks++;
assert.strictEqual(avesmapsLandschaftDialogStartReiter("flaeche"), "flaeche"); checks++;

// ── B. DER TRICHTER DER BESCHRIFTUNG ─────────────────────────────────────────────────────────
// Jeder Klick auf eine Beschriftung geht durch `openLabelEditDialog`. Der Öffner setzt den Reiter,
// nicht seine Aufrufer.
const labels = lies("js/review/review-labels.js");
const vonO = labels.indexOf("function openLabelEditDialog(");
assert.ok(vonO >= 0, "den Öffner gibt es"); checks++;
const kopfO = labels.slice(vonO, vonO + 1400);
assert.ok(/labelEditStartReiter = istEinstieg \? String\(options\.reiter \|\| "beschriftung"\) : ""/.test(kopfO),
	"der Öffner setzt den Reiter selbst, mit „beschriftung\" als Rückfall"); checks++;
// 🔴 …aber NUR als EINSTIEG. Seit dem 26.08.2026 lädt jeder Öffner auch die andere Hälfte, und der
// Gegenpart darf den Reiter nicht anfassen — sonst spränge „Eigenschaften …" einer Fläche auf
// „Beschriftung". Ein LEERER Merker heisst deshalb „nicht anfassen", nicht „nimm den Rückfall".
assert.ok(/labelEditStartReiter !== "" && typeof avesmapsLandschaftDialogReiter/.test(labels),
	"ein leerer Merker lässt den Reiter in Ruhe"); checks++;

// 💣 Und der gemerkte Wert wird bei JEDEM Aufruf neu gesetzt. Ein Merker, der über das Öffnen
// hinaus überlebt, ließe das zweite Öffnen auf dem Reiter des ersten landen — genau die Falle, an
// der das Anzeige-Menü und die Ansichts-Kacheln schon gescheitert sind (AGENTS.md §11).
// ⚠️ Gezählt wird die ZUWEISUNG, nicht die Erklärung: `let labelEditStartReiter = ""` steht ganz
// oben und ist kein zweiter Setzer.
assert.strictEqual((labels.match(/^	labelEditStartReiter = /gm) || []).length, 1,
	"der Merker wird an genau einer Stelle gesetzt"); checks++;
// 🪤 Und gesucht wird die EINGERÜCKTE Zuweisung: `labels.indexOf("labelEditStartReiter = ")` fände
// die Erklärung 700 Zeilen weiter oben und meldete, der Setzer stehe vor dem Öffner.
assert.ok(labels.indexOf("\tlabelEditStartReiter = ") > vonO,
	"…und zwar im Öffner"); checks++;

// ── C. DER EINE ABWEICHENDE WEG NENNT SEINEN REITER ──────────────────────────────────────────
// „Eigenschaften …" einer Fläche ist der einzige Einstieg, der NICHT auf die Beschriftung führt.
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
assert.ok(/avesmapsLandschaftDialogReiter\("flaeche"\)/.test(eco),
	"der Flächen-Einstieg nennt seinen Reiter ausdrücklich"); checks++;
const vonE = eco.indexOf("async function openEcosystemPropertiesDialog(");
assert.ok(vonE >= 0, "den Flächen-Öffner gibt es"); checks++;
assert.ok(eco.indexOf('avesmapsLandschaftDialogReiter("flaeche")') > vonE,
	"…und er tut es beim Öffnen"); checks++;

// ── D. KEIN AUFRUFER SETZT DEN REITER GEGEN DIE REGEL ────────────────────────────────────────
// ⚠️ Ein Aufrufer DARF ihn nennen (die Geschwisterwahl tut es), aber keiner darf auf „flaeche"
// zeigen: wer `openLabelEditDialog` ruft, hat eine Beschriftung in der Hand.
const dateien = [
	"js/map-features/map-features-ecosystem-context-action.js",
	"js/map-features/map-features-labels.js",
	"js/review/review-panels-change-log.js",
	"js/review/review-labels.js",
];
let aufrufer = 0;
dateien.forEach((datei) => {
	const s = lies(datei);
	for (const treffer of s.matchAll(/openLabelEditDialog\(\{([^}]*)\}/g)) {
		aufrufer++;
		assert.ok(!/reiter:\s*"flaeche"/.test(treffer[1]),
			datei + ": ein Aufrufer zeigt auf den Flächenreiter — " + treffer[0].slice(0, 70));
	}
});
assert.ok(aufrufer >= 5, "die Aufrufer sind noch da, gefunden: " + aufrufer); checks++;

// ── E. DER REITER WIRD NIE GESPERRT ──────────────────────────────────────────────────────────
// ⚠️ Auch wenn die gewählte Hälfte fehlt, geht ihr Reiter auf — dort steht das Angebot. Ein
// gesperrter Reiter verbärge genau die Handlung, die gerade fehlt.
const huelle = lies("js/map-features/landschaft-dialog.js");
const vonR = huelle.indexOf("function avesmapsLandschaftDialogReiter(");
const rumpfR = huelle.slice(vonR, vonR + 700);
assert.ok(!/disabled/.test(rumpfR), "kein Reiter wird gesperrt"); checks++;

console.log("landschaft-dialog-einstieg: " + checks + " Zusicherungen gruen");
