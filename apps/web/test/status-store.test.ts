import { describe, expect, it } from "vitest";
import type { JobsOverview, RepoOverview } from "@avesmaps3d/shared";
import {
    POLL_SLOW_MS,
    POLL_WITHOUT_SOCKET_MS,
    POLL_WITH_SOCKET_MS,
    REFRESH_DEBOUNCE_MS,
    createStatusStore,
} from "../src/status/status-store.ts";
import type { Timers, WebSocketLike } from "../src/status/jobs-socket.ts";

/**
 * Der Zustand der Statusseite (JOBS-0001 5.4): HTTP ist die Wahrheit, `/ws` weckt nur. Ein Ereignis löst ein entprelltes Neuladen
 * aus; fällt `/ws` aus, fragt die Seite alle paar Sekunden nach, solange sie sichtbar ist.
 */

class FakeTimers implements Timers {
    now = 1_000_000;
    private nextId = 1;
    private readonly timeouts = new Map<number, { at: number; callback: () => void }>();
    private readonly intervals = new Map<number, { every: number; next: number; callback: () => void }>();
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

class FakeSocket implements WebSocketLike {
    sent: unknown[] = [];
    private readonly listeners: Record<string, ((event: never) => void)[]> = {};
    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }
    close(): void {}
    addEventListener(type: string, listener: (event: never) => void): void {
        (this.listeners[type] ??= []).push(listener);
    }
    fire(type: string, event?: unknown): void {
        for (const listener of this.listeners[type] ?? []) listener((event ?? {}) as never);
    }
    message(message: unknown): void {
        this.fire("message", { data: JSON.stringify(message) });
    }
}

function overview(seq: number, extra: Partial<JobsOverview> = {}): JobsOverview {
    return {
        seq,
        now: new Date(1_000_000 + 5000).toISOString(),
        releaseId: "test",
        profile: "local",
        plannerActive: true,
        queuePause: { paused: false, since: null, by: null, reason: null },
        view: "all",
        running: [],
        queued: [],
        recent: [],
        failed: [],
        stalled: [],
        memory: {
            bookedMb: 0,
            budgetMb: null,
            availableMb: null,
            availFloorMb: null,
            swapUsedMb: null,
            rolloutActive: false,
        },
        ...extra,
    };
}

function repo(available: boolean): RepoOverview {
    return {
        available,
        reason: available ? null : "not_local",
        generatedAt: "x",
        today: "2026-10-04",
        waiting: [],
        decidedToday: [],
        selfDecided: [],
        sessions: [],
        dataStand: [],
    };
}

interface Harness {
    requests: string[];
    respond: (path: string, status: number, body: unknown) => void;
    timers: FakeTimers;
    sockets: FakeSocket[];
    store: ReturnType<typeof createStatusStore>;
    visible: { value: boolean };
}

function harness(): Harness {
    const requests: string[] = [];
    const responses = new Map<string, { status: number; body: unknown }>([
        ["/api/jobs/overview", { status: 200, body: overview(10) }],
        [
            "/api/status/operations",
            {
                status: 200,
                body: {
                    now: "x",
                    releaseId: "t",
                    profile: "p",
                    health: { database: { status: "ok", detail: "d" } },
                    migration: "0070",
                    pointers: { dem: null, displayHeights: { state: "none", revision: null, demRevision: null } },
                    legacy: { mapRevision: null, ecosystemRevision: null, territoriesRevision: null, importedAt: null },
                    imports: [],
                },
            },
        ],
        ["/api/status/overview", { status: 200, body: repo(true) }],
    ]);
    const timers = new FakeTimers();
    const sockets: FakeSocket[] = [];
    const visible = { value: true };
    const store = createStatusStore({
        fetchJson: async (path) => {
            requests.push(path);
            const response = responses.get(path) ?? { status: 404, body: null };
            return response;
        },
        createSocket: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
        },
        timers,
        random: () => 1,
        now: () => timers.now,
        isVisible: () => visible.value,
        socketUrl: () => "ws://x/ws",
    });
    return {
        requests,
        respond: (path, status, body) => void responses.set(path, { status, body }),
        timers,
        sockets,
        store,
        visible,
    };
}

