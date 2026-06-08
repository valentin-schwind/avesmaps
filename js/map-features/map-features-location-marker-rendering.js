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

// Weisser Rand skaliert linear mit der Markergroesse (gleiches Verhaeltnis auf jeder Zoomstufe).
const LOCATION_MARKER_RING_RATIO = 0.13;

function getLocationMarkerBorderWidth(locationType, zoomLevel = map.getZoom()) {
	const markerSize = getLocationMarkerSize(locationType, zoomLevel);
	return Math.max(0.75, Math.round(markerSize * LOCATION_MARKER_RING_RATIO * 100) / 100);
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

	const markerSize = getLocationMarkerSize(locationType, zoomLevel);
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	const isSite = locationType === "gebaeude";
	const isDiamond = isSite && visualZoomLevel >= 4; // Raute erst zeigen, wenn sie lesbar ist
	const isCapital = locationType === "metropole" && visualZoomLevel >= 3 && markerSize >= 14;

	const shapeClasses = ["location-visual-marker__shape"];
	shapeClasses.push(isDiamond ? "location-visual-marker__shape--diamond" : "location-visual-marker__shape--circle");
	if (isSite) {
		shapeClasses.push("location-visual-marker__shape--site");
	}
	if (isCapital) {
		shapeClasses.push("location-visual-marker__shape--capital");
	}

	const styleDeclarations = [
		`width:${markerSize}px`,
		`height:${markerSize}px`,
		`border-width:${getLocationMarkerBorderWidth(locationType, zoomLevel)}px`,
	];
	if (isCapital) {
		styleDeclarations.push(`--accent-ring-width:${Math.round(markerSize * 0.12)}px`);
	}

	const iconHtml = `<span${buildHtmlAttributes({
		class: shapeClasses.join(" "),
		style: `${styleDeclarations.join(";")};`,
	})}></span>`;

	return L.divIcon({
		className: "location-visual-marker",
		html: iconHtml,
		iconSize: [markerSize, markerSize],
		iconAnchor: [markerSize / 2, markerSize / 2],
		popupAnchor: [0, -(markerSize / 2)],
	});
}

function shouldShowLocationMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	// Per "Nächsten Ort finden"/Suche temporaer angepinnter Marker bleibt sichtbar, auch wenn seine
	// Ortsgroesse nicht eingeblendet ist — bis die zugehoerige Infobox geschlossen wird.
	if (typeof nearestLookupPinnedMarkerEntry !== "undefined" && entry === nearestLookupPinnedMarkerEntry) {
		return true;
	}
	// Orte mit offener Routen-Wegpunkt-Infobox bleiben temporaer sichtbar (bis die Infobox schliesst).
	if (typeof routeWaypointTempMarkerEntries !== "undefined" && routeWaypointTempMarkerEntries && routeWaypointTempMarkerEntries.has(entry)) {
		return true;
	}
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
		// Icon nur neu bauen, wenn sich die Zoomstufe (= Markergroesse/-stil) seit dem
		// letzten Bau fuer diesen Marker geaendert hat. Beim reinen Pannen bleibt das Icon
		// identisch -> kein setIcon-Neuaufbau pro sichtbarem Marker pro moveend.
		if (shouldShow && entry.iconZoomLevel !== zoomLevel) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, zoomLevel));
			entry.iconZoomLevel = zoomLevel;
		}
		const isOnMap = map.hasLayer(entry.marker);
		if (shouldShow && !isOnMap) {
			map.addLayer(entry.marker);
		} else if (!shouldShow && isOnMap) {
			map.removeLayer(entry.marker);
		}
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


