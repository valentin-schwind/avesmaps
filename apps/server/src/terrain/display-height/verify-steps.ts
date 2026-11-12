import { DESIGN_CANON } from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";
import { LAKE, MAP_EXTENT, SEA } from "../hydrology/grid.ts";
import type { ContourSet } from "./bands.ts";
import { MIN_PIECE_LENGTH } from "./derive.ts";

/**
 * Prüfungen der Höhenstufen gegen das Raster (Befund Höhenstufen 2026-10-03, „das ockergelb für 500 m fehlt beim
 * Finsterkamm“): Die Stufenflächen entstehen aus den Ringen der Linien; ein Ring, der unterwegs verloren geht, fiel
 * bisher nirgends auf, weil jede einzelne Rechnung für sich stimmte. Hier wird die FERTIGE Fläche in der Datenbank
 * gegen die Höhen des Rasters gehalten, an drei Stellen:
 *
 * - `Stufe gegen DEM-Höhe`: Stichprobe auf einem festen Gitter über die Landzellen, angezeigte Stufe gegen die Stufe,
 *   die die Höhe des Rasters verlangt. Eine Stufe daneben ist normal (Glättung der Linie, Rundung); zwei und mehr
 *   heißt, dass eine ganze Stufenfläche fehlt oder falsch ist.
 * - `Stufenflächen gegen Raster`: Fläche je Stufe gegen die Zahl der Zellen über der Schwelle.
 * - `Stufengrenzen im Inneren geschlossen`: Ein Linienende ohne Gegenstück, weder am Wasser (dort schneidet die
 *   Ableitung die Linien ab) noch an einer anderen Linie derselben Höhe, ist eine Lücke in der Grenze.
 *
 * Alle drei melden nur (Betreiberregel: nur von ihm definierte Prüfungen halten an, `blocking-checks.ts`).
 */

type Push = (name: string, passed: boolean, detail: string, offenders?: string[]) => void;

/** Abstand der Stichprobenpunkte in Zellen: bei 8k ein Punkt je 64 Zellen (8 E), 16 384 Punkte, davon das Land. */
export const SAMPLE_STRIDE = 64;
/** So viele Stichproben dürfen zwei oder mehr Stufen daneben liegen, ehe die Prüfung ausfällt (Anteil). */
const FAR_OFF_LIMIT = 0.002;
/** So viel Fläche einer Stufe darf vom Raster abweichen (Anteil); Glättung und Vereinfachung kosten Promille. */
const AREA_LIMIT = 0.03;
/** Ab dieser Fläche der Stufe (E²) gilt die Abweichung; kleine Stufen (Gipfel) streuen im Verhältnis stärker. */
const AREA_MIN = 500;
/**
 * Eine Lücke bis zu dieser Länge (E) entsteht gewollt: Die Ableitung lässt jedes Stück unter `MIN_PIECE_LENGTH` weg,
 * am Wasser und an einem Hals, an dem ein Ring sich selbst kreuzt; zwei hintereinander sind noch kein Fehler.
 */
const GAP_TOLERANCE = 3 * MIN_PIECE_LENGTH;
/** Wie viele Abweichler und Namen eine Meldung höchstens nennt. */
const MAX_LISTED = 15;

/** Die Stufe, die eine Höhe verlangt: die höchste, deren Schwelle sie übersteigt (die Fläche ist „höher als“). */
export function expectedStep(height: number, steps: readonly number[] = DESIGN_CANON.topography.heightSteps): number {
    let step = 0;
    for (let k = 1; k < steps.length; k += 1) if (height > (steps[k] as number)) step = k;
    return step;
}

export interface StepSample {
    x: number;
    y: number;
    height: number;
    expected: number;
}

/** Die Stichprobenpunkte: Landzellen auf einem festen Gitter, ihre Mitte und ihre Höhe. */
export function stepSamples(field: Float32Array, classes: Uint8Array, n: number): StepSample[] {
    const cell = MAP_EXTENT / n;
    const samples: StepSample[] = [];
    for (let j = SAMPLE_STRIDE / 2; j < n; j += SAMPLE_STRIDE) {
        for (let i = SAMPLE_STRIDE / 2; i < n; i += SAMPLE_STRIDE) {
            const k = j * n + i;
            if (((classes[k] as number) & (SEA | LAKE)) !== 0) continue;
            const height = field[k] as number;
            samples.push({
                x: (i + 0.5) * cell,
                y: MAP_EXTENT - (j + 0.5) * cell,
                height,
                expected: expectedStep(height),
            });
        }
    }
    return samples;
}

export interface StepComparison {
    samples: number;
    exact: number;
    oneOff: number;
    /** Zwei oder mehr Stufen daneben. */
    farOff: number;
    /** Davon zu niedrig angezeigt (die Fläche der höheren Stufe fehlt). */
    farLow: number;
}

export function compareSteps(samples: readonly StepSample[], shown: readonly number[]): StepComparison {
    const out: StepComparison = { samples: samples.length, exact: 0, oneOff: 0, farOff: 0, farLow: 0 };
    samples.forEach((sample, q) => {
        const diff = (shown[q] as number) - sample.expected;
        if (diff === 0) out.exact += 1;
        else if (Math.abs(diff) === 1) out.oneOff += 1;
        else {
            out.farOff += 1;
            if (diff < 0) out.farLow += 1;
        }
    });
    return out;
}

/** Die angezeigte Stufe je Punkt: die höchste Stufenfläche der aktuellen Revision, die ihn enthält (Index: Renderform). */
async function shownSteps(
    database: Database,
    mapDomainId: string,
    revision: string,
    samples: readonly StepSample[],
): Promise<number[]> {
    const shown: number[] = [];
    for (let start = 0; start < samples.length; start += 2000) {
        const part = samples.slice(start, start + 2000);
        const rows = await database<{ step: number }[]>`
            SELECT coalesce((
                SELECT max(b.step) FROM terrain_height_band b
                WHERE b.revision = ${revision}
                  AND b.render_geom && map_domain_to_render(${mapDomainId}, ST_SetSRID(ST_MakePoint(p.x, p.y), 0))
                  AND ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(p.x, p.y), 0))
            ), -1)::int AS step
            FROM unnest(${part.map((_, q) => q)}::int[], ${part.map((s) => s.x)}::float8[], ${part.map((s) => s.y)}::float8[])
                WITH ORDINALITY AS p(i, x, y, ord)
            ORDER BY p.ord
        `;
        for (const row of rows) shown.push(row.step);
    }
    return shown;
}

/** Die Gebirge, in denen Stichproben zwei oder mehr Stufen daneben liegen, mit der Zahl und der Zahl aller Proben dort. */
async function mountainsOff(
    database: Database,
    mapDomainId: string,
    samples: readonly StepSample[],
    farOff: readonly boolean[],
): Promise<string[]> {
    const rows = await database<{ name: string; total: number; far: number }[]>`
        WITH p AS (
            SELECT ST_SetSRID(ST_MakePoint(x, y), 0) AS geom, far = 1 AS far
            FROM unnest(${samples.map((s) => s.x)}::float8[], ${samples.map((s) => s.y)}::float8[], ${farOff.map((far) => (far ? 1 : 0))}::int[]) AS t(x, y, far)
        )
        SELECT r.name, count(*)::int AS total, count(*) FILTER (WHERE p.far)::int AS far
        FROM p
        JOIN region_area a ON a.map_domain_id = ${mapDomainId} AND a.is_active AND a.geom && p.geom AND ST_Intersects(a.geom, p.geom)
        JOIN region r ON r.id = a.region_id AND r.is_active AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        GROUP BY r.id, r.name
        HAVING count(*) FILTER (WHERE p.far) > 0
        ORDER BY far DESC, r.name
        LIMIT ${MAX_LISTED}
    `;
    return rows.map(
        (row) => `${row.name}: ${String(row.far)} von ${String(row.total)} Stichproben zwei oder mehr Stufen daneben`,
    );
}

