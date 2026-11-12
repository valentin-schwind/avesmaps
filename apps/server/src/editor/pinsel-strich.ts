import type { PinselErgebnis, PinselStrich } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { geojsonAus, polygoneVon, type Punkt } from "./ring-form.ts";

/**
 * EIN Pinselstrich, gerechnet und nicht geschrieben (Werkzeug 6 der Derographie; Vertrag `PinselStrich`): die Rechnung, die die Landschaft
 * (`landscape-brush.ts`) und die Sprache (`sprachen/editor-flaechen.ts`, WI-0261 Stufe 2) teilen. Wem die Teilfläche gehört, prüft jede Art
 * selbst, bevor sie rechnet; hier steht nur die Rechnung.
 *
 * Wie Legacy (`map-features-ecosystem-brush.js`: Stempel vereinigen oder abziehen), aber exakt in PostGIS statt mit `polygon-clipping` im
 * Browser: Die Spur des Zeigers wird um den Radius gepuffert (`ST_Buffer`, rund an Enden und Ecken), dann mit der Teilfläche, wie sie im
 * Entwurf steht, vereinigt oder von ihr abgezogen. Was übrig bleibt, ist gültig (`ST_MakeValid`) und nur Fläche.
 *
 * - Ganz wegradieren geht nicht (Legacy: „Die Operation ergibt keine Fläche“ als Grenze des Strichs): 400, der Entwurf bleibt.
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

export async function rechneStrich(database: Queryable, strich: PinselStrich): Promise<PinselErgebnis> {
    const spur =
        strich.line.length === 1
            ? { type: "Point", coordinates: strich.line[0] }
            : { type: "LineString", coordinates: strich.line };
    const [r] = await database<{ ergebnis: string | null; flaeche: number | null }[]>`
        WITH a AS (
            SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(strich.polygons as Punkt[][][])}), 0)) AS g
        ), s AS (
            SELECT ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(spur)}), 0), ${strich.radius},
                             ${`quad_segs=${String(strich.quadSegs)}`}) AS g
        ), e AS (
            SELECT ST_CollectionExtract(
                       ST_MakeValid(CASE ${strich.mode}::text WHEN 'malen' THEN ST_Union(a.g, s.g) ELSE ST_Difference(a.g, s.g) END),
                       3
                   ) AS g
              FROM a, s
        )
        SELECT CASE WHEN ST_IsEmpty(e.g) THEN NULL ELSE ST_AsGeoJSON(e.g, 15) END AS ergebnis, ST_Area(e.g) AS flaeche FROM e
    `;
    if (r?.ergebnis == null || !((r.flaeche ?? 0) > 0))
        throw ungueltig("Eine Fläche ganz wegzuradieren geht nur über „Fläche entfernen …“.", { field: "line" });
    return {
        polygons: polygoneVon(r.ergebnis).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y]))),
    };
}
