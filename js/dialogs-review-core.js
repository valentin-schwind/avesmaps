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
	const hasOpenModal = !$("#legal-overlay").prop("hidden") || !$("#spotlight-search-overlay").prop("hidden") || !$("#political-territory-editor-overlay").prop("hidden") || !$("#location-report-overlay").prop("hidden") || !$("#location-edit-overlay").prop("hidden") || !$("#wiki-sync-resolve-overlay").prop("hidden") || !$("#path-edit-overlay").prop("hidden") || !$("#powerline-edit-overlay").prop("hidden") || !$("#label-edit-overlay").prop("hidden") || !$("#region-edit-overlay").prop("hidden") || !$("#region-wiki-picker-overlay").prop("hidden");
	$("body").toggleClass("modal-dialog-open", hasOpenModal);
}
