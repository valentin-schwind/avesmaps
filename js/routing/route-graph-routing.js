
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

// Knoten-Koordinaten-Index: Location an gerundeter Koordinate, fuer O(1)-Lookups beim Weg-Splitten.
// Schluessel = "lng:lat" (5 Nachkommastellen). Pfad-Vertex ist [x,y]=[lng,lat], location.coordinates=[lat,lng].
function routeNodeCoordinateKey(x, y) {
    return `${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
}

function buildRouteNodeCoordinateIndex() {
    const index = new Map();
    locationData.forEach((location) => {
        const coords = location?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) {
            return;
        }
        const key = routeNodeCoordinateKey(coords[1], coords[0]);
        if (!index.has(key)) {
            index.set(key, location);
        }
    });
    return index;
}

function getRouteNodeAtPathVertex(nodeIndex, vertex) {
    if (!nodeIndex || !Array.isArray(vertex) || vertex.length < 2) {
        return null;
    }
    return nodeIndex.get(routeNodeCoordinateKey(vertex[0], vertex[1])) || null;
}

// Teil-Kanten-Geometrie (Slice eines gesplitteten Weges) als Feature ablegen. Der Renderer
// (getRouteSegments) loest eine connectionId ueber pathData ODER syntheticPathSegments auf -> die
// Slices kommen daher in dieselbe Map (eindeutige id "<pfad>#<n>", kein synthetic-Flag).
function buildRoutePathSliceSegment(sliceCoordinates, segmentId, properties) {
    return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: sliceCoordinates },
        properties: { ...properties, id: segmentId },
    };
}

function addRegularPathToGraph(graph, pathFeature, routeOptions, nodeIndex) {
    const { geometry: { coordinates }, properties } = pathFeature;
    const startNode = getLocationAtPathEndpoint(coordinates[0]);
    const endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1]);
    if (!startNode || !endNode) {
        return;
    }
    const routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name);
    const transportOption = getTransportOptionForRouteType(routeType, routeOptions);
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

    // Knoten-Stuetzpunkte des Weges: Start + INNERE Stuetzpunkte, die exakt auf einer Kreuzung/Siedlung
    // liegen (vom "Straße weiterführen"-Button als Vertex angehaengt) + Ende. So kann der Router an einer
    // mitten auf dem Weg liegenden Kreuzung abbiegen, OHNE den Weg in den Daten zu teilen.
    const nodeVertices = [{ index: 0, location: startNode }];
    for (let index = 1; index < coordinates.length - 1; index++) {
        const location = getRouteNodeAtPathVertex(nodeIndex, coordinates[index]);
        if (location && location.name !== nodeVertices[nodeVertices.length - 1].location.name) {
            nodeVertices.push({ index, location });
        }
    }
    nodeVertices.push({ index: coordinates.length - 1, location: endNode });

    if (nodeVertices.length <= 2) {
        // Kein innerer Knoten -> eine Kante wie bisher (id = Pfad-id; Renderer findet sie in pathData).
        const distance = calculatePathCoordinateDistance(coordinates);
        const connection = { distance, time: distance / speed, routeType, id: properties.id, transportOption };
        addGraphConnection(graph, startNode.name, endNode.name, connection);
        addGraphConnection(graph, endNode.name, startNode.name, connection);
        return;
    }

    // An jedem inneren Knoten in Teil-Kanten splitten; jede Teil-Kante traegt ihre eigene Slice-Geometrie.
    for (let segment = 0; segment < nodeVertices.length - 1; segment++) {
        const fromVertex = nodeVertices[segment];
        const toVertex = nodeVertices[segment + 1];
        if (fromVertex.location.name === toVertex.location.name) {
            continue;
        }
        const sliceCoordinates = coordinates.slice(fromVertex.index, toVertex.index + 1);
        if (sliceCoordinates.length < 2) {
            continue;
        }
        const distance = calculatePathCoordinateDistance(sliceCoordinates);
        const segmentId = `${properties.id}#${segment}`;
        const connection = { distance, time: distance / speed, routeType, id: segmentId, transportOption };
        addGraphConnection(graph, fromVertex.location.name, toVertex.location.name, connection);
        addGraphConnection(graph, toVertex.location.name, fromVertex.location.name, connection);
        syntheticPathSegments.set(segmentId, buildRoutePathSliceSegment(sliceCoordinates, segmentId, properties));
    }
}

// Erzeugt einen gewichteten Graphen aus den Locations und Pfaden
function createGraph(routeOptions) {
    syntheticPathSegments.clear();
    const graph = {};
    locationData.forEach((location) => {
        graph[location.name] = {};
    });
    const nodeIndex = buildRouteNodeCoordinateIndex();
    pathData.forEach((pathFeature) => {
        addRegularPathToGraph(graph, pathFeature, routeOptions, nodeIndex);
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
