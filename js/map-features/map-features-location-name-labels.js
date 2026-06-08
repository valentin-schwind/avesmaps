const LOCATION_NAME_LABEL_SIZE_BY_ZOOM = {
	metropole: { 0: 9, 1: 10, 2: 12, 3: 14, 4: 18, 5: 20 },
	grossstadt: { 0: 9, 1: 9.5, 2: 11, 3: 13, 4: 16, 5: 18 },
	stadt: { 0: 9, 1: 9, 2: 10, 3: 12, 4: 14, 5: 16 },
	kleinstadt: { 0: 9, 1: 9, 2: 9.5, 3: 10.5, 4: 12, 5: 14 },
	dorf: { 0: 9, 1: 9, 2: 9, 3: 9.5, 4: 11, 5: 12 },
	gebaeude: { 0: 9, 1: 9, 2: 9, 3: 9, 4: 10, 5: 10 },
};

function getLocationNameLabelSize(locationType, zoomLevel = map.getZoom()) {
	const roundedZoomLevel = getVisualZoomLevel(zoomLevel);
	const sizeByZoom = LOCATION_NAME_LABEL_SIZE_BY_ZOOM[locationType] || LOCATION_NAME_LABEL_SIZE_BY_ZOOM.dorf;
	return Math.max(9, Number(sizeByZoom[roundedZoomLevel] ?? sizeByZoom[VISUAL_MAX_ZOOM_LEVEL] ?? sizeByZoom[4] ?? sizeByZoom[3] ?? sizeByZoom[2] ?? sizeByZoom[1] ?? sizeByZoom[0] ?? 9));
}

// Kleiner Abstand zwischen Marker-Aussenrand und Schrift (wird auf den Marker-Radius addiert).
const LOCATION_NAME_LABEL_GAP = 4;

function getLocationNameLabelOffset(labelSize, zoomLevel = map.getZoom(), locationType = "dorf") {
	// Schrift rechts NEBEN den Marker setzen: Aussenradius + fester Spalt -> respektiert die (variable) Markergroesse.
	const markerOuterRadius = getLocationMarkerSize(locationType, zoomLevel) / 2;
	const labelHeightInPixels = labelSize * 4 / 3;
	return {
		x: Math.round(markerOuterRadius + LOCATION_NAME_LABEL_GAP),
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
	const offset = getLocationNameLabelOffset(labelSize, zoomLevel, entry.locationType);
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
