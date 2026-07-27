// Unit test (Node, no build) for the innerorts/ausserorts FILTER on the frontend side:
// the Lage facet in js/review/review-subjects.js and the path list's own Lage section in
// js/review/review-path-sync.js. The classification itself is the server's job and is
// tested in api/_internal/wiki/__tests__/place-scope-test.php -- here we only prove the
// list reads the verdict correctly and, above all, errs on the safe side.
//
// Run: node tools/paths/test-place-scope-filter.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// --- the Lage facet in the subject registry --------------------------------------------
const registry = vm.createContext({});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), registry);

const locationFacets = Array.from(vm.runInContext('wikiSyncSubjectFacets("locations")', registry));
const scopeFacet = locationFacets.find((facet) => facet.key === "scope");
assert.ok(scopeFacet, "Siedlungen must offer a Lage facet -- it is the whole point of the filter");
assert.equal(scopeFacet.kind, "multi", "Lage is a multi facet: values come from the rows, never hardcoded");
assert.equal(
	scopeFacet.field,
	"place_scope_label",
	"must read the SERVER's label; deriving it again in the browser is how two answers start to disagree",
);
assert.equal(scopeFacet.label, "Lage");
console.log("facet-registry ok");

// --- the path list's Lage section --------------------------------------------------------
// review-path-sync.js is a browser script full of DOM work. Only the two pure functions are
// needed, so they are lifted out by name rather than executing the whole file (which would
// need a DOM). If either is renamed this test fails loudly, which is the intent.
const pathSource = readFileSync(path.join(repoRoot, "js", "review", "review-path-sync.js"), "utf8");
const lift = (name) => {
	const start = pathSource.indexOf(`function ${name}(`);
	assert.notEqual(start, -1, `${name} must exist in review-path-sync.js`);
	let depth = 0;
	let index = pathSource.indexOf("{", start);
	const bodyStart = index;
	for (; index < pathSource.length; index++) {
		if (pathSource[index] === "{") depth++;
		else if (pathSource[index] === "}") {
			depth--;
			if (depth === 0) break;
		}
	}
	assert.ok(index > bodyStart, `${name} body must be balanced`);
	return pathSource.slice(start, index + 1);
};

const scopeContext = vm.createContext({});
vm.runInContext(lift("pathRowScope"), scopeContext);
const rowScope = (row) => vm.runInContext(`pathRowScope(${JSON.stringify(row)})`, scopeContext);

assert.equal(rowScope({ place_scope_label: "innerorts" }), "innerorts");
assert.equal(rowScope({ place_scope_label: "unklar" }), "unklar");
assert.equal(rowScope({ place_scope_label: "außerorts" }), "außerorts");

// 💣 THE SAFETY RULE. A row whose staging predates lage_raw carries no verdict at all. It
// must read as "außerorts" -- the visible, work-list side. Defaulting to "innerorts" (or to
// an empty string that then matches nothing) would make hundreds of real ways vanish from
// the editor's list the moment the filter is switched on, and nothing would say why.
assert.equal(rowScope({}), "außerorts", "a row without a verdict must stay VISIBLE");
assert.equal(rowScope({ place_scope_label: "" }), "außerorts");
assert.equal(rowScope({ place_scope_label: "   " }), "außerorts");
assert.equal(rowScope({ place_scope_label: null }), "außerorts");
console.log("path-scope-default ok");

// --- the filter IS pre-selected, and the button must say so ------------------------------
// Owner 2026-07-27: "außerorts + unklar" on, "innerorts" off. An on-by-default filter is
// only allowed because isActive() counts it, so the funnel button reads "Filter (1)" --
// otherwise it would be the invisible liar the funnel exists to prevent.
const PRESELECT = /new Set\(\["außerorts", "unklar"\]\)/;
assert.match(pathSource, PRESELECT, "pathScopeFilter must start with außerorts+unklar selected");
assert.match(
	pathSource,
	/isActive: \(\) => pathScopeFilter\.size > 0/,
	"the pre-selection MUST make the funnel button show as active",
);
// And it must actually be wired into the row check, or the menu would be decoration.
assert.match(
	pathSource,
	/pathScopeFilter\.size > 0 && !pathScopeFilter\.has\(pathRowScope\(row\)\)/,
	"the Lage selection must be applied in pathRowMatchesFilters",
);
console.log("path-scope-wiring ok");

