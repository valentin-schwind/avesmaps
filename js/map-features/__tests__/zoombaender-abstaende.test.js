const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Aufgabe 8b: die drei globalen Abstandsregler (Spalt, Repel, Versatz).
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md
//
// 🔴 GLOBAL heißt: EIN Wert für alle Ortsklassen und Zoomstufen -- anders als marker/label gibt es
// hier keine Zeile, keine Erscheinungsstufe und kein `null` = "hier nicht". Ein Abstand ist immer
// eine Zahl; fehlend/unbrauchbar/außerhalb der Schranke fällt auf die Vorgabe zurück (dieselbe Regel
// wie Punkt 4 bei den Zellen, nur ohne die Loch-Regel, die es hier nicht braucht).
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-abstaende.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

const VORGABE = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;

// ---- A. Die Vorgabewerte sind die heutigen Konstanten, zifferngenau -----------------------------
// LOCATION_NAME_LABEL_GAP (map-features-location-name-labels.js) = 4, LOCATION_LABEL_COLLISION_PADDING
// (map-features.js) = 2, LOCATION_LABEL_SHIFT_SMALL (map-features.js) = 8.
// 🔴 22.08.2026 -- "drift" kam als VIERTER dazu (Deckel auf den senkrechten Spalt zum eigenen
// Punkt). Er hatte vorher keine Konstante, weil es keinen Deckel gab; 90 liegt ueber jedem
// erreichbaren Drift und schneidet deshalb nichts weg. Siehe zoombaender-drift.test.js.
assert.deepStrictEqual(VORGABE.abstaende, { spalt: 4, repel: 2, versatz: 8, drift: 90 },
	"die Vorgabewerte der Abstaende sind die heutigen Konstanten, unveraendert");

// ---- B. Nichts gespeichert / kaputt = reine Vorgabe ----------------------------------------------
[null, undefined, "kaputt", 42, [], { abstaende: "kaputt" }, { abstaende: [1, 2, 3] }].forEach((muell) => {
	const tafel = avesmapsResolveLocationZoomBands(muell);
	assert.deepStrictEqual(tafel.abstaende, VORGABE.abstaende,
		`kaputter Speicherwert (${JSON.stringify(muell)}) ergibt die Vorgabe der Abstaende`);
});

// ---- C. Rueckwaertskompatibilitaet: eine gespeicherte Tafel OHNE den Abschnitt funktioniert weiter
// 💣 DER FALL, AN DEM DAS STILL DANEBENGEHT. Vor Aufgabe 8b gespeicherte Uebersteuerungen kennen nur
// marker/label, nie abstaende -- ein fehlender Abschnitt ist ein Nichtwissen, keine Ablehnung.
const alteTafel = avesmapsResolveLocationZoomBands({
	version: 1,
	marker: { dorf: [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74, 17.74] },
	label: {},
});
assert.deepStrictEqual(alteTafel.abstaende, VORGABE.abstaende,
	"eine Tafel ohne 'abstaende' liefert weiterhin die Vorgabewerte -- kein Absturz, kein Loch");
assert.strictEqual(alteTafel.marker.dorf[4], 4.86, "und die marker-Zeile bleibt dabei unberuehrt");

// ---- D. Eine echte Uebersteuerung greift, Zelle fuer Zelle ---------------------------------------
const uebersteuert = avesmapsResolveLocationZoomBands({ abstaende: { spalt: 10, repel: 0 } });
assert.strictEqual(uebersteuert.abstaende.spalt, 10, "spalt wird uebernommen");
assert.strictEqual(uebersteuert.abstaende.repel, 0, "repel auch bei 0 (kein Rueckfall auf Vorgabe, 0 ist gueltig)");
assert.strictEqual(uebersteuert.abstaende.versatz, VORGABE.abstaende.versatz,
	"versatz fehlt in der Uebersteuerung -> Vorgabe");

