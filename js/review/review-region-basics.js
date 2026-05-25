function resetRegionEditForm() {
	const formElement = getRegionEditFormElement();
	if (!formElement) return;
	const publicId = document.getElementById("region-edit-public-id").value || "";
	const source = document.getElementById("region-edit-source").value || "";
	formElement.reset();
	regionEditEntry = null;
	regionEditTabs = [];
	activeRegionEditTabKey = "";
	regionParentSelectedTreeId = "";
	regionParentCollapsedKeys = new Set();
	regionAssignmentWikiPath = [];
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = "";
	if (source !== "political_territory") {
		void releaseFeatureSoftLock(publicId);
	}
	document.getElementById("region-edit-public-id").value = "";
	document.getElementById("region-edit-source").value = "";
	document.getElementById("region-edit-territory-public-id").value = "";
	document.getElementById("region-edit-geometry-public-id").value = "";
	document.getElementById("region-edit-wiki-id").value = "";
	document.getElementById("region-edit-delete").hidden = true;
	document.getElementById("region-edit-wiki-url").value = "";
	document.getElementById("region-edit-coat-url").value = "";
	syncRegionCoatPreview();
	regionParentFilterQuery = "";
	document.getElementById("region-edit-parent-filter").value = "";
	document.getElementById("region-edit-parent").value = "";
	updateRegionParentDropTarget("");
	document.getElementById("region-edit-parent-tree").innerHTML = "";
	document.getElementById("region-edit-tabs").innerHTML = "";
	document.getElementById("region-edit-wiki-reference-list").innerHTML = "";
	renderRegionAssignment();
	syncRegionOpacityOutput();
	syncRegionValidToControls();
	setRegionEditStatus();
}

function setRegionEditDialogOpen(isOpen, { resetForm = false } = {}) {
	$("#region-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen) {
		getRegionEditDialogElement().focus();
		const isTreeOnly = document.getElementById("region-edit-form").classList.contains("political-territory-tree-form") === true;
		document.getElementById(isTreeOnly  "region-edit-parent-filter" : "region-edit-name").focus();
		return;
	}
	if (resetForm) resetRegionEditForm();
}

function setRegionWikiPickerDialogOpen(isOpen) {
	$("#region-wiki-picker-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen) {
		getRegionWikiPickerDialogElement().focus();
		document.getElementById("region-wiki-picker-filter").focus();
	}
}

function syncRegionOpacityOutput() {
	const inputElement = document.getElementById("region-edit-opacity");
	const outputElement = document.getElementById("region-edit-opacity-output");
	if (!inputElement || !outputElement) return;
	outputElement.value = `${inputElement.value}%`;
	outputElement.textContent = `${inputElement.value}%`;
}

function syncRegionValidToControls() {
	const validToInput = document.getElementById("region-edit-valid-to");
	const openEndInput = document.getElementById("region-edit-valid-open");
	if (!validToInput || !openEndInput) {
		return;
	}

	const isOpenEnded = openEndInput.type === "checkbox"
		 openEndInput.checked
		: openEndInput.value === "1";
	validToInput.disabled = isOpenEnded;
	if (isOpenEnded) {
		validToInput.value = "";
	}
}

function syncRegionCoatPreview() {
	const inputElement = document.getElementById("region-edit-coat-url");
	const imageElement = document.getElementById("region-edit-coat-preview");
	if (!inputElement || !imageElement) {
		return;
	}

	const url = String(inputElement.value || "").trim();
	imageElement.hidden = url === "";
	imageElement.src = url;
}

function syncRegionTerritoryFieldVisibility(source) {
	const isPoliticalTerritory = source === "political_territory";
	const isTreeOnly = document.getElementById("region-edit-form").classList.contains("political-territory-tree-form") === true;
	document.querySelectorAll(".political-territory-field").forEach((element) => {
		element.hidden = isTreeOnly && element.classList.contains("political-territory-tree-panel")
			 false
			: !isPoliticalTerritory;
	});
	syncRegionEditRequiredState();
}

function syncRegionEditRequiredState() {
	const formElement = getRegionEditFormElement();
	if (!formElement) {
		return;
	}

	formElement.querySelectorAll("input, select, textarea").forEach((element) => {
		if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
			return;
		}
		if (element.type === "hidden") {
			return;
		}

		if (typeof element.dataset.regionOriginalRequired === "undefined") {
			element.dataset.regionOriginalRequired = element.required  "1" : "0";
		}

		const shouldBeRequired = element.dataset.regionOriginalRequired === "1";
		const isVisible = !element.hidden && element.getClientRects().length > 0;
		element.required = shouldBeRequired && isVisible;
	});
}

function populateRegionTypeOptions(region) {
	const selectElement = document.getElementById("region-edit-type");
	if (!selectElement) {
		return;
	}

	const currentType = normalizeParentheticalSpacing(region.type || "Herrschaftsgebiet");
	const types = Array.from(new Set([
		currentType,
		"Herrschaftsgebiet",
		...politicalTerritoryOptions.map((territory) => normalizeParentheticalSpacing(territory.type || "")).filter(Boolean),
	])).sort((left, right) => left.localeCompare(right, "de"));

	selectElement.innerHTML = "";
	types.forEach((type) => {
		const option = document.createElement("option");
		option.value = type;
		option.textContent = type;
		selectElement.append(option);
	});
	selectElement.value = currentType;
}
