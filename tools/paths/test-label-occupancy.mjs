// Unit test (Node, no build) for the pure parts of the shared label occupancy map in
// js/map-features/map-features-label-occupancy.js:
//   - labelBoxesOverlap(a, b): axis-aligned box overlap, touching edges do NOT count.
//   - labelOccupancyCellKeys(box, cellPx): every grid cell a box touches.
//   - labelBoxCorners(box) / labelGlyphCorners(glyph): corner lists for the SAT test; a glyph box is
//     ROTATED (a letter sits on the tangent of its road), which is why the axis-aligned hull is not
//     good enough on slanted roads.
//   - labelPolygonsOverlap(a, b): separating-axis test over two convex quads.
//   - createLabelOccupancyGrid(cellPx): add/hits/reset over the grid; hits() must return every box in
//     the touched cells exactly once (it de-duplicates via a stamp, not a per-query Set).
//   - labelOccupancyBlocksGlyphs(grid, hull, glyphs): the two-stage test the path-label overlay runs
//     per candidate placement -- coarse hull against the grid, then per letter with SAT.
//
// Why this file exists: the whole "way names yield to place names" strategy (2026-08-05) rests on this
// grid answering "is this spot taken?" correctly. A miss here does not crash anything -- it silently
// draws a road name across a village name again, i.e. exactly the bug it was built to remove.
//
// Run: node tools/paths/test-label-occupancy.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-label-occupancy.js"), "utf8");

function extractFunction(sourceText, name) {
	const startMarker = `function ${name}(`;
	const startIndex = sourceText.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = sourceText.indexOf("{", startIndex);
	let depth = 0;
	for (; i < sourceText.length; i++) {
		const ch = sourceText[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return sourceText.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

function extractConst(sourceText, name) {
	const startMarker = `const ${name} = `;
	const startIndex = sourceText.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`const ${name} not found in source`);
	}
	const endIndex = sourceText.indexOf(";", startIndex);
	return sourceText.slice(startIndex, endIndex + 1);
}

const sandbox = new Function(`
	${extractConst(source, "LABEL_OCCUPANCY_CELL_PX")}
	${extractFunction(source, "labelBoxesOverlap")}
	${extractFunction(source, "labelBoxCorners")}
	${extractFunction(source, "labelGlyphCorners")}
	${extractFunction(source, "labelPolygonsOverlap")}
	${extractFunction(source, "labelOccupancyCellKeys")}
	${extractFunction(source, "createLabelOccupancyGrid")}
	${extractFunction(source, "labelOccupancyBlocksGlyphs")}
	return { LABEL_OCCUPANCY_CELL_PX, labelBoxesOverlap, labelBoxCorners, labelGlyphCorners,
		labelPolygonsOverlap, labelOccupancyCellKeys, createLabelOccupancyGrid, labelOccupancyBlocksGlyphs };
`)();
const {
	LABEL_OCCUPANCY_CELL_PX, labelBoxesOverlap, labelBoxCorners, labelGlyphCorners,
	labelPolygonsOverlap, labelOccupancyCellKeys, createLabelOccupancyGrid, labelOccupancyBlocksGlyphs,
} = sandbox;

const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const results = [];
function check(name, fn) {
	try {
		fn();
		results.push(`  ok  ${name}`);
	} catch (error) {
		results.push(`FAIL  ${name}\n      ${error.message}`);
		process.exitCode = 1;
	}
}

// --- labelBoxesOverlap ---------------------------------------------------------------------------
check("overlapping boxes are detected", () => {
	assert.equal(labelBoxesOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
});
check("disjoint boxes are not", () => {
	assert.equal(labelBoxesOverlap(box(0, 0, 10, 10), box(20, 0, 30, 10)), false);
});
check("boxes that merely touch at an edge do NOT overlap", () => {
	// Strict inequalities on purpose: a label whose padding ends exactly where the next one starts is
	// still readable, and treating that as a clash would drop names for nothing.
	assert.equal(labelBoxesOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10)), false);
});

// --- labelOccupancyCellKeys ----------------------------------------------------------------------
check("a box inside one cell yields exactly one key", () => {
	assert.deepEqual(labelOccupancyCellKeys(box(10, 10, 20, 20), 128), ["0|0"]);
});
check("a box spanning a cell border yields every touched cell", () => {
	const keys = labelOccupancyCellKeys(box(120, 120, 140, 140), 128);
	assert.deepEqual(keys.slice().sort(), ["0|0", "0|1", "1|0", "1|1"]);
});
check("negative coordinates land in negative cells (labels may sit left of the map container)", () => {
	assert.deepEqual(labelOccupancyCellKeys(box(-20, -20, -10, -10), 128), ["-1|-1"]);
});
check("the default cell size is used when none is given", () => {
	assert.equal(LABEL_OCCUPANCY_CELL_PX, 128);
	assert.deepEqual(labelOccupancyCellKeys(box(0, 0, 1, 1)), ["0|0"]);
});

