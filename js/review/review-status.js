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

/**
 * Statuszeile MIT Verweis auf den Ort, der ein Speichern blockiert hat.
 *
 * 🔴 DER VERWEIS GEHOERT NICHT IN DEN MELDUNGSTEXT. Der Satz („Ein Ort namens … existiert bereits")
 * steht wortgleich in PHP (avesmapsDuplicateLocationNameMessage) und JS
 * (duplicateLocationNameMessage) und wird ueberall per textContent gesetzt -- Markup darin
 * erschiene roh, und die ohnehin doppelte Pflege verdoppelte sich noch einmal. Die Kennung reist
 * daneben (client: der gefundene Eintrag selbst, server: `error.duplicate_location`), und erst hier
 * wird daraus ein Knopf.
 * ⚠️ setDialogStatus setzt textContent und raeumt damit einen alten Knopf mit weg -- deshalb erst
 * den Text, dann den Verweis, nie umgekehrt.
 * 💣 Der Knopf SCHLIESST den Dialog, ohne das Formular zu leeren: er ist `aria-modal`, und die
 * Karte darunter waere sonst unerreichbar -- der Verweis fuehrte an einen Ort, den niemand sieht.
 */
function setDialogStatusWithBlockingLocation(statusElement, message, type, blockingLocation, onFollow) {
	setDialogStatus(statusElement, message, type);
	if (!statusElement || !blockingLocation || !blockingLocation.publicId) {
		return;
	}

	const link = document.createElement("button");
	link.type = "button";
	link.className = "dialog-status__link";
	link.textContent = "Ort anzeigen";
	// ⚠️ Die Folge steht im Titel: der Dialog geht zu. Das Formular wird dabei NICHT geleert
	// (setLocationEditDialogOpen ohne resetForm), ein erneutes Oeffnen befuellt es aber aus dem
	// Marker neu -- praktisch ist der Sprung also einer ohne Rueckweg, und das gehoert dazugesagt.
	link.title = `„${blockingLocation.name || ""}“ auf der Karte zeigen – dieser Dialog wird dabei geschlossen`;
	link.addEventListener("click", () => {
		if (typeof onFollow === "function") {
			onFollow();
		}
		// Der Weg, den auch die Bewertungsliste nimmt -- kein zweiter daneben.
		if (typeof focusLocationOnMapByPublicId === "function") {
			focusLocationOnMapByPublicId(blockingLocation.publicId);
		}
	});
	statusElement.appendChild(link);
}

// Der Verweis fuer den Dialog „Ort bearbeiten": Dialog zu (OHNE resetForm -- das Formular bleibt
// stehen), dann den Blocker auf der Karte zeigen.
function setLocationEditStatusWithBlockingLocation(message, blockingLocation) {
	setDialogStatusWithBlockingLocation(getLocationEditStatusElement(), message, "error", blockingLocation, () => {
		if (typeof setLocationEditDialogOpen === "function") {
			setLocationEditDialogOpen(false);
		}
	});
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
