const assert = require("assert");
const {
	avesmapsCitymapToRenderShape,
	avesmapsBuildCitymapIndex,
	avesmapsSelectCitymapEntries,
	avesmapsCitymapFacetOptions,
	avesmapsCitymapMatchesFilter,
	avesmapsCitymapTypeLabel,
} = require("../map-features-citymaps.js");

// ---- labels ----
// tr() is absent in Node, so the German default is what comes back -- which is also what the browser
// renders on the default (German) path.
assert.strictEqual(avesmapsCitymapTypeLabel("stadtplan"), "Stadtplan");
assert.strictEqual(avesmapsCitymapTypeLabel("hoehlen"), "Höhlen");
assert.strictEqual(avesmapsCitymapTypeLabel("was-auch-immer"), "was-auch-immer"); // pass-through
assert.strictEqual(avesmapsCitymapTypeLabel(""), "");

// ---- render shape: the three-valued rule (Spec §3.1) ----
// This is the assertion the whole feature hangs on. `!!citymap.is_color` would turn every unknown into
// false, and the reader would be told "nicht farbig" about a map nobody ever examined.
const unknown = avesmapsCitymapToRenderShape({ public_id: "a", title: "T" });
assert.strictEqual(unknown.is_color, null, "absent is_color stays unknown, not false");
assert.strictEqual(unknown.is_spoiler, null);
assert.strictEqual(unknown.valid_from_bf, null);
assert.strictEqual(unknown.width_px, null);
assert.deepStrictEqual(unknown.types, []);
assert.deepStrictEqual(unknown.links, []);

const known = avesmapsCitymapToRenderShape({
	public_id: "b", title: "Gareth", is_color: false, is_spoiler: true, is_official: 1,
	valid_from_bf: 1027, valid_to_bf: 9999, width_px: 2000, types: ["stadtplan"],
	thumb: "/uploads/kartensammlungen/b/thumb-1.png", map_url: "https://example.org/m",
	links: [{ key: "map", url: "https://example.org/m", state: "online" }],
	sources: [{ label: "Herz des Reiches", official: true }],
});
assert.strictEqual(known.is_color, false, "an explicit false stays false");
assert.strictEqual(known.is_spoiler, true);
assert.strictEqual(known.is_official, true, "1 -> true");
assert.strictEqual(known.valid_to_bf, 9999);
assert.strictEqual(known.links[0].state, "online", "link state survives into the shape");
console.log("citymap render shape ok");

// ---- index ----
const catalog = [
	{
		public_id: "m1", title: "Gareth Gesamtplan", types: ["stadtplan"], art: "politisch", is_color: true,
		is_official: true, valid_from_bf: 1027, valid_to_bf: 9999,
		sources: [{ label: "Herz des Reiches" }],
		places: [{ target_kind: "settlement", target_public_id: "loc-gareth", target_wiki_key: "wiki:Gareth", territory_path: ["wiki:Garetien", "wiki:Kosch"] }],
	},
	{
		public_id: "m2", title: "Kaiserviertel", types: ["viertel", "bezirk"], art: "skizze", is_color: false,
		is_spoiler: true, valid_from_bf: 1040, valid_to_bf: 1045,
		sources: [{ label: "Herz des Reiches" }],
		places: [{ target_kind: "settlement", target_public_id: "loc-gareth", target_wiki_key: "wiki:Gareth", territory_path: ["wiki:Garetien"] }],
	},
	{
		public_id: "m3", title: "Das Ehrenfeld", types: ["region"],
		places: [{ target_kind: "region", target_public_id: "reg-ehrenfeld", target_wiki_key: "wiki:Ehrenfeld" }],
	},
	{
		public_id: "m4", title: "Reichsstraße 1", types: ["uebersicht"],
		places: [{ target_kind: "path", target_public_id: "path-77", target_wiki_key: "Reichsstrasse_1" }],
	},
	{
		// Assigned STRAIGHT to a territory and deliberately WITHOUT a territory_path: that is what a row
		// looks like before the resolver has filled its ancestor path (fresh pick, or an empty
		// wiki_territory_model on a fresh DB). It must still show up on its own territory -- which is what
		// the byTerritoryKey belt in avesmapsSelectCitymapEntries is for.
		public_id: "m5", title: "Garetien politisch", types: ["uebersicht"], art: "politisch",
		places: [{ target_kind: "territory", target_wiki_key: "wiki:Garetien" }],
	},
];
const index = avesmapsBuildCitymapIndex(catalog);

