// Konstanten
const THRESHOLD = 0.5;
// Maximaler Abstand (Karten-Einheiten), ab dem ein Routen-Endpunkt noch als "Stadt sitzt am Knoten"
// gilt. 0.15 Einheiten = 0.45 Meilen (1 Einheit = DISTANCE_SCALING_FACTOR Meilen). Liegt die naechste
// Stadt weiter weg, ist der Knoten in Wahrheit eine Kreuzung mit nur zufaellig benachbarter Stadt und
// wird als Kreuzung behandelt (vom Grenz-Lauf absorbiert) -> Etappenname bleibt deckungsgleich mit der Linie.
const ROUTE_CITY_NODE_THRESHOLD = 0.15;
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
const COMPASS_DECORATION_SOURCES = [
	"img/compass1.png",
	"img/compass2.png",
	"img/compass3.png",
	"img/compass4.png",
];

function getRandomCompassDecorationSource() {
	return COMPASS_DECORATION_SOURCES[Math.floor(Math.random() * COMPASS_DECORATION_SOURCES.length)];
}

const MAP_DECORATION_CONFIG = {
	compass: {
		src: getRandomCompassDecorationSource(),
		coordinates: [18, 1006],
		size: [96, 94],
		anchor: [96, 94],
		alt: "Kompassrose",
	},
	logo: {
		src: "img/dsa-fanprojekt-logo.png",
		coordinates: [1006, 18],
		size: [144, 40],
		anchor: [0, 0],
		alt: "DSA-Fanprojekt",
	},
};
const MAP_SCALE_BAND_MILES_BY_ZOOM = [100, 100, 100, 100, 10, 10, 10];

const ROUTE_STYLE = { pane: "routePane", color: "#1452F7", weight: 8, opacity: 1, interactive: true, lineCap: "round", lineJoin: "round" };
const ROUTE_SELECTED_STYLE = { color: "#ffd54a", weight: ROUTE_STYLE.weight, opacity: 1 };
const SYNTHETIC_ROUTE_STYLE = { ...ROUTE_STYLE, dashArray: "14 10", opacity: 0.7 };
const MEASUREMENT_LINE_STYLE = { pane: "measurementPane", color: "#FFFFFF", weight: 4, opacity: 0.95, interactive: false, dashArray: "10 8", lineCap: "round", lineJoin: "round" };
const ROUTE_NODE_STYLE = { pane: "locationsPane", fillColor: "white", color: "#000", radius: 6, weight: 2, fillOpacity: 1 };
const LOCATION_MARKER_STYLE = { pane: "locationsPane", fillColor: "#F52B25", color: "#7A1411", weight: 1.25, opacity: 1, fillOpacity: 0.95 };
const MAP_MARKER_STYLE = { pane: "locationsPane", radius: 4, fillColor: "#F52B25", color: "#000", weight: 2, opacity: 1, fillOpacity: 1 };
const SYNTHETIC_ROUTE_TYPE = "Querfeldein";
const SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR = 25.0;
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
	Reichsstrasse: "icons/Reichsstrasse.webp",
	Strasse: "icons/Strasse.webp",
	Gebirgspfad: "icons/Gebirgspfad.webp",
	Pfad: "icons/Pfad.webp",
	Wuestenpfad: "icons/Pfad.webp",
	Flussweg: "icons/Flusswege.webp",
	Seeweg: "icons/Meerwege.webp",
	Querfeldein: "icons/Pfad.webp",
	Weg: "icons/landweg.webp",
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

function getDefaultContactEndpointUrl() {
	if (SQL_MAP_HOSTS.has(window.location.hostname)) {
		return "api/app/contact.php";
	}

	if (window.location.protocol === "https:") {
		return `https://${PUBLIC_API_HOST}/api/app/contact.php`;
	}

	if (window.location.protocol === "http:") {
		return `http://${STRATO_MAP_HOST}/avesmaps/api/app/contact.php`;
	}

	return `https://${PUBLIC_API_HOST}/api/app/contact.php`;
}

function getDefaultLocationReportEndpointUrl() {
	if (SQL_MAP_HOSTS.has(window.location.hostname)) {
		return "api/app/report-location.php";
	}

	if (window.location.protocol === "https:") {
		return `https://${PUBLIC_API_HOST}/api/app/report-location.php`;
	}

	if (window.location.protocol === "http:") {
		return `http://${STRATO_MAP_HOST}/avesmaps/api/app/report-location.php`;
	}

	return `https://${PUBLIC_API_HOST}/api/app/report-location.php`;
}

