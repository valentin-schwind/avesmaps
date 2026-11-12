import type { SeaClosure } from "./sea-closures.ts";

/**
 * Der Seegraph im Speicher des Routing-Workers und in `sea_route_graph.graph` (WI-0046, S1): der
 * Sichtbarkeitsgraph mit A*-Brücken, kompakt als typisierte Felder. Claudios Budget (2026-09-27):
 * 64 MB Heap je Worker, Meldung ab 56 MB, heute belegt 42,5 MB - darum Knotennummern als 16 Bit,
 * Aufschläge als 16-Bit-Faktoren und das Wasser als Bitmaske statt als Raster.
 *
 * - **Kanten** sind ungerichtet und einmal gespeichert. Eine gerade Kante hat die Länge ihrer Luftlinie,
 *   eine Brücke (A* durch einen Sund) ihre gespeicherte Linie und Länge.
 * - **Kosten je Seeschiff** sind Länge mal Aufschlag für den Küstenabstand (`sea-coast.ts`), als Faktor
 *   auf Tausendstel gerundet. Die Vorberechnung rechnet mit genau diesen gerundeten Werten, damit die
 *   Abstände der Häfen (`pairs`) und der Weg, den der Worker später zeichnet, übereinstimmen.
 * - **Häfen** tragen ihre Anlegestelle als eigenen Knoten; `pairs` hält je Schiff die gefahrene Länge
 *   von Anlegestelle zu Anlegestelle auf dem günstigsten Weg, NaN ohne Verbindung, `pairCosts` seine
 *   Kosten. 🔴 Die Route wählt nach den Kosten: Nach der Länge wären zwei küstengerechte Teilstücke über
 *   einen Zwischenhafen oft kürzer als der eine Küstenkurs, und das Schiff hielte grundlos an (Havena -
 *   Kuslik über Westenende, gemessen 2026-09-27).
 * - **Die Wassermaske** ist das Raster als Bit je Zelle: Damit prüft der Worker, dass die geglättete
 *   Linie kein Land streift, ohne das Raster zu halten.
 * - **Sperrgebiete** (S5, `sea-closures.ts`): `pairClosures` hält je Schiff und Hafenpaar ein Bit je
 *   Gebiet, durch das der Weg fährt. Gerechnet über den Baum der Suche: Der Weg zu einem Knoten fährt
 *   durch die Gebiete des Weges zu seinem Vorgänger und die der letzten Kante.
 */

/** Steigt, wenn sich das Binärformat ändert; ein älterer Stand wird dann nicht gelesen, sondern neu abgeleitet. */
export const SEA_GRAPH_FORMAT = 3;
/** Faktoren als Tausendstel. */
const FACTOR_SCALE = 1000;
/** Der Aufschlag einer Kante, die ein Schiff nicht fahren darf (WI-0069); jeder echte ist mindestens `FACTOR_SCALE`. */
export const BLOCKED = 0;

export interface SeaGraphPort {
    /** `place.public_id` des Hafens. */
    placeId: string;
    /** Sein Knoten: die Anlegestelle. */
    node: number;
}

export interface WaterMask {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Ein Bit je Zelle, gesetzt, wo die Zellmitte im Wasser liegt. */
    bits: Uint8Array;
}

