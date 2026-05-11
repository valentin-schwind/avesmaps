function getLocationReportOverlayElement() {
	return document.getElementById("location-report-overlay");
}

function getLocationReportDialogElement() {
	return document.getElementById("location-report-dialog");
}

function getLocationEditDialogElement() {
	return document.getElementById("location-edit-dialog");
}

function getPathEditDialogElement() {
	return document.getElementById("path-edit-dialog");
}

function getLocationReportFormElement() {
	return document.getElementById("location-report-form");
}

function getLocationReportStatusElement() {
	return document.getElementById("location-report-status");
}

function getLocationEditFormElement() {
	return document.getElementById("location-edit-form");
}

function getLocationEditStatusElement() {
	return document.getElementById("location-edit-status");
}

function getPathEditFormElement() {
	return document.getElementById("path-edit-form");
}

function getPathEditStatusElement() {
	return document.getElementById("path-edit-status");
}

function getPowerlineEditFormElement() {
	return document.getElementById("powerline-edit-form");
}

function getPowerlineEditStatusElement() {
	return document.getElementById("powerline-edit-status");
}

function getPowerlineEditDialogElement() {
	return document.getElementById("powerline-edit-dialog");
}

function getLabelEditFormElement() {
	return document.getElementById("label-edit-form");
}

function getLabelEditStatusElement() {
	return document.getElementById("label-edit-status");
}

function getLabelEditDialogElement() {
	return document.getElementById("label-edit-dialog");
}

function getRegionEditFormElement() {
	return document.getElementById("region-edit-form");
}

function getRegionEditStatusElement() {
	return document.getElementById("region-edit-status");
}

function getRegionEditDialogElement() {
	return document.getElementById("region-edit-dialog");
}

function getLocationReportServiceNoteElement() {
	return document.getElementById("location-report-service-note");
}

function isLocationReportDialogOpen() {
	return !$("#location-report-overlay").prop("hidden");
}

function isLocationEditDialogOpen() {
	return !$("#location-edit-overlay").prop("hidden");
}

function isPathEditDialogOpen() {
	return !$("#path-edit-overlay").prop("hidden");
}

function isPowerlineEditDialogOpen() {
	return !$("#powerline-edit-overlay").prop("hidden");
}

function isLabelEditDialogOpen() {
	return !$("#label-edit-overlay").prop("hidden");
}

function isRegionEditDialogOpen() {
	return !$("#region-edit-overlay").prop("hidden");
}

function isLocationReportServiceConfigured() {
	return Boolean(String(LOCATION_REPORT_FORM_ENDPOINT_URL || "").trim());
}

function syncModalDialogBodyState() {
	const hasOpenModal = !$("#legal-overlay").prop("hidden") || !$("#location-report-overlay").prop("hidden") || !$("#location-edit-overlay").prop("hidden") || !$("#path-edit-overlay").prop("hidden") || !$("#powerline-edit-overlay").prop("hidden") || !$("#label-edit-overlay").prop("hidden") || !$("#region-edit-overlay").prop("hidden");
	$("body").toggleClass("modal-dialog-open", hasOpenModal);
}

function buildLocationReportRequestPayload(formElement) {
	const formData = new FormData(formElement);

	return {
		report_type: String(formData.get("report_type") || "location").trim(),
		name: String(formData.get("name") || "").trim(),
		size: String(formData.get("size") || "").trim(),
		source: String(formData.get("source") || "").trim(),
		reporter_name: String(formData.get("reporter_name") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		comment: String(formData.get("comment") || "").trim(),
		lat: Number.parseFloat(String(formData.get("lat") || "")),
		lng: Number.parseFloat(String(formData.get("lng") || "")),
		page_url: String(formData.get("page_url") || "").trim(),
		client_version: String(formData.get("client_version") || "").trim(),
		elapsed_ms: Math.max(0, Date.now() - Number.parseInt(String(formData.get("opened_at") || "0"), 10)),
		website: String(formData.get("website") || "").trim(),
	};
}

function syncLocationReportTypeFields() {
	const reportType = String(document.getElementById("location-report-type")?.value || "location");
	const sizeFieldElement = document.getElementById("location-report-size-field");
	const sizeSelectElement = document.getElementById("location-report-size");
	const sourceInputElement = document.getElementById("location-report-source");
	const isLocationReport = reportType === "location";
	const isCommentReport = reportType === "comment";
	if (sizeFieldElement) {
		sizeFieldElement.hidden = !isLocationReport;
	}
	if (sizeSelectElement) {
		sizeSelectElement.required = isLocationReport;
		sizeSelectElement.disabled = !isLocationReport;
		if (!isLocationReport) {
			sizeSelectElement.value = "dorf";
		}
	}
	if (sourceInputElement) {
		sourceInputElement.required = !isCommentReport;
		sourceInputElement.closest(".location-report-form__field").querySelector("span").textContent = isCommentReport
			? "Quelle (optional)"
			: "Quelle (Abenteuer, Regionalband, etc.) *";
	}
}

function setLocationReportStatus(message = "", type = "") {
	const statusElement = getLocationReportStatusElement();
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setLocationEditStatus(message = "", type = "") {
	const statusElement = getLocationEditStatusElement();
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setPathEditStatus(message = "", type = "") {
	const statusElement = getPathEditStatusElement();
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setPowerlineEditStatus(message = "", type = "") {
	const statusElement = getPowerlineEditStatusElement();
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setLabelEditStatus(message = "", type = "") {
	const statusElement = getLabelEditStatusElement();
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message;
	if (type) {
		statusElement.dataset.status = type;
	} else {
		delete statusElement.dataset.status;
	}
}

function setRegionEditStatus(message = "", type = "") {
	const statusElement = getRegionEditStatusElement();
	if (!statusElement) return;
	statusElement.textContent = message;
	if (type) statusElement.dataset.status = type;
	else delete statusElement.dataset.status;
}

function setLocationReportSubmitPending(isPending) {
	isLocationReportSubmissionPending = isPending;

	const formElement = getLocationReportFormElement();
	if (!formElement) {
		return;
	}

	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	const closeButtonElement = document.getElementById("location-report-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
}

function setLocationEditSubmitPending(isPending) {
	isLocationEditSubmissionPending = isPending;

	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	const closeButtonElement = document.getElementById("location-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("location-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

function setPathEditSubmitPending(isPending) {
	isPathEditSubmissionPending = isPending;

	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	const closeButtonElement = document.getElementById("path-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("path-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

function setPowerlineEditSubmitPending(isPending) {
	isPowerlineEditSubmissionPending = isPending;

	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	const closeButtonElement = document.getElementById("powerline-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("powerline-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

function resetLocationReportForm() {
	const formElement = getLocationReportFormElement();
	if (!formElement) {
		return;
	}

	formElement.reset();
	locationReportLatLng = null;
	document.getElementById("location-report-coordinates").textContent = "-";
	document.getElementById("location-report-lat").value = "";
	document.getElementById("location-report-lng").value = "";
	document.getElementById("location-report-page-url").value = "";
	document.getElementById("location-report-client-version").value = "";
	document.getElementById("location-report-opened-at").value = "";
	setLocationReportStatus();
}

function resetLocationEditForm() {
	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("location-edit-public-id")?.value || "";
	formElement.reset();
	locationEditLatLng = null;
	locationEditMarkerEntry = null;
	activeReviewReportId = null;
	activeReviewReportSource = null;
	pendingCrossingConversionPublicId = null;
	pendingCrossingConversionName = "";
	pendingCrossingConversionIsNodix = false;
	void releaseFeatureSoftLock(publicId);
	setLocationEditStatus();
}

function resetPathEditForm() {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("path-edit-public-id")?.value || "";
	formElement.reset();
	pathEditFeature = null;
	void releaseFeatureSoftLock(publicId);
	syncPathAutoNameControls();
	setPathEditStatus();
}

function resetPowerlineEditForm() {
	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("powerline-edit-public-id")?.value || "";
	formElement.reset();
	powerlineEditFeature = null;
	void releaseFeatureSoftLock(publicId);
	setPowerlineEditStatus();
}

function resetLabelEditForm() {
	const formElement = getLabelEditFormElement();
	if (!formElement) {
		return;
	}

	if (pendingLabelMoveAfterEditEntry === labelEditEntry) {
		pendingLabelMoveAfterEditEntry = null;
	}

	const publicId = document.getElementById("label-edit-public-id")?.value || "";
	formElement.reset();
	labelEditEntry = null;
	labelEditLatLng = null;
	void releaseFeatureSoftLock(publicId);
	activeReviewReportId = null;
	activeReviewReportSource = null;
	document.getElementById("label-edit-public-id").value = "";
	syncLabelZoomRangeOutputs();
	syncLabelPriorityOutput();
	setLabelEditStatus();
}

function resetRegionEditForm() {
	const formElement = getRegionEditFormElement();
	if (!formElement) return;
	const publicId = document.getElementById("region-edit-public-id")?.value || "";
	formElement.reset();
	regionEditEntry = null;
	void releaseFeatureSoftLock(publicId);
	document.getElementById("region-edit-public-id").value = "";
	document.getElementById("region-edit-delete").hidden = true;
	document.getElementById("region-edit-wiki-url").value = "";
	syncRegionOpacityOutput();
	setRegionEditStatus();
}

function updateLocationReportDialogAvailability() {
	const serviceNoteElement = getLocationReportServiceNoteElement();
	const submitButtonElement = document.getElementById("location-report-submit");
	const isConfigured = isLocationReportServiceConfigured();

	if (serviceNoteElement) {
		serviceNoteElement.hidden = isConfigured;
	}

	if (submitButtonElement && !isLocationReportSubmissionPending) {
		submitButtonElement.disabled = !isConfigured;
	}
}

function formatLocationReportCoordinates(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return `${normalizedLatLng.lat.toFixed(3)}, ${normalizedLatLng.lng.toFixed(3)}`;
}

function populateLocationReportForm(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	locationReportLatLng = normalizedLatLng;
	document.getElementById("location-report-type").value = "location";
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(normalizedLatLng);
	document.getElementById("location-report-lat").value = normalizedLatLng.lat.toFixed(3);
	document.getElementById("location-report-lng").value = normalizedLatLng.lng.toFixed(3);
	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	document.getElementById("location-report-opened-at").value = String(Date.now());
	document.getElementById("location-report-size").value = "dorf";
	syncLocationReportTypeFields();
}

function setLocationReportDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isLocationReportSubmissionPending) {
		return;
	}

	$("#location-report-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		updateLocationReportDialogAvailability();
		getLocationReportDialogElement()?.focus();
		document.getElementById("location-report-name")?.focus();
		return;
	}

	if (resetForm) {
		resetLocationReportForm();
	}
}

function setLocationEditDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isLocationEditSubmissionPending) {
		return;
	}

	$("#location-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getLocationEditDialogElement()?.focus();
		document.getElementById("location-edit-name")?.focus();
		return;
	}

	if (resetForm) {
		resetLocationEditForm();
	}
}

function setPathEditDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isPathEditSubmissionPending) {
		return;
	}

	$("#path-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getPathEditDialogElement()?.focus();
		document.getElementById("path-edit-name")?.focus();
		return;
	}

	if (resetForm) {
		resetPathEditForm();
	}
}

function setPowerlineEditDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isPowerlineEditSubmissionPending) {
		return;
	}

	$("#powerline-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getPowerlineEditDialogElement()?.focus();
		document.getElementById("powerline-edit-name")?.focus();
		return;
	}

	if (resetForm) {
		resetPowerlineEditForm();
	}
}

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

function setRegionEditDialogOpen(isOpen, { resetForm = false } = {}) {
	$("#region-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen) {
		getRegionEditDialogElement()?.focus();
		document.getElementById("region-edit-name")?.focus();
		return;
	}
	if (resetForm) resetRegionEditForm();
}

function openLocationReportDialog(latlng) {
	resetLocationReportForm();
	updateLocationReportDialogAvailability();
	populateLocationReportForm(latlng);
	setLocationReportDialogOpen(true);
}

function populateLocationEditForm({ markerEntry = null, latlng = null, presetName = "", presetIsNodix = null } = {}) {
	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	locationEditMarkerEntry = markerEntry;
	locationEditLatLng = latlng ? L.latLng(latlng) : markerEntry?.marker.getLatLng() || null;
	const location = markerEntry?.location || {};
	const wikiLocationLink = getWikiLocationLink(location.name || markerEntry?.name || "", location.wikiUrl || "");
	document.getElementById("location-edit-public-id").value = markerEntry?.publicId || "";
	void acquireFeatureSoftLock(markerEntry?.publicId || "");
	const isCrossingConversion = pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === markerEntry?.publicId;
	document.getElementById("location-edit-name").value = presetName || (isCrossingConversion ? pendingCrossingConversionName : "") || location.name || markerEntry?.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(location.locationType || markerEntry?.locationType || "dorf");
	document.getElementById("location-edit-description").value = location.description || "";
	document.getElementById("location-edit-wiki-url").value = location.wikiUrl || wikiLocationLink?.url || "";
	document.getElementById("location-edit-is-nodix").checked = presetIsNodix === null
		? (isCrossingConversion ? pendingCrossingConversionIsNodix : Boolean(location.isNodix))
		: Boolean(presetIsNodix);
	document.getElementById("location-edit-is-ruined").checked = Boolean(location.isRuined);

	if (locationEditLatLng) {
		document.getElementById("location-edit-coordinates").textContent = formatLocationReportCoordinates(locationEditLatLng);
		document.getElementById("location-edit-lat").value = locationEditLatLng.lat.toFixed(3);
		document.getElementById("location-edit-lng").value = locationEditLatLng.lng.toFixed(3);
	} else {
		document.getElementById("location-edit-coordinates").textContent = "-";
		document.getElementById("location-edit-lat").value = "";
		document.getElementById("location-edit-lng").value = "";
	}
}

function openLocationEditDialog(options = {}) {
	resetLocationEditForm();
	populateLocationEditForm(options);
	setLocationEditDialogOpen(true);
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
	const minOutputElement = document.getElementById("label-edit-min-zoom-output");
	const maxOutputElement = document.getElementById("label-edit-max-zoom-output");
	if (!minInputElement || !maxInputElement || !minOutputElement || !maxOutputElement) {
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

	minOutputElement.value = String(minZoom);
	minOutputElement.textContent = String(minZoom);
	maxOutputElement.value = String(maxZoom);
	maxOutputElement.textContent = String(maxZoom);
	if (event?.currentTarget && map.getZoom() !== Number(event.currentTarget.value)) {
		map.setZoom(Number(event.currentTarget.value));
	}
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

function syncRegionOpacityOutput() {
	const inputElement = document.getElementById("region-edit-opacity");
	const outputElement = document.getElementById("region-edit-opacity-output");
	if (!inputElement || !outputElement) return;
	outputElement.value = `${inputElement.value}%`;
	outputElement.textContent = `${inputElement.value}%`;
}

function populateRegionEditForm(entry) {
	regionEditEntry = entry;
	const region = entry?.region || entry || {};
	document.getElementById("region-edit-public-id").value = region.publicId || "";
	void acquireFeatureSoftLock(region.publicId || "");
	document.getElementById("region-edit-name").value = region.name || "";
	document.getElementById("region-edit-color").value = region.color || "#888888";
	document.getElementById("region-edit-opacity").value = Math.round((region.opacity ?? 0.33) * 100);
	document.getElementById("region-edit-wiki-url").value = region.wikiUrl || "";
	document.getElementById("region-edit-delete").hidden = !entry;
	syncRegionOpacityOutput();
}

function openRegionEditDialog(entry) {
	resetRegionEditForm();
	populateRegionEditForm(entry);
	setRegionEditDialogOpen(true);
}

function populatePathEditForm(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const pathSubtype = normalizePathName(path.properties?.name || path.properties?.feature_subtype || "Weg");
	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getPathDisplayName(path);
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = true;
	document.getElementById("path-edit-show-label").checked = shouldPathNameBeDisplayed(path);
	syncPathTransportOptions({ path });
	syncPathAutoNameControls();
}

function openPathEditDialog(path) {
	resetPathEditForm();
	populatePathEditForm(path);
	setPathEditDialogOpen(true);
}

function populatePowerlineEditForm(powerline) {
	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	powerlineEditFeature = powerline;
	document.getElementById("powerline-edit-public-id").value = powerline.properties?.public_id || powerline.id || "";
	void acquireFeatureSoftLock(document.getElementById("powerline-edit-public-id").value);
	document.getElementById("powerline-edit-name").value = String(powerline.properties?.name || "").trim();
	document.getElementById("powerline-edit-show-label").checked = shouldPowerlineNameBeDisplayed(powerline);
}

function openPowerlineEditDialog(powerline) {
	resetPowerlineEditForm();
	populatePowerlineEditForm(powerline);
	setPowerlineEditDialogOpen(true);
}

function buildPowerlineEditPayload(formElement) {
	const formData = new FormData(formElement);
	return {
		action: "update_powerline_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		show_label: formData.get("show_label") === "on",
	};
}

function buildPathEditPayload(formElement) {
	const formData = new FormData(formElement);
	const featureSubtype = String(formData.get("feature_subtype") || "").trim();
	const isAutoNameEnabled = formData.get("autoname") === "on";
	const submittedName = isAutoNameEnabled
		? String(formData.get("name") || "").trim()
		: getPathDisplayNameOrGenerated(formData.get("name"), featureSubtype, { excludePath: pathEditFeature });
	return {
		action: "update_path_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: submittedName || getNextPathDisplayName(featureSubtype, { excludePath: pathEditFeature }),
		feature_subtype: featureSubtype,
		show_label: formData.get("show_label") === "on",
		transport_domain: getDefaultTransportDomainForPathSubtype(featureSubtype),
		allowed_transports: Array.from(formElement.querySelectorAll('input[name="allowed_transport"]:checked')).map((input) => input.value),
	};
}

function getDefaultTransportDomainForPathSubtype(pathSubtype) {
	if (pathSubtype === "Flussweg") return "river";
	if (pathSubtype === "Seeweg") return "sea";
	return "land";
}

function getPathTransportDomain(path) {
	return path?.properties?.transport_domain || getDefaultTransportDomainForPathSubtype(normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name));
}

function getPathAllowedTransports(path) {
	const domain = getPathTransportDomain(path);
	const configured = Array.isArray(path?.properties?.allowed_transports) ? path.properties.allowed_transports : null;
	if (configured !== null) {
		return configured;
	}

	return TRANSPORT_DOMAIN_OPTIONS[domain] || [];
}

function syncPathTransportOptions({ path = null, resetToDefault = false } = {}) {
	const subtype = normalizePathSubtype(document.getElementById("path-edit-type")?.value || path?.properties?.feature_subtype || "Weg");
	const domain = getDefaultTransportDomainForPathSubtype(subtype);
	const defaultOptions = TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	const selectedOptions = resetToDefault || !path ? defaultOptions : getPathAllowedTransports(path);
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		const isCompatible = defaultOptions.includes(input.value);
		input.closest("label").hidden = !isCompatible;
		input.disabled = !isCompatible;
		input.checked = isCompatible && selectedOptions.includes(input.value);
	});
}

function syncPathAutoNameControls({ forceName = false } = {}) {
	const nameInputElement = document.getElementById("path-edit-name");
	const typeSelectElement = document.getElementById("path-edit-type");
	const autoNameElement = document.getElementById("path-edit-autoname");
	if (!nameInputElement || !typeSelectElement || !autoNameElement) {
		return;
	}

	const isAutoNameEnabled = autoNameElement.checked;
	nameInputElement.readOnly = isAutoNameEnabled;
	if (!isAutoNameEnabled) {
		return;
	}

	const selectedSubtype = normalizePathSubtype(typeSelectElement.value);
	const shouldRefreshName = forceName || !nameInputElement.value.trim();
	if (shouldRefreshName) {
		nameInputElement.value = getNextPathDisplayName(selectedSubtype, { excludePath: pathEditFeature });
	}
}

function buildLocationEditPayload(formElement) {
	const formData = new FormData(formElement);
	const publicId = String(formData.get("public_id") || "").trim();
	const action = publicId ? "update_point" : "create_point";
	const payload = {
		action,
		public_id: publicId,
		name: String(formData.get("name") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "").trim(),
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		is_nodix: formData.get("is_nodix") === "on",
		is_ruined: formData.get("is_ruined") === "on",
	};

	if (action === "create_point") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	return payload;
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
	};

	if (action === "create_label") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	return payload;
}

function buildRegionEditPayload(formElement) {
	const formData = new FormData(formElement);
	return {
		action: "update_region",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		color: String(formData.get("color") || "#888888").trim(),
		opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
		wiki_url: String(formData.get("wiki_url") || "").trim(),
	};
}

function setReviewPanelStatus(message, state = "") {
	const statusElement = document.getElementById("review-panel-status");
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message || "";
	statusElement.dataset.state = state;
}

function setChangePanelStatus(message, state = "") {
	const statusElement = document.getElementById("change-panel-status");
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message || "";
	statusElement.dataset.state = state;
}

function setPresencePanelStatus(message, state = "") {
	const statusElement = document.getElementById("presence-panel-status");
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message || "";
	statusElement.dataset.state = state;
}

function setEditorPanelTab(tabName) {
	activeEditorPanelTab = ["review", "changes", "presence"].includes(tabName) ? tabName : "review";
	document.querySelectorAll(".review-panel__tab").forEach((tabElement) => {
		tabElement.classList.toggle("is-active", tabElement.dataset.editorPanelTab === activeEditorPanelTab);
	});
	document.querySelectorAll(".review-panel__section").forEach((sectionElement) => {
		sectionElement.classList.toggle("is-active", sectionElement.dataset.editorPanelSection === activeEditorPanelTab);
	});

	if (activeEditorPanelTab === "changes") {
		void loadChangeLog();
	} else if (activeEditorPanelTab === "presence") {
		void sendEditorPresenceHeartbeat();
	}
}

function restoreReviewPanelState() {
	try {
		isReviewPanelHidden = window.localStorage?.getItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY) === "1";
	} catch (error) {
		isReviewPanelHidden = false;
	}

	syncReviewPanelVisibility();
}

function syncReviewPanelVisibility() {
	$("#review-panel").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").text("Review");
}

function toggleReviewPanel() {
	isReviewPanelHidden = !isReviewPanelHidden;
	try {
		window.localStorage?.setItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY, isReviewPanelHidden ? "1" : "0");
	} catch (error) {
		console.warn("Review-Panel-Zustand konnte nicht gespeichert werden:", error);
	}

	syncReviewPanelVisibility();
}

