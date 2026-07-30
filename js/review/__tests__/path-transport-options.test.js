const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// review-paths.js and its deps are browser globals (no module system), so the REAL sources are loaded
// into this realm -- the test exercises the shipped code, not a copy of the transport tables. Both
// files are declaration-only, the stubs just satisfy config.js's top-level window/document touches.
global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
// V9: index.html laedt dieses Modul VOR config.js -- dort werden samples/tension hineingespreizt.
loadBrowserScript("../../map-features/map-features-line-catmull.js");
loadBrowserScript("../../config.js");
loadBrowserScript("../../map-features/map-features-path-domain.js");
loadBrowserScript("../review-paths.js");

const desertPath = (properties) => ({ properties: { feature_subtype: "Wuestenpfad", ...properties } });

// The Wuestenpfad rule: the carriage is not offered at all, every other land transport is.
const desertOptions = getTransportOptionsForPathSubtype("Wuestenpfad");
assert.ok(!desertOptions.includes("horseCarriage"), "no carriage on a desert path");
assert.deepStrictEqual(desertOptions, ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"]);

// A desert path with no list recorded: everything but the carriage is pre-checked.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({})), desertOptions);

// The 26 rows a one-off admin repair left with an empty list and NO transport_domain: that shape was
// never saved by this form, so it is treated as "nothing recorded" -- the dialog offers the defaults
// again instead of showing an all-unchecked form that would save the path as impassable.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({ allowed_transports: [] })), desertOptions);

// A list the form DID save (it always writes the pair) stays authoritative, empty list included.
assert.deepStrictEqual(getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: [] })), []);
assert.deepStrictEqual(
	getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: ["caravan", "groupFoot"] })),
	["caravan", "groupFoot"]
);

// A stored carriage (from an older save) is still dropped for a desert path.
assert.deepStrictEqual(
	getPathAllowedTransports(desertPath({ transport_domain: "land", allowed_transports: ["caravan", "horseCarriage"] })),
	["caravan"]
);

// Rivers keep their own domain: the upper Raller allows nothing, the lower one only the barge.
const river = (properties) => ({ properties: { feature_subtype: "Flussweg", ...properties } });
assert.deepStrictEqual(getPathAllowedTransports(river({})), ["riverSailer", "riverBarge"]);
assert.deepStrictEqual(getPathAllowedTransports(river({ transport_domain: "river", allowed_transports: [] })), []);
assert.deepStrictEqual(getPathAllowedTransports(river({ transport_domain: "river", allowed_transports: ["riverBarge"] })), ["riverBarge"]);

