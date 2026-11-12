import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import { hashPassword } from "../src/auth/password-hash.ts";
import { protect } from "../src/auth/plugin.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Benutzername und Passwort (WI-0120 A4, AUTH-0001 §6.4, §6.7, §11.2; Abnahme §16: manuelle Anmeldung, falsche Zugangsdaten,
 * Passwort-Reset, gesperrter Benutzer, Notzugang, Drossel, kein Konto-Orakel, Wiederholungsschutz).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SILENT = { write: (): void => undefined };
const PASSWORD = "Die Drachen von Gareth singen";

describeWithDatabase("Anmeldung mit Benutzername und Passwort", { timeout: 90_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const names: string[] = [];

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function build(): Promise<FastifyInstance> {
        const instance = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: SILENT,
        });
        instance.get("/api/admin/probe", { ...protect("manage_people") }, async () => ({ ok: true }));
        await instance.ready();
        return instance;
    }

    /** Eine Person mit Passwortweg; der Benutzername ist je Lauf eindeutig. */
    async function withPassword(role: "editor" | "admin" | "operator", options: { status?: "active" | "locked" } = {}) {
        const person = await fixture.person(role, options);
        const loginName = `t-${randomUUID().slice(0, 8)}`;
        names.push(loginName);
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${loginName}, ${await hashPassword(PASSWORD)})
        `;
        return { ...person, loginName };
    }

    const post = (url: string, payload: unknown, cookie?: string) =>
        app!.inject({
            method: "POST",
            url,
            payload: payload as object,
            headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
        });
    const cookieOf = (response: { headers: Record<string, unknown> }): string =>
        String([response.headers["set-cookie"]].flat().at(-1)).split(";")[0]!;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await database`DELETE FROM avesmaps_auth.access_link WHERE person_id IN (SELECT person_id FROM avesmaps_auth.password_login WHERE login_name = ANY(${names}))`;
        await database`DELETE FROM avesmaps_auth.password_login WHERE login_name = ANY(${names})`;
        await database`DELETE FROM avesmaps_auth.login_throttle`;
        await fixture.cleanup();
        names.length = 0;
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 richtige Zugangsdaten: Sitzung der Stufe R (basic), Cookie gesetzt, Anmeldung im Protokoll", async () => {
        app = await build();
        const editor = await withPassword("editor");
        const response = await post("/api/auth/login", {
            loginName: editor.loginName.toUpperCase(),
            password: PASSWORD,
        });
        expect(response.statusCode).toBe(200);
        const session = await app.inject({
            method: "GET",
            url: "/api/auth/session",
            headers: { cookie: cookieOf(response) },
        });
        expect(session.json().person).toMatchObject({
            id: editor.id,
            assurance: "basic",
            sessionMethod: "password",
            methods: ["password"],
        });
        const [event] = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM avesmaps_auth.security_event WHERE target_person_id = ${editor.id} AND action = 'login.success'
        `;
        expect(event?.details).toEqual({ method: "password", assurance: "basic" });
    });

    it("🔴 kein Konto-Orakel: unbekannter Name und falsches Passwort antworten gleich (T8)", async () => {
        app = await build();
        const editor = await withPassword("editor");
        const unknown = await post("/api/auth/login", { loginName: "gibt-es-nicht", password: PASSWORD });
        const wrong = await post("/api/auth/login", {
            loginName: editor.loginName,
            password: "falsches langes Passwort",
        });
        expect(unknown.statusCode).toBe(401);
        expect(wrong.statusCode).toBe(401);
        expect(unknown.json()).toEqual(wrong.json());
        expect(wrong.json().error.code).toBe("invalid_credentials");
    });

    it("🔴 Passwort allein trägt keine Verwaltungsrechte (T21)", async () => {
        app = await build();
        const admin = await withPassword("admin");
        const login = await post("/api/auth/login", { loginName: admin.loginName, password: PASSWORD });
        const probe = await app.inject({
            method: "GET",
            url: "/api/admin/probe",
            headers: { cookie: cookieOf(login) },
        });
        expect(probe.statusCode).toBe(403);
        expect(probe.json().error.code).toBe("assurance_required");
    });

    it("🔴 Drossel: ab dem sechsten Fehlversuch 429 mit Wartezeit, auch für Namen, die es nicht gibt", async () => {
        app = await build();
        const codes: number[] = [];
        for (let attempt = 0; attempt < 7; attempt += 1) {
            codes.push(
                (await post("/api/auth/login", { loginName: "niemand-hier", password: "falsches langes Passwort" }))
                    .statusCode,
            );
        }
        expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429]);
        const last = await post("/api/auth/login", { loginName: "niemand-hier", password: "falsches langes Passwort" });
        expect(last.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("🔴 gesperrt oder ohne Zugang: erst mit richtigem Passwort sagt die Antwort es", async () => {
        app = await build();
        const locked = await withPassword("editor", { status: "locked" });
        expect(
            (
                await post("/api/auth/login", { loginName: locked.loginName, password: "falsches langes Passwort" })
            ).json().error.code,
        ).toBe("invalid_credentials");
        expect(
            (await post("/api/auth/login", { loginName: locked.loginName, password: PASSWORD })).json().error.code,
        ).toBe("account_locked");
        const elsewhere = await withPassword("editor");
        await database`UPDATE avesmaps_auth.person_access SET status = 'revoked' WHERE person_id = ${elsewhere.id}`;
        expect(
            (await post("/api/auth/login", { loginName: elsewhere.loginName, password: PASSWORD })).json().error.code,
        ).toBe("no_access");
    });

    it("🔴 nach 100 Fehlversuchen in Folge ist nur der Passwortweg stillgelegt, bis ein Rücksetzlink ihn freigibt", async () => {
        app = await build();
        const editor = await withPassword("editor");
        await database`UPDATE avesmaps_auth.password_login SET failed_streak = 99 WHERE person_id = ${editor.id}`;
        expect(
            (await post("/api/auth/login", { loginName: editor.loginName, password: "falsches langes Passwort" }))
                .statusCode,
        ).toBe(401);
        await database`DELETE FROM avesmaps_auth.login_throttle`;
        const disabled = await post("/api/auth/login", { loginName: editor.loginName, password: PASSWORD });
        expect(disabled.json().error.code).toBe("password_disabled");
        const events = await database<{ action: string }[]>`
            SELECT action FROM avesmaps_auth.security_event WHERE target_person_id = ${editor.id} ORDER BY id
        `;
        expect(events.map((event) => event.action)).toContain("password.disabled");
    });

    it("🔴 Rücksetzlink: ansehen verbraucht nicht, ein schwaches Passwort lässt ihn gültig, Einlösen beendet alte Sitzungen", async () => {
        app = await build();
        const editor = await withPassword("editor");
        const old = cookieOf(await post("/api/auth/login", { loginName: editor.loginName, password: PASSWORD }));
        const out: string[] = [];
        expect(
            await runAuthCli(
                ["ruecksetzlink", "--benutzer", editor.loginName],
                { AVESMAPS_ENV: "test", PUBLIC_ORIGIN: TEST_ORIGIN },
                {
                    out: (line) => out.push(line),
                    err: (line) => out.push(line),
                },
                { database, systemUser: "test" },
            ),
        ).toBe(0);
        const token = out.join("\n").match(/\/passwort#([A-Za-z0-9_-]{43})/u)![1]!;

        const inspect = await post("/api/auth/links/inspect", { token, kind: "password_reset" });
        expect(inspect.json()).toMatchObject({ displayName: editor.name, loginName: editor.loginName });
        expect((await post("/api/auth/password-reset", { token, password: "zu kurz" })).json().error.code).toBe(
            "password_rejected",
        );

        const reset = await post("/api/auth/password-reset", { token, password: "Ein neuer Satz für den Rondrakult" });
        expect(reset.statusCode).toBe(200);
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: old } })).json().person,
        ).toBeNull();
        expect(
            (await post("/api/auth/password-reset", { token, password: "Ein neuer Satz für den Rondrakult" })).json()
                .error.code,
        ).toBe("link_invalid");
        expect(
            (
                await post("/api/auth/login", {
                    loginName: editor.loginName,
                    password: "Ein neuer Satz für den Rondrakult",
                })
            ).statusCode,
        ).toBe(200);
        const cli = await database<{ actor_kind: string; actor_label: string }[]>`
            SELECT actor_kind, actor_label FROM avesmaps_auth.security_event WHERE target_person_id = ${editor.id} AND action = 'access_link.created'
        `;
        expect(cli).toEqual([{ actor_kind: "cli", actor_label: "cli:test" }]);
    });

    it("🔴 Erstkonto von der Kommandozeile, dann Notzugang: 60 Minuten Verwaltungsrechte ohne Discord (T15, T16)", async () => {
        app = await build();
        const loginName = `t-${randomUUID().slice(0, 8)}`;
        names.push(loginName);
        const out: string[] = [];
        const io = { out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
        const env = { AVESMAPS_ENV: "test", PUBLIC_ORIGIN: TEST_ORIGIN };
        expect(
            await runAuthCli(["einrichten", "--name", "Testbetreiberin", "--benutzer", loginName], env, io, {
                database,
                systemUser: "test",
            }),
        ).toBe(0);
        const setup = out.join("\n").match(/\/passwort#([A-Za-z0-9_-]{43})/u)![1]!;
        const first = await post("/api/auth/password-reset", { token: setup, password: PASSWORD, loginName });
        expect(first.statusCode).toBe(200);
        const [person] = await database<{ id: string }[]>`
            SELECT person_id AS id FROM avesmaps_auth.password_login WHERE login_name = ${loginName}
        `;
        // Für das Aufräumen: die Person gehört ab hier zur Fixture.
        await database`UPDATE avesmaps_auth.person SET display_name = display_name WHERE id = ${person!.id}`;

        out.length = 0;
        expect(
            await runAuthCli(["notzugang", "--benutzer", loginName], env, io, { database, systemUser: "test" }),
        ).toBe(0);
        const recovery = out.join("\n").match(/\/notzugang#([A-Za-z0-9_-]{43})/u)![1]!;
        expect(
            (await post("/api/auth/recovery", { token: recovery, password: "falsches langes Passwort" })).statusCode,
        ).toBe(401);
        const started = await post("/api/auth/recovery", { token: recovery, password: PASSWORD });
        expect(started.statusCode).toBe(200);
        const cookie = cookieOf(started);
        const session = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).json();
        expect(session.person).toMatchObject({ assurance: "recovery", sessionMethod: "recovery", role: "operator" });
        expect(new Date(session.person.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
        expect((await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie } })).statusCode).toBe(
            200,
        );

        await database`DELETE FROM avesmaps_auth.security_event WHERE target_person_id = ${person!.id} OR actor_person_id = ${person!.id}`;
        await database`DELETE FROM avesmaps_auth.session WHERE person_id = ${person!.id}`;
        await database`DELETE FROM avesmaps_auth.access_link WHERE person_id = ${person!.id}`;
        await database`DELETE FROM avesmaps_auth.password_login WHERE person_id = ${person!.id}`;
        await database`DELETE FROM avesmaps_auth.person_access WHERE person_id = ${person!.id}`;
        await database`DELETE FROM avesmaps_auth.person WHERE id = ${person!.id}`;
    });

    it("🔴 Passwort ändern: altes Passwort nötig, andere Sitzungen enden, Wiederholung liefert dieselbe Quittung", async () => {
        app = await build();
        const editor = await withPassword("editor");
        const other = cookieOf(await post("/api/auth/login", { loginName: editor.loginName, password: PASSWORD }));
        const mine = cookieOf(await post("/api/auth/login", { loginName: editor.loginName, password: PASSWORD }));
        const operationId = randomUUID();
        const wrong = await post(
            "/api/account/password",
            { operationId, currentPassword: "falsches langes Passwort", newPassword: "Ein ganz anderer langer Satz" },
            mine,
        );
        expect(wrong.json().error.code).toBe("current_password_wrong");

        const changed = await post(
            "/api/account/password",
            { operationId, currentPassword: PASSWORD, newPassword: "Ein ganz anderer langer Satz" },
            mine,
        );
        expect(changed.statusCode).toBe(200);
        expect(changed.json()).toMatchObject({ operationId, status: "applied", environment: "test" });
        const rotated = cookieOf(changed);
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: other } })).json().person,
        ).toBeNull();
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: rotated } })).json().person
                ?.id,
        ).toBe(editor.id);

        const replay = await post(
            "/api/account/password",
            {
                operationId,
                currentPassword: "Ein ganz anderer langer Satz",
                newPassword: "Ein ganz anderer langer Satz",
            },
            rotated,
        );
        expect(replay.json()).toMatchObject({ operationId, status: "replayed" });
        const different = await post(
            "/api/account/password",
            {
                operationId,
                currentPassword: "Ein ganz anderer langer Satz",
                newPassword: "Wieder ein anderer langer Satz",
                loginName: "anders",
            },
            rotated,
        );
        expect(different.json().error.code).toBe("idempotency_key_reused");
        const [count] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;
        expect(count?.n).toBe(1);
    });

    it("🔴 im Protokoll steht kein Passwort und kein Link", async () => {
        app = await build();
        const editor = await withPassword("editor");
        await post("/api/auth/login", { loginName: editor.loginName, password: PASSWORD });
        await post("/api/auth/login", { loginName: editor.loginName, password: "falsches langes Passwort" });
        const rows = await database<{ text: string }[]>`
            SELECT row_to_json(e)::text AS text FROM avesmaps_auth.security_event e WHERE target_person_id = ${editor.id}
        `;
        expect(rows.length).toBeGreaterThan(1);
        for (const { text } of rows) {
            expect(text).not.toContain(PASSWORD);
            expect(text).not.toContain("falsches langes Passwort");
            expect(text).not.toMatch(/argon2id/u);
        }
    });
});