// ---- E. Schranken (0 bis 20) ----------------------------------------------------------------------
const ausserhalb = avesmapsResolveLocationZoomBands({ abstaende: { spalt: -1, repel: 20.5, versatz: 20 } });
assert.strictEqual(ausserhalb.abstaende.spalt, VORGABE.abstaende.spalt, "unter 0 -> Vorgabe");
assert.strictEqual(ausserhalb.abstaende.repel, VORGABE.abstaende.repel, "ueber 20 -> Vorgabe");
assert.strictEqual(ausserhalb.abstaende.versatz, 20, "genau 20 ist noch gueltig (einschliesslich)");
const anDerUntergrenze = avesmapsResolveLocationZoomBands({ abstaende: { spalt: 0 } });
assert.strictEqual(anDerUntergrenze.abstaende.spalt, 0, "genau 0 ist gueltig (einschliesslich)");

// Nicht-Zahlen (String, NaN, Infinity, Objekt) -> Vorgabe, wie bei den Zellen.
const unfug = avesmapsResolveLocationZoomBands({ abstaende: { spalt: "4", repel: NaN, versatz: Infinity } });
assert.strictEqual(unfug.abstaende.spalt, VORGABE.abstaende.spalt, "ein String ist keine Zahl, auch wenn er wie eine aussieht");
assert.strictEqual(unfug.abstaende.repel, VORGABE.abstaende.repel, "NaN ist keine endliche Zahl");
assert.strictEqual(unfug.abstaende.versatz, VORGABE.abstaende.versatz, "Infinity ist keine endliche Zahl");

// 💣 KEIN `null` = "unsichtbar" bei den Abstaenden -- anders als bei marker/label-Zellen gibt es
// keine Sichtbarkeits-Aussage fuer einen globalen Abstand. `null` ist hier ein Nichtwissen wie jeder
// andere unbrauchbare Wert -> Vorgabe.
const nullWert = avesmapsResolveLocationZoomBands({ abstaende: { spalt: null } });
assert.strictEqual(nullWert.abstaende.spalt, VORGABE.abstaende.spalt, "null -> Vorgabe, nicht 'unsichtbar'");

// ---- F. Unbekannter Schluessel wird ignoriert, bekannte bleiben die der Vorgabetafel -------------
const fremd = avesmapsResolveLocationZoomBands({ abstaende: { hauptstadt: 5 } });
assert.strictEqual(fremd.abstaende.hauptstadt, undefined, "der Browser fuehrt die Schluesselliste");
assert.deepStrictEqual(Object.keys(fremd.abstaende).sort(), Object.keys(VORGABE.abstaende).sort(),
	"es bleiben genau die Abstaende der Vorgabetafel -- gegen SIE gemessen, nicht gegen eine Zahl");

// ---- G. Der Zugriff, den die Zeichner rufen -------------------------------------------------------
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsLocationLabelSpacing("spalt"), 4, "Vorgabe ohne Uebersteuerung");
assert.strictEqual(avesmapsLocationLabelSpacing("repel"), 2);
assert.strictEqual(avesmapsLocationLabelSpacing("versatz"), 8);
avesmapsApplyLocationZoomBands({ abstaende: { versatz: 15 } });
assert.strictEqual(avesmapsLocationLabelSpacing("versatz"), 15, "und danach die Uebersteuerung, live");
assert.strictEqual(avesmapsLocationLabelSpacing("spalt"), 4, "die anderen beiden bleiben bei ihrer Vorgabe");

// ---- H. Eine Uebersteuerung der Abstaende meldet sich als Aenderung (fuer den Boot-Leser) --------
// js/config.js zaehlt nur nach, wenn avesmapsApplyLocationZoomBands "true" meldet -- ohne diesen
// Pfad bliebe ein geaenderter Spalt unsichtbar, bis die Seite ein zweites Mal neu laedt.
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsApplyLocationZoomBands({ abstaende: { spalt: 4, repel: 2, versatz: 8 } }), false,
	"Vorgabe auf Vorgabe aendert nichts, auch bei den Abstaenden");
assert.strictEqual(avesmapsApplyLocationZoomBands({ abstaende: { spalt: 12 } }), true,
	"eine echte Abstands-Uebersteuerung meldet sich");
avesmapsApplyLocationZoomBands(null); // Zustand fuer nachfolgende Tests zuruecksetzen

console.log("zoombaender-abstaende: alle Zusicherungen erfuellt");
