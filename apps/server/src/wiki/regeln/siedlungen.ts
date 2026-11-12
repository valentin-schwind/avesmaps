import { WIKISYNC_LAGE_ORTSARTEN, type WikisyncRegelLageOrt } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { ortsSchluessel, type SiedlungsKatalog } from "./lage.ts";

/**
 * Die Siedlungen der Karte für die Lage zu einer Linie (WI-0254, S2): jede AKTIVE Siedlung (Metropole bis Dorf, `WIKISYNC_LAGE_ORTSARTEN`; kein Gebäude, kein Stadtviertel) mit Kennung, Name und Stelle,
 * nach dem Schlüssel ihres Namens (`ortsSchluessel`). Nur lesend. Ein Name mit mehr als einer Siedlung bleibt mehrdeutig im Katalog stehen: Die Ableitung liest dann KEINE Lage („nie raten“).
 */

type Zeile = Record<string, unknown>;

export async function ladeSiedlungen(db: Queryable): Promise<SiedlungsKatalog> {
    const zeilen = await db<Zeile[]>`
        SELECT p.public_id::text AS kennung, p.name,
               round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
          FROM place p
         WHERE p.is_active AND p.subtype = ANY(${[...WIKISYNC_LAGE_ORTSARTEN]}::text[]) AND p.geom IS NOT NULL
         ORDER BY p.id
    `;
    const katalog = new Map<string, WikisyncRegelLageOrt[]>();
    for (const zeile of zeilen) {
        const name = String(zeile["name"] ?? "").trim();
        const x = Number(zeile["x"]);
        const y = Number(zeile["y"]);
        if (name === "" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const schluessel = ortsSchluessel(name);
        katalog.set(schluessel, [
            ...(katalog.get(schluessel) ?? []),
            { kennung: String(zeile["kennung"]), name, x, y },
        ]);
    }
    return katalog;
}
