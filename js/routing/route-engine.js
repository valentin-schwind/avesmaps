function getRouteSegments(route) {
	return route
		.map(({ connectionId }) => {
			const segment = pathData.find((p) => p.properties.id === connectionId) || syntheticPathSegments.get(connectionId);
			if (!segment) console.warn(`Kein Segment gefunden für Verbindung ${connectionId}`);
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
	const restHoursParsed = parseFloat($("#restHours").val());
	const restHours = Number.isFinite(restHoursParsed) ? restHoursParsed : 10;
	const hoursPerDay = 24 - restHours;
	const days = travelHours / hoursPerDay;
	return days * 24;
}

function shouldProbeServerRouting() {
	return new URLSearchParams(window.location.search).get("serverrouting") === "1";
}

function shouldUseServerPrimaryRouting() {
	return new URLSearchParams(window.location.search).get("clientrouting") !== "1";
}

function getRouteServerEndpointUrl() {
	return window.AVESMAPS_ROUTE_ENDPOINT || "api/route/";
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
		enabled_transports: {
			land: Boolean(routeOptions.allowLand),
			river: Boolean(routeOptions.allowRiver),
			sea: Boolean(routeOptions.allowSea),
			synthetic: Boolean(routeOptions.allowLand),
		},
		transports: {
			land: routeOptions.landOption || "groupFoot",
			river: routeOptions.riverOption || "riverSailer",
			sea: routeOptions.seaOption || "cargoShip",
			synthetic: routeOptions.landOption || "groupFoot",
		},
		client_route: clientRouteSteps,
	};
}

async function calculateRouteServer(request) {
	// Ladebalken oben waehrend der (async) Server-Routenberechnung -- deckt jeden Einstieg ab, der hierher
	// fuehrt. inc vor dem Fetch, dec garantiert im finally (auch bei Netzwerk-/Parse-Fehlern -> kein Haenger).
	if (window.AvesmapsLoadingBar) {
		window.AvesmapsLoadingBar.inc("route");
	}
	try {
		return await calculateRouteServerImpl(request);
	} finally {
		if (window.AvesmapsLoadingBar) {
			window.AvesmapsLoadingBar.dec("route");
		}
	}
}

async function calculateRouteServerImpl(request) {
	const response = await fetch(getRouteServerEndpointUrl(), {
		method: "POST",
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request || {}),
	});
	const data = await readJsonResponse(response, {});
	if (!response.ok || data?.ok !== true) {
		const errorMessage = data?.error?.message || data?.error || `Routing-API antwortet mit HTTP ${response.status}.`;
		throw new Error(errorMessage);
	}

	const route = data.route || {};
	return {
		source: "server",
		ok: true,
		found: Boolean(route.found),
		from: String(route.from || request?.from || ""),
		to: String(route.to || request?.to || ""),
		cost: Number(route.cost) || 0,
		summary: route.summary || {},
		debug: route.debug || {},
		segments: Array.isArray(route.segments) ? route.segments : [],
		route,
		raw: data,
	};
}

function getServerRouteDebug(serverRouteResult) {
	return serverRouteResult?.route?.debug || serverRouteResult?.debug || serverRouteResult?.raw?.route?.debug || {};
}

function getServerRouteSummary(serverRouteResult) {
	return serverRouteResult?.route?.summary || serverRouteResult?.summary || {};
}

function getServerRouteSegments(serverRouteResult) {
	return Array.isArray(serverRouteResult?.route?.segments)
		? serverRouteResult.route.segments
		: Array.isArray(serverRouteResult?.segments) ? serverRouteResult.segments : [];
}

function getServerSegmentId(serverSegment) {
	return String(serverSegment?.edge_id || serverSegment?.path_id || serverSegment?.id || "");
}

function getServerSegmentNodeNames(serverRouteResult) {
	const nodeNames = [];
	const serverSegments = getServerRouteSegments(serverRouteResult);
	serverSegments.forEach((segment, index) => {
		const fromNode = String(segment?.from_node || segment?.from || "");
		const toNode = String(segment?.to_node || segment?.to || "");
		if (index === 0 && fromNode) {
			nodeNames.push(fromNode);
		}
		if (toNode) {
			nodeNames.push(toNode);
		}
	});
	return nodeNames;
}

