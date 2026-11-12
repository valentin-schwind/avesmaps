import { describe, expect, it } from "vitest";
import type { JobEventRecord } from "@avesmaps3d/shared";
import {
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_MAX_DELAY_MS,
    JobsSocket,
    reconnectDelay,
    type SocketState,
    type Timers,
    type WebSocketLike,
} from "../src/status/jobs-socket.ts";

/**
 * Der Client von `/ws` (JOBS-0001 4.9, V5): Reconnect mit Backoff und Jitter, Abo ab dem letzten `seq`, Lebenszeichen alle 30 s,
 * Verhalten bei `1001` (der alte Slot geht) und beim harten Abbruch.
 */

class FakeSocket implements WebSocketLike {
    readonly sent: unknown[] = [];
    closedWith: [number | undefined, string | undefined] | undefined;
    private readonly listeners: Record<string, ((event: never) => void)[]> = {};

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }
    close(code?: number, reason?: string): void {
        this.closedWith = [code, reason];
    }
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

/** Zeiten, die der Test selbst vorrückt. */
class FakeTimers implements Timers {
    now = 0;
    private nextId = 1;
    readonly timeouts = new Map<number, { at: number; callback: () => void }>();
    readonly intervals = new Map<number, { every: number; next: number; callback: () => void }>();

    setTimeout(callback: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.timeouts.set(id, { at: this.now + ms, callback });
        return id;
    }
    clearTimeout(handle: unknown): void {
        this.timeouts.delete(handle as number);
    }
    setInterval(callback: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.intervals.set(id, { every: ms, next: this.now + ms, callback });
        return id;
    }
    clearInterval(handle: unknown): void {
        this.intervals.delete(handle as number);
    }
    advance(ms: number): void {
        const target = this.now + ms;
        for (;;) {
            const due = [
                ...[...this.timeouts.entries()].map(([id, entry]) => ({ at: entry.at, id, kind: "timeout" as const })),
                ...[...this.intervals.entries()].map(([id, entry]) => ({
                    at: entry.next,
                    id,
                    kind: "interval" as const,
                })),
            ]
                .filter((entry) => entry.at <= target)
                .sort((left, right) => left.at - right.at)[0];
            if (!due) break;
            this.now = due.at;
            if (due.kind === "timeout") {
                const entry = this.timeouts.get(due.id);
                this.timeouts.delete(due.id);
                entry?.callback();
            } else {
                const entry = this.intervals.get(due.id);
                if (entry) {
                    entry.next += entry.every;
                    entry.callback();
                }
            }
        }
        this.now = target;
    }
}

function setup(options: { random?: number; since?: () => number | null } = {}) {
    const timers = new FakeTimers();
    const sockets: FakeSocket[] = [];
    const events: JobEventRecord[] = [];
    const gaps: number[] = [];
    const states: SocketState[] = [];
    let connected = 0;
    const socket = new JobsSocket({
        url: "ws://x/ws",
        getSince: options.since ?? (() => null),
        onEvent: (event) => events.push(event),
        onGap: (seq) => gaps.push(seq),
        onConnected: () => {
            connected += 1;
        },
        onState: (state) => states.push(state),
        createSocket: () => {
            const fake = new FakeSocket();
            sockets.push(fake);
            return fake;
        },
        timers,
        random: () => options.random ?? 1,
    });
    return { socket, timers, sockets, events, gaps, states, connected: () => connected };
}

const event = (seq: number): JobEventRecord => ({
    seq,
    at: "2026-10-04T12:00:00.000Z",
    kind: "job.queued",
    jobId: "x",
    mapDomainId: "aventuria",
    payload: {},
});

describe("Backoff mit Jitter", () => {
    it("der Spielraum wächst mit jedem Fehlschlag (1, 2, 4, 8 s …) und bleibt bei 30 s stehen", () => {
        // random = 1 ist die längste Wartezeit, random = 0 die kürzeste (ein Viertel des Spielraums, nie 0)
        const longest = [0, 1, 2, 3, 4, 5, 6, 10].map((attempt) => reconnectDelay(attempt, 1));
        expect(longest).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
        const shortest = [0, 1, 2, 5, 10].map((attempt) => reconnectDelay(attempt, 0));
        expect(shortest).toEqual([250, 500, 1000, 7500, 7500]);
        expect(DEFAULT_BASE_DELAY_MS).toBe(1000);
        expect(DEFAULT_MAX_DELAY_MS).toBe(30_000);
    });

    it("🔴 Jitter: gleiche Fehlschläge, verschiedene Zufallswerte, verschiedene Wartezeiten (nie alle Tabs im selben Augenblick)", () => {
        const delays = new Set([0, 0.25, 0.5, 0.75, 1].map((random) => reconnectDelay(3, random)));
        expect(delays.size).toBe(5);
        for (const delay of delays) {
            expect(delay).toBeGreaterThanOrEqual(2000);
            expect(delay).toBeLessThanOrEqual(8000);
        }
    });

    it("Zufallswerte außerhalb von 0 bis 1 werden begrenzt", () => {
        expect(reconnectDelay(0, -5)).toBe(250);
        expect(reconnectDelay(0, 99)).toBe(1000);
    });
});

describe("Verbindung", () => {
    it("verbindet, meldet sich an (ohne Nummer beim ersten Mal) und ruft `onConnected` für den Stand über HTTP", () => {
        const { socket, sockets, states, connected } = setup();
        socket.start();
        expect(states).toEqual(["connecting"]);
        sockets[0]?.fire("open");
        expect(states).toEqual(["connecting", "open"]);
        expect(connected()).toBe(1);
        expect(sockets[0]?.sent).toEqual([{ op: "subscribe", channel: "jobs" }]);
    });

    it("🔴 Reconnect: das Abo trägt das letzte bekannte `seq` (`since`), damit der Server nachspielt", () => {
        let since: number | null = 41;
        const { socket, sockets, timers } = setup({ since: () => since });
        socket.start();
        sockets[0]?.fire("open");
        expect(sockets[0]?.sent).toEqual([{ op: "subscribe", channel: "jobs", since: 41 }]);
        since = 57;
        sockets[0]?.fire("close", { code: 1006 });
        timers.advance(1000);
        sockets[1]?.fire("open");
        expect(sockets[1]?.sent).toEqual([{ op: "subscribe", channel: "jobs", since: 57 }]);
    });

    it("Ereignisse gehen weiter, `gap` meldet, dass der Stand neu zu holen ist", () => {
        const { socket, sockets, events, gaps } = setup();
        socket.start();
        sockets[0]?.fire("open");
        sockets[0]?.message({ op: "hello", seq: 5, serverTime: "x", releaseId: "r" });
        sockets[0]?.message({ op: "subscribed", channel: "jobs", seq: 5 });
        sockets[0]?.message({ op: "event", channel: "jobs", event: event(6) });
        sockets[0]?.message({ op: "gap", channel: "jobs", seq: 90 });
        sockets[0]?.message({ op: "pong", serverTime: "x" });
        expect(events.map((entry) => entry.seq)).toEqual([6]);
        expect(gaps).toEqual([90]);
    });

    it("Nachrichten, die kein JSON sind, werden überhört", () => {
        const { socket, sockets, events } = setup();
        socket.start();
        sockets[0]?.fire("open");
        sockets[0]?.fire("message", { data: "kein json" });
        sockets[0]?.message({ op: "event", channel: "jobs", event: event(1) });
        expect(events).toHaveLength(1);
    });
});

