import { wikiLinkKey, type WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { gipfelSchreiber } from "../abgleich/uebernahme/gipfel.ts";
import {
    TREFFER_MAX,
    herkunftDerTafel,
    legeX2Still,
    schreibeX2,
    sucheMuster,
    titelOderAdresse,
    type Anschluss,
    type BoxObjekt,
} from "./anschluss.ts";

/**
 * Der Gipfel an der Wiki-Box (WI-0271 L4): jede Zeile von `terrain_peak`, also Berggipfel und Vulkan und seit WI-0271 alle übrigen Landmarkenarten (Höhle, Quelle …), mit ihrer Zuordnung
 * `terrain_peak_wiki_assignment` (eine Zeile je Gipfel) und dem Wiki-Stand `wiki_region_snapshot` (der Landschafts-Stand des Artikels, einer je Artikel: Das Wiki beschreibt Berge, Höhlen und
 * Vulkane mit `{{Infobox Region}}`). Dazu die Tafel X2 (`wiki_key_assignment`) mit der Art `region`, unter der Legacy und `ladeGipfel` die Gipfel führen (die Landschaft selbst heißt dort `landschaft`).
 *
 * - **Zuweisen:** Zustand `assigned`, Herkunft `editor`, Zeiger auf den Wiki-Stand. Die Art der Landmarke ändert die Zuordnung nie (der Artikel entscheidet nicht über die Art).
 * - **Entfernen:** Zustand `separated` („kein Artikel“, ohne Adresse und Zeiger; die Entscheidung des Editors, die der Import nie überschreibt). Die Höhe folgte dem Wiki, solange keine Hand sie gesetzt hat
 *   (`uebernahme/gipfel.ts`): Eine vorhandene Höhe behält ihren Wert und wird eine eigene (Vermerk „manual“ in `field_origin`, Art `peak`). Eine Landmarke ohne Gelände trägt keine Höhe (CHECK
 *   `terrain_peak_hoehe_nur_gelaende`), dort bleibt es bei der Zuordnung; ein Gipfel ohne Höhe bleibt ohne.
 * - **Suche:** alle aktiven Wiki-Stände der Landschaftstafel, wie bei der Landschaft. Welche Wiki-Arten zu welcher Landmarkenart gehören, regelt erst die Abbildung des WikiSync-Bereichs (WI-0271 L7); die
 *   Suche zeigt die Wiki-Art und die Region des Artikels, damit die Person wählt.
 * - 🔴 Die Zuordnung ändert sich hier nur auf Wunsch einer Person (Quelle `editor`); die Höhe schreibt allein der WikiSync (`gipfelSchreiber`), die Box nie.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

export const gipfelAnschluss: Anschluss = {
    art: "gipfel",
    schreiber: gipfelSchreiber,

    ...herkunftDerTafel({
        zuordnung: "terrain_peak_wiki_assignment",
        schluessel: "terrain_peak_id",
        traeger: "terrain_peak",
    }),

    async lies(db, id) {
        const [zeile] = await db<Zeile[]>`
            SELECT tp.public_id::text AS id, tp.name, tp.map_domain_id, a.assignment_state, a.wiki_url, (a.snapshot_id IS NOT NULL AND s.id IS NOT NULL) AS mit_stand,
                   s.wiki_key AS s_key, s.name AS s_name
              FROM terrain_peak tp
              LEFT JOIN terrain_peak_wiki_assignment a ON a.terrain_peak_id = tp.id AND a.is_active
              LEFT JOIN wiki_region_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE tp.public_id = ${id}::uuid AND tp.is_active
        `;
        if (zeile === undefined) return undefined;
        const url = text(zeile["wiki_url"]);
        const hatArtikel =
            (zeile["assignment_state"] === "assigned" || zeile["assignment_state"] === "address_only") && url !== null;
        const objekt: BoxObjekt = {
            art: "gipfel",
            id,
            name: String(zeile["name"]),
            mapDomainId: String(zeile["map_domain_id"]),
            ids: [id],
            artikel: hatArtikel
                ? {
                      key: text(zeile["s_key"]) ?? wikiLinkKey(url),
                      url,
                      name: text(zeile["s_name"]) ?? titelOderAdresse(url),
                  }
                : null,
            mitStand: zeile["mit_stand"] === true,
        };
        return objekt;
    },

    async suche(db, objekt, q) {
        const muster = sucheMuster(q);
        const zeilen = await db<Zeile[]>`
            SELECT s.wiki_key, s.wiki_url, coalesce(s.name, s.wiki_key) AS name, s.art, s.region_parent,
                   (SELECT min(tp.name) FROM terrain_peak_wiki_assignment a JOIN terrain_peak tp ON tp.id = a.terrain_peak_id
                     WHERE a.snapshot_id = s.id AND a.is_active AND tp.is_active AND tp.public_id <> ${objekt.id}::uuid) AS belegt
              FROM wiki_region_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR coalesce(s.name, '') ILIKE ${muster} ESCAPE '\\' OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(coalesce(s.name, s.wiki_key)), s.wiki_key
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const werte: Record<string, string> = {};
            // Die Art roh, mit dem Rest der Mehrwertigkeit hinter `|`: Die Oberfläche zeigt die erste.
            const art = text(zeile["art"]);
            if (art !== null) werte["art"] = art;
            const region = text(zeile["region_parent"]);
            if (region !== null) werte["region"] = region;
            const belegt = text(zeile["belegt"]);
            return {
                key: String(zeile["wiki_key"]),
                url: String(zeile["wiki_url"]),
                name: String(zeile["name"]),
                werte,
                ...(belegt === null ? {} : { belegt }),
            };
        });
    },

    async sperre(tx, objekt) {
        // Wie der Editor und der Schreiber der Übernahme (`FOR NO KEY UPDATE`): Ein gleichzeitiges Speichern im Fenster des Gipfels wartet und scheitert danach an der Revision.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM terrain_peak WHERE public_id = ANY(${objekt.ids}::uuid[]) AND is_active
             ORDER BY public_id FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ id: string; wiki_key: string; wiki_url: string; name: string | null }[]>`
            SELECT id::text AS id, wiki_key, wiki_url, name FROM wiki_region_snapshot WHERE wiki_key = ${key} AND is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        await tx`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
            SELECT id, ${stand.wiki_url}, ${stand.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE FROM terrain_peak WHERE public_id = ${objekt.id}::uuid
            ON CONFLICT (terrain_peak_id) DO UPDATE
               SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned', assignment_origin = 'editor',
                   source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
        `;
        await schreibeX2(tx, "region", objekt.ids, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
        return { key: stand.wiki_key, url: stand.wiki_url, name: stand.name ?? titelOderAdresse(stand.wiki_url) };
    },

    async entferne(tx, objekt) {
        // 1. Die Höhe folgte dem Wiki (Vermerk „wiki“ oder keiner): Sie behält ihren Wert und gehört danach der Redaktion. Eine Landmarke ohne Gelände und ein Gipfel ohne Höhe haben nichts zu behalten
        //    (ein leeres Feld zeigt auch ohne Artikel nichts; der Leser holt für die Höhe keinen Wiki-Wert nach).
        await tx`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            SELECT 'peak', tp.public_id, 'height', 'manual' FROM terrain_peak tp
             WHERE tp.public_id = ${objekt.id}::uuid AND tp.height_schritt IS NOT NULL
            ON CONFLICT (object_kind, object_id, field) DO UPDATE SET origin = 'manual', set_at = now() WHERE field_origin.origin <> 'manual'
        `;
        // 2. Die Zuordnung: „kein Artikel“, wie der Editor es entscheidet.
        await tx`
            UPDATE terrain_peak_wiki_assignment a
               SET assignment_state = 'separated', wiki_url = NULL, snapshot_id = NULL, assignment_origin = 'editor', source_system = 'avesmaps3d', updated_at = now()
              FROM terrain_peak tp
             WHERE tp.id = a.terrain_peak_id AND tp.public_id = ${objekt.id}::uuid AND a.is_active
        `;
        await legeX2Still(tx, "region", objekt.ids);
    },

    async beruehre(tx, objekt) {
        // Die Zuordnung liegt in einer eigenen Tafel: ein UPDATE ohne Wertänderung am Gipfel, damit der Trigger die Revision zählt (ein offener Entwurf im Fenster des Gipfels bekommt 409).
        const zeilen = await tx<{ id: string; revision: number }[]>`
            UPDATE terrain_peak SET name = name WHERE public_id = ${objekt.id}::uuid AND is_active RETURNING public_id::text AS id, revision::int AS revision
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
