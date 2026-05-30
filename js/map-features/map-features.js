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
$("#toggleRivers").change(syncPathVisibility);
$("#toggleSeaPaths").change(syncPathVisibility);
if (IS_EDIT_MODE) {
	$("#toggleSeaPathsControl").prop("hidden", false);
}


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

$(document).on("click", "[data-region-place-public-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	focusRegionPlace(this.dataset.regionPlacePublicId || "");
});

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
		// Liefert der Resolver eine abgeleitete Außengrenze, liegt an dieser Stelle KEINE Quelle
		// darunter (sonst hätte er die Quelle bevorzugt). Abgeleitete Hüllen sind nicht editierbar
		// (sie werden aus den Unterflächen neu berechnet) -> Hinweis statt nutzloser Editor.
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.", "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("dblclick", (event) => {
		if (event.originalEvent?.target?.closest?.(".region-edit-handle-marker")) return;
		if (activeRegionGeometryEdit?.regionEntry === regionEntry && activeRegionGeometryEdit.editLayer === polygon) {
			handleEditableRegionDoubleClick(regionEntry, event, polygon);
			return;
		}
		L.DomEvent.stop(event);
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		// Wie beim Einfach-Klick: eine abgeleitete Außengrenze bedeutet hier "keine Quelle drunter".
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.", "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
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

	if (REGION_BOOLEAN_CONTEXT_ACTIONS.has(action)) {
		startPendingRegionOperation(action, regionEntry, regionLayer);
		return;
	}

	const contextActionHandler = REGION_CONTEXT_ACTIONS[action];
	if (!contextActionHandler) {
		return;
	}

	contextActionHandler({ regionEntry, regionLayer, polygonIndex });
});

const REGION_BOOLEAN_CONTEXT_ACTIONS = new Set([
	"union",
	"difference",
	"difference-keep-target",
	"intersection",
]);

const REGION_CONTEXT_ACTIONS = {
	"edit-geometry": ({ regionEntry, regionLayer }) => {
		startRegionGeometryEdit(regionEntry, regionLayer);
	},
	"edit-properties": ({ regionEntry }) => {
		// Abgeleitete Außengrenzen haben keine eigenen editierbaren Eigenschaften/Zuweisung
		// (sie werden aus den Unterflächen berechnet) -> Hinweis statt leerem "kein Knoten"-Editor.
		if (regionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) bearbeiten.", "info");
			return;
		}
		clearRegionGeometryEdit();

		if (window.AvesmapsPoliticalTerritoryEditorLink) {
			window.AvesmapsPoliticalTerritoryEditorLink.open(regionEntry);
			return;
		}

		openRegionEditDialog(regionEntry, { title: "Eigenschaften bearbeiten" });
	},
	"show-info": ({ regionEntry }) => {
		openRegionCompactTooltip(regionEntry);
		showPoliticalTerritoryTimelineSelection(regionEntry);
	},
	"move": ({ regionEntry }) => {
		startPendingRegionMove(regionEntry, pendingContextMenuLatLng || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter());
	},
	"split": ({ regionEntry, regionLayer }) => {
		startPendingRegionSplit(regionEntry, regionLayer);
	},
	"extract": ({ regionEntry, regionLayer }) => {
		void extractRegionGeometryPartAsNewTerritory(regionEntry, regionLayer);
	},
	"delete": ({ regionEntry, regionLayer, polygonIndex }) => {
		regionEditEntry = regionEntry;
		void deleteActiveRegion(regionLayer, polygonIndex);
	},
};

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
		await politicalTerritoryRepository.createExtractedTerritory(regionEntry, extractedName, extractedGeometry);

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
		await politicalTerritoryRepository.splitGeometry(operationState, sourcePart, splitPart);

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
	const result = await politicalTerritoryRepository.updateGeometry(regionEntry, geometryGeoJson);
	void loadChangeLog();
	return result;
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
	const radius = 10;
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
			const result = await politicalTerritoryRepository.deleteGeometry(regionEditEntry);
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
		const result = await politicalTerritoryRepository.deleteGeometry(regionEntry);
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
