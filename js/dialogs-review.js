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

function getRegionEditTabKey(region) {
	return region.territoryPublicId || region.publicId || region.geometryPublicId || "";
}

function initializeRegionEditTabs(entry) {
	const region = entry?.region || entry || {};
	if ((region.source || "") !== "political_territory") {
		regionEditTabs = [];
		activeRegionEditTabKey = "";
		renderRegionEditTabs();
		return;
	}

	const key = getRegionEditTabKey(region);
	const savedPayload = regionEditPayloadToPayload(region);
	regionEditTabs = key ? [{
		key,
		entry,
		region: { ...region },
		payload: null,
		savedPayload,
	}] : [];
	activeRegionEditTabKey = key;
	renderRegionEditTabs();
}

function getPrimaryRegionGeometryPublicId() {
	const primaryRegion = regionEditTabs[0]?.region || regionEditTabs[0]?.entry || regionEditEntry?.region || regionEditEntry || {};
	return String(primaryRegion.geometryPublicId || "").trim();
}

function renderRegionEditTabs() {
	const tabsElement = document.getElementById("region-edit-tabs");
	if (!tabsElement) {
		return;
	}

	tabsElement.innerHTML = "";
	regionEditTabs.forEach((tab, index) => {
		const tabElement = document.createElement("span");
		tabElement.className = "political-territory-tabs__entry";
		tabElement.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "political-territory-tabs__tab";
		button.dataset.regionEditTab = tab.key;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", tab.key === activeRegionEditTabKey ? "true" : "false");
		button.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		button.textContent = tab.region.shortName || tab.region.displayName || tab.region.name || "Herrschaftsgebiet";
		tabElement.append(button);
		if (index > 0) {
			const closeButton = document.createElement("button");
			closeButton.type = "button";
			closeButton.className = "political-territory-tabs__close";
			closeButton.dataset.regionEditTabClose = tab.key;
			closeButton.setAttribute("aria-label", "Tab schliessen");
			closeButton.textContent = "x";
			tabElement.append(closeButton);
		}
		tabsElement.append(tabElement);
	});
}

function findRegionEditTab(key) {
	return regionEditTabs.find((tab) => tab.key === key) || null;
}

function findPoliticalTerritoryOption(publicId) {
	return politicalTerritoryOptions.find((territory) => territory.public_id === publicId) || null;
}

function updateRegionParentDropTarget(parentPublicId) {
	const inputElement = document.getElementById("region-edit-parent");
	const labelElement = document.getElementById("region-edit-parent-drop-label");
	const dropElement = document.getElementById("region-edit-parent-drop");
	const normalizedParentId = String(parentPublicId || "").trim();
	if (inputElement) {
		inputElement.value = normalizedParentId;
	}
	if (!labelElement || !dropElement) {
		return;
	}

	const parent = normalizedParentId ? findPoliticalTerritoryOption(normalizedParentId) : null;
	labelElement.textContent = parent
		? normalizeParentheticalSpacing([
			parent.name,
			parent.type,
			parent.valid_label,
		].filter(Boolean).join(" - "))
		: "Kein Parent";
	dropElement.classList.toggle("has-parent", Boolean(parent));
}

function findPoliticalTerritoryTreePath(publicId) {
	const normalizedPublicId = String(publicId || "").trim();
	if (!normalizedPublicId) {
		return [];
	}

	const visit = (node, path) => {
		if (!node) {
			return null;
		}

		const currentPath = [...path, node];
		if ((node.territory?.public_id || "") === normalizedPublicId) {
			return currentPath;
		}

		for (const child of node.children || []) {
			const result = visit(child, currentPath);
			if (result) {
				return result;
			}
		}

		return null;
	};

	for (const node of buildPoliticalTerritoryTree("")) {
		const result = visit(node, []);
		if (result) {
			return result;
		}
	}

	return [];
}

function applyPoliticalTerritoryDraftPatch(territoryPublicId, patch = {}, payloadPatch = null) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (!normalizedPublicId || !patch || typeof patch !== "object") {
		return;
	}

	politicalTerritoryOptions = politicalTerritoryOptions.map((territory) => {
		if (String(territory?.public_id || "").trim() !== normalizedPublicId) {
			return territory;
		}

		return {
			...territory,
			...patch,
		};
	});

	regionEditTabs = regionEditTabs.map((tab) => {
		const tabTerritoryPublicId = String(tab?.region?.territoryPublicId || tab?.region?.publicId || tab?.key || "").trim();
		if (tabTerritoryPublicId !== normalizedPublicId) {
			return tab;
		}

		const nextRegion = {
			...(tab.region || {}),
			...patch,
		};
		const nextPayload = tab.payload
			? {
				...tab.payload,
				...(payloadPatch || {}),
			}
			: tab.payload;
		return {
			...tab,
			region: nextRegion,
			payload: nextPayload,
			entry: tab.entry === tab.region ? nextRegion : tab.entry,
		};
	});

	if (String(regionEditEntry?.territoryPublicId || regionEditEntry?.publicId || "").trim() === normalizedPublicId) {
		regionEditEntry = {
			...(regionEditEntry || {}),
			...patch,
		};
	}

	updateRegionAssignmentBreadcrumbChain(normalizedPublicId, patch, null);
}

