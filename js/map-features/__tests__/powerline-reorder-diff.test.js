const assert = require("assert");
const { avesmapsPowerlineReorderDiff } = require("../powerline-topology.js");

// The editor's read-endpoint shape (flat rows) and the live-map shape (nested properties) must both
// be accepted, exactly like the other topology helpers.
const seg = (publicId, from, to) => ({ public_id: publicId, from_public_id: from, to_public_id: to });
const nested = (publicId, from, to) => ({ properties: { public_id: publicId, from_public_id: from, to_public_id: to } });

const undirected = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const createKeys = (diff) => diff.create.map((e) => undirected(e.from, e.to)).sort();
const removeSorted = (diff) => diff.remove.slice().sort();

// 1. Adjacent swap in a 4-node strand: A-B, B-C, C-D reordered to A,C,B,D. The shared edge B-C is
//    kept; only the two edges that change are rewired.
{
	const segs = [seg("ab", "A", "B"), seg("bc", "B", "C"), seg("cd", "C", "D")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["A", "C", "B", "D"]);
	assert.deepStrictEqual(createKeys(diff), [undirected("A", "C"), undirected("B", "D")].sort(), "new edges A-C and B-D");
	assert.deepStrictEqual(removeSorted(diff), ["ab", "cd"].sort(), "A-B and C-D removed, B-C kept");
}

// 2. Order unchanged => nothing to do.
{
	const segs = [seg("ab", "A", "B"), seg("bc", "B", "C"), seg("cd", "C", "D")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["A", "B", "C", "D"]);
	assert.deepStrictEqual(diff.create, [], "no new edges when order unchanged");
	assert.deepStrictEqual(diff.remove, [], "no removals when order unchanged");
}

// 3. Reversing a strand is the SAME strand: edges are undirected, so it is a no-op.
{
	const segs = [seg("ab", "A", "B"), seg("bc", "B", "C"), seg("cd", "C", "D")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["D", "C", "B", "A"]);
	assert.deepStrictEqual(diff.create, [], "reversing changes no edges");
	assert.deepStrictEqual(diff.remove, [], "reversing removes nothing");
}

// 4. A segment stored to->from still satisfies the wanted from->to pair.
{
	const segs = [seg("ba", "B", "A"), seg("bc", "B", "C")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["A", "B", "C"]);
	assert.deepStrictEqual(diff.create, [], "B->A satisfies wanted A-B");
	assert.deepStrictEqual(diff.remove, [], "nothing removed");
}

// 5. Nested-props segments (the live-map shape) are accepted too.
{
	const segs = [nested("ab", "A", "B"), nested("bc", "B", "C"), nested("cd", "C", "D")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["A", "C", "B", "D"]);
	assert.deepStrictEqual(createKeys(diff), [undirected("A", "C"), undirected("B", "D")].sort());
	assert.deepStrictEqual(removeSorted(diff), ["ab", "cd"].sort());
}

// 6. A surplus duplicate of a still-wanted edge is dropped -- keep exactly one segment per edge.
{
	const segs = [seg("ab1", "A", "B"), seg("ab2", "A", "B")];
	const diff = avesmapsPowerlineReorderDiff(segs, ["A", "B"]);
	assert.deepStrictEqual(diff.create, [], "the wanted edge already exists");
	assert.deepStrictEqual(diff.remove, ["ab2"], "the duplicate is dropped, the first kept");
}

// 7. Degenerate inputs stay well-defined.
{
	assert.deepStrictEqual(
		avesmapsPowerlineReorderDiff([], ["A", "B"]),
		{ create: [{ from: "A", to: "B" }], remove: [] },
		"no segments => create the single edge"
	);
	assert.deepStrictEqual(
		avesmapsPowerlineReorderDiff([seg("ab", "A", "B")], []),
		{ create: [], remove: ["ab"] },
		"empty order => remove every edge"
	);
}

console.log("powerline reorder-diff tests passed");
