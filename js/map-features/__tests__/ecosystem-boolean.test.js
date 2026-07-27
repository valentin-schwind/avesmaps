const assert = require("assert");
const path = require("path");

// The REAL library the app ships, not a stub: the whole question this file answers is whether
// multipolygons survive the real sweep-line implementation.
global.window = { polygonClipping: require(path.join(__dirname, "../../third-party/polygon-clipping.umd.min.js")) };

// Handed over deliberately, as browser globals are (164 <script> tags, one scope). The REAL ones, so
// the test also proves the two files agree about what a "part" and an "area" are.
const { ecosystemGeometryParts, ecosystemGeometryArea } = require("../map-features-ecosystem-geometry.js");
global.ecosystemGeometryParts = ecosystemGeometryParts;
global.ecosystemGeometryArea = ecosystemGeometryArea;

const {
	ecosystemBooleanGeometry,
	ecosystemBooleanConsumesTarget,
	ECOSYSTEM_BOOLEAN_OPERATIONS,
} = require("../map-features-ecosystem-boolean.js");

const box = (x1, y1, x2, y2) => ({
	type: "Polygon",
	coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
});
const parts = (geometry) => ecosystemGeometryParts(geometry).length;
const rings = (geometry, part = 0) => ecosystemGeometryParts(geometry)[part].length;

// ------------------------------------------------------------------ EXCLAVES OUT OF NOTHING ---
// 💣 The reason this had to be built before the raycast: a union of two DISJOINT areas produces a
// MultiPolygon. If anything downstream assumed "one area = one ring", it breaks here first.
const twoIslands = ecosystemBooleanGeometry("union", box(0, 0, 10, 10), box(50, 50, 60, 60));
assert.strictEqual(twoIslands.type, "MultiPolygon", "disjoint union must widen to MultiPolygon");
assert.strictEqual(parts(twoIslands), 2, "and it keeps both parts");
assert.strictEqual(Math.round(ecosystemGeometryArea(twoIslands)), 200);

// Overlapping union collapses back to a single Polygon -- the type follows the shape, not the input.
const merged = ecosystemBooleanGeometry("union", box(0, 0, 10, 10), box(5, 0, 15, 10));
assert.strictEqual(merged.type, "Polygon", "an overlapping union is one part again");
assert.strictEqual(Math.round(ecosystemGeometryArea(merged)), 150);

// ------------------------------------------------------------------ ENCLAVES OUT OF NOTHING ---
// A clearing punched into the middle of a forest: one part, TWO rings. The hole is the enclave.
const clearing = ecosystemBooleanGeometry("difference", box(0, 0, 100, 100), box(40, 40, 60, 60));
assert.strictEqual(clearing.type, "Polygon", "a hole does not make it multipart");
assert.strictEqual(parts(clearing), 1);
assert.strictEqual(rings(clearing), 2, "outer ring plus the hole");
assert.strictEqual(Math.round(ecosystemGeometryArea(clearing)), 10000 - 400, "the hole is subtracted, not ignored");

// A cut straight across splits one area into two. Exclaves again, this time by subtraction.
const cut = ecosystemBooleanGeometry("difference", box(0, 0, 100, 20), box(40, -5, 60, 25));
assert.strictEqual(cut.type, "MultiPolygon", "a through-cut splits the area");
assert.strictEqual(parts(cut), 2);

// ------------------------------------------------------- MULTIPOLYGON AND HOLES AS *INPUT* ---
// Everything above produced multiparts. Now feed one back IN -- that is the round trip the editor
// will actually do, operation after operation on the same area.
const grown = ecosystemBooleanGeometry("union", twoIslands, box(8, 8, 52, 52));
assert.strictEqual(grown.type, "Polygon", "the bridge joins both islands into one part");
assert.strictEqual(parts(grown), 1);

// A polygon that ALREADY has a hole must keep it when something unrelated is unioned on.
const holedPlusFar = ecosystemBooleanGeometry("union", clearing, box(200, 200, 210, 210));
assert.strictEqual(parts(holedPlusFar), 2, "two parts now");
const holedPart = ecosystemGeometryParts(holedPlusFar).find((part) => part.length === 2);
assert.ok(holedPart, "the existing hole survived the union");

// Filling the hole back in is a union with the hole's own shape.
const filled = ecosystemBooleanGeometry("union", clearing, box(40, 40, 60, 60));
assert.strictEqual(rings(filled), 1, "the hole is gone");
assert.strictEqual(Math.round(ecosystemGeometryArea(filled)), 10000);

// ------------------------------------------------------------------------------ INTERSECTION ---
const overlap = ecosystemBooleanGeometry("intersection", box(0, 0, 10, 10), box(5, 5, 20, 20));
assert.strictEqual(Math.round(ecosystemGeometryArea(overlap)), 25);

// Intersecting a multipart with a box that only covers ONE part drops the other.
const onlyOne = ecosystemBooleanGeometry("intersection", twoIslands, box(-5, -5, 20, 20));
assert.strictEqual(onlyOne.type, "Polygon");
assert.strictEqual(Math.round(ecosystemGeometryArea(onlyOne)), 100);

// ------------------------------------------------------------------------------- THE GUARDS ---
// An operation that leaves nothing must fail loudly. Silently writing an empty geometry would erase
// the area on the next save, and update_area_geometry would happily accept it.
assert.throws(() => ecosystemBooleanGeometry("difference", box(0, 0, 10, 10), box(-5, -5, 15, 15)),
	/keine|leer/i, "subtracting everything is refused, not saved as empty");
assert.throws(() => ecosystemBooleanGeometry("intersection", box(0, 0, 10, 10), box(50, 50, 60, 60)),
	/keine|leer/i, "a miss is refused");
assert.throws(() => ecosystemBooleanGeometry("nonsense", box(0, 0, 10, 10), box(5, 5, 15, 15)),
	/Unbekannte/i, "an unknown operation is refused rather than guessed");

// ------------------------------------------------------------------------ TARGET CONSUMPTION ---
// 🔴 Only the union eats its target -- otherwise the merged shape would exist twice. Subtracting and
// intersecting LEAVE the target alone: cutting a lake out of a forest must not delete the lake.
assert.strictEqual(ecosystemBooleanConsumesTarget("union"), true);
assert.strictEqual(ecosystemBooleanConsumesTarget("difference"), false);
assert.strictEqual(ecosystemBooleanConsumesTarget("intersection"), false);
assert.deepStrictEqual(ECOSYSTEM_BOOLEAN_OPERATIONS.map((entry) => entry.operation),
	["union", "difference", "intersection"]);

console.log("ecosystem boolean tests passed");
