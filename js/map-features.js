// Location markers and labels
const VISUAL_MAX_ZOOM_LEVEL = 5;
const LOCATION_LABEL_GAP = 11;
const LOCATION_LABEL_SHIFT_SMALL = 8;
const LOCATION_LABEL_COLLISION_PADDING = 2;
const REGION_OVERLAP_SELECTION_TIMEOUT_MS = 3000;
const REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE = 18;
const REGION_EDIT_EDGE_HIT_TOLERANCE_PX = 22;
let recentRegionOverlapSelection = null;

function syncRegionVisibility() {
	const showRegions = getSelectedMapLayerMode() === "political";
	const currentZoom = Math.round(map.getZoom());
	syncPoliticalTimelineVisibility();
	if (!showRegions) {
		clearRegionGeometryEdit();
		closeRegionCompactTooltip();
		closeRegionContextMenu();
		cancelPendingRegionOperation();
	}

	regionPolygons.forEach((layer) => {
		const regionEntry = layer?._regionEntry || null;
		const minZoom = readOptionalRegionZoom(regionEntry?.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry?.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(layer);
		} else {
			map.removeLayer(layer);
		}
	});

	regionLabels.forEach((label) => {
		const regionEntry = regionData.find((entry) => entry?._normalizedRegionEntry?.label === label)
			|| regionPolygons.map((polygon) => polygon?._regionEntry).find((entry) => entry?.label === label)
			|| null;
		const minZoom = readOptionalRegionZoom(regionEntry?.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry?.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(label);
		} else {
			map.removeLayer(label);
		}
	});

	if (showRegions) {
		schedulePoliticalTerritoryLayerReload();
	}
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
$("#mapLayerModeSelect option[value=\"political\"]").prop("disabled", !IS_EDIT_MODE);
initializeTransportIconSelects();
initializeVersionedAssetIcons();
syncTransportControls();
syncTransportControl("mapLayerModeSelect");
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

// Normalisiert den Knotennamen
const normalizeNodeName = (name) => {
	if (typeof name === "string") return name.replace(/Kreuzung-\d+/i, "Kreuzung");
	console.warn("Ungültiger Name in normalizeNodeName:", name);
	return name || "";
};

function getLocationAtPathEndpoint([x, y]) {
	return locationData.find(({ coordinates: [lat, lng] }) => Math.abs(lat - y) < THRESHOLD && Math.abs(lng - x) < THRESHOLD) || null;
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
		wiki_url: readFeatureWikiUrl(properties),
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

function findPathByPublicId(publicId) {
	return pathData.find((path) => getPathPublicId(path) === publicId) || null;
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

function handleEditableRegionDoubleClick(regionEntry, event, editLayer = null) {
	L.DomEvent.stop(event);
	startRegionGeometryEdit(regionEntry, editLayer || activeRegionGeometryEdit?.editLayer || regionEntry.layer);
	const latLngs = getRegionOuterLatLngs(regionEntry);
	const insertIndex = findNearestRegionSegmentInsertIndex(regionEntry, event.latlng);
	latLngs.splice(insertIndex, 0, L.latLng(event.latlng));
	setRegionOuterLatLngs(regionEntry, latLngs);
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

// Verarbeitung der Regionen
// Regions
function prepareRegionData(data) {
	politicalTerritoryFallbackData = data;
	clearRenderedRegionLayers();
	if (POLITICAL_TERRITORIES_API_URL) {
		void loadPoliticalTerritoryOptions();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		return;
	}

	prepareLegacyRegionData(data);
}

function prepareLegacyRegionData(data) {
	clearRenderedRegionLayers();
	regionData = data.features.filter(
		f => f.properties?.type === "region"
	);

	regionData.forEach(region => {
		const regionEntry = normalizeRegionFeature(region);
		addRegionFeatureToMap(region, regionEntry);
	});
}

function clearRenderedRegionLayers() {
	closeRegionCompactTooltip();
	clearPendingRegionTargetHighlight();
	recentRegionOverlapSelection = null;
	regionPolygons.forEach((polygon) => map.removeLayer(polygon));
	regionLabels.forEach((label) => map.removeLayer(label));
	regionPolygons = [];
	regionLabels = [];
	regionData = [];
	clearRegionGeometryEdit();
}

function addRegionFeatureToMap(region, regionEntry) {
	const name = regionEntry.name;
	const fill = regionEntry.color;
	const stroke = regionEntry.color;
	const fillOpacity = regionEntry.opacity;
	let polygons = [];

	if (region.geometry?.type === "Polygon") {
		polygons = [region.geometry.coordinates];
	}

	if (region.geometry?.type === "MultiPolygon") {
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
			interactive: IS_EDIT_MODE || regionEntry.source === "political_territory",
		});
		polygon._regionEntry = regionEntry;
		polygon._regionPolygonIndex = index;
		regionEntry.layers.push(polygon);
		if (!regionEntry.layer) {
			regionEntry.layer = polygon;
		}
		bindRegionPolygonEditEvents(polygon, regionEntry);
		polygon.bringToBack();
		regionPolygons.push(polygon);
		if (index === 0 && regionEntry.showRegionLabel !== false) {
			const labelLatLng = regionEntry.labelLat !== null && regionEntry.labelLng !== null
				? L.latLng(regionEntry.labelLat, regionEntry.labelLng)
				: polygon.getBounds().getCenter();
			const label = L.tooltip({
				permanent: true,
				direction: "center",
				offset: [0, 0],
				opacity: 1,
				className: "region-label",
				pane: "regionLabelsPane"
			})
				.setLatLng(labelLatLng)
				.setContent(createRegionLabelMarkup(regionEntry, name));

			regionEntry.label = label;
			regionLabels.push(label);
		}
		bindRegionCompactTooltip(polygon, regionEntry);
	});
}

function syncPoliticalTimelineVisibility() {
	const timelineElement = document.getElementById("political-timeline");
	const isPoliticalMode = getSelectedMapLayerMode() === "political";

	if (!timelineElement) {
		return;
	}

	timelineElement.hidden = !isPoliticalMode;

	if (!isPoliticalMode) {
		clearPoliticalTerritoryTimelineSelection();
		return;
	}

	syncPoliticalTimelineControls();
}

function syncPoliticalTimelineControls() {
	const rangeElement = document.getElementById("political-timeline-range");
	const yearElement = document.getElementById("political-timeline-year");
	const labelElement = document.getElementById("political-timeline-label");
	if (!rangeElement || !yearElement || !labelElement) {
		return;
	}

	rangeElement.value = String(politicalTimelineYear);
	yearElement.value = String(politicalTimelineYear);
	labelElement.textContent = formatPoliticalTimelineYear(politicalTimelineYear);
}

function formatPoliticalTimelineYear(yearBf) {
	return "BF";
}

function setPoliticalTimelineYear(value) {
	const parsedYear = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsedYear)) {
		return;
	}

	politicalTimelineYear = Math.max(0, Math.min(1049, parsedYear));
	syncPoliticalTimelineControls();
	schedulePoliticalTerritoryLayerReload();
}
function showPoliticalTerritoryTimelineSelection(regionEntry) {
	const panelElement = document.getElementById("political-territory-range");
	const nameElement = document.getElementById("political-territory-range-name");
	const yearsElement = document.getElementById("political-territory-range-years");
	const barElement = document.getElementById("political-territory-range-bar");

	if (!panelElement || !nameElement || !yearsElement || !barElement || !regionEntry) {
		return;
	}

	const startYear = normalizePoliticalTimelineYearValue(regionEntry.validFromBf);
	const endYear = normalizePoliticalTimelineYearValue(regionEntry.validToBf);
	const hasStart = startYear !== null;
	const hasEnd = endYear !== null && endYear < 9999;

	const minYear = 0;
	const maxYear = 1049;
	const range = maxYear - minYear;

	const effectiveStart = hasStart ? Math.max(startYear, minYear) : minYear;
	const effectiveEnd = hasEnd ? Math.min(endYear, maxYear) : maxYear;

	nameElement.textContent = normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name || "Herrschaftsgebiet");
	yearsElement.textContent = formatPoliticalTerritoryRangeLabel(startYear, endYear, regionEntry.validLabel);

	const leftPercent = Math.max(0, Math.min(100, ((effectiveStart - minYear) / range) * 100));
	const rightPercent = Math.max(0, Math.min(100, ((effectiveEnd - minYear) / range) * 100));
	const widthPercent = rightPercent > leftPercent
		? Math.max(1.5, rightPercent - leftPercent)
		: 0;

	barElement.style.left = `${leftPercent}%`;
	barElement.style.width = `${widthPercent}%`;
	barElement.style.backgroundColor = normalizeRegionHexColor(regionEntry.color || "#888888");

	barElement.hidden = false;
	panelElement.hidden = false;
}

function clearPoliticalTerritoryTimelineSelection() {
	const panelElement = document.getElementById("political-territory-range");
	const barElement = document.getElementById("political-territory-range-bar");

	if (panelElement) {
		panelElement.hidden = true;
	}

	if (barElement) {
		barElement.hidden = true;
	}
}

function normalizePoliticalTimelineYearValue(value) {
	const number = Number(value);

	return Number.isFinite(number) ? number : null;
}

function formatPoliticalTerritoryRangeLabel(startYear, endYear, fallbackLabel = "") {
	const normalizedFallback = String(fallbackLabel || "").trim();

	if (normalizedFallback !== "") {
		return normalizedFallback;
	}

	const hasStart = startYear !== null;
	const hasEnd = endYear !== null && endYear < 9999;

	if (!hasStart && !hasEnd) {
		return "Zeitraum unbekannt";
	}

	if (hasStart && !hasEnd) {
		return `seit ${formatPoliticalTimelineYear(startYear)}`;
	}

	if (!hasStart && hasEnd) {
		return `bis ${formatPoliticalTimelineYear(endYear)}`;
	}

	return `${formatPoliticalTimelineYear(startYear)} – ${formatPoliticalTimelineYear(endYear)}`;
}

function schedulePoliticalTerritoryLayerReload({ immediate = false } = {}) {
	if (!POLITICAL_TERRITORIES_API_URL || politicalTerritoryApiUnavailable || isPoliticalTerritoryLayerLoading || getSelectedMapLayerMode() !== "political") {
		return;
	}
	if (!immediate && (activeRegionGeometryEdit || pendingRegionOperation || pendingRegionMoveState)) {
		return;
	}

	if (politicalTerritoryLayerReloadTimerId) {
		window.clearTimeout(politicalTerritoryLayerReloadTimerId);
	}

	const delay = immediate ? 0 : 180;
	politicalTerritoryLayerReloadTimerId = window.setTimeout(() => {
		politicalTerritoryLayerReloadTimerId = null;
		void loadPoliticalTerritoryLayer();
	}, delay);
}

function cancelPoliticalTerritoryLayerReload() {
	if (!politicalTerritoryLayerReloadTimerId) {
		return;
	}

	window.clearTimeout(politicalTerritoryLayerReloadTimerId);
	politicalTerritoryLayerReloadTimerId = null;
}

async function loadPoliticalTerritoryLayer() {
	if (isPoliticalTerritoryLayerLoading || !POLITICAL_TERRITORIES_API_URL) {
		return;
	}

	window.__avesmapsPoliticalLayerRequestSeq = (window.__avesmapsPoliticalLayerRequestSeq || 0) + 1;
	const requestSeq = window.__avesmapsPoliticalLayerRequestSeq;
	isPoliticalTerritoryLayerLoading = true;
	try {
		const response = await fetchPoliticalTerritories({
			action: "layer",
			year_bf: politicalTimelineYear,
			zoom: Math.round(map.getZoom()),
			edit_mode: IS_EDIT_MODE ? 1 : 0,
		});
		if (activeRegionGeometryEdit || pendingRegionOperation || pendingRegionMoveState) {
			return;
		}
		if (requestSeq !== window.__avesmapsPoliticalLayerRequestSeq) {
			return;
		}
		politicalTerritoryApiUnavailable = false;
		clearPoliticalTerritoryTimelineSelection();
		clearRenderedRegionLayers();
		regionData = Array.isArray(response.features) ? response.features : [];
		regionData.forEach((region) => addRegionFeatureToMap(region, normalizeRegionFeature(region)));
		syncRegionVisibility();
	} catch (error) {
		console.warn("Herrschaftsgebiete konnten nicht geladen werden:", error);
		// Keep political API active; transient request failures must not switch rendering
		// to legacy fallback data because that can show stale zoom visibility states.
		politicalTerritoryApiUnavailable = false;
	} finally {
		isPoliticalTerritoryLayerLoading = false;
	}
}

