// Das Textgold des hellen Themas erreicht AA — auf JEDER Fläche, auf der es wirklich steht.
// ==========================================================================================
// Owner 05.09.2026 („ja") auf das Kontrastaudit vom 13.08.2026
// (`docs/kontrast-audit-gold-und-knopfpaar.md` §4.1). Vorher stand `--color-accent-strong` auf
// `#9c7f22` und damit JEDE Gold-Beschriftung des hellen Themas unter AA — 3,78 auf `--color-panel`
// bis 3,17 auf `--color-button-soft`. Verlangt sind 4,5:1: die Aufschriften des Hauses stehen auf
// 11–16px, und `--font-size-subhead` (16px) fett ist KEIN Großtext (die Schwelle liegt bei 18,66px
// fett).
//
// 💣 DAS AUDIT WAR RICHTIG UND SEINE PRÄMISSE IST TROTZDEM VERALTET. Es empfahl `#82681e` und
//    zählte dafür die Flächen, auf denen damals nachweisbar Gold-TEXT stand -- `--color-button-soft`
//    war keine davon. Seit dem 04.09.2026 ist sie eine: die zugeklappte Leiste des Rahmenkastens
//    trägt ihre Aufschrift darauf. Auf ihr hätte `#82681e` nur 4,39 gegeben.
//    ⭐ Die Lehre, die dieser Test festhält: eine Kontrastzahl gilt für eine PAARUNG, nicht für eine
//    Farbe. Wer eine Aufschrift auf eine neue Fläche setzt, prüft die Paarung neu -- und genau das
//    tut dieser Test ab jetzt von selbst, für alle sechs Flächen auf einmal.
//
// 💣 UND DER LINK GEHÖRT DAZU. Er war die dunklere der beiden Goldfarben und verfehlte AA um 0,05;
//    bliebe er stehen, wäre die Aufschrift plötzlich dunkler als er -- die Rangfolge kippt (Audit
//    §4.1). Deshalb prüft dieser Test beide, und zusätzlich ihre Ordnung.
//
// 🔴 Das DUNKLE Thema ist nicht Gegenstand: dort steht `#dcc77e` zwischen 5,6 und 9,8. Der Test
//    misst es trotzdem mit -- nicht um es zu reparieren, sondern damit ein späterer Griff ins
//    dunkle Gold nicht unbemerkt darunter rutscht.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/goldkontrast.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const tokens = fs.readFileSync(path.join(WURZEL, "css/base/tokens.css"), "utf8").replace(/\r\n/g, "\n");

// ---- WCAG 2.1, Relativluminanz nach sRGB. Dieselben drei Zeilen wie im Audit §5. -------------
const kanal = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luminanz = (hex) => 0.2126 * kanal(parseInt(hex.slice(1, 3), 16))
	+ 0.7152 * kanal(parseInt(hex.slice(3, 5), 16))
	+ 0.0722 * kanal(parseInt(hex.slice(5, 7), 16));
const kontrast = (a, b) => (Math.max(luminanz(a), luminanz(b)) + 0.05)
	/ (Math.min(luminanz(a), luminanz(b)) + 0.05);

// ---- Die Werte kommen aus der DATEI, nie aus einer Abschrift ---------------------------------
// 💣 Der helle Block steht vor dem dunklen. Ein Regex ohne diese Trennung liest sonst den dunklen
//    Wert und misst ein Thema, das gar nicht gemeint ist -- und meldet dann fälschlich „alles gut".
// 🪤 UND ER MUSS DIE GESCHWEIFTE KLAMMER VERLANGEN: `:root[data-theme="dark"]` steht in dieser
//    Datei schon in ZEILE 10 -- im Kopfkommentar. Ohne `\{` endet der helle Block dort, und der
//    Test findet keine einzige helle Farbe mehr (beim Bau genau so passiert). Dieselbe Falle wie
//    „ein Quelltexttest darf Kommentare nicht mitlesen".
const dunkelAb = tokens.search(/:root\[data-theme=["']?dark["']?\]\s*\{/);
assert.ok(dunkelAb > 0, "tokens.css trennt hell und dunkel");
const hell = tokens.slice(0, dunkelAb);
const dunkel = tokens.slice(dunkelAb);

function wert(block, name, wo) {
	const treffer = block.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})\\s*;"));
	assert.ok(treffer, wo + ": --" + name + " steht als Hexwert da");
	return treffer[1].toLowerCase();
}

// ---- Die sechs Flächen, auf denen Gold-Text wirklich steht (Audit §2 + der Rahmenkasten) -----
const FLAECHEN = ["color-panel", "color-panel-soft", "color-page-bg", "color-panel-muted",
	"color-pill", "color-button-soft"];
const AA = 4.5;

{
	const gold = wert(hell, "color-accent-strong", "hell");
	const link = wert(hell, "color-link", "hell");
	const linkHover = wert(hell, "color-link-hover", "hell");

	FLAECHEN.forEach((f) => {
		const grund = wert(hell, f, "hell");
		[["--color-accent-strong", gold], ["--color-link", link]].forEach(([name, farbe]) => {
			const k = kontrast(farbe, grund);
			assert.ok(k >= AA,
				`${name} (${farbe}) auf --${f} (${grund}) misst ${k.toFixed(2)}:1 -- verlangt sind `
				+ `${AA}:1. Die Aufschriften des Hauses stehen auf 11-16px, und 16px fett ist KEIN `
				+ `Grosstext (Schwelle 18,66px fett). Siehe docs/kontrast-audit-gold-und-knopfpaar.md`);
		});
	});

	// 🔴 Die Ordnung: der Link bleibt die dunklere der beiden Goldfarben, sein Hover dunkler als er.
	//    Kippt sie, liest sich ein Link heller als eine Aufschrift -- und die naechste Nachschaerfung
	//    repariert die falsche Farbe.
	assert.ok(luminanz(link) < luminanz(gold),
		`--color-link (${link}) muss dunkler bleiben als --color-accent-strong (${gold}): `
		+ `${luminanz(link).toFixed(4)} gegen ${luminanz(gold).toFixed(4)}`);
	assert.ok(luminanz(linkHover) < luminanz(link),
		`--color-link-hover (${linkHover}) bleibt dunkler als der Link (${link})`);
}

// ---- Das dunkle Thema: nicht Gegenstand, aber nicht unbeobachtet ------------------------------
{
	const gold = wert(dunkel, "color-accent-strong", "dunkel");
	["color-panel", "color-panel-soft", "color-button-soft"].forEach((f) => {
		const grund = wert(dunkel, f, "dunkel");
		const k = kontrast(gold, grund);
		assert.ok(k >= AA,
			`dunkel: --color-accent-strong (${gold}) auf --${f} (${grund}) misst ${k.toFixed(2)}:1`);
	});
}

console.log("OK -- das Textgold erreicht AA auf allen sechs Flaechen, in beiden Themen, "
	+ "und die Ordnung Aufschrift > Link > Hover haelt.");
