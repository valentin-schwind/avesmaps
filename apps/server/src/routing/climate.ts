import type { Queryable } from "../database.ts";
import { areaEdges, areasContainPoint, prepareWater, type Water } from "./water.ts";

/**
 * Die Klimazonen für den Boden der Jahreszeit (WI-0038, E10): die acht abgeleiteten Bänder aus
 * `climate_band`. Gefragt wird immer das BAND, nie die Trennlinie - die Linien laufen stellenweise
 * rückwärts (Blasen), und ein Test „liegt unter der Linie“ irrt auf rund einem Fünftel der Karte
 * (MCS-009).
 *
 * Ein Weg liegt in der Zone, in der der größte Teil seiner Länge liegt, wie Legacys Etappe
 * (`routeEntryClimateZone`). Einmal je Stück gerechnet und gemerkt: Die Bänder ändern sich nur mit
 * neuen Daten, und dann lädt der Dienst ohnehin neu.
 */

export interface ClimateZones {
    bands: { key: string; area: Water }[];
    /** Je Linie ihre Zone; `null` außerhalb aller Bänder. */
    zoneOf(coordinates: readonly [number, number][]): string | null;
}

/** Abstand der Proben entlang einer Linie, in Karteneinheiten. */
const SAMPLE_STEP = 0.5;

type AreaGeometry = Parameters<typeof areaEdges>[0];

export function prepareClimate(
    rows: { key: string; geometry: AreaGeometry; minX: number; minY: number; maxX: number; maxY: number }[],
): ClimateZones {
    const bands = rows.map((row) => ({ key: row.key, area: prepareWater([row]) }));
    const zoneAt = (x: number, y: number): string | null =>
        bands.find((band) => areasContainPoint(x, y, band.area))?.key ?? null;
    const cache = new WeakMap<readonly [number, number][], string | null>();
    return {
        bands,
        zoneOf(coordinates) {
            const known = cache.get(coordinates);
            if (known !== undefined) return known;
            // Jedes Stück der Linie wird in gleiche Teile zerlegt und an deren Mitten gefragt; die Zone
            // mit der meisten Länge gewinnt.
            const lengths = new Map<string, number>();
            for (let index = 1; index < coordinates.length; index += 1) {
                const [x0, y0] = coordinates[index - 1] as [number, number];
                const [x1, y1] = coordinates[index] as [number, number];
                const length = Math.hypot(x1 - x0, y1 - y0);
                const parts = Math.max(1, Math.ceil(length / SAMPLE_STEP));
                for (let part = 0; part < parts; part += 1) {
                    const t = (part + 0.5) / parts;
                    const zone = zoneAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
                    if (zone !== null) lengths.set(zone, (lengths.get(zone) ?? 0) + length / parts);
                }
            }
            let best: string | null = null;
            let bestLength = 0;
            for (const [zone, length] of lengths) {
                if (length > bestLength) {
                    best = zone;
                    bestLength = length;
                }
            }
            cache.set(coordinates, best);
            return best;
        },
    };
}

export const NO_CLIMATE: ClimateZones = prepareClimate([]);

/** Die Klimabänder. Sie gehören keiner Kartendomäne (`climate_band` hat keine), es gibt nur Aventurien. */
export async function loadClimate(database: Queryable): Promise<ClimateZones> {
    const rows = await database<
        { key: string; geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]
    >`
        SELECT type_key AS key, ST_AsGeoJSON(geom) AS geometry,
               ST_XMin(geom) AS min_x, ST_YMin(geom) AS min_y, ST_XMax(geom) AS max_x, ST_YMax(geom) AS max_y
        FROM climate_band
        ORDER BY type_key
    `;
    return prepareClimate(
        rows.map((row) => ({
            key: row.key,
            geometry: JSON.parse(row.geometry) as AreaGeometry,
            minX: row.min_x,
            minY: row.min_y,
            maxX: row.max_x,
            maxY: row.max_y,
        })),
    );
}
