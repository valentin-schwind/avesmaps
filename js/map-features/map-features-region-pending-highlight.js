function setPendingRegionTargetHighlight(regionEntry) {
	if (!pendingRegionOperation || regionEntry === pendingRegionOperation.sourceRegion) {
		clearPendingRegionTargetHighlight();
		return;
	}

	const layers = getRegionEntryLayers(regionEntry);
	if (pendingRegionTargetHighlightLayers.length === layers.length && layers.every((layer, index) => layer === pendingRegionTargetHighlightLayers[index].layer)) {
		return;
	}

	clearPendingRegionTargetHighlight();
	pendingRegionTargetHighlightLayers = layers.map((layer) => ({ layer, regionEntry }));
	pendingRegionTargetHighlightLayers.forEach(({ layer }) => {
		layer.setStyle({
			color: "#fff4a3",
			opacity: 1,
			weight: 5,
		});
		layer.bringToFront.();
	});
}

function clearPendingRegionTargetHighlight() {
	if (!pendingRegionTargetHighlightLayers.length) {
		return;
	}

	pendingRegionTargetHighlightLayers.forEach(({ layer, regionEntry }) => {
		layer.setStyle({
			color: regionEntry.color,
			fillColor: regionEntry.color,
			fillOpacity: regionEntry.opacity,
			opacity: 1,
			weight: 2,
		});
	});
	pendingRegionTargetHighlightLayers = [];
}
