function bindRegionCompactTooltip(polygon, regionEntry) {
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);

		if (!IS_EDIT_MODE) {
			openRegionCompactTooltip(regionEntry);
		}

		showPoliticalTerritoryTimelineSelection(regionEntry);
	});
}

function openRegionCompactTooltip(regionEntry) {
	closeRegionCompactTooltip();
	const tooltip = L.tooltip({
		direction: "top",
		offset: [0, -18],
		opacity: 1,
		className: "region-compact-tooltip",
		interactive: true,
	})
		.setLatLng(getRegionTooltipLatLng(regionEntry))
		.setContent(createRegionCompactTooltipMarkup(regionEntry));
	activeRegionInfoTooltip = tooltip;
	tooltip.addTo(map);
}

function closeRegionCompactTooltip() {
	if (activeRegionInfoTooltip) {
		map.removeLayer(activeRegionInfoTooltip);
		activeRegionInfoTooltip = null;
	}
}

function getRegionTooltipLatLng(regionEntry) {
	const bounds = getRegionEntryBounds(regionEntry);
	return regionEntry.label?.getLatLng?.() || bounds?.getCenter?.() || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter();
}

function focusRegionPlace(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (!markerEntry) {
		showFeedbackToast("Der verknuepfte Ort ist aktuell nicht geladen.", "warning");
		return;
	}

	map.flyTo(markerEntry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.8 });
	markerEntry.marker.openPopup();
}
