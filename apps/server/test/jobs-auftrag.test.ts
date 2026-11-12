import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { withDeriveLock } from "../src/derive/derive-lock.ts";
import { AUFTRAG_EXIT, auftragExitCode, jsonLogger, runAuftragCli, type AuftragDeps } from "../src/jobs/ausfuehrer.ts";
import { getJobById, insertJob } from "../src/jobs/store.ts";
import { fakeSpawner, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Der Ausführer als Befehl (WI-0163 §5.2): `auftrag-cli --job <id> [--art <art>]` und `--pflege`, mit den Exitcodes, die Dirigent und
 * Claudios Wrapper lesen: **0** erledigt oder nichts zu tun, **2** Aufruffehler, **3** Ausführung fehlt, **75** vorübergehend nicht,
 * sonst technischer Fehler. Die Fälle mit Exitcode laufen als ECHTER Prozess (`node auftrag-cli.ts`), wie der Dirigent ihn startet;
 * die übrigen rufen dieselbe Funktion im Prozess.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const DOMAIN = "aventuria";

/** Aus `src/` als `.ts`, aus `dist/` als `.js` - dieselbe Endung wie diese Datei. */
const cliFile = fileURLToPath(
    new URL(`../src/jobs/auftrag-cli${extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

function capture(): { deps: Pick<AuftragDeps, "log">; lines: Record<string, unknown>[] } {
    const lines: Record<string, unknown>[] = [];
    const push = (text: string): void => {
        for (const line of text.split("\n").filter((entry) => entry !== ""))
            lines.push(JSON.parse(line) as Record<string, unknown>);
    };
    return { deps: { log: jsonLogger(push, push) }, lines };
}

/** Die Zeile mit dem Ergebnis; der Job-Prozess schreibt in dieselbe Ausgabe. */
const ergebnisZeile = (lines: Record<string, unknown>[]) =>
    lines.find((line) => line["msg"] === "jobs auftrag: Ergebnis");

describe("Exitcodes des Ausführers (ohne Datenbank)", () => {
    it("🔴 jedes Ergebnis hat seinen Exitcode: 0, 3, 75, technischer Fehler 1", () => {
        expect(auftragExitCode({ ergebnis: "erledigt", state: "SUCCEEDED" })).toBe(0);
        expect(auftragExitCode({ ergebnis: "erledigt", state: "QUEUED" })).toBe(0);
        expect(auftragExitCode({ ergebnis: "nichts_zu_tun", grund: "not_queued" })).toBe(0);
        expect(auftragExitCode({ ergebnis: "ausfuehrung_fehlt", grund: "unknown_kind" })).toBe(3);
        expect(auftragExitCode({ ergebnis: "voruebergehend", grund: "waits_domain_lock" })).toBe(75);
        expect(auftragExitCode({ ergebnis: "technischer_fehler", grund: "finish_not_written" })).toBe(1);
        expect(AUFTRAG_EXIT).toEqual({
            ok: 0,
            fehler: 1,
            aufruf: 2,
            ausfuehrungFehlt: 3,
            voruebergehend: 75,
            speichertor: 76,
        });
    });

    it("🔴 Aufruffehler sind Exit 2, bevor eine Verbindung entsteht; `--help` ist Exit 0", async () => {
        const env = { RELEASE_ID: "auftrag-test" };
        for (const argv of [
            [],
            ["--job"],
            ["--job", "abc"],
            ["--job", "0"],
            ["--job", "1", "--pflege"],
            ["--pflege", "--art", "probe"],
            ["--art", "probe"],
            ["--job", "1", "--art", "Probe!"],
            ["--job", "1", "--unbekannt"],
            ["7"],
        ]) {
            const { deps, lines } = capture();
            expect(await runAuftragCli(argv, env, deps), argv.join(" ")).toBe(2);
            expect(lines.at(-1)?.["level"]).toBe("error");
        }
        const { deps, lines } = capture();
        expect(await runAuftragCli(["--help"], env, deps)).toBe(0);
        expect(String(lines[0]?.["usage"])).toContain("--pflege");
    });

    it("ohne Verbindung in der Umgebung: technischer Fehler, nie „nichts zu tun“", async () => {
        const { deps } = capture();
        expect(await runAuftragCli(["--job", "1"], { RELEASE_ID: "auftrag-test" }, deps)).toBe(1);
    });
});

describeWithDatabase("auftrag-cli gegen die Testdatenbank", { timeout: 60_000 }, () => {
    let database: Database;

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

    /**
     * Die Umgebung des Ausführers. 🔴 Beide Verbindungen zeigen auf die Testdatenbank: Die Umgebung des Tests trägt aus der `.env`
     * die des Entwicklungsrechners. Ohne Release ist `ABGLEICHE` leer, also `aus`: Aufträge der Abgleiche führt diese Umgebung nicht aus.
     */
    const environment = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
        DATABASE_URL: testDatabaseUrl as string,
        JOBS_DATABASE_URL: testDatabaseUrl as string,
        JOBS_PROFILE: "local",
        RELEASE_ID: "auftrag-test",
        ABGLEICHE: "",
        ...extra,
    });

    /** Der Befehl als echter Prozess, wie der Dirigent ihn startet: Exitcode und die JSON-Zeilen. */
    function auftrag(argv: string[], extra: Record<string, string> = {}) {
        const proc = spawn(process.execPath, [cliFile, ...argv], {
            env: { ...process.env, ...environment(extra), MEDIA_ROOT: "" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        proc.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        proc.stderr.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        return new Promise<{ code: number | null; lines: Record<string, unknown>[] }>((resolve) => {
            proc.on("exit", (code) => {
                const lines = out
                    .split("\n")
                    .filter((line) => line.startsWith("{"))
                    .map((line) => JSON.parse(line) as Record<string, unknown>);
                resolve({ code, lines });
            });
        });
    }

    const add = (extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, { kind: "probe", mapDomainId: DOMAIN, scopeKind: "tiles", scopeTiles: [], ...extra });

    it("🔴 Exit 0 nach erfolgreichem Lauf: übernommen, im Kindprozess gerechnet, abgeschlossen", async () => {
        const job = await add({ inputRef: { sleepMs: 50 } });
        const result = await auftrag(["--job", String(job.id), "--art", "probe"]);
        expect(result.code).toBe(0);
        expect(await getJobById(database, job.id)).toMatchObject({ state: "SUCCEEDED", attempt: 1, leaseNo: 1 });
        expect(ergebnisZeile(result.lines)).toMatchObject({ ergebnis: "erledigt", state: "SUCCEEDED", exit: 0 });
        // 🔴 Keine Verbindungszeichenkette im Log.
        expect(JSON.stringify(result.lines)).not.toContain("postgres://");
    }, 30_000);

    it("🔴 Exit 3 bei unbekannter Art oder Fassung; die Zeile bleibt unberührt", async () => {
        const foreign = await add({ kind: "jobart_von_morgen" });
        const result = await auftrag(["--job", String(foreign.id)]);
        expect(result.code).toBe(3);
        expect(await getJobById(database, foreign.id)).toMatchObject({ state: "QUEUED", attempt: 0, waitReason: null });
        expect(ergebnisZeile(result.lines)).toMatchObject({
            ergebnis: "ausfuehrung_fehlt",
            grund: "unknown_kind",
            exit: 3,
        });
    }, 30_000);

    it("Exit 2 bei einem Aufruffehler auch als Prozess", async () => {
        expect((await auftrag(["--job", "eins"])).code).toBe(2);
    }, 30_000);

    it("🔴 nichts zu tun bei fremdem Zustand: Exit 0, kein Claim", async () => {
        const job = await add();
        await database`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE id = ${job.id}`;
        const { deps, lines } = capture();
        expect(await runAuftragCli(["--job", String(job.id)], environment(), { ...deps, database })).toBe(0);
        expect(lines.at(-1)).toMatchObject({ ergebnis: "nichts_zu_tun", grund: "not_queued", exit: 0 });
        expect(await getJobById(database, job.id)).toMatchObject({ state: "CANCELLED", attempt: 0 });
    });

    it("🔴 Aufträge der Abgleiche ohne `ABGLEICHE=worker` führt diese Umgebung nicht aus: Exit 3", async () => {
        // 🪤 In zwei Abfragen: Die Zeile, die `job_enqueue` anlegt, sieht dieselbe Abfrage nicht (ihr Schnappschuss ist älter).
        const [queued] = await database<{ public_id: string }[]>`
            SELECT public_id::text AS public_id FROM job_enqueue('legacy_media', 1::smallint, ${DOMAIN}, 'cli:test', '{}'::jsonb)
        `;
        const [row] = await database<
            { id: string }[]
        >`SELECT id::text FROM job WHERE public_id = ${queued!.public_id}::uuid`;
        const { deps, lines } = capture();
        const env = environment({ ABGLEICHE: "medien:aus" });
        expect(await runAuftragCli(["--job", row!.id], env, { ...deps, database })).toBe(3);
        expect(lines.at(-1)).toMatchObject({ grund: "excluded_kind" });
        expect(await getJobById(database, Number(row!.id))).toMatchObject({ state: "QUEUED", attempt: 0 });
    });

    it("Exit 75, solange ein Zug die Sperre der Domäne exklusiv hält; die Zeile nennt den Grund", async () => {
        const scope = uniqueScope("auftrag-domain");
        const job = await add();
        const { deps, lines } = capture();
        const code = await withDeriveLock(database, scope, "Zug", () =>
            runAuftragCli(["--job", String(job.id)], environment({ JOBS_DOMAIN: scope }), { ...deps, database }),
        );
        expect(code).toBe(75);
        expect(lines.at(-1)).toMatchObject({ ergebnis: "voruebergehend", grund: "waits_domain_lock" });
        expect(await getJobById(database, job.id)).toMatchObject({
            state: "QUEUED",
            attempt: 0,
            waitReason: "waits_domain_lock",
        });
    });

    it("🔴 SIGTERM: der laufende Auftrag hält an der Phasengrenze an, geht ohne Versuchszähler zurück, Exit 0", async () => {
        const job = await add();
        const spawner = fakeSpawner();
        const stop = new AbortController();
        const { deps } = capture();
        const running = runAuftragCli(["--job", String(job.id)], environment(), {
            ...deps,
            database,
            config: testJobsConfig(),
            spawnChild: spawner.spawn,
            stop: stop.signal,
        });
        const child = await waitFor(() => spawner.children[0]);
        expect((await getJobById(database, job.id))?.state).toBe("RUNNING");
        stop.abort();
        await waitFor(() => child.received("stop"));
        child.emit({ type: "stopped" });
        expect(await running).toBe(0);
        expect(await getJobById(database, job.id)).toMatchObject({ state: "QUEUED", attempt: 0, leaseOwner: null });
    });

    it("🔴 die Pflege sammelt eine abgelaufene Lease ein: der Auftrag wartet wieder, Exit 0", async () => {
        const job = await add();
        await database`
            UPDATE job SET state = 'RUNNING', attempt = 1, lease_no = 1, lease_owner = 'gestorben:1', started_at = now(),
                           lease_expires_at = now() - interval '1 second', heartbeat_at = now() - interval '1 minute'
             WHERE id = ${job.id}
        `;
        const { deps, lines } = capture();
        expect(await runAuftragCli(["--pflege"], environment(), { ...deps, database })).toBe(0);
        expect(await getJobById(database, job.id)).toMatchObject({
            state: "QUEUED",
            errorCode: "lease_expired",
            leaseOwner: null,
        });
        expect(lines.find((line) => line["msg"] === "jobs auftrag: Pflege gelaufen")).toMatchObject({ recovered: 1 });
    });
});
