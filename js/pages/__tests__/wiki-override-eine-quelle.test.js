// Der Wiki-Override steht genau EINMAL -- in css/components/wiki-override.css.
//
// 🔴 DIESER TEST HAT ZWEI HAELFTEN, und die zweite ist die wichtigere:
//   (1) keine der Regeln steht mehr ausserhalb jener Datei, und
//   (2) BEIDE Welten binden sie ein -- css/styles.css (index.html) UND
//       css/components/editor-page.css (die sieben Editorseiten in html/).
// 💣 Nur die erste Haelfte zu pruefen ist der Fehler von avesmapsCoatSrc: eine geteilte Datei, die
// nur EIN Dokument laedt, ist keine geteilte Datei. Dort hotlinkten daraufhin 8 von 12
// Wappen-Ausgaben das Wiki und es kostete die IP-Sperre. Eine Regel, die index.html nie erreicht,
// faellt nicht auf -- sie sieht aus wie „der Zustand ohne Abweichung".
//
// Vorgeschichte: bis zum 22.08.2026 standen dieselben Regeln zweimal (editor-page.css und
// location-report-dialog.css) plus ein drittes Mal inline im Literatur-Editor. Gedriftet waren sie
// bereits: 4px/6px einmal als Zahl, einmal als Token, und das ↺ trug in der Editor-Fassung 6px
// Rand mehr als im Kartendialog.
//
// Run: node js/pages/__tests__/wiki-override-eine-quelle.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const QUELLE = "css/components/wiki-override.css";
let checks = 0;

/* ---- Die Selektoren, um die es geht ---------------------------------------------------------
 * Gesucht wird die DEKLARATION (Selektor gefolgt von `{`), nie die Erwaehnung: die Kommentare
 * dieses Projekts erzaehlen die Geschichte einer Regel und schreiben sie woertlich hin. Ein Test,
 * der sie mitliest, meldet die Begruendung als Verstoss -- genau das ist beim Panel-Wachtest
 * zweimal passiert. */
