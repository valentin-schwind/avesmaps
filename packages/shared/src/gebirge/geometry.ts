/**
 * Punkt in Fläche wie Legacy (`js/map-features/map-features-point-in-polygon.js`, aff0449a5):
 * gerade/ungerade Kreuzungszahl, Löcher und MultiPolygon. Punkte sind `[x, y]` in Kartenkoordinaten.
 */
import type { V12Geometry } from "./types.ts";

type Punkt = readonly number[];
type Ring = readonly Punkt[];

/** point-in-polygon.js#L4-15 */
export function pointInRing(point: Punkt, ring: Ring): boolean {
    const x = point[0] as number;
    const y = point[1] as number;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i] as Punkt;
        const b = ring[j] as Punkt;
        const xi = a[0] as number;
        const yi = a[1] as number;
        const xj = b[0] as number;
        const yj = b[1] as number;
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

/** point-in-polygon.js#L17-24: im äußeren Ring und in keinem Loch. */
export function pointInPolygon(point: Punkt, polygonCoords: readonly Ring[] | null | undefined): boolean {
    if (!polygonCoords || !polygonCoords.length) return false;
    if (!pointInRing(point, polygonCoords[0] as Ring)) return false;
    for (let h = 1; h < polygonCoords.length; h++) {
        if (pointInRing(point, polygonCoords[h] as Ring)) return false;
    }
    return true;
}

/** point-in-polygon.js#L26-31 */
export function pointInGeometry(point: Punkt, geometry: V12Geometry | null | undefined): boolean {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates as number[][][]);
    if (geometry.type === "MultiPolygon") {
        return (geometry.coordinates as number[][][][]).some((poly) => pointInPolygon(point, poly));
    }
    return false;
}
