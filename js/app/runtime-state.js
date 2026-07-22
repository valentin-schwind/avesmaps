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
	// Die Wegpunkt-Marker der geplanten Route (inkl. ihrer Hover-Infobox an marker._routePopup).
	highlightedRouteNodes = [],
	isSearchPanelHidden = false,
	currentRouteLayer = null,
	currentRouteNodeLayer = null,
	currentRouteDirectionLayer = null,
	currentRouteSegmentLayers = [],
	currentRoutePlanEntries = [],
	activeRoutePlanEntryIndex = null,
	graphData = null,
	locationConnectivityIndex = null,
	invalidLocationInputs = [],
	selectedLocations = [],
	waypointCounter = 0,
	sharePinMarker = null,
	reviewReportMarker = null,
	nearestLookupPinnedMarkerEntry = null,
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
	wikiSyncCreateLocationContextLatLng = null,
	wikiSyncCreateLocationCaseId = null,
	wikiSyncFilterQuery = "",
	wikiSyncFilterCollapseRequested = false,
	wikiSyncTerritoryFilterQuery = "",
	wikiSyncTerritoryMapStatus = "all",
	wikiSyncTerritoryExpandedKeys = new Set(),
	activeWikiSyncPanelTab = "locations",
	isWikiSyncCreateLocationSelectionActive = false,
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
