function openLocationEditDialogFromReport(report, latlng) {
	openLocationEditDialog({ latlng });
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "location_reports";
	document.getElementById("location-edit-name").value = report.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(report.report_subtype || report.size || "dorf");
	// A source WITH a link becomes a real feature_source on "Anlegen" (multi-source #3, shows in the
	// QUELLEN section, like the manual add flow). A source WITHOUT a link (feature_sources is link-based)
	// falls back to the old "Quelle: X, S. Y" description line so nothing the reporter typed is lost.
	const hasSourceLink = Boolean(report.source_url);
	document.getElementById("location-edit-description").value = [
		String(report.comment || ""),
		(!hasSourceLink && report.source)
			? `Quelle: ${report.source}${report.pages ? `, S. ${report.pages}` : ""}`
			: "",
	].filter(Boolean).join("\n\n");
	document.getElementById("location-edit-wiki-url").value = report.wiki_url || "";
	// Remember the reported source so create_point can link it as a real feature_source once the new
	// place has a public_id (handleLocationEditFormSubmit).
	activeReviewReportSourceSuggestion = hasSourceLink
		? {
			url: String(report.source_url || ""),
			label: String(report.source || ""),
			pages: String(report.pages || ""),
			source_type: String(report.source_type || "sonstiges"),
			is_official: Number(report.source_official) === 1 || report.source_official === true,
		}
		: null;
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

	if (!locationReportLatLng || !isWithinMapBounds(locationReportLatLng)) {
		setLocationReportStatus(tr("report.statusInvalidPosition", "Die ausgewählte Position ist ungültig."), "error");
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
