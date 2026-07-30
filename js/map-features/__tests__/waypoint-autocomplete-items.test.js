// The shape of the waypoint autocomplete's items -- and why it may never be mixed.
//
// 💣 jQuery UI normalises the item list by looking at the FIRST ENTRY ONLY:
//
//     _normalize: t.length && t[0].label && t[0].value ? t : $.map(t, …to {label, value}…)
//
// So one `{label, value}` object at position 0 makes it hand the WHOLE list through untouched. Plain
// string entries then never get a `label`, `_renderItem` calls .text(undefined) -- which jQuery treats
// as a getter -- and the <li> stays empty. jQuery UI's menu then reads empty text as a separator:
//
//     _isDivider: t => !/[^\-—–\s]/.test(t.text())      // "" passes -> divider
//
// The owner saw it on 2026-07-30 as „ganz viele striche" in the waypoint search: typing „gre" put the
// in-settlement object „Greifax-Palast (Xorlosch)" first, and Greifenau, Greifenberg, Greifenfurt,
// Greifenhorst … all turned into horizontal lines.
//
// Run from the repo root:  node js/map-features/__tests__/waypoint-autocomplete-items.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...parts), "utf8");

function extractFunction(source, name, file) {
	const start = source.search(new RegExp(`^(?:function |const )${name}\\b`, "m"));
	assert.notStrictEqual(start, -1, `${name} not found in ${file}`);
	const signature = source.slice(start, source.indexOf("\n", start));
	let depth = 0;
	for (let i = start + signature.lastIndexOf("{"); i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && (depth -= 1) === 0) {
			const end = source.indexOf("\n", i);
			return source.slice(start, end === -1 ? i + 1 : end);
		}
	}
	throw new Error(`unbalanced braces in ${name} (${file})`);
}

const waypointSource = read("js", "map-features", "map-features-waypoints.js");
const routingSource = read("js", "routing", "routing.js");
const lookupSource = read("js", "map-features", "map-features-location-lookup.js");

// The real name normaliser and the real crossing test: with stubs this file would prove nothing about
// which entries actually reach the menu.
const load = (locations, inSettlementPlaces) => new Function(
	"locationData",
	"windowStub",
	[
		"const window = windowStub;",
		"const WAYPOINT_AUTOCOMPLETE_MAX_RESULTS = 20;",
		"const WAYPOINT_AUTOCOMPLETE_MIN_LENGTH = 2;",
		"let waypointAutocompleteSourceCache = null;",
		"let waypointAutocompleteSourceCacheLength = 0;",
		extractFunction(routingSource, "normalizeLocationSearchName", "routing.js"),
		extractFunction(lookupSource, "isCrossingName", "map-features-location-lookup.js"),
		extractFunction(waypointSource, "getInSettlementWaypointEntries", "map-features-waypoints.js"),
		extractFunction(waypointSource, "getWaypointAutocompleteEntries", "map-features-waypoints.js"),
		extractFunction(waypointSource, "getWaypointAutocompleteScore", "map-features-waypoints.js"),
		extractFunction(waypointSource, "getWaypointAutocompleteSource", "map-features-waypoints.js"),
		"return getWaypointAutocompleteSource;",
	].join("\n")
)(locations, { avesmapsInSettlementPlaces: inSettlementPlaces });

// The owner's case, with the real names from the live payload (2026-07-30).
const LOCATIONS = ["Greifenau", "Greifenberg", "Greifenfurt", "Greifenhorst (Albernia)", "Greifenzinne"]
	.map((name) => ({ name }));
const IN_SETTLEMENT = [
	{ name: "Greifax-Palast", settlement: "Xorlosch" },
	{ name: "Greifenplatz (Elenvina)", settlement: "Elenvina" },
];

const getSource = load(LOCATIONS, IN_SETTLEMENT);
const items = getSource("gre");

// The list is not empty, or the rest proves nothing.
assert.ok(items.length >= 6, `expected the whole "gre" set, got ${items.length}`);

// EVERY item is a {label, value} pair. No plain strings -- not even one, and least of all mixed in
// behind an object, which is the exact shape that broke it.
items.forEach((item, index) => {
	assert.strictEqual(typeof item, "object", `item ${index} is a ${typeof item}, not a {label, value} pair`);
	assert.strictEqual(typeof item.label, "string", `item ${index} has no label: ${JSON.stringify(item)}`);
	assert.strictEqual(typeof item.value, "string", `item ${index} has no value: ${JSON.stringify(item)}`);
	assert.ok(item.label.trim() !== "", `item ${index} has an empty label: ${JSON.stringify(item)}`);
});

// jQuery UI's own two rules, applied to what we hand it.
{
	const normalized = items.length && items[0].label && items[0].value
		? items
		: items.map((item) => (typeof item === "string" ? { label: item, value: item } : item));
	assert.strictEqual(normalized, items, "_normalize must be able to pass our list through unchanged");

	const isDivider = (text) => !/[^\-—–\s]/.test(String(text ?? ""));
	const dividers = normalized.filter((item) => isDivider(item.label));
	assert.deepStrictEqual(dividers, [], `these would render as separator lines: ${JSON.stringify(dividers)}`);
}

// A plain place keeps its own name on both sides; an in-settlement object shows both and commits the town.
{
	const plain = items.find((item) => item.label === "Greifenfurt");
	assert.ok(plain, `the plain place is missing: ${JSON.stringify(items)}`);
	assert.strictEqual(plain.value, "Greifenfurt", "a plain place commits its own name");

	const inSettlement = items.find((item) => item.label.startsWith("Greifax-Palast"));
	assert.strictEqual(inSettlement.label, "Greifax-Palast (Xorlosch)", "the object names its town in brackets");
	assert.strictEqual(inSettlement.value, "Xorlosch", "picking it commits the TOWN, which is the routable place");
}

// And the case that made it visible: an object sorted to position 0 with plain places behind it.
{
	assert.ok(
		typeof items[0] === "object" && typeof items[0].label === "string",
		`the first item decides jQuery UI's normalisation: ${JSON.stringify(items[0])}`
	);
}

console.log("waypoint-autocomplete-items.test.js: all assertions passed");
