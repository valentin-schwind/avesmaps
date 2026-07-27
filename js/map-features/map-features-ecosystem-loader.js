// Landschaften (Erprobung) -- loading the areas of the current viewport and keeping the registry in
// sync with them (plan V3.0, steps 2, 3 and 6). All three `kind` arrive in ONE request; the endpoint
// joins them from the region and does not need three calls.
//
// 🔴 OWN DEBOUNCE, OWN TIMER, OWN REGISTRY. Not schedulePoliticalTerritoryLayerReload, not
// regionPolygons, not clearRenderedRegionLayers -- the reasons are spelled out at the top of
// map-features-ecosystem-visibility.js and are the whole design of this layer. clearRenderedRegionLayers
// in particular empties regionPolygons on EVERY moveend; an area parked in there would have vanished
// from the registry after the first pan while its layer stayed on the map.
//
// 💣 DEDUPE BY public_id. This runs again on every pan, and the same area comes back every time.
// Without keying, the third pan leaves every area on the map three times over -- the stutter nobody
// notices at 5 areas and everybody notices at 300. Hence ecosystemLayers is a Map (runtime-state.js).

const ECOSYSTEM_RELOAD_DEBOUNCE_MS = 250;

let ecosystemAreaReloadTimeoutId = null;
// Monotonic: a slow response for an old viewport must not overwrite a newer one during fast panning.
let ecosystemAreaRequestToken = 0;
let ecosystemViewportReloadHooked = false;
// What the SERVER said about app_setting['ecosystem_enabled'] on the last answer. ?landschaften=1 is
// a client flag and secures nothing; this is the dead-man switch talking back (global rule 4).
let ecosystemLayerEnabledOnServer = null;
// The ecosystem_revision of the last answer. Every write bumps it, so a change is the cheap signal that
// anything cached ALONGSIDE the areas -- the region picker's rows and their area counts -- is stale.
// null = nothing seen yet, so the first answer never counts as a change.
let ecosystemLastSeenRevision = null;

// bbox=min_x,min_y,max_x,max_y in GeoJSON order. L.CRS.Simple maps lat->y and lng->x, so west/east are
// the X bounds and south/north the Y bounds. 25% padding, the same cushion the path viewport culling
// uses, so an area does not pop in at the edge of the frame.
function currentEcosystemBoundingBoxParam() {
	if (typeof map === "undefined" || !map || typeof map.getBounds !== "function") {
		return "";
	}

	const bounds = map.getBounds().pad(0.25);
	const values = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
	if (!values.every((value) => Number.isFinite(value))) {
		return "";
	}

	return values.map((value) => value.toFixed(2)).join(",");
}

function removeEcosystemAreaLayer(publicId) {
	if (!(ecosystemLayers instanceof Map)) {
		return;
	}
	const layer = ecosystemLayers.get(publicId);
	if (!layer) {
		return;
	}

	if (typeof map !== "undefined" && map && map.hasLayer(layer)) {
		map.removeLayer(layer);
	}
	ecosystemLayers.delete(publicId);
	if (typeof getSelectedEcosystemAreaPublicId === "function" && getSelectedEcosystemAreaPublicId() === publicId) {
		setSelectedEcosystemArea("");
	}
}

// Step 6: leaving the mode empties OUR registry and nothing else.
// 🔴 regionPolygons is not touched here, not even read.
function clearEcosystemAreaLayers() {
	if (ecosystemAreaReloadTimeoutId !== null) {
		window.clearTimeout(ecosystemAreaReloadTimeoutId);
		ecosystemAreaReloadTimeoutId = null;
	}
	// Invalidates any request still in flight, so a late answer cannot repopulate an emptied registry.
	ecosystemAreaRequestToken += 1;
	// Re-entering the mode refetches the regions anyway; without this reset the first answer after the
	// return would compare against a revision from before and order a second, pointless refetch.
	ecosystemLastSeenRevision = null;

	if (ecosystemLayers instanceof Map) {
		Array.from(ecosystemLayers.keys()).forEach(removeEcosystemAreaLayer);
		ecosystemLayers.clear();
	}
	if (typeof setSelectedEcosystemArea === "function") {
		setSelectedEcosystemArea("");
	}
}

// The dead-man switch talking back. Without this line an editor sees an empty map and cannot tell
// "no areas drawn yet" from "app_setting['ecosystem_enabled'] is off" -- ?landschaften=1 says nothing
// about the server side (global rule 4).
function syncEcosystemServerStateNote() {
	const noteElement = document.getElementById("ecosystem-controls-note");
	if (!noteElement) {
		return;
	}

	const isOff = ecosystemLayerEnabledOnServer === false;
	noteElement.textContent = isOff
		? "Die Landschaften-Ebene ist serverseitig abgeschaltet — es werden keine Flächen geladen."
		: "";
	noteElement.hidden = !isOff;
}

