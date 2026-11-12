import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveJobsConfig, type JobsConfig } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { decideAdmission, type AdmissionCandidate } from "../src/jobs/admission.ts";
import { isEditorJob, readEditorFreeze } from "../src/jobs/editor-freeze.ts";
import { JobRecorder } from "../src/jobs/recorder.ts";
import { getJobById, insertJob } from "../src/jobs/store.ts";
import { JobWorker, type AuftragErgebnis, type JobWorkerOptions } from "../src/jobs/worker.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Worker-Drain und Importe unter den Sperren (WI-0127 SYS-4, SYS-0001 §3.3, §7.1 Zeile SYS-4, §7.2 „Kartensperre während eines
 * laufenden Editor-Jobs“; Claudio 2026-10-09 Punkt 5; Betreiber 2026-10-10 Frage 3 „nein auf keinen fall“):
 *
 * - Unter Kartensperre und im eingeschränkten Betrieb startet kein NEUER Editor-Job (`waits_system_lock`); Jobs ohne Person laufen.
 * - Ein laufender Editor-Job rechnet zu Ende, solange er innerhalb von `drainMaxS` fertig wird; danach hält er an der nächsten
 *   Phasengrenze an, geht ohne Versuchszähler zurück und wartet; nach dem Lösen läuft er weiter. Nichts bricht ab.
 * - Ein Import unter Kartensperre läuft, schreibt eine WARN-Zeile und lässt die Sperre stehen; ein zweiter `migrate` ebenso.
 *
 * Der Ausführer gegen echtes PostgreSQL mit gesteuerten Job-Prozessen, wie `jobs-worker.test.ts`. Dass unter dem Halt kein NEUER
 * Editor-Job startet, entscheidet seit WI-0163 die Zulassung des Dirigenten (`decideAdmission` mit `editorJobsHeld`, oben ohne
 * Datenbank); der Ausführer hält, was schon läuft. Der Test hinterlässt Normal und offen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const DOMAIN = "aventuria";

describe("Halt der Editor-Jobs in der Zulassung (ohne Datenbank)", () => {
    const config: JobsConfig = resolveJobsConfig(
        {
            schemaVersion: 1,
            profile: "test",
            values: {
                maxConcurrent: { value: { a: 4 } },
                cpuBudgetThreads: { value: 8 },
                memTotalBudgetMb: { value: 4000 },
                memAvailFloorMb: { value: 100 },
                rolloutMaxJobMb: { value: 100 },
            },
        },
        "test",
    );
    const NOW = 1_800_000_000_000;
    const job = (id: number, editor: boolean, scopeTiles: number[] = []): AdmissionCandidate => ({
        id,
        kind: "a",
        mapDomainId: "d",
        scopeKind: "tiles",
        scopeTiles,
        priority: 50,
        queuedAtMs: NOW - 1000 + id,
        notBeforeMs: null,
        memExpectedMb: 100,
        threads: 1,
        dependenciesDone: true,
        editor,
    });
    const decide = (queued: AdmissionCandidate[], editorJobsHeld: boolean) =>
        decideAdmission({
            nowMs: NOW,
            queued,
            running: [],
            config,
            memAvailableMb: 8000,
            rolloutActive: false,
            editorJobsHeld,
        });

    it("🔴 gehalten wartet nur der Editor-Job, mit `waits_system_lock` vor jedem anderen Grund", () => {
        const decision = decide([job(1, true), job(2, false), { ...job(3, true), dependenciesDone: false }], true);
        expect(decision.admitted.map((entry) => entry.id)).toEqual([2]);
        expect(Object.fromEntries(decision.waiting)).toEqual({ 1: "waits_system_lock", 3: "waits_system_lock" });
        expect(decide([job(1, true)], false).admitted.map((entry) => entry.id)).toEqual([1]);
    });

    it("🔴 ein gehaltener Editor-Job sperrt seinen Bereich nicht: ein späterer Import-Job im selben Fußabdruck läuft", () => {
        const decision = decide([job(1, true, [4, 5]), job(2, false, [5])], true);
        expect(decision.admitted.map((entry) => entry.id)).toEqual([2]);
        // Ohne Halt bleibt die Reihenfolge je Bereich: der frühere zuerst, der spätere wartet auf den Bereich.
        const free = decide([job(1, true, [4, 5]), job(2, false, [5])], false);
        expect(free.admitted.map((entry) => entry.id)).toEqual([1]);
        expect(free.waiting.get(2)).toBe("waits_area");
    });

    it("Editor-Job heißt: eine Person hat ihn ausgelöst (pseudonyme `person.id`), nicht die Kommandozeile oder ein Zug", () => {
        expect(isEditorJob(randomUUID())).toBe(true);
        expect(isEditorJob("jobs-cli")).toBe(false);
        expect(isEditorJob(null)).toBe(false);
        expect(isEditorJob("cli:root")).toBe(false);
    });

    it("🔴 eine Datenbank, die nicht antwortet: neue Editor-Jobs warten (fail-closed), Laufendes rechnet weiter", async () => {
        const gone = createDatabase("postgres://niemand:geheim@127.0.0.1:1/nirgends", { max: 1 });
        try {
            expect(await readEditorFreeze(gone)).toEqual({
                held: true,
                cause: "unknown",
                heldForS: null,
                mapLockSince: null,
            });
        } finally {
            await gone.end({ timeout: 1 });
        }
    });
});

