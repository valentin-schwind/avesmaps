"use strict";
// Abschnittsnamen: Regel (Zwilling mit PHP), Modell-Label, Kartenleser. Entwurf 2026-09-14 §4.
// Aus der Wurzel: node js/map-features/__tests__/weg-abschnitte.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
// Die Kartenleser rufen die Modellfunktionen global, wie im Browser.
Object.assign(global, { wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke });
const W = require(path.join(WURZEL, "js/map-features/weg-abschnitte.js"));

// 1. Die gemeinsamen Faelle
const fixture = JSON.parse(lies("tools/paths/fixtures/weg-abschnitt-enden.json"));
const index = W.avesmapsWegOrtIndex(fixture.orte);
fixture.faelle.forEach((fall) => {
	assert.strictEqual(W.avesmapsWegEndeName(fall.punkt, index, fixture.toleranz), fall.erwartet, fall.warum);
});
const config = lies("js/config.js");
assert.ok(new RegExp("const LOCATION_ENDPOINT_EXACT_HIT = " + String(fixture.toleranz).replace(".", "\\.") + ";").test(config),
	"die Fixture-Toleranz ist die des Routers (js/config.js)");

// 2. Modell: Label und ganze Strecke (samt gedrehtem Abschnitt)
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Silkwiesen", bis: "Wieha" } }, 7), "Abschnitt 7: Silkwiesen – Wieha");
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Perz", bis: "Helmdahl" } }, null), "Perz – Helmdahl", "einteilig ohne Nummer");
assert.strictEqual(M.wpAbschnittLabel({}, 3), "Abschnitt 3", "ohne Enden nur die Nummer");
const kette = [
	{ public_id: "a", ends: { from: [0, 0], to: [1, 0] }, enden: { von: "Perz", bis: "Kreuzung" } },
	// b liegt ANDERSHERUM gespeichert: von Wieha nach Kreuzung
	{ public_id: "b", ends: { from: [2, 0], to: [1, 0] }, enden: { von: "Wieha", bis: "Kreuzung" } },
];
assert.ok(["Perz – Wieha", "Wieha – Perz"].includes(M.wpGanzeStrecke(kette)), "die aeusseren Enden, nicht die Kreuzung: " + M.wpGanzeStrecke(kette));
assert.strictEqual(M.wpGanzeStrecke([]), "");

// 3. Kartenleser gegen eine kleine Karte
global.LOCATION_ENDPOINT_EXACT_HIT = 0.01;
global.isCrossingLocation = (ort) => /^Kreuzung/.test(ort.name);
global.getPathPublicId = (p) => p.properties.public_id;
global.mapDataSourceStatus = { revision: 1 };
global.locationData = [
	{ name: "Perz", coordinates: [0, 0] },
	{ name: "Kreuzung-1", coordinates: [0, 1] },
	{ name: "Wieha", coordinates: [0, 2] },
];
const pfad = (id, von, bis, extra = {}) => ({ properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id,
	display_name: "Reichsstraße 2", wiki_path: { wiki_key: "reichsstrasse-2" }, ...extra }, geometry: { coordinates: [von, bis] } });
global.pathData = [pfad("b", [2, 0], [1, 0]), pfad("a", [0, 0], [1, 0])];

assert.deepStrictEqual(W.avesmapsWegAlsWay(global.pathData[1]).enden, { von: "Perz", bis: "Kreuzung" });
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz – Kreuzung", "a liegt westlich und ist Abschnitt 1");
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[0]), "Abschnitt 2: Wieha – Kreuzung");
assert.strictEqual(W.avesmapsWegStreckeAufKarte(global.pathData[0]), "Wieha – Kreuzung", "Kurzform ohne Nummer");
assert.ok(["Perz – Wieha", "Wieha – Perz"].includes(W.avesmapsWegGanzeStreckeAufKarte(global.pathData[0])));
assert.strictEqual(W.avesmapsWegGruppeAufKarte(global.pathData[0]).length, 2);

// Der Zwischenspeicher folgt der Revision: ein umbenannter Ort erscheint nach dem naechsten Revisionssprung
global.locationData[0].name = "Perz am See";
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz – Kreuzung", "gleiche Revision: gespeichert");
global.mapDataSourceStatus.revision = 2;
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz am See – Kreuzung", "neue Revision: neu gerechnet");

console.log("weg-abschnitte.test.js: ok");