function syncRegionAssignmentFormZoomInputs(minText, maxText) {
	const minZoomElement = document.getElementById("region-edit-min-zoom");
	const maxZoomElement = document.getElementById("region-edit-max-zoom");
	if (minZoomElement instanceof HTMLInputElement) {
		minZoomElement.value = minText;
	}
	if (maxZoomElement instanceof HTMLInputElement) {
		maxZoomElement.value = maxText;
	}
}

function syncRegionAssignmentFormFieldValues(values = {}) {
	const assignments = [
		["region-edit-name", values.name ?? null],
		["region-edit-coat-url", values.coatOfArmsUrl ?? null],
		["region-edit-valid-from", values.validFromBfText ?? null],
		["region-edit-valid-to", values.validToBfText ?? null],
		["region-edit-color", values.color ?? null],
	];

	for (const [elementId, value] of assignments) {
		if (value === null) {
			continue;
		}

		const inputElement = document.getElementById(elementId);
		if (inputElement instanceof HTMLInputElement) {
			inputElement.value = value;
		}
	}

	if (values.opacityPercent !== null && values.opacityPercent !== undefined) {
		const opacityElement = document.getElementById("region-edit-opacity");
		if (opacityElement instanceof HTMLInputElement) {
			opacityElement.value = String(values.opacityPercent);
			syncRegionOpacityOutput();
		}
	}

	if (values.validToOpen !== null && values.validToOpen !== undefined) {
		const openEndElement = document.getElementById("region-edit-valid-open");
		if (openEndElement instanceof HTMLInputElement) {
			openEndElement.checked = Boolean(values.validToOpen);
			syncRegionValidToControls();
		}
	}

	if (values.coatOfArmsUrl !== null && values.coatOfArmsUrl !== undefined) {
		syncRegionCoatPreview();
	}
}

function syncRegionAssignmentBreadcrumbZoomLabel(territoryPublicId, minZoom, maxZoom) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (!normalizedPublicId) {
		return;
	}

	const zoomLabel = formatPoliticalTerritoryZoomRange(minZoom, maxZoom);
	document.querySelectorAll("[data-region-assignment-breadcrumb-id]").forEach((element) => {
		if (String(element?.dataset?.regionAssignmentBreadcrumbId || "").trim() !== normalizedPublicId) {
			return;
		}

		const zoomElement = element.querySelector(".political-territory-assignment-breadcrumb__zoom");
		if (zoomElement) {
			zoomElement.textContent = zoomLabel;
		}
	});
}

function syncRegionAssignmentBreadcrumbName(territoryPublicId, name) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (!normalizedPublicId) {
		return;
	}

	const normalizedName = normalizeParentheticalSpacing(String(name || "").trim());
	document.querySelectorAll("[data-region-assignment-breadcrumb-id]").forEach((element) => {
		if (String(element?.dataset?.regionAssignmentBreadcrumbId || "").trim() !== normalizedPublicId) {
			return;
		}

		const nameElement = element.querySelector(".political-territory-assignment-breadcrumb__name");
		if (nameElement) {
			nameElement.textContent = normalizedName || "Herrschaftsgebiet";
		}
	});
}

function updatePoliticalTerritoryDraftZoom(territoryPublicId, minValue, maxValue, changedField = "") {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (!normalizedPublicId) {
		return null;
	}

	const normalizedZoom = normalizePoliticalTerritoryZoomDraft(minValue, maxValue, changedField);
	const territoryPatch = {
		min_zoom: normalizedZoom.minNumber,
		max_zoom: normalizedZoom.maxNumber,
		minZoom: normalizedZoom.minNumber,
		maxZoom: normalizedZoom.maxNumber,
	};
	const payloadPatch = {
		min_zoom: normalizedZoom.minText,
		max_zoom: normalizedZoom.maxText,
	};
	applyPoliticalTerritoryDraftPatch(normalizedPublicId, territoryPatch, payloadPatch);
	syncRegionAssignmentBreadcrumbZoomLabel(normalizedPublicId, normalizedZoom.minNumber, normalizedZoom.maxNumber);
	return normalizedZoom;
}

