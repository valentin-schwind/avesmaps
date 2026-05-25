// Verarbeitung der Regionen
// Regions
function prepareRegionData(data) {
	politicalTerritoryFallbackData = data;
	clearRenderedRegionLayers();
	if (POLITICAL_TERRITORIES_API_URL) {
		void loadPoliticalTerritoryOptions();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		return;
	}

	prepareLegacyRegionData(data);
}

function prepareLegacyRegionData(data) {
	clearRenderedRegionLayers();
	regionData = data.features.filter(
		f => f.properties.type === "region"
	);

	regionData.forEach(region => {
		const regionEntry = normalizeRegionFeature(region);
		addRegionFeatureToMap(region, regionEntry);
	});
}

function clearRenderedRegionLayers() {
	closeRegionCompactTooltip();
	clearPendingRegionTargetHighlight();
	recentRegionOverlapSelection = null;
	regionPolygons.forEach((polygon) => map.removeLayer(polygon));
	regionLabels.forEach((label) => map.removeLayer(label));
	regionPolygons = [];
	regionLabels = [];
	regionData = [];
	clearRegionGeometryEdit();
}

function addRegionFeatureToMap(region, regionEntry) {
	const name = regionEntry.name;
	const fill = regionEntry.color;
	const stroke = regionEntry.color;
	const fillOpacity = regionEntry.opacity;
	let polygons = [];

	if (region.geometry.type === "Polygon") {
		polygons = [region.geometry.coordinates];
	}

	if (region.geometry.type === "MultiPolygon") {
		polygons = region.geometry.coordinates;
	}

	polygons.forEach((poly, index) => {
		const latlngs = poly.map(ring =>
			ring.map(([x, y]) => [y, x])
		);
		const polygon = L.polygon(latlngs, {
			pane: "regionsPane",
			color: stroke,
			weight: 2,
			fillColor: fill,
			fillOpacity,
			interactive: IS_EDIT_MODE || regionEntry.source === "political_territory",
		});
		polygon._regionEntry = regionEntry;
		polygon._regionPolygonIndex = index;
		regionEntry.layers.push(polygon);
		if (!regionEntry.layer) {
			regionEntry.layer = polygon;
		}
		bindRegionPolygonEditEvents(polygon, regionEntry);
		polygon.bringToBack();
		regionPolygons.push(polygon);
		if (index === 0 && regionEntry.showRegionLabel !== false) {
			const labelLatLng = regionEntry.labelLat !== null && regionEntry.labelLng !== null
				 L.latLng(regionEntry.labelLat, regionEntry.labelLng)
				: polygon.getBounds().getCenter();
			const label = L.tooltip({
				permanent: true,
				direction: "center",
				offset: [0, 0],
				opacity: 1,
				className: "region-label",
				pane: "regionLabelsPane"
			})
				.setLatLng(labelLatLng)
				.setContent(createRegionLabelMarkup(regionEntry, name));

			regionEntry.label = label;
			regionLabels.push(label);
		}
		bindRegionCompactTooltip(polygon, regionEntry);
	});
}
