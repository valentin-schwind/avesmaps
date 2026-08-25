// 💣 JEDER Weg ins vereinigte Landschaftsfenster geht durch DENSELBEN Trichter.
//
// 🪤 DIESE FALLE IST IN EINEM EINZIGEN UMBAU DREIMAL ZUGESCHNAPPT — zweimal von mir selbst
// bemerkt, das dritte Mal vom Owner am gebauten Fenster:
//   1. Die Verdrahtung stand im Öffner der Hülle; die zwei Module rufen ihn nicht.
//      → sie zog nach `avesmapsLandschaftDialogSichtbar`.
//   2. Die eigenen CSS-Regeln des Fensters zeigten auf die alte Kennung.
//   3. Der FLÄCHEN-Öffner setzte `hidden` selbst und ging damit an genau dem Trichter vorbei, in
//      den (1) gerade gezogen war. Auf dem Flächenweg waren deshalb WEDER die drei Reiter NOCH
//      „Speichern"/„Abbrechen"/„Löschen" bedienbar — während der Beschriftungsweg vollständig grün
//      durchlief. Owner, wörtlich: „geht alles noch nicht".
//
// 🔴 Die Lehre steht in AGENTS.md an vier Stellen und gilt auch hier: **eine Regel, die einen von
// mehreren Erzeugern bindet, ist keine Regel.** Dieser Test zählt die Erzeuger, statt sie zu
// glauben.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-trichter.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
// Kommentare zählen nicht mit — sonst prüft der Test seine eigene Begründung.
const ohneKommentare = (js) => js
	.replace(/\/\*[\s\S]*?\*\//g, " ")
	.split("\n")
	.map((zeile) => { const i = zeile.indexOf("//"); return i === -1 ? zeile : zeile.slice(0, i); })
	.join("\n");
let checks = 0;

// ── A. DER TRICHTER VERDRAHTET ───────────────────────────────────────────────────────────────
const huelle = lies("js/map-features/landschaft-dialog.js");
const iSichtbar = huelle.indexOf("function avesmapsLandschaftDialogSichtbar(");
assert.ok(iSichtbar >= 0, "den Trichter gibt es"); checks++;
const rumpf = huelle.slice(iSichtbar, iSichtbar + 1200);
assert.ok(rumpf.includes("avesmapsLandschaftDialogVerdrahten()"),
	"der Trichter verdrahtet beim Öffnen"); checks++;

// ── B. NIEMAND SETZT DAS `hidden` DES FENSTERS SELBST ────────────────────────────────────────
// 💣 DAS IST DIE ZUSICHERUNG, die den Fehler vom 26.08.2026 gefunden hätte. Wer am Overlay
// vorbeiöffnet, öffnet ein Fenster, dessen Bedienelemente allesamt tot sind — und das sieht auf
// dem anderen Weg vollkommen richtig aus.
// ⚠️ Die Hülle selbst darf es (sie IST der Trichter); alle anderen nicht.
const verdaechtige = [
	"js/review/review-labels.js",
	"js/map-features/map-features-ecosystem-properties.js",
	"js/map-features/map-features-ecosystem-edit.js",
	"js/map-features/map-features-ecosystem-context-action.js",
	"js/map-features/map-features-labels.js",
	"js/review/review-core.js",
	"js/app/bootstrap.js",
];
verdaechtige.forEach((datei) => {
	const code = ohneKommentare(lies(datei));
	// Ein direkter Zugriff auf das Overlay, gefolgt von einem `hidden`-SCHREIBvorgang.
	// 🪤 `=(?!=)` ist tragend: ohne die Klammer trifft das Muster auch `?.hidden === false`, und das
	// ist ein LESEN. `map-features-ecosystem-edit.js` fragt genau so ab, ob das Fenster offen ist --
	// die erste Fassung dieses Tests meldete es als Verstoß.
	const treffer = code.match(/landschaft-dialog-overlay[\s\S]{0,200}?\.hidden\s*=(?!=)/g) || [];
	assert.strictEqual(treffer.length, 0,
		datei + ": setzt `hidden` am Fenster selbst, statt durch avesmapsLandschaftDialogSichtbar zu "
		+ "gehen — dort hängt die Verdrahtung. Gefunden: " + treffer.join(" | ").slice(0, 160));
	checks++;
});

// ── C. BEIDE ÖFFNER GEHEN DURCH DEN TRICHTER ─────────────────────────────────────────────────
// Es gibt genau zwei Wege ins Fenster: die Beschriftung und die Fläche.
const label = ohneKommentare(lies("js/review/review-labels.js"));
assert.ok(/avesmapsLandschaftDialogSichtbar\(/.test(label),
	"der Beschriftungsweg geht durch den Trichter"); checks++;
const eco = ohneKommentare(lies("js/map-features/map-features-ecosystem-properties.js"));
assert.ok(/avesmapsLandschaftDialogSichtbar\(true\)/.test(eco),
	"der Flächenweg öffnet durch den Trichter"); checks++;
assert.ok(/avesmapsLandschaftDialogSichtbar\(false\)/.test(eco),
	"…und schließt durch ihn"); checks++;

// ── D. DER FOKUS FINDET DEN DIALOGKÖRPER ─────────────────────────────────────────────────────
// 🪤 Beide Module fokussierten nach dem Öffnen den Körper ihres ALTEN Fensters. Ein
// `getElementById` auf eine abgeschaffte Kennung gibt `null`, `?.focus()` tut nichts, und der
// Fokus bleibt auf der Karte — still, wie jeder Zugriff auf eine tote Kennung.
[["js/map-features/map-features-ecosystem-properties.js", "ecosystem-properties-dialog"],
 ["js/review/review-core.js", "label-edit-dialog"]].forEach(([datei, tot]) => {
	const code = ohneKommentare(lies(datei));
	assert.ok(!code.includes('getElementById("' + tot + '")'),
		datei + ": greift noch auf den abgeschafften Dialogkörper `" + tot + "` zu"); checks++;
});
assert.ok(eco.includes('getElementById("landschaft-dialog")'),
	"der Flächenweg fokussiert den gemeinsamen Dialogkörper"); checks++;

// ── E. DIE GEMEINSAME KNOPFLEISTE HAT IHRE DREI KNÖPFE ───────────────────────────────────────
const markup = lies("index.html");
["landschaft-dialog-save", "landschaft-dialog-cancel", "landschaft-dialog-close",
 "landschaft-dialog-delete"].forEach((id) => {
	assert.ok(markup.includes('id="' + id + '"'), "den Knopf " + id + " gibt es"); checks++;
	assert.ok(huelle.includes('einmal("' + id + '"'),
		"…und die Hülle verdrahtet ihn"); checks++;
});

console.log("landschaft-dialog-trichter: " + checks + " Zusicherungen gruen");
