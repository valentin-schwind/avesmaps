const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
// The shared classifier lives with the other location type/naming helpers.
loadBrowserScript("../map-features-location-lookup.js");

// --- Discord #48: a crossing that runs through the UPDATE path ------------------------------
// What the live poll (routing.js, since_revision) really delivers for a crossing another editor
// just created: feature_type 'junction' + feature_subtype 'crossing' + name 'Kreuzung'
// (api/_internal/map/features.php, avesmapsCreateCrossingFeature).
const liveJunctionFeature = {
	type: "Feature",
	id: "junction-1",
	geometry: { type: "Point", coordinates: [100, 200] },
	properties: {
		public_id: "junction-1",
		name: "Kreuzung",
		feature_type: "junction",
		feature_subtype: "crossing",
		revision: 34739,
	},
};
// The flat payload applyLiveLocationFeature() derives from it before handing it to
// applyFeatureResponseToMarker() -- only the subtype survives that hop.
const liveUpdatePayload = {
	public_id: "junction-1",
	name: "Kreuzung",
	feature_subtype: "crossing",
	lat: 200,
	lng: 100,
};
// ... and the marker the other editor already has on the map for it.
const existingCrossingMarkerEntry = { publicId: "junction-1", name: "Kreuzung-7", locationType: CROSSING_LOCATION_TYPE };

// The trap itself: 'crossing' is not a settlement key, so the whitelist in normalizeLocationType()
// answered "dorf" -- silently, which is why the update path could turn a crossing into a village.
assert.ok(!LOCATION_TYPE_KEYS.includes(CROSSING_LOCATION_TYPE), "the settlement whitelist must not contain the crossing type");

assert.strictEqual(
	resolveLocationTypeFromFeature(liveUpdatePayload, existingCrossingMarkerEntry),
	CROSSING_LOCATION_TYPE,
	"#48: a crossing arriving on the update path must stay a crossing"
);
assert.strictEqual(
	resolveLocationTypeFromFeature(liveJunctionFeature),
	CROSSING_LOCATION_TYPE,
	"#48: the polled GeoJSON feature must be classified from feature_type/feature_subtype"
);

// The name is the LAST resort, so a crossing is recognised even when it carries none.
assert.strictEqual(
	resolveLocationTypeFromFeature({ feature_subtype: "crossing", name: "" }),
	CROSSING_LOCATION_TYPE,
	"the subtype alone must be enough"
);
// avesmapsBuildPointFeatureResponse() hardcodes feature_type 'location' for every point, so an edit
// response calls a fresh crossing a location and labels it 'Dorf'. Only the subtype stays honest.
assert.strictEqual(
	resolveLocationTypeFromFeature({ feature_type: "location", feature_subtype: "crossing", location_type: "crossing", location_type_label: "Dorf", name: "Kreuzung" }),
	CROSSING_LOCATION_TYPE,
	"the edit-response shape (feature_type 'location') must not outvote the crossing subtype"
);
// 798 live rows still carry the older feature_type 'crossing' next to 1118 'junction' rows.
assert.strictEqual(
	resolveLocationTypeFromFeature({ properties: { feature_type: "crossing", feature_subtype: "crossing", name: "Kreuzung-41" } }),
	CROSSING_LOCATION_TYPE,
	"the legacy feature_type 'crossing' must be classified too"
);

// --- Settlements ----------------------------------------------------------------------------
assert.strictEqual(resolveLocationTypeFromFeature({ properties: { feature_type: "location", feature_subtype: "metropole", name: "Gareth" } }), "metropole");
assert.strictEqual(resolveLocationTypeFromFeature({ properties: { settlement_class: "gebaeude", name: "Turm" } }), "gebaeude");
assert.strictEqual(resolveLocationTypeFromFeature({ location_type: "kleinstadt", feature_subtype: "kleinstadt", name: "Ort-3" }), "kleinstadt");
// An already normalised location object (the shape isCrossingLocation is called with).
assert.strictEqual(resolveLocationTypeFromFeature({ locationType: "stadt", name: "Punin" }), "stadt");

