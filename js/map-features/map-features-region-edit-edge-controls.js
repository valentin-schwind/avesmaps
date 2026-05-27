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

	activeRegionGeometryEdit.editRingIndex = edge.ringIndex;
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
	const rings = getPolygonLatLngRings(activeRegionGeometryEdit?.editLayer || regionEntry.layer);
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;

	rings.forEach((ring, ringIndex) => {
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
					ringIndex,
					index,
					start,
					end,
					distance,
					projectedLatLng: map.containerPointToLatLng(projectedPoint),
				};
			}
		}
	});

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
	const ringIndex = Number.isInteger(edge.ringIndex) ? edge.ringIndex : getRegionEditRingIndex(regionEntry, 0);
	const latLngs = getRegionOuterLatLngs(regionEntry, ringIndex).map(latLng => L.latLng(latLng));

	if (latLngs.length < 3 || edge.index < 0 || edge.index >= latLngs.length) {
		return;
	}

	activeRegionGeometryEdit.editRingIndex = ringIndex;
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

	setRegionOuterLatLngs(regionEntry, latLngs, ringIndex);
	updateRegionLabelPosition(regionEntry);
	refreshRegionEditHandles();
	clearRegionEditEdgeHover();

	void saveRegionGeometry(regionEntry);
}
