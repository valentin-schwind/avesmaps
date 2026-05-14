// Konstanten
const THRESHOLD = 0.5;
const TILE_SIZE = 256;
const IMG_WIDTH = 1024;
const IMG_HEIGHT = 1024;
const DISTANCE_SCALING_FACTOR = 3;
const TIME_SCALE_FACTOR = 1.19;
const KM_TO_MILES = 1;
const MAP_BOUNDS = [
	[0, 0],
	[IMG_WIDTH, IMG_HEIGHT],
];
const MAP_DECORATION_CONFIG = {
	compass: {
		src: "img/compass_2.png",
		coordinates: [1006, 1006],
		size: [96, 94],
		anchor: [96, 94],
		alt: "Kompassrose",
	},
	logo: {
		src: "img/dsa-fanprojekt-logo.png",
		coordinates: [18, 18],
		size: [144, 40],
		anchor: [0, 0],
		alt: "DSA-Fanprojekt",
	},
};
const MAP_SCALE_BAND_MILES_BY_ZOOM = [100, 100, 100, 100, 10, 10, 10];

const ROUTE_STYLE = { pane: "routePane", color: "#1452F7", weight: 10, opacity: 1, interactive: true, lineCap: "round", lineJoin: "round" };
const ROUTE_SELECTED_STYLE = { color: "#ffd54a", weight: ROUTE_STYLE.weight, opacity: 1 };
const SYNTHETIC_ROUTE_STYLE = { ...ROUTE_STYLE, dashArray: "14 10", opacity: 0.7 };
const MEASUREMENT_LINE_STYLE = { pane: "measurementPane", color: "#FFFFFF", weight: 4, opacity: 0.95, interactive: false, dashArray: "10 8", lineCap: "round", lineJoin: "round" };
const ROUTE_NODE_STYLE = { pane: "locationsPane", fillColor: "white", color: "#000", radius: 8, weight: 2, fillOpacity: 1 };
const LOCATION_MARKER_STYLE = { pane: "locationsPane", fillColor: "#F52B25", color: "#7A1411", weight: 1.25, opacity: 1, fillOpacity: 0.95 };
const MAP_MARKER_STYLE = { pane: "locationsPane", radius: 4, fillColor: "#F52B25", color: "#000", weight: 2, opacity: 1, fillOpacity: 1 };
const SYNTHETIC_ROUTE_TYPE = "Querfeldein";
const SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR = 1.2;
const CROSSING_LOCATION_TYPE = "crossing";
const PATH_SUBTYPE_KEYS = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];
const PATH_ENDPOINT_SNAP_DISTANCE_PX = 18;

const SPEED_TABLE = {
	groupFoot: { Reichsstrasse: 4.5, Strasse: 4.0, Weg: 3.5, Pfad: 3.0, Gebirgspass: 1.5, Wuestenpfad: 2.5, Querfeldein: 1.25 },
	lightWalker: { Reichsstrasse: 5.5, Strasse: 5.0, Weg: 4.5, Pfad: 4.0, Gebirgspass: 2.0, Wuestenpfad: 3.5, Querfeldein: 1.7 },
	groupHorse: { Reichsstrasse: 7.0, Strasse: 6.5, Weg: 5.5, Pfad: 4.5, Gebirgspass: 2.5, Wuestenpfad: 3.0, Querfeldein: 2.1 },
	lightRider: { Reichsstrasse: 8.5, Strasse: 8.0, Weg: 7.0, Pfad: 6.0, Gebirgspass: 3.0, Wuestenpfad: 4.0, Querfeldein: 2.5 },
	caravan: { Reichsstrasse: 4.0, Strasse: 3.5, Weg: 3.0, Pfad: 2.5, Gebirgspass: 1.5, Wuestenpfad: 2.0, Querfeldein: 1.25 },
	riverSailer: { Flussweg: 7.5 },
	riverBarge: { Flussweg: 5.0 },
	cargoShip: { Seeweg: 10.0 },
	fastShip: { Seeweg: 12.0 },
	galley: { Seeweg: 9.0 },
	horseCarriage: { Reichsstrasse: 6.0, Strasse: 5.5, Weg: 4.5, Pfad: 3.0, Gebirgspass: 2.0, Wuestenpfad: 3.0, Querfeldein: 1.7 },
};

