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

// The WikiSync panel has NO status line any more (owner 2026-07-19: "es braucht kein statusfeld --
// nirgends"). Long-running actions report inside their own button; what is left here are the
// cross-cutting messages that belong to no single control.
//
// Errors and successes go to the toast: it overlays instead of pushing the panel down, which is the
// whole point. Everything else is dropped on purpose -- "… läuft" for an action whose button
// already says so is the duplication that grew the panel to twenty status elements.
//
// Callers are unchanged: dozens of them across five files still call this, and they keep working.
function setWikiSyncStatus(message = "", state = "") {
	if ((state === "error" || state === "success") && message && typeof showFeedbackToast === "function") {
		showFeedbackToast(message, state);
	}
}
