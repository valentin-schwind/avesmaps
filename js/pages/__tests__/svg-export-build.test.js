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

// ---- 8. Unterarten einzeln abwählbar ---------------------------------------------------
{
	// Nur Flusswege, keine Reichsstraßen -- und die Orte ganz ohne Metropolen.
	const { parts, stats, detail } = B.svgxBuildDocument({
		mapFeatures: payload, dialect: D.INKSCAPE,
		subgroups: { wege: { Reichsstrasse: false, Flussweg: true }, orte: { metropole: false } },
	});
	const svg = parts.join("");

	assert.ok(!svg.includes('inkscape:label="Reichsstrasse"'), "abgewählte Wegart muss fehlen");
	assert.ok(svg.includes('inkscape:label="Flussweg"'), "angehakte Wegart muss da sein");
	assert.ok(!svg.includes("<title>Gareth</title>"), "abgewählte Ortsgröße muss fehlen");
	assert.strictEqual(stats.Wege, 1, "Zählwerk folgt der Auswahl");
	assert.strictEqual(stats.Orte, 0, "ohne Metropolen bleibt kein Ort übrig");

	// 💣 Die abgewählte Reichsstraße darf auch keine BESCHRIFTUNG mehr hinterlassen --
	// sonst zeigt ein textPath auf eine id, die es nicht mehr gibt.
	const hrefs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
	hrefs.forEach((h) => {
		assert.ok(svg.includes(`id="${h}"`),
			`href="#${h}" zeigt ins Leere, nachdem seine Wegart abgewählt wurde`);
	});

	// Das Zählwerk führt die Untergruppen einzeln.
	const wegGruppen = detail.filter((d) => d.layer === "Wege");
	assert.deepStrictEqual(wegGruppen, [{ layer: "Wege", group: "Flussweg", count: 1 }],
		"detail muss die Untergruppen mit ihren Zahlen führen");
}

// ⚠️ Nur ein ausdrückliches false schließt aus: eine unbekannte Unterart bleibt drin.
// (In den Live-Daten trägt ein Ort die Ortsart 'crossing' -- eine Datenleiche, die nicht
// lautlos verschwinden darf, bloß weil sie in keiner Kästchenliste steht.)
{
	const seltsam = { features: [{ properties: { feature_type: "location", feature_subtype: "crossing", name: "Seltsam", public_id: "x1" },
		geometry: { type: "Point", coordinates: [10, 10] } }] };
	const { stats } = B.svgxBuildDocument({
		mapFeatures: seltsam, dialect: D.INKSCAPE,
		subgroups: { orte: { metropole: true, dorf: true } },
	});
	assert.strictEqual(stats.Orte, 1, "eine unbekannte Ortsart darf nicht stillschweigend wegfallen");
}

console.log("svg-export-build (Unterarten): ok");

// ---- 9. Landschaften: Geländetyp als dritte Auswahlstufe -------------------------------
{
	const flaeche = (typ, name, id) => ({
		public_id: id, region_name: name, region_type: typ, kind: "topographie",
		geometry: { type: "Polygon", coordinates: [[[0, 1024], [4, 1024], [4, 1020], [0, 1024]]] },
	});
	// ⚠️ FLACHE Objekte, ohne properties -- so liefert ecosystem-areas.php sie wirklich.
	const eco = [flaeche("wald", "Der Wald", "e1"), flaeche("meer", "Das Meer", "e2"),
		flaeche("", "Namenlos", "e3")];

	const alles = B.svgxBuildDocument({ ecosystems: eco, dialect: D.INKSCAPE,
		layers: { landschaften: true, gebiete: false, wege: false, kraftlinien: false,
			orte: false, beschriftungen: false } });
	assert.strictEqual(alles.stats.Landschaften, 3);
	assert.ok(alles.parts.join("").includes("<title>Der Wald</title>"),
		"der Name muss aus dem FLACHEN Objekt gelesen werden (region_name)");

	// 💣 Eine Fläche ohne region_type landet unter 'ohne_typ' -- NICHT unter dem Namen
	// ihrer Art. Sonst trüge sie einen Gruppennamen, den kein Kästchen kennt, und wäre
	// nie abwählbar.
	assert.ok(alles.detail.some((d) => d.group === "ohne_typ" && d.count === 1),
		"typlose Flächen gehören in die Gruppe 'ohne_typ'");

	const gefiltert = B.svgxBuildDocument({ ecosystems: eco, dialect: D.INKSCAPE,
		layers: { landschaften: true, gebiete: false, wege: false, kraftlinien: false,
			orte: false, beschriftungen: false },
		subgroups: { landschaftstypen: { wald: true, meer: false, ohne_typ: false } } });
	assert.strictEqual(gefiltert.stats.Landschaften, 1, "nur der Wald bleibt");
	assert.ok(!gefiltert.parts.join("").includes("Das Meer"), "abgewählter Geländetyp muss fehlen");
	assert.ok(!gefiltert.parts.join("").includes("Namenlos"), "'ohne_typ' muss abwählbar sein");
}

