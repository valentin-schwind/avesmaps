const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Deckel „Max. Drift" (22.08.2026, Owner: „den maximalen versatz, den ein label zur vermeidung
// einer kollision geht ... will ich begrenzen bis sie verschwinden").
//
// 🔴 DRIFT IST DIE LUFTLINIE VON DER NORMALSTELLUNG zur Ausweichstelle -- waagerecht wie senkrecht,
// 🔴 MIT EINER AUSNAHME: DER SEITENWECHSEL NACH LINKS ZAHLT NUR SEINEN SENKRECHTEN ANTEIL
// (Owner 24.08.2026: „nach links ist automatisch" -- kein eigenes Bedienelement).
//
// 🪤 DIE DATEI HAT DAS MASS SCHON ZWEIMAL FESTGENAGELT, UND BEIDE MALE ZU GROB:
//   22.08. früh  nur senkrecht  -> auch „mittig über dem Punkt" war gratis, obwohl der Name dort
//                                  wirklich wegrückt („Nordhag (Weiden)", Anfang 84 px daneben).
//   22.08. spät  volle Luftlinie -> auch der Seitenwechsel bezahlte die eigene Namensbreite
//                                  (78-203 px) und war bei jedem vernünftigen Deckel gesperrt.
// Am gespeicherten Stand (Deckel 25) blieben davon drei von zwölf Stellen übrig: „Burginum"
// verschwand neben seinem Nachbarn, statt auf die freie Seite zu rücken.
//
// 🔴 DIE UNTERSCHEIDUNG, DIE BEIDE FASSUNGEN VERFEHLT HABEN: ein Name LINKS vom Punkt klebt so am
// Punkt wie einer rechts davon -- seine zugewandte Kante liegt in beiden Fällen `scaledGap`
// daneben. Ein Name MITTIG ÜBER dem Punkt rückt wirklich weg. Deshalb ist der Seitenwechsel gratis
// und `top`/`bottom` sind es nicht. Diese Datei nagelt genau diese Trennung fest.
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

// 💣 DER SEITENWECHSEL IST GRATIS -- jede Links-Stelle kostet GENAU SO VIEL wie ihre Entsprechung
// rechts. Das ist die Zusicherung, wegen der „Burginum" wieder neben seinem Punkt steht, statt zu
// verschwinden: bei Deckel 25 (dem gespeicherten Stand) waere er mit der vollen Luftlinie (127)
// gesperrt gewesen. Wer die volle Luftlinie zurueckholt, bricht hier vier Zeilen auf einmal.
assert.strictEqual(d.left, d.right, "Seitenwechsel allein kostet nichts -- wie die Normalstellung");
assert.strictEqual(d["left-up"], d["right-up"], "Seitenwechsel mit kleinem Schritt: nur der Schritt");
assert.strictEqual(d["left-down"], d["right-down"], "dasselbe nach unten");
assert.strictEqual(d["top-left"], d["top-right"], "Seitenwechsel und eine Zeile hoch: nur die Zeile");
assert.strictEqual(d["bottom-left"], d["bottom-right"], "dasselbe nach unten");
assert.strictEqual(d.left, 0, "und in Zahlen: der Seitenwechsel ist der Nullpunkt, wie rechts");

// 💣 UND MITTIG UEBER/UNTER DEM PUNKT IST ES NICHT. Dort rueckt der Name wirklich weg -- das war
// der Abnahmefall „Nordhag (Weiden)" (Entwurf §3: steht mittig ueber dem Punkt, Anfang 84 px
// daneben). Diese beiden Stellen tragen weiterhin die volle Luftlinie, waagerecht wie senkrecht.
assert.ok(d.top > 70 && d.top < 80, `mittig darueber rueckt weg (${d.top})`);
assert.ok(d.bottom > 60 && d.bottom < 70, `mittig darunter rueckt weg (${d.bottom})`);

// 🔴 UND DIE ORDNUNG IST DAS EIGENTLICHE VERSPRECHEN: neben dem Punkt bleiben ist billig -- auf
// welcher Seite, ist gleichgueltig --, sich mittig darueberzuschieben ist teuer. Nur so kann ein
// mittlerer Deckel das eine erlauben und das andere verbieten.
assert.ok(d["top-left"] < d.bottom && d.bottom < d.top,
	"Zeile hoch (links wie rechts) < mittig drunter < mittig drueber -- daran haengt der Regler");

// ---- B. Die BREITE zaehlt weiterhin -- aber nur, wo sie den Namen wirklich wegrueckt -------------
// 💣 Die Grenze zwischen den beiden Maßen, an einem viermal so breiten Namen:
const breit = getLocationNameLabelOffsets(elementStub, { width: 400, height: 22 });
assert.strictEqual(breit.find((s2) => s2.name === "left").drift, 0,
	"auch ein viermal so breiter Name klebt beim Seitenwechsel am Punkt");
assert.ok(breit.find((s2) => s2.name === "top").drift > 200,
	"mittig darueber dagegen rueckt er viermal so weit weg");
assert.strictEqual(breit.find((s2) => s2.name === "right").drift, 0,
	"seine Normalstellung bleibt der Nullpunkt");
assert.strictEqual(driftVon(40)["top-right"], 48, "und die Hoehe zaehlt weiterhin (40 + 8)");

