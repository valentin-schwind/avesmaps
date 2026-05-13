// Location markers and labels
const VISUAL_MAX_ZOOM_LEVEL = 5;
const LOCATION_LABEL_GAP = 11;
const LOCATION_LABEL_SHIFT_SMALL = 8;
const LOCATION_LABEL_COLLISION_PADDING = 2;

function getVisualZoomLevel(zoomLevel = map.getZoom()) {
	const roundedZoomLevel = Math.round(Number(zoomLevel));
	if (!Number.isFinite(roundedZoomLevel)) {
		return 0;
	}

	return Math.max(0, Math.min(VISUAL_MAX_ZOOM_LEVEL, roundedZoomLevel));
}

function locationZoomScale(zoomLevel) {
	const zoomScales = {
		0: 0.45,
		1: 0.6,
		2: 0.78,
		3: 1,
		4: 1.18,
		5: 1.36,
	};
	return zoomScales[getVisualZoomLevel(zoomLevel)] || zoomScales[VISUAL_MAX_ZOOM_LEVEL];
}

const LOCATION_NAME_LABEL_SIZE_BY_ZOOM = {
	metropole: { 0: 9, 1: 10, 2: 12, 3: 14, 4: 18, 5: 20 },
	grossstadt: { 0: 9, 1: 9.5, 2: 11, 3: 13, 4: 16, 5: 18 },
	stadt: { 0: 9, 1: 9, 2: 10, 3: 12, 4: 14, 5: 16 },
	kleinstadt: { 0: 9, 1: 9, 2: 9.5, 3: 10.5, 4: 12, 5: 14 },
	dorf: { 0: 9, 1: 9, 2: 9, 3: 9.5, 4: 11, 5: 12 },
	gebaeude: { 0: 9, 1: 9, 2: 9, 3: 9, 4: 10, 5: 10 },
};

function getVillageMarkerStyle(zoomLevel = map.getZoom()) {
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	const villageZoomStyles = {
		0: { radius: 1.5, borderWidth: 0 },
		1: { radius: 1.5, borderWidth: 0 },
		2: { radius: 1.25, borderWidth: 0 },
		3: { radius: 2, borderWidth: 1.5 },
		4: { radius: 3, borderWidth: 2 },
		5: { radius: 4, borderWidth: 2 },
	};

	return villageZoomStyles[visualZoomLevel] || villageZoomStyles[VISUAL_MAX_ZOOM_LEVEL];
}

function getBuildingMarkerStyle(zoomLevel = map.getZoom()) {
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	const buildingZoomStyles = {
		0: { radius: 0.5, borderWidth: 0 },
		1: { radius: 1, borderWidth: 0 },
		2: { radius: 1, borderWidth: 0 },
		3: { radius: 1.5, borderWidth: 0 },
		4: { radius: 1.25, borderWidth: 1 },
		5: { radius: 2.75, borderWidth: 2 },
	};

	return buildingZoomStyles[visualZoomLevel] || buildingZoomStyles[VISUAL_MAX_ZOOM_LEVEL];
}

function isVillageMarkerStyleLocation(locationType) {
	return locationType === "dorf" || locationType === "gebaeude";
}

function getLocationMarkerSize(locationType, zoomLevel = map.getZoom()) {
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	if (locationType === CROSSING_LOCATION_TYPE) {
		return visualZoomLevel <= 3 ? 5 : Math.max(7, 5 + visualZoomLevel * 1.5);
	}

	if (isVillageMarkerStyleLocation(locationType)) {
		const villageStyle = locationType === "gebaeude" ? getBuildingMarkerStyle(zoomLevel) : getVillageMarkerStyle(zoomLevel);
		return villageStyle.radius * 2 + villageStyle.borderWidth * 2;
	}

	const config = LOCATION_TYPE_CONFIG[locationType] || LOCATION_TYPE_CONFIG.dorf;
	return config.radius * locationZoomScale(zoomLevel) * 2 + 1;
}

function getLocationMarkerBorderWidth(locationType, zoomLevel = map.getZoom()) {
	const config = LOCATION_TYPE_CONFIG[locationType] || LOCATION_TYPE_CONFIG.dorf;
	if (isVillageMarkerStyleLocation(locationType)) {
		return locationType === "gebaeude" ? getBuildingMarkerStyle(zoomLevel).borderWidth : getVillageMarkerStyle(zoomLevel).borderWidth;
	}

	return config.borderWidth;
}

function createLocationMarkerIcon(locationType, zoomLevel = map.getZoom()) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		const markerSize = getLocationMarkerSize(locationType, zoomLevel);
		const isSimpleMarker = getVisualZoomLevel(zoomLevel) <= 3;
		const iconHtml = `<span class="location-visual-marker__shape location-visual-marker__shape--crossing${isSimpleMarker ? " location-visual-marker__shape--simple" : ""}" style="width:${markerSize}px;height:${markerSize}px;"></span>`;

		return L.divIcon({
			className: `location-visual-marker location-visual-marker--crossing${isSimpleMarker ? " location-visual-marker--simple" : ""}`,
			html: iconHtml,
			iconSize: [markerSize, markerSize],
			iconAnchor: [markerSize / 2, markerSize / 2],
			popupAnchor: [0, -(markerSize / 2)],
		});
	}

	const config = LOCATION_TYPE_CONFIG[locationType] || LOCATION_TYPE_CONFIG.dorf;
	const markerSize = getLocationMarkerSize(locationType, zoomLevel);
	const isSimpleMarker = locationType === "dorf"
		? getVisualZoomLevel(zoomLevel) <= 2
		: locationType === "gebaeude"
			? getVisualZoomLevel(zoomLevel) <= 3
			: false;
	const shapeClassName = config.shape === "square"
		? `location-visual-marker__shape location-visual-marker__shape--square${isSimpleMarker ? " location-visual-marker__shape--simple" : ""}`
		: `location-visual-marker__shape location-visual-marker__shape--circle${isSimpleMarker ? " location-visual-marker__shape--simple" : ""}`;
	const shadowBlur = locationType === "dorf"
		? (getVisualZoomLevel(zoomLevel) >= 4 ? 2.5 : getVisualZoomLevel(zoomLevel) === 3 ? 2.25 : 2)
		: 2;
	const iconHtml = `<span${buildHtmlAttributes({
		class: shapeClassName,
		style: `width:${markerSize}px;height:${markerSize}px;border-width:${getLocationMarkerBorderWidth(locationType, zoomLevel)}px;--location-marker-shadow-blur:${shadowBlur}px;`,
	})}></span>`;

	return L.divIcon({
		className: `location-visual-marker${isSimpleMarker ? " location-visual-marker--simple" : ""}`,
		html: iconHtml,
		iconSize: [markerSize, markerSize],
		iconAnchor: [markerSize / 2, markerSize / 2],
		popupAnchor: [0, -(markerSize / 2)],
	});
}

function shouldShowLocationMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	if (entry.locationType === CROSSING_LOCATION_TYPE) {
		return IS_EDIT_MODE
			&& $("#toggleCrossings").is(":checked")
			&& zoomLevel >= 3
			&& isMarkerEntryInRenderBounds(entry, renderBounds);
	}

	const isVisibleByNodixToggle = IS_EDIT_MODE && $("#toggleNodix").is(":checked") && isNodixLocation(entry.location);
	const minZoomByType = entry.locationType === "dorf"
		? 2
		: entry.locationType === "gebaeude"
			? 3
			: 0;
	return (isVisibleByNodixToggle || isLocationTypeVisible(entry.locationType))
		&& zoomLevel >= minZoomByType
		&& isMarkerEntryInRenderBounds(entry, renderBounds);
}

function syncLocationMarkerVisibility() {
	syncLocationToggleButtons();
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	$.each(locationMarkers, (i, entry) => {
		const shouldShow = shouldShowLocationMarker(entry, zoomLevel, renderBounds);
		if (shouldShow || map.hasLayer(entry.marker)) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, zoomLevel));
		}
		map[shouldShow ? "addLayer" : "removeLayer"](entry.marker);
	});
	syncLocationNameLabelVisibility();
}

function getMapRenderBounds() {
	return map.getBounds().pad(0.2);
}

function isLatLngInRenderBounds(latlng, renderBounds = getMapRenderBounds()) {
	return renderBounds.contains(L.latLng(latlng));
}

function isMarkerEntryInRenderBounds(entry, renderBounds = getMapRenderBounds()) {
	return entry?.marker && isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

function getLocationNameLabelSize(locationType, zoomLevel = map.getZoom()) {
	const roundedZoomLevel = getVisualZoomLevel(zoomLevel);
	const sizeByZoom = LOCATION_NAME_LABEL_SIZE_BY_ZOOM[locationType] || LOCATION_NAME_LABEL_SIZE_BY_ZOOM.dorf;
	return Math.max(9, Number(sizeByZoom[roundedZoomLevel] ?? sizeByZoom[VISUAL_MAX_ZOOM_LEVEL] ?? sizeByZoom[4] ?? sizeByZoom[3] ?? sizeByZoom[2] ?? sizeByZoom[1] ?? sizeByZoom[0] ?? 9));
}

function getLocationNameLabelOffset(labelSize, zoomLevel = map.getZoom()) {
	const baseOffset = { x: LOCATION_LABEL_GAP };
	const scale = Math.max(1, locationZoomScale(zoomLevel));
	const labelHeightInPixels = labelSize * 4 / 3;
	return {
		x: Math.round(baseOffset.x * scale),
		y: Math.round(1 - labelHeightInPixels / 2),
	};
}

function shouldShowLocationNameLabel(entry, zoomLevel = map.getZoom()) {
	if (activeMapStyle !== "stylized" || isCrossingLocation(entry.location)) {
		return false;
	}

	const config = LOCATION_NAME_LABEL_CONFIG[entry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	const isVisibleByNodixToggle = IS_EDIT_MODE
		&& $("#toggleNodix").is(":checked")
		&& isNodixLocation(entry.location)
		&& zoomLevel >= 2;
	return isVisibleByNodixToggle || (zoomLevel >= config.minZoom && isLocationTypeVisible(entry.locationType));
}

function createLocationNameLabelIcon(entry, zoomLevel = map.getZoom()) {
	const labelSize = getLocationNameLabelSize(entry.locationType, zoomLevel);
	const labelType = entry.locationType || "dorf";
	const offset = getLocationNameLabelOffset(labelSize, zoomLevel);
	const ruinedClassName = entry.location?.isRuined ? " location-name-label--ruined" : "";
	return L.divIcon({
		className: `location-name-label location-name-label--${labelType}${ruinedClassName}`,
		html: `<span style="font-size:${labelSize}pt; --location-label-offset-x:${offset.x}px; --location-label-offset-y:${offset.y}px;">${escapeHtml(entry.name)}</span>`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function createLocationNameLabelEntry(markerEntry) {
	const marker = L.marker(markerEntry.location.coordinates, {
		icon: createLocationNameLabelIcon(markerEntry),
		interactive: false,
		keyboard: false,
		pane: "labelsPane",
	});
	return { markerEntry, marker };
}

function syncLocationNameLabelVisibility() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	locationNameLabels.forEach((entry) => {
		const shouldShow = shouldShowLocationNameLabel(entry.markerEntry, zoomLevel)
			&& isMarkerEntryInRenderBounds(entry.markerEntry, renderBounds);
		if (!shouldShow) {
			map.removeLayer(entry.marker);
			return;
		}

		entry.marker.setLatLng(entry.markerEntry.marker.getLatLng());
		entry.marker.setIcon(createLocationNameLabelIcon(entry.markerEntry, zoomLevel));
		map.addLayer(entry.marker);
	});
	scheduleLabelCollisionResolution();
}

function syncPathVisibility() {
	const showPaths = $("#togglePaths").is(":checked");
	$.each(pathLayers, (i, layer) => {
		const path = pathData[i];
		const shouldShow = showPaths && shouldShowPathOnMap(path);
		map[shouldShow ? "addLayer" : "removeLayer"](layer);
	});
}

function shouldShowPathOnMap(path) {
	if (IS_EDIT_MODE) {
		return true;
	}

	return normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name) !== "Seeweg";
}

// Powerlines
function getPowerlineLatLngs(powerline) {
	const fromEntry = findLocationMarkerByPublicId(powerline.properties?.from_public_id);
	const toEntry = findLocationMarkerByPublicId(powerline.properties?.to_public_id);
	if (fromEntry && toEntry) {
		return [fromEntry.marker.getLatLng(), toEntry.marker.getLatLng()];
	}
	return powerline.geometry.coordinates.map(([x, y]) => L.latLng(y, x));
}

function getPowerlinePublicId(powerline) {
	return powerline?.properties?.public_id || powerline?.id || "";
}

function getPowerlineDisplayName(powerline) {
	return String(powerline?.properties?.name || "Kraftlinie").trim() || "Kraftlinie";
}

function createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds = 0) {
	if (latLngs.length < 2) {
		return latLngs;
	}

	const start = latLngs[0];
	const end = latLngs[latLngs.length - 1];
	const dx = end.lng - start.lng;
	const dy = end.lat - start.lat;
	const length = Math.sqrt(dx * dx + dy * dy) || 1;
	const tx = dx / length;
	const ty = dy / length;
	const nx = -ty;
	const ny = tx;
	const segmentCount = Math.max(2, Math.round(POWERLINE_RENDER_CONFIG.segmentCount));
	const phase = strandIndex * POWERLINE_RENDER_CONFIG.phaseStep;
	const normalScale = POWERLINE_RENDER_CONFIG.normalScales[strandIndex % POWERLINE_RENDER_CONFIG.normalScales.length];
	const waveOffset = POWERLINE_RENDER_CONFIG.waveOffsets[strandIndex % POWERLINE_RENDER_CONFIG.waveOffsets.length];
	const points = [];

	for (let index = 0; index <= segmentCount; index++) {
		const t = index / segmentCount;
		const envelope = Math.sin(Math.PI * t);
		const normalWave = Math.sin(index * 0.62 + phase) * envelope * 4.5;
		const tangentWave = Math.sin(index * 1.17 + phase) * envelope * 0.8;
		const tremorWave = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorNormalSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorNormalFrequency
			+ phase * POWERLINE_RENDER_CONFIG.tremorPhaseMultiplier
		) * envelope * POWERLINE_RENDER_CONFIG.tremorNormalAmplitude;
		const tremorTangent = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorTangentSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorTangentFrequency
			+ phase
		) * envelope * POWERLINE_RENDER_CONFIG.tremorTangentAmplitude;
		const normalOffset = (normalWave + tremorWave + waveOffset * envelope) * normalScale;

		points.push(L.latLng(
			start.lat + dy * t + ny * normalOffset + ty * (tangentWave + tremorTangent),
			start.lng + dx * t + nx * normalOffset + tx * (tangentWave + tremorTangent)
		));
	}

	return points;
}

function getPowerlineRenderStyles() {
	const styles = [];

	for (let strikeIndex = 0; strikeIndex < POWERLINE_RENDER_CONFIG.strandCount; strikeIndex++) {
		styles.push(
			{
				className: `powerline powerline--aura powerline--strike-${strikeIndex + 1}`,
				weight: 10,
				opacity: 0.34,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--mid powerline--strike-${strikeIndex + 1}`,
				weight: 4.6,
				opacity: 0.72,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--core powerline--strike-${strikeIndex + 1}`,
				weight: 1.5,
				opacity: 0.98,
				strandIndex: strikeIndex,
			}
		);
	}

	return styles;
}

function shouldPowerlineNameBeDisplayed(powerline) {
	return powerline?.properties?.show_label === true || powerline?.properties?.show_label === 1 || powerline?.properties?.show_label === "1";
}

function isPowerlineLabelVisibleAtCurrentZoom(powerline) {
	return shouldPowerlineNameBeDisplayed(powerline) && map.getZoom() >= 2;
}

function getPowerlineLabelStyle() {
	return {
		fill: "rgba(255, 196, 214, 0.98)",
		stroke: "transparent",
		strokeWidth: "0",
		paintOrder: "fill",
		fontFamily: 'Georgia, "Times New Roman", serif',
		fontSize: `${Math.max(18, getLocationNameLabelSize("dorf") + 7)}px`,
		fontWeight: "500",
		letterSpacing: "0",
	};
}

function getReadablePowerlineLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}

function refreshPowerlineLayerText(powerline) {
	const labelLine = powerline?._labelLine;
	if (!labelLine?.setText) {
		return;
	}

	if (!isPowerlineLabelVisibleAtCurrentZoom(powerline)) {
		labelLine.removeText?.();
		return;
	}

	labelLine.setText(getPowerlineDisplayName(powerline), {
		className: "path-name-text path-name-text--powerline",
		offset: "50%",
		textAnchor: "middle",
		dy: "-10",
		style: getPowerlineLabelStyle(),
	});
}

