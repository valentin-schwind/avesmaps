import { describe, expect, it } from "vitest";
import type { DisplayHeightPointer, TerrainDemPointer } from "@avesmaps3d/shared";
import type { Timers, WebSocketLike } from "../src/status/jobs-socket.ts";
import { authState } from "../src/auth/session-state.ts";
import { startTerrainLive } from "../src/map/terrain/terrain-live.ts";

/**
 * Die Karte hört auf neue Geländekacheln (WI-0125, JOBS-0001 V5): nur wo der Zeiger es anbietet, Kanal `area`, und nach einem
 * Ereignis oder einem Wiederverbinden die Zeiger neu.
 */

class FakeSocket implements WebSocketLike {
    readonly sent: unknown[] = [];
    private readonly listeners: Record<string, ((event: never) => void)[]> = {};
    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }
    close(): void {}
    addEventListener(type: string, listener: (event: never) => void): void {
        (this.listeners[type] ??= []).push(listener);
    }
    fire(type: "open" | "message" | "close" | "error", event?: unknown): void {
        for (const listener of this.listeners[type] ?? []) listener((event ?? {}) as never);
    }
    message(message: unknown): void {
        this.fire("message", { data: JSON.stringify(message) });
    }
}

const timers: Timers = {
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
};

const POINTER: TerrainDemPointer = {
    schemaVersion: 1,
    revision: "aaaaaaaaaaaa",
    tileSize: 512,
    maxNativeZoom: 4,
    encoding: "mapbox",
    format: "webp",
    tiles: { "0/0/0": "0000000000000000" },
};
const HEIGHTS: DisplayHeightPointer = { schemaVersion: 1, revision: "cccccccccccc", demRevision: "bbbbbbbbbbbb" };