function renderRegionAssignment(path = regionAssignmentWikiPath, ensuredChain = regionAssignmentEnsuredChain, activeWikiPublicId = regionAssignmentActiveWikiPublicId) {
	const dropElement = document.getElementById("region-edit-assignment-drop");
	const labelElement = document.getElementById("region-edit-assignment-drop-label");
	const breadcrumbElement = document.getElementById("region-edit-assignment-breadcrumb");
	const summaryElement = document.getElementById("region-edit-assignment-summary");
	const clearButtonElement = document.getElementById("region-edit-assignment-clear");
	const selectedNode = path[path.length - 1] || null;
	const defaultActiveId = ensuredChain.length > 0
		? ensuredChain[ensuredChain.length - 1]?.territory?.public_id || ""
		: selectedNode?.territory?.public_id || "";
	const activeId = String(activeWikiPublicId || defaultActiveId).trim();
	const activeIndex = ensuredChain.findIndex((node) => (node.territory?.public_id || "") === activeId);
	const activeWiki = activeIndex >= 0 ? ensuredChain[activeIndex]?.wiki || ensuredChain[activeIndex]?.territory || null : ensuredChain[ensuredChain.length - 1]?.wiki || selectedNode?.territory || null;
	const activeTerritory = activeIndex >= 0
		? ensuredChain[activeIndex]?.territory || selectedNode?.territory || null
		: selectedNode?.territory || null;
	if (labelElement) {
		labelElement.textContent = selectedNode
			? `Zugewiesen: ${selectedNode.territory?.name || "Herrschaftsgebiet"}`
			: "Untersten Knoten hierher ziehen, um die Geometrie zuzuweisen";
	}
	dropElement?.classList.toggle("has-assignment", Boolean(selectedNode));
	if (clearButtonElement) {
		clearButtonElement.disabled = !selectedNode;
	}
	if (breadcrumbElement) {
		breadcrumbElement.innerHTML = "";
		path.forEach((node, index) => {
			const ensuredNode = ensuredChain[index] || null;
			const territory = ensuredNode?.territory || node.territory || {};
			const wiki = ensuredNode?.wiki || territory || {};
			const wikiName = wiki.name || wiki.wiki_name || node.territory?.name || "Herrschaftsgebiet";
			const wikiType = normalizeParentheticalSpacing([wiki.type || "", wiki.status || ""].filter(Boolean).join(" · "));
			const wikiPeriod = normalizeParentheticalSpacing(wiki.valid_label || buildWikiReferencePeriod(wiki));
			const zoomLabel = formatPoliticalTerritoryZoomRange(territory.min_zoom ?? territory.minZoom ?? null, territory.max_zoom ?? territory.maxZoom ?? null);
			const breadcrumbTerritoryId = String(ensuredNode?.territory?.public_id || node.territory?.public_id || "").trim();
			const button = document.createElement("button");
			button.type = "button";
			button.className = "political-territory-assignment-breadcrumb__item";
			button.classList.toggle("is-active", breadcrumbTerritoryId === activeId);
			button.dataset.regionAssignmentBreadcrumbId = breadcrumbTerritoryId;
			button.innerHTML = `
				<span class="political-territory-assignment-breadcrumb__name"></span>
				<span class="political-territory-assignment-breadcrumb__meta"></span>
				<span class="political-territory-assignment-breadcrumb__zoom"></span>
			`;
			button.querySelector(".political-territory-assignment-breadcrumb__name").textContent = wikiName;
			button.querySelector(".political-territory-assignment-breadcrumb__meta").textContent = [wikiType, wikiPeriod].filter(Boolean).join(" · ") || "Wiki-Daten";
			button.querySelector(".political-territory-assignment-breadcrumb__zoom").textContent = zoomLabel;
			breadcrumbElement.append(button);
		});
	}
	renderRegionAssignmentSummary(summaryElement, activeWiki || selectedNode?.territory || null, activeTerritory, {
		territoryPublicId: activeId,
		canRemove: activeIndex > 0,
	});
}