export interface CompactSeaGraph {
    format: number;
    /** Die Seeschiffe in der Reihenfolge der Kosten und Paare. */
    transports: string[];
    nodeX: Float32Array;
    nodeY: Float32Array;
    edgeA: Uint16Array;
    edgeB: Uint16Array;
    /** Je Kante und Schiff der Aufschlag in Tausendsteln, `edge * transports + transport`. */
    factors: Uint16Array;
    /** Die Kanten, die Brücken sind, aufsteigend; dazu Länge und Linie (von A nach B). */
    bridgeEdges: Uint32Array;
    bridgeLengths: Float32Array;
    bridgeOffsets: Uint32Array;
    bridgePoints: Float32Array;
    ports: SeaGraphPort[];
    /** Je Schiff die Länge von Anlegestelle zu Anlegestelle, `from * ports + to`. */
    pairs: Float32Array[];
    /** Je Schiff die Kosten desselben Weges (Länge mal Aufschlag), gleich geordnet. */
    pairCosts: Float32Array[];
    /** Die Sperrgebiete, Bit `i` gehört zu `closures[i]`. */
    closures: SeaClosure[];
    /** Je Schiff die Gebiete, durch die der Weg eines Hafenpaars fährt, gleich geordnet. */
    pairClosures: Uint8Array[];
    mask: WaterMask;
    /** Je Knoten seine Kanten, beim Lesen gebaut: `incident[incidentOffsets[n] .. incidentOffsets[n+1]]`. */
    incidentOffsets: Uint32Array;
    incident: Uint32Array;
    /** Je Kante die gefahrene Länge, beim Lesen gebaut: Luftlinie oder Länge der Brücke. */
    lengths: Float32Array;
}

export interface GraphSnapshot {
    xs: readonly number[];
    ys: readonly number[];
    edges: readonly {
        a: number;
        b: number;
        distance: number;
        costs: readonly number[];
        via: readonly [number, number][] | null;
    }[];
}

/** Welche Kanten jeder Knoten berührt. */
function incidence(
    nodeCount: number,
    edgeA: Uint16Array,
    edgeB: Uint16Array,
): { offsets: Uint32Array; incident: Uint32Array } {
    const degree = new Uint32Array(nodeCount + 1);
    for (let edge = 0; edge < edgeA.length; edge += 1) {
        degree[(edgeA[edge] as number) + 1] = (degree[(edgeA[edge] as number) + 1] as number) + 1;
        degree[(edgeB[edge] as number) + 1] = (degree[(edgeB[edge] as number) + 1] as number) + 1;
    }
    for (let node = 1; node <= nodeCount; node += 1)
        degree[node] = (degree[node] as number) + (degree[node - 1] as number);
    const offsets = Uint32Array.from(degree);
    const fill = Uint32Array.from(degree);
    const incident = new Uint32Array(edgeA.length * 2);
    for (let edge = 0; edge < edgeA.length; edge += 1) {
        for (const node of [edgeA[edge] as number, edgeB[edge] as number]) {
            incident[fill[node] as number] = edge;
            fill[node] = (fill[node] as number) + 1;
        }
    }
    return { offsets, incident };
}

/** Die Stelle einer Brücke unter den Brückenkanten, oder -1. */
function bridgeIndex(graph: CompactSeaGraph, edge: number): number {
    let low = 0;
    let high = graph.bridgeEdges.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const value = graph.bridgeEdges[middle] as number;
        if (value === edge) return middle;
        if (value < edge) low = middle + 1;
        else high = middle - 1;
    }
    return -1;
}

/** Die gefahrene Länge jeder Kante: Luftlinie, bei einer Brücke ihre gespeicherte Länge. */
function edgeLengths(
    graph: Pick<CompactSeaGraph, "nodeX" | "nodeY" | "edgeA" | "edgeB" | "bridgeEdges" | "bridgeLengths">,
): Float32Array {
    const lengths = new Float32Array(graph.edgeA.length);
    for (let edge = 0; edge < graph.edgeA.length; edge += 1) {
        const a = graph.edgeA[edge] as number;
        const b = graph.edgeB[edge] as number;
        lengths[edge] = Math.hypot(
            (graph.nodeX[b] as number) - (graph.nodeX[a] as number),
            (graph.nodeY[b] as number) - (graph.nodeY[a] as number),
        );
    }
    graph.bridgeEdges.forEach((edge, index) => {
        lengths[edge] = graph.bridgeLengths[index] as number;
    });
    return lengths;
}

