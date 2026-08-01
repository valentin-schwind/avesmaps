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

/**
 * The route's starting point: the first filled waypoint of the planner that resolves to a place.
 *
 * ⭐ Deliberately the planner's own field rather than „the nearest place to the click". The traveller
 * has usually already said where they are, and silently starting somewhere else would be the kind of
 * helpfulness nobody asked for. With nothing entered, the feature says so instead of guessing.
 */
function findTravelHereStartName() {
	if (typeof getWaypointContainers !== "function" || typeof validateLocation !== "function") {
		return "";
	}
	let startName = "";
	getWaypointContainers().each(function () {
		if (startName) {
			return;
		}
		const value = String($(this).find(".waypoint-input").val() || "").trim();
		if (value && validateLocation(value)) {
			startName = value;
		}
	});

	return startName;
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
 * Plan and draw a route from the planner's start to an arbitrary map point.
 */
async function travelToMapPoint(latlng) {
	if (!latlng || typeof calculateRouteServer !== "function") {
		return;
	}

	const startName = findTravelHereStartName();
	if (!startName) {
		showFeedbackToast(
			tr("travelHere.error.noStart", "Bitte zuerst einen Startpunkt im Routenplaner eintragen."),
			"warning"
		);
		return;
	}

	// Der Name traegt die Koordinaten: so stehen sie in der Reisebeschreibung („… nach Kartenpunkt
	// (657.150, 270.990)") und in der Wegpunkt-Infobox, ohne dass der Reiseplan ein eigenes Feld
	// dafuer braucht.
	const coordinates = formatTravelHereCoordinates(latlng);
	const pointLabel = `${tr(TRAVEL_HERE_POINT_LABEL_KEY, "Kartenpunkt")} (${coordinates})`;
	const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
	const request = buildServerRouteProbeRequest(startName, pointLabel, useShortest, []);
	// 💣 x = lng, y = lat. See the file header.
	request.to_point = { x: latlng.lng, y: latlng.lat };

	let result = null;
	try {
		result = await calculateRouteServer(request);
	} catch (error) {
		// The server answers 422 with a machine code for the three things that can legitimately go
		// wrong with a clicked point; anything else is a real fault and keeps its own message.
		showFeedbackToast(error?.code ? travelHereErrorMessage(error.code) : (error?.message || travelHereErrorMessage("")), "warning");
		return;
	}

	if (!result || !result.found) {
		showFeedbackToast(travelHereErrorMessage("no_offroad_route"), "warning");
		return;
	}

	const display = buildRouteResultFromServerRoute(result, startName, pointLabel);
	if (!display.segments.length) {
		showFeedbackToast(travelHereErrorMessage(""), "warning");
		return;
	}

	resetRoutePresentation();

	// 💣 VOR showRoutePlan. Die Reisebeschreibung („Die Reise von X nach Y") und die Luftlinie der
	// Zusammenfassung lesen `selectedLocations`, nicht die Knotennamen -- ohne diese Zeile stuenden
	// dort noch die Wegpunkte der letzten gewoehnlichen Route.
	//
	// ⭐ Und es ist zugleich die Markierung: der angeklickte Punkt wird ein WEGPUNKT wie jeder andere,
	// also zeichnet ihn renderRouteWaypointMarkers mit demselben Ziel-Marker und derselben
	// Hover-Infobox wie ein Ort. Ein eigener Markertyp waere ein zweiter Weg, dasselbe zu sagen.
	// `collectAndValidateSelectedLocations` baut die Liste bei der naechsten gewoehnlichen Route
	// ohnehin aus den Eingabefeldern neu -- der Eintrag ueberlebt diese Route nicht.
	const startLocation = validateLocation(startName);
	selectedLocations = [
		...(startLocation ? [startLocation] : []),
		{
			name: pointLabel,
			coordinates: [latlng.lat, latlng.lng],
			// Die Typ-Zeile der Infobox: „657.150, 270.990 · Ziel". Ein Kartenpunkt hat keine
			// Ortsgroesse, also steht dort die Position statt „Dorf".
			locationTypeLabel: coordinates,
			isMapPoint: true,
		},
	];

	drawRoute(display.segments);
	showRoutePlan(display.routeNodeNames, display.segments);
	renderRouteWaypointMarkers();
	zoomToCurrentRoute();

	if (typeof trackVisitorEvent === "function") {
		trackVisitorEvent("route", `${startName} → ${pointLabel}`);
		trackVisitorEvent("route_option", "hierher reisen");
	}
}
