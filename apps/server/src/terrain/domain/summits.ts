import type { StoredRaster } from "../dem-tiles.ts";
import type { DomainPeak } from "./inputs.ts";

/**
 * Finale Gipfelprojektion (WI-0067 G11): die vier Abtastzellen jedes bekannten Gipfels exakt auf seine
 * absolute Höhe. Die Form um den Gipfel hat davor `restoreSummits` wiederhergestellt; die Schlussprüfung
 * liest danach Flüsse, Seen und Gipfel erneut.
 */
export function projectSummits(raster: StoredRaster, peaks: readonly DomainPeak[]): { exactCells: number } {
    const { width, height, cell } = raster;
    let exactCells = 0;
    for (const peak of peaks) {
        if (peak.h === null || !(peak.h > 0)) continue;
        const summit = Math.round(peak.h);
        const x = Math.floor((peak.x - raster.originX) / cell),
            y = Math.floor((peak.y - raster.originY) / cell);
        for (const dy of [0, 1])
            for (const dx of [0, 1]) {
                if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
                const k = (y + dy) * width + x + dx;
                if (raster.samples[k] === summit) continue;
                raster.samples[k] = summit;
                exactCells += 1;
            }
    }
    return { exactCells };
}
