import type postgres from "postgres";
import type { Sql } from "../auth/session-store.ts";
import { bestenfalls, neuesReisebild, type GlockeLog } from "../community/glocke.ts";

/**
 * Die Glocke für neue Reisebilder aus den Operationen des Einreichers (WI-0272 S3, Aufgabe 19): ein Aufruf für die drei Auslöser, die der Redaktion etwas Neues in den
 * Korb „PhotoBox-Uploads › offen“ legen (Einreichen, Bild ersetzen, eine Beschreibung, die auf Prüfung wartet). Er läuft in der Transaktion der Operation und
 * bestenfalls (Savepoint): Scheitert die Glocke, gilt die Handlung trotzdem, und das Protokoll sagt, was fehlt. Die Kennung der Operation ist der Schlüssel gegen Doppelte; eine
 * Wiederholung derselben Operation findet die Quittung vor und kommt hier gar nicht an.
 */

/** Ohne Protokoll (Aufrufe aus Tests und Werkzeugen): Eine gescheiterte Glocke bleibt stumm. Die Routen übergeben das Protokoll der Anfrage. */
export const OHNE_PROTOKOLL: GlockeLog = { warn: () => undefined };

export async function meldeNeuesReisebild(
    tx: Sql,
    log: GlockeLog,
    umgebung: string,
    operationId: string,
): Promise<void> {
    // Die Arbeit einer Operation läuft immer in einer Transaktion (`runOperation` → `database.begin`); der Typ `Sql` kennt beides.
    await bestenfalls(tx as postgres.TransactionSql, log, "neues Reisebild", (q) =>
        neuesReisebild(q, umgebung, operationId),
    );
}
