import type { Database, Queryable } from "../../database.ts";
import {
    DEM_ENCODING,
    DEM_MAX_ZOOM,
    DEM_QUANT_METERS,
    DEM_TILE_FORMAT,
    DEM_TILE_SIZE,
    demRevision,
    demTiles,
    decodeDemTile,
    encodingFactor,
    type StoredRaster,
} from "../dem-tiles.ts";

export interface DomainPublication {
    revision: string;
    tiles: number;
    bytes: number;
    published: boolean;
}

/**
 * Prüft die Kacheln einer Veröffentlichung gegen den Master: Revision, Zahl und Bytes stimmen, und jede Kachel der
 * feinsten Stufe liest sich als dieselbe Höhe (bis auf die 0,1 m der Kodierung und die Rundung auf `DEM_QUANT_METERS`). Ohne `revision` gilt die
 * Veröffentlichung dieses Masters im Format, das der Code erzeugt (`DEM_TILE_FORMAT`): Nach der Umstellung auf WebP
 * gibt es zu einem Master zeitweise zwei Revisionen (die PNG-Revision davor und die neue).
 */
export async function verifyDomainPublication(
    database: Queryable,
    domain: string,
    fingerprint: string,
    raster: StoredRaster,
    revision?: string,
): Promise<string[]> {
    const errors: string[] = [];
    const [published] = await database<{ revision: string; tiles: number; bytes: string }[]>`
        SELECT revision, tiles, bytes FROM terrain_dem
        WHERE map_domain_id = ${domain} AND domain_fingerprint = ${fingerprint}
          AND (CASE WHEN ${revision ?? null}::text IS NULL THEN format = ${DEM_TILE_FORMAT} ELSE revision = ${revision ?? null} END)
        ORDER BY revision LIMIT 1
    `;
    if (!published) return ["publication:missing"];
    const tiles = await database<{ z: number; x: number; y: number; image: Buffer }[]>`
        SELECT z, x, y, png AS image FROM terrain_dem_tile WHERE revision = ${published.revision} ORDER BY z DESC, y, x
    `;
    if (tiles.length !== published.tiles || demRevision(tiles) !== published.revision)
        errors.push("publication:revision-or-count");
    if (tiles.reduce((sum, tile) => sum + tile.image.length, 0) !== Number(published.bytes))
        errors.push("publication:bytes");
    const decoded = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
    const size = DEM_TILE_SIZE << DEM_MAX_ZOOM;
    let mismatch = 0;
    for (const tile of tiles) {
        if (tile.z !== DEM_MAX_ZOOM) continue;
        decodeDemTile(tile.image, tile.z, tile.y, decoded);
        for (let y = 0; y < DEM_TILE_SIZE; y += 1) {
            const row = tile.y * DEM_TILE_SIZE + y;
            // Die halbe Schrittweite der Kodierung, in Schritt: 0,05 m Kodierungsauflösung plus die halbe Rundung
            // auf `DEM_QUANT_METERS` (WI-0142, ein Schritt). Ohne den zweiten Teil wies dieser Prüfer die Pyramide mit
            // 21.569.285 Abweichungen zurück - zu Recht, denn er kannte die gröbere Rundung nicht.
            const tolerance = (0.051 + DEM_QUANT_METERS / 2) / encodingFactor(tile.z, row) + 0.001;
            for (let x = 0; x < DEM_TILE_SIZE; x += 1) {
                const expected = raster.samples[(size - 1 - row) * size + tile.x * DEM_TILE_SIZE + x]!;
                if (Math.abs(decoded[y * DEM_TILE_SIZE + x]! - expected) > tolerance) mismatch += 1;
            }
        }
    }
    if (mismatch > 0) errors.push(`publication:master-mismatch:${String(mismatch)}`);
    return errors;
}

/** The master in tile orientation (row 0 north), still in whole Schritt: half the bytes of a Float32 field (8k). */
export function composeDomainDem(raster: StoredRaster): Uint16Array {
    const size = DEM_TILE_SIZE << DEM_MAX_ZOOM;
    if (
        raster.width !== size ||
        raster.height !== size ||
        raster.samples.length !== size * size ||
        raster.cell !== 1024 / size ||
        raster.originX !== raster.cell / 2 ||
        raster.originY !== raster.cell / 2
    )
        throw new Error("Invalid domain master grid for publication");
    const dem = new Uint16Array(size * size);
    for (let y = 0; y < size; y += 1)
        dem.set(raster.samples.subarray((size - 1 - y) * size, (size - y) * size), y * size);
    return dem;
}

/** Parallel product: the runtime is_current pointer is deliberately not changed here. */
export async function publishDomainDem(
    database: Database,
    domain: string,
    masterFingerprint: string,
    inputFingerprint: string,
    raster: StoredRaster,
    force = false,
): Promise<DomainPublication> {
    // Nur eine Veröffentlichung im heutigen Format zählt als bekannt: Eine PNG-Revision desselben Masters (vor
    // WI-0073) wird einmal neu kodiert, ohne dass der Master neu gerechnet werden muss.
    const [known] = await database<{ revision: string; tiles: number; bytes: string }[]>`
        SELECT revision, tiles, bytes FROM terrain_dem
        WHERE map_domain_id = ${domain} AND domain_fingerprint = ${masterFingerprint} AND format = ${DEM_TILE_FORMAT}
        ORDER BY revision LIMIT 1
    `;
    if (known && !force) return { ...known, bytes: Number(known.bytes), published: false };
    const tiles = demTiles(composeDomainDem(raster));
    const revision = demRevision(tiles);
    const bytes = tiles.reduce((sum, tile) => sum + tile.image.length, 0);
    if (known?.revision === revision) return { revision, tiles: tiles.length, bytes, published: false };
    await database.begin(async (tx) => {
        await tx`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, domain_fingerprint, format)
            VALUES (${revision}, ${domain}, ${inputFingerprint}, ${DEM_TILE_SIZE}, ${DEM_MAX_ZOOM}, ${DEM_ENCODING},
                ${tiles.length}, ${bytes}, ${masterFingerprint}, ${DEM_TILE_FORMAT})
            ON CONFLICT (revision) DO NOTHING
        `;
        for (const tile of tiles)
            await tx`
            INSERT INTO terrain_dem_tile (revision, z, x, y, png)
            VALUES (${revision}, ${tile.z}, ${tile.x}, ${tile.y}, ${tile.image})
            ON CONFLICT (revision, z, x, y) DO NOTHING
        `;
    });
    return { revision, tiles: tiles.length, bytes, published: true };
}
