import { DEM_MAX_ZOOM } from "../terrain/dem-tiles.ts";
import { deriveTerrain } from "../terrain/derive.ts";
import { deriveDisplayHeightsWithinLock } from "../terrain/display-height/derive.ts";
import { StaleDomainSeedError } from "../terrain/domain/inputs.ts";
import { LocalPublishRetry, publishLocalCandidate } from "../terrain/domain/local-publish.ts";
import { DeriveBusyError } from "../derive/derive-lock.ts";
import { addAreaEvent, boundsOfTiles, changedTilesBetween } from "./area-events.ts";
import { CommittedResult, JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";
import { completeJob } from "./store.ts";

/**
 * Die Glieder der Gelände-Kette nach `terrain_local` (JOBS-0001 4.4, WI-0125):
 *
 *     terrain_local → dem_publish → routing_reload        (gleich nach der Veröffentlichung)
 *                         └──────→ display_heights        (daneben; in Etappe 2 ohne Entprellung)
 *     terrain_full  → routing_reload, display_heights     (der gesammelte volle Lauf, D6 = B: die Wahrheit)
 *
 * Jeder Job-Prozess öffnet seine eigene Verbindung (`withJobDatabase`); die Sperre der Domäne hält der Worker (geteilt) oder, beim
 * vollen Lauf, die Ableitung selbst (exklusiv, wie `derive:terrain`).
 */

export async function runDemPublishJob(context: JobContext): Promise<CommittedResult> {
    const candidateJob = context.input["candidateJob"];
    if (typeof candidateJob !== "string" || !/^[0-9a-f-]{36}$/.test(candidateJob))
        throw new JobFailure("invalid_input", "candidateJob: die Kennung des terrain_local fehlt", false);
    const domain = jobDomain(context.job.mapDomainId);
    const leaseNo = context.job.leaseNo;
    if (leaseNo === null) throw new JobFailure("no_lease", "Der Lauf kennt seine Lease nicht", false);
    try {
        const result = await withJobDatabase((database) =>
            publishLocalCandidate(database, {
                mapDomainId: domain,
                candidateJob,
                job: { id: context.job.id, publicId: context.job.publicId, leaseNo },
                phase: (name, progress) => context.beginPhase(name, progress),
                complete: (publish, payload) =>
                    completeJob(database, context.job.id, leaseNo, { result: payload }, publish),
            }),
        );
        return new CommittedResult({ ...result, changed: Object.keys(result.changed).length });
    } catch (error) {
        if (error instanceof LocalPublishRetry)
            throw new JobFailure(error.code, error.message, error.code === "rebase");
        throw error;
    }
}

export async function runTerrainFullJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    const workers = context.input["workers"];
    await context.beginPhase("derive", 0);
    try {
        return await withJobDatabase(async (database) => {
            const [before] = await database<{ revision: string }[]>`
                SELECT revision FROM terrain_dem WHERE map_domain_id = ${domain} AND is_current
            `;
            // Exklusiv wie `derive:terrain`; die vorige Revision bleibt einen Tag für offene Karten (ADR-0008). Meldet die Prüfung danach
            // eine veraltete Saat, obwohl die Saat-Phase eben lief, rechnet ein zweiter Durchgang die Saaten nach, wie `terrain_local`
            // (Stage-Job 2117: der erzeugte Kamm von Altimont fiel beim Laden aller Gebirge anders aus); die erste Meldung bleibt als Beleg.
            let seedRetry: string | null = null;
            let report: Awaited<ReturnType<typeof deriveTerrain>>;
            for (let attempt = 1; ; attempt += 1) {
                try {
                    report = await deriveTerrain(database, {
                        mapDomainId: domain,
                        ...(typeof workers === "number" ? { workers } : {}),
                    });
                    break;
                } catch (error) {
                    if (attempt >= 2 || !(error instanceof Error && error.cause instanceof StaleDomainSeedError))
                        throw error;
                    seedRetry = error.message;
                    await context.beginPhase("derive", 0);
                }
            }
            if (report.failed.length > 0)
                throw new JobFailure(
                    "seeds_failed",
                    `V12 scheiterte: ${report.failed.map((entry) => entry.name).join(", ")}`,
                    false,
                );
            await context.beginPhase("event", 0.95);
            const changed = report.revisionChanged
                ? await changedTilesBetween(database, before?.revision ?? null, report.revision)
                : {};
            if (report.revisionChanged)
                await addAreaEvent(
                    database,
                    "area.changed",
                    { id: context.job.id, publicId: context.job.publicId, kind: "terrain_full", mapDomainId: domain },
                    {
                        revision: report.revision,
                        previous: before?.revision ?? null,
                        tiles: changed,
                        provisional: false,
                    },
                    boundsOfTiles(changed, DEM_MAX_ZOOM),
                );
            return {
                unchanged: !report.revisionChanged,
                revision: report.revision,
                previous: before?.revision ?? null,
                changed: Object.keys(changed).length,
                computed: report.domain?.computed ?? false,
                tiles: report.tiles,
                bytes: report.bytes,
                profiles: report.profiles.computed,
                phasesMs: Object.fromEntries(Object.entries(report.phases).map(([name, ms]) => [name, Math.round(ms)])),
                seedRetry,
            };
        });
    } catch (error) {
        // Eine CLI-Ableitung hält die Sperre: später noch einmal (höchstens zwei Wiederholungen).
        if (error instanceof DeriveBusyError) throw new JobFailure("domain_busy", error.message, true);
        throw error;
    }
}

export async function runDisplayHeightsJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    await context.beginPhase("derive", 0);
    return withJobDatabase(async (database) => {
        const report = await deriveDisplayHeightsWithinLock(database, { mapDomainId: domain });
        if (report.revisionChanged) {
            await context.beginPhase("event", 0.95);
            await addAreaEvent(
                database,
                "display_heights.changed",
                { id: context.job.id, publicId: context.job.publicId, kind: "display_heights", mapDomainId: domain },
                { revision: report.revision, demRevision: report.demRevision },
            );
        }
        return {
            unchanged: !report.revisionChanged,
            revision: report.revision,
            demRevision: report.demRevision,
            mode: report.mode,
            contours: report.contours,
            ms: Math.round(report.ms),
        };
    });
}
