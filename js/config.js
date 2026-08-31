// Konstanten
const THRESHOLD = 0.5;
// 💣 Wie nah ein Wegende an einem Ort liegen muss, um ALS AUF IHM LIEGEND zu gelten. THRESHOLD faengt
// lose Enden ein und entscheidet bei mehreren Kandidaten nach Array-Reihenfolge; das ist willkuerlich,
// aber es fasst zusammen und haelt Knoten im Netz. Diese Grenze hier geht davor: wer exakt getroffen
// ist, bekommt sein Ende, egal wo er in locationData steht. 0,01 ist gut zehnmal die Rundungsdifferenz
// der Daten (Weggeometrie 3, Orte 5 Nachkommastellen) und weit unter dem kleinsten echten Ortspaar.
// ⚠️ Eindeutig nur, solange keine zwei Orte naeher als 2x dieser Wert stehen -- am 07.08.2026 dafuer
// 11 doppelte Kreuzungen stillgelegt, kleinster Abstand seither 0,031. Spiegelbild in PHP:
// AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT (api/_internal/routing/client-graph.php).
const LOCATION_ENDPOINT_EXACT_HIT = 0.01;
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
		src: "img/dsa-fanprojekt-logo.webp",
		coordinates: [1006, 18],
		size: [144, 40],
		anchor: [0, 0],
		alt: "DSA-Fanprojekt",
	},
};
const MAP_SCALE_BAND_MILES_BY_ZOOM = [100, 100, 100, 100, 10, 10, 10];

const ROUTE_STYLE = { pane: "routePane", color: "#1452F7", weight: 7, opacity: 1, interactive: true, lineCap: "round", lineJoin: "round" };
const ROUTE_SELECTED_STYLE = { color: "#ffd54a", weight: ROUTE_STYLE.weight, opacity: 1 };
// White casing under the route line so it reads against dark forest and bright desert alike. Drawn as a
// wider white line in its OWN pane below routePane -- a per-segment outline in the same pane would let
// the next segment's casing overlap the previous segment's colour at the joins.
const ROUTE_OUTLINE_COLOR = "#FFFFFF";
const ROUTE_OUTLINE_WIDTH = 2; // px per side
const ROUTE_OUTLINE_PANE = "routeOutlinePane";
const SYNTHETIC_ROUTE_STYLE = { ...ROUTE_STYLE, dashArray: "14 10", opacity: 0.7 };
const MEASUREMENT_LINE_STYLE = { pane: "measurementPane", color: "#FFFFFF", weight: 4, opacity: 0.95, interactive: false, dashArray: "10 8", lineCap: "round", lineJoin: "round" };
const LOCATION_MARKER_STYLE = { pane: "locationsPane", fillColor: "#F52B25", color: "#7A1411", weight: 1.25, opacity: 1, fillOpacity: 0.95 };
const MAP_MARKER_STYLE = { pane: "locationsPane", radius: 4, fillColor: "#F52B25", color: "#000", weight: 2, opacity: 1, fillOpacity: 1 };
const SYNTHETIC_ROUTE_TYPE = "Querfeldein";
const SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR = 25.0;
// Ab dieser Querfeldein-Etappenlänge (Karten-Einheiten Luftlinie; 1 Einheit = DISTANCE_SCALING_FACTOR
// Meilen) bekommt der Abschnitt in der Etappen-Liste einen Hinweis ("lange Querfeldein-Strecke –
// über See evtl. kürzer"). Rein visuell, keine Auswirkung auf die Routenberechnung.
const SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE = 20.0;
const CROSSING_LOCATION_TYPE = "crossing";
// Editor-Markierung "Kreuzungen mit 2 Wegen" (Discord #25, neu gefasst 2026-08-15): markiert wird
// der AUFLOESBARE Durchgangsknoten -- ----X---- soll ---------- werden. Drei Bedingungen, alle in
// computeLocationConnectivityIndex: genau so viele Arme wie hier steht, kein fremder Weg laeuft
// ueber den Punkt hinweg, und beide Arme sind dieselbe Wegart.
// 💣 GENAU, nicht hoechstens: null oder ein Arm ist eine Sackgasse bzw. Datenleiche und gehoert
// nicht diesem Haken (die traegt der pinke „Unverbunden"-Ring). Der alte Name lautete
// SPARSE_CROSSING_MAX_WAYS und sagte damit das Gegenteil des Vergleichs.
const SPARSE_CROSSING_WAY_COUNT = 2;
// Regel 2 des Hakens: naeher als das an einer FREMDEN Wegstrecke = der Weg laeuft ueber die Kreuzung
// hinweg. 0,02 Einheiten sind 0,06 Meilen -- eng genug, dass eine danebenlaufende Parallelstrasse
// nicht mitzaehlt, weit genug fuer die Zeichenungenauigkeit eines Editors.
const SPARSE_CROSSING_OVERLAY_DISTANCE = 0.02;
// Zellkante des Segment-Gitters. 💣 Ohne Gitter ist die Pruefung O(Kreuzungen x Segmente) und lief
// gemessen sekundenlang (2090 x 5929) -- der Index wird bei JEDER Feature-Aenderung verworfen, im
// Editor also oft. Die Zelle MUSS groesser sein als SPARSE_CROSSING_OVERLAY_DISTANCE, sonst reichen
// die drei mal drei abgefragten Zellen nicht bis an den Suchradius heran.
const SPARSE_CROSSING_SEGMENT_CELL = 0.5;
// 🔴 „Bach" STEHT HIER NICHT (Owner 30.08.2026, an einem Bildschirmfoto des Dialogs „Weg
// bearbeiten": ein Haekchen am Wegtyp, kein eigener Wegtyp). Er war vom 29. bis zum 30.08.2026 eine
// eigene Wegart -- aber weder in der Auswahlliste des Dialogs noch auf einem einzigen Objekt (live
// gemessen 0 von 6038 Wegen). Ein Bach ist seither ein FLUSSWEG mit `properties.is_bach`; die Regel
// dazu steht in avesmapsPathTransportRegel (api/_internal/map/features.php), die Anzeige in
// pathIstBach (map-features-path-domain.js).
const PATH_SUBTYPE_KEYS = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];
const PATH_ENDPOINT_SNAP_DISTANCE_PX = 18;