async function loadPoliticalTerritoryOptions({ force = false } = {}) {
	if (!force && politicalTerritoryOptionsSource === "wiki" && politicalTerritoryOptionsLoaded) {
		return politicalTerritoryOptions;
	}
	if (!force && politicalTerritoryOptionsPromise) {
		return politicalTerritoryOptionsPromise;
	}

	politicalTerritoryOptionsLoading = true;
	politicalTerritoryOptionsPromise = (async () => {
		try {
			const response = await fetchWikiSyncTerritoryData({
				action: "territories_tree",
				force_refresh: force ? 1 : undefined,
			});
			const territories = Array.isArray(response.territories) ? response.territories : [];
			const hierarchy = Array.isArray(response.hierarchy) ? response.hierarchy : [];
			const hasIncomingTreeData = territories.length > 0 || hierarchy.length > 0;
			const hasExistingTreeData = politicalTerritoryOptions.length > 0 || politicalTerritoryHierarchy.length > 0;
			politicalTerritoryOptionsLoaded = true;
			if (hasIncomingTreeData || !hasExistingTreeData) {
				politicalTerritoryOptions = territories;
				politicalTerritoryHierarchy = hierarchy;
				politicalTerritoryOptionsSource = "wiki";
			} else {
				console.warn("Wiki-Herrschaftsgebiet-Baum lieferte keine Eintraege; bestehender Baum bleibt erhalten.");
			}
			return politicalTerritoryOptions;
		} catch (error) {
			console.warn("Wiki-Herrschaftsgebiet-Baum konnte nicht geladen werden:", error);
			politicalTerritoryOptionsLoaded = true;
			console.warn("Datenbank-Fallback fuer Herrschaftsgebiet-Baum deaktiviert, bestehende Wiki-Daten bleiben erhalten.");
			return politicalTerritoryOptions;
		} finally {
			politicalTerritoryOptionsLoading = false;
			politicalTerritoryOptionsPromise = null;
		}
	})();

	return politicalTerritoryOptionsPromise;
}

function preloadPoliticalTerritoryOptions() {
	if (!POLITICAL_TERRITORIES_API_URL) {
		return;
	}

	void loadPoliticalTerritoryOptions();
}

function createRegionLabelMarkup(regionEntry, fallbackName) {
	const labelText = normalizeRegionParentheticalSpacing(
		regionEntry.labelDisplayName
		|| regionEntry.displayName
		|| regionEntry.labelName
		|| regionEntry.shortName
		|| fallbackName
		|| regionEntry.name
		|| "Herrschaftsgebiet"
	);

	const name = escapeHtml(labelText);
	const coatUrl = regionEntry.labelCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "";
	const coatMarkup = coatUrl
		? `<img class="region-label__coat" src="${escapeHtml(coatUrl)}" alt="">`
		: "";

	return `<span class="region-label__content">${coatMarkup}<span>${name}</span></span>`;
}

function bindRegionCompactTooltip(polygon, regionEntry) {
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);

		if (!IS_EDIT_MODE) {
			openRegionCompactTooltip(regionEntry);
		}

		showPoliticalTerritoryTimelineSelection(regionEntry);
	});
}

function openRegionCompactTooltip(regionEntry) {
	closeRegionCompactTooltip();
	const tooltip = L.tooltip({
		direction: "top",
		offset: [0, -18],
		opacity: 1,
		className: "region-compact-tooltip",
		interactive: true,
	})
		.setLatLng(getRegionTooltipLatLng(regionEntry))
		.setContent(createRegionCompactTooltipMarkup(regionEntry));
	activeRegionInfoTooltip = tooltip;
	tooltip.addTo(map);
}

function closeRegionCompactTooltip() {
	if (activeRegionInfoTooltip) {
		map.removeLayer(activeRegionInfoTooltip);
		activeRegionInfoTooltip = null;
	}
}

function getRegionTooltipLatLng(regionEntry) {
	const bounds = getRegionEntryBounds(regionEntry);
	return regionEntry.label?.getLatLng?.() || bounds?.getCenter?.() || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter();
}

function createRegionCompactTooltipMarkup(regionEntry) {
	if (hasRegionWikiInfo(regionEntry)) {
		return createRegionWikiInfoBoxMarkup(regionEntry);
	}

	return createRegionMiniTooltipMarkup(regionEntry);
}

function createRegionMiniTooltipMarkup(regionEntry) {
	const coatMarkup = regionEntry.coatOfArmsUrl
		? `<img class="region-compact-tooltip__coat" src="${escapeHtml(regionEntry.coatOfArmsUrl)}" alt="">`
		: "";
	const meta = [normalizeRegionParentheticalSpacing(regionEntry.type), regionEntry.validLabel].filter(Boolean).join(" | ");
	const affiliation = regionEntry.affiliationRoot || regionEntry.affiliation || "";
	const capitalMarkup = createRegionPlaceTooltipLine("Hauptstadt", regionEntry.capitalName, regionEntry.capitalPlacePublicId);
	const seatMarkup = createRegionPlaceTooltipLine("Herrschaftssitz", regionEntry.seatName, regionEntry.seatPlacePublicId);
	const hasCoatClass = regionEntry.coatOfArmsUrl ? " has-coat" : "";

	return `
		<span class="region-compact-tooltip__content${hasCoatClass}">
			${coatMarkup}
			<span class="region-compact-tooltip__body">
				<span class="region-compact-tooltip__name">${escapeHtml(normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name))}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(meta || "Herrschaftsgebiet")}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(affiliation)}</span>
				${capitalMarkup}
				${seatMarkup}
			</span>
		</span>
	`;
}

function hasRegionWikiInfo(regionEntry) {
	return Boolean(
		regionEntry.wikiId
		|| regionEntry.wikiUrl
		|| regionEntry.wikiName
		|| regionEntry.wikiFoundedText
		|| regionEntry.wikiDissolvedText
		|| regionEntry.foundedText
		|| regionEntry.dissolvedText
	);
}

function createRegionWikiInfoBoxMarkup(regionEntry) {
	const name = normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name || "Herrschaftsgebiet");
	const wikiName = normalizeRegionParentheticalSpacing(regionEntry.wikiName || name);
	const type = normalizeRegionParentheticalSpacing(regionEntry.wikiType || regionEntry.type || "Herrschaftsgebiet");
	const coatMarkup = regionEntry.coatOfArmsUrl
		? `<img class="region-info-box__coat" src="${escapeHtml(regionEntry.coatOfArmsUrl)}" alt="">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";
	const wikiLink = createRegionInfoLink(regionEntry.wikiUrl);
	const affiliationPath = createRegionInfoPathValue(regionEntry);
	const wikiRows = [
		createRegionInfoTextRow("Wiki-Eintrag", wikiName),
		createRegionInfoTextRow("Typ", type),
		createRegionInfoTextRow("Status", regionEntry.status),
		createRegionInfoTextRow("Gründung", regionEntry.wikiFoundedText || regionEntry.foundedText),
		createRegionInfoTextRow("Auflösung", regionEntry.wikiDissolvedText || regionEntry.dissolvedText),
		createRegionInfoTextRow("Obergebiet", regionEntry.parentName || regionEntry.affiliationRoot || regionEntry.wikiAffiliationRoot),
		createRegionInfoBoxRow("Hauptstadt", createRegionInfoPlaceValue(regionEntry.wikiCapitalName || regionEntry.capitalName, regionEntry.capitalPlacePublicId)),
		createRegionInfoBoxRow("Herrschaftssitz", createRegionInfoPlaceValue(regionEntry.wikiSeatName || regionEntry.seatName, regionEntry.seatPlacePublicId)),
		createRegionInfoBoxRow("Wiki", wikiLink)
	].join("");
	const detailRows = [
		createRegionInfoTextRow("Kartenname", name),
		createRegionInfoTextRow("Kartenzeitraum", regionEntry.validLabel),
		createRegionInfoTextRow("Zuordnung", affiliationPath)
	].join("");
	const detailsMarkup = detailRows
		? `<details class="region-info-box__details"><summary>Details</summary><dl>${detailRows}</dl></details>`
		: "";

	return `
		<div class="region-info-box">
			<div class="region-info-box__header${hasCoatClass}">
				${coatMarkup}
				<div class="region-info-box__title-group">
					<strong class="region-info-box__title">${escapeHtml(name)}</strong>
					<span class="region-info-box__subtitle">Wiki-Daten</span>
				</div>
			</div>
			<dl class="region-info-box__data">${wikiRows}</dl>
			${detailsMarkup}
		</div>
	`;
}

function createRegionInfoTextRow(label, value) {
	const normalizedValue = normalizeRegionParentheticalSpacing(value).trim();
	if (normalizedValue === "") {
		return "";
	}

	return createRegionInfoBoxRow(label, escapeHtml(normalizedValue));
}

function createRegionInfoBoxRow(label, valueMarkup) {
	if (!valueMarkup) {
		return "";
	}

	return `
		<div class="region-info-box__row">
			<dt>${escapeHtml(label)}</dt>
			<dd>${valueMarkup}</dd>
		</div>
	`;
}

function createRegionInfoPlaceValue(placeName, placePublicId) {
	const normalizedName = normalizeRegionParentheticalSpacing(placeName).trim();
	if (normalizedName === "") {
		return "";
	}

	if (placePublicId) {
		return `<button type="button" class="region-compact-tooltip__place-link" data-region-place-public-id="${escapeHtml(placePublicId)}">${escapeHtml(normalizedName)}</button>`;
	}

	return escapeHtml(normalizedName);
}

function createRegionInfoLink(url) {
	const normalizedUrl = normalizeRegionInfoUrl(url);
	if (normalizedUrl === "") {
		return "";
	}

	return `<a class="region-info-box__link" href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer">Wiki öffnen</a>`;
}

function createRegionInfoPathValue(regionEntry) {
	const pathItems = normalizeRegionStringList(regionEntry.affiliationPath);
	if (pathItems.length > 0) {
		return pathItems.join(" > ");
	}

	return normalizeRegionParentheticalSpacing(regionEntry.wikiAffiliationRaw || regionEntry.affiliation || "").trim();
}

function normalizeRegionInfoUrl(value) {
	const url = String(value || "").trim();
	return /^https?:\/\//iu.test(url) ? url : "";
}

function normalizeRegionStringList(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeRegionParentheticalSpacing(entry).trim()).filter(Boolean);
	}

	const rawValue = String(value || "").trim();
	if (rawValue === "") {
		return [];
	}

	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		try {
			const parsedValue = JSON.parse(rawValue);
			return Array.isArray(parsedValue)
				? parsedValue.map((entry) => normalizeRegionParentheticalSpacing(entry).trim()).filter(Boolean)
				: [];
		} catch {
			return [];
		}
	}

	return [normalizeRegionParentheticalSpacing(rawValue).trim()].filter(Boolean);
}

function createRegionPlaceTooltipLine(label, placeName, placePublicId) {
	const normalizedName = String(placeName || "").trim();
	if (normalizedName === "") {
		return "";
	}

	const valueMarkup = placePublicId
		? `<button type="button" class="region-compact-tooltip__place-link" data-region-place-public-id="${escapeHtml(placePublicId)}">${escapeHtml(normalizedName)}</button>`
		: `<span>${escapeHtml(normalizedName)}</span>`;
	return `<span class="region-compact-tooltip__meta">${escapeHtml(label)}: ${valueMarkup}</span>`;
}

