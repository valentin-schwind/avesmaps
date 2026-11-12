import type { ClosureReason, SeasonWindow } from "@avesmaps3d/shared";
import type { RouteNode } from "./network.ts";
import { werte } from "./einstellungen.ts";
import { simplifyLine } from "./offroad-search.ts";
import { combinedWindow, type SeaClosure } from "./sea-closures.ts";
import { smoothSeaLine } from "./sea-coast.ts";
import { clearOnMask, seaGraphRoute, type CompactSeaGraph } from "./sea-graph-store.ts";

/**
 * Die freie Seefahrt im Planer (WI-0046, Schritt c; Betreiber 2026-09-27: „im Planer hinter einem
 * Schalter neben den Seewegen“). Der Seegraph kommt aus `sea_route_graph` (`sea-derive.ts`); hier wird er
 * für EIN Schiff zur Seeetappe der Route.
 *
 * - **Von Hafen zu Hafen, ohne Kanten im Speicher.** Die Längen stehen je Schiff im Seegraphen. Die Suche
 *   fragt einen Hafen erst, wenn sie ihn erreicht (`hops`), und legt nur die Kanten an, die ihren Weg
 *   verbessern: 328 Häfen hätten 107.000 Kanten, zu viel für den Heap des Workers.
 * - **Gewählt wird nach den Kosten des Küstenabstands**, gemeldet die gefahrene Länge - wie beim
 *   Querfeldein-Aufschlag (`cost_factor`). Nach der Länge hielte das Schiff an Zwischenhäfen, um den
 *   Küstenkurs abzukürzen.
 * - **Das Stück vom Hafen zur Anlegestelle gehört zur Seefahrt**, auch über Land (Betreiber 2026-09-27):
 *   Seine Länge zählt mit, ohne Aufschlag, die Linie beginnt am Hafen.
 * - **Die Linie erst für die gefundene Route** (`line`): der Weg im Seegraphen, geglättet wie jede Seereise
 *   (`smoothSeaLine`, gegen die Wassermaske geprüft) und zum Zeichnen vereinfacht.
 * - **Sperrzeiten** (S5, `sea-closures.ts`): Jede Seereise kennt die Sperrgebiete auf ihrem Weg. Ihre Kante
 *   bekommt das gemeinsame Fenster (`passage`) und den Namen der Gebiete für den Sperrbericht; gesperrt
 *   wird im Router wie bei einem Seeweg. Die Ableitung kennt nur den günstigsten Weg: Liegt auf ihm ein
 *   gesperrtes Gebiet, sucht die Seereise keinen anderen Weg um das Gebiet herum. Der Router kann dann
 *   über andere Häfen fahren oder über Land.
 */

/** Wann eine Seereise befahrbar ist und wie der Sperrbericht sie nennt. */
export interface SeaPassage {
    /** Das Fenster für das Schiff; fehlt es, ist sie immer befahrbar. */
    seasons?: Readonly<Record<string, SeasonWindow>>;
    /** Die Gebiete mit Sperrzeit auf dem Weg, für den Bericht; leer ohne. */
    label: string;
    /** Warum sie außerhalb des Fensters nicht befahrbar ist: der Grund des ersten Gebiets auf dem Weg. */
    reason?: ClosureReason;
    /** Die Fenster schließen einander aus: nie befahrbar. */
    never: boolean;
}

const OPEN: SeaPassage = { label: "", never: false };

/** „Golf von Riva und Vereisung (boreal, subpolar)“: die Meere, dann die vereisenden Zonen in einer Klammer. */
function passageLabel(closures: readonly SeaClosure[]): string {
    const seas = closures.filter((closure) => closure.kind === "meer").map((closure) => closure.name);
    const zones = closures.flatMap((closure) => (closure.kind === "vereisung" ? [closure.zone ?? closure.name] : []));
    return [...seas, ...(zones.length > 0 ? [`Vereisung (${zones.join(", ")})`] : [])].join(" und ");
}

/** So weit darf die vereinfachte Zeichenlinie von der geglätteten abweichen, in Karteneinheiten. */
export const FREE_SEA_DISPLAY_TOLERANCE = 0.02;

