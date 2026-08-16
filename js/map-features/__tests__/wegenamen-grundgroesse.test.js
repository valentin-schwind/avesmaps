const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die Wegenamen hingen an der Dorf-Zeile der Ortsschrift. Sie haben jetzt ihre eigene Grundtafel --
// buchstäblich dieselben Zahlen, damit sich am Auslieferungstag nichts ändert.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §6
//
// ⭐ Der Test liest die Dateien als TEXT. Beide sind DOM- und Leaflet-Code und lassen sich nicht
// einzeln laden; die Zahlen und der Aufruf stehen aber wörtlich da, und genau sie sind der Vertrag.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-grundgroesse.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const pathLabels = read("js/map-features/map-features-path-labels.js");
const powerlines = read("js/map-features/map-features-powerlines.js");

// ---- 1. Die Grundtafel IST die alte Dorf-Zeile ------------------------------------------------
// 🔴 Diese sechs Zahlen standen bis zum 16.08.2026 in LOCATION_NAME_LABEL_SIZE_BY_ZOOM.dorf.
// Die 8,5 bei z3 ist der Grund für diesen ganzen Umbau: eine leere Zelle hätte sie auf 8 gedrückt.
const ALTE_DORF_ZEILE = { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 };

const match = pathLabels.match(/PATH_LABEL_BASE_SIZE_BY_ZOOM\s*=\s*\{([^}]*)\}/);
assert.ok(match, "PATH_LABEL_BASE_SIZE_BY_ZOOM wurde gefunden");
const tafel = {};
match[1].split(",").forEach((paar) => {
	const teile = paar.split(":");
	if (teile.length === 2) {
		tafel[teile[0].trim()] = Number(teile[1].trim());
	}
});
assert.deepStrictEqual(tafel, ALTE_DORF_ZEILE,
	"die Grundtafel der Wegenamen muss die alte Dorf-Zeile sein: " + JSON.stringify(tafel));

// ---- 2. Die Kopplung ist weg ------------------------------------------------------------------
assert.ok(!/getLocationNameLabelSize/.test(pathLabels),
	"map-features-path-labels.js ruft die Ortsschrift nicht mehr");
assert.ok(!/getLocationNameLabelSize/.test(powerlines),
	"map-features-powerlines.js ruft die Ortsschrift nicht mehr");
assert.ok(/getPathLabelBaseSize\(\)/.test(pathLabels), "die Wegenamen nutzen die eigene Grundtafel");
assert.ok(/getPathLabelBaseSize\(\)/.test(powerlines), "die Kraftlinien-Namen ebenso");

console.log("wegenamen-grundgroesse: alle Zusicherungen erfüllt");
