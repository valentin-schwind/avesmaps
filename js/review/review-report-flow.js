function openLocationEditDialogFromReport(report, latlng) {
	openLocationEditDialog({ latlng });
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "location_reports";
	document.getElementById("location-edit-name").value = report.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(report.report_subtype || report.size || "dorf");
	// report.sources is the full reported list (server-decoded). Sources WITH a link become real
	// feature_sources on "Anlegen" (multi-source #3, QUELLEN section, like the manual add flow); link-less
	// sources fall back to "Quelle: X, S. Y" description lines so nothing the reporter typed is lost.
	const reportSources = Array.isArray(report.sources) ? report.sources : [];
	const linkedSources = reportSources.filter((source) => source && source.url && source.label);
	const linklessSources = reportSources.filter((source) => source && source.label && !source.url);
	document.getElementById("location-edit-description").value = [
		String(report.comment || ""),
		...linklessSources.map((source) => `Quelle: ${source.label}${source.pages ? `, S. ${source.pages}` : ""}`),
	].filter(Boolean).join("\n\n");
	document.getElementById("location-edit-wiki-url").value = report.wiki_url || "";
	// Remember the linked sources so create_point can attach each as a feature_source once the new place
	// has a public_id (handleLocationEditFormSubmit).
	activeReviewReportSourceSuggestions = linkedSources.map((source) => ({
		url: String(source.url || ""),
		label: String(source.label || ""),
		pages: String(source.pages || ""),
		source_type: String(source.type || "sonstiges"),
		reference_kind: String(source.reference_kind || ""),
		is_official: Boolean(source.official),
	}));
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

// Community change report ("Änderung vorschlagen"): open the EXISTING settlement in the editor (loaded by
// entity_public_id) with the reporter's proposed values prefilled, the changed fields red-outlined, and the
// proposed position remembered as a pending move (move_point on save -- update_point does NOT carry position).
// Saving then applies details + the move and marks the report approved (review-editor-submit.js).
let pendingChangeReportMove = null;

function openLocationEditDialogFromChangeReport(report) {
	const markerEntry = typeof findLocationMarkerByPublicId === "function"
		? findLocationMarkerByPublicId(report.entity_public_id)
		: null;
	if (!markerEntry) {
		showFeedbackToast("Die gemeldete Siedlung wurde nicht gefunden.", "warning");
		return false;
	}
	void editLocationDetails(markerEntry);
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "map_reports";
	pendingChangeReportMove = null;
	const changed = [];

	// Free-text request -> prepend to the description so the editor sees it.
	const descEl = document.getElementById("location-edit-description");
	const request = String(report.comment || "").trim();
	if (descEl && request) {
		const reporter = String(report.reporter_name || "").trim();
		const header = `— Community-Änderungswunsch${reporter ? ` von ${reporter}` : ""}:`;
		descEl.value = [header, request, String(descEl.value || "").trim()].filter(Boolean).join("\n");
		changed.push("location-edit-description");
	}

	// Proposed size/type -> prefill if it differs from the current type.
	const proposedType = typeof normalizeLocationType === "function"
		? normalizeLocationType(report.report_subtype || report.size || "")
		: String(report.report_subtype || "");
	const typeEl = document.getElementById("location-edit-type");
	if (typeEl && proposedType && proposedType !== String(markerEntry.locationType || "")) {
		typeEl.value = proposedType;
		changed.push("location-edit-type");
	}

	// Proposed wiki link -> prefill if it differs.
	const proposedWiki = String(report.wiki_url || "").trim();
	const wikiEl = document.getElementById("location-edit-wiki-url");
	const currentWiki = String((markerEntry.location && markerEntry.location.wikiUrl) || "").trim();
	if (wikiEl && proposedWiki && proposedWiki !== currentWiki) {
		wikiEl.value = proposedWiki;
		changed.push("location-edit-wiki-url");
	}

	// Proposed position -> pending move_point on save, when it differs meaningfully from the current position.
	const rLat = Number(report.lat);
	const rLng = Number(report.lng);
	const cur = markerEntry.location && Array.isArray(markerEntry.location.coordinates) ? markerEntry.location.coordinates : null;
	if (Number.isFinite(rLat) && Number.isFinite(rLng) && cur
			&& (Math.abs(rLat - Number(cur[0])) > 0.01 || Math.abs(rLng - Number(cur[1])) > 0.01)) {
		pendingChangeReportMove = { markerEntry, latlng: L.latLng(rLat, rLng) };
		const coordEl = document.getElementById("location-edit-coordinates");
		if (coordEl) coordEl.textContent = formatLocationReportCoordinates(L.latLng(rLat, rLng));
		document.getElementById("location-edit-lat").value = rLat.toFixed(3);
		document.getElementById("location-edit-lng").value = rLng.toFixed(3);
		changed.push("location-edit-coordinates");
	}

	markChangeReportFields(changed);
	return true;
}

// Red-outline the fields a change report proposes to change (so the editor sees the diff at a glance).
function markChangeReportFields(fieldIds) {
	clearChangeReportFieldMarks();
	(fieldIds || []).forEach((id) => {
		const el = document.getElementById(id);
		if (el) {
			el.classList.add("field--change-proposed");
		}
	});
}

function clearChangeReportFieldMarks() {
	document.querySelectorAll(".field--change-proposed").forEach((el) => el.classList.remove("field--change-proposed"));
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

function finalizeLocationReportSubmission({ ok, message }) {
	setLocationReportSubmitPending(false);
	updateLocationReportDialogAvailability();

	if (ok) {
		setLocationReportDialogOpen(false, { resetForm: true });
		showFeedbackToast(message || tr("report.toastSubmitted", "Karteneintrag wurde gemeldet."), "success");
		return;
	}

	setLocationReportStatus(message || tr("report.statusSendFailed", "Die Meldung konnte nicht gesendet werden."), "error");
}

async function handleLocationReportFormSubmit(event) {
	event.preventDefault();

	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement) {
		return;
	}

	if (!isLocationReportServiceConfigured()) {
		setLocationReportStatus(tr("report.statusNotConfigured", "Das Meldeformular ist noch nicht mit dem Avesmaps-Server verbunden."), "error");
		return;
	}

	// Aenderungsmodus ("Änderung vorschlagen"): das Element ist ueber entity_public_id eindeutig -> die
	// Neu-Melde-Pruefungen (Position, Quellenpflicht, Duplikat-Name) entfallen, wie schon im Backend.
	const isChangeMode = (document.getElementById("location-report-mode")?.value || "new") === "change";
	if (!isChangeMode && (!locationReportLatLng || !isWithinMapBounds(locationReportLatLng))) {
		setLocationReportStatus(tr("report.statusInvalidPosition", "Die ausgewählte Position ist ungültig."), "error");
		return;
	}

	if (!formElement.reportValidity()) {
		return;
	}

	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	const payload = buildLocationReportRequestPayload(formElement);
	// Multi-source #3: at least one source is required (except pure comments). The single required
	// `source` input is gone -- the list is JS-managed -- so validate it here instead of via reportValidity.
	if (!isChangeMode && payload.report_type !== "comment" && (!Array.isArray(payload.sources) || payload.sources.length === 0)) {
		setLocationReportStatus(tr("report.statusNoSource", "Bitte mindestens eine Quelle angeben (Name genügt)."), "error");
		document.getElementById("report-source-label")?.focus();
		return;
	}
	if (!isChangeMode && payload.report_type === "location") {
		const duplicateLocation = findDuplicateLocationByName(payload.name);
		if (duplicateLocation) {
			setLocationReportStatus(tr("report.statusDuplicate", `Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, { name: duplicateLocation.name }), "error");
			return;
		}
	}
	setLocationReportStatus(tr("report.statusSending", "Meldung wird gesendet..."), "pending");
	setLocationReportSubmitPending(true);

	const result = await submitLocationReportRequest(payload);
	finalizeLocationReportSubmission({
		ok: result.ok,
		message: result.message,
	});
}
