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
	// ⏳ Literatur- und Karteneditor kommen in Aufgabe 7 dazu (.ae-item / .ce-item). Sie stehen
	// hier bewusst NICHT auskommentiert ohne Grund -- der Grund ist dieser Kommentar, damit
	// niemand die Luecke fuer Absicht haelt:
	// "game-literature-editor.html",
	// "citymap-editor.html",
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

	// ⚠️ Geprueft wird das ZEILEN-Umfeld, nicht die ganze Datei. Ein pauschales Verbot von
	// font-size:10px waere hier falsch: der Wert steht in diesen Editoren auch an Abzeichen
	// (.dt-badge), Hinweisen (.pl-hint, .dt-img-hint) und Baum-Pfeilen (.tree-toggle) -- alles
	// ausserhalb dieser Aufgabe. Dass diese Stellen die 11px-Untergrenze ebenfalls unterschreiten,
	// ist ein eigener Befund und eine eigene Entscheidung des Owners, kein Nebenprodukt hiervon.
	// 🔧 Offen: ~6 Stellen je Editor, siehe die Meldung zum Umbau vom 14.08.2026.
	const zeilenRegeln = [...html.matchAll(/\.(se|ae|ce)-(row|item|line)[\w-]*[^{]*\{([^}]*)\}/g)]
		.map(([, , , koerper]) => koerper);
	for (const koerper of zeilenRegeln) {
		assert.ok(!/font-size:\s*10px/.test(koerper),
			`${datei} setzt font-size:10px an einer Listenzeilen-Regel. Die Untergrenze ist 11px `
			+ "= var(--font-size-caption) (docs/design-language.md). Genau dieser Wert ging beim "
			+ "Abschreiben von .avm-row verloren und wurde weiterkopiert.");
		checks++;
	}
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
