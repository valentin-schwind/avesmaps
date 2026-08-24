// Filtert gezielt laute Diagnoseausgaben aus dem Routing-Aufbau.
const AVESMAPS_FILTERED_CONSOLE_PREFIXES = [
	"Graph:",
	"Alle Tooltips entfernt.",
	"Ausgewählte Locations:",
	"Ungültige Eingaben:",
	"Server-Routing-Probe gestartet:",
	"Server-Routing-Probe Client-IDs:",
	"Server-Routing-Probe Vergleich:",
	"Server-Routing-Probe Server-IDs:",
	"Server-Routing-Probe Server-Segmente:",
	"Server-Routing-Probe Ergebnis:",
	"Berechnete Route:",
	"Komplette Route (Knoten):",
	"Routensegmente:",
	"Route points:",
	"Alle Routen-Knoten entfernt.",
];

function avesmapsIsRouteDebugMode() {
	return new URLSearchParams(window.location.search).get("serverrouting") === "1";
}

function avesmapsShouldFilterConsoleMessage(args) {
	if (avesmapsIsRouteDebugMode()) {
		return false;
	}

	const message = typeof args[0] === "string" ? args[0] : "";
	return AVESMAPS_FILTERED_CONSOLE_PREFIXES.some((prefix) => message.startsWith(prefix))
		|| message.includes("Querfeldein-Verbindungen für getrennte Orte hinzugefügt.");
}

const AVESMAPS_ORIGINAL_CONSOLE_LOG = console.log.bind(console);
const AVESMAPS_ORIGINAL_CONSOLE_INFO = console.info.bind(console);
console.log = (...args) => {
	if (avesmapsShouldFilterConsoleMessage(args)) {
		return;
	}
	AVESMAPS_ORIGINAL_CONSOLE_LOG(...args);
};
console.info = (...args) => {
	if (avesmapsShouldFilterConsoleMessage(args)) {
		return;
	}
	AVESMAPS_ORIGINAL_CONSOLE_INFO(...args);
};

