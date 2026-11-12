import type { JobEventRecord, WsChannel, WsClientMessage, WsServerMessage } from "@avesmaps3d/shared";

/**
 * Der Client von `/ws` (JOBS-0001 4.9, V5): verbindet, abonniert den Kanal `jobs`, schickt alle 30 s ein Lebenszeichen und
 * verbindet nach einem Abbruch mit Backoff und Jitter neu.
 *
 * 🔴 HTTP BLEIBT AUTORITATIV. Das Ereignis trägt `seq`; wer sich (neu) verbindet, holt den Stand über HTTP und abonniert ab seiner
 * letzten Nummer (`since`). Der Server spielt nach, was noch da ist, oder sagt `gap`, und der Client holt alles neu. Ein verpasstes
 * Ereignis kostet nur Aktualität, nie Richtigkeit; ein Seitenreload ist nie der Weg der Synchronisation (7.29, 7.30).
 *
 * Was beim Beenden des Servers geschieht (Blue/Green), ist der Normalfall: der alte Slot sendet `1001 going away` oder bricht hart
 * nach `worker_shutdown_timeout` ab. Beides endet in `close`; der Client wartet einen zufälligen Teil des Backoffs (Jitter, damit
 * nicht alle Tabs im selben Augenblick wiederkommen) und verbindet neu.
 */

export type SocketState = "connecting" | "open" | "retrying" | "stopped";

/** Was der Client vom Browser-`WebSocket` braucht: im Test ein Double. */
export interface WebSocketLike {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "open", listener: () => void): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    addEventListener(type: "close", listener: (event: { code: number }) => void): void;
    addEventListener(type: "error", listener: () => void): void;
}

export interface Timers {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface JobsSocketOptions {
    url: string;
    /** Der Kanal: `jobs` (die Statusseite, Vorgabe) oder `area` (die Karte, WI-0125). */
    channel?: WsChannel;
    /**
     * Kam die allererste Verbindung nie zustande (kein `/ws` auf dieser Instanz, Anmeldung verlangt), nicht weiter versuchen (WI-0125:
     * die Karte, die nur mithört, soll keine Fehler im Takt erzeugen). Eine Verbindung, die einmal stand, verbindet immer neu.
     */
    stopIfNeverOpened?: boolean;
    /** Die letzte Nummer, die der Stand kennt (aus HTTP oder dem letzten Ereignis); `null`: noch keine. */
    getSince(): number | null;
    onEvent(event: JobEventRecord): void;
    /** Der Server sagt: die Ereignisse sind aufgeräumt. Der Stand muss neu geholt werden. */
    onGap(seq: number): void;
    /** Eine Verbindung steht (neu): der Stand wird über HTTP neu geholt, ehe Ereignisse zählen. */
    onConnected(): void;
    onState?(state: SocketState): void;
    createSocket?(url: string): WebSocketLike;
    timers?: Timers;
    /** 0..1; im Test fest. */
    random?(): number;
    pingEveryMs?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

export const DEFAULT_PING_MS = 30_000;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Wie lange bis zum nächsten Versuch: der Spielraum wächst mit jedem Fehlschlag (`base × 2^n`, höchstens `max`), die Wartezeit ist
 * ein zufälliger Anteil davon („Full Jitter“) mit einem Boden von einem Viertel, damit nie 0 ms herauskommen.
 */
export function reconnectDelay(
    attempt: number,
    random: number,
    baseMs = DEFAULT_BASE_DELAY_MS,
    maxMs = DEFAULT_MAX_DELAY_MS,
): number {
    const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
    const floor = ceiling / 4;
    return Math.round(floor + (ceiling - floor) * Math.min(1, Math.max(0, random)));
}

const realTimers: Timers = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export class JobsSocket {
    private readonly options: JobsSocketOptions;
    private readonly timers: Timers;
    private socket: WebSocketLike | undefined;
    private pingTimer: unknown;
    private retryTimer: unknown;
    private attempt = 0;
    private everOpened = false;
    private stopped = true;
    private current: SocketState = "stopped";

    constructor(options: JobsSocketOptions) {
        this.options = options;
        this.timers = options.timers ?? realTimers;
    }

    get state(): SocketState {
        return this.current;
    }

    private setState(next: SocketState): void {
        if (this.current === next) return;
        this.current = next;
        this.options.onState?.(next);
    }

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        this.clearTimers();
        const socket = this.socket;
        this.socket = undefined;
        try {
            socket?.close(1000, "bye");
        } catch {
            // schon zu
        }
        this.setState("stopped");
    }

    private clearTimers(): void {
        if (this.pingTimer !== undefined) this.timers.clearInterval(this.pingTimer);
        if (this.retryTimer !== undefined) this.timers.clearTimeout(this.retryTimer);
        this.pingTimer = undefined;
        this.retryTimer = undefined;
    }

    private send(message: WsClientMessage): void {
        try {
            this.socket?.send(JSON.stringify(message));
        } catch {
            // Der nächste `close` löst das Neuverbinden aus.
        }
    }

    private connect(): void {
        if (this.stopped) return;
        this.setState("connecting");
        let socket: WebSocketLike;
        try {
            socket = (this.options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike))(
                this.options.url,
            );
        } catch {
            this.scheduleRetry();
            return;
        }
        this.socket = socket;
        socket.addEventListener("open", () => {
            if (this.socket !== socket) return;
            this.everOpened = true;
            this.setState("open");
            // Erst der Stand über HTTP, dann abonnieren ab seiner Nummer: `onConnected` setzt `getSince` neu.
            this.options.onConnected();
            const since = this.options.getSince();
            const channel = this.options.channel ?? "jobs";
            this.send(since === null ? { op: "subscribe", channel } : { op: "subscribe", channel, since });
            // Nginx hält `/ws` 3.600 s offen (Q9); ein Browser kann keine Ping-Rahmen senden, also ein Lebenszeichen der Anwendung.
            this.pingTimer = this.timers.setInterval(
                () => this.send({ op: "ping" }),
                this.options.pingEveryMs ?? DEFAULT_PING_MS,
            );
        });
        socket.addEventListener("message", (event) => {
            if (this.socket !== socket) return;
            let message: WsServerMessage;
            try {
                message = JSON.parse(String(event.data)) as WsServerMessage;
            } catch {
                return;
            }
            // Eine Nachricht des Servers heißt: die Verbindung trägt. Der Backoff beginnt wieder bei Null.
            if (message.op === "subscribed" || message.op === "hello") this.attempt = 0;
            if (message.op === "event") this.options.onEvent(message.event);
            else if (message.op === "gap") this.options.onGap(message.seq);
        });
        const lost = (): void => {
            if (this.socket !== socket) return;
            this.socket = undefined;
            if (this.pingTimer !== undefined) this.timers.clearInterval(this.pingTimer);
            this.pingTimer = undefined;
            this.scheduleRetry();
        };
        socket.addEventListener("close", lost);
        socket.addEventListener("error", lost);
    }

    private scheduleRetry(): void {
        if (this.stopped || this.retryTimer !== undefined) return;
        if (this.options.stopIfNeverOpened === true && !this.everOpened) {
            this.stop();
            return;
        }
        this.setState("retrying");
        const delay = reconnectDelay(
            this.attempt,
            (this.options.random ?? Math.random)(),
            this.options.baseDelayMs,
            this.options.maxDelayMs,
        );
        this.attempt += 1;
        this.retryTimer = this.timers.setTimeout(() => {
            this.retryTimer = undefined;
            this.connect();
        }, delay);
    }
}
