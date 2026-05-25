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

function shouldProbeServerRouting() {
	return new URLSearchParams(window.location.search).get("serverrouting") === "1";
}

function buildServerRouteProbeRequest(start, end, useShortest, clientRoute) {
	const routeOptions = buildRouteOptionsFromPlannerControls();
	const clientRouteSteps = Array.isArray(clientRoute) ? clientRoute.map((routeStep) => ({
		from: String(routeStep?.from || ""),
		to: String(routeStep?.to || ""),
		connection_id: String(routeStep?.connectionId || ""),
	})).filter((routeStep) => routeStep.from && routeStep.to && routeStep.connection_id) : [];
	return {
		from: start,
		to: end,
		via: [],
		optimize: useShortest ? "shortest" : "fastest",
		include_air_distance: true,
		include_geometry: true,
		include_steps: true,
		include_rests: $("#includeRests").is(":checked"),
		rest_hours_per_day: parseFloat($("#restHours").val()) || 0,
		minimize_transfers: $("#minimizeTransfers").is(":checked"),
		transports: {
			land: routeOptions.landOption,
			river: routeOptions.riverOption,
			sea: routeOptions.seaOption,
			synthetic: routeOptions.landOption,
		},
		client_route: clientRouteSteps,
	};
}

function probeServerRouteForClientSegment(start, end, useShortest, clientRoute) {
	if (!shouldProbeServerRouting()) {
		return;
	}
	if (typeof calculateRouteServer !== "function") {
		console.warn("Server-Routing-Probe uebersprungen: calculateRouteServer ist nicht verfuegbar.");
		return;
	}

	const clientSegmentCount = Array.isArray(clientRoute) ? clientRoute.length : 0;
	const clientConnectionIds = Array.isArray(clientRoute) ? clientRoute.map((routeStep) => String(routeStep?.connectionId || "")).filter(Boolean) : [];
	const serverRouteRequest = buildServerRouteProbeRequest(start, end, useShortest, clientRoute);
	console.log("Server-Routing-Probe gestartet:", { from: start, to: end, client_segments: clientSegmentCount });
	console.log("Server-Routing-Probe Client-IDs:", clientConnectionIds);
	console.log("Server-Routing-Probe Request:", serverRouteRequest);
	void calculateRouteServer(serverRouteRequest)
		.then((serverRouteResult) => {
			const serverRoute = serverRouteResult?.route || serverRouteResult || {};
			const serverSummary = serverRoute.summary || {};
			const serverSegments = Array.isArray(serverRoute.segments) ? serverRoute.segments : [];
			const rawDebug = serverRouteResult?.raw?.route?.debug || {};
			const rawContext = rawDebug.context || {};
			const parity = rawContext.client_route_on_server_graph || {};
			const missingSegments = Array.isArray(parity.missing_segments) ? parity.missing_segments : [];
			const serverCodeRevision = Number(rawDebug.api_code_revision || serverRoute.debug?.api_code_revision || 0);
			const mapRevision = Number(rawDebug.map_revision || serverRoute.debug?.map_revision || 0);
			const serverEdgeIds = Array.isArray(serverRoute.debug?.edge_ids)
				? serverRoute.debug.edge_ids
				: serverSegments.map((segment) => String(segment?.edge_id || "")).filter(Boolean);
			console.log("Server-Routing-Probe Vergleich:", {
				from: start,
				to: end,
				client_segments: clientSegmentCount,
				server_edges: Number(serverSummary.edge_count) || 0,
				server_nodes: Number(serverSummary.node_count) || 0,
				server_cost: Number(serverRoute.cost) || 0,
				server_found: Boolean(serverRoute.found),
				api_code_revision: serverCodeRevision,
				map_revision: mapRevision,
				network_path_count: Number(rawDebug.network_path_count) || 0,
				client_graph_path_feature_count: Number(rawDebug.client_graph_path_feature_count) || 0,
			});
			console.log("Server-Routing-Probe Paritaet:", {
				api_code_revision: serverCodeRevision,
				map_revision: mapRevision,
				network_path_count: Number(rawDebug.network_path_count) || 0,
				client_graph_path_feature_count: Number(rawDebug.client_graph_path_feature_count) || 0,
				client_route_received: Number(parity.received_segment_count) || 0,
				client_route_matched: Number(parity.matched_segment_count) || 0,
				client_route_missing: Number(parity.missing_segment_count) || 0,
				client_route_cost_on_server: Number(parity.cost) || 0,
				server_winner_cost: Number(parity.server_winner_cost) || Number(serverRoute.cost) || 0,
				cost_delta_server_minus_client_route: Number(parity.cost_delta_server_minus_client_route) || 0,
				all_client_edges_found: Boolean(parity.all_client_edges_found),
			});
			console.log("Server-Routing-Probe Fehlende Client-Segmente:", missingSegments);
			console.log("Server-Routing-Probe Fehlende Client-Segmente JSON:", JSON.stringify(missingSegments, null, 2));
			console.log("Server-Routing-Probe Server-IDs:", serverEdgeIds);
			console.log("Server-Routing-Probe Server-Segmente:", serverSegments);
			console.log("Server-Routing-Probe Ergebnis:", serverRouteResult);
		})
		.catch((error) => {
			console.warn("Server-Routing-Probe fehlgeschlagen:", error);
		});
}

function buildRouteResultFromSelectedLocations(useShortest) {
	let routeNodeNames = [],
		segments = [];
	for (let i = 0; i < selectedLocations.length - 1; i++) {
		const start = selectedLocations[i].name,
			end = selectedLocations[i + 1].name,
			route = calculateRouteClientLegacy(start, end, useShortest);
		probeServerRouteForClientSegment(start, end, useShortest, route);
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
