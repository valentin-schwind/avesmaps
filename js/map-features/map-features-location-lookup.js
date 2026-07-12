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

// Schlanke Infobox als schwebendes Karten-Popup DIREKT am Ort (Owner-Modell "Karten-Popup, Panel bleibt";
// u. a. fuer "Nächster Ort finden"). Bewusst ein EIGENES L.popup (nicht das gebundene Marker-Popup), damit
// die Infopanel-Interception (popupopen -> ins Panel + verstecken) NICHT greift und die schlanke Box
// wirklich auf der Karte erscheint. Zentriert die Karte auf den Ort. Faellt auf das volle gebundene Popup
// zurueck, wenn der schlanke Builder fehlt.
function openSlimLocationPopupForMarkerEntry(markerEntry) {
	if (!markerEntry || typeof map === "undefined" || !map) {
		return false;
	}
	if (typeof buildSlimLocationPopupHtml !== "function") {
		return openLocationPopupForMarkerEntry(markerEntry);
	}
	// Evtl. noch offenen temporaeren Marker eines vorherigen Treffers aufraeumen.
	clearNearestLookupPinnedMarker();

	let latlng = null;
	if (markerEntry.marker && typeof markerEntry.marker.getLatLng === "function") {
		latlng = markerEntry.marker.getLatLng();
	} else if (markerEntry.location && markerEntry.location.coordinates) {
		latlng = L.latLng(markerEntry.location.coordinates);
	}
	// Guard NON-FINITE coords too: a NaN latlng passes the truthy check, but setView/panTo(NaN) leaves the
	// map centre undefined so the NEXT moveend crashes in Leaflet's _panInsideMaxBounds.
	if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
		return false;
	}

	// Ort-Marker sichtbar machen, solange das Popup offen ist -- UNABHAENGIG vom Gebaeude-Toggle (Owner):
	// ist der Ort nur ein Canvas-Dot oder ausgeblendet, als temporaeren DOM-Marker anpinnen (wie beim
	// gebundenen Popup). So sitzt zudem ein echter Marker GENAU auf dem Ziel-Vertex, auf den die Spitze zeigt.
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
	const isTemporary = Boolean(markerEntry.marker) && !isShownAsDomMarker;
	if (isTemporary) {
		nearestLookupPinnedMarkerEntry = markerEntry;
		const zoomLevel = map.getZoom();
		if (markerEntry.iconZoomLevel !== zoomLevel && typeof createLocationMarkerIcon === "function") {
			markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType, zoomLevel));
			markerEntry.iconZoomLevel = zoomLevel;
		}
		if (!map.hasLayer(markerEntry.marker)) {
			map.addLayer(markerEntry.marker);
		}
		if (typeof markerEntry.marker.bringToFront === "function") {
			markerEntry.marker.bringToFront();
		}
	}

	// Auf den Ort zentrieren; autoPan des Popups AUS (sonst Race/Crash direkt nach dem animierten panTo).
	// Zoom-Regel (Owner): ist bereits eine Route gefunden/gezeichnet (currentRouteLayer hat Segmente ODER
	// >= 2 Wegpunkte), die aktuelle Zoomstufe BEIBEHALTEN (Route-Ansicht nicht stoeren); sonst auf
	// Zoomstufe 5 gehen.
	const routeIsActive = (typeof currentRouteLayer !== "undefined" && currentRouteLayer
		&& typeof currentRouteLayer.getLayers === "function" && currentRouteLayer.getLayers().length > 0)
		|| (typeof getWaypointInputValues === "function" && getWaypointInputValues().length >= 2);
	// Hartes Umschalten (setView/panTo statt flyTo, Owner-Regel): mit aktiver Route nur pan (Zoom
	// halten), sonst direkt auf Zoomstufe 5.
	try {
		if (routeIsActive) {
			map.panTo(latlng);
		} else {
			map.setView(latlng, 5);
		}
	} catch (error) { /* noop */ }

	// Eigenes schlankes Popup mit STANDARD-Offset -> die Spitze zeigt genau auf das Ziel-Vertex-Zentrum.
	const popup = L.popup({ autoClose: true, closeOnClick: true, closeButton: true, className: "slim-location-popup", maxHeight: locationMarkerPopupMaxHeight(), minWidth: 320, maxWidth: 400, autoPan: false })
		.setLatLng(latlng)
		.setContent(buildSlimLocationPopupHtml(markerEntry));
	map.openPopup(popup);

	// Beim Schliessen des Popups den temporaeren Marker wieder entfernen (gemeinsamer popupclose-Handler).
	if (isTemporary) {
		nearestLookupTempPopup = popup;
		ensureNearestLookupPopupCloseHandler();
	}
	return true;
}