/** Lässt ausstehende Versprechen ablaufen. */
const settle = async (): Promise<void> => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("Start", () => {
    it("holt zuerst den Stand über HTTP, dann verbindet `/ws` mit der Nummer des Standes", async () => {
        const { store, requests, sockets } = harness();
        store.start();
        await settle();
        expect(requests).toContain("/api/jobs/overview");
        expect(store.overview.value?.seq).toBe(10);
        expect(sockets).toHaveLength(1);
        sockets[0]?.fire("open");
        expect(sockets[0]?.sent).toEqual([{ op: "subscribe", channel: "jobs", since: 10 }]);
        expect(store.lastSeq()).toBe(10);
        store.stop();
    });

    it("🔴 Serverzeit: „jetzt“ läuft in der Zeit des Servers, auch wenn die Uhr des Browsers abweicht", async () => {
        const { store, timers } = harness();
        store.start();
        await settle();
        // Der Server sagt 5 s später als die Uhr der Seite.
        timers.advance(1000);
        expect(store.nowMs.value).toBe(timers.now + 5000);
        store.stop();
    });

    it("🔴 Serverzeit sofort nach dem Laden: die Seite zeigt keine Sekunde lang Zeiten der falschen Uhr", async () => {
        const { store, timers } = harness();
        store.start();
        await settle();
        // Kein Takt ist vergangen: der Stand ist da, und „jetzt“ ist schon die Zeit des Servers.
        expect(store.nowMs.value).toBe(timers.now + 5000);
        store.stop();
    });

    it("🔴 `STATUS_PAGE=off` (404 status_disabled): keine Verbindung zu `/ws`, kein Neuverbinden gegen eine 404", async () => {
        const { store, respond, sockets } = harness();
        respond("/api/jobs/overview", 404, { error: { code: "status_disabled", message: "aus" } });
        store.start();
        await settle();
        expect(store.queueFailure.value).toBe("disabled");
        expect(store.overview.value).toBeNull();
        expect(sockets).toHaveLength(0);
        store.stop();
    });

    it("503 ist `unavailable`, ein anderer Fehler `error`; ein Netzfehler ebenso", async () => {
        const { store, respond } = harness();
        respond("/api/jobs/overview", 503, { error: { code: "database_unavailable", message: "x" } });
        await store.refreshOverview();
        expect(store.queueFailure.value).toBe("unavailable");
        respond("/api/jobs/overview", 500, { error: { code: "internal_error" } });
        await store.refreshOverview();
        expect(store.queueFailure.value).toBe("error");
        respond("/api/jobs/overview", 200, overview(11));
        await store.refreshOverview();
        expect(store.queueFailure.value).toBeNull();
        expect(store.overview.value?.seq).toBe(11);
    });

    it("🔴 WI-0120 A11: 401 heißt Anmeldung nötig, 403 kein Recht, eine fehlende Bestätigung heißt `confirm`", async () => {
        const { store, respond } = harness();
        respond("/api/jobs/overview", 401, { error: { code: "unauthenticated", message: "x" } });
        await store.refreshOverview();
        expect(store.queueFailure.value).toBe("signin");
        respond("/api/jobs/overview", 403, { error: { code: "forbidden", message: "x" } });
        await store.refreshOverview();
        expect(store.queueFailure.value).toBe("forbidden");
        respond("/api/status/operations", 403, {
            error: { code: "assurance_required", message: "x", details: { need: "second_factor" } },
        });
        await store.refreshOperations();
        expect(store.operationsFailure.value).toBe("confirm");
    });

    it("ein Fehler lässt den letzten bekannten Stand stehen", async () => {
        const { store, respond } = harness();
        await store.refreshOverview();
        respond("/api/jobs/overview", 503, { error: { code: "database_unavailable" } });
        await store.refreshOverview();
        expect(store.overview.value?.seq).toBe(10);
        expect(store.queueFailure.value).toBe("unavailable");
    });
});