function normalizeRegionParentheticalSpacing(value) {
	return String(value || "").replace(/([^\s])\(/gu, "$1 (");
}

function getRegionLayerGeometryPublicId(layer) {
	return String(layer?._regionEntry?.geometryPublicId || layer?._regionEntry?.publicId || "").trim();
}

function isLatLngInsideRegionRing(latlng, ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return false;
	}

	const testLat = Number(latlng?.lat);
	const testLng = Number(latlng?.lng);
	if (!Number.isFinite(testLat) || !Number.isFinite(testLng)) {
		return false;
	}

	let inside = false;
	for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
		const currentPoint = ring[index];
		const previousPoint = ring[previousIndex];
		const currentLat = Number(currentPoint?.lat);
		const currentLng = Number(currentPoint?.lng);
		const previousLat = Number(previousPoint?.lat);
		const previousLng = Number(previousPoint?.lng);

		if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng) || !Number.isFinite(previousLat) || !Number.isFinite(previousLng)) {
			continue;
		}

		const intersects = ((currentLat > testLat) !== (previousLat > testLat))
			&& (testLng < ((previousLng - currentLng) * (testLat - currentLat) / ((previousLat - currentLat) || Number.EPSILON)) + currentLng);
		if (intersects) {
			inside = !inside;
		}
	}

	return inside;
}

function isLatLngInsideRegionLayer(layer, latlng) {
	if (!layer || !latlng) {
		return false;
	}

	const normalizedLatLng = L.latLng(latlng);
	if (!layer.getBounds?.().contains?.(normalizedLatLng)) {
		return false;
	}

	const layerPoint = map.latLngToLayerPoint(normalizedLatLng);
	if (typeof layer._containsPoint === "function" && layer._map) {
		return layer._containsPoint(layerPoint);
	}

	const rings = layer.getLatLngs?.();
	if (!Array.isArray(rings) || rings.length < 1 || !Array.isArray(rings[0])) {
		return false;
	}

	if (!isLatLngInsideRegionRing(normalizedLatLng, rings[0])) {
		return false;
	}

	for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
		if (isLatLngInsideRegionRing(normalizedLatLng, rings[ringIndex])) {
			return false;
		}
	}

	return true;
}

function getOverlappingPoliticalRegionLayersAtLatLng(latlng, preferredLayer = null) {
	const normalizedLatLng = L.latLng(latlng);
	const candidates = [];

	regionPolygons.forEach((layer) => {
		const candidateRegion = layer?._regionEntry;
		if (!candidateRegion || candidateRegion.source !== "political_territory") {
			return;
		}

		if (isLatLngInsideRegionLayer(layer, normalizedLatLng)) {
			candidates.push(layer);
		}
	});

	if (candidates.length < 2) {
		return candidates;
	}

	const uniqueCandidates = [];
	const seenLayerIds = new Set();
	candidates.forEach((layer) => {
		const layerId = L.stamp(layer);
		if (seenLayerIds.has(layerId)) {
			return;
		}
		seenLayerIds.add(layerId);
		uniqueCandidates.push(layer);
	});

	const hasPreferredLayer = preferredLayer && uniqueCandidates.includes(preferredLayer);
	const orderedCandidates = hasPreferredLayer
		? [preferredLayer, ...uniqueCandidates.filter((layer) => layer !== preferredLayer)]
		: [...uniqueCandidates];

	const headLayer = orderedCandidates[0] || null;
	const tailLayers = orderedCandidates.slice(1).sort((leftLayer, rightLayer) => {
		const leftGeometry = getRegionLayerGeometryPublicId(leftLayer) || `layer:${L.stamp(leftLayer)}`;
		const rightGeometry = getRegionLayerGeometryPublicId(rightLayer) || `layer:${L.stamp(rightLayer)}`;
		return leftGeometry.localeCompare(rightGeometry, "de");
	});

	return headLayer ? [headLayer, ...tailLayers] : tailLayers;
}

function resolveOverlappingRegionLayerSelection(latlng, fallbackLayer = null) {
	const normalizedLatLng = L.latLng(latlng);
	const candidateLayers = getOverlappingPoliticalRegionLayersAtLatLng(normalizedLatLng, fallbackLayer);
	const fallbackResultLayer = fallbackLayer || candidateLayers[0] || null;

	if (candidateLayers.length < 2) {
		recentRegionOverlapSelection = null;
		return {
			layer: fallbackResultLayer,
			total: Math.max(candidateLayers.length, fallbackResultLayer ? 1 : 0),
			index: 0,
		};
	}

	const signature = candidateLayers
		.map((layer) => getRegionLayerGeometryPublicId(layer) || `layer:${L.stamp(layer)}`)
		.join("|");
	let nextIndex = 0;
	const now = Date.now();
	if (recentRegionOverlapSelection && recentRegionOverlapSelection.signature === signature && now - recentRegionOverlapSelection.timestamp <= REGION_OVERLAP_SELECTION_TIMEOUT_MS) {
		const previousPoint = map.latLngToContainerPoint(recentRegionOverlapSelection.latlng);
		const currentPoint = map.latLngToContainerPoint(normalizedLatLng);
		if (previousPoint.distanceTo(currentPoint) <= REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE) {
			nextIndex = (recentRegionOverlapSelection.index + 1) % candidateLayers.length;
		}
	}

	recentRegionOverlapSelection = {
		signature,
		index: nextIndex,
		latlng: normalizedLatLng,
		timestamp: now,
	};

	return {
		layer: candidateLayers[nextIndex] || fallbackResultLayer,
		total: candidateLayers.length,
		index: nextIndex,
	};
}

function announceOverlappingRegionSelection(selection) {
	if (!selection || selection.total < 2 || typeof showFeedbackToast !== "function") {
		return;
	}

	const selectedRegion = selection.layer?._regionEntry || {};
	const geometryLabelParts = [];
	if (selectedRegion.geometryId !== null && selectedRegion.geometryId !== undefined) {
		geometryLabelParts.push(`#${selectedRegion.geometryId}`);
	}
	if (selectedRegion.geometryPublicId) {
		geometryLabelParts.push(selectedRegion.geometryPublicId);
	}

	const geometrySuffix = geometryLabelParts.length > 0 ? ` (${geometryLabelParts.join(" / ")})` : "";
	showFeedbackToast(`Ueberlagerte Geometrien: ${selection.index + 1}/${selection.total}${geometrySuffix}`, "info");
}

$(document).on("click", "[data-region-place-public-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	focusRegionPlace(this.dataset.regionPlacePublicId || "");
});

function focusRegionPlace(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (!markerEntry) {
		showFeedbackToast("Der verknuepfte Ort ist aktuell nicht geladen.", "warning");
		return;
	}

	map.flyTo(markerEntry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.8 });
	markerEntry.marker.openPopup();
}

function bindRegionPolygonEditEvents(polygon, regionEntry) {
	if (!IS_EDIT_MODE) return;
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);
		if (pendingRegionOperation?.operation === "split") {
			void handlePendingRegionSplitClick(event);
			return;
		}
		if (pendingRegionOperation?.operation === "move") {
			handlePendingRegionMoveClick(event);
			return;
		}
		if (pendingRegionOperation) {
			void completePendingRegionOperation(regionEntry, polygon);
			return;
		}
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("dblclick", (event) => {
		if (event.originalEvent?.target?.closest?.(".region-edit-handle-marker")) return;
		if (activeRegionGeometryEdit?.regionEntry === regionEntry && activeRegionGeometryEdit.editLayer === polygon) {
			handleEditableRegionDoubleClick(regionEntry, event, polygon);
			return;
		}
		L.DomEvent.stop(event);
		startRegionGeometryEdit(regionEntry, polygon);
	});
	polygon.on("contextmenu", (event) => {
		L.DomEvent.stop(event);
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		openRegionContextMenu(
			selectedRegionEntry,
			selectedLayer,
			event.latlng,
			event.originalEvent?.clientX ?? 0,
			event.originalEvent?.clientY ?? 0
		);
	});
	polygon.on("mouseover", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		setPendingRegionTargetHighlight(regionEntry);
	});
	polygon.on("mouseout", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		clearPendingRegionTargetHighlight();
	});
}

function getRegionContextMenuElement() {
	return document.getElementById("region-context-menu");
}

function openRegionContextMenu(regionEntry, regionLayer, latlng, clientX, clientY) {
	activeRegionContextEntry = regionEntry;
	activeRegionContextLayer = regionLayer || regionEntry.layer || null;
	activeRegionContextPolygonIndex = Number.isInteger(regionLayer?._regionPolygonIndex) ? regionLayer._regionPolygonIndex : null;
	pendingContextMenuLatLng = L.latLng(latlng);
	closeMapContextMenu();
	const menuElement = getRegionContextMenuElement();
	if (!menuElement) {
		return;
	}

	const extractActionElement = menuElement.querySelector('[data-region-context-action="extract"]');
	if (extractActionElement) {
		const layerCount = getRegionEntryLayers(regionEntry).length;
		extractActionElement.hidden = !(regionEntry?.source === "political_territory" && layerCount > 1 && regionLayer);
	}

	menuElement.hidden = false;
	positionContextMenuElement(menuElement, clientX, clientY);
}

function closeRegionContextMenu() {
	const menuElement = getRegionContextMenuElement();
	if (menuElement) {
		menuElement.hidden = true;
	}
	activeRegionContextEntry = null;
	activeRegionContextLayer = null;
	activeRegionContextPolygonIndex = null;
}

function positionContextMenuElement(menuElement, clientX, clientY) {
	const viewportPadding = 8;
	menuElement.style.left = "0px";
	menuElement.style.top = "0px";
	const width = menuElement.offsetWidth;
	const height = menuElement.offsetHeight;
	const left = Math.max(viewportPadding, Math.min(clientX + MAP_CONTEXT_MENU_OFFSET_X, window.innerWidth - width - viewportPadding));
	const top = Math.max(viewportPadding, Math.min(clientY + MAP_CONTEXT_MENU_OFFSET_Y, window.innerHeight - height - viewportPadding));
	menuElement.style.left = `${left}px`;
	menuElement.style.top = `${top}px`;
}

$(document).on("click", "[data-region-context-action]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const action = this.dataset.regionContextAction || "";
	const regionEntry = activeRegionContextEntry;
	const regionLayer = activeRegionContextLayer || regionEntry?.layer || null;
	const polygonIndex = activeRegionContextPolygonIndex;
	closeRegionContextMenu();
	if (!regionEntry) {
		return;
	}

	if (action === "edit-geometry") {
		startRegionGeometryEdit(regionEntry, regionLayer);
		return;
	}
	if (action === "edit-properties") {
		clearRegionGeometryEdit();

		if (window.AvesmapsPoliticalTerritoryEditorLink) {
			window.AvesmapsPoliticalTerritoryEditorLink.open(regionEntry);
			return;
		}

		openRegionEditDialog(regionEntry, { title: "Eigenschaften bearbeiten" });
		return;
	}
	if (action === "show-info") {
		openRegionCompactTooltip(regionEntry);
		showPoliticalTerritoryTimelineSelection(regionEntry);
		return;
	}
	if (action === "move") {
		startPendingRegionMove(regionEntry, pendingContextMenuLatLng || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter());
		return;
	}
	if (action === "split") {
		startPendingRegionSplit(regionEntry, regionLayer);
		return;
	}
	if (["union", "difference", "difference-keep-target", "intersection"].includes(action)) {
		startPendingRegionOperation(action, regionEntry, regionLayer);
		return;
	}
	if (action === "extract") {
		void extractRegionGeometryPartAsNewTerritory(regionEntry, regionLayer);
		return;
	}
	if (action === "delete") {
		regionEditEntry = regionEntry;
		void deleteActiveRegion(regionLayer, polygonIndex);
	}
});

async function extractRegionGeometryPartAsNewTerritory(regionEntry, selectedLayer) {
	if (!regionEntry || regionEntry.source !== "political_territory") {
		showFeedbackToast("Herausloesen ist nur fuer das neue Herrschaftsgebiete-Modell verfuegbar.", "warning");
		return;
	}

	const layers = getRegionEntryLayers(regionEntry);
	if (!selectedLayer || !layers.includes(selectedLayer) || layers.length < 2) {
		showFeedbackToast("Zum Herausloesen muss ein Teilpolygon eines Mehrfach-Gebiets ausgewaehlt sein.", "warning");
		return;
	}

	const extractedGeometry = regionLayersToGeoJsonGeometry([selectedLayer], regionEntry);
	const extractedName = `${regionEntry.name || "Herrschaftsgebiet"} (Teilgebiet)`;

	try {
		await submitPoliticalTerritoryEdit({
			action: "create_territory",
			name: extractedName,
			short_name: "",
			type: regionEntry.type || "Herrschaftsgebiet",
			color: regionEntry.color || "#888888",
			opacity: Number.isFinite(Number(regionEntry.opacity)) ? Number(regionEntry.opacity) : 0.33,
			valid_to_open: true,
			is_active: true,
			geometry_geojson: extractedGeometry,
			style_json: {
				fill: regionEntry.color || "#888888",
				stroke: regionEntry.color || "#888888",
				fillOpacity: Number.isFinite(Number(regionEntry.opacity)) ? Number(regionEntry.opacity) : 0.33,
			},
		});

		await deleteRegionGeometryPart(regionEntry, selectedLayer);
		void loadPoliticalTerritoryOptions({ force: true });
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		showFeedbackToast("Teilpolygon als neues Herrschaftsgebiet herausgeloest.", "success");
	} catch (error) {
		console.error("Teilpolygon konnte nicht herausgeloest werden:", error);
		showFeedbackToast(error.message || "Teilpolygon konnte nicht herausgeloest werden.", "warning");
	}
}