const DEFAULT_LOCATION_REPORT_ENDPOINT_URL = getDefaultLocationReportEndpointUrl();
const LOCATION_REPORT_FORM_ENDPOINT_URL = window.AVESMAPS_LOCATION_REPORT_ENDPOINT || DEFAULT_LOCATION_REPORT_ENDPOINT_URL;
const MAP_FEATURES_API_URL = window.AVESMAPS_MAP_FEATURES_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/map-features.php" : "");
const VISITOR_TRACK_API_URL = window.AVESMAPS_VISITOR_TRACK_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/track.php" : "");
const VISITOR_METRICS_API_URL = window.AVESMAPS_VISITOR_METRICS_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/visitor-metrics.php" : "");
const POLITICAL_TERRITORIES_API_URL = window.AVESMAPS_POLITICAL_TERRITORIES_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/political-territories.php" : "");
// Politische Zeitleiste im FRONTEND vorerst deaktiviert (zu wenig Zeitdaten für eine gute
// Darstellung). Im Editor bleibt sie immer aktiv. Auf true setzen, um sie später im Frontend
// wieder freizuschalten (Jahr bleibt sonst auf dem Standard 1049).
const POLITICAL_TIMELINE_FRONTEND_ENABLED = window.AVESMAPS_POLITICAL_TIMELINE_FRONTEND_ENABLED === true;
// Einheitliche Fuell-Deckkraft für politische Flaechen im FRONTEND (Nutzer-Wunsch: überall 70%,
// statt der unterschiedlichen per-Territorium-Deckkraft aus der DB). Im Editor gilt weiter die
// jeweilige Territoriums-Deckkraft. Auf null setzen, um im Frontend wieder die per-Territorium-
// Deckkraft zu verwenden.
const POLITICAL_FRONTEND_FILL_OPACITY = (() => {
	// Live justierbar via ?fillopacity=0.25 (0..1) zum Finden des Werts, bei dem das Terrain durchscheint
	// (Grün ueber flachem Tiefland wirkt bei 0.75 solide). Ohne Param: Default 0.70 (Nutzer-Wunsch 2026-06-24).
	const match = /[?&]fillopacity=([0-9.]+)/.exec(typeof location !== "undefined" ? location.search : "");
	if (match) {
		const value = parseFloat(match[1]);
		if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
	}
	return 0.7;
})();
// Ab dieser Zoomstufe fuellen uebergebende Gebiete (Huellen/Aggregate) im Frontend SOLIDE als Hintergrund,
// statt die Fuellung komplett an ihre Kinder abzugeben. Damit zeigt jede von den Kindern NICHT abgedeckte
// Flaeche immer die Gebietsfarbe -> keine Loecher mehr, egal wie die Zoom-Baender stehen (ungleiche
// Geschwister-Baender, eingefrorene Huellen). Default 4 = Baronie-Ebene; bei niedrigerem Zoom (Reich<->Provinz,
// stark verschiedene Farben) bleibt die Unterdrueckung, sonst wuerde es ueberdunkeln. Abschaltbar via
// ?leafbg=off, Schwelle justierbar via ?leafbg=5.
const POLITICAL_LEAF_BACKGROUND_MIN_ZOOM = (() => {
	const raw = /[?&]leafbg=([a-z0-9]+)/i.exec(typeof location !== "undefined" ? location.search : "");
	if (raw) {
		if (/^off$/i.test(raw[1])) return Infinity;
		const value = parseInt(raw[1], 10);
		if (Number.isFinite(value)) return value;
	}
	return 4;
})();
// Hover-Highlight im Frontend: die Region unter der Maus wird fast weiss eingefaerbt
// (Infobox-Hover). Auf null setzen, um das Highlight abzuschalten.
const POLITICAL_HOVER_FILL_COLOR = "#ffffff";
const POLITICAL_HOVER_FILL_OPACITY = 0.22;
const MAP_SEARCH_API_URL = window.AVESMAPS_MAP_SEARCH_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/map-search.php" : "");
const INITIAL_SEARCH_PARAMS = new URLSearchParams(window.location.search);
const IS_EDIT_MODE = INITIAL_SEARCH_PARAMS.get("edit") === "1";
const MAP_TILE_STYLES = {
	old: { label: "Old", url: "./tiles/old/{z}/map_{x}_{y}.jpg" },
	stylized: { label: "Stylized", url: "./tiles/stylized/{z}/map_{x}_{y}.webp" },
	politics: { label: "Politics", url: "./tiles/politics/{z}/map_{x}_{y}.webp", maxNativeZoom: 4 },
};
const MAP_FEATURE_UPDATE_API_URL = window.AVESMAPS_MAP_FEATURE_UPDATE_ENDPOINT || "api/edit/map/features.php";
const LOCATION_REPORT_REVIEW_API_URL = window.AVESMAPS_LOCATION_REPORT_REVIEW_ENDPOINT || "api/edit/reports/locations.php";
const MAP_AUDIT_LOG_API_URL = window.AVESMAPS_MAP_AUDIT_LOG_ENDPOINT || "api/edit/map/audit-log.php";
const WIKI_SYNC_LOCATIONS_API_URL = window.AVESMAPS_WIKI_SYNC_LOCATIONS_ENDPOINT || "api/edit/wiki/sync.php";
const WIKI_SYNC_TERRITORIES_API_URL = window.AVESMAPS_WIKI_SYNC_TERRITORIES_ENDPOINT || "api/edit/wiki/territories.php";
const WIKI_SYNC_DUMP_API_URL = window.AVESMAPS_WIKI_SYNC_DUMP_ENDPOINT || "api/edit/wiki/dump.php";
const EDITOR_PRESENCE_API_URL = window.AVESMAPS_EDITOR_PRESENCE_ENDPOINT || "api/edit/map/presence.php";
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

