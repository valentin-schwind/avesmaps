import { werte } from "./einstellungen.ts";
import { groundRequirement } from "@avesmaps3d/shared";
import { NO_GROUND } from "./ground.ts";
import { pointIsOnLand } from "./land.ts";
import {
    directEdgeAllowed,
    exitCandidates,
    exitReach,
    landPathExits,
    nearestExitNodes,
    nearestReachableExit,
    offroadCost,
    offroadPathBetween,
    offroadTransport,
    roadLines,
    type ExitCandidate,
    type MapPoint,
    type ReachableExit,
    type RoadEntry,
} from "./map-points.ts";
import type { RouteLink, RouteNetwork, RouteNode } from "./network.ts";
import type { OffroadPath } from "./offroad-search.ts";
import {
    anchorOn,
    nearestAnchorsOfTypes,
    nearestLandPathAnchors,
    splitAtAnchor,
    type Anchor,
    type RequestGraph,
} from "./request-graph.ts";
import {
    hasLandPathEdge,
    inTunnel,
    isTunnel,
    LAND_PATH_TYPES,
    SYNTHETIC_TYPE,
    syntheticEdges,
    type Edge,
    type GraphBase,
    type OffroadTerrain,
    type Point,
    type RouteRefusal,
} from "./route-edge.ts";
import { frozenBrooks } from "./rivers.ts";
import { barrierBlocksChord, barrierContainsPoint, vehicleBarrier, type VehicleBarrier } from "./vehicle-barrier.ts";
import { areaIndexAt, chordCrossesWater, type Water } from "./water.ts";

/**
 * Stufe 2 des Routers, die Anbindung (Hardening Review M7): Was eine Anfrage an das Netz hängt, das sie nicht
 * mitbringt. Wegpunkte ohne Landweg bekommen Anker auf den nächsten Landwegen (`anchorWaypoints`), Kartenpunkte
 * genau eine Kante ans Netz (`attachMapPoints`), und die benutzten Notverbindungen werden nachträglich gebogen
 * (`bendEmergencyLinks`). Alles legt Kanten in den `RequestGraph` (`request-graph.ts`), nie in das Profil.
 */

/**
 * Was der Gang querfeldein von der Welt kennt: Wasser, Flüsse, Boden und, mit Raster, das Gelände. Er geht
 * mit dem Landmittel; dessen Familie und Sternregel bestimmen die Steigung (S5c).
 */
function offroadWorld(graph: GraphBase, water: Water, terrain: OffroadTerrain) {
    // Der Schlitten auf Schnee (WI-0069, Betreiber 2026-10-03): Die Bäche sind zugefroren. Die Landschaft (Wald, Sumpf ...)
    // bremst ihn wie jedes Mittel (WI-0258, E3).
    const frozen = groundRequirement(graph.model, graph.request.transports.land)?.baecheGefroren === true;
    return {
        water,
        rivers: frozen ? frozenBrooks(terrain.rivers) : terrain.rivers,
        ground: terrain.ground ?? NO_GROUND,
        heights: terrain.heights
            ? { terrain: terrain.heights, model: graph.model, transport: graph.request.transports.land }
            : null,
        // Wagen: kein Wald, kein Gebirge (WI-0258, E2). Einmal je Datenstand gebaut, nicht je Anfrage.
        barrier: vehicleBarrier(
            graph.model,
            graph.request.transports.land,
            terrain.ground ?? NO_GROUND,
            terrain.heights,
        ),
    };
}

/**
 * Bindet jeden Wegpunkt ohne Landweg an seine nächsten Landwege an (Legacy
 * avesmapsConnectClientRouteWaypointsToNearestLandPath). Die Kandidaten werden EINMAL gesammelt, dann
 * gesetzt - ein zweiter Sammellauf sähe die frischen Hälften als eigene Wege.
 *
 * 🔴 **Ein Ort, den nur Seewege erreichen**, blieb in Legacy ohne Anker: Zu ihm führe nur das Schiff.
 * Das stimmt für Inseln, nicht für die Festlandorte darunter (Varmur): Ist die See im Winter gesperrt
 * oder abgewählt, gab es keine Route, obwohl man an der Küste entlang hinkäme. Jetzt bekommt so ein Ort
 * Anker, aber nur zu Wegen auf SEINER Landfläche (Betreiber 2026-09-26, WI-0038: „querfeldein am Ufer
 * entlang“). Liegt Wasser dazwischen, sucht der Rechner aus R7 den Weg drumherum - die gerade Linie
 * zum nächsten Weg quert oft genau die Bucht, an der der Hafen liegt. Ohne Landflächen bleibt es bei
 * Legacys Regel.
 */
