function getPowerlineLatLngs(powerline) {
	const fromEntry = findLocationMarkerByPublicId(powerline.properties?.from_public_id);
	const toEntry = findLocationMarkerByPublicId(powerline.properties?.to_public_id);
	if (fromEntry && toEntry) {
		return [fromEntry.marker.getLatLng(), toEntry.marker.getLatLng()];
	}
	return powerline.geometry.coordinates.map(([x, y]) => L.latLng(y, x));
}

function getPowerlinePublicId(powerline) {
	return powerline?.properties?.public_id || powerline?.id || "";
}

function getPowerlineDisplayName(powerline) {
	return String(powerline?.properties?.name || "Kraftlinie").trim() || "Kraftlinie";
}

function createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds = 0) {
	if (latLngs.length < 2) {
		return latLngs;
	}

	const start = latLngs[0];
	const end = latLngs[latLngs.length - 1];
	const dx = end.lng - start.lng;
	const dy = end.lat - start.lat;
	const length = Math.sqrt(dx * dx + dy * dy) || 1;
	const tx = dx / length;
	const ty = dy / length;
	const nx = -ty;
	const ny = tx;
	const segmentCount = Math.max(2, Math.round(POWERLINE_RENDER_CONFIG.segmentCount));
	const phase = strandIndex * POWERLINE_RENDER_CONFIG.phaseStep;
	const normalScale = POWERLINE_RENDER_CONFIG.normalScales[strandIndex % POWERLINE_RENDER_CONFIG.normalScales.length];
	const waveOffset = POWERLINE_RENDER_CONFIG.waveOffsets[strandIndex % POWERLINE_RENDER_CONFIG.waveOffsets.length];
	const points = [];

	for (let index = 0; index <= segmentCount; index++) {
		const t = index / segmentCount;
		const envelope = Math.sin(Math.PI * t);
		const normalWave = Math.sin(index * 0.62 + phase) * envelope * 4.5;
		const tangentWave = Math.sin(index * 1.17 + phase) * envelope * 0.8;
		const tremorWave = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorNormalSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorNormalFrequency
			+ phase * POWERLINE_RENDER_CONFIG.tremorPhaseMultiplier
		) * envelope * POWERLINE_RENDER_CONFIG.tremorNormalAmplitude;
		const tremorTangent = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorTangentSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorTangentFrequency
			+ phase
		) * envelope * POWERLINE_RENDER_CONFIG.tremorTangentAmplitude;
		const normalOffset = (normalWave + tremorWave + waveOffset * envelope) * normalScale;

		points.push(L.latLng(
			start.lat + dy * t + ny * normalOffset + ty * (tangentWave + tremorTangent),
			start.lng + dx * t + nx * normalOffset + tx * (tangentWave + tremorTangent)
		));
	}

	return points;
}

function getPowerlineRenderStyles() {
	const styles = [];

	for (let strikeIndex = 0; strikeIndex < POWERLINE_RENDER_CONFIG.strandCount; strikeIndex++) {
		styles.push(
			{
				className: `powerline powerline--aura powerline--strike-${strikeIndex + 1}`,
				weight: 10,
				opacity: 0.34,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--mid powerline--strike-${strikeIndex + 1}`,
				weight: 4.6,
				opacity: 0.72,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--core powerline--strike-${strikeIndex + 1}`,
				weight: 1.5,
				opacity: 0.98,
				strandIndex: strikeIndex,
			}
		);
	}

	return styles;
}

function shouldPowerlineNameBeDisplayed(powerline) {
	return powerline?.properties?.show_label === true || powerline?.properties?.show_label === 1 || powerline?.properties?.show_label === "1";
}

function isPowerlineLabelVisibleAtCurrentZoom(powerline) {
	return shouldPowerlineNameBeDisplayed(powerline) && map.getZoom() >= 2;
}

function getPowerlineLabelStyle() {
	return {
		fill: "rgba(255, 196, 214, 0.98)",
		stroke: "transparent",
		strokeWidth: "0",
		paintOrder: "fill",
		fontFamily: 'Georgia, "Times New Roman", serif',
		fontSize: `${Math.max(18, getLocationNameLabelSize("dorf") + 7)}px`,
		fontWeight: "500",
		letterSpacing: "0",
	};
}

function getReadablePowerlineLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}

function refreshPowerlineLayerText(powerline) {
	const labelLine = powerline?._labelLine;
	if (!labelLine?.setText) {
		return;
	}

	if (!isPowerlineLabelVisibleAtCurrentZoom(powerline)) {
		labelLine.removeText?.();
		return;
	}

	labelLine.setText(getPowerlineDisplayName(powerline), {
		className: "path-name-text path-name-text--powerline",
		offset: "50%",
		textAnchor: "middle",
		dy: "-10",
		style: getPowerlineLabelStyle(),
	});
}

function syncPowerlineLabels() {
	powerlineData.forEach(refreshPowerlineLayerText);
}

function createPowerlinePopupMarkup(powerline) {
	return locationPopupMarkup({
		name: getPowerlineDisplayName(powerline),
		locationType: "dorf",
		locationTypeLabel: "Kraftlinie",
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Details bearbeiten",
				attributes: {
					"data-popup-action": "edit-powerline-details",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
			popupActionButtonMarkup({
				label: "Kraftlinie löschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-powerline",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
		]) : "",
	});
}

function refreshPowerlineLayerPopup(powerline) {
	const popupMarkup = createPowerlinePopupMarkup(powerline);
	powerline._interactiveLines?.forEach((line) => line.bindPopup(popupMarkup));
}

function createPowerlineLayer(powerline) {
	const latLngs = getPowerlineLatLngs(powerline);
	const labelLine = L.polyline(getReadablePowerlineLabelLatLngCoordinates(latLngs), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const layers = [labelLine];
	const interactiveLines = [];
	getPowerlineRenderStyles().forEach(({ strandIndex, ...style }) => {
		const layer = L.polyline(createPowerlineStrandLatLngs(latLngs, strandIndex, powerlineAnimationTimeSeconds), {
			pane: "powerlinesPane",
			color: "#ff5f82",
			lineCap: "round",
			lineJoin: "round",
			interactive: style.className.includes("powerline--core"),
			...style,
		});
		layer._powerlineStrandIndex = strandIndex;
		layers.push(layer);
		if (layer.options.interactive) {
			interactiveLines.push(layer);
		}
	});
	const group = L.layerGroup(layers);
	powerline._layerGroup = group;
	powerline._labelLine = labelLine;
	powerline._interactiveLines = interactiveLines;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayerText(powerline);
	return group;
}

function normalizePowerlineFeature(feature) {
	const properties = feature.properties || {};
	return {
		id: feature.id || properties.public_id || "",
		geometry: feature.geometry,
		properties,
	};
}

function syncPowerlineVisibility() {
	const showPowerlines = getSelectedMapLayerMode() === "powerlines";
	powerlineLayers.forEach((layer) => map[showPowerlines ? "addLayer" : "removeLayer"](layer));
	if (showPowerlines) {
		ensurePowerlineAnimationLoop();
	} else {
		stopPowerlineAnimationLoop();
	}
}

function refreshPowerlineLayers(timeSeconds = powerlineAnimationTimeSeconds) {
	powerlineData.forEach((powerline) => {
		if (!powerline._layerGroup) {
			return;
		}
		const latLngs = getPowerlineLatLngs(powerline);
		powerline._layerGroup.eachLayer((layer) => {
			if (layer === powerline._labelLine) {
				layer.setLatLngs?.(getReadablePowerlineLabelLatLngCoordinates(latLngs));
				return;
			}
			const strandIndex = layer._powerlineStrandIndex || 0;
			layer.setLatLngs?.(createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds));
		});
		refreshPowerlineLayerText(powerline);
	});
}

function stopPowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null) {
		window.cancelAnimationFrame(powerlineAnimationFrameId);
		powerlineAnimationFrameId = null;
	}
	powerlineAnimationLastFrameMs = 0;
}

function shouldAnimatePowerlines() {
	return POWERLINE_RENDER_CONFIG.animationEnabled
		&& getSelectedMapLayerMode() === "powerlines"
		&& powerlineData.length > 0
		&& document.visibilityState === "visible";
}