/** Ein kleiner Heap aus (Schlüssel, Knoten). */
class NodeHeap {
    private keys: number[] = [];
    private nodes: number[] = [];
    get size(): number {
        return this.keys.length;
    }
    push(key: number, node: number): void {
        this.keys.push(key);
        this.nodes.push(node);
        let position = this.keys.length - 1;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if ((this.keys[parent] as number) <= key) break;
            this.keys[position] = this.keys[parent] as number;
            this.nodes[position] = this.nodes[parent] as number;
            position = parent;
        }
        this.keys[position] = key;
        this.nodes[position] = node;
    }
    pop(): number {
        const top = this.nodes[0] as number;
        const lastKey = this.keys.pop() as number;
        const lastNode = this.nodes.pop() as number;
        if (this.keys.length > 0) {
            let position = 0;
            for (;;) {
                let child = 2 * position + 1;
                if (child >= this.keys.length) break;
                if (child + 1 < this.keys.length && (this.keys[child + 1] as number) < (this.keys[child] as number))
                    child += 1;
                if ((this.keys[child] as number) >= lastKey) break;
                this.keys[position] = this.keys[child] as number;
                this.nodes[position] = this.nodes[child] as number;
                position = child;
            }
            this.keys[position] = lastKey;
            this.nodes[position] = lastNode;
        }
        return top;
    }
}

interface Search {
    cost: Float64Array;
    length: Float64Array;
    arrivedBy: Int32Array;
    previous: Int32Array;
    /** Die Knoten in der Reihenfolge, in der sie fest wurden; `settled` davon sind belegt. */
    order: Int32Array;
    settled: number;
}

/**
 * Dijkstra (ohne Ziel) oder A* (mit Ziel) nach den Kosten eines Schiffs. Die Luftlinie schätzt nie zu
 * hoch, weil kein Faktor unter 1 liegt.
 */
function search(graph: CompactSeaGraph, from: number, transport: number, to = -1): Search {
    const count = graph.nodeX.length;
    const cost = new Float64Array(count).fill(Infinity);
    const length = new Float64Array(count).fill(Infinity);
    const arrivedBy = new Int32Array(count).fill(-1);
    const previous = new Int32Array(count).fill(-1);
    const done = new Uint8Array(count);
    const order = new Int32Array(count);
    let settled = 0;
    const transports = graph.transports.length;
    const tx = to >= 0 ? (graph.nodeX[to] as number) : 0;
    const ty = to >= 0 ? (graph.nodeY[to] as number) : 0;
    const estimate = (node: number): number =>
        to >= 0 ? Math.hypot((graph.nodeX[node] as number) - tx, (graph.nodeY[node] as number) - ty) : 0;
    cost[from] = 0;
    length[from] = 0;
    const heap = new NodeHeap();
    heap.push(estimate(from), from);
    while (heap.size > 0) {
        const node = heap.pop();
        if (done[node] === 1) continue;
        done[node] = 1;
        order[settled] = node;
        settled += 1;
        if (node === to) break;
        for (
            let slot = graph.incidentOffsets[node] as number;
            slot < (graph.incidentOffsets[node + 1] as number);
            slot += 1
        ) {
            const edge = graph.incident[slot] as number;
            const other = graph.edgeA[edge] === node ? (graph.edgeB[edge] as number) : (graph.edgeA[edge] as number);
            if (done[other] === 1) continue;
            const factor = graph.factors[edge * transports + transport] as number;
            if (factor === BLOCKED) continue;
            const stretch = graph.lengths[edge] as number;
            const next = (cost[node] as number) + (stretch * factor) / FACTOR_SCALE;
            if (next >= (cost[other] as number)) continue;
            cost[other] = next;
            length[other] = (length[node] as number) + stretch;
            arrivedBy[other] = edge;
            previous[other] = node;
            heap.push(next + estimate(other), other);
        }
    }
    return { cost, length, arrivedBy, previous, order, settled };
}

/**
 * Je Kante die Bits der Sperrgebiete, durch die sie fährt: die Linie (oder die Brücke) in Vierteln einer
 * Zelle abgetastet, auf dem Raster der Wassermaske.
 */
