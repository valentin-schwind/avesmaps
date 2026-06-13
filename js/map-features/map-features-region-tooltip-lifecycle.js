let regionSingleClickTimer = null;

function bindRegionCompactTooltip(polygon, regionEntry) {
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);

		if (!IS_EDIT_MODE) {
			// Single-Klick: NUR Infobox öffnen (KEINE Ansichtsverschiebung). Kurz verzoegert,
			// damit ein Doppelklick (verschieben + zoomen) ihn abbricht und keine Infobox aufpoppt.
			if (regionSingleClickTimer) {
				window.clearTimeout(regionSingleClickTimer);
			}
			regionSingleClickTimer = window.setTimeout(() => {
				regionSingleClickTimer = null;
				openRegionCompactTooltip(regionEntry);
			}, 250);
		}

		showPoliticalTerritoryTimelineSelection(regionEntry);
	});

	if (!IS_EDIT_MODE) {
		// Doppel-Klick: animiert eine Stufe reinzoomen, zentriert auf die Gebietsmitte.
		// stop() verhindert den Standard-doubleClickZoom UND den verzoegerten Single-Klick (Infobox).
		polygon.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			if (regionSingleClickTimer) {
				window.clearTimeout(regionSingleClickTimer);
				regionSingleClickTimer = null;
			}
			const center = getRegionTooltipLatLng(regionEntry) || map.getCenter();
			const targetZoom = Math.min(Math.round(Number(map.getZoom())) + 1, map.getMaxZoom());
			map.flyTo(center, targetZoom, { duration: 0.6 });
		});
	}
}

