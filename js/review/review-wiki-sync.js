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
		buttonElement.textContent = isRunning ? "Synchronisiert..." : "🚨 WikiSync";
	}

	const progressElement = document.getElementById("wiki-sync-progress");
	if (progressElement) {
		progressElement.hidden = !isRunning;

		if (isRunning) {
			// Der Run liefert progress_current/progress_total (siehe avesmapsWikiSyncPublicRun).
			const completedSteps = Number(run?.progress_current ?? run?.completed_steps ?? run?.step ?? 0);
			const totalSteps = Number(run?.progress_total ?? run?.total_steps ?? progressElement.max ?? 5);

			progressElement.max = Number.isFinite(totalSteps) && totalSteps > 0 ? totalSteps : 5;
			progressElement.value = Number.isFinite(completedSteps) && completedSteps >= 0 ? Math.min(completedSteps, progressElement.max) : 0;
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
		buttonElement.textContent = isRunning ? "Synchronisiert..." : "WikiSync & Editor";
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

	if (activeWikiSyncPanelTab === "regions") {
		return typeof loadRegionWikiSync === "function" ? loadRegionWikiSync() : undefined;
	}

	if (activeWikiSyncPanelTab === "paths") {
		return typeof loadPathWikiSync === "function" ? loadPathWikiSync() : undefined;
	}

	if (typeof loadSettlementList === "function") {
		loadSettlementList();
	}
	return loadWikiSyncCases();
}

function setWikiSyncPanelTab(tabName) {
	activeWikiSyncPanelTab = ["territories", "regions", "paths"].includes(tabName) ? tabName : "locations";

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
	} else if (activeWikiSyncPanelTab === "regions") {
		if (typeof loadRegionWikiSync === "function") {
			void loadRegionWikiSync();
		}
	} else if (activeWikiSyncPanelTab === "paths") {
		if (typeof loadPathWikiSync === "function") {
			void loadPathWikiSync();
		}
	} else {
		renderWikiSyncCases();
		if (typeof loadSettlementList === "function") {
			loadSettlementList();
		}
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

// Karten-Status-Filter (Alle/Platziert/Fehlt) — gleiches Toggle-Design wie Siedlungen.
function setWikiSyncTerritoryMapStatus(value) {
	const next = value === "placed" || value === "missing" ? value : "all";
	if (next === wikiSyncTerritoryMapStatus) {
		return;
	}
	wikiSyncTerritoryMapStatus = next;
	void renderWikiSyncTerritoryTree();
}

function renderWikiSyncTerritoryMapStatusTabs(total, placed, missing) {
	const host = document.getElementById("wiki-sync-territory-tabs");
	if (!host) {
		return;
	}
	const tab = (view, label, count) =>
		`<button type="button" data-territory-mapstatus="${view}" class="region-sync__viewtab${wikiSyncTerritoryMapStatus === view ? " is-active" : ""}">${label} (${count})</button>`;
	host.innerHTML = tab("all", "Alle", total) + tab("placed", "Platziert", placed) + tab("missing", "Fehlt", missing);
}

// Liest den Zeitfilter (von/bis/heute) aus den DOM-Eingaben via geteilter Baumkomponente.
function getWikiSyncTerritoryTimeFilter() {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	if (!treeModule || typeof treeModule.readTimeFilter !== "function") {
		return { mode: "off" };
	}
	return treeModule.readTimeFilter(
		document.getElementById("wiki-sync-territory-time-from"),
		document.getElementById("wiki-sync-territory-time-to"),
		document.getElementById("wiki-sync-territory-time-today")
	);
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
		// Modell-Hierarchie aus dem Sync-Monitor (parent_wiki_key -> affiliation_path) statt der
		// alten flachen Wiki-Affiliation. Re-Parenting passiert NUR im Sync-Monitor (read-only hier).
		apiUrl: "/api/edit/wiki/sync-monitor.php?action=model_tree",
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
		const search = getWikiSyncTerritoryFilterQuery();
		const time = getWikiSyncTerritoryTimeFilter();
		// Basismenge (Such-/Zeitfilter, ohne Karten-Status) — Grundlage für die Tab-Zähler.
		const baseRows = treeModule
			.filterRows(rows, { search, time })
			.filter((row) => row && row.continent === "Aventurien");
		const isPlaced =
			typeof treeModule.isRowAssignedToMap === "function"
				? treeModule.isRowAssignedToMap
				: (row) => Boolean(row && row.map_assigned) || Number((row && row.map_geometry_count) || 0) > 0;
		let placedCount = 0;
		for (const row of baseRows) {
			if (isPlaced(row)) {
				placedCount += 1;
			}
		}
		renderWikiSyncTerritoryMapStatusTabs(baseRows.length, placedCount, baseRows.length - placedCount);
		// Anzuzeigende Menge nach Karten-Status; Vorfahren bleiben dank filterRows erhalten.
		const filteredRows =
			wikiSyncTerritoryMapStatus === "placed" || wikiSyncTerritoryMapStatus === "missing"
				? treeModule
						.filterRows(rows, { search, time, mapStatus: wikiSyncTerritoryMapStatus })
						.filter((row) => row && row.continent === "Aventurien")
				: baseRows;
		const treeResult = treeModule.buildTree(filteredRows);
		// Summary identisch zum Sync-Monitor: alle Knoten gesamt, sichtbare Wurzeln (Aventurien+heute = 53).
		wikiSyncTerritorySummary = {
			territory_count: Array.isArray(rows) ? rows.length : 0,
			root_count: Array.isArray(treeResult?.root?.children) ? treeResult.root.children.length : 0,
		};

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

		// Option A: Bauwerke (alle Typen aus „Bauwerk nach Art") gleich mitcrawlen, damit ein
		// WikiSync-Klick Siedlungen UND Bauwerke abdeckt. Optional — Fehler hier brechen den
		// (erfolgreichen) Siedlungs-Sync nicht ab.
		let buildingNote = "";
		const buildingProgress = document.getElementById("wiki-sync-progress");
		try {
			setWikiSyncStatus("Bauwerke werden gecrawlt …", "pending");
			if (buildingProgress) {
				buildingProgress.hidden = false;
				buildingProgress.removeAttribute("value"); // indeterminate (kein bekanntes Total)
			}
			const buildingResponse = await fetch("/api/edit/wiki/settlements.php", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "crawl_buildings" }),
			});
			const buildingData = await buildingResponse.json();
			if (buildingData && buildingData.ok) {
				buildingNote = ` (+${buildingData.titles_seen || 0} Bauwerke)`;
			}
			if (typeof loadSettlementList === "function") {
				loadSettlementList();
			}
		} catch (buildingError) {
			console.warn("Bauwerks-Crawl im WikiSync übersprungen:", buildingError);
		} finally {
			if (buildingProgress) {
				buildingProgress.hidden = true;
				buildingProgress.value = 0;
			}
		}

		setWikiSyncStatus(buildWikiSyncStatusMessage("WikiSyncLocations abgeschlossen." + buildingNote), "success");
	} catch (error) {
		console.error("WikiSyncLocations konnte nicht ausgeführt werden:", error);
		activeWikiSyncRunStatus = "";
		setWikiSyncLocationsRunning(false);
		setWikiSyncStatus(error.message || "WikiSyncLocations konnte nicht ausgeführt werden.", "error");
		showFeedbackToast(error.message || "WikiSyncLocations konnte nicht ausgeführt werden.", "warning");
	}
}

