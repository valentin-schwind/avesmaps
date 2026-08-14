// Der reine Bauer des SVG-Exports. Kein DOM, kein fetch -- genau deshalb prüfbar.
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
//
// Lauf: node js/pages/__tests__/svg-export-build.test.js
"use strict";

const assert = require("assert");
const B = require("../svg-export-build.js");
const D = B.SVGX_DIALECTS;

// ---- 1. Koordinaten: die Spiegelung, die man einer großen Datei nicht ansieht ----------
assert.deepStrictEqual(B.svgxPoint(0, 0), { x: 0, y: 1024 },
	"y=0 ist der SÜDrand und muss unten landen");
assert.deepStrictEqual(B.svgxPoint(0, 1024), { x: 0, y: 0 },
	"y=1024 ist der NORDrand und muss oben landen");
assert.deepStrictEqual(B.svgxPoint(512, 512), { x: 512, y: 512 });
assert.deepStrictEqual(B.svgxPoint(1.23456, 2.98765), { x: 1.23, y: 1021.01 },
	"zwei Nachkommastellen, sonst wird die Datei doppelt so groß");

// ---- 2. Der Rahmen --------------------------------------------------------------------
const kopfI = B.svgxDocumentOpen(D.ILLUSTRATOR);
const kopfN = B.svgxDocumentOpen(D.INKSCAPE);
[kopfI, kopfN].forEach((kopf) => {
	assert.ok(kopf.includes('viewBox="0 0 1024 1024"'), "viewBox fehlt");
	assert.ok(kopf.includes("http://www.w3.org/2000/svg"), "SVG-Namensraum fehlt");
	assert.ok(/<metadata>/.test(kopf), "<metadata> fehlt");
	assert.ok(/avesmaps\.de/.test(kopf), "die Quell-URL gehört in die Datei");
	assert.ok(/NOTICE\.md/.test(kopf), "die Lizenz muss mitreisen");
});
// 💣 Der Illustrator-Dialekt darf den Inkscape-Namensraum NICHT führen.
assert.ok(!/inkscape|sodipodi/.test(kopfI), "die Illustrator-Datei führt keinen inkscape:-Namensraum");
assert.ok(/xmlns:inkscape/.test(kopfN), "die Inkscape-Datei braucht den inkscape-Namensraum");
assert.strictEqual(B.svgxDocumentClose(), "</svg>\n");

// ---- 3. Namen: zwei Dialekte, EINE Quelle ---------------------------------------------
{
	const seen = new Set();
	const id = B.svgxIdFor("Reichsstraße Gareth–Wehrheim", "p1042", D.INKSCAPE, seen);
	assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `Inkscape-id muss reines ASCII sein, war: ${id}`);
	assert.ok(id.includes("p1042"), "die öffentliche Kennung gehört in die id");
	assert.ok(/[Rr]eichsstrasse/.test(id), "'ß' wird 'ss', nicht weggeworfen");
}
// 💣 Zwei gleichnamige Orte ergeben ZWEI ids -- in beiden Dialekten.
[D.INKSCAPE, D.ILLUSTRATOR].forEach((dialect) => {
	const seen = new Set();
	const a = B.svgxIdFor("Gareth", "l1", dialect, seen);
	const b = B.svgxIdFor("Gareth", "l2", dialect, seen);
	assert.notStrictEqual(a, b, `${dialect}: gleichnamige Objekte brauchen verschiedene ids`);
});
// Eine id trägt nie ein Leerzeichen -- das ist in XML schlicht ungültig.
[D.INKSCAPE, D.ILLUSTRATOR].forEach((dialect) => {
	const id = B.svgxIdFor("Fürstentum Kosch", "t7", dialect, new Set());
	assert.ok(!/\s/.test(id), `${dialect}: eine id darf kein Leerzeichen tragen`);
});
// Text maskieren: ein & im Ortsnamen darf die Datei nicht zerreißen.
assert.strictEqual(B.svgxEscapeText('Fels & Fluss <"x">'), "Fels &amp; Fluss &lt;&quot;x&quot;&gt;");

