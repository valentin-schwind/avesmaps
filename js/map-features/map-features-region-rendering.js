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
		weight: 2,
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
	const regionBounds = readRegionGeometryBounds(region.geometry);
	if (!regionBounds) {
		return false;
	}

	return getActiveOuterBoundaryHideTargets().some((target) => {
		if (!target.bounds) {
			return false;
		}
		if (territoryPublicId && territoryPublicId === target.territoryPublicId) {
			return false;
		}
		if (aggregateSourceTerritoryPublicId && aggregateSourceTerritoryPublicId === target.territoryPublicId) {
			return false;
		}
		if (target.sourceTerritoryPublicIds.has(territoryPublicId) || target.sourceTerritoryPublicIds.has(aggregateSourceTerritoryPublicId)) {
			return true;
		}
		return regionBoundsAreInsideOrMostlyCovered(regionBounds, target.bounds);
	});
}

function getActiveOuterBoundaryHideTargets() {
	return (Array.isArray(regionData) ? regionData : [])
		.filter((feature) => feature?.properties?.is_derived_geometry === true && feature.properties.show_inner_boundaries === false)
		.map((feature) => {
			const properties = feature.properties || {};
			return {
				territoryPublicId: String(properties.territory_public_id || "").trim(),
				bounds: readRegionGeometryBounds(feature.geometry),
				sourceTerritoryPublicIds: readDerivedBoundarySourceTerritoryIds(properties),
			};
		})
		.filter((target) => target.bounds);
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

function readRegionGeometryBounds(geometry) {
	const coordinates = [];
	collectRegionGeometryCoordinates(geometry?.coordinates, coordinates);
	if (coordinates.length < 1) {
		return null;
	}
	const xValues = coordinates.map(([x]) => x);
	const yValues = coordinates.map(([, y]) => y);
	return {
		minX: Math.min(...xValues),
		maxX: Math.max(...xValues),
		minY: Math.min(...yValues),
		maxY: Math.max(...yValues),
		centerX: (Math.min(...xValues) + Math.max(...xValues)) / 2,
		centerY: (Math.min(...yValues) + Math.max(...yValues)) / 2,
	};
}

function collectRegionGeometryCoordinates(value, coordinates) {
	if (!Array.isArray(value)) {
		return;
	}
	if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
		coordinates.push([Number(value[0]), Number(value[1])]);
		return;
	}
	value.forEach((entry) => collectRegionGeometryCoordinates(entry, coordinates));
}

function regionBoundsAreInsideOrMostlyCovered(regionBounds, outerBounds) {
	const tolerance = 0.000001;
	const centerInside = regionBounds.centerX >= outerBounds.minX - tolerance
		&& regionBounds.centerX <= outerBounds.maxX + tolerance
		&& regionBounds.centerY >= outerBounds.minY - tolerance
		&& regionBounds.centerY <= outerBounds.maxY + tolerance;
	if (!centerInside) {
		return false;
	}

	const xOverlap = Math.max(0, Math.min(regionBounds.maxX, outerBounds.maxX) - Math.max(regionBounds.minX, outerBounds.minX));
	const yOverlap = Math.max(0, Math.min(regionBounds.maxY, outerBounds.maxY) - Math.max(regionBounds.minY, outerBounds.minY));
	const regionArea = Math.max(0.000001, (regionBounds.maxX - regionBounds.minX) * (regionBounds.maxY - regionBounds.minY));
	const overlapRatio = (xOverlap * yOverlap) / regionArea;
	return overlapRatio >= 0.6;
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
		polygon.bringToBack();
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
