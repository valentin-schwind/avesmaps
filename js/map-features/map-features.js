// Location markers and labels
const VISUAL_MAX_ZOOM_LEVEL = 5;
// 🔴 LOCATION_LABEL_GAP steht seit 22.08.2026 in js/map-features/label-placement.js -- es wurde
// NUR vom Kollisionsloeser gelesen, und das Vorschaupanel im Fenster „Zoombaender" braucht es
// ebenfalls, ohne diese ganze Datei zu laden.
// 🔴 AUFGABE 8B: "Versatz" (war LOCATION_LABEL_SHIFT_SMALL, 8) und "Repel" (war
// LOCATION_LABEL_COLLISION_PADDING, 2) wurden GLOBALE Regler im Fenster „Zoombänder" -- die
// Vorgabewerte liegen jetzt allein in js/map-features/location-zoom-bands.js
// (AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende), die echten Leser rufen
// avesmapsLocationLabelSpacing("versatz"|"repel") statt einer Konstante (map-features-label-collisions.js).
// LOCATION_LABEL_COLLISION_PADDING selbst bleibt hier NUR als abgeleiteter Wert stehen -- der
// (nie feuernde) Rückfall für Regionen-Labels weiter unten in dieser Datei referenziert den Namen
// noch, und Regionen-Labels gehen diesen Umbau nichts an (eigener Wert, siehe REGION_LABEL_COLLISION_
// PADDING). Abgeleitet statt eines zweiten Literals, damit die Zahl an genau EINER Stelle steht.
const LOCATION_LABEL_COLLISION_PADDING = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende.repel;
// Kollisions-Box der TERRITORIUMS-Labels (Reichsnamen + Wappen): negativ = Box kleiner als das Label ->
// sie stoßen sich weniger ab und packen enger. Ortslabels nutzen weiter avesmapsLocationLabelSpacing("repel").
const REGION_LABEL_COLLISION_PADDING = -5;
const REGION_OVERLAP_SELECTION_TIMEOUT_MS = 3000;
const REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE = 18;
const REGION_EDIT_EDGE_HIT_TOLERANCE_PX = 22;
let recentRegionOverlapSelection = null;

