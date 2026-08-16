function getVisualZoomLevel(zoomLevel = map.getZoom()) {
	const roundedZoomLevel = Math.round(Number(zoomLevel));
	if (!Number.isFinite(roundedZoomLevel)) {
		return 0;
	}

	return Math.max(0, Math.min(VISUAL_MAX_ZOOM_LEVEL, roundedZoomLevel));
}

// Die Markergröße kommt aus dem Zoomband (js/map-features/location-zoom-bands.js), nicht mehr aus
// einer geometrischen Kurve. Der Admin stellt den AUSSENDURCHMESSER ein -- das ist die Zahl, die er
// auf dem Schirm misst; Kern und Kontur werden daraus zurückgerechnet.
const LOCATION_MARKER_CONTOUR_RATIO = 0.33; // weisse Kontur = 33 % des Kernradius ...
const LOCATION_MARKER_CONTOUR_MIN = 0.5;    // ... mindestens aber 0.5 px dick

// Eine reine Zoomband-Änderung ändert weder Zoomstufe noch Warnring: ohne diese Revision bliebe der
// alte Radius stehen, bis jemand zoomt. Sie wird von bumpLocationMarkerStyleRevision() erhöht.
let _locationMarkerStyleRevision = 0;

function bumpLocationMarkerStyleRevision() {
	_locationMarkerStyleRevision += 1;
}

function getLocationMarkerSize(locationType, zoomLevel = map.getZoom()) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		// Kreuzungen sind kein Ortstyp und tragen kein Band -- sie erscheinen über ihren eigenen
		// Haken, ohne Zoomuntergrenze (Owner 2026-08-14).
		const visualZoomLevel = getVisualZoomLevel(zoomLevel);
		return visualZoomLevel <= 3 ? 5 : Math.max(7, 5 + visualZoomLevel * 1.5);
	}
	const value = avesmapsLocationZoomBandValue("marker", locationType, zoomLevel);
	if (value !== null) {
		return value;
	}
	// 💣 UNTERHALB DES BANDES GILT DIE ERSTE GEFÜLLTE ZELLE, NICHT 0. Diese Funktion wird auch für
	// Marker gerufen, die eine der Weichen WEITER OBEN in shouldShowLocationMarker eingeblendet hat
	// -- Prüfhaken-Funde, der Siedlungsfilter, der angepinnte Suchtreffer. Die zeigen ihre Funde
	// ausdrücklich ohne Rücksicht auf die Zoomstufe (Owner 2026-08-14); mit 0 bekämen sie einen
	// Marker der Größe null und wären eingeblendet und unsichtbar zugleich. Die abgeschaffte Kurve
	// tat dasselbe über Math.max(spec.from, z).
	const minZoom = avesmapsLocationZoomBandMinZoom("marker", locationType);
	return minZoom === null ? 0 : avesmapsLocationZoomBandValue("marker", locationType, minZoom);
}

function getLocationMarkerCoreRadius(locationType, zoomLevel = map.getZoom()) {
	return getLocationMarkerSize(locationType, zoomLevel) / 2 / (1 + LOCATION_MARKER_CONTOUR_RATIO);
}

function getLocationMarkerContourWidth(locationType, zoomLevel = map.getZoom()) {
	const coreRadius = getLocationMarkerCoreRadius(locationType, zoomLevel);
	return Math.max(LOCATION_MARKER_CONTOUR_MIN, coreRadius * LOCATION_MARKER_CONTOUR_RATIO);
}

function getLocationMarkerBorderWidth(locationType, zoomLevel = map.getZoom()) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		return 0;
	}
	return Math.round(getLocationMarkerContourWidth(locationType, zoomLevel) * 100) / 100;
}

