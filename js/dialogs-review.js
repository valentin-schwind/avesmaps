const CHANGE_LOG_FOCUS_MARKER_TTL_MS = 12000;

function getLocationReportOverlayElement() {
	return document.getElementById("location-report-overlay");
}

function getLocationReportDialogElement() {
	return document.getElementById("location-report-dialog");
}

function getLocationEditDialogElement() {
	return document.getElementById("location-edit-dialog");
}

function getWikiSyncResolveDialogElement() {
	return document.getElementById("wiki-sync-resolve-dialog");
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

function getWikiSyncResolveFormElement() {
	return document.getElementById("wiki-sync-resolve-form");
}

function getLocationEditStatusElement() {
	return document.getElementById("location-edit-status");
}

function getWikiSyncResolveStatusElement() {
	return document.getElementById("wiki-sync-resolve-status");
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

function getRegionWikiPickerDialogElement() {
	return document.getElementById("region-wiki-picker-dialog");
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

function isWikiSyncResolveDialogOpen() {
	return !$("#wiki-sync-resolve-overlay").prop("hidden");
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

function isRegionWikiPickerDialogOpen() {
	return !$("#region-wiki-picker-overlay").prop("hidden");
}

function isLocationReportServiceConfigured() {
	return Boolean(String(LOCATION_REPORT_FORM_ENDPOINT_URL || "").trim());
}

function syncModalDialogBodyState() {
	const hasOpenModal = !$("#legal-overlay").prop("hidden") || !$("#spotlight-search-overlay").prop("hidden") || !$("#location-report-overlay").prop("hidden") || !$("#location-edit-overlay").prop("hidden") || !$("#wiki-sync-resolve-overlay").prop("hidden") || !$("#path-edit-overlay").prop("hidden") || !$("#powerline-edit-overlay").prop("hidden") || !$("#label-edit-overlay").prop("hidden") || !$("#region-edit-overlay").prop("hidden") || !$("#region-wiki-picker-overlay").prop("hidden");
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

function setWikiSyncResolveStatus(message = "", type = "") {
	const statusElement = getWikiSyncResolveStatusElement();
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

function setWikiSyncResolveSubmitPending(isPending) {
	isWikiSyncResolveSubmissionPending = isPending;

	const formElement = getWikiSyncResolveFormElement();
	if (!formElement) {
		return;
	}

	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	const closeButtonElement = document.getElementById("wiki-sync-resolve-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("wiki-sync-resolve-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Lösen";
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

function resetLocationEditForm({ preserveWikiSyncFlow = false } = {}) {
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
	if (!preserveWikiSyncFlow) {
		resetWikiSyncCreateLocationFlowState();
	}
	void releaseFeatureSoftLock(publicId);
	setLocationEditStatus();
}

function resetWikiSyncResolveForm() {
	const formElement = getWikiSyncResolveFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("wiki-sync-resolve-public-id")?.value || "";
	formElement.reset();
	activeWikiSyncCase = null;
	activeWikiSyncSelectedMap = null;
	activeWikiSyncSelectedWiki = null;
	activeWikiSyncPreset = null;
	document.getElementById("wiki-sync-resolve-case-id").value = "";
	document.getElementById("wiki-sync-resolve-public-id").value = "";
	document.getElementById("wiki-sync-resolve-expected-revision").value = "";
	document.getElementById("wiki-sync-resolve-lat").value = "";
	document.getElementById("wiki-sync-resolve-lng").value = "";
	document.getElementById("wiki-sync-resolve-coordinates").textContent = "-";
	syncWikiSyncResolveLinkButton();
	void releaseFeatureSoftLock(publicId);
	setWikiSyncResolveStatus();
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
	const source = document.getElementById("region-edit-source")?.value || "";
	formElement.reset();
	regionEditEntry = null;
	regionEditTabs = [];
	activeRegionEditTabKey = "";
	regionParentSelectedTreeId = "";
	regionParentCollapsedKeys = new Set();
	regionAssignmentWikiPath = [];
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = "";
	if (source !== "political_territory") {
		void releaseFeatureSoftLock(publicId);
	}
	document.getElementById("region-edit-public-id").value = "";
	document.getElementById("region-edit-source").value = "";
	document.getElementById("region-edit-territory-public-id").value = "";
	document.getElementById("region-edit-geometry-public-id").value = "";
	document.getElementById("region-edit-wiki-id").value = "";
	document.getElementById("region-edit-delete").hidden = true;
	document.getElementById("region-edit-wiki-url").value = "";
	document.getElementById("region-edit-coat-url").value = "";
	syncRegionCoatPreview();
	regionParentFilterQuery = "";
	document.getElementById("region-edit-parent-filter").value = "";
	document.getElementById("region-edit-parent").value = "";
	updateRegionParentDropTarget("");
	document.getElementById("region-edit-parent-tree").innerHTML = "";
	document.getElementById("region-edit-tabs").innerHTML = "";
	document.getElementById("region-edit-wiki-reference-list").innerHTML = "";
	renderRegionAssignment();
	syncRegionOpacityOutput();
	syncRegionValidToControls();
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

function setWikiSyncResolveDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isWikiSyncResolveSubmissionPending) {
		return;
	}

	$("#wiki-sync-resolve-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getWikiSyncResolveDialogElement()?.focus();
		document.getElementById("wiki-sync-resolve-name")?.focus();
		return;
	}

	if (resetForm) {
		resetWikiSyncResolveForm();
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
		const isTreeOnly = document.getElementById("region-edit-form")?.classList.contains("political-territory-tree-form") === true;
		document.getElementById(isTreeOnly ? "region-edit-parent-filter" : "region-edit-name")?.focus();
		return;
	}
	if (resetForm) resetRegionEditForm();
}

function setRegionWikiPickerDialogOpen(isOpen) {
	$("#region-wiki-picker-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen) {
		getRegionWikiPickerDialogElement()?.focus();
		document.getElementById("region-wiki-picker-filter")?.focus();
	}
}

function openLocationReportDialog(latlng) {
	resetLocationReportForm();
	updateLocationReportDialogAvailability();
	populateLocationReportForm(latlng);
	setLocationReportDialogOpen(true);
}

function populateLocationEditForm({ markerEntry = null, latlng = null, presetName = "", presetLocationType = "", presetWikiUrl = "", presetDescription = "", presetIsNodix = null } = {}) {
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
	document.getElementById("location-edit-type").value = normalizeLocationType(presetLocationType || location.locationType || markerEntry?.locationType || "dorf");
	document.getElementById("location-edit-description").value = presetDescription || location.description || "";
	document.getElementById("location-edit-wiki-url").value = presetWikiUrl || location.wikiUrl || wikiLocationLink?.url || "";
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
	resetLocationEditForm({ preserveWikiSyncFlow: true });
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

function syncRegionValidToControls() {
	const validToInput = document.getElementById("region-edit-valid-to");
	const openEndInput = document.getElementById("region-edit-valid-open");
	if (!validToInput || !openEndInput) {
		return;
	}

	const isOpenEnded = openEndInput.type === "checkbox"
		? openEndInput.checked
		: openEndInput.value === "1";
	validToInput.disabled = isOpenEnded;
	if (isOpenEnded) {
		validToInput.value = "";
	}
}

function syncRegionCoatPreview() {
	const inputElement = document.getElementById("region-edit-coat-url");
	const imageElement = document.getElementById("region-edit-coat-preview");
	if (!inputElement || !imageElement) {
		return;
	}

	const url = String(inputElement.value || "").trim();
	imageElement.hidden = url === "";
	imageElement.src = url;
}

function syncRegionTerritoryFieldVisibility(source) {
	const isPoliticalTerritory = source === "political_territory";
	const isTreeOnly = document.getElementById("region-edit-form")?.classList.contains("political-territory-tree-form") === true;
	document.querySelectorAll(".political-territory-field").forEach((element) => {
		element.hidden = isTreeOnly && element.classList.contains("political-territory-tree-panel")
			? false
			: !isPoliticalTerritory;
	});
}

function populateRegionTypeOptions(region) {
	const selectElement = document.getElementById("region-edit-type");
	if (!selectElement) {
		return;
	}

	const currentType = normalizeParentheticalSpacing(region.type || "Herrschaftsgebiet");
	const types = Array.from(new Set([
		currentType,
		"Herrschaftsgebiet",
		...politicalTerritoryOptions.map((territory) => normalizeParentheticalSpacing(territory.type || "")).filter(Boolean),
	])).sort((left, right) => left.localeCompare(right, "de"));

	selectElement.innerHTML = "";
	types.forEach((type) => {
		const option = document.createElement("option");
		option.value = type;
		option.textContent = type;
		selectElement.append(option);
	});
	selectElement.value = currentType;
}

function normalizeSearchText(value) {
	return String(value || "")
		.toLocaleLowerCase("de")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();
}

function normalizeParentheticalSpacing(value) {
	return String(value || "").replace(/([^\s])\(/gu, "$1 (");
}

function populateRegionParentSelect(region) {
	const inputElement = document.getElementById("region-edit-parent");
	const treeElement = document.getElementById("region-edit-parent-tree");
	if (!inputElement || !treeElement) {
		return;
	}

	inputElement.value = region.parentPublicId || "";
	treeElement.innerHTML = "";
	if (politicalTerritoryOptionsLoading && politicalTerritoryOptionsSource !== "wiki") {
		const loadingElement = document.createElement("p");
		loadingElement.className = "political-territory-parent-tree__empty";
		loadingElement.textContent = "Hierarchie wird geladen...";
		treeElement.append(loadingElement);
		return;
	}

	const tree = buildPoliticalTerritoryTree(region.territoryPublicId || "");
	tree.forEach((node) => {
		const renderedNode = renderPoliticalTerritoryTreeNode(node, region, 0);
		if (renderedNode) {
			treeElement.append(renderedNode);
		}
	});
	if (treeElement.childElementCount === 0) {
		const emptyElement = document.createElement("p");
		emptyElement.className = "political-territory-parent-tree__empty";
		emptyElement.textContent = regionParentFilterQuery !== "" ? "Keine Treffer" : "Keine Hierarchie geladen";
		treeElement.append(emptyElement);
	}
}

function buildPoliticalTerritoryTree(excludedPublicId) {
	if (Array.isArray(politicalTerritoryHierarchy) && politicalTerritoryHierarchy.length > 0) {
		return politicalTerritoryHierarchy
			.map((node) => clonePoliticalTerritoryHierarchyNode(node))
			.filter(Boolean);
	}

	const byId = new Map();
	politicalTerritoryOptions
		.forEach((territory) => {
			byId.set(territory.public_id, {
				key: `territory:${territory.public_id}`,
				territory,
				children: [],
				isGroup: false,
			});
		});

	const territoryRoots = [];
	byId.forEach((node) => {
		const parentId = node.territory.parent_public_id || "";
		const parent = byId.get(parentId);
		if (parent) {
			parent.children.push(node);
			return;
		}

		territoryRoots.push(node);
	});

	const sortNodes = (nodes) => {
		nodes.sort((left, right) => String(left.territory.name || "").localeCompare(String(right.territory.name || ""), "de"));
		nodes.forEach((node) => sortNodes(node.children));
	};
	sortNodes(territoryRoots);
	return territoryRoots;
}

function clonePoliticalTerritoryHierarchyNode(node) {
	if (!node || typeof node !== "object") {
		return null;
	}

	const isGroup = node.is_group === true || node.isGroup === true;
	const children = Array.isArray(node.children) ? node.children.map((child) => clonePoliticalTerritoryHierarchyNode(child)).filter(Boolean) : [];
	const territory = {
		public_id: node.public_id || "",
		name: node.name || "",
		short_name: node.short_name || "",
		type: node.type || "",
		status: node.status || "",
		form_of_government: node.form_of_government || "",
		valid_label: node.valid_label || "",
		parent_public_id: node.parent_public_id || "",
		parent_name: node.parent_name || "",
		wiki_name: node.wiki_name || "",
		wiki_affiliation_raw: node.wiki_affiliation_raw || "",
		wiki_affiliation_root: node.wiki_affiliation_root || "",
		wiki_url: node.wiki_url || "",
		capital_name: node.capital_name || "",
		seat_name: node.seat_name || "",
		ruler: node.ruler || "",
		founder: node.founder || "",
		language: node.language || "",
		currency: node.currency || "",
		trade_goods: node.trade_goods || "",
		population: node.population || "",
		founded_text: node.founded_text || "",
		dissolved_text: node.dissolved_text || "",
		coat_of_arms_url: node.coat_of_arms_url || "",
		aliases: Array.isArray(node.aliases) ? node.aliases : [],
	};
	const option = territory.public_id ? findPoliticalTerritoryOption(territory.public_id) : null;
	let mergedTerritory = option ? { ...option, ...territory } : territory;
	if (isGroup && !mergedTerritory.public_id) {
		const representative = findRepresentativePoliticalTerritoryNode({
			territory: mergedTerritory,
			children,
		});
		if (representative?.territory?.public_id) {
			mergedTerritory = {
				...representative.territory,
				name: territory.name || representative.territory.name || "",
				short_name: territory.short_name || representative.territory.short_name || "",
				wiki_name: territory.wiki_name || representative.territory.wiki_name || "",
				wiki_affiliation_root: territory.wiki_affiliation_root || representative.territory.wiki_affiliation_root || "",
				aliases: Array.from(new Set([
					...(Array.isArray(territory.aliases) ? territory.aliases : []),
					...(Array.isArray(representative.territory.aliases) ? representative.territory.aliases : []),
				])),
			};
		}
	}
	return {
		key: `territory:${mergedTerritory.public_id || mergedTerritory.name}`,
		territory: mergedTerritory,
		children,
		isGroup,
	};
}

function findRepresentativePoliticalTerritoryNode(node) {
	if (!node || typeof node !== "object") {
		return null;
	}

	const rootName = normalizeSearchText(node.territory?.name || "");
	let bestNode = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	const visit = (currentNode) => {
		if (!currentNode || typeof currentNode !== "object") {
			return 0;
		}

		let descendantCount = 0;
		for (const child of Array.isArray(currentNode.children) ? currentNode.children : []) {
			descendantCount += visit(child);
		}

		const territory = currentNode.territory || {};
		const publicId = String(territory.public_id || "").trim();
		if (publicId) {
			let score = descendantCount * 100;
			const aliases = [
				territory.name,
				territory.short_name,
				territory.wiki_name,
				...(Array.isArray(territory.aliases) ? territory.aliases : []),
			].map((value) => normalizeSearchText(value)).filter(Boolean);
			for (const alias of aliases) {
				if (!rootName || !alias) {
					continue;
				}
				if (alias === rootName) {
					score += 1000000;
					break;
				}
				if (alias.includes(rootName) || rootName.includes(alias)) {
					score += 100000 - Math.abs(alias.length - rootName.length);
				}
			}

			if (score > bestScore) {
				bestScore = score;
				bestNode = currentNode;
			}
			descendantCount += 1;
		}

		return descendantCount;
	};

	visit(node);
	return bestNode;
}

function renderPoliticalTerritoryTreeNode(node, region, depth) {
	if (!doesPoliticalTerritoryTreeNodeMatchFilter(node)) {
		return null;
	}

	const wrapper = document.createElement("div");
	wrapper.className = node.isGroup
		? "political-territory-parent-tree__node political-territory-parent-tree__node--group"
		: "political-territory-parent-tree__node";
	wrapper.style.setProperty("--territory-tree-depth", String(Math.min(depth, 8)));
	const hasChildren = node.children.length > 0;
	const button = createRegionParentTreeButton(node.territory, region, { isGroup: node.isGroup, hasChildren });
	if (hasChildren) {
		button.dataset.regionTreeToggle = node.key;
		const isNodeCollapsed = isPoliticalTerritoryTreeNodeCollapsed(node);
		button.classList.toggle("is-collapsed", isNodeCollapsed);
		button.setAttribute("aria-expanded", isNodeCollapsed ? "false" : "true");
	}
	wrapper.append(button);
	const isCollapsed = isPoliticalTerritoryTreeNodeCollapsed(node);
	if (node.children.length > 0 && depth < 12 && !isCollapsed) {
		const childrenElement = document.createElement("div");
		childrenElement.className = "political-territory-parent-tree__children";
		node.children.forEach((child) => {
			const renderedChild = renderPoliticalTerritoryTreeNode(child, region, depth + 1);
			if (renderedChild) {
				childrenElement.append(renderedChild);
			}
		});
		if (childrenElement.childElementCount > 0) {
			wrapper.append(childrenElement);
		}
	}

	return wrapper;
}

function isPoliticalTerritoryTreeNodeCollapsed(node) {
	return regionParentFilterQuery === "" && node.children.length > 0 && !regionParentCollapsedKeys.has(node.key);
}

function doesPoliticalTerritoryTreeNodeMatchFilter(node) {
	const query = normalizeSearchText(regionParentFilterQuery);
	if (query === "") {
		return true;
	}

	return getPoliticalTerritoryTreeSearchText(node.territory).includes(query)
		|| node.children.some((child) => doesPoliticalTerritoryTreeNodeMatchFilter(child));
}

function getPoliticalTerritoryTreeSearchText(territory) {
	return normalizeSearchText([
		territory.name,
		territory.short_name,
		territory.type,
		territory.status,
		territory.form_of_government,
		territory.valid_label,
		territory.wiki_name,
		territory.wiki_affiliation_root,
		territory.wiki_affiliation_raw,
		territory.parent_name,
		territory.capital_name,
		territory.seat_name,
		territory.ruler,
		...(Array.isArray(territory.aliases) ? territory.aliases : []),
	].filter(Boolean).join(" "));
}

function createRegionParentTreeButton(territory, region, { isGroup = false, hasChildren = false } = {}) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "political-territory-parent-tree__item";
	button.dataset.regionParentId = territory.public_id || "";
	button.dataset.regionTerritoryId = territory.public_id || "";
	button.setAttribute("role", "treeitem");
	if (isGroup) {
		button.dataset.regionTreeGroup = "1";
	}
	button.dataset.regionTreeLeaf = hasChildren ? "0" : "1";
	button.draggable = Boolean(territory.public_id) && !hasChildren;
	button.classList.toggle("is-selected", Boolean(territory.public_id) && territory.public_id === regionParentSelectedTreeId);
	button.innerHTML = `
		<span class="political-territory-parent-tree__toggle" aria-hidden="true"></span>
		<span class="political-territory-parent-tree__name"></span>
		<span class="political-territory-parent-tree__meta"></span>
		<span class="political-territory-parent-tree__summary"></span>
	`;
	button.querySelector(".political-territory-parent-tree__name").textContent = normalizeParentheticalSpacing(territory.name || "Kein Parent");
	button.querySelector(".political-territory-parent-tree__meta").textContent = normalizeParentheticalSpacing([
		territory.type,
		territory.status,
	].filter(Boolean).join(" · "));
	button.querySelector(".political-territory-parent-tree__summary").textContent = normalizeParentheticalSpacing([
		territory.valid_label,
		territory.capital_name ? `Hauptstadt: ${territory.capital_name}` : "",
		territory.ruler ? `Oberhaupt: ${territory.ruler}` : "",
	].filter(Boolean).join(" · "));
	return button;
}

function renderRegionWikiReference(region) {
	const listElement = document.getElementById("region-edit-wiki-reference-list");
	if (!listElement) {
		return;
	}

	const wikiName = region.wikiName || region.wiki_name || region.name || "";
	const wikiUrl = region.wikiUrl || region.wiki_url || "";
	const rows = [
		["Name", wikiName],
		["Typ", region.wikiType || region.wiki_type || region.type],
		["Zeitraum", region.validLabel || region.valid_label || buildWikiReferencePeriod(region)],
		["Zugehoerigkeit", region.wikiAffiliationRaw || region.wiki_affiliation_raw || region.affiliation],
		["Wurzel", region.wikiAffiliationRoot || region.wiki_affiliation_root || region.affiliationRoot],
		["Hauptstadt", region.feature?.properties?.capital_name || region.wikiCapitalName || region.wiki_capital_name || ""],
		["Herrschaftssitz", region.feature?.properties?.seat_name || region.wikiSeatName || region.wiki_seat_name || ""],
		["Wiki", wikiUrl],
	].filter(([, value]) => String(value || "").trim() !== "");
	listElement.innerHTML = rows.map(([label, value]) => {
		const displayValue = normalizeParentheticalSpacing(value);
		const valueMarkup = label === "Wiki"
			? `<a href="${escapeHtml(displayValue)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayValue)}</a>`
			: escapeHtml(displayValue);
		return `<dt>${escapeHtml(label)}</dt><dd>${valueMarkup}</dd>`;
	}).join("");
}

function buildWikiReferencePeriod(region) {
	return [region.wikiFoundedText || region.wiki_founded_text || "", region.wikiDissolvedText || region.wiki_dissolved_text || ""]
		.filter(Boolean)
		.join(" - ");
}

function clonePoliticalTerritoryPathNode(node) {
	return {
		territory: {
			...(node?.territory || {}),
		},
	};
}

function clonePoliticalTerritoryPath(path) {
	return Array.isArray(path) ? path.map((node) => clonePoliticalTerritoryPathNode(node)) : [];
}

function clonePoliticalTerritoryChain(chain) {
	return Array.isArray(chain)
		? chain.map((node) => ({
			...node,
			territory: node?.territory ? { ...node.territory } : node?.territory || null,
			wiki: node?.wiki ? { ...node.wiki } : node?.wiki || null,
		}))
		: [];
}

function storeRegionAssignmentBreadcrumbCache(territoryPublicId, path, ensuredChain = [], activeWikiPublicId = "") {
	const cacheKey = String(territoryPublicId || "").trim();
	if (!cacheKey) {
		return;
	}

	regionAssignmentBreadcrumbCache.set(cacheKey, {
		path: clonePoliticalTerritoryPath(path),
		ensuredChain: clonePoliticalTerritoryChain(ensuredChain),
		activeWikiPublicId: String(activeWikiPublicId || "").trim(),
	});
}

function restoreRegionAssignmentBreadcrumbCache(territoryPublicId) {
	const cacheKey = String(territoryPublicId || "").trim();
	if (!cacheKey || !regionAssignmentBreadcrumbCache.has(cacheKey)) {
		return false;
	}

	const snapshot = regionAssignmentBreadcrumbCache.get(cacheKey) || {};
	regionAssignmentWikiPath = clonePoliticalTerritoryPath(snapshot.path);
	regionAssignmentEnsuredChain = clonePoliticalTerritoryChain(snapshot.ensuredChain);
	const lastBreadcrumbNode = regionAssignmentWikiPath.length > 0 ? regionAssignmentWikiPath[regionAssignmentWikiPath.length - 1] : null;
	regionAssignmentActiveWikiPublicId = String(snapshot.activeWikiPublicId || lastBreadcrumbNode?.territory?.public_id || "").trim();
	return regionAssignmentWikiPath.length > 0;
}

function getRegionEditTabKey(region) {
	return region.territoryPublicId || region.publicId || region.geometryPublicId || "";
}

function initializeRegionEditTabs(entry) {
	const region = entry?.region || entry || {};
	if ((region.source || "") !== "political_territory") {
		regionEditTabs = [];
		activeRegionEditTabKey = "";
		renderRegionEditTabs();
		return;
	}

	const key = getRegionEditTabKey(region);
	const savedPayload = regionEditPayloadToPayload(region);
	regionEditTabs = key ? [{
		key,
		entry,
		region: { ...region },
		payload: null,
		savedPayload,
	}] : [];
	activeRegionEditTabKey = key;
	renderRegionEditTabs();
}

function getPrimaryRegionGeometryPublicId() {
	return regionEditTabs[0]?.region?.geometryPublicId || regionEditTabs[0]?.region?.publicId || regionEditEntry?.region?.geometryPublicId || regionEditEntry?.geometryPublicId || regionEditEntry?.publicId || "";
}

function renderRegionEditTabs() {
	const tabsElement = document.getElementById("region-edit-tabs");
	if (!tabsElement) {
		return;
	}

	tabsElement.innerHTML = "";
	regionEditTabs.forEach((tab, index) => {
		const tabElement = document.createElement("span");
		tabElement.className = "political-territory-tabs__entry";
		tabElement.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "political-territory-tabs__tab";
		button.dataset.regionEditTab = tab.key;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", tab.key === activeRegionEditTabKey ? "true" : "false");
		button.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		button.textContent = tab.region.shortName || tab.region.displayName || tab.region.name || "Herrschaftsgebiet";
		tabElement.append(button);
		if (index > 0) {
			const closeButton = document.createElement("button");
			closeButton.type = "button";
			closeButton.className = "political-territory-tabs__close";
			closeButton.dataset.regionEditTabClose = tab.key;
			closeButton.setAttribute("aria-label", "Tab schliessen");
			closeButton.textContent = "x";
			tabElement.append(closeButton);
		}
		tabsElement.append(tabElement);
	});
}

function findRegionEditTab(key) {
	return regionEditTabs.find((tab) => tab.key === key) || null;
}

function findPoliticalTerritoryOption(publicId) {
	return politicalTerritoryOptions.find((territory) => territory.public_id === publicId) || null;
}

function updateRegionParentDropTarget(parentPublicId) {
	const inputElement = document.getElementById("region-edit-parent");
	const labelElement = document.getElementById("region-edit-parent-drop-label");
	const dropElement = document.getElementById("region-edit-parent-drop");
	const normalizedParentId = String(parentPublicId || "").trim();
	if (inputElement) {
		inputElement.value = normalizedParentId;
	}
	if (!labelElement || !dropElement) {
		return;
	}

	const parent = normalizedParentId ? findPoliticalTerritoryOption(normalizedParentId) : null;
	labelElement.textContent = parent
		? normalizeParentheticalSpacing([
			parent.name,
			parent.type,
			parent.valid_label,
		].filter(Boolean).join(" - "))
		: "Kein Parent";
	dropElement.classList.toggle("has-parent", Boolean(parent));
}

function findPoliticalTerritoryTreePath(publicId) {
	const normalizedPublicId = String(publicId || "").trim();
	if (!normalizedPublicId) {
		return [];
	}

	const visit = (node, path) => {
		if (!node) {
			return null;
		}

		const currentPath = [...path, node];
		if ((node.territory?.public_id || "") === normalizedPublicId) {
			return currentPath;
		}

		for (const child of node.children || []) {
			const result = visit(child, currentPath);
			if (result) {
				return result;
			}
		}

		return null;
	};

	for (const node of buildPoliticalTerritoryTree("")) {
		const result = visit(node, []);
		if (result) {
			return result;
		}
	}

	return [];
}

function renderRegionAssignment(path = regionAssignmentWikiPath, ensuredChain = regionAssignmentEnsuredChain, activeWikiPublicId = regionAssignmentActiveWikiPublicId) {
	const dropElement = document.getElementById("region-edit-assignment-drop");
	const labelElement = document.getElementById("region-edit-assignment-drop-label");
	const breadcrumbElement = document.getElementById("region-edit-assignment-breadcrumb");
	const summaryElement = document.getElementById("region-edit-assignment-summary");
	const selectedNode = path[path.length - 1] || null;
	const activeId = String(activeWikiPublicId || selectedNode?.territory?.public_id || "").trim();
	const activeIndex = path.findIndex((node) => (node.territory?.public_id || "") === activeId);
	const activeWiki = activeIndex >= 0 ? ensuredChain[activeIndex]?.wiki || path[activeIndex]?.territory || null : ensuredChain[ensuredChain.length - 1]?.wiki || selectedNode?.territory || null;
	if (labelElement) {
		labelElement.textContent = selectedNode
			? `Zugewiesen: ${selectedNode.territory?.name || "Herrschaftsgebiet"}`
			: "Untersten Knoten hierher ziehen, um die Geometrie zuzuweisen";
	}
	dropElement?.classList.toggle("has-assignment", Boolean(selectedNode));
	if (breadcrumbElement) {
		breadcrumbElement.innerHTML = "";
		path.forEach((node, index) => {
			const wiki = ensuredChain[index]?.wiki || node.territory || {};
			const wikiName = wiki.name || wiki.wiki_name || node.territory?.name || "Herrschaftsgebiet";
			const wikiType = normalizeParentheticalSpacing([wiki.type || "", wiki.status || ""].filter(Boolean).join(" · "));
			const wikiPeriod = normalizeParentheticalSpacing(wiki.valid_label || buildWikiReferencePeriod(wiki));
			const wikiSummary = [
				wiki.ruler ? `Oberhaupt: ${wiki.ruler}` : "",
				wiki.capital_name ? `Hauptstadt: ${wiki.capital_name}` : "",
				wiki.seat_name ? `Sitz: ${wiki.seat_name}` : "",
			].filter(Boolean).join(" · ");
			const wikiDetails = [
				wiki.language ? `Sprache: ${wiki.language}` : "",
				wiki.currency ? `Waehrung: ${wiki.currency}` : "",
				wiki.trade_goods ? `Handelswaren: ${wiki.trade_goods}` : "",
				wiki.population ? `Einwohner: ${wiki.population}` : "",
				wikiPeriod ? `Gr./Aufl.: ${wikiPeriod}` : "",
			].filter(Boolean).join(" · ");
			const coatUrl = wiki.coat_of_arms_url || "";
			const button = document.createElement("button");
			button.type = "button";
			button.className = "political-territory-assignment-breadcrumb__item";
			button.classList.toggle("is-active", (node.territory?.public_id || "") === activeId);
			button.dataset.regionAssignmentBreadcrumbId = node.territory?.public_id || "";
			button.innerHTML = `
				${coatUrl ? `<img class="political-territory-assignment-breadcrumb__coat" src="${escapeHtml(coatUrl)}" alt="">` : '<span class="political-territory-assignment-breadcrumb__coat" aria-hidden="true"></span>'}
				<span class="political-territory-assignment-breadcrumb__name"></span>
				<span class="political-territory-assignment-breadcrumb__meta"></span>
				<span class="political-territory-assignment-breadcrumb__summary"></span>
				<span class="political-territory-assignment-breadcrumb__wiki"></span>
			`;
			button.querySelector(".political-territory-assignment-breadcrumb__name").textContent = wikiName;
			button.querySelector(".political-territory-assignment-breadcrumb__meta").textContent = wikiType || "Herrschaftsgebiet";
			button.querySelector(".political-territory-assignment-breadcrumb__summary").textContent = [wikiPeriod, wikiSummary].filter(Boolean).join(" · ") || "Wiki-Daten";
			button.querySelector(".political-territory-assignment-breadcrumb__wiki").textContent = wikiDetails || "Wiki-Daten";
			breadcrumbElement.append(button);
		});
	}
	renderRegionAssignmentSummary(summaryElement, activeWiki || selectedNode?.territory || null);
}

function renderRegionAssignmentSummary(summaryElement, wiki) {
	if (!summaryElement) {
		return;
	}
	if (!wiki) {
		summaryElement.hidden = true;
		summaryElement.innerHTML = "";
		return;
	}

	const rows = [
		["Name", wiki.name || wiki.wiki_name || ""],
		["Typ", wiki.type || ""],
		["Status", wiki.status || ""],
		["Oberhaupt", wiki.ruler || ""],
		["Gruender", wiki.founder || ""],
		["Hauptstadt", wiki.capital_name || ""],
		["Herrschaftssitz", wiki.seat_name || ""],
		["Sprache", wiki.language || ""],
		["Waehrung", wiki.currency || ""],
		["Handelswaren", wiki.trade_goods || ""],
		["Einwohner", wiki.population || ""],
		["Gruendung", wiki.founded_text || ""],
		["Aufloesung", wiki.dissolved_text || ""],
		["Wiki-Link", wiki.wiki_url || ""],
	].filter(([, value]) => String(value || "").trim() !== "");
	const coatUrl = wiki.coat_of_arms_url || "";
	const wikiUrl = wiki.wiki_url || "";
	summaryElement.hidden = false;
	summaryElement.innerHTML = `
		${coatUrl ? `<img src="${escapeHtml(coatUrl)}" alt="">` : "<span></span>"}
		<dl>${rows.map(([label, value]) => {
			if (label === "Wiki-Link" && wikiUrl) {
				return `<dt>${escapeHtml(label)}</dt><dd><a href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(wikiUrl)}</a></dd>`;
			}

			return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
		}).join("")}</dl>
	`;
}

function arePoliticalTerritoryPathsEqual(leftPath, rightPath) {
	if (!Array.isArray(leftPath) || !Array.isArray(rightPath) || leftPath.length !== rightPath.length) {
		return false;
	}

	return leftPath.every((node, index) => {
		const leftId = node?.territory?.public_id || "";
		const rightId = rightPath[index]?.territory?.public_id || "";
		return leftId === rightId;
	});
}

function syncRegionAssignmentForRegion(region) {
	const source = region?.source || "map_feature";
	const territoryPublicId = region?.territoryPublicId || region?.publicId || "";
	if (source !== "political_territory" || !territoryPublicId) {
		regionAssignmentWikiPath = [];
		regionAssignmentEnsuredChain = [];
		regionAssignmentActiveWikiPublicId = "";
		renderRegionAssignment();
		return;
	}

	const currentPathContainsTerritory = regionAssignmentWikiPath.some((node) => (node.territory?.public_id || "") === territoryPublicId);
	if (regionAssignmentWikiPath.length < 1 || !currentPathContainsTerritory) {
		if (restoreRegionAssignmentBreadcrumbCache(territoryPublicId)) {
			renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
			return;
		}
	}

	if (regionAssignmentWikiPath.length > 0 && currentPathContainsTerritory) {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	const path = findPoliticalTerritoryTreePath(territoryPublicId);
	if (path.length > 0) {
		if (regionAssignmentWikiPath.length < 1 || (!currentPathContainsTerritory && !arePoliticalTerritoryPathsEqual(regionAssignmentWikiPath, path))) {
			regionAssignmentWikiPath = path;
			regionAssignmentEnsuredChain = [];
		}
		regionAssignmentActiveWikiPublicId = territoryPublicId;
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
}

async function ensurePoliticalTerritoryChainFromWikiPath(path) {
	const wikiPublicIds = path.map((node) => node.territory?.public_id || "").filter(Boolean);
	if (wikiPublicIds.length < 1) {
		throw new Error("Die Wiki-Hierarchie fehlt.");
	}

	const response = await submitPoliticalTerritoryEdit({
		action: "ensure_wiki_territory_chain",
		wiki_public_ids: wikiPublicIds,
		wiki_nodes: path.map((node) => node.territory || {}),
	});
	regionAssignmentEnsuredChain = Array.isArray(response.chain) ? response.chain : [];
	return response;
}

async function assignRegionGeometryToWikiTreeLeaf(wikiPublicId) {
	const path = findPoliticalTerritoryTreePath(wikiPublicId);
	const selectedNode = path[path.length - 1] || null;
	if (!selectedNode || (selectedNode.children || []).length > 0) {
		setRegionEditStatus("Bitte den untersten Knoten der Hierarchie auswaehlen.", "error");
		return;
	}

	regionAssignmentWikiPath = path;
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = wikiPublicId;
	storeRegionAssignmentBreadcrumbCache(wikiPublicId, path, [], wikiPublicId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	setRegionEditStatus("Wiki-Hierarchie wird dem Gebiet zugewiesen...", "pending");
	const response = await ensurePoliticalTerritoryChainFromWikiPath(path);
	const selectedTerritoryId = response.selected?.territory?.public_id || "";
	if (!selectedTerritoryId) {
		throw new Error("Das Herrschaftsgebiet konnte nicht aus dem Wiki-Knoten erzeugt werden.");
	}

	storeRegionAssignmentBreadcrumbCache(selectedTerritoryId, path, response.chain || [], wikiPublicId);
	await activatePrimaryRegionEditTabForTerritory(selectedTerritoryId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern uebernimmt die Geometrie dauerhaft.", "success");
}

async function openRegionVisualTabFromBreadcrumb(wikiPublicId) {
	if (!wikiPublicId) {
		return;
	}

	regionAssignmentActiveWikiPublicId = wikiPublicId;
	await openRegionEditTabForTerritory(wikiPublicId, { assignGeometry: false });
	if (regionAssignmentWikiPath.length > 0) {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	}
}

function snapshotActiveRegionEditTab() {
	if (!activeRegionEditTabKey) {
		return;
	}

	const formElement = getRegionEditFormElement();
	const tab = findRegionEditTab(activeRegionEditTabKey);
	if (!formElement || !tab) {
		return;
	}

	const payload = buildRegionEditPayload(formElement);
	tab.payload = payload;
	tab.region = regionEditPayloadToRegion(payload, tab.region || regionEditEntry?.region || regionEditEntry || {});
	tab.entry = regionEditEntry || tab.entry;
	renderRegionEditTabs();
}

function regionEditPayloadToRegion(payload, fallback = {}) {
	const readOptionalNumber = (value) => {
		const text = String(value ?? "").trim();
		if (text === "") {
			return null;
		}

		const number = Number.parseInt(text, 10);
		return Number.isFinite(number) ? number : null;
	};

	return {
		...fallback,
		source: payload.source || fallback.source || "political_territory",
		publicId: fallback.publicId || payload.public_id || "",
		geometryPublicId: payload.geometry_public_id || fallback.geometryPublicId || "",
		territoryPublicId: payload.territory_public_id || fallback.territoryPublicId || "",
		wikiId: payload.wiki_id || fallback.wikiId || null,
		name: payload.name || fallback.name || "",
		displayName: payload.name || fallback.displayName || fallback.name || "",
		shortName: payload.short_name || "",
		type: payload.type || "",
		parentPublicId: payload.parent_public_id || "",
		color: payload.color || fallback.color || "#888888",
		opacity: Number.isFinite(Number(payload.opacity)) ? Number(payload.opacity) : fallback.opacity ?? 0.33,
		wikiUrl: payload.wiki_url || "",
		coatOfArmsUrl: payload.coat_of_arms_url || "",
		minZoom: readOptionalNumber(payload.min_zoom),
		maxZoom: readOptionalNumber(payload.max_zoom),
		validFromBf: readOptionalNumber(payload.valid_from_bf),
		validToBf: payload.valid_to_open ? null : readOptionalNumber(payload.valid_to_bf),
		validLabel: payload.valid_label || "",
		isActive: payload.is_active !== false,
		editorNotes: payload.editor_notes || "",
	};
}

function regionEditPayloadToPayload(region) {
	if (!region) {
		return null;
	}

	return {
		action: "update_territory",
		source: "political_territory",
		public_id: region.geometryPublicId || "",
		geometry_public_id: region.geometryPublicId || "",
		territory_public_id: region.territoryPublicId || region.publicId || "",
		wiki_id: region.wikiId || "",
		name: region.displayName || region.name || "",
		short_name: region.shortName || "",
		type: region.type || "",
		parent_public_id: region.parentPublicId || "",
		color: region.color || "#888888",
		opacity: Number.isFinite(Number(region.opacity)) ? Number(region.opacity) : 0.33,
		wiki_url: region.wikiUrl || "",
		coat_of_arms_url: region.coatOfArmsUrl || "",
		min_zoom: region.minZoom ?? "",
		max_zoom: region.maxZoom ?? "",
		valid_from_bf: region.validFromBf ?? "",
		valid_to_bf: region.validToBf ?? "",
		valid_to_open: region.validToBf === null || region.validToBf === undefined,
		valid_label: region.validLabel || "",
		is_active: region.isActive !== false,
		editor_notes: region.editorNotes || "",
	};
}

function getComparableRegionEditPayload(payload) {
	const copy = { ...payload };
	delete copy.action;
	delete copy.source;
	delete copy.public_id;
	delete copy.geometry_public_id;
	Object.keys(copy).forEach((key) => {
		if (copy[key] === undefined || copy[key] === null) {
			copy[key] = "";
		}
	});
	return copy;
}

function areRegionEditPayloadsEqual(leftPayload, rightPayload) {
	return JSON.stringify(getComparableRegionEditPayload(leftPayload || {})) === JSON.stringify(getComparableRegionEditPayload(rightPayload || {}));
}

function isRegionEditTabDirty(tab) {
	if (!tab) {
		return false;
	}

	return !areRegionEditPayloadsEqual(tab.payload || regionEditPayloadToPayload(tab.region), tab.savedPayload || regionEditPayloadToPayload(tab.region));
}

function getActiveRegionGeometryAssignment(territoryPublicId) {
	const primaryTab = regionEditTabs[0] || null;
	const geometryPublicId = primaryTab?.region?.geometryPublicId || primaryTab?.region?.publicId || "";
	if (!geometryPublicId || !territoryPublicId || primaryTab?.region?.territoryPublicId === territoryPublicId) {
		return null;
	}

	if (regionEditTabs.some((tab) => tab.assignGeometryPublicId === geometryPublicId)) {
		return null;
	}

	return {
		geometryPublicId,
		mode: primaryTab?.entry?.source === "political_territory" ? "reassign" : "create",
	};
}

async function saveRegionEditTab(tab) {
	if (!tab) {
		return null;
	}

	const payload = tab.payload || regionEditPayloadToPayload(tab.region);
	const result = await submitPoliticalTerritoryEdit(payload);
	let latestResult = result;
	if (result.feature) {
		applyRegionFeatureResponse(tab.entry || regionEditEntry, result.feature);
	}
	if (result.territory) {
		tab.region = normalizePoliticalTerritoryForRegionEdit(result.territory);
	}
	if (tab.assignGeometryPublicId && payload.territory_public_id) {
		latestResult = tab.assignGeometryMode === "create"
			? await submitPoliticalTerritoryEdit({
				action: "create_geometry",
				territory_public_id: payload.territory_public_id,
				source: "editor",
				geometry_geojson: regionLayerToGeoJsonGeometry(tab.entry || regionEditEntry),
				valid_from_bf: payload.valid_from_bf,
				valid_to_bf: payload.valid_to_bf,
				valid_to_open: payload.valid_to_open,
				min_zoom: payload.min_zoom,
				max_zoom: payload.max_zoom,
				style_json: {
					fill: payload.color,
					stroke: payload.color,
					fillOpacity: payload.opacity,
				},
			})
			: await submitPoliticalTerritoryEdit({
				action: "assign_geometry",
				geometry_public_id: tab.assignGeometryPublicId,
				territory_public_id: payload.territory_public_id,
			});
		if (latestResult.feature) {
			if ((tab.entry || regionEditEntry)?.source === "political_territory") {
				applyRegionFeatureResponse(tab.entry || regionEditEntry, latestResult.feature);
			}
		}
		tab.region.geometryPublicId = latestResult.geometry?.public_id || tab.assignGeometryPublicId;
		tab.assignGeometryPublicId = "";
		tab.assignGeometryMode = "";
	}
	tab.savedPayload = getComparableRegionEditPayload(payload);
	tab.payload = null;
	const territoryPublicId = String(tab.region?.territoryPublicId || payload.territory_public_id || "").trim();
	const lastBreadcrumbNode = regionAssignmentWikiPath.length > 0 ? regionAssignmentWikiPath[regionAssignmentWikiPath.length - 1] : null;
	const activeBreadcrumbLeafId = String(lastBreadcrumbNode?.territory?.public_id || "").trim();
	if (territoryPublicId && territoryPublicId === activeBreadcrumbLeafId && regionAssignmentWikiPath.length > 0) {
		storeRegionAssignmentBreadcrumbCache(territoryPublicId, regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	}
	return latestResult;
}

function normalizePoliticalTerritoryForRegionEdit(territory, wiki = null) {
	return {
		source: "political_territory",
		publicId: territory.public_id || "",
		geometryPublicId: "",
		territoryPublicId: territory.public_id || "",
		wikiId: territory.wiki_id || wiki?.id || null,
		name: normalizeParentheticalSpacing(territory.name || ""),
		displayName: normalizeParentheticalSpacing(territory.name || ""),
		shortName: territory.short_name || "",
		type: normalizeParentheticalSpacing(territory.type || wiki?.type || "Herrschaftsgebiet"),
		parentPublicId: territory.parent_public_id || "",
		parentName: territory.parent_name || "",
		color: territory.color || "#888888",
		opacity: territory.opacity ?? 0.33,
		wikiUrl: territory.wiki_url || wiki?.wiki_url || "",
		coatOfArmsUrl: territory.coat_of_arms_url || wiki?.coat_of_arms_url || "",
		minZoom: territory.min_zoom ?? null,
		maxZoom: territory.max_zoom ?? null,
		validFromBf: territory.valid_from_bf ?? null,
		validToBf: territory.valid_to_bf ?? null,
		validLabel: territory.valid_label || "",
		isActive: territory.is_active !== false,
		editorNotes: territory.editor_notes || "",
		wikiName: territory.wiki_name || wiki?.name || "",
		wikiType: normalizeParentheticalSpacing(territory.wiki_type || wiki?.type || territory.type || ""),
		wikiAffiliationRaw: territory.wiki_affiliation_raw || wiki?.affiliation_raw || "",
		wikiAffiliationRoot: territory.wiki_affiliation_root || wiki?.affiliation_root || "",
		wikiFoundedText: territory.wiki_founded_text || wiki?.founded_text || "",
		wikiDissolvedText: territory.wiki_dissolved_text || wiki?.dissolved_text || "",
		wikiCapitalName: territory.wiki_capital_name || wiki?.capital_name || "",
		wikiSeatName: territory.wiki_seat_name || wiki?.seat_name || "",
	};
}

async function openRegionEditTabForTerritory(territoryPublicId, { assignGeometry = true } = {}) {
	snapshotActiveRegionEditTab();
	const existingTab = findRegionEditTab(territoryPublicId);
	if (existingTab) {
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(existingTab.region, { preserveTabs: true });
		renderRegionEditTabs();
		return;
	}

	try {
		setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
		const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
		const region = normalizePoliticalTerritoryForRegionEdit(response.territory || {}, response.wiki || null);
		const geometryAssignment = assignGeometry ? getActiveRegionGeometryAssignment(territoryPublicId) : null;
		const assignGeometryPublicId = geometryAssignment?.geometryPublicId || "";
		if (assignGeometryPublicId) {
			region.geometryPublicId = assignGeometryPublicId;
		}
		const tab = {
			key: territoryPublicId,
			entry: assignGeometryPublicId ? regionEditTabs[0]?.entry || regionEditEntry || region : region,
			region,
			payload: null,
			savedPayload: regionEditPayloadToPayload(region),
			assignGeometryPublicId,
			assignGeometryMode: geometryAssignment?.mode || "",
		};
		regionEditTabs.push(tab);
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(region, { preserveTabs: true });
		renderRegionEditTabs();
		setRegionEditStatus();
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht geladen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geladen werden.", "error");
	}
}

async function activatePrimaryRegionEditTabForTerritory(territoryPublicId) {
	if (!territoryPublicId) {
		return;
	}

	const primaryTab = regionEditTabs[0] || null;
	const currentTerritoryId = primaryTab?.region?.territoryPublicId || "";
	if (currentTerritoryId === territoryPublicId) {
		activeRegionEditTabKey = primaryTab?.key || territoryPublicId;
		if (primaryTab) {
			populateRegionEditForm(primaryTab.region, { preserveTabs: true });
			renderRegionEditTabs();
		}
		return;
	}

	setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
	const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
	const region = normalizePoliticalTerritoryForRegionEdit(response.territory || {}, response.wiki || null);
	const geometryPublicId = getPrimaryRegionGeometryPublicId();
	if (geometryPublicId) {
		region.geometryPublicId = geometryPublicId;
	}
	const geometryAssignment = getActiveRegionGeometryAssignment(territoryPublicId);
	const assignGeometryPublicId = geometryAssignment?.geometryPublicId || "";
	regionEditTabs = regionEditTabs.filter((tab, index) => index === 0 || tab.key !== territoryPublicId);
	const nextPrimaryTab = {
		key: territoryPublicId,
		entry: primaryTab?.entry || regionEditEntry || region,
		region,
		payload: null,
		savedPayload: regionEditPayloadToPayload(region),
		assignGeometryPublicId,
		assignGeometryMode: geometryAssignment?.mode || "",
	};
	if (regionEditTabs.length > 0) {
		regionEditTabs[0] = nextPrimaryTab;
	} else {
		regionEditTabs = [nextPrimaryTab];
	}
	activeRegionEditTabKey = territoryPublicId;
	populateRegionEditForm(nextPrimaryTab.region, { preserveTabs: true });
	renderRegionEditTabs();
	setRegionEditStatus();
}

function askRegionTabCloseChoice() {
	return new Promise((resolve) => {
		const overlay = document.createElement("div");
		overlay.className = "political-territory-confirm";
		overlay.innerHTML = `
			<div class="political-territory-confirm__dialog" role="dialog" aria-modal="true" aria-labelledby="region-tab-close-title">
				<h3 id="region-tab-close-title">Änderungen speichern?</h3>
				<p>Der Tab enthält ungespeicherte Änderungen.</p>
				<div class="political-territory-confirm__actions">
					<button type="button" data-region-tab-close-choice="save">Ja</button>
					<button type="button" data-region-tab-close-choice="discard">Nein</button>
					<button type="button" data-region-tab-close-choice="cancel">Abbrechen</button>
				</div>
			</div>
		`;
		const finish = (choice) => {
			overlay.remove();
			resolve(choice);
		};
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				finish("cancel");
			}
		});
		overlay.querySelectorAll("[data-region-tab-close-choice]").forEach((button) => {
			button.addEventListener("click", () => finish(button.dataset.regionTabCloseChoice || "cancel"));
		});
		document.body.append(overlay);
		overlay.querySelector("[data-region-tab-close-choice='save']")?.focus();
	});
}

$(document).on("click", "[data-region-edit-tab]", function (event) {
	event.preventDefault();
	const key = this.dataset.regionEditTab || "";
	const tab = findRegionEditTab(key);
	if (!tab || key === activeRegionEditTabKey) {
		return;
	}

	snapshotActiveRegionEditTab();
	activeRegionEditTabKey = key;
	populateRegionEditForm(tab.region, { preserveTabs: true });
	renderRegionEditTabs();
});

$(document).on("click", "[data-region-edit-tab-close]", async function (event) {
	event.preventDefault();
	event.stopPropagation();
	const key = this.dataset.regionEditTabClose || "";
	const tabIndex = regionEditTabs.findIndex((tab) => tab.key === key);
	if (tabIndex <= 0) {
		return;
	}

	snapshotActiveRegionEditTab();
	const tab = regionEditTabs[tabIndex];
	if (isRegionEditTabDirty(tab)) {
		const closeChoice = await askRegionTabCloseChoice();
		if (closeChoice === "save") {
			try {
				await saveRegionEditTab(tab);
				await loadPoliticalTerritoryOptions();
				schedulePoliticalTerritoryLayerReload({ immediate: true });
				showFeedbackToast("Herrschaftsgebiet gespeichert.", "success");
			} catch (error) {
				console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
				setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
				return;
			}
		} else if (closeChoice !== "discard") {
			return;
		}
	}

	regionEditTabs.splice(tabIndex, 1);
	if (activeRegionEditTabKey === key) {
		const nextTab = regionEditTabs[Math.max(0, tabIndex - 1)] || regionEditTabs[0] || null;
		activeRegionEditTabKey = nextTab?.key || "";
		if (nextTab) {
			populateRegionEditForm(nextTab.region, { preserveTabs: true });
		}
	}
	renderRegionEditTabs();
});

function populateRegionEditForm(entry, { preserveTabs = false } = {}) {
	regionEditEntry = entry;
	const region = entry?.region || entry || {};
	const source = region.source || "map_feature";
	regionParentSelectedTreeId = region.territoryPublicId || "";
	document.getElementById("region-edit-public-id").value = region.publicId || "";
	document.getElementById("region-edit-source").value = source;
	document.getElementById("region-edit-territory-public-id").value = region.territoryPublicId || "";
	document.getElementById("region-edit-geometry-public-id").value = region.geometryPublicId || region.publicId || "";
	document.getElementById("region-edit-wiki-id").value = region.wikiId || region.wiki_id || "";
	if (source !== "political_territory") {
		void acquireFeatureSoftLock(region.publicId || "");
	}
	document.getElementById("region-edit-name").value = normalizeParentheticalSpacing(region.displayName || region.name || "");
	document.getElementById("region-edit-short-name").value = region.shortName || "";
	document.getElementById("region-edit-color").value = region.color || "#888888";
	document.getElementById("region-edit-opacity").value = Math.round((region.opacity ?? 0.33) * 100);
	document.getElementById("region-edit-wiki-url").value = region.wikiUrl || "";
	document.getElementById("region-edit-coat-url").value = region.coatOfArmsUrl || "";
	document.getElementById("region-edit-min-zoom").value = region.minZoom ?? "";
	document.getElementById("region-edit-max-zoom").value = region.maxZoom ?? "";
	document.getElementById("region-edit-valid-from").value = region.validFromBf ?? "";
	document.getElementById("region-edit-valid-to").value = region.validToBf ?? "";
	document.getElementById("region-edit-valid-open").checked = region.validToBf === null || region.validToBf === undefined;
	document.getElementById("region-edit-valid-label").value = region.validLabel || "";
	document.getElementById("region-edit-is-active").checked = region.isActive !== false;
	document.getElementById("region-edit-notes").value = region.editorNotes || "";
	updateRegionParentDropTarget(region.parentPublicId || "");
	syncRegionTerritoryFieldVisibility(source);
	syncRegionCoatPreview();
	populateRegionTypeOptions(region);
	populateRegionParentSelect(region);
	renderRegionWikiReference(region);
	syncRegionAssignmentForRegion(region);
	document.getElementById("region-edit-delete").hidden = !entry;
	syncRegionOpacityOutput();
	syncRegionValidToControls();
}

function openRegionEditDialog(entry, { title = "Eigenschaften bearbeiten" } = {}) {
	resetRegionEditForm();
	document.getElementById("region-edit-title").textContent = title;
	initializeRegionEditTabs(entry);
	const initialEntry = regionEditTabs[0] || entry;
	populateRegionEditForm(initialEntry, { preserveTabs: true });
	setRegionEditDialogOpen(true);
	void loadPoliticalTerritoryOptions().then(() => {
		if (regionEditEntry === initialEntry || regionEditEntry === entry || regionEditTabs.length > 0) {
			const activeEntry = regionEditTabs[0] || initialEntry;
			populateRegionTypeOptions(activeEntry?.region || activeEntry || {});
			populateRegionParentSelect(activeEntry?.region || activeEntry || {});
			updateRegionParentDropTarget((activeEntry?.region || activeEntry || {}).parentPublicId || "");
		}
	});
}

$(document).on("click", "[data-region-parent-id]", function (event) {
	event.preventDefault();
	const toggleKey = this.dataset.regionTreeToggle || "";
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	const isLeaf = this.dataset.regionTreeLeaf === "1";
	if (toggleKey && (!isLeaf || event.target?.closest?.(".political-territory-parent-tree__toggle") || (this.dataset.regionTreeGroup === "1" && !territoryPublicId))) {
		if (regionParentCollapsedKeys.has(toggleKey)) {
			regionParentCollapsedKeys.delete(toggleKey);
		} else {
			regionParentCollapsedKeys.add(toggleKey);
		}
		populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
		return;
	}

	if (!territoryPublicId) {
		return;
	}
	if (!isLeaf) {
		setRegionEditStatus("Nur der unterste Knoten kann einer Geometrie zugewiesen werden.", "pending");
		return;
	}

	regionParentSelectedTreeId = territoryPublicId;
	document.querySelectorAll("#region-edit-parent-tree [data-region-parent-id]").forEach((button) => {
		button.classList.toggle("is-selected", button === this);
	});
	const territoryName = this.querySelector(".political-territory-parent-tree__name")?.textContent || "Herrschaftsgebiet";
	setRegionEditStatus(`${territoryName} ausgewählt.`, "success");
});

$(document).on("dblclick", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const toggleKey = this.dataset.regionTreeToggle || "";
	if (!toggleKey) {
		return;
	}

	if (regionParentCollapsedKeys.has(toggleKey)) {
		regionParentCollapsedKeys.delete(toggleKey);
	} else {
		regionParentCollapsedKeys.add(toggleKey);
	}
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
});

$(document).on("dragstart", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	if (!territoryPublicId || this.dataset.regionTreeLeaf !== "1" || !event.originalEvent?.dataTransfer) {
		event.preventDefault();
		return;
	}

	event.originalEvent.dataTransfer.effectAllowed = "copy";
	event.originalEvent.dataTransfer.setData("text/plain", territoryPublicId);
	event.originalEvent.dataTransfer.setData("application/x-avesmaps-territory", territoryPublicId);
});

$(document).on("dragover", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-parent-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	const activeTerritoryId = document.getElementById("region-edit-territory-public-id")?.value || "";
	if (territoryPublicId.startsWith("wiki:")) {
		setRegionEditStatus("Wiki-Knoten bitte in die Zuweisungsflaeche unter dem Baum ziehen.", "pending");
		return;
	}
	if (!territoryPublicId || territoryPublicId === activeTerritoryId) {
		return;
	}

	updateRegionParentDropTarget(territoryPublicId);
});

$(document).on("dragover", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-assignment-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	if (!territoryPublicId) {
		return;
	}

	void assignRegionGeometryToWikiTreeLeaf(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht zugewiesen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
	});
});

$(document).on("click", "[data-region-assignment-breadcrumb-id]", function (event) {
	event.preventDefault();
	const territoryPublicId = this.dataset.regionAssignmentBreadcrumbId || "";
	void openRegionVisualTabFromBreadcrumb(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht geoeffnet werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geoeffnet werden.", "error");
	});
});

$(document).on("click", "#region-edit-parent-clear", function (event) {
	event.preventDefault();
	updateRegionParentDropTarget("");
});

$(document).on("click", "#region-edit-assignment-save", function (event) {
	event.preventDefault();
	const formElement = document.getElementById("region-edit-form");
	if (!formElement) {
		return;
	}
	if (typeof formElement.requestSubmit === "function") {
		formElement.requestSubmit();
		return;
	}
	formElement.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});

function updateRegionParentFilter(value) {
	regionParentFilterQuery = String(value || "").trim();
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
}

async function loadPoliticalTerritoryWikiReferences() {
	if (politicalTerritoryWikiReferences.length > 0) {
		return politicalTerritoryWikiReferences;
	}

	const response = await fetchWikiSyncData({ action: "political_territory_tree" });
	politicalTerritoryWikiReferences = Array.isArray(response.territories)
		? response.territories.map((entry, index) => normalizeWikiTreeReferenceRecord(entry, index))
		: [];
	return politicalTerritoryWikiReferences;
}

async function loadPoliticalTerritoryWikiReferenceFallback() {
	const response = await fetch("api/wiki-sync.php?action=political_territory_tree", {
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Statische Wiki-Referenz antwortet mit HTTP ${response.status}.`);
	}

	const data = await response.json().catch(() => []);
	return Array.isArray(data) ? data.map((entry, index) => normalizeStaticWikiReferenceRecord(entry, index)) : [];
}

function normalizeStaticWikiReferenceRecord(record, index) {
	return {
		id: index + 1,
		wiki_key: getStaticWikiReferenceValue(record, ["Wiki-Link", "Wiki Link", "wiki_url", "Name", "name"]),
		name: getStaticWikiReferenceValue(record, ["Name", "name"]),
		type: normalizeParentheticalSpacing(getStaticWikiReferenceValue(record, ["Typ", "type"])),
		continent: getStaticWikiReferenceValue(record, ["Kontinent", "continent"]),
		affiliation_raw: getStaticWikiReferenceValue(record, ["Zugehörigkeit", "Zugehoerigkeit", "affiliation_raw"]),
		affiliation_root: getStaticWikiReferenceValue(record, ["Zugehörigkeit-Root", "Zugehoerigkeit-Root", "affiliation_root"]),
		affiliation_path: getStaticWikiReferenceValue(record, ["Zugehörigkeit-Pfad", "Zugehoerigkeit-Pfad", "affiliation_path"]),
		status: getStaticWikiReferenceValue(record, ["Status", "status"]),
		capital_name: getStaticWikiReferenceValue(record, ["Hauptstadt", "capital_name"]),
		seat_name: getStaticWikiReferenceValue(record, ["Herrschaftssitz", "seat_name"]),
		ruler: getStaticWikiReferenceValue(record, ["Oberhaupt", "ruler"]),
		founded_text: getStaticWikiReferenceValue(record, ["Gründungsdatum-Text", "Gründungsdatum", "founded_text"]),
		dissolved_text: getStaticWikiReferenceValue(record, ["Aufgelöst-Text", "Aufgelöst", "dissolved_text"]),
		wiki_url: getStaticWikiReferenceValue(record, ["Wiki-Link", "wiki_url"]),
		coat_of_arms_url: getStaticWikiReferenceValue(record, ["Wappen", "Wappen-Link", "coat_of_arms_url"]),
	};
}

function getStaticWikiReferenceValue(record, keys) {
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(record, key)) {
			return String(record[key] || "").trim();
		}
	}

	return "";
}

async function openRegionWikiPickerDialog() {
	if (!regionEditEntry) {
		return;
	}

	document.getElementById("region-wiki-picker-status").textContent = "Wiki-Referenzen werden geladen...";
	document.getElementById("region-wiki-picker-filter").value = "";
	setRegionWikiPickerDialogOpen(true);
	try {
		await loadPoliticalTerritoryWikiReferences();
		renderRegionWikiPickerList("");
		document.getElementById("region-wiki-picker-status").textContent = "";
	} catch (error) {
		console.error("Wiki-Referenzen konnten nicht geladen werden:", error);
		document.getElementById("region-wiki-picker-status").textContent = error.message || "Wiki-Referenzen konnten nicht geladen werden.";
	}
}

function renderRegionWikiPickerList(filterValue) {
	const listElement = document.getElementById("region-wiki-picker-list");
	if (!listElement) {
		return;
	}

	const query = normalizeSearchText(filterValue);
	const matches = politicalTerritoryWikiReferences
		.filter((entry) => query === "" || getWikiReferenceSearchText(entry).includes(query))
		.slice(0, 250);
	listElement.innerHTML = "";
	matches.forEach((entry) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "political-territory-wiki-picker-list__item";
		button.dataset.wikiReferenceId = String(entry.id || "");
		button.innerHTML = `
			<span class="political-territory-wiki-picker-list__name"></span>
			<span class="political-territory-wiki-picker-list__meta"></span>
		`;
		button.querySelector(".political-territory-wiki-picker-list__name").textContent = normalizeParentheticalSpacing(entry.name || "");
		button.querySelector(".political-territory-wiki-picker-list__meta").textContent = normalizeParentheticalSpacing([
			entry.type,
			entry.affiliation_root,
			entry.continent,
			buildWikiReferencePeriod({
				wiki_founded_text: entry.founded_text,
				wiki_dissolved_text: entry.dissolved_text,
			}),
		].filter(Boolean).join(" · "));
		listElement.append(button);
	});

	if (matches.length === 0) {
		const emptyElement = document.createElement("p");
		emptyElement.className = "political-territory-wiki-picker-list__empty";
		emptyElement.textContent = "Keine Treffer";
		listElement.append(emptyElement);
	}
}

function getWikiReferenceSearchText(entry) {
	return normalizeSearchText([
		entry.name,
		entry.type,
		entry.affiliation_raw,
		entry.affiliation_root,
		entry.status,
		entry.capital_name,
		entry.seat_name,
		entry.ruler,
	].filter(Boolean).join(" "));
}

function applyRegionWikiReferenceSelection(wikiReferenceId) {
	const wikiReference = politicalTerritoryWikiReferences.find((entry) => String(entry.id) === String(wikiReferenceId));
	if (!wikiReference) {
		return;
	}

	document.getElementById("region-edit-wiki-id").value = String(wikiReference.id || "");
	document.getElementById("region-edit-wiki-url").value = wikiReference.wiki_url || "";
	if (wikiReference.coat_of_arms_url) {
		document.getElementById("region-edit-coat-url").value = wikiReference.coat_of_arms_url;
	}
	if (wikiReference.type) {
		const typeSelect = document.getElementById("region-edit-type");
		const normalizedType = normalizeParentheticalSpacing(wikiReference.type);
		if (typeSelect && !Array.from(typeSelect.options).some((option) => option.value === normalizedType)) {
			typeSelect.append(new Option(normalizedType, normalizedType));
		}
		if (typeSelect) {
			typeSelect.value = normalizedType;
		}
	}

	const region = regionEditEntry?.region || regionEditEntry || {};
	region.wikiId = wikiReference.id || null;
	region.wikiName = wikiReference.name || "";
	region.wikiType = wikiReference.type || "";
	region.wikiAffiliationRaw = wikiReference.affiliation_raw || "";
	region.wikiAffiliationRoot = wikiReference.affiliation_root || "";
	region.wikiFoundedText = wikiReference.founded_text || "";
	region.wikiDissolvedText = wikiReference.dissolved_text || "";
	region.wikiCapitalName = wikiReference.capital_name || "";
	region.wikiSeatName = wikiReference.seat_name || "";
	region.wikiUrl = wikiReference.wiki_url || "";
	region.coatOfArmsUrl = wikiReference.coat_of_arms_url || region.coatOfArmsUrl || "";
	renderRegionWikiReference(region);
	syncRegionCoatPreview();
	setRegionWikiPickerDialogOpen(false);
}

function populatePathEditForm(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const pathSubtype = normalizePathSubtype(path.properties?.name || path.properties?.feature_subtype || "Weg");
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

function populatePathEditFormFromLastSettings(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const storedSettings = lastPathEditSettings || {};
	const fallbackSubtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name || "Weg");
	const pathSubtype = normalizePathSubtype(storedSettings.feature_subtype || fallbackSubtype);
	const autoNameEnabled = storedSettings.autoname !== undefined ? Boolean(storedSettings.autoname) : true;
	const showLabelEnabled = storedSettings.show_label !== undefined ? Boolean(storedSettings.show_label) : shouldPathNameBeDisplayed(path);
	const allowedTransports = Array.isArray(storedSettings.allowed_transports) ? storedSettings.allowed_transports : null;

	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getNextPathDisplayName(pathSubtype, { excludePath: pathEditFeature });
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = autoNameEnabled;
	document.getElementById("path-edit-show-label").checked = showLabelEnabled;
	syncPathTransportOptions({
		path: {
			properties: {
				feature_subtype: pathSubtype,
				allowed_transports: allowedTransports,
			},
		},
		resetToDefault: !allowedTransports,
	});
	syncPathAutoNameControls({ forceName: true });
}

function openPathEditDialog(path, { inheritLastSettings = false } = {}) {
	resetPathEditForm();
	if (inheritLastSettings && lastPathEditSettings) {
		populatePathEditFormFromLastSettings(path);
	} else {
		populatePathEditForm(path);
	}
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

function rememberPathEditSettingsFromPayload(payload, { autoname = true } = {}) {
	lastPathEditSettings = {
		feature_subtype: String(payload?.feature_subtype || "Weg").trim() || "Weg",
		show_label: Boolean(payload?.show_label),
		autoname: Boolean(autoname),
		allowed_transports: Array.isArray(payload?.allowed_transports) ? [...payload.allowed_transports] : [],
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
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
	const configured = Array.isArray(path?.properties?.allowed_transports) ? path.properties.allowed_transports : null;
	if (configured !== null) {
		return configured.filter((option) => getTransportOptionsForPathSubtype(subtype).includes(option));
	}

	return getTransportOptionsForPathSubtype(subtype);
}

function getTransportOptionsForPathSubtype(pathSubtype) {
	const normalizedSubtype = normalizePathSubtype(pathSubtype);
	const domain = getDefaultTransportDomainForPathSubtype(normalizedSubtype);
	const options = TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	if (normalizedSubtype === "Wuestenpfad") {
		return options.filter((option) => option !== "horseCarriage");
	}

	return options;
}

function syncPathTransportOptions({ path = null, resetToDefault = false } = {}) {
	const subtype = normalizePathSubtype(document.getElementById("path-edit-type")?.value || path?.properties?.feature_subtype || "Weg");
	const defaultOptions = getTransportOptionsForPathSubtype(subtype);
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
	const source = String(formData.get("source") || "map_feature").trim();
	if (source === "political_territory") {
		return {
			action: "update_territory",
			source,
			public_id: String(formData.get("geometry_public_id") || "").trim(),
			geometry_public_id: String(formData.get("geometry_public_id") || "").trim(),
			territory_public_id: String(formData.get("territory_public_id") || "").trim(),
			wiki_id: String(formData.get("wiki_id") || "").trim(),
			name: String(formData.get("name") || "").trim(),
			short_name: String(formData.get("short_name") || "").trim(),
			type: String(formData.get("type") || "").trim(),
			parent_public_id: String(formData.get("parent_public_id") || "").trim(),
			color: String(formData.get("color") || "#888888").trim(),
			opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
			wiki_url: String(formData.get("wiki_url") || "").trim(),
			coat_of_arms_url: String(formData.get("coat_of_arms_url") || "").trim(),
			min_zoom: String(formData.get("min_zoom") || "").trim(),
			max_zoom: String(formData.get("max_zoom") || "").trim(),
			valid_from_bf: String(formData.get("valid_from_bf") || "").trim(),
			valid_to_bf: String(formData.get("valid_to_bf") || "").trim(),
			valid_to_open: ["on", "1", "true"].includes(String(formData.get("valid_to_open") || "").trim().toLowerCase()),
			valid_label: String(formData.get("valid_label") || "").trim(),
			is_active: formData.get("is_active") === "on",
			editor_notes: String(formData.get("editor_notes") || "").trim(),
		};
	}

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

function setWikiSyncStatus(message, state = "") {
	const statusElement = document.getElementById("wiki-sync-status");
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message || "";
	statusElement.dataset.state = state;
}

function formatPresenceAge(secondsSinceSeen) {
	if (secondsSinceSeen === null || secondsSinceSeen === undefined || secondsSinceSeen === "") {
		return "noch nie online";
	}

	const seconds = Number(secondsSinceSeen);
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "";
	}

	if (seconds < 30) {
		return "gerade eben";
	}

	if (seconds < 90) {
		return "vor 1 Min.";
	}

	if (seconds < 3600) {
		return `vor ${Math.max(2, Math.round(seconds / 60))} Min.`;
	}

	if (seconds < 86400) {
		return `vor ${Math.max(1, Math.round(seconds / 3600))} Std.`;
	}

	return `vor ${Math.max(1, Math.round(seconds / 86400))} Tagen`;
}

function formatPresenceRole(role) {
	const normalizedRole = String(role || "").trim().toLowerCase();
	return {
		admin: "Admin",
		editor: "Editor",
		reviewer: "Reviewer",
	}[normalizedRole] || normalizedRole || "Editor";
}

function setWikiSyncRunning(isRunning, run = null) {
	isWikiSyncRunning = isRunning;

	const startButtonElement = document.getElementById("wiki-sync-start");
	if (startButtonElement) {
		startButtonElement.disabled = isRunning;
		startButtonElement.textContent = isRunning
			? "Synchronisiert..."
			: (activeWikiSyncRunStatus === "running" ? "Fortsetzen" : "Synchronisieren");
	}

	const progressElement = document.getElementById("wiki-sync-progress");
	if (progressElement) {
		progressElement.hidden = !isRunning && !run;
		progressElement.max = Number(run?.progress_total) || 4;
		progressElement.value = Number(run?.progress_current) || 0;
	}
}

function setEditorPanelTab(tabName) {
	activeEditorPanelTab = ["review", "changes", "presence", "wiki-sync"].includes(tabName) ? tabName : "review";
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
	} else if (activeEditorPanelTab === "wiki-sync") {
		void loadWikiSyncCases();
	}
}

function refreshActiveEditorPanel() {
	if (activeEditorPanelTab === "changes") {
		return loadChangeLog();
	}

	if (activeEditorPanelTab === "presence") {
		return sendEditorPresenceHeartbeat();
	}

	if (activeEditorPanelTab === "wiki-sync") {
		return loadWikiSyncCases();
	}

	return loadReviewReports();
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

async function loadWikiSyncCases() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setWikiSyncStatus("WikiSync-Fälle werden geladen...", "pending");
	try {
		const response = await fetch(WIKI_SYNC_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(data?.error || `WikiSync-API antwortet mit HTTP ${response.status}.`);
		}

		wikiSyncCases = Array.isArray(data.cases) ? data.cases : [];
		wikiSyncSummary = data.summary || null;
		wikiSyncTerritorySummary = data.political_territory_tree || null;
		const activeRun = data.active_run || null;
		activeWikiSyncRunId = activeRun?.public_id || data.latest_run?.public_id || activeWikiSyncRunId;
		activeWikiSyncRunStatus = activeRun?.status || "";
		renderWikiSyncCases(data.latest_run || null);
		syncWikiSyncCreateLocationContextMenuAction();
		if (activeRun?.status === "running") {
			setWikiSyncRunning(false, activeRun);
			setWikiSyncStatus(activeRun.message || "Ein WikiSync-Lauf kann fortgesetzt werden.", "pending");
		} else {
			setWikiSyncRunning(false);
		}
	} catch (error) {
		console.error("WikiSync-Fälle konnten nicht geladen werden:", error);
		setWikiSyncStatus(error.message || "WikiSync-Fälle konnten nicht geladen werden.", "error");
	}
}

async function startWikiSyncRun() {
	if (isWikiSyncRunning) {
		return;
	}

	setWikiSyncRunning(true);
	setWikiSyncStatus(activeWikiSyncRunStatus === "running" ? "WikiSync wird fortgesetzt..." : "WikiSync wird gestartet...", "pending");

	try {
		let run = null;
		if (activeWikiSyncRunStatus === "running" && activeWikiSyncRunId) {
			run = { public_id: activeWikiSyncRunId, status: "running" };
		} else {
			const startResult = await submitWikiSyncAction("start_run");
			activeWikiSyncRunId = startResult.run?.public_id || null;
			activeWikiSyncRunStatus = startResult.run?.status || "running";
			run = startResult.run || null;
		}
		let safetyCounter = 0;
		setWikiSyncRunning(true, run);

		while (run && run.status !== "completed" && run.status !== "failed") {
			if (safetyCounter > 8) {
				throw new Error("WikiSync wurde nach zu vielen Teilschritten angehalten.");
			}

			const advanceResult = await submitWikiSyncAction("advance_run", { run_id: activeWikiSyncRunId });
			run = advanceResult.run || null;
			activeWikiSyncRunStatus = run?.status || "";
			wikiSyncSummary = advanceResult.summary || wikiSyncSummary;
			setWikiSyncRunning(true, run);
			setWikiSyncStatus(run?.message || "WikiSync läuft...", "pending");
			safetyCounter += 1;
		}

		if (run?.status === "failed") {
			throw new Error(run.message || "WikiSync ist fehlgeschlagen.");
		}

		setWikiSyncRunning(false);
		activeWikiSyncRunStatus = "";
		const territoryStats = run?.stats || {};
		const territoryMessage = territoryStats.political_territory_received
			? ` Herrschaftsgebiete: ${territoryStats.political_territory_created || 0} neu, ${territoryStats.political_territory_updated || 0} aktualisiert, ${territoryStats.political_territory_geometry_seeded || 0} Geometrien verknuepft.`
			: "";
		await loadWikiSyncCases();
		if (territoryStats.political_territory_received) {
			await loadPoliticalTerritoryOptions({ force: true });
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		}
		setWikiSyncStatus(`WikiSync abgeschlossen.${territoryMessage}`, "success");
	} catch (error) {
		console.error("WikiSync konnte nicht ausgeführt werden:", error);
		activeWikiSyncRunStatus = "";
		setWikiSyncRunning(false);
		setWikiSyncStatus(error.message || "WikiSync konnte nicht ausgeführt werden.", "error");
		showFeedbackToast(error.message || "WikiSync konnte nicht ausgeführt werden.", "warning");
	}
}

function appendWikiSyncTerritorySummary(message) {
	const territoryCount = Number(wikiSyncTerritorySummary?.territory_count ?? 0);
	const rootCount = Number(wikiSyncTerritorySummary?.root_count ?? 0);
	if (territoryCount < 1 && rootCount < 1) {
		return message;
	}

	return `${message} (${territoryCount} Territorien, ${rootCount} Mächte)`;
}

function renderWikiSyncCases(latestRun = null) {
	const listElement = document.getElementById("wiki-sync-case-list");
	if (!listElement) {
		return;
	}

	const previousOpenGroupKeys = getWikiSyncOpenGroupKeys();
	const filterQuery = getWikiSyncFilterQuery();
	const filterDisplayQuery = String(wikiSyncFilterQuery || "").trim();
	const hasActiveFilter = filterQuery !== "";
	const shouldCollapseGroups = wikiSyncFilterCollapseRequested && !hasActiveFilter;
	listElement.innerHTML = "";
	syncWikiSyncFilterControls();

	if (!latestRun && wikiSyncCases.length < 1) {
		setWikiSyncStatus("Noch kein WikiSync-Lauf. Starte die Synchronisierung manuell.", "empty");
		return;
	}

	if (wikiSyncCases.length < 1) {
		setWikiSyncStatus("Keine WikiSync-Fälle.", "empty");
		return;
	}

	const filteredCases = hasActiveFilter ? getWikiSyncFilteredCases(wikiSyncCases, filterQuery) : wikiSyncCases;
	const openCount = Number(wikiSyncSummary?.by_status?.open ?? filteredCases.filter((caseEntry) => caseEntry.status === "open").length);
	const deferredCount = Number(wikiSyncSummary?.by_status?.deferred ?? filteredCases.filter((caseEntry) => caseEntry.status === "deferred").length);
	const archivedCount = Number(wikiSyncSummary?.by_status?.archived ?? filteredCases.filter((caseEntry) => caseEntry.status === "archived").length);
	const activeCount = openCount + deferredCount;
	const statusMessage = isWikiSyncCreateLocationSelectionActive
		? "Wählen Sie den Ort aus der Liste."
		: hasActiveFilter
		? `${filteredCases.length} Treffer für "${filterDisplayQuery}".`
		: activeCount > 0
		? `${openCount} offen, ${deferredCount} zurückgestellt, ${archivedCount} archiviert.`
		: `${archivedCount} archiviert, keine offenen Fälle.`;
	setWikiSyncStatus(appendWikiSyncTerritorySummary(statusMessage), isWikiSyncCreateLocationSelectionActive ? "pending" : "success");

	const renderedGroupElements = new Map();
	const openSectionElement = renderWikiSyncCaseSection(listElement, "Offen", "open", filteredCases.filter((caseEntry) => caseEntry.status !== "archived"), renderedGroupElements);
	const archivedSectionElement = renderWikiSyncCaseSection(listElement, "Archiviert", "archived", filteredCases.filter((caseEntry) => caseEntry.status === "archived"), renderedGroupElements);
	if (!openSectionElement && !archivedSectionElement) {
		setWikiSyncStatus(hasActiveFilter ? `Keine Treffer für "${filterDisplayQuery}".` : "Keine WikiSync-Fälle.", "empty");
		wikiSyncFilterCollapseRequested = false;
		syncWikiSyncCreateLocationContextMenuAction();
		return;
	}

	if (hasActiveFilter) {
		isWikiSyncAccordionRestoring = true;
		try {
			listElement.querySelectorAll(".wiki-sync-case-group").forEach((detailsElement) => {
				if (detailsElement instanceof HTMLDetailsElement) {
					detailsElement.open = true;
				}
			});
			if (isWikiSyncCreateLocationSelectionActive) {
				const selectionGroupElement = listElement.querySelector('.wiki-sync-case-group[data-case-type="missing_wiki_without_coordinates"]');
				if (selectionGroupElement instanceof HTMLDetailsElement) {
					selectionGroupElement.open = true;
				}
			}
		} finally {
			window.requestAnimationFrame(() => {
				isWikiSyncAccordionRestoring = false;
			});
		}
	} else if (!shouldCollapseGroups) {
		restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys);
	}

	wikiSyncFilterCollapseRequested = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function getWikiSyncOpenGroupKeys() {
	return Array.from(document.querySelectorAll("#wiki-sync-case-list .wiki-sync-case-group[open]"))
		.map((groupElement) => (groupElement instanceof HTMLElement ? String(groupElement.dataset.groupKey || "") : ""))
		.filter((groupKey) => groupKey !== "");
}

function restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys) {
	if (!Array.isArray(previousOpenGroupKeys) || previousOpenGroupKeys.length < 1) {
		return;
	}

	isWikiSyncAccordionRestoring = true;
	try {
		previousOpenGroupKeys.forEach((groupKey) => {
			const groupElement = renderedGroupElements.get(groupKey) || getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey);
			if (groupElement) {
				groupElement.open = true;
			}
		});
	} finally {
		window.requestAnimationFrame(() => {
			isWikiSyncAccordionRestoring = false;
		});
	}
}

function syncWikiSyncFilterControls() {
	const inputElement = document.getElementById("wiki-sync-filter");
	if (inputElement instanceof HTMLInputElement) {
		inputElement.value = wikiSyncFilterQuery;
	}
}

function setWikiSyncFilterQuery(value) {
	const nextQuery = String(value || "");
	const previousNormalized = getWikiSyncFilterQuery();
	const nextNormalized = normalizeWikiSyncFilterQuery(nextQuery);
	if (nextQuery === wikiSyncFilterQuery) {
		syncWikiSyncFilterControls();
		return;
	}

	const hadFilter = previousNormalized !== "";
	wikiSyncFilterQuery = nextQuery;
	wikiSyncFilterCollapseRequested = hadFilter && nextNormalized === "";
	syncWikiSyncFilterControls();
	if (previousNormalized !== nextNormalized || wikiSyncFilterCollapseRequested) {
		renderWikiSyncCases();
	}
}

function getWikiSyncFilterQuery() {
	return normalizeWikiSyncFilterQuery(wikiSyncFilterQuery);
}

function normalizeWikiSyncFilterQuery(value) {
	return normalizeWikiSyncSearchText(value).trim();
}

function normalizeWikiSyncSearchText(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/ß/g, "ss")
		.toLowerCase();
}

function getWikiSyncCaseSearchText(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || {};
	const resolutionFeature = getWikiSyncResolvedFeature(caseEntry) || {};
	const wikiPage = payload.wiki || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	const proposedLocation = payload.proposed_location || {};
	const tokens = [
		caseEntry.case_label,
		caseEntry.case_type,
		formatWikiSyncCaseStatus(caseEntry.status),
		getWikiSyncCaseTitle(caseEntry),
		payload.name,
		mapPlace.name,
		mapPlace.settlement_label,
		mapPlace.settlement_class,
		resolutionFeature.name,
		resolutionFeature.location_type_label,
		resolutionFeature.feature_subtype,
		wikiPage.title,
		wikiPage.url,
		payload.match_kind,
		proposedLocation.source_label,
		proposedLocation.source,
		proposedLocation.warnings?.join(" "),
		...candidates.map((candidate) => candidate.title || ""),
		...matches.map((match) => match.name || ""),
	];

	if (proposedLocation.lat !== undefined && proposedLocation.lng !== undefined) {
		tokens.push(formatLocationReportCoordinates(proposedLocation));
	}

	return normalizeWikiSyncSearchText(tokens.filter(Boolean).join(" "));
}

function getWikiSyncFilteredCases(cases = wikiSyncCases, filterQuery = "") {
	const normalizedQuery = normalizeWikiSyncFilterQuery(filterQuery);
	if (!normalizedQuery) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	if (queryTokens.length < 1) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	return (Array.isArray(cases) ? cases : []).filter((caseEntry) => {
		const searchableText = getWikiSyncCaseSearchText(caseEntry);
		return queryTokens.every((token) => searchableText.includes(token));
	});
}

function hasWikiSyncMissingWikiWithoutCoordinatesCases() {
	return wikiSyncCases.some((caseEntry) => caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status !== "archived");
}

function syncWikiSyncCreateLocationContextMenuAction() {
	const actionElement = document.querySelector('[data-context-action="create-location-from-wiki"]');
	if (!actionElement) {
		return;
	}

	actionElement.hidden = !hasWikiSyncMissingWikiWithoutCoordinatesCases();
}

function startWikiSyncCreateLocationSelection(latlng) {
	wikiSyncCreateLocationContextLatLng = L.latLng(latlng);
	isWikiSyncCreateLocationSelectionActive = true;
	if (isReviewPanelHidden) {
		toggleReviewPanel();
	}
	window.setEditorPanelTab?.("wiki-sync");
	setWikiSyncStatus("Wählen Sie den Ort aus der Liste.", "pending");
	showFeedbackToast("Wählen Sie den Ort aus der Liste.", "info");
}

function clearWikiSyncCreateLocationSelection() {
	wikiSyncCreateLocationContextLatLng = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function resetWikiSyncCreateLocationFlowState() {
	wikiSyncCreateLocationContextLatLng = null;
	wikiSyncCreateLocationCaseId = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function openWikiSyncCreateLocationDialogFromCase(caseEntry) {
	const latlng = wikiSyncCreateLocationContextLatLng ? L.latLng(wikiSyncCreateLocationContextLatLng) : null;
	if (!latlng) {
		showFeedbackToast("Bitte zuerst eine Position auf der Karte wählen.", "warning");
		return;
	}

	const wikiPage = caseEntry.payload?.wiki || {};
	const presetName = wikiPage.title || "";
	const presetLocationType = normalizeLocationType(wikiPage.settlement_class || "dorf");
	const presetWikiUrl = wikiPage.url || "";
	wikiSyncCreateLocationCaseId = Number(caseEntry.id) || null;
	clearWikiSyncCreateLocationSelection();
	openLocationEditDialog({
		latlng,
		presetName,
		presetLocationType,
		presetWikiUrl,
		presetDescription: "",
	});
	renderWikiSyncCases();
	showFeedbackToast("Wiki-Ort wird als neuer Ort angelegt.", "success");
}

function getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey) {
	const parts = String(groupKey).split(":");
	if (parts.length < 2) {
		return null;
	}

	const sectionKey = parts.shift();
	const caseType = parts.join(":");
	if (sectionKey !== "open") {
		return null;
	}

	return renderedGroupElements.get(`archived:${caseType}`) || null;
}

function renderWikiSyncCaseSection(listElement, title, sectionKey, cases, renderedGroupElements) {
	if (!Array.isArray(cases) || cases.length < 1) {
		return null;
	}

	const sectionElement = document.createElement("section");
	sectionElement.className = `wiki-sync-case-section wiki-sync-case-section--${sectionKey}`;
	sectionElement.dataset.sectionKey = sectionKey;

	const titleElement = document.createElement("h3");
	titleElement.className = "wiki-sync-case-section__title";
	titleElement.textContent = title;
	sectionElement.appendChild(titleElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-section__body";
	getWikiSyncGroupedCases(cases).forEach((group) => {
		const groupElement = createWikiSyncCaseGroupElement(group, sectionKey);
		renderedGroupElements.set(groupElement.dataset.groupKey || `${sectionKey}:${group.caseType}`, groupElement);
		bodyElement.appendChild(groupElement);
	});

	if (bodyElement.childElementCount < 1) {
		return null;
	}

	sectionElement.appendChild(bodyElement);
	listElement.appendChild(sectionElement);
	return sectionElement;
}

function handleWikiSyncCaseGroupToggle(event) {
	if (isWikiSyncAccordionRestoring) {
		return;
	}

	const groupElement = event.currentTarget;
	if (!(groupElement instanceof HTMLDetailsElement) || !groupElement.open) {
		return;
	}

	const sectionElement = groupElement.closest(".wiki-sync-case-section");
	if (!sectionElement) {
		return;
	}

	sectionElement.querySelectorAll(".wiki-sync-case-group").forEach((otherGroupElement) => {
		if (otherGroupElement !== groupElement && otherGroupElement instanceof HTMLDetailsElement) {
			otherGroupElement.open = false;
		}
	});

	window.requestAnimationFrame(() => {
		groupElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
}

function getWikiSyncGroupedCases(cases = wikiSyncCases) {
	const groupsByType = new Map();
	cases.forEach((caseEntry) => {
		const caseType = caseEntry.case_type || "unknown";
		if (!groupsByType.has(caseType)) {
			groupsByType.set(caseType, {
				caseType,
				label: caseEntry.case_label || getWikiSyncCaseTypeLabel(caseType),
				cases: [],
			});
		}

		groupsByType.get(caseType).cases.push(caseEntry);
	});

	return Array.from(groupsByType.values()).sort((left, right) => getWikiSyncCaseTypeOrder(left.caseType) - getWikiSyncCaseTypeOrder(right.caseType));
}

function getWikiSyncCaseTypeOrder(caseType) {
	const order = {
		canonical_name_difference: 10,
		type_conflict: 20,
		probable_match: 30,
		unresolved_without_candidate: 40,
		duplicate_avesmaps_name: 50,
		duplicate_wiki_title: 60,
		missing_wiki_with_coordinates: 70,
		missing_wiki_without_coordinates: 80,
	};

	return order[caseType] || 999;
}

function getWikiSyncCaseTypeLabel(caseType) {
	const labels = {
		canonical_name_difference: "Abweichende Benennung",
		type_conflict: "Typkonflikte",
		probable_match: "Unaufgelöst, aber mit wahrscheinlichem Match",
		unresolved_without_candidate: "Unaufgelöst, ohne Match",
		duplicate_avesmaps_name: "Dubletten in Avesmaps",
		duplicate_wiki_title: "Mehrere Avesmaps-Namen zeigen auf denselben Wiki-Titel",
		missing_wiki_with_coordinates: "Fehlende Wiki-Orte mit Koordinaten",
		missing_wiki_without_coordinates: "Fehlende Wiki-Orte ohne nutzbare Koordinaten",
	};

	return labels[caseType] || caseType;
}

function getWikiSyncResolvedFeature(caseEntry) {
	return caseEntry?.resolution?.feature || caseEntry?.payload?.resolution?.feature || null;
}

function createWikiSyncCaseElement(caseEntry) {
	const payload = caseEntry.payload || {};
	const detailsElement = document.createElement("details");
	detailsElement.className = "wiki-sync-case";
	detailsElement.dataset.caseId = String(caseEntry.id || "");
	detailsElement.dataset.caseType = caseEntry.case_type || "";

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case__title";
	titleElement.textContent = getWikiSyncCaseTitle(caseEntry);
	const statusElement = document.createElement("span");
	statusElement.className = `wiki-sync-case__status wiki-sync-case__status--${caseEntry.status || "open"}`;
	statusElement.textContent = formatWikiSyncCaseStatus(caseEntry.status);
	summaryElement.append(titleElement, statusElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case__body";
	appendWikiSyncCaseRows(bodyElement, caseEntry);
	appendWikiSyncCaseCandidates(bodyElement, caseEntry);
	appendWikiSyncCaseActions(bodyElement, caseEntry);

	detailsElement.append(summaryElement, bodyElement);
	detailsElement.addEventListener("toggle", () => {
		if (isWikiSyncAccordionRestoring) {
			return;
		}

		if (detailsElement.open && (payload.map || payload.proposed_location || Array.isArray(payload.matches))) {
			focusWikiSyncCase(caseEntry);
		}
	});

	return detailsElement;
}

function createWikiSyncCaseGroupElement(group, sectionKey) {
	const groupElement = document.createElement("details");
	groupElement.className = "wiki-sync-case-group";
	groupElement.dataset.caseType = group.caseType;
	groupElement.dataset.sectionKey = sectionKey;
	groupElement.dataset.groupKey = `${sectionKey}:${group.caseType}`;
	groupElement.addEventListener("toggle", handleWikiSyncCaseGroupToggle);

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case-group__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case-group__title";
	titleElement.textContent = group.label;
	const countElement = document.createElement("span");
	countElement.className = "wiki-sync-case-group__count";
	countElement.textContent = String(group.cases.length);
	summaryElement.append(titleElement, countElement);
	groupElement.appendChild(summaryElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-group__body";
	group.cases.forEach((caseEntry) => bodyElement.appendChild(createWikiSyncCaseElement(caseEntry)));
	groupElement.appendChild(bodyElement);

	return groupElement;
}

function appendWikiSyncCaseRows(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || getWikiSyncResolvedFeature(caseEntry);
	const wikiPage = payload.wiki || null;

	if (mapPlace) {
		appendWikiSyncInfoRow(bodyElement, "Avesmaps", `${mapPlace.name || "Unbenannt"} · ${mapPlace.settlement_label || mapPlace.location_type_label || mapPlace.settlement_class || mapPlace.feature_subtype || "Ort"}`);
	}

	if (wikiPage) {
		appendWikiSyncLinkRow(bodyElement, "Wiki", wikiPage.title || "Wiki Aventurica", wikiPage.url || "");
	}

	if (payload.match_kind) {
		appendWikiSyncInfoRow(bodyElement, "Match", formatWikiSyncMatchKind(payload.match_kind));
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		appendWikiSyncInfoRow(bodyElement, "Name", payload.name || "Unbenannt");
		appendWikiSyncInfoRow(bodyElement, "Treffer", String(Array.isArray(payload.matches) ? payload.matches.length : 0));
	}

	if (payload.proposed_location) {
		const sourceLabel = payload.proposed_location.source_label || payload.proposed_location.source || "Koordinaten";
		appendWikiSyncInfoRow(bodyElement, "Position", `${formatLocationReportCoordinates(payload.proposed_location)} · ${sourceLabel}`);
		if (Array.isArray(payload.proposed_location.warnings) && payload.proposed_location.warnings.length > 0) {
			appendWikiSyncInfoRow(bodyElement, "Hinweis", payload.proposed_location.warnings.join(" "));
		}
	}
}

function appendWikiSyncCaseCandidates(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];

	if (caseEntry.case_type === "duplicate_avesmaps_name" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Dubletten";
		sectionElement.appendChild(labelElement);

		matches.forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"} · ${match.settlement_label || match.settlement_class || "Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (caseEntry.case_type === "duplicate_wiki_title" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);

		matches.slice(0, 2).forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				entryActionsElement.appendChild(acceptButtonElement);
			}

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);
		matches.forEach((match) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "focus";
			buttonElement.dataset.publicId = match.public_id || "";
			buttonElement.textContent = match.name || "Unbenannter Ort";
			sectionElement.appendChild(buttonElement);
			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				sectionElement.appendChild(acceptButtonElement);
			}
		});
		bodyElement.appendChild(sectionElement);
	}

	if (candidates.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Wiki-Kandidaten";
		sectionElement.appendChild(labelElement);
		candidates.forEach((candidate, index) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "resolve";
			buttonElement.dataset.candidateIndex = String(index);
			buttonElement.textContent = `${candidate.title || "Wiki-Kandidat"}${candidate.score ? ` (${Math.round(Number(candidate.score) * 100)}%)` : ""}`;
			sectionElement.appendChild(buttonElement);
		});
		bodyElement.appendChild(sectionElement);
	}
}

function appendWikiSyncCaseActions(bodyElement, caseEntry) {
	const actionsElement = document.createElement("div");
	actionsElement.className = "wiki-sync-case__actions";

	if (caseEntry.status === "archived" || caseEntry.status === "deferred") {
		actionsElement.appendChild(createWikiSyncActionButton("reopen", "Wieder öffnen", "wiki-sync-case__action--primary"));
	}

	if (caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status === "open" && isWikiSyncCreateLocationSelectionActive && wikiSyncCreateLocationContextLatLng) {
		actionsElement.appendChild(createWikiSyncActionButton("select-wiki-location", "Diesen Ort wählen", "wiki-sync-case__action--primary"));
	} else if (caseEntry.case_type !== "missing_wiki_with_coordinates") {
		actionsElement.appendChild(createWikiSyncActionButton("focus", "Anzeigen", "wiki-sync-case__action--primary"));
	}

	if (canResolveWikiSyncCase(caseEntry)) {
		const label = caseEntry.case_type === "missing_wiki_without_coordinates" ? "Position wählen" : "Lösen";
		const action = caseEntry.case_type === "missing_wiki_without_coordinates" ? "pick-position" : "resolve";
		actionsElement.appendChild(createWikiSyncActionButton(action, label, "wiki-sync-case__action--primary"));
	}

	actionsElement.appendChild(createWikiSyncActionButton("defer", "Zurückstellen", "wiki-sync-case__action--danger"));
	actionsElement.appendChild(createWikiSyncActionButton("archive", "Archivieren", "wiki-sync-case__action--danger"));
	bodyElement.appendChild(actionsElement);
}

function createWikiSyncActionButton(action, label, className) {
	const buttonElement = document.createElement("button");
	buttonElement.type = "button";
	buttonElement.className = `wiki-sync-case__action ${className}`;
	buttonElement.dataset.wikiSyncAction = action;
	buttonElement.textContent = label;
	return buttonElement;
}

function appendWikiSyncInfoRow(bodyElement, label, value) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const valueElement = document.createElement("span");
	valueElement.className = "wiki-sync-case__row-value";
	valueElement.textContent = value || "-";
	rowElement.append(labelElement, valueElement);
	bodyElement.appendChild(rowElement);
}

function appendWikiSyncLinkRow(bodyElement, label, text, url) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const linkElement = document.createElement("a");
	linkElement.className = "wiki-sync-case__row-value";
	linkElement.href = url || "#";
	linkElement.target = "_blank";
	linkElement.rel = "noopener";
	linkElement.textContent = text || url || "-";
	rowElement.append(labelElement, linkElement);
	bodyElement.appendChild(rowElement);
}

function canResolveWikiSyncCase(caseEntry) {
	if (caseEntry.case_type === "unresolved_without_candidate" || caseEntry.case_type === "duplicate_avesmaps_name") {
		return false;
	}

	return caseEntry.status === "open";
}

function getWikiSyncCaseTitle(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapName = payload.map?.name || "";
	const wikiTitle = payload.wiki?.title || "";

	if (caseEntry.case_type === "missing_wiki_with_coordinates" || caseEntry.case_type === "missing_wiki_without_coordinates") {
		return wikiTitle || "Fehlender Wiki-Ort";
	}

	if (caseEntry.case_type === "duplicate_wiki_title") {
		return wikiTitle || "Mehrfachzuordnung";
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		const duplicateCount = Array.isArray(payload.matches) ? payload.matches.length : 0;
		return `${payload.name || "Unbenannter Ort"} (${duplicateCount} Dubletten)`;
	}

	return mapName && wikiTitle ? `${mapName} ↔ ${wikiTitle}` : mapName || wikiTitle || "WikiSync-Fall";
}

function formatWikiSyncCaseStatus(status) {
	const labels = {
		open: "offen",
		resolved: "gelöst",
		deferred: "zurückgestellt",
		archived: "archiviert",
	};

	return labels[status] || status || "offen";
}

function formatWikiSyncMatchKind(matchKind) {
	const labels = {
		exact: "exakter Titel",
		redirect: "Wiki-Weiterleitung",
		normalized: "normalisierter Titel",
		search: "Wiki-Suche",
	};

	return labels[matchKind] || matchKind || "-";
}

function findWikiSyncCaseFromElement(element) {
	const caseElement = element?.closest?.(".wiki-sync-case");
	const caseId = Number(caseElement?.dataset.caseId);
	return wikiSyncCases.find((caseEntry) => Number(caseEntry.id) === caseId) || null;
}

async function handleWikiSyncCaseActionClick(event) {
	const buttonElement = event.currentTarget;
	const caseEntry = findWikiSyncCaseFromElement(buttonElement);
	if (!caseEntry) {
		return;
	}

	event.preventDefault();
	const action = buttonElement.dataset.wikiSyncAction || "";
	const selectedMap = findWikiSyncMapInCase(caseEntry, buttonElement.dataset.publicId || "");
	const selectedWiki = findWikiSyncCandidateInCase(caseEntry, buttonElement.dataset.candidateIndex);

	if (action === "focus") {
		focusWikiSyncCase(caseEntry, { mapPlace: selectedMap });
		return;
	}

	if (action === "resolve") {
		openWikiSyncResolveDialogForCase(caseEntry, { mapPlace: selectedMap, wikiCandidate: selectedWiki });
		return;
	}

	if (action === "pick-position") {
		startWikiSyncLocationPick(caseEntry);
		return;
	}

	if (action === "select-wiki-location") {
		openWikiSyncCreateLocationDialogFromCase(caseEntry);
		return;
	}

	if (action === "defer") {
		await updateWikiSyncCaseStatus(caseEntry, "defer_case", "Fall zurückgestellt.");
		return;
	}

	if (action === "archive") {
		await updateWikiSyncCaseStatus(caseEntry, "archive_case", "Fall archiviert.");
		return;
	}

	if (action === "reopen") {
		await updateWikiSyncCaseStatus(caseEntry, "reopen_case", "Fall wieder geöffnet.");
	}
}

async function updateWikiSyncCaseStatus(caseEntry, action, successMessage) {
	try {
		await submitWikiSyncAction(action, { case_id: Number(caseEntry.id) });
		showFeedbackToast(successMessage, "success");
		await loadWikiSyncCases();
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht aktualisiert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht aktualisiert werden.", "warning");
	}
}

async function archiveWikiSyncCreatedLocationCase(caseId, feature = null) {
	const numericCaseId = Number(caseId);
	if (!Number.isInteger(numericCaseId) || numericCaseId < 1) {
		return false;
	}

	try {
		const payload = { case_id: numericCaseId };
		if (feature) {
			payload.resolution = { feature };
		}
		await submitWikiSyncAction("archive_case", payload);
		await loadWikiSyncCases();
		return true;
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht archiviert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht archiviert werden.", "warning");
		return false;
	}
}

function findWikiSyncMapInCase(caseEntry, publicId = "") {
	const payload = caseEntry.payload || {};
	if (payload.map && (!publicId || payload.map.public_id === publicId)) {
		return payload.map;
	}

	const resolvedFeature = getWikiSyncResolvedFeature(caseEntry);
	if (resolvedFeature && (!publicId || resolvedFeature.public_id === publicId)) {
		return resolvedFeature;
	}

	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	return matches.find((match) => !publicId || match.public_id === publicId) || null;
}

function findWikiSyncCandidateInCase(caseEntry, indexValue) {
	const candidateIndex = Number(indexValue);
	if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
		return null;
	}

	const candidates = Array.isArray(caseEntry.payload?.candidates) ? caseEntry.payload.candidates : [];
	return candidates[candidateIndex] || null;
}

function focusWikiSyncCase(caseEntry, { mapPlace = null } = {}) {
	const payload = caseEntry.payload || {};
	const selectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	if (selectedMap?.public_id) {
		const markerEntry = findLocationMarkerByPublicId(selectedMap.public_id);
		if (markerEntry) {
			map.flyTo(markerEntry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.8 });
			markerEntry.marker.openPopup();
			return;
		}

		const lat = Number(selectedMap.lat);
		const lng = Number(selectedMap.lng);
		const latlng = Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
		if (latlng && isWithinMapBounds(latlng)) {
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (payload.proposed_location) {
		const latlng = L.latLng(Number(payload.proposed_location.lat), Number(payload.proposed_location.lng));
		if (isWithinMapBounds(latlng)) {
			showWikiSyncPreviewMarker(caseEntry, latlng);
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (caseEntry.case_type === "missing_wiki_with_coordinates") {
		return;
	}

	showFeedbackToast("Dieser WikiSync-Fall hat keine Kartenposition.", "warning");
}

function clearWikiSyncPreviewMarker() {
	if (!wikiSyncPreviewMarker) {
		return;
	}

	map.removeLayer(wikiSyncPreviewMarker);
	wikiSyncPreviewMarker = null;
}

function showWikiSyncPreviewMarker(caseEntry, latlng) {
	clearWikiSyncPreviewMarker();
	const wikiPage = caseEntry.payload?.wiki || {};
	wikiSyncPreviewMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 13,
		color: "#6a4c9c",
		weight: 4,
		fillColor: "#ffffff",
		fillOpacity: 0.96,
	}).addTo(map);
	wikiSyncPreviewMarker.bindTooltip(wikiPage.title || "WikiSync", {
		permanent: true,
		direction: "top",
		className: "wiki-sync-preview-tooltip",
		offset: [0, -12],
	}).openTooltip();
}

function startWikiSyncLocationPick(caseEntry) {
	pendingWikiSyncLocationPickCase = caseEntry;
	map.off("click", handleWikiSyncLocationPick);
	map.once("click", handleWikiSyncLocationPick);
	setWikiSyncStatus("Klick zur Erstellung auf die Karte.", "pending");
	showFeedbackToast("Klick zur Erstellung auf die Karte.", "info");
}

function handleWikiSyncLocationPick(event) {
	const caseEntry = pendingWikiSyncLocationPickCase;
	pendingWikiSyncLocationPickCase = null;
	if (!caseEntry) {
		return;
	}

	const latlng = L.latLng(event.latlng);
	if (!isWithinMapBounds(latlng)) {
		showFeedbackToast("Diese Position liegt ausserhalb der Karte.", "warning");
		return;
	}

	showWikiSyncPreviewMarker(caseEntry, latlng);
	openWikiSyncResolveDialogForCase(caseEntry, { latlng });
}

function openWikiSyncResolveDialogForCase(caseEntry, { mapPlace = null, wikiCandidate = null, latlng = null } = {}) {
	resetWikiSyncResolveForm();
	activeWikiSyncCase = caseEntry;
	activeWikiSyncSelectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	activeWikiSyncSelectedWiki = wikiCandidate || caseEntry.payload?.wiki || null;
	if (!activeWikiSyncSelectedWiki && Array.isArray(caseEntry.payload?.candidates) && caseEntry.payload.candidates.length > 0) {
		activeWikiSyncSelectedWiki = caseEntry.payload.candidates[0];
	}

	const presets = buildWikiSyncResolvePresets(caseEntry, { mapPlace: activeWikiSyncSelectedMap, wikiPage: activeWikiSyncSelectedWiki, latlng });
	activeWikiSyncPreset = presets;
	document.getElementById("wiki-sync-resolve-case-id").value = String(caseEntry.id || "");
	document.getElementById("wiki-sync-resolve-public-id").value = activeWikiSyncSelectedMap?.public_id || "";
	document.getElementById("wiki-sync-resolve-expected-revision").value = activeWikiSyncSelectedMap?.revision || "";
	document.getElementById("wiki-sync-resolve-lat").value = presets.wiki.lat === null ? "" : Number(presets.wiki.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = presets.wiki.lng === null ? "" : Number(presets.wiki.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = presets.wiki.lat === null || presets.wiki.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(presets.wiki.lat, presets.wiki.lng));
	void acquireFeatureSoftLock(activeWikiSyncSelectedMap?.public_id || "");

	applyWikiSyncResolvePreset("wiki");
	setWikiSyncResolveDialogOpen(true);
}

function buildWikiSyncResolvePresets(caseEntry, { mapPlace = null, wikiPage = null, latlng = null } = {}) {
	const payload = caseEntry.payload || {};
	const mapLatLng = normalizeWikiSyncLatLng(mapPlace ? { lat: mapPlace.lat, lng: mapPlace.lng } : null);
	const proposedLocation = latlng || payload.proposed_location || mapLatLng || null;
	const currentLatLng = normalizeWikiSyncLatLng(mapLatLng || proposedLocation);
	const wikiLatLng = normalizeWikiSyncLatLng(proposedLocation || mapLatLng);
	const mapSubtype = normalizeLocationType(mapPlace?.settlement_class || "dorf");
	const wikiSubtype = normalizeLocationType(wikiPage?.settlement_class || mapSubtype);
	const currentWikiUrl = mapPlace?.wiki_url || wikiPage?.url || "";
	const currentName = mapPlace?.name || wikiPage?.title || "";

	return {
		avesmap: {
			name: currentName,
			feature_subtype: mapSubtype,
			description: mapPlace?.description || "",
			wiki_url: currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: currentLatLng?.lat ?? null,
			lng: currentLatLng?.lng ?? null,
		},
		wiki: {
			name: wikiPage?.title || currentName,
			feature_subtype: wikiSubtype,
			description: mapPlace?.description || "",
			wiki_url: wikiPage?.url || currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: wikiLatLng?.lat ?? null,
			lng: wikiLatLng?.lng ?? null,
		},
	};
}

function normalizeWikiSyncLatLng(value) {
	if (!value) {
		return null;
	}

	const lat = Number(value.lat);
	const lng = Number(value.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	return L.latLng(lat, lng);
}

function applyWikiSyncResolvePreset(kind) {
	if (!activeWikiSyncPreset) {
		return;
	}

	const preset = activeWikiSyncPreset[kind] || activeWikiSyncPreset.wiki;
	document.getElementById("wiki-sync-resolve-name").value = preset.name || "";
	document.getElementById("wiki-sync-resolve-type").value = normalizeLocationType(preset.feature_subtype || "dorf");
	document.getElementById("wiki-sync-resolve-description").value = preset.description || "";
	document.getElementById("wiki-sync-resolve-wiki-url").value = preset.wiki_url || "";
	document.getElementById("wiki-sync-resolve-is-nodix").checked = Boolean(preset.is_nodix);
	document.getElementById("wiki-sync-resolve-is-ruined").checked = Boolean(preset.is_ruined);
	document.getElementById("wiki-sync-resolve-lat").value = preset.lat === null ? "" : Number(preset.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = preset.lng === null ? "" : Number(preset.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = preset.lat === null || preset.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(preset.lat, preset.lng));
	syncWikiSyncResolveLinkButton();

	document.getElementById("wiki-sync-preset-wiki")?.classList.toggle("is-active", kind === "wiki");
	document.getElementById("wiki-sync-preset-avesmap")?.classList.toggle("is-active", kind === "avesmap");
}

function syncWikiSyncResolveLinkButton() {
	const inputElement = document.getElementById("wiki-sync-resolve-wiki-url");
	const buttonElement = document.getElementById("wiki-sync-resolve-wiki-open");
	if (!(buttonElement instanceof HTMLButtonElement)) {
		return;
	}

	const urlValue = String(inputElement?.value || "").trim();
	buttonElement.disabled = urlValue === "";
	buttonElement.title = urlValue === "" ? "Kein Wiki-Link vorhanden" : "Wiki-Link in neuem Fenster öffnen";
	buttonElement.setAttribute("aria-label", buttonElement.title);
}

function openWikiSyncResolveWikiLink() {
	const urlValue = String(document.getElementById("wiki-sync-resolve-wiki-url")?.value || "").trim();
	if (urlValue === "") {
		showFeedbackToast("Kein Wiki-Link vorhanden.", "warning");
		return;
	}

	try {
		const parsedUrl = new URL(urlValue);
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error("Ungültiges Protokoll");
		}

		window.open(parsedUrl.href, "_blank", "noopener,noreferrer");
	} catch (error) {
		showFeedbackToast("Der Wiki-Link ist ungültig.", "warning");
	}
}

async function handleWikiSyncResolveFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const formData = new FormData(formElement);
	const payload = {
		case_id: Number(formData.get("case_id")),
		public_id: String(formData.get("public_id") || "").trim(),
		expected_revision: String(formData.get("expected_revision") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "dorf").trim(),
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		is_nodix: formData.get("is_nodix") === "on",
		is_ruined: formData.get("is_ruined") === "on",
		lat: Number.parseFloat(String(formData.get("lat") || "")),
		lng: Number.parseFloat(String(formData.get("lng") || "")),
	};

	if (!payload.public_id && (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !isWithinMapBounds(L.latLng(payload.lat, payload.lng)))) {
		setWikiSyncResolveStatus("Für eine Neuanlage fehlt eine gültige Position.", "error");
		return;
	}

	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: activeWikiSyncSelectedMap?.name || "",
	});
	if (duplicateLocation) {
		setWikiSyncResolveStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}

	setWikiSyncResolveSubmitPending(true);
	setWikiSyncResolveStatus("WikiSync-Fall wird gespeichert...", "pending");
	try {
		const result = await submitWikiSyncAction("resolve_case", payload);
		if (result.feature) {
			const markerEntry = findLocationMarkerByPublicId(result.feature.public_id);
			if (markerEntry) {
				applyFeatureResponseToMarker(markerEntry, result.feature);
			} else {
				addCreatedLocationMarker(result.feature);
			}
			updateRevisionFromEditResponse(result);
		}

		clearWikiSyncPreviewMarker();
		void loadChangeLog();
		setWikiSyncResolveSubmitPending(false);
		setWikiSyncResolveDialogOpen(false, { resetForm: true });
		await loadWikiSyncCases();
		showFeedbackToast("WikiSync-Fall gelöst.", "success");
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht gelöst werden:", error);
		setWikiSyncResolveStatus(error.message || "WikiSync-Fall konnte nicht gelöst werden.", "error");
	} finally {
		setWikiSyncResolveSubmitPending(false);
	}
}

function formatChangeAction(action) {
	if (String(action || "").startsWith("undo_")) {
		return `Rückgängig: ${formatChangeAction(String(action).replace(/^undo_/, ""))}`;
	}

	const labels = {
		move_point: "Ort verschoben",
		update_point: "Ort geändert",
		create_point: "Ort erstellt",
		wiki_sync_update_point: "WikiSync: Ort geändert",
		wiki_sync_create_point: "WikiSync: Ort erstellt",
		create_crossing: "Kreuzung erstellt",
		create_powerline: "Kraftlinie erstellt",
		update_powerline_details: "Kraftlinie geändert",
		create_path: "Weg erstellt",
		update_path_details: "Weg geändert",
		update_path_geometry: "Wegverlauf geändert",
		create_label: "Label erstellt",
		update_label: "Label geändert",
		move_label: "Label verschoben",
		create_region: "Region erstellt",
		update_region: "Region geändert",
		update_region_geometry: "Regionsgrenze geändert",
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
		const itemElement = document.createElement("article");
		itemElement.className = "change-log-entry";
		itemElement.tabIndex = 0;
		itemElement.setAttribute("role", "button");
		itemElement.dataset.changeId = String(entry.id || "");
		itemElement.dataset.publicId = entry.public_id || "";
		itemElement.dataset.featureType = entry.feature_type || "";
		itemElement.dataset.action = entry.action || "";
		itemElement.classList.toggle("is-undone", Boolean(entry.undone));
		itemElement.innerHTML = `
			<span class="change-log-entry__action"></span>
			<span class="change-log-entry__target"></span>
			<span class="change-log-entry__meta"></span>
			<span class="change-log-entry__state"></span>
			<span class="change-log-entry__actions"></span>
		`;
		itemElement.querySelector(".change-log-entry__action").textContent = formatChangeAction(entry.action);
		itemElement.querySelector(".change-log-entry__target").textContent = entry.name || entry.feature_subtype || entry.public_id || "Unbenannt";
		itemElement.querySelector(".change-log-entry__meta").textContent = `${entry.username || "unbekannt"} · ${entry.created_at || ""}`;
		const stateElement = itemElement.querySelector(".change-log-entry__state");
		if (entry.undone) {
			stateElement.textContent = `Rückgängig gemacht${entry.undone_username ? ` von ${entry.undone_username}` : ""}`;
		} else {
			stateElement.hidden = true;
		}
		const actionsElement = itemElement.querySelector(".change-log-entry__actions");
		if (entry.can_undo) {
			const undoButtonElement = document.createElement("button");
			undoButtonElement.type = "button";
			undoButtonElement.className = "change-log-entry__undo";
			undoButtonElement.textContent = "Rückgängig";
			actionsElement.appendChild(undoButtonElement);
		} else {
			actionsElement.hidden = true;
		}
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

function clearChangeLogFocusMarker() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
		changeLogFocusMarkerTimeout = null;
	}
	if (!changeLogFocusMarker) {
		return false;
	}

	map.removeLayer(changeLogFocusMarker);
	changeLogFocusMarker = null;
	return true;
}

function scheduleChangeLogFocusMarkerRemoval() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
	}

	changeLogFocusMarkerTimeout = window.setTimeout(() => {
		clearChangeLogFocusMarker();
	}, CHANGE_LOG_FOCUS_MARKER_TTL_MS);
}

function getChangeLogFocusTooltip(entry) {
	return `${formatChangeAction(entry.action)} · ${entry.name || entry.feature_subtype || entry.public_id || "Änderung"}`;
}

function focusAuditChangeTarget(entry) {
	const focus = entry?.focus || null;
	if (!focus) {
		return false;
	}

	const latlng = L.latLng(Number(focus.lat), Number(focus.lng));
	if (!isWithinMapBounds(latlng)) {
		return false;
	}

	clearChangeLogFocusMarker();
	if (focus.type === "bounds" && Array.isArray(focus.bounds) && focus.bounds.length === 2) {
		const bounds = L.latLngBounds(focus.bounds.map((coordinate) => L.latLng(Number(coordinate[0]), Number(coordinate[1]))));
		changeLogFocusMarker = L.rectangle(bounds, {
			pane: "measurementPane",
			color: "#31536f",
			weight: 3,
			fillColor: "#ffffff",
			fillOpacity: 0.08,
			interactive: false,
		}).addTo(map);
		changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
			permanent: true,
			direction: "center",
			className: "change-log-focus-tooltip",
		}).openTooltip();
		scheduleChangeLogFocusMarkerRemoval();
		map.fitBounds(bounds, { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
		return true;
	}

	changeLogFocusMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 9,
		color: "#31536f",
		weight: 3,
		fillColor: "#ffffff",
		fillOpacity: 0.95,
	}).addTo(map);
	changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
		permanent: true,
		direction: "top",
		className: "change-log-focus-tooltip",
		offset: [0, -10],
	}).openTooltip();
	changeLogFocusMarker.on("click", clearChangeLogFocusMarker);
	scheduleChangeLogFocusMarkerRemoval();
	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
	return true;
}

function focusChangeLogEntry(entry) {
	if (focusAuditChangeTarget(entry)) {
		return;
	}

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

function getLatestUndoableChangeLogEntry() {
	return changeLogEntries.find((entry) => entry?.can_undo) || null;
}

async function undoLastChangeLogEntry() {
	let entry = getLatestUndoableChangeLogEntry();
	if (!entry) {
		await loadChangeLog();
		entry = getLatestUndoableChangeLogEntry();
	}
	if (!entry) {
		showFeedbackToast("Keine Änderung zum Rückgängigmachen.", "info");
		return;
	}

	await undoChangeLogEntry(entry);
}

async function undoChangeLogEntry(entry) {
	if (isChangeUndoPending) {
		return;
	}
	if (!entry?.can_undo) {
		showFeedbackToast("Diese Änderung kann nicht rückgängig gemacht werden.", "warning");
		return;
	}

	isChangeUndoPending = true;
	setChangePanelStatus("Änderung wird rückgängig gemacht...", "pending");
	try {
		const result = await undoMapAuditChange(Number(entry.id));
		applyMapFeatureEditResult(result);
		updateRevisionFromEditResponse(result);
		await loadChangeLog();
		void loadReviewReports();
		void loadWikiSyncCases();
		showFeedbackToast(`${formatChangeAction(entry.action)} rückgängig gemacht.`, "success");
	} catch (error) {
		console.error("Änderung konnte nicht rückgängig gemacht werden:", error);
		showFeedbackToast(error.message || "Änderung konnte nicht rückgängig gemacht werden.", "warning");
		await loadChangeLog();
	} finally {
		isChangeUndoPending = false;
	}
}

function isTextEditingShortcutTarget(target) {
	const element = target instanceof Element ? target : null;
	if (!element) {
		return false;
	}

	return Boolean(element.isContentEditable || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function handleChangeLogUndoShortcut(event) {
	const key = String(event.key || "").toLowerCase();
	if (!IS_EDIT_MODE || key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) {
		return false;
	}
	if (isTextEditingShortcutTarget(event.target)) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	void undoLastChangeLogEntry();
	return true;
}

function attachActiveReviewReportContext(payload) {
	if (activeReviewReportId) {
		payload.review_report_id = activeReviewReportId;
		payload.review_report_source = activeReviewReportSource || "location_reports";
	}

	return payload;
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
		setPresencePanelStatus(error.message || "Nutzerstatus konnte nicht geladen werden.", "error");
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
		setPresencePanelStatus("Keine review-berechtigten Nutzer gefunden.", "empty");
		return;
	}

	const onlineUsers = editorPresenceUsers.filter((user) => Boolean(user.is_online));
	const offlineUsers = editorPresenceUsers.filter((user) => !user.is_online);
	setPresencePanelStatus(
		offlineUsers.length > 0
			? `${onlineUsers.length} online, ${offlineUsers.length} offline.`
			: `${onlineUsers.length} Nutzer online.`,
		onlineUsers.length > 0 ? "success" : "empty"
	);

	renderPresenceUserGroup(listElement, "Online", onlineUsers, "online");
	renderPresenceUserGroup(listElement, "Offline", offlineUsers, "offline");
}

function renderPresenceUserGroup(listElement, title, users, state) {
	if (!listElement || !Array.isArray(users) || users.length < 1) {
		return;
	}

	const groupElement = document.createElement("section");
	groupElement.className = "presence-user-group";
	groupElement.innerHTML = `
		<h3 class="presence-user-group__title"></h3>
		<div class="presence-user-group__list"></div>
	`;
	groupElement.querySelector(".presence-user-group__title").textContent = `${title} (${users.length})`;

	const groupListElement = groupElement.querySelector(".presence-user-group__list");
	users.forEach((user) => {
		const itemElement = document.createElement("article");
		itemElement.className = `presence-user presence-user--${state}`;
		itemElement.innerHTML = `
			<span class="presence-user__dot" aria-hidden="true"></span>
			<span class="presence-user__body">
				<span class="presence-user__name"></span>
				<span class="presence-user__meta"></span>
			</span>
		`;
		itemElement.querySelector(".presence-user__name").textContent = user.username || "Editor";
		const presenceAge = formatPresenceAge(user.seconds_since_seen);
		const roleLabel = formatPresenceRole(user.role);
		const stateLabel = user.is_online ? "online" : "offline";
		itemElement.querySelector(".presence-user__meta").textContent = [roleLabel, stateLabel, presenceAge].filter(Boolean).join(" · ");
		groupListElement.appendChild(itemElement);
	});

	listElement.appendChild(groupElement);
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

	const payload = attachActiveReviewReportContext(buildLocationEditPayload(formElement));
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
		const responseFeature = pendingCrossingConversionPublicId === payload.public_id
			? { ...result.feature, name: result.feature?.name || payload.name }
			: result.feature;
		if (locationEditMarkerEntry) {
			applyFeatureResponseToMarker(locationEditMarkerEntry, responseFeature);
			if (pendingCrossingConversionPublicId === payload.public_id) {
				ensureLocationNameLabel(locationEditMarkerEntry);
				syncLocationNameLabelVisibility();
			}
		} else {
			addCreatedLocationMarker(responseFeature);
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
		const wikiSyncCreatedCaseId = wikiSyncCreateLocationCaseId;
		if (wikiSyncCreatedCaseId) {
			const archived = await archiveWikiSyncCreatedLocationCase(wikiSyncCreatedCaseId, responseFeature || result.feature || null);
			resetWikiSyncCreateLocationFlowState();
			if (archived) {
				setWikiSyncStatus("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
				showFeedbackToast("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
			} else {
				showFeedbackToast("Ort wurde gespeichert, die Wiki-Meldung konnte noch nicht archiviert werden.", "warning");
			}
		} else {
			resetWikiSyncCreateLocationFlowState();
		}
		setLocationEditSubmitPending(false);
		setLocationEditDialogOpen(false, { resetForm: true });
		if (!wikiSyncCreatedCaseId) {
			showFeedbackToast("Ort gespeichert.", "success");
		}
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
	const isAutoNameEnabled = formElement.querySelector("#path-edit-autoname")?.checked === true;
	setPathEditStatus("Weg wird gespeichert...", "pending");
	setPathEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		applyPathFeatureResponse(pathEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		rememberPathEditSettingsFromPayload(payload, { autoname: isAutoNameEnabled });
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

	const payload = attachActiveReviewReportContext(buildLabelEditPayload(formElement));
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
	snapshotActiveRegionEditTab();
	const payload = buildRegionEditPayload(formElement);
	const payloads = payload.source === "political_territory" && regionEditTabs.length > 0
		? regionEditTabs.map((tab) => tab.payload || regionEditPayloadToPayload(tab.region)).filter(Boolean)
		: [payload];
	if (payload.source !== "political_territory" && !isSqlMapFeatureId(payload.public_id)) {
		setRegionEditStatus("Diese Region hat keine gueltige SQL-ID. Bitte die SQL-Karte neu laden.", "error");
		return;
	}
	try {
		let latestResult = null;
		if (payload.source === "political_territory") {
			for (const tab of regionEditTabs) {
				latestResult = await saveRegionEditTab(tab);
			}
			await loadPoliticalTerritoryOptions();
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		} else {
			latestResult = await submitMapFeatureEdit(payloads[0]);
			updateRevisionFromEditResponse(latestResult);
			void loadChangeLog();
		}
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast(payloads.length > 1 ? `${payloads.length} Herrschaftsgebiete gespeichert.` : "Herrschaftsgebiet gespeichert.", "success");
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
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
