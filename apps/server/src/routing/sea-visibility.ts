import type { Queryable } from "../database.ts";
import { cellAt, nearestWaterCell, WATER_REGION_TYPES, type SeaGrid } from "./sea-grid.ts";
import type { CoastProfile } from "@avesmaps3d/shared";
import { lineCost } from "./sea-coast.ts";
import type { GraphSnapshot } from "./sea-graph-store.ts";
import { clearOverWater, type SeaSearch } from "./sea-search.ts";

/**
 * Der Sichtbarkeitsgraph des freien Seeroutings (WI-0046, Benchmark): Knoten sind die Ecken der Küste,
 * an denen das Land ins Wasser ragt (Kaps, Landzungen, Inselspitzen), Kanten die geraden Linien über
 * Wasser zwischen ihnen. Der kürzeste Weg um Hindernisse läuft immer über solche Ecken; Dijkstra auf
 * dem Graphen liefert ihn ohne Raster-Treppe.
 *
 * - **Ecken** kommen aus der vereinigten Wasserfläche, um `inset` nach innen geschoben und mit
 *   `tolerance` vereinfacht (PostGIS): ohne Schieben lägen sie auf der Küste, ohne Vereinfachen wäre
 *   jede Zacke der Zeichnung ein Knoten. Nur Ecken, an denen die Wasserfläche nach innen knickt.
 * - **Kanten** nur, wo die Linie an beiden Ecken an der Küste vorbeistreicht (Tangente) - jede andere
 *   Kante ist nie Teil eines kürzesten Wegs - und wo sie über befahrbare Zellen des Rasters läuft
 *   (`clearOverWater`), wie bei A*.
 * - **Brücken:** Zwei Knoten, die höchstens `reach` auseinanderliegen und sich nicht sehen, verbindet
 *   ein kurzer A*-Weg. Ohne sie fände der Graph durch Sunde und Fjorde, schmaler als die eingerückte
 *   Küste, keinen Weg (gemessen: jede zweite Reise über 10 % zu lang, mit Reichweite 16 keine).
 * - **Ringe:** Jede Ecke gibt es in mehreren Abständen zur Küste (`offsets`), damit jedes Schiff seinen
 *   bevorzugten Küstenabstand findet (S7). Brücken nur im innersten Ring.
 * - **Gewichte je Schiffstyp** (`weigh`): Jede Kante kostet ihre Länge mal dem Aufschlag für ihren
 *   Küstenabstand (`sea-coast.ts`). Die Kanten bleiben dieselben, gewählt wird je Schiff anders.
 * - **Häfen** hängen sich als eigene Knoten an: an jede Ecke und jeden Hafen, den ihre Anlegestelle sieht.
 *   Ein neuer Hafen braucht deshalb keinen Neubau, nur sein Anhängen.
 */

export interface VisibilityStats {
    corners: number;
    /** Paare im selben Wasserteil. */
    pairs: number;
    /** Davon an beiden Enden tangential - nur sie werden auf Sicht geprüft. */
    tangent: number;
    edges: number;
    /** Kanten über einen kurzen A*-Weg, wo nahe Knoten keine Sicht haben (enge Sunde, Fjorde). */
    bridges: number;
    ms: number;
}

