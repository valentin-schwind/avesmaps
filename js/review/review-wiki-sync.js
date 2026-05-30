function resetWikiSyncResolveForm() {
	const formElement = getWikiSyncResolveFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("wiki-sync-resolve-public-id")?.value || "";
	formElement.reset();
	activeWikiSyncCase = null;
	activeWikiSyncSelectedMap = null;
	activeWikiSyncSelectedWiki = null;
	activeWikiSyncPreset = null;
	document.getElementById("wiki-sync-resolve-case-id").value = "";
	document.getElementById("wiki-sync-resolve-public-id").value = "";
	document.getElementById("wiki-sync-resolve-expected-revision").value = "";
	document.getElementById("wiki-sync-resolve-lat").value = "";
	document.getElementById("wiki-sync-resolve-lng").value = "";
	document.getElementById("wiki-sync-resolve-coordinates").textContent = "-";
	syncWikiSyncResolveLinkButton();
	void releaseFeatureSoftLock(publicId);
	setWikiSyncResolveStatus();
}

function setWikiSyncResolveDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isWikiSyncResolveSubmissionPending) {
		return;
	}

	$("#wiki-sync-resolve-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getWikiSyncResolveDialogElement()?.focus();
		document.getElementById("wiki-sync-resolve-name")?.focus();
		return;
	}

	if (resetForm) {
		resetWikiSyncResolveForm();
	}
}

function setWikiSyncLocationsRunning(isRunning, run = null) {
	isWikiSyncLocationsRunning = isRunning;

	const buttonElement = document.getElementById("wiki-sync-start");
	if (buttonElement) {
		buttonElement.disabled = isRunning || isWikiSyncTerritoriesRunning;
		buttonElement.textContent = isRunning ? "Synchronisiert..." : "WikiSync";
	}

	const progressElement = document.getElementById("wiki-sync-progress");
	if (progressElement) {
		progressElement.hidden = !isRunning;

		if (isRunning) {
			const completedSteps = Number(run?.completed_steps ?? run?.processed_steps ?? run?.step ?? 0);
			const totalSteps = Number(run?.total_steps ?? run?.steps_total ?? progressElement.max ?? 5);

			progressElement.max = Number.isFinite(totalSteps) && totalSteps > 0 ? totalSteps : 5;
			progressElement.value = Number.isFinite(completedSteps) && completedSteps >= 0 ? completedSteps : 0;
		} else {
			progressElement.value = 0;
		}
	}

	syncWikiSyncPanelHeaderState();
}

function setWikiSyncTerritoriesRunning(isRunning) {
	isWikiSyncTerritoriesRunning = isRunning;

	const buttonElement = document.getElementById("wiki-sync-territories");
	if (buttonElement) {
		buttonElement.disabled = isRunning || isWikiSyncLocationsRunning;
		buttonElement.textContent = isRunning ? "Synchronisiert..." : "WikiSync";
	}

	const progressElement = document.getElementById("wiki-sync-territories-progress");
	if (progressElement) {
		progressElement.hidden = !isRunning;
		progressElement.max = 1;
		progressElement.value = isRunning ? 0 : 0;
	}

	syncWikiSyncPanelHeaderState();
}

async function loadWikiSyncCases() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setWikiSyncStatus("WikiSyncLocations-Fälle werden geladen...", "pending");
	try {
		const data = await fetchWikiSyncLocationData({ action: "cases" });

		wikiSyncCases = Array.isArray(data.cases) ? data.cases : [];
		wikiSyncSummary = data.summary || null;
		const activeRun = data.active_run || null;
		activeWikiSyncRunId = activeRun?.status === "running" ? activeRun.public_id : null;
		activeWikiSyncRunStatus = activeRun?.status === "running" ? "running" : "";
		renderWikiSyncCases(data.latest_run || null);
		syncWikiSyncCreateLocationContextMenuAction();

		if (activeRun?.status === "running") {
			setWikiSyncLocationsRunning(false, activeRun);
			setWikiSyncStatus(activeRun.message || "Ein WikiSync-Lauf kann fortgesetzt werden.", "pending");
		} else {
			setWikiSyncLocationsRunning(false);
		}
	} catch (error) {
		console.error("WikiSyncLocations-Fälle konnten nicht geladen werden:", error);
		setWikiSyncStatus(error.message || "WikiSyncLocations-Fälle konnten nicht geladen werden.", "error");
	}
}

function refreshActiveWikiSyncPanel() {
	if (activeWikiSyncPanelTab === "territories") {
		return renderWikiSyncTerritoryTree();
	}

	return loadWikiSyncCases();
}

function setWikiSyncPanelTab(tabName) {
	activeWikiSyncPanelTab = tabName === "territories" ? "territories" : "locations";

	document.querySelectorAll("[data-wiki-sync-panel-tab]").forEach((tabElement) => {
		const isActive = tabElement.dataset.wikiSyncPanelTab === activeWikiSyncPanelTab;
		tabElement.classList.toggle("is-active", isActive);
		tabElement.setAttribute("aria-selected", isActive ? "true" : "false");
	});

	document.querySelectorAll("[data-wiki-sync-panel-section]").forEach((sectionElement) => {
		sectionElement.classList.toggle("is-active", sectionElement.dataset.wikiSyncPanelSection === activeWikiSyncPanelTab);
	});

	if (activeWikiSyncPanelTab === "territories") {
		void renderWikiSyncTerritoryTree();
	} else {
		renderWikiSyncCases();
	}
}

function syncWikiSyncTerritoryFilterControls() {
	const inputElement = document.getElementById("wiki-sync-territory-filter");
	if (inputElement instanceof HTMLInputElement) {
		inputElement.value = wikiSyncTerritoryFilterQuery;
	}
}

function setWikiSyncTerritoryFilterQuery(value) {
	const nextQuery = String(value || "");
	const previousNormalized = getWikiSyncTerritoryFilterQuery();
	const nextNormalized = normalizeSearchText(nextQuery);

	wikiSyncTerritoryFilterQuery = nextQuery;
	syncWikiSyncTerritoryFilterControls();

	if (previousNormalized !== nextNormalized) {
		void renderWikiSyncTerritoryTree();
	}
}

function getWikiSyncTerritoryFilterQuery() {
	return normalizeSearchText(wikiSyncTerritoryFilterQuery);
}

async function loadWikiSyncTerritoryTreeRows({ forceReload = false } = {}) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	if (!treeModule || typeof treeModule.fetchRows !== "function" || typeof treeModule.buildTree !== "function") {
		throw new Error("Die gemeinsame Herrschaftsgebiet-Baumkomponente konnte nicht geladen werden.");
	}

	if (!forceReload && wikiSyncTerritoryTreeRowsLoaded) {
		return wikiSyncTerritoryTreeRowsCache;
	}

	const response = await treeModule.fetchRows({
		apiUrl: treeModule.defaultApiUrl || "/api/app/political-territory-wiki.php",
		credentials: "same-origin",
	});

	wikiSyncTerritoryTreeRowsCache = Array.isArray(response?.rows) ? response.rows : [];
	wikiSyncTerritoryTreeRowsLoaded = true;

	const fullTree = treeModule.buildTree(wikiSyncTerritoryTreeRowsCache);
	wikiSyncTerritoryTreeRootCountCache = Array.isArray(fullTree?.root?.children) ? fullTree.root.children.length : 0;

	return wikiSyncTerritoryTreeRowsCache;
}