async function loadReviewReports() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setReviewPanelStatus("Meldungen werden geladen...", "pending");
	try {
		const response = await fetch(LOCATION_REPORT_REVIEW_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(data?.error || `Review-API antwortet mit HTTP ${response.status}.`);
		}

		reviewReports = Array.isArray(data.reports) ? data.reports : [];
		renderReviewReports();
	} catch (error) {
		console.error("Meldungen konnten nicht geladen werden:", error);
		setReviewPanelStatus(error.message || "Meldungen konnten nicht geladen werden.", "error");
	}
}

async function loadChangeLog() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setChangePanelStatus("Änderungen werden geladen...", "pending");
	try {
		const response = await fetch(MAP_AUDIT_LOG_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(data?.error || `Änderungs-API antwortet mit HTTP ${response.status}.`);
		}

		changeLogEntries = Array.isArray(data.changes) ? data.changes : [];
		renderChangeLog();
	} catch (error) {
		console.error("Änderungsverlauf konnte nicht geladen werden:", error);
		setChangePanelStatus(error.message || "Änderungsverlauf konnte nicht geladen werden.", "error");
	}
}

function formatChangeAction(action) {
	const labels = {
		move_point: "Ort verschoben",
		update_point: "Ort geändert",
		create_point: "Ort erstellt",
		create_crossing: "Kreuzung erstellt",
		create_powerline: "Kraftlinie erstellt",
		update_powerline_details: "Kraftlinie geändert",
		create_path: "Weg erstellt",
		update_path_details: "Weg geändert",
		update_path_geometry: "Wegverlauf geändert",
		create_label: "Label erstellt",
		update_label: "Label geändert",
		move_label: "Label verschoben",
		delete_feature: "Objekt gelöscht",
	};

	return labels[action] || action;
}

