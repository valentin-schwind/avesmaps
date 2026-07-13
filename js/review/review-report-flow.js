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
