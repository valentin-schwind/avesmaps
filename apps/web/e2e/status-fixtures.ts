import type { Page } from "@playwright/test";
import type {
    JobEventRecord,
    JobSummary,
    JobsOverview,
    OperationsStatus,
    QueueEntry,
    RepoOverview,
} from "@avesmaps3d/shared";

/**
 * Die Statusseite ohne Server (JOBS-0001 Teil B): Antworten der Routen und Verhalten von `/ws` kommen vom Test. So prüft der Browsertest
 * die Seite selbst (Zustände, Sätze, Live, Reconnect, Telefon), unabhängig davon, was in einer Datenbank steht. Den echten Weg über
 * Fastify und PostgreSQL prüft `status-page-live.spec.ts`.
 */

export const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();
const later = (seconds: number): string => new Date(NOW + seconds * 1000).toISOString();

export function job(extra: Partial<JobSummary> = {}): JobSummary {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "probe",
        origin: "queued",
        state: "QUEUED",
        stalled: false,
        label: null,
        waitReason: null,
        phase: null,
        progress: null,
        mapDomainId: "aventuria",
        scope: { kind: "tiles", tiles: [] },
        priority: 50,
        queuedAt: ago(120),
        notBefore: null,
        startedAt: null,
        finishedAt: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        attempt: 0,
        maxAttempts: 3,
        wallMs: null,
        rssPeakMb: null,
        memExpectedMb: null,
        swapSeenMb: null,
        cancelRequested: false,
        cancelReason: null,
        errorCode: null,
        errorSummary: null,
        findings: [],
        coalescedCount: 0,
        dependsOn: [],
        result: null,
        ...extra,
    };
}

export function queued(
    position: number,
    extra: Partial<JobSummary>,
    estimate: Partial<QueueEntry["estimate"]> = {},
): QueueEntry {
    return {
        ...job({ state: "QUEUED", ...extra }),
        position,
        estimate: {
            startAt: null,
            finishAt: null,
            durationP50S: null,
            durationP95S: null,
            basis: "unknown",
            ...estimate,
        },
    };
}

/** Ein Stand mit allem, was die Seite zeigen kann. */
export function fullOverview(): JobsOverview {
    return {
        seq: 120,
        now: new Date(NOW).toISOString(),
        releaseId: "20261004T120000Z-abc1234",
        profile: "staging",
        plannerActive: true,
        queuePause: { paused: false, since: null, by: null, reason: null },
        view: "all",
        running: [
            job({
                id: "00000000-0000-4000-8000-0000000000a1",
                kind: "import",
                origin: "recorded",
                state: "RUNNING",
                label: "täglicher Zug 12:00",
                phase: "I11",
                progress: 0.4,
                startedAt: ago(312),
                heartbeatAt: ago(6),
                leaseExpiresAt: later(894),
                attempt: 1,
                rssPeakMb: 1250,
                memExpectedMb: 1400,
            }),
            job({
                id: "00000000-0000-4000-8000-0000000000a2",
                kind: "probe",
                state: "RUNNING",
                stalled: true,
                phase: "phase-2",
                startedAt: ago(900),
                heartbeatAt: ago(400),
                leaseExpiresAt: ago(340),
                attempt: 1,
                rssPeakMb: 330,
                memExpectedMb: 396,
            }),
        ],
        queued: [
            queued(
                1,
                {
                    id: "00000000-0000-4000-8000-0000000000b1",
                    label: "Probe, 256 MB Ballast",
                    waitReason: "waits_area",
                    memExpectedMb: 356,
                },
                {
                    startAt: later(588),
                    finishAt: later(1488),
                    durationP50S: 900,
                    durationP95S: 900,
                    basis: "startwert",
                },
            ),
            queued(2, {
                id: "00000000-0000-4000-8000-0000000000b2",
                label: "Probe, 512 MB Ballast",
                waitReason: "waits_memory",
                memExpectedMb: 612,
            }),
            queued(
                3,
                {
                    id: "00000000-0000-4000-8000-0000000000b3",
                    waitReason: "debouncing",
                    notBefore: later(25),
                    errorCode: "process_died",
                    attempt: 1,
                },
                { startAt: later(25), durationP50S: 90, durationP95S: 150, basis: "history" },
            ),
        ],
        recent: [
            job({
                id: "00000000-0000-4000-8000-0000000000c1",
                kind: "import",
                origin: "recorded",
                state: "SUCCEEDED",
                label: "täglicher Zug 12:00",
                phase: "I19",
                startedAt: ago(1800),
                finishedAt: ago(840),
                wallMs: 960_000,
                rssPeakMb: 1326,
                findings: [
                    {
                        code: "budget_exceeded",
                        detail: "Spitze RSS 1326 MB über der Erwartung 1300 MB (gemeldet, nicht beendet)",
                    },
                ],
            }),
            job({
                id: "00000000-0000-4000-8000-0000000000c2",
                state: "CANCELLED",
                cancelReason: "dependency_failed",
                finishedAt: ago(3000),
            }),
        ],
        failed: [
            job({
                id: "00000000-0000-4000-8000-0000000000d1",
                state: "FAILED",
                finishedAt: ago(5400),
                startedAt: ago(5500),
                wallMs: 5200,
                attempt: 3,
                errorCode: "process_died",
                errorSummary: "Der Job-Prozess endete unerwartet (Exit 137, Signal SIGKILL).",
            }),
        ],
        stalled: [],
        memory: {
            bookedMb: 1796,
            budgetMb: 1600,
            availableMb: 3100,
            availFloorMb: 2048,
            swapUsedMb: 0,
            rolloutActive: true,
        },
    };
}

