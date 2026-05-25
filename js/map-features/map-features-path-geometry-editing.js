function pathCoordinatesToLatLngs(path) {
	return path.geometry.coordinates.map(([x, y]) => L.latLng(y, x));
}

function latLngsToPathCoordinates(latLngs) {
	return latLngs.map((latLng) => [latLng.lng, latLng.lat]);
}

function createPathEditHandleIcon() {
	return L.divIcon({
		className: "path-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function clearPathGeometryEdit() {
	if (!activePathGeometryEdit) {
		return;
	}

	void releaseFeatureSoftLock(getPathPublicId(activePathGeometryEdit.path));
	activePathGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	map.off("dblclick", handleMapDoubleClickWhileEditingPath);
	map.doubleClickZoom.enable();
	activePathGeometryEdit = null;
}

function getActivePathLatLngs() {
	return activePathGeometryEdit?.path ? pathCoordinatesToLatLngs(activePathGeometryEdit.path) : [];
}

function setActivePathLatLngs(latLngs) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	activePathGeometryEdit.path.geometry.coordinates = latLngsToPathCoordinates(latLngs);
	updatePathLayerGeometry(activePathGeometryEdit.path);
}

function refreshPathEditHandles() {
	if (!activePathGeometryEdit) {
		return;
	}

	activePathGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activePathGeometryEdit.handles = [];

	getActivePathLatLngs().forEach((latLng, index) => {
		const handle = L.marker(latLng, {
			icon: createPathEditHandleIcon(),
			pane: "measurementHandlesPane",
			draggable: true,
			keyboard: false,
		}).addTo(map);
		handle._pathNodeIndex = index;
		handle.on("dragstart", (event) => {
			event.target._pathNodeOriginalLatLng = event.target.getLatLng();
		});
		handle.on("drag", (event) => {
			const latLngs = getActivePathLatLngs();
			latLngs[index] = event.target.getLatLng();
			setActivePathLatLngs(latLngs);
		});
		handle.on("dragend", (event) => {
			void finishPathNodeDrag(index, event.target);
		});
		handle.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			deleteActivePathNode(index);
		});
		handle.on("contextmenu", (event) => {
			L.DomEvent.stop(event);
			preparePathSplitContextMenu(index, handle.getLatLng(), event.originalEvent);
		});
		activePathGeometryEdit.handles.push(handle);
	});
}

function preparePathSplitContextMenu(nodeIndex, latlng, originalEvent = null) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const latLngs = getActivePathLatLngs();
	if (nodeIndex <= 0 || nodeIndex >= latLngs.length - 1) {
		showFeedbackToast("Nur Zwischenknoten koennen einen Weg teilen.", "warning");
		return;
	}

	pendingPathSplit = {
		path: activePathGeometryEdit.path,
		nodeIndex,
		latlng: L.latLng(latlng),
	};
	openMapContextMenu(
		latlng,
		originalEvent?.clientX ?? 0,
		originalEvent?.clientY ?? 0
	);
}

function getPathSplitCoordinateGroups(path, nodeIndex) {
	const latLngs = activePathGeometryEdit?.path === path ? getActivePathLatLngs() : pathCoordinatesToLatLngs(path);
	if (nodeIndex <= 0 || nodeIndex >= latLngs.length - 1) {
		return null;
	}

	return {
		firstCoordinates: latLngs.slice(0, nodeIndex + 1).map((latLng) => [latLng.lat, latLng.lng]),
		secondCoordinates: latLngs.slice(nodeIndex).map((latLng) => [latLng.lat, latLng.lng]),
		splitLatLng: L.latLng(latLngs[nodeIndex]),
	};
}

async function splitPathAtNode(splitState) {
	const path = splitState?.path;
	if (!path || !pathData.includes(path)) {
		showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
		return;
	}

	const coordinateGroups = getPathSplitCoordinateGroups(path, splitState.nodeIndex);
	if (!coordinateGroups) {
		showFeedbackToast("Dieser Knoten kann den Weg nicht teilen.", "warning");
		return;
	}

	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	try {
		const crossingResult = await createCrossingFeatureAt(coordinateGroups.splitLatLng);
		addCreatedCrossingMarker(crossingResult.feature);
		ensureCrossingsEnabled();

		const firstPathResult = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: pathSubtype,
			name: getNextPathDisplayName(pathSubtype),
			coordinates: coordinateGroups.firstCoordinates,
		});
		addCreatedPathFeature(firstPathResult.feature);

		const secondPathResult = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: pathSubtype,
			name: getNextPathDisplayName(pathSubtype),
			coordinates: coordinateGroups.secondCoordinates,
		});
		addCreatedPathFeature(secondPathResult.feature);

		const deleteResult = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPathPublicId(path),
		});
		clearPathGeometryEdit();
		removePathFeature(path);
		updateRevisionFromEditResponse(deleteResult);
		showFeedbackToast("Weg geteilt und Kreuzung erstellt.", "success");
	} catch (error) {
		console.error("Weg konnte nicht geteilt werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht geteilt werden.", "warning");
	}
}

