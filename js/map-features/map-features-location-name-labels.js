// Stärke des Halos/Schattens HINTER den Siedlungs-Labels (ersetzt den CSS text-shadow, den das Canvas nicht
// erbt). Live über das ?halotune=1-Panel (siehe Dateiende). 0 = aus, 1 = bisheriger Default, bis 5 = stärker
// (breiter + dichter, siehe getLabelHaloParams in map-features-labels.js).
let LOCATION_LABEL_HALO_STRENGTH = 1.5;
// Schärfe des Siedlungslabel-Halos (0 = weicher Schein, 1 = scharfe Kontur/Google-Maps-Look). Live über ?halotune=1.
let LOCATION_LABEL_HALO_SHARPNESS = 0.5;

const LOCATION_NAME_LABEL_SIZE_BY_ZOOM = {
	metropole: { 0: 8, 1: 9, 2: 11, 3: 13, 4: 17, 5: 19 },
	grossstadt: { 0: 8, 1: 8.5, 2: 10, 3: 12, 4: 15, 5: 17 },
	stadt: { 0: 8, 1: 8, 2: 9, 3: 11, 4: 13, 5: 15 },
	kleinstadt: { 0: 8, 1: 8, 2: 8.5, 3: 9.5, 4: 11, 5: 13 },
	dorf: { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 },
	gebaeude: { 0: 8, 1: 8, 2: 8, 3: 8, 4: 9, 5: 9 },
};

function getLocationNameLabelSize(locationType, zoomLevel = map.getZoom()) {
	const roundedZoomLevel = getVisualZoomLevel(zoomLevel);
	const sizeByZoom = LOCATION_NAME_LABEL_SIZE_BY_ZOOM[locationType] || LOCATION_NAME_LABEL_SIZE_BY_ZOOM.dorf;
	return Math.max(8, Number(sizeByZoom[roundedZoomLevel] ?? sizeByZoom[VISUAL_MAX_ZOOM_LEVEL] ?? sizeByZoom[4] ?? sizeByZoom[3] ?? sizeByZoom[2] ?? sizeByZoom[1] ?? sizeByZoom[0] ?? 8));
}

// Kleiner Abstand zwischen Marker-Aussenrand und Schrift (wird auf den Marker-Radius addiert).
const LOCATION_NAME_LABEL_GAP = 4;

function getLocationNameLabelOffset(labelSize, zoomLevel = map.getZoom(), locationType = "dorf") {
	// Schrift rechts NEBEN den Marker setzen: Aussenradius + fester Spalt -> respektiert die (variable) Markergroesse.
	const markerOuterRadius = getLocationMarkerSize(locationType, zoomLevel) / 2;
	const labelHeightInPixels = labelSize * 4 / 3;
	return {
		x: Math.round(markerOuterRadius + LOCATION_NAME_LABEL_GAP),
		y: -(Math.round(labelHeightInPixels * 0.531 * 10) / 10), // 0.531 statt 0.5: optisch beste Zentrierung -- Mixed-Case-Worte (Kleinbuchstaben) wirken tiefer als die reine Versalhoehe, daher Text minimal hoeher
	};
}

