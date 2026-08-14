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

// ---------------------------------------------------------------------------------------------------
// Task 8: Region-Weg, Bandauswahl/-Vereinigung, Zeichen-Entscheidung. Alle vier reinen Teile, die
// Schritt 5 nennt -- kein Fetch, keine Karte, aber echte Kartenkoordinaten (0..1024), damit die
// Nord/Sued-Falle aus dem Bauplan (y waechst nach NORDEN) real greifen kann, nicht nur an einem
// Testquadrat bei 0..10.
//
// 💣 y waechst nach NORDEN: polar liegt bei y 883..1024 (hoher y-Wert), tropisch bei y 0..480
// (niedriger y-Wert) -- exakt die Zahlen aus dem Task-8-Auftrag. Ein Test, der nur "es wurde
// irgendwie geschnitten" prueft, haette die Nord/Sued-Vertauschung aus dem Mockup nicht gefangen.
const band = (minY, maxY) => ({ type: "Polygon", coordinates: [[[0, minY], [1024, minY], [1024, maxY], [0, maxY], [0, minY]]] });
const flaecheGross = (g) => Math.abs(g.coordinates.reduce((sum, ring) => sum + ring.slice(0, -1).reduce((s, p, i, r) => {
	const q = r[(i + 1) % r.length];
	return s + (p[0] * q[1] - q[0] * p[1]) / 2;
}, 0), 0));
const bandsByZone = new Map([
	["polar", band(883, 1024)],
	["boreal", band(700, 883)],
	["gemaessigt", band(480, 700)],
	["tropisch", band(0, 480)],
]);

// -- Auswahl + Vereinigung (Mutation 1: rule_zones ignorieren und alle acht Baender vereinigen) --

// Eine einzelne Zone: das Ergebnis ist GENAU dieses Band, keins der anderen drei.
const nurBoreal = context.unionSpotlightClimateZones(["boreal"], bandsByZone);
assert.ok(nurBoreal, "eine bekannte Zone liefert eine Geometrie");
assert.ok(Math.abs(flaecheGross(nurBoreal) - flaecheGross(band(700, 883))) < 1e-6,
	"die Flaeche ist die des borealen Bands allein, nicht die Summe mehrerer Baender");
// Lage pruefen, nicht nur Groesse: jeder Punkt liegt im borealen y-Bereich -- weder im polaren
// Norden noch im gemaessigten oder tropischen Sueden. Genau das haette eine Nord/Sued-Vertauschung
// (Mockup-Falle) oder ein "alle acht Baender" (Mutation 1) sichtbar verschoben oder vergroessert.
nurBoreal.coordinates[0].forEach(([, y]) => {
	assert.ok(y >= 700 - 1e-9 && y <= 883 + 1e-9, `Punkt y=${y} liegt ausserhalb des borealen Bands`);
});

// Zwei Zonen: die Vereinigung deckt beide y-Spannen ab (700..1024), aber NICHT den tropischen
// Sueden (0..480) -- waere rule_zones ignoriert und alle vier/acht Baender vereinigt, waere die
// Flaeche doppelt so gross wie hier erwartet.
const polarUndBoreal = context.unionSpotlightClimateZones(["polar", "boreal"], bandsByZone);
assert.ok(Math.abs(flaecheGross(polarUndBoreal) - (flaecheGross(band(883, 1024)) + flaecheGross(band(700, 883)))) < 1e-6,
	"die Vereinigung ist genau Polar + Boreal, keine dritte oder vierte Zone kam dazu");

// Keine Zonen (leeres rule_zones) oder eine unbekannte Zone -> keine Bandgeometrie, also spaeter die
// ganze Flaeche (Owner: lieber zu viel als gar nichts).
assert.strictEqual(context.unionSpotlightClimateZones([], bandsByZone), null, "leere rule_zones -> keine Verschneidung");
assert.strictEqual(context.unionSpotlightClimateZones(["unbekannt"], bandsByZone), null, "unbekannte Zone -> keine Verschneidung");
assert.strictEqual(context.unionSpotlightClimateZones(["boreal"], null), null, "keine Baender geladen -> keine Verschneidung");

// -- Zeichen-Geometrie je Flaeche (Mutation 2: bei leerem Schnitt die ganze Flaeche zeichnen) --

// Ein Regelort (isRuleArea=true), dessen Flaeche das gewaehlte Band gar nicht beruehrt: null, NIE
// die ganze Ausgangsflaeche -- ein leiser Rueckfall hier waere Mutation 2 unbemerkt bestehen lassen.
assert.strictEqual(context.spotlightLoreAreaGeometryToDraw(true, quadrat, weitWeg), null,
	"kein Ueberlapp mit dem Band -> nicht zeichnen, nicht die ganze Flaeche");

