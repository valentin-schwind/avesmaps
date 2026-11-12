import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
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
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * „Wiederherstellung beantragen“ gegen echtes PostgreSQL (WI-0124 KANAL-0001 W10, K5).
 *
 * - 🔴 Recht `request_restore`, Stufe S: der Betreiber mit frischem Passkey; ein Admin nur mit dem Sonderrecht, und auch er sieht den Kanal
 *   nicht; ohne frischen Passkey 403.
 * - 🔴 Der Antrag wird genau ein Vorgang der Art `wiederherstellung` (dringend, zuständig Claudio) und genau ein Ereignis
 *   `system.restore_requested` mit OPS-ID, Sicherung und Umfang, ohne den Grund. Dieselbe `operation_id` wiederholt nur.
 * - „Die letzte“ Sicherung bindet der Server an die Zeit der Statusdatei.
 * - Unter „Backups“ steht der offene Antrag für alle mit dem Recht, für andere nicht.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const FIXTURES = resolve(import.meta.dirname, "fixtures/sicherung");
const URL = "/api/admin/system/backup/wiederherstellung";

describeWithDatabase("Wiederherstellung beantragen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let base: string;
    let betreiber: { id: string; cookie: string };
    let betreiberAlt: { cookie: string };
    let admin: { cookie: string };
    let vertretung: { id: string; cookie: string };

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_kanal.vorgang WHERE art = 'wiederherstellung' AND environment = 'test'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await leeren();
        fixture = authFixture(database);
        base = await mkdtemp(join(tmpdir(), "wiederherstellung-"));
        const statusFile = join(base, "status.json");
        await copyFile(join(FIXTURES, "aktuell.json"), statusFile);
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "k5-test",
                databaseUrl: undefined,
                tileRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
                backup: { statusFile, requestDir: join(base, "requests") },
            } satisfies ServerConfig,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        const person = async (role: Role, name: string, passkeyMinutesAgo: number) => {
            const created = await fixture.person(role, { name });
            await database`
                INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
                VALUES (${created.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
            `;
            const { cookie } = await fixture.session(created.id, { passkeyMinutesAgo });
            return { ...created, cookie };
        };
        betreiber = await person("operator", "Rondrikan", 1);
        betreiberAlt = await person("operator", "Thomas", 60);
        admin = await person("admin", "Admina", 1);
        vertretung = await person("admin", "Vertretung", 1);
        await database`
            INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
            VALUES (${vertretung.id}, 'test', 'request_restore', 'Vertretung im Urlaub')
        `;
    });

    afterAll(async () => {
        await leeren().catch(() => undefined);
        await database`DELETE FROM avesmaps_auth.security_event WHERE action = 'system.restore_requested'`.catch(
            () => undefined,
        );
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(base, { recursive: true, force: true });
    });

    const beantrage = (cookie: string, patch: Record<string, unknown> = {}) =>
        app.inject({
            method: "POST",
            url: URL,
            payload: {
                operationId: randomUUID(),
                sicherung: "letzte",
                umfang: "datenbank",
                grund: "Nach dem Import fehlen 200 Orte.",
                ...patch,
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const backup = async (cookie: string): Promise<AdminSicherung> =>
        (
            await app.inject({ method: "GET", url: "/api/admin/system/backup", headers: { cookie } })
        ).json() as AdminSicherung;
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const ereignisse = () => database<{ details: Record<string, unknown>; target_ref: string }[]>`
        SELECT details, target_ref FROM avesmaps_auth.security_event WHERE environment = 'test' AND action = 'system.restore_requested'
         ORDER BY id
    `;

    it("🔴 Stufe S: ohne frischen Passkey 403, ein Admin ohne Sonderrecht 403; nichts entsteht", async () => {
        expect(code(await beantrage(betreiberAlt.cookie))).toMatch(/^403 (reauth_required|assurance_required)$/u);
        expect(code(await beantrage(admin.cookie))).toBe("403 forbidden");
        expect(await ereignisse()).toEqual([]);
        expect((await backup(admin.cookie)).wiederherstellung ?? null).toBeNull();
    });

    it("🔴 ein Vorgang der Art wiederherstellung und genau ein Ereignis ohne Grund; dieselbe operation_id wiederholt nur", async () => {
        const operationId = randomUUID();
        const erste = await beantrage(betreiber.cookie, { operationId, umfang: "datenbank_medien" });
        expect(code(erste)).toBe("200");
        const ops = (erste.json() as { affected: { id: string }[] }).affected[0]!.id;
        const wieder = await beantrage(betreiber.cookie, { operationId, umfang: "datenbank_medien" });
        expect((wieder.json() as { status: string }).status).toBe("replayed");

        const stand = await backup(betreiber.cookie);
        const letzte = stand.letzteErfolgreiche;
        const vorgaenge = await database<
            {
                art: string;
                prioritaet: string;
                zustaendig: string;
                status: string;
                nachricht: string;
                kontext: Record<string, string>;
            }[]
        >`
            SELECT art, prioritaet, zustaendig, status, nachricht, kontext FROM avesmaps_kanal.vorgang
             WHERE art = 'wiederherstellung' AND environment = 'test'
        `;
        expect(vorgaenge).toEqual([
            {
                art: "wiederherstellung",
                prioritaet: "dringend",
                zustaendig: "claudio",
                status: "neu",
                nachricht: "Nach dem Import fehlen 200 Orte.",
                kontext: { sicherung: `letzte:${String(letzte)}`, umfang: "datenbank_medien" },
            },
        ]);
        expect(await ereignisse()).toEqual([
            { details: { ops, sicherung: `letzte:${String(letzte)}`, umfang: "datenbank_medien" }, target_ref: ops },
        ]);
        // Unter „Backups“: der offene Antrag für den Betreiber und für die Vertretung mit dem Sonderrecht, nicht für einen Admin ohne.
        expect(stand.wiederherstellung).toMatchObject({ ops, status: "neu", umfang: "datenbank_medien" });
        expect((await backup(vertretung.cookie)).wiederherstellung).toMatchObject({ ops });
        expect((await backup(admin.cookie)).wiederherstellung ?? null).toBeNull();
    });

    it("🔴 ein Admin mit dem Sonderrecht beantragt, sieht aber den Kanal nicht; „eine ältere“ bleibt ohne Zeit", async () => {
        const antwort = await beantrage(vertretung.cookie, {
            sicherung: "aelter",
            umfang: "einstellungen",
            grund: "Stand von letzter Woche",
        });
        expect(code(antwort)).toBe("200");
        const ops = (antwort.json() as { affected: { id: string }[] }).affected[0]!.id;
        expect((await backup(vertretung.cookie)).wiederherstellung).toMatchObject({
            ops,
            sicherung: "aelter",
            umfang: "einstellungen",
        });
        const kanal = await app.inject({
            method: "GET",
            url: "/api/kanal/vorgaenge",
            headers: { cookie: vertretung.cookie },
        });
        expect(code(kanal)).toBe("403 forbidden");
    });

    it("ein Umfang außerhalb der drei Werte und ein leerer Grund kommen nicht an", async () => {
        expect((await beantrage(betreiber.cookie, { umfang: "alles" })).statusCode).toBe(400);
        expect((await beantrage(betreiber.cookie, { grund: "" })).statusCode).toBe(400);
    });
});
