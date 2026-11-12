import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    TERRITORY_TARGET_MARGIN,
    legacyYear,
    type EditorTerritoryForm,
    type EditorTerritoryFormArea,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Lesepfad des Modus „Grenzen bearbeiten“ (WI-0209 Paket C1; Vertrag `EditorTerritoryForm` in `packages/shared/src/territory-editor.ts`),
 * nach dem Muster der Andockziele der Landschaft (`landscapes.ts`, `readEditorLandscapeTargets`): das bearbeitete Gebiet mit seinen
 * eckigen Flächen und Revisionen, seine Kette bis zur Wurzel, die Nachbarflächen mit gemeinsamen Ecken ganz und die Kanten der übrigen
 * Flächen im Kasten. Gelesen beim Start des Modus, nie während einer Geste.
 *
 * - **Abgeleitet → Baronie darunter** (EDIT-0003 T23 Frage 2): Mit einem Punkt und ohne eigene Fläche dort gilt der Nachfahr, dessen
 *   eigene Fläche den Punkt enthält, die kleinste zuerst. Liegt auch keine darunter, bleibt es beim verlangten Gebiet.
 * - **Anzeigejahr:** Eigene Flächen wie das Detail mit Legacys „aktueller Form“ (`legacyYear`); Nachbarn und Kanten nach ihrer
 *   Gültigkeit (ohne eigenen Beginn der des Gebiets, Legacys `??`; offen ist `null` oder 9999).
 * - **Nur die Flächen** (`nurFlaechen`, OPS-000075 „Unterpolygone löschen …“): Das Kartenmenü liest beim Rechtsklick nur die eigenen Flächen
 *   mit ihren Teilen, nie die Nachbarn und Kanten im Kasten (bei einem Reich einige tausend Strecken). Dasselbe Gebiet, dieselben Flächen,
 *   dieselbe Baronie unter dem Klickpunkt; `neighbors` und `edges` sind leer.
 */

const OFFEN = 9999;

