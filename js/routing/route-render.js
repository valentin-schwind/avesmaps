function createRouteNodeMarkersForSegment(segment) {
	return [];
}

function drawRoute(segments) {
	if (currentRouteLayer) {
		map.removeLayer(currentRouteLayer);
		currentRouteLayer = null;
	}
	if (currentRouteNodeLayer) {
		map.removeLayer(currentRouteNodeLayer);
		currentRouteNodeLayer = null;
	}
	clearRouteDirectionMarkers();
	currentRouteSegmentLayers = [];
	currentRouteNodeLayer = L.layerGroup();
	currentRouteLayer = L.layerGroup();
	segments.forEach((segment, segmentIndex) => {
		const visualCoordinates = smoothLineCoordinatesForDisplay(segment.geometry?.coordinates || [], VISUAL_LINE_CATMULL_ROM_CONFIG);
		const segCoords = visualCoordinates.map(([x, y]) => [y, x]);
		if (segCoords.length) {
			// Weisse Kontur ZUERST -- sie lebt in routeOutlinePane (445), die farbige Linie in routePane
			// (450). Die Trennung nach Panes (statt nur nach Einfuege-Reihenfolge) haelt die Stapelung auch
			// an den Segment-Uebergaengen: sonst legte sich die Kontur des naechsten Segments ueber die
			// Farbe des vorigen. Beide liegen in currentRouteLayer -> gemeinsames Aufraeumen.
			currentRouteLayer.addLayer(L.polyline(segCoords, getRouteSegmentOutlineStyle(segment)));

			const segLayer = L.polyline(segCoords, getRouteSegmentStyle(segment));
			segLayer.on("click", (event) => {
				if (event.originalEvent) {
					L.DomEvent.stop(event.originalEvent);
				}
				selectRoutePlanEntryForSegment(segmentIndex);
			});
			currentRouteLayer.addLayer(segLayer);
			currentRouteSegmentLayers[segmentIndex] = { layer: segLayer, segment };
			createRouteNodeMarkersForSegment(segment).forEach((marker) => currentRouteNodeLayer.addLayer(marker));
		} else {
			console.warn("Ungültige Segmentkoordinaten:", segment.geometry);
		}
	});
	if (currentRouteLayer.getLayers().length) currentRouteLayer.addTo(map);
	if (currentRouteNodeLayer.getLayers().length) currentRouteNodeLayer.addTo(map);
}

function logRoutePoints(segments) {
	const points = segments.flatMap((segment) => segment.geometry.coordinates.map(([x, y]) => ({ x, y })));
	console.log("Route points:", points);
	return points;
}

// ==================================================================================================
// Wegpunkt-Marker (docs/route-waypoint-marker-design.md)
//
// NUR die echten, vom Nutzer gesetzten Wegpunkte (selectedLocations) bekommen einen Marker -- NICHT
// jede Kreuzung/jeder Durchgangsort der berechneten Route (Bug #10). Diese Regel ist der Grund, warum
// die Markierung ruhig wirkt; sie darf nicht aufgeweicht werden.
//
// Die Rolle bestimmt die Grafik: erster = Start (rote Scheibe), letzter = Ziel (roter Tropfen),
// dazwischen = Zwischenziel (gelbe Scheibe). Bei nur EINEM Wegpunkt gibt es kein Ziel -- er ist Start.
//
// Der erste Icon-Versuch (fbb5565b) scheiterte NICHT an den Grafiken, sondern am Anker: pin.webp war
// 80x80 quadratisch (Tropfen mit Leerraum), bekam aber iconSize [30,37] aufgezwungen -> verzerrt, und
// der Anker zeigte auf Leerraum statt auf die Spitze. Deshalb hier: Groessen strikt aus dem echten
// Seitenverhaeltnis (ROUTE_WAYPOINT_END_ASPECT) ableiten, Anker exakt setzen.
// ==================================================================================================

