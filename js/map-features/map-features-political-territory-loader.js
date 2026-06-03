/*
 * Extracted political territory loader/reload helpers from js/map-features.js.
 * This file contains political territory layer runtime behavior and loader helpers.
 */

const politicalTerritoryLayerFetchCache = new Map();
const politicalTerritoryPendingStyleOverrides = new Map();
const politicalTerritoryStyleCache = new Map();
let politicalTerritoryStyleCachePromise = null;
let politicalTerritoryStyleCacheLoadedAt = 0;
const POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS = 1000;

function getPoliticalTerritoryFetchUrl(input) {
	if (typeof Request !== "undefined" && input instanceof Request) {
		return input.url;
	}

	return String(input || "");
}

function isPoliticalTerritoryLayerRequest(input) {
	if (!POLITICAL_TERRITORIES_API_URL) {
		return false;
	}

	try {
		const requestUrl = new URL(getPoliticalTerritoryFetchUrl(input), window.location.href);
		const configuredUrl = new URL(POLITICAL_TERRITORIES_API_URL, window.location.href);
		const isPoliticalEndpoint = requestUrl.pathname === configuredUrl.pathname
			|| /\/api\/political-territories(?:-2)?\.php$/u.test(requestUrl.pathname);
		const action = requestUrl.searchParams.get("action") || "layer";
		return isPoliticalEndpoint && action === "layer";
	} catch (error) {
		return false;
	}
}

function normalizePoliticalTerritoryStyleEntry(entry) {
	const publicId = String(entry?.public_id || entry?.publicId || entry?.territory_public_id || entry?.territoryPublicId || "").trim();
	const rawColor = String(entry?.color || "").trim();
	const color = normalizeRegionHexColor(rawColor);
	if (!publicId || color === "#888888" && !/^#888888$/i.test(rawColor)) {
		return null;
	}

	const opacity = Number(entry?.opacity);
	return {
		publicId,
		color,
		opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : null,
		minZoom: readOptionalRegionZoom(entry?.min_zoom ?? entry?.minZoom),
		maxZoom: readOptionalRegionZoom(entry?.max_zoom ?? entry?.maxZoom),
	};
}

function rememberPoliticalTerritoryStyleEntry(entry) {
	const styleEntry = normalizePoliticalTerritoryStyleEntry(entry);
	if (!styleEntry) {
		return null;
	}

	politicalTerritoryStyleCache.set(styleEntry.publicId, styleEntry);
	return styleEntry;
}

async function refreshPoliticalTerritoryStyleCache({ force = false } = {}) {
	if (!IS_EDIT_MODE || !POLITICAL_TERRITORIES_API_URL) {
		return politicalTerritoryStyleCache;
	}

	const now = Date.now();
	if (!force && politicalTerritoryStyleCache.size > 0 && now - politicalTerritoryStyleCacheLoadedAt < POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS) {
		return politicalTerritoryStyleCache;
	}
	if (!force && politicalTerritoryStyleCachePromise) {
		return politicalTerritoryStyleCachePromise;
	}

	politicalTerritoryStyleCachePromise = (async () => {
		try {
			const response = await fetchPoliticalTerritories({
				action: "list",
			});
			politicalTerritoryStyleCache.clear();
			(Array.isArray(response?.territories) ? response.territories : []).forEach(rememberPoliticalTerritoryStyleEntry);
			politicalTerritoryStyleCacheLoadedAt = Date.now();
		} catch (error) {
			console.warn("Herrschaftsgebiet-Farben konnten nicht geladen werden:", error);
		} finally {
			politicalTerritoryStyleCachePromise = null;
		}

		return politicalTerritoryStyleCache;
	})();

	return politicalTerritoryStyleCachePromise;
}

function registerPoliticalTerritoryPendingStyleOverride(territoryPublicId, { color, opacity, minZoom = null, maxZoom = null } = {}) {
	const normalizedTerritoryPublicId = String(territoryPublicId || "").trim();
	const rawColor = String(color || "").trim();
	const normalizedColor = normalizeRegionHexColor(rawColor);
	if (!normalizedTerritoryPublicId || normalizedColor === "#888888" && !/^#888888$/i.test(rawColor)) {
		return;
	}

	const override = {
		color: normalizedColor,
		opacity: Number.isFinite(Number(opacity)) ? Math.min(1, Math.max(0, Number(opacity))) : null,
		minZoom: readOptionalRegionZoom(minZoom),
		maxZoom: readOptionalRegionZoom(maxZoom),
		createdAt: Date.now(),
	};
	politicalTerritoryPendingStyleOverrides.set(normalizedTerritoryPublicId, override);
	politicalTerritoryStyleCache.set(normalizedTerritoryPublicId, {
		publicId: normalizedTerritoryPublicId,
		color: override.color,
		opacity: override.opacity,
		minZoom: override.minZoom,
		maxZoom: override.maxZoom,
	});
}

