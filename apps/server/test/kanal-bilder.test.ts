import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KanalVorgang, Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { runKanalBild } from "../src/kanal/bild-job.ts";
import { kanalAufbewahrung } from "../src/kanal/aufbewahrung.ts";
import { MediaStore, channelDirectory } from "../src/media/storage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Bilder im Betreiber-Kanal gegen echtes PostgreSQL und einen echten Medienspeicher (WI-0124, KANAL-0001 §6, K4).
 *
 * - 🔴 Nur `use_operator_channel`; SVG, Ausführbares und zu Großes weist der Server ab, auch ohne Verkleinern im Browser.
 * - 🔴 Hochladen legt das Original unter `private/kanal/<bild>/` ab, schreibt Zeile und Eintrag und reiht `kanal_bild` ein; dieselbe
 *   `operation_id` legt nichts zweites ab.
 * - 🔴 Der Job rendert `ansicht` und `vorschau` ohne EXIF; vorher antwortet die Auslieferung 409, danach `image/webp` mit `no-store`,
 *   `nosniff` und `default-src 'none'`. Das Original geht nie hinaus.
 * - Zwei Vorgänge mit demselben Foto: Die Aufbewahrung löscht nur das eigene Bild.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Ein Foto mit EXIF (Kamera und Ausrichtung), wie es ein Telefon schickt. */
async function foto(width = 1200, height = 800): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 150, b: 90 } } })
        .jpeg({ quality: 80 })
        .withExif({ IFD0: { Make: "Testkamera", Model: "Telefon 7", Copyright: "Hesindiane" } })
        .toBuffer();
}