// --- Lage is a SUB-filter of the buildings, in the settlement list -----------------------
// It must only apply when "Typ: Besondere Bauwerke/Stätten" is selected -- a city is never
// inside a city, so offering the question for all 2400 settlements is noise. The dependency
// lives here, not in the registry.
const settlementSource = readFileSync(path.join(repoRoot, "js", "review", "review-settlement-list.js"), "utf8");
const settlementContext = vm.createContext({});
const liftFrom = (source, name) => {
	const start = source.indexOf(`function ${name}(`);
	assert.notEqual(start, -1, `${name} must exist in review-settlement-list.js`);
	let depth = 0;
	let index = source.indexOf("{", start);
	for (; index < source.length; index++) {
		if (source[index] === "{") depth++;
		else if (source[index] === "}") {
			depth--;
			if (depth === 0) break;
		}
	}
	return source.slice(start, index + 1);
};
vm.runInContext("const settlementScopeFilter = new Set();", settlementContext);
["settlementIsBuilding", "settlementRowScope", "settlementScopeMatches"].forEach((name) => {
	vm.runInContext(liftFrom(settlementSource, name), settlementContext);
});
const matches = (row) => vm.runInContext(`settlementScopeMatches(${JSON.stringify(row)})`, settlementContext);
const select = (...values) => vm.runInContext(
	`settlementScopeFilter.clear(); ${values.map((v) => `settlementScopeFilter.add(${JSON.stringify(v)});`).join(" ")}`,
	settlementContext,
);

// The building test goes through the stable slug, never the German label -- the label is UI
// text and may change, `gebaeude` may not (AGENTS.md §2/§8).
assert.equal(vm.runInContext('settlementIsBuilding({settlement_class:"gebaeude"})', settlementContext), true);
assert.equal(vm.runInContext('settlementIsBuilding({settlement_class:"stadt"})', settlementContext), false);
assert.equal(
	vm.runInContext('settlementIsBuilding({settlement_label:"Besondere Bauwerke/Stätten"})', settlementContext),
	false,
	"must not classify by label -- that is the copy that drifts",
);

const tempelInnerorts = { settlement_class: "gebaeude", place_scope_label: "innerorts" };
const burgAusserorts = { settlement_class: "gebaeude", place_scope_label: "außerorts" };
const stadt = { settlement_class: "stadt", place_scope_label: "außerorts" };

select();                       // nothing selected -> everything passes
assert.equal(matches(tempelInnerorts), true);
assert.equal(matches(stadt), true);

select("außerorts");
assert.equal(matches(burgAusserorts), true);
assert.equal(matches(tempelInnerorts), false, "an in-town building must drop out");
// 💣 A NON-building must NEVER be filtered by this sub-filter. With "Bauwerke + Dörfer"
// selected, the villages would otherwise vanish for failing to answer a question nobody
// asked them.
assert.equal(matches(stadt), true, "a settlement is untouched by the building sub-filter");
assert.equal(matches({ settlement_class: "dorf" }), true);

// A building without a verdict yet stays on the visible side.
select("außerorts");
assert.equal(matches({ settlement_class: "gebaeude" }), true, "no verdict -> stays visible");

// The default selection itself: außerorts + unklar in, innerorts out.
select("außerorts", "unklar");
assert.equal(matches(burgAusserorts), true);
assert.equal(matches({ settlement_class: "gebaeude", place_scope_label: "unklar" }), true,
	"unklar stays IN by default -- it is unchecked, and nobody should overlook it");
