import type { Queryable } from "../database.ts";

/**
 * Die Dialekte einer Sprache (WI-0261 S5b, O1): abgeleitet, keine eigene Zuordnung. Die Infobox einer Sprache (`subjects/detail-sprache.ts`) und die Suche (`search/sprachen-index.ts`)
 * lesen sie hier, damit beide dieselbe Menge nennen.
 *
 * Ein Dialekt ist ein aktiver Sprachartikel des Wikis, der KEINER aktiven Sprache zugeordnet ist und eine Navigationsleiste der Sprachfamilie mit dem ersten Artikel der Sprache
 * teilt (`navigation`, etwa „Nav Sprachfamilie Garethi“). Begründung: Die Leisten fassen eine Familie zusammen; was in ihr steht und keine eigene Fläche hat, geht in der Gruppe der
 * Karte auf (O3: Horathi, Alberned, Brabaci → Garethi). Eine zugeordnete Sprache derselben Familie ist kein Dialekt, ebenso wenig eine Vorstufe, die der erste Artikel selbst nennt
 * (Bosparano ist Vorstufe des Garethi, nicht seine Mundart).
 */

/** Was die Ableitung vom ersten Artikel einer Sprache braucht. */
export interface DialektQuelle {
    /** `wiki_sprache_artikel.id` des ersten zugeordneten Artikels. */
    id: string;
    navigation: readonly string[];
    vorstufen: string | null;
}

/** Die Dialekte (siehe Kopf): Namen, nach dem Alphabet; ohne Navigationsleiste keine. */
export async function dialekteVon(tx: Queryable, erster: DialektQuelle): Promise<string[]> {
    if (erster.navigation.length === 0) return [];
    const zeilen = await tx<{ name: string }[]>`
        SELECT COALESCE(NULLIF(btrim(w.name), ''), w.titel) AS name
          FROM wiki_sprache_artikel w
         WHERE w.is_active AND w.id <> ${erster.id}::bigint
           AND w.navigation && ${[...erster.navigation]}::text[]
           AND NOT EXISTS (
               SELECT 1 FROM sprache_wiki z JOIN sprache s ON s.id = z.sprache_id AND s.is_active
                WHERE z.wiki_sprache_artikel_id = w.id AND z.is_active
           )
         ORDER BY lower(COALESCE(NULLIF(btrim(w.name), ''), w.titel)), w.id
    `;
    const vorstufen = (erster.vorstufen ?? "").toLocaleLowerCase("de");
    return zeilen
        .map((zeile) => zeile.name.trim())
        .filter((name) => name !== "" && !vorstufen.includes(name.toLocaleLowerCase("de")));
}
