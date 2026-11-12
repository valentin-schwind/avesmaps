import { werte } from "./einstellungen.ts";
import { chordTouchesRelief, type ReliefWorld } from "./relief.ts";
import {
    allowedTransportsForPath,
    OFFROAD_TYPE,
    travelSpeed,
    type MapPointRefusal,
    type TravelModel,
} from "@avesmaps3d/shared";
import { chordTouchesGround, NO_GROUND, type Ground } from "./ground.ts";
import { buildOffroadBox, buildPlanes } from "./offroad-grid.ts";
import {
    finishPath,
    findPath,
    nearestReachable,
    type OffroadCost,
    type OffroadPath,
    type RiverRule,
    type WaterRule,
} from "./offroad-search.ts";
import { chordCrossesRivers, type Rivers } from "./rivers.ts";
import { barrierBlocksChord, type VehicleBarrier } from "./vehicle-barrier.ts";
import { areasContainPoint, chordCrossesWater, type Water } from "./water.ts";

/**
 * Der Gang zu einem Kartenpunkt (WI-0030, Legacys „Hierher reisen“, `offroad-leg.php` und
 * `client-graph.php`, avesmaps@770c80e): Der angeklickte Punkt wird ein Knoten mit GENAU EINER
 * Querfeldein-Kante - zum nächsten Punkt des Netzes, den man querfeldein erreicht. Danach rechnet
 * dieselbe Suche wie für jeden Ort.
 *
 * Hier stehen die reinen Regeln (Kandidaten, Reichweite, Erreichbarkeit, Zeit); das Einhängen in den
 * Graphen macht der Router.
 *
 * - **Der Ausstieg ist der NÄCHSTE ERREICHBARE Punkt**, nach Luftlinie geordnet, nicht der
 *   günstigste (Owner Legacy 15.08.2026: „er soll auf dem strassensystem bleiben bis zu dem punkt
 *   gehen wo er am naechsten zur freien zielmarkierung ist“). Gäbe es mehrere Kanten, wählte die
 *   Suche nach Gesamtkosten - und liefe 19 Meilen querfeldein, während 0,66 Meilen vor dem Ziel eine
 *   Straße lag. Auch „nach Gehzeit“ macht Reisen länger: gemessen an 200 Kartenpunkten bis +59 h, weil
 *   der fußnächste Ausstieg ungünstig im Netz liegen kann (Betreiber 2026-09-24: Luftlinie bleibt).
 * - 🔴 **Ein Ausstieg diesseits eines Flusses geht vor** (Betreiber 2026-09-24, WI-0030 m: „bei einem
 *   fluss eher die nächste straße mit furt oder brücke suchen“): Erst sucht der Gang mit dem Fluss als
 *   Wand, auch nahe Punkt und Ausstieg; über ihn führt dann die Brücke oder Furt des Netzes. Nur wenn so
 *   keiner erreichbar ist, quert er ihn dort, wo Legacy freiräumt, und zahlt das `flussQuerung`-fache
 *   des Bachpreises.
 * - 🔴 **Ein See bleibt Wand** (Betreiber 2026-09-25, WI-0030 o: „er durchquert see, was querfeldein
 *   nicht passieren sollte“): Nur die eigene Zelle der Enden ist frei. Legacys Küstenregel (g) gilt erst
 *   im letzten Rückfall, wenn sonst gar kein Ausstieg erreichbar ist.
 * - 🔴 **Kommt der Gang unterwegs an einen Weg, steigt er dort ein** (Betreiber 2026-09-24, WI-0030 n:
 *   „er müsste beim überqueren der straße doch auf der straße bleiben“): gekreuzt oder auf
 *   `ROAD_REACH` nahe, ohne Wasser dazwischen. Sonst liefe er um ein Hindernis herum neben der
 *   Straße her zum Ausstieg.
 * - **Kandidaten** sind jeder gezeichnete Stützpunkt und der Fußpunkt der sechs nächsten Landwege
 *   (je Weg einer, höchstens 24 Punkte), dazu die zwölf nächsten Orte und technischen Knoten an einem
 *   Landweg. Erst die sechs nächsten, dann alle.
 * - **Erreichbar** heißt: Ein Weg führt dorthin, ohne Meer, See oder Fluss zu queren (R7). Ist die
 *   gerade Sehne trocken - kein Meer, kein See, kein Fluss, kein Bach -, ist sie der Weg, in beiden
 *   Modi (Entscheidung h; Legacy sucht unter „Schnellste“ immer und bekommt ohne Gelände nur Treppen).
 *   Sonst biegt Legacys Suche auf dem Raster um das Hindernis (`offroad-search.ts`); an einem Bach
 *   wägt sie den Umweg gegen die Furt (Entscheidung i).
 * - 🔴 **Der Boden bremst** (WI-0030 R8): Wald, Sumpf, Dschungel, Wüste, Tundra unter „Schnellste“.
 *   Berührt die gerade Sehne solchen Boden, wird gesucht statt gerade gezogen - der Gang darf um einen
 *   Sumpf herum. Unter „Kürzeste“ zählt die Strecke, wie in Legacy.
 * - 🔴 **Kein Gang entlang eines Tunnels** (WI-0177, Migration 0172, `route-edge.ts` `isTunnel`): Ein Tunnel bietet weder
 *   Ausstieg noch Einstieg; betreten wird er an seinen Enden, über anschließende Wege oder Orte.
 * - **Die Zeit** ist Länge / Querfeldein-Tempo, mal Watfaktor im Bachbett, dazu die Furten, mal dem
 *   Längenaufschlag der Etappe. Der ×25-Aufschlag der Notverbindungen gilt hier NICHT: Wer dorthin
 *   will, soll ankommen, nicht umgeleitet werden.
 */

