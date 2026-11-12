import type { Database } from "../database.ts";
import { derivePathRunsFor, type PathChainKey } from "../derive/path-runs.ts";
import { addAreaEvent, type AreaEventJob } from "./area-events.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";
import { PATH_LABEL_RUNS_JOB_KIND } from "./landschaft-arten.ts";

/**
 * Die Wegnamen auf der Karte nach einer Wege-Operation des Editors (WI-0177; Entscheid der Editor-Orchestrierung 2026-10-17, (a);
 * Muster `label_runs` der Landschaft, `landschaft-folgen-job.ts`). Eingereiht von der Schreibnaht (`editor/map-operation.ts`) je
 * berührter Kette (Name und Art, Migration 0022), mit 10 s Sammelzeit; gerechnet als Jobs-Rolle (Rechte in `map-grants.psql`).
 *
 * - `path_label_runs` rechnet die Schriftläufe EINER Kette neu (`derivePathRunsFor`, dieselbe Rechnung wie `derive:path-runs`). Eine
 *   Kette, die es nicht mehr gibt (umbenannt, gelöscht, „Name auf der Karte“ aus), verliert ihre Läufe; das ist kein Fehler.
 * - Danach `map.changed`: Der neue Lauf steht in Kacheln, die die Karten erst mit einer neuen Kachelrevision neu holen.
 * - Bis die Stage die Art zulässt, bleiben die Läufe, wie sie sind, und die nächste volle Ableitung der Pipeline stellt sie richtig.
 */

/** Die Kette aus der Eingabe des Auftrags; eine kaputte Eingabe ist nicht wiederholbar. */
export function ketteAus(input: Record<string, unknown>): PathChainKey {
    const { name, subtype } = input;
    if (typeof name !== "string" || typeof subtype !== "string" || subtype === "")
        throw new JobFailure(
            "input_invalid",
            "path_label_runs braucht Name und Art einer Kette (name, subtype)",
            false,
        );
    return { name, subtype };
}

/** `path_label_runs`: die Läufe einer Kette, danach die Meldung an die Karten. */
export async function wegnamenNachSpeichern(
    database: Database,
    job: AreaEventJob,
    kette: PathChainKey,
): Promise<Record<string, unknown>> {
    const report = await derivePathRunsFor(database, job.mapDomainId, [kette]);
    await addAreaEvent(database, "map.changed", job, { operation: PATH_LABEL_RUNS_JOB_KIND, affected: [] });
    return { ...report };
}

export async function runPathLabelRunsJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    const kette = ketteAus(context.input);
    return withJobDatabase(async (database) => {
        await context.beginPhase("runs", 0);
        return wegnamenNachSpeichern(
            database,
            { id: context.job.id, publicId: context.job.publicId, kind: PATH_LABEL_RUNS_JOB_KIND, mapDomainId: domain },
            kette,
        );
    });
}
