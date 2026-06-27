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
		// Entering political (incl. from "Nur Karte"/"Standard") must (re)paint the boundary + contested
		// canvases. The overlay's redraw is a deliberate no-op while a zoom/settle animation is mid-flight
		// (the CSS transform handles the visual then), and a mode switch -- unlike a pan/zoom -- raises no
		// moveend/zoomend to retrigger it. So on a freshly loaded page a switch can land in that window and
		// leave the borders blank until a manual pan/zoom. The helper re-fires until the canvas actually paints.
		redrawPoliticalBoundariesAfterSettle();
	}
}

// Re-paints the derived boundary + contested-hatch canvases shortly after entering the political layer, until
// they actually land. Needed because the boundary overlay skips drawing during an in-flight zoom/settle
// animation (cssZoomActive) and a mode switch raises no event to retrigger the draw the way a pan/zoom would.
let politicalBoundaryRedrawTimers = [];
function redrawPoliticalBoundariesAfterSettle() {
	politicalBoundaryRedrawTimers.forEach((timerId) => window.clearTimeout(timerId));
	const repaint = () => {
		if (getSelectedMapLayerMode() !== "political") {
			return; // switched away again -> the !showRegions path owns the canvas now
		}
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.();
		window.AvesmapsContestedHatchOverlay?.redraw?.();
	};
	repaint(); // immediate -- covers the warm case where no animation is in flight
	// ...and re-fire across the next ~3s so a cold-load switch still lands once the animation clears and the
	// layer fetch returns. Each call clears the prior timers, so repeated syncs don't stack redraws.
	politicalBoundaryRedrawTimers = [100, 250, 500, 1000, 2000, 3000].map((ms) => window.setTimeout(repaint, ms));
}
