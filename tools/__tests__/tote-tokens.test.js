// TOTE TOKENS — `var(--gibt-es-nicht)` ohne Rueckfall macht die GANZE Deklaration ungueltig.
//
// 💣 WARUM ES DAS GIBT. Am 04.09.2026 stand einen Commit lang
// `outline: 2px solid var(--color-focus-ring)` im Routenplaner. Den Token gibt es im Haus nicht
// (er heisst `--color-focus`, der fertige Ring `--focus-ring`). Folge: `outline-style` faellt auf
// `none`, und wer mit der Tabulatortaste zu „Transportmittel"/„Reiseoptionen" springt, sieht GAR
// KEINEN Fokusring. Nichts wurde rot, im Bild sieht man es nur, wenn man wirklich tabbt -- und
// der Fehler war bereits auf der Live-Seite. Gefunden hat ihn ein Pruefagent, kein Test.
//
// 🔴 Es ist „invalid at computed-value time": nicht die eine Eigenschaft faellt weg, sondern die
//    ganze Deklaration -- bei einer Kurzform also alle ihre Teile. `margin: A 0 var(--tot)` laesst
//    das Element mit der Browser-Vorgabe stehen, nicht mit A.
// ⭐ Ein Rueckfall entschaerft es: `var(--x, 8px)` ist gueltig, auch wenn `--x` fehlt. Deshalb
//    zaehlt dieser Test nur `var()` OHNE Rueckfall.
// ⚠️ Er liegt unter `tools/`, nicht unter `css/`: das Deploy-Tor liest `find js tools ...`, ein
//    Test unter `css/__tests__/` liefe nie mit (.github/workflows/deploy-avesmaps-strato.yml).
//
// ⚠️ ZWEI ALTLASTEN sind namentlich zugelassen, und die Liste darf nur SCHRUMPFEN. Beide stehen
//    in css/pages/wege-editor.css am selben Element und sind heute kaputt:
//      .wp-tempo__sec h4                  margin: var(--space-10) 0 var(--space-3) -> Vorgabe
//      .wp-tempo__sec h4 .wp-tempo__day   margin-top: var(--space-1)               -> 0
//    Sie zu reparieren hiesse, zwei Werte zu RATEN, die der Autor gemeint hat -- das ist eine
//    Entscheidung und kein Aufraeumen, deshalb bleiben sie stehen und sichtbar.
//
// Aus der Wurzel des Repos:  node tools/__tests__/tote-tokens.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..");
const ALTLASTEN = new Set(["--space-1", "--space-3"]);

function blaetter(verzeichnis, gesammelt) {
	fs.readdirSync(verzeichnis, { withFileTypes: true }).forEach((eintrag) => {
		const p = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) { blaetter(p, gesammelt); return; }
		if (eintrag.name.endsWith(".css")) { gesammelt.push(p); }
	});
	return gesammelt;
}

const dateien = blaetter(path.join(WURZEL, "css"), []);
assert.ok(dateien.length > 40, "es werden wirklich alle Blaetter gelesen, gefunden: " + dateien.length);

const deklariert = new Set();
const benutzt = new Map();
dateien.forEach((p) => {
	// 💣 Kommentare RAUS: die Blaetter nennen tote Tokens in ihren eigenen Warnungen beim Namen.
	//    Ohne das schlaegt der Test an der Warnung an, die vor dem Fehler warnt.
	const css = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	(css.match(/--[A-Za-z0-9_-]+\s*:/g) || [])
		.forEach((m) => deklariert.add(m.slice(0, m.indexOf(":")).trim()));
	let m;
	const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g;
	while ((m = re.exec(css))) {
		if (!benutzt.has(m[1])) { benutzt.set(m[1], new Set()); }
		benutzt.get(m[1]).add(path.relative(WURZEL, p).split(path.sep).join("/"));
	}
});

const tot = [...benutzt.keys()].filter((k) => !deklariert.has(k));
const neu = tot.filter((k) => !ALTLASTEN.has(k));

assert.deepStrictEqual(neu, [],
	"diese Tokens werden ohne Rueckfall benutzt, aber nirgends deklariert -- damit faellt die "
	+ "GANZE Deklaration weg:\n"
	+ neu.map((k) => "  " + k + "  in " + [...benutzt.get(k)].join(", ")).join("\n"));

// 🔴 Die Altlasten-Liste darf nur schrumpfen: wer eine repariert, streicht sie hier.
const nochOffen = [...ALTLASTEN].filter((k) => tot.indexOf(k) >= 0);
assert.ok(nochOffen.length <= ALTLASTEN.size, "die Altlasten-Liste ist gewachsen");

console.log("OK -- " + deklariert.size + " Tokens deklariert, " + benutzt.size
	+ " ohne Rueckfall benutzt, " + nochOffen.length + " bekannte Altlasten, 0 neue.");