function routeWaypointRole(index, total) {
	if (index === 0) return "start";
	if (total > 1 && index === total - 1) return "end";
	return "between";
}

// Groesse + Anker einer Rolle. Die Scheibe sitzt MITTIG auf dem Ort (Anker = Mitte), der Tropfen mit
// seiner SPITZE (Anker = unten mittig). `overshoot` = wie weit die Grafik ueber den Ankerpunkt nach
// oben ragt -> daraus folgt der Popup-Offset.
// start und between sind GLEICH GROSS (Owner): die Groesse sagt nichts ueber die Position in der Route.
function routeWaypointGeometry(role) {
	const sizes = ROUTE_WAYPOINT_MARKER_SIZES[ROUTE_WAYPOINT_MARKER_SIZE] || ROUTE_WAYPOINT_MARKER_SIZES.medium;
	if (role === "end") {
		const height = sizes.end;
		const width = Math.round(height * ROUTE_WAYPOINT_END_ASPECT);
		return { width, height, anchor: [width / 2, height], overshoot: height };
	}
	const size = sizes.waypoint;
	return { width: size, height: size, anchor: [size / 2, size / 2], overshoot: size / 2 };
}

// Vektor-Variante (?routemarkers=vector): maßgleiches Inline-SVG.
//
// Die Farben kommen aus den TOKENS (var(--color-marker-waypoint) …), nicht als Hex-Literale. Dadurch
// genuegt fuer den ausgewaehlten Zustand ein CSS-Regelchen, das --color-marker-waypoint lokal auf
// --color-marker-active umbiegt -- kein zweites Grafik-Set, keine JS-Farblogik.
//
// Die viewBox umschliesst den Pfad EXAKT (kein Leerrand) -- die WebPs sind eng auf ihre Bounding-Box
// beschnitten, ein Leerrand hier wuerde den Vektor-Marker also sichtbar kleiner rendern als den Bild-
// Marker. Beim Tropfen liegt die Pfadspitze dadurch genau auf der unteren viewBox-Kante, also exakt auf
// dem Ankerpunkt; sein Seitenverhaeltnis (30/51 = 0.588) entspricht dem des Bildes (75/128 = 0.586), so
// dass "meet" nichts verzerrt und nichts verschiebt.
function routeWaypointVectorSvg(role, width, height) {
	const fill = "var(--color-marker-waypoint)";
	const core = "var(--color-marker-waypoint-core)";
	const ring = "var(--color-marker-waypoint-ring)";
	if (role === "end") {
		return `<svg width="${width}" height="${height}" viewBox="-15 -51 30 51" xmlns="http://www.w3.org/2000/svg">`
			+ `<path d="M0,0 C-6,-14 -15,-22 -15,-36 A15,15 0 1,1 15,-36 C15,-22 6,-14 0,0 Z" fill="${core}"/>`
			+ `<path d="M0,-6 C-4.5,-16 -11.5,-23 -11.5,-36 A11.5,11.5 0 1,1 11.5,-36 C11.5,-23 4.5,-16 0,-6 Z" fill="${fill}" stroke="${ring}" stroke-width="1.8"/>`
			+ `<circle cx="0" cy="-36" r="5.5" fill="${core}" stroke="${ring}" stroke-width="2"/>`
			+ "</svg>";
	}
	// start UND between: dieselbe Scheibe. Rot heisst "Wegpunkt" -- nicht "erster" oder "mittlerer".
	return `<svg width="${width}" height="${height}" viewBox="-17 -17 34 34" xmlns="http://www.w3.org/2000/svg">`
		+ `<circle r="17" fill="${core}"/><circle r="14.5" fill="none" stroke="${ring}" stroke-width="2"/>`
		+ `<circle r="12" fill="${fill}"/><circle r="5.5" fill="${core}" stroke="${ring}" stroke-width="2"/>`
		+ "</svg>";
}

