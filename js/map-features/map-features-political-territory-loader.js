/*
 * Extracted political territory loader/reload helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

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

	const delay = immediate  0 : 180;
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
			edit_mode: IS_EDIT_MODE  1 : 0,
		});
		if (activeRegionGeometryEdit || pendingRegionOperation || pendingRegionMoveState) {
			return;
		}
		if (requestSeq !== window.__avesmapsPoliticalLayerRequestSeq) {
			return;
		}
		politicalTerritoryApiUnavailable = false;
		clearPoliticalTerritoryTimelineSelection();
		clearRenderedRegionLayers();
		regionData = Array.isArray(response.features)  response.features : [];
		regionData.forEach((region) => addRegionFeatureToMap(region, normalizeRegionFeature(region)));
		syncRegionVisibility();
	} catch (error) {
		console.warn("Herrschaftsgebiete konnten nicht geladen werden:", error);
		politicalTerritoryApiUnavailable = false;
	} finally {
		isPoliticalTerritoryLayerLoading = false;
	}
}

async function loadPoliticalTerritoryOptions({ force = false } = {}) {
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
				force_refresh: force  1 : undefined,
			});
			const territories = Array.isArray(response.territories)  response.territories : [];
			const hierarchy = Array.isArray(response.hierarchy)  response.hierarchy : [];
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
	if (!POLITICAL_TERRITORIES_API_URL) {
		return;
	}

	void loadPoliticalTerritoryOptions();
}
