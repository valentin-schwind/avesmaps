// Die Listenzeile der Editorfenster steht genau EINMAL -- als .avm-row in
// css/components/editor-page.css.
//
// 🔴 DIESER TEST EXISTIERT WEGEN VIER ABSCHRIFTEN. Vor dem 14.08.2026 trug jeder Editor seine
// eigene, inline im HTML:
//   .se-row   im Ortseditor
//   .se-row   NOCH EINMAL wortgleich im Kraftlinien-Editor -- dort sogar mit dem Kommentar
//             "/* Listenzeilen (Referenz .se-row) */", also nachweislich abgeschrieben
//   .ae-item  im Literatur-Editor
//   .ce-item  als wortgleicher Zwilling im Karteneditor
// Der Ortseditor sagte in seinem eigenen Kommentar: "Abenteuer- und Kartensammlungs-Editor tragen
// dieselbe Zeilengeometrie". Man wusste es und schrieb sie trotzdem dreimal.
//
// 💣 Beim Abschreiben ging die Skala verloren: .se-row-type und .se-row-l2 setzten
// font-size:10px, waehrend das Original --font-size-caption (11px) benutzt. 11px ist die
// Untergrenze in docs/design-language.md, und der Fehler wurde von einer Abschrift in die
// naechste weitergereicht. Genau so wandert ein Fehler durch ein Projekt: nicht durch
// Nachlaessigkeit, sondern durch Kopieren.
//
// 🔴 Alle sechs Editoren laden css/components/editor-page.css bereits -- die Abschriften waren
// ersatzlos abloesbar, ohne ein neues Stylesheet.
//
// Run: node js/pages/__tests__/editor-row-single-source.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

const editoren = [
	"wiki-sync-settlement-editor.html",
	"wiki-sync-powerline-editor.html",
	"wege-editor.html",
	"landschaften-editor.html",
	"game-literature-editor.html",
	"citymap-editor.html",
];

let checks = 0;

for (const datei of editoren) {
	const html = lies("html", datei);

	assert.ok(/editor-page\.css/.test(html),
		`${datei} laedt css/components/editor-page.css nicht -- ohne sie gibt es kein .avm-row.`);
	checks++;

	for (const klasse of ["se-row", "ae-item", "ce-item"]) {
		assert.ok(!new RegExp("\\." + klasse + "\\s*\\{").test(html),
			`${datei} definiert wieder eine eigene ".${klasse}"-Regel inline. Die Listenzeile der `
			+ "Editoren heisst .avm-row und steht in css/components/editor-page.css. Eine Abschrift "
			+ "sieht am Tag ihrer Entstehung identisch aus und driftet danach -- viermal geschehen.");
		checks++;
	}

	// ⚠️ Die 11px-Untergrenze gilt jetzt der GANZEN Editorseite, nicht nur der Listenzeile.
	// Bis zum 14.08.2026 stand der Wert auch an Abzeichen (.dt-badge), Hinweisen (.pl-hint,
	// .dt-img-hint, #seTreeBypassHint), Bild-Beschriftungen (.dt-img-ord, .dt-wappen-edit) und
	// Pfeil-Glyphen (.tree-toggle, die ▲▼-Knoepfe) -- einer davon sogar auf 9px. Der Owner hat
	// sie am 14.08.2026 mitgenommen ("ja mach die 10px auch noch").
	// 🔴 Geprueft werden nur DEKLARATIONEN (mit Semikolon). Die Kommentare dieser Dateien
	// erzaehlen die Geschichte des Werts und schreiben ihn woertlich hin -- ein Test, der sie
	// mitliest, meldet die Begruendung als Verstoss. Genau das ist beim Panel-Wachtest zweimal
	// passiert (js/review/__tests__/wikisync-list-form.test.js).
	const zuKlein = html.match(/font-size:\s*(?:[0-9]|10|10\.5)px;/g) || [];
	assert.deepStrictEqual(zuKlein, [],
		`${datei} setzt eine Schriftgroesse unter 11px. Die Untergrenze ist `
		+ "var(--font-size-caption) (docs/design-language.md, das dort ausdruecklich die 'alten "
		+ "9-10,5px-Mikrogroessen' meint). Gefunden: " + zuKlein.join(" "));
	checks++;
}

// ---- Das Original traegt die Skala --------------------------------------------------------------
const editorPage = lies("css", "components", "editor-page.css");
assert.ok(/\.avm-row__l2\s*\{[\s\S]*?font-size:\s*var\(--font-size-caption\)/.test(editorPage),
	".avm-row__l2 muss auf var(--font-size-caption) stehen -- sonst hat die Vereinheitlichung "
	+ "den Fehler der Abschriften uebernommen statt ihn zu beheben.");
checks++;
assert.ok(/\.avm-row__kind\s*\{[\s\S]*?font-size:\s*var\(--font-size-caption\)/.test(editorPage),
	".avm-row__kind muss auf var(--font-size-caption) stehen.");
checks++;

console.log(`editor-row-single-source: ${checks} Pruefungen bestanden (${editoren.length} Editoren).`);