export function anchorWaypoints(
    network: RouteNetwork,
    graph: GraphBase,
    view: RequestGraph,
    waypoints: string[],
    terrain: OffroadTerrain,
): void {
    // 🪤 EINMAL je Anfrage gelesen, nicht je Anker (WI-0153).
    const w = werte();
    if (!graph.synthetic) return;
    const barrier = offroadWorld(graph, graph.water, terrain).barrier ?? null;
    for (const id of waypoints) {
        const node = network.nodes.get(id);
        if (!node) continue;
        const seaBound = graph.seaBound.has(id);
        const home = seaBound ? areaIndexAt(node.x, node.y, terrain.land) : null;
        if (seaBound && home === null) continue;
        // Ohne See steht ein Hafen ohne Landweg gar nicht im Graphen; sein Anker ist dann sein einziger Weg.
        if (!view.has(id) && !seaBound) continue;
        if (hasLandPathEdge(view.edges(id))) {
            anchorUnreachableDomains(graph, view, id, node, barrier);
            continue;
        }
        const candidates = nearestLandPathAnchors(view, node.x, node.y, w.drySearchLimit);
        const chosen: { anchor: Anchor; path: OffroadPath | null }[] =
            home === null
                ? candidates
                      .filter((anchor) => !chordCrossesWater(node.x, node.y, anchor.x, anchor.y, graph.water))
                      .filter((anchor) => !barrier || !barrierBlocksChord(barrier, node.x, node.y, anchor.x, anchor.y))
                      .slice(0, w.anchorLimit)
                      .map((anchor) => ({ anchor, path: null }))
                : aroundWater(graph, terrain, node, candidates, home);
        for (const { anchor, path } of chosen) {
            const target = splitAtAnchor(view, anchor);
            if (target === id) continue;
            const edges = syntheticEdges(graph, node, { id: target, x: anchor.x, y: anchor.y });
            view.add(path ? edges.map(([from, edge]) => [from, bentEdge(edge, path)]) : edges);
        }
    }
}

/**
 * Die Wegarten je Domäne, für die ein Anker gesucht wird. Land steht nicht dabei: Dafür gibt es `anchorWaypoints` selbst. See
 * auch nicht: Die Seefahrt beginnt am Hafen des Seegraphen, nie an einem gezeichneten Seeweg (WI-0153 Schnitt 7e, Betreiber
 * 2026-10-17); ein Anker dort spaltete den Seeweg und machte ihn wieder fahrbar.
 */
const DOMAIN_TYPES: Readonly<Record<"river", ReadonlySet<string>>> = {
    river: new Set(["Flussweg"]),
};

/**
 * 🔴 **Eine Domäne, die der Wegpunkt sonst gar nicht betreten kann** (Betreiber 2026-10-14: „Wenn eine Domäne sonst
 * unerreichbar ist, soll er versuchen zum nächsten Punkt querfeldein zu kommen“).
 *
 * 💣 Gemessen am 2026-10-14: Die Galebra läuft 0,625 Einheiten an Solfurt vorbei, ohne den Ort zu berühren — zu weit für
 * den Ortskasten (±0,5) und viel zu weit für den Fangradius zwischen Wegenden (0,001). Solfurt hing deshalb nur an seinem
 * Landweg, und Kaldenberg → Solfurt rechnete 219 statt 8,7 Einheiten: Der Router kam auf den Fluss nicht hinauf, obwohl
 * er danebenlag. Das ist keine Rundung, sondern eine echte Lücke in den Daten — sie gehört nicht in die Topologie,
 * sondern in die Anbindung der Anfrage.
 *
 * 🪤 **Nur wenn die Domäne wirklich unerreichbar ist.** Hat der Punkt schon eine Kante dieser Art, passiert nichts; wer
 * am Fluss liegt, bekommt keinen zweiten Zugang. Die Domäne muss in der Anfrage aktiv sein, und die Sehne darf kein
 * fremdes Wasser queren — sonst führe der Gang quer durch den See, den er erreichen will.
 */
