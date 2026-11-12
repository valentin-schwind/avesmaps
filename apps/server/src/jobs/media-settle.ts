import { zieheQuarantaeneNach } from "../media/quarantine.ts";
import { MediaStore } from "../media/storage.ts";
import { MEDIA_SETTLE_KIND, parseSettleInput, settleAssetFiles } from "../media-editor/settle.ts";
import { CommittedResult, JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { completeJob } from "./store.ts";

/**
 * Die Jobart `media_settle` (WI-0068 P4a, `media-editor/settle.ts`): die Dateien eines Assets mit der Entscheidung der Policy für
 * eine Rolle abgleichen. Eingabe `{ asset: <public_id>, role }`; eingereiht von den Operationen der Medienverwaltung (Hochladen,
 * Binden, Lösen) mit der Person als Auslöser (ein Editor-Job: unter Kartensperre wartet er, SYS-4).
 *
 * Er liest und schreibt selbst (`withJobDatabase`) und schließt sich in der Transaktion seines Schreibens ab (`completeJob` mit
 * `publish`, wie `dem_publish`): Zeilen und `SUCCEEDED` gemeinsam, gegen eine fremde Lease geschützt. Die Jobs-Rolle braucht dafür
 * Schreibrechte an `media_file` und an `media_asset.technical_state` (`apps/server/src/db/media-grants.psql`, Claudios `db-grants`).
 *
 * Danach zieht er die Quarantäne der Inhaltsschalter nach (WI-0127 SYS-10 b3): Eine neue öffentliche Datei einer ausgeschalteten Art
 * wandert gleich nach `private/quarantine/`, und eine Datei in Quarantäne bleibt dort (Schutzregel).
 */
export async function runMediaSettle(context: JobContext): Promise<CommittedResult> {
    const input = parseSettleInput(context.input);
    if (input === null) throw new JobFailure("invalid_input", "asset (UUID) oder role fehlt oder ist unbekannt", false);
    const root = process.env["MEDIA_ROOT"];
    if (root === undefined || root === "") {
        throw new JobFailure("media_root_missing", "MEDIA_ROOT ist nicht gesetzt", false);
    }
    const leaseNo = context.job.leaseNo;
    if (leaseNo === null) throw new JobFailure("no_lease", "Der Lauf kennt seine Lease nicht", false);
    await context.beginPhase("settle", 0);
    return withJobDatabase(async (database) => {
        const store = new MediaStore(root);
        const result = await settleAssetFiles(database, store, input, (write, payload) =>
            completeJob(database, context.job.id, leaseNo, { result: { kind: MEDIA_SETTLE_KIND, ...payload } }, write),
        );
        // Abgeschlossen ist der Abgleich schon; ein Fehler im Nachzug bleibt ein Befund, der Job `media_quarantine` holt ihn nach.
        const quarantine = await zieheQuarantaeneNach(database, store).catch((error: unknown) => ({
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        }));
        return new CommittedResult({
            kind: MEDIA_SETTLE_KIND,
            ...result,
            ...(quarantine === null ? {} : { quarantine }),
        });
    });
}