async function finishPathNodeDrag(index, handle) {
	const latLngs = getActivePathLatLngs();
	const isEndpoint = index === 0 || index === latLngs.length - 1;
	if (!isEndpoint) {
		await saveActivePathGeometry();
		return;
	}

	const otherEndpointIndex = index === 0 ? latLngs.length - 1 : 0;
	const otherEndpointLocation = findNearestGraphEndpointToLatLng(latLngs[otherEndpointIndex]);
	const snappedEndpoint = findNearestGraphEndpointToLatLng(handle.getLatLng(), {
		excludeLocation: otherEndpointLocation,
	});
	if (!snappedEndpoint) {
		latLngs[index] = handle._pathNodeOriginalLatLng || latLngs[index];
		setActivePathLatLngs(latLngs);
		refreshPathEditHandles();
		showFeedbackToast("Endpunkte muessen auf Orte oder Kreuzungen einrasten.", "warning");
		return;
	}

	latLngs[index] = L.latLng(snappedEndpoint.coordinates);
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	await saveActivePathGeometry();
}

function findNearestSegmentInsertIndex(path, latlng) {
	const latLngs = pathCoordinatesToLatLngs(path);
	if (latLngs.length < 2) {
		return latLngs.length;
	}

	const targetPoint = map.latLngToLayerPoint(latlng);
	let bestIndex = 1;
	let bestDistance = Infinity;

	for (let index = 0; index < latLngs.length - 1; index++) {
		const startPoint = map.latLngToLayerPoint(latLngs[index]);
		const endPoint = map.latLngToLayerPoint(latLngs[index + 1]);
		const segmentLengthSquared = startPoint.distanceTo(endPoint) ** 2;
		let ratio = 0;
		if (segmentLengthSquared > 0) {
			ratio = ((targetPoint.x - startPoint.x) * (endPoint.x - startPoint.x) + (targetPoint.y - startPoint.y) * (endPoint.y - startPoint.y)) / segmentLengthSquared;
			ratio = Math.max(0, Math.min(1, ratio));
		}
		const projectedPoint = L.point(
			startPoint.x + ratio * (endPoint.x - startPoint.x),
			startPoint.y + ratio * (endPoint.y - startPoint.y)
		);
		const distance = targetPoint.distanceTo(projectedPoint);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index + 1;
		}
	}

	return bestIndex;
}

function insertActivePathNode(latlng) {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const latLngs = getActivePathLatLngs();
	const insertIndex = findNearestSegmentInsertIndex(activePathGeometryEdit.path, latlng);
	latLngs.splice(insertIndex, 0, L.latLng(latlng));
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	void saveActivePathGeometry();
}

function deleteActivePathNode(index) {
	const latLngs = getActivePathLatLngs();
	if (latLngs.length <= 2 || index === 0 || index === latLngs.length - 1) {
		showFeedbackToast("Start- und Endknoten bleiben erhalten.", "warning");
		return;
	}

	latLngs.splice(index, 1);
	setActivePathLatLngs(latLngs);
	refreshPathEditHandles();
	void saveActivePathGeometry();
}

function handleEditablePathDoubleClick(path, event) {
	L.DomEvent.stop(event);
	if (!activePathGeometryEdit || activePathGeometryEdit.path !== path) {
		startPathGeometryEdit(path, { showToast: false });
	}

	insertActivePathNode(event.latlng);
}

function handleMapDoubleClickWhileEditingPath(event) {
	if (event.originalEvent?.target?.closest?.(".path-edit-handle-marker")) {
		return;
	}

	clearPathGeometryEdit();
	showFeedbackToast("Wegverlauf-Bearbeitung beendet.", "success");
}

async function saveActivePathGeometry() {
	if (!activePathGeometryEdit?.path) {
		return;
	}

	const path = activePathGeometryEdit.path;
	try {
		const result = await submitMapFeatureEdit({
			action: "update_path_geometry",
			public_id: getPathPublicId(path),
			coordinates: path.geometry.coordinates.map(([x, y]) => [y, x]),
		});
		applyPathFeatureResponse(path, result.feature);
		updateRevisionFromEditResponse(result);
	} catch (error) {
		console.error("Wegverlauf konnte nicht gespeichert werden:", error);
		showFeedbackToast(error.message || "Wegverlauf konnte nicht gespeichert werden.", "warning");
	}
}

function startPathGeometryEdit(path, { showToast = true } = {}) {
	clearPendingPathCreation();
	clearPathGeometryEdit();
	void acquireFeatureSoftLock(getPathPublicId(path));
	path._layerGroup?.closePopup();
	activePathGeometryEdit = {
		path,
		handles: [],
	};
	map.doubleClickZoom.disable();
	refreshPathEditHandles();
	map.on("dblclick", handleMapDoubleClickWhileEditingPath);
	if (showToast) {
		showFeedbackToast("Knoten ziehen. Doppelklick Linie fuegt Knoten hinzu, Doppelklick Knoten loescht ihn.", "info");
	}
}