// Im Bild-Modus kann CSS die Grafik nicht umfaerben -> fuer "ausgewaehlt" die goldene Fassung laden.
function routeWaypointImageSrc(role, isActive) {
	if (role === "end") {
		return isActive ? ROUTE_WAYPOINT_MARKER_IMAGES.endActive : ROUTE_WAYPOINT_MARKER_IMAGES.end;
	}
	return isActive ? ROUTE_WAYPOINT_MARKER_IMAGES.waypointActive : ROUTE_WAYPOINT_MARKER_IMAGES.waypoint;
}

// BEIDE Modi laufen ueber L.divIcon -- auch der Bild-Modus. Grund: Leaflet positioniert das Icon-Element
// selbst per `transform: translate3d(...)`. Ein CSS-Hover-`transform: scale()` DARAUF wuerde die Position
// ueberschreiben und den Marker vom Ort wegspringen lassen. Mit divIcon liegt die Grafik als KIND im
// Container -- das laesst sich gefahrlos skalieren. (L.divIcons Default-Klasse "leaflet-div-icon" mit
// weissem Kasten + Rahmen ist durch das eigene className ersetzt.)
function routeWaypointIcon(role, geometry, isActive = false) {
	const html = ROUTE_WAYPOINT_MARKER_MODE === "vector"
		? routeWaypointVectorSvg(role, geometry.width, geometry.height)
		: `<img src="${routeWaypointImageSrc(role, isActive)}" width="${geometry.width}" height="${geometry.height}" alt="" />`;
	return L.divIcon({
		className: `route-waypoint-marker route-waypoint-marker--${role}${isActive ? " route-waypoint-marker--active" : ""}`,
		html,
		iconSize: [geometry.width, geometry.height],
		iconAnchor: geometry.anchor,
	});
}

// Faerbt den Wegpunkt-Marker des gerade im Infopanel gezeigten Ortes gold ein -- dieselbe Auswahl, die
// den Siedlungs-Marker gold macht (activeLocationPublicId). Wird sowohl beim Auswahlwechsel gerufen
// (Hook in setActiveLocationMarker/clearActiveLocationMarker) als auch nach jedem Neuaufbau der Marker,
// weil renderRouteWaypointMarkers sie komplett neu erzeugt.
// Idempotent: nur ein tatsaechlicher Zustandswechsel tauscht das Icon.
function applyActiveRouteWaypointMarkers() {
	const activeId = typeof activeLocationPublicId === "string" ? activeLocationPublicId : "";
	(highlightedRouteNodes || []).forEach((marker) => {
		if (!marker || !marker._waypointGeometry) {
			return;
		}
		const isActive = Boolean(activeId) && marker._waypointPublicId === activeId;
		if (marker._waypointActive === isActive) {
			return;
		}
		marker._waypointActive = isActive;
		marker.setIcon(routeWaypointIcon(marker._waypointRole, marker._waypointGeometry, isActive));
	});
}