/** Wie viele Landwege einen Ausstieg anbieten (Legacy `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT`). */
export const EXIT_PATH_LIMIT = 6;
/** Wie viele Punkte EIN Weg anbietet (Legacy `AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT`, gemessen: p99 = 23). */
export const EXIT_VERTEX_LIMIT = 24;
/** Wie viele Orte und technische Knoten angeboten werden (Legacy `AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT`). */
export const EXIT_NODE_LIMIT = 12;
/** Die erste Stufe reicht bis zum sechstnächsten Kandidaten (Legacy `…_EXIT_NEAREST_TRIES`). */
export const EXIT_NEAREST_TRIES = 6;
/** Zwei Kartenpunkte so nah beieinander bekommen die Gerade immer angeboten (Owner Legacy 31.08.2026). */
export const DIRECT_EDGE_MILES = 15;
const ENDPOINT_EPSILON = 1e-7;
/**
 * So nah muss der Gang einem Landweg kommen, damit er einsteigt (WI-0030 n, Setzung Claudia): 0,5 E sind
 * 1,5 Meilen, zwei Rasterzellen - weniger, als die Suche neben einem Weg vorbeilaufen kann.
 */
export const ROAD_REACH = 0.5;
/** Abgetastet wird der Gang in Vierteln davon; ein Kreuzen fällt so immer in die Reichweite. */
const roadStep = (): number => werte().roadReach / 4;
/** Die Verbindung zum Weg wird in 0,025 E (75 Schritt) auf Wasser geprüft. */
const CONNECTOR_STEP = 0.025;
const TOLERANCE = 1e-9;

export interface MapPoint {
    id: string;
    x: number;
    y: number;
}

/** Ein Ausstieg auf einem Weg: Stützpunkt oder Fußpunkt, als Stelle im Weg (`segment`, `t`). */
export interface PathCut {
    segment: number;
    t: number;
    x: number;
    y: number;
    /** Luftlinie zum Kartenpunkt. */
    distance: number;
}

export interface CutSet<L> {
    link: L;
    cuts: PathCut[];
}

export interface ExitNode {
    id: string;
    x: number;
    y: number;
    distance: number;
}

export type ExitCandidate<L> = ({ kind: "cut"; link: L } & PathCut) | ({ kind: "node" } & ExitNode);

