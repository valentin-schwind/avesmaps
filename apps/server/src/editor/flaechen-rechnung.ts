import type { PendingQuery, Row } from "postgres";
import type { LandscapeBooleanOperation, LandscapePartsOperation } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Rechnungen der Werkzeuge an Flächen, die Landschaft (`landscape-parts.ts`, `landscape-split.ts`, `landscape-boolean.ts`) und Sprache
 * (`sprachen/editor-flaechen-werkzeuge.ts`, WI-0261 Stufe 3) teilen (EDIT-0003 G1: gemeinsam machen, nicht abschreiben). Hier steht nur die
 * Geometrie und ihre Prüfung; wem eine Teilfläche gehört, wer sie sperrt, was danach geschrieben und protokolliert wird, entscheidet jede Art
 * selbst. Die Rechnungen sind die der Derographie, unverändert (Legacy-Bezüge dort).
 *
 * - **Unterflächen** (`rechneTeile`): die Teile einer Fläche (`ST_Dump`, gezählt ab 0) vereinigen (`ST_UnaryUnion`), einen herauslösen oder
 *   löschen; die Quelle ist eine Abfrage mit genau einer Zeile und der Spalte `geom`.
 * - **Zerschneiden** (`schneide`): je Teil `ST_Split` an der Linie, wie sie gezeichnet ist; das größte Stück jedes geschnittenen Teils bleibt.
 * - **Mit anderer Fläche** (`verknuepfung`, `pruefeVerknuepfung`): der Ausdruck über `q.geom` und `z.geom` und die Plausibilität des Ergebnisses.
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** Eine Abfrage, die genau eine Zeile mit der Spalte `geom` liefert. */
export type FlaechenAbfrage = PendingQuery<Row[]>;

export interface TeileRechnung {
    /** Die Zahl der Teile vorher. */
    teile: number;
    /** Was bleibt (GeoJSON); `null`: nichts. */
    rest: string | null;
    rest_teile: number;
    /** Der gewählte Teil (GeoJSON) beim Herauslösen und Löschen. */
    stueck: string | null;
}

/**
 * „Unterflächen ›“: rechnet und prüft. Alle drei erst ab zwei Teilen (400); vereinigen ohne Berührung (die Zahl bleibt) ist 400, ebenso ein Teil, den es
 * nicht gibt, und ein Ergebnis ohne Fläche.
 */
export async function rechneTeile(
    sql: Queryable,
    quelle: FlaechenAbfrage,
    operation: LandscapePartsOperation,
    part: number | undefined,
): Promise<TeileRechnung & { rest: string }> {
    if (operation !== "vereinigen" && part === undefined)
        throw ungueltig("Welche Unterfläche? Bitte eine anklicken.", { field: "part" });
    // Der Teil zählt ab 0, `ST_Dump` ab 1. Beim Vereinigen gibt es keinen.
    const nummer = operation === "vereinigen" ? 0 : part! + 1;
    const [r] = await sql<TeileRechnung[]>`
        WITH a AS (${quelle}),
             d AS (SELECT (x).path[1] AS n, (x).geom AS g FROM (SELECT ST_Dump(ST_Multi(a.geom)) AS x FROM a) s),
             e AS (
                 SELECT CASE ${operation}::text
                            WHEN 'vereinigen' THEN ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion((SELECT geom FROM a))), 3)
                            ELSE (SELECT ST_Multi(ST_Collect(g ORDER BY n)) FROM d WHERE n <> ${nummer})
                        END AS rest,
                        (SELECT g FROM d WHERE n = ${nummer}) AS stueck
             )
        SELECT (SELECT count(*) FROM d)::int AS teile,
               CASE WHEN e.rest IS NULL OR ST_IsEmpty(e.rest) THEN NULL ELSE ST_AsGeoJSON(e.rest, 15) END AS rest,
               coalesce(ST_NumGeometries(e.rest), 0)::int AS rest_teile,
               CASE WHEN e.stueck IS NULL THEN NULL ELSE ST_AsGeoJSON(e.stueck, 15) END AS stueck
          FROM e
    `;
    if (r === undefined || r.teile < 2) throw ungueltig("Diese Fläche besteht nur aus einer Unterfläche.");
    if (operation === "vereinigen" && r.rest_teile === r.teile)
        throw ungueltig("Diese Unterflächen berühren einander nicht – es gibt nichts zu verschmelzen.");
    if (operation !== "vereinigen" && (r.stueck === null || part! >= r.teile))
        throw ungueltig("Diese Unterfläche gibt es nicht (mehr).", { field: "part" });
    if (r.rest === null) throw ungueltig("Es bliebe keine Fläche übrig.");
    return { ...r, rest: r.rest };
}

export interface Schnitt {
    /** Was bei der Quelle bleibt: von jedem geschnittenen Teil das größte Stück, dazu die ungeschnittenen (GeoJSON). */
    bleibt: string;
    /** Die übrigen Stücke (GeoJSON). */
    geht: string;
}

