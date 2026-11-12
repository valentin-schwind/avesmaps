import { werte } from "./einstellungen.ts";
import {
    allowedTransportsForPath,
    pathSeasonWindow,
    routeDomain,
    seaGraphTransport,
    transportFlowFactor,
    travelSpeed,
    type TravelModel,
} from "@avesmaps3d/shared";
import { buildNodeGrid, nearestPairs } from "./nearest-pairs.ts";
import type { RouteNetwork, RouteNode } from "./network.ts";
import {
    hasLandPathEdge,
    inTunnel,
    SEA_TYPE,
    SYNTHETIC_TYPE,
    syntheticEdges,
    withEdges,
    type Edge,
    type GraphBase,
    type RouteGraph,
    type RouteRequest,
} from "./route-edge.ts";
import type { FreeSea, SeaFleet } from "./sea-free.ts";
import { calibrate, NO_SLOPE, slopeFamily, slopeTimeFactor, starWalk, type SlopeCalibration } from "./slope.ts";
import { barrierBlocksChord, type VehicleBarrier } from "./vehicle-barrier.ts";
import { chordCrossesWater, NO_WATER, type Water } from "./water.ts";

/**
 * Stufe 1 des Routers (Hardening Review M7): der Graph je Profil. Ein Profil ist die Wahl von Transportmitteln
 * und Wegarten; sein Graph hält die Kanten der gezeichneten Wege und die Brücken zwischen den Netzteilen. Er
 * hängt nur von Netz, Reisemodell, Profil und Wasser ab, nie von den Wegpunkten einer Anfrage - der Dienst
 * hält ihn je Datenstand und Profil (`service.ts`). Was eine Anfrage hinzufügt, steht in `request-graph.ts`.
 *
 * 🔴 Zwei Zwischenspeicher hängen an der Identität ihres Schlüssels und überleben nur mit ihr: die Eichung der
 * Steigung am `RouteNetwork` (`networkCalibration`) und die ganzjährigen Brücken an `graph.drawn`
 * (`yearRoundBridgesFor`). Der Dienst reicht je Anfrage eine frische Hülle des Graphen, aber dieselben Kanten.
 */

/** Querfeldein reist mit dem Landmittel - wenn Land an ist und das Mittel querfeldein darf. */
function syntheticTransport(model: TravelModel, request: RouteRequest): RouteGraph["synthetic"] {
    if (!request.enabled[routeDomain(SYNTHETIC_TYPE)]) return null;
    const transport = request.transports.land;
    // Ein Mittel, das querfeldein nie fährt, bekommt weder Brücken noch Anker. Wagen fahren querfeldein, aber nur über
    // offenes Land (WI-0258): Das sperrt `barrier`, nicht dieses Angebot.
    if (!allowedTransportsForPath(model, SYNTHETIC_TYPE, null, null).includes(transport)) return null;
    const speed = travelSpeed(model, transport, SYNTHETIC_TYPE);
    return speed === null ? null : { transport, speed };
}

/**
 * Die freie Seefahrt einer Anfrage: nur mit See, dem Schalter und einem Seegraphen, der das Schiff kennt.
 * Das Schiff muss ein Seeschiff des Reisemodells sein und ein Tempo auf See haben, wie auf den Seewegen. Ob es
 * gezeichnete Seewege fährt, zählt hier nicht: Das Ruderboot fährt keine, frei aber auf Binnenseen (WI-0069).
 * Der Seegraph hält die Seereisen unter dem Schiff, dessen Wege es teilt (`seaGraphTransport`).
 */
function seaFleet(
    network: RouteNetwork,
    model: TravelModel,
    request: RouteRequest,
    freeSea: FreeSea | null,
): SeaFleet | null {
    if (!freeSea || !request.enabled.sea) return null;
    const transport = request.transports.sea;
    if (!model.transportmittel.wert.sea.includes(transport)) return null;
    const speed = travelSpeed(model, transport, SEA_TYPE);
    return speed === null ? null : freeSea.fleet(transport, speed, network.nodes, seaGraphTransport(model, transport));
}