function startPendingRegionOperation(operation, sourceRegion, sourceLayer = null) {
	if (sourceRegion.source !== "political_territory") {
		showFeedbackToast("Geometrieoperationen sind fuer das neue Herrschaftsgebiete-Modell aktiv.", "warning");
		return;
	}

	cancelPendingRegionOperation();
	pendingRegionOperation = { operation, sourceRegion, sourceLayer: sourceLayer || sourceRegion.layer || null };
	clearRegionGeometryEdit();
	syncRegionOperationChip();
	showFeedbackToast("Naechstes Herrschaftsgebiet anklicken.", "info");
}

function startPendingRegionSplit(sourceRegion, sourceLayer = null) {
	if (sourceRegion.source !== "political_territory") {
		showFeedbackToast("Gebiete zerschneiden ist fuer das neue Herrschaftsgebiete-Modell aktiv.", "warning");
		return;
	}

	cancelPendingRegionOperation();
	pendingRegionOperation = { operation: "split", sourceRegion, sourceLayer: sourceLayer || sourceRegion.layer || null, points: [] };
	clearRegionGeometryEdit();
	map.on("click", handlePendingRegionSplitClick);
	syncRegionOperationChip();
	showFeedbackToast("Ersten Schnittpunkt setzen.", "info");
}

function startPendingRegionMove(sourceRegion, anchorLatLng) {
	if (sourceRegion.source !== "political_territory") {
		showFeedbackToast("Verschieben ist fuer das neue Herrschaftsgebiete-Modell aktiv.", "warning");
		return;
	}

	cancelPendingRegionOperation();
	const layers = getRegionEntryLayers(sourceRegion);
	if (layers.length < 1) {
		showFeedbackToast("Das Herrschaftsgebiet hat keine verschiebbare Geometrie.", "warning");
		return;
	}

	pendingRegionOperation = { operation: "move", sourceRegion };
	pendingRegionMoveState = {
		regionEntry: sourceRegion,
		anchorLatLng: L.latLng(anchorLatLng),
		originalLayerLatLngs: layers.map((layer) => ({
			layer,
			latLngs: cloneNestedLatLngs(layer.getLatLngs()),
		})),
	};
	clearRegionGeometryEdit();
	map.on("mousemove", handlePendingRegionMoveMouseMove);
	map.on("click", handlePendingRegionMoveClick);
	syncRegionOperationChip();
	showFeedbackToast("Gebiet verschieben. Klick speichert, ESC bricht ab.", "info");
}

function cancelPendingRegionOperation() {
	map.off("click", handlePendingRegionSplitClick);
	cancelPendingRegionMove({ restore: true, silent: true });
	clearPendingRegionSplitPreview();
	clearPendingRegionTargetHighlight();
	pendingRegionOperation = null;
	syncRegionOperationChip();
}

function syncRegionOperationChip() {
	const chipElement = document.getElementById("region-operation-chip");
	const textElement = document.getElementById("region-operation-chip-text");
	if (!chipElement || !textElement) {
		return;
	}

	if (!pendingRegionOperation) {
		chipElement.hidden = true;
		textElement.textContent = "";
		return;
	}

	const labels = {
		move: "Gebiet verschieben",
		split: "Gebiet zerschneiden",
		union: "Mit anderem vereinigen",
		difference: "Von anderem ausschneiden",
		"difference-keep-target": "Von anderem ausschneiden und anderes beibehalten",
		intersection: "Neues von anderem ausschneiden",
	};
	const instruction = pendingRegionOperation.operation === "split"
		? (pendingRegionOperation.points?.length === 1 ? "zweiten Schnittpunkt setzen." : "ersten Schnittpunkt setzen.")
		: pendingRegionOperation.operation === "move"
			? "Maus bewegen, Klick speichert."
			: "Zielgebiet anklicken.";
	textElement.textContent = `${labels[pendingRegionOperation.operation] || "Operation"}: ${instruction}`;
	chipElement.hidden = false;
}

function handlePendingRegionMoveMouseMove(event) {
	if (!pendingRegionMoveState) {
		return;
	}

	const targetLatLng = L.latLng(event.latlng);
	const delta = {
		lat: targetLatLng.lat - pendingRegionMoveState.anchorLatLng.lat,
		lng: targetLatLng.lng - pendingRegionMoveState.anchorLatLng.lng,
	};
	applyPendingRegionMoveDelta(delta);
}

function handlePendingRegionMoveClick(event) {
	if (!pendingRegionMoveState) {
		return;
	}

	L.DomEvent.stop(event);
	void completePendingRegionMove();
}

function applyPendingRegionMoveDelta(delta) {
	pendingRegionMoveState.originalLayerLatLngs.forEach((entry) => {
		entry.layer.setLatLngs(offsetNestedLatLngs(entry.latLngs, delta));
	});
	updateRegionLabelPosition(pendingRegionMoveState.regionEntry);
}

async function completePendingRegionMove() {
	const moveState = pendingRegionMoveState;
	if (!moveState) {
		return;
	}

	map.off("mousemove", handlePendingRegionMoveMouseMove);
	map.off("click", handlePendingRegionMoveClick);
	pendingRegionMoveState = null;
	pendingRegionOperation = null;
	syncRegionOperationChip();
	try {
		await saveRegionGeometry(moveState.regionEntry);
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		showFeedbackToast("Gebiet verschoben.", "success");
	} catch (error) {
		console.error("Gebiet konnte nicht verschoben werden:", error);
		showFeedbackToast(error.message || "Gebiet konnte nicht verschoben werden.", "warning");
	}
}

function cancelPendingRegionMove({ restore = false, silent = false } = {}) {
	if (!pendingRegionMoveState) {
		return;
	}

	const moveState = pendingRegionMoveState;
	map.off("mousemove", handlePendingRegionMoveMouseMove);
	map.off("click", handlePendingRegionMoveClick);
	if (restore) {
		moveState.originalLayerLatLngs.forEach((entry) => {
			entry.layer.setLatLngs(cloneNestedLatLngs(entry.latLngs));
		});
		updateRegionLabelPosition(moveState.regionEntry);
	}
	pendingRegionMoveState = null;
	if (!silent) {
		showFeedbackToast("Verschieben abgebrochen.", "info");
	}
}

function cloneNestedLatLngs(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => cloneNestedLatLngs(entry));
	}

	return L.latLng(value);
}

function offsetNestedLatLngs(value, delta) {
	if (Array.isArray(value)) {
		return value.map((entry) => offsetNestedLatLngs(entry, delta));
	}

	const latLng = L.latLng(value);
	return L.latLng(latLng.lat + delta.lat, latLng.lng + delta.lng);
}

function getRegionEntryLayers(regionEntry) {
	return (regionEntry?.layers?.length ? regionEntry.layers : [regionEntry?.layer]).filter(Boolean);
}

function setPendingRegionTargetHighlight(regionEntry) {
	if (!pendingRegionOperation || regionEntry === pendingRegionOperation.sourceRegion) {
		clearPendingRegionTargetHighlight();
		return;
	}

	const layers = getRegionEntryLayers(regionEntry);
	if (pendingRegionTargetHighlightLayers.length === layers.length && layers.every((layer, index) => layer === pendingRegionTargetHighlightLayers[index]?.layer)) {
		return;
	}

	clearPendingRegionTargetHighlight();
	pendingRegionTargetHighlightLayers = layers.map((layer) => ({ layer, regionEntry }));
	pendingRegionTargetHighlightLayers.forEach(({ layer }) => {
		layer.setStyle({
			color: "#fff4a3",
			opacity: 1,
			weight: 5,
		});
		layer.bringToFront?.();
	});
}

function clearPendingRegionTargetHighlight() {
	if (!pendingRegionTargetHighlightLayers.length) {
		return;
	}

	pendingRegionTargetHighlightLayers.forEach(({ layer, regionEntry }) => {
		layer.setStyle({
			color: regionEntry.color,
			fillColor: regionEntry.color,
			fillOpacity: regionEntry.opacity,
			opacity: 1,
			weight: 2,
		});
	});
	pendingRegionTargetHighlightLayers = [];
}

async function handlePendingRegionSplitClick(event) {
	const operationState = pendingRegionOperation;
	if (operationState?.operation !== "split") {
		return;
	}

	L.DomEvent.stop(event);
	const nextPoint = L.latLng(event.latlng);
	operationState.points.push(nextPoint);
	updatePendingRegionSplitPreview(operationState.points);
	syncRegionOperationChip();

	if (operationState.points.length < 2) {
		showFeedbackToast("Zweiten Schnittpunkt setzen.", "info");
		return;
	}

	await completePendingRegionSplit(operationState);
}

async function completePendingRegionSplit(operationState) {
	if (!window.polygonClipping) {
		showFeedbackToast("Polygon-Clipping-Bibliothek ist nicht geladen.", "warning");
		cancelPendingRegionOperation();
		return;
	}

	try {
		const sourceGeometry = regionEntryToClippingMultiPolygon(operationState.sourceRegion, {
			onlyLayer: operationState.sourceLayer,
		});
		const remainingGeometry = regionEntryToClippingMultiPolygon(operationState.sourceRegion, {
			excludeLayers: [operationState.sourceLayer].filter(Boolean),
		});
		const cutterGeometry = buildRegionSplitCutterGeometry(operationState.sourceRegion, operationState.points[0], operationState.points[1], operationState.sourceLayer);
		const splitGeometry = window.polygonClipping.difference(sourceGeometry, cutterGeometry);
		if (splitGeometry.length <= sourceGeometry.length) {
			showFeedbackToast("Die Schnittlinie trennt das Gebiet nicht vollstaendig.", "warning");
			cancelPendingRegionOperation();
			return;
		}

		const sortedPolygons = splitGeometry
			.map((polygon) => ({ polygon, area: calculateClippingPolygonArea(polygon) }))
			.sort((left, right) => right.area - left.area)
			.map((entry) => entry.polygon);
		const sourcePart = [...remainingGeometry, sortedPolygons[0]];
		const splitPart = sortedPolygons.slice(1);
		await submitPoliticalTerritoryEdit({
			action: "split_geometry",
			public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
			geometry_public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
			source: "editor-split",
			geometry_geojson: clippingMultiPolygonToGeoJson(sourcePart),
			split_geometry_geojson: clippingMultiPolygonToGeoJson(splitPart),
			style_json: {
				fill: operationState.sourceRegion.color,
				stroke: operationState.sourceRegion.color,
				fillOpacity: operationState.sourceRegion.opacity,
			},
		});

		cancelPendingRegionOperation();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		showFeedbackToast("Gebiet zerschnitten.", "success");
	} catch (error) {
		console.error("Gebiet konnte nicht zerschnitten werden:", error);
		cancelPendingRegionOperation();
		showFeedbackToast(error.message || "Gebiet konnte nicht zerschnitten werden.", "warning");
	}
}

function updatePendingRegionSplitPreview(points) {
	clearPendingRegionSplitPreview();
	const validPoints = points.map((point) => L.latLng(point)).filter(Boolean);
	if (validPoints.length < 1) {
		return;
	}

	const previewGroup = L.layerGroup().addTo(map);
	L.circleMarker(validPoints[0], {
		pane: "measurementHandlesPane",
		radius: 5,
		color: "#385d72",
		fillColor: "#fff",
		fillOpacity: 1,
		weight: 2,
		interactive: false,
	}).addTo(previewGroup);
	if (validPoints.length > 1) {
		L.polyline(validPoints.slice(0, 2), {
			pane: "measurementPane",
			color: "#385d72",
			weight: 2,
			dashArray: "6 4",
			interactive: false,
		}).addTo(previewGroup);
	}
	pendingRegionSplitPreviewLayer = previewGroup;
}

function clearPendingRegionSplitPreview() {
	if (pendingRegionSplitPreviewLayer) {
		map.removeLayer(pendingRegionSplitPreviewLayer);
		pendingRegionSplitPreviewLayer = null;
	}
}

function buildRegionSplitCutterGeometry(regionEntry, startLatLng, endLatLng, sourceLayer = null) {
	const start = { x: startLatLng.lng, y: startLatLng.lat };
	const end = { x: endLatLng.lng, y: endLatLng.lat };
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lineLength = Math.hypot(dx, dy);
	if (lineLength <= 0) {
		throw new Error("Die Schnittlinie braucht zwei verschiedene Punkte.");
	}

	const bounds = sourceLayer?.getBounds?.() || getRegionEntryBounds(regionEntry);
	const boundsWidth = Math.abs((bounds?.getEast?.() ?? end.x) - (bounds?.getWest?.() ?? start.x));
	const boundsHeight = Math.abs((bounds?.getNorth?.() ?? end.y) - (bounds?.getSouth?.() ?? start.y));
	const boundsDiagonal = Math.max(Math.hypot(boundsWidth, boundsHeight), lineLength);
	const extension = boundsDiagonal * 2;
	const halfWidth = Math.max(boundsDiagonal * 0.0002, 0.25);
	const unitX = dx / lineLength;
	const unitY = dy / lineLength;
	const normalX = -unitY * halfWidth;
	const normalY = unitX * halfWidth;
	const extendedStart = {
		x: start.x - unitX * extension,
		y: start.y - unitY * extension,
	};
	const extendedEnd = {
		x: end.x + unitX * extension,
		y: end.y + unitY * extension,
	};
	const ring = [
		[extendedStart.x + normalX, extendedStart.y + normalY],
		[extendedEnd.x + normalX, extendedEnd.y + normalY],
		[extendedEnd.x - normalX, extendedEnd.y - normalY],
		[extendedStart.x - normalX, extendedStart.y - normalY],
		[extendedStart.x + normalX, extendedStart.y + normalY],
	];

	return [[ring]];
}

function calculateClippingPolygonArea(polygon) {
	return Math.abs((polygon || []).reduce((totalArea, ring, index) => {
		const ringArea = calculateClippingRingArea(ring);
		return index === 0 ? totalArea + ringArea : totalArea - ringArea;
	}, 0));
}

function calculateClippingRingArea(ring) {
	let area = 0;
	for (let index = 0; index < ring.length - 1; index++) {
		const current = ring[index];
		const next = ring[index + 1];
		area += current[0] * next[1] - next[0] * current[1];
	}

	return Math.abs(area / 2);
}

async function completePendingRegionOperation(targetRegion, targetLayer = null) {
	const operationState = pendingRegionOperation;
	if (!operationState) {
		return;
	}
	clearPendingRegionTargetHighlight();

	const sourceLayer = operationState.sourceLayer || operationState.sourceRegion.layer || null;
	const normalizedTargetLayer = targetLayer || targetRegion.layer || null;
	const sourceGeometryPublicId = operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId || "";
	const targetGeometryPublicId = targetRegion.geometryPublicId || targetRegion.publicId || "";
	const isSameGeometry = sourceGeometryPublicId !== "" && sourceGeometryPublicId === targetGeometryPublicId;
	const isSameLayer = sourceLayer && normalizedTargetLayer && sourceLayer === normalizedTargetLayer;
	if (isSameGeometry && isSameLayer) {
		showFeedbackToast("Bitte eine andere Flaeche waehlen.", "warning");
		return;
	}

	if (!window.polygonClipping) {
		showFeedbackToast("Polygon-Clipping-Bibliothek ist nicht geladen.", "warning");
		cancelPendingRegionOperation();
		return;
	}

	if (targetRegion.source !== "political_territory") {
		showFeedbackToast("Das Ziel muss ein Herrschaftsgebiet aus dem neuen Modell sein.", "warning");
		return;
	}

	try {
		const targetIsConsumed = shouldRegionBooleanOperationConsumeTarget(operationState.operation);
		const sourceExclusions = [sourceLayer].filter(Boolean);
		if (isSameGeometry && normalizedTargetLayer && (operationState.operation === "union" || targetIsConsumed)) {
			sourceExclusions.push(normalizedTargetLayer);
		}
		const sourceGeometry = regionEntryToClippingMultiPolygon(operationState.sourceRegion, {
			onlyLayer: sourceLayer,
		});
		const targetGeometry = regionEntryToClippingMultiPolygon(targetRegion, {
			onlyLayer: normalizedTargetLayer,
		});
		const remainingSourceGeometry = sourceLayer
			? regionEntryToClippingMultiPolygon(operationState.sourceRegion, { excludeLayers: sourceExclusions })
			: [];
		const clippedGeometry = calculateRegionBooleanGeometry(operationState.operation, sourceGeometry, targetGeometry);
		if (!clippedGeometry.length) {
			showFeedbackToast("Die Operation ergibt keine Flaeche.", "warning");
			cancelPendingRegionOperation();
			return;
		}

		const operationGeometryGeoJson = clippingMultiPolygonToGeoJson(clippedGeometry);
		const geometryGeoJson = clippingMultiPolygonToGeoJson([...remainingSourceGeometry, ...clippedGeometry]);
		if (operationState.operation === "intersection") {
			await submitPoliticalTerritoryEdit({
				action: "geometry_operation",
				operation: "intersection",
				create_territory: true,
				name: `Schnittmenge ${operationState.sourceRegion.name} / ${targetRegion.name}`,
				type: operationState.sourceRegion.type || "Herrschaftsgebiet",
				color: operationState.sourceRegion.color,
				opacity: operationState.sourceRegion.opacity,
				valid_to_open: true,
				is_active: true,
				geometry_geojson: operationGeometryGeoJson,
			});
		} else {
			const remainingTargetGeometry = targetIsConsumed && !isSameGeometry && normalizedTargetLayer
				? regionEntryToClippingMultiPolygon(targetRegion, { excludeLayers: [normalizedTargetLayer] })
				: [];
			const deleteTargetGeometry = targetIsConsumed && !isSameGeometry && remainingTargetGeometry.length < 1;
			const payload = {
				action: "geometry_operation",
				operation: getStoredRegionBooleanOperation(operationState.operation),
				public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
				geometry_public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
				delete_geometry_public_id: deleteTargetGeometry ? targetRegion.geometryPublicId || targetRegion.publicId : "",
				source: "editor",
				geometry_geojson: geometryGeoJson,
				style_json: {
					fill: operationState.sourceRegion.color,
					stroke: operationState.sourceRegion.color,
					fillOpacity: operationState.sourceRegion.opacity,
				},
			};
			if (!deleteTargetGeometry && remainingTargetGeometry.length > 0) {
				payload.target_geometry_geojson = clippingMultiPolygonToGeoJson(remainingTargetGeometry);
			}
			await submitPoliticalTerritoryEdit(payload);
		}

		cancelPendingRegionOperation();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		showFeedbackToast("Geometrieoperation gespeichert.", "success");
	} catch (error) {
		console.error("Geometrieoperation fehlgeschlagen:", error);
		cancelPendingRegionOperation();
		showFeedbackToast(error.message || "Geometrieoperation fehlgeschlagen.", "warning");
	}
}

function calculateRegionBooleanGeometry(operation, sourceGeometry, targetGeometry) {
	const normalizedSourceGeometry = normalizeClippingMultiPolygon(sourceGeometry, "Quellgeometrie");
	const normalizedTargetGeometry = normalizeClippingMultiPolygon(targetGeometry, "Zielgeometrie");
	if (normalizedSourceGeometry.length < 1) {
		throw new Error("Die Quellgeometrie enthaelt keine gueltige Flaeche.");
	}
	if (normalizedTargetGeometry.length < 1) {
		throw new Error("Die Zielgeometrie enthaelt keine gueltige Flaeche.");
	}

	let resultGeometry = null;
	if (operation === "union") {
		resultGeometry = window.polygonClipping.union(normalizedSourceGeometry, normalizedTargetGeometry);
	} else if (operation === "difference" || operation === "difference-keep-target") {
		resultGeometry = window.polygonClipping.difference(normalizedSourceGeometry, normalizedTargetGeometry);
	} else if (operation === "intersection") {
		resultGeometry = window.polygonClipping.intersection(normalizedSourceGeometry, normalizedTargetGeometry);
	} else {
		throw new Error("Unbekannte Geometrieoperation.");
	}

	const normalizedResult = normalizeClippingMultiPolygon(resultGeometry, "Ergebnisgeometrie");
	validateRegionBooleanResult(operation, normalizedSourceGeometry, normalizedTargetGeometry, normalizedResult);
	void debugRegionBooleanOperation(operation, normalizedSourceGeometry, normalizedTargetGeometry, normalizedResult);

	return normalizedResult;
}

function shouldRegionBooleanOperationConsumeTarget(operation) {
	return operation === "union" || operation === "difference";
}

function getStoredRegionBooleanOperation(operation) {
	return operation === "difference-keep-target" ? "difference" : operation;
}

function regionEntryToClippingMultiPolygon(regionEntry, { onlyLayer = null, excludeLayers = [] } = {}) {
	const excludedLayers = new Set(excludeLayers.filter(Boolean));
	const layers = onlyLayer
		? [onlyLayer]
		: getRegionEntryLayers(regionEntry).filter((layer) => !excludedLayers.has(layer));
	const geometries = layers
		.filter(Boolean)
		.map((layer) => layer.toGeoJSON?.().geometry)
		.filter((geometry) => geometry && ["Polygon", "MultiPolygon"].includes(geometry.type));
	const polygons = [];
	geometries.forEach((geometry) => {
		if (geometry.type === "Polygon") {
			polygons.push(geometry.coordinates);
			return;
		}

		geometry.coordinates.forEach((polygon) => polygons.push(polygon));
	});

	return normalizeClippingMultiPolygon(polygons, "Karten-Geometrie");
}

function clippingMultiPolygonToGeoJson(multiPolygon) {
	const normalizedMultiPolygon = normalizeClippingMultiPolygon(multiPolygon, "GeoJSON-Ausgabe");
	if (!Array.isArray(normalizedMultiPolygon) || normalizedMultiPolygon.length < 1) {
		throw new Error("Die Ergebnisgeometrie ist leer.");
	}

	return normalizedMultiPolygon.length === 1
		? { type: "Polygon", coordinates: normalizedMultiPolygon[0] }
		: { type: "MultiPolygon", coordinates: normalizedMultiPolygon };
}

function normalizeClippingMultiPolygon(multiPolygon, label = "Geometrie") {
	if (!Array.isArray(multiPolygon)) {
		throw new Error(`${label} ist kein MultiPolygon.`);
	}

	const normalizedPolygons = [];
	multiPolygon.forEach((polygon) => {
		const normalizedPolygon = normalizeClippingPolygon(polygon);
		if (normalizedPolygon) {
			normalizedPolygons.push(normalizedPolygon);
		}
	});

	if (normalizedPolygons.length < 1) {
		return [];
	}

	return normalizedPolygons;
}

function normalizeClippingPolygon(polygon) {
	if (!Array.isArray(polygon) || polygon.length < 1) {
		return null;
	}

	const outerRing = normalizeClippingRing(polygon[0]);
	if (!outerRing || calculateClippingRingArea(outerRing) <= 0.000001) {
		return null;
	}

	const rings = [];
	rings.push(outerRing);
	polygon.slice(1).forEach((ring) => {
		const normalizedRing = normalizeClippingRing(ring);
		if (!normalizedRing) {
			return;
		}

		const area = calculateClippingRingArea(normalizedRing);
		if (area <= 0.000001) {
			return;
		}

		rings.push(normalizedRing);
	});

	return rings;
}

