const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// spotlight-search.js is a browser script with no module system, so the two pure functions are pulled
// out by name and evaluated on their own -- the test exercises the shipped source, not a copy.
// Anchor: these declarations sit at column 0, so a closing brace at column 0 ends them.
//
// Run (from repo root):  node js/ui/__tests__/spotlight-scoring.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() not found in js/ui/spotlight-search.js -- renamed?`);
	return match[0];
};

// scoreSpotlightWord comes along because getSpotlightSearchScore calls it -- extracting only the
// caller would blow up with "scoreSpotlightWord is not defined" inside the sandbox.
const context = { Infinity, Math, String, Number, Boolean, Array };
vm.runInNewContext(
	extract("normalizeSpotlightSearchText") + extract("scoreSpotlightWord") + extract("getSpotlightSearchScore"),
	context
);
const { getSpotlightSearchScore, normalizeSpotlightSearchText } = context;

const score = (entry, query) => getSpotlightSearchScore(entry, normalizeSpotlightSearchText(query));
const gareth = { normalizedSearchTexts: ["stadtplan von gareth", "gareth", "stadtplan"] };

// ---- unchanged single-word behaviour (the regression guard) -------------------------------------
assert.strictEqual(score(gareth, "gareth"), 0);
assert.strictEqual(score(gareth, "areth"), 3);
assert.strictEqual(score(gareth, "bornland"), Infinity);

// "stadtplan von" is a TWO-word query, so it is explicitly NOT covered by the single-word guarantee
// above. Per-word scoring rates "stadtplan"=0 (exact, against the "stadtplan" text) and "von"=2
// (word-prefix, inside "stadtplan von gareth" only) and keeps the WORSE of the two -- mirrors
// api/_internal/app/__tests__/map-search-scoring-test.php lines 19-29, which pins the identical
// server-side case at 2 (changed from 1 by Task 2) with the same proof: no per-word/worst-case
// scorer can hold this at 1 while "von" alone (next line) is pinned at 2.
assert.strictEqual(score(gareth, "stadtplan von"), 2);
assert.strictEqual(score(gareth, "von"), 2);

// ---- THE POINT: words may sit in different texts -------------------------------------------------
assert.ok(Number.isFinite(score(gareth, "stadtplan gareth")));
assert.ok(Number.isFinite(score(gareth, "gareth stadtplan")));
assert.strictEqual(score(gareth, "stadtplan bornland"), Infinity);

// ---- the entry is as good as its weakest word ----------------------------------------------------
assert.strictEqual(score(gareth, "gareth tadtplan"), 3);

// ---- whitespace must not create an empty word that matches everything ----------------------------
assert.ok(Number.isFinite(score(gareth, "  stadtplan   gareth ")));
assert.strictEqual(score(gareth, "   "), Infinity);

console.log("spotlight-scoring: OK");
