import type { Queryable } from "../database.ts";

/**
 * Die Aufbewahrung der Anmeldedaten (WI-0120 A12, AUTH-0001 §5, Kap. 7.38: kein Telemetrietyp wächst unbegrenzt).
 *
 * 🔴 Gelöscht wird nur in `avesmaps_auth.purge_expired()` (Migration 0082): eine Funktion mit `SECURITY DEFINER`, die der
 * Migrationsrolle gehört, mit den Fristen fest im Text. Die Jobs-Rolle darf sie nur aufrufen; keine Rolle des Betriebs löscht im
 * Protokoll (Claudio 2026-10-09, `handovers/2026-10-09-auth-einschaetzung-antwort.md` Punkt 2). Der Worker ruft sie einmal am Tag als
 * aufgezeichneten Job `auth_retention`, damit sie auf der Statusseite steht (`jobs/worker.ts`).
 *
 * Die Fristen stehen im Datenschutz-Nachtrag; wer sie ändert, ändert ihn und die Funktion (mit einer neuen Migration) zusammen.
 */
export const AUTH_RETENTION_KIND = "auth_retention";

/** Wie viele Zeilen die Funktion gelöscht oder geleert hat. */
export interface AuthPurgeResult {
    events: number;
    ipPrefixes: number;
    flows: number;
    challenges: number;
    sessions: number;
    links: number;
    throttles: number;
}

/**
 * Gibt es die Funktion schon (Migration 0082)? Gelesen aus dem Katalog, der jeder Rolle offensteht: Eine Instanz vor der Migration hat
 * nichts aufzubewahren, und eine Rolle ohne Recht am Schema soll den Aufruf scheitern sehen, nicht schon die Frage danach.
 */
export async function authRetentionReady(db: Queryable): Promise<boolean> {
    const [row] = await db<{ ready: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'avesmaps_auth' AND p.proname = 'purge_expired'
        ) AS ready
    `;
    return row?.ready === true;
}

export async function purgeExpiredAuth(db: Queryable): Promise<AuthPurgeResult> {
    const [row] = await db<{ result: AuthPurgeResult }[]>`SELECT avesmaps_auth.purge_expired() AS result`;
    return row!.result;
}