console.log("svg-export-build (Geländetypen): ok");

// ---- 10. Ausgabegröße in Bildpunkten --------------------------------------------------
{
	// 💣 Die Größe steht in width/height, der Zeichenraum bleibt IMMER 0…1024 -- nur so
	// skalieren Strichstärken und Schriften mit, ohne einzeln nachgerechnet zu werden.
	const kopf = B.svgxDocumentOpen(D.INKSCAPE, 32768);
	assert.ok(kopf.includes('width="32768" height="32768"'), "die Größe gehört in width/height");
	assert.ok(kopf.includes('viewBox="0 0 1024 1024"'), "der Zeichenraum bleibt 1024");

	assert.ok(B.svgxDocumentOpen(D.INKSCAPE).includes('width="32768"'),
		"ohne Angabe gilt der Standard 32768");
	assert.ok(B.svgxDocumentOpen(D.INKSCAPE, 4096).includes('width="4096" height="4096"'));
	assert.ok(B.svgxDocumentOpen(D.INKSCAPE, 0).includes('width="32768"'),
		"eine unsinnige Größe fällt auf den Standard zurück");

	// Die Koordinaten dürfen sich durch die Größe NICHT ändern.
	const a = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE, sizePx: 4096 }).parts.join("");
	const b = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE, sizePx: 65536 }).parts.join("");
	assert.strictEqual(a.replace(/width="\d+" height="\d+"/, ""), b.replace(/width="\d+" height="\d+"/, ""),
		"außer width/height darf die Größe nichts verändern");
}

// ---- 11. Landschaftsfarben kommen von außen -------------------------------------------
{
	const eco = [{ public_id: "e1", region_name: "Ein See", region_type: "see", kind: "topographie",
		geometry: { type: "Polygon", coordinates: [[[0, 1024], [4, 1024], [4, 1020], [0, 1024]]] } }];
	const svg = B.svgxBuildDocument({ ecosystems: eco, dialect: D.INKSCAPE,
		areaColors: { see: "#4a86b8" },
		layers: { landschaften: true, gebiete: false, wege: false, kraftlinien: false,
			orte: false, beschriftungen: false } }).parts.join("");
	assert.ok(svg.includes('fill="#4a86b8"'), "die Farbe je Geländetyp muss an der Gruppe hängen");
	// Ohne Tafel bleibt der neutrale Rückfall -- der Bauer erfindet keine Farbe.
	const ohne = B.svgxBuildDocument({ ecosystems: eco, dialect: D.INKSCAPE,
		layers: { landschaften: true, gebiete: false, wege: false, kraftlinien: false,
			orte: false, beschriftungen: false } }).parts.join("");
	assert.ok(!ohne.includes("#4a86b8"), "ohne Tafel darf keine Farbe aus dem Nichts kommen");
}

console.log("svg-export-build (Größe + Farben): ok");

// ---- 12. Keine Transparenz ------------------------------------------------------------
// 🔴 Owner 15.08.2026: keine Deckkraft in der Datei. Die Karte füllt mit 0,72, weil dort
// die Kacheln durchscheinen sollen -- eine Bearbeitungsdatei will volle Deckung, sonst
// mischt sich jede Fläche mit allem darunter.
{
	const eco = [{ public_id: "e1", region_name: "Ein See", region_type: "see", kind: "topographie",
		geometry: { type: "Polygon", coordinates: [[[0, 1024], [4, 1024], [4, 1020], [0, 1024]]] } }];
	const svg = B.svgxBuildDocument({ ecosystems: eco, areaColors: { see: "#4a86b8" }, dialect: D.INKSCAPE,
		layers: { landschaften: true, gebiete: false, wege: false, kraftlinien: false,
			orte: false, beschriftungen: false } }).parts.join("");
	assert.ok(!/opacity/.test(svg), "die Datei darf nirgends eine Deckkraft tragen");
}

// Auch im vollen Dokument nicht, quer über alle Ebenen und beide Dialekte.
[D.INKSCAPE, D.ILLUSTRATOR].forEach((dialect) => {
	const svg = B.svgxBuildDocument({ mapFeatures: payload, dialect }).parts.join("");
	assert.ok(!/opacity/.test(svg), `${dialect}: keine Deckkraft im ganzen Dokument`);
});

console.log("svg-export-build (keine Transparenz): ok");

