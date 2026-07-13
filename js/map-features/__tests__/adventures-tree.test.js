const assert = require("assert");
const {
	avesmapsNormalizeAdventureKey,
	avesmapsAdventureToRenderShape,
	avesmapsBuildAdventureTerritoryTree,
	avesmapsAdventureFacetOptions,
	avesmapsAdventureMatchesFilter,
	avesmapsAdventurePrettifyKey,
} = require("../map-features-adventures.js");

// ---- render shape: Phase 2.3 facet fields (official / complexity / genre) ----
const s = avesmapsAdventureToRenderShape({
	public_id: "x", title: "T", product_type: "gruppenabenteuer",
	is_official: 1, complexity_gm: "hoch", complexity_pl: "mittel", genre: "Intrige",
});
assert.strictEqual(s.official, true);
assert.strictEqual(s.complexity, "hoch"); // complexity_gm preferred over complexity_pl
assert.strictEqual(s.genre, "Intrige");
assert.strictEqual(avesmapsAdventureToRenderShape({ public_id: "y", is_official: 0 }).official, false);
assert.strictEqual(avesmapsAdventureToRenderShape({ public_id: "z", complexity_pl: "niedrig" }).complexity, "niedrig"); // falls back to pl
console.log("render shape facets ok");

// ---- prettify fallback ----
assert.strictEqual(avesmapsAdventurePrettifyKey("wiki:baronie-c"), "Baronie C");
assert.strictEqual(avesmapsAdventurePrettifyKey(""), "");
console.log("prettify ok");

// ---- nested territory tree (deepest-wins) ----
// Hierarchy: Mittelreich(Reich) > {Grafschaft G(Grafschaft) > Baronie A(Baronie), Grafschaft H > Baronie C}.
// advZ starts at the realm; advY starts at Grafschaft G; advX starts at Baronie A and PLAYS in two H-baronies.
const catalog = [
	{ public_id: "advX", title: "X", product_type: "gruppenabenteuer", bf_year: 1044, is_official: 1, genre: "Intrige", complexity_gm: "hoch", places: [
		{ role: "start", target_kind: "settlement", territory_path: ["wiki:baronie-a", "wiki:grafschaft-g", "wiki:mittelreich"] },
		{ role: "play", target_kind: "settlement", territory_path: ["wiki:baronie-c", "wiki:grafschaft-h", "wiki:mittelreich"] },
		{ role: "play", target_kind: "settlement", territory_path: ["wiki:baronie-d", "wiki:grafschaft-h", "wiki:mittelreich"] },
	] },
	{ public_id: "advY", title: "Y", product_type: "soloabenteuer", bf_year: 1030, is_official: 0, genre: "Reise", complexity_gm: "niedrig", places: [
		{ role: "start", target_kind: "territory", territory_path: ["wiki:grafschaft-g", "wiki:mittelreich"] },
	] },
	{ public_id: "advZ", title: "Z", product_type: "kampagne", bf_year: 1018, is_official: 1, genre: "Krieg", complexity_gm: "hoch", places: [
		{ role: "start", target_kind: "territory", territory_path: ["wiki:mittelreich"] },
	] },
];
const meta = {
	"wiki:mittelreich": { name: "Mittelreich", rank: "Reich" },
	"wiki:grafschaft-g": { name: "Grafschaft G", rank: "Grafschaft" },
	"wiki:baronie-a": { name: "Baronie A", rank: "Baronie" },
	"wiki:grafschaft-h": { name: "Grafschaft H", rank: "Grafschaft" },
	// wiki:baronie-c / -d intentionally absent -> fallback prettify + empty rank
};

const root = avesmapsBuildAdventureTerritoryTree(catalog, meta, "wiki:mittelreich");
assert.strictEqual(root.name, "Mittelreich");
assert.strictEqual(root.rank, "Reich");
// Realm-direct: only advZ begins AT the realm node.
assert.strictEqual(root.start.length, 1);
assert.strictEqual(root.start[0].title, "Z");
assert.strictEqual(root.play.length, 0);
// Children sorted by name: Grafschaft G, then Grafschaft H.
assert.strictEqual(root.children.length, 2);
assert.deepStrictEqual(root.children.map((c) => c.name), ["Grafschaft G", "Grafschaft H"]);

const gg = root.children[0];
assert.strictEqual(gg.rank, "Grafschaft");
assert.strictEqual(gg.start.length, 1); // advY begins at Grafschaft G
assert.strictEqual(gg.start[0].title, "Y");
assert.strictEqual(gg.children.length, 1);
const ba = gg.children[0];
assert.strictEqual(ba.name, "Baronie A");
assert.strictEqual(ba.rank, "Baronie");
assert.strictEqual(ba.start.length, 1); // advX begins at Baronie A
assert.strictEqual(ba.start[0].title, "X");
assert.strictEqual(ba.children.length, 0);