function edgeClosures(graph: CompactSeaGraph, cells: Uint8Array): Uint8Array {
    const { minX, minY, cell, cols, rows } = graph.mask;
    const bits = new Uint8Array(graph.edgeA.length);
    const step = cell * 0.25;
    const along = (ax: number, ay: number, bx: number, by: number): number => {
        let found = 0;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let sample = 0; sample <= steps; sample += 1) {
            const t = sample / steps;
            const column = Math.floor((ax + (bx - ax) * t - minX) / cell);
            const row = Math.floor((ay + (by - ay) * t - minY) / cell);
            if (column >= 0 && row >= 0 && column < cols && row < rows) found |= cells[row * cols + column] as number;
        }
        return found;
    };
    let bridge = 0;
    for (let edge = 0; edge < graph.edgeA.length; edge += 1) {
        const a = graph.edgeA[edge] as number;
        const b = graph.edgeB[edge] as number;
        if (graph.bridgeEdges[bridge] === edge) {
            // Eine Brücke fährt ihre gespeicherte Linie, von A über die Stützpunkte nach B.
            let px = graph.nodeX[a] as number;
            let py = graph.nodeY[a] as number;
            for (
                let point = graph.bridgeOffsets[bridge] as number;
                point < (graph.bridgeOffsets[bridge + 1] as number);
                point += 1
            ) {
                const x = graph.bridgePoints[point * 2] as number;
                const y = graph.bridgePoints[point * 2 + 1] as number;
                bits[edge] = (bits[edge] as number) | along(px, py, x, y);
                px = x;
                py = y;
            }
            bits[edge] = (bits[edge] as number) | along(px, py, graph.nodeX[b] as number, graph.nodeY[b] as number);
            bridge += 1;
            continue;
        }
        bits[edge] = along(
            graph.nodeX[a] as number,
            graph.nodeY[a] as number,
            graph.nodeX[b] as number,
            graph.nodeY[b] as number,
        );
    }
    return bits;
}

/**
 * Baut den kompakten Graphen aus dem Sichtbarkeitsgraphen und rechnet je Schiff die Längen von Hafen zu
 * Hafen (ein Dijkstra je Hafen und Schiff). `closures` bringt die Sperrgebiete mit ihren Zellen auf dem
 * Raster der Wassermaske.
 */
