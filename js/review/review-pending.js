// 💣 „Deaktiviert" heißt in diesen Formularen ZWEIERLEI, und nur eines davon endet mit dem Absenden:
// „gerade beschäftigt" (dieses Flag) und „hier fest gesperrt" (der Zusammenhang -- etwa die Kategorie
// eines Änderungsvorschlags, die zum angeklickten Element gehört). Wer beim Freigeben nicht
// unterscheidet, hebt beim ERSTEN Fehlschlag die feste Sperre mit auf: das Fenster bleibt offen, und
// die Kategorie steht dem Melder wieder frei -- ein Weg-Vorschlag lässt sich dann als Ort abschicken,
// mit entity_type="path" im selben Rumpf. Ein Feld mit data-lock-reason="context" bleibt gesperrt.
function setFormFieldsDisabled(formElement, isPending) {
	Array.from(formElement.elements).forEach((fieldElement) => {
		if (!(fieldElement instanceof HTMLElement)) {
			return;
		}
		if (!isPending && fieldElement.dataset && fieldElement.dataset.lockReason === "context") {
			return;
		}
		fieldElement.disabled = isPending;
	});
	// „Deaktiviert" heißt in diesen Dialogen zweierlei: gerade beschäftigt (Speichern läuft) ODER
	// hier noch nicht möglich. Ohne Unterschied trug beides den Warte-Cursor, und ein dauerhaft
	// gesperrter Knopf sah aus, als lade die Seite ewig -- so gemeldet für „Zuweisen" beim Anlegen.
	// Diese Klasse markiert NUR den ersten Fall; das CSS hängt den Warte-Cursor daran.
	formElement.classList.toggle("is-busy", Boolean(isPending));
}

// Sperrt ein Feld dauerhaft statt nur für die Dauer des Absendens -- siehe oben. Der einzige Weg,
// eine Sperre zu setzen, die einen Fehlschlag überlebt.
function setFieldContextLocked(fieldElement, isLocked) {
	if (!fieldElement) {
		return;
	}

	fieldElement.disabled = Boolean(isLocked);
	if (isLocked) {
		fieldElement.dataset.lockReason = "context";
	} else {
		delete fieldElement.dataset.lockReason;
	}
}

function setLocationReportSubmitPending(isPending) {
	isLocationReportSubmissionPending = isPending;

	const formElement = getLocationReportFormElement();
	if (!formElement) {
		return;
	}

	setFormFieldsDisabled(formElement, isPending);
	const closeButtonElement = document.getElementById("location-report-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
}

function setLocationEditSubmitPending(isPending) {
	isLocationEditSubmissionPending = isPending;

	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	setFormFieldsDisabled(formElement, isPending);
	const closeButtonElement = document.getElementById("location-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("location-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

function setWikiSyncResolveSubmitPending(isPending) {
	isWikiSyncResolveSubmissionPending = isPending;

	const formElement = getWikiSyncResolveFormElement();
	if (!formElement) {
		return;
	}

	setFormFieldsDisabled(formElement, isPending);
	const closeButtonElement = document.getElementById("wiki-sync-resolve-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("wiki-sync-resolve-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Lösen";
		submitButtonElement.disabled = isPending;
	}
}

function setPathEditSubmitPending(isPending) {
	isPathEditSubmissionPending = isPending;

	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	setFormFieldsDisabled(formElement, isPending);
	const closeButtonElement = document.getElementById("path-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("path-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

function setPowerlineEditSubmitPending(isPending) {
	isPowerlineEditSubmissionPending = isPending;

	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	setFormFieldsDisabled(formElement, isPending);
	const closeButtonElement = document.getElementById("powerline-edit-close");
	if (closeButtonElement) {
		closeButtonElement.disabled = isPending;
	}
	const submitButtonElement = document.getElementById("powerline-edit-submit");
	if (submitButtonElement) {
		submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";
		submitButtonElement.disabled = isPending;
	}
}

// Browser-Skript; der Export ist nur für den Unit-Test da (Hausmuster wie review-locations.js).
if (typeof module !== "undefined" && module.exports) {
	module.exports = { setFormFieldsDisabled, setFieldContextLocked };
}
