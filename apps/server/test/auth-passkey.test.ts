import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createAccessLink } from "../src/auth/access-links.ts";
import { protect } from "../src/auth/plugin.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { SoftAuthenticator } from "./support/soft-authenticator.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Passkeys im Ablauf (WI-0120 A6, ADR-0021, AUTH-0001 §11.2–11.4; Betreiber 2026-10-09 D2 B′): erster Passkey nur mit
 * Einrichtungslink oder Notzugang, weitere nur frisch bestätigt; Passwort plus Passkey ergibt Stufe V; Stufe S nur mit
 * frischem Passkey, auch nach Discord; Zählerrückschritt sperrt; Widerruf mit Quittung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const RP = { rpId: "avesmaps.test", origin: TEST_ORIGIN };

describeWithDatabase("Passkeys", { timeout: 90_000 }, () => {
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
        instance.get("/api/admin/probe", { ...protect("manage_people") }, async () => ({ ok: true }));
        instance.post("/api/admin/probe-system", { ...protect("assign_admin") }, async () => ({ ok: true }));
        await instance.ready();
        return instance;
    }

    const post = (url: string, cookie: string, payload: unknown = {}) =>
        app!.inject({ method: "POST", url, headers: { cookie, origin: TEST_ORIGIN }, payload: payload as object });
    const newCookie = (response: { headers: Record<string, unknown> }, fallback: string): string =>
        [response.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((c) => c.startsWith("__Host-avesmaps-session=") && !c.includes("Max-Age=0"))
            ?.split(";")[0] ?? fallback;

    /** Registriert einen Passkey über den Server; gibt das neue Cookie zurück. */
    async function register(cookie: string, authenticator: SoftAuthenticator, enrollmentToken?: string) {
        const body = enrollmentToken === undefined ? {} : { enrollmentToken };
        const options = await post("/api/account/passkeys/register/options", cookie, body);
        if (options.statusCode !== 200) return { response: options, cookie };
        const challenge = options.json().publicKey.challenge as string;
        const response = await post("/api/account/passkeys/register/verify", cookie, {
            credential: authenticator.register(challenge),
            label: "Testgerät",
            ...body,
        });
        return { response, cookie: newCookie(response, cookie) };
    }

    async function confirm(cookie: string, authenticator: SoftAuthenticator, tamper = {}) {
        const options = await post("/api/auth/passkey/confirm/options", cookie);
        if (options.statusCode !== 200) return { response: options, cookie };
        const response = await post("/api/auth/passkey/confirm/verify", cookie, {
            credential: authenticator.assert(options.json().publicKey.challenge as string, tamper),
        });
        return { response, cookie: newCookie(response, cookie) };
    }

    async function enrollmentLink(personId: string): Promise<string> {
        return (await createAccessLink(database, { kind: "passkey_enrollment", personId, createdByCli: "cli:test" }))
            .token;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
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

    it("🔴 der erste Passkey nur mit Einrichtungslink für genau diese Person (§11.4)", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const other = await fixture.person("admin");
        const { cookie } = await fixture.session(admin.id, { method: "discord", assurance: "strong" });
        const without = await register(cookie, new SoftAuthenticator(RP));
        expect(without.response.json().error.code).toBe("passkey_enrollment_required");
        const foreign = await register(cookie, new SoftAuthenticator(RP), await enrollmentLink(other.id));
        expect(foreign.response.json().error.code).toBe("passkey_enrollment_required");

        const token = await enrollmentLink(admin.id);
        const ok = await register(cookie, new SoftAuthenticator(RP), token);
        expect(ok.response.statusCode).toBe(200);
        const list = await app.inject({ method: "GET", url: "/api/account/passkeys", headers: { cookie: ok.cookie } });
        expect(list.json().passkeys).toHaveLength(1);
        // Der Link ist verbraucht: Eine andere Sitzung ohne frischen Passkey-Nachweis kommt mit ihm nicht mehr weiter.
        const later = await fixture.session(admin.id, { method: "discord", assurance: "strong" });
        expect((await register(later.cookie, new SoftAuthenticator(RP), token)).response.json().error.code).toBe(
            "passkey_enrollment_required",
        );
    });

    it("🔴 Passwort plus Passkey ergibt Stufe V; Stufe S nur mit frischem Passkey, auch nach Discord (D2 B′)", async () => {
        app = await build();
        const operator = await fixture.person("operator");
        const authenticator = new SoftAuthenticator(RP);
        const discord = await fixture.session(operator.id, { method: "discord", assurance: "strong" });
        const enrolled = await register(discord.cookie, authenticator, await enrollmentLink(operator.id));
        expect(enrolled.response.statusCode).toBe(200);

        // Nach Discord allein, ohne frischen Passkey: Stufe S verweigert.
        const fresh = await fixture.session(operator.id, { method: "discord", assurance: "strong" });
        expect((await post("/api/admin/probe-system", fresh.cookie)).json().error.details.need).toBe("passkey");
        const confirmed = await confirm(fresh.cookie, authenticator);
        expect(confirmed.response.statusCode).toBe(200);
        expect((await post("/api/admin/probe-system", confirmed.cookie)).statusCode).toBe(200);
        // Das alte Token gilt nach der Bestätigung nicht mehr (Rotation, Kap. 10.50).
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: fresh.cookie } })).json()
                .person,
        ).toBeNull();

        // Passwort allein (basic) → mit Passkey bestätigt: Stufe V.
        const password = await fixture.session(operator.id, { method: "password", assurance: "basic" });
        expect(
            (await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie: password.cookie } })).json()
                .error.code,
        ).toBe("assurance_required");
        const upgraded = await confirm(password.cookie, authenticator);
        expect(
            (await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie: upgraded.cookie } }))
                .statusCode,
        ).toBe(200);
    });

    it("🔴 einen weiteren Passkey nur frisch bestätigt mit einem vorhandenen; kein Aussperren durch ein Gerät", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const first = new SoftAuthenticator(RP);
        const session = await fixture.session(admin.id, { method: "discord", assurance: "strong" });
        const enrolled = await register(session.cookie, first, await enrollmentLink(admin.id));
        // Nach der Registrierung ist der Nachweis frisch: ein zweites Gerät geht sofort.
        const second = await register(enrolled.cookie, new SoftAuthenticator({ ...RP, algorithm: "EdDSA" }));
        expect(second.response.statusCode).toBe(200);
        // Ohne frischen Nachweis nicht.
        const later = await fixture.session(admin.id, {
            method: "discord",
            assurance: "strong",
            passkeyMinutesAgo: 30,
        });
        expect((await register(later.cookie, new SoftAuthenticator(RP))).response.json().error.code).toBe(
            "passkey_enrollment_required",
        );
        const list = await app.inject({
            method: "GET",
            url: "/api/account/passkeys",
            headers: { cookie: second.cookie },
        });
        expect(list.json().passkeys).toHaveLength(2);
    });

    it("🔴 Notzugang darf den ersten Passkey einrichten (§11.2)", async () => {
        app = await build();
        const operator = await fixture.person("operator");
        const recovery = await fixture.session(operator.id, { method: "recovery", assurance: "recovery" });
        expect((await register(recovery.cookie, new SoftAuthenticator(RP))).response.statusCode).toBe(200);
    });

    it("🔴 Zählerrückschritt sperrt den Passkey und steht im Protokoll; falsche Signatur wird abgelehnt", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const authenticator = new SoftAuthenticator(RP);
        const session = await fixture.session(admin.id, { method: "discord", assurance: "strong" });
        const enrolled = await register(session.cookie, authenticator, await enrollmentLink(admin.id));
        const once = await confirm(enrolled.cookie, authenticator);
        expect(once.response.statusCode).toBe(200);
        const forged = await confirm(once.cookie, authenticator, { badSignature: true });
        expect(forged.response.json().error.details.reason).toBe("signature");
        const clone = await confirm(once.cookie, authenticator, { signCount: 1 });
        expect(clone.response.json().error.details.reason).toBe("counter_regression");
        expect((await post("/api/auth/passkey/confirm/options", once.cookie)).json().error.code).toBe("no_passkey");
        const [event] = await database<{ action: string }[]>`
            SELECT action FROM avesmaps_auth.security_event WHERE target_person_id = ${admin.id} AND action = 'passkey.counter_regression'
        `;
        expect(event?.action).toBe("passkey.counter_regression");
    });

    it("🔴 Widerruf eines eigenen Passkeys: nur frisch und stark, mit Quittung und Wiederholungsschutz", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const authenticator = new SoftAuthenticator(RP);
        const session = await fixture.session(admin.id, { method: "discord", assurance: "strong" });
        const enrolled = await register(session.cookie, authenticator, await enrollmentLink(admin.id));
        const [row] = await database<
            { id: string }[]
        >`SELECT id FROM avesmaps_auth.passkey_credential WHERE person_id = ${admin.id}`;
        const basic = await fixture.session(admin.id, { method: "password", assurance: "basic" });
        expect(
            (
                await post("/api/account/passkeys/revoke", basic.cookie, {
                    operationId: randomUUID(),
                    passkeyId: row!.id,
                })
            ).json().error.code,
        ).toBe("reauth_required");
        const operationId = randomUUID();
        const revoked = await post("/api/account/passkeys/revoke", enrolled.cookie, {
            operationId,
            passkeyId: row!.id,
        });
        expect(revoked.json()).toMatchObject({
            operationId,
            status: "applied",
            affected: [{ kind: "passkey", id: row!.id }],
        });
        expect(
            (await post("/api/account/passkeys/revoke", enrolled.cookie, { operationId, passkeyId: row!.id })).json()
                .status,
        ).toBe("replayed");
    });
});
