// Shared "Andere Quelle" (external / non-wiki source) field behaviour, reused across every
// map editor (Ort/Weg/Region-Label/Region-Flaeche and the Territorium editor). The section
// markup itself lives statically in each dialog (index.html / political-territory-editor.html)
// so it inherits that dialog's styling; this module only drives visibility, read/write and a
// small live link preview.
//
// Contract per editor: a container #<prefix>-other-source-section that wraps
//   #<prefix>-other-source-url     (URL input)
//   #<prefix>-other-source-label   (optional link text)
//   #<prefix>-other-source-preview (host for the preview anchor)
// The field is shown ONLY when NO wiki entry is assigned -- a wiki source always takes
// precedence and hides (but does not erase) the "Andere Quelle" value.

function otherSourceElement(prefix, suffix) {
	return document.getElementById(prefix + "-other-source-" + suffix);
}

function otherSourceEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function otherSourceEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

// Read the two inputs into a normalized { url, label } (both trimmed).
function readOtherSourceFromForm(prefix) {
	const urlInput = otherSourceElement(prefix, "url");
	const labelInput = otherSourceElement(prefix, "label");
	return {
		url: String((urlInput && urlInput.value) || "").trim(),
		label: String((labelInput && labelInput.value) || "").trim(),
	};
}

// Normalize a stored value (properties.other_source object, or a bare url string) into
// { url, label }, tolerating the legacy/None cases.
function normalizeOtherSourceValue(value) {
	if (!value) {
		return { url: "", label: "" };
	}
	if (typeof value === "string") {
		return { url: value.trim(), label: "" };
	}
	return {
		url: String(value.url || "").trim(),
		label: String(value.label || "").trim(),
	};
}

// Fill the inputs from a stored { url, label } (or null/undefined/string to clear/adopt).
function writeOtherSourceToForm(prefix, value) {
	const normalized = normalizeOtherSourceValue(value);
	const urlInput = otherSourceElement(prefix, "url");
	const labelInput = otherSourceElement(prefix, "label");
	if (urlInput) {
		urlInput.value = normalized.url;
	}
	if (labelInput) {
		labelInput.value = normalized.label;
	}
	renderOtherSourcePreview(prefix);
}

// Show the "Andere Quelle" section only when no wiki entry is assigned.
function toggleOtherSourceSection(prefix, hasWiki) {
	const section = otherSourceElement(prefix, "section");
	if (section) {
		section.hidden = Boolean(hasWiki);
	}
	renderOtherSourcePreview(prefix);
}

// Small live preview of the resulting link below the inputs.
function renderOtherSourcePreview(prefix) {
	const host = otherSourceElement(prefix, "preview");
	if (!host) {
		return;
	}
	const source = readOtherSourceFromForm(prefix);
	if (!source.url) {
		host.innerHTML = "";
		return;
	}
	const text = source.label || source.url;
	host.innerHTML =
		'<a class="label-wiki-reference__link" href="' +
		otherSourceEscapeAttr(source.url) +
		'" target="_blank" rel="noopener">' +
		otherSourceEscapeText(text) +
		" ↗</a>";
}

// One delegated listener keeps every editor's preview in sync while the user types.
document.addEventListener("input", (event) => {
	const target = event.target;
	if (!target || !target.id) {
		return;
	}
	const match = /^(.*)-other-source-(url|label)$/.exec(target.id);
	if (match) {
		renderOtherSourcePreview(match[1]);
	}
});

window.readOtherSourceFromForm = readOtherSourceFromForm;
window.writeOtherSourceToForm = writeOtherSourceToForm;
window.toggleOtherSourceSection = toggleOtherSourceSection;
