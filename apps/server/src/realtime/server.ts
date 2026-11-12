import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { JobEventRecord, WsChannel, WsClientMessage, WsServerMessage } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { isAreaEvent } from "../jobs/area-events.ts";
import { wakeupOf } from "../jobs/own-view.ts";
import { latestSeq, oldestSeq, readEvents } from "../jobs/store.ts";
import type { JobEventHub } from "./hub.ts";
import { WS_CLOSE, acceptWebSocket, type WebSocketConnection } from "./websocket.ts";

/**
 * `/ws`: der Grundkanal der Statusseite (JOBS-0001 V5, 4.9). Kanal `jobs` (die Statusseite) und seit Etappe 2 (WI-0125) Kanal `area`
 * (die Karte): nur die Bereichsereignisse (`jobs/area-events.ts`), mit Bereich und Kachelliste, für jeden, der hereinkam, auch mit
 * der eigenen Sicht eines Editors (sie tragen keine Daten der Queue). Je Kanal eigene Nummer und eigenes Nachspielen.
 *
 * 🔴 HTTP BLEIBT AUTORITATIV. Das Ereignis trägt `seq` und ein paar Felder; wer sich verbunden hat, holt den Stand über
 * `GET /api/jobs/overview`. Nach einem Reconnect schickt der Client sein letztes `seq` (`subscribe.since`): der Server spielt nach,
 * was noch da ist, oder sagt `gap`, und der Client holt alles neu. Ein verpasstes Ereignis kostet nur Aktualität, nie Richtigkeit.
 *
 * Betrieb:
 *   - Der Server schickt alle 30 s einen Ping-Rahmen; hört er 75 s lang nichts, beendet er die Verbindung. Der Client schickt alle 30 s
 *     `{"op":"ping"}` (Nginx hält `/ws` 3.600 s offen, Claudio Q9), ein Browser kann keine Ping-Rahmen senden.
 *   - Beim Beenden des Servers (`preClose`) kommt `1001`; der Client verbindet mit Backoff und Jitter neu.
 *   - Ein langsamer Leser (über 1 MiB unterwegs) wird mit 1013 geschlossen, statt den Speicher zu füllen.
 *   - Die Zahl der Verbindungen je Instanz kann begrenzt werden (`wsMaxConnections`, MS14; ohne Messung unbegrenzt).
 *
 * Wer hereinkommt (WI-0120 A11, JOBS-0001 D1 A): `admit` prüft am Handschlag Herkunft, Sitzung und Recht; abgewiesen wird mit 401
 * oder 403, bevor das Protokoll wechselt. Wer nur die eigenen Jobs sieht, bekommt jedes Ereignis als Weckruf ohne Inhalt (Nummer,
 * Zeit, Art): Das Neuladen über HTTP filtert. Ändern sich Sitzung oder Rechte einer Person (`recheckPerson`, aus `NOTIFY`), wird
 * neu geprüft; gilt etwas anderes, schließt die Verbindung mit 4001, und der Client verbindet neu. Der Takt prüft zusätzlich jede
 * Verbindung in Abständen und schließt, wenn die Sitzung abgelaufen ist.
 */

export interface RealtimeLogger {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
}

/** Was eine Verbindung sieht (WI-0120 A11). Ohne `admit` sieht jede alles, wie vor der Anmeldung. */
export interface RealtimeViewer {
    /** `all`: jedes Ereignis mit Inhalt; `own`: nur der Weckruf. */
    view: "all" | "own";
    personId: string | null;
    /** Wann die Sitzung spätestens endet (ms seit 1970); ohne Sitzung `null`. */
    expiresAtMs: number | null;
}

export type RealtimeAdmission =
    | {
          ok: true;
          viewer: RealtimeViewer;
          /** Gilt der Einlass noch genauso? `false` schließt die Verbindung (4001). */
          recheck?: () => Promise<boolean>;
      }
    | { ok: false; status: 401 | 403 | 503 };