// ---- 4. Linien ------------------------------------------------------------------------
assert.strictEqual(B.svgxPathData([[0, 1024], [10, 1014], [20, 1024]]), "M0 0L10 10L20 0",
	"Pfaddaten: gespiegelt, gerundet, ohne Schnörkel");

// ---- 5. Flächen: Polygon, MultiPolygon, und das LOCH -----------------------------------
{
	const quadrat = [[0, 1024], [10, 1024], [10, 1014], [0, 1014], [0, 1024]];
	const loch = [[2, 1022], [4, 1022], [4, 1020], [2, 1020], [2, 1022]];
	const einfach = B.svgxPolygonData({ type: "Polygon", coordinates: [quadrat] });
	assert.ok(einfach.startsWith("M0 0") && einfach.endsWith("Z"), `unerwartet: ${einfach}`);
	// 💣 Das Loch muss als ZWEITER Unterpfad auftauchen, sonst wird es zugefüllt -- und die
	// Karte sieht dabei richtig aus.
	const mitLoch = B.svgxPolygonData({ type: "Polygon", coordinates: [quadrat, loch] });
	assert.strictEqual((mitLoch.match(/Z/g) || []).length, 2,
		"ein Polygon mit Loch braucht zwei geschlossene Unterpfade");
	const multi = B.svgxPolygonData({ type: "MultiPolygon", coordinates: [[quadrat], [quadrat]] });
	assert.strictEqual((multi.match(/Z/g) || []).length, 2, "MultiPolygon wird nicht halbiert");
}

// ---- 6. Tolerantes Auspacken ----------------------------------------------------------
assert.strictEqual(B.svgxAsFeatures({ features: [1, 2] }).length, 2);
assert.strictEqual(B.svgxAsFeatures({ data: { features: [1] } }).length, 1);
assert.strictEqual(B.svgxAsFeatures([1, 2, 3]).length, 3);
assert.strictEqual(B.svgxAsFeatures(null).length, 0, "nichts darf nicht werfen");

// ---- 7. Das ganze Dokument ------------------------------------------------------------
const payload = {
	features: [
		{ properties: { feature_type: "path", feature_subtype: "Reichsstrasse", name: "Reichsstraße Gareth–Wehrheim", public_id: "p1" },
		  geometry: { type: "LineString", coordinates: [[0, 1024], [10, 1014]] } },
		{ properties: { feature_type: "path", feature_subtype: "Flussweg", name: "Großer Fluss", public_id: "p2" },
		  geometry: { type: "LineString", coordinates: [[5, 1000], [6, 999]] } },
		{ properties: { feature_type: "location", feature_subtype: "metropole", name: "Gareth", public_id: "l1" },
		  geometry: { type: "Point", coordinates: [100, 900] } },
		// 💣 Muss draußen bleiben: Routing-Knoten, kartografisch nichts.
		{ properties: { feature_type: "junction", name: "Kreuzung-1873", public_id: "j1" },
		  geometry: { type: "Point", coordinates: [300, 700] } },
		{ properties: { feature_type: "powerline", name: "Kraftlinie Nord", public_id: "k1" },
		  geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] } },
	],
};

