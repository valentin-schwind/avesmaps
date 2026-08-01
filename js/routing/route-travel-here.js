// „Hierher reisen": right-click anywhere on the map, the boot, and a route to that exact spot.
// Instruction: docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md.
//
// The clicked point is not a place and never becomes one. It travels to the server as a COORDINATE
// (`to_point`), which turns it into a graph node with one cross-country A* leg; everything that comes
// back is an ordinary route and is drawn by the ordinary renderer.
//
// 💣 THE COORDINATE ORDER SWAPS HERE, and this is the single place it does. Leaflet's L.CRS.Simple
// speaks `[lat, lng]`, GeoJSON and the routing graph speak `[x, y]` -- so `x = lng`, `y = lat`. Doing
// it once, at the point where the click is read, is what keeps the rest of the chain honest.

// The name the point carries through the plan. It is a label, never a lookup key: the server routes
// on an internal node name and echoes this back untouched.
const TRAVEL_HERE_POINT_LABEL_KEY = "planner.point.mapPoint";

/**
 * The clicked spot as text, in the ONE format this map already shows coordinates in.
 *
 * ⭐ Reused, not invented: `formatLocationReportCoordinates` (js/review/review-locations.js) is what
 * the „Hier melden"-Formular puts under „Position" -- `lat, lng` to three decimals. A second format
 * would mean the same spot reads two different ways depending on which dialog you opened.
 *
 * ⚠️ It is therefore `y, x`, not `x, y`: Leaflet's L.CRS.Simple order, the same one the `?pin=`
 * deep link uses. Three decimals are ~3 m on a map where one unit is 3 km.
 */
function formatTravelHereCoordinates(latlng) {
	if (typeof formatLocationReportCoordinates === "function") {
		return formatLocationReportCoordinates(latlng);
	}
	const normalized = L.latLng(latlng);
	return `${normalized.lat.toFixed(3)}, ${normalized.lng.toFixed(3)}`;
}

// Ein angeklickter Kartenpunkt ist ein Wegpunkt wie jeder andere -- und ein Wegpunkt ist in diesem
// Planer ein STÜCK TEXT in einem Eingabefeld. Also traegt der Text die Koordinaten, und dieses
// Muster liest sie wieder heraus.
//
// ⭐ Damit faellt eine ganze Menge weg, die es sonst braeuchte: die Zeile laesst sich verschieben,
// entfernen und sortieren wie jede andere, sie ueberlebt jedes Neuberechnen, und ein geteilter Link
// stellt sie wieder her -- denn der speichert Wegpunkte als Namen.
//
// ⚠️ Das Muster haengt an den KLAMMERN AM ENDE, nicht am Wort „Kartenpunkt": das Wort ist uebersetzbar
// (`?lang=en` -> „Map point"), die Zahlen sind es nicht. Ein echter Ortsname endet nie auf
// „(Zahl, Zahl)" -- die Wiki-Klammern sind Woerter („Nostria (Stadt)").
const MAP_POINT_WAYPOINT_PATTERN = /\(\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*\)\s*$/;

/**
 * Der Wegpunkt-Text eines Kartenpunkts -> ein Pseudo-Ort, oder null.
 *
 * Der Rueckgabewert sieht aus wie ein Ort aus `locationData` (name + `coordinates: [lat, lng]`) und
 * traegt zusaetzlich `isMapPoint`, woran ihn alles erkennt, was ihn anders behandeln muss.
 */
function parseMapPointWaypoint(value) {
	const text = String(value || "").trim();
	const match = MAP_POINT_WAYPOINT_PATTERN.exec(text);
	if (!match) {
		return null;
	}
	const lat = Number(String(match[1]).replace(",", "."));
	const lng = Number(String(match[2]).replace(",", "."));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	return { name: text, coordinates: [lat, lng], isMapPoint: true };
}

/**
 * Haengt die Koordinaten-Endpunkte an eine Routenanfrage, wo ein Wegpunkt ein Kartenpunkt ist.
 *
 * 💣 OHNE DAS SCHICKT DER PLANER DEN TEXT ALS ORTSNAMEN, und der Server kennt keinen Ort namens
 * „Kartenpunkt (657.150, 270.990)" -- die Route waere `location_not_found`. `from`/`to` bleiben als
 * Beschriftung stehen, die Koordinate reist daneben.
 */