const ROUTE_ICON_PATHS = {
	Reichsstrasse: "icons/small_webp/Reichsstrasse.webp",
	Strasse: "icons/small_webp/Strasse.webp",
	Gebirgspfad: "icons/small_webp/Gebirgspfad.webp",
	Pfad: "icons/small_webp/Pfad.webp",
	Wuestenpfad: "icons/small_webp/Pfad.webp",
	Flussweg: "icons/small_webp/Flusswege.webp",
	Seeweg: "icons/small_webp/Meerwege.webp",
	Querfeldein: "icons/small_webp/Pfad.webp",
	Weg: "icons/small_webp/landweg.webp",
};

ROUTE_ICON_PATHS.Gebirgspass = ROUTE_ICON_PATHS.Gebirgspfad;

const DEFAULT_OVERVIEW_TEXT = "Wegpunkte und Dauer der Reise werden hier angezeigt.";
const DEFAULT_ROUTE_QUERY_PARAM = "route";
const ROUTE_QUERY_PARAM_ALIASES = ["route", "routes", "router"];
const SHARE_PIN_QUERY_PARAM = "pin";
const MAP_CONTEXT_MENU_VIEWPORT_PADDING = 8;
const MAP_CONTEXT_MENU_OFFSET_X = 18;
const MAP_CONTEXT_MENU_OFFSET_Y = 14;
const STRATO_MAP_HOST = "54143555.swh.strato-hosting.eu";
const PUBLIC_API_HOST = "avesmaps.de";
const SQL_MAP_HOSTS = new Set([STRATO_MAP_HOST, "avesmaps.de", "www.avesmaps.de"]);

function getDefaultLocationReportEndpointUrl() {
	if (SQL_MAP_HOSTS.has(window.location.hostname)) {
		return "api/report-location.php";
	}

	if (window.location.protocol === "https:") {
		return `https://${PUBLIC_API_HOST}/api/report-location.php`;
	}

	if (window.location.protocol === "http:") {
		return `http://${STRATO_MAP_HOST}/avesmaps/api/report-location.php`;
	}

	return `https://${PUBLIC_API_HOST}/api/report-location.php`;
}

