/*
 * Die Route auf der KARTE: Segmentstil, Ausschnitt, Rahmung, Auswahl einer Etappe. Herausgeloest
 * aus route-plan.js -- jene baut die ETAPPENLISTE, diese zeichnet dieselbe Route.
 *
 * 💣 Reine Deklarationen, kein Ladezeit-Code -- wie route-plan.js selbst: rund ein Dutzend Tests laden
 * jene ALLEIN in einen vm-Kontext, wo ein $(...) auf oberster Ebene wuerfe (routing.js nennt den Fall).
 */

function getRouteSegmentStyle(segment, isSelected = false) {
	const baseStyle = segment?.properties?.synthetic ? SYNTHETIC_ROUTE_STYLE : ROUTE_STYLE;
	return isSelected ? { ...baseStyle, ...ROUTE_SELECTED_STYLE } : { ...baseStyle };
}

// The white casing under a segment. Inherits the segment's geometry-relevant style (dashArray, opacity)
// so a Querfeldein leg keeps its dashes instead of getting a solid white line underneath -- only colour,
// width and pane differ. Not interactive: clicks belong to the coloured segment on top.
function getRouteSegmentOutlineStyle(segment) {
	const baseStyle = segment?.properties?.synthetic ? SYNTHETIC_ROUTE_STYLE : ROUTE_STYLE;
	return {
		...baseStyle,
		pane: ROUTE_OUTLINE_PANE,
		color: ROUTE_OUTLINE_COLOR,
		weight: baseStyle.weight + ROUTE_OUTLINE_WIDTH * 2,
		interactive: false,
	};
}

function getRouteEntryBounds(routeEntry) {
	let bounds = null;
	(routeEntry?.segmentIndexes || []).forEach((segmentIndex) => {
		const segmentLayer = currentRouteSegmentLayers[segmentIndex]?.layer;
		if (!segmentLayer?.getBounds) {
			return;
		}

		const segmentBounds = segmentLayer.getBounds();
		if (!segmentBounds.isValid()) {
			return;
		}

		bounds = bounds ? bounds.extend(segmentBounds) : L.latLngBounds(segmentBounds.getSouthWest(), segmentBounds.getNorthEast());
	});

	return bounds;
}

function getCurrentRouteBounds() {
	let bounds = null;

	currentRouteSegmentLayers.forEach((entry) => {
		const segmentLayer = entry?.layer;
		if (!segmentLayer?.getBounds) {
			return;
		}

		const segmentBounds = segmentLayer.getBounds();
		if (!segmentBounds.isValid()) {
			return;
		}

		bounds = bounds ? bounds.extend(segmentBounds) : L.latLngBounds(segmentBounds.getSouthWest(), segmentBounds.getNorthEast());
	});

	return bounds;
}

// Fit options for displaying a route: zoom in far enough that the route fills the frame (up to the
// map's max zoom -- no longer capped at the current zoom) and reserve the route-planner panel's width
// on the left so the route lands in the visible area instead of under the panel.
// Die Breite des rechten Infopanels, sofern es gerade offen ist. Es liegt `position: fixed` UEBER der
// Karte, zaehlt also nicht zur Kartengroesse -- ohne diese Reserve laeuft das Routenende darunter und ist
// schlicht nicht zu sehen (Owner 2026-07-18: das Ziel lag unter dem Panel).
function getRouteInfopanelInsetWidth() {
	const panel = document.querySelector(".avesmaps-infopanel");
	if (!panel || panel.classList.contains("is-hidden")) {
		return 0;
	}
	const width = Math.round(panel.getBoundingClientRect().width);
	return Number.isFinite(width) && width > 0 ? width : 0;
}

