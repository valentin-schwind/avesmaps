
// Initialisierung der Karte 
const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: 0,
    // One level above the native tile zoom (z5, see maxNativeZoom) so the route fit can zoom in far
    // enough to let short routes fill the frame. Tiles above z5 are upscaled (slightly softer).
    maxZoom: 7,
    bounds: MAP_BOUNDS,
    continuousWorld: false,
    noWrap: true,
    zoomControl: false,
}).setView([478.0, 539.0], 2);

// Rendering-Reihenfolge
map.createPane("regionsPane");
map.createPane("mapDecorationsPane");
map.createPane("roadsOutlinePane");
map.createPane("roadsPane");
map.createPane("powerlinesPane");
map.createPane("routeOutlinePane");
map.createPane("routePane");
map.createPane("measurementPane");
map.createPane("measurementHandlesPane");
map.createPane("regionLabelsPane");
map.createPane("locationsPane");
map.createPane("labelsPane");

map.getPane("regionsPane").style.zIndex = 200;
map.getPane("mapDecorationsPane").style.zIndex = 480;
map.getPane("roadsOutlinePane").style.zIndex = 350;
map.getPane("roadsPane").style.zIndex = 400;
map.getPane("powerlinesPane").style.zIndex = 430;
map.getPane("routeOutlinePane").style.zIndex = 445; // white casing, just below the route line
map.getPane("routePane").style.zIndex = 450;
map.getPane("measurementPane").style.zIndex = 460;
map.getPane("measurementHandlesPane").style.zIndex = 520;
map.getPane("regionLabelsPane").style.zIndex = 475;
map.getPane("regionLabelsPane").classList.add("region-labels-pane");
map.getPane("locationsPane").style.zIndex = 500;
map.getPane("labelsPane").style.zIndex = 650;
map.getPane("labelsPane").classList.add("map-labels-pane");
map.getPane("tooltipPane").style.zIndex = 875;
map.getPane("popupPane").style.zIndex = 900;

initializeMapDecorations();
L.control.zoom({ position: "topright" }).addTo(map);
map.setMaxBounds(MAP_BOUNDS);

map.on("zoomend", () => {
    const zoom = map.getZoom();
    const size = 9 + zoom * 3;

    document.querySelectorAll(".region-label").forEach(e => {
        e.style.fontSize = size + "px";
    });
    syncLabelIcons();
    syncPathRendering();
    syncPathLabels();
    syncPowerlineLabels();
    schedulePoliticalTerritoryLayerReload();
});
map.attributionControl.setPrefix(false);
map.on("moveend", () => {
    syncLocationMarkerVisibility();
    syncLabelVisibility();
    schedulePoliticalTerritoryLayerReload();
});
map.on("click", () => {
    closeRegionCompactTooltip();
    if (IS_EDIT_MODE && !pendingRegionOperation && !pendingRegionMoveState) {
        clearRegionGeometryEdit();
    }
});

// Keep marker/label/region infoboxes readable at the image edge. Leaflet's popup autoPan pans the
// map to reveal a popup that would otherwise open off-screen, but setMaxBounds() binds
// _panInsideMaxBounds to every moveend, which snaps the map back inside the image bounds and thereby
// cancels that autoPan -- the popup visibly slides up, then the map slides back down and hides it.
// autoPan pans by an offset that fits inside the viewport, so Leaflet applies it *animated*: its
// moveend (which would clamp back) fires only after this popupopen handler has run. So while a popup
// is open we drop maxBounds -> the autoPan is no longer reverted, and we restore the bound as soon
// as the user moves the map themselves (their move then clamps back naturally) or the popup closes.
function keepPopupReadableDespiteMaxBounds(event) {
    const popup = event.popup;
    if (!popup || !popup.options || popup.options.autoPan === false) {
        return;
    }
    const savedMaxBounds = map.options.maxBounds;
    if (!savedMaxBounds) {
        return;
    }
    map.options.maxBounds = null;

    const detach = () => {
        map.off("dragstart", onUserMove);
        map.off("zoomstart", onUserMove);
        map.off("popupclose", onPopupClose);
    };
    const onUserMove = () => {
        map.options.maxBounds = savedMaxBounds;
        detach();
    };
    const onPopupClose = (closeEvent) => {
        if (closeEvent.popup !== popup) {
            return;
        }
        map.options.maxBounds = savedMaxBounds;
        map.panInsideBounds(savedMaxBounds, { animate: true });
        detach();
    };
    map.on("dragstart", onUserMove);
    map.on("zoomstart", onUserMove);
    map.on("popupclose", onPopupClose);
}
map.on("popupopen", keepPopupReadableDespiteMaxBounds);

