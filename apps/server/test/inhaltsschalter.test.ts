import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    CONTENT_SWITCHES,
    contentSwitchSpec,
    mediaSwitchKeys,
    type AdminContentSwitches,
    type ContentState,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { InhaltsschalterStore, SCHALTBARE_SERIEN, istAus, type Inhaltsstand } from "../src/system/inhaltsschalter.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Inhaltsschalter, Teil a (WI-0127 SYS-10, SYS-0001 §3.4, §4.2): Katalog, Fehlerrichtung, Umschalten und der öffentliche Lesepfad.
 * Die Wirkungsorte (Veröffentlichung der Medien, Wappenliste, Suche, Abschnitte, Serien) prüft Teil b je Schalter.
 */

const BEKANNT = { licenseFamilies: ["cc-by", "cc-by-sa"], series: ["original"] };

describe("Katalog und Fehlerrichtung (ohne Datenbank)", () => {
    it("🔴 feste Schalter, Lizenzfamilien und Serien nur, wenn es sie gibt; sonst unbekannt", () => {
        expect(contentSwitchSpec("media.role.coat", BEKANNT)).toMatchObject({ group: "media_role", failure: "closed" });
        expect(contentSwitchSpec("panel.literature", BEKANNT)).toMatchObject({ group: "panel", failure: "last_known" });
        expect(contentSwitchSpec("media.license.cc-by", BEKANNT)).toMatchObject({
            group: "media_rights",
            failure: "closed",
        });
        expect(contentSwitchSpec("media.license.cc-zero", BEKANNT)).toBeUndefined();
        expect(contentSwitchSpec("map.series.original", BEKANNT)).toMatchObject({
            group: "map",
            failure: "last_known",
        });
        expect(contentSwitchSpec("map.series.modern", BEKANNT)).toBeUndefined();
        expect(contentSwitchSpec("map.series.old", { ...BEKANNT, series: SCHALTBARE_SERIEN })).toBeUndefined();
        expect(contentSwitchSpec("map.ganze_karte", BEKANNT)).toBeUndefined();
        // Die Serien, die Besucher sehen (Blatt A5); die Editor-Serie „old“ steht nicht im Katalog.
        expect([...SCHALTBARE_SERIEN].sort()).toEqual(["modern", "original"]);
        expect(new Set(CONTENT_SWITCHES.map((entry) => entry.key)).size).toBe(CONTENT_SWITCHES.length);
    });

    it("die Schalter eines Medienstands: Art, Rechtsgrund oder Lizenzfamilie, „ungeklärt“ nach dem Prüfstand", () => {
        expect(
            mediaSwitchKeys({ role: "map_full", rightsBasis: "permission", licenseFamily: null, clearance: "cleared" }),
        ).toEqual(["media.role.map_preview", "media.rights.permission"]);
        expect(
            mediaSwitchKeys({
                role: "coat",
                rightsBasis: "license",
                licenseFamily: "cc-by",
                clearance: "needs_review",
            }),
        ).toEqual(["media.role.coat", "media.license.cc-by", "media.rights.unclear"]);
        expect(
            mediaSwitchKeys({ role: "header", rightsBasis: "unknown", licenseFamily: null, clearance: null }),
        ).toEqual(["media.role.header"]);
    });

    it("🔴 nie gelesen: Bilder aus, Abschnitte und Serien an; gelesen: was die Tafel sagt; ein unbekannter Schlüssel ist nie aus", () => {
        const nie: Inhaltsstand = {
            source: "unknown",
            revision: null,
            zeilen: new Map(),
            bekannt: BEKANNT,
            unknownKeys: [],
        };
        expect(istAus(nie, "media.role.coat")).toBe(true);
        expect(istAus(nie, "media.license.cc-by")).toBe(true);
        expect(istAus(nie, "panel.reviews")).toBe(false);
        expect(istAus(nie, "map.series.original")).toBe(false);
        const gelesen: Inhaltsstand = {
            source: "database",
            revision: 3,
            zeilen: new Map([
                ["panel.reviews", { enabled: false, changedAt: new Date(), changedBy: "Rondrikan" }],
                ["media.role.coat", { enabled: true, changedAt: new Date(), changedBy: "Rondrikan" }],
            ]),
            bekannt: BEKANNT,
            unknownKeys: [],
        };
        expect(istAus(gelesen, "panel.reviews")).toBe(true);
        expect(istAus(gelesen, "media.role.coat")).toBe(false);
        expect(istAus(gelesen, "media.role.header")).toBe(false);
        expect(istAus(gelesen, "gibt.es.nicht")).toBe(false);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys10-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Inhaltsschalter umschalten und lesen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let operatorBasic: { cookie: string };
    let admin: { cookie: string };

    const reset = async (): Promise<void> => {
        await database`UPDATE content_switch SET enabled = TRUE WHERE NOT enabled`;
        // Jeder Bilder-Schalter reiht einen Quarantäne-Abgleich ein (b3); ohne Worker bliebe er stehen und hielte `pending` wahr.
        await database`DELETE FROM job WHERE kind = 'media_quarantine'`;
        await database`
            UPDATE system_state SET system_lock = false, system_lock_since = NULL, system_lock_reason = NULL, map_lock = false, map_lock_since = NULL, map_lock_reason = NULL WHERE id = 1
        `;
        await app?.systemState?.refresh();
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string, assurance: "strong" | "basic" = "strong") => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, {
                assurance,
                passkeyMinutesAgo: assurance === "strong" ? 1 : null,
            });
            return { ...created, cookie };
        };
        operator = await person("operator", "Rondrikan");
        operatorBasic = await person("operator", "Ohne Faktor", "basic");
        admin = await person("admin", "Admina");
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const lies = async (cookie: string = admin.cookie): Promise<AdminContentSwitches> => {
        const response = await app.inject({
            method: "GET",
            url: "/api/admin/system/content-switches",
            headers: { cookie },
        });
        expect(response.statusCode).toBe(200);
        return response.json() as AdminContentSwitches;
    };
    const schalte = async (key: string, enabled: boolean, cookie = operator.cookie, baseRevision?: number) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/content-switches",
            payload: {
                operationId: randomUUID(),
                baseRevision: baseRevision ?? (await lies()).revision!,
                key,
                enabled,
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const ereignisse = async (): Promise<number> => {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.content_switch_changed'
        `;
        return row!.n;
    };
    const betriebsRevision = async (): Promise<number> => {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    };

    it("Lesen: alle Schalter an, mit Lizenzfamilien aus dem Katalog und der Serie „original“", async () => {
        const body = await lies();
        expect(body.source).toBe("database");
        expect(body.rows.every((row) => row.enabled)).toBe(true);
        expect(body.rows.map((row) => row.key)).toContain("media.license.cc-by");
        expect(body.rows.map((row) => row.key)).toContain("map.series.original");
        // Bilder-Schalter tragen eine Zahl (b3: gezählt wie Resolver und Quarantäne), Abschnitte und Serien keine.
        expect(body.rows.find((row) => row.key === "media.role.coat")?.visible).toEqual(expect.any(Number));
        expect(body.rows.find((row) => row.key === "panel.reviews")?.visible).toBeNull();
        expect(body.pending).toBe(false);
    });

    it("🔴 nur manage_system_settings mit Passkey; ein Admin und ohne zweiten Faktor: 403, nichts geändert", async () => {
        const vorher = await ereignisse();
        expect(code(await schalte("panel.reviews", false, admin.cookie))).toBe("403 forbidden");
        expect((await schalte("panel.reviews", false, operatorBasic.cookie)).statusCode).toBe(403);
        expect((await lies()).rows.find((row) => row.key === "panel.reviews")?.enabled).toBe(true);
        expect(await ereignisse()).toBe(vorher);
    });

    it("🔴 ausschalten: genau ein Ereignis, Inhaltsrevision steigt, die Revision des Betriebszustands nicht; der Lesepfad sagt es", async () => {
        const vorher = await ereignisse();
        const betrieb = await betriebsRevision();
        const revision = (await lies()).revision!;
        expect(code(await schalte("media.role.map_preview", false))).toBe("200");
        expect(await ereignisse()).toBe(vorher + 1);
        expect(await betriebsRevision()).toBe(betrieb);
        const body = await lies();
        expect(body.revision).toBe(revision + 1);
        expect(body.rows.find((row) => row.key === "media.role.map_preview")).toMatchObject({
            enabled: false,
            changedBy: "Rondrikan",
        });
        const offen = await app.inject({ method: "GET", url: "/api/content-state" });
        expect(offen.statusCode).toBe(200);
        expect(offen.headers["cache-control"]).toBe("no-cache");
        expect((offen.json() as ContentState).off).toEqual(["media.role.map_preview"]);
        const gleich = await app.inject({
            method: "GET",
            url: "/api/content-state",
            headers: { "if-none-match": String(offen.headers["etag"]) },
        });
        expect(gleich.statusCode).toBe(304);
        // Wieder an: der Lesepfad ist wieder leer, mit neuem ETag.
        expect(code(await schalte("media.role.map_preview", true))).toBe("200");
        const danach = await app.inject({ method: "GET", url: "/api/content-state" });
        expect((danach.json() as ContentState).off).toEqual([]);
        expect(danach.headers["etag"]).not.toBe(offen.headers["etag"]);
    });

    it("veraltete Revision 409 edit_conflict, unbekannter Schalter 400, gleiche Stellung 409 no_change", async () => {
        const revision = (await lies()).revision!;
        expect(code(await schalte("panel.reviews", false))).toBe("200");
        expect(code(await schalte("panel.literature", false, operator.cookie, revision))).toBe("409 edit_conflict");
        expect(code(await schalte("map.ganze_karte", false))).toBe("400 unknown_switch");
        expect(code(await schalte("panel.reviews", false))).toBe("409 no_change");
    });

    it("🔴 eine Kartenserie bleibt immer sichtbar: die letzte lässt sich nicht ausschalten (409 last_series)", async () => {
        expect(code(await schalte("map.series.original", false))).toBe("200");
        expect(code(await schalte("map.series.modern", false))).toBe("409 last_series");
        expect(code(await schalte("map.series.original", true))).toBe("200");
    });

    it("🔴 unter Systemsperre: ausschalten geht (schützt), einschalten nicht (423)", async () => {
        await database`
            UPDATE system_state SET system_lock = true, system_lock_since = now(), system_lock_reason = 'Wächter SYS-10' WHERE id = 1
        `;
        await app.systemState?.refresh();
        expect(code(await schalte("panel.citymaps", false))).toBe("200");
        expect(code(await schalte("panel.citymaps", true))).toBe("423 system_locked");
    });

    it("der Store: ohne neue Revision kein neues Lesen; ein unbekannter Schlüssel in der Tafel wird gemeldet und ignoriert", async () => {
        const warnungen: string[] = [];
        // Die Revision liest der Store aus der Datenbank; der Speicher des Betriebszustands entscheidet nur, wann neu gelesen wird.
        let revision = 0;
        const store = new InhaltsschalterStore({
            database,
            revision: () => revision,
            warn: (line) => warnungen.push(line),
        });
        await database`INSERT INTO content_switch (key, enabled) VALUES ('panel.gibt_es_nicht', false) ON CONFLICT (key) DO NOTHING`;
        const erst = await store.read();
        expect(erst.unknownKeys).toEqual(["panel.gibt_es_nicht"]);
        expect(warnungen).toHaveLength(1);
        // Ein Speicher, der hinterherhinkt, löst kein neues Lesen aus; eine neuere Revision schon.
        expect(await store.read()).toBe(erst);
        revision = erst.revision! + 1;
        expect(await store.read()).not.toBe(erst);
        await database`DELETE FROM content_switch WHERE key = 'panel.gibt_es_nicht'`;
    });
});