function renderRegionAssignmentSummary(summaryElement, wiki, territory = null, options = {}) {
	if (!summaryElement) {
		return;
	}
	if (!wiki) {
		summaryElement.hidden = true;
		summaryElement.innerHTML = "";
		return;
	}

	const territoryPublicId = String(options.territoryPublicId || territory?.public_id || "").trim();
	const normalizedZoom = normalizePoliticalTerritoryZoomDraft(territory?.min_zoom ?? territory?.minZoom ?? "", territory?.max_zoom ?? territory?.maxZoom ?? "");
	const territoryOpacity = Number.isFinite(Number(territory?.opacity)) ? Number(territory.opacity) : 0.33;
	const opacityPercent = Math.round(territoryOpacity * 100);
	const validFromText = territory?.valid_from_bf ?? territory?.validFromBf ?? "";
	const validToValue = territory?.valid_to_bf ?? territory?.validToBf ?? null;
	const validToOpen = validToValue === null || validToValue === undefined;
	const validToText = validToOpen ? "" : String(validToValue);

	const rows = [
		["Interne ID", wiki.id || wiki.wiki_id || ""],
		["WikiKey", wiki.wiki_key || ""],
		["Name", wiki.name || wiki.wiki_name || ""],
		["Typ", wiki.type || ""],
		["Status", wiki.status || ""],
		["Oberhaupt", wiki.ruler || ""],
		["Gruender", wiki.founder || ""],
		["Hauptstadt", wiki.capital_name || ""],
		["Herrschaftssitz", wiki.seat_name || ""],
		["Sprache", wiki.language || ""],
		["Waehrung", wiki.currency || ""],
		["Handelswaren", wiki.trade_goods || ""],
		["Einwohner", wiki.population || ""],
		["Gruendung", wiki.founded_text || ""],
		["Aufloesung", wiki.dissolved_text || ""],
		["Wiki-Link", wiki.wiki_url || ""],
	].filter(([, value]) => String(value || "").trim() !== "");
	const coatUrl = territory?.coat_of_arms_url || territory?.coatOfArmsUrl || wiki.coat_of_arms_url || "";
	const wikiUrl = wiki.wiki_url || "";
	summaryElement.hidden = false;
	summaryElement.dataset.regionAssignmentActiveId = territoryPublicId;
	summaryElement.innerHTML = `
		<div class="political-territory-assignment-summary__content">
			<div class="political-territory-assignment-summary__panes">
				<div class="political-territory-assignment-summary__wiki-box">
					${coatUrl ? `<img class="political-territory-assignment-summary__coat" src="${escapeHtml(coatUrl)}" alt="">` : `<span class="political-territory-assignment-summary__coat-placeholder"></span>`}
					<dl>${rows.map(([label, value]) => {
			if (label === "Wiki-Link" && wikiUrl) {
				return `<dt>${escapeHtml(label)}</dt><dd><a href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(wikiUrl)}</a></dd>`;
			}

			return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
		}).join("")}</dl>
				</div>
				<div class="political-territory-assignment-summary__settings-box">
					<div class="political-territory-assignment-summary__controls">
						<label class="political-territory-assignment-summary__field">
							<span>Zoom von</span>
							<input data-region-assignment-zoom-field="min" data-region-assignment-zoom-min type="number" min="0" max="6" step="1" value="${escapeHtml(normalizedZoom.minText)}" />
						</label>
						<label class="political-territory-assignment-summary__field">
							<span>Zoom bis</span>
							<input data-region-assignment-zoom-field="max" data-region-assignment-zoom-max type="number" min="0" max="6" step="1" value="${escapeHtml(normalizedZoom.maxText)}" />
						</label>
						<label class="political-territory-assignment-summary__field">
							<span>Farbe</span>
							<input data-region-assignment-field="color" type="color" value="${escapeHtml(territory?.color || "#888888")}" />
						</label>
						<label class="political-territory-assignment-summary__field">
							<span>Transparenz ${escapeHtml(String(opacityPercent))}%</span>
							<input data-region-assignment-field="opacity" type="range" min="0" max="100" step="1" value="${escapeHtml(String(opacityPercent))}" />
						</label>
						<label class="political-territory-assignment-summary__field political-territory-assignment-summary__field--wide">
							<span>Anzeigename</span>
							<input data-region-assignment-field="name" type="text" maxlength="160" value="${escapeHtml(territory?.name || territory?.displayName || "")}" />
						</label>
						<label class="political-territory-assignment-summary__field political-territory-assignment-summary__field--wide">
							<span>Neuer Wappen-Link</span>
							<span class="political-territory-assignment-summary__inline-control">
								<input data-region-assignment-field="coat" type="url" maxlength="500" value="${escapeHtml(territory?.coat_of_arms_url || territory?.coatOfArmsUrl || "")}" />
								<button data-region-assignment-coat-refresh type="button" class="location-report-form__button location-report-form__button--secondary">Aktualisieren</button>
							</span>
						</label>
						<label class="political-territory-assignment-summary__field">
							<span>Von</span>
							<input data-region-assignment-field="valid-from" type="number" step="1" value="${escapeHtml(String(validFromText))}" />
						</label>
						<label class="political-territory-assignment-summary__field">
							<span>Bis</span>
							<input data-region-assignment-field="valid-to" type="number" step="1" value="${escapeHtml(validToText)}" ${validToOpen ? "disabled" : ""} />
						</label>
						<label class="political-territory-assignment-summary__field political-territory-assignment-summary__field--wide political-territory-assignment-summary__checkbox">
							<input data-region-assignment-field="valid-open" type="checkbox" ${validToOpen ? "checked" : ""} />
							<span>Heute</span>
						</label>
					</div>
				</div>
			</div>
		</div>
	`;
}

function arePoliticalTerritoryPathsEqual(leftPath, rightPath) {
	if (!Array.isArray(leftPath) || !Array.isArray(rightPath) || leftPath.length !== rightPath.length) {
		return false;
	}

	return leftPath.every((node, index) => {
		const leftId = node?.territory?.public_id || "";
		const rightId = rightPath[index]?.territory?.public_id || "";
		return leftId === rightId;
	});
}

