// Die Quellenzeile in einem SCHMALEN Kasten: unter 420px bricht sie um, statt ueber den Rand zu laufen.
//
// 💣 DER BEFUND (Owner-Bild 03.09.2026, Territoriumseditor): die rechte Spalte des Editors ist bei
// 820px Dialogbreite rund 380px breit, ihr Inhalt 356 -- der Messkasten des Bauteils (`.fs-editor`)
// hatte dort 324px. Die schmale Zeilenvariante (ab 670px, `@container fs-liste`) braucht fuer ihre
// festen Spalten aber 104+104+74+22+22 plus 5x8 Abstand = 366px: das ✕ stand 42px ausserhalb der
// Zeile (im Browser gemessen: `removeRight - rowRight = 42`). Dazu gab die Elementregel `button`
// des gescopten Editors (8px 11px) dem 20-px-Kreis noch 22px Polster -- 24px breit statt 20.
//
// Zwei Riegel, beide im Modul-CSS und deshalb fuer alle neun Montagestellen:
//   1. Eine DRITTE Stufe unter 420px: die Zeile wird eine umbrechende Flex-Zeile. Titel oben, die
//      Marken teilen sich die zweite Zeile (Basis 0, wachsen bis zur eigenen Breite; passt es nicht,
//      wird zuerst die Typ-Pille gekuerzt, nie die Seitenangabe -- Gewichte 1/2/3), ✎ und ✕ rechts
//      und BEISAMMEN (feste 20px, `margin-left: auto` am ersten). Gemessen im Mockup bei 324px:
//      fuenf Zeilen zu je 49-50px, Ueberlauf 0, die lange Seitenangabe „S. 125, 126, 131" bleibt
//      vollstaendig, die Pille daneben ellipsiert.
//   2. Die Symbolknoepfe setzen ihr Polster SELBST (`padding: 0`): ein Wirt mit Elementregel fuer
//      `button` gewinnt sonst -- im gescopten Bauprodukt steht die Modulregel zwar mit Host-ID, aber
//      eine Eigenschaft, die sie nicht nennt, kann sie nicht ueberstimmen.
//
// ⚠️ Der Test liest CSS, weil Node kein CSS rechnet; das gerechnete Bild steht oben als Messung und
// im Mockup docs/quellen-neue-quelle-mockup.html (Karte 1). Was er sichert, ist, dass die Regeln nicht
// still verschwinden oder eine Haelfte verliert.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellenzeile-schmaler-kasten.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const css = lies("css/features/feature-sources.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Einen @container-Block samt Rumpf ausschneiden (Klammern zaehlen -- der Rumpf hat eigene Regeln).
function containerBlock(quelle, kopf) {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, "Block gibt es: " + kopf);
	let tiefe = 0; let i = quelle.indexOf("{", start);
	for (; i < quelle.length; i += 1) {
		if (quelle[i] === "{") tiefe += 1;
		else if (quelle[i] === "}") { tiefe -= 1; if (tiefe === 0) break; }
	}
	return { start, text: quelle.slice(start, i + 1) };
}
function regel(block, selektor) {
	const re = new RegExp(selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^{]*\\{([^}]*)\\}");
	const t = re.exec(block);
	assert.ok(t, "Regel fuer " + selektor + " steht im Block");
	return t[1];
}

// ---- 1. Die dritte Stufe steht NACH der zweiten -- die Reihenfolge ist die Kaskade -----------------
const zweite = containerBlock(css, "@container fs-liste (max-width: 670px)");
const dritte = containerBlock(css, "@container fs-liste (max-width: 420px)");
assert.ok(dritte.start > zweite.start,
	"die 420px-Stufe steht hinter der 670px-Stufe -- bei gleicher Spezifitaet gewinnt die spaetere, und unter 420 gelten beide");

