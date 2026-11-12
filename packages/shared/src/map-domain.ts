import { Type, type Static } from "@sinclair/typebox";

/**
 * Map Coordinate Space of a map domain (chapter 4.10): cartesian, planar, non-geographic and
 * independent of any renderer. Persistent domain geometry is interpreted in this space.
 */
export const CoordinateSpace = Type.Object(
    {
        id: Type.String(),
        type: Type.Literal("cartesian"),
        geographic: Type.Literal(false),
        bounds: Type.Object(
            {
                minX: Type.Number(),
                minY: Type.Number(),
                maxX: Type.Number(),
                maxY: Type.Number(),
            },
            { additionalProperties: false },
        ),
        axis: Type.Object(
            {
                x: Type.Union([Type.Literal("east"), Type.Literal("west")]),
                y: Type.Union([Type.Literal("north"), Type.Literal("south")]),
            },
            { additionalProperties: false },
        ),
        // GeoJSON stores [x, y]; renderers that want [y, x] convert at their own boundary.
        storageOrder: Type.Literal("xy"),
        distance: Type.Object(
            {
                unit: Type.Literal("map_unit"),
                milesPerUnit: Type.Number({ exclusiveMinimum: 0 }),
                schrittPerUnit: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
        elevation: Type.Object(
            {
                unit: Type.Literal("schritt"),
                metresPerUnit: Type.Number({ exclusiveMinimum: 0 }),
            },
            { additionalProperties: false },
        ),
    },
    { $id: "CoordinateSpace", additionalProperties: false },
);

export type CoordinateSpace = Static<typeof CoordinateSpace>;

export const MapDomainDefinition = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        coordinateSpace: CoordinateSpace,
        planetaryRegistration: Type.Object(
            {
                status: Type.Union([Type.Literal("none"), Type.Literal("verified")]),
            },
            { additionalProperties: true },
        ),
    },
    { $id: "MapDomainDefinition", additionalProperties: true },
);

export type MapDomainDefinition = Static<typeof MapDomainDefinition>;

export interface MapPoint {
    x: number;
    y: number;
}

export function isWithinBounds(space: CoordinateSpace, point: MapPoint): boolean {
    const { bounds } = space;
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

/** Euclidean distance in map units. The domain space is planar, so no projection is involved. */
export function distanceInUnits(from: MapPoint, to: MapPoint): number {
    return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Distance in Meilen. This is the only place that applies the scale; chapter 2.4 forbids a second
 * copy of the factor, and the legacy system carried three (finding MCS-002).
 */
export function distanceInMiles(space: CoordinateSpace, from: MapPoint, to: MapPoint): number {
    return distanceInUnits(from, to) * space.distance.milesPerUnit;
}

/**
 * Travel time calibration is NOT a spatial conversion and must never be folded into the scale
 * (chapter 5.2.2). It therefore has no place in this module.
 */
