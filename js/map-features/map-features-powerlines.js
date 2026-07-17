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
		// "Störung": zwei überlagerte, hochfrequente + schnelle Sinus quer zur Linie -> flackernder Interferenz-Look.
		const interferenceSpeed = POWERLINE_RENDER_CONFIG.interferenceSpeed || 0;
		const interference = (
			Math.sin(index * 2.6 + timeSeconds * interferenceSpeed + phase * 3.3)
			+ 0.6 * Math.sin(index * 4.1 - timeSeconds * interferenceSpeed * 1.7 + phase)
		) * envelope * (POWERLINE_RENDER_CONFIG.interferenceAmplitude || 0);
		const normalOffset = (normalWave + tremorWave + interference + waveOffset * envelope) * normalScale;

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
		fontFamily: '"Faculty Glyphic", Georgia, "Times New Roman", serif',
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

	if (typeof PATH_LABELS_ON_CANVAS !== "undefined" && PATH_LABELS_ON_CANVAS) {
		// Kraftlinien-Namen zeichnet das Canvas-Overlay -> hier nur einen evtl. alten SVG-Text entfernen.
		labelLine.removeText?.();
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
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}

function createPowerlinePopupMarkup(powerline) {
	return locationPopupMarkup({
		name: getPowerlineDisplayName(powerline),
		locationType: "dorf",
		locationTypeLabel: tr("spotlight.type.powerline", "Kraftlinie"),
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Bearbeiten",
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
	// Ohne Optionen erbte die Box den 260px-Deckel aus .location-popup und KEINE Kachel-Optik -- die
	// Editor-Aktionen fielen darin untereinander. Gleiche Huelle wie jede andere schwebende Box:
	// "settlement-popup" loest die Breite auf 400px, "floating-location-popup" gibt die Kacheln.
	const options = {
		minWidth: 320,
		maxWidth: 400,
		className: (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE)
			? "settlement-popup floating-location-popup"
			: "settlement-popup",
	};
	powerline._interactiveLines?.forEach((line) => line.bindPopup(popupMarkup, options));
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
	// Breite, unsichtbare Hit-Linie auf der Basisgeometrie: die sichtbaren Straenge sind nur 1,5px
	// breit und wabern animiert -> kaum treffbar (Forum-Feedback). Die Hit-Linie faengt Klicks
	// stabil entlang der ganzen Linie ein; die Kern-Straenge bleiben zusaetzlich interaktiv.
	const hitLine = L.polyline(latLngs, {
		pane: "powerlinesPane",
		className: "powerline powerline--hit",
		color: "#000",
		opacity: 0,
		weight: 22,
		interactive: true,
		lineCap: "round",
		lineJoin: "round",
	});
	hitLine._powerlineHitLine = true;
	const layers = [labelLine, hitLine];
	const interactiveLines = [hitLine];
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
	// Kraftlinien-Namen auf dem Canvas-Overlay neu zeichnen (Moduswechsel blendet sie ein/aus).
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
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
			if (layer._powerlineHitLine) {
				layer.setLatLngs?.(latLngs);
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
		powerlineAnimationLastFrameMs = frameTimeMs;
		// Waehrend Leaflets CSS-Zoom-Animation (Buttons/Scroll/Pinch) die Strang-Geometrie NICHT neu setzen:
		// setLatLngs projiziert sonst jeden Frame auf den noch alten Zoom und ueberschreibt die Zoom-Transform
		// der SVG-Polylinien -> die Linien bleiben stehen und "poppen" erst am zoomend ans Ziel. map._animatingZoom
		// markiert genau dieses CSS-Zoom-Fenster; pausiert skalieren die Linien nativ mit (wie Wege/Grenzen) und
		// Leaflet re-projiziert am zoomend selbst. Bei flyTo/setView ist _animatingZoom false -> der Loop laeuft
		// normal weiter und folgt pro Frame der echten Projektion. lastFrameMs setzen wir trotzdem, damit nach
		// dem Zoom kein Zeit-Sprung im Puls entsteht.
		if (!map._animatingZoom) {
			powerlineAnimationTimeSeconds += Math.min(elapsedMs, 120) / 1000;
			refreshPowerlineLayers(powerlineAnimationTimeSeconds);
		}
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

function getPowerlineConnectedLocationPublicIds() {
	const publicIds = new Set();
	powerlineData.forEach((powerline) => {
		const fromPublicId = powerline.properties?.from_public_id;
		const toPublicId = powerline.properties?.to_public_id;
		if (fromPublicId) {
			publicIds.add(fromPublicId);
		}
		if (toPublicId) {
			publicIds.add(toPublicId);
		}
	});
	return publicIds;
}

function applyPowerlineFeatureResponse(powerline, feature) {
	const updatedPowerline = normalizePowerlineFeature(feature);
	powerline.geometry = updatedPowerline.geometry;
	powerline.properties = updatedPowerline.properties;
	powerline.id = updatedPowerline.id;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayers();
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
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
		locationConnectivityIndex = null;
		updateRevisionFromEditResponse(result);
		setSelectedMapLayerMode("powerlines");
		syncPowerlineVisibility();
		showFeedbackToast(`Kraftlinie ${startEndpoint.name} -> ${endEndpoint.name} erstellt.`, "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht erstellt werden.", "warning");
	}
}

// Live-Tuning der Kraftlinien-Animation ("Wabern"), nur mit ?powerlinetune=1 (oben rechts). Die rAF-Schleife
// liest POWERLINE_RENDER_CONFIG pro Frame -> Slider wirken sofort. Nur im Modus „Kraftlinien" sichtbar/aktiv.
// OK schreibt nach window.__avesmapsPowerlineTuning (zum Übernehmen als Default).
(function initPowerlineTuningPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("powerlinetune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const cfg = (typeof POWERLINE_RENDER_CONFIG !== "undefined") ? POWERLINE_RENDER_CONFIG : null;
	if (!cfg) return;
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;right:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:230px;";
	const title = document.createElement("div");
	title.textContent = "Kraftlinien-Wabern"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	// Checkbox: Animation an/aus
	const animLabel = document.createElement("label");
	animLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin:0 0 8px;cursor:pointer;";
	const animInput = document.createElement("input");
	animInput.type = "checkbox"; animInput.checked = !!cfg.animationEnabled;
	animInput.addEventListener("change", () => {
		cfg.animationEnabled = animInput.checked;
		try {
			if (animInput.checked) { if (typeof ensurePowerlineAnimationLoop === "function") ensurePowerlineAnimationLoop(); }
			else if (typeof stopPowerlineAnimationLoop === "function") { stopPowerlineAnimationLoop(); }
		} catch (e) { /* noop */ }
	});
	const animText = document.createElement("span"); animText.textContent = "Wabern an";
	animLabel.appendChild(animInput); animLabel.appendChild(animText);
	panel.appendChild(animLabel);
	const slider = (label, min, max, step, value, apply) => {
		const wrap = document.createElement("div"); wrap.style.marginBottom = "7px";
		const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
		const name = document.createElement("span"); name.textContent = label;
		const val = document.createElement("span"); val.textContent = value;
		head.appendChild(name); head.appendChild(val);
		const input = document.createElement("input");
		input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value; input.style.width = "100%";
		input.addEventListener("input", () => { val.textContent = input.value; apply(parseFloat(input.value)); });
		wrap.appendChild(head); wrap.appendChild(input);
		panel.appendChild(wrap);
	};
	slider("Amplitude (quer)", 0, 8, 0.1, cfg.tremorNormalAmplitude, (v) => { cfg.tremorNormalAmplitude = v; });
	slider("Tempo (quer)", 0, 2.5, 0.05, cfg.tremorNormalSpeed, (v) => { cfg.tremorNormalSpeed = v; });
	slider("Amplitude (längs)", 0, 3, 0.05, cfg.tremorTangentAmplitude, (v) => { cfg.tremorTangentAmplitude = v; });
	slider("Tempo (längs)", 0, 2.5, 0.05, cfg.tremorTangentSpeed, (v) => { cfg.tremorTangentSpeed = v; });
	slider("Frequenz (quer)", 0, 1.5, 0.01, cfg.tremorNormalFrequency, (v) => { cfg.tremorNormalFrequency = v; });
	slider("Störung Stärke", 0, 6, 0.1, cfg.interferenceAmplitude || 0, (v) => { cfg.interferenceAmplitude = v; });
	slider("Störung Tempo", 0, 8, 0.1, cfg.interferenceSpeed || 0, (v) => { cfg.interferenceSpeed = v; });
	slider("Segmente (Glätte)", 4, 24, 1, cfg.segmentCount, (v) => { cfg.segmentCount = v; });
	slider("Bildtakt (ms/Frame)", 12, 60, 1, cfg.frameIntervalMs, (v) => { cfg.frameIntervalMs = v; });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const result = {
			animationEnabled: cfg.animationEnabled,
			tremorNormalAmplitude: cfg.tremorNormalAmplitude,
			tremorNormalSpeed: cfg.tremorNormalSpeed,
			tremorTangentAmplitude: cfg.tremorTangentAmplitude,
			tremorTangentSpeed: cfg.tremorTangentSpeed,
			tremorNormalFrequency: cfg.tremorNormalFrequency,
			interferenceAmplitude: cfg.interferenceAmplitude,
			interferenceSpeed: cfg.interferenceSpeed,
			segmentCount: cfg.segmentCount,
			frameIntervalMs: cfg.frameIntervalMs,
		};
		window.__avesmapsPowerlineTuning = result;
		console.log("[Kraftlinien-Wabern] " + JSON.stringify(result));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Modus Kraftlinien wählen, damit die Animation läuft."; hint.style.cssText = "opacity:0.6;margin-top:6px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();

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
		locationConnectivityIndex = null;
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gelöscht.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht gelöscht werden.", "warning");
	}
}