const ids = (list) => list.map((c) => c.public_id).sort();
// A settlement finds its maps by exact public_id...
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { publicId: "loc-gareth" })), ["m1", "m2"]);
// ...and by wiki key.
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { key: "Gareth" })), ["m1", "m2"]);
// A territory aggregates its SUBTREE: Garetien holds its own map plus both Gareth maps (via territory_path).
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { territoryKey: "Garetien" })), ["m1", "m2", "m5"]);
// Kosch is only on m1's path.
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { territoryKey: "Kosch" })), ["m1"]);
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { regionPublicId: "reg-ehrenfeld" })), ["m3"]);
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { pathKey: "Reichsstrasse_1" })), ["m4"]);
assert.deepStrictEqual(ids(avesmapsSelectCitymapEntries(index, { pathPublicId: "path-77" })), ["m4"]);
// Nothing there -> [], never a throw.
assert.deepStrictEqual(avesmapsSelectCitymapEntries(index, { publicId: "loc-nowhere" }), []);
assert.deepStrictEqual(avesmapsSelectCitymapEntries(index, {}), []);
assert.deepStrictEqual(avesmapsSelectCitymapEntries(null, { publicId: "x" }), []);
// A map cited twice by the same place appears once.
const dupIndex = avesmapsBuildCitymapIndex([{
	public_id: "d1", title: "D", places: [
		{ target_kind: "settlement", target_public_id: "loc-x", target_wiki_key: "wiki:X" },
		{ target_kind: "settlement", target_public_id: "loc-x", target_wiki_key: "wiki:X" },
	],
}]);
assert.strictEqual(avesmapsSelectCitymapEntries(dupIndex, { publicId: "loc-x" }).length, 1, "deduped");
console.log("citymap index ok");

// ---- facets ----
const shapes = catalog.map(avesmapsCitymapToRenderShape);
const facets = avesmapsCitymapFacetOptions(shapes);
// Chips carry counts (§3.7) and are sorted by the LABEL a German reader sees, not by the slug.
const uebersicht = facets.types.find((t) => t.value === "uebersicht");
assert.strictEqual(uebersicht.count, 2, "two maps carry 'uebersicht'");
assert.strictEqual(uebersicht.label, "Übersicht");
assert.strictEqual(facets.types.find((t) => t.value === "viertel").count, 1);
assert.deepStrictEqual(facets.sources, ["Herz des Reiches"], "sources are deduped");
assert.deepStrictEqual(facets.arts.map((a) => a.value).sort(), ["politisch", "skizze"]);
// The 9999 open-ended sentinel must not become the visible upper bound ("1027–9999" is nonsense to read).
assert.deepStrictEqual(facets.yearRange, { min: 1027, max: 1045 }, "9999 sentinel excluded from the range");
assert.deepStrictEqual(avesmapsCitymapFacetOptions([]).yearRange, { min: 0, max: 0 });
console.log("citymap facets ok");

// ---- filter predicate (Spec §3.7) ----
const m1 = shapes[0]; // farbig, offiziell, politisch, stadtplan, 1027-9999
const m2 = shapes[1]; // nicht farbig, SPOILER, skizze, viertel+bezirk, 1040-1045
const m3 = shapes[2]; // everything unknown
const noFilter = { showSpoiler: true };

// No constraints -> everything passes.
assert.ok(avesmapsCitymapMatchesFilter(m1, noFilter) && avesmapsCitymapMatchesFilter(m3, noFilter));
assert.ok(avesmapsCitymapMatchesFilter(m1, null), "no filter object -> pass");

