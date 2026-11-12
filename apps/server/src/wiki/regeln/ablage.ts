import type { Queryable } from "../../database.ts";
import type { RegelSammler } from "./vorschlag.ts";

/**
 * Das Protokoll der Ableitung der Regelvorschläge (WI-0253 Scheibe Regelvorschläge, §24, Migration 0248): schreiben, in derselben Transaktion wie der Lauf der Vorschau (`abgleich/ablage.ts`,
 * `schreibeLauf`), als Jobs-Rolle. Keine Fachtafel: Die Ableitung schreibt nirgends hin, wo eine Karte oder ein Eintrag steht; ein Vorschlag ist ein Protokoll, bis jemand ihn auswählt.
 */

const VORSCHLAEGE_JE_ANWEISUNG = 250;
const WOERTER_JE_ANWEISUNG = 1_000;
/** Ein Wort der Tafel ist höchstens so lang; ein längerer Rest ist kein Begriff. */
const WORT_MAX = 40;

/** Schreibt Kopf, Vorschläge und Wörter der Ableitung zu einem Lauf. */
export async function schreibeRegeln(
    tx: Queryable,
    laufId: number,
    sammler: RegelSammler,
    begriffeRevision: number | null,
): Promise<void> {
    await tx`
        INSERT INTO wikisync_regel_lauf (lauf_id, begriffe_revision, zahlen)
        VALUES (${laufId}, ${begriffeRevision}, ${tx.json(sammler.zahlen as never)})
    `;
    const vorschlaege = sammler.vorschlaege.map((vorschlag, position) => ({
        lauf_id: laufId,
        position,
        public_id: vorschlag.eintragId,
        eintrag_name: vorschlag.name.slice(0, 300),
        art: vorschlag.art,
        artikel: vorschlag.artikel === null ? null : vorschlag.artikel.slice(0, 500),
        typ: vorschlag.typ,
        status: vorschlag.status,
        wartet: vorschlag.wartet,
        vorgewaehlt: vorschlag.vorgewaehlt,
        waehlbar: vorschlag.waehlbar,
        sperre: vorschlag.sperre,
        suchtext: vorschlag.suchtext.slice(0, 4_000),
        payload: { original: vorschlag.original, regeln: vorschlag.regeln },
    }));
    for (let ab = 0; ab < vorschlaege.length; ab += VORSCHLAEGE_JE_ANWEISUNG) {
        const stueck = vorschlaege.slice(ab, ab + VORSCHLAEGE_JE_ANWEISUNG);
        await tx`
            INSERT INTO wikisync_regel_vorschlag
                (lauf_id, position, lore_entry_id, eintrag_name, art, artikel, typ, status, wartet, vorgewaehlt, waehlbar, sperre, suchtext, payload)
            SELECT x.lauf_id, x.position, e.id, x.eintrag_name, x.art, x.artikel, x.typ, x.status, x.wartet, x.vorgewaehlt, x.waehlbar, x.sperre, x.suchtext, x.payload
              FROM jsonb_to_recordset(${tx.json(stueck as never)}) AS x(
                       lauf_id bigint, position integer, public_id uuid, eintrag_name text, art text, artikel text, typ text, status text, wartet boolean,
                       vorgewaehlt boolean, waehlbar boolean, sperre text, suchtext text, payload jsonb)
              JOIN lore_entry e ON e.public_id = x.public_id
        `;
    }
    const woerter = [...sammler.woerter]
        .filter(([wort]) => wort.length >= 1 && wort.length <= WORT_MAX)
        .map(([wort, w]) => ({ lauf_id: laufId, wort, anzahl: w.n, in_tafel: w.tafel }));
    for (let ab = 0; ab < woerter.length; ab += WOERTER_JE_ANWEISUNG) {
        const stueck = woerter.slice(ab, ab + WOERTER_JE_ANWEISUNG);
        await tx`
            INSERT INTO wikisync_regel_wort (lauf_id, wort, anzahl, in_tafel)
            SELECT x.lauf_id, x.wort, x.anzahl, x.in_tafel
              FROM jsonb_to_recordset(${tx.json(stueck as never)}) AS x(lauf_id bigint, wort text, anzahl integer, in_tafel boolean)
        `;
    }
}
