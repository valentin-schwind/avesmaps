function setFormFieldsDisabled(formElement, isPending) {
	Array.from(formElement.elements).forEach((fieldElement) => {
		if (fieldElement instanceof HTMLElement) {
			fieldElement.disabled = isPending;
		}
	});
	// „Deaktiviert" heißt in diesen Dialogen zweierlei: gerade beschäftigt (Speichern läuft) ODER
	// hier noch nicht möglich. Ohne Unterschied trug beides den Warte-Cursor, und ein dauerhaft
	// gesperrter Knopf sah aus, als lade die Seite ewig -- so gemeldet für „Zuweisen" beim Anlegen.
	// Diese Klasse markiert NUR den ersten Fall; das CSS hängt den Warte-Cursor daran.
	formElement.classList.toggle("is-busy", Boolean(isPending));
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
