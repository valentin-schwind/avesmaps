const assert = require("assert");
const { buildSuggestChangeButtonSpec, sizeSlugFromLocationType } = require("../suggest-change-button.js");

// sizeSlugFromLocationType: known slugs pass through (case-insensitive), unknown/empty -> "dorf".
assert.strictEqual(sizeSlugFromLocationType("stadt"), "stadt");
assert.strictEqual(sizeSlugFromLocationType("METROPOLE"), "metropole");
assert.strictEqual(sizeSlugFromLocationType(""), "dorf");
assert.strictEqual(sizeSlugFromLocationType(null), "dorf");
assert.strictEqual(sizeSlugFromLocationType("unbekannt"), "dorf");

// No entityType or no name -> null (caller renders nothing).
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "settlement", name: "" }), null);
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "", name: "Gareth" }), null);

// Settlement: carries size (from locationType), report-type, entity id + name, coords when finite.
const s = buildSuggestChangeButtonSpec({ entityType: "settlement", entityId: "loc-1", name: "Gareth", reportType: "location", size: "grossstadt", lat: 500.5, lng: 300 });
assert.strictEqual(s.attributes["data-popup-action"], "suggest-change");
assert.strictEqual(s.attributes["data-entity-type"], "settlement");
assert.strictEqual(s.attributes["data-entity-id"], "loc-1");
assert.strictEqual(s.attributes["data-name"], "Gareth");
assert.strictEqual(s.attributes["data-report-type"], "location");
assert.strictEqual(s.attributes["data-size"], "grossstadt");
assert.strictEqual(s.attributes["data-lat"], "500.5");
assert.strictEqual(s.attributes["data-lng"], "300");
assert.ok(s.iconMarkup.includes("img/menu/brief.webp"));

// Non-settlement (territory): no size attribute; no coords -> no lat/lng.
const t = buildSuggestChangeButtonSpec({ entityType: "territory", entityId: "terr-9", name: "Kosch", reportType: "territorium" });
assert.strictEqual(t.attributes["data-size"], undefined);
assert.strictEqual(t.attributes["data-lat"], undefined);
assert.strictEqual(t.attributes["data-report-type"], "territorium");

// Default label when caller passes none.
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "path", name: "Reichsstraße 1" }).label, "Änderung vorschlagen");

console.log("suggest-change-button tests passed");
