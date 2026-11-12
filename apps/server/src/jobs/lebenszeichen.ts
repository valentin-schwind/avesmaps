import type { Database, Queryable } from "../database.ts";

/**
 * Das Lebenszeichen des Jobs-Workers für den Systemzustand (WI-0127 §22, Koordination 2026-10-11). Der Worker ist ein eigener Prozess,
 * Fastify kann seinen Speicher nicht messen. Er meldet sich darum alle `heartbeatS` Sekunden per `NOTIFY` auf `JOB_WORKER_BEAT_CHANNEL`
 * mit seinem RSS und den rechnenden Kindprozessen, und Fastify hört mit (`WorkerLebenszeichen`). Keine Tafel, keine Migration: Der Wert
 * ist flüchtig wie die Messung selbst, und `pg_notify` braucht kein Recht.
 *
 * 🔴 Bleibt das Lebenszeichen länger als drei Takte aus, ist der Wert unbekannt, nie der alte. Ob der Worker plant, sagt weiter die
 * Planersperre (`isPlannerActive`), nicht das Lebenszeichen.
 */
export const JOB_WORKER_BEAT_CHANNEL = "avesmaps3d_job_worker_beat";

export interface WorkerBeat {
    instanz: string;
    planer: boolean;
    release: string | null;
    /** Wann der Worker gemessen hat (ISO). */
    gemessen: string;
    /** Sein Takt in Millisekunden; danach richtet sich, wann das Lebenszeichen als ausgeblieben gilt. */
    taktMs: number;
    rss: number;
    kinder: { anzahl: number; rss: number };
}

/** Ab so vielen ausgebliebenen Takten gilt der Wert als unbekannt; mindestens 30 s. */
const AUSGEBLIEBEN_TAKTE = 3;
const AUSGEBLIEBEN_MIN_MS = 30_000;
/** Ein Lebenszeichen, das so lange nicht kam, wird vergessen (eine beendete Instanz). */
const VERGESSEN_MS = 10 * 60_000;
/** Hört Fastify so lange nichts, abonniert es neu: Ein `LISTEN` kann still verloren gehen (`auth/change-watch.ts`). */
const NEU_ABONNIEREN_MS = 60_000;

export async function sendeLebenszeichen(database: Queryable, beat: WorkerBeat): Promise<void> {
    await database`SELECT pg_notify(${JOB_WORKER_BEAT_CHANNEL}, ${JSON.stringify(beat)})`;
}

const zahl = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Liest ein Lebenszeichen; was nicht passt, ist `undefined` (eine fremde oder verstümmelte Meldung bleibt folgenlos). */
export function leseLebenszeichen(payload: string): WorkerBeat | undefined {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        return undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    const v = value as Record<string, unknown>;
    const kinder = v["kinder"] as Record<string, unknown> | undefined;
    if (
        typeof v["instanz"] !== "string" ||
        typeof v["planer"] !== "boolean" ||
        (v["release"] !== null && typeof v["release"] !== "string") ||
        typeof v["gemessen"] !== "string" ||
        !Number.isFinite(Date.parse(v["gemessen"])) ||
        !zahl(v["taktMs"]) ||
        !zahl(v["rss"]) ||
        typeof kinder !== "object" ||
        kinder === null ||
        !zahl(kinder["anzahl"]) ||
        !zahl(kinder["rss"])
    )
        return undefined;
    return {
        instanz: v["instanz"],
        planer: v["planer"],
        release: v["release"],
        gemessen: v["gemessen"],
        taktMs: v["taktMs"],
        rss: Math.round(v["rss"]),
        kinder: { anzahl: Math.round(kinder["anzahl"]), rss: Math.round(kinder["rss"]) },
    };
}

export interface WorkerLebenszeichenOptions {
    database: Database;
    now?: () => number;
    warn?: (fields: Record<string, unknown>, message: string) => void;
}

/** Die Seite von Fastify: hört auf das Lebenszeichen und hält das letzte je Instanz. */
export class WorkerLebenszeichen {
    readonly #database: Database;
    readonly #now: () => number;
    readonly #warn: WorkerLebenszeichenOptions["warn"];
    readonly #letzte = new Map<string, { beat: WorkerBeat; empfangenMs: number }>();
    #unlisten: (() => Promise<void>) | undefined;
    #abonniertMs = 0;
    #closed = false;

    constructor(options: WorkerLebenszeichenOptions) {
        this.#database = options.database;
        this.#now = options.now ?? (() => Date.now());
        this.#warn = options.warn;
    }

    async start(): Promise<void> {
        if (this.#unlisten !== undefined || this.#closed) return;
        try {
            const subscription = await this.#database.listen(JOB_WORKER_BEAT_CHANNEL, (payload) =>
                this.empfange(payload),
            );
            if (this.#closed) {
                await subscription.unlisten();
                return;
            }
            this.#unlisten = () => subscription.unlisten();
            this.#abonniertMs = this.#now();
        } catch (error) {
            this.#warn?.({ err: error }, "jobs: LISTEN auf das Lebenszeichen des Workers nicht möglich");
        }
    }

    empfange(payload: string): void {
        const beat = leseLebenszeichen(payload);
        if (beat === undefined) return;
        const now = this.#now();
        this.#letzte.set(beat.instanz, { beat, empfangenMs: now });
        for (const [instanz, eintrag] of this.#letzte) {
            if (now - eintrag.empfangenMs > VERGESSEN_MS) this.#letzte.delete(instanz);
        }
    }

    /** Das frischeste Lebenszeichen, das des Planers zuerst; `undefined`, wenn keines in den letzten drei Takten kam. */
    aktuell(): WorkerBeat | undefined {
        const now = this.#now();
        const frisch = [...this.#letzte.values()]
            .filter(
                (eintrag) =>
                    now - eintrag.empfangenMs <=
                    Math.max(AUSGEBLIEBEN_MIN_MS, AUSGEBLIEBEN_TAKTE * eintrag.beat.taktMs),
            )
            .sort((a, b) => Number(b.beat.planer) - Number(a.beat.planer) || b.empfangenMs - a.empfangenMs);
        if (frisch.length === 0) this.#vielleichtNeuAbonnieren(now);
        return frisch[0]?.beat;
    }

    #vielleichtNeuAbonnieren(now: number): void {
        if (this.#closed || now - this.#abonniertMs < NEU_ABONNIEREN_MS) return;
        const unlisten = this.#unlisten;
        this.#unlisten = undefined;
        this.#abonniertMs = now;
        void (async () => {
            await unlisten?.().catch(() => undefined);
            await this.start();
        })();
    }

    async close(): Promise<void> {
        this.#closed = true;
        const unlisten = this.#unlisten;
        this.#unlisten = undefined;
        await unlisten?.().catch(() => undefined);
    }
}
