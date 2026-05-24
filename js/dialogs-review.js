const CHANGE_LOG_FOCUS_MARKER_TTL_MS = 12000;

const POLITICAL_TERRITORY_DISPLAY_SUFFIXES = [
	"Staat",
	"Imperium",
	"Reich",
	"Kalifat",
];

let wikiSyncTerritoryTreeRowsCache = [];
let wikiSyncTerritoryTreeRowsLoaded = false;
let wikiSyncTerritoryTreeRootCountCache = 0;

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

function normalizeSearchText(value) {
	return String(value || "")
		.toLocaleLowerCase("de")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();
}

function normalizeParentheticalSpacing(value) {
	return String(value || "").replace(/([^\s])\(/gu, "$1 (");
}

$(document).on("click", "[data-region-edit-tab]", function (event) {
	event.preventDefault();
	const key = this.dataset.regionEditTab || "";
	const tab = findRegionEditTab(key);
	if (!tab || key === activeRegionEditTabKey) {
		return;
	}

	snapshotActiveRegionEditTab();
	activeRegionEditTabKey = key;
	populateRegionEditForm(tab.region, { preserveTabs: true });
	renderRegionEditTabs();
});

$(document).on("click", "[data-region-edit-tab-close]", async function (event) {
	event.preventDefault();
	event.stopPropagation();
	const key = this.dataset.regionEditTabClose || "";
	const tabIndex = regionEditTabs.findIndex((tab) => tab.key === key);
	if (tabIndex <= 0) {
		return;
	}

	snapshotActiveRegionEditTab();
	const tab = regionEditTabs[tabIndex];
	if (isRegionEditTabDirty(tab)) {
		const closeChoice = await askRegionTabCloseChoice();
		if (closeChoice === "save") {
			try {
				await saveRegionEditTab(tab);
				await loadPoliticalTerritoryOptions();
				schedulePoliticalTerritoryLayerReload({ immediate: true });
				showFeedbackToast("Herrschaftsgebiet gespeichert.", "success");
			} catch (error) {
				console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
				setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
				return;
			}
		} else if (closeChoice !== "discard") {
			return;
		}
	}

	regionEditTabs.splice(tabIndex, 1);
	if (activeRegionEditTabKey === key) {
		const nextTab = regionEditTabs[Math.max(0, tabIndex - 1)] || regionEditTabs[0] || null;
		activeRegionEditTabKey = nextTab?.key || "";
		if (nextTab) {
			populateRegionEditForm(nextTab.region, { preserveTabs: true });
		}
	}
	renderRegionEditTabs();
});

function populateRegionEditForm(entry, { preserveTabs = false } = {}) {
	regionEditEntry = entry;
	const region = entry?.region || entry || {};
	const source = region.source || "map_feature";
	const geometryPublicId = source === "political_territory"
		? getPrimaryRegionGeometryPublicId()
		: String(region.geometryPublicId || region.publicId || "").trim();
	regionParentSelectedTreeId = region.territoryPublicId || "";
	document.getElementById("region-edit-public-id").value = region.publicId || "";
	document.getElementById("region-edit-source").value = source;
	document.getElementById("region-edit-territory-public-id").value = region.territoryPublicId || "";
	document.getElementById("region-edit-geometry-public-id").value = geometryPublicId;
	document.getElementById("region-edit-wiki-id").value = region.wikiId || region.wiki_id || "";
	if (source !== "political_territory") {
		void acquireFeatureSoftLock(region.publicId || "");
	}
	document.getElementById("region-edit-name").value = normalizeParentheticalSpacing(region.displayName || region.name || "");
	document.getElementById("region-edit-short-name").value = region.shortName || "";
	document.getElementById("region-edit-color").value = region.color || "#888888";
	document.getElementById("region-edit-opacity").value = Math.round((region.opacity ?? 0.33) * 100);
	document.getElementById("region-edit-wiki-url").value = region.wikiUrl || "";
	document.getElementById("region-edit-coat-url").value = region.coatOfArmsUrl || "";
	document.getElementById("region-edit-min-zoom").value = region.minZoom ?? "";
	document.getElementById("region-edit-max-zoom").value = region.maxZoom ?? "";
	document.getElementById("region-edit-valid-from").value = region.validFromBf ?? "";
	document.getElementById("region-edit-valid-to").value = region.validToBf ?? "";
	document.getElementById("region-edit-valid-open").checked = region.validToBf === null || region.validToBf === undefined;
	document.getElementById("region-edit-valid-label").value = region.validLabel || "";
	document.getElementById("region-edit-is-active").checked = region.isActive !== false;
	document.getElementById("region-edit-notes").value = region.editorNotes || "";
	updateRegionParentDropTarget(region.parentPublicId || "");
	syncRegionTerritoryFieldVisibility(source);
	syncRegionCoatPreview();
	populateRegionTypeOptions(region);
	populateRegionParentSelect(region);
	renderRegionWikiReference(region);
	syncRegionAssignmentForRegion(region);
	document.getElementById("region-edit-delete").hidden = !entry;
	syncRegionOpacityOutput();
	syncRegionValidToControls();
}

function openRegionEditDialog(entry, { title = "Eigenschaften bearbeiten" } = {}) {
	const region = entry?.region || entry || {};
	const canOpenPoliticalTerritoryEditor = region.source === "political_territory"
		&& typeof window.AvesmapsPoliticalTerritoryEditorLink?.open === "function"
		&& document.getElementById("political-territory-editor-frame");
	if (canOpenPoliticalTerritoryEditor) {
		window.AvesmapsPoliticalTerritoryEditorLink.open(region);
		return;
	}

	resetRegionEditForm();
	document.getElementById("region-edit-title").textContent = title;
	initializeRegionEditTabs(entry);
	const initialEntry = regionEditTabs[0] || entry;
	populateRegionEditForm(initialEntry, { preserveTabs: true });
	setRegionEditDialogOpen(true);
	void loadPoliticalTerritoryOptions().then(() => {
		if (regionEditEntry === initialEntry || regionEditEntry === entry || regionEditTabs.length > 0) {
			const activeEntry = regionEditTabs[0] || initialEntry;
			populateRegionTypeOptions(activeEntry?.region || activeEntry || {});
			populateRegionParentSelect(activeEntry?.region || activeEntry || {});
			updateRegionParentDropTarget((activeEntry?.region || activeEntry || {}).parentPublicId || "");
		}
	});
}

$(document).on("click", "[data-region-parent-id]", function (event) {
	event.preventDefault();
	const toggleKey = this.dataset.regionTreeToggle || "";
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	const isLeaf = this.dataset.regionTreeLeaf === "1";
	if (toggleKey && (!isLeaf || event.target?.closest?.(".political-territory-parent-tree__toggle") || (this.dataset.regionTreeGroup === "1" && !territoryPublicId))) {
		if (regionParentCollapsedKeys.has(toggleKey)) {
			regionParentCollapsedKeys.delete(toggleKey);
		} else {
			regionParentCollapsedKeys.add(toggleKey);
		}
		populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
		return;
	}

	if (!territoryPublicId) {
		return;
	}
	if (!isLeaf) {
		setRegionEditStatus("Nur der unterste Knoten kann einer Geometrie zugewiesen werden.", "pending");
		return;
	}

	regionParentSelectedTreeId = territoryPublicId;
	document.querySelectorAll("#region-edit-parent-tree [data-region-parent-id]").forEach((button) => {
		button.classList.toggle("is-selected", button === this);
	});
	const territoryName = this.querySelector(".political-territory-parent-tree__name")?.textContent || "Herrschaftsgebiet";
	setRegionEditStatus(`${territoryName} ausgewählt.`, "success");
});

$(document).on("dblclick", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const toggleKey = this.dataset.regionTreeToggle || "";
	if (!toggleKey) {
		return;
	}

	if (regionParentCollapsedKeys.has(toggleKey)) {
		regionParentCollapsedKeys.delete(toggleKey);
	} else {
		regionParentCollapsedKeys.add(toggleKey);
	}
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
});

