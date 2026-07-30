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

// Wegtyp einer Etappe, blank: "Straße", "Reichsstraße", "Weg". Das ist der UNTERTITEL unter einem echten
// Weg-Namen und zugleich der Typ in der Etappenzeile -- beide sagen damit dasselbe Wort, aus einer Quelle.
// Querfeldein ist kein Wegtyp, sondern eine Luftlinie -> eigenes Wort.
function routeLegTypeLabel(type) {
	if (type === SYNTHETIC_ROUTE_TYPE) {
		return tr("planner.leg.offroad", "Unwegsames Gelände");
	}
	return typeof getPathTypeLabel === "function" ? getPathTypeLabel(type) : String(type || "");
}

// Titel einer Etappe OHNE Weg-Namen -- und NUR da gehoert die Unbenannt-Formel hin (Owner 2026-07-29):
// als Untertitel unter einem Namen widerspricht sie sich selbst, "Sieben-Baronien-Weg / Unbenannte Straße"
// spricht dem Weg genau den Namen ab, der darueber steht. Ohne Namen teilt sich die Etappe getUnnamedPathTitle
// mit der Weg-Infobox, damit ein namenloser Weg ueberall gleich heisst; Seeweg faellt dort bewusst auf den
// blanken Typ zurueck.
function routeLegUnnamedTitle(type) {
	if (type === SYNTHETIC_ROUTE_TYPE || typeof getUnnamedPathTitle !== "function") {
		return routeLegTypeLabel(type);
	}
	return getUnnamedPathTitle(type);
}

// Infobox einer Routen-Etappe (Owner 2026-07-17): gleicher Kopf + gleiche Datentabelle wie die Weg-Infobox,
// nur aus dem Etappen-Modell statt aus einem map_features-Weg gespeist. Der Kopf nutzt dieselbe
// Wegtyp-Grafik (pathHeaderImageBasename) -- fuer den Seeweg ist das die EINZIGE Flaeche, auf der seine
// Grafik je erscheint: Seewege tragen keinen Wiki-Artikel (0 von 1275 Segmenten), sind darum nie klickbar
// und bauen nie eine Weg-Infobox. Querfeldein faellt mangels Eintrag auf "region" zurueck -- es ist kein Weg.
// Die Weg-Kennungen einer Etappe. Eine Etappe ist immer ein GANZER Weg -- der Graph legt je Weg
// genau eine Kante an (addRegularPathToGraph), es gibt kein Teilstueck --, aber eine Wasser-Etappe
// fasst mehrere Wege zu EINEM Eintrag zusammen. Deshalb eine Liste und keine einzelne Kennung.
//
// 💣 NUR public_id, KEIN Rueckfall auf properties.id. Bei der server-primaeren Route (dem Live-Weg;
// die Client-Engine laeuft nur unter ?clientrouting=1) ist `id` die KANTEN-Kennung „path-2661" --
// eine Zeichenkette, die keine Datenbank kennt. Der Rueckfall stand hier zuerst und war schlimmer
// als kein Rueckfall: er machte aus „ich weiss die Kennung nicht" eine Anfrage nach etwas
// Erfundenem, die der Server ablehnt und der Client stillschweigend schluckt -- die Zeile blieb
// leer und sah dabei aus wie „hier gibt es keine Landschaft". Ohne Rueckfall gibt es gar keine
// Anfrage, und der Fall ist als solcher sichtbar. Gefunden bei der Live-Abnahme am 2026-07-29.
function routeEntryPathIds(entry, segments) {
	return (entry?.segmentIndexes || [])
		.map((segmentIndex) => String(segments?.[segmentIndex]?.properties?.public_id || ""))
		.filter(Boolean);
}

// V11: how much this LEG climbs and falls, in Schritt. Null when not one of its segments carries
// height data -- and then the infobox simply has no such row.
//
// 💣 A LEG IS NOT AN EDGE. showRoutePlan merges consecutive segments of the same type/transport into
// one entry (see the aggregateEntry branch), so „Saljethweg, Schattenbachpass, 38,30 Meilen" is a
// dozen segments in one row. The numbers therefore have to be SUMMED over entry.segmentIndexes --
// and over a pass leg that long you always go both up AND down, which is why this reports two
// numbers and not a single „Gefälle".
//
// ⚠️ Where a leg is only PARTLY covered, the sums are a lower bound: the segments without data
// contribute nothing rather than a guessed zero. That is the honest reading of „no height data
// here", and it is the same rule the server applies one layer down.
function routeEntryTerrain(entry, segments) {
	let ascent = 0;
	let descent = 0;
	let known = 0;
	(entry?.segmentIndexes || []).forEach((segmentIndex) => {
		const properties = segments?.[segmentIndex]?.properties || {};
		// 🪤 Both halves must be present. A pair with one side missing is not half a measurement,
		// it is a broken row -- and adding only its known half would invent a slope.
		if (properties.ascent_schritt === null || properties.ascent_schritt === undefined
			|| properties.descent_schritt === null || properties.descent_schritt === undefined) {
			return;
		}
		ascent += Number(properties.ascent_schritt) || 0;
		descent += Number(properties.descent_schritt) || 0;
		known += 1;
	});

	return known > 0 ? { ascent, descent, known } : null;
}

// V11 for the WHOLE route: „Auf und ab" summed over every leg, plus how many legs carry height data
// at all. Built on routeEntryTerrain -- ONE calculator, two tones of voice: there a single leg, here
// the journey.
function routeTerrainTotals(planEntries, segments) {
	const entries = Array.isArray(planEntries) ? planEntries : [];
	let ascent = 0;
	let descent = 0;
	let coveredMiles = 0;
	let coveredEntries = 0;
	entries.forEach((entry) => {
		const terrain = routeEntryTerrain(entry, segments);
		if (!terrain) {
			return;
		}

		coveredMiles += Number(entry.distance) || 0;
		ascent += terrain.ascent;
		descent += terrain.descent;
		coveredEntries += 1;
	});

	return coveredEntries > 0
		? { ascent, descent, coveredMiles, coveredEntries, totalEntries: entries.length }
		: null;
}

