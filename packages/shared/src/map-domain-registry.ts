import { Value } from "@sinclair/typebox/value";
import { MapDomainDefinition } from "./map-domain.ts";
import aventuriaDefinition from "../../../config/map-domains/aventuria.json" with { type: "json" };

/**
 * Loads the domain definitions from config/map-domains and validates them once at startup.
 * The JSON files stay the single authoritative source (chapter 4.10.2); nothing re-declares
 * bounds, scale or axes in code.
 */
function parseDefinition(candidate: unknown, fileName: string): MapDomainDefinition {
    if (!Value.Check(MapDomainDefinition, candidate)) {
        const [firstError] = [...Value.Errors(MapDomainDefinition, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid map domain definition in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA: MapDomainDefinition = parseDefinition(aventuriaDefinition, "aventuria.json");

export const MAP_DOMAINS: ReadonlyMap<string, MapDomainDefinition> = new Map([[AVENTURIA.mapDomain, AVENTURIA]]);

export function getMapDomain(mapDomainId: string): MapDomainDefinition {
    const definition = MAP_DOMAINS.get(mapDomainId);
    if (!definition) {
        throw new Error(`unknown map domain: ${mapDomainId}`);
    }
    return definition;
}