$(document).on("dragstart", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	if (!territoryPublicId || this.dataset.regionTreeLeaf !== "1" || !event.originalEvent?.dataTransfer) {
		event.preventDefault();
		return;
	}

	event.originalEvent.dataTransfer.effectAllowed = "copy";
	event.originalEvent.dataTransfer.setData("text/plain", territoryPublicId);
	event.originalEvent.dataTransfer.setData("application/x-avesmaps-territory", territoryPublicId);
});

$(document).on("dragover", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-parent-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	const activeTerritoryId = document.getElementById("region-edit-territory-public-id")?.value || "";
	if (territoryPublicId.startsWith("wiki:")) {
		setRegionEditStatus("Wiki-Knoten bitte in die Zuweisungsflaeche unter dem Baum ziehen.", "pending");
		return;
	}
	if (!territoryPublicId || territoryPublicId === activeTerritoryId) {
		return;
	}

	updateRegionParentDropTarget(territoryPublicId);
});

$(document).on("dragover", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-assignment-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	if (!territoryPublicId) {
		return;
	}

	void assignRegionGeometryToWikiTreeLeaf(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht zugewiesen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
	});
});

$(document).on("click", "[data-region-assignment-breadcrumb-id]", function (event) {
	event.preventDefault();
	const territoryPublicId = this.dataset.regionAssignmentBreadcrumbId || "";
	void openRegionVisualTabFromBreadcrumb(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht geoeffnet werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geoeffnet werden.", "error");
	});
});

