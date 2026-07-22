// Unit test (Node, no build) for the range section of the shared filter menu (js/ui/filter-menu.js).
// Only the PURE parts are exercised -- the rest needs a DOM. The range section is the new piece the
// other kinds did not have, and its whole reason to exist is producing the {mode, from, to} object
// the tree filters have always consumed (territory-wiki-tree.js readTimeFilter), so that contract is
// what this guards.
//
// Run: node tools/paths/test-filter-menu.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const { avmRangeStateCreate, avmRangeValue, avmRangeIsActive, AVM_RANGE_PRESETS } =
	require(path.join(repoRoot, "js", "ui", "filter-menu.js"));

// --- the three presets, in order --------------------------------------------------------
assert.deepEqual(AVM_RANGE_PRESETS.map((p) => p.value), ["off", "today", "range"]);
assert.deepEqual(AVM_RANGE_PRESETS.map((p) => p.label), ["Alle", "heute", "Zeitraum"]);

// --- default is "off" -------------------------------------------------------------------
const fresh = avmRangeStateCreate();
assert.equal(fresh.mode, "off");
assert.deepEqual(avmRangeValue(fresh), { mode: "off", from: -Infinity, to: Infinity });
assert.equal(avmRangeIsActive(fresh), false, "an unset range is not an active filter");

// --- "today" is its own mode, and it COUNTS as active -----------------------------------
// This is the deliberate call: "today" is preselected in the panel and the monitor's right
// column, where it hides every historical territory. A default-on filter the button hides is
// the invisible liar the funnel exists to prevent, so it must show in the count.
const today = avmRangeStateCreate("today");
assert.deepEqual(avmRangeValue(today), { mode: "today", from: -Infinity, to: Infinity });
assert.equal(avmRangeIsActive(today), true, "today is a real restriction and must count");

// --- a range with either bound is active; the open ends fill in with +/-Infinity --------
const bothEnds = { mode: "range", fromText: "1000", toText: "1040" };
assert.deepEqual(avmRangeValue(bothEnds), { mode: "range", from: 1000, to: 1040 });
assert.equal(avmRangeIsActive(bothEnds), true);

assert.deepEqual(avmRangeValue({ mode: "range", fromText: "1000", toText: "" }),
	{ mode: "range", from: 1000, to: Infinity }, "an open upper bound is +Infinity, matching readTimeFilter");
assert.deepEqual(avmRangeValue({ mode: "range", fromText: "", toText: "1040" }),
	{ mode: "range", from: -Infinity, to: 1040 }, "an open lower bound is -Infinity");

// --- mode:"range" but both fields empty collapses to "off" ------------------------------
// A range with no bounds is not a range -- and it must not count as active, or the button would
// claim a filter that restricts nothing. Same result readTimeFilter gave for two empty inputs.
const emptyRange = { mode: "range", fromText: "", toText: "" };
assert.deepEqual(avmRangeValue(emptyRange), { mode: "off", from: -Infinity, to: Infinity });
assert.equal(avmRangeIsActive(emptyRange), false, "an empty range restricts nothing");

// --- non-numeric text is ignored the way parseInt does ----------------------------------
assert.deepEqual(avmRangeValue({ mode: "range", fromText: "abc", toText: "" }),
	{ mode: "off", from: -Infinity, to: Infinity }, "garbage in a field is no bound at all");

// --- null / undefined state does not throw ----------------------------------------------
assert.deepEqual(avmRangeValue(null), { mode: "off", from: -Infinity, to: Infinity });
assert.equal(avmRangeIsActive(undefined), false);

console.log("filter-menu: OK");