/** Ein Landweg, an dem der Gang einsteigen kann, mit seiner Hülle für die Vorauswahl. */
export interface RoadLine<L> {
    link: L;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Der gewählte Ausstieg einer Stufe: der Kandidat, der Gang dorthin und, falls vorher, der Einstieg. */
export interface ReachableExit {
    index: number;
    path: OffroadPath;
    entry: RoadEntry | null;
    /**
     * Die Landwege, die man zu Fuß schneller erreicht als diesen Ausstieg (WI-0030 q), je Weg die erste
     * Stelle - weitere Gänge; zwischen allen wählt das Netz.
     */
    faster: { entry: RoadEntry; path: OffroadPath }[];
}

/** Wo der Gang einen Landweg zuerst berührt: der Weg in `roads`, die Stelle im Weg und der Punkt. */
export interface RoadEntry {
    road: number;
    segment: number;
    t: number;
    x: number;
    y: number;
}

interface LinkShape {
    id: string;
    coordinates: readonly [number, number][];
}

function project(
    px: number,
    py: number,
    [ax, ay]: [number, number],
    [bx, by]: [number, number],
): { t: number; x: number; y: number; distance: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    return { t, x, y, distance: Math.hypot(px - x, py - y) };
}

/**
 * Die Ausstiege auf den `limit` nächsten Landwegen, je Weg einer Satz (Legacy
 * `avesmapsCollectClientLandPathExitCandidates`): der Fußpunkt und alle inneren Stützpunkte, nach
 * Luftlinie, höchstens `EXIT_VERTEX_LIMIT`. Wegenden zählen nicht - sie sind Knoten und stehen als
 * solche zur Wahl. `links` darf einen Weg mehrfach liefern (beide Richtungen); er zählt einmal.
 */
export function landPathExits<L extends LinkShape>(
    links: Iterable<L>,
    px: number,
    py: number,
    limit = werte().exitPathLimit,
): CutSet<L>[] {
    const best = new Map<string, { link: L; segment: number; t: number; x: number; y: number; distance: number }>();
    for (const link of links) {
        const coordinates = link.coordinates;
        for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
            const foot = project(
                px,
                py,
                coordinates[segment] as [number, number],
                coordinates[segment + 1] as [number, number],
            );
            const known = best.get(link.id);
            if (known && known.distance <= foot.distance) continue;
            best.set(link.id, { link, segment, ...foot });
        }
    }
    const nearest = [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
    const sets: CutSet<L>[] = [];
    for (const foot of nearest) {
        const coordinates = foot.link.coordinates;
        const cuts: PathCut[] = [];
        const seen = new Set<string>();
        const add = (segment: number, t: number, x: number, y: number): void => {
            const key = `${x.toFixed(6)}:${y.toFixed(6)}`;
            if (seen.has(key)) return;
            seen.add(key);
            cuts.push({ segment, t, x, y, distance: Math.hypot(x - px, y - py) });
        };
        // Der Fußpunkt zuerst: Fällt er auf einen Stützpunkt, behält er den Platz.
        const isEndpoint =
            (foot.segment === 0 && foot.t <= ENDPOINT_EPSILON) ||
            (foot.segment === coordinates.length - 2 && foot.t >= 1 - ENDPOINT_EPSILON);
        if (!isEndpoint) add(foot.segment, foot.t, foot.x, foot.y);
        for (let index = 1; index <= coordinates.length - 2; index += 1) {
            const [x, y] = coordinates[index] as [number, number];
            add(index, 0, x, y);
        }
        cuts.sort((a, b) => a.distance - b.distance);
        if (cuts.length > 0) sets.push({ link: foot.link, cuts: cuts.slice(0, werte().exitVertexLimit) });
    }
    return sets;
}

/**
 * Die nächsten Orte und technischen Knoten (WI-0132, früher die Kreuzungen) als Ausstieg (Legacy
 * `avesmapsFindNearestOffroadExitNodes`): nur Knoten an einem Landweg - sonst stünde der Wanderer an einem
 * Flussknoten. Gibt es gar keinen, dann
 * die übrigen (eine Insel, deren Orte nur am Seeweg hängen): Vorrang, kein Verbot.
 */
export function nearestExitNodes(
    nodes: Iterable<{ id: string; x: number; y: number; landPath: boolean }>,
    px: number,
    py: number,
    limit = werte().exitNodeLimit,
): ExitNode[] {
    const onLand: ExitNode[] = [];
    const waterOnly: ExitNode[] = [];
    for (const node of nodes) {
        const entry = { id: node.id, x: node.x, y: node.y, distance: Math.hypot(node.x - px, node.y - py) };
        (node.landPath ? onLand : waterOnly).push(entry);
    }
    const pool = onLand.length > 0 ? onLand : waterOnly;
    return pool.sort((a, b) => a.distance - b.distance).slice(0, Math.max(1, limit));
}

/** Die Landwege als Einstiege, jeder einmal - `links` darf einen Weg in beiden Richtungen liefern. */
export function roadLines<L extends LinkShape>(links: Iterable<L>): RoadLine<L>[] {
    const seen = new Set<string>();
    const roads: RoadLine<L>[] = [];
    for (const link of links) {
        if (seen.has(link.id)) continue;
        seen.add(link.id);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of link.coordinates) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        roads.push({ link, minX, minY, maxX, maxY });
    }
    return roads;
}