$(".location-toggle").on("click", function () {
	// A settlement-size toggle click means the owner wants normal type-based visibility back, so drop
	// any active Siedlungseditor "Nur Auswahl anzeigen" filter -- it otherwise overrides these toggles
	// entirely (shouldShowLocationMarker consults the filter Set before any type check).
	if (typeof clearMapFilter === "function" && window.avesmapsSettlementMapFilterIds) {
		clearMapFilter();
	}
	setVisibleLocationTypesThrough(String(this.dataset.locationType || ""), { syncUrl: true });
});
$(".location-toggle").on("mouseenter focus", function () {
	previewVisibleLocationTypesThrough(String(this.dataset.locationType || ""));
});
$(".location-toggle").on("mouseleave blur", () => {
	previewVisibleLocationTypesThrough(null);
});
// "Politisch" ist im Frontend freigeschaltet, sobald der politische Daten-Endpoint verfügbar ist
// (nicht mehr auf den Edit-Modus beschraenkt).
$("#mapLayerModeSelect option[value=\"political\"]").prop("disabled", !POLITICAL_TERRITORIES_API_URL);
// "Landschaften": admin-only mode. disabled, NEVER remove -- .remove() would leave
// syncTransportControl without an option to read, so the combobox would show no selection at all. The
// option stays in the markup on purpose (owner decision, 2026-07-25): the name in the page source is
// fine, no JS injection. Must run BEFORE initializeTransportIconSelects(), which builds the combobox
// out of these <option> elements.
// 💣 IS_ECOSYSTEM_ENABLED ist hier IMMER noch false: die Rechteauskunft ist unterwegs. Diese Stelle
// sperrt also unbedingt, und applyEcosystemAccess() (js/config.js) macht sie für Admins wieder auf,
// sobald die Antwort da ist. Genau deshalb steht dort ein zweiter syncTransportControl-Aufruf.
// 🔴 KEIN RIEGEL MEHR (Owner 2026-08-04: die „Alle"-Ansicht gehört jedem Besucher). „Landschaften"
// steht wie „Politisch" oder „Kraftlinien" in der Auswahl, für alle. Was an der Sitzung hängt, ist nur
// noch das BEDIENEN -- Ebenenwahl, Untergrund-Regler, Zeichnen (canOperateEcosystemLayers in
// map-features-ecosystem-layer-switch.js). Deshalb ist hier auch kein zweiter syncTransportControl-Aufruf
// aus applyEcosystemAccess() mehr nötig: der Eintrag war nie gesperrt.
initializeTransportIconSelects();
initializeVersionedAssetIcons();
syncTransportControls();
syncTransportControl("mapLayerModeSelect");
$("#mapStyleSelect").on("change", function () {
	// 🔴 DER UNTERGRUND IST SEIT DEM 26.08.2026 EINE WAHL FUER JEDEN, nicht mehr nur fuer Editoren
	// (Entwurf: docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md).
	//
	// 💣 HIER STAND: `if (!IS_EDIT_MODE) { this.value = "stylized"; return; }` -- ein Riegel aus der
	// Zeit, als der Kachelstil reine Editor-Sache war. Er setzte jede Wahl eines Besuchers STILL
	// zurueck: das Menue reagierte, die Karte nicht. Genau so gemeldet („Klicken geht nicht"), und
	// es war von aussen nicht von einem kaputten Klick zu unterscheiden -- die Zelle bekam ihren
	// Rahmen, das Menue schloss, und der Untergrund blieb.
	// ⚠️ `persist` ist in setMapStyle ohnehin an IS_EDIT_MODE gebunden: ein Besucher schreibt
	// nichts in den Editor-Speicher, seine Wahl reist ueber `?mapstyle=` in der Adresse.

	// Eine von Hand gewaehlte Basis ist ab jetzt die Wahrheit -- die Ansicht "Original" darf beim
	// Verlassen nicht mehr ihre gemerkte Vorgaengerin darueberlegen (Fall #82; `basisVorOriginal`
	// in map-features-display-mode.js). typeof-Riegel wie bei den Nachbarn: die andere Datei
	// koennte einmal in einer aelteren Fassung ausgeliefert sein (§7).
	if (typeof vergissBasisVorOriginal === "function") {
		vergissBasisVorOriginal();
	}
	setMapStyle(String(this.value || "stylized"), { persist: true });
});
$("#togglePaths").change(syncPathVisibility);
$("#toggleRivers").change(syncPathVisibility);
$("#toggleSeaPaths").change(syncPathVisibility);
$("#toggleMapLabels").change(syncLabelVisibility);
// force=true: ein Haken loest weder moveend noch zoomend aus, und redraw() steigt ohne force aus,
// solange cssZoomActive steht -- ohne das Flag bliebe die Leinwand bis zum naechsten Schwenk stehen.
$("#toggleTerritoryBorders").change(() => window.AvesmapsBoundaryCanvasOverlay?.redraw(true));
if (IS_EDIT_MODE) {
	// Im Editmode bleiben Wege/Flüsse/Seewege als Haken steuerbar; im Frontend sind sie ausgeblendet
	// (Sichtbarkeit wird dort vom Kartenmodus gesetzt, siehe applyFrontendLayerModeDefaults).
	// 🔴 Hier standen bis zum 12.08.2026 auch Wege, Fluesse, Labels und Grenzen. Die vier stehen
	// jetzt im Anzeige-Menue an der Karte und sind fuer JEDEN Besucher sichtbar -- sie brauchen
	// kein Aufdecken mehr. „Seewege" bleibt als einziges: der Haken ist ausserhalb des
	// Bearbeiten-Modus wirkungslos verdrahtet (showSeaPaths in map-features-display-mode.js
	// haengt fest an IS_EDIT_MODE), und ein sichtbarer Schalter ohne Wirkung luegt.
	// ⚠️ Nur die ZEILE, nicht ihre Gruppe: „Seewege" steht in der Gruppe „Ebenen", die auch im
	// Frontend sichtbar ist. Ihre Nachbarn Wege/Labels/Grenzen/Fluesse haengen nicht daran.
	$("#toggleSeaPathsControl").prop("hidden", false);
	// V12: „Geschwindigkeit" zeigt auf der geplanten Route, wo Gelände und Strömung bremsen — damit
	// ein Editor sieht, dass sein Gebirge einen Effekt hat. Nur im Editmodus: im Frontend wäre es eine
	// Fachanzeige ohne Anlass, und die Erklärung dazu steht im Tempo-Dialog.
	$("#showRouteSpeedControl").prop("hidden", false);
}


// 💣 REIHENFOLGE: erst der MODUS, dann seine VORGABEN. Bis 2026-08-05 stand es andersherum, und das war
// der Grund für zwei Fehler auf einmal: setSelectedMapLayerMode gibt über syncEcosystemVisibility die
// Ortsschalter zurück, die sich die Landschaften-Ebene beim Betreten gemerkt hat. Lief das NACH den
// Vorgaben, überschrieb die Erinnerung den Zielmodus -- "Landschaften -> Nur Karte" zeigte dann alle
// Ortsklassen, obwohl "Nur Karte" sie ausräumt, und wer über einen geteilten Landschaften-Link kam,
// landete anschließend in "Standard" ohne einen einzigen Ort. In dieser Reihenfolge gilt die Erinnerung
// nur noch dort, wo der Zielmodus selbst nichts vorgibt. applyPlannerStateFromUrl
// (map-features-layer-state.js) macht es seit jeher genauso -- jetzt stimmen die beiden Wege überein.
$("#mapLayerModeSelect").change(() => {
	const selectedMode = getSelectedMapLayerMode();
	setSelectedMapLayerMode(selectedMode);
	applyFrontendLayerModeDefaults(selectedMode);
	// setSelectedMapLayerMode schreibt den Zustand an seinem Ende selbst weg -- das ist jetzt zu früh,
	// die Vorgaben oben kommen danach. Im Frontend ein No-op (die Funktion steigt ohne IS_EDIT_MODE
	// sofort aus), im Editmode rettet es die Filterlage über ein F5.
	syncPlannerStateToUrl();
});

