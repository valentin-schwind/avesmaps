import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { readRoutingRevision, revisionKey, travelModelVersion } from "../routing/revision.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";

/**
 * `routing_reload` (JOBS-0001 4.4, WI-0125): beobachtet, ob der Routing-Worker jeder Fastify-Instanz die neue Datenrevision geladen
 * hat. Er rechnet nichts und lädt nichts: Der Routing-Worker prüft die Revision selbst alle 5 s und tauscht seit WI-0125 nur die
 * geänderten Kacheln seines Rasters (`routing/terrain-load.ts`).
 *
 * Er endet `SUCCEEDED`, sobald jede Instanz die erwartete `routing_graph_revision` meldet (`GET /health/routing`, Feld `revision`);
 * läuft die Frist ab (Startwert 30 s, MS16), ebenfalls `SUCCEEDED`, mit `observed: false` und dem Befund `routing_not_observed`, nie
 * `FAILED` (4.4).
 *
 * Wo die Instanzen sind: `ROUTING_HEALTH_URLS` (durch Komma getrennt, auf dem VPS die Loopback-Adressen der Slots), sonst
 * `http://127.0.0.1:<PORT oder 3000>/health/routing`. Im Ergebnis stehen nur ihre Nummern, keine Adressen.
 */

interface Seen {
    instance: number;
    revision: string | null;
    state: string | null;
    error: string | null;
}

export function routingHealthUrls(environment: NodeJS.ProcessEnv = process.env): string[] {
    const configured = environment["ROUTING_HEALTH_URLS"]
        ?.split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    if (configured && configured.length > 0) return configured;
    return [`http://127.0.0.1:${environment["PORT"] ?? "3000"}/health/routing`];
}

async function ask(url: string, instance: number): Promise<Seen> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        const body = (await response.json()) as { revision?: unknown; state?: unknown };
        return {
            instance,
            revision: typeof body.revision === "string" ? body.revision : null,
            state: typeof body.state === "string" ? body.state : null,
            error: null,
        };
    } catch (error) {
        return { instance, revision: null, state: null, error: error instanceof Error ? error.name : "unbekannt" };
    }
}

export async function runRoutingReloadJob(
    context: JobContext,
    environment: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    const raw = context.input["observeTimeoutS"];
    if (raw !== undefined && (typeof raw !== "number" || !(raw > 0) || raw > 600))
        throw new JobFailure("invalid_input", "observeTimeoutS: Sekunden, größer 0 und höchstens 600", false);
    const timeoutMs = (typeof raw === "number" ? raw : 30) * 1000;
    await context.beginPhase("observe", 0);
    const expected = await withJobDatabase(async (database) =>
        revisionKey(await readRoutingRevision(database, domain, travelModelVersion(AVENTURIA_TRAVEL_MODEL))),
    );
    const urls = routingHealthUrls(environment);
    const started = Date.now();
    const look = (): Promise<Seen[]> => Promise.all(urls.map((url, index) => ask(url, index)));
    let seen = await look();
    while (!seen.every((entry) => entry.revision === expected) && Date.now() - started < timeoutMs) {
        context.checkpoint();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        seen = await look();
    }
    const observed = seen.every((entry) => entry.revision === expected);
    return {
        observed,
        expected,
        waitedMs: Date.now() - started,
        instances: seen,
        ...(observed ? {} : { finding: "routing_not_observed" }),
    };
}
