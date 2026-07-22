// Unit test (Node, no build) for setWikiSyncPanelTab in js/review/review-wiki-sync.js.
//
// The function is sliced out of the file and run in a vm context against a fake DOM, the same
// approach as tools/paths/test-review-tab-cascade.mjs. Slicing the REAL function matters: the
// regression this guards against was a hardcoded value list, and a test that restated the list
// would have passed happily.
//
// Run: node tools/paths/test-wiki-sync-panel-tab.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "review", "review-wiki-sync.js"), "utf8");

function sliceFunction(name) {
	const start = source.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `function ${name} not found`);
	let depth = 0;
	for (let i = source.indexOf("{", start); i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces in ${name}`);
}

const fakeNode = (dataset) => ({
	dataset,
	classList: { toggle(name, on) { this[name] = Boolean(on); } },
	setAttribute() {},
});
const tabNodes = ["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"]
	.map((key) => fakeNode({ wikiSyncPanelTab: key }));

const context = vm.createContext({
	document: {
		querySelectorAll: (selector) => (selector.includes("panel-tab") ? tabNodes : []),
	},
	console,
});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);
vm.runInContext("let activeWikiSyncPanelTab = 'locations';", context);
// The lazy loaders are optional in the real file (typeof … === "function"); leaving them
// undefined here is the honest case and must not throw.
vm.runInContext(sliceFunction("setWikiSyncPanelTab"), context);

const active = () => vm.runInContext("activeWikiSyncPanelTab", context);
const set = (key) => vm.runInContext(`setWikiSyncPanelTab(${JSON.stringify(key)})`, context);

// Every registry key must survive the round trip. These three are the new ones: powerlines had
// no tab at all, citymaps and lore were sub-tabs under "Materialien".
["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"]
	.forEach((key) => {
		set(key);
		assert.equal(active(), key, `${key} must not fall back silently`);
	});

// Unknown keys still fall back, and never throw.
["materials", "", "nope", null, undefined].forEach((key) => {
	set(key);
	assert.equal(active(), "locations", `unknown key ${String(key)} falls back to locations`);
});

// The active class really lands on the matching tab node and nowhere else.
set("lore");
assert.equal(tabNodes.find((n) => n.dataset.wikiSyncPanelTab === "lore").classList["is-active"], true);
assert.equal(tabNodes.find((n) => n.dataset.wikiSyncPanelTab === "paths").classList["is-active"], false);

// Every loader the table names must EXIST in the codebase. The typeof guards make a misspelled
// loader silently do nothing -- selecting that subject would then show an empty list forever,
// with no error anywhere. (This caught `loadWikiSyncLoreList`, which never existed: the real
// function is loadLoreList("panel").)
const loaderTable = /const loaders = \{([\s\S]*?)\n\t\};/.exec(sliceFunction("setWikiSyncPanelTab"));
assert.ok(loaderTable, "the loader table must stay a literal object, so this check can read it");
// Every loader is reached through exactly one `typeof NAME === "function"` guard, so reading the
// guards both collects the names and enforces that convention.
const namedLoaders = [...loaderTable[1].matchAll(/typeof (\w+) === "function"/g)].map((m) => m[1]);
assert.ok(namedLoaders.length >= 7, `expected the table to guard every loader, found ${namedLoaders.length}`);
const searched = ["js/review/review-wiki-sync.js", "js/review/review-wiki-sync-cases.js",
	"js/review/review-settlement-list.js", "js/review/review-region-sync.js", "js/review/review-path-sync.js"]
	.map((file) => readFileSync(path.join(repoRoot, file), "utf8")).join("\n");
[...new Set(namedLoaders)].forEach((name) => {
	assert.ok(searched.includes(`function ${name}(`),
		`loader ${name}() is named in the table but defined nowhere -- it would silently no-op`);
});

console.log("wiki-sync-panel-tab: OK");