function anchorUnreachableDomains(
    graph: GraphBase,
    view: RequestGraph,
    id: string,
    node: RouteNode,
    barrier: VehicleBarrier | null,
): void {
    // 🪤 EINMAL je Anfrage gelesen, nicht je Anker (WI-0153).
    const w = werte();
    const edges = view.edges(id);
    for (const [domain, types] of Object.entries(DOMAIN_TYPES) as ["river", ReadonlySet<string>][]) {
        if (!graph.request.enabled[domain]) continue;
        if (edges.some((edge) => types.has(edge.link.subtype))) continue;
        const candidates = nearestAnchorsOfTypes(view, node.x, node.y, w.drySearchLimit, types).filter(
            (anchor: Anchor) => anchor.distance <= DOMAIN_REACH,
        );
        for (const anchor of candidates.slice(0, DOMAIN_ANCHOR_LIMIT)) {
            // 🪤 Die Sehne ENDET auf dem Wasserweg, den sie erreichen soll - gegen das Ziel selbst geprüft hielte sie jede
            //    Anbindung für eine Querung. Geprüft wird deshalb das Stück davor (`CHORD_PROBE`).
            const probeX = node.x + (anchor.x - node.x) * CHORD_PROBE;
            const probeY = node.y + (anchor.y - node.y) * CHORD_PROBE;
            if (chordCrossesWater(node.x, node.y, probeX, probeY, graph.water)) continue;
            if (barrier && barrierBlocksChord(barrier, node.x, node.y, probeX, probeY)) continue;
            const target = splitAtAnchor(view, anchor);
            if (target === id) continue;
            view.add(syntheticEdges(graph, node, { id: target, x: anchor.x, y: anchor.y }));
        }
    }
}

/** Wie weit ein Wegpunkt höchstens querfeldein geht, um eine sonst unerreichbare Domäne zu betreten. */
const DOMAIN_REACH = 1.5;
/** Wie viele Zugänge je Domäne höchstens entstehen: der nächste genügt, ein zweiter fängt die Gegenrichtung. */
const DOMAIN_ANCHOR_LIMIT = 2;
/** Wie weit die Sehne auf Wasser geprüft wird: bis kurz vor den Wasserweg, der das Ziel ist. */
const CHORD_PROBE = 0.9;

/** Wie viele Anker eines Hafens höchstens um Wasser herum gesucht werden - jede Suche kostet ein Raster. */
const WET_ANCHOR_SEARCHES = 6;

/**
 * Die Anker eines Hafens ohne Landweg auf seiner Landfläche: eine trockene Gerade wie bisher, sonst der
 * Weg um das Wasser (derselbe Rechner und dieselben Regeln wie beim Biegen der Notverbindungen).
 */
function aroundWater(
    graph: GraphBase,
    terrain: OffroadTerrain,
    node: RouteNode,
    candidates: readonly Anchor[],
    home: number,
): { anchor: Anchor; path: OffroadPath | null }[] {
    const synthetic = graph.synthetic as NonNullable<GraphBase["synthetic"]>;
    const world = offroadWorld(graph, graph.water, terrain);
    const cost = offroadCost(graph.model, synthetic, "fastest", "free", "coast");
    const chosen: { anchor: Anchor; path: OffroadPath | null }[] = [];
    // 🪤 EINMAL je Wegpunkt gelesen, nicht je Anker (WI-0153).
    const w = werte();
    let searches = 0;
    for (const anchor of candidates) {
        if (chosen.length === w.anchorLimit) break;
        if (areaIndexAt(anchor.x, anchor.y, terrain.land) !== home) continue;
        const barred = world.barrier ? barrierBlocksChord(world.barrier, node.x, node.y, anchor.x, anchor.y) : false;
        if (!barred && !chordCrossesWater(node.x, node.y, anchor.x, anchor.y, graph.water)) {
            chosen.push({ anchor, path: null });
            continue;
        }
        if (searches === WET_ANCHOR_SEARCHES) continue;
        searches += 1;
        const path = offroadPathBetween(world, cost, node, anchor);
        if (path) chosen.push({ anchor, path });
    }
    return chosen;
}

/** Die Mehrzeit durch Gelände eines Gangs als Verhältnis für die Kante (S5d); leer ohne Gelände. */
function levelOf(path: OffroadPath): Pick<Edge, "levelRatio"> {
    return path.levelTime !== undefined && path.time > 0 ? { levelRatio: path.levelTime / path.time } : {};
}

