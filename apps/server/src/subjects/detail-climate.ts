import { SUBJECT_LIMITS, renderZoomForBand, type SubjectDetail } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import type { SubjectIndex } from "./subject-index.ts";

/**
 * Das Subject „Klimaband“ (WI-0063 27.12, Paket „anklickbar“): ein Gegenstand NUR mit Kopf, wie in Legacy (`showEcosystemAreaInfopanel`: Name
 * und „Klimazonen“, keine Felder, keine Aktion). Er ist das Ziel des Objektlinks „Klimazone: Gemäßigte Zone“ im Panel; er trägt, was die
 * Karte schon kennt - den Namen aus `climate_zone_type` und das Ziel der Kamera -, sonst nichts: keine Quellen, keinen Kanon, keinen Kontext.
 *
 * Das Ziel ist dasselbe wie das der Suche (`search.ts`, Betreiberentscheidung 2026-09-23): die Mitte des LÄNGSTEN Stücks, in dem die
 * Mittelsenkrechte der Karte das Band schneidet. Ein Band reicht von Rand zu Rand, ein eigener Punkt steht nirgends; der Schwerpunkt taugt nicht
 * (bei vier der acht Bänder liegt er außerhalb).
 */

/** Wie weit man an ein Klimaband heranfährt: wie bei einem Klimatreffer der Suche (`zoomForKind`). */
const CLIMATE_ZOOM = renderZoomForBand(1);

interface ClimateRow {
    label: string;
    x: number;
    y: number;
}

export async function climateDetail(
    database: Database,
    index: SubjectIndex,
    band: string,
): Promise<SubjectDetail | null> {
    const [row] = await withStatementTimeout(
        database,
        SUBJECT_LIMITS.statementMs,
        (transaction) => transaction<ClimateRow[]>`
            SELECT t.label,
                   ST_X(ST_LineInterpolatePoint(stueck.geom, 0.5)) AS x,
                   ST_Y(ST_LineInterpolatePoint(stueck.geom, 0.5)) AS y
            FROM climate_zone_type t
            JOIN climate_band b ON b.type_key = t.type_key
            CROSS JOIN LATERAL ST_Dump(ST_Intersection(
                b.geom,
                ST_SetSRID(ST_MakeLine(
                    ST_MakePoint((ST_XMin(b.geom) + ST_XMax(b.geom)) / 2, ST_YMin(b.geom)),
                    ST_MakePoint((ST_XMin(b.geom) + ST_XMax(b.geom)) / 2, ST_YMax(b.geom))
                ), 0)
            )) AS stueck
            WHERE t.type_key = ${band} AND t.is_active
              -- Berührt die Senkrechte das Band nur in einem Punkt, ist das kein Stück.
              AND ST_GeometryType(stueck.geom) = 'ST_LineString'
            ORDER BY ST_Length(stueck.geom) DESC
            LIMIT 1
        `,
    );
    // Ein Band ohne Form steht nicht auf der Karte: Es gibt dann nichts zu zeigen.
    if (!row) return null;
    return {
        subject: { kind: "climate", band },
        revision: index.revision,
        title: row.label,
        subtitle: [{ part: "layer", key: "klima" }],
        target: { x: Number(row.x), y: Number(row.y), zoom: CLIMATE_ZOOM },
    };
}
