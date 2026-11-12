import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import type { DomainInputs, DomainPeak } from "./inputs.ts";
import { fillArea, rasterizeWater, type AreaGeometry, type WaterArea } from "../hydrology/water.ts";
import { LAKE, type Grid } from "../hydrology/grid.ts";

export function domainIslands(input: DomainInputs): AreaGeometry[] {
    return input.landscapes
        .filter((area) => area.layer === "topographie" && area.type === "insel")
        .map((area) => area.geometry);
}

/** Every known summit with a height; its four sampling cells are never lake (`domainWaterClasses`). */
export function summitCores(input: Pick<DomainInputs, "peaks">): { x: number; y: number }[] {
    return input.peaks.filter((peak) => peak.h !== null && peak.h > 0);
}

/**
 * Water classes of the domain grid (row 0 north): water polygons, mapped islands as land. The four cells a known
 * summit reads its height from are never lake: a summit at a lake shore keeps its exact height, and the lake stays
 * level without those cells (WI-0067, Stage 2026-10-03: a core cell fell into a lake's rasterization). The sea is
 * left alone; a summit core in the sea remains an operator decision.
 */
export function domainWaterClasses(
    g: Grid,
    water: readonly WaterArea[],
    islands: readonly AreaGeometry[],
    cores: readonly { x: number; y: number }[] = [],
): Uint8Array {
    const classes = new Uint8Array(g.n * g.n);
    rasterizeWater(g, water, classes);
    for (const island of islands)
        fillArea(g, island, (k) => {
            classes[k] = 0;
        });
    for (const core of cores) {
        const i = Math.floor((core.x - g.cell / 2) / g.cell),
            j = Math.floor((core.y - g.cell / 2) / g.cell);
        for (const dj of [0, 1])
            for (const di of [0, 1]) {
                const x = i + di,
                    row = g.n - 1 - (j + dj);
                if (x < 0 || row < 0 || x >= g.n || row >= g.n) continue;
                classes[row * g.n + x] = classes[row * g.n + x]! & ~LAKE;
            }
    }
    return classes;
}

/** Operator decision: only peaks in sea without any domain land may be ignored. */
export function ignoredMarinePeaks(input: DomainInputs): DomainPeak[] {
    return input.peaks.filter(
        (peak) =>
            input.water.some(
                (area) => area.kind === "meer" && pointInGeometry([peak.x, peak.y], area.geometry as V12Geometry),
            ) && !input.land.some((area) => pointInGeometry([peak.x, peak.y], area as V12Geometry)),
    );
}
