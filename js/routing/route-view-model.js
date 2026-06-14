function buildRoutePlanViewModel(routeResult, routeNames, routeLocations = []) {
	const safeRouteResult = routeResult || {};
	const summary = safeRouteResult.summary || {};
	const steps = Array.isArray(safeRouteResult.steps) ? safeRouteResult.steps : [];
	const safeRouteLocations = Array.isArray(routeLocations) ? routeLocations : [];
	const safeRouteNames = Array.isArray(routeNames) ? routeNames : [];

	const routeDescriptionSource = safeRouteLocations.length ? safeRouteLocations.map((location) => location?.name || "") : safeRouteNames;
	const routeDescription = routeDescriptionSource
		.map((routeName, index) => {
			if (index === 0) {
				return `${tr("planner.journey.from", "von")} <strong>${routeName}</strong>`;
			}

			if (index === routeDescriptionSource.length - 1) {
				return `${tr("planner.journey.to", "nach")} <strong>${routeName}</strong>`;
			}

			return `${tr("planner.journey.via", "&uuml;ber")} ${routeName}`;
		})
		.join(" ");

	const planEntries = steps.map((step, index) => ({
		type: step.type || "",
		startName: step.from || "",
		endName: step.to || "",
		segmentLabel: step.path_name || "",
		distance: Number(step.distance) || 0,
		travelTime: Number(step.travel_time) || 0,
		restTime: Number(step.rest_time) || 0,
		segmentIndexes: Array.isArray(step.segment_ids) ? step.segment_ids : [],
		entryIndex: index,
	}));

	return {
		routeDescription,
		planEntries,
		summary: {
			distance: Number(summary.distance_miles) || 0,
			airDistance: Number(summary.air_distance_miles) || 0,
			travelHours: Number(summary.travel_hours) || 0,
			restHours: Number(summary.rest_hours) || 0,
			totalHours: Number(summary.total_hours) || 0,
			totalDays: Number(summary.total_days) || 0,
			startLocationName: safeRouteLocations[0]?.name || "",
			endLocationName: safeRouteLocations[safeRouteLocations.length - 1]?.name || "",
		},
	};
}