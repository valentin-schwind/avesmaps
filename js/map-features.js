// Location markers and labels
const VISUAL_MAX_ZOOM_LEVEL = 5;
const LOCATION_LABEL_GAP = 11;
const LOCATION_LABEL_SHIFT_SMALL = 8;
const LOCATION_LABEL_COLLISION_PADDING = 2;
const REGION_OVERLAP_SELECTION_TIMEOUT_MS = 3000;
const REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE = 18;
const REGION_EDIT_EDGE_HIT_TOLERANCE_PX = 22;
let recentRegionOverlapSelection = null;

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
