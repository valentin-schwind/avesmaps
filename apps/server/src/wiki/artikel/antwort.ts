/**
 * Die Antwort der MediaWiki-API auf EINE Seite (`action=query&prop=revisions&redirects=1`), wie sie der Vergleich eines Artikels (`jobs/wiki-artikel-job.ts`) und der Sync am Objekt
 * (`jobs/wiki-objekt-sync.ts`, Wiki-Box) lesen: die erste Seite und, was zur Weiterleitung gehört.
 */

export interface ApiSeiteRoh {
    title?: unknown;
    ns?: unknown;
    missing?: unknown;
    invalid?: unknown;
    revisions?: { revid?: unknown; timestamp?: unknown; slots?: { main?: { content?: unknown } } }[];
}

/** Die erste Seite der Antwort und was zur Weiterleitung gehört; `undefined`, wenn die Antwort keine Seite enthält. */
export function leseAntwort(antwort: Record<string, unknown>):
    | {
          seite: ApiSeiteRoh;
          weiterleitung: { von: string; nach: string } | null;
      }
    | undefined {
    const query = antwort["query"] as
        { pages?: ApiSeiteRoh[]; redirects?: { from?: unknown; to?: unknown }[] } | undefined;
    const seite = query?.pages?.[0];
    if (seite === undefined) return undefined;
    const umleitung = query?.redirects?.[0];
    const weiterleitung =
        typeof umleitung?.from === "string" && typeof umleitung.to === "string"
            ? { von: umleitung.from, nach: umleitung.to }
            : null;
    return { seite, weiterleitung };
}