// visibilityContext (optional, siehe createLocationVisibilityContext): pro Sync-Lauf EINMAL erhobene
// Invarianten (Modus, Toggles) statt jQuery-Abfragen pro Label — ohne Kontext bleibt das alte Verhalten.
function shouldShowLocationNameLabel(entry, zoomLevel = map.getZoom(), visibilityContext = null) {
	if (activeMapStyle !== "stylized" || isCrossingLocation(entry.location)) {
		return false;
	}

	// Kraftlinien-Modus: nur die Nodices labeln (passend zu den leuchtenden Ley-Knoten), unabhängig von den
	// Stadt-Größen-Toggles. Kollisionsauflösung dünnt die Namen bei niedrigem Zoom aus.
	const mapLayerMode = visibilityContext
		? visibilityContext.mapLayerMode
		: (typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "");
	if (mapLayerMode === "powerlines") {
		return isNodixLocation(entry.location);
	}

	const config = LOCATION_NAME_LABEL_CONFIG[entry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	const nodixToggleChecked = visibilityContext
		? visibilityContext.nodixToggleChecked
		: IS_EDIT_MODE && $("#toggleNodix").is(":checked");
	const isVisibleByNodixToggle = nodixToggleChecked
		&& isNodixLocation(entry.location)
		&& zoomLevel >= 2;
	const typeVisible = visibilityContext
		? visibilityContext.isTypeVisible(entry.locationType)
		: isLocationTypeVisible(entry.locationType);
	return isVisibleByNodixToggle || (zoomLevel >= config.minZoom && typeVisible);
}

// Pro Orts-Label-Typ (+ Ruine) Farbe/Versalien/Kursiv/Sperrung EINMAL aus dem echten CSS lesen
// (Probe-Element) -> der Canvas-Renderer übernimmt die Optik, ohne Werte zu duplizieren. Ein dezenter
// dunkler Schein ersetzt den CSS text-shadow (den das Canvas nicht erbt) für die Lesbarkeit.
const _locationNameLabelTypeStyleCache = {};
function getLocationNameLabelTypeStyle(locationType, isRuined) {
	const cacheKey = `${locationType}|${isRuined ? "r" : ""}`;
	if (_locationNameLabelTypeStyleCache[cacheKey]) {
		return _locationNameLabelTypeStyleCache[cacheKey];
	}
	const probe = document.createElement("div");
	probe.className = `location-name-label location-name-label--${locationType}${isRuined ? " location-name-label--ruined" : ""}`;
	probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
	const span = document.createElement("span");
	span.textContent = "Mg";
	span.style.fontSize = "100px"; // bekannte Größe -> Sperrung als Verhältnis ableiten
	probe.appendChild(span);
	document.body.appendChild(probe);
	const computed = window.getComputedStyle(span);
	const style = {
		color: computed.color || "#ffffff",
		uppercase: computed.textTransform === "uppercase",
		fontFamily: computed.fontFamily || 'Georgia, "Times New Roman", serif',
		fontWeight: computed.fontWeight || "400",
		fontStyle: computed.fontStyle && computed.fontStyle !== "normal" ? computed.fontStyle : "",
		letterSpacingRatio: (parseFloat(computed.letterSpacing) || 0) / 100,
		glow: "rgba(0, 0, 0, 0.85)",
	};
	document.body.removeChild(probe);
	_locationNameLabelTypeStyleCache[cacheKey] = style;
	return style;
}

function createLocationNameLabelIcon(entry, zoomLevel = map.getZoom()) {
	const labelSize = getLocationNameLabelSize(entry.locationType, zoomLevel);
	const labelType = entry.locationType || "dorf";
	const offset = getLocationNameLabelOffset(labelSize, zoomLevel, entry.locationType);
	const isRuined = Boolean(entry.location?.isRuined);
	const ruinedClassName = isRuined ? " location-name-label--ruined" : "";
	// Schrift auf ein CSS-aufgelöstes Canvas rastern (weich auf HiDPI hochskaliert, „eingebettet"
	// wie die Karten-/Grenz-Namen) und als <img> einbetten – Position/Offset/Kollision bleiben DOM.
	const fontSizePx = labelSize * 4 / 3; // pt -> px
	const typeStyle = getLocationNameLabelTypeStyle(labelType, isRuined);
	// Halo/Schatten dynamisch (live über ?halotune=1): 0 = ganz aus, sonst schwarzer Schein mit der Stärke.
	// renderMapLabelToImage cached pro Glow/Pässe -> verschiedene Stärken teilen sich keinen Cache-Eintrag.
	const halo = (typeof getLabelHaloParams === "function")
		? getLabelHaloParams(LOCATION_LABEL_HALO_STRENGTH, LOCATION_LABEL_HALO_SHARPNESS)
		: { glow: LOCATION_LABEL_HALO_STRENGTH > 0 ? "rgba(0, 0, 0, 0.85)" : null };
	const haloStyle = halo.glow
		? { ...typeStyle, glow: halo.glow, glowBlurRatio: halo.glowBlurRatio, glowPasses: halo.glowPasses, strokeRatio: halo.strokeRatio }
		: { ...typeStyle, glow: null };
	// vAnchor "xheight": Bild liefert anchorY = Mitte zwischen Grund- und Mittellinie (x-Höhen-Mitte).
	const image = renderMapLabelToImage(entry.name, fontSizePx, haloStyle, { vAnchor: "xheight" });
	// Horizontal: Text beginnt bei offset.x (links um die Canvas-Polsterung zurück). Vertikal: die
	// x-Höhen-Mitte des Textes exakt auf die Marker-Mitte legen (top = -anchorY); der vertikale
	// Basis-Offset entfällt damit (0), die Kollision verschiebt weiterhin über --label-offset-y.
	const leftAdjust = -image.padX;
	const topAdjust = -image.anchorY;
	return L.divIcon({
		className: `location-name-label location-name-label--${labelType}${ruinedClassName}`,
		html: `<img src="${image.url}" width="${image.w}" height="${image.h}" alt="${escapeHtml(entry.name)}" style="position:absolute; display:block; pointer-events:none; --location-label-offset-x:${offset.x}px; --location-label-offset-y:0px; left:calc(var(--location-label-offset-x) + var(--label-offset-x, 0px) + ${leftAdjust}px); top:calc(var(--location-label-offset-y) + var(--label-offset-y, 0px) + ${topAdjust}px);">`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function createLocationNameLabelEntry(markerEntry) {
	// LAZY: Marker mit leerem Platzhalter-Icon anlegen — das echte Label-Bild (Canvas + toDataURL) rendert
	// erst syncLocationNameLabelVisibility für SICHTBARE Labels. Vorher wurden hier beim Start alle ~3000
	// Siedlungs-Labels gerastert (ein einzelner ~5s-Longtask), obwohl bei Zoom 0 nur ~40 sichtbar sind.
	const marker = L.marker(markerEntry.location.coordinates, {
		icon: L.divIcon({ className: "location-name-label", html: "", iconSize: [0, 0], iconAnchor: [0, 0] }),
		interactive: false,
		keyboard: false,
		pane: "labelsPane",
	});
	return { markerEntry, marker };
}

// Stil-Revision der Siedlungs-Labels: zählt hoch, wenn sich das Label-AUSSEHEN global ändert (Halo-Slider
// im ?halotune=1-Panel). Der setIcon-Guard in syncLocationNameLabelVisibility rendert ein Label nur neu,
// wenn sich Zoom, Stil-Revision, Name oder Ruinen-Status seit dem letzten Bau geändert haben — beim reinen
// Pannen bleibt das Icon stehen (kein DOM-Austausch von bis zu ~350 <img>-Icons pro moveend).
let _locationNameLabelStyleRevision = 0;
function bumpLocationNameLabelStyleRevision() {
	_locationNameLabelStyleRevision += 1;
}

function syncLocationNameLabelVisibility(visibilityContext = null) {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	const context = visibilityContext || createLocationVisibilityContext();
	locationNameLabels.forEach((entry) => {
		const shouldShow = shouldShowLocationNameLabel(entry.markerEntry, zoomLevel, context)
			&& isMarkerEntryInRenderBounds(entry.markerEntry, renderBounds);
		if (!shouldShow) {
			map.removeLayer(entry.marker);
			return;
		}

		entry.marker.setLatLng(entry.markerEntry.marker.getLatLng());
		const iconKey = `${zoomLevel}|${_locationNameLabelStyleRevision}|${entry.markerEntry.name}|${entry.markerEntry.location?.isRuined ? "r" : ""}`;
		if (entry._iconKey !== iconKey) {
			entry.marker.setIcon(createLocationNameLabelIcon(entry.markerEntry, zoomLevel));
			entry._iconKey = iconKey;
		}
		map.addLayer(entry.marker);
	});
	scheduleLabelCollisionResolution();
}

function addLocationNameLabel(markerEntry) {
	if (isCrossingLocation(markerEntry.location)) {
		return;
	}

	locationNameLabels.push(createLocationNameLabelEntry(markerEntry));
}

function ensureLocationNameLabel(markerEntry) {
	if (isCrossingLocation(markerEntry.location)) {
		return;
	}

	const existingLabelEntry = locationNameLabels.find((entry) => entry.markerEntry === markerEntry);
	if (existingLabelEntry) {
		return;
	}

	addLocationNameLabel(markerEntry);
}

function removeLocationNameLabel(markerEntry) {
	const labelEntry = locationNameLabels.find((entry) => entry.markerEntry === markerEntry);
	if (!labelEntry) {
		return;
	}

	map.removeLayer(labelEntry.marker);
	locationNameLabels = locationNameLabels.filter((entry) => entry !== labelEntry);
}

// Live-Slider für die Halo-/Schatten-Stärke der Label, nur mit ?halotune=1 (oben links). Zwei Regler:
// Siedlungs-Labels und Regionen-Titel (.map-label). Ändern -> betroffene Labels neu rendern. OK merkt die Werte.
(function initLabelHaloTuningPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("halotune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:220px;";
	const title = document.createElement("div");
	title.textContent = "Label-Halo"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	const addSlider = (labelText, getVal, apply, min = 0, max = 5, step = 0.1) => {
		const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin:6px 0 2px;";
		const nm = document.createElement("span"); nm.textContent = labelText;
		const vl = document.createElement("span"); vl.textContent = String(getVal());
		head.appendChild(nm); head.appendChild(vl);
		const input = document.createElement("input");
		input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = getVal(); input.style.width = "100%";
		input.addEventListener("input", () => { const v = parseFloat(input.value); vl.textContent = String(v); apply(v); });
		panel.appendChild(head); panel.appendChild(input);
	};
	// Stil-Revision hochzählen, sonst überspringt der setIcon-Guard im Sync das Neu-Rendern der Labels.
	const refreshSettlements = () => { try { bumpLocationNameLabelStyleRevision(); if (typeof syncLocationNameLabelVisibility === "function") syncLocationNameLabelVisibility(); } catch (e) { /* noop */ } };
	const refreshRegions = () => { try { if (typeof syncLabelIcons === "function") syncLabelIcons(); } catch (e) { /* noop */ } };
	addSlider("Siedlungen Stärke", () => LOCATION_LABEL_HALO_STRENGTH, (v) => { LOCATION_LABEL_HALO_STRENGTH = v; refreshSettlements(); });
	addSlider("Siedlungen Schärfe", () => LOCATION_LABEL_HALO_SHARPNESS, (v) => { LOCATION_LABEL_HALO_SHARPNESS = v; refreshSettlements(); }, 0, 1, 0.05);
	addSlider("Regionen Stärke", () => (typeof REGION_LABEL_HALO_STRENGTH !== "undefined" ? REGION_LABEL_HALO_STRENGTH : 0), (v) => {
		if (typeof REGION_LABEL_HALO_STRENGTH !== "undefined") { REGION_LABEL_HALO_STRENGTH = v; }
		refreshRegions();
	});
	addSlider("Regionen Schärfe", () => (typeof REGION_LABEL_HALO_SHARPNESS !== "undefined" ? REGION_LABEL_HALO_SHARPNESS : 0), (v) => {
		if (typeof REGION_LABEL_HALO_SHARPNESS !== "undefined") { REGION_LABEL_HALO_SHARPNESS = v; }
		refreshRegions();
	}, 0, 1, 0.05);
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		window.__avesmapsLabelHalo = {
			settlement: LOCATION_LABEL_HALO_STRENGTH,
			settlementSharpness: LOCATION_LABEL_HALO_SHARPNESS,
			region: (typeof REGION_LABEL_HALO_STRENGTH !== "undefined" ? REGION_LABEL_HALO_STRENGTH : 0),
			regionSharpness: (typeof REGION_LABEL_HALO_SHARPNESS !== "undefined" ? REGION_LABEL_HALO_SHARPNESS : 0),
		};
		console.log("[Label-Halo] " + JSON.stringify(window.__avesmapsLabelHalo));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Stärke 0–5 (Dichte), Schärfe 0–1 (weicher Schein → scharfe Kontur)."; hint.style.cssText = "opacity:0.6;margin-top:6px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();
