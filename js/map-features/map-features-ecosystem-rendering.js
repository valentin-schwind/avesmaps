// Landschaften (Erprobung) -- turning one area row from GET /api/app/ecosystem-areas.php into a
// Leaflet layer (plan V3.0, step 4). Nothing here fetches, schedules or owns the registry; the loader
// (map-features-ecosystem-loader.js) does that and hands single rows in here.
//
// 🔴 COORDINATE ORDER. The wire format is GeoJSON: positions are [x, y] and the API returns exactly
// what was POSTed (api/_internal/app/ecosystem.php header). Leaflet's L.CRS.Simple wants
// [lat, lng] = [y, x] (AGENTS.md §5) -- so the swap happens HERE, in the client, and nowhere else.
//
// 🔴 NO HARDCODED COLOURS (AGENTS.md §12). The three kind tones are tokens in css/base/tokens.css and
// are read back out of the computed style, the same way the location canvas layer reads
// --color-marker-active (map-features-location-canvas-layer.js:27). A literal here would be the
// fourth place the same brown is written down.

// Display order of the segment switch AND the pane stack, low to high: the derographic containers
// (continents, islands) sit at the bottom, topography on top. German values on purpose -- they are
// domain vocabulary like PATH_SUBTYPE_KEYS, not translatable words (AGENTS.md §2, plan "Namensgebung").
const ECOSYSTEM_KINDS = ["derographisch", "vegetation", "topographie"];

const ECOSYSTEM_KIND_LABELS = {
	derographisch: "Derographische Region",
	vegetation: "Vegetation",
	topographie: "Topographie",
};

const ECOSYSTEM_KIND_PANES = {
	derographisch: "ecosystemPaneDerographisch",
	vegetation: "ecosystemPaneVegetation",
	topographie: "ecosystemPaneTopographie",
};

const ECOSYSTEM_KIND_COLOR_TOKENS = {
	derographisch: "--color-ecosystem-derographisch",
	vegetation: "--color-ecosystem-vegetation",
	topographie: "--color-ecosystem-topographie",
};

// The public_id of the area the editor last clicked, or "" for none. Only an area in the ACTIVE pane
// can ever get here -- the resting panes do not take pointer events at all (see the CSS).
let selectedEcosystemAreaPublicId = "";

function isKnownEcosystemKind(kind) {
	return ECOSYSTEM_KINDS.includes(String(kind || ""));
}

// Reads the kind tone out of the token, with the token's own value as the written-down fallback in
// case the stylesheet has not applied yet (first paint) -- same shape as getActiveMarkerColor().
function ecosystemKindColor(kind) {
	const token = ECOSYSTEM_KIND_COLOR_TOKENS[kind];
	if (!token) {
		return "";
	}
	return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

// GeoJSON Polygon | MultiPolygon -> Leaflet latlngs, [x, y] -> [y, x]. A Polygon becomes a
// single-part MultiPolygon so both shapes take one code path (the server normalizes the same way).
function ecosystemAreaLatLngs(geometry) {
	const type = String(geometry?.type || "");
	const coordinates = geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return null;
	}

	const parts = type === "Polygon" ? [coordinates] : (type === "MultiPolygon" ? coordinates : null);
	if (!parts) {
		return null;
	}

	const latlngs = parts.map((part) => (Array.isArray(part) ? part : []).map(
		(ring) => (Array.isArray(ring) ? ring : []).map(([x, y]) => [Number(y), Number(x)])
	));

	// A ring that lost its numbers somewhere would render as NaN and silently take the whole pane's
	// SVG with it -- refuse the row instead (the same guard the route pan learned the hard way).
	const hasBrokenPosition = latlngs.some((part) => part.some(
		(ring) => ring.length < 3 || ring.some(([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng))
	));

	return hasBrokenPosition ? null : latlngs;
}

function ecosystemAreaStyle(kind, isSelected) {
	const color = ecosystemKindColor(kind);

	return {
		color,
		weight: isSelected ? 4 : 2,
		opacity: 0.9,
		fillColor: color,
		fillOpacity: 0.3,
		// The gold "this one is selected" ring is the same token the clicked settlement marker uses,
		// so selection reads identically everywhere on the map.
		...(isSelected
			? { color: getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim() || color }
			: {}),
	};
}

function applyEcosystemAreaStyle(layer) {
	const area = layer?._ecosystemArea;
	if (!layer || !area || typeof layer.setStyle !== "function") {
		return;
	}
	layer.setStyle(ecosystemAreaStyle(area.kind, area.public_id === selectedEcosystemAreaPublicId));
}

function formatEcosystemAreaTooltip(area) {
	const regionName = String(area?.region_name || "").trim() || "Ohne Namen";
	const kindLabel = ECOSYSTEM_KIND_LABELS[area?.kind] || String(area?.kind || "");
	const typeLabel = String(area?.region_type || "").trim();
	const trialSuffix = area?.is_trial ? " · Erprobung" : "";

	return `${regionName} (${typeLabel ? `${typeLabel}, ` : ""}${kindLabel}${trialSuffix})`;
}

// Selecting is what proves "only the active layer answers" (plan V3.0, step 7). It is deliberately
// the whole of the interaction in V3.0 -- the vertex editor is V3.3 and the context menu is V3.4.
function setSelectedEcosystemArea(publicId) {
	const nextId = String(publicId || "");
	if (nextId === selectedEcosystemAreaPublicId) {
		return;
	}

	const previousId = selectedEcosystemAreaPublicId;
	selectedEcosystemAreaPublicId = nextId;
	[previousId, nextId].forEach((id) => {
		const layer = id && ecosystemLayers instanceof Map ? ecosystemLayers.get(id) : null;
		if (layer) {
			applyEcosystemAreaStyle(layer);
		}
	});
}

function getSelectedEcosystemAreaPublicId() {
	return selectedEcosystemAreaPublicId;
}

// One area row -> one Leaflet layer, or null when the row is unusable. The caller registers it.
function buildEcosystemAreaLayer(area) {
	const kind = String(area?.kind || "");
	const paneName = ECOSYSTEM_KIND_PANES[kind];
	const latlngs = ecosystemAreaLatLngs(area?.geometry);
	if (!paneName || !latlngs) {
		return null;
	}

	const layer = L.polygon(latlngs, {
		pane: paneName,
		// Every area stays interactive; whether it actually answers is decided by the PANE it sits in
		// (see .ecosystem-pane--resting in css/features/ecosystem-layer.css). That is the whole reason
		// there are three panes: switching must not have to rebuild layers.
		interactive: true,
		...ecosystemAreaStyle(kind, area.public_id === selectedEcosystemAreaPublicId),
	});

	layer._ecosystemArea = area;
	layer.bindTooltip(formatEcosystemAreaTooltip(area), { sticky: true, direction: "top" });
	layer.on("click", (event) => {
		if (event?.originalEvent && typeof L?.DomEvent?.stopPropagation === "function") {
			L.DomEvent.stopPropagation(event);
		}
		setSelectedEcosystemArea(area.public_id);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(formatEcosystemAreaTooltip(area));
		}
	});

	return layer;
}