const DEFAULT_LOCATION_REPORT_ENDPOINT_URL = getDefaultLocationReportEndpointUrl();
const LOCATION_REPORT_FORM_ENDPOINT_URL = window.AVESMAPS_LOCATION_REPORT_ENDPOINT || DEFAULT_LOCATION_REPORT_ENDPOINT_URL;
const MAP_FEATURES_FILE_URL = "map/Aventurien_routes.geojson";
const MAP_FEATURES_API_URL = window.AVESMAPS_MAP_FEATURES_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/map-features.php" : "");
const MAP_SEARCH_API_URL = window.AVESMAPS_MAP_SEARCH_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/map-search.php" : "");
const INITIAL_SEARCH_PARAMS = new URLSearchParams(window.location.search);
const IS_EDIT_MODE = INITIAL_SEARCH_PARAMS.get("edit") === "1";
const MAP_TILE_STYLES = {
	old: { label: "Old", url: "./tiles/old/{z}/map_{x}_{y}.jpg" },
	stylized: { label: "Stylized", url: "./tiles/stylized/{z}/map_{x}_{y}.webp" },
};
const MAP_FEATURE_UPDATE_API_URL = window.AVESMAPS_MAP_FEATURE_UPDATE_ENDPOINT || "api/map-feature-update.php";
const LOCATION_REPORT_REVIEW_API_URL = window.AVESMAPS_LOCATION_REPORT_REVIEW_ENDPOINT || "api/location-report-review.php";
const MAP_AUDIT_LOG_API_URL = window.AVESMAPS_MAP_AUDIT_LOG_ENDPOINT || "api/map-audit-log.php";
const WIKI_SYNC_API_URL = window.AVESMAPS_WIKI_SYNC_ENDPOINT || "api/wiki-sync.php";
const EDITOR_PRESENCE_API_URL = window.AVESMAPS_EDITOR_PRESENCE_ENDPOINT || "api/editor-presence.php";
const EDIT_MODE_PLANNER_STATE_STORAGE_KEY = "avesmaps.edit.plannerState";
const EDIT_MODE_REVIEW_PANEL_STORAGE_KEY = "avesmaps.edit.reviewPanelHidden";
const EDIT_MODE_MAP_STYLE_STORAGE_KEY = "avesmaps.edit.mapStyle";
const LOCATION_REPORT_REQUEST_TIMEOUT_MS = 7000;
const MAX_SHARED_WAYPOINTS = 25;
const DEFAULT_SHARE_PIN_ZOOM = 4;
const VISUAL_LINE_SMOOTHING_CONFIG = {
	enabled: INITIAL_SEARCH_PARAMS.get("smoothRoute") !== "0" && INITIAL_SEARCH_PARAMS.get("smoothLines") !== "0",
	factor: 0.58,
	maxDistance: 54,
	samples: 16,
	maxFactor: 0.5,
	maxSamples: 12,
	maxSegmentCutShare: 0.48,
};
const VISUAL_LINE_SMOOTHING_CONFIG_HIGH_ZOOM = {
	enabled: INITIAL_SEARCH_PARAMS.get("smoothRoute") !== "0" && INITIAL_SEARCH_PARAMS.get("smoothLines") !== "0",
	factor: 0.82,
	maxDistance: 110,
	samples: 64,
	maxFactor: 0.9,
	maxSamples: 64,
	maxSegmentCutShare: 0.49,
	passes: 2,
};
const VISUAL_LINE_SMOOTHING_CONFIG_MAX_ZOOM = {
	enabled: INITIAL_SEARCH_PARAMS.get("smoothRoute") !== "0" && INITIAL_SEARCH_PARAMS.get("smoothLines") !== "0",
	factor: 0.86,
	maxDistance: 120,
	samples: 128,
	maxFactor: 0.92,
	maxSamples: 128,
	maxSegmentCutShare: 0.49,
	passes: 2,
};
const VISUAL_LINE_CATMULL_ROM_CONFIG = {
	enabled: INITIAL_SEARCH_PARAMS.get("smoothRoute") !== "0" && INITIAL_SEARCH_PARAMS.get("smoothLines") !== "0",
	method: "catmullRom",
	samples: 8,
	tension: 0.5,
};
const PATH_RENDER_CONFIG = {
	simplifiedMaxZoom: 2,
	simplifiedSmoothingFactor: 0.2,
	simplifiedMaxDistance: 18,
	simplifiedSamples: 4,
	simplifiedOutlineOpacity: 0,
	simplifiedOutlineWeight: 0,
	simplifiedCenterWeightScale: 0.85,
};
const LOCATION_TYPE_CONFIG = {
	metropole: { label: "Metropolen", singularLabel: "Metropole", icon: "🏛️", queryParam: "toggleMetropolen", radius: 10, shape: "circle", borderWidth: 3 },
	grossstadt: { label: "Großstädte", singularLabel: "Großstadt", icon: "🏰", queryParam: "toggleGrossstaedte", radius: 7.5, shape: "square", borderWidth: 3 },
	stadt: { label: "Städte", singularLabel: "Stadt", icon: "⛪", queryParam: "toggleStaedte", radius: 6, shape: "square", borderWidth: 2 },
	kleinstadt: { label: "Kleinstädte", singularLabel: "Kleinstadt", icon: "🏘️", queryParam: "toggleKleinstaedte", radius: 4, shape: "square", borderWidth: 2 },
	dorf: { label: "Dörfer", singularLabel: "Dorf", icon: "🏡", queryParam: "toggleDoerfer", radius: 3.5, shape: "circle", borderWidth: 2 },
	gebaeude: { label: "Besondere Bauwerke/Stätten", singularLabel: "Besondere Bauwerke/Stätten", icon: "🏛️", queryParam: "toggleGebaeude", radius: 3.5, shape: "circle", borderWidth: 2 },
};
const LOCATION_ICON_PATHS = {
	metropole: "icons/small_webp/metropole.webp",
	grossstadt: "icons/small_webp/grossstadt.webp",
	stadt: "icons/small_webp/stadt.webp",
	kleinstadt: "icons/small_webp/kleinstadt.webp",
	dorf: "icons/small_webp/dorf.webp",
	gebaeude: "icons/small_webp/bauwerk.webp",
};
const LOCATION_TYPE_KEYS = Object.keys(LOCATION_TYPE_CONFIG);
const LOCATION_TYPE_VISIBILITY_ORDER = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const LOCATION_NAME_LABEL_CONFIG = {
	metropole: { size: 20, minZoom: 0 },
	grossstadt: { size: 18, minZoom: 0 },
	stadt: { size: 16, minZoom: 2 },
	kleinstadt: { size: 14, minZoom: 3 },
	dorf: { size: 12, minZoom: 4 },
	gebaeude: { size: 10, minZoom: 4 },
};
const POWERLINE_RENDER_CONFIG = {
	animationEnabled: false,
	strandCount: 3,
	segmentCount: 8,
	normalScales: [0.125, 0.125, 0.125, 0.125],
	waveOffsets: [-2, 2, 2, 2],
	phaseStep: 1.73,
	tremorNormalAmplitude: 2.1,
	tremorTangentAmplitude: 0.3,
	tremorNormalSpeed: 0.55,
	tremorTangentSpeed: 0.42,
	tremorNormalFrequency: 0.38,
	tremorTangentFrequency: 0.29,
	tremorPhaseMultiplier: 2.4,
	frameIntervalMs: 25,
};

