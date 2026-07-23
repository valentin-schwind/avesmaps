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

// Konfliktzentrum (P0): der Dialog haelt die verschobene Konfliktloesung. Kein Laden noetig --
// der Knopf sitzt im WikiSync-Panel, dessen Tab-Loader loadWikiSyncCases() bereits gelaufen ist.
function setWikiSyncConflictsDialogOpen(isOpen) {
	$("#wiki-sync-conflicts-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen) {
		document.getElementById("wiki-sync-conflicts-dialog")?.focus();
		if (typeof setConflictDialogMinimized === "function") {
			setConflictDialogMinimized(false);
		}
		// Load on first open so the dialog is never empty for no reason. The scan is one walk over
		// map_features -- the same table map-features.php walks on every visitor page load -- so it
		// does not warrant making an editor press a button to see anything. Subsequent opens reuse
		// the result; "Neu prüfen" is the explicit refresh.
		if (typeof conflictsLoadedOnce !== "undefined" && !conflictsLoadedOnce && typeof loadConflicts === "function") {
			void loadConflicts();
		}
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

// Die Startknoepfe der Editoren tragen seit 2026-07-22 eine feste Struktur:
// <span class="t1">Beschriftung</span> plus den eigenstaendigen "Zuletzt gesynct"-Span
// (dessen id refreshWikiSyncKindSyncedStatus weiter direkt anspricht). Ein textContent
// auf den KNOPF wuerde beide Kinder entfernen -- der Zeitstempel waere nach dem ersten
// Sync-Lauf weg und kaeme erst beim naechsten Laden wieder. Darum nur die Titelzeile.
function setWikiSyncStartButtonLabel(buttonElement, label) {
	if (!buttonElement) {
		return;
	}
	const titleElement = buttonElement.querySelector(".t1");
	if (titleElement) {
		titleElement.textContent = label;
		return;
	}
	buttonElement.textContent = label;
}

function setWikiSyncTerritoriesRunning(isRunning) {
	isWikiSyncTerritoriesRunning = isRunning;

	const buttonElement = document.getElementById("wiki-sync-territories");
	if (buttonElement) {
		buttonElement.disabled = isRunning || isWikiSyncLocationsRunning;
		setWikiSyncStartButtonLabel(buttonElement, isRunning ? "Synchronisiert..." : "Territorien bearbeiten");
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
	// Same best-effort pattern: fills each tab's persistent "Zuletzt gesynct: <date>"
	// label from the server on load, so it survives a reload (previously only a FRESH
	// sync_kind response ever set it -- see refreshWikiSyncKindSyncedStatus's docblock).
	void refreshWikiSyncKindSyncedStatus();

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

// --- The subject rail (level 2) --------------------------------------------------------------
// Built from the registry; index.html holds only the empty container. A row carries name and
// last-synced -- and deliberately NO count. A count is only known once its list has rendered,
// which happens when the subject is clicked, so the rail opened showing seven em dashes and one
// number and grew a number per visit (Owner 2026-07-22). The date loads eagerly and is right on
// open, which is why it stays. Two empty cases stay APART, the same distinction
// wikiSyncKindSyncedLabel already draws: no answer yet is blank, a server-side null is "nie".
// Collapsing them would make the rail claim a "never synced" it was never told.
var wikiSyncKindSyncedRaw = null;

// Short form for the narrow date column ("22.07."). The full sentence rides in the row's title,
// so the compact form never has to carry "Zuletzt gesynct: unbekannt" in 46px.
function wikiSyncRailDateText(subjectKey) {
	const kind = wikiSyncSubjectSyncKind(subjectKey);
	if (!kind || !wikiSyncKindSyncedRaw || !Object.prototype.hasOwnProperty.call(wikiSyncKindSyncedRaw, kind)) {
		return "";
	}
	const raw = wikiSyncKindSyncedRaw[kind];
	if (!raw) {
		return "nie";
	}
	const parsed = new Date(String(raw).replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	return String(parsed.getDate()).padStart(2, "0") + "." + String(parsed.getMonth() + 1).padStart(2, "0") + ".";
}

// Deliberately NOT called from setWikiSyncPanelTab: the active marker is already moved by the
// [data-wiki-sync-panel-tab] loop in there, which now finds these rows too. Re-rendering on every
// click would throw the rows away and rebuild them for nothing.
function renderWikiSyncSubjectRail() {
	const host = document.getElementById("wiki-sync-subject-rail");
	if (!host) {
		return;
	}
	host.innerHTML = "";
	WIKI_SYNC_SUBJECTS.forEach((subject) => {
		const isActive = subject.key === activeWikiSyncPanelTab;
		const row = document.createElement("button");
		row.type = "button";
		row.className = "wiki-sync-rail__row" + (isActive ? " is-active" : "");
		// The cascade recognises a tab by exactly this attribute (js/ui/ui-controls.js), and
		// setWikiSyncPanelTab marks the active one through it. Without it a row is not a tab.
		row.setAttribute("data-wiki-sync-panel-tab", subject.key);
		row.setAttribute("aria-selected", isActive ? "true" : "false");
		const kind = wikiSyncSubjectSyncKind(subject.key);
		if (kind) {
			row.title = subject.label + " — " + wikiSyncKindSyncedLabel(wikiSyncKindSyncedRaw, kind);
		}
		row.innerHTML =
			'<span>' + escapeHtml(subject.label) + '</span>'
			+ '<span class="wiki-sync-rail__date">' + escapeHtml(wikiSyncRailDateText(subject.key)) + '</span>';
		// bootstrap.js binds [data-wiki-sync-panel-tab] DIRECTLY, not delegated, so it only ever
		// sees elements that existed at load. These rows do not, hence their own listener.
		row.addEventListener("click", () => setWikiSyncPanelTab(subject.key));
		host.appendChild(row);
	});
}

// Wohin ein Knopf zurückgehört, wenn ein anderes Subjekt an die Reihe kommt. WeakMap, damit ein
// Knopf, den ein Fenster woanders hinzieht (moveLoreSectionIntoDialog), hier nichts festhält.
const wikiSyncVerbHomes = new WeakMap();

// Der EINE Knopf des gewählten Subjekts, an eine feste Stelle direkt unter die Auswahl.
//
// 💣 Er wird VERSCHOBEN, nicht nachgebaut. Ein Stellvertreter hätte den echten Knopf daneben
// stehen lassen (jedes Subjekt zeigte seinen Knopf doppelt) und hätte die Fortschrittsanzeige
// verloren: setWikiSyncButtonState schreibt Beschriftung, Füllstand und den blockierten Zustand
// IN den echten Knopf. appendChild verschiebt den Knoten samt id, Bindungen, Titel und dem
// „Zuletzt gesynct"-Span darin -- es gibt danach nur noch diesen einen Knopf.
function renderWikiSyncVerbs() {
	const host = document.getElementById("wiki-sync-verbs");
	if (!host) {
		return;
	}
	// Erst zurückräumen: was hier noch vom vorigen Subjekt liegt, gehört in seine Sektion.
	Array.from(host.children).forEach((parked) => {
		const home = wikiSyncVerbHomes.get(parked);
		if (home) {
			home.appendChild(parked);
		} else {
			parked.remove();
		}
	});

	const buttonId = wikiSyncSubjectButtonId(activeWikiSyncPanelTab);
	const button = buttonId ? document.getElementById(buttonId) : null;
	if (!button) {
		return;
	}
	if (!wikiSyncVerbHomes.has(button) && button.parentElement) {
		wikiSyncVerbHomes.set(button, button.parentElement);
	}
	host.appendChild(button);
}

// Rendered once here, during parse. The rail has to exist before ui-controls' DOMContentLoaded
// handler restores the remembered tab -- that looks the button up with querySelector and clicks
// it, so an empty container would silently drop "remember where I was" for WikiSync.
renderWikiSyncSubjectRail();
renderWikiSyncVerbs();

function setWikiSyncPanelTab(tabName) {
	// Valid = "the registry knows it" (js/review/review-subjects.js). Never a literal list here:
	// a key missing from such a list makes its tab silently fall back to Siedlungen, which is how
	// the tab cascade broke once already (spec 2026-07-17-editor-reiter-kaskade-design.md).
	const previousWikiSyncSubject = activeWikiSyncPanelTab;
	activeWikiSyncPanelTab = wikiSyncIsKnownSubject(tabName) ? tabName : "locations";

	// Ein Subjektwechsel verwirft die Filterauswahl der Listen (Owner 2026-07-22): ein Filter, den
	// man vor drei Subjekten gesetzt hat, laesst die Liste beim Zurueckkommen unvollstaendig
	// aussehen. NUR bei einem echten Wechsel -- denselben Reiter erneut anzuklicken (das tut u. a.
	// jeder Refresh-Pfad) darf die Arbeit nicht wegwerfen.
	if (previousWikiSyncSubject !== activeWikiSyncPanelTab && typeof window !== "undefined" && typeof window.avesmapsResetWikiSyncListFilters === "function") {
		window.avesmapsResetWikiSyncListFilters();
	}

	document.querySelectorAll("[data-wiki-sync-panel-tab]").forEach((tabElement) => {
		const isActive = tabElement.dataset.wikiSyncPanelTab === activeWikiSyncPanelTab;
		tabElement.classList.toggle("is-active", isActive);
		tabElement.setAttribute("aria-selected", isActive ? "true" : "false");
	});

	document.querySelectorAll("[data-wiki-sync-panel-section]").forEach((sectionElement) => {
		sectionElement.classList.toggle("is-active", sectionElement.dataset.wikiSyncPanelSection === activeWikiSyncPanelTab);
	});

	// The shared strip belongs to whichever list is showing, so it is emptied on every switch and
	// refilled by that subject's own renderer. Without this, Abenteuer/Karten/Kraftlinien -- which
	// have no views at all -- would inherit the previous subject's tabs and silently offer
	// "Platziert / Fehlt" on a list that has no such thing.
	const viewTabsHost = document.getElementById("wiki-sync-view-tabs");
	if (viewTabsHost) {
		viewTabsHost.innerHTML = "";
	}

	// Which list to (lazily) load for which subject. Loaders stay optional -- some are defined in
	// files that only load in edit mode, so a missing one must be skipped, not crash. The guards
	// also mean a MISSPELLED loader silently does nothing, so the panel-tab test checks every name
	// here against the real definitions.
	//
	// Kraftlinien loads a navigation list (renderPowerlineSyncList, review-powerline-list.js) grouped
	// from powerlineData; double-clicking a line zooms to it in powerline mode. No API -- the segments
	// are already in the app -- so the loader just renders what is there.
	// The old adventures branch also loaded the citymap list, so both "Materialien" pills showed
	// their count at once. That is gone on purpose -- Karten is its own subject now and loads on
	// its own click.
	const loaders = {
		locations: () => {
			if (typeof renderWikiSyncCases === "function") renderWikiSyncCases();
			if (typeof loadSettlementList === "function") loadSettlementList();
		},
		territories: () => (typeof renderWikiSyncTerritoryTree === "function") && renderWikiSyncTerritoryTree(),
		regions: () => (typeof loadRegionWikiSync === "function") && loadRegionWikiSync(),
		paths: () => (typeof loadPathWikiSync === "function") && loadPathWikiSync(),
		powerlines: () => (typeof renderPowerlineSyncList === "function") && renderPowerlineSyncList(),
		adventures: () => (typeof loadWikiSyncAdventureList === "function") && loadWikiSyncAdventureList(),
		citymaps: () => (typeof loadWikiSyncCitymapList === "function") && loadWikiSyncCitymapList(),
		lore: () => (typeof loadLoreList === "function") && loadLoreList("panel"),
	};
	if (loaders[activeWikiSyncPanelTab]) {
		void loaders[activeWikiSyncPanelTab]();
	}

	// The verb row belongs to the SELECTED subject, so it is the one thing that must be rebuilt
	// on every switch. (The rail is not: its active marker is already moved by the loop above.)
	if (typeof renderWikiSyncVerbs === "function") {
		renderWikiSyncVerbs();
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
	const host = wikiSyncViewTabsHostFor("territories");
	if (!host) {
		return;
	}
	const tab = (view, label, count) =>
		`<button type="button" data-territory-mapstatus="${view}" class="region-sync__viewtab${wikiSyncTerritoryMapStatus === view ? " is-active" : ""}">${label} (${count})</button>`;
	host.innerHTML = tab("all", "Alle", total) + tab("placed", "Platziert", placed) + tab("missing", "Fehlt", missing);
}

// Zeitraum + „nur Flächenländer" liegen jetzt im gemeinsamen Trichter (js/ui/filter-menu.js) statt
// als Zeile unter der Suche. Ihr Zustand lebt hier; die Auswertung liefert dasselbe {mode,from,to}
// wie früher readTimeFilter, sodass die Consumer (getWikiSyncTerritoryTimeFilter-Aufrufer)
// unberührt bleiben. Vorgabe „heute", wie das alte, vorangekreuzte Häkchen.
const wikiSyncTerritoryTimeState = typeof avmRangeStateCreate === "function"
	? avmRangeStateCreate("today")
	: { mode: "today", fromText: "", toText: "" };
const wikiSyncTerritoryFlaechState = { value: "" }; // "" = alle | "ja" = nur Flächenländer

function getWikiSyncTerritoryTimeFilter() {
	if (typeof avmRangeValue === "function") {
		return avmRangeValue(wikiSyncTerritoryTimeState);
	}
	return { mode: "off", from: -Infinity, to: Infinity };
}

// „nur Flächenländer": promotete Siedlungen (Reichsstadt/Freie Stadt/Stadtstaat) ausblenden.
// Default aus (alle zeigen).
function getWikiSyncTerritoryFlaechenlandOnly() {
	return wikiSyncTerritoryFlaechState.value === "ja";
}

// Den Trichter des Territorien-Subjekts verdrahten. Einmal beim Auswerten -- die Hülle steht
// statisch in index.html. Beide Abschnitte lösen ein Neuzeichnen des Baums aus.
if (typeof avmFilterMenuAttach === "function" && typeof document !== "undefined") {
	avmFilterMenuAttach(
		"wiki-sync-territory-filter-toggle",
		"wiki-sync-territory-filter-menu",
		[
			{ menuId: "wiki-sync-territory-time-menu", kind: "range", state: wikiSyncTerritoryTimeState, label: "Zeitraum" },
			{
				menuId: "wiki-sync-territory-flaech-menu", kind: "single", state: wikiSyncTerritoryFlaechState,
				options: [{ value: "ja", label: "nur Flächenländer" }], label: "Flächenländer",
			},
		],
		() => { if (typeof renderWikiSyncTerritoryTree === "function") void renderWikiSyncTerritoryTree(); },
		"Filter"
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
		const flaechenlaenderOnly = getWikiSyncTerritoryFlaechenlandOnly();
		// Basismenge (Such-/Zeit-/Flächenland-Filter, ohne Karten-Status) — Grundlage für die Tab-Zähler.
		const baseRows = treeModule
			.filterRows(rows, { search, time, flaechenlaenderOnly, continent: "Aventurien" })
			.filter((row) => row && row.continent === "Aventurien");
		// Basisbaum EINMAL bauen: er trägt Such-/Zeit-/Kontinent-/Flächenland-Filter bereits und speist
		// Coverage-Punkt, Zähler UND die Reiter-Ansicht aus DERSELBEN Quelle.
		const baseTree = treeModule.buildTree(baseRows);
		const coverageByKey = typeof treeModule.computeCoverageByKey === "function"
			? treeModule.computeCoverageByKey(baseTree.root)
			: null;
		let allCount = 0;
		let placedCount = 0;
		if (coverageByKey) {
			coverageByKey.forEach((status) => {
				allCount += 1;
				if (status && status.hasAnyCoverage) placedCount += 1;
			});
		} else {
			const isPlaced =
				typeof treeModule.isRowAssignedToMap === "function"
					? treeModule.isRowAssignedToMap
					: (row) => Boolean(row && row.map_assigned) || Number((row && row.map_geometry_count) || 0) > 0;
			allCount = baseRows.length;
			for (const row of baseRows) {
				if (isPlaced(row)) placedCount += 1;
			}
		}
		renderWikiSyncTerritoryMapStatusTabs(allCount, placedCount, allCount - placedCount);
		// „Platziert"/„Fehlt": den Basisbaum auf die Äste mit passenden Ziel-Knoten stutzen (Vorfahren als
		// navigierbarer Pfad bleiben) statt flach zu filtern + Ahnen zu re-expandieren. So landet kein
		// durchgesickerter (abgedeckter/aufgelöster/kontinentfremder) Knoten je als Sackgasse in „Fehlt".
		const treeResult =
			(wikiSyncTerritoryMapStatus === "placed" || wikiSyncTerritoryMapStatus === "missing")
				&& typeof treeModule.pruneTreeToMapStatus === "function"
				? { root: treeModule.pruneTreeToMapStatus(baseTree.root, coverageByKey, wikiSyncTerritoryMapStatus) }
				: baseTree;
		const countVisibleNodes = (node) => (Array.isArray(node && node.children) ? node.children : []).reduce((sum, child) => sum + 1 + countVisibleNodes(child), 0);
		const visibleRowCount = countVisibleNodes(treeResult.root);
		// Summary identisch zum Sync-Monitor: alle Knoten gesamt, sichtbare Wurzeln (Aventurien+heute = 53).
		wikiSyncTerritorySummary = {
			territory_count: Array.isArray(rows) ? rows.length : 0,
			root_count: Array.isArray(treeResult?.root?.children) ? treeResult.root.children.length : 0,
		};

		treeModule.renderTree({
			container: treeElement,
			root: treeResult.root,
			coverageByKey,
			rowCount: visibleRowCount,
			totalRowCount: rows.length,
			searchText: wikiSyncTerritoryFilterQuery,
			itemClassName: "wiki-sync-territory-tree__item",
			onItemClick: (node, event) => {
				event.stopPropagation();
			},
		});

		if (visibleRowCount < 1) {
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

// Human-readable German labels for the 7 work phases (dump-hybrid-driver.php phase constants).
const WIKI_SYNC_DUMP_PHASE_LABELS = {
	online_class_map: "Online-Klassen-Karte",
	online_building_map: "Online-Bauwerks-Karte",
	online_continent_map: "Online-Kontinent-Karte",
	redirect_aliases: "Weiterleitungen",
	wikitext_collect: "Wikitext sammeln",
	parse_and_upsert: "Parsen und schreiben",
	publication_sources: "Publikationsquellen",
	completed: "Abgeschlossen",
};

function setWikiSyncDumpButtonsDisabled(isDisabled, label = "") {
	const readButton = document.getElementById("wiki-sync-dump-read");
	if (!readButton) {
		return;
	}
	// Goes through the shared setter so this and renderWikiSyncDumpProgress cannot fight over the
	// same button. It used to hard-code "📥 Dump holen" when idle, which wiped the resting label --
	// and the resting label is where "zuletzt <Datum>" now lives.
	setWikiSyncButtonState(readButton, {
		label: isWikiSyncDumpRunning ? label : "",
		running: isDisabled,
	});
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
	// "Dump geholt: <date>" is persistent information, not a transient state -- so it becomes the
	// button's RESTING label instead of a line underneath it. Same fact, no element that appears.
	const button = document.getElementById("wiki-sync-dump-read");
	if (!button) {
		return;
	}
	try {
		const status = await fetchWikiSyncDumpStatus();
		const fetched = formatWikiSyncDumpFetchedStatusText(status).replace("Dump geholt: ", "zuletzt ");
		button.dataset.idleLabel = `📥 Dump holen — ${fetched}`;
		// Only adopt it right away when nothing is running; a live run owns the label meanwhile.
		if (!button.disabled) {
			button.textContent = button.dataset.idleLabel;
		}
	} catch (error) {
		console.warn("WikiDump-Status konnte nicht geladen werden:", error);
	}
}

// Fill each of the 4 tabs' persistent "Zuletzt gesynct: <date>" label from the server
// on load (GET ?action=last_synced, read-only). Fix: previously that label was ONLY
// ever set from a FRESH sync_kind response's `run` (see renderWikiSyncKindProgress),
// so it went blank again after a page reload even though the kind had been synced
// before. WIKI_SYNC_KIND_ELEMENTS is defined further below in this file, but this
// function is only ever called from loadWikiSyncCases (an async call site reached
// well after full parse), so the forward reference is safe. Best-effort: a failed
// fetch just leaves the labels in whatever state they were already in (hidden by
// default), never blocks the panel or throws into a caller.
// Das "Zuletzt gesynct"-Label einer Art -- immer MIT Text, nie leer. Ein Feld, das bei vier Reitern
// steht und bei zweien fehlt, laesst die sechs Kacheln unterschiedlich aussehen (Owner 2026-07-19:
// "einfach Konsistenz schaffen"). Die Server-Antwort kennt dabei zwei verschiedene Faelle, und dieser
// Text auch: null heisst "diese Art wurde nachweislich nie gesynct" (so dokumentiert an
// avesmapsWikiDumpSyncKindLastSynced), ein FEHLENDER Schluessel heisst nur "dazu kam keine Antwort" --
// etwa wenn die Lib einer Art nicht geladen war. Die beiden duerfen nicht denselben Satz bekommen,
// sonst behauptet das Panel ein "nie", das es gar nicht weiss.
function wikiSyncKindSyncedLabel(synced, kind) {
	const answered = synced !== null && typeof synced === "object" && Object.prototype.hasOwnProperty.call(synced, kind);
	const raw = answered ? synced[kind] : null;
	if (raw) {
		return formatWikiSyncKindSyncedText({ completed_at: raw });
	}
	return answered ? "Noch nie gesynct" : "Zuletzt gesynct: unbekannt";
}

async function refreshWikiSyncKindSyncedStatus() {
	try {
		const synced = await fetchWikiSyncKindLastSynced();
		// Same answer, second reader: the rail shows one date per subject and translates the
		// subject key to this map's sync kind through the registry (wikiSyncSubjectSyncKind).
		// VERSCHMELZEN, nicht ersetzen: der Lore-Schluessel kommt aus einem anderen Endpunkt
		// (siehe loadLoreList) und waere bei jedem Neuladen dieser Antwort sonst wieder weg.
		wikiSyncKindSyncedRaw = Object.assign({}, wikiSyncKindSyncedRaw, synced);
		renderWikiSyncSubjectRail();
		// Das DATUM steht rechts neben dem Knopf -- bei allen sechs Reitern gleich (Owner 2026-07-19,
		// Vorbild Siedlungen/Territorien). Das ist kein Widerspruch zur Regel an setWikiSyncButtonState:
		// die gilt dem LAUFENDEN Zustand (Beschriftung, Fortschritt, blockiert), der beim Klick
		// aufklappen und die Seite schieben wuerde. Das "Zuletzt gesynct"-Datum steht dagegen dauerhaft
		// an derselben Stelle und schiebt nichts -- es gehoert in die zweite Rasterspalte, nicht in den Knopf.
		Object.entries(WIKI_SYNC_KIND_ELEMENTS).forEach(([kind, ids]) => {
			const syncedElement = document.getElementById(ids.synced);
			if (!syncedElement) {
				return;
			}
			syncedElement.textContent = wikiSyncKindSyncedLabel(synced, kind);
			syncedElement.hidden = false;
		});
		// Die Editor-Buttons (Siedlungen/Territorien) tragen ihr "Zuletzt gesynct"-Datum rechts daneben --
		// wie Wege/Regionen, aber aus derselben last_synced-Antwort, ohne die Buttons in Kind-Syncs zu
		// verdrahten (der Territorien-Sync laeuft im Iframe-Editor, nicht ueber startWikiSyncKindSync).
		[["settlement-editor-synced", "settlement"], ["wiki-sync-territory-synced", "territory"], ["wiki-sync-sync-adventure-synced", "adventure"], ["adventure-editor-synced", "adventure"], ["citymaps-editor-synced", "citymap"]].forEach(([id, kind]) => {
			const el = document.getElementById(id);
			if (!el) {
				return;
			}
			el.textContent = wikiSyncKindSyncedLabel(synced, kind);
			el.hidden = false;
		});
	} catch (error) {
		console.warn("WikiDump Zuletzt-gesynct-Status konnte nicht geladen werden:", error);
	}
}

function renderWikiSyncDumpProgress(progress, done) {
	// Into the button, like every other long-running action here. The bar and the status line this
	// used to drive unfolded UNDER the button and pushed the whole panel down mid-click; both are
	// gone, and the same information now rides in the control the user just pressed.
	const button = document.getElementById("wiki-sync-dump-read");
	if (!button) {
		return;
	}

	const current = Number(progress?.progress_current ?? 0);
	const totalRaw = Number(progress?.progress_total ?? 6);
	const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 6;

	if (done) {
		// Deliberately NOT resetting the button here. This "done" is the READ STEP finishing, not
		// the operation -- cleanup and the publication reconcile still follow. The old code wrote
		// "Fertig: Abgeschlossen" at this point and left it standing while two more steps ran, which
		// is exactly the "es steht fertig dran und macht dann noch weiter" that got reported.
		// startWikiSyncDumpRead owns the end: it re-enables the button and refreshes the label.
		return;
	}

	const phaseKey = String(progress?.phase ?? "");
	const phaseLabel = WIKI_SYNC_DUMP_PHASE_LABELS[phaseKey] || phaseKey || "…";
	// Whichever per-step counter the current phase returned (dump-hybrid-driver.php envelope).
	const counters = [];
	if (progress && Number(progress.pages_scanned) > 0) counters.push(`${Number(progress.pages_scanned)} Seiten`);
	if (progress && Number(progress.found_this_step) > 0) counters.push(`${Number(progress.found_this_step)} gefunden`);
	if (progress && Number(progress.title_aliases_written) > 0) counters.push(`${Number(progress.title_aliases_written)} Aliase`);
	if (progress && Number(progress.processed_this_step) > 0) counters.push(`${Number(progress.processed_this_step)} verarbeitet`);
	if (progress && Number(progress.kept) > 0) counters.push(`${Number(progress.kept)} übernommen`);
	const counterText = counters.length > 0 ? ` (${counters.join(", ")})` : "";

	setWikiSyncButtonState(button, {
		label: `Phase ${Math.min(current + 1, total)}/${total}: ${phaseLabel}${counterText}`,
		current,
		total,
		running: true,
	});
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
		// The phase label deliberately does NOT go to the global #wiki-sync-status any more.
		// renderWikiSyncDumpProgress above already puts a richer version into the dump's own line
		// ("Phase 4/6: Weiterleitungs-Aliase (12345 Seiten, 678 Aliase)") AND hides that line when
		// the run is over. The global line has no such lifecycle, so the last phase message stayed
		// on screen forever -- "Weiterleitungs-Aliase werden aus dem Dump gelesen." sitting there
		// long after the dump had finished, reading like something was still running.
		//
		// The global line keeps its real job: errors, the credentials prompt and the interactive
		// hints. Those must persist until something replaces them, which is exactly why it must not
		// be used for per-step chatter that nothing ever clears.
	}

	return lastRun;
}

// "Dump holen": ONE user-visible operation chaining four backend steps in strict
// sequence -- each step only runs if the previous one succeeded:
//   1. fetch_dump   -- re-download the dump file from the wiki (server-fetch).
//   2. start_read + read_step loop -- the sandbox-safe scan (dryRun=true the whole
//      way; writes ONLY wiki_dump_hybrid_state/wiki_dump_title_alias).
//   3. cleanup_state -- ONLY after a successful scan: delete every OTHER dump_read
//      run's sandbox rows so exactly one dump's state remains.
//   4. sync_publications loop (runWikiSyncPublicationsSyncLoop) -- the SHARP
//      reconcile of wiki publication sources into feature_sources
//      (origin=wiki_publication only; manual/suppressed sources are untouched).
//      Folded in here so "Dump holen" is ONE action instead of two -- this used
//      to be a separate "Publikationsquellen übernehmen" button; the owner asked
//      to fold it in. The reconcile itself stays override-safe and idempotent.
// If fetch fails, the scan never runs. If the scan fails, cleanup never runs (so a
// failed/partial run's rows stay around rather than silently vanishing, and the
// previous good run -- if any -- is untouched since it is still "the newest
// completed run" until a NEW run completes). If cleanup fails, the publication
// reconcile never runs either.
async function startWikiSyncDumpRead() {
	if (isWikiSyncDumpRunning) {
		return;
	}
	if (!window.confirm("Dump holen lädt den kompletten Wiki-Dump neu, holt Weiterleitungen + Kontinente online und übernimmt danach die Publikationsquellen scharf in die Quellen (feature_sources) — manuelle/unterdrückte Quellen bleiben unangetastet. Das dauert einige Minuten. Jetzt starten?")) {
		return;
	}
	isWikiSyncDumpRunning = true;

	try {
		// Step 1/4: server-fetch (re-download from the wiki).
		setWikiSyncDumpButtonsDisabled(true, "Lädt Dump herunter...");
		setWikiSyncStatus("Dump wird vom Wiki heruntergeladen …", "pending");
		await submitWikiSyncDumpAction("fetch_dump");

		// Step 2/4: the sandbox-safe scan loop (dryRun=true throughout).
		setWikiSyncDumpButtonsDisabled(true, "Liest Dump...");
		setWikiSyncStatus("WikiDump wird gelesen (Sandbox) …", "pending");
		await runWikiSyncDumpLoop("read_step");

		// Step 3/4: prune old sandbox state now that this scan succeeded. A cleanup
		// failure is reported but does NOT roll back the scan that already completed
		// (the scan's own success is real and independent of housekeeping).
		setWikiSyncDumpButtonsDisabled(true, "Räumt alte Dump-Stände auf...");
		setWikiSyncStatus("Alte Dump-Stände werden aufgeräumt …", "pending");
		await submitWikiSyncDumpAction("cleanup_state");

		// Step 4/4: reconcile the wiki publication sources into feature_sources now
		// that this dump's scan is the newest completed run. A failure here surfaces
		// via the same catch block below (steps 1-3 already succeeded and are not
		// rolled back).
		setWikiSyncDumpButtonsDisabled(true, "Übernimmt Publikationsquellen...");
		setWikiSyncStatus("Publikationsquellen werden übernommen …", "pending");
		const publicationsResult = await runWikiSyncPublicationsSyncLoop();
		const totals = (publicationsResult && publicationsResult.totals) || { added: 0, removed: 0, updated: 0, processed: 0 };
		const note = ` (+${Number(totals.added || 0)} / ~${Number(totals.updated || 0)} / -${Number(totals.removed || 0)})`;

		setWikiSyncStatus(`Dump geholt und Publikationsquellen übernommen.${note}`, "success");
		showFeedbackToast(`Dump geholt und Publikationsquellen übernommen.${note}`, "success");
		isWikiSyncDumpRunning = false;
		setWikiSyncDumpButtonsDisabled(false);
		await refreshWikiSyncDumpFetchedStatus();

		// Dump-Report: after a full run, open the in-editor self-test report so editors
		// can watch the code's self-tests go green/red in the browser (no shell on STRATO).
		// Fire-and-forget + fully guarded so a report bug can NEVER affect the dump flow.
		try { void avesmapsOpenDumpReport(); } catch (reportError) { console.error("Dump-Report:", reportError); }
	} catch (error) {
		console.error("Dump holen fehlgeschlagen:", error);
		isWikiSyncDumpRunning = false;
		setWikiSyncDumpButtonsDisabled(false);
		setWikiSyncStatus(error.message || "Dump holen fehlgeschlagen.", "error");
		showFeedbackToast(error.message || "Dump holen fehlgeschlagen.", "warning");
	}
}

// ===========================================================================
// Dump-Report: after a full "Dump holen" run, show the code's self-tests
// (api/edit/wiki/selftest.php) green/red in the browser -- editors have no shell
// on STRATO. Self-contained: the overlay is BUILT IN JS and appended to <body>,
// styled from the design tokens (css/base/tokens.css); it never touches index.html
// and the caller fires it guarded + fire-and-forget, so nothing here can affect
// the dump flow. Run statistics + the dump-vs-live comparison are a planned
// follow-up; this ships the self-test section. window.avesmapsOpenDumpReport is
// exposed so the report can also be opened manually.
// ===========================================================================
let avesmapsDumpReportStylesInjected = false;
function avesmapsDumpReportInjectStyles() {
	if (avesmapsDumpReportStylesInjected) {
		return;
	}
	avesmapsDumpReportStylesInjected = true;
	const css = `
.avm-dr-overlay{position:fixed;inset:0;z-index:var(--z-modal,5000);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto;background:rgba(40,28,14,.45);}
.avm-dr-card{position:relative;width:100%;max-width:720px;background:var(--color-panel);color:var(--color-text);border:1px solid var(--color-border);border-radius:var(--radius-lg,10px);box-shadow:var(--shadow-dialog,0 10px 30px rgba(0,0,0,.3));padding:20px 22px 16px;font-family:var(--font-ui,"Faculty Glyphic",sans-serif);}
.avm-dr-x{position:absolute;top:10px;right:12px;border:0;background:transparent;color:var(--color-text-muted);font-size:22px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:var(--radius-md,8px);}
.avm-dr-x:hover{background:var(--color-hover-wash,rgba(0,0,0,.06));}
.avm-dr-h1{font-size:var(--font-size-title,20px);font-weight:700;margin:0 0 3px;color:var(--color-text-strong);}
.avm-dr-meta{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:0;}
.avm-dr-h2{font-size:var(--font-size-caption,11px);font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-accent-strong);margin:18px 0 0;}
.avm-dr-rule{height:1px;background:var(--color-divider);margin:6px 0 12px;border:0;}
.avm-dr-summary{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:0 0 8px;}
.avm-dr-summary b{color:var(--color-text-strong);}
.avm-dr-tests{list-style:none;margin:0;padding:0;}
.avm-dr-tests li{padding:6px 0;border-bottom:1px solid var(--color-divider);}
.avm-dr-tests li:last-child{border-bottom:0;}
.avm-dr-row{display:flex;align-items:center;gap:10px;font-size:var(--font-size-small,12px);}
.avm-dr-name{flex:1;min-width:0;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.avm-dr-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:var(--radius-md,8px);white-space:nowrap;}
.avm-dr-pill.ok{color:var(--color-success-soft-text,#3c5a1c);background:var(--color-success-soft,#eef6e2);border:1px solid var(--color-success-soft-border,#a9c07f);}
.avm-dr-pill.bad{color:var(--color-danger-soft-text,#8a2d22);background:var(--color-danger-soft,#fbeae6);border:1px solid var(--color-danger-soft-border,#d3a79c);}
.avm-dr-pill.pending{color:var(--color-text-muted);background:var(--color-panel-soft);border:1px solid var(--color-border);}
.avm-dr-fail{margin:6px 0 0;padding:9px 11px;background:var(--color-danger-soft,#fbeae6);border-left:3px solid var(--color-danger,#9d3a2e);border-radius:0 var(--radius-md,8px) var(--radius-md,8px) 0;font-size:11px;color:var(--color-danger-soft-text,#8a2d22);white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;max-height:180px;overflow:auto;}
.avm-dr-note{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:16px 0 0;padding-top:12px;border-top:1px solid var(--color-divider);}
.avm-dr-foot{display:flex;gap:9px;flex-wrap:wrap;margin-top:11px;}
.avm-dr-btn{font:inherit;font-size:var(--font-size-body,13px);font-weight:700;border-radius:var(--radius-md,8px);padding:8px 15px;cursor:pointer;border:1px solid var(--color-button-soft-border);background:var(--color-button-soft);color:var(--color-button-soft-text);}
.avm-dr-btn.primary{background:var(--color-button);color:var(--color-button-text);border-color:var(--color-button-border);}
`;
	const style = document.createElement("style");
	style.id = "avm-dump-report-styles";
	style.textContent = css;
	document.head.appendChild(style);
}

function avesmapsDumpReportOnKey(event) {
	if (event.key === "Escape") {
		avesmapsDumpReportClose();
	}
}

function avesmapsDumpReportClose() {
	const overlay = document.getElementById("avm-dump-report-overlay");
	if (overlay && overlay.parentNode) {
		overlay.parentNode.removeChild(overlay);
	}
	document.removeEventListener("keydown", avesmapsDumpReportOnKey);
}

async function avesmapsDumpReportFetchJson(url) {
	const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
	let data = null;
	try {
		data = await response.json();
	} catch (parseError) {
		data = null;
	}
	return { status: response.status, data };
}

// Set the summary line from a bold lead + plain rest, via safe DOM (no innerHTML).
function avesmapsDumpReportSetSummary(el, boldText, restText) {
	el.textContent = "";
	if (boldText) {
		const strong = document.createElement("b");
		strong.textContent = boldText;
		el.appendChild(strong);
	}
	if (restText) {
		el.appendChild(document.createTextNode(restText));
	}
}

async function avesmapsDumpReportRunTests() {
	const listEl = document.getElementById("avm-dr-tests");
	const summaryEl = document.getElementById("avm-dr-summary");
	if (!listEl || !summaryEl) {
		return;
	}
	listEl.innerHTML = "";
	summaryEl.textContent = "Tests werden geprüft …";

	let manifest;
	try {
		manifest = await avesmapsDumpReportFetchJson("/api/edit/wiki/selftest.php?action=manifest");
	} catch (networkError) {
		avesmapsDumpReportSetSummary(summaryEl, "Test-Runner nicht erreichbar.");
		return;
	}
	if (manifest.status === 401 || manifest.status === 403) {
		avesmapsDumpReportSetSummary(summaryEl, "Editor-Login nötig", " — im Editor anmelden und erneut prüfen.");
		return;
	}
	if (!manifest.data || manifest.data.ok !== true || !Array.isArray(manifest.data.tests)) {
		const code = manifest.data && manifest.data.error ? manifest.data.error.code : "unbekannt";
		avesmapsDumpReportSetSummary(summaryEl, "Test-Liste nicht verfügbar", ` (${code}). Ist ein vollständiger Deploy gelaufen?`);
		return;
	}

	const tests = manifest.data.tests;
	let green = 0;
	let red = 0;
	summaryEl.textContent = `Läuft … 0/${tests.length}`;

	// One request per test, SEQUENTIAL -- gentle on STRATO (never fan out).
	for (let i = 0; i < tests.length; i++) {
		const test = tests[i];
		const li = document.createElement("li");
		const row = document.createElement("div");
		row.className = "avm-dr-row";
		const name = document.createElement("span");
		name.className = "avm-dr-name";
		name.textContent = test.label || test.key;
		const pill = document.createElement("span");
		pill.className = "avm-dr-pill pending";
		pill.textContent = "…";
		row.appendChild(name);
		row.appendChild(pill);
		li.appendChild(row);
		listEl.appendChild(li);

		let run;
		try {
			run = await avesmapsDumpReportFetchJson("/api/edit/wiki/selftest.php?action=run&test=" + encodeURIComponent(test.key));
		} catch (networkError) {
			run = { status: 0, data: null };
		}

		const d = run.data;
		if (d && d.ok === true && d.fatal === null && typeof d.passed === "number" && d.failed === 0) {
			pill.className = "avm-dr-pill ok";
			pill.textContent = `✓ ${d.passed}/${d.passed}`;
			green++;
		} else {
			red++;
			pill.className = "avm-dr-pill bad";
			if (d && typeof d.passed === "number" && typeof d.failed === "number") {
				pill.textContent = `✗ ${d.passed}/${d.passed + d.failed}`;
			} else if (run.status === 500 && d && d.error && d.error.code === "test_missing") {
				pill.textContent = "fehlt am Server";
			} else if (run.status === 401 || run.status === 403) {
				pill.textContent = "Login?";
			} else {
				pill.textContent = "Fehler";
			}

			const detail = document.createElement("div");
			detail.className = "avm-dr-fail";
			if (d && d.fatal) {
				detail.textContent = "FATAL: " + d.fatal;
			} else if (d && typeof d.output === "string" && d.output !== "") {
				const failLines = d.output.split("\n").filter((line) => /FAIL|RESULT|expected|actual/i.test(line));
				detail.textContent = (failLines.length ? failLines.join("\n") : d.output).slice(0, 4000);
			} else if (run.status === 500 && d && d.error && d.error.code === "test_missing") {
				detail.textContent = "Die Testdateien liegen noch nicht auf dem Server. Einmal einen vollständigen Deploy (GitHub Actions → „Deploy Avesmaps to STRATO“ → Run workflow) auslösen.";
			} else {
				detail.textContent = d && d.error && d.error.message ? d.error.message : "Unbekannter Fehler beim Ausführen des Tests.";
			}
			li.appendChild(detail);
		}
		summaryEl.textContent = `Läuft … ${i + 1}/${tests.length}`;
	}

	summaryEl.textContent = "";
	const totalB = document.createElement("b");
	totalB.textContent = String(tests.length);
	summaryEl.appendChild(totalB);
	summaryEl.appendChild(document.createTextNode(" Test-Dateien · "));
	const greenB = document.createElement("b");
	greenB.textContent = `${green} grün`;
	greenB.style.color = "var(--color-success)";
	summaryEl.appendChild(greenB);
	if (red) {
		summaryEl.appendChild(document.createTextNode(" · "));
		const redB = document.createElement("b");
		redB.textContent = `${red} rot`;
		redB.style.color = "var(--color-danger)";
		summaryEl.appendChild(redB);
	}
}

async function avesmapsOpenDumpReport() {
	try {
		avesmapsDumpReportInjectStyles();
		avesmapsDumpReportClose(); // replace any existing report (re-run / a second dump)

		const overlay = document.createElement("div");
		overlay.id = "avm-dump-report-overlay";
		overlay.className = "avm-dr-overlay";
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				avesmapsDumpReportClose();
			}
		});

		const card = document.createElement("div");
		card.className = "avm-dr-card";
		card.setAttribute("role", "dialog");
		card.setAttribute("aria-modal", "true");
		card.innerHTML = `
			<button class="avm-dr-x" type="button" aria-label="Schließen">×</button>
			<div class="avm-dr-h1">📜 Dump-Report</div>
			<p class="avm-dr-meta">Selbsttests nach dem Dump-Lauf</p>
			<div class="avm-dr-h2">Selbsttests</div>
			<hr class="avm-dr-rule">
			<p class="avm-dr-summary" id="avm-dr-summary">Tests werden geprüft …</p>
			<ul class="avm-dr-tests" id="avm-dr-tests"></ul>
			<p class="avm-dr-note">🛈 Reines Ansehen — nichts hier schreibt an der Karte.</p>
			<div class="avm-dr-foot">
				<button class="avm-dr-btn primary" id="avm-dr-ok" type="button">OK · schließen</button>
				<button class="avm-dr-btn" id="avm-dr-rerun" type="button">Tests erneut prüfen</button>
			</div>`;
		overlay.appendChild(card);
		document.body.appendChild(overlay);
		document.addEventListener("keydown", avesmapsDumpReportOnKey);

		card.querySelector(".avm-dr-x").addEventListener("click", avesmapsDumpReportClose);
		card.querySelector("#avm-dr-ok").addEventListener("click", avesmapsDumpReportClose);
		card.querySelector("#avm-dr-rerun").addEventListener("click", () => { void avesmapsDumpReportRunTests(); });

		await avesmapsDumpReportRunTests();
	} catch (error) {
		console.error("Dump-Report konnte nicht geöffnet werden:", error);
	}
}
if (typeof window !== "undefined") {
	window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;
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

// Static per-kind DOM wiring: button + progress + status + synced ids, and the tab's kind.
// `status` is the TRANSIENT "Syncen läuft … x/y" line (visible only while a sync is
// actively running, alongside `progress`); `synced` is the PERSISTENT "Zuletzt gesynct:
// <date>" label next to the button (mirrors the central block's #wiki-sync-dump-fetched-status,
// stays visible once known instead of hiding with the transient run status).
const WIKI_SYNC_KIND_ELEMENTS = {
	settlement: { button: "wiki-sync-sync-settlement", progress: "wiki-sync-sync-settlement-progress", status: "wiki-sync-sync-settlement-status", synced: "wiki-sync-sync-settlement-synced" },
	path: { button: "wiki-sync-sync-path", progress: "wiki-sync-sync-path-progress", status: "wiki-sync-sync-path-status", synced: "wiki-sync-sync-path-synced" },
	region: { button: "wiki-sync-sync-region", progress: "wiki-sync-sync-region-progress", status: "wiki-sync-sync-region-status", synced: "wiki-sync-sync-region-synced" },
};

// Only one kind syncs at a time (they share the single-flight dump pipeline lock
// server-side; a second would 409). This guards the frontend from starting two.
let isWikiSyncKindSyncRunning = false;

// Owner instruction 2026-07-19: a long-running action reports IN its own button -- the label, the
// progress fill and the blocked state all live there, and there is NO status field anywhere. Every
// element that unfolds on click pushes the page down while the user is already aiming at the next
// control; this panel had grown twenty of them.
//
// The idle label is remembered on first use so the button can always find its way back.
function setWikiSyncButtonState(button, { label = "", current = 0, total = 0, tone = "", running = false } = {}) {
	if (!button) {
		return;
	}
	if (!button.dataset.idleLabel) {
		button.dataset.idleLabel = button.textContent.trim();
	}
	const text = label || button.dataset.idleLabel;
	// Kachel-Optik: eine Beschriftung der Form "Titel — Zusatz" wird zweizeilig gesetzt, Titel oben,
	// Zusatz klein darunter. Einzeilige Beschriftungen bleiben exakt wie bisher, deshalb ist das für
	// alle anderen Knöpfe wirkungslos. Grund: "📥 Dump holen — zuletzt 19.07.2026, 03:12" passte in
	// einer Zeile nicht mehr in die Kachel und wurde abgeschnitten (Owner 2026-07-21).
	const split = text.split(" — ");
	if (split.length === 2) {
		button.textContent = "";
		const title = document.createElement("span");
		title.className = "t1";
		title.textContent = split[0];
		const note = document.createElement("span");
		note.className = "t2";
		note.textContent = split[1];
		button.append(title, note);
	} else {
		button.textContent = text;
	}
	// Busy IS blocked -- one source of truth, so the two can never disagree.
	button.disabled = running;
	const totalValue = Number(total);
	const pct = totalValue > 0 ? Math.max(0, Math.min(100, (Number(current) / totalValue) * 100)) : 0;
	button.style.setProperty("--wsb-progress", pct.toFixed(1) + "%");
	if (tone) {
		button.dataset.tone = tone;
	} else {
		delete button.dataset.tone;
	}
}

function wikiSyncKindButton(kind) {
	const ids = WIKI_SYNC_KIND_ELEMENTS[kind];
	return ids ? document.getElementById(ids.button) : null;
}

function setWikiSyncKindButtonsDisabled(isDisabled, activeKind = null) {
	Object.keys(WIKI_SYNC_KIND_ELEMENTS).forEach((kind) => {
		const button = wikiSyncKindButton(kind);
		if (!button || (isDisabled && kind === activeKind)) {
			return; // the active kind is driven by renderWikiSyncKindProgress -- don't fight it
		}
		button.disabled = isDisabled;
		if (!isDisabled) {
			setWikiSyncButtonState(button, {});
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
	const button = wikiSyncKindButton(kind);
	if (!button) {
		return;
	}
	// An error also gets a toast: it overlays instead of pushing, and it survives the button
	// returning to its idle label. A failure must not be readable ONLY for as long as nobody
	// clicks anything else.
	if (tone === "error" && typeof showFeedbackToast === "function") {
		showFeedbackToast(message, "error");
	}
	setWikiSyncButtonState(button, { label: message, tone, running: false });
}

function renderWikiSyncKindProgress(kind, progress, done, run, phase = "staging") {
	const ids = WIKI_SYNC_KIND_ELEMENTS[kind];
	if (!ids) {
		return;
	}
	const button = wikiSyncKindButton(kind);
	if (!button) {
		return;
	}

	const processed = Number(progress?.processed ?? 0);
	const total = Number(progress?.total ?? 0);

	if (done) {
		// Idle again: the button drops back to its plain label, and the fresh DATE goes into the field
		// beside it -- the same second raster column Siedlungen/Territorien/Abenteuer/Karten use
		// (Owner 2026-07-19). The button keeps owning the RUNNING state; only the persistent date lives
		// outside it, so a tab reads identically after a run and after a reload.
		setWikiSyncButtonState(button, { label: "🚨 Syncen", running: false });
		button.dataset.idleLabel = button.textContent;
		const syncedElement = document.getElementById(ids.synced);
		if (syncedElement) {
			syncedElement.textContent = formatWikiSyncKindSyncedText(run);
			syncedElement.hidden = false;
		}
		return;
	}

	setWikiSyncButtonState(button, {
		label: phase === "conflict_gen"
			? (total > 0 ? `Konfliktanalyse … ${processed}/${total}` : "Konfliktanalyse …")
			: (total > 0 ? `Syncen … ${processed}/${total}` : "Syncen …"),
		current: processed,
		total,
		running: true,
	});
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

// ===========================================================================
// Publikationsquellen übernehmen (Wave 2): the SHARP reconcile of the wiki
// publication sources built during "Dump holen" into feature_sources
// (origin='wiki_publication'). Cross-kind: folded into "Dump holen" as its
// step 4/4 (see startWikiSyncDumpRead) rather than a separate trigger, driving
// the backend `sync_publications` action via the SAME one-POST-per-step client
// loop the dump read / per-kind Syncen use (runWikiSyncDumpLoop pattern). It
// reconciles all four entity types (territory/settlement/region/path) over a
// (segment, id high-water) cursor; the override guarantee (never touch a
// manual/community/suppressed source) lives entirely in the backend diff.
// Backend: api/edit/wiki/dump.php (sync_publications).
// ===========================================================================

// Render the central publication-reconcile progress bar + status line from a step
// response. The step returns per-step link deltas; `totals` carries the run-summed
// counters the loop accumulates (each step starts its counters at 0, like the
// settlement conflict-gen phase). The 4 segments drive the coarse progress bar.
function renderWikiSyncPublicationsProgress(step, done, totals) {
	// This is step 4/4 of "Dump holen", so it reports in THAT button -- it has no control of its
	// own, and inventing a status line for it is exactly what made the panel jump.
	const button = document.getElementById("wiki-sync-dump-read");
	if (!button) {
		return;
	}
	const segment = Number(step?.segment ?? 0);
	const totalRaw = Number(step?.progress?.total ?? 4);
	const totalSegments = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 4;

	if (done) {
		// The summary is a result, not a state: it goes to the toast, which overlays instead of
		// pushing, and the button drops back to its resting label.
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(
				`Publikationsquellen: +${totals.added} neu / ~${totals.updated} aktualisiert / -${totals.removed} entfernt (${totals.processed} geprüft).`,
				"success"
			);
		}
		setWikiSyncButtonState(button, { label: "📥 Dump holen", running: false });
		button.dataset.idleLabel = "📥 Dump holen";
		return;
	}

	const shown = Math.min(segment + 1, totalSegments);
	setWikiSyncButtonState(button, {
		label: `Publikationsquellen … ${shown}/${totalSegments} (${totals.processed} geprüft)`,
		current: segment,
		total: totalSegments,
		running: true,
	});
}

// Drive `sync_publications` to completion: loop the action once per step, advancing
// the server-returned (segment, cursor) high-water mark and SUMMING the per-step link
// deltas until done. Mirrors runWikiSyncKindSyncLoop (bounded step ceiling; stops
// cleanly on the 409 pipeline lock). Reads staging + live DB only (no dump reopen).
async function runWikiSyncPublicationsSyncLoop() {
	let segment = 0;
	let cursor = 0;
	let done = false;
	let safetyCounter = 0;
	let lastResult = null;
	const totals = { added: 0, removed: 0, updated: 0, processed: 0 };
	// Four segments, each drained in id-high-water batches; a generous ceiling still
	// bounds the loop so a backend bug can never spin forever (STRATO).
	const MAX_STEPS = 4000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("Publikationsquellen-Übernahme wurde nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction("sync_publications", { segment, cursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				// Another editor holds the dump pipeline: stop immediately (do NOT retry).
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			throw error;
		}

		lastResult = stepResult;
		segment = Number(stepResult.segment ?? segment);
		cursor = Number(stepResult.cursor ?? cursor);
		totals.added += Number(stepResult.links_added ?? 0);
		totals.removed += Number(stepResult.links_removed ?? 0);
		totals.updated += Number(stepResult.links_updated ?? 0);
		totals.processed += Number(stepResult.processed ?? 0);
		done = stepResult.done === true;
		renderWikiSyncPublicationsProgress(stepResult, done, totals);
	}

	if (lastResult && typeof lastResult === "object") {
		lastResult.totals = totals;
	}
	return lastResult;
}

// ===========================================================================
// ===========================================================================
// „Kraftlinien syncen": der SCHARFE Abgleich der beim „Dump holen" gesammelten
// Kraftlinien-Artikel auf die Kraftlinien der Karte. Zugeordnet wird über den
// NAMEN -- eine Kraftlinie liegt als viele Segmente vor, die nur ihr Name
// zusammenhält (dieselbe 1-zu-N-Form wie bei Straßen).
//
// EIN Request, keine Schrittschleife: 23 Artikel gegen 162 Segmente passen in
// eine Anfrage. Die Geschwister (Lore ~5.100 Einträge) brauchen den Cursor, hier
// wäre er Zeremonie.
//
// Die Override-Garantie liegt im Backend und ist unit-getestet: geschrieben wird
// AUSSCHLIESSLICH properties.wiki_powerline; von Hand gesetzte Wiki-Links und
// Beschreibungen werden nie angefasst.
// Backend: api/edit/wiki/dump.php (sync_powerlines).
// ===========================================================================

let isWikiSyncPowerlinesRunning = false;

async function startWikiSyncPowerlines() {
	if (isWikiSyncPowerlinesRunning) {
		return;
	}
	isWikiSyncPowerlinesRunning = true;
	const button = document.getElementById("wiki-sync-powerlines-sync");
	if (button) {
		button.disabled = true;
	}
	// Capture the final { type, message } and return it so a caller in the editor iframe can show it
	// there -- the panel status sits behind the editor overlay, where the owner never sees it.
	let finalStatus = null;
	const report = (message, type) => { setWikiSyncStatus(message, type); finalStatus = { message, type }; };
	report("Kraftlinien werden abgeglichen …", "pending");
	try {
		const result = await submitWikiSyncDumpAction("sync_powerlines", {});
		const staged = Number(result.staged ?? 0);
		if (staged === 0) {
			// Leeres Ergebnis ist ein ZUSTAND, kein Fehler -- aber WELCHE Schicht leer ist,
			// gehört dazu, sonst sucht der Owner am falschen Ende. sandbox_rows unterscheidet
			// „Dump hat nichts abgelegt" von „Parser hat alles verworfen".
			const sandbox = Number(result.sandbox_rows ?? 0);
			const runDate = String(result.run_completed_at ?? "").trim();
			if (sandbox === 0) {
				// Ist der NEUESTE Dump-Lauf auf „running" hängengeblieben, ist er abgestürzt
				// (der Status kennt kein „error"). Dann ist die abgelesene completed-Zeile alt,
				// und die Phase des hängenden Laufs sagt, WO „Dump holen" stirbt.
				const latestStatus = String(result.latest_run_status ?? "").trim();
				const latestPhase = String(result.latest_run_phase ?? "").trim();
				const latestUpd = String(result.latest_run_updated_at ?? "").trim();
				if (latestStatus === "running") {
					report(
						`„Dump holen“ ist abgestürzt: der neueste Lauf hängt seit ${latestUpd || "?"} in Phase „${latestPhase || "?"}“ `
						+ `(gelesen wurde der letzte VOLLSTÄNDIGE Lauf${runDate ? ` vom ${runDate}` : ""}). Bitte diese Phase melden.`,
						"error"
					);
				} else {
					report(
						`Der Dump-Lauf${runDate ? ` vom ${runDate}` : ""} hat keine Kraftlinien abgelegt. `
						+ "Bitte „📥 Dump holen“ erneut laufen lassen (der Lauf muss nach dem 22.07. sein) und dann erneut syncen.",
						"error"
					);
				}
			} else {
				report(
					`${sandbox} Kraftlinien im Zwischenspeicher, aber keine ließ sich auswerten — bitte melden. `
					+ `(Lauf ${result.run_id ?? "?"}${runDate ? `, ${runDate}` : ""})`,
					"error"
				);
			}
			return finalStatus;
		}
		const linked = Number(result.linked ?? 0);
		const updated = Number(result.updated ?? 0);
		const cleared = Number(result.cleared ?? 0);
		const unmatched = Array.isArray(result.unmatched_names) ? result.unmatched_names : [];
		const parts = [
			`${staged} Wiki-Kraftlinien`,
			`${Number(result.matched_names ?? 0)} zugeordnet`,
			`${linked} neu verknüpft`,
			`${updated} aktualisiert`,
		];
		if (cleared > 0) {
			parts.push(`${cleared} gelöst`);
		}
		// Nicht zugeordnete Artikel BEIM NAMEN nennen: fast immer eine Schreibweise, die
		// abweicht ("Brücke nach/von Akrabaal") -- das ist eine Editor-Aufgabe, kein Fehler.
		if (unmatched.length > 0) {
			const shown = unmatched.slice(0, 6).join(", ");
			parts.push(`ohne Gegenstück auf der Karte: ${shown}${unmatched.length > 6 ? " …" : ""}`);
		}
		// Bewusst KEIN Nachladen: die Kartendaten holt loadRouteData() einmal beim Start, ein
		// zweiter Aufruf würde Layer doppeln. Der Hinweis ist ehrlicher als ein erfundener
		// Nachladepfad -- die neuen Wiki-Zeilen stehen nach einem Neuladen im Infopanel.
		report(`Kraftlinien abgeglichen — ${parts.join(" · ")}. Seite neu laden, um sie im Infopanel zu sehen.`, "success");
		// Übersichts-Leiste sofort auffrischen: der Reconcile hat gerade „zuletzt gesynct" in app_setting
		// gestempelt, also soll die „Kraftlinien"-Zelle ihr Datum ohne Neuladen zeigen (holt
		// ?action=last_synced neu und zeichnet die Leiste via renderWikiSyncSubjectRail).
		void refreshWikiSyncKindSyncedStatus();
	} catch (error) {
		console.error("Kraftlinien-Abgleich fehlgeschlagen:", error);
		report(error?.message || "Der Kraftlinien-Abgleich ist fehlgeschlagen.", "error");
	} finally {
		isWikiSyncPowerlinesRunning = false;
		if (button) {
			button.disabled = false;
		}
	}
	return finalStatus;
}

// Abenteuer syncen (Phase 4): the SHARP reconcile of the wiki adventure catalog
// (built during "Dump holen") into the live adventure/adventure_place tables.
// UNLIKE publications (folded into "Dump holen"), this is its OWN "Abenteuer"-tab
// button so the owner can re-run just the adventure reconcile. Drives the backend
// `sync_adventures` action via the same one-POST-per-step client loop; the override
// guarantee (never touch a manual/community/suppressed row) lives entirely in the
// backend diff, and any new cover is fetched into /uploads/questcovers server-side.
// Backend: api/edit/wiki/dump.php (sync_adventures).
// ===========================================================================

let isWikiSyncAdventuresRunning = false;

// Render the adventure-reconcile progress bar + status line from a step response.
// `totals` carries the run-summed counters the loop accumulates (each step's counters
// start at 0). progress.total is the staging catalog size (the "N Abenteuer geprüft" cap).
function renderWikiSyncAdventuresProgress(step, done, totals) {
	const button = document.getElementById("wiki-sync-sync-adventure");
	if (!button) {
		return;
	}
	const processed = Number(totals?.processed ?? 0);
	const total = Number(step?.progress?.total ?? 0);

	if (done) {
		// A result, not a state -- the toast overlays instead of pushing the tabs down.
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(
				`Abenteuer: +${totals.created} neu / ~${totals.updated} aktualisiert · Orte +${totals.placesAdded}/-${totals.placesRemoved} · ${totals.coversFetched} Cover (${totals.processed} geprüft).`,
				"success"
			);
		}
		setWikiSyncButtonState(button, { label: "🚨 Syncen", running: false });
		button.dataset.idleLabel = "🚨 Syncen";
		return;
	}

	setWikiSyncButtonState(button, {
		label: `Syncen … ${processed}${total > 0 ? "/" + total : ""} Abenteuer`,
		current: processed,
		total,
		running: true,
	});
}

// Drive `sync_adventures` to completion: loop the action once per step, advancing the
// server-returned wiki_key high-water `cursor` (a STRING) and SUMMING the per-step deltas
// until done. Mirrors runWikiSyncPublicationsSyncLoop (bounded step ceiling; stops cleanly
// on the 409 pipeline lock). Reads staging + live DB only (no dump reopen).
async function runWikiSyncAdventuresSyncLoop() {
	let cursor = "";
	let done = false;
	let safetyCounter = 0;
	let lastResult = null;
	const totals = { created: 0, updated: 0, placesAdded: 0, placesRemoved: 0, placesUpdated: 0, coversFetched: 0, processed: 0 };
	const MAX_STEPS = 4000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("Abenteuer-Übernahme wurde nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction("sync_adventures", { cursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				// Another editor holds the dump pipeline: stop immediately (do NOT retry).
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			throw error;
		}

		lastResult = stepResult;
		cursor = String(stepResult.cursor ?? cursor);
		totals.created += Number(stepResult.adv_created ?? 0);
		totals.updated += Number(stepResult.adv_updated ?? 0);
		totals.placesAdded += Number(stepResult.places_added ?? 0);
		totals.placesRemoved += Number(stepResult.places_removed ?? 0);
		totals.placesUpdated += Number(stepResult.places_updated ?? 0);
		totals.coversFetched += Number(stepResult.covers_fetched ?? 0);
		totals.processed += Number(stepResult.processed ?? 0);
		done = stepResult.done === true;
		renderWikiSyncAdventuresProgress(stepResult, done, totals);
	}

	if (lastResult && typeof lastResult === "object") {
		lastResult.totals = totals;
	}
	return lastResult;
}

// The "Abenteuer"-tab "Syncen" button handler: guard against a double-run, disable the
// button, drive the loop, then refresh the persistent "Zuletzt gesynct" label.
async function startWikiSyncAdventuresSync() {
	if (isWikiSyncAdventuresRunning) {
		return;
	}
	isWikiSyncAdventuresRunning = true;
	const button = document.getElementById("wiki-sync-sync-adventure");
	if (button) {
		button.disabled = true;
	}
	setWikiSyncStatus("Abenteuer werden übernommen …", "pending");

	try {
		const result = await runWikiSyncAdventuresSyncLoop();
		const totals = (result && result.totals) || { created: 0, updated: 0, coversFetched: 0 };
		const note = ` (+${totals.created} neu / ~${totals.updated} aktualisiert / ${totals.coversFetched} Cover)`;
		setWikiSyncStatus(`Abenteuer übernommen.${note}`, "success");
		showFeedbackToast(`Abenteuer übernommen.${note}`, "success");
		if (typeof refreshWikiSyncKindSyncedStatus === "function") {
			try {
				await refreshWikiSyncKindSyncedStatus();
			} catch (refreshError) {
				/* best-effort: the persistent label refresh is non-critical */
			}
		}
	} catch (error) {
		if (!(error && error.dumpLocked)) {
			setWikiSyncStatus(error.message || "Abenteuer-Übernahme fehlgeschlagen.", "error");
			showFeedbackToast(error.message || "Abenteuer-Übernahme fehlgeschlagen.", "warning");
		}
	} finally {
		isWikiSyncAdventuresRunning = false;
		if (button) {
			button.disabled = false;
		}
	}
}

// ===========================================================================
// Karten syncen (Kartensammlung, pipeline stages 1+2): the SHARP reconcile of the
// wiki citymap catalog (built during "Dump holen") into the live citymap/
// citymap_place tables. Drives the backend `sync_citymaps` action via the same
// one-POST-per-step client loop as sync_adventures.
//
// UNLIKE the adventure loop this has NO ribbon button and therefore no progress
// bar to render into: the only trigger is "Karten syncen" in the citymap editor's
// header, which delegates here via window.parent (owner decision). The loop lives
// HERE anyway, next to its sibling, so there is exactly ONE sync_citymaps loop in
// the app rather than a second copy inside the editor iframe -- the same reasoning
// the adventure editor's #aeSyncBtn comment spells out.
//
// The override guarantee (never touch a manual/community/suppressed row, never
// resurrect a tombstone, never duplicate on a re-run) lives entirely in the backend
// diff (avesmapsCitymapReconcilePlan). Backend: api/edit/wiki/dump.php (sync_citymaps).
// ===========================================================================

let isWikiSyncCitymapsRunning = false;

// Drive `sync_citymaps` to completion: loop the action once per step, advancing the
// server-returned wiki_key high-water `cursor` (a STRING) and SUMMING the per-step
// deltas until done. Mirrors runWikiSyncAdventuresSyncLoop (bounded step ceiling;
// stops cleanly on the 409 pipeline lock). Reads staging + live DB only (no dump reopen).
async function runWikiSyncCitymapsSyncLoop() {
	let cursor = "";
	let done = false;
	let safetyCounter = 0;
	let lastResult = null;
	const totals = { created: 0, updated: 0, placesAdded: 0, placesUpdated: 0, sourcesLinked: 0, linksWritten: 0, removed: 0, processed: 0 };
	const MAX_STEPS = 4000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("Karten-Übernahme wurde nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction("sync_citymaps", { cursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				// Another editor holds the dump pipeline: stop immediately (do NOT retry).
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			throw error;
		}

		lastResult = stepResult;
		cursor = String(stepResult.cursor ?? cursor);
		totals.created += Number(stepResult.created ?? 0);
		totals.updated += Number(stepResult.updated ?? 0);
		totals.placesAdded += Number(stepResult.places_added ?? 0);
		totals.placesUpdated += Number(stepResult.places_updated ?? 0);
		totals.sourcesLinked += Number(stepResult.sources_linked ?? 0);
		totals.linksWritten += Number(stepResult.links_written ?? 0);
		totals.removed += Number(stepResult.removed ?? 0);
		totals.processed += Number(stepResult.processed ?? 0);
		done = stepResult.done === true;

		const total = Number(stepResult?.progress?.total ?? 0);
		setWikiSyncStatus(
			`Karten werden übernommen … ${totals.processed}${total > 0 ? "/" + total : ""} geprüft`,
			"pending"
		);
	}

	if (lastResult && typeof lastResult === "object") {
		lastResult.totals = totals;
	}
	return lastResult;
}

// Entry point. Global on purpose: html/citymap-editor.html runs in an iframe and calls
// window.parent.startWikiSyncCitymapsSync(). Re-entrancy guarded, so a double click is a no-op.
async function startWikiSyncCitymapsSync() {
	if (isWikiSyncCitymapsRunning) {
		return;
	}
	isWikiSyncCitymapsRunning = true;
	setWikiSyncStatus("Karten werden übernommen …", "pending");

	try {
		const result = await runWikiSyncCitymapsSyncLoop();
		const totals = (result && result.totals) || { created: 0, updated: 0, removed: 0, placesAdded: 0, placesUpdated: 0, sourcesLinked: 0, linksWritten: 0 };
		const note = ` (+${totals.created} neu / ~${totals.updated} aktualisiert / -${totals.removed} entfernt · Orte +${totals.placesAdded}/~${totals.placesUpdated} · ${totals.sourcesLinked} Quellen / ${totals.linksWritten} Fundstellen)`;
		setWikiSyncStatus(`Karten übernommen.${note}`, "success");
		showFeedbackToast(`Karten übernommen.${note}`, "success");
	} catch (error) {
		if (!(error && error.dumpLocked)) {
			setWikiSyncStatus(error.message || "Karten-Übernahme fehlgeschlagen.", "error");
			showFeedbackToast(error.message || "Karten-Übernahme fehlgeschlagen.", "warning");
		}
		throw error; // the editor's button shows its own failure text
	} finally {
		isWikiSyncCitymapsRunning = false;
	}
}

// ===========================================================================
// „Vorkommen syncen" (called „Natur & Waren" until 2026-07-22): the SHARP reconcile of the wiki lore catalog (flora,
// fauna, species, trade goods — built during „Dump holen") into the live
// lore_entry / lore_place tables -- and, per entry, its sources into the SHARED
// feature_sources (entity_type='lore'). Drives the backend `sync_lore`
// action via the same one-POST-per-step client loop as sync_citymaps.
//
// The catalog holds ~5.100 entries with ~7.750 place links and ~35.000 source
// references, so the server hands back 150 rows per step — expect roughly 35
// round trips. That is deliberate: one big request would saturate the STRATO PHP
// workers (CLAUDE.md), which once looked exactly like a database outage.
//
// The override guarantee (never touch a manual row, never resurrect a suppressed
// tombstone, never duplicate on a re-run) lives entirely in the backend diff
// (avesmapsLoreChildPlan / avesmapsLoreFieldPlan, both unit-tested).
// Backend: api/edit/wiki/dump.php (sync_lore).
// ===========================================================================

let isWikiSyncLoreRunning = false;

// Drive `build_lore_staging` to completion: walks the CACHED dump and fills the lore
// staging tables. Runs before the reconcile so the button works on its own, without
// requiring a full „Dump holen" pass first -- the lore phase sits 8th of 10 there, so
// a run that stops early never reaches it. Idempotent (upserts), and the dump is not
// re-downloaded while the cached copy is under 24h old.
async function runWikiSyncLoreBuildLoop(onProgress) {
	let cursor = 0;
	let done = false;
	let guard = 0;
	let pages = 0;
	let found = 0;
	const MAX_STEPS = 2000;

	while (!done) {
		if (guard > MAX_STEPS) {
			throw new Error("Lore-Staging-Aufbau wurde nach zu vielen Teilschritten angehalten.");
		}
		guard += 1;

		let step;
		try {
			step = await submitWikiSyncDumpAction("build_lore_staging", { cursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
			}
			throw error;
		}

		cursor = Number(step.cursor ?? cursor);
		pages += Number(step.pages_scanned ?? 0);
		found += Number(step.found_this_step ?? 0);
		done = step.done === true;

		const label = `${pages.toLocaleString("de-DE")} Seiten · ${found.toLocaleString("de-DE")} Einträge`;
		setWikiSyncStatus(`Dump wird gelesen … ${label}`, "pending");
		if (typeof onProgress === "function") {
			onProgress(label);
		}
	}

	return { pages, found };
}

// Drive `sync_lore` to completion: one action call per step, advancing the
// server-returned wiki_key high-water `cursor` (a STRING) and SUMMING the per-step
// deltas until done. Mirrors runWikiSyncCitymapsSyncLoop, including the clean stop
// on the 409 pipeline lock. Reads staging + live DB only (no dump reopen).
async function runWikiSyncLoreSyncLoop(onProgress) {
	let cursor = "";
	let done = false;
	let safetyCounter = 0;
	let lastResult = null;
	const totals = {
		added: 0, updated: 0, unchanged: 0, retired: 0,
		placesAdded: 0, placesRemoved: 0, placesSuppressed: 0,
		sourcesAdded: 0, sourcesRemoved: 0, sourcesUpdated: 0, sourcesStagingEmpty: false, processed: 0,
	};
	const MAX_STEPS = 4000;

	while (!done) {
		if (safetyCounter > MAX_STEPS) {
			throw new Error("Natur-&-Waren-Übernahme wurde nach zu vielen Teilschritten angehalten.");
		}
		safetyCounter += 1;

		let stepResult;
		try {
			stepResult = await submitWikiSyncDumpAction("sync_lore", { cursor });
		} catch (error) {
			if (error && error.dumpLocked) {
				// Another editor holds the dump pipeline: stop immediately (do NOT retry).
				setWikiSyncStatus(error.message || "Ein anderer Nutzer bearbeitet gerade den WikiDump - bitte warten.", "error");
				throw error;
			}
			throw error;
		}

		// An empty staging table is a USER-fixable state, not a crash: it just means
		// „Dump holen" has not run yet. Say so instead of looping on nothing.
		if (stepResult && stepResult.staging_empty === true) {
			throw new Error("Kein Lore-Staging vorhanden – „Dump holen“ muss einmal KOMPLETT durchlaufen (die lore-Phase steht an 8. von 10 Stellen).");
		}

		lastResult = stepResult;
		cursor = String(stepResult.cursor ?? cursor);
		totals.added += Number(stepResult.entries_added ?? 0);
		totals.updated += Number(stepResult.entries_updated ?? 0);
		totals.unchanged += Number(stepResult.entries_unchanged ?? 0);
		totals.retired += Number(stepResult.entries_retired ?? 0);
		totals.placesAdded += Number(stepResult.places_added ?? 0);
		totals.placesRemoved += Number(stepResult.places_removed ?? 0);
		totals.placesSuppressed += Number(stepResult.places_suppressed ?? 0);
		totals.sourcesAdded += Number(stepResult.sources_added ?? 0);
		totals.sourcesRemoved += Number(stepResult.sources_removed ?? 0);
		totals.sourcesUpdated += Number(stepResult.sources_updated ?? 0);
		// KEIN Summieren: das ist eine Aussage über den Bestand, kein Zähler. Sobald ein
		// Schritt meldet, dass das Quellen-Staging fehlt, gilt das für den ganzen Lauf.
		if (stepResult.sources_staging_empty === true) { totals.sourcesStagingEmpty = true; }
		totals.processed += Number(stepResult.processed ?? 0);
		done = stepResult.done === true;

		const total = Number(stepResult?.progress?.total ?? 0);
		const label = `${totals.processed}${total > 0 ? "/" + total : ""}`;
		setWikiSyncStatus(`Vorkommen werden übernommen … ${label} geprüft`, "pending");
		if (typeof onProgress === "function") {
			onProgress(label);
		}
	}

	if (lastResult && typeof lastResult === "object") {
		lastResult.totals = totals;
	}
	return lastResult;
}

// ===========================================================================
// Fenster „Vorkommen" (bis 2026-07-22 „Natur & Waren"). Der Reiter zeigt nur noch EINEN Knopf, der dieses
// Fenster öffnet; syncen und bearbeiten passieren ausschließlich darin.
//
// WARUM: Der Sync-Knopf saß direkt im Reiter und startete beim ersten Klick einen
// mehrminütigen Lauf -- eine schwere Owner-Aktion ohne Zwischenschritt. Gleichzeitig
// war der Editor (Klick auf eine Listenzeile) darunter so unauffällig, dass er am
// 2026-07-22 als „fehlt noch" gemeldet wurde, obwohl er live und funktionsfähig war.
// Ein Fenster löst beides: der Einstieg ist harmlos, und drinnen liegt alles offen.
//
// 💣 Der Inhalt wird VERSCHOBEN, nicht kopiert. Ein Duplikat hätte jede id doppelt im
// DOM -- getElementById träfe das falsche Element, und die Bindung aus bootstrap.js
// (die am ELEMENT hängt, nicht an der id) liefe ins Leere. Dasselbe Verfahren wie beim
// Umzug der Konfliktliste, siehe Kommentar in index.html.
// ===========================================================================

function moveLoreSectionIntoDialog() {
	var body = document.getElementById("wiki-sync-lore-dialog-body");
	var detail = document.getElementById("lore-detail");
	// Der Sync-Knopf steht im Markup VERSTECKT im Reiter, damit bootstrap.js ihn beim Start
	// binden kann (die Bindung hängt am ELEMENT, nicht an der id). Sichtbar wird er erst
	// hier: als erste Kachel des Menübands, seinem einzigen erlaubten Platz. Im Reiter darf
	// er nicht auftauchen -- ein Klick dort würde den Lauf starten, den der Einstiegsknopf
	// gerade verhindern soll.
	var ribbon = document.getElementById("lore-ribbon");
	var syncButton = document.getElementById("wiki-sync-sync-lore");
	if (ribbon && syncButton && syncButton.parentElement !== ribbon) {
		ribbon.insertBefore(syncButton, ribbon.firstChild);
		syncButton.hidden = false;
	}
	// Ziel ist die RECHTE Spalte, nicht der Fensterkörper: links steht die Auswahlliste,
	// rechts wird bearbeitet -- wie im Karteneditor.
	body = document.getElementById("lore-dlg-edit") || body;
	if (!body || !detail || detail.parentElement === body) {
		return; // schon umgezogen (oder Markup fehlt)
	}
	// NUR die Bearbeitungsmaske zieht um. Knopfzeile, Datum, Reiter und Liste BLEIBEN im
	// Panel -- genau wie bei Abenteuern, Karten und Siedlungen. Eine erste Fassung hat den
	// ganzen Abschnitt ins Fenster geschoben; damit war der Reiter leer, und das Datum stand
	// nicht mehr in der zweiten Rasterspalte neben dem Knopf, wo es bei allen sechs Reitern
	// steht. Konsistenz schlägt hier die Idee, alles an einem Ort zu bündeln.
	body.appendChild(detail);
}

/**
 * Die vier Menüband-Schalter auf den Serverzustand setzen.
 *
 * `Spezies` steht per Default auf AUS (das Wiki-Feld „Regionen" ist zu schlecht gepflegt,
 * Owner-Entscheid). Das stand früher als HTML-Kommentar im Markup — jetzt ist es ein
 * Schalter, den der Owner ohne Codeänderung umlegen kann.
 */
function renderLoreKindToggles(kinds) {
	if (!kinds) {
		return;
	}
	document.querySelectorAll("[data-lore-toggle]").forEach(function (button) {
		var kind = button.getAttribute("data-lore-toggle");
		if (!(kind in kinds)) {
			return;
		}
		var on = !!kinds[kind];
		// Nur die OBERE Zeile (.t1) wird geschrieben. Ein textContent auf den Knopf würde
		// beide Spans der Kachel ersetzen und die Zweizeiligkeit zerstören.
		var title = button.querySelector(".t1") || button;
		var label = button.getAttribute("data-lore-label")
			|| title.textContent.replace(/:\s*(AN|AUS)\s*$/, "").trim();
		button.setAttribute("data-lore-label", label);
		button.setAttribute("aria-pressed", on ? "true" : "false");
		button.classList.toggle("is-off", !on);
		title.textContent = label + ": " + (on ? "AN" : "AUS");
	});
}

function setWikiSyncLoreDialogOpen(isOpen) {
	var overlay = document.getElementById("wiki-sync-lore-overlay");
	// War das Fenster schon offen? Dann NICHT neu laden. openLoreDetail ruft hier durch,
	// also feuerte sonst jeder Klick auf eine Listenzeile einen weiteren Katalogabruf über
	// 200 Einträge -- und ersetzte dabei die Zeile, die man gerade angeklickt hat, unter dem
	// Cursor. Auf STRATO ist ein Request pro Klick kein Rundungsfehler.
	var wasOpen = !!overlay && !overlay.hidden;
	if (isOpen) {
		moveLoreSectionIntoDialog();
	}
	$("#wiki-sync-lore-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();
	if (isOpen && wasOpen) {
		return;
	}
	if (isOpen) {
		document.getElementById("wiki-sync-lore-dialog")?.focus();
		// Nur LESEN (GET api/app/lore.php?catalog=1): füllt Liste, Reiterzahlen und den
		// „zuletzt gesynct"-Stempel. Startet ausdrücklich KEINEN Sync -- der hängt allein
		// am Knopf #wiki-sync-sync-lore im Fenster.
		loadLoreList("dialog");
	}
}

/**
 * Fortschritt in die UNTERE Zeile der Sync-Kachel schreiben.
 *
 * 💣 Die Kachel besteht aus zwei Spans (.t1 Titel, .t2 Status) wie im Abenteuer- und
 * Karteneditor. Ein textContent auf den Knopf würde beide ersetzen und aus der Kachel
 * einen einzeiligen Knopf machen -- sichtbar erst, wenn ein Sync läuft. Die Beschriftung
 * .t1 bleibt deshalb stehen; nur .t2 erzählt, was gerade passiert. Fehlt .t2 (etwa weil
 * das Markup älter ist), fällt es auf den Knopf selbst zurück.
 */
function setLoreSyncStatusLabel(button, text) {
	if (!button) {
		return;
	}
	var slot = button.querySelector(".t2");
	if (slot) {
		slot.textContent = text;
		return;
	}
	button.textContent = text;
}

function loreSyncStatusLabel(button) {
	if (!button) {
		return "";
	}
	var slot = button.querySelector(".t2");
	return slot ? slot.textContent : button.textContent;
}

// Entry point for #wiki-sync-sync-lore. Re-entrancy guarded, so a double click is a
// no-op. The progress rides IN the button label rather than in an extra line, so
// nothing below it shifts around while the ~35 steps run.
async function startWikiSyncLoreSync() {
	if (isWikiSyncLoreRunning) {
		return;
	}
	isWikiSyncLoreRunning = true;

	const button = document.getElementById("wiki-sync-sync-lore");
	const originalLabel = loreSyncStatusLabel(button);
	if (button) {
		button.disabled = true;
		setLoreSyncStatusLabel(button, "wird übernommen …");
	}
	setWikiSyncStatus("Vorkommen werden übernommen …", "pending");

	try {
		// SCHRITT 1: Staging aus dem (gecachten) Dump aufbauen. Läuft immer, ist
		// idempotent und macht den Knopf unabhängig davon, ob „Dump holen" bis zur
		// lore-Phase durchgelaufen ist.
		const build = await runWikiSyncLoreBuildLoop((label) => {
			setLoreSyncStatusLabel(button, `Dump lesen … ${label}`);
		});
		if (!build || build.found === 0) {
			throw new Error("Der Dump enthält keine Lore-Einträge – das sollte nicht passieren, bitte melden.");
		}

		// SCHRITT 2: Staging override-sicher in die Live-Tabellen übernehmen.
		const result = await runWikiSyncLoreSyncLoop((label) => {
			setLoreSyncStatusLabel(button, `übernehmen … ${label}`);
		});
		const t = (result && result.totals) || { added: 0, updated: 0, retired: 0, placesAdded: 0, sourcesAdded: 0, sourcesUpdated: 0 };
		// Quellen sind seit 2026-07-22 Verknüpfungen im geteilten System, deshalb steht
		// hier auch „~aktualisiert": eine nachgezogene Seitenangabe ist dort eine Änderung,
		// keine Löschung samt Neuanlage.
		// Quellen unangetastet, weil das Staging sie nicht kennt: das MUSS dranstehen, sonst
		// liest sich „Quellen +0" wie „es gab nichts zu tun" statt wie „hier fehlt ein Schritt".
		const quellen = t.sourcesStagingEmpty
			? "Quellen unverändert (noch kein „Dump holen“ mit Quellen gelaufen)"
			: `Quellen +${t.sourcesAdded}/~${t.sourcesUpdated}`;
		const note = ` (+${t.added} neu / ~${t.updated} aktualisiert / -${t.retired} stillgelegt · Orte +${t.placesAdded} · ${quellen})`;
		setWikiSyncStatus(`Vorkommen übernommen.${note}`, "success");
		showFeedbackToast(`Vorkommen übernommen.${note}`, "success");
		// Liste UND „zuletzt gesynct" nachziehen. Ohne das zeigt der Reiter direkt nach
		// einem erfolgreichen Sync noch den alten Stempel und die alten Zahlen -- was
		// wie ein fehlgeschlagener Lauf aussieht, obwohl gerade alles geklappt hat.
		// BEIDE Ansichten: der Lauf startet im Fenster, aber der Reiter dahinter zeigt sonst
		// weiter den alten Stempel und die alten Zahlen -- das sieht nach Fehlschlag aus.
		loadLoreList("dialog");
		loadLoreList("panel");
	} catch (error) {
		// IMMER sichtbar melden, auch bei dumpLocked. Die erste Fassung schwieg in
		// genau dem Fall, weil der Loop ja schon setWikiSyncStatus() gesetzt hatte --
		// aber diese Statuszeile ist im Materialien-Reiter gar nicht im Blick. Ergebnis:
		// Knopf blinkt, Fehler landet unsichtbar, der Benutzer sieht „nix passiert".
		// Ein Fehler, den niemand sieht, ist schlimmer als ein lauter.
		const message = (error && error.message) || "Natur-&-Waren-Übernahme fehlgeschlagen.";
		setWikiSyncStatus(message, "error");
		showFeedbackToast(message, "warning");
		if (button) {
			// Der Grund bleibt in der Statuszeile der Kachel stehen, bis der nächste Versuch startet.
			setLoreSyncStatusLabel(button, "⚠ " + message.slice(0, 80));
			button.disabled = false;
		}
		isWikiSyncLoreRunning = false;
		return;
	} finally {
		isWikiSyncLoreRunning = false;
		if (button && !loreSyncStatusLabel(button).startsWith("⚠")) {
			button.disabled = false;
			setLoreSyncStatusLabel(button, originalLabel || "bereit");
		}
	}
}

// ===========================================================================
// Liste im Subjekt „Vorkommen" (bis 2026-07-22 „Natur & Waren"): Fauna / Flora / Waren / Spezies, durchsuchbar.
// Liest api/app/lore.php?catalog=1 -- den öffentlichen Lesepfad, nicht den
// Editor-Endpoint: die Liste zeigt nur Bestand. Bearbeiten kommt in einem eigenen
// Schritt dazu, dann mit capability-Gate.
// ===========================================================================

/**
 * Zwei Listen, EIN Codeweg: die Übersicht im Reiter und die Auswahlspalte im Fenster.
 *
 * Dieselbe Aufteilung wie bei Abenteuern und Karten -- der Reiter zeigt den Bestand, das
 * Fenster ist der Arbeitsplatz. Die IDs müssen sich unterscheiden (zwei Elemente mit
 * derselben id wären ein DOM-Fehler, und getElementById träfe stets nur das erste), die
 * Logik nicht. Deshalb steht hier nur, WO die Elemente sitzen; alles Übrige ist geteilt.
 *
 * BEIDE kennen „spezies" -- seit 2026-07-22 (Owner) auch der Reiterstreifen im Panel, dort
 * ausgegraut. Vorher stand hier das Gegenteil („nur das Fenster kennt spezies"), weil der
 * Menüband-Schalter die öffentliche ANZEIGE steuert und nicht die Bearbeitbarkeit. Genau das
 * ist der Grund, warum Spezies jetzt sichtbar, aber grau ist: nicht öffentlich, sehr wohl
 * bearbeitbar. Die Begründung steht im Tooltip des Reiters, damit sie niemand wegräumt.
 * Der Panel-Streifen kennt zusätzlich „all" (keine Art-Einschränkung), das Fenster nicht.
 */
var AVESMAPS_LORE_VIEWS = {
	panel: {
		scroll: "lore-list-scroll", search: "lore-list-search", count: "lore-list-count",
		tabAttr: "data-lore-kind", countAttr: "data-lore-count",
	},
	dialog: {
		scroll: "lore-dlg-scroll", search: "lore-dlg-search", count: "lore-dlg-count",
		tabAttr: "data-lore-dlg-kind", countAttr: "data-lore-dlg-count",
	},
};

var avesmapsLoreListKind = { panel: "fauna", dialog: "fauna" };
var avesmapsLoreListTimer = null;
var avesmapsLoreListToken = { panel: 0, dialog: 0 };

// 💣 JEDER Abruf braucht ein Zeitlimit. Ein hängender Request belegt bis zum
// Servertimeout einen PHP-Worker; mehrere davon legen die gesamte API lahm -- genau
// so ist der Pool am 21.07. gesättigt worden. Ein Abbruch gibt den Worker sofort frei.
var AVESMAPS_LORE_UI_TIMEOUT_MS = 12000;

function avesmapsLoreFetchWithTimeout(url, options, timeoutMs) {
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var timer = controller
		? window.setTimeout(function () { controller.abort(); }, timeoutMs || AVESMAPS_LORE_UI_TIMEOUT_MS)
		: null;
	var settings = Object.assign({}, options || {});
	if (controller) {
		settings.signal = controller.signal;
	}
	return fetch(url, settings).then(function (response) {
		if (timer) { window.clearTimeout(timer); }
		return response;
	}, function (error) {
		if (timer) { window.clearTimeout(timer); }
		throw error;
	});
}

function avesmapsLoreListEscape(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Wiki-Markup einer Art („[[Laubbaum]]") auf reinen Text reduzieren -- in der Liste
// soll die Art lesbar sein, nicht klickbar; Klicks gehören dem Eintrag selbst.
function avesmapsLoreListPlain(value) {
	return String(value == null ? "" : value).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, function (all, target, label) {
		return (label || target || "").trim();
	}).trim();
}

function renderLoreList(view, data) {
	var ids = AVESMAPS_LORE_VIEWS[view] || AVESMAPS_LORE_VIEWS.panel;
	var scroll = document.getElementById(ids.scroll);
	var counter = document.getElementById(ids.count);
	if (!scroll) {
		return;
	}
	var items = (data && data.items) || [];
	if (counter) {
		counter.textContent = data ? (items.length + " von " + data.total) : "";
	}
	if (items.length === 0) {
		scroll.innerHTML = '<p class="wiki-sync-panel__summary">'
			+ (data && data.total === 0 && !data.q
				? "Noch keine Einträge – bitte einmal „Vorkommen syncen“."
				: "Kein Treffer.")
			+ "</p>";
		return;
	}
	// Dieselben Klassen wie die Abenteuer- und Kartenliste (wiki-sync-adv-picker__row),
	// damit die vier Listen im selben Reiter nicht drei verschiedene Zeilen zeigen.
	scroll.innerHTML = items.map(function (item) {
		var art = avesmapsLoreListPlain(item.typ || item.gruppe || "");
		var places = Array.isArray(item.places) ? item.places : [];
		// Die Orte SELBST statt einer Zahl -- danach ist die Zeile erst brauchbar:
		// „Weiden, Kosch, Nordmarken" beantwortet die Frage, „3 Orte" stellt sie nur.
		var placeText = places.join(", ");
		var rest = item.place_count - places.length;
		if (rest > 0) {
			placeText += " +" + rest;
		}
		if (!placeText) {
			placeText = "ohne Ortsangabe";
		}
		var meta = [art, placeText].filter(Boolean).join(" · ");
		if (item.origin && item.origin !== "wiki") {
			meta += " · " + item.origin;
		}
		var href = String(item.wiki_url || "");
		var safe = href.indexOf("https://de.wiki-aventurica.de/") === 0 ? href : "";
		return '<button type="button" class="wiki-sync-adv-picker__row" data-lore-entry="'
			+ avesmapsLoreListEscape(item.wiki_key) + '"'
			+ (safe ? ' data-lore-url="' + avesmapsLoreListEscape(safe) + '"' : "")
			+ ' title="' + avesmapsLoreListEscape(item.name + " – klicken zum Bearbeiten") + '">'
			+ '<span class="wiki-sync-adv-picker__title">' + avesmapsLoreListEscape(item.name) + "</span>"
			+ '<span class="wiki-sync-adv-picker__meta">' + avesmapsLoreListEscape(meta) + "</span>"
			+ "</button>";
	}).join("");
}

/**
 * „Zuletzt gesynct: …" neben den Knopf schreiben -- wie bei Abenteuern und
 * Kartensammlung. Ohne die Zeile sieht ein leerer Reiter aus wie ein Fehler, statt
 * wie „noch nie gesynct", und niemand weiß, ob der Bestand von heute oder von
 * letzter Woche stammt. Der Zeitstempel kommt UTC aus app_setting und wird lokal
 * angezeigt; ein unlesbarer Wert wird roh durchgereicht statt zu „Invalid Date".
 */
function renderLoreLastSynced(data) {
	var syncedEl = document.getElementById("wiki-sync-lore-synced");
	if (!syncedEl || !data || !data.ok) {
		return;
	}
	var stamp = typeof data.last_synced === "string" ? data.last_synced.trim() : "";
	if (stamp) {
		var parsed = new Date(stamp.replace(" ", "T") + "Z");
		syncedEl.textContent = "Zuletzt gesynct: "
			+ (isNaN(parsed.getTime()) ? stamp : parsed.toLocaleString("de-DE"));
	} else {
		syncedEl.textContent = "Noch nie gesynct";
	}
	syncedEl.hidden = false;
}

// Der Reiterstreifen ist GETEILT, die Listen laden aber asynchron. Eine Antwort, die eintrifft,
// nachdem der Benutzer das Subjekt schon gewechselt hat, würde sonst über den Streifen des neuen
// Subjekts malen -- beobachtet: nach Vorkommen → Siedlungen standen die Lore-Arten über der
// Siedlungsliste. Jeder Renderer holt seinen Container deshalb hierüber und bekommt null, wenn
// er nicht mehr dran ist.
function wikiSyncViewTabsHostFor(subjectKey) {
	if (activeWikiSyncPanelTab !== subjectKey) {
		return null;
	}
	return document.getElementById("wiki-sync-view-tabs");
}

// Vorkommen rendert seine Arten in DENSELBEN Streifen wie jedes andere Subjekt. Spezies steht
// ausgegraut darin statt zu fehlen: die öffentliche Anzeige ist aus (Owner 2026-07-21), die
// Daten sind vollständig und bleiben bearbeitbar. Die Begründung gehört in den Tooltip -- eine
// ausgegraute Fläche ohne Begründung wird irgendwann „aufräumend" umgelegt.
// Die Zahlen kommen aus derselben Antwort wie die Liste; gemerkt, damit ein Neuzeichnen ohne
// frischen Abruf (Subjektwechsel) nicht auf „?" zurückfällt.
var avesmapsLoreCountsCache = null;

function renderWikiSyncLoreViewTabs(countsByKind) {
	var host = wikiSyncViewTabsHostFor("lore");
	if (!host) {
		return;
	}
	if (countsByKind) {
		avesmapsLoreCountsCache = countsByKind;
	}
	var counts = avesmapsLoreCountsCache || {};
	var activeKind = avesmapsLoreListKind.panel;
	// Bewusst OHNE data-lore-count: die Zahlen setzt diese Funktion selbst (deutsch gruppiert).
	// Ein data-lore-count hier würde von der Zähler-Schleife in loadLoreList überschrieben und
	// die Gruppierung wieder verlieren. Die Chips des FENSTERS tragen data-lore-dlg-count und
	// werden dort weiterhin bedient.
	host.innerHTML = wikiSyncSubjectViewTabs("lore").map(function (viewTab) {
		// „Alle" ohne bekannte Zahlen ist „?", NICHT 0: eine Summe über ein leeres Objekt ist
		// rechnerisch null, behauptet aber „es gibt keine" -- und das weiß hier noch niemand.
		var count = viewTab.key === "all"
			? (avesmapsLoreCountsCache
				? Object.keys(counts).reduce(function (sum, k) { return sum + Number(counts[k] || 0); }, 0)
				: undefined)
			: counts[viewTab.key];
		return '<button type="button" data-lore-kind="' + viewTab.key + '"'
			+ ' class="wiki-sync-panel__tab' + (viewTab.off ? " is-off" : "")
			+ (activeKind === viewTab.key ? " is-active" : "") + '"'
			+ (viewTab.off ? ' title="' + escapeHtml(viewTab.reason) + '"' : "")
			+ '>' + escapeHtml(viewTab.label)
			+ ' <span class="wiki-sync-panel__tab-count">('
			+ (typeof count === "number" && Number.isFinite(count) ? count.toLocaleString("de-DE") : "?")
			+ ')</span></button>';
	}).join("");
}

function loadLoreList(view) {
	view = view === "dialog" ? "dialog" : "panel";
	var ids = AVESMAPS_LORE_VIEWS[view];
	var scroll = document.getElementById(ids.scroll);
	if (!scroll) {
		return;
	}
	if (view === "panel") {
		// Sofort zeichnen, damit der Streifen beim Subjektwechsel nicht leer bleibt, bis die
		// Antwort da ist. Die Zahlen kommen aus dem Zwischenspeicher.
		renderWikiSyncLoreViewTabs(null);
	}
	var input = document.getElementById(ids.search);
	var query = input ? input.value.trim() : "";
	// Staleness-Token JE ANSICHT: sonst würde ein Abruf im Fenster die Antwort für den
	// Reiter verwerfen (und umgekehrt), weil beide denselben Zähler hochzählen.
	var token = ++avesmapsLoreListToken[view];
	// „Alle" heißt: keine Art-Einschränkung, also ein LEERER kind-Parameter. Ausdrücklich, nicht
	// dem Zufall überlassen: der Katalog verwirft zwar jeden Wert, der nicht in
	// AVESMAPS_LORE_KINDS steht (api/_internal/app/lore.php:142), und täte damit versehentlich
	// das Richtige -- aber ein Verhalten, das auf einer Whitelist-Lücke beruht, ist kein Vertrag.
	var kindParam = avesmapsLoreListKind[view] === "all" ? "" : avesmapsLoreListKind[view];
	var url = "api/app/lore.php?catalog=1&kind=" + encodeURIComponent(kindParam)
		+ "&q=" + encodeURIComponent(query) + "&limit=200";
	avesmapsLoreFetchWithTimeout(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (data) {
			if (token !== avesmapsLoreListToken[view]) {
				return;
			}
			renderLoreList(view, data && data.ok ? data : null);
			renderLoreLastSynced(data);
			renderLoreKindToggles(data && data.ok ? data.kinds_enabled : null);
			// ALLE Reiterzahlen setzen, nicht nur die des geladenen: sonst bleiben die
			// übrigen leer, bis man sie einzeln anklickt. Die Zahlen zeigen den
			// Gesamtbestand und bleiben deshalb auch während einer Suche stehen.
			// Beide Reitersätze auf einmal -- Reiter und Fenster zeigen denselben Bestand,
			// und ein Abruf reicht für beide.
			var counts = (data && data.ok && data.counts_by_kind) || null;
			if (counts) {
				Object.keys(counts).forEach(function (kind) {
					document
						.querySelectorAll('[data-lore-count="' + kind + '"], [data-lore-dlg-count="' + kind + '"]')
						.forEach(function (chip) { chip.textContent = "(" + counts[kind] + ")"; });
				});
			}
			if (view === "panel") {
				// Der gemeinsame Streifen zeichnet sich mit den frischen Zahlen neu -- er trägt
				// bewusst keine data-lore-count-Chips, die die Schleife oben bedienen könnte.
				renderWikiSyncLoreViewTabs(counts);
				// Das Datum der Auswahlzeile kommt aus DIESER Antwort. Vorkommen ist keine
				// sync_kind des Dump-Endpunkts; sein Datum steht in app_setting und reist mit dem
				// Katalog mit -- deshalb wird es hier eingehaengt statt dort abgefragt.
				if (data && data.ok) {
					wikiSyncKindSyncedRaw = Object.assign({}, wikiSyncKindSyncedRaw, { lore: data.last_synced || null });
					renderWikiSyncSubjectRail();
				}
			}
		})
		.catch(function () {
			if (token === avesmapsLoreListToken[view]) {
				scroll.innerHTML = '<p class="wiki-sync-panel__summary">Liste konnte nicht geladen werden.</p>';
			}
		});
}

if (typeof document !== "undefined" && !document.__avesmapsLoreListBound) {
	document.__avesmapsLoreListBound = true;
	// Ein Handler für BEIDE Reitersätze. Der Reiter im Panel und der im Fenster tragen
	// verschiedene Attribute, damit sie sich nicht gegenseitig als „aktiv" markieren --
	// man kann im Fenster Spezies bearbeiten, während der Panel-Reiter auf Fauna steht.
	document.addEventListener("click", function (event) {
		if (!event.target || !event.target.closest) {
			return;
		}
		Object.keys(AVESMAPS_LORE_VIEWS).forEach(function (view) {
			var attr = AVESMAPS_LORE_VIEWS[view].tabAttr;
			var tab = event.target.closest("[" + attr + "]");
			if (!tab) {
				return;
			}
			avesmapsLoreListKind[view] = tab.getAttribute(attr) || "fauna";
			document.querySelectorAll("[" + attr + "]").forEach(function (other) {
				other.classList.toggle("is-active", other === tab);
			});
			loadLoreList(view);
		});
	});
	document.addEventListener("input", function (event) {
		if (!event.target) {
			return;
		}
		var view = event.target.id === "lore-dlg-search" ? "dialog"
			: (event.target.id === "lore-list-search" ? "panel" : "");
		if (!view) {
			return;
		}
		// Entprellt: sonst eine Abfrage je Tastendruck.
		window.clearTimeout(avesmapsLoreListTimer);
		avesmapsLoreListTimer = window.setTimeout(function () { loadLoreList(view); }, 250);
	});
	// KEIN Doppelklick-Handler mehr: seit der Einfachklick den Editor öffnet, würde ein
	// Doppelklick beides auslösen -- Editor auf UND Wiki-Tab auf. Der Wiki-Link sitzt
	// jetzt im Editorkopf, wo er nicht mit einer Geste kollidiert.
}

// ===========================================================================
// Editor für einen Lore-Eintrag. Ersetzt die Liste im selben Bereich.
//
// Der Editor schreibt KEINE Sonderfälle -- er setzt genau die Marker, die der
// Reconcile (wiki/lore-sync.php) ohnehin liest: ein zugeordneter Ort ist
// origin='manual', ein entfernter Wiki-Ort ein Grabstein (status='suppressed'), ein
// überschriebenes Feld trägt field_origins[feld]='manual'. Deshalb überlebt jede
// Handkorrektur den nächsten „Vorkommen syncen"-Lauf, und das ist unit-getestet.
// ===========================================================================

var avesmapsLoreDetailKey = "";

/**
 * Meldung in die Statuszeile des Vorkommen-Fensters schreiben (Spec §3.4).
 *
 * 💣 Diese Zeile ist nicht bloß Struktur. Die drei Schreibwege dieses Editors --
 * `set_field`, `add_place`, `remove_place` -- haben einen Fehlschlag bis 2026-07-23
 * NIRGENDS gemeldet: `loreEditAction` liefert bei Netzfehler, Zeitüberschreitung oder
 * Abbruch `null`, und der Aufrufer hat daraufhin nur den Knopf wieder freigegeben. Wer
 * offline oder mit abgelaufener Sitzung speicherte, sah ein Feld, das auf den alten Wert
 * zurücksprang, und bekam keinen Grund dafür genannt.
 *
 * Ohne Argument fällt sie auf „Bereit." zurück -- eine leere Statuszeile sieht aus wie ein
 * Fehler, genau wie die leere Editorspalte daneben (siehe #lore-dlg-placeholder).
 */
function setLoreDialogStatus(message, tone) {
	var statusElement = document.getElementById("lore-dlg-status");
	var textElement = document.getElementById("lore-dlg-status-text");
	if (!statusElement || !textElement) {
		return;
	}
	textElement.textContent = message || "Bereit.";
	statusElement.dataset.tone = tone || "";
}

/**
 * Antwort von `loreEditAction` auf eine anzeigbare Fehlermeldung reduzieren.
 *
 * Der Umschlag ist im Umbau (AGENTS.md §4): manche Endpunkte liefern `error` als Zeichenkette,
 * die neueren als `{ code, message }`. Beides wird hier genommen; `null` heißt, die Anfrage kam
 * gar nicht erst durch.
 */
function loreEditErrorText(data) {
	if (!data) {
		return "Keine Verbindung – nicht gespeichert.";
	}
	var error = data.error;
	if (error && typeof error === "object" && error.message) {
		return String(error.message);
	}
	if (typeof error === "string" && error) {
		return error;
	}
	return "Nicht gespeichert.";
}

function loreEditAction(action, payload) {
	return avesmapsLoreFetchWithTimeout("api/edit/map/lore.php", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(Object.assign({ action: action }, payload || {})),
	}).then(function (r) { return r.json().catch(function () { return null; }); },
		function () { return null; }); // Abbruch/Netzfehler: der Aufrufer prüft auf null
}

function closeLoreDetail() {
	var detail = document.getElementById("lore-detail");
	avesmapsLoreDetailKey = "";
	// „Zurück" leert die Maske, schließt aber NICHT das Fenster: Menüband und Liste
	// daneben bleiben bedienbar. Der Platzhalter kommt zurück, damit die rechte Spalte
	// nicht als leere Fläche dasteht.
	if (detail) { detail.hidden = true; detail.innerHTML = ""; }
	var placeholder = document.getElementById("lore-dlg-placeholder");
	if (placeholder) { placeholder.hidden = false; }
}

function loreFieldRow(entry, field, label) {
	var overridden = entry.field_origins && entry.field_origins[field] === "manual";
	return '<label class="lore-detail__field">'
		+ '<span class="lore-detail__label">' + avesmapsLoreListEscape(label)
		+ (overridden ? ' <em class="lore-detail__flag">von Hand</em>' : "")
		+ "</span>"
		+ '<input type="text" class="lore-detail__input" data-lore-field="' + field + '" value="'
		+ avesmapsLoreListEscape(entry[field] || "") + '">'
		+ "</label>";
}

function renderLoreDetail(entry) {
	var detail = document.getElementById("lore-detail");
	if (!detail || !entry) { return; }

	// 💣 ERST abräumen, DANN überschreiben. Der Quellen-Editor hängt seine Vorschlagsliste an
	// document.body, nicht in seinen Container -- wer den Container wegwirft, ohne vorher zu
	// lösen, lässt sie dort liegen. Diese Funktion baut das ganze Detail bei JEDEM gespeicherten
	// Feld neu auf, also wäre das nach fünf Bearbeitungen fünf tote Listen tief.
	var previousSourceHost = document.getElementById("lore-source-editor");
	if (previousSourceHost && typeof previousSourceHost.__fsDetachAutocomplete === "function") {
		previousSourceHost.__fsDetachAutocomplete();
	}

	var live = [];
	var tombs = [];
	(entry.places || []).forEach(function (place) {
		(place.status === "suppressed" ? tombs : live).push(place);
	});

	// Eine Ortskarte, nicht eine Tabellenzeile -- gerahmt wie die Ortskarten im
	// Abenteuereditor, mit der Herkunft als Pille statt als Fließtext.
	function placeRow(place, isTomb) {
		var manual = place.origin !== "wiki";
		return '<li class="lore-detail__place' + (isTomb ? " is-tomb" : "") + '">'
			+ '<div class="lore-detail__place-main">'
			+ '<span class="lore-detail__place-name">' + avesmapsLoreListEscape(place.place_title) + "</span>"
			+ '<span class="lore-detail__place-meta">' + avesmapsLoreListEscape(place.relation) + "</span>"
			+ '<span class="lore-detail__pill' + (manual ? " is-manual" : "") + '">'
			+ (manual ? "manuell" : "Wiki") + "</span>"
			+ "</div>"
			+ '<button type="button" class="lore-detail__place-btn" data-lore-place-action="'
			+ (isTomb ? "add" : "remove") + '" data-lore-place-key="' + avesmapsLoreListEscape(place.place_wiki_key)
			+ '" data-lore-place-title="' + avesmapsLoreListEscape(place.place_title)
			+ '" data-lore-place-rel="' + avesmapsLoreListEscape(place.relation) + '">'
			+ (isTomb ? "↺ wieder aufnehmen" : "×") + "</button>"
			+ "</li>";
	}

	var safe = String(entry.wiki_url || "");
	if (safe.indexOf("https://de.wiki-aventurica.de/") !== 0) { safe = ""; }

	// DREI Spalten wie im Abenteuereditor: Liste (im Markup daneben) | Stammdaten | Orte.
	// Die Orte sind kein Anhängsel der Felder, sondern die eigentliche Arbeit an einem
	// Eintrag -- untereinander gestapelt musste man für jede Zuordnung erst an den Feldern
	// vorbeiscrollen. Abschnitte in Versalien, damit die Spalten dieselbe Gliederung tragen
	// wie COVER / IDENTITÄT / ORTE beim Abenteuer.
	detail.innerHTML = '<div class="lore-detail__head">'
		+ '<button type="button" class="lore-detail__back" id="lore-detail-back">← Zurück zur Liste</button>'
		+ (safe ? '<a class="lore-detail__wiki" href="' + avesmapsLoreListEscape(safe) + '" target="_blank" rel="noopener">Wiki-Artikel ↗</a>' : "")
		+ "</div>"
		+ '<h4 class="lore-detail__title">' + avesmapsLoreListEscape(entry.name)
		+ ' <span class="lore-detail__kind">' + avesmapsLoreListEscape(entry.kind) + "</span></h4>"
		+ '<div class="lore-detail__cols">'

		+ '<div class="lore-detail__col">'
		+ '<h5 class="lore-detail__section">Stammdaten</h5>'
		+ loreFieldRow(entry, "name", "Name")
		// Beschriftet die Spalte `gruppe` -- und hiess bis 2026-07-22 „Art", was ihrer eigenen
		// Spalte widersprach und mit der Art-Unterscheidung (Fauna/Flora/Waren/Spezies, jetzt die
		// Reiter über der Liste) kollidierte. Zwei verschiedene Dinge, ein Name, ein Panel.
		+ loreFieldRow(entry, "gruppe", "Gruppe")
		+ (entry.kind === "ware" ? loreFieldRow(entry, "typ", "Gegenstandstyp") : "")
		+ loreFieldRow(entry, "lebensraum", "Lebensraum")
		+ loreFieldRow(entry, "synonyme", "Weitere Namen")
		+ '<p class="lore-detail__hint">Ein geändertes Feld bleibt beim nächsten Sync stehen. Leeren gibt es wieder ans Wiki zurück.</p>'
		// Quellen: das GETEILTE Bauteil, dasselbe wie im Siedlungs-, Regions-, Wege-,
		// Territoriums- und Kartensammlungseditor. Bis 2026-07-22 stand hier eine reine
		// Leseliste aus einer Lore-eigenen Tabelle -- man konnte eine falsche Quelle sehen,
		// aber nichts dagegen tun. Der Container bleibt leer; mountFeatureSourceEditor füllt
		// ihn vom Server, sobald das Markup steht.
		+ '<h5 class="lore-detail__section">Quellen</h5>'
		+ '<div id="lore-source-editor"></div>'
		+ "</div>"

		+ '<div class="lore-detail__col lore-detail__col--places">'
		+ '<h5 class="lore-detail__section">Orte (' + live.length + ")</h5>"
		+ '<div class="lore-detail__add">'
		+ '<input type="text" id="lore-add-place" class="lore-detail__input" placeholder="Ort, Region oder Gebiet …" autocomplete="off">'
		+ '<button type="button" class="lore-detail__place-btn" id="lore-add-place-btn">+ Ort</button>'
		+ "</div>"
		+ (live.length ? '<ul class="lore-detail__places">' + live.map(function (p) { return placeRow(p, false); }).join("") + "</ul>"
			: '<p class="lore-detail__hint">Noch keinem Ort zugeordnet.</p>')
		+ (tombs.length
			? '<h5 class="lore-detail__section">Entfernte Wiki-Orte (' + tombs.length + ")</h5>"
				+ '<p class="lore-detail__hint">Diese bleiben entfernt, auch wenn das Wiki sie weiter nennt.</p>'
				+ '<ul class="lore-detail__places">' + tombs.map(function (p) { return placeRow(p, true); }).join("") + "</ul>"
			: "")
		+ "</div>"

		+ "</div>";

	// ⚠️ NACH dem innerHTML, sonst mountet man in einen Knoten, der gleich ersetzt wird.
	// Der Schlüssel kommt als GETTER, nicht als Wert: das Bauteil fragt ihn bei jeder
	// Anfrage frisch ab, und in dieser Liste kann man den Eintrag wechseln, während der
	// Quellen-Editor offen steht -- ein kopierter Schlüssel schriebe dann auf den alten.
	var sourceHost = document.getElementById("lore-source-editor");
	if (sourceHost && typeof mountFeatureSourceEditor === "function") {
		mountFeatureSourceEditor(sourceHost, "lore", function () { return avesmapsLoreDetailKey; });
	}
}

function openLoreDetail(wikiKey) {
	var detail = document.getElementById("lore-detail");
	if (!detail) { return; }
	avesmapsLoreDetailKey = wikiKey;
	// Der Editor lebt im Fenster. Die Liste im Reiter bleibt stehen -- nach dem Schließen
	// macht man dort weiter, wo man war, statt Suchbegriff und Scrollstand zu verlieren.
	setWikiSyncLoreDialogOpen(true);
	var placeholder = document.getElementById("lore-dlg-placeholder");
	if (placeholder) { placeholder.hidden = true; }
	detail.hidden = false;
	detail.innerHTML = '<p class="wiki-sync-panel__summary">Wird geladen …</p>';
	// Zurueck auf Anfang: eine Erfolgsmeldung vom vorigen Eintrag ueber dem neuen stehen zu
	// lassen, behauptet etwas ueber diesen hier.
	setLoreDialogStatus();
	loreEditAction("detail", { wiki_key: wikiKey }).then(function (data) {
		if (avesmapsLoreDetailKey !== wikiKey) { return; }
		if (!data || data.ok !== true || !data.entry) {
			// 401 = nicht eingeloggt. Das ist die häufigste Ursache und verdient eine
			// klare Ansage statt eines allgemeinen Fehlers. Die Statuszeile bleibt hier
			// bewusst stumm: dieselbe Ansage zweimal im selben Fenster liest sich wie ein
			// Fehler im Fehler, und der Rueckweg-Knopf gehoert an die Maske, nicht in die Zeile.
			detail.innerHTML = '<p class="wiki-sync-panel__summary">'
				+ '<button type="button" class="lore-detail__back" id="lore-detail-back">← Zurück</button><br>'
				+ "Bearbeiten geht nur angemeldet und mit Editorrecht.</p>";
			return;
		}
		renderLoreDetail(data.entry);
	});
}

if (typeof document !== "undefined" && !document.__avesmapsLoreEditBound) {
	document.__avesmapsLoreEditBound = true;

	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!target || !target.closest) { return; }

		var toggle = target.closest("[data-lore-toggle]");
		if (toggle) {
			// Optimistisch umschalten wäre hier falsch: der Schalter behauptet einen
			// öffentlichen Zustand. Erst wenn der Server bestätigt hat, wird das Label
			// gedreht -- sonst zeigt das Menüband "AUS", während die Art weiter ausgeliefert
			// wird. Solange gilt: Knopf gesperrt.
			var wasOn = toggle.getAttribute("aria-pressed") === "true";
			toggle.disabled = true;
			loreEditAction("set_kind_enabled", {
				kind: toggle.getAttribute("data-lore-toggle"),
				enabled: !wasOn,
			}).then(function (data) {
				toggle.disabled = false;
				if (data && data.ok && data.kinds) {
					renderLoreKindToggles(data.kinds);
					if (typeof showFeedbackToast === "function") {
						showFeedbackToast(
							(toggle.getAttribute("data-lore-label") || "Art")
								+ (data.enabled ? " wird wieder angezeigt." : " ist ausgeblendet."),
							"success"
						);
					}
					return;
				}
				if (typeof showFeedbackToast === "function") {
					showFeedbackToast("Schalter konnte nicht geändert werden (angemeldet?).", "warning");
				}
			});
			return;
		}
		if (target.closest("#lore-detail-back")) {
			closeLoreDetail();
			return;
		}
		var row = target.closest("[data-lore-entry]");
		if (row) {
			// 💣 Hier stand `&& !avesmapsLoreDetailKey`: solange ein Eintrag offen war, tat
			// ein Klick auf eine andere Zeile NICHTS -- man musste erst „← Zurück". Das fiel
			// nie auf, weil die Liste beim Öffnen versteckt wurde; seit sie im Fenster
			// danebensteht, ist es schlicht eine tote Liste. Ein Schutz vor Datenverlust war
			// es nie (Felder speichern beim Fokusverlust).
			openLoreDetail(row.getAttribute("data-lore-entry") || "");
			return;
		}
		var placeBtn = target.closest("[data-lore-place-action]");
		if (placeBtn && avesmapsLoreDetailKey) {
			var isAdd = placeBtn.getAttribute("data-lore-place-action") === "add";
			placeBtn.disabled = true;
			loreEditAction(isAdd ? "add_place" : "remove_place", {
				wiki_key: avesmapsLoreDetailKey,
				place_title: placeBtn.getAttribute("data-lore-place-title") || "",
				place_wiki_key: placeBtn.getAttribute("data-lore-place-key") || "",
				relation: placeBtn.getAttribute("data-lore-place-rel") || "verbreitung",
			}).then(function (data) {
				if (data && data.ok && data.entry) {
					renderLoreDetail(data.entry);
					setLoreDialogStatus(isAdd ? "Ort wieder aufgenommen." : "Ort entfernt.", "success");
				} else {
					placeBtn.disabled = false;
					setLoreDialogStatus(loreEditErrorText(data), "error");
				}
			});
			return;
		}
		if (target.closest("#lore-add-place-btn") && avesmapsLoreDetailKey) {
			var input = document.getElementById("lore-add-place");
			var value = input ? input.value.trim() : "";
			if (!value) { return; }
			loreEditAction("add_place", { wiki_key: avesmapsLoreDetailKey, place_title: value })
				.then(function (data) {
					if (data && data.ok && data.entry) {
						renderLoreDetail(data.entry);
						setLoreDialogStatus("Ort „" + value + "“ hinzugefügt.", "success");
					} else {
						setLoreDialogStatus(loreEditErrorText(data), "error");
					}
				});
		}
	});

	// Feld speichern, sobald es den Fokus verliert -- kein Speichern-Knopf, der
	// vergessen werden kann.
	document.addEventListener("change", function (event) {
		var input = event.target;
		if (!input || !input.getAttribute || !input.getAttribute("data-lore-field") || !avesmapsLoreDetailKey) {
			return;
		}
		var fieldName = input.getAttribute("data-lore-field");
		loreEditAction("set_field", {
			wiki_key: avesmapsLoreDetailKey,
			field: fieldName,
			value: input.value,
		}).then(function (data) {
			if (data && data.ok && data.entry) {
				renderLoreDetail(data.entry);
				// Ohne Rueckmeldung sieht ein erfolgreiches Speichern genauso aus wie ein
				// fehlgeschlagenes: die Maske wird neu gebaut, das war es.
				setLoreDialogStatus("„" + fieldName + "“ gespeichert.", "success");
			} else {
				setLoreDialogStatus(loreEditErrorText(data), "error");
			}
		});
	});
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
	const dialog = document.createElement("div");
	dialog.className = "political-territory-editor-dialog";
	dialog.style.width = "min(1400px, calc(100vw - 24px))";
	dialog.style.height = "min(880px, calc(100vh - 24px))";
	const header = document.createElement("div");
	header.className = "political-territory-editor-dialog__header";
	const headingEl = document.createElement("h2");
	// Titel = Knopfbeschriftung, wortgleich. "Territorien" statt "Herrschaftsgebiete":
	// Owner-Entscheid, kuerzer. Erklaerender Fliesstext darf weiter Herrschaftsgebiete sagen.
	headingEl.textContent = "Territorien bearbeiten";
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
		setWikiSyncStartButtonLabel(territoriesButtonElement, isWikiSyncTerritoriesRunning ? "Synchronisiert..." : "Territorien bearbeiten");
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

// (Der Zieh-Balken des Konfliktloesung-Akkordeons ist mit dem Akkordeon entfallen, 2026-07-20:
//  im eigenen Dialog gibt der Dialog die Hoehe vor und die Fallliste scrollt selbst.)
