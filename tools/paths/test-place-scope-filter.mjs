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

// --- the filter is not pre-selected ------------------------------------------------------
// An on-by-default filter that hides rows is the "invisible liar" the funnel exists to
// avoid (js/ui/filter-menu.js). The empty Set is load-bearing, not an oversight.
assert.match(
	pathSource,
	/const pathScopeFilter = new Set\(\);/,
	"pathScopeFilter must start EMPTY (= show everything) -- see the funnel's own rule",
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
console.log("settlement-subfilter ok");

// The section must start hidden in the markup, or it flashes before the first render.
const indexHtml = readFileSync(path.join(repoRoot, "index.html"), "utf8");
assert.match(
	indexHtml,
	/id="settlement-scope-filter-section"[^>]*\shidden/,
	"the Lage sub-section must be hidden by default -- it only belongs to the buildings",
);
assert.match(settlementSource, /const settlementScopeFilter = new Set\(\);/, "must start EMPTY");
console.log("settlement-subfilter-markup ok");

console.log("\nALL PLACE-SCOPE FILTER TESTS PASSED");
