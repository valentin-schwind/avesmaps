import { LITERATUR_FELDER } from "../../infobox/literatur.ts";
import { ortslistenSchreiber } from "./ortsliste.ts";
import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Literatur (WI-0253, Scheibe Literatur). Ein Objekt ist ein Werk der Spielliteratur (`adventure`), kein Kartenobjekt; sein Artikel ist ein Produkt-Artikel
 * (`{{Infobox Produkt}}`), gefunden über die gespeicherte Adresse (`adventure.wiki_url`). Geschrieben wird:
 *
 * - **Die Felder des Werks** (Titel, Werkart, Regeln, Genre, Komplexität für Meister und Spieler, Autoren, Reihe, F-Shop-Nummer), genau die Spalten, die Legacys
 *   Literatur-Abgleich aus der Infobox setzt (`AVESMAPS_GAME_LITERATURE_WIKI_FIELDS`). Wie in Legacy (`avesmapsGameLiteratureFieldPlan`) folgt ein Feld dem Wiki, solange es nicht
 *   als eigene Entscheidung vermerkt ist, und das nur, wo der Vermerk es belegt: Ein Wert mit dem Vermerk „wiki“ wird ersetzt, ein leeres Feld ohne Vermerk gefüllt
 *   (`fuelltLeereFelder`); ein Wert OHNE Vermerk ist unbelegt und bleibt ein Befund (`herkunft.ts`, anders als Legacy, das ihn überschrieb).
 * - **Der Vermerk „wiki“** für jedes Feld, in das die Übernahme einen Wert schreibt (`adventure_field_origin`, nur einfügen, nie ändern): Ein Werk hat keinen Wiki-Stand, der
 *   Vermerk ist der einzige Beleg dafür, dass der Wert dem Wiki folgt. Ein Vermerk `manual` wird nie berührt. Leert die Übernahme ein Feld oder nimmt die Rücknahme es zurück,
 *   bleibt der Vermerk stehen: Ein leeres Feld gehört mit oder ohne „wiki“ dem Wiki (`herkunft.ts`, Zeile 6 und 7).
 * - **Die Ortsliste** (`adventure_place`, Scheibe Ortslisten): über den Listen-Schreiber `ortsliste.ts`, Zeile für Zeile, nur Zeilen des Wikis.
 * - 🔴 **Nie** die Zuordnung (`wiki_url`, `wiki_key`), die Herkunft des Werks (`source_system`, `legacy_origin`), die Links, das Cover und die übrigen Felder.
 *   Ein Werk der Redaktion (`source_system = 'editor'`) fasst die Übernahme nicht an: Der Leser (`ladeLiteratur`) gibt jedes seiner Felder als eigene Entscheidung aus.
 *
 * Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie); die Operation hebt die Leser-Revision, das Infofenster liest das Werk neu.
 */

/** Feld → Name im Fachprotokoll (`MAP_AUDIT_FIELDS.work`, wie der Editor der Werke sie nennt). */
const AUDIT_NAMEN: Readonly<Record<string, string>> = {
    title: "title",
    product_type: "productType",
    edition: "edition",
    genre: "genre",
    complexity_gm: "complexityGm",
    complexity_pl: "complexityPl",
    authors: "authors",
    series: "series",
    fshop_code: "fshopCode",
};

/** Die Spalten, die nie leer werden dürfen (`adventure.title` und `product_type` sind NOT NULL). */
const PFLICHT: ReadonlySet<string> = new Set(["title", "product_type"]);

export const literaturSchreiber: Schreiber = {
    bereich: "literatur",
    protokollArt: "work",
    objektArt: "work",
    affectedArt: "work",
    eintragZiel: (id) => ({ workId: id }),
    zielSpalte: "work_public_id",
    wirksameSpalten: Object.fromEntries(LITERATUR_FELDER.map((feld) => [feld, feld])),
    schnappschussSpalten: {},
    auditNamen: AUDIT_NAMEN,
    fuelltLeereFelder: true,
    liste: ortslistenSchreiber,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        // Dieselbe Sperre wie der Editor der Werke (`work.update`: FOR UPDATE am Werk); ein stillgelegtes oder unterdrücktes Werk fehlt.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM adventure
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    // Ein Werk hat keinen Wiki-Stand: Es gibt nichts hinter ↺ zu schreiben.
    schnappschussIds: () => Promise.resolve(new Map()),

    pruefe(_tx, schritte) {
        const befunde: BefundSchritt[] = [];
        const bleibt: FeldSchritt[] = [];
        for (const schritt of schritte) {
            if (schritt.wirksam !== undefined && schritt.wirksam.nachher === null && PFLICHT.has(schritt.feld)) {
                befunde.push({
                    objektId: schritt.objekt.id,
                    objektArt: "work",
                    objektName: schritt.objekt.name,
                    feld: schritt.feld,
                    befund: "wert_unzulaessig",
                    grund: "Ein Werk braucht Titel und Werkart; das Wiki nennt keinen Wert",
                });
                continue;
            }
            bleibt.push(schritt);
        }
        return Promise.resolve({ schritte: bleibt, befunde });
    },

    async schreibeObjekt(tx, id, spalten) {
        const namen = Object.keys(spalten);
        // Eine Berührung ohne Spalte zählt die Revision trotzdem (`revision = revision` steht im Trigger), damit ein offener Entwurf am Werk 409 bekommt.
        const [zeile] =
            namen.length === 0
                ? await tx<{ id: string; revision: number }[]>`
                      UPDATE adventure SET revision = revision WHERE public_id = ${id}::uuid AND is_active
                      RETURNING id::text AS id, revision::int AS revision
                  `
                : await tx<{ id: string; revision: number }[]>`
                      UPDATE adventure SET ${tx(spalten as Record<string, string | null>, ...namen)}
                       WHERE public_id = ${id}::uuid AND is_active
                      RETURNING id::text AS id, revision::int AS revision
                  `;
        if (zeile === undefined) throw new Error(`Werk ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        // Der Vermerk „wiki“ für jedes Feld, das jetzt einen Wert aus dem Wiki trägt; ein vorhandener Vermerk (auch `manual`) bleibt.
        const belegt = namen.filter((name) => (spalten[name] ?? null) !== null);
        if (belegt.length > 0) {
            await tx`
                INSERT INTO adventure_field_origin (adventure_id, field, origin)
                SELECT ${zeile.id}::bigint, feld, 'wiki'
                  FROM unnest(${belegt}::text[]) AS feld
                 WHERE NOT EXISTS (
                           SELECT 1 FROM adventure_field_origin o WHERE o.adventure_id = ${zeile.id}::bigint AND o.field = feld
                       )
            `;
        }
        return zeile.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
