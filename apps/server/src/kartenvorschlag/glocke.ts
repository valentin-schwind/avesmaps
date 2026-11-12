import type postgres from "postgres";
import type { Sql } from "../auth/session-store.ts";
import { bestenfalls, neuerKartenvorschlag, type GlockeLog } from "../community/glocke.ts";

/**
 * Die Glocke für neue Kartenvorschläge (WI-0275, Vali 2026-11-04): läuft in einer Transaktion und bestenfalls (Savepoint). Scheitert die Glocke, gilt der Vorschlag trotzdem, und das Protokoll sagt, was fehlt. Muster:
 * `photobox/glocke.ts`.
 */
export async function meldeNeuenKartenvorschlag(tx: Sql, log: GlockeLog, umgebung: string, id: string): Promise<void> {
    await bestenfalls(tx as postgres.TransactionSql, log, "neuer Kartenvorschlag", (q) =>
        neuerKartenvorschlag(q, umgebung, id),
    );
}