function getRouteFitBoundsOptions() {
	// Rand PROPORTIONAL zur Karte (Owner 2026-07-18: "zu knapp zum rand"): eine Route, die den Rahmen
	// ausfuellt, laesst den Leser nicht sehen, wohin sie weiterfuehrt -- und ein fester Pixelwert ist auf
	// einem grossen Bildschirm ein Haarstrich und auf einem kleinen die halbe Karte. 7 % je Seite ergeben
	// auf einem 2000er-Fenster gut eine halbe Zoomstufe mehr Ueberblick als der frueher feste 28er-Rand.
	const mapSize = map.getSize();
	const mapWidth = mapSize.x;
	const margin = Math.max(40, Math.round(mapWidth * 0.07));
	const marginY = Math.max(32, Math.round(mapSize.y * 0.07));
	const isPhone = typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport();
	const panelVisible = typeof isSearchPanelHidden === "undefined" || !isSearchPanelHidden;
	// Reserve the planner panel's width on the left ONLY on desktop, where it's a persistent left
	// sidebar. On phones the panel is a temporary full-width overlay; reserving its width would exceed
	// the narrow viewport, leave no room, and break the fit (route zoomed way out).
	let leftInset = (!isPhone && panelVisible && typeof getRoutePlannerPanelWidth === "function") ? getRoutePlannerPanelWidth() : 0;
	// Dasselbe rechts fuer das Infopanel -- auf dem Telefon aus demselben Grund nicht (dort deckt es die
	// ganze Breite; reservieren hiesse, gar keinen Platz mehr zu lassen).
	let rightInset = isPhone ? 0 : getRouteInfopanelInsetWidth();
	// Safety cap: never reserve so much that the route cannot fit (narrow viewport / oversized panel).
	// Gekappt wird die SUMME beider Seiten -- einzeln gekappt koennten zwei je 45%-Reserven zusammen die
	// ganze Karte auffressen, und der Fit rutschte ins Absurde statt nur eng zu werden.
	const maxInsets = Math.max(0, mapWidth * 0.6 - 2 * margin);
	const insetSum = leftInset + rightInset;
	if (insetSum > maxInsets && insetSum > 0) {
		const scale = maxInsets / insetSum;
		leftInset = Math.floor(leftInset * scale);
		rightInset = Math.floor(rightInset * scale);
	}
	return {
		paddingTopLeft: [leftInset + margin, marginY],
		paddingBottomRight: [rightInset + margin, marginY],
		maxZoom: map.getMaxZoom(),
	};
}

// Fit the map to a route's bounds and let it fill the frame tightly. Temporarily allow fractional
// zoom (zoomSnap 0) so the fit doesn't snap DOWN to the next-lower whole zoom and leave a big margin;
// restore zoomSnap afterwards so manual zooming keeps snapping to crisp whole levels.
function fitMapToRouteBounds(bounds) {
	const previousZoomSnap = map.options.zoomSnap;
	map.options.zoomSnap = 0;
	try {
		// flyToBounds (not fitBounds): a big jump from the current view to the route exceeds Leaflet's
		// zoom-animation threshold, so fitBounds would snap there instantly (the "hard fade"). flyTo
		// animates the zoom AND pan smoothly regardless of distance.
		map.flyToBounds(bounds, { ...getRouteFitBoundsOptions(), duration: 0.7 });
	} finally {
		map.options.zoomSnap = previousZoomSnap;
	}
}

function clearRouteDirectionMarkers() {
	if (currentRouteDirectionLayer) {
		map.removeLayer(currentRouteDirectionLayer);
		currentRouteDirectionLayer = null;
	}
}

function selectRoutePlanEntry(entryIndex, { zoomToEntry = false, scrollPlan = false } = {}) {
	const routeEntry = currentRoutePlanEntries[entryIndex];
	if (!routeEntry) {
		return;
	}

	activeRoutePlanEntryIndex = entryIndex;
	clearRouteDirectionMarkers();
	const selectedSegmentIndexes = new Set(routeEntry.segmentIndexes || []);
	currentRouteSegmentLayers.forEach((entry, segmentIndex) => {
		if (!entry?.layer) {
			return;
		}

		const isSelected = selectedSegmentIndexes.has(segmentIndex);
		entry.layer.setStyle(getRouteSegmentStyle(entry.segment, isSelected));
		if (isSelected) {
			entry.layer.bringToFront();
		}
	});

	document.querySelectorAll(".route-plan-entry").forEach((entryElement) => {
		const isActive = Number(entryElement.dataset.routeEntryIndex) === entryIndex;
		entryElement.classList.toggle("is-active", isActive);
		if (isActive && scrollPlan) {
			entryElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	});

	// Etappen-Infobox ins Panel (Owner 2026-07-17). Hier und nicht in den Aufrufern: ALLE fuenf Wege hierher
	// sind Nutzer-Klicks (Routenlinie, Etappenzeile, Tastatur, Weg-Link) -- keiner feuert beim BERECHNEN einer
	// Route, sonst spraenge das Panel ungefragt auf.
	// VOR dem Zoom: die Info ist das Anliegen des Klicks, der Zoom die Zugabe. Stolpert fitMapToRouteBounds
	// ueber eine entartete Bbox, soll das nicht auch noch das Panel leer lassen.
	if (typeof window.avesmapsShowRouteLegInInfopanel === "function") {
		window.avesmapsShowRouteLegInInfopanel(routeEntry);
	}

	if (zoomToEntry) {
		const bounds = getRouteEntryBounds(routeEntry);
		if (bounds?.isValid()) {
			fitMapToRouteBounds(bounds);
		}
	}
}
