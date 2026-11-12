import type { Landing } from "./sea-grid.ts";
import { MinQueue } from "./sea-parity-tools.ts";
import type { SeaSearch } from "./sea-search.ts";

/**
 * Das abgeleitete Seenetz, gemessen als Alternative zum Rechnen je Anfrage (WI-0046, S1): freie Wege
 * vorab nur zwischen Anlegestellen, die in der Nachbarschaft über Wasser (`waterNeighbours`) höchstens
 * `ring` Schritte auseinanderliegen. Eine Reise fährt darüber wie heute über Seewege. Gemessen wird, wie
 * viel länger sie ist als der direkte freie Weg, was das Ableiten kostet und was eine Reise darauf.
 */

export interface DerivedNetwork {
    ring: number;
    /** Kanten des Netzes. */
    pairs: number;
    /** Stützpunkte aller Kanten zusammen - so groß wäre das Netz im Speicher. */
    points: number;
    ms: number;
    /** Je Reise: Länge über das Netz durch Länge des direkten freien Wegs. */
    ratios: number[];
    /** Je Reise: Rechenzeit auf dem Netz. */
    times: number[];
}

/** Eine ganze Reise mit ihrem direkten freien Weg, von Hafen zu Hafen. */
export interface DirectVoyage {
    from: { x: number; y: number; landing: Landing };
    to: { x: number; y: number; landing: Landing };
    distance: number;
}

/** Die Paare der Nachbarschaft, erweitert auf alle, die höchstens `ring` Schritte auseinanderliegen. */
function pairsWithin(neighbours: readonly [number, number][], ring: number): [number, number][] {
    const adjacent = new Map<number, Set<number>>();
    for (const [a, b] of neighbours) {
        adjacent.set(a, (adjacent.get(a) ?? new Set<number>()).add(b));
        adjacent.set(b, (adjacent.get(b) ?? new Set<number>()).add(a));
    }
    const pairs: [number, number][] = [];
    for (const origin of [...adjacent.keys()].sort((a, b) => a - b)) {
        let frontier = new Set([origin]);
        const seen = new Set([origin]);
        for (let step = 0; step < ring; step += 1) {
            const next = new Set<number>();
            for (const node of frontier) {
                for (const other of adjacent.get(node) ?? []) {
                    if (seen.has(other)) continue;
                    seen.add(other);
                    next.add(other);
                    if (origin < other) pairs.push([origin, other]);
                }
            }
            frontier = next;
        }
    }
    return pairs;
}

export function deriveNetwork(
    search: SeaSearch,
    landingCells: readonly number[],
    neighbours: readonly [number, number][],
    voyages: readonly DirectVoyage[],
    ring: number,
): DerivedNetwork {
    const clock = performance.now();
    const pairs = pairsWithin(neighbours, ring);
    const edges = new Map<number, { to: number; distance: number }[]>();
    let points = 0;
    for (const [a, b] of pairs) {
        const from = landingCells[a] as number;
        const to = landingCells[b] as number;
        const route = search.find(from, to);
        if (!route) continue;
        points += route.points.length;
        edges.set(from, [...(edges.get(from) ?? []), { to, distance: route.distance }]);
        edges.set(to, [...(edges.get(to) ?? []), { to: from, distance: route.distance }]);
    }
    const ms = performance.now() - clock;

    const distanceOver = (from: number, to: number): number => {
        const best = new Map<number, number>([[from, 0]]);
        const queue = new MinQueue();
        queue.push(0, String(from));
        const done = new Set<number>();
        while (queue.size > 0) {
            const cell = Number(queue.pop());
            if (done.has(cell)) continue;
            done.add(cell);
            if (cell === to) return best.get(cell) as number;
            for (const edge of edges.get(cell) ?? []) {
                const distance = (best.get(cell) as number) + edge.distance;
                if (distance >= (best.get(edge.to) ?? Infinity)) continue;
                best.set(edge.to, distance);
                queue.push(distance, String(edge.to));
            }
        }
        return Infinity;
    };
    const ratios: number[] = [];
    const times: number[] = [];
    for (const voyage of voyages) {
        const { from, to } = voyage;
        const timer = performance.now();
        const overWater = distanceOver(from.landing.cell, to.landing.cell);
        times.push(performance.now() - timer);
        const total =
            overWater +
            Math.hypot(from.landing.x - from.x, from.landing.y - from.y) +
            Math.hypot(to.x - to.landing.x, to.y - to.landing.y);
        ratios.push(total / voyage.distance);
    }
    return { ring, pairs: pairs.length, points, ms, ratios, times };
}
