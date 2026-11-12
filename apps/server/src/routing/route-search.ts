import { werte } from "./einstellungen.ts";
import { CLOCK_START, timeWeightFactor, type TravelClock } from "@avesmaps3d/shared";
import { clockStep, type ClockOptions, type RouteTiming } from "./closures.ts";
import type { RequestGraph } from "./request-graph.ts";
import type { Edge, GraphBase } from "./route-edge.ts";

/**
 * Stufe 3 des Routers (Hardening Review M7): die Suche. Dijkstra von Station zu Station auf dem Graphen der
 * Anfrage, mit Legacys Gewicht und Abbruch am Ziel; mit Reisebeginn läuft die Uhr mit und sperrt gesperrte Kanten
 * (`closures.ts`). Die Suche kennt vom Anfragegraphen nur, was `SearchGraph` nennt: Wie er entstand (Anker,
 * Kartenpunkte, Biegen), ist ihr gleich.
 */

/** Was die Suche vom Graphen der Anfrage braucht: die Kanten eines Knotens und die Seekanten des Hafens. */
export type SearchGraph = Pick<RequestGraph, "has" | "edges" | "forEachSeaEdge" | "keepSeaEdge">;

/** Ein Binärheap nach Kosten - Legacy nimmt SplPriorityQueue, die Reihenfolge gleicher Kosten ist offen. */
class Heap {
    private readonly items: { node: string; transport: string | null; cost: number }[] = [];

    get size(): number {
        return this.items.length;
    }

    push(item: { node: string; transport: string | null; cost: number }): void {
        const items = this.items;
        items.push(item);
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if ((items[parent] as { cost: number }).cost <= item.cost) break;
            items[index] = items[parent] as (typeof items)[number];
            index = parent;
        }
        items[index] = item;
    }

    pop(): { node: string; transport: string | null; cost: number } | undefined {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (items.length > 0 && last) {
            let index = 0;
            for (;;) {
                const left = 2 * index + 1;
                const right = left + 1;
                // Das letzte Element sinkt ein, bis kein Kind billiger ist.
                let smallest = index;
                let smallestCost = last.cost;
                if (left < items.length && (items[left] as typeof last).cost < smallestCost) {
                    smallest = left;
                    smallestCost = (items[left] as typeof last).cost;
                }
                if (right < items.length && (items[right] as typeof last).cost < smallestCost) {
                    smallest = right;
                }
                if (smallest === index) break;
                items[index] = items[smallest] as typeof last;
                index = smallest;
            }
            items[index] = last;
        }
        return top;
    }
}

interface LegResult {
    found: boolean;
    nodeIds: string[];
    edges: Edge[];
    cost: number;
    /** Die Uhr am Ziel der Etappe; null ohne Reisebeginn. */
    end: TravelClock | null;
    /** Hat die Suche eine gesperrte Kante übersprungen? Dann lohnt der Vergleichslauf. */
    touched: boolean;
}

/** Die Uhr einer Etappe (WI-0038): wann sie beginnt, und ob die Sperrfenster gelten. */
interface LegClock {
    timing: RouteTiming;
    start: TravelClock;
    /** Im Vergleichslauf aus: dieselbe Suche, nur ohne Fenster. */
    windows: boolean;
    /**
     * Im Lauf des guten Wetters aus (WI-0082, Fassung C): dieselbe Suche ohne Fenster UND ohne den Boden der
     * Jahreszeit - die Route, die diese Reise ohne jede Wirkung der Jahreszeit nähme. Fehlt: Der Boden gilt.
     */
    seasonGround?: boolean;
}

const NOT_FOUND: LegResult = { found: false, nodeIds: [], edges: [], cost: 0, end: null, touched: false };

