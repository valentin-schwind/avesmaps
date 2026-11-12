import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminSystemzustand, type Role } from "@avesmaps3d/shared";
import { buildApp, type BuildAppOptions } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { WorkerLebenszeichen } from "../src/jobs/lebenszeichen.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { OsMesswerte } from "../src/system/messwerte.ts";
import { createStichprobe, leseVerlauf, schreibeStichprobe } from "../src/system/stichprobe.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Systemzustand gegen echtes PostgreSQL (WI-0127 SYS-8, SYS-0001 §3.6, §3.7, §6.3).
 *
 * - Lesen darf, wer `view_operations` hat (Admin); ein Editor nicht.
 * - Ohne `system.json` stehen Dienste, Tür und Größen als unbekannt da („nicht eingerichtet“), nie als 0; mit frischer Datei die Werte;
 *   älter als 15 min: „veraltet“, und keine ihrer Zahlen gilt.
 * - Die Stichprobe: zwei Instanzen im selben 5-Minuten-Fach schreiben EINE Zeile; älter als 25 h wird im selben Zug gelöscht; der Verlauf
 *   zeigt die letzten 24 h, älteste zuerst.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SAMPLE: OsMesswerte = {
    last: { eins: 0.5, fuenf: 0.4, fuenfzehn: 0.3 },
    kerne: 4,
    speicher: { gesamt: 8_000_000_000, belegt: 3_000_000_000, auslagerung: null, auslagerungGesamt: null },
    laufzeit: { system: 1000, prozess: 10 },
    rss: 100_000_000,
};

function config(statusFile: string | undefined): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys8-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        systemzustand: { statusFile, martinUrl: undefined },
    };
}

const statusDatei = (generatedAt: Date) => ({
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    host: "stage-vps",
    disks: [{ mount: "/", size_bytes: 100, free_bytes: 10 }],
    door_probe: {
        from: "public",
        at: generatedAt.toISOString(),
        checks: [{ url: "/", expect: "302", got: "302", ms: 4 }],
    },
    services: { nginx: "active", martin: "active" },
    sizes: { at: generatedAt.toISOString(), tiles_bytes: 296, media_published_bytes: null },
});

