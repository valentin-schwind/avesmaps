import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { DeriveBusyError, withDeriveLock } from "../src/derive/derive-lock.ts";
import { JobWorker, type AuftragErgebnis, type JobWorkerOptions } from "../src/jobs/worker.ts";
import { cancelJob, completeJob, getJobById, insertJob, readEvents, recoverExpired } from "../src/jobs/store.ts";
import { fakeMemory, fakeSpawner, sleep, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Der Ausführer eines Auftrags (JOBS-0001 4.1, 4.6, 4.8; WI-0163 §5.2) gegen echtes PostgreSQL, mit gesteuerten Job-Prozessen:
 * Übernahme, Heartbeat, Wiederholung, Abbruch, Fencing, geteilte Sperre, Ablösen. Der echte Prozess mit Speicherballast steht in
 * `jobs-worker-process.test.ts`, der Befehl mit seinen Exitcodes in `jobs-auftrag.test.ts`. Was als Nächstes startet (Zulassung,
 * Reihenfolge, Wartegründe), entscheidet der Dirigent und wird dort geprüft.
 *
 * 🔴 Eigene Advisory-Lock-Schlüssel je Test: Advisory Locks gelten je Datenbank, und die Testdatenbank teilen sich mehrere
 * Sitzungen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Ausführer", { timeout: 45_000 }, () => {
    let database: Database;
    const DOMAIN = "aventuria";
    const workers: JobWorker[] = [];
    const runs: Promise<unknown>[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 8 });
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
        await Promise.allSettled(runs.splice(0));
    });

    interface Fixture {
        worker: JobWorker;
        spawner: ReturnType<typeof fakeSpawner>;
        memory: ReturnType<typeof fakeMemory>;
        deriveScope: string;
    }

    function worker(
        overrides: Partial<JobWorkerOptions> & { config?: JobWorkerOptions["config"] } = {},
        shared?: Pick<Fixture, "deriveScope">,
    ): Fixture {
        const spawner = fakeSpawner();
        const memory = fakeMemory();
        const deriveScope = shared?.deriveScope ?? uniqueScope("derive");
        const instance = new JobWorker({
            database,
            config: testJobsConfig(),
            mapDomainId: DOMAIN,
            deriveScope,
            spawnChild: spawner.spawn,
            memory: memory.probe,
            killGraceMs: 50,
            stopGraceMs: 200,
            ...overrides,
        });
        workers.push(instance);
        return { worker: instance, spawner, memory, deriveScope };
    }

    /** Startet `runOne` im Hintergrund; der Test steuert den Job-Prozess und wartet dann auf das Ergebnis. */
    function run(fixture: Fixture, id: number, options: { art?: string } = {}): Promise<AuftragErgebnis> {
        const pending = fixture.worker.runOne(id, options);
        runs.push(pending);
        return pending;
    }

    const add = (extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, { kind: "probe", mapDomainId: DOMAIN, scopeKind: "tiles", scopeTiles: [], ...extra });

    const done = { type: "done", result: null, cpuMs: 1, rssPeakMb: 1, arrayBufferPeakMb: 1 } as const;

    describe("Was der Ausführer annimmt", () => {
        it("🔴 nichts zu tun bei fremdem Zustand: läuft schon, ist fertig, ist aufgezeichnet oder fehlt; kein Job-Prozess", async () => {
            const fixture = worker();
            const running = await add();
            await database`UPDATE job SET state = 'RUNNING', lease_no = 1, lease_owner = 'anderer', lease_expires_at = now() + interval '1 minute' WHERE id = ${running.id}`;
            const finished = await add();
            await database`UPDATE job SET state = 'SUCCEEDED', finished_at = now() WHERE id = ${finished.id}`;
            const recorded = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "zug",
                leaseS: 300,
            });
            expect(await fixture.worker.runOne(running.id)).toEqual({ ergebnis: "nichts_zu_tun", grund: "not_queued" });
            expect(await fixture.worker.runOne(finished.id)).toEqual({
                ergebnis: "nichts_zu_tun",
                grund: "not_queued",
            });
            expect(await fixture.worker.runOne(recorded.id)).toEqual({
                ergebnis: "nichts_zu_tun",
                grund: "not_queued",
            });
            expect(await fixture.worker.runOne(987_654_321)).toEqual({ ergebnis: "nichts_zu_tun", grund: "not_found" });
            expect(fixture.spawner.children).toHaveLength(0);
            expect(await getJobById(database, running.id)).toMatchObject({ leaseOwner: "anderer", leaseNo: 1 });
        });

        it("🔴 eine Art oder Fassung, die dieser Stand nicht kennt, fehlt hier und bleibt unberührt (Blue/Green)", async () => {
            const fixture = worker();
            const foreign = await add({ kind: "jobart_von_morgen" });
            const newer = await add({ kindVersion: 2 });
            expect(await fixture.worker.runOne(foreign.id)).toEqual({
                ergebnis: "ausfuehrung_fehlt",
                grund: "unknown_kind",
            });
            expect(await fixture.worker.runOne(newer.id)).toEqual({
                ergebnis: "ausfuehrung_fehlt",
                grund: "unknown_kind",
            });
            expect(fixture.spawner.children).toHaveLength(0);
            for (const job of [foreign, newer]) {
                expect(await getJobById(database, job.id)).toMatchObject({
                    state: "QUEUED",
                    waitReason: null,
                    attempt: 0,
                });
            }
        });

        it("Ausführung fehlt auch: die Art weicht von `--art` ab, nur der Korridor kann sie rechnen, oder diese Umgebung schließt sie aus", async () => {
            const fixture = worker({ ausgeschlosseneArten: new Set(["legacy_media"]) });
            const probe = await add();
            const production = await add({ kind: "production_pull" });
            const media = await add({ kind: "legacy_media" });
            expect(await fixture.worker.runOne(probe.id, { art: "media_derive" })).toEqual({
                ergebnis: "ausfuehrung_fehlt",
                grund: "kind_mismatch",
            });
            expect(await fixture.worker.runOne(production.id)).toEqual({
                ergebnis: "ausfuehrung_fehlt",
                grund: "no_handler",
            });
            expect(await fixture.worker.runOne(media.id)).toEqual({
                ergebnis: "ausfuehrung_fehlt",
                grund: "excluded_kind",
            });
            expect(fixture.spawner.children).toHaveLength(0);
            expect((await getJobById(database, probe.id))?.state).toBe("QUEUED");
        });

        it("🔴 zwei Ausführer für denselben Auftrag: nur einer übernimmt, für den anderen ist nichts zu tun", async () => {
            const first = worker({ instanceId: "a" });
            const second = worker({ instanceId: "b" });
            const job = await add();
            const running = run(first, job.id);
            await waitFor(() => first.spawner.children[0]);
            expect(await second.worker.runOne(job.id)).toEqual({ ergebnis: "nichts_zu_tun", grund: "not_queued" });
            expect(second.spawner.children).toHaveLength(0);
            first.spawner.children[0]?.emit(done);
            expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
            expect((await getJobById(database, job.id))?.leaseOwner).toBe("a");
        });
    });

    describe("Lauf eines Jobs", () => {
        it("claimt, startet den Job-Prozess mit der Eingabe, meldet Phase und Ergebnis und gibt die geteilte Sperre zurück", async () => {
            const fixture = worker();
            const job = await add({ inputRef: { sleepMs: 5, ballastMb: 0 } });
            const running = run(fixture, job.id, { art: "probe" });
            const child = await waitFor(() => fixture.spawner.children[0]);
            expect(child.run).toMatchObject({
                job: { id: job.id, kind: "probe", attempt: 1, input: { sleepMs: 5, ballastMb: 0 } },
            });
            expect(await getJobById(database, job.id)).toMatchObject({
                state: "RUNNING",
                leaseOwner: fixture.worker.id,
                leaseNo: 1,
                memExpectedMb: 40,
            });

            child.emit({ type: "phase", phase: "sleep", progress: 0.5, finished: null });
            await waitFor(async () => (await getJobById(database, job.id))?.phase === "sleep");
            child.emit({ type: "done", result: { phases: 1 }, cpuMs: 12, rssPeakMb: 80, arrayBufferPeakMb: 3 });
            expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
            const row = await getJobById(database, job.id);
            expect(row).toMatchObject({ result: { phases: 1 }, cpuMs: 12, rssPeakMb: 80, arrayBufferPeakMb: 3 });
            expect(row?.wallMs).toBeGreaterThanOrEqual(0);
            expect(fixture.worker.activeCount()).toBe(0);
            // 🔴 Die geteilte Sperre ist zurück: ein Zug (exklusiv) bekommt sie wieder.
            await expect(withDeriveLock(database, fixture.deriveScope, "Zug", async () => "frei")).resolves.toBe(
                "frei",
            );
        });

        it("der Heartbeat des Aufsehers verlängert die Lease und trägt die Spitzen aus der Selbstmeldung ein", async () => {
            const fixture = worker();
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            const first = (await getJobById(database, job.id))?.leaseExpiresAt?.getTime() ?? 0;
            child.emit({ type: "usage", rssMb: 150, rssPeakMb: 170, arrayBufferMb: 20, cpuMs: 300 });
            const row = await waitFor(async () => {
                const current = await getJobById(database, job.id);
                return (current?.rssPeakMb ?? 0) >= 170 ? current : undefined;
            });
            expect(row).toMatchObject({ rssPeakMb: 170, arrayBufferPeakMb: 20, cpuMs: 300 });
            expect(row.leaseExpiresAt?.getTime() ?? 0).toBeGreaterThan(first);
            expect(row.heartbeatAt).not.toBeNull();
            child.emit(done);
            await running;
        });

        it("ein Fehler des Job-Prozesses: nicht wiederholbar -> FAILED mit Klartext", async () => {
            const fixture = worker();
            const job = await add();
            const running = run(fixture, job.id);
            (await waitFor(() => fixture.spawner.children[0])).emit({
                type: "error",
                code: "input_invalid",
                summary: "Eingabe kaputt",
                retryable: false,
            });
            expect(await running).toEqual({ ergebnis: "erledigt", state: "FAILED" });
            expect(await getJobById(database, job.id)).toMatchObject({
                errorCode: "input_invalid",
                errorSummary: "Eingabe kaputt",
            });
        });

        it("S4: ein Job-Prozess, der ohne Meldung stirbt, geht zurück in die Queue; der nächste Ausführer wiederholt, nach drei Läufen FAILED", async () => {
            const fixture = worker();
            const job = await add();
            for (const attempt of [1, 2, 3]) {
                const running = run(fixture, job.id);
                const child = await waitFor(() => fixture.spawner.children[attempt - 1]);
                expect(child.run?.job.attempt).toBe(attempt);
                child.die(137, "SIGKILL");
                const expected = attempt < 3 ? "QUEUED" : "FAILED";
                expect(await running).toEqual({ ergebnis: "erledigt", state: expected });
                expect((await getJobById(database, job.id))?.errorCode).toBe("process_died");
            }
            expect(fixture.spawner.children).toHaveLength(3);
            const kinds = (await readEvents(database, 0, 50))
                .map((event) => event.kind)
                .filter((kind) => kind !== "job.started");
            expect(kinds).toEqual(["job.queued", "job.requeued", "job.requeued", "job.failed"]);
        });

        it("Abbruch: der Heartbeat meldet die Anforderung, der Job-Prozess bestätigt an der Phasengrenze", async () => {
            const fixture = worker();
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            await cancelJob(database, { id: job.id }, "owner");
            await waitFor(() => child.received("cancel"));
            expect((await getJobById(database, job.id))?.state).toBe("RUNNING");
            child.emit({ type: "cancelled" });
            expect(await running).toEqual({ ergebnis: "erledigt", state: "CANCELLED" });
            expect((await getJobById(database, job.id))?.cancelReason).toBe("owner");
        });

        it("Fencing: nach Lease-Ablauf sammelt die Pflege ein, ein neuer Ausführer übernimmt; das Ergebnis des alten wird verworfen", async () => {
            const old = worker({ heartbeatMs: 60_000, instanceId: "alt" });
            const job = await add();
            const oldRun = run(old, job.id);
            const oldChild = await waitFor(() => old.spawner.children[0]);
            await database`UPDATE job SET lease_expires_at = now() - interval '1 second' WHERE id = ${job.id}`;
            // Die Pflege (ein anderer Prozess) sammelt ein, der Dirigent startet den Auftrag neu.
            expect((await worker().worker.pflege()).recovered).toBe(1);
            const fresh = worker({ instanceId: "neu" });
            const freshRun = run(fresh, job.id);
            await waitFor(() => fresh.spawner.children[0]);
            expect(await getJobById(database, job.id)).toMatchObject({
                state: "RUNNING",
                leaseNo: 2,
                attempt: 2,
                leaseOwner: "neu",
            });
            // Der alte Prozess meldet sich noch: Sein Ergebnis wird verworfen, die Zeile bleibt die des neuen Laufs.
            oldChild.emit({ type: "done", result: { alt: true }, cpuMs: 1, rssPeakMb: 1, arrayBufferPeakMb: 1 });
            expect(await oldRun).toEqual({ ergebnis: "erledigt", state: "RUNNING" });
            expect(await getJobById(database, job.id)).toMatchObject({ state: "RUNNING", leaseNo: 2, result: null });
            fresh.spawner.children[0]?.emit(done);
            expect(await freshRun).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
        });

        it("🔴 ein Job, der sich in der Transaktion seiner Veröffentlichung selbst abschließt, bekommt nur die Messung nachgetragen (WI-0125)", async () => {
            // Ein kurzer Heartbeat: Er findet die Zeile schon `SUCCEEDED`, bevor `done` kommt, und darf den Prozess nicht beenden.
            const fixture = worker({ heartbeatMs: 40 });
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            // Der Lauf kennt seine Lease und seine Domäne (für das Fencing seiner Veröffentlichung).
            expect(child.run?.job).toMatchObject({ leaseNo: 1, mapDomainId: DOMAIN });
            // Der Job-Prozess schließt selbst ab (wie `dem_publish` mit `completeJob` und `publish`) ...
            expect(await completeJob(database, job.id, 1, { result: { revision: "a" } }, async () => undefined)).toBe(
                "ok",
            );
            // Der Prozess räumt noch auf; der Heartbeat sieht die fertige Zeile und lässt ihn gewähren.
            await sleep(200);
            expect(child.killed).toEqual([]);
            // ... und meldet `committed`: Der Aufseher wechselt keinen Zustand mehr, er trägt nur die Messung nach.
            child.emit({
                type: "done",
                result: { revision: "a" },
                committed: true,
                cpuMs: 7,
                rssPeakMb: 90,
                arrayBufferPeakMb: 2,
            });
            expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
            expect(await getJobById(database, job.id)).toMatchObject({
                state: "SUCCEEDED",
                result: { revision: "a" },
                rssPeakMb: 90,
                cpuMs: 7,
            });
            const events = await database<
                { kind: string }[]
            >`SELECT kind FROM job_event WHERE job_id = ${job.id} ORDER BY seq`;
            expect(events.map((event) => event.kind).filter((kind) => kind === "job.succeeded")).toHaveLength(1);
            expect(fixture.worker.activeCount()).toBe(0);
        });

        it("ein Job, dessen Lease ein ANDERER eingesammelt hat, schreibt nichts mehr (Heartbeat fenced)", async () => {
            const fixture = worker({ heartbeatMs: 40 });
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            // Die Pflege sammelt ein (Lease abgelaufen) und reiht neu ein.
            await database`UPDATE job SET lease_expires_at = now() - interval '1 second' WHERE id = ${job.id}`;
            await recoverExpired(database);
            // Der nächste Heartbeat unseres Läufers wird abgewiesen: er beendet seinen Prozess und schreibt nichts.
            await waitFor(() => (child.killed.length ? true : undefined));
            expect(child.killed).toContain("SIGKILL");
            expect(await running).toEqual({ ergebnis: "erledigt", state: "QUEUED" });
            expect(fixture.worker.activeCount()).toBe(0);
        });

        it("Befunde melden, sie halten nie an: Swap über dem Rauschen und Spitze über der Erwartung, der Job läuft weiter und endet SUCCEEDED", async () => {
            const fixture = worker();
            // Vor dem Start schon eingelagert: Das zählt nicht, nur was während des Auftrags dazukommt (MS9, Claudio 2026-10-19).
            fixture.memory.set({ swapUsedMb: 1400, swapInMb: 500 });
            const job = await add({ inputRef: { ballastMb: 10 } });
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            expect((await getJobById(database, job.id))?.memExpectedMb).toBe(50);
            fixture.memory.set({ swapUsedMb: 1400, swapInMb: 524 });
            child.emit({ type: "usage", rssMb: 900, rssPeakMb: 900, arrayBufferMb: 1, cpuMs: 1 });
            const row = await waitFor(async () => {
                const current = await getJobById(database, job.id);
                return (current?.findings.length ?? 0) >= 2 ? current : undefined;
            });
            expect(row.state).toBe("RUNNING");
            expect(row.findings.map((finding) => finding.code).sort()).toEqual(["budget_exceeded", "swap_in_use"]);
            expect(row.findings.find((finding) => finding.code === "swap_in_use")?.detail).toContain("24 MB");
            expect(child.killed).toEqual([]);
            child.emit({ type: "done", result: null, cpuMs: 1, rssPeakMb: 900, arrayBufferPeakMb: 1 });
            expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
        });
    });

    describe("Sperre der Domäne: geteilt gegen exklusiv", () => {
        it("🔴 Ein Zug (exklusiv) hält die Sperre: vorübergehend nicht, der Job wartet mit waits_domain_lock; danach läuft er", async () => {
            const fixture = worker();
            const job = await add();
            let release: () => void = () => undefined;
            const holding = new Promise<void>((resolve) => {
                release = resolve;
            });
            let acquired: () => void = () => undefined;
            const gotIt = new Promise<void>((resolve) => {
                acquired = resolve;
            });
            const zug = withDeriveLock(database, fixture.deriveScope, "Zug", async () => {
                acquired();
                await holding;
            });
            await gotIt;
            expect(await fixture.worker.runOne(job.id)).toEqual({
                ergebnis: "voruebergehend",
                grund: "waits_domain_lock",
            });
            expect(await getJobById(database, job.id)).toMatchObject({
                state: "QUEUED",
                waitReason: "waits_domain_lock",
                attempt: 0,
            });
            expect(fixture.spawner.children).toHaveLength(0);
            release();
            await zug;
            const running = run(fixture, job.id);
            await waitFor(() => fixture.spawner.children[0]);
            expect(await getJobById(database, job.id)).toMatchObject({ state: "RUNNING", waitReason: null });
            fixture.spawner.children[0]?.emit(done);
            await running;
        });

        it("🔴 Läuft ein Job der Queue (geteilt), bricht ein Zug (exklusiv) sofort ab, wie heute; zwei Ausführer teilen die Sperre", async () => {
            const first = worker();
            const second = worker({}, first);
            const a = await add({ scopeTiles: [1] });
            const b = await add({ scopeTiles: [2] });
            const runA = run(first, a.id);
            const runB = run(second, b.id);
            await waitFor(() => first.spawner.children[0]);
            await waitFor(() => second.spawner.children[0]);
            await expect(
                withDeriveLock(database, first.deriveScope, "derive:terrain", async () => "gerechnet"),
            ).rejects.toBeInstanceOf(DeriveBusyError);
            // Ein Job endet: die Sperre bleibt, solange der andere läuft, und ist erst nach dem letzten frei.
            first.spawner.children[0]?.emit(done);
            await runA;
            await expect(
                withDeriveLock(database, first.deriveScope, "derive:terrain", async () => "gerechnet"),
            ).rejects.toBeInstanceOf(DeriveBusyError);
            second.spawner.children[0]?.emit(done);
            await runB;
            await expect(
                withDeriveLock(database, first.deriveScope, "derive:terrain", async () => "gerechnet"),
            ).resolves.toBe("gerechnet");
        });
    });

    describe("Ablösen (SIGTERM): drain und Rückgabe", () => {
        it("stop: der laufende Job hält an der Phasengrenze an und geht OHNE Versuchszähler zurück (handed_off); danach kein Claim mehr", async () => {
            const fixture = worker();
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            const stopping = fixture.worker.stop(60);
            expect(fixture.worker.isDraining()).toBe(true);
            // nach `drainMaxS` bekommt der Job-Prozess die Aufforderung anzuhalten
            await waitFor(() => child.received("stop"));
            child.emit({ type: "stopped" });
            await stopping;
            expect(await running).toEqual({ ergebnis: "erledigt", state: "QUEUED" });
            expect(await getJobById(database, job.id)).toMatchObject({ state: "QUEUED", attempt: 0, leaseOwner: null });
            expect((await readEvents(database, 0, 50)).map((event) => event.kind)).toContain("job.handed_off");
            // Der abgelöste Ausführer übernimmt nichts mehr; ein neuer holt den Job.
            expect(await fixture.worker.runOne(job.id)).toEqual({ ergebnis: "nichts_zu_tun", grund: "draining" });
            const next = worker({ instanceId: "neu" });
            const again = run(next, job.id);
            await waitFor(() => next.spawner.children[0]);
            expect(await getJobById(database, job.id)).toMatchObject({ state: "RUNNING", attempt: 1 });
            next.spawner.children[0]?.emit(done);
            await again;
        });

        it("ein Job, der innerhalb der Frist fertig wird, läuft zu Ende (kein Abbruch durch das Ablösen)", async () => {
            const fixture = worker();
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            const stopping = fixture.worker.stop(2000);
            await sleep(50);
            child.emit({ type: "done", result: { ok: true }, cpuMs: 1, rssPeakMb: 1, arrayBufferPeakMb: 1 });
            await stopping;
            expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
            expect(await getJobById(database, job.id)).toMatchObject({ state: "SUCCEEDED", result: { ok: true } });
            expect(child.received("stop")).toBe(false);
        });

        it("ein Job-Prozess, der an der Grenze nicht anhält, wird beendet; die Zeile geht trotzdem zurück", async () => {
            const fixture = worker({ stopGraceMs: 50 });
            const job = await add();
            const running = run(fixture, job.id);
            const child = await waitFor(() => fixture.spawner.children[0]);
            await fixture.worker.stop(10);
            expect(child.killed).toContain("SIGKILL");
            expect(await running).toEqual({ ergebnis: "erledigt", state: "QUEUED" });
            expect(await getJobById(database, job.id)).toMatchObject({ state: "QUEUED", attempt: 0 });
        });
    });
});