// Pro-Typ Linienstärken (ab Zoom > simplifiedMaxZoom). "outline" = Gesamt-Footprint (Kontur), "center" = Füllung.
const PATH_OUTLINE_WEIGHTS = { Reichsstrasse: 6.5, Strasse: 4, Weg: 4, Pfad: 3, Gebirgspass: 3, Wuestenpfad: 3, Flussweg: 5, Seeweg: 5 };
const PATH_CENTER_WEIGHTS = { Reichsstrasse: 4, Strasse: 2.5, Weg: 2.5, Pfad: 1.5, Gebirgspass: 1.5, Wuestenpfad: 1.5, Flussweg: 3, Seeweg: 3 };

// Optionale Override-Matrix [Subtyp][Zoom] -> Konturbreite (px). Leer = Default-Logik (unverändert). Wird vom
// ?pathwidthtune=1-Panel live befüllt. Ist für einen Subtyp+Zoom ein Override gesetzt, wird die Kontur dort
// zusätzlich sichtbar gemacht (auch in der simplified-Stufe Zoom<=2, wo sie sonst Deckkraft 0 hätte).
const PATH_OUTLINE_WIDTH_OVERRIDE = {};

function getDefaultPathOutlineWidth(subtype, zoom) {
	const z = Math.round(Number(zoom));
	const isReichsstrasse = subtype === "Reichsstrasse";
	if (z <= PATH_RENDER_CONFIG.simplifiedMaxZoom) {
		return PATH_RENDER_CONFIG.simplifiedOutlineWeight + (isReichsstrasse ? 0.5 : 0);
	}
	return PATH_OUTLINE_WEIGHTS[subtype] ?? PATH_OUTLINE_WEIGHTS.Weg;
}

function getPathOutlineWidthOverride(subtype, zoom) {
	const bySub = PATH_OUTLINE_WIDTH_OVERRIDE[subtype];
	const z = Math.round(Number(zoom));
	return bySub && typeof bySub[z] === "number" ? bySub[z] : null;
}

function getEffectivePathOutlineWidth(subtype, zoom) {
	const override = getPathOutlineWidthOverride(subtype, zoom);
	return override != null ? override : getDefaultPathOutlineWidth(subtype, zoom);
}

