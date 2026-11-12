import {
    AREA_LOOKUP_LIMITS,
    outlineTolerance,
    type AreaAtResponse,
    type AreaLookupLayer,
    type AreaOutlineResponse,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database, type Queryable } from "../database.ts";

/**
 * Die Leseabfragen der Kartenauswahl (WI-0058): Flächen unter einem Punkt, Flüsse im Umkreis, Umrisse von
 * Regionen. Dieselben Filter wie die Kacheln (`region_area_render`, Wege), damit die Auswahl hier und dort
 * dasselbe findet.
 *
 * 🔴 LIEST NUR, in einer Transaktion mit eigener Zeitgrenze (`withStatementTimeout`, wie die Landschaften der
 * Route). Punkt- und Umkreisabfragen laufen über die vorhandenen GiST-Indizes (`region_area_geom_gist`,
 * `path_geom_idx`) und brauchen wenige Millisekunden.
 *
 * 🪤 Punkt im Polygon rechnet PostGIS selbst, nicht GEOS: Die 20 ungültigen Legacy-Flächen (Schleifen,
 * Löcher außerhalb) werfen hier keine TopologyException.
 *
 * 🔴 Wer nicht mehr wartet, beschäftigt die Datenbank nicht weiter (WI-0123, wie die Landschaften der Route in `bebb4630`):
 * Mit `signal` bricht die laufende Abfrage ab, sobald der Client die Anfrage schließt. Die Karte bricht die alte Frage ab,
 * wenn der Zeiger weiterzieht; ohne das rechnete der Server jede davon weiter, und vier solche belegten die Plätze, die die
 * nächste Frage mit 503 `busy` abwiesen.
 */

export interface AreaAtParams {
    x: number;
    y: number;
    layers: readonly AreaLookupLayer[];
    lakes: boolean;
    /** Flüsse in diesem Umkreis (E); 0 heißt keine. */
    reach: number;
}

export async function areasAt(
    database: Database,
    params: AreaAtParams,
    mapDomainId = "aventuria",
    statementMs: number = AREA_LOOKUP_LIMITS.statementMs,
    signal?: AbortSignal,
): Promise<AreaAtResponse> {
    return withStatementTimeout(
        database,
        statementMs,
        (transaction) => queryAreasAt(transaction, params, mapDomainId),
        signal ? { signal } : {},
    );
}

/**
 * Dieselben Abfragen innerhalb einer laufenden Transaktion: Der Kontext der Subjects (WI-0063 P4) fragt Flächen und
 * Flüsse unter einem Punkt mit derselben Semantik wie die Kartenauswahl, aber gemeinsam mit seinen Gebieten und seinem
 * Klima in EINER Zeitgrenze - keine zweite räumliche Abfrage mit anderer Bedeutung.
 */
export async function queryAreasAt(
    transaction: Queryable,
    params: AreaAtParams,
    mapDomainId = "aventuria",
): Promise<AreaAtResponse> {
    const areas = await transaction<AreaAtResponse["areas"]>`
        SELECT r.public_id AS region_public_id,
               r.name,
               r.region_type,
               r.region_layer,
               round(ST_Area(a.geom)::numeric, 2)::float8 AS area,
               r.is_locked
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = ${mapDomainId}
          AND a.is_active AND r.is_active AND NOT r.is_hidden
          AND r.region_layer = ANY(${[...params.layers]}::text[])
          AND (${params.lakes} OR r.region_type <> 'see')
          AND ST_Intersects(a.geom, ST_SetSRID(ST_MakePoint(${params.x}, ${params.y}), 0))
        ORDER BY a.public_id
    `;
    const rivers =
        params.reach > 0
            ? await transaction<AreaAtResponse["rivers"]>`
                  SELECT DISTINCT p.name, p.subtype, p.is_bach
                  FROM path p
                  WHERE p.map_domain_id = ${mapDomainId}
                    AND p.is_active
                    AND p.subtype = 'Flussweg'
                    AND btrim(p.name) <> ''
                    AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(${params.x}, ${params.y}), 0), ${params.reach})
                  ORDER BY p.name, p.subtype, p.is_bach
              `
            : [];
    return { areas: [...areas], rivers: [...rivers] };
}

