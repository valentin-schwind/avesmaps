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
	void renderSettlementCoatSection(markerEntry?.publicId || "");
	// Zuordnung frisch vom Server holen (Browser-Marker kann nach Bulk-Verbinden stale sein).
	if (typeof syncSettlementWikiFromServer === "function") {
		void syncSettlementWikiFromServer();
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

// ===== Wappen-Sektion im „Siedlung bearbeiten"-Dialog =====
const SETTLEMENT_COAT_API_URL = "/api/edit/wiki/settlements.php";

function settlementCoatImageSrc(coat) {
	if (!coat || !coat.url) {
		return "";
	}
	// Eigene Uploads sind lokale URLs; Wiki-Wappen über den Cache-Proxy (Host-Whitelist).
	return coat.source === "own" ? coat.url : `/api/app/coat.php?u=${encodeURIComponent(coat.url)}`;
}

async function renderSettlementCoatSection(publicId) {
	const section = document.getElementById("settlement-coat-section");
	if (!section) {
		return;
	}
	if (!publicId) {
		section.hidden = true;
		section.dataset.publicId = "";
		return;
	}
	const preview = document.getElementById("settlement-coat-preview");
	const status = document.getElementById("settlement-coat-status");
	const adoptBtn = document.getElementById("settlement-coat-adopt");
	const removeBtn = document.getElementById("settlement-coat-remove");
	section.hidden = false;
	section.dataset.publicId = publicId;
	if (preview) {
		preview.className = "settlement-coat__preview";
		preview.innerHTML = "";
	}
	if (status) {
		status.textContent = "Wappen wird geladen …";
	}
	if (adoptBtn) {
		adoptBtn.hidden = true;
	}
	if (removeBtn) {
		removeBtn.hidden = true;
	}
	try {
		const response = await fetch(`${SETTLEMENT_COAT_API_URL}?action=coat_info&public_id=${encodeURIComponent(publicId)}`, { credentials: "same-origin" });
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Fehler");
		}
		if (section.dataset.publicId !== publicId) {
			return; // Dialog inzwischen weitergeschaltet
		}
		const current = data.current && data.current.url ? data.current : null;
		const wiki = data.wiki && data.wiki.url ? data.wiki : null;
		if (current) {
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(current))}" alt="Wappen" />`;
			status.textContent = current.source === "own" ? "Eigenes Wappen aktiv." : "Gemeinfreies Wiki-Wappen aktiv.";
			removeBtn.hidden = false;
			if (wiki && wiki.allowed && (current.source === "own" || current.url !== wiki.url)) {
				adoptBtn.hidden = false;
			}
		} else if (wiki) {
			preview.className = wiki.allowed ? "settlement-coat__preview" : "settlement-coat__preview settlement-coat__preview--dim";
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(wiki))}" alt="Wiki-Wappen" />`;
			if (wiki.allowed) {
				status.textContent = "Gemeinfreies Wiki-Wappen verfügbar.";
				adoptBtn.hidden = false;
			} else {
				status.textContent = "Wiki-Wappen vorhanden, aber nicht gemeinfrei — nicht übernehmbar.";
			}
		} else {
			status.textContent = "Kein Wappen vorhanden.";
		}
	} catch (error) {
		if (status) {
			status.textContent = "Wappen konnte nicht geladen werden.";
		}
	}
}

async function settlementCoatAction(action) {
	const section = document.getElementById("settlement-coat-section");
	const publicId = section?.dataset.publicId || document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId) {
		return;
	}
	try {
		const response = await fetch(SETTLEMENT_COAT_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, public_id: publicId, dry_run: false, confirm: "apply" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Fehler");
		}
		showFeedbackToast?.(action === "set_coat" ? "Wappen übernommen." : "Wappen entfernt.", "success");
		await renderSettlementCoatSection(publicId);
		// Lokalen Marker aktualisieren, damit Infobox/Icon sofort stimmen.
		if (typeof findLocationMarkerByPublicId === "function") {
			const entry = findLocationMarkerByPublicId(publicId);
			if (entry && entry.location) {
				entry.location.coat = action === "clear_coat" ? null : (data.coat || entry.location.coat);
				if (typeof refreshLocationMarkerPopup === "function") {
					refreshLocationMarkerPopup(entry);
				}
			}
		}
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

async function uploadOwnSettlementCoat(file) {
	const section = document.getElementById("settlement-coat-section");
	const publicId = section?.dataset.publicId || document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId || !file) {
		return;
	}
	const status = document.getElementById("settlement-coat-status");
	if (status) {
		status.textContent = "Wappen wird hochgeladen …";
	}
	try {
		const form = new FormData();
		form.append("public_id", publicId);
		form.append("coat", file);
		const response = await fetch("/api/edit/wiki/settlement-coat-upload.php", {
			method: "POST",
			credentials: "same-origin",
			body: form,
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Upload fehlgeschlagen");
		}
		showFeedbackToast?.("Eigenes Wappen hochgeladen.", "success");
		await renderSettlementCoatSection(publicId);
		if (typeof findLocationMarkerByPublicId === "function") {
			const entry = findLocationMarkerByPublicId(publicId);
			if (entry && entry.location) {
				entry.location.coat = data.coat || entry.location.coat;
				if (typeof refreshLocationMarkerPopup === "function") {
					refreshLocationMarkerPopup(entry);
				}
			}
		}
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
		await renderSettlementCoatSection(publicId);
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#settlement-coat-adopt")) {
		event.preventDefault();
		void settlementCoatAction("set_coat");
		return;
	}
	if (event.target.closest("#settlement-coat-remove")) {
		event.preventDefault();
		void settlementCoatAction("clear_coat");
		return;
	}
	// Upload-Button oder Klick auf die Vorschau -> Datei-Auswahl öffnen.
	if (event.target.closest("#settlement-coat-upload") || event.target.closest("#settlement-coat-preview")) {
		event.preventDefault();
		document.getElementById("settlement-coat-file")?.click();
	}
});

document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "settlement-coat-file") {
		const file = event.target.files && event.target.files[0];
		event.target.value = ""; // erneutes Auswählen derselben Datei erlauben
		if (file) {
			void uploadOwnSettlementCoat(file);
		}
	}
});
