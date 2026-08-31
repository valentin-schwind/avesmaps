const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Was passiert, wenn in der Datenbank etwas anderes steht als erwartet.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4.4
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

const VORGABE = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;

// ---- A. Nichts gespeichert = reine Vorgabe ----------------------------------------------------
[null, undefined, "kaputt", 42, [], { marker: "kaputt" }].forEach((muell) => {
	const tafel = avesmapsResolveLocationZoomBands(muell);
	assert.deepStrictEqual(tafel.marker.dorf, VORGABE.marker.dorf,
		`kaputter Speicherwert (${JSON.stringify(muell)}) ergibt die Vorgabe`);
	assert.deepStrictEqual(tafel.label.metropole, VORGABE.label.metropole);
});

// ---- B. `null` ist eine AUSSAGE, `fehlt` ist ein Nichtwissen ----------------------------------
// 💣 Der Kern. Ein `null` blendet aus; eine fehlende Zelle nimmt die Vorgabe.
const ausgeblendet = avesmapsResolveLocationZoomBands({
	marker: { metropole: [null, null, 13.3, 18.81, 26.6, 37.62, 53.2, 53.2] },
});
assert.strictEqual(ausgeblendet.marker.metropole[0], null, "z0 ist ausgeblendet");
assert.strictEqual(ausgeblendet.marker.metropole[1], null, "z1 ist ausgeblendet");
assert.strictEqual(ausgeblendet.marker.metropole[2], 13.3, "ab z2 wieder da");

const luecke = avesmapsResolveLocationZoomBands({ marker: { metropole: [] } });
assert.deepStrictEqual(luecke.marker.metropole, VORGABE.marker.metropole,
	"eine leere Liste ist kein Ausblenden, sondern ein Nichtwissen");

// ---- C. Kein Loch: ab der ersten gefüllten Zelle erbt jede leere den letzten Wert -------------
const mitLoch = avesmapsResolveLocationZoomBands({
	marker: { stadt: [1.33, 2.26, null, null, 11.07, 18.79, 31.92, 31.92] },
});
assert.strictEqual(mitLoch.marker.stadt[2], 2.26, "z2 erbt z1 statt zu verschwinden");
assert.strictEqual(mitLoch.marker.stadt[3], 2.26, "z3 ebenso");
assert.strictEqual(mitLoch.marker.stadt[4], 11.07, "danach gilt wieder der eigene Wert");
assert.ok(mitLoch.marker.stadt.every((wert, index) => index === 0 || wert !== null || mitLoch.marker.stadt[index - 1] === null),
	"nach einer gefüllten Zelle folgt nie eine leere");

// ---- C2. Rückwärtskompatibilität: eine gespeicherte ACHT-Zellen-Zeile bekommt eine neunte ------
// 💣 Der Fall, an dem diese Änderung am ehesten still danebengeht. Ein Admin, der VOR der
// Erweiterung auf z8 gespeichert hat, hat 8-Zellen-Zeilen in der Datenbank (Index 0..7, keine
// neunte Zelle). Der fehlende Index 8 ist ein NICHTWISSEN (wie jede andere fehlende Zelle auch,
// Block B) -- er nimmt die Vorgabe, NICHT den vom Admin vorwärtsgefüllten Wert von z7. z6/z7
// weichen hier absichtlich von der Vorgabe ab (40 statt 31,92), damit ein Vorwärtsfüllen aus der
// Zeile selbst (Ergebnis 40) von der Vorgabe (Ergebnis 31,92) unterscheidbar wäre.
const achtZellen = avesmapsResolveLocationZoomBands({
	marker: { stadt: [1.33, 2.26, 3.84, 6.52, 11.07, 18.79, 40, 40] },
});
assert.strictEqual(achtZellen.marker.stadt.length, 9, "aus acht Zellen werden neun");
assert.strictEqual(achtZellen.marker.stadt[7], 40, "die gespeicherten acht Zellen bleiben wie geschrieben");
assert.strictEqual(achtZellen.marker.stadt[8], VORGABE.marker.stadt[8],
	"der fehlende Index 8 ist ein Nichtwissen -> Vorgabe (31,92), nicht der Admin-Wert 40 von z7");

