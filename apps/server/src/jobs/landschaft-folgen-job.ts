import { deriveLandSmooth } from "../areas/smooth.ts";
import type { Database } from "../database.ts";
import { refreshLabelCurve } from "../derive/refresh-label-curve.ts";
import { addAreaEvent, type AreaEventJob } from "./area-events.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";
import { LABEL_RUNS_JOB_KIND, LAND_SMOOTH_JOB_KIND } from "./landschaft-arten.ts";

/**
 * Die Folgen einer gespeicherten Landschaft (WI-0178 B3; EDIT-0004 §6; Claudio 2026-10-16, „Alle Folgen als Aufträge der gemeinsamen
 * Warteschlange“). Eingereiht von der Schreibnaht (`editor/map-operation.ts`) in der Transaktion der Operation, gerechnet als
 * Jobs-Rolle; deren Rechte stehen in `apps/server/src/db/map-grants.psql`.
 *
 * - `land_smooth` rundet die geänderten Flächen und ihre Nachbarn, **nie das volle Netz** (`nurLokal`, Claudio: „Voll braucht
 *   `land_smooth` heute 400 MB“). Er braucht keine Liste: Was die Operationen geändert haben, ist genau das, was veraltet ist
 *   (`source_updated_at` ≠ `updated_at`). Die Klimabänder bleiben, eine Landschaft ändert sie nicht.
 * - `label_runs` rechnet die Schriftläufe EINER Region (`refreshLabelCurve`, dieselbe Rechnung wie `derive:runs -- --region`).
 *
 * Beide melden danach `map.changed`: Die gerundete Fläche und der neue Lauf stehen in Kacheln, die die Karten erst mit einer neuen
 * Kachelrevision (`?r=`) neu holen. Die Meldung kommt nach dem Commit der Rechnung (`addAreaEvent`), nie davor.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Die Fassung des Auftrags, an der eine Meldung hängt. */
function ereignisJob(context: JobContext, kind: string, domain: string): AreaEventJob {
    return { id: context.job.id, publicId: context.job.publicId, kind, mapDomainId: domain };
}

/** `land_smooth`: rechnet und meldet; ohne Arbeit (nichts veraltet, oder es bräuchte das volle Netz) meldet er nichts. */
export async function glaetteNachSpeichern(database: Database, job: AreaEventJob): Promise<Record<string, unknown>> {
    const report = await deriveLandSmooth(database, { mapDomainId: job.mapDomainId, climate: false, nurLokal: true });
    if (report.computed && report.written > 0) {
        await addAreaEvent(database, "map.changed", job, { operation: LAND_SMOOTH_JOB_KIND, affected: [] });
    }
    return {
        mode: report.mode,
        computedAreas: report.computedAreas,
        written: report.written,
        fallbacks: report.fallbacks,
        ms: report.ms,
        ...(report.ausgelassen ? { finding: "voll_noetig" } : {}),
    };
}

/** `label_runs`: die Läufe der Region aus `input.landscape`. Eine unbekannte Region ist ein Eingabefehler, nicht wiederholbar. */
export async function laeufeNachSpeichern(
    database: Database,
    job: AreaEventJob,
    landscape: string,
): Promise<Record<string, unknown>> {
    const outcome = await refreshLabelCurve(database, landscape);
    if (outcome.status === "not-found") {
        throw new JobFailure("input_invalid", `Die Landschaft ${landscape} gibt es nicht`, false);
    }
    await addAreaEvent(database, "map.changed", job, {
        operation: LABEL_RUNS_JOB_KIND,
        affected: [{ kind: "landscape", id: landscape }],
    });
    return outcome.status === "written"
        ? { status: outcome.status, runs: outcome.runs }
        : { status: outcome.status, reason: outcome.reason };
}

export async function runLandSmoothJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    return withJobDatabase(async (database) => {
        await context.beginPhase("smooth", 0);
        return glaetteNachSpeichern(database, ereignisJob(context, LAND_SMOOTH_JOB_KIND, domain));
    });
}

export async function runLabelRunsJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    const landscape = context.input["landscape"];
    if (typeof landscape !== "string" || !UUID.test(landscape)) {
        throw new JobFailure("input_invalid", "label_runs braucht die Kennung einer Landschaft (landscape)", false);
    }
    return withJobDatabase(async (database) => {
        await context.beginPhase("runs", 0);
        return laeufeNachSpeichern(database, ereignisJob(context, LABEL_RUNS_JOB_KIND, domain), landscape);
    });
}