/** Der nächste Punkt eines Weges in `near`, höchstens `reach` entfernt; null, wenn keiner so nah liegt. */
function roadPointNear(
    near: readonly { road: number; line: RoadLine<LinkShape> }[],
    x: number,
    y: number,
    reach: number,
): (RoadEntry & { distance: number }) | null {
    let best: (RoadEntry & { distance: number }) | null = null;
    for (const { road, line } of near) {
        if (x < line.minX - reach || x > line.maxX + reach || y < line.minY - reach || y > line.maxY + reach) continue;
        const coordinates = line.link.coordinates;
        for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
            const foot = project(
                x,
                y,
                coordinates[segment] as [number, number],
                coordinates[segment + 1] as [number, number],
            );
            if (foot.distance > reach || (best && foot.distance >= best.distance)) continue;
            best = { road, segment, t: foot.t, x: foot.x, y: foot.y, distance: foot.distance };
        }
    }
    return best;
}

/**
 * Ist die kurze Verbindung vom Gang zum Weg trocken? Genau gefragt: `chordIsDry` zählt Wasserstücke am
 * Rand einer Sehne nicht (Küstenstreifen) und hielte jede Verbindung unter 2 E für trocken. Die Enden
 * zählen nicht - ein Uferweg liegt auf der Wasserkante.
 */
function connectorIsDry(world: OffroadWorld, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    if (chordCrossesRivers(from.x, from.y, to.x, to.y, world.rivers)) return false;
    if (world.barrier && barrierBlocksChord(world.barrier, from.x, from.y, to.x, to.y)) return false;
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / CONNECTOR_STEP);
    for (let step = 1; step < steps; step += 1) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const y = from.y + ((to.y - from.y) * step) / steps;
        if (areasContainPoint(x, y, world.water)) return false;
    }
    return true;
}

/**
 * Wo der Gang, vom Kartenpunkt aus gegangen, zuerst an einen Landweg kommt (Betreiber 2026-09-24,
 * WI-0030 n: „er müsste beim überqueren der straße doch auf der straße bleiben“) - gekreuzt oder auf
 * `ROAD_REACH` nahe, und nichts Nasses dazwischen. Null, wenn er erst am Ausstieg ankommt; im letzten
 * `2 × ROAD_REACH` vor dem Ausstieg wird nicht mehr gewechselt - gemessen auf dem Gang, nicht in der
 * Luftlinie: Ein Umweg um eine Bachquelle kommt dem Ausstieg nahe, lange bevor er ihn erreicht (Befund D
 * des Testers, `?s=BSDDef2R`). `points` läuft vom Ausstieg zum
 * Punkt, wie jeder Gang. Hinter dem Einstieg bleiben `via` (die Stelle des Gangs) und die Punkte ab
 * `after` stehen.
 */
