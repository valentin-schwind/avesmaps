import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { protect } from "../src/auth/plugin.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { DISABLED_AUTH } from "../src/auth/config.ts";
import { SESSION_COOKIE, TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Sitzung und serverseitige Rechte (WI-0120 A3, AUTH-0001 §6.1, §6.2, §8, §11.2; Abnahmefälle AUTH-0001 §16):
 * Rechte wirken sofort, Herkunft wird geprüft, Sicherheitsstufen R/V/S, Umgebungen getrennt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SILENT = { write: (): void => undefined };

describeWithDatabase("Anmeldung: Sitzung und Rechte", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;

    const config = (auth = TEST_AUTH, statusPage?: boolean): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth,
        ...(statusPage === undefined ? {} : { statusPage }),
    });

    async function build(auth = TEST_AUTH, statusPage?: boolean): Promise<FastifyInstance> {
        // Eine eigene Verbindung je App: `close()` beendet die Datenbank der App (`app.ts`, onClose).
        const instance = buildApp({
            config: config(auth, statusPage),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: SILENT,
        });
        instance.get("/api/admin/probe", { ...protect("manage_people") }, async () => ({ ok: true }));
        instance.post(
            "/api/admin/probe-sensitive",
            { ...protect("assign_roles", { confirm: "recent" }) },
            async () => ({ ok: true }),
        );
        instance.post("/api/admin/probe-system", { ...protect("assign_admin") }, async () => ({ ok: true }));
        instance.get("/api/edit/probe", { ...protect("edit_map_objects") }, async () => ({ ok: true }));
        await instance.ready();
        return instance;
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

    async function sessionOf(cookie?: string) {
        return app!.inject({ method: "GET", url: "/api/auth/session", headers: cookie ? { cookie } : {} });
    }

    it("ohne Cookie: angemeldet ist niemand, die Umgebung steht da", async () => {
        app = await build();
        const response = await sessionOf();
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toEqual({
            environment: "test",
            authEnabled: true,
            person: null,
            capabilities: [],
            liveChannel: false,
        });
    });

    it("🔴 mit Sitzung: Person, Rolle, Anmeldewege und Rechte aus dem Katalog", async () => {
        app = await build();
        const editor = await fixture.person("editor", { name: "Praiodan" });
        const { cookie } = await fixture.session(editor.id, { assurance: "basic" });
        const body = (await sessionOf(cookie)).json();
        expect(body.person).toMatchObject({
            id: editor.id,
            displayName: "Praiodan",
            role: "editor",
            assurance: "basic",
        });
        expect(body.capabilities).toContain("edit_map_objects");
        expect(body.capabilities).not.toContain("manage_people");
    });

    it("🔴 Rechte wirken sofort: Rolle ändern, Zugang entziehen, Person sperren (Legacy S1)", async () => {
        app = await build();
        const person = await fixture.person("admin");
        const { cookie } = await fixture.session(person.id);
        expect((await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie } })).statusCode).toBe(
            200,
        );

        await database`UPDATE avesmaps_auth.person_access SET role = 'editor' WHERE person_id = ${person.id}`;
        const downgraded = await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie } });
        expect(downgraded.statusCode).toBe(403);
        expect(downgraded.json().error.code).toBe("forbidden");

        await database`UPDATE avesmaps_auth.person_access SET status = 'revoked' WHERE person_id = ${person.id}`;
        expect((await app.inject({ method: "GET", url: "/api/edit/probe", headers: { cookie } })).statusCode).toBe(401);

        await database`UPDATE avesmaps_auth.person_access SET status = 'active' WHERE person_id = ${person.id}`;
        await database`UPDATE avesmaps_auth.person SET status = 'locked' WHERE id = ${person.id}`;
        const locked = await app.inject({ method: "GET", url: "/api/edit/probe", headers: { cookie } });
        expect(locked.statusCode).toBe(401);
        expect(String(locked.headers["set-cookie"])).toContain("Max-Age=0");
    });

    it("🔴 eine Sitzung der anderen Umgebung gilt hier nicht (E8, T13)", async () => {
        app = await build();
        const person = await fixture.person("editor");
        await database`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${person.id}, 'staging', 'admin')`;
        const { cookie } = await fixture.session(person.id, { environment: "staging" });
        expect((await sessionOf(cookie)).json().person).toBeNull();
    });

    it("🔴 Rotation: nach einer Rechteänderung gibt es ein neues Token, das alte gilt nicht mehr", async () => {
        app = await build();
        const person = await fixture.person("editor");
        const { cookie } = await fixture.session(person.id);
        await database`UPDATE avesmaps_auth.session SET rotate_required = true WHERE person_id = ${person.id}`;
        const rotated = await sessionOf(cookie);
        const setCookie = String(rotated.headers["set-cookie"]);
        expect(rotated.json().person?.id).toBe(person.id);
        expect(setCookie).toMatch(
            // `Max-Age` = Restlaufzeit der Sitzung (WI-0120 R6): Das Handy behält die Anmeldung über das Schließen hinaus.
            new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=\\d+$`),
        );
        const fresh = setCookie.split(";")[0]!;
        expect((await sessionOf(cookie)).json().person).toBeNull();
        expect((await sessionOf(fresh)).json().person?.id).toBe(person.id);
    });

    it("🔴 Stufe V: Admin-Rechte nur mit zweitem Faktor, aber ohne Frist (Betreiber 2026-10-10: „2 faktoren oder keiner“)", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const probe = async (cookie: string) =>
            app!.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie } });

        const basic = await probe((await fixture.session(admin.id, { assurance: "basic", method: "password" })).cookie);
        expect(basic.statusCode).toBe(403);
        expect(basic.json().error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });

        expect((await probe((await fixture.session(admin.id)).cookie)).statusCode).toBe(200);

        // Der zweite Faktor von gestern, die letzte Anfrage vor Stunden: früher 403 `reauth_required` (12 h / 60 min), jetzt offen.
        const yesterday = await probe(
            (await fixture.session(admin.id, { confirmedMinutesAgo: 20 * 60, lastSeenMinutesAgo: 9 * 60 })).cookie,
        );
        expect(yesterday.statusCode).toBe(200);

        expect(
            (await probe((await fixture.session(admin.id, { assurance: "recovery", method: "recovery" })).cookie))
                .statusCode,
        ).toBe(200);
    });

    it("🔴 Discord-2FA-Sitzung von vor dem 2026-10-10 verliert Stufe V beim nächsten Aufruf, ohne Migration (Betreiber: „4. B“)", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        // So steht eine solche Sitzung in der Datenbank: `strong` aus `mfa_enabled`, nie ein Passkey-Nachweis.
        const old = await fixture.session(admin.id, {
            method: "discord",
            assurance: "strong",
            passkeyMinutesAgo: null,
        });
        const probe = await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie: old.cookie } });
        expect(probe.statusCode).toBe(403);
        expect(probe.json().error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });
        // Die Sitzung selbst bleibt (angemeldet, Stufe R); die Oberfläche bietet „Mit Passkey bestätigen“ an.
        const session = (await sessionOf(old.cookie)).json();
        expect(session.person).toMatchObject({ id: admin.id, assurance: "basic", sessionMethod: "discord" });
        expect(session.capabilities).toContain("manage_people");
        expect(
            (await app.inject({ method: "GET", url: "/api/edit/probe", headers: { cookie: old.cookie } })).statusCode,
        ).toBe(200);
        // Die Verwaltung sieht im Personendetail dieselbe Stufe.
        const operator = await fixture.person("operator");
        const { cookie } = await fixture.session(operator.id);
        const detail = await app.inject({
            method: "GET",
            url: `/api/admin/people/${admin.id}`,
            headers: { cookie },
        });
        expect(detail.json().sessions).toEqual([expect.objectContaining({ id: old.id, assurance: "basic" })]);
        // Mit Passkey bestätigt (in derselben Sitzung) trägt sie Stufe V wieder; ein Neuschreiben braucht es dafür nicht.
        await database`UPDATE avesmaps_auth.session SET passkey_confirmed_at = now() WHERE id = ${old.id}`;
        expect(
            (await app.inject({ method: "GET", url: "/api/admin/probe", headers: { cookie: old.cookie } })).statusCode,
        ).toBe(200);
    });

    it("🔴 Stufe S: nur mit frischem Passkey-Nachweis, auch nach Discord-Anmeldung", async () => {
        app = await build();
        const operator = await fixture.person("operator");
        const call = async (cookie: string) =>
            app!.inject({
                method: "POST",
                url: "/api/admin/probe-system",
                headers: { cookie, origin: TEST_ORIGIN },
                payload: {},
            });

        // Discord-Sitzung mit dem Passkey von gestern: Stufe V ja, für Stufe S nicht frisch.
        const yesterday = await call((await fixture.session(operator.id)).cookie);
        expect(yesterday.statusCode).toBe(403);
        expect(yesterday.json().error).toMatchObject({ code: "reauth_required", details: { need: "passkey" } });
        // Discord allein, auch mit Discord-2FA, ist nicht einmal Stufe V (Betreiber 2026-10-10: „4. B“).
        const discordOnly = await call((await fixture.session(operator.id, { passkeyMinutesAgo: null })).cookie);
        expect(discordOnly.json().error).toMatchObject({
            code: "assurance_required",
            details: { need: "second_factor" },
        });
        expect((await call((await fixture.session(operator.id, { passkeyMinutesAgo: 6 })).cookie)).statusCode).toBe(
            403,
        );
        expect((await call((await fixture.session(operator.id, { passkeyMinutesAgo: 1 })).cookie)).statusCode).toBe(
            200,
        );
    });

    it("🔴 heikle Handlung: Bestätigung höchstens 15 Minuten alt", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const call = async (cookie: string) =>
            app!.inject({
                method: "POST",
                url: "/api/admin/probe-sensitive",
                headers: { cookie, origin: TEST_ORIGIN },
                payload: {},
            });
        expect(
            (await call((await fixture.session(admin.id, { confirmedMinutesAgo: 20 })).cookie)).json().error.code,
        ).toBe("reauth_required");
        expect((await call((await fixture.session(admin.id, { confirmedMinutesAgo: 5 })).cookie)).statusCode).toBe(200);
    });

    it("🔴 ohne Anmeldung 401, ohne Recht 403, ohne eingerichtete Anmeldung 503", async () => {
        app = await build();
        const none = await app.inject({ method: "GET", url: "/api/admin/probe" });
        expect(none.statusCode).toBe(401);
        expect(none.json().error.code).toBe("unauthenticated");
        const editor = await fixture.person("editor");
        const forbidden = await app.inject({
            method: "GET",
            url: "/api/admin/probe",
            headers: { cookie: (await fixture.session(editor.id)).cookie },
        });
        expect(forbidden.json().error.code).toBe("forbidden");
        await app.close();

        app = await build(DISABLED_AUTH);
        const disabled = await app.inject({ method: "GET", url: "/api/admin/probe" });
        expect(disabled.statusCode).toBe(503);
        expect(disabled.json().error.code).toBe("auth_unavailable");
        expect((await sessionOf()).json()).toMatchObject({ authEnabled: false, person: null });
    });

    it("🔴 Herkunft: schreibende Anfragen mit Sitzung nur von der eigenen Seite (T5)", async () => {
        app = await build();
        const admin = await fixture.person("admin");
        const { cookie } = await fixture.session(admin.id);
        const post = async (headers: Record<string, string>) =>
            app!.inject({
                method: "POST",
                url: "/api/admin/probe-sensitive",
                headers: { cookie, ...headers },
                payload: {},
            });
        for (const headers of [
            {},
            { origin: "https://evil.example" },
            { origin: "null" },
            { origin: TEST_ORIGIN, "sec-fetch-site": "same-site" },
        ]) {
            const response = await post(headers);
            expect(response.statusCode, JSON.stringify(headers)).toBe(403);
            expect(response.json().error.code).toBe("forbidden_origin");
        }
        expect((await post({ origin: TEST_ORIGIN, "sec-fetch-site": "same-origin" })).statusCode).toBe(200);
    });

    it("🔴 Abmelden beendet die Sitzung, löscht das Cookie und steht im Protokoll", async () => {
        app = await build();
        const editor = await fixture.person("editor");
        const { id, cookie } = await fixture.session(editor.id);
        const response = await app.inject({
            method: "POST",
            url: "/api/auth/logout",
            headers: { cookie, origin: TEST_ORIGIN },
        });
        expect(response.statusCode).toBe(204);
        expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");
        expect((await sessionOf(cookie)).json().person).toBeNull();
        const [event] = await database<{ action: string; session_id: string }[]>`
            SELECT action, session_id FROM avesmaps_auth.security_event WHERE actor_person_id = ${editor.id}
        `;
        expect(event).toEqual({ action: "logout", session_id: id });
    });

    it("die Tür für Nginx: 204 mit Sitzung, 401 ohne", async () => {
        app = await build();
        expect((await app.inject({ method: "GET", url: "/api/auth/gate" })).statusCode).toBe(401);
        const tester = await fixture.person("tester");
        const { cookie } = await fixture.session(tester.id);
        expect((await app.inject({ method: "GET", url: "/api/auth/gate", headers: { cookie } })).statusCode).toBe(204);
    });

    it("Übergang auf Stage: ohne Anmeldung die Editor-Ansicht, aber kein Schreibrecht", async () => {
        app = await build({ ...TEST_AUTH, anonymousView: "editor" });
        const body = (await sessionOf()).json();
        expect(body.capabilities).toContain("view_editor_series");
        expect(body.capabilities).not.toContain("edit_map_objects");
        expect((await app.inject({ method: "GET", url: "/api/edit/probe" })).statusCode).toBe(401);
    });

    it("🔴 `liveChannel` sagt, wer `/ws` betreten darf: dieselbe Regel wie der Handschlag (WI-0197)", async () => {
        // Ohne Recht auf die Jobs wiese der Handschlag ab (`statusViewOf`): Besucher 401, Reviewer 403. Die Karte fragt dann gar nicht.
        app = await build();
        const editor = await fixture.person("editor");
        const reviewer = await fixture.person("reviewer");
        const alsEditor = (await fixture.session(editor.id)).cookie;
        const alsReviewer = (await fixture.session(reviewer.id)).cookie;
        expect((await sessionOf()).json().liveChannel).toBe(false);
        expect((await sessionOf(alsReviewer)).json().liveChannel).toBe(false);
        expect((await sessionOf(alsEditor)).json().liveChannel).toBe(true);
        await app.close();

        // Die Übergangsansicht lässt auch ohne Anmeldung hinein, wie der Handschlag.
        app = await build({ ...TEST_AUTH, anonymousView: "editor" });
        expect((await sessionOf()).json().liveChannel).toBe(true);
        await app.close();

        // Ohne eingerichtete Anmeldung entfällt der Einlass; ohne Statusseite gibt es den Kanal gar nicht.
        app = await build(DISABLED_AUTH);
        expect((await sessionOf()).json().liveChannel).toBe(true);
        await app.close();
        app = await build(TEST_AUTH, false);
        expect((await sessionOf(alsEditor)).json().liveChannel).toBe(false);
    });
});