// Types: a map has MANY, so it passes on ANY match (OR).
assert.ok(avesmapsCitymapMatchesFilter(m2, { types: new Set(["bezirk"]), showSpoiler: true }));
assert.ok(avesmapsCitymapMatchesFilter(m2, { types: new Set(["viertel"]), showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(m2, { types: new Set(["stadtplan"]), showSpoiler: true }));
assert.ok(avesmapsCitymapMatchesFilter(m2, { types: new Set(), showSpoiler: true }), "empty set = no constraint");
// Array works as well as a Set (the adventure predicate duck-types the same way).
assert.ok(avesmapsCitymapMatchesFilter(m2, { types: ["bezirk"], showSpoiler: true }));

// THE §3.7 RULE: unknown matches no filter but "alle". m3 knows none of its properties.
assert.ok(!avesmapsCitymapMatchesFilter(m3, { colorOnly: true, showSpoiler: true }), "unknown colour fails 'farbig'");
assert.ok(!avesmapsCitymapMatchesFilter(m3, { officialOnly: true, showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(m3, { labeledOnly: true, showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(m3, { art: "politisch", showSpoiler: true }));
// An explicit FALSE also fails "farbig" -- but for the honest reason.
assert.ok(!avesmapsCitymapMatchesFilter(m2, { colorOnly: true, showSpoiler: true }));
assert.ok(avesmapsCitymapMatchesFilter(m1, { colorOnly: true, showSpoiler: true }));

// Spoiler is INVERTED: off by default, and it reveals rather than restricts.
assert.ok(!avesmapsCitymapMatchesFilter(m2, {}), "spoiler map hidden while the toggle is off");
assert.ok(avesmapsCitymapMatchesFilter(m2, { showSpoiler: true }), "toggle on -> spoiler map shows");
assert.ok(avesmapsCitymapMatchesFilter(m1, {}), "a non-spoiler map is unaffected by the toggle");
assert.ok(avesmapsCitymapMatchesFilter(m3, {}), "unknown spoiler is NOT treated as a spoiler");

// Source.
assert.ok(avesmapsCitymapMatchesFilter(m1, { source: "Herz des Reiches", showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(m3, { source: "Herz des Reiches", showSpoiler: true }));

// BF year: an OVERLAP test, because a map's validity is a RANGE (not the single year an adventure has).
assert.ok(avesmapsCitymapMatchesFilter(m2, { yearFrom: 1042, showSpoiler: true }), "1040-1045 overlaps from 1042");
assert.ok(avesmapsCitymapMatchesFilter(m2, { yearTo: 1042, showSpoiler: true }), "1040-1045 overlaps up to 1042");
assert.ok(avesmapsCitymapMatchesFilter(m2, { yearFrom: 1041, yearTo: 1043, showSpoiler: true }), "fully contained span");
assert.ok(!avesmapsCitymapMatchesFilter(m2, { yearFrom: 1046, showSpoiler: true }), "ended before the span");
assert.ok(!avesmapsCitymapMatchesFilter(m2, { yearTo: 1039, showSpoiler: true }), "started after the span");
assert.ok(avesmapsCitymapMatchesFilter(m1, { yearFrom: 1500, showSpoiler: true }), "9999 = still valid");
assert.ok(!avesmapsCitymapMatchesFilter(m3, { yearFrom: 1040, showSpoiler: true }), "unknown validity matches no year filter");
assert.ok(avesmapsCitymapMatchesFilter(m3, { yearFrom: 0, yearTo: 0, showSpoiler: true }), "no bound -> no constraint");
// One-sided validity still filters on the side it knows.
const openEnded = avesmapsCitymapToRenderShape({ public_id: "o", title: "O", valid_from_bf: 1030 });
assert.ok(avesmapsCitymapMatchesFilter(openEnded, { yearFrom: 1031, showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(openEnded, { yearTo: 1029, showSpoiler: true }));

// Filters AND together.
assert.ok(avesmapsCitymapMatchesFilter(m1, { types: new Set(["stadtplan"]), art: "politisch", colorOnly: true, officialOnly: true, yearFrom: 1030, showSpoiler: true }));
assert.ok(!avesmapsCitymapMatchesFilter(m1, { types: new Set(["stadtplan"]), art: "skizze", showSpoiler: true }));
console.log("citymap filter ok");

console.log("citymaps-index ok");
