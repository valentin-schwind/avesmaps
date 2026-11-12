import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Role, WsServerMessage } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { protect } from "../src/auth/plugin.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { SystemStateStore } from "../src/system/state-store.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { testJobsConfig, waitFor } from "./support/jobs-support.ts";

/**
 * Die Sperren an den Schreibwegen gegen echtes PostgreSQL (WI-0127 SYS-4, SYS-0001 §3.3, §4.4, §7.1 Zeile SYS-4, §7.2), mit echten
 * Sitzungen, echten Routen und echtem `/ws`:
 *
 * - Systemsperre: Einstellungen und Verwaltung 423 `system_locked` (mit Grund für Inhaber von `view_operations`), die
 *   Sicherheitshandgriffe (sperren, Sitzungen beenden, Rolle herab, Abmelden) laufen weiter.
 * - Kartensperre: Kartendaten 423 `map_locked` (eine Probe-Route, weil heute noch keine Route Kartendaten schreibt), Verwaltung offen,
 *   und wer nicht darf, bekommt zuerst 401/403.
 * - Beide Sperren und eingeschränkt: Lösen und Zurückschalten gehen immer.
 * - Zustand unbekannt: `system` 503 `system_state_unknown` mit `Retry-After`, Sicherheitshandgriffe und Abmelden laufen.
 * - `/ws` im eingeschränkten Betrieb: nur mit `access_restricted_mode` und zweitem Faktor; offene Verbindungen ohne Zugangsrecht
 *   schließen beim Umschalten mit 4001, nach dem Zurückschalten kommen sie wieder herein.
 *
 * Der Test hinterlässt Normal und offen (`resetState`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };
const MAP_PROBE = "/api/test/sys4-kartenprobe";

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "sys4-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

describeWithDatabase("Sperren an den Schreibwegen (SYS-4)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const apps: FastifyInstance[] = [];
    const extra: { close(): Promise<void> }[] = [];
    const sockets: WebSocket[] = [];

    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL
             WHERE id = 1
        `;
    }

    async function revision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    }

    /** Eine App mit eigener Verbindung; die Probe-Route der Kartendaten steht darin, weil heute keine echte Route Kartendaten schreibt. */
    async function build(options: { store?: (own: Database) => SystemStateStore; listen?: boolean } = {}) {
        const own = createDatabase(testDatabaseUrl as string, { max: 4 });
        const app = buildApp({
            config,
            database: own,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            ...(options.store === undefined ? {} : { systemState: options.store(own) }),
        });
        app.post(MAP_PROBE, { ...protect("view_operations", { writeClass: "map" }) }, async () => ({ ok: true }));
        apps.push(app);
        if (options.listen === true) await app.listen({ port: 0, host: "127.0.0.1" });
        else await app.ready();
        return app;
    }

    const post = (app: FastifyInstance, url: string, cookie: string | undefined, payload: object = {}) =>
        app.inject({
            method: "POST",
            url,
            payload,
            headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
        });

    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    async function person(role: Role, name: string, options: { passkey?: boolean; session?: SessionOptions } = {}) {
        const created = await fixture.person(role, { name });
        if (options.passkey !== false) {
            await database`
                INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
                VALUES (${created.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
            `;
        }
        const { cookie } = await fixture.session(created.id, options.session ?? PASSKEY_FRESH);
        return { ...created, cookie };
    }

    /** Schaltet über die Verwaltung, wie ein Betreiber im Fenster: mit frischem Passkey und der aktuellen Revision. */
    async function setLock(app: FastifyInstance, cookie: string, lock: "map" | "system", locked: boolean) {
        return post(app, "/api/admin/system/lock", cookie, {
            operationId: randomUUID(),
            baseRevision: await revision(),
            lock,
            locked,
            ...(locked ? { reason: "Test SYS-4" } : {}),
        });
    }

    async function setMode(app: FastifyInstance, cookie: string, mode: "normal" | "restricted") {
        return post(app, "/api/admin/system/mode", cookie, {
            operationId: randomUUID(),
            baseRevision: await revision(),
            mode,
            ...(mode === "restricted" ? { reason: "Test SYS-4" } : {}),
        });
    }

    const invite = (app: FastifyInstance, cookie: string) =>
        post(app, "/api/admin/invitations", cookie, { operationId: randomUUID(), role: "editor", validDays: 1 });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        await resetState();
    });

    afterEach(async () => {
        for (const socket of sockets.splice(0)) socket.close();
        for (const app of apps.splice(0)) await app.close();
        for (const item of extra.splice(0)) await item.close();
        await database`DELETE FROM avesmaps_auth.security_event WHERE target_ref = 'system_state' AND actor_person_id IS NULL`;
        await fixture.cleanup();
        await resetState();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 Systemsperre: Verwaltung 423 mit Grund, Sicherheitshandgriffe laufen, Lösen geht", async () => {
        const operator = await person("operator", "SYS4-Betreiberin");
        const target = await person("reviewer", "SYS4-Ziel");
        const admin = await person("admin", "SYS4-Admin", { session: {} });
        const app = await build();
        expect(code(await setLock(app, operator.cookie, "system", true))).toBe("200");

        // Einstellungen und Verwaltung, die etwas gewähren: angehalten.
        const invitation = await invite(app, admin.cookie);
        expect(invitation.statusCode).toBe(423);
        const body = invitation.json() as { error: { code: string; details: { since: string; reason?: string } } };
        expect(body.error.code).toBe("system_locked");
        expect(Number.isNaN(Date.parse(body.error.details.since))).toBe(false);
        // Der Admin darf die Verwaltung lesen (`view_operations`): er sieht den Grund.
        expect(body.error.details.reason).toBe("Test SYS-4");
        const grant = await post(app, "/api/admin/people/capabilities/grant", operator.cookie, {
            operationId: randomUUID(),
            personId: admin.id,
            capability: "access_restricted_mode",
            reason: "Test SYS-4",
        });
        expect(code(grant)).toBe("423 system_locked");
        const up = await post(app, "/api/admin/people/role", admin.cookie, {
            operationId: randomUUID(),
            personId: target.id,
            role: "editor",
            baseRevision: 1,
        });
        expect(code(up)).toBe("423 system_locked");
        // Nichts davon steht im Protokoll: die Handlungen fanden nicht statt.
        const [written] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE actor_person_id IN (${admin.id}, ${operator.id}) AND action NOT LIKE 'system.%'
        `;
        expect(written?.n).toBe(0);

        // Sicherheitshandgriffe: Rolle herab, Sitzungen beenden, sperren; dazu das eigene Abmelden.
        const down = await post(app, "/api/admin/people/role", admin.cookie, {
            operationId: randomUUID(),
            personId: target.id,
            role: "tester",
            baseRevision: 1,
        });
        expect(code(down)).toBe("200");
        const sessions = await post(app, "/api/admin/people/sessions/revoke", admin.cookie, {
            operationId: randomUUID(),
            personId: target.id,
        });
        expect(code(sessions)).toBe("200");
        const lock = await post(app, "/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: target.id,
            reason: "Verdacht",
            baseRevision: 1,
        });
        expect(code(lock)).toBe("200");
        // Entsperren gewährt wieder Zugang: angehalten.
        const unlock = await post(app, "/api/admin/people/unlock", admin.cookie, {
            operationId: randomUUID(),
            personId: target.id,
            baseRevision: 2,
        });
        expect(code(unlock)).toBe("423 system_locked");

        // Lösen geht immer, danach wirkt die Verwaltung wieder.
        expect(code(await setLock(app, operator.cookie, "system", false))).toBe("200");
        expect(code(await invite(app, admin.cookie))).toBe("200");
        expect(code(await post(app, "/api/auth/logout", admin.cookie))).toBe("204");
    });

    it("🔴 Kartensperre: Kartendaten 423, Verwaltung offen; wer nicht darf, erfährt zuerst das", async () => {
        const operator = await person("operator", "SYS4-Kartensperre");
        const reviewer = await person("reviewer", "SYS4-Leser");
        const app = await build();
        expect(code(await post(app, MAP_PROBE, operator.cookie))).toBe("200");
        expect(code(await setLock(app, operator.cookie, "map", true))).toBe("200");

        expect(code(await post(app, MAP_PROBE, operator.cookie))).toBe("423 map_locked");
        // Erst Anmeldung und Recht, dann die Sperre: wer nicht darf, erfährt nichts über sie.
        expect(code(await post(app, MAP_PROBE, undefined))).toBe("401 unauthenticated");
        expect(code(await post(app, MAP_PROBE, reviewer.cookie))).toBe("403 forbidden");
        // Die Kartensperre lässt die Verwaltung offen.
        expect(code(await invite(app, operator.cookie))).toBe("200");

        expect(code(await setLock(app, operator.cookie, "map", false))).toBe("200");
        expect(code(await post(app, MAP_PROBE, operator.cookie))).toBe("200");
    });

    it("🔴 beide Sperren und eingeschränkt: Lösen und Zurückschalten gehen immer (keine Selbstaussperrung)", async () => {
        const operator = await person("operator", "SYS4-Rueckweg");
        const app = await build();
        expect(code(await setMode(app, operator.cookie, "restricted"))).toBe("200");
        expect(code(await setLock(app, operator.cookie, "map", true))).toBe("200");
        expect(code(await setLock(app, operator.cookie, "system", true))).toBe("200");
        expect(app.systemState!.snapshot()).toMatchObject({ mode: "restricted", mapLock: true, systemLock: true });

        expect(code(await setLock(app, operator.cookie, "system", false))).toBe("200");
        expect(code(await setLock(app, operator.cookie, "map", false))).toBe("200");
        expect(code(await setMode(app, operator.cookie, "normal"))).toBe("200");
        expect(app.systemState!.snapshot()).toMatchObject({ mode: "normal", mapLock: false, systemLock: false });
    });

    it("🔴 Zustand unbekannt: Verwaltung 503 mit Retry-After, Sicherheitshandgriffe und Abmelden laufen", async () => {
        const admin = await person("admin", "SYS4-Unbekannt", { session: {} });
        const editor = await person("editor", "SYS4-Ziel");
        // Der Betriebszustand kommt von einer Datenbank, die nicht antwortet; Sitzungen und Verwaltung von der echten.
        const app = await build({
            store: () => {
                const gone = createDatabase("postgres://niemand:geheim@127.0.0.1:1/nirgends", { max: 1 });
                extra.push({ close: () => gone.end({ timeout: 1 }) });
                return new SystemStateStore({ database: gone });
            },
        });
        expect(app.systemState!.snapshot().source).toBe("unknown");

        const invitation = await invite(app, admin.cookie);
        expect(code(invitation)).toBe("503 system_state_unknown");
        expect(invitation.headers["retry-after"]).toBe("5");
        const lock = await post(app, "/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            reason: "Verdacht",
            baseRevision: 1,
        });
        expect(code(lock)).toBe("200");
        expect(code(await post(app, "/api/auth/logout", admin.cookie))).toBe("204");
    });

    describe("/ws im eingeschränkten Betrieb", () => {
        function port(app: FastifyInstance): number {
            return (app.server.address() as { port: number }).port;
        }

        function handshake(app: FastifyInstance, cookie: string): Promise<number> {
            return new Promise((resolve, reject) => {
                const request = httpRequest({
                    host: "127.0.0.1",
                    port: port(app),
                    path: "/ws",
                    headers: {
                        connection: "Upgrade",
                        upgrade: "websocket",
                        "sec-websocket-version": "13",
                        "sec-websocket-key": Buffer.from("sys4-schluessel!").toString("base64"),
                        origin: TEST_ORIGIN,
                        cookie,
                    },
                });
                request.on("response", (response) => {
                    resolve(response.statusCode ?? 0);
                    response.resume();
                });
                request.on("upgrade", (_response, socket) => {
                    socket.destroy();
                    resolve(101);
                });
                request.on("error", reject);
                request.end();
            });
        }

        function open(app: FastifyInstance, cookie: string) {
            const socket = new WebSocket(`ws://127.0.0.1:${String(port(app))}/ws`, {
                headers: { cookie, origin: TEST_ORIGIN },
            } as never);
            sockets.push(socket);
            const messages: WsServerMessage[] = [];
            socket.addEventListener("message", (event) =>
                messages.push(JSON.parse(String(event.data)) as WsServerMessage),
            );
            let closedWith: number | undefined;
            const closed = new Promise<number>((resolve) => {
                socket.addEventListener("close", (event) => {
                    closedWith = event.code;
                    resolve(event.code);
                });
            });
            return {
                closed,
                isOpen: () => closedWith === undefined,
                ping: () => socket.send(JSON.stringify({ op: "ping" })),
                pongs: () => messages.filter((message) => message.op === "pong").length,
                hello: () => waitFor(() => messages.find((message) => message.op === "hello"), 8000, "hello"),
            };
        }

        it("🔴 nur mit Zugangsrecht und zweitem Faktor; Umschalten schließt die übrigen mit 4001, zurück kommen sie wieder", async () => {
            const operator = await person("operator", "SYS4-WS-Betreiberin");
            const admin = await person("admin", "SYS4-WS-Admin", { session: {} });
            const basic = await person("operator", "SYS4-WS-ohne-Faktor", {
                session: { method: "password", assurance: "basic" },
            });
            const app = await build({ listen: true });

            expect(await handshake(app, admin.cookie)).toBe(101);
            const holder = open(app, operator.cookie);
            const other = open(app, admin.cookie);
            await holder.hello();
            await other.hello();

            expect(code(await setMode(app, operator.cookie, "restricted"))).toBe("200");
            // Sofort mit dem Wechsel, nicht erst im Takt der Neuprüfung (hier eine Minute).
            const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("nicht binnen 2 s"), 2000));
            expect(await Promise.race([other.closed, timeout])).toBe(4001);
            // Wer das Zugangsrecht hat, bleibt verbunden und bekommt weiter Antwort.
            holder.ping();
            await waitFor(() => holder.pongs() > 0, 8000, "pong");
            expect(holder.isOpen()).toBe(true);

            expect(await handshake(app, admin.cookie)).toBe(503);
            expect(await handshake(app, basic.cookie)).toBe(503);
            expect(await handshake(app, operator.cookie)).toBe(101);

            expect(code(await setMode(app, operator.cookie, "normal"))).toBe("200");
            expect(await handshake(app, admin.cookie)).toBe(101);
            expect(holder.isOpen()).toBe(true);
        });

        it("🔴 ein Sonderrecht genügt: ein Admin mit zugeteiltem `access_restricted_mode` kommt herein", async () => {
            const operator = await person("operator", "SYS4-WS-Zuteilende");
            const admin = await person("admin", "SYS4-WS-Sonderrecht", { session: {} });
            await database`
                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
                VALUES (${admin.id}, 'test', 'access_restricted_mode', 'Test SYS-4')
            `;
            const app = await build({ listen: true });
            expect(code(await setMode(app, operator.cookie, "restricted"))).toBe("200");
            expect(await handshake(app, admin.cookie)).toBe(101);
        });
    });
});
