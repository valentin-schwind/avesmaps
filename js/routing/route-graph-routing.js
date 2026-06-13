
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

function addRegularPathToGraph(graph, pathFeature, routeOptions) {
    const { geometry: { coordinates }, properties } = pathFeature;
    const startNode = getLocationAtPathEndpoint(coordinates[0]);
    const endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1]);
    if (startNode && endNode) {
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
        const connection = { distance, time: distance / speed, routeType, id: properties.id, transportOption };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
    }
}

// Erzeugt einen gewichteten Graphen aus den Locations und Pfaden
function createGraph(routeOptions) {
    syntheticPathSegments.clear();
    const graph = {};
    locationData.forEach((location) => {
        graph[location.name] = {};
    });
    pathData.forEach((pathFeature) => {
        addRegularPathToGraph(graph, pathFeature, routeOptions);
    });
    connectDetachedGraphComponents(graph, routeOptions);

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