// ---- D. Schranken ----------------------------------------------------------------------------
const ausserhalb = avesmapsResolveLocationZoomBands({
	marker: { dorf: [null, null, 0.1, 2.54, 4.86, 9.28, 999, 17.74] },
	label: { dorf: [null, null, null, null, 1, 11, 11, 500] },
});
assert.strictEqual(ausserhalb.marker.dorf[2], VORGABE.marker.dorf[2], "0,1 px ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.marker.dorf[6], VORGABE.marker.dorf[6], "999 px ist zu groß -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[4], VORGABE.label.dorf[4], "1 pt ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[7], VORGABE.label.dorf[7], "500 pt ist zu groß -> Vorgabe");

// 💣 DIE VERENGTE OBERGRENZE, SCHARF GEPRÜFT. 999 px und 500 pt lagen auch VOR der Verengung
// (200 px / 96 pt) schon außerhalb -- diese zwei Werte allein würden eine vergessene Verengung
// nicht bemerken. 150 px und 50 pt liegen dagegen GENAU in der Lücke: früher gültig (< 200 / < 96),
// jetzt nicht mehr (> 100 / > 30). Nur diese Zeilen weisen nach, dass die neue Grenze wirklich greift.
const verengt = avesmapsResolveLocationZoomBands({
	marker: { dorf: [null, null, 150, 2.54, 4.86, 9.28, 17.74, 17.74] },
	label: { dorf: [null, null, null, null, 50, 11, 11, 11] },
});
assert.strictEqual(verengt.marker.dorf[2], VORGABE.marker.dorf[2],
	"150 px war vor der Verengung gültig (< 200), jetzt nicht mehr (> 100) -> Vorgabe");
assert.strictEqual(verengt.label.dorf[4], VORGABE.label.dorf[4],
	"50 pt war vor der Verengung gültig (< 96), jetzt nicht mehr (> 30) -> Vorgabe");
// Die neue Obergrenze selbst ist einschließlich (<=), nicht ausschließlich.
const anDerGrenze = avesmapsResolveLocationZoomBands({
	marker: { dorf: [null, null, 100, 2.54, 4.86, 9.28, 17.74, 17.74] },
	label: { dorf: [null, null, null, null, 30, 11, 11, 11] },
});
assert.strictEqual(anDerGrenze.marker.dorf[2], 100, "genau 100 px ist noch gültig");
assert.strictEqual(anDerGrenze.label.dorf[4], 30, "genau 30 pt ist noch gültig");

// Nicht-Zahlen ebenso.
const unfug = avesmapsResolveLocationZoomBands({ label: { metropole: ["12", NaN, Infinity, {}, 17, 19, 19, 19] } });
[0, 1, 2, 3].forEach((z) => {
	assert.strictEqual(unfug.label.metropole[z], VORGABE.label.metropole[z],
		`z${z}: keine endliche Zahl -> Vorgabe`);
});

// ---- E. Unbekannte Klasse wird ignoriert ------------------------------------------------------
const fremd = avesmapsResolveLocationZoomBands({ marker: { hauptstadt: [5, 5, 5, 5, 5, 5, 5, 5] } });
assert.strictEqual(fremd.marker.hauptstadt, undefined, "der Browser führt die Klassenliste");
// 🔴 ABGELEITET, nicht gezählt: hier stand `6`, und die siebte Ortsklasse (stadtviertel,
// 31.08.2026) hat die Zeile umgeworfen, obwohl an der geprüften REGEL nichts falsch war.
assert.strictEqual(Object.keys(fremd.marker).length, Object.keys(VORGABE.marker).length,
	"es bleiben genau die Klassen der Vorgabetafel -- nicht mehr und nicht weniger");

// ---- F. Zugriff, Rundung und Klemmung ---------------------------------------------------------
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4), VORGABE.marker.dorf[4]);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.4), VORGABE.marker.dorf[4],
	"4,4 rundet auf 4 -- der Zeichner rundet ebenso");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.6), VORGABE.marker.dorf[5],
	"4,6 rundet auf 5");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 99), VORGABE.marker.dorf[8],
	"über z8 wird geklemmt");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", -3), VORGABE.marker.dorf[0],
	"unter z0 wird geklemmt -- und dort steht null");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "unbekannt", 4), null);
assert.strictEqual(avesmapsLocationZoomBandMinZoom("marker", "unbekannt"), null);

// ---- G. Anwenden meldet, OB sich etwas geändert hat -------------------------------------------
// Der Boot-Leser zeichnet nur dann nach -- ein bedingungsloses Neuzeichnen kostet bei jedem
// Seitenstart einen vollen Sichtbarkeits-Durchlauf umsonst.
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsApplyLocationZoomBands(null), false, "Vorgabe auf Vorgabe ändert nichts");
assert.strictEqual(avesmapsApplyLocationZoomBands({ label: { dorf: [null, null, null, null, 14, 14, 14, 14] } }), true,
	"eine echte Übersteuerung meldet sich");
assert.strictEqual(avesmapsLocationZoomBandValue("label", "dorf", 4), 14);
avesmapsApplyLocationZoomBands(null); // Zustand für nachfolgende Tests zurücksetzen

console.log("zoombaender-zusammenfuehrung: alle Zusicherungen erfüllt");
