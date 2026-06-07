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

function highlightRouteLocations(routeNames, segments = []) {
	removeHighlightedRouteNodes();
	routeNames.forEach((name, index) => {
		const previousIsSea = normalizePathSubtype(segments[index - 1]?.properties?.feature_subtype || segments[index - 1]?.properties?.name) === "Seeweg";
		const nextIsSea = normalizePathSubtype(segments[index]?.properties?.feature_subtype || segments[index]?.properties?.name) === "Seeweg";
		const loc = resolveRouteNodeLocation(name, index, routeNames, segments);
		if ((previousIsSea || nextIsSea) && (!loc || isCrossingLocation(loc))) {
			return;
		}

		if (loc) {
			const node = L.circleMarker(loc.coordinates, ROUTE_NODE_STYLE).addTo(map);
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