export function firstRoadEntry(
    points: readonly [number, number][],
    roads: readonly RoadLine<LinkShape>[],
    world: OffroadWorld,
): (RoadEntry & { via: [number, number]; after: number }) | null {
    if (points.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    // 🪤 EINMAL je Strecke gelesen, nicht je Schritt (WI-0153). Auch der Vorfilter nimmt den eingestellten Wert: Las er die
    // Konstante, fielen bei einer Reichweite über 0,5 die Wege heraus, bevor die Reichweite sie prüfte (WI-0214).
    const reach = werte().roadReach;
    const near = roads.flatMap((line, road) =>
        line.maxX < minX - reach || line.minX > maxX + reach || line.maxY < minY - reach || line.minY > maxY + reach
            ? []
            : [{ road, line }],
    );
    if (near.length === 0) return null;
    // Wie weit es von jedem Punkt noch bis zum Ausstieg ist, auf dem Gang gemessen.
    const remaining = [0];
    for (let index = 1; index < points.length; index += 1) {
        const [ax, ay] = points[index - 1] as [number, number];
        const [bx, by] = points[index] as [number, number];
        remaining.push((remaining[index - 1] as number) + Math.hypot(bx - ax, by - ay));
    }
    const step = roadStep();
    for (let index = points.length - 1; index > 0; index -= 1) {
        const [ax, ay] = points[index] as [number, number];
        const [bx, by] = points[index - 1] as [number, number];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(length / step));
        for (let step = 0; step < steps; step += 1) {
            const x = ax + ((bx - ax) * step) / steps;
            const y = ay + ((by - ay) * step) / steps;
            const left = (remaining[index - 1] as number) + ((steps - step) / steps) * length;
            if (left <= 2 * reach) return null;
            const entry = roadPointNear(near, x, y, reach);
            if (!entry || !connectorIsDry(world, { x, y }, entry)) continue;
            return {
                road: entry.road,
                segment: entry.segment,
                t: entry.t,
                x: entry.x,
                y: entry.y,
                via: [x, y],
                after: index,
            };
        }
    }
    return null;
}

/** Die Grenze der ersten Stufe: die Luftlinie des sechstnächsten Kandidaten, weniger gibt es nicht. */
export function exitReach(sets: readonly CutSet<unknown>[], nodes: readonly ExitNode[]): number {
    const distances = [
        ...sets.flatMap((set) => set.cuts.map((cut) => cut.distance)),
        ...nodes.map((node) => node.distance),
    ].sort((a, b) => a - b);
    if (distances.length === 0) return Infinity;
    // Die eingestellte Zahl (WI-0214; vorher las hier niemand den Regler, nur die Konstante).
    return distances[Math.min(distances.length, werte().exitNearestTries) - 1] as number;
}

/** Die Kandidaten bis `limit`, nach Luftlinie; Gleichstand behält die Reihenfolge (Wege vor Knoten). */
export function exitCandidates<L>(
    sets: readonly CutSet<L>[],
    nodes: readonly ExitNode[],
    limit: number,
): ExitCandidate<L>[] {
    const candidates: ExitCandidate<L>[] = [];
    for (const set of sets) {
        for (const cut of set.cuts) {
            if (cut.distance <= limit + TOLERANCE) candidates.push({ kind: "cut", link: set.link, ...cut });
        }
    }
    for (const node of nodes) {
        if (node.distance <= limit + TOLERANCE) candidates.push({ kind: "node", ...node });
    }
    return candidates.sort((a, b) => a.distance - b.distance);
}

/** Das Mittel querfeldein: das Landmittel - wenn es querfeldein darf und ein Tempo hat. Wagen nur über offenes Land (`vehicle-barrier.ts`). */
export function offroadTransport(
    model: TravelModel,
    transport: string,
): { transport: string; speed: number } | MapPointRefusal {
    if (!allowedTransportsForPath(model, OFFROAD_TYPE, null, null).includes(transport)) {
        return "offroad_transport_not_allowed";
    }
    const speed = travelSpeed(model, transport, OFFROAD_TYPE);
    return speed === null ? "no_offroad_route" : { transport, speed };
}

