import { createHash } from "node:crypto";
import { MAP_DOMAINS, type MapDomainDefinition } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";

function checksumOf(definition: MapDomainDefinition): string {
    return createHash("sha256").update(JSON.stringify(definition.coordinateSpace)).digest("hex");
}

/**
 * Writes the coordinate space of every configured map domain into the database.
 *
 * The config file stays authoritative (chapter 4.10.2). This only projects it so SQL constraints
 * can use the bounds; a stored row that disagrees with the config is overwritten, never the other
 * way round, and the checksum makes a drift visible.
 */
export async function seedMapDomains(database: Database): Promise<string[]> {
    const seeded: string[] = [];
    for (const definition of MAP_DOMAINS.values()) {
        const space = definition.coordinateSpace;
        await database`
            INSERT INTO map_domain (
                id, coordinate_space_id, min_x, min_y, max_x, max_y,
                axis_x, axis_y, miles_per_unit, schritt_per_unit, config_checksum, updated_at
            ) VALUES (
                ${definition.mapDomain}, ${space.id},
                ${space.bounds.minX}, ${space.bounds.minY}, ${space.bounds.maxX}, ${space.bounds.maxY},
                ${space.axis.x}, ${space.axis.y},
                ${space.distance.milesPerUnit}, ${space.distance.schrittPerUnit},
                ${checksumOf(definition)}, now()
            )
            ON CONFLICT (id) DO UPDATE SET
                coordinate_space_id = EXCLUDED.coordinate_space_id,
                min_x = EXCLUDED.min_x, min_y = EXCLUDED.min_y,
                max_x = EXCLUDED.max_x, max_y = EXCLUDED.max_y,
                axis_x = EXCLUDED.axis_x, axis_y = EXCLUDED.axis_y,
                miles_per_unit = EXCLUDED.miles_per_unit,
                schritt_per_unit = EXCLUDED.schritt_per_unit,
                config_checksum = EXCLUDED.config_checksum,
                updated_at = now()
        `;
        seeded.push(definition.mapDomain);
    }
    return seeded;
}