function getServerRouteNodeIds(serverRouteResult) {
	const segmentNodeNames = getServerSegmentNodeNames(serverRouteResult);
	if (segmentNodeNames.length) {
		return segmentNodeNames;
	}

	const debug = getServerRouteDebug(serverRouteResult);
	if (Array.isArray(debug.node_ids) && debug.node_ids.length) {
		return debug.node_ids.map((nodeId) => String(nodeId || "")).filter(Boolean);
	}

	return [];
}

function getServerRouteEdgeIds(serverRouteResult) {
	const debug = getServerRouteDebug(serverRouteResult);
	if (Array.isArray(debug.edge_ids) && debug.edge_ids.length) {
		return debug.edge_ids.map((edgeId) => String(edgeId || "")).filter(Boolean);
	}

	return getServerRouteSegments(serverRouteResult).map(getServerSegmentId).filter(Boolean);
}

function findRouteLocationByName(locationName) {
	const normalizedName = normalizeLocationSearchName(locationName);
	return locationData.find((location) => normalizeLocationSearchName(location.name) === normalizedName) || null;
}

function clonePathSegmentForServerRoute(pathSegment, serverSegment) {
	const subtype = normalizePathSubtype(serverSegment?.subtype || pathSegment?.properties?.feature_subtype || pathSegment?.properties?.name || "Weg");
	return {
		...pathSegment,
		geometry: {
			...(pathSegment.geometry || {}),
			coordinates: Array.isArray(pathSegment.geometry?.coordinates)
				? pathSegment.geometry.coordinates.map((coordinate) => Array.isArray(coordinate) ? [...coordinate] : coordinate)
				: [],
		},
		properties: {
			...(pathSegment.properties || {}),
			id: getServerSegmentId(serverSegment) || String(pathSegment.properties?.id || ""),
			feature_subtype: subtype,
			name: subtype,
			transportOption: String(serverSegment?.transport_type || serverSegment?.transport_option || "") || pathSegment.properties?.transportOption || getTransportOption(subtype),
			synthetic: Boolean(pathSegment.properties?.synthetic),
		},
	};
}

function buildSyntheticServerRouteSegment(serverSegment, nodeIds, segmentIndex) {
	const fromName = String(serverSegment?.from_node || serverSegment?.from || nodeIds[segmentIndex] || "");
	const toName = String(serverSegment?.to_node || serverSegment?.to || nodeIds[segmentIndex + 1] || "");
	const fromLocation = findRouteLocationByName(fromName);
	const toLocation = findRouteLocationByName(toName);
	if (!fromLocation || !toLocation) {
		return null;
	}

	return {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[fromLocation.coordinates[1], fromLocation.coordinates[0]],
				[toLocation.coordinates[1], toLocation.coordinates[0]],
			],
		},
		properties: {
			id: getServerSegmentId(serverSegment) || `synthetic-${fromName}->${toName}`,
			name: SYNTHETIC_ROUTE_TYPE,
			feature_subtype: SYNTHETIC_ROUTE_TYPE,
			transportOption: String(serverSegment?.transport_type || serverSegment?.transport_option || "") || getTransportOption(SYNTHETIC_ROUTE_TYPE),
			synthetic: true,
		},
	};
}

function buildServerGeometryRouteSegment(serverSegment, coordinates) {
	const subtype = normalizePathSubtype(serverSegment?.subtype || serverSegment?.route_type || "Weg");
	return {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: coordinates.map((coordinate) => Array.isArray(coordinate) ? [...coordinate] : coordinate),
		},
		properties: {
			id: getServerSegmentId(serverSegment) || "",
			name: subtype,
			feature_subtype: subtype,
			transportOption: String(serverSegment?.transport_type || serverSegment?.transport_option || "") || getTransportOption(subtype),
			synthetic: Boolean(serverSegment?.synthetic),
		},
	};
}

