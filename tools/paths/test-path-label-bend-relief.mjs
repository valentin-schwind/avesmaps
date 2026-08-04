// Unit test (Node, no build) for the bend readability of path/way labels
// (js/map-features/map-features-path-label-canvas-overlay.js).
//
// Discord case #18 ("Beschriftung legt sich an Flussbiegung an und ist dadurch stellenweise nicht
// lesbar, da Buchstaben zusammengedrueckt werden"): a glyph is a rigid box placed by ARC LENGTH and
// rotated to the local tangent. Where the line turns, neighbouring boxes rotate against each other
// and their inner corners eat into one another. Two levers answer that, and this file pins both:
//
//   A  findCalmLabelCenter -- put the name on the calmest stretch in reach instead of the middle.
//   B  the curvature relief inside drawGlyphsAlong -- widen the advance by (height/2)*|dTheta|,
//      exactly the amount the rotation takes away from the inner edge.
//
// Run: node tools/paths/test-path-label-bend-relief.mjs
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

const PURE = ["buildLabelTurningProfile", "labelSpanTurning", "findCalmLabelCenter",
	"sliceLabelWindow", "labelWindowHalf"];

// The pure helpers need no canvas at all.
const pure = new Function(`${PURE.map((n) => extractFunction(overlaySource, n)).join("\n")}
	return { ${PURE.join(", ")} };`)();

// drawGlyphsAlong closes over ctx/window and reads PATH_LABEL_CURVATURE_RELIEF off the global scope
// (declared in map-features-path-labels.js). Handing it in as a parameter is what lets the test drive
// the lever without loading the whole app.
function makeSandbox(relief) {
	const placements = [];
	let pending = null;
	const ctx = {
		save() {}, restore() {},
		translate(x, y) { pending = { x, y, ang: 0 }; },
		rotate(ang) { if (pending) pending.ang = ang; },
		fillText(char) {
			if (pending && !pending.recorded) {
				pending.recorded = true;
				placements.push({ char, x: pending.x, y: pending.y, ang: pending.ang });
			}
		},
		strokeText() {},
		set shadowColor(_v) {}, set shadowBlur(_v) {}, set fillStyle(_v) {},
		set strokeStyle(_v) {}, set lineWidth(_v) {}, set lineJoin(_v) {}, set lineCap(_v) {},
	};
	const body = [
		extractFunction(overlaySource, "labelSpanRunsLeftward"),
		extractFunction(overlaySource, "drawGlyphsAlong"),
	].join("\n");
	// eslint-disable-next-line no-new-func
	const factory = new Function("ctx", "window", "PATH_LABEL_CURVATURE_RELIEF", `${body}\nreturn drawGlyphsAlong;`);
	return { draw: factory(ctx, { devicePixelRatio: 1 }, relief), placements };
}

const NO_HALO = { glow: null, blur: 0, strokeW: 0 };
const GLYPH_W = 10;
const FONT_SIZE = 16;

function drawName(pts, name, { relief = 0, letterSpacing = 0.5, fontSize = FONT_SIZE } = {}) {
	const { draw, placements } = makeSandbox(relief);
	const chars = [...name];
	const widths = chars.map(() => GLYPH_W);
	draw(pts, chars, widths, letterSpacing, NO_HALO, "#000", 0, fontSize);
	return placements;
}

// Two adjacent glyph boxes, rotated as drawn -- do they overlap? (Separating-axis test.)
function boxOf(p, w, h) {
	const c = Math.cos(p.ang), s = Math.sin(p.ang);
	return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
		.map(([x, y]) => ({ x: p.x + x * c - y * s, y: p.y + x * s + y * c }));
}
function overlap(A, B) {
	for (const poly of [A, B]) {
		for (let i = 0; i < poly.length; i++) {
			const j = (i + 1) % poly.length;
			const nx = -(poly[j].y - poly[i].y), ny = poly[j].x - poly[i].x;
			let a1 = Infinity, a2 = -Infinity, b1 = Infinity, b2 = -Infinity;
			for (const p of A) { const d = p.x * nx + p.y * ny; if (d < a1) a1 = d; if (d > a2) a2 = d; }
			for (const p of B) { const d = p.x * nx + p.y * ny; if (d < b1) b1 = d; if (d > b2) b2 = d; }
			if (a2 < b1 || b2 < a1) return false;
		}
	}
	return true;
}
function squeezedPairs(placements) {
	const h = FONT_SIZE * 0.72;
	let n = 0;
	for (let i = 1; i < placements.length; i++) {
		if (overlap(boxOf(placements[i - 1], GLYPH_W, h), boxOf(placements[i], GLYPH_W, h))) n++;
	}
	return n;
}

// A circular arc -- a river bend. Radius decides how hard the letters fight each other: at radius R
// two neighbours 10px apart rotate by 10/R against one another, and the inner edge loses about
// (height/2)*(10/R) px of room. The arc must also be clearly LONGER than the name, otherwise the fit
// guarantee (see below) rightly turns the relief down and there is nothing left to measure.
function arc(radius, fromDeg, toDeg, steps) {
	const pts = [];
	for (let i = 0; i <= steps; i++) {
		const a = ((fromDeg + (toDeg - fromDeg) * (i / steps)) * Math.PI) / 180;
		pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
	}
	return pts;
}