// Floating "slim" box for a DIRECT map click in infopanel mode (Owner: keep seeing WHERE the place is,
// while the full info lives in the right panel). Its OWN L.popup so the panel-interception (which fires
// on the bound marker popup) does NOT swallow it. The box uses the slimmed floating variant (no
// Publikationen, no Stadtkarten/Abenteuer, reviews as a compact summary-link). No re-centre/zoom: the
// clicked place is already in view. Guarded on finite coords (Leaflet _panInsideMaxBounds crash).
function openFloatingLocationBoxForMarkerEntry(markerEntry) {
	if (!markerEntry || typeof map === "undefined" || !map || typeof buildLocationMarkerPopupHtml !== "function") {
		return false;
	}
	let latlng = null;
	if (markerEntry.marker && typeof markerEntry.marker.getLatLng === "function") {
		latlng = markerEntry.marker.getLatLng();
	} else if (markerEntry.location && markerEntry.location.coordinates) {
		latlng = L.latLng(markerEntry.location.coordinates);
	}
	if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
		return false;
	}
	const popup = L.popup({
		autoClose: true, closeOnClick: true, closeButton: true,
		className: "slim-location-popup floating-location-popup",
		maxHeight: locationMarkerPopupMaxHeight(), minWidth: 320, maxWidth: 400, autoPan: false,
	})
		.setLatLng(latlng)
		.setContent(buildLocationMarkerPopupHtml(markerEntry, { floating: true }));
	map.openPopup(popup);
	// Load the compact reviews (summary-link + write button) into the floating box's slot.
	if (typeof hydrateLocationReviews === "function") {
		const el = typeof popup.getElement === "function" ? popup.getElement() : null;
		const slot = el ? el.querySelector(".location-reviews") : null;
		if (slot) {
			hydrateLocationReviews(slot);
		}
	}
	return true;
}

function openLocationPopupForMarkerEntry(markerEntry, { pan = true } = {}) {
	if (!markerEntry) {
		return false;
	}

	// Evtl. noch offenen temporaeren Marker eines vorherigen Treffers aufraeumen.
	clearNearestLookupPinnedMarker();

	// Infopanel (?infopanel=true): Feature-Info ins rechte Panel statt ins gebundene Popup;
	// optional zur Location zentrieren (Such-/Deeplink-Treffer). Pinning + openPopup entfallen.
	if (typeof window.avesmapsShowLocationInInfopanel === "function") {
		if (pan) {
			try { map.panTo(markerEntry.marker.getLatLng()); } catch (error) { /* noop */ }
		}
		window.avesmapsShowLocationInInfopanel(markerEntry);
		// Floating box on the map too (Owner: also when arriving via a shared/deep-link ?siedlung= URL and
		// via spotlight search -- both route through here; breadcrumb navigation does NOT).
		if (typeof openFloatingLocationBoxForMarkerEntry === "function") {
			openFloatingLocationBoxForMarkerEntry(markerEntry);
		}
		return true;
	}

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

	// The marker's icon may be stale (canvas markers keep their creation-zoom icon). Refresh it to the
	// current zoom so a temporarily pinned marker (spotlight / find-nearest, with sizes hidden) shows the
	// size it WOULD have at the current zoom -- not a tiny leftover icon.
	const pinnedZoomLevel = map.getZoom();
	if (markerEntry.iconZoomLevel !== pinnedZoomLevel) {
		markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType, pinnedZoomLevel));
		markerEntry.iconZoomLevel = pinnedZoomLevel;
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
