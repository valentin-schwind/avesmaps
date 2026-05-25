/*
 * Extracted location marker entry and popup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

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
		if (!saveSucceeded && activeLocationEdit.originalLatLng) {
			marker.setLatLng(activeLocationEdit.originalLatLng);
			syncLocationNameLabelVisibility();
		}
		setLocationEditActive(markerEntry, false);
	});
	refreshLocationMarkerPopup(markerEntry);
	return markerEntry;
}
