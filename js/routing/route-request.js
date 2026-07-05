function normalizeRouteRequest(request) {
	const normalizedRequest = request || {};
	const normalizedVia = Array.isArray(normalizedRequest.via)
		? normalizedRequest.via.map((locationName) => String(locationName || "").trim()).filter(Boolean)
		: [];
	const normalizedTransports = normalizedRequest.transports || {};
	const restHoursPerDay = Number(normalizedRequest.rest_hours_per_day);

	return {
		from: String(normalizedRequest.from || "").trim(),
		to: String(normalizedRequest.to || "").trim(),
		via: normalizedVia,
		optimize: normalizedRequest.optimize === "shortest" ? "shortest" : "fastest",
		include_air_distance: normalizedRequest.include_air_distance !== false,
		include_geometry: normalizedRequest.include_geometry !== false,
		include_steps: normalizedRequest.include_steps !== false,
		include_rests: Boolean(normalizedRequest.include_rests),
		rest_hours_per_day: Number.isFinite(restHoursPerDay) ? restHoursPerDay : 0,
		minimize_transfers: Boolean(normalizedRequest.minimize_transfers),
		transports: {
			land: {
				enabled: Boolean(normalizedTransports.land?.enabled),
				mode: normalizedTransports.land?.mode || null,
			},
			river: {
				enabled: Boolean(normalizedTransports.river?.enabled),
				mode: normalizedTransports.river?.mode || null,
			},
			sea: {
				enabled: Boolean(normalizedTransports.sea?.enabled),
				mode: normalizedTransports.sea?.mode || null,
			},
			synthetic: {
				enabled: Boolean(normalizedTransports.synthetic?.enabled),
				mode: normalizedTransports.synthetic?.mode || null,
			},
		},
	};
}

function buildRouteRequestFromPlannerState() {
	const waypointNames = [];
	getWaypointContainers().each(function () {
		const waypointName = String($(this).find(".waypoint-input").val() || "").trim();
		if (waypointName) {
			waypointNames.push(waypointName);
		}
	});

	const routeOptions = buildRouteOptionsFromPlannerControls();
	const optimize = $('input[name="pathType"]:checked').val() === "shortest" ? "shortest" : "fastest";
	const includeRests = getPlannerRestHoursPerDay() > 0;
	const restHoursPerDay = getPlannerRestHoursPerDay();
	const from = waypointNames.length ? waypointNames[0] : "";
	const to = waypointNames.length ? waypointNames[waypointNames.length - 1] : "";
	const via = waypointNames.length > 2 ? waypointNames.slice(1, -1) : [];

	return normalizeRouteRequest({
		from,
		to,
		via,
		optimize,
		include_air_distance: true,
		include_geometry: true,
		include_steps: true,
		include_rests: includeRests,
		rest_hours_per_day: restHoursPerDay,
		minimize_transfers: $("#minimizeTransfers").is(":checked"),
		transports: {
			land: {
				enabled: routeOptions.allowLand,
				mode: routeOptions.landOption,
			},
			river: {
				enabled: routeOptions.allowRiver,
				mode: routeOptions.riverOption,
			},
			sea: {
				enabled: routeOptions.allowSea,
				mode: routeOptions.seaOption,
			},
			synthetic: {
				enabled: routeOptions.allowLand,
				mode: routeOptions.landOption,
			},
		},
	});
}