import type { Queryable } from "../database.ts";

/**
 * Die Aufbewahrung des Betreiber-Kanals (WI-0124, KANAL-0001 §3.1; Betreiber 2026-10-11: „bildschirmfotos und meldungen verschwinden,
 * aber der "fix report" soll im protokoll dauerthaft erhalten bleiben“, „versschwinden nach 90 tagen oder nach wunsch“).
 *
 * Der Worker ruft sie einmal am Tag als aufgezeichneten Job `kanal_aufbewahrung` (wie `auth_retention`), mit der Jobs-Rolle:
 * 1. die fälligen Bilder (vorgemerkt durch „Bild entfernen“, „Meldung jetzt löschen“ oder 90 Tage nach der Abnahme): je Bild den ganzen
 *    Ordner unter `MEDIA_ROOT/private/kanal/<id>/` löschen (`MediaStore.removeChannel`) und es bestätigen;
 * 2. `kanal_purge_expired()`: Meldungen 90 Tage nach der Abnahme auf ihren Rest leeren, Bildzeilen mit gelöschten Dateien entfernen.
 * Den Fix-Bericht und die Nachweise fasst nichts davon an. Gelöscht wird nur in den Funktionen der Migration 0106.
 */

export const KANAL_RETENTION_KIND = "kanal_aufbewahrung";

/** Was die Aufbewahrung zum Löschen der Dateien braucht (`MediaStore`); ohne `MEDIA_ROOT` bleiben die Bilder vorgemerkt. */
export interface KanalAblage {
    removeChannel(bildId: string): Promise<number>;
}

export interface KanalAufbewahrungErgebnis {
    bilder: number;
    dateien: number;
    bilderOffen: number;
    meldungen: number;
    bildzeilen: number;
    /** Abgelaufene Benachrichtigungen (WI-0136, Migration 0107; 90 Tage nach dem Lesen, höchstens 180), im selben täglichen Lauf. */
    benachrichtigungen: number;
}

/** Gibt es die Funktionen schon (Migration 0106)? Aus dem Katalog, den jede Rolle lesen darf. */
export async function kanalAufbewahrungBereit(db: Queryable): Promise<boolean> {
    const [row] = await db<{ ok: boolean }[]>`
        SELECT to_regprocedure('avesmaps_kanal.kanal_purge_expired()') IS NOT NULL AS ok
    `;
    return row?.ok === true;
}

export async function kanalAufbewahrung(
    db: Queryable,
    ablage: KanalAblage | undefined,
): Promise<KanalAufbewahrungErgebnis> {
    const faellig = await db<{ bild: string }[]>`SELECT bild FROM avesmaps_kanal.kanal_faellige_bilder()`;
    let bilder = 0;
    let dateien = 0;
    let bilderOffen = 0;
    for (const { bild } of faellig) {
        if (ablage === undefined) {
            bilderOffen += 1;
            continue;
        }
        dateien += await ablage.removeChannel(bild);
        await db`SELECT avesmaps_kanal.kanal_bild_geloescht(${bild}::uuid)`;
        bilder += 1;
    }
    const [row] = await db<
        { r: { meldungen: number; bildzeilen: number } }[]
    >`SELECT avesmaps_kanal.kanal_purge_expired() AS r`;
    // Die Benachrichtigungen laufen im selben Job ab (NACHRICHT-0001 §3.1: kein zweiter täglicher Aufräumjob); vor Migration 0107 nichts.
    const [nachrichten] = await db<{ n: number | null }[]>`
        SELECT CASE WHEN to_regprocedure('public.benachrichtigung_purge_expired()') IS NULL THEN 0
                    ELSE public.benachrichtigung_purge_expired() END AS n
    `;
    return {
        bilder,
        dateien,
        bilderOffen,
        meldungen: row?.r.meldungen ?? 0,
        bildzeilen: row?.r.bildzeilen ?? 0,
        benachrichtigungen: nachrichten?.n ?? 0,
    };
}
