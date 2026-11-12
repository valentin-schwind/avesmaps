import { createHash } from "node:crypto";
import type { StoredRaster } from "./dem-tiles.ts";
import { grid, SEA, LAKE } from "./hydrology/grid.ts";
import { coastDistance, fillArea, rasterizeWater, type WaterArea } from "./hydrology/water.ts";
import { freePeakHeight, type FreePeak } from "./peak-cone.ts";
import { burnRivers, type RiverBurnInput } from "./river-burn.ts";
import {
    CONTINENTAL_MAX_HEIGHT,
    CONTINENTAL_PARAMS,
    coastalRidge,
    smoothRise,
    continentalRise,
    type ContinentalBase,
} from "./continental.ts";
import { landscapeStrength, sampleLandscape, type LandscapeArea } from "./hydrology/landscape.ts";
import { wertRauschen } from "@avesmaps3d/shared";

function initialContinentalRaster(
    water: readonly WaterArea[],
    peaks: readonly FreePeak[],
    size: number,
    landscapes: readonly LandscapeArea[],
): StoredRaster {
    const g = grid(size);
    const classes = new Uint8Array(size * size);
    rasterizeWater(g, water, classes);
    const distance = new Float32Array(size * size);
    coastDistance(
        g,
        classes,
        water.filter((area) => area.kind === "meer"),
        distance,
    );
    const lift = landscapeStrength(g, classes, landscapes, {
        landscapeStrength: CONTINENTAL_PARAMS.landscapeLift,
        landscapeFallback: 0,
        landscapeBlur: CONTINENTAL_PARAMS.landscapeBlur,
    });
    const hills = landscapeStrength(g, classes, landscapes, {
        landscapeStrength: { hochebene: 0, huegelland: 1 },
        landscapeFallback: 0,
        landscapeBlur: CONTINENTAL_PARAMS.landscapeBlur,
    });
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const k = y * size + x;
            const d = distance[k] as number;
            const hill =
                CONTINENTAL_PARAMS.hillAmplitude *
                sampleLandscape(hills, size, x, y) *
                wertRauschen(
                    CONTINENTAL_PARAMS.seed,
                    (x + 0.5) * g.cell,
                    1024 - (y + 0.5) * g.cell,
                    CONTINENTAL_PARAMS.hillWidth,
                );
            distance[k] =
                Math.max(continentalRise(d), coastalRidge(d)) +
                (sampleLandscape(lift, size, x, y) + hill) * smoothRise(d, CONTINENTAL_PARAMS.landscapeCoastFade);
        }
    }
    for (const peak of peaks) {
        const height = freePeakHeight(peak);
        if (height >= CONTINENTAL_MAX_HEIGHT) continue;
        const reach = CONTINENTAL_PARAMS.peakFade;
        for (
            let y = Math.max(0, Math.floor((1024 - peak.y - reach) / g.cell));
            y < Math.min(size, Math.ceil((1024 - peak.y + reach) / g.cell));
            y += 1
        ) {
            for (
                let x = Math.max(0, Math.floor((peak.x - reach) / g.cell));
                x < Math.min(size, Math.ceil((peak.x + reach) / g.cell));
                x += 1
            ) {
                const d = Math.hypot((x + 0.5) * g.cell - peak.x, 1024 - (y + 0.5) * g.cell - peak.y);
                const t = Math.min(1, Math.max(0, (d - g.cell * 2) / reach));
                const cap = height + (CONTINENTAL_MAX_HEIGHT - height) * t * t * (3 - 2 * t);
                const k = y * size + x;
                distance[k] = Math.min(distance[k] as number, cap);
            }
        }
    }
    // Auch Seen ohne Fluss erhalten einen einzigen Spiegel.
    for (const lake of water.filter((area) => area.kind === "see")) {
        let low = Infinity;
        fillArea(g, lake.geometry, (k) => {
            if ((classes[k] as number) & LAKE) low = Math.min(low, distance[k] as number);
        });
        fillArea(g, lake.geometry, (k) => {
            if ((classes[k] as number) & LAKE) distance[k] = low;
        });
    }
    const samples = new Uint16Array(size * size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const k = y * size + x;
            samples[(size - 1 - y) * size + x] = (classes[k] as number) & SEA ? 0 : Math.floor(distance[k] as number);
        }
    }
    const raster: StoredRaster = {
        cell: g.cell,
        originX: g.cell / 2,
        originY: g.cell / 2,
        width: size,
        height: size,
        samples,
    };
    return raster;
}

export function generateContinentalBase(
    water: readonly WaterArea[],
    peaks: readonly FreePeak[],
    rivers: RiverBurnInput,
    size: number = CONTINENTAL_PARAMS.size,
    mountains: readonly StoredRaster[] = [],
    landscapes: readonly LandscapeArea[] = [],
    freePeaks: readonly FreePeak[] = [],
): ContinentalBase {
    const raster = initialContinentalRaster(water, peaks, size, landscapes);
    globalThis.gc?.();
    const report = burnRivers([raster, ...mountains], rivers, {
        // Freie Gipfel stehen als unveränderliche Kegel über dem Sockel; ihr Sockel darf nachgeschnitten werden.
        anchors: peaks.filter((peak) => !freePeaks.some((free) => free.x === peak.x && free.y === peak.y)),
        peaks: freePeaks,
        readOnlyRasters: new Set(mountains),
    });
    // Ganzzahlige Raster erlauben einen Schritt; bilineare Summen können um Rundungsreste darüberliegen.
    if (!report.converged || report.unresolved.some((entry) => entry.value > 1 + 1e-9)) {
        throw new Error(`Kontinentalsockel: Einbrennen nicht abgeschlossen (${String(report.rounds)} Runden)`);
    }
    const fingerprint = createHash("sha256").update(Buffer.from(raster.samples.buffer)).digest("hex");
    return { raster, fingerprint };
}