// On-intent Prefetch: sobald der Nutzer im Begriff ist, einen Kartenmodus zu waehlen (Dropdown oeffnen /
// Fokus), waermen wir die Politik-Layer-Daten im Hintergrund vor -> der Wechsel zu "Politisch" ist quasi
// sofort da. Nutzt EXAKT die Fetch-Params von loadPoliticalTerritoryLayer -> der echte Load teilt das gecachte
// Promise (kein zweiter DB-Query). Best-effort + throttled; nur wenn die Politik-API existiert und wir nicht
// schon im Politik-Modus sind. Kein Loop -> ein Fetch pro Menue-Oeffnung; der 60s-Layer-Cache dedupliziert Rest.
let politicalLayerPrefetchLastAt = 0;
function prefetchPoliticalTerritoryLayer() {
	if (typeof POLITICAL_TERRITORIES_API_URL === "undefined" || !POLITICAL_TERRITORIES_API_URL) {
		return;
	}
	if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "political") {
		return;
	}
	if (typeof fetchPoliticalTerritories !== "function" || typeof map === "undefined" || !map) {
		return;
	}
	const now = Date.now();
	if (now - politicalLayerPrefetchLastAt < 5000) {
		return;
	}
	politicalLayerPrefetchLastAt = now;
	try {
		fetchPoliticalTerritories({
			action: "layer",
			year_bf: politicalTimelineYear,
			zoom: Math.round(map.getZoom()),
			edit_mode: IS_EDIT_MODE ? 1 : 0,
		}).catch(() => { /* Prefetch ist best-effort */ });
	} catch (error) {
		/* ignore */
	}
}
$("#mapLayerModeSelect").on("pointerdown focus", prefetchPoliticalTerritoryLayer);
$("#toggleCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleUnconnected").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleSparseCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
// Idee #86. ⚠️ Nicht syncLocationMarkerVisibility wie die Nachbarn darüber: dieser Befund gehört einem
// WEG, nicht einem Ort. avesmapsSyncOpenPathEndCheck zieht Ringe, Sichtbarkeit und Linienfarbe in EINEM
// Aufruf nach -- getrennt könnte ein Weg eingeblendet sein, ohne rot zu werden.
$("#toggleOpenPathEnds").change(() => {
	if (typeof avesmapsSyncOpenPathEndCheck === "function") {
		avesmapsSyncOpenPathEndCheck();
	}
	syncPlannerStateToUrl();
});
$("#toggleNodix").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleHidden").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
// Nicht bloss neu zeichnen: der Filter braucht den Regionenbestand ALLER drei Ebenen, und geladen ist
// im Normalfall nur die zuletzt aktive. Ohne das Nachladen bliebe der erste Klick wirkungslos.
$("#toggleLabelsWithRegion").change(() => {
	syncLabelVisibility();
	void ensureEcosystemRegionsLoadedForLabelFilter();
	syncPlannerStateToUrl();
});

function resetOverview() {
	$("#overview").html(tr("planner.overview.default", DEFAULT_OVERVIEW_TEXT));
}

function resetRoutePresentation() {
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
	currentRoutePlanEntries = [];
	currentRouteSegments = [];
	currentRouteNames = [];
	activeRoutePlanEntryIndex = null;

	// Raeumt Wegpunkt-Marker UND ihre (ggf. offenen) Hover-Infoboxen ab.
	removeHighlightedRouteNodes();
	resetOverview();
}

function focusMapOnActiveTargets() {
	const focusTargets = selectedLocations.map((loc) => loc.coordinates);
	if (sharePinCoordinates) {
		focusTargets.push(sharePinCoordinates);
	}

	if (!focusTargets.length) {
		return;
	}

	if (!selectedLocations.length && sharePinCoordinates) {
		// 🔴 Fix-Runde 1 (Aufgabe 4, 15.08.2026): kein `sharePinMarker.openPopup()` mehr -- der
		// Marker hat seit der Verschmelzung kein gebundenes Popup mehr (stiller No-op). Diese
		// Funktion zentriert/zoomt nur, bei JEDEM ihrer Aufrufer (route-engine.js, routing.js beim
		// initialen Laden, nach jeder Routenberechnung); keiner von ihnen will als Nebenwirkung des
		// Einpassens auch noch die Auskunft oeffnen -- ein Ersatz durch avesmapsShowWhatIsHere waere
		// hier ein Panel-Aufruf, den niemand angefragt hat. (Der Sonderfall „Stelle markieren und
		// teilen" -- ein eigener Aufrufer, der bewusst KEIN Panel wollte -- ist mit dem Owner-Entscheid
		// vom 15.08.2026, dieser Eintrag entfalle ganz, ohnehin weggefallen.)
		map.setView(sharePinCoordinates, Math.max(map.getZoom(), DEFAULT_SHARE_PIN_ZOOM));
		return;
	}

	// maxZoom deckelt das Reinzoomen bei einem einzelnen Ziel (Bounding-Box = Punkt -> sonst max. Zoom).
	map.fitBounds(L.latLngBounds(focusTargets), { padding: [50, 50], maxZoom: 4 });
}

