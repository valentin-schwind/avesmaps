function clearPendingPathCreation() {
	clearPendingPowerlineCreation();
	if (pendingPathCreationPreview) {
		map.removeLayer(pendingPathCreationPreview);
		pendingPathCreationPreview = null;
	}

	if (pendingPathCreationLine) {
		map.removeLayer(pendingPathCreationLine);
		pendingPathCreationLine = null;
	}

	pendingPathCreationStart = null;
	pendingPathCreationPoints = [];
	map.off("click", handlePendingPathCreationClick);
	map.getContainer().classList.remove("path-creation-cursor");
	refreshAllLocationMarkerPopups();
}

function showPendingPathCreationPreview(startLocation) {
	if (pendingPathCreationPreview) {
		map.removeLayer(pendingPathCreationPreview);
	}

	pendingPathCreationPreview = L.circleMarker(startLocation.coordinates, {
		pane: "measurementHandlesPane",
		radius: 10,
		color: "#1452F7",
		weight: 3,
		fillColor: "#FFFFFF",
		fillOpacity: 0.9,
		interactive: false,
	}).addTo(map);
}

function updatePendingPathCreationLine() {
	if (pendingPathCreationLine) {
		map.removeLayer(pendingPathCreationLine);
		pendingPathCreationLine = null;
	}

	if (pendingPathCreationPoints.length < 2) {
		return;
	}

	pendingPathCreationLine = L.polyline(getVisualLatLngCoordinates(pendingPathCreationPoints), {
		pane: "measurementPane",
		color: "#1452F7",
		weight: 5,
		opacity: 0.9,
		dashArray: "8 8",
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	}).addTo(map);
}

function startPathCreationAt(latlng) {
	const nearestMatch = findNearestGraphNodeToLatLng(L.latLng(latlng));
	if (!nearestMatch.location) {
		showFeedbackToast("Kein Startknoten gefunden.", "warning");
		return;
	}

	clearPendingPathCreation();
	pendingPathCreationStart = nearestMatch.location;
	pendingPathCreationPoints = [L.latLng(pendingPathCreationStart.coordinates)];
	showPendingPathCreationPreview(pendingPathCreationStart);
	map.getContainer().classList.add("path-creation-cursor");
	refreshAllLocationMarkerPopups();
	map.on("click", handlePendingPathCreationClick);
	showFeedbackToast(`Start: ${pendingPathCreationStart.name}. Punkte setzen, Ort verbinden oder mit Weg abschliessen beenden.`, "info");
}

function startPathCreationFromLocation(location) {
	if (!location) {
		showFeedbackToast("Kein Startknoten gefunden.", "warning");
		return;
	}

	clearPendingPathCreation();
	pendingPathCreationStart = location;
	pendingPathCreationPoints = [L.latLng(location.coordinates)];
	showPendingPathCreationPreview(location);
	map.getContainer().classList.add("path-creation-cursor");
	refreshAllLocationMarkerPopups();
	map.on("click", handlePendingPathCreationClick);
	showFeedbackToast(`Start: ${location.name}. Punkte setzen, Ort verbinden oder mit Weg abschliessen beenden.`, "info");
}

function appendPendingPathCreationLocation(location) {
	if (!pendingPathCreationStart || !location) {
		return false;
	}

	const nextPoint = L.latLng(location.coordinates);
	const lastPoint = pendingPathCreationPoints.at(-1);
	if (!lastPoint || !lastPoint.equals(nextPoint)) {
		pendingPathCreationPoints.push(nextPoint);
		updatePendingPathCreationLine();
	}

	return true;
}

async function extendPendingPathCreationAtLocation(location) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	if (!location) {
		showFeedbackToast("Kein Zielknoten gefunden.", "warning");
		return;
	}

	appendPendingPathCreationLocation(location);
	showFeedbackToast(`Ort verbunden: ${location.name}. Weg kann weitergeführt werden.`, "success");
}

async function completePendingPathCreationAtLocation(endLocation) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	if (!endLocation) {
		showFeedbackToast("Kein Zielknoten gefunden.", "warning");
		return;
	}

	if (endLocation === pendingPathCreationStart) {
		showFeedbackToast("Start und Ziel sind identisch.", "warning");
		return;
	}

	const startLocation = pendingPathCreationStart;
	appendPendingPathCreationLocation(endLocation);
	const pathCoordinates = pendingPathCreationPoints.map((latLng) => [latLng.lat, latLng.lng]);
	clearPendingPathCreation();

	try {
		const result = await submitMapFeatureEdit({
			action: "create_path",
			feature_subtype: "Weg",
			name: getNextPathDisplayName("Weg"),
			coordinates: pathCoordinates,
		});
		const createdPath = addCreatedPathFeature(result.feature);
		updateRevisionFromEditResponse(result);
		openPathEditDialog(createdPath, { inheritLastSettings: true });
		showFeedbackToast(`Weg ${startLocation.name} -> ${endLocation.name} erstellt.`, "success");
	} catch (error) {
		console.error("Weg konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht erstellt werden.", "warning");
	}
}

async function handlePendingPathCreationClick(event) {
	if (!pendingPathCreationStart) {
		clearPendingPathCreation();
		return;
	}

	const endLocation = findNearestGraphEndpointToLatLng(event.latlng, {
		excludeLocation: pendingPathCreationStart,
	});
	if (endLocation) {
		await completePendingPathCreationAtLocation(endLocation);
		return;
	}

	pendingPathCreationPoints.push(L.latLng(event.latlng));
	updatePendingPathCreationLine();
}
