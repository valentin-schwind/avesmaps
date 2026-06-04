function bindRegionCompactTooltip(polygon, regionEntry) {
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);

		if (!IS_EDIT_MODE) {
			openRegionCompactTooltip(regionEntry);
		}

		showPoliticalTerritoryTimelineSelection(regionEntry);
	});
}

function openRegionCompactTooltip(regionEntry, options = {}) {
	closeRegionCompactTooltip();
	const tooltip = L.tooltip({
		direction: "top",
		offset: [0, -18],
		opacity: 1,
		className: "region-compact-tooltip",
		// Hover-Infobox ist nicht-interaktiv (pointer-events: none), damit der Cursor "durch"
		// den Tooltip auf das Polygon faellt und kein mouseout/mouseover-Flackern entsteht.
		interactive: options.interactive !== false,
	})
		.setLatLng(options.latlng || getRegionTooltipLatLng(regionEntry))
		.setContent(createRegionCompactTooltipMarkup(regionEntry));
	activeRegionInfoTooltip = tooltip;
	activeRegionInfoTooltipEntry = regionEntry;
	tooltip.addTo(map);
	applyRegionTooltipVerticalFlip(tooltip);
	enrichRegionTooltipWithWikiDetail(regionEntry, tooltip);
}

// Klappt die Hover-Infobox nach UNTEN, wenn ueber dem Ankerpunkt im Kartenfenster nicht genug
// Platz ist (sie sonst oben aus dem Fenster stossen wuerde). Misst die tatsaechliche Tooltip-
// Hoehe und vergleicht sie mit dem Abstand des Ankers zur oberen Kartenkante. Wird nach dem
// ersten Render UND nach dem asynchronen Wiki-Detail-Nachladen (Hoehe aendert sich) aufgerufen.
function applyRegionTooltipVerticalFlip(tooltip) {
	if (!tooltip || typeof tooltip.getElement !== "function") {
		return;
	}
	const element = tooltip.getElement();
	const latlng = typeof tooltip.getLatLng === "function" ? tooltip.getLatLng() : null;
	if (!element || !latlng) {
		return;
	}

	const anchorPoint = map.latLngToContainerPoint(latlng);
	const tooltipHeight = element.offsetHeight || 0;
	const breathingRoom = 24;
	const flipDown = anchorPoint.y < tooltipHeight + breathingRoom;
	const desiredDirection = flipDown ? "bottom" : "top";
	if (tooltip.options.direction === desiredDirection) {
		return;
	}

	tooltip.options.direction = desiredDirection;
	tooltip.options.offset = flipDown ? [0, 18] : [0, -18];
	tooltip.update();
}

// Hover-Highlight: faerbt alle Polygone der Region unter der Maus fast weiss (Werte in config.js)
// und stellt beim Verlassen den vorherigen Stil wieder her. Nur sichtbare Fuellungen.
function applyRegionHoverHighlight(regionEntry) {
	if (typeof POLITICAL_HOVER_FILL_COLOR === "undefined" || !POLITICAL_HOVER_FILL_COLOR) {
		return;
	}
	if (typeof regionPolygons === "undefined" || !Array.isArray(regionPolygons)) {
		return;
	}
	regionPolygons.forEach((p) => {
		if (!p || p._regionEntry !== regionEntry) {
			return;
		}
		const opts = p.options || {};
		if (opts.fill === false || !(opts.fillOpacity > 0)) {
			return;
		}
		if (p._hoverPrevStyle === undefined) {
			p._hoverPrevStyle = { fillColor: opts.fillColor, fillOpacity: opts.fillOpacity };
		}
		p.setStyle({ fillColor: POLITICAL_HOVER_FILL_COLOR, fillOpacity: POLITICAL_HOVER_FILL_OPACITY });
	});
}

function clearRegionHoverHighlight(regionEntry) {
	if (typeof regionPolygons === "undefined" || !Array.isArray(regionPolygons)) {
		return;
	}
	regionPolygons.forEach((p) => {
		if (!p || p._regionEntry !== regionEntry || p._hoverPrevStyle === undefined) {
			return;
		}
		p.setStyle(p._hoverPrevStyle);
		p._hoverPrevStyle = undefined;
	});
}

// Frontend "Politisch": beim Drueberfahren ueber eine Region die Wiki-Infobox zeigen
// (anchored am Regions-Mittelpunkt, nicht-interaktiv), beim Verlassen wieder schliessen.
// Welche Hierarchie-Ebene reagiert, ergibt sich automatisch aus dem Zoom-Band der Daten
// (bei Zoom 2 ist nur das Herzogtum-Aggregat sichtbar, nicht die Baronie).
function bindRegionHoverTooltip(polygon, regionEntry) {
	if (IS_EDIT_MODE || regionEntry.source !== "political_territory") {
		return;
	}
	polygon.on("mouseover", () => {
		// Dynamische Absicherung: nur die AKTIVE Anzeige-Ebene zeigen, deren Zoom-Band den aktuellen
		// Zoom enthaelt. Schuetzt gegen veraltete interactive-Flags (falls der Layer nach einem Zoom
		// noch nicht neu geladen hat) -> es wird nie die Infobox einer tieferen/flacheren Ebene gezeigt.
		const zoom = Math.round(Number(map.getZoom()));
		const minZ = regionEntry.minZoom, maxZ = regionEntry.maxZoom;
		const inBand = (minZ === null || minZ === undefined || Number(minZ) <= zoom)
			&& (maxZ === null || maxZ === undefined || Number(maxZ) >= zoom);
		if (!inBand) {
			return;
		}
		openRegionCompactTooltip(regionEntry, { interactive: false });
		applyRegionHoverHighlight(regionEntry);
	});
	polygon.on("mouseout", () => {
		clearRegionHoverHighlight(regionEntry);
		if (activeRegionInfoTooltipEntry === regionEntry) {
			closeRegionCompactTooltip();
		}
	});
}