function getFeedbackToastElement() {
	return document.getElementById("copy-feedback-toast");
}

function showFeedbackToast(message, type = "info") {
	const toastElement = getFeedbackToastElement();
	if (!toastElement) {
		return;
	}

	if (feedbackToastTimeoutId) {
		window.clearTimeout(feedbackToastTimeoutId);
		feedbackToastTimeoutId = null;
	}

	toastElement.textContent = message;
	toastElement.dataset.toastType = type;
	toastElement.hidden = false;
	toastElement.classList.add("is-visible");

	feedbackToastTimeoutId = window.setTimeout(() => {
		toastElement.classList.remove("is-visible");
		toastElement.hidden = true;
		feedbackToastTimeoutId = null;
	}, 2200);
}

// Normalisiert den Knotennamen
const normalizeNodeName = (name) => {
	// Kreuzungen und die synthetischen Wegpunkt-Anbindungspunkte (__wp_anchor_N, ein Punkt AUF einem
	// Weg) sind nur etappeninterne Stützpunkte -> auf "Kreuzung" normalisieren, damit der Grenz-Lauf
	// sie in der Etappenliste absorbiert statt einen internen Namen anzuzeigen.
	if (typeof name === "string") return name.replace(/Kreuzung-\d+/i, "Kreuzung").replace(/__wp_anchor_\d+/i, "Kreuzung");
	console.warn("Ungültiger Name in normalizeNodeName:", name);
	return name || "";
};

// (Location & crossing marker editing moved to map-features-location-editing.js - M5 split.)

function getPathStyleColors(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const simplifiedRender = Math.round(Number(map.getZoom())) <= PATH_RENDER_CONFIG.simplifiedMaxZoom;
	const isReichsstrasse = pathSubtype === "Reichsstrasse";
	// Land-Wege (außer Reichsstraßen) heller + entsättigt; Reichsstraßen weiß.
	// Wasserwege (Flussweg/Seeweg) bleiben unverändert.
	const centerColors = {
		Reichsstrasse: "#ffffff",
		Strasse: "#8b8b8b",
		Weg: "#cec4ae",
		Pfad: "#9b755a",
		Gebirgspass: "#a8695c",
		Wuestenpfad: "#bea470",
		Flussweg: "#6ec6ff",
		Seeweg: "#2f7dd3",
	};

	// Konturbreite: Default-Logik (Pro-Typ ab Zoom>simplifiedMaxZoom, simplified darunter) ODER, falls per
	// ?pathwidthtune=1 gesetzt, der Override für diesen Subtyp+Zoom. Override macht die Kontur auch im
	// simplified-Bereich sichtbar. PATH_OUTLINE_WEIGHTS/PATH_CENTER_WEIGHTS liegen in config.js.
	const outlineOverride = getPathOutlineWidthOverride(pathSubtype, map.getZoom());
	const baseOutlineWeight = outlineOverride != null ? outlineOverride : getDefaultPathOutlineWidth(pathSubtype, map.getZoom());
	const baseCenterWeight = simplifiedRender
		? Math.max(1.5, (isReichsstrasse ? 4 : 3) * PATH_RENDER_CONFIG.simplifiedCenterWeightScale)
		: (PATH_CENTER_WEIGHTS[pathSubtype] ?? PATH_CENTER_WEIGHTS.Weg);
	// Breiten-Faktor je Straßentyp + Zoomstufe (?roadtune=1, Default 1 -> unverändert).
	const widthScale = (typeof getPathWidthScale === "function") ? getPathWidthScale(pathSubtype, map.getZoom()) : 1;

	const style = {
		// Reichsstraßen bekommen einen grauen Rand (Kontur), alle anderen weiterhin weiß.
		outline: isReichsstrasse ? "#9a9a9a" : "#ffffff",
		center: centerColors[pathSubtype] || centerColors.Weg,
		outlineWeight: baseOutlineWeight * widthScale,
		centerWeight: baseCenterWeight * widthScale,
		outlineOpacity: outlineOverride != null ? 1 : (simplifiedRender ? PATH_RENDER_CONFIG.simplifiedOutlineOpacity : 1),
	};

	// Prüfhaken „Offene Wegenden" (Idee #86): ein Weg, der weder auf einem Ort noch auf einer Kreuzung
	// endet, wird von BEIDEN Graphbauern komplett verworfen -- er liegt auf der Karte und ist für die
	// Routenfindung nicht da. Solange der Haken an ist, sagt die Linie das.
	// 💣 Die Breite kommt aus avesmapsOpenPathEndStyle und hat eine Untergrenze: `widthScale` fährt eine
	// Wegart auf kleinen Zoomstufen auf 0, und ein Fund der Breite 0 wäre eingeblendet und trotzdem
	// unsichtbar. Die weiße Kontur bleibt und wächst mit -- ohne sie verschwindet das Rot auf dem
	// Gebirgspass-Braun der Karte.
	if (typeof avesmapsIsOpenPathEndCheckActive === "function"
		&& avesmapsIsOpenPathEndCheckActive()
		&& avesmapsPathHasOpenEnd(path)) {
		const befund = avesmapsOpenPathEndStyle(style.centerWeight);
		style.center = befund.farbe;
		style.centerWeight = befund.breite;
		style.outlineWeight = Math.max(style.outlineWeight, befund.breite + 2.6);
		style.outlineOpacity = 1;
	}

	return style;
}