// Miles per hour per transport x path subtype. Derived from Geographia Aventurica S. 123 (day
// performances x the path-type factors 1,1 / 1,0 / 0,8 / 0,4) -- see docs/dsa-reisegeschwindigkeiten-
// quellenlage.md. 💣 MIRRORED IN THREE PLACES: here, AVESMAPS_ROUTE_CLIENT_SPEED_TABLE
// (api/_internal/routing/client-graph.php) and WP_SPEEDS (js/pages/wege-editor-model.js, land only).
// Changing one without the others makes wege-editor-model.test.js red -- that is its job.
//
// 💣 EVERY VALUE IS A DAY PERFORMANCE IN DISGUISE, and that is the whole construction:
//
//     value = source miles/day x mean_G x TIME_SCALE_FACTOR / travel hours
//
// The source (S. 123, 129, 131) states day performances, never speeds. `mean_G` = 1,032 is the
// measured mean slope factor over our roads (the „Eichung", path_terrain_stamp) and exists ONLY to
// cancel our own slope layer, which the source does not have -- its road factor is a flat 1,0.
//
// 🔴 „TRAVEL HOURS" IS 8 ON LAND AND 12 ON WATER, and the two numbers come from two books. The
// Geographia names 12 only for the SEA passage (S. 131) and gives land no hour count at all; „Wege
// des Entdeckers" S. 160-162 names 8 for every land mode, seven times over, and repeats the GA's day
// performances while doing it (33/30/24 on foot = 30 x 1,1/1,0/0,8). Until 2026-08-16 land ran on 12
// as well: the day performance was right and the hour figure was half again too high. So a
// group on foot travels 4,61 / 1,19 x 8 h = 31,0 miles/day on a LEVEL road, and the terrain brings
// the average over real roads back to the source's 30. Each transport carries its own source value:
// foot 30 · Wanderer 40 · beritten 35 · Reiter 50 · Karawane 30 · Kutsche 50.
//
// ⚠️ „Reisegruppe zu Pferd" is 35 by the S. 123 TABLE and „kaum mehr als 40" in the S. 118 prose.
// The table wins -- a rules calculation follows the tabulated value, and the source's own worked
// examples do too. Changing it to 40 is defensible but is then OUR choice, not the source's.
//
// 💣 TRAVEL HOURS ARE NOT UNIFORM, and the divisor above depends on the transport
// (TRANSPORT_TRAVEL_HOURS below; PHP twin avesmapsTravelValuesHoursFor):
//   land                               -> 8 h  (WdE S. 160-162, named for every land mode)
//   river, Lastensegler, Galeere       -> 12 h (S. 129/131 state the 12-hour travel day)
//   Schnellsegler                      -> 24 h, the ONE ship the source grants a night passage
//                                         (S. 131: 250 miles; the Kurier-Dromone's 200 we do not model)
// The exemption lives in route-result.js and is keyed on the TRANSPORT, not on Seeweg -- a galley
// hugs the coast and „ankert gewöhnlich nachts" (S. 131) just like a slow cargo sailer.
//
// ⭐ EACH SHIP TAKES THE SOURCE ROW WHOSE HOURS ARE OURS. That is why the Galeere carries 100 and
// not 70: S. 131 gives it three rows -- 70 at 8 rowing hours, 100 at 12, 200 at 24 with shift
// changes -- and they are one straight line at ~8,3 miles per rowing hour. Our travel day IS 12
// hours, so the 12-hour row is the matching one. It shipped as 70 for a few hours on 2026-08-03,
// which was the 8-hour row stretched over a 12-hour day: right at the default, wrong the moment a
// traveller changed the hours. With 9,92 the galley now tracks all three rows at once (8 h -> 66,7
// against 70; 12 h -> 100; 24 h -> 200, the Dromone).
// Express modes stay unmodelled elsewhere (Eilmarsch, Botenreiter, Eilkutsche) -- but „eilgerudert"
// is not a mode here, it is simply what 12 hours of rowing is called.
//
// 💣 THE CARRIAGE IS HALVED ON Weg AND Gebirgspass, and that is a RULE, not a slope. S. 123: „auf
// Karrenwegen und Pässen nur halbe Geschwindigkeit". „Karrenweg" is our `Weg` -- the source lists
// „Weg/Karrenweg" as one category at factor 0,8 and calls the carriage „riskant" there. Result
// against Strasse: Weg 0,409 (source 0,8 x 0,5) and Gebirgspass 0,182 (source 0,4 x 0,5).
//
// 💣 DIE SPALTE `Querfeldein` STEHT SEIT DEM 14.08.2026 AUF IHREM QUELLENWERT: 0,75 der Straße
// („offenes Gelände", S. 120-123), vorher 0,313. Sie ist die EINE Spalte, die die Tempowerte-Migration
// gezogen hat (Entwurf docs/superpowers/specs/2026-08-07-tempowerte-design.md §6.3) -- die übrigen
// sechs Wegtypen weichen weiterhin von der Quelle ab, und das bleibt so, bis der Owner sie im Fenster
// „Tempowerte" zurücksetzt. Ein Deploy, der jede Reisezeit auf jeder Straße verschiebt, wäre keine
// Nebenwirkung eines Wald-Features.
// ⚠️ 14.08.2026: Diese Datei holt hier ihren ASSET-STEMPEL NACH. Der Deploy-Lauf zu `2ae79c2d` wurde
// von einem nachfolgenden Push derselben Warteschlange abgebrochen; der nächste grüne Lauf schrieb den
// neuen Inhalts-Hash in die index.html, ohne die Datei selbst mitzunehmen -- `js/config.js?v=7c0895ba7f`
// lieferte danach die ALTE Fassung, und zwar dauerhaft, weil sich genau diese Adresse nie wieder ändert.
// 💣 Ein Voll-Deploy heilt das NICHT: er legt die richtige Datei unter dieselbe vergiftete Adresse.
// Nur eine INHALTSänderung heilt (neuer Hash = neue Adresse) -- deshalb steht dieser Absatz hier.
// Diagnose: `fetch(url+'?cb='+Date.now())` gegen `fetch(url)`, siehe docs/asset-caching-and-versioning.md.
//
// 🔴 DIESE TABELLE IST EIN SPIEGEL, NICHT DIE QUELLE. Die Regel besitzt der Server
// (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE plus app_setting['travel_values']); hier stehen dieselben Zahlen
// für den Client-Router und die Anzeige. Bewacht von js/routing/__tests__/speed-table-and-rest-rule.test.js.
const SPEED_TABLE = {
	groupFoot: { Reichsstrasse: 5.18, Strasse: 4.61, Weg: 4.04, Pfad: 3.45, Gebirgspass: 1.73, Wuestenpfad: 2.88, Querfeldein: 3.45 },
	lightWalker: { Reichsstrasse: 6.75, Strasse: 6.14, Weg: 5.52, Pfad: 4.91, Gebirgspass: 2.46, Wuestenpfad: 4.29, Querfeldein: 4.61 },
	groupHorse: { Reichsstrasse: 5.79, Strasse: 5.37, Weg: 4.55, Pfad: 3.72, Gebirgspass: 2.07, Wuestenpfad: 2.48, Querfeldein: 4.03 },
	lightRider: { Reichsstrasse: 8.16, Strasse: 7.68, Weg: 6.72, Pfad: 5.76, Gebirgspass: 2.88, Wuestenpfad: 3.84, Querfeldein: 5.76 },
	caravan: { Reichsstrasse: 5.27, Strasse: 4.61, Weg: 3.95, Pfad: 3.29, Gebirgspass: 1.98, Wuestenpfad: 2.63, Querfeldein: 3.45 },
	riverSailer: { Flussweg: 6.0 },
	riverBarge: { Flussweg: 4.0 },
	cargoShip: { Seeweg: 11.9 },
	fastShip: { Seeweg: 12.4 },
	galley: { Seeweg: 9.92 },
	// ⚠️ Die Kutsche trägt ihre Querfeldein-Zelle mit und fährt trotzdem nie querfeldein: das verbietet
	// die Wegart selbst (avesmapsClientRouteTransportOptions), eine Regel des Regelwerks, kein Tempo.
	horseCarriage: { Reichsstrasse: 8.39, Strasse: 7.68, Weg: 3.14, Pfad: 4.19, Gebirgspass: 1.4, Wuestenpfad: 4.19, Querfeldein: 5.76 },
};

