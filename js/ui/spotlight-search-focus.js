// Spotlight focus / navigation: act on a selected search result -- bounds helpers,
// pan/zoom to a location/label/region/path/powerline, the path-highlight overlay,
// the region-infobox poll (owns spotlightRegionInfoboxPollTimer) and clearing the
// selection. Split out of spotlight-search.js (M5 god-file split). Plain classic
// script: global functions called at runtime; shared spotlight state
// (spotlightHighlightLayer/spotlightActiveSelectionId) is referenced cross-script.

function extendSpotlightBounds(bounds, nextBounds) {
	if (!nextBounds?.isValid?.()) {
		return bounds;
	}

	if (!bounds?.isValid?.()) {
		return L.latLngBounds(nextBounds.getSouthWest(), nextBounds.getNorthEast());
	}

	return bounds.extend(nextBounds);
}

function getSpotlightLatLngBounds(latLngs) {
	const normalizedLatLngs = (latLngs || []).map((latLng) => L.latLng(latLng));
	if (!normalizedLatLngs.length) {
		return null;
	}

	return L.latLngBounds(normalizedLatLngs);
}

function getSpotlightPathBounds(path) {
	const latLngs = (path?.geometry?.coordinates || []).map(([lng, lat]) => L.latLng(lat, lng));
	return getSpotlightLatLngBounds(latLngs);
}

function selectSpotlightSearchEntry(entry) {
	// The search term is logged centrally in closeSpotlightSearch() (called right below), which also
	// captures searches that end without a selection -- so no separate tracking call is needed here.
	closeSpotlightSearch();
	clearSpotlightSelection();
	spotlightActiveSelectionId = entry.id;

	if (entry.kind === "location") {
		focusSpotlightLocation(entry);
		return;
	}

	if (entry.kind === "label") {
		focusSpotlightLabel(entry);
		return;
	}

	if (entry.kind === "region") {
		focusSpotlightRegion(entry);
		return;
	}

	if (entry.kind === "path") {
		focusSpotlightPath(entry);
		return;
	}

	if (entry.kind === "powerline") {
		focusSpotlightPowerline(entry);
	}
}

// Owner: search / deep-link focus should FLY to the target, not jump. A short, bounded duration keeps
// even a cross-map jump snappy (Leaflet's default auto-duration can run several seconds on long hops).
// NaN coords are guarded -- an animated pan with a NaN centre corrupts the map centre and crashes the next
// moveend (routing-nan-pan-crash class); Number.isFinite catches it (NaN is truthy).
const SPOTLIGHT_FLY_DURATION = 0.75;

function spotlightFlyTo(latLng, zoom) {
	const target = L.latLng(latLng);
	if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) {
		return;
	}
	map.flyTo(target, zoom, { duration: SPOTLIGHT_FLY_DURATION });
}

function focusSpotlightLocation(entry) {
	const markerEntry = entry.locationEntry;
	if (!markerEntry?.marker) {
		return;
	}

	// Nicht mehr die ganze Ortsgroesse einschalten — nur den Treffer selbst temporaer zeigen
	// (Marker + Infobox), der beim Schliessen der Infobox wieder verschwindet, falls die Groesse
	// nicht eingeblendet ist.
	const markerLatLng = markerEntry.marker.getLatLng();
	const preferredZoom = getSpotlightLocationZoom(markerEntry);
	spotlightFlyTo(markerLatLng, preferredZoom);
	window.setTimeout(() => openLocationPopupForMarkerEntry(markerEntry, { pan: false }), 0);
}

