import { shipWaters, WATER_KINDS, type TravelModel, type WaterKind } from "@avesmaps3d/shared";
import type { CompactSeaGraph, GraphSnapshot } from "./sea-graph-store.ts";
import { cellAt, forEachCellInside, type NavigableWater, type SeaGrid } from "./sea-grid.ts";

/**
 * Die Gewässer eines Seeschiffs im Seegraphen (WI-0069, Tafel `gewaesser`): Das Ruderboot fährt auf jedem Binnensee,
 * auch einem, der ans Meer grenzt, aber nie hinaus aufs Meer (Betreiber 2026-10-03: „Boote dürfen auf Flüsse und
 * Seen“).
 *
 * - **Je Kante:** Eine Kante des Graphen, deren Linie eine Zelle eines fremden Gewässers berührt, ist für das Schiff
 *   gesperrt. Die Paare der Häfen rechnet die Suche dann ohne sie: Was bleibt, liegt ganz im erlaubten Wasser.
 * - **Gesperrt heißt Aufschlag 0** im gespeicherten Graphen (`compactSeaGraph`): Kein echter Aufschlag ist kleiner
 *   als 1, die Suche überspringt die Kante, auch beim Zeichnen der Linie im Worker.
 */

/** Je Zelle des Rasters die Gewässer, in denen ihre Mitte liegt, ein Bit je Art in der Reihenfolge von `WATER_KINDS`. */
export function waterKindCells(grid: SeaGrid, water: NavigableWater): Uint8Array {
    const kinds = new Uint8Array(grid.cols * grid.rows);
    for (const area of water.areas) {
        const bit = 1 << WATER_KINDS.indexOf(area.regionType);
        forEachCellInside(grid, area, (cell) => {
            kinds[cell] = (kinds[cell] as number) | bit;
        });
    }
    return kinds;
}

const maskOf = (kinds: readonly WaterKind[]): number =>
    kinds.reduce((mask, kind) => mask | (1 << WATER_KINDS.indexOf(kind)), 0);

/** Berührt die Linie eine Zelle mit einem Bit aus `forbidden`? Abgetastet in halber Zellbreite. */
function touches(points: readonly [number, number][], grid: SeaGrid, kinds: Uint8Array, forbidden: number): boolean {
    const step = grid.cell / 2;
    for (let index = 1; index < points.length; index += 1) {
        const [ax, ay] = points[index - 1] as [number, number];
        const [bx, by] = points[index] as [number, number];
        const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let sample = index === 1 ? 0 : 1; sample <= samples; sample += 1) {
            const cell = cellAt(grid, ax + ((bx - ax) * sample) / samples, ay + ((by - ay) * sample) / samples);
            if (cell >= 0 && ((kinds[cell] as number) & forbidden) !== 0) return true;
        }
    }
    return false;
}

/**
 * Je Seeschiff des Graphen die Kanten, die es nicht fahren darf (1 = gesperrt); null für ein Schiff ohne eigene
 * Gewässer. In der Reihenfolge von `transports`.
 */
export function blockedEdges(
    snapshot: GraphSnapshot,
    transports: readonly string[],
    model: TravelModel,
    grid: SeaGrid,
    kinds: Uint8Array,
): (Uint8Array | null)[] {
    const all = maskOf(WATER_KINDS);
    return transports.map((transport) => {
        const forbidden = all & ~maskOf(shipWaters(model, transport));
        if (forbidden === 0) return null;
        const blocked = new Uint8Array(snapshot.edges.length);
        snapshot.edges.forEach((edge, index) => {
            const points: [number, number][] = [
                [snapshot.xs[edge.a] as number, snapshot.ys[edge.a] as number],
                ...(edge.via ?? []),
                [snapshot.xs[edge.b] as number, snapshot.ys[edge.b] as number],
            ];
            if (touches(points, grid, kinds, forbidden)) blocked[index] = 1;
        });
        return blocked;
    });
}

/** Je Schiff mit eigenen Gewässern, wie viele Häfen es anfahren kann: Häfen mit mindestens einer Seereise. */
export function watersReport(graph: CompactSeaGraph, model: TravelModel): { transport: string; ports: number }[] {
    const count = graph.ports.length;
    return graph.transports.flatMap((transport, index) => {
        if (shipWaters(model, transport).length === WATER_KINDS.length) return [];
        const pairs = graph.pairs[index] as Float32Array;
        let ports = 0;
        for (let from = 0; from < count; from += 1) {
            for (let to = 0; to < count; to += 1) {
                if (from !== to && !Number.isNaN(pairs[from * count + to] as number)) {
                    ports += 1;
                    break;
                }
            }
        }
        return [{ transport, ports }];
    });
}
