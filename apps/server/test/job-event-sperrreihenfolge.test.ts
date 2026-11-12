import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { addAreaEvent } from "../src/jobs/area-events.ts";
import { claimJob, insertJob, isDeadlock, retryOnDeadlock, setJobPhase } from "../src/jobs/store.ts";

/**
 * Die Sperrreihenfolge von `job_event_add` (WI-0248, Befund Stage 2026-10-23: `display_heights` endete in der Phase `event` mit
 * `deadlock detected`, obwohl die Ableitung fertig war).
 *
 * Die Ursache: `job_event_add` nahm erst die Advisory-Sperre (Nummernvergabe, Migration 0070) und dann, mit dem `INSERT`, über den
 * Fremdschlüssel `job_event.job_id` eine `KEY SHARE`-Sperre auf die Jobzeile (Advisory → Zeile). Alle Zustandswechsel des Aufsehers
 * (`setJobPhase`, `completeJob`, `failJob` …) sperren die Zeile zuerst mit `FOR UPDATE` und schreiben ihr Ereignis danach
 * (Zeile → Advisory). Meldet der Job-Prozess seine Phase `event` und schreibt gleich darauf sein Bereichsereignis, laufen beide
 * Wege gleichzeitig, und jeder hält, was der andere braucht. Seit Migration 0217 sperrt `job_event_add` die Jobzeile zuerst.
 *
 * Die Tabellen `job*` gehören diesem Test (wie `jobs-store.test.ts`); zwei eigene Verbindungen spielen Aufseher und Job-Prozess.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "aventuria";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeWithDatabase("job_event_add: Jobzeile vor Advisory-Sperre", { timeout: 60_000 }, () => {
    let admin: Database;
    /** Der Aufseher (Worker): Phase, Abschluss. */
    let supervisor: Database;
    /** Der Job-Prozess: schreibt sein Bereichsereignis. */
    let jobProcess: Database;

    beforeAll(async () => {
        admin = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(admin);
        await seedMapDomains(admin);
        supervisor = createDatabase(testDatabaseUrl as string, { max: 1 });
        jobProcess = createDatabase(testDatabaseUrl as string, { max: 1 });
    });

    afterAll(async () => {
        await supervisor.end({ timeout: 5 });
        await jobProcess.end({ timeout: 5 });
        await admin.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await admin`DELETE FROM job_event`;
        await admin`DELETE FROM job`;
    });

    /** Ein laufender Job der Art `display_heights`, wie ihn der Aufseher führt. */
    async function runningJob() {
        const { id, publicId } = await insertJob(admin, { kind: "display_heights", mapDomainId: DOMAIN });
        const job = await claimJob(admin, id, "test-worker", 600);
        if (!job) throw new Error("Der Job ließ sich nicht übernehmen");
        return { id, publicId, leaseNo: job.leaseNo ?? 0 };
    }

    /** Wartet, bis die Sitzung mit dieser Prozessnummer auf eine Sperre wartet (Zeile oder Advisory). */
    async function waitForLock(pid: number): Promise<void> {
        const deadline = Date.now() + 10_000;
        for (;;) {
            const [row] = await admin<{ wait_event_type: string | null }[]>`
                SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}
            `;
            if (row?.wait_event_type === "Lock") return;
            if (Date.now() > deadline) throw new Error(`Sitzung ${pid} wartete nie auf eine Sperre`);
            await sleep(20);
        }
    }

    async function backendPid(database: Database): Promise<number> {
        const [row] = await database<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        return row?.pid ?? 0;
    }

    /** Das Bereichsereignis des Job-Prozesses, als rohes SQL: ein Wiederholungsversuch darf den Befund nicht verdecken. */
    async function writeAreaEvent(job: { id: number }, payload: Record<string, unknown> = {}): Promise<void> {
        await jobProcess`
            SELECT job_event_add('display_heights.changed', ${job.id}::bigint, ${DOMAIN}, ${jobProcess.json(payload as never)}::jsonb)
        `;
    }

    it("Aufseher (Zeile gesperrt) und Job-Prozess (Bereichsereignis) blockieren sich nicht gegenseitig", async () => {
        const job = await runningJob();
        const processPid = await backendPid(jobProcess);
        const pending: { event?: Promise<void> } = {};

        const supervisorWork = supervisor.begin(async (tx) => {
            // Wie `setJobPhase`: die Zeile mit FOR UPDATE sperren …
            await tx`SELECT id FROM job WHERE id = ${job.id} FOR UPDATE`;
            // … der Job-Prozess schreibt jetzt sein Ereignis und hängt an der Zeile des Aufsehers. Davor darf er KEINE
            // Advisory-Sperre halten, sonst wartet der Aufseher gleich auf ihn …
            pending.event = writeAreaEvent(job);
            pending.event.catch(() => undefined);
            await waitForLock(processPid);
            // … und der Aufseher schreibt nun SEIN Ereignis (wie `setJobPhase` als letzte Anweisung).
            await tx`SELECT job_event_add('job.phase', ${job.id}::bigint, ${DOMAIN}, '{"phase": "event"}'::jsonb)`;
        });

        const [supervisorResult] = await Promise.allSettled([supervisorWork]);
        if (!pending.event) throw new Error("Der Job-Prozess schrieb kein Ereignis");
        const [eventResult] = await Promise.allSettled([pending.event]);
        const failures = [supervisorResult, eventResult].filter(
            (s): s is PromiseRejectedResult => s.status === "rejected",
        );
        expect(failures.map((f) => String((f.reason as Error)?.message ?? f.reason))).toEqual([]);

        const events = await admin<
            { kind: string }[]
        >`SELECT kind FROM job_event WHERE job_id = ${job.id} ORDER BY seq`;
        // Der Aufseher war zuerst: sein Ereignis trägt die kleinere Nummer.
        expect(events.map((event) => event.kind).slice(-2)).toEqual(["job.phase", "display_heights.changed"]);
    });

    it("Job-Prozess zuerst: der Aufseher wartet auf die Zeile und kommt nach dem Commit durch", async () => {
        const job = await runningJob();
        const supervisorPid = await backendPid(supervisor);
        const pending: { phase?: Promise<boolean> } = {};

        // Der Job-Prozess schreibt sein Ereignis in einer offenen Transaktion (KEY SHARE auf die Zeile, Advisory-Sperre bis zum Commit) …
        await jobProcess.begin(async (tx) => {
            await tx`SELECT job_event_add('display_heights.changed', ${job.id}::bigint, ${DOMAIN}, '{}'::jsonb)`;
            // … der Aufseher will die Zeile mit FOR UPDATE und wartet …
            pending.phase = setJobPhase(supervisor, job.id, job.leaseNo, { phase: "event", progress: 0.95 });
            pending.phase.catch(() => undefined);
            await waitForLock(supervisorPid);
        });
        // … und kommt mit dem Commit durch.
        expect(await pending.phase).toBe(true);

        const events = await admin<
            { kind: string }[]
        >`SELECT kind FROM job_event WHERE job_id = ${job.id} ORDER BY seq`;
        expect(events.map((event) => event.kind).slice(-2)).toEqual(["display_heights.changed", "job.phase"]);
    });

    it("Dauerlauf: Phasenwechsel des Aufsehers neben Bereichsereignissen des Job-Prozesses, kein Deadlock", async () => {
        const job = await runningJob();
        const failures: string[] = [];
        const rounds = 40;
        for (let round = 0; round < rounds; round += 1) {
            const results = await Promise.allSettled([
                setJobPhase(supervisor, job.id, job.leaseNo, {
                    phase: round % 2 === 0 ? "derive" : "event",
                    progress: round / rounds,
                }),
                writeAreaEvent(job, { round }),
            ]);
            for (const result of results)
                if (result.status === "rejected")
                    failures.push(String((result.reason as Error)?.message ?? result.reason));
        }
        expect(failures).toEqual([]);
    });
});