function applyMapPointRouteEndpoints(request, startLocation, endLocation) {
	if (!request) {
		return request;
	}
	// ⚠️ x = lng, y = lat -- GeoJSON gegen Leaflet, die eine Vertauschung dieses Features.
	if (startLocation?.isMapPoint) {
		request.from_point = { x: startLocation.coordinates[1], y: startLocation.coordinates[0] };
	}
	if (endLocation?.isMapPoint) {
		request.to_point = { x: endLocation.coordinates[1], y: endLocation.coordinates[0] };
	}

	return request;
}

/** Ist das einer der drei Gruende, aus denen ein Kartenpunkt abgelehnt werden darf? */
function isTravelHereErrorCode(code) {
	return code === "point_not_on_land" || code === "no_exit_node" || code === "no_offroad_route";
}

/**
 * The German sentence for a refusal, keyed by the server's machine code.
 *
 * ⚠️ The codes are English and stable (AGENTS.md §8); the sentences are German UI and live here, in
 * the i18n table, so the planned `?lang=en` overlay can translate them without touching the API.
 */
function travelHereErrorMessage(errorCode) {
	if (errorCode === "point_not_on_land") {
		return tr("travelHere.error.notOnLand", "Dorthin führt kein Landweg — bitte einen Punkt an Land wählen.");
	}
	if (errorCode === "no_exit_node") {
		return tr("travelHere.error.noExitNode", "In der Nähe gibt es keinen Wegpunkt, von dem aus man aufbrechen könnte.");
	}
	if (errorCode === "no_offroad_route") {
		return tr("travelHere.error.noOffroadRoute", "Dorthin führt kein Weg über Land.");
	}

	return tr("travelHere.error.generic", "Die Reise dorthin konnte nicht berechnet werden.");
}

/**
 * „Hierher reisen": den angeklickten Punkt als Wegpunkt in den Planer eintragen und routen.
 *
 * ⭐ MEHR IST ES NICHT, und das ist der Punkt. Frueher hat diese Funktion selbst eine Anfrage gebaut,
 * gezeichnet, den Plan gesetzt und die Marker gemalt -- ein zweiter Routenweg neben dem des Planers.
 * Jetzt traegt sie eine Zeile ein und ruft `updateMapView()`, genau wie „Zur Route hinzufuegen" an
 * einem Ort. Damit erbt der Kartenpunkt alles auf einmal: die Wegpunkt-Zeile mit Ziehgriff und
 * Entfernen-Knopf, den Ziel-Marker, den Reiseplan, den geteilten Link und jedes spaetere Neurechnen.
 */
function travelToMapPoint(latlng) {
	if (!latlng || typeof fillLastEmptyWaypointOrAppend !== "function" || typeof updateMapView !== "function") {
		return;
	}

	// Die Koordinaten stecken IM NAMEN -- sie sind das, was den Wegpunkt ausmacht. So stehen sie in der
	// Zeile, in der Reisebeschreibung, an der letzten Etappe und in der Infobox des Markers, und
	// `parseMapPointWaypoint` liest sie ueberall dort wieder heraus, wo ein Ort erwartet wird.
	const pointLabel = `${tr(TRAVEL_HERE_POINT_LABEL_KEY, "Kartenpunkt")} (${formatTravelHereCoordinates(latlng)})`;
	fillLastEmptyWaypointOrAppend(pointLabel);

	// 💣 WER DER ERSTE IST, IST DER START. War der Planer leer, ist der angeklickte Punkt eben KEIN
	// Ziel, sondern der Ausgangspunkt -- und dann „bitte zuerst einen Startpunkt eintragen" zu sagen
	// ist doppelt falsch: es fehlt kein Start, es fehlt ein ZIEL, und der Start steht schon da. Der
	// Owner hat genau diesen Satz gemeldet („kommt trotzdem"), und er hatte recht: die alte Meldung
	// beschrieb einen Zustand, den dieser Ablauf gar nicht mehr erzeugen kann, seit der Klick den
	// Wegpunkt IMMER eintraegt.
	//
	// ⚠️ Kein Fehler, sondern ein Zwischenstand: Tonfall „info", nicht „warning".
	const filledWaypointCount = typeof getWaypointInputValues === "function" ? getWaypointInputValues().length : 2;
	if (filledWaypointCount < 2) {
		showFeedbackToast(
			tr("travelHere.hint.startSet", "Kartenpunkt als Startpunkt gesetzt — jetzt noch ein Ziel wählen."),
			"info"
		);
	}

	updateMapView();

	if (typeof trackVisitorEvent === "function") {
		trackVisitorEvent("route_option", "hierher reisen");
	}
}