describeWithDatabase("Betreiber-Kanal: Bilder (PostgreSQL, Medienspeicher)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let root: string;
    let betreiber: { id: string; cookie: string };
    let admin: { cookie: string };
    const vorher = { media: process.env["MEDIA_ROOT"], jobs: process.env["JOBS_DATABASE_URL"] };

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_kanal.bild`;
        await database`DELETE FROM avesmaps_kanal.eintrag`;
        await database`DELETE FROM avesmaps_kanal.vorgang`;
        await database`DELETE FROM job WHERE kind = 'kanal_bild'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        root = await mkdtemp(join(tmpdir(), "kanal-bilder-"));
        process.env["MEDIA_ROOT"] = root;
        process.env["JOBS_DATABASE_URL"] = testDatabaseUrl;
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "k4-test",
                databaseUrl: undefined,
                tileRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
                mediaRoot: root,
            },
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { ...created, cookie };
        };
        betreiber = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(root, { recursive: true, force: true });
        process.env["MEDIA_ROOT"] = vorher.media;
        process.env["JOBS_DATABASE_URL"] = vorher.jobs;
    });

    const post = (url: string, payload: Record<string, unknown>, cookie = betreiber.cookie) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const get = (url: string, cookie = betreiber.cookie) => app.inject({ method: "GET", url, headers: { cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const melde = async (): Promise<string> => {
        const antwort = await post("/api/kanal/vorgaenge", {
            operationId: randomUUID(),
            kategorie: "stoerung",
            prioritaet: "dringend",
            titel: "Stage lädt keine Kacheln",
            nachricht: "Die Karte bleibt grau.",
        });
        expect(code(antwort)).toBe("200");
        return (antwort.json() as { affected: { id: string }[] }).affected[0]!.id;
    };
    const lade = (ops: string, bytes: Buffer, operationId: string = randomUUID(), cookie = betreiber.cookie) =>
        post(
            `/api/kanal/vorgaenge/${ops}/bilder`,
            { operationId, file: { name: "foto.jpg", dataBase64: bytes.toString("base64") } },
            cookie,
        );
    const rechne = async (jobId: string): Promise<Record<string, unknown>> => {
        const [job] = await database<{ id: string; input_ref: Record<string, unknown> }[]>`
            SELECT id::text, input_ref FROM job WHERE public_id::text = ${jobId}
        `;
        return runKanalBild({
            input: job!.input_ref,
            attempt: 1,
            job: { id: Number(job!.id), publicId: jobId, leaseNo: null, mapDomainId: null },
            beginPhase: async () => undefined,
            checkpoint: () => undefined,
        });
    };
    const vorgang = async (ops: string): Promise<KanalVorgang> =>
        (await get(`/api/kanal/vorgaenge/${ops}`)).json() as KanalVorgang;

    it("🔴 nur use_operator_channel; SVG und eine Textdatei weist der Server ab, nichts liegt danach", async () => {
        const ops = await melde();
        expect(code(await lade(ops, await foto(), randomUUID(), admin.cookie))).toBe("403 forbidden");
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        );
        expect(code(await lade(ops, svg))).toBe("415 unsupported_media_type");
        expect(code(await lade(ops, Buffer.from("MZ\u0090\u0000 ausführbar")))).toBe("415 unsupported_media_type");
        const [zeilen] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM avesmaps_kanal.bild`;
        expect(zeilen!.n).toBe(0);
        expect(existsSync(join(root, "private", "kanal"))).toBe(false);
    });

    it("🔴 hochladen, rendern, ausliefern: Original privat, 409 vor dem Job, danach WebP ohne EXIF mit den Kopfzeilen", async () => {
        const ops = await melde();
        const operationId = randomUUID();
        const antwort = await lade(ops, await foto(), operationId);
        expect(code(antwort)).toBe("200");
        const derived = (antwort.json() as { derivedWork: { kind: string; jobId: string }[] }).derivedWork;
        expect(derived).toEqual([expect.objectContaining({ kind: "kanal_bild" })]);
        // Dieselbe Kennung legt nichts zweites ab.
        expect((await lade(ops, await foto(), operationId).then((r) => r.json())) as { status: string }).toMatchObject({
            status: "replayed",
        });

        const v = await vorgang(ops);
        expect(v.bilder).toHaveLength(1);
        const bild = v.bilder[0]!;
        expect(bild).toMatchObject({
            zustand: "wird_vorbereitet",
            format: "jpeg",
            breite: 1200,
            hoehe: 800,
            abgewiesenGrund: null,
        });
        expect(v.eintraege.filter((e) => e.art === "bild")).toEqual([expect.objectContaining({ bild: bild.id })]);
        expect(existsSync(join(root, channelDirectory(bild.id), "original.jpg"))).toBe(true);
        expect(code(await get(`/api/kanal/bilder/${bild.id}`))).toBe("409 kanal_bild_pending");

        expect(await rechne(derived[0]!.jobId)).toMatchObject({ zustand: "bereit" });
        expect((await vorgang(ops)).bilder[0]).toMatchObject({ zustand: "bereit" });
        const ansicht = await get(`/api/kanal/bilder/${bild.id}`);
        expect(ansicht.statusCode).toBe(200);
        expect(ansicht.headers["content-type"]).toBe("image/webp");
        expect(ansicht.headers["cache-control"]).toBe("no-store");
        expect(ansicht.headers["x-content-type-options"]).toBe("nosniff");
        expect(ansicht.headers["content-security-policy"]).toBe("default-src 'none'");
        const meta = await sharp(ansicht.rawPayload).metadata();
        expect(meta).toMatchObject({ format: "webp", width: 1200, height: 800 });
        expect(meta.exif).toBeUndefined();
        const vorschau = await sharp(
            (await get(`/api/kanal/bilder/${bild.id}?groesse=vorschau`)).rawPayload,
        ).metadata();
        expect(Math.max(vorschau.width!, vorschau.height!)).toBe(480);
        // Das Original geht nie hinaus; ohne Recht gibt es nichts.
        expect((await get(`/api/kanal/bilder/${bild.id}?groesse=original`)).statusCode).toBe(400);
        expect(code(await get(`/api/kanal/bilder/${bild.id}`, admin.cookie))).toBe("403 forbidden");
    });

    it("zwei Vorgänge mit demselben Foto: Bild entfernen und die Aufbewahrung löschen nur das eigene", async () => {
        const bytes = await foto(640, 480);
        const erster = await melde();
        const zweiter = await melde();
        const jobs: string[] = [];
        for (const ops of [erster, zweiter]) {
            const antwort = await lade(ops, bytes);
            jobs.push((antwort.json() as { derivedWork: { jobId: string }[] }).derivedWork[0]!.jobId);
        }
        for (const job of jobs) await rechne(job);
        const [a, b] = [(await vorgang(erster)).bilder[0]!, (await vorgang(zweiter)).bilder[0]!];
        expect(a.id).not.toBe(b.id);
        expect(code(await post(`/api/kanal/bilder/${a.id}/entfernen`, { operationId: randomUUID() }))).toBe("200");
        expect(code(await get(`/api/kanal/bilder/${a.id}`))).toBe("404 kanal_not_found");
        await kanalAufbewahrung(database, new MediaStore(root));
        expect(existsSync(join(root, channelDirectory(a.id)))).toBe(false);
        expect(existsSync(join(root, channelDirectory(b.id), "ansicht.webp"))).toBe(true);
        expect((await get(`/api/kanal/bilder/${b.id}`)).statusCode).toBe(200);
    });
});