function getPoliticalTerritoryStyleTargetId(properties) {
	return String(
		properties?.territory_public_id
		|| properties?.label_territory_public_id
		|| properties?.aggregate_source_territory_public_id
		|| ""
	).trim();
}

function applyPoliticalTerritoryStyleEntry(feature, styleEntry) {
	const properties = feature?.properties;
	if (!properties || typeof properties !== "object" || !styleEntry) {
		return feature;
	}

	properties.fill = styleEntry.color;
	properties.stroke = styleEntry.color;
	if (styleEntry.opacity !== null) {
		properties.fillOpacity = styleEntry.opacity;
	}
	if (styleEntry.minZoom !== null) {
		properties.min_zoom = styleEntry.minZoom;
	}
	if (styleEntry.maxZoom !== null) {
		properties.max_zoom = styleEntry.maxZoom;
	}

	return feature;
}

function applyPoliticalTerritoryCachedStyle(feature, styleCache = politicalTerritoryStyleCache) {
	const properties = feature?.properties;
	if (!properties || typeof properties !== "object") {
		return feature;
	}

	const territoryPublicId = getPoliticalTerritoryStyleTargetId(properties);
	if (!territoryPublicId || !styleCache.has(territoryPublicId)) {
		return feature;
	}

	return applyPoliticalTerritoryStyleEntry(feature, styleCache.get(territoryPublicId));
}

function applyPoliticalTerritoryPendingStyleOverrides(feature) {
	const properties = feature?.properties;
	if (!properties || typeof properties !== "object") {
		return feature;
	}

	const territoryPublicId = getPoliticalTerritoryStyleTargetId(properties);
	if (!territoryPublicId || !politicalTerritoryPendingStyleOverrides.has(territoryPublicId)) {
		return feature;
	}

	const override = politicalTerritoryPendingStyleOverrides.get(territoryPublicId);
	if (Date.now() - override.createdAt > 5 * 60 * 1000) {
		politicalTerritoryPendingStyleOverrides.delete(territoryPublicId);
		return feature;
	}

	return applyPoliticalTerritoryStyleEntry(feature, override);
}

function readPoliticalTerritoryDerivedSourceIds(properties) {
	const ids = new Set();
	[
		properties?.derived_source_territory_public_ids,
		properties?.source_territory_public_ids,
		properties?.hidden_source_territory_public_ids,
	].forEach((value) => {
		if (!Array.isArray(value)) {
			return;
		}
		value.forEach((entry) => {
			const id = String(entry || "").trim();
			if (id) {
				ids.add(id);
			}
		});
	});
	return ids;
}

function applyPoliticalTerritoryDerivedBoundaryVisibility(features) {
	const hiddenSourceIds = new Map();
	(Array.isArray(features) ? features : []).forEach((feature) => {
		const properties = feature?.properties || {};
		if (properties.is_derived_geometry !== true || properties.show_inner_boundaries !== false) {
			return;
		}
		const derivedTerritoryPublicId = String(properties.territory_public_id || "").trim();
		readPoliticalTerritoryDerivedSourceIds(properties).forEach((sourceId) => {
			hiddenSourceIds.set(sourceId, derivedTerritoryPublicId);
		});
	});

	if (hiddenSourceIds.size < 1) {
		return features;
	}

	(Array.isArray(features) ? features : []).forEach((feature) => {
		const properties = feature?.properties;
		if (!properties || properties.is_derived_geometry === true) {
			return;
		}
		const territoryPublicId = String(properties.territory_public_id || "").trim();
		const aggregateSourceTerritoryPublicId = String(properties.aggregate_source_territory_public_id || "").trim();
		const hiddenBy = hiddenSourceIds.get(territoryPublicId) || hiddenSourceIds.get(aggregateSourceTerritoryPublicId) || "";
		if (!hiddenBy) {
			return;
		}

		properties.visual_hidden_by_derived_boundary = true;
		properties.hidden_by_derived_territory_public_id = hiddenBy;
		properties.opacity = 0;
		properties.fillOpacity = 0;
		properties.fill_opacity = 0;
		properties.strokeOpacity = 0;
		properties.show_region_label = false;
	});

	return features;
}

