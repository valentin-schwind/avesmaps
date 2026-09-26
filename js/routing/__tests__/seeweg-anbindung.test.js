const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Seehafen (Owner 26.09.2026): „wichtig ist, dass orte, die eine seeweg-anbindung haben, das haekchen
// automatisch gesetzt bekommen. bei orten die aber keine seeweg-anbindung haben, duerfen unsere editoren
// das haekchen manuell setzen". Die Frage „hat dieser Ort eine Seeweg-Anbindung?" beantwortet
// avesmapsOrtHatSeewegAnbindung (js/routing/route-graph-routing.js) -- hier AUSGEFUEHRT, nicht gelesen.
// Zwilling auf dem Server: avesmapsCollectClientSeaBoundLocations (api/_internal/routing/client-graph.php),
// dort gewacht von api/_internal/map/__tests__/seehafen-aus-seewegen-test.php (dieselbe Fixture-Form:
// zwei Enden, ein innerer Stuetzpunkt hinter einem losen Ende, eine Kreuzung, eine Strasse).
//
// Lauf (aus dem Wurzelverzeichnis):  node js/routing/__tests__/seeweg-anbindung.test.js

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../map-features/map-features-line-catmull.js");
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../../map-features/map-features-location-editing.js");
loadBrowserScript("../../map-features/map-features-location-lookup.js");
loadBrowserScript("../../map-features/map-features-powerlines.js");
loadBrowserScript("../route-graph-core.js");
loadBrowserScript("../route-graph-routing.js");

const loc = (name, x, y, locationType = "dorf") => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType });
const weg = (id, subtype, punkte) => ({
	geometry: { type: "LineString", coordinates: punkte },
	properties: { id, feature_subtype: subtype },
});

locationData = [
	loc("Hafenstadt", 0, 0, "stadt"),
	loc("Inselort", 10, 0),
	loc("Zwischenhalt", 30, 0),           // liegt auf einem INNEREN Stuetzpunkt eines Seewegs mit losem Anfang
	loc("Kap", 40, 0, "gebaeude"),
	loc("Binnenstadt", 0, 50, "stadt"),   // nur eine Strasse
	loc("Einsiedel", 90, 90),             // gar kein Weg
	loc("Kreuzung-9", 60, 0, "crossing"),
];
pathData = [
	weg("see-1", "Seeweg", [[0, 0], [10, 0]]),
	weg("see-2", "Seeweg", [[25, 0], [30, 0], [40, 0]]),
	weg("see-3", "Seeweg", [[40, 0], [60, 0]]),
	weg("land-1", "Strasse", [[0, 0], [0, 50]]),
];
powerlineData = [];
seewegAnbindungsIndex = null;

for (const name of ["Hafenstadt", "Inselort", "Kap"]) {
	assert.strictEqual(avesmapsOrtHatSeewegAnbindung(`pid-${name}`), true, `${name}: ein Seeweg-Ende liegt am Ort`);
}
// 💣 Der Fall, an dem die erste Fassung (ueber die Arme des Pruefhaken-Graphen) scheiterte: der Graph nimmt
// einen Weg nur auf, wenn BEIDE Enden an einem Ort liegen -- see-2 beginnt im offenen Meer.
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Zwischenhalt"), true,
	"ein innerer Stuetzpunkt eines Seewegs zaehlt wie beim Router, auch wenn der Seeweg ein loses Ende hat");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Binnenstadt"), false, "eine Strasse ist keine Seeweg-Anbindung -- der Haken bleibt von Hand setzbar");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Einsiedel"), false, "ohne jeden Weg keine Anbindung");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Kreuzung-9"), true, "die Sammlung fuehrt auch Kreuzungen -- ob ein Ort gemeint ist, fragt der Leser");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung(""), false, "ein neuer Ort ohne Kennung hat keine Anbindung");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung(undefined), false, "ohne Kennung keine Anbindung");
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-unbekannt"), false, "eine fremde Kennung hat keine Anbindung");

// Der Speicher wird bei jeder Kartenaenderung verworfen (refreshPlannerAfterFeatureChange) -- ein frisch
// gezeichneter Seeweg muss danach zaehlen.
pathData.push(weg("see-4", "Seeweg", [[0, 50], [0, 80]]));
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Binnenstadt"), false, "ohne Verwerfen bleibt der alte Stand stehen");
seewegAnbindungsIndex = null;
assert.strictEqual(avesmapsOrtHatSeewegAnbindung("pid-Binnenstadt"), true, "nach dem Verwerfen zaehlt der neue Seeweg");

// Die Sammlung baut NICHT den Pruefhaken-Graphen -- „Ort bearbeiten" soll nicht auf ihn warten.
locationConnectivityIndex = null;
seewegAnbindungsIndex = null;
avesmapsOrtHatSeewegAnbindung("pid-Kap");
assert.strictEqual(locationConnectivityIndex, null, "die Seeweg-Frage darf den Anbindungs-Index der Pruefhaken nicht bauen");

// Und verworfen wird an DERSELBEN Stelle wie der Graph -- sonst zeigte das Formular nach einem neuen Seeweg
// den alten Stand. Zeilenendenneutral gelesen (AGENTS.md §9: hier CRLF, im Tor LF).
const renderQuelle = fs.readFileSync(path.join(__dirname, "../route-render.js"), "utf8").split("\r\n").join("\n");
const abHier = renderQuelle.slice(renderQuelle.indexOf("function refreshPlannerAfterFeatureChange("));
const rumpf = abHier.slice(0, abHier.indexOf("\n}"));
assert.ok(rumpf.length > 0 && /\n\s*seewegAnbindungsIndex = null;/.test(rumpf),
	"refreshPlannerAfterFeatureChange verwirft den Seeweg-Speicher nicht");

console.log("seeweg-anbindung: alle Faelle ok");
