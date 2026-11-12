import type { WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { gebietSchreiber } from "../abgleich/uebernahme/gebiet.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
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
 * Das Herrschaftsgebiet an der Wiki-Box (WI-0253): `territory` mit der Zuordnung an der Zeile selbst (`wiki_key` mit `wiki:` davor, `wiki_url`) und dem Wiki-Stand `wiki_territory_snapshot` (einer je Artikel,
 * gelesen über den Schlüssel; er trägt weder Adresse noch Titel, beides folgt aus dem Schlüssel). Dazu die Tafel X2 (Art `gebiet`).
 *
 * - **Zuweisen:** Schlüssel und Adresse am Gebiet. Die Adresse eines Artikels, an dem schon ein Gebiet hängt, ist dessen gespeicherte; sonst folgt sie aus dem Titel (`https://de.wiki-aventurica.de/wiki/<Titel>`).
 * - **Entfernen:** Schlüssel und Adresse weg. Die Detailfelder stehen in `territory_detail` selbst (Wert und Herkunft je Feld): Ein Wert mit der Herkunft `wiki` wird ein eigener (`override`), mehr braucht es nicht,
 *   denn der Leser zeigt nur, was dort steht.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

const WIKI_ADRESSE = "https://de.wiki-aventurica.de/wiki/";
const titelAusSchluessel = (key: string): string => (key.startsWith("wiki:") ? key.slice("wiki:".length) : key);
const adresseAusSchluessel = (key: string): string =>
    `${WIKI_ADRESSE}${encodeURIComponent(titelAusSchluessel(key).replaceAll(" ", "_"))}`;

export const gebietAnschluss: Anschluss = {
    art: "gebiet",
    schreiber: gebietSchreiber,

    async lies(db, id) {
        const [zeile] = await db<Zeile[]>`
            SELECT t.public_id::text AS id, t.name, t.map_domain_id, t.wiki_key, t.wiki_url, (s.id IS NOT NULL) AS mit_stand
              FROM territory t
              LEFT JOIN wiki_territory_snapshot s ON s.wiki_key = t.wiki_key AND s.is_active
             WHERE t.public_id = ${id}::uuid
        `;
        if (zeile === undefined) return undefined;
        const key = text(zeile["wiki_key"]);
        const url = text(zeile["wiki_url"]) ?? (key === null ? null : adresseAusSchluessel(key));
        const objekt: BoxObjekt = {
            art: "gebiet",
            id,
            name: String(zeile["name"]),
            mapDomainId: String(zeile["map_domain_id"]),
            ids: [id],
            artikel:
                key === null && text(zeile["wiki_url"]) === null
                    ? null
                    : {
                          key: key ?? titelOderAdresse(url as string),
                          url: url as string,
                          name:
                              titelAusWikiAdresse(url as string) ??
                              (key === null ? (url as string) : titelAusSchluessel(key)),
                      },
            mitStand: zeile["mit_stand"] === true,
        };
        return objekt;
    },

    async suche(db, objekt, q) {
        const muster = sucheMuster(q);
        const zeilen = await db<Zeile[]>`
            SELECT s.wiki_key, s.form_of_government, s.continent,
                   (SELECT min(t.wiki_url) FROM territory t WHERE t.wiki_key = s.wiki_key AND t.wiki_url IS NOT NULL) AS wiki_url,
                   (SELECT min(t.name) FROM territory t WHERE t.wiki_key = s.wiki_key AND t.is_active AND t.public_id <> ${objekt.id}::uuid) AS belegt
              FROM wiki_territory_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(s.wiki_key)
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const key = String(zeile["wiki_key"]);
            const werte: Record<string, string> = {};
            const form = text(zeile["form_of_government"]);
            if (form !== null) werte["form"] = form;
            const kontinent = text(zeile["continent"]);
            if (kontinent !== null) werte["kontinent"] = kontinent;
            const belegt = text(zeile["belegt"]);
            return {
                key,
                url: text(zeile["wiki_url"]) ?? adresseAusSchluessel(key),
                name: titelAusWikiAdresse(text(zeile["wiki_url"])) ?? titelAusSchluessel(key),
                werte,
                ...(belegt === null ? {} : { belegt }),
            };
        });
    },

    async sperre(tx, objekt) {
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM territory WHERE public_id = ANY(${objekt.ids}::uuid[])
             ORDER BY public_id FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ wiki_key: string; wiki_url: string | null }[]>`
            SELECT s.wiki_key, (SELECT min(t.wiki_url) FROM territory t WHERE t.wiki_key = s.wiki_key AND t.wiki_url IS NOT NULL) AS wiki_url
              FROM wiki_territory_snapshot s WHERE s.wiki_key = ${key} AND s.is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        const url = stand.wiki_url ?? adresseAusSchluessel(stand.wiki_key);
        const name = titelAusWikiAdresse(url) ?? titelAusSchluessel(stand.wiki_key);
        await tx`UPDATE territory SET wiki_key = ${stand.wiki_key}, wiki_url = ${url} WHERE public_id = ${objekt.id}::uuid`;
        await schreibeX2(tx, "gebiet", objekt.ids, { key: stand.wiki_key, url, name });
        return { key: stand.wiki_key, url, name };
    },

    async entferne(tx, objekt) {
        // Ein Wert, der dem Wiki folgte, wird ein eigener (`override`, die Herkunft, die der Editor für „eigen“ schreibt).
        await tx`
            UPDATE territory_detail_field_origin o SET origin = 'override'
              FROM territory_detail d JOIN territory t ON t.id = d.territory_id
             WHERE o.territory_detail_id = d.id AND t.public_id = ${objekt.id}::uuid AND o.origin = 'wiki'
        `;
        await tx`UPDATE territory SET wiki_key = NULL, wiki_url = NULL WHERE public_id = ${objekt.id}::uuid`;
        await legeX2Still(tx, "gebiet", objekt.ids);
    },

    async beruehre(tx, objekt) {
        // Die Zuordnung steht an der Zeile selbst: Ihr UPDATE hat die Revision schon gezählt (einmal), hier wird sie nur gelesen.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM territory WHERE public_id = ${objekt.id}::uuid
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