function getResolvedPoliticalTerritoryLayerFallbacks(url) {
	const cacheKey = buildPoliticalTerritoryLayerCacheKey(url);
	const cachedEntry = politicalTerritoryLayerFetchCache.get(cacheKey);
	if (cachedEntry && Array.isArray(cachedEntry.promise?.__resolvedLayers) && Date.now() - cachedEntry.createdAt < POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS) {
		return cachedEntry.promise.__resolvedLayers;
	}
	return null;
}

function buildPoliticalTerritoryLayerCacheKey(url) {
	const cacheUrl = new URL(url.toString());
	cacheUrl.searchParams.delete("zoom");
	return cacheUrl.toString();
}

function isPoliticalTerritoryDerivedFeature(feature) {
	return feature?.properties?.is_derived_geometry === true;
}

function clonePoliticalTerritoryGeometryFallbackFeature(feature, sourceZoom) {
	const properties = {
		...(feature.properties || {}),
		show_region_label: false,
		is_zoom_fallback_geometry: true,
		fallback_source_zoom: sourceZoom,
	};
	delete properties.label_lng;
	delete properties.label_lat;

	return {
		...feature,
		properties,
	};
}

function getPoliticalTerritoryGeometryMergeKey(feature) {
	const properties = feature?.properties || {};
	return String(properties.geometry_public_id || properties.public_id || feature?.id || "");
}

function mergePoliticalTerritoryLayerGeometryFeatures(baseLayer, fallbackLayers) {
	const mergedLayer = {
		...baseLayer,
		features: Array.isArray(baseLayer.features) ? [...baseLayer.features] : [],
	};
	const existingGeometryKeys = new Set(
		mergedLayer.features
			.map(getPoliticalTerritoryGeometryMergeKey)
			.filter(Boolean)
	);

	fallbackLayers.forEach((fallbackLayer) => {
		const sourceZoom = Number(fallbackLayer?.zoom);
		(fallbackLayer?.features || []).forEach((feature) => {
			if (isPoliticalTerritoryDerivedFeature(feature) || feature?.properties?.visual_hidden_by_derived_boundary === true) {
				return;
			}
			const geometryKey = getPoliticalTerritoryGeometryMergeKey(feature);
			if (!geometryKey || existingGeometryKeys.has(geometryKey)) {
				return;
			}

			existingGeometryKeys.add(geometryKey);
			mergedLayer.features.push(clonePoliticalTerritoryGeometryFallbackFeature(feature, sourceZoom));
		});
	});

	return mergedLayer;
}

async function readPoliticalTerritoryLayerFallbacks(originalFetch, requestUrl, init, currentLayer) {
	const cacheKey = buildPoliticalTerritoryLayerCacheKey(requestUrl);
	const cachedEntry = politicalTerritoryLayerFetchCache.get(cacheKey);
	const now = Date.now();
	if (cachedEntry && now - cachedEntry.createdAt < POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS) {
		return cachedEntry.promise;
	}

	const currentZoom = Number(currentLayer?.zoom ?? requestUrl.searchParams.get("zoom"));
	const fallbackPromise = Promise.all(
		POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS
			.filter((zoomLevel) => zoomLevel !== currentZoom)
			.map(async (zoomLevel) => {
				const fallbackUrl = new URL(requestUrl.toString());
				fallbackUrl.searchParams.set("zoom", String(zoomLevel));
				try {
					const response = await originalFetch(fallbackUrl.toString(), {
						credentials: init?.credentials,
						headers: init?.headers,
						signal: init?.signal,
					});
					if (!response.ok) {
						return null;
					}

					const layer = await response.json();
					return layer?.ok && Array.isArray(layer.features) ? layer : null;
				} catch (error) {
					if (error?.name !== "AbortError") {
						console.warn("Herrschaftsgebiets-Geometrien konnten fuer eine Zoomstufe nicht nachgeladen werden:", error);
					}
					return null;
				}
			})
	).then((layers) => layers.filter(Boolean));
	// Aufgeloesten Wert am Promise vermerken, damit der Interceptor den Fan-out-Cache synchron (nicht blockierend) lesen kann.
	fallbackPromise.__resolvedLayers = null;
	fallbackPromise.then((layers) => { fallbackPromise.__resolvedLayers = layers; });

	politicalTerritoryLayerFetchCache.set(cacheKey, {
		createdAt: now,
		promise: fallbackPromise,
	});

	return fallbackPromise;
}