function waitForWikiSyncTreeComponent(timeoutMs = 8000) {
	// Die geteilte Baumkomponente (territory-wiki-tree.js) wird dynamisch und damit
	// teils NACH review-wiki-sync.js geladen. Frueher scheiterte der erste Render-
	// Versuch hart ("Komponente konnte nicht geladen werden") und wurde nie wiederholt.
	// Hier warten wir kurz, bis die Komponente bereitsteht (Polling), bevor wir aufgeben.
	const ready = () => {
		const module = window.AvesmapsPoliticalTerritoryWikiTree;
		return module
			&& typeof module.filterRows === "function"
			&& typeof module.buildTree === "function"
			&& typeof module.renderTree === "function"
			? module
			: null;
	};
	const immediate = ready();
	if (immediate) {
		return Promise.resolve(immediate);
	}
	return new Promise((resolve) => {
		const start = Date.now();
		const timer = window.setInterval(() => {
			const module = ready();
			if (module || Date.now() - start >= timeoutMs) {
				window.clearInterval(timer);
				resolve(module);
			}
		}, 50);
	});
}

async function renderWikiSyncTerritoryTree({ forceReload = false } = {}) {
	const treeElement = document.getElementById("wiki-sync-territory-tree");
	if (!treeElement) {
		return;
	}

	treeElement.innerHTML = "";
	syncWikiSyncTerritoryFilterControls();

	if (!wikiSyncTerritoryTreeRowsLoaded && !forceReload) {
		const loadingElement = document.createElement("p");
		loadingElement.className = "political-territory-parent-tree__empty";
		loadingElement.textContent = "Herrschaftsgebiete werden geladen...";
		treeElement.append(loadingElement);
	}

	try {
		const treeModule = await waitForWikiSyncTreeComponent();
		if (!treeModule || typeof treeModule.filterRows !== "function" || typeof treeModule.buildTree !== "function" || typeof treeModule.renderTree !== "function") {
			throw new Error("Die gemeinsame Herrschaftsgebiet-Baumkomponente konnte nicht geladen werden.");
		}

		const rows = await loadWikiSyncTerritoryTreeRows({ forceReload });
		const filteredRows = treeModule.filterRows(rows, {
			search: getWikiSyncTerritoryFilterQuery(),
		});
		const treeResult = treeModule.buildTree(filteredRows);

		treeModule.renderTree({
			container: treeElement,
			root: treeResult.root,
			rowCount: filteredRows.length,
			totalRowCount: rows.length,
			searchText: wikiSyncTerritoryFilterQuery,
			itemClassName: "wiki-sync-territory-tree__item",
			onItemClick: (node, event) => {
				event.stopPropagation();
			},
		});

		if (filteredRows.length < 1) {
			treeElement.innerHTML = "";
			const emptyElement = document.createElement("p");
			emptyElement.className = "political-territory-parent-tree__empty";
			emptyElement.textContent = getWikiSyncTerritoryFilterQuery() !== "" ? "Keine Treffer" : "Keine Herrschaftsgebiete geladen";
			treeElement.append(emptyElement);
		}

		syncWikiSyncPanelHeaderState();
	} catch (error) {
		console.error("Herrschaftsgebiete konnten nicht geladen werden:", error);
		treeElement.innerHTML = "";
		const errorElement = document.createElement("p");
		errorElement.className = "political-territory-parent-tree__empty";
		errorElement.textContent = error.message || "Herrschaftsgebiete konnten nicht geladen werden.";
		treeElement.append(errorElement);
	}
}

async function startWikiSyncRun() {
	if (isWikiSyncLocationsRunning) {
		return;
	}

	setWikiSyncLocationsRunning(true);
	setWikiSyncStatus(activeWikiSyncRunStatus === "running" ? "WikiSyncLocations wird fortgesetzt..." : "WikiSyncLocations wird gestartet...", "pending");

	try {
		let run = null;
		if (activeWikiSyncRunStatus === "running" && activeWikiSyncRunId) {
			run = { public_id: activeWikiSyncRunId, status: "running" };
		} else {
			const startResult = await submitWikiSyncLocationAction("start_run");
			activeWikiSyncRunId = startResult.run?.public_id || null;
			activeWikiSyncRunStatus = startResult.run?.status || "running";
			run = startResult.run || null;
		}
		let safetyCounter = 0;
		setWikiSyncLocationsRunning(true, run);

		while (run && run.status !== "completed" && run.status !== "failed") {
			if (safetyCounter > 8) {
				throw new Error("WikiSync wurde nach zu vielen Teilschritten angehalten.");
			}

			const advanceResult = await submitWikiSyncLocationAction("advance_run", { run_id: activeWikiSyncRunId });
			run = advanceResult.run || null;
			activeWikiSyncRunStatus = run?.status || "";
			wikiSyncSummary = advanceResult.summary || wikiSyncSummary;
			setWikiSyncLocationsRunning(true, run);
			setWikiSyncStatus(run?.message || "WikiSync läuft...", "pending");
			safetyCounter += 1;
		}

		if (run?.status === "failed") {
			throw new Error(run.message || "WikiSync ist fehlgeschlagen.");
		}

		setWikiSyncLocationsRunning(false);
		activeWikiSyncRunStatus = "";
		await loadWikiSyncCases();
		setWikiSyncStatus(buildWikiSyncStatusMessage("WikiSyncLocations abgeschlossen."), "success");
	} catch (error) {
		console.error("WikiSyncLocations konnte nicht ausgeführt werden:", error);
		activeWikiSyncRunStatus = "";
		setWikiSyncLocationsRunning(false);
		setWikiSyncStatus(error.message || "WikiSyncLocations konnte nicht ausgeführt werden.", "error");
		showFeedbackToast(error.message || "WikiSyncLocations konnte nicht ausgeführt werden.", "warning");
	}
}

async function startWikiSyncTerritoryRun() {
	if (isWikiSyncLocationsRunning || isWikiSyncTerritoriesRunning) {
		return;
	}

	setWikiSyncTerritoriesRunning(true);
	setWikiSyncStatus("WikiSyncTerritories wird gestartet...", "pending");

	try {
		const result = await submitWikiSyncTerritoryAction("sync_territories");
		wikiSyncTerritorySummary = {
			territory_count: Number(result?.territory_count ?? 0),
			root_count: Number(result?.root_count ?? 0),
			assigned_territory_count: Number(result?.assigned_territory_count ?? 0),
			assigned_root_count: Number(result?.assigned_root_count ?? 0),
		};
		syncWikiSyncPanelHeaderState();
		await loadPoliticalTerritoryOptions();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		if (activeWikiSyncPanelTab === "territories") {
			await renderWikiSyncTerritoryTree({ forceReload: true });
		}
		setWikiSyncStatus(buildWikiSyncStatusMessage("WikiSyncTerritories abgeschlossen."), "success");
	} catch (error) {
		console.error("WikiSyncTerritories konnte nicht ausgefuehrt werden:", error);
		setWikiSyncStatus(error.message || "WikiSyncTerritories konnte nicht ausgefuehrt werden.", "error");
		showFeedbackToast(error.message || "WikiSyncTerritories konnte nicht ausgefuehrt werden.", "warning");
	} finally {
		setWikiSyncTerritoriesRunning(false);
	}
}

