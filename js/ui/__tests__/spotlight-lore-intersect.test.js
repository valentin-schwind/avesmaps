// Die Hervorhebung eines Regeltreffers zeigt die SCHNITTMENGE, nicht die ganze Flaeche.
// Beim Finsterkamm ist das der Unterschied zwischen dem ganzen Gebirge und seinem Nordteil.
//
// ⚠️ Der Bauplan-Testcode nennt die Bibliothek "js/third-party/polygon-clipping.min.js" -- die
// Datei heisst tatsaechlich "polygon-clipping.umd.min.js" (im vm-Kontext gegengeprueft). Und
// spotlightLoreIntersectGeometry ruft ecosystemBooleanGeometry (map-features-ecosystem-boolean.js),
// die ihrerseits ecosystemGeometryParts/-Area/-Bounds (map-features-ecosystem-geometry.js) als
// globale Funktionen braucht -- ohne diese DRITTE Datei wirft der Erfolgsfall (echter Ueberlapp)
// "ecosystemGeometryArea is not defined", statt die Plausibilitaetspruefung zu bestehen. Alle drei
// sind ECHTE Dateien, keine Attrappen -- die Ladereihenfolge in index.html ist genau diese.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// 💣 `window` und `globalThis` muessen DASSELBE Objekt sein, nicht zwei verschiedene: die
// UMD-Bibliothek haengt sich an `globalThis.polygonClipping` (ihr eigener Wrapper prueft zuerst
// `module`/`define`, dann faellt sie auf `globalThis`), aber ecosystemBooleanGeometry liest
// `window.polygonClipping`. Ein eigenes leeres `window`-Objekt (wie im Bauplan-Testcode) haette die
// Bibliothek an der einen Stelle abgelegt und an der anderen nie gefunden -- derselbe Fehler wie ein
// stiller Ladereihenfolge-Bug, nur im Test.
const context = { console };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/third-party/polygon-clipping.umd.min.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/map-features/map-features-ecosystem-geometry.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/map-features/map-features-ecosystem-boolean.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/ui/spotlight-search-focus.js", "utf8"), context);

const quadrat = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const nordhaelfte = { type: "Polygon", coordinates: [[[0, 5], [10, 5], [10, 20], [0, 20], [0, 5]]] };

const schnitt = context.spotlightLoreIntersectGeometry(quadrat, nordhaelfte);
assert.ok(schnitt, "es gibt eine Schnittflaeche");
// 💣 Der Schnitt ist KLEINER als die Flaeche -- genau das ist der Zweck. Ein Ergebnis, das so
// gross ist wie die Eingabe, heisst: es wurde gar nicht verschnitten.
const flaeche = (g) => g.coordinates.flat(1).reduce((sum, p, i, r) => {
	const q = r[(i + 1) % r.length];
	return sum + (p[0] * q[1] - q[0] * p[1]) / 2;
}, 0);
assert.ok(Math.abs(flaeche(schnitt)) < Math.abs(flaeche(quadrat)) - 1e-9, "kleiner als das Ganze");

// Kein Ueberlapp -> null, nicht ein leeres Polygon, das die Zeichnung stumm nichts malen laesst.
const weitWeg = { type: "Polygon", coordinates: [[[100, 100], [110, 100], [110, 110], [100, 110], [100, 100]]] };
assert.strictEqual(context.spotlightLoreIntersectGeometry(quadrat, weitWeg), null);

// Eine fehlende Bandgeometrie faellt auf die ganze Flaeche zurueck -- lieber zu viel
// hervorheben als gar nichts.
assert.deepStrictEqual(context.spotlightLoreIntersectGeometry(quadrat, null), quadrat);

console.log("spotlight-lore-intersect: OK");
