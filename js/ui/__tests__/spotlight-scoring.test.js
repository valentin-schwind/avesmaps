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
const focusSource = fs.readFileSync(path.join(__dirname, "..", "spotlight-search-focus.js"), "utf8");

const extract = (name, from = source, fromName = "spotlight-search.js") => {
	const match = from.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() not found in js/ui/${fromName} -- renamed?`);
	return match[0];
};

// A top-level `const NAME = …;` pulled out by name, so a test pins the SHIPPED number rather than a
// copy of it that can drift.
const extractConst = (name, from, fromName) => {
	const match = from.match(new RegExp("\\nconst " + name + " = [^\\n]*;"));
	assert.ok(match, `const ${name} not found in js/ui/${fromName} -- renamed?`);
	return match[0];
};

// scoreSpotlightWord comes along because getSpotlightSearchScore calls it -- extracting only the
// caller would blow up with "scoreSpotlightWord is not defined" inside the sandbox.
// IMG_WIDTH/IMG_HEIGHT come from js/config.js at runtime; here they are the sandbox's own so the size
// rule is measured against the real 1024x1024 map without dragging the whole config in.
const context = { Infinity, Math, String, Number, Boolean, Array, IMG_WIDTH: 1024, IMG_HEIGHT: 1024 };
vm.runInNewContext(
	extract("normalizeSpotlightSearchText") + extract("scoreSpotlightWord") + extract("getSpotlightSearchScore") + extract("spotlightPlaceLookupKeys") + extract("getSpotlightEntryWikiKey") + extract("resolveSpotlightLorePlace")
		+ extractConst("SPOTLIGHT_LORE_AREA_FILL_MAX_MAP_SHARE", focusSource, "spotlight-search-focus.js")
		+ extract("isSpotlightLoreAreaOversized", focusSource, "spotlight-search-focus.js")
		+ extract("spotlightPlaceAreas", focusSource, "spotlight-search-focus.js")
		+ extract("spotlightEntryLookupPublicIds"),
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

// ---- place kinds map onto the lookup keys this file actually uses --------------------------------
// A settlement is looked up as "location", a territory as "region". Getting this wrong would mark all
// 59 regional maps as "not on the map" while looking perfectly correct in review.
//
// The Array.from() wrapper re-materializes the vm sandbox's return value in THIS realm: the sandboxed
// function builds its array with the sandbox's own Array intrinsic, so deepStrictEqual against a
// literal written here fails on prototype identity alone ("same structure but not reference-equal")
// even when every element matches. Array.from() copies the elements into an outer-realm array; it does
// not change what is being asserted.
const keys = (placeKind, publicId) => Array.from(context.spotlightPlaceLookupKeys(placeKind, publicId));
assert.deepStrictEqual(keys("settlement", "abc"), ["location:abc"]);
assert.deepStrictEqual(keys("territory", "abc"), ["region:abc"]);
assert.deepStrictEqual(keys("region", "abc"), ["region:abc", "label:abc"]);
assert.deepStrictEqual(keys("path", "abc"), ["path:abc"]);
assert.deepStrictEqual(keys("unresolved", "abc"), []);
assert.deepStrictEqual(keys("", "abc"), []);

// ---- occurrence places resolve by wiki key, by title, and by title without qualifier -------------
// lore_place stores NO resolved target (design §1.6), only a wiki key and a title -- so this three-step
// fallback is the entire join between an occurrence and the map. "Bornland (Region)" is the case that
// makes step 3 necessary: live, that is exactly how the wiki writes it and "Bornland" is what the map
// calls it.
const wikiKey = context.getSpotlightEntryWikiKey;
const labelEntry = { kind: "label", name: "Khôm", labelEntry: { label: { wikiRegion: { wiki_key: "kh-m" } } } };
const bornland = { kind: "label", name: "Bornland", labelEntry: { label: { wikiRegion: { wiki_key: "bornland" } } } };
const village = { kind: "location", name: "Belhanka", locationEntry: { location: { wikiSettlement: { wiki_key: "belhanka" } } } };

assert.strictEqual(wikiKey(labelEntry), "kh-m");
assert.strictEqual(wikiKey(village), "belhanka");
assert.strictEqual(wikiKey({ kind: "path", name: "x" }), "");
assert.strictEqual(wikiKey({ kind: "label", name: "x" }), "");

// Territory wiki keys carry a prefix (avesmapsPoliticalBuildWikiKey: 'wiki:' or 'name:' + slug) that
// lore_place.place_wiki_key does not -- without stripping it, the lore-place index would store
// "wk:wiki f rstentum kosch" while the lookup asks for "wk:f rstentum kosch", a permanent miss.
const territoryWiki = { kind: "region", regionEntry: { wiki_key: "wiki:f-rstentum-kosch" } };
const territoryName = { kind: "region", regionEntry: { wiki_key: "name:xyz" } };
assert.strictEqual(wikiKey(territoryWiki), "f-rstentum-kosch");
assert.strictEqual(wikiKey(territoryName), "xyz");

// The strip is scoped to the region branch and to a prefix at the START of the string only. A label
// key that happens to contain one of the two prefix words is NOT touched -- proving this is not a
// blanket strip applied to every kind regardless of branch.
const labelWithPrefixLookingKey = { kind: "label", name: "x", labelEntry: { label: { wikiRegion: { wiki_key: "wiki:kh-m" } } } };
assert.strictEqual(wikiKey(labelWithPrefixLookingKey), "wiki:kh-m");

const byLorePlace = new Map([
	["wk:kh m", labelEntry],
	["nm:khom", labelEntry],
	["nm:bornland", bornland],
	["nm:belhanka", village],
]);
const place = (title, key) => context.resolveSpotlightLorePlace(byLorePlace, { title, wiki_key: key });

assert.strictEqual(place("Khôm", "kh-m"), labelEntry);
assert.strictEqual(place("Khôm", ""), labelEntry);
assert.strictEqual(place("Belhanka", ""), village);
assert.strictEqual(place("Bornland (Region)", ""), bornland);
assert.strictEqual(place("Myranor", ""), null);
assert.strictEqual(place("", ""), null);

// An empty wiki key must never become a wildcard: without the guard, "wk:" would be a real key that
// every place without a key looks up -- and the first entry inserted would answer for all of them.
assert.strictEqual(context.resolveSpotlightLorePlace(new Map([["wk:", labelEntry]]), { title: "Myranor", wiki_key: "" }), null);

// ---- the size rule that keeps a continent from covering the map ----------------------------------
// Real bounding boxes, read off the live layer on 2026-08-02. "Aventurien" is the ONLY one of 681 areas
// above the threshold (70 % of the map); the next largest is "Meer der Sieben Winde" at 15.9 %. Both
// neighbours are pinned here, so nudging the constant toward either one fails loudly.
const oversized = context.isSpotlightLoreAreaOversized;
const bbox = (minX, minY, maxX, maxY) => ({ bounds: { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY } });

assert.strictEqual(oversized(bbox(258.8, 62.1, 1023.9, 1023.9)), true, "Aventurien, 70 % of the map");
assert.strictEqual(oversized(bbox(0, 0, 314, 532)), false, "Meer der Sieben Winde, 15.9 %");
assert.strictEqual(oversized(bbox(546.2, 665.9, 574.4, 693.8)), false, "Nebelmoor, 0.07 %");
assert.strictEqual(oversized(bbox(444.1, 281.9, 603.3, 410.8)), false, "Khôm, 1.9 %");
// A row without usable bounds must not be treated as a continent -- it is drawn, just not measured.
assert.strictEqual(oversized({}), false);
assert.strictEqual(oversized({ bounds: { min_x: "x", min_y: 0, max_x: 1, max_y: 1 } }), false);

// ---- areas belong to LABELS, never to anything else ----------------------------------------------
// An area hangs off ecosystem_region.label_public_id, which is a map-features LABEL id. Handing a
// settlement or a territory into this must yield nothing, or a same-id collision across two different
// kinds of object would paint the wrong outline.
const areas = context.spotlightPlaceAreas;
const byLabel = new Map([["lbl-1", [{ public_id: "a1" }]]]);
const labelPlace = { kind: "label", labelEntry: { label: { publicId: "lbl-1" } } };

assert.deepStrictEqual(Array.from(areas(labelPlace, byLabel)), [{ public_id: "a1" }]);
assert.deepStrictEqual(Array.from(areas(labelPlace, null)), [], "no areas loaded yet");
assert.deepStrictEqual(Array.from(areas({ kind: "location", locationEntry: {} }, byLabel)), []);
assert.deepStrictEqual(Array.from(areas({ kind: "region", regionEntry: {} }, byLabel)), []);
assert.deepStrictEqual(Array.from(areas({ kind: "label", labelEntry: { label: {} } }, byLabel)), [], "label without an id");

// ---- a territory is reachable under BOTH of its ids ----------------------------------------------
// The regression this pins, measured live 2026-08-02: "Königreich Garetien" renders as a region entry
// whose own publicId is 25623a55-… while the political territory it stands for is 99dacb52-…. Adventures,
// Kartensammlung entries and the backend's own region hits all point at the SECOND one, so with only the
// first in the index all 134 territory-starting adventures said "kein Ort auf der Karte" and their click
// did nothing -- with the political layer fully rendered right underneath.
const lookupIds = context.spotlightEntryLookupPublicIds;

assert.deepStrictEqual(
	Array.from(lookupIds({ publicIds: ["25623a55"], regionEntry: { publicId: "25623a55", territoryPublicId: "99dacb52" } })),
	["25623a55", "99dacb52"],
	"both ids, the entry's own one first"
);
// A region without a territory behind it (or any other kind) is unchanged -- no phantom key.
assert.deepStrictEqual(Array.from(lookupIds({ publicIds: ["a"], regionEntry: {} })), ["a"]);
assert.deepStrictEqual(Array.from(lookupIds({ publicIds: ["a"] })), ["a"]);
assert.deepStrictEqual(Array.from(lookupIds({ publicIds: [] })), []);
assert.deepStrictEqual(Array.from(lookupIds({})), []);
// An empty or duplicated territory id must not add anything: "" would be a key every id-less pointer
// matches, and a duplicate would make the same entry answer twice for nothing.
assert.deepStrictEqual(Array.from(lookupIds({ publicIds: ["a"], regionEntry: { territoryPublicId: "" } })), ["a"]);
assert.deepStrictEqual(Array.from(lookupIds({ publicIds: ["a"], regionEntry: { territoryPublicId: "a" } })), ["a"]);

console.log("spotlight-scoring: OK");
