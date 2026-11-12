import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { JobEventRecord, JobsOverview, OperationsStatus, RepoOverview } from "@avesmaps3d/shared";
import { JobsSocket, type SocketState, type Timers, type WebSocketLike } from "./jobs-socket";

/**
 * Der Zustand der Statusseite (JOBS-0001 5.4): holt den Stand über HTTP, hört auf `/ws` und holt bei jedem Ereignis neu.
 *
 * 🔴 HTTP IST DIE WAHRHEIT, `/ws` NUR DER WECKRUF. Ein Ereignis ändert keine Anzeige selbst; es löst ein (entprelltes) Neuladen von
 * `GET /api/jobs/overview` aus. Wartezeiten und Positionen rechnet der Server, der Client könnte sie aus Deltas nicht richtig
 * nachbilden. Fällt `/ws` aus (Proxy, Blue/Green), fragt die Seite alle paar Sekunden nach, solange sie sichtbar ist.
 *
 * Nur lesend: es gibt keinen Knopf, der die Queue verändert (Etappe 1).
 */

/**
 * Warum der Stand fehlt. Seit WI-0120 A11 (JOBS-0001 D1 A) auch: Anmeldung nötig (`signin`), kein Recht (`forbidden`), oder eine
 * Anmeldung mit zweitem Faktor fehlt für Betrieb und Überblick (`confirm`; eine Frist hat er seit 2026-10-10 nicht mehr).
 */
export type LoadFailure = "disabled" | "unavailable" | "error" | "signin" | "forbidden" | "confirm";
export type Connection = "live" | "polling" | "offline";
export type TabKey = "queue" | "operations" | "overview";

export interface StatusStoreDeps {
    /** Holt eine Adresse als JSON; im Test ein Double. */
    fetchJson?(path: string): Promise<{ status: number; body: unknown }>;
    createSocket?(url: string): WebSocketLike;
    timers?: Timers;
    random?(): number;
    now?(): number;
    /** Ist die Seite sichtbar? Verborgen wird nicht abgefragt. */
    isVisible?(): boolean;
    socketUrl?(): string;
}

const defaultFetchJson = async (path: string): Promise<{ status: number; body: unknown }> => {
    const response = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
    try {
        return { status: response.status, body: (await response.json()) as unknown };
    } catch {
        return { status: response.status, body: null };
    }
};

