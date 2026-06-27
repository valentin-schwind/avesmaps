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
		// Hinweis: Die zur LAUFZEIT aktive syncRegionVisibility installiert der Loader
		// (installPoliticalRegionVisibilityBehavior in map-features-political-territory-loader.js) und ueber-
		// schreibt diese Funktion hier -- sie ist also nur Vorlage/Fallback. Damit auch der Fallback korrekt
		// ist: Grenzen + Schraffur beim Eintritt in "political" neu zeichnen. force=true umgeht die
		// Zoom-Animations-Sperre des Overlays, die ein Moduswechsel nicht aufraeumt (kein moveend/zoomend),
		// sonst blieben die Grenzen leer bis zu einem manuellen Pan/Zoom/Resize.
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.(true);
		window.AvesmapsContestedHatchOverlay?.redraw?.();
	}
}
