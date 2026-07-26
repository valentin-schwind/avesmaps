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

function readEcosystemColorToken(token) {
	return token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : "";
}

// The tone of one area. Vegetation carries a tone per region_type -- Wald green, Wüste sand, Sümpfe
// murky (Owner 2026-07-26) -- because it is the layer that draws real ground cover; the other two draw
// containers and relief and get one colour each.
//
// The type token is derived BY RULE from the type_key, so a newly seeded type needs a token in
// tokens.css and nothing else: there is no type list in this file that could fall behind
// ecosystem_region_type. A type without a token, or a region without a type, falls back to the layer's
// base tone.
function ecosystemAreaColor(kind, regionType) {
	if (kind === "vegetation" && regionType) {
		const typeColor = readEcosystemColorToken(`--color-ecosystem-vegetation-${String(regionType).replace(/_/g, "-")}`);
		if (typeColor) {
			return typeColor;
		}
	}

	return readEcosystemColorToken(ECOSYSTEM_KIND_COLOR_TOKENS[kind]);
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

// 🔴 COLOUR ONLY. fill-opacity and stroke-opacity belong to the matrix in css/features/ecosystem-layer.css
// and are deliberately NOT passed here: they depend on the pane's state (resting / active / selected),
// and a second set of numbers in JS would have to be kept in step with that table forever. Leaflet writes
// its style as SVG presentation ATTRIBUTES, which CSS outranks, so the stylesheet wins cleanly.
function ecosystemAreaStyle(kind, regionType) {
	const color = ecosystemAreaColor(kind, regionType);

	return { color, fillColor: color, weight: 2 };
}

// Selection is a class on the path, not a style: the matrix in the stylesheet turns it into the
// stronger fill and the full contour. Re-applied after every (re)build, because a rebuilt layer gets a
// fresh <path> element.
function applyEcosystemSelectionClass(layer) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	if (!element) {
		return;
	}
	element.classList.toggle("ecosystem-area--selected", layer._ecosystemArea?.public_id === selectedEcosystemAreaPublicId);
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
			applyEcosystemSelectionClass(layer);
		}
	});

	// V3.3: the selection IS the vertex-edit session -- a selected area grows handles, a deselected one
	// loses them and flushes whatever is still pending. Routing it through here means switching the
	// layer, leaving the mode and clearing the registry all close an open edit without any of them
	// having to know the editor exists. Guarded, so V3.0's behaviour survives the file being absent.
	if (typeof syncEcosystemGeometryEdit === "function") {
		syncEcosystemGeometryEdit();
	}
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
		...ecosystemAreaStyle(kind, area.region_type),
	});

	layer._ecosystemArea = area;
	layer.bindTooltip(formatEcosystemAreaTooltip(area), { sticky: true, direction: "top" });
	layer.on("click", (event) => {
		// 💣 While the drawing tool is running, a click on an existing area is a CORNER, not a
		// selection -- so this handler must neither select nor stop the event, or no area could ever
		// be drawn across another one. Overlap and nesting are normal here (Schneckenkamm lies inside
		// the Windhagberge), so that case is the rule, not the exception.
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (event?.originalEvent && typeof L?.DomEvent?.stopPropagation === "function") {
			L.DomEvent.stopPropagation(event);
		}
		setSelectedEcosystemArea(area.public_id);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(formatEcosystemAreaTooltip(area));
		}
	});

	// V3.3: DOUBLE-CLICK opens the vertex editor -- a single click still only selects (owner
	// 2026-07-26). Not merely taste: opening on the selection would let the FIRST click of a
	// double-click raise the handles and the second one land on a handle that has just appeared, and a
	// double-click on a handle deletes a corner. That is the collision V3.2 flagged for the drawing
	// tool. Stopping the event also keeps it from reaching the map, where doubleClickZoom would fire and
	// where a double-click means "finish editing".
	layer.on("dblclick", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		// Already editing? Then a double-click on an EDGE inserts one corner there (owner 2026-07-26).
		if (typeof handleEcosystemEditEdgeDoubleClick === "function" && handleEcosystemEditEdgeDoubleClick(event)) {
			return;
		}
		// 💣 And a double-click anywhere ELSE inside an area already being edited does NOTHING. Calling
		// open again would close and re-open the session, which throws the undo stack away -- a second
		// double-click would silently cost every step you could still have taken back.
		if (typeof isEcosystemGeometryEditOpen === "function" && isEcosystemGeometryEditOpen(area.public_id)) {
			return;
		}
		if (typeof openEcosystemGeometryEdit === "function") {
			openEcosystemGeometryEdit(area.public_id);
		}
	});

	// V3.4: a landscape area has its OWN context menu (delete first, "Senden an ..." from V3.6). Stopping
	// the event is what keeps #map-context-menu from opening on top of it -- Leaflet would otherwise carry
	// the contextmenu on to map.on("contextmenu") (js/app/bootstrap.js:701), and L.DomEvent.stop is also
	// what suppresses the browser's own menu, since the map handler that normally does that never runs.
	//
	// 💣 While DRAWING it bails without stopping, exactly like the click handler above: a right-click is
	// not a corner, so the map menu staying reachable is the status quo, and swallowing the event here
	// would be a rule about a gesture this file has no opinion on.
	layer.on("contextmenu", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (!window.AvesmapsEcosystemAreaMenu) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		window.AvesmapsEcosystemAreaMenu.open(area, event);
	});

	return layer;
}