function syncPowerlineLabels() {
	powerlineData.forEach(refreshPowerlineLayerText);
}

function createPowerlinePopupMarkup(powerline) {
	return locationPopupMarkup({
		name: getPowerlineDisplayName(powerline),
		locationType: "dorf",
		locationTypeLabel: "Kraftlinie",
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Details bearbeiten",
				attributes: {
					"data-popup-action": "edit-powerline-details",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
			popupActionButtonMarkup({
				label: "Kraftlinie loeschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-powerline",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
		]) : "",
	});
}

function refreshPowerlineLayerPopup(powerline) {
	const popupMarkup = createPowerlinePopupMarkup(powerline);
	powerline._interactiveLines?.forEach((line) => line.bindPopup(popupMarkup));
}

function createPowerlineLayer(powerline) {
	const latLngs = getPowerlineLatLngs(powerline);
	const labelLine = L.polyline(getReadablePowerlineLabelLatLngCoordinates(latLngs), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const layers = [labelLine];
	const interactiveLines = [];
	getPowerlineRenderStyles().forEach(({ strandIndex, ...style }) => {
		const layer = L.polyline(createPowerlineStrandLatLngs(latLngs, strandIndex, powerlineAnimationTimeSeconds), {
			pane: "powerlinesPane",
			color: "#ff5f82",
			lineCap: "round",
			lineJoin: "round",
			interactive: style.className.includes("powerline--core"),
			...style,
		});
		layer._powerlineStrandIndex = strandIndex;
		layers.push(layer);
		if (layer.options.interactive) {
			interactiveLines.push(layer);
		}
	});
	const group = L.layerGroup(layers);
	powerline._layerGroup = group;
	powerline._labelLine = labelLine;
	powerline._interactiveLines = interactiveLines;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayerText(powerline);
	return group;
}

function normalizePowerlineFeature(feature) {
	const properties = feature.properties || {};
	return {
		id: feature.id || properties.public_id || "",
		geometry: feature.geometry,
		properties,
	};
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

function syncPowerlineVisibility() {
	const showPowerlines = getSelectedMapLayerMode() === "powerlines";
	powerlineLayers.forEach((layer) => map[showPowerlines ? "addLayer" : "removeLayer"](layer));
	if (showPowerlines) {
		ensurePowerlineAnimationLoop();
	} else {
		stopPowerlineAnimationLoop();
	}
}

function refreshPowerlineLayers(timeSeconds = powerlineAnimationTimeSeconds) {
	powerlineData.forEach((powerline) => {
		if (!powerline._layerGroup) {
			return;
		}
		const latLngs = getPowerlineLatLngs(powerline);
		powerline._layerGroup.eachLayer((layer) => {
			if (layer === powerline._labelLine) {
				layer.setLatLngs?.(getReadablePowerlineLabelLatLngCoordinates(latLngs));
				return;
			}
			const strandIndex = layer._powerlineStrandIndex || 0;
			layer.setLatLngs?.(createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds));
		});
		refreshPowerlineLayerText(powerline);
	});
}

function stopPowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null) {
		window.cancelAnimationFrame(powerlineAnimationFrameId);
		powerlineAnimationFrameId = null;
	}
	powerlineAnimationLastFrameMs = 0;
}

function shouldAnimatePowerlines() {
	return POWERLINE_RENDER_CONFIG.animationEnabled
		&& getSelectedMapLayerMode() === "powerlines"
		&& powerlineData.length > 0
		&& document.visibilityState === "visible";
}

function tickPowerlineAnimation(frameTimeMs) {
	if (!shouldAnimatePowerlines()) {
		stopPowerlineAnimationLoop();
		return;
	}

	if (powerlineAnimationLastFrameMs === 0) {
		powerlineAnimationLastFrameMs = frameTimeMs;
	}

	const elapsedMs = frameTimeMs - powerlineAnimationLastFrameMs;
	if (elapsedMs >= POWERLINE_RENDER_CONFIG.frameIntervalMs) {
		powerlineAnimationTimeSeconds += Math.min(elapsedMs, 120) / 1000;
		powerlineAnimationLastFrameMs = frameTimeMs;
		refreshPowerlineLayers(powerlineAnimationTimeSeconds);
	}

	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

function ensurePowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null || !shouldAnimatePowerlines()) {
		return;
	}
	powerlineAnimationLastFrameMs = 0;
	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

function syncRegionVisibility() {
	const showRegions = getSelectedMapLayerMode() === "political";
	if (!showRegions) {
		clearRegionGeometryEdit();
	}

	regionPolygons.forEach((layer) => {
		if (showRegions) {
			map.addLayer(layer);
		} else {
			map.removeLayer(layer);
		}
	});

	regionLabels.forEach((label) => {
		if (showRegions) {
			map.addLayer(label);
		} else {
			map.removeLayer(label);
		}
	});
}

function applyDisplayOptions() {
	syncLocationToggleButtons();
	syncLocationMarkerVisibility();
	syncPathVisibility();
	syncPowerlineVisibility();
	syncRegionVisibility();
	syncLabelVisibility();
}

$(".location-toggle").on("click", function () {
	setVisibleLocationTypesThrough(String(this.dataset.locationType || ""), { syncUrl: true });
});
$(".location-toggle").on("mouseenter focus", function () {
	previewVisibleLocationTypesThrough(String(this.dataset.locationType || ""));
});
$(".location-toggle").on("mouseleave blur", () => {
	previewVisibleLocationTypesThrough(null);
});
initializeTransportIconSelects();
initializeVersionedAssetIcons();
syncTransportControls();
$("#mapStyleSelect").on("change", function () {
	if (!IS_EDIT_MODE) {
		this.value = "stylized";
		return;
	}

	setMapStyle(String(this.value || "stylized"), { persist: true });
});
$("#togglePaths").change(syncPathVisibility);
$("#mapLayerModeSelect").change(() => {
	setSelectedMapLayerMode(getSelectedMapLayerMode());
});
$("#toggleCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleNodix").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});

function isCrossingName(name) {
	return typeof name === "string" && /^Kreuzung(?:-\d+)?$/i.test(name);
}

function isCrossingLocation(location) {
	return location?.locationType === CROSSING_LOCATION_TYPE || isCrossingName(location?.name);
}

function isNodixLocation(location) {
	return Boolean(location?.isNodix) || isCrossingLocation(location);
}

function getNextCrossingDisplayName() {
	const crossingNumbers = locationData
		.map((location) => /^Kreuzung-(\d+)$/i.exec(location.name || ""))
		.filter(Boolean)
		.map((match) => Number.parseInt(match[1], 10))
		.filter(Number.isFinite);
	const nextNumber = crossingNumbers.length ? Math.max(...crossingNumbers) + 1 : 1;
	return `Kreuzung-${nextNumber}`;
}

function getNextLocationDisplayName() {
	const locationNumbers = locationData
		.map((location) => /^Ort-(\d+)$/i.exec(location.name || ""))
		.filter(Boolean)
		.map((match) => Number.parseInt(match[1], 10))
		.filter(Number.isFinite);
	const nextNumber = locationNumbers.length ? Math.max(...locationNumbers) + 1 : 1;
	return `Ort-${nextNumber}`;
}

function createWaypointId() {
	return `waypoint-${Date.now()}-${waypointCounter++}`;
}

function getWaypointContainers() {
	return $("#waypoints .waypoint-container");
}

function getWaypointElementById(waypointId) {
	return getWaypointContainers()
		.filter(function () {
			return $(this).data("waypointId") === waypointId;
		})
		.first();
}

function getWaypointAutocompleteSource(term = "") {
	const waypointNames = locationData
		.map((loc) => loc.name)
		.filter((name) => !isCrossingName(name));
	const normalizedTerm = normalizeLocationSearchName(term);

	return waypointNames.sort((a, b) => {
		const normalizedA = normalizeLocationSearchName(a);
		const normalizedB = normalizeLocationSearchName(b);
		const aPrefix = normalizedTerm && normalizedA.startsWith(normalizedTerm) ? 0 : 1;
		const bPrefix = normalizedTerm && normalizedB.startsWith(normalizedTerm) ? 0 : 1;
		if (aPrefix !== bPrefix) {
			return aPrefix - bPrefix;
		}
		return a.localeCompare(b);
	});
}

function scrollWaypointInputIntoView($input) {
	const inputElement = $input?.[0];
	const searchElement = document.getElementById("search");
	if (!inputElement || !searchElement || !searchElement.contains(inputElement)) {
		return;
	}

	const panelRect = searchElement.getBoundingClientRect();
	const inputRect = inputElement.getBoundingClientRect();
	const preferredMenuHeight = Math.min(260, Math.max(140, window.innerHeight * 0.32));
	const lowerOverflow = inputRect.bottom + preferredMenuHeight - panelRect.bottom;
	const upperOverflow = panelRect.top + 8 - inputRect.top;

	if (lowerOverflow > 0) {
		searchElement.scrollTop += lowerOverflow + 8;
		return;
	}

	if (upperOverflow > 0) {
		searchElement.scrollTop -= upperOverflow + 8;
	}
}

function fitWaypointAutocompleteMenu($input) {
	const inputElement = $input?.[0];
	if (!inputElement || !$input.data("ui-autocomplete")) {
		return;
	}

	const $menu = $input.autocomplete("widget");
	const menuElement = $menu?.[0];
	if (!menuElement || !menuElement.offsetParent) {
		return;
	}

	const viewportPadding = 8;
	const inputRect = inputElement.getBoundingClientRect();
	const availableBelow = Math.max(0, window.innerHeight - inputRect.bottom - viewportPadding);
	const availableAbove = Math.max(0, inputRect.top - viewportPadding);
	const shouldOpenAbove = availableBelow < 160 && availableAbove > availableBelow;
	const availableHeight = Math.max(110, Math.min(360, shouldOpenAbove ? availableAbove : availableBelow));

	menuElement.style.maxHeight = `${availableHeight}px`;
	menuElement.style.overflowY = "auto";
	menuElement.style.overflowX = "hidden";
	menuElement.style.width = `${Math.max(inputRect.width, 220)}px`;

	$menu.position({
		my: shouldOpenAbove ? "left bottom" : "left top",
		at: shouldOpenAbove ? "left top-4" : "left bottom+4",
		of: inputElement,
		collision: "fit",
	});
}

function fitOpenWaypointAutocompleteMenus() {
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if ($input.data("ui-autocomplete") && $input.autocomplete("widget").is(":visible")) {
			fitWaypointAutocompleteMenu($input);
		}
	});
}

function initializeWaypointAutocompletePositioning() {
	if (initializeWaypointAutocompletePositioning.isInitialized) {
		return;
	}

	initializeWaypointAutocompletePositioning.isInitialized = true;
	document.getElementById("search")?.addEventListener("scroll", fitOpenWaypointAutocompleteMenus);
	window.addEventListener("resize", fitOpenWaypointAutocompleteMenus);
}

function initializeWaypointAutocomplete($input) {
	initializeWaypointAutocompletePositioning();
	$input.autocomplete({
		appendTo: document.body,
		position: {
			my: "left top",
			at: "left bottom+4",
			collision: "flipfit",
		},
		source(request, response) {
			response(getWaypointAutocompleteSource(request.term || ""));
		},
		search(event) {
			scrollWaypointInputIntoView($(event.target));
		},
		open(event) {
			const $activeInput = $(event.target);
			scrollWaypointInputIntoView($activeInput);
			window.requestAnimationFrame(() => fitWaypointAutocompleteMenu($activeInput));
		},
	});
}

function refreshWaypointAutocompleteSources() {
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if ($input.data("ui-autocomplete")) {
			$input.autocomplete("option", "source", function (request, response) {
				response(getWaypointAutocompleteSource(request.term || ""));
			});
		}
	});
}

function replaceWaypointLocationName(previousName, nextName) {
	if (!previousName || !nextName || previousName === nextName) {
		return false;
	}

	let didReplace = false;
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if (normalizeLocationSearchName($input.val()) === normalizeLocationSearchName(previousName)) {
			$input.val(nextName);
			didReplace = true;
		}
	});

	return didReplace;
}

function clearWaypointLocationName(locationName) {
	if (!locationName) {
		return false;
	}

	let didClear = false;
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if (normalizeLocationSearchName($input.val()) === normalizeLocationSearchName(locationName)) {
			$input.val("");
			didClear = true;
		}
	});

	return didClear;
}

function refreshPlannerAfterFeatureChange({ updateRoute = false } = {}) {
	graphData = null;
	refreshWaypointAutocompleteSources();
	syncPlannerStateToUrl();

	if (updateRoute && getWaypointInputValues().length) {
		updateMapView();
	}
}

function waypointDragHandleMarkup() {
	return `
		<button type="button" class="waypoint-drag-handle" aria-label="Wegpunkt verschieben" title="Wegpunkt verschieben">
			<span class="waypoint-drag-handle__dots" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
			</span>
		</button>`;
}

function createWaypointMarkup(waypointId) {
	const inputId = `waypoint-input-${waypointId}`;
	return `
		<div class="waypoint-container" data-waypoint-id="${escapeHtml(waypointId)}">
			${waypointDragHandleMarkup()}
			<input type="text" id="${escapeHtml(inputId)}" class="waypoint-input" placeholder="Suche Ort..." />
			<button type="button" class="remove-waypoint" aria-label="Wegpunkt entfernen" title="Wegpunkt entfernen">➖</button>
		</div>`;
}

function refreshWaypointSorting() {
	const $waypoints = $("#waypoints");
	if ($waypoints.hasClass("ui-sortable")) {
		$waypoints.sortable("refresh");
	}
}

function appendWaypointInput(initialValue = "") {
	const waypointId = createWaypointId();
	const $waypoint = $(createWaypointMarkup(waypointId));
	const $input = $waypoint.find(".waypoint-input");

	if (initialValue) {
		$input.val(initialValue);
	}

	$("#waypoints").append($waypoint);
	initializeWaypointAutocomplete($input);
	refreshWaypointSorting();

	return $input;
}

function getLastEmptyWaypointInput() {
	const emptyWaypointElement = getWaypointContainers()
		.get()
		.reverse()
		.find((waypointElement) => {
			const inputValue = ($(waypointElement).find(".waypoint-input").val() || "").trim();
			return !inputValue;
		});

	if (!emptyWaypointElement) {
		return $();
	}

	return $(emptyWaypointElement).find(".waypoint-input").first();
}

function fillLastEmptyWaypointOrAppend(locationName) {
	const normalizedLocationName = (locationName || "").trim();
	if (!normalizedLocationName) {
		return $();
	}

	const $lastEmptyInput = getLastEmptyWaypointInput();
	if ($lastEmptyInput.length) {
		$lastEmptyInput.val(normalizedLocationName);
		return $lastEmptyInput;
	}

	return appendWaypointInput(normalizedLocationName);
}

function resetWaypointInputs(waypointNames = []) {
	$("#waypoints").empty();

	if (!waypointNames.length) {
		appendWaypointInput();
		return;
	}

	waypointNames.forEach((waypointName) => appendWaypointInput(waypointName));
	refreshWaypointSorting();
}

function getWaypointInputValues() {
	return $(".waypoint-input")
		.map(function () {
			return ($(this).val() || "").trim();
		})
		.get()
		.filter(Boolean);
}

function removeWaypointElement($waypoint, { updateRoute = true } = {}) {
	if (!$waypoint?.length) {
		return false;
	}

	if (getWaypointContainers().length <= 1) {
		$waypoint.find(".waypoint-input").val("");
	} else {
		$waypoint.remove();
		refreshWaypointSorting();
	}

	if (updateRoute) {
		updateMapView();
	} else {
		syncPlannerStateToUrl();
	}

	return true;
}

function removeWaypointById(waypointId, options = {}) {
	return removeWaypointElement(getWaypointElementById(waypointId), options);
}

function initializeWaypointSorting() {
	const $waypoints = $("#waypoints");
	if ($waypoints.hasClass("ui-sortable")) {
		return;
	}

	$waypoints.sortable({
		handle: ".waypoint-drag-handle",
		cancel: ".waypoint-input, .remove-waypoint",
		axis: "y",
		distance: 4,
		tolerance: "pointer",
		placeholder: "waypoint-sort-placeholder",
		forcePlaceholderSize: true,
		start(event, ui) {
			ui.placeholder.height(ui.item.outerHeight());
			ui.item.addClass("is-dragging");
		},
		stop(event, ui) {
			ui.item.removeClass("is-dragging");
		},
		update() {
			updateMapView();
		},
	});
}

function resetOverview() {
	$("#overview").html(DEFAULT_OVERVIEW_TEXT);
}

function resetRoutePresentation() {
	if (currentRouteLayer) {
		map.removeLayer(currentRouteLayer);
		currentRouteLayer = null;
	}
	if (currentRouteNodeLayer) {
		map.removeLayer(currentRouteNodeLayer);
		currentRouteNodeLayer = null;
	}
	clearRouteDirectionMarkers();
	currentRouteSegmentLayers = [];
	currentRoutePlanEntries = [];
	activeRoutePlanEntryIndex = null;

	removeAllTooltips();
	removeHighlightedRouteNodes();
	resetOverview();
}

