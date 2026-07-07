// Unit test (Node, no build) for buildShareLinkPath in
// js/map-features/map-features-share-pin.js: the PURE query-string half of "Link teilen"
// (buildPlaceShareLink prepends window.location.origin + pathname, which needs a browser and
// is exercised manually / via the running app instead). buildShareLinkPath decides whether the
// "Link teilen" button on a location/label popup emits the DOCUMENTED wiki deep-link parameter
// (?siedlung/?staat/?region/?strasse/?fluss, js/app/wiki-deeplink.js) -- when the object has a
// stored wikiUrl containing a "/wiki/<Page>" segment AND a wikiParam was passed -- or falls back
// to the older ?place=<publicId> link (js/routing/routing.js applyPlaceFocusFromUrl).
//
// Run: node tools/paths/test-share-link-builder.mjs
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

const buildShareLinkPath = new Function(`${extractFunction(sharePinSource, "buildShareLinkPath")}; return buildShareLinkPath;`)();

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

check("wiki case: wikiUrl + wikiParam -> the deep-link param with the raw page segment", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/wiki/Havena", "siedlung");
	assert.equal(result, "siedlung=Havena");
});

check("wiki case preserves an already percent-encoded page segment verbatim", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/wiki/F%C3%BCrstentum_Kosch", "staat");
	assert.equal(result, "staat=F%C3%BCrstentum_Kosch");
});

check("strips a ?query suffix off the wiki page segment", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/wiki/Havena?action=edit", "siedlung");
	assert.equal(result, "siedlung=Havena");
});

check("strips a #hash suffix off the wiki page segment", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/wiki/Havena#Geschichte", "region");
	assert.equal(result, "region=Havena");
});

check("no wikiUrl -> falls back to ?place=<publicId>", () => {
	const result = buildShareLinkPath("abc-123", "", "siedlung");
	assert.equal(result, "place=abc-123");
});

check("wikiUrl present but no wikiParam -> falls back to ?place=<publicId> (backward compatibility)", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/wiki/Havena", "");
	assert.equal(result, "place=abc-123");
});

check("no options at all -> behaves exactly like the pre-existing ?place=<publicId> link", () => {
	const result = buildShareLinkPath("abc-123", undefined, undefined);
	assert.equal(result, "place=abc-123");
});

check("malformed wikiUrl (no /wiki/ segment) -> falls back to ?place=<publicId>", () => {
	const result = buildShareLinkPath("abc-123", "https://de.wiki-aventurica.de/Havena", "siedlung");
	assert.equal(result, "place=abc-123");
});

check("malformed wikiUrl (not a URL at all) -> falls back to ?place=<publicId>", () => {
	const result = buildShareLinkPath("abc-123", "not a url", "siedlung");
	assert.equal(result, "place=abc-123");
});

check("encodes the publicId in the ?place= fallback", () => {
	const result = buildShareLinkPath("uuid with spaces", "", "siedlung");
	assert.equal(result, "place=uuid%20with%20spaces");
});

console.log(`${passed}/10 passed`);
