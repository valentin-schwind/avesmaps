import { powerlineDrawnPath, type CurvePoint } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die gezeichnete Bahn der Kraftlinien in der Transaktion des Speicherns nachziehen (WI-0205 Paket K5; §3 Nr. 3; Claudio 2026-10-16:
 * „Ableitung in der Transaktion des Speicherns: ja“). Dieselbe Rechnung wie der Import (`migration/powerlines.ts`): von den beiden
 * Knoten aus mit dem Bogen des Abschnitts (`powerlineDrawnPath`); fehlt ein Knoten, von der gespeicherten Linie (`geom`), wie Legacy.
 *
 * - Gerufen von jeder Operation, die einen Knoten bewegt (`place.move`, später `nodix.move` und das Verschieben einer Beschriftung) oder
 *   einen Abschnitt umformt (K8). `drawn_geom` zählt keine Revision (Trigger 0143): Ein offener Entwurf an der Linie bleibt gültig.
 * - 🔴 Schutz gegen Sammelverschiebungen (Claudio): Mehr als `KRAFTLINIEN_JE_OPERATION` betroffene Abschnitte in einer Operation weist
 *   der Weg mit 400 `too_many_powerlines` ab (Claudio schlug 422 vor; 400 steht in jedem Antwortschema der Editorrouten), statt die
 *   Transaktion lang zu machen. Heute gibt es 174 Abschnitte insgesamt; die Grenze greift nur bei einem
 *   Fehler oder einem künftigen Massenwerkzeug.
 */
export const KRAFTLINIEN_JE_OPERATION = 200;

interface Zeile {
    id: string;
    curve: number | null;
    linie: string;
    ax: number | null;
    ay: number | null;
    bx: number | null;
    by: number | null;
}

/** Die Knotenlage über alle drei Arten von Knoten: Ort, Beschriftung, Kraftlinienpunkt (wie der Lesepfad). */
const KNOTEN_LAGE = `
    SELECT public_id, geom FROM place WHERE is_active
    UNION ALL SELECT public_id, geom FROM map_label WHERE is_active
    UNION ALL SELECT public_id, geom FROM nodix WHERE is_active
    UNION ALL SELECT public_id, geom FROM terrain_peak WHERE is_active`;

/**
 * Zieht die Bahn jedes aktiven Abschnitts nach, der an einem der Knoten endet (`knoten`: öffentliche Kennungen) oder selbst genannt ist
 * (`abschnitte`). Gibt zurück, wie viele Abschnitte neu gezeichnet wurden.
 */
export async function zieheKraftlinienNach(
    tx: Sql,
    auswahl: { readonly knoten?: readonly string[]; readonly abschnitte?: readonly string[] },
): Promise<number> {
    const knoten = [...(auswahl.knoten ?? [])];
    const abschnitte = [...(auswahl.abschnitte ?? [])];
    if (knoten.length === 0 && abschnitte.length === 0) return 0;
    const zeilen = await tx.unsafe<Zeile[]>(
        `WITH k AS (${KNOTEN_LAGE})
         SELECT p.public_id::text AS id, p.curve, ST_AsText(p.geom) AS linie,
                ST_X(a.geom) AS ax, ST_Y(a.geom) AS ay, ST_X(b.geom) AS bx, ST_Y(b.geom) AS by
           FROM powerline p
           LEFT JOIN k a ON a.public_id = p.from_public_id
           LEFT JOIN k b ON b.public_id = p.to_public_id
          WHERE p.is_active
            AND (p.from_public_id = ANY($1::uuid[]) OR p.to_public_id = ANY($1::uuid[]) OR p.public_id = ANY($2::uuid[]))
          ORDER BY p.public_id`,
        [knoten, abschnitte] as never[],
    );
    if (zeilen.length > KRAFTLINIEN_JE_OPERATION)
        throw new ApiError(
            400,
            "too_many_powerlines",
            `Diese Änderung beträfe ${String(zeilen.length)} Abschnitte von Kraftlinien; mehr als ${String(KRAFTLINIEN_JE_OPERATION)} in einem Schritt werden abgewiesen.`,
        );
    for (const zeile of zeilen) {
        const enden: CurvePoint[] =
            zeile.ax !== null && zeile.ay !== null && zeile.bx !== null && zeile.by !== null
                ? [
                      { x: zeile.ax, y: zeile.ay },
                      { x: zeile.bx, y: zeile.by },
                  ]
                : punkteAus(zeile.linie);
        const bahn = powerlineDrawnPath(enden, zeile.curve);
        if (bahn.length < 2) continue;
        await tx`
            UPDATE powerline
               SET drawn_geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: "LineString", coordinates: bahn.map((p) => [p.x, p.y]) })}), 0)
             WHERE public_id = ${zeile.id}::uuid
        `;
    }
    return zeilen.length;
}

/** Die Punkte einer gespeicherten Linie aus ihrem WKT (`LINESTRING(x y, …)`). */
function punkteAus(wkt: string): CurvePoint[] {
    const innen = /\(([^()]*)\)/.exec(wkt)?.[1] ?? "";
    return innen
        .split(",")
        .map((paar) => paar.trim().split(/\s+/).map(Number))
        .filter((xy) => xy.length >= 2 && Number.isFinite(xy[0]) && Number.isFinite(xy[1]))
        .map(([x, y]) => ({ x: x!, y: y! }));
}