function findNearestGraphEndpointToLatLng(latlng, { excludeLocation = null } = {}) {
	const targetPoint = map.latLngToContainerPoint(latlng);
	let nearestMatch = null;

	locationData.forEach((location) => {
		if (location === excludeLocation) {
			return;
		}

		const locationPoint = map.latLngToContainerPoint(L.latLng(location.coordinates));
		const distance = targetPoint.distanceTo(locationPoint);
		if (!nearestMatch || distance < nearestMatch.distance) {
			nearestMatch = { location, distance };
		}
	});

	return nearestMatch && nearestMatch.distance <= PATH_ENDPOINT_SNAP_DISTANCE_PX ? nearestMatch.location : null;
}

function handleEditableRegionDoubleClick(regionEntry, event, editLayer = null) {
	L.DomEvent.stop(event);
	startRegionGeometryEdit(regionEntry, editLayer || activeRegionGeometryEdit?.editLayer || regionEntry.layer);
	// Die Kante sucht DIESELBE Funktion wie das Toleranz-Tor (regionEditDoubleClickSetsCorner) und
	// die Strg-Unterteilung -- ueber alle Ringe, Loecher eingeschlossen; hier ohne Schranke, denn AUF
	// der Flaeche fuegt der Doppelklick immer ein. (Die alte, eigene Suche lief nur ueber Ring 0 und
	// setzte eine nahe der LOCHKANTE gemeinte Ecke stillschweigend auf den Aussenring.)
	const edge = findNearestEditedRegionEdge(event.latlng, regionEntry, Infinity);
	if (!edge) {
		return;
	}
	const latLngs = getRegionOuterLatLngs(regionEntry, edge.ringIndex);
	latLngs.splice(edge.index + 1, 0, L.latLng(event.latlng));
	setRegionOuterLatLngs(regionEntry, latLngs, edge.ringIndex);
	updateRegionLabelPosition(regionEntry);
	refreshRegionEditHandles();
	// Eine per Doppelklick eingefuegte Ecke ist Eckenarbeit wie jede andere -- gebuendelt.
	scheduleRegionGeometrySave(regionEntry);
}

