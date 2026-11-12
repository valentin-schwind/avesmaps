import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJobsConfig, MEDIA_ROLES } from "@avesmaps3d/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { childEnvironment } from "../src/jobs/child-process.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, MEDIA_DERIVE_FULL_KEY, expectedMemoryMb, knowsKind, threadsFor } from "../src/jobs/kinds.ts";
import { parseMediaDeriveInput, runMediaDerive } from "../src/jobs/media-derive.ts";
import { MAX_SOURCE_BYTES } from "../src/media/raster/limits.ts";
import { sha256Of } from "../src/media/storage.ts";
import { GRADIENT_SVG, minimalGif, patternImage, png } from "./support/media-fixtures.ts";

// Das erste Bild einer Datei lädt die Bildbibliothek; unter Last (andere Sitzungen, Volllauf) reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Die Jobart `media_derive` (WI-0063 MEDIA-M7, JOBS-0001): Registrierung in der Queue, Eingabe, Lauf in Phasen, Fehlercodes.
 * Der Lauf im echten Kindprozess steht in `media-derive-worker.test.ts` (braucht die Testdatenbank).
 */

const SHA = "a".repeat(64);

describe("Registrierung in der Queue", () => {
    it("🔴 media_derive ist eine Jobart der Queue: bekannt, in der Queue gerechnet (nicht aufgezeichnet), mit Handler", () => {
        const spec = JOB_KIND_CATALOG["media_derive"];
        expect(spec).toBeDefined();
        expect(spec).toMatchObject({ kind: "media_derive", version: 1, origin: "queued", threads: 1 });
        expect(knowsKind("media_derive", 1)).toBe(true);
        expect(knowsKind("media_derive", 2)).toBe(false);
        expect(JOB_HANDLERS["media_derive"]).toBeTypeOf("function");
        // Kein Kartenjob: er hält die geteilte Sperre der Domäne nicht.
        expect(spec?.holdsSharedDomainLock).toBe(false);
        expect(spec?.memoryKey({}, null)).toBe("media_derive");
    });

    it("Claudios Bedingung: der Job-Prozess bekommt einen kleinen UV_THREADPOOL_SIZE, aber der Betrieb gewinnt", () => {
        const spec = JOB_KIND_CATALOG["media_derive"];
        expect(spec?.childEnv).toEqual({ UV_THREADPOOL_SIZE: "2" });
        expect(childEnvironment({ PATH: "/bin" }, spec?.childEnv)).toEqual({ PATH: "/bin", UV_THREADPOOL_SIZE: "2" });
        // Hat der Aufseher die Variable gesetzt (etwa die Unit), bleibt sein Wert.
        expect(childEnvironment({ UV_THREADPOOL_SIZE: "8" }, spec?.childEnv)["UV_THREADPOOL_SIZE"]).toBe("8");
        expect(childEnvironment({ PATH: "/bin" }, undefined)).toEqual({ PATH: "/bin" });
    });

    it("andere Jobarten bekommen keine zusätzliche Umgebung; der Abgleich der Medien (WI-0068 P4a) und die Bilder des Kanals und die Kartenvorschau dieselbe wie die Pipeline", () => {
        // Wer libvips rechnet, bekommt Claudios Bedingung: die Pipeline, ihr Abgleich, die Bilder des Betreiber-Kanals (KANAL-0001 §6.1) und die Kartenvorschau (WI-0287, `citymap_preview_generate`).
        const RASTER = new Set(["media_derive", "media_settle", "kanal_bild", "citymap_preview_generate"]);
        for (const [kind, spec] of Object.entries(JOB_KIND_CATALOG)) {
            if (!RASTER.has(kind)) expect(spec.childEnv, kind).toBeUndefined();
        }
        const settle = JOB_KIND_CATALOG["media_settle"];
        expect(settle?.childEnv).toEqual(JOB_KIND_CATALOG["media_derive"]?.childEnv);
        if (JOB_KIND_CATALOG["kanal_bild"] !== undefined) {
            expect(JOB_KIND_CATALOG["kanal_bild"].childEnv).toEqual(JOB_KIND_CATALOG["media_derive"]?.childEnv);
        }
        expect(settle?.memoryKey({ role: "map_full" }, null)).toBe(MEDIA_DERIVE_FULL_KEY);
        expect(settle?.memoryKey({ role: "coat" }, null)).toBe("media_derive");
        expect(JOB_HANDLERS["media_settle"]).toBeTypeOf("function");
    });

    it("🔴 lokal ist die Erwartung gesetzt (mem.expectedMb); auf der Stage ist sie unbekannt, also läuft die Art allein", () => {
        const spec = JOB_KIND_CATALOG["media_derive"];
        if (spec === undefined) throw new Error("media_derive fehlt im Katalog");
        const local = getJobsConfig("local");
        expect(expectedMemoryMb(spec, { role: "coat" }, null, local, null)).toBe(250);
        expect(expectedMemoryMb(spec, {}, null, local, null)).toBe(250);
        expect(threadsFor(spec, local)).toBe(1);
        expect(local.maxConcurrent["media_derive"]).toBe(1);
        // Die Queue lernt nur nach oben.
        expect(expectedMemoryMb(spec, { role: "coat" }, null, local, 400)).toBe(400);
        expect(expectedMemoryMb(spec, { role: "coat" }, null, local, 100)).toBe(250);
        // Stage: Claudios Startwerte kennen die Art noch nicht („unbekannt heißt allein“); er trägt sie ein.
        const staging = getJobsConfig("staging");
        expect(expectedMemoryMb(spec, { role: "coat" }, null, staging, null)).toBeNull();
        expect(expectedMemoryMb(spec, { role: "map_full" }, null, staging, null)).toBeNull();
    });

    it("das Vollbild der Kartensammlung hat einen eigenen Speicherschlüssel (verlustfrei, 16 MP: rund 480 MB statt rund 120)", () => {
        const spec = JOB_KIND_CATALOG["media_derive"];
        if (spec === undefined) throw new Error("media_derive fehlt im Katalog");
        expect(MEDIA_DERIVE_FULL_KEY).toBe("media_derive_map_full");
        for (const role of MEDIA_ROLES) {
            expect(spec.memoryKey({ role }, null), role).toBe(
                role === "map_full" ? MEDIA_DERIVE_FULL_KEY : "media_derive",
            );
        }
        const local = getJobsConfig("local");
        expect(expectedMemoryMb(spec, { role: "map_full" }, null, local, null)).toBe(600);
        expect(local.expectedDurationS[MEDIA_DERIVE_FULL_KEY]).toBeGreaterThan(
            local.expectedDurationS["media_derive"] ?? 0,
        );
    });
});