// ---- 13. Strichstärken: hergeleitet, nicht geschätzt -----------------------------------
// 🔴 Die Karte zieht ihre Wege mit PATH_CENTER_WEIGHTS in BILDPUNKTEN bei voller Zoomstufe,
// und volle Zoomstufe ist 1024 × 2^5 = 32.768 px -- die Standardgröße dieses Exports. Ein
// Bildpunkt dort ist 1/32 Einheit hier. Der erste Satz war 7,2× zu dick (Owner 15.08.2026).
{
	const KARTE = { Reichsstrasse: 4, Strasse: 2.5, Weg: 2.5, Pfad: 1.5,
		Gebirgspass: 1.5, Wuestenpfad: 1.5, Flussweg: 3, Seeweg: 3 };
	const MASSSTAB = 32768 / 1024;   // = 32
	Object.entries(KARTE).forEach(([art, px]) => {
		const soll = px / MASSSTAB;
		assert.ok(Math.abs(B.SVGX_WAY_WIDTHS[art] - soll) < 0.002,
			`${art}: ${B.SVGX_WAY_WIDTHS[art]} Einheiten sind bei 32.768 px `
			+ `${(B.SVGX_WAY_WIDTHS[art] * MASSSTAB).toFixed(2)} px, die Karte zieht ${px} px`);
	});

	// Der Regler multipliziert, 100 % lässt in Ruhe.
	const bei = (skala) => {
		const svg = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE,
			strokeScale: skala }).parts.join("");
		return Number((svg.match(/stroke-width="([\d.]+)"/) || [])[1]);
	};
	assert.ok(Math.abs(bei(1) - 0.125) < 1e-9, "100 % ist der Kartenzustand");
	assert.ok(Math.abs(bei(0.5) - 0.0625) < 1e-9, "50 % halbiert");
	assert.ok(Math.abs(bei(undefined) - 0.125) < 1e-9, "ohne Angabe gilt 100 %");
	assert.ok(Math.abs(bei(0) - 0.125) < 1e-9, "0 ist unsinnig und fällt auf 100 % zurück");
}

console.log("svg-export-build (Strichstärken): ok");

// ---- 14. Gebietsgrenzen sind auch nur Linien ------------------------------------------
// ⚠️ Sie standen bis 15.08.2026 auf 0,4 = 12,8 px -- viermal zu dick, derselbe Schätzfehler
// wie bei den Wegen, nur eine Zeile weiter unten und deshalb beim ersten Mal übersehen.
// Deshalb prüft dieser Test die GANZE Datei und nicht nur die Wege.
{
	const terr = { features: [{ properties: { name: "Ein Reich", public_id: "t1", type: "region" },
		geometry: { type: "Polygon", coordinates: [[[0, 1024], [8, 1024], [8, 1016], [0, 1024]]] } }] };
	const svg = B.svgxBuildDocument({ mapFeatures: payload, territories: terr, dialect: D.INKSCAPE })
		.parts.join("");
	const staerken = [...new Set([...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])))];
	const dickste = Math.max(...staerken);
	assert.ok(dickste <= 0.125 + 1e-9,
		`keine Linie darf dicker sein als die Reichsstraße (0,125 = 4 px), dickste war `
		+ `${dickste} = ${(dickste * 32).toFixed(1)} px`);
	assert.ok(Math.abs(B.SVGX_BOUNDARY_WIDTH - 3 / 32) < 0.002, "Gebietsgrenze = 3 px der Karte");
}

console.log("svg-export-build (Grenzenstärke): ok");

