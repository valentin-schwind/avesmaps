// js/map-features/__tests__/ecosystem-heightmap-raster.test.js
//
// V11: the pure browser-side rasteriser. Run from the repo root:
//   node js/map-features/__tests__/ecosystem-heightmap-raster.test.js
// Exit 0 = all asserts passed.
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

// The height modules are plain <script> files with module.exports at the bottom; the geometry helpers
// they call are globals. Load them into ONE shared context so the globals resolve.
// 💣 A stub in the sandbox would swallow the very rule under test -- these are the REAL files.
//
// 🪤 Only the NON-intrinsic globals are handed in. Every vm context gets its own Math, Object,
// Array, Promise, Number, JSON and the typed arrays for free; `console`, `Buffer`, `setTimeout`
// and `module` it does NOT. Those four are exactly the ones the modules reach for --
// ecosystemHeightmapToBase64 falls back to Buffer because `btoa` is absent here, and the
// rasteriser's default yield is a setTimeout. Listing the intrinsics instead (and forgetting these)
// is how this harness fails with a bare "Buffer is not defined" halfway through.
//
// 🩹 CORRECTED: `Uint16Array` is ALSO handed in, despite being exactly the kind of intrinsic the
// paragraph above says every vm context gets "for free". It does -- but "its own" means its own:
// a fresh, distinct constructor, not the one this outer script's `instanceof` checks against.
// Verified empirically (`arr instanceof Uint16Array` is false for a same-shaped typed array built
// inside an unmodified vm.createContext sandbox, true once the outer constructor is pre-seeded here
// -- the sandbox's OWN property wins over the realm's default intrinsic of the same name). Without
// this the raster test can never pass `samples instanceof Uint16Array`, regardless of how correct
// rasterizeEcosystemHeightField is -- that assertion is checked out here, in THIS realm.
const context = { module: { exports: {} }, console, Buffer, setTimeout, Uint16Array };
context.globalThis = context;
vm.createContext(context);
// 🩹 CORRECTED: the brief's list omitted map-features-point-in-polygon.js. Both height-field.js and
// height-combine.js call the global `pointInGeometry` (buildEcosystemHeightField's own-peak filter,
// ecosystemHeightLevel's bump placement, assignEcosystemPeaksToAreas, ...) but neither DEFINES it --
// it lives in this fifth file, loaded here exactly as index.html and the sibling
// ecosystem-height-combine.test.js (via explicit `global.pointInGeometry = ...`) both do. Without it
// the vm context throws "pointInGeometry is not defined" the moment buildEcosystemHeightStack runs.
["map-features-point-in-polygon.js",
 "map-features-ecosystem-geometry.js",
 "map-features-ecosystem-height-field.js",
 "map-features-ecosystem-height-combine.js",
 "map-features-ecosystem-heightmap-raster.js"].forEach((file) => {
	const full = path.join(__dirname, "..", file);
	context.module = { exports: {} };
	vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: full });
});

const square = (minX, minY, size) => ({
	type: "Polygon",
	coordinates: [[[minX, minY], [minX + size, minY], [minX + size, minY + size], [minX, minY + size], [minX, minY]]],
});

// --- the grid is DETERMINISTIC and snapped to the cell lattice ---------------------------------
// 💣 Two rasters that do not share a lattice still sum correctly (each is sampled on its own), but
// an unsnapped origin makes the same area produce a different grid after a bbox nudge -- and then
// „did the raster change?" has no stable answer.
const grid = context.ecosystemHeightmapGrid({ min_x: 10.1, min_y: 20.3, max_x: 11.1, max_y: 21.3 }, 0.25);
assert.strictEqual(grid.originX, 10.0, "the origin snaps DOWN to the cell lattice");
assert.strictEqual(grid.originY, 20.25, "the origin snaps DOWN to the cell lattice");
assert.ok(grid.originX + (grid.width - 1) * 0.25 >= 11.1, "the grid must cover the whole bbox in x");
assert.ok(grid.originY + (grid.height - 1) * 0.25 >= 21.3, "the grid must cover the whole bbox in y");
assert.strictEqual(grid.cellSize, 0.25, "the cell size travels with the grid");

