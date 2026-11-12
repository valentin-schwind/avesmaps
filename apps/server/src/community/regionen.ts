import { AVENTURIA, type Bezeichnung, type VorgangDetail } from "@avesmaps3d/shared";
import { sonderrollenLesbar } from "../auth/sonderrollen.ts";
import type { Queryable } from "../database.ts";

type Bezug = NonNullable<VorgangDetail["bezug"]>;
type Lage = NonNullable<Bezug["lage"]>;

/**
 * Wer an der Stelle einer Meldung Ortskundiger oder Regionalkanzler ist (WI-0279 E3c): Ein Hinweis, keine Zuständigkeit. Rechte und
 * Glocke ändern sich dadurch nicht.
 *
 * Die Stelle ist die gemeldete Lage, sonst der Vorschlag, sonst das Objekt selbst. Ein Herrschaftsgebiet oder eine Kraftlinie hat keinen
 * einen Ort in einer Region; dort fehlt der Hinweis, ebenso solange die Tafel nicht lesbar ist: `[]` hieße sonst „niemand zugeteilt“,
 * und das stimmte nicht.
 */
export async function regionenAmBezug(
    sql: Queryable,
    environment: string,
    bezug: Bezug | null,
): Promise<NonNullable<VorgangDetail["regionen"]> | undefined> {
    if (bezug === null || !(await sonderrollenLesbar(sql))) return undefined;
    const stelle = bezug.lage ?? bezug.vorschlagLage ?? (await lageDesObjekts(sql, bezug));
    if (stelle === null) return undefined;
    // Punkt im Polygon rechnet PostGIS selbst: Die ungültigen Altflächen werfen hier nichts (`areas/area-lookup.ts`).
    const regionen = await sql<{ id: string; name: string }[]>`
        SELECT DISTINCT r.public_id::text AS id, r.name
          FROM region_area a
          JOIN region r ON r.id = a.region_id
         WHERE a.map_domain_id = ${AVENTURIA.mapDomain} AND a.is_active AND r.is_active AND r.region_layer = 'derographisch'
           AND ST_Covers(a.geom, ST_SetSRID(ST_MakePoint(${stelle.x}, ${stelle.y}), 0))
         ORDER BY r.name, id
    `;
    if (regionen.length === 0) return [];
    // Der Regionalkanzler ist die erste Anlaufstelle (E3), darum zuerst.
    const personen = await sql<
        { region: string; id: string; name: string; sonderrolle: string; bezeichnung: Bezeichnung | null }[]
    >`
        SELECT z.region_public_id::text AS region, p.id::text AS id, p.display_name AS name, z.sonderrolle, p.bezeichnung
          FROM avesmaps_auth.sonderrolle_zuteilung z
          JOIN avesmaps_auth.person p ON p.id = z.person_id AND p.status = 'active'
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = z.environment AND a.status = 'active'
         WHERE z.environment = ${environment} AND z.revoked_at IS NULL
           AND z.region_public_id = ANY(${regionen.map((region) => region.id)}::uuid[])
         ORDER BY z.sonderrolle = 'regionalkanzler' DESC, lower(p.display_name), p.id
    `;
    return regionen.map((region) => ({
        name: region.name,
        personen: personen
            .filter((zeile) => zeile.region === region.id)
            .map((zeile) => ({
                person: { id: zeile.id, name: zeile.name },
                sonderrolle: zeile.sonderrolle,
                bezeichnung: zeile.bezeichnung,
            })),
    }));
}

/** Ein Punkt des Objekts (auf seiner Fläche bzw. Linie); auch für die Regionen der Sonderrollen (`rollen.ts`). */
export async function lageDesObjekts(
    sql: Queryable,
    bezug: Pick<Bezug, "objektArt" | "objektId">,
): Promise<Lage | null> {
    const id = bezug.objektId;
    if (id === null) return null;
    const stelle = (tafel: "place" | "path" | "terrain_peak") => sql<Lage[]>`
        SELECT ST_X(p)::float8 AS x, ST_Y(p)::float8 AS y
          FROM (SELECT ST_PointOnSurface(geom) AS p FROM ${sql(tafel)} WHERE public_id = ${id}::uuid LIMIT 1) t
    `;
    switch (bezug.objektArt) {
        case "place":
            return (await stelle("place"))[0] ?? null;
        case "path":
            return (await stelle("path"))[0] ?? null;
        case "peak":
            return (await stelle("terrain_peak"))[0] ?? null;
        case "area": {
            const [flaeche] = await sql<Lage[]>`
                SELECT ST_X(p)::float8 AS x, ST_Y(p)::float8 AS y
                  FROM (SELECT ST_PointOnSurface(a.geom) AS p
                          FROM region_area a JOIN region r ON r.id = a.region_id
                         WHERE r.public_id = ${id}::uuid AND a.is_active
                         ORDER BY ST_Area(a.geom) DESC
                         LIMIT 1) t
            `;
            return flaeche ?? null;
        }
        default:
            return null;
    }
}
