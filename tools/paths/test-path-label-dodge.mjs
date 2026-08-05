// Unit test (Node, no build) for findFreePlacement in
// js/map-features/map-features-path-label-canvas-overlay.js -- the rule that makes way and river names
// get out of the way of place names (2026-08-05).
//
// The rule in one sentence: a way name may NOT step aside (it belongs on its road), so it slides ALONG
// its own line -- the wished-for spot first, then alternating forward/back in PATH_LABEL_DODGE_STEP_PX
// steps up to PATH_LABEL_DODGE_SLIDE_PX -- and if nothing is free, the placement is dropped (the same
// name stands again ~600px further along the way).
//
// It is wired against the real occupancy map from map-features-label-occupancy.js, so this test covers
// the seam between the two files, not just one side of it.
//
// Run: node tools/paths/test-path-label-dodge.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const overlaySource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-path-label-canvas-overlay.js"), "utf8");
const occupancySource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-label-occupancy.js"), "utf8");

function extractFunction(source, name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return source.slice(startIndex, i + 1);
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

const OVERLAY_PARTS = ["labelSpanRunsLeftward", "layoutGlyphsAlong", "labelWindowHalf",
	"pathLabelBendSettings", "cumulativeLengths", "sliceLabelWindowAt", "glyphsHullBox", "findFreePlacement"];
const OCCUPANCY_PARTS = ["labelBoxCorners", "labelGlyphCorners", "labelPolygonsOverlap",
	"labelOccupancyCellKeys", "createLabelOccupancyGrid", "labelOccupancyBlocksGlyphs"];

// The tuning values live in map-features-path-labels.js and are read off the global scope; handing them
// in as parameters is what lets the test drive them.
const factory = new Function(
	"PATH_LABEL_DODGE_SLIDE_PX", "PATH_LABEL_DODGE_STEP_PX", "PATH_LABEL_DY",
	"PATH_LABEL_CURVATURE_RELIEF", "PATH_LABEL_CALM_SEARCH_PX", "PATH_LABEL_CALM_ANCHOR",
	"LABEL_OCCUPANCY_CELL_PX",
	`
	${OCCUPANCY_PARTS.map((n) => extractFunction(occupancySource, n)).join("\n")}
	const avesmapsLabelOccupancy = createLabelOccupancyGrid(LABEL_OCCUPANCY_CELL_PX);
	${OVERLAY_PARTS.map((n) => extractFunction(overlaySource, n)).join("\n")}
	return { findFreePlacement, cumulativeLengths, occupancy: avesmapsLabelOccupancy };
	`
);

function makeSandbox({ slide = 300, step = 12 } = {}) {
	return factory(slide, step, -1, 1, 0, 0, 128);
}

// A dead straight, horizontal road 1000px long -- so "slid by N px" is readable straight off the x
// coordinate, with no curve arithmetic in the way.
const STRAIGHT = [{ x: 0, y: 100 }, { x: 1000, y: 100 }];
const CHARS = [..."Reichsstrasse"];
const WIDTHS = CHARS.map(() => 8);
const LS = 0.5;
const FONT = 14;
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

function place(sandbox, wish, blockedByOwnKind = null) {
	const cum = sandbox.cumulativeLengths(STRAIGHT);
	return sandbox.findFreePlacement(STRAIGHT, cum, cum[cum.length - 1], wish, CHARS, WIDTHS, LS, FONT, blockedByOwnKind);
}

check("nothing in the way -> the name stays exactly on its wished-for spot", () => {
	const sandbox = makeSandbox();
	const found = place(sandbox, 500);
	assert.ok(found, "a free line must yield a placement");
	assert.equal(found.center, 500);
});

check("a place name on the wished-for spot -> the name slides along its own road", () => {
	const sandbox = makeSandbox();
	// One obstacle centred on 500, ~200px wide: everything within reach on that spot is taken.
	sandbox.occupancy.add(box(400, 60, 600, 140));
	const found = place(sandbox, 500);
	assert.ok(found, "there is free road left and right, so a spot must be found");
	assert.notEqual(found.center, 500);
	// It moved, but it is still ON the road (y never leaves the line, bar the 1px dy).
	found.glyphs.forEach((glyph) => {
		assert.ok(Math.abs(glyph.y - 100) <= 2, `letter left the road: y=${glyph.y}`);
	});
	// And no letter sits on the obstacle any more.
	found.glyphs.forEach((glyph) => {
		assert.ok(glyph.x < 400 || glyph.x > 600, `letter still on the place name: x=${glyph.x}`);
	});
});

check("it takes the NEAREST free spot, not just any", () => {
	const sandbox = makeSandbox();
	sandbox.occupancy.add(box(400, 60, 600, 140));
	const found = place(sandbox, 500);
	// The arithmetic: 13 letters a 8px plus 12 gaps of 0.5 = 110px of text, so the letters reach 55px
	// either side of the centre. To clear an obstacle ending at 600 the centre must sit at 655, i.e.
	// 155px from the wish -- and the search walks in 12px steps, so 156 is the FIRST spot that works.
	// Anything much beyond that would mean the search stepped over free road.
	const slid = Math.abs(found.center - 500);
	assert.ok(slid >= 155, `stopped before the obstacle was cleared: ${slid}px`);
	assert.ok(slid <= 155 + 12, `slid past a free spot: ${slid}px`);
});

check("everything within reach taken -> no placement (the name is dropped, not squeezed in)", () => {
	const sandbox = makeSandbox();
	sandbox.occupancy.add(box(0, 60, 1000, 140));   // the whole road is covered
	assert.equal(place(sandbox, 500), null);
});

check("a wider slide reach finds a spot a narrow one cannot", () => {
	const narrow = makeSandbox({ slide: 40 });
	narrow.occupancy.add(box(300, 60, 700, 140));
	assert.equal(place(narrow, 500), null);

	const wide = makeSandbox({ slide: 300 });
	wide.occupancy.add(box(300, 60, 700, 140));
	assert.ok(place(wide, 500), "300px of reach must clear a 400px obstacle from its centre");
});

check("the name never slides past the end of its OWN chain", () => {
	const sandbox = makeSandbox();
	// Wish sits near the very start; sliding backwards would run off the line, where the window
	// arithmetic would stack the last letters on top of each other.
	const found = place(sandbox, 40);
	assert.ok(found, "a free line near the start must still yield a placement");
	found.glyphs.forEach((glyph) => {
		assert.ok(glyph.x >= -1 && glyph.x <= 1001, `letter ran off the chain: x=${glyph.x}`);
	});
	// Letters must not pile up (that was the #18 clamping bug).
	for (let i = 1; i < found.glyphs.length; i += 1) {
		assert.ok(found.glyphs[i].x > found.glyphs[i - 1].x, "letters stacked on each other");
	}
});

check("another WAY name blocks just as a place name does (channel A self-collision)", () => {
	const sandbox = makeSandbox();
	let asked = 0;
	const found = place(sandbox, 500, (hull) => {
		asked += 1;
		return hull.left < 600 && hull.right > 400;   // pretend a way label sits at 400..600
	});
	assert.ok(asked > 0, "the self-collision check must actually be consulted");
	assert.ok(found, "free road remains left and right");
	assert.ok(found.hull.right <= 400 || found.hull.left >= 600, "placed on top of the other way name");
});

check("an empty occupancy map never blocks (the map draws before the first collision pass)", () => {
	const sandbox = makeSandbox();
	const found = place(sandbox, 500);
	assert.ok(found);
	assert.equal(found.center, 500);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\nFAILED" : `\nall ${results.length} checks passed`);