// Inline-Dialog (statt neuem Fenster) für den Sync-Editor — im Stil des Herrschaftsgebiet-
// Eigenschaften-Editors (gleiche CSS-Klassen), nur etwas breiter für die zwei Spalten.
window.openAvesmapsSyncEditorOverlay = window.openAvesmapsSyncEditorOverlay || function openAvesmapsSyncEditorOverlay(wikiKey) {
	const overlayId = "avesmaps-sync-editor-overlay";
	// Cache-Buster: das Tool-HTML laedt sonst gecacht (kein ?v=) -> immer frisch holen.
	// Optionaler Deep-Link ?key=wiki:xxx (z. B. aus dem Territoriumseditor) selektiert den Knoten.
	const buildSyncEditorSrc = () => "/html/wiki-sync-monitor.html?v=" + Date.now()
		+ (wikiKey ? "&key=" + encodeURIComponent(wikiKey) : "");
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		if (wikiKey) {
			const existingFrame = overlay.querySelector("iframe");
			if (existingFrame) existingFrame.src = buildSyncEditorSrc();
		}
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "political-territory-editor-overlay";
	overlay.style.zIndex = "1500";
	const dialog = document.createElement("div");
	dialog.className = "political-territory-editor-dialog";
	dialog.style.width = "min(1200px, calc(100vw - 24px))";
	dialog.style.height = "min(880px, calc(100vh - 24px))";
	const header = document.createElement("div");
	header.className = "political-territory-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Herrschaftsgebiete synchronisieren und editieren";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "political-territory-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	// Nach dem Schließen des Sync-Editors die abhängigen Oberflaechen sofort auffrischen, damit
	// WikiSync-Änderungen gleich im Territoriumseditor + Review-Tree erscheinen (kein manuelles Reload).
	const closeOverlay = () => {
		overlay.hidden = true;
		document.body.style.overflow = "";
		try {
			if (typeof renderWikiSyncTerritoryTree === "function") {
				void renderWikiSyncTerritoryTree({ forceReload: true });
			}
		} catch (refreshError) { /* Review-Tree-Refresh ist optional. */ }
		try {
			const editorReload = document.getElementById("reloadButton");
			if (editorReload) editorReload.click();
		} catch (editorError) { /* Editor evtl. nicht offen. */ }
	};
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "political-territory-editor-dialog__frame";
	frame.src = buildSyncEditorSrc();
	frame.title = "Sync-Editor";
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

async function startWikiSyncTerritoryRun() {
	// Alter sync_territories-Pfad stillgelegt: der Button öffnet jetzt den Sync-Editor
	// (Crawl → Staging → Modell, Diff, Drag'n'drop). Promotion ist dort ein bewusster Schritt.
	openAvesmapsSyncEditorOverlay();
	return;
	// eslint-disable-next-line no-unreachable
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
		console.error("WikiSyncTerritories konnte nicht ausgeführt werden:", error);
		setWikiSyncStatus(error.message || "WikiSyncTerritories konnte nicht ausgeführt werden.", "error");
		showFeedbackToast(error.message || "WikiSyncTerritories konnte nicht ausgeführt werden.", "warning");
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
		locationsButtonElement.textContent = isWikiSyncLocationsRunning ? "Synchronisiert..." : "🚨 WikiSync";
	}

	if (territoriesButtonElement) {
		territoriesButtonElement.textContent = isWikiSyncTerritoriesRunning ? "Synchronisiert..." : "WikiSync & Editor";
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
		return `${syncedTerritoryCount} Knoten · ${syncedRootCount} Wurzelknoten`;
	}

	const fallbackSummary = getWikiSyncTerritoryLoadedDataSummary();
	if (fallbackSummary.territoryCount < 1 && fallbackSummary.rootCount < 1) {
		return "Keine Herrschaftsgebietsdaten geladen";
	}

	return `${fallbackSummary.territoryCount} Knoten · ${fallbackSummary.rootCount} Wurzelknoten`;
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

// (WikiSync case-list rendering moved to review-wiki-sync-cases.js - M5 split.)

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

// Ziehbarer Trenner am unteren Rand des Konfliktloesung-Accordions: sichtbarer Balken
// (.wiki-sync-accordion__resizer) statt der unscheinbaren CSS-resize-Ecke. Setzt die
// Accordion-Hoehe per Drag; die Fall-Liste fuellt die Hoehe und scrollt intern.
(function initWikiSyncAccordionResizer() {
	let drag = null;
	const MIN_HEIGHT = 0;
	const maxHeight = () => Math.round(window.innerHeight * 0.8);

	document.addEventListener("pointerdown", (event) => {
		const handle = event.target instanceof Element ? event.target.closest(".wiki-sync-accordion__resizer") : null;
		if (!handle) {
			return;
		}
		const accordion = handle.closest(".wiki-sync-accordion");
		const list = accordion ? accordion.querySelector("#wiki-sync-case-list") : null;
		if (!list) {
			return;
		}
		event.preventDefault();
		drag = { list, startY: event.clientY, startHeight: list.getBoundingClientRect().height };
		try { handle.setPointerCapture(event.pointerId); } catch (error) { /* egal */ }
		document.body.style.userSelect = "none";
	});

	document.addEventListener("pointermove", (event) => {
		if (!drag) {
			return;
		}
		// Robustheit: ist die Maustaste nicht (mehr) gedrueckt (verpasstes pointerup), Drag beenden -
		// sonst "klebt" der Drag und spaetere Mausbewegungen wuerden die Hoehe weiter veraendern.
		if (!(event.buttons & 1)) {
			endDrag();
			return;
		}
		const next = drag.startHeight + (event.clientY - drag.startY);
		drag.list.style.height = Math.max(MIN_HEIGHT, Math.min(maxHeight(), next)) + "px";
	});

	const endDrag = () => {
		if (!drag) {
			return;
		}
		drag = null;
		document.body.style.userSelect = "";
	};
	document.addEventListener("pointerup", endDrag);
	document.addEventListener("pointercancel", endDrag);
})();