$(document).on("click", "#region-edit-assignment-clear", function (event) {
	event.preventDefault();
	void clearRegionGeometryAssignment().catch((error) => {
		console.error("Geometrie konnte nicht freigegeben werden:", error);
		setRegionEditStatus(error.message || "Geometrie konnte nicht freigegeben werden.", "error");
	});
});

$(document).on("input change", "[data-region-assignment-zoom-min], [data-region-assignment-zoom-max]", function (event) {
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const territoryPublicId = summaryElement?.dataset?.regionAssignmentActiveId || "";
	if (!territoryPublicId) {
		return;
	}

	const minInputElement = summaryElement.querySelector("[data-region-assignment-zoom-min]");
	const maxInputElement = summaryElement.querySelector("[data-region-assignment-zoom-max]");
	if (!(minInputElement instanceof HTMLInputElement) || !(maxInputElement instanceof HTMLInputElement)) {
		return;
	}

	const changedField = this.dataset.regionAssignmentZoomField || "";
	const normalizedZoom = updatePoliticalTerritoryDraftZoom(territoryPublicId, minInputElement.value, maxInputElement.value, changedField);
	if (!normalizedZoom) {
		return;
	}

	minInputElement.value = normalizedZoom.minText;
	maxInputElement.value = normalizedZoom.maxText;
	syncRegionAssignmentFormZoomInputs(normalizedZoom.minText, normalizedZoom.maxText);
	if (event.type === "change") {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId);
	}
});

