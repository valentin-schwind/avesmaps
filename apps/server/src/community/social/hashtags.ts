import type { SocialHashtag } from "@avesmaps3d/shared";
import { isNotProvisioned, type Queryable } from "../../database.ts";

/**
 * Die Hashtags, die der Social Hub in jedem Beitrag anbietet (WI-0270, Migration 0312; gepflegt im Panel „Hashtags“ der Systemsteuerung). Ein vorausgewählter steht in einem neuen Beitrag schon drin; ein Beitrag darf
 * daneben eigene tragen. Geprüft wird nur beim Schreiben: Ein Beitrag hängt nicht an dieser Tafel.
 */

/** Die Liste in ihrer Reihenfolge. Fehlt die Tafel noch (0312 nicht angewandt), ist sie leer: Der Hub bietet dann nichts an und bleibt bedienbar. */
export async function leseHashtags(db: Queryable): Promise<SocialHashtag[]> {
    try {
        const zeilen = await db<SocialHashtag[]>`
            SELECT tag, vorausgewaehlt FROM public.social_hashtag ORDER BY reihe, tag
        `;
        return zeilen.map((zeile) => ({ tag: zeile.tag, vorausgewaehlt: zeile.vorausgewaehlt }));
    } catch (fehler) {
        if (isNotProvisioned(fehler)) return [];
        throw fehler;
    }
}

/** Ersetzt die ganze Liste; die Reihenfolge ist die der Eingabe. In der Transaktion des Aufrufers, mit dem Protokoll zusammen. */
export async function setzeHashtags(tx: Queryable, hashtags: readonly SocialHashtag[]): Promise<void> {
    const zeilen = hashtags.map((hashtag, index) => ({ ...hashtag, reihe: index + 1 }));
    await tx`DELETE FROM public.social_hashtag`;
    await tx`
        INSERT INTO public.social_hashtag (tag, vorausgewaehlt, reihe)
        SELECT z.tag, z.vorausgewaehlt, z.reihe::smallint
          FROM jsonb_to_recordset(${tx.json(zeilen)}::jsonb) AS z(tag TEXT, vorausgewaehlt BOOLEAN, reihe INTEGER)
        ON CONFLICT (tag) DO NOTHING
    `;
}