const gh = root.children[1];
assert.strictEqual(gh.children.length, 1);
const bc = gh.children[0];
assert.strictEqual(bc.name, "Baronie C"); // fallback prettify (no meta)
assert.strictEqual(bc.rank, ""); // no meta -> no rank pill
// advX PLAYS in two H-baronies but appears ONCE (deepest-wins, first of equal depth = Baronie C).
assert.strictEqual(bc.play.length, 1);
assert.strictEqual(bc.play[0].title, "X");
assert.strictEqual(bc.start.length, 0);
console.log("nested tree deepest-wins ok");

// Mid-level root (Grafschaft G): advY (direct) + advX (Baronie A); advZ (realm) is NOT in this subtree.
const gRoot = avesmapsBuildAdventureTerritoryTree(catalog, meta, "wiki:grafschaft-g");
assert.strictEqual(gRoot.name, "Grafschaft G");
assert.strictEqual(gRoot.start.length, 1);
assert.strictEqual(gRoot.start[0].title, "Y");
assert.strictEqual(gRoot.children.length, 1);
assert.strictEqual(gRoot.children[0].start[0].title, "X");
console.log("nested tree mid-level root ok");

// Guards: empty key -> null; empty catalog -> a childless root.
assert.strictEqual(avesmapsBuildAdventureTerritoryTree(catalog, meta, ""), null);
const emptyRoot = avesmapsBuildAdventureTerritoryTree([], meta, "wiki:mittelreich");
assert.strictEqual(emptyRoot.children.length, 0);
assert.strictEqual(emptyRoot.start.length, 0);
console.log("nested tree guards ok");

// ---- facet options + filter predicate ----
const shapes = [
	avesmapsAdventureToRenderShape(catalog[0]), // Gruppenabenteuer / hoch / Intrige / official
	avesmapsAdventureToRenderShape(catalog[1]), // Soloabenteuer / niedrig / Reise / inofficial
	avesmapsAdventureToRenderShape(catalog[2]), // Kampagne / hoch / Krieg / official
];
const facets = avesmapsAdventureFacetOptions(shapes);
assert.deepStrictEqual(facets.types, ["Gruppenabenteuer", "Kampagne", "Soloabenteuer"]);
assert.deepStrictEqual(facets.complexities, ["hoch", "niedrig"]); // distinct + sorted
assert.deepStrictEqual(facets.genres, ["Intrige", "Krieg", "Reise"]);
console.log("facet options ok");

// no filter / empty facets = pass-through
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], null), true);
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], { types: new Set(), complexity: "", genre: "", officialOnly: false }), true);
// type filter (Set)
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], { types: new Set(["Kampagne"]) }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[2], { types: new Set(["Kampagne"]) }), true);
// type filter (array form also supported)
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], { types: ["Gruppenabenteuer"] }), true);
// complexity + genre
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], { complexity: "hoch" }), true);
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[1], { complexity: "hoch" }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[1], { genre: "Reise" }), true);
// officialOnly hides the inofficial one
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[1], { officialOnly: true }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(shapes[0], { officialOnly: true }), true);
console.log("filter predicate ok");

// ---- edition (DSA-Version) + year facets/filters (Owner: overview dialog) ----
const yShapes = [
	avesmapsAdventureToRenderShape({ public_id: "e1", title: "A", edition: "DSA5", bf_year: 1040 }),
	avesmapsAdventureToRenderShape({ public_id: "e2", title: "B", edition: "DSA4", bf_year: 1020 }),
	avesmapsAdventureToRenderShape({ public_id: "e3", title: "C", edition: "DSA5" }), // undated -> year 0
];
const yf = avesmapsAdventureFacetOptions(yShapes);
assert.deepStrictEqual(yf.editions, ["DSA4", "DSA5"]);           // distinct + sorted
assert.deepStrictEqual(yf.yearRange, { min: 1020, max: 1040 }); // undated ignored
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[0], { edition: "DSA5" }), true);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[1], { edition: "DSA5" }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[0], { yearFrom: 1030 }), true);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[1], { yearFrom: 1030 }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[0], { yearTo: 1030 }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[1], { yearTo: 1030 }), true);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[0], { yearFrom: 1000, yearTo: 1050 }), true);
// undated (year 0) is excluded once a year bound is set, included when none
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[2], { yearFrom: 1000 }), false);
assert.strictEqual(avesmapsAdventureMatchesFilter(yShapes[2], {}), true);
console.log("edition + year filter ok");

console.log("ALL OK");