// The same bbox twice gives the same grid -- no drift, no rounding wobble.
const again = context.ecosystemHeightmapGrid({ min_x: 10.1, min_y: 20.3, max_x: 11.1, max_y: 21.3 }, 0.25);
assert.deepStrictEqual(again, grid, "the grid is a function of the bbox alone");

(async () => {
	const area = { public_id: "a", geometry_revision: 1, geometry: square(0, 0, 40), region_type: "gebirge" };
	const peaks = [{ publicId: "p", x: 20, y: 20, height: 3000 }];
	const stack = context.buildEcosystemHeightStack([area], peaks);
	assert.strictEqual(stack.fields.length, 1, "the test area must actually carry a field");
	const field = stack.fields[0];
	const box = context.ecosystemGeometryBounds(area.geometry);
	const g = context.ecosystemHeightmapGrid(box, 0.25);

	let bands = 0;
	let yields = 0;
	const samples = await context.rasterizeEcosystemHeightField(field, stack.peakWindow, g, {
		onRowBand: () => { bands += 1; },
		yield: async () => { yields += 1; },
	});

	// --- shape ---------------------------------------------------------------------------------
	assert.ok(samples instanceof Uint16Array, "the raster is a Uint16Array, not an array of numbers");
	assert.strictEqual(samples.length, g.width * g.height, "one sample per grid point");

	// --- 💣 THE PIXEL IS THE HEIGHT IN SCHRITT. No white point, no per-area stretch. The display
	// knows two scales (a global 5.000er white point and, while editing, max(100, tallest peak of the
	// stack)); storing THOSE pixels would give every mountain range a different scale and gradients
	// wrong by exactly that stretch -- differently wrong per area, and visible to nobody.
	const peakIndex = Math.round((20 - g.originY) / 0.25) * g.width + Math.round((20 - g.originX) / 0.25);
	assert.ok(samples[peakIndex] > 2900 && samples[peakIndex] <= 3000,
		"the peak cell must read its entered height in Schritt, got " + samples[peakIndex]);

	// --- the foot-height-0 invariant survives rasterising -----------------------------------------
	assert.strictEqual(samples[0], 0, "the bbox corner lies outside the area and must be 0");

	// --- every value matches a direct field sample, to the rounding ------------------------------
	for (const [col, row] of [[3, 3], [10, 12], [g.width - 4, g.height - 4]]) {
		const x = g.originX + col * 0.25;
		const y = g.originY + row * 0.25;
		const direct = context.sampleEcosystemHeightField(field, x, y, stack.peakWindow.sample(x, y));
		assert.strictEqual(samples[row * g.width + col], Math.max(0, Math.min(65535, Math.round(direct))),
			"the raster must be the field, rounded -- nothing else");
	}

	// --- 💣 the main thread is released per row band. Without it 1,4 million pixels at 40 areas
	// freeze the tab for seconds and Chrome offers „page unresponsive".
	assert.ok(yields > 0, "the rasteriser must yield the main thread at least once");
	assert.ok(bands > 0, "the rasteriser must report progress per row band");

	// --- clamping is explicit, never a silent wrap ------------------------------------------------
	// 65.535 Schritt is four times the owner's 15.000 ceiling; a value above it is a data fault, and
	// wrapping to a low number would turn a mountain into a valley.
	const tall = { public_id: "b", geometry_revision: 1, geometry: square(0, 0, 40), region_type: "gebirge" };
	const tallStack = context.buildEcosystemHeightStack([tall], [{ publicId: "q", x: 20, y: 20, height: 90000 }]);
	const tallSamples = await context.rasterizeEcosystemHeightField(
		tallStack.fields[0], tallStack.peakWindow, g, {});
	assert.ok(Math.max(...tallSamples) === 65535, "an over-tall value clamps at 65535, it does not wrap");

	// --- base64 round trip, little-endian -----------------------------------------------------
	const encoded = context.ecosystemHeightmapToBase64(new Uint16Array([1, 258]));
	const bytes = Buffer.from(encoded, "base64");
	assert.strictEqual(bytes.length, 4, "two uint16 are four bytes");
	assert.deepStrictEqual([...bytes], [1, 0, 2, 1], "little-endian, as the PHP reader's unpack('v') expects");

	console.log("ecosystem-heightmap-raster.test: all asserts passed");
})().catch((error) => { console.error(error); process.exit(1); });
