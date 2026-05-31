// Verarbeitung der Regionen
// Regions

// B: pro Render-Durchlauf merken, welche Territorien schon ein Label haben -> ein
// Territorium erzeugt nie zwei Labels (z. B. wenn Derived + Quelle koexistieren).
let politicalRegionLabeledTerritoryKeys = new Set();

// Index pro Render: territory_public_id -> { labelable, geometry } des Derived-Features.
// `geometry` = volle Hülle (für den zentralen polylabel-Label-Anker, egal welches Feature
// das Label trägt). `labelable` = trägt die Derived in diesem Render selbst ein Label
// (show_region_label nicht false, nicht versteckt) -> nur dann weicht eine Quelle aus.
// Lazy pro Render aufgebaut (null = stale).
let politicalRegionDerivedByTerritory = null;

function indexPoliticalRegionDerivedByTerritory() {
	politicalRegionDerivedByTerritory = new Map();
	(Array.isArray(regionData) ? regionData : []).forEach((feature) => {
		const properties = feature?.properties;
		if (!properties || properties.is_derived_geometry !== true) {
			return;
		}
		const key = String(properties.territory_public_id || "").trim();
		if (!key || politicalRegionDerivedByTerritory.has(key)) {
			return;
		}
		const labelable = properties.show_region_label !== false && properties.visual_hidden_by_derived_boundary !== true;
		politicalRegionDerivedByTerritory.set(key, { labelable, geometry: feature.geometry });
	});
	return politicalRegionDerivedByTerritory;
}

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
	politicalRegionDerivedByTerritory = null;
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
	// Ebenso Quellflaechen unter einer aktiven Innen-Derived (strokeHidden): nur Fuellung,
	// keinen soliden Rand – das Canvas malt aussen solid + innen weiss-gestrichelt.
	const weight = regionEntry.isDerivedGeometry || regionEntry.strokeHiddenByDerivedBoundary ? 0 : (levelLineStyle ? levelLineStyle.weight : 2);

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

	// Innengrenzen werden jetzt vom Canvas-Overlay aus der vorberechneten, deduppten
	// inner_boundary_geojson gezeichnet (eine Linie pro geteilter Grenze, genau 1 Tiefe).
	// Das alte "C"-Restyling der Quellpolygone (jede Quelle malte ihren vollen Ring ->
	// Doppellinien) ist damit entfallen.
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
			// Abgeleitete Außengrenzen sind nicht-interaktiv: ihre Kontur zeichnet das
			// Canvas-Overlay, das SVG-Polygon ist nur (ggf. unsichtbare) Füllung und darf
			// keine Klicks/Vertex-Edits abfangen (sonst landet update_geometry auf einer
			// Derived-ID -> "Geometrie nicht gefunden"). Klicks gehen an die Quellen.
			interactive: (IS_EDIT_MODE || regionEntry.source === "political_territory") && !regionEntry.isDerivedGeometry,
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
		// Wenn das Gebiet eine Derived (volle Hülle) hat, soll NUR die das Label tragen
		// (zentraler polylabel-Punkt) — Quell-Fragmente weichen aus, auch wenn sie früher kommen.
		const derivedKeys = politicalRegionDerivedByTerritory || indexPoliticalRegionDerivedByTerritory();
		const derivedInfo = derivedKeys.get(territoryLabelKey) || null;
		const deferLabelToDerived = !regionEntry.isDerivedGeometry && territoryLabelKey !== "" && derivedInfo !== null && derivedInfo.labelable === true;
		if (index === 0 && regionEntry.showRegionLabel !== false && !visuallyHidden && !territoryAlreadyLabeled && !deferLabelToDerived) {
			if (territoryLabelKey !== "") politicalRegionLabeledTerritoryKeys.add(territoryLabelKey);
			// Label-Anker = Pole of Inaccessibility (polylabel) der Feature-Geometrie: liegt in
			// der "dicksten" Stelle (bei MultiPolygon im groessten Teil), auch bei konkaven Formen
			// sicher INNEN. Fallback: gespeicherter Wert, dann BBox-Mitte.
			const labelPoi = typeof avesmapsComputeLabelPoint === "function"
				? avesmapsComputeLabelPoint((derivedInfo && derivedInfo.geometry) ? derivedInfo.geometry : region.geometry)
				: null;
			const labelLatLng = labelPoi
				? L.latLng(labelPoi.y, labelPoi.x)
				: (regionEntry.labelLat !== null && regionEntry.labelLng !== null
					? L.latLng(regionEntry.labelLat, regionEntry.labelLng)
					: polygon.getBounds().getCenter());
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
			label._regionLabelPriority = labelPoi ? labelPoi.distance : 0; regionLabels.push(label);
		}
		bindRegionCompactTooltip(polygon, regionEntry);
	});
}
