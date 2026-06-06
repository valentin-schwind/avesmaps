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
	document.getElementById("label-edit-public-id").value = label.publicId || "";
	void acquireFeatureSoftLock(label.publicId || "");
	document.getElementById("label-edit-text").value = label.text || "";
	document.getElementById("label-edit-type").value = label.labelType || "region";
	document.getElementById("label-edit-size").value = label.size || 18;
	document.getElementById("label-edit-rotation").value = label.rotation || 0;
	document.getElementById("label-edit-min-zoom").value = label.minZoom ?? 0;
	document.getElementById("label-edit-max-zoom").value = label.maxZoom ?? 5;
	document.getElementById("label-edit-priority").value = label.priority ?? 3;
	document.getElementById("label-edit-is-nodix").checked = Boolean(label.isNodix);
	if (typeof setLabelWikiRegion === "function") {
		setLabelWikiRegion(label.wikiRegion || null);
	}
	syncLabelZoomRangeOutputs();
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

	return payload;
}
