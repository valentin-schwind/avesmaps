import { AVENTURIA, DESIGN_CANON } from "@avesmaps3d/shared";
import { settleChecks } from "../../blocking-checks.ts";
import type { Database } from "../../database.ts";
import { DEM_MAX_ZOOM, DEM_TILE_SIZE } from "../dem-tiles.ts";
import { grid, SEA } from "../hydrology/grid.ts";
import { constraintLines } from "../domain/constraint-findings.ts";
import { lakeBodies } from "../domain/lake-bodies.ts";
import { loadDomainInputs } from "../domain/inputs.ts";
import { ignoredMarinePeaks } from "../domain/constraints.ts";
import { verifyDomainRaster } from "../domain/verify.ts";
import type { WaterArea } from "../hydrology/water.ts";
import { contourSet, displayHeightRevision } from "./bands.ts";
import { DISPLAY_HEIGHT_PARAMS, generateDisplayHeights } from "./generate.ts";
import { loadDisplayHeightInputs } from "./inputs.ts";
import { displayHeightState } from "./pointer.ts";
import { checkStepsAgainstRaster } from "./verify-steps.ts";

/**
 * `verify:display-heights` (WI-0055): Hält die veröffentlichte Revision, was die Anzeigehöhen versprechen?
 *
 * Es gibt keine Höhenkacheln mehr; geprüft wird deshalb das Feld, wie die Ableitung es aus den aktuellen
 * Eingaben rechnet, und dass die veröffentlichten Linien und Stufen genau daraus stammen (gleiche Revision).
 */

