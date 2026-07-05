function populatePathEditForm(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name || "Weg");
	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getPathDisplayName(path);
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = true;
	document.getElementById("path-edit-autoname").disabled = false;
	document.getElementById("path-edit-show-label").checked = shouldPathNameBeDisplayed(path);
	const showLabelField = document.getElementById("path-edit-show-label")?.closest("label");
	if (showLabelField) {
		const hasWikiWay = typeof pathWikiCurrentAssignment === "function" && Boolean(pathWikiCurrentAssignment());
		showLabelField.hidden = hasWikiWay; // Way-Labels beschriften zugewiesene Wege automatisch
	}
	syncPathTransportOptions({ path });
	syncPathAutoNameControls();
	if (typeof renderPathWikiReference === "function") {
		renderPathWikiReference();
	}
}

function populatePathEditFormFromLastSettings(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const storedSettings = lastPathEditSettings || {};
	const fallbackSubtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name || "Weg");
	const pathSubtype = normalizePathSubtype(storedSettings.feature_subtype || fallbackSubtype);
	const autoNameEnabled = storedSettings.autoname !== undefined ? Boolean(storedSettings.autoname) : true;
	const showLabelEnabled = storedSettings.show_label !== undefined ? Boolean(storedSettings.show_label) : shouldPathNameBeDisplayed(path);
	const allowedTransports = Array.isArray(storedSettings.allowed_transports) ? storedSettings.allowed_transports : null;

	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getNextPathDisplayName(pathSubtype, { excludePath: pathEditFeature });
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = autoNameEnabled;
	document.getElementById("path-edit-autoname").disabled = false;
	document.getElementById("path-edit-show-label").checked = showLabelEnabled;
	const showLabelFieldFromLastSettings = document.getElementById("path-edit-show-label")?.closest("label");
	if (showLabelFieldFromLastSettings) {
		showLabelFieldFromLastSettings.hidden = false; // neuer Pfad -- noch keine Wiki-Zuweisung
	}
	syncPathTransportOptions({
		path: {
			properties: {
				feature_subtype: pathSubtype,
				allowed_transports: allowedTransports,
			},
		},
		resetToDefault: !allowedTransports,
	});
	syncPathAutoNameControls({ forceName: true });
}

function openPathEditDialog(path, { inheritLastSettings = false } = {}) {
	resetPathEditForm();
	if (inheritLastSettings && lastPathEditSettings) {
		populatePathEditFormFromLastSettings(path);
	} else {
		populatePathEditForm(path);
	}
	setPathEditDialogOpen(true);
}

function populatePowerlineEditForm(powerline) {
	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	powerlineEditFeature = powerline;
	document.getElementById("powerline-edit-public-id").value = powerline.properties?.public_id || powerline.id || "";
	void acquireFeatureSoftLock(document.getElementById("powerline-edit-public-id").value);
	document.getElementById("powerline-edit-name").value = String(powerline.properties?.name || "").trim();
	document.getElementById("powerline-edit-show-label").checked = shouldPowerlineNameBeDisplayed(powerline);
}

function openPowerlineEditDialog(powerline) {
	resetPowerlineEditForm();
	populatePowerlineEditForm(powerline);
	setPowerlineEditDialogOpen(true);
}

function buildPowerlineEditPayload(formElement) {
	const formData = new FormData(formElement);
	return {
		action: "update_powerline_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		show_label: formData.get("show_label") === "on",
	};
}

