// Verarbeitung der Regionen
// Regions

// B: pro Render-Durchlauf merken, welche Territorien schon ein Label haben -> ein
// Territorium erzeugt nie zwei Labels (z. B. wenn Derived + Quelle koexistieren).
let politicalRegionLabeledTerritoryKeys = new Set();

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
	politicalRegionLabeledTerritoryKeys = new Set();
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

	// Feature #2: abgeleitete Aussengrenze fuellt nur im eigenen Zoom-Band. Ausserhalb
	// (derivedFillActive=false) oder bei sichtbaren Innengrenzen bleibt sie reine Kontur.
	const fillOpacity = regionEntry.isDerivedGeometry && (regionEntry.showInnerBoundaries || !regionEntry.derivedFillActive)
		? 0
		: regionEntry.opacity;

	// Ebenenbasierter Linienstil fuer abgeleitete Aussengrenzen (Phase B, additiv).
	// Faellt auf das bisherige Verhalten zurueck, wenn das Modul fehlt oder
	// keinen Stil vorgibt (z. B. normale Quellgeometrien).
	const levelLineStyle = window.AvesmapsBoundaryStyle?.lineStyleFor?.(regionEntry) || null;
	// Abgeleitete Außengrenzen zeichnet jetzt das Canvas-Overlay (clip-inside); die
	// SVG-Kontur der derived wird daher unterdrueckt (weight 0), Fuellung bleibt.
	const weight = regionEntry.isDerivedGeometry ? 0 : (levelLineStyle ? levelLineStyle.weight : 2);

	const style = {
		color: regionEntry.color,
		weight,
		opacity: 1,
		fillColor: regionEntry.color,
		fillOpacity,
	};
	if (levelLineStyle && levelLineStyle.dashArray) {
		style.dashArray = levelLineStyle.dashArray;
	}

	// C: Innengrenzen-Stil – Quellflaechen, die Quelle einer aktiven Außengrenze sind,
	// bekommen einen gestrichelt-transparenten weissen Rand. Er liegt unter der soliden
	// Außenkontur (Derived = bringToFront), die den Perimeter abdeckt -> nur die echten
	// inneren Trennlinien bleiben weiss-gestrichelt. Die Fuellung bleibt unveraendert.
	if (!regionEntry.isDerivedGeometry) {
		const innerIds = getActiveInnerBoundarySourceIds();
		const geomId = String(regionEntry.geometryPublicId || regionEntry.publicId || "").trim();
		const terrId = String(regionEntry.territoryPublicId || "").trim();
		if ((geomId && innerIds.geometryIds.has(geomId)) || (terrId && innerIds.territoryIds.has(terrId))) {
			style.color = "#ffffff";
			style.opacity = 0.6;
			style.weight = 1.5;
			style.dashArray = "5 4";
		}
	}
	return style;
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
	const geometryPublicId = String(properties.geometry_public_id || properties.public_id || regionEntry.geometryPublicId || regionEntry.publicId || region.id || "").trim();
	if (!territoryPublicId && !aggregateSourceTerritoryPublicId && !geometryPublicId) {
		return false;
	}

	return getActiveOuterBoundaryHideTargets().some((target) => {
		if (geometryPublicId && target.sourceGeometryPublicIds.has(geometryPublicId)) {
			return true;
		}
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
		// Quellen nur ausblenden, wenn die Außengrenze im eigenen Fuellband fuellt
		// (derived_fill_active). Ausserhalb (nur Kontur) bleiben die Kinder sichtbar
		// und werden als Innengrenzen gestrichelt-weiss gezeichnet.
		.filter((feature) => feature?.properties?.is_derived_geometry === true && feature.properties.show_inner_boundaries === false && feature.properties.derived_fill_active !== false)
		.map((feature) => {
			const properties = feature.properties || {};
			return {
				territoryPublicId: String(properties.territory_public_id || "").trim(),
				sourceTerritoryPublicIds: readDerivedBoundarySourceTerritoryIds(properties),
				sourceGeometryPublicIds: readDerivedBoundarySourceGeometryIds(properties),
			};
		})
		.filter((target) => target.sourceTerritoryPublicIds.size > 0 || target.sourceGeometryPublicIds.size > 0);
}

// C: Quell-IDs aller aktiven Außengrenzen (unabhaengig vom Innengrenzen-Haekchen) – ihre
// Quellflaechen werden als Innengrenzen (gestrichelt-weiss) gezeichnet.
function getActiveInnerBoundarySourceIds() {
	const geometryIds = new Set();
	const territoryIds = new Set();
	(Array.isArray(regionData) ? regionData : [])
		.filter((feature) => feature?.properties?.is_derived_geometry === true)
		.forEach((feature) => {
			const properties = feature.properties || {};
			readDerivedBoundarySourceGeometryIds(properties).forEach((id) => geometryIds.add(id));
			readDerivedBoundarySourceTerritoryIds(properties).forEach((id) => territoryIds.add(id));
		});
	return { geometryIds, territoryIds };
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

function readDerivedBoundarySourceGeometryIds(properties) {
	const ids = new Set();
	[properties.hidden_source_geometry_public_ids, properties.source_geometry_public_ids, properties.derived_source_geometry_public_ids].forEach((value) => {
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
		const territoryLabelKey = String(regionEntry.territoryPublicId || "").trim();
		const territoryAlreadyLabeled = territoryLabelKey !== "" && politicalRegionLabeledTerritoryKeys.has(territoryLabelKey);
		if (index === 0 && regionEntry.showRegionLabel !== false && !visuallyHidden && !territoryAlreadyLabeled) {
			if (territoryLabelKey !== "") politicalRegionLabeledTerritoryKeys.add(territoryLabelKey);
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
