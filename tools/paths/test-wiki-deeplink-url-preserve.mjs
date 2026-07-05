// Unit test (Node, no build) for mergeWikiDeeplinkParams in
// js/map-features/map-features-layer-state.js: the planner URL sync rebuilds the
// query from UI state; this helper re-merges the 5 read-only wiki deep-link params
// (?siedlung/?staat/?region/?strasse/?fluss) from the CURRENT url so a deep link
// never visibly "jumps" to the toggle params.
//
// Also covers the deep-link focus suppression window (suppressPlannerUrlSyncForWikiDeeplink /
// isWikiDeeplinkUrlSyncSuppressed in js/app/wiki-deeplink.js): the deep-link focus itself must
// not trigger a syncPlannerStateToUrl write at all, so the opened URL stays byte-for-byte as
// opened (no visible jump to the toggle params). Run:
//     node tools/paths/test-wiki-deeplink-url-preserve.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const layerStateSource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-layer-state.js"), "utf8");
const wikiDeeplinkSource = readFileSync(path.join(repoRoot, "js", "app", "wiki-deeplink.js"), "utf8");

function extractFunction(source, name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

// Evaluate ONLY the pure helper; WIKI_DEEPLINK_PARAM_NAMES stays undefined here so the
// test also covers the typeof-fallback branch.
const mergeWikiDeeplinkParams = new Function(`${extractFunction(layerStateSource, "mergeWikiDeeplinkParams")}; return mergeWikiDeeplinkParams;`)();

// Sandbox for the suppression window: declares the module-local state variable, then the two
// pure functions extracted verbatim from wiki-deeplink.js. `Date` is injected as a parameter so
// the test can control "now" instead of depending on the real clock.
function makeSuppressionSandbox(nowFn) {
	const factory = new Function("Date", `
		let wikiDeeplinkUrlSyncSuppressedUntil = 0;
		${extractFunction(wikiDeeplinkSource, "suppressPlannerUrlSyncForWikiDeeplink")}
		${extractFunction(wikiDeeplinkSource, "isWikiDeeplinkUrlSyncSuppressed")}
		return { suppressPlannerUrlSyncForWikiDeeplink, isWikiDeeplinkUrlSyncSuppressed };
	`);
	return factory({ now: nowFn });
}

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

check("preserves ?strasse= from the current url", () => {
	const params = new URLSearchParams("togglePaths=1");
	mergeWikiDeeplinkParams(params, "?strasse=Reichsstra%C3%9Fe_1&togglePaths=1");
	assert.equal(params.get("strasse"), "Reichsstraße_1");
	assert.equal(params.get("togglePaths"), "1");
});

check("preserves all five params", () => {
	const params = new URLSearchParams();
	mergeWikiDeeplinkParams(params, "?siedlung=A&staat=B&region=C&strasse=D&fluss=E");
	assert.deepEqual(
		["siedlung", "staat", "region", "strasse", "fluss"].map((name) => params.get(name)),
		["A", "B", "C", "D", "E"]
	);
});

check("ignores empty values and unrelated params", () => {
	const params = new URLSearchParams("mapLayerMode=politisch");
	mergeWikiDeeplinkParams(params, "?strasse=&edit=1&s=XYZ");
	assert.equal(params.get("strasse"), null);
	assert.equal(params.get("edit"), null);
	assert.equal(params.get("s"), null);
	assert.equal(params.get("mapLayerMode"), "politisch");
});

check("no wiki param -> searchParams unchanged", () => {
	const params = new URLSearchParams("togglePaths=0");
	const result = mergeWikiDeeplinkParams(params, "?togglePaths=1&toggleMetropolen=1");
	assert.equal(result.toString(), "togglePaths=0");
});

check("returns the same URLSearchParams instance and tolerates garbage input", () => {
	const params = new URLSearchParams();
	assert.equal(mergeWikiDeeplinkParams(params, null), params);
	assert.equal(mergeWikiDeeplinkParams(params, undefined), params);
	assert.equal(params.toString(), "");
});

check("suppression is off initially", () => {
	const sandbox = makeSuppressionSandbox(() => 1000);
	assert.equal(sandbox.isWikiDeeplinkUrlSyncSuppressed(), false);
});

check("suppression is on right after a deep-link focus", () => {
	const sandbox = makeSuppressionSandbox(() => 1000);
	sandbox.suppressPlannerUrlSyncForWikiDeeplink();
	assert.equal(sandbox.isWikiDeeplinkUrlSyncSuppressed(), true);
});

check("suppression expires after the window", () => {
	let now = 1000;
	const sandbox = makeSuppressionSandbox(() => now);
	sandbox.suppressPlannerUrlSyncForWikiDeeplink();
	now = 4000;
	assert.equal(sandbox.isWikiDeeplinkUrlSyncSuppressed(), false);
});

console.log(`${passed}/8 passed`);
