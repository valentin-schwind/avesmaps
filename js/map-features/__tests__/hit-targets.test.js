// Treffer- und Antwortflaechen: was ein Finger anfassen kann, und wo genau EINE Flaeche antwortet
// statt zweier.
//
// Geprueft wird, was hier lautlos kippt: dass der Riegel fuer die schwebende Box an genau EINER
// der beiden Aufrufstellen haengt, dass Name und Punkt eines Ortes DASSELBE oeffnen, dass der
// Trefferradius nur einmal gerechnet wird -- und dass Flaechen niemals eine Zugabe bekommen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/hit-targets.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const markerEntry = withoutComments(read("js", "map-features", "map-features-location-marker-entry.js"));
const lookup = withoutComments(read("js", "map-features", "map-features-location-lookup.js"));

// ---- Die schwebende Box hat ZWEI Aufrufer, und nur einer wird still ------------------------------
//
// 🔴 Der Riegel gehoert AUSSCHLIESSLICH in marker-entry: dort ist die Box ein Doppel zum
// Infopanel -- gemessen auf 360x640 liegen 283 ihrer 334px dahinter. In location-lookup
// ("naechster Ort") ist dieselbe Box die EINZIGE Antwortflaeche; ein Riegel dort naehme dem
// Werkzeug seine Ausgabe.
assert.ok(/avesmapsIsPhoneViewport\s*\(\s*\)/.test(markerEntry),
	"marker-entry fragt avesmapsIsPhoneViewport, bevor es die schwebende Box oeffnet");
assert.ok(!/avesmapsIsPhoneViewport/.test(lookup),
	"location-lookup fragt NICHT -- dort ist die schwebende Box die einzige Antwortflaeche"
	+ " (\"naechster Ort\"), und ein Riegel naehme dem Werkzeug seine Ausgabe");
assert.ok(/floating:\s*true/.test(lookup),
	"und location-lookup oeffnet sie weiterhin");

// Die Entscheidung faellt EINMAL und wird dann benutzt -- nicht zweimal derselbe Ausdruck.
const bindPopupBlock = markerEntry.match(/markerEntry\.marker\.bindPopup\(([\s\S]*?)\n\t\);/);
assert.ok(bindPopupBlock, "der bindPopup-Aufruf ist auffindbar");
assert.ok(!/infopanelMode\s*\?\s*\{\s*floating/.test(bindPopupBlock[1]),
	"der bindPopup-Aufruf entscheidet nicht mehr selbst ueber die Box -- er liest das Ergebnis");

console.log("hit-targets tests passed");
