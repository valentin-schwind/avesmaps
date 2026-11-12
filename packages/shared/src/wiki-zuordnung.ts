import { Type, type Static } from "@sinclair/typebox";

/**
 * Der Artikel, den ein Objekt im Editor trägt, und die Treffer der Artikelsuche (WI-0205; gemeinsamer Baustein
 * `apps/web/src/fenster/wiki-zuordnung.ts`, Kopf `wiki-zuordnung-schnittstelle.md`; abgestimmt mit dem Wiki-Feldbaustein WI-0225).
 *
 * - **`key`** ist die Identität des Artikels (der Wiki-Key wie in `wiki_key_assignment`); die Adresse kann sich mit einer Umbenennung
 *   ändern. Konflikt und Verlauf vergleichen über `key`.
 * - **`werte`** sind die Wiki-Werte des Artikels unter den Schlüsseln der Felder, die sie zeigen (Kraftlinie: `staerke`, `affinitaet`,
 *   `laenge`, `regionen`). Drei Fälle je Schlüssel: ein Wert = bekannt; `null` = das Wiki kennt keinen; der Schlüssel FEHLT = unbekannt.
 *   Darum sind die Schlüssel optional und nie mit `null` aufgefüllt.
 */

export const WikiArtikel = Type.Object(
    {
        key: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        name: Type.String(),
        werte: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Null()])),
    },
    { additionalProperties: false },
);
export type WikiArtikel = Static<typeof WikiArtikel>;

/** Ein Treffer der Artikelsuche: der Artikel und, wo der Editor es weiß, an welchem Objekt er schon hängt. */
export const WikiTreffer = Type.Object(
    {
        ...WikiArtikel.properties,
        /** Der Name des Objekts, an dem der Artikel schon hängt (Legacys „hängt an Linie X“); fehlt, wenn an keinem oder unbekannt. */
        belegt: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type WikiTreffer = Static<typeof WikiTreffer>;

/** Die Antwort einer Artikelsuche, die als Liste mit dem Leseweg reist (Kraftlinie: die rund zwei Dutzend Artikel des Abzugs). */
export const WikiTrefferListe = Type.Object({ articles: Type.Array(WikiTreffer) }, { additionalProperties: false });
export type WikiTrefferListe = Static<typeof WikiTrefferListe>;