{
	const { parts, stats } = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE });
	const svg = parts.join("");

	assert.ok(svg.startsWith("<?xml"), "die Datei beginnt mit der XML-Zeile");
	assert.ok(svg.trimEnd().endsWith("</svg>"), "die Datei endet geschlossen");

	// Alle sieben Ebenen, und zwar in ZEICHENreihenfolge.
	const ebenen = ["layer-landschaften", "layer-gebiete", "layer-wege",
		"layer-kraftlinien", "layer-orte", "layer-beschriftungen"];
	let pos = -1;
	ebenen.forEach((id) => {
		const jetzt = svg.indexOf(`id="${id}"`);
		assert.ok(jetzt > pos, `Ebene ${id} fehlt oder steht in falscher Reihenfolge`);
		pos = jetzt;
	});

	assert.ok(svg.includes('inkscape:label="Reichsstrasse"'), "Untergruppe Reichsstrasse fehlt");
	assert.ok(svg.includes('inkscape:label="Flussweg"'), "Flüsse sind die Untergruppe Flussweg");
	assert.ok(!svg.includes('inkscape:label="Seeweg"'), "eine Wegart ohne Wege erzeugt keine leere Gruppe");
	assert.ok(svg.includes("<title>Reichsstraße Gareth–Wehrheim</title>"), "<title> trägt den echten Namen");
	assert.ok(svg.includes('cx="100" cy="124"'), "Ortspunkt gespiegelt (1024-900)");
	assert.ok(!svg.includes("Kreuzung-1873"), "Kreuzungen gehören nicht in die Datei");
	assert.ok(svg.includes("Kraftlinie Nord"), "Kraftlinien fehlen");

	// 💣 DIE PROBE auf die Kopplung: jeder href muss auf eine id zeigen, die es in
	// DERSELBEN Datei gibt. Läuft das auseinander, ist die ganze Beschriftungsebene
	// unsichtbar -- in einer Datei, die sonst tadellos aussieht.
	const hrefs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
	assert.ok(hrefs.length > 0, "es muss mindestens einen textPath geben");
	hrefs.forEach((h) => {
		assert.ok(svg.includes(`id="${h}"`),
			`href="#${h}" zeigt ins Leere -- die Beschriftungsebene wäre unsichtbar`);
	});

	// Jede id genau EINMAL.
	const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
	assert.strictEqual(ids.length, new Set(ids).size, "jede id muss eindeutig sein");

	assert.strictEqual(stats.Wege, 2, "Zählwerk: zwei Wege");
	assert.strictEqual(stats.Orte, 1, "Zählwerk: ein Ort");
	assert.strictEqual(stats.Kraftlinien, 1, "Zählwerk: eine Kraftlinie");
}

// Eine ABGEWÄHLTE Ebene erzeugt keine Gruppe.
{
	const { parts } = B.svgxBuildDocument({
		mapFeatures: payload, dialect: D.INKSCAPE,
		layers: { landschaften: false, gebiete: false, wege: true,
			kraftlinien: false, orte: false, beschriftungen: false },
	});
	const svg = parts.join("");
	assert.ok(svg.includes('id="layer-wege"'), "die gewählte Ebene fehlt");
	assert.ok(!svg.includes('id="layer-orte"'), "eine abgewählte Ebene darf keine Gruppe erzeugen");
	assert.ok(!svg.includes('id="layer-landschaften"'), "eine abgewählte Ebene darf keine Gruppe erzeugen");
}

// Der Illustrator-Dialekt trägt nirgends inkscape:/sodipodi:.
{
	const { parts } = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.ILLUSTRATOR });
	const svg = parts.join("");
	assert.ok(!/inkscape|sodipodi/.test(svg), "die Illustrator-Datei darf den Namensraum nirgends führen");
	assert.ok(svg.includes("<title>Gareth</title>"), "<title> trägt den Namen auch hier");
}

// Die acht Wegefarben sind die ABSCHRIFT aus getPathStyleColors -- Schlüssel und Werte
// eingefroren, damit ein Vertipper auffällt (die Karte wird dafür nicht angefasst).
assert.deepStrictEqual(Object.keys(B.SVGX_WAY_COLORS).sort(), B.SVGX_WAY_SUBTYPES.slice().sort(),
	"die Farbtafel muss genau die acht Wegarten führen");
assert.deepStrictEqual(B.SVGX_WAY_COLORS, {
	Reichsstrasse: "#ffffff", Strasse: "#8b8b8b", Weg: "#cec4ae", Pfad: "#9b755a",
	Gebirgspass: "#a8695c", Wuestenpfad: "#bea470", Flussweg: "#6ec6ff", Seeweg: "#2f7dd3",
}, "Wegefarben abweichend von der Abschrift aus map-features.js");

console.log("svg-export-build: ok");
