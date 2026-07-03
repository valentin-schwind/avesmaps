// Unit test (Node, no build) for the Wave-2 WikiDump frontend case helpers in
// js/review/review-wiki-sync-cases.js:
//   - getWikiSyncCaseTypeOrder / getWikiSyncCaseTypeLabel: the 3 new dump case
//     types (coordinate_drift / field_divergence / coat_available) get proper
//     German labels and a sensible (non-999) order.
//   - readWikiSyncDriftLatLng: the payload {lat,lng} (0..1024 map units) ->
//     L.latLng(lat,lng) conversion WITHOUT the GeoJSON [x,y]->[y,x] swap (lat is y).
//   - wikiSyncDriftDistance: euclidean distance between the two positions.
//
// The file is a classic (non-module) browser script that references a global `L`
// (Leaflet) and other globals. We can't import it, so we read the source, provide
// a tiny `L.latLng` stub + no-op stubs for the globals the target functions do
// NOT actually call, and eval ONLY in this sandbox. Run:
//     node tools/wikidump/test-wikidump-frontend-cases.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "review", "review-wiki-sync-cases.js"), "utf8");

// Minimal Leaflet latLng stub: returns a plain {lat,lng} object, which is all the
// target functions consume (they read .lat/.lng). Matches Leaflet's L.latLng(lat,lng).
const L = {
	latLng(lat, lng) {
		return { lat: Number(lat), lng: Number(lng) };
	},
};

// Pull just the four pure functions we test out of the source by name, so we don't
// evaluate the whole file (which wires DOM/event globals). Each regex grabs the
// function declaration through its matching brace depth.
function extractFunction(name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in review-wiki-sync-cases.js`);
	}
	// Walk from the first "{" after the signature, tracking brace depth.
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
	throw new Error(`Could not find end of function ${name}`);
}

const bundle = [
	extractFunction("getWikiSyncCaseTypeOrder"),
	extractFunction("getWikiSyncCaseTypeLabel"),
	extractFunction("readWikiSyncDriftLatLng"),
	extractFunction("wikiSyncDriftDistance"),
].join("\n\n");

// eslint-disable-next-line no-new-func
const factory = new Function("L", `${bundle}\nreturn { getWikiSyncCaseTypeOrder, getWikiSyncCaseTypeLabel, readWikiSyncDriftLatLng, wikiSyncDriftDistance };`);
const fns = factory(L);

let failures = 0;
let count = 0;
function check(label, ok) {
	count++;
	if (ok) {
		console.log(`  ok   ${label}`);
	} else {
		failures++;
		console.log(`  FAIL ${label}`);
	}
}

console.log("-- order map: 3 new dump case types are ordered (not 999) --");
const order = fns.getWikiSyncCaseTypeOrder;
check("coordinate_drift has a real order", order("coordinate_drift") !== 999 && order("coordinate_drift") > 0);
check("field_divergence has a real order", order("field_divergence") !== 999);
check("coat_available has a real order", order("coat_available") !== 999);
// The intended cluster: right after probable_match(30), before unresolved_without_candidate(40).
check("coordinate_drift sits between probable_match and unresolved", order("probable_match") < order("coordinate_drift") && order("coordinate_drift") < order("unresolved_without_candidate"));
check("the 3 are strictly ordered drift<divergence<coat", order("coordinate_drift") < order("field_divergence") && order("field_divergence") < order("coat_available"));
check("an unknown type still falls back to 999", order("totally_unknown_xyz") === 999);
// Existing types unchanged.
check("canonical_name_difference still 10", order("canonical_name_difference") === 10);
check("missing_capital still 90", order("missing_capital") === 90);

console.log("\n-- label map: German labels for the 3 new types --");
const label = fns.getWikiSyncCaseTypeLabel;
check("coordinate_drift label matches backend", label("coordinate_drift") === "Position weicht vom Wiki ab");
check("field_divergence label matches backend", label("field_divergence") === "Weicht vom Wiki ab");
check("coat_available label matches backend", label("coat_available") === "Wappen im Wiki verfügbar");
check("no label is left equal to the raw type key", label("coordinate_drift") !== "coordinate_drift" && label("field_divergence") !== "field_divergence" && label("coat_available") !== "coat_available");
check("unknown type falls back to the raw key", label("totally_unknown_xyz") === "totally_unknown_xyz");

console.log("\n-- readWikiSyncDriftLatLng: {lat,lng} map units -> L.latLng(lat,lng), NO swap --");
const toLatLng = fns.readWikiSyncDriftLatLng;
const p = toLatLng({ lat: 250, lng: 300 });
check("lat passes straight through (vertical/y = lat)", p !== null && p.lat === 250);
check("lng passes straight through (horizontal/x = lng)", p !== null && p.lng === 300);
check("null input -> null", toLatLng(null) === null);
check("missing fields -> null", toLatLng({ lat: 5 }) === null);
check("non-finite -> null", toLatLng({ lat: "abc", lng: 3 }) === null);

console.log("\n-- wikiSyncDriftDistance: euclidean distance in map units --");
const dist = fns.wikiSyncDriftDistance;
// (100,100) -> (100,103) = 3; (0,0)->(3,4)=5 (3-4-5 triangle).
check("straight vertical distance = 3", dist(L.latLng(100, 100), L.latLng(103, 100)) === 3);
check("3-4-5 euclidean distance = 5", dist(L.latLng(0, 0), L.latLng(3, 4)) === 5);
check("missing position -> null", dist(null, L.latLng(1, 1)) === null);

console.log("");
if (failures === 0) {
	console.log(`PASS: ${count} assertions.`);
	process.exit(0);
} else {
	console.log(`FAIL: ${failures} of ${count} assertions failed.`);
	process.exit(1);
}