/** Der Längenaufschlag: nur auf die Zeit, nach der Luftlinie der Etappe (Legacy `avesmapsOffroadRampFactor`). */
export function offroadRamp(model: TravelModel, chordUnits: number): number {
    const { jeMeile, hoechstens } = model.querfeldeinLaengenaufschlag.wert;
    if (chordUnits <= 0 || jeMeile <= 0) return 1;
    return Math.min(hoechstens, 1 + jeMeile * chordUnits * model.meilenJeKarteneinheit.wert);
}

/** Was der Gang querfeldein von der Welt weiß: offenes Wasser, Flüsse und Bäche. */
export interface OffroadWorld {
    water: Water;
    rivers: Rivers;
    /** Der bremsende Boden (`ground.ts`); ohne Angabe offener Boden. */
    ground?: Ground;
    /** Das Gelände (WI-0049 S5b, `relief.ts`) für dieses Landmittel (S5c); ohne Angabe flach wie vor S5b. */
    heights?: ReliefWorld | null;
    /** Das Land, das ein Wagen nicht betritt (WI-0258, `vehicle-barrier.ts`); ohne Angabe oder null gibt es keins. */
    barrier?: VehicleBarrier | null;
}

/** Ist die gerade Sehne begehbar? Trocken (`chordIsDry`) und nicht über gesperrtes Land der Wagen: Das gilt in beiden Modi, dort gibt es keine Gerade, nur den Weg drumherum oder keinen. */
function chordIsOpen(
    world: OffroadWorld,
    cost: OffroadCost,
    from: { x: number; y: number },
    to: { x: number; y: number },
): boolean {
    if (!chordIsDry(world, from, to, toleranceOf(cost))) return false;
    return !(world.barrier && barrierBlocksChord(world.barrier, from.x, from.y, to.x, to.y));
}

/**
 * Darf die gerade Sehne der Weg sein? Begehbar (`chordIsOpen`), und unter „Schnellste“ ohne bremsenden
 * Boden: Dort sucht der Gang, ob er außen herum schneller ist (WI-0030 R8).
 */
function chordIsStraight(
    world: OffroadWorld,
    cost: OffroadCost,
    from: { x: number; y: number },
    to: { x: number; y: number },
): boolean {
    if (!chordIsOpen(world, cost, from, to)) return false;
    if (cost.byDistance) return true;
    if (chordTouchesGround(from.x, from.y, to.x, to.y, world.ground ?? NO_GROUND)) return false;
    // Über Gebirge oder Gipfel sucht der Gang ebenso, ob Tal oder Sattel schneller sind (S5b).
    return !(world.heights && chordTouchesRelief(world.heights.terrain, from, to));
}

/**
 * Wie der Gang rechnet: Mittel, Tempo und Modus der Anfrage, Furt und Längenaufschlag aus dem Reisemodell.
 * Was eine Bachquerung kostet, hängt am Reisemittel (Betreiber 2026-09-24): Das Pferd trägt den
 * Einzelreiter hinüber, die Karawane muss abladen. Ein Fluss kostet das `flussQuerung`-fache davon,
 * wo `rivers` ihn überhaupt queren lässt (WI-0030 m). `water` sagt, ob ein See am Ufer begehbar ist
 * (WI-0030 o). Ohne Angabe gilt Legacy: Fluss und Küste frei (g).
 */
export function offroadCost(
    model: TravelModel,
    offroad: { transport: string; speed: number },
    optimize: "fastest" | "shortest",
    rivers: RiverRule = "free",
    water: WaterRule = "coast",
): OffroadCost {
    const { meilen, meilenJeReisemittel } = model.bachQuerung.wert;
    const crossingUnits = (meilenJeReisemittel[offroad.transport] ?? meilen) / model.meilenJeKarteneinheit.wert;
    return {
        speed: offroad.speed,
        byDistance: optimize === "shortest",
        crossingUnits,
        ramp: (airUnits) => offroadRamp(model, airUnits),
        rivers,
        riverUnits: crossingUnits * model.flussQuerung.wert.faktor,
        water,
    };
}