function buildWikiSyncStatusMessage(message = "") {
	return String(message || "").trim();
}

function syncWikiSyncPanelHeaderState() {
	syncWikiSyncPanelSummaries();
	syncWikiSyncActionButtonLabels();
}

function syncWikiSyncPanelSummaries() {
	const locationsSummaryElement = document.getElementById("wiki-sync-locations-summary");
	const territoriesSummaryElement = document.getElementById("wiki-sync-territories-summary");

	if (locationsSummaryElement) {
		locationsSummaryElement.textContent = formatWikiSyncSettlementSummaryText();
	}

	if (territoriesSummaryElement) {
		territoriesSummaryElement.textContent = formatWikiSyncTerritorySummaryText();
	}
}

function syncWikiSyncActionButtonLabels() {
	const locationsButtonElement = document.getElementById("wiki-sync-start");
	const territoriesButtonElement = document.getElementById("wiki-sync-territories");

	if (locationsButtonElement) {
		locationsButtonElement.textContent = isWikiSyncLocationsRunning ? "Synchronisiert..." : "WikiSync";
	}

	if (territoriesButtonElement) {
		territoriesButtonElement.textContent = isWikiSyncTerritoriesRunning ? "Synchronisiert..." : "WikiSync";
	}
}

function formatWikiSyncSettlementSummaryText() {
	const openCount = Number(wikiSyncSummary?.by_status?.open ?? wikiSyncCases.filter((caseEntry) => caseEntry.status === "open").length);
	const deferredCount = Number(wikiSyncSummary?.by_status?.deferred ?? wikiSyncCases.filter((caseEntry) => caseEntry.status === "deferred").length);
	const archivedCount = Number(wikiSyncSummary?.by_status?.archived ?? wikiSyncCases.filter((caseEntry) => caseEntry.status === "archived").length);

	if (openCount < 1 && deferredCount < 1 && archivedCount < 1) {
		return "Keine Siedlungsdaten geladen";
	}

	return `${openCount} offen, ${deferredCount} zurückgestellt, ${archivedCount} archiviert`;
}

function formatWikiSyncTerritorySummaryText() {
	const syncedTerritoryCount = Number(wikiSyncTerritorySummary?.territory_count ?? 0);
	const syncedRootCount = Number(wikiSyncTerritorySummary?.root_count ?? 0);

	if (syncedTerritoryCount > 0 || syncedRootCount > 0) {
		return `${syncedTerritoryCount} Herrschaftsgebiete in ${syncedRootCount} Hauptmächte`;
	}

	const fallbackSummary = getWikiSyncTerritoryLoadedDataSummary();
	if (fallbackSummary.territoryCount < 1 && fallbackSummary.rootCount < 1) {
		return "Keine Herrschaftsgebietsdaten geladen";
	}

	return `${fallbackSummary.territoryCount} in ${fallbackSummary.rootCount} Hauptmächte`;
}

function getWikiSyncTerritoryLoadedDataSummary() {
	const territoryCount = wikiSyncTerritoryTreeRowsLoaded
		? wikiSyncTerritoryTreeRowsCache.length
		: (Array.isArray(politicalTerritoryOptions) ? politicalTerritoryOptions : [])
			.filter((territory) => String(territory?.public_id || "").trim() !== "")
			.length;
	const rootCount = wikiSyncTerritoryTreeRowsLoaded
		? Number(wikiSyncTerritoryTreeRootCountCache || 0)
		: (Array.isArray(politicalTerritoryHierarchy) && politicalTerritoryHierarchy.length > 0)
			? politicalTerritoryHierarchy.filter((node) => String(node?.name || "").trim() !== "").length
			: (Array.isArray(politicalTerritoryOptions) ? politicalTerritoryOptions : [])
				.filter((territory) => {
					const publicId = String(territory?.public_id || "").trim();
					const parentPublicId = String(territory?.parent_public_id || "").trim();
					return publicId !== "" && parentPublicId === "";
				}).length;

	return {
		territoryCount,
		rootCount,
	};
}

function renderWikiSyncCases(latestRun = null) {
	const listElement = document.getElementById("wiki-sync-case-list");
	if (!listElement) {
		return;
	}
	syncWikiSyncPanelHeaderState();

	const previousOpenGroupKeys = getWikiSyncOpenGroupKeys();
	const filterQuery = getWikiSyncFilterQuery();
	const filterDisplayQuery = String(wikiSyncFilterQuery || "").trim();
	const hasActiveFilter = filterQuery !== "";
	const shouldCollapseGroups = wikiSyncFilterCollapseRequested && !hasActiveFilter;
	listElement.innerHTML = "";
	syncWikiSyncFilterControls();

	if (!latestRun && wikiSyncCases.length < 1) {
		setWikiSyncStatus(buildWikiSyncStatusMessage("Noch kein WikiSync-Lauf. Starte die Synchronisierung manuell."), "empty");
		return;
	}

	if (wikiSyncCases.length < 1) {
		setWikiSyncStatus(buildWikiSyncStatusMessage("Keine WikiSync-Fälle."), "empty");
		return;
	}

	const filteredCases = hasActiveFilter ? getWikiSyncFilteredCases(wikiSyncCases, filterQuery) : wikiSyncCases;
	const statusMessage = isWikiSyncCreateLocationSelectionActive
		? "Wählen Sie den Ort aus der Liste."
		: hasActiveFilter
		? `${filteredCases.length} Treffer für "${filterDisplayQuery}".`
		: "";
	setWikiSyncStatus(buildWikiSyncStatusMessage(statusMessage), isWikiSyncCreateLocationSelectionActive ? "pending" : "success");

	const renderedGroupElements = new Map();
	const openSectionElement = renderWikiSyncCaseSection(listElement, "Offen", "open", filteredCases.filter((caseEntry) => caseEntry.status !== "archived"), renderedGroupElements);
	const deferredSectionElement = renderWikiSyncCaseSection(listElement, "Zurückgestellt", "deferred", filteredCases.filter((caseEntry) => caseEntry.status === "deferred"), renderedGroupElements);
	const archivedSectionElement = renderWikiSyncCaseSection(listElement, "Archiviert", "archived", filteredCases.filter((caseEntry) => caseEntry.status === "archived"), renderedGroupElements);
	if (!openSectionElement && !archivedSectionElement) {
		setWikiSyncStatus(buildWikiSyncStatusMessage(hasActiveFilter ? `Keine Treffer für "${filterDisplayQuery}".` : "Keine WikiSync-Fälle."), "empty");
		wikiSyncFilterCollapseRequested = false;
		syncWikiSyncCreateLocationContextMenuAction();
		return;
	}

	if (hasActiveFilter) {
		isWikiSyncAccordionRestoring = true;
		try {
			listElement.querySelectorAll(".wiki-sync-case-group").forEach((detailsElement) => {
				if (detailsElement instanceof HTMLDetailsElement) {
					detailsElement.open = true;
				}
			});
			if (isWikiSyncCreateLocationSelectionActive) {
				const selectionGroupElement = listElement.querySelector('.wiki-sync-case-group[data-case-type="missing_wiki_without_coordinates"]');
				if (selectionGroupElement instanceof HTMLDetailsElement) {
					selectionGroupElement.open = true;
				}
			}
		} finally {
			window.requestAnimationFrame(() => {
				isWikiSyncAccordionRestoring = false;
			});
		}
	} else if (!shouldCollapseGroups) {
		restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys);
	}

	wikiSyncFilterCollapseRequested = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function getWikiSyncOpenGroupKeys() {
	return Array.from(document.querySelectorAll("#wiki-sync-case-list .wiki-sync-case-group[open]"))
		.map((groupElement) => (groupElement instanceof HTMLElement ? String(groupElement.dataset.groupKey || "") : ""))
		.filter((groupKey) => groupKey !== "");
}

function restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys) {
	if (!Array.isArray(previousOpenGroupKeys) || previousOpenGroupKeys.length < 1) {
		return;
	}

	isWikiSyncAccordionRestoring = true;
	try {
		previousOpenGroupKeys.forEach((groupKey) => {
			const groupElement = renderedGroupElements.get(groupKey) || getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey);
			if (groupElement) {
				groupElement.open = true;
			}
		});
	} finally {
		window.requestAnimationFrame(() => {
			isWikiSyncAccordionRestoring = false;
		});
	}
}

function syncWikiSyncFilterControls() {
	const inputElement = document.getElementById("wiki-sync-filter");
	if (inputElement instanceof HTMLInputElement) {
		inputElement.value = wikiSyncFilterQuery;
	}
}

function setWikiSyncFilterQuery(value) {
	const nextQuery = String(value || "");
	const previousNormalized = getWikiSyncFilterQuery();
	const nextNormalized = normalizeWikiSyncFilterQuery(nextQuery);
	if (nextQuery === wikiSyncFilterQuery) {
		syncWikiSyncFilterControls();
		return;
	}

	const hadFilter = previousNormalized !== "";
	wikiSyncFilterQuery = nextQuery;
	wikiSyncFilterCollapseRequested = hadFilter && nextNormalized === "";
	syncWikiSyncFilterControls();
	if (previousNormalized !== nextNormalized || wikiSyncFilterCollapseRequested) {
		renderWikiSyncCases();
	}
}

function getWikiSyncFilterQuery() {
	return normalizeWikiSyncFilterQuery(wikiSyncFilterQuery);
}

function normalizeWikiSyncFilterQuery(value) {
	return normalizeWikiSyncSearchText(value).trim();
}

function normalizeWikiSyncSearchText(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/ß/g, "ss")
		.toLowerCase();
}

function getWikiSyncCaseSearchText(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || {};
	const resolutionFeature = getWikiSyncResolvedFeature(caseEntry) || {};
	const wikiPage = payload.wiki || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	const proposedLocation = payload.proposed_location || {};
	const tokens = [
		caseEntry.case_label,
		caseEntry.case_type,
		formatWikiSyncCaseStatus(caseEntry.status),
		getWikiSyncCaseTitle(caseEntry),
		payload.name,
		mapPlace.name,
		mapPlace.settlement_label,
		mapPlace.settlement_class,
		resolutionFeature.name,
		resolutionFeature.location_type_label,
		resolutionFeature.feature_subtype,
		wikiPage.title,
		wikiPage.url,
		payload.match_kind,
		proposedLocation.source_label,
		proposedLocation.source,
		proposedLocation.warnings?.join(" "),
		...candidates.map((candidate) => candidate.title || ""),
		...matches.map((match) => match.name || ""),
	];

	if (proposedLocation.lat !== undefined && proposedLocation.lng !== undefined) {
		tokens.push(formatLocationReportCoordinates(proposedLocation));
	}

	return normalizeWikiSyncSearchText(tokens.filter(Boolean).join(" "));
}

function getWikiSyncFilteredCases(cases = wikiSyncCases, filterQuery = "") {
	const normalizedQuery = normalizeWikiSyncFilterQuery(filterQuery);
	if (!normalizedQuery) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	if (queryTokens.length < 1) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	return (Array.isArray(cases) ? cases : []).filter((caseEntry) => {
		const searchableText = getWikiSyncCaseSearchText(caseEntry);
		return queryTokens.every((token) => searchableText.includes(token));
	});
}

function hasWikiSyncMissingWikiWithoutCoordinatesCases() {
	return wikiSyncCases.some((caseEntry) => caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status !== "archived");
}

function syncWikiSyncCreateLocationContextMenuAction() {
	const actionElement = document.querySelector('[data-context-action="create-location-from-wiki"]');
	if (!actionElement) {
		return;
	}

	actionElement.hidden = !hasWikiSyncMissingWikiWithoutCoordinatesCases();
}

function startWikiSyncCreateLocationSelection(latlng) {
	wikiSyncCreateLocationContextLatLng = L.latLng(latlng);
	isWikiSyncCreateLocationSelectionActive = true;
	if (isReviewPanelHidden) {
		toggleReviewPanel();
	}
	window.setEditorPanelTab?.("wiki-sync");
	setWikiSyncStatus("Wählen Sie den Ort aus der Liste.", "pending");
	showFeedbackToast("Wählen Sie den Ort aus der Liste.", "info");
}

