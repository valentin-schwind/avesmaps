const assert = require("assert");
const {
	avesmapsClimateSetVocabulary,
	avesmapsClimateZoneLabel,
	avesmapsClimateRowMarkup,
	avesmapsClimateRowForKey,
	avesmapsClimateRowForShares,
	avesmapsClimateRowForLandscapeEntries,
	buildClimateRowMarkup,
} = require("../map-features-climate-row.js");

// The vocabulary as api/app/map-features.php ships it: seven zones, north to south.
avesmapsClimateSetVocabulary([
	{ key: "polar", label: "Polare Zone" },
	{ key: "gemaessigt", label: "Gemäßigte Zone" },
	{ key: "subtropen_winterfeucht", label: "Winterfeuchte Subtropen" },
]);

// ---- the vocabulary ----------------------------------------------------------------------------
assert.strictEqual(avesmapsClimateZoneLabel("gemaessigt"), "Gemäßigte Zone");
assert.strictEqual(avesmapsClimateZoneLabel(" polar "), "Polare Zone", "whitespace is not a new zone");
assert.strictEqual(avesmapsClimateZoneLabel(""), "", "no key, no label");
// 💣 A key the client does not know yet is the state BETWEEN two deploys, not an error. It must not
// leak the raw key into the infobox -- "subtropen_winterfeucht" is not a name anybody wants to read.
assert.strictEqual(avesmapsClimateZoneLabel("boreal"), "", "an unknown key yields no label, not the key");
assert.strictEqual(avesmapsClimateRowForKey("boreal"), "", "and therefore no row at all");

// ---- one place, one zone -----------------------------------------------------------------------
const placeRow = avesmapsClimateRowForKey("gemaessigt");
assert.ok(placeRow.includes("<dt>Klimazone</dt>"), "the row carries the German label by default");
assert.ok(placeRow.includes("Gemäßigte Zone"), "and the zone name");
assert.ok(placeRow.includes("region-info-box__row"), "in the house row format, not a block of its own");
// 🔴 A POINT IS NOT "62 % IN A BAND". It lies in exactly one, and a percentage there would be a lie
// dressed as precision.
assert.ok(!placeRow.includes("%"), "a place never shows a share");
assert.strictEqual(avesmapsClimateRowForKey(""), "", "nothing known -> no row (never an empty field)");
assert.strictEqual(avesmapsClimateRowForKey(null), "", "and null is not a zone either");

// ---- one region, several zones with shares ------------------------------------------------------
const regionRow = avesmapsClimateRowForShares([["gemaessigt", 0.62], ["polar", 0.38]]);
assert.ok(regionRow.includes("Gemäßigte Zone (62 %)"), "the leading share is printed");
assert.ok(regionRow.includes("Polare Zone (38 %)"), "and the second one too");
assert.ok(regionRow.includes(" · "), "separated the way 'Führt durch' separates -- not by comma");
assert.strictEqual(avesmapsClimateRowForShares([]), "", "no shares, no row");
assert.strictEqual(avesmapsClimateRowForShares(null), "", "and null does not throw");

// The 90 % rule, same as the landscape line: what is essentially the whole thing gets no number.
assert.ok(!avesmapsClimateRowForShares([["polar", 0.93]]).includes("%"),
	"0,93 reads as 'the whole region' -- printing 93 % would add noise, not information");
assert.ok(avesmapsClimateRowForShares([["polar", 0.895]]).includes("(90 %)"),
	"just under the rule the number returns, rounded");

// An unknown key inside a share list drops out; the known ones still make a row.
assert.ok(avesmapsClimateRowForShares([["boreal", 0.7], ["polar", 0.3]]).includes("Polare Zone"),
	"one unknown zone does not silence the whole row");

// ---- one way, entries straight out of buildClimateLine ------------------------------------------
// These carry their name already: they come from path-landscapes.php, not from the payload vocabulary.
const wayRow = avesmapsClimateRowForLandscapeEntries([
	{ name: "Winterfeuchte Subtropen", share: 1 },
]);
assert.ok(wayRow.includes("Winterfeuchte Subtropen"), "the way's zone is named");
assert.ok(!wayRow.includes("%"), "a way fully inside one zone shows no share either");
assert.strictEqual(avesmapsClimateRowForLandscapeEntries([]), "", "no zones, no row");

// ---- escaping ------------------------------------------------------------------------------------
// A region name is written by whoever edits it. The row escapes, like every other renderer here.
avesmapsClimateSetVocabulary([{ key: "boese", label: '<img src=x onerror=alert(1)>' }]);
const escaped = avesmapsClimateRowForKey("boese");
assert.ok(!escaped.includes("<img"), "markup in a zone name never reaches the DOM as markup");
assert.ok(escaped.includes("&lt;img"), "it is escaped instead");

// ---- the convenience entry point ------------------------------------------------------------------
avesmapsClimateSetVocabulary([
	{ key: "polar", label: "Polare Zone" },
	{ key: "gemaessigt", label: "Gemäßigte Zone" },
]);
assert.ok(buildClimateRowMarkup({ climate_zone: "polar" }).includes("Polare Zone"),
	"a place's properties go straight in");
assert.ok(buildClimateRowMarkup({ climate_zones: [["gemaessigt", 0.5], ["polar", 0.5]] }).includes("50 %"),
	"a region's properties go straight in too");
assert.strictEqual(buildClimateRowMarkup({}), "", "properties without a zone give no row");
assert.strictEqual(buildClimateRowMarkup(null), "", "and no properties at all does not throw");
// An empty list is NOT the same as a missing field on the way in -- but both end as no row.
assert.strictEqual(buildClimateRowMarkup({ climate_zones: [] }), "", "an empty list gives no row");

console.log("OK: climate row -- vocabulary, the three feeders, the 90 % rule and escaping");
