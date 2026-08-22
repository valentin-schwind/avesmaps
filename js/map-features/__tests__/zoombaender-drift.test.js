const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Deckel „Max. Drift" (22.08.2026, Owner: „den maximalen versatz, den ein label zur vermeidung
// einer kollision geht ... will ich begrenzen bis sie verschwinden").
//
// 🔴 DRIFT IST DER SENKRECHTE SPALT zwischen der Markermitte und dem Namenskasten -- NICHT der
// Abstand zur Grundstellung. Bei `dy = 0` liegt der Kasten senkrecht mittig auf dem Marker (live
// gemessen: Marker bei y=359, Kasten 345..373), er überdeckt den Punkt also, und das ist Drift 0.
//
// 💣 WAAGERECHT ZÄHLT NICHT. Ein Seitenwechsel („links") ist kein Drift: der Name klebt weiter am
// Punkt, nur auf der anderen Seite. Der erste Entwurf maß den Abstand zur Grundstellung und kam für
// den Seitenwechsel auf 133 px -- ein Deckel darunter hätte genau das weggeschnitten, was noch
// klebt. Diese Datei nagelt das falsche Maß mit fest, damit es nicht zurückkommt.
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

// ---- A. Der Drift jeder der zwölf Stellen, bei Höhe 22 und Versatz 8 -----------------------------
avesmapsApplyLocationZoomBands(null);
const d = driftVon(22);

// Die sieben Stellen, an denen der Kasten den Punkt noch überdeckt: Drift 0.
// 💣 „links" IST DARUNTER -- der Seitenwechsel klebt. Fällt diese Zusicherung, ist jemand auf das
// Grundstellungs-Maß zurückgefallen, und ein enger Deckel löscht dann den halben Ausweichvorrat.
["right", "right-up", "right-down", "left", "left-up", "left-down"].forEach((name) => {
	assert.strictEqual(d[name], 0, `"${name}" klebt am Punkt -- Drift 0`);
});

// Eine Zeile hoch/runter, gleiche oder andere Seite: der Kasten hebt um (Höhe/2 + Versatz) ab.
["top-right", "bottom-right", "top-left", "bottom-left"].forEach((name) => {
	assert.strictEqual(d[name], 19, `"${name}" hebt um Hoehe/2 + Versatz ab (11 + 8)`);
});

// 🪤 Und die Schieflage, die dabei sichtbar wird: „oben mittig" haelt 30 px Abstand, „unten mittig"
// nur 8 -- `verticalCenterOffset` steckt in der oberen Formel einmal zu viel drin. Das ist der
// BESTAND, nicht der Entwurf; hier festgenagelt, damit die Reparatur auffaellt statt durchzurutschen.
assert.strictEqual(d.top, 30, "oben mittig: Hoehe + Versatz");
assert.strictEqual(d.bottom, 8, "unten mittig: nur der Versatz -- die vorhandene Schieflage");

// ---- B. Der Drift waechst mit der Kastenhoehe, nicht mit der Breite ------------------------------
assert.strictEqual(driftVon(40).top, 48, "groesserer Kasten, groesserer Drift (40 + 8)");
assert.strictEqual(
	getLocationNameLabelOffsets(elementStub, { width: 400, height: 22 }).find((s) => s.name === "left").drift,
	0,
	"ein VIERMAL so breiter Name driftet kein Stueck -- Breite geht den Deckel nichts an"
);

// ---- C. Der Versatz verschiebt den Drift, weil er die Stellen verschiebt -------------------------
avesmapsApplyLocationZoomBands({ abstaende: { versatz: 0 } });
assert.strictEqual(driftVon(22)["top-right"], 11, "ohne Versatz bleibt nur die halbe Kastenhoehe");
avesmapsApplyLocationZoomBands(null);

// ---- D. Die Vorgabe darf NICHTS wegschneiden ------------------------------------------------------
// 💣 Der groesste erreichbare Drift ist `labelHeight + versatz` (Stelle "top"). labelHeight ist die
// Hoehe des gerenderten Label-BILDES samt Halo-Rand: live gemessen an 80 Labels ueber z3/z5/z7
// hoechstens 2,182 px je pt. Der erste Entwurf setzte die Vorgabe auf 80 und lag damit UNTER dem
// Maximum -- beim Ausliefern haette sie Stellen weggeschnitten.
const PX_JE_PT_MAX = 2.182;
const maxLabelHoehe = AVESMAPS_ZOOM_BAND_LIMITS.label.max * PX_JE_PT_MAX;
const maxDrift = maxLabelHoehe + AVESMAPS_LOCATION_LABEL_SPACING_LIMITS.max;
assert.ok(VORGABE.abstaende.drift > maxDrift,
	`die Vorgabe (${VORGABE.abstaende.drift}) liegt ueber dem groessten erreichbaren Drift (${maxDrift.toFixed(1)})`);
assert.ok(AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS.max >= VORGABE.abstaende.drift,
	"und die Schranke laesst die Vorgabe ueberhaupt zu");

// ---- E. Eigene Schranke je Schluessel -------------------------------------------------------------
assert.strictEqual(avesmapsLocationLabelSpacingLimits("drift").max, 90, "drift darf bis 90");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("spalt").max, 20, "die anderen bleiben bei 20");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("versatz").max, 20);
// 💣 Ohne eigene Schranke waere ein Deckel von 100 als "ausserhalb" auf die Vorgabe zurueckgefallen
// -- lautlos, und der Regler haette an seinem oberen Ende nichts getan.
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 60 } }).abstaende.drift, 60,
	"ein Deckel von 60 wird uebernommen, nicht verworfen -- mit der alten 20er-Schranke waere er still gefallen");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 91 } }).abstaende.drift,
	VORGABE.abstaende.drift, "ueber 90 -> Vorgabe");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 0 } }).abstaende.drift, 0,
	"0 ist gueltig -- 'muss den Punkt beruehren' ist eine Einstellung, kein Nichtwissen");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { spalt: 60 } }).abstaende.spalt,
	VORGABE.abstaende.spalt, "und spalt erbt die weite Schranke NICHT");

// ---- F. Verdrahtung: der Deckel wird auch wirklich angewandt --------------------------------------
// 💣 Ein gruener Rechentest beweist nichts, solange niemand den Wert liest (Hausregel). Diese
// Haelfte prueft, dass der Loeser ihn holt und Kandidaten damit ueberspringt.
const loeser = fs.readFileSync(path.join(__dirname, "../map-features-label-collisions.js"), "utf8");
assert.ok(/const maxDrift = avesmapsLocationLabelSpacing\("drift"\)/.test(loeser),
	"resolveLabelCollisions liest den Deckel");
assert.ok(/if \(isLocation && candidate\.drift > maxDrift\) \{\s*\n\s*continue;/.test(loeser),
	"und ueberspringt jede Stelle darueber -- nur bei Siedlungen");
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