// Globale Variablen
let locationData = [],
	pathData = [],
	powerlineData = [],
	labelData = [],
	regionData = [],
	politicalTerritoryOptions = [],
	politicalTerritoryHierarchy = [],
	politicalTerritoryOptionsLoaded = false,
	politicalTerritoryOptionsLoading = false,
	politicalTerritoryOptionsPromise = null,
	politicalTerritoryOptionsSource = "",
	politicalTerritoryWikiReferences = [],
	politicalTerritoryFallbackData = null,
	regionAssignmentWikiPath = [],
	regionAssignmentEnsuredChain = [],
	regionAssignmentActiveWikiPublicId = "",
	regionAssignmentBreadcrumbCache = new Map(),
	syntheticPathSegments = new Map(),
	locationMarkers = [],
	locationNameLabels = [],
	pathLayers = [],
	powerlineLayers = [],
	labelMarkers = [],
	regionLayers = [],
	regionPolygons = [],
	regionLabels = [],
	// Landschaften (Erprobung): EIGENE Registry, bewusst nicht regionPolygons mitbenutzt --
	// clearRenderedRegionLayers() leert das bei jedem moveend. Siehe map-features-ecosystem-visibility.js.
	// 💣 Map, KEIN Array (V3.0): der Loader laeuft bei jedem Schwenk erneut und liefert dieselben
	// Flaechen wieder mit. Ohne Schluesselung nach public_id laege nach dem dritten Schwenk jede
	// Flaeche dreimal drin -- der Ruckler, den bei 5 Flaechen keiner sieht und bei 300 alle.
	ecosystemLayers = new Map(),
	// Aktive Ebene des Segmentschalters (V3.0) -- eine der drei `kind`. Die beiden ruhenden bleiben
	// sichtbar, nehmen aber keine Klicks. Startet LEER, nicht auf "vegetation": ein hier eingetragener
	// gueltiger Wert waere nie ungueltig, und getActiveEcosystemLayerKind() kaeme nie dazu, den
	// gemerkten Wert aus dem localStorage zu holen -- der Schalter haette das Gedaechtnis verloren,
	// das er laut Plan haben soll.
	activeEcosystemLayerKind = "",
	// Aktive Region JE `kind` (V3.0b): { derographisch: "<public_id>", vegetation: …, topographie: … }.
	// Der Segmentschalter wechselt damit auch die Region, in die eine neue Flaeche geht.
	activeEcosystemRegionId = {},
	// Die Wegpunkt-Marker der geplanten Route (inkl. ihrer Hover-Infobox an marker._routePopup).
	highlightedRouteNodes = [],
	isSearchPanelHidden = false,
	currentRouteLayer = null,
	currentRouteNodeLayer = null,
	currentRouteDirectionLayer = null,
	currentRouteSegmentLayers = [],
	currentRoutePlanEntries = [],
	// Die Segmente der gezeigten Route. Eine Etappe kennt nur ihre segmentIndexes; wer daraus
	// die Weg-public_ids braucht (V10 „Führt durch"), braucht die Liste dazu -- genau wie
	// currentRoutePlanEntries selbst existiert, weil der Popup-Bauer den Plan-Zustand braucht.
	currentRouteSegments = [],
	// Die Knotennamen derselben Route. Zusammen mit currentRouteSegments ist es genau das Paar, aus
	// dem showRoutePlan() den Plan baut -- gecacht, damit eine reine ANZEIGE-Aenderung (der
	// Reisebeginn) neu zeichnen kann, ohne den Router noch einmal laufen zu lassen.
	currentRouteNames = [],
	activeRoutePlanEntryIndex = null,
	graphData = null,
	locationConnectivityIndex = null,
	invalidLocationInputs = [],
	selectedLocations = [],
	waypointCounter = 0,
	sharePinMarker = null,
	reviewReportMarker = null,
	nearestLookupPinnedMarkerEntry = null,
	// Wer einen versteckten Ort ueber seinen Namen gefunden hat, sieht ihn -- fuer diesen Besuch
	// (Owner 15.08.2026). Laufzeit, nicht gespeichert: kein localStorage, kein URL-Parameter, kein
	// Serverzustand; ein Neuladen versteckt ihn wieder.
	// ⚠️ ADDITIV, nie geleert. Einen entfernten Wegpunkt wieder zu verstecken saehe wie ein Fehler
	// aus -- gefunden ist gefunden.
	avesmapsRevealedHiddenLocationIds = new Set(),
	nearestLookupTempPopup = null,
	activeLocationPublicId = "",
	reviewReports = [],
	reviewRatings = [],
	wikiSyncCases = [],
	wikiSyncSummary = null,
	wikiSyncTerritorySummary = null,
	activeWikiSyncRunId = null,
	activeWikiSyncRunStatus = "",
	activeWikiSyncCase = null,
	activeWikiSyncSelectedMap = null,
	activeWikiSyncSelectedWiki = null,
	activeWikiSyncPreset = null,
	wikiSyncPreviewMarker = null,
	wikiSyncCoordinateDriftLayers = null,
	pendingWikiSyncLocationPickCase = null,
	wikiSyncFilterQuery = "",
	wikiSyncFilterCollapseRequested = false,
	wikiSyncTerritoryFilterQuery = "",
	wikiSyncTerritoryMapStatus = "all",
	wikiSyncTerritoryExpandedKeys = new Set(),
	activeWikiSyncPanelTab = "locations",
	isWikiSyncAccordionRestoring = false,
	isWikiSyncLocationsRunning = false,
	isWikiSyncTerritoriesRunning = false,
	isWikiSyncResolveSubmissionPending = false,
	changeLogEntries = [],
	changeLogFocusMarker = null,
	changeLogFocusMarkerTimeout = null,
	isChangeUndoPending = false,
	activeEditorPanelTab = "review",
	activeReviewReportId = null,
	activeReviewReportSource = null,
	activeReviewReportSourceSuggestions = [],
	isReviewPanelHidden = false,
	sharePinCoordinates = null,
	pendingContextMenuLatLng = null,
	contextMenuAnchorMarker = null,
	feedbackToastTimeoutId = null,
	distanceMeasurementStartHandle = null,
	distanceMeasurementEndHandle = null,
	distanceMeasurementLine = null,
	distanceMeasurementLabel = null,
	distanceMeasurementStartLatLng = null,
	distanceMeasurementEndLatLng = null,
	isAwaitingDistanceMeasurementEnd = false,
	locationReportLatLng = null,
	isLocationReportSubmissionPending = false,
	locationEditLatLng = null,
	locationEditMarkerEntry = null,
	// Sources named while CREATING a place, before it has a public_id to hang them on (bug #41).
	// Held by the "Ort bearbeiten" dialog and replayed right after create_point succeeds.
	locationEditPendingSourceStore = null,
	// detach() des Ortsnamen-Typeaheads im Anlegen-Dialog; beim erneuten Öffnen zuerst abräumen,
	// sonst stapeln sich Listener und verwaiste Dropdown-Knoten im body.
	locationEditNameAutocompleteDetach = null,
	// dito für den Ortsart-Typeahead („Art"). Eigener Griff, weil er an einem anderen Feld hängt
	// und -- anders als der Ortsname -- auch beim BEARBEITEN montiert wird.
	locationEditPlaceKindAutocompleteDetach = null,
	// Beim ANLEGEN gewählte Wiki-Siedlung ({title,name,wiki_url}), solange es noch keine public_id
	// gibt, an die man sie schreiben könnte. Verbunden wird sie nach create_point vom vorhandenen
	// Auto-Connect; Träger dafür ist das versteckte wiki_url-Feld, das dies hier nur begleitet.
	locationEditPendingWikiSettlement = null,
	isLocationEditSubmissionPending = false,
	pendingCrossingConversionPublicId = null,
	pendingCrossingConversionName = "",
	pendingCrossingConversionIsNodix = false,
	lastPathEditSettings = null,
	activeLocationEdit = null,
	pendingPathCreationStart = null,
	pendingPowerlineCreationStart = null,
	pendingPathCreationPreview = null,
	pendingPathCreationLine = null,
	pendingPathCreationPoints = [],
	pathEditFeature = null,
	powerlineEditFeature = null,
	labelEditEntry = null,
	labelEditLatLng = null,
	pendingLabelMoveAfterEditEntry = null,
	regionEditEntry = null,
	regionEditTabs = [],
	activeRegionEditTabKey = "",
	regionParentSelectedTreeId = "",
	activeRegionGeometryEdit = null,
	activeRegionContextEntry = null,
	activeRegionContextLayer = null,
	activeRegionContextPolygonIndex = null,
	activeRegionInfoTooltip = null,
	activeRegionInfoTooltipEntry = null,
	activeRegionPlaceSpotlightMarker = null,
	pendingRegionOperation = null,
	pendingRegionSplitPreviewLayer = null,
	pendingRegionMoveState = null,
	pendingRegionTargetHighlightLayers = [],
	regionParentCollapsedKeys = new Set(),
	regionParentFilterQuery = "",
	politicalTimelineYear = 1049,
	isPoliticalTerritoryLayerLoading = false,
	politicalTerritoryLayerReloadTimerId = null,
	politicalTerritoryApiUnavailable = false,
	isPathEditSubmissionPending = false,
	activePathGeometryEdit = null,
	pendingPathSplit = null,
	mapDataSourceStatus = null,
	baseTileLayer = null,
	activeMapStyle = "stylized",
	activeFeatureLocks = new Map(),
	liveMapUpdateTimerId = null,
	isLiveMapUpdatePending = false,
	editorPresenceTimerId = null,
	reviewReportsPollTimerId = null,
	editorPresenceUsers = [],
	editorActivityArea = null,
	editorActivityLabel = null,
	editorActivitySchema = "ok",
	editorCanForceClaim = false,
	editorTerritoryClaim = null,
	// Which holder the banner/save-button state was last SUCCESSFULLY written for -- not merely the
	// last one received. The editor markup loads late; see avesmapsApplyTerritoryClaim.
	editorTerritoryClaimAppliedFor = undefined,
	labelCollisionFrameId = null,
	powerlineAnimationFrameId = null,
	powerlineAnimationLastFrameMs = 0,
	powerlineAnimationTimeSeconds = 0,
	isPowerlineEditSubmissionPending = false;

// Heuristik: laeuft Avesmaps auf einem Smartphone? Touch-Geraet mit kleiner Bildschirm-Kurzseite
// -> erkennt Phones in Hoch- UND Querformat, schliesst Tablets/Desktop (auch mit Touch) aus.
function avesmapsIsPhoneViewport() {
	try {
		const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
		const shortestSide = Math.min(window.innerWidth || 9999, window.innerHeight || 9999);
		return coarsePointer && shortestSide <= 600;
	} catch (error) {
		return false;
	}
}

// Die EINE Definition von "Telefon" fuer CSS. `avesmapsIsPhoneViewport()` oben ist die Wahrheit;
// diese Klasse traegt sie ins Stylesheet, damit dort nicht eine zweite Fassung als Media-Query
// entsteht ("(pointer: coarse) and (max-width: 600px)" waere schon nicht dasselbe -- die Heuristik
// misst die KURZSEITE, also auch die Hoehe, und traefe ein quer gehaltenes Telefon nicht).
// ⚠️ Wird bei Groessenaenderung und Drehung nachgezogen: ein gedrehtes Telefon bleibt ein Telefon,
// ein auf Telefonbreite gezogenes Desktopfenster wird keins (der Zeiger bleibt fein).
// 🔴 DIE EINE REGEL, WIE SCHARF EINE CANVAS ZEICHNET. Owner 24.08.2026, nach einem Blick aufs
// Telefon: „sicher dass alle gleich scharf sind?“ -- sie waren es nicht. Wege- und Flussnamen sowie
// die Ortsmarkierungen zeichneten in voller Geraetaufloesung (3x), Siedlungs-, Landschafts- und
// Grenznamen bei 2x. Auf demselben Bild.
//
// 💣 DESHALB STEHT DIE REGEL HIER UND NICHT VIERMAL VERTEILT. Fuenf Zeichenflaechen lesen sie:
// boundary-canvas-overlay, path-label-canvas-overlay, location-canvas-layer, labels (Bild-Cache)
// und ueber sie die Grenzbeschriftung. Vier eigene Fassungen liefen beim ersten Nachjustieren
// auseinander -- genau das war der Befund.
// ⚠️ Alle fuenf Wirte UND diese Datei werden ausschliesslich von index.html geladen (geprueft
// 24.08.2026). Ein Editorfenster, das eine der Dateien ohne runtime-state.js einbindet, saehe hier
// ein undefined -- wer eine hinzufuegt, prueft das.
//
// 🔴 AM TELEFON GILT EIN DECKEL VON 2 (Owner-Entscheid 24.08.2026, Variante 2 von zweien). Die
// verworfene Variante 1 -- volle Geraetaufloesung ueberall -- BLEIBT als Option erhalten: der Owner
// will sie in die kommenden globalen Einstellungen aufnehmen. Dafuer genuegt es, dieser Variablen
// `Infinity` zuzuweisen; kein Aufrufer muss angefasst werden.
// ⚠️ Der Grund fuer den Deckel war NICHT die Schaerfe, sondern der Speicher: die Siedlungs- und
// Landschaftsnamen werden als Bilder gerendert und zwischengespeichert, und bei 3x ist jedes Bild
// 2,25-mal so gross. Wer die Option auf `Infinity` stellt, sollte den Bild-Cache mitmessen.
const AVESMAPS_PHONE_CANVAS_MAX_DPR_VORGABE = 2;
let avesmapsPhoneCanvasMaxDpr = (() => {
	try {
		const roh = new URLSearchParams(window.location.search).get("phonedpr");
		if (roh === "voll") { return Infinity; }   // die aufbewahrte Variante 1, zum Probieren
		const wert = Number(roh);
		if (roh !== null && Number.isFinite(wert) && wert > 0) { return wert; }
	} catch (error) { /* ohne Adresszeile die Vorgabe */ }
	return AVESMAPS_PHONE_CANVAS_MAX_DPR_VORGABE;
})();

/**
 * Wie viele Canvas-Pixel je CSS-Pixel diese Flaeche zeichnen darf.
 * @param {number} [deckelZeiger] Eigener Deckel fuer Zeigergeraete. Jede Flaeche entscheidet den
 *   selbst -- die Grenzen stehen auf 1 (weicher Ton, Owner-Entscheid), die uebrigen auf Infinity.
 *   Geteilt ist NUR die Telefon-Regel.
 * ⚠️ Bei JEDEM Zeichnen aufrufen, nie einmal beim Laden merken: ein Telefon wird gedreht, und ein
 *   Desktopfenster laesst sich auf Telefonbreite ziehen (bleibt aber Zeigergeraet).
 * ⭐ ?canvasdpr=<zahl> schlaegt alles -- die Probe gewinnt vor jeder Vorgabe.
 */
function avesmapsCanvasDpr(deckelZeiger) {
	const dpr = window.devicePixelRatio || 1;
	try {
		const roh = new URLSearchParams(window.location.search).get("canvasdpr");
		const wert = Number(roh);
		if (roh !== null && Number.isFinite(wert) && wert > 0) { return Math.min(dpr, wert); }
	} catch (error) { /* ohne Adresszeile weiter unten */ }
	const deckel = avesmapsIsPhoneViewport()
		? avesmapsPhoneCanvasMaxDpr
		: (typeof deckelZeiger === "number" && deckelZeiger > 0 ? deckelZeiger : Infinity);
	return Math.min(dpr, deckel);
}

function avesmapsSyncPhoneViewportClass() {
	try {
		document.documentElement.classList.toggle("avesmaps-phone", avesmapsIsPhoneViewport());
	} catch (error) {
		/* noop -- die Klasse ist eine Zutat, kein Fundament */
	}
}
avesmapsSyncPhoneViewportClass();
window.addEventListener("resize", avesmapsSyncPhoneViewportClass);
window.addEventListener("orientationchange", avesmapsSyncPhoneViewportClass);

// Der EINZIGE Schreiber der Aufdeckungsmenge oben. Zwei Aufrufer, beide TRICHTER statt einzelner
// Stellen: openLocationPopupForMarkerEntry (dort muenden beide Popup-Oeffner und der
// Spotlight-Treffer) und collectAndValidateSelectedLocations (dort muenden Vorschlagsliste,
// getippter Name und geteilter Link). So kann kein kuenftiger Weg vergessen werden.
function avesmapsRevealHiddenLocation(publicId) {
	const id = String(publicId || "");
	if (!id || avesmapsRevealedHiddenLocationIds.has(id)) {
		return;
	}
	avesmapsRevealedHiddenLocationIds.add(id);
	// Nur bei einer echten Neuaufnahme neu zeichnen -- der Trichter laeuft bei JEDEM Oeffnen einer
	// Infobox durch, und ein Sync je Klick waere eine Rechnung fuer nichts.
	if (typeof syncLocationMarkerVisibility === "function") {
		syncLocationMarkerVisibility();
	}
}

// Der Wegpunkt kennt nur einen NAMEN -- er wird auch von Hand getippt und aus geteilten Links
// gelesen --, die Aufdeckungsmenge kennt nur publicIds. Diese Funktion ist die Bruecke.
function avesmapsRevealHiddenLocationByName(name) {
	if (typeof findLocationMarkerByName !== "function") {
		return;
	}
	const entry = findLocationMarkerByName(String(name || "").trim());
	if (entry && entry.publicId) {
		avesmapsRevealHiddenLocation(entry.publicId);
	}
}
