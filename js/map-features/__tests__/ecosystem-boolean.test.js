const assert = require("assert");
const path = require("path");

// The REAL library the app ships, not a stub: the whole question this file answers is whether
// multipolygons survive the real sweep-line implementation.
global.window = { polygonClipping: require(path.join(__dirname, "../../third-party/polygon-clipping.umd.min.js")) };

// Handed over deliberately, as browser globals are (164 <script> tags, one scope). The REAL ones, so
// the test also proves the two files agree about what a "part" and an "area" are.
const { ecosystemGeometryParts, ecosystemGeometryArea, ecosystemGeometryBounds } = require("../map-features-ecosystem-geometry.js");
global.ecosystemGeometryBounds = ecosystemGeometryBounds;
global.ecosystemGeometryParts = ecosystemGeometryParts;
global.ecosystemGeometryArea = ecosystemGeometryArea;

const {
	ecosystemBooleanGeometry,
	ecosystemBooleanConsumesTarget,
	ECOSYSTEM_BOOLEAN_OPERATIONS,
	ecosystemSplitGeometry,
	ecosystemExtractPart,
	ecosystemMoveGeometry,
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
// 🔴 Union and plain difference eat their target, mirroring the territories: the merged shape would
// otherwise exist twice, and a subtraction's target is usually a throwaway stencil. The KEEPING
// variant is the one that leaves the lake standing after it was cut out of the forest.
assert.strictEqual(ecosystemBooleanConsumesTarget("union"), true);
assert.strictEqual(ecosystemBooleanConsumesTarget("intersection"), false);
assert.strictEqual(ecosystemBooleanConsumesTarget("difference-keep-target"), false);
assert.deepStrictEqual(ECOSYSTEM_BOOLEAN_OPERATIONS.map((entry) => entry.operation),
	["union", "difference", "difference-keep-target", "intersection"]);
// The keeping variant computes exactly the same shape -- only the target's fate differs.
assert.deepStrictEqual(
	ecosystemBooleanGeometry("difference-keep-target", box(0, 0, 100, 100), box(40, 40, 60, 60)),
	clearing, "difference-keep-target is the same subtraction");
assert.strictEqual(ecosystemBooleanConsumesTarget("difference"), true, "plain difference eats the cutter");

// --------------------------------------------------------------------------------- SPLIT ---
// Two clicks define a line; the line becomes a thin cutter and is subtracted. It only counts as a
// split if the result has MORE parts than before -- otherwise the line merely nicked the edge.
const splitStraight = ecosystemSplitGeometry(box(0, 0, 100, 20), { x: 50, y: -10 }, { x: 50, y: 30 });
assert.strictEqual(splitStraight.kept.type, "Polygon");
assert.strictEqual(splitStraight.split.type, "Polygon");
// The larger half stays with the source; the rest becomes the new area. Both halves here are ~equal,
// so assert on the sum instead of guessing which way the tie fell.
const splitTotal = ecosystemGeometryArea(splitStraight.kept) + ecosystemGeometryArea(splitStraight.split);
assert.ok(splitTotal > 1900 && splitTotal < 2000, "the cutter removes only its own hairline width");
assert.ok(ecosystemGeometryArea(splitStraight.kept) >= ecosystemGeometryArea(splitStraight.split),
	"the bigger half keeps the original row");

// 🪤 Two points anywhere cut all the way through: the cutter is extended far past the bounding box on
// purpose, so a short drag still separates. A stubby line inside the shape is therefore a REAL split,
// not a nick -- the guard is not about the line's length.
const stubby = ecosystemSplitGeometry(box(0, 0, 100, 20), { x: 10, y: 5 }, { x: 20, y: 8 });
assert.strictEqual(ecosystemGeometryParts(stubby.kept).length, 1);
assert.strictEqual(ecosystemGeometryParts(stubby.split).length, 1, "the short drag still cut it in two");

// What the guard IS about: a line whose EXTENDED path still misses the shape. Note the extension is
// along the line's own direction, so a diagonal far away can still swing back through the shape --
// this one is horizontal and stays at y=100, well clear of the 0..20 box.
assert.throws(() => ecosystemSplitGeometry(box(0, 0, 100, 20), { x: 0, y: 100 }, { x: 100, y: 100 }),
	/trennt/i, "a cut that misses the area is refused, not saved as a no-op");
assert.throws(() => ecosystemSplitGeometry(box(0, 0, 100, 20), { x: 5, y: 5 }, { x: 5, y: 5 }),
	/zwei|Punkt/i, "a zero-length line is refused");

// 💣 Splitting a MULTIPART area: the cut must apply to the part it crosses and leave the others whole.
const splitMulti = ecosystemSplitGeometry(twoIslands, { x: 5, y: -10 }, { x: 5, y: 20 });
const keptParts = ecosystemGeometryParts(splitMulti.kept).length + ecosystemGeometryParts(splitMulti.split).length;
assert.strictEqual(keptParts, 3, "one island became two, the far one is untouched");

// -------------------------------------------------------------------------------- EXTRACT ---
// Pull ONE part out of a multipart area -- the operation that turns an exclave into its own region.
const pulled = ecosystemExtractPart(twoIslands, 1);
assert.strictEqual(pulled.extracted.type, "Polygon", "the pulled part is a plain polygon");
assert.strictEqual(pulled.remainder.type, "Polygon", "one part left behind, so it narrows back");
assert.strictEqual(Math.round(ecosystemGeometryArea(pulled.extracted)), 100);
assert.strictEqual(Math.round(ecosystemGeometryArea(pulled.remainder)), 100);

// Holes travel with their part rather than being dropped or left behind.
const holedTwoParts = ecosystemBooleanGeometry("union", clearing, box(200, 200, 210, 210));
const holedIndex = ecosystemGeometryParts(holedTwoParts).findIndex((part) => part.length === 2);
const pulledHoled = ecosystemExtractPart(holedTwoParts, holedIndex);
assert.strictEqual(ecosystemGeometryParts(pulledHoled.extracted)[0].length, 2, "the hole came along");
assert.strictEqual(Math.round(ecosystemGeometryArea(pulledHoled.extracted)), 9600);

// The last remaining part cannot be extracted -- that would leave an area with no geometry at all.
assert.throws(() => ecosystemExtractPart(box(0, 0, 10, 10), 0), /einzige|letzte/i);
assert.throws(() => ecosystemExtractPart(twoIslands, 7), /Teil/i, "an index out of range is refused");

// ----------------------------------------------------------------------------------- MOVE ---
// Every ring of every part shifts by the same delta -- holes included, or a moved forest would leave
// its clearing behind.
const moved = ecosystemMoveGeometry(clearing, 5, -3);
assert.strictEqual(ecosystemGeometryParts(moved)[0].length, 2, "the hole moved with it");
assert.strictEqual(Math.round(ecosystemGeometryArea(moved)), Math.round(ecosystemGeometryArea(clearing)),
	"moving changes position, never size");
assert.deepStrictEqual(ecosystemGeometryParts(moved)[0][0][0], [5, -3], "origin corner shifted exactly");
const movedMulti = ecosystemMoveGeometry(twoIslands, 1000, 1000);
assert.strictEqual(ecosystemGeometryParts(movedMulti).length, 2, "both parts moved, none dropped");

console.log("ecosystem boolean tests passed");
