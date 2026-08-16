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

// ---- D. Schranken ----------------------------------------------------------------------------
const ausserhalb = avesmapsResolveLocationZoomBands({
	marker: { dorf: [null, null, 0.1, 2.54, 4.86, 9.28, 999, 17.74] },
	label: { dorf: [null, null, null, null, 1, 11, 11, 500] },
});
assert.strictEqual(ausserhalb.marker.dorf[2], VORGABE.marker.dorf[2], "0,1 px ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.marker.dorf[6], VORGABE.marker.dorf[6], "999 px ist zu groß -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[4], VORGABE.label.dorf[4], "1 pt ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[7], VORGABE.label.dorf[7], "500 pt ist zu groß -> Vorgabe");

// Nicht-Zahlen ebenso.
const unfug = avesmapsResolveLocationZoomBands({ label: { metropole: ["12", NaN, Infinity, {}, 17, 19, 19, 19] } });
[0, 1, 2, 3].forEach((z) => {
	assert.strictEqual(unfug.label.metropole[z], VORGABE.label.metropole[z],
		`z${z}: keine endliche Zahl -> Vorgabe`);
});

// ---- E. Unbekannte Klasse wird ignoriert ------------------------------------------------------
const fremd = avesmapsResolveLocationZoomBands({ marker: { hauptstadt: [5, 5, 5, 5, 5, 5, 5, 5] } });
assert.strictEqual(fremd.marker.hauptstadt, undefined, "der Browser führt die Klassenliste");
assert.strictEqual(Object.keys(fremd.marker).length, 6, "es bleiben sechs Klassen");

// ---- F. Zugriff, Rundung und Klemmung ---------------------------------------------------------
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4), VORGABE.marker.dorf[4]);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.4), VORGABE.marker.dorf[4],
	"4,4 rundet auf 4 -- der Zeichner rundet ebenso");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.6), VORGABE.marker.dorf[5],
	"4,6 rundet auf 5");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 99), VORGABE.marker.dorf[7],
	"über z7 wird geklemmt");
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