function resolveServerRouteDisplaySegment(serverSegment, nodeIds, segmentIndex) {
	const edgeId = getServerSegmentId(serverSegment);
	if (!edgeId) {
		console.warn("Serverroute: Segment ohne ID:", serverSegment);
		return null;
	}

	if (serverSegment?.synthetic || edgeId.startsWith("synthetic-")) {
		return buildSyntheticServerRouteSegment(serverSegment, nodeIds, segmentIndex);
	}

	// Prefer the geometry the server sent for THIS segment (a slice for split sub-edges). Resolving
	// by feature_id alone would return the whole parent path -- drawn once per sub-edge, inflating
	// the distance and collapsing the stage list.
	const serverSegmentCoordinates = Array.isArray(serverSegment?.geometry?.coordinates) ? serverSegment.geometry.coordinates : [];
	if (serverSegmentCoordinates.length >= 2) {
		return buildServerGeometryRouteSegment(serverSegment, serverSegmentCoordinates);
	}

	const featureId = String(serverSegment?.feature_id || "");
	const publicId = String(serverSegment?.public_id || "");
	const localPathSegment = pathData.find((path) =>
		String(path.properties?.id || "") === edgeId
		|| String(path.id || "") === edgeId
		|| String(path.id || "") === featureId
		|| String(path.properties?.public_id || "") === publicId
		|| String(path.properties?.public_id || "") === featureId
	);
	if (!localPathSegment) {
		console.warn("Serverroute: lokales Segment nicht gefunden:", serverSegment);
		return null;
	}

	return clonePathSegmentForServerRoute(localPathSegment, serverSegment);
}

function normalizeServerDisplayRouteEndpoints(routeNodeNames, explicitStartName, explicitEndName, segmentCount) {
	const normalizedRouteNodeNames = Array.isArray(routeNodeNames) ? [...routeNodeNames] : [];
	while (normalizedRouteNodeNames.length < segmentCount + 1) {
		normalizedRouteNodeNames.push("");
	}
	if (explicitStartName) {
		normalizedRouteNodeNames[0] = explicitStartName;
	}
	if (explicitEndName) {
		normalizedRouteNodeNames[segmentCount] = explicitEndName;
	}
	return normalizedRouteNodeNames;
}

function buildRouteResultFromServerRoute(serverRouteResult, explicitStartName = "", explicitEndName = "") {
	const serverSegments = getServerRouteSegments(serverRouteResult);
	const initialRouteNodeNames = getServerRouteNodeIds(serverRouteResult);
	const routeNodeNames = normalizeServerDisplayRouteEndpoints(initialRouteNodeNames, explicitStartName, explicitEndName, serverSegments.length);
	const segments = serverSegments
		.map((serverSegment, segmentIndex) => resolveServerRouteDisplaySegment(serverSegment, routeNodeNames, segmentIndex))
		.filter(Boolean);

	return { routeNodeNames, segments };
}

function logServerRouteProbeResult(start, end, clientRoute, serverRouteRequest, serverRouteResult) {
	if (!shouldProbeServerRouting()) {
		return;
	}

	const clientSegmentCount = Array.isArray(clientRoute) ? clientRoute.length : 0;
	const clientConnectionIds = Array.isArray(clientRoute) ? clientRoute.map((routeStep) => String(routeStep?.connectionId || "")).filter(Boolean) : [];
	const serverRoute = serverRouteResult?.route || serverRouteResult || {};
	const serverSummary = getServerRouteSummary(serverRouteResult);
	const serverSegments = getServerRouteSegments(serverRouteResult);
	const rawDebug = serverRouteResult?.raw?.route?.debug || getServerRouteDebug(serverRouteResult);
	const rawContext = rawDebug.context || {};
	const parity = rawContext.client_route_on_server_graph || {};
	const missingSegments = Array.isArray(parity.missing_segments) ? parity.missing_segments : [];
	const serverCodeRevision = Number(rawDebug.api_code_revision || serverRoute.debug?.api_code_revision || 0);
	const mapRevision = Number(rawDebug.map_revision || serverRoute.debug?.map_revision || 0);
	const serverEdgeIds = getServerRouteEdgeIds(serverRouteResult);
	console.log("Server-Routing-Probe gestartet:", { from: start, to: end, client_segments: clientSegmentCount });
	console.log("Server-Routing-Probe Client-IDs:", clientConnectionIds);
	console.log("Server-Routing-Probe Request:", serverRouteRequest);
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
}

function probeServerRouteForClientSegment(start, end, useShortest, clientRoute) {
	if (!shouldProbeServerRouting()) {
		return;
	}
	if (typeof calculateRouteServer !== "function") {
		console.warn("Server-Routing-Probe übersprungen: calculateRouteServer ist nicht verfügbar.");
		return;
	}

	const serverRouteRequest = buildServerRouteProbeRequest(start, end, useShortest, clientRoute);
	void calculateRouteServer(serverRouteRequest)
		.then((serverRouteResult) => logServerRouteProbeResult(start, end, clientRoute, serverRouteRequest, serverRouteResult))
		.catch((error) => {
			console.warn("Server-Routing-Probe fehlgeschlagen:", error);
		});
}

