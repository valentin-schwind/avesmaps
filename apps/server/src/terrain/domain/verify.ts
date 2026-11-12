import type { StoredRaster } from "../dem-tiles.ts";
import { grid, SEA } from "../hydrology/grid.ts";
import { fillArea } from "../hydrology/water.ts";
import { risingRivers } from "../river-burn.ts";
import type { DomainInputs, DomainPeak } from "./inputs.ts";
import { domainIslands, domainWaterClasses, ignoredMarinePeaks, summitCores } from "./constraints.ts";
import { lakeBodies } from "./lake-bodies.ts";
import { domainRivers } from "./lakes.ts";

export function verifyDomainRaster(
    raster: StoredRaster,
    input: DomainInputs,
    ignoredPeaks: readonly DomainPeak[] = [],
): { errors: string[]; peakRises: ReturnType<typeof risingRivers>["atPeaks"] } {
    const g = grid(raster.width);
    if (raster.height !== g.n || raster.cell !== g.cell || raster.samples.length !== g.n * g.n)
        throw new Error("Invalid domain raster dimensions");
    const errors: string[] = [];
    const classes = domainWaterClasses(g, input.water, domainIslands(input), summitCores(input));
    const land = new Uint8Array(classes.length);
    for (const geometry of input.land)
        fillArea(g, geometry, (k) => {
            land[k] = 1;
        });
    const at = (k: number): number => raster.samples[(g.n - 1 - Math.floor(k / g.n)) * g.n + (k % g.n)]!;
    let seaErrors = 0;
    for (let k = 0; k < classes.length; k += 1) if ((!land[k] || classes[k]! & SEA) && at(k) !== 0) seaErrors += 1;
    if (seaErrors > 0) errors.push(`sea:${String(seaErrors)}`);
    // A lake is one connected water body with one level (`lakeBodies`): a multi-part area is several lakes.
    for (const body of lakeBodies(g, input.water, classes)) {
        let minimum = Infinity;
        let maximum = -Infinity;
        for (const k of body.cells) {
            minimum = Math.min(minimum, at(k));
            maximum = Math.max(maximum, at(k));
        }
        if (maximum > minimum)
            errors.push(`lake:${String(body.area)}.${String(body.part)}:${String(minimum)}..${String(maximum)}`);
    }
    const allowedIgnore = new Set(ignoredMarinePeaks(input).map((peak) => peak.id));
    for (const peak of ignoredPeaks) if (!allowedIgnore.has(peak.id)) errors.push(`ignored-peak:${peak.id}`);
    const ignored = new Set(ignoredPeaks.filter((peak) => allowedIgnore.has(peak.id)).map((peak) => peak.id));
    const peaks = input.peaks.filter((peak) => !ignored.has(peak.id));
    for (const peak of peaks) {
        if (peak.h === null || !(peak.h > 0)) continue;
        const x = Math.floor((peak.x - raster.originX) / raster.cell);
        const y = Math.floor((peak.y - raster.originY) / raster.cell);
        let valid = true;
        for (const dy of [0, 1])
            for (const dx of [0, 1]) {
                if (x + dx < 0 || y + dy < 0 || x + dx >= g.n || y + dy >= g.n) {
                    valid = false;
                    continue;
                }
                if (raster.samples[(y + dy) * g.n + x + dx] !== Math.round(peak.h)) valid = false;
            }
        if (!valid) errors.push(`peak:${peak.id}`);
    }
    // Eigene Höhen an Flüssen (WI-0249, nur Fassung 19): Ein Anstieg an ihnen ist gewollt und kein Befund; ohne sie wie zuvor.
    const flussPunkte = (input.rueckennetz ?? []).flatMap((g) => g.wasser?.fluesse ?? []);
    const rivers = risingRivers([raster], domainRivers(input.rivers), {
        anchors: peaks.filter((peak) => peak.h !== null),
        lakes: "fixed",
        ...(flussPunkte.length > 0 ? { flussPunkte } : {}),
    });
    for (const river of rivers.rising) errors.push(`river:${river.id}:${String(river.value)}`);
    return { errors, peakRises: rivers.atPeaks };
}
