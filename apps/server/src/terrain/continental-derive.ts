import { createHash } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { CONTINENTAL_PARAMS, type ContinentalBase } from "./continental.ts";
import { generateContinentalBase } from "./continental-generate.ts";
import type { WaterArea } from "./hydrology/water.ts";
import type { FreePeak } from "./peak-cone.ts";
import type { RiverBurnInput } from "./river-burn.ts";
import type { StoredRaster } from "./dem-tiles.ts";
import type { LandscapeArea } from "./hydrology/landscape.ts";

export async function deriveContinentalBase(
    database: Database,
    mapDomainId: string,
    peaks: readonly FreePeak[],
    rivers: RiverBurnInput,
    mountains: readonly StoredRaster[],
    force = false,
    freePeaks: readonly FreePeak[] = [],
): Promise<ContinentalBase | undefined> {
    if (mapDomainId !== AVENTURIA.mapDomain) return undefined;
    const rows = await database<{ id: string; kind: "meer" | "see"; geometry: string }[]>`
        SELECT a.public_id::text AS id, r.region_type AS kind, ST_AsGeoJSON(a.geom, 15) AS geometry
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.region_type IN ('meer', 'see')
        ORDER BY a.public_id
    `;
    if (!rows.some((row) => row.kind === "meer")) throw new Error("Kontinentalsockel braucht Meeresflächen");
    const landscapeRows = await database<{ type: string; area: number; geometry: string }[]>`
        SELECT r.region_type AS type, ST_Area(a.geom)::float8 AS area,
               ST_AsGeoJSON(CASE WHEN ST_IsValid(a.geom) THEN a.geom
                   ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END, 6) AS geometry
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
          AND r.region_type IN ('hochebene', 'huegelland')
        ORDER BY a.public_id
    `;
    const landscapes: LandscapeArea[] = landscapeRows.map((row) => ({
        layer: "topographie",
        type: row.type,
        area: row.area,
        geometry: JSON.parse(row.geometry),
    }));
    const hash = createHash("sha256").update(
        JSON.stringify({ params: CONTINENTAL_PARAMS, rows, peaks, rivers, landscapeRows, freePeaks }),
    );
    for (const r of mountains) {
        hash.update(JSON.stringify([r.cell, r.originX, r.originY, r.width, r.height]));
        hash.update(Buffer.from(r.samples.buffer, r.samples.byteOffset, r.samples.byteLength));
    }
    const inputFingerprint = hash.digest("hex");
    const [known] = await database<{ fingerprint: string; samples: Buffer }[]>`
        SELECT fingerprint, samples FROM terrain_continental_base
        WHERE map_domain_id = ${mapDomainId} AND input_fingerprint = ${inputFingerprint}
        ORDER BY fingerprint LIMIT 1
    `;
    if (known && !force)
        return {
            fingerprint: known.fingerprint,
            raster: {
                cell: 0.25,
                originX: 0.125,
                originY: 0.125,
                width: 4096,
                height: 4096,
                samples: new Uint16Array(
                    known.samples.buffer.slice(
                        known.samples.byteOffset,
                        known.samples.byteOffset + known.samples.byteLength,
                    ),
                ),
            },
        };
    const water: WaterArea[] = rows.map((row) => ({ kind: row.kind, geometry: JSON.parse(row.geometry) }));
    const result = generateContinentalBase(
        water,
        peaks,
        rivers,
        CONTINENTAL_PARAMS.size,
        mountains,
        landscapes,
        freePeaks,
    );
    globalThis.gc?.();
    await database`
        INSERT INTO terrain_continental_base (map_domain_id, fingerprint, input_fingerprint, size, samples)
        VALUES (${mapDomainId}, ${result.fingerprint}, ${inputFingerprint}, ${CONTINENTAL_PARAMS.size}, ${Buffer.from(result.raster.samples.buffer)})
        ON CONFLICT (map_domain_id, fingerprint) DO UPDATE SET input_fingerprint = EXCLUDED.input_fingerprint
    `;
    globalThis.gc?.();
    return result;
}
