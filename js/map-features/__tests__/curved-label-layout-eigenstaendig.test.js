// Steht `curved-label-layout.js` wirklich fuer sich -- oder ruft sie etwas, das in der IIFE von
// map-features-path-label-canvas-overlay.js zurueckgeblieben ist?
//
// 💣 Genau diese Frage hat die Reinheitspruefung vor dem Umzug (22.08.2026) NICHT gestellt. Sie
// suchte nach ZUSTAND (ctx, map, canvas, document, L) und fand nichts -- aber eine Funktion haengt
// auch dann an ihrem Gueltigkeitsbereich, wenn sie nur eine GESCHWISTERFUNKTION ruft. `findFreePlacement`
// rief `pathLabelBendSettings`, die drueben blieb; als Globale sah sie die IIFE-lokale nicht mehr.
// Jeder Aufruf warf `ReferenceError`, redraw() faengt nichts ab, und live waeren SAEMTLICHE Weg-,
// Fluss- und Kraftlinien-Namen der Karte verschwunden.
//
// ⚠️ Das ganze Testfeld war dabei gruen: kein Test laedt das Overlay. Deshalb steht dieser hier.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const verzeichnis = path.join(__dirname, "..");
const neu = fs.readFileSync(path.join(verzeichnis, "curved-label-layout.js"), "utf8");
const overlay = fs.readFileSync(path.join(verzeichnis, "map-features-path-label-canvas-overlay.js"), "utf8");

// Alles, was INNERHALB der IIFE deklariert ist, steht dort mit genau einem Tabulator Einzug.
const iifeNamen = new Set();
for (const treffer of overlay.matchAll(/^\t(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=)/gm)) {
	iifeNamen.add(treffer[1] || treffer[2]);
}
assert.ok(iifeNamen.size > 10, "die IIFE des Overlays deklariert mehr als zehn Namen (gefunden: " + iifeNamen.size + ")");

// Was die umgezogene Datei selbst deklariert, zaehlt nicht als Fremdzugriff.
const eigene = new Set();
for (const treffer of neu.matchAll(/^(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=)/gm)) {
	eigene.add(treffer[1] || treffer[2]);
}
assert.ok(eigene.has("layoutGlyphsAlong"), "die umgezogene Datei deklariert layoutGlyphsAlong");
assert.ok(eigene.has("findFreePlacement"), "die umgezogene Datei deklariert findFreePlacement");

// Kommentare zaehlen nicht -- dort DARF ein Name aus dem Overlay vorkommen (und tut es auch,
// als Begruendung genau dieser Falle).
const nurCode = neu.split(/\r?\n/).filter((zeile) => !/^\s*\/\//.test(zeile)).join("\n");

const fremd = [];
for (const name of iifeNamen) {
	if (eigene.has(name)) { continue; }
	if (new RegExp("\\b" + name + "\\b").test(nurCode)) { fremd.push(name); }
}
assert.deepStrictEqual(fremd, [],
	"curved-label-layout.js ruft Namen, die in der IIFE des Overlays geblieben sind: " + fremd.join(", "));

// 🪤 Gegenprobe, damit die Zusicherung oben nicht trivial erfuellt ist: waere `pathLabelBendSettings`
// noch drueben, MUESSTE dieser Test anschlagen. Wir stellen den alten Zustand nach und pruefen, dass
// die Erkennung ihn findet -- sonst koennte der Test auch bei kaputter Erkennung gruen bleiben.
const alsWaereEsDrueben = new Set(iifeNamen);
alsWaereEsDrueben.add("pathLabelBendSettings");
const probe = [];
for (const name of alsWaereEsDrueben) {
	if (name === "pathLabelBendSettings" ? false : eigene.has(name)) { continue; }
	if (new RegExp("\\b" + name + "\\b").test(nurCode)) { probe.push(name); }
}
assert.ok(probe.includes("pathLabelBendSettings"),
	"die Erkennung findet den historischen Fall -- sonst waere die Zusicherung oben wertlos");

console.log("curved-label-layout-eigenstaendig: alle Zusicherungen erfuellt");
