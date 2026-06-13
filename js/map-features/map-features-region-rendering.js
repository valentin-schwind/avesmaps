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
		politicalRegionDerivedByTerritory.set(key, {
			labelable,
			geometry: feature.geometry,
			color: properties.fill || properties.color || null,
			// Fuer die Aggregat-Fuellungs-Unterdrueckung: fuellt diese Derived (Zoom-Band) UND bringt sie
			// einen fill_remainder (gelochte Fuellung) mit? Dann uebernimmt sie das Fuellen -> das solide
			// Aggregat-Feature derselben territory_public_id darf NICHT zusaetzlich fuellen.
			derivedFillActive: properties.derived_fill_active === true,
			hasFillRemainder: !!properties.fill_remainder_geojson,
		});
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

// Umstrittenes Gebiet? (gleiche Quelle wie das Schraffur-Overlay: echte Layer-Daten ODER Test-Override).
// Wenn ja, wird die SVG-Fuellung ausgeschnitten (s. buildRegionPolygonStyle), damit die Schraffur ueber
// die Basis-Karte liegt statt ueber der Reichsfarbe.
function isRegionContested(regionEntry) {
	if (regionEntry && Array.isArray(regionEntry.contestedParties) && regionEntry.contestedParties.length) {
		return true;
	}
	const test = window.__avesmapsContestedClaims || null;
	if (test) {
		const keys = [regionEntry && regionEntry.territoryPublicId, regionEntry && regionEntry.aggregateSourceTerritoryPublicId, regionEntry && regionEntry.publicId];
		for (const key of keys) {
			const k = String(key || "");
			if (k && Array.isArray(test[k]) && test[k].length) {
				return true;
			}
		}
	}
	return false;
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
	// Frontend: einheitliche Fuell-Deckkraft für politische Flaechen (POLITICAL_FRONTEND_FILL_OPACITY),
	// damit nicht die unterschiedlichen per-Territorium-Deckkraefte (0.33/0.5/0.75) durchschlagen.
	// Editor unverändert (regionEntry.opacity); auf null setzen -> wieder per-Territorium.
	const activeFillOpacity = (!IS_EDIT_MODE
		&& regionEntry.source === "political_territory"
		&& typeof POLITICAL_FRONTEND_FILL_OPACITY === "number"
		&& Number.isFinite(POLITICAL_FRONTEND_FILL_OPACITY))
		? POLITICAL_FRONTEND_FILL_OPACITY
		: regionEntry.opacity;
	// Umstrittene-Gebiete-Split: eine FUELLENDE Derived MIT fill_remainder (gelochte Fuellung an den
	// Konflikt-Baronien) rendert ihre Fuellung AUCH bei sichtbaren Innengrenzen. Sonst (bisher) fuellte
	// nur das solide Aggregat ohne Loecher -> Terrain-Durchsicht zu, Schraffur wirkt opak. Das Aggregat
	// derselben territory_public_id wird unten (suppressFillForDerivedHoledFill) abgeschaltet.
	const derivedShowsHoledFill = regionEntry.isDerivedGeometry && regionEntry.derivedFillActive && !!regionEntry.fillRemainderGeojson;
	const fillOpacity = (regionEntry.isDerivedGeometry && (regionEntry.showInnerBoundaries || !regionEntry.derivedFillActive) && !derivedShowsHoledFill)
		? 0
		: activeFillOpacity;

	// Ebenenbasierter Linienstil für abgeleitete Aussengrenzen (Phase B, additiv).
	// Fällt auf das bisherige Verhalten zurück, wenn das Modul fehlt oder
	// keinen Stil vorgibt (z. B. normale Quellgeometrien).
	const levelLineStyle = window.AvesmapsBoundaryStyle?.lineStyleFor?.(regionEntry) || null;
	// Abgeleitete Außengrenzen zeichnet jetzt das Canvas-Overlay (clip-inside); die
	// SVG-Kontur der derived wird daher unterdrückt (weight 0), Fuellung bleibt.
	// Ebenso Quellflaechen unter einer aktiven Innen-Derived (strokeHidden): nur Fuellung,
	// keinen soliden Rand – das Canvas malt aussen solid + innen weiss-gestrichelt.
	const weight = regionEntry.isDerivedGeometry || regionEntry.strokeHiddenByDerivedBoundary ? 0 : (levelLineStyle ? levelLineStyle.weight : 2);

	// Frontend "Politisch": ein Source-Fragment eines Aggregats fuellt mit der AGGREGAT-Farbe
	// (Farbe der Derived-Huelle des Territoriums), nicht mit seiner eigenen (tieferen) Farbe.
	// So passt die angezeigte Flaechenfarbe zur angezeigten Hierarchie-Ebene (bei Zoom 0 die
	// Reichsfarbe, nicht die Farbe der untersten Quellgeometrie). Edit-Modus unverändert.
	let resolvedFillColor = regionEntry.color;
	// Aggregat-Fuellung unterdruecken, wenn die Derived dieses Territoriums fuellt UND einen fill_remainder
	// (gelochte Fuellung) hat -> die Derived rendert die Reichsfarbe MIT Terrain-Loechern an den Konflikt-
	// Baronien; das solide Aggregat-Feature wuerde die Loecher sonst zustopfen (Schraffur wirkt dann opak).
	let suppressFillForDerivedHoledFill = false;
	if (!IS_EDIT_MODE && !regionEntry.isDerivedGeometry) {
		const terrKey = String(regionEntry.territoryPublicId || "").trim();
		const aggregate = terrKey ? (politicalRegionDerivedByTerritory || indexPoliticalRegionDerivedByTerritory()).get(terrKey) : null;
		if (aggregate && aggregate.color) {
			resolvedFillColor = aggregate.color;
		}
		if (aggregate && aggregate.derivedFillActive && aggregate.hasFillRemainder) {
			suppressFillForDerivedHoledFill = true;
		}
	}

	const style = {
		color: regionEntry.color,
		weight,
		opacity: 1,
		fillColor: resolvedFillColor,
		// Umstrittene Gebiete: Fuellung ausschneiden (0), damit die diagonale Schraffur des Canvas-
		// Overlays ueber die Basis-Karte liegt statt ueber der Reichsfarbe. fill:true bleibt -> Polygon
		// bleibt klickbar (Infobox), Grenzen-Linie unberuehrt (eigenes Overlay).
		fillOpacity: (isRegionContested(regionEntry) || suppressFillForDerivedHoledFill) ? 0 : fillOpacity,
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
	// Frontend "Politisch": nur die Aussengrenze (Derived-Huelle) eines Aggregats ist interaktiv.
	// Source-Fragmente, für deren Territorium eine Derived-Huelle existiert, bekommen KEINEN eigenen
	// Hover-Handler (sonst springt/flackert der Tooltip über die einzelnen Fuell-Fragmente). Blatt-
	// Territorien ohne Derived bleiben über ihre Quellgeometrie interaktiv.
	const derivedByTerritoryForInteractivity = politicalRegionDerivedByTerritory || indexPoliticalRegionDerivedByTerritory();
	const territoryKeyForInteractivity = String(regionEntry.territoryPublicId || "").trim();
	const isAggregatedSourceFragment = !regionEntry.isDerivedGeometry
		&& territoryKeyForInteractivity !== ""
		&& derivedByTerritoryForInteractivity.has(territoryKeyForInteractivity);
	// Der Hover soll die AKTIVE Anzeige-Ebene treffen (die, die bei diesem Zoom gezeigt/gelabelt wird),
	// nicht eine tiefere/flachere. Zuverlaessigstes Signal ist das Zoom-Band (min/max_zoom, immer gesetzt;
	// derived_fill_active fehlt bei Fallback-Geometrien). Nur Features, deren Band den aktuellen Zoom
	// enthält, sind interaktiv.
	const currentZoomForInteractivity = Math.round(Number(map.getZoom()));
	const isAtActiveDisplayZoom = (regionEntry.minZoom === null || regionEntry.minZoom === undefined || Number(regionEntry.minZoom) <= currentZoomForInteractivity)
		&& (regionEntry.maxZoom === null || regionEntry.maxZoom === undefined || Number(regionEntry.maxZoom) >= currentZoomForInteractivity);
	// Umstrittene-Gebiete-Split: das FUELL-Polygon einer Derived aus fill_remainder bauen -> Loecher an
	// den Konflikt-Baronien, durch die das Terrain scheint (die Schraffur zeichnet das Overlay darueber).
	// Da Derived stroke-los ist (weight 0), malen die Loecher KEINE Raender. Grenze (Canvas-Overlay) und
	// Label nutzen weiter region.geometry (volle Union) -> Reichsumriss + Hover-Flaeche unberuehrt; der
	// Hover-Weiss-Wash ueberspringt die Loecher automatisch (= bestehendes "Hover laesst Schraffur stehen").
	const fillGeometry = (regionEntry.isDerivedGeometry && regionEntry.fillRemainderGeojson)
		? regionEntry.fillRemainderGeojson
		: region.geometry;
	let polygons = [];

	if (fillGeometry?.type === "Polygon") {
		polygons = [fillGeometry.coordinates];
	}

	if (fillGeometry?.type === "MultiPolygon") {
		polygons = fillGeometry.coordinates;
	}

	// Ganz-Reich umstritten: fill_remainder ist leer -> keine Fuell-Polygone. Fuer Hover/Klick trotzdem die
	// VOLLE Union rendern, aber UNSICHTBAR (fillOpacity 0) -> Terrain bleibt sichtbar, Schraffur liegt drueber.
	let forceInvisibleFill = false;
	if (regionEntry.isDerivedGeometry && polygons.length === 0) {
		if (region.geometry?.type === "Polygon") polygons = [region.geometry.coordinates];
		else if (region.geometry?.type === "MultiPolygon") polygons = region.geometry.coordinates;
		forceInvisibleFill = polygons.length > 0;
	}

	polygons.forEach((poly, index) => {
		const latlngs = poly.map(ring =>
			ring.map(([x, y]) => [y, x])
		);
		const polygon = L.polygon(latlngs, {
			pane: "regionsPane",
			...polygonStyle,
			...(forceInvisibleFill ? { fillOpacity: 0 } : {}),
			// Abgeleitete Außengrenzen sind nicht-interaktiv: ihre Kontur zeichnet das
			// Canvas-Overlay, das SVG-Polygon ist nur (ggf. unsichtbare) Füllung und darf
			// keine Klicks/Vertex-Edits abfangen (sonst landet update_geometry auf einer
			// Derived-ID -> "Geometrie nicht gefunden"). Klicks gehen an die Quellen.
			// View-Modus + politisch: auch abgeleitete Aussengrenzen (Aggregate) interaktiv machen,
			// damit die Hover-Infobox greift. Edit-Modus unverändert (derived nicht-interaktiv,
			// damit Klicks an die Quellgeometrien gehen).
			// View-Modus: der Hover soll die AKTIVE Anzeige-Ebene treffen (die, die man auf der Karte
			// sieht/gelabelt ist), nicht eine tiefere. Da pro Punkt mehrere Derived-Huellen verschiedener
			// Baender übereinanderliegen, ist nur die FUELLENDE/aktive Huelle (derivedFillActive) interaktiv.
			// Source-Geometrien nur als echte Blaetter (keine Derived-Huelle fürs Territorium).
			interactive: IS_EDIT_MODE
				? !regionEntry.isDerivedGeometry
				: (regionEntry.source === "political_territory"
					&& isAtActiveDisplayZoom
					&& (regionEntry.isDerivedGeometry || !isAggregatedSourceFragment)),
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
			// der "dicksten" Stelle (bei MultiPolygon im größten Teil), auch bei konkaven Formen
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
		bindRegionHoverTooltip(polygon, regionEntry);
	});

	// Hover-Bug-Fix (umstrittene Gebiete): bei einer Derived mit Split hat die SICHTBARE Fuellung LOECHER
	// an den Konflikt-Baronien (damit Terrain durchscheint). Ueber den Loechern gibt's dann keine Hover-
	// Flaeche -> kein weisser Wash. Eine UNSICHTBARE Voll-Huellen-Flaeche (fillOpacity 0) DRUNTER loest den
	// Hover ueberall aus; der Wash deckt dann die ganze Huelle. Nur bei TEIL-Konflikt noetig (forceInvisibleFill
	// = false); bei ganz umstritten ist die unsichtbare Huelle bereits das einzige Fuell-Polygon.
	if (regionEntry.isDerivedGeometry && regionEntry.fillRemainderGeojson && !forceInvisibleFill
		&& !visuallyHidden && !IS_EDIT_MODE && regionEntry.source === "political_territory" && isAtActiveDisplayZoom) {
		let hullPolys = [];
		if (region.geometry?.type === "Polygon") hullPolys = [region.geometry.coordinates];
		else if (region.geometry?.type === "MultiPolygon") hullPolys = region.geometry.coordinates;
		hullPolys.forEach((poly) => {
			const latlngs = poly.map(ring => ring.map(([x, y]) => [y, x]));
			const hoverHull = L.polygon(latlngs, { pane: "regionsPane", stroke: false, fill: true, fillOpacity: 0, interactive: true }).addTo(map);
			hoverHull._regionEntry = regionEntry;
			hoverHull.bringToBack();
			regionEntry.layers.push(hoverHull);
			regionPolygons.push(hoverHull);
			bindRegionHoverTooltip(hoverHull, regionEntry);
			bindRegionCompactTooltip(hoverHull, regionEntry);
		});
	}
}