assert.equal(matches(tempelInnerorts), false);
console.log("settlement-subfilter ok");

// --- the pre-selection, in all three surfaces --------------------------------------------
// Panel list, path list and the settlement editor window must agree; two windows onto the
// same data that answer the same question differently is worse than no filter at all.
const editorSource = readFileSync(path.join(repoRoot, "html", "wiki-sync-settlement-editor.html"), "utf8");
assert.match(settlementSource, PRESELECT, "panel settlement list: pre-selected");
assert.match(editorSource, PRESELECT, "settlement EDITOR window: same pre-selection");
assert.match(
	settlementSource,
	/isActive: \(\) => settlementScopeFilter\.size > 0/,
	"panel: pre-selection must show in the funnel button",
);
assert.match(
	editorSource,
	/isActive: \(\) => settlementScopeFilter\.size > 0/,
	"editor: pre-selection must show in the funnel button",
);
// The editor must filter through the same rule, and only for buildings.
assert.match(editorSource, /if \(!settlementScopeMatch\(item\)\) return false;/, "editor: wired into the row check");
assert.match(
	editorSource,
	/settlementScopeFilter\.size === 0 \|\| !settlementIsBuilding\(item\)/,
	"editor: must leave non-buildings alone",
);

// 💣 The sub-section must NOT be hidden any more. With a pre-selection, a hidden section
// would filter rows away while its checkboxes are unreachable.
const indexHtml = readFileSync(path.join(repoRoot, "index.html"), "utf8");
const sectionTag = /(<div class="type-filter__section type-filter__section--sub" id="settlement-scope-filter-section"[^>]*>)/.exec(indexHtml);
assert.ok(sectionTag, "the Lage sub-section must exist in index.html");
assert.ok(!/\shidden[\s>]/.test(sectionTag[1]), "the Lage sub-section must be VISIBLE -- it carries a default selection");
assert.match(editorSource, /type-filter__section--sub/, "editor: Lage renders as an indented sub-section too");
console.log("settlement-subfilter-markup ok");

// --- route planner: an in-settlement object sets its CITY as the waypoint ----------------
// Typing "Plaza der Lüste" must put "Mengbilla" in the field. Place names are the KEYS of the
// routing graph -- the object's own name would find nothing. jQuery UI's {label, value} split
// does this without any special case in the routing itself.
const waypointSource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-waypoints.js"), "utf8");
// "Schänke Schnapsfass (Imdal)" -- the SEARCHED object leads, the city follows in brackets.
// You type the object's name, so it has to be the first thing on the line; the value that
// gets committed is still the city (owner 2026-07-28).
assert.match(
	waypointSource,
	/label: `\$\{match\.entry\.name\} \(\$\{match\.entry\.settlement\}\)`, value: match\.entry\.settlement/,
	"an in-settlement suggestion must lead with the object but commit the CITY",
);
// A plain place must stay a bare string -- that is the untouched behaviour for the 4600 real ones.
assert.match(waypointSource, /: match\.entry\.name\)\);/, "an ordinary place stays a plain string");
// 💣 If an in-settlement object shares its name with a real map place, the real one wins: it has
// an actual position, the other only points at a city.
assert.match(
	waypointSource,
	/ownNames\.has\(entry\.normalizedName\)/,
	"a name collision with a real map place must drop the in-settlement entry",
);
// The list must come from the payload, never from a per-keystroke request -- that is what keeps
// typing as fast as it is today (measured: +0.174 ms per keystroke over 5152 entries).
assert.match(waypointSource, /window\.avesmapsInSettlementPlaces/, "the list rides in the map payload");
assert.ok(
	!/fetch\(/.test(waypointSource.slice(waypointSource.indexOf("function getInSettlementWaypointEntries"), waypointSource.indexOf("function getWaypointAutocompleteScore"))),
	"the waypoint autocomplete must not fetch anything",
);
console.log("waypoint-autocomplete ok");

console.log("\nALL PLACE-SCOPE FILTER TESTS PASSED");
