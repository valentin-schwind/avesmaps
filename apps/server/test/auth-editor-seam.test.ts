import { request as httpRequest } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { JobsOverview, Role, WsServerMessage } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { AuthConfig } from "../src/auth/config.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { insertJob } from "../src/jobs/store.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { testJobsConfig, waitFor } from "./support/jobs-support.ts";

/**
 * Die Editor-Naht (WI-0120 A11, AUTH-0001 §8, §13; JOBS-0001 D1 A): Statusseite und `/ws` nach Recht, Suchschalter aus der
 * Sitzung, und ein Entzug schließt die offene Verbindung (T11). Echte Datenbank, echter Server, echte WebSockets.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const QUELLE = "a11-naht-test";

describeWithDatabase("Editor-Naht", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const jobIds: number[] = [];
    const sockets: WebSocket[] = [];

    function config(auth: AuthConfig): ServerConfig {
        return {
            port: 0,
            host: "127.0.0.1",
            releaseId: "a11-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth,
        };
    }

    async function build(auth: AuthConfig = TEST_AUTH, listen = false): Promise<FastifyInstance> {
        const instance = buildApp({
            config: config(auth),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        if (listen) await instance.listen({ port: 0, host: "127.0.0.1" });
        else await instance.ready();
        return instance;
    }

    async function person(role: Role, name: string, options: SessionOptions = {}) {
        const created = await fixture.person(role, { name });
        const { cookie, id: sessionId } = await fixture.session(created.id, options);
        return { ...created, cookie, sessionId };
    }

    const get = (url: string, cookie?: string) =>
        app!.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });

    async function job(actorRef: string | null) {
        const { id, publicId } = await insertJob(database, {
            kind: "probe",
            mapDomainId: "aventuria",
            scopeKind: "tiles",
            scopeTiles: [],
            ...(actorRef === null ? {} : { actorRef }),
        });
        jobIds.push(id);
        return publicId;
    }

    function port(): number {
        return (app!.server.address() as { port: number }).port;
    }

    /** Der Handschlag allein: die HTTP-Antwort, wenn er abgewiesen wird, sonst 101. */
    function handshake(headers: Record<string, string>): Promise<number> {
        return new Promise((resolve, reject) => {
            const request = httpRequest({
                host: "127.0.0.1",
                port: port(),
                path: "/ws",
                headers: {
                    connection: "Upgrade",
                    upgrade: "websocket",
                    "sec-websocket-version": "13",
                    "sec-websocket-key": Buffer.from("a11-naht-schluss").toString("base64"),
                    ...headers,
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

    function open(cookie: string) {
        const socket = new WebSocket(`ws://127.0.0.1:${String(port())}/ws`, {
            headers: { cookie, origin: TEST_ORIGIN },
        } as never);
        sockets.push(socket);
        const messages: WsServerMessage[] = [];
        socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as WsServerMessage));
        const closed = new Promise<{ code: number; reason: string }>((resolve) => {
            socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
        });
        return {
            messages,
            closed,
            send: (message: unknown) => socket.send(JSON.stringify(message)),
            next: <T extends WsServerMessage["op"]>(op: T) =>
                waitFor(() => messages.find((message) => message.op === op), 8000, `Nachricht ${op}`) as Promise<
                    Extract<WsServerMessage, { op: T }>
                >,
        };
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        await database.unsafe(`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, geom, source_system)
            VALUES ('eeeeeeee-0000-4000-8000-0000000000a1','aventuria','Nahtmeer-3','Seeweg',TRUE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(710,710),ST_MakePoint(730,720)),0),'${QUELLE}')
        `);
    });

    afterEach(async () => {
        for (const socket of sockets.splice(0)) socket.close();
        await app?.close();
        app = undefined;
        if (jobIds.length > 0) {
            await database`DELETE FROM job_event WHERE job_id = ANY(${jobIds.splice(0)}::bigint[])`;
        }
    });

    afterAll(async () => {
        await database`DELETE FROM job WHERE kind = 'probe' AND actor_ref IS DISTINCT FROM 'jobs-cli'`;
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        await fixture.cleanup();
        await database.end({ timeout: 5 });
    });

    it("🔴 Statusrouten nach D1 A: ohne Anmeldung 401, Reviewer 403, Editor nur Eigenes ohne Speicher, Admin alles", async () => {
        app = await build();
        const reviewer = await person("reviewer", "Naht-Reviewer");
        const editor = await person("editor", "Naht-Editor");
        const admin = await person("admin", "Naht-Admin");
        const eigen = await job(editor.id);
        const fremd = await job("jobs-cli");

        const anonym = await get("/api/jobs/overview");
        expect(anonym.statusCode).toBe(401);
        expect(anonym.json().error.code).toBe("unauthenticated");
        expect((await get("/api/status/operations")).statusCode).toBe(401);
        expect((await get("/api/jobs/overview", reviewer.cookie)).json().error.code).toBe("forbidden");

        const own = (await get("/api/jobs/overview", editor.cookie)).json() as JobsOverview;
        expect(own.view).toBe("own");
        expect(own.memory).toBeNull();
        expect(own.queued.map((entry) => entry.id)).toEqual([eigen]);
        expect(own.queued[0]?.findings).toEqual([]);
        expect(own.queued[0]?.position).toBeGreaterThanOrEqual(1);
        const list = (await get("/api/jobs?state=QUEUED", editor.cookie)).json() as { jobs: { id: string }[] };
        expect(list.jobs.map((entry) => entry.id)).toEqual([eigen]);
        const events = (await get("/api/events?since=0", editor.cookie)).json() as {
            events: { jobId: string | null; payload: object }[];
        };
        expect(events.events.length).toBeGreaterThan(0);
        expect(events.events.every((event) => event.jobId === null && Object.keys(event.payload).length === 0)).toBe(
            true,
        );
        expect((await get("/api/status/operations", editor.cookie)).json().error.code).toBe("forbidden");

        const all = (await get("/api/jobs/overview", admin.cookie)).json() as JobsOverview;
        expect(all.view).toBe("all");
        expect(all.memory).not.toBeNull();
        expect(all.queued.map((entry) => entry.id)).toEqual(expect.arrayContaining([eigen, fremd]));
        // Wer, wann, wo (WI-0293), durch die Antwortform der Route: Der Admin sieht den Namen des Editors, der Editor nur seinen
        // eigenen (er sieht nur seine Aufträge); dazu die Umgebung der Tafel.
        const ausloeserIn = (overview: JobsOverview, id: string) =>
            overview.queued.find((entry) => entry.id === id)?.ausgeloest;
        expect(ausloeserIn(all, eigen)).toEqual({ art: "person", name: "Naht-Editor" });
        expect(ausloeserIn(all, fremd)).toEqual({ art: "kommandozeile", name: null });
        expect(ausloeserIn(own, eigen)).toEqual({ art: "person", name: "Naht-Editor" });
        expect(all.umgebung).toBe("test");
        expect((await get("/api/status/operations", admin.cookie)).statusCode).toBe(200);
        // Die Warteschlange im Kopf (WI-0230): `?eigene=true` zeigt auch dem Admin nur seine eigenen Aufträge, der Editor bleibt bei seinen.
        const adminEigene = (await get("/api/jobs/overview?eigene=true", admin.cookie)).json() as JobsOverview;
        expect(adminEigene.view).toBe("own");
        expect(adminEigene.queued.map((entry) => entry.id)).not.toContain(fremd);
        expect(adminEigene.queued.map((entry) => entry.id)).not.toContain(eigen);
        const editorEigene = (await get("/api/jobs/overview?eigene=true", editor.cookie)).json() as JobsOverview;
        expect(editorEigene.queued.map((entry) => entry.id)).toEqual([eigen]);
    });

    it("🔴 ein Admin ohne zweiten Faktor sieht nur Eigenes und erfährt, was für den Betrieb fehlt", async () => {
        app = await build();
        const admin = await person("admin", "Naht-Admin-Passwort", { method: "password", assurance: "basic" });
        expect(((await get("/api/jobs/overview", admin.cookie)).json() as JobsOverview).view).toBe("own");
        const operations = (await get("/api/status/operations", admin.cookie)).json();
        expect(operations.error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });
    });

    it("die Übergangsansicht (lokal) zeigt ohne Anmeldung alles wie vor WI-0120", async () => {
        app = await build({ ...TEST_AUTH, anonymousView: "editor" });
        const overview = await get("/api/jobs/overview");
        expect(overview.statusCode).toBe(200);
        expect((overview.json() as JobsOverview).view).toBe("all");
    });

    it("🔴 der Suchschalter wirkt nur mit dem Recht aus der Sitzung", async () => {
        app = await build();
        const editor = await person("editor", "Naht-Suche");
        const anonym = (await get("/api/search?q=Nahtmeer-3&editor=true")).json() as { hits: unknown[] };
        expect(anonym.hits).toEqual([]);
        const mitRecht = (await get("/api/search?q=Nahtmeer-3&editor=true", editor.cookie)).json() as {
            hits: { name: string }[];
        };
        expect(mitRecht.hits.map((hit) => hit.name)).toEqual(["Nahtmeer-3"]);
    });

    it("🔴 /ws: ohne Sitzung 401, fremde Herkunft 403, Reviewer 403, Editor herein", async () => {
        app = await build(TEST_AUTH, true);
        const reviewer = await person("reviewer", "Naht-WS-Reviewer");
        const editor = await person("editor", "Naht-WS-Editor");
        expect(await handshake({ origin: TEST_ORIGIN })).toBe(401);
        expect(await handshake({ origin: "https://boese.test", cookie: editor.cookie })).toBe(403);
        expect(await handshake({ origin: TEST_ORIGIN, cookie: reviewer.cookie })).toBe(403);
        expect(await handshake({ origin: TEST_ORIGIN, cookie: editor.cookie })).toBe(101);
    });

    it("🔴 ein Editor bekommt am /ws nur den Weckruf ohne Inhalt", async () => {
        app = await build(TEST_AUTH, true);
        const editor = await person("editor", "Naht-WS-Weckruf");
        const client = open(editor.cookie);
        await client.next("hello");
        client.send({ op: "subscribe", channel: "jobs" });
        await client.next("subscribed");
        await job("jobs-cli");
        const event = await client.next("event");
        expect(event.event).toMatchObject({ jobId: null, mapDomainId: null, payload: {} });
    });

    it("🔴 Rolle ändern bei offenem /ws schließt die Verbindung (T11), ebenso das Beenden der Sitzung", async () => {
        app = await build(TEST_AUTH, true);
        const admin = await person("admin", "Naht-WS-Admin");
        const editor = await person("editor", "Naht-WS-Abmeldung");
        const first = open(admin.cookie);
        const second = open(editor.cookie);
        await first.next("hello");
        await second.next("hello");

        await database`
            UPDATE avesmaps_auth.person_access SET role = 'editor' WHERE person_id = ${admin.id} AND environment = 'test'
        `;
        expect((await first.closed).code).toBe(4001);

        await database`UPDATE avesmaps_auth.session SET revoked_at = now() WHERE id = ${editor.sessionId}`;
        expect((await second.closed).code).toBe(4001);
    });
});
