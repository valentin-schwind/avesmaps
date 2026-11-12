import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createAccessLink } from "../src/auth/access-links.ts";
import { keepAnOperator } from "../src/auth/admin-guard.ts";
import { createInvitation } from "../src/auth/invitations.ts";
import { hashPassword } from "../src/auth/password-hash.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { throttleAddress } from "../src/log-address.ts";
import { SESSION_COOKIE, TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Härtung (WI-0120 A12, AUTH-0001 §10.3 und §16): was die Abbildung der Bedrohungen auf die Tests als offen gezeigt hat. Echte
 * Datenbank, echte Routen, das Protokoll des Servers mitgeschnitten.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSWORT = "Ein Satz aus vielen Wörtern für Gareth";

describe("Drosselschlüssel (T7)", () => {
    it("🔴 IPv6 zählt je /64, IPv4 je Adresse, eine IPv4 in IPv6-Schreibweise wie IPv4", () => {
        expect(throttleAddress("2001:db8:a12:1::1")).toBe(throttleAddress("2001:db8:a12:1:ffff:ffff:ffff:ffff"));
        expect(throttleAddress("2001:db8:a12:1::1")).not.toBe(throttleAddress("2001:db8:a12:2::1"));
        expect(throttleAddress("192.0.2.7")).toBe("192.0.2.7");
        expect(throttleAddress("::ffff:192.0.2.7")).toBe("192.0.2.7");
    });
});

describeWithDatabase("Härtung der Anmeldung", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const logs: string[] = [];
    const names: string[] = [];

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "a12-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    });

    async function build(): Promise<FastifyInstance> {
        const instance = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: (line: string) => void logs.push(line) },
        });
        await instance.ready();
        return instance;
    }

    const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
        app!.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, ...headers } });
    const sessionCookie = (response: { headers: Record<string, unknown> }): string | undefined => {
        const raw = response.headers["set-cookie"];
        const list = Array.isArray(raw) ? raw.map(String) : raw === undefined ? [] : [String(raw)];
        const match = list.map((line) => new RegExp(`^${SESSION_COOKIE}=([^;]*)`, "u").exec(line)).find(Boolean);
        return match?.[1];
    };

    /** Eine Person mit Benutzername und Passwort. */
    async function withPassword(role: "editor" | "admin" | "operator" | "tester", name: string) {
        const person = await fixture.person(role, { name });
        const loginName = `a12-${String(names.length)}-${String(Date.now())}`.slice(0, 40);
        names.push(loginName);
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${loginName}, ${await hashPassword(PASSWORT)})
        `;
        return { ...person, loginName };
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        logs.length = 0;
    });

    afterAll(async () => {
        await database`DELETE FROM avesmaps_auth.login_throttle`;
        await fixture.cleanup();
        await database.end({ timeout: 5 });
    });

    it("🔴 T7: die Drossel je Client nennt in `Retry-After`, wann es wieder geht, und zählt das ganze /64", async () => {
        app = await build();
        const attempt = (n: number) =>
            post(
                "/api/auth/login",
                { loginName: `a12-unbekannt-${String(n)}`, password: "falsch-falsch-falsch" },
                { "x-forwarded-for": `2001:db8:a12:7::${n.toString(16)}` },
            );
        for (let n = 1; n <= 20; n += 1) expect((await attempt(n)).statusCode).toBe(401);
        const blocked = await attempt(21);
        expect(blocked.statusCode).toBe(429);
        expect(blocked.headers["retry-after"]).toBe("60");
        expect(blocked.json().error).toMatchObject({ code: "rate_limited", details: { retryAfterSeconds: 60 } });
    });

    it("🔴 T7: auch die Drossel je Name schickt `Retry-After`", async () => {
        app = await build();
        const person = await withPassword("editor", "A12-Drossel");
        let last;
        for (let n = 0; n < 7; n += 1) {
            last = await post(
                "/api/auth/login",
                { loginName: person.loginName, password: "falsch-falsch-falsch" },
                { "x-forwarded-for": `198.51.100.${String(n + 1)}` },
            );
        }
        expect(last!.statusCode).toBe(429);
        expect(Number(last!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    });

    it("🔴 T3: jede Anmeldung bekommt ein neues Token, auch über ein mitgebrachtes Cookie hinweg", async () => {
        app = await build();
        const person = await withPassword("editor", "A12-Rotation");
        const login = (cookie?: string) =>
            post(
                "/api/auth/login",
                { loginName: person.loginName, password: PASSWORT },
                cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` },
            );
        const first = sessionCookie(await login());
        const second = sessionCookie(await login(first));
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(second).not.toBe(first);
    });

    it("🔴 T4: eine Sitzung mit erreichtem Ende gilt nicht mehr (Notzugang nach 60 Minuten; gewöhnliche haben seit 2026-10-10 keins)", async () => {
        app = await build();
        const person = await fixture.person("editor", { name: "A12-Ablauf" });
        const idle = await fixture.session(person.id, { assurance: "recovery", method: "recovery" });
        const old = await fixture.session(person.id, { assurance: "recovery", method: "recovery" });
        await database`UPDATE avesmaps_auth.session SET idle_expires_at = now() - interval '1 second' WHERE id = ${idle.id}`;
        await database`UPDATE avesmaps_auth.session SET expires_at = now() - interval '1 second' WHERE id = ${old.id}`;
        for (const cookie of [idle.cookie, old.cookie]) {
            const response = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
            expect(response.json()).toMatchObject({ authEnabled: true, person: null });
            expect(String(response.headers["set-cookie"])).toMatch(new RegExp(`^${SESSION_COOKIE}=;`, "u"));
        }
    });

    it("🔴 T14: Passwort, Sitzungstoken, Einladungs- und Rücksetzlink stehen nie im Protokoll des Servers", async () => {
        app = await build();
        const person = await withPassword("editor", "A12-Protokoll");
        const login = await post("/api/auth/login", { loginName: person.loginName, password: PASSWORT });
        const token = sessionCookie(login)!;
        await app.inject({
            method: "GET",
            url: "/api/account",
            headers: { cookie: `${SESSION_COOKIE}=${token}` },
        });
        const link = await createAccessLink(database, {
            kind: "password_reset",
            personId: person.id,
            createdByCli: "a12-test",
        });
        const reset = await post("/api/auth/password-reset", { token: link.token, password: `${PASSWORT} neu` });
        expect(reset.statusCode).toBe(200);
        const invitation = await createInvitation(database, {
            environment: "test",
            role: "editor",
            validDays: 1,
            createdBy: null,
        });
        const accept = await post("/api/auth/invitations/accept", {
            token: invitation.token,
            loginName: `a12-gast-${String(Date.now())}`.slice(0, 40),
            displayName: "A12-Gast",
            password: `${PASSWORT} Gast`,
        });
        expect(accept.statusCode).toBe(200);
        const accepted = await database<{ id: string }[]>`
            SELECT person_id AS id FROM avesmaps_auth.password_login WHERE login_name LIKE 'a12-gast-%'
        `;
        for (const row of accepted) await database`DELETE FROM avesmaps_auth.session WHERE person_id = ${row.id}`;

        const all = logs.join("\n");
        expect(all.length).toBeGreaterThan(0);
        for (const secret of [
            PASSWORT,
            token,
            link.token,
            invitation.token,
            sessionCookie(reset)!,
            sessionCookie(accept)!,
        ]) {
            expect(all.includes(secret), `Geheimnis im Protokoll: ${secret.slice(0, 6)}…`).toBe(false);
        }
        expect(all).not.toMatch(/__Host-avesmaps-session=/u);
        await database`
            DELETE FROM avesmaps_auth.security_event WHERE actor_person_id IN (SELECT person_id FROM avesmaps_auth.password_login WHERE login_name LIKE 'a12-gast-%')
               OR target_person_id IN (SELECT person_id FROM avesmaps_auth.password_login WHERE login_name LIKE 'a12-gast-%')
        `;
        await database`
            DELETE FROM avesmaps_auth.person_access WHERE person_id IN (SELECT person_id FROM avesmaps_auth.password_login WHERE login_name LIKE 'a12-gast-%')
        `;
        await database`UPDATE avesmaps_auth.invitation SET accepted_person_id = NULL WHERE id = ${invitation.id}`;
        await database`DELETE FROM avesmaps_auth.invitation WHERE id = ${invitation.id}`;
        const gone = await database<{ id: string }[]>`
            DELETE FROM avesmaps_auth.password_login WHERE login_name LIKE 'a12-gast-%' RETURNING person_id AS id
        `;
        for (const row of gone) await database`DELETE FROM avesmaps_auth.person WHERE id = ${row.id}`;
    });

    it("🔴 T12: der letzte aktive Betreiber einer Umgebung bleibt (409 `last_operator`)", async () => {
        const operator = await fixture.person("operator", { name: "A12-Letzter" });
        const target = { id: operator.id, role: "operator", status: "active", access: "active" } as never;
        const rollback = new Error("zurück");
        await expect(
            database.begin(async (tx) => {
                // Alle anderen Betreiber dieser Umgebung für die Dauer der Probe abwählen; die Transaktion wird verworfen.
                await tx`
                    UPDATE avesmaps_auth.person_access SET status = 'revoked'
                     WHERE environment = 'test' AND role = 'operator' AND person_id <> ${operator.id}
                `;
                await expect(keepAnOperator(tx, "test", target)).rejects.toMatchObject({ code: "last_operator" });
                throw rollback;
            }),
        ).rejects.toBe(rollback);
        const second = await fixture.person("operator", { name: "A12-Zweiter" });
        await expect(keepAnOperator(database, "test", target)).resolves.toBeUndefined();
        expect(second.id).not.toBe(operator.id);
    });

    it("🔴 Audit: jede Verwaltungshandlung steht genau einmal im Protokoll, auch bei Wiederholung", async () => {
        app = await build();
        const operator = await fixture.person("operator", { name: "A12-Betreiberin" });
        const { cookie } = await fixture.session(operator.id, { passkeyMinutesAgo: 1 });
        const editor = await withPassword("editor", "A12-Ziel");
        const admin = await fixture.person("admin", { name: "A12-Admin" });
        const send = async (url: string, body: Record<string, unknown>) => {
            const operationId = randomUUID();
            const first = await post(url, { operationId, ...body }, { cookie });
            const again = await post(url, { operationId, ...body }, { cookie });
            expect([url, first.statusCode], JSON.stringify(first.json())).toEqual([url, 200]);
            expect([url, again.statusCode]).toEqual([url, 200]);
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
            `;
            expect([url, row?.n]).toEqual([url, 1]);
        };
        await send("/api/admin/people/lock", { personId: editor.id, reason: "Probe", baseRevision: 1 });
        await send("/api/admin/people/unlock", { personId: editor.id, baseRevision: 2 });
        await fixture.session(editor.id);
        await send("/api/admin/people/sessions/revoke", { personId: editor.id });
        await send("/api/admin/people/reset-link", { personId: editor.id });
        await send("/api/admin/people/role", { personId: editor.id, role: "reviewer", baseRevision: 1 });
        await send("/api/admin/people/capabilities/grant", {
            personId: admin.id,
            capability: "access_restricted_mode",
            reason: "Probe",
        });
        await send("/api/admin/people/capabilities/revoke", {
            personId: admin.id,
            capability: "access_restricted_mode",
            reason: "Probe",
        });
        await send("/api/admin/invitations", { role: "editor", validDays: 1, note: "A12-Probe" });
        await database`DELETE FROM avesmaps_auth.invitation WHERE note = 'A12-Probe'`;
    });

    it("🔴 §16: ein Passwort einrichten, ohne eines zu haben, braucht eine frische Bestätigung; danach geht die Anmeldung damit", async () => {
        app = await build();
        const person = await fixture.person("editor", { name: "A12-Ohne-Passwort" });
        const stale = await fixture.session(person.id, { confirmedMinutesAgo: 30 });
        const loginName = `a12-neu-${String(Date.now())}`.slice(0, 40);
        names.push(loginName);
        const body = { newPassword: PASSWORT, loginName };
        const refused = await post(
            "/api/account/password",
            { operationId: randomUUID(), ...body },
            { cookie: stale.cookie },
        );
        expect(refused.json().error).toMatchObject({ code: "reauth_required", details: { need: "confirmation" } });
        const fresh = await fixture.session(person.id, { confirmedMinutesAgo: 0 });
        const set = await post(
            "/api/account/password",
            { operationId: randomUUID(), ...body },
            { cookie: fresh.cookie },
        );
        expect(set.statusCode).toBe(200);
        expect((await post("/api/auth/login", { loginName, password: PASSWORT })).statusCode).toBe(200);
    });
});