describe("Eingabe", () => {
    it("nimmt einen Upload unter incoming/ und ein abgelegtes Original an", () => {
        expect(parseMediaDeriveInput({ role: "coat", publish: false, incoming: "incoming/upload-1.bin" })).toEqual({
            role: "coat",
            publish: false,
            source: { kind: "incoming", key: "incoming/upload-1.bin" },
        });
        expect(
            parseMediaDeriveInput({ role: "header", publish: true, sourceSha256: SHA, sourceExtension: "png" }),
        ).toEqual({ role: "header", publish: true, source: { kind: "stored", sha256: SHA, extension: "png" } });
    });

    it("kennt jede Rolle des Media Core", () => {
        for (const role of MEDIA_ROLES) {
            expect(parseMediaDeriveInput({ role, publish: false, incoming: "incoming/x" }).role).toBe(role);
        }
    });

    it("🔴 publish ist Pflicht und muss ein Boolean sein: keine Veröffentlichung aus Versehen", () => {
        expect(() => parseMediaDeriveInput({ role: "coat", incoming: "incoming/x" })).toThrow(JobFailure);
        expect(() => parseMediaDeriveInput({ role: "coat", publish: "true", incoming: "incoming/x" })).toThrow(
            JobFailure,
        );
        expect(() => parseMediaDeriveInput({ role: "coat", publish: 1, incoming: "incoming/x" })).toThrow(JobFailure);
    });

    it("weist Unbrauchbares mit invalid_input ab (nie wiederholt)", () => {
        const bad: Record<string, unknown>[] = [
            { publish: true, incoming: "incoming/x" },
            { role: "gallery", publish: true, incoming: "incoming/x" },
            { role: "coat", publish: true },
            { role: "coat", publish: true, incoming: "incoming/x", sourceSha256: SHA, sourceExtension: "png" },
            { role: "coat", publish: true, incoming: "published/x.webp" },
            { role: "coat", publish: true, incoming: "incoming/unter/ordner" },
            { role: "coat", publish: true, incoming: "incoming/../private/x" },
            { role: "coat", publish: true, incoming: "/etc/passwd" },
            { role: "coat", publish: true, incoming: 5 },
            { role: "coat", publish: true, sourceSha256: SHA.toUpperCase(), sourceExtension: "png" },
            { role: "coat", publish: true, sourceSha256: "abc", sourceExtension: "png" },
            { role: "coat", publish: true, sourceSha256: SHA, sourceExtension: "exe" },
            { role: "coat", publish: true, sourceSha256: SHA },
        ];
        for (const input of bad) {
            try {
                parseMediaDeriveInput(input);
                throw new Error(`angenommen: ${JSON.stringify(input)}`);
            } catch (error) {
                expect(error, JSON.stringify(input)).toBeInstanceOf(JobFailure);
                expect((error as JobFailure).code).toBe("invalid_input");
                expect((error as JobFailure).retryable).toBe(false);
            }
        }
    });
});