function normalizeClippingRing(ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return null;
	}

	const coordinates = [];
	ring.forEach((coordinate) => {
		if (!Array.isArray(coordinate) || coordinate.length < 2) {
			return;
		}

		const x = Number(coordinate[0]);
		const y = Number(coordinate[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return;
		}

		const previous = coordinates[coordinates.length - 1];
		if (previous && Math.abs(previous[0] - x) <= 0.000001 && Math.abs(previous[1] - y) <= 0.000001) {
			return;
		}

		coordinates.push([roundGeometryCoordinate(x), roundGeometryCoordinate(y)]);
	});

	if (coordinates.length < 3) {
		return null;
	}

	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	if (Math.abs(first[0] - last[0]) > 0.000001 || Math.abs(first[1] - last[1]) > 0.000001) {
		coordinates.push([...first]);
	}

	return coordinates.length >= 4 ? coordinates : null;
}

function roundGeometryCoordinate(value) {
	return Math.round(value * 1000000) / 1000000;
}

function validateRegionBooleanResult(operation, sourceGeometry, targetGeometry, resultGeometry) {
	const sourceArea = calculateClippingMultiPolygonArea(sourceGeometry);
	const targetArea = calculateClippingMultiPolygonArea(targetGeometry);
	const resultArea = calculateClippingMultiPolygonArea(resultGeometry);
	const epsilon = Math.max(0.01, (sourceArea + targetArea) * 0.000001);
	if (resultArea <= 0) {
		throw new Error("Die Geometrieoperation erzeugt keine gueltige Flaeche.");
	}

	if (operation === "difference" || operation === "difference-keep-target") {
		if (resultArea - sourceArea > epsilon) {
			throw new Error("Difference-Ergebnis ist groesser als die Ausgangsflaeche.");
		}
		return;
	}

	if (operation === "intersection") {
		if (resultArea - Math.min(sourceArea, targetArea) > epsilon) {
			throw new Error("Intersection-Ergebnis ist groesser als eine der Ausgangsflaechen.");
		}
		return;
	}

	if (operation === "union" && resultArea + epsilon < Math.max(sourceArea, targetArea)) {
		throw new Error("Union-Ergebnis ist kleiner als eine der Ausgangsflaechen.");
	}
}

function calculateClippingMultiPolygonArea(multiPolygon) {
	return (multiPolygon || []).reduce((area, polygon) => area + calculateClippingPolygonArea(polygon), 0);
}

async function debugRegionBooleanOperation(operation, sourceGeometry, targetGeometry, resultGeometry) {
	if (!POLITICAL_TERRITORIES_API_URL || !INITIAL_SEARCH_PARAMS.has("debugMap")) {
		return;
	}

	try {
		await submitPoliticalTerritoryEdit({
			action: "geometry_operation_debug",
			operation,
			source_geometry_geojson: clippingMultiPolygonToGeoJson(sourceGeometry),
			target_geometry_geojson: clippingMultiPolygonToGeoJson(targetGeometry),
			result_geometry_geojson: clippingMultiPolygonToGeoJson(resultGeometry),
		});
	} catch (error) {
		console.warn("Geometrie-Debug konnte nicht geschrieben werden:", error);
	}
}

function normalizeRegionFeature(feature) {
	const properties = feature.properties || {};
	const fillColor = getRegionFeatureColor(properties);
	const opacity = getRegionFeatureOpacity(properties);
	return {
		publicId: properties.public_id || feature.id || properties.id || properties.svg_id || "",
		geometryId: Number.isFinite(Number(properties.geometry_id)) ? Number(properties.geometry_id) : null,
		geometryPublicId: properties.geometry_public_id || properties.public_id || feature.id || "",
		territoryPublicId: properties.territory_public_id || "",
		source: properties.source || (properties.feature_type === "political_territory" ? "political_territory" : "map_feature"),
		name: normalizeRegionParentheticalSpacing(getRegionFeatureName(properties)),
		displayName: normalizeRegionParentheticalSpacing(properties.display_name || properties.name || ""),
		shortName: properties.short_name || "",
		type: normalizeRegionParentheticalSpacing(properties.territory_type || properties.feature_subtype || ""),
		color: fillColor,
		opacity,
		wikiUrl: properties.wiki_url || "",
		wikiId: properties.wiki_id || null,
		wikiName: properties.wiki_name || "",
		wikiType: normalizeRegionParentheticalSpacing(properties.wiki_type || properties.territory_type || properties.feature_subtype || ""),
		status: properties.status || "",
		coatOfArmsUrl: properties.coat_of_arms_url || "",
		labelName: properties.label_name || "",
		labelDisplayName: properties.label_display_name || "",
		labelCoatOfArmsUrl: properties.label_coat_of_arms_url || "",
		capitalName: properties.capital_name || "",
		seatName: properties.seat_name || "",
		capitalPlacePublicId: properties.capital_place_public_id || "",
		seatPlacePublicId: properties.seat_place_public_id || "",
		validFromBf: Number.isFinite(Number(properties.valid_from_bf)) ? Number(properties.valid_from_bf) : null,
		validToBf: Number.isFinite(Number(properties.valid_to_bf)) ? Number(properties.valid_to_bf) : null,
		validLabel: properties.valid_label || "",
		affiliation: properties.affiliation || "",
		affiliationRoot: properties.affiliation_root || "",
		affiliationPath: normalizeRegionStringList(properties.affiliation_path || properties.affiliation_path_json || properties.wiki_affiliation_path || properties.wiki_affiliation_path_json),
		parentName: properties.parent_name || "",
		foundedText: properties.founded_text || "",
		dissolvedText: properties.dissolved_text || "",
		wikiAffiliationRaw: properties.wiki_affiliation_raw || properties.affiliation || "",
		wikiAffiliationRoot: properties.wiki_affiliation_root || properties.affiliation_root || "",
		wikiFoundedText: properties.wiki_founded_text || properties.founded_text || "",
		wikiDissolvedText: properties.wiki_dissolved_text || properties.dissolved_text || "",
		wikiCapitalName: properties.wiki_capital_name || properties.capital_name || "",
		wikiSeatName: properties.wiki_seat_name || properties.seat_name || "",
		parentPublicId: properties.parent_public_id || "",
		labelLng: Number.isFinite(Number(properties.label_lng)) ? Number(properties.label_lng) : null,
		labelLat: Number.isFinite(Number(properties.label_lat)) ? Number(properties.label_lat) : null,
		showRegionLabel: properties.show_region_label !== false,
		minZoom: readOptionalRegionZoom(properties.min_zoom),
		maxZoom: readOptionalRegionZoom(properties.max_zoom),
		isActive: properties.is_active !== false,
		editorNotes: properties.editor_notes || "",
		revision: Number(properties.revision) || null,
		feature,
		layer: null,
		layers: [],
		label: null,
		handles: [],
	};
}

function getRegionFeatureName(properties) {
	return String(
		properties.display_name
		|| properties.name
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
	const layer = activeRegionGeometryEdit?.regionEntry === regionEntry
		? activeRegionGeometryEdit.editLayer
		: regionEntry.layer;
	return getPolygonOuterLatLngs(layer);
}

function setRegionOuterLatLngs(regionEntry, outerLatLngs) {
	const layer = activeRegionGeometryEdit?.regionEntry === regionEntry
		? activeRegionGeometryEdit.editLayer
		: regionEntry.layer;
	const holes = getPolygonLatLngRings(layer).slice(1);
	layer.setLatLngs(holes.length > 0 ? [outerLatLngs, ...holes] : [outerLatLngs]);
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

	clearRegionEditEdgeHover();
	disableRegionEditEdgeControls();

	if (activeRegionGeometryEdit.regionEntry.source !== "political_territory") {
		void releaseFeatureSoftLock(activeRegionGeometryEdit.regionEntry.publicId);
	}

	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit = null;
}

function refreshRegionEditHandles() {
	if (!activeRegionGeometryEdit) return;
	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit.handles = [];
	getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry).forEach((latLng, index) => {
		const originalLatLng = L.latLng(latLng);
		const handle = L.marker(latLng, {
			icon: createRegionHandleIcon(),
			pane: "measurementHandlesPane",
			draggable: true,
			keyboard: false,
			bubblingMouseEvents: false,
		}).addTo(map);
		
		handle.on("dragstart", () => {
			clearRegionEditEdgeHover();
		});

		handle.on("drag", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			latLngs[index] = event.target.getLatLng();
			setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
			clearRegionEditEdgeHover();
		});

		handle.on("dragend", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			const targetLatLng = findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
			latLngs[index] = targetLatLng;
			setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
			const affectedRegions = applySharedBoundaryVertexMove(activeRegionGeometryEdit.regionEntry, originalLatLng, targetLatLng);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
			refreshRegionEditHandles();
			void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
			affectedRegions.forEach((region) => {
				void saveRegionGeometry(region);
			});
		});

		handle.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			L.DomEvent.preventDefault(event);
			deleteRegionNode(index);
		});

		const element = handle.getElement?.();
		if (element) {
			L.DomEvent.disableClickPropagation(element);
			L.DomEvent.disableScrollPropagation(element);
			element.addEventListener("dblclick", (event) => {
				event.preventDefault();
				event.stopPropagation();
				deleteRegionNode(index);
			});
		}

		activeRegionGeometryEdit.handles.push(handle);
	});
}
function startRegionGeometryEdit(regionEntry, editLayer = null) {
	cancelPoliticalTerritoryLayerReload();
	clearRegionGeometryEdit();

	if (regionEntry.source !== "political_territory") {
		void acquireFeatureSoftLock(regionEntry.publicId);
	}

	activeRegionGeometryEdit = {
		regionEntry,
		editLayer: editLayer || regionEntry.layer,
		handles: [],
		edgeHover: null,
		edgeHighlightLayer: null,
	};

	refreshRegionEditHandles();
	enableRegionEditEdgeControls();
}

function enableRegionEditEdgeControls() {
	if (!map || map._regionEditEdgeControlsEnabled) {
		return;
	}

	map._regionEditEdgeControlsEnabled = true;

	map.on("mousemove", handleRegionEditMouseMove);
	map.on("mouseout", handleRegionEditMouseOut);
	map.on("click", handleRegionEditClick);

	document.addEventListener("keyup", handleRegionEditKeyUp, true);
}

function disableRegionEditEdgeControls() {
	if (!map || !map._regionEditEdgeControlsEnabled) {
		return;
	}

	map._regionEditEdgeControlsEnabled = false;

	map.off("mousemove", handleRegionEditMouseMove);
	map.off("mouseout", handleRegionEditMouseOut);
	map.off("click", handleRegionEditClick);

	document.removeEventListener("keyup", handleRegionEditKeyUp, true);
}

function handleRegionEditMouseMove(event) {
	if (!activeRegionGeometryEdit || !event?.originalEvent?.ctrlKey) {
		clearRegionEditEdgeHover();
		return;
	}

	updateRegionEditEdgeHoverFromLatLng(event.latlng);
}

function handleRegionEditMouseOut() {
	clearRegionEditEdgeHover();
}

function handleRegionEditKeyUp(event) {
	if (event.key === "Control") {
		clearRegionEditEdgeHover();
	}
} 

function handleRegionEditClick(event) {
	if (!activeRegionGeometryEdit || !event?.originalEvent?.ctrlKey) {
		return;
	}

	if (!activeRegionGeometryEdit.edgeHover && event.latlng) {
		updateRegionEditEdgeHoverFromLatLng(event.latlng);
	}

	if (!activeRegionGeometryEdit.edgeHover) {
		return;
	}

	L.DomEvent.stop(event.originalEvent);
	L.DomEvent.preventDefault(event.originalEvent);

	subdivideRegionEditHoveredEdge(4);
}

function updateRegionEditEdgeHoverFromLatLng(latLng) {
	if (!activeRegionGeometryEdit || !latLng) {
		clearRegionEditEdgeHover();
		return;
	}

	const edge = findNearestEditedRegionEdge(latLng, activeRegionGeometryEdit.regionEntry);

	if (!edge) {
		clearRegionEditEdgeHover();
		return;
	}

	activeRegionGeometryEdit.edgeHover = edge;
	renderRegionEditEdgeHighlight(edge);
}

function clearRegionEditEdgeHover() {
	if (!activeRegionGeometryEdit) {
		return;
	}

	activeRegionGeometryEdit.edgeHover = null;

	if (activeRegionGeometryEdit.edgeHighlightLayer) {
		map.removeLayer(activeRegionGeometryEdit.edgeHighlightLayer);
		activeRegionGeometryEdit.edgeHighlightLayer = null;
	}

	if (activeRegionGeometryEdit.edgePreviewLayer) {
		map.removeLayer(activeRegionGeometryEdit.edgePreviewLayer);
		activeRegionGeometryEdit.edgePreviewLayer = null;
	}
}