$(document).on("input change", "#region-edit-min-zoom, #region-edit-max-zoom", function () {
	const territoryPublicId = String(document.getElementById("region-edit-territory-public-id")?.value || "").trim();
	if (!territoryPublicId) {
		return;
	}

	const minInputElement = document.getElementById("region-edit-min-zoom");
	const maxInputElement = document.getElementById("region-edit-max-zoom");
	if (!(minInputElement instanceof HTMLInputElement) || !(maxInputElement instanceof HTMLInputElement)) {
		return;
	}

	const changedField = this.id === "region-edit-max-zoom" ? "max" : "min";
	const normalizedZoom = updatePoliticalTerritoryDraftZoom(territoryPublicId, minInputElement.value, maxInputElement.value, changedField);
	if (!normalizedZoom) {
		return;
	}

	minInputElement.value = normalizedZoom.minText;
	maxInputElement.value = normalizedZoom.maxText;
	const summaryElement = document.getElementById("region-edit-assignment-summary");
	const summaryTerritoryId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (summaryTerritoryId === territoryPublicId) {
		const summaryMinInput = summaryElement.querySelector("[data-region-assignment-zoom-min]");
		const summaryMaxInput = summaryElement.querySelector("[data-region-assignment-zoom-max]");
		if (summaryMinInput instanceof HTMLInputElement) {
			summaryMinInput.value = normalizedZoom.minText;
		}
		if (summaryMaxInput instanceof HTMLInputElement) {
			summaryMaxInput.value = normalizedZoom.maxText;
		}
	}
});

$(document).on("input change", "[data-region-assignment-field]", function () {
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const territoryPublicId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (!territoryPublicId) {
		return;
	}

	const field = this.dataset.regionAssignmentField || "";
	if (field === "color") {
		const value = String(this.value || "#888888").trim() || "#888888";
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { color: value }, { color: value });
		syncRegionAssignmentFormFieldValues({ color: value });
		return;
	}

	if (field === "opacity") {
		const opacityPercent = Math.max(0, Math.min(100, Number.parseInt(String(this.value || "33"), 10) || 0));
		const opacity = opacityPercent / 100;
		const labelElement = this.closest(".political-territory-assignment-summary__field")?.querySelector("span");
		if (labelElement) {
			labelElement.textContent = `Transparenz ${opacityPercent}%`;
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { opacity }, { opacity });
		syncRegionAssignmentFormFieldValues({ opacityPercent });
		return;
	}

	if (field === "name") {
		const value = normalizeParentheticalSpacing(String(this.value || "").trim());
		if (this.value !== value) {
			this.value = value;
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { name: value, displayName: value }, { name: value });
		syncRegionAssignmentFormFieldValues({ name: value });
		syncRegionAssignmentBreadcrumbName(territoryPublicId, value);
		return;
	}

	if (field === "coat") {
		const value = String(this.value || "").trim();
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { coat_of_arms_url: value, coatOfArmsUrl: value }, { coat_of_arms_url: value });
		syncRegionAssignmentFormFieldValues({ coatOfArmsUrl: value });
		const imageElement = summaryElement.querySelector(".political-territory-assignment-summary__coat");
		if (imageElement instanceof HTMLImageElement) {
			imageElement.src = value;
			imageElement.hidden = value === "";
		}
		return;
	}

	if (field === "valid-from") {
		const value = String(this.value || "").trim();
		const number = value === "" ? null : Number.parseInt(value, 10);
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_from_bf: number, validFromBf: number }, { valid_from_bf: value });
		syncRegionAssignmentFormFieldValues({ validFromBfText: value });
		return;
	}

	if (field === "valid-open") {
		const isOpen = this.checked === true;
		const validToInput = summaryElement.querySelector("[data-region-assignment-field='valid-to']");
		if (validToInput instanceof HTMLInputElement) {
			validToInput.disabled = isOpen;
			if (isOpen) {
				validToInput.value = "";
			}
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_to_bf: isOpen ? null : null, validToBf: isOpen ? null : null }, { valid_to_open: isOpen, valid_to_bf: isOpen ? "" : String(validToInput?.value || "") });
		syncRegionAssignmentFormFieldValues({ validToOpen: isOpen, validToBfText: isOpen ? "" : String(validToInput?.value || "") });
		return;
	}

	if (field === "valid-to") {
		const openInput = summaryElement.querySelector("[data-region-assignment-field='valid-open']");
		const isOpen = openInput instanceof HTMLInputElement ? openInput.checked : false;
		const value = isOpen ? "" : String(this.value || "").trim();
		const number = value === "" ? null : Number.parseInt(value, 10);
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_to_bf: number, validToBf: number }, { valid_to_open: isOpen, valid_to_bf: value });
		syncRegionAssignmentFormFieldValues({ validToBfText: value, validToOpen: isOpen });
	}
});

