const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Deckel „Max. Drift" (22.08.2026, Owner: „den maximalen versatz, den ein label zur vermeidung
// einer kollision geht ... will ich begrenzen bis sie verschwinden").
//
// 🔴 DRIFT IST DIE LUFTLINIE VON DER NORMALSTELLUNG zur Ausweichstelle -- waagerecht wie senkrecht.
//
// 🪤 EINEN TAG LANG ZÄHLTE NUR DER SENKRECHTE ANTEIL, mit der Begründung, ein Seitenwechsel „klebe
// ja weiter am Punkt". Am Bildschirm stimmt das nicht: der Owner hat es an „Nordhag (Weiden)"
// gezeigt -- bei z6 steht der Name rechts am Punkt, bei z4 springt er nach links, und sein Anfang
// liegt dann 170 px vom Punkt entfernt. Genau das ist das „zu weit weg", das der Regler verhindern
// soll. Diese Datei nagelt das richtige Maß fest, damit das falsche nicht zurückkommt.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-drift.test.js

// ---- Stubs: der Kollisionslöser ist Browser-Code -------------------------------------------------
// getLocationNameLabelBaseOffset liest die CSS-Variablen des Label-Knotens. Mehr braucht
// getLocationNameLabelOffsets nicht -- es rechnet rein.
const BASIS_X = 14;   // = Marker-Radius + Spalt, wie --location-label-offset-x sie trägt
globalThis.window = {
	getComputedStyle: () => ({
		getPropertyValue: (name) => (name === "--location-label-offset-x" ? String(BASIS_X) : "0"),
	}),
};
globalThis.LOCATION_LABEL_GAP = 11;
globalThis.location = { search: "" };

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);
// 🔴 Das reine Fundament ZUERST -- der Kollisionsloeser ruft es nur noch.
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../label-placement.js"), "utf8"),
	{ filename: "label-placement.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../map-features-label-collisions.js"), "utf8"),
	{ filename: "map-features-label-collisions.js" }
);

const VORGABE = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;
const elementStub = { querySelector: (sel) => (sel === "img" ? {} : null) };

function stellen(labelHeight) {
	return getLocationNameLabelOffsets(elementStub, { width: 99, height: labelHeight });
}
function driftVon(labelHeight) {
	const map = {};
	stellen(labelHeight).forEach((s) => { map[s.name] = Math.round(s.drift * 100) / 100; });
	return map;
}

// ---- A. Der Drift jeder der zwölf Stellen, bei Breite 99 / Höhe 22 / Versatz 8 ------------------
avesmapsApplyLocationZoomBands(null);
const d = driftVon(22);

assert.strictEqual(d.right, 0, "die Normalstellung driftet nicht -- sie IST der Nullpunkt");
assert.strictEqual(d["right-up"], 8, "kleiner Schritt hoch: der Versatz");
assert.strictEqual(d["right-down"], 8, "kleiner Schritt runter: der Versatz");
assert.strictEqual(d["top-right"], 30, "eine Zeile hoch: Hoehe + Versatz");
assert.strictEqual(d["bottom-right"], 30, "eine Zeile runter: Hoehe + Versatz");

// 💣 DER SEITENWECHSEL IST DER GROSSE. Er rueckt den Namen um seine EIGENE BREITE weg -- hier
// 99 + 2 x 14 = 127. Genau diesen Fall hat der Owner am 22.08.2026 an „Nordhag (Weiden)" gezeigt:
// bei z6 steht der Name rechts am Punkt („normal"), bei z4 springt er nach links und sein Anfang
// liegt 170 px vom Punkt entfernt („zu weit weg"). Ein Maß, das nur senkrecht zaehlt, gibt hier 0
// zurueck und kann das sichtbarste Wegruecken nicht verhindern -- diese Zusicherung haelt das fest.
assert.strictEqual(d.left, 127, "Seitenwechsel: eigene Breite plus zweimal der Spalt");
assert.strictEqual(d["left-up"], 127.25, "Seitenwechsel mit kleinem Schritt");
assert.strictEqual(d["top-left"], 130.5, "Seitenwechsel und eine Zeile hoch");
assert.ok(d.top > 70 && d.top < 80, `mittig darueber liegt dazwischen (${d.top})`);
assert.ok(d.bottom > 60 && d.bottom < 70, `mittig darunter liegt dazwischen (${d.bottom})`);

// 🔴 UND DIE ORDNUNG IST DAS EIGENTLICHE VERSPRECHEN: senkrechtes Ausweichen ist billig, der
// Seitenwechsel teuer. Nur so kann ein mittlerer Deckel das eine erlauben und das andere verbieten.
assert.ok(d["top-right"] < d.bottom && d.bottom < d.left,
	"Zeile hoch < mittig drunter < Seitenwechsel -- daran haengt der ganze Regler");

// ---- B. Der Drift waechst mit der BREITE, nicht nur mit der Hoehe --------------------------------
// 💣 Die Umkehrung des alten, falschen Masses: dort war die Breite bedeutungslos.
const breit = getLocationNameLabelOffsets(elementStub, { width: 400, height: 22 });
assert.strictEqual(breit.find((s2) => s2.name === "left").drift, 428,
	"ein viermal so breiter Name rueckt beim Seitenwechsel viermal so weit weg");
assert.strictEqual(breit.find((s2) => s2.name === "right").drift, 0,
	"seine Normalstellung bleibt der Nullpunkt");
assert.strictEqual(driftVon(40)["top-right"], 48, "und die Hoehe zaehlt weiterhin (40 + 8)");

