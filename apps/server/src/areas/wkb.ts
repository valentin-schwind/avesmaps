import type { SmoothCoords as Coords, SurfaceCoords } from "@avesmaps3d/shared";

/**
 * Flächen als WKB lesen und schreiben (WI-0077): `ST_AsBinary` hin, `ST_GeomFromWKB` zurück. Bit für Bit dieselben
 * Zahlen wie in PostGIS: Gemeinsame Punkte zweier Flächen sind in TypeScript gleich, wenn sie es in der Datenbank sind.
 * Nur das, was eine Fläche braucht: Polygon und MultiPolygon in 2D (andere Teile einer Sammlung werden übergangen).
 */

/** Eine Fläche: Teile, je Teil die Ringe (der erste ist die Hülle), jeder Ring geschlossen (Typ seit WI-0178 L2 in `packages/shared`). */
export type { SurfaceCoords };

const POLYGON = 3;
const MULTI_POLYGON = 6;
const GEOMETRY_COLLECTION = 7;

/** Liest ein Polygon, MultiPolygon oder die Flächen einer Sammlung. */
export function readSurfaceWkb(bytes: Uint8Array): SurfaceCoords {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const polygons: Coords[][] = [];
    let offset = 0;

    const readPolygon = (little: boolean, dims: number): Coords[] => {
        const ringCount = view.getUint32(offset, little);
        offset += 4;
        const rings: Coords[] = [];
        for (let r = 0; r < ringCount; r += 1) {
            const pointCount = view.getUint32(offset, little);
            offset += 4;
            const ring = new Float64Array(2 * pointCount);
            for (let p = 0; p < pointCount; p += 1) {
                ring[2 * p] = view.getFloat64(offset, little);
                ring[2 * p + 1] = view.getFloat64(offset + 8, little);
                offset += 8 * dims;
            }
            rings.push(ring);
        }
        return rings;
    };

    const readGeometry = (): void => {
        const little = view.getUint8(offset) === 1;
        offset += 1;
        const rawType = view.getUint32(offset, little);
        offset += 4;
        // ISO-Kennungen (1000 Z, 2000 M, 3000 ZM) und EWKB-Bits (Z, M, SRID) auf Grundtyp und Maße zurückführen.
        const iso = rawType & 0x0fffffff;
        const type = iso % 1000;
        const isoDims = Math.floor(iso / 1000);
        const hasZ = (rawType & 0x80000000) !== 0 || isoDims === 1 || isoDims === 3;
        const hasM = (rawType & 0x40000000) !== 0 || isoDims === 2 || isoDims === 3;
        const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
        if ((rawType & 0x20000000) !== 0) offset += 4;
        if (type === POLYGON) {
            polygons.push(readPolygon(little, dims));
        } else if (type === MULTI_POLYGON || type === GEOMETRY_COLLECTION) {
            const count = view.getUint32(offset, little);
            offset += 4;
            for (let i = 0; i < count; i += 1) readGeometry();
        } else {
            throw new Error(`WKB: Typ ${String(type)} ist keine Fläche`);
        }
    };

    readGeometry();
    return polygons;
}

/** Schreibt ein MultiPolygon (Little Endian, 2D). */
export function writeMultiPolygonWkb(polygons: SurfaceCoords): Buffer {
    let size = 1 + 4 + 4;
    for (const rings of polygons) {
        size += 1 + 4 + 4;
        for (const ring of rings) size += 4 + 8 * ring.length;
    }
    const buffer = Buffer.alloc(size);
    let offset = 0;
    buffer.writeUInt8(1, offset);
    buffer.writeUInt32LE(MULTI_POLYGON, offset + 1);
    buffer.writeUInt32LE(polygons.length, offset + 5);
    offset += 9;
    for (const rings of polygons) {
        buffer.writeUInt8(1, offset);
        buffer.writeUInt32LE(POLYGON, offset + 1);
        buffer.writeUInt32LE(rings.length, offset + 5);
        offset += 9;
        for (const ring of rings) {
            buffer.writeUInt32LE(ring.length / 2, offset);
            offset += 4;
            for (let i = 0; i < ring.length; i += 1) {
                buffer.writeDoubleLE(ring[i] as number, offset);
                offset += 8;
            }
        }
    }
    return buffer;
}
