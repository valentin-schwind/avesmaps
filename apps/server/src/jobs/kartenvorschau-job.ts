import { MediaStore } from "../media/storage.ts";
import { KartenvorschauAbbruch, rechneKartenvorschau } from "../media-editor/kartenvorschau-datei.ts";
import { KARTENVORSCHAU_KIND, parseKartenvorschauInput } from "../media-editor/kartensammlung-vorschau.ts";
import { CommittedResult, JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { completeJob } from "./store.ts";

/**
 * Die Jobart `citymap_preview_generate` (WI-0287 Punkt 5, „Vorschau erzeugen“): das Original einer erzeugten Kartenvorschau aus ihrer Karte rechnen, ablegen und den
 * Abgleich einreihen (`media-editor/kartenvorschau-datei.ts`). Eingabe `{ asset, karte, actor }`; eingereiht von `citymap.preview_generate` mit der Person als Auslöser
 * (ein Editor-Job: unter Kartensperre wartet er, SYS-4).
 *
 * Er liest und schreibt selbst (`withJobDatabase`) und schließt sich in der Transaktion seines Schreibens ab (`completeJob` mit `publish`, wie `media_settle`): die Zeile des
 * Originals, der eingereihte Abgleich und `SUCCEEDED` gemeinsam. Die Jobs-Rolle braucht dafür nichts Neues: `media_file` anlegen, `media_asset.technical_state` und
 * `job_enqueue` darf sie schon (`apps/server/src/db/media-grants.psql`).
 *
 * Kosten wie der Abgleich einer Karte: Er liest eine Kartendatei bis 50 MB (oder rastert die erste Seite eines PDF bis 16 MP) und verkleinert sie verlustbehaftet; der
 * Speicherschlüssel ist der der Rasterpipeline (`media_derive`, `jobs/kinds.ts`), leicht wie `media_settle` (`dirigent/plan.ts`).
 */
export async function runKartenvorschauErzeugen(context: JobContext): Promise<CommittedResult> {
    const input = parseKartenvorschauInput(context.input);
    if (input === null) throw new JobFailure("invalid_input", "asset, karte oder actor (UUID) fehlt", false);
    const root = process.env["MEDIA_ROOT"];
    if (root === undefined || root === "") {
        throw new JobFailure("media_root_missing", "MEDIA_ROOT ist nicht gesetzt", false);
    }
    const leaseNo = context.job.leaseNo;
    if (leaseNo === null) throw new JobFailure("no_lease", "Der Lauf kennt seine Lease nicht", false);
    const phasen = { read: 0.1, render: 0.4, store: 0.8 } as const;
    return withJobDatabase(async (database) => {
        try {
            const ergebnis = await rechneKartenvorschau(
                database,
                new MediaStore(root),
                input,
                (write, payload) => completeJob(database, context.job.id, leaseNo, { result: { ...payload } }, write),
                (schritt) => context.beginPhase(schritt, phasen[schritt]),
            );
            return new CommittedResult({ ...ergebnis, kind: KARTENVORSCHAU_KIND });
        } catch (error) {
            // Der Zustand der Vorschau ist geschrieben (`missing_file` …); der Job endet mit dem Code, eine Wiederholung änderte nichts.
            if (error instanceof KartenvorschauAbbruch) throw new JobFailure(error.code, error.message, false);
            throw error;
        }
    });
}