describe("Deadlock-Wiederholung (SQLSTATE 40P01)", () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const job = {
        id: 7,
        publicId: "00000000-0000-4000-8000-000000000007",
        kind: "display_heights",
        mapDomainId: DOMAIN,
    };

    /** Eine Verbindung, deren Anweisungen nacheinander die vorgegebenen Fehler werfen; danach gelingen sie. */
    function fakeConnection(errors: (Error | null)[], connectionLevel = true) {
        const state = { calls: 0 };
        const query = (): Promise<unknown[]> => {
            const error = errors[state.calls] ?? null;
            state.calls += 1;
            return error ? Promise.reject(error) : Promise.resolve([]);
        };
        const sql = Object.assign(query, {
            json: (value: unknown) => value,
            ...(connectionLevel ? { begin: () => Promise.resolve(undefined) } : {}),
        });
        return { sql: sql as unknown as Queryable, state };
    }

    it("isDeadlock erkennt nur 40P01", () => {
        expect(isDeadlock(deadlock)).toBe(true);
        expect(isDeadlock(Object.assign(new Error("x"), { code: "23503" }))).toBe(false);
        expect(isDeadlock(new Error("deadlock detected"))).toBe(false);
        expect(isDeadlock(null)).toBe(false);
    });

    it("addAreaEvent wiederholt einen einzelnen Schreibversuch EINMAL bei 40P01", async () => {
        const { sql, state } = fakeConnection([deadlock]);
        await addAreaEvent(sql, "display_heights.changed", job, { revision: "r1" });
        expect(state.calls).toBe(2);
    });

    it("ein zweiter Deadlock geht an den Aufrufer (kein Dauerversuch)", async () => {
        const { sql, state } = fakeConnection([deadlock, deadlock]);
        await expect(addAreaEvent(sql, "display_heights.changed", job, {})).rejects.toBe(deadlock);
        expect(state.calls).toBe(2);
    });

    it("andere Fehler werden nicht wiederholt", async () => {
        const other = Object.assign(new Error("Fremdschlüssel"), { code: "23503" });
        const { sql, state } = fakeConnection([other]);
        await expect(addAreaEvent(sql, "display_heights.changed", job, {})).rejects.toBe(other);
        expect(state.calls).toBe(1);
    });

    it("innerhalb einer Transaktion wird nicht wiederholt: sie ist abgebrochen, der Aufrufer entscheidet", async () => {
        const { sql, state } = fakeConnection([deadlock], false);
        await expect(addAreaEvent(sql, "display_heights.changed", job, {})).rejects.toBe(deadlock);
        expect(state.calls).toBe(1);
    });

    it("retryOnDeadlock führt den Schreibversuch genau zweimal aus, wenn der erste 40P01 war", async () => {
        const { sql } = fakeConnection([]);
        let calls = 0;
        const result = await retryOnDeadlock(sql, async () => {
            calls += 1;
            if (calls === 1) throw deadlock;
            return "ok";
        });
        expect(result).toBe("ok");
        expect(calls).toBe(2);
    });
});
