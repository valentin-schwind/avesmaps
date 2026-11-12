import type { Queryable } from "../database.ts";
import type { StoredRaster } from "./dem-tiles.ts";

/** Fachlicher Landsockel, Schritt; bekannte Gipfel bleiben absolute Höhen. */
export const CONTINENTAL_PARAMS = Object.freeze({
    version: 5,
    height: 300,
    rise: 100,
    peakFade: 20,
    size: 4096,
    coastHeight: 50,
    coastWidth: 1,
    coastInlandWidth: 8,
    landscapeCoastFade: 4,
    landscapeBlur: 5,
    landscapeLift: Object.freeze({ hochebene: 150, huegelland: 75 }),
    hillAmplitude: 25,
    hillWidth: 8,
    seed: 66066,
});

export const CONTINENTAL_MAX_HEIGHT =
    CONTINENTAL_PARAMS.height + Math.max(...Object.values(CONTINENTAL_PARAMS.landscapeLift));

export function smoothRise(distance: number, width: number): number {
    const t = Math.min(1, Math.max(0, distance / width));
    return t * t * (3 - 2 * t);
}

/** Küstenrücken: kurze Seeseite, breiter und weicher Abfall ins Hinterland. */
export function coastalRidge(distance: number): number {
    return (
        CONTINENTAL_PARAMS.coastHeight *
        smoothRise(distance, CONTINENTAL_PARAMS.coastWidth) *
        (1 - smoothRise(distance - CONTINENTAL_PARAMS.coastWidth, CONTINENTAL_PARAMS.coastInlandWidth))
    );
}

export interface ContinentalBase {
    fingerprint: string;
    raster: StoredRaster;
}

export function continentalRise(distance: number): number {
    const t = Math.min(1, Math.max(0, distance / CONTINENTAL_PARAMS.rise));
    return CONTINENTAL_PARAMS.height * t * t * (3 - 2 * t);
}

export function continentalHeight(base: ContinentalBase | undefined, x: number, y: number): number {
    if (!base) return 0;
    const r = base.raster;
    const u = Math.min(r.width - 1, Math.max(0, (x - r.originX) / r.cell));
    const v = Math.min(r.height - 1, Math.max(0, (y - r.originY) / r.cell));
    if (x < 0 || y < 0 || x > 1024 || y > 1024) return 0;
    const i = Math.min(r.width - 2, Math.floor(u));
    const j = Math.min(r.height - 2, Math.floor(v));
    const tx = u - i;
    const ty = v - j;
    const k = j * r.width + i;
    const a = r.samples[k] as number;
    const b = r.samples[k + 1] as number;
    const c = r.samples[k + r.width] as number;
    const d = r.samples[k + r.width + 1] as number;
    const south = a + (b - a) * tx;
    return south + (c + (d - c) * tx - south) * ty;
}

export async function loadContinentalBase(
    database: Queryable,
    mapDomainId: string,
): Promise<ContinentalBase | undefined> {
    const [row] = await database<{ fingerprint: string; size: number; samples: Buffer }[]>`
        SELECT b.fingerprint, b.size, b.samples FROM terrain_continental_base b
        JOIN terrain_dem d ON d.continental_fingerprint = b.fingerprint AND d.map_domain_id = b.map_domain_id
        WHERE d.map_domain_id = ${mapDomainId} AND d.is_current
    `;
    if (!row) return undefined;
    const cell = 1024 / row.size;
    return {
        fingerprint: row.fingerprint,
        raster: {
            cell,
            originX: cell / 2,
            originY: cell / 2,
            width: row.size,
            height: row.size,
            samples: new Uint16Array(
                row.samples.buffer.slice(row.samples.byteOffset, row.samples.byteOffset + row.samples.byteLength),
            ),
        },
    };
}
