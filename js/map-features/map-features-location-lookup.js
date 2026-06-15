/*
 * Extracted location lookup, type and naming helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

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

function findLocationMarkerByName(name) {
	return locationMarkers.find((entry) => entry.name === name) || null;
}

function findLocationMarkerByPublicId(publicId) {
	return locationMarkers.find((entry) => entry.publicId === publicId) || null;
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

// Entfernt den per "Nächsten Ort finden"/Suche temporaer eingeblendeten Marker wieder, sobald seine
// Ortsgroesse nicht (mehr) eingeblendet ist. Erst den Pin loesen, dann die normale Sichtbarkeit
// entscheiden lassen.
function clearNearestLookupPinnedMarker() {
	nearestLookupTempPopup = null;
	if (typeof nearestLookupPinnedMarkerEntry === "undefined" || !nearestLookupPinnedMarkerEntry) {
		return;
	}
	const entry = nearestLookupPinnedMarkerEntry;
	nearestLookupPinnedMarkerEntry = null;
	// Re-render the just-unpinned marker by the normal rules: a hidden marker gets removed, a
	// canvas-rendered settlement type returns to the canvas overlay (instead of lingering as a DOM
	// duplicate on top of its canvas dot), and a genuinely shown DOM marker is kept. Fall back to the
	// direct removeLayer when the full sync is unavailable.
	if (typeof syncLocationMarkerVisibility === "function") {
		syncLocationMarkerVisibility();
		return;
	}
	const stillHidden = typeof shouldShowLocationMarker !== "function" || !shouldShowLocationMarker(entry);
	if (stillHidden && map.hasLayer(entry.marker)) {
		map.removeLayer(entry.marker);
	}
}

let nearestLookupPopupCloseHandlerBound = false;
function ensureNearestLookupPopupCloseHandler() {
	if (nearestLookupPopupCloseHandlerBound) {
		return;
	}
	nearestLookupPopupCloseHandlerBound = true;
	// EIN globaler Handler: der temporaere Marker wird erst entfernt, wenn GENAU der zugehoerige
	// (temporaere) Popup geschlossen wird — nicht, wenn das Oeffnen eines neuen Popups den alten schliesst.
	map.on("popupclose", (event) => {
		if (nearestLookupTempPopup && event.popup === nearestLookupTempPopup) {
			clearNearestLookupPinnedMarker();
		}
	});
}

function openLocationPopupByName(locationName) {
	return openLocationPopupForMarkerEntry(findLocationMarkerByName(locationName));
}

function openLocationPopupByPublicId(publicId) {
	return openLocationPopupForMarkerEntry(findLocationMarkerByPublicId(publicId));
}

function openLocationPopupForMarkerEntry(markerEntry, { pan = true } = {}) {
	if (!markerEntry) {
		return false;
	}

	// Evtl. noch offenen temporaeren Marker eines vorherigen Treffers aufraeumen.
	clearNearestLookupPinnedMarker();

	// The bound popup needs this marker to exist as a real DOM layer. A marker only counts as a
	// persistent DOM marker when it is BOTH shown AND not drawn on the canvas overlay -- canvas
	// markers are default-on for every settlement type, so a "visible" dorf/kleinstadt/... is a
	// canvas dot, not a DOM marker. In that case (or when the size is hidden) pin it as a temporary
	// DOM marker BEFORE panTo, so the visibility-sync triggered by the pan does not remove the DOM
	// marker (line 243) and with it close the freshly opened popup.
	const canvasMarkersOn = typeof LOCATION_CANVAS_MARKERS_ENABLED !== "undefined"
		&& LOCATION_CANVAS_MARKERS_ENABLED
		&& typeof IS_EDIT_MODE !== "undefined" && !IS_EDIT_MODE;
	const renderedOnCanvas = canvasMarkersOn
		&& typeof LOCATION_CANVAS_TYPES !== "undefined"
		&& LOCATION_CANVAS_TYPES.has(markerEntry.locationType)
		&& !markerEntry._canvasPromoted;
	const isShownAsDomMarker = typeof shouldShowLocationMarker === "function"
		&& shouldShowLocationMarker(markerEntry)
		&& !renderedOnCanvas;
	const isTemporary = !isShownAsDomMarker;
	if (isTemporary) {
		nearestLookupPinnedMarkerEntry = markerEntry;
	}

	if (!map.hasLayer(markerEntry.marker)) {
		map.addLayer(markerEntry.marker);
	}

	if (typeof markerEntry.marker.bringToFront === "function") {
		markerEntry.marker.bringToFront();
	}

	// Das am Marker GEBUNDENE Popup oeffnen (statt eines eigenen) -> identisches Aussehen/Verhalten wie
	// ein Klick auf den Marker: settlement-popup-Styling, Bewertungen, aktueller Route-Button.
	if (typeof refreshLocationMarkerPopup === "function" && !markerEntry.marker.getPopup()) {
		refreshLocationMarkerPopup(markerEntry);
	}
	// Nur zentrieren, wenn der Aufrufer nicht selbst schon hingezoomt hat (Spotlight/WikiSync/Route
	// machen ihr eigenes setView/flyTo -> kein konkurrierendes panTo).
	if (pan) {
		map.panTo(markerEntry.marker.getLatLng());
	}
	// Opening the popup right after the animated panTo can crash Leaflet's popup autoPan: when the
	// target is off-screen and the pan is still in flight, _adjustPan reads a null map and throws an
	// uncaught TypeError ("find nearest location" crash, language-independent). We already centre the
	// marker via panTo, so the popup's own autoPan is redundant -> disable it for this single open to
	// avoid the race. Keep the pan ANIMATED: an instant (animate:false) pan fires the moveend
	// visibility-sync synchronously BEFORE openPopup, which removes the freshly added marker so
	// nothing shows.
	const popupForOpen = markerEntry.marker.getPopup();
	const previousAutoPan = popupForOpen && popupForOpen.options ? popupForOpen.options.autoPan : undefined;
	if (popupForOpen && popupForOpen.options) {
		popupForOpen.options.autoPan = false;
	}
	markerEntry.marker.openPopup();
	if (popupForOpen && popupForOpen.options) {
		popupForOpen.options.autoPan = previousAutoPan;
	}

	if (isTemporary) {
		nearestLookupTempPopup = markerEntry.marker.getPopup();
		ensureNearestLookupPopupCloseHandler();
	}
	return true;
}