async function buildRouteResultFromSelectedLocationsServer(useShortest) {
	let routeNodeNames = [],
		segments = [];

	for (let index = 0; index < selectedLocations.length - 1; index += 1) {
		const start = selectedLocations[index].name;
		const end = selectedLocations[index + 1].name;
		const clientRoute = shouldProbeServerRouting() ? calculateRouteClientLegacy(start, end, useShortest) : [];
		const serverRouteRequest = buildServerRouteProbeRequest(start, end, useShortest, clientRoute);
		const serverRouteResult = await calculateRouteServer(serverRouteRequest);
		logServerRouteProbeResult(start, end, clientRoute, serverRouteRequest, serverRouteResult);

		if (!serverRouteResult.found) {
			alert(`Keine Route zwischen ${start} und ${end} gefunden.`);
			return null;
		}

		const serverDisplayRoute = buildRouteResultFromServerRoute(serverRouteResult, start, end);
		if (!serverDisplayRoute.routeNodeNames.length || !serverDisplayRoute.segments.length) {
			console.warn("Serverroute konnte nicht angezeigt werden:", {
				serverRouteResult,
				routeNodeNames: serverDisplayRoute.routeNodeNames,
				segments: serverDisplayRoute.segments,
			});
			alert(`Die Serverroute zwischen ${start} und ${end} konnte nicht angezeigt werden.`);
			return null;
		}

		if (!routeNodeNames.length) {
			routeNodeNames = [...serverDisplayRoute.routeNodeNames];
		} else {
			routeNodeNames = [...routeNodeNames, ...serverDisplayRoute.routeNodeNames.slice(1)];
		}
		segments = [...segments, ...serverDisplayRoute.segments];
	}

	return { routeNodeNames, segments };
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

async function updateMapViewServerPrimary() {
	const requestId = (updateMapViewServerPrimary.requestId || 0) + 1;
	updateMapViewServerPrimary.requestId = requestId;
	const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
	const routeOptions = buildRouteOptionsFromPlannerControls();
	syncPlannerStateToUrl();
	if (!shouldUseServerPrimaryRouting()) {
		graphData = createGraph(routeOptions);
		return updateMapViewClientLegacy(useShortest, requestId);
	}

	graphData = null;
	resetRoutePresentation();
	collectAndValidateSelectedLocations();

	selectedLocations.forEach((loc) => {
		addTooltip(loc, {
			compact: false,
			showDescription: true,
			showWikiLink: true,
			showRemoveAction: true,
		});
	});

	console.log("Ausgewählte Locations:", selectedLocations);
	console.log("Ungültige Eingaben:", invalidLocationInputs);

	// Only frame the bare targets when there is NO route to draw. For an actual route (>=2 waypoints)
	// we skip this premature waypoint-only fit (hardcoded maxZoom 4) and zoom ONCE to the finished route
	// below via zoomToCurrentRoute -- the waypoint bounding box would mis-zoom AND clip the route's
	// curves that swing beyond the endpoints. This removes the visible double-zoom.
	if (selectedLocations.length < 2) {
		focusMapOnActiveTargets();
	}
	if (invalidLocationInputs.length) alert(`Orte nicht gefunden: ${invalidLocationInputs.join(", ")}`);

	if (selectedLocations.length >= 2) {
		$("#overview").text(tr("planner.overview.calculating", "Route wird berechnet..."));
		let routeResult = null;
		try {
			routeResult = await buildRouteResultFromSelectedLocationsServer(useShortest);
		} catch (error) {
			if (requestId !== updateMapViewServerPrimary.requestId) {
				return;
			}
			console.error("Serverroute konnte nicht berechnet werden:", error);
			alert(error.message || "Serverroute konnte nicht berechnet werden.");
			resetOverview();
			return;
		}

		if (requestId !== updateMapViewServerPrimary.requestId || !routeResult) {
			return;
		}

		const { routeNodeNames, segments } = routeResult;
		console.log("Komplette Route (Knoten):", routeNodeNames);
		console.log("Routensegmente:", segments);
		if (segments.length) {
			logRoutePoints(segments);
			drawRoute(segments);
			highlightRouteLocations(routeNodeNames, segments);
			showRoutePlan(routeNodeNames, segments);
			// Fit to the WHOLE rendered route -- the earlier focusMapOnActiveTargets() only framed the
			// waypoints (maxZoom 4). This fills the frame on the proper, route-aware zoom.
			zoomToCurrentRoute();
			if (typeof trackVisitorEvent === "function") {
				const wpNames = (selectedLocations || []).map((w) => (w && w.name ? String(w.name) : "Kartenpunkt"));
				wpNames.forEach((n) => trackVisitorEvent("route_waypoint", n));
				if (wpNames.length >= 2) {
					trackVisitorEvent("route", wpNames[0] + " → " + wpNames[wpNames.length - 1]);
				}
				trackVisitorEvent("route_option", useShortest ? "kürzeste" : "schnellste");
				if (routeOptions.landOption) { trackVisitorEvent("transport", String(routeOptions.landOption)); }
				if (routeOptions.riverOption) { trackVisitorEvent("transport", String(routeOptions.riverOption)); }
			}
		} else {
			alert("Keine gültigen Server-Routensegmente gefunden.");
			resetOverview();
		}
	}
}

function updateMapViewClientLegacy(useShortest, requestId) {
	resetRoutePresentation();
	collectAndValidateSelectedLocations();

	selectedLocations.forEach((loc) => {
		addTooltip(loc, {
			compact: false,
			showDescription: true,
			showWikiLink: true,
			showRemoveAction: true,
		});
	});

	console.log("Ausgewählte Locations:", selectedLocations);
	console.log("Ungültige Eingaben:", invalidLocationInputs);

	// Only frame the bare targets when there is NO route to draw. For an actual route (>=2 waypoints)
	// we skip this premature waypoint-only fit (hardcoded maxZoom 4) and zoom ONCE to the finished route
	// below via zoomToCurrentRoute -- the waypoint bounding box would mis-zoom AND clip the route's
	// curves that swing beyond the endpoints. This removes the visible double-zoom.
	if (selectedLocations.length < 2) {
		focusMapOnActiveTargets();
	}
	if (invalidLocationInputs.length) alert(`Orte nicht gefunden: ${invalidLocationInputs.join(", ")}`);

	if (selectedLocations.length >= 2) {
		const routeResult = buildRouteResultFromSelectedLocations(useShortest);
		if (!routeResult || requestId !== updateMapViewServerPrimary.requestId) {
			return;
		}
		let { routeNodeNames, segments } = routeResult;
		console.log("Komplette Route (Knoten):", routeNodeNames);
		console.log("Routensegmente:", segments);
		if (segments.length) {
			logRoutePoints(segments);
			drawRoute(segments);
			highlightRouteLocations(routeNodeNames, segments);
			showRoutePlan(routeNodeNames, segments);
			// Fit to the whole rendered route (not just the waypoints) so it fills the frame.
			zoomToCurrentRoute();
			if (typeof trackVisitorEvent === "function") {
				const wpNames = (selectedLocations || []).map((w) => (w && w.name ? String(w.name) : "Kartenpunkt"));
				wpNames.forEach((n) => trackVisitorEvent("route_waypoint", n));
				if (wpNames.length >= 2) {
					trackVisitorEvent("route", wpNames[0] + " → " + wpNames[wpNames.length - 1]);
				}
				const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
				trackVisitorEvent("route_option", useShortest ? "kürzeste" : "schnellste");
				const legacyRouteOptions = buildRouteOptionsFromPlannerControls();
				if (legacyRouteOptions.landOption) { trackVisitorEvent("transport", String(legacyRouteOptions.landOption)); }
				if (legacyRouteOptions.riverOption) { trackVisitorEvent("transport", String(legacyRouteOptions.riverOption)); }
			}
		} else {
			alert("Keine gültigen Routensegmente gefunden.");
		}
	}
}

function installServerPrimaryRouting() {
	if (window.__avesmapsServerPrimaryRoutingInstalled) {
		return;
	}

	window.__avesmapsServerPrimaryRoutingInstalled = true;
	window.setTimeout(() => {
		window.updateMapView = updateMapViewServerPrimary;
		try {
			updateMapView = updateMapViewServerPrimary;
		} catch (error) {
			console.warn("Server-Routing konnte updateMapView nicht ersetzen:", error);
		}
	}, 0);
}

installServerPrimaryRouting();