// Ein Regelort MIT Ueberlapp: die Schnittflaeche, kleiner als das Ganze -- derselbe Vertrag wie
// spotlightLoreIntersectGeometry oben, nur ueber den neuen Regelort-Wrapper gepft.
const regelortSchnitt = context.spotlightLoreAreaGeometryToDraw(true, quadrat, nordhaelfte);
assert.ok(regelortSchnitt, "ein Regelort mit Ueberlapp liefert eine Schnittflaeche");
assert.ok(Math.abs(flaeche(regelortSchnitt)) < Math.abs(flaeche(quadrat)) - 1e-9);

// Ein GENANNTER Ort (isRuleArea=false) wird NIE geklemmt, selbst wenn eine Bandgeometrie mitgegeben
// wird -- er hat keine Regel und kein rule_zones, das Klimaband geht ihn nichts an.
assert.deepStrictEqual(context.spotlightLoreAreaGeometryToDraw(false, quadrat, nordhaelfte), quadrat,
	"ein genannter Ort bleibt unverschnitten, auch mit vorhandener Bandgeometrie");

// -- Regions-Weg vs. Label-Weg (Mutation 3: den Regionsweg weglassen und wieder nur nach Label fragen) --

const flaecheEins = { region_public_id: "r-wald-1", geometry: quadrat };
const areasByRegionMap = new Map([["r-wald-1", [flaecheEins]]]);
const flaecheLabel = { label_public_id: "l-nebelmoor", geometry: nordhaelfte };
const areasByLabelMap = new Map([["l-nebelmoor", [flaecheLabel]]]);

// Ein Regelort (regionPublicId gesetzt, KEIN kind: "label" -- genau der Fall eines lokal nicht
// aufgeloesten Regelorts) findet seine Flaeche ueber die Region, ganz ohne areasByLabel.
const regelort = { regionPublicId: "r-wald-1" };
assert.deepStrictEqual(context.spotlightPlaceAreas(regelort, null, areasByRegionMap), [flaecheEins],
	"ein Regelort wird ueber region_public_id gefunden, nicht ueber ein Label");

// Derselbe Regelort OHNE areasByRegion (Regionsabruf schlug fehl / kam noch nicht zurueck) faellt
// NICHT auf den Label-Weg zurueck -- er hat kein Label, der Rueckfall waere falsch positiv.
// 💣 Laenge statt deepStrictEqual gegen []: die Funktion baut ihr [] SELBST im vm-Kontext, ein []-Literal
// hier im Testfile lebt in Node's eigenem Realm -- deepStrictEqual haelt zwei Arrays aus verschiedenen
// Realms trotz gleichen Inhalts fuer ungleich (unterschiedliche Array.prototype-Objekte).
const regelortOhneRegionsdaten = context.spotlightPlaceAreas(regelort, areasByLabelMap, null);
assert.strictEqual(Array.isArray(regelortOhneRegionsdaten) && regelortOhneRegionsdaten.length, 0,
	"ohne areasByRegion liefert ein Regelort nichts -- kein stiller Rueckfall auf Label");

// 🔴 Der Label-Weg bleibt fuer alles andere: ein genannter Ort (kind: "label", keine
// regionPublicId) findet seine Flaeche weiterhin ueber sein Label, unveraendert.
const genannterOrt = { kind: "label", labelEntry: { label: { publicId: "l-nebelmoor" } } };
assert.deepStrictEqual(context.spotlightPlaceAreas(genannterOrt, areasByLabelMap, areasByRegionMap), [flaecheLabel],
	"ein genannter Ort findet seine Flaeche weiter ueber label_public_id");

// -- Kringel-Sperre fuer Regelorte (Mutation 4: fuer einen Regelort ohne Geometrie doch einen Kringel) --

assert.strictEqual(context.spotlightLoreAllowsPointFallback({ regionPublicId: "r-wald-1" }, true), false,
	"ein Regelort bekommt nie den Punkt-Notnagel, auch wenn pointFallback an ist");
assert.strictEqual(context.spotlightLoreAllowsPointFallback({ kind: "label" }, true), true,
	"ein genannter Ort behaelt den Punkt-Notnagel, wenn der Aufrufer ihn erlaubt");
assert.strictEqual(context.spotlightLoreAllowsPointFallback({ kind: "label" }, false), false,
	"pointFallback:false gilt weiterhin, unabhaengig vom Regelort-Status");

console.log("spotlight-lore-intersect (Task 8: Region-Weg + Klimaband-Verschneidung): OK");
