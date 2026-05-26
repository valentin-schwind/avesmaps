// Runtime-Patches und spaet installierte Verhaltensanpassungen.
// Diese Datei haelt bewusst keine reine Konfiguration, sondern installiert Laufzeitverhalten,
// das von global geladenen Avesmaps-Modulen abhaengt.

const politicalTerritoryLayerFetchCache = new Map();

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

function buildPoliticalTerritoryLayerCacheKey(url) {
	const cacheUrl = new URL(url.toString());
	cacheUrl.searchParams.delete("zoom");
	return cacheUrl.toString();
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

		const fallbackLayers = await readPoliticalTerritoryLayerFallbacks(originalFetch, requestUrl, init, currentLayer);
		if (fallbackLayers.length < 1) {
			return response;
		}

		const mergedLayer = mergePoliticalTerritoryLayerGeometryFeatures(currentLayer, fallbackLayers);
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
installPoliticalRegionVisibilityBehavior();
