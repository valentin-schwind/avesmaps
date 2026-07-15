
/******************************************************************
 * Dijkstra-Algorithmus mit optimierter PriorityQueue
 ******************************************************************/
const TRANSFER_PENALTY = 100;
const USE_SERVER_ROUTING = false;

function calculateRouteClientLegacy(startName, endName, useShortestPath = true) {
    const minimizeTransfers = $("#minimizeTransfers").is(":checked");
    return calculateRouteCore(
        graphData,
        startName,
        endName,
        useShortestPath,
        minimizeTransfers,
        TRANSFER_PENALTY,
        getTransportOption
    );
}

async function calculateRouteClient(routeRequest) {
    return calculateRouteClientLegacy(
        routeRequest?.from || "",
        routeRequest?.to || "",
        routeRequest?.optimize === "shortest"
    );
}

// calculateRouteByMode(...) is prepared for future server routing integration.
// Current UI flow still uses calculateRouteClientLegacy(...) because server routing is async and not RouteResult-compatible yet.
async function calculateRouteByMode(routeRequest) {
    if (USE_SERVER_ROUTING) {
        return await calculateRouteServer(routeRequest);
    }

    return await calculateRouteClient(routeRequest);
}

function getSyntheticRouteConfig(routeOptions) {
    const transportOption = getTransportOptionForRouteType(SYNTHETIC_ROUTE_TYPE, routeOptions);
    const speed = resolveSpeedForRouteType(SYNTHETIC_ROUTE_TYPE, transportOption);
    if (!transportOption || !speed) {
        return null;
    }

    return { routeType: SYNTHETIC_ROUTE_TYPE, speed };
}

function connectDetachedGraphComponents(graph, routeOptions) {
    const components = findGraphComponents(graph).sort((a, b) => b.nodeNames.length - a.nodeNames.length);
    if (components.length <= 1) {
        return;
    }

    const routeConfig = getSyntheticRouteConfig(routeOptions);
    if (!routeConfig) {
        console.warn("Querfeldein-Verbindungen werden übersprungen, weil kein Land-Transportmittel aktiv ist.");
        return;
    }

    const locationLookup = createLocationLookup();
    const anchorNodeNames = components[0].nodeNames;
    const detachedComponents = components.slice(1);
    let syntheticConnectionCount = 0;

    detachedComponents.forEach((component) => {
        const nearestConnection = findNearestComponentConnection(component, anchorNodeNames, locationLookup);
        if (!nearestConnection) {
            return;
        }

        addSyntheticGraphConnection(
            graph,
            nearestConnection.fromLocation,
            nearestConnection.toLocation,
            nearestConnection.distance,
            routeConfig
        );
        syntheticConnectionCount++;
    });

    if (syntheticConnectionCount) {
        console.info(`${syntheticConnectionCount} Querfeldein-Verbindungen für getrennte Orte hinzugefügt.`);
    }
}

// Normalized river-flow time factors for a path feature (properties.flow, spec §2/§4).
// Null unless routeType is Flussweg and flow.dir is valid. forwardFactor applies to the
// start->end edge (stored drawing order), backwardFactor to end->start; the upstream
// direction costs time * factor, downstream keeps the plain time. Mirrors the server's
// avesmapsRouteClientNormalizeFlow (api/_internal/routing/client-graph.php).
function getRiverFlowTimeFactors(properties, routeType) {
    if (routeType !== "Flussweg") {
        return null;
    }
    const flow = properties?.flow;
    const dir = flow?.dir;
    if (dir !== "forward" && dir !== "reverse") {
        return null;
    }
    const rawFactor = Number(flow?.factor);
    const factor = Number.isFinite(rawFactor) ? Math.min(3.0, Math.max(1.0, rawFactor)) : 1.5;
    return {
        forwardFactor: dir === "reverse" ? factor : 1,
        backwardFactor: dir === "forward" ? factor : 1,
    };
}

function addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptions = {}) {
    const { geometry: { coordinates }, properties } = pathFeature;
    const startNode = getLocationAtPathEndpoint(coordinates[0]);
    const endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1]);
    if (!startNode || !endNode) {
        return;
    }

    if (graphOptions.transports === "all") {
        // Connectivity-only graph (unconnected-marker feature, docs/superpowers/specs/2026-07-15-
        // unverbundene-orte-marker-design.md): an edge exists whenever the path allows ANY transport,
        // independent of the planner's current selection. getPathAllowedTransports already encodes
        // exactly this rule (explicit allowed_transports, domain default, Wuestenpfad/horseCarriage
        // exclusion) -- an empty list ("unbefahrbar") correctly yields no edge (spec Kanten-Randfall).
        if (!getPathAllowedTransports(pathFeature).length) {
            return;
        }
        const connection = { routeType: normalizePathSubtype(properties?.feature_subtype || properties?.name), id: properties.id };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
        return;
    }

    const distance = calculatePathCoordinateDistance(coordinates),
        routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name),
        transportOption = getTransportOptionForRouteType(routeType, routeOptions);
    if (!transportOption) {
        console.warn(`Keine Transportoption für ${routeType} gefunden. Pfad wird übersprungen.`);
        return;
    }
    if (!isTransportAllowedForPath(properties, transportOption)) {
        return;
    }
    const speed = resolveSpeedForRouteType(routeType, transportOption);
    if (!speed) {
        console.warn(`Geschwindigkeit für ${transportOption} auf ${routeType} nicht definiert. Pfad wird übersprungen.`);
        return;
    }
    const baseTime = distance / speed;
    const flowFactors = getRiverFlowTimeFactors(properties, routeType);
    if (!flowFactors) {
        // No known flow direction: symmetric shared connection, exactly today's behaviour.
        const connection = { distance, time: baseTime, routeType, id: properties.id, transportOption };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
        return;
    }
    // Asymmetric river edge (spec §4): the start->end edge follows the stored drawing
    // order; upstream legs cost time * factor, downstream stays the plain time.
    addGraphConnection(graph, startNode.name, endNode.name, {
        distance, time: baseTime * flowFactors.forwardFactor, routeType, id: properties.id,
        transportOption, flowTimeFactor: flowFactors.forwardFactor,
    });
    addGraphConnection(graph, endNode.name, startNode.name, {
        distance, time: baseTime * flowFactors.backwardFactor, routeType, id: properties.id,
        transportOption, flowTimeFactor: flowFactors.backwardFactor,
    });
}

// Erzeugt einen gewichteten Graphen aus den Locations und Pfaden.
// graphOptions.transports === "all" + graphOptions.skipSyntheticConnections: the connectivity-only
// variant used by the unconnected-marker feature (getUnconnectedLocationPublicIds below). Default args
// (no graphOptions) reproduce today's routing-graph behaviour exactly.
function createGraph(routeOptions, graphOptions = {}) {
    syntheticPathSegments.clear();
    const graph = {};
    locationData.forEach((location) => {
        graph[location.name] = {};
    });
    pathData.forEach((pathFeature) => {
        addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptions);
    });
    if (!graphOptions.skipSyntheticConnections) {
        connectDetachedGraphComponents(graph, routeOptions);
    }

    const unconnectedNames = Object.keys(graph).filter((locName) => !Object.keys(graph[locName]).length);
    if (unconnectedNames.length) {
        console.warn(`${unconnectedNames.length} Locations sind nicht verbunden:\n${unconnectedNames.join("\n")}`);
    }
    return graph;
}

function getVisualLatLngCoordinates(latLngs) {
    const coordinates = latLngs.map((latLng) => {
        const normalizedLatLng = L.latLng(latLng);
        return [normalizedLatLng.lng, normalizedLatLng.lat];
    });
    return smoothLineCoordinatesForDisplay(coordinates).map(([x, y]) => [y, x]);
}
