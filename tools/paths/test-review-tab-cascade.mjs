// Unit test (Node, no build) for the editor's tab-cascade memory in js/ui/ui-controls.js --
// "remember where I last was" across F5 (spec: docs/superpowers/specs/2026-07-17-editor-reiter-kaskade-design.md).
//
// The cascade block is sliced out of ui-controls.js and run in a vm context against a hand-built fake DOM.
// The real REVIEW_TAB_FAMILIES table comes along in that slice, so the table itself is under test, not a
// copy of it: the regression that started this (the "Materialien" tab, keyed "adventures", never being
// stored) was a missing entry in a value list, and a test that restated the list would have passed happily.
//
// Run: node tools/paths/test-review-tab-cascade.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "ui", "ui-controls.js"), "utf8");

// Same brace-matching idea the sibling tests use (tools/paths/test-way-labels.mjs), but slicing a whole
// region: from the first storage helper to the end of initializeReviewPanelTabState.
function endOfFunction(functionName) {
	const startIndex = source.indexOf(`function ${functionName}(`);
	assert.ok(startIndex >= 0, `function ${functionName} not found in ui-controls.js`);
	let depth = 0;
	for (let i = source.indexOf("{", startIndex); i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && --depth === 0) return i + 1;
	}
	throw new Error(`unbalanced braces in ${functionName}`);
}

const blockStart = source.indexOf("function readReviewTabStorageValue(");
assert.ok(blockStart >= 0, "readReviewTabStorageValue not found in ui-controls.js");
const cascadeSource = source.slice(blockStart, endOfFunction("initializeReviewPanelTabState"));

// The slice must carry the real table and must NOT carry a resurrected URL writer.
assert.ok(cascadeSource.includes("REVIEW_TAB_FAMILIES"), "the sliced region is missing the family table");

const ATTRIBUTE = {
	editorPanel: "data-editor-panel-tab",
	wikiSync: "data-wiki-sync-panel-tab",
	reviewSub: "data-review-subtab",
	material: "data-material-subtab",
	mail: "data-mail-tab",
};
const KEY = {
	editorPanel: "avesmaps.review.activeTab",
	wikiSync: "avesmaps.review.wikiSync.activeTab",
	reviewSub: "avesmaps.review.reports.activeTab",
	status: "avesmaps.review.status.activeTab",
	material: "avesmaps.review.material.activeTab",
	mail: "avesmaps.review.mail.activeTab",
};

function makeButton(attribute, value, { active = false, clickLog } = {}) {
	const button = {
		attributes: { [attribute]: value },
		active,
		clicks: 0,
		label: `${attribute}=${value}`,
		classList: { contains: (name) => name === "is-active" && button.active },
		getAttribute: (name) => (name in button.attributes ? button.attributes[name] : null),
		closest: (selector) => {
			const match = /^\[([a-z-]+)\]$/.exec(selector);
			return match && match[1] in button.attributes ? button : null;
		},
		click: () => {
			button.clicks += 1;
			if (clickLog) clickLog.push(button.label);
		},
	};
	return button;
}

function run({ buttons = [], stored = {}, href = "https://avesmaps.de/?edit=1", editMode = true } = {}) {
	const storage = new Map(Object.entries(stored));
	const replaceStateCalls = [];
	const listeners = [];
	const context = {
		IS_EDIT_MODE: editMode,
		URL,
		URLSearchParams,
		console: { warn() {} },
		document: {
			querySelector(selector) {
				const match = /^\[([a-z-]+)="([^"]+)"\]$/.exec(selector);
				if (!match) return null;
				return buttons.find((button) => button.attributes[match[1]] === match[2]) || null;
			},
			addEventListener: (type, handler) => listeners.push({ type, handler }),
		},
		window: {
			localStorage: {
				getItem: (key) => (storage.has(key) ? storage.get(key) : null),
				setItem: (key, value) => storage.set(key, value),
				removeItem: (key) => storage.delete(key),
			},
			location: { href },
			history: { state: null, replaceState: (...args) => replaceStateCalls.push(args) },
		},
	};
	vm.createContext(context);
	vm.runInContext(`${cascadeSource}\ninitializeReviewPanelTabState();`, context);

	const clickDocument = (target) => listeners
		.filter((entry) => entry.type === "click")
		.forEach((entry) => entry.handler({ target }));

	return { storage, replaceStateCalls, clickDocument };
}

// ---- 1. The regression: "Materialien" is keyed "adventures" and must be restored ----
{
	const clickLog = [];
	const materialien = makeButton(ATTRIBUTE.wikiSync, "adventures", { clickLog });
	run({
		buttons: [
			makeButton(ATTRIBUTE.editorPanel, "wiki-sync", { clickLog }),
			makeButton(ATTRIBUTE.wikiSync, "locations", { active: true, clickLog }),
			materialien,
		],
		stored: { [KEY.editorPanel]: "wiki-sync", [KEY.wikiSync]: "adventures" },
	});
	assert.equal(materialien.clicks, 1, '"Materialien" (key "adventures") was not restored');
}

// ---- 2. Level 3: the owner's actual destination ----
{
	const karten = makeButton(ATTRIBUTE.material, "citymaps");
	run({
		buttons: [makeButton(ATTRIBUTE.material, "adventures", { active: true }), karten],
		stored: { [KEY.material]: "citymaps" },
	});
	assert.equal(karten.clicks, 1, 'level 3 ("Karten") was not restored');
}

// ---- 3. A tab a deploy removed: no click, and the dead value is dropped ----
{
	const locations = makeButton(ATTRIBUTE.wikiSync, "locations", { active: true });
	const { storage } = run({
		buttons: [locations],
		stored: { [KEY.wikiSync]: "reiter-den-es-nicht-mehr-gibt" },
	});
	assert.equal(locations.clicks, 0, "a dead stored value must not click anything");
	assert.equal(storage.has(KEY.wikiSync), false, "a dead stored value must be forgotten, not kept");
}