function focusMapOnActiveTargets() {
	const focusTargets = selectedLocations.map((loc) => loc.coordinates);
	if (sharePinCoordinates) {
		focusTargets.push(sharePinCoordinates);
	}

	if (!focusTargets.length) {
		return;
	}

	if (!selectedLocations.length && sharePinCoordinates) {
		map.setView(sharePinCoordinates, Math.max(map.getZoom(), DEFAULT_SHARE_PIN_ZOOM));
		if (sharePinMarker) {
			sharePinMarker.openPopup();
		}
		return;
	}

	map.fitBounds(L.latLngBounds(focusTargets), { padding: [50, 50] });
}

function parseBooleanQueryParam(paramValue, fallbackValue) {
	if (paramValue === null) {
		return fallbackValue;
	}

	const normalizedValue = paramValue.trim().toLowerCase();

	if (["1", "true", "yes", "on"].includes(normalizedValue)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalizedValue)) {
		return false;
	}

	return fallbackValue;
}

function parseNumberQueryParam(paramValue, fallbackValue, minValue, maxValue) {
	const parsedValue = Number.parseFloat(paramValue);

	if (!Number.isFinite(parsedValue)) {
		return fallbackValue;
	}

	return Math.min(Math.max(parsedValue, minValue), maxValue);
}

function readWaypointsFromUrl(searchParams) {
	const waypointNames = [];

	for (const paramName of ROUTE_QUERY_PARAM_ALIASES) {
		const paramValues = searchParams.getAll(paramName);

		for (const paramValue of paramValues) {
			const waypointName = paramValue.trim();

			if (!waypointName) {
				continue;
			}

			waypointNames.push(waypointName);

			if (waypointNames.length >= MAX_SHARED_WAYPOINTS) {
				return waypointNames;
			}
		}
	}

	return waypointNames;
}

function readSharePinFromUrl(searchParams) {
	const pinParam = searchParams.get(SHARE_PIN_QUERY_PARAM);
	if (!pinParam) {
		return null;
	}

	const [latValue, lngValue] = pinParam.split(",", 2);
	const lat = Number.parseFloat(latValue);
	const lng = Number.parseFloat(lngValue);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	const latlng = L.latLng(lat, lng);
	return isWithinMapBounds(latlng) ? latlng : null;
}

function createSharePinIcon() {
	return L.divIcon({
		className: "share-pin-marker",
		html: sharePinVisualMarkup("share-pin-visual--marker"),
		iconSize: [34, 42],
		iconAnchor: [17, 31],
		popupAnchor: [0, -34],
	});
}

function formatSharePinQueryValue(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return `${normalizedLatLng.lat.toFixed(3)},${normalizedLatLng.lng.toFixed(3)}`;
}

function clearSharePin({ syncUrl = true } = {}) {
	if (sharePinMarker) {
		map.removeLayer(sharePinMarker);
		sharePinMarker = null;
	}

	sharePinCoordinates = null;

	if (syncUrl) {
		syncPlannerStateToUrl();
	}
}

function setSharePin(latlng, { openPopup = false, syncUrl = true } = {}) {
	const normalizedLatLng = L.latLng(latlng);
	if (!isWithinMapBounds(normalizedLatLng)) {
		return false;
	}

	sharePinCoordinates = normalizedLatLng;

	if (sharePinMarker) {
		map.removeLayer(sharePinMarker);
	}

	sharePinMarker = L.marker(normalizedLatLng, {
		icon: createSharePinIcon(),
		title: "Geteilte Markierung",
		keyboard: true,
	})
		.bindPopup(sharePinPopupMarkup(), {
			autoClose: false,
		})
		.addTo(map);

	if (openPopup) {
		sharePinMarker.openPopup();
	}

	if (syncUrl) {
		syncPlannerStateToUrl();
	}

	return true;
}

function applyPlannerStateFromUrl() {
	const searchParams = getInitialPlannerSearchParams();
	const waypointNames = readWaypointsFromUrl(searchParams);
	const sharePinLatLng = readSharePinFromUrl(searchParams);
	const pathType = searchParams.get("pathType");
	const landTransport = searchParams.get("landTransport");
	const riverTransport = searchParams.get("riverTransport");
	const seaTransport = searchParams.get("seaTransport");
	const legacyLocationToggle = searchParams.has("toggleLocations")
		? parseBooleanQueryParam(searchParams.get("toggleLocations"), false)
		: null;

	let highestVisibleIndex = -1;
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
		const config = LOCATION_TYPE_CONFIG[locationType];
		const fallback = legacyLocationToggle ?? DEFAULT_PLANNER_STATE[config.queryParam];
		if (parseBooleanQueryParam(searchParams.get(config.queryParam), fallback)) {
			highestVisibleIndex = index;
		}
	});
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
		getLocationToggleButton(locationType).toggleClass("is-active", highestVisibleIndex >= 0 && index <= highestVisibleIndex);
	});
	syncLocationToggleButtons();
	$("#togglePaths").prop("checked", parseBooleanQueryParam(searchParams.get("togglePaths"), DEFAULT_PLANNER_STATE.togglePaths));
	const legacyPoliticalMode = parseBooleanQueryParam(searchParams.get("toggleBorders"), false) ? "political" : DEFAULT_PLANNER_STATE.mapLayerMode;
	setSelectedMapLayerMode(searchParams.get("mapLayerMode") || legacyPoliticalMode);
	$("#toggleCrossings").prop("checked", parseBooleanQueryParam(searchParams.get("toggleCrossings"), DEFAULT_PLANNER_STATE.toggleCrossings));
	$("#toggleNodix").prop("checked", parseBooleanQueryParam(searchParams.get("toggleNodix"), DEFAULT_PLANNER_STATE.toggleNodix));

	if (pathType === "shortest" || pathType === "fastest") {
		$(`input[name="pathType"][value="${pathType}"]`).prop("checked", true);
	}

	$("#minimizeTransfers").prop("checked", parseBooleanQueryParam(searchParams.get("minimizeTransfers"), DEFAULT_PLANNER_STATE.minimizeTransfers));
	$("#includeRests").prop("checked", parseBooleanQueryParam(searchParams.get("includeRests"), DEFAULT_PLANNER_STATE.includeRests));
	$("#allowLand").prop("checked", parseBooleanQueryParam(searchParams.get("allowLand"), DEFAULT_PLANNER_STATE.allowLand));
	$("#allowRiver").prop("checked", parseBooleanQueryParam(searchParams.get("allowRiver"), DEFAULT_PLANNER_STATE.allowRiver));
	$("#allowSea").prop("checked", parseBooleanQueryParam(searchParams.get("allowSea"), DEFAULT_PLANNER_STATE.allowSea));
	$("#restHours").val(parseNumberQueryParam(searchParams.get("restHours"), DEFAULT_PLANNER_STATE.restHours, 0, 24));

	if (landTransport && VALID_TRANSPORT_OPTIONS.land.has(landTransport)) {
		$("#landTransport").val(landTransport);
	}

	if (riverTransport && VALID_TRANSPORT_OPTIONS.river.has(riverTransport)) {
		$("#riverTransport").val(riverTransport);
	}

	if (seaTransport && VALID_TRANSPORT_OPTIONS.sea.has(seaTransport)) {
		$("#seaTransport").val(seaTransport);
	}
	syncTransportControls();

	resetWaypointInputs(waypointNames);

	if (sharePinLatLng) {
		setSharePin(sharePinLatLng, {
			openPopup: waypointNames.length === 0,
			syncUrl: false,
		});
	} else {
		clearSharePin({ syncUrl: false });
	}

	return waypointNames.length > 0;
}

function getInitialPlannerSearchParams() {
	const searchParams = new URLSearchParams(window.location.search);
	if (!IS_EDIT_MODE || hasPlannerStateSearchParams(searchParams)) {
		return searchParams;
	}

	try {
		const storedQueryString = window.localStorage?.getItem(EDIT_MODE_PLANNER_STATE_STORAGE_KEY) || "";
		if (!storedQueryString) {
			return searchParams;
		}

		const storedSearchParams = new URLSearchParams(storedQueryString);
		storedSearchParams.set("edit", "1");
		storedSearchParams.set("debugMap", "1");
		return storedSearchParams;
	} catch (error) {
		console.warn("Editmode-Filter konnten nicht wiederhergestellt werden:", error);
		return searchParams;
	}
}

function hasPlannerStateSearchParams(searchParams) {
	const ignoredParams = new Set(["edit", "debugMap"]);
	for (const paramName of searchParams.keys()) {
		if (!ignoredParams.has(paramName)) {
			return true;
		}
	}

	return false;
}

function buildPlannerSearchParams() {
	const searchParams = new URLSearchParams();
	if (IS_EDIT_MODE) {
		searchParams.set("edit", "1");
		searchParams.set("debugMap", "1");
	}
	const selectedPathType = $('input[name="pathType"]:checked').val() || DEFAULT_PLANNER_STATE.pathType;
	const waypointNames = getWaypointInputValues();
	const restHours = parseNumberQueryParam($("#restHours").val(), DEFAULT_PLANNER_STATE.restHours, 0, 24);

	waypointNames.forEach((waypointName) => searchParams.append(DEFAULT_ROUTE_QUERY_PARAM, waypointName));

	LOCATION_TYPE_KEYS.forEach((locationType) => {
		const config = LOCATION_TYPE_CONFIG[locationType];
		const isVisible = isLocationTypeVisible(locationType);
		if (isVisible !== DEFAULT_PLANNER_STATE[config.queryParam]) {
			searchParams.set(config.queryParam, isVisible ? "1" : "0");
		}
	});

	if ($("#togglePaths").is(":checked") !== DEFAULT_PLANNER_STATE.togglePaths) {
		searchParams.set("togglePaths", $("#togglePaths").is(":checked") ? "1" : "0");
	}
	if (IS_EDIT_MODE && $("#toggleNodix").is(":checked") !== DEFAULT_PLANNER_STATE.toggleNodix) {
		searchParams.set("toggleNodix", $("#toggleNodix").is(":checked") ? "1" : "0");
	}

	if (getSelectedMapLayerMode() !== DEFAULT_PLANNER_STATE.mapLayerMode) {
		searchParams.set("mapLayerMode", getSelectedMapLayerMode());
	}

	if (IS_EDIT_MODE && $("#toggleCrossings").is(":checked") !== DEFAULT_PLANNER_STATE.toggleCrossings) {
		searchParams.set("toggleCrossings", $("#toggleCrossings").is(":checked") ? "1" : "0");
	}

	if (IS_EDIT_MODE && activeMapStyle !== "stylized") {
		searchParams.set("mapstyle", activeMapStyle);
	}

	if (selectedPathType !== DEFAULT_PLANNER_STATE.pathType) {
		searchParams.set("pathType", selectedPathType);
	}

	if ($("#minimizeTransfers").is(":checked") !== DEFAULT_PLANNER_STATE.minimizeTransfers) {
		searchParams.set("minimizeTransfers", $("#minimizeTransfers").is(":checked") ? "1" : "0");
	}

	if ($("#includeRests").is(":checked") !== DEFAULT_PLANNER_STATE.includeRests) {
		searchParams.set("includeRests", $("#includeRests").is(":checked") ? "1" : "0");
	}

	if (restHours !== DEFAULT_PLANNER_STATE.restHours) {
		searchParams.set("restHours", String(restHours));
	}

	if ($("#allowLand").is(":checked") !== DEFAULT_PLANNER_STATE.allowLand) {
		searchParams.set("allowLand", $("#allowLand").is(":checked") ? "1" : "0");
	}

	if ($("#landTransport").val() !== DEFAULT_PLANNER_STATE.landTransport) {
		searchParams.set("landTransport", $("#landTransport").val());
	}

	if ($("#allowRiver").is(":checked") !== DEFAULT_PLANNER_STATE.allowRiver) {
		searchParams.set("allowRiver", $("#allowRiver").is(":checked") ? "1" : "0");
	}

	if ($("#riverTransport").val() !== DEFAULT_PLANNER_STATE.riverTransport) {
		searchParams.set("riverTransport", $("#riverTransport").val());
	}

	if ($("#allowSea").is(":checked") !== DEFAULT_PLANNER_STATE.allowSea) {
		searchParams.set("allowSea", $("#allowSea").is(":checked") ? "1" : "0");
	}

	if ($("#seaTransport").val() !== DEFAULT_PLANNER_STATE.seaTransport) {
		searchParams.set("seaTransport", $("#seaTransport").val());
	}

	if (sharePinCoordinates) {
		searchParams.set(SHARE_PIN_QUERY_PARAM, formatSharePinQueryValue(sharePinCoordinates));
	}

	return searchParams;
}

function syncPlannerStateToUrl() {
	if (!window.history || typeof window.history.replaceState !== "function") {
		return;
	}

	const searchParams = buildPlannerSearchParams();
	const queryString = searchParams.toString();
	const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;

	window.history.replaceState(window.history.state, "", nextUrl);
	if (IS_EDIT_MODE) {
		try {
			window.localStorage?.setItem(EDIT_MODE_PLANNER_STATE_STORAGE_KEY, queryString);
		} catch (error) {
			console.warn("Editmode-Filter konnten nicht gespeichert werden:", error);
		}
	}
}

function fallbackCopyTextToClipboard(text) {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "readonly");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.append(textarea);
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	const didCopy = document.execCommand("copy");
	textarea.remove();
	return didCopy;
}

async function copyTextToClipboard(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (error) {
			console.warn("Kopieren über navigator.clipboard fehlgeschlagen. Es wird ein Fallback versucht.", error);
		}
	}

	try {
		return fallbackCopyTextToClipboard(text);
	} catch (error) {
		console.warn("Kopieren in die Zwischenablage fehlgeschlagen.", error);
		return false;
	}
}

function copyCurrentUrlToClipboard() {
	return copyTextToClipboard(window.location.href);
}

function getFeedbackToastElement() {
	return document.getElementById("copy-feedback-toast");
}

function showFeedbackToast(message, type = "info") {
	const toastElement = getFeedbackToastElement();
	if (!toastElement) {
		return;
	}

	if (feedbackToastTimeoutId) {
		window.clearTimeout(feedbackToastTimeoutId);
		feedbackToastTimeoutId = null;
	}

	toastElement.textContent = message;
	toastElement.dataset.toastType = type;
	toastElement.hidden = false;
	toastElement.classList.add("is-visible");

	feedbackToastTimeoutId = window.setTimeout(() => {
		toastElement.classList.remove("is-visible");
		toastElement.hidden = true;
		feedbackToastTimeoutId = null;
	}, 2200);
}

async function copyCurrentUrlToClipboardWithFeedback() {
	const didCopy = await copyCurrentUrlToClipboard();
	showFeedbackToast(
		didCopy ? "Link in die Zwischenablage kopiert." : "Link konnte nicht automatisch kopiert werden.",
		didCopy ? "success" : "warning"
	);
	return didCopy;
}


// Normalisiert den Pfadnamen
const normalizePathName = (name) => {
	if (typeof name === "string") {
		if (name.startsWith("Reichsstrasse")) return "Reichsstrasse";
		if (name.startsWith("Strasse")) return "Strasse";
		if (name.startsWith("Gebirgspass") || name.startsWith("Gebirgspfad")) return "Gebirgspass";
		if (name.startsWith("Wueste") || name.startsWith("Wuestenpfad") || name.startsWith("Wüstenpfad")) return "Wuestenpfad";
		if (name.startsWith("Pfad")) return "Pfad";
		if (name.startsWith("Flussweg")) return "Flussweg";
		if (name.startsWith("Meer") || name.startsWith("Seeweg")) return "Seeweg";
		if (name.startsWith(SYNTHETIC_ROUTE_TYPE)) return SYNTHETIC_ROUTE_TYPE;
	}
	return "Weg";
};

function normalizePathSubtype(value) {
	const pathSubtype = normalizePathName(value);
	return PATH_SUBTYPE_KEYS.includes(pathSubtype) ? pathSubtype : "Weg";
}

function getPathDisplayName(path) {
	return path?.properties?.display_name || path?.properties?.original_name || path?.properties?.name?.replace(/-\d+$/, "") || "Weg";
}


function getNextPathDisplayName(subtype, { excludePath = null } = {}) {
	const normalizedSubtype = normalizePathSubtype(subtype);
	const namePattern = new RegExp(`^${escapeRegExp(normalizedSubtype)}-(\\d+)$`);
	let highestNumber = 0;

	pathData
		.filter((path) => path !== excludePath)
		.map((path) => String(path?.properties?.name || path?.properties?.display_name || "").trim())
		.forEach((pathName) => {
			const match = namePattern.exec(pathName);
			if (!match) {
				return;
			}

			highestNumber = Math.max(highestNumber, Number.parseInt(match[1], 10) || 0);
		});

	return `${normalizedSubtype}-${highestNumber + 1}`;
}

