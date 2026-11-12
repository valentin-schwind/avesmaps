import { JOB_NOTIFY_CHANNEL, type JobEventRecord } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { latestSeq, readEvents } from "../jobs/store.ts";

/**
 * Die Verteilung der Ereignisse der Queue an die Fastify-Instanz (JOBS-0001 4.9): `LISTEN/NOTIFY` zwischen den Instanzen, dazu ein
 * Abfragetakt als Rückfall. Jede Instanz hält EINE eigene `LISTEN`-Verbindung (die Pools schließen ruhende nach 30 s, siehe
 * `derive-lock.ts`; sie gehört zum Verbindungsbudget der Instanz).
 *
 * 🔴 `NOTIFY` ist nicht dauerhaft und trägt nur die Nummer `seq`: das Ereignis wird aus `job_event` gelesen, ab der letzten
 * bekannten Nummer. Ein verpasstes Ereignis kostet nur Aktualität, nie Richtigkeit: Die Wahrheit liefert HTTP (`/api/jobs/overview`),
 * und die Nummern kommen in der Reihenfolge ihres Festschreibens (Migration 0070, `job_event_add`).
 *
 * Fastify liest nur; geschrieben wird nur durch Worker und Aufzeichnung.
 */

export interface HubLogger {
    warn(fields: Record<string, unknown>, message: string): void;
}

export interface JobEventHubOptions {
    /** Rückfall: so oft wird auch ohne `NOTIFY` nachgesehen (ms). */
    pollMs?: number;
    log?: HubLogger;
}

type Listener = (event: JobEventRecord) => void;

export class JobEventHub {
    private readonly database: Database;
    private readonly pollMs: number;
    private readonly log: HubLogger | undefined;
    private readonly listeners = new Set<Listener>();
    private lastSeq = 0;
    private starting: Promise<void> | undefined;
    private poller: ReturnType<typeof setInterval> | undefined;
    private unlisten: (() => Promise<void>) | undefined;
    private fetching = false;
    private again = false;
    private closed = false;

    constructor(database: Database, options: JobEventHubOptions = {}) {
        this.database = database;
        this.pollMs = options.pollMs ?? 5000;
        this.log = options.log;
    }

    /** Die Nummer des letzten Ereignisses, das dieser Hub kennt. */
    get seq(): number {
        return this.lastSeq;
    }

    /** Startet beim ersten Abonnenten: bis dahin kostet der Hub nichts (keine Verbindung). */
    ensureStarted(): Promise<void> {
        if (this.closed) return Promise.resolve();
        this.starting ??= this.start();
        return this.starting;
    }

    private async start(): Promise<void> {
        try {
            this.lastSeq = await latestSeq(this.database);
        } catch (error) {
            this.log?.warn({ err: error }, "jobs: Stand der Ereignisse nicht lesbar, der Takt versucht es erneut");
        }
        try {
            const subscription = await this.database.listen(JOB_NOTIFY_CHANNEL, () => void this.fetch());
            this.unlisten = () => subscription.unlisten();
        } catch (error) {
            this.log?.warn({ err: error }, "jobs: LISTEN nicht möglich, der Abfragetakt genügt");
        }
        this.poller = setInterval(() => void this.fetch(), this.pollMs);
        this.poller.unref();
    }

    /** Liest alles ab der letzten Nummer und gibt es weiter. Zwei Aufrufe gleichzeitig werden zu einem Nachlesen. */
    async fetch(): Promise<void> {
        if (this.closed) return;
        if (this.fetching) {
            this.again = true;
            return;
        }
        this.fetching = true;
        try {
            do {
                this.again = false;
                for (;;) {
                    const events = await readEvents(this.database, this.lastSeq, 500);
                    if (events.length === 0) break;
                    for (const event of events) {
                        this.lastSeq = Math.max(this.lastSeq, event.seq);
                        for (const listener of this.listeners) {
                            try {
                                listener(event);
                            } catch {
                                // Ein Abonnent, der wirft, hält die anderen nicht auf.
                            }
                        }
                    }
                    if (events.length < 500) break;
                }
            } while (this.again);
        } catch (error) {
            this.log?.warn({ err: error }, "jobs: Ereignisse nicht lesbar");
        } finally {
            this.fetching = false;
        }
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        void this.ensureStarted();
        return () => {
            this.listeners.delete(listener);
        };
    }

    async close(): Promise<void> {
        this.closed = true;
        if (this.poller) clearInterval(this.poller);
        this.poller = undefined;
        this.listeners.clear();
        try {
            await this.unlisten?.();
        } catch {
            // schon geschlossen
        }
        this.unlisten = undefined;
    }
}
