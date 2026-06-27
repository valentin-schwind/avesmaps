// Region split/move editing interactions (pending-operation state machine: start/
// cancel/complete split & move, cutter geometry, clipping-area helpers). Split out
// of map-features.js (M5 god-file split). Plain classic script: global functions
// called at runtime; shared map-features state is referenced cross-script. Edit-mode
// only (not exercised in the public view path).

function startPendingRegionOperation(operation, sourceRegion, sourceLayer = null) {
	if (sourceRegion.source !== "political_territory") {
		showFeedbackToast("Geometrieoperationen sind für das neue Herrschaftsgebiete-Modell aktiv.", "warning");
		return;
	}

	cancelPendingRegionOperation();
	pendingRegionOperation = { operation, sourceRegion, sourceLayer: sourceLayer || sourceRegion.layer || null };
	clearRegionGeometryEdit();
	syncRegionOperationChip();
	showFeedbackToast("Nächstes Herrschaftsgebiet anklicken.", "info");
}

function startPendingRegionSplit(sourceRegion, sourceLayer = null) {
	if (sourceRegion.source !== "political_territory") {
		showFeedbackToast("Gebiete zerschneiden ist für das neue Herrschaftsgebiete-Modell aktiv.", "warning");
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
		showFeedbackToast("Verschieben ist für das neue Herrschaftsgebiete-Modell aktiv.", "warning");
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

// calculateClippingPolygonArea / calculateClippingRingArea live in map-features-region-geometry-helpers.js
// (loaded later in index.html, byte-identical impl, wins at runtime); not redefined here.
