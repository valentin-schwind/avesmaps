import type { PowerlineEndKind, PowerlineNetwork } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";

/**
 * Alle aktiven Kraftlinien mit ihrer gezeichneten Bahn und der Art ihrer Enden (WI-0025 Stufe 2).
 *
 * 🔴 Die Bahn ist `drawn_geom`, die Linie, die auch die Kacheln zeichnen - nicht die gespeicherte
 * `geom` (Befund KL1). Sie steht in Kartenkoordinaten; die Karte rechnet sie selbst in ihre Projektion.
 *
 * 🪤 Die Art eines Endes kommt aus den Tabellen DIESER Datenbank, nicht aus dem Import: ein Ort,
 * ein Label (Legacy lässt Linien an Nodix-Labels enden, Owner 2026-07-28), ein Kraftlinienpunkt
 * (`nodix`, eigener Objekttyp; NICHT die Kreuzungstabelle des Wegenetzes), eine Landmarke (WI-0271 §17) oder nichts.
 * Ein Ende, dessen Ort stillgelegt ist, zählt als fehlend.
 *
 * ⭐ Geordnet nach `public_id`, wie jede Renderrelation (0016): gleiche Daten, gleiche Antwort.
 */
export async function readPowerlineNetwork(database: Database): Promise<PowerlineNetwork> {
    const rows = await database<
        {
            id: string;
            name: string;
            label_visible: boolean;
            curve: number | null;
            from_id: string;
            to_id: string;
            from_kind: PowerlineEndKind;
            to_kind: PowerlineEndKind;
            path: [number, number][];
        }[]
    >`
        WITH ende AS (
            SELECT p.public_id, e.seite,
                   CASE
                       WHEN EXISTS (SELECT 1 FROM place o WHERE o.public_id = e.knoten AND o.is_active) THEN 'place'
                       WHEN EXISTS (SELECT 1 FROM map_label l WHERE l.public_id = e.knoten AND l.is_active) THEN 'label'
                       WHEN EXISTS (SELECT 1 FROM nodix n WHERE n.public_id = e.knoten AND n.is_active) THEN 'nodix'
                       WHEN EXISTS (SELECT 1 FROM terrain_peak t WHERE t.public_id = e.knoten AND t.is_active) THEN 'landmark'
                       ELSE 'missing'
                   END AS art
            FROM powerline p
            CROSS JOIN LATERAL (VALUES ('von', p.from_public_id), ('nach', p.to_public_id)) AS e (seite, knoten)
            WHERE p.is_active
        )
        SELECT p.public_id::text AS id,
               p.name,
               p.label_visible,
               p.curve,
               p.from_public_id::text AS from_id,
               p.to_public_id::text AS to_id,
               von.art AS from_kind,
               nach.art AS to_kind,
               (ST_AsGeoJSON(p.drawn_geom, 4)::json -> 'coordinates') AS path
        FROM powerline p
        JOIN ende von ON von.public_id = p.public_id AND von.seite = 'von'
        JOIN ende nach ON nach.public_id = p.public_id AND nach.seite = 'nach'
        WHERE p.is_active
        ORDER BY p.public_id
    `;
    return {
        lines: rows.map((row) => ({
            id: row.id,
            name: row.name,
            labelVisible: row.label_visible,
            curve: row.curve,
            from: { id: row.from_id, kind: row.from_kind },
            to: { id: row.to_id, kind: row.to_kind },
            path: row.path,
        })),
    };
}