function clearWikiSyncCreateLocationSelection() {
	wikiSyncCreateLocationContextLatLng = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function resetWikiSyncCreateLocationFlowState() {
	wikiSyncCreateLocationContextLatLng = null;
	wikiSyncCreateLocationCaseId = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function openWikiSyncCreateLocationDialogFromCase(caseEntry) {
	const latlng = wikiSyncCreateLocationContextLatLng ? L.latLng(wikiSyncCreateLocationContextLatLng) : null;
	if (!latlng) {
		showFeedbackToast("Bitte zuerst eine Position auf der Karte wählen.", "warning");
		return;
	}

	const wikiPage = caseEntry.payload?.wiki || {};
	const presetName = wikiPage.title || "";
	const presetLocationType = normalizeLocationType(wikiPage.settlement_class || "dorf");
	const presetWikiUrl = wikiPage.url || "";
	wikiSyncCreateLocationCaseId = Number(caseEntry.id) || null;
	clearWikiSyncCreateLocationSelection();
	openLocationEditDialog({
		latlng,
		presetName,
		presetLocationType,
		presetWikiUrl,
		presetDescription: "",
	});
	renderWikiSyncCases();
	showFeedbackToast("Wiki-Ort wird als neuer Ort angelegt.", "success");
}

function getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey) {
	const parts = String(groupKey).split(":");
	if (parts.length < 2) {
		return null;
	}

	const sectionKey = parts.shift();
	const caseType = parts.join(":");
	if (sectionKey !== "open") {
		return null;
	}

	return renderedGroupElements.get(`archived:${caseType}`) || null;
}

function renderWikiSyncCaseSection(listElement, title, sectionKey, cases, renderedGroupElements) {
	if (!Array.isArray(cases) || cases.length < 1) {
		return null;
	}

	const sectionElement = document.createElement("section");
	sectionElement.className = `wiki-sync-case-section wiki-sync-case-section--${sectionKey}`;
	sectionElement.dataset.sectionKey = sectionKey;

	const titleElement = document.createElement("h3");
	titleElement.className = "wiki-sync-case-section__title";
	titleElement.textContent = title;
	sectionElement.appendChild(titleElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-section__body";
	getWikiSyncGroupedCases(cases).forEach((group) => {
		const groupElement = createWikiSyncCaseGroupElement(group, sectionKey);
		renderedGroupElements.set(groupElement.dataset.groupKey || `${sectionKey}:${group.caseType}`, groupElement);
		bodyElement.appendChild(groupElement);
	});

	if (bodyElement.childElementCount < 1) {
		return null;
	}

	sectionElement.appendChild(bodyElement);
	listElement.appendChild(sectionElement);
	return sectionElement;
}

function handleWikiSyncCaseGroupToggle(event) {
	if (isWikiSyncAccordionRestoring) {
		return;
	}

	const groupElement = event.currentTarget;
	if (!(groupElement instanceof HTMLDetailsElement) || !groupElement.open) {
		return;
	}

	const sectionElement = groupElement.closest(".wiki-sync-case-section");
	if (!sectionElement) {
		return;
	}

	sectionElement.querySelectorAll(".wiki-sync-case-group").forEach((otherGroupElement) => {
		if (otherGroupElement !== groupElement && otherGroupElement instanceof HTMLDetailsElement) {
			otherGroupElement.open = false;
		}
	});

	window.requestAnimationFrame(() => {
		groupElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
}

function getWikiSyncGroupedCases(cases = wikiSyncCases) {
	const groupsByType = new Map();
	cases.forEach((caseEntry) => {
		const caseType = caseEntry.case_type || "unknown";
		if (!groupsByType.has(caseType)) {
			groupsByType.set(caseType, {
				caseType,
				label: caseEntry.case_label || getWikiSyncCaseTypeLabel(caseType),
				cases: [],
			});
		}

		groupsByType.get(caseType).cases.push(caseEntry);
	});

	return Array.from(groupsByType.values()).sort((left, right) => getWikiSyncCaseTypeOrder(left.caseType) - getWikiSyncCaseTypeOrder(right.caseType));
}

function getWikiSyncCaseTypeOrder(caseType) {
	const order = {
		canonical_name_difference: 10,
		type_conflict: 20,
		probable_match: 30,
		unresolved_without_candidate: 40,
		duplicate_avesmaps_name: 50,
		duplicate_wiki_title: 60,
		missing_wiki_with_coordinates: 70,
		missing_wiki_without_coordinates: 80,
	};

	return order[caseType] || 999;
}

function getWikiSyncCaseTypeLabel(caseType) {
	const labels = {
		canonical_name_difference: "Abweichende Benennung",
		type_conflict: "Typkonflikte",
		probable_match: "Unaufgelöst, aber mit wahrscheinlichem Match",
		unresolved_without_candidate: "Unaufgelöst, ohne Match",
		duplicate_avesmaps_name: "Dubletten in Avesmaps",
		duplicate_wiki_title: "Mehrere Avesmaps-Namen zeigen auf denselben Wiki-Titel",
		missing_wiki_with_coordinates: "Fehlende Wiki-Orte mit Koordinaten",
		missing_wiki_without_coordinates: "Fehlende Wiki-Orte ohne nutzbare Koordinaten",
	};

	return labels[caseType] || caseType;
}

function getWikiSyncResolvedFeature(caseEntry) {
	return caseEntry?.resolution?.feature || caseEntry?.payload?.resolution?.feature || null;
}

function createWikiSyncCaseElement(caseEntry) {
	const payload = caseEntry.payload || {};
	const detailsElement = document.createElement("details");
	detailsElement.className = "wiki-sync-case";
	detailsElement.dataset.caseId = String(caseEntry.id || "");
	detailsElement.dataset.caseType = caseEntry.case_type || "";

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case__title";
	titleElement.textContent = getWikiSyncCaseTitle(caseEntry);
	const statusElement = document.createElement("span");
	statusElement.className = `wiki-sync-case__status wiki-sync-case__status--${caseEntry.status || "open"}`;
	statusElement.textContent = formatWikiSyncCaseStatus(caseEntry.status);
	summaryElement.append(titleElement, statusElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case__body";
	appendWikiSyncCaseRows(bodyElement, caseEntry);
	appendWikiSyncCaseCandidates(bodyElement, caseEntry);
	appendWikiSyncCaseActions(bodyElement, caseEntry);

	detailsElement.append(summaryElement, bodyElement);
	detailsElement.addEventListener("toggle", () => {
		if (isWikiSyncAccordionRestoring) {
			return;
		}

		if (detailsElement.open && (payload.map || payload.proposed_location || Array.isArray(payload.matches))) {
			focusWikiSyncCase(caseEntry);
		}
	});

	return detailsElement;
}

function createWikiSyncCaseGroupElement(group, sectionKey) {
	const groupElement = document.createElement("details");
	groupElement.className = "wiki-sync-case-group";
	groupElement.dataset.caseType = group.caseType;
	groupElement.dataset.sectionKey = sectionKey;
	groupElement.dataset.groupKey = `${sectionKey}:${group.caseType}`;
	groupElement.addEventListener("toggle", handleWikiSyncCaseGroupToggle);

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case-group__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case-group__title";
	titleElement.textContent = group.label;
	const countElement = document.createElement("span");
	countElement.className = "wiki-sync-case-group__count";
	countElement.textContent = String(group.cases.length);
	summaryElement.append(titleElement, countElement);
	groupElement.appendChild(summaryElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-group__body";
	group.cases.forEach((caseEntry) => bodyElement.appendChild(createWikiSyncCaseElement(caseEntry)));
	groupElement.appendChild(bodyElement);

	return groupElement;
}

function appendWikiSyncCaseRows(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || getWikiSyncResolvedFeature(caseEntry);
	const wikiPage = payload.wiki || null;

	if (mapPlace) {
		appendWikiSyncInfoRow(bodyElement, "Avesmaps", `${mapPlace.name || "Unbenannt"} · ${mapPlace.settlement_label || mapPlace.location_type_label || mapPlace.settlement_class || mapPlace.feature_subtype || "Ort"}`);
	}

	if (wikiPage) {
		appendWikiSyncLinkRow(bodyElement, "Wiki", wikiPage.title || "Wiki Aventurica", wikiPage.url || "");
	}

	if (payload.match_kind) {
		appendWikiSyncInfoRow(bodyElement, "Match", formatWikiSyncMatchKind(payload.match_kind));
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		appendWikiSyncInfoRow(bodyElement, "Name", payload.name || "Unbenannt");
		appendWikiSyncInfoRow(bodyElement, "Treffer", String(Array.isArray(payload.matches) ? payload.matches.length : 0));
	}

	if (payload.proposed_location) {
		const sourceLabel = payload.proposed_location.source_label || payload.proposed_location.source || "Koordinaten";
		appendWikiSyncInfoRow(bodyElement, "Position", `${formatLocationReportCoordinates(payload.proposed_location)} · ${sourceLabel}`);
		if (Array.isArray(payload.proposed_location.warnings) && payload.proposed_location.warnings.length > 0) {
			appendWikiSyncInfoRow(bodyElement, "Hinweis", payload.proposed_location.warnings.join(" "));
		}
	}
}

function appendWikiSyncCaseCandidates(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];

	if (caseEntry.case_type === "duplicate_avesmaps_name" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Dubletten";
		sectionElement.appendChild(labelElement);

		matches.forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"} · ${match.settlement_label || match.settlement_class || "Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (caseEntry.case_type === "duplicate_wiki_title" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);

		matches.slice(0, 2).forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				entryActionsElement.appendChild(acceptButtonElement);
			}

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);
		matches.forEach((match) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "focus";
			buttonElement.dataset.publicId = match.public_id || "";
			buttonElement.textContent = match.name || "Unbenannter Ort";
			sectionElement.appendChild(buttonElement);
			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				sectionElement.appendChild(acceptButtonElement);
			}
		});
		bodyElement.appendChild(sectionElement);
	}

	if (candidates.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Wiki-Kandidaten";
		sectionElement.appendChild(labelElement);
		candidates.forEach((candidate, index) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "resolve";
			buttonElement.dataset.candidateIndex = String(index);
			buttonElement.textContent = `${candidate.title || "Wiki-Kandidat"}${candidate.score ? ` (${Math.round(Number(candidate.score) * 100)}%)` : ""}`;
			sectionElement.appendChild(buttonElement);
		});
		bodyElement.appendChild(sectionElement);
	}
}