/** Dijkstra von `start` nach `end`, mit Legacys Gewicht und Abbruch am Ziel. */
export function findLeg(
    view: SearchGraph,
    graph: GraphBase,
    start: string,
    end: string,
    clock: LegClock | null = null,
): LegResult {
    // 🪤 EINMAL je Etappe gelesen, nicht je Kante (WI-0153).
    const norm = werte().weightNormalizerHours;
    if (!view.has(start) || !view.has(end)) return NOT_FOUND;
    if (start === end) {
        return { found: true, nodeIds: [start], edges: [], cost: 0, end: clock?.start ?? null, touched: false };
    }
    const { model, request } = graph;
    const shortest = request.optimize === "shortest";
    const penalty = model.umstiegsaufschlag.wert;
    // Ein Mittel mit Bodenpflicht (Schlitten, WI-0069) fährt ohne Reisebeginn gar nicht: Schnee wird nie angenommen.
    const groundBound = clock ? null : new Set(Object.keys(model.bodenPflicht.wert));
    // Was dieser Lauf von der Jahreszeit gelten lässt (WI-0082): nur die Route des guten Wetters rechnet ohne Boden.
    const clockOptions: ClockOptions = clock?.seasonGround === false ? { seasonGround: false } : {};
    const distance = new Map<string, number>([[start, 0]]);
    const previous = new Map<string, { node: string; edge: Edge }>();
    // Die Uhr gehört zur besten Kette bis zum Knoten, wie die Kosten (Legacy: ein Label je Knoten).
    const clocks = new Map<string, TravelClock>(clock ? [[start, clock.start]] : []);
    let touched = false;
    const settled = new Map<string, number>();
    const heap = new Heap();
    heap.push({ node: start, transport: null, cost: 0 });
    while (heap.size > 0) {
        const item = heap.pop() as { node: string; transport: string | null; cost: number };
        const current = distance.get(item.node) ?? Infinity;
        if (!request.minimizeTransfers && item.node === end) break;
        // Nichtnegative Kanten können das bekannte Ziel von hier nicht mehr verbessern.
        // Kein Heap-Abbruch: ältere Einträge anderer Mittel können inzwischen billigere Knotenkosten haben.
        if (request.minimizeTransfers && current >= (distance.get(end) ?? Infinity)) continue;
        const settledKey = `${item.node}\u0000${item.transport ?? ""}`;
        const already = settled.get(settledKey);
        if (already !== undefined && already <= current) continue;
        settled.set(settledKey, current);
        const here = clocks.get(item.node);
        const relax = (baseEdge: Edge): void => {
            let edge = baseEdge;
            let after: TravelClock | undefined;
            if (groundBound?.has(baseEdge.transport)) return;
            if (clock && here) {
                const step = clockStep(model, clock.timing, here, baseEdge, clockOptions);
                // Kein passender Boden ist keine Sperrzeit: Auch der Vergleichslauf ohne Fenster fährt hier nicht.
                if (!step.usable) return;
                if (clock.windows && !step.open) {
                    touched = true;
                    return;
                }
                // Der Boden der Jahreszeit verlängert die Kante und zählt in der Wegwahl (E2); wirkt der Boden über der
                // Schneegrenze mit, trägt die Kante, was davon Schnee ist (`snowOf` in `route-result.ts`).
                if (step.ground) {
                    edge = {
                        ...baseEdge,
                        time: baseEdge.time * step.ground.factor,
                        ground: step.ground,
                        ...(step.snow
                            ? { snow: { condition: step.snow.condition, time: baseEdge.time * step.snow.extra } }
                            : {}),
                    };
                }
                after = step.after;
            }
            let weight = shortest ? edge.distance : edge.time * timeWeightFactor(model, edge.transport, norm);
            if (request.minimizeTransfers && item.transport !== null && edge.transport !== item.transport) {
                weight += penalty;
            }
            const alternative = current + weight;
            if (alternative < (distance.get(edge.to) ?? Infinity)) {
                distance.set(edge.to, alternative);
                // Eine Seekante kommt in einer geteilten Hülle (`forEachSeaEdge`) und wird erst hier ein Objekt.
                previous.set(edge.to, { node: item.node, edge: edge.freeSea ? view.keepSeaEdge(edge) : edge });
                if (after) clocks.set(edge.to, after);
                heap.push({ node: edge.to, transport: edge.transport, cost: alternative });
            }
        };
        for (const baseEdge of view.edges(item.node)) relax(baseEdge);
        view.forEachSeaEdge(item.node, relax);
    }
    if (!previous.has(end)) return { ...NOT_FOUND, touched };
    const nodeIds = [end];
    const edges: Edge[] = [];
    let cursor = end;
    while (cursor !== start) {
        const step = previous.get(cursor);
        if (!step) break;
        edges.unshift(step.edge);
        cursor = step.node;
        nodeIds.unshift(cursor);
    }
    return { found: true, nodeIds, edges, cost: distance.get(end) ?? 0, end: clocks.get(end) ?? null, touched };
}

