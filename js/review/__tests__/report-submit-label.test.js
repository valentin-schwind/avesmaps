// Der Absende-Knopf des Meldeformulars (#location-report-submit in index.html).
//
// Dieselbe Dialoghuelle traegt ZWEI Faelle: "Karteneintrag melden" (ein neuer Eintrag) und
// "Aenderung vorschlagen" (ein bestehendes Element). Titel, Vorspann und Quellen-Beschriftung
// wechseln laengst mit dem Modus; seit dem 13.08.2026 wechselt auch die Knopfbeschriftung
// (Owner: "Den in 'Vorschlag senden' und das symbol Brief").
//
// Zwei Dinge kippen hier lautlos:
//
//   1. 💣 `data-i18n` am BUTTON statt am SPAN. Der Uebersetzer setzt textContent (js/app/i18n.js:68)
//      -- am Button loescht das beim ersten Sprachwechsel das Brief-Bild weg, und niemand sieht,
//      warum. Deshalb: Bild und Beschriftung sind Geschwister, und nur das SPAN traegt data-i18n.
//   2. 💣 Ein Moduswechsel, der nur in EINE Richtung schreibt. Die Huelle wird wiederverwendet: wer
//      nur den Aenderungsmodus beschriftet, zeigt beim naechsten NEUEN Eintrag noch "Vorschlag
//      senden". Genau daran ist der Titel frueher schon einmal haengengeblieben.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/report-submit-label.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

const html = read("index.html");
const js = read("js", "review", "review-locations.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ---- Der Knopf selbst -------------------------------------------------------------------------
const knopf = (html.match(/<button id="location-report-submit"[\s\S]*?<\/button>/) || [])[0];
assert.ok(knopf, "der Absende-Knopf steht in index.html");
assert.ok(/<img[^>]+class="location-report-form__button-icon"/.test(knopf), "er traegt ein Symbol");
assert.ok(/src="img\/menu\/brief\.webp/.test(knopf), "und zwar den Brief");
assert.ok(/alt=""/.test(knopf), "alt bleibt leer -- der Knopf nennt sich schon selbst");

// 💣 Der Kern: data-i18n gehoert dem SPAN.
const knopfOhneKinder = knopf.replace(/<img[\s\S]*?\/>/g, "").replace(/<span[\s\S]*?<\/span>/g, "");
assert.ok(!/data-i18n/.test(knopfOhneKinder), "data-i18n haengt NICHT am Button (das loeschte das Bild)");
assert.ok(/<span id="location-report-submit-label" data-i18n="report\.submit">/.test(knopf),
	"sondern am Beschriftungs-Span, und der hat eine eigene ID");

// ---- Der Moduswechsel schreibt in BEIDE Richtungen ---------------------------------------------
const schreibstellen = js.match(/location-report-submit-label/g) || [];
assert.ok(schreibstellen.length >= 2, "die Beschriftung wird an mindestens zwei Stellen gesetzt");
assert.ok(/tr\("report\.changeSubmit", "Vorschlag senden"\)/.test(js),
	"Aenderungsmodus -> 'Vorschlag senden'");
assert.ok(/tr\("report\.submit", "Melden"\)/.test(js), "Meldemodus -> zurueck auf 'Melden'");

// Und beides sitzt wirklich in der jeweiligen Funktion, nicht zweimal in derselben.
const inFunktion = (name) => {
	const start = js.indexOf("function " + name + "(");
	assert.ok(start > 0, "es gibt " + name + "()");
	// bis zur naechsten Funktion auf oberster Ebene
	const rest = js.slice(start + 1);
	const ende = rest.search(/\nfunction /);
	return rest.slice(0, ende === -1 ? undefined : ende);
};
assert.ok(/report\.changeSubmit/.test(inFunktion("applyChangeSuggestionContext")),
	"der Aenderungsmodus setzt sie selbst");
assert.ok(/report\.submit"/.test(inFunktion("clearChangeSuggestionMode")),
	"und das Zuruecksetzen ebenfalls");

// ---- Die englische Seite kennt den neuen Schluessel --------------------------------------------
const en = read("js", "app", "i18n-en.js");
assert.ok(/"report\.changeSubmit":/.test(en), "report.changeSubmit steht in der englischen Tabelle");

console.log("report-submit-label: alle Zusicherungen gehalten");