// ---- 15. Glättung: Catmull-Rom als Bézier ----------------------------------------------
// 🔴 DIESER TEST IST DER GRUND, WARUM DIE GLÄTTUNG GLAUBWÜRDIG IST. SVG kennt keinen
// Catmull-Rom-Befehl; ich schreibe die Kurve als kubische Bézier. Dass das DIESELBE Kurve
// ist wie die, die die Karte zeichnet, ist keine Behauptung, sondern wird hier gegen das
// eine Catmull-Rom des Projekts nachgerechnet.
{
	const CR = require("../../map-features/map-features-line-catmull.js");
	assert.strictEqual(B.SVGX_CATMULL_TENSION, CR.AVESMAPS_CATMULL_DEFAULTS.tension,
		"die Spannung muss die des Projekts sein, nicht eine eigene");

	// Eine kubische Bézier an der Stelle t (de Casteljau, ausgeschrieben).
	const bezier = (p0, c1, c2, p1, t) => {
		const u = 1 - t;
		return [
			u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
			u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
		];
	};

	// Ein Zickzack mit scharfen Ecken -- dort weicht eine falsche Umrechnung am meisten ab.
	const punkte = [[0, 0], [10, 40], [30, 10], [50, 60], [70, 20], [90, 50]];
	const s = CR.AVESMAPS_CATMULL_DEFAULTS.tension;
	const at = (i) => punkte[Math.max(0, Math.min(punkte.length - 1, i))];

	let groessteAbweichung = 0;
	for (let i = 0; i < punkte.length - 1; i += 1) {
		const p0 = at(i - 1), p1 = punkte[i], p2 = punkte[i + 1], p3 = at(i + 2);
		const c1 = [p1[0] + ((p2[0] - p0[0]) * s) / 3, p1[1] + ((p2[1] - p0[1]) * s) / 3];
		const c2 = [p2[0] - ((p3[0] - p1[0]) * s) / 3, p2[1] - ((p3[1] - p1[1]) * s) / 3];
		for (let k = 0; k <= 20; k += 1) {
			const t = k / 20;
			const meine = bezier(p1, c1, c2, p2, t);
			const karte = CR.getCatmullRomPoint(p0, p1, p2, p3, t, s);
			groessteAbweichung = Math.max(groessteAbweichung,
				Math.abs(meine[0] - karte[0]), Math.abs(meine[1] - karte[1]));
		}
	}
	assert.ok(groessteAbweichung < 1e-9,
		`Bézier und Karten-Catmull-Rom müssen dieselbe Kurve sein, größte Abweichung war ${groessteAbweichung}`);

	// Und die erzeugten Pfaddaten: geglättet C-Befehle, ungeglättet L-Befehle, beide mit
	// demselben Anfang und demselben Ende -- die Endpunkte dürfen nie wandern.
	const roh = [[0, 1024], [10, 1014], [20, 1024], [30, 1004]];
	const gerade = B.svgxPathData(roh);
	const rund = B.svgxPathData(roh, { smooth: true });
	assert.ok(/^M0 0L/.test(gerade) && !/C/.test(gerade), "ungeglättet bleibt ein Polygonzug");
	assert.ok(/^M0 0C/.test(rund), "geglättet beginnt am selben Punkt und benutzt C");
	assert.strictEqual((rund.match(/C/g) || []).length, roh.length - 1, "ein C je Segment");
	assert.ok(rund.endsWith("30 20"), `geglättet muss am selben Punkt enden, war: ${rund.slice(-24)}`);
	assert.ok(!/L/.test(rund), "eine geglättete Linie hat keine geraden Stücke mehr");

	// Zwei Punkte sind noch eine Kurve (eine gerade), aber kein Absturz.
	assert.ok(B.svgxPathData([[0, 0], [1, 1]], { smooth: true }).startsWith("M0 1024C"));
	assert.strictEqual(B.svgxPathData([[0, 0]], { smooth: true }), "M0 1024",
		"ein einzelner Punkt bleibt ein Punkt");
}

// ---- 16. Farben je Untergruppe frei setzbar -------------------------------------------
{
	const svg = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE,
		wayColors: { Reichsstrasse: "#f5ffe9", Flussweg: "#4c89c6" },
		wayOutlines: { Reichsstrasse: "#333333" },
		placeColors: { metropole: "#112233" } }).parts.join("");

	assert.ok(svg.includes('stroke="#f5ffe9"'), "die Linienfarbe je Wegart muss durchschlagen");
	assert.ok(svg.includes('stroke="#4c89c6"'), "auch für Flusswege");
	assert.ok(svg.includes('stroke="#333333"'), "die Konturfarbe muss durchschlagen");
	assert.ok(svg.includes('fill="#112233"'), "die Ortsfarbe je Ortsart muss durchschlagen");

	// 💣 Ohne Konturfarbe KEINE Kontur -- sonst verdoppeln sich stillschweigend die Pfade.
	const ohne = B.svgxBuildDocument({ mapFeatures: payload, dialect: D.INKSCAPE }).parts.join("");
	assert.ok(!/-kontur/.test(ohne), "ohne Konturfarbe darf keine Konturgruppe entstehen");

	// Und die Kontur darf die Beschriftung nicht kapern: jeder href zeigt auf eine LINIE.
	const hrefs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
	hrefs.forEach((h) => {
		assert.ok(!/-?Kontur/i.test(h), `die Beschriftung läuft auf der Kontur statt auf der Linie: ${h}`);
		assert.ok(svg.includes(`id="${h}"`), `href="#${h}" zeigt ins Leere`);
	});
	const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
	assert.strictEqual(ids.length, new Set(ids).size, "auch mit Kontur bleibt jede id eindeutig");
}

console.log("svg-export-build (Glättung + Farben je Gruppe): ok");
