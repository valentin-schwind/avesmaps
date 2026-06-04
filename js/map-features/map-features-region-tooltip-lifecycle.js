function bindRegionCompactTooltip(polygon, regionEntry) {
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);

		if (!IS_EDIT_MODE) {
			openRegionCompactTooltip(regionEntry);
		}

		showPoliticalTerritoryTimelineSelection(regionEntry);
	});
}

function openRegionCompactTooltip(regionEntry) {
	closeRegionCompactTooltip();
	const tooltip = L.tooltip({
		direction: "top",
		offset: [0, -18],
		opacity: 1,
		className: "region-compact-tooltip",
		interactive: true,
	})
		.setLatLng(getRegionTooltipLatLng(regionEntry))
		.setContent(createRegionCompactTooltipMarkup(regionEntry));
	activeRegionInfoTooltip = tooltip;
	tooltip.addTo(map);
	enrichRegionTooltipWithWikiDetail(regionEntry, tooltip);
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
		})
		.catch(() => {});
}

function closeRegionCompactTooltip() {
	if (activeRegionInfoTooltip) {
		map.removeLayer(activeRegionInfoTooltip);
		activeRegionInfoTooltip = null;
	}
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
