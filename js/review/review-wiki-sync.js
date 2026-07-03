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

	// Best-effort, independent of the case list below (own try/catch inside) -- shows
	// "Dump geholt: <date>" next to the "Dump holen" button as soon as this tab loads.
	void refreshWikiSyncDumpFetchedStatus();

	setWikiSyncStatus("WikiSyncLocations-Fälle werden geladen...", "pending");
	try {
		const data = await fetchWikiSyncLocationData({ action: "cases" });

		wikiSyncCases = Array.isArray(data.cases) ? data.cases : [];
		// Merge in the computed missing-capital conflict cases (political domain, source "political"). They flow
		// through the same grouping/status/render pipeline as the wiki cases. A capital-load failure yields []
		// (never breaks the wiki list), so this await is safe.
		if (typeof loadMissingCapitalCases === "function") {
			const capitalCases = await loadMissingCapitalCases();
			if (Array.isArray(capitalCases) && capitalCases.length > 0) {
				wikiSyncCases = wikiSyncCases.concat(capitalCases);
			}
		}
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

// Nach einer Zuweisung/Drag-Drop den AKTIVEN WikiSync-Tab frisch laden, damit der gruene Punkt (= es gibt
// eine Zuweisung) sofort stimmt -- OHNE Seiten-Reload. Filter bleiben erhalten (die Lade-Funktionen
// loadRegionWikiSync/loadSettlementList/loadPathWikiSync behalten ihren Modul-internen Filter-State). Der
// Territorien-Baum cached seine Zeilen, daher hier ein erzwungener Re-Fetch (sonst bleibt der Status stale).
async function refreshActiveWikiSyncPanelAfterAssignment() {
	if (activeWikiSyncPanelTab === "territories" && typeof loadWikiSyncTerritoryTreeRows === "function") {
		try {
			await loadWikiSyncTerritoryTreeRows({ forceReload: true });
		} catch (error) {
			/* Fetch fehlgeschlagen -> trotzdem rendern (zeigt dann den letzten bekannten Stand). */
		}
	}
	try {
		return await refreshActiveWikiSyncPanel();
	} catch (error) {
		return undefined;
	}
}
window.refreshActiveWikiSyncPanelAfterAssignment = refreshActiveWikiSyncPanelAfterAssignment;

// Speichern im Herrschaftsgebiet-Editor laeuft ueber eine eigene Save-Pipeline (nicht die Review-Submits),
// daher dort per afterSaveHook anhaengen -> nach dem Speichern den Territorien-Tab auffrischen. Die Pipeline
// wird erst beim ersten Editor-Oeffnen dynamisch geladen, daher kurz pollen (nur im Edit-Modus).
(function registerWikiSyncTerritoryEditorRefreshHook() {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	let attempts = 0;
	function tryRegister() {
		const pipeline = window.AvesmapsPoliticalTerritoryEditorSave;
		if (pipeline && typeof pipeline.registerAfterSaveHook === "function") {
			pipeline.registerAfterSaveHook(async (context) => {
				try {
					await refreshActiveWikiSyncPanelAfterAssignment();
				} catch (error) {
					/* Refresh ist best-effort; das Save-Result bleibt massgeblich. */
				}
				return context.result;
			});
			return;
		}
		if (++attempts <= 60) {
			setTimeout(tryRegister, 500);
		}
	}
	tryRegister();
})();

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

// ===========================================================================
// WikiDump hybrid read (H4c-f): "Dump holen" chains THREE steps as one
// user-visible operation: (1) fetch_dump -- re-download the dump file from the
// wiki; (2) start_read + read_step loop -- the sandbox-safe scan (dryRun,
// writes only wiki_dump_hybrid_state/wiki_dump_title_alias); (3) cleanup_state
// -- once the scan succeeds, delete every OTHER dump_read run's sandbox rows
// so exactly one dump's state remains ("immer genau ein Dump drin"). The
// per-tab "Syncen" buttons (below) then take the freshly-read dump into each
// kind's staging tables -- the old standalone "Übernehmen" button and the
// per-kind online WikiSync crawlers were retired once Syncen covered their
// job. The read loop is one-POST-per-step (never a server-side loop --
// STRATO). Backend: api/edit/wiki/dump.php.
// ===========================================================================

let isWikiSyncDumpRunning = false;
let lastWikiSyncDumpCredentialsUsername = "";
let wikiSyncDumpCredentialsResolver = null;

// Human-readable German labels for the 6 work phases (dump-hybrid-driver.php phase constants).
const WIKI_SYNC_DUMP_PHASE_LABELS = {
	online_class_map: "Online-Klassen-Karte",
	online_building_map: "Online-Bauwerks-Karte",
	online_continent_map: "Online-Kontinent-Karte",
	redirect_aliases: "Weiterleitungen",
	wikitext_collect: "Wikitext sammeln",
	parse_and_upsert: "Parsen und schreiben",
	completed: "Abgeschlossen",
};

function setWikiSyncDumpButtonsDisabled(isDisabled, label = "📥 Dump holen") {
	const readButton = document.getElementById("wiki-sync-dump-read");
	if (readButton) {
		readButton.disabled = isDisabled;
		readButton.textContent = isWikiSyncDumpRunning ? label : "📥 Dump holen";
	}
}

// Format the "Dump geholt: <date>" status line next to the button, from the
// GET ?action=status shape (present/size/age_seconds/last_fetch_at/last_ok_at).
// last_ok_at is the DB-tracked timestamp of the last SUCCESSFUL fetch_dump call --
// preferred over the raw file mtime because it is what the backend already exposes
// and reflects "last time we successfully talked to the wiki", not just disk state.
function formatWikiSyncDumpFetchedStatusText(status) {
	const lastOkAt = status && typeof status.last_ok_at === "string" ? status.last_ok_at : "";
	if (!lastOkAt) {
		return status && status.present ? "Dump geholt: unbekannt" : "Noch kein Dump geholt";
	}
	// last_ok_at is a MySQL DATETIME string ("YYYY-MM-DD HH:MM:SS.mmm"); make it
	// Safari/iOS-Date-parseable by swapping the space for "T" (same trick used
	// elsewhere in this codebase for MySQL timestamp strings).
	const parsed = new Date(lastOkAt.replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) {
		return `Dump geholt: ${lastOkAt}`;
	}
	const formatted = parsed.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
	return `Dump geholt: ${formatted}`;
}

// Load + render the fetched-status line. Best-effort: a failed status fetch just
// hides the line again (never blocks the panel or throws into a caller).
async function refreshWikiSyncDumpFetchedStatus() {
	const statusElement = document.getElementById("wiki-sync-dump-fetched-status");
	if (!statusElement) {
		return;
	}
	try {
		const status = await fetchWikiSyncDumpStatus();
		statusElement.textContent = formatWikiSyncDumpFetchedStatusText(status);
		statusElement.hidden = false;
	} catch (error) {
		console.warn("WikiDump-Status konnte nicht geladen werden:", error);
		statusElement.hidden = true;
	}
}

function renderWikiSyncDumpProgress(progress, done) {
	const progressElement = document.getElementById("wiki-sync-dump-progress");
	const statusElement = document.getElementById("wiki-sync-dump-status");

	const current = Number(progress?.progress_current ?? 0);
	const total = Number(progress?.progress_total ?? 6);
	if (progressElement) {
		progressElement.hidden = false;
		progressElement.max = Number.isFinite(total) && total > 0 ? total : 6;
		progressElement.value = Number.isFinite(current) && current >= 0 ? Math.min(current, progressElement.max) : 0;
	}

	if (statusElement) {
		const phaseKey = String(progress?.phase ?? "");
		const phaseLabel = WIKI_SYNC_DUMP_PHASE_LABELS[phaseKey] || phaseKey || "…";
		// Surface whichever per-step counter the current phase returned (dump-hybrid-driver.php envelope).
		const counters = [];
		if (progress && Number(progress.pages_scanned) > 0) counters.push(`${Number(progress.pages_scanned)} Seiten`);
		if (progress && Number(progress.found_this_step) > 0) counters.push(`${Number(progress.found_this_step)} gefunden`);
		if (progress && Number(progress.title_aliases_written) > 0) counters.push(`${Number(progress.title_aliases_written)} Aliase`);
		if (progress && Number(progress.processed_this_step) > 0) counters.push(`${Number(progress.processed_this_step)} verarbeitet`);
		if (progress && Number(progress.kept) > 0) counters.push(`${Number(progress.kept)} übernommen`);
		const counterText = counters.length > 0 ? ` (${counters.join(", ")})` : "";
		const prefix = done ? "Fertig" : `Phase ${Math.min(current + (done ? 0 : 1), total)}/${total}`;
		statusElement.hidden = false;
		statusElement.textContent = `${prefix}: ${phaseLabel}${counterText}`;
	}
}

// Drive one dump pass to completion: create the run (unless resuming a passed-in one),
// then loop the advance action once per step until the response says done. `action` is
// "read_step" (sandbox) or "apply" (sharp). Returns the final run on success. On a 401
// (dump_unauthorized) it opens the inline cred-prompt, awaits new credentials, and resumes.
async function runWikiSyncDumpLoop(action, { runId = null } = {}) {
	let activeRunId = runId;
	if (!activeRunId) {
		const startResult = await submitWikiSyncDumpAction("start_read");
		activeRunId = startResult.run?.public_id || null;
	}
	if (!activeRunId) {
		throw new Error("Der WikiDump-Lauf konnte nicht gestartet werden.");
	}

	let done = false;
	let safetyCounter = 0;
	let lastRun = null;
	// The hybrid read can take many bounded steps (wikitext_collect re-walks the dump per
	// step); allow a generous ceiling but still bound it so a backend bug can't spin forever.
	const MAX_STEPS = 2000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("WikiDump-Lauf nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction(action, { run_id: activeRunId });
		} catch (error) {
			if (error && error.dumpUnauthorized) {
				// O1: the dump server rejected the stored creds. Prompt inline, store the
				// last-working pair via set_dump_credentials, then retry the SAME step.
				setWikiSyncStatus("Dump-Zugangsdaten werden benötigt …", "pending");
				const accepted = await openWikiSyncDumpCredentialsPrompt();
				if (!accepted) {
					throw new Error("WikiDump-Lauf abgebrochen: keine Zugangsdaten eingegeben.");
				}
				continue; // credentials stored -> re-issue the step that 401'd
			}
			if (error && error.dumpLocked) {
				// Single-flight lock: ANOTHER editor holds the whole dump pipeline. STOP
				// the loop immediately (do NOT retry -- that would spin up to 2000x). The
				// server sent the German busy message; surface it and rethrow so the outer
				// handler ends the run cleanly. The other user's run is unaffected.
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			throw error;
		}

		lastRun = stepResult.run || lastRun;
		done = stepResult.done === true || (stepResult.run?.status === "completed");
		renderWikiSyncDumpProgress(stepResult.progress, done);
		setWikiSyncStatus(stepResult.run?.message || (action === "apply" ? "Übernahme läuft …" : "WikiDump wird gelesen …"), "pending");
	}

	return lastRun;
}

// "Dump holen": ONE user-visible operation chaining three backend steps in strict
// sequence -- each step only runs if the previous one succeeded:
//   1. fetch_dump   -- re-download the dump file from the wiki (server-fetch).
//   2. start_read + read_step loop -- the sandbox-safe scan (dryRun=true the whole
//      way; writes ONLY wiki_dump_hybrid_state/wiki_dump_title_alias).
//   3. cleanup_state -- ONLY after a successful scan: delete every OTHER dump_read
//      run's sandbox rows so exactly one dump's state remains.
// If fetch fails, the scan never runs. If the scan fails, cleanup never runs (so a
// failed/partial run's rows stay around rather than silently vanishing, and the
// previous good run -- if any -- is untouched since it is still "the newest
// completed run" until a NEW run completes).
async function startWikiSyncDumpRead() {
	if (isWikiSyncDumpRunning) {
		return;
	}
	isWikiSyncDumpRunning = true;

	try {
		// Step 1/3: server-fetch (re-download from the wiki).
		setWikiSyncDumpButtonsDisabled(true, "Lädt Dump herunter...");
		setWikiSyncStatus("Dump wird vom Wiki heruntergeladen …", "pending");
		await submitWikiSyncDumpAction("fetch_dump");

		// Step 2/3: the sandbox-safe scan loop (dryRun=true throughout).
		setWikiSyncDumpButtonsDisabled(true, "Liest Dump...");
		setWikiSyncStatus("WikiDump wird gelesen (Sandbox) …", "pending");
		await runWikiSyncDumpLoop("read_step");

		// Step 3/3: prune old sandbox state now that this scan succeeded. A cleanup
		// failure is reported but does NOT roll back the scan that already completed
		// (the scan's own success is real and independent of housekeeping).
		setWikiSyncDumpButtonsDisabled(true, "Räumt alte Dump-Stände auf...");
		setWikiSyncStatus("Alte Dump-Stände werden aufgeräumt …", "pending");
		await submitWikiSyncDumpAction("cleanup_state");

		setWikiSyncStatus("Dump geholt (Sandbox). Die einzelnen Tabs koennen jetzt per Syncen uebernommen werden.", "success");
		showFeedbackToast("Dump geholt: heruntergeladen, gelesen (Sandbox) und aufgeräumt.", "success");
		isWikiSyncDumpRunning = false;
		setWikiSyncDumpButtonsDisabled(false);
		await refreshWikiSyncDumpFetchedStatus();
	} catch (error) {
		console.error("Dump holen fehlgeschlagen:", error);
		isWikiSyncDumpRunning = false;
		setWikiSyncDumpButtonsDisabled(false);
		setWikiSyncStatus(error.message || "Dump holen fehlgeschlagen.", "error");
		showFeedbackToast(error.message || "Dump holen fehlgeschlagen.", "warning");
	}
}

// ===========================================================================
// Per-kind "Syncen" (Wave 2): each of the 4 tabs (settlement/path/region/
// territory) has a "🚨 Syncen" button that drives the backend `sync_kind` action
// for THAT kind via the SAME one-POST-per-step client loop the dump read uses
// (runWikiSyncDumpLoop pattern). It re-reads the newest completed dump into the
// matching STAGING table (never map_features / live political_territory). The
// per-tab progress bar + a "Zuletzt gesynct: <date>" line come from the sync
// response's `run` (completed_at, falling back to updated_at).
// ===========================================================================

// Static per-kind DOM wiring: button + progress + status ids, and the tab's kind.
const WIKI_SYNC_KIND_ELEMENTS = {
	settlement: { button: "wiki-sync-sync-settlement", progress: "wiki-sync-sync-settlement-progress", status: "wiki-sync-sync-settlement-status" },
	path: { button: "wiki-sync-sync-path", progress: "wiki-sync-sync-path-progress", status: "wiki-sync-sync-path-status" },
	region: { button: "wiki-sync-sync-region", progress: "wiki-sync-sync-region-progress", status: "wiki-sync-sync-region-status" },
	territory: { button: "wiki-sync-sync-territory", progress: "wiki-sync-sync-territory-progress", status: "wiki-sync-sync-territory-status" },
};

// Only one kind syncs at a time (they share the single-flight dump pipeline lock
// server-side; a second would 409). This guards the frontend from starting two.
let isWikiSyncKindSyncRunning = false;

function setWikiSyncKindButtonsDisabled(isDisabled, activeKind = null) {
	Object.entries(WIKI_SYNC_KIND_ELEMENTS).forEach(([kind, ids]) => {
		const button = document.getElementById(ids.button);
		if (button) {
			button.disabled = isDisabled;
			button.textContent = isDisabled && kind === activeKind ? "Synchronisiert..." : "🚨 Syncen";
		}
	});
}

// "Zuletzt gesynct: <date>" from a run row (completed_at preferred, else updated_at).
// Reuses the MySQL-DATETIME -> Date parse trick (space -> "T") used for the dump date.
function formatWikiSyncKindSyncedText(run) {
	const raw = String(run?.completed_at || run?.updated_at || "").trim();
	if (raw === "") {
		return "Zuletzt gesynct: unbekannt";
	}
	const parsed = new Date(raw.replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) {
		return `Zuletzt gesynct: ${raw}`;
	}
	return `Zuletzt gesynct: ${parsed.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}`;
}

// Surface a tab-level message (success/error/pending) in the per-kind status
// node (wiki-sync-sync-<kind>-status) so a real step FAILURE is visible right on
// the tab, not only in the global #wiki-sync-status. tone drives a data-tone hook
// consumers can style; the text is always set so a hang can never be misread as a
// silent success.
function setWikiSyncKindStatus(kind, message, tone = "") {
	const ids = WIKI_SYNC_KIND_ELEMENTS[kind];
	if (!ids) {
		return;
	}
	const statusElement = document.getElementById(ids.status);
	if (!statusElement) {
		return;
	}
	statusElement.hidden = false;
	statusElement.textContent = message;
	if (tone) {
		statusElement.dataset.tone = tone;
	} else {
		delete statusElement.dataset.tone;
	}
}

function renderWikiSyncKindProgress(kind, progress, done, run, phase = "staging") {
	const ids = WIKI_SYNC_KIND_ELEMENTS[kind];
	if (!ids) {
		return;
	}
	const progressElement = document.getElementById(ids.progress);
	const statusElement = document.getElementById(ids.status);

	const processed = Number(progress?.processed ?? 0);
	const total = Number(progress?.total ?? 0);
	if (progressElement) {
		progressElement.hidden = false;
		progressElement.max = Number.isFinite(total) && total > 0 ? total : 1;
		progressElement.value = Number.isFinite(processed) && processed >= 0 ? Math.min(processed, progressElement.max) : 0;
	}
	if (statusElement) {
		statusElement.hidden = false;
		// A fresh progress render means the step SUCCEEDED, so drop any prior error tone.
		delete statusElement.dataset.tone;
		if (done) {
			// On done show the "Zuletzt gesynct" date; append post-action notes if any.
			statusElement.textContent = formatWikiSyncKindSyncedText(run);
		} else if (phase === "conflict_gen") {
			// The chunked settlement conflict-generation phase (after staging drained).
			statusElement.textContent = total > 0 ? `Konfliktanalyse läuft … ${processed}/${total}` : "Konfliktanalyse läuft …";
		} else {
			statusElement.textContent = total > 0 ? `Syncen läuft … ${processed}/${total}` : "Syncen läuft …";
		}
	}
}

// Drive sync_kind to completion for ONE kind: loop the action once per step,
// advancing the server-returned cursor (high-water mark) until done. Mirrors
// runWikiSyncDumpLoop (bounded step ceiling; stops cleanly on the 409 lock).
async function runWikiSyncKindSyncLoop(kind) {
	// Two cursors: `cursor` drives the STAGING phase, `conflictCursor` the chunked
	// settlement CONFLICT_GEN phase. `phase` is echoed by the server; we send back
	// whatever phase it last reported so it can flip us from staging to conflict_gen
	// when staging drains (settlement only). Non-settlement kinds never leave
	// 'staging'.
	let cursor = 0;
	let conflictCursor = 0;
	let phase = "staging";
	let done = false;
	let safetyCounter = 0;
	let lastResult = null;
	// Cases are upserted incrementally across the conflict-gen steps, so sum each
	// step's count for an accurate "+N Konfliktfälle" note (not just the last step).
	let conflictStoredTotal = 0;
	// Roomier ceiling: staging (up to ~2000 steps) PLUS the conflict-gen phase
	// (~13 map-place batches + 1 finalize) can chain in one run.
	const MAX_STEPS = 4000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("Syncen wurde nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction("sync_kind", { kind, cursor, phase, conflict_cursor: conflictCursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				// Another editor holds the dump pipeline: stop immediately (do NOT retry).
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				setWikiSyncKindStatus(kind, error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			// A REAL step failure (e.g. a server error on the final conflict-gen step)
			// must be visible on the tab itself, so a hang can never be misread as a
			// silent success. Surface it in the per-kind status node before rethrowing.
			setWikiSyncKindStatus(kind, error.message || `Syncen (${kind}) fehlgeschlagen.`, "error");
			throw error;
		}

		lastResult = stepResult;
		phase = stepResult.phase === "conflict_gen" ? "conflict_gen" : "staging";
		// Advance the cursor that belongs to the phase the server just ran/returned.
		if (phase === "conflict_gen") {
			conflictCursor = Number(stepResult.conflict_cursor ?? conflictCursor);
		}
		cursor = Number(stepResult.cursor ?? cursor);
		conflictStoredTotal += Number(stepResult.conflict_stored ?? 0);
		done = stepResult.done === true;
		renderWikiSyncKindProgress(kind, stepResult.progress, done, stepResult.run, phase);
	}

	// Expose the summed conflict-gen case count so the caller's note is accurate.
	if (lastResult && typeof lastResult === "object") {
		lastResult.conflict_stored_total = conflictStoredTotal;
	}
	return lastResult;
}

// Click handler for a tab's "Syncen" button. Runs the loop, then refreshes the
// affected tab so the newly-synced staging rows show up (and the territory model
// rebuild / settlement conflict cases surface).
async function startWikiSyncKindSync(kind) {
	if (!WIKI_SYNC_KIND_ELEMENTS[kind] || isWikiSyncKindSyncRunning) {
		return;
	}
	isWikiSyncKindSyncRunning = true;
	setWikiSyncKindButtonsDisabled(true, kind);
	setWikiSyncStatus(`Syncen (${kind}) läuft …`, "pending");

	try {
		const result = await runWikiSyncKindSyncLoop(kind);
		const postActions = result?.post_actions || {};
		let note = "";
		if (kind === "settlement") {
			// The summed conflict-gen total (all steps); fall back to the final step's
			// settlement_cases.stored if the total is somehow absent.
			const storedTotal = Number(result?.conflict_stored_total ?? postActions.settlement_cases?.stored ?? 0);
			note = ` (+${storedTotal} Konfliktfälle)`;
		} else if (kind === "territory" && postActions.territory_model) {
			note = ` (Modell: ${Number(postActions.territory_model.nodes || 0)} Knoten)`;
		}
		setWikiSyncStatus(`Syncen (${kind}) abgeschlossen.${note}`, "success");
		showFeedbackToast(`Syncen (${kind}) abgeschlossen.${note}`, "success");

		// Refresh the affected tab so the freshly-synced rows/cases appear.
		try {
			if (kind === "settlement") {
				await loadWikiSyncCases();
				if (typeof loadSettlementList === "function") loadSettlementList();
			} else if (kind === "path" && typeof loadPathWikiSync === "function") {
				await loadPathWikiSync();
			} else if (kind === "region" && typeof loadRegionWikiSync === "function") {
				await loadRegionWikiSync();
			} else if (kind === "territory") {
				await renderWikiSyncTerritoryTree({ forceReload: true });
			}
		} catch (refreshError) {
			/* Refresh is best-effort; the sync itself already succeeded. */
		}
	} catch (error) {
		console.error(`Syncen (${kind}) fehlgeschlagen:`, error);
		setWikiSyncStatus(error.message || `Syncen (${kind}) fehlgeschlagen.`, "error");
		// Mirror the failure onto the tab's own status node (belt-and-suspenders with
		// the loop's catch) so the tab never looks stuck-but-fine after a real error.
		setWikiSyncKindStatus(kind, error.message || `Syncen (${kind}) fehlgeschlagen.`, "error");
		showFeedbackToast(error.message || `Syncen (${kind}) fehlgeschlagen.`, "warning");
	} finally {
		isWikiSyncKindSyncRunning = false;
		setWikiSyncKindButtonsDisabled(false);
	}
}

// --- Inline credential prompt (O1) -------------------------------------------
// Copies the #wiki-sync-resolve-overlay dialog pattern. Resolves to true once the
// credentials are stored server-side (set_dump_credentials), false if cancelled.
function setWikiSyncDumpCredentialsStatus(message = "", tone = "") {
	const statusElement = document.getElementById("wiki-sync-dump-credentials-status");
	if (!statusElement) {
		return;
	}
	statusElement.textContent = message;
	statusElement.dataset.tone = tone;
}

function closeWikiSyncDumpCredentialsPrompt(accepted) {
	const overlay = document.getElementById("wiki-sync-dump-credentials-overlay");
	if (overlay) {
		overlay.hidden = true;
	}
	const resolver = wikiSyncDumpCredentialsResolver;
	wikiSyncDumpCredentialsResolver = null;
	if (typeof resolver === "function") {
		resolver(Boolean(accepted));
	}
}

function openWikiSyncDumpCredentialsPrompt() {
	const overlay = document.getElementById("wiki-sync-dump-credentials-overlay");
	const usernameInput = document.getElementById("wiki-sync-dump-credentials-username");
	const passwordInput = document.getElementById("wiki-sync-dump-credentials-password");
	if (!overlay || !usernameInput || !passwordInput) {
		return Promise.resolve(false);
	}

	// If a prompt is somehow already open, resolve the stale one as cancelled first.
	if (typeof wikiSyncDumpCredentialsResolver === "function") {
		const stale = wikiSyncDumpCredentialsResolver;
		wikiSyncDumpCredentialsResolver = null;
		stale(false);
	}

	usernameInput.value = lastWikiSyncDumpCredentialsUsername || "";
	passwordInput.value = "";
	setWikiSyncDumpCredentialsStatus("");
	overlay.hidden = false;
	// Prefer focusing the password when the username is already prefilled.
	(lastWikiSyncDumpCredentialsUsername ? passwordInput : usernameInput).focus();

	return new Promise((resolve) => {
		wikiSyncDumpCredentialsResolver = resolve;
	});
}

async function submitWikiSyncDumpCredentials() {
	const usernameInput = document.getElementById("wiki-sync-dump-credentials-username");
	const passwordInput = document.getElementById("wiki-sync-dump-credentials-password");
	const username = (usernameInput?.value || "").trim();
	const password = passwordInput?.value || "";
	if (username === "" || password === "") {
		setWikiSyncDumpCredentialsStatus("Benutzername und Passwort dürfen nicht leer sein.", "error");
		return;
	}

	setWikiSyncDumpCredentialsStatus("Zugangsdaten werden gespeichert …", "pending");
	try {
		const result = await submitWikiSyncDumpAction("set_dump_credentials", { username, password });
		// The backend echoes the stored username (never the password) for the next prefill.
		lastWikiSyncDumpCredentialsUsername = result.username || username;
		closeWikiSyncDumpCredentialsPrompt(true);
	} catch (error) {
		console.error("Dump-Zugangsdaten konnten nicht gespeichert werden:", error);
		// set_dump_credentials needs the 'admin' capability; a non-admin editor gets a 403
		// with a ready-to-show German message -> surface it in the dialog, keep it open.
		setWikiSyncDumpCredentialsStatus(error.message || "Zugangsdaten konnten nicht gespeichert werden.", "error");
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
	dialog.style.width = "min(1400px, calc(100vw - 24px))";
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
	const territoriesButtonElement = document.getElementById("wiki-sync-territories");

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

// (WikiSync case resolution moved to review-wiki-sync-resolve.js - M5 split.)

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
