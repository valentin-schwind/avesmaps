import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Das eigene Konto (WI-0120 A9, AUTH-0001 §6.6, §12.2): Übersicht ohne Geheimnisse, andere Sitzungen beenden (nie die laufende),
 * Anzeigename mit Revision und bereinigt (T20), Discord lösen nur frisch bestätigt und nur, wenn ein Passwort bleibt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Eigenes Konto", { timeout: 90_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;

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
            logStream: { write: () => undefined },
        });
        await instance.ready();
        return instance;
    }

    const post = (url: string, cookie: string, payload: object) =>
        app!.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 Übersicht: eigene Sitzungen mit „diese“, kein Hash, kein Token, ohne Anmeldung 401", async () => {
        app = await build();
        const person = await fixture.person("editor", { name: "Kontoinhaberin" });
        const here = await fixture.session(person.id);
        await fixture.session(person.id, { method: "password", assurance: "basic" });
        expect((await app.inject({ method: "GET", url: "/api/account" })).statusCode).toBe(401);
        const response = await app.inject({ method: "GET", url: "/api/account", headers: { cookie: here.cookie } });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const body = response.json();
        expect(body.person).toMatchObject({ id: person.id, self: true, manageable: false, activeSessions: 2 });
        expect(body.sessions.filter((entry: { current: boolean }) => entry.current)).toEqual([
            expect.objectContaining({ id: here.id }),
        ]);
        expect(response.body).not.toContain(here.token);
        expect(response.body).not.toMatch(/token_hash|password_hash|\$argon2id/u);
    });

    it("🔴 andere Sitzungen beenden, die laufende nie; Wiederholung liefert die Quittung", async () => {
        app = await build();
        const person = await fixture.person("tester");
        const here = await fixture.session(person.id);
        const other = await fixture.session(person.id);
        const current = await post("/api/account/sessions/revoke", here.cookie, {
            operationId: randomUUID(),
            sessionId: here.id,
        });
        expect(current.json().error.code).toBe("current_session");
        const operationId = randomUUID();
        const ended = await post("/api/account/sessions/revoke", here.cookie, { operationId });
        expect(ended.json()).toMatchObject({ status: "applied", affected: [{ kind: "session", id: other.id }] });
        const again = await post("/api/account/sessions/revoke", here.cookie, { operationId });
        expect(again.json().status).toBe("replayed");
        expect(
            (await app.inject({ method: "GET", url: "/api/account", headers: { cookie: other.cookie } })).statusCode,
        ).toBe(401);
        expect(
            (await app.inject({ method: "GET", url: "/api/account", headers: { cookie: here.cookie } })).statusCode,
        ).toBe(200);
    });

    it("🔴 Anzeigename: bereinigt, mit Revision; veraltet 409 edit_conflict", async () => {
        app = await build();
        const person = await fixture.person("editor", { name: "Alter Name" });
        const { cookie } = await fixture.session(person.id);
        const rename = (displayName: string, baseRevision: number) =>
            post("/api/account/display-name", cookie, { operationId: randomUUID(), displayName, baseRevision });
        const first = await rename(`  Neuer\u202e Name\u0007  `, 1);
        expect(first.json().affected).toEqual([{ kind: "person", id: person.id, revision: 2 }]);
        const [row] = await database<{ display_name: string }[]>`
            SELECT display_name FROM avesmaps_auth.person WHERE id = ${person.id}
        `;
        expect(row?.display_name).toBe("Neuer Name");
        const stale = await rename("Dritter Name", 1);
        expect(stale.json().error).toMatchObject({ code: "edit_conflict", details: { currentRevision: 2 } });
        expect((await rename("\u200b\u200f", 2)).json().error.code).toBe("display_name_invalid");
    });

    it("🔴 Discord lösen: nur frisch bestätigt und nur, wenn ein Passwort bleibt", async () => {
        app = await build();
        const person = await fixture.person("editor");
        await database`
            INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id)
            VALUES (${person.id}, ${`3${String(Math.floor(Math.random() * 1e16)).padStart(17, "0")}`})
        `;
        const stale = await fixture.session(person.id, { confirmedMinutesAgo: 30 });
        const fresh = await fixture.session(person.id);
        const unlink = (cookie: string) => post("/api/account/discord/unlink", cookie, { operationId: randomUUID() });
        expect((await unlink(stale.cookie)).json().error).toMatchObject({
            code: "reauth_required",
            details: { need: "confirmation" },
        });
        expect((await unlink(fresh.cookie)).json().error.code).toBe("last_login_method");
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${person.id}, ${`k-${person.id.slice(0, 8)}`}, '$argon2id$v=19$m=19456,t=2,p=1$platzhalter')
        `;
        expect((await unlink(fresh.cookie)).statusCode).toBe(200);
        const [left] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.discord_login WHERE person_id = ${person.id}
        `;
        expect(left?.n).toBe(0);
    });
});