// --- The legacy name fallback ------------------------------------------------------------------
// ~200 live rows are named "Kreuzung-auto-<n>", which the stricter isCrossingName() does NOT match;
// they must still classify as crossings when nothing else says so.
assert.strictEqual(resolveLocationTypeFromFeature({ name: "Kreuzung-auto-57" }), CROSSING_LOCATION_TYPE, "legacy auto-named crossings must fall back to the name");
assert.strictEqual(resolveLocationTypeFromFeature({ name: "Kreuzung-12" }), CROSSING_LOCATION_TYPE);
// But the name must NEVER outvote the server: four live powerlines are named "Kreuzung - <place>",
// and a settlement's name is editable data.
assert.strictEqual(
	resolveLocationTypeFromFeature({ feature_type: "location", feature_subtype: "dorf", name: "Kreuzung am Fluss" }),
	"dorf",
	"a known settlement subtype must outvote the name prefix"
);

// --- Unknown stays unknown ---------------------------------------------------------------------
// The classifier says "I don't know" instead of guessing; every caller keeps its own fallback.
assert.strictEqual(resolveLocationTypeFromFeature({ feature_type: "label", feature_subtype: "wald", name: "Reichsforst" }), "");
assert.strictEqual(resolveLocationTypeFromFeature({}), "");
assert.strictEqual(resolveLocationTypeFromFeature(null, undefined), "");
// First source that has an answer wins -- the incoming feature before the marker it updates.
assert.strictEqual(
	resolveLocationTypeFromFeature({ feature_subtype: "stadt", name: "Ort-9" }, existingCrossingMarkerEntry),
	"stadt",
	"a real conversion (crossing -> settlement) must still go through"
);
assert.strictEqual(
	resolveLocationTypeFromFeature({ description: "no type at all" }, existingCrossingMarkerEntry),
	CROSSING_LOCATION_TYPE,
	"a typeless update must keep what the marker already is"
);

// --- The silent "dorf" fallback is gone ---------------------------------------------------------
assert.strictEqual(isKnownLocationTypeKey("dorf"), true);
assert.strictEqual(isKnownLocationTypeKey(CROSSING_LOCATION_TYPE), false);
assert.strictEqual(isKnownLocationTypeKey(""), false);
assert.strictEqual(isKnownLocationTypeKey(undefined), false);

const warnings = [];
const originalWarn = console.warn;
console.warn = (message) => warnings.push(String(message));
try {
	assert.strictEqual(reportUnknownLocationType("kraftlinienknoten", "unit-test"), true, "an unknown type must be reported, not swallowed");
	assert.strictEqual(reportUnknownLocationType("kraftlinienknoten", "unit-test"), false, "the same unknown type must be reported only once");
	assert.strictEqual(reportUnknownLocationType("", "unit-test"), false, "an empty type is a missing value, not an unknown one");
	assert.strictEqual(reportUnknownLocationType(null, "unit-test"), false);
} finally {
	console.warn = originalWarn;
}
assert.strictEqual(warnings.length, 1, "exactly one console warning for one unknown type");
assert.ok(warnings[0].includes("kraftlinienknoten"), "the warning must name the type it could not map");

// --- isCrossingLocation now answers from the same rule ------------------------------------------
assert.strictEqual(isCrossingLocation({ locationType: CROSSING_LOCATION_TYPE, name: "Kreuzung-7" }), true);
assert.strictEqual(isCrossingLocation({ locationType: CROSSING_LOCATION_TYPE, name: "" }), true);
assert.strictEqual(isCrossingLocation({ name: "Kreuzung-auto-3" }), true);
assert.strictEqual(isCrossingLocation({ locationType: "dorf", name: "Angbar" }), false);
assert.strictEqual(isCrossingLocation(null), false);
assert.strictEqual(isNodixLocation({ locationType: CROSSING_LOCATION_TYPE, name: "Kreuzung" }), true, "a crossing stays a nodix node for the route graph");

console.log("location type classifier tests passed");
