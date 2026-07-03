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
	map.setView(markerLatLng, preferredZoom);
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
	map.setView(labelEntry.marker.getLatLng(), targetZoom);
	syncLabelVisibility();
}

// Fliegt zur Region-Bounds, klemmt die Zielzoomstufe aber ins Sichtbarkeits-Band des Gebiets
// (min_zoom..max_zoom) -> kein Zoom auf eine Stufe, wo das Gebiet gar nicht gerendert wird.
function focusSpotlightRegionBounds(bounds, minZoom, maxZoom) {
	if (!bounds?.isValid?.()) {
		return;
	}
	const hasMin = Number.isFinite(Number(minZoom));
	const hasMax = Number.isFinite(Number(maxZoom));
	const cap = hasMax ? Number(maxZoom) : 4;
	map.fitBounds(bounds.pad(0.12), { padding: [54, 54], maxZoom: cap });
	let targetZoom = map.getZoom();
	if (hasMin && targetZoom < Number(minZoom)) targetZoom = Number(minZoom);
	if (hasMax && targetZoom > Number(maxZoom)) targetZoom = Number(maxZoom);
	if (targetZoom !== map.getZoom()) {
		map.setView(bounds.getCenter(), targetZoom);
	}
}

function focusSpotlightRegion(entry) {
	setSelectedMapLayerMode("political");
	if (entry.bounds?.isValid?.()) {
		focusSpotlightRegionBounds(entry.bounds, entry.minZoom, entry.maxZoom);
	}
	// Highlight: die Infobox des Gebiets öffnen. Per public_id, da die politische Ebene nach dem
	// Ebenen-Wechsel/Flug asynchron neu laedt -> wir pollen, bis das Polygon gerendert ist.
	const publicId = (entry.publicIds && entry.publicIds[0]) || entry.regionEntry?.publicId || entry.regionEntry?.territoryPublicId || "";
	if (publicId) {
		openSpotlightRegionInfobox(publicId);
	}
}

// Öffnet die Region-Infobox sobald ein Polygon mit passender public_id/territory_public_id
// gerendert ist (pollt ~bis 4.5s, deckt den async Layer-Reload nach dem Ebenen-Wechsel ab).
let spotlightRegionInfoboxPollTimer = null;

function openSpotlightRegionInfobox(publicId) {
	if (spotlightRegionInfoboxPollTimer) {
		window.clearInterval(spotlightRegionInfoboxPollTimer);
		spotlightRegionInfoboxPollTimer = null;
	}
	let attempts = 0;
	const tryOpen = () => {
		const polys = Array.isArray(regionPolygons) ? regionPolygons : [];
		const match = polys.find((polygon) => {
			const re = polygon && polygon._regionEntry;
			return re && (re.publicId === publicId || re.territoryPublicId === publicId);
		});
		if (match && match._regionEntry && typeof openRegionCompactTooltip === "function") {
			openRegionCompactTooltip(match._regionEntry);
			return true;
		}
		return false;
	};
	if (tryOpen()) {
		return;
	}
	spotlightRegionInfoboxPollTimer = window.setInterval(() => {
		attempts += 1;
		if (tryOpen() || attempts > 30) {
			window.clearInterval(spotlightRegionInfoboxPollTimer);
			spotlightRegionInfoboxPollTimer = null;
		}
	}, 150);
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

	map.fitBounds(bounds.pad(0.16), {
		padding: [54, 54],
		maxZoom: preferredZoom,
	});

	if (map.getZoom() < preferredZoom) {
		map.setView(bounds.getCenter(), preferredZoom);
	}
}

function highlightSpotlightPaths(paths) {
	if (!paths.length) {
		return;
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
