import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { runJobsCli, type CliIo } from "../src/jobs/cli-commands.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { getJobById, getJobByPublicId, insertJob, isRolloutActive } from "../src/jobs/store.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * `jobs-cli` (JOBS-0001 Etappe 1, Q5, Q6): Aufzeichnen für Zug und Rollouts, Stand, Probe, Abbrechen.
 *
 * 🔴 Aufzeichnen ist BEST EFFORT: Ein Fehler beim Aufzeichnen beendet nie einen Import, der Exit-Code ist 0.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function capture(): { io: CliIo; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

describeWithDatabase("jobs-cli", { timeout: 45_000 }, () => {
    let database: Database;
    const environment = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
        DATABASE_URL: testDatabaseUrl as string,
        JOBS_PROFILE: "staging",
        RELEASE_ID: "test-release",
        ...extra,
    });

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

    async function run(argv: string[], extra: Record<string, string> = {}) {
        const output = capture();
        const code = await runJobsCli(argv, environment(extra), output.io);
        return { code, out: output.out, err: output.err };
    }

    describe("record", () => {
        it("Zug und Rollout melden sich selbst: Start mit Kennung des Aufrufers, Phasen, Ende; die Erwartung folgt der Phase", async () => {
            const started = await run([
                "record",
                "start",
                "--kind",
                "import",
                "--ref",
                "zug-20261004T120000Z",
                "--label",
                "täglicher Zug 12:00",
            ]);
            expect(started.code).toBe(0);
            const publicId = started.out[0] ?? "";
            expect(publicId).toMatch(/^[0-9a-f-]{36}$/);
            const job = await getJobByPublicId(database, publicId);
            expect(job).toMatchObject({
                kind: "import",
                origin: "recorded",
                state: "RUNNING",
                label: "täglicher Zug 12:00",
                memExpectedMb: 300,
            });

            // I11 bucht 1.850 MB (terrain_full, Claudio 2026-10-19 Wahl A: dieselbe grobe Stufe wie das Gelände), I13 700, I19 400, alles andere 300.
            const phases: [string, number][] = [
                ["I3", 300],
                ["I11", 1850],
                ["I13", 700],
                // land_smooth im Profil staging: 400 MB seit Claudios Messlauf (handovers/2026-10-05-stage-rollout-9b6213f.md).
                ["I19", 400],
            ];
            let previous: string | null = null;
            for (const [phase, expected] of phases) {
                const args = [
                    "record",
                    "phase",
                    "--ref",
                    "zug-20261004T120000Z",
                    "--kind",
                    "import",
                    "--phase",
                    phase,
                    "--rss-mb",
                    "500",
                ];
                if (previous) args.push("--prev-phase", previous, "--prev-wall-ms", "1500", "--prev-rss-mb", "480");
                expect((await run(args)).code).toBe(0);
                expect(await getJobByPublicId(database, publicId)).toMatchObject({ phase, memExpectedMb: expected });
                previous = phase;
            }
            expect(await getJobByPublicId(database, publicId)).toMatchObject({
                phaseStats: { I3: { wallMs: 1500 }, I11: { wallMs: 1500 }, I13: { wallMs: 1500 } },
            });

            const finished = await run([
                "record",
                "finish",
                "--ref",
                "zug-20261004T120000Z",
                "--status",
                "ok",
                "--rss-peak-mb",
                "1300",
                "--phase",
                "I19",
            ]);
            expect(finished.code).toBe(0);
            expect(await getJobByPublicId(database, publicId)).toMatchObject({
                state: "SUCCEEDED",
                rssPeakMb: 1300,
                progress: 1,
            });
        });

        it("`record start` mit derselben Kennung zweimal: derselbe Job (der Zug meldet bei Wiederholung nicht doppelt)", async () => {
            const first = await run(["record", "start", "--kind", "import", "--ref", "lauf-1"]);
            const second = await run(["record", "start", "--kind", "import", "--ref", "lauf-1"]);
            expect(second.out[0]).toBe(first.out[0]);
        });

        it("ein gescheiterter Import trägt Code und Klartext; Spitze über der Meldegrenze und Swap werden Befunde, kein Abbruch", async () => {
            await run(["record", "start", "--kind", "import", "--ref", "lauf-f"]);
            await run(["record", "phase", "--ref", "lauf-f", "--phase", "I11"]);
            const finished = await run([
                "record",
                "finish",
                "--ref",
                "lauf-f",
                "--status",
                "failed",
                "--error-code",
                "quelle_unvollstaendig",
                "--error-summary",
                "Quelle unvollständig",
                // Über der Meldegrenze von terrain_full, nach der I11 bucht (2000 MB seit 4c5f9175d, vorher 1400).
                "--rss-peak-mb",
                "2100",
                "--swap-mb",
                "30",
                "--swap-in-mb",
                "80",
                "--phase",
                "I11",
            ]);
            expect(finished.code).toBe(0);
            const [row] = await database<{ id: string }[]>`SELECT id::text FROM job WHERE external_ref = 'lauf-f'`;
            const job = await getJobById(database, Number(row?.id));
            expect(job).toMatchObject({
                state: "FAILED",
                errorCode: "quelle_unvollstaendig",
                errorSummary: "Quelle unvollständig",
                swapSeenMb: 30,
            });
            expect(job?.findings.map((finding) => finding.code).sort()).toEqual(["budget_exceeded", "swap_in_use"]);
        });

        it("🔴 der Swap-Befund zählt ab dem Ende des Wartens, nicht ab dem Anlegen (Rollout 2222: 6 min hinter fremden Aufträgen)", async () => {
            const befunde = async (ref: string) => {
                const [row] = await database<{ id: string }[]>`SELECT id::text FROM job WHERE external_ref = ${ref}`;
                return (await getJobById(database, Number(row?.id)))?.findings.map((finding) => finding.code) ?? [];
            };
            // Zehn Minuten gewartet, dann gerechnet: 80 MB kurz nach dem Ende des Wartens sind ein Befund.
            await run(["record", "start", "--kind", "import", "--ref", "lauf-w", "--phase", "wartet"]);
            await database`UPDATE job SET started_at = now() - interval '10 minutes' WHERE external_ref = 'lauf-w'`;
            await run(["record", "phase", "--ref", "lauf-w", "--phase", "I11"]);
            await run(["record", "finish", "--ref", "lauf-w", "--status", "ok", "--swap-in-mb", "80"]);
            expect(await befunde("lauf-w")).toContain("swap_in_use");
            // Zehn Minuten gerechnet, ohne zu warten: dieselben 80 MB sind 8 MB je Minute, Rauschen des Hosts.
            await run(["record", "start", "--kind", "import", "--ref", "lauf-r", "--phase", "I1"]);
            await database`UPDATE job SET started_at = now() - interval '10 minutes' WHERE external_ref = 'lauf-r'`;
            await run(["record", "phase", "--ref", "lauf-r", "--phase", "I11"]);
            await run(["record", "finish", "--ref", "lauf-r", "--status", "ok", "--swap-in-mb", "80"]);
            expect(await befunde("lauf-r")).not.toContain("swap_in_use");
        });

        it("die Marke `rollout`: an, nochmal an (verlängert), aus", async () => {
            expect(await isRolloutActive(database)).toBe(false);
            expect((await run(["record", "mark", "rollout", "on"])).code).toBe(0);
            expect(await isRolloutActive(database)).toBe(true);
            expect((await run(["record", "mark", "rollout", "on"])).code).toBe(0);
            const marks = await database<{ n: string }[]>`SELECT count(*)::text AS n FROM job WHERE kind = 'rollout'`;
            expect(marks[0]?.n).toBe("1");
            expect((await run(["record", "mark", "rollout", "off"])).code).toBe(0);
            expect(await isRolloutActive(database)).toBe(false);
        });

        it("🔴 BEST EFFORT: Datenbank nicht erreichbar -> Exit 0 und eine Warnung, nie ein Abbruch des Imports", async () => {
            const output = capture();
            const started = Date.now();
            const code = await runJobsCli(
                ["record", "phase", "--ref", "x", "--phase", "I1", "--timeout-s", "3"],
                { DATABASE_URL: "postgres://nobody:secret@127.0.0.1:1/none", JOBS_PROFILE: "staging" },
                output.io,
            );
            expect(code).toBe(0);
            expect(Date.now() - started).toBeLessThan(8000);
            expect(output.err.join("\n")).toMatch(/nicht aufgezeichnet|keine Antwort|jobs-cli record/);
            // keine Zugangsdaten im Journal des Ablaufs
            expect(output.err.join("\n")).not.toContain("secret");
        }, 15_000);

        it("🔴 BEST EFFORT: keine Datenbank konfiguriert, kein Job, unvollständige Angaben -> Exit 0", async () => {
            const noUrl = await runJobsCli(["record", "start", "--kind", "import"], {}, capture().io);
            expect(noUrl).toBe(0);
            expect((await run(["record", "phase", "--phase", "I1"])).code).toBe(0);
            expect((await run(["record", "phase", "--ref", "gibt-es-nicht", "--phase", "I1"])).code).toBe(0);
            expect((await run(["record", "finish", "--ref", "gibt-es-nicht", "--status", "ok"])).code).toBe(0);
        });

        it("mit --strict wird jeder Fehler zu Exit 1 (Tests, Messung): nur der Aufrufer entscheidet", async () => {
            expect((await run(["record", "phase", "--ref", "gibt-es-nicht", "--phase", "I1", "--strict"])).code).toBe(
                1,
            );
            expect((await run(["record", "finish", "--ref", "gibt-es-nicht", "--status", "ok", "--strict"])).code).toBe(
                1,
            );
        });
    });

    describe("status", () => {
        it("`status --active`: 0 ohne laufenden Import, 10 mit; der Zug fragt das statt `pgrep`", async () => {
            expect((await run(["status", "--active"])).out).toEqual(["active=0"]);
            expect((await run(["status", "--active"])).code).toBe(0);
            await run(["record", "start", "--kind", "import", "--ref", "aktiv"]);
            const busy = await run(["status", "--active"]);
            expect(busy).toMatchObject({ code: 10, out: ["active=1"] });
            // hängende Jobs zählen nicht (die Lease ist abgelaufen)
            await database`UPDATE job SET lease_expires_at = now() - interval '1 second'`;
            expect((await run(["status", "--active"])).code).toBe(0);
        });

        it("🔴 `status --active` mit nicht erreichbarer Datenbank ist Exit 2 (unbekannt), nie 0 („nichts los“)", async () => {
            const output = capture();
            const code = await runJobsCli(
                ["status", "--active", "--timeout-s", "3"],
                { DATABASE_URL: "postgres://nobody:secret@127.0.0.1:1/none" },
                output.io,
            );
            expect(code).toBe(2);
        }, 15_000);

        it("`status --json` liefert den Stand wie die Statusseite", async () => {
            await run(["record", "start", "--kind", "import", "--ref", "j"]);
            const result = await run(["status", "--json"]);
            expect(result.code).toBe(0);
            const overview = JSON.parse(result.out[0] ?? "{}") as {
                running: { kind: string }[];
                queued: unknown[];
                profile: string;
                memory: { budgetMb: number };
            };
            expect(overview.profile).toBe("staging");
            expect(overview.running.map((job) => job.kind)).toEqual(["import"]);
            expect(overview.memory.budgetMb).toBe(2000);
        });

        it("`status` als Text nennt läuft, wartet und Speicher", async () => {
            await run(["record", "start", "--kind", "import", "--ref", "t"]);
            await run(["record", "phase", "--ref", "t", "--phase", "I11"]);
            const result = await run(["status"]);
            const text = result.out.join("\n");
            expect(text).toContain("läuft: 1, wartet: 0, hängt: 0");
            expect(text).toContain("Phase I11");
            expect(text).toContain("Budget 2000 MB");
        });
    });

    describe("probe und cancel", () => {
        it("`probe` reiht einen Probe-Job ein (ohne Bereich, damit zwei nebeneinander laufen können)", async () => {
            const result = await run(["probe", "--ballast-mb", "256", "--phases", "3", "--phase-ms", "50"]);
            expect(result.code).toBe(0);
            const job = await getJobByPublicId(database, result.out[0] ?? "");
            expect(job).toMatchObject({
                kind: "probe",
                origin: "queued",
                state: "QUEUED",
                scopeKind: "tiles",
                actorRef: "jobs-cli",
            });
            expect(job?.inputRef).toMatchObject({ ballastMb: 256, phases: [{ ms: 50 }, { ms: 50 }, { ms: 50 }] });
        });

        it("`probe --wait` wartet auf das Ende und meldet es; Exit 0 nur bei SUCCEEDED", async () => {
            const spawner = fakeSpawner();
            const worker = new JobWorker({
                database,
                config: testJobsConfig(),
                mapDomainId: "aventuria",
                deriveScope: uniqueScope("derive"),
                spawnChild: spawner.spawn,
                memory: fakeMemory().probe,
            });
            try {
                const waiting = run(["probe", "--sleep-ms", "10", "--wait", "--json", "--timeout-s", "30"]);
                // Den Dirigenten spielt der Test: Er startet den Ausführer für den eingereihten Auftrag.
                const queued = await waitFor(
                    async () => (await database<{ id: string }[]>`SELECT id::text FROM job WHERE kind = 'probe'`)[0],
                );
                const ausgefuehrt = worker.runOne(Number(queued.id));
                const child = await waitFor(() => spawner.children[0]);
                child.emit({ type: "done", result: { phases: 1 }, cpuMs: 5, rssPeakMb: 80, arrayBufferPeakMb: 1 });
                expect(await ausgefuehrt).toEqual({ ergebnis: "erledigt", state: "SUCCEEDED" });
                const result = await waiting;
                expect(result.code).toBe(0);
                expect(JSON.parse(result.out[0] ?? "{}")).toMatchObject({
                    kind: "probe",
                    state: "SUCCEEDED",
                    rssPeakMb: 80,
                });
            } finally {
                await worker.stop(0);
            }
        }, 30_000);

        it("`cancel` bricht einen wartenden Job ab, einen unbekannten nicht (Exit 1)", async () => {
            const { publicId } = await insertJob(database, { kind: "probe", mapDomainId: "aventuria" });
            const cancelled = await run(["cancel", publicId]);
            expect(cancelled).toMatchObject({ code: 0, out: ["cancelled"] });
            expect((await getJobByPublicId(database, publicId))?.state).toBe("CANCELLED");
            expect((await run(["cancel", "00000000-0000-4000-8000-000000000000"])).code).toBe(1);
        });
    });

    it("ein unbekannter Befehl ist Exit 2 mit Hilfe; `--help` ist Exit 0", async () => {
        const unknown = capture();
        expect(await runJobsCli(["tu-was"], environment(), unknown.io)).toBe(2);
        expect(unknown.err.join("\n")).toContain("jobs-cli <Befehl>");
        const help = capture();
        expect(await runJobsCli(["--help"], environment(), help.io)).toBe(0);
        expect(help.out.join("\n")).toContain("record start");
    });
});