export function compactSeaGraph(
    snapshot: GraphSnapshot,
    transports: readonly string[],
    ports: readonly SeaGraphPort[],
    mask: WaterMask,
    closures: { list: readonly SeaClosure[]; cells: Uint8Array } = { list: [], cells: new Uint8Array(0) },
    /** Je Schiff die Kanten, die es nicht fahren darf (`sea-waters.ts`, WI-0069); gespeichert als Aufschlag 0. */
    blocked: readonly (Uint8Array | null)[] = [],
): CompactSeaGraph {
    const nodeCount = snapshot.xs.length;
    if (nodeCount > 65_535) throw new Error(`Seegraph mit ${String(nodeCount)} Knoten passt nicht in 16 Bit`);
    const edgeCount = snapshot.edges.length;
    const edgeA = new Uint16Array(edgeCount);
    const edgeB = new Uint16Array(edgeCount);
    const factors = new Uint16Array(edgeCount * transports.length);
    const bridgeEdges: number[] = [];
    const bridgeLengths: number[] = [];
    const bridgeOffsets: number[] = [0];
    const bridgePoints: number[] = [];
    snapshot.edges.forEach((edge, index) => {
        edgeA[index] = edge.a;
        edgeB[index] = edge.b;
        transports.forEach((_, transport) => {
            const factor = edge.distance > 0 ? (edge.costs[transport] as number) / edge.distance : 1;
            factors[index * transports.length + transport] =
                blocked[transport]?.[index] === 1
                    ? BLOCKED
                    : Math.min(65_535, Math.max(FACTOR_SCALE, Math.round(factor * FACTOR_SCALE)));
        });
        if (edge.via) {
            bridgeEdges.push(index);
            bridgeLengths.push(edge.distance);
            for (const [x, y] of edge.via) bridgePoints.push(x, y);
            bridgeOffsets.push(bridgePoints.length / 2);
        }
    });
    const { offsets, incident } = incidence(nodeCount, edgeA, edgeB);
    const bridges = { bridgeEdges: Uint32Array.from(bridgeEdges), bridgeLengths: Float32Array.from(bridgeLengths) };
    const nodeX = Float32Array.from(snapshot.xs);
    const nodeY = Float32Array.from(snapshot.ys);
    const graph: CompactSeaGraph = {
        format: SEA_GRAPH_FORMAT,
        transports: [...transports],
        nodeX,
        nodeY,
        edgeA,
        edgeB,
        factors,
        ...bridges,
        bridgeOffsets: Uint32Array.from(bridgeOffsets),
        bridgePoints: Float32Array.from(bridgePoints),
        ports: [...ports],
        pairs: [],
        pairCosts: [],
        closures: [...closures.list],
        pairClosures: [],
        mask,
        incidentOffsets: offsets,
        incident,
        lengths: edgeLengths({ nodeX, nodeY, edgeA, edgeB, ...bridges }),
    };
    const portCount = ports.length;
    const edgeBits = closures.list.length > 0 ? edgeClosures(graph, closures.cells) : null;
    const nodeBits = new Uint8Array(nodeCount);
    for (let transport = 0; transport < transports.length; transport += 1) {
        const pairs = new Float32Array(portCount * portCount).fill(Number.NaN);
        const costs = new Float32Array(portCount * portCount).fill(Number.NaN);
        const crossed = new Uint8Array(portCount * portCount);
        ports.forEach((port, from) => {
            const result = search(graph, port.node, transport);
            if (edgeBits) {
                // In der Reihenfolge der Suche ist der Vorgänger immer schon gerechnet.
                nodeBits[port.node] = 0;
                for (let index = 1; index < result.settled; index += 1) {
                    const node = result.order[index] as number;
                    nodeBits[node] =
                        (nodeBits[result.previous[node] as number] as number) |
                        (edgeBits[result.arrivedBy[node] as number] as number);
                }
            }
            ports.forEach((other, to) => {
                const reached = result.length[other.node] as number;
                if (!Number.isFinite(reached)) return;
                pairs[from * portCount + to] = reached;
                costs[from * portCount + to] = result.cost[other.node] as number;
                if (edgeBits) crossed[from * portCount + to] = nodeBits[other.node] as number;
            });
        });
        graph.pairs.push(pairs);
        graph.pairCosts.push(costs);
        graph.pairClosures.push(crossed);
    }
    return graph;
}

/**
 * Der Weg eines Schiffs zwischen zwei Häfen über den Graphen: Knoten und Brückenlinien in Fahrtrichtung,
 * von Anlegestelle zu Anlegestelle, und seine Länge; null ohne Verbindung.
 */
export function seaGraphRoute(
    graph: CompactSeaGraph,
    fromPort: number,
    toPort: number,
    transport: number,
): { points: [number, number][]; distance: number } | null {
    const from = (graph.ports[fromPort] as SeaGraphPort).node;
    const to = (graph.ports[toPort] as SeaGraphPort).node;
    const result = search(graph, from, transport, to);
    if (!Number.isFinite(result.cost[to] as number)) return null;
    const hops: { edge: number; node: number }[] = [];
    for (let node = to; node !== from; node = result.previous[node] as number) {
        hops.push({ edge: result.arrivedBy[node] as number, node });
    }
    hops.reverse();
    const points: [number, number][] = [[graph.nodeX[from] as number, graph.nodeY[from] as number]];
    let at = from;
    for (const hop of hops) {
        const bridge = bridgeIndex(graph, hop.edge);
        if (bridge >= 0) {
            const line: [number, number][] = [];
            for (
                let point = graph.bridgeOffsets[bridge] as number;
                point < (graph.bridgeOffsets[bridge + 1] as number);
                point += 1
            ) {
                line.push([graph.bridgePoints[point * 2] as number, graph.bridgePoints[point * 2 + 1] as number]);
            }
            // Die Linie ist von A nach B gespeichert; in Gegenrichtung rückwärts.
            if (graph.edgeA[hop.edge] !== at) line.reverse();
            points.push(...line);
        }
        points.push([graph.nodeX[hop.node] as number, graph.nodeY[hop.node] as number]);
        at = hop.node;
    }
    return { points, distance: result.length[to] as number };
}

