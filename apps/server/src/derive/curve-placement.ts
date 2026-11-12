import type { Queryable } from "../database.ts";
import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import { pathLength, resample, type Point } from "./chordal-axis.ts";
import { maxDeviationAngle } from "./curve-fit.ts";
import type { DerivedRun } from "./label-runs.ts";
import { kurvenstueck, mapUnitsPerPixel } from "./run-geometry.ts";

export interface CurveFootprint {
    geometry: V12Geometry;
    wkt: string;
    concave: boolean;
}

/** Originalfläche, nicht vereinfachter Rand oder nur der größte Teil: Brücken bleiben erlaubt. */
export async function curveFootprint(database: Queryable, regionId: number): Promise<CurveFootprint> {
    const [row] = await database<CurveFootprint[]>`
        WITH shape AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM region_area
            WHERE region_id = ${regionId} AND is_active
        )
        SELECT ST_AsGeoJSON(geom)::json AS geometry, ST_AsText(geom) AS wkt,
               (ST_NumGeometries(geom) = 1 AND NOT ST_Contains(geom, ST_Centroid(geom))) AS concave
        FROM shape
    `;
    if (!row) {
        throw new Error("Curve footprint missing after active-area lookup");
    }
    return row;
}

/**
 * Eine gebündelte exakte PostGIS-Messung je Satz; nie SQL je Fensterprobe.
 *
 * Gemessen wird das Kurvenstück (`kurvenstueck`): Die zwei Stücke, die `ausweichLauf` an einen Einzellauf setzt, tragen den
 * Ausweichraum und, wo die Fläche zu klein ist, den Namen; sie ragen oft hinaus, und eine Alternative fände dafür keinen besseren
 * Platz. Dieselbe Messung macht der Verifier (I5).
 */
export async function runShares(
    database: Queryable,
    footprint: CurveFootprint,
    runs: readonly DerivedRun[],
): Promise<number[]> {
    const lines = runs.map((run) => {
        const points = kurvenstueck(run.points, run.instanceCount);
        return `LINESTRING(${points.map((point) => `${point.x} ${point.y}`).join(",")})`;
    });
    const rows = await database<{ share: number | null }[]>`
        SELECT ST_Length(ST_Intersection(ST_GeomFromText(lines.wkt, 0), ST_GeomFromText(${footprint.wkt}, 0)))
               / NULLIF(ST_Length(ST_GeomFromText(lines.wkt, 0)), 0) AS share
        FROM unnest(${lines}::text[]) WITH ORDINALITY AS lines(wkt, position)
        ORDER BY position
    `;
    return rows.map((row) => Number(row.share ?? 0));
}

/** Begrenzte lokale Vorauswahl; angenommen wird der fertige Satz erst nach exakter PostGIS-Messung. */
export function mostlyInside(footprint: CurveFootprint, points: readonly Point[]): boolean {
    const samples = resample(points, 101);
    return (
        samples.length > 0 &&
        samples.filter((point) => pointInGeometry([point.x, point.y], footprint.geometry)).length > samples.length / 2
    );
}

/** Die Innenlage darf weder Kopien noch lesbare Buchstaben oder den ruhigen Verlauf kosten. */
export function preservesRunContracts(
    original: readonly DerivedRun[],
    candidate: readonly DerivedRun[],
    nameWidth: number,
): boolean {
    if (candidate.length === 0) {
        return false;
    }
    for (const zoom of new Set(original.map((run) => run.runMinZoom))) {
        const previous = original.filter((run) => run.runMinZoom === zoom);
        const next = candidate.filter((run) => run.runMinZoom === zoom);
        if (next.length < previous.length || next.some((run) => run.instanceCount !== next.length)) {
            return false;
        }
        // I7: Auch ein Einzellauf trägt seinen Namen; `ausweichLauf` verlängert ihn, wo die Kurve zu kurz ist (2026-10-11).
        const needed = nameWidth * mapUnitsPerPixel(zoom);
        if (
            next.some(
                (run) =>
                    pathLength(run.points) < needed * (1 - 1e-6) || maxDeviationAngle(run.points) > Math.PI / 6 + 1e-9,
            )
        ) {
            return false;
        }
    }
    return true;
}

/** Je Zoom ein vollständiger Satz. Ein fehlender zulässiger Satz bewahrt die gesamte alte Region. */
export function selectCoveredRunSets(
    original: readonly DerivedRun[],
    originalShares: readonly number[],
    alternatives: readonly { runs: readonly DerivedRun[]; shares: readonly number[] }[],
    nameWidth: number,
): DerivedRun[] | null {
    const chosen: DerivedRun[] = [];
    for (const zoom of new Set(original.map((run) => run.runMinZoom))) {
        const previous = original.filter((run) => run.runMinZoom === zoom);
        const sources = [{ runs: original, shares: originalShares }, ...alternatives];
        const fitting = sources.find((source) => {
            const atZoom = source.runs.filter((run) => run.runMinZoom === zoom);
            return (
                preservesRunContracts(previous, atZoom, nameWidth) &&
                source.runs.every((run, index) => run.runMinZoom !== zoom || (source.shares[index] ?? 0) > 0.5)
            );
        });
        if (!fitting) {
            return null;
        }
        chosen.push(...fitting.runs.filter((run) => run.runMinZoom === zoom));
    }
    const zooms = [...new Set(chosen.map((run) => run.runMinZoom))].sort((a, b) => a - b);
    for (let index = 1; index < zooms.length; index += 1) {
        const previousCount = chosen.filter((run) => run.runMinZoom === zooms[index - 1]).length;
        if (chosen.filter((run) => run.runMinZoom === zooms[index]).length < previousCount) {
            return null;
        }
    }
    return chosen;
}
