import { LAKE, SEA, type Grid } from "../hydrology/grid.ts";
import { fillArea, type AreaGeometry, type WaterArea } from "../hydrology/water.ts";

/**
 * Seen als Gewässer (WI-0067, Betreiber 2026-10-04: „seen [...] zu tief im gelände ‚versinken‘ [...] sollten eigentlich
 * nahezu flach sein“).
 *
 * Ein See ist ein zusammenhängendes Gewässer mit EINEM ebenen Spiegel: jedes Polygonteil einer Seefläche, und
 * Teile, die sich Zellen teilen (überlappende Flächen), zusammen. Eine Mehrfachfläche wie „Seen im Nebelmoor“ sind
 * hunderte getrennte Seen; mit einem Spiegel für die ganze Fläche (dem tiefsten) versanken sie alle in Senken.
 * Flächen, die sich nur berühren, ohne eine Zelle zu teilen, bleiben getrennte Seen (flächengenau, wie bisher).
 */

export interface LakeBody {
    /** Zellen des Gitters (Zeile 0 im Norden), aufsteigend und ohne Doppelte. */
    cells: Int32Array;
    /** Die erste Seefläche der Eingaben (Index in `water`) und ihr Polygonteil, aus denen dieser See besteht. */
    area: number;
    part: number;
}

/** Die Polygone einer Fläche: jeder Teil einer Mehrfachfläche ist für sich ein See. */
export function lakeParts(geometry: AreaGeometry): AreaGeometry[] {
    if (geometry.type === "Polygon") return [geometry];
    if (geometry.type === "MultiPolygon")
        return (geometry.coordinates as unknown[]).map((polygon) => ({ type: "Polygon", coordinates: polygon }));
    return [];
}

/**
 * Die Seen des Gitters. `classes` trägt die Wasserklassen (`domainWaterClasses`): nur Zellen mit `LAKE` zählen, die
 * vier Kernzellen eines bekannten Gipfels sind dort schon kein See. Die Reihenfolge folgt den Eingaben, die Zellen
 * sind aufsteigend: dasselbe Ergebnis bei jedem Lauf.
 */
export function lakeBodies(g: Grid, water: readonly WaterArea[], classes: Uint8Array): LakeBody[] {
    const parent: number[] = [];
    const find = (a: number): number => {
        let root = a;
        while (parent[root] !== root) root = parent[root]!;
        let walk = a;
        while (parent[walk] !== root) {
            const next = parent[walk]!;
            parent[walk] = root;
            walk = next;
        }
        return root;
    };
    const owner = new Map<number, number>();
    const parts: { area: number; part: number; cells: number[] }[] = [];
    water.forEach((area, areaIndex) => {
        if (area.kind !== "see") return;
        lakeParts(area.geometry).forEach((geometry, partIndex) => {
            const id = parts.length;
            parent.push(id);
            const cells: number[] = [];
            parts.push({ area: areaIndex, part: partIndex, cells });
            fillArea(g, geometry, (k) => {
                if (!((classes[k] as number) & LAKE) || (classes[k] as number) & SEA) return;
                cells.push(k);
                const first = owner.get(k);
                if (first === undefined) owner.set(k, id);
                else {
                    const a = find(first);
                    const b = find(id);
                    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
                }
            });
        });
    });
    const members = new Map<number, number[]>();
    parts.forEach((_, id) => {
        const root = find(id);
        members.set(root, [...(members.get(root) ?? []), id]);
    });
    const bodies: LakeBody[] = [];
    for (const [root, ids] of [...members].sort((a, b) => a[0] - b[0])) {
        const first = parts[root]!;
        const unique = new Set<number>();
        for (const id of ids) for (const k of parts[id]!.cells) unique.add(k);
        if (unique.size === 0) continue;
        bodies.push({ cells: Int32Array.from(unique).sort(), area: first.area, part: first.part });
    }
    return bodies;
}
