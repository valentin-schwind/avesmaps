// Unit test (Node, no build) for glyph orientation in the path/way label canvas overlay
// (js/map-features/map-features-path-label-canvas-overlay.js).
//
// Discord case #34 ("Schrift an Wegen steht stellenweise auf dem Kopf"): the three callers of
// drawGlyphsAlong flip the WHOLE polyline left->right (`pts[last].x < pts[0].x`), but the text
// only ever occupies a CENTERED SLICE of that polyline. On a serpentine that runs rightward
// overall while its middle stretch runs leftward, that slice is drawn upside down.
//
// A glyph is upside down when its tangent angle has cos(ang) < 0, i.e. |ang| > 90 degrees.
//
// Run: node tools/paths/test-path-label-orientation.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const overlaySource = readFileSync(
	path.join(repoRoot, "js", "map-features", "map-features-path-label-canvas-overlay.js"),
	"utf8"
);

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
			if (depth === 0) {
				return source.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

// drawGlyphsAlong closes over `ctx` (canvas 2D context) and `window` (devicePixelRatio). A fake
// context records every placement so the test can inspect rotation angles and positions.
function makeSandbox() {
	const placements = [];
	let pending = null;
	const ctx = {
		save() {},
		restore() {},
		translate(x, y) { pending = { x, y, ang: 0 }; },
		rotate(ang) { if (pending) pending.ang = ang; },
		fillText(char) {
			if (pending && !pending.recorded) {
				pending.recorded = true;
				placements.push({ char, x: pending.x, y: pending.y, ang: pending.ang });
			}
		},
		strokeText() {},
		measureText(c) { return { width: 10 * [...c].length }; },
		set shadowColor(_v) {}, set shadowBlur(_v) {}, set fillStyle(_v) {},
		set strokeStyle(_v) {}, set lineWidth(_v) {}, set lineJoin(_v) {}, set lineCap(_v) {},
	};
	// drawGlyphsAlong plus the orientation helper it calls, both taken from the real source.
	const body = [
		extractFunction(overlaySource, "labelSpanRunsLeftward"),
		extractFunction(overlaySource, "drawGlyphsAlong"),
	].join("\n");
	// eslint-disable-next-line no-new-func
	const factory = new Function("ctx", "window", `${body}\nreturn drawGlyphsAlong;`);
	return { draw: factory(ctx, { devicePixelRatio: 1 }), placements };
}

const NO_HALO = { glow: null, blur: 0, strokeW: 0 };

// Mirrors what every caller does before handing the polyline to drawGlyphsAlong.
function flipWholeLineLikeCallers(pts) {
	return pts[pts.length - 1].x < pts[0].x ? pts.slice().reverse() : pts;
}

function drawName(pts, name, { letterSpacing = 0, perpOffset = 0 } = {}) {
	const { draw, placements } = makeSandbox();
	const chars = [...name];
	const widths = chars.map(() => 10);
	draw(flipWholeLineLikeCallers(pts), chars, widths, letterSpacing, NO_HALO, "#000", perpOffset);
	return placements;
}

function upsideDownCount(placements) {
	return placements.filter((p) => Math.cos(p.ang) < 0).length;
}

// --- Case #34: serpentine that runs rightward overall, leftward through its middle ------------
// Cumulative lengths: 300 / 350 / 600 / 650 / 1000. A 60px name centred at 500 falls entirely
// inside the third leg (350..600), which runs from x=300 back to x=50 -> leftward.
const SERPENTINE = [
	{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 },
	{ x: 50, y: 50 }, { x: 50, y: 100 }, { x: 400, y: 100 },
];
assert.equal(
	SERPENTINE[SERPENTINE.length - 1].x > SERPENTINE[0].x, true,
	"precondition: callers see a left->right line and do NOT flip it"
);

const serpentine = drawName(SERPENTINE, "Wegname");
assert.equal(serpentine.length, 7, "all glyphs are drawn");
assert.equal(
	upsideDownCount(serpentine), 0,
	`case #34: ${upsideDownCount(serpentine)}/${serpentine.length} glyphs are upside down on the leftward middle stretch`
);

// --- Regression: a plain left->right line stays untouched --------------------------------------
const STRAIGHT_RIGHT = [{ x: 0, y: 0 }, { x: 500, y: 0 }];
const straight = drawName(STRAIGHT_RIGHT, "Reichsstrasse");
assert.equal(upsideDownCount(straight), 0, "left->right line: nothing upside down");
assert.ok(
	straight[straight.length - 1].x > straight[0].x,
	"left->right line: glyphs still run left to right"
);

// --- Regression: a right->left line is flipped by the caller and stays upright -----------------
const STRAIGHT_LEFT = [{ x: 500, y: 0 }, { x: 0, y: 0 }];
const flipped = drawName(STRAIGHT_LEFT, "Reichsstrasse");
assert.equal(upsideDownCount(flipped), 0, "right->left line: caller flip keeps it upright");

// --- The fix must not MOVE the label, only turn it -------------------------------------------
// The text is centred on the polyline either way, so its midpoint must stay put.
const midX = (ps) => (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x))) / 2;
const midY = (ps) => (Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y))) / 2;
assert.ok(
	Math.abs(midX(serpentine) - 175) < 40 && Math.abs(midY(serpentine) - 50) < 10,
	`label stays centred on the same stretch (got ${midX(serpentine).toFixed(1)}/${midY(serpentine).toFixed(1)})`
);

// --- perpOffset keeps its "above the line" meaning after an internal flip ----------------------
// Positive perpOffset means "above" for a left->right run. On the leftward middle stretch the
// glyphs sit at y=50; lifting them must move them to a SMALLER y, never a larger one.
const lifted = drawName(SERPENTINE, "Wegname", { perpOffset: 12 });
assert.equal(upsideDownCount(lifted), 0, "perpOffset variant is upright too");
assert.ok(
	midY(lifted) < midY(serpentine),
	`positive perpOffset lifts the text (got ${midY(lifted).toFixed(1)} vs ${midY(serpentine).toFixed(1)})`
);

console.log("path label orientation: all assertions passed");
