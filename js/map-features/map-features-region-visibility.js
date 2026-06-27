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
		// Entering political from a non-boundary mode (none/powerlines) left the boundary canvas cleared, and when
		// the layer data is already loaded no reload fires (so the post-load redraw in loadPoliticalTerritoryLayer never runs).
		// Redraw the boundary + contested canvases now so the outer/inner borders reappear immediately instead of
		// only after the next zoom (reproducible at every zoom level). Mirrors the canvas clear in the
		// !showRegions branch above.
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.();
		window.AvesmapsContestedHatchOverlay?.redraw?.();
	}
}
