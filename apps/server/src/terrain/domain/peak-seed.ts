import type { StoredRaster } from "../dem-tiles.ts";
import { cellX, cellY, SCHRITT_PER_UNIT, type Grid } from "../hydrology/grid.ts";
import { freePeakHeight } from "../peak-cone.ts";
import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import type { DomainPeak } from "./inputs.ts";
import type { MaterialArea } from "./materials.ts";
import type { MountainMorphology } from "./recipes.ts";
import { CORE_GRADE, restoreShare, summitCap, summitFor, summitHeight, type Summit } from "./summit-shape.ts";

type Interior = Pick<MountainMorphology["interior"], "maximumGrade" | "alpine">;

/**
 * Every known summit with its shape, by the same rule wherever it stands. A free peak without a height takes
 * the free default (1.000 Schritt); a mountain peak without one has no shape of its own.
 */
export function domainSummits(
    peaks: readonly DomainPeak[],
    landscapes: readonly MaterialArea[],
    interior: Interior,
    seed: number,
): Summit[] {
    const mountains = landscapes.filter((area) => area.layer === "topographie" && area.type === "gebirge");
    const summits: Summit[] = [];
    for (const peak of peaks) {
        let height = peak.h;
        if (height === null || !(height > 0)) {
            if (mountains.some((area) => pointInGeometry([peak.x, peak.y], area.geometry as V12Geometry))) continue;
            height = freePeakHeight(peak);
        }
        summits.push(summitFor(interior, seed, peak.x, peak.y, Math.round(height), peak.volcano === true));
    }
    return summits;
}

/** The summits whose core could bound this summit's shape somewhere within its reach. */
function neighbours(summits: readonly Summit[], summit: Summit): Summit[] {
    return summits.filter(
        (other) =>
            Math.hypot(other.x - summit.x, other.y - summit.y) <
            summit.reach + Math.max(0, summit.height - other.height) / (CORE_GRADE * SCHRITT_PER_UNIT),
    );
}

/** Seed every summit's shape before erosion: never lower, never on the sea, no core buried by another. */
export function seedPeaks(g: Grid, land: Uint8Array, height: Float32Array, summits: readonly Summit[]): void {
    for (const summit of summits) {
        const near = neighbours(summits, summit);
        const { reach } = summit;
        for (
            let y = Math.max(0, Math.floor((1024 - summit.y - reach) / g.cell));
            y < Math.min(g.n, Math.ceil((1024 - summit.y + reach) / g.cell));
            y += 1
        )
            for (
                let x = Math.max(0, Math.floor((summit.x - reach) / g.cell));
                x < Math.min(g.n, Math.ceil((summit.x + reach) / g.cell));
                x += 1
            ) {
                const k = y * g.n + x;
                if (!land[k]) continue;
                const px = cellX(g, x),
                    py = cellY(g, y);
                height[k] = Math.max(height[k]!, Math.min(summitHeight(summit, px, py), summitCap(near, px, py)));
            }
    }
}

/**
 * Erosion and river valley profiles wear a summit down to a needle. After the final river burn and lakes,
 * every summit is raised back towards its shape, keeping a drawn share of erosion's gullies and spurs: a
 * volcano entirely, a mountain from the top down to its drawn restore depth, fading out towards the eroded
 * foot. Never lowered, never on the sea, lake banks or a river corridor (`allowed`, grid orientation), never a
 * summit core (the exact projection follows), no core buried by a higher neighbour.
 */
export function restoreSummits(
    raster: StoredRaster,
    summits: readonly Summit[],
    allowed?: Uint8Array,
    /**
     * Vorrang des eigenen Gipfels (WI-0249 P2 Schritt 5, `alpine.summit.dominance`, Anstieg je Lauf): Keine wiederhergestellte Zelle steigt
     * über ihren eigenen Gipfel; sie bleibt um mindestens 1 Schritt und um diese Neigung je Abstand unter ihm. Ohne den Wert deckeln nur die
     * Nachbargipfel (`summitCap`), und Rücken und Rinnen der Erosion (`detail`) heben Zellen neben dem Kern über den Gipfel (Hilvalskopf
     * in der Feinstufe: 2.536 neben 2.300). Fassung 17 und 18 führen ihn nicht.
     */
    dominance?: number,
): number {
    const { width, height, cell } = raster;
    const cores = new Set<number>();
    for (const summit of summits) {
        const i = Math.floor((summit.x - raster.originX) / cell),
            j = Math.floor((summit.y - raster.originY) / cell);
        for (const dj of [0, 1]) for (const di of [0, 1]) cores.add((j + dj) * width + i + di);
    }
    let changed = 0;
    for (const summit of [...summits].sort((a, b) => b.height - a.height)) {
        const near = neighbours(summits, summit);
        const reach = Math.ceil(summit.reach / cell) + 1;
        const ci = Math.floor((summit.x - raster.originX) / cell),
            cj = Math.floor((summit.y - raster.originY) / cell);
        const j0 = Math.max(0, cj - reach),
            j1 = Math.min(height - 1, cj + reach),
            i0 = Math.max(0, ci - reach),
            i1 = Math.min(width - 1, ci + reach);
        const columns = i1 - i0 + 1;
        // Erosion's gullies and spurs as relief around a local mean, read before this summit raises a cell.
        const relief = new Float32Array((j1 - j0 + 1) * columns);
        for (let j = j0; j <= j1; j += 1)
            for (let i = i0; i <= i1; i += 1) {
                let sum = 0,
                    count = 0;
                for (let dj = -2; dj <= 2; dj += 1)
                    for (let di = -2; di <= 2; di += 1) {
                        const jj = j + dj,
                            ii = i + di;
                        if (jj < 0 || ii < 0 || jj >= height || ii >= width) continue;
                        sum += raster.samples[jj * width + ii]!;
                        count += 1;
                    }
                relief[(j - j0) * columns + i - i0] = raster.samples[j * width + i]! - sum / count;
            }
        for (let j = j0; j <= j1; j += 1)
            for (let i = i0; i <= i1; i += 1) {
                const k = j * width + i;
                const current = raster.samples[k]!;
                if (current === 0 || cores.has(k) || (allowed && !allowed[(height - 1 - j) * width + i])) continue;
                const px = raster.originX + i * cell,
                    py = raster.originY + j * cell;
                const shape = summitHeight(summit, px, py);
                if (!(shape > 0)) continue;
                const target = Math.min(
                    shape + summit.detail * relief[(j - j0) * columns + i - i0]!,
                    summitCap(near, px, py),
                    dominance === undefined
                        ? Infinity
                        : summit.height -
                              Math.max(1, dominance * Math.hypot(px - summit.x, py - summit.y) * SCHRITT_PER_UNIT),
                );
                if (!(target > current)) continue;
                const raised = Math.round(current + restoreShare(summit, shape) * (target - current));
                if (raised <= current) continue;
                raster.samples[k] = Math.min(65535, raised);
                changed += 1;
            }
    }
    return changed;
}
