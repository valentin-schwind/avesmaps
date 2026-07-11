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

// Wegpunkt-Markierung: NUR die echten, vom Nutzer gesetzten Wegpunkte (selectedLocations) bekommen einen
// dezenten Punkt -- NICHT jede Kreuzung/jeder Durchgangsort der berechneten Route (Bug #10). Die
// waypoint.webp/pin.webp-Grafik (fbb5565b) ist wieder raus (Owner: renderte falsch + unruhige Optik);
// zurueck zum schlichten circleMarker (ROUTE_NODE_STYLE) wie vor dem Icon-Feature. selectedLocations ist
// an allen Aufrufstellen direkt zuvor via collectAndValidateSelectedLocations gefuellt (unveraendert bis
// hierher); routeNames/segments bleiben in der Signatur (feste Aufrufer-Kette), steuern die Markierung
// aber nicht mehr (die komplette Knotenliste enthaelt Kreuzungen + Duplikate).
function highlightRouteLocations(routeNames, segments = []) {
	removeHighlightedRouteNodes();
	const waypoints = Array.isArray(selectedLocations) ? selectedLocations : [];
	waypoints.forEach((waypoint) => {
		if (!waypoint || !waypoint.coordinates) {
			return;
		}
		const node = L.circleMarker(waypoint.coordinates, ROUTE_NODE_STYLE).addTo(map);
		highlightedRouteNodes.push(node);
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