function buildPathEditPayload(formElement) {
	const formData = new FormData(formElement);
	const featureSubtype = String(formData.get("feature_subtype") || "").trim();
	const isAutoNameEnabled = formData.get("autoname") === "on";
	// R1 defense in depth (the server enforces it too): with a wiki way assigned, the
	// submitted name IS the wiki way name, whatever the input field claims.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	const submittedName = wikiName !== ""
		? wikiName
		: (isAutoNameEnabled
			? String(formData.get("name") || "").trim()
			: getPathDisplayNameOrGenerated(formData.get("name"), featureSubtype, { excludePath: pathEditFeature }));
	return {
		action: "update_path_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: submittedName || getNextPathDisplayName(featureSubtype, { excludePath: pathEditFeature }),
		feature_subtype: featureSubtype,
		show_label: formData.get("show_label") === "on",
		transport_domain: getDefaultTransportDomainForPathSubtype(featureSubtype),
		allowed_transports: Array.from(formElement.querySelectorAll('input[name="allowed_transport"]:checked')).map((input) => input.value),
	};
}

function rememberPathEditSettingsFromPayload(payload, { autoname = true } = {}) {
	lastPathEditSettings = {
		feature_subtype: String(payload?.feature_subtype || "Weg").trim() || "Weg",
		show_label: Boolean(payload?.show_label),
		autoname: Boolean(autoname),
		allowed_transports: Array.isArray(payload?.allowed_transports) ? [...payload.allowed_transports] : [],
	};
}

function getDefaultTransportDomainForPathSubtype(pathSubtype) {
	if (pathSubtype === "Flussweg") return "river";
	if (pathSubtype === "Seeweg") return "sea";
	return "land";
}

function getPathTransportDomain(path) {
	return path?.properties?.transport_domain || getDefaultTransportDomainForPathSubtype(normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name));
}

function getPathAllowedTransports(path) {
	const domain = getPathTransportDomain(path);
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
	const configured = Array.isArray(path?.properties?.allowed_transports) ? path.properties.allowed_transports : null;
	if (configured !== null) {
		return configured.filter((option) => getTransportOptionsForPathSubtype(subtype).includes(option));
	}

	return getTransportOptionsForPathSubtype(subtype);
}

function getTransportOptionsForPathSubtype(pathSubtype) {
	const normalizedSubtype = normalizePathSubtype(pathSubtype);
	const domain = getDefaultTransportDomainForPathSubtype(normalizedSubtype);
	const options = TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	if (normalizedSubtype === "Wuestenpfad") {
		return options.filter((option) => option !== "horseCarriage");
	}

	return options;
}

function syncPathTransportOptions({ path = null, resetToDefault = false } = {}) {
	const subtype = normalizePathSubtype(document.getElementById("path-edit-type")?.value || path?.properties?.feature_subtype || "Weg");
	const defaultOptions = getTransportOptionsForPathSubtype(subtype);
	const selectedOptions = resetToDefault || !path ? defaultOptions : getPathAllowedTransports(path);
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		const isCompatible = defaultOptions.includes(input.value);
		input.closest("label").hidden = !isCompatible;
		input.disabled = !isCompatible;
		input.checked = isCompatible && selectedOptions.includes(input.value);
	});
}

function syncPathAutoNameControls({ forceName = false } = {}) {
	const nameInputElement = document.getElementById("path-edit-name");
	const typeSelectElement = document.getElementById("path-edit-type");
	const autoNameElement = document.getElementById("path-edit-autoname");
	if (!nameInputElement || !typeSelectElement || !autoNameElement) {
		return;
	}

	// R1: an assigned wiki way owns the name -- no auto-name, no manual override. The
	// checkbox is disabled (not just unchecked) so the lock is visible in the form.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	autoNameElement.disabled = wikiName !== "";
	if (wikiName !== "") {
		autoNameElement.checked = false;
		nameInputElement.value = wikiName;
		nameInputElement.readOnly = true;
		return;
	}

	const isAutoNameEnabled = autoNameElement.checked;
	nameInputElement.readOnly = isAutoNameEnabled;
	if (!isAutoNameEnabled) {
		return;
	}

	const selectedSubtype = normalizePathSubtype(typeSelectElement.value);
	const shouldRefreshName = forceName || !nameInputElement.value.trim();
	if (shouldRefreshName) {
		nameInputElement.value = getNextPathDisplayName(selectedSubtype, { excludePath: pathEditFeature });
	}
}