function renderChangeLog() {
	const listElement = document.getElementById("change-log-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (changeLogEntries.length < 1) {
		setChangePanelStatus("Noch keine Änderungen.", "empty");
		return;
	}

	setChangePanelStatus(`${changeLogEntries.length} letzte Änderungen.`, "success");
	changeLogEntries.forEach((entry) => {
		const itemElement = document.createElement("button");
		itemElement.type = "button";
		itemElement.className = "change-log-entry";
		itemElement.dataset.changeId = String(entry.id || "");
		itemElement.dataset.publicId = entry.public_id || "";
		itemElement.dataset.featureType = entry.feature_type || "";
		itemElement.dataset.action = entry.action || "";
		itemElement.innerHTML = `
			<span class="change-log-entry__action"></span>
			<span class="change-log-entry__target"></span>
			<span class="change-log-entry__meta"></span>
		`;
		itemElement.querySelector(".change-log-entry__action").textContent = formatChangeAction(entry.action);
		itemElement.querySelector(".change-log-entry__target").textContent = entry.name || entry.feature_subtype || entry.public_id || "Unbenannt";
		itemElement.querySelector(".change-log-entry__meta").textContent = `${entry.username || "unbekannt"} · ${entry.created_at || ""}`;
		listElement.appendChild(itemElement);
	});
}

function findLabelMarkerByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function focusPathFeature(path) {
	if (!path?._pathLines?.length) {
		return false;
	}

	const latLngs = pathCoordinatesToLatLngs(path);
	if (latLngs.length < 1) {
		return false;
	}

	map.fitBounds(L.latLngBounds(latLngs), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
	path._pathLines[1]?.openPopup(latLngs[Math.floor(latLngs.length / 2)]);
	return true;
}

function focusLabelFeature(labelEntry) {
	if (!labelEntry) {
		return false;
	}

	const latlng = labelEntry.marker.getLatLng();
	if (!map.hasLayer(labelEntry.marker)) {
		map.setZoom(Math.max(map.getZoom(), labelEntry.label.minZoom || 0));
		syncLabelVisibility();
	}
	map.panTo(latlng);
	openLabelEditDialog({ labelEntry });
	return true;
}

function focusChangeLogEntry(entry) {
	if (!entry?.public_id) {
		showFeedbackToast("Dieses Objekt kann nicht lokalisiert werden.", "warning");
		return;
	}

	const locationEntry = findLocationMarkerByPublicId(entry.public_id);
	if (locationEntry) {
		map.panTo(locationEntry.marker.getLatLng());
		locationEntry.marker.openPopup();
		return;
	}

	const path = findPathByPublicId(entry.public_id);
	if (path && focusPathFeature(path)) {
		return;
	}

	const labelEntry = findLabelMarkerByPublicId(entry.public_id);
	if (labelEntry && focusLabelFeature(labelEntry)) {
		return;
	}

	showFeedbackToast("Objekt ist nicht mehr aktiv oder wurde noch nicht neu geladen.", "warning");
}

function renderReviewReports() {
	const listElement = document.getElementById("review-report-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (reviewReports.length < 1) {
		setReviewPanelStatus("Keine offenen Meldungen.", "empty");
		return;
	}

	setReviewPanelStatus(`${reviewReports.length} offene Meldungen.`, "success");
	reviewReports.forEach((report) => {
		const itemElement = document.createElement("article");
		itemElement.className = "review-report";
		itemElement.dataset.reportId = String(report.id);
		itemElement.dataset.reportSource = report.report_source || "location_reports";
		itemElement.innerHTML = `
			<button type="button" class="review-report__focus">
				<span class="review-report__name"></span>
				<span class="review-report__meta"></span>
				<span class="review-report__source"></span>
			</button>
			<div class="review-report__actions">
				<button type="button" class="review-report__create">Anlegen</button>
				<button type="button" class="review-report__reject">Verwerfen</button>
			</div>
		`;
		itemElement.querySelector(".review-report__name").textContent = report.name || "Unbenannter Eintrag";
		itemElement.querySelector(".review-report__meta").textContent = `${getReportTypeLabel(report)} · ${formatLocationReportCoordinates(L.latLng(Number(report.lat), Number(report.lng)))}`;
		itemElement.querySelector(".review-report__source").textContent = report.source || "Keine Quelle";
		if (isCommentReport(report)) {
			itemElement.querySelector(".review-report__create").textContent = "Erledigt";
		}
		listElement.appendChild(itemElement);
	});
}

async function sendEditorPresenceHeartbeat() {
	if (!IS_EDIT_MODE) {
		return;
	}

	try {
		const response = await fetch(EDITOR_PRESENCE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ path: window.location.pathname }),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(data?.error || "Online-Status konnte nicht geladen werden.");
		}

		editorPresenceUsers = Array.isArray(data.users) ? data.users : [];
		renderEditorPresenceUsers();
	} catch (error) {
		console.warn("Online-Status konnte nicht aktualisiert werden:", error);
		setPresencePanelStatus(error.message || "Online-Status konnte nicht geladen werden.", "error");
	}
}

