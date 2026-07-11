const assert = require("assert");
const {
	avesmapsAdventureProductTypeLabel,
	avesmapsNormalizeAdventureKey,
	avesmapsAdventureToRenderShape,
	avesmapsBuildAdventureIndex,
	avesmapsSelectAdventureEntries,
} = require("../map-features-adventures.js");

// ---- product-type labels ----
assert.strictEqual(avesmapsAdventureProductTypeLabel("gruppenabenteuer"), "Gruppenabenteuer");
assert.strictEqual(avesmapsAdventureProductTypeLabel("SOLOABENTEUER"), "Soloabenteuer");
assert.strictEqual(avesmapsAdventureProductTypeLabel("unbekannt"), "unbekannt"); // pass-through
console.log("product-type labels ok");

// ---- render shape (catalog -> place-extras shape) ----
const shape = avesmapsAdventureToRenderShape({
	public_id: "x", title: "T", product_type: "kampagne", edition: "DSA5",
	bf_year: 1040, bf_label: "Travia 1040 BF", cover_url: "c", wiki_url: "u",
});
assert.strictEqual(shape.type, "Kampagne");
assert.strictEqual(shape.year, 1040);
assert.strictEqual(shape.yearLabel, "Travia 1040 BF");
assert.strictEqual(shape.cover, "c");
assert.strictEqual(shape.url, "u");
// yearLabel falls back to "<bf_year> BF" when bf_label is missing
assert.strictEqual(avesmapsAdventureToRenderShape({ public_id: "y", bf_year: 1030 }).yearLabel, "1030 BF");
console.log("render shape ok");

// ---- index + select ----
const catalog = [
	{ public_id: "advA", title: "A", product_type: "gruppenabenteuer", bf_year: 1044, places: [
		{ role: "start", target_kind: "settlement", target_public_id: "S1", target_wiki_key: "wiki:gareth" },
		{ role: "play", target_kind: "settlement", target_public_id: "S2", target_wiki_key: "wiki:ferdok" },
	] },
	{ public_id: "advB", title: "B", product_type: "soloabenteuer", bf_year: 1015, places: [
		{ role: "start", target_kind: "settlement", target_public_id: "S9", target_wiki_key: "wiki:fasar" },
		{ role: "play", target_kind: "settlement", target_public_id: "S1", target_wiki_key: "wiki:gareth" },
	] },
];
const index = avesmapsBuildAdventureIndex(catalog);

// S1 (by public_id): advA BEGINS here; advB PLAYS here (start elsewhere) -> spoiler set.
const beginsAtS1 = avesmapsSelectAdventureEntries(index, { publicId: "S1" }, "start");
assert.strictEqual(beginsAtS1.length, 1);
assert.strictEqual(beginsAtS1[0].adv.public_id, "advA");
const playsAtS1 = avesmapsSelectAdventureEntries(index, { publicId: "S1" }, "play");
assert.strictEqual(playsAtS1.length, 1);
assert.strictEqual(playsAtS1[0].adv.public_id, "advB");
assert.strictEqual(avesmapsSelectAdventureEntries(index, { publicId: "S1" }, "all").length, 2);
console.log("settlement public_id index ok");

// wiki-key index (best-effort): a play-place at S2 with key wiki:ferdok resolves via the normalized key.
const ferdokKey = avesmapsNormalizeAdventureKey("wiki:ferdok");
assert.strictEqual(ferdokKey, "ferdok"); // 'wiki:' stripped, hyphens/prefix normalized away
const byKey = avesmapsSelectAdventureEntries(index, { key: ferdokKey }, "play");
assert.strictEqual(byKey.length, 1);
assert.strictEqual(byKey[0].adv.public_id, "advA");
console.log("settlement wiki-key index ok");

// dedupe: a ref matching BOTH publicId and key yields each adventure once.
const both = avesmapsSelectAdventureEntries(index, { publicId: "S1", key: avesmapsNormalizeAdventureKey("wiki:gareth") }, "all");
assert.strictEqual(both.length, 2); // advA + advB, not doubled
console.log("dedupe ok");

// territory index: hyphenated slug normalizes consistently on both sides.
const terrIndex = avesmapsBuildAdventureIndex([
	{ public_id: "advT", title: "T", product_type: "kampagne", places: [
		{ role: "start", target_kind: "territory", target_wiki_key: "wiki:koenigreich-garetien" },
	] },
]);
const terrHit = avesmapsSelectAdventureEntries(terrIndex, { key: avesmapsNormalizeAdventureKey("wiki:koenigreich-garetien") }, "start");
assert.strictEqual(terrHit.length, 1);
assert.strictEqual(terrHit[0].adv.public_id, "advT");
console.log("territory index ok");

// empty / missing inputs are safe
assert.deepStrictEqual(avesmapsSelectAdventureEntries(null, { publicId: "S1" }, "start"), []);
assert.deepStrictEqual(avesmapsSelectAdventureEntries(index, {}, "start"), []);
console.log("guards ok");

console.log("ALL OK");