function appendWikiSyncCaseActions(bodyElement, caseEntry) {
	const actionsElement = document.createElement("div");
	actionsElement.className = "wiki-sync-case__actions";

	if (caseEntry.status === "archived" || caseEntry.status === "deferred") {
		actionsElement.appendChild(createWikiSyncActionButton("reopen", "Wieder öffnen", "wiki-sync-case__action--primary"));
	}

	if (caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status === "open" && isWikiSyncCreateLocationSelectionActive && wikiSyncCreateLocationContextLatLng) {
		actionsElement.appendChild(createWikiSyncActionButton("select-wiki-location", "Diesen Ort wählen", "wiki-sync-case__action--primary"));
	} else if (caseEntry.case_type !== "missing_wiki_with_coordinates") {
		actionsElement.appendChild(createWikiSyncActionButton("focus", "Anzeigen", "wiki-sync-case__action--primary"));
	}

	if (canResolveWikiSyncCase(caseEntry)) {
		const label = caseEntry.case_type === "missing_wiki_without_coordinates" ? "Position wählen" : "Lösen";
		const action = caseEntry.case_type === "missing_wiki_without_coordinates" ? "pick-position" : "resolve";
		actionsElement.appendChild(createWikiSyncActionButton(action, label, "wiki-sync-case__action--primary"));
	}

	actionsElement.appendChild(createWikiSyncActionButton("defer", "Zurückstellen", "wiki-sync-case__action--danger"));
	actionsElement.appendChild(createWikiSyncActionButton("archive", "Archivieren", "wiki-sync-case__action--danger"));
	bodyElement.appendChild(actionsElement);
}

function createWikiSyncActionButton(action, label, className) {
	const buttonElement = document.createElement("button");
	buttonElement.type = "button";
	buttonElement.className = `wiki-sync-case__action ${className}`;
	buttonElement.dataset.wikiSyncAction = action;
	buttonElement.textContent = label;
	return buttonElement;
}

function appendWikiSyncInfoRow(bodyElement, label, value) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const valueElement = document.createElement("span");
	valueElement.className = "wiki-sync-case__row-value";
	valueElement.textContent = value || "-";
	rowElement.append(labelElement, valueElement);
	bodyElement.appendChild(rowElement);
}

function appendWikiSyncLinkRow(bodyElement, label, text, url) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const linkElement = document.createElement("a");
	linkElement.className = "wiki-sync-case__row-value";
	linkElement.href = url || "#";
	linkElement.target = "_blank";
	linkElement.rel = "noopener";
	linkElement.textContent = text || url || "-";
	rowElement.append(labelElement, linkElement);
	bodyElement.appendChild(rowElement);
}

function canResolveWikiSyncCase(caseEntry) {
	if (caseEntry.case_type === "unresolved_without_candidate" || caseEntry.case_type === "duplicate_avesmaps_name") {
		return false;
	}

	return caseEntry.status === "open";
}

function getWikiSyncCaseTitle(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapName = payload.map?.name || "";
	const wikiTitle = payload.wiki?.title || "";

	if (caseEntry.case_type === "missing_wiki_with_coordinates" || caseEntry.case_type === "missing_wiki_without_coordinates") {
		return wikiTitle || "Fehlender Wiki-Ort";
	}

	if (caseEntry.case_type === "duplicate_wiki_title") {
		return wikiTitle || "Mehrfachzuordnung";
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		const duplicateCount = Array.isArray(payload.matches) ? payload.matches.length : 0;
		return `${payload.name || "Unbenannter Ort"} (${duplicateCount} Dubletten)`;
	}

	return mapName && wikiTitle ? `${mapName} ↔ ${wikiTitle}` : mapName || wikiTitle || "WikiSync-Fall";
}

function formatWikiSyncCaseStatus(status) {
	const labels = {
		open: "offen",
		resolved: "gelöst",
		deferred: "zurückgestellt",
		archived: "archiviert",
	};

	return labels[status] || status || "offen";
}

function formatWikiSyncMatchKind(matchKind) {
	const labels = {
		exact: "exakter Titel",
		redirect: "Wiki-Weiterleitung",
		normalized: "normalisierter Titel",
		search: "Wiki-Suche",
	};

	return labels[matchKind] || matchKind || "-";
}

function findWikiSyncCaseFromElement(element) {
	const caseElement = element?.closest?.(".wiki-sync-case");
	const caseId = Number(caseElement?.dataset.caseId);
	return wikiSyncCases.find((caseEntry) => Number(caseEntry.id) === caseId) || null;
}