/** Die Ringe der eingerückten, vereinfachten Wasserfläche; Wasser liegt links jeder Laufrichtung. */
export async function loadCoastRings(
    database: Queryable,
    mapDomainId: string,
    inset: number,
    tolerance: number,
): Promise<[number, number][][]> {
    const rows = await database<{ geometry: string }[]>`
        WITH w AS (
            SELECT ST_Union(ST_MakeValid(a.geom)) AS g
            FROM region_area a
            JOIN region r ON r.id = a.region_id AND r.is_active
            WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
              AND r.region_type IN ${database([...WATER_REGION_TYPES])}
        )
        SELECT ST_AsGeoJSON(ST_ForcePolygonCCW((d).geom)) AS geometry
        FROM (SELECT ST_Dump(ST_SimplifyPreserveTopology(ST_Buffer(w.g, -${inset}::float8), ${tolerance}::float8)) AS d FROM w) s
    `;
    const rings: [number, number][][] = [];
    for (const row of rows) {
        const geometry = JSON.parse(row.geometry) as { type: string; coordinates: [number, number][][] };
        if (geometry.type !== "Polygon") continue;
        for (const ring of geometry.coordinates) rings.push(ring.slice(0, -1));
    }
    return rings;
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Eine Kante: gerade (`via` null) oder eine Brücke mit der Linie ihres A*-Wegs, von hier nach `to`. */
interface GraphEdge {
    to: number;
    distance: number;
    via: [number, number][] | null;
    /** Kosten je Schiffsprofil (`weigh`); beide Richtungen teilen sich dasselbe Feld. */
    costs: number[];
}

export class VisibilityGraph {
    private readonly grid: SeaGrid;
    private readonly xs: number[] = [];
    private readonly ys: number[] = [];
    private readonly parts: number[] = [];
    /** Je Ecke ihre beiden Nachbarn auf dem Ring, für die Tangentenprobe; bei Häfen null. */
    private readonly around: ([number, number, number, number] | null)[] = [];
    private readonly edges: GraphEdge[][] = [];
    private readonly byPart = new Map<number, number[]>();
    /** Der Ring jeder Ecke (0 innen); Häfen tragen 0. */
    private readonly rings: number[] = [];
    private weighting: { profiles: readonly CoastProfile[]; field: Float32Array } | null = null;
    private readonly ports: number[] = [];
    private readonly tangent: boolean;
    private readonly bridge: { search: SeaSearch; reach: number } | null;
    private bridges = 0;
    /** Stützpunkte aller Brücken: Ihre Linie ist kein gerades Stück und muss gespeichert werden. */
    private bridgePoints = 0;
    readonly stats: VisibilityStats;

    constructor(
        grid: SeaGrid,
        rings: readonly [number, number][][],
        options: {
            offset?: number;
            /** Mehrere Abstände zur Küste, einer je Ring; ersetzt `offset`. */
            offsets?: readonly number[];
            tangent?: boolean;
            bridge?: { search: SeaSearch; reach: number };
        } = {},
    ) {
        this.grid = grid;
        const offsets = options.offsets ?? [options.offset ?? grid.cell];
        this.tangent = options.tangent ?? true;
        this.bridge = options.bridge ?? null;
        const started = performance.now();
        for (const ring of rings) {
            const count = ring.length;
            if (count < 3) continue;
            for (let index = 0; index < count; index += 1) {
                const [px, py] = ring[(index + count - 1) % count] as [number, number];
                const [x, y] = ring[index] as [number, number];
                const [nx, ny] = ring[(index + 1) % count] as [number, number];
                // Wasser liegt links: Eine Rechtskurve ist eine Ecke, an der das Land ins Wasser ragt.
                if (cross(x - px, y - py, nx - x, ny - y) >= 0) continue;
                // Eine Zelle vor die Ecke, entlang der Winkelhalbierenden ins Wasser: Eine Sichtlinie
                // genau von der Ecke streifte die Landzellen neben ihr.
                const inX =
                    -(y - py) / (Math.hypot(x - px, y - py) || 1) - (ny - y) / (Math.hypot(nx - x, ny - y) || 1);
                const inY = (x - px) / (Math.hypot(x - px, y - py) || 1) + (nx - x) / (Math.hypot(nx - x, ny - y) || 1);
                const length = Math.hypot(inX, inY) || 1;
                offsets.forEach((offset, ring) => {
                    let at: [number, number] = [x + (inX / length) * offset, y + (inY / length) * offset];
                    const cell = cellAt(grid, at[0], at[1]);
                    if (cell < 0 || grid.water[cell] !== 1) {
                        // Nur der innerste Ring rückt nach; draußen fehlt die Ecke dann einfach.
                        const near = ring === 0 ? nearestWaterCell(grid, x, y, grid.cell * 1.5) : null;
                        if (!near) return;
                        at = [near.x, near.y];
                    }
                    this.addNode(at[0], at[1], [px, py, nx, ny], ring);
                });
            }
        }
        const corners = this.xs.length;
        let pairs = 0;
        let tangent = 0;
        let edges = 0;
        for (const members of this.byPart.values()) {
            for (let i = 0; i < members.length; i += 1) {
                const a = members[i] as number;
                for (let j = i + 1; j < members.length; j += 1) {
                    const b = members[j] as number;
                    pairs += 1;
                    let linked = false;
                    if (this.tangentAt(a, b) && this.tangentAt(b, a)) {
                        tangent += 1;
                        linked = this.link(a, b);
                        if (linked) edges += 1;
                    }
                    if (!linked) this.bridgeIfNear(a, b);
                }
            }
        }
        this.stats = { corners, pairs, tangent, edges, bridges: this.bridges, ms: performance.now() - started };
    }

    private addNode(x: number, y: number, around: [number, number, number, number] | null, ring = 0): number {
        const id = this.xs.length;
        this.rings.push(ring);
        this.xs.push(x);
        this.ys.push(y);
        const part = this.grid.part[cellAt(this.grid, x, y)] as number;
        this.parts.push(part);
        this.around.push(around);
        this.edges.push([]);
        if (around) {
            const members = this.byPart.get(part) ?? [];
            members.push(id);
            this.byPart.set(part, members);
        }
        return id;
    }

    /** Streicht die Linie von `a` nach `b` an der Ecke `a` vorbei, statt ins Land zu zielen? */
    private tangentAt(a: number, b: number): boolean {
        const around = this.around[a];
        if (!around || !this.tangent) return true;
        const x = this.xs[a] as number;
        const y = this.ys[a] as number;
        const dx = (this.xs[b] as number) - x;
        const dy = (this.ys[b] as number) - y;
        const left = cross(dx, dy, around[0] - x, around[1] - y);
        const right = cross(dx, dy, around[2] - x, around[3] - y);
        return left * right >= 0;
    }

    /** Verbindet zwei Knoten, wenn die Linie über Wasser läuft. */
    private link(a: number, b: number): boolean {
        const ax = this.xs[a] as number;
        const ay = this.ys[a] as number;
        const bx = this.xs[b] as number;
        const by = this.ys[b] as number;
        if (!clearOverWater(this.grid, ax, ay, bx, by)) return false;
        const distance = Math.hypot(bx - ax, by - ay);
        const costs = this.costsOf([
            [ax, ay],
            [bx, by],
        ]);
        (this.edges[a] as GraphEdge[]).push({ to: b, distance, via: null, costs });
        (this.edges[b] as GraphEdge[]).push({ to: a, distance, via: null, costs });
        return true;
    }

    /**
     * Zwei nahe Knoten ohne Sicht verbindet ein kurzer A*-Weg: Durch einen Sund, schmaler als die
     * eingerückte Küste, fände der Graph sonst keinen Weg.
     */
    private bridgeIfNear(a: number, b: number): void {
        if (!this.bridge || this.rings[a] !== 0 || this.rings[b] !== 0) return;
        const ax = this.xs[a] as number;
        const ay = this.ys[a] as number;
        const bx = this.xs[b] as number;
        const by = this.ys[b] as number;
        const straight = Math.hypot(bx - ax, by - ay);
        if (straight > this.bridge.reach) return;
        const route = this.bridge.search.find(cellAt(this.grid, ax, ay), cellAt(this.grid, bx, by), straight * 3 + 2);
        if (!route) return;
        const [fx, fy] = route.points[0] as [number, number];
        const [lx, ly] = route.points[route.points.length - 1] as [number, number];
        const distance = route.distance + Math.hypot(fx - ax, fy - ay) + Math.hypot(bx - lx, by - ly);
        const costs = this.costsOf([[ax, ay], ...route.points, [bx, by]]);
        (this.edges[a] as GraphEdge[]).push({ to: b, distance, via: route.points, costs });
        (this.edges[b] as GraphEdge[]).push({ to: a, distance, via: [...route.points].reverse(), costs });
        this.bridges += 1;
        this.bridgePoints += route.points.length;
    }

    /** Hängt eine Anlegestelle an: an jede Ecke ihres Wasserteils, die sie tangential sieht, und jeden Hafen. */
    attach(x: number, y: number): number {
        const id = this.addNode(x, y, null);
        const part = this.parts[id] as number;
        for (const corner of this.byPart.get(part) ?? []) {
            if (!(this.tangentAt(corner, id) && this.link(id, corner))) this.bridgeIfNear(id, corner);
        }
        for (const other of this.ports) {
            if (this.parts[other] === part && !this.link(id, other)) this.bridgeIfNear(id, other);
        }
        this.ports.push(id);
        return id;
    }

    /** Die Kosten einer Linie je Profil, sobald gewichtet wird; sonst leer. */
    private costsOf(points: readonly [number, number][]): number[] {
        const weighting = this.weighting;
        return weighting
            ? weighting.profiles.map((profile) => lineCost(this.grid, weighting.field, profile, points))
            : [];
    }

    /**
     * Gewichtet jede Kante je Schiffsprofil nach ihrem Küstenabstand (S7). Kanten, die danach entstehen
     * (ein neuer Hafen), bekommen ihre Gewichte gleich mit.
     */
    weigh(profiles: readonly CoastProfile[], field: Float32Array): number {
        const started = performance.now();
        this.weighting = { profiles, field };
        this.edges.forEach((list, a) => {
            for (const edge of list) {
                if (a > edge.to) continue;
                const points: [number, number][] = [
                    [this.xs[a] as number, this.ys[a] as number],
                    ...(edge.via ?? []),
                    [this.xs[edge.to] as number, this.ys[edge.to] as number],
                ];
                edge.costs.length = 0;
                edge.costs.push(...this.costsOf(points));
            }
        });
        return performance.now() - started;
    }

    get nodeCount(): number {
        return this.xs.length;
    }

    get edgeCount(): number {
        return this.edges.reduce((sum, list) => sum + list.length, 0) / 2;
    }

    /** Was der Graph belegt, grob: je Knoten Lage und Wasserteil, je Kante Ziel und Länge in beide Richtungen, die Linien der Brücken. */
    get bytes(): number {
        const profiles = this.weighting?.profiles.length ?? 0;
        return this.xs.length * 20 + this.edgeCount * (2 * 8 + profiles * 4) + this.bridgePoints * 16;
    }

    get bridgeCount(): number {
        return this.bridges;
    }

    /** Knoten und jede Kante einmal, mit Länge, Kosten je Profil und Brückenlinie: für `compactSeaGraph`. */
    snapshot(): GraphSnapshot {
        const edges: GraphSnapshot["edges"][number][] = [];
        this.edges.forEach((list, a) => {
            for (const edge of list) {
                if (a < edge.to)
                    edges.push({ a, b: edge.to, distance: edge.distance, costs: edge.costs, via: edge.via });
            }
        });
        return { xs: this.xs, ys: this.ys, edges };
    }

    /** Die Knoten zum Zeichnen: Lage, und ob es ein Hafen ist. */
    nodes(): { x: number; y: number; port: boolean }[] {
        return this.xs.map((x, id) => ({ x, y: this.ys[id] as number, port: this.around[id] === null }));
    }

    /** Jede Kante einmal, zum Zeichnen: gerade oder als Brücke mit ihrer Linie. */
    displayEdges(): { a: number; b: number; via: [number, number][] | null }[] {
        const out: { a: number; b: number; via: [number, number][] | null }[] = [];
        this.edges.forEach((list, a) => {
            for (const edge of list) if (a < edge.to) out.push({ a, b: edge.to, via: edge.via });
        });
        return out;
    }

    /**
     * Der günstigste Weg zwischen zwei Knoten (A* mit der Luftlinie als Schätzung, nie zu hoch, weil kein
     * Aufschlag unter 1 liegt); null ohne Verbindung. Mit `profile` wählt er nach den Kosten dieses
     * Schiffs, `distance` ist immer die gefahrene Länge.
     */
    route(from: number, to: number, profile = -1): { points: [number, number][]; distance: number } | null {
        const count = this.xs.length;
        const best = new Float64Array(count).fill(Infinity);
        const previous = new Int32Array(count).fill(-1);
        const arrivedBy: (GraphEdge | null)[] = new Array<GraphEdge | null>(count).fill(null);
        const done = new Uint8Array(count);
        const tx = this.xs[to] as number;
        const ty = this.ys[to] as number;
        const estimate = (node: number): number =>
            Math.hypot((this.xs[node] as number) - tx, (this.ys[node] as number) - ty);
        const heap: [number, number][] = [];
        const push = (key: number, node: number): void => {
            heap.push([key, node]);
            let position = heap.length - 1;
            while (position > 0) {
                const parent = (position - 1) >> 1;
                if ((heap[parent] as [number, number])[0] <= key) break;
                heap[position] = heap[parent] as [number, number];
                position = parent;
            }
            heap[position] = [key, node];
        };
        const pop = (): number => {
            const top = heap[0] as [number, number];
            const last = heap.pop() as [number, number];
            if (heap.length > 0) {
                let position = 0;
                for (;;) {
                    let child = 2 * position + 1;
                    if (child >= heap.length) break;
                    if (
                        child + 1 < heap.length &&
                        (heap[child + 1] as [number, number])[0] < (heap[child] as [number, number])[0]
                    )
                        child += 1;
                    if ((heap[child] as [number, number])[0] >= last[0]) break;
                    heap[position] = heap[child] as [number, number];
                    position = child;
                }
                heap[position] = last;
            }
            return top[1];
        };
        best[from] = 0;
        push(estimate(from), from);
        while (heap.length > 0) {
            const node = pop();
            if (done[node] === 1) continue;
            done[node] = 1;
            if (node === to) break;
            for (const edge of this.edges[node] as GraphEdge[]) {
                const distance =
                    (best[node] as number) + (profile < 0 ? edge.distance : (edge.costs[profile] as number));
                if (distance >= (best[edge.to] as number)) continue;
                best[edge.to] = distance;
                previous[edge.to] = node;
                arrivedBy[edge.to] = edge;
                push(distance + estimate(edge.to), edge.to);
            }
        }
        if (!Number.isFinite(best[to] as number)) return null;
        // Die Linie: von Knoten zu Knoten, über eine Brücke entlang ihres A*-Wegs.
        const hops: GraphEdge[] = [];
        for (let node = to; previous[node] !== -1; node = previous[node] as number)
            hops.push(arrivedBy[node] as GraphEdge);
        hops.reverse();
        const points: [number, number][] = [[this.xs[from] as number, this.ys[from] as number]];
        let length = 0;
        for (const hop of hops) {
            if (hop.via) points.push(...hop.via);
            points.push([this.xs[hop.to] as number, this.ys[hop.to] as number]);
            length += hop.distance;
        }
        return { points, distance: length };
    }
}