// 🔴 DER REISETAG JE TRANSPORTMITTEL -- Spiegel von avesmapsTravelValuesHoursFor()
// (api/_internal/routing/travel-values.php), gebunden von speed-table-and-rest-rule.test.js.
// Land 8 (WdE S. 160-162) · Fluss und See 12 (GA S. 129/131) · Schnellsegler 24 (GA S. 131).
//
// 💣 ER IST DER NENNER JEDER ZAHL IN SPEED_TABLE DARUEBER. Wer hier eine Stundenzahl aendert und die
// Tabelle nicht, verschiebt eine Tagesleistung -- also eine Regelgroesse, nicht eine Anzeige.
// ⚠️ Der Rastzaehler benutzt ihn fuer WASSER; an Land gilt das Planerfeld „Reisestunden pro Tag",
// dessen Vorgabe genau diese 8 sind (route-result.js: avesmapsRouteLegTravelHours).
const TRANSPORT_TRAVEL_HOURS = {
	groupFoot: 8, lightWalker: 8, groupHorse: 8, lightRider: 8, caravan: 8, horseCarriage: 8,
	riverSailer: 12, riverBarge: 12, cargoShip: 12, galley: 12,
	fastShip: 24,
};

// ===== Reisekosten =====================================================================
// Alle Preise in HELLER. 1 Dukat = 10 Silbertaler = 100 Heller = 1.000 Kreuzer.
//
// 💣 KEINE EINZELNE QUELLE DECKT DIESES MODELL AB. Die Geographia Aventurica beziffert Zoelle
// (S. 115) und Passagen (S. 129/131) und schweigt zu Unterkunft, Verpflegung und Futter --
// wortwoertlich: die besitzen "keine allgemeinen Preise". Bett und Essen kommen deshalb aus dem
// DSA5-Regelwerk S. 382, Futter und Hufbeschlag aus dem Kodex der Helden S. 475, der
// Tagesproviant aus Wege des Entdeckers S. 72 (das ist DSA4.1, also eine andere Regeledition).
// Die vollstaendige Deckungspruefung Posten fuer Posten steht in
// docs/reisekosten-quellenlage.md §8.4 -- wer hier eine Zahl aendert, gehoert dort hinein.
const TRAVEL_COST_LODGING_KEYS = ["frei", "strohsack", "bett", "zimmer"];
const TRAVEL_COST_LODGING = {
	// bed/food/stableNight je Nacht bzw. Tag und Person; feedPerWeek nur, wo kein Stall gezahlt wird.
	// tollPerson ist die Veranlagung an EINER Landesgrenze (Geographia S. 115: der Zoellner schaetzt
	// nach dem Auftreten -- 1 H Tageloehner, 5 H Schustergeselle, 1 D Soeldner, bis 5 D gutverdienend).
	// riverPer100 ist die Flusspassage je 100 Meilen und Person (S. 129: 1 D mit Mitarbeit, bis 10 D
	// in der Kabine).
	frei:      { bed: 0,  food: 4,  stableNight: null, feedPerWeek: 5,    tollPerson: 1,   riverPer100: 100 },
	strohsack: { bed: 2,  food: 4,  stableNight: 6,    feedPerWeek: null, tollPerson: 5,   riverPer100: 100 },
	bett:      { bed: 6,  food: 8,  stableNight: 6,    feedPerWeek: null, tollPerson: 100, riverPer100: 100 },
	zimmer:    { bed: 30, food: 17, stableNight: 6,    feedPerWeek: null, tollPerson: 500, riverPer100: 1000 },
};
const TRAVEL_COST_SHOE_PER_HOOF = 5;              // 0,5 Silbertaler je Huf, Kodex S. 475
const TRAVEL_COST_HOOVES_PER_MOUNT = 4;
const TRAVEL_COST_RIVER_UPSTREAM_FACTOR = 3;      // 3 D stromauf gegen 1 D stromab, Geographia S. 129

// Welche Wegart unterwegs ein Dach anbietet. Geographia S. 113: an der Reichsstrasse alle 15 Meilen
// ein Landgasthaus; S. 114: an der Strasse alle 20 Meilen eine Herberge. Ein Reisetag ist laenger als
// beide Abstaende -- deshalb reicht die WEGART am Tagesende, es braucht keine verorteten Herbergen.
// 💣 Fuer alles Uebrige nennt die Quelle KEINEN Abstand ("bisweilen ein Gasthaus" ist keine Zahl),
// darum steht dort auch keiner: Pfad, Gebirgspass, Wuestenpfad und Querfeldein schlafen im Freien.
const TRAVEL_COST_SHELTER_BY_SUBTYPE = {
	Reichsstrasse: "inn",
	Strasse: "inn",
	Weg: "maybe",
	Flussweg: "aboard",
	Seeweg: "aboard",
};

// Reittiere je Reisendem, nach Landtransportmittel. Keine Eingabe -- wer "Reisegruppe zu Pferd"
// waehlt, hat ein Pferd; wer laeuft, hat keines. Die Karawane fuehrt ihr Kamel.
const TRAVEL_COST_MOUNTS_PER_TRAVELLER = {
	groupHorse: 1, lightRider: 1, caravan: 1, horseCarriage: 0,
	groupFoot: 0, lightWalker: 0,
};