$(document).on("click", "[data-region-assignment-coat-refresh]", function (event) {
	event.preventDefault();
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const inputElement = summaryElement?.querySelector("[data-region-assignment-field='coat']");
	const territoryPublicId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (!(inputElement instanceof HTMLInputElement) || !territoryPublicId) {
		return;
	}

	const value = String(inputElement.value || "").trim();
	applyPoliticalTerritoryDraftPatch(territoryPublicId, { coat_of_arms_url: value, coatOfArmsUrl: value }, { coat_of_arms_url: value });
	syncRegionAssignmentFormFieldValues({ coatOfArmsUrl: value });
	renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId);
});

$(document).on("click", "#region-edit-parent-clear", function (event) {
	event.preventDefault();
	updateRegionParentDropTarget("");
});

function updateRegionParentFilter(value) {
	regionParentFilterQuery = String(value || "").trim();
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
}

function buildRegionEditPayload(formElement) {
	const formData = new FormData(formElement);
	const source = String(formData.get("source") || "map_feature").trim();
	if (source === "political_territory") {
		return {
			action: "update_territory",
			source,
			public_id: String(formData.get("geometry_public_id") || "").trim(),
			geometry_public_id: String(formData.get("geometry_public_id") || "").trim(),
			territory_public_id: String(formData.get("territory_public_id") || "").trim(),
			wiki_id: String(formData.get("wiki_id") || "").trim(),
			name: String(formData.get("name") || "").trim(),
			short_name: String(formData.get("short_name") || "").trim(),
			type: String(formData.get("type") || "").trim(),
			parent_public_id: String(formData.get("parent_public_id") || "").trim(),
			color: String(formData.get("color") || "#888888").trim(),
			opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
			wiki_url: String(formData.get("wiki_url") || "").trim(),
			coat_of_arms_url: String(formData.get("coat_of_arms_url") || "").trim(),
			min_zoom: String(formData.get("min_zoom") || "").trim(),
			max_zoom: String(formData.get("max_zoom") || "").trim(),
			valid_from_bf: String(formData.get("valid_from_bf") || "").trim(),
			valid_to_bf: String(formData.get("valid_to_bf") || "").trim(),
			valid_to_open: ["on", "1", "true"].includes(String(formData.get("valid_to_open") || "").trim().toLowerCase()),
			valid_label: String(formData.get("valid_label") || "").trim(),
			is_active: formData.get("is_active") === "on",
			editor_notes: String(formData.get("editor_notes") || "").trim(),
		};
	}

	return {
		action: "update_region",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		color: String(formData.get("color") || "#888888").trim(),
		opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
		wiki_url: String(formData.get("wiki_url") || "").trim(),
	};
}