const defaultSocketUrl = (): string => {
    const { protocol, host } = globalThis.location;
    return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws`;
};

function failureOf(status: number, body: unknown): LoadFailure {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    if (status === 404 && code === "status_disabled") return "disabled";
    if (status === 503) return "unavailable";
    if (status === 401) return "signin";
    if (status === 403) return code === "assurance_required" || code === "reauth_required" ? "confirm" : "forbidden";
    return "error";
}

/** Wie oft nachgefragt wird (ms): ohne `/ws` alle fünf Sekunden, mit `/ws` nur als Sicherheitsnetz. */
export const POLL_WITHOUT_SOCKET_MS = 5000;
export const POLL_WITH_SOCKET_MS = 15_000;
/** Betrieb und Überblick ändern sich selten. */
export const POLL_SLOW_MS = 30_000;
export const REFRESH_DEBOUNCE_MS = 200;

export interface StatusStore {
    overview: ShallowRef<JobsOverview | null>;
    operations: ShallowRef<OperationsStatus | null>;
    repo: ShallowRef<RepoOverview | null>;
    queueFailure: Ref<LoadFailure | null>;
    operationsFailure: Ref<LoadFailure | null>;
    connection: ComputedRef<Connection>;
    socketState: Ref<SocketState>;
    /** „Jetzt“ in Serverzeit (ms), jede Sekunde neu: Zeiten wie „seit 5 min“ laufen mit. */
    nowMs: Ref<number>;
    tab: Ref<TabKey>;
    /** Sind die Überblick-Daten da (nur lokal)? Entscheidet, ob der Reiter erscheint. */
    overviewAvailable: ComputedRef<boolean>;
    setTab(next: TabKey): void;
    start(): void;
    stop(): void;
    refreshOverview(): Promise<void>;
    refreshOperations(): Promise<void>;
    refreshRepo(): Promise<void>;
    /** Für Tests und den Browsertest: die Nummer des letzten bekannten Ereignisses. */
    lastSeq(): number | null;
}

export function createStatusStore(deps: StatusStoreDeps = {}): StatusStore {
    const fetchJson = deps.fetchJson ?? defaultFetchJson;
    const clock = deps.now ?? Date.now;
    const visible = deps.isVisible ?? ((): boolean => globalThis.document?.visibilityState !== "hidden");
    const timers: Timers = deps.timers ?? {
        setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
        setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
        clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    };

    const overview = shallowRef<JobsOverview | null>(null);
    const operations = shallowRef<OperationsStatus | null>(null);
    const repo = shallowRef<RepoOverview | null>(null);
    const queueFailure = ref<LoadFailure | null>(null);
    const operationsFailure = ref<LoadFailure | null>(null);
    const socketState = ref<SocketState>("stopped");
    const nowMs = ref(clock());
    const tab = ref<TabKey>("queue");
    /** Abstand zwischen Server- und Browseruhr: „seit“ rechnet in Serverzeit. */
    let skewMs = 0;
    let latestSeq: number | null = null;
    const lastFetch = { overview: 0, operations: 0, repo: 0 };
    const inflight = { overview: false, operations: false, repo: false };
    const again = { overview: false };
    let debounce: unknown;
    let ticker: unknown;
    let socket: JobsSocket | undefined;

    const connection = computed<Connection>(() => {
        if (socketState.value === "open") return "live";
        return queueFailure.value === null || overview.value !== null ? "polling" : "offline";
    });
    const overviewAvailable = computed(() => repo.value?.available === true);

    async function refreshOverview(): Promise<void> {
        if (inflight.overview) {
            again.overview = true;
            return;
        }
        inflight.overview = true;
        try {
            do {
                again.overview = false;
                try {
                    const { status, body } = await fetchJson("/api/jobs/overview");
                    lastFetch.overview = clock();
                    if (status === 200) {
                        const next = body as JobsOverview;
                        overview.value = next;
                        queueFailure.value = null;
                        skewMs = Date.parse(next.now) - clock();
                        // Sofort in Serverzeit, nicht erst mit dem nächsten Takt: sonst zeigt die Seite eine Sekunde lang Zeiten der falschen Uhr.
                        nowMs.value = clock() + skewMs;
                        latestSeq = Math.max(latestSeq ?? 0, next.seq);
                    } else {
                        queueFailure.value = failureOf(status, body);
                    }
                } catch {
                    lastFetch.overview = clock();
                    queueFailure.value = "error";
                }
            } while (again.overview);
        } finally {
            inflight.overview = false;
        }
    }

    async function refreshOperations(): Promise<void> {
        if (inflight.operations) return;
        inflight.operations = true;
        try {
            const { status, body } = await fetchJson("/api/status/operations");
            lastFetch.operations = clock();
            if (status === 200) {
                operations.value = body as OperationsStatus;
                operationsFailure.value = null;
            } else {
                operationsFailure.value = failureOf(status, body);
            }
        } catch {
            lastFetch.operations = clock();
            operationsFailure.value = "error";
        } finally {
            inflight.operations = false;
        }
    }

    async function refreshRepo(): Promise<void> {
        if (inflight.repo) return;
        inflight.repo = true;
        try {
            const { status, body } = await fetchJson("/api/status/overview");
            lastFetch.repo = clock();
            if (status === 200) repo.value = body as RepoOverview;
        } catch {
            lastFetch.repo = clock();
        } finally {
            inflight.repo = false;
        }
    }

    /** Ein Ereignis (oder mehrere in Folge) holt den Stand einmal neu. */
    function scheduleRefresh(): void {
        if (debounce !== undefined) return;
        debounce = timers.setTimeout(() => {
            debounce = undefined;
            void refreshOverview();
        }, REFRESH_DEBOUNCE_MS);
    }

    function onEvent(event: JobEventRecord): void {
        latestSeq = Math.max(latestSeq ?? 0, event.seq);
        scheduleRefresh();
    }

    function tick(): void {
        nowMs.value = clock() + skewMs;
        if (!visible()) return;
        const now = clock();
        const queuePoll = socketState.value === "open" ? POLL_WITH_SOCKET_MS : POLL_WITHOUT_SOCKET_MS;
        if (now - lastFetch.overview >= queuePoll) void refreshOverview();
        if (tab.value === "operations" && now - lastFetch.operations >= POLL_SLOW_MS) void refreshOperations();
        if (tab.value === "overview" && now - lastFetch.repo >= POLL_SLOW_MS) void refreshRepo();
    }

    function onVisibility(): void {
        // Wieder sichtbar: sofort den Stand holen, statt auf den nächsten Takt zu warten.
        if (!visible()) return;
        void refreshOverview();
        if (tab.value === "operations") void refreshOperations();
        if (tab.value === "overview") void refreshRepo();
    }

    function setTab(next: TabKey): void {
        tab.value = next;
        if (next === "operations") void refreshOperations();
        if (next === "overview") void refreshRepo();
    }

    function start(): void {
        if (ticker !== undefined) return;
        void refreshRepo();
        // Erst der Stand über HTTP, dann `/ws` ab seiner Nummer.
        void refreshOverview().then(() => {
            socket = new JobsSocket({
                url: (deps.socketUrl ?? defaultSocketUrl)(),
                getSince: () => latestSeq,
                onEvent,
                onGap: (seq) => {
                    // Aufgeräumt: der Stand wird neu geholt, die Nummer des Servers gilt ab jetzt.
                    latestSeq = seq;
                    void refreshOverview();
                },
                onConnected: () => void refreshOverview(),
                onState: (state) => {
                    socketState.value = state;
                },
                ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
                timers,
                ...(deps.random ? { random: deps.random } : {}),
            });
            // Eine Instanz ohne Statusseite hat keinen `/ws`: kein Neuverbinden im Takt gegen eine 404.
            if (queueFailure.value !== "disabled") socket.start();
        });
        ticker = timers.setInterval(tick, 1000);
        globalThis.document?.addEventListener("visibilitychange", onVisibility);
    }

    function stop(): void {
        if (ticker !== undefined) timers.clearInterval(ticker);
        ticker = undefined;
        if (debounce !== undefined) timers.clearTimeout(debounce);
        debounce = undefined;
        socket?.stop();
        socket = undefined;
        globalThis.document?.removeEventListener("visibilitychange", onVisibility);
    }

    return {
        overview,
        operations,
        repo,
        queueFailure,
        operationsFailure,
        connection,
        socketState,
        nowMs,
        tab,
        overviewAvailable,
        setTab,
        start,
        stop,
        refreshOverview,
        refreshOperations,
        refreshRepo,
        lastSeq: () => latestSeq,
    };
}
