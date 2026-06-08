
// Initialisierung der Karte 
const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: 6,
    bounds: MAP_BOUNDS,
    continuousWorld: false,
    noWrap: true,
    zoomControl: false,
}).setView([IMG_HEIGHT / 2, IMG_WIDTH / 2], 0);

// Rendering-Reihenfolge
map.createPane("regionsPane");
map.createPane("mapDecorationsPane");
map.createPane("roadsOutlinePane");
map.createPane("roadsPane");
map.createPane("powerlinesPane");
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
map.getPane("routePane").style.zIndex = 450;
map.getPane("measurementPane").style.zIndex = 460;
map.getPane("measurementHandlesPane").style.zIndex = 520;
map.getPane("regionLabelsPane").style.zIndex = 475;
map.getPane("locationsPane").style.zIndex = 500;
map.getPane("labelsPane").style.zIndex = 650;
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
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        ensurePowerlineAnimationLoop();
        return;
    }
    stopPowerlineAnimationLoop();
});

function createBaseTileLayer(mapStyle) {
    const tileStyle = MAP_TILE_STYLES[mapStyle] || MAP_TILE_STYLES.stylized;
    return L.tileLayer(tileStyle.url, {
        tileSize: TILE_SIZE,
        maxNativeZoom: tileStyle.maxNativeZoom ?? 5,
        noWrap: true,
        errorTileUrl: "tiles/loading.jpg",
        bounds: MAP_BOUNDS,
        continuousWorld: false,
    });
}

function getInitialMapStyle() {
    if (!IS_EDIT_MODE) {
        return "stylized";
    }

    const queryStyle = INITIAL_SEARCH_PARAMS.get("mapstyle");
    if (queryStyle && MAP_TILE_STYLES[queryStyle]) {
        return queryStyle;
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

function setMapStyle(mapStyle, { persist = false } = {}) {
    if (!IS_EDIT_MODE && mapStyle !== "stylized") {
        mapStyle = "stylized";
    }

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
} else {
    document.getElementById("toggleCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleNodix")?.setAttribute("disabled", "disabled");
}

// UI-Interaktionen und Events

$("#review-panel-toggle").on("click", toggleReviewPanel);
window.addEventListener("beforeunload", () => {
    activeFeatureLocks.forEach((timerId) => window.clearInterval(timerId));
    if (editorPresenceTimerId) {
        window.clearInterval(editorPresenceTimerId);
    }
});
$("#review-panel-refresh").on("click", () => refreshActiveEditorPanel());
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
$("#wiki-sync-start").on("click", () => startWikiSyncRun());
$("#wiki-sync-territories").on("click", () => startWikiSyncTerritoryRun());
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
$("#wiki-sync-case-list").on("click", "[data-wiki-sync-action]", handleWikiSyncCaseActionClick);
$("#wiki-sync-resolve-close, #wiki-sync-resolve-cancel").on("click", () => setWikiSyncResolveDialogOpen(false, { resetForm: true }));
$("#wiki-sync-preset-wiki").on("click", () => applyWikiSyncResolvePreset("wiki"));
$("#wiki-sync-preset-avesmap").on("click", () => applyWikiSyncResolvePreset("avesmap"));
$("#wiki-sync-resolve-wiki-open").on("click", () => openWikiSyncResolveWikiLink());
$("#wiki-sync-resolve-wiki-url").on("input", () => syncWikiSyncResolveLinkButton());
$("#location-report-type").on("change", syncLocationReportTypeFields);
$("#location-report-form").on("submit", handleLocationReportFormSubmit);
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