// ---- C. Ein mittlerer Deckel trennt genau die beiden Familien -------------------------------------
const DECKEL = 60;
const erlaubt = stellen(22).filter((s2) => s2.drift <= DECKEL).map((s2) => s2.name);
assert.deepStrictEqual(erlaubt, ["right", "right-up", "right-down", "top-right", "bottom-right"],
	"bei Deckel 60 bleibt das senkrechte Ausweichen, der Seitenwechsel faellt weg");

// ---- D. Die Vorgabe darf NICHTS wegschneiden ------------------------------------------------------
// 💣 Der groesste ueber den Bestand erreichbare Drift ist der Seitenwechsel des laengsten Namens je
// Ortsklasse in DEREN groesster Schrift: live ueber alle 2882 Namen gemessen 287 px
// („Firun-Tempel unter dem Haengenden Gletscher"). Die Vorgabe muss darueber liegen.
const GEMESSENES_MAXIMUM = 287;
assert.ok(VORGABE.abstaende.drift > GEMESSENES_MAXIMUM,
	`die Vorgabe (${VORGABE.abstaende.drift}) liegt ueber dem gemessenen Maximum (${GEMESSENES_MAXIMUM})`);
// ⚠️ Und nicht viel darueber: sonst waere der halbe Reglerweg wirkungslos -- genau der Befund, der
// diesen Umbau ausgeloest hat.
assert.ok(VORGABE.abstaende.drift < GEMESSENES_MAXIMUM * 1.5,
	"aber nicht so weit darueber, dass der Regler auf halbem Weg nichts tut");
assert.ok(AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS.max >= VORGABE.abstaende.drift,
	"und die Schranke laesst die Vorgabe ueberhaupt zu");

// ---- E. Eigene Schranke je Schluessel -------------------------------------------------------------
assert.strictEqual(avesmapsLocationLabelSpacingLimits("drift").max, 300, "drift darf bis 300");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("spalt").max, 20, "die anderen bleiben bei 20");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("versatz").max, 20);
// 💣 Ohne eigene Schranke waere jeder Deckel ueber 20 als "ausserhalb" auf die Vorgabe
// zurueckgefallen -- lautlos, und der Regler haette auf dem groessten Teil seines Weges nichts getan.
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 60 } }).abstaende.drift, 60,
	"ein Deckel von 60 wird uebernommen, nicht verworfen");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 301 } }).abstaende.drift,
	VORGABE.abstaende.drift, "ueber 300 -> Vorgabe");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 0 } }).abstaende.drift, 0,
	"0 ist gueltig -- 'bleibt auf der Normalstellung' ist eine Einstellung, kein Nichtwissen");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { spalt: 60 } }).abstaende.spalt,
	VORGABE.abstaende.spalt, "und spalt erbt die weite Schranke NICHT");

// ---- F. Verdrahtung: der Deckel wird auch wirklich angewandt --------------------------------------
// 💣 Ein gruener Rechentest beweist nichts, solange niemand den Wert liest (Hausregel). Diese
// Haelfte prueft, dass der Loeser ihn holt und Kandidaten damit ueberspringt.
const loeser = fs.readFileSync(path.join(__dirname, "../label-placement.js"), "utf8");
assert.ok(/avesmapsLabelSpacingOf\(opts\.abstaende, "drift"\)/.test(loeser),
	"avesmapsResolveLabelPlacements liest den Deckel");
assert.ok(/if \(relativ && typeof kandidat\.drift === "number" && kandidat\.drift > maxDrift\) \{\s*\n\s*continue;/.test(loeser),
	"und ueberspringt jede Stelle darueber -- nur bei relativen (Orts-)Kandidaten");
const karte = fs.readFileSync(path.join(__dirname, "../map-features-label-collisions.js"), "utf8");
assert.ok(/avesmapsResolveLabelPlacements\(/.test(karte),
	"und die Karte ruft genau diesen Loeser, statt einen eigenen zu fahren");
// ⚠️ Der Deckel darf NICHT in getLocationNameLabelOffsets filtern: candidates[0] traegt den
// Rueckfall fuer das ausgeblendete Label, und eine gekuerzte Liste haette dort ein Loch.
assert.strictEqual(stellen(22).length, 12, "die Liste bleibt zwoelf Stellen lang, gefiltert wird im Loeser");
assert.strictEqual(stellen(22)[0].name, "right", "und die Grundstellung bleibt die erste");
assert.strictEqual(stellen(22)[0].drift, 0, "sie driftet nie -- der Rueckfall ist damit immer erlaubt");

// ---- G. Verdrahtung im Fenster --------------------------------------------------------------------
const dialog = fs.readFileSync(path.join(__dirname, "../../../html/wiki-sync-settlement-editor.html"), "utf8");
assert.ok(/ZOOM_BAND_SPACING_KEYS = \["spalt", "repel", "versatz", "drift"\]/.test(dialog),
	"der Schluessel steht in der Liste des Fensters -- Laden, Speichern und Zuruecksetzen laufen darueber");
["zbDriftRange", "zbDriftInput", "zbDriftReset"].forEach((id) => {
	assert.ok(dialog.includes(`id="${id}"`), `${id} steht im Markup`);
	assert.ok(dialog.includes(`$("${id}")`), `${id} wird auch gelesen`);
});
assert.ok(/zoomBandSpacingLimits\(key\)/.test(dialog),
	"die Schranke wird JE SCHLUESSEL geholt -- sonst klemmte das Fenster den Deckel bei 20 ab");

console.log("zoombaender-drift: alle Zusicherungen erfuellt");
