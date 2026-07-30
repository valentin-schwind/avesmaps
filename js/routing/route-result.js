function resolveRouteStepTransport(routeStep, fallbackTransport = null) {
	const resolvedRouteStep = routeStep || {};
	if (resolvedRouteStep.transport) {
		return resolvedRouteStep.transport;
	}

	if (resolvedRouteStep.transport_option) {
		return resolvedRouteStep.transport_option;
	}

	if (resolvedRouteStep.mode) {
		return resolvedRouteStep.mode;
	}

	return fallbackTransport;
}

function countTransportTransfers(routeSteps) {
	const safeRouteSteps = Array.isArray(routeSteps) ? routeSteps : [];
	let transferCount = 0;
	let previousTransport = null;

	safeRouteSteps.forEach((routeStep) => {
		const transport = resolveRouteStepTransport(routeStep);
		if (!transport) {
			return;
		}

		if (previousTransport && transport !== previousTransport) {
			transferCount += 1;
		}

		previousTransport = transport;
	});

	return transferCount;
}

function buildRouteSteps(routeNames, segments, options = {}) {
	const includeRests = Boolean(options.includeRests);
	const restHoursPerDay = Number.isFinite(Number(options.restHoursPerDay)) ? Number(options.restHoursPerDay) : 10;
	const travelPerDay = Math.max(24 - restHoursPerDay, 0.5);
	const planEntries = buildRoutePlanEntries(routeNames, segments);

	return planEntries.map((entry) => {
		let restTime = 0;
		if (includeRests && !["Seeweg", "Flussweg"].includes(entry.type)) {
			const days = entry.travelTime / travelPerDay;
			const totalSegmentHours = days * 24;
			restTime = totalSegmentHours - entry.travelTime;
		}

		return {
			type: entry.type,
			transport: resolveRouteStepTransport(entry, entry.type),
			from: entry.startName,
			to: entry.endName,
			path_name: entry.segmentLabel || "",
			// Stroemungszustand der Fluss-Etappe (flussabwaerts/-aufwaerts) fuer die Anzeige;
			// null = unbekannt/kein Fluss.
			flow_state: entry.flowState || null,
			distance: entry.distance,
			travel_time: entry.travelTime,
			rest_time: restTime,
			segment_ids: entry.segmentIndexes || [],
		};
	});
}

function buildRouteSummary(routeLocations, routeSteps, options = {}) {
	const safeRouteLocations = Array.isArray(routeLocations) ? routeLocations : [];
	const safeRouteSteps = Array.isArray(routeSteps) ? routeSteps : [];
	const optimize = options.optimize === "shortest" ? "shortest" : "fastest";
	const totalDistance = safeRouteSteps.reduce((sum, step) => sum + (Number(step.distance) || 0), 0);
	const totalTravelTime = safeRouteSteps.reduce((sum, step) => sum + (Number(step.travel_time) || 0), 0);
	const totalRestTime = safeRouteSteps.reduce((sum, step) => sum + (Number(step.rest_time) || 0), 0);
	const totalHours = totalTravelTime + totalRestTime;
	// The "Drachenflug": how far a dragon flies that visits the SAME stations -- one air leg per pair of
	// consecutive waypoints, summed. Until 2026-07-30 this was the single line from the first waypoint to
	// the last, so Wehrheim -> Lowangen -> Greifenfurt reported 157.2 miles while its first leg alone
	// measures 313: a total smaller than one of its own parts, and a detour comparison that meant nothing.
	// The legs travel with the sum because the summary shows what the sum is made of.
	const airDistanceLegs = [];
	for (let index = 0; index + 1 < safeRouteLocations.length; index += 1) {
		const legStart = safeRouteLocations[index]?.coordinates;
		const legEnd = safeRouteLocations[index + 1]?.coordinates;
		if (!legStart || !legEnd) {
			continue;
		}

		airDistanceLegs.push(calculateScaledDistance(legStart, legEnd));
	}
	const airDistance = airDistanceLegs.reduce((sum, legDistance) => sum + legDistance, 0);

	return {
		distance_miles: totalDistance,
		air_distance_miles: airDistance,
		air_distance_legs: airDistanceLegs,
		travel_hours: totalTravelTime,
		rest_hours: totalRestTime,
		total_hours: totalHours,
		total_days: totalHours / 24,
		optimize,
		transfers: countTransportTransfers(safeRouteSteps),
	};
}

function buildRouteResult(routeLocations, routeNames, segments, options = {}) {
	const routeSteps = buildRouteSteps(routeNames, segments, options);
	const routeSummary = buildRouteSummary(routeLocations, routeSteps, options);

	return {
		summary: routeSummary,
		steps: routeSteps,
	};
}