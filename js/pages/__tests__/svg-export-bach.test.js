// Der Bach im SVG-Abzug: eine eigene Wegart, in Flussfarbe, aber schmaler gezeichnet.
// Lauf: node js/pages/__tests__/svg-export-bach.test.js
//
// 🔴 EIN BACH IST EIN `Flussweg` MIT `properties.is_bach` (Owner 30.08.2026) -- „Bach" steht
// in keiner Datenbankzeile. Der Export gruppiert aber nach dem, was ein LESER sieht, also
// bekommt er hier seine eigene Gruppe, seine eigene Vokabel und seine eigene Breite.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../svg-export-build.js");
const F = require("../svg-export-farben.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

// Eine kleine Karte: ein Fluss, ein Bach, ein See -- mehr braucht keine dieser Fragen.
const OEKOSYSTEME = [
	{ properties: { kind: "topographie", region_type: "see", name: "Angbarer See" },
		geometry: { type: "Polygon", coordinates: [[[300, 300], [340, 300], [340, 340], [300, 340], [300, 300]]] } },
];

function karte(zusatz) {
	return { features: [
		{ properties: { public_id: "p1", feature_type: "path", feature_subtype: "Flussweg", name: "Grosser Fluss" },
			geometry: { type: "LineString", coordinates: [[310, 320], [420, 380], [600, 640]] } },
	].concat(zusatz || []) };
}

const BACH = { properties: { public_id: "p2", feature_type: "path", feature_subtype: "Flussweg",
	is_bach: true, name: "Alke" },
	geometry: { type: "LineString", coordinates: [[100, 100], [200, 220]] } };

function baue(zusatz, optionen) {
	const ergebnis = B.svgxBuildDocument(Object.assign({
		mapFeatures: karte(zusatz), ecosystems: OEKOSYSTEME, semantics: true,
		dialect: B.SVGX_DIALECTS.INKSCAPE, sizePx: 32768, layers: {}, subgroups: {},
	}, optionen || {}));
	return { text: ergebnis.parts.join(""), detail: ergebnis.detail, stats: ergebnis.stats };
}

function zaehle(text, muster) {
	return (text.match(muster) || []).length;
}

// ---- 1. Der Bach ist eine eigene Art, der Fluss bleibt Fluss ---------------------------
const mitBach = baue([BACH]);
assert.ok(/avm:type="Bach"/.test(mitBach.text), "der Bach traegt seine eigene Vokabel");
assert.strictEqual(zaehle(mitBach.text, /avm:type="Bach"/g), 1,
	"und zwar GENAU EINMAL -- steht er in der Landschaften- UND in der Wege-Ebene, ist jeder "
	+ "Bach zweimal in der Datei");
assert.strictEqual(zaehle(mitBach.text, /avm:type="Flussweg"/g), 1,
	"der Fluss daneben ist unberuehrt");
assert.ok(/id="wege-bach-linie"/.test(mitBach.text), "eigene Gruppe im Ebenenfenster");

// ---- 2. Er ist SCHMALER als der Fluss -- gemessen am Markup, nicht an der Tabelle ------
// 🪤 Eine Zusicherung gegen SVGX_WAY_WIDTHS.Bach waere Vakuum: sie stimmte auch dann, wenn
// die Zahl die gezeichnete Linie nie erreicht.
function breiteVon(text, gruppe) {
	const treffer = new RegExp(`id="${gruppe}"[^>]*stroke-width="([0-9.]+)"`).exec(text);
	assert.ok(treffer, `die Gruppe ${gruppe} muss ihre Strichstaerke tragen`);
	return Number(treffer[1]);
}
const bachLinie = breiteVon(mitBach.text, "wege-bach-linie");
const flussLinie = breiteVon(mitBach.text, "wege-flussweg-linie");
assert.ok(bachLinie < flussLinie,
	`die Bachlinie (${bachLinie}) ist schmaler als die Flusslinie (${flussLinie})`);
// 🔴 UND ZWAR GENAU HALB -- Owner 31.08.2026: „bach is halb so breit wie n fluss". Dieselbe
// Zahl steht in der Karte als PATH_WIDTH_SCALE.Bach (js/config.js, 0,5 ab Zoom 3); der Abzug
// IST die volle Zoomstufe. Ein „irgendwie schmaler" liesse die beiden Flaechen auseinander-
// laufen, ohne dass etwas rot wird.
assert.strictEqual(B.SVGX_BACH_FAKTOR, 0.5, "ein Bach ist ein halber Fluss");
assert.strictEqual(bachLinie, flussLinie * B.SVGX_BACH_FAKTOR,
	`die Bachlinie ist die Haelfte der Flusslinie (${bachLinie} gegen ${flussLinie})`);

// Die Kontur wird nur GEZEICHNET, wenn eine Farbe dafuer gesetzt ist -- der API-Abzug hat
// keine. Also einmal mit Konturfarbe, denn genau darum ging der Auftrag.
const mitKontur = baue([BACH], { wayOutlines: { Flussweg: "#123456", Bach: "#123456" } });
const bachKontur = breiteVon(mitKontur.text, "wege-bach-kontur");
const flussKontur = breiteVon(mitKontur.text, "wege-flussweg-kontur");
assert.ok(bachKontur < flussKontur,
	`die Bachkontur (${bachKontur}) ist schmaler als die Flusskontur (${flussKontur})`);
// 💣 Die Halbierung trifft BEIDE Breiten -- ginge nur die Kontur herunter, waere vom Saum ein
// halber Pixel je Seite uebrig und der Bach saehe konturlos aus.
assert.strictEqual(bachKontur, flussKontur * B.SVGX_BACH_FAKTOR,
	`auch die Kontur ist halbiert (${bachKontur} gegen ${flussKontur})`);
// ⚠️ Und sie bleibt eine Kontur: schrumpfte sie auf die Linienbreite, waere vom Saum nichts
// mehr uebrig und der Bach saehe konturlos aus.
assert.ok(bachKontur > bachLinie, "der Saum des Baches ist noch da");

// Dieselbe Zahl reist als `avm:mantel_breite` mit -- die Bild-Pipeline liest sie, auch wenn
// hier gar keine Kontur gezeichnet wird.
const mantel = /avm:type="Bach"[^>]*avm:mantel_breite="([0-9.]+)"/.exec(mitBach.text);
assert.ok(mantel, "der Bach nennt seine Mantelbreite");
assert.strictEqual(Number(mantel[1]), bachKontur, "und zwar dieselbe, die er gezeichnet haette");

// ---- 3. Er liegt unter dem See, wie jeder Fluss ----------------------------------------
// 🔴 „Fluesse unter Seen" (Owner 15.08.2026). Faellt der Bach aus dieser Weiche, ist er die
// einzige Gewaesserlinie, die UEBER dem Wasser laeuft.
const bachAn = mitBach.text.indexOf('avm:type="Bach"');
const seeAn = mitBach.text.indexOf('avm:type="see"');
assert.ok(bachAn >= 0 && seeAn >= 0 && bachAn < seeAn, "der Bach wird vor der Wasserflaeche gezeichnet");
assert.ok(mitBach.detail.some((d) => d.layer === "Landschaften" && d.count === 1
	&& /Bach|Bäche/.test(d.group)), "und das Zaehlwerk sagt es auch: " + JSON.stringify(mitBach.detail));

// ---- 4. Strikt gelesen -----------------------------------------------------------------
// ⚠️ `=== true`, wie in pathIstBach und im Router. Eine grosszuegigere Lesart machte aus
// einem Fluss mit krummem Feld einen Bach.
[false, "1", 1, null, undefined].forEach((wert) => {
	const f = { properties: { public_id: "px", feature_type: "path", feature_subtype: "Flussweg",
		is_bach: wert, name: "Krumm" }, geometry: { type: "LineString", coordinates: [[10, 10], [20, 20]] } };
	assert.strictEqual(zaehle(baue([f]).text, /avm:type="Bach"/g), 0,
		`is_bach=${JSON.stringify(wert)} ist kein Bach`);
});
// 🔴 NUR AN EINEM FLUSSWEG -- an einer Strasse hat das Haekchen keine Bedeutung, und der
// Server verwirft es dort ohnehin (avesmapsPathIstBach).
const strasseMitHaken = { properties: { public_id: "ps", feature_type: "path",
	feature_subtype: "Strasse", is_bach: true, name: "Reichsstrasse 2" },
	geometry: { type: "LineString", coordinates: [[10, 10], [20, 20]] } };
const mitStrasse = baue([strasseMitHaken]).text;
assert.strictEqual(zaehle(mitStrasse, /avm:type="Bach"/g), 0, "eine Strasse wird kein Bach");
assert.strictEqual(zaehle(mitStrasse, /avm:type="Strasse"/g), 1, "sie bleibt eine Strasse");

// ---- 5. Farbe und Vokabular -------------------------------------------------------------
// 💣 Ohne eigenen Eintrag faellt eine unbekannte Wegart auf das Rueckfall-Grau #888888 --
// der Bach waere grau, und niemand suchte den Fehler in einer Farbtabelle.
assert.ok(B.SVGX_WAY_COLORS.Bach, "der Bach hat eine eigene Farbe");
assert.strictEqual(B.SVGX_WAY_COLORS.Bach, B.SVGX_WAY_COLORS.Flussweg, "und es ist die des Flusses");
assert.strictEqual(F.svgxFarbeVorgabe("wege/Bach", () => "", B.SVGX_WAY_COLORS, ""),
	F.svgxFarbeVorgabe("wege/Flussweg", () => "", B.SVGX_WAY_COLORS, ""),
	"auch die Owner-Vorgabe des Abzugs behandelt ihn wie einen Fluss");
// Eine Datei, die sich selbst erklaert, darf keine Vokabel benutzen, die sie nicht fuehrt.
assert.ok(B.SVGX_TYPE_VOCAB.Bach && B.SVGX_TYPE_VOCAB.Bach.de && B.SVGX_TYPE_VOCAB.Bach.en,
	"das Vokabular kennt den Bach");
assert.ok(mitBach.text.includes(B.SVGX_TYPE_VOCAB.Bach.de),
	"und der Kopf der Datei fuehrt ihn wirklich auf");
assert.ok(B.SVGX_WAY_SUBTYPES.includes("Bach"), "er steht in der Artenliste des Exports");

// ---- 6. Die Exportseite laesst ihn abwaehlen -------------------------------------------
// ⚠️ Zeilenendenneutral gelesen: hier CRLF, in der CI LF.
const seite = fs.readFileSync(path.join(WURZEL, "edit", "svg-export.php"), "utf8")
	.replace(/\r\n/g, "\n");
assert.ok(/'key'\s*=>\s*'Bach'/.test(seite),
	"die Seite fuehrt ein Kaestchen fuer die Baeche -- sonst ist die einzige Wegart ohne Schalter");

console.log("svg-export-bach.test.js: alles gruen");