// ---- 4. Already the open tab: no click, so no redundant list fetch on every load ----
{
	const review = makeButton(ATTRIBUTE.editorPanel, "review", { active: true });
	run({ buttons: [review], stored: { [KEY.editorPanel]: "review" } });
	assert.equal(review.clicks, 0, "the already-active tab must not be clicked again");
}

// ---- 4b. Nothing stored at all: the panel must behave exactly as before ----
{
	const locations = makeButton(ATTRIBUTE.wikiSync, "locations", { active: true });
	const paths = makeButton(ATTRIBUTE.wikiSync, "paths");
	run({ buttons: [locations, paths] });
	assert.equal(paths.clicks + locations.clicks, 0, "with an empty storage nothing may be clicked");
}

// ---- 5. An incoming deep link beats the remembered tab, and becomes the new "last here" ----
{
	const paths = makeButton(ATTRIBUTE.wikiSync, "paths");
	const materialien = makeButton(ATTRIBUTE.wikiSync, "adventures");
	const { storage } = run({
		buttons: [makeButton(ATTRIBUTE.wikiSync, "locations", { active: true }), paths, materialien],
		stored: { [KEY.wikiSync]: "adventures" },
		href: "https://avesmaps.de/?edit=1&wikiSyncTab=paths",
	});
	assert.equal(paths.clicks, 1, "the deep-link tab must win over the stored one");
	assert.equal(materialien.clicks, 0, "the stored tab must lose against the deep link");
	assert.equal(storage.get(KEY.wikiSync), "paths", "a deep link must become the new remembered tab");
}

// ---- 5b. A deep link naming a tab that does not exist falls back to the stored one ----
{
	const materialien = makeButton(ATTRIBUTE.wikiSync, "adventures");
	run({
		buttons: [makeButton(ATTRIBUTE.wikiSync, "locations", { active: true }), materialien],
		stored: { [KEY.wikiSync]: "adventures" },
		href: "https://avesmaps.de/?edit=1&wikiSyncTab=quatsch",
	});
	assert.equal(materialien.clicks, 1, "a bogus deep link must fall back to the stored tab");
}

// ---- 6. The address bar is never rewritten (owner policy, FINAL 2026-07-06) ----
// This is the guard rail: a future session that reads the missing ?reviewTab= as a bug and re-adds the
// history.replaceState call breaks a deliberate decision. It fails here first.
{
	const { replaceStateCalls, clickDocument } = run({
		buttons: [makeButton(ATTRIBUTE.wikiSync, "locations", { active: true }), makeButton(ATTRIBUTE.wikiSync, "paths")],
		stored: { [KEY.wikiSync]: "paths" },
		href: "https://avesmaps.de/?edit=1&wikiSyncTab=paths",
	});
	clickDocument(makeButton(ATTRIBUTE.wikiSync, "territories"));
	assert.equal(replaceStateCalls.length, 0, "the app must never rewrite the address bar (url-sharing-policy)");
	assert.equal(cascadeSource.includes("replaceState("), false, "history.replaceState must not return to the tab code");
}

// ---- 7. Restore order: level 1 before 2 before 3 ----
{
	const clickLog = [];
	run({
		buttons: [
			makeButton(ATTRIBUTE.material, "citymaps", { clickLog }),
			makeButton(ATTRIBUTE.wikiSync, "adventures", { clickLog }),
			makeButton(ATTRIBUTE.editorPanel, "wiki-sync", { clickLog }),
		],
		stored: {
			[KEY.editorPanel]: "wiki-sync",
			[KEY.wikiSync]: "adventures",
			[KEY.material]: "citymaps",
		},
	});
	assert.deepEqual(
		clickLog,
		["data-editor-panel-tab=wiki-sync", "data-wiki-sync-panel-tab=adventures", "data-material-subtab=citymaps"],
		"the cascade must be restored top-down, parent tab before child"
	);
}

// ---- 8. The write path -- the actual bug: clicking a tab must store it ----
// The old handler gated every value against ["locations","territories","regions","paths"] and returned
// before storing anything for "adventures". Every family must now be written, including the pill rows,
// which had no persistence at all.
{
	const cases = [
		[ATTRIBUTE.wikiSync, "adventures", KEY.wikiSync],
		[ATTRIBUTE.material, "citymaps", KEY.material],
		[ATTRIBUTE.editorPanel, "presence", KEY.editorPanel],
		[ATTRIBUTE.reviewSub, "mails", KEY.reviewSub],
		[ATTRIBUTE.mail, "gesendet", KEY.mail],
		["data-status-subtab", "besucher", KEY.status],
	];
	for (const [attribute, value, storageKey] of cases) {
		const { storage, clickDocument } = run({ buttons: [] });
		clickDocument(makeButton(attribute, value));
		assert.equal(storage.get(storageKey), value, `clicking ${attribute}="${value}" must store it under ${storageKey}`);
	}
}

// ---- 9. Read mode stores and restores nothing ----
{
	const paths = makeButton(ATTRIBUTE.wikiSync, "paths");
	const { storage, clickDocument } = run({
		buttons: [paths],
		stored: { [KEY.wikiSync]: "paths" },
		editMode: false,
	});
	assert.equal(paths.clicks, 0, "read mode must not restore editor tabs");
	assert.equal(typeof clickDocument, "function");
	assert.equal(storage.get(KEY.wikiSync), "paths", "read mode must leave the stored value untouched");
}

console.log("test-review-tab-cascade: all assertions passed");