const ROUTE_ICON_PATHS = {
	Reichsstrasse: "icons/Reichsstrasse.webp",
	Strasse: "icons/Strasse.webp",
	Gebirgspfad: "icons/Gebirgspfad.webp",
	Pfad: "icons/Pfad.webp",
	Wuestenpfad: "icons/Wueste.webp",
	Flussweg: "icons/Flusswege.webp",
	Seeweg: "icons/Meerwege.webp",
	Querfeldein: "icons/Querfeldein.webp",
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
const MAP_REVISION_API_URL = window.AVESMAPS_MAP_REVISION_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/map-revision.php" : "");
const VISITOR_TRACK_API_URL = window.AVESMAPS_VISITOR_TRACK_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/track.php" : "");
const VISITOR_METRICS_API_URL = window.AVESMAPS_VISITOR_METRICS_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/visitor-metrics.php" : "");
const VISITOR_HEARTBEAT_API_URL = window.AVESMAPS_VISITOR_HEARTBEAT_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/heartbeat.php" : "");
const POLITICAL_TERRITORIES_API_URL = window.AVESMAPS_POLITICAL_TERRITORIES_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/political-territories.php" : "");
// Landschaften, V3.0: the public read path of the ecosystem layer. Same shape as its neighbours --
// empty string off the SQL hosts, so the loader simply does nothing there. The rows here are public;
// what is gated is whether the map OFFERS the layer (IS_ECOSYSTEM_ENABLED, below).
const ECOSYSTEM_AREAS_API_URL = window.AVESMAPS_ECOSYSTEM_AREAS_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/app/ecosystem-areas.php" : "");
// V3.0b: the capability-gated write endpoint. The region picker reads its list from here (action
// list_regions) rather than from the public path -- "which region does my next area go into" is an
// editor question and has no business widening the public surface.
const ECOSYSTEM_EDIT_API_URL = window.AVESMAPS_ECOSYSTEM_EDIT_ENDPOINT || (SQL_MAP_HOSTS.has(window.location.hostname) ? "api/edit/map/ecosystem.php" : "");
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
// Tolerantes URL-Parsing: ein versehentlich mit '?' statt '&' angehaengter Parameter (z. B.
// "...&mapstyle=old?infopanel=true") wuerde sonst Teil des vorigen Werts, und der Parameter dahinter
// (hier infopanel) wuerde gar nicht erkannt. Alle '?' im Query wie '&' behandeln -> JEDER Parameter wird
// erkannt, egal ob der Nutzer '?' oder '&' angehaengt hat. Die Adresszeile bleibt unveraendert (nur das
// Parsen ist tolerant; Owner-Policy: Adresszeile nie auto-umschreiben).
window.avesmapsSearchParams = function () {
	return new URLSearchParams(String(window.location.search || "").replace(/\?/g, "&"));
};
const INITIAL_SEARCH_PARAMS = window.avesmapsSearchParams();
const IS_EDIT_MODE = INITIAL_SEARCH_PARAMS.get("edit") === "1";
// Wer die Landschaftsebene angeboten bekommt. Seit 2026-08-01 eine echte Rechteprüfung statt des
// URL-Schalters `?landschaften=1` (Owner: „keine landschaften=1 ... nur für Admins automatisch
// freischalten").
//
// 💣 `let`, nicht `const`, und Startwert `false`. Die Antwort auf „bist du Admin" kommt über das Netz,
// also gilt bis dahin -- und für immer, wenn sie nie kommt -- „nein". Der Riegel fällt geschlossen aus:
// applyEcosystemAccess() schaltet nur FREI, es schaltet nie ab. Für den anonymen Besucher passiert
// dadurch buchstäblich nichts, und genau das ist die Anforderung.
//
// 💣 Warum der alte Schalter kein Riegel war und `?edit=1` auch keiner ist: beide sind ungeprüfte
// URL-Parameter, die jeder Besucher anhängen kann. Wer den einen durch den anderen ersetzt, hat den
// Riegel nicht ersetzt, sondern nur umbenannt.
//
// Die Verbraucher lesen die Globale zum AUFRUFZEITPUNKT (map-features-display-mode.js:173,
// …-ecosystem-layer-switch.js:53, …-ecosystem-context-action.js:245/266,
// …-ecosystem-territory-import.js:629/894) und brauchen deshalb nichts weiter. Die beiden EINMALIGEN
// Stellen -- der `<option>`-Riegel in map-features.js und der Beschriftungsfilter in bootstrap.js --
// werden von applyEcosystemAccess() nachgezogen.
let IS_ECOSYSTEM_ENABLED = false;

// Wird von der Sitzungsantwort aufgerufen, sobald sie da ist. Idempotent und einbahnig.
function applyEcosystemAccess(granted) {
	if (granted !== true || IS_ECOSYSTEM_ENABLED) { return; }
	IS_ECOSYSTEM_ENABLED = true;
	// 🔴 Die Oberfläche NACHZIEHEN. Seit 2026-08-04 darf jeder die Ebene ansehen, und ein Editor kann
	// deshalb längst darin stehen, wenn die Rechteauskunft eintrifft (ein geteilter Link, der letzte
	// Zustand). Ohne diesen Aufruf bliebe sein Bedienfeld verborgen, bis er den Modus einmal
	// wechselt -- sichtbar als „bei mir fehlen die Ebenen-Kacheln".
	if (typeof syncEcosystemControlsVisibility === "function") {
		syncEcosystemControlsVisibility();
	}
	// 🪤 Der Beschriftungsfilter „nur mit Region" ergibt ohne Landschaftsmodul keinen Sinn: er würde
	// jede Beschriftung verbergen (siehe bootstrap.js). Nur im Edit-Modus überhaupt vorhanden.
	if (IS_EDIT_MODE) {
		document.getElementById("toggleLabelsWithRegionControl")?.removeAttribute("hidden");
		document.getElementById("toggleLabelsWithRegion")?.removeAttribute("disabled");
	}
}

// Sofort losschicken, nicht erst beim Kartenaufbau: die Antwort soll da sein, bevor jemand das
// Ebenen-Menü aufklappt. Kostet einen Aufruf ohne Datenbank (api/app/session.php liest nur das Cookie).
if (window.AvesmapsSession && typeof window.AvesmapsSession.load === "function") {
	window.AvesmapsSession.load().then(function () {
		// 💣 grantsEcosystem() FRAGEN, die Regel nicht noch einmal aufschreiben. Bis 2026-08-04 stand
		// hier `capabilities.admin === true` -- dieselbe Entscheidung ein zweites Mal, neben der in
		// js/app/session.js. Als der Owner die Editoren dazunahm, hätte eine Änderung dort allein
		// nichts bewirkt: diese Zeile hätte sie weiter ausgesperrt, und der Test daneben wäre grün
		// geblieben. Eine Regel, ein Ort.
		applyEcosystemAccess(window.AvesmapsSession.grantsEcosystem());
	});
}
// Die Zoombänder sofort losschicken, wie die Sitzungsabfrage darüber: wenige hundert Byte,
// ETag-gecacht, und die Antwort ist lange vor der Kartennutzlast da -- Marker werden erst nach
// map-features.php gezeichnet.
// ⚠️ Trifft sie doch später ein UND weicht sie von der Vorgabe ab, wird einmal nachgezogen. Nur
// dann: ein bedingungsloser Durchlauf kostet bei jedem Seitenstart einen vollen Sichtbarkeits-Pass
// umsonst.
//
// 💣 GEMESSEN WIRD, OB SCHON MARKER STEHEN -- NICHT, OB ES DIE FUNKTIONEN GIBT. Ein
// `typeof syncLocationMarkerVisibility === "function"` beweist nur, dass DEREN Datei gelaufen ist.
// Ihre erste Zeile ruft aber `syncLocationToggleButtons` aus js/app/bootstrap.js, und das steht in
// index.html als vorletztes von ~117 Skripten, weit hinter dieser Datei. Landete die Antwort in
// diesem Fenster, gab es genau den ReferenceError, mit dem das hier aufgefallen ist -- eine
// Funktionsdeklaration wandert ins globale Objekt, sobald IHRE eigene Datei durch ist, und sagt
// deshalb nichts über die Datei, die sie ihrerseits braucht.
// 💣 Ein Riegel auf `map` rettet dabei NICHT: `map` ist ein `const` in bootstrap.js, liegt also
// nicht auf `window`, und `typeof` auf eine noch uninitialisierte lexikalische Bindung WIRFT
// („Cannot access 'map' before initialization") statt "undefined" zu liefern. Beide Nachzieher
// brauchen es (`map.getZoom()`) -- der Riegel wäre bloss eine Zeile weiter zerbrochen.
// ⭐ `locationMarkers` ist der lückenlose Maßstab: es steht in js/app/runtime-state.js (VOR dieser
// Datei geladen, also kein TDZ) und wird von prepareLocationData gefüllt, das seinerseits erst
// läuft, wenn `map` existiert. Ist es leer, ist noch nichts gezeichnet und es gibt auch nichts
// nachzuziehen: die Werte stehen dann längst in _avesmapsLocationZoomBands, und die erste
// Zeichnung liest sie von selbst.
// ⚠️ Bewusst NICHT `avesmaps:map-ready`: das Ereignis feuert erst im `.finally()` hinter dem
// Datenload, und zwischen der fertig gezeichneten Karte und diesem `.finally` liegen Mikrotasks,
// in denen die Antwort landen kann -- dort fiele der Nachzieher still aus, und „still falsch" ist
// schlimmer als der Absturz, den es hier zu beheben gab.
// ⚠️ `typeof locationMarkers` und nicht der nackte Zugriff: drei verify-Prüfseiten laden
// js/config.js ohne js/app/runtime-state.js. Bei einer UNdeklarierten Variablen liefert `typeof`
// brav "undefined" -- das ist genau der Unterschied zur TDZ-Bindung zwei Absätze weiter oben.
// Dieselbe Arbeitsteilung fuer die Landschaften: die Tafel holen, und -- falls sie etwas anderes
// sagt als die Vorgabe -- die schon gezeichneten Flaechen und Namen nachziehen.
// 🔴 Faellt still aus (siehe avesmapsLoadEcosystemDisplay). Ohne Antwort gilt die Vorgabe, und die
// ist Ziffer fuer Ziffer das heutige Bild.
if (typeof avesmapsLoadEcosystemDisplay === "function") {
	avesmapsLoadEcosystemDisplay().then(function (changed) {
		if (!changed) {
			return;
		}
		// 💣 Zwei Zwischenspeicher, nicht einer: der Typ-Stil je Labelart haelt die FARBE fest, und
		// die Flaechen tragen ihre Deckkraft als CSS-Variable am <path>. Ohne beides wirkt eine
		// geladene Tafel erst nach dem naechsten Neuladen -- und das sieht aus wie „Speichern tut nichts".
		if (typeof avesmapsLeereLabelTypStil === "function") {
			avesmapsLeereLabelTypStil();
		}
		if (typeof avesmapsRefreshEcosystemDisplay === "function") {
			avesmapsRefreshEcosystemDisplay();
		}
	});
}

if (typeof avesmapsLoadLocationZoomBands === "function") {
	avesmapsLoadLocationZoomBands().then(function (changed) {
		if (!changed) {
			return;
		}
		if (typeof locationMarkers === "undefined" || !Array.isArray(locationMarkers) || locationMarkers.length === 0) {
			return;
		}
		if (typeof bumpLocationNameLabelStyleRevision === "function") {
			bumpLocationNameLabelStyleRevision();
		}
		if (typeof bumpLocationMarkerStyleRevision === "function") {
			bumpLocationMarkerStyleRevision();
		}
		if (typeof syncLocationMarkerVisibility === "function") {
			syncLocationMarkerVisibility();
		}
		if (typeof syncLocationNameLabelVisibility === "function") {
			syncLocationNameLabelVisibility();
		}
	});
}
// Infopanel is the ONLY experience (Owner 2026-07-17): feature info lands in the collapsible
// right-edge panel, never in a floating map popup. The ?infopanel=false escape hatch that shipped
// with the 2026-07-12 default switch is RETIRED -- it had done its job (A/B compare), and a stale
// tab or bookmark still carrying it silently served the old floating boxes, which read as "some
// regions still show the old infobox". Deliberately kept as a constant rather than removing all 17
// read sites: this stays a one-line revert if the old boxes are ever needed again.
// NOTE: edit mode still binds its own floating popup (it carries the edit actions) -- that is
// independent of this flag and unaffected.
const IS_INFOPANEL_MODE = true;
// Mode-Klasse frueh auf <html> -> flag-gebundene CSS (Panel + Zoom/Hinweise-Position) greift,
// bevor bootstrap.js die Leaflet-Zoom-Control anlegt (kein Springen der Kontrollen).
if (IS_INFOPANEL_MODE && document.documentElement) { document.documentElement.classList.add("avesmaps-infopanel-mode"); }
// Info + Editor share the right map edge as two TABS of ONE conceptual panel (Owner-Feedback: they
// used to be two independently-blinking widgets that opened/closed at random relative to each
// other). This is the single source of truth for which one is open; each side (map-features-
// infopanel.js / review-panels.js) still owns its own DOM/rendering, but only reacts to activate/
// deactivate here instead of polling each other's classList. `registerElement` lets `activate()`
// suppress the slide transition on BOTH elements during a genuine tab swap (Owner: switching tabs
// should feel instant, like flipping to another tab of the same panel -- not a close+reopen slide);
// a swap is only suppressed when a DIFFERENT tab was already open, never on the first open/close.
window.avesmapsEdgePanels = (function () {
	var active = null; // "info" | "editor" | null
	var listeners = [];
	var elements = {};
	return {
		registerElement: function (which, el) { elements[which] = el; },
		activate: function (which) {
			if (active === which) { return; }
			var previous = active;
			var isSwap = !!previous;
			if (isSwap) {
				if (elements[previous]) { elements[previous].classList.add("avesmaps-no-slide"); }
				if (elements[which]) { elements[which].classList.add("avesmaps-no-slide"); }
			}
			active = which;
			listeners.forEach(function (fn) { fn(active, previous); });
			if (isSwap) {
				if (elements[previous]) { void elements[previous].offsetWidth; }
				if (elements[which]) { void elements[which].offsetWidth; }
				if (elements[previous]) { elements[previous].classList.remove("avesmaps-no-slide"); }
				if (elements[which]) { elements[which].classList.remove("avesmaps-no-slide"); }
			}
		},
		deactivate: function (which) {
			if (active !== which) { return; }
			var previous = active;
			active = null;
			listeners.forEach(function (fn) { fn(active, previous); });
		},
		isActive: function (which) { return active === which; },
		onChange: function (fn) { listeners.push(fn); },
	};
})();

// --- Route waypoint markers (docs/route-waypoint-marker-design.md) ---------------------------------
// ONE language across map, route planner and infopanel (Owner): EVERY waypoint is a red disc of the same
// size, the destination is a red teardrop, and the SELECTED waypoint turns gold-yellow. So red means
// "waypoint" and gold means "selected" -- the mark never encodes the position in the route.
//
// Roles (start | between | end) still exist, but only two things depend on them: the teardrop shape at
// the end, and the role line in the infobox ("Dorf · Startpunkt"). start and between draw IDENTICALLY.
//
// NEVER mark the crossings/pass-through nodes of the computed route (Bug #10) -- that is what made the
// earlier icon attempt look restless.
//
// Two renderings are built; the flag decides which one ships. `vector` (the default, owner's pick) is an
// inline SVG that takes its colours from the tokens -- so the selected state is a pure CSS recolour;
// `image` uses the painted WebPs and swaps in the gold artwork instead. Both share the SAME geometry.
// Override live for an A/B compare: ?routemarkers=image and ?routemarkersize=large.
const ROUTE_WAYPOINT_MARKER_MODE = INITIAL_SEARCH_PARAMS.get("routemarkers") === "image" ? "image"
	: INITIAL_SEARCH_PARAMS.get("routemarkers") === "vector" ? "vector"
		: "vector";
// Sizes in px. The disc is square and the SAME for start and between; `end` is the teardrop's HEIGHT --
// its width follows from ROUTE_WAYPOINT_END_ASPECT so the graphic is never distorted (the 80x80
// squashed-pin bug of fbb5565b, which is why that attempt "rendered wrong").
const ROUTE_WAYPOINT_MARKER_SIZES = {
	small: { waypoint: 26, end: 36 },
	medium: { waypoint: 34, end: 46 },
	large: { waypoint: 44, end: 58 },
};
const ROUTE_WAYPOINT_MARKER_SIZE = ROUTE_WAYPOINT_MARKER_SIZES[INITIAL_SEARCH_PARAMS.get("routemarkersize")]
	? INITIAL_SEARCH_PARAMS.get("routemarkersize")
	: "medium";
// Teardrop aspect ratio (width / height) -- matches img/menu/waypoint-end.webp (75x128), cropped tight
// so its bottom tip IS the anchor point.
const ROUTE_WAYPOINT_END_ASPECT = 75 / 128;
// Only the image mode needs artwork; the vector mode recolours itself from the tokens.
const ROUTE_WAYPOINT_MARKER_IMAGES = {
	waypoint: "img/menu/waypoint.webp",
	waypointActive: "img/menu/waypoint-active.webp",
	end: "img/menu/waypoint-end.webp",
	endActive: "img/menu/waypoint-end-active.webp",
};
// Grace period before a hovered waypoint popup closes -- long enough to move the mouse across the gap
// from the marker into the popup (otherwise its buttons would be unclickable).
const ROUTE_WAYPOINT_POPUP_CLOSE_DELAY_MS = 220;

const MAP_TILE_STYLES = {
	// 🔴 DREI Kachelsaetze, seit 26.08.2026 einzeln waehlbar (Entwurf: docs/superpowers/specs/2026-08-26-ansicht-untergrund-kreuzen-design.md).
	// `old` traegt die alte Karte MIT aufgedruckten Namen (GARETH, Vierok, Wiesengrund), `original` dieselbe Karte OHNE sie, `stylized` die neu erzeugte.
	// 💣 Die BESCHRIFTUNGEN wandern, die KENNUNGEN nie: `stylized` heisst „Modern", bleibt aber `stylized` -- der Schluessel steckt im Ordnernamen, in geteilten Links (`?mapstyle=`) und in `avesmaps.edit.mapStyle`. Dieselbe Trennung wie „Neuigkeiten"/`changelog` (AGENTS.md §11).
	// 🪤 `old` zeigte vom 26.08.2026 morgens bis mittags auf `tiles/original` -- damals war geplant, den alten Satz zu loeschen. Er bleibt (die aufgedruckten Namen sind fuer Editoren die Vorlage), deshalb hat jeder Satz wieder seinen eigenen Ordner.
	// 🔴 `ortsnamenImBild` heisst: DIESER Satz traegt die Ortsnamen schon im Bild, die Karte darf sie
	// also nicht ein zweites Mal darueberzeichnen. Es ist die einzige Eigenschaft, an der ein
	// Zeichner den Untergrund unterscheiden darf -- wer stattdessen `activeMapStyle !== "stylized"`
	// fragt, sperrt `original` und `none` gleich mit aus, obwohl die gar nichts aufgedruckt haben
	// (genau das ist am 27.08.2026 bei „Standard × Original" passiert, siehe
	// js/map-features/map-features-location-name-labels.js).
	old: { label: "Old", url: "./tiles/old/{z}/map_{x}_{y}.webp", ortsnamenImBild: true },
	original: { label: "Original", url: "./tiles/original/{z}/map_{x}_{y}.webp" },
	stylized: { label: "Modern", url: "./tiles/stylized/{z}/map_{x}_{y}.webp" },
};
const MAP_FEATURE_UPDATE_API_URL = window.AVESMAPS_MAP_FEATURE_UPDATE_ENDPOINT || "api/edit/map/features.php";
const LOCATION_REPORT_REVIEW_API_URL = window.AVESMAPS_LOCATION_REPORT_REVIEW_ENDPOINT || "api/edit/reports/locations.php";
const MAP_AUDIT_LOG_API_URL = window.AVESMAPS_MAP_AUDIT_LOG_ENDPOINT || "api/edit/map/audit-log.php";
const WIKI_SYNC_LOCATIONS_API_URL = window.AVESMAPS_WIKI_SYNC_LOCATIONS_ENDPOINT || "api/edit/wiki/sync.php";
const WIKI_SYNC_TERRITORIES_API_URL = window.AVESMAPS_WIKI_SYNC_TERRITORIES_ENDPOINT || "api/edit/wiki/territories.php";
const WIKI_SYNC_DUMP_API_URL = window.AVESMAPS_WIKI_SYNC_DUMP_ENDPOINT || "api/edit/wiki/dump.php";
const EDITOR_PRESENCE_API_URL = window.AVESMAPS_EDITOR_PRESENCE_ENDPOINT || "api/edit/map/presence.php";
const LINK_CHECK_API_URL = window.AVESMAPS_LINK_CHECK_ENDPOINT || "api/edit/map/link-check.php";
const CONFLICTS_API_URL = window.AVESMAPS_CONFLICTS_ENDPOINT || "api/edit/map/conflicts.php";
const EDIT_MODE_PLANNER_STATE_STORAGE_KEY = "avesmaps.edit.plannerState";
const EDIT_MODE_REVIEW_PANEL_STORAGE_KEY = "avesmaps.edit.reviewPanelHidden";
const EDIT_MODE_MAP_STYLE_STORAGE_KEY = "avesmaps.edit.mapStyle";
// Persisted edit-mode map frame: {"lat":…,"lng":…,"zoom":…}. Deliberately its OWN key, NOT folded into
// avesmaps.edit.plannerState -- that string is built by buildPlannerSearchParams(), which also builds the
// ?s= share links, so a lat/lng/zoom there would leak into every share link an editor creates.
const EDIT_MODE_MAP_VIEW_STORAGE_KEY = "avesmaps.edit.mapView";
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
	// samples/tension come from js/map-features/map-features-line-catmull.js, which index.html loads
	// immediately before this file. They live there because the Landschaften editor samples the very
	// same curve without loading config.js -- one set of numbers, so the two windows cannot draw
	// different lines. Changing them changes what V9 stored: press "Zugehörigkeit rechnen" again.
	...AVESMAPS_CATMULL_DEFAULTS,
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
	// 🔴 „Bach" IST HIER EIN GÜLTIGER SCHLÜSSEL, obwohl er in PATH_SUBTYPE_KEYS bewusst fehlt: diese
	// Tafel beschreibt das AUSSEHEN, nicht den Speicher (Owner 31.08.2026, „bach is halb so breit wie
	// n fluss"). Der Faktor 0,5 halbiert Kontur UND Füllung -- aus 5/3 px werden 2,5/1,5.
	// 💣 DIE 0 IST MEHR ALS „UNSICHTBAR": pathShouldBeOnMap nimmt einen Weg mit Faktor 0 VON DER KARTE
	// (map-features-display-mode.js). Genau so verschwinden die Straßen beim Rauszoomen -- es braucht
	// keinen zweiten Sichtbarkeits-Riegel, und die Fließrichtungs-Pfeile gehen von selbst mit, weil
	// sie prüfen, ob die gezeichnete Linie auf der Karte liegt.
	Bach: { 0: 0, 1: 0, 2: 0, 3: 0.5, 4: 0.5, 5: 0.5, 6: 0.5 },
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
	// ⚠️ radius/shape/borderWidth standen hier bis zum 16.08.2026 und wurden von keiner Zeile
	// gelesen -- die Markergeometrie kommt aus dem Zoomband (js/map-features/location-zoom-bands.js).
	metropole: { label: "Metropolen", singularLabel: "Metropole", icon: "🏛️", queryParam: "toggleMetropolen" },
	grossstadt: { label: "Großstädte", singularLabel: "Großstadt", icon: "🏰", queryParam: "toggleGrossstaedte" },
	stadt: { label: "Städte", singularLabel: "Stadt", icon: "⛪", queryParam: "toggleStaedte" },
	kleinstadt: { label: "Kleinstädte", singularLabel: "Kleinstadt", icon: "🏘️", queryParam: "toggleKleinstaedte" },
	dorf: { label: "Dörfer", singularLabel: "Dorf", icon: "🏡", queryParam: "toggleDoerfer" },
	gebaeude: { label: "Besondere Bauwerke/Stätten", singularLabel: "Besondere Bauwerke/Stätten", icon: "🏛️", queryParam: "toggleGebaeude" },
	// 🔴 Die zweite BAUWERKSklasse (Owner 30.08.2026, Garetien-Import: „wie Gebäude, aber
	// innerorts", 22 Objekte). Sie ist ausdrücklich KEIN Behälter -- was das für den Code heißt,
	// steht in api/_internal/ortsklassen.php und js/ui/ortsklassen.js.
	// ⚠️ Plural und Singular sind im Deutschen dasselbe Wort; das ist kein vergessenes Feld.
	stadtviertel: { label: "Stadtviertel", singularLabel: "Stadtviertel", icon: "🏙️", queryParam: "toggleStadtviertel" },
};
const LOCATION_ICON_PATHS = {
	metropole: "icons/metropole.webp",
	grossstadt: "icons/grossstadt.webp",
	stadt: "icons/stadt.webp",
	kleinstadt: "icons/kleinstadt.webp",
	dorf: "icons/dorf.webp",
	gebaeude: "icons/bauwerk.webp",
	// 🔧 GELIEHEN, nicht entschieden (Owner 31.08.2026: „nimm erstmal die gebäude-bilder").
	// Ein eigenes Bild ersetzt diese Zeile; bis dahin steht hier ausdrücklich dasselbe wie
	// darüber, statt dass es wie eine Wahl aussieht.
	stadtviertel: "icons/bauwerk.webp",
};
// Realistic settlement illustrations by size (icons/realistic/) -- shown as the floating-box header
// image instead of the coat of arms (Owner). One per settlement type.
const LOCATION_REALISTIC_ICON_PATHS = {
	metropole: "icons/realistic/metropole.webp",
	grossstadt: "icons/realistic/grossstadt.webp",
	stadt: "icons/realistic/stadt.webp",
	kleinstadt: "icons/realistic/kleinstadt.webp",
	dorf: "icons/realistic/dorf.webp",
	gebaeude: "icons/realistic/bauwerk.webp",
	stadtviertel: "icons/realistic/bauwerk.webp", // 🔧 geliehen, siehe oben
};
const LOCATION_TYPE_KEYS = Object.keys(LOCATION_TYPE_CONFIG);
const LOCATION_TYPE_VISIBILITY_ORDER = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"];
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
// Frist des GEPARSTEN Ebenen-Zwischenspeichers im Loader (nur Ansichtsmodus). 🔴 Absichtlich
// dieselben 300 s wie der Server-Dateicache (avesmapsPoliticalLayerCacheTtlSeconds): damit ist die
// Gesamtveraltung genau die, die der Server ohnehin zusichert, und der Umbau macht sie nicht
// groesser. Ein Schreibvorgang im Editor leert ihn sofort, unabhaengig von dieser Frist.
const POLITICAL_TERRITORY_LAYER_PARSED_CACHE_TTL_MS = 300000;

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
	toggleUnconnected: false,
	toggleSparseCrossings: false,
	toggleOpenPathEnds: false,
	toggleNodix: false,
	toggleHidden: false,
	toggleLabelsWithRegion: false,
	pathType: "fastest",
	minimizeTransfers: false,
	// 16 = 24 - 8: der Reisetag an Land (WdE S. 160-162). Gespiegelt im Markup-Feld
	// #travelHoursPerDay (value="8.0") -- zwei Vorgaben, eine Zahl.
	restHours: 16,
	// Reisekosten: „bett" ist die Mitte der vier Stufen. Eine Gruppengroesse gibt es NICHT --
	// gerechnet wird immer je Person (Owner 2026-08-03).
	// 💣 WAS HIER STEHT UND EINE ANGEZEIGTE ZAHL BEWEGT, MUSS IM TEILEN-LINK MITREISEN -- und zwar
	// in BEIDE Richtungen: `buildPlannerSearchParams` schreibt, `applyPlannerStateFromUrl` liest
	// (js/map-features/map-features-layer-state.js). Die Unterbringung tat es bis zum 26.08.2026
	// nicht (Meldung #103): Absender und Empfaenger sahen fuer DIESELBE Reise 1 D 2 S gegen
	// 3 D 9 S 3 H. Eine Haelfte allein genuegt nicht -- ein geschriebener Wert, den niemand liest,
	// ist genau der Zustand, der drei Wochen unbemerkt blieb (Rundreise-Test:
	// js/map-features/__tests__/teilen-unterbringung.test.js).
	lodging: "bett",
	// Reisebeginn. Leerer Monat = „Ohne Jahreszeit — kein Einfluss", und das ist die Vorgabe, nicht
	// nur Bequemlichkeit: POST /api/route/ ist der stabile oeffentliche Vertrag, und ein geteilter
	// Link muss beim Empfaenger dieselbe Zahl zeigen wie beim Absender.
	startMonth: "",
	startDay: 1,
	allowLand: true,
	landTransport: "groupFoot",
	allowRiver: true,
	riverTransport: "riverSailer",
	allowSea: true,
	seaTransport: "cargoShip",
};
// Welche Kartenmodi Karten-Labels (Landschaftsnamen) bzw. Territoriengrenzen VON SICH AUS zeigen.
// "ecosystem" sieht in beidem aus wie "deregraphic" -- Owner 2026-07-26: im Landschaftsmodus ist die
// Ansicht wie bei Standard. Beide Listen stehen hier und nicht bei ihren Zeichnern, weil die zwei
// Editor-Haken ("Labels"/"Grenzen") beim Moduswechsel auf genau diese Werte gesetzt werden -- eine
// zweite Kopie der Liste wuerde genau dort auseinanderlaufen, wo es niemandem auffaellt.
// NICHT zu verwechseln mit TERRITORY_BOUNDARY_MODES (political-territory-loader.js): das ist das
// LADE-Tor fuer die Territoriumsdaten, dies hier das ZEICHEN-Tor.
const MAP_LABEL_MODES = ["deregraphic", "ecosystem"];
// "ecosystem" left this list on 2026-07-26 (Owner): in the Landschaften mode the territory boundaries
// are drawn over the very areas being traced, and the mode is entered to draw, not to compare. The list
// only sets the DEFAULT -- the editor's "Grenzen" checkbox is an override and still switches them on
// (map-features-boundary-canvas-overlay.js:498 reads this list and that override).
const BOUNDARY_OVERLAY_MODES = ["political", "deregraphic"];
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
		deregraphic: "icons/StandardKarte.webp",
		powerlines: "icons/kraftlinien.webp",
		original: "icons/OriginalKarte.webp",
		ecosystem: "icons/RegionenKarte.webp",
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
	// Reisemonat und Unterbringung sind DASSELBE Bedienelement wie die Transportmittel darueber
	// (Owner 11.08.2026, mit Pfeil im Bild: die zwei Auswahlfelder sollen aussehen wie
	// „Lastensegler"). Gleiche Hoehe und gleiche Schrift fallen damit nicht durch abgeschriebene
	// Zahlen zusammen, sondern weil es ein Bauteil ist.
	// 💣 Leer, und das ist die Anmeldung: ICON_TRANSPORT_SELECT_IDS liest die SCHLUESSEL dieser
	// Tabelle. Eine zweite Liste „welche Selects sind Comboboxen" gaebe es damit nicht -- sie waere
	// genau die, die beim naechsten Eintrag vergessen wird.
	// ⚠️ Kein Zeichen: fuer dreizehn Monate und vier Unterkuenfte gibt es keins, und ein erfundener
	// Platzhalter waere schlechter als keiner. createTransportOptionButton laesst das <img> dann weg.
	travelStartMonth: {},
	travelLodging: {},
};
const ICON_TRANSPORT_SELECT_IDS = Object.keys(TRANSPORT_ICON_PATHS);
