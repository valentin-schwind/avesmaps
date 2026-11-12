import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    addJobFinding,
    cancelJob,
    claimJob,
    completeJob,
    failJob,
    finishCancelled,
    getJobById,
    getJobByPublicId,
    handOffJob,
    heartbeatJob,
    insertJob,
    isRolloutActive,
    latestSeq,
    listFinished,
    listQueued,
    loadPendingDependencies,
    loadRssP95History,
    loadWallMsHistory,
    pruneJobs,
    readEvents,
    recoverExpired,
    setJobPhase,
    setWaitReasons,
} from "../src/jobs/store.ts";
import { countActive, recordFinish, recordHeartbeat, recordPhase } from "../src/jobs/store-record.ts";

/**
 * Die Zustandsmaschine gegen echtes PostgreSQL (JOBS-0001 4.3, 4.6, 11.64): Übergänge, Lease, Fencing, Wiederholung, Abbruch,
 * Abhängigkeiten als Baum, Ereignisse, die Tür der App-Rolle und die Sicht für Claudio.
 *
 * Die Tabellen `job*` gehören diesem Test; andere Tests lesen sie nicht. Advisory Locks stehen nicht im Spiel (das macht
 * `jobs-worker.test.ts` mit eigenen Schlüsseln).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Queue: Zustandsmaschine", { timeout: 45_000 }, () => {
    let database: Database;
    const DOMAIN = "aventuria";

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
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

    const add = (extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, { kind: "probe", mapDomainId: DOMAIN, ...extra });

    /** Lässt die Lease eines Jobs ablaufen, ohne zu warten. */
    const expireLease = async (id: number) => {
        await database`UPDATE job SET lease_expires_at = now() - interval '1 second' WHERE id = ${id}`;
    };

    describe("Anlegen und Zustände", () => {
        it("ein neuer Job ist QUEUED mit Voreinstellungen und schreibt sein Ereignis in derselben Transaktion", async () => {
            const { id, publicId, created } = await add({ label: "Test", inputRef: { sleepMs: 5 } });
            expect(created).toBe(true);
            const job = await getJobById(database, id);
            expect(job).toMatchObject({
                publicId,
                kind: "probe",
                kindVersion: 1,
                origin: "queued",
                state: "QUEUED",
                priority: 50,
                attempt: 0,
                leaseNo: 0,
                leaseOwner: null,
                scopeKind: "domain",
                label: "Test",
                inputRef: { sleepMs: 5 },
                dependsOn: [],
            });
            const events = await readEvents(database, 0, 10);
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                kind: "job.queued",
                jobId: publicId,
                payload: { state: "QUEUED", jobKind: "probe" },
            });
        });

        it("nur fünf Zustände sind erlaubt, „hängt“ ist keiner (Kap. 11.64)", async () => {
            const { id } = await add();
            await expect(database`UPDATE job SET state = 'STALLED' WHERE id = ${id}`).rejects.toThrow(
                /job_state_check/,
            );
        });

        it("RUNNING braucht eine Lease, ein beendeter Job braucht `finished_at`", async () => {
            const { id } = await add();
            await expect(database`UPDATE job SET state = 'RUNNING' WHERE id = ${id}`).rejects.toThrow(
                /job_running_has_lease/,
            );
            await expect(database`UPDATE job SET state = 'SUCCEEDED' WHERE id = ${id}`).rejects.toThrow(
                /job_finished_iff_terminal/,
            );
        });

        it("QUEUED -> RUNNING: Claim mit neuer lease_no, nur einmal", async () => {
            const { id } = await add();
            const claimed = await claimJob(database, id, "worker-a", 60, 100);
            expect(claimed).toMatchObject({
                state: "RUNNING",
                leaseNo: 1,
                attempt: 1,
                leaseOwner: "worker-a",
                memExpectedMb: 100,
            });
            expect(claimed?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 50_000);
            // 🔴 Ein zweiter Claim desselben Jobs gewinnt nie.
            expect(await claimJob(database, id, "worker-b", 60)).toBeNull();
            expect((await getJobById(database, id))?.leaseOwner).toBe("worker-a");
        });

        it("RUNNING -> SUCCEEDED: Ergebnis, Messung, Ereignis", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            expect(
                await completeJob(database, id, 1, {
                    result: { unchanged: true },
                    wallMs: 1234,
                    rssPeakMb: 321,
                    cpuMs: 99,
                }),
            ).toBe("ok");
            const job = await getJobById(database, id);
            expect(job).toMatchObject({
                state: "SUCCEEDED",
                wallMs: 1234,
                rssPeakMb: 321,
                cpuMs: 99,
                result: { unchanged: true },
                progress: 1,
            });
            expect(job?.finishedAt).not.toBeNull();
            const kinds = (await readEvents(database, 0, 20)).map((event) => event.kind);
            expect(kinds).toEqual(["job.queued", "job.started", "job.succeeded"]);
        });

        it("ein Ereignis nur beim Wechsel der Phase, der Fortschritt allein schreibt keines", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            expect(await setJobPhase(database, id, 1, { phase: "I11", progress: 0.1 })).toBe(true);
            expect(await setJobPhase(database, id, 1, { phase: "I11", progress: 0.5 })).toBe(true);
            expect(
                await setJobPhase(database, id, 1, {
                    phase: "I13",
                    progress: 0,
                    finished: { name: "I11", wallMs: 4000, rssPeakMb: 900, cpuMs: 3500 },
                }),
            ).toBe(true);
            const phases = (await readEvents(database, 0, 20)).filter((event) => event.kind === "job.phase");
            expect(phases.map((event) => event.payload["phase"])).toEqual(["I11", "I13"]);
            const job = await getJobById(database, id);
            expect(job?.phase).toBe("I13");
            expect(job?.phaseStats).toEqual({ I11: { wallMs: 4000, rssPeakMb: 900, cpuMs: 3500 } });
        });

        it("🔴 WI-0248: eine gemeldete Restzeit wird das erwartete Ende (eta_at); ohne Angabe bleibt es, `null` löscht es", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            const vorher = Date.now();
            expect(await setJobPhase(database, id, 1, { phase: "tests", progress: 0.4, restMs: 3_600_000 })).toBe(true);
            const mit = await getJobById(database, id);
            const eta = mit?.etaAt?.getTime() ?? 0;
            expect(eta).toBeGreaterThanOrEqual(vorher + 3_600_000 - 5_000);
            expect(eta).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5_000);
            // Ein Auftrag, der keine Restzeit meldet (jede andere Art), fasst die Spalte nicht an.
            await setJobPhase(database, id, 1, { phase: "tests", progress: 0.5 });
            expect((await getJobById(database, id))?.etaAt?.getTime()).toBe(eta);
            await setJobPhase(database, id, 1, { phase: "bau", progress: 0.6, restMs: null });
            expect((await getJobById(database, id))?.etaAt ?? null).toBeNull();
        });
    });

    describe("Heartbeat und Lease", () => {
        it("der Heartbeat verlängert die Lease und trägt die Spitzen ein (nur nach oben)", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 5);
            const before = (await getJobById(database, id))?.leaseExpiresAt?.getTime() ?? 0;
            const result = await heartbeatJob(database, id, 1, 60, {
                rssMb: 500,
                arrayBufferMb: 100,
                cpuMs: 10,
                swapUsedMb: 2,
            });
            expect(result).toEqual({ ok: true, cancelRequested: false });
            await heartbeatJob(database, id, 1, 60, { rssMb: 400 });
            const job = await getJobById(database, id);
            expect(job?.leaseExpiresAt?.getTime()).toBeGreaterThan(before + 40_000);
            expect(job).toMatchObject({ rssPeakMb: 500, arrayBufferPeakMb: 100, swapSeenMb: 2, cpuMs: 10 });
        });

        it("Heartbeats schreiben nie in die Ereignistabelle (Kap. 7.38)", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            const before = await latestSeq(database);
            for (let index = 0; index < 5; index += 1) await heartbeatJob(database, id, 1, 60, { rssMb: 100 + index });
            expect(await latestSeq(database)).toBe(before);
        });

        it("🔴 Fencing: ein Heartbeat mit alter lease_no wird abgewiesen", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            expect(await heartbeatJob(database, id, 99, 60)).toEqual({ ok: false });
        });

        it("hängt: RUNNING mit abgelaufener Lease, abgeleitet und nie gespeichert", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await expireLease(id);
            const job = await getJobById(database, id);
            expect(job?.state).toBe("RUNNING");
            const [health] = await database<
                { running: string; stalled: string }[]
            >`SELECT running::text, stalled::text FROM job_health WHERE kind = 'probe'`;
            expect(health).toEqual({ running: "0", stalled: "1" });
        });
    });

    describe("Fencing: kein Job mit abgelaufener Lease veröffentlicht etwas (K1)", () => {
        it("S4/K1: Lease abgelaufen, neu geholt: das Ergebnis des alten Läufers wird verworfen, `publish` läuft nie", async () => {
            const { id } = await add();
            await claimJob(database, id, "alt", 60);
            await expireLease(id);
            const recovered = await recoverExpired(database);
            expect(recovered).toMatchObject([{ id, outcome: "requeued", leaseOwner: "alt" }]);
            const second = await claimJob(database, id, "neu", 60);
            expect(second).toMatchObject({ leaseNo: 2, attempt: 2, leaseOwner: "neu" });

            let published = 0;
            const late = await completeJob(database, id, 1, { result: { alt: true } }, async () => {
                published += 1;
            });
            expect(late).toBe("fenced");
            expect(published).toBe(0);
            expect(await heartbeatJob(database, id, 1, 60)).toEqual({ ok: false });
            expect(await failJob(database, id, 1, { code: "x", summary: "x", retryable: false })).toBe("fenced");
            expect((await getJobById(database, id))?.state).toBe("RUNNING");

            let publishedNew = 0;
            expect(
                await completeJob(database, id, 2, { result: { neu: true } }, async () => {
                    publishedNew += 1;
                }),
            ).toBe("ok");
            expect(publishedNew).toBe(1);
            expect((await getJobById(database, id))?.result).toEqual({ neu: true });
        });

        it("die Veröffentlichung und der Wechsel des Zustands sind EINE Transaktion: wirft `publish`, bleibt der Job RUNNING", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await expect(
                completeJob(database, id, 1, {}, async () => {
                    throw new Error("Zeiger nicht schreibbar");
                }),
            ).rejects.toThrow("Zeiger nicht schreibbar");
            expect((await getJobById(database, id))?.state).toBe("RUNNING");
        });

        it("die Veröffentlichung sperrt die Jobzeile: eine gleichzeitige Wiederaufnahme wartet nicht darauf, sondern überspringt sie", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await expireLease(id);
            let recoveredWhilePublishing: number | undefined;
            const done = completeJob(database, id, 1, {}, async () => {
                // Mitten in der Veröffentlichung sammelt ein Planer ein: Die Zeile ist gesperrt (SKIP LOCKED).
                recoveredWhilePublishing = (await recoverExpired(database)).length;
            });
            expect(await done).toBe("ok");
            expect(recoveredWhilePublishing).toBe(0);
            expect((await getJobById(database, id))?.state).toBe("SUCCEEDED");
        });
    });

    describe("Wiederholung: höchstens zwei, also drei Läufe", () => {
        it("Lease-Ablauf: zweimal wieder eingereiht, beim dritten Ablauf FAILED lease_expired_exhausted", async () => {
            const { id } = await add();
            for (const attempt of [1, 2]) {
                const claimed = await claimJob(database, id, "w", 60);
                expect(claimed?.attempt).toBe(attempt);
                await expireLease(id);
                const [action] = await recoverExpired(database);
                expect(action).toMatchObject({ id, outcome: "requeued" });
                expect(await getJobById(database, id)).toMatchObject({ state: "QUEUED", errorCode: "lease_expired" });
            }
            const third = await claimJob(database, id, "w", 60);
            expect(third).toMatchObject({ attempt: 3, leaseNo: 3 });
            await expireLease(id);
            const [last] = await recoverExpired(database);
            expect(last).toMatchObject({ id, outcome: "failed" });
            expect(await getJobById(database, id)).toMatchObject({
                state: "FAILED",
                errorCode: "lease_expired_exhausted",
            });
            const kinds = (await readEvents(database, 0, 50))
                .map((event) => event.kind)
                .filter((kind) => kind !== "job.started");
            expect(kinds).toEqual(["job.queued", "job.requeued", "job.requeued", "job.failed"]);
        });

        it("ein toter Job-Prozess ist wiederholbar, ein Eingabefehler nicht", async () => {
            const dies = await add();
            await claimJob(database, dies.id, "w", 60);
            expect(
                await failJob(database, dies.id, 1, {
                    code: "process_died",
                    summary: "Prozess endete",
                    retryable: true,
                }),
            ).toBe("requeued");
            expect(await getJobById(database, dies.id)).toMatchObject({ state: "QUEUED", errorCode: "process_died" });

            const bad = await add();
            await claimJob(database, bad.id, "w", 60);
            expect(
                await failJob(database, bad.id, 1, {
                    code: "input_invalid",
                    summary: "Eingabe kaputt",
                    retryable: false,
                }),
            ).toBe("failed");
            expect(await getJobById(database, bad.id)).toMatchObject({
                state: "FAILED",
                errorCode: "input_invalid",
                errorSummary: "Eingabe kaputt",
            });
        });

        it("ein wiederholbarer Fehler im dritten Lauf ist endgültig", async () => {
            const { id } = await add();
            for (const attempt of [1, 2, 3]) {
                await claimJob(database, id, "w", 60);
                const outcome = await failJob(database, id, attempt, {
                    code: "process_died",
                    summary: "tot",
                    retryable: true,
                });
                expect(outcome).toBe(attempt < 3 ? "requeued" : "failed");
            }
            expect((await getJobById(database, id))?.state).toBe("FAILED");
        });

        it("Übergabe beim Umschalten: zurück nach QUEUED OHNE den Versuch zu zählen (handed_off)", async () => {
            const { id } = await add();
            await claimJob(database, id, "alt", 60);
            expect(await handOffJob(database, id, 1)).toBe(true);
            expect(await getJobById(database, id)).toMatchObject({ state: "QUEUED", attempt: 0, leaseOwner: null });
            const second = await claimJob(database, id, "neu", 60);
            // lease_no steigt trotzdem (Fencing), der Versuchszähler nicht.
            expect(second).toMatchObject({ attempt: 1, leaseNo: 2 });
            expect((await readEvents(database, 0, 20)).map((event) => event.kind)).toContain("job.handed_off");
        });
    });

    describe("Abbruch (zwischen den Phasen)", () => {
        it("ein wartender Job ist sofort CANCELLED", async () => {
            const { id } = await add();
            expect(await cancelJob(database, { id }, "operator")).toBe("cancelled");
            expect(await getJobById(database, id)).toMatchObject({ state: "CANCELLED", cancelReason: "operator" });
        });

        it("ein laufender Job bekommt eine Anforderung; der Heartbeat meldet sie, der Job-Prozess bestätigt", async () => {
            const { id, publicId } = await add();
            await claimJob(database, id, "w", 60);
            expect(await cancelJob(database, { publicId }, "owner")).toBe("cancel_requested");
            expect(await cancelJob(database, { publicId }, "owner")).toBe("noop");
            expect(await heartbeatJob(database, id, 1, 60)).toEqual({ ok: true, cancelRequested: true });
            expect((await getJobById(database, id))?.state).toBe("RUNNING");
            expect(await finishCancelled(database, id, 1)).toBe(true);
            expect(await getJobById(database, id)).toMatchObject({ state: "CANCELLED", cancelReason: "owner" });
        });

        it("wurde abgebrochen und der Lauf scheitert danach, endet der Job als CANCELLED, nicht als Fehler", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await cancelJob(database, { id });
            expect(await failJob(database, id, 1, { code: "process_died", summary: "tot", retryable: true })).toBe(
                "cancelled",
            );
            expect((await getJobById(database, id))?.state).toBe("CANCELLED");
        });

        it("ein beendeter oder unbekannter Job lässt sich nicht abbrechen", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await completeJob(database, id, 1);
            expect(await cancelJob(database, { id })).toBe("noop");
            expect(await cancelJob(database, { id: 999_999_999 })).toBe("noop");
        });
    });

    describe("Abhängigkeiten als Baum", () => {
        async function tree() {
            const a = await add({ label: "A" });
            const b = await add({ label: "B", dependsOn: [a.id] });
            const c = await add({ label: "C", dependsOn: [a.id] });
            const d = await add({ label: "D", dependsOn: [b.id] });
            return { a, b, c, d };
        }

        it("ein Nachfolger kennt seine Vorgänger; wartend, solange einer nicht fertig ist", async () => {
            const { a, b, c, d } = await tree();
            const queued = await listQueued(database);
            expect(queued.find((job) => job.id === b.id)?.dependsOn).toEqual([a.publicId]);
            const pending = await loadPendingDependencies(database, [a.id, b.id, c.id, d.id]);
            expect([...pending.entries()].sort()).toEqual(
                [
                    [b.id, [a.id]],
                    [c.id, [a.id]],
                    [d.id, [b.id]],
                ].sort(),
            );
            await claimJob(database, a.id, "w", 60);
            await completeJob(database, a.id, 1);
            const after = await loadPendingDependencies(database, [b.id, c.id, d.id]);
            expect([...after.keys()]).toEqual([d.id]);
        });

        it("K4: scheitert ein Glied, startet das nächste nicht: alle Nachfolger entfallen, mit Verweis auf den Auslöser", async () => {
            const { a, b, c, d } = await tree();
            await claimJob(database, a.id, "w", 60);
            expect(await failJob(database, a.id, 1, { code: "kaputt", summary: "kaputt", retryable: false })).toBe(
                "failed",
            );
            const rows = await Promise.all([b, c, d].map((job) => getJobById(database, job.id)));
            expect(rows[0]).toMatchObject({ state: "CANCELLED", cancelReason: "dependency_failed" });
            expect(rows[1]).toMatchObject({ state: "CANCELLED", cancelReason: "dependency_failed" });
            // D hängt an B, das nur ABGEBROCHEN wurde: der Grund heißt dependency_cancelled.
            expect(rows[2]).toMatchObject({ state: "CANCELLED", cancelReason: "dependency_cancelled" });
            const refs = await database<
                { id: string; ref: string | null }[]
            >`SELECT id::text, cancel_ref_job_id::text AS ref FROM job WHERE state = 'CANCELLED' ORDER BY id`;
            expect(refs).toEqual([
                { id: String(b.id), ref: String(a.id) },
                { id: String(c.id), ref: String(a.id) },
                { id: String(d.id), ref: String(b.id) },
            ]);
        });

        it("Baum, keine Reihe: scheitert nur ein Zweig, läuft der andere weiter", async () => {
            // Wie Q2: dem_publish -> routing_reload und dem_publish -> display_heights; scheitert display_heights, bleibt routing.
            const publish = await add({ label: "publish" });
            const routing = await add({ label: "routing", dependsOn: [publish.id] });
            const heights = await add({ label: "heights", dependsOn: [publish.id] });
            await claimJob(database, publish.id, "w", 60);
            await completeJob(database, publish.id, 1);
            await claimJob(database, heights.id, "w", 60);
            await failJob(database, heights.id, 1, { code: "x", summary: "x", retryable: false });
            expect((await getJobById(database, routing.id))?.state).toBe("QUEUED");
            expect((await getJobById(database, heights.id))?.state).toBe("FAILED");
        });

        it("ein abgebrochener Vorgänger lässt seine Nachfolger entfallen (dependency_cancelled)", async () => {
            const { a, b } = await tree();
            await cancelJob(database, { id: a.id });
            expect(await getJobById(database, b.id)).toMatchObject({
                state: "CANCELLED",
                cancelReason: "dependency_cancelled",
            });
        });

        it("kein Kreis möglich: ein Vorgänger hat immer die kleinere Nummer", async () => {
            const a = await add();
            const b = await add({ dependsOn: [a.id] });
            await expect(
                database`INSERT INTO job_dependency (job_id, depends_on_id) VALUES (${a.id}, ${b.id})`,
            ).rejects.toThrow(/job_dependency_earlier/);
            await expect(
                database`INSERT INTO job_dependency (job_id, depends_on_id) VALUES (${a.id}, ${a.id})`,
            ).rejects.toThrow(/job_dependency_earlier/);
        });

        it("ein bereits gescheiterter oder fehlender Vorgänger wird beim Einreihen abgewiesen", async () => {
            const a = await add();
            await claimJob(database, a.id, "w", 60);
            await failJob(database, a.id, 1, { code: "x", summary: "x", retryable: false });
            await expect(add({ dependsOn: [a.id] })).rejects.toThrow(/bereits gescheitert/);
            await expect(add({ dependsOn: [987_654_321] })).rejects.toThrow(/existiert nicht/);
        });
    });

    describe("Ereignisse und NOTIFY", () => {
        it("`seq` steigt, `readEvents` holt ab einer Nummer nach", async () => {
            await add();
            await add();
            await add();
            const all = await readEvents(database, 0, 10);
            expect(all.map((event) => event.seq)).toEqual([...all.map((event) => event.seq)].sort((x, y) => x - y));
            const tail = await readEvents(database, all[1]?.seq ?? 0, 10);
            expect(tail).toHaveLength(1);
            expect(tail[0]?.seq).toBe(all[2]?.seq);
            expect(await latestSeq(database)).toBe(all[2]?.seq);
        });

        it("🔴 NOTIFY kommt erst mit COMMIT: ein zurückgerollter Auftrag meldet nichts, ein festgeschriebener meldet seine Nummer", async () => {
            const received: string[] = [];
            const subscription = await database.listen("avesmaps3d_jobs", (payload) => received.push(payload));
            try {
                await expect(
                    database.begin(async (tx) => {
                        await insertJob(tx, { kind: "probe", mapDomainId: DOMAIN });
                        throw new Error("zurückrollen");
                    }),
                ).rejects.toThrow("zurückrollen");
                await new Promise((resolve) => setTimeout(resolve, 150));
                expect(received).toEqual([]);

                await add();
                await new Promise((resolve) => setTimeout(resolve, 150));
                const seq = await latestSeq(database);
                expect(received).toEqual([String(seq)]);
            } finally {
                await subscription.unlisten();
            }
        });

        it("Ereignisse werden in der Reihenfolge ihrer Nummer sichtbar, auch bei gleichzeitigen Schreibern", async () => {
            await Promise.all(Array.from({ length: 12 }, () => add()));
            const events = await readEvents(database, 0, 100);
            expect(events).toHaveLength(12);
            expect(events.map((event) => event.seq)).toEqual(
                [...events.map((event) => event.seq)].sort((x, y) => x - y),
            );
        });
    });

    describe("Tür der App-Rolle und Sicht für Claudio", () => {
        it("`job_enqueue`: SECURITY DEFINER mit festem search_path", async () => {
            const [fn] = await database<{ secdef: boolean; config: string[] | null }[]>`
                SELECT prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE proname = 'job_enqueue'
            `;
            expect(fn?.secdef).toBe(true);
            expect(fn?.config).toContain("search_path=public, pg_temp");
            // Die Hilfsfunktionen laufen mit den Rechten des Aufrufers: nur wer in `job` schreiben darf, ruft sie.
            const helpers = await database<{ proname: string; secdef: boolean }[]>`
                SELECT proname, prosecdef AS secdef FROM pg_proc WHERE proname IN ('job_insert', 'job_event_add') ORDER BY proname
            `;
            expect(helpers).toEqual([
                { proname: "job_event_add", secdef: false },
                { proname: "job_insert", secdef: false },
            ]);
        });

        it("`job_enqueue` reiht Editor-Jobs ein, `probe`, `import` und `rollout` nie (Q6, Q10)", async () => {
            const [row] = await database<{ id: string; public_id: string }[]>`
                SELECT * FROM job_enqueue('terrain_local', 1::smallint, ${DOMAIN}, 'actor-1', '{"tiles": [3]}'::jsonb, 50::smallint, NULL, 'tiles', ARRAY[3]::smallint[], '{}'::bigint[])
            `;
            expect(row?.public_id).toMatch(/^[0-9a-f-]{36}$/);
            const job = await getJobByPublicId(database, row?.public_id ?? "");
            expect(job).toMatchObject({
                kind: "terrain_local",
                origin: "queued",
                state: "QUEUED",
                actorRef: "actor-1",
                scopeKind: "tiles",
                scopeTiles: [3],
            });
            for (const kind of ["probe", "import", "rollout"]) {
                await expect(
                    database`SELECT * FROM job_enqueue(${kind}, 1::smallint, ${DOMAIN}, 'a', '{}'::jsonb)`,
                ).rejects.toThrow(/darf die Anwendung nicht einreihen/);
            }
        });

        it("`job_health`: eine Zeile je Jobart mit wartenden, laufenden, hängenden, fehlgeschlagenen und dem ältesten Wartenden", async () => {
            const done = await add();
            await claimJob(database, done.id, "w", 60);
            await completeJob(database, done.id, 1, { wallMs: 4000 });
            const failed = await add();
            await claimJob(database, failed.id, "w", 60);
            await failJob(database, failed.id, 1, { code: "x", summary: "x", retryable: false });
            const live = await add();
            await claimJob(database, live.id, "w", 60);
            await add();
            await add({ kind: "other" });
            const rows = await database<Record<string, string | number | null>[]>`
                SELECT kind, queued::text, running::text, stalled::text, succeeded_24h::text, failed_24h::text, p50_wall_s::float8 AS p50, oldest_queued_s IS NOT NULL AS has_oldest
                FROM job_health ORDER BY kind
            `;
            expect(rows).toEqual([
                {
                    kind: "other",
                    queued: "1",
                    running: "0",
                    stalled: "0",
                    succeeded_24h: "0",
                    failed_24h: "0",
                    p50: null,
                    has_oldest: true,
                },
                {
                    kind: "probe",
                    queued: "1",
                    running: "1",
                    stalled: "0",
                    succeeded_24h: "1",
                    failed_24h: "1",
                    p50: 4,
                    has_oldest: true,
                },
            ]);
        });

        it("`job_health` trägt Befunde (Swap, Überschreitung) und die FAILED der letzten 24 Stunden", async () => {
            const { id } = await add();
            await claimJob(database, id, "w", 60);
            await addJobFinding(database, id, { code: "swap_in_use", detail: "Swap 24 MB benutzt" }, 1);
            await addJobFinding(database, id, { code: "swap_in_use", detail: "doppelt" }, 1);
            await addJobFinding(database, id, { code: "budget_exceeded", detail: "Spitze 1.500 MB" }, 1);
            await completeJob(database, id, 1, { wallMs: 10 });
            const job = await getJobById(database, id);
            // je Code höchstens einmal
            expect(job?.findings.map((finding) => finding.code)).toEqual(["swap_in_use", "budget_exceeded"]);
            const [health] = await database<
                { swap_24h: string; budget_exceeded_24h: string }[]
            >`SELECT swap_24h::text, budget_exceeded_24h::text FROM job_health WHERE kind = 'probe'`;
            expect(health).toEqual({ swap_24h: "1", budget_exceeded_24h: "1" });
        });
    });

    describe("Aufzeichnen (origin = recorded)", () => {
        it("ein bestehender Ablauf meldet sich selbst: Start, Phasen, Ende; die Dauer misst die Datenbank", async () => {
            const started = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "import-2026-10-04T12:00",
                label: "täglicher Zug",
                leaseOwner: "recorder:test",
                leaseS: 900,
                memExpectedMb: 300,
            });
            expect(await getJobById(database, started.id)).toMatchObject({
                state: "RUNNING",
                origin: "recorded",
                leaseNo: 1,
                attempt: 1,
                memExpectedMb: 300,
            });

            expect(
                await recordPhase(
                    database,
                    { externalRef: "import-2026-10-04T12:00" },
                    { phase: "I11", memExpectedMb: 1400, rssMb: 800 },
                    900,
                ),
            ).toBe("ok");
            expect(
                await recordPhase(
                    database,
                    { publicId: started.publicId },
                    {
                        phase: "I13",
                        memExpectedMb: 700,
                        rssMb: 1250,
                        finished: { name: "I11", wallMs: 320_000, rssPeakMb: 1250 },
                    },
                    900,
                ),
            ).toBe("ok");
            expect(await getJobById(database, started.id)).toMatchObject({
                phase: "I13",
                memExpectedMb: 700,
                rssPeakMb: 1250,
                phaseStats: { I11: { wallMs: 320_000, rssPeakMb: 1250 } },
            });
            expect(
                await recordFinish(database, { externalRef: "import-2026-10-04T12:00" }, { ok: true, rssPeakMb: 1300 }),
            ).toBe(true);
            const finished = await getJobById(database, started.id);
            expect(finished).toMatchObject({ state: "SUCCEEDED", rssPeakMb: 1300, progress: 1 });
            expect(finished?.wallMs).toBeGreaterThanOrEqual(0);
            // ein Ablauf, der schon beendet ist, wird still abgewiesen
            expect(await recordPhase(database, { publicId: started.publicId }, { phase: "I14" }, 900)).toBe("terminal");
            expect(await recordFinish(database, { publicId: started.publicId }, { ok: true })).toBe(false);
            expect(await recordPhase(database, { externalRef: "gibt-es-nicht" }, { phase: "I1" }, 900)).toBe("unknown");
        });

        it("wer mit derselben Kennung zweimal meldet, bekommt denselben aktiven Job (nie zwei)", async () => {
            const first = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-1",
                leaseS: 60,
            });
            const second = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-1",
                leaseS: 60,
            });
            expect(second).toMatchObject({ id: first.id, publicId: first.publicId, created: false });
            await recordFinish(database, { externalRef: "lauf-1" }, { ok: true });
            // nach dem Ende ist die Kennung wieder frei
            const third = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-1",
                leaseS: 60,
            });
            expect(third.created).toBe(true);
        });

        it("ein gescheiterter Import trägt Code, Klartext und Befunde; sein Fehler lässt Nachfolger entfallen", async () => {
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-f",
                leaseS: 60,
            });
            const after = await add({ dependsOn: [imp.id] });
            await recordFinish(
                database,
                { externalRef: "lauf-f" },
                {
                    ok: false,
                    errorCode: "quelle_unvollstaendig",
                    errorSummary: "Quelle unvollständig",
                    findings: [{ code: "swap_in_use", detail: "Swap 40 MB" }],
                },
            );
            expect(await getJobById(database, imp.id)).toMatchObject({
                state: "FAILED",
                errorCode: "quelle_unvollstaendig",
                findings: [{ code: "swap_in_use", detail: "Swap 40 MB" }],
            });
            expect((await getJobById(database, after.id))?.state).toBe("CANCELLED");
        });

        it("🔴 recorder_lost: ohne Meldung läuft die Lease ab, der Job ist FAILED und wird nicht wiederholt", async () => {
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-x",
                leaseS: 60,
            });
            await expireLease(imp.id);
            const [action] = await recoverExpired(database);
            expect(action).toMatchObject({ id: imp.id, outcome: "failed", origin: "recorded" });
            const job = await getJobById(database, imp.id);
            expect(job).toMatchObject({ state: "FAILED", errorCode: "recorder_lost" });
            expect(job?.findings.map((finding) => finding.code)).toEqual(["recorder_lost"]);
        });

        it("ein Lebenszeichen verlängert die Lease eines aufgezeichneten Jobs", async () => {
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-h",
                leaseS: 5,
            });
            expect(await recordHeartbeat(database, { externalRef: "lauf-h" }, 600)).toBe("ok");
            expect(((await getJobById(database, imp.id))?.leaseExpiresAt?.getTime() ?? 0) > Date.now() + 500_000).toBe(
                true,
            );
        });

        it("die Marke `rollout` ist aktiv, solange ihre Lease gilt; eine abgelaufene heilt sich selbst", async () => {
            expect(await isRolloutActive(database)).toBe(false);
            const mark = await insertJob(database, {
                kind: "rollout",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "rollout-mark",
                leaseS: 300,
            });
            expect(await isRolloutActive(database)).toBe(true);
            await expireLease(mark.id);
            expect(await isRolloutActive(database)).toBe(false);
            await recoverExpired(database);
            expect(await isRolloutActive(database)).toBe(false);
        });

        it("aktive Jobs zählen (für den Zug: statt `pgrep`), hängende nicht", async () => {
            expect(await countActive(database, ["import"])).toBe(0);
            const imp = await insertJob(database, {
                kind: "import",
                mapDomainId: DOMAIN,
                origin: "recorded",
                externalRef: "lauf-c",
                leaseS: 60,
            });
            expect(await countActive(database, ["import", "rollout"])).toBe(1);
            expect(await countActive(database, ["rollout"])).toBe(0);
            await expireLease(imp.id);
            expect(await countActive(database, ["import"])).toBe(0);
        });
    });

    describe("Wartegründe, Historie, Aufbewahrung", () => {
        it("`setWaitReasons` ändert nur wartende Jobs und nur bei Änderung", async () => {
            const a = await add();
            const b = await add();
            await claimJob(database, b.id, "w", 60);
            await setWaitReasons(
                database,
                new Map([
                    [a.id, "waits_memory"],
                    [b.id, "waits_slot"],
                ]),
            );
            expect((await getJobById(database, a.id))?.waitReason).toBe("waits_memory");
            expect((await getJobById(database, b.id))?.waitReason).toBeNull();
            await setWaitReasons(database, new Map([[a.id, null]]));
            expect((await getJobById(database, a.id))?.waitReason).toBeNull();
        });

        it("Walltime und Spitze RSS der letzten Läufe je Jobart (für Schätzung und Erwartung)", async () => {
            for (const [wall, rss] of [
                [1000, 100],
                [2000, 200],
                [3000, 300],
                [4000, 400],
                [5000, 500],
            ] as const) {
                const { id } = await add();
                await claimJob(database, id, "w", 60);
                await completeJob(database, id, 1, { wallMs: wall, rssPeakMb: rss });
            }
            const history = await loadWallMsHistory(database);
            expect((history["probe"] ?? []).sort((x, y) => x - y)).toEqual([1000, 2000, 3000, 4000, 5000]);
            expect((await loadRssP95History(database, ["probe"], 5))["probe"]).toBeCloseTo(480);
            // zu wenig Läufe: kein Wert
            expect(await loadRssP95History(database, ["probe"], 6)).toEqual({});
            const finished = await listFinished(database, ["SUCCEEDED"], 3);
            expect(finished).toHaveLength(3);
        });

        it("🔴 die Geschichte trennt Teilläufe der Herrschaftsgebiete von den übrigen (WI-0283)", async () => {
            const lauf = async (wallMs: number, result: Record<string, unknown> | null): Promise<void> => {
                const { id } = await add({ kind: "territory_derive" });
                await claimJob(database, id, "w", 60);
                await completeJob(database, id, 1, { wallMs, result });
            };
            await lauf(42_000, { modus: "voll", vollGrund: "tageslauf" });
            await lauf(44_000, null);
            await lauf(3_400, { modus: "teil" });
            const history = await loadWallMsHistory(database);
            expect((history["territory_derive"] ?? []).sort((x, y) => x - y)).toEqual([42_000, 44_000]);
            expect(history["territory_derive:teil"]).toEqual([3_400]);
        });

        it("Aufbewahrung: mindestens die letzten `keepRuns` je Art UND mindestens `keepDays` Tage; Ereignisse kürzer; Lebendes nie", async () => {
            const ids: number[] = [];
            for (let index = 0; index < 5; index += 1) {
                const { id } = await add();
                await claimJob(database, id, "w", 60);
                await completeJob(database, id, 1, { wallMs: 1 });
                ids.push(id);
            }
            const waiting = await add();
            // Alle fünf sind 40 Tage alt, `keepRuns` 2 behält die zwei neuesten, `keepDays` 30 allein hätte alle gelöscht.
            await database`UPDATE job SET finished_at = now() - interval '40 days' WHERE id = ANY(${database.array(ids, 1016)}::bigint[])`;
            await database`UPDATE job_event SET at = now() - interval '20 days' WHERE job_id = ANY(${database.array(ids, 1016)}::bigint[])`;
            const result = await pruneJobs(database, { keepDays: 30, keepRuns: 2, eventKeepDays: 14 });
            expect(result.jobs).toBe(3);
            expect(result.events).toBeGreaterThan(0);
            const left = await database<{ id: string }[]>`SELECT id::text FROM job ORDER BY id`;
            expect(left.map((row) => Number(row.id))).toEqual([...ids.slice(3), waiting.id]);
            // `keepDays`: Läufe von heute bleiben, auch wenn es mehr als `keepRuns` sind
            for (let index = 0; index < 3; index += 1) {
                const { id } = await add();
                await claimJob(database, id, "w", 60);
                await completeJob(database, id, 1, { wallMs: 1 });
            }
            const fresh = await pruneJobs(database, { keepDays: 30, keepRuns: 1, eventKeepDays: 14 });
            // Gelöscht wird nur, was älter als 30 Tage UND jenseits der neuesten Läufe ist: die zwei alten, nicht die neuen.
            expect(fresh.jobs).toBe(2);
            const survivors = await database<
                { n: string }[]
            >`SELECT count(*)::text AS n FROM job WHERE state = 'SUCCEEDED'`;
            expect(survivors[0]?.n).toBe("3");
        });
    });
});