// Multi-source system: popups/infoboxes render their sources synchronously from the map-features
// payload (renderFeatureSourceLine in js/ui/popups.js), so no popupopen/tooltipopen wiring is needed.

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        ensurePowerlineAnimationLoop();
        return;
    }
    stopPowerlineAnimationLoop();
});

function createBaseTileLayer(mapStyle) {
    const tileStyle = MAP_TILE_STYLES[mapStyle] || MAP_TILE_STYLES.stylized;
    const baseLayer = L.tileLayer(tileStyle.url, {
        tileSize: TILE_SIZE,
        maxNativeZoom: tileStyle.maxNativeZoom ?? 5,
        noWrap: true,
        errorTileUrl: "tiles/loading.jpg",
        bounds: MAP_BOUNDS,
        continuousWorld: false,
        // Tile smoothness: do not fetch new tiles DURING the zoom animation (the existing tiles scale and
        // sharpen at zoomend) -> smoother zoom; keep a wider ring of tiles around the viewport so panning
        // back does not refetch. Targets perceived zoom/pan sluggishness; the vector pipeline is untouched.
        updateWhenZooming: false,
        keepBuffer: 4,
    });
    if (window.AvesmapsLoadingBar) {
        window.AvesmapsLoadingBar.attachTiles(baseLayer);
    }
    return baseLayer;
}

function getInitialMapStyle() {
    const queryStyle = INITIAL_SEARCH_PARAMS.get("mapstyle");
    if (queryStyle && MAP_TILE_STYLES[queryStyle]) {
        return queryStyle;
    }

    if (!IS_EDIT_MODE) {
        return "stylized";
    }

    try {
        const storedStyle = window.localStorage?.getItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY);
        if (storedStyle && MAP_TILE_STYLES[storedStyle]) {
            return storedStyle;
        }
    } catch (error) {
        console.warn("Mapstyle konnte nicht wiederhergestellt werden:", error);
    }

    return "stylized";
}

// NOTE: js/ui/route-planner-toggle.js (loaded later) intentionally wraps window.setMapStyle as
// setMapStyleWithBlankOption to add the "none" blank-background map style, delegating here for every other
// style. Changes to the public setMapStyle behavior may need mirroring there. See docs/cleanup-audit-2026-06-27.md (A2).
function setMapStyle(mapStyle, { persist = false } = {}) {
    if (!MAP_TILE_STYLES[mapStyle] || mapStyle === activeMapStyle && baseTileLayer) {
        return;
    }

    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
    }

    activeMapStyle = mapStyle;
    baseTileLayer = createBaseTileLayer(activeMapStyle).addTo(map);
    baseTileLayer.bringToBack();
    document.getElementById("mapStyleSelect").value = activeMapStyle;
    syncLocationNameLabelVisibility();
    // Neu erstellte Basis-Kacheln -> ggf. die "Magiersicht"-Entsättigung erneut anwenden (Kraftlinien-Modus).
    if (typeof syncPowerlineMapTint === "function") {
        syncPowerlineMapTint();
    }

    if (persist && IS_EDIT_MODE) {
        try {
            window.localStorage?.setItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY, activeMapStyle);
        } catch (error) {
            console.warn("Mapstyle konnte nicht gespeichert werden:", error);
        }
        syncPlannerStateToUrl();
    }
}

// Da liegen die Map-Tiles
activeMapStyle = getInitialMapStyle();
baseTileLayer = createBaseTileLayer(activeMapStyle).addTo(map);

