function syncRegionVisibility() {
	const showRegions = getSelectedMapLayerMode() === "political";
	const currentZoom = Math.round(map.getZoom());
	syncPoliticalTimelineVisibility();
	if (!showRegions) {
		clearRegionGeometryEdit();
		closeRegionCompactTooltip();
		closeRegionContextMenu();
		cancelPendingRegionOperation();
	}

	regionPolygons.forEach((layer) => {
		const regionEntry = layer._regionEntry || null;
		const minZoom = readOptionalRegionZoom(regionEntry.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(layer);
		} else {
			map.removeLayer(layer);
		}
	});

	regionLabels.forEach((label) => {
		const regionEntry = regionData.find((entry) => entry._normalizedRegionEntry.label === label)
			|| regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry.label === label)
			|| null;
		const minZoom = readOptionalRegionZoom(regionEntry.minZoom);
		const maxZoom = readOptionalRegionZoom(regionEntry.maxZoom);
		const isVisibleAtZoom = (minZoom === null || minZoom <= currentZoom) && (maxZoom === null || maxZoom >= currentZoom);

		if (showRegions && isVisibleAtZoom) {
			map.addLayer(label);
		} else {
			map.removeLayer(label);
		}
	});

	if (showRegions) {
		schedulePoliticalTerritoryLayerReload();
	}
}