function startEditorPresenceHeartbeat() {
	if (!IS_EDIT_MODE || editorPresenceTimerId) {
		return;
	}

	editorPresenceTimerId = window.setInterval(() => {
		void sendEditorPresenceHeartbeat();
	}, 30000);
}

function renderEditorPresenceUsers() {
	const listElement = document.getElementById("presence-user-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (editorPresenceUsers.length < 1) {
		setPresencePanelStatus("Niemand online.", "empty");
		return;
	}

	setPresencePanelStatus(`${editorPresenceUsers.length} Nutzer online.`, "success");
	editorPresenceUsers.forEach((user) => {
		const itemElement = document.createElement("article");
		itemElement.className = "presence-user";
		itemElement.innerHTML = `
			<span class="presence-user__dot" aria-hidden="true"></span>
			<span>
				<span class="presence-user__name"></span>
				<span class="presence-user__meta"></span>
			</span>
		`;
		itemElement.querySelector(".presence-user__name").textContent = user.username || "Editor";
		itemElement.querySelector(".presence-user__meta").textContent = ` ${user.role || ""}`;
		listElement.appendChild(itemElement);
	});
}

function getReportTypeLabel(report) {
	const reportType = report.report_type || "location";
	const reportSubtype = report.report_subtype || report.size || "dorf";
	if (reportType === "location") {
		return LOCATION_TYPE_CONFIG[normalizeLocationType(reportSubtype)]?.singularLabel || "Ort";
	}

	return {
		label: "Label",
		fluss: "Fluss",
		meer: "Meer",
		see: "See",
		region: "Region",
		insel: "Insel",
		gebirge: "Gebirge",
		berggipfel: "Berggipfel",
		wald: "Wald",
		wueste: "Wüste",
		suempfe_moore: "Sümpfe/Moore",
		comment: "Kommentar",
		sonstiges: "Sonstiges",
	}[reportSubtype] || reportSubtype || "Karteneintrag";
}

