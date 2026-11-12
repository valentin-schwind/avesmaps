import { connect } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { WsServerMessage } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { claimJob, completeJob, insertJob, latestSeq } from "../src/jobs/store.ts";
import { addAreaEvent } from "../src/jobs/area-events.ts";
import { sleep, testJobsConfig, waitFor } from "./support/jobs-support.ts";

/**
 * `/ws` und `LISTEN/NOTIFY` (JOBS-0001 V5, 4.9): ein echter Server auf einem freien Port, ein echter Browser-Client (Nodes
 * `WebSocket`), echte Ereignisse aus der Datenbank.
 *
 * 🔴 HTTP bleibt autoritativ: Das Ereignis trägt `seq`; nach einem Reconnect spielt der Server nach oder sagt `gap`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const baseConfig = { port: 0, host: "127.0.0.1", releaseId: "ws-test", databaseUrl: undefined, tileRoot: undefined };

/**
 * Wie lange eine Stelle auf ein Ereignis des Kanals wartet (WI-0101).
 *
 * 🔴 **Abgeleitet, keine neue Zahl: vier Takte des Rettungswegs des Hubs.** `realtime/hub.ts` holt den
 * Stand zusätzlich zu `NOTIFY` alle `pollMs ?? 5000` ms selbst ab. Die Wartestellen standen genau auf
 * **5.000 ms**, also auf GENAU EINEM Takt dieses Rettungswegs und damit auf null Luft: verspätet sich
 * ein `NOTIFY` nur um einen Wimpernschlag, braucht der Fallback einen ganzen Takt, und die Stelle gibt
 * im selben Moment auf. 💣 Genau so fiel „drei Ereignisse" im Volllauf vom 2026-10-07 (Lauf B von zwei
 * gleichzeitigen, der EINZIGE rote Fall von 5.327): `Zeit abgelaufen: drei Ereignisse`.
 *
 * Ruhig gemessen am 2026-10-07 (5 Läufe, der Fall einzeln über `-t`): der GANZE Fall samt Serverstart,
 * WebSocket-Handschlag, drei Datenbankschreibungen und drei Ereignissen braucht **Median 683 ms**
 * (664 bis 697 ms). 20 s lassen dem Rettungsweg drei vollständige Versuche und liegen rund 29-fach über
 * dieser Messung; die Zeitgrenze des Falls selbst (45 s, oben) bleibt darüber, ein echter Hänger endet
 * also weiterhin.
 *
 * 🪤 Dies gilt nur für Stellen, die auf ein EREIGNIS des Kanals warten. Die Stellen, die auf eine
 * Antwort derselben Verbindung warten (`error`, `close`), haben mit dem Takt nichts zu tun und bleiben
 * auf ihren 4.000 ms.
 */
const EVENT_WAIT_MS = 20_000;

interface Client {
    socket: WebSocket;
    messages: WsServerMessage[];
    closed: Promise<{ code: number; reason: string }>;
    send(message: unknown): void;
    next<T extends WsServerMessage["op"]>(op: T, timeoutMs?: number): Promise<Extract<WsServerMessage, { op: T }>>;
}