describeWithDatabase("Worker-Drain und Importe unter den Sperren", { timeout: 60_000 }, () => {
    let database: Database;
    const workers: JobWorker[] = [];
    const runs: Promise<AuftragErgebnis>[] = [];

    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL
             WHERE id = 1
        `;
    }

    /** Die Kartensperre, gesetzt vor `secondsAgo` Sekunden (so wie die Kommandozeile sie setzt). */
    async function lockMap(secondsAgo: number): Promise<void> {
        await database`
            UPDATE system_state
               SET map_lock = true, map_lock_since = now() - make_interval(secs => ${secondsAgo}),
                   map_lock_by_label = 'cli:test', map_lock_reason = 'Test SYS-4'
             WHERE id = 1
        `;
    }

    async function restrict(): Promise<void> {
        await database`
            UPDATE system_state SET mode = 'restricted', mode_since = now(), mode_by_label = 'cli:test', mode_reason = 'Test SYS-4'
             WHERE id = 1
        `;
    }

    async function stateRow() {
        const [row] = await database<{ map_lock: boolean; mode: string; revision: number }[]>`
            SELECT map_lock, mode, revision::int AS revision FROM system_state WHERE id = 1
        `;
        return row!;
    }

    function worker(overrides: Partial<JobWorkerOptions> = {}) {
        const spawner = fakeSpawner();
        const lines: string[] = [];
        const log = {
            info: (_fields: Record<string, unknown>, message: string) => void lines.push(`INFO ${message}`),
            warn: (_fields: Record<string, unknown>, message: string) => void lines.push(`WARN ${message}`),
            error: (_fields: Record<string, unknown>, message: string) => void lines.push(`ERROR ${message}`),
        };
        const instance = new JobWorker({
            database,
            config: testJobsConfig(),
            mapDomainId: DOMAIN,
            deriveScope: uniqueScope("derive"),
            spawnChild: spawner.spawn,
            memory: fakeMemory().probe,
            killGraceMs: 50,
            stopGraceMs: 200,
            log,
            ...overrides,
        });
        workers.push(instance);
        const run = (id: number): Promise<AuftragErgebnis> => {
            const pending = instance.runOne(id);
            runs.push(pending);
            return pending;
        };
        return { worker: instance, spawner, lines, run };
    }

    /** Ein Editor-Job trägt die `person.id` einer Person; ein Job der Kommandozeile `jobs-cli`. */
    const add = (actorRef: string | null, scopeTiles: number[] = []) =>
        insertJob(database, {
            kind: "probe",
            mapDomainId: DOMAIN,
            scopeKind: "tiles",
            scopeTiles,
            inputRef: { sleepMs: 1, ballastMb: 0 },
            ...(actorRef === null ? {} : { actorRef }),
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 8 });
        await migrate(database);
        await seedMapDomains(database);
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await resetState();
    });

    afterEach(async () => {
        for (const instance of workers.splice(0)) await instance.stop(0);
        await Promise.allSettled(runs.splice(0));
        await resetState();
    });

    afterAll(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await database.end({ timeout: 5 });
    });

    it("🔴 ein laufender Editor-Job rechnet unter der Sperre zu Ende, solange er binnen `drainMaxS` fertig wird", async () => {
        const fixture = worker({ config: testJobsConfig({ drainMaxS: { value: 60 } }) });
        const editorJob = await add(randomUUID());
        const running = fixture.run(editorJob.id);
        const child = await waitFor(() => fixture.spawner.children[0]);
        await lockMap(0);
        // Der Takt des Editor-Jobs (50 ms im Testprofil) hat den Halt gelesen und gemeldet, aber nicht angehalten.
        await waitFor(() => fixture.lines.some((line) => line.startsWith("WARN jobs: Editor-Jobs unter Halt")));
        expect(child.received("stop")).toBe(false);
        child.emit({ type: "done", result: { ok: true }, cpuMs: 1, rssPeakMb: 1, arrayBufferPeakMb: 1 });
        expect(await running).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
        expect(await getJobById(database, editorJob.id)).toMatchObject({ attempt: 1, result: { ok: true } });
    });

    it("🔴 länger als `drainMaxS`: hält an der Phasengrenze an, geht ohne Versuchszähler zurück und läuft nach dem Lösen", async () => {
        const editor = worker();
        const cli = worker();
        const editorJob = await add(randomUUID());
        const cliJob = await add("jobs-cli");
        const editorRun = editor.run(editorJob.id);
        const cliRun = cli.run(cliJob.id);
        const editorChild = await waitFor(() => editor.spawner.children[0]);
        const cliChild = await waitFor(() => cli.spawner.children[0]);
        expect(editorChild.run?.job.id).toBe(editorJob.id);
        // Die Sperre gilt seit fünf Sekunden, `drainMaxS` ist im Testprofil 0,1 s.
        await lockMap(5);
        await waitFor(() => editorChild.received("stop"));
        expect(editor.lines.some((line) => line.includes("länger als drainMaxS"))).toBe(true);

        editorChild.emit({ type: "stopped" });
        expect(await editorRun).toEqual({ ergebnis: "erledigt", state: "QUEUED" });
        expect(await getJobById(database, editorJob.id)).toMatchObject({ attempt: 0, leaseOwner: null });
        expect(editor.lines).toContain("INFO jobs: Job zurückgegeben (Sperre), wartet auf ihr Lösen");
        // Der Job ohne Person läuft unberührt weiter: Sein Ausführer liest den Halt gar nicht.
        expect(cliChild.received("stop")).toBe(false);
        expect(cli.lines.some((line) => line.includes("Halt"))).toBe(false);
        expect(await getJobById(database, cliJob.id)).toMatchObject({ state: "RUNNING" });

        await resetState();
        const again = worker();
        const againRun = again.run(editorJob.id);
        await waitFor(() => again.spawner.children[0]);
        expect(await getJobById(database, editorJob.id)).toMatchObject({ state: "RUNNING", attempt: 1 });
        for (const child of [cliChild, again.spawner.children[0]!]) {
            child.emit({ type: "done", result: null, cpuMs: 1, rssPeakMb: 1, arrayBufferPeakMb: 1 });
        }
        expect(await cliRun).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
        expect(await againRun).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
    });

    it("🔴 im eingeschränkten Betrieb ebenso: ein laufender Editor-Job hält nach `drainMaxS` an und geht zurück", async () => {
        const fixture = worker();
        const editorJob = await add(randomUUID());
        const running = fixture.run(editorJob.id);
        const child = await waitFor(() => fixture.spawner.children[0]);
        // Der Halt beginnt jetzt; nach `drainMaxS` (0,1 s im Testprofil) liest der Takt ihn als überschritten.
        await restrict();
        await waitFor(() => child.received("stop"));
        child.emit({ type: "stopped" });
        expect(await running).toEqual({ ergebnis: "erledigt", state: "QUEUED" });
        expect(await getJobById(database, editorJob.id)).toMatchObject({ attempt: 0, leaseOwner: null });
    });

    it("🔴 ein Import unter Kartensperre läuft, schreibt eine WARN-Zeile und lässt die Sperre stehen; ebenso ein zweiter `migrate`", async () => {
        await lockMap(0);
        const before = await stateRow();
        const warnings: string[] = [];
        const recorder = new JobRecorder({
            database,
            config: testJobsConfig(),
            mapDomainId: DOMAIN,
            strict: true,
            warn: (message) => void warnings.push(message),
        });
        const started = await recorder.start("import", { label: "Zug unter Sperre", externalRef: "sys4-import" });
        expect(started).not.toBeNull();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^WARN Kartensperre gesetzt seit \d{4}-\d\d-\d\dT[\d:.]+Z: der Import läuft trotzdem weiter und lässt die Sperre stehen/u,
        );
        // Der Grund ist Freitext mit möglichem Personenbezug: er gehört nicht ins Journal eines Imports.
        expect(warnings[0]).not.toContain("Test SYS-4");
        expect(await recorder.phase({ publicId: started!.publicId }, "import", "I11")).toBe("ok");
        expect(await recorder.finish({ publicId: started!.publicId }, "import", { ok: true })).toBeTruthy();
        expect(await getJobById(database, (await importId(started!.publicId))!)).toMatchObject({ state: "SUCCEEDED" });

        // Der Rollout spielt bei jedem Release die Migrationen ein: auch das hebt die Sperre nicht auf.
        await migrate(database);
        expect(await stateRow()).toEqual(before);

        // Ohne Sperre keine Zeile.
        await resetState();
        await recorder.start("import", { externalRef: "sys4-import-frei" });
        expect(warnings).toHaveLength(1);
    });

    async function importId(publicId: string): Promise<number | undefined> {
        const [row] = await database<{ id: string }[]>`SELECT id FROM job WHERE public_id = ${publicId}`;
        return row === undefined ? undefined : Number(row.id);
    }
});
