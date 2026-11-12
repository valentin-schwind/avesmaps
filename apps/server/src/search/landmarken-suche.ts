import { foldName, SEARCH_VORKOMMEN_SICHTBAR, type SearchLandmarkeSektion } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { gefaltet, likePattern, passtGefaltet } from "./like.ts";

/**
 * Die Sektion „Landmarken“ der Spotlight-Suche (WI-0271 L6): Punkte aus `terrain_peak`, deren Name zur Anfrage passt, jeder Art des Katalogs
 * (Berggipfel, Höhle, Quelle …). Gefaltet wie die Orte (`foldName`, OPS-000065).
 *
 * - Nur **aktive** Landmarken, die auf der Karte stehen (wie `terrain_peak_render`): Das Merkmal „nur Gelände“ formt nur das Gelände, „Auf der Karte anzeigen“ aus nimmt nur den Text und bleibt also auffindbar (WI-0271 §18). Eine verborgene findet nur, wer die Karte erkundet, wie einen verborgenen Ort (WI-0271 §17).
 * - Der genaue Name steht vorn, dann der kürzere, dann das Alphabet; die Kennung löst letzte Gleichstände.
 * - Höchstens `SEARCH_VORKOMMEN_SICHTBAR` Treffer, `total` zählt alle (eine Fensterfunktion statt eines zweiten Durchlaufs). Es sind wenige hundert Zeilen.
 */
export async function landmarkenSektion(
    database: Queryable,
    query: string,
    mapDomainId: string,
): Promise<SearchLandmarkeSektion | undefined> {
    const muster = likePattern(foldName(query));
    const zeilen = await database<
        { id: string; name: string; art: string; x: number | string; y: number | string; total: number | string }[]
    >`
        SELECT tp.public_id::text AS id, tp.name, tp.subtype AS art, ST_X(tp.geom) AS x, ST_Y(tp.geom) AS y, count(*) OVER () AS total
        FROM terrain_peak tp
        WHERE tp.is_active
          AND NOT 'nur_gelaende' = ANY (tp.merkmale)
          AND NOT 'verborgen' = ANY (tp.merkmale)
          AND tp.map_domain_id = ${mapDomainId}
          AND ${passtGefaltet(database, database`tp.name`, muster)}
        ORDER BY (lower(${gefaltet(database, database`btrim(tp.name)`)}) = ${foldName(query)}) DESC, length(tp.name), tp.name, tp.public_id
        LIMIT ${SEARCH_VORKOMMEN_SICHTBAR}
    `;
    const erste = zeilen[0];
    if (erste === undefined) return undefined;
    return {
        hits: zeilen.map((zeile) => ({
            id: zeile.id,
            name: zeile.name,
            art: zeile.art,
            x: Number(zeile.x),
            y: Number(zeile.y),
        })),
        total: Number(erste.total),
    };
}
