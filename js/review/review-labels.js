function setLabelEditDialogOpen(isOpen, { resetForm = false } = {}) {
	$("#label-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getLabelEditDialogElement()?.focus();
		document.getElementById("label-edit-text")?.focus();
		return;
	}

	if (resetForm) {
		resetLabelEditForm();
	}
}

function populateLabelEditForm({ labelEntry = null, latlng = null } = {}) {
	labelEditEntry = labelEntry;
	labelEditLatLng = latlng ? L.latLng(latlng) : labelEntry?.marker.getLatLng() || null;
	const label = labelEntry?.label || {};
	// Fuer NEUE Labels (kein labelEntry) die zuletzt genutzte DARSTELLUNG als Default uebernehmen; bestehende
	// Labels behalten ihre eigenen Werte. Text & Kategorie werden bewusst NICHT gemerkt.
	const remembered = labelEntry ? {} : (readRememberedLabelDisplaySettings() || {});
	document.getElementById("label-edit-public-id").value = label.publicId || "";
	void acquireFeatureSoftLock(label.publicId || "");
	document.getElementById("label-edit-text").value = label.text || "";
	document.getElementById("label-edit-type").value = label.labelType || "region";
	document.getElementById("label-edit-size").value = label.size || remembered.size || 18;
	document.getElementById("label-edit-rotation").value = ((Number(label.rotation ?? remembered.rotation ?? 0) % 360) + 360) % 360;
	document.getElementById("label-edit-min-zoom").value = label.minZoom ?? remembered.minZoom ?? 0;
	document.getElementById("label-edit-max-zoom").value = label.maxZoom ?? remembered.maxZoom ?? 5;
	document.getElementById("label-edit-priority").value = label.priority ?? remembered.priority ?? 3;
	document.getElementById("label-edit-is-nodix").checked = Boolean(labelEntry ? label.isNodix : (remembered.isNodix ?? false));
	if (typeof setLabelWikiRegion === "function") {
		setLabelWikiRegion(label.wikiRegion || null);
	}
	syncLabelZoomRangeOutputs();
	syncLabelSliderRowsFromNumbers();
	syncLabelPriorityOutput();
	document.getElementById("label-edit-delete").hidden = !labelEntry;
	if (labelEditLatLng) {
		document.getElementById("label-edit-lat").value = labelEditLatLng.lat.toFixed(3);
		document.getElementById("label-edit-lng").value = labelEditLatLng.lng.toFixed(3);
	}
}

function openLabelEditDialog(options = {}) {
	resetLabelEditForm();
	populateLabelEditForm(options);
	setLabelEditDialogOpen(true);
}

function syncLabelZoomRangeOutputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}

	let minZoom = Number.parseInt(minInputElement.value, 10);
	let maxZoom = Number.parseInt(maxInputElement.value, 10);
	if (event?.currentTarget === minInputElement && minZoom > maxZoom) {
		maxZoom = minZoom;
		maxInputElement.value = String(maxZoom);
	} else if (event?.currentTarget === maxInputElement && maxZoom < minZoom) {
		minZoom = maxZoom;
		minInputElement.value = String(minZoom);
	}

	if (minNumElement) {
		minNumElement.value = String(minZoom);
	}
	if (maxNumElement) {
		maxNumElement.value = String(maxZoom);
	}
	if (event?.currentTarget && map.getZoom() !== Number(event.currentTarget.value)) {
		map.setZoom(Number(event.currentTarget.value));
	}
}

function syncLabelZoomNumberInputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}
	const clamp = (value) => Math.max(0, Math.min(5, Number.parseInt(value, 10) || 0));
	if (minNumElement) {
		minInputElement.value = String(clamp(minNumElement.value));
	}
	if (maxNumElement) {
		maxInputElement.value = String(clamp(maxNumElement.value));
	}
	syncLabelZoomRangeOutputs({ currentTarget: event?.currentTarget === maxNumElement ? maxInputElement : minInputElement });
}

function syncLabelPriorityOutput() {
	const inputElement = document.getElementById("label-edit-priority");
	const outputElement = document.getElementById("label-edit-priority-output");
	if (!inputElement || !outputElement) {
		return;
	}

	outputElement.value = inputElement.value;
	outputElement.textContent = inputElement.value;
}

// Zahl+Slider-Reihen (Groesse/Rotation/Prioritaet): Slider aus den Zahlenwerten initialisieren.
function syncLabelSliderRowsFromNumbers() {
	document.querySelectorAll("#label-edit-dialog .label-edit-sliderrow").forEach((row) => {
		const numberInput = row.querySelector('input[type="number"]');
		const rangeInput = row.querySelector('input[type="range"]');
		if (numberInput && rangeInput) {
			rangeInput.value = numberInput.value;
		}
	});
}

// Zahl <-> Slider in einer Sliderrow spiegeln (ohne Seiteneffekt; Zoom hat eigene Logik).
document.addEventListener("input", (event) => {
	const target = event.target;
	if (!target || typeof target.closest !== "function") {
		return;
	}
	const row = target.closest(".label-edit-sliderrow");
	if (!row) {
		return;
	}
	const numberInput = row.querySelector('input[type="number"]');
	const rangeInput = row.querySelector('input[type="range"]');
	if (!numberInput || !rangeInput) {
		return;
	}
	if (target === rangeInput) {
		numberInput.value = rangeInput.value;
	} else {
		rangeInput.value = numberInput.value;
	}
});

// Zuletzt genutzte Label-DARSTELLUNG (Groesse/Rotation/Zoom-Band/Prioritaet/Nodix) merken bzw. lesen.
// Damit werden NEUE Labels vorbefuellt; Text & Kategorie werden bewusst NICHT gemerkt.
function persistLabelDisplaySettings(payload) {
	try {
		window.localStorage.setItem("avesmapsLabelEditorLastDisplay", JSON.stringify({
			size: payload.size,
			rotation: payload.rotation,
			minZoom: payload.min_zoom,
			maxZoom: payload.max_zoom,
			priority: payload.priority,
			isNodix: payload.is_nodix,
		}));
	} catch (error) {
		/* localStorage nicht verfuegbar -> Feature inaktiv */
	}
}

function readRememberedLabelDisplaySettings() {
	try {
		const raw = window.localStorage.getItem("avesmapsLabelEditorLastDisplay");
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch (error) {
		return null;
	}
}

function buildLabelEditPayload(formElement) {
	const formData = new FormData(formElement);
	const publicId = String(formData.get("public_id") || "").trim();
	const action = publicId ? "update_label" : "create_label";
	const payload = {
		action,
		public_id: publicId,
		text: String(formData.get("text") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "region").trim(),
		size: Number.parseInt(String(formData.get("size") || "18"), 10),
		rotation: Number.parseInt(String(formData.get("rotation") || "0"), 10),
		min_zoom: Number.parseInt(String(formData.get("min_zoom") || "0"), 10),
		max_zoom: Number.parseInt(String(formData.get("max_zoom") || "5"), 10),
		priority: Number.parseInt(String(formData.get("priority") || "3"), 10),
		is_nodix: formData.get("is_nodix") === "on",
		wiki_region: typeof getLabelWikiRegionPayload === "function" ? getLabelWikiRegionPayload() : null,
	};

	if (action === "create_label") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	// Zuletzt genutzte Darstellung merken -> neue Labels werden damit vorbefuellt (s. populateLabelEditForm).
	persistLabelDisplaySettings(payload);
	return payload;
}