// ringModifier: "" | "unconnected" | "sparse-crossing" -- the editor marker tools (#25) paint at most
// ONE warning ring per marker; resolveMarkerRingModifier picks it.
function createLocationMarkerIcon(locationType, zoomLevel = map.getZoom(), ringModifier = "") {
	if (locationType === CROSSING_LOCATION_TYPE) {
		const markerSize = getLocationMarkerSize(locationType, zoomLevel);
		const isSimpleMarker = getVisualZoomLevel(zoomLevel) <= 3;
		const shapeClasses = ["location-visual-marker__shape", "location-visual-marker__shape--crossing"];
		if (isSimpleMarker) {
			shapeClasses.push("location-visual-marker__shape--simple");
		}
		if (ringModifier) {
			shapeClasses.push(`location-visual-marker__shape--${ringModifier}`);
		}
		const iconHtml = `<span class="${shapeClasses.join(" ")}" style="width:${markerSize}px;height:${markerSize}px;"></span>`;

		return L.divIcon({
			className: `location-visual-marker location-visual-marker--crossing${isSimpleMarker ? " location-visual-marker--simple" : ""}`,
			html: iconHtml,
			iconSize: [markerSize, markerSize],
			iconAnchor: [markerSize / 2, markerSize / 2],
			popupAnchor: [0, -(markerSize / 2)],
		});
	}

	const markerSize = getLocationMarkerSize(locationType, zoomLevel);
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	const isSite = locationType === "gebaeude";
	const isDiamond = isSite && visualZoomLevel >= 4; // Raute erst zeigen, wenn sie lesbar ist
	const isCapital = locationType === "metropole" && visualZoomLevel >= 3 && markerSize >= 14;

	const shapeClasses = ["location-visual-marker__shape"];
	shapeClasses.push(isDiamond ? "location-visual-marker__shape--diamond" : "location-visual-marker__shape--circle");
	if (isSite) {
		shapeClasses.push("location-visual-marker__shape--site");
	}
	if (isCapital) {
		shapeClasses.push("location-visual-marker__shape--capital");
	}
	if (ringModifier) {
		shapeClasses.push(`location-visual-marker__shape--${ringModifier}`);
	}

	const styleDeclarations = [
		`width:${markerSize}px`,
		`height:${markerSize}px`,
		`border-width:${getLocationMarkerBorderWidth(locationType, zoomLevel)}px`,
	];
	if (isCapital) {
		styleDeclarations.push(`--accent-ring-width:${Math.round(markerSize * 0.12)}px`);
	}

	const iconHtml = `<span${buildHtmlAttributes({
		class: shapeClasses.join(" "),
		style: `${styleDeclarations.join(";")};`,
	})}></span>`;

	return L.divIcon({
		className: "location-visual-marker",
		html: iconHtml,
		iconSize: [markerSize, markerSize],
		iconAnchor: [markerSize / 2, markerSize / 2],
		popupAnchor: [0, -(markerSize / 2)],
	});
}

// Pro Sync-Lauf konstante Sichtbarkeits-Eingaben EINMAL erheben: Modus-Select, Größen-Toggles und
// Editmode-Checkboxen sind für alle ~3000 Marker identisch, wurden aber pro Marker per jQuery abgefragt
// (~6000 DOM-Queries pro moveend). Die Typ-Sichtbarkeit füllt sich lazy, weil die Typ-Liste hier nicht
// bekannt sein muss. shouldShowLocationMarker/-NameLabel funktionieren auch OHNE Kontext (Einzelaufrufe).
// Verborgen (Owner 15.08.2026): die Karte zeichnet ihn nicht, bis jemand seinen Namen eingibt.
// Zwilling von isNodixLocation -- EIN Praedikat, damit Markierung und Namensschild dieselbe Frage
// stellen und nicht zwei Bedingungen auseinanderlaufen koennen. Es beantwortet beide Haelften
// zugleich: „ist versteckt" UND „ist in dieser Sitzung noch nicht aufgedeckt".
function isHiddenLocation(location) {
	if (!location || !location.isHidden) {
		return false;
	}
	const publicId = String(location.publicId || "");
	return !(publicId
		&& typeof avesmapsRevealedHiddenLocationIds !== "undefined"
		&& avesmapsRevealedHiddenLocationIds.has(publicId));
}

