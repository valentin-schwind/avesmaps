/*
 * Extracted region split preview helper functions from js/map-features.js.
 * This file contains only global function declarations and no top-level execution.
 */

function updatePendingRegionSplitPreview(points) {
	clearPendingRegionSplitPreview();
	const validPoints = points.map((point) => L.latLng(point)).filter(Boolean);
	if (validPoints.length < 1) {
		return;
	}

	const previewGroup = L.layerGroup().addTo(map);
	L.circleMarker(validPoints[0], {
		pane: "measurementHandlesPane",
		radius: 5,
		color: "#385d72",
		fillColor: "#fff",
		fillOpacity: 1,
		weight: 2,
		interactive: false,
	}).addTo(previewGroup);
	if (validPoints.length > 1) {
		L.polyline(validPoints.slice(0, 2), {
			pane: "measurementPane",
			color: "#385d72",
			weight: 2,
			dashArray: "6 4",
			interactive: false,
		}).addTo(previewGroup);
	}
	pendingRegionSplitPreviewLayer = previewGroup;
}

function clearPendingRegionSplitPreview() {
	if (pendingRegionSplitPreviewLayer) {
		map.removeLayer(pendingRegionSplitPreviewLayer);
		pendingRegionSplitPreviewLayer = null;
	}
}