/** Liegt die Strecke ganz über Wasserzellen der Maske? Wie `clearOverWater`, auf der Bitmaske. */
export function clearOnMask(mask: WaterMask, ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (mask.cell * 0.25)));
    const wet = (column: number, row: number): boolean => {
        if (column < 0 || row < 0 || column >= mask.cols || row >= mask.rows) return false;
        const index = row * mask.cols + column;
        return ((mask.bits[index >> 3] as number) & (1 << (index & 7))) !== 0;
    };
    let previousColumn = -1;
    let previousRow = -1;
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const column = Math.floor((ax + (bx - ax) * t - mask.minX) / mask.cell);
        const row = Math.floor((ay + (by - ay) * t - mask.minY) / mask.cell);
        if (column === previousColumn && row === previousRow) continue;
        if (!wet(column, row)) return false;
        if (previousColumn >= 0 && column !== previousColumn && row !== previousRow) {
            if (!wet(previousColumn, row) || !wet(column, previousRow)) return false;
        }
        previousColumn = column;
        previousRow = row;
    }
    return true;
}

/** Die Wassermaske aus dem Raster. */
export function waterMask(grid: {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    water: Uint8Array;
}): WaterMask {
    const bits = new Uint8Array(Math.ceil(grid.water.length / 8));
    for (let index = 0; index < grid.water.length; index += 1) {
        if (grid.water[index] === 1) bits[index >> 3] = (bits[index >> 3] as number) | (1 << (index & 7));
    }
    return { minX: grid.minX, minY: grid.minY, cell: grid.cell, cols: grid.cols, rows: grid.rows, bits };
}

/** Was der Graph im Speicher belegt, in Byte. */
export function seaGraphBytes(graph: CompactSeaGraph): number {
    const arrays = [
        graph.nodeX,
        graph.nodeY,
        graph.edgeA,
        graph.edgeB,
        graph.factors,
        graph.bridgeEdges,
        graph.bridgeLengths,
        graph.bridgeOffsets,
        graph.bridgePoints,
        graph.mask.bits,
        graph.incidentOffsets,
        graph.incident,
        graph.lengths,
        ...graph.pairs,
        ...graph.pairCosts,
        ...graph.pairClosures,
    ];
    return arrays.reduce((sum, array) => sum + array.byteLength, 0) + graph.ports.length * 64;
}

// --- Binärformat ----------------------------------------------------------------------------------
// [u32 Länge des Kopfes][Kopf als JSON][Auffüllung auf 4 Byte][Felder in fester Reihenfolge, je auf 4 Byte aufgefüllt]

type Section = Float32Array | Uint16Array | Uint32Array | Uint8Array;

interface Header {
    format: number;
    transports: string[];
    ports: SeaGraphPort[];
    closures: SeaClosure[];
    mask: Omit<WaterMask, "bits">;
    lengths: number[];
}

const pad = (size: number): number => (4 - (size % 4)) % 4;

function sections(graph: CompactSeaGraph): Section[] {
    return [
        graph.nodeX,
        graph.nodeY,
        graph.edgeA,
        graph.edgeB,
        graph.factors,
        graph.bridgeEdges,
        graph.bridgeLengths,
        graph.bridgeOffsets,
        graph.bridgePoints,
        graph.mask.bits,
        ...graph.pairs,
        ...graph.pairCosts,
        ...graph.pairClosures,
    ];
}

