function createRouteNodeMarkersForSegment(segment) {
	return [];
}

function drawRoute(segments) {
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
	currentRouteNodeLayer = L.layerGroup();
	currentRouteLayer = L.layerGroup();
	segments.forEach((segment, segmentIndex) => {
		const visualCoordinates = smoothLineCoordinatesForDisplay(segment.geometry?.coordinates || [], VISUAL_LINE_CATMULL_ROM_CONFIG);
		const segCoords = visualCoordinates.map(([x, y]) => [y, x]);
		if (segCoords.length) {
			const segLayer = L.polyline(segCoords, getRouteSegmentStyle(segment));
			segLayer.on("click", (event) => {
				if (event.originalEvent) {
					L.DomEvent.stop(event.originalEvent);
				}
				selectRoutePlanEntryForSegment(segmentIndex);
			});
			currentRouteLayer.addLayer(segLayer);
			currentRouteSegmentLayers[segmentIndex] = { layer: segLayer, segment };
			createRouteNodeMarkersForSegment(segment).forEach((marker) => currentRouteNodeLayer.addLayer(marker));
		} else {
			console.warn("Ungültige Segmentkoordinaten:", segment.geometry);
		}
	});
	if (currentRouteLayer.getLayers().length) currentRouteLayer.addTo(map);
	if (currentRouteNodeLayer.getLayers().length) currentRouteNodeLayer.addTo(map);
}

function logRoutePoints(segments) {
	const points = segments.flatMap((segment) => segment.geometry.coordinates.map(([x, y]) => ({ x, y })));
	console.log("Route points:", points);
	return points;
}

// Wegpunkt-Grafiken (Owner-Vorgabe): einzelne Wegpunkte -> waypoint.webp (zentriert auf den Vertex),
// das Ziel (letzter Wegpunkt) -> pin.webp (Spitze unten auf den Vertex). Lazy erzeugt (map/L existieren).
let waypointRouteIconCache = null;
function waypointRouteIcons() {
	if (!waypointRouteIconCache) {
		waypointRouteIconCache = {
			waypoint: L.icon({ iconUrl: "icons/waypoint.webp", iconSize: [28, 28], iconAnchor: [14, 14], className: "route-waypoint-icon" }),
			pin: L.icon({ iconUrl: "icons/pin.webp", iconSize: [30, 37], iconAnchor: [15, 37], className: "route-waypoint-pin" }),
		};
	}
	return waypointRouteIconCache;
}

// Hover-Popup an einem Wegpunkt-Icon: zeigt die SCHLANKE Infobox (buildSlimLocationPopupHtml). Owner:
// beim Hovern erscheint die Infobox und BLEIBT, solange die Maus ueber Icon ODER Popup ist (Buttons
// klickbar). Kein Auto-Popup beim Klick -> nur Hover. Die Vollansicht bleibt dem rechten Panel vorbehalten.
function bindWaypointHoverPopup(marker, markerEntry) {
	if (typeof buildSlimLocationPopupHtml !== "function") {
		return;
	}
	let closeTimer = null;
	const popup = L.popup({ autoClose: false, closeOnClick: false, closeButton: false, className: "waypoint-hover-popup", maxWidth: 300, offset: [0, -8] });
	const cancelClose = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } };
	const scheduleClose = () => { cancelClose(); closeTimer = setTimeout(() => map.closePopup(popup), 220); };
	const openHover = () => {
		cancelClose();
		popup.setLatLng(marker.getLatLng());
		popup.setContent(buildSlimLocationPopupHtml(markerEntry));
		map.openPopup(popup);
		const el = typeof popup.getElement === "function" ? popup.getElement() : popup._container;
		if (el) {
			el.addEventListener("mouseenter", cancelClose);
			el.addEventListener("mouseleave", scheduleClose);
		}
	};
	marker.on("mouseover", openHover);
	marker.on("mouseout", scheduleClose);
}

function highlightRouteLocations(routeNames, segments = []) {
	removeHighlightedRouteNodes();
	const icons = waypointRouteIcons();
	routeNames.forEach((name, index) => {
		const previousIsSea = normalizePathSubtype(segments[index - 1]?.properties?.feature_subtype || segments[index - 1]?.properties?.name) === "Seeweg";
		const nextIsSea = normalizePathSubtype(segments[index]?.properties?.feature_subtype || segments[index]?.properties?.name) === "Seeweg";
		const loc = resolveRouteNodeLocation(name, index, routeNames, segments);
		if ((previousIsSea || nextIsSea) && (!loc || isCrossingLocation(loc))) {
			return;
		}

		if (loc) {
			// Einzelner Wegpunkt -> waypoint.webp; letzter (Ziel) -> pin.webp.
			const isDestination = index === routeNames.length - 1;
			const markerEntry = typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(name) : null;
			const node = L.marker(loc.coordinates, {
				icon: isDestination ? icons.pin : icons.waypoint,
				interactive: true,
				keyboard: false,
				zIndexOffset: 600,
			}).addTo(map);
			// Hover-Infobox nur, wenn der Wegpunkt ein geladener Ort ist (Kreuzungen bleiben ohne Popup).
			if (markerEntry) {
				bindWaypointHoverPopup(node, markerEntry);
			}
			highlightedRouteNodes.push(node);
		} else {
			console.warn(`Location ${name} nicht gefunden.`);
		}
	});
}

function removeHighlightedRouteNodes() {
	$.each(highlightedRouteNodes, (i, node) => map.removeLayer(node));
	highlightedRouteNodes = [];
	console.log("Alle Routen-Knoten entfernt.");
}

function updateRouteKeepingCurrentMapView() {
	const previousCenter = map.getCenter();
	const previousZoom = map.getZoom();
	const routeUpdate = updateMapView();
	Promise.resolve(routeUpdate).finally(() => {
		map.setView(previousCenter, previousZoom, { animate: false });
	});
}

function refreshPlannerAfterFeatureChange({ updateRoute = false } = {}) {
	graphData = null;
	refreshWaypointAutocompleteSources();
	syncPlannerStateToUrl();

	if (updateRoute && getWaypointInputValues().length) {
		updateRouteKeepingCurrentMapView();
	}
}