function tickPowerlineAnimation(frameTimeMs) {
	if (!shouldAnimatePowerlines()) {
		stopPowerlineAnimationLoop();
		return;
	}

	if (powerlineAnimationLastFrameMs === 0) {
		powerlineAnimationLastFrameMs = frameTimeMs;
	}

	const elapsedMs = frameTimeMs - powerlineAnimationLastFrameMs;
	if (elapsedMs >= POWERLINE_RENDER_CONFIG.frameIntervalMs) {
		powerlineAnimationTimeSeconds += Math.min(elapsedMs, 120) / 1000;
		powerlineAnimationLastFrameMs = frameTimeMs;
		refreshPowerlineLayers(powerlineAnimationTimeSeconds);
	}

	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

function ensurePowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null || !shouldAnimatePowerlines()) {
		return;
	}
	powerlineAnimationLastFrameMs = 0;
	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

const preparePowerlineData = (data) => {
	powerlineLayers.forEach((layer) => map.removeLayer(layer));
	powerlineLayers = [];
	powerlineData = data.features
		.filter((feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type === "powerline")
		.map(normalizePowerlineFeature);
	powerlineData.forEach((powerline) => {
		const layer = createPowerlineLayer(powerline);
		powerlineLayers.push(layer);
	});
	syncPowerlineVisibility();
};

function applyLivePowerlineFeature(feature) {
	const publicId = feature.id || feature.properties?.public_id || "";
	const existingPowerline = findPowerlineByPublicId(publicId);
	if (existingPowerline?._layerGroup) {
		map.removeLayer(existingPowerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== existingPowerline._layerGroup);
		powerlineData = powerlineData.filter((powerline) => powerline !== existingPowerline);
	}
	const powerline = normalizePowerlineFeature(feature);
	const layer = createPowerlineLayer(powerline);
	powerlineData.push(powerline);
	powerlineLayers.push(layer);
	syncPowerlineVisibility();
}

function findPowerlineByPublicId(publicId) {
	return powerlineData.find((powerline) => (powerline.id || powerline.properties?.public_id) === publicId) || null;
}

function getConnectedPowerlinesForPublicId(publicId) {
	return powerlineData.filter((powerline) => powerline.properties?.from_public_id === publicId || powerline.properties?.to_public_id === publicId);
}

function applyPowerlineFeatureResponse(powerline, feature) {
	const updatedPowerline = normalizePowerlineFeature(feature);
	powerline.geometry = updatedPowerline.geometry;
	powerline.properties = updatedPowerline.properties;
	powerline.id = updatedPowerline.id;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayers();
}

function clearPendingPowerlineCreation() {
	pendingPowerlineCreationStart = null;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
}

function startPowerlineCreationFromEndpoint(endpoint) {
	if (!isEligiblePowerlineEndpoint(endpoint)) {
		showFeedbackToast("Kraftlinien können nur an Nodix-Orten starten.", "warning");
		return;
	}
	pendingPowerlineCreationStart = endpoint;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
	showFeedbackToast(`Start-Nodix: ${endpoint.name}. Ziel-Nodix anklicken.`, "info");
}

async function completePendingPowerlineAtEndpoint(endEndpoint) {
	const startEndpoint = pendingPowerlineCreationStart;
	if (!startEndpoint || !isEligiblePowerlineEndpoint(endEndpoint) || startEndpoint.publicId === endEndpoint.publicId) {
		showFeedbackToast("Bitte zwei verschiedene Nodix-Orte verbinden.", "warning");
		return;
	}
	clearPendingPowerlineCreation();
	try {
		const result = await submitMapFeatureEdit({
			action: "create_powerline",
			from_public_id: startEndpoint.publicId,
			to_public_id: endEndpoint.publicId,
		});
		applyLivePowerlineFeature(result.feature);
		updateRevisionFromEditResponse(result);
		setSelectedMapLayerMode("powerlines");
		syncPowerlineVisibility();
		showFeedbackToast(`Kraftlinie ${startEndpoint.name} -> ${endEndpoint.name} erstellt.`, "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht erstellt werden.", "warning");
	}
}

async function deletePowerlineFeature(powerline) {
	if (!powerline) {
		return;
	}

	if (!window.confirm(`${getPowerlineDisplayName(powerline)} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPowerlinePublicId(powerline),
		});
		map.removeLayer(powerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== powerline._layerGroup);
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gelöscht.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht gelöscht werden.", "warning");
	}
}