/** Eine Notverbindung auf eine gebogene Linie gelegt; der Aufschlag bleibt (wie `bendEmergencyLinks`). */
function bentEdge(edge: Edge, path: OffroadPath): Edge {
    const factor = edge.costFactor;
    const coordinates = edge.link.coordinates;
    // Die Linie läuft vom Hafen zum Anker, wie die Kante in Wegrichtung.
    const [startX, startY] = coordinates[0] as [number, number];
    const first = path.points[0] as [number, number];
    const same = Math.hypot(first[0] - startX, first[1] - startY) < 1e-9;
    const points = same ? path.points : [...path.points].reverse();
    // Die gezeichnete Linie in Fahrtrichtung dieser Kante (`Edge.display`): erst in Richtung der Linie, dann ggf. gedreht.
    const display = path.display && (same ? path.display : [...path.display].reverse());
    return {
        ...edge,
        link: { ...edge.link, coordinates: points, distance: path.distance },
        distance: path.distance * factor,
        time: path.time * factor,
        ...levelOf(path),
        ...(display ? { display: edge.forward ? display : [...display].reverse() } : {}),
    };
}

/**
 * Der Gang zu einem Kartenpunkt als Kante in beide Richtungen, ohne Aufschlag. Seine Linie läuft von
 * `from` nach `to`; die Rückrichtung geht dieselbe Linie rückwärts.
 */
function offroadEdges(from: Point, to: Point, path: OffroadPath, transport: string, id: string): [string, Edge][] {
    const link: RouteLink = {
        id,
        pathPublicId: "",
        pathName: "",
        subtype: SYNTHETIC_TYPE,
        from: from.id,
        to: to.id,
        coordinates: path.points,
        distance: path.distance,
        allowedTransports: null,
        transportDomain: null,
        flow: null,
    };
    const edge = (forward: boolean): Edge => ({
        to: forward ? to.id : from.id,
        link,
        forward,
        transport,
        distance: path.distance,
        time: path.time,
        flowFactor: 1,
        flowState: "",
        costFactor: 1,
        synthetic: true,
        offroad: true,
        ...levelOf(path),
        // Die gezeichnete Linie in Fahrtrichtung der Kante; die Rückrichtung geht dieselbe Linie rückwärts.
        ...(path.display ? { display: forward ? path.display : [...path.display].reverse() } : {}),
    });
    return [
        [from.id, edge(true)],
        [to.id, edge(false)],
    ];
}

/**
 * Die Durchgänge der Ausstiegssuche (WI-0030 m, o): diesseits jedes Flusses und Sees; dann über den
 * Fluss mit Preis; zuletzt, nur wenn keiner gefunden ist, Legacys Küstenregel.
 */
const PASSES = [
    { rivers: "blocked", water: "shore" },
    { rivers: "priced", water: "shore" },
    { rivers: "priced", water: "coast" },
] as const;

/**
 * Die Landwege der Anfrage, je Richtung einmal - `landPathExits` zählt jeden Weg einmal. Ohne Tunnel: An ihnen steigt der Gang
 * weder aus noch unterwegs ein (Migration 0172, `isTunnel`).
 */
function* landPathLinks(view: RequestGraph): Generator<{ id: string; coordinates: [number, number][]; edge: Edge }> {
    for (const node of view.nodes()) {
        for (const edge of view.edges(node)) {
            if (LAND_PATH_TYPES.has(edge.link.subtype) && !isTunnel(edge.link)) {
                yield { id: edge.link.id, coordinates: edge.link.coordinates, edge };
            }
        }
    }
}

/**
 * Hängt jeden Kartenpunkt mit GENAU EINER Kante ans Netz, an den nächsten Kandidaten, zu dem ein Weg
 * querfeldein führt (`map-points.ts`, Legacy `avesmapsAttachOffroadPointToGraph`). Geteilt wird nur
 * der Weg, an dem der Gang ankommt. Danach bekommen aufeinanderfolgende Kartenpunkte ihre Direktkante,
 * wenn Legacys Regel sie erlaubt. Die erste Absage beendet die Anfrage.
 */