function isLocationReport(report) {
	return (report.report_type || "location") === "location";
}

function isCommentReport(report) {
	return (report.report_type || "") === "comment" || (report.report_subtype || "") === "comment";
}

function findReviewReportFromElement(element) {
	const reportElement = element?.closest?.(".review-report");
	const reportId = Number(reportElement?.dataset.reportId);
	const reportSource = reportElement?.dataset.reportSource || "location_reports";
	return reviewReports.find((entry) => Number(entry.id) === reportId && (entry.report_source || "location_reports") === reportSource) || null;
}

function clearReviewReportMarker() {
	if (!reviewReportMarker) {
		return;
	}

	map.removeLayer(reviewReportMarker);
	reviewReportMarker = null;
}

function focusReviewReport(report) {
	const latlng = L.latLng(Number(report.lat), Number(report.lng));
	if (!isWithinMapBounds(latlng)) {
		showFeedbackToast("Die gemeldete Position liegt ausserhalb der Karte.", "warning");
		return;
	}

	clearReviewReportMarker();
	reviewReportMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 9,
		color: "#1452F7",
		weight: 3,
		fillColor: "#ffffff",
		fillOpacity: 0.95,
	}).addTo(map);
	reviewReportMarker.bindTooltip(report.name || "Meldung", {
		permanent: true,
		direction: "top",
		className: "review-report-tooltip",
		offset: [0, -10],
	}).openTooltip();

	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
}

function openLocationEditDialogFromReport(report, latlng) {
	openLocationEditDialog({ latlng });
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "location_reports";
	document.getElementById("location-edit-name").value = report.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(report.report_subtype || report.size || "dorf");
	document.getElementById("location-edit-description").value = [report.comment, report.source ? `Quelle: ${report.source}` : ""]
		.filter(Boolean)
		.join("\n\n");
	document.getElementById("location-edit-wiki-url").value = report.wiki_url || "";
}

function openLabelEditDialogFromReport(report, latlng) {
	openLabelEditDialog({ latlng });
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "map_reports";
	document.getElementById("label-edit-text").value = report.name || "";
	document.getElementById("label-edit-type").value = report.report_subtype || "sonstiges";
	document.getElementById("label-edit-size").value = report.report_subtype === "region" ? 22 : 18;
	document.getElementById("label-edit-priority").value = report.report_subtype === "region" ? 4 : 3;
	syncLabelPriorityOutput();
}

async function rejectReviewReport(report) {
	if (!window.confirm(`${report.name || "Meldung"} wirklich verwerfen?`)) {
		return;
	}

	try {
		await updateReviewReportStatus(Number(report.id), "rejected", report.report_source || "location_reports");
		if (activeReviewReportId === Number(report.id) && activeReviewReportSource === (report.report_source || "location_reports")) {
			activeReviewReportId = null;
			activeReviewReportSource = null;
			setLocationEditDialogOpen(false, { resetForm: true });
			setLabelEditDialogOpen(false, { resetForm: true });
		}
		clearReviewReportMarker();
		showFeedbackToast("Meldung verworfen.", "success");
		await loadReviewReports();
	} catch (error) {
		console.error("Meldung konnte nicht verworfen werden:", error);
		showFeedbackToast(error.message || "Meldung konnte nicht verworfen werden.", "warning");
	}
}