// Hover-Infobox an einem Wegpunkt-Marker. Sie bleibt offen, solange die Maus auf dem Marker ODER auf
// der Box ist -- sonst waeren deren Buttons ("Reiseziel entfernen", "Link teilen") unklickbar, weil die
// Maus beim Hinuebergehen kurz ueber der Karte haengt. Ein Klick pinnt die Box fest (auf Touch, wo es
// kein Hover gibt, ist das der regulaere Weg).
function bindRouteWaypointHoverPopup(marker, loc, role, geometry) {
	const popup = L.popup({
		// IMMER NUR EINE Infobox gleichzeitig (Owner). autoClose laesst Leaflet die vorher geoeffnete
		// schliessen, sobald eine neue aufgeht -- auch eine gepinnte, und auch ein normales Orts-Popup.
		// Das erledigt map.openPopup() unten; wir muessen die Geschwister nicht selbst einsammeln.
		autoClose: true,
		closeOnClick: false,
		// autoPan waehrend einer noch laufenden Karten-Animation korrumpiert das Karten-Zentrum
		// (_panInsideMaxBounds -> NaN-Pan-Crash). Dieselbe Absicherung nutzt der normale Ort-Marker.
		autoPan: false,
		minWidth: 310,
		maxWidth: 400,
		maxHeight: typeof locationMarkerPopupMaxHeight === "function" ? locationMarkerPopupMaxHeight() : 480,
		// Die Box sitzt oberhalb der Grafik: der Anker liegt bei der Scheibe in der Mitte, beim Tropfen an
		// der Spitze -- overshoot ist genau die Hoehe, die die Grafik darueber einnimmt.
		offset: [0, -geometry.overshoot],
		className: "route-waypoint-popup floating-location-popup settlement-popup",
	})
		.setLatLng(loc.coordinates)
		.setContent(buildRoutePopupHtml(loc, { showRemoveAction: true, role }));

	marker._routePopup = popup;
	marker._routePopupPinned = false;

	// Expliziter Zustand statt reiner Timer-Logik: die Box bleibt offen, solange die Maus auf dem Marker
	// ODER auf der Box ist (oder sie gepinnt ist). Sich allein auf die Event-REIHENFOLGE zu verlassen
	// (mouseout schliesst, mouseenter haelt offen) bricht, sobald die Box den Marker ueberlappt -- dann
	// feuert mouseenter VOR mouseout, der Schliess-Timer wird danach gesetzt und niemand hebt ihn mehr auf:
	// die Box klappt zu, obwohl die Maus drinsteht, und ihre Buttons waeren nicht erreichbar.
	let isOverMarker = false;
	let isOverPopup = false;

	const cancelClose = () => {
		if (marker._routeCloseTimer) {
			clearTimeout(marker._routeCloseTimer);
			marker._routeCloseTimer = null;
		}
	};
	const shouldStayOpen = () => marker._routePopupPinned || isOverMarker || isOverPopup;
	// Schliesst NUR, wenn die Maus weder auf dem Marker noch auf der Box ist. Die Verzoegerung ueberbrueckt
	// die Luecke dazwischen (dort liegt kurz nur die Karte unter dem Zeiger).
	const closeUnlessStillHovered = () => {
		cancelClose();
		if (shouldStayOpen()) {
			return;
		}
		marker._routeCloseTimer = setTimeout(() => {
			marker._routeCloseTimer = null;
			if (!shouldStayOpen()) {
				map.closePopup(popup);
			}
		}, ROUTE_WAYPOINT_POPUP_CLOSE_DELAY_MS);
	};
	const openPopup = () => {
		cancelClose();
		if (!map.hasLayer(popup)) {
			// map.openPopup (nicht popup.addTo): es schliesst die zuvor offene Infobox mit -> nie zwei
			// gleichzeitig. Das "remove" der geschlossenen loest dort pinned/isOverPopup wieder aus.
			map.openPopup(popup);
		}
		// Das Popup-Element entsteht erst beim Oeffnen -> die Listener hier binden, aber nur einmal
		// (Leaflet verwendet denselben Container beim Wiederoeffnen).
		const element = typeof popup.getElement === "function" ? popup.getElement() : popup._container;
		if (element && !element._routeHoverBound) {
			element._routeHoverBound = true;
			element.addEventListener("mouseenter", () => {
				isOverPopup = true;
				cancelClose();
			});
			element.addEventListener("mouseleave", () => {
				isOverPopup = false;
				closeUnlessStillHovered();
			});
		}
	};

	marker.on("mouseover", () => {
		isOverMarker = true;
		openPopup();
	});
	marker.on("mouseout", () => {
		isOverMarker = false;
		closeUnlessStillHovered();
	});
	marker.on("click", (event) => {
		if (event.originalEvent) {
			L.DomEvent.stop(event.originalEvent);
		}
		marker._routePopupPinned = true;
		openPopup();
	});
	// Schliesst der Nutzer die gepinnte Box (x), reagiert der Marker wieder auf Hover.
	popup.on("remove", () => {
		marker._routePopupPinned = false;
		isOverPopup = false;
		cancelClose();
	});
}