if (IS_EDIT_MODE) {
    document.getElementById("mapStyleControl")?.removeAttribute("hidden");
    document.getElementById("mapStyleSelect").value = activeMapStyle;
    document.querySelector('.map-context-menu__group[data-context-action="add-here"]')?.removeAttribute("hidden");
    document.getElementById("toggleCrossingsControl")?.removeAttribute("hidden");
    document.getElementById("toggleCrossings")?.removeAttribute("disabled");
    document.getElementById("toggleUnconnectedControl")?.removeAttribute("hidden");
    document.getElementById("toggleUnconnected")?.removeAttribute("disabled");
    document.getElementById("toggleSparseCrossingsControl")?.removeAttribute("hidden");
    document.getElementById("toggleSparseCrossings")?.removeAttribute("disabled");
    document.getElementById("toggleNodixControl")?.removeAttribute("hidden");
    document.getElementById("toggleNodix")?.removeAttribute("disabled");
    document.getElementById("review-panel")?.removeAttribute("hidden");
    document.getElementById("review-panel-toggle")?.removeAttribute("hidden");
    restoreReviewPanelState();
    void loadReviewReports();
    void loadWikiSyncCases();
    void loadChangeLog();
    void sendEditorPresenceHeartbeat();
    startEditorPresenceHeartbeat();
    startReviewReportsPolling();
} else {
    document.getElementById("toggleCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleUnconnected")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleSparseCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleNodix")?.setAttribute("disabled", "disabled");
}

// UI-Interaktionen und Events

$("#review-panel-toggle").on("click", toggleReviewPanel);
window.addEventListener("beforeunload", () => {
    activeFeatureLocks.forEach((timerId) => window.clearInterval(timerId));
    if (editorPresenceTimerId) {
        window.clearInterval(editorPresenceTimerId);
    }
    if (reviewReportsPollTimerId) {
        window.clearInterval(reviewReportsPollTimerId);
    }
});
$("#review-panel-refresh").on("click", () => refreshActiveEditorPanel());
$("#review-report-refresh").on("click", () => loadReviewReports());
$(".review-panel__tab").on("click", function () {
    setEditorPanelTab(this.dataset.editorPanelTab || "review");
});

function setLegalDialogOpen(isOpen) {
    $("#legal-overlay").prop("hidden", !isOpen);
    $("#legal-button").attr("aria-expanded", isOpen ? "true" : "false");
    syncModalDialogBodyState();

    if (isOpen) {
        $("#legal-dialog").trigger("focus");
    } else {
        $("#legal-button").trigger("focus");
    }
}

