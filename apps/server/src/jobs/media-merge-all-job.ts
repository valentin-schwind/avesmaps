import { mergeAllInput, runMergeAll } from "../media-editor/merge-all.ts";
import type { JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `media_merge_all` (WI-0068, Betreiber 2026-10-17): „Alle bytegleichen Duplikate zusammenführen“ als Auftrag der
 * Warteschlange (Claudio 2026-10-17: ein Lauf in der Anwendung bräche bei jedem Stage-Rollout ab). Die Arbeit steht in
 * `media-editor/merge-all.ts`; hier nur Phase, Fortschritt und die Verbindung der Jobs-Rolle.
 *
 * Die Jobs-Rolle schreibt dafür die Verwendungstafeln, `media_merge` und `media_merge_move` und das Fachprotokoll
 * (`apps/server/src/db/media-grants.psql`); löschen darf sie nichts.
 */
export async function runMediaMergeAllJob(context: JobContext): Promise<Record<string, unknown>> {
    const input = mergeAllInput(context.input);
    await context.beginPhase("zusammenfuehren", 0);
    const ergebnis = await withJobDatabase((database) =>
        runMergeAll(database, input, {
            auftrag: context.job.publicId,
            // Je Gruppe die Grenze für Abbruch und Lease; den Fortschritt alle zehn Gruppen in die Tafel.
            fortschritt: async (erledigt, gesamt) => {
                context.checkpoint();
                if (erledigt % 10 === 0 || erledigt === gesamt) {
                    await context.beginPhase("zusammenfuehren", erledigt / gesamt);
                }
            },
        }),
    );
    return { ...ergebnis };
}