function readOptionalRegionZoom(value) {
	if (value === "" || value === null || typeof value === "undefined") {
		return null;
	}

	const zoom = Number(value);
	return Number.isFinite(zoom) ? zoom : null;
}

function renderRegionEditEdgeHighlight(edge) {
	if (!activeRegionGeometryEdit || !edge) {
		return;
	}

	if (activeRegionGeometryEdit.edgeHighlightLayer) {
		activeRegionGeometryEdit.edgeHighlightLayer.setLatLngs([edge.start, edge.end]);
		renderRegionEditEdgeSubdivisionPreview(edge, 4);
		return;
	}

	activeRegionGeometryEdit.edgeHighlightLayer = L.polyline([edge.start, edge.end], {
		pane: "measurementHandlesPane",
		color: "#f0c05a",
		weight: 6,
		opacity: 0.95,
		dashArray: "8 5",
		interactive: true,
		bubblingMouseEvents: false,
	}).addTo(map);

	activeRegionGeometryEdit.edgeHighlightLayer.on("click", handleRegionEditEdgeClick);
	activeRegionGeometryEdit.edgeHighlightLayer.on("dblclick", handleRegionEditEdgeClick);
	renderRegionEditEdgeSubdivisionPreview(edge, 4);
}

function renderRegionEditEdgeSubdivisionPreview(edge, pointCount) {
	if (!activeRegionGeometryEdit || !edge || pointCount < 1) {
		return;
	}

	const previewLayers = [];
	for (let offset = 1; offset <= pointCount; offset += 1) {
		const ratio = offset / (pointCount + 1);
		const point = L.latLng(
			edge.start.lat + (edge.end.lat - edge.start.lat) * ratio,
			edge.start.lng + (edge.end.lng - edge.start.lng) * ratio
		);

		previewLayers.push(L.circleMarker(point, {
			pane: "measurementHandlesPane",
			radius: 4,
			color: "#f0c05a",
			weight: 2,
			fillColor: "#f0c05a",
			fillOpacity: 0.95,
			interactive: false,
		}));
	}

	if (activeRegionGeometryEdit.edgePreviewLayer) {
		map.removeLayer(activeRegionGeometryEdit.edgePreviewLayer);
	}

	activeRegionGeometryEdit.edgePreviewLayer = L.layerGroup(previewLayers).addTo(map);
}

function handleRegionEditEdgeClick(event) {
	if (!activeRegionGeometryEdit || !event?.originalEvent?.ctrlKey || !activeRegionGeometryEdit.edgeHover) {
		return;
	}

	L.DomEvent.stop(event.originalEvent);
	L.DomEvent.preventDefault(event.originalEvent);

	subdivideRegionEditHoveredEdge(4);
}

function findNearestEditedRegionEdge(latLng, regionEntry) {
	const ring = getRegionOuterLatLngs(regionEntry);
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;

	for (let index = 0; index < ring.length; index += 1) {
		const start = L.latLng(ring[index]);
		const end = L.latLng(ring[(index + 1) % ring.length]);

		if (start.distanceTo(end) <= 0.001) {
			continue;
		}

		const startPoint = map.latLngToContainerPoint(start);
		const endPoint = map.latLngToContainerPoint(end);
		const projectedPoint = closestPointOnSegment(targetPoint, startPoint, endPoint);
		const distance = targetPoint.distanceTo(projectedPoint);

		if (distance <= REGION_EDIT_EDGE_HIT_TOLERANCE_PX && (!nearest || distance < nearest.distance)) {
			nearest = {
				index,
				start,
				end,
				distance,
				projectedLatLng: map.containerPointToLatLng(projectedPoint),
			};
		}
	}

	return nearest;
}

function subdivideRegionEditHoveredEdge(pointCount) {
	if (!activeRegionGeometryEdit?.edgeHover) {
		return;
	}

	const now = Date.now();
	if (activeRegionGeometryEdit.lastEdgeSubdivisionAt && now - activeRegionGeometryEdit.lastEdgeSubdivisionAt < 350) {
		return;
	}
	activeRegionGeometryEdit.lastEdgeSubdivisionAt = now;

	const regionEntry = activeRegionGeometryEdit.regionEntry;
	const edge = activeRegionGeometryEdit.edgeHover;
	const latLngs = getRegionOuterLatLngs(regionEntry).map(latLng => L.latLng(latLng));

	if (latLngs.length < 3 || edge.index < 0 || edge.index >= latLngs.length) {
		return;
	}

	const start = L.latLng(latLngs[edge.index]);
	const endIndex = (edge.index + 1) % latLngs.length;
	const end = L.latLng(latLngs[endIndex]);
	const insertedPoints = [];

	for (let offset = 1; offset <= pointCount; offset += 1) {
		const ratio = offset / (pointCount + 1);
		insertedPoints.push(L.latLng(
			start.lat + (end.lat - start.lat) * ratio,
			start.lng + (end.lng - start.lng) * ratio
		));
	}

	latLngs.splice(edge.index + 1, 0, ...insertedPoints);

	setRegionOuterLatLngs(regionEntry, latLngs);
	updateRegionLabelPosition(regionEntry);
	refreshRegionEditHandles();
	clearRegionEditEdgeHover();

	void saveRegionGeometry(regionEntry);
}

function updateRegionLabelPosition(regionEntry) {
	if (regionEntry?.label && regionEntry.layer) {
		if (regionEntry.labelLat !== null && regionEntry.labelLng !== null) {
			regionEntry.label.setLatLng(L.latLng(regionEntry.labelLat, regionEntry.labelLng));
			return;
		}

		const bounds = getRegionEntryBounds(regionEntry);
		regionEntry.label.setLatLng(bounds?.getCenter?.() || regionEntry.layer.getBounds().getCenter());
	}
}

function getRegionEntryBounds(regionEntry) {
	const layers = (regionEntry.layers?.length ? regionEntry.layers : [regionEntry.layer]).filter(Boolean);
	if (layers.length < 1) {
		return null;
	}

	const bounds = L.latLngBounds([]);
	layers.forEach((layer) => bounds.extend(layer.getBounds()));
	return bounds;
}

function applySharedBoundaryVertexMove(ownRegion, originalLatLng, targetLatLng) {
	const affectedRegions = new Set();
	regionPolygons.forEach((polygon) => {
		const regionEntry = polygon._regionEntry;
		if (!regionEntry || regionEntry === ownRegion || regionEntry.source !== "political_territory") {
			return;
		}

		const latLngs = polygon.getLatLngs();
		const updateResult = replaceMatchingNestedLatLngs(latLngs, originalLatLng, targetLatLng);
		const changed = updateResult.changed;
		if (!changed) {
			return;
		}

		polygon.setLatLngs(updateResult.latLngs);
		updateRegionLabelPosition(regionEntry);
		affectedRegions.add(regionEntry);
	});

	return Array.from(affectedRegions);
}

function replaceMatchingNestedLatLngs(value, originalLatLng, targetLatLng) {
	if (Array.isArray(value)) {
		let changed = false;
		const latLngs = value.map((entry) => {
			const result = replaceMatchingNestedLatLngs(entry, originalLatLng, targetLatLng);
			changed = changed || result.changed;
			return result.latLngs;
		});
		return { latLngs, changed };
	}

	const latLng = L.latLng(value);
	if (latLng.distanceTo(L.latLng(originalLatLng)) > 0.5) {
		return { latLngs: latLng, changed: false };
	}

	return { latLngs: L.latLng(targetLatLng), changed: true };
}

function findNearestRegionVertex(latLng, ownRegion) {
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;
	regionPolygons.forEach((polygon) => {
		if (polygon._regionEntry === ownRegion) return;
		getPolygonLatLngRings(polygon).forEach((ring) => {
			ring.forEach((candidate) => {
				const distance = targetPoint.distanceTo(map.latLngToContainerPoint(candidate));
				if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { latLng: candidate, distance };
			});
		});
	});
	return nearest?.latLng || null;
}

function findNearestRegionSnapPoint(latLng, ownRegion) {
	const nearestVertex = findNearestRegionVertex(latLng, ownRegion);
	if (nearestVertex) {
		return nearestVertex;
	}

	return findNearestRegionEdgePoint(latLng, ownRegion);
}

function findNearestRegionEdgePoint(latLng, ownRegion) {
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;
	regionPolygons.forEach((polygon) => {
		if (polygon._regionEntry === ownRegion) return;
		getPolygonLatLngRings(polygon).forEach((ring) => {
			for (let index = 0; index < ring.length; index++) {
				const start = ring[index];
				const end = ring[(index + 1) % ring.length];
				const startPoint = map.latLngToContainerPoint(start);
				const endPoint = map.latLngToContainerPoint(end);
				const projectedPoint = closestPointOnSegment(targetPoint, startPoint, endPoint);
				const distance = targetPoint.distanceTo(projectedPoint);
				if (distance <= 10 && (!nearest || distance < nearest.distance)) {
					nearest = {
						distance,
						latLng: map.containerPointToLatLng(projectedPoint),
					};
				}
			}
		});
	});

	return nearest?.latLng || null;
}

function closestPointOnSegment(point, startPoint, endPoint) {
	const segmentLengthSquared = startPoint.distanceTo(endPoint) ** 2;
	if (segmentLengthSquared <= 0) {
		return startPoint;
	}

	const ratio = Math.max(0, Math.min(1, (
		(point.x - startPoint.x) * (endPoint.x - startPoint.x)
		+ (point.y - startPoint.y) * (endPoint.y - startPoint.y)
	) / segmentLengthSquared));

	return L.point(
		startPoint.x + ratio * (endPoint.x - startPoint.x),
		startPoint.y + ratio * (endPoint.y - startPoint.y)
	);
}

function getPolygonOuterLatLngs(polygon) {
	return getPolygonLatLngRings(polygon)[0] || [];
}

function getPolygonLatLngRings(polygon) {
	return flattenLatLngRings(polygon.getLatLngs()).filter((ring) => ring.length > 0);
}

function flattenLatLngRings(value) {
	if (!Array.isArray(value) || value.length < 1) {
		return [];
	}

	if (isLatLngLike(value[0])) {
		return [value.map((latLng) => L.latLng(latLng))];
	}

	return value.flatMap((entry) => flattenLatLngRings(entry));
}

function isLatLngLike(value) {
	return Boolean(value && typeof value === "object" && "lat" in value && ("lng" in value || "lon" in value));
}

function deleteRegionNode(index) {
	const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
	if (latLngs.length <= 3) {
		showFeedbackToast("Region braucht mindestens drei Punkte.", "warning");
		return;
	}
	latLngs.splice(index, 1);
	setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
	updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
	refreshRegionEditHandles();
	void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
}

