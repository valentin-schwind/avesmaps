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
		f => f.properties?.type === "region"
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

function buildRegionPolygonStyle(regionEntry, region = null) {
	const visuallyHidden = shouldHideRegionForDerivedBoundary(region, regionEntry);
	if (visuallyHidden) {
		return {
			color: regionEntry.color,
			weight: 0,
			opacity: 0,
			fillColor: regionEntry.color,
			fillOpacity: 0,
		};
	}

	const fillOpacity = regionEntry.isDerivedGeometry && regionEntry.showInnerBoundaries
		? 0
		: regionEntry.opacity;

	return {
		color: regionEntry.color,
		weight: regionEntry.isDerivedGeometry ? 3 : 2,
		opacity: 1,
		fillColor: regionEntry.color,
		fillOpacity,
	};
}

function shouldHideRegionForDerivedBoundary(region, regionEntry) {
	if (regionEntry.visualHiddenByDerivedBoundary) {
		return true;
	}
	if (!region || regionEntry.isDerivedGeometry || regionEntry.source !== "political_territory") {
		return false;
	}

	const properties = region.properties || {};
	const territoryPublicId = String(properties.territory_public_id || regionEntry.territoryPublicId || "").trim();
	const aggregateSourceTerritoryPublicId = String(properties.aggregate_source_territory_public_id || "").trim();
	if (!territoryPublicId && !aggregateSourceTerritoryPublicId) {
		return false;
	}

	return getActiveOuterBoundaryHideTargets().some((target) => {
		if (territoryPublicId && territoryPublicId === target.territoryPublicId) {
			return false;
		}
		if (aggregateSourceTerritoryPublicId && aggregateSourceTerritoryPublicId === target.territoryPublicId) {
			return false;
		}
		return target.sourceTerritoryPublicIds.has(territoryPublicId)
			|| target.sourceTerritoryPublicIds.has(aggregateSourceTerritoryPublicId);
	});
}

function getActiveOuterBoundaryHideTargets() {
	return (Array.isArray(regionData) ? regionData : [])
		.filter((feature) => feature?.properties?.is_derived_geometry === true && feature.properties.show_inner_boundaries === false)
		.map((feature) => {
			const properties = feature.properties || {};
			return {
				territoryPublicId: String(properties.territory_public_id || "").trim(),
				sourceTerritoryPublicIds: readDerivedBoundarySourceTerritoryIds(properties),
			};
		})
		.filter((target) => target.sourceTerritoryPublicIds.size > 0);
}

function readDerivedBoundarySourceTerritoryIds(properties) {
	const ids = new Set();
	[properties.hidden_source_territory_public_ids, properties.source_territory_public_ids, properties.derived_source_territory_public_ids].forEach((value) => {
		if (Array.isArray(value)) {
			value.forEach((entry) => {
				const id = String(entry || "").trim();
				if (id) ids.add(id);
			});
		}
	});
	return ids;
}

function addRegionFeatureToMap(region, regionEntry) {
	const name = regionEntry.name;
	const visuallyHidden = shouldHideRegionForDerivedBoundary(region, regionEntry);
	const polygonStyle = buildRegionPolygonStyle(regionEntry, region);
	let polygons = [];

	if (region.geometry?.type === "Polygon") {
		polygons = [region.geometry.coordinates];
	}

	if (region.geometry?.type === "MultiPolygon") {
		polygons = region.geometry.coordinates;
	}

	polygons.forEach((poly, index) => {
		const latlngs = poly.map(ring =>
			ring.map(([x, y]) => [y, x])
		);
		const polygon = L.polygon(latlngs, {
			pane: "regionsPane",
			...polygonStyle,
			interactive: IS_EDIT_MODE || regionEntry.source === "political_territory",
		});
		polygon._regionEntry = regionEntry;
		polygon._regionPolygonIndex = index;
		regionEntry.layers.push(polygon);
		if (!regionEntry.layer) {
			regionEntry.layer = polygon;
		}
		bindRegionPolygonEditEvents(polygon, regionEntry);
		if (regionEntry.isDerivedGeometry) {
			polygon.bringToFront();
		} else {
			polygon.bringToBack();
		}
		regionPolygons.push(polygon);
		if (index === 0 && regionEntry.showRegionLabel !== false && !visuallyHidden) {
			const labelLatLng = regionEntry.labelLat !== null && regionEntry.labelLng !== null
				? L.latLng(regionEntry.labelLat, regionEntry.labelLng)
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