// --- B: the relief loosens the letters on a bend ----------------------------------------------
const BEND = arc(60, 180, 0, 80); // half circle, ~188px of line for a 90px name
const tight = drawName(BEND, "Flussname", { relief: 0 });
const loose = drawName(BEND, "Flussname", { relief: 1 });
assert.equal(tight.length, 9, "all glyphs drawn without relief");
assert.equal(loose.length, 9, "all glyphs drawn with relief");
assert.ok(
	squeezedPairs(tight) > 0,
	"precondition: without relief the quarter-circle bend really does squeeze letters"
);
assert.ok(
	squeezedPairs(loose) < squeezedPairs(tight),
	`relief loosens the bend (squeezed pairs ${squeezedPairs(tight)} -> ${squeezedPairs(loose)})`
);

// --- ⚠ The regression the owner caught: a glyph may never be stacked on the line's end ---------
// The relief lengthens the name. On a stretch that offers barely more than the bare text length,
// the overhanging glyphs used to be clamped onto the last point -- "Der Große Fluss" then read
// "Der Große Flus", because the two s'es sat exactly on top of each other.
const NAME = "Fluss";
const bareTextLen = NAME.length * GLYPH_W;
const TIGHT_FIT = arc(40, 180, 100, 40); // curved AND barely longer than the name
const fitted = drawName(TIGHT_FIT, NAME, { relief: 1 });
assert.equal(fitted.length, NAME.length, "every glyph is drawn");
for (let i = 1; i < fitted.length; i++) {
	const gap = Math.hypot(fitted[i].x - fitted[i - 1].x, fitted[i].y - fitted[i - 1].y);
	assert.ok(
		gap > GLYPH_W * 0.5,
		`glyph ${i} ("${fitted[i].char}") must not pile up on its predecessor (gap ${gap.toFixed(2)}px)`
	);
}

// The same guarantee at the extreme: relief cranked up on a line with almost no slack.
const cranked = drawName(TIGHT_FIT, NAME, { relief: 2 });
for (let i = 1; i < cranked.length; i++) {
	const gap = Math.hypot(cranked[i].x - cranked[i - 1].x, cranked[i].y - cranked[i - 1].y);
	assert.ok(gap > GLYPH_W * 0.5, `relief 2: glyph ${i} still stands on its own (gap ${gap.toFixed(2)}px)`);
}

// --- Relief must not disturb a straight line ---------------------------------------------------
const STRAIGHT = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
const plain = drawName(STRAIGHT, "Reichsstrasse", { relief: 0 });
const relieved = drawName(STRAIGHT, "Reichsstrasse", { relief: 1 });
plain.forEach((p, i) => {
	assert.ok(
		Math.abs(p.x - relieved[i].x) < 0.001 && Math.abs(p.y - relieved[i].y) < 0.001,
		"a straight line turns nowhere, so the relief must change nothing there"
	);
});

// --- A: findCalmLabelCenter prefers the straight stretch ---------------------------------------
// Left half is a tight bend, right half is dead straight.
const HALF_BEND = [...arc(50, 180, 90, 30).map((p) => ({ x: p.x + 50, y: p.y }))];
const tail = [];
for (let x = 50; x <= 400; x += 10) tail.push({ x, y: 50 });
const MIXED = [...HALF_BEND, ...tail];
const profile = pure.buildLabelTurningProfile(MIXED, 5);
assert.ok(profile.total > 0, "profile measures a length");

const textLen = 90;
const bendCenter = 40; // sits inside the curved head
const calm = pure.findCalmLabelCenter(profile, bendCenter, textLen, 300, 0.35);
assert.ok(
	calm > bendCenter,
	`the name moves out of the bend towards the straight stretch (${bendCenter} -> ${calm.toFixed(1)})`
);
assert.ok(
	pure.labelSpanTurning(profile, calm - textLen / 2, textLen)
		< pure.labelSpanTurning(profile, bendCenter - textLen / 2, textLen),
	"the chosen stretch really does turn less than the original one"
);

// Search radius 0 keeps the old behaviour exactly -- the escape hatch for ?pathtune=1.
assert.equal(
	pure.findCalmLabelCenter(profile, bendCenter, textLen, 0, 0.35), bendCenter,
	"search radius 0 -> the caller's own center, unchanged"
);
// A big anchor weight pins the name to its interval slot even next to a calmer stretch.
assert.ok(
	Math.abs(pure.findCalmLabelCenter(profile, bendCenter, textLen, 300, 50) - bendCenter) < 20,
	"a heavy anchor keeps the name near its interval slot"
);

// --- The window the callers cut ----------------------------------------------------------------
const win = pure.sliceLabelWindow(MIXED, 200, 60);
let winLen = 0;
for (let i = 1; i < win.length; i++) winLen += Math.hypot(win[i].x - win[i - 1].x, win[i].y - win[i - 1].y);
assert.ok(Math.abs(winLen - 120) < 1, `window is 2x half long (got ${winLen.toFixed(2)})`);
assert.ok(win.length >= 2, "window keeps its interior vertices");

// With relief on, the window carries a font-size of slack -- that is the second guard against the
// clamped-glyph bug above.
assert.equal(pure.labelWindowHalf(100, 16, 0), 54, "no relief -> bare text plus the old 4px");
assert.equal(pure.labelWindowHalf(100, 16, 1), 70, "relief -> one font size of extra room");

console.log("path label bend relief: all assertions passed");