function getPathDisplayNameOrGenerated(name, subtype, { excludePath = null } = {}) {
	const trimmedName = String(name || "").trim();
	if (trimmedName !== "") {
		return trimmedName;
	}

	return getNextPathDisplayName(subtype, { excludePath });
}

function getNextLocalPathId() {
	const highestPathId = pathData.reduce((highestId, path) => {
		const match = /^path-(\d+)$/.exec(String(path?.properties?.id || ""));
		if (!match) {
			return highestId;
		}

		return Math.max(highestId, Number.parseInt(match[1], 10) || 0);
	}, 0);

	return highestPathId + 1;
}

function getPathPublicId(path) {
	return path?.properties?.public_id || path?.id || "";
}

// Normalisiert den Knotennamen
const normalizeNodeName = (name) => {
	if (typeof name === "string") return name.replace(/Kreuzung-\d+/i, "Kreuzung");
	console.warn("Ungültiger Name in normalizeNodeName:", name);
	return name || "";
};

function addGraphConnection(graph, fromName, toName, connection) {
	graph[fromName][toName] = graph[fromName][toName] || [];
	graph[fromName][toName].push(connection);
}

function getLocationAtPathEndpoint([x, y]) {
	return locationData.find(({ coordinates: [lat, lng] }) => Math.abs(lat - y) < THRESHOLD && Math.abs(lng - x) < THRESHOLD) || null;
}

function getLocationDistance(firstLocation, secondLocation) {
	const [firstLat, firstLng] = firstLocation.coordinates;
	const [secondLat, secondLng] = secondLocation.coordinates;
	return calculateCoordinateDistance([firstLat, firstLng], [secondLat, secondLng]);
}

function calculatePathCoordinateDistance(coordinates) {
	let distance = 0;
	for (let index = 1; index < coordinates.length; index++) {
		const [previousX, previousY] = coordinates[index - 1];
		const [currentX, currentY] = coordinates[index];
		distance += Math.hypot(currentX - previousX, currentY - previousY);
	}

	return distance;
}

function findLocationMarkerByName(name) {
	return locationMarkers.find((entry) => entry.name === name) || null;
}

function findLocationMarkerByPublicId(publicId) {
	return locationMarkers.find((entry) => entry.publicId === publicId) || null;
}

function setLocationEditActive(markerEntry, isActive) {
	if (!markerEntry) {
		return;
	}

	if (activeLocationEdit?.markerEntry && activeLocationEdit.markerEntry !== markerEntry) {
		setLocationEditActive(activeLocationEdit.markerEntry, false);
	}

	if (isActive) {
		void acquireFeatureSoftLock(markerEntry.publicId);
		activeLocationEdit = {
			markerEntry,
			originalLatLng: markerEntry.marker.getLatLng(),
		};
		markerEntry.marker.dragging.enable();
		markerEntry.marker.closePopup();
		showFeedbackToast(`${markerEntry.name}: Marker verschieben, Loslassen speichert.`, "info");
		return;
	}

	if (activeLocationEdit?.markerEntry === markerEntry) {
		void releaseFeatureSoftLock(activeLocationEdit.markerEntry.publicId);
		activeLocationEdit = null;
	}
	markerEntry.marker.dragging.disable();
}

function areMapCoordinatesClose(firstValue, secondValue, tolerance = THRESHOLD) {
	return Math.abs(Number(firstValue) - Number(secondValue)) <= tolerance;
}

function isPathEndpointAtLocation(coordinates, locationCoordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !Array.isArray(locationCoordinates) || locationCoordinates.length < 2) {
		return false;
	}

	const [locationLat, locationLng] = locationCoordinates;
	const firstCoordinate = coordinates[0];
	const lastCoordinate = coordinates[coordinates.length - 1];
	return isCoordinatePairClose(firstCoordinate, locationLng, locationLat) || isCoordinatePairClose(lastCoordinate, locationLng, locationLat);
}

function isCoordinatePairClose(coordinate, targetLng, targetLat) {
	return Array.isArray(coordinate)
		&& coordinate.length >= 2
		&& areMapCoordinatesClose(coordinate[0], targetLng)
		&& areMapCoordinatesClose(coordinate[1], targetLat);
}

function shiftPathEndpointsForLocationMove(coordinates, previousCoordinates, nextCoordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !Array.isArray(previousCoordinates) || previousCoordinates.length < 2 || !Array.isArray(nextCoordinates) || nextCoordinates.length < 2) {
		return null;
	}

	const [previousLat, previousLng] = previousCoordinates;
	const [nextLat, nextLng] = nextCoordinates;
	const updatedCoordinates = coordinates.map((coordinate) => (Array.isArray(coordinate) ? [...coordinate] : coordinate));
	let hasChanges = false;

	if (isCoordinatePairClose(updatedCoordinates[0], previousLng, previousLat)) {
		updatedCoordinates[0] = [nextLng, nextLat];
		hasChanges = true;
	}

	const lastIndex = updatedCoordinates.length - 1;
	if (lastIndex > 0 && isCoordinatePairClose(updatedCoordinates[lastIndex], previousLng, previousLat)) {
		updatedCoordinates[lastIndex] = [nextLng, nextLat];
		hasChanges = true;
	}

	return hasChanges ? updatedCoordinates : null;
}

async function moveConnectedPathEndpointsForLocation(previousCoordinates, nextCoordinates) {
	const connectedPaths = pathData.filter((path) => isPathEndpointAtLocation(path?.geometry?.coordinates, previousCoordinates));
	if (connectedPaths.length === 0) {
		return {
			movedPathCount: 0,
			failedPathCount: 0,
		};
	}

	let movedPathCount = 0;
	let failedPathCount = 0;

	for (const path of connectedPaths) {
		const updatedCoordinates = shiftPathEndpointsForLocationMove(path.geometry.coordinates, previousCoordinates, nextCoordinates);
		if (!updatedCoordinates) {
			continue;
		}

		try {
			const result = await submitMapFeatureEdit({
				action: "update_path_geometry",
				public_id: getPathPublicId(path),
				coordinates: updatedCoordinates.map(([lng, lat]) => [lat, lng]),
			});
			applyMapFeatureEditResult(result);
			updateRevisionFromEditResponse(result);
			movedPathCount += 1;
		} catch (error) {
			failedPathCount += 1;
			console.warn("An einen Ort angeschlossene Wege konnten nicht mitverschoben werden:", error);
		}
	}

	return {
		movedPathCount,
		failedPathCount,
	};
}

async function saveMovedLocationMarker(markerEntry, latlng) {
	const normalizedLatLng = L.latLng(latlng);
	if (!markerEntry?.publicId || !isWithinMapBounds(normalizedLatLng)) {
		showFeedbackToast("Diese Position kann nicht gespeichert werden.", "warning");
		return false;
	}

	const previousCoordinates = Array.isArray(markerEntry.location?.coordinates) ? [...markerEntry.location.coordinates] : null;

	try {
		const payload = await submitMapFeatureEdit({
			action: "move_point",
			public_id: markerEntry.publicId,
			lat: normalizedLatLng.lat,
			lng: normalizedLatLng.lng,
		});

		markerEntry.location.coordinates = [normalizedLatLng.lat, normalizedLatLng.lng];
		markerEntry.location.revision = Number(payload.feature?.revision) || markerEntry.location.revision || null;
		markerEntry.marker.setLatLng(normalizedLatLng);
		updateRevisionFromEditResponse(payload);
		const pathMoveSummary = previousCoordinates
			? await moveConnectedPathEndpointsForLocation(previousCoordinates, markerEntry.location.coordinates)
			: {
				movedPathCount: 0,
				failedPathCount: 0,
			};
		syncLocationNameLabelVisibility();
		refreshPlannerAfterFeatureChange({ updateRoute: true });
		const movedPathText = pathMoveSummary.movedPathCount > 0
			? ` und ${pathMoveSummary.movedPathCount} ${pathMoveSummary.movedPathCount === 1 ? "angeschlossener Weg" : "angeschlossene Wege"} mitverschoben`
			: "";
		const statusMessage = `${markerEntry.name} gespeichert${movedPathText}.`;
		showFeedbackToast(
			pathMoveSummary.failedPathCount > 0 ? `${statusMessage} Einige Wege konnten nicht mitverschoben werden.` : statusMessage,
			pathMoveSummary.failedPathCount > 0 ? "warning" : "success"
		);
		return true;
	} catch (error) {
		console.error("Ort konnte nicht gespeichert werden:", error);
		showFeedbackToast(error.message || "Ort konnte nicht gespeichert werden.", "warning");
		return false;
	}
}

function updateRevisionFromEditResponse(payload) {
	const revision = payload?.feature?.revision || payload?.feature?.properties?.revision;
	if (revision && mapDataSourceStatus) {
		mapDataSourceStatus.revision = revision;
		updateMapDataStatus({ avesmapsSource: mapDataSourceStatus });
	}
}

function getLocalFeatureRevision(publicId) {
	if (!publicId) {
		return null;
	}

	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (markerEntry?.location?.revision !== undefined) {
		return markerEntry.location.revision;
	}

	const path = findPathByPublicId(publicId);
	if (path?.properties?.revision !== undefined) {
		return path.properties.revision;
	}

	const labelEntry = labelMarkers.find((entry) => entry.label.publicId === publicId);
	if (labelEntry?.label?.revision !== undefined) {
		return labelEntry.label.revision;
	}

	const regionEntry = regionData.map(normalizeRegionFeature).find((entry) => entry.publicId === publicId)
		|| regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry?.publicId === publicId);
	return regionEntry?.revision ?? null;
}

function withExpectedRevision(payload) {
	if (!payload?.public_id || payload.expected_revision !== undefined || ["create_point", "create_crossing", "create_path", "create_label", "create_region", "acquire_lock", "release_lock"].includes(payload.action)) {
		return payload;
	}

	const revision = getLocalFeatureRevision(payload.public_id);
	return revision === null || revision === undefined ? payload : { ...payload, expected_revision: revision };
}

async function acquireFeatureSoftLock(publicId) {
	if (!IS_EDIT_MODE || !isSqlMapFeatureId(publicId) || activeFeatureLocks.has(publicId)) {
		return;
	}

	try {
		await submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId });
		const refreshTimerId = window.setInterval(() => {
			void submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId }).catch((error) => {
				console.warn("Feature-Lock konnte nicht erneuert werden:", error);
			});
		}, 45000);
		activeFeatureLocks.set(publicId, refreshTimerId);
	} catch (error) {
		showFeedbackToast(error.message || "Dieses Objekt ist gerade gesperrt.", "warning");
		throw error;
	}
}

async function releaseFeatureSoftLock(publicId) {
	if (!isSqlMapFeatureId(publicId) || !activeFeatureLocks.has(publicId)) {
		return;
	}

	window.clearInterval(activeFeatureLocks.get(publicId));
	activeFeatureLocks.delete(publicId);
	try {
		await submitMapFeatureEdit({ action: "release_lock", public_id: publicId });
	} catch (error) {
		console.warn("Feature-Lock konnte nicht freigegeben werden:", error);
	}
}

function refreshLocationMarkerPopup(markerEntry) {
	markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType));
	if (markerEntry.locationType === CROSSING_LOCATION_TYPE) {
		markerEntry.marker.bindPopup(
			locationPopupMarkup({
				name: markerEntry.name,
				locationType: CROSSING_LOCATION_TYPE,
				locationTypeLabel: "Kreuzung",
				showHeaderIcon: false,
				showDescription: false,
				showWikiLink: false,
				actionsMarkup: crossingActionsMarkup(markerEntry.name, markerEntry.publicId),
			})
		);
		return;
	}

	markerEntry.marker.bindPopup(
		locationPopupMarkup({
			name: markerEntry.name,
			locationType: markerEntry.locationType,
			locationTypeLabel: markerEntry.location.locationTypeLabel,
			description: markerEntry.location.description,
			wikiUrl: markerEntry.location.wikiUrl,
			isRuined: markerEntry.location.isRuined,
			actionsMarkup: locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location),
		})
	);
}

function refreshAllLocationMarkerPopups() {
	locationMarkers.forEach((markerEntry) => refreshLocationMarkerPopup(markerEntry));
}

function createEditablePointMarkerEntry(location) {
	const marker = L.marker(location.coordinates, {
		icon: createLocationMarkerIcon(location.locationType),
		pane: "locationsPane",
		keyboard: true,
		draggable: false,
	});
	const markerEntry = {
		marker,
		locationType: location.locationType,
		name: location.name,
		publicId: location.publicId,
		location,
	};
	marker.on("dragend", async () => {
		const saveSucceeded = await saveMovedLocationMarker(markerEntry, marker.getLatLng());
		if (!saveSucceeded && activeLocationEdit?.originalLatLng) {
			marker.setLatLng(activeLocationEdit.originalLatLng);
			syncLocationNameLabelVisibility();
		}
		setLocationEditActive(markerEntry, false);
	});
	refreshLocationMarkerPopup(markerEntry);
	return markerEntry;
}

function addLocationNameLabel(markerEntry) {
	if (isCrossingLocation(markerEntry.location)) {
		return;
	}

	locationNameLabels.push(createLocationNameLabelEntry(markerEntry));
}

function ensureLocationNameLabel(markerEntry) {
	if (isCrossingLocation(markerEntry.location)) {
		return;
	}

	const existingLabelEntry = locationNameLabels.find((entry) => entry.markerEntry === markerEntry);
	if (existingLabelEntry) {
		return;
	}

	addLocationNameLabel(markerEntry);
}

function removeLocationNameLabel(markerEntry) {
	const labelEntry = locationNameLabels.find((entry) => entry.markerEntry === markerEntry);
	if (!labelEntry) {
		return;
	}

	map.removeLayer(labelEntry.marker);
	locationNameLabels = locationNameLabels.filter((entry) => entry !== labelEntry);
}

function applyFeatureResponseToMarker(markerEntry, feature) {
	const previousName = markerEntry.name;
	const previousLocation = markerEntry.location;
	const wasCrossing = isCrossingLocation(previousLocation);
	const wasPopupOpen = markerEntry.marker.isPopupOpen();
	const locationType = normalizeLocationType(feature.location_type || feature.feature_subtype || markerEntry.locationType);
	const latLng = [Number(feature.lat), Number(feature.lng)];
	markerEntry.name = feature.name || markerEntry.name;
	markerEntry.publicId = feature.public_id || markerEntry.publicId;
	markerEntry.locationType = locationType;
	markerEntry.location = {
		...markerEntry.location,
		publicId: markerEntry.publicId,
		name: markerEntry.name,
		coordinates: latLng,
		locationType,
		locationTypeLabel: feature.location_type_label || LOCATION_TYPE_CONFIG[locationType]?.singularLabel || "Dorf",
		description: feature.description || "",
		wikiUrl: feature.wiki_url || "",
		isNodix: Boolean(feature.is_nodix),
		isRuined: Boolean(feature.is_ruined),
		revision: Number(feature.revision) || markerEntry.location.revision || null,
	};
	const locationIndex = locationData.indexOf(previousLocation);
	if (locationIndex >= 0) {
		locationData[locationIndex] = markerEntry.location;
	}
	if (wasCrossing && !isCrossingLocation(markerEntry.location)) {
		ensureLocationNameLabel(markerEntry);
	}
	markerEntry.marker.setLatLng(latLng);
	refreshLocationMarkerPopup(markerEntry);
	if (wasPopupOpen) {
		markerEntry.marker.openPopup();
	}
	refreshPowerlineLayers();
	syncLocationNameLabelVisibility();
	const didReplaceWaypoint = replaceWaypointLocationName(previousName, markerEntry.name);
	refreshPlannerAfterFeatureChange({ updateRoute: didReplaceWaypoint });
}

async function editLocationDetails(markerEntry) {
	openLocationEditDialog({ markerEntry });
}

async function convertCrossingToLocation(markerEntry) {
	if (!markerEntry || markerEntry.locationType !== CROSSING_LOCATION_TYPE) {
		return;
	}

	const nextName = getNextLocationDisplayName();
	const hasConnectedPowerlines = getConnectedPowerlinesForPublicId(markerEntry.publicId).length > 0;
	openLocationEditDialog({
		markerEntry,
		presetName: nextName,
		presetIsNodix: hasConnectedPowerlines,
	});
	pendingCrossingConversionPublicId = markerEntry.publicId;
	pendingCrossingConversionName = nextName;
	pendingCrossingConversionIsNodix = hasConnectedPowerlines;
	showFeedbackToast("Ort bearbeiten und speichern, um die Konvertierung abzuschliessen.", "info");
}

