function getRouteSegments(route) {
	return route
		.map(({ connectionId }) => {
			const segment = pathData.find((p) => p.properties.id === connectionId) || syntheticPathSegments.get(connectionId);
			if (!segment) console.warn(`Kein Segment gefunden fuer Verbindung ${connectionId}`);
			return segment;
		})
		.filter(Boolean);
}

function getTransportOption(routeType) {
	return getTransportOptionForRouteType(routeType, buildRouteOptionsFromPlannerControls());
}

function isTransportAllowedForPath(pathProperties, transportOption) {
	if (!transportOption) {
		return false;
	}

	const subtype = normalizePathSubtype(pathProperties?.feature_subtype || pathProperties?.name);
	const domain = pathProperties?.transport_domain || getDefaultTransportDomainForPathSubtype(subtype);
	if (subtype === "Wuestenpfad" && transportOption === "horseCarriage") {
		return false;
	}

	const allowedTransports = Array.isArray(pathProperties?.allowed_transports)
		? pathProperties.allowed_transports
		: TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	return allowedTransports.includes(transportOption);
}

function applyRestTimes(travelHours) {
	if (!$("#includeRests").is(":checked")) return travelHours;
	const restHours = parseFloat($("#restHours").val()) || 10;
	const hoursPerDay = 24 - restHours;
	const days = travelHours / hoursPerDay;
	return days * 24;
}

function buildRouteResultFromSelectedLocations(useShortest) {
	let routeNodeNames = [],
		segments = [];
	for (let i = 0; i < selectedLocations.length - 1; i++) {
		const start = selectedLocations[i].name,
			end = selectedLocations[i + 1].name,
			route = calculateRouteClientLegacy(start, end, useShortest);
		console.log("Berechnete Route:", route);
		if (route.length) {
			if (!routeNodeNames.length) {
				routeNodeNames.push(route[0].from);
			}
			route.forEach((routeStep) => {
				routeNodeNames.push(routeStep.to);
			});
			segments = [...segments, ...getRouteSegments(route)];
		} else {
			alert(`Keine Route zwischen ${start} und ${end} gefunden.`);
			return null;
		}
	}

	return { routeNodeNames, segments };
}
