import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";
import { verwendungenSchreiber } from "./verwendungen.ts";

/**
 * Der Schreiber der Quellen (WI-0253, Scheibe Quellen). Ein Objekt ist eine Katalogquelle (`feature_source`); ihr Artikel ist die Produktseite, ihre Zeilen sind
 * Titel und Verwendungen. Geschrieben wird:
 *
 * - **Der Titel** (`feature_source.title`), wie ihn Legacy bei jedem Lauf nachzog (`refreshLabel`): Er folgt dem Wiki, solange die Quelle nicht der Redaktion gehört
 *   (`source_system = 'editor'`: Der Leser `ladeQuellen` gibt ihr den Vermerk `manual`). Die Quelle behält ihr `source_system`: Der Titel bleibt der des Wikis. Eine Quelle braucht einen
 *   Titel; das Wiki nennt nie keinen (`wert_unzulaessig`).
 * - **Die Verwendungen** (Art, Seiten, Notiz einer Verknüpfung des Wikis; neue Verknüpfungen; das Stilllegen einer, die der Artikel nicht mehr nennt; die Quelle selbst, wenn der Katalog sie nicht hat)
 *   über den Listen-Schreiber `verwendungen.ts` (WI-0253 §21).
 * - 🔴 **Nie** die Adresse und der Schlüssel einer bestehenden Quelle (die Adresse IST die Identität), ihre Art, „offiziell“, Lizenz, Namensnennung und ihr Korpus (ein Belegstellen-Korpus gibt sie
 *   allen seinen Quellen vor, WI-0254); gelöscht wird nichts. Eine Quelle, die der WikiSync selbst anlegte und still legte (`retired_origin = 'wikisync'`, die Rücknahme), gehört weiter zu seinen Quellen:
 *   Sie wird gesperrt, berührt und von der nächsten Nennung wieder belebt.
 *
 * Kein Wert geht in ein abgeleitetes Ergebnis der Karte ein (`leitetAb`: nie) und auch nicht in den Kanon der Träger (`verwendungen.ts`); die Operation hebt die Leser-Revision, das
 * Infofenster liest die Quelle neu. Die Revision der Quelle zählt der Trigger (ein offener Entwurf im Fenster „Inhalte bearbeiten“ bekommt 409).
 */
export const quelleSchreiber: Schreiber = {
    bereich: "quelle",
    protokollArt: "source",
    objektArt: "source",
    affectedArt: "source",
    eintragZiel: (id) => ({ sourceId: id }),
    zielSpalte: "source_public_id",
    wirksameSpalten: { title: "title" },
    schnappschussSpalten: {},
    liste: verwendungenSchreiber,
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        // Dieselbe Sperre wie der Editor der Quellen (`source.update`: FOR UPDATE an der Quelle); eine stillgelegte Quelle fehlt, außer der WikiSync legte sie still.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM feature_source
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND (is_active OR retired_origin = 'wikisync')
             ORDER BY public_id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    // Eine Quelle hat keinen Wiki-Stand: Es gibt nichts hinter ↺ zu schreiben.
    schnappschussIds: () => Promise.resolve(new Map()),

    pruefe(_tx, schritte) {
        const befunde: BefundSchritt[] = [];
        const bleibt: FeldSchritt[] = [];
        for (const schritt of schritte) {
            if (schritt.wirksam !== undefined && (schritt.wirksam.nachher ?? "").trim() === "") {
                befunde.push({
                    objektId: schritt.objekt.id,
                    objektArt: "source",
                    objektName: schritt.objekt.name,
                    feld: schritt.feld,
                    befund: "wert_unzulaessig",
                    grund: "Eine Quelle braucht einen Titel; das Wiki nennt keinen",
                });
                continue;
            }
            bleibt.push(schritt);
        }
        return Promise.resolve({ schritte: bleibt, befunde });
    },

    async schreibeObjekt(tx, id, spalten) {
        const namen = Object.keys(spalten);
        // Eine Berührung ohne Spalte (nur die Verwendungen änderten sich) zählt die Revision trotzdem (`revision = revision`; der Trigger macht daraus +1), damit ein offener Entwurf 409 bekommt.
        const [zeile] =
            namen.length === 0
                ? await tx<{ revision: number }[]>`
                      UPDATE feature_source SET revision = revision WHERE public_id = ${id}::uuid AND (is_active OR retired_origin = 'wikisync')
                      RETURNING revision::int AS revision
                  `
                : await tx<{ revision: number }[]>`
                      UPDATE feature_source SET ${tx(spalten as Record<string, string | null>, ...namen)}
                       WHERE public_id = ${id}::uuid AND is_active
                      RETURNING revision::int AS revision
                  `;
        if (zeile === undefined) throw new Error(`Quelle ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        return zeile.revision;
    },

    schreibeSchnappschuss: () => Promise.resolve(),
};