export function encodeSeaGraph(graph: CompactSeaGraph): Buffer {
    const parts = sections(graph);
    const { minX, minY, cell, cols, rows } = graph.mask;
    const header: Header = {
        format: graph.format,
        transports: graph.transports,
        ports: graph.ports,
        closures: graph.closures,
        mask: { minX, minY, cell, cols, rows },
        lengths: parts.map((part) => part.length),
    };
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
    const chunks: Buffer[] = [];
    const size = Buffer.alloc(4);
    size.writeUInt32LE(headerBytes.length);
    chunks.push(size, headerBytes, Buffer.alloc(pad(headerBytes.length)));
    for (const part of parts) {
        const bytes = Buffer.from(part.buffer, part.byteOffset, part.byteLength);
        chunks.push(bytes, Buffer.alloc(pad(bytes.length)));
    }
    return Buffer.concat(chunks);
}

export function decodeSeaGraph(buffer: Uint8Array, options: { adopt?: boolean } = {}): CompactSeaGraph {
    // Eine eigene, ausgerichtete Kopie: Die Felder lesen direkt aus ihr. Mit `adopt` ist der Puffer selbst so einer
    // (frisch gelesen, `readSlices`: ab Byte 0, ganz ausgefüllt, nicht geteilt) und wird übernommen - das spart die
    // Kopie von 16 MiB neben dem Original (WI-0071).
    let memory: ArrayBuffer;
    if (
        options.adopt === true &&
        buffer.byteOffset === 0 &&
        buffer.buffer instanceof ArrayBuffer &&
        buffer.buffer.byteLength === buffer.byteLength
    ) {
        memory = buffer.buffer;
    } else {
        const copy = new Uint8Array(buffer.byteLength);
        copy.set(buffer);
        memory = copy.buffer;
    }
    const bytes = new Uint8Array(memory);
    const view = new DataView(memory);
    const headerLength = view.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as Header;
    if (header.format !== SEA_GRAPH_FORMAT)
        throw new Error(`Seegraph im Format ${String(header.format)}, erwartet ${String(SEA_GRAPH_FORMAT)}`);
    let offset = 4 + headerLength + pad(headerLength);
    const lengths = [...header.lengths];
    const take = <T extends Section>(
        make: (buffer: ArrayBuffer, offset: number, length: number) => T,
        width: number,
    ): T => {
        const length = lengths.shift() as number;
        const array = make(memory, offset, length);
        offset += length * width + pad(length * width);
        return array;
    };
    const f32 = (b: ArrayBuffer, o: number, l: number): Float32Array => new Float32Array(b, o, l);
    const u16 = (b: ArrayBuffer, o: number, l: number): Uint16Array => new Uint16Array(b, o, l);
    const u32 = (b: ArrayBuffer, o: number, l: number): Uint32Array => new Uint32Array(b, o, l);
    const u8 = (b: ArrayBuffer, o: number, l: number): Uint8Array => new Uint8Array(b, o, l);
    const nodeX = take(f32, 4);
    const nodeY = take(f32, 4);
    const edgeA = take(u16, 2);
    const edgeB = take(u16, 2);
    const factors = take(u16, 2);
    const bridgeEdges = take(u32, 4);
    const bridgeLengths = take(f32, 4);
    const bridgeOffsets = take(u32, 4);
    const bridgePoints = take(f32, 4);
    const bits = take(u8, 1);
    const pairs = header.transports.map(() => take(f32, 4));
    const pairCosts = header.transports.map(() => take(f32, 4));
    const pairClosures = header.transports.map(() => take(u8, 1));
    const { offsets, incident } = incidence(nodeX.length, edgeA, edgeB);
    return {
        format: header.format,
        transports: header.transports,
        nodeX,
        nodeY,
        edgeA,
        edgeB,
        factors,
        bridgeEdges,
        bridgeLengths,
        bridgeOffsets,
        bridgePoints,
        ports: header.ports,
        pairs,
        pairCosts,
        closures: header.closures,
        pairClosures,
        mask: { ...header.mask, bits },
        incidentOffsets: offsets,
        incident,
        lengths: edgeLengths({ nodeX, nodeY, edgeA, edgeB, bridgeEdges, bridgeLengths }),
    };
}