/**
 * Ist die gerade Sehne trocken (Legacy `avesmapsOffroadStraightPathIfDry`)? Gefragt werden die Flächen,
 * nicht das Raster - das sperrt eine Zelle, sobald Wasser sie berührt, und legte Meilen für ein
 * Rasterungsartefakt dazu. Ein Bach verwirft die Sehne, statt sie zu bepreisen (Entscheidung i).
 */
export function chordIsDry(
    world: OffroadWorld,
    from: { x: number; y: number },
    to: { x: number; y: number },
    tolerance = werte().coastTolerance,
): boolean {
    if (chordCrossesWater(from.x, from.y, to.x, to.y, world.water, tolerance)) return false;
    return !chordCrossesRivers(from.x, from.y, to.x, to.y, world.rivers);
}

/**
 * Der Ausstieg EINER Stufe: der erste Kandidat, in ihrer Reihenfolge, zu dem ein Weg führt, mit dem Weg
 * vom Kandidaten zum Punkt (Legacy `avesmapsAttachOffroadPointToGraph`, eine Stufe).
 *
 * - EINE Kiste über den Punkt und alle Kandidaten der Stufe, ein Satz Ebenen.
 * - Ein Kandidat mit trockener Sehne bekommt sie; alle davor, deren Sehne nass ist, gehen in EINEN
 *   Suchlauf. Führt zu einem von ihnen ein Weg, liegt er näher und gewinnt.
 * - Auch die gerade Sehne wird an den Ebenen gemessen: Wo sie durch ein Bachbett läuft, watet sie.
 * - Kommt der Gang vorher an einen der `roads`, endet er dort (`entry`, WI-0030 n); `index` nennt
 *   dann den Kandidaten, auf den er zulief.
 */
export function nearestReachableExit(
    world: OffroadWorld,
    cost: OffroadCost,
    point: { x: number; y: number },
    candidates: readonly { x: number; y: number }[],
    roads: readonly RoadLine<LinkShape>[] = [],
): ReachableExit | null {
    if (candidates.length === 0) return null;
    let minX = point.x;
    let minY = point.y;
    let maxX = point.x;
    let maxY = point.y;
    for (const candidate of candidates) {
        minX = Math.min(minX, candidate.x);
        minY = Math.min(minY, candidate.y);
        maxX = Math.max(maxX, candidate.x);
        maxY = Math.max(maxY, candidate.y);
    }
    const box = buildOffroadBox(minX, minY, maxX, maxY);
    const dry = candidates.findIndex((candidate) => chordIsStraight(world, cost, candidate, point));
    const wet = dry < 0 ? candidates : candidates.slice(0, dry);
    const near = roads.flatMap((line, road) =>
        line.maxX < box.minX || line.minX > box.maxX || line.maxY < box.minY || line.minY > box.maxY
            ? []
            : [{ road, line }],
    );
    const planes = buildPlanes(
        box,
        world.water,
        world.rivers,
        { search: wet.length > 0 },
        world.ground,
        near.map(({ line }) => line.link.coordinates),
        world.heights ?? null,
        world.barrier ?? null,
    );
    // Wo die Suche an einen Weg kommt: der nächste Punkt DIESES Weges in der Zelle.
    const entryAt = (road: number, x: number, y: number, reach: number): RoadEntry | null => {
        const one = near[road];
        const entry = one ? roadPointNear([one], x, y, reach) : null;
        return entry && { road: entry.road, segment: entry.segment, t: entry.t, x: entry.x, y: entry.y };
    };
    const roadAt = (road: number, x: number, y: number): [number, number] | null => {
        const entry = entryAt(road, x, y, box.cell);
        return entry && [entry.x, entry.y];
    };
    let chosen: { index: number; path: OffroadPath; searched: boolean } | null = null;
    const faster: ReachableExit["faster"] = [];
    if (wet.length > 0) {
        const found = nearestReachable(planes, cost, point, wet, roadAt);
        if (found) {
            chosen = { index: found.index, path: found.path, searched: true };
            const measure = (path: OffroadPath): number => (cost.byDistance ? path.distance : path.time);
            for (const road of found.roads) {
                const entry = entryAt(road.road, road.at[0], road.at[1], 1e-6);
                if (entry && measure(road.path) < measure(found.path)) faster.push({ entry, path: road.path });
            }
        }
    }
    if (chosen === null && dry >= 0) {
        const candidate = candidates[dry] as { x: number; y: number };
        const chord: [number, number][] = [
            [candidate.x, candidate.y],
            [point.x, point.y],
        ];
        chosen = { index: dry, path: finishPath(planes, cost, chord, false), searched: false };
    }
    if (chosen === null) return null;
    const entry = firstRoadEntry(chosen.path.points, roads, world);
    if (!entry) return { index: chosen.index, path: chosen.path, entry: null, faster };
    const { after, via, ...at } = entry;
    const rest: [number, number][] = [[at.x, at.y], via, ...chosen.path.points.slice(after)];
    return { index: chosen.index, path: finishPath(planes, cost, rest, chosen.searched), entry: at, faster };
}

