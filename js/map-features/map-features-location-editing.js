// Location & crossing marker editing: path-endpoint helpers, move/save a location
// (and shift connected path endpoints), edit/convert/delete, create location/
// crossing. Split out of map-features.js (M5 god-file split). Plain classic script:
// global functions called at runtime; shared map-features state referenced cross-script.

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
		// Discord #43: this is the ONE funnel through which a marker becomes draggable, so it is
		// where the Ctrl-detach tracking is armed and disarmed (see map-features-location-detach-edit.js).
		if (typeof avesmapsArmLocationDetachTracking === "function") {
			avesmapsArmLocationDetachTracking(markerEntry);
		}
		showFeedbackToast(`${markerEntry.name}: Marker verschieben, Loslassen speichert. Mit Strg bleiben angeschlossene Wege liegen.`, "info");
		return;
	}

	if (activeLocationEdit?.markerEntry === markerEntry) {
		void releaseFeatureSoftLock(activeLocationEdit.markerEntry.publicId);
		activeLocationEdit = null;
	}
	if (typeof avesmapsDisarmLocationDetachTracking === "function") {
		avesmapsDisarmLocationDetachTracking();
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
	// Discord #43: with Ctrl held during the drag the connected way ends stay put, so a place can be
	// pulled off its ways for a moment instead of dragging them across the map. Read BEFORE the first
	// await -- ending the edit clears the intent, and the change-report path (review-editor-submit.js)
	// calls this function without a drag at all, where it is correctly false.
	const shouldDetachConnectedPaths = typeof avesmapsConsumeLocationDetachIntent === "function"
		&& avesmapsConsumeLocationDetachIntent();

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
		// Registered only after the move actually saved -- a failed save leaves no gap to watch.
		const detachedPathEndCount = shouldDetachConnectedPaths && previousCoordinates && typeof avesmapsRegisterDetachedPathEnds === "function"
			? avesmapsRegisterDetachedPathEnds(previousCoordinates)
			: 0;
		const pathMoveSummary = previousCoordinates && !shouldDetachConnectedPaths
			? await moveConnectedPathEndpointsForLocation(previousCoordinates, markerEntry.location.coordinates)
			: {
				movedPathCount: 0,
				failedPathCount: 0,
			};
		syncLocationNameLabelVisibility();
		refreshPlannerAfterFeatureChange({ updateRoute: true });
		if (shouldDetachConnectedPaths) {
			// Warning tone on purpose: the separation is a working state on borrowed time, and the
			// counter on the map keeps saying so until the last end hangs on a place again.
			showFeedbackToast(
				detachedPathEndCount > 0
					? `${markerEntry.name} verschoben — ${detachedPathEndCount} ${detachedPathEndCount === 1 ? "Wegende blieb" : "Wegenden blieben"} liegen (Strg).`
					: `${markerEntry.name} gespeichert.`,
				detachedPathEndCount > 0 ? "warning" : "success"
			);
			return true;
		}
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
	// Discord #48: this path used to run the type through normalizeLocationType() alone, whose
	// whitelist knows only settlements -- so every live update of an existing CROSSING (another
	// editor moving it, a wiki/link save touching it) came back as "dorf" and the crossing turned
	// into a village on the other editor's map. The shared classifier reads the server's own
	// feature_type/feature_subtype; the marker is the fallback for a payload that carries no type
	// at all, and normalizeLocationType stays for an unknown settlement key (now audibly).
	const locationType = resolveLocationTypeFromFeature(feature, markerEntry)
		|| normalizeLocationType(feature.location_type || feature.feature_subtype || markerEntry.locationType);
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
		// Same two-case label as the load and create paths. A crossing needs its own arm: it has no
		// LOCATION_TYPE_CONFIG entry, and the server sends location_type_label 'Dorf' for it
		// (avesmapsLocationSubtypeLabel has no crossing arm, so it hits the default) -- so without
		// this the infobox called a correctly typed crossing a village anyway.
		locationTypeLabel: locationType === CROSSING_LOCATION_TYPE
			? tr("locationType.crossing", "Kreuzung")
			: tr(`type.${locationType}.singular`, feature.location_type_label || LOCATION_TYPE_CONFIG[locationType]?.singularLabel || "Dorf"),
		description: feature.description || "",
		wikiUrl: feature.wiki_url || "",
		otherSource: feature.other_source || null,
		wikiSettlement: feature.wiki_settlement !== undefined ? feature.wiki_settlement : (markerEntry.location.wikiSettlement || null),
		coat: feature.coat !== undefined ? feature.coat : (markerEntry.location.coat || null),
		images: feature.images !== undefined ? feature.images : (markerEntry.location.images || []),
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
	showFeedbackToast("Ort bearbeiten und speichern, um die Konvertierung abzuschließen.", "info");
}

async function deleteLocationMarker(markerEntry) {
	const locationTypeLabel = markerEntry.locationType === CROSSING_LOCATION_TYPE ? "Kreuzung" : "Ort";
	const connectedPowerlines = markerEntry.locationType === CROSSING_LOCATION_TYPE
		? getConnectedPowerlinesForPublicId(markerEntry.publicId)
		: [];
	const confirmationMessage = connectedPowerlines.length > 0
		? `${markerEntry.name} ist noch mit ${connectedPowerlines.length} ${connectedPowerlines.length === 1 ? "Kraftlinie" : "Kraftlinien"} verbunden. Wirklich löschen?`
		: `${markerEntry.name} wirklich löschen?`;
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
		showFeedbackToast(`${locationTypeLabel} gelöscht.`, "success");
		// Settlement list's green/"placed" dot is derived from map_features at load time; a deleted
		// place must not keep showing as placed until the next manual reload. Only for real locations
		// (crossings aren't listed there anyway) and only if the list was actually loaded once
		// (avoids forcing a fetch/tab-open from an unrelated part of the app).
		if (markerEntry.locationType !== CROSSING_LOCATION_TYPE && typeof settlementListItems !== "undefined" && settlementListItems.length > 0 && typeof loadSettlementList === "function") {
			void loadSettlementList();
		}
	} catch (error) {
		console.error(`${locationTypeLabel} konnte nicht gelöscht werden:`, error);
		showFeedbackToast(error.message || `${locationTypeLabel} konnte nicht gelöscht werden.`, "warning");
	}
}

function addCreatedLocationMarker(feature, { openPopup = true } = {}) {
	const locationType = resolveLocationTypeFromFeature(feature)
		|| normalizeLocationType(feature.location_type || feature.feature_subtype || DEFAULT_LOCATION_TYPE);
	const location = {
		publicId: feature.public_id,
		name: feature.name,
		coordinates: [Number(feature.lat), Number(feature.lng)],
		locationType,
		locationTypeLabel: locationType === CROSSING_LOCATION_TYPE
			? tr("locationType.crossing", "Kreuzung")
			: tr(`type.${locationType}.singular`, feature.location_type_label || LOCATION_TYPE_CONFIG[locationType]?.singularLabel || "Dorf"),
		description: feature.description || "",
		wikiUrl: feature.wiki_url || "",
		otherSource: feature.other_source || null,
		wikiSettlement: feature.wiki_settlement || null,
		coat: feature.coat || null,
		images: feature.images || [],
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
	return markerEntry;
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
		other_source: readFeatureOtherSource(properties),
		wiki_settlement: properties.wiki_settlement || null,
		images: properties.images || [],
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
		locationTypeLabel: tr("locationType.crossing", "Kreuzung"),
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
