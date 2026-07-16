
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
        // unverbundene-orte-marker-design.md): EVERY drawn path is an edge -- no transport filtering
        // at all, neither the planner's current selection nor the path's own allowed_transports.
        // The spec's original Kanten-Randfall (unbefahrbar = unverbunden) was dropped by the Owner
        // on 2026-07-16: river sources are drawn but impassable ("zu wilde Stroemung"), and flagging
        // them as unverbunden is a false positive. The tool hunts MISSING ways, not impassable ones.
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

// How many WAYS meet at a node -- the number of drawn paths, NOT the number of neighbours: two
// separate paths between the same pair are two ways but one neighbour, and the sparse-crossing
// marker must count them as two (a crossing joining two ways is redundant, whichever way they run).
function countGraphNodePathEdges(graph, nodeName) {
    const neighbours = graph[nodeName];
    if (!neighbours) {
        return 0;
    }
    return Object.values(neighbours).reduce((total, connections) => total + connections.length, 0);
}

// The editor's two marker tools (docs/superpowers/specs/2026-07-15-unverbundene-orte-marker-design.md,
// Discord #25) share ONE pass over ONE connectivity graph -- building it twice for ~5200 paths would
// be pure waste when both checkboxes are on:
//   unconnected     -- 0 drawn ways AND not a powerline endpoint (an Anbindungsluecke).
//   sparseCrossings -- a Kreuzung with <= SPARSE_CROSSING_MAX_WAYS ways (a redundant node: a real
//                      crossing joins at least three). Powerlines don't count here -- a Kreuzung is
//                      a way node, and Kraftlinien only ever attach to Nodices.
// Cached in locationConnectivityIndex (js/app/runtime-state.js); invalidated in
// refreshPlannerAfterFeatureChange (js/routing/route-render.js) plus the two powerline mutation
// sites that don't flow through it.
function computeLocationConnectivityIndex() {
    const connectivityGraph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
    const powerlineConnectedPublicIds = getPowerlineConnectedLocationPublicIds();
    const unconnected = new Set();
    const sparseCrossings = new Set();
    locationData.forEach((location) => {
        if (!location.publicId) {
            return;
        }
        const wayCount = countGraphNodePathEdges(connectivityGraph, location.name);
        if (!wayCount && !powerlineConnectedPublicIds.has(location.publicId)) {
            unconnected.add(location.publicId);
        }
        if (isCrossingLocation(location) && wayCount <= SPARSE_CROSSING_MAX_WAYS) {
            sparseCrossings.add(location.publicId);
        }
    });
    return { unconnected, sparseCrossings };
}

function getLocationConnectivityIndex() {
    if (!locationConnectivityIndex) {
        locationConnectivityIndex = computeLocationConnectivityIndex();
    }
    return locationConnectivityIndex;
}

function getUnconnectedLocationPublicIds() {
    return getLocationConnectivityIndex().unconnected;
}

function getSparseCrossingPublicIds() {
    return getLocationConnectivityIndex().sparseCrossings;
}

function getVisualLatLngCoordinates(latLngs) {
    const coordinates = latLngs.map((latLng) => {
        const normalizedLatLng = L.latLng(latLng);
        return [normalizedLatLng.lng, normalizedLatLng.lat];
    });
    return smoothLineCoordinatesForDisplay(coordinates).map(([x, y]) => [y, x]);
}