/** Wie viel Wasser an den Enden einer Sehne nicht zählt: Legacys Küste, oder am Ufer eine Zelle. */
/**
 * 🪤 Ein Zeiger auf das eingefrorene Objekt, kein Nachschlagen: genauso teuer wie die Konstante vorher, und die
 * Stelle ruft es je Sehne (WI-0153).
 */
const toleranceOf = (cost: OffroadCost): number =>
    cost.water === "shore" ? werte().shoreTolerance : werte().coastTolerance;

/**
 * Der Weg zwischen zwei Punkten (Legacy `avesmapsConnectOffroadPoints`): die trockene Sehne, sonst die
 * Suche in einer Kiste über beiden Punkten; null, wenn kein Weg hinführt.
 */
export function offroadPathBetween(
    world: OffroadWorld,
    cost: OffroadCost,
    from: { x: number; y: number },
    to: { x: number; y: number },
): OffroadPath | null {
    const box = buildOffroadBox(from.x, from.y, to.x, to.y);
    const dry = chordIsStraight(world, cost, from, to);
    const planes = buildPlanes(
        box,
        world.water,
        world.rivers,
        { search: !dry },
        world.ground,
        [],
        world.heights ?? null,
        world.barrier ?? null,
    );
    const chord = (): OffroadPath =>
        finishPath(
            planes,
            cost,
            [
                [from.x, from.y],
                [to.x, to.y],
            ],
            false,
        );
    if (dry) return chord();
    const found = findPath(planes, cost, from, to);
    if (found === null || !chordIsOpen(world, cost, from, to)) return found;
    // 🔴 Die Suche schätzt auf dem Raster, gerechnet wird danach auf der Linie: Ein Gang, der nur um Rasterbreite neben der Sehne läuft, kann teurer ausfallen als sie
    // (Volltest 2026-11-01: einer von 88 Gängen, +0,2 %). Die Sehne bleibt dann der Weg; „nie teurer als die Gerade“ sichert `offroad-slope-invariants`.
    const straight = chord();
    return straight.time < found.time ? straight : found;
}

/**
 * Zwei aufeinanderfolgende Kartenpunkte bekommen die Gerade angeboten (Legacy
 * `avesmapsOffroadDirectEdgeAllowed`), wenn sie höchstens 15 Meilen trennen ODER der andere Punkt
 * für einen der beiden näher liegt als dessen Ausstieg. Sonst gewönne unter „kürzeste“ die Gerade
 * immer, und die Reise würde zum Drachenflug.
 */
export function directEdgeAllowed(
    model: TravelModel,
    a: { x: number; y: number },
    b: { x: number; y: number },
    exitA: number,
    exitB: number,
): boolean {
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    // Die eingestellten Meilen (WI-0214; vorher las hier niemand den Regler, nur die Konstante).
    if (distance <= werte().directEdgeMiles / model.meilenJeKarteneinheit.wert + TOLERANCE) return true;
    return distance <= Math.max(exitA, exitB) + TOLERANCE;
}
