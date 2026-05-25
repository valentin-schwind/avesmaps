function setDialogStatus(statusElement, message = "", type = "") {
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

function setLocationReportStatus(message = "", type = "") {
	setDialogStatus(getLocationReportStatusElement(), message, type);
}

function setLocationEditStatus(message = "", type = "") {
	setDialogStatus(getLocationEditStatusElement(), message, type);
}

function setWikiSyncResolveStatus(message = "", type = "") {
	setDialogStatus(getWikiSyncResolveStatusElement(), message, type);
}

function setPathEditStatus(message = "", type = "") {
	setDialogStatus(getPathEditStatusElement(), message, type);
}

function setPowerlineEditStatus(message = "", type = "") {
	setDialogStatus(getPowerlineEditStatusElement(), message, type);
}

function setLabelEditStatus(message = "", type = "") {
	setDialogStatus(getLabelEditStatusElement(), message, type);
}

function setRegionEditStatus(message = "", type = "") {
	setDialogStatus(getRegionEditStatusElement(), message, type);
}

function setReviewPanelStatus(message = "", state = "") {
	setPanelStateStatus(document.getElementById("review-panel-status"), message, state);
}

function setPanelStateStatus(statusElement, message = "", state = "") {
	if (!statusElement) {
		return;
	}

	statusElement.textContent = message || "";
	if (state) {
		statusElement.dataset.state = state;
	} else {
		delete statusElement.dataset.state;
	}
}

function setChangePanelStatus(message = "", state = "") {
	setPanelStateStatus(document.getElementById("change-panel-status"), message, state);
}

function setPresencePanelStatus(message = "", state = "") {
	setPanelStateStatus(document.getElementById("presence-panel-status"), message, state);
}

function setWikiSyncStatus(message = "", state = "") {
	setPanelStateStatus(document.getElementById("wiki-sync-status"), message, state);
}
