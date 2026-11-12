import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UMGEBUNGEN_URL, type UmgebungenStand } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { gegenseiteAdresse, gegenseiteLeser } from "../src/system/gegenseite.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Stand der Umgebungen für das Umgebungsmenü (WI-0180 §9; Vertrag mit Claudio 2026-10-16). Die drei Sätze, auf die es ankommt:
 * 1. **Nur Betreiber** — auch ein Admin mit allen Sonderrechten bekommt den Stand nicht („Nur Betreiber“, WI-0180 §5.2).
 * 2. **Die Gegenseite fragt nur Loopback, kurz und selten** — Frist 1 s, Zwischenspeicher 30 s, Adresse nur aus der Konfiguration.
 * 3. **Weiter geht nur `releaseId` und „erreichbar“** — nie der rohe Inhalt, nie ein 500.
 */

const RELEASE = "20261016T143003Z-6e6dee0";
const antwort = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Gegenseite: Adresse, Frist und Zwischenspeicher", () => {
    it("🔴 nimmt nur Loopback; alles andere bleibt ungenutzt und wird einmal gemeldet", () => {
        const warn = vi.fn();
        expect(gegenseiteAdresse(undefined, warn)).toBeUndefined();
        expect(gegenseiteAdresse("  ", warn)).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        for (const adresse of [
            "http://127.0.0.1:3000/health",
            "http://localhost:3100/health",
            "http://[::1]:3000/health",
        ])
            expect(gegenseiteAdresse(adresse, warn)?.href, adresse).toBe(new URL(adresse).href);
        for (const adresse of [
            "https://avesmaps.de/health",
            "http://10.0.0.5:3000/health",
            "file:///etc/passwd",
            "kaputt",
        ])
            expect(gegenseiteAdresse(adresse, warn), adresse).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(4);
    });

    it("ohne Adresse ist die Gegenseite null und es wird nichts gefragt", async () => {
        const abrufen = vi.fn<typeof fetch>();
        expect(await gegenseiteLeser(undefined, { abrufen })()).toBeNull();
        expect(abrufen).not.toHaveBeenCalled();
    });

    it("🔴 gibt nur releaseId und erreichbar weiter; Fremdes im releaseId wird null", async () => {
        const url = "http://127.0.0.1:3000/health";
        expect(
            await gegenseiteLeser(url, {
                abrufen: async () => antwort({ status: "ok", releaseId: RELEASE, uptimeSeconds: 9 }),
            })(),
        ).toEqual({ releaseId: RELEASE, erreichbar: true });
        expect(await gegenseiteLeser(url, { abrufen: async () => antwort({ releaseId: "<b>dev</b>" }) })()).toEqual({
            releaseId: null,
            erreichbar: true,
        });
        expect(await gegenseiteLeser(url, { abrufen: async () => new Response("kein json") })()).toEqual({
            releaseId: null,
            erreichbar: true,
        });
    });

    it("🔴 eine Gegenseite, die fehlt, klemmt oder 503 sagt, ist „nicht erreichbar“, nie ein Fehler", async () => {
        const url = "http://127.0.0.1:3000/health";
        const nicht = { releaseId: null, erreichbar: false };
        expect(await gegenseiteLeser(url, { abrufen: async () => antwort({ releaseId: RELEASE }, 503) })()).toEqual(
            nicht,
        );
        expect(
            await gegenseiteLeser(url, {
                abrufen: async () => {
                    throw new TypeError("fetch failed");
                },
            })(),
        ).toEqual(nicht);
        // Die Frist greift wirklich: eine Gegenseite, die nie antwortet, hält die Route nicht auf.
        const haengt: typeof fetch = (_url, init) =>
            new Promise((_fertig, fehler) => init?.signal?.addEventListener("abort", () => fehler(new Error("abort"))));
        const beginn = Date.now();
        expect(await gegenseiteLeser(url, { abrufen: haengt, fristMs: 50 })()).toEqual(nicht);
        expect(Date.now() - beginn).toBeLessThan(1_000);
    });

    it("🔴 fragt höchstens alle 30 s, und gleichzeitige Fragen teilen sich eine", async () => {
        let jetzt = 1_000;
        const abrufen = vi.fn<typeof fetch>(async () => antwort({ releaseId: RELEASE }));
        const lesen = gegenseiteLeser("http://127.0.0.1:3000/health", { abrufen, jetzt: () => jetzt });
        await Promise.all([lesen(), lesen(), lesen()]);
        expect(abrufen).toHaveBeenCalledTimes(1);
        jetzt += 29_999;
        await lesen();
        expect(abrufen).toHaveBeenCalledTimes(1);
        jetzt += 1;
        await lesen();
        expect(abrufen).toHaveBeenCalledTimes(2);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("GET /api/admin/system/umgebungen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let gegenseite: Server;
    let betreiber: string;
    let admin: string;

    beforeAll(async () => {
        // Die Gegenseite ist ein echter Server auf Loopback, wie Production für die Stage.
        gegenseite = createServer((_anfrage, ant) => {
            ant.setHeader("content-type", "application/json");
            ant.end(JSON.stringify({ status: "ok", releaseId: RELEASE, uptimeSeconds: 42, geheim: "bleibt hier" }));
        });
        await new Promise<void>((fertig) => gegenseite.listen(0, "127.0.0.1", fertig));
        const port = (gegenseite.address() as AddressInfo).port;
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "20261016T152003Z-1722fd3",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
            umgebungen: { gegenseiteHealthUrl: `http://127.0.0.1:${String(port)}/health` },
        };
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const op = await fixture.person("operator", { name: "Rondrikan" });
        betreiber = (await fixture.session(op.id, { assurance: "strong" })).cookie;
        const ad = await fixture.person("admin", { name: "Admina" });
        // Ein Admin mit Sonderrechten, auch mit einem untergeschobenen `switch_environment`: Er bekommt den Stand trotzdem nicht.
        for (const capability of ["manage_system_settings", "release_to_production", "switch_environment"])
            await database`
                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
                VALUES (${ad.id}, 'test', ${capability}, 'Test WI-0180')
            `;
        admin = (await fixture.session(ad.id, { assurance: "strong" })).cookie;
    });

    afterAll(async () => {
        await app?.close();
        await new Promise((fertig) => gegenseite?.close(fertig));
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("🔴 der Betreiber bekommt den eigenen Stand und den der Gegenseite, ohne deren übrigen Inhalt, und nichts landet im Cache", async () => {
        const ant = await app.inject({ method: "GET", url: UMGEBUNGEN_URL, headers: { cookie: betreiber } });
        expect(ant.statusCode).toBe(200);
        const stand = ant.json() as UmgebungenStand;
        expect(stand.eigene).toEqual({ releaseId: "20261016T152003Z-1722fd3" });
        expect(stand.gegenseite).toEqual({ releaseId: RELEASE, erreichbar: true });
        // Die Adresse von Lokal kommt aus den privaten Karteneinstellungen; deren Speicher prüft `karteneinstellungen.test.ts`. Hier
        // nur, dass das Feld da ist: Dieselbe Datenbank teilen sich parallel laufende Dateien.
        expect(stand).toHaveProperty("lokal");
        expect(ant.body).not.toContain("bleibt hier");
        expect(ant.headers["cache-control"]).toBe("no-store");
    });

    it("🔴 ein Admin mit Sonderrechten bekommt ihn nicht; ohne Anmeldung auch nicht", async () => {
        expect((await app.inject({ method: "GET", url: UMGEBUNGEN_URL, headers: { cookie: admin } })).statusCode).toBe(
            403,
        );
        expect((await app.inject({ method: "GET", url: UMGEBUNGEN_URL })).statusCode).toBe(401);
    });
});
