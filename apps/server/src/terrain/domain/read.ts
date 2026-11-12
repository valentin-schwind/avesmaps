import { readSlices, SLICE_BYTES } from "../../routing/sliced-read.ts";
import { createHash } from "node:crypto";
import type { Queryable } from "../../database.ts";
import type { StoredRaster } from "../dem-tiles.ts";
import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";

export interface MountainMembership {
    geometry: V12Geometry;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export interface DomainHeightSource {
    raster: StoredRaster;
    fingerprint: string;
    revision: string;
    mountains: readonly MountainMembership[];
    membershipFingerprint: string;
}

export function domainMountainAt(source: Pick<DomainHeightSource, "mountains">, x: number, y: number): boolean {
    return source.mountains.some(
        (area) =>
            x >= area.minX &&
            x <= area.maxX &&
            y >= area.minY &&
            y <= area.maxY &&
            pointInGeometry([x, y], area.geometry),
    );
}

/**
 * Stored uint16 samples from a driver buffer. The driver hands over its own buffer of exactly these bytes:
 * view it instead of copying 32 MiB (WI-0067). A shared or odd-aligned buffer is copied, so a view never
 * keeps a larger allocation alive.
 */
export function storedSamples(bytes: Buffer): Uint16Array {
    return bytes.byteOffset % 2 === 0 && bytes.buffer.byteLength === bytes.byteLength
        ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
        : new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * The master's samples in 1-MiB slices (WI-0071 pattern): a 128-MiB 8k master read whole costs about a GiB of
 * driver buffers; sliced, the result is one buffer of the final size. Byte for byte the stored row.
 */
export async function readDomainSamples(
    database: Queryable,
    domain: string,
    fingerprint: string,
    size: number,
): Promise<Uint16Array> {
    const bytes = await readSlices(size * size * 2, SLICE_BYTES, async (offset, length) => {
        const [row] = await database<{ part: Buffer }[]>`
            SELECT substring(samples FROM ${offset + 1} FOR ${length}) AS part
            FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
        `;
        return row?.part;
    });
    if (!bytes) throw new Error(`Domain master ${fingerprint} is not readable`);
    return new Uint16Array(bytes.buffer);
}

export async function loadPublishedDomainSource(
    database: Queryable,
    domain: string,
    fingerprint?: string,
    /** The master already in memory (just derived): not read a second time. */
    known?: Uint16Array,
): Promise<DomainHeightSource | null> {
    const [stored] = await database<{ fingerprint: string; revision: string; size: number }[]>`
        SELECT t.fingerprint, d.revision, t.size FROM terrain_domain_raster t
        JOIN terrain_dem d ON d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint
        WHERE t.map_domain_id = ${domain} AND (${fingerprint ?? null}::text IS NOT NULL OR d.is_current) AND (${fingerprint ?? null}::text IS NULL OR t.fingerprint = ${fingerprint ?? null})
        ORDER BY d.is_current DESC, t.derived_at DESC, d.created_at DESC LIMIT 1
    `;
    if (!stored) return null;
    const areas = await database<{ geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]>`
        SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3),15) AS geometry,
            ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.is_active AND a.map_domain_id = ${domain} AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        ORDER BY a.public_id
    `;
    const samples =
        known?.length === stored.size * stored.size
            ? known
            : await readDomainSamples(database, domain, stored.fingerprint, stored.size);
    const cell = 1024 / stored.size;
    return {
        fingerprint: stored.fingerprint,
        revision: stored.revision,
        membershipFingerprint: createHash("sha256").update(JSON.stringify(areas)).digest("hex"),
        raster: {
            cell,
            originX: cell / 2,
            originY: cell / 2,
            width: stored.size,
            height: stored.size,
            samples,
        },
        mountains: areas.map((area) => ({
            geometry: JSON.parse(area.geometry),
            minX: area.min_x,
            minY: area.min_y,
            maxX: area.max_x,
            maxY: area.max_y,
        })),
    };
}

export function domainHeightAt(source: DomainHeightSource, x: number, y: number): number {
    const r = source.raster;
    const fx = Math.max(0, Math.min(r.width - 1, (x - r.originX) / r.cell));
    const fy = Math.max(0, Math.min(r.height - 1, (y - r.originY) / r.cell));
    const i = Math.min(r.width - 2, Math.floor(fx));
    const j = Math.min(r.height - 2, Math.floor(fy));
    const dx = fx - i;
    const dy = fy - j;
    return (
        r.samples[j * r.width + i]! * (1 - dx) * (1 - dy) +
        r.samples[j * r.width + i + 1]! * dx * (1 - dy) +
        r.samples[(j + 1) * r.width + i]! * (1 - dx) * dy +
        r.samples[(j + 1) * r.width + i + 1]! * dx * dy
    );
}

/** Union membership: overlapping mountain polygons count once, including cells at height zero. */
export function domainMountainMask(source: DomainHeightSource): Uint8Array {
    const r = source.raster;
    const mask = new Uint8Array(r.width * r.height);
    for (const area of source.mountains) {
        const left = Math.max(0, Math.ceil((area.minX - r.originX) / r.cell));
        const bottom = Math.max(0, Math.ceil((area.minY - r.originY) / r.cell));
        const right = Math.min(r.width - 1, Math.floor((area.maxX - r.originX) / r.cell));
        const top = Math.min(r.height - 1, Math.floor((area.maxY - r.originY) / r.cell));
        for (let y = bottom; y <= top; y += 1) {
            for (let x = left; x <= right; x += 1) {
                const k = y * r.width + x;
                if (mask[k] || !pointInGeometry([r.originX + x * r.cell, r.originY + y * r.cell], area.geometry))
                    continue;
                mask[k] = 1;
            }
        }
    }
    return mask;
}
