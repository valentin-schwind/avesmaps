
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
    // Default 2.0 = the source's upstream/downstream ratio (S. 129: Kahn 20/40, Segler 30/60).
    // Mirrors AVESMAPS_PATH_FLOW_FACTOR_DEFAULT; the server owns the rule.
    // 🔴 NUR NOCH NACH UNTEN (31.08.2026, Owner: „ganz weg, nur noch >= 1"). Die 3,0 stand hier
    // als drittes Literal derselben Regel; ohne diese Zeile rechnete der Browser-Graph weiter mit
    // hoechstens 3,0, waehrend der Server dem eingestellten Wert folgte.
    const factor = Number.isFinite(rawFactor) ? Math.max(1.0, rawFactor) : 2.0;
    return {
        forwardFactor: dir === "reverse" ? factor : 1,
        backwardFactor: dir === "forward" ? factor : 1,
    };
}

// Zwilling zu avesmapsAddClientCompatiblePathConnection (api/_internal/routing/client-graph.php):
// derselbe round-5-Schluessel, damit Pruefhaken und Router dieselben Knoten sehen. Eine andere
// Rundung hier waere eine zweite Wahrheit ueber denselben Punkt.
function buildConnectivityCoordinateKey([x, y]) {
    return `${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
}

// ⚠️ Bei round-5-Kollision gewinnt der letzte Ort. Live sind das 5 Punkte, auf denen jeweils
// mehrere Kreuzungen exakt uebereinander liegen -- fuer die Armzahl ist das gleichgueltig, weil
// koinzidente Knoten ohnehin denselben Weg tragen.
function buildLocationCoordinateIndex() {
    const index = new Map();
    locationData.forEach((location) => {
        if (!Array.isArray(location?.coordinates)) {
            return;
        }
        const [lat, lng] = location.coordinates;
        index.set(buildConnectivityCoordinateKey([lng, lat]), location);
    });
    return index;
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
        const routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name);
        // 🔴 Knoten ENTLANG des Weges, nicht nur an seinen Enden: Start, jeder innere Stuetzpunkt,
        // der round-5 exakt auf einem Ort liegt, dann das Ende. Genau diese Bauform erzeugt der
        // Editor-Knopf „Ort verbinden und Strasse weiterfuehren" -- und sie war fuer den Pruefhaken
        // unsichtbar, waehrend der Router laengst dort abbiegt.
        const nodeNames = [startNode.name];
        const coordinateIndex = graphOptions.locationCoordinateIndex;
        if (coordinateIndex) {
            for (let index = 1; index < coordinates.length - 1; index++) {
                const hit = coordinateIndex.get(buildConnectivityCoordinateKey(coordinates[index]));
                // 💣 Zwilling der Wache in avesmapsAddClientCompatiblePathConnection (client-graph.php:204-207):
                // ein Stuetzpunkt, der auf denselben Ort faellt wie der zuletzt aufgenommene Knoten (z.B.
                // ein doppelt gezeichneter Vertex direkt am Start), wird NICHT ein zweites Mal angehaengt --
                // sonst zoege der Kantenbau unten eine Selbstkante und der Ort bekaeme zwei Phantomarme.
                if (hit && hit.name !== nodeNames[nodeNames.length - 1]) {
                    nodeNames.push(hit.name);
                }
            }
        }
        nodeNames.push(endNode.name);
        for (let index = 1; index < nodeNames.length; index++) {
            // 💣 Zwilling der zweiten Wache (client-graph.php:223): das Wegende oben wird UNGEPRUEFT
            // angehaengt, also kann erst hier noch ein Duplikat auftreten -- faellt der letzte innere
            // Stuetzpunkt auf denselben Ort wie das Wegende, bleibt genau diese Teilkante aus. Der einfache
            // Zwei-Punkt-Fall (nodeNames.length <= 2) bleibt unberuehrt: eine Selbstkante aus zwei echten
            // Wegenden auf demselben Ort ist ein bestehendes, andernorts behandeltes Phaenomen (165 Faelle,
            // siehe location-at-path-endpoint.test.js), keine neue Regel dieses Splits.
            if (nodeNames.length > 2 && nodeNames[index - 1] === nodeNames[index]) {
                continue;
            }
            // Teilkanten tragen „<pfad>#<n>", damit sie unterscheidbar bleiben; der Stamm vor dem
            // „#" ist die Weg-id und wird in Task 3 zurueckgelesen.
            const connection = {
                routeType,
                id: nodeNames.length > 2 ? `${properties.id}#${index}` : properties.id,
            };
            addGraphConnection(graph, nodeNames[index - 1], nodeNames[index], connection);
            addGraphConnection(graph, nodeNames[index], nodeNames[index - 1], connection);
        }
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
    // Der Koordinaten-Index kostet nur den Konnektivitaets-Graphen etwas; der Routing-Zweig
    // bekommt ihn nicht und bleibt damit Zeile fuer Zeile der alte.
    const graphOptionsForPaths = graphOptions.transports === "all"
        ? { ...graphOptions, locationCoordinateIndex: buildLocationCoordinateIndex() }
        : graphOptions;
    pathData.forEach((pathFeature) => {
        addRegularPathToGraph(graph, pathFeature, routeOptions, graphOptionsForPaths);
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

// Was an einem Knoten zusammenkommt: die Zahl der ARME (Teilkanten-Enden, nicht Nachbarn -- zwei
// getrennte Wege zum selben Nachbarn sind zwei Arme), die beteiligten Wegarten und die Weg-ids.
// Ein durchlaufender Weg liefert hier zwei Arme, weil er links und rechts je eine Teilkante hat.
function collectGraphNodeArms(graph, nodeName) {
    const neighbours = graph[nodeName];
    const arms = { count: 0, routeTypes: new Set(), pathIds: new Set() };
    if (!neighbours) {
        return arms;
    }
    Object.values(neighbours).forEach((connections) => {
        connections.forEach((connection) => {
            arms.count++;
            if (connection.routeType) {
                arms.routeTypes.add(connection.routeType);
            }
            // „<pfad>#<n>" -> „<pfad>": Task 3 vergleicht gegen properties.id.
            arms.pathIds.add(String(connection.id ?? "").split("#")[0]);
        });
    });
    return arms;
}

function countGraphNodePathEdges(graph, nodeName) {
    return collectGraphNodeArms(graph, nodeName).count;
}

// Alle Wegstrecken in ein Gitter, einmal je Indexbau. Ein Segment wird entlang seiner Laenge
// abgetastet und in jede beruehrte Zelle eingetragen (dedupliziert gegen den letzten Schluessel,
// eine gerade Strecke verlaesst eine Zelle nie, um spaeter in sie zurueckzukehren).
// 💣 Eine Fuellung nach Huellbox statt entlang der Strecke kostete auf Live-Daten das ~40-fache an
// Eintraegen (482.542 statt einer schlanken Zahl je Segment) -- ein einzelner langer, diagonaler
// Seeweg (Seeweg-2042) allein fuellte 38.760 Zellen, weil eine Huellbox mit dx*dy waechst, eine
// Strecke aber nur mit ihrer Laenge. Schrittweite = halbe Zellkante (SPARSE_CROSSING_SEGMENT_CELL / 2):
// hasForeignPathOverPoint fragt eine 3x3-Zellnachbarschaft um den Punkt ab: liegen aufeinander-
// folgende Abtastpunkte hoechstens einen halben Zellendurchmesser auseinander, faellt JEDER Punkt der
// Strecke in die Zelle eines Abtastpunkts oder eine ihrer acht Nachbarn -- also immer innerhalb der
// abgefragten 3x3-Nachbarschaft. Der Suchradius SPARSE_CROSSING_OVERLAY_DISTANCE (0,02) liegt weit
// unter der Schrittweite, kann also selbst nichts aus dieser Nachbarschaft heraustragen. Wer eine der
// beiden Zahlen aendert, muss diese Kopplung neu pruefen.
function buildPathSegmentGrid() {
    const grid = new Map();
    const step = SPARSE_CROSSING_SEGMENT_CELL / 2;
    pathData.forEach((pathFeature) => {
        const coordinates = pathFeature?.geometry?.coordinates;
        if (!Array.isArray(coordinates)) {
            return;
        }
        const pathId = String(pathFeature.properties?.id ?? "");
        for (let index = 1; index < coordinates.length; index++) {
            const [ax, ay] = coordinates[index - 1];
            const [bx, by] = coordinates[index];
            const segment = { pathId, ax, ay, bx, by };
            const segmentLength = Math.hypot(bx - ax, by - ay);
            const sampleCount = Math.ceil(segmentLength / step) + 1;
            let lastKey = null;
            for (let sample = 0; sample < sampleCount; sample++) {
                const t = sampleCount > 1 ? (sample / (sampleCount - 1)) : 0;
                const x = ax + (t * (bx - ax));
                const y = ay + (t * (by - ay));
                const key = `${Math.floor(x / SPARSE_CROSSING_SEGMENT_CELL)}|${Math.floor(y / SPARSE_CROSSING_SEGMENT_CELL)}`;
                if (key !== lastKey) {
                    lastKey = key;
                    if (!grid.has(key)) {
                        grid.set(key, []);
                    }
                    grid.get(key).push(segment);
                }
            }
        }
    });
    return grid;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (!lengthSquared) {
        return Math.hypot(px - ax, py - ay);
    }
    const rawT = (((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared;
    const t = Math.max(0, Math.min(1, rawT));
    return Math.hypot(px - (ax + (t * dx)), py - (ay + (t * dy)));
}

// Laeuft ein Weg ueber den Punkt, der ihm KEINEN Arm gibt? Dann ist der Punkt kein Auflöse-Fall,
// sondern ein fehlender Stuetzpunkt an jenem Weg -- der umgekehrte Handgriff.
function hasForeignPathOverPoint(grid, lat, lng, ownPathIds) {
    const cellX = Math.floor(lng / SPARSE_CROSSING_SEGMENT_CELL);
    const cellY = Math.floor(lat / SPARSE_CROSSING_SEGMENT_CELL);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
            const segments = grid.get(`${cellX + offsetX}|${cellY + offsetY}`) || [];
            for (const segment of segments) {
                if (ownPathIds.has(segment.pathId)) {
                    continue;
                }
                if (distanceToSegment(lng, lat, segment.ax, segment.ay, segment.bx, segment.by) < SPARSE_CROSSING_OVERLAY_DISTANCE) {
                    return true;
                }
            }
        }
    }
    return false;
}

// The editor's two marker tools (docs/superpowers/specs/2026-07-15-unverbundene-orte-marker-design.md,
// Discord #25) share ONE pass over ONE connectivity graph -- building it twice for ~5200 paths would
// be pure waste when both checkboxes are on:
//   unconnected     -- 0 drawn ways AND not a powerline endpoint (an Anbindungsluecke).
//   sparseCrossings -- ein aufloesbarer Durchgangsknoten: genau SPARSE_CROSSING_WAY_COUNT Arme,
//                      eine Wegart. Powerlines don't count here -- a Kreuzung is a way node, and
//                      Kraftlinien only ever attach to Nodices.
//   crossingWayTypes -- die EINE Wegart je markierter Kreuzung (Regel 3 verlangt arms.routeTypes.size
//                      === 1, es gibt also nie mehr als eine). Der Melde-Knopf braucht sie: "2 Arme"
//                      ist tautologisch (jede markierte Zeile hat exakt SPARSE_CROSSING_WAY_COUNT
//                      Arme), die Wegart ist die einzige unterscheidende Angabe (Owner 2026-08-15).
//                      Bleibt eine Map neben dem Set, statt sparseCrossings selbst umzubauen --
//                      resolveLocationCheckFinding (map-features-location-marker-rendering.js) ruft
//                      .has() darauf und Tests bilden [...sparse].sort().
// Cached in locationConnectivityIndex (js/app/runtime-state.js); invalidated in
// refreshPlannerAfterFeatureChange (js/routing/route-render.js) plus the two powerline mutation
// sites that don't flow through it.
function computeLocationConnectivityIndex() {
    const connectivityGraph = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
    const powerlineConnectedPublicIds = getPowerlineConnectedLocationPublicIds();
    const segmentGrid = buildPathSegmentGrid();
    const unconnected = new Set();
    const sparseCrossings = new Set();
    const crossingWayTypes = new Map();
    locationData.forEach((location) => {
        if (!location.publicId) {
            return;
        }
        const arms = collectGraphNodeArms(connectivityGraph, location.name);
        if (!arms.count && !powerlineConnectedPublicIds.has(location.publicId)) {
            unconnected.add(location.publicId);
        }
        // Regel 1: genau zwei Arme. Regel 2: kein fremder Weg laeuft ueber den Punkt hinweg.
        // Regel 3: beide Arme derselben Wegart.
        if (isCrossingLocation(location)
            && arms.count === SPARSE_CROSSING_WAY_COUNT
            && arms.routeTypes.size === 1
            && !hasForeignPathOverPoint(segmentGrid, location.coordinates[0], location.coordinates[1], arms.pathIds)) {
            sparseCrossings.add(location.publicId);
            crossingWayTypes.set(location.publicId, [...arms.routeTypes][0]);
        }
    });
    return { unconnected, sparseCrossings, crossingWayTypes };
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

// Die Wegart einer markierten Kreuzung, oder "" (nicht markiert / unbekannte publicId). Folgt der
// Form der Nachbarn oben (geht ueber getLocationConnectivityIndex(), baut den Index bei Bedarf also
// lazy) -- anders als der Melde-Knopf in map-features-share-pin.js, der bewusst NICHT hierueber geht:
// dort darf ein Popup-Klick keinen Graphbau ueber 5929 Wege ausloesen, deshalb liest er weiterhin
// direkt am globalen locationConnectivityIndex und nur, wenn es schon befuellt ist.
function getSparseCrossingWayType(publicId) {
    return getLocationConnectivityIndex().crossingWayTypes.get(publicId) || "";
}

function getVisualLatLngCoordinates(latLngs) {
    const coordinates = latLngs.map((latLng) => {
        const normalizedLatLng = L.latLng(latLng);
        return [normalizedLatLng.lng, normalizedLatLng.lat];
    });
    return smoothLineCoordinatesForDisplay(coordinates).map(([x, y]) => [y, x]);
}