function getSpotlightLocationZoom(markerEntry) {
	const labelConfig = LOCATION_NAME_LABEL_CONFIG[markerEntry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	return Math.max(labelConfig.minZoom || 0, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}

function focusSpotlightLabel(entry) {
	const labelEntry = entry.labelEntry;
	if (!labelEntry?.marker) {
		return;
	}

	setSelectedMapLayerMode("deregraphic");
	const maxZoom = Number.isFinite(Number(labelEntry.label.maxZoom)) ? Number(labelEntry.label.maxZoom) : VISUAL_MAX_ZOOM_LEVEL;
	const targetZoom = Math.max(Number(labelEntry.label.minZoom) || 0, Math.min(maxZoom, VISUAL_MAX_ZOOM_LEVEL));
	spotlightFlyTo(labelEntry.marker.getLatLng(), targetZoom);
	syncLabelVisibility();
	// Infopanel (default): open the landscape/region label's info in the right panel too -- map-click
	// parity via the shared buildRegionLabelViewPopupHtml. A label without a wiki region has no infobox.
	if (typeof labelHasWikiRegion === "function" && labelHasWikiRegion(labelEntry.label)
		&& typeof window.avesmapsShowInfopanel === "function" && typeof buildRegionLabelViewPopupHtml === "function") {
		window.avesmapsShowInfopanel(buildRegionLabelViewPopupHtml(labelEntry.label), labelEntry.label.text || "");
	}
}

// Fliegt zur Region-Bounds, klemmt die Zielzoomstufe aber ins Sichtbarkeits-Band des Gebiets
// (min_zoom..max_zoom) -> kein Zoom auf eine Stufe, wo das Gebiet gar nicht gerendert wird.
function focusSpotlightRegionBounds(bounds, minZoom, maxZoom) {
	if (!bounds?.isValid?.()) {
		return;
	}
	// Number(null) === 0: without the explicit null/undefined guard a territory WITHOUT a stored
	// zoom band would set hasMax=true with cap 0 -> fitBounds capped at zoom 0 (no visible move).
	const hasMin = minZoom !== null && minZoom !== undefined && Number.isFinite(Number(minZoom));
	const hasMax = maxZoom !== null && maxZoom !== undefined && Number.isFinite(Number(maxZoom));
	const cap = hasMax ? Number(maxZoom) : 4;
	const padded = bounds.pad(0.12);
	// Band clamping must not read map.getZoom() after an animated fitBounds (stale mid-animation,
	// race-dependent result). Compute fitBounds' own target via getBoundsZoom (same padding: 2x54px)
	// and clamp THAT into the display band; only a band-min raise needs an explicit setView.
	const fitZoom = Math.min(map.getBoundsZoom(padded, false, L.point(108, 108)), cap);
	const targetZoom = hasMin ? Math.max(fitZoom, Number(minZoom)) : fitZoom;
	if (targetZoom !== fitZoom) {
		spotlightFlyTo(bounds.getCenter(), targetZoom);
	} else {
		map.flyToBounds(padded, { padding: [54, 54], maxZoom: cap, duration: SPOTLIGHT_FLY_DURATION });
	}
}

function focusSpotlightRegion(entry) {
	setSelectedMapLayerMode("political");
	if (entry.bounds?.isValid?.()) {
		focusSpotlightRegionBounds(entry.bounds, entry.minZoom, entry.maxZoom);
	}
	// Infopanel (default): a client-hydrated entry already carries the FULL regionEntry (identical to the
	// rendered polygon's _regionEntry) -> open the panel directly; no need to wait for the polygon to
	// re-render after the layer switch. This also covers territories outside the current zoom band whose
	// polygon never renders (the old poll-only path then showed nothing at all).
	if (entry.regionEntry && typeof window.avesmapsShowRegionInInfopanel === "function") {
		window.avesmapsShowRegionInInfopanel(entry.regionEntry);
		return;
	}
	const publicId = (entry.publicIds && entry.publicIds[0]) || entry.regionEntry?.publicId || entry.regionEntry?.territoryPublicId || "";
	if (!publicId) {
		return;
	}
	// Backend/synthetic hit (regionEntry === null): the territory may not render as a polygon at the target
	// zoom -- or ever (a claim-only "Anspruchsgebiet") -- so the poll below would never find it. In panel
	// mode, load its info by public_id and open the full infobox directly (territory-detail.php).
	if (typeof window.avesmapsShowRegionInfopanelById === "function") {
		window.avesmapsShowRegionInfopanelById(publicId, entry.name || "");
		return;
	}
	// Non-panel mode: poll for the rendered polygon and open the floating tooltip on it.
	openSpotlightRegionInfobox(publicId);
}

// Öffnet die Region-Infobox, sobald ein Polygon mit passender public_id/territory_public_id gerendert ist --
// und HÄLT sie offen, bis die politische Ebene zur Ruhe kommt. Grund: nach dem Ebenen-Wechsel + Flug lädt die
// Ebene mehrfach asynchron neu (jedes moveend -> schedulePoliticalTerritoryLayerReload), und jeder Reload ruft
// clearRenderedRegionLayers() -> closeRegionCompactTooltip(). Ein einmaliges Öffnen beim ersten Treffer risse
// ein späterer Reload wieder weg (Infobox "poppt kurz auf und verschwindet"). Also erneut öffnen, solange die
// Ziel-Infobox nicht steht; aufhören, wenn sie ~1,2 s ohne Teardown offen blieb, der Nutzer zu einem ANDEREN
// Gebiet gewechselt ist (fremde Infobox offen -> nicht dazwischenfunken), oder nach einem harten Zeitlimit.
let spotlightRegionInfoboxPollTimer = null;

function openSpotlightRegionInfobox(publicId) {
	if (spotlightRegionInfoboxPollTimer) {
		window.clearInterval(spotlightRegionInfoboxPollTimer);
		spotlightRegionInfoboxPollTimer = null;
	}
	const targetId = String(publicId);
	const startedAt = Date.now();
	let stableSince = 0;
	const stop = () => {
		if (spotlightRegionInfoboxPollTimer) {
			window.clearInterval(spotlightRegionInfoboxPollTimer);
			spotlightRegionInfoboxPollTimer = null;
		}
	};
	const findTargetEntry = () => {
		const polys = Array.isArray(regionPolygons) ? regionPolygons : [];
		const match = polys.find((polygon) => {
			const re = polygon && polygon._regionEntry;
			return re && (re.publicId === publicId || re.territoryPublicId === publicId);
		});
		return match ? match._regionEntry : null;
	};
	const shownPublicId = () => {
		const re = typeof activeRegionInfoTooltipEntry !== "undefined" ? activeRegionInfoTooltipEntry : null;
		return re ? String(re.publicId || re.territoryPublicId || "") : "";
	};
	const tick = () => {
		if (Date.now() - startedAt > 8000) { // Sicherheitsnetz: nie unbegrenzt pinnen.
			stop();
			return;
		}
		const shown = shownPublicId();
		// Nutzer hat ein anderes Gebiet geöffnet -> Pinnen aufgeben, ihm nicht die Infobox überschreiben.
		if (shown && shown !== targetId) {
			stop();
			return;
		}
		// Ziel-Infobox steht (und ist real auf der Karte): erst nach einer ruhigen Phase ohne Reload aufhören.
		if (shown === targetId && activeRegionInfoTooltip) {
			if (!stableSince) {
				stableSince = Date.now();
			} else if (Date.now() - stableSince > 1200) {
				stop();
			}
			return;
		}
		// Steht (noch) nicht: sobald das Polygon gerendert ist, (erneut) öffnen; Ruhe-Timer zurücksetzen.
		stableSince = 0;
		const entry = findTargetEntry();
		if (entry && typeof openRegionCompactTooltip === "function") {
			openRegionCompactTooltip(entry);
		}
	};
	spotlightRegionInfoboxPollTimer = window.setInterval(tick, 150);
	tick();
}

function focusSpotlightPath(entry) {
	$("#togglePaths").prop("checked", true);
	syncPathVisibility();
	syncPathLabels();
	syncPlannerStateToUrl();
	highlightSpotlightPaths(entry.paths || []);
	if (entry.bounds?.isValid?.()) {
		focusSpotlightBounds(entry.bounds, getSpotlightPathZoom(entry));
	}
	// Infopanel (default): open the way's info in the right panel too -- map-click parity. Every segment
	// of a way shares name/subtype/wiki_path and createPathPopupMarkup reads only .properties, so the
	// first segment yields the full way infobox even for a raw deep-link segment without _popupMarkup.
	const firstPath = (entry.paths && entry.paths[0]) || null;
	if (firstPath && typeof window.avesmapsShowPathInInfopanel === "function") {
		window.avesmapsShowPathInInfopanel(firstPath);
	}
}

function getSpotlightPathZoom(entry) {
	const minZoom = entry.subtype === "Flussweg" || entry.subtype === "Seeweg"
		? 3
		: LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return Math.max(minZoom, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}

function focusSpotlightPowerline(entry) {
	setSelectedMapLayerMode("powerlines");
	syncPowerlineLabels();
	if (entry.bounds?.isValid?.()) {
		const minZoom = shouldPowerlineNameBeDisplayed(entry.powerline) ? 2 : 3;
		focusSpotlightBounds(entry.bounds, Math.max(minZoom, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom())));
	}
}

function focusSpotlightBounds(bounds, preferredZoom) {
	if (!bounds?.isValid?.()) {
		return;
	}

	// flyToBounds only (animated): zoom out far enough for the whole bbox, zoom in at most to preferredZoom
	// (the maxZoom cap). Deliberately NO corrective setView afterwards: map.getZoom() is stale while the
	// fly animates, so a "raise to preferredZoom" follow-up forces zoom 5 onto long ways whenever no zoom
	// animation runs after it (small viewports take the pan branch, large zoom deltas reset synchronously)
	// -- the bbox then never fits the screen.
	map.flyToBounds(bounds.pad(0.16), {
		padding: [54, 54],
		maxZoom: preferredZoom,
		duration: SPOTLIGHT_FLY_DURATION,
	});
}

function highlightSpotlightPaths(paths) {
	if (!paths.length) {
		return;
	}

	// Drop the previous highlight BEFORE reassigning: the assignment below overwrites the only handle on it,
	// and clearSpotlightSelection can free just the group it still references -- an orphaned one hangs on the
	// map until a reload while every further call stacks another identical line on top of it (the line reads
	// as "getting fatter"). The search never exposed this because selectSpotlightSearchEntry clears first; the
	// way infobox's "Anzeigen" (showWholePathFromInfobox -> focusWholeWikiDeeplinkPath) calls in here directly.
	// Deliberately NOT clearSpotlightSelection(): that would also wipe spotlightActiveSelectionId, which
	// selectSpotlightSearchEntry sets BEFORE calling us -- Escape would stop clearing a searched way.
	if (spotlightHighlightLayer) {
		map.removeLayer(spotlightHighlightLayer);
	}

	spotlightHighlightLayer = L.layerGroup();
	paths.forEach((path) => {
		const latLngs = getPathVisualLatLngCoordinates(path.geometry?.coordinates || []);
		if (latLngs.length < 2) {
			return;
		}

		L.polyline(latLngs, {
			...SPOTLIGHT_PATH_HIGHLIGHT_STYLE,
			weight: getSpotlightPathHighlightWeight(path),
		}).addTo(spotlightHighlightLayer);
	});

	if (spotlightHighlightLayer.getLayers().length) {
		spotlightHighlightLayer.addTo(map);
		spotlightHighlightLayer.eachLayer((layer) => layer.bringToFront?.());
	}
}

function getSpotlightPathHighlightWeight(path) {
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
	if (subtype === "Flussweg" || subtype === "Seeweg") {
		return 13;
	}
	if (subtype === "Reichsstrasse") {
		return 12;
	}
	return 10;
}

function clearSpotlightSelection() {
	if (spotlightHighlightLayer) {
		map.removeLayer(spotlightHighlightLayer);
		spotlightHighlightLayer = null;
	}
	spotlightActiveSelectionId = "";
}