export async function checkStepsAgainstRaster(
    database: Database,
    mapDomainId: string,
    revision: string,
    field: Float32Array,
    classes: Uint8Array,
    n: number,
    set: ContourSet,
    push: Push,
): Promise<void> {
    const samples = stepSamples(field, classes, n);
    const shown = await shownSteps(database, mapDomainId, revision, samples);
    const result = compareSteps(samples, shown);
    const farFlags = samples.map((sample, q) => Math.abs((shown[q] as number) - sample.expected) >= 2);
    const offenders = result.farOff > 0 ? await mountainsOff(database, mapDomainId, samples, farFlags) : [];
    push(
        "Stufe gegen DEM-Höhe",
        result.farOff <= Math.floor(result.samples * FAR_OFF_LIMIT),
        `${String(result.samples)} Stichproben (Landzellen, alle ${String(SAMPLE_STRIDE)} Zellen): ${String(result.exact)} gleich, ${String(result.oneOff)} eine Stufe daneben, ${String(result.farOff)} zwei oder mehr daneben (davon ${String(result.farLow)} zu niedrig)`,
        offenders,
    );

    // Fläche je Stufe gegen die Zahl der Zellen über der Schwelle. Zellen zählen wie die Ringe: darüber heißt `>`.
    const cell = MAP_EXTENT / n;
    const steps = DESIGN_CANON.topography.heightSteps;
    const above = new Float64Array(steps.length);
    for (let k = 0; k < field.length; k += 1) {
        const height = field[k] as number;
        for (let s = 1; s < steps.length; s += 1)
            if (height > (steps[s] as number)) above[s] = (above[s] as number) + 1;
    }
    const areas = await database<{ step: number; area: number }[]>`
        SELECT step, sum(ST_Area(geom))::float8 AS area FROM terrain_height_band WHERE revision = ${revision} GROUP BY step
    `;
    const areaOf = new Map(areas.map((row) => [row.step, row.area]));
    const lines: string[] = [];
    let areaOk = true;
    for (const band of set.bands) {
        if (band.step === 0) continue;
        const expected = (above[band.step] as number) * cell * cell;
        const actual = areaOf.get(band.step) ?? 0;
        const deviation = expected > 0 ? (actual - expected) / expected : 0;
        const ok = expected < AREA_MIN || Math.abs(deviation) <= AREA_LIMIT;
        if (!ok) areaOk = false;
        lines.push(
            `Stufe ${String(band.step)} (über ${String(band.threshold)}): ${actual.toFixed(0)} E² statt ${expected.toFixed(0)} E² nach dem Raster (${(deviation * 100).toFixed(1)} %)${ok ? "" : " ← weicht ab"}`,
        );
    }
    push(
        "Stufenflächen gegen Raster",
        areaOk,
        areaOk
            ? `jede Stufe innerhalb von ${String(AREA_LIMIT * 100)} % der Rasterfläche`
            : `mindestens eine Stufenfläche weicht um mehr als ${String(AREA_LIMIT * 100)} % von der Rasterfläche ab`,
        lines,
    );

    // Lose Enden im Inneren: Die Linien tragen höchstens am Wasser Enden (dort schneidet die Ableitung ab) und an
    // Kreuzungen eines Rings mit sich selbst (die Stücke teilen den Punkt). Alles andere ist eine Lücke.
    const thresholds = steps.filter((step) => step > 0);
    const loose = await database<{ id: string; ele: number; x: number; y: number }[]>`
        WITH islands AS MATERIALIZED (
            SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3)) AS geom
            FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
            WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
                AND r.region_layer = 'topographie' AND r.region_type = 'insel'
        ), water AS MATERIALIZED (
            SELECT piece.geom
            FROM (
                SELECT (ST_Dump(ST_Subdivide(CASE WHEN islands.geom IS NULL THEN ST_MakeValid(terrain_water_smooth(a.geom))
                        ELSE ST_Difference(ST_MakeValid(terrain_water_smooth(a.geom)), islands.geom) END, 256))).geom AS geom
                FROM region_area a
                JOIN region r ON r.id = a.region_id
                CROSS JOIN islands
                WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
            ) piece
            WHERE ST_Dimension(piece.geom) = 2
        ), ends AS MATERIALIZED (
            SELECT c.id, c.ele, p.pt
            FROM terrain_contour c
            CROSS JOIN LATERAL (VALUES (ST_StartPoint(c.geom)), (ST_EndPoint(c.geom))) AS p(pt)
            WHERE c.revision = ${revision} AND c.ele = ANY(${thresholds}::int[]) AND NOT ST_IsClosed(c.geom)
        ), unjoined AS MATERIALIZED (
            SELECT e.* FROM ends e
            WHERE NOT EXISTS (
                SELECT 1 FROM terrain_contour o
                WHERE o.revision = ${revision} AND o.ele = e.ele AND o.id <> e.id
                  AND o.render_geom && map_domain_to_render(${mapDomainId}, ST_Expand(e.pt, ${GAP_TOLERANCE}))
                  AND ST_DWithin(o.geom, e.pt, ${GAP_TOLERANCE})
            )
        )
        SELECT u.id::text AS id, u.ele, ST_X(u.pt) AS x, ST_Y(u.pt) AS y
        FROM unjoined u
        WHERE NOT EXISTS (
            SELECT 1 FROM water w WHERE w.geom && ST_Expand(u.pt, ${GAP_TOLERANCE}) AND ST_DWithin(w.geom, u.pt, ${GAP_TOLERANCE})
        )
        ORDER BY u.ele, u.id
    `;
    push(
        "Stufengrenzen im Inneren geschlossen",
        loose.length === 0,
        `${String(loose.length)} Linienenden auf Stufengrenzen ohne Gegenstück (weder am Wasser noch an einer Linie derselben Höhe, je innerhalb von ${String(GAP_TOLERANCE)} E)`,
        loose
            .slice(0, MAX_LISTED)
            .map(
                (row) => `Höhe ${String(row.ele)}: Linie ${row.id} endet bei ${row.x.toFixed(2)} / ${row.y.toFixed(2)}`,
            ),
    );
}
