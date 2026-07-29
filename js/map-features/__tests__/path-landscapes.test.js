const assert = require("assert");
const {
	buildLandscapeLine,
	formatLandscapesForInfobox,
	formatLandscapesForPlanner,
	pickFreshLandscapes,
	landscapeWikiKeyList,
} = require("../map-features-path-landscapes.js");

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// A payload in the exact shape api/app/path-landscapes.php answers with.
const payload = {
	landscapes: {
		"r-weiden": { name: "Weiden", art: "Region", kind: "derographisch", wiki_key: "weiden" },
		"r-finsterkamm": { name: "Finsterkamm", art: "Gebirge", kind: "topographie", wiki_key: "finsterkamm" },
		"r-see-a": { name: "See-042", art: "See", kind: "topographie", wiki_key: "" },
		"r-see-b": { name: "See-107", art: "See", kind: "topographie", wiki_key: "" },
		"r-nameless": { name: "Fläche-011", art: "", kind: "derographisch", wiki_key: "" },
	},
	paths: {
		"p-1": { length: 10, in: [["r-weiden", 10], ["r-finsterkamm", 8.4]] },
		"p-2": { length: 10, in: [["r-weiden", 0.4]] },
		"p-3": { length: 10, in: [["r-see-a", 3], ["r-see-b", 2]] },
		"p-4": { length: 10, in: [["r-nameless", 10]] },
		"p-5": { length: 10, in: [["r-weiden", 10.0004]] },
		"p-6": { length: 0, in: [["r-weiden", 0]] },
		"p-7": { length: 10, in: [["r-gone", 5]] },
		"p-8": { length: 30, in: [["r-finsterkamm", 30]] },
	},
};

// ---- the builder --------------------------------------------------------------------------
let line = buildLandscapeLine(["p-1"], payload);
assert.strictEqual(line.length, 2, "both landscapes of this way");
assert.strictEqual(line[0].name, "Weiden", "the bigger share leads");
near(line[0].share, 1, "the whole way lies in Weiden");
near(line[1].share, 0.84, "and 84 % of it in the Finsterkamm");
assert.strictEqual(line[1].art, "Gebirge", "the kind travels along, for the tooltip");

assert.deepStrictEqual(buildLandscapeLine(["p-2"], payload), [],
	"4 % is below the threshold -- 274 of 3.995 measured hits look like this");

line = buildLandscapeLine(["p-3"], payload);
assert.strictEqual(line.length, 1, "two nameless lakes are ONE entry, not 'See · See'");
assert.strictEqual(line[0].name, "See", "an auto name shows its kind -- the house rule");
near(line[0].share, 0.5, "and their covered lengths add up");

assert.deepStrictEqual(buildLandscapeLine(["p-4"], payload), [],
	"neither a name nor a kind -- there is literally nothing to print");

line = buildLandscapeLine(["p-5"], payload);
near(line[0].share, 1, "rounding may push the sum past the length; the share is capped at 1");

assert.deepStrictEqual(buildLandscapeLine(["p-6"], payload), [],
	"a way of length zero yields no share, and no division by zero");
assert.deepStrictEqual(buildLandscapeLine(["p-7"], payload), [],
	"a region missing from the catalogue is skipped, not crashed on");
assert.deepStrictEqual(buildLandscapeLine(["p-unknown"], payload), [],
	"a way we know nothing about is an empty line, not an error");
assert.deepStrictEqual(buildLandscapeLine([], payload), [], "no ways, no line");
assert.deepStrictEqual(buildLandscapeLine(["p-1"], null), [], "no payload, no line");

// Several ways -- a route, or a water leg made of several ways. Weighted by LENGTH.
line = buildLandscapeLine(["p-1", "p-8"], payload);
assert.strictEqual(line[0].name, "Finsterkamm",
	"8.4 + 30 of 40 beats 10 of 40 -- the longer way carries more weight");
near(line[0].share, 38.4 / 40, "share of the WHOLE distance, not the average of two shares");
near(line[1].share, 10 / 40, "and Weiden covers a quarter of it");

// ---- the writers --------------------------------------------------------------------------
assert.strictEqual(
	formatLandscapesForInfobox(buildLandscapeLine(["p-1"], payload)),
	"Weiden · Finsterkamm (84 %)",
	"100 % carries no number -- it is the median case and would say nothing"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.93 }]),
	"Weiden",
	"0,93 is still 'the whole leg' -- the 90 % rule"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.895 }]),
	"Weiden (90 %)",
	"just under the rule the number returns, rounded"
);
assert.strictEqual(formatLandscapesForInfobox([]), "", "an empty line is empty, not 'keine'");

assert.strictEqual(
	formatLandscapesForPlanner(buildLandscapeLine(["p-1"], payload)),
	"Weiden, Finsterkamm",
	"the planner never prints a percentage and never an article"
);
assert.strictEqual(formatLandscapesForPlanner([]), "", "nothing to say, nothing printed");

// ---- only what is new -----------------------------------------------------------------------
const weiden = [{ name: "Weiden", share: 1 }];
const weidenAndWood = [{ name: "Weiden", share: 1 }, { name: "Reichsforst", share: 0.2 }];
assert.deepStrictEqual(pickFreshLandscapes(weiden, []).map((e) => e.name), ["Weiden"],
	"the first row names everything");
assert.deepStrictEqual(pickFreshLandscapes(weiden, weiden), [],
	"the same names as the row above -- say nothing");
assert.deepStrictEqual(pickFreshLandscapes(weidenAndWood, weiden).map((e) => e.name), ["Reichsforst"],
	"only the one that joined");
assert.deepStrictEqual(pickFreshLandscapes(weiden, weidenAndWood), [],
	"leaving a landscape is not announced -- only entering one is");
assert.deepStrictEqual(pickFreshLandscapes(weidenAndWood, null).map((e) => e.name),
	["Weiden", "Reichsforst"], "no predecessor at all is the same as an empty one");

// ---- the lore key ---------------------------------------------------------------------------
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-1"], payload)), "weiden,finsterkamm",
	"one comma list -> ONE lore request for the whole leg");
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-3"], payload)), "",
	"a landscape without a wiki key contributes nothing");

console.log("OK: path-landscapes builder, writers and the fresh-only rule");