document.body.classList.toggle("edit-mode", IS_EDIT_MODE);

const DEFAULT_PLANNER_STATE = {
	toggleMetropolen: false,
	toggleGrossstaedte: false,
	toggleStaedte: false,
	toggleKleinstaedte: false,
	toggleDoerfer: false,
	toggleGebaeude: false,
	togglePaths: false,
	mapLayerMode: "deregraphic",
	toggleCrossings: false,
	toggleNodix: false,
	pathType: "fastest",
	minimizeTransfers: false,
	includeRests: true,
	restHours: 12,
	allowLand: true,
	landTransport: "groupFoot",
	allowRiver: true,
	riverTransport: "riverSailer",
	allowSea: true,
	seaTransport: "cargoShip",
};
const VALID_TRANSPORT_OPTIONS = {
	land: new Set(["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"]),
	river: new Set(["riverSailer", "riverBarge"]),
	sea: new Set(["cargoShip", "fastShip", "galley"]),
};
const TRANSPORT_DOMAIN_OPTIONS = {
	land: ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"],
	river: ["riverSailer", "riverBarge"],
	sea: ["cargoShip", "fastShip", "galley"],
	none: [],
};
const TRANSPORT_ICON_PATHS = {
	mapLayerModeSelect: {
		none: "icons/small_webp/NurKarte.webp",
		political: "icons/small_webp/PolitischeKarte.webp",
		deregraphic: "icons/small_webp/RegionenKarte.webp",
		powerlines: "icons/small_webp/kraftlinien.webp",
	},
	landTransport: {
		caravan: "icons/small_webp/karavane.webp",
		groupFoot: "icons/small_webp/Reisegruppe.webp",
		lightWalker: "icons/small_webp/ZuFuss.webp",
		horseCarriage: "icons/small_webp/Kutsche.webp",
		groupHorse: "icons/small_webp/BeritteneReisegruppe.webp",
		lightRider: "icons/small_webp/EinzelnerReiter.webp",
	},
	riverTransport: {
		riverSailer: "icons/small_webp/Flusssegler.webp",
		riverBarge: "icons/small_webp/Flusskahn.webp",
	},
	seaTransport: {
		cargoShip: "icons/small_webp/Lastensegler.webp",
		fastShip: "icons/small_webp/Schnellsegler.webp",
		galley: "icons/small_webp/Galeere.webp",
	},
};
const ICON_TRANSPORT_SELECT_IDS = Object.keys(TRANSPORT_ICON_PATHS);
