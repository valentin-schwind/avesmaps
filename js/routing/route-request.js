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