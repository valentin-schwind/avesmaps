import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import {
    EventsResponse,
    JobsList,
    JobsOverview,
    OperationsStatus,
    RepoOverview,
    type JobsOverview as Overview,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { legacySetFromRuns, revisionIn } from "../src/jobs/operations.ts";
import { claimJob, completeJob, insertJob, latestSeq } from "../src/jobs/store.ts";
import { recordPhase } from "../src/jobs/store-record.ts";
import { fakeMemory, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Statusseite lesend (JOBS-0001 5.4, Etappe 1): die Routen unter `/api/jobs`, `/api/events` und `/api/status`.
 *
 * 🔴 Fastify schreibt nie in die Queue, und die Queue ist nicht öffentlich: `STATUS_PAGE=off` gibt 404 (Production bis ADR-0013).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const baseConfig = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };

describeWithDatabase("Statusseite: Routen", { timeout: 45_000 }, () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    const DOMAIN = "aventuria";
    const memory = fakeMemory({ availableMb: 6000, swapUsedMb: 0 });
    const plannerScope = uniqueScope("planner");

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    function build(
        overrides: Partial<typeof baseConfig & { statusPage: boolean; releaseId: string }> = {},
        repoRoot?: string | null,
    ) {
        app = buildApp({
            config: { ...baseConfig, databaseUrl: testDatabaseUrl, ...overrides },
            // Die App schließt ihre Verbindung beim Beenden: jede bekommt eine eigene.
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            jobs: {
                memory: memory.probe,
                config: testJobsConfig({ expectedDurationS: { value: { import: 900 } } }),
                plannerScope,
                ...(repoRoot !== undefined ? { repoRoot } : {}),
            },
        });
        return app;
    }

    const probe = (extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, { kind: "probe", mapDomainId: DOMAIN, scopeKind: "tiles", scopeTiles: [], ...extra });

    describe("GET /api/jobs/overview", () => {
        it("liefert läuft, wartet (Position, Grund, Schätzung), fertig, gescheitert, hängt und den Speicher; der Vertrag stimmt", async () => {
            // läuft: ein aufgezeichneter Import in Phase I11
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "zug",
                leaseS: 900,
                memExpectedMb: 300,
                label: "täglicher Zug",
            });
            await recordPhase(database, { externalRef: "zug" }, { phase: "I11", memExpectedMb: 1400, rssMb: 900 }, 900);
            // wartet: zwei Probes
            const waitingFirst = await probe({ label: "Probe A" });
            const waitingSecond = await probe({ label: "Probe B", priority: 10 });
            await database`UPDATE job SET wait_reason = 'waits_slot' WHERE id = ANY(${database.array([waitingFirst.id, waitingSecond.id], 1016)}::bigint[])`;
            // fertig und gescheitert
            const done = await probe();
            await claimJob(database, done.id, "w", 60);
            await completeJob(database, done.id, 1, { wallMs: 1500, rssPeakMb: 120 });
            const failed = await probe();
            await claimJob(database, failed.id, "w", 60);
            await database`UPDATE job SET state = 'FAILED', finished_at = now(), error_code = 'process_died', error_summary = 'tot' WHERE id = ${failed.id}`;
            // hängt: ein weiterer, dessen Lease abgelaufen ist
            const hung = await probe();
            await claimJob(database, hung.id, "w", 60);
            await database`UPDATE job SET lease_expires_at = now() - interval '5 seconds' WHERE id = ${hung.id}`;

            const response = await build().inject({ method: "GET", url: "/api/jobs/overview" });
            expect(response.statusCode).toBe(200);
            expect(response.headers["cache-control"]).toBe("no-store");
            const overview = response.json<Overview>();
            expect(
                Value.Check(JobsOverview, overview),
                JSON.stringify([...Value.Errors(JobsOverview, overview)].slice(0, 3)),
            ).toBe(true);

            expect(overview.profile).toBe("test");
            expect(overview.releaseId).toBe("test");
            expect(overview.seq).toBe(await latestSeq(database));
            expect(overview.running.map((job) => job.kind).sort()).toEqual(["import", "probe"]);
            const running = overview.running.find((job) => job.kind === "import");
            expect(running).toMatchObject({
                phase: "I11",
                label: "täglicher Zug",
                stalled: false,
                origin: "recorded",
                memExpectedMb: 1400,
            });
            // Priorität 10 vor 50: Probe B steht an Position 1
            expect(overview.queued.map((job) => [job.label, job.position])).toEqual([
                ["Probe B", 1],
                ["Probe A", 2],
            ]);
            expect(overview.queued[0]).toMatchObject({
                state: "QUEUED",
                waitReason: "waits_slot",
                estimate: { basis: "unknown", durationP50S: null },
            });
            expect(overview.recent.map((job) => job.id)).toEqual([done.publicId]);
            expect(overview.failed).toMatchObject([
                { id: failed.publicId, errorCode: "process_died", errorSummary: "tot" },
            ]);
            expect(overview.stalled.map((job) => job.id)).toEqual([hung.publicId]);
            expect(overview.running.find((job) => job.id === hung.publicId)?.stalled).toBe(true);
            expect(overview.memory).toMatchObject({
                bookedMb: 1400 + 40,
                budgetMb: 2000,
                availableMb: 6000,
                availFloorMb: 500,
                swapUsedMb: 0,
                rolloutActive: false,
            });
            // Ein Planer lebt nicht: niemand hält den Lock dieses Tests.
            expect(overview.plannerActive).toBe(false);
            expect(imp.id).toBeGreaterThan(0);
        });

        it("die Wartezeit eines wartenden Jobs hinter einem Import mit Startwert ist geschätzt (900 s), sonst unbekannt", async () => {
            await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "zug",
                leaseS: 900,
                memExpectedMb: 300,
            });
            await probe({ scopeKind: "domain" });
            const overview = (await build().inject({ method: "GET", url: "/api/jobs/overview" })).json<Overview>();
            const [waiting] = overview.queued;
            // Der Import hat einen Startwert (MS10, 900 s), die Probe keinen: ihr Start ist bekannt, ihr Ende nicht.
            expect(waiting?.estimate.basis).toBe("unknown");
            expect(waiting?.estimate.startAt).not.toBeNull();
            expect(waiting?.estimate.finishAt).toBeNull();
        });

        it("ein Planer, der den Advisory Lock hält, macht `plannerActive` wahr", async () => {
            const lock = await database.reserve();
            try {
                await lock`SELECT pg_advisory_lock(hashtext('avesmaps3d:job-worker'), hashtext(${plannerScope}))`;
                const overview = (await build().inject({ method: "GET", url: "/api/jobs/overview" })).json<Overview>();
                expect(overview.plannerActive).toBe(true);
            } finally {
                await lock`SELECT pg_advisory_unlock_all()`;
                lock.release();
            }
        });

        it("die Marke `rollout` steht im Speicherblock", async () => {
            await insertJob(database, {
                kind: "rollout",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "m",
                leaseS: 300,
            });
            const overview = (await build().inject({ method: "GET", url: "/api/jobs/overview" })).json<Overview>();
            expect(overview.memory?.rolloutActive).toBe(true);
        });
    });

    describe("GET /api/jobs und /api/events", () => {
        it("`/api/jobs` ohne Zustand: die aktiven; mit Zustand: genau diese; ungültiger Zustand: 400", async () => {
            const waiting = await probe();
            const done = await probe();
            await claimJob(database, done.id, "w", 60);
            await completeJob(database, done.id, 1);
            const active = (await build().inject({ method: "GET", url: "/api/jobs" })).json<{
                jobs: { id: string }[];
            }>();
            expect(Value.Check(JobsList, active)).toBe(true);
            expect(active.jobs.map((job) => job.id)).toEqual([waiting.publicId]);
            const finished = (await app?.inject({ method: "GET", url: "/api/jobs?state=SUCCEEDED" }))?.json<{
                jobs: { id: string }[];
            }>();
            expect(finished?.jobs.map((job) => job.id)).toEqual([done.publicId]);
            expect((await app?.inject({ method: "GET", url: "/api/jobs?state=HAENGT" }))?.statusCode).toBe(400);
        });

        it("`/api/events?since=` holt nach; ab der neuesten Nummer nichts; sind sie aufgeräumt, sagt `gap` es", async () => {
            await probe();
            await probe();
            await probe();
            const all = (await build().inject({ method: "GET", url: "/api/events?since=0" })).json<{
                events: { seq: number }[];
                latestSeq: number;
                gap: boolean;
            }>();
            expect(Value.Check(EventsResponse, all)).toBe(true);
            expect(all.events).toHaveLength(3);
            expect(all.gap).toBe(false);
            expect(all.latestSeq).toBe(all.events[2]?.seq);
            const tail = (
                await app?.inject({ method: "GET", url: `/api/events?since=${String(all.events[0]?.seq)}` })
            )?.json<{ events: unknown[] }>();
            expect(tail?.events).toHaveLength(2);
            const none = (
                await app?.inject({ method: "GET", url: `/api/events?since=${String(all.latestSeq)}` })
            )?.json<{ events: unknown[]; gap: boolean }>();
            expect(none).toMatchObject({ events: [], gap: false });
            // Aufgeräumt: die ersten zwei Ereignisse sind weg; wer bei einer älteren Nummer steht, holt alles neu.
            await database`DELETE FROM job_event WHERE seq <= ${all.events[1]?.seq ?? 0}`;
            const gap = (
                await app?.inject({ method: "GET", url: `/api/events?since=${String((all.events[0]?.seq ?? 1) - 1)}` })
            )?.json<{ gap: boolean; events: unknown[] }>();
            expect(gap).toMatchObject({ gap: true, events: [] });
        });
    });

    describe("GET /api/status/operations (Reiter Betrieb)", () => {
        it("Health, Release, höchste Migration, Zeiger, Legacy-Satz und die letzten Imports", async () => {
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "zug",
                leaseS: 900,
                label: "täglicher Zug 12:00",
            });
            const response = await build({ releaseId: "20261004T120000Z-abc1234" }).inject({
                method: "GET",
                url: "/api/status/operations",
            });
            expect(response.statusCode).toBe(200);
            const status = response.json<OperationsStatus>();
            expect(
                Value.Check(OperationsStatus, status),
                JSON.stringify([...Value.Errors(OperationsStatus, status)].slice(0, 3)),
            ).toBe(true);
            expect(status.releaseId).toBe("20261004T120000Z-abc1234");
            expect(status.health.database).toMatchObject({ status: "ok" });
            expect(status.health.database.detail).toContain("postgis");
            // Vier Ziffern: seit 0100 (WI-0127 SYS-13) beginnt die Nummer nicht mehr mit „00“.
            expect(status.migration).toMatch(/^\d{4}_/);
            expect(status.migration && status.migration >= "0070_jobs").toBe(true);
            expect(status.pointers.displayHeights.state).toMatch(/^(current|stale|none)$/);
            expect(status.imports.map((job) => job.id)).toEqual([imp.publicId]);
        });

        it("der Legacy-Satz: neueste Revisionen aus den Importläufen, nie ein Wert aus einem älteren Lauf, wenn ein neuerer ihn kennt", () => {
            const day = (iso: string) => new Date(iso);
            const set = legacySetFromRuns([
                { source_ref: "map_revision=161832", started_at: day("2026-10-04T03:57:32Z") },
                {
                    source_ref: "territories_revision=pt-15706a07fe5477d8;map_revision=161832",
                    started_at: day("2026-10-03T16:02:33Z"),
                },
                {
                    source_ref: "ecosystem_revision=141459;map_revision=161832",
                    started_at: day("2026-10-03T16:01:40Z"),
                },
                { source_ref: "map_revision=159863", started_at: day("2026-10-01T10:00:00Z") },
            ]);
            expect(set).toEqual({
                mapRevision: "161832",
                ecosystemRevision: "141459",
                territoriesRevision: "pt-15706a07fe5477d8",
                importedAt: "2026-10-04T03:57:32.000Z",
            });
            expect(legacySetFromRuns([])).toEqual({
                mapRevision: null,
                ecosystemRevision: null,
                territoriesRevision: null,
                importedAt: null,
            });
            expect(revisionIn("a=1;map_revision=2", "map_revision")).toBe("2");
            expect(revisionIn("xmap_revision=2", "map_revision")).toBeNull();
        });
    });

    describe("GET /api/status/overview (Reiter Überblick, nur lokal)", () => {
        it("🔴 D2 A: auf der Stage (Release mit Kennung, kein Repository) entfällt er sauber: available false, not_local", async () => {
            const response = await build({ releaseId: "20261004T120000Z-abc1234" }).inject({
                method: "GET",
                url: "/api/status/overview",
            });
            expect(response.statusCode).toBe(200);
            const body = response.json<RepoOverview>();
            expect(Value.Check(RepoOverview, body)).toBe(true);
            expect(body).toMatchObject({
                available: false,
                reason: "not_local",
                waiting: [],
                decidedToday: [],
                sessions: [],
            });
        });

        it("lokal liest er das Repository: Fundstellen mit Datei und Zeile", async () => {
            const root = fileURLToPath(new URL("../../../", import.meta.url));
            const response = await build({ releaseId: "dev" }, root).inject({
                method: "GET",
                url: "/api/status/overview",
            });
            const body = response.json<RepoOverview>();
            expect(Value.Check(RepoOverview, body)).toBe(true);
            expect(body.available).toBe(true);
            // Was current.md gerade enthält, ändert sich; geprüft wird nur, dass jeder Fund einen Beleg trägt. Den Datenstand liest der
            // Test darunter aus einer eigenen Vorlage (seit der Konsolidierung vom 2026-10-22 hat current.md keinen solchen Abschnitt mehr).
            expect(body.waiting.length + body.sessions.length + body.dataStand.length).toBeGreaterThan(0);
            for (const entry of [...body.waiting, ...body.sessions, ...body.dataStand]) {
                expect(entry.beleg.file).toMatch(/^project-control\//);
                expect(entry.beleg.line).toBeGreaterThan(0);
            }
        });

        it("liest die Tabelle Datenstand aus current.md: Zeilen mit lokal, Stage und Beleg", async () => {
            const root = fileURLToPath(new URL("./fixtures/repo-overview/", import.meta.url));
            const body = (
                await build({ releaseId: "dev" }, root).inject({ method: "GET", url: "/api/status/overview" })
            ).json<RepoOverview>();
            expect(body.available).toBe(true);
            expect(body.dataStand).toEqual([
                {
                    label: "Wegenetz",
                    local: "2026-10-01",
                    stage: "2026-10-02",
                    beleg: { file: "project-control/state/current.md", line: 7 },
                },
                {
                    label: "Gelände",
                    local: "Fassung 18",
                    stage: "Fassung 18",
                    beleg: { file: "project-control/state/current.md", line: 8 },
                },
            ]);
        });

        it("ohne Repository (kein project-control) bleibt er aus: no_repository", async () => {
            const empty = fileURLToPath(new URL("./fixtures/", import.meta.url));
            const body = (
                await build({ releaseId: "dev" }, empty).inject({ method: "GET", url: "/api/status/overview" })
            ).json<RepoOverview>();
            expect(body).toMatchObject({ available: false, reason: "no_repository" });
        });
    });

    describe("Aus und ohne Datenbank", () => {
        it("🔴 STATUS_PAGE=off: jede Route der Statusseite ist 404 status_disabled (Production bis ADR-0013), kein Cache", async () => {
            await probe();
            const off = build({ statusPage: false });
            for (const url of [
                "/api/jobs/overview",
                "/api/jobs",
                "/api/events",
                "/api/status/operations",
                "/api/status/overview",
            ]) {
                const response = await off.inject({ method: "GET", url });
                expect(response.statusCode, url).toBe(404);
                expect(response.json()).toEqual({
                    error: { code: "status_disabled", message: "Die Statusseite ist auf dieser Instanz aus." },
                });
                expect(response.headers["cache-control"]).toBe("no-store");
            }
        });

        it("ohne Datenbank: 503 database_unavailable, wie die anderen Routen", async () => {
            app = buildApp({ config: baseConfig });
            for (const url of ["/api/jobs/overview", "/api/jobs", "/api/events", "/api/status/operations"]) {
                const response = await app.inject({ method: "GET", url });
                expect(response.statusCode, url).toBe(503);
                expect(response.json()).toMatchObject({ error: { code: "database_unavailable" } });
            }
        });
    });

    describe("Fastify schreibt nie in die Queue", () => {
        it("🔴 die Routen verändern nichts: Zeilen und Ereignisse bleiben nach allen Abfragen gleich", async () => {
            await probe();
            await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "z",
                leaseS: 900,
            });
            const before = await database<
                { jobs: string; events: string; seq: string }[]
            >`SELECT (SELECT count(*) FROM job)::text AS jobs, (SELECT count(*) FROM job_event)::text AS events, (SELECT max(seq) FROM job_event)::text AS seq`;
            const server = build();
            for (const url of [
                "/api/jobs/overview",
                "/api/jobs",
                "/api/events",
                "/api/status/operations",
                "/api/status/overview",
            ]) {
                await server.inject({ method: "GET", url });
            }
            const after = await database<
                { jobs: string; events: string; seq: string }[]
            >`SELECT (SELECT count(*) FROM job)::text AS jobs, (SELECT count(*) FROM job_event)::text AS events, (SELECT max(seq) FROM job_event)::text AS seq`;
            expect(after).toEqual(before);
        });

        it("🔴 Quelltext: kein Schreibzugriff auf die Queue im Fastify-Teil (Routen, Hub, WebSocket); nur Lesefunktionen des Stores", async () => {
            const files = [
                "../src/routes/jobs.ts",
                "../src/routes/realtime.ts",
                "../src/realtime/hub.ts",
                "../src/realtime/server.ts",
                "../src/realtime/websocket.ts",
                "../src/jobs/overview.ts",
                "../src/jobs/operations.ts",
            ];
            const forbidden =
                /\b(insertJob|claimJob|completeJob|failJob|cancelJob|heartbeatJob|handOffJob|finishCancelled|recordPhase|recordFinish|recordHeartbeat|recoverExpired|pruneJobs|setWaitReasons|addJobFinding|setJobPhase|setJobProgress|job_enqueue|job_insert|job_event_add)\b|INSERT\s+INTO\s+job|UPDATE\s+job|DELETE\s+FROM\s+job/i;
            for (const file of files) {
                const text = (await readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8"))
                    .replace(/\/\*[\s\S]*?\*\//g, "")
                    .replace(/\/\/.*$/gm, "");
                expect(text.match(forbidden)?.[0], `${file} schreibt in die Queue`).toBeUndefined();
            }
        });
    });
});
