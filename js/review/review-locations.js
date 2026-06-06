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
	document.getElementById("location-edit-description").value = presetDescription || "";
	document.getElementById("location-edit-wiki-url").value = presetWikiUrl || location.wikiUrl || wikiLocationLink?.url || "";
	document.getElementById("location-edit-is-nodix").checked = presetIsNodix === null
		? (isCrossingConversion ? pendingCrossingConversionIsNodix : Boolean(location.isNodix))
		: Boolean(presetIsNodix);
	document.getElementById("location-edit-is-ruined").checked = Boolean(location.isRuined);
	if (typeof renderSettlementWikiReference === "function") {
		renderSettlementWikiReference();
	}

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
