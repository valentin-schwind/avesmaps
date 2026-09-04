"use strict";

/*
 * DER LISTENKOPF -- die Zeile ueber einer Liste, mit Status, Filter und Aktualisieren.
 *
 * 💣 WARUM ES DIESEN TEST GIBT. Owner 04.09.2026: "ueber listen seh ich auch immer wieder so
 *    fehlerchen und inkonsistente header (falsch hier: Meldungen)". Im Browser gemessen standen
 *    dort ZWEI Knoepfe NEBENEINANDER in EINER Zeile -- „Filter ▾" 35px hoch, 12px Schrift,
 *    Radius 8, und „⟳" 25px hoch, 15px Schrift, Radius 5, in --color-link, als waere er ein
 *    Verweis. Zehn Pixel Hoehenunterschied in einer Zeile sieht man, auch ohne zu messen.
 *
 * 🔴 `.type-filter__toggle` GIBT ES ZWEIMAL, und das ist kein Versehen: index.html laedt
 *    css/styles.css, die Editor-iframes laden css/components/editor-page.css, und keine der
 *    beiden Dateien sieht die andere. Sie muessen deshalb ZEICHENGLEICH sein.
 * ⚠️ Der Test verlangt Gleichheit, nicht bestimmte Werte -- wer beide zusammen aendert, darf das.
 *    Er faellt nur, wenn eine Kopie allein wandert.
 * ⭐ Die Gleichheit loest nebenbei den Spezifitaetskonflikt, den garetien-importer.css beschreibt:
 *    diese Regel (0,1,0) schlaegt `.avm-tile` auf der Ebenen-Kachel, die beide Klassen traegt.
 *    Sagen beide dasselbe, ist gleichgueltig, wer gewinnt.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

/** Den Rumpf einer Regel holen -- per Klammerzaehlung, nie per Rueckwaertssuche. */
function regel(quelle, selektor) {
	const zeilen = quelle.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/);
	const i = zeilen.findIndex((l) => l.trim() === selektor + " {");
	if (i < 0) return null;
	const raus = [];
	for (let j = i + 1; j < zeilen.length; j++) {
		if (zeilen[j].trim() === "}") break;
		const s = zeilen[j].trim();
		if (s) raus.push(s);
	}
	return raus.sort().join(" ");
}

const panel = lies("css", "features", "review-panel.css");
const editor = lies("css", "components", "editor-page.css");

for (const selektor of [".type-filter__toggle", ".type-filter__toggle:hover"]) {
	const a = regel(panel, selektor);
	const b = regel(editor, selektor);
	assert.ok(a, selektor + " fehlt in review-panel.css -- der Sucher misst sich selbst kaputt");
	assert.ok(b, selektor + " fehlt in editor-page.css -- der Sucher misst sich selbst kaputt");
	assert.strictEqual(a, b,
		"Die zwei Kopien von " + selektor + " laufen auseinander.\n"
		+ "   review-panel.css: " + a + "\n"
		+ "   editor-page.css:  " + b);
}

// ---- Der Aktualisieren-Knopf steht auf derselben Hausform wie sein Nachbar -------------------
// 🔴 Nicht „gleich", sondern QUADRATISCH auf der Bedienhoehe: er traegt ein Symbol, keinen Text --
//    dieselbe Bauart wie das ✕ der Fenster-Kopfleiste.
const refresh = regel(panel, ".review-panel__refresh-btn");
assert.ok(refresh, ".review-panel__refresh-btn fehlt");
for (const zusage of [
	["width: var(--avm-control-h);", "Breite auf der Bedienhoehe"],
	["height: var(--avm-control-h);", "Hoehe auf der Bedienhoehe"],
	["border-radius: var(--radius-md);", "Hausradius"],
	["background: var(--color-button-soft);", "weicher Grund wie der Filterknopf"],
	["color: var(--color-button-soft-text);", "Knopffarbe, NICHT --color-link"],
]) {
	assert.ok(refresh.includes(zusage[0]), "Aktualisieren-Knopf: " + zusage[1] + " fehlt");
}
assert.ok(!/--color-link/.test(refresh),
	"Der ⟳ steht wieder in Linkfarbe -- er ist ein Knopf, kein Verweis");
assert.ok(!/font-size:\s*\d+px/.test(refresh),
	"Der ⟳ traegt wieder eine harte Schriftgroesse statt eines Tokens (AGENTS.md §12)");

// ---- Die DREI Reiterebenen des Editor-Panels teilen EINE Rezeptur -------------------------------
// 🪤 WARUM. Owner 04.09.2026 mit Bild: „da ist irgendwas der strich verloren gegangen." Er war nie
//    da. Die OBERSTE Zeile (Community · Änderungen · WikiSync · Status) markierte „aktiv" mit einer
//    FUELLUNG statt mit dem Unterstrich der zwei Ebenen darunter -- und im dunklen Thema gemessen
//    hatte die Fuellung einen RGB-Abstand von 2,2 zum Panelgrund. Unsichtbar. Nur die Schriftfarbe
//    unterschied noch.
// 🔴 T3 (Owner, derselbe Tag): ein Reiter IM Fenster traegt den Unterstrich. Die drei Ebenen stehen
//    uebereinander im selben Panel -- sie MUESSEN dieselbe Rezeptur haben, sonst sieht eine davon
//    aus wie ein anderes Bedienelement.
{
	const panel = lies("css", "features", "review-panel.css");
	for (const [selektor, wo] of [
		[".review-panel__tab", "oberste Zeile (Community …)"],
		[".wiki-sync-panel__tab", "zweite Zeile (Meldungen …)"],
		[".status-subtab", "dritte Zeile (Empfangen …)"],
	]) {
		// ⚠️ ZEILENWEISE statt per Regex: das letzte Glied einer Selektorliste endet mit " {",
		//    alle anderen mit ",". Ein Muster, das nur eine Form kennt, meldet das letzte Glied
		//    faelschlich als fehlend -- genau so ist dieser Test beim Schreiben umgefallen.
		const zeilen = panel.split(/\r?\n/).map((l) => l.trim());
		const inListe = (name) => zeilen.includes(name + ",") || zeilen.includes(name + " {");

		assert.ok(inListe(selektor),
			wo + ": " + selektor + " steht nicht in der geteilten Reiter-Grundregel");
		assert.ok(inListe(selektor + ".is-active"),
			wo + ": " + selektor + ".is-active steht nicht in der geteilten Aktiv-Regel "
			+ "-- markiert diese Ebene wieder mit einer Fuellung statt mit dem Unterstrich?");
		// Und KEINE eigene Aktiv-Rezeptur daneben, die die geteilte ueberstimmt.
		// 🪤 „Eigene Regel" heisst: die Zeile davor endet NICHT mit einem Komma. Das letzte Glied
		//    einer geteilten Liste endet ebenfalls mit " {" -- ohne diesen Blick auf den Vorgaenger
		//    meldet der Test genau die geteilte Regel als Alleingang. Beim Schreiben passiert.
		const k = zeilen.indexOf(selektor + ".is-active {");
		const alleingang = k > 0 && !zeilen[k - 1].endsWith(",");
		assert.ok(!alleingang,
			wo + ": " + selektor + " hat wieder eine EIGENE Aktiv-Regel -- zwei Rezepturen fuer "
			+ "denselben Zustand laufen auseinander, genau das war der Befund vom 04.09.2026");
	}
	console.log("OK -- die drei Reiterebenen des Panels teilen eine Rezeptur");
}


console.log("OK -- Listenkopf: zwei Filter-Kopien gleich, ⟳ auf der Hausform");