function openRegionCompactTooltip(regionEntry, options = {}) {
	closeRegionCompactTooltip();
	const tooltip = L.tooltip({
		direction: "top",
		offset: [0, -18],
		opacity: 1,
		className: "region-compact-tooltip",
		// Hover-Infobox ist nicht-interaktiv (pointer-events: none), damit der Cursor "durch"
		// den Tooltip auf das Polygon fällt und kein mouseout/mouseover-Flackern entsteht.
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

// Klappt die Hover-Infobox nach UNTEN, wenn über dem Ankerpunkt im Kartenfenster nicht genug
// Platz ist (sie sonst oben aus dem Fenster stossen wuerde). Misst die tatsaechliche Tooltip-
// Hoehe und vergleicht sie mit dem Abstand des Ankers zur oberen Kartenkante. Wird nach dem
// ersten Render UND nach dem asynchronen Wiki-Detail-Nachladen (Hoehe ändert sich) aufgerufen.
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
// Eigener Pane oberhalb des Boundary-Canvas (z350), damit die weisse Hover-Flaeche
// Über den Aussen-/Innengrenzen liegt (unter Labels 475 / Markern 500).
function ensureRegionHoverPane() {
	if (typeof map === "undefined" || !map || typeof map.createPane !== "function") {
		return null;
	}
	if (!map.getPane("regionHoverPane")) {
		const pane = map.createPane("regionHoverPane");
		pane.style.zIndex = 355;
		pane.style.pointerEvents = "none";
	}
	return "regionHoverPane";
}

// Baut weisse Overlay-Polygone aus einer GeoJSON-Geometrie (Polygon ODER MultiPolygon),
// inkl. Loecher/Enklaven als innere Ringe. GeoJSON [x,y] -> Leaflet [y,x].
// Punkt-in-Ring (Ray-Casting); pt und ring in Leaflet-[y,x]. Fuer das Zuordnen von Loch-Ringen.
function pointInRing(pt, ring) {
	if (!Array.isArray(pt) || !Array.isArray(ring) || ring.length < 3) {
		return false;
	}
	const y = Number(pt[0]), x = Number(pt[1]);
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const yi = Number(ring[i][0]), xi = Number(ring[i][1]);
		const yj = Number(ring[j][0]), xj = Number(ring[j][1]);
		const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
		if (intersect) {
			inside = !inside;
		}
	}
	return inside;
}

function buildHoverPolygonsFromGeometry(geometry, pane, group, holeRings = []) {
	if (!geometry) {
		return 0;
	}
	let polys = [];
	if (geometry.type === "Polygon") {
		polys = [geometry.coordinates];
	} else if (geometry.type === "MultiPolygon") {
		polys = geometry.coordinates;
	}
	let count = 0;
	polys.forEach((rings) => {
		if (!Array.isArray(rings) || !rings.length) {
			return;
		}
		// rings = [Aussenring, Loch1, Loch2, ...] -> Leaflet behandelt ab dem 2. Ring als Loch.
		const latlngs = rings.map((ring) => ring.map((c) => [Number(c[1]), Number(c[0])]));
		// Umstrittene Teilflaechen, die in DIESEM Polygon liegen, als zusaetzliche Loecher ausstanzen,
		// damit der weisse Hover-Wash sie nicht zukleistert -> Schraffur bleibt auch beim Hover sichtbar.
		if (Array.isArray(holeRings) && holeRings.length && Array.isArray(latlngs[0])) {
			holeRings.forEach((hole) => {
				if (Array.isArray(hole) && hole.length && pointInRing(hole[0], latlngs[0])) {
					latlngs.push(hole);
				}
			});
		}
		L.polygon(latlngs, {
			pane,
			interactive: false,
			stroke: false,
			fill: true,
			fillColor: POLITICAL_HOVER_FILL_COLOR,
			fillOpacity: POLITICAL_HOVER_FILL_OPACITY,
		}).addTo(group);
		count += 1;
	});
	return count;
}

function applyRegionHoverHighlight(regionEntry) {
	if (typeof POLITICAL_HOVER_FILL_COLOR === "undefined" || !POLITICAL_HOVER_FILL_COLOR) {
		return;
	}
	clearRegionHoverHighlight();
	const pane = ensureRegionHoverPane();
	if (!pane) {
		return;
	}
	const group = L.layerGroup();
	let count = 0;
	// 1) Bevorzugt die VOLLE Aggregat-Huelle (Derived) -> faerbt das ganze aggregierte Gebiet
	//    (inkl. Luecken zwischen Kindern, über den Aussengrenzen), Loecher/Enklaven als Innenringe.
	const derivedIndex = (typeof politicalRegionDerivedByTerritory !== "undefined" && politicalRegionDerivedByTerritory)
		? politicalRegionDerivedByTerritory
		: (typeof indexPoliticalRegionDerivedByTerritory === "function" ? indexPoliticalRegionDerivedByTerritory() : null);
	const aggKey = String(regionEntry.territoryPublicId || "").trim();
	const agg = (derivedIndex && aggKey && typeof derivedIndex.get === "function") ? derivedIndex.get(aggKey) : null;
	// Hinweis: das Hover-Weiss bedeckt die VOLLE Derived-Huelle (siehe unten) -- es werden bewusst KEINE
	// Loecher fuer umstrittene Flaechen ausgestanzt (Nutzer-Vorgabe: "das Weiss bleibt unberuehrt").
	if (agg && agg.geometry) {
		// Nutzer-Vorgabe: das Hover-Weiss bedeckt die VOLLE Derived-Huelle (deckungsgleich mit der
		// Aussengrenze), UNveraendert -> KEINE Loecher fuer umstrittene Flaechen. Die Schraffur ist eine
		// eigene Ebene; das Weiss soll die ganze Original-Derived ueberziehen. (contestedHoleRings verworfen.)
		count = buildHoverPolygonsFromGeometry(agg.geometry, pane, group, []);
	}
	// 2) Fallback: die sichtbaren Polygone der Region selbst (auch Multipolygon + Loecher via getLatLngs).
	if (count === 0 && typeof regionPolygons !== "undefined" && Array.isArray(regionPolygons)) {
		regionPolygons.forEach((p) => {
			if (!p || p._regionEntry !== regionEntry) {
				return;
			}
			const opts = p.options || {};
			// fillOpacity 0 NICHT ueberspringen: umstrittene Blaetter sind ausgeschnitten (fillOpacity 0),
			// muessen aber trotzdem weiss hoverbar sein, wenn keine Derived mehr da ist. Nur echte
			// fill:false-Features (gar keine Flaeche) auslassen.
			if (opts.fill === false) {
				return;
			}
			L.polygon(p.getLatLngs(), {
				pane,
				interactive: false,
				stroke: false,
				fill: true,
				fillColor: POLITICAL_HOVER_FILL_COLOR,
				fillOpacity: POLITICAL_HOVER_FILL_OPACITY,
			}).addTo(group);
			count += 1;
		});
	}
	if (count > 0) {
		group.addTo(map);
		window.__regionHoverHighlightLayer = group;
	}
}

function clearRegionHoverHighlight() {
	if (window.__regionHoverHighlightLayer) {
		map.removeLayer(window.__regionHoverHighlightLayer);
		window.__regionHoverHighlightLayer = null;
	}
}

// Frontend "Politisch": beim Drüberfahren über eine Region die Wiki-Infobox zeigen
// (anchored am Regions-Mittelpunkt, nicht-interaktiv), beim Verlassen wieder schließen.
// Welche Hierarchie-Ebene reagiert, ergibt sich automatisch aus dem Zoom-Band der Daten
// (bei Zoom 2 ist nur das Herzogtum-Aggregat sichtbar, nicht die Baronie).
function bindRegionHoverTooltip(polygon, regionEntry) {
	if (IS_EDIT_MODE || regionEntry.source !== "political_territory") {
		return;
	}
	polygon.on("mouseover", () => {
		// Dynamische Absicherung: nur die AKTIVE Anzeige-Ebene zeigen, deren Zoom-Band den aktuellen
		// Zoom enthält. Schuetzt gegen veraltete interactive-Flags (falls der Layer nach einem Zoom
		// noch nicht neu geladen hat) -> es wird nie die Infobox einer tieferen/flacheren Ebene gezeigt.
		const zoom = Math.round(Number(map.getZoom()));
		const minZ = regionEntry.minZoom, maxZ = regionEntry.maxZoom;
		const inBand = (minZ === null || minZ === undefined || Number(minZ) <= zoom)
			&& (maxZ === null || maxZ === undefined || Number(maxZ) >= zoom);
		if (!inBand) {
			return;
		}
		// Hover faerbt die Region nur weiss (Highlight) - KEINE Infobox mehr (die kommt per Klick).
		applyRegionHoverHighlight(regionEntry);
	});
	polygon.on("mouseout", () => {
		clearRegionHoverHighlight(regionEntry);
	});
}

// #5: laedt die reichhaltigen Wiki-Zusatzfelder (Oberhaupt/Sprache/Waehrung/Einwohner/Gruender/
// Herrschaftsform/Handelswaren/Geographisch) + das lizenz-gegatete Wappen aus dem Detail-Endpoint
// nach und rendert den Tooltip neu. Nur für Wiki-Infoboxen mit bekanntem Territorium.
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

// Entfernt die temporaere Einzel-Markierung (Spotlight) für einen angeklickten Ort wieder.
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
		// Dann KEINE temporaere Markierung setzen (sonst doppelt), sondern danach sein Popup öffnen.
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
	// daher entfernt syncLocationMarkerVisibility sie nicht; beim Schließen der Infobox (popupclose)
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