describe("Ereignisse wecken, HTTP liefert", () => {
    it("🔴 ein Ereignis ändert keine Anzeige selbst: es holt den Stand neu (entprellt, ein Neuladen für eine ganze Folge)", async () => {
        const { store, requests, timers, sockets, respond } = harness();
        store.start();
        await settle();
        sockets[0]?.fire("open");
        await settle();
        const before = requests.filter((path) => path === "/api/jobs/overview").length;
        respond("/api/jobs/overview", 200, overview(14));
        for (const seq of [11, 12, 13, 14]) {
            sockets[0]?.message({
                op: "event",
                channel: "jobs",
                event: { seq, at: "x", kind: "job.queued", jobId: "j", mapDomainId: "a", payload: {} },
            });
        }
        // vor Ablauf der Entprellung: noch nichts geholt, die Anzeige unverändert
        timers.advance(REFRESH_DEBOUNCE_MS - 1);
        await settle();
        expect(requests.filter((path) => path === "/api/jobs/overview")).toHaveLength(before);
        expect(store.overview.value?.seq).toBe(10);
        timers.advance(1);
        await settle();
        expect(requests.filter((path) => path === "/api/jobs/overview")).toHaveLength(before + 1);
        expect(store.overview.value?.seq).toBe(14);
        expect(store.lastSeq()).toBe(14);
        store.stop();
    });

    it("`gap`: der Stand wird neu geholt, die Nummer des Servers gilt ab jetzt", async () => {
        const { store, requests, sockets, respond } = harness();
        store.start();
        await settle();
        sockets[0]?.fire("open");
        await settle();
        const before = requests.length;
        respond("/api/jobs/overview", 200, overview(500));
        sockets[0]?.message({ op: "gap", channel: "jobs", seq: 500 });
        await settle();
        expect(requests.length).toBeGreaterThan(before);
        expect(store.overview.value?.seq).toBe(500);
        store.stop();
    });

    it("jede (Wieder-)Verbindung holt den Stand über HTTP neu, ehe Ereignisse zählen", async () => {
        const { store, requests, sockets } = harness();
        store.start();
        await settle();
        const before = requests.filter((path) => path === "/api/jobs/overview").length;
        sockets[0]?.fire("open");
        await settle();
        expect(requests.filter((path) => path === "/api/jobs/overview").length).toBe(before + 1);
        store.stop();
    });
});

describe("Abfrage als Sicherheitsnetz", () => {
    it("🔴 ohne `/ws` alle 5 s, mit `/ws` nur alle 15 s, und nur, solange die Seite sichtbar ist", async () => {
        const { store, requests, timers, sockets, visible } = harness();
        store.start();
        await settle();
        const count = () => requests.filter((path) => path === "/api/jobs/overview").length;
        // Verbindung steht noch nicht (kein open): 5 s
        const base = count();
        timers.advance(POLL_WITHOUT_SOCKET_MS);
        await settle();
        expect(count()).toBe(base + 1);
        // Verbunden: nur noch alle 15 s
        sockets[0]?.fire("open");
        await settle();
        const afterOpen = count();
        timers.advance(POLL_WITH_SOCKET_MS - 2000);
        await settle();
        expect(count()).toBe(afterOpen);
        timers.advance(2000);
        await settle();
        expect(count()).toBe(afterOpen + 1);
        // Verborgen: es wird nicht gefragt
        visible.value = false;
        const hidden = count();
        timers.advance(POLL_WITH_SOCKET_MS * 3);
        await settle();
        expect(count()).toBe(hidden);
        store.stop();
    });

    it("Betrieb und Überblick werden nur auf ihrem Reiter und nur langsam abgefragt", async () => {
        const { store, requests, timers } = harness();
        store.start();
        await settle();
        const count = (path: string) => requests.filter((entry) => entry === path).length;
        // Der Überblick wird einmal gelesen (er entscheidet, ob sein Reiter erscheint), Betrieb noch nicht.
        expect(count("/api/status/overview")).toBe(1);
        expect(count("/api/status/operations")).toBe(0);
        store.setTab("operations");
        await settle();
        expect(count("/api/status/operations")).toBe(1);
        timers.advance(POLL_SLOW_MS);
        await settle();
        expect(count("/api/status/operations")).toBe(2);
        store.setTab("queue");
        timers.advance(POLL_SLOW_MS * 2);
        await settle();
        expect(count("/api/status/operations")).toBe(2);
        store.stop();
    });
});

describe("Überblick nur lokal (D2 A)", () => {
    it("🔴 auf der Stage (`available: false`) gibt es den Reiter nicht", async () => {
        const { store, respond } = harness();
        respond("/api/status/overview", 200, repo(false));
        await store.refreshRepo();
        expect(store.overviewAvailable.value).toBe(false);
    });

    it("lokal ist er da", async () => {
        const { store } = harness();
        await store.refreshRepo();
        expect(store.overviewAvailable.value).toBe(true);
    });

    it("solange nichts geladen ist, gilt er als nicht da", () => {
        const { store } = harness();
        expect(store.overviewAvailable.value).toBe(false);
    });
});

describe("Verbindung für die Anzeige", () => {
    it("live, wenn `/ws` offen ist; sonst Abfrage; ohne jede Antwort offline", async () => {
        const { store, sockets, respond } = harness();
        store.start();
        await settle();
        expect(store.connection.value).toBe("polling");
        sockets[0]?.fire("open");
        expect(store.connection.value).toBe("live");
        store.stop();

        const offline = harness();
        offline.respond("/api/jobs/overview", 503, { error: { code: "database_unavailable" } });
        await offline.store.refreshOverview();
        expect(offline.store.connection.value).toBe("offline");
        expect(respond).toBeTypeOf("function");
    });
});