type GeoJsonFlaeche =
    { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

/** GeoJSON-Ringe ohne den Schlusspunkt, je Polygon zuerst außen, dann die Löcher (wie `landscapes.ts`). */
function polygoneVon(g: GeoJsonFlaeche): EditorTerritoryFormArea["polygons"] {
    const polygone = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polygone.map((ringe) =>
        ringe.map((ring) => {
            const ecken = ring.map(([x, y]) => [x, y] as [number, number]);
            const [a, z] = [ecken[0], ecken[ecken.length - 1]];
            return a && z && ecken.length > 1 && a[0] === z[0] && a[1] === z[1] ? ecken.slice(0, -1) : ecken;
        }),
    );
}

interface GebietRow {
    id: string;
    public_id: string;
    name: string;
    short_name: string | null;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
}

export async function readEditorTerritoryForm(
    database: Queryable,
    publicId: string,
    at?: { x: number; y: number },
    mapDomainId = "aventuria",
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
    nurFlaechen = false,
): Promise<EditorTerritoryForm | undefined> {
    const gebiet = async (publicId: string): Promise<GebietRow | undefined> => {
        const [r] = await database<GebietRow[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.short_name, t.min_zoom, t.max_zoom, t.valid_from_bf
              FROM territory t
             WHERE t.public_id = ${publicId} AND t.is_active AND t.map_domain_id = ${mapDomainId}
        `;
        return r;
    };
    const verlangt = await gebiet(publicId);
    if (verlangt === undefined) return undefined;

    // Frage 2: Am Punkt zuerst das verlangte Gebiet selbst, sonst der Nachfahr mit der kleinsten Fläche dort.
    let ziel = verlangt;
    if (at !== undefined) {
        const [darunter] = await database<{ id: string; public_id: string }[]>`
            WITH RECURSIVE unten(id, pfad) AS (
                SELECT t.id, ARRAY[t.id] FROM territory t WHERE t.id = ${verlangt.id}::bigint
                UNION ALL
                SELECT k.id, u.pfad || k.id
                  FROM unten u JOIN territory k ON k.parent_id = u.id AND k.is_active AND k.id <> u.id
                 WHERE NOT k.id = ANY(u.pfad)
            )
            SELECT t.id::text AS id, t.public_id::text AS public_id
              FROM unten u
              JOIN territory t ON t.id = u.id
              JOIN territory_area a ON a.territory_id = t.id AND a.is_active
             WHERE (coalesce(a.valid_from_bf, t.valid_from_bf) IS NULL OR coalesce(a.valid_from_bf, t.valid_from_bf) <= ${yearBf})
               AND (a.valid_to_bf IS NULL OR a.valid_to_bf = ${OFFEN} OR a.valid_to_bf >= ${yearBf})
               AND ST_Intersects(a.geom, ST_SetSRID(ST_MakePoint(${at.x}, ${at.y}), 0))
             ORDER BY (t.id = ${verlangt.id}::bigint) DESC, ST_Area(a.geom), t.public_id
             LIMIT 1
        `;
        if (darunter !== undefined && darunter.id !== verlangt.id)
            ziel = (await gebiet(darunter.public_id)) ?? verlangt;
    }

    const parents = await database<{ public_id: string; name: string }[]>`
        WITH RECURSIVE kette(id, parent_id, tiefe, pfad) AS (
            SELECT t.id, t.parent_id, 0, ARRAY[t.id] FROM territory t WHERE t.id = ${ziel.id}::bigint
            UNION ALL
            SELECT p.id, p.parent_id, k.tiefe + 1, k.pfad || p.id
              FROM kette k JOIN territory p ON p.id = k.parent_id AND p.is_active
             WHERE NOT p.id = ANY(k.pfad)
        )
        SELECT t.public_id::text AS public_id, t.name FROM kette k JOIN territory t ON t.id = k.id WHERE k.tiefe > 0 ORDER BY k.tiefe
    `;
    const alle = await database<
        {
            id: string;
            public_id: string;
            revision: string;
            min_zoom: number | null;
            max_zoom: number | null;
            valid_from_bf: number | null;
            valid_to_bf: number | null;
            g: GeoJsonFlaeche;
        }[]
    >`
        SELECT a.id::text AS id, a.public_id::text AS public_id, a.revision::text AS revision, a.min_zoom, a.max_zoom,
               a.valid_from_bf, a.valid_to_bf, ST_AsGeoJSON(a.geom, 15)::json AS g
          FROM territory_area a
         WHERE a.territory_id = ${ziel.id}::bigint AND a.is_active
         ORDER BY a.valid_from_bf NULLS FIRST, a.public_id
    `;
    // Welche eigenen Flächen im Anzeigejahr gelten: dieselbe Rechnung wie das Detail und der Nachweis je Band.
    const jahr = legacyYear(
        {
            territories: [
                {
                    publicId: ziel.public_id,
                    name: ziel.name,
                    shortName: ziel.short_name ?? "",
                    parentPublicId: null,
                    minZoom: ziel.min_zoom,
                    maxZoom: ziel.max_zoom,
                    validFromBf: ziel.valid_from_bf,
                    validToBf: null,
                },
            ],
            geometries: alle.map((a) => ({
                publicId: a.public_id,
                territoryPublicId: ziel.public_id,
                minZoom: a.min_zoom,
                maxZoom: a.max_zoom,
                validFromBf: a.valid_from_bf,
                validToBf: a.valid_to_bf,
            })),
        },
        yearBf,
    );
    const gilt = new Set(jahr.geometries.map((g) => g.publicId));
    const eigene = alle.filter((a) => gilt.has(a.public_id));
    const kopf = {
        id: ziel.public_id,
        name: ziel.name,
        ...(ziel.id !== verlangt.id ? { requested: { id: verlangt.public_id, name: verlangt.name } } : {}),
        parents: parents.map((p) => ({ id: p.public_id, name: p.name })),
        margin: TERRITORY_TARGET_MARGIN,
    };
    if (eigene.length === 0) return { ...kopf, areas: [], neighbors: [], edges: [] };
    const flaechen = eigene.map((a) => ({ id: a.public_id, revision: Number(a.revision), polygons: polygoneVon(a.g) }));
    if (nurFlaechen) return { ...kopf, areas: flaechen, neighbors: [], edges: [] };

    const eigeneIds = eigene.map((a) => a.id);
    const [k] = await database<{ x0: number; y0: number; x1: number; y1: number }[]>`
        SELECT ST_XMin(e.b) AS x0, ST_YMin(e.b) AS y0, ST_XMax(e.b) AS x1, ST_YMax(e.b) AS y1
          FROM (SELECT ST_Extent(a.geom)::geometry AS b FROM territory_area a WHERE a.id = ANY(${eigeneIds}::bigint[])) e
    `;
    const m = TERRITORY_TARGET_MARGIN;
    const kasten = [k!.x0 - m, k!.y0 - m, k!.x1 + m, k!.y1 + m] as const;
    const neighbors = await database<
        { id: string; territory: string; name: string; revision: string; g: GeoJsonFlaeche }[]
    >`
        WITH meine AS (
            SELECT DISTINCT ST_X(d.geom) AS x, ST_Y(d.geom) AS y
              FROM territory_area a CROSS JOIN LATERAL ST_DumpPoints(a.geom) d
             WHERE a.id = ANY(${eigeneIds}::bigint[])
        ), kandidaten AS (
            SELECT a.id
              FROM territory_area a
              JOIN territory o ON o.id = a.territory_id AND o.is_active
             WHERE a.is_active AND a.territory_id <> ${ziel.id}::bigint AND a.map_domain_id = ${mapDomainId}
               AND (coalesce(a.valid_from_bf, o.valid_from_bf) IS NULL OR coalesce(a.valid_from_bf, o.valid_from_bf) <= ${yearBf})
               AND (a.valid_to_bf IS NULL OR a.valid_to_bf = ${OFFEN} OR a.valid_to_bf >= ${yearBf})
               AND a.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
               AND EXISTS (
                   SELECT 1 FROM ST_DumpPoints(a.geom) d JOIN meine m ON m.x = ST_X(d.geom) AND m.y = ST_Y(d.geom)
               )
        )
        SELECT a.public_id::text AS id, o.public_id::text AS territory, o.name, a.revision::text AS revision,
               ST_AsGeoJSON(a.geom, 15)::json AS g
          FROM kandidaten c JOIN territory_area a ON a.id = c.id JOIN territory o ON o.id = a.territory_id
         ORDER BY o.name, a.public_id
    `;
    const edges = await database<{ area_id: string; name: string; ax: number; ay: number; bx: number; by: number }[]>`
        SELECT a.public_id::text AS area_id, o.name,
               ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
               ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
          FROM territory_area a
          JOIN territory o ON o.id = a.territory_id AND o.is_active
         CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(a.geom)) s
         WHERE a.is_active AND a.territory_id <> ${ziel.id}::bigint AND a.map_domain_id = ${mapDomainId}
           AND (coalesce(a.valid_from_bf, o.valid_from_bf) IS NULL OR coalesce(a.valid_from_bf, o.valid_from_bf) <= ${yearBf})
               AND (a.valid_to_bf IS NULL OR a.valid_to_bf = ${OFFEN} OR a.valid_to_bf >= ${yearBf})
           AND a.public_id <> ALL(${neighbors.map((n) => n.id)}::uuid[])
           AND a.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
           AND s.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
         ORDER BY a.public_id, s.path
    `;
    return {
        ...kopf,
        areas: flaechen,
        neighbors: neighbors.map((n) => ({
            id: n.id,
            territory: n.territory,
            name: n.name,
            revision: Number(n.revision),
            polygons: polygoneVon(n.g),
        })),
        edges: edges.map((e) => ({ areaId: e.area_id, name: e.name, a: [e.ax, e.ay], b: [e.bx, e.by] })),
    };
}