export function attachMapPoints(
    network: RouteNetwork,
    graph: GraphBase,
    view: RequestGraph,
    stations: readonly string[],
    points: readonly MapPoint[],
    terrain: OffroadTerrain,
    isExitNode: (node: RouteNode) => boolean,
): RouteRefusal | null {
    const { model, water } = graph;
    const world = offroadWorld(graph, water, terrain);
    const exits = new Map<string, number>();
    let offroad: { transport: string; speed: number } | undefined;
    for (const point of points) {
        // Legacys Reihenfolge: erst der Punkt, dann das Mittel, dann die Ausstiege.
        if (!pointIsOnLand(point.x, point.y, terrain.land, water)) {
            return { reason: "point_not_on_land", waypoint: point.id };
        }
        const transport = offroadTransport(model, graph.request.transports.land);
        if (typeof transport === "string") return { reason: transport, waypoint: point.id };
        // Ein Punkt in gesperrtem Land (Wald, Gebirge) ist für einen Wagen nicht erreichbar (WI-0258, E2).
        if (world.barrier && barrierContainsPoint(world.barrier, point.x, point.y)) {
            return { reason: "no_offroad_route", waypoint: point.id };
        }
        offroad = transport;
        const links = [...landPathLinks(view)];
        const sets = landPathExits(links, point.x, point.y);
        const roads = roadLines(links);
        const nodes = nearestExitNodes(
            [...network.nodes.values()]
                // Ein Knoten im Berg ist kein Ausstieg (Migration 0172, `inTunnel`).
                .filter((node) => isExitNode(node) && !inTunnel(node, view.edges(node.id)))
                .map((node) => ({ ...node, landPath: hasLandPathEdge(view.edges(node.id)) })),
            point.x,
            point.y,
        );
        if (sets.length === 0 && nodes.length === 0) return { reason: "no_exit_node", waypoint: point.id };

        // Zwei Durchgänge (WI-0030 m): erst diesseits jedes Flusses, dann über ihn, mit Preis. Liegt der
        // Ausstieg jenseits näher, bekommt der Punkt beide Gänge, und das Netz wählt die schnellere Reise:
        // die Brücke des Netzes oder die bezahlte Querung. Je Durchgang erst bis zum sechstnächsten
        // Kandidaten, dann alle; der nächste erreichbare gewinnt.
        const chosen: { candidate: ExitCandidate<(typeof links)[number]>; found: ReachableExit }[] = [];
        for (const [pass, { rivers, water }] of PASSES.entries()) {
            // Der letzte Durchgang ist Legacys Küstenregel - nur, wenn sonst gar kein Ausstieg erreichbar ist.
            if (pass === PASSES.length - 1 && chosen.length > 0) break;
            const cost = offroadCost(model, transport, graph.request.optimize, rivers, water);
            // Über den Fluss zählt nur, was näher liegt als der Ausstieg diesseits.
            const bound = chosen[0]?.candidate.distance ?? Infinity;
            let tried = 0;
            for (const limit of [exitReach(sets, nodes), Infinity]) {
                const candidates = exitCandidates(sets, nodes, limit).filter((candidate) => candidate.distance < bound);
                // Die zweite Stufe umfasst die erste; ist sie nicht größer, fände sie nichts Neues.
                if (candidates.length === tried) continue;
                tried = candidates.length;
                const found = nearestReachableExit(world, cost, point, candidates, roads);
                if (!found) continue;
                const candidate = candidates[found.index] as (typeof candidates)[number];
                chosen.push({ candidate, found });
                break;
            }
        }
        if (chosen.length === 0) return { reason: "no_offroad_route", waypoint: point.id };
        let nearest = Infinity;
        const enter = (entry: RoadEntry, path: OffroadPath, edgeId: string): void => {
            const { link } = roads[entry.road] as (typeof roads)[number];
            const at = { ...entry, distance: Math.hypot(entry.x - point.x, entry.y - point.y) };
            const exit = { ...at, id: anchorOn(view, { ...at, edge: link.edge }), path };
            view.add(offroadEdges(exit, point, path, transport.transport, edgeId));
            nearest = Math.min(nearest, exit.distance);
        };
        chosen.forEach(({ candidate, found }, index) => {
            const edgeId = index === 0 ? `offroad-${point.id}` : `offroad-${point.id}-quer`;
            if (found.entry) {
                // Der Gang kommt vorher an einen Weg und steigt dort ein.
                enter(found.entry, found.path, edgeId);
                return;
            }
            const id =
                candidate.kind === "node" ? candidate.id : anchorOn(view, { ...candidate, edge: candidate.link.edge });
            const exit = { id, x: candidate.x, y: candidate.y, distance: candidate.distance, path: found.path };
            view.add(offroadEdges(exit, point, exit.path, transport.transport, edgeId));
            nearest = Math.min(nearest, exit.distance);
        });
        // Der Weg, den man zu Fuß schneller erreicht als den Ausstieg (Betreiber 2026-09-25, WI-0030 q):
        // ein weiterer Gang, und das Netz wählt die schnellere Reise - keine wird dadurch länger.
        chosen.forEach(({ found }, index) => {
            found.faster.forEach(({ entry, path }, number) => {
                enter(entry, path, `offroad-${point.id}-weg-${String(number)}${index === 0 ? "" : "-quer"}`);
            });
        });
        exits.set(point.id, nearest);
    }
    if (!offroad) return null;

    const byId = new Map(points.map((point) => [point.id, point]));
    const offered = new Set<string>();
    for (let index = 0; index + 1 < stations.length; index += 1) {
        const a = byId.get(stations[index] as string);
        const b = byId.get(stations[index + 1] as string);
        if (!a || !b || a.id === b.id) continue;
        const pair = [a.id, b.id].sort().join("|");
        if (offered.has(pair)) continue;
        offered.add(pair);
        if (!directEdgeAllowed(model, a, b, exits.get(a.id) ?? Infinity, exits.get(b.id) ?? Infinity)) continue;
        // Ohne Ausweichziel: Ein Fluss nahe einem der Punkte ist passierbar, kostet aber (WI-0030 m).
        const path = offroadPathBetween(
            world,
            offroadCost(model, offroad, graph.request.optimize, "priced", "shore"),
            a,
            b,
        );
        if (path) view.add(offroadEdges(a, b, path, offroad.transport, `offroad-direct-${String(offered.size)}`));
    }
    return null;
}

