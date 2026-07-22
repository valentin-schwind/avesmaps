// Unit test (Node, no build) for renderWikiSyncVerbs in js/review/review-wiki-sync.js.
//
// Each subject has exactly ONE button, the one that already exists in its section, and the row
// MOVES that element rather than building a stand-in (owner 2026-07-22). Moving is what makes the
// duplication impossible: a DOM node has one parent, so the button cannot be in the row and in its
// old tile at the same time. The part that can break is the other half -- putting it back when the
// user switches subject. Miss that and the buttons pile up in the row, one per subject visited.
//
// Run: node tools/paths/test-wiki-sync-verb-row.mjs
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

// Minimal DOM with real parent bookkeeping -- appendChild has to DETACH from the old parent,
// otherwise the test would not notice a button living in two places.
function makeNode(id) {
	const node = {
		id,
		children: [],
		parentElement: null,
		appendChild(child) {
			if (child.parentElement && child.parentElement !== node) {
				const siblings = child.parentElement.children;
				siblings.splice(siblings.indexOf(child), 1);
			}
			child.parentElement = node;
			if (!node.children.includes(child)) {
				node.children.push(child);
			}
		},
		remove() {
			if (node.parentElement) {
				const siblings = node.parentElement.children;
				siblings.splice(siblings.indexOf(node), 1);
				node.parentElement = null;
			}
		},
	};
	return node;
}

const host = makeNode("wiki-sync-verbs");
const sections = {};
const buttons = {};
// One section per subject, each holding the button the registry names for it.
[
	["locations", "settlement-editor-open"],
	["territories", "wiki-sync-territories"],
	["regions", "wiki-sync-sync-region"],
	["paths", "wiki-sync-sync-path"],
	["powerlines", "wiki-sync-powerlines-sync"],
	["adventures", "adventure-editor-open"],
	["citymaps", "citymaps-editor-open"],
	["lore", "wiki-sync-lore-open"],
].forEach(([subject, buttonId]) => {
	const section = makeNode(`section-${subject}`);
	const button = makeNode(buttonId);
	section.appendChild(button);
	sections[subject] = section;
	buttons[buttonId] = button;
});

const context = vm.createContext({
	document: {
		getElementById: (id) => (id === "wiki-sync-verbs" ? host : buttons[id] || null),
	},
	WeakMap,
	Array,
	console,
});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);
vm.runInContext("let activeWikiSyncPanelTab = 'locations';", context);
vm.runInContext(sliceFunction("renderWikiSyncVerbs").replace(/^function/, "const wikiSyncVerbHomes = new WeakMap();\nfunction"), context);

const select = (key) => {
	vm.runInContext(`activeWikiSyncPanelTab = ${JSON.stringify(key)};`, context);
	vm.runInContext("renderWikiSyncVerbs();", context);
};

// --- the one button of the subject, and only it ------------------------------------------
{
	select("locations");
	assert.equal(host.children.length, 1, "exactly one button belongs in the row");
	assert.equal(host.children[0].id, "settlement-editor-open");
	// The SAME element, not a copy: that is what carries the id, the bindings and the in-button
	// progress fill that setWikiSyncButtonState writes.
	assert.equal(host.children[0], buttons["settlement-editor-open"]);
	assert.equal(sections.locations.children.length, 0, "and it is no longer in its old tile");
}

// --- switching puts the previous one back ------------------------------------------------
{
	select("paths");
	assert.equal(host.children.length, 1, "the row must never accumulate buttons");
	assert.equal(host.children[0].id, "wiki-sync-sync-path");
	assert.equal(sections.locations.children.length, 1, "the settlement button went home");
	assert.equal(sections.locations.children[0].id, "settlement-editor-open");
}

// --- walk every subject, twice round; nothing may pile up or get lost --------------------
{
	const order = ["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"];
	for (const round of [1, 2]) {
		for (const key of order) {
			select(key);
			assert.equal(host.children.length, 1, `after ${key} (round ${round}) the row holds one button`);
			const expected = vm.runInContext(`wikiSyncSubjectButtonId(${JSON.stringify(key)})`, context);
			assert.equal(host.children[0].id, expected, `${key} must show #${expected}`);
			// Every other subject's button is back in its own section.
			order.filter((other) => other !== key).forEach((other) => {
				assert.equal(sections[other].children.length, 1, `${other} kept its button while ${key} was shown`);
			});
		}
	}
}

// --- a button the markup does not have leaves the row empty, and does not throw ----------
{
	select("lore");
	assert.equal(host.children.length, 1);
	delete buttons["wiki-sync-lore-open"];
	select("lore");
	assert.equal(host.children.length, 0, "a missing button leaves an empty row rather than a stale one");
}

console.log("wiki-sync-verb-row: OK");