describeWithDatabase("/ws: Grundkanal der Statusseite", { timeout: 45_000 }, () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    let port = 0;
    const clients: WebSocket[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });

    afterEach(async () => {
        for (const socket of clients.splice(0)) socket.close();
        await app?.close();
        app = undefined;
    });

    async function start(
        overrides: { statusPage?: boolean; wsMax?: number | null; pingEveryMs?: number; idleTimeoutMs?: number } = {},
    ): Promise<void> {
        app = buildApp({
            config: { ...baseConfig, databaseUrl: testDatabaseUrl, statusPage: overrides.statusPage ?? true },
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            jobs: {
                config: testJobsConfig({ wsMaxConnections: { value: overrides.wsMax ?? null } }),
                ...(overrides.pingEveryMs === undefined ? {} : { pingEveryMs: overrides.pingEveryMs }),
                ...(overrides.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: overrides.idleTimeoutMs }),
            },
        });
        await app.listen({ port: 0, host: "127.0.0.1" });
        port = (app.server.address() as { port: number }).port;
    }

    function open(path = "/ws"): Client {
        const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
        clients.push(socket);
        const messages: WsServerMessage[] = [];
        socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as WsServerMessage));
        const closed = new Promise<{ code: number; reason: string }>((resolve) => {
            socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
        });
        return {
            socket,
            messages,
            closed,
            send: (message) => socket.send(JSON.stringify(message)),
            next: async (op, timeoutMs = 4000) => {
                const found = await waitFor(
                    () => messages.find((message) => message.op === op),
                    timeoutMs,
                    `Nachricht ${op}`,
                );
                return found as never;
            },
        };
    }

    const queued = () =>
        insertJob(database, { kind: "probe", mapDomainId: "aventuria", scopeKind: "tiles", scopeTiles: [] });

    it("Hallo: `seq` ist die Nummer des letzten Ereignisses, dazu Release und Serverzeit", async () => {
        await queued();
        await start();
        const client = open();
        const hello = await client.next("hello");
        expect(hello).toMatchObject({ op: "hello", releaseId: "ws-test", seq: await latestSeq(database) });
        expect(Date.parse(hello.serverTime)).toBeGreaterThan(Date.now() - 60_000);
    });

    it("🔴 NOTIFY wird zum Ereignis auf dem Kanal `jobs`: Einreihen, Start, Phase und Ende kommen in der Reihenfolge ihrer Nummer an", async () => {
        await start();
        const client = open();
        await client.next("hello");
        client.send({ op: "subscribe", channel: "jobs" });
        await client.next("subscribed");

        const { id } = await queued();
        await claimJob(database, id, "w", 60);
        await completeJob(database, id, 1, { wallMs: 5 });
        await waitFor(
            () => client.messages.filter((message) => message.op === "event").length >= 3,
            EVENT_WAIT_MS,
            "drei Ereignisse",
        );
        const events = client.messages.filter(
            (message): message is Extract<WsServerMessage, { op: "event" }> => message.op === "event",
        );
        expect(events.map((message) => message.event.kind)).toEqual(["job.queued", "job.started", "job.succeeded"]);
        const seqs = events.map((message) => message.event.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(seqs).size).toBe(3);
        expect(events[2]?.event.payload).toMatchObject({ state: "SUCCEEDED", jobKind: "probe" });
        expect(events[0]?.event.jobId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("🔴 der Kanal `area` (WI-0125) bekommt nur die Bereichsereignisse, mit Bereich und Kachelliste, und spielt nach", async () => {
        await start();
        const map = open();
        await map.next("hello");
        map.send({ op: "subscribe", channel: "area" });
        await map.next("subscribed");
        const status = open();
        await status.next("hello");
        status.send({ op: "subscribe", channel: "jobs" });
        await status.next("subscribed");

        const job = await queued();
        const owner = { id: job.id, publicId: job.publicId, kind: "dem_publish", mapDomainId: "aventuria" };
        await addAreaEvent(
            database,
            "area.changed",
            owner,
            { revision: "a0124c000001", tiles: { "4/8/8": "0123456789abcdef" } },
            { minX: 512, minY: 448, maxX: 576, maxY: 512 },
        );
        await waitFor(
            () => status.messages.filter((message) => message.op === "event").length >= 2,
            EVENT_WAIT_MS,
            "zwei Ereignisse auf `jobs`",
        );
        await waitFor(
            () => map.messages.some((message) => message.op === "event"),
            EVENT_WAIT_MS,
            "das Bereichsereignis",
        );
        await sleep(200);
        const events = map.messages.filter(
            (message): message is Extract<WsServerMessage, { op: "event" }> => message.op === "event",
        );
        expect(events.map((message) => [message.channel, message.event.kind])).toEqual([["area", "area.changed"]]);
        expect(events[0]?.event.payload).toMatchObject({
            revision: "a0124c000001",
            tiles: { "4/8/8": "0123456789abcdef" },
        });

        // Nachspielen im Kanal `area`: ab einer Nummer davor nur das Bereichsereignis, nicht das Einreihen.
        const late = open();
        await late.next("hello");
        late.send({ op: "subscribe", channel: "area", since: (events[0]?.event.seq ?? 1) - 2 });
        await late.next("subscribed");
        const replayed = late.messages.filter(
            (message): message is Extract<WsServerMessage, { op: "event" }> => message.op === "event",
        );
        expect(replayed.map((message) => message.event.kind)).toEqual(["area.changed"]);
    });

    it("kein Ereignis ohne Abonnement, und nichts Unveröffentlichtes: ein zurückgerolltes Einreihen schickt nichts", async () => {
        await start();
        const lurker = open();
        await lurker.next("hello");
        const subscriber = open();
        await subscriber.next("hello");
        subscriber.send({ op: "subscribe", channel: "jobs" });
        await subscriber.next("subscribed");
        await expect(
            database.begin(async (tx) => {
                await insertJob(tx, { kind: "probe", mapDomainId: "aventuria" });
                throw new Error("zurückrollen");
            }),
        ).rejects.toThrow("zurückrollen");
        await queued();
        await waitFor(
            () => subscriber.messages.some((message) => message.op === "event"),
            EVENT_WAIT_MS,
            "ein Ereignis",
        );
        await sleep(200);
        expect(subscriber.messages.filter((message) => message.op === "event")).toHaveLength(1);
        expect(lurker.messages.filter((message) => message.op === "event")).toHaveLength(0);
    });

    it("🔴 Reconnect: ab dem letzten `seq` wird nachgespielt, was in der Zwischenzeit geschah, ohne Doppelte", async () => {
        await start();
        const first = open();
        await first.next("hello");
        first.send({ op: "subscribe", channel: "jobs" });
        await first.next("subscribed");
        await queued();
        await waitFor(() => first.messages.some((message) => message.op === "event"), EVENT_WAIT_MS, "erstes Ereignis");
        const lastSeq = (
            first.messages.filter((message) => message.op === "event")[0] as Extract<WsServerMessage, { op: "event" }>
        ).event.seq;
        first.socket.close();
        await first.closed;

        // Während die Verbindung weg ist, geschehen zwei Dinge.
        const a = await queued();
        const b = await queued();

        const second = open();
        await second.next("hello");
        second.send({ op: "subscribe", channel: "jobs", since: lastSeq });
        const subscribed = await second.next("subscribed");
        const replayed = second.messages.filter(
            (message): message is Extract<WsServerMessage, { op: "event" }> => message.op === "event",
        );
        expect(replayed.map((message) => message.event.jobId)).toEqual([a.publicId, b.publicId]);
        expect(subscribed.seq).toBe(replayed[1]?.event.seq);
        // Neue Ereignisse kommen danach live, und nichts doppelt.
        const c = await queued();
        await waitFor(
            () => second.messages.filter((message) => message.op === "event").length === 3,
            EVENT_WAIT_MS,
            "drittes Ereignis",
        );
        const all = second.messages.filter(
            (message): message is Extract<WsServerMessage, { op: "event" }> => message.op === "event",
        );
        expect(all.map((message) => message.event.jobId)).toEqual([a.publicId, b.publicId, c.publicId]);
    });

    it("🔴 sind die Ereignisse aufgeräumt, sagt der Server `gap`: der Client holt den Stand über HTTP", async () => {
        await queued();
        await queued();
        const events = await database<{ seq: string }[]>`SELECT seq::text FROM job_event ORDER BY seq`;
        const first = Number(events[0]?.seq);
        const last = Number(events[1]?.seq);
        await queued();
        await database`DELETE FROM job_event WHERE seq <= ${last}`;
        await start();
        const client = open();
        await client.next("hello");
        client.send({ op: "subscribe", channel: "jobs", since: first });
        const gap = await client.next("gap");
        expect(gap.seq).toBe(await latestSeq(database));
        await client.next("subscribed");
        expect(client.messages.filter((message) => message.op === "event")).toHaveLength(0);
    });

    it("Ping vom Client (Nginx hält `/ws` 3.600 s offen, der Client pingt alle 30 s): `pong` mit Serverzeit", async () => {
        await start();
        const client = open();
        await client.next("hello");
        client.send({ op: "ping" });
        const pong = await client.next("pong");
        expect(Date.parse(pong.serverTime)).not.toBeNaN();
    });

    it("kaputte und unbekannte Nachrichten bekommen `error`, die Verbindung bleibt", async () => {
        await start();
        const client = open();
        await client.next("hello");
        client.socket.send("das ist kein JSON");
        client.send({ op: "tu-was" });
        client.send({ op: "subscribe", channel: "wetter" });
        await waitFor(
            () => client.messages.filter((message) => message.op === "error").length === 3,
            4000,
            "drei Fehler",
        );
        expect(
            client.messages
                .filter((message): message is Extract<WsServerMessage, { op: "error" }> => message.op === "error")
                .map((message) => message.code),
        ).toEqual(["invalid_json", "unknown_op", "unknown_channel"]);
        client.send({ op: "ping" });
        await client.next("pong");
    });

    it("🔴 Beim Beenden des Servers kommt 1001 going away; der Client kann mit Backoff neu verbinden", async () => {
        await start();
        const client = open();
        await client.next("hello");
        client.send({ op: "subscribe", channel: "jobs" });
        await client.next("subscribed");
        const closing = app?.close();
        const { code, reason } = await client.closed;
        await closing;
        app = undefined;
        expect(code).toBe(1001);
        expect(reason).toBe("going away");
    });

    it("die Verbindungsgrenze (MS14, wenn gemessen) weist die nächste Verbindung ab (503)", async () => {
        await start({ wsMax: 1 });
        const first = open();
        await first.next("hello");
        const second = open();
        const error = await new Promise<string>((resolve) => {
            second.socket.addEventListener("error", () => resolve("error"));
            second.socket.addEventListener("close", () => resolve("close"));
        });
        expect(["error", "close"]).toContain(error);
        expect(second.messages).toEqual([]);
        // Ohne Grenze (MS14 noch nicht gemessen) gibt es keine.
        first.socket.close();
        await first.closed;
    });

    it("ein falscher Pfad oder eine Instanz ohne Statusseite nimmt keine Verbindung an", async () => {
        await start();
        const wrong = open("/anderswo");
        await new Promise((resolve) => {
            wrong.socket.addEventListener("error", resolve);
            wrong.socket.addEventListener("close", resolve);
        });
        expect(wrong.messages).toEqual([]);
        await app?.close();
        app = undefined;
        await start({ statusPage: false });
        const off = open();
        await new Promise((resolve) => {
            off.socket.addEventListener("error", resolve);
            off.socket.addEventListener("close", resolve);
        });
        expect(off.messages).toEqual([]);
    });

    it("hört der Server von einer Verbindung nichts mehr, beendet er sie (Ping alle 30 s, 75 s Leerlauf; hier verkürzt)", async () => {
        await start({ pingEveryMs: 50, idleTimeoutMs: 150 });
        // Ein roher Client, der den Handshake macht und dann schweigt (antwortet auch nicht auf Pings).
        const key = Buffer.from("0123456789abcdef").toString("base64");
        const raw = connect(port, "127.0.0.1");
        let ended = false;
        // 🪤 Ohne Leser (`resume`) bleibt der Socket pausiert und meldet das Ende des Servers nie.
        raw.resume();
        raw.on("error", () => undefined);
        raw.on("close", () => {
            ended = true;
        });
        raw.write(
            `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
        await waitFor(() => ended, 4000, "Verbindung beendet");
        expect(ended).toBe(true);
    });

    it("🔴 ein Client, der spammt, wird geschlossen (1008); die anderen merken nichts", async () => {
        await start();
        const spammer = open();
        await spammer.next("hello");
        const other = open();
        await other.next("hello");
        for (let index = 0; index < 200; index += 1) spammer.send({ op: "ping" });
        const { code } = await spammer.closed;
        expect(code).toBe(1008);
        other.send({ op: "ping" });
        await other.next("pong");
    });
});
