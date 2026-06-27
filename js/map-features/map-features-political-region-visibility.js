function syncRegionVisibility() {
	const showRegions = getSelectedMapLayerMode() === "political";
	const currentZoom = Math.round(map.getZoom());
	syncPoliticalTimelineVisibility();
	if (!showRegions) {
		clearRegionGeometryEdit();
		closeRegionCompactTooltip();
		closeRegionContextMenu();
		cancelPendingRegionOperation();
		// Canvas-Außengrenzen sofort leeren (Overlay zeichnet sonst regionData weiter).
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.();
		// Konflikt-Schraffur ebenso leeren -- sie darf NUR im politischen Modus erscheinen
		// (das Overlay-Redraw prueft den Modus selbst und leert sein Canvas, wenn nicht politisch).
		window.AvesmapsContestedHatchOverlay?.redraw?.();
	}

	regionPolygons.forEach((layer) => {
		const regionEntry = layer?._regionEntry || null;
		const minZoom = readOptionalRegionZoom(regionEntry?.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry?.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(layer);
		} else {
			map.removeLayer(layer);
		}
	});

	regionLabels.forEach((label) => {
		const regionEntry = regionData.find((entry) => entry?._normalizedRegionEntry?.label === label)
			|| regionPolygons.map((polygon) => polygon?._regionEntry).find((entry) => entry?.label === label)
			|| null;
		const minZoom = readOptionalRegionZoom(regionEntry?.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry?.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(label);
		} else {
			map.removeLayer(label);
		}
	});

	if (showRegions) {
		schedulePoliticalTerritoryLayerReload();
		// Entering political (incl. from "Nur Karte"/"Standard") must (re)paint the boundary canvas. A plain
		// redraw is a no-op while the overlay's zoom-animation guard (cssZoomActive) is set, and a mode switch
		// raises no moveend/zoomend to clear it -- so the borders stay blank until a manual pan/zoom/resize.
		// We therefore FORCE the redraw (bypasses the guard) and re-fire it across the next few seconds so it
		// also lands once the layer fetch returns.
		redrawPoliticalBoundariesAfterSettle();
	}
}

// Force-repaints the derived boundary canvas (and the contested hatch) on entry to the political layer:
// immediately and again across the next few seconds. The force flag bypasses the overlay's CSS-zoom guard,
// which a mode switch can otherwise leave engaged (no moveend/zoomend follows a switch to clear it). The
// repeats cover the layer fetch landing a little later. A guard keeps a single burst from stacking; the
// immediate force-repaint still runs on every call (so the post-fetch sync paints as soon as data arrives).
let politicalBoundaryRedrawBurstActive = false;
function redrawPoliticalBoundariesAfterSettle() {
	const repaint = () => {
		if (getSelectedMapLayerMode() !== "political") {
			return; // switched away again -> the !showRegions path owns the canvas now
		}
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.(true);
		window.AvesmapsContestedHatchOverlay?.redraw?.();
	};
	repaint(); // immediate force-repaint
	if (politicalBoundaryRedrawBurstActive) {
		return; // a catch-up burst is already running; don't stack another
	}
	politicalBoundaryRedrawBurstActive = true;
	[100, 300, 600, 1200, 2000, 3500, 5000].forEach((ms) => window.setTimeout(repaint, ms));
	window.setTimeout(() => { politicalBoundaryRedrawBurstActive = false; }, 5100);
}
