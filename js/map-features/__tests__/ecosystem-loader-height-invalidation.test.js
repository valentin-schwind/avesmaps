// Wann muss der Höhenstapel neu gebaut werden? (V8, 2026-07-29)
//
// 💣 DER FEHLER, DEN DIESE DATEI FESTHÄLT. Der Loader rief nach dem Nachladen nur `redraw()` und nie
// `invalidate()`. Das ging genau einmal gut: ein LEERER Stapel merkt sich selbst als veraltet
// (`stackDirty = fields.length === 0` in map-features-ecosystem-height-render.js), also baute das erste
// `redraw()` ihn auf. Danach steht `stackDirty` auf false -- und wird sonst NUR im Eigenschaften-Dialog
// gesetzt. Jede Fläche, die später beim Schwenken nachlud, wurde gegen den ALTEN Stapel gezeichnet und
// war unsichtbar. Vom Owner gemeldet: „jetzt gehen die Ingrakuppen wieder nicht" -- nach dem Bearbeiten
// einer anderen Fläche ging es (der Dialog invalidiert), nach dem Schwenken nach Süden nicht mehr.
//
// 🪤 Und die Gegenrichtung ist genauso wichtig: bedingungslos zu invalidieren hiesse, den Stapel bei
// JEDEM `moveend` neu zu bauen -- am Livebestand rund 306 ms. Deshalb prüfen die zwei Funktionen hier,
// ob sich für das Höhenfeld überhaupt etwas geändert hat.
//
// Run: node js/map-features/__tests__/ecosystem-loader-height-invalidation.test.js

const assert = require("assert");
const { ecosystemAreaAffectsHeightField, ecosystemHeightRelevantChange }
	= require("../map-features-ecosystem-loader.js");

const gebirge = (extra) => Object.assign({
	public_id: "a", kind: "topographie", region_type: "gebirge", geometry_revision: 1,
	terrain_grain: null, terrain_levels: null, terrain_avg_height: null, terrain_mean_height: null,
}, extra || {});

// 1. Welche Fläche zählt überhaupt fürs Höhenfeld -- dieselbe Bedingung wie `topographyAreas()`.
assert.strictEqual(ecosystemAreaAffectsHeightField(gebirge()), true, "ein Topographie-Gebirge zählt");
assert.strictEqual(ecosystemAreaAffectsHeightField(gebirge({ region_type: "huegelland" })), false,
	"Hügelland hat kein Höhenfeld");
assert.strictEqual(ecosystemAreaAffectsHeightField(gebirge({ kind: "vegetation" })), false,
	"ein Wald auch nicht, selbst wenn die Art zufällig passt");
assert.strictEqual(ecosystemAreaAffectsHeightField(null), false, "und nichts ist auch nichts");
assert.strictEqual(ecosystemAreaAffectsHeightField(undefined), false, "undefined ebenso");

// 2. 🔴 DER KERN: Geländewerte ändern sich, OHNE dass `geometry_revision` steigt.
//
// `update_area_terrain` bumpt sie nicht -- die billige Abzweigung im Loader („Geometrie unverändert")
// übernähme die neuen Werte also ins Flächenobjekt, während der Stapel mit den alten weiterrechnet.
// Genau dieser Fall darf nicht durchrutschen.
for (const feld of ["terrain_grain", "terrain_levels", "terrain_avg_height", "terrain_mean_height"]) {
	assert.strictEqual(ecosystemHeightRelevantChange(gebirge(), gebirge({ [feld]: 2000 })), true,
		`${feld} geändert muss den Stapel entwerten`);
	assert.strictEqual(ecosystemHeightRelevantChange(gebirge({ [feld]: 2000 }), gebirge()), true,
		`${feld} zurückgenommen ebenso`);
}

// 3. Nichts geändert = kein Neubau. Das ist der Normalfall bei jedem Schwenk, und er muss billig sein.
assert.strictEqual(ecosystemHeightRelevantChange(gebirge(), gebirge()), false,
	"unveränderte Fläche entwertet nichts");
assert.strictEqual(ecosystemHeightRelevantChange(gebirge({ terrain_avg_height: 2000 }),
	gebirge({ terrain_avg_height: 2000 })), false, "gleiche Werte ebenso wenig");
// 🪤 Felder, die das Höhenfeld nichts angehen, dürfen keinen Neubau auslösen.
assert.strictEqual(ecosystemHeightRelevantChange(gebirge(), gebirge({ region_name: "anders", is_trial: true })),
	false, "Name und Erprobungs-Flag sind dem Höhenfeld gleichgültig");

// 4. Die Art wechselt: in beide Richtungen ein Neubau -- einmal kommt ein Feld dazu, einmal fällt es weg.
assert.strictEqual(ecosystemHeightRelevantChange(gebirge({ region_type: "huegelland" }), gebirge()), true,
	"aus Hügelland wird Gebirge -> ein Feld kommt dazu");
assert.strictEqual(ecosystemHeightRelevantChange(gebirge(), gebirge({ region_type: "huegelland" })), true,
	"aus Gebirge wird Hügelland -> ein Feld fällt weg");
assert.strictEqual(ecosystemHeightRelevantChange(gebirge({ kind: "vegetation" }), gebirge()), true,
	"und die Ebene zählt genauso");

// 5. Zwei Flächen, die beide nichts mit dem Höhenfeld zu tun haben, lösen nie etwas aus -- auch dann
//    nicht, wenn sich an ihnen Geländespalten ändern (die dort bedeutungslos sind).
const wald = (extra) => gebirge(Object.assign({ kind: "vegetation", region_type: "wald" }, extra || {}));
assert.strictEqual(ecosystemHeightRelevantChange(wald(), wald({ terrain_avg_height: 9000 })), false,
	"Geländespalten an einer Vegetationsfläche gehen das Höhenfeld nichts an");

console.log("ecosystem-loader-height-invalidation: all assertions passed");