function syncRegionAssignmentForRegion(region) {
	const source = region?.source || "map_feature";
	const territoryPublicId = String(region?.territoryPublicId || "").trim();
	if (source !== "political_territory" || !territoryPublicId) {
		regionAssignmentWikiPath = [];
		regionAssignmentEnsuredChain = [];
		regionAssignmentActiveWikiPublicId = "";
		renderRegionAssignment();
		return;
	}

	const normalizedTerritoryPublicId = territoryPublicId;
	const currentPathContainsTerritory = Array.isArray(regionAssignmentWikiPath)
		&& regionAssignmentWikiPath.some((node) => String(node?.territory?.public_id || "").trim() === normalizedTerritoryPublicId);
	if (regionAssignmentWikiPath.length > 0 && currentPathContainsTerritory) {
		regionAssignmentActiveWikiPublicId = normalizedTerritoryPublicId;
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	const persistedAssignmentChain = region?.assignmentChain || region?.assignment_chain || [];
	if (applyPersistedRegionAssignmentChain(persistedAssignmentChain, territoryPublicId)) {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	if (restoreRegionAssignmentBreadcrumbCache(territoryPublicId)) {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	const path = findPoliticalTerritoryTreePath(territoryPublicId);
	if (path.length > 0) {
		if (regionAssignmentWikiPath.length < 1 || !arePoliticalTerritoryPathsEqual(regionAssignmentWikiPath, path)) {
			regionAssignmentWikiPath = path;
			regionAssignmentEnsuredChain = [];
		}
		regionAssignmentActiveWikiPublicId = territoryPublicId;
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
		return;
	}

	void loadPersistedRegionAssignment(territoryPublicId).catch((error) => {
		console.error("Gespeicherte Herrschaftsgebiets-Zuweisung konnte nicht geladen werden:", error);
	});
	renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
}

async function ensurePoliticalTerritoryChainFromWikiPath(path) {
	const wikiPublicIds = path.map((node) => node.territory?.public_id || "").filter(Boolean);
	if (wikiPublicIds.length < 1) {
		throw new Error("Die Wiki-Hierarchie fehlt.");
	}

	const response = await submitPoliticalTerritoryEdit({
		action: "ensure_wiki_territory_chain",
		wiki_public_ids: wikiPublicIds,
		wiki_nodes: path.map((node) => node.territory || {}),
	});
	regionAssignmentEnsuredChain = Array.isArray(response.chain) ? response.chain : [];
	return response;
}

async function assignRegionGeometryToWikiTreeLeaf(wikiPublicId) {
	const path = findPoliticalTerritoryTreePath(wikiPublicId);
	const selectedNode = path[path.length - 1] || null;
	if (!selectedNode || (selectedNode.children || []).length > 0) {
		setRegionEditStatus("Bitte den untersten Knoten der Hierarchie auswaehlen.", "error");
		return;
	}

	regionAssignmentWikiPath = path;
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = wikiPublicId;
	storeRegionAssignmentBreadcrumbCaches(path, [], wikiPublicId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	setRegionEditStatus("Wiki-Hierarchie wird dem Gebiet zugewiesen...", "pending");
	const response = await ensurePoliticalTerritoryChainFromWikiPath(path);
	const selectedTerritoryId = response.selected?.territory?.public_id || "";
	if (!selectedTerritoryId) {
		throw new Error("Das Herrschaftsgebiet konnte nicht aus dem Wiki-Knoten erzeugt werden.");
	}

	regionAssignmentActiveWikiPublicId = selectedTerritoryId;
	storeRegionAssignmentBreadcrumbCaches(path, response.chain || [], selectedTerritoryId);
	await activatePrimaryRegionEditTabForTerritory(selectedTerritoryId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern uebernimmt die Geometrie dauerhaft.", "success");
}

async function openRegionVisualTabFromBreadcrumb(wikiPublicId) {
	if (!wikiPublicId) {
		return;
	}

	regionAssignmentActiveWikiPublicId = wikiPublicId;
	await openRegionEditTabForTerritory(wikiPublicId, { assignGeometry: false });
	if (regionAssignmentWikiPath.length > 0) {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	}
	window.requestAnimationFrame(() => {
		const minZoomElement = document.getElementById("region-edit-min-zoom");
		if (minZoomElement instanceof HTMLInputElement) {
			minZoomElement.focus();
			minZoomElement.select?.();
			return;
		}

		document.getElementById("region-edit-max-zoom")?.focus();
	});
}

function buildUnassignedPoliticalRegionDraft(baseRegion = {}) {
	const geometryPublicId = String(baseRegion.geometryPublicId || baseRegion.publicId || "").trim();
	return {
		...baseRegion,
		source: "political_territory",
		publicId: geometryPublicId,
		geometryPublicId,
		territoryPublicId: "",
		wikiId: null,
		name: "",
		displayName: "",
		shortName: "",
		parentPublicId: "",
		parentName: "",
		wikiUrl: "",
		coatOfArmsUrl: "",
		wikiName: "",
		wikiType: "",
		wikiAffiliationRaw: "",
		wikiAffiliationRoot: "",
		wikiFoundedText: "",
		wikiDissolvedText: "",
		wikiCapitalName: "",
		wikiSeatName: "",
	};
}

function setPrimaryRegionEditTabToUnassignedGeometry() {
	const currentRegion = regionEditEntry?.region || regionEditEntry || regionEditTabs[0]?.region || {};
	const unassignedRegion = buildUnassignedPoliticalRegionDraft(currentRegion);
	const nextPrimaryKey = unassignedRegion.geometryPublicId || `free:${Date.now()}`;
	const existingSecondaryTabs = regionEditTabs.slice(1);
	regionEditTabs = [{
		key: nextPrimaryKey,
		entry: regionEditTabs[0]?.entry || regionEditEntry || unassignedRegion,
		region: unassignedRegion,
		payload: regionEditPayloadToPayload(unassignedRegion),
		savedPayload: regionEditPayloadToPayload(unassignedRegion),
		assignGeometryPublicId: "",
		assignGeometryMode: "",
	}, ...existingSecondaryTabs];
	activeRegionEditTabKey = nextPrimaryKey;
	regionEditEntry = unassignedRegion;
	populateRegionEditForm(unassignedRegion, { preserveTabs: true });
	renderRegionEditTabs();
}

async function clearRegionGeometryAssignment() {
	const geometryPublicId = String(document.getElementById("region-edit-geometry-public-id")?.value || getPrimaryRegionGeometryPublicId() || "").trim();
	if (!geometryPublicId) {
		setRegionEditStatus("Die Geometrie konnte nicht bestimmt werden.", "error");
		return;
	}

	await submitPoliticalTerritoryEdit({
		action: "unassign_geometry",
		geometry_public_id: geometryPublicId,
	});
	regionAssignmentWikiPath = [];
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = "";
	regionAssignmentBreadcrumbCache.clear();
	setPrimaryRegionEditTabToUnassignedGeometry();
	renderRegionAssignment();
	schedulePoliticalTerritoryLayerReload({ immediate: true });
	setRegionEditStatus("Geometrie freigegeben. Jetzt kann eine neue Hierarchie zugewiesen werden.", "success");
}

function snapshotActiveRegionEditTab() {
	if (!activeRegionEditTabKey) {
		return;
	}

	const formElement = getRegionEditFormElement();
	const tab = findRegionEditTab(activeRegionEditTabKey);
	if (!formElement || !tab) {
		return;
	}

	const payload = buildRegionEditPayload(formElement);
	tab.payload = payload;
	tab.region = regionEditPayloadToRegion(payload, tab.region || regionEditEntry?.region || regionEditEntry || {});
	tab.entry = regionEditEntry || tab.entry;
	renderRegionEditTabs();
}

function regionEditPayloadToRegion(payload, fallback = {}) {
	const readOptionalNumber = (value) => {
		const text = String(value ?? "").trim();
		if (text === "") {
			return null;
		}

		const number = Number.parseInt(text, 10);
		return Number.isFinite(number) ? number : null;
	};

	return {
		...fallback,
		source: payload.source || fallback.source || "political_territory",
		publicId: fallback.publicId || payload.public_id || "",
		geometryPublicId: payload.geometry_public_id || fallback.geometryPublicId || "",
		territoryPublicId: payload.territory_public_id || fallback.territoryPublicId || "",
		wikiId: payload.wiki_id || fallback.wikiId || null,
		name: payload.name || fallback.name || "",
		displayName: payload.name || fallback.displayName || fallback.name || "",
		shortName: payload.short_name || "",
		type: payload.type || "",
		parentPublicId: payload.parent_public_id || "",
		color: payload.color || fallback.color || "#888888",
		opacity: Number.isFinite(Number(payload.opacity)) ? Number(payload.opacity) : fallback.opacity ?? 0.33,
		wikiUrl: payload.wiki_url || "",
		coatOfArmsUrl: payload.coat_of_arms_url || "",
		minZoom: readOptionalNumber(payload.min_zoom),
		maxZoom: readOptionalNumber(payload.max_zoom),
		validFromBf: readOptionalNumber(payload.valid_from_bf),
		validToBf: payload.valid_to_open ? null : readOptionalNumber(payload.valid_to_bf),
		validLabel: payload.valid_label || "",
		isActive: payload.is_active !== false,
		editorNotes: payload.editor_notes || "",
	};
}

function regionEditPayloadToPayload(region) {
	if (!region) {
		return null;
	}

	return {
		action: "update_territory",
		source: "political_territory",
		public_id: region.geometryPublicId || "",
		geometry_public_id: region.geometryPublicId || "",
		territory_public_id: region.territoryPublicId || region.publicId || "",
		wiki_id: region.wikiId || "",
		name: region.displayName || region.name || "",
		short_name: region.shortName || "",
		type: region.type || "",
		parent_public_id: region.parentPublicId || "",
		color: region.color || "#888888",
		opacity: Number.isFinite(Number(region.opacity)) ? Number(region.opacity) : 0.33,
		wiki_url: region.wikiUrl || "",
		coat_of_arms_url: region.coatOfArmsUrl || "",
		min_zoom: region.minZoom ?? "",
		max_zoom: region.maxZoom ?? "",
		valid_from_bf: region.validFromBf ?? "",
		valid_to_bf: region.validToBf ?? "",
		valid_to_open: region.validToBf === null || region.validToBf === undefined,
		valid_label: region.validLabel || "",
		is_active: region.isActive !== false,
		editor_notes: region.editorNotes || "",
	};
}

function getComparableRegionEditPayload(payload) {
	const copy = { ...payload };
	delete copy.action;
	delete copy.source;
	delete copy.public_id;
	delete copy.geometry_public_id;
	Object.keys(copy).forEach((key) => {
		if (copy[key] === undefined || copy[key] === null) {
			copy[key] = "";
		}
	});
	return copy;
}

function areRegionEditPayloadsEqual(leftPayload, rightPayload) {
	return JSON.stringify(getComparableRegionEditPayload(leftPayload || {})) === JSON.stringify(getComparableRegionEditPayload(rightPayload || {}));
}

function isRegionEditTabDirty(tab) {
	if (!tab) {
		return false;
	}

	return !areRegionEditPayloadsEqual(tab.payload || regionEditPayloadToPayload(tab.region), tab.savedPayload || regionEditPayloadToPayload(tab.region));
}

function getActiveRegionGeometryAssignment(territoryPublicId) {
	const primaryTab = regionEditTabs[0] || null;
	const geometryPublicId = String(primaryTab?.region?.geometryPublicId || "").trim();
	if (!geometryPublicId || !territoryPublicId || primaryTab?.region?.territoryPublicId === territoryPublicId) {
		return null;
	}

	if (regionEditTabs.some((tab) => tab.assignGeometryPublicId === geometryPublicId)) {
		return null;
	}

	return {
		geometryPublicId,
		mode: primaryTab?.entry?.source === "political_territory" ? "reassign" : "create",
	};
}

async function saveRegionEditTab(tab) {
	if (!tab) {
		return null;
	}

	const payload = tab.payload || regionEditPayloadToPayload(tab.region);
	const result = await submitPoliticalTerritoryEdit(payload);
	let latestResult = result;
	const liveRegion = tab.entry && typeof tab.entry === "object"
		? tab.entry
		: tab.region && typeof tab.region === "object"
			? tab.region
			: {};
	if (result.feature) {
		applyRegionFeatureResponse(liveRegion, result.feature);
	}
	if (result.territory) {
		const savedRegion = normalizePoliticalTerritoryForRegionEdit(result.territory, result.wiki || null);
		const territoryMetadata = { ...savedRegion };
		delete territoryMetadata.publicId;
		delete territoryMetadata.geometryPublicId;
		delete territoryMetadata.feature;
		delete territoryMetadata.layer;
		delete territoryMetadata.layers;
		delete territoryMetadata.label;
		delete territoryMetadata.handles;
		Object.assign(liveRegion, tab.region || {}, territoryMetadata);
		if (result.feature) {
			liveRegion.feature = result.feature;
		}
	}
	tab.region = liveRegion;
	tab.entry = liveRegion;
	updateRegionAssignmentBreadcrumbChain(payload.territory_public_id || liveRegion.territoryPublicId || "", result.territory || null, result.wiki || null);
	if (tab.assignGeometryPublicId && payload.territory_public_id) {
		latestResult = tab.assignGeometryMode === "create"
			? await submitPoliticalTerritoryEdit({
				action: "create_geometry",
				territory_public_id: payload.territory_public_id,
				source: "editor",
				geometry_geojson: regionLayerToGeoJsonGeometry(tab.entry || regionEditEntry),
				valid_from_bf: payload.valid_from_bf,
				valid_to_bf: payload.valid_to_bf,
				valid_to_open: payload.valid_to_open,
				style_json: {
					fill: payload.color,
					stroke: payload.color,
					fillOpacity: payload.opacity,
				},
			})
			: await submitPoliticalTerritoryEdit({
				action: "assign_geometry",
				geometry_public_id: tab.assignGeometryPublicId,
				territory_public_id: payload.territory_public_id,
			});
		if (latestResult.feature) {
			if ((tab.entry || regionEditEntry)?.source === "political_territory") {
				applyRegionFeatureResponse(liveRegion, latestResult.feature);
			}
		}
		liveRegion.geometryPublicId = latestResult.geometry?.public_id || tab.assignGeometryPublicId;
		tab.assignGeometryPublicId = "";
		tab.assignGeometryMode = "";
	}
	tab.savedPayload = getComparableRegionEditPayload(payload);
	tab.payload = null;
	if (tab.key === activeRegionEditTabKey) {
		regionEditEntry = liveRegion || tab.entry || tab.region || regionEditEntry;
		populateRegionEditForm(liveRegion || regionEditEntry, { preserveTabs: true });
		renderRegionEditTabs();
	}
	const territoryPublicId = String(tab.region?.territoryPublicId || payload.territory_public_id || "").trim();
	if (Array.isArray(latestResult?.assignment_chain) && latestResult.assignment_chain.length > 0) {
		applyPersistedRegionAssignmentChain(latestResult.assignment_chain, territoryPublicId || liveRegion.territoryPublicId || "");
	}
	if (regionAssignmentWikiPath.length > 0) {
		storeRegionAssignmentBreadcrumbCaches(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId || regionAssignmentActiveWikiPublicId);
	}
	return latestResult;
}

function normalizePoliticalTerritoryForRegionEdit(territory, wiki = null) {
	return {
		source: "political_territory",
		publicId: territory.public_id || "",
		geometryPublicId: "",
		territoryPublicId: territory.public_id || "",
		wikiId: territory.wiki_id || wiki?.id || null,
		name: normalizeParentheticalSpacing(territory.name || ""),
		displayName: normalizeParentheticalSpacing(territory.name || ""),
		shortName: territory.short_name || "",
		type: normalizeParentheticalSpacing(territory.type || wiki?.type || "Herrschaftsgebiet"),
		parentPublicId: territory.parent_public_id || "",
		parentName: territory.parent_name || "",
		color: territory.color || "#888888",
		opacity: territory.opacity ?? 0.33,
		wikiUrl: territory.wiki_url || wiki?.wiki_url || "",
		coatOfArmsUrl: territory.coat_of_arms_url || wiki?.coat_of_arms_url || "",
		minZoom: territory.min_zoom ?? null,
		maxZoom: territory.max_zoom ?? null,
		validFromBf: territory.valid_from_bf ?? null,
		validToBf: territory.valid_to_bf ?? null,
		validLabel: territory.valid_label || "",
		isActive: territory.is_active !== false,
		editorNotes: territory.editor_notes || "",
		wikiName: territory.wiki_name || wiki?.name || "",
		wikiType: normalizeParentheticalSpacing(territory.wiki_type || wiki?.type || territory.type || ""),
		wikiAffiliationRaw: territory.wiki_affiliation_raw || wiki?.affiliation_raw || "",
		wikiAffiliationRoot: territory.wiki_affiliation_root || wiki?.affiliation_root || "",
		wikiFoundedText: territory.wiki_founded_text || wiki?.founded_text || "",
		wikiDissolvedText: territory.wiki_dissolved_text || wiki?.dissolved_text || "",
		wikiCapitalName: territory.wiki_capital_name || wiki?.capital_name || "",
		wikiSeatName: territory.wiki_seat_name || wiki?.seat_name || "",
		assignmentChain: Array.isArray(territory.assignment_chain) ? clonePoliticalTerritoryChain(territory.assignment_chain) : [],
	};
}

async function openRegionEditTabForTerritory(territoryPublicId, { assignGeometry = true } = {}) {
	snapshotActiveRegionEditTab();
	const existingTab = findRegionEditTab(territoryPublicId);
	if (existingTab) {
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(existingTab.region, { preserveTabs: true });
		renderRegionEditTabs();
		return;
	}

	try {
		setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
		const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
		const region = normalizePoliticalTerritoryForRegionEdit({
			...(response.territory || {}),
			assignment_chain: response.assignment_chain || [],
		}, response.wiki || null);
		const geometryAssignment = assignGeometry ? getActiveRegionGeometryAssignment(territoryPublicId) : null;
		const assignGeometryPublicId = geometryAssignment?.geometryPublicId || "";
		if (assignGeometryPublicId) {
			region.geometryPublicId = assignGeometryPublicId;
		}
		const tab = {
			key: territoryPublicId,
			entry: assignGeometryPublicId ? regionEditTabs[0]?.entry || regionEditEntry || region : region,
			region,
			payload: null,
			savedPayload: regionEditPayloadToPayload(region),
			assignGeometryPublicId,
			assignGeometryMode: geometryAssignment?.mode || "",
		};
		regionEditTabs.push(tab);
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(region, { preserveTabs: true });
		renderRegionEditTabs();
		setRegionEditStatus();
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht geladen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geladen werden.", "error");
	}
}

async function activatePrimaryRegionEditTabForTerritory(territoryPublicId) {
	if (!territoryPublicId) {
		return;
	}

	const primaryTab = regionEditTabs[0] || null;
	const currentTerritoryId = primaryTab?.region?.territoryPublicId || "";
	if (currentTerritoryId === territoryPublicId) {
		activeRegionEditTabKey = primaryTab?.key || territoryPublicId;
		if (primaryTab) {
			populateRegionEditForm(primaryTab.region, { preserveTabs: true });
			renderRegionEditTabs();
		}
		return;
	}

	setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
	const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
	const region = normalizePoliticalTerritoryForRegionEdit({
		...(response.territory || {}),
		assignment_chain: response.assignment_chain || [],
	}, response.wiki || null);
	const geometryPublicId = getPrimaryRegionGeometryPublicId();
	if (geometryPublicId) {
		region.geometryPublicId = geometryPublicId;
	}
	const geometryAssignment = getActiveRegionGeometryAssignment(territoryPublicId);
	const assignGeometryPublicId = geometryAssignment?.geometryPublicId || "";
	regionEditTabs = regionEditTabs.filter((tab, index) => index === 0 || tab.key !== territoryPublicId);
	const nextPrimaryTab = {
		key: territoryPublicId,
		entry: primaryTab?.entry || regionEditEntry || region,
		region,
		payload: null,
		savedPayload: regionEditPayloadToPayload(region),
		assignGeometryPublicId,
		assignGeometryMode: geometryAssignment?.mode || "",
	};
	if (regionEditTabs.length > 0) {
		regionEditTabs[0] = nextPrimaryTab;
	} else {
		regionEditTabs = [nextPrimaryTab];
	}
	activeRegionEditTabKey = territoryPublicId;
	populateRegionEditForm(nextPrimaryTab.region, { preserveTabs: true });
	renderRegionEditTabs();
	setRegionEditStatus();
}

function askRegionTabCloseChoice() {
	return new Promise((resolve) => {
		const overlay = document.createElement("div");
		overlay.className = "political-territory-confirm";
		overlay.innerHTML = `
			<div class="political-territory-confirm__dialog" role="dialog" aria-modal="true" aria-labelledby="region-tab-close-title">
				<h3 id="region-tab-close-title">Änderungen speichern?</h3>
				<p>Der Tab enthält ungespeicherte Änderungen.</p>
				<div class="political-territory-confirm__actions">
					<button type="button" data-region-tab-close-choice="save">Ja</button>
					<button type="button" data-region-tab-close-choice="discard">Nein</button>
					<button type="button" data-region-tab-close-choice="cancel">Abbrechen</button>
				</div>
			</div>
		`;
		const finish = (choice) => {
			overlay.remove();
			resolve(choice);
		};
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				finish("cancel");
			}
		});
		overlay.querySelectorAll("[data-region-tab-close-choice]").forEach((button) => {
			button.addEventListener("click", () => finish(button.dataset.regionTabCloseChoice || "cancel"));
		});
		document.body.append(overlay);
		overlay.querySelector("[data-region-tab-close-choice='save']")?.focus();
	});
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
