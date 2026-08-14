// Der reine Bauer des SVG-Exports. Kein DOM, kein fetch -- genau deshalb ist er testbar.
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
//
// Lauf: node js/pages/__tests__/svg-export-build.test.js
"use strict";
const assert = require("assert");
const B = require("../svg-export-build.js");

// ---- 1. Koordinaten: die Spiegelung, die man einer 30-MB-Datei nicht ansieht ----
assert.deepStrictEqual(B.svgxPoint(0, 0), { x: 0, y: 1024 },
	"y=0 ist der SÜDrand und muss unten landen");
assert.deepStrictEqual(B.svgxPoint(0, 1024), { x: 0, y: 0 },
	"y=1024 ist der NORDrand und muss oben landen");
assert.deepStrictEqual(B.svgxPoint(512, 512), { x: 512, y: 512 });
assert.deepStrictEqual(B.svgxPoint(1.23456, 2.98765), { x: 1.23, y: 1021.01 },
	"zwei Nachkommastellen, sonst wird die Datei doppelt so groß");

// ---- 2. Der Rahmen ----
const kopfI = B.svgxDocumentOpen(B.SVGX_DIALECTS.ILLUSTRATOR);
const kopfN = B.svgxDocumentOpen(B.SVGX_DIALECTS.INKSCAPE);

[kopfI, kopfN].forEach((kopf) => {
	assert.ok(kopf.includes('viewBox="0 0 1024 1024"'), "viewBox fehlt");
	assert.ok(kopf.includes("http://www.w3.org/2000/svg"), "SVG-Namensraum fehlt");
	assert.ok(/<metadata>/.test(kopf), "<metadata> fehlt");
	assert.ok(/avesmaps\.de/.test(kopf), "die Quell-URL gehört in die Datei");
	assert.ok(/NOTICE\.md|Lizenz/i.test(kopf), "die Lizenz muss mitreisen");
});

// 💣 Der Illustrator-Dialekt darf den Inkscape-Namensraum NICHT führen.
assert.ok(!/inkscape|sodipodi/.test(kopfI),
	"die Illustrator-Datei darf keinen inkscape:/sodipodi:-Namensraum tragen");
assert.ok(/xmlns:inkscape/.test(kopfN),
	"die Inkscape-Datei braucht den inkscape-Namensraum");

assert.strictEqual(B.svgxDocumentClose(), "</svg>\n");

console.log("svg-export-build (Gerüst): ok");
