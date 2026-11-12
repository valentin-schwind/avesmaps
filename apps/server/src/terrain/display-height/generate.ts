import { domainMountainMask, type DomainHeightSource } from "../domain/read.ts";
import { domainWaterClasses } from "../domain/constraints.ts";
import { grid, MOUNTAIN } from "../hydrology/grid.ts";
import type { WaterArea } from "../hydrology/water.ts";
import type { LandscapeArea } from "../hydrology/landscape.ts";

/**
 * 3: Vereinfachung ohne zusammenfallende Ringe und Stufenflächen aus verknoteten Ringen (Befund Höhenstufen
 * 2026-10-03); eine ältere Revision gilt als veraltet und wird neu gerechnet, auch bei gleichem Gelände.
 */
export const DISPLAY_HEIGHT_GENERATOR = "3";
export type DisplayHeightParams = Record<string, never>;
export const DISPLAY_HEIGHT_PARAMS: Readonly<DisplayHeightParams> = Object.freeze({});

export interface DisplayHeightInput {
    domain: DomainHeightSource;
    water: readonly WaterArea[];
    landscapes: readonly LandscapeArea[];
    /** Known summits: their sampling cells are never lake, as in the domain terrain (`domainWaterClasses`). */
    cores?: readonly { x: number; y: number }[];
}

export interface DisplayHeightResult {
    field: Float32Array;
    classes: Uint8Array;
}

/** Contours use the domain master unchanged; only raster row orientation differs. */
export function generateDisplayHeights(
    input: DisplayHeightInput,
    n: number,
    params: Readonly<DisplayHeightParams> = DISPLAY_HEIGHT_PARAMS,
    onPhase: (phase: string) => void = () => undefined,
): DisplayHeightResult {
    const g = grid(n);
    if (Object.keys(params).length > 0) throw new Error("Anzeigehöhen besitzen keine eigenen Höhenparameter");
    const raster = input.domain.raster;
    if (raster.width !== n || raster.height !== n || raster.samples.length !== n * n) {
        throw new Error("Domain-DEM und Konturgitter passen nicht zusammen");
    }
    const islands = input.landscapes
        .filter((area) => area.layer === "topographie" && area.type === "insel")
        .map((area) => area.geometry);
    const classes = domainWaterClasses(g, input.water, islands, input.cores ?? []);
    const membership = domainMountainMask(input.domain);
    const field = new Float32Array(n * n);
    for (let y = 0; y < n; y += 1) {
        const sourceRow = (n - 1 - y) * n;
        for (let x = 0; x < n; x += 1) {
            const k = y * n + x;
            const source = sourceRow + x;
            field[k] = raster.samples[source] as number;
            if (membership[source]) classes[k] = (classes[k] as number) | MOUNTAIN;
        }
    }
    onPhase("domain-height-projection");
    return { field, classes };
}