function installPoliticalTerritoryLayerGeometryMerge() {
	if (window.__avesmapsPoliticalTerritoryLayerGeometryMergeInstalled || typeof window.fetch !== "function") {
		return;
	}
	window.__avesmapsPoliticalTerritoryLayerGeometryMergeInstalled = true;

	const originalFetch = window.fetch.bind(window);
	window.fetch = async function avesmapsFetch(input, init) {
		const response = await originalFetch(input, init);
		if (!isPoliticalTerritoryLayerRequest(input)) {
			return response;
		}

		let requestUrl = null;
		let currentLayer = null;
		try {
			requestUrl = new URL(getPoliticalTerritoryFetchUrl(input), window.location.href);
			currentLayer = await response.clone().json();
		} catch (error) {
			return response;
		}

		if (!currentLayer?.ok || !Array.isArray(currentLayer.features)) {
			return response;
		}

		// Fan-out (Nachbarzoom-Geometrien) NICHT blockierend: nur aus dem Cache mergen, sonst den
		// Primaer-Layer (alle Labels + aktuelle Geometrien) SOFORT liefern und den Fan-out im
		// Hintergrund vorwaermen. Spart ~1.5s pro Zoom; der Fan-out ergaenzt nur wenige Geometrien
		// von Nachbar-Zoomstufen und KEINE Labels -> erscheint beim naechsten Cache-Treffer.
		const fallbackLayers = getResolvedPoliticalTerritoryLayerFallbacks(requestUrl);
		if (!fallbackLayers) {
			void readPoliticalTerritoryLayerFallbacks(originalFetch, requestUrl, init, currentLayer);
		}
		const mergedLayer = (!fallbackLayers || fallbackLayers.length < 1)
			? { ...currentLayer, features: [...currentLayer.features] }
			: mergePoliticalTerritoryLayerGeometryFeatures(currentLayer, fallbackLayers);
		applyPoliticalTerritoryDerivedBoundaryVisibility(mergedLayer.features);
		const headers = new Headers(response.headers);
		headers.set("content-type", "application/json; charset=utf-8");

		return new Response(JSON.stringify(mergedLayer), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
}

function installPoliticalRegionVisibilityBehavior() {
	if (typeof window.syncRegionVisibility !== "function") {
		return;
	}

	window.syncRegionVisibility = function syncRegionVisibility() {
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
			if (showRegions) {
				map.addLayer(layer);
			} else {
				map.removeLayer(layer);
			}
		});

		regionLabels.forEach((label) => {
			const regionEntry = regionData.find((entry) => entry?._normalizedRegionEntry?.label === label)
				|| regionPolygons.map((polygon) => polygon?._regionEntry).find((entry) => entry?.label === label)
				|| null;
			const minZoom = readOptionalRegionZoom(regionEntry?.minZoom);
			const maxZoom = readOptionalRegionZoom(regionEntry?.maxZoom);
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
	};
}

installPoliticalTerritoryLayerGeometryMerge();
document.body.classList.toggle("edit-mode", IS_EDIT_MODE);
[0, 50, 250].forEach((delay) => window.setTimeout(installPoliticalRegionVisibilityBehavior, delay));
document.addEventListener("DOMContentLoaded", installPoliticalRegionVisibilityBehavior, { once: true });

function schedulePoliticalTerritoryLayerReload({ immediate = false } = {}) {
	if (!POLITICAL_TERRITORIES_API_URL || politicalTerritoryApiUnavailable || isPoliticalTerritoryLayerLoading || getSelectedMapLayerMode() !== "political") {
		return;
	}
	if (!immediate && (activeRegionGeometryEdit || pendingRegionOperation || pendingRegionMoveState)) {
		return;
	}

	if (politicalTerritoryLayerReloadTimerId) {
		window.clearTimeout(politicalTerritoryLayerReloadTimerId);
	}

	const delay = immediate ? 0 : 180;
	politicalTerritoryLayerReloadTimerId = window.setTimeout(() => {
		politicalTerritoryLayerReloadTimerId = null;
		void loadPoliticalTerritoryLayer();
	}, delay);
}

function cancelPoliticalTerritoryLayerReload() {
	if (!politicalTerritoryLayerReloadTimerId) {
		return;
	}

	window.clearTimeout(politicalTerritoryLayerReloadTimerId);
	politicalTerritoryLayerReloadTimerId = null;
}

async function loadPoliticalTerritoryLayer() {
	if (isPoliticalTerritoryLayerLoading || !POLITICAL_TERRITORIES_API_URL) {
		return;
	}

	window.__avesmapsPoliticalLayerRequestSeq = (window.__avesmapsPoliticalLayerRequestSeq || 0) + 1;
	const requestSeq = window.__avesmapsPoliticalLayerRequestSeq;
	isPoliticalTerritoryLayerLoading = true;
	try {
		const response = await fetchPoliticalTerritories({
			action: "layer",
			year_bf: politicalTimelineYear,
			zoom: Math.round(map.getZoom()),
			edit_mode: IS_EDIT_MODE ? 1 : 0,
		});
		// Kein Force pro Layer-Load mehr: der 1s-TTL haelt den Style-Cache aktuell,
		// und frisch gespeicherte Eigenschaften kommen sofort ueber den Pending-Style-Override.
		// Das spart im Edit-Modus einen action=list-Komplettabruf bei jedem Zoom/Pan.
		const territoryStyleCache = await refreshPoliticalTerritoryStyleCache();
		if (activeRegionGeometryEdit || pendingRegionOperation || pendingRegionMoveState) {
			return;
		}
		if (requestSeq !== window.__avesmapsPoliticalLayerRequestSeq) {
			return;
		}
		politicalTerritoryApiUnavailable = false;
		clearPoliticalTerritoryTimelineSelection();
		clearRenderedRegionLayers();
		regionData = Array.isArray(response.features) ? response.features : [];
		regionData.forEach((region) => {
			applyPoliticalTerritoryCachedStyle(region, territoryStyleCache);
			applyPoliticalTerritoryPendingStyleOverrides(region);
		});
		applyPoliticalTerritoryDerivedBoundaryVisibility(regionData);
		regionData.forEach((region) => {
			addRegionFeatureToMap(region, normalizeRegionFeature(region));
		});
		syncRegionVisibility();
		window.AvesmapsBoundaryCanvasOverlay?.redraw?.();
		// Territorie-Label-Abstoßung NACH dem Label-Render auslösen (sonst überschreibt der
		// Reload das Ergebnis wieder -> Label "springt" und die Abstoßung bleibt wirkungslos).
		if (typeof scheduleLabelCollisionResolution === "function") {
			scheduleLabelCollisionResolution();
		}
	} catch (error) {
		console.warn("Herrschaftsgebiete konnten nicht geladen werden:", error);
		politicalTerritoryApiUnavailable = false;
	} finally {
		isPoliticalTerritoryLayerLoading = false;
	}
}

async function loadPoliticalTerritoryOptions({ force = false } = {}) {
	if (!IS_EDIT_MODE) {
		politicalTerritoryOptionsLoaded = true;
		return politicalTerritoryOptions;
	}
	if (!force && politicalTerritoryOptionsSource === "wiki" && politicalTerritoryOptionsLoaded) {
		return politicalTerritoryOptions;
	}
	if (!force && politicalTerritoryOptionsPromise) {
		return politicalTerritoryOptionsPromise;
	}

	politicalTerritoryOptionsLoading = true;
	politicalTerritoryOptionsPromise = (async () => {
		try {
			const response = await fetchWikiSyncTerritoryData({
				action: "territories_tree",
				force_refresh: force ? 1 : undefined,
			});
			const territories = Array.isArray(response.territories) ? response.territories : [];
			const hierarchy = Array.isArray(response.hierarchy) ? response.hierarchy : [];
			const hasIncomingTreeData = territories.length > 0 || hierarchy.length > 0;
			const hasExistingTreeData = politicalTerritoryOptions.length > 0 || politicalTerritoryHierarchy.length > 0;
			politicalTerritoryOptionsLoaded = true;
			if (hasIncomingTreeData || !hasExistingTreeData) {
				politicalTerritoryOptions = territories;
				politicalTerritoryHierarchy = hierarchy;
				politicalTerritoryOptionsSource = "wiki";
			} else {
				console.warn("Wiki-Herrschaftsgebiet-Baum lieferte keine Eintraege; bestehender Baum bleibt erhalten.");
			}
			territories.forEach(rememberPoliticalTerritoryStyleEntry);
			politicalTerritoryStyleCacheLoadedAt = Date.now();
			return politicalTerritoryOptions;
		} catch (error) {
			console.warn("Wiki-Herrschaftsgebiet-Baum konnte nicht geladen werden:", error);
			politicalTerritoryOptionsLoaded = true;
			console.warn("Datenbank-Fallback fuer Herrschaftsgebiet-Baum deaktiviert, bestehende Wiki-Daten bleiben erhalten.");
			return politicalTerritoryOptions;
		} finally {
			politicalTerritoryOptionsLoading = false;
			politicalTerritoryOptionsPromise = null;
		}
	})();

	return politicalTerritoryOptionsPromise;
}

function preloadPoliticalTerritoryOptions() {
	if (!IS_EDIT_MODE || !POLITICAL_TERRITORIES_API_URL) {
		return;
	}

	void loadPoliticalTerritoryOptions();
}
