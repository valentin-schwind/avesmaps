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
	// Entwurf 2026-09-14 §3.5: der Gruppenmodus endet mit jedem Zuruecksetzen -- sonst oeffnete der naechste
	// Abschnitt mit den Haken der vorigen Strasse.
	if (typeof pathEditGruppenModusBeenden === "function") {
		pathEditGruppenModusBeenden();
	}
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