function server(live: boolean, heights: "abgeleitet" | "keine" = "abgeleitet") {
    let terrain = POINTER;
    const calls: string[] = [];
    // Der Hinweis auf den Kanal steht an JEDEM Zeiger und auf JEDER Antwort, so wie der Server ihn setzt
    // (`routes/live-hint.ts`): Er beschreibt die Instanz, nicht die Daten.
    const hinweis = live ? { "x-avesmaps-live": "area" } : {};
    const fetcher = (async (url: string) => {
        calls.push(url);
        if (url.includes("display-height"))
            return heights === "abgeleitet"
                ? new Response(JSON.stringify(HEIGHTS), {
                      status: 200,
                      headers: { "content-type": "application/json", ...hinweis },
                  })
                : new Response(JSON.stringify({ error: { code: "no_display_height", message: "nichts" } }), {
                      status: 404,
                      headers: { "content-type": "application/json", ...hinweis },
                  });
        return new Response(JSON.stringify(terrain), {
            status: 200,
            headers: { "content-type": "application/json", ...hinweis },
        });
    }) as typeof fetch;
    return { fetcher, calls, publish: (next: TerrainDemPointer) => (terrain = next) };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Gelände im Betrieb (WI-0125)", () => {
    it("🔴 ohne Hinweis am Zeiger keine Verbindung: Eine Instanz ohne Kanal `area` bekommt keinen Versuch im Takt", async () => {
        const { fetcher } = server(false);
        const sockets: FakeSocket[] = [];
        const stop = await startTerrainLive({
            mitGelaende: true,
            fetcher,
            timers,
            socketUrl: "ws://x/ws",
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            onTerrain: () => undefined,
            onDisplayHeights: () => undefined,
        });
        expect(sockets).toHaveLength(0);
        stop();
    });

    it("🔴 wer nicht hinein darf, versucht es gar nicht (WI-0197): Hinweis da, Sitzung `liveChannel: false`, kein Zeiger, keine Verbindung", async () => {
        const { fetcher, calls } = server(true);
        const sockets: FakeSocket[] = [];
        const vorher = authState.value;
        authState.value = { ...vorher, known: true, authEnabled: true, environment: "production", liveChannel: false };
        try {
            const stop = await startTerrainLive({
                mitGelaende: true,
                fetcher,
                timers,
                socketUrl: "ws://x/ws",
                createSocket: () => {
                    const socket = new FakeSocket();
                    sockets.push(socket);
                    return socket;
                },
                onTerrain: () => undefined,
                onDisplayHeights: () => undefined,
            });
            expect(sockets).toHaveLength(0);
            expect(calls).toEqual([]);
            stop();
        } finally {
            authState.value = vorher;
        }
    });

    it("sagt die Sitzung nichts dazu (älterer Server, keine Antwort), entscheidet der Hinweis wie bisher (WI-0197)", async () => {
        const { fetcher } = server(true);
        const sockets: FakeSocket[] = [];
        const vorher = authState.value;
        try {
            for (const liveChannel of [undefined, true]) {
                authState.value = { ...vorher, known: liveChannel !== undefined, liveChannel };
                const stop = await startTerrainLive({
                    mitGelaende: false,
                    fetcher,
                    timers,
                    socketUrl: "ws://x/ws",
                    createSocket: () => {
                        const socket = new FakeSocket();
                        sockets.push(socket);
                        return socket;
                    },
                    onTerrain: () => undefined,
                    onDisplayHeights: () => undefined,
                });
                stop();
            }
        } finally {
            authState.value = vorher;
        }
        expect(sockets).toHaveLength(2);
    });

    it("🔴 abonniert `area`; `area.changed` holt Gelände und Anzeigehöhen neu, `display_heights.changed` nur die Höhen", async () => {
        const { fetcher, publish } = server(true);
        const sockets: FakeSocket[] = [];
        const terrains: TerrainDemPointer[] = [];
        const heights: (DisplayHeightPointer | undefined)[] = [];
        const stop = await startTerrainLive({
            mitGelaende: true,
            fetcher,
            timers,
            socketUrl: "ws://x/ws",
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            onTerrain: (pointer) => terrains.push(pointer),
            onDisplayHeights: (pointer) => heights.push(pointer),
        });
        const socket = sockets[0]!;
        socket.fire("open");
        expect(socket.sent).toContainEqual({ op: "subscribe", channel: "area" });
        publish({ ...POINTER, revision: "bbbbbbbbbbbb", tiles: { "0/0/0": "000000000000000f" } });
        socket.message({
            op: "event",
            channel: "area",
            event: { seq: 7, at: "2026-10-09T00:00:00Z", kind: "area.changed", jobId: null, payload: {} },
        });
        await settle();
        await settle();
        expect(terrains.map((pointer) => pointer.revision)).toEqual(["bbbbbbbbbbbb"]);
        expect(heights).toEqual([HEIGHTS]);
        socket.message({
            op: "event",
            channel: "area",
            event: { seq: 8, at: "2026-10-09T00:00:01Z", kind: "display_heights.changed", jobId: null, payload: {} },
        });
        await settle();
        expect(terrains).toHaveLength(1);
        expect(heights).toHaveLength(2);
        stop();
    });

    it("🔴 map.changed (WI-0128 E13): die Nummer des Ereignisses geht als Kachelrevision an die Karte; ein gap lädt mit der Nummer des Servers", async () => {
        const { fetcher } = server(true);
        const sockets: FakeSocket[] = [];
        const revisionen: number[] = [];
        const stop = await startTerrainLive({
            mitGelaende: true,
            fetcher,
            timers,
            socketUrl: "ws://x/ws",
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            onTerrain: () => undefined,
            onDisplayHeights: () => undefined,
            onMapChanged: (revision) => revisionen.push(revision),
        });
        const socket = sockets[0]!;
        socket.fire("open");
        socket.message({
            op: "event",
            channel: "area",
            event: {
                seq: 12,
                at: "2026-10-11T00:00:00Z",
                kind: "map.changed",
                jobId: null,
                payload: { operation: "place.move" },
            },
        });
        await settle();
        expect(revisionen).toEqual([12]);
        socket.message({ op: "gap", channel: "area", seq: 20 });
        await settle();
        expect(revisionen).toEqual([12, 20]);
        stop();
    });

    it("eine erste Verbindung, die nie zustande kommt (Anmeldung verlangt), versucht es nicht weiter", async () => {
        const { fetcher } = server(true);
        const sockets: FakeSocket[] = [];
        const stop = await startTerrainLive({
            mitGelaende: true,
            fetcher,
            timers,
            socketUrl: "ws://x/ws",
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            onTerrain: () => undefined,
            onDisplayHeights: () => undefined,
        });
        sockets[0]!.fire("close", { code: 1006 });
        expect(sockets).toHaveLength(1);
        stop();
    });
});