// Die Zeile unter den Landschaften. SYNCHRON, anders als die Landschaften: die Hoehen stecken schon in
// den Segmenten, es gibt nichts abzurufen.
//
// 🔴 Nur wenn es etwas zu sagen gibt -- ohne Hoehendaten keine Zeile, und gemessen-eben („0 rauf · 0
// runter") auch nicht. Dieselbe Regel wie in der Etappen-Infobox.
// ⚠️ Die Summe ist eine UNTERGRENZE: nur ein Teil des Wegenetzes traegt Hoehen. Spricht sie nicht fuer
// alle Etappen, nennt die Zeile fuer wie viele sie spricht -- sonst liest sich eine Teilsumme als der
// Gesamtanstieg der Reise.
// Der Hoehenvermerk EINER Etappenzeile: „… durch Weiden, Finsterkamm (12.680 Schritt bergauf, 12.176
// Schritt bergab)" (Owner 2026-07-30). Steht am Ende der Zeile, die schon Laenge und Dauer nennt --
// dieselben zwei Zahlen wie in der Etappen-Infobox, nur ohne sie aufzuklappen.
//
// 🔴 Schweigt in genau denselben Faellen wie die Zusammenfassungszeile: ohne Hoehendaten, und gemessen
// aber eben. Der fuehrende Abstand gehoert in die Rueckgabe, damit die Zeile ohne Vermerk nicht mit
// einem einzelnen Leerzeichen endet.
function routeEntryTerrainNote(entry, segments) {
	const terrain = routeEntryTerrain(entry, segments);
	if (!terrain || (terrain.ascent <= 0 && terrain.descent <= 0)) {
		return "";
	}

	const schritt = (value) => formatDecimalNumber(Math.round(value), 0);
	const unit = tr("planner.unit.schritt", "Schritt");
	return ` (${schritt(terrain.ascent)} ${unit} ${tr("planner.leg.up", "bergauf")},`
		+ ` ${schritt(terrain.descent)} ${unit} ${tr("planner.leg.down", "bergab")})`;
}

// Ab wann ist es „stark"? Beim Gefaelle, nicht bei der Hoehe -- „240 Schritt auf einer Meile wiegen
// schwer, dieselben 240 auf zehn Meilen kaum" (so sagt es der Geschwindigkeits-Dialog). 0,05 ist der
// Punkt, an dem die Steigungskurve des Servers (AVESMAPS_TERRAIN_UP_PENALTY = 5, siehe
// api/_internal/routing/terrain-factor.php) aus derselben Strecke einen Zeitfaktor von 1,25 macht --
// ab dort merkt es der Reisende an seiner Ankunftszeit.
//
// 💣 Der Hoehenmassstab ist NICHT die Streckeneinheit: 1 Karteneinheit = 3.000 Schritt und 3 Meilen,
// eine Meile traegt also 1.000 Schritt. Wer die Meilen direkt gegen die Schritt rechnet, uebertreibt
// das Gefaelle um das Tausendfache und nennt jede Ebene alpin.
const ROUTE_TERRAIN_SCHRITT_PER_MILE = 1000;
const ROUTE_TERRAIN_STEEP_GRADIENT = 0.05;

function routeTerrainIsSteep(totals) {
	if (!totals || !(totals.coveredMiles > 0)) {
		return false;
	}

	const gradient = totals.ascent / (totals.coveredMiles * ROUTE_TERRAIN_SCHRITT_PER_MILE);
	return gradient >= ROUTE_TERRAIN_STEEP_GRADIENT;
}

function routeTerrainSummaryMarkup(planEntries, segments) {
	const totals = routeTerrainTotals(planEntries, segments);
	if (!totals || (totals.ascent <= 0 && totals.descent <= 0)) {
		return "";
	}

	const schritt = (value) => formatDecimalNumber(Math.round(value), 0);
	const label = routeTerrainIsSteep(totals)
		? tr("planner.summary.elevationSteep", "Starke Höhenunterschiede")
		: tr("planner.leg.elevation", "Höhenunterschiede");
	const coverage = totals.coveredEntries < totals.totalEntries
		? ` (${tr("planner.summary.elevationCoverage", "auf {covered} von {total} Etappen", { covered: totals.coveredEntries, total: totals.totalEntries })})`
		: "";
	return `<span class="route-plan-summary__elevation">${label}: `
		+ `${schritt(totals.ascent)} ${tr("planner.unit.schritt", "Schritt")} ${tr("planner.leg.up", "bergauf")}`
		+ ` · ${schritt(totals.descent)} ${tr("planner.unit.schritt", "Schritt")} ${tr("planner.leg.down", "bergab")}${coverage}</span>`;
}

