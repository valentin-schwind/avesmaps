import { MigrationAborted, type LegacyLocation, type LegacyPayload } from "./places.ts";

/**
 * Reads the legacy map payload, the source the legacy map itself draws from.
 *
 * `GET /api/locations/` builds from the route network and skips unnamed entries, so it is not the
 * whole place inventory - it was two places short (Finding MCS-006). This endpoint is public,
 * needs no session, and carries every feature the map knows.
 *
 * Only locations are read here. Paths, junctions, labels, regions and powerlines are separate data
 * domains with their own contracts, and picking them up on the way would be exactly the silent
 * scope creep a migration contract exists to prevent.
 */

interface MapFeature {
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: Record<string, unknown>;
}

export interface MapFeaturesPayload {
    ok?: unknown;
    revision?: unknown;
    features?: unknown;
}

/**
 * The source has to be recognisable as a whole payload before anything is read from it. A file
 * that was cut short fails to parse; what this catches is a payload that parses but is not the
 * answer we think it is - an error page, a different endpoint, an empty result.
 *
 * 🔴 Stays a stop (operator 2026-10-03, "A auch für die Prüfungen", BLOCKING_SOURCE_CHECKS A13).
 */
export function assertMapFeaturesUsable(payload: MapFeaturesPayload): void {
    if (payload.ok !== true) {
        throw new MigrationAborted("the map payload does not report ok", { ok: String(payload.ok) });
    }
    if (!Number.isFinite(Number(payload.revision))) {
        throw new MigrationAborted("the map payload carries no revision", { revision: String(payload.revision) });
    }
    if (!Array.isArray(payload.features) || payload.features.length === 0) {
        throw new MigrationAborted("the map payload carries no features", {
            features: Array.isArray(payload.features) ? payload.features.length : "none",
        });
    }
}

function readFlag(properties: Record<string, unknown>, key: string): boolean {
    // A missing key means false. Legacy writes these flags on the first save of a place and every
    // place started at 0, so absence is an answer here, not a gap (Finding MCS-006).
    return properties[key] === true;
}

function readPlaceKind(properties: Record<string, unknown>): string | undefined {
    const value = typeof properties["place_kind"] === "string" ? properties["place_kind"].trim() : "";
    return value === "" ? undefined : value;
}

/** Normalises the map payload into the shape the places importer already speaks. */
export function locationsFromMapFeatures(payload: MapFeaturesPayload): LegacyPayload {
    assertMapFeaturesUsable(payload);

    const locations: LegacyLocation[] = [];
    for (const candidate of payload.features as MapFeature[]) {
        const properties = candidate.properties ?? {};
        if (properties["feature_type"] !== "location") {
            continue;
        }
        const coordinates = candidate.geometry?.coordinates;
        const [x, y] = Array.isArray(coordinates) ? coordinates : [undefined, undefined];

        locations.push({
            public_id: properties["public_id"],
            name: properties["name"],
            // settlement_class is the authoritative class; feature_subtype carries the same value.
            subtype: properties["settlement_class"] ?? properties["feature_subtype"],
            is_crossing: false,
            coordinates: { x, y },
            is_hidden: readFlag(properties, "is_hidden"),
            is_ruined: readFlag(properties, "is_ruined"),
            is_nodix: readFlag(properties, "is_nodix"),
            is_seaport: readFlag(properties, "is_seaport"),
            place_kind: readPlaceKind(properties),
        });
    }

    return {
        map_revision: payload.revision,
        location_count: locations.length,
        locations,
    };
}