function createLocationVisibilityContext() {
	const visibleTypeCache = {};
	const unconnectedToggleChecked = IS_EDIT_MODE && $("#toggleUnconnected").is(":checked");
	const sparseCrossingsToggleChecked = IS_EDIT_MODE && $("#toggleSparseCrossings").is(":checked");
	return {
		mapLayerMode: typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "",
		nodixToggleChecked: IS_EDIT_MODE && $("#toggleNodix").is(":checked"),
		hiddenToggleChecked: IS_EDIT_MODE && $("#toggleHidden").is(":checked"),
		crossingsToggleChecked: IS_EDIT_MODE && $("#toggleCrossings").is(":checked"),
		unconnectedPublicIds: unconnectedToggleChecked ? getUnconnectedLocationPublicIds() : null,
		sparseCrossingPublicIds: sparseCrossingsToggleChecked ? getSparseCrossingPublicIds() : null,
		isTypeVisible(locationType) {
			if (!(locationType in visibleTypeCache)) {
				visibleTypeCache[locationType] = isLocationTypeVisible(locationType);
			}
			return visibleTypeCache[locationType];
		},
	};
}

// 💣 EIN PRUEFHAKEN ZEIGT SEINE FUNDE (Owner 2026-08-14). Diese eine Funktion beantwortet BEIDE
// Fragen zugleich -- "welchen Warnring traegt der Marker" und "warum ist er ueberhaupt da": ein Fund
// blendet seinen Marker ein, unabhaengig von den Ortsgroessen-Haken UND unabhaengig von der
// Zoomstufe (siehe shouldShowLocationMarker). Waeren das zwei Funktionen, koennte ein Marker
// eingeblendet sein OHNE Ring oder geringelt OHNE Grund -- die Divergenz ist hier baulich unmoeglich.
//   Vorher (spec docs/superpowers/specs/2026-07-15-unverbundene-orte-marker-design.md) ringelte
// "Unverbunden" nur, was die aktive Groessenkaskade ohnehin zeigte, und "Kreuzungen mit 2 Wegen" tat
// ohne "Kreuzungen" gar nichts. Genau die Orte, die man sucht, blieben damit unsichtbar; der
// Nicht-Ziel-Satz "Nodices bleiben aussen vor" ist mit derselben Entscheidung hinfaellig -- ein
// unverbundener Nodix IST eine Anbindungsluecke, und ohne "Unverbunden" ist die Menge sowieso null.
// ⚠️ Hoechstens EIN Befund je Marker: eine Kreuzung ganz ohne Weg erfuellt beide Kriterien, aber die
// fehlende Anbindung (pink) ist der gravierendere Befund und gewinnt gegen "ueberfluessige
// Kreuzung" (tuerkis). Die Reihenfolge der beiden Bloecke IST diese Rangfolge.
function resolveLocationCheckFinding(entry, visibilityContext = null) {
	if (!IS_EDIT_MODE || !entry.publicId) {
		return "";
	}
	const unconnectedPublicIds = visibilityContext
		? visibilityContext.unconnectedPublicIds
		: ($("#toggleUnconnected").is(":checked") ? getUnconnectedLocationPublicIds() : null);
	if (unconnectedPublicIds && unconnectedPublicIds.has(entry.publicId)) {
		return "unconnected";
	}
	const sparseCrossingPublicIds = visibilityContext
		? visibilityContext.sparseCrossingPublicIds
		: ($("#toggleSparseCrossings").is(":checked") ? getSparseCrossingPublicIds() : null);
	if (sparseCrossingPublicIds
		&& entry.locationType === CROSSING_LOCATION_TYPE
		&& sparseCrossingPublicIds.has(entry.publicId)) {
		return "sparse-crossing";
	}
	return "";
}

function shouldShowLocationMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds(), visibilityContext = null) {
	// Siedlungseditor "Nur Auswahl anzeigen" (edit-mode-only, see
	// map-features-settlement-territory-assign.js setMapFilter/clearMapFilter): when a filter
	// Set is active, ONLY markers whose publicId is in it are shown -- takes priority over every
	// other visibility rule below. This is a pure read of a temporary global (never persisted,
	// never mutates `entry`/locationData), so clearing it (window.avesmapsSettlementMapFilterIds =
	// null) makes this function fall through to the exact same result it would have produced had
	// the filter never existed -- full, exact restoration.
	if (IS_EDIT_MODE && typeof window.avesmapsSettlementMapFilterIds !== "undefined" && window.avesmapsSettlementMapFilterIds) {
		return Boolean(entry.publicId) && window.avesmapsSettlementMapFilterIds.has(entry.publicId);
	}
	// Per "Nächsten Ort finden"/Suche temporaer angepinnter Marker bleibt sichtbar, auch wenn seine
	// Ortsgroesse nicht eingeblendet ist — bis die zugehoerige Infobox geschlossen wird.
	if (typeof nearestLookupPinnedMarkerEntry !== "undefined" && entry === nearestLookupPinnedMarkerEntry) {
		return true;
	}
	// 💣 Ein Prüfhaken ZEIGT seine Funde (resolveLocationCheckFinding, Owner 2026-08-14): steht VOR der
	// Kreuzungs- und der Typ-Kaskade, weil er beide aushebelt -- samt der Mindestzoomstufen weiter
	// unten (Kleinstadt ab 1, Dorf ab 2, Bauwerk ab 3). Wer herauszoomt, um Anbindungsluecken zu
	// suchen, versteckte sich sonst mit der Zoomstufe genau die Funde. Nur der Ausschnitt gilt weiter.
	if (resolveLocationCheckFinding(entry, visibilityContext)) {
		return isMarkerEntryInRenderBounds(entry, renderBounds);
	}
	// 💣 HIER, UND NUR HIER: nach den Pruefhaken, vor allem anderen. Ein versteckter Ort OHNE
	// Weganbindung ist weiterhin eine Anbindungsluecke und muss seinen pinken Ring bekommen -- „ein
	// Pruefhaken ZEIGT seine Funde" (Owner 2026-08-14). Stuende dieser Riegel darueber, waere
	// „verstecken" ein Weg, den Pruefhaken stillzulegen, und der Editor saehe die Luecke nie wieder.
	// Stuende er darunter, wuerde ein versteckter Nodix im Kraftlinien-Modus doch leuchten.
	if (isHiddenLocation(entry.location)) {
		const hiddenToggleChecked = visibilityContext
			? visibilityContext.hiddenToggleChecked
			: IS_EDIT_MODE && $("#toggleHidden").is(":checked");
		return hiddenToggleChecked && isMarkerEntryInRenderBounds(entry, renderBounds);
	}

	// ⚠️ Diese Weiche steht (wie eh und je) VOR dem Kraftlinien-Modus: "Kreuzungen" hat dessen
	// "nur Nodices" schon immer ueberstimmt. Die Pruefhaken darueber tun jetzt dasselbe -- alle drei
	// verhalten sich gleich, statt dass einer als Sonderfall herausfaellt.
	if (entry.locationType === CROSSING_LOCATION_TYPE) {
		const crossingsToggleChecked = visibilityContext
			? visibilityContext.crossingsToggleChecked
			: IS_EDIT_MODE && $("#toggleCrossings").is(":checked");
		// Ohne Zoomuntergrenze (Owner 2026-08-14, vorher >= 3): ein Haken, der nur auf drei von sechs
		// Zoomstufen wirkt, sieht beim Herauszoomen wie ein Fehler aus.
		return crossingsToggleChecked
			&& isMarkerEntryInRenderBounds(entry, renderBounds);
	}

	// Kraftlinien-Modus: NUR Nodices zeigen -- unabhängig von den Stadt-Größen-Toggles und vom Zoom (auch im Editmode).
	const mapLayerMode = visibilityContext
		? visibilityContext.mapLayerMode
		: (typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "");
	if (mapLayerMode === "powerlines") {
		return isNodixLocation(entry.location) && isMarkerEntryInRenderBounds(entry, renderBounds);
	}

	// Politische Ansicht: die Hauptstaedte der aktuell ANGEZEIGTEN Gebiete sind die Standard-Siedlungsanzeige
	// (Set wird in syncRegionVisibility zoom/flaechen-abhaengig gefuellt). Sie erscheinen unabhaengig von den
	// Stadt-Groessen-Toggles und der Typ-Mindestzoomstufe; klickt der Nutzer einen Typ an, kommt dieser zusaetzlich.
	if (entry.publicId
		&& typeof window.politicalDisplayedCapitalPublicIds !== "undefined"
		&& window.politicalDisplayedCapitalPublicIds
		&& window.politicalDisplayedCapitalPublicIds.has(String(entry.publicId))) {
		return isMarkerEntryInRenderBounds(entry, renderBounds);
	}

	const nodixToggleChecked = visibilityContext
		? visibilityContext.nodixToggleChecked
		: IS_EDIT_MODE && $("#toggleNodix").is(":checked");
	const isVisibleByNodixToggle = nodixToggleChecked && isNodixLocation(entry.location);
	// 💣 DIE ERSCHEINUNGSSTUFE IST DIE ERSTE GEFÜLLTE ZELLE DES BANDES -- es gibt keine zweite Zahl
	// mehr, die mit ihr auseinanderlaufen könnte. Bis zum 16.08.2026 stand 0/0/0/1/2/3 hier als
	// if-Kette UND in LOCATION_MARKER_RADIUS_SPEC[*].from; ein gekoppelter Wert in zwei Zeilen,
	// den nichts zusammenhielt.
	const typeVisible = visibilityContext
		? visibilityContext.isTypeVisible(entry.locationType)
		: isLocationTypeVisible(entry.locationType);
	return (isVisibleByNodixToggle || typeVisible)
		&& avesmapsLocationZoomBandValue("marker", entry.locationType, zoomLevel) !== null
		&& isMarkerEntryInRenderBounds(entry, renderBounds);
}