// ---- 2. Die Zeile wird eine umbrechende Flex-Zeile -- die Eingabezeile bleibt draussen ------------
{
	const zeile = regel(dritte.text, ".fs-row:not(.fs-row--add)");
	assert.ok(/display:\s*flex/.test(zeile), "display: flex");
	assert.ok(/flex-wrap:\s*wrap/.test(zeile), "flex-wrap: wrap -- sonst ist es dieselbe Ueberlaufzeile in einer anderen Sprache");
	assert.ok(!/\.fs-row\s*\{/.test(dritte.text.replace(".fs-row:not(.fs-row--add)", "")),
		"keine nackte .fs-row-Regel in der Stufe: die Eingabezeile (.fs-row--add) hat ihr eigenes Layout");
	assert.ok(/\.fs-row__link[^{]*\{[^}]*flex:\s*1 1 100%/.test(dritte.text), "der Titel nimmt die ganze erste Zeile");
	assert.ok(/\.fs-row--wiki \.fs-row__link[^{]*\{[^}]*flex:\s*0 1 auto/.test(dritte.text),
		"… ausser in der Wiki-Zeile, wo „fest“ daneben bleibt");
}

// ---- 3. Die Marken teilen sich die zweite Zeile, ✎ und ✕ bleiben beisammen ------------------------
{
	const marken = regel(dritte.text, ".fs-row__badge, .fs-row__kind, .fs-row__pages, .fs-row__license");
	assert.ok(/flex:\s*1 1 0/.test(marken), "Basis 0: die Marken wachsen bis zur eigenen Breite, statt umzubrechen");
	assert.ok(/max-width:\s*max-content/.test(marken), "… und nie darueber hinaus");
	assert.ok(/text-overflow:\s*ellipsis/.test(marken) && /min-width:\s*0/.test(marken), "passt es nicht, wird gekuerzt");
	assert.ok(/\.fs-row__kind[^{]*\{[^}]*flex-grow:\s*2/.test(dritte.text), "die Abdeckung wiegt mehr als die Typ-Pille");
	assert.ok(/\.fs-row__pages, \.fs-row__license[^{]*\{[^}]*flex-grow:\s*3/.test(dritte.text),
		"Seiten und Lizenz wiegen am meisten -- die Seitenangabe wird nie zuerst gekuerzt");
	const knoepfe = regel(dritte.text, ".fs-row__edit, .fs-row__remove");
	assert.ok(/flex:\s*0 0 20px/.test(knoepfe), "✎ und ✕ sind feste 20px");
	assert.ok(/\.fs-row__edit, \.fs-row__edit-cell:empty \+ \.fs-row__remove[^{]*\{[^}]*margin-left:\s*auto/.test(dritte.text),
		"der erste Knopf rechts bekommt margin-left: auto -- auch, wenn die ✎-Zelle leer ist (Anlege-Puffer)");
	// ⚠️ Die GANZE Selektorliste als Anker: `.fs-row__edit-cell:empty` allein traefe zuerst die
	// margin-left-Regel darueber (dort steht es als `+`-Nachbar) -- der Test las beim ersten Lauf
	// genau die und meldete „kein display: none", obwohl es dastand.
	const leer = regel(dritte.text, ".fs-row__badge:empty, .fs-row__kind:empty, .fs-row__pages:empty, .fs-row__license:empty, .fs-row__edit-cell:empty");
	assert.ok(/display:\s*none/.test(leer), "leere Zellen verschwinden -- in einer Flex-Zeile kosteten sie sonst einen Abstand");
}

// ---- 4. Die Symbolknoepfe setzen ihr Polster selbst -------------------------------------------------
{
	const remove = /\.fs-row__remove\s*\{([^}]*)\}/.exec(css);
	const edit = /\.fs-row__edit\s*\{([^}]*)\}/.exec(css);
	assert.ok(remove && /padding:\s*0/.test(remove[1]), ".fs-row__remove traegt padding: 0");
	assert.ok(edit && /padding:\s*0/.test(edit[1]), ".fs-row__edit traegt padding: 0");
}

// ---- 5. Und das gescopte Bauprodukt des Territoriumseditors traegt die Stufe mit ------------------
{
	const produkt = lies("css/pages/political-territory-editor-inline.css");
	assert.ok(produkt.includes("@container fs-liste (max-width: 420px)"), "die dritte Stufe steht im Bauprodukt");
	assert.ok(produkt.includes("#political-territory-editor-host .fs-row:not(.fs-row--add)"),
		"… mit Host-ID gescopt -- sonst schluege die Rasterregel des Bauprodukts (1,1,0) die Flex-Regel (0,2,0)");
	assert.ok(/#political-territory-editor-host \.fs-row__remove \{[^}]*padding:\s*0/.test(produkt), "und das Polster des ✕ ebenso");
}

console.log("quellenzeile-schmaler-kasten: alle Zusicherungen erfuellt");
