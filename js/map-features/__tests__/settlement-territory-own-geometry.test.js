// The ray-cast assignment must pick a territory's geometry by PROVENANCE, never by position in
// the layer response. Regression fixture: the Alanfanisches Imperium as the live editor layer
// serves it (measured 2026-08-18) -- eight features under ONE territory_public_id, where the
// FIRST one is an aggregate fragment belonging to Grosskoenigreich Selem (a 3.8 x 5.7 unit patch
// in Uthuria) and the empire's own mainland polygon -- the only one covering its capital
// Al'Anfa (414.0745 / 151.9697) -- sits at index 2. Taking features[0] tested the empire against
// Selem's patch, so Al'Anfa scored zero hits and stayed "nicht zugeordnet".
const assert = require("assert");
const {
  selectOwnTerritoryFeatures,
  buildTerritoryGeometryEntries,
  geometryArea,
} = require("../map-features-settlement-territory-assign.js");
const { territoriesContainingPoint } = require("../map-features-point-in-polygon.js");

const IMPERIUM = "0a443a3c-2da8-420c-b1e2-7d89e3a1ffc7";
const SELEM = "11b17757-72af-45dc-abb1-e4c5d485e335";
const AL_ANFA = [414.0745, 151.9697];

// Axis-aligned box as a GeoJSON Polygon feature, so the fixture reads as the measured bboxes do.
function boxFeature(id, minX, minY, maxX, maxY, extraProperties = {}) {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Polygon",
      coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
    },
    properties: Object.assign({ territory_public_id: IMPERIUM, geometry_public_id: id }, extraProperties),
  };
}

// Order and provenance exactly as the layer serves them (base features first, derived hull last).
const imperiumFeatures = [
  boxFeature("38a7624e", 487.1, 234.0, 490.9, 239.7, { aggregate_source_territory_public_id: SELEM }),
  boxFeature("c3980faa", 394.2, 109.1, 512.8, 260.3), // own mainland -- covers Al'Anfa
  boxFeature("01bd5533", 686.5, 37.0, 694.4, 42.6), // own, elsewhere
  boxFeature("583c1661", 394.2, 37.0, 806.0, 260.3, { is_derived_geometry: true }), // derived hull
];

// --- selectOwnTerritoryFeatures: provenance, not position -------------------------------------
const own = selectOwnTerritoryFeatures(imperiumFeatures);
assert.deepStrictEqual(
  own.map((feature) => feature.id),
  ["c3980faa", "01bd5533"],
  "own geometries only -- no foreign aggregate fragment, no derived hull"
);

assert.deepStrictEqual(
  selectOwnTerritoryFeatures([]).map((feature) => feature.id),
  [],
  "no features -> no own features"
);

// An empty-string aggregate source is what the layer actually sends for an own geometry.
assert.strictEqual(
  selectOwnTerritoryFeatures([boxFeature("own", 0, 0, 1, 1, { aggregate_source_territory_public_id: "" })]).length,
  1,
  "empty aggregate_source_territory_public_id means own geometry"
);

console.log("selectOwnTerritoryFeatures tests passed");

// --- buildTerritoryGeometryEntries: every own geometry travels, area is their sum -------------
const entries = buildTerritoryGeometryEntries([
  { territory_public_id: IMPERIUM, features: imperiumFeatures },
]);
assert.strictEqual(entries.length, 1, "one entry per territory");
assert.deepStrictEqual(
  entries[0].features.map((feature) => feature.id),
  ["c3980faa", "01bd5533"],
  "the entry carries EVERY own geometry, not just the first"
);
// 118.6 * 151.2 + 7.9 * 5.6 -- the tiebreak compares whole territories, so it needs the sum.
assert.ok(
  Math.abs(entries[0].area - (118.6 * 151.2 + 7.9 * 5.6)) < 0.01,
  `area is the sum of all own geometries (got ${entries[0].area})`
);

// A territory the layer only ever serves as a derived hull is NOT a ray-cast candidate: the hull
// spans the gaps between its children, and a settlement in such a gap must stay unassigned.
const hullOnly = buildTerritoryGeometryEntries([
  { territory_public_id: "hull-only", features: [boxFeature("hull", 0, 0, 10, 10, { is_derived_geometry: true })] },
]);
assert.deepStrictEqual(hullOnly, [], "a hull-only territory produces no entry");

console.log("buildTerritoryGeometryEntries tests passed");

// --- The bug itself: Al'Anfa scores a hit on its empire ---------------------------------------
const features = entries.flatMap((entry) => entry.features);
const hits = territoriesContainingPoint(AL_ANFA, features).map((hit) => hit.territory_public_id);
assert.deepStrictEqual(hits, [IMPERIUM], "Al'Anfa hits the Alanfanisches Imperium");

// Guard the regression from the other side: position-based selection would have tested Selem's
// patch and found nothing.
assert.deepStrictEqual(
  territoriesContainingPoint(AL_ANFA, [imperiumFeatures[0]]).map((hit) => hit.territory_public_id),
  [],
  "the feature that used to be tested (features[0]) does NOT contain Al'Anfa"
);

console.log("Al'Anfa ray-cast regression test passed");

// --- mergeTerritoryFeatureGeometry: one shape per territory for area/overlap callers ----------
// The Landschaften editor's "Liegt in" needs ONE geometry per territory to clip against, not a
// list. Merging the own parts into a MultiPolygon is what makes a four-part territory weigh four
// parts there too.
const { mergeTerritoryFeatureGeometry } = require("../map-features-settlement-territory-assign.js");

const merged = mergeTerritoryFeatureGeometry(entries[0].features);
assert.strictEqual(merged.type, "MultiPolygon", "merged shape is a MultiPolygon");
assert.strictEqual(merged.coordinates.length, 2, "both own parts travel");
assert.ok(
  Math.abs(geometryArea(merged) - entries[0].area) < 0.01,
  "merged area matches the entry's summed area"
);

// A single-part territory keeps its one part; nothing to merge is null, never an empty shape that
// would read as "a territory with zero area".
assert.strictEqual(mergeTerritoryFeatureGeometry([boxFeature("solo", 0, 0, 2, 2)]).coordinates.length, 1, "single part");
assert.strictEqual(mergeTerritoryFeatureGeometry([]), null, "no features -> null");

console.log("mergeTerritoryFeatureGeometry tests passed");