/** „Zerschneiden“: schneidet die Quelle an der Linie, wie sie ist; trennt sie nichts ganz ab, 400 (nichts ist geschrieben). */
export async function schneide(
    sql: Queryable,
    quelle: FlaechenAbfrage,
    linie: readonly (readonly [number, number])[],
): Promise<Schnitt> {
    const klinge = JSON.stringify({ type: "LineString", coordinates: linie });
    // Je Teil die Stücke des Schnitts; ein ungeschnittener Teil ist sein eigenes einziges Stück und bleibt.
    const [r] = await sql<{ bleibt: string | null; geht: string | null }[]>`
        WITH a AS (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(q.geom), 3)) AS geom FROM (${quelle}) q),
             b AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${klinge}), 0) AS klinge),
             d AS (SELECT (x).path[1] AS n, (x).geom AS g FROM (SELECT ST_Dump(a.geom) AS x FROM a) s),
             t AS (
                 SELECT d.n, (ST_Dump(ST_CollectionExtract(ST_Split(d.g, b.klinge), 3))).geom AS stueck FROM d, b
             ),
             r AS (
                 SELECT n, stueck,
                        row_number() OVER (PARTITION BY n ORDER BY ST_Area(stueck) DESC) AS rang
                   FROM t WHERE ST_Area(stueck) > 0
             )
        SELECT ST_AsGeoJSON(ST_Multi(ST_Collect(stueck ORDER BY n, rang) FILTER (WHERE rang = 1)), 15) AS bleibt,
               ST_AsGeoJSON(ST_Multi(ST_Collect(stueck ORDER BY n, rang) FILTER (WHERE rang > 1)), 15) AS geht
          FROM r
    `;
    if (r?.geht === null || r?.geht === undefined || r.bleibt === null)
        throw ungueltig("Die Schnittlinie trennt die Fläche nicht vollständig.", { field: "line" });
    return { bleibt: r.bleibt, geht: r.geht };
}

/** Die Rechnung einer Operation „Mit anderer Fläche“: Die „… behalten“-Fassungen rechnen wie ihr Original (Legacy `ecosystem-boolean.test.js`). */
export const verknuepfungsArt = (
    operation: LandscapeBooleanOperation,
): "vereinigen" | "ausschneiden" | "schnittmenge" =>
    operation === "vereinigen-behalten"
        ? "vereinigen"
        : operation === "ausschneiden-behalten"
          ? "ausschneiden"
          : operation;

/**
 * Der Ausdruck für die neue Form der Quelle aus `q.geom` (Quelle) und `z.geom` (die andere Teilfläche): ∪, Quelle ohne Ziel oder ∩, gültig und nur
 * Fläche. Die Art schreibt ihn in ihre Abfrage (`… AS geom FROM q, z`), wo `q` und `z` stehen.
 */
export function verknuepfung(sql: Queryable, operation: LandscapeBooleanOperation): FlaechenAbfrage {
    return sql`
        ST_CollectionExtract(
            ST_MakeValid(
                CASE ${verknuepfungsArt(operation)}::text
                    WHEN 'vereinigen' THEN ST_Union(q.geom, z.geom)
                    WHEN 'ausschneiden' THEN ST_Difference(q.geom, z.geom)
                    ELSE ST_Intersection(q.geom, z.geom)
                END
            ),
            3
        )
    `;
}

/**
 * Plausibel wie Legacy (`assertEcosystemBooleanPlausible`): Ein Ergebnis ohne Fläche ist 400; ein Abzug, der wächst, eine Schnittmenge größer als eine der
 * beiden, eine Vereinigung kleiner als die größere sind Rechenfehler, nie ein Ergebnis.
 */
export function pruefeVerknuepfung(
    operation: LandscapeBooleanOperation,
    flaechen: { ergebnis: string | null; quelle: number; ziel: number; neu: number },
): asserts flaechen is { ergebnis: string; quelle: number; ziel: number; neu: number } {
    const rechnung = verknuepfungsArt(operation);
    const epsilon = Math.max(0.01, (flaechen.quelle + flaechen.ziel) * 0.000001);
    if (flaechen.ergebnis === null || !(flaechen.neu > 0)) throw ungueltig("Die Operation ergibt keine Fläche.");
    if (rechnung === "ausschneiden" && flaechen.neu - flaechen.quelle > epsilon)
        throw ungueltig("Das Abzugs-Ergebnis ist größer als die Ausgangsfläche.");
    if (rechnung === "schnittmenge" && flaechen.neu - Math.min(flaechen.quelle, flaechen.ziel) > epsilon)
        throw ungueltig("Die Schnittmenge ist größer als eine der beiden Flächen.");
    if (rechnung === "vereinigen" && flaechen.neu + epsilon < Math.max(flaechen.quelle, flaechen.ziel))
        throw ungueltig("Das Verschmelzungs-Ergebnis ist kleiner als eine der Ausgangsflächen.");
}