function buildRouteLegPopupHtml(entry) {
	if (!entry || typeof locationPopupMarkup !== "function") {
		return "";
	}
	// Titel = Weg-Name, wenn die Etappe einen traegt (Owner-Entscheid: "Name wenn da, sonst Typ") -- wie in
	// der Weg-Infobox. Ohne Namen (Seeweg, Querfeldein, unbenannte Wege) tritt der Typ an die Titelstelle und
	// der Untertitel entfaellt, sonst stuende zweimal dasselbe da.
	const name = String(entry.segmentLabel || "").trim();
	const title = name || routeLegUnnamedTitle(entry.type);
	const subtitle = name ? routeLegTypeLabel(entry.type) : "";
	const headerImg = typeof infoHeaderImageMarkup === "function" && typeof pathHeaderImageBasename === "function"
		? infoHeaderImageMarkup(pathHeaderImageBasename(entry.type), title, subtitle)
		: "";
	const row = (label, value) => (value === "" || value === null || value === undefined)
		? ""
		: `<div class="region-info-box__row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
	// Stroemungsvermerk wie in der Etappenzeile des Planers ("42.81 Meilen flussaufwaerts").
	const flowWord = entry.type === "Flussweg" && entry.flowState
		? ` ${entry.flowState === "upstream" ? tr("planner.flow.upstream", "flussaufwärts") : tr("planner.flow.downstream", "flussabwärts")}`
		: "";
	const hours = Number(entry.travelTime) || 0;
	let rows = "";
	rows += row(tr("planner.leg.from", "von"), entry.startName);
	rows += row(tr("planner.leg.to", "bis"), entry.endName);
	rows += row(tr("planner.summary.distance", "Distanz"), `${formatDecimalNumber(Number(entry.distance) || 0, 2)} ${tr("planner.unit.miles", "Meilen")}${flowWord}`);
	rows += row(tr("planner.summary.travelTime", "Reisezeit"), `${formatDecimalNumber(hours, 2)} ${tr("planner.unit.hours", "Stunden")} (${formatDecimalNumber(hours / 24, 2)} ${tr("planner.unit.days", "Tage")})`);
	// V11 „Auf und ab": climb and fall of this leg, in Schritt. It is what the travel time above was
	// actually computed from, so it belongs directly beneath it.
	//
	// 🔴 The row APPEARS ONLY WHEN THERE IS SOMETHING TO SAY. No height data -> no row (37 of 45 legs
	// on a real route today). Measured but level -> also no row: „0 Schritt rauf · 0 Schritt runter"
	// is noise to a traveller, and the null/zero distinction that matters so much one layer down is
	// an internal one, not something the infobox has to litigate.
	const terrain = routeEntryTerrain(entry, currentRouteSegments);
	if (terrain && (terrain.ascent > 0 || terrain.descent > 0)) {
		const schritt = (value) => formatDecimalNumber(Math.round(value), 0);
		rows += row(
			tr("planner.leg.elevation", "Höhenunterschiede"),
			`${schritt(terrain.ascent)} ${tr("planner.unit.schritt", "Schritt")} ${tr("planner.leg.up", "bergauf")}`
			+ ` · ${schritt(terrain.descent)} ${tr("planner.unit.schritt", "Schritt")} ${tr("planner.leg.down", "bergab")}`
		);
	}
	// „Fuehrt durch" (V10). Hier SYNCHRON und ohne Container, anders als in der Weg-Infobox: die
	// Daten liegen schon im Speicher, weil showRoutePlan sie beim Zeichnen der Route in EINEM Abruf
	// geholt hat -- eine Etappen-Infobox kann gar nicht aufgehen, bevor es eine Route gibt.
	// Vollstaendig und MIT Prozenten, auch wenn die Zeile im Plan geschwiegen hat: die Liste ist die
	// Erzaehlung, die Infobox der Beleg.
	let loreMarkup = "";
	if (typeof avesmapsPathLandscapesLineFor === "function") {
		const landscapes = avesmapsPathLandscapesLineFor(routeEntryPathIds(entry, currentRouteSegments));
		if (landscapes.length) {
			// formatLandscapesForInfobox liefert MARKUP (Name als Wiki-Link, wo es einen gibt) und
			// escapt selbst -- hier wird nicht ein zweites Mal escapt, sonst stuenden die Tags als Text da.
			const names = landscapes.map((landscape) => {
				const markup = formatLandscapesForInfobox([landscape], escapeHtml);
				return landscape.art
					? `<span title="${escapeHtml(landscape.art)}">${markup}</span>`
					: markup;
			}).join(" · ");
			rows += `<div class="region-info-box__row"><dt>${escapeHtml(tr("planner.leg.through", "Führt durch"))}</dt><dd>${names}</dd></div>`;
			// Flora und Fauna der genannten Landschaften -- EIN Abruf fuer alle zusammen, und
			// ausdruecklich ohne die Waren-Zeile (Owner 2026-07-29: „Flora und Fauna is richtig").
			const wikiKeys = landscapeWikiKeyList(landscapes);
			if (wikiKeys && typeof buildLoreMarkup === "function") {
				loreMarkup = buildLoreMarkup({ key: wikiKeys, name: title, kinds: "flora|fauna" });
			}
		}
	}
	return locationPopupMarkup({
		name: title,
		locationType: "dorf",
		locationTypeLabel: subtitle,
		headerImageMarkup: headerImg,
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: Boolean(subtitle),
		actionsMarkup: `<div class="region-info-box region-info-box--settlement"><dl class="region-info-box__data">${rows}${loreMarkup}</dl></div>`,
	});
}

function selectRoutePlanEntryForSegment(segmentIndex) {
	const entryIndex = currentRoutePlanEntries.findIndex((routeEntry) => (routeEntry.segmentIndexes || []).includes(segmentIndex));
	if (entryIndex >= 0) {
		selectRoutePlanEntry(entryIndex, { scrollPlan: true });
	}
}

function zoomToCurrentRoute() {
	const bounds = getCurrentRouteBounds();
	if (bounds?.isValid()) {
		fitMapToRouteBounds(bounds);
	}
}

function formatRoutePlanNodeName(name) {
	return normalizeNodeName(name) === "Kreuzung" ? "Markierung" : name;
}

function isRoutePlanMarkerName(name) {
	return normalizeNodeName(name) === "Kreuzung" || String(name || "") === "Markierung";
}

// An entry's place name as markup: a map link when a real, name-findable location exists (not a
// "Markierung"/crossing) -- clicking flies there and opens the infobox (openLocationPopupByName);
// otherwise the plain <strong> text as before. data-place-name carries the RAW name for the lookup;
// the shown text is the display name (crossings renamed to "Markierung").
function routePlanPlaceMarkup(name) {
	const displayName = formatRoutePlanNodeName(name);
	const linkable = !isRoutePlanMarkerName(name)
		&& typeof findLocationMarkerByName === "function"
		&& !!findLocationMarkerByName(name);
	if (!linkable) {
		return `<strong>${escapeHtml(displayName)}</strong>`;
	}
	return `<button type="button" class="route-plan-entry__place" data-place-name="${escapeHtml(name)}">${escapeHtml(displayName)}</button>`;
}

function appendRoutePlanLabel(labelSet, segmentLabel) {
	const label = String(segmentLabel || "").trim();
	if (label) {
		labelSet.add(label);
	}
}

function formatRoutePlanLabels(labelSet) {
	return [...labelSet].join(", ");
}

function getRoutePlanWaypointNameSet() {
	return new Set((selectedLocations || []).map((location) => normalizeLocationSearchName(location?.name || "")).filter(Boolean));
}

function isRoutePlanExplicitWaypoint(name, waypointNameSet) {
	const normalizedName = normalizeLocationSearchName(name);
	return normalizedName !== "" && waypointNameSet.has(normalizedName);
}

// Nachbearbeitung der Etappenliste per "Grenz-Lauf": Aufeinanderfolgende Roh-Etappen werden zu
// einer Anzeige-Etappe gesammelt und erst an der NAECHSTEN echten Stadt geschnitten. Anonyme
// Kreuzungen/Markierungen sind nur etappeninterne Stuetzpunkte und werden absorbiert; echte
// Zwischenstaedte bleiben als Grenze erhalten. Da jede Etappe alle Segmente von ihrer Start- bis
// zu ihrer Endstadt umfasst, stimmt der angezeigte Name IMMER mit der gehighlighteten Geometrie
// ueberein (Start = erste, Ende = letzte Stadt der Segment-Kette). Distanz/Zeit/Rast/Segmente und
// Labels bleiben erhalten; "X -> X"-Selbstschleifen verschwinden automatisch.
function cleanRoutePlanNoiseEntries(entries) {
	if (!Array.isArray(entries) || entries.length <= 1) {
		return (entries || []).map((entry) => ({ ...entry }));
	}

	const result = [];
	let open = null;

	for (const raw of entries) {
		const entry = { ...raw };
		// Synthetische "Querfeldein"/Luftlinien-Segmente sind KEIN echter Weg -> nie mit einer
		// andersartigen Etappe verschmelzen, damit die Luftlinie als eigene Etappe sichtbar bleibt
		// (sonst versteckt sie sich z.B. unter "Flussweg").
		const entryIsSynthetic = entry.type === SYNTHETIC_ROUTE_TYPE;
		const openIsSynthetic = !!open && open.type === SYNTHETIC_ROUTE_TYPE;
		// Fluss-Etappen mit unterschiedlicher Stroemung (abwaerts/aufwaerts/unbekannt) bleiben
		// getrennte Anzeige-Etappen -- der Grenz-Lauf darf den Aggregations-Split aus
		// buildRoutePlanEntries nicht wieder verkleben. Land<->Fluss verschmilzt wie bisher.
		const riverFlowBreak = !!open && open.type === "Flussweg" && entry.type === "Flussweg"
			&& (open.flowState || null) !== (entry.flowState || null);
		if (open && (entryIsSynthetic !== openIsSynthetic || riverFlowBreak)) {
			result.push(open);
			open = null;
		}
		if (!open) {
			// Start-Name bleibt der echte Segment-Endpunkt-Name. Eine Stadt der vorherigen Grenze NICHT
			// blind uebernehmen: An nicht-verketteten Bruchstellen liegt diese Stadt evtl. weit von der
			// tatsaechlichen Geometrie (z.B. "Trallsky", obwohl das Segment an Kreuzung-549 beginnt).
			open = entry;
		} else {
			open.distance += entry.distance;
			open.travelTime += entry.travelTime;
			open.restTime = (open.restTime || 0) + (entry.restTime || 0);
			open.segmentIndexes = (open.segmentIndexes || []).concat(entry.segmentIndexes || []);
			if (entry.segmentLabel) {
				// Collect the merged legs' way names but avoid duplicates -- a road crossing many
				// same-named segments should read "über X", not "über X, X, X" (rivers already
				// dedupe via the aggregate Set).
				const mergedLabels = open.segmentLabel ? open.segmentLabel.split(", ") : [];
				if (!mergedLabels.includes(entry.segmentLabel)) {
					mergedLabels.push(entry.segmentLabel);
				}
				open.segmentLabel = mergedLabels.join(", ");
			}
			open.endName = entry.endName;
		}

		// An einer echten Stadt (!= Startstadt der offenen Etappe) wird die Etappe abgeschlossen.
		if (!isRoutePlanMarkerName(open.endName) && open.endName && open.endName !== open.startName) {
			result.push(open);
			open = null;
		}
	}

	if (open) {
		// Schluss-Etappe endet (degeneriert) an einer Kreuzung -> in die letzte echte Etappe
		// absorbieren, statt "... -> Kreuzung" anzuzeigen. AUSSER die Stroemung unterscheidet
		// sich (Fluss<->Fluss): dann bleibt der Abschnitt eigenstaendig.
		const lastEntry = result.length > 0 ? result[result.length - 1] : null;
		const tailRiverFlowBreak = !!lastEntry && lastEntry.type === "Flussweg" && open.type === "Flussweg"
			&& (lastEntry.flowState || null) !== (open.flowState || null);
		if (isRoutePlanMarkerName(open.endName) && result.length > 0 && !tailRiverFlowBreak) {
			const last = result[result.length - 1];
			last.distance += open.distance;
			last.travelTime += open.travelTime;
			last.restTime = (last.restTime || 0) + (open.restTime || 0);
			last.segmentIndexes = (last.segmentIndexes || []).concat(open.segmentIndexes || []);
		} else {
			result.push(open);
		}
	}

	return result;
}

function buildRoutePlanEntries(routeNames, segments) {
	const entries = [];
	const explicitWaypointNames = getRoutePlanWaypointNameSet();
	let aggregateEntry = null;

	const flushAggregateEntry = () => {
		if (aggregateEntry) {
			aggregateEntry.segmentLabel = formatRoutePlanLabels(aggregateEntry.segmentLabelSet || new Set());
			delete aggregateEntry.segmentLabelSet;
			delete aggregateEntry.aggregateKey;
			delete aggregateEntry.transport;
			entries.push(aggregateEntry);
			aggregateEntry = null;
		}
	};

	// Segmente entlang der Fahrtrichtung orientieren -> Namen aus der echten Geometrie ableiten
	// (statt aus den teils falschen Server-Knotenlabels, vgl. Faehr-Uebergaenge).
	const orientedSegmentEndpoints = buildOrientedRouteSegmentEndpoints(segments);

	segments.forEach((segment, index) => {
		if (!segment?.geometry?.coordinates?.length || segment.geometry.coordinates.length < 2) {
			return;
		}

		// Synthetische Luftlinien behalten ihren Typ "Querfeldein" (normalizePathSubtype wuerde ihn zu
		// "Weg" verschmelzen) -> so erkennen Grenz-Lauf-Trennung und Anzeige-Label die Luftlinie.
		const rawSubtype = String(segment.properties?.feature_subtype || "");
		const isSyntheticSegment = segment.properties?.synthetic === true || rawSubtype === SYNTHETIC_ROUTE_TYPE;
		const type = isSyntheticSegment
			? SYNTHETIC_ROUTE_TYPE
			: normalizePathSubtype(segment.properties?.feature_subtype || segment.properties?.name);
		const transport = segment.properties?.transportOption || getTransportOption(type) || "groupFoot";
		const speedKm = SPEED_TABLE[transport]?.[type] || 1;
		const speedMiles = speedKm * KM_TO_MILES;
		let segDistance = 0;

		for (let coordinateIndex = 0; coordinateIndex < segment.geometry.coordinates.length - 1; coordinateIndex += 1) {
			segDistance += calculateScaledDistance(
				segment.geometry.coordinates[coordinateIndex],
				segment.geometry.coordinates[coordinateIndex + 1]
			);
		}

		const isWaterRoute = type === "Flussweg" || type === "Seeweg";
		const orientation = orientedSegmentEndpoints[index];
		// Upstream river legs display time * flow.factor (spec §4) -- must match the graph
		// edge cost or the shown hours would contradict the chosen route. Prefers the
		// explicit server-shipped flow_time_factor (server-primary display segments) over
		// the derived flow.dir + orientation factor (client-engine segments).
		const segTravelTime = (segDistance / speedMiles) * TIME_SCALE_FACTOR
			* resolveRouteSegmentFlowFactor(segment, orientation, type);
		// Stroemungszustand der Etappe (flussabwaerts/-aufwaerts/unbekannt) fuer Label und
		// Aggregations-Split: Abschnitte mit unterschiedlicher Stroemung duerfen nicht zu
		// EINEM Wasser-Aggregat verschmelzen (z. B. Flusswechsel abwaerts -> aufwaerts).
		const flowState = resolveRouteSegmentFlowState(segment, orientation, type);
		// Namen aus der Segment-Geometrie (orientiert) -> stimmen immer mit der gehighlighteten Linie
		// ueberein. Fallback auf die Server-Knotenlabels nur, wenn keine Orientierung vorliegt.
		const startName = orientation
			? routeSegmentEndpointName(orientation.start, !isWaterRoute)
			: getRouteNodeDisplayName(String(routeNames[index] || ""), index, routeNames, segments, { allowCrossings: !isWaterRoute });
		const endName = orientation
			? routeSegmentEndpointName(orientation.end, !isWaterRoute)
			: getRouteNodeDisplayName(String(routeNames[index + 1] || ""), index + 1, routeNames, segments, { allowCrossings: !isWaterRoute });
		// Wiki way name for ALL named paths (river, sea, road, Reichsstraße ...), no longer rivers
		// only (owner: "Flüsse und Wege mit Name"). Synthetic air-lines never get a name.
		const segmentLabel = !isSyntheticSegment && shouldShowRoutePathDisplayName(segment)
			? getRoutePathDisplayName(segment)
			: "";

		if (isWaterRoute) {
			const startsAtExplicitWaypoint = isRoutePlanExplicitWaypoint(startName, explicitWaypointNames);
			if (aggregateEntry && (aggregateEntry.aggregateKey !== type || aggregateEntry.transport !== transport || aggregateEntry.flowState !== flowState || startsAtExplicitWaypoint)) {
				flushAggregateEntry();
			}

			if (!aggregateEntry) {
				aggregateEntry = {
					aggregateKey: type,
					transport,
					type,
					flowState,
					startName,
					endName,
					segmentLabel: "",
					segmentLabelSet: new Set(),
					distance: 0,
					travelTime: 0,
					restTime: 0,
					segmentIndexes: [],
				};
			}

			aggregateEntry.distance += segDistance;
			aggregateEntry.travelTime += segTravelTime;
			appendRoutePlanLabel(aggregateEntry.segmentLabelSet, segmentLabel);
			if (endName && !isRoutePlanMarkerName(endName)) {
				aggregateEntry.endName = endName;
			}
			aggregateEntry.segmentIndexes.push(index);

			if (isRoutePlanExplicitWaypoint(endName, explicitWaypointNames)) {
				flushAggregateEntry();
			}
			return;
		}

		flushAggregateEntry();
		entries.push({
			type,
			flowState: null,
			startName,
			endName,
			segmentLabel,
			distance: segDistance,
			travelTime: segTravelTime,
			restTime: 0,
			segmentIndexes: [index],
		});
	});

	flushAggregateEntry();
	const cleaned = cleanRoutePlanNoiseEntries(entries);

	// Routen-Endpunkte sind bekannte Wegpunkte und sollen NIE "Kreuzung" heissen, auch wenn der
	// Pfad-Knoten weiter als ROUTE_CITY_NODE_THRESHOLD vom Ort entfernt liegt. Darum die Terminals
	// mit der breiteren THRESHOLD-Ortssuche (nicht-Kreuzung) benennen, falls noetig.
	if (cleaned.length) {
		const firstOrientation = orientedSegmentEndpoints.find(Boolean);
		const lastOrientation = [...orientedSegmentEndpoints].reverse().find(Boolean);
		if (isRoutePlanMarkerName(cleaned[0].startName) && firstOrientation) {
			const startLocation = findRouteLocationAtPathEndpoint(firstOrientation.start, { allowCrossings: false });
			if (startLocation) {
				cleaned[0].startName = startLocation.name;
			}
		}
		const lastEntry = cleaned[cleaned.length - 1];
		if (isRoutePlanMarkerName(lastEntry.endName) && lastOrientation) {
			const endLocation = findRouteLocationAtPathEndpoint(lastOrientation.end, { allowCrossings: false });
			if (endLocation) {
				lastEntry.endName = endLocation.name;
			}
		}
	}

	return cleaned;
}

// „313,1 + 236,3" -- the air legs the Drachenflug is the sum of, for the derivation column beside it. One
// leg only (start and destination, nothing in between) has nothing to derive: the note would repeat the
// total. Joined by "+" and not by an arrow (Owner 2026-07-30): the total IS their sum, while an arrow
// between bare numbers reads as „from 313,1 to 236,3", a change that is not happening here.
function routeAirLegsNote(airDistanceLegs) {
	const legs = Array.isArray(airDistanceLegs) ? airDistanceLegs : [];
	if (legs.length < 2) {
		return "";
	}

	return legs.map((legDistance) => formatDecimalNumber(legDistance, 1)).join(" + ");
}

// One row of the summary grid: label, value, and the quiet derivation the value can be recalculated from.
// EVERY figure follows the same shape (Owner 2026-07-30: „übersichtlich, aber jeder soll selber nachrechnen
// können") -- that is what stopped the Drachenflug's bracket from reading as a special case.
//
// 💣 The three cells are direct grid children (`display: contents` on the row, see route-planner.css), so
// the columns line up across ALL rows. A grid per row would give every row its own column widths.
function routeSummaryRowMarkup(label, value, derivation, extraClass = "") {
	const rowClass = extraClass ? ` ${extraClass}` : "";
	return `<div class="route-plan-summary__row${rowClass}">`
		+ `<span class="route-plan-summary__label">${label}</span>`
		+ `<span class="route-plan-summary__value">${value}</span>`
		+ `<span class="route-plan-summary__note">${derivation || ""}</span></div>`;
}


function showRoutePlan(routeNames, segments) {
	const $overview = $("#overview").empty();
	const restPerDay = getPlannerRestHoursPerDay();
	const routeResult = buildRouteResult(selectedLocations, routeNames, segments, {
		includeRests: getPlannerRestHoursPerDay() > 0,
		restHoursPerDay: restPerDay,
		optimize: $('input[name="pathType"]:checked').val() === "shortest" ? "shortest" : "fastest",
	});
	const routePlanViewModel = buildRoutePlanViewModel(routeResult, routeNames, selectedLocations);
	const planEntries = routePlanViewModel.planEntries;
	const totalDistance = routePlanViewModel.summary.distance;
	const airDistance = routePlanViewModel.summary.airDistance;
	const airDistanceLegs = routePlanViewModel.summary.airDistanceLegs;
	const totalTravelTime = routePlanViewModel.summary.travelHours;
	const totalRestTime = routePlanViewModel.summary.restHours;
	const totalHours = routePlanViewModel.summary.totalHours;
	const routeDesc = routePlanViewModel.routeDescription;
	currentRoutePlanEntries = planEntries;
	currentRouteSegments = segments;
	// V10: EIN Abruf fuer die ganze Route, hier und nicht im Markup. Das Zeichnen einer Route ist
	// eine Nutzeraktion, die genau einmal stattfindet -- 45 Etappen kosten eine Anfrage, und jede
	// danach geoeffnete Etappen-Infobox kostet keine mehr. (Der Weg-Infobox-Container geht dagegen
	// ueber den DOM-Beobachter, weil SEIN Markup fuer alle 5.650 Wege beim Kartenaufbau entsteht.)
	if (typeof avesmapsPathLandscapesEnsure === "function") {
		const routePathIds = planEntries.flatMap((entry) => routeEntryPathIds(entry, segments));
		if (routePathIds.length) {
			void avesmapsPathLandscapesEnsure(routePathIds).then(() => {
				fillRoutePlanLandscapes(planEntries, segments);
			});
		}
	}

	planEntries.forEach((entry, entryIndex) => {
		// Places as map links (openLocationPopupByName) instead of static <strong>, where a real
		// location is findable. The named way/river becomes a link too -> zooms to the leg.
		const startMarkup = routePlanPlaceMarkup(entry.startName);
		const endMarkup = routePlanPlaceMarkup(entry.endName);
		const labelSuffix = entry.segmentLabel
			? ` ${tr("planner.leg.via", "über")} <button type="button" class="route-plan-entry__label route-plan-entry__waylink" data-route-entry-index="${entryIndex}">${escapeHtml(entry.segmentLabel)}</button>`
			: "";
		// Stroemungsvermerk je Fluss-Etappe, in der Meilen-Klammer ("42.81 Meilen flussaufwärts",
		// Owner-Wording); Etappen ohne bekannte Richtung bleiben wie bisher.
		const flowWord = entry.type === "Flussweg" && entry.flowState
			? ` ${entry.flowState === "upstream" ? tr("planner.flow.upstream", "flussaufwärts") : tr("planner.flow.downstream", "flussabwärts")}`
			: "";
		// Hinweis an einer langen Querfeldein-Etappe (Luftlinie über der Schwelle): rein visuell.
		const longOffroadHint = entry.type === SYNTHETIC_ROUTE_TYPE
			&& entry.distance > SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE * DISTANCE_SCALING_FACTOR
			? ` <span class="route-plan-entry__offroad-hint" style="opacity:.7;font-size:.85em;font-style:italic;">${tr("planner.leg.offroadLong", "lange Querfeldein-Strecke")}</span>`
			: "";

		$overview.append(`
			<div role="button" tabindex="0" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${routeLegTypeLabel(entry.type)}${labelSuffix}${longOffroadHint}
			(${formatDecimalNumber(entry.distance, 2)} ${tr("planner.unit.miles", "Meilen")}${flowWord})
			${tr("planner.leg.from", "von")} ${startMarkup}
			${tr("planner.leg.to", "bis")} ${endMarkup}
			${tr("planner.leg.in", "in")} ${formatDecimalNumber(entry.travelTime, 2)} ${tr("planner.unit.hours", "Stunden")} (${formatDecimalNumber(entry.travelTime / 24, 2)} ${tr("planner.unit.days", "Tage")})
			<span class="route-plan-entry__landscapes" data-route-landscapes-index="${entryIndex}"></span>${routeEntryTerrainNote(entry, segments)}
			</div>
		`);
	});
	// Leg click (empty part of the row) zooms to the leg; role=button -> keyboard too (Enter/Space).
	$overview.find(".route-plan-entry[data-route-entry-index]").on("click", function () {
		selectRoutePlanEntry(Number(this.dataset.routeEntryIndex), { zoomToEntry: true });
	}).on("keydown", function (event) {
		// Only the row container itself; inner buttons (place/way) handle their own keys.
		if (event.target !== this) {
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			selectRoutePlanEntry(Number(this.dataset.routeEntryIndex), { zoomToEntry: true });
		}
	});
	// Place link: fly there + open the infobox (like a map click). stopPropagation so the leg zoom
	// does NOT also fire.
	$overview.find(".route-plan-entry__place").on("click", function (event) {
		event.stopPropagation();
		if (typeof openLocationPopupByName === "function") {
			openLocationPopupByName(this.dataset.placeName);
		}
	});
	// Way/river link: zoom to the leg (same action as the leg click, but as a link on the name).
	$overview.find(".route-plan-entry__waylink").on("click", function (event) {
		event.stopPropagation();
		selectRoutePlanEntry(Number(this.dataset.routeEntryIndex), { zoomToEntry: true });
	});

	// Header row: the journey title stays a button (it zooms to the route), and the share link sits beside it
	// as an icon only (Owner 2026-07-30: „oben rechts, etwas größer, Text raus"). Two SIBLING buttons -- a
	// button inside a button is invalid HTML, and the inner one would not reliably get its own clicks.
	$overview.prepend(`
		<div class="route-plan-summary__head">
			<button type="button" class="route-plan-entry route-plan-summary">
				${tr("planner.journey.prefix", "Die Reise")} ${routeDesc}
			</button>
			<button type="button" id="share-link-button" class="share-link-button share-link-button--icon" title="${tr("planner.shareRoute", "Link für diese Route kopieren")}" aria-label="${tr("planner.shareRoute", "Link für diese Route kopieren")}">🔗</button>
		</div>
		<div class="route-plan-summary__time">
			${routeSummaryRowMarkup(tr("planner.summary.distance", "Distanz"), `${formatDecimalNumber(totalDistance, 1)} ${tr("planner.unit.miles", "Meilen")}`, tr("planner.summary.legCount", "{n} Etappen", { n: planEntries.length }))}
			${routeSummaryRowMarkup(tr("planner.summary.airDistance", "Drachenflug"), `${formatDecimalNumber(airDistance, 1)} ${tr("planner.unit.miles", "Meilen")}`, routeAirLegsNote(airDistanceLegs))}
			${routeSummaryRowMarkup(tr("planner.summary.travelTime", "Reisezeit"), `${formatDecimalNumber(totalTravelTime, 1)} ${tr("planner.unit.hours", "Stunden")}`, `${formatDecimalNumber(totalTravelTime / 24, 1)} ${tr("planner.unit.days", "Tage")}`)}
			${routeSummaryRowMarkup(tr("planner.summary.restTime", "Rastzeit"), `${formatDecimalNumber(totalRestTime, 1)} ${tr("planner.unit.hours", "Stunden")}`, `${formatDecimalNumber(totalRestTime / 24, 1)} ${tr("planner.unit.days", "Tage")}`)}
			<div class="route-plan-summary__rule"></div>
			${routeSummaryRowMarkup(tr("planner.summary.totalTime", "Gesamte Reisezeit"), `${formatDecimalNumber(totalHours, 1)} ${tr("planner.unit.hours", "Stunden")}`, `${formatDecimalNumber(totalHours / 24, 1)} ${tr("planner.unit.days", "Tage")}`, "route-plan-summary__row--total")}
			<div class="route-plan-summary__rule"></div>
			<span class="route-plan-summary__landscapes"></span>
			${routeTerrainSummaryMarkup(planEntries, segments)}
		</div>
	`);
	$overview.find(".route-plan-summary").on("click", zoomToCurrentRoute);
}

// Traegt diese Landschaftsflaeche eine Beschriftung auf unserer Karte? Nur dann wird ihr Name in der
// Etappenzeile ein Knopf -- gefragt wird BEIM ZEICHNEN, nicht erst beim Klick, damit gar nicht erst
// ein Link entsteht, der ins Leere zeigt.
function canFocusLandscapeOnMap(regionPublicId) {
	return typeof findLabelEntryByEcosystemRegion === "function"
		&& typeof focusSpotlightLabel === "function"
		&& Boolean(findLabelEntryByEcosystemRegion(regionPublicId));
}

// Klick auf einen Landschaftsnamen in der Etappenzeile: hinfliegen und die Landschafts-Infobox zeigen
// -- durch focusSpotlightLabel, also GENAU dasselbe, was die Spotlight-Suche und der Deep-Link tun
// (Ebene auf Landschaften, Zoom ins Sichtbarkeitsband, Panel). Eine zweite Fassung dieses Ablaufs
// wuerde beim ersten Regelwechsel auseinanderlaufen.
//
// 💣 stopPropagation: die Etappenzeile ist selbst ein Knopf (sie zoomt auf die Etappe). Ohne das
// zoomte der Klick erst zur Landschaft und die Zeile sofort wieder zurueck auf die Etappe.
// Direkt an den frisch eingesetzten Knoepfen, nicht delegiert an #overview: der Container ueberlebt
// jede Neuberechnung, ein delegierter Zuhoerer wuerde sich also bei jeder Route erneut stapeln.
function bindRoutePlanLandscapeLinks(container) {
	container.querySelectorAll(".avesmaps-landscape__maplink").forEach((button) => {
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			const labelEntry = findLabelEntryByEcosystemRegion(button.dataset.landscapeRegion);
			if (labelEntry) {
				focusSpotlightLabel({ labelEntry });
			}
		});
	});
}

// Fuellt die Landschaftszeilen, sobald der Abruf da ist. JEDE Etappe nennt ihre EIGENEN Landschaften,
// vollstaendig, ohne Blick auf die Zeile darueber.
//
// Das war bis 2026-07-29 anders: die Zeile nannte nur, was gegenueber der Vorgaengerin NEU war, damit
// der Plan sich wie eine Reise liest statt zu stottern (gemessen Gareth->Thorwal: 16 von 31 Zeilen waren
// wortgleich ihre Vorgaengerin). Der Owner hat das am fertigen Bild widerrufen: dort stand unter einer
// Etappe „durch: Weiden" und unter der naechsten, gleich langen, NICHTS -- und das liest sich nicht als
// „unveraendert", sondern als „darueber ist nichts bekannt". Eine Etappe ist eine eigene Auskunft; wer
// auf sie klickt, will wissen, wo SIE durchgeht, nicht wo sie sich von ihrer Nachbarin unterscheidet.
// Wiederholung ist der Preis und ausdruecklich gewollt.
//
// 💣 Eine Etappe ohne Daten bleibt leer -- und das heisst NICHT „draussen": nur 34 % der Wegstrecke
// liegt ueberhaupt in einer erfassten Flaeche. „Leer" ist fast immer NOCH NICHT GEZEICHNET.
function fillRoutePlanLandscapes(planEntries, segments) {
	if (typeof avesmapsPathLandscapesLineFor !== "function") {
		return;
	}
	planEntries.forEach((entry, entryIndex) => {
		const line = avesmapsPathLandscapesLineFor(routeEntryPathIds(entry, segments));
		if (!line.length) {
			return;
		}
		const target = document.querySelector(`[data-route-landscapes-index="${entryIndex}"]`);
		if (target) {
			// innerHTML, weil der Name hier ein Knopf sein darf. Die Namen stammen aus Wiki Aventurica,
			// also aus FREMDINHALT -- escapt wird in formatLandscapesForMapLinks.
			// Der Sprung geht auf UNSERE Karte (Owner 2026-07-29), nicht ins Wiki: die Etappenzeile sagt,
			// wo man durchkommt, und ein Klick soll genau dorthin führen. Die Routen-Zusammenfassung
			// unten behält ihre Wiki-Links -- sie schlägt nach, diese Zeile navigiert.
			target.innerHTML = `${escapeHtml(tr("planner.leg.through.short", "durch"))} `
				+ formatLandscapesForMapLinks(line, escapeHtml, canFocusLandscapeOnMap);
			bindRoutePlanLandscapeLinks(target);
		}
	});

	// Die Routen-Zeile: dieselbe Rechnung ueber ALLE Wege, nach Anteil sortiert, ohne Prozente
	// (Owner 2026-07-29: „beim routenplaner muss kein % dranstehn").
	const summaryTarget = document.querySelector(".route-plan-summary__landscapes");
	const routeLine = avesmapsPathLandscapesLineFor(
		planEntries.flatMap((entry) => routeEntryPathIds(entry, segments))
	);
	if (summaryTarget && routeLine.length) {
		// Der Zeilenumbruch kommt aus dem CSS (display:block), nicht aus einem <br> im Text.
		summaryTarget.innerHTML = `${escapeHtml(tr("planner.summary.landscapes", "Landschaften auf der Route"))}: `
			+ formatLandscapesForMapLinks(routeLine, escapeHtml, canFocusLandscapeOnMap);
		bindRoutePlanLandscapeLinks(summaryTarget);
	}
}
