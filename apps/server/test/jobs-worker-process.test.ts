import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JobWorker, type AuftragErgebnis } from "../src/jobs/worker.ts";
import { cancelJob, getJobById, insertJob, readEvents } from "../src/jobs/store.ts";
import { fakeMemory, sleep, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Der ECHTE Job-Prozess (JOBS-0001 4.1, 6.0): ein Kindprozess je Job mit `node --expose-gc`, Probe-Jobs mit Ballast, Absturz,
 * Abbruch zwischen den Phasen, blockiertem Hauptthread. Hier steht, was kein gesteuerter Ersatz beweist: dass Heartbeat und
 * Messung wirklich vom Aufseher kommen und ein toter Aufseher sein Kind mitnimmt.
 *
 * Den Dirigenten (WI-0163) spielt `bisZumEnde`: Er startet den Ausführer neu, solange die Zeile wieder wartet (Wiederholung).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Ausführer mit echtem Job-Prozess", { timeout: 45_000 }, () => {
    let database: Database;
    const DOMAIN = "aventuria";
    const workers: JobWorker[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
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
        for (const worker of workers.splice(0)) await worker.stop(0);
    });

    function realWorker(options: Partial<ConstructorParameters<typeof JobWorker>[0]> = {}): JobWorker {
        const instance = new JobWorker({
            database,
            // Ein Node-Prozess braucht unter Windows rund 70 MB Grundbedarf: die Erwartung der Probe rechnet großzügig (Profilwert probe_base).
            config: testJobsConfig({
                heartbeatS: { value: 0.1 },
                drainMaxS: { value: 0.1 },
                memExpectedMb: { value: { probe_base: 120 } },
            }),
            mapDomainId: DOMAIN,
            deriveScope: uniqueScope("derive"),
            memory: fakeMemory().probe,
            killGraceMs: 1000,
            stopGraceMs: 2000,
            ...options,
        });
        workers.push(instance);
        return instance;
    }

    const probe = (input: Record<string, unknown>, extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, {
            kind: "probe",
            mapDomainId: DOMAIN,
            scopeKind: "tiles",
            scopeTiles: [],
            inputRef: input,
            ...extra,
        });

    const terminal = (id: number, timeoutMs = 20_000) =>
        waitFor(
            async () => {
                const row = await getJobById(database, id);
                return row && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(row.state) ? row : undefined;
            },
            timeoutMs,
            `Job ${String(id)} beendet`,
        );

    /** Wie der Dirigent: den Ausführer erneut starten, solange die Zeile wieder wartet; dann das Ende der Zeile. */
    async function bisZumEnde(worker: JobWorker, id: number) {
        const ergebnisse: AuftragErgebnis[] = [];
        for (let lauf = 0; lauf < 5; lauf += 1) {
            const ergebnis = await worker.runOne(id);
            ergebnisse.push(ergebnis);
            if (ergebnis.ergebnis !== "erledigt" || ergebnis.state !== "QUEUED") break;
        }
        return { row: await terminal(id), ergebnisse };
    }

    it("ein Probe-Job läuft im Kindprozess durch seine Phasen: Ergebnis, Phasenmessung, CPU und Spitze RSS", async () => {
        const worker = realWorker();
        const job = await probe({
            phases: [
                { name: "eins", ms: 150 },
                { name: "zwei", ms: 150 },
            ],
        });
        const { row: done, ergebnisse } = await bisZumEnde(worker, job.id);
        expect(ergebnisse).toEqual([{ ergebnis: "erledigt", state: "SUCCEEDED" }]);
        expect(done).toMatchObject({ state: "SUCCEEDED", result: { phases: 2 }, attempt: 1 });
        expect(Object.keys(done.phaseStats)).toEqual(["eins", "zwei"]);
        expect(done.wallMs ?? 0).toBeGreaterThanOrEqual(250);
        expect(done.rssPeakMb ?? 0).toBeGreaterThan(20);
        const phases = (await readEvents(database, 0, 50))
            .filter((event) => event.kind === "job.phase")
            .map((event) => event.payload["phase"]);
        expect(phases).toEqual(["eins", "zwei"]);
    }, 30_000);

    it("Speicherballast steht in der gemessenen Spitze RSS, die Erwartung der Probe kennt ihn (kein Befund)", async () => {
        const worker = realWorker();
        const job = await probe({ ballastMb: 256, sleepMs: 1200 });
        const { row: done } = await bisZumEnde(worker, job.id);
        expect(done.state).toBe("SUCCEEDED");
        expect(done.memExpectedMb).toBe(376);
        expect(done.rssPeakMb ?? 0).toBeGreaterThanOrEqual(256);
        expect(done.findings).toEqual([]);
    }, 30_000);

    it("🔴 Überschreitung ist ein Befund, nie ein Abbruch: die Probe meldet zu wenig, wird nicht beendet und endet SUCCEEDED", async () => {
        const worker = realWorker();
        const job = await probe({ ballastMb: 256, understateMb: 200, sleepMs: 1500 });
        const { row: done } = await bisZumEnde(worker, job.id);
        expect(done.state).toBe("SUCCEEDED");
        expect(done.findings.map((finding) => finding.code)).toEqual(["budget_exceeded"]);
    }, 30_000);

    it("S4: der Job-Prozess stirbt mitten im Lauf (SIGKILL): zurück in die Queue, der zweite Lauf ist erfolgreich", async () => {
        const worker = realWorker();
        const job = await probe({
            phases: [{ ms: 100 }, { ms: 100 }],
            crash: "sigkill",
            crashPhase: 1,
            crashOnAttempts: [1],
        });
        const { row: done, ergebnisse } = await bisZumEnde(worker, job.id);
        expect(ergebnisse).toEqual([
            { ergebnis: "erledigt", state: "QUEUED" },
            { ergebnis: "erledigt", state: "SUCCEEDED" },
        ]);
        expect(done).toMatchObject({ state: "SUCCEEDED", attempt: 2, leaseNo: 2 });
        const kinds = (await readEvents(database, 0, 100)).map((event) => event.kind);
        expect(kinds).toContain("job.requeued");
    }, 30_000);

    it("ein Job, der immer abstürzt, ist nach drei Läufen FAILED mit process_died", async () => {
        const worker = realWorker();
        const job = await probe({ crash: "exit" });
        const { row: done } = await bisZumEnde(worker, job.id);
        expect(done).toMatchObject({ state: "FAILED", errorCode: "process_died", attempt: 3 });
        expect(done.errorSummary).toContain("Exit 42");
    }, 45_000);

    it("ein Fehler im Handler ist nicht wiederholbar: sofort FAILED, Klartext ohne Pfad und Stacktrace", async () => {
        const worker = realWorker();
        const job = await probe({ crash: "throw" });
        const { row: done } = await bisZumEnde(worker, job.id);
        expect(done).toMatchObject({ state: "FAILED", errorCode: "job_error", attempt: 1 });
        expect(done.errorSummary).toBe("Probe: gewollter Absturz");
    }, 30_000);

    it("Abbruch zwischen den Phasen: der Job-Prozess prüft an der Grenze und endet, die laufende Phase wird nie zerschnitten", async () => {
        const worker = realWorker();
        const job = await probe({
            phases: [
                { name: "a", ms: 700 },
                { name: "b", ms: 700 },
                { name: "c", ms: 700 },
            ],
        });
        const running = worker.runOne(job.id);
        await waitFor(async () => (await getJobById(database, job.id))?.phase === "a");
        await cancelJob(database, { id: job.id }, "operator");
        expect(await running).toEqual({ ergebnis: "erledigt", state: "CANCELLED" });
        const done = await terminal(job.id);
        expect(done).toMatchObject({ state: "CANCELLED", cancelReason: "operator" });
        // Es ist an der Grenze nach "a" stehengeblieben, nicht in "c".
        expect(done.phase).not.toBe("c");
        expect(Object.keys(done.phaseStats)).not.toContain("b");
    }, 30_000);

    it("🔴 der Heartbeat kommt vom AUFSEHER: ein blockierter Hauptthread des Jobs lässt die Lease nicht ablaufen", async () => {
        // Lease 1 s; der Job blockiert seinen Hauptthread 2,5 s lang. Hinge der Heartbeat am Job, wäre die Lease abgelaufen.
        const worker = realWorker({
            config: testJobsConfig({
                heartbeatS: { value: 0.1 },
                leaseS: { value: { default: 1 } },
                memExpectedMb: { value: { probe_base: 120 } },
            }),
        });
        const job = await probe({ blockMs: 2500, sleepMs: 50 });
        const running = worker.runOne(job.id);
        await waitFor(async () => (await getJobById(database, job.id))?.state === "RUNNING");
        const beats: number[] = [];
        for (let index = 0; index < 10; index += 1) {
            await sleep(200);
            const row = await getJobById(database, job.id);
            if (row?.state === "RUNNING" && row.heartbeatAt) {
                beats.push(row.heartbeatAt.getTime());
                // nie abgelaufen
                expect(row.leaseExpiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now() - 50);
            }
        }
        expect(new Set(beats).size).toBeGreaterThan(3);
        expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
        const done = await terminal(job.id);
        expect(done).toMatchObject({ state: "SUCCEEDED", attempt: 1 });
    }, 30_000);

    it("🔴 zwei Ausführer mit echten Prozessen für dieselben Aufträge: jeder Job läuft genau einmal", async () => {
        const deriveScope = uniqueScope("derive");
        const first = realWorker({ deriveScope, instanceId: "a" });
        const second = realWorker({ deriveScope, instanceId: "b" });
        const jobs = await Promise.all([1, 2, 3].map((index) => probe({ sleepMs: 100 }, { scopeTiles: [index] })));
        const ergebnisse = await Promise.all(jobs.flatMap((job) => [first.runOne(job.id), second.runOne(job.id)]));
        const rows = await Promise.all(jobs.map((job) => terminal(job.id)));
        expect(rows.every((row) => row.state === "SUCCEEDED" && row.attempt === 1)).toBe(true);
        expect(ergebnisse.filter((ergebnis) => ergebnis.ergebnis === "erledigt")).toHaveLength(3);
        expect(ergebnisse.filter((ergebnis) => ergebnis.ergebnis === "nichts_zu_tun")).toHaveLength(3);
    }, 30_000);

    it("🔴 stirbt der Aufseher, schließt sich der Kanal und der Job-Prozess beendet sich selbst (Elternwächter)", async () => {
        const childFile = fileURLToPath(
            new URL(`../src/jobs/child${extname(fileURLToPath(import.meta.url))}`, import.meta.url),
        );
        const proc = spawn(process.execPath, ["--expose-gc", childFile], {
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
        // Er rechnet gerade (lange Probe) ...
        proc.send({
            type: "run",
            job: { id: 1, publicId: "x", kind: "probe", kindVersion: 1, input: { sleepMs: 30_000 }, attempt: 1 },
        });
        await sleep(400);
        expect(proc.exitCode).toBeNull();
        // ... und sein Aufseher verschwindet: der Kanal schließt.
        proc.disconnect();
        const code = await Promise.race([exited, sleep(5000).then(() => "zu spät" as const)]);
        expect(code).toBe(3);
    }, 30_000);
});