// --- the grid ------------------------------------------------------------------------------------
check("hits() finds a box in a neighbouring cell", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(100, 100, 160, 160));           // spans cells 0|0 and 1|1
	assert.equal(grid.hits(box(130, 130, 135, 135)).length, 1);
	assert.equal(grid.hits(box(400, 400, 410, 410)).length, 0);
});
check("hits() returns a multi-cell box only ONCE", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(100, 100, 300, 300));           // spans 4+ cells
	assert.equal(grid.hits(box(110, 110, 290, 290)).length, 1);
});
check("two successive queries both see the same box (the stamp must not lock it out)", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(0, 0, 50, 50));
	assert.equal(grid.hits(box(10, 10, 20, 20)).length, 1);
	assert.equal(grid.hits(box(10, 10, 20, 20)).length, 1);
});
check("reset() really empties the grid", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(0, 0, 50, 50));
	assert.equal(grid.isEmpty(), false);
	grid.reset();
	assert.equal(grid.isEmpty(), true);
	assert.equal(grid.hits(box(10, 10, 20, 20)).length, 0);
});
check("degenerate boxes are ignored instead of poisoning a cell", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(10, 10, 10, 50));   // zero width
	grid.add(box(10, 10, 50, 10));   // zero height
	assert.equal(grid.isEmpty(), true);
});

// --- SAT -----------------------------------------------------------------------------------------
check("an unrotated glyph over a box is a hit", () => {
	const glyph = { x: 10, y: 10, ang: 0, w: 8, h: 10 };
	assert.equal(labelPolygonsOverlap(labelGlyphCorners(glyph), labelBoxCorners(box(0, 0, 20, 20))), true);
});
check("a glyph clearly beside the box is not", () => {
	const glyph = { x: 100, y: 100, ang: 0, w: 8, h: 10 };
	assert.equal(labelPolygonsOverlap(labelGlyphCorners(glyph), labelBoxCorners(box(0, 0, 20, 20))), false);
});
check("rotation is what decides the near case", () => {
	// A letter whose centre sits 7px right of the box edge: upright it reaches 4px left (half its
	// width) and stays clear, turned 45 degrees it reaches (4+8)/sqrt(2) = 8.49px and crosses in.
	// Exactly the situation on a slanted road, and the reason the test is SAT and not an axis-aligned
	// hull -- that hull would call BOTH of these a clash and drop a readable name.
	const upright = { x: 27, y: 10, ang: 0, w: 8, h: 16 };
	const turned = { x: 27, y: 10, ang: Math.PI / 4, w: 8, h: 16 };
	const obstacle = labelBoxCorners(box(0, 0, 20, 20));
	assert.equal(labelPolygonsOverlap(labelGlyphCorners(upright), obstacle), false);
	assert.equal(labelPolygonsOverlap(labelGlyphCorners(turned), obstacle), true);
});

// --- the two-stage test the overlay runs ---------------------------------------------------------
check("labelOccupancyBlocksGlyphs: free spot passes", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(0, 0, 40, 40));
	const glyphs = [{ x: 300, y: 300, ang: 0, w: 8, h: 10 }];
	assert.equal(labelOccupancyBlocksGlyphs(grid, box(280, 280, 320, 320), glyphs), false);
});
check("labelOccupancyBlocksGlyphs: a single letter on a name is enough to block", () => {
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(0, 0, 40, 40));
	const glyphs = [
		{ x: 200, y: 200, ang: 0, w: 8, h: 10 },
		{ x: 20, y: 20, ang: 0, w: 8, h: 10 },   // this one sits on the obstacle
	];
	assert.equal(labelOccupancyBlocksGlyphs(grid, box(0, 0, 220, 220), glyphs), true);
});
check("labelOccupancyBlocksGlyphs: hull touches a cell but no letter actually does -> free", () => {
	// The coarse hull is deliberately generous (a whole font size of padding). It only preselects; the
	// letters decide. Without this second stage the strategy would drop readable names.
	const grid = createLabelOccupancyGrid(128);
	grid.add(box(0, 0, 10, 10));
	const glyphs = [{ x: 60, y: 60, ang: 0, w: 8, h: 10 }];
	assert.equal(labelOccupancyBlocksGlyphs(grid, box(5, 5, 100, 100), glyphs), false);
});
check("labelOccupancyBlocksGlyphs: empty grid or no glyphs never blocks", () => {
	const grid = createLabelOccupancyGrid(128);
	assert.equal(labelOccupancyBlocksGlyphs(grid, box(0, 0, 10, 10), [{ x: 5, y: 5, ang: 0, w: 8, h: 10 }]), false);
	grid.add(box(0, 0, 40, 40));
	assert.equal(labelOccupancyBlocksGlyphs(grid, box(0, 0, 10, 10), []), false);
	assert.equal(labelOccupancyBlocksGlyphs(null, box(0, 0, 10, 10), [{ x: 5, y: 5, ang: 0, w: 8, h: 10 }]), false);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\nFAILED" : `\nall ${results.length} checks passed`);