type Point = [number, number];

/** Der Seegraph einer Kartendomäne, einmal je Datenstand vorbereitet. */
export class FreeSea {
    readonly graph: CompactSeaGraph;

    constructor(graph: CompactSeaGraph) {
        this.graph = graph;
    }

    /**
     * Die Seefahrt eines Schiffs zwischen den Häfen des Netzes; null, wenn der Seegraph das Schiff nicht
     * kennt (abgeleitet vor einer Änderung des Reisemodells). `storedAs`: das Schiff, unter dem der Graph die
     * Seereisen hält (`seaGraphTransport`, WI-0069) - ein Schiff mit dessen Küstenabstand und Gewässern fährt
     * dieselben Wege und dieselben Sperrzeiten, nur mit eigenem Tempo.
     */
    fleet(
        transport: string,
        speed: number,
        nodes: ReadonlyMap<string, RouteNode>,
        storedAs: string = transport,
    ): SeaFleet | null {
        const index = this.graph.transports.indexOf(storedAs);
        return index < 0 ? null : new SeaFleet(this.graph, index, transport, speed, nodes, storedAs);
    }
}

export class SeaFleet {
    readonly transport: string;
    /** Das Schiff, unter dem der Seegraph Seereisen und Sperrzeiten hält; meist `transport` selbst. */
    private readonly storedAs: string;
    private readonly index: number;
    /** Karteneinheiten je Stunde auf See, wie auf einem Seeweg. */
    readonly speed: number;
    private readonly graph: CompactSeaGraph;
    private readonly pairs: Float32Array;
    private readonly costs: Float32Array;
    private readonly crossed: Uint8Array;
    /** Welche Bits für dieses Schiff sperren können, und die Seereise je Bitmuster. */
    private readonly restricting: number;
    private readonly passages = new Map<number, SeaPassage>();
    /** Je Hafen des Seegraphen seine Kennung, oder null, wenn der Ort im Netz fehlt. */
    private readonly ids: (string | null)[];
    private readonly slots = new Map<string, number>();
    /** Je Hafen die Lage des Orts und die Länge seines Stücks zur Anlegestelle. */
    private readonly at: (Point | null)[];
    private readonly legs: Float64Array;
    /** Die Häfen desselben Wassers, je Hafen über seinen kleinsten erreichbaren Hafen. */
    private readonly groups = new Map<number, string[]>();
    private readonly groupOf: Int32Array;

    constructor(
        graph: CompactSeaGraph,
        index: number,
        transport: string,
        speed: number,
        nodes: ReadonlyMap<string, RouteNode>,
        storedAs: string = transport,
    ) {
        this.graph = graph;
        this.transport = transport;
        this.storedAs = storedAs;
        this.index = index;
        this.speed = speed;
        this.pairs = graph.pairs[index] as Float32Array;
        this.costs = graph.pairCosts[index] as Float32Array;
        this.crossed = graph.pairClosures[index] as Uint8Array;
        this.restricting = graph.closures.reduce(
            (bits, closure, bit) => (closure.windows[storedAs] ? bits | (1 << bit) : bits),
            0,
        );
        const count = graph.ports.length;
        this.ids = graph.ports.map((port) => (nodes.has(port.placeId) ? port.placeId : null));
        this.at = graph.ports.map((port) => {
            const node = nodes.get(port.placeId);
            return node ? [node.x, node.y] : null;
        });
        this.legs = new Float64Array(count);
        this.groupOf = new Int32Array(count).fill(-1);
        for (let slot = 0; slot < count; slot += 1) {
            const id = this.ids[slot];
            const at = this.at[slot];
            if (!id || !at) continue;
            this.slots.set(id, slot);
            const port = graph.ports[slot] as { node: number };
            this.legs[slot] = Math.hypot(
                (graph.nodeX[port.node] as number) - at[0],
                (graph.nodeY[port.node] as number) - at[1],
            );
            let group = slot;
            for (let other = 0; other < slot; other += 1) {
                if (this.ids[other] && !Number.isNaN(this.pairs[slot * count + other] as number)) {
                    group = this.groupOf[other] as number;
                    break;
                }
            }
            this.groupOf[slot] = group;
            const members = this.groups.get(group) ?? [];
            members.push(id);
            this.groups.set(group, members);
        }
    }

