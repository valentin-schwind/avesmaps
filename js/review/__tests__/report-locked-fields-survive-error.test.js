const assert = require("assert");

// review-pending.js is a plain browser script. It touches no globals at load time, but
// setFormFieldsDisabled tests `instanceof HTMLElement`, so stand one in.
class FakeElement {
	constructor(name, { disabled = false } = {}) {
		this.name = name;
		this.disabled = disabled;
		this.dataset = {};
	}
}
global.HTMLElement = FakeElement;

const { setFormFieldsDisabled, setFieldContextLocked } = require("../review-pending.js");

function fakeForm(elements) {
	return {
		elements,
		classList: { toggle() {} },
	};
}

// ===== THE RULE UNDER TEST =====
// "Disabled" means two different things in these forms, and only one of them ends when the submit ends:
//   (a) busy -- the submit is in flight; every field goes dark and comes back.
//   (b) context-locked -- the field belongs to the thing being reported and must not be edited at all.
// Releasing (a) used to release (b) with it, because the release loop simply wrote `disabled = false`
// onto every element. That mattered the moment a submit could FAIL with the dialog left open: the
// category of a change suggestion (locked by applyChangeSuggestionContext, because the report already
// names a concrete element through entity_type/entity_public_id) came back live, and the reporter could
// resubmit a path change filed as a settlement. The server stores report_type and entity_type
// independently, so the review dispatch then routes the report to the wrong editor.

const categorySelect = new FakeElement("report_type");
const nameInput = new FakeElement("name");
const commentField = new FakeElement("comment");
const form = fakeForm([categorySelect, nameInput, commentField]);

// The category is locked because of WHAT is being reported, not because a submit is running.
setFieldContextLocked(categorySelect, true);
assert.strictEqual(categorySelect.disabled, true, "a context lock disables the field");
assert.strictEqual(categorySelect.dataset.lockReason, "context", "and marks WHY it is disabled");

// Submit starts: everything goes dark, including the already-locked field.
setFormFieldsDisabled(form, true);
assert.strictEqual(nameInput.disabled, true, "an ordinary field is disabled while the submit runs");
assert.strictEqual(categorySelect.disabled, true, "the locked field stays disabled too");

// Submit FAILS -- e.g. the server answers 400 for an explanation made of nothing but a link, or 429 at
// the hourly limit. The dialog stays open so the reporter can fix the text.
setFormFieldsDisabled(form, false);
assert.strictEqual(nameInput.disabled, false, "the reporter can edit again after a failed submit");
assert.strictEqual(commentField.disabled, false, "including the field they were asked to fix");
assert.strictEqual(
	categorySelect.disabled,
	true,
	"the context lock SURVIVES the failed submit -- otherwise the category of a change suggestion "
		+ "comes back live and can be sent contradicting entity_type"
);

// Clearing the mode is the only thing that releases it, and it releases the marker too.
setFieldContextLocked(categorySelect, false);
assert.strictEqual(categorySelect.disabled, false, "clearing the context unlocks the field");
assert.strictEqual(
	Object.prototype.hasOwnProperty.call(categorySelect.dataset, "lockReason"),
	false,
	"and removes the marker, so the next submit treats it as an ordinary field"
);

// A field that was never context-locked must not acquire the marker by accident.
setFormFieldsDisabled(form, true);
setFormFieldsDisabled(form, false);
assert.strictEqual(nameInput.disabled, false, "an unmarked field cycles normally");
assert.strictEqual(
	Object.prototype.hasOwnProperty.call(nameInput.dataset, "lockReason"),
	false,
	"the busy cycle never marks a field"
);

console.log("report-locked-fields-survive-error ok");