/**
 * Die Flüsse im Umkreis `reach` (E) um einen Punkt MIT ihrem Abstand: dieselbe Auswahl wie `rivers` in `queryAreasAt` (benannte
 * Flusswege der Domäne), je Fluss einmal, der nächste zuerst. Der Kartenpunkt eines Subjects nennt den Abstand, damit die Oberfläche
 * je nach Zoom entscheidet, welcher Fluss noch „hier“ ist (fünf Bildpunkte sind bei Zoom 1 rund 5 E, bei Zoom 6 rund 0,16 E).
 */
export async function queryRiverDistances(
    transaction: Queryable,
    x: number,
    y: number,
    reach: number,
    mapDomainId = "aventuria",
): Promise<{ name: string; subtype: string; is_bach: boolean; distance: number }[]> {
    const rows = await transaction<{ name: string; subtype: string; is_bach: boolean; distance: number }[]>`
        SELECT p.name, p.subtype, p.is_bach,
               round(min(ST_Distance(p.geom, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)))::numeric, 2)::float8 AS distance
        FROM path p
        WHERE p.map_domain_id = ${mapDomainId}
          AND p.is_active
          AND p.subtype = 'Flussweg'
          AND btrim(p.name) <> ''
          AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), ${reach})
        GROUP BY p.name, p.subtype, p.is_bach
        ORDER BY distance, p.name, p.subtype, p.is_bach
    `;
    return [...rows];
}

/**
 * Die Umrisse der Regionen `ids`, je Fläche ein Feature, auf einen halben Bildpunkt bei Zoom `z` vereinfacht.
 * Mit `smooth` hat jede Fläche die nahtlos geglättete Form, die auch die Kachel zeigt (`region_area_smooth`, Migrationen 0067
 * und 0072, seit WI-0077 alle Flächen samt Seen und Meeren). Ohne frische Zeile bleibt es die Ausgangsform wie in
 * `region_area_render`, bei See und Meer die einzeln geglättete Form wie in `terrain_water_render` (`terrain_water_smooth`).
 */
export async function areaOutlines(
    database: Database,
    ids: readonly string[],
    z: number,
    smooth: boolean,
    mapDomainId = "aventuria",
    statementMs: number = AREA_LOOKUP_LIMITS.statementMs,
    signal?: AbortSignal,
): Promise<AreaOutlineResponse> {
    const tolerance = outlineTolerance(z);
    return withStatementTimeout(
        database,
        statementMs,
        async (transaction) => {
            const rows = await transaction<{ region_public_id: string; region_type: string; geojson: string }[]>`
            SELECT r.public_id AS region_public_id,
                   r.region_type,
                   ST_AsGeoJSON(
                       ST_Simplify(
                           CASE WHEN ${smooth} AND s.region_area_id IS NOT NULL THEN s.geom
                                WHEN ${smooth} AND r.region_type IN ('see', 'meer') THEN terrain_water_smooth(a.geom)
                                ELSE a.geom END,
                           ${tolerance}
                       ),
                       4
                   ) AS geojson
            FROM region_area a
            JOIN region r ON r.id = a.region_id
            LEFT JOIN region_area_smooth s
                   ON s.region_area_id = a.id
                  AND s.source_updated_at = a.updated_at
                  AND region_area_is_smoothed(r.region_layer, r.region_type)
            WHERE a.map_domain_id = ${mapDomainId}
              AND a.is_active AND r.is_active
              AND r.public_id = ANY(${[...ids]}::uuid[])
            ORDER BY a.public_id
        `;
            const features: AreaOutlineResponse["features"] = [];
            for (const row of rows) {
                const geometry = JSON.parse(row.geojson) as { type: string; coordinates: unknown[] };
                // Eine zur Linie oder zum Punkt geschrumpfte Fläche zeichnet nichts.
                if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
                features.push({
                    type: "Feature",
                    properties: { region_public_id: row.region_public_id, region_type: row.region_type },
                    geometry: { type: geometry.type, coordinates: geometry.coordinates },
                });
            }
            return { type: "FeatureCollection", features };
        },
        signal ? { signal } : {},
    );
}