export interface DisplayHeightCheck {
    name: string;
    passed: boolean;
    detail: string;
    /** Die betroffenen Objekte in Klartext, wenn die Prüfung welche nennt. */
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

const SIZE = DEM_TILE_SIZE << DEM_MAX_ZOOM;
/** Rundungsluft beim Vergleich von Höhen (Schritt). */
const TOLERANCE = 0.01;
/** So viel Linie darf je Stück im Wasser liegen, ehe es zählt (E): Rundung am Ufer, nicht mehr. */
const WET_TOLERANCE = 0.001;

export function unevenDisplayLakes(
    field: Float32Array,
    classes: Uint8Array,
    n: number,
    water: readonly WaterArea[],
): number {
    return unevenDisplayLakeList(field, classes, n, water).length;
}

/** Die Seen, die nicht eben sind: ihre Nummer in der Reihenfolge der Wasserflächen und die Höhenspanne (für den Befund). */
export function unevenDisplayLakeList(
    field: Float32Array,
    classes: Uint8Array,
    n: number,
    water: readonly WaterArea[],
): { index: number; part: number; low: number; high: number }[] {
    const g = grid(n);
    const uneven: { index: number; part: number; low: number; high: number }[] = [];
    // Ein See ist ein zusammenhängendes Gewässer mit einem Spiegel (`lakeBodies`), nicht eine ganze Mehrfachfläche.
    for (const body of lakeBodies(g, water, classes)) {
        let low = Infinity;
        let high = -Infinity;
        for (const k of body.cells) {
            low = Math.min(low, field[k]!);
            high = Math.max(high, field[k]!);
        }
        if (high - low > TOLERANCE) uneven.push({ index: body.area, part: body.part, low, high });
    }
    return uneven;
}

export async function verifyDisplayHeights(
    database: Database,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<{ passed: boolean; checks: DisplayHeightCheck[] }> {
    const checks: DisplayHeightCheck[] = [];
    const push = (name: string, passed: boolean, detail: string, offenders: string[] = []): void => {
        checks.push({ name, passed, detail, ...(offenders.length > 0 ? { offenders } : {}) });
    };
    const [current] = await database<
        { revision: string; fingerprint: string; contours: number; band_pieces: number }[]
    >`
        SELECT revision, fingerprint, contours, band_pieces
        FROM terrain_display_height WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    if (!current) {
        push("aktuelle Revision", false, "keine Anzeigehöhen abgeleitet");
        return { passed: false, checks };
    }

    const inputs = await loadDisplayHeightInputs(database, mapDomainId, DISPLAY_HEIGHT_PARAMS);
    push(
        "Eingaben aktuell",
        current.fingerprint === inputs.fingerprint,
        current.fingerprint === inputs.fingerprint
            ? `Gelände ${inputs.demRevision}, Relief ${inputs.reliefRevision}`
            : "Domain-DEM, Mitgliedschaft oder Darstellungsregeln seit der Ableitung geändert",
    );
    // Was die Karte sieht: Ein veralteter Zeiger (404 `display_height_stale`) blendet Linien und Stufen aus, auch
    // wenn die Revision selbst stimmt (Stage 2026-10-04, `9a666c7`: 11 von 11 bestanden, die Karte leer).
    const pointer = await displayHeightState(database, mapDomainId);
    push(
        "Zeiger aktuell",
        pointer.kind === "current",
        pointer.kind === "none"
            ? "kein Zeiger"
            : `${pointer.kind === "current" ? "aktuell" : "veraltet"}, gebunden an Gelände ${pointer.demRevision}`,
    );
    const { field, classes } = generateDisplayHeights(inputs.input, SIZE);
    const set = contourSet(field, classes, SIZE);
    const revision = displayHeightRevision(set);
    push(
        "gleiche Revision",
        revision === current.revision,
        `gerechnet ${revision}, veröffentlicht ${current.revision}`,
    );

    let wetSea = 0;
    let belowZero = 0;
    for (let k = 0; k < field.length; k += 1) {
        if ((classes[k] as number) & SEA) {
            if (field[k] !== 0) wetSea += 1;
        } else if ((field[k] as number) < 0) {
            belowZero += 1;
        }
    }
    push(
        "Meer 0, Land nicht darunter",
        wetSea === 0 && belowZero === 0,
        `${String(wetSea)} Meereszellen ungleich 0, ${String(belowZero)} Landzellen unter 0`,
    );

    const lakes = lakeBodies(grid(SIZE), inputs.input.water, classes).length;
    const uneven = unevenDisplayLakeList(field, classes, SIZE, inputs.input.water);
    push(
        "Seen eben",
        uneven.length === 0,
        String(lakes - uneven.length) + " von " + String(lakes) + " eben",
        uneven.map(
            (lake) =>
                `See Nr. ${String(lake.index)}, Teil ${String(lake.part)}: Höhen ${String(lake.low)}..${String(lake.high)} Schritt`,
        ),
    );

    const source = inputs.input.domain.raster;
    let changed = 0;
    for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
            if (field[y * SIZE + x] !== source.samples[(SIZE - 1 - y) * SIZE + x]) changed += 1;
        }
    }
    push("Domain-Höhe unverändert", changed === 0, String(changed) + " abweichende Zellen");
    const domainInputs = await loadDomainInputs(database, mapDomainId);
    const constraints = verifyDomainRaster(source, domainInputs, ignoredMarinePeaks(domainInputs));
    push(
        "Domain-Constraints",
        constraints.errors.length === 0,
        JSON.stringify(constraints),
        constraintLines(constraints.errors, domainInputs),
    );

    // Linien und Stufen in der Datenbank: nur volle Hunderter, Stufe passt zur Höhe; jede Stufe vorhanden.
    // Dass jeder Rand einer Stufe geschlossen ist, prüft schon die Rechnung oben (`contourSet` bricht sonst ab).
    const [lines] = await database<{ total: number; wrong: number }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (
                   WHERE ele % 100 <> 0
                      OR level <> CASE WHEN ele % 1000 = 0 THEN 2 WHEN ele % 500 = 0 THEN 1 ELSE 0 END
               )::int AS wrong
        FROM terrain_contour WHERE revision = ${current.revision}
    `;
    const stufen = await database<{ step: number; pieces: number }[]>`
        SELECT step, count(*)::int AS pieces FROM terrain_height_band WHERE revision = ${current.revision}
        GROUP BY step ORDER BY step
    `;
    const erwartet = set.bands.filter((band) => band.step === 0 || band.rings.length > 0).map((band) => band.step);
    const vorhanden = stufen.map((row) => row.step);
    push(
        "Höhenlinien und Stufen",
        (lines?.total ?? 0) === current.contours &&
            (lines?.wrong ?? 1) === 0 &&
            JSON.stringify(vorhanden) === JSON.stringify(erwartet) &&
            vorhanden.length <= DESIGN_CANON.topography.heightSteps.length,
        `${String(lines?.total ?? 0)} Linien (${String(lines?.wrong ?? 0)} falsch), Stufen ${vorhanden.join(", ")} in ${String(current.band_pieces)} Stücken`,
    );

    // Keine Linie im Wasser: gemessen an derselben Form, die die Karte zeigt (`terrain_water_smooth`). Gesucht
    // über den Kachelindex (`render_geom`); ohne ihn liest jedes Wasserstück alle Linien (Minuten).
    const [nass] = await database<{ lines: number; length: number }[]>`
        WITH islands AS MATERIALIZED (
                    SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3)) AS geom
                    FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
                    WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
                        AND r.region_layer = 'topographie' AND r.region_type = 'insel'
                ), water AS MATERIALIZED (
            SELECT piece.geom, map_domain_to_render(${mapDomainId}, piece.geom) AS render_geom
            FROM (
                SELECT (ST_Dump(ST_Subdivide(CASE WHEN islands.geom IS NULL THEN ST_MakeValid(terrain_water_smooth(a.geom))
                        ELSE ST_Difference(ST_MakeValid(terrain_water_smooth(a.geom)), islands.geom) END, 256))).geom AS geom
                FROM region_area a
                JOIN region r ON r.id = a.region_id
                    CROSS JOIN islands
                WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
            ) piece
            WHERE ST_Dimension(piece.geom) = 2
        ), wet AS (
            SELECT c.id, ST_Length(ST_Intersection(c.geom, w.geom)) AS length
            FROM water w
            JOIN terrain_contour c ON c.render_geom && w.render_geom AND ST_Intersects(c.geom, w.geom)
            WHERE c.revision = ${current.revision}
        )
        SELECT count(DISTINCT id) FILTER (WHERE length > ${WET_TOLERANCE})::int AS lines, coalesce(sum(length), 0)::float8 AS length
        FROM wet
    `;
    push(
        "keine Linie im Wasser",
        (nass?.lines ?? 1) === 0,
        `${String(nass?.lines ?? 0)} Linien im See oder Meer (zusammen ${(nass?.length ?? 0).toFixed(3)} E)`,
    );
    // Stufen gegen das Raster (Befund Höhenstufen 2026-10-03): Stichprobe, Fläche je Stufe, Lücken in den Grenzen.
    await checkStepsAgainstRaster(database, mapDomainId, current.revision, field, classes, SIZE, set, push);
    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:display-heights", checks);
}