/**
 * Baut die Kanten für EINE Wahl von Transportmitteln - je Richtung eine - und die Brücken. Gezeichnete Seewege fährt der
 * Router nie (WI-0153 Schnitt 7e, Betreiber 2026-10-17: das alte, vorgefertigte Seewegesystem wird nicht mehr benutzt); die
 * Seekanten kommen je Anfrage aus dem Seegraphen. Fehlt der, gibt es keine Seereise.
 */
export function buildRouteGraph(
    network: RouteNetwork,
    model: TravelModel,
    request: RouteRequest,
    water: Water = NO_WATER,
    freeSea: FreeSea | null = null,
    barrier: VehicleBarrier | null = null,
): RouteGraph {
    const sea = seaFleet(network, model, request, freeSea);
    const calibration = networkCalibration(network, model);
    // Die Steigung trifft nur Landwege, also zählt die Familie des Landmittels.
    const family = slopeFamily(model, request.transports.land);
    const drawn = new Map<string, Edge[]>();
    for (const id of network.nodes.keys()) drawn.set(id, []);
    for (const link of network.links) {
        const domain = routeDomain(link.subtype);
        if (!request.enabled[domain]) continue;
        if (link.subtype === SEA_TYPE) continue;
        const transport = request.transports[domain];
        const allowed = allowedTransportsForPath(
            model,
            link.subtype,
            link.allowedTransports,
            link.transportDomain,
            link.transportsWritten === true,
        );
        if (!allowed.includes(transport)) continue;
        const speed = travelSpeed(model, transport, link.subtype);
        if (speed === null) continue;
        const time = link.distance / speed;
        // Im Sterngelände des Weges (Pfad in Gebirgsflächen) geht es zu Fuß (S5c, E3).
        const star = domain === "land" ? starWalk(model, transport, link.subtype) : null;
        // `level`: jeder Abtastschritt eben (P = 1), sonst alles gleich - die Bezugszeit der Mehrzeit (S5d).
        const slope = (forward: boolean, level = false): number =>
            slopeTimeFactor(
                link.subtype,
                link.distance,
                link.slope ?? NO_SLOPE,
                forward,
                model,
                calibration,
                family,
                star,
                level,
            );
        // Ein am Weg gespeicherter Faktor geht vor, sonst der des Mittels (WI-0069, Flussgaleere 75/35), sonst 2.
        const factor = link.flow ? Math.max(1, link.flow.factor ?? transportFlowFactor(model, transport)) : 1;
        // Stromauf: gegen die Fließrichtung. `reverse` heißt, das Wasser fließt gegen die Punktreihenfolge.
        const forwardUpstream = link.flow?.dir === "reverse";
        const reverseUpstream = link.flow?.dir === "forward";
        const flowState = (upstream: boolean): Edge["flowState"] =>
            link.flow === null ? "" : upstream ? "upstream" : "downstream";
        // Die Mehrzeit durch Steigung (S5d) braucht nur, wer Höhen trägt; sonst meldet der Abschnitt keine.
        const known = link.slope?.known === true;
        const edge = (forward: boolean, upstream: boolean): Edge => {
            const terrainFactor = slope(forward);
            const levelFactor = known ? slope(forward, true) : terrainFactor;
            return {
                to: forward ? link.to : link.from,
                link,
                forward,
                transport,
                distance: link.distance,
                time: (upstream ? time * factor : time) * terrainFactor,
                flowFactor: upstream ? factor : 1,
                flowState: flowState(upstream),
                costFactor: 1,
                synthetic: false,
                offroad: false,
                ...(levelFactor !== terrainFactor ? { levelRatio: levelFactor / terrainFactor } : {}),
            };
        };
        drawn.get(link.from)?.push(edge(true, forwardUpstream));
        drawn.get(link.to)?.push(edge(false, reverseUpstream));
    }
    const base: GraphBase = {
        model,
        request,
        water,
        barrier,
        synthetic: syntheticTransport(model, request),
        drawn,
        sea,
        // Ohne Seegraph bleibt nur die Lage am Wasser (die Orte an Seewegen): Sie hält Landbrücken von Inseln fern. Fahren
        // lässt sie nichts; die Seewege selbst sind oben schon weggefallen.
        seaBound: sea ? sea.ports : network.seaBound,
    };
    // 🔴 Ein versteckter Ort ist kein Brückenende - Legacys Regel. 🪤 Legacys Code liest `is_hidden`
    // eine Ebene zu hoch und baut die Brücken doch (MCS-017, Nachtrag 2026-09-23).
    const bridges = componentBridges(network, base, (node) => !node.isHidden);
    return { ...base, adjacency: withEdges(drawn, bridges), bridgeCount: bridges.length / 2 };
}