function openLocationEditDialogFromReport(report, latlng) {
	openLocationEditDialog({ latlng });
	activeReviewReportId = Number(report.id) || null;
	activeReviewReportSource = report.report_source || "location_reports";
	document.getElementById("location-edit-name").value = report.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(report.report_subtype || report.size || "dorf");
	document.getElementById("location-edit-description").value = [report.comment, report.source ? `Quelle: ${report.source}` : ""]
		.filter(Boolean)
		.join("\n\n");
	document.getElementById("location-edit-wiki-url").value = report.wiki_url || "";
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

async function handleLocationEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = attachActiveReviewReportContext(buildLocationEditPayload(formElement));
	if (pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === payload.public_id && !payload.name) {
		payload.name = pendingCrossingConversionName || payload.name;
	}
	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: locationEditMarkerEntry?.location?.name || locationEditMarkerEntry?.name || "",
	});
	if (duplicateLocation) {
		setLocationEditStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}
	setLocationEditStatus("Ort wird gespeichert...", "pending");
	setLocationEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		const responseFeature = pendingCrossingConversionPublicId === payload.public_id
			? { ...result.feature, name: result.feature?.name || payload.name }
			: result.feature;
		if (locationEditMarkerEntry) {
			applyFeatureResponseToMarker(locationEditMarkerEntry, responseFeature);
			if (pendingCrossingConversionPublicId === payload.public_id) {
				ensureLocationNameLabel(locationEditMarkerEntry);
				syncLocationNameLabelVisibility();
			}
		} else {
			addCreatedLocationMarker(responseFeature);
		}
		if (payload.action === "create_point" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "location_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		pendingCrossingConversionPublicId = null;
		pendingCrossingConversionName = "";
		pendingCrossingConversionIsNodix = false;
		const wikiSyncCreatedCaseId = wikiSyncCreateLocationCaseId;
		if (wikiSyncCreatedCaseId) {
			const archived = await archiveWikiSyncCreatedLocationCase(wikiSyncCreatedCaseId, responseFeature || result.feature || null);
			resetWikiSyncCreateLocationFlowState();
			if (archived) {
				setWikiSyncStatus("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
				showFeedbackToast("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
			} else {
				showFeedbackToast("Ort wurde gespeichert, die Wiki-Meldung konnte noch nicht archiviert werden.", "warning");
			}
		} else {
			resetWikiSyncCreateLocationFlowState();
		}
		setLocationEditSubmitPending(false);
		setLocationEditDialogOpen(false, { resetForm: true });
		if (!wikiSyncCreatedCaseId) {
			showFeedbackToast("Ort gespeichert.", "success");
		}
	} catch (error) {
		console.error("Ort konnte nicht gespeichert werden:", error);
		setLocationEditStatus(error.message || "Ort konnte nicht gespeichert werden.", "error");
	} finally {
		setLocationEditSubmitPending(false);
	}
}

async function handlePathEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity() || !pathEditFeature) {
		return;
	}

	const payload = buildPathEditPayload(formElement);
	const isAutoNameEnabled = formElement.querySelector("#path-edit-autoname")?.checked === true;
	setPathEditStatus("Weg wird gespeichert...", "pending");
	setPathEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		applyPathFeatureResponse(pathEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		rememberPathEditSettingsFromPayload(payload, { autoname: isAutoNameEnabled });
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Weg gespeichert.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

async function handlePowerlineEditFormSubmit(event) {
	event.preventDefault();
	const formElement = getPowerlineEditFormElement();
	if (!formElement || !powerlineEditFeature) {
		return;
	}

	const payload = buildPowerlineEditPayload(formElement);
	if (!payload.public_id || !payload.name) {
		setPowerlineEditStatus("Ein Name fuer die Kraftlinie fehlt.", "error");
		return;
	}

	setPowerlineEditSubmitPending(true);
	setPowerlineEditStatus("Kraftlinie wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		applyPowerlineFeatureResponse(powerlineEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditSubmitPending(false);
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gespeichert.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gespeichert werden:", error);
		setPowerlineEditStatus(error.message || "Kraftlinie konnte nicht gespeichert werden.", "error");
	} finally {
		setPowerlineEditSubmitPending(false);
	}
}

async function handleLabelEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = attachActiveReviewReportContext(buildLabelEditPayload(formElement));
	const editedLabelEntry = labelEditEntry;
	const shouldStartMoveAfterSave = pendingLabelMoveAfterEditEntry === editedLabelEntry;
	pendingLabelMoveAfterEditEntry = null;
	setLabelEditStatus("Label wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		let savedLabelEntry = editedLabelEntry;
		if (labelEditEntry) {
			applyLabelFeatureResponse(labelEditEntry, result.feature);
		} else {
			savedLabelEntry = addCreatedLabelFeature(result.feature);
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (payload.action === "create_label" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "map_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		setLabelEditDialogOpen(false, { resetForm: true });
		if (shouldStartMoveAfterSave && savedLabelEntry) {
			setLabelMoveActive(savedLabelEntry, true);
		}
		showFeedbackToast("Label gespeichert.", "success");
	} catch (error) {
		console.error("Label konnte nicht gespeichert werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht gespeichert werden.", "error");
	}
}

async function handleRegionEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !regionEditEntry) {
		return;
	}
	syncRegionEditRequiredState();
	if (!formElement.reportValidity()) {
		return;
	}
	snapshotActiveRegionEditTab();
	const payload = buildRegionEditPayload(formElement);
	const payloads = payload.source === "political_territory" && regionEditTabs.length > 0
		? regionEditTabs.map((tab) => tab.payload || regionEditPayloadToPayload(tab.region)).filter(Boolean)
		: [payload];
	const saveablePayloads = payload.source === "political_territory"
		? payloads.filter((entry) => String(entry?.territory_public_id || "").trim() !== "")
		: payloads;
	if (payload.source === "political_territory" && payloads.length > 0 && saveablePayloads.length < 1) {
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Geometrie bleibt freigegeben.", "success");
		return;
	}
	if (payload.source === "political_territory" && saveablePayloads.length !== payloads.length) {
		regionEditTabs = regionEditTabs.filter((tab) => {
			const tabPayload = tab.payload || regionEditPayloadToPayload(tab.region);
			return String(tabPayload?.territory_public_id || "").trim() !== "";
		});
	}
	if (payload.source === "political_territory" && saveablePayloads.some((entry) => String(entry?.territory_public_id || "").trim() === "")) {
		setRegionEditStatus("Bitte zuerst einen untersten Knoten zuweisen.", "error");
		return;
	}
	if (payload.source !== "political_territory" && !isSqlMapFeatureId(payload.public_id)) {
		setRegionEditStatus("Diese Region hat keine gueltige SQL-ID. Bitte die SQL-Karte neu laden.", "error");
		return;
	}
	try {
		let latestResult = null;
		if (payload.source === "political_territory") {
			for (const tab of regionEditTabs) {
				latestResult = await saveRegionEditTab(tab);
			}
			void loadPoliticalTerritoryOptions({ force: true });
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		} else {
			latestResult = await submitMapFeatureEdit(payloads[0]);
			updateRevisionFromEditResponse(latestResult);
			void loadChangeLog();
		}
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast(payloads.length > 1 ? `${payloads.length} Herrschaftsgebiete gespeichert.` : "Herrschaftsgebiet gespeichert.", "success");
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
	}
}

