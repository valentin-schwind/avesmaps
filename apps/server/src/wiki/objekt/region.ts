import type { WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { regionSchreiber } from "../abgleich/uebernahme/region.ts";
import {
    TREFFER_MAX,
    legeX2Still,
    schreibeX2,
    sucheMuster,
    titelOderAdresse,
    type Anschluss,
    type BoxObjekt,
} from "./anschluss.ts";

/**
 * Die Landschaft an der Wiki-Box (WI-0253; Derographie): `region` mit der Zuordnung an der Zeile selbst (`wiki_url`, `wiki_region_key`) und dem Wiki-Stand `wiki_region_snapshot` (einer je Artikel, gelesen
 * über den Schlüssel). Dazu die Tafel X2 (Art `landschaft`). Die Kennung der Box ist die der Region; ihre Teilflächen und Beschriftungen hängen an ihr, nicht am Artikel.
 *
 * - **Zuweisen:** Adresse und Schlüssel an der Region.
 * - **Entfernen:** beide weg; der Vermerk „wiki“ am Namen (`field_origin`, Art `landscape`) wird „manual“. Die Wiki-Angaben der Landschaft (Einwohner, Sprache, Vegetation …) liest der Leser aus dem Wiki-Stand und
 *   zeigt sie ohne Artikel nicht mehr: Die Region hat dafür keine eigenen Spalten, an denen sie als Wert bleiben könnten.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

export const regionAnschluss: Anschluss = {
    art: "region",
    schreiber: regionSchreiber,

    async lies(db, id) {
        const [zeile] = await db<Zeile[]>`
            SELECT r.public_id::text AS id, r.name, r.map_domain_id, r.wiki_url, r.wiki_region_key, s.name AS s_name, (s.id IS NOT NULL) AS mit_stand
              FROM region r
              LEFT JOIN wiki_region_snapshot s ON s.wiki_key = r.wiki_region_key AND s.is_active
             WHERE r.public_id = ${id}::uuid
        `;
        if (zeile === undefined) return undefined;
        const url = text(zeile["wiki_url"]);
        const key = text(zeile["wiki_region_key"]);
        const objekt: BoxObjekt = {
            art: "region",
            id,
            name: String(zeile["name"]),
            mapDomainId: String(zeile["map_domain_id"]),
            ids: [id],
            artikel:
                url === null && key === null
                    ? null
                    : {
                          key: key ?? titelOderAdresse(url as string),
                          url:
                              url ??
                              `https://de.wiki-aventurica.de/wiki/${encodeURIComponent((key as string).replaceAll(" ", "_"))}`,
                          name: text(zeile["s_name"]) ?? (url === null ? (key as string) : titelOderAdresse(url)),
                      },
            mitStand: zeile["mit_stand"] === true,
        };
        return objekt;
    },

    async suche(db, objekt, q) {
        const muster = sucheMuster(q);
        const zeilen = await db<Zeile[]>`
            SELECT s.wiki_key, s.wiki_url, coalesce(s.name, s.wiki_key) AS name, s.art,
                   (SELECT min(r.name) FROM region r WHERE r.wiki_region_key = s.wiki_key AND r.is_active AND r.public_id <> ${objekt.id}::uuid) AS belegt
              FROM wiki_region_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR coalesce(s.name, '') ILIKE ${muster} ESCAPE '\\' OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(coalesce(s.name, s.wiki_key)), s.wiki_key
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const werte: Record<string, string> = {};
            const art = text(zeile["art"]);
            if (art !== null) werte["art"] = art;
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
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM region WHERE public_id = ANY(${objekt.ids}::uuid[])
             ORDER BY public_id FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ wiki_key: string; wiki_url: string; name: string | null }[]>`
            SELECT wiki_key, wiki_url, name FROM wiki_region_snapshot WHERE wiki_key = ${key} AND is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        await tx`UPDATE region SET wiki_url = ${stand.wiki_url}, wiki_region_key = ${stand.wiki_key} WHERE public_id = ${objekt.id}::uuid`;
        await schreibeX2(tx, "landschaft", objekt.ids, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
        return { key: stand.wiki_key, url: stand.wiki_url, name: stand.name ?? titelOderAdresse(stand.wiki_url) };
    },

    async entferne(tx, objekt) {
        await tx`
            UPDATE field_origin SET origin = 'manual', set_at = now()
             WHERE object_kind = 'landscape' AND object_id = ${objekt.id}::uuid AND origin = 'wiki'
        `;
        await tx`UPDATE region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ${objekt.id}::uuid`;
        await legeX2Still(tx, "landschaft", objekt.ids);
    },

    async beruehre(tx, objekt) {
        // Die Zuordnung steht an der Zeile selbst: Ihr UPDATE hat die Revision schon gezählt (einmal), hier wird sie nur gelesen.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM region WHERE public_id = ${objekt.id}::uuid
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
