import type { Queryable } from "../../database.ts";
import type { Zuweisung } from "./vergleich.ts";

/**
 * Die gespeicherten Wiki-Zuweisungen (`wiki_key_assignment`, Legacy-Export X2), nur die aktiven und nur lesend. Es kommt keine Kennung des
 * Kartenobjekts und kein Key heraus: der Vergleich braucht Art, Adresse, Titel und Namensraum.
 */
export async function ladeZuweisungen(database: Queryable): Promise<Zuweisung[]> {
    const zeilen = await database<
        { art: string; url: string | null; titel: string | null; ns: number | null; weiterleitung: boolean }[]
    >`
        SELECT legacy_art AS art, wiki_url AS url, wiki_title AS titel, ns, is_redirect AS weiterleitung
        FROM wiki_key_assignment
        WHERE is_active
    `;
    return zeilen.map((zeile) => ({
        art: zeile.art,
        wikiUrl: zeile.url,
        wikiTitel: zeile.titel,
        ns: zeile.ns,
        istWeiterleitung: zeile.weiterleitung,
    }));
}