async function handleWikiSyncCaseActionClick(event) {
	const buttonElement = event.currentTarget;
	const caseEntry = findWikiSyncCaseFromElement(buttonElement);
	if (!caseEntry) {
		return;
	}

	event.preventDefault();
	const action = buttonElement.dataset.wikiSyncAction || "";
	const selectedMap = findWikiSyncMapInCase(caseEntry, buttonElement.dataset.publicId || "");
	const selectedWiki = findWikiSyncCandidateInCase(caseEntry, buttonElement.dataset.candidateIndex);

	if (action === "focus") {
		focusWikiSyncCase(caseEntry, { mapPlace: selectedMap });
		return;
	}

	if (action === "resolve") {
		openWikiSyncResolveDialogForCase(caseEntry, { mapPlace: selectedMap, wikiCandidate: selectedWiki });
		return;
	}

	if (action === "pick-position") {
		startWikiSyncLocationPick(caseEntry);
		return;
	}

	if (action === "select-wiki-location") {
		openWikiSyncCreateLocationDialogFromCase(caseEntry);
		return;
	}

	if (action === "defer") {
		await updateWikiSyncCaseStatus(caseEntry, "defer_case", "Fall zurückgestellt.");
		return;
	}

	if (action === "archive") {
		await updateWikiSyncCaseStatus(caseEntry, "archive_case", "Fall archiviert.");
		return;
	}

	if (action === "reopen") {
		await updateWikiSyncCaseStatus(caseEntry, "reopen_case", "Fall wieder geöffnet.");
	}
}

async function updateWikiSyncCaseStatus(caseEntry, action, successMessage) {
	try {
		await submitWikiSyncLocationAction(action, { case_id: Number(caseEntry.id) });
		showFeedbackToast(successMessage, "success");
		await loadWikiSyncCases();
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht aktualisiert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht aktualisiert werden.", "warning");
	}
}

async function archiveWikiSyncCreatedLocationCase(caseId, feature = null) {
	const numericCaseId = Number(caseId);
	if (!Number.isInteger(numericCaseId) || numericCaseId < 1) {
		return false;
	}

	try {
		const payload = { case_id: numericCaseId };
		if (feature) {
			payload.resolution = { feature };
		}
		await submitWikiSyncLocationAction("archive_case", payload);
		await loadWikiSyncCases();
		return true;
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht archiviert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht archiviert werden.", "warning");
		return false;
	}
}

function findWikiSyncMapInCase(caseEntry, publicId = "") {
	const payload = caseEntry.payload || {};
	if (payload.map && (!publicId || payload.map.public_id === publicId)) {
		return payload.map;
	}

	const resolvedFeature = getWikiSyncResolvedFeature(caseEntry);
	if (resolvedFeature && (!publicId || resolvedFeature.public_id === publicId)) {
		return resolvedFeature;
	}

	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	return matches.find((match) => !publicId || match.public_id === publicId) || null;
}

function findWikiSyncCandidateInCase(caseEntry, indexValue) {
	const candidateIndex = Number(indexValue);
	if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
		return null;
	}

	const candidates = Array.isArray(caseEntry.payload?.candidates) ? caseEntry.payload.candidates : [];
	return candidates[candidateIndex] || null;
}