function syncLocationMarkerVisibility() {
	syncLocationToggleButtons();
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	const visibilityContext = createLocationVisibilityContext();
	// EXPERIMENTELL (Flag ?canvasmarkers=1, default AUS): dorf+kleinstadt ausserhalb Edit -> Canvas.
	const canvasOn = typeof LOCATION_CANVAS_MARKERS_ENABLED !== "undefined" && LOCATION_CANVAS_MARKERS_ENABLED && !IS_EDIT_MODE;
	if (canvasOn) {
		locationCanvasLayer.init(map);
	}
	const canvasEntries = [];
	$.each(locationMarkers, (i, entry) => {
		const shouldShow = shouldShowLocationMarker(entry, zoomLevel, renderBounds, visibilityContext);
		const canvasEligible = canvasOn
			&& shouldShow
			&& LOCATION_CANVAS_TYPES.has(entry.locationType)
			&& !entry._canvasPromoted
			&& !(typeof nearestLookupPinnedMarkerEntry !== "undefined" && entry === nearestLookupPinnedMarkerEntry);
		if (canvasEligible) {
			if (map.hasLayer(entry.marker)) {
				map.removeLayer(entry.marker); // DOM-Marker raus -> Canvas zeichnet ihn
			}
			canvasEntries.push(entry);
			return;
		}
		// Icon nur neu bauen, wenn sich die Zoomstufe (= Markergroesse/-stil) ODER der Warnring
		// seit dem letzten Bau fuer diesen Marker geaendert hat. Beim reinen Pannen bleibt das Icon
		// identisch -> kein setIcon-Neuaufbau pro sichtbarem Marker pro moveend.
		// 💣 Auch die Stilrevision prufen: eine Zoomband-Aenderung aendert weder Zoomstufe noch Warnring
		// und bliebe deshalb unbemerkt -- der Marker behaelte seinen alten Radius, bis jemand zoomt.
		const ringModifier = resolveLocationCheckFinding(entry, visibilityContext);
		if (shouldShow && (entry.iconZoomLevel !== zoomLevel || entry._ringModifier !== ringModifier || entry._markerStyleRevision !== _locationMarkerStyleRevision)) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, zoomLevel, ringModifier));
			entry.iconZoomLevel = zoomLevel;
			entry._ringModifier = ringModifier;
			entry._markerStyleRevision = _locationMarkerStyleRevision;
		}
		const isOnMap = map.hasLayer(entry.marker);
		if (shouldShow && !isOnMap) {
			map.addLayer(entry.marker);
		} else if (!shouldShow && isOnMap) {
			map.removeLayer(entry.marker);
		}
	});
	if (canvasOn) {
		locationCanvasLayer.setEntries(canvasEntries);
	}
	syncLocationNameLabelVisibility(visibilityContext);
}

function getMapRenderBounds() {
	return map.getBounds().pad(0.2);
}

function isLatLngInRenderBounds(latlng, renderBounds = getMapRenderBounds()) {
	return renderBounds.contains(L.latLng(latlng));
}

function isMarkerEntryInRenderBounds(entry, renderBounds = getMapRenderBounds()) {
	return entry?.marker && isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

