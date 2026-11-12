import { ziehNotausQuarantaeneNach } from "../media/notaus.ts";
import { zieheQuarantaeneNach } from "../media/quarantine.ts";
import { MediaStore } from "../media/storage.ts";
import { MEDIA_QUARANTINE_KIND } from "../system/inhaltsschalter.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `media_quarantine` (WI-0127 SYS-10 b3, `media/quarantine.ts`): die ganze Menge neu rechnen und die Dateien verschieben, hin
 * und zurück. Eingereiht ohne Person als Auslöser (`reiheQuarantaeneEin`), damit er auch unter Kartensperre wirkt (SYS-4 hält nur
 * Editor-Jobs an): nach jeder Umschaltung eines Bilder-Schalters und nach jedem Setzen und Aufheben eines Einzelbild-Notaus
 * (`media-editor/suspension.ts`, WI-0189 B2). Er gleicht immer beide Gründe ab, erst den Notaus (`media/notaus.ts`), dann die Schalter.
 *
 * Die Jobs-Rolle liest Verwendungen, Rechte und Schalter (Lesen gibt ihr das Schema) und schreibt nur `media_quarantine` und den
 * Dateizustand des Notaus (`media_publication_suspension.file_state`; `apps/server/src/db/media-grants.psql`); die Dateien verschiebt sie
 * unter `MEDIA_ROOT` von `published/` nach `private/quarantine/`.
 */
export async function runMediaQuarantineJob(context: JobContext): Promise<Record<string, unknown>> {
    const root = process.env["MEDIA_ROOT"];
    if (root === undefined || root === "") {
        throw new JobFailure("media_root_missing", "MEDIA_ROOT ist nicht gesetzt", false);
    }
    await context.beginPhase("quarantaene", 0);
    return withJobDatabase(async (database) => {
        const store = new MediaStore(root);
        const notaus = await ziehNotausQuarantaeneNach(database, store);
        const ergebnis = await zieheQuarantaeneNach(database, store);
        return {
            kind: MEDIA_QUARANTINE_KIND,
            grund: "content_switch",
            ...(ergebnis ?? { added: 0, lifted: 0, moved: 0, restored: 0, missing: 0, active: 0 }),
            notaus,
        };
    });
}
