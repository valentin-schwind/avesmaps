const assert = require("assert");
const {
	avesmapsAdventureProductTypeLabel,
	avesmapsAdventureEditionSortKey,
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

// The server-built link list (Spec §2.5) must survive the shape conversion -- the shape is built from an
// explicit field list, so a link list left out here silently never reaches the dialog no matter how
// correct the backend is.
const linked = avesmapsAdventureToRenderShape({
	public_id: "z", title: "T",
	links: [{ key: "fshop", label: "F-Shop", url: "https://f-shop/x", state: "online" }],
});
assert.deepStrictEqual(linked.links, [{ key: "fshop", label: "F-Shop", url: "https://f-shop/x", state: "online" }]);
// An adventure without links (placeholder data / a catalog older than the field) yields [], never undefined.
assert.deepStrictEqual(avesmapsAdventureToRenderShape({ public_id: "y" }).links, []);
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

// ---- Phase 2: territory subtree aggregation (byTerritoryPath) ----
// Each settlement place carries its territory ancestor path (deepest -> root). Aggregation over a
// clicked territory = all adventures whose place path CONTAINS that territory key.
const territoryCatalog = [
	{ public_id: "advX", title: "X", product_type: "gruppenabenteuer", bf_year: 1044, places: [
		{ role: "start", target_kind: "settlement", target_public_id: "SX", territory_path: ["wiki:baronie-a", "wiki:grafschaft-g", "wiki:mittelreich"] },
		{ role: "play", target_kind: "settlement", target_public_id: "SP", territory_path: ["wiki:baronie-c", "wiki:grafschaft-h", "wiki:mittelreich"] },
	] },
	{ public_id: "advY", title: "Y", product_type: "soloabenteuer", bf_year: 1030, places: [
		{ role: "start", target_kind: "settlement", target_public_id: "SY", territory_path: ["wiki:baronie-b", "wiki:grafschaft-g", "wiki:mittelreich"] },
	] },
];
const ti = avesmapsBuildAdventureIndex(territoryCatalog);
const mrKey = avesmapsNormalizeAdventureKey("wiki:mittelreich");
const gKey = avesmapsNormalizeAdventureKey("wiki:grafschaft-g");
const aKey = avesmapsNormalizeAdventureKey("wiki:baronie-a");

// Root (Mittelreich): both adventures begin in its subtree; advX also PLAYS there (play place is a MR barony).
assert.strictEqual(avesmapsSelectAdventureEntries(ti, { territoryKey: mrKey }, "start").length, 2);
const playMR = avesmapsSelectAdventureEntries(ti, { territoryKey: mrKey }, "play");
assert.strictEqual(playMR.length, 1);
assert.strictEqual(playMR[0].adv.public_id, "advX");
// Mid-level (Grafschaft G): advX (baronie-a) + advY (baronie-b) both under G.
assert.strictEqual(avesmapsSelectAdventureEntries(ti, { territoryKey: gKey }, "start").length, 2);
// Leaf (Baronie A): only advX begins there.
const beginA = avesmapsSelectAdventureEntries(ti, { territoryKey: aKey }, "start");
assert.strictEqual(beginA.length, 1);
assert.strictEqual(beginA[0].adv.public_id, "advX");
// Dedup: an adventure with two places in the same subtree appears ONCE ('all' -> advX + advY).
assert.strictEqual(avesmapsSelectAdventureEntries(ti, { territoryKey: mrKey }, "all").length, 2);
// A territory outside any path -> nothing.
assert.strictEqual(avesmapsSelectAdventureEntries(ti, { territoryKey: avesmapsNormalizeAdventureKey("wiki:andergast") }, "all").length, 0);
console.log("territory subtree aggregation ok");

// ---- Phase 2: landscape region (byRegionPublicId + byRegionKey) + path (byPathKey + byPathPublicId) ----
const regionPathCatalog = [
	{ public_id: "advR", title: "R", product_type: "gruppenabenteuer", bf_year: 1040, places: [
		{ role: "start", target_kind: "region", target_public_id: "R1", target_wiki_key: "wiki:raschtulswall" },
		{ role: "play", target_kind: "path", target_public_id: "P1seg", target_wiki_key: "bornstrasse" },
	] },
];
const rp = avesmapsBuildAdventureIndex(regionPathCatalog);
// Region: the exact public_id (what the resolver stores = the label's public_id) AND the wiki-key fallback hit.
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { regionPublicId: "R1" }, "start").length, 1);
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { regionKey: avesmapsNormalizeAdventureKey("wiki:raschtulswall") }, "start").length, 1);
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { regionPublicId: "R1" }, "play").length, 0); // it BEGINS here, not plays
// Dedup across region public_id + key for the same adventure -> once.
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { regionPublicId: "R1", regionKey: avesmapsNormalizeAdventureKey("wiki:raschtulswall") }, "all").length, 1);
console.log("region index ok");
// Path: the wiki_path namespace key (UNPREFIXED at source) is the robust axis; the segment public_id also hits.
const bornKey = avesmapsNormalizeAdventureKey("bornstrasse");
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { pathKey: bornKey }, "play").length, 1);
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { pathPublicId: "P1seg" }, "play").length, 1);
assert.strictEqual(avesmapsSelectAdventureEntries(rp, { pathKey: bornKey }, "start").length, 0); // it PLAYS here, not begins
console.log("path index ok");

// ---- edition sort key ("nach Edition": DSA5 > DSA4.1 > DSA4 > … > DSA1 > non-DSA > empty; title tiebreak) ----
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA1"), -1);
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA5"), -5);
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA3.5"), -3.5);
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA4.1 Basis"), -4.1);
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA1-Ausbau"), -1);
assert.strictEqual(avesmapsAdventureEditionSortKey("DSA4 / DSA5"), -4); // first edition wins
assert.strictEqual(avesmapsAdventureEditionSortKey("Aventuria 2.0"), 1000); // non-DSA ruleset
assert.strictEqual(avesmapsAdventureEditionSortKey(""), 1001); // no edition sorts last
const edSorted = ["DSA5", "", "DSA1", "DSA4.1", "Aventuria 2.0", "DSA4"]
	.sort((a, b) => avesmapsAdventureEditionSortKey(a) - avesmapsAdventureEditionSortKey(b) || a.localeCompare(b, "de"));
assert.deepStrictEqual(edSorted, ["DSA5", "DSA4.1", "DSA4", "DSA1", "Aventuria 2.0", ""]);
console.log("edition sort key ok");

console.log("ALL OK");