    has(id: string): boolean {
        return this.slots.has(id);
    }

    /** Die Häfen, die dieses Schiff anfahren kann: die Orte, die das Wasser erreicht. */
    get ports(): ReadonlySet<string> {
        return new Set(this.slots.keys());
    }

    /** Kann eine Seereise dieses Schiffs überhaupt gesperrt sein? */
    get hasClosures(): boolean {
        return this.restricting !== 0;
    }

    /** Die Seereise durch die Gebiete eines Bitmusters, einmal je Muster gerechnet. */
    private passage(bits: number): SeaPassage {
        const relevant = bits & this.restricting;
        if (relevant === 0) return OPEN;
        let passage = this.passages.get(relevant);
        if (!passage) {
            const closures = this.graph.closures.filter((_, bit) => (relevant >> bit) & 1);
            const window = combinedWindow(closures.map((closure) => closure.windows[this.storedAs] as SeasonWindow));
            passage = {
                ...(window ? { seasons: { [this.transport]: window } } : {}),
                ...(closures[0] ? { reason: closures[0].reason } : {}),
                label: passageLabel(closures),
                never: window === null,
            };
            this.passages.set(relevant, passage);
        }
        return passage;
    }

    /** Die Häfen, die dieses Schiff von `id` aus erreicht, samt `id` selbst. */
    group(id: string): readonly string[] {
        const slot = this.slots.get(id);
        return slot === undefined ? [] : (this.groups.get(this.groupOf[slot] as number) ?? []);
    }

    /**
     * Jeder erreichbare Hafen mit Länge und Kosten der Seereise dorthin, Hafenstücke eingeschlossen, und
     * wann sie befahrbar ist. Eine Seereise, die nie befahrbar ist, fehlt.
     */
    hops(id: string, visit: (to: string, distance: number, cost: number, passage: SeaPassage) => void): void {
        const from = this.slots.get(id);
        if (from === undefined) return;
        const count = this.ids.length;
        const row = from * count;
        const leg = this.legs[from] as number;
        for (let to = 0; to < count; to += 1) {
            const target = this.ids[to];
            if (to === from || !target) continue;
            const length = this.pairs[row + to] as number;
            if (Number.isNaN(length)) continue;
            const passage = this.passage(this.crossed[row + to] as number);
            if (passage.never) continue;
            const legs = leg + (this.legs[to] as number);
            visit(target, legs + length, legs + (this.costs[row + to] as number), passage);
        }
    }

    /** Die gerade Linie zwischen zwei Häfen - Platzhalter, bis `line` die Route kennt. */
    chord(from: string, to: string): Point[] {
        const a = this.at[this.slots.get(from) ?? -1];
        const b = this.at[this.slots.get(to) ?? -1];
        return a && b ? [a, b] : [];
    }

    /**
     * Die Linie der Seereise von Hafen zu Hafen: `geometry` gemessen (Hafen, Anlegestelle, Seegraph,
     * Anlegestelle, Hafen), `display` geglättet und vereinfacht. Null ohne Weg.
     */
    line(from: string, to: string): { geometry: Point[]; display: Point[] } | null {
        const a = this.slots.get(from);
        const b = this.slots.get(to);
        if (a === undefined || b === undefined) return null;
        const route = seaGraphRoute(this.graph, a, b, this.index);
        if (!route) return null;
        const geometry: Point[] = [];
        for (const point of [this.at[a] as Point, ...route.points, this.at[b] as Point]) {
            const last = geometry[geometry.length - 1];
            if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-9) geometry.push(point);
        }
        const mask = this.graph.mask;
        const smooth = smoothSeaLine((ax, ay, bx, by) => clearOnMask(mask, ax, ay, bx, by), geometry);
        return { geometry, display: simplifyLine(smooth.points, werte().freeSeaDisplayTolerance) };
    }
}
