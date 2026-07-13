// Unit test (Node, no build) for buildSharePinLink in js/map-features/map-features-share-pin.js:
// the explicit share link built for the "Stelle markieren und teilen" context-menu action
// (js/routing/routing.js). The address bar is deliberately never rewritten (URL policy, Owner
// 2026-07-06), so THIS builder -- not window.location.href -- is what makes a freely marked spot
// shareable. Regression guard for the reported bug "Teilen liefert keinen URL-Parameter": the link
// must carry the documented ?pin=<lat,lng> deep-link that readSharePinFromUrl
// (map-features-layer-state.js) reads back on load.
//
// buildSharePinLink references three free names (window, SHARE_PIN_QUERY_PARAM,
// formatSharePinQueryValue); we inject them so the pure query-building logic runs under Node without
// a browser or Leaflet. URLSearchParams is a Node global.
//
// Run: node tools/paths/test-share-pin-link-builder.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const sharePinSource = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-share-pin.js"), "utf8");

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

// Factory that binds the three free names buildSharePinLink relies on, so each test can pick its own.
const makeBuildSharePinLink = (fakeWindow, paramName, formatFn) => new Function(
	"window", "SHARE_PIN_QUERY_PARAM", "formatSharePinQueryValue",
	`${extractFunction(sharePinSource, "buildSharePinLink")}; return buildSharePinLink;`
)(fakeWindow, paramName, formatFn);

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

check("builds an absolute ?pin=<lat,lng> link from origin + pathname", () => {
	const build = makeBuildSharePinLink(
		{ location: { origin: "https://avesmaps.de", pathname: "/" } },
		"pin",
		() => "341.094,321.938"
	);
	// The comma is percent-encoded (%2C) by URLSearchParams and decoded again by readSharePinFromUrl.
	assert.equal(build({ lat: 341.094, lng: 321.938 }), "https://avesmaps.de/?pin=341.094%2C321.938");
});

check("uses the injected SHARE_PIN_QUERY_PARAM name (never hardcoded)", () => {
	const build = makeBuildSharePinLink(
		{ location: { origin: "https://avesmaps.de", pathname: "/" } },
		"marker",
		() => "1,2"
	);
	assert.equal(build({}), "https://avesmaps.de/?marker=1%2C2");
});

check("preserves a non-root pathname", () => {
	const build = makeBuildSharePinLink(
		{ location: { origin: "https://x.de", pathname: "/karte/" } },
		"pin",
		() => "5,6"
	);
	assert.equal(build({}), "https://x.de/karte/?pin=5%2C6");
});

console.log(`${passed}/3 passed`);