// Breiten-Faktor je Straßentyp UND Zoomstufe (Kontur + Füllung). Struktur: PATH_WIDTH_SCALE[subtyp][zoom] ->
// Faktor (1 = unverändert, 0 = unsichtbar, bis 5). Fehlt ein Eintrag -> Rückfall auf z5 bzw. 1. Live über das
// ?roadtune=1-Panel (Matrix Typ × Zoom 0..6). Werte aus dem Panel übernommen; z6 = z5 + 0.2. Flussweg/Seeweg
// bewusst NICHT überschrieben -> bleiben wie gehabt (Faktor 1).
const PATH_WIDTH_SCALE = {
	Reichsstrasse: { 0: 0, 1: 0, 2: 0.3, 3: 0.9, 4: 1.2, 5: 1.8, 6: 2 },
	Strasse: { 0: 0, 1: 0.2, 2: 0.3, 3: 0.6, 4: 0.6, 5: 1, 6: 1.2 },
	Weg: { 0: 0, 1: 0.1, 2: 0.2, 3: 0.6, 4: 0.6, 5: 1, 6: 1.2 },
	Pfad: { 0: 0, 1: 0, 2: 0.1, 3: 0.4, 4: 0.6, 5: 1, 6: 1.2 },
	Gebirgspass: { 0: 0, 1: 0, 2: 0.1, 3: 0.4, 4: 0.6, 5: 1, 6: 1.2 },
	Wuestenpfad: { 0: 0, 1: 0, 2: 0.1, 3: 0.4, 4: 0.6, 5: 1, 6: 1.2 },
};
function getPathWidthScale(subtype, zoom) {
	const bySubtype = PATH_WIDTH_SCALE[subtype];
	if (!bySubtype) {
		return 1;
	}
	const z = Math.max(0, Math.min(6, Math.round(Number(zoom)) || 0));
	const value = bySubtype[z];
	if (typeof value === "number" && value >= 0) {
		return value;
	}
	const fallback = bySubtype[5];
	return (typeof fallback === "number" && fallback >= 0) ? fallback : 1;
}
const LOCATION_TYPE_CONFIG = {
	metropole: { label: "Metropolen", singularLabel: "Metropole", icon: "🏛️", queryParam: "toggleMetropolen", radius: 10, shape: "circle", borderWidth: 3 },
	grossstadt: { label: "Großstädte", singularLabel: "Großstadt", icon: "🏰", queryParam: "toggleGrossstaedte", radius: 7.5, shape: "square", borderWidth: 3 },
	stadt: { label: "Städte", singularLabel: "Stadt", icon: "⛪", queryParam: "toggleStaedte", radius: 6, shape: "square", borderWidth: 2 },
	kleinstadt: { label: "Kleinstädte", singularLabel: "Kleinstadt", icon: "🏘️", queryParam: "toggleKleinstaedte", radius: 4, shape: "square", borderWidth: 2 },
	dorf: { label: "Dörfer", singularLabel: "Dorf", icon: "🏡", queryParam: "toggleDoerfer", radius: 3.5, shape: "circle", borderWidth: 2 },
	gebaeude: { label: "Besondere Bauwerke/Stätten", singularLabel: "Besondere Bauwerke/Stätten", icon: "🏛️", queryParam: "toggleGebaeude", radius: 3.5, shape: "circle", borderWidth: 2 },
};
const LOCATION_ICON_PATHS = {
	metropole: "icons/metropole.webp",
	grossstadt: "icons/grossstadt.webp",
	stadt: "icons/stadt.webp",
	kleinstadt: "icons/kleinstadt.webp",
	dorf: "icons/dorf.webp",
	gebaeude: "icons/bauwerk.webp",
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
	animationEnabled: true,
	strandCount: 3,
	segmentCount: 8,
	normalScales: [0.125, 0.125, 0.125, 0.125],
	waveOffsets: [-2, 2, 2, 2],
	phaseStep: 1.73,
	tremorNormalAmplitude: 2.1,
	tremorTangentAmplitude: 0.3,
	tremorNormalSpeed: 0.85,
	tremorTangentSpeed: 0.65,
	tremorNormalFrequency: 0.38,
	tremorTangentFrequency: 0.29,
	tremorPhaseMultiplier: 2.4,
	// "Störungen": hochfrequenter, schneller Rausch-Anteil quer zur Linie (zwei überlagerte Sinus). Reine
	// Mathematik pro Vertex -> kostenlos (kein zusätzlicher Vertex/setLatLngs). 0 = aus.
	interferenceAmplitude: 1.6,
	interferenceSpeed: 2.4,
	frameIntervalMs: 33, // ~30 fps: schont die Hauptthread-Last (Bildtakt unverändert -> Tempo via Speeds)
};

const POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS = [0, 1, 2, 3, 4, 5, 6];
const POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS = 60000;

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
		none: "icons/NurKarte.webp",
		political: "icons/PolitischeKarte.webp",
		deregraphic: "icons/RegionenKarte.webp",
		powerlines: "icons/kraftlinien.webp",
	},
	landTransport: {
		caravan: "icons/karavane.webp",
		groupFoot: "icons/Reisegruppe.webp",
		lightWalker: "icons/ZuFuss.webp",
		horseCarriage: "icons/Kutsche.webp",
		groupHorse: "icons/BeritteneReisegruppe.webp",
		lightRider: "icons/EinzelnerReiter.webp",
	},
	riverTransport: {
		riverSailer: "icons/Flusssegler.webp",
		riverBarge: "icons/Flusskahn.webp",
	},
	seaTransport: {
		cargoShip: "icons/Lastensegler.webp",
		fastShip: "icons/Schnellsegler.webp",
		galley: "icons/Galeere.webp",
	},
};
const ICON_TRANSPORT_SELECT_IDS = Object.keys(TRANSPORT_ICON_PATHS);