$("#legal-button").on("click", () => setLegalDialogOpen(true));
$("#legal-close").on("click", () => setLegalDialogOpen(false));
$("#legal-overlay").on("click", function (event) {
    if (event.target === this) {
        setLegalDialogOpen(false);
    }
});
$("#location-report-close, #location-report-cancel").on("click", () => setLocationReportDialogOpen(false, { resetForm: true }));
$("#location-edit-close, #location-edit-cancel").on("click", () => setLocationEditDialogOpen(false, { resetForm: true }));
$("#wiki-sync-territories").on("click", () => startWikiSyncTerritoryRun());
$("#settlement-editor-open").on("click", () => openAvesmapsSettlementEditorOverlay());
$("#adventure-editor-open").on("click", () => openAvesmapsAdventureEditorOverlay());
$("#citymaps-editor-open").on("click", () => openAvesmapsCitymapEditorOverlay());
// WikiDump hybrid read (H4c-f): sandbox read loop + inline cred-prompt.
$("#wiki-sync-dump-read").on("click", () => startWikiSyncDumpRead());
// Per-kind "Syncen" (Wave 2): one button per tab drives sync_kind for that kind.
$("#wiki-sync-sync-settlement").on("click", () => startWikiSyncKindSync("settlement"));
$("#wiki-sync-sync-path").on("click", () => startWikiSyncKindSync("path"));
$("#wiki-sync-sync-region").on("click", () => startWikiSyncKindSync("region"));
// Abenteuer (Phase 4): its OWN reconcile action (sync_adventures), not a sync_kind -- so its own handler.
$("#wiki-sync-sync-adventure").on("click", () => startWikiSyncAdventuresSync());
// Natur & Waren (Flora/Fauna/Spezies/Handelswaren): likewise its OWN reconcile action
// (sync_lore), driven in ~35 bounded steps -- see runWikiSyncLoreSyncLoop.
$("#wiki-sync-sync-lore").on("click", () => startWikiSyncLoreSync());
// Linkchecker: no binding here on purpose. The "Links prüfen" buttons live in the editor DIALOGS
// (adventure-editor / wiki-sync-settlement-editor / wiki-sync-monitor), each scoped to its own entity
// type; they call window.parent.startLinkCheck(scope, onProgress) from their iframe, exactly like the
// "Syncen" buttons already delegate to startWikiSyncKindSync.
$("#wiki-sync-dump-credentials-form").on("submit", (event) => {
    event.preventDefault();
    void submitWikiSyncDumpCredentials();
});
$("#wiki-sync-dump-credentials-close, #wiki-sync-dump-credentials-cancel").on("click", () => closeWikiSyncDumpCredentialsPrompt(false));
$("[data-wiki-sync-panel-tab]").on("click", function () {
    setWikiSyncPanelTab(this.dataset.wikiSyncPanelTab || "locations");
});
// Sub-Pills im "Meldungen"-Reiter (Community Meldungen / Bewertungen) — wie die WikiSync-Pills.
$(document).on("click", "[data-review-subtab]", function () {
    const sub = this.dataset.reviewSubtab || "reports";
    document.querySelectorAll("[data-review-subtab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.reviewSubtab === sub);
    });
    document.querySelectorAll("[data-review-subtab-section]").forEach((section) => {
        section.classList.toggle("is-active", section.dataset.reviewSubtabSection === sub);
    });
});
// Sub-Pills im "Materialien"-Reiter (Abenteuer / Karten) — dasselbe Muster wie oben.
// The citymap list loads LAZILY on first open, like the adventure list: it is an editor catalog fetch
// that nobody waiting on the Siedlungen tab should pay for.
$(document).on("click", "[data-material-subtab]", function () {
    const sub = this.dataset.materialSubtab || "adventures";
    document.querySelectorAll("[data-material-subtab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.materialSubtab === sub);
    });
    document.querySelectorAll("[data-material-subtab-section]").forEach((section) => {
        section.classList.toggle("is-active", section.dataset.materialSubtabSection === sub);
    });
    if (sub === "citymaps" && typeof window.loadWikiSyncCitymapList === "function") {
        void window.loadWikiSyncCitymapList(false);
    }
    // Natur & Waren: dieselbe Lazy-Regel -- der Katalog wird erst beim ersten Öffnen
    // geholt, nicht schon beim Laden der Karte.
    if (sub === "lore" && typeof window.loadLoreList === "function") {
        window.loadLoreList();
    }
});
$("#wiki-sync-filter").on("input search", function () {
    setWikiSyncFilterQuery(this.value || "");
});
$("#wiki-sync-territory-filter").on("input search", function () {
    setWikiSyncTerritoryFilterQuery(this.value || "");
});
$("#wiki-sync-territory-tabs").on("click", "[data-territory-mapstatus]", function () {
    setWikiSyncTerritoryMapStatus(this.dataset.territoryMapstatus || "all");
});
$("#wiki-sync-territory-time-from, #wiki-sync-territory-time-to").on("input", function () {
    void renderWikiSyncTerritoryTree();
});
$("#wiki-sync-territory-time-today").on("change", function () {
    const today = this.checked;
    const fromInput = document.getElementById("wiki-sync-territory-time-from");
    const toInput = document.getElementById("wiki-sync-territory-time-to");
    if (fromInput) fromInput.disabled = today;
    if (toInput) toInput.disabled = today;
    void renderWikiSyncTerritoryTree();
});
$("#wiki-sync-territory-flaechenland").on("change", function () {
    void renderWikiSyncTerritoryTree();
});
// Auf `document`, NICHT auf einen Container. Die WikiSync-Faelle wurden ins Konfliktfenster
// verlegt; ihr alter Wirt #wiki-sync-case-list ist seitdem ein verstecktes Ankerelement, und weil
// die Delegation daran hing, war JEDER Knopf JEDER eingegliederten Fallart tot -- gezeichnet,
// anklickbar, ohne Wirkung. Aufgefallen ist es dem Owner an "Anzeigen"/"Position waehlen"
// (2026-07-21); betroffen waren alle zwoelf Fallarten. Ein Container-Wirt macht die Bindung von
// der DOM-Lage abhaengig, und die aendert sich wieder -- der Selektor ist eindeutig genug.
$(document).on("click", "[data-wiki-sync-action]", handleWikiSyncCaseActionClick);
$("#wiki-sync-conflicts-open").on("click", () => setWikiSyncConflictsDialogOpen(true));
$("#conflict-rescan").on("click", () => loadConflicts({ rescan: true }));
$("#conflict-minimize").on("click", () => setConflictDialogMinimized(!conflictMinimized));
$("#conflict-search").on("input search", function () {
    conflictFilter.query = String($(this).val() || "").trim();
    renderConflicts();
});
$("#wiki-sync-conflicts-close").on("click", () => setWikiSyncConflictsDialogOpen(false));
$("#wiki-sync-resolve-close, #wiki-sync-resolve-cancel").on("click", () => setWikiSyncResolveDialogOpen(false, { resetForm: true }));
$("#wiki-sync-preset-wiki").on("click", () => applyWikiSyncResolvePreset("wiki"));
$("#wiki-sync-preset-avesmap").on("click", () => applyWikiSyncResolvePreset("avesmap"));
$("#wiki-sync-resolve-wiki-open").on("click", () => openWikiSyncResolveWikiLink());
$("#wiki-sync-resolve-wiki-url").on("input", () => syncWikiSyncResolveLinkButton());
$("#location-report-type").on("change", syncLocationReportTypeFields);
$("#location-report-form").on("submit", handleLocationReportFormSubmit);
// Multi-source #3: dynamic source list in the community report form (add / remove / Enter-to-add).
$("#report-source-add-btn").on("click", addLocationReportSourceFromInputs);
// Instruction 5a: suggest existing catalog sources on the name field. MUST be wired before the
// Enter binding below -- both listen on #report-source-label, native listeners fire in registration
// order, and the autocomplete has to be able to swallow Enter (stopImmediatePropagation) when it is
// picking a suggestion instead of letting "Enter adds the source" run with half-filled fields.
initLocationReportSourceAutocomplete();
$("#location-report-pick-position").on("click", startChangePositionPick);
$("#location-report-sources-list").on("click", (event) => {
	const removeButton = event.target.closest("[data-remove-report-source]");
	if (removeButton) {
		removeLocationReportSource(Number(removeButton.getAttribute("data-remove-report-source")));
	}
});
$("#report-source-label, #report-source-url, #report-source-pages").on("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		addLocationReportSourceFromInputs();
	}
});
$("#location-edit-form").on("submit", handleLocationEditFormSubmit);
$("#wiki-sync-resolve-form").on("submit", handleWikiSyncResolveFormSubmit);
$("#path-edit-form").on("submit", handlePathEditFormSubmit);
$("#powerline-edit-form").on("submit", handlePowerlineEditFormSubmit);
$("#label-edit-form").on("submit", handleLabelEditFormSubmit);
$("#powerline-edit-delete").on("click", () => void deletePowerlineFeature(powerlineEditFeature));
$("#label-edit-delete").on("click", () => deleteActiveLabel());
$("#label-edit-min-zoom, #label-edit-max-zoom").on("input", syncLabelZoomRangeOutputs);
$("#label-edit-min-zoom-num, #label-edit-max-zoom-num").on("input", syncLabelZoomNumberInputs);
$("#label-edit-priority").on("input", syncLabelPriorityOutput);
$("#region-edit-form").on("submit", handleRegionEditFormSubmit);
$("#region-edit-delete").on("click", () => deleteActiveRegion());
$("#region-edit-opacity").on("input", syncRegionOpacityOutput);
$("#region-edit-coat-url").on("input", syncRegionCoatPreview);
$("#region-edit-valid-open").on("change", syncRegionValidToControls);
$("#region-edit-parent-filter").on("input search", function () {
    updateRegionParentFilter(this.value || "");
});
$("#region-edit-parent-filter-clear").on("click", () => {
    $("#region-edit-parent-filter").val("");
    updateRegionParentFilter("");
});
$("#region-edit-change-wiki").on("click", () => void openRegionWikiPickerDialog());
$("#region-wiki-picker-close, #region-wiki-picker-cancel").on("click", () => setRegionWikiPickerDialogOpen(false));
$("#region-wiki-picker-filter").on("input search", function () {
    renderRegionWikiPickerList(this.value || "");
});
$("#region-wiki-picker-list").on("click", "[data-wiki-reference-id]", function () {
    applyRegionWikiReferenceSelection(this.dataset.wikiReferenceId || "");
});
$("#region-operation-cancel").on("click", cancelPendingRegionOperation);
$("#political-timeline-range, #political-timeline-year").on("input change", function () {
    setPoliticalTimelineYear(this.value);
});
$("#path-edit-autoname").on("change", syncPathAutoNameControls);
$("#path-edit-type").on("change", () => {
    syncPathAutoNameControls({ forceName: true });
    syncPathTransportOptions({ resetToDefault: true });
});
$("#path-edit-close, #path-edit-cancel").on("click", () => setPathEditDialogOpen(false, { resetForm: true }));
$("#powerline-edit-close, #powerline-edit-cancel").on("click", () => setPowerlineEditDialogOpen(false, { resetForm: true }));
$("#label-edit-close, #label-edit-cancel").on("click", () => setLabelEditDialogOpen(false, { resetForm: true }));
$("#region-edit-close, #region-edit-cancel").on("click", () => setRegionEditDialogOpen(false, { resetForm: true }));
$(document).on("keydown", (event) => {
    if (handleChangeLogUndoShortcut(event)) {
        return;
    }

    if (event.key === "Escape" && isLocationReportDialogOpen()) {
        setLocationReportDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && window.AvesmapsPoliticalTerritoryEditorLink?.isOpen?.()) {
        window.AvesmapsPoliticalTerritoryEditorLink.close();
        return;
    }

    if (event.key === "Escape" && isPathEditDialogOpen()) {
        setPathEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isPowerlineEditDialogOpen()) {
        setPowerlineEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isLabelEditDialogOpen()) {
        setLabelEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isRegionWikiPickerDialogOpen()) {
        setRegionWikiPickerDialogOpen(false);
        return;
    }

    if (event.key === "Escape" && isRegionEditDialogOpen()) {
        setRegionEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isWikiSyncConflictsDialogOpen()) {
        setWikiSyncConflictsDialogOpen(false);
        return;
    }

    if (event.key === "Escape" && !$("#legal-overlay").prop("hidden")) {
        setLegalDialogOpen(false);
        return;
    }

    if (event.key === "Escape" && activeEditorPanelTab === "wiki-sync" && isWikiSyncCreateLocationSelectionActive) {
        event.preventDefault();
        event.stopPropagation();
        resetWikiSyncCreateLocationFlowState();
        renderWikiSyncCases();
        return;
    }

    if (event.key === "Escape") {
        if (pendingRegionOperation) {
            cancelPendingRegionOperation();
            return;
        }

        if (clearChangeLogFocusMarker()) {
            return;
        }

        clearPendingPathCreation();
        clearPathGeometryEdit();
        clearRegionGeometryEdit();
        closeMapContextMenu();
        closeRegionContextMenu();
    }
});