function applyEcosystemAreaPayload(payload) {
	ecosystemLayerEnabledOnServer = payload?.ecosystem_enabled === true;
	syncEcosystemServerStateNote();

	// A changed revision means somebody wrote -- a new area, a renamed region, a deletion. The region
	// picker caches its rows including each region's area count, and that count is exactly what goes
	// wrong first: draw an area and the row keeps saying "0 Flächen" until the mode is re-entered.
	// This is the one signal that says "refetch", and it stays quiet when nothing changed.
	const revision = Number(payload?.revision || 0);
	if (ecosystemLastSeenRevision !== null && revision !== ecosystemLastSeenRevision
		&& typeof invalidateEcosystemRegionCache === "function") {
		invalidateEcosystemRegionCache();
	}
	ecosystemLastSeenRevision = revision;

	const areas = Array.isArray(payload?.areas) ? payload.areas : [];
	const seenPublicIds = new Set();

	areas.forEach((area) => {
		const publicId = String(area?.public_id || "");
		if (!publicId) {
			return;
		}
		seenPublicIds.add(publicId);

		const existingLayer = ecosystemLayers.get(publicId);
		if (existingLayer) {
			const previous = existingLayer._ecosystemArea;
			// Same geometry and same kind -> the layer on the map is still the right one. Only the
			// descriptive fields (region name, type, trial flag) are refreshed.
			if (previous && previous.geometry_revision === area.geometry_revision && previous.kind === area.kind) {
				existingLayer._ecosystemArea = area;
				if (typeof existingLayer.setTooltipContent === "function") {
					existingLayer.setTooltipContent(formatEcosystemAreaTooltip(area));
				}
				// The tone follows region_type for vegetation, so an area whose region was re-typed has
				// to be recoloured -- but only then. Restyling every area on every pan would be N
				// attribute writes per pan for nothing.
				if (previous.region_type !== area.region_type) {
					existingLayer.setStyle(ecosystemAreaStyle(area.kind, area.region_type));
				}
				return;
			}
			removeEcosystemAreaLayer(publicId);
		}

		const layer = buildEcosystemAreaLayer(area);
		if (!layer) {
			console.warn("Landschaftsflaeche konnte nicht gezeichnet werden:", publicId);
			return;
		}
		ecosystemLayers.set(publicId, layer);
		layer.addTo(map);
		// Only now does the <path> element exist. A rebuilt area that was selected has to get its class
		// back, otherwise saving a geometry would silently drop the selection ring.
		applyEcosystemSelectionClass(layer);
	});

	// Gone from the answer = gone from the viewport (the endpoint filters by bbox overlap). Removing
	// them is what keeps the registry bounded instead of growing with every pan.
	// V3.3 needs NO hook here, and that is worth writing down because the opposite looks obvious. An open
	// vertex edit holds ONE layer object, so a rebuild would strand its handles -- but every path that
	// rebuilds or drops a layer goes through removeEcosystemAreaLayer above, which deselects, and the
	// deselect runs setSelectedEcosystemArea -> syncEcosystemGeometryEdit -> the session closes AND
	// flushes its pending write. That is what saves the corner somebody dragged just before panning the
	// area out of the viewport. A layer whose geometry_revision is unchanged keeps its object (the cheap
	// branch above), so an undisturbed session is never touched at all.
	Array.from(ecosystemLayers.keys()).forEach((publicId) => {
		if (!seenPublicIds.has(publicId)) {
			removeEcosystemAreaLayer(publicId);
		}
	});

	// Welche Labels in dieser Ebene blass sind, hängt an genau dieser Registry: ein Label ist „eigen",
	// wenn eine geladene Fläche der aktiven Art darauf zeigt. Nach jedem Nachladen kann sich das also
	// geändert haben -- ohne diesen Aufruf bliebe ein gerade erst hereingepanntes Waldlabel blass.
	if (typeof syncEcosystemLabelMuting === "function") {
		syncEcosystemLabelMuting();
	}
}

async function loadEcosystemAreas() {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return;
	}
	if (!ECOSYSTEM_AREAS_API_URL || typeof map === "undefined" || !map || !(ecosystemLayers instanceof Map)) {
		return;
	}

	const boundingBox = currentEcosystemBoundingBoxParam();
	const requestUrl = boundingBox
		? `${ECOSYSTEM_AREAS_API_URL}?bbox=${encodeURIComponent(boundingBox)}`
		: ECOSYSTEM_AREAS_API_URL;
	const requestToken = (ecosystemAreaRequestToken += 1);

	try {
		const response = await fetch(requestUrl, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const payload = await readJsonResponse(response, null);

		// A newer pan already started (or the mode was left) -- this answer describes a viewport that
		// no longer exists.
		if (requestToken !== ecosystemAreaRequestToken) {
			return;
		}
		if (!response.ok || payload?.ok !== true) {
			console.warn("Landschaftsflaechen konnten nicht geladen werden:", apiErrorMessage(payload, `HTTP ${response.status}`));
			return;
		}

		applyEcosystemAreaPayload(payload);
	} catch (error) {
		console.warn("Landschaftsflaechen konnten nicht geladen werden:", error);
	}
}

function scheduleEcosystemAreaReload({ immediate = false } = {}) {
	if (ecosystemAreaReloadTimeoutId !== null) {
		window.clearTimeout(ecosystemAreaReloadTimeoutId);
		ecosystemAreaReloadTimeoutId = null;
	}

	if (immediate) {
		void loadEcosystemAreas();
		return;
	}

	ecosystemAreaReloadTimeoutId = window.setTimeout(() => {
		ecosystemAreaReloadTimeoutId = null;
		void loadEcosystemAreas();
	}, ECOSYSTEM_RELOAD_DEBOUNCE_MS);
}

// Wired lazily instead of in bootstrap.js, following the __pathViewportCullingHooked pattern
// (map-features-display-mode.js): `map` is created LAST, after every map-features file has loaded, so
// there is no top-level moment at which map.on() could be called from here. syncEcosystemVisibility
// runs from setSelectedMapLayerMode, which restorePlannerState calls once the map data has arrived.
function hookEcosystemViewportReload() {
	if (ecosystemViewportReloadHooked || typeof map === "undefined" || !map || typeof map.on !== "function") {
		return;
	}
	ecosystemViewportReloadHooked = true;
	map.on("moveend zoomend", () => scheduleEcosystemAreaReload());
}