// The Pfad rule (Owner, 2026-07-30): the carriage IS offered but NOT pre-selected. Unlike the
// Wuestenpfad -- where the checkbox is hidden outright -- a carriage does get through a handful of
// paths; nobody knows which yet, so the editors keep the ability to switch it back on. That is why
// "offered" and "pre-selected" have to be two lists instead of one.
const pfadOffered = getTransportOptionsForPathSubtype("Pfad");
const pfadDefault = getDefaultAllowedTransportsForPathSubtype("Pfad");
assert.ok(pfadOffered.includes("horseCarriage"), "a Pfad still OFFERS the carriage");
assert.deepStrictEqual(pfadDefault, ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"]);

// No other land type changes: the carriage stays pre-selected on every road and on the pass.
for (const subtype of ["Weg", "Strasse", "Reichsstrasse", "Gebirgspass"]) {
	assert.ok(
		getDefaultAllowedTransportsForPathSubtype(subtype).includes("horseCarriage"),
		`${subtype} keeps the carriage pre-selected`
	);
}
// The Wuestenpfad never offered it, so there both lists agree.
assert.deepStrictEqual(getDefaultAllowedTransportsForPathSubtype("Wuestenpfad"), desertOptions);

// A Pfad with nothing recorded -- 645 live rows are in that state -- must not admit the carriage.
const pfad = (properties) => ({ properties: { feature_subtype: "Pfad", ...properties } });
assert.deepStrictEqual(getPathAllowedTransports(pfad({})), pfadDefault);

// A list the editor DID save stays authoritative, carriage included. This is the whole point of
// keeping the checkbox: it is how the few carriage-capable paths get recorded.
assert.deepStrictEqual(
	getPathAllowedTransports(pfad({ transport_domain: "land", allowed_transports: ["groupFoot", "horseCarriage"] })),
	["groupFoot", "horseCarriage"]
);

// resolvePathAllowedTransports is the one place the stored-list-beats-default rule is written down
// on the client, shared by the dialog (getPathAllowedTransports) and the router.
assert.deepStrictEqual(resolvePathAllowedTransports({ feature_subtype: "Pfad" }), pfadDefault);
assert.deepStrictEqual(resolvePathAllowedTransports({ feature_subtype: "Pfad", allowed_transports: [] }), pfadDefault);
assert.deepStrictEqual(resolvePathAllowedTransports({ feature_subtype: "Pfad", transport_domain: "land", allowed_transports: [] }), []);

// isTransportAllowedForPath is what the client route graph asks per path (route-graph-routing.js).
// It has to answer with exactly the rule the dialog shows, or the planner drives ways the editor
// says are barred.
const allowed = (properties, option) => isTransportAllowedForPath(properties, option);
assert.strictEqual(allowed({ feature_subtype: "Pfad" }, "horseCarriage"), false, "carriage barred from a Pfad with nothing recorded");
assert.strictEqual(allowed({ feature_subtype: "Pfad" }, "groupFoot"), true, "the other land transports keep the Pfad");
assert.strictEqual(allowed({ feature_subtype: "Weg" }, "horseCarriage"), true, "a Weg is untouched");
assert.strictEqual(
	allowed({ feature_subtype: "Pfad", transport_domain: "land", allowed_transports: ["horseCarriage"] }, "horseCarriage"),
	true,
	"a carriage an editor recorded on a Pfad is honoured"
);

// The Wuestenpfad ban outranks a stored list -- it must survive the merge into the shared rule.
assert.strictEqual(
	allowed({ feature_subtype: "Wuestenpfad", transport_domain: "land", allowed_transports: ["horseCarriage"] }, "horseCarriage"),
	false,
	"the desert ban still overrides a stored carriage"
);
assert.strictEqual(
	allowed({ feature_subtype: "Flussweg", transport_domain: "river", allowed_transports: [] }, "riverSailer"),
	false,
	"an impassable river stays impassable"
);
assert.strictEqual(allowed({ feature_subtype: "Pfad" }, ""), false, "no transport option -> nothing is allowed");

// syncPathTransportOptions is the function the dialog actually runs, and the only place where the
// two lists meet: hidden/disabled come from what the way type OFFERS, checked from what it
// PRE-SELECTS. One list cannot express "offered but unticked", so a regression lands exactly here.
// Minimal fake DOM (the harness has no browser), real function.
const ALL_TRANSPORT_CHECKBOXES = [
	"caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider",
	"riverSailer", "riverBarge", "cargoShip", "fastShip", "galley",
];
const renderTransportForm = (subtype, path) => {
	const inputs = ALL_TRANSPORT_CHECKBOXES.map((value) => {
		const label = { hidden: false };
		return { value, checked: false, disabled: false, label, closest: () => label };
	});
	document.getElementById = () => ({ value: subtype });
	document.querySelectorAll = () => inputs;
	syncPathTransportOptions({ path });
	return inputs;
};
const stateOf = (inputs, value) => {
	const input = inputs.find((candidate) => candidate.value === value);
	return { offered: !input.label.hidden && !input.disabled, checked: input.checked };
};

// A freshly opened Pfad: the carriage is ON the form and left untouched -- that is the order.
assert.deepStrictEqual(stateOf(renderTransportForm("Pfad", null), "horseCarriage"), { offered: true, checked: false });
assert.deepStrictEqual(stateOf(renderTransportForm("Pfad", null), "groupFoot"), { offered: true, checked: true });

// A Wuestenpfad hides it instead. The two rules must not collapse back into one.
assert.deepStrictEqual(stateOf(renderTransportForm("Wuestenpfad", null), "horseCarriage"), { offered: false, checked: false });

// Every other land type keeps it ticked.
for (const subtype of ["Weg", "Strasse", "Reichsstrasse", "Gebirgspass"]) {
	assert.deepStrictEqual(
		stateOf(renderTransportForm(subtype, null), "horseCarriage"),
		{ offered: true, checked: true },
		`${subtype} still opens with the carriage ticked`
	);
}

// Reopening a Pfad an editor DID grant the carriage shows it ticked again.
const grantedPfad = { properties: { feature_subtype: "Pfad", transport_domain: "land", allowed_transports: ["groupFoot", "horseCarriage"] } };
assert.deepStrictEqual(stateOf(renderTransportForm("Pfad", grantedPfad), "horseCarriage"), { offered: true, checked: true });

// A river way offers only its own two boats, whatever the land rules say.
assert.deepStrictEqual(stateOf(renderTransportForm("Flussweg", null), "horseCarriage"), { offered: false, checked: false });
assert.deepStrictEqual(stateOf(renderTransportForm("Flussweg", null), "riverBarge"), { offered: true, checked: true });

console.log("path transport option tests passed");
