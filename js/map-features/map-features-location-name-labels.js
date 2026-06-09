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

function shouldShowLocationNameLabel(entry, zoomLevel = map.getZoom()) {
	if (activeMapStyle !== "stylized" || isCrossingLocation(entry.location)) {
		return false;
	}

	const config = LOCATION_NAME_LABEL_CONFIG[entry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	const isVisibleByNodixToggle = IS_EDIT_MODE
		&& $("#toggleNodix").is(":checked")
		&& isNodixLocation(entry.location)
		&& zoomLevel >= 2;
	return isVisibleByNodixToggle || (zoomLevel >= config.minZoom && isLocationTypeVisible(entry.locationType));
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
	const image = renderMapLabelToImage(entry.name, fontSizePx, typeStyle);
	// Das Canvas-Bild ist beidseitig gepolstert und vertikal zentriert -> Platzierung an die alte
	// <span>-Position angleichen: links um die Polsterung, oben um die halbe Bild-Mehrhöhe zurück.
	const leftAdjust = -image.padX;
	const topAdjust = fontSizePx / 2 - image.h / 2;
	return L.divIcon({
		className: `location-name-label location-name-label--${labelType}${ruinedClassName}`,
		html: `<img src="${image.url}" width="${image.w}" height="${image.h}" alt="${escapeHtml(entry.name)}" style="position:absolute; display:block; pointer-events:none; --location-label-offset-x:${offset.x}px; --location-label-offset-y:${offset.y}px; left:calc(var(--location-label-offset-x) + var(--label-offset-x, 0px) + ${leftAdjust}px); top:calc(var(--location-label-offset-y) + var(--label-offset-y, 0px) + ${topAdjust}px);">`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function createLocationNameLabelEntry(markerEntry) {
	const marker = L.marker(markerEntry.location.coordinates, {
		icon: createLocationNameLabelIcon(markerEntry),
		interactive: false,
		keyboard: false,
		pane: "labelsPane",
	});
	return { markerEntry, marker };
}

function syncLocationNameLabelVisibility() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	locationNameLabels.forEach((entry) => {
		const shouldShow = shouldShowLocationNameLabel(entry.markerEntry, zoomLevel)
			&& isMarkerEntryInRenderBounds(entry.markerEntry, renderBounds);
		if (!shouldShow) {
			map.removeLayer(entry.marker);
			return;
		}

		entry.marker.setLatLng(entry.markerEntry.marker.getLatLng());
		entry.marker.setIcon(createLocationNameLabelIcon(entry.markerEntry, zoomLevel));
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