// ---- C. Zwei Deckel, zwei verschiedene Familien ---------------------------------------------------
// 🔴 Der gespeicherte Stand des Owners (25): neben dem Punkt bleiben, beide Seiten, kleiner Schritt.
const bei25 = stellen(22).filter((s2) => s2.drift <= 25).map((s2) => s2.name);
assert.deepStrictEqual(bei25, ["right", "right-up", "right-down", "left", "left-up", "left-down"],
	"bei Deckel 25 stehen beide Seiten offen -- genau das war vom 22. bis 24.08.2026 verloren");
// Und ein mittlerer Deckel laesst zusaetzlich die Zeilenspruenge zu, sperrt aber die Mitte.
const bei60 = stellen(22).filter((s2) => s2.drift <= 60).map((s2) => s2.name);
assert.ok(!bei60.includes("top") && !bei60.includes("bottom"),
	"bei Deckel 60 bleibt die mittige Stelle ueber/unter dem Punkt gesperrt");
assert.ok(bei60.includes("top-left") && bei60.includes("bottom-right"),
	"die Zeilenspruenge sind dann erlaubt -- auf beiden Seiten");

// ---- D. Die Vorgabe darf NICHTS wegschneiden ------------------------------------------------------
// 💣 SEIT DEM 24.08.2026 IST DER GROESSTE ERREICHBARE DRIFT EIN ANDERER. Er war der Seitenwechsel
// des laengsten Namens je Ortsklasse in DEREN groesster Schrift -- live ueber alle 2882 Namen
// gemessen 287 px („Firun-Tempel unter dem Haengenden Gletscher"). Der ist jetzt gratis; den
// Ausschlag gibt die mittige Stelle ueber dem Punkt.
//
// ⭐ IHR WAAGERECHTER ANTEIL IST GENAU DIE HAELFTE DES ALTEN SEITENWECHSELS -- keine Schaetzung,
// sondern Algebra: der Seitenwechsel rueckt um `labelWidth + 2 x spalt`, die Mitte um
// `labelWidth / 2 + spalt`. Die naechsten zwei Zeilen rechnen es an zwei Breiten nach, damit die
// Herleitung nicht bloss als Kommentar dasteht.
// ⚠️ Gemessen an den dx der Stellen, nicht am Drift: der Drift der Mitte traegt einen senkrechten
// Anteil mit, den diese Herleitung gar nicht betrifft.
[99, 400].forEach((w) => {
	const s = getLocationNameLabelOffsets(elementStub, { width: w, height: 22 });
	const dxVon = (name) => s.find((x) => x.name === name).dx;
	const alterSeitenwechsel = Math.abs(dxVon("left") - dxVon("right"));
	const mitte = Math.abs(dxVon("top") - dxVon("right"));
	assert.strictEqual(mitte, alterSeitenwechsel / 2,
		`Breite ${w}: die Mitte rueckt halb so weit wie der alte Seitenwechsel (${mitte} vs ${alterSeitenwechsel / 2})`);
});
// Daraus das erreichbare Maximum, HERGELEITET aus der Live-Messung von 22.08. (nicht neu gemessen,
// und deshalb hier mit seinen Eingangswerten aufgeschrieben): laengster Name je Ortsklasse in DEREN
// groesster Schrift -> alter Seitenwechsel 287 px = Textbreite + zweimal der Spalt (bei einem
// Gebaeude auf z6: 266 + 21). Waagerecht bleibt davon 266/2 + 10 = 143, senkrecht kommt
// 0,969 x Hoehe + Versatz = rund 20 dazu -> hypot(143, 20) = rund 145.
const GEMESSENES_MAXIMUM = 145;
assert.ok(VORGABE.abstaende.drift > GEMESSENES_MAXIMUM,
	`die Vorgabe (${VORGABE.abstaende.drift}) liegt ueber dem erreichbaren Maximum (${GEMESSENES_MAXIMUM})`);
// ⚠️ Und nicht viel darueber: sonst waere ein Teil des Reglerwegs wirkungslos -- genau der Befund,
// der diesen Umbau ausgeloest hat. Die Spanne stand bis 24.08.2026 auf 0-300 und deckte damit nach
// dem Halbieren das Doppelte des Erreichbaren; Owner: „die ausweichgrenze kannst du auf 150
// reduzieren, selbst das ist noch zu viel."
assert.ok(VORGABE.abstaende.drift < GEMESSENES_MAXIMUM * 1.5,
	"aber nicht so weit darueber, dass der Regler auf einem Teil seines Weges nichts tut");
assert.ok(AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS.max >= VORGABE.abstaende.drift,
	"und die Schranke laesst die Vorgabe ueberhaupt zu");

// ---- E. Eigene Schranke je Schluessel -------------------------------------------------------------
assert.strictEqual(avesmapsLocationLabelSpacingLimits("drift").max, 150, "drift darf bis 150");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("spalt").max, 20, "die anderen bleiben bei 20");
assert.strictEqual(avesmapsLocationLabelSpacingLimits("versatz").max, 20);
// 💣 Ohne eigene Schranke waere jeder Deckel ueber 20 als "ausserhalb" auf die Vorgabe
// zurueckgefallen -- lautlos, und der Regler haette auf dem groessten Teil seines Weges nichts getan.
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 60 } }).abstaende.drift, 60,
	"ein Deckel von 60 wird uebernommen, nicht verworfen");
assert.strictEqual(avesmapsResolveLocationZoomBands({ abstaende: { drift: 151 } }).abstaende.drift,
	VORGABE.abstaende.drift, "ueber 150 -> Vorgabe");
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
