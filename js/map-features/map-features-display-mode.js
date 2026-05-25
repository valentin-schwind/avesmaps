function syncPathVisibility() {
	const showPaths = $("#togglePaths").is(":checked");
	const showRivers = $("#toggleRivers").is(":checked");
	const showSeaPaths = IS_EDIT_MODE && $("#toggleSeaPaths").is(":checked");

	$.each(pathLayers, (i, layer) => {
		const path = pathData[i];
		const shouldShow = shouldShowPathOnMap(path, { showPaths, showRivers, showSeaPaths });
		map[shouldShow ? "addLayer" : "removeLayer"](layer);
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
