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

console.log("\nALL PLACE-SCOPE FILTER TESTS PASSED");