const calibrations = new WeakMap<RouteNetwork, { model: TravelModel; calibration: SlopeCalibration | null }>();

/**
 * Die Eichung der Steigung für diesen Stand, einmal je Netz und Reisemodell gerechnet. Null ohne
 * Wegprofile: Dann gilt überall Faktor 1, das Verhalten vor S5a.
 */
function networkCalibration(network: RouteNetwork, model: TravelModel): SlopeCalibration | null {
    const cached = calibrations.get(network);
    if (cached?.model === model) return cached.calibration;
    const calibration = network.hasProfiles
        ? calibrate(
              network.links.map((link) => ({
                  subtype: link.subtype,
                  distance: link.distance,
                  sums: link.slope ?? NO_SLOPE,
              })),
              model,
          )
        : null;
    calibrations.set(network, { model, calibration });
    return calibration;
}

/** Die zusammenhängenden Teile, in Knotenreihenfolge entdeckt. Häfen im selben Wasser hängen über See zusammen. */
function findComponents(network: RouteNetwork, adjacency: Map<string, Edge[]>, sea: SeaFleet | null): string[][] {
    const seen = new Set<string>();
    const components: string[][] = [];
    for (const start of network.nodes.keys()) {
        if (seen.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        seen.add(start);
        const visit = (next: string): void => {
            if (seen.has(next)) return;
            seen.add(next);
            stack.push(next);
        };
        while (stack.length > 0) {
            const node = stack.pop() as string;
            component.push(node);
            for (const edge of adjacency.get(node) ?? []) visit(edge.to);
            if (sea?.has(node)) for (const port of sea.group(node)) visit(port);
        }
        components.push(component);
    }
    return components;
}

/**
 * Die Sehnen, die die Brückensuche schon auf Wasser geprüft hat, je Wasser (WI-0117). Jedes Profil sucht die Brücken
 * seiner Netzteile und jeder Stand die ganzjährigen noch einmal, aber über dieselben Orte: Ob eine Sehne zwischen zwei
 * Orten Wasser quert, hängt nur an den Orten und am Wasser, nicht am Profil. Gemerkt wird je Sehne nur ja oder nein
 * (rund 20.000 Sehnen, einige MB); mit dem Wasser eines Stands geht auch der Merkzettel.
 */
const wetChords = new WeakMap<Water, Map<string, boolean>>();

/**
 * Die Sehnen, die die Brückensuche schon gegen das gesperrte Land der Wagen geprüft hat (WI-0258), je Sperre - wie
 * `wetChords`: Ob eine Sehne Wald oder Gebirge quert, hängt nur an den Orten und der Sperre, nicht am Profil.
 */
const barredChords = new WeakMap<VehicleBarrier, Map<string, boolean>>();

/** Quert die Sehne dieses Paares gesperrtes Land? Einmal gerechnet je Sperre und Sehne. */
function isBarred(barrier: VehicleBarrier, pair: { from: RouteNode; to: RouteNode }): boolean {
    const { from, to } = pair;
    let known = barredChords.get(barrier);
    if (!known) {
        known = new Map();
        barredChords.set(barrier, known);
    }
    const key = `${String(from.x)},${String(from.y)},${String(to.x)},${String(to.y)}`;
    let barred = known.get(key);
    if (barred === undefined) {
        barred = barrierBlocksChord(barrier, from.x, from.y, to.x, to.y);
        known.set(key, barred);
    }
    return barred;
}

/** Quert die Sehne dieses Paares Wasser? Einmal gerechnet je Wasser und Sehne. */
function isWet(water: Water, pair: { from: RouteNode; to: RouteNode }): boolean {
    const { from, to } = pair;
    if (water.areas.length === 0) return false;
    let known = wetChords.get(water);
    if (!known) {
        known = new Map();
        wetChords.set(water, known);
    }
    const key = `${String(from.x)},${String(from.y)},${String(to.x)},${String(to.y)}`;
    let wet = known.get(key);
    if (wet === undefined) {
        wet = chordCrossesWater(from.x, from.y, to.x, to.y, water);
        known.set(key, wet);
    }
    return wet;
}

/**
 * Jeder abgetrennte Netzteil bekommt eine Brücke ins Hauptnetz (Legacy
 * avesmapsConnectClientCompatibleDetachedGraphComponents). Enden dürfen nur Orte sein, die
 * `isCandidate` zulässt, und nie ein Ort, den nur ein Seeweg erreicht, nie ein Knoten im Berg (Migration 0172, `inTunnel`). Ist die nächste Sehne nass
 * (oder quert sie gesperrtes Land eines Wagens, WI-0258), gilt das nächste trockene der 25 nächsten Paare; gibt es keines,
 * bleibt der Teil ohne Brücke.
 */
export function componentBridges(
    network: RouteNetwork,
    graph: GraphBase,
    isCandidate: (node: RouteNode) => boolean,
): [string, Edge][] {
    if (!graph.synthetic) return [];
    const components = findComponents(network, graph.drawn, graph.sea);
    if (components.length <= 1) return [];
    components.sort((a, b) => b.length - a.length);
    const eligible = (ids: string[]): RouteNode[] =>
        ids.flatMap((id) => {
            const node = network.nodes.get(id);
            if (!node || !isCandidate(node) || inTunnel(node, graph.drawn.get(id) ?? [])) return [];
            const waterLocked = graph.seaBound.has(id) && !hasLandPathEdge(graph.drawn.get(id) ?? []);
            return waterLocked ? [] : [node];
        });
    const main = eligible(components[0] as string[]);
    if (main.length === 0) return [];
    // Das Gitter über dem Hauptnetz, einmal für alle abgetrennten Teile (`nearest-pairs.ts`).
    const mainGrid = buildNodeGrid(main);
    const bridges: [string, Edge][] = [];
    for (const component of components.slice(1)) {
        const detached = eligible(component);
        if (detached.length === 0) continue;
        let pair = nearestPairs(detached, main, 1, mainGrid)[0];
        if (!pair) continue;
        const wet = (candidate: { from: RouteNode; to: RouteNode }): boolean =>
            isWet(graph.water, candidate) || (graph.barrier ? isBarred(graph.barrier, candidate) : false);
        if (wet(pair)) {
            pair = nearestPairs(detached, main, werte().drySearchLimit, mainGrid)
                .slice(1)
                .find((candidate) => !wet(candidate));
            // Owner Legacy 2026-07-29: nichts Trockenes, keine Kante - dann gibt es keine Route.
            if (!pair) continue;
        }
        bridges.push(...syntheticEdges(graph, pair.from, pair.to));
    }
    return bridges;
}

/**
 * Die Brücken des ganzjährigen Netzes je Profil (`yearRoundBridges` mit Legacys Brückenenden). Der
 * Schlüssel sind die gezeichneten Kanten: Der Dienst reicht je Anfrage eine frische Hülle des Graphen.
 */
const yearRoundCache = new WeakMap<Map<string, Edge[]>, [string, Edge][]>();

/**
 * Die Brücken des Netzes ohne Wasserwege mit Fenster (WI-0038, Betreiber 2026-09-26: „querfeldein am
 * Ufer entlang“). Mit Reisebeginn fallen gesperrte Wege weg. Ein Netzteil, das nur über Wasser am
 * Hauptnetz hängt (Trasik, Lyngskin: nur über See), wäre im Winter abgeschnitten, obwohl man ohne See
 * hinkäme - die Brücken des Profils sehen ihn ja angebunden. Also bekommt jeder Teil, der OHNE die
 * Wasserwege mit Fenster abgetrennt ist, auch seine Brücke. Mit dem Aufschlag gewinnt der offene Weg;
 * die Brücke trägt erst, wenn er gesperrt ist. Brücken, die das Profil schon hat, kommen nicht doppelt.
 *
 * 🔴 Ein gesperrter PASS bekommt keine Brücke: Wo der Pass zu ist, führt auch querfeldein kein Weg
 * über das Gebirge; die Route bleibt gesperrt (Legacy `blocked`).
 */
function yearRoundBridges(
    network: RouteNetwork,
    graph: RouteGraph,
    isCandidate: (node: RouteNode) => boolean,
    present: Map<string, Edge[]>,
): [string, Edge][] {
    if (!graph.synthetic) return [];
    const drawn = new Map<string, Edge[]>();
    // Die freie See kann gesperrt sein (S5): Dann zählt sie für die ganzjährigen Brücken nicht als Verbindung.
    let windowed = graph.sea?.hasClosures === true;
    for (const [id, edges] of graph.drawn) {
        const open = edges.filter(
            (edge) =>
                routeDomain(edge.link.subtype) === "land" ||
                pathSeasonWindow(
                    graph.model,
                    edge.link.seasons,
                    edge.transport,
                    edge.link.transportsWritten === true,
                ) === undefined,
        );
        if (open.length !== edges.length) windowed = true;
        drawn.set(id, open);
    }
    if (!windowed) return [];
    const sea = graph.sea?.hasClosures ? null : graph.sea;
    return componentBridges(network, { ...graph, drawn, sea }, isCandidate).filter(
        ([from, bridge]) => !(present.get(from) ?? []).some((edge) => edge.synthetic && edge.to === bridge.to),
    );
}

/**
 * Legt die ganzjährigen Brücken eines Profils vorab ab (WI-0117), so wie die erste Anfrage mit Reisebeginn sie sonst
 * rechnen müsste: Sie sind der größte Posten der ersten Route mit Reisebeginn auf einem Profil (gemessen 0,5 bis 1,3 s
 * auf dem Entwicklungsrechner, davon die Brückensuche über rund 1.900 abgetrennte Netzteile). Dieselbe Funktion und
 * dieselben Argumente wie in `findRoute` für eine Anfrage ohne versteckten Ort (`router.ts`): Brückenende ist jeder
 * sichtbare Ort, und gerechnet wird gegen die Kanten des Profils; so ist der Eintrag der, den die Anfrage findet.
 */
export function prepareYearRoundBridges(network: RouteNetwork, graph: RouteGraph): void {
    yearRoundBridgesFor(network, graph, (node) => !node.isHidden, graph.adjacency, true);
}

/**
 * Die ganzjährigen Brücken einer Anfrage mit Reisebeginn. `cacheable`: Nennt die Anfrage keinen versteckten Ort,
 * hängen sie nur am Profil und werden einmal je Profil gerechnet (`yearRoundCache`); sonst gelten die
 * Brückenenden dieser Anfrage, und nichts wird gemerkt.
 */
export function yearRoundBridgesFor(
    network: RouteNetwork,
    graph: RouteGraph,
    isCandidate: (node: RouteNode) => boolean,
    present: Map<string, Edge[]>,
    cacheable: boolean,
): [string, Edge][] {
    let bridges = cacheable ? (yearRoundCache.get(graph.drawn) ?? null) : null;
    if (!bridges) {
        bridges = yearRoundBridges(network, graph, isCandidate, present);
        if (cacheable) yearRoundCache.set(graph.drawn, bridges);
    }
    return bridges;
}