async function deleteLocationMarker(markerEntry) {
	const locationTypeLabel = markerEntry.locationType === CROSSING_LOCATION_TYPE ? "Kreuzung" : "Ort";
	const connectedPowerlines = markerEntry.locationType === CROSSING_LOCATION_TYPE
		? getConnectedPowerlinesForPublicId(markerEntry.publicId)
		: [];
	const confirmationMessage = connectedPowerlines.length > 0
		? `${markerEntry.name} ist noch mit ${connectedPowerlines.length} ${connectedPowerlines.length === 1 ? "Kraftlinie" : "Kraftlinien"} verbunden. Wirklich loeschen?`
		: `${markerEntry.name} wirklich loeschen?`;
	if (!window.confirm(confirmationMessage)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: markerEntry.publicId,
		});
		map.removeLayer(markerEntry.marker);
		removeLocationNameLabel(markerEntry);
		locationMarkers = locationMarkers.filter((entry) => entry !== markerEntry);
		locationData = locationData.filter((location) => location !== markerEntry.location);
		const didClearWaypoint = clearWaypointLocationName(markerEntry.name);
		updateRevisionFromEditResponse(result);
		refreshPlannerAfterFeatureChange({ updateRoute: didClearWaypoint });
		showFeedbackToast(`${locationTypeLabel} geloescht.`, "success");
	} catch (error) {
		console.error(`${locationTypeLabel} konnte nicht geloescht werden:`, error);
		showFeedbackToast(error.message || `${locationTypeLabel} konnte nicht geloescht werden.`, "warning");
	}
}

function addCreatedLocationMarker(feature, { openPopup = true } = {}) {
	const locationType = feature.feature_subtype === CROSSING_LOCATION_TYPE || String(feature.name || "").startsWith("Kreuzung")
		? CROSSING_LOCATION_TYPE
		: normalizeLocationType(feature.location_type || feature.feature_subtype || "dorf");
	const location = {
		publicId: feature.public_id,
		name: feature.name,
		coordinates: [Number(feature.lat), Number(feature.lng)],
		locationType,
		locationTypeLabel: locationType === CROSSING_LOCATION_TYPE ? "Kreuzung" : feature.location_type_label || LOCATION_TYPE_CONFIG[locationType]?.singularLabel || "Dorf",
		description: feature.description || "",
		wikiUrl: feature.wiki_url || "",
		isNodix: Boolean(feature.is_nodix),
		isRuined: Boolean(feature.is_ruined),
		revision: Number(feature.revision) || null,
	};
	locationData.push(location);

	const markerEntry = createEditablePointMarkerEntry(location);
	locationMarkers.push(markerEntry);
	refreshLocationMarkerPopup(markerEntry);
	addLocationNameLabel(markerEntry);
	syncLocationMarkerVisibility();
	refreshPlannerAfterFeatureChange();
	if (openPopup) {
		markerEntry.marker.openPopup();
	}
}

function applyLiveLocationFeature(feature) {
	const properties = feature.properties || {};
	const publicId = properties.public_id || feature.id || "";
	const markerEntry = findLocationMarkerByPublicId(publicId);
	const payload = {
		public_id: publicId,
		name: properties.name || "",
		feature_subtype: properties.feature_subtype || properties.settlement_class || "dorf",
		lat: feature.geometry.coordinates[1],
		lng: feature.geometry.coordinates[0],
		description: properties.description || "",
		wiki_url: properties.wiki_url || "",
		is_nodix: Boolean(properties.is_nodix),
		is_ruined: Boolean(properties.is_ruined),
		revision: properties.revision || null,
	};
	if (markerEntry) {
		applyFeatureResponseToMarker(markerEntry, payload);
		return;
	}

	addCreatedLocationMarker(payload, { openPopup: false });
}

async function createLocationAt(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	openLocationEditDialog({ latlng: normalizedLatLng });
}

// Labels
function normalizeLabelFeature(feature) {
	const properties = feature.properties || {};
	const [lng, lat] = feature.geometry?.coordinates || [feature.lng, feature.lat];
	return {
		publicId: properties.public_id || feature.id || feature.public_id || "",
		text: properties.text || properties.name || feature.name || "",
		labelType: properties.feature_subtype || feature.feature_subtype || "region",
		size: Number(properties.size || feature.size || 18),
		rotation: Number(properties.rotation || feature.rotation || 0),
		minZoom: Number(properties.min_zoom ?? feature.min_zoom ?? 0),
		maxZoom: Number(properties.max_zoom ?? feature.max_zoom ?? 5),
		priority: Number(properties.priority ?? feature.priority ?? 3),
		isNodix: Boolean(properties.is_nodix ?? feature.is_nodix),
		revision: Number(properties.revision ?? feature.revision) || null,
		coordinates: [Number(lat), Number(lng)],
	};
}

function createLabelIcon(label) {
	const safeSize = getScaledLabelSize(label);
	const safeRotation = Math.max(-180, Math.min(180, Number(label.rotation) || 0));
	return L.divIcon({
		className: `map-label map-label--${label.labelType}`,
		html: `<span style="font-size:${safeSize}px; transform: translate(calc(-50% + var(--label-offset-x, 0px)), calc(-50% + var(--label-offset-y, 0px))) rotate(${safeRotation}deg);">${escapeHtml(label.text)}</span>`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function getScaledLabelSize(label) {
	const baseSize = Math.max(10, Math.min(56, Number(label.size) || 18));
	const visualZoomLevel = getVisualZoomLevel(map.getZoom());
	const zoomRatio = Math.max(0, Math.min(1, visualZoomLevel / VISUAL_MAX_ZOOM_LEVEL));
	return Math.round(baseSize * (0.5 + zoomRatio * 0.5));
}

function createLabelMarkerEntry(label) {
	const marker = L.marker(label.coordinates, {
		icon: createLabelIcon(label),
		draggable: false,
		interactive: IS_EDIT_MODE,
		keyboard: false,
		pane: "labelsPane",
	});
	const entry = { label, marker };
	if (IS_EDIT_MODE) {
		refreshLabelMarkerPopup(entry);
		marker.on("dragend", () => {
			void saveLabelPosition(entry);
			setLabelMoveActive(entry, false);
		});
	}
	syncLabelMarkerVisibility(entry);
	return entry;
}

function refreshLabelMarkerPopup(entry) {
	if (!IS_EDIT_MODE) {
		return;
	}

	entry.marker.bindPopup(labelPopupMarkup(entry));
}

function findLabelEntryByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function setLabelMoveActive(entry, isActive) {
	if (!entry?.marker?.dragging) {
		return;
	}

	if (isActive) {
		void acquireFeatureSoftLock(entry.label.publicId);
		entry.marker.dragging.enable();
		entry.marker.closePopup();
		showFeedbackToast(`${entry.label.text}: Label verschieben, Loslassen speichert.`, "info");
		return;
	}

	entry.marker.dragging.disable();
	void releaseFeatureSoftLock(entry.label.publicId);
}

function shouldShowLabelMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const minZoom = Number(entry.label.minZoom) || 0;
	const maxZoom = Number.isFinite(Number(entry.label.maxZoom)) ? Number(entry.label.maxZoom) : 5;
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	return getSelectedMapLayerMode() === "deregraphic"
		&& visualZoomLevel >= minZoom
		&& visualZoomLevel <= maxZoom
		&& isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

function syncLabelMarkerVisibility(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const shouldShow = shouldShowLabelMarker(entry, zoomLevel, renderBounds);
	const isVisible = map.hasLayer(entry.marker);
	if (shouldShow && !isVisible) {
		entry.marker.addTo(map);
		return;
	}

	if (!shouldShow && isVisible) {
		map.removeLayer(entry.marker);
	}
}

function syncLabelVisibility() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => syncLabelMarkerVisibility(entry, zoomLevel, renderBounds));
	scheduleLabelCollisionResolution();
}

function syncLabelIcons() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => {
		if (shouldShowLabelMarker(entry, zoomLevel, renderBounds) || map.hasLayer(entry.marker)) {
			entry.marker.setIcon(createLabelIcon(entry.label));
		}
		syncLabelMarkerVisibility(entry, zoomLevel, renderBounds);
	});
	scheduleLabelCollisionResolution();
}

function scheduleLabelCollisionResolution() {
	if (labelCollisionFrameId !== null) {
		return;
	}

	labelCollisionFrameId = window.requestAnimationFrame(() => {
		labelCollisionFrameId = null;
		resolveLabelCollisions();
	});
}

function rectanglesOverlap(firstRect, secondRect) {
	return firstRect.left < secondRect.right
		&& firstRect.right > secondRect.left
		&& firstRect.top < secondRect.bottom
		&& firstRect.bottom > secondRect.top;
}

function expandRect(rect, padding) {
	return {
		left: rect.left - padding,
		right: rect.right + padding,
		top: rect.top - padding,
		bottom: rect.bottom + padding,
		width: rect.width + padding * 2,
		height: rect.height + padding * 2,
	};
}

function getLocationNameLabelPriority(entry) {
	const priorities = {
		metropole: 100,
		grossstadt: 90,
		stadt: 80,
		kleinstadt: 70,
		dorf: 60,
		gebaeude: 60,
	};
	return priorities[entry.markerEntry?.locationType] || 50;
}

function getLabelOffsetCandidates() {
	return [
		[0, 0],
		[8, 0],
		[-8, 0],
		[0, -8],
		[0, 8],
		[12, -6],
		[-12, -6],
		[12, 6],
		[-12, 6],
	];
}

function setLabelElementOffset(element, offsetX, offsetY) {
	element.style.setProperty("--label-offset-x", `${offsetX}px`);
	element.style.setProperty("--label-offset-y", `${offsetY}px`);
}

function getLocationNameLabelBaseOffset(element) {
	const labelElement = element.querySelector("span");
	const style = labelElement ? window.getComputedStyle(labelElement) : null;
	return {
		x: parseFloat(style?.getPropertyValue("--location-label-offset-x")) || LOCATION_LABEL_GAP,
		y: parseFloat(style?.getPropertyValue("--location-label-offset-y")) || 0,
	};
}

function getLocationNameLabelOffsets(element, labelRect) {
	const baseOffset = getLocationNameLabelBaseOffset(element);
	const labelWidth = labelRect.width;
	const labelHeight = labelRect.height;
	const scaledGap = Math.max(LOCATION_LABEL_GAP, Math.abs(baseOffset.x));
	const smallShift = LOCATION_LABEL_SHIFT_SMALL;
	const verticalCenterOffset = -labelHeight / 2;

	return [
		{ name: "right", dx: baseOffset.x, dy: baseOffset.y },
		{ name: "right-up", dx: baseOffset.x, dy: baseOffset.y - smallShift },
		{ name: "right-down", dx: baseOffset.x, dy: baseOffset.y + smallShift },
		{ name: "top-right", dx: baseOffset.x, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-right", dx: baseOffset.x, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "left", dx: -labelWidth - scaledGap, dy: baseOffset.y },
		{ name: "left-up", dx: -labelWidth - scaledGap, dy: baseOffset.y - smallShift },
		{ name: "left-down", dx: -labelWidth - scaledGap, dy: baseOffset.y + smallShift },
		{ name: "top-left", dx: -labelWidth - scaledGap, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-left", dx: -labelWidth - scaledGap, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "top", dx: -labelWidth / 2, dy: verticalCenterOffset - labelHeight - smallShift },
		{ name: "bottom", dx: -labelWidth / 2, dy: verticalCenterOffset + labelHeight + smallShift },
	];
}

function applyLocationNameLabelOffset(element, candidate) {
	const baseOffset = getLocationNameLabelBaseOffset(element);
	setLabelElementOffset(element, candidate.dx - baseOffset.x, candidate.dy - baseOffset.y);
}

function getLabelCollisionTarget(element) {
	return element.classList.contains("location-name-label")
		? element.querySelector("span") || element
		: element;
}

function measureLabelRect(element) {
	return getLabelCollisionTarget(element).getBoundingClientRect();
}

function measureLabelCollisionRect(element) {
	const rect = measureLabelRect(element);
	if (rect.width <= 0 || rect.height <= 0) {
		return rect;
	}

	return expandRect(rect, LOCATION_LABEL_COLLISION_PADDING);
}

function getCollisionEntries() {
	const freeLabelEntries = labelMarkers
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			priority: (Number(entry.label.priority) || 3) * 20 - 5,
			minZoom: Number(entry.label.minZoom) || 0,
		}));
	const locationLabelEntries = locationNameLabels
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			priority: getLocationNameLabelPriority(entry),
			minZoom: LOCATION_NAME_LABEL_CONFIG[entry.markerEntry?.locationType]?.minZoom || 0,
		}));

	return [...locationLabelEntries, ...freeLabelEntries].filter(({ element }) => element);
}

function resolveLabelCollisions() {
	const visibleEntries = getCollisionEntries();
	const offsetCandidates = getLabelOffsetCandidates();

	visibleEntries.forEach(({ element }) => {
		element.classList.remove("is-colliding");
		setLabelElementOffset(element, 0, 0);
	});

	const acceptedRects = [];
	visibleEntries
		.sort((left, right) => {
			const priorityDiff = right.priority - left.priority;
			return priorityDiff || left.minZoom - right.minZoom;
		})
		.forEach(({ element }) => {
			const locationLabelRect = element.classList.contains("location-name-label")
				? measureLabelRect(element)
				: null;
			const candidates = locationLabelRect
				? getLocationNameLabelOffsets(element, locationLabelRect)
				: offsetCandidates.map(([offsetX, offsetY]) => ({ dx: offsetX, dy: offsetY }));

			for (const candidate of candidates) {
				if (locationLabelRect) {
					applyLocationNameLabelOffset(element, candidate);
				} else {
					setLabelElementOffset(element, candidate.dx, candidate.dy);
				}
				const rect = measureLabelCollisionRect(element);
				if (rect.width <= 0 || rect.height <= 0) {
					return;
				}

				if (!acceptedRects.some((acceptedRect) => rectanglesOverlap(rect, acceptedRect))) {
					acceptedRects.push(rect);
					return;
				}
			}

			element.classList.add("is-colliding");
		});
}

function prepareLabelData(data) {
	labelMarkers.forEach((entry) => map.removeLayer(entry.marker));
	labelData = data.features.filter((feature) => feature.properties?.feature_type === "label").map(normalizeLabelFeature);
	labelMarkers = labelData.map(createLabelMarkerEntry);
	syncLabelVisibility();
}

function addCreatedLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(entry);
	refreshLabelMarkerPopup(entry);
	return entry;
}

function applyLabelFeatureResponse(entry, feature) {
	const label = normalizeLabelFeature(feature);
	Object.assign(entry.label, label);
	entry.marker.setLatLng(label.coordinates);
	entry.marker.setIcon(createLabelIcon(label));
	refreshLabelMarkerPopup(entry);
	syncLabelMarkerVisibility(entry);
}

function applyLiveLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = labelMarkers.find((labelEntry) => labelEntry.label.publicId === label.publicId);
	if (entry) {
		applyLabelFeatureResponse(entry, feature);
		return;
	}

	const newEntry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(newEntry);
	syncLabelMarkerVisibility(newEntry);
}

