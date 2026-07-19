const assert = require("assert");

// review-locations.js is a plain browser script that index.html loads: at load time it registers two
// delegated listeners and its source-row readers reach for elements by id. Node has neither, so install
// the smallest stand-in that lets the module load. Nothing in this test depends on either.
global.document = { addEventListener() {}, getElementById() { return null; } };

// ===== THE RULE UNDER TEST =====
// In a browser, `new FormData(form)` runs the HTML "constructing the entry list" algorithm, and that
// algorithm SKIPS every disabled control: a disabled <select> contributes NO entry at all -- not an empty
// string, no entry, so `.get()` answers null and every `|| default` fallback behind it fires. Node's own
// FormData cannot be constructed from a form element, so this stub stands in for exactly that one rule.
global.FormData = class FakeFormData {
	constructor(form) {
		this.byName = new Map();
		(form.controls || []).forEach((control) => {
			if (control.disabled) {
				return; // <- the entire bug, in one line
			}
			this.byName.set(control.name, control.value);
		});
	}
	get(name) {
		return this.byName.has(name) ? this.byName.get(name) : null;
	}
};

const { buildLocationReportRequestPayload } = require("../review-locations.js");

function fakeForm(controls) {
	const elements = {};
	controls.forEach((control) => { elements[control.name] = control; });
	return { controls, elements }; // .elements holds disabled controls too -- like a real HTMLFormElement
}

// ---- "Änderung vorschlagen" on a PATH ---------------------------------------------------------------
// applyChangeSuggestionContext preselects the category and disables the select to lock it;
// syncLocationReportTypeFields disables the size select because a path has no settlement size.
// Both controls vanish from the entry list, so the payload has to read the CONTROLS.
const pathChangeForm = fakeForm([
	{ name: "report_type", value: "weg", disabled: true },
	{ name: "size", value: "dorf", disabled: true },
	{ name: "name", value: "Uhdenberger Weg", disabled: false },
	{ name: "comment", value: "Bitte umdrehen, ich kann keinen Kopfstand.", disabled: false },
	{ name: "report_mode", value: "change", disabled: false },
	{ name: "entity_type", value: "path", disabled: false },
	{ name: "entity_public_id", value: "path-4711", disabled: false },
	{ name: "lat", value: "713.906", disabled: false },
	{ name: "lng", value: "584.875", disabled: false },
]);
const pathPayload = buildLocationReportRequestPayload(pathChangeForm);
// Before the fix this was "location" -- the `|| "location"` fallback -- and the server answered
// "Die Ortsgroesse ist ungueltig." (api/app/report-location.php), because a location report needs a
// size the form deliberately never showed. Every change suggestion on a path/river/region/territory
// was unsendable; only settlements worked, and only because "location" happened to be right for them.
assert.strictEqual(pathPayload.report_type, "weg", "the locked category must survive being disabled");
assert.strictEqual(pathPayload.report_mode, "change");
assert.strictEqual(pathPayload.entity_type, "path");
assert.strictEqual(pathPayload.entity_public_id, "path-4711");
assert.strictEqual(pathPayload.name, "Uhdenberger Weg");

// ---- The same dialog on a SETTLEMENT (the case that always worked) ----------------------------------
// Here the size select stays enabled, so it travels through the entry list as before.
const settlementChangeForm = fakeForm([
	{ name: "report_type", value: "location", disabled: true },
	{ name: "size", value: "stadt", disabled: false },
	{ name: "name", value: "Ferdok", disabled: false },
]);
const settlementPayload = buildLocationReportRequestPayload(settlementChangeForm);
assert.strictEqual(settlementPayload.report_type, "location");
assert.strictEqual(settlementPayload.size, "stadt", "an enabled size still comes from the entry list");

// ---- Plain "Hier melden …" (nothing locked) stays exactly as it was ---------------------------------
const newReportForm = fakeForm([
	{ name: "report_type", value: "region", disabled: false },
	{ name: "size", value: "dorf", disabled: true }, // hidden for non-settlements, as always
	{ name: "name", value: "Neue Region", disabled: false },
]);
const newPayload = buildLocationReportRequestPayload(newReportForm);
assert.strictEqual(newPayload.report_type, "region");
assert.strictEqual(newPayload.size, "", "a disabled size stays empty -- the server ignores it for non-locations");

// ---- No category at all still falls back to the historical default ----------------------------------
assert.strictEqual(buildLocationReportRequestPayload(fakeForm([])).report_type, "location");

console.log("OK - locked (disabled) category reaches the payload; enabled/absent fields unchanged");