export interface RealtimeOptions {
    hub: JobEventHub;
    database: Database;
    releaseId: string;
    /** Höchstzahl gleichzeitiger Verbindungen; `null`: unbegrenzt (MS14 ist noch nicht gemessen). */
    maxConnections?: number | null;
    pingEveryMs?: number;
    idleTimeoutMs?: number;
    log?: RealtimeLogger;
    now?: () => number;
    /** Einlass am Handschlag; ohne ihn wie vor der Anmeldung. */
    admit?: (request: IncomingMessage) => Promise<RealtimeAdmission>;
    /** Wie oft der Takt den Einlass jeder Verbindung neu prüft (ms); Rückfall für ein verpasstes `NOTIFY`. */
    recheckEveryMs?: number;
}

/** Wie viele Ereignisse ein Reconnect höchstens nachgespielt bekommt. */
const REPLAY_LIMIT = 500;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_MESSAGE_BYTES = 2048;
/** Mehr als so viele Nachrichten in zehn Sekunden: ein Client, der spammt. */
const MAX_MESSAGES_PER_WINDOW = 120;
/** Ohne Anmeldung sieht eine Verbindung alles, wie vor WI-0120. */
const OPEN_VIEWER: RealtimeViewer = { view: "all", personId: null, expiresAtMs: null };

const REFUSAL: Record<401 | 403 | 503, string> = {
    401: "Unauthorized",
    403: "Forbidden",
    503: "Service Unavailable",
};

/** Ein abonnierter Kanal einer Verbindung. */
interface Subscription {
    /** Solange nachgespielt wird, warten neue Ereignisse hier. */
    replaying: boolean;
    pending: JobEventRecord[];
    lastSentSeq: number;
}

interface Client {
    connection: WebSocketConnection;
    viewer: RealtimeViewer;
    recheck: (() => Promise<boolean>) | undefined;
    checkedAtMs: number;
    checking: boolean;
    channels: Map<WsChannel, Subscription>;
    unsubscribeHub: (() => void) | undefined;
    windowStartedMs: number;
    windowCount: number;
}

const CHANNELS: readonly WsChannel[] = ["jobs", "area"];

/** Gehört ein Ereignis in den Kanal? `jobs` bekommt alles, `area` nur die Bereichsereignisse. */
const inChannel = (channel: WsChannel, event: JobEventRecord): boolean => channel === "jobs" || isAreaEvent(event.kind);