export function withStalled(overview: JobsOverview): JobsOverview {
    return { ...overview, stalled: overview.running.filter((entry) => entry.stalled) };
}

export function operations(): OperationsStatus {
    return {
        now: new Date(NOW).toISOString(),
        releaseId: "20261004T120000Z-abc1234",
        profile: "staging",
        health: { database: { status: "ok", detail: "postgis 3.6" } },
        migration: "0070_jobs",
        pointers: {
            dem: { revision: "a0d65d595b8f", format: "webp", createdAt: ago(86_400) },
            displayHeights: { state: "stale", revision: "041cad6d0483", demRevision: "7a7dbe454996" },
        },
        legacy: {
            mapRevision: "163536",
            ecosystemRevision: "144193",
            territoriesRevision: "pt-15706a07fe5477d8",
            importedAt: ago(7200),
        },
        imports: [
            job({
                id: "00000000-0000-4000-8000-0000000000c1",
                kind: "import",
                origin: "recorded",
                state: "SUCCEEDED",
                label: "täglicher Zug 12:00",
                finishedAt: ago(840),
                wallMs: 960_000,
                rssPeakMb: 1326,
            }),
        ],
    };
}

export function repo(available: boolean): RepoOverview {
    if (!available) {
        return {
            available: false,
            reason: "not_local",
            generatedAt: new Date(NOW).toISOString(),
            today: "2026-10-04",
            waiting: [],
            decidedToday: [],
            selfDecided: [],
            sessions: [],
            dataStand: [],
        };
    }
    return {
        available: true,
        reason: null,
        generatedAt: new Date(NOW).toISOString(),
        today: "2026-10-04",
        waiting: [
            {
                text: "Bootstrap der Unit für den Worker",
                detail: "ACTION_REQUIRED; yes: Freigabe des Bootstraps",
                beleg: { file: "project-control/handovers/2026-10-04-a.md", line: 8 },
            },
        ],
        decidedToday: [
            {
                text: "alles wie empfohlen",
                detail: "an 3 Stellen",
                beleg: { file: "project-control/planning/JOBS-0001-queue-und-statusseite.md", line: 478 },
            },
        ],
        selfDecided: [
            {
                text: "IMPLEMENTATION DETAIL: der Worker ist ein eigener Prozess.",
                detail: null,
                beleg: { file: "project-control/work-items/WI-0074-x.md", line: 31 },
            },
        ],
        sessions: [
            {
                text: "WI-0074 JOBS-0001 Etappe 1",
                detail: "Besitz: claudia; IN_PROGRESS",
                beleg: { file: "project-control/work-items/WI-0074-x.md", line: 8 },
            },
        ],
        dataStand: [
            {
                label: "Legacy-Satz",
                local: "map161832",
                stage: "map163536",
                beleg: { file: "project-control/state/current.md", line: 89 },
            },
        ],
    };
}

export interface Backend {
    overview: JobsOverview;
    operations: OperationsStatus;
    repo: RepoOverview;
    /** 404 `status_disabled` statt des Standes. */
    disabled: boolean;
    requests: { overview: number; operations: number; repo: number };
}

/** Beantwortet die Routen der Statusseite aus `backend`; der Test verändert es zwischen den Abfragen. */
export async function mockBackend(page: Page, backend: Partial<Backend> = {}): Promise<Backend> {
    const state: Backend = {
        overview: withStalled(fullOverview()),
        operations: operations(),
        repo: repo(false),
        disabled: false,
        requests: { overview: 0, operations: 0, repo: 0 },
        ...backend,
    };
    const respond = async (
        route: Parameters<Parameters<Page["route"]>[1]>[0],
        body: unknown,
        counter: keyof Backend["requests"],
    ): Promise<void> => {
        state.requests[counter] += 1;
        if (state.disabled) {
            await route.fulfill({ status: 404, json: { error: { code: "status_disabled", message: "aus" } } });
            return;
        }
        await route.fulfill({ json: body });
    };
    await page.route("**/api/jobs/overview", (route) => respond(route, state.overview, "overview"));
    await page.route("**/api/status/operations", (route) => respond(route, state.operations, "operations"));
    await page.route("**/api/status/overview", (route) => respond(route, state.repo, "repo"));
    return state;
}

export const jobEvent = (seq: number, kind = "job.started"): JobEventRecord => ({
    seq,
    at: new Date(NOW).toISOString(),
    kind,
    jobId: "00000000-0000-4000-8000-0000000000a1",
    mapDomainId: "aventuria",
    payload: { state: "RUNNING", jobKind: "import" },
});
