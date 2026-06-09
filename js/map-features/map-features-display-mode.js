function syncPathVisibility() {
	const showPaths = $("#togglePaths").is(":checked");
	const showRivers = $("#toggleRivers").is(":checked");
	const showSeaPaths = IS_EDIT_MODE && $("#toggleSeaPaths").is(":checked");

	// Standardmäßig folgen die Fluss-Labels den Fluss-Pfaden. Sobald im ?pathtune=1-Panel der Label-Schalter
	// benutzt wurde (Override), bleibt die Entkopplung bestehen: Pfade ausblenden lässt die Labels stehen.
	if (typeof pathRiverLabelsOverridden !== "undefined" && !pathRiverLabelsOverridden) {
		pathRiverLabelsVisible = showRivers;
	}

	$.each(pathLayers, (i, layer) => {
		const path = pathData[i];
		const shouldShow = shouldShowPathOnMap(path, { showPaths, showRivers, showSeaPaths });
		map[shouldShow ? "addLayer" : "removeLayer"](layer);
		// Label-Linie dauerhaft auf der Karte halten (nicht im Group); der Text wird über refreshPathLayerText
		// gesteuert -> Fluss-Labels bleiben sichtbar, auch wenn die Fluss-Pfade ausgeblendet sind.
		if (path?._pathLabelLine) {
			map.addLayer(path._pathLabelLine);
		}
		if (typeof refreshPathLayerText === "function") {
			refreshPathLayerText(path);
		}
	});
}

function shouldShowPathOnMap(path, { showPaths = true, showRivers = false, showSeaPaths = false } = {}) {
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);

	if (subtype === "Flussweg") {
		return showRivers;
	}

	if (subtype === "Seeweg") {
		return showSeaPaths;
	}

	return showPaths;
}
 

function getSelectedMapLayerMode() {
	return String($("#mapLayerModeSelect").val() || DEFAULT_PLANNER_STATE.mapLayerMode);
}

function setSelectedMapLayerMode(mode) {
	const normalizedMode = ["none", "political", "deregraphic", "powerlines"].includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
	$("#mapLayerModeSelect").val(normalizedMode);
	syncTransportControl("mapLayerModeSelect");
	if (IS_EDIT_MODE && normalizedMode === "powerlines") {
		$("#toggleNodix").prop("checked", true);
		syncLocationMarkerVisibility();
	}
	syncRegionVisibility();
	syncLabelVisibility();
	syncPowerlineVisibility();
	syncPlannerStateToUrl();
}

function applyDisplayOptions() {
	syncLocationToggleButtons();
	syncLocationMarkerVisibility();
	syncPathVisibility();
	syncPowerlineVisibility();
	syncRegionVisibility();
	syncLabelVisibility();
}
