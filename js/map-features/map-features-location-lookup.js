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
	if (typeof nearestLookupPinnedMarkerEntry === "undefined" || !nearestLookupPinnedMarkerEntry) {
		return;
	}
	const entry = nearestLookupPinnedMarkerEntry;
	nearestLookupPinnedMarkerEntry = null;
	const stillHidden = typeof shouldShowLocationMarker !== "function" || !shouldShowLocationMarker(entry);
	if (stillHidden && map.hasLayer(entry.marker)) {
		map.removeLayer(entry.marker);
	}
}

function openLocationPopupByName(locationName) {
	const markerEntry = findLocationMarkerByName(locationName);
	if (!markerEntry) {
		return false;
	}

	// Evtl. noch offenen temporaeren Pin eines vorherigen Treffers aufraeumen.
	clearNearestLookupPinnedMarker();

	if (!map.hasLayer(markerEntry.marker)) {
		map.addLayer(markerEntry.marker);
	}

	if (typeof markerEntry.marker.bringToFront === "function") {
		markerEntry.marker.bringToFront();
	}

	const markerLatLng = markerEntry.marker.getLatLng();
	const popupContent = markerEntry.marker.getPopup()?.getContent?.() || markerEntry.name;
	map.panTo(markerLatLng);
	const popup = L.popup({
		autoPan: false,
		closeButton: true,
		className: "location-popup-wrapper",
	})
		.setLatLng(markerLatLng)
		.setContent(popupContent)
		.openOn(map);

	// Ist die Ortsgroesse dieses Treffers gerade nicht eingeblendet, den Marker nur temporaer zeigen
	// und beim Schliessen der Infobox wieder entfernen. NACH openOn pinnen, damit der popupclose des
	// zuvor offenen Popups nicht versehentlich diesen neuen Pin loescht.
	const isTemporary = typeof shouldShowLocationMarker === "function" && !shouldShowLocationMarker(markerEntry);
	if (isTemporary) {
		nearestLookupPinnedMarkerEntry = markerEntry;
		const handlePopupClose = (event) => {
			if (event.popup !== popup) {
				return;
			}
			map.off("popupclose", handlePopupClose);
			clearNearestLookupPinnedMarker();
		};
		map.on("popupclose", handlePopupClose);
	}
	return true;
}