// Massgeblich ist selectedLocations -- an allen Aufrufstellen direkt zuvor via
// collectAndValidateSelectedLocations gefuellt. Die Knotenliste der berechneten Route taugt NICHT als
// Quelle (sie enthaelt Kreuzungen + Duplikate -> Bug #10). Deshalb laeuft dieser Renderer frueh, direkt
// nach dem Einsammeln der Wegpunkte: so bekommt auch ein EINZELNER Wegpunkt (noch keine Route) seinen
// Marker. Idempotent -- raeumt zuerst auf.
function renderRouteWaypointMarkers() {
	removeHighlightedRouteNodes();
	const waypoints = Array.isArray(selectedLocations) ? selectedLocations : [];
	waypoints.forEach((waypoint, index) => {
		if (!waypoint || !waypoint.coordinates) {
			return;
		}
		const role = routeWaypointRole(index, waypoints.length);
		const geometry = routeWaypointGeometry(role);
		const marker = L.marker(waypoint.coordinates, {
			icon: routeWaypointIcon(role, geometry),
			pane: "locationsPane",
			riseOnHover: true,
			keyboard: false,
		}).addTo(map);
		// Identitaet + Bauplan am Marker: applyActiveRouteWaypointMarkers braucht beides, um sein Icon
		// gegen die goldene Fassung zu tauschen. publicId ist der Schluessel, an dem auch die Siedlungs-
		// Marker und das Infopanel ihre Auswahl fuehren (activeLocationPublicId).
		marker._waypointPublicId = waypoint.publicId || "";
		marker._waypointRole = role;
		marker._waypointGeometry = geometry;
		marker._waypointActive = false;
		bindRouteWaypointHoverPopup(marker, waypoint, role, geometry);
		highlightedRouteNodes.push(marker);
	});
	// Der Neuaufbau wirft alle Marker weg -> die Auswahl erneut anwenden, sonst verliert der gerade im
	// Panel gezeigte Wegpunkt sein Gold, sobald die Route neu gezeichnet wird. Dasselbe gilt fuer die
	// Wegpunkt-Zeile im Planer (sie wird beim Sortieren/Hinzufuegen neu aufgebaut).
	applyActiveRouteWaypointMarkers();
	if (typeof applyActiveWaypointRow === "function") {
		applyActiveWaypointRow();
	}
}

function removeHighlightedRouteNodes() {
	$.each(highlightedRouteNodes, (i, node) => {
		if (node._routeCloseTimer) {
			clearTimeout(node._routeCloseTimer);
			node._routeCloseTimer = null;
		}
		if (node._routePopup) {
			map.closePopup(node._routePopup);
			map.removeLayer(node._routePopup);
			node._routePopup = null;
		}
		map.removeLayer(node);
	});
	highlightedRouteNodes = [];
}

function updateRouteKeepingCurrentMapView() {
	const previousCenter = map.getCenter();
	const previousZoom = map.getZoom();
	const routeUpdate = updateMapView();
	Promise.resolve(routeUpdate).finally(() => {
		map.setView(previousCenter, previousZoom, { animate: false });
	});
}

function refreshPlannerAfterFeatureChange({ updateRoute = false } = {}) {
	graphData = null;
	locationConnectivityIndex = null;
	refreshWaypointAutocompleteSources();
	syncPlannerStateToUrl();
	// Discord #43: the central point after ANY feature change, so a way end that was reattached in
	// the meantime drops off the "open ends" counter by itself (map-features-location-detach-edit.js).
	if (typeof avesmapsRefreshOpenPathEnds === "function") {
		avesmapsRefreshOpenPathEnds();
	}

	if (updateRoute && getWaypointInputValues().length) {
		updateRouteKeepingCurrentMapView();
	}
}