describe("Lebenszeichen und Neuverbinden", () => {
    it("🔴 alle 30 s ein Ping (Nginx hält /ws 3.600 s offen), nur solange verbunden", () => {
        const { socket, sockets, timers } = setup();
        socket.start();
        sockets[0]?.fire("open");
        timers.advance(29_999);
        expect(sockets[0]?.sent.filter((message) => (message as { op: string }).op === "ping")).toHaveLength(0);
        timers.advance(1);
        timers.advance(30_000);
        expect(sockets[0]?.sent.filter((message) => (message as { op: string }).op === "ping")).toHaveLength(2);
        sockets[0]?.fire("close", { code: 1006 });
        timers.advance(120_000);
        // nach dem Abbruch pingt der alte Socket nicht mehr
        expect(sockets[0]?.sent.filter((message) => (message as { op: string }).op === "ping")).toHaveLength(2);
    });

    it("🔴 1001 (der alte Slot geht, Blue/Green): der Client verbindet nach dem Backoff neu und abonniert wieder", () => {
        const { socket, sockets, timers, states } = setup({ random: 1 });
        socket.start();
        sockets[0]?.fire("open");
        sockets[0]?.message({ op: "subscribed", channel: "jobs", seq: 1 });
        sockets[0]?.fire("close", { code: 1001 });
        expect(states.at(-1)).toBe("retrying");
        timers.advance(999);
        expect(sockets).toHaveLength(1);
        timers.advance(1);
        expect(sockets).toHaveLength(2);
        sockets[1]?.fire("open");
        expect(sockets[1]?.sent[0]).toEqual({ op: "subscribe", channel: "jobs" });
        expect(states.at(-1)).toBe("open");
    });

    it("scheitert das Verbinden mehrfach, wächst die Wartezeit; eine Nachricht des Servers setzt sie zurück", () => {
        const { socket, sockets, timers } = setup({ random: 1 });
        socket.start();
        // 1. Fehlschlag: 1 s, 2. Fehlschlag: 2 s, 3.: 4 s
        sockets[0]?.fire("error");
        timers.advance(1000);
        sockets[1]?.fire("error");
        timers.advance(1999);
        expect(sockets).toHaveLength(2);
        timers.advance(1);
        expect(sockets).toHaveLength(3);
        sockets[2]?.fire("open");
        sockets[2]?.message({ op: "subscribed", channel: "jobs", seq: 1 });
        // verbunden gewesen: der nächste Abbruch beginnt wieder bei 1 s
        sockets[2]?.fire("close", { code: 1006 });
        timers.advance(1000);
        expect(sockets).toHaveLength(4);
    });

    it("error gefolgt von close löst nur EIN Neuverbinden aus", () => {
        const { socket, sockets, timers } = setup();
        socket.start();
        sockets[0]?.fire("error");
        sockets[0]?.fire("close", { code: 1006 });
        timers.advance(60_000);
        expect(sockets).toHaveLength(2);
    });

    it("stop: schließt, und es gibt kein Neuverbinden mehr", () => {
        const { socket, sockets, timers, states } = setup();
        socket.start();
        sockets[0]?.fire("open");
        socket.stop();
        expect(sockets[0]?.closedWith?.[0]).toBe(1000);
        expect(states.at(-1)).toBe("stopped");
        sockets[0]?.fire("close", { code: 1000 });
        timers.advance(120_000);
        expect(sockets).toHaveLength(1);
        expect(timers.intervals.size).toBe(0);
        expect(timers.timeouts.size).toBe(0);
    });

    it("ein Ereignis eines alten, schon ersetzten Sockets wird überhört", () => {
        const { socket, sockets, timers, events } = setup();
        socket.start();
        sockets[0]?.fire("open");
        sockets[0]?.fire("close", { code: 1006 });
        timers.advance(1000);
        sockets[1]?.fire("open");
        sockets[0]?.message({ op: "event", channel: "jobs", event: event(9) });
        expect(events).toEqual([]);
    });

    it("ein Socket, der sich gar nicht erst bauen lässt, führt zum Neuversuch", () => {
        const timers = new FakeTimers();
        let attempts = 0;
        const socket = new JobsSocket({
            url: "ws://x/ws",
            getSince: () => null,
            onEvent: () => undefined,
            onGap: () => undefined,
            onConnected: () => undefined,
            createSocket: () => {
                attempts += 1;
                throw new Error("SecurityError");
            },
            timers,
            random: () => 1,
        });
        socket.start();
        expect(attempts).toBe(1);
        timers.advance(1000);
        expect(attempts).toBe(2);
        socket.stop();
    });
});