async function saveRegionGeometry(regionEntry) {
	if (regionEntry.source === "political_territory") {
		try {
			const result = await updatePoliticalRegionGeometry(regionEntry, regionLayerToGeoJsonGeometry(regionEntry));
			if (result.feature) {
				applyRegionFeatureResponse(regionEntry, result.feature);
			}
			showFeedbackToast("Grenze des Herrschaftsgebiets gespeichert.", "success");
		} catch (error) {
			showFeedbackToast(error.message || "Grenze des Herrschaftsgebiets konnte nicht gespeichert werden.", "warning");
		}
		return;
	}

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

async function updatePoliticalRegionGeometry(regionEntry, geometryGeoJson) {
	const result = await submitPoliticalTerritoryEdit({
		action: "update_geometry",
		public_id: regionEntry.geometryPublicId || regionEntry.publicId,
		geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
		source: "editor",
		geometry_geojson: geometryGeoJson,
		style_json: {
			fill: regionEntry.color,
			stroke: regionEntry.color,
			fillOpacity: regionEntry.opacity,
		},
	});
	void loadChangeLog();
	return result;
}

function regionLayerToGeoJsonGeometry(regionEntry) {
	return regionLayersToGeoJsonGeometry(regionEntry.layers?.length ? regionEntry.layers : [regionEntry.layer], regionEntry);
}

function regionLayersToGeoJsonGeometry(layers, fallbackRegionEntry = null) {
	const geometries = layers
		.filter(Boolean)
		.map((layer) => layer.toGeoJSON?.().geometry)
		.filter((geometry) => geometry && ["Polygon", "MultiPolygon"].includes(geometry.type));
	if (geometries.length < 1) {
		if (!fallbackRegionEntry) {
			throw new Error("Die Geometrie enthaelt keine Flaeche.");
		}

		return {
			type: "Polygon",
			coordinates: polygonLatLngsToCoordinates(getRegionOuterLatLngs(fallbackRegionEntry)),
		};
	}

	const polygons = [];
	geometries.forEach((geometry) => {
		if (geometry.type === "Polygon") {
			polygons.push(geometry.coordinates);
			return;
		}

		geometry.coordinates.forEach((polygon) => polygons.push(polygon));
	});

	return polygons.length === 1
		? { type: "Polygon", coordinates: polygons[0] }
		: { type: "MultiPolygon", coordinates: polygons };
}

function applyRegionFeatureResponse(regionEntry, feature) {
	const updatedRegion = normalizeRegionFeature(feature);
	regionEntry.publicId = updatedRegion.publicId || regionEntry.publicId;
	regionEntry.geometryId = updatedRegion.geometryId ?? regionEntry.geometryId ?? null;
	regionEntry.geometryPublicId = updatedRegion.geometryPublicId || regionEntry.geometryPublicId;
	regionEntry.territoryPublicId = updatedRegion.territoryPublicId;
	regionEntry.source = updatedRegion.source || regionEntry.source;
	regionEntry.name = updatedRegion.name || regionEntry.name;
	regionEntry.shortName = updatedRegion.shortName || "";
	regionEntry.type = updatedRegion.type || "";
	regionEntry.color = updatedRegion.color || regionEntry.color;
	regionEntry.opacity = updatedRegion.opacity ?? regionEntry.opacity;
	regionEntry.wikiUrl = updatedRegion.wikiUrl || "";
	regionEntry.wikiId = updatedRegion.wikiId || regionEntry.wikiId || null;
	regionEntry.wikiName = updatedRegion.wikiName || regionEntry.wikiName || "";
	regionEntry.wikiType = updatedRegion.wikiType || regionEntry.wikiType || "";
	regionEntry.status = updatedRegion.status || "";
	regionEntry.wikiAffiliationRaw = updatedRegion.wikiAffiliationRaw || regionEntry.wikiAffiliationRaw || "";
	regionEntry.wikiAffiliationRoot = updatedRegion.wikiAffiliationRoot || regionEntry.wikiAffiliationRoot || "";
	regionEntry.affiliationPath = updatedRegion.affiliationPath || regionEntry.affiliationPath || [];
	regionEntry.parentName = updatedRegion.parentName || "";
	regionEntry.foundedText = updatedRegion.foundedText || "";
	regionEntry.dissolvedText = updatedRegion.dissolvedText || "";
	regionEntry.wikiFoundedText = updatedRegion.wikiFoundedText || regionEntry.wikiFoundedText || "";
	regionEntry.wikiDissolvedText = updatedRegion.wikiDissolvedText || regionEntry.wikiDissolvedText || "";
	regionEntry.wikiCapitalName = updatedRegion.wikiCapitalName || regionEntry.wikiCapitalName || "";
	regionEntry.wikiSeatName = updatedRegion.wikiSeatName || regionEntry.wikiSeatName || "";
	regionEntry.coatOfArmsUrl = updatedRegion.coatOfArmsUrl || "";
	regionEntry.capitalName = updatedRegion.capitalName || "";
	regionEntry.seatName = updatedRegion.seatName || "";
	regionEntry.capitalPlacePublicId = updatedRegion.capitalPlacePublicId || "";
	regionEntry.seatPlacePublicId = updatedRegion.seatPlacePublicId || "";
	regionEntry.validFromBf = updatedRegion.validFromBf;
	regionEntry.validToBf = updatedRegion.validToBf;
	regionEntry.validLabel = updatedRegion.validLabel || "";
	regionEntry.affiliation = updatedRegion.affiliation || "";
	regionEntry.affiliationRoot = updatedRegion.affiliationRoot || "";
	regionEntry.parentPublicId = updatedRegion.parentPublicId || "";
	regionEntry.minZoom = updatedRegion.minZoom;
	regionEntry.maxZoom = updatedRegion.maxZoom;
	regionEntry.revision = updatedRegion.revision || regionEntry.revision || null;
	regionEntry.feature = feature;
	(regionEntry.layers?.length ? regionEntry.layers : [regionEntry.layer]).filter(Boolean).forEach((layer) => {
		layer.setStyle({ color: regionEntry.color, fillColor: regionEntry.color, fillOpacity: regionEntry.opacity });
	});
	regionEntry.label?.setContent(createRegionLabelMarkup(regionEntry, regionEntry.name));
}

async function createRegionAt(latlng) {
	setSelectedMapLayerMode("political");
	const center = L.latLng(latlng);
	const radius = 50;
	const points = Array.from({ length: 6 }, (_, index) => {
		const angle = Math.PI / 3 * index;
		return [center.lng + Math.cos(angle) * radius, center.lat + Math.sin(angle) * radius];
	});
	points.push(points[0]);
	if (POLITICAL_TERRITORIES_API_URL && !politicalTerritoryApiUnavailable) {
		try {
			const result = await submitPoliticalTerritoryEdit({
				action: "create_territory",
				name: "Neues Herrschaftsgebiet",
				short_name: "",
				type: "Herrschaftsgebiet",
				color: "#888888",
				opacity: 0.33,
				valid_to_open: true,
				is_active: true,
				geometry_geojson: {
					type: "Polygon",
					coordinates: [points],
				},
				style_json: {
					fill: "#888888",
					stroke: "#888888",
					fillOpacity: 0.33,
				},
			});
			void loadPoliticalTerritoryOptions();
			if (result.feature) {
				const regionEntry = normalizeRegionFeature(result.feature);
				regionData.push(result.feature);
				addRegionFeatureToMap(result.feature, regionEntry);
				if (getSelectedMapLayerMode() === "political") {
					map.addLayer(regionEntry.layer);
					if (regionEntry.label) {
						map.addLayer(regionEntry.label);
					}
				}
				startRegionGeometryEdit(regionEntry);
			}
			showFeedbackToast("Herrschaftsgebiet erstellt.", "success");
			return;
		} catch (error) {
			console.warn("Herrschaftsgebiet-Erstellung konnte nicht eindeutig bestätigt werden:", error);

			showFeedbackToast(
				error.message || "Herrschaftsgebiet konnte nicht eindeutig erstellt werden. Die Karte wird neu geladen.",
				"warning"
			);

			void loadPoliticalTerritoryOptions();
			schedulePoliticalTerritoryLayerReload();

			return;
		}
	}

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
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
	} catch (error) {
		showFeedbackToast(error.message || "Region konnte nicht erstellt werden.", "warning");
	}
}

async function deleteActiveRegion(selectedLayer = null, selectedPolygonIndex = null) {
	if (!regionEditEntry) return;
	if (regionEditEntry.source === "political_territory") {
		const selectedGeometryLayer = selectedLayer || activeRegionGeometryEdit?.editLayer || regionEditEntry.layer || null;
		const polygonCount = getRegionEntryLayers(regionEditEntry).length;
		if (!window.confirm(createPoliticalRegionDeleteConfirmation(regionEditEntry, polygonCount))) return;
		if (selectedGeometryLayer && polygonCount > 1) {
			try {
				await deleteRegionGeometryPart(regionEditEntry, selectedGeometryLayer);
				showFeedbackToast("Polygon geloescht.", "success");
			} catch (error) {
				showFeedbackToast(error.message || "Polygon konnte nicht geloescht werden.", "warning");
			}
			return;
		}

		try {
			const result = await submitPoliticalTerritoryEdit({
				action: "delete_geometry",
				public_id: regionEditEntry.geometryPublicId || regionEditEntry.publicId,
				geometry_public_id: regionEditEntry.geometryPublicId || regionEditEntry.publicId,
			});
			removeRegionEntryFromMap(regionEditEntry);
			if (result.territory_deleted) {
				removePoliticalTerritoryOption(result.territory_public_id || regionEditEntry.territoryPublicId || "");
			}
			regionData = regionData.filter((feature) => {
				const properties = feature.properties || {};
				return properties.geometry_public_id !== regionEditEntry.geometryPublicId
					&& properties.public_id !== regionEditEntry.geometryPublicId
					&& (!result.territory_deleted || properties.territory_public_id !== regionEditEntry.territoryPublicId);
			});
			clearRegionGeometryEdit();
			setRegionEditDialogOpen(false, { resetForm: true });
			schedulePoliticalTerritoryLayerReload({ immediate: true });
			void loadChangeLog();
			showFeedbackToast(result.territory_deleted ? "Letztes Polygon geloescht, Herrschaftsgebiet entfernt." : "Polygon geloescht.", "success");
		} catch (error) {
			console.error("Polygon konnte nicht geloescht werden:", error);
			showFeedbackToast(error.message || "Polygon konnte nicht geloescht werden.", "warning");
			setRegionEditStatus(error.message || "Polygon konnte nicht geloescht werden.", "error");
		}
		return;
	}

	if (!window.confirm(`${regionEditEntry.name} wirklich loeschen?`)) return;
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

function createPoliticalRegionDeleteConfirmation(regionEntry, polygonCount) {
	const name = regionEntry.name || "Herrschaftsgebiet";
	if (polygonCount > 1) {
		return `Ausgewaehltes Polygon von ${name} wirklich loeschen?`;
	}

	return `Letztes Polygon von ${name} wirklich loeschen? Das Herrschaftsgebiet wird nur entfernt, wenn danach keine Flaeche mehr existiert.`;
}

function removeRegionEntryFromMap(regionEntry) {
	getRegionEntryLayers(regionEntry).forEach((layer) => map.removeLayer(layer));
	if (regionEntry.label) {
		map.removeLayer(regionEntry.label);
		regionLabels = regionLabels.filter((label) => label !== regionEntry.label);
	}
	regionPolygons = regionPolygons.filter((polygon) => polygon._regionEntry !== regionEntry);
	regionEntry.layers = [];
	regionEntry.layer = null;
	regionEntry.label = null;
}

function removePoliticalTerritoryOption(territoryPublicId) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (normalizedPublicId === "") {
		return;
	}

	politicalTerritoryOptions = politicalTerritoryOptions.filter((territory) => territory.public_id !== normalizedPublicId);
	prunePoliticalTerritoryHierarchy(normalizedPublicId, politicalTerritoryHierarchy);
}

function prunePoliticalTerritoryHierarchy(publicId, nodes) {
	if (!Array.isArray(nodes)) {
		return;
	}

	for (let index = nodes.length - 1; index >= 0; index--) {
		const node = nodes[index];
		if (node?.public_id === publicId) {
			nodes.splice(index, 1);
			continue;
		}
		prunePoliticalTerritoryHierarchy(publicId, node?.children);
	}
}

async function deleteRegionGeometryPart(regionEntry, selectedLayer) {
	const layers = getRegionEntryLayers(regionEntry);
	if (!selectedLayer || !layers.includes(selectedLayer)) {
		throw new Error("Die ausgewaehlte Teilflaeche wurde nicht gefunden.");
	}

	const remainingLayers = layers.filter((layer) => layer !== selectedLayer);
	if (remainingLayers.length < 1) {
		const result = await submitPoliticalTerritoryEdit({
			action: "delete_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
		});
		removeRegionEntryFromMap(regionEntry);
		if (result.territory_deleted) {
			removePoliticalTerritoryOption(result.territory_public_id || regionEntry.territoryPublicId || "");
		}
		clearRegionGeometryEdit();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		return;
	}

	const result = await updatePoliticalRegionGeometry(regionEntry, regionLayersToGeoJsonGeometry(remainingLayers, regionEntry));
	map.removeLayer(selectedLayer);
	regionPolygons = regionPolygons.filter((polygon) => polygon !== selectedLayer);
	regionEntry.layers = remainingLayers;
	regionEntry.layer = regionEntry.layers[0] || null;
	regionEntry.layers.forEach((layer, index) => {
		layer._regionPolygonIndex = index;
	});
	if (result.feature) {
		applyRegionFeatureResponse(regionEntry, result.feature);
	}

	if (activeRegionGeometryEdit?.editLayer === selectedLayer) {
		clearRegionGeometryEdit();
	}
	updateRegionLabelPosition(regionEntry);
}

// Verarbeitung der Rastzeiten