/** Alle Etappen einer Route gefunden: ihre Knoten und Kanten hintereinander, `legSizes` die Kanten je Etappe. */
export interface FoundLegs {
    nodeIds: string[];
    edges: Edge[];
    legSizes: number[];
    cost: number;
    legs: TimedLeg[];
    /** Die Uhr am Ziel; null ohne Reisebeginn. */
    end: TravelClock | null;
}

/** Eine Etappe ohne Weg beendet die Suche: welche, und die Uhr an ihrem Start. */
export interface FailedLegs {
    failedLegIndex: number;
    start: TravelClock | null;
}

/** Mehr Seereisen als das Budget erlaubt (`sea_legs:<n>`): Die Suche hat abgebrochen. */
export interface OversizedLegs {
    tooLarge: string;
}

/** Die Etappen zwischen den Stationen, nacheinander auf demselben Graphen; die erste ohne Weg beendet. */
export function findLegs(
    view: SearchGraph,
    graph: GraphBase,
    stations: readonly string[],
    timing: RouteTiming | null = null,
): FoundLegs | FailedLegs | OversizedLegs {
    const nodeIds: string[] = [];
    const edges: Edge[] = [];
    const legSizes: number[] = [];
    const legs: TimedLeg[] = [];
    let cost = 0;
    // Die Uhr läuft über die Zwischenziele weiter (Legacy `end_hours` → nächste Etappe).
    let clock = timing ? CLOCK_START : null;
    // Ohne Reisebeginn ist eine Etappe zwischen denselben Stationen immer dieselbe: Sie wird je Anfrage
    // einmal gesucht. 100 Wegpunkte im Wechsel Riva/Al'Anfa rechneten sonst 99-mal dieselbe Seereise
    // und liefen auf Stage in die Zeitgrenze (Befund 1 des Rollouts, 2026-09-27). Mit Reisebeginn hängt
    // jede Etappe an ihrer Uhr und wird eigens gesucht.
    const found = new Map<string, LegResult>();
    let seaLegs = 0;
    for (let index = 0; index < stations.length - 1; index += 1) {
        const from = stations[index] as string;
        const to = stations[index + 1] as string;
        const legClock = timing && clock ? { timing, start: clock, windows: true } : null;
        const key = `${from}\u0000${to}`;
        const leg = (legClock ? undefined : found.get(key)) ?? findLeg(view, graph, from, to, legClock);
        if (!legClock) found.set(key, leg);
        // Das Budget der Seereisen (`ROUTE_FREE_SEA_LIMIT`): Die Suche bricht ab, sobald es überläuft, und
        // rechnet nicht erst die ganze Reise.
        seaLegs += leg.edges.filter((edge) => edge.freeSea).length;
        if (seaLegs > werte().routeFreeSeaLimit) return { tooLarge: `sea_legs:${String(seaLegs)}` };
        if (!leg.found) return { failedLegIndex: index, start: clock };
        legs.push({
            start: clock ?? CLOCK_START,
            touched: leg.touched,
            nodeIds: leg.nodeIds,
            edges: leg.edges,
            cost: leg.cost,
        });
        nodeIds.push(...(nodeIds.length === 0 ? leg.nodeIds : leg.nodeIds.slice(1)));
        edges.push(...leg.edges);
        legSizes.push(leg.edges.length);
        cost += leg.cost;
        clock = leg.end;
    }
    return { nodeIds, edges, legSizes, cost, legs, end: clock };
}

/** Eine gefundene Etappe mit ihrer Uhr - für den Vergleichslauf der Sperren. */
export interface TimedLeg {
    start: TravelClock;
    touched: boolean;
    nodeIds: string[];
    edges: Edge[];
    cost: number;
}