async function handleLocationEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = buildLocationEditPayload(formElement);
	if (pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === payload.public_id && !payload.name) {
		payload.name = pendingCrossingConversionName || payload.name;
	}
	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: locationEditMarkerEntry?.location?.name || locationEditMarkerEntry?.name || "",
	});
	if (duplicateLocation) {
		setLocationEditStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}
	setLocationEditStatus("Ort wird gespeichert...", "pending");
	setLocationEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		if (locationEditMarkerEntry) {
			applyFeatureResponseToMarker(locationEditMarkerEntry, result.feature);
		} else {
			addCreatedLocationMarker(result.feature);
		}
		if (payload.action === "create_point" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "location_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		pendingCrossingConversionPublicId = null;
		pendingCrossingConversionName = "";
		pendingCrossingConversionIsNodix = false;
		setLocationEditSubmitPending(false);
		setLocationEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Ort gespeichert.", "success");
	} catch (error) {
		console.error("Ort konnte nicht gespeichert werden:", error);
		setLocationEditStatus(error.message || "Ort konnte nicht gespeichert werden.", "error");
	} finally {
		setLocationEditSubmitPending(false);
	}
}

async function handlePathEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity() || !pathEditFeature) {
		return;
	}

	const payload = buildPathEditPayload(formElement);
	setPathEditStatus("Weg wird gespeichert...", "pending");
	setPathEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		applyPathFeatureResponse(pathEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Weg gespeichert.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

async function handlePowerlineEditFormSubmit(event) {
	event.preventDefault();
	const formElement = getPowerlineEditFormElement();
	if (!formElement || !powerlineEditFeature) {
		return;
	}

	const payload = buildPowerlineEditPayload(formElement);
	if (!payload.public_id || !payload.name) {
		setPowerlineEditStatus("Ein Name fuer die Kraftlinie fehlt.", "error");
		return;
	}

	setPowerlineEditSubmitPending(true);
	setPowerlineEditStatus("Kraftlinie wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		applyPowerlineFeatureResponse(powerlineEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditSubmitPending(false);
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gespeichert.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gespeichert werden:", error);
		setPowerlineEditStatus(error.message || "Kraftlinie konnte nicht gespeichert werden.", "error");
	} finally {
		setPowerlineEditSubmitPending(false);
	}
}

async function handleLabelEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = buildLabelEditPayload(formElement);
	const editedLabelEntry = labelEditEntry;
	const shouldStartMoveAfterSave = pendingLabelMoveAfterEditEntry === editedLabelEntry;
	pendingLabelMoveAfterEditEntry = null;
	setLabelEditStatus("Label wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		let savedLabelEntry = editedLabelEntry;
		if (labelEditEntry) {
			applyLabelFeatureResponse(labelEditEntry, result.feature);
		} else {
			savedLabelEntry = addCreatedLabelFeature(result.feature);
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (payload.action === "create_label" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "map_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		setLabelEditDialogOpen(false, { resetForm: true });
		if (shouldStartMoveAfterSave && savedLabelEntry) {
			setLabelMoveActive(savedLabelEntry, true);
		}
		showFeedbackToast("Label gespeichert.", "success");
	} catch (error) {
		console.error("Label konnte nicht gespeichert werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht gespeichert werden.", "error");
	}
}

async function handleRegionEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity() || !regionEditEntry) return;
	const payload = buildRegionEditPayload(formElement);
	if (!isSqlMapFeatureId(payload.public_id)) {
		setRegionEditStatus("Diese Region hat keine gueltige SQL-ID. Bitte die SQL-Karte neu laden.", "error");
		return;
	}
	try {
		const result = await submitMapFeatureEdit(payload);
		applyRegionFeatureResponse(regionEditEntry, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Region gespeichert.", "success");
	} catch (error) {
		console.error("Region konnte nicht gespeichert werden:", error);
		setRegionEditStatus(error.message || "Region konnte nicht gespeichert werden.", "error");
	}
}

function isSqlMapFeatureId(value) {
	return /^[a-f0-9-]{36}$/i.test(String(value || "").trim());
}

function finalizeLocationReportSubmission({ ok, message }) {
	setLocationReportSubmitPending(false);
	updateLocationReportDialogAvailability();

	if (ok) {
		setLocationReportDialogOpen(false, { resetForm: true });
		showFeedbackToast(message || "Karteneintrag wurde gemeldet.", "success");
		return;
	}

	setLocationReportStatus(message || "Die Meldung konnte nicht gesendet werden.", "error");
}

async function handleLocationReportFormSubmit(event) {
	event.preventDefault();

	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement) {
		return;
	}

	if (!isLocationReportServiceConfigured()) {
		setLocationReportStatus("Das Meldeformular ist noch nicht mit dem Avesmaps-Server verbunden.", "error");
		return;
	}

	if (!locationReportLatLng || !isWithinMapBounds(locationReportLatLng)) {
		setLocationReportStatus("Die ausgewählte Position ist ungültig.", "error");
		return;
	}

	if (!formElement.reportValidity()) {
		return;
	}

	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	const payload = buildLocationReportRequestPayload(formElement);
	if (payload.report_type === "location") {
		const duplicateLocation = findDuplicateLocationByName(payload.name);
		if (duplicateLocation) {
			setLocationReportStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
			return;
		}
	}
	setLocationReportStatus("Meldung wird gesendet...", "pending");
	setLocationReportSubmitPending(true);

	const result = await submitLocationReportRequest(payload);
	finalizeLocationReportSubmission({
		ok: result.ok,
		message: result.message,
	});
}