async function saveLabelPosition(entry) {
	const latlng = entry.marker.getLatLng();
	try {
		const result = await submitMapFeatureEdit({
			action: "move_label",
			public_id: entry.label.publicId,
			lat: latlng.lat,
			lng: latlng.lng,
		});
		applyLabelFeatureResponse(entry, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		showFeedbackToast("Labelposition gespeichert.", "success");
	} catch (error) {
		console.error("Label konnte nicht verschoben werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht verschoben werden.", "warning");
	}
}

async function deleteLabelEntry(entry, { closeDialog = false } = {}) {
	if (!entry || !window.confirm(`${entry.label.text} wirklich loeschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: entry.label.publicId,
		});
		map.removeLayer(entry.marker);
		labelData = labelData.filter((label) => label !== entry.label);
		labelMarkers = labelMarkers.filter((labelEntry) => labelEntry !== entry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (closeDialog) {
			setLabelEditDialogOpen(false, { resetForm: true });
		}
		showFeedbackToast("Label geloescht.", "success");
	} catch (error) {
		console.error("Label konnte nicht geloescht werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht geloescht werden.", "error");
	}
}

async function deleteActiveLabel() {
	await deleteLabelEntry(labelEditEntry, { closeDialog: true });
}

async function duplicateLabelEntry(entry) {
	if (!entry) {
		showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
		return;
	}

	const sourceLatLng = entry.marker.getLatLng();
	const duplicateLatLng = map.layerPointToLatLng(map.latLngToLayerPoint(sourceLatLng).add([24, 24]));
	try {
		const result = await submitMapFeatureEdit({
			action: "create_label",
			text: entry.label.text,
			feature_subtype: entry.label.labelType || "region",
			size: Number(entry.label.size) || 18,
			rotation: Number(entry.label.rotation) || 0,
			min_zoom: Number(entry.label.minZoom) || 0,
			max_zoom: Number(entry.label.maxZoom) || 5,
			priority: Number(entry.label.priority) || 3,
			lat: duplicateLatLng.lat,
			lng: duplicateLatLng.lng,
		});
		const duplicatedLabelEntry = addCreatedLabelFeature(result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		entry.marker.closePopup();
		pendingLabelMoveAfterEditEntry = duplicatedLabelEntry;
		openLabelEditDialog({ labelEntry: duplicatedLabelEntry });
		showFeedbackToast("Label dupliziert. Details bearbeiten, danach verschieben.", "success");
	} catch (error) {
		console.error("Label konnte nicht dupliziert werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht dupliziert werden.", "warning");
	}
}

function createLabelAt(latlng) {
	setSelectedMapLayerMode("deregraphic");
	openLabelEditDialog({ latlng: L.latLng(latlng) });
}

function addCreatedCrossingMarker(feature) {
	const location = {
		publicId: feature.public_id,
		name: getNextCrossingDisplayName(),
		coordinates: [Number(feature.lat), Number(feature.lng)],
		locationType: CROSSING_LOCATION_TYPE,
		locationTypeLabel: "Kreuzung",
		description: "",
		wikiUrl: "",
	};
	locationData.push(location);

	const markerEntry = createEditablePointMarkerEntry(location);
	locationMarkers.push(markerEntry);
	syncLocationMarkerVisibility();
	refreshPlannerAfterFeatureChange();
	markerEntry.marker.openPopup();
}

async function createCrossingFeatureAt(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	if (!isWithinMapBounds(normalizedLatLng)) {
		throw new Error("Diese Position kann nicht gespeichert werden.");
	}

	return submitMapFeatureEdit({
		action: "create_crossing",
		lat: normalizedLatLng.lat,
		lng: normalizedLatLng.lng,
	});
}

async function createCrossingAt(latlng) {
	try {
		const result = await createCrossingFeatureAt(latlng);
		addCreatedCrossingMarker(result.feature);
		ensureCrossingsEnabled();
		updateRevisionFromEditResponse(result);
		showFeedbackToast("Kreuzung erstellt.", "success");
	} catch (error) {
		console.error("Kreuzung konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Kreuzung konnte nicht erstellt werden.", "warning");
	}
}

function ensureCrossingsEnabled() {
	$("#toggleCrossings").prop("checked", true);
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
}

function findNearestLocationToLatLng(latlng) {
	const targetLocation = { coordinates: [latlng.lat, latlng.lng] };
	let nearestMatch = null;

	const locationCandidates = locationData.length
		? locationData
		: locationMarkers.map((entry) => entry.location).filter(Boolean);

	locationCandidates
		.filter((location) => location?.name && !isCrossingName(location.name))
		.forEach((location) => {
			const distance = getLocationDistance(location, targetLocation);
			if (!nearestMatch || distance < nearestMatch.distance) {
				nearestMatch = { location, distance };
			}
		});

	return nearestMatch?.location || null;
}

function findNearestGraphNodeToLatLng(latlng) {
	const targetLocation = { coordinates: [latlng.lat, latlng.lng] };
	let nearestMatch = null;

	locationData.forEach((location) => {
		const distance = getLocationDistance(location, targetLocation);
		if (!nearestMatch || distance < nearestMatch.distance) {
			nearestMatch = { location, distance };
		}
	});

	return nearestMatch;
}

function openLocationPopupByName(locationName) {
	const markerEntry = findLocationMarkerByName(locationName);
	if (!markerEntry) {
		return false;
	}

	if (!map.hasLayer(markerEntry.marker)) {
		map.addLayer(markerEntry.marker);
	}

	if (typeof markerEntry.marker.bringToFront === "function") {
		markerEntry.marker.bringToFront();
	}

	const markerLatLng = markerEntry.marker.getLatLng();
	const popupContent = markerEntry.marker.getPopup()?.getContent?.() || markerEntry.name;
	map.panTo(markerLatLng);
	L.popup({
		autoPan: false,
		closeButton: true,
		className: "location-popup-wrapper",
	})
		.setLatLng(markerLatLng)
		.setContent(popupContent)
		.openOn(map);
	return true;
}

function buildSyntheticPathSegment(fromLocation, toLocation, connectionId, routeType) {
	return {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[fromLocation.coordinates[1], fromLocation.coordinates[0]],
				[toLocation.coordinates[1], toLocation.coordinates[0]],
			],
		},
		properties: {
			id: connectionId,
			name: `${routeType}-synthetic`,
			synthetic: true,
		},
	};
}

function createPathPopupMarkup(path) {
	const pathName = getPathDisplayName(path);
	const pathType = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	return locationPopupMarkup({
		name: pathName,
		locationType: "dorf",
		locationTypeLabel: pathType,
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Details bearbeiten",
				attributes: {
					"data-popup-action": "edit-path-details",
					"data-public-id": getPathPublicId(path),
				},
			}),
			popupActionButtonMarkup({
				label: "Verlauf bearbeiten",
				attributes: {
					"data-popup-action": "edit-path-geometry",
					"data-public-id": getPathPublicId(path),
				},
			}),
			popupActionButtonMarkup({
				label: "Weg loeschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-path",
					"data-public-id": getPathPublicId(path),
				},
			}),
		]) : "",
	});
}

function getPathStyleColors(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const simplifiedRender = Math.round(Number(map.getZoom())) <= PATH_RENDER_CONFIG.simplifiedMaxZoom;
	const centerColors = {
		Reichsstrasse: "#d8d8d8",
		Strasse: "#6a6a6a",
		Weg: "#cdb98a",
		Pfad: "#7b4f2f",
		Gebirgspass: "#8f3f2f",
		Wuestenpfad: "#c6922e",
		Flussweg: "#6ec6ff",
		Seeweg: "#2f7dd3",
	};

	return {
		outline: "#ffffff",
		center: centerColors[pathSubtype] || centerColors.Weg,
		outlineWeight: simplifiedRender
			? PATH_RENDER_CONFIG.simplifiedOutlineWeight
			: pathSubtype === "Reichsstrasse" ? 6 : 5,
		centerWeight: simplifiedRender
			? Math.max(1.5, (pathSubtype === "Reichsstrasse" ? 4 : 3) * PATH_RENDER_CONFIG.simplifiedCenterWeightScale)
			: pathSubtype === "Reichsstrasse" ? 4 : 3,
		outlineOpacity: simplifiedRender ? PATH_RENDER_CONFIG.simplifiedOutlineOpacity : 1,
	};
}

function updatePathLayerStyle(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const colors = getPathStyleColors(path);
	path._pathLines[0]?.setStyle({ color: colors.outline, weight: colors.outlineWeight, opacity: colors.outlineOpacity });
	path._pathLines[1]?.setStyle({ color: colors.center, weight: colors.centerWeight });
	refreshPathLayerText(path);
}

function shouldPathNameBeDisplayed(path) {
	return path?.properties?.show_label === true || path?.properties?.show_label === 1 || path?.properties?.show_label === "1";
}

function isPathLabelVisibleAtCurrentZoom(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const minZoom = pathSubtype === "Flussweg" || pathSubtype === "Seeweg"
		? 3
		: LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return shouldPathNameBeDisplayed(path) && map.getZoom() >= minZoom;
}

function getPathLabelStyle(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const fillColors = {
		Reichsstrasse: "#f4f4f4",
		Strasse: "#dddddd",
		Weg: "#f0ddb0",
		Pfad: "#d8b28a",
		Gebirgspass: "#e0a090",
		Wuestenpfad: "#f1c56f",
		Flussweg: "#b9e7ff",
		Seeweg: "#9ed0ff",
	};

	const fontSize = getLocationNameLabelSize("dorf") + (pathSubtype === "Flussweg" ? 3 : 1);
	return {
		fill: fillColors[pathSubtype] || fillColors.Weg,
		stroke: "rgba(0, 0, 0, 0.75)",
		strokeWidth: "2px",
		paintOrder: "stroke",
		fontFamily: 'Georgia, "Times New Roman", serif',
		fontSize: `${fontSize}px`,
		fontWeight: "400",
		letterSpacing: "0",
	};
}

function refreshPathLayerText(path) {
	const labelLine = path?._pathLabelLine;
	if (!labelLine?.setText) {
		return;
	}

	if (!isPathLabelVisibleAtCurrentZoom(path)) {
		labelLine.removeText?.();
		return;
	}

	labelLine.setText(getPathDisplayName(path), {
		className: `path-name-text path-name-text--${normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name)}`,
		offset: "50%",
		textAnchor: "middle",
		dy: "-6",
		style: getPathLabelStyle(path),
	});
}

function getPathVisualLatLngCoordinates(coordinates, zoomLevel = map.getZoom()) {
	const roundedZoomLevel = getVisualZoomLevel(zoomLevel);
	const smoothingConfig = roundedZoomLevel <= PATH_RENDER_CONFIG.simplifiedMaxZoom
		? {
			enabled: true,
			factor: PATH_RENDER_CONFIG.simplifiedSmoothingFactor,
			maxDistance: PATH_RENDER_CONFIG.simplifiedMaxDistance,
			samples: PATH_RENDER_CONFIG.simplifiedSamples,
		}
		: roundedZoomLevel >= 6
			? VISUAL_LINE_SMOOTHING_CONFIG_MAX_ZOOM
			: roundedZoomLevel >= 5
			? VISUAL_LINE_SMOOTHING_CONFIG_HIGH_ZOOM
			: VISUAL_LINE_SMOOTHING_CONFIG;

	return smoothLineCoordinatesForDisplay(coordinates, smoothingConfig).map(([x, y]) => [y, x]);
}

function syncPathLabels() {
	pathData.forEach(refreshPathLayerText);
}

function getReadablePathLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}

function refreshPathLayerPopup(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const popupMarkup = createPathPopupMarkup(path);
	path._pathLines.forEach((line) => {
		line.bindPopup(popupMarkup);
	});
}

function createPathLayer(path) {
	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	const colors = getPathStyleColors(path);
	const roadOutline = L.polyline(latLngCoords, {
		pane: "roadsOutlinePane",
		color: colors.outline,
		weight: colors.outlineWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE,
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const roadCenter = L.polyline(latLngCoords, {
		pane: "roadsPane",
		color: colors.center,
		weight: colors.centerWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE,
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const pathLabelLine = L.polyline(getReadablePathLabelLatLngCoordinates(latLngCoords), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});

	const layerGroup = L.layerGroup([roadOutline, roadCenter, pathLabelLine]);
	path._layerGroup = layerGroup;
	path._pathLines = [roadOutline, roadCenter];
	path._pathLabelLine = pathLabelLine;
	if (IS_EDIT_MODE) {
		path._pathLines.forEach((line) => {
			line.on("dblclick", (event) => handleEditablePathDoubleClick(path, event));
		});
	}
	refreshPathLayerPopup(path);
	updatePathLayerStyle(path);
	return layerGroup;
}

// Paths
function normalizeRoutePathFeature(feature, pathId) {
	const originalName = feature.properties?.display_name || feature.properties?.original_name || feature.properties?.name || feature.properties?.feature_subtype || "Weg";
	const routeType = normalizePathSubtype(feature.properties?.feature_subtype || originalName);
	return {
		...feature,
		id: feature.id || feature.properties?.public_id || `path-${pathId}`,
		geometry: {
			...feature.geometry,
			coordinates: feature.geometry.coordinates.map(([x, y]) => [x, y]),
		},
		properties: {
			...feature.properties,
			public_id: feature.properties?.public_id || feature.id || "",
			display_name: originalName,
			original_name: originalName,
			feature_subtype: routeType,
			name: `${routeType}-${pathId}`,
			id: `path-${pathId}`,
		},
	};
}

// Verarbeitung der Pfade (GeoJSON LineStrings)
const preparePathData = (data) => {
	pathData = data.features
		.filter((feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type !== "powerline")
		.map((feature, idx) => normalizeRoutePathFeature(feature, idx + 1));
	pathData.forEach((path) => {
		pathLayers.push(createPathLayer(path));
	});
};

const preparePowerlineData = (data) => {
	powerlineLayers.forEach((layer) => map.removeLayer(layer));
	powerlineLayers = [];
	powerlineData = data.features
		.filter((feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type === "powerline")
		.map(normalizePowerlineFeature);
	powerlineData.forEach((powerline) => {
		const layer = createPowerlineLayer(powerline);
		powerlineLayers.push(layer);
	});
	syncPowerlineVisibility();
};

function addCreatedPathFeature(feature) {
	const path = normalizeRoutePathFeature(feature, getNextLocalPathId());
	const pathLayer = createPathLayer(path);
	pathData.push(path);
	pathLayers.push(pathLayer);
	$("#togglePaths").prop("checked", true);
	syncPathVisibility();
	syncPathTransportOptions({ path });
	refreshPlannerAfterFeatureChange({ updateRoute: true });
	return path;
}

function applyLivePathFeature(feature) {
	if (feature.properties?.feature_type === "powerline") {
		applyLivePowerlineFeature(feature);
		return;
	}
	const publicId = feature.properties?.public_id || feature.id || "";
	const path = findPathByPublicId(publicId);
	if (path) {
		applyPathFeatureResponse(path, feature);
		return;
	}

	const newPath = normalizeRoutePathFeature(feature, getNextLocalPathId());
	const pathLayer = createPathLayer(newPath);
	pathData.push(newPath);
	pathLayers.push(pathLayer);
	syncPathVisibility();
}

function findPowerlineByPublicId(publicId) {
	return powerlineData.find((powerline) => (powerline.id || powerline.properties?.public_id) === publicId) || null;
}

function getConnectedPowerlinesForPublicId(publicId) {
	return powerlineData.filter((powerline) => powerline.properties?.from_public_id === publicId || powerline.properties?.to_public_id === publicId);
}

function applyLivePowerlineFeature(feature) {
	const publicId = feature.id || feature.properties?.public_id || "";
	const existingPowerline = findPowerlineByPublicId(publicId);
	if (existingPowerline?._layerGroup) {
		map.removeLayer(existingPowerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== existingPowerline._layerGroup);
		powerlineData = powerlineData.filter((powerline) => powerline !== existingPowerline);
	}
	const powerline = normalizePowerlineFeature(feature);
	const layer = createPowerlineLayer(powerline);
	powerlineData.push(powerline);
	powerlineLayers.push(layer);
	syncPowerlineVisibility();
}

function applyPowerlineFeatureResponse(powerline, feature) {
	const updatedPowerline = normalizePowerlineFeature(feature);
	powerline.geometry = updatedPowerline.geometry;
	powerline.properties = updatedPowerline.properties;
	powerline.id = updatedPowerline.id;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayers();
}

function findPathByPublicId(publicId) {
	return pathData.find((path) => getPathPublicId(path) === publicId) || null;
}

function updatePathLayerGeometry(path) {
	if (!path?._pathLines) {
		return;
	}

	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	path._pathLines.forEach((line) => line.setLatLngs(latLngCoords));
	path._pathLabelLine?.setLatLngs(getReadablePathLabelLatLngCoordinates(latLngCoords));
}

function syncPathRendering() {
	pathData.forEach((path) => {
		updatePathLayerGeometry(path);
		updatePathLayerStyle(path);
	});
}

function applyPathFeatureResponse(path, feature) {
	const publicId = feature.id || feature.properties?.public_id || getPathPublicId(path);
	const displayName = feature.properties?.display_name || feature.properties?.name || getPathDisplayName(path);
	const pathSubtype = normalizePathSubtype(feature.properties?.feature_subtype || feature.properties?.name || path.properties?.feature_subtype);
	path.id = publicId;
	path.geometry = {
		...path.geometry,
		coordinates: feature.geometry.coordinates.map(([x, y]) => [x, y]),
	};
	path.properties = {
		...path.properties,
		...feature.properties,
		public_id: publicId,
		display_name: displayName,
		original_name: displayName,
		feature_subtype: pathSubtype,
		name: `${pathSubtype}-${path.properties.id?.replace(/^path-/, "") || pathData.indexOf(path) + 1}`,
	};
	updatePathLayerGeometry(path);
	updatePathLayerStyle(path);
	refreshPathLayerPopup(path);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}

function removePathFeature(path) {
	if (path?._layerGroup) {
		map.removeLayer(path._layerGroup);
	}
	pathData = pathData.filter((entry) => entry !== path);
	pathLayers = pathLayers.filter((layer) => layer !== path._layerGroup);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}

function removeLiveFeature(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (markerEntry) {
		map.removeLayer(markerEntry.marker);
		removeLocationNameLabel(markerEntry);
		locationMarkers = locationMarkers.filter((entry) => entry !== markerEntry);
		locationData = locationData.filter((location) => location !== markerEntry.location);
		return;
	}

	const path = findPathByPublicId(publicId);
	if (path) {
		removePathFeature(path);
		return;
	}

	const powerline = findPowerlineByPublicId(publicId);
	if (powerline?._layerGroup) {
		map.removeLayer(powerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== powerline._layerGroup);
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		return;
	}

	const labelEntry = labelMarkers.find((entry) => entry.label.publicId === publicId);
	if (labelEntry) {
		map.removeLayer(labelEntry.marker);
		labelData = labelData.filter((label) => label !== labelEntry.label);
		labelMarkers = labelMarkers.filter((entry) => entry !== labelEntry);
		return;
	}

	const regionEntry = regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry?.publicId === publicId);
	if (regionEntry) {
		map.removeLayer(regionEntry.layer);
		if (regionEntry.label) {
			map.removeLayer(regionEntry.label);
			regionLabels = regionLabels.filter((label) => label !== regionEntry.label);
		}
		regionPolygons = regionPolygons.filter((polygon) => polygon !== regionEntry.layer);
	}
}

function applyLiveMapFeatureUpdate(feature) {
	const properties = feature.properties || {};
	const publicId = properties.public_id || feature.id || "";
	if (!publicId) {
		return;
	}

	if (properties.deleted) {
		removeLiveFeature(publicId);
		return;
	}

	if (properties.feature_type === "powerline") {
		applyLivePowerlineFeature(feature);
	} else if (feature.geometry?.type === "LineString") {
		applyLivePathFeature(feature);
	} else if (properties.feature_type === "label") {
		applyLiveLabelFeature(feature);
	} else if (properties.feature_type === "region") {
		const regionEntry = regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry?.publicId === publicId);
		if (regionEntry) {
			applyRegionFeatureResponse(regionEntry, feature);
		}
	} else if (feature.geometry?.type === "Point") {
		applyLiveLocationFeature(feature);
	}
}

function applyMapFeatureEditResult(result) {
	const feature = result?.feature;
	if (!feature) {
		return false;
	}

	if (feature.deleted && feature.public_id) {
		removeLiveFeature(feature.public_id);
		return true;
	}

	if (feature.type === "Feature") {
		applyLiveMapFeatureUpdate(feature);
		return true;
	}

	if (feature.public_id && Number.isFinite(Number(feature.lat)) && Number.isFinite(Number(feature.lng))) {
		applyLiveLocationFeature({
			type: "Feature",
			id: feature.public_id,
			geometry: {
				type: "Point",
				coordinates: [Number(feature.lng), Number(feature.lat)],
			},
			properties: {
				public_id: feature.public_id,
				name: feature.name || "",
				feature_type: feature.feature_type || "location",
				feature_subtype: feature.feature_subtype || feature.location_type || "dorf",
				settlement_class: feature.location_type || feature.feature_subtype || "dorf",
				settlement_class_label: feature.location_type_label || "",
				description: feature.description || "",
				wiki_url: feature.wiki_url || "",
				is_nodix: Boolean(feature.is_nodix),
				is_ruined: Boolean(feature.is_ruined),
				revision: feature.revision || null,
			},
		});
		return true;
	}

	return false;
}

function clearPendingPathCreation() {
	clearPendingPowerlineCreation();
	if (pendingPathCreationPreview) {
		map.removeLayer(pendingPathCreationPreview);
		pendingPathCreationPreview = null;
	}

	if (pendingPathCreationLine) {
		map.removeLayer(pendingPathCreationLine);
		pendingPathCreationLine = null;
	}

	pendingPathCreationStart = null;
	pendingPathCreationPoints = [];
	map.off("click", handlePendingPathCreationClick);
	map.getContainer().classList.remove("path-creation-cursor");
	refreshAllLocationMarkerPopups();
}

function clearPendingPowerlineCreation() {
	pendingPowerlineCreationStart = null;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
}

function startPowerlineCreationFromEndpoint(endpoint) {
	if (!isEligiblePowerlineEndpoint(endpoint)) {
		showFeedbackToast("Kraftlinien koennen nur an Nodix-Orten starten.", "warning");
		return;
	}
	pendingPowerlineCreationStart = endpoint;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
	showFeedbackToast(`Start-Nodix: ${endpoint.name}. Ziel-Nodix anklicken.`, "info");
}

async function completePendingPowerlineAtEndpoint(endEndpoint) {
	const startEndpoint = pendingPowerlineCreationStart;
	if (!startEndpoint || !isEligiblePowerlineEndpoint(endEndpoint) || startEndpoint.publicId === endEndpoint.publicId) {
		showFeedbackToast("Bitte zwei verschiedene Nodix-Orte verbinden.", "warning");
		return;
	}
	clearPendingPowerlineCreation();
	try {
		const result = await submitMapFeatureEdit({
			action: "create_powerline",
			from_public_id: startEndpoint.publicId,
			to_public_id: endEndpoint.publicId,
		});
		applyLivePowerlineFeature(result.feature);
		updateRevisionFromEditResponse(result);
		setSelectedMapLayerMode("powerlines");
		syncPowerlineVisibility();
		showFeedbackToast(`Kraftlinie ${startEndpoint.name} -> ${endEndpoint.name} erstellt.`, "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht erstellt werden.", "warning");
	}
}

function showPendingPathCreationPreview(startLocation) {
	if (pendingPathCreationPreview) {
		map.removeLayer(pendingPathCreationPreview);
	}

	pendingPathCreationPreview = L.circleMarker(startLocation.coordinates, {
		pane: "measurementHandlesPane",
		radius: 10,
		color: "#1452F7",
		weight: 3,
		fillColor: "#FFFFFF",
		fillOpacity: 0.9,
		interactive: false,
	}).addTo(map);
}

function updatePendingPathCreationLine() {
	if (pendingPathCreationLine) {
		map.removeLayer(pendingPathCreationLine);
		pendingPathCreationLine = null;
	}

	if (pendingPathCreationPoints.length < 2) {
		return;
	}

	pendingPathCreationLine = L.polyline(getVisualLatLngCoordinates(pendingPathCreationPoints), {
		pane: "measurementPane",
		color: "#1452F7",
		weight: 5,
		opacity: 0.9,
		dashArray: "8 8",
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	}).addTo(map);
}

function findNearestGraphEndpointToLatLng(latlng, { excludeLocation = null } = {}) {
	const targetPoint = map.latLngToContainerPoint(latlng);
	let nearestMatch = null;

	locationData.forEach((location) => {
		if (location === excludeLocation) {
			return;
		}

		const locationPoint = map.latLngToContainerPoint(L.latLng(location.coordinates));
		const distance = targetPoint.distanceTo(locationPoint);
		if (!nearestMatch || distance < nearestMatch.distance) {
			nearestMatch = { location, distance };
		}
	});

	return nearestMatch && nearestMatch.distance <= PATH_ENDPOINT_SNAP_DISTANCE_PX ? nearestMatch.location : null;
}

function startPathCreationAt(latlng) {
	const nearestMatch = findNearestGraphNodeToLatLng(L.latLng(latlng));
	if (!nearestMatch?.location) {
		showFeedbackToast("Kein Startknoten gefunden.", "warning");
		return;
	}

	clearPendingPathCreation();
	pendingPathCreationStart = nearestMatch.location;
	pendingPathCreationPoints = [L.latLng(pendingPathCreationStart.coordinates)];
	showPendingPathCreationPreview(pendingPathCreationStart);
	map.getContainer().classList.add("path-creation-cursor");
	refreshAllLocationMarkerPopups();
	map.on("click", handlePendingPathCreationClick);
	showFeedbackToast(`Start: ${pendingPathCreationStart.name}. Punkte setzen, Ort verbinden oder mit Weg abschliessen beenden.`, "info");
}

function startPathCreationFromLocation(location) {
	if (!location) {
		showFeedbackToast("Kein Startknoten gefunden.", "warning");
		return;
	}

	clearPendingPathCreation();
	pendingPathCreationStart = location;
	pendingPathCreationPoints = [L.latLng(location.coordinates)];
	showPendingPathCreationPreview(location);
	map.getContainer().classList.add("path-creation-cursor");
	refreshAllLocationMarkerPopups();
	map.on("click", handlePendingPathCreationClick);
	showFeedbackToast(`Start: ${location.name}. Punkte setzen, Ort verbinden oder mit Weg abschliessen beenden.`, "info");
}

function appendPendingPathCreationLocation(location) {
	if (!pendingPathCreationStart || !location) {
		return false;
	}

	const nextPoint = L.latLng(location.coordinates);
	const lastPoint = pendingPathCreationPoints.at(-1);
	if (!lastPoint || !lastPoint.equals(nextPoint)) {
		pendingPathCreationPoints.push(nextPoint);
		updatePendingPathCreationLine();
	}

	return true;
}

async function extendPendingPathCreationAtLocation(location) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	if (!location) {
		showFeedbackToast("Kein Zielknoten gefunden.", "warning");
		return;
	}

	appendPendingPathCreationLocation(location);
	showFeedbackToast(`Ort verbunden: ${location.name}. Weg kann weitergeführt werden.`, "success");
}

async function completePendingPathCreationAtLocation(endLocation) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	if (!endLocation) {
		showFeedbackToast("Kein Zielknoten gefunden.", "warning");
		return;
	}

	if (endLocation === pendingPathCreationStart) {
		showFeedbackToast("Start und Ziel sind identisch.", "warning");
		return;
	}

	const startLocation = pendingPathCreationStart;
	appendPendingPathCreationLocation(endLocation);
	const pathCoordinates = pendingPathCreationPoints.map((latLng) => [latLng.lat, latLng.lng]);
	clearPendingPathCreation();

	try {
		const result = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: "Weg",
			name: getNextPathDisplayName("Weg"),
			coordinates: pathCoordinates,
		});
		const createdPath = addCreatedPathFeature(result.feature);
		updateRevisionFromEditResponse(result);
		openPathEditDialog(createdPath, { inheritLastSettings: true });
		showFeedbackToast(`Weg ${startLocation.name} -> ${endLocation.name} erstellt.`, "success");
	} catch (error) {
		console.error("Weg konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht erstellt werden.", "warning");
	}
}

async function handlePendingPathCreationClick(event) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	const endLocation = findNearestGraphEndpointToLatLng(event.latlng, {
		excludeLocation: pendingPathCreationStart,
	});
	if (endLocation) {
		await completePendingPathCreationAtLocation(endLocation);
		return;
	}

	pendingPathCreationPoints.push(L.latLng(event.latlng));
	updatePendingPathCreationLine();
}

function pathCoordinatesToLatLngs(path) {
	return path.geometry.coordinates.map(([x, y]) => L.latLng(y, x));
}

function latLngsToPathCoordinates(latLngs) {
	return latLngs.map((latLng) => [latLng.lng, latLng.lat]);
}

function createPathEditHandleIcon() {
	return L.divIcon({
		className: "path-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function clearPathGeometryEdit() {
	if (!activePathGeometryEdit) {
		return;
	}

	void releaseFeatureSoftLock(getPathPublicId(activePathGeometryEdit.path));
	activePathGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	map.off("dblclick", handleMapDoubleClickWhileEditingPath);
	map.doubleClickZoom.enable();
	activePathGeometryEdit = null;
}

function getActivePathLatLngs() {
	return activePathGeometryEdit?.path ? pathCoordinatesToLatLngs(activePathGeometryEdit.path) : [];
}

function setActivePathLatLngs(latLngs) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	activePathGeometryEdit.path.geometry.coordinates = latLngsToPathCoordinates(latLngs);
	updatePathLayerGeometry(activePathGeometryEdit.path);
}

function refreshPathEditHandles() {
	if (!activePathGeometryEdit) {
		return;
	}

	activePathGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activePathGeometryEdit.handles = [];

	getActivePathLatLngs().forEach((latLng, index) => {
		const handle = L.marker(latLng, {
			icon: createPathEditHandleIcon(),
			pane: "measurementHandlesPane",
			draggable: true,
			keyboard: false,
		}).addTo(map);
		handle._pathNodeIndex = index;
		handle.on("dragstart", (event) => {
			event.target._pathNodeOriginalLatLng = event.target.getLatLng();
		});
		handle.on("drag", (event) => {
			const latLngs = getActivePathLatLngs();
			latLngs[index] = event.target.getLatLng();
			setActivePathLatLngs(latLngs);
		});
		handle.on("dragend", (event) => {
			void finishPathNodeDrag(index, event.target);
		});
		handle.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			deleteActivePathNode(index);
		});
		handle.on("contextmenu", (event) => {
			L.DomEvent.stop(event);
			preparePathSplitContextMenu(index, handle.getLatLng(), event.originalEvent);
		});
		activePathGeometryEdit.handles.push(handle);
	});
}

function preparePathSplitContextMenu(nodeIndex, latlng, originalEvent = null) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const latLngs = getActivePathLatLngs();
	if (nodeIndex <= 0 || nodeIndex >= latLngs.length - 1) {
		showFeedbackToast("Nur Zwischenknoten koennen einen Weg teilen.", "warning");
		return;
	}

	pendingPathSplit = {
		path: activePathGeometryEdit.path,
		nodeIndex,
		latlng: L.latLng(latlng),
	};
	openMapContextMenu(
		latlng,
		originalEvent?.clientX ?? 0,
		originalEvent?.clientY ?? 0
	);
}

function getPathSplitCoordinateGroups(path, nodeIndex) {
	const latLngs = activePathGeometryEdit?.path === path ? getActivePathLatLngs() : pathCoordinatesToLatLngs(path);
	if (nodeIndex <= 0 || nodeIndex >= latLngs.length - 1) {
		return null;
	}

	return {
		firstCoordinates: latLngs.slice(0, nodeIndex + 1).map((latLng) => [latLng.lat, latLng.lng]),
		secondCoordinates: latLngs.slice(nodeIndex).map((latLng) => [latLng.lat, latLng.lng]),
		splitLatLng: L.latLng(latLngs[nodeIndex]),
	};
}

async function splitPathAtNode(splitState) {
	const path = splitState?.path;
	if (!path || !pathData.includes(path)) {
		showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
		return;
	}

	const coordinateGroups = getPathSplitCoordinateGroups(path, splitState.nodeIndex);
	if (!coordinateGroups) {
		showFeedbackToast("Dieser Knoten kann den Weg nicht teilen.", "warning");
		return;
	}

	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	try {
		const crossingResult = await createCrossingFeatureAt(coordinateGroups.splitLatLng);
		addCreatedCrossingMarker(crossingResult.feature);
		ensureCrossingsEnabled();

		const firstPathResult = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: pathSubtype,
			name: getNextPathDisplayName(pathSubtype),
			coordinates: coordinateGroups.firstCoordinates,
		});
		addCreatedPathFeature(firstPathResult.feature);

		const secondPathResult = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: pathSubtype,
			name: getNextPathDisplayName(pathSubtype),
			coordinates: coordinateGroups.secondCoordinates,
		});
		addCreatedPathFeature(secondPathResult.feature);

		const deleteResult = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPathPublicId(path),
		});
		clearPathGeometryEdit();
		removePathFeature(path);
		updateRevisionFromEditResponse(deleteResult);
		showFeedbackToast("Weg geteilt und Kreuzung erstellt.", "success");
	} catch (error) {
		console.error("Weg konnte nicht geteilt werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht geteilt werden.", "warning");
	}
}

async function finishPathNodeDrag(index, handle) {
	const latLngs = getActivePathLatLngs();
	const isEndpoint = index === 0 || index === latLngs.length - 1;
	if (!isEndpoint) {
		await saveActivePathGeometry();
		return;
	}

	const otherEndpointIndex = index === 0 ? latLngs.length - 1 : 0;
	const otherEndpointLocation = findNearestGraphEndpointToLatLng(latLngs[otherEndpointIndex]);
	const snappedEndpoint = findNearestGraphEndpointToLatLng(handle.getLatLng(), {
		excludeLocation: otherEndpointLocation,
	});
	if (!snappedEndpoint) {
		latLngs[index] = handle._pathNodeOriginalLatLng || latLngs[index];
		setActivePathLatLngs(latLngs);
		refreshPathEditHandles();
		showFeedbackToast("Endpunkte muessen auf Orte oder Kreuzungen einrasten.", "warning");
		return;
	}

	latLngs[index] = L.latLng(snappedEndpoint.coordinates);
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	await saveActivePathGeometry();
}

function findNearestSegmentInsertIndex(path, latlng) {
	const latLngs = pathCoordinatesToLatLngs(path);
	if (latLngs.length < 2) {
		return latLngs.length;
	}

	const targetPoint = map.latLngToLayerPoint(latlng);
	let bestIndex = 1;
	let bestDistance = Infinity;

	for (let index = 0; index < latLngs.length - 1; index++) {
		const startPoint = map.latLngToLayerPoint(latLngs[index]);
		const endPoint = map.latLngToLayerPoint(latLngs[index + 1]);
		const segmentLengthSquared = startPoint.distanceTo(endPoint) ** 2;
		let ratio = 0;
		if (segmentLengthSquared > 0) {
			ratio = ((targetPoint.x - startPoint.x) * (endPoint.x - startPoint.x) + (targetPoint.y - startPoint.y) * (endPoint.y - startPoint.y)) / segmentLengthSquared;
			ratio = Math.max(0, Math.min(1, ratio));
		}
		const projectedPoint = L.point(
			startPoint.x + ratio * (endPoint.x - startPoint.x),
			startPoint.y + ratio * (endPoint.y - startPoint.y)
		);
		const distance = targetPoint.distanceTo(projectedPoint);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index + 1;
		}
	}

	return bestIndex;
}

function insertActivePathNode(latlng) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const latLngs = getActivePathLatLngs();
	const insertIndex = findNearestSegmentInsertIndex(activePathGeometryEdit.path, latlng);
	latLngs.splice(insertIndex, 0, L.latLng(latlng));
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	void saveActivePathGeometry();
}

function deleteActivePathNode(index) {
	const latLngs = getActivePathLatLngs();
	if (latLngs.length <= 2 || index === 0 || index === latLngs.length - 1) {
		showFeedbackToast("Start- und Endknoten bleiben erhalten.", "warning");
		return;
	}

	latLngs.splice(index, 1);
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	void saveActivePathGeometry();
}

function handleEditablePathDoubleClick(path, event) {
	L.DomEvent.stop(event);
	if (!activePathGeometryEdit || activePathGeometryEdit.path !== path) {
		startPathGeometryEdit(path, { showToast: false });
	}

	insertActivePathNode(event.latlng);
}

function handleEditableRegionDoubleClick(regionEntry, event) {
	L.DomEvent.stop(event);
	startRegionGeometryEdit(regionEntry);
	const latLngs = getRegionOuterLatLngs(regionEntry);
	const insertIndex = findNearestRegionSegmentInsertIndex(regionEntry, event.latlng);
	latLngs.splice(insertIndex, 0, L.latLng(event.latlng));
	regionEntry.layer.setLatLngs([latLngs]);
	updateRegionLabelPosition(regionEntry);
	refreshRegionEditHandles();
	void saveRegionGeometry(regionEntry);
}

function findNearestRegionSegmentInsertIndex(regionEntry, latlng) {
	const latLngs = getRegionOuterLatLngs(regionEntry);
	const targetPoint = map.latLngToLayerPoint(latlng);
	let bestIndex = 1;
	let bestDistance = Infinity;
	for (let index = 0; index < latLngs.length; index++) {
		const start = latLngs[index];
		const end = latLngs[(index + 1) % latLngs.length];
		const startPoint = map.latLngToLayerPoint(start);
		const endPoint = map.latLngToLayerPoint(end);
		const distance = L.LineUtil.pointToSegmentDistance(targetPoint, startPoint, endPoint);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index + 1;
		}
	}
	return bestIndex;
}

function handleMapDoubleClickWhileEditingPath(event) {
	if (event.originalEvent?.target?.closest?.(".path-edit-handle-marker")) {
		return;
	}

	clearPathGeometryEdit();
	showFeedbackToast("Wegverlauf-Bearbeitung beendet.", "success");
}

async function saveActivePathGeometry() {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const path = activePathGeometryEdit.path;
	try {
		const result = await submitMapFeatureEdit({
			action: "update_path_geometry",
			public_id: getPathPublicId(path),
			coordinates: path.geometry.coordinates.map(([x, y]) => [y, x]),
		});
		applyPathFeatureResponse(path, result.feature);
		updateRevisionFromEditResponse(result);
	} catch (error) {
		console.error("Wegverlauf konnte nicht gespeichert werden:", error);
		showFeedbackToast(error.message || "Wegverlauf konnte nicht gespeichert werden.", "warning");
	}
}

function startPathGeometryEdit(path, { showToast = true } = {}) {
	clearPendingPathCreation();
	clearPathGeometryEdit();
	void acquireFeatureSoftLock(getPathPublicId(path));
	path._layerGroup?.closePopup();
	activePathGeometryEdit = {
		path,
		handles: [],
	};
	map.doubleClickZoom.disable();
	refreshPathEditHandles();
	map.on("dblclick", handleMapDoubleClickWhileEditingPath);
	if (showToast) {
		showFeedbackToast("Knoten ziehen. Doppelklick Linie fuegt Knoten hinzu, Doppelklick Knoten loescht ihn.", "info");
	}
}

async function deletePathFeature(path) {
	if (!window.confirm(`${getPathDisplayName(path)} wirklich loeschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPathPublicId(path),
		});
		clearPathGeometryEdit();
		removePathFeature(path);
		updateRevisionFromEditResponse(result);
		showFeedbackToast("Weg geloescht.", "success");
	} catch (error) {
		console.error("Weg konnte nicht geloescht werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht geloescht werden.", "warning");
	}
}

