// Unit test (Node, no build) for getPathTitleName / getUnnamedPathTitle in
// js/map-features/map-features-path-domain.js -- the title a way shows in its infobox and as a route leg
// (Owner 2026-07-17).
//
// shouldShowRoutePathDisplayName is pulled in for REAL from js/routing/route-node.js: it IS the "is this a
// real name?" test, and the whole point is that both surfaces now share it.
//
// Run: node tools/paths/test-path-title.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");

function extractFunction(source, name) {
	const start = source.indexOf(`function ${name}(`);
	if (start === -1) throw new Error(`function ${name} not found`);
	let i = source.indexOf("{", start);
	let depth = 0;
	for (; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces in ${name}`);
}
function extractConst(source, name) {
	const start = source.indexOf(`const ${name} = {`);
	if (start === -1) throw new Error(`const ${name} not found`);
	return source.slice(start, source.indexOf("};", start) + 2);
}

const domainSource = read("js", "map-features", "map-features-path-domain.js");
const nodeSource = read("js", "routing", "route-node.js");

const sandbox = {
	tr: (key, fallback) => fallback,
	normalizePathSubtype: (v) => v,
	SYNTHETIC_ROUTE_TYPE: "Querfeldein",
};
vm.createContext(sandbox);
vm.runInContext(extractFunction(nodeSource, "getRoutePathDisplayName"), sandbox);
vm.runInContext(extractFunction(nodeSource, "escapeRouteDisplayRegex"), sandbox);
vm.runInContext(extractFunction(nodeSource, "shouldShowRoutePathDisplayName"), sandbox);
vm.runInContext(extractConst(domainSource, "UNNAMED_PATH_TITLE"), sandbox);
vm.runInContext(extractFunction(domainSource, "getPathTitleName"), sandbox);
vm.runInContext(extractFunction(domainSource, "getUnnamedPathTitle"), sandbox);

const way = (props) => ({ properties: { feature_subtype: "Strasse", ...props } });

// --- getPathTitleName: the wiki name is the identity ------------------------------------------------------

// THE bug this fixes: 12 legacy segments violate R1 (assigned but kept a stale name). The spotlight has
// always shown the wiki name, the infobox showed display_name -- so search said "Reichsstraße 2" and the
// box said "Reichsstrasse-16". Going through the wiki name heals the display without touching data.
assert.strictEqual(
	sandbox.getPathTitleName(way({ display_name: "Reichsstrasse-16", wiki_path: { name: "Reichsstraße 2" } })),
	"Reichsstraße 2",
	"the wiki name wins over a stale generic display_name"
);
assert.strictEqual(
	sandbox.getPathTitleName(way({ display_name: "Reichsstrasse 2", wiki_path: { name: "Reichsstraße 2" } })),
	"Reichsstraße 2",
	"the wiki name also wins over an ss/ß spelling variant"
);

// No wiki: a real display_name still counts.
assert.strictEqual(sandbox.getPathTitleName(way({ display_name: "Knüppeldamm" })), "Knüppeldamm", "a real name survives without a wiki");

// No wiki + a generic name -> "" so the caller substitutes the unnamed title. All three junk shapes:
assert.strictEqual(sandbox.getPathTitleName(way({ display_name: "Strasse-916" })), "", "<subtype>-<n> is not a name");
assert.strictEqual(sandbox.getPathTitleName(way({ display_name: "Meer-835", feature_subtype: "Seeweg" })), "", "<word>-<n> is not a name either");
assert.strictEqual(sandbox.getPathTitleName(way({ display_name: "Strasse" })), "", "the bare subtype is not a name");
assert.strictEqual(sandbox.getPathTitleName(way({ display_name: "" })), "", "no name is no name");

// --- getUnnamedPathTitle: German inflects, so no string concatenation -------------------------------------

assert.strictEqual(sandbox.getUnnamedPathTitle("Strasse"), "Unbenannte Straße", "feminine: die Straße");
assert.strictEqual(sandbox.getUnnamedPathTitle("Reichsstrasse"), "Unbenannte Reichsstraße", "feminine: die Reichsstraße");
assert.strictEqual(sandbox.getUnnamedPathTitle("Pfad"), "Unbenannter Pfad", "masculine: der Pfad");
assert.strictEqual(sandbox.getUnnamedPathTitle("Weg"), "Unbenannter Weg", "masculine: der Weg");
assert.strictEqual(sandbox.getUnnamedPathTitle("Gebirgspass"), "Unbenannter Gebirgspass", "masculine: der Gebirgspass");
assert.strictEqual(sandbox.getUnnamedPathTitle("Wuestenpfad"), "Unbenannter Wüstenpfad", "masculine: der Wüstenpfad");
assert.strictEqual(sandbox.getUnnamedPathTitle("Flussweg"), "Unbenannter Flussweg", "masculine: der Flussweg");
// The proper ß is used throughout -- our subtype KEYS carry "ss", the user-facing strings must not.
// Read through the context, not off the sandbox: a top-level `const` lives in the script's LEXICAL scope and
// never becomes a property of the global object -- same as a browser <script> tag, which is why the functions
// above can see it while `sandbox.UNNAMED_PATH_TITLE` is undefined.
const titles = vm.runInContext("UNNAMED_PATH_TITLE", sandbox);
assert.ok(!Object.values(titles).some((v) => /strasse/i.test(v)), "no key spelling leaks into a visible string");
assert.ok(Object.values(titles).every((v) => /^Unbenannte[r]? /.test(v)), "every entry is a proper inflected phrase");

// Sea routes are exempt on purpose: open water carries no names, "unnamed" would imply a gap.
assert.strictEqual(sandbox.getUnnamedPathTitle("Seeweg"), "Seeweg", "a sea route falls back to the bare type");
// Anything unknown falls back too rather than inventing grammar.
assert.strictEqual(sandbox.getUnnamedPathTitle("Querfeldein"), "Querfeldein", "unknown types fall back to the bare type");

console.log("path-title tests passed");
