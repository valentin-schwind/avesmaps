// Der Kopf des Label-Menüs: „Gebirge · 1 Fläche, 1 Label".
//
// 💣 UNBEKANNT IST NICHT NULL (Owner 24.08.2026, wörtlich: „wenn man im standard-ansichtsmodus auf ein
// label klickt, steht da 0 flächen. wenn ich auf dasselbe label im landschafts-modus klicke, steht da
// eine fläche"). `ecosystemRegionOfLabel` gibt ausserhalb des Landschaftsmodus seine Notfallantwort
// `{ public_id }` zurück -- die Zugehörigkeit steht, aber die Flächenzahl fehlt, weil die
// Regionslisten dort nie geholt werden. `Number(undefined || 0)` machte daraus die Aussage
// „0 Flächen": dieselbe Fläche zählte je nach Ansicht verschieden, und die falsche Zahl sah aus wie
// ein Datenfehler in der Karte.
//
// 🔴 Die Unterscheidung liegt am `undefined`, NICHT am Wert. Ein echtes `area_count: 0` -- eine Region,
// deren Flächen gelöscht wurden -- ist eine Auskunft und bleibt stehen.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/label-popup-flaechenzahl.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(ROOT, "js", "ui", "popups.js"), "utf8");

// Nur die eine Funktion -- der Rest der Datei braucht Karte, Leaflet und das ganze Popup-Gerüst.
const anfang = quelle.indexOf("function labelPopupSubtitle");
assert.notStrictEqual(anfang, -1, "labelPopupSubtitle gibt es noch");
const ende = quelle.indexOf("\n}", anfang) + 2;

const context = {
	console,
	// Kein Auswahlfeld im Dokument -> die Funktion fällt auf ihren Rückfall „Region" zurück. Das ist
	// hier richtig: geprüft wird die ZÄHLUNG, nicht die Kategorie.
	document: { querySelector: () => null },
	tr: (schluessel, rueckfall) => rueckfall,
	countEcosystemRegionLabels: () => 1,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(quelle.slice(anfang, ende), context);
const untertitel = context.labelPopupSubtitle;

const label = { labelType: "gebirge" };

// ---- der gemeldete Fall ----------------------------------------------------------------------------

assert.strictEqual(untertitel(label, { public_id: "r1", area_count: 1 }), "Region · 1 Fläche, 1 Label",
    "im Landschaftsmodus steht die Zahl da");

assert.strictEqual(untertitel(label, { public_id: "r1" }), "Region · 1 Label",
    "💣 DER KERN: ohne geladene Regionsliste steht KEINE Flächenzahl da -- statt einer falschen");

assert.ok(!untertitel(label, { public_id: "r1" }).includes("0 Flächen"),
    "🔴 und ganz sicher nicht „0 Flächen“ -- das war die Falschaussage");

assert.strictEqual(untertitel(label, { public_id: "r1", area_count: null }), "Region · 1 Label",
    "null zählt wie fehlend -- beides heisst „nicht gemessen“");

// ---- was eine ECHTE Null bleiben muss ---------------------------------------------------------------
//
// 🔴 Eine Region, deren Flächen gelöscht wurden, hat wirklich keine -- und das ist genau die Auskunft,
// die ein Editor an dieser Stelle braucht. Sie zu verschweigen wäre der umgekehrte Fehler.
assert.strictEqual(untertitel(label, { public_id: "r1", area_count: 0 }), "Region · 0 Flächen, 1 Label",
    "eine gemessene Null bleibt sichtbar");

// ---- Mehrzahl --------------------------------------------------------------------------------------

context.countEcosystemRegionLabels = () => 2;
assert.strictEqual(untertitel(label, { public_id: "r1", area_count: 3 }), "Region · 3 Flächen, 2 Labels",
    "Mehrzahl auf beiden Seiten");

// ---- ohne Fläche gar keine Zeile ---------------------------------------------------------------------

assert.strictEqual(untertitel(label, null), "Region",
    "ein Label ohne Fläche nennt nur seine Kategorie");

// ---- und die Listen werden nachgezogen ---------------------------------------------------------------
//
// 💣 Die andere Hälfte: zu schweigen ist ehrlich, aber der Owner will die ZAHL. Sie steht in den
// Regionslisten, und die holt ausserhalb des Landschaftsmodus niemand -- also holt sie das Öffnen des
// Menüs nach. Geprüft am Quelltext ohne Kommentare, sonst fände die Probe die Begründung.
const labelsQuelle = fs.readFileSync(path.join(ROOT, "js", "map-features", "map-features-labels.js"), "utf8");
const ohneKommentare = labelsQuelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(ohneKommentare.includes('popupopen'),
    "das Label-Menü hört auf sein Öffnen");
assert.ok(ohneKommentare.includes("ensureEcosystemRegionsLoadedForLabelFilter("),
    "💣 und zieht die Regionslisten nach -- sonst bleibt die Zahl für immer weg");
assert.ok(ohneKommentare.includes("canOperateEcosystemLayers("),
    "⚠️ nur für Editoren mit Recht, nicht für jeden Besucher");

console.log("label-popup-flaechenzahl.test.js: OK");