function getMapContextMenuElement() {
    return document.getElementById("map-context-menu");
}

function createMapContextMenuAnchorIcon() {
    return L.divIcon({
        className: "map-context-anchor-marker",
        html: '<span class="map-context-anchor-marker__dot" aria-hidden="true"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
}

function clearMapContextMenuAnchor() {
    if (!contextMenuAnchorMarker) {
        return;
    }

    map.removeLayer(contextMenuAnchorMarker);
    contextMenuAnchorMarker = null;
}

function setMapContextMenuAnchor(latlng) {
    clearMapContextMenuAnchor();
    contextMenuAnchorMarker = L.marker(L.latLng(latlng), {
        icon: createMapContextMenuAnchorIcon(),
        keyboard: false,
        interactive: false,
        pane: "measurementHandlesPane",
        zIndexOffset: 1200,
    }).addTo(map);
}

function closeMapContextMenu() {
    const menuElement = getMapContextMenuElement();
    if (!menuElement) {
        return;
    }

    menuElement.hidden = true;
    pendingContextMenuLatLng = null;
    pendingPathSplit = null;
    clearMapContextMenuAnchor();
}

function syncPathSplitContextMenuAction() {
    const splitActionElement = document.querySelector('[data-context-action="split-path-at-node"]');
    if (!splitActionElement) {
        return;
    }

    splitActionElement.hidden = !pendingPathSplit;
}

function openMapContextMenu(latlng, clientX, clientY) {
    const menuElement = getMapContextMenuElement();
    if (!menuElement) {
        return;
    }

    pendingContextMenuLatLng = L.latLng(latlng);
    setMapContextMenuAnchor(pendingContextMenuLatLng);
    syncDistanceMeasurementContextMenuAction();
    syncPathSplitContextMenuAction();
    syncWikiSyncCreateLocationContextMenuAction();
    if (typeof syncShareLinkContextMenuAction === "function") {
        syncShareLinkContextMenuAction();
    }
    menuElement.hidden = false;
    menuElement.style.left = `${clientX + MAP_CONTEXT_MENU_OFFSET_X}px`;
    menuElement.style.top = `${clientY + MAP_CONTEXT_MENU_OFFSET_Y}px`;

    const menuWidth = menuElement.offsetWidth;
    const menuHeight = menuElement.offsetHeight;
    const preferredLeft = clientX + MAP_CONTEXT_MENU_OFFSET_X;
    const preferredTop = clientY + MAP_CONTEXT_MENU_OFFSET_Y;
    const left = Math.max(
        MAP_CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(preferredLeft, window.innerWidth - menuWidth - MAP_CONTEXT_MENU_VIEWPORT_PADDING)
    );
    const top = Math.max(
        MAP_CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(preferredTop, window.innerHeight - menuHeight - MAP_CONTEXT_MENU_VIEWPORT_PADDING)
    );

    menuElement.style.left = `${left}px`;
    menuElement.style.top = `${top}px`;
}

function shouldIgnoreDistanceMeasurementClickTarget(target) {
    const targetElement = target instanceof Element ? target : null;
    if (!targetElement) {
        return false;
    }

    return Boolean(targetElement.closest(
        ".leaflet-control, .leaflet-popup, .location-tooltip, .map-context-menu, .measurement-handle-marker, #search, #toggle-button, #review-panel, #review-panel-toggle, #spotlight-search-overlay, #political-territory-editor-overlay, #location-report-overlay, #location-edit-overlay, #wiki-sync-resolve-overlay, #path-edit-overlay, #label-edit-overlay, #region-edit-overlay, #region-wiki-picker-overlay"
    ));
}

function handleDistanceMeasurementContainerClick(event) {
    if (!isAwaitingDistanceMeasurementEnd || event.button !== 0) {
        return;
    }

    if (shouldIgnoreDistanceMeasurementClickTarget(event.target)) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    completeDistanceMeasurementAt(map.mouseEventToLatLng(event));
}

map.on("contextmenu", (event) => {
    event.originalEvent?.preventDefault();
    openMapContextMenu(
        event.latlng,
        event.originalEvent?.clientX ?? 0,
        event.originalEvent?.clientY ?? 0
    );
});
map.on("click", closeMapContextMenu);
map.on("click", closeRegionContextMenu);
map.on("click", clearChangeLogFocusMarker);
map.on("movestart", closeMapContextMenu);
window.addEventListener("resize", closeMapContextMenu);
map.getContainer().addEventListener("click", handleDistanceMeasurementContainerClick, true);
initializeSpotlightSearch();
syncDistanceMeasurementContextMenuAction();
updateLocationReportDialogAvailability();
preloadPoliticalTerritoryOptions();

function getLocationToggleButton(locationType) {
    return $(`.location-toggle[data-location-type="${locationType}"]`);
}

function isLocationTypeVisible(locationType) {
    return getLocationToggleButton(locationType).hasClass("is-active");
}

function getVisibleLocationTypeIndex() {
    return LOCATION_TYPE_VISIBILITY_ORDER.reduce((lastVisibleIndex, locationType, index) => {
        return isLocationTypeVisible(locationType) ? index : lastVisibleIndex;
    }, -1);
}

function setVisibleLocationTypesThrough(targetLocationType, { syncUrl = true } = {}) {
    const targetIndex = LOCATION_TYPE_VISIBILITY_ORDER.indexOf(targetLocationType);
    const activeTargetIndex = targetIndex === getVisibleLocationTypeIndex() ? -1 : targetIndex;
    LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
        getLocationToggleButton(locationType).toggleClass("is-active", activeTargetIndex >= 0 && index <= activeTargetIndex);
    });
    syncLocationMarkerVisibility();
    if (syncUrl) {
        syncPlannerStateToUrl();
    }
}

function previewVisibleLocationTypesThrough(targetLocationType = null) {
    const targetIndex = targetLocationType ? LOCATION_TYPE_VISIBILITY_ORDER.indexOf(targetLocationType) : -1;
    LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
        getLocationToggleButton(locationType).toggleClass("is-hover-preview", targetIndex >= 0 && index <= targetIndex);
    });
}

function syncLocationToggleButtons() {
    LOCATION_TYPE_KEYS.forEach((locationType) => {
        const $button = getLocationToggleButton(locationType);
        const isActive = $button.hasClass("is-active");
        $button
            .toggleClass("is-inactive", !isActive)
            .attr("aria-pressed", isActive ? "true" : "false");
    });
}




