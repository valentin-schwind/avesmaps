import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { getJobById, insertJob } from "../src/jobs/store.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { sha256Of } from "../src/media/storage.ts";
import { fakeMemory, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";
import { minimalGif, patternImage, png } from "./support/media-fixtures.ts";

/**
 * Die Jobart `media_derive` im ECHTEN Job-Prozess der Queue (WI-0063 MEDIA-M7, JOBS-0001): ein Kindprozess mit
 * `node --expose-gc`, der die Bildbibliothek lädt, ein Bild aus `incoming/` prüft, rendert und unter `MEDIA_ROOT` ablegt.
 * Die Datenbank ist die Testdatenbank (`TEST_DATABASE_URL`): der Job schreibt dort nur seine eigene Jobzeile; eine
 * Medienzeile entsteht nie.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("media_derive im Job-Prozess", { timeout: 60_000 }, () => {
    let database: Database;
    let root: string;
    let previousRoot: string | undefined;
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
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-derive-worker-"));
        await mkdir(join(root, "incoming"), { recursive: true });
        // Der Job-Prozess erbt die Umgebung des Aufsehers.
        previousRoot = process.env["MEDIA_ROOT"];
        process.env["MEDIA_ROOT"] = root;
    });

    afterEach(async () => {
        for (const worker of workers.splice(0)) await worker.stop(0);
        if (previousRoot === undefined) delete process.env["MEDIA_ROOT"];
        else process.env["MEDIA_ROOT"] = previousRoot;
        await rm(root, { recursive: true, force: true });
    });

    function realWorker(): JobWorker {
        const worker = new JobWorker({
            database,
            config: testJobsConfig({
                heartbeatS: { value: 0.2 },
                drainMaxS: { value: 0.1 },
                maxConcurrent: { value: { media_derive: 1 } },
                threads: { value: { media_derive: 1 } },
                memExpectedMb: { value: { media_derive: 400 } },
            }),
            mapDomainId: DOMAIN,
            deriveScope: uniqueScope("derive"),
            memory: fakeMemory().probe,
            killGraceMs: 1000,
            stopGraceMs: 2000,
        });
        workers.push(worker);
        return worker;
    }

    const enqueue = (inputRef: Record<string, unknown>) =>
        insertJob(database, {
            kind: "media_derive",
            mapDomainId: DOMAIN,
            scopeKind: "tiles",
            scopeTiles: [],
            inputRef,
        });

    const terminal = (id: number) =>
        waitFor(
            async () => {
                const row = await getJobById(database, id);
                return row && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(row.state) ? row : undefined;
            },
            40_000,
            `Job ${String(id)} beendet`,
        );

    it("🔴 ein Upload wird im Kindprozess geprüft, gerendert und abgelegt; die Phasen stehen in der Jobzeile", async () => {
        const original = await png(patternImage(640, 480, 4));
        await writeFile(join(root, "incoming", "upload.bin"), original);
        const worker = realWorker();
        const job = await enqueue({ role: "coat", publish: true, incoming: "incoming/upload.bin" });
        expect(await worker.runOne(job.id, { art: "media_derive" })).toEqual({
            ergebnis: "erledigt",
            state: "SUCCEEDED",
        });
        const done = await terminal(job.id);

        expect(done.state).toBe("SUCCEEDED");
        expect(done.errorCode).toBeNull();
        expect(done.memExpectedMb).toBe(400);
        // `jsonb` ordnet die Schlüssel selbst; die Reihenfolge der Phasen steht in den Ereignissen der Queue.
        expect(Object.keys(done.phaseStats).sort()).toEqual(["inspect", "read", "render", "store"]);
        const result = done.result as {
            source: { key: string; sha256: string };
            derivatives: { key: string; sha256: string; width: number; height: number; mimeType: string }[];
        };
        expect(result.source.sha256).toBe(sha256Of(original));
        expect(result.derivatives).toHaveLength(1);
        expect(result.derivatives[0]).toMatchObject({ width: 512, height: 384, mimeType: "image/webp" });
        const published = await readFile(join(root, result.derivatives[0]?.key ?? ""));
        expect(sha256Of(published)).toBe(result.derivatives[0]?.sha256);
        expect(published.toString("ascii", 8, 12)).toBe("WEBP");
    });

    it("🔴 eine abgewiesene Datei beendet den Job mit dem Code der Abweisung, ohne Wiederholung und ohne Dateien", async () => {
        await writeFile(join(root, "incoming", "anim.bin"), minimalGif(3));
        const worker = realWorker();
        const job = await enqueue({ role: "coat", publish: true, incoming: "incoming/anim.bin" });
        expect(await worker.runOne(job.id)).toEqual({ ergebnis: "erledigt", state: "FAILED" });
        const done = await terminal(job.id);
        expect(done.state).toBe("FAILED");
        expect(done.errorCode).toBe("animated_or_multiframe");
        expect(done.attempt).toBe(1);
        // Nur die Eingangsdatei liegt da; nichts unter private/source oder published/.
        await expect(readFile(join(root, "published"))).rejects.toThrow();
    });
});
