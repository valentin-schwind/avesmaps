// Shared filter bar: ONE builder, driven by a descriptor list.
//
// Three surfaces now render a filter bar -- the flat adventure dialog, the nested adventure tree dialog
// (both Spec §2.2) and the Kartensammlung dialog (§3.7). Their DIMENSIONS have nothing in common
// (Art/DSA-Version/Schwierigkeit/Genre vs. Typ/Art/Quelle/farbig/mehrstöckig/…), but their GRAMMAR is
// identical: a label, a group of multi-select chips, rules, single-select dropdowns, a BF year range and
// toggle chips. Task B already collapsed two near-identical copies into one adventure-shaped function;
// giving the maps a third copy of the same grammar would undo that on the spot.
//
// So the grammar lives here and each surface passes its own shape:
//
//   avesmapsFilterBarMarkup([
//     { kind: "label",   text: "Filter" },
//     { kind: "chips",   filter: "type", values: [{ value, label, count }], dividerAfter: true },
//     { kind: "select",  filter: "art",  placeholder: "Art", values: ["politisch", …] | [{value,label}] },
//     { kind: "years",   from: "yearFrom", to: "yearTo", label: "Zeitraum (BF)", range: {min,max} },
//     { kind: "divider" },
//     { kind: "toggle",  filter: "official", label: "nur offiziell" },
//   ])
//
// DIVIDERS come in two flavours because the existing bar needs both: an explicit { kind: "divider" } is
// unconditional, while `dividerAfter: true` on a group emits a rule ONLY when that group rendered
// something. Without the second one, an adventure set with no Art facet would grow a stray leading rule.
//
// The emitted CLASSES are still .avesmaps-adv-tree__* -- historical (they were named after the tree
// dialog), and already shared across two dialogs before this file existed, so a third consumer is
// consistent rather than divergent. Renaming them is a separate sweep across adventures-dialog.css and
// both dialogs' wiring, with real regression risk and no behaviour change; not worth bundling in here.
//
// The MARKUP is shared, the WIRING stays per dialog (box-local vs. document-delegated) -- the
// data-adv-filter / data-adv-value attributes are the contract between the two.

function filterBarEscape(value) {
	return typeof escapeHtml === "function"
		? escapeHtml(String(value == null ? "" : value))
		: String(value == null ? "" : value);
}

// Accepts "plain string" (value === label, what the adventure facets produce) or {value, label, count}.
function filterBarOption(entry) {
	if (entry && typeof entry === "object") {
		return {
			value: String(entry.value == null ? "" : entry.value),
			label: String(entry.label == null ? entry.value : entry.label),
			count: (typeof entry.count === "number") ? entry.count : null,
		};
	}
	var text = String(entry == null ? "" : entry);
	return { value: text, label: text, count: null };
}

function filterBarChipMarkup(filterKind, entry) {
	var option = filterBarOption(entry);
	// A count is rendered only when supplied (§3.7 asks for it on the map types). Its absence is what
	// keeps the adventure bar byte-identical to the pre-generalisation version.
	var count = option.count === null
		? ""
		: ' <span class="avesmaps-adv-tree__chipcount">(' + filterBarEscape(option.count) + ')</span>';
	return '<span class="avesmaps-adv-tree__chip" data-adv-filter="' + filterBarEscape(filterKind) + '"'
		+ ' data-adv-value="' + filterBarEscape(option.value) + '">'
		+ filterBarEscape(option.label) + count + '</span>';
}

function filterBarSelectMarkup(group) {
	var values = group.values || [];
	if (!values.length) {
		return ""; // no facet -> no control (an empty dropdown is worse than none)
	}
	return '<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="' + filterBarEscape(group.filter) + '">'
		+ '<option value="">' + filterBarEscape(group.placeholder) + '</option>'
		+ values.map(function (entry) {
			var option = filterBarOption(entry);
			return '<option value="' + filterBarEscape(option.value) + '">' + filterBarEscape(option.label) + '</option>';
		}).join("")
		+ '</select></span>';
}

// The year range always renders, even with no facet, so the field stays findable. The known min/max
// become the placeholders -- they tell the reader the span without pre-filtering it.
function filterBarYearsMarkup(group) {
	var range = group.range || { min: 0, max: 0 };
	var fromPlaceholder = range.min > 0 ? filterBarEscape(range.min) : filterBarEscape(group.fromPlaceholder);
	var toPlaceholder = range.max > 0 ? filterBarEscape(range.max) : filterBarEscape(group.toPlaceholder);
	return '<span class="avesmaps-adv-tree__yearwrap"><span class="avesmaps-adv-tree__ylabel">' + filterBarEscape(group.label) + '</span>'
		+ '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="' + filterBarEscape(group.from) + '" placeholder="' + fromPlaceholder + '">'
		+ '<span class="avesmaps-adv-tree__ydash">–</span>'
		+ '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="' + filterBarEscape(group.to) + '" placeholder="' + toPlaceholder + '"></span>';
}

// One group -> its markup, or "" when the group has nothing to show.
function filterBarGroupMarkup(group) {
	if (!group || !group.kind) {
		return "";
	}
	if (group.kind === "label") {
		return '<span class="avesmaps-adv-tree__flabel">' + filterBarEscape(group.text) + '</span>';
	}
	if (group.kind === "divider") {
		return '<span class="avesmaps-adv-tree__fdiv"></span>';
	}
	if (group.kind === "chips") {
		var values = group.values || [];
		if (!values.length) {
			return "";
		}
		return values.map(function (entry) { return filterBarChipMarkup(group.filter, entry); }).join("");
	}
	if (group.kind === "toggle") {
		// A toggle is a chip WITHOUT data-adv-value: the wiring reads the missing value as "this is a
		// boolean, not one of a set".
		return '<span class="avesmaps-adv-tree__chip" data-adv-filter="' + filterBarEscape(group.filter) + '">'
			+ filterBarEscape(group.label) + '</span>';
	}
	if (group.kind === "select") {
		return filterBarSelectMarkup(group);
	}
	if (group.kind === "years") {
		return filterBarYearsMarkup(group);
	}
	return "";
}

function avesmapsFilterBarMarkup(groups) {
	var parts = [];
	(groups || []).forEach(function (group) {
		var markup = filterBarGroupMarkup(group);
		if (markup === "") {
			return; // an empty group swallows its own trailing rule with it
		}
		parts.push(markup);
		if (group.dividerAfter) {
			parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
		}
	});
	return '<div class="avesmaps-adv-tree__filters">' + parts.join("") + '</div>';
}

// Node export of the pure builder (inert in the browser, where index.html loads this as a plain script
// and everything above is a global).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsFilterBarMarkup: avesmapsFilterBarMarkup,
	};
}
