import type { CoordinateSpace, MapPoint } from "./map-domain.ts";

/**
 * Derived Render Projection (chapter 4.17.4).
 *
 * The renderer stack expects Web Mercator coordinates, so domain geometry is mapped onto that
 * range by a deterministic, reversible affine transform. This is NOT a georeference of Aventuria:
 * the result is DERIVED and must never be used for distances, routing costs, editor persistence,
 * data lineage or domain geometry. Those stay in the map coordinate space.
 */

/** Half the width of the Web Mercator world in metres, the standard EPSG:3857 extent. */
export const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;

export interface RenderProjection {
    toRender(point: MapPoint): MapPoint;
    fromRender(point: MapPoint): MapPoint;
    /** Scale factor from map units to render units; also used by the SQL side. */
    readonly scale: number;
}

/**
 * Maps the domain square onto the full Web Mercator square, so one render zoom level covers the
 * whole domain exactly like it covers the whole world. A non-square domain keeps its aspect ratio
 * by using the longer side, which leaves unused render space rather than distorting geometry.
 */
export function createRenderProjection(space: CoordinateSpace): RenderProjection {
    const { bounds } = space;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const extent = Math.max(width, height);
    if (!(extent > 0)) {
        throw new Error(`coordinate space ${space.id} has no extent`);
    }
    const scale = (2 * WEB_MERCATOR_HALF_WORLD) / extent;

    return {
        scale,
        toRender(point: MapPoint): MapPoint {
            return {
                x: (point.x - bounds.minX) * scale - WEB_MERCATOR_HALF_WORLD,
                y: (point.y - bounds.minY) * scale - WEB_MERCATOR_HALF_WORLD,
            };
        },
        fromRender(point: MapPoint): MapPoint {
            return {
                x: (point.x + WEB_MERCATOR_HALF_WORLD) / scale + bounds.minX,
                y: (point.y + WEB_MERCATOR_HALF_WORLD) / scale + bounds.minY,
            };
        },
    };
}

/**
 * Longitude/latitude for a domain point, because MapLibre's camera API speaks WGS84 only
 * (its LngLat is fixed to that; see ADR-0003). Purely a camera helper, never a data path.
 */
export function toRenderLngLat(space: CoordinateSpace, point: MapPoint): { lng: number; lat: number } {
    const projected = createRenderProjection(space).toRender(point);
    const lng = (projected.x / WEB_MERCATOR_HALF_WORLD) * 180;
    const latRadians = 2 * Math.atan(Math.exp((projected.y / WEB_MERCATOR_HALF_WORLD) * Math.PI)) - Math.PI / 2;
    return { lng, lat: (latRadians * 180) / Math.PI };
}

/** Inverse of {@link toRenderLngLat}: a camera or picked coordinate back into the map space. */
export function fromRenderLngLat(space: CoordinateSpace, lngLat: { lng: number; lat: number }): MapPoint {
    const x = (lngLat.lng / 180) * WEB_MERCATOR_HALF_WORLD;
    const latRadians = (lngLat.lat * Math.PI) / 180;
    const y = (WEB_MERCATOR_HALF_WORLD * Math.log(Math.tan(Math.PI / 4 + latRadians / 2))) / Math.PI;
    return createRenderProjection(space).fromRender({ x, y });
}

/**
 * Just inside the antimeridian. A camera bound of exactly 180 degrees is wrapped back to 0 by
 * MapLibre, which makes the allowed width zero and the resulting scale factor infinite - the map
 * then fails while resizing, before anything is drawn. MapLibre keeps the same distance from the
 * edge in its own fallback, so this is its rule, not a guess.
 */
const ALMOST_180 = 180 - 1e-10;

/**
 * The domain square as a camera bounding box.
 *
 * Web Mercator is the projection of a globe and therefore repeats east and west; Aventuria does
 * not. Together with MapLibre's `renderWorldCopies: false` this keeps the camera inside the one
 * domain there is, instead of letting the map continue into copies of itself (chapter 5.1).
 *
 * A domain that fills the render square lands on the edge of the projection; a narrower one gets
 * a correspondingly smaller box, which is why this is derived instead of hard-coded.
 */
export function renderBounds(space: CoordinateSpace): {
    southWest: { lng: number; lat: number };
    northEast: { lng: number; lat: number };
} {
    const { bounds } = space;
    const southWest = toRenderLngLat(space, { x: bounds.minX, y: bounds.minY });
    const northEast = toRenderLngLat(space, { x: bounds.maxX, y: bounds.maxY });
    return {
        southWest: { lng: Math.max(southWest.lng, -ALMOST_180), lat: southWest.lat },
        northEast: { lng: Math.min(northEast.lng, ALMOST_180), lat: northEast.lat },
    };
}