function isSqlMapFeatureId(value) {
	return /^[a-f0-9-]{36}$/i.test(String(value || "").trim());
}

function finalizeLocationReportSubmission({ ok, message }) {
	setLocationReportSubmitPending(false);
	updateLocationReportDialogAvailability();

	if (ok) {
		setLocationReportDialogOpen(false, { resetForm: true });
		showFeedbackToast(message || "Karteneintrag wurde gemeldet.", "success");
		return;
	}

	setLocationReportStatus(message || "Die Meldung konnte nicht gesendet werden.", "error");
}

async function handleLocationReportFormSubmit(event) {
	event.preventDefault();

	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement) {
		return;
	}

	if (!isLocationReportServiceConfigured()) {
		setLocationReportStatus("Das Meldeformular ist noch nicht mit dem Avesmaps-Server verbunden.", "error");
		return;
	}

	if (!locationReportLatLng || !isWithinMapBounds(locationReportLatLng)) {
		setLocationReportStatus("Die ausgewählte Position ist ungültig.", "error");
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
			setLocationReportStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
			return;
		}
	}
	setLocationReportStatus("Meldung wird gesendet...", "pending");
	setLocationReportSubmitPending(true);

	const result = await submitLocationReportRequest(payload);
	finalizeLocationReportSubmission({
		ok: result.ok,
		message: result.message,
	});
}