interface Recorded {
    phases: string[];
}

function fakeContext(input: Record<string, unknown>): { context: JobContext; recorded: Recorded } {
    const recorded: Recorded = { phases: [] };
    return {
        recorded,
        context: {
            input,
            attempt: 1,
            job: { id: 1, publicId: "00000000-0000-4000-8000-000000000001", leaseNo: 1, mapDomainId: "aventuria" },
            beginPhase: (name) => {
                recorded.phases.push(name);
                return Promise.resolve();
            },
            checkpoint: () => undefined,
        },
    };
}

describe("Lauf", () => {
    let root: string;
    let previousRoot: string | undefined;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-derive-"));
        previousRoot = process.env["MEDIA_ROOT"];
        process.env["MEDIA_ROOT"] = root;
        await mkdir(join(root, "incoming"), { recursive: true });
    });

    afterEach(async () => {
        if (previousRoot === undefined) delete process.env["MEDIA_ROOT"];
        else process.env["MEDIA_ROOT"] = previousRoot;
        await rm(root, { recursive: true, force: true });
    });

    async function upload(name: string, bytes: Uint8Array): Promise<string> {
        await writeFile(join(root, "incoming", name), bytes);
        return `incoming/${name}`;
    }

    it("ein Upload wird geprüft, gerendert und abgelegt; das Ergebnis trägt alles für media_file, in vier Phasen", async () => {
        const original = await png(patternImage(640, 480, 4));
        const { context, recorded } = fakeContext({
            role: "coat",
            publish: true,
            incoming: await upload("a.bin", original),
        });
        const result = await runMediaDerive(context);

        expect(recorded.phases).toEqual(["read", "inspect", "render", "store"]);
        expect(result["format"]).toBe("png");
        const source = result["source"] as Record<string, unknown>;
        expect(source).toMatchObject({ variant: "source", storageClass: "private_source", sha256: sha256Of(original) });
        const derivatives = result["derivatives"] as Record<string, unknown>[];
        expect(derivatives).toHaveLength(1);
        expect(derivatives[0]).toMatchObject({
            variant: "coat",
            storageClass: "published",
            mimeType: "image/webp",
            width: 512,
            height: 384,
        });
        expect(result["findings"]).toEqual([]);
        // Das Ergebnis ist klein und JSON (es landet in der Zeile des Jobs).
        expect(JSON.stringify(result).length).toBeLessThan(2000);
        expect((await readFile(join(root, String(derivatives[0]?.["key"])))).length).toBe(derivatives[0]?.["byteSize"]);
    });

    it("ein abgelegtes Original wird neu gerendert, auch erst nach der Freigabe (publish: true)", async () => {
        const original = await png(patternImage(300, 200));
        const first = await runMediaDerive(
            fakeContext({ role: "header", publish: false, incoming: await upload("b.bin", original) }).context,
        );
        expect(first["derivatives"]).toEqual([]);
        const sha = (first["source"] as Record<string, unknown>)["sha256"];
        const second = await runMediaDerive(
            fakeContext({ role: "header", publish: true, sourceSha256: sha, sourceExtension: "png" }).context,
        );
        expect((second["derivatives"] as Record<string, unknown>[])[0]).toMatchObject({
            variant: "header_16_9",
            width: 300,
            height: 169,
        });
        expect((second["source"] as Record<string, unknown>)["written"]).toBe(false);
    });

    it("🔴 eine Abweisung endet als Fehler mit dem Code, nie wiederholbar", async () => {
        const cases: [string, Uint8Array, string][] = [
            [
                "svg-text.bin",
                new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>'),
                "svg_has_text",
            ],
            ["anim.bin", minimalGif(3), "animated_or_multiframe"],
            ["html.bin", new TextEncoder().encode("<html></html>"), "unsupported_format"],
        ];
        for (const [name, bytes, code] of cases) {
            const { context, recorded } = fakeContext({
                role: "coat",
                publish: true,
                incoming: await upload(name, bytes),
            });
            await expect(runMediaDerive(context)).rejects.toMatchObject({ name: "JobFailure", code, retryable: false });
            expect(recorded.phases.slice(0, 2)).toEqual(["read", "inspect"]);
        }
    });

    it("eine fehlende Quelle ist source_missing; eine zu große Datei wird nie gelesen (too_large_bytes)", async () => {
        const { context } = fakeContext({ role: "coat", publish: true, incoming: "incoming/gibt-es-nicht" });
        await expect(runMediaDerive(context)).rejects.toMatchObject({ code: "source_missing", retryable: false });
        const big = await upload("gross.bin", Buffer.alloc(MAX_SOURCE_BYTES + 1, 1));
        await expect(
            runMediaDerive(fakeContext({ role: "coat", publish: true, incoming: big }).context),
        ).rejects.toMatchObject({ code: "too_large_bytes" });
    });

    it("🔴 ein abgelegtes Original, dessen Bytes nicht zu seinem Namen passen, ist source_corrupt", async () => {
        const original = await png(patternImage(64, 64));
        const first = await runMediaDerive(
            fakeContext({ role: "coat", publish: false, incoming: await upload("c.bin", original) }).context,
        );
        const source = first["source"] as { key: string; sha256: string };
        await writeFile(join(root, source.key), await png(patternImage(65, 64)));
        await expect(
            runMediaDerive(
                fakeContext({ role: "coat", publish: true, sourceSha256: source.sha256, sourceExtension: "png" })
                    .context,
            ),
        ).rejects.toMatchObject({ code: "source_corrupt", retryable: false });
    });

    it("ein SVG als Original: privat, öffentlich nur das Raster; der Befund svg_source steht im Ergebnis", async () => {
        const result = await runMediaDerive(
            fakeContext({
                role: "coat",
                publish: true,
                incoming: await upload("s.bin", new TextEncoder().encode(GRADIENT_SVG)),
            }).context,
        );
        expect(result["format"]).toBe("svg");
        expect(result["findings"]).toEqual([{ code: "svg_source", detail: expect.any(String) }]);
        expect((result["derivatives"] as Record<string, unknown>[])[0]?.["mimeType"]).toBe("image/webp");
    });

    it("ohne MEDIA_ROOT: media_root_missing, nicht wiederholbar", async () => {
        delete process.env["MEDIA_ROOT"];
        const { context } = fakeContext({ role: "coat", publish: true, incoming: "incoming/x" });
        await expect(runMediaDerive(context)).rejects.toMatchObject({ code: "media_root_missing", retryable: false });
    });

    it("🔴 schreibt keine Datenbankzeile: das Modul kennt keinen Datenbankzugriff", async () => {
        const source = await readFile(new URL("../src/jobs/media-derive.ts", import.meta.url), "utf8");
        expect(source).not.toMatch(/from "\.\.\/database\.ts"|from "postgres"|INSERT INTO|UPDATE /);
        const ingest = await readFile(new URL("../src/media/raster/ingest.ts", import.meta.url), "utf8");
        expect(ingest).not.toMatch(/database|postgres|INSERT INTO/i);
    });
});