/**
 * Ohne Grafikkarte bleibt die Karte flach, und der Geländezeiger bleibt ungelesen (WI-0049, Betreiber 2026-09-27
 * „3: A“; ADR-0011 Punkt 4). Das Mithören stirbt davon nicht: Höhenlinien, Höhenstufen und die Kacheln der Editoren
 * gibt es dort genauso, nur Berge nicht. Der Browsertest dazu ist `e2e/terrain-software.spec.ts`.
 */
describe("Gelände im Betrieb ohne Grafikkarte", () => {
    const horcher = (optionen: {
        fetcher: typeof fetch;
        sockets: FakeSocket[];
        terrains: TerrainDemPointer[];
        heights: (DisplayHeightPointer | undefined)[];
        revisionen?: number[];
    }) =>
        startTerrainLive({
            mitGelaende: false,
            fetcher: optionen.fetcher,
            timers,
            socketUrl: "ws://x/ws",
            createSocket: () => {
                const socket = new FakeSocket();
                optionen.sockets.push(socket);
                return socket;
            },
            onTerrain: (pointer) => optionen.terrains.push(pointer),
            onDisplayHeights: (pointer) => optionen.heights.push(pointer),
            ...(optionen.revisionen ? { onMapChanged: (revision) => optionen.revisionen?.push(revision) } : {}),
        });

    it("🔴 der Geländezeiger wird nicht einmal für die Erkennung gelesen; der Kanal kommt von den Anzeigehöhen", async () => {
        const { fetcher, calls, publish } = server(true);
        const sockets: FakeSocket[] = [];
        const terrains: TerrainDemPointer[] = [];
        const heights: (DisplayHeightPointer | undefined)[] = [];
        const revisionen: number[] = [];
        const stop = await horcher({ fetcher, sockets, terrains, heights, revisionen });
        expect(calls.filter((url) => url.includes("/dem/"))).toEqual([]);
        expect(calls).toEqual(["/tiles/terrain/display-height/current.json"]);

        const socket = sockets[0]!;
        socket.fire("open");
        expect(socket.sent).toContainEqual({ op: "subscribe", channel: "area" });
        // Neues Gelände: die Höhen holt die Karte trotzdem, den Geländezeiger weiterhin nicht.
        publish({ ...POINTER, revision: "bbbbbbbbbbbb" });
        socket.message({
            op: "event",
            channel: "area",
            event: { seq: 7, at: "2026-10-12T00:00:00Z", kind: "area.changed", jobId: null, payload: {} },
        });
        await settle();
        await settle();
        expect(terrains).toEqual([]);
        expect(heights).toEqual([HEIGHTS]);
        expect(calls.filter((url) => url.includes("/dem/"))).toEqual([]);
        // Und die Kacheln der Editoren laufen wie mit Grafikkarte (WI-0128 E13).
        socket.message({
            op: "event",
            channel: "area",
            event: { seq: 12, at: "2026-10-12T00:00:01Z", kind: "map.changed", jobId: null, payload: {} },
        });
        await settle();
        expect(revisionen).toEqual([12]);
        stop();
    });

    it("🔴 noch keine Anzeigehöhen abgeleitet (404): Der Hinweis trägt trotzdem, die Karte hört mit", async () => {
        const { fetcher } = server(true, "keine");
        const sockets: FakeSocket[] = [];
        const stop = await horcher({ fetcher, sockets, terrains: [], heights: [] });
        expect(sockets).toHaveLength(1);
        stop();
    });

    it("eine Instanz ohne Kanal `area` bekommt auch ohne Grafikkarte keinen Versuch", async () => {
        const { fetcher } = server(false);
        const sockets: FakeSocket[] = [];
        const stop = await horcher({ fetcher, sockets, terrains: [], heights: [] });
        expect(sockets).toHaveLength(0);
        stop();
    });
});
