import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminSicherung, Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { AUFTRAG_DATEI } from "../src/system/sicherung.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Routen der Sicherung gegen echtes PostgreSQL (WI-0127 SYS-9, SYS-0001 §6.5, §9e).
 *
 * - Lesen darf der Admin (`view_operations`), anstoßen nur `run_backup` (Betreiber-Vorlage), Stufe V.
 * - „Sicherung jetzt“ legt genau die Auftragsdatei ab und schreibt genau ein Ereignis `system.backup_triggered` mit der `operation_id`;
 *   dieselbe Kennung bekommt dieselbe Quittung ohne zweite Datei; liegt schon ein Auftrag: 409 `backup_pending`.
 * - Ohne `BACKUP_REQUEST_DIR`: 503 `backup_unavailable`; lässt sich die Datei nicht schreiben: 503 `backup_write_failed`, beide ohne
 *   Ereignis.
 * - Das Lesemodell: „nicht eingerichtet“ ohne Statusdatei, sonst die Felder der Datei, dazu der liegende Auftrag.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const FIXTURES = resolve(import.meta.dirname, "fixtures/sicherung");

function config(backup: ServerConfig["backup"]): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys9-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        backup,
    };
}

describeWithDatabase("Sicherung: Lesen und „Sicherung jetzt“ (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let base: string;
    let requests: string;
    let statusFile: string;
    const apps: FastifyInstance[] = [];
    let mit: FastifyInstance;
    let ohne: FastifyInstance;
    let kaputt: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };
    let operatorBasic: { cookie: string };

    async function build(backup: ServerConfig["backup"]): Promise<FastifyInstance> {
        const app = buildApp({
            config: config(backup),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        apps.push(app);
        return app;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        base = await mkdtemp(join(tmpdir(), "sicherung-routes-"));
        requests = join(base, "shared", "requests");
        statusFile = join(base, "status.json");
        await writeFile(join(base, "datei"), "x");
        mit = await build({ statusFile, requestDir: requests });
        ohne = await build({ statusFile: undefined, requestDir: undefined });
        kaputt = await build({ statusFile: undefined, requestDir: join(base, "datei", "requests") });
        const person = async (role: Role, name: string, assurance: "strong" | "basic" = "strong") => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, {
                assurance,
                passkeyMinutesAgo: assurance === "strong" ? 60 : null,
            });
            return { ...created, cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
        operatorBasic = await person("operator", "Ohne Faktor", "basic");
    });

    afterAll(async () => {
        for (const app of apps) await app.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(base, { recursive: true, force: true });
    });

    const get = (app: FastifyInstance, cookie: string) =>
        app.inject({ method: "GET", url: "/api/admin/system/backup", headers: { cookie } });
    const start = (app: FastifyInstance, cookie: string, operationId: string = randomUUID()) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/backup/start",
            payload: { operationId },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const events = async (operationId?: string): Promise<number> => {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.backup_triggered'
               AND (${operationId ?? null}::text IS NULL OR operation_id::text = ${operationId ?? null})
        `;
        return row!.n;
    };

    it("ohne Statusdatei und ohne Verzeichnis: „nicht eingerichtet“, kein Fehler; der Knopf ist aus", async () => {
        const response = await get(ohne, admin.cookie);
        expect(response.statusCode).toBe(200);
        const body = response.json() as AdminSicherung;
        expect(body).toMatchObject({
            zustand: "nicht_eingerichtet",
            letzterLauf: null,
            teile: [],
            anstossen: { moeglich: false, wartend: null, letzteAntwort: null },
        });
        expect(code(await start(ohne, operator.cookie))).toBe("503 backup_unavailable");
    });

    it("mit Statusdatei: die Felder des Lesemodells, die letzte Antwort von Claudios Seite", async () => {
        await copyFile(join(FIXTURES, "aktuell.json"), statusFile);
        const body = (await get(mit, admin.cookie)).json() as AdminSicherung;
        expect(body.zustand === "aktuell" || body.zustand === "ueberfaellig").toBe(true);
        expect(body.teile).toHaveLength(3);
        expect(body.anstossen).toMatchObject({ moeglich: true, wartend: null, letzteAntwort: { result: "zu_frueh" } });
    });

    it("🔴 nur run_backup stößt an; ohne zweiten Faktor 403; nichts liegt danach", async () => {
        const vorher = await events();
        expect(code(await start(mit, admin.cookie))).toBe("403 forbidden");
        expect((await start(mit, operatorBasic.cookie)).statusCode).toBe(403);
        await expect(readFile(join(requests, AUFTRAG_DATEI), "utf8")).rejects.toThrow();
        expect(await events()).toBe(vorher);
    });

    it("🔴 „Sicherung jetzt“: genau die Datei und genau ein Ereignis; dieselbe Kennung nochmal: dieselbe Quittung; ein zweiter Auftrag: 409", async () => {
        const vorher = await events();
        const operationId = randomUUID();
        const first = await start(mit, operator.cookie, operationId);
        expect(code(first)).toBe("200");
        expect(JSON.parse(await readFile(join(requests, AUFTRAG_DATEI), "utf8"))).toEqual({
            operation_id: operationId,
            requested_at: expect.any(String),
        });
        expect(await events(operationId)).toBe(1);

        const replay = await start(mit, operator.cookie, operationId);
        expect(code(replay)).toBe("200");
        expect((replay.json() as { status: string }).status).toBe("replayed");
        expect(await events(operationId)).toBe(1);

        expect(code(await start(mit, operator.cookie))).toBe("409 backup_pending");
        expect(await events()).toBe(vorher + 1);

        // Das Lesemodell zeigt den liegenden Auftrag (die Anzeige sagt nach 60 s „noch nicht abgeholt“).
        const body = (await get(mit, admin.cookie)).json() as AdminSicherung;
        expect(body.anstossen.wartend?.operationId).toBe(operationId);

        // Claudios Seite holt ab: Die Datei ist weg, ein neuer Auftrag geht wieder.
        await unlink(join(requests, AUFTRAG_DATEI));
        expect(code(await start(mit, operator.cookie))).toBe("200");
        expect(await events()).toBe(vorher + 2);
        await unlink(join(requests, AUFTRAG_DATEI));
    });

    it("🔴 lässt sich die Datei nicht schreiben: 503 backup_write_failed ohne Ereignis", async () => {
        const vorher = await events();
        expect(code(await start(kaputt, operator.cookie))).toBe("503 backup_write_failed");
        expect(await events()).toBe(vorher);
    });
});
