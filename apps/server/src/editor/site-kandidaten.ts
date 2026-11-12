import type { EditorSiteCandidate, EditorSiteCandidates, EditorSiteSourceKind } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Kandidaten für „Innerorts hinzufügen“ an einem Ort (WI-0196, EDIT-0003 T33 (3)): was noch nirgends innerorts ist.
 *
 * - **Stätten** (`site`) ohne aktive Beziehung zu einem Ort. 🔴 Ein gespeichertes „keine Stadt“ eines MENSCHEN (`manual`, `editor`)
 *   hält eine Stätte heraus, eines Laufs (`wiki`, `gespeichert`) nicht (B2, wie `open` im Lesepfad der Stätten). Eine Stätte mit
 *   eigenem Kartenpunkt bekommt dessen Abstand.
 * - **Kartenpunkte**: aktive, nicht verborgene Gebäude und Stadtviertel derselben Kartendomäne ohne Stätte - die fügt erst das
 *   Hinzufügen an (`site_punkt_fuer_ort`, Migration 0139). Verborgene stehen auch in Legacys Liste nicht.
 *
 * Der Abstand in Meilen kommt aus der Kartendomäne (`map_domain.miles_per_unit`), nie aus einer Zahl im Code. Sortiert nach Abstand,
 * dann nach Name; ohne Lage zuletzt. `undefined`: Diesen Ort gibt es nicht (oder er steht nicht auf der Karte).
 */
interface Row {
    kind: "staette" | "kartenpunkt";
    id: string;
    name: string;
    type: string | null;
    site_class: string | null;
    source_kind: EditorSiteSourceKind | null;
    meilen: number | null;
}

export async function readSiteCandidates(
    database: Queryable,
    publicId: string,
): Promise<EditorSiteCandidates | undefined> {
    const [ort] = await database<{ id: string }[]>`
        SELECT id::text AS id FROM place WHERE public_id = ${publicId}::uuid AND is_active
    `;
    if (ort === undefined) return undefined;
    const rows = await database<Row[]>`
        WITH ort AS (
            SELECT p.id, p.geom, p.map_domain_id, d.miles_per_unit
              FROM place p
              JOIN map_domain d ON d.id = p.map_domain_id
             WHERE p.id = ${ort.id}::bigint
        )
        SELECT 'staette' AS kind, s.id::text AS id, s.name, s.site_type AS type, s.site_class,
               s.source_kind, ST_Distance(q.geom, ort.geom) * ort.miles_per_unit AS meilen
          FROM site s
          CROSS JOIN ort
          LEFT JOIN site_settlement ss ON ss.site_id = s.id AND ss.is_active
          LEFT JOIN place q ON s.source_kind = 'punkt' AND q.public_id::text = s.source_key AND q.is_active
                           AND q.map_domain_id = ort.map_domain_id
         WHERE s.is_active
           AND (ss.id IS NULL OR (ss.place_id IS NULL AND ss.origin NOT IN ('manual', 'editor')))
        UNION ALL
        SELECT 'kartenpunkt', q.public_id::text, q.name, NULLIF(btrim(q.place_kind), ''), q.subtype,
               NULL, ST_Distance(q.geom, ort.geom) * ort.miles_per_unit
          FROM place q
          CROSS JOIN ort
         WHERE q.is_active AND NOT q.is_hidden AND q.map_domain_id = ort.map_domain_id AND q.id <> ort.id
           AND q.subtype IN ('gebaeude', 'stadtviertel')
           AND NOT EXISTS (SELECT 1 FROM site s WHERE s.source_kind = 'punkt' AND s.source_key = q.public_id::text)
         ORDER BY meilen NULLS LAST, name, id
    `;
    return { candidates: rows.map(kandidatVon) };
}

function kandidatVon(row: Row): EditorSiteCandidate {
    return {
        kind: row.kind,
        id: row.id,
        name: row.name,
        ...(row.type ? { type: row.type } : {}),
        ...(row.site_class ? { siteClass: row.site_class } : {}),
        ...(row.source_kind ? { sourceKind: row.source_kind } : {}),
        // Auf eine Hundertstelmeile: genauer misst niemand eine Stadt aus.
        ...(row.meilen === null ? {} : { meilen: Math.round(Number(row.meilen) * 100) / 100 }),
    };
}
