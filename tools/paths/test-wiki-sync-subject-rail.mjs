// Unit test (Node, no build) for the subject rail in js/review/review-wiki-sync.js -- the
// two-column selection that replaced the level-2 tab strip.
//
// The rail is built from the registry and exists nowhere in the markup, so the things that can
// break it are invisible in index.html: a missing data attribute makes the row stop being a tab
// (the cascade and setWikiSyncPanelTab both recognise tabs by that attribute alone), and a wrong
// date lookup silently shows nothing because subject keys and server sync kinds are spelled
// differently. Both are checked here.
//
// Run: node tools/paths/test-wiki-sync-subject-rail.mjs
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

const host = { children: [], innerHTML: "", appendChild(node) { this.children.push(node); } };
const makeElement = () => ({
	attrs: {}, className: "", innerHTML: "", type: "", title: "", listeners: [],
	setAttribute(name, value) { this.attrs[name] = value; },
	addEventListener(type, handler) { this.listeners.push({ type, handler }); },
});

const context = vm.createContext({
	document: {
		getElementById: (id) => (id === "wiki-sync-subject-rail" ? (host.innerHTML = "", host.children = [], host) : null),
		createElement: () => makeElement(),
	},
	console,
});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);
vm.runInContext("let activeWikiSyncPanelTab = 'locations';", context);
vm.runInContext("function escapeHtml(s) { return String(s == null ? '' : s); }", context);
vm.runInContext("function setWikiSyncPanelTab(k) { activeWikiSyncPanelTab = k; }", context);
vm.runInContext(sliceFunction("formatWikiSyncKindSyncedText"), context);
vm.runInContext(sliceFunction("wikiSyncKindSyncedLabel"), context);
vm.runInContext("var wikiSyncKindSyncedRaw = null;", context);
vm.runInContext(sliceFunction("wikiSyncRailDateText"), context);
vm.runInContext(sliceFunction("renderWikiSyncSubjectRail"), context);

const render = () => { vm.runInContext("renderWikiSyncSubjectRail()", context); return host.children; };

// --- eight rows, in registry order, each a real tab --------------------------------------
{
	const rows = render();
	assert.equal(rows.length, 8, "all eight subjects must get a row");
	assert.deepEqual(
		rows.map((r) => r.attrs["data-wiki-sync-panel-tab"]),
		["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"],
	);
	// Without this attribute the row still LOOKS right and is simply not a tab any more: the
	// cascade cannot find it to restore, and setWikiSyncPanelTab cannot mark it active.
	rows.forEach((row) => assert.ok(row.attrs["data-wiki-sync-panel-tab"], "every row must carry the tab attribute"));
	rows.forEach((row) => assert.equal(row.listeners.filter((l) => l.type === "click").length, 1,
		"bootstrap binds the tab attribute directly, not delegated -- each row needs its own listener"));
}

// --- the active marker follows activeWikiSyncPanelTab ------------------------------------
{
	vm.runInContext("activeWikiSyncPanelTab = 'lore';", context);
	const rows = render();
	const active = rows.filter((r) => r.className.includes("is-active"));
	assert.equal(active.length, 1, "exactly one row is active");
	assert.equal(active[0].attrs["data-wiki-sync-panel-tab"], "lore");
	assert.equal(active[0].attrs["aria-selected"], "true");
	vm.runInContext("activeWikiSyncPanelTab = 'locations';", context);
}

// --- a row carries name and date, and NO count -------------------------------------------
// A count used to sit between them, fed by the list renderers -- which only run once a subject
// is clicked. So the rail opened with seven em dashes and one number and grew a number per
// visit; a status board that learns its own state only after the visit is not one (Owner
// 2026-07-22). This guards the whole chain: span, emitter and feeders are gone for good.
{
	const rows = render();
	rows.forEach((row) => assert.ok(!row.innerHTML.includes("wiki-sync-rail__count"),
		"no row may carry a count span -- the number is unknown until the subject was visited"));
	rows.forEach((row) => assert.ok(!row.innerHTML.includes("—"),
		"the em dash was the placeholder for the unknown count and goes with it"));
	assert.equal(source.includes("setWikiSyncSubjectCount"), false,
		"the emitter must not come back -- its four feeders were removed with it");
}

// --- the date column translates subject key -> server sync kind --------------------------
// This is the bug the mapping exists for: the server answers under "settlement"/"citymap", the
// rail asks for "locations"/"citymaps". Looking up by subject key finds nothing, every row shows
// blank, and the panel silently stops being a status board.
{
	vm.runInContext(`wikiSyncKindSyncedRaw = { settlement: "2026-07-22 09:14:00", citymap: null };`, context);
	const rows = render();
	const dateOf = (key) => {
		const row = rows.find((r) => r.attrs["data-wiki-sync-panel-tab"] === key);
		return /wiki-sync-rail__date">([^<]*)</.exec(row.innerHTML)[1];
	};
	assert.equal(dateOf("locations"), "22.07.", "settlement's date must reach the locations row");
	assert.equal(dateOf("citymaps"), "nie", "an explicit null is 'never synced' -- a real answer");
	assert.equal(dateOf("territories"), "", "a kind the answer omits stays blank, not 'nie'");
	assert.equal(dateOf("powerlines"), "", "no server kind at all -- must not claim anything");

	// The two empty cases must not collapse into one: "we were told never" and "we were told
	// nothing" are different facts, and the row title has to keep them apart.
	const titleOf = (key) => rows.find((r) => r.attrs["data-wiki-sync-panel-tab"] === key).title;
	assert.match(titleOf("citymaps"), /Noch nie gesynct/);
	assert.match(titleOf("territories"), /unbekannt/);
}

console.log("wiki-sync-subject-rail: OK");