/**
 * Biegt die geraden Notverbindungen - Brücken und Anker -, die eine gefundene Route benutzt (WI-0017
 * R7, Legacy `avesmapsRefineSyntheticRouteLegs`, avesmaps@770c80e). Nachträglich und nicht beim
 * Graphbau: Ein Profil hat Hunderte solcher Kanten, eine Route benutzt null bis wenige.
 *
 * - **Nur unter „Schnellste“.** Unter „Kürzeste“ ist die Gerade schon die ehrliche Antwort (Legacy).
 * - **Derselbe Rechner wie für den Kartenpunkt:** Ist die Sehne trocken, bleibt sie gerade
 *   (Entscheidung h), sonst biegt die Suche um Flüsse und Bäche. Gemessen wird sie in beiden Fällen
 *   wie jeder Gang querfeldein: Watfaktor, Furten, Längenaufschlag. Die Notverbindung selbst prüft beim
 *   Bau nur Meer und See.
 * - **Der Aufschlag bleibt:** Die Geometrie wird ehrlich, die Abschreckung gegen echte Wege nicht
 *   kleiner - Länge und Zeit zählen weiter mal `querfeldeinAufschlag`.
 * - **Ohne Weg bleibt die Sehne.** Lieber eine grobe Verbindung als gar keine.
 * - Die Kante behält ihre Kennung und bleibt eine Notverbindung (`offroad: false`, mit Warnung).
 *   Legacy markiert sie danach als `offroad`; bei uns heißt `offroad` „gewollter Gang“.
 */
export function bendEmergencyLinks(
    graph: GraphBase,
    view: RequestGraph,
    terrain: OffroadTerrain,
    edges: readonly Edge[],
): number {
    if (graph.request.optimize === "shortest" || !graph.synthetic) return 0;
    const world = offroadWorld(graph, graph.water, terrain);
    // Notverbindungen queren einen Fluss am Anker weiter frei, wie in Legacy (WI-0030 m gilt Kartenpunkten).
    const cost = offroadCost(graph.model, graph.synthetic, "fastest", "free", "coast");
    const seen = new Set<RouteLink>();
    let bent = 0;
    for (const edge of edges) {
        const link = edge.link;
        if (!edge.synthetic || edge.offroad || link.coordinates.length !== 2 || seen.has(link)) continue;
        seen.add(link);
        // Die Enden aus der gespeicherten Linie, nicht aus der Richtung der benutzten Kante.
        const [fromX, fromY] = link.coordinates[0] as [number, number];
        const [toX, toY] = link.coordinates[1] as [number, number];
        const path = offroadPathBetween(world, cost, { x: fromX, y: fromY }, { x: toX, y: toY });
        if (!path) continue;
        const factor = edge.costFactor;
        const bentLink: RouteLink = { ...link, coordinates: path.points, distance: path.distance };
        const bentEdge = (forward: boolean): Edge => ({
            ...edge,
            to: forward ? link.to : link.from,
            link: bentLink,
            forward,
            distance: path.distance * factor,
            time: path.time * factor,
            ...levelOf(path),
        });
        view.remove(link);
        view.add([
            [link.from, bentEdge(true)],
            [link.to, bentEdge(false)],
        ]);
        bent += 1;
    }
    return bent;
}
