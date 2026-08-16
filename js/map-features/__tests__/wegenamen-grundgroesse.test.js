const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Wegenamen hingen an der Dorf-Zeile der Ortsschrift. Sie haben jetzt ihre eigene Grundtafel --
// buchstäblich dieselben Zahlen, damit sich am Auslieferungstag nichts ändert.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §6
//
// ⭐ Der Test ruft getPathLabelBaseSize() WIRKLICH auf (vm.runInThisContext); Vorbild:
// pruefhaken-sichtbarkeit.test.js. Damit sind drei Dinge prüfbar:
// (1) die Zahlenwerte der alten Dorf-Zeile werden exakt geliefert (z0–z5),
// (2) die Zoom-Klemme auf 0–5 ist wirksam (z6–z7 liefern z5-Wert),
// (3) die Untergrenze von 8 greift.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-grundgroesse.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

// --- Umgebung: nur das, was getPathLabelBaseSize und getPathLabelVisualZoomIndex wirklich brauchen ---
// ⚠️ KEIN global.getVisualZoomLevel setzen! Der Fallback mit Math.min(5,...) muss laufen,
// damit wir prüfen können, dass die Klemme auf 0–5 wirksam ist. Wenn getVisualZoomLevel vorhanden
// ist, wird der erste typeof-Zweig immer genommen, der Fallback nie, und z6/z7 Tests würden
// falsch grün sein, auch wenn Math.min(7,...) darin stünde.
global.window = {};
global.map = { getZoom: () => 4 };

const repoRoot = path.join(__dirname, "..", "..", "..");
loadBrowserScript(path.join(repoRoot, "js/map-features/map-features-path-labels.js"));

// --- Lesen Sie auch die Text-Contracts: Datei-Variante und Powerlines-Aufruf -------------------
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const pathLabels = read("js/map-features/map-features-path-labels.js");
const powerlines = read("js/map-features/map-features-powerlines.js");

// ---- 1. Die Grundtafel IST die alte Dorf-Zeile -- Text-Prüfung --------------------------------
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

// ---- 2. Die Kopplung ist weg -- Text-Prüfung ------------------------------------------------
assert.ok(!/getLocationNameLabelSize/.test(pathLabels),
	"map-features-path-labels.js ruft die Ortsschrift nicht mehr");
assert.ok(!/getLocationNameLabelSize/.test(powerlines),
	"map-features-powerlines.js ruft die Ortsschrift nicht mehr");
assert.ok(/getPathLabelBaseSize\(\)/.test(pathLabels), "die Wegenamen nutzen die eigene Grundtafel");
assert.ok(/getPathLabelBaseSize\(\)/.test(powerlines), "die Kraftlinien-Namen ebenso");

// ---- 3. Die Werte und das Verhalten sind korrekt -- echte Funktionsaufrufe --------------------
// z0–z5 liefern die alten Dorf-Zahlen -- DIESE SECHS WERTE SIND DAS KERNVERSPRECHEN
assert.strictEqual(getPathLabelBaseSize(0), 8, "z0 liefert 8");
assert.strictEqual(getPathLabelBaseSize(1), 8, "z1 liefert 8");
assert.strictEqual(getPathLabelBaseSize(2), 8, "z2 liefert 8");
assert.strictEqual(getPathLabelBaseSize(3), 8.5, "z3 liefert 8.5 -- das ist der Kern der Aufgabe");
assert.strictEqual(getPathLabelBaseSize(4), 10, "z4 liefert 10");
assert.strictEqual(getPathLabelBaseSize(5), 11, "z5 liefert 11");

// z6–z7: auf 0–5 geklemmt, also z5-Wert -- DIESE KLEMME WÜRDE AUFFALLEN, WENN SIE BEI Math.min(7,...) STÜNDE
assert.strictEqual(getPathLabelBaseSize(6), 11, "z6 ist geklemmt auf z5 → 11");
assert.strictEqual(getPathLabelBaseSize(7), 11, "z7 ist geklemmt auf z5 → 11");

// ---- 4. Die Erscheinungsstufe der Wegenamen ist ebenso entkoppelt -- Text-Prüfung -------------
// Dieselbe versteckte Kopplung wie oben, nur für die Erscheinungsstufe statt die Größe:
// isPathLabelVisibleAtCurrentZoom (map-features-path-labels.js), buildWayLabelEligibilityContext
// (map-features-way-labels.js) und getSpotlightPathZoom (js/ui/spotlight-search-focus.js) lasen
// bis zum 16.08.2026 alle LOCATION_NAME_LABEL_CONFIG.dorf.minZoom direkt. Ein Namensvertrag
// zwischen Dateien, kein Verhalten -- way-labels.js und spotlight-search-focus.js einzeln zu laden
// (DOM/Leaflet-Code) wäre unverhältnismäßig, siehe Abschnitt 2 oben.
const wayLabels = read("js/map-features/map-features-way-labels.js");
const spotlightFocus = read("js/ui/spotlight-search-focus.js");

// 🔴 Dieser Wert stand bis zum 16.08.2026 in LOCATION_NAME_LABEL_CONFIG.dorf.minZoom (js/config.js).
const ALTER_DORF_MINZOOM = 4;
const minZoomMatch = pathLabels.match(/PATH_LABEL_MIN_ZOOM\s*=\s*([\d.]+)/);
assert.ok(minZoomMatch, "PATH_LABEL_MIN_ZOOM wurde gefunden");
assert.strictEqual(Number(minZoomMatch[1]), ALTER_DORF_MINZOOM,
	"PATH_LABEL_MIN_ZOOM muss den alten dorf.minZoom-Wert tragen");

// Kommentare DÜRFEN den alten Namen zur Dokumentation nennen (siehe PATH_LABEL_MIN_ZOOM oben) --
// geprüft wird nur der CODE, also jede Zeile ohne führendes "//" (Zeilenkommentar-Stil dieses Repos).
const ohneKommentare = (text) => text.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
assert.ok(!/LOCATION_NAME_LABEL_CONFIG/.test(ohneKommentare(pathLabels)),
	"map-features-path-labels.js liest LOCATION_NAME_LABEL_CONFIG nicht mehr im Code");
assert.ok(!/LOCATION_NAME_LABEL_CONFIG/.test(ohneKommentare(wayLabels)),
	"map-features-way-labels.js liest LOCATION_NAME_LABEL_CONFIG nicht mehr im Code");
assert.ok(!/LOCATION_NAME_LABEL_CONFIG/.test(ohneKommentare(spotlightFocus)),
	"spotlight-search-focus.js liest LOCATION_NAME_LABEL_CONFIG nicht mehr im Code");

console.log("wegenamen-grundgroesse: alle Zusicherungen erfüllt");
