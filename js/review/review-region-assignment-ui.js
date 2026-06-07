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
		setRegionEditStatus("Bitte den untersten Knoten der Hierarchie auswählen.", "error");
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
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern übernimmt die Geometrie dauerhaft.", "success");
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
