// Waechst die Labelschrift ueber Zoom 5 hinaus weiter?
//
// 🔴 Owner 23.08.2026: „nach unten hin etwas groessere schriftart". Der Visual-Zoom klemmt bei
// VISUAL_MAX_ZOOM_LEVEL = 5 -- ohne Zusatz sind die Stufen 5, 6 und 7 fuer Labels ununterscheidbar,
// und beim Reinzoomen wirkt der Name gegenueber der wachsenden Karte immer kleiner.
// Live gemessen VOR der Aenderung (Landschaftslabel, Grundgroesse 20): 14 / 16 / 18 / 20 / 20 / 20
// fuer Zoom 2..7 -- der Deckel greift auf genau der Stufe, die der Owner genannt hat.
//
// ⚠️ map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an).
// Geschnitten wird deshalb nur getScaledLabelSize samt ihrer Konstante -- dasselbe Vorgehen wie in
// curve-label-normalize.test.js, und mit derselben Ehrlichkeit: der Test misst diese eine Funktion.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-groesse-tiefer-zoom.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
const von = quelle.indexOf("const LABEL_SIZE_DEEP_ZOOM_STEP");
assert.ok(von >= 0, "die Wachstumskonstante steht in der Datei");
const marke = quelle.indexOf("function getScaledLabelSize(", von);
assert.ok(marke > von, "getScaledLabelSize steht dahinter");
const bis = quelle.indexOf("\n}", marke);
assert.ok(bis > marke, "und hat ein Ende");
const rumpf = quelle.slice(von, bis + 2);

let zoomJetzt = 3;
const map = { getZoom: () => zoomJetzt };
const VISUAL_MAX_ZOOM_LEVEL = 5;
const getVisualZoomLevel = (z) => Math.max(0, Math.min(VISUAL_MAX_ZOOM_LEVEL, z));

const getScaledLabelSize = new Function(
	"map", "VISUAL_MAX_ZOOM_LEVEL", "getVisualZoomLevel",
	rumpf + "; return getScaledLabelSize;"
)(map, VISUAL_MAX_ZOOM_LEVEL, getVisualZoomLevel);

const label = { size: 20 };
const bei = (z) => { zoomJetzt = z; return getScaledLabelSize(label); };

// --- Unterhalb des Deckels aendert sich NICHTS -------------------------------------------------
// 💣 Das ist die halbe Zusicherung: eine neue Wachstumsregel darf die 931 Labels auf den Stufen 0-5
// nicht um ein Pixel verschieben. Die Zahlen unten sind die live gemessenen von vor der Aenderung.
assert.strictEqual(bei(2), 14, "Zoom 2 bleibt bei 14");
assert.strictEqual(bei(3), 16, "Zoom 3 bleibt bei 16");
assert.strictEqual(bei(4), 18, "Zoom 4 bleibt bei 18");
assert.strictEqual(bei(5), 20, "Zoom 5 bleibt bei 20 -- hier setzte der Deckel an");

// --- Und darueber waechst sie weiter -----------------------------------------------------------
assert.ok(bei(6) > bei(5), "Zoom 6 muss groesser sein als Zoom 5 -- sonst sind sie ununterscheidbar");
assert.ok(bei(7) > bei(6), "und Zoom 7 groesser als Zoom 6");

// ⚠️ „ETWAS" groesser, nicht doppelt. Ohne diese Schranke waere die naechste Erhoehung ein
// Skalenbruch, und die Karte truege bei Zoom 7 Schlagzeilen statt Landschaftsnamen.
assert.ok(bei(7) <= Math.round(bei(5) * 1.25),
	"hoechstens ein Viertel mehr als bei Zoom 5, gemessen: " + bei(5) + " -> " + bei(7));

// 🔴 Und der Deckel gilt weiterhin: Zoom 8 gibt es auf der Karte nicht (maxZoom 7), eine hoehere
// Stufe darf die Schrift nicht weiter aufblasen.
assert.strictEqual(bei(9), bei(7), "oberhalb von Zoom 7 waechst nichts mehr");

console.log("label-groesse-tiefer-zoom: alle Zusicherungen erfuellt");