describeWithDatabase("Systemzustand: Lesen und Stichprobe (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let base: string;
    let file: string;
    const apps: FastifyInstance[] = [];
    let app: FastifyInstance;
    let admin: { cookie: string };
    let editor: { cookie: string };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        base = await mkdtemp(join(tmpdir(), "systemzustand-"));
        file = join(base, "system.json");
        app = buildApp({
            config: config(file),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        apps.push(app);
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { ...created, cookie };
        };
        admin = await person("admin", "Admina");
        editor = await person("editor", "Editha");
    });

    beforeEach(async () => {
        await database`DELETE FROM system_sample`;
        await rm(file, { force: true });
    });

    afterAll(async () => {
        for (const entry of apps) await entry.close();
        await database`DELETE FROM system_sample`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(base, { recursive: true, force: true });
    });

    const get = async (cookie: string = admin.cookie, from: FastifyInstance = app) =>
        from.inject({ method: "GET", url: "/api/admin/system/health", headers: { cookie } });
    /** Eine frische Instanz: Der Leser speichert je Instanz 30 s zwischen. */
    const neueApp = async (extra: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> => {
        const instance = buildApp({
            config: config(file),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
            ...extra,
        });
        await instance.ready();
        apps.push(instance);
        return instance;
    };

    it("🔴 nur mit view_operations; ohne system.json: nicht eingerichtet, Dienste und Tür unbekannt, nie 0", async () => {
        expect((await get(editor.cookie)).statusCode).toBe(403);
        const response = await get();
        expect(response.statusCode).toBe(200);
        const body = response.json() as AdminSystemzustand;
        expect(Value.Check(AdminSystemzustand, body)).toBe(true);
        expect(body.datei).toMatchObject({ zustand: "nicht_eingerichtet", stand: null });
        const komponente = (id: string) => body.komponenten.find((entry) => entry.id === id);
        expect(komponente("fastify")?.zustand).toBe("gesund");
        expect(komponente("fastify")?.version).toMatch(/^Release sys8-test · Node \d+/u);
        expect(komponente("postgresql")?.zustand).toBe("gesund");
        expect(komponente("postgresql")?.version).toMatch(/^\d+.* · PostGIS \d/u);
        expect(komponente("postgresql")?.seit).not.toBeNull();
        expect(komponente("nginx")).toMatchObject({ zustand: "unbekannt", hinweis: "not_set_up" });
        expect(komponente("martin")).toMatchObject({ zustand: "unbekannt", hinweis: "not_configured" });
        expect(komponente("sicherung")).toMatchObject({ zustand: "unbekannt", hinweis: "backup_not_set_up" });
        expect(body.groessen).toBeNull();
        expect(body.tuer).toBeNull();
        expect(body.dienste).toEqual([]);
        expect(body.datenbank.groesse).toBeGreaterThan(0);
        expect(body.datenbank.tabellen.length).toBeGreaterThan(0);
        expect(body.auslastung.prozesse.find((entry) => entry.id === "jobs")?.rss).toBeNull();
        // Ohne Routing-Worker (keine Datenbankadresse) ist sein Speicher unbekannt; er ist ein Thread in Fastify (WI-0127 §22).
        expect(body.auslastung.prozesse.find((entry) => entry.id === "routing")).toEqual({
            id: "routing",
            rss: null,
            imProzess: "fastify",
            heap: null,
            graph: null,
        });
    });

    it("🔴 der Speicher des Jobs-Workers aus seinem Lebenszeichen (WI-0127 §22)", async () => {
        const jobLebenszeichen = new WorkerLebenszeichen({ database });
        const instance = await neueApp({ jobLebenszeichen });
        jobLebenszeichen.empfange(
            JSON.stringify({
                instanz: "stage:42",
                planer: true,
                release: "sys8-test",
                gemessen: new Date().toISOString(),
                taktMs: 10_000,
                rss: 85_000_000,
                kinder: { anzahl: 2, rss: 1_300_000_000 },
            }),
        );
        const body = (await get(admin.cookie, instance)).json() as AdminSystemzustand;
        expect(Value.Check(AdminSystemzustand, body)).toBe(true);
        expect(body.auslastung.prozesse.find((entry) => entry.id === "jobs")).toMatchObject({
            rss: 85_000_000,
            kinder: { anzahl: 2, rss: 1_300_000_000 },
        });
    });

    it("🔴 mit frischer Datei die Werte; älter als 15 min veraltet, und keine ihrer Zahlen gilt", async () => {
        await writeFile(file, JSON.stringify(statusDatei(new Date(Date.now() - 60_000))));
        const frisch = (await get(admin.cookie, await neueApp())).json() as AdminSystemzustand;
        expect(frisch.datei).toMatchObject({ zustand: "aktuell", host: "stage-vps" });
        expect(frisch.komponenten.find((entry) => entry.id === "nginx")?.zustand).toBe("gesund");
        expect(frisch.komponenten.find((entry) => entry.id === "nginx")?.hinweis).toBe("door_ok");
        expect(frisch.komponenten.find((entry) => entry.id === "martin")?.zustand).toBe("gesund");
        expect(frisch.auslastung.platten).toContainEqual({ id: "/", quelle: "datei", gesamt: 100, frei: 10 });
        expect(frisch.groessen).toMatchObject({ kacheln: 296, medienVeroeffentlicht: null });

        await writeFile(file, JSON.stringify(statusDatei(new Date(Date.now() - 20 * 60_000))));
        const alt = (await get(admin.cookie, await neueApp())).json() as AdminSystemzustand;
        expect(alt.datei.zustand).toBe("veraltet");
        expect(alt.komponenten.find((entry) => entry.id === "nginx")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "stale",
        });
        expect(alt.dienste).toEqual([]);
        expect(alt.groessen).toBeNull();
        expect(alt.auslastung.platten.filter((platte) => platte.quelle === "datei")).toEqual([]);
    });

    it("🔴 Stichprobe: zwei Instanzen im selben Fach schreiben eine Zeile; älter als 25 h fällt weg; der Verlauf zeigt 24 h", async () => {
        const at = new Date("2026-10-10T18:07:00Z");
        await database`INSERT INTO system_sample (bucket, load1) VALUES (${new Date(at.getTime() - 26 * 3_600_000)}, 1)`;
        await database`INSERT INTO system_sample (bucket, load1) VALUES (${new Date(at.getTime() - 3_600_000)}, 0.2)`;
        expect(await schreibeStichprobe(database, SAMPLE, at)).toBe(true);
        expect(await schreibeStichprobe(database, { ...SAMPLE, last: { eins: 9, fuenf: 9, fuenfzehn: 9 } }, at)).toBe(
            false,
        );
        const verlauf = await leseVerlauf(database, at);
        expect(verlauf.map((punkt) => [punkt.bucket, punkt.last1])).toEqual([
            ["2026-10-10T17:07:00.000Z", 0.2],
            ["2026-10-10T18:05:00.000Z", 0.5],
        ]);
        expect(verlauf[1]).toMatchObject({ belegt: 3_000_000_000, auslagerung: null });
        const [alle] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM system_sample`;
        expect(alle!.n).toBe(2);
    });

    it("der Takt schreibt beim Start sofort eine Stichprobe; ein Fehler kostet nur eine Zeile im Protokoll", async () => {
        const warnungen: string[] = [];
        const takt = createStichprobe({
            database,
            log: { warn: (_object, message) => warnungen.push(message) },
            messen: async () => SAMPLE,
            everyMs: 3_600_000,
        });
        takt.start();
        await expect
            .poll(async () => (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM system_sample`)[0]!.n)
            .toBe(1);
        takt.close();
        const kaputt = createStichprobe({
            database,
            log: { warn: (_object, message) => warnungen.push(message) },
            messen: async () => {
                throw new Error("kaputt");
            },
            everyMs: 3_600_000,
        });
        kaputt.start();
        await expect.poll(() => warnungen.length).toBe(1);
        kaputt.close();
    });
});