export class RealtimeServer {
    private readonly options: RealtimeOptions;
    private readonly clients = new Set<Client>();
    private readonly now: () => number;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: RealtimeOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        const every = options.pingEveryMs ?? 30_000;
        this.timer = setInterval(() => this.sweep(), every);
        this.timer.unref();
    }

    get connectionCount(): number {
        return this.clients.size;
    }

    /** Nimmt `Upgrade: websocket` auf `/ws` an. */
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
        const max = this.options.maxConnections ?? null;
        if (max !== null && this.clients.size >= max) {
            this.options.log?.warn({ connections: this.clients.size, max }, "ws: Verbindungsgrenze erreicht");
            socket.end(
                "HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            );
            return;
        }
        if (this.options.admit === undefined) {
            this.accept(request, socket, head, { ok: true, viewer: OPEN_VIEWER });
            return;
        }
        this.options
            .admit(request)
            .catch((error: unknown): RealtimeAdmission => {
                this.options.log?.warn({ err: error }, "ws: Einlass nicht prüfbar");
                return { ok: false, status: 503 };
            })
            .then((admission) => {
                if (socket.destroyed) return;
                if (!admission.ok) {
                    socket.end(
                        `HTTP/1.1 ${String(admission.status)} ${REFUSAL[admission.status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
                    );
                    return;
                }
                this.accept(request, socket, head, admission);
            });
    }

    private accept(
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        admission: Extract<RealtimeAdmission, { ok: true }>,
    ): void {
        const connection = acceptWebSocket(request, socket, head, {
            maxPayload: MAX_MESSAGE_BYTES,
            now: this.now,
            // Mit Einlass hat der schon die Herkunft geprüft, gegen die öffentliche Adresse statt gegen `Host`.
            checkOrigin: this.options.admit === undefined,
        });
        if (!connection) return;
        const client: Client = {
            connection,
            viewer: admission.viewer,
            recheck: admission.recheck,
            checkedAtMs: this.now(),
            checking: false,
            channels: new Map(),
            unsubscribeHub: undefined,
            windowStartedMs: this.now(),
            windowCount: 0,
        };
        this.clients.add(client);
        connection.onClose(() => {
            client.unsubscribeHub?.();
            this.clients.delete(client);
        });
        connection.onMessage((text) => void this.onMessage(client, text));
        void this.hello(client);
    }

    private send(client: Client, message: WsServerMessage): void {
        if (client.connection.closed) return;
        client.connection.send(JSON.stringify(message));
    }

    private async hello(client: Client): Promise<void> {
        let seq = 0;
        try {
            seq = await latestSeq(this.options.database);
        } catch {
            // Ohne Datenbank kennt der Client seine Nummer nicht: HTTP sagt es ihm.
        }
        this.send(client, {
            op: "hello",
            seq,
            serverTime: new Date(this.now()).toISOString(),
            releaseId: this.options.releaseId,
        });
    }

    private async onMessage(client: Client, text: string): Promise<void> {
        const now = this.now();
        if (now - client.windowStartedMs > 10_000) {
            client.windowStartedMs = now;
            client.windowCount = 0;
        }
        client.windowCount += 1;
        if (client.windowCount > MAX_MESSAGES_PER_WINDOW) {
            client.connection.close(WS_CLOSE.policy, "zu viele Nachrichten");
            return;
        }
        let message: WsClientMessage;
        try {
            message = JSON.parse(text) as WsClientMessage;
        } catch {
            this.send(client, { op: "error", code: "invalid_json" });
            return;
        }
        if (typeof message !== "object" || message === null) {
            this.send(client, { op: "error", code: "invalid_message" });
            return;
        }
        switch (message.op) {
            case "ping":
                this.send(client, { op: "pong", serverTime: new Date(now).toISOString() });
                return;
            case "unsubscribe":
                client.channels.delete(message.channel);
                if (client.channels.size === 0) {
                    client.unsubscribeHub?.();
                    client.unsubscribeHub = undefined;
                }
                return;
            case "subscribe":
                if (!CHANNELS.includes(message.channel)) {
                    this.send(client, { op: "error", code: "unknown_channel" });
                    return;
                }
                await this.subscribe(
                    client,
                    message.channel,
                    typeof message.since === "number" ? message.since : undefined,
                );
                return;
            default:
                this.send(client, { op: "error", code: "unknown_op" });
        }
    }

    private async subscribe(client: Client, channel: WsChannel, since: number | undefined): Promise<void> {
        if (client.channels.has(channel)) return;
        const state: Subscription = { replaying: true, pending: [], lastSentSeq: 0 };
        client.channels.set(channel, state);
        // Erst anmelden, dann nachspielen: was dazwischen kommt, wartet in `pending` und wird danach nach `seq` geordnet gesendet.
        client.unsubscribeHub ??= this.options.hub.subscribe((event) => {
            for (const name of client.channels.keys()) this.deliver(client, name, event);
        });
        let latest = 0;
        try {
            latest = await latestSeq(this.options.database);
            if (since !== undefined && since < latest) {
                const oldest = await oldestSeq(this.options.database);
                if (since > 0 && since + 1 < oldest) {
                    // Die gewünschten Ereignisse sind schon aufgeräumt: der Client holt den Stand neu und vergleicht.
                    this.send(client, { op: "gap", channel, seq: latest });
                    state.lastSentSeq = latest;
                } else {
                    state.lastSentSeq = since;
                    for (const event of await readEvents(this.options.database, since, REPLAY_LIMIT)) {
                        if (inChannel(channel, event))
                            this.send(client, { op: "event", channel, event: this.visible(client, channel, event) });
                        state.lastSentSeq = Math.max(state.lastSentSeq, event.seq);
                    }
                }
            } else {
                state.lastSentSeq = since ?? latest;
            }
        } catch (error) {
            this.options.log?.warn({ err: error }, "ws: Nachspielen gescheitert");
            this.send(client, { op: "gap", channel, seq: latest });
            state.lastSentSeq = latest;
        }
        state.replaying = false;
        this.send(client, { op: "subscribed", channel, seq: state.lastSentSeq });
        const queued = state.pending.sort((left, right) => left.seq - right.seq);
        state.pending = [];
        for (const event of queued) this.deliver(client, channel, event);
    }

    private deliver(client: Client, channel: WsChannel, event: JobEventRecord): void {
        const state = client.channels.get(channel);
        if (!state || client.connection.closed) return;
        if (state.replaying) {
            state.pending.push(event);
            return;
        }
        if (event.seq <= state.lastSentSeq) return;
        state.lastSentSeq = event.seq;
        if (!inChannel(channel, event)) return;
        if (client.connection.bufferedBytes > MAX_BUFFERED_BYTES) {
            client.connection.close(WS_CLOSE.tryAgainLater, "zu langsam");
            return;
        }
        this.send(client, { op: "event", channel, event: this.visible(client, channel, event) });
    }

    /** Die eigene Sicht bekommt im Kanal `jobs` nur den Weckruf; ein Bereichsereignis ist für jeden gleich (keine Daten der Queue). */
    private visible(client: Client, channel: WsChannel, event: JobEventRecord): JobEventRecord {
        return client.viewer.view === "all" || channel === "area" ? event : wakeupOf(event);
    }

    /** Alle 30 s: Ping an jeden, wer 75 s nichts hören ließ, wird beendet; abgelaufene Sitzungen enden, fällige werden neu geprüft. */
    private sweep(): void {
        const idleMs = this.options.idleTimeoutMs ?? 75_000;
        const recheckMs = this.options.recheckEveryMs ?? 60_000;
        const now = this.now();
        for (const client of [...this.clients]) {
            if (now - client.connection.lastSeenMs > idleMs) {
                client.connection.terminate();
                continue;
            }
            if (client.viewer.expiresAtMs !== null && now >= client.viewer.expiresAtMs) {
                client.connection.close(WS_CLOSE.rightsChanged, "session_expired");
                continue;
            }
            if (now - client.checkedAtMs >= recheckMs) void this.recheck(client);
            client.connection.ping();
        }
    }

    /** Sitzung oder Rechte einer Person haben sich geändert (`NOTIFY` aus Migration 0081): ihre Verbindungen neu prüfen. */
    recheckPerson(personId: string): void {
        for (const client of this.clients) if (client.viewer.personId === personId) void this.recheck(client);
    }

    /** Die `LISTEN`-Verbindung kam wieder, Meldungen dazwischen sind verloren: alle Verbindungen neu prüfen. */
    recheckAll(): void {
        for (const client of this.clients) void this.recheck(client);
    }

    private async recheck(client: Client): Promise<void> {
        if (client.recheck === undefined || client.checking || client.connection.closed) return;
        client.checking = true;
        client.checkedAtMs = this.now();
        let unchanged: boolean;
        try {
            unchanged = await client.recheck();
        } catch (error) {
            // Ohne Datenbank lässt sich nichts entscheiden: die Verbindung bleibt, der nächste Takt fragt wieder.
            this.options.log?.warn({ err: error }, "ws: Einlass nicht neu prüfbar");
            unchanged = true;
        } finally {
            client.checking = false;
        }
        if (!unchanged) client.connection.close(WS_CLOSE.rightsChanged, "rights_changed");
    }

    /** Beim Beenden des Servers: `1001 going away` an alle, damit sie mit Backoff und Jitter neu verbinden. */
    closeAll(code: number = WS_CLOSE.goingAway, reason = "going away"): void {
        for (const client of [...this.clients]) client.connection.close(code, reason);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