function focusWikiSyncCase(caseEntry, { mapPlace = null } = {}) {
	const payload = caseEntry.payload || {};
	const selectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	if (selectedMap?.public_id) {
		const markerEntry = findLocationMarkerByPublicId(selectedMap.public_id);
		if (markerEntry) {
			map.flyTo(markerEntry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.8 });
			markerEntry.marker.openPopup();
			return;
		}

		const lat = Number(selectedMap.lat);
		const lng = Number(selectedMap.lng);
		const latlng = Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
		if (latlng && isWithinMapBounds(latlng)) {
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (payload.proposed_location) {
		const latlng = L.latLng(Number(payload.proposed_location.lat), Number(payload.proposed_location.lng));
		if (isWithinMapBounds(latlng)) {
			showWikiSyncPreviewMarker(caseEntry, latlng);
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (caseEntry.case_type === "missing_wiki_with_coordinates") {
		return;
	}

	showFeedbackToast("Dieser WikiSync-Fall hat keine Kartenposition.", "warning");
}

function clearWikiSyncPreviewMarker() {
	if (!wikiSyncPreviewMarker) {
		return;
	}

	map.removeLayer(wikiSyncPreviewMarker);
	wikiSyncPreviewMarker = null;
}

function showWikiSyncPreviewMarker(caseEntry, latlng) {
	clearWikiSyncPreviewMarker();
	const wikiPage = caseEntry.payload?.wiki || {};
	wikiSyncPreviewMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 13,
		color: "#6a4c9c",
		weight: 4,
		fillColor: "#ffffff",
		fillOpacity: 0.96,
	}).addTo(map);
	wikiSyncPreviewMarker.bindTooltip(wikiPage.title || "WikiSync", {
		permanent: true,
		direction: "top",
		className: "wiki-sync-preview-tooltip",
		offset: [0, -12],
	}).openTooltip();
}

function startWikiSyncLocationPick(caseEntry) {
	pendingWikiSyncLocationPickCase = caseEntry;
	map.off("click", handleWikiSyncLocationPick);
	map.once("click", handleWikiSyncLocationPick);
	setWikiSyncStatus("Klick zur Erstellung auf die Karte.", "pending");
	showFeedbackToast("Klick zur Erstellung auf die Karte.", "info");
}

function handleWikiSyncLocationPick(event) {
	const caseEntry = pendingWikiSyncLocationPickCase;
	pendingWikiSyncLocationPickCase = null;
	if (!caseEntry) {
		return;
	}

	const latlng = L.latLng(event.latlng);
	if (!isWithinMapBounds(latlng)) {
		showFeedbackToast("Diese Position liegt ausserhalb der Karte.", "warning");
		return;
	}

	showWikiSyncPreviewMarker(caseEntry, latlng);
	openWikiSyncResolveDialogForCase(caseEntry, { latlng });
}

function openWikiSyncResolveDialogForCase(caseEntry, { mapPlace = null, wikiCandidate = null, latlng = null } = {}) {
	resetWikiSyncResolveForm();
	activeWikiSyncCase = caseEntry;
	activeWikiSyncSelectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	activeWikiSyncSelectedWiki = wikiCandidate || caseEntry.payload?.wiki || null;
	if (!activeWikiSyncSelectedWiki && Array.isArray(caseEntry.payload?.candidates) && caseEntry.payload.candidates.length > 0) {
		activeWikiSyncSelectedWiki = caseEntry.payload.candidates[0];
	}

	const presets = buildWikiSyncResolvePresets(caseEntry, { mapPlace: activeWikiSyncSelectedMap, wikiPage: activeWikiSyncSelectedWiki, latlng });
	activeWikiSyncPreset = presets;
	document.getElementById("wiki-sync-resolve-case-id").value = String(caseEntry.id || "");
	document.getElementById("wiki-sync-resolve-public-id").value = activeWikiSyncSelectedMap?.public_id || "";
	document.getElementById("wiki-sync-resolve-expected-revision").value = activeWikiSyncSelectedMap?.revision || "";
	document.getElementById("wiki-sync-resolve-lat").value = presets.wiki.lat === null ? "" : Number(presets.wiki.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = presets.wiki.lng === null ? "" : Number(presets.wiki.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = presets.wiki.lat === null || presets.wiki.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(presets.wiki.lat, presets.wiki.lng));
	void acquireFeatureSoftLock(activeWikiSyncSelectedMap?.public_id || "");

	applyWikiSyncResolvePreset("wiki");
	setWikiSyncResolveDialogOpen(true);
}

function buildWikiSyncResolvePresets(caseEntry, { mapPlace = null, wikiPage = null, latlng = null } = {}) {
	const payload = caseEntry.payload || {};
	const mapLatLng = normalizeWikiSyncLatLng(mapPlace ? { lat: mapPlace.lat, lng: mapPlace.lng } : null);
	const proposedLocation = latlng || payload.proposed_location || mapLatLng || null;
	const currentLatLng = normalizeWikiSyncLatLng(mapLatLng || proposedLocation);
	const wikiLatLng = normalizeWikiSyncLatLng(proposedLocation || mapLatLng);
	const mapSubtype = normalizeLocationType(mapPlace?.settlement_class || "dorf");
	const wikiSubtype = normalizeLocationType(wikiPage?.settlement_class || mapSubtype);
	const currentWikiUrl = mapPlace?.wiki_url || wikiPage?.url || "";
	const currentName = mapPlace?.name || wikiPage?.title || "";

	return {
		avesmap: {
			name: currentName,
			feature_subtype: mapSubtype,
			description: mapPlace?.description || "",
			wiki_url: currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: currentLatLng?.lat ?? null,
			lng: currentLatLng?.lng ?? null,
		},
		wiki: {
			name: wikiPage?.title || currentName,
			feature_subtype: wikiSubtype,
			description: mapPlace?.description || "",
			wiki_url: wikiPage?.url || currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: wikiLatLng?.lat ?? null,
			lng: wikiLatLng?.lng ?? null,
		},
	};
}

function normalizeWikiSyncLatLng(value) {
	if (!value) {
		return null;
	}

	const lat = Number(value.lat);
	const lng = Number(value.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	return L.latLng(lat, lng);
}

function applyWikiSyncResolvePreset(kind) {
	if (!activeWikiSyncPreset) {
		return;
	}

	const preset = activeWikiSyncPreset[kind] || activeWikiSyncPreset.wiki;
	document.getElementById("wiki-sync-resolve-name").value = preset.name || "";
	document.getElementById("wiki-sync-resolve-type").value = normalizeLocationType(preset.feature_subtype || "dorf");
	document.getElementById("wiki-sync-resolve-description").value = preset.description || "";
	document.getElementById("wiki-sync-resolve-wiki-url").value = preset.wiki_url || "";
	document.getElementById("wiki-sync-resolve-is-nodix").checked = Boolean(preset.is_nodix);
	document.getElementById("wiki-sync-resolve-is-ruined").checked = Boolean(preset.is_ruined);
	document.getElementById("wiki-sync-resolve-lat").value = preset.lat === null ? "" : Number(preset.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = preset.lng === null ? "" : Number(preset.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = preset.lat === null || preset.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(preset.lat, preset.lng));
	syncWikiSyncResolveLinkButton();

	document.getElementById("wiki-sync-preset-wiki")?.classList.toggle("is-active", kind === "wiki");
	document.getElementById("wiki-sync-preset-avesmap")?.classList.toggle("is-active", kind === "avesmap");
}

function syncWikiSyncResolveLinkButton() {
	const inputElement = document.getElementById("wiki-sync-resolve-wiki-url");
	const buttonElement = document.getElementById("wiki-sync-resolve-wiki-open");
	if (!(buttonElement instanceof HTMLButtonElement)) {
		return;
	}

	const urlValue = String(inputElement?.value || "").trim();
	buttonElement.disabled = urlValue === "";
	buttonElement.title = urlValue === "" ? "Kein Wiki-Link vorhanden" : "Wiki-Link in neuem Fenster öffnen";
	buttonElement.setAttribute("aria-label", buttonElement.title);
}

function openWikiSyncResolveWikiLink() {
	const urlValue = String(document.getElementById("wiki-sync-resolve-wiki-url")?.value || "").trim();
	if (urlValue === "") {
		showFeedbackToast("Kein Wiki-Link vorhanden.", "warning");
		return;
	}

	try {
		const parsedUrl = new URL(urlValue);
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error("Ungültiges Protokoll");
		}

		window.open(parsedUrl.href, "_blank", "noopener,noreferrer");
	} catch (error) {
		showFeedbackToast("Der Wiki-Link ist ungültig.", "warning");
	}
}

async function handleWikiSyncResolveFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const formData = new FormData(formElement);
	const payload = {
		case_id: Number(formData.get("case_id")),
		public_id: String(formData.get("public_id") || "").trim(),
		expected_revision: String(formData.get("expected_revision") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "dorf").trim(),
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		is_nodix: formData.get("is_nodix") === "on",
		is_ruined: formData.get("is_ruined") === "on",
		lat: Number.parseFloat(String(formData.get("lat") || "")),
		lng: Number.parseFloat(String(formData.get("lng") || "")),
	};

	if (!payload.public_id && (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !isWithinMapBounds(L.latLng(payload.lat, payload.lng)))) {
		setWikiSyncResolveStatus("Für eine Neuanlage fehlt eine gültige Position.", "error");
		return;
	}

	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: activeWikiSyncSelectedMap?.name || "",
	});
	if (duplicateLocation) {
		setWikiSyncResolveStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}

	setWikiSyncResolveSubmitPending(true);
	setWikiSyncResolveStatus("WikiSync-Fall wird gespeichert...", "pending");
	try {
		const result = await submitWikiSyncLocationAction("resolve_case", payload);
		if (result.feature) {
			const markerEntry = findLocationMarkerByPublicId(result.feature.public_id);
			if (markerEntry) {
				applyFeatureResponseToMarker(markerEntry, result.feature);
			} else {
				addCreatedLocationMarker(result.feature);
			}
			updateRevisionFromEditResponse(result);
		}

		clearWikiSyncPreviewMarker();
		void loadChangeLog();
		setWikiSyncResolveSubmitPending(false);
		setWikiSyncResolveDialogOpen(false, { resetForm: true });
		await loadWikiSyncCases();
		showFeedbackToast("WikiSync-Fall gelöst.", "success");
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht gelöst werden:", error);
		setWikiSyncResolveStatus(error.message || "WikiSync-Fall konnte nicht gelöst werden.", "error");
	} finally {
		setWikiSyncResolveSubmitPending(false);
	}
}