async function deletePowerlineFeature(powerline) {
	if (!powerline) {
		return;
	}

	if (!window.confirm(`${getPowerlineDisplayName(powerline)} wirklich loeschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPowerlinePublicId(powerline),
		});
		map.removeLayer(powerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== powerline._layerGroup);
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie geloescht.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht geloescht werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht geloescht werden.", "warning");
	}
}

// Verarbeitung der Regionen
// Regions
function prepareRegionData(data) {

	regionPolygons = [];
	regionLabels = [];

	regionData = data.features.filter(
		f => f.properties?.type === "region"
	);

	regionData.forEach(region => {
		const regionEntry = normalizeRegionFeature(region);

		const name = regionEntry.name;
		const fill = regionEntry.color;
		const stroke = regionEntry.color;
		const fillOpacity = regionEntry.opacity;

		let polygons = [];

		if (region.geometry.type === "Polygon") {
			polygons = [region.geometry.coordinates];
		}

		if (region.geometry.type === "MultiPolygon") {
			polygons = region.geometry.coordinates;
		}

		polygons.forEach((poly, index) => {

			const latlngs = poly.map(ring =>
				ring.map(([x, y]) => [y, x])
			);

			const polygon = L.polygon(latlngs, {
				pane: "regionsPane",
				color: stroke,
				weight: 2,
				fillColor: fill,
				fillOpacity,
				interactive: IS_EDIT_MODE,
			});
			polygon._regionEntry = regionEntry;
			regionEntry.layer = polygon;
			bindRegionPolygonEditEvents(polygon, regionEntry);

			polygon.bringToBack();

			regionPolygons.push(polygon);

			// Label nur einmal pro Region erzeugen
			if (index === 0) {

				const bounds = polygon.getBounds();
				const center = polygon.getBounds().getCenter();
				const label = L.tooltip({
					permanent: true,
					direction: "center",
					offset: [0, 0],
					opacity: 1,
					className: "region-label",
					pane: "regionLabelsPane"
				})
					.setLatLng(center)
					.setContent(name);

				regionEntry.label = label;
				regionLabels.push(label);

			}

		});

	});

}

function bindRegionPolygonEditEvents(polygon, regionEntry) {
	if (!IS_EDIT_MODE) return;
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);
		startRegionGeometryEdit(regionEntry);
	});
	polygon.on("dblclick", (event) => {
		if (event.originalEvent?.target?.closest?.(".region-edit-handle-marker")) return;
		if (activeRegionGeometryEdit?.regionEntry === regionEntry) {
			handleEditableRegionDoubleClick(regionEntry, event);
			return;
		}
		L.DomEvent.stop(event);
		startRegionGeometryEdit(regionEntry);
		openRegionEditDialog(regionEntry);
	});
	polygon.on("contextmenu", (event) => {
		L.DomEvent.stop(event);
		startRegionGeometryEdit(regionEntry);
		openRegionEditDialog(regionEntry);
	});
}

function normalizeRegionFeature(feature) {
	const properties = feature.properties || {};
	const fillColor = getRegionFeatureColor(properties);
	const opacity = getRegionFeatureOpacity(properties);
	return {
		publicId: properties.public_id || feature.id || properties.id || properties.svg_id || "",
		name: getRegionFeatureName(properties),
		color: fillColor,
		opacity,
		wikiUrl: properties.wiki_url || "",
		revision: Number(properties.revision) || null,
		feature,
		layer: null,
		label: null,
		handles: [],
	};
}

function getRegionFeatureName(properties) {
	return String(
		properties.name
		|| properties["data-item-label"]
		|| properties.title
		|| properties.label
		|| properties.feature_subtype
		|| properties.layer
		|| "Region"
	).trim() || "Region";
}

function getRegionFeatureColor(properties) {
	return normalizeRegionHexColor(
		properties.fill
		|| getStyleDeclarationValue(properties.style, "fill")
		|| properties.stroke
		|| getStyleDeclarationValue(properties.style, "stroke")
		|| "#888888"
	);
}

function getRegionFeatureOpacity(properties) {
	const rawOpacity = properties.fillOpacity
		?? properties.fill_opacity
		?? properties["fill-opacity"]
		?? getStyleDeclarationValue(properties.style, "fill-opacity")
		?? 0.33;
	const opacity = Number(rawOpacity);
	return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.33;
}

function getStyleDeclarationValue(style, propertyName) {
	if (!style) return "";
	const declarations = String(style).split(";");
	const declaration = declarations.find((entry) => entry.trim().toLowerCase().startsWith(`${propertyName.toLowerCase()}:`));
	return declaration ? declaration.split(":").slice(1).join(":").trim() : "";
}

function normalizeRegionHexColor(value) {
	const color = String(value || "").trim();
	return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color) ? color : "#888888";
}

function polygonLatLngsToCoordinates(latLngs) {
	const ring = latLngs.map((latLng) => [latLng.lng, latLng.lat]);
	const first = ring[0];
	const last = ring[ring.length - 1];
	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
	return [ring];
}

function getRegionOuterLatLngs(regionEntry) {
	const latLngs = regionEntry.layer.getLatLngs();
	return Array.isArray(latLngs[0]?.[0]) ? latLngs[0][0] : latLngs[0] || [];
}

function createRegionHandleIcon() {
	return L.divIcon({
		className: "path-edit-handle-marker region-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function clearRegionGeometryEdit() {
	if (!activeRegionGeometryEdit) return;
	void releaseFeatureSoftLock(activeRegionGeometryEdit.regionEntry.publicId);
	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit = null;
}

function refreshRegionEditHandles() {
	if (!activeRegionGeometryEdit) return;
	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit.handles = [];
	getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry).forEach((latLng, index) => {
		const handle = L.marker(latLng, {
			icon: createRegionHandleIcon(),
			pane: "measurementHandlesPane",
			draggable: true,
			keyboard: false,
		}).addTo(map);
		handle.on("drag", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			latLngs[index] = event.target.getLatLng();
			activeRegionGeometryEdit.regionEntry.layer.setLatLngs([latLngs]);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
		});
		handle.on("dragend", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			latLngs[index] = findNearestRegionVertex(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
			activeRegionGeometryEdit.regionEntry.layer.setLatLngs([latLngs]);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
			refreshRegionEditHandles();
			void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
		});
		handle.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			deleteRegionNode(index);
		});
		activeRegionGeometryEdit.handles.push(handle);
	});
}

function startRegionGeometryEdit(regionEntry) {
	clearRegionGeometryEdit();
	void acquireFeatureSoftLock(regionEntry.publicId);
	activeRegionGeometryEdit = { regionEntry, handles: [] };
	refreshRegionEditHandles();
}

function updateRegionLabelPosition(regionEntry) {
	if (regionEntry?.label && regionEntry.layer) {
		regionEntry.label.setLatLng(regionEntry.layer.getBounds().getCenter());
	}
}

function findNearestRegionVertex(latLng, ownRegion) {
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;
	regionPolygons.forEach((polygon) => {
		if (polygon._regionEntry === ownRegion) return;
		const rings = polygon.getLatLngs();
		const outer = Array.isArray(rings[0]?.[0]) ? rings[0][0] : rings[0] || [];
		outer.forEach((candidate) => {
			const distance = targetPoint.distanceTo(map.latLngToContainerPoint(candidate));
			if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { latLng: candidate, distance };
		});
	});
	return nearest?.latLng || null;
}

function deleteRegionNode(index) {
	const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
	if (latLngs.length <= 3) {
		showFeedbackToast("Region braucht mindestens drei Punkte.", "warning");
		return;
	}
	latLngs.splice(index, 1);
	activeRegionGeometryEdit.regionEntry.layer.setLatLngs([latLngs]);
	updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
	refreshRegionEditHandles();
	void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
}

async function saveRegionGeometry(regionEntry) {
	if (!isSqlMapFeatureId(regionEntry.publicId)) {
		showFeedbackToast("Region hat keine gueltige SQL-ID.", "warning");
		return;
	}
	const coordinates = polygonLatLngsToCoordinates(getRegionOuterLatLngs(regionEntry));
	try {
		const result = await submitMapFeatureEdit({ action: "update_region_geometry", public_id: regionEntry.publicId, coordinates });
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		showFeedbackToast("Regionsgrenze gespeichert.", "success");
	} catch (error) {
		showFeedbackToast(error.message || "Regionsgrenze konnte nicht gespeichert werden.", "warning");
	}
}

function applyRegionFeatureResponse(regionEntry, feature) {
	const updatedRegion = normalizeRegionFeature(feature);
	regionEntry.publicId = updatedRegion.publicId || regionEntry.publicId;
	regionEntry.name = updatedRegion.name || regionEntry.name;
	regionEntry.color = updatedRegion.color || regionEntry.color;
	regionEntry.opacity = updatedRegion.opacity ?? regionEntry.opacity;
	regionEntry.wikiUrl = updatedRegion.wikiUrl || "";
	regionEntry.revision = updatedRegion.revision || regionEntry.revision || null;
	regionEntry.feature = feature;
	regionEntry.layer.setStyle({ color: regionEntry.color, fillColor: regionEntry.color, fillOpacity: regionEntry.opacity });
	regionEntry.label?.setContent(regionEntry.name);
}

async function createRegionAt(latlng) {
	setSelectedMapLayerMode("political");
	const center = L.latLng(latlng);
	const radius = 80;
	const points = Array.from({ length: 6 }, (_, index) => {
		const angle = Math.PI / 3 * index;
		return [center.lng + Math.cos(angle) * radius, center.lat + Math.sin(angle) * radius];
	});
	points.push(points[0]);
	try {
		const result = await submitMapFeatureEdit({
			action: "create_region",
			name: "Neue Region",
			color: "#888888",
			opacity: 0.33,
			wiki_url: "",
			coordinates: [points],
		});
		const regionEntry = normalizeRegionFeature(result.feature);
		regionData.push(result.feature);
		const polygon = L.polygon([points.map(([x, y]) => [y, x])], {
			pane: "regionsPane",
			color: regionEntry.color,
			weight: 2,
			fillColor: regionEntry.color,
			fillOpacity: regionEntry.opacity,
			interactive: IS_EDIT_MODE,
		}).addTo(map);
		polygon._regionEntry = regionEntry;
		regionEntry.layer = polygon;
		bindRegionPolygonEditEvents(polygon, regionEntry);
		regionPolygons.push(polygon);
		const label = L.tooltip({
			permanent: true,
			direction: "center",
			offset: [0, 0],
			opacity: 1,
			className: "region-label",
			pane: "regionLabelsPane",
		})
			.setLatLng(polygon.getBounds().getCenter())
			.setContent(regionEntry.name);
		regionEntry.label = label;
		regionLabels.push(label);
		if (getSelectedMapLayerMode() === "political") {
			map.addLayer(label);
		}
		startRegionGeometryEdit(regionEntry);
		openRegionEditDialog(regionEntry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
	} catch (error) {
		showFeedbackToast(error.message || "Region konnte nicht erstellt werden.", "warning");
	}
}

async function deleteActiveRegion() {
	if (!regionEditEntry || !window.confirm(`${regionEditEntry.name} wirklich loeschen?`)) return;
	if (!isSqlMapFeatureId(regionEditEntry.publicId)) {
		setRegionEditStatus("Diese Region hat keine gueltige SQL-ID.", "error");
		return;
	}
	try {
		const result = await submitMapFeatureEdit({ action: "delete_feature", public_id: regionEditEntry.publicId });
		map.removeLayer(regionEditEntry.layer);
		if (regionEditEntry.label) {
			map.removeLayer(regionEditEntry.label);
			regionLabels = regionLabels.filter((label) => label !== regionEditEntry.label);
		}
		regionPolygons = regionPolygons.filter((polygon) => polygon !== regionEditEntry.layer);
		clearRegionGeometryEdit();
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Region geloescht.", "success");
	} catch (error) {
		setRegionEditStatus(error.message || "Region konnte nicht geloescht werden.", "error");
	}
}

// Verarbeitung der Rastzeiten