// #5: laedt die reichhaltigen Wiki-Zusatzfelder (Oberhaupt/Sprache/Waehrung/Einwohner/Gruender/
// Herrschaftsform/Handelswaren/Geographisch) + das lizenz-gegatete Wappen aus dem Detail-Endpoint
// nach und rendert den Tooltip neu. Nur fuer Wiki-Infoboxen mit bekanntem Territorium.
function enrichRegionTooltipWithWikiDetail(regionEntry, tooltip) {
	if (!hasRegionWikiInfo(regionEntry) || regionEntry.detail) {
		return;
	}
	const territoryPublicId = regionEntry.territoryPublicId || "";
	if (!territoryPublicId) {
		return;
	}
	fetch(`/api/app/territory-detail.php?territory=${encodeURIComponent(territoryPublicId)}`, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((data) => {
			if (!data || data.ok === false || activeRegionInfoTooltip !== tooltip) {
				return;
			}
			regionEntry.detail = data;
			tooltip.setContent(createRegionCompactTooltipMarkup(regionEntry));
			applyRegionTooltipVerticalFlip(tooltip);
		})
		.catch(() => {});
}

function closeRegionCompactTooltip() {
	if (activeRegionInfoTooltip) {
		map.removeLayer(activeRegionInfoTooltip);
		activeRegionInfoTooltip = null;
	}
	activeRegionInfoTooltipEntry = null;
}

function getRegionTooltipLatLng(regionEntry) {
	const bounds = getRegionEntryBounds(regionEntry);
	return regionEntry.label?.getLatLng?.() || bounds?.getCenter?.() || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter();
}

// Entfernt die temporaere Einzel-Markierung (Spotlight) fuer einen angeklickten Ort wieder.
function clearRegionPlaceSpotlight() {
	if (activeRegionPlaceSpotlightMarker) {
		map.removeLayer(activeRegionPlaceSpotlightMarker);
		activeRegionPlaceSpotlightMarker = null;
	}
}

function focusRegionPlace(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (!markerEntry) {
		showFeedbackToast("Der verknuepfte Ort ist aktuell nicht geladen.", "warning");
		return;
	}

	const latlng = markerEntry.marker.getLatLng();
	const targetZoom = Math.max(map.getZoom(), 4);

	// Vorherige Spotlight-Markierung immer entfernen (z. B. wenn nacheinander zwei Orte geklickt werden).
	clearRegionPlaceSpotlight();
	map.flyTo(latlng, targetZoom, { duration: 0.8 });

	if (map.hasLayer(markerEntry.marker)) {
		// Der Ort ist bereits sichtbar -> normales Marker-Popup.
		markerEntry.marker.openPopup();
		return;
	}

	if (typeof isLocationTypeVisible === "function" && isLocationTypeVisible(markerEntry.locationType)) {
		// Kategorie ist an: der echte Marker wird nach dem Flug (Zielzoom >= 4) ohnehin angezeigt.
		// Dann KEINE temporaere Markierung setzen (sonst doppelt), sondern danach sein Popup oeffnen.
		map.once("moveend", () => {
			if (!map.hasLayer(markerEntry.marker)) {
				map.addLayer(markerEntry.marker);
			}
			markerEntry.marker.openPopup();
		});
		return;
	}

	// Der Ort ist ausgeblendet (Kategorie aus). Eine temporaere Einzel-Markierung mit DEMSELBEN
	// Stadtsymbol setzen, deren Popup die Siedlungs-Infobox zeigt. Sie liegt NICHT in locationMarkers,
	// daher entfernt syncLocationMarkerVisibility sie nicht; beim Schliessen der Infobox (popupclose)
	// verschwindet sie wieder.
	const spotlight = L.marker(latlng, {
		icon: createLocationMarkerIcon(markerEntry.locationType, targetZoom),
		pane: "locationsPane",
		keyboard: true,
		interactive: true,
	});
	const popupContent = markerEntry.marker.getPopup()?.getContent?.() || markerEntry.name;
	spotlight.bindPopup(popupContent, { autoPan: false, className: "location-popup-wrapper" });
	spotlight.on("popupclose", clearRegionPlaceSpotlight);
	activeRegionPlaceSpotlightMarker = spotlight;
	spotlight.addTo(map);
	spotlight.openPopup();
}
