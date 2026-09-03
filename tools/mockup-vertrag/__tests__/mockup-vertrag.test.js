/**
 * Der Mockup-Vertrag: das Bauteil selbst UND der Lauf über alle Mockups des Repos.
 * Ausführen: node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
 *
 * 💣 ZWEI HÄLFTEN, und die zweite ist die, die den Owner interessiert. Die erste prüft den
 * Vergleicher an gestellten Fällen; die zweite hält JEDES Mockup, das einen Vertrag erklärt,
 * gegen seine Produktionsdatei. Ohne die zweite wäre der Vergleicher ein Werkzeug, das niemand
 * ruft -- genau der Zustand, in dem die Mockups vor dem 02.09.2026 waren.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	vertragsBloecke, regelnLesen, vertragPruefen, abweichungText, normalisiereWert,
} = require("../mockup-vertrag.js");

const WURZEL = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

// ── 1. Der Vergleicher ──────────────────────────────────────────────────────────────────────
assert.deepStrictEqual(
	regelnLesen(".a { color: red; padding: 2px }"),
	{ ".a": { color: "red", padding: "2px" } },
	"flache Regel");
zaehl();

// 💣 Ein Kommentar ist keine Zusage -- sonst verspricht eine Erklärung neben der Regel etwas.
assert.deepStrictEqual(
	regelnLesen(".a { /* border: 9px */ color: red }"),
	{ ".a": { color: "red" } },
	"ein auskommentierter Wert wird nicht zur Zusage");
zaehl();

// Mehrere Selektoren an einer Regel gelten jedem einzeln.
assert.deepStrictEqual(
	regelnLesen(".a, .b { gap: 1px }"),
	{ ".a": { gap: "1px" }, ".b": { gap: "1px" } },
	"Selektorliste");
zaehl();

assert.strictEqual(normalisiereWert("  1PX   SOLID  var( --x )  "), "1px solid var(--x)",
	"Schreibweise normalisiert");
zaehl();
assert.strictEqual(normalisiereWert(".5"), "0.5", "führende Null ergänzt");
zaehl();
// ⚠️ INHALT wird NICHT normalisiert: 8px und 0.5rem sind verschieden und sollen auffallen.
assert.notStrictEqual(normalisiereWert("8px"), normalisiereWert("0.5rem"),
	"verschiedene Einheiten bleiben verschieden");
zaehl();

assert.deepStrictEqual(vertragPruefen(".a { color: red }", ".a { color: red; padding: 0 }"), [],
	"mehr in der Produktion ist erlaubt -- der Vertrag ist eine UNTERGRENZE");
zaehl();

const abw = vertragPruefen(".a { font-size: 11px }", ".a { font-size: 10px }");
assert.strictEqual(abw.length, 1, "abweichender Wert wird gefunden");
zaehl();
assert.strictEqual(abw[0].mockup, "11px");
assert.strictEqual(abw[0].produktion, "10px");
zaehl();
// 💣 GENAU DER FEHLER VOM 02.09.2026: die Aufschrift stand im ✎ auf 11px und in der Eingabezeile
// auf 10px, und beide Regeln lasen sich für sich genommen richtig.
assert.ok(abweichungText(abw[0]).includes("11px") && abweichungText(abw[0]).includes("10px"),
	"die Meldung nennt beide Werte");
zaehl();

const fehlt = vertragPruefen(".a { gap: 6px }", ".b { gap: 6px }");
assert.strictEqual(fehlt.length, 1, "ein fehlender Selektor ist eine Abweichung");
zaehl();
assert.strictEqual(fehlt[0].produktion, null, "und wird als fehlend gemeldet");
zaehl();

// ── 2. Die Marken ───────────────────────────────────────────────────────────────────────────
const beispiel = [
	"<style>",
	".egal { color: blue }",
	"/* ══ VERTRAG: css/x.css ══ */",
	".fs-scope { padding: 17px 10px 10px; }",
	"/* ══ VERTRAG ENDE ══ */",
	".auch-egal { color: green }",
	"</style>",
].join("\n");
const bloecke = vertragsBloecke(beispiel);
assert.strictEqual(bloecke.length, 1, "ein Block wird gefunden");
zaehl();
assert.strictEqual(bloecke[0].datei, "css/x.css", "die Zieldatei steht in der Marke");
zaehl();
// 💣 NUR was zwischen den Marken steht -- alles davor und dahinter ist Mockup-Gerüst
// (Seitenrahmen, Erklärtexte, Umschalter) und darf die Produktion nicht binden.
const gelesen = regelnLesen(bloecke[0].css);
assert.deepStrictEqual(Object.keys(gelesen), [".fs-scope"], "nur der Vertragsteil bindet");
zaehl();

assert.throws(() => vertragsBloecke("/* ══ VERTRAG: css/x.css ══ */ .a { color: red }"),
	/VERTRAG ENDE/, "ein offener Vertrag wirft, statt still den Rest zu verschlucken");
zaehl();

// ── 3. DER LAUF ÜBER DAS REPO ───────────────────────────────────────────────────────────────
// 🔴 Das ist die Hälfte, die den Deploy anhält. Jedes Mockup mit einer VERTRAG-Marke wird
// gegen seine Produktionsdatei gehalten.
const mockupOrdner = path.join(WURZEL, "docs");
const mockups = fs.readdirSync(mockupOrdner).filter((n) => n.endsWith("-mockup.html"));
assert.ok(mockups.length > 0, "es gibt Mockups im Repo");
zaehl();

let mitVertrag = 0;
const rot = [];
mockups.forEach((name) => {
	const html = fs.readFileSync(path.join(mockupOrdner, name), "utf8");
	vertragsBloecke(html).forEach((block) => {
		mitVertrag += 1;
		const ziel = path.join(WURZEL, block.datei);
		if (!fs.existsSync(ziel)) {
			rot.push(name + ": die zugesagte Datei " + block.datei + " gibt es nicht");
			return;
		}
		const abweichungen = vertragPruefen(block.css, fs.readFileSync(ziel, "utf8"));
		if (abweichungen.length > 0) {
			rot.push(name + " gegen " + block.datei + ":\n"
				+ abweichungen.map(abweichungText).join("\n"));
		}
	});
});

if (rot.length > 0) {
	process.stderr.write("\nMOCKUP-VERTRAG VERLETZT:\n\n" + rot.join("\n\n") + "\n\n"
		+ "Entweder der Produktivcode zieht nach, oder das Mockup wird berichtigt.\n"
		+ "Was NICHT geht: die Marke entfernen, damit es gruen wird.\n");
	process.exit(1);
}

process.stdout.write("OK -- " + pruefungen + " Zusicherungen, " + mockups.length
	+ " Mockups geprueft, davon " + mitVertrag + " mit Vertrag.\n");