async function deletePathFeature(path) {
	if (!window.confirm(`${getPathDisplayName(path)} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPathPublicId(path),
		});
		clearPathGeometryEdit();
		removePathFeature(path);
		updateRevisionFromEditResponse(result);
		showFeedbackToast("Weg gelöscht.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht gelöscht werden.", "warning");
	}
}

// Territoriums-Label-Schrift EINMAL aus dem echten CSS lesen (.region-label__content) -> der
// Canvas-Renderer übernimmt Farbe/Schrift/Größe. Weißer Schein ersetzt den CSS text-shadow
// (.region-label text-shadow: 0 0 4px white), den das Canvas-<img> nicht erbt.
let _regionLabelNameTypeStyle = null;
function getRegionLabelNameTypeStyle() {
	if (_regionLabelNameTypeStyle) {
		return _regionLabelNameTypeStyle;
	}
	const probe = document.createElement("div");
	probe.className = "region-label";
	probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
	const content = document.createElement("span");
	content.className = "region-label__content";
	const inner = document.createElement("span");
	inner.textContent = "Mg";
	content.appendChild(inner);
	probe.appendChild(content);
	document.body.appendChild(probe);
	const computed = window.getComputedStyle(inner);
	const style = {
		color: computed.color || "#2f251c",
		uppercase: computed.textTransform === "uppercase",
		fontFamily: computed.fontFamily || 'Georgia, "Times New Roman", serif',
		fontWeight: computed.fontWeight || "bold",
		fontStyle: "",
		letterSpacingRatio: (parseFloat(computed.letterSpacing) || 0) / 100,
		glow: "rgba(255, 255, 255, 0.95)",
		// Scharfe weiße Kontur (strokeText) statt des weichen 4px-Scheins -> klar abgesetzte Linie um die Schrift.
		glowBlur: 0,
		strokeRatio: 0.13,
		fontSizePx: Math.max(11, parseFloat(computed.fontSize) || 15),
	};
	document.body.removeChild(probe);
	_regionLabelNameTypeStyle = style;
	return style;
}

// Territoriums-Label in Zeilen umbrechen, sodass jede Zeile in maxWidthPx (verfuegbare Breite im
// Gebiet, aus dem polylabel-Radius) passt. Misst mit derselben Schrift wie der Renderer. Bricht NUR
// an Wortgrenzen; ein einzelnes ueberlanges Wort bleibt als eigene Zeile (kein Trennen). Ohne gueltige
// maxWidthPx oder wenn der Name einzeilig passt -> eine Zeile (= bisheriges Verhalten).
let _regionLabelWrapCtx = null;
function wrapRegionLabelLines(text, typeStyle, fontSizePx, maxWidthPx) {
	const full = String(text || "");
	if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0 || !full) {
		return [full];
	}
	if (!_regionLabelWrapCtx) {
		_regionLabelWrapCtx = document.createElement("canvas").getContext("2d");
	}
	const fontStylePrefix = typeStyle.fontStyle ? `${typeStyle.fontStyle} ` : "";
	_regionLabelWrapCtx.font = `${fontStylePrefix}${typeStyle.fontWeight} ${fontSizePx}px ${typeStyle.fontFamily}`;
	const letter = fontSizePx * (typeStyle.letterSpacingRatio || 0);
	const measure = (value) => {
		const display = typeStyle.uppercase ? value.toUpperCase() : value;
		const chars = [...display];
		if (!chars.length) return 0;
		return chars.reduce((sum, character) => sum + _regionLabelWrapCtx.measureText(character).width + letter, 0) - letter;
	};
	if (measure(full) <= maxWidthPx) {
		return [full];
	}
	const words = full.split(/\s+/).filter(Boolean);
	if (words.length <= 1) {
		return [full];
	}
	const lines = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (current && measure(candidate) > maxWidthPx) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [full];
}

function createRegionLabelMarkup(regionEntry, fallbackName, maxWidthPx, zoom) {
	const labelText = normalizeRegionParentheticalSpacing(
		regionEntry.labelDisplayName
		|| regionEntry.displayName
		|| regionEntry.labelName
		|| regionEntry.shortName
		|| fallbackName
		|| regionEntry.name
		|| "Herrschaftsgebiet"
	);

	const name = escapeHtml(labelText);
	// Bei niedrigem Zoom (dicht gepackt) Schrift + Wappen graduell verkleinern -> weniger Kollision:
	// Zoom 0 -> 0.75, 1 -> 0.83, 2 -> 0.91, ab 3 voll (1.0).
	const labelScale = [0.75, 0.83, 0.91, 1][Math.max(0, Math.min(3, Math.round(Number(zoom) || 0)))];
	const coatUrl = regionEntry.labelCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "";
	const coatStyle = labelScale < 1 ? ` style="width:${Math.round(40 * labelScale)}px;height:${Math.round(40 * labelScale)}px"` : "";
	const coatMarkup = coatUrl
		? `<img class="region-label__coat"${coatStyle} src="${escapeHtml(avesmapsCoatSrc(coatUrl))}" alt="" loading="lazy" decoding="async">`
		: "";

	// Name als Canvas-<img> (weich/eingebettet, wie die Karten-Namen). Fallback auf DOM-Text,
	// falls der Renderer fehlt.
	let nameMarkup = `<span>${name}</span>`; let contentMod = ""; let contentStyle = "";
	if (typeof renderMapLabelToImage === "function") {
		const style = getRegionLabelNameTypeStyle();
		const fontSizePx = style.fontSizePx * labelScale;
		const lines = wrapRegionLabelLines(labelText, style, fontSizePx, maxWidthPx);
		if (lines.length <= 1) {
			const image = renderMapLabelToImage(labelText, fontSizePx, style);
			// Das Namens-<img> trägt transparente Innenpolster (padX, Platz für den Halo). NEBEN einem Wappen wird das
			// als unschön großer Abstand Wappen<->Text sichtbar (Polster + flex-gap). Bei vorhandenem Wappen das linke
			// Polster per negativem margin-left wieder herausziehen -> das Wappen sitzt wie früher (DOM-Text) dicht am Namen.
			// Wappen sitzt jetzt zentriert OBEN (Spalte) -> kein horizontaler Zug zum Namen noetig.
			nameMarkup = `<img class="region-label__name-img" src="${image.url}" width="${image.w}" height="${image.h}" alt="${name}">`;
		} else {
			// Mehrzeilig: pro Zeile ein <img>, vertikal gestapelt + zentriert (CSS-Spalte). Die Zeilen-imgs
			// tragen vertikale Halo-Polster -> mit negativem margin-top auf normalen Zeilenabstand ziehen.
			const lineStep = Math.round(fontSizePx * 1.18);
			let firstPadX = 0; let firstLineH = 0;
			const lineImgs = lines.map((line, index) => {
				const image = renderMapLabelToImage(line, fontSizePx, style);
				if (index === 0) { firstPadX = image.padX; firstLineH = image.h; }
				const marginTop = index === 0 ? 0 : (lineStep - image.h);
				const marginStyle = marginTop !== 0 ? ` style="margin-top:${marginTop}px"` : "";
				return `<img class="region-label__name-img region-label__name-line"${marginStyle} src="${image.url}" width="${image.w}" height="${image.h}" alt="${escapeHtml(line)}">`;
			}).join("");
			nameMarkup = `<span class="region-label__lines">${lineImgs}</span>`; contentMod = " region-label__content--stacked";
		}
	}

	return `<span class="region-label__content${contentMod}"${contentStyle}>${coatMarkup}${nameMarkup}</span>`;
}

$(document).on("click", "[data-region-place-public-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	focusRegionPlace(this.dataset.regionPlacePublicId || "");
});

function bindRegionPolygonEditEvents(polygon, regionEntry) {
	if (!IS_EDIT_MODE) return;
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);
		if (pendingRegionOperation?.operation === "split") {
			void handlePendingRegionSplitClick(event);
			return;
		}
		if (pendingRegionOperation?.operation === "move") {
			handlePendingRegionMoveClick(event);
			return;
		}
		if (pendingRegionOperation) {
			void completePendingRegionOperation(regionEntry, polygon);
			return;
		}
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		// Liefert der Resolver eine abgeleitete Außengrenze, liegt an dieser Stelle KEINE Quelle
		// darunter (sonst hätte er die Quelle bevorzugt). Abgeleitete Hüllen sind nicht editierbar
		// (sie werden aus den Unterflächen neu berechnet) -> Hinweis statt nutzloser Editor.
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			// ⚠️ Hat die Hülle gar keine Quelle, ist „bitte das Unterreich anklicken" falsch: es gibt
			// keins. Dann ist der Rechtsklick der einzige Weg — und der Satz muss ihn nennen.
			// 💣 Der Satz kommt aus EINEM Erzeuger, den auch der Doppelklick-Zweig unten ruft; er
			// stand vorher zweimal im Code, und gefixt wurde einer.
			showFeedbackToast(avesmapsRegionDerivedClickHint(selectedRegionEntry), "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("dblclick", (event) => {
		if (event.originalEvent?.target?.closest?.(".region-edit-handle-marker")) return;
		if (activeRegionGeometryEdit?.regionEntry === regionEntry && activeRegionGeometryEdit.editLayer === polygon) {
			handleEditableRegionDoubleClick(regionEntry, event, polygon);
			return;
		}
		// Laeuft eine Sitzung auf einer ANDEREN Flaeche und sitzt der Doppelklick innerhalb der
		// Kantentoleranz von DEREN Kante, gewinnt das Punktsetzen: beim Nachziehen einer gemeinsamen
		// Grenze liegt fast immer der Nachbar unter dem Klick, und ausgerechnet der Klick an der
		// Kante wechselte sonst die Sitzung (Owner 26.08.2026).
		if (regionEditDoubleClickSetsCorner(event)) {
			return;
		}
		L.DomEvent.stop(event);
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		// Wie beim Einfach-Klick: eine abgeleitete Außengrenze bedeutet hier "keine Quelle drunter".
		// 💣 Und wie beim Einfach-Klick derselbe Erzeuger — wer klickt und nichts passiert,
		// doppelklickt, und bekam hier bis 16.08.2026 den Satz zu lesen, der für einen Geist falsch ist.
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			showFeedbackToast(avesmapsRegionDerivedClickHint(selectedRegionEntry), "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("contextmenu", (event) => {
		// 🔴 STRG + RECHTSKLICK ERZWINGT DAS KARTENMENUE (Owner 14.08.2026), genau wie in der
		// Landschaften-Ebene (map-features-ecosystem-rendering.js). Grund ist derselbe: wo die Karte
		// flaechendeckend mit Gebieten belegt ist, gibt es keine freie Stelle mehr, an der man
		// „Hierher reisen", „Entfernung messen", „Suchen" oder „Hier melden" noch erreichen koennte.
		//
		// 🪤 OHNE `stop` aussteigen, nicht mit. Genau das reicht das Ereignis an map.on("contextmenu")
		// weiter, und DORT wird preventDefault gerufen -- das Browsermenue bleibt also weg, ohne dass
		// diese Zeile es selbst unterdruecken muesste. Ein `L.DomEvent.stop` hier taete das Gegenteil
		// von dem, was der Griff bezweckt.
		if (event?.originalEvent?.ctrlKey || event?.originalEvent?.metaKey) {
			return;
		}
		L.DomEvent.stop(event);
		// 🔴 `advance: false` -- das Menue handelt auf der gewaehlten Flaeche und schaltet nicht
		// weiter. Vorher zaehlte dieser Rechtsklick den Durchschalt-Zaehler mit hoch, und der
		// Editor oeffnete die NACHBARFLAECHE der eben gewaehlten (Fall #73).
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon, { advance: false });
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		openRegionContextMenu(
			selectedRegionEntry,
			selectedLayer,
			event.latlng,
			event.originalEvent?.clientX ?? 0,
			event.originalEvent?.clientY ?? 0
		);
	});
	polygon.on("mouseover", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		setPendingRegionTargetHighlight(regionEntry);
	});
	polygon.on("mouseout", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		clearPendingRegionTargetHighlight();
	});
}

$(document).on("click", "[data-region-context-action]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const action = this.dataset.regionContextAction || "";
	const regionEntry = activeRegionContextEntry;
	const regionLayer = activeRegionContextLayer || regionEntry?.layer || null;
	const polygonIndex = activeRegionContextPolygonIndex;
	closeRegionContextMenu();
	if (!regionEntry) {
		return;
	}

	// One gate for every writing action on a political area -- geometry edits, moves, splits,
	// deletes and the boolean operations alike. It sits here rather than in each handler for the
	// same reason the server's gate sits in front of its dispatch: a new action cannot forget it.
	// Only "show-info" passes while someone else holds the claim, which is the whole point -- the
	// second editor keeps the map, and loses only the ability to change it.
	if (typeof avesmapsTerritoryEditBlockedBy === "function") {
		const blockedBy = avesmapsTerritoryEditBlockedBy(action);
		if (blockedBy) {
			showFeedbackToast(`Bearbeiten blockiert – ${blockedBy} ist im politischen Modus.`, "warning");
			return;
		}
	}

	if (REGION_BOOLEAN_CONTEXT_ACTIONS.has(action)) {
		startPendingRegionOperation(action, regionEntry, regionLayer);
		return;
	}

	const contextActionHandler = REGION_CONTEXT_ACTIONS[action];
	if (!contextActionHandler) {
		return;
	}

	contextActionHandler({ regionEntry, regionLayer, polygonIndex });
});

const REGION_BOOLEAN_CONTEXT_ACTIONS = new Set([
	"union",
	"difference",
	"difference-keep-target",
	"intersection",
]);

const REGION_CONTEXT_ACTIONS = {
	"edit-geometry": ({ regionEntry, regionLayer }) => {
		startRegionGeometryEdit(regionEntry, regionLayer);
	},
	"edit-properties": ({ regionEntry }) => {
		// Abgeleitete Außengrenzen haben keine eigenen editierbaren Eigenschaften/Zuweisung
		// (sie werden aus den Unterflächen berechnet) -> Hinweis statt leerem "kein Knoten"-Editor.
		// 💣 Für eine Hülle OHNE Quelle gilt das nicht: sie steht mit genau diesem Eintrag im Menü
		// (AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS), und ein Unterreich, das man stattdessen
		// bearbeiten könnte, gibt es nicht. Der Ausstieg machte den Eintrag sichtbar und tot.
		// Wer entscheidet, steht in map-features-region-interactivity.js -- derselbe Erzeuger, der
		// auch das Menü zusammenstellt, damit "Geist" nicht an zwei Stellen verschieden heißt.
		const derivedPropertiesHint = avesmapsRegionDerivedPropertiesHint(regionEntry);
		if (derivedPropertiesHint) {
			showFeedbackToast(derivedPropertiesHint, "info");
			return;
		}
		clearRegionGeometryEdit();

		if (window.AvesmapsPoliticalTerritoryEditorLink) {
			window.AvesmapsPoliticalTerritoryEditorLink.open(regionEntry);
			return;
		}

		openRegionEditDialog(regionEntry, { title: "Territoriumseditor" });
	},
	"show-info": ({ regionEntry }) => {
		openRegionCompactTooltip(regionEntry);
		showPoliticalTerritoryTimelineSelection(regionEntry);
	},
	"move": ({ regionEntry }) => {
		startPendingRegionMove(regionEntry, pendingContextMenuLatLng || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter());
	},
	"split": ({ regionEntry, regionLayer }) => {
		startPendingRegionSplit(regionEntry, regionLayer);
	},
	"extract": ({ regionEntry, regionLayer }) => {
		void extractRegionGeometryPartAsNewTerritory(regionEntry, regionLayer);
	},
	"delete": ({ regionEntry, regionLayer, polygonIndex }) => {
		regionEditEntry = regionEntry;
		void deleteActiveRegion(regionLayer, polygonIndex);
	},
};

// (Region geometry CRUD moved to map-features-region-crud.js - M5 split.)

// Verarbeitung der Rastzeiten