const REGELN = [
	{ name: ".wiki-alt", muster: /\.wiki-alt(?![\w-])[^{;}\n]*\{/ },
	{ name: ".dt-old", muster: /(^|[\s,>+~])\.dt-old(?![\w-])[^{;}\n]*\{/m },
	{ name: ".dt-reset", muster: /(^|[\s,>+~])\.dt-reset(?![\w-])[^{;}\n]*\{/m },
	{ name: ".dt-grid--wiki", muster: /\.dt-grid--wiki[^{;}\n]*\{/ },
	{ name: ".has-wiki-ovr", muster: /\.has-wiki-ovr[^{;}\n]*\{/ },
	{ name: ".k.ovr", muster: /\.k\.ovr[^{;}\n]*\{/ },
];

/* 🔴 DIE EINE AUSNAHME, und sie ist begruendet, nicht geduldet: der Territoriumseditor
 * (html/wiki-sync-monitor.html) fuehrt `.dt-old`, `.dt-reset`, `.dt-arrow`, `.dt-new` und
 * `.dt-grid .k.ovr` seit jeher inline -- fuer eine ANDERE Darstellung derselben Sache
 * (Wiki-Stand → unser Stand als Pfeilform, das ↺ als blanker <span> in einer Rasterzelle, ohne
 * `.wiki-alt` darum). Sein eigener Kommentar sagt es an Ort und Stelle: „.dt-grid input.dt-in und
 * .dt-grid .k.ovr bleiben hier -- der Bearbeiten-Modus dieses Fensters".
 * ⚠️ Sein `.dt-reset` braucht dort `margin-left`, weil ihm der Flex-`gap` von `.wiki-alt` fehlt.
 * Wer diese Ausnahme je aufloest, muss die Pfeilform mit umziehen -- sonst verschwindet sie. */
const AUSNAHME = "html/wiki-sync-monitor.html";

// ---- Haelfte 1: nirgends sonst ---------------------------------------------------------------

function sammleDateien(verzeichnis, endung, treffer) {
	for (const eintrag of fs.readdirSync(path.join(root, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { sammleDateien(rel, endung, treffer); }
		else if (eintrag.name.endsWith(endung)) { treffer.push(rel); }
	}
	return treffer;
}

const cssDateien = sammleDateien("css", ".css", []);
assert.ok(cssDateien.includes(QUELLE), `${QUELLE} fehlt -- die geteilte Datei ist die Quelle.`);
checks++;

for (const datei of cssDateien.concat(sammleDateien("html", ".html", []))) {
	if (datei === QUELLE || datei === AUSNAHME) { continue; }
	const inhalt = lies(datei);
	for (const regel of REGELN) {
		assert.ok(!regel.muster.test(inhalt),
			`${datei} deklariert wieder "${regel.name}". Der Wiki-Override steht in ${QUELLE}, das `
			+ "BEIDE Welten binden. Eine Abschrift sieht am Tag ihrer Entstehung identisch aus und "
			+ "driftet danach -- am 22.08.2026 waren es bereits drei Fassungen mit zwei Abweichungen.");
		checks++;
	}
}

// ---- Haelfte 2: und beide Welten binden sie --------------------------------------------------
// 💣 Ohne diese Haelfte waere der Test erfuellbar, indem man die Datei anlegt und niemand sie laedt.

const welten = [
	{ datei: "css/styles.css", muster: /@import\s+url\(["']components\/wiki-override\.css["']\)/, wer: "die App (index.html)" },
	{ datei: "css/components/editor-page.css", muster: /@import\s+url\(["']wiki-override\.css["']\)/, wer: "die Editorseiten in html/" },
];

for (const welt of welten) {
	const inhalt = lies(welt.datei);
	assert.ok(welt.muster.test(inhalt),
		`${welt.datei} bindet ${QUELLE} nicht -- ${welt.wer} saehe den Wiki-Override dann gar nicht. `
		+ "Eine geteilte Datei, die nur EIN Dokument laedt, ist keine geteilte Datei.");
	checks++;

	// ⚠️ Ein @import muss VOR jeder Regel stehen (nur Kommentare duerfen davor). Steht er darunter,
	// verwirft der Browser ihn LAUTLOS -- die Datei ist dann verlinkt und wirkt trotzdem nicht.
	const ohneKommentare = inhalt.replace(/\/\*[\s\S]*?\*\//g, "");
	const importPos = ohneKommentare.search(welt.muster);
	const ersteRegel = ohneKommentare.search(/^[^@\s][^{}\n]*\{/m);
	assert.ok(importPos >= 0 && (ersteRegel < 0 || importPos < ersteRegel),
		`${welt.datei}: der @import auf ${QUELLE} steht NACH der ersten Regel. Der Browser verwirft `
		+ "ihn dann lautlos.");
	checks++;
}

// Und die Kette bis zum Dokument: index.html laedt css/styles.css, jede Editorseite editor-page.css.
assert.ok(/css\/styles\.css/.test(lies("index.html")),
	"index.html laedt css/styles.css nicht -- die Kette zur geteilten Datei ist unterbrochen.");
checks++;

for (const seite of sammleDateien("html", ".html", []).filter((d) => /editor-page\.css/.test(lies(d)))) {
	assert.ok(/editor-page\.css/.test(lies(seite)), `${seite}`);
	checks++;
}

// ---- Die zwei Zusicherungen, die eine LAUTLOSE Regression verhindern -------------------------

const quelle = lies(QUELLE);

// 💣 Seit die Datei per @import GANZ OBEN in editor-page.css steht, kaeme `.dt-grid` (0,1,0)
// SPAETER als `.dt-grid--wiki` (0,1,0) und gewaenne beim `grid-template-columns`: die 50/50-Zeile
// fiele lautlos auf 130px|1fr zurueck. Der doppelte Klassenname hebt die Spezifitaet auf 0,2,0.
assert.ok(/\.dt-grid\.dt-grid--wiki\s*\{/.test(quelle),
	`${QUELLE}: die 50/50-Regel muss ".dt-grid.dt-grid--wiki" heissen, nicht nur ".dt-grid--wiki". `
	+ "Mit einem Klassennamen hat sie dieselbe Spezifitaet wie .dt-grid, steht aber wegen des "
	+ "@imports frueher -- die Zeile faellt dann lautlos auf die 130px-Beschriftungsspalte zurueck.");
checks++;
assert.ok(/\.dt-grid\.dt-grid--wiki\s+\.k\s*\{/.test(quelle),
	`${QUELLE}: dasselbe fuer die .k-Zelle -- dort kollidiert "white-space" direkt mit .dt-grid .k.`);
checks++;

// 🔴 --mut/--bad sind :root-Aliase, die AUSSCHLIESSLICH editor-page.css deklariert. In index.html
// gaebe es sie nicht, und die Farbe fiele lautlos auf den geerbten Wert zurueck.
const aliase = quelle.replace(/\/\*[\s\S]*?\*\//g, "").match(/var\(--(?:mut|bad|fg|line|panel|soft|accent|warn|ok)\)/g) || [];
assert.deepStrictEqual(aliase, [],
	`${QUELLE} benutzt eine editor-page.css-Kurzform (${aliase.join(" ")}). Diese Aliase gibt es in `
	+ "index.html nicht -- die Eigenschaft fiele dort lautlos aus. Nur die echten Token.");
checks++;

console.log(`OK — Wiki-Override steht genau einmal und beide Welten binden ihn (${checks} Zusicherungen).`);
