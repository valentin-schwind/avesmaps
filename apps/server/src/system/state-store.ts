import type { SystemEffectiveState, SystemLock, SystemMode, SystemStateSource } from "@avesmaps3d/shared";
import { GATE_OPEN_MS } from "../auth/gate.ts";
import type { Database } from "../database.ts";
import { isMissingTable, readStateRow, type SystemSetter, type SystemStateRow } from "./state-row.ts";

/**
 * Der Betriebszustand im Speicher jeder Instanz (WI-0127 SYS-2, SYS-0001 §3.2; Claudio 2026-10-09 Punkt 4).
 *
 * Gelesen wird die eine Zeile `system_state`: beim Start, auf jede Meldung des Kanals `avesmaps_system_changed` (Migration 0087), nach
 * jedem Wiederverbinden von `LISTEN` und zusätzlich alle 5 s im Takt. Das Lesen im Takt ist zugleich der Pool-Ping der Bereitschaft
 * (§4.3) und gleicht ein verpasstes `NOTIFY` nach Sekunden aus. Der Kanal ist nur ein Weckruf; die Wahrheit ist die gelesene Zeile.
 *
 * 🔴 Fehlerrichtung (fail-closed): Scheitert das Lesen (Datenbank weg, Recht fehlt, Zeile fehlt) oder ist der letzte erfolgreiche Stand
 * älter als 30 s (`GATE_OPEN_MS`, dieselbe Grenze wie das gemerkte Urteil der Tür, kein eigener Wert), ist die Quelle `unknown`:
 * Stellung und Sperren sind dann `null`, nie Normal, und kein Schreibweg läuft. Fehlt nur die TABELLE (Fastify startet im Korridor
 * vor `migrate`), gilt `unprovisioned`: Normal wie vor SYS-2, mit einer WARN-Zeile.
 *
 * 🪤 postgres.js baut `LISTEN` nach einem Verbindungsverlust selbst neu auf und ruft dann `onlisten`; die Pause vor jedem Versuch ist
 * seit `62951ae9` auf 1 s gedeckelt (`reconnectBackoff` in `database.ts`). Gemessen in SYS-3 (WI-0127 §12.8): Nachgestellte Ausfälle
 * verwarf es nie für immer, mit dem Deckel hörte es in 32 von 32 Läufen binnen 1 s nach der Rückkehr wieder. Der Speicher hört
 * zusätzlich neu, sobald das Lesen nach einem Ausfall wieder gelingt (mit und ohne das gleich wirksam gemessen), und versucht es im
 * Takt, solange es kein Abonnement gibt. Geht ein Abonnement verloren, während das Lesen weiter gelingt
 * (nur die `LISTEN`-Verbindung bricht, und ihr Neuaufbau scheitert), merkt das niemand; dann gleicht der Takt aus: höchstens 5 s
 * statt 1 s bis zur Wirkung, nie ein falscher Zustand.
 */

export const SYSTEM_CHANNEL = "avesmaps_system_changed";
/** Takt des Lesens und Pool-Pings. */
export const SYSTEM_TICK_MS = 5_000;
/** Älter darf der letzte erfolgreiche Stand nie sein. */
export const SYSTEM_STALE_MS = GATE_OPEN_MS;
/** Bereit heißt: Der letzte Ping liegt höchstens zwei Takte zurück und gelang (ein Takt allein flackerte an seiner Grenze). */
export const SYSTEM_READY_MS = 2 * SYSTEM_TICK_MS;

export interface SystemStateLog {
    warn(fields: Record<string, unknown>, message: string): void;
    info(fields: Record<string, unknown>, message: string): void;
}

export interface SystemStateStoreOptions {
    database: Database;
    log?: SystemStateLog | undefined;
    /** Für Tests: eigene Uhr und eigene Takte. */
    now?: () => number;
    tickMs?: number;
    staleMs?: number;
    readyMs?: number;
}

export interface ListenState {
    /** Ein Abonnement steht, und die Datenbank antwortet. */
    connected: boolean;
    /** Wie oft `LISTEN` (neu) aufgebaut wurde. */
    generation: number;
    lastResyncAt: Date | null;
}

export interface SystemStateSnapshot {
    source: SystemStateSource;
    mode: SystemMode | null;
    mapLock: boolean | null;
    systemLock: boolean | null;
    revision: number | null;
    contentRevision: number | null;
    readAt: Date | null;
    ready: boolean;
    listen: ListenState;
}

type Known = { source: "database"; row: SystemStateRow } | { source: "unprovisioned" };

/** Wer nach einem Wechsel des wirksamen Zustands fragt (`/ws` prüft dann seine Verbindungen neu, SYS-0001 §4.4). */
export type SystemStateListener = (previous: SystemStateSnapshot, next: SystemStateSnapshot) => void;

/** Was als Wechsel zählt: Quelle, Stellung, Sperren, Revision; nicht das Alter des Stands. */
function stateKey(snapshot: SystemStateSnapshot): string {
    const { source, mode, mapLock, systemLock, revision } = snapshot;
    return JSON.stringify([source, mode, mapLock, systemLock, revision]);
}

function codeOf(error: unknown): string | undefined {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
}

export class SystemStateStore {
    readonly #database: Database;
    readonly #log: SystemStateLog | undefined;
    readonly #now: () => number;
    readonly #tickMs: number;
    readonly #staleMs: number;
    readonly #readyMs: number;
    #known: Known | undefined;
    #readAt: number | null = null;
    #failed = false;
    #timer: NodeJS.Timeout | undefined;
    /** Das laufende Lesen und das EINE, das ihm folgt; alle, die währenddessen fragen, teilen es. */
    #current: Promise<void> | undefined;
    #queued: Promise<void> | undefined;
    /** Folgenummer je Lesen: Ein älteres Ergebnis überschreibt nie ein jüngeres. */
    #readSeq = 0;
    #appliedSeq = 0;
    #unlisten: (() => Promise<void>) | undefined;
    #subscribing: Promise<void> | undefined;
    #generation = 0;
    #lastResyncAt: number | null = null;
    #closed = false;
    #lastSource: SystemStateSource = "unknown";
    readonly #listeners = new Set<SystemStateListener>();
    /** Der Stand, den die Hörer zuletzt kennen; `undefined` bis zum ersten Lesen (das erste Lesen ist kein Wechsel). */
    #emitted: SystemStateSnapshot | undefined;

    constructor(options: SystemStateStoreOptions) {
        this.#database = options.database;
        this.#log = options.log;
        this.#now = options.now ?? Date.now;
        this.#tickMs = options.tickMs ?? SYSTEM_TICK_MS;
        this.#staleMs = options.staleMs ?? SYSTEM_STALE_MS;
        this.#readyMs = options.readyMs ?? SYSTEM_READY_MS;
    }

    /** Erst hören, dann lesen, dann im Takt lesen. Wirft nie; ohne Datenbank bleibt der Zustand `unknown`. */
    async start(): Promise<void> {
        if (this.#timer !== undefined || this.#closed) return;
        this.#timer = setInterval(() => void this.#tick(), this.#tickMs);
        this.#timer.unref();
        await this.#subscribe();
        await this.refresh();
    }

    /**
     * Liest die Zeile neu. Läuft schon ein Lesen, folgt ihm genau eins: Wer nach seiner eigenen Änderung fragt, bekommt nie den Stand
     * von davor, und wer während eines langsamen Lesens fragt (Takt, Meldungen), reiht kein zweites und drittes dahinter. Höchstens
     * zwei Lesen bis zur Antwort, nie eine Schleife. Wirft nie.
     */
    async refresh(): Promise<SystemStateSnapshot> {
        await this.#schedule();
        return this.snapshot();
    }

    snapshot(): SystemStateSnapshot {
        const now = this.#now();
        const listen: ListenState = {
            connected: this.#unlisten !== undefined && !this.#failed,
            generation: this.#generation,
            lastResyncAt: this.#lastResyncAt === null ? null : new Date(this.#lastResyncAt),
        };
        const readAt = this.#readAt === null ? null : new Date(this.#readAt);
        const fresh = this.#readAt !== null && now - this.#readAt <= this.#staleMs;
        const known = !this.#failed && fresh ? this.#known : undefined;
        if (known === undefined) {
            return {
                source: "unknown",
                mode: null,
                mapLock: null,
                systemLock: null,
                revision: null,
                contentRevision: null,
                readAt,
                ready: false,
                listen,
            };
        }
        const ready = now - (this.#readAt ?? 0) <= this.#readyMs;
        if (known.source === "unprovisioned") {
            return {
                source: "unprovisioned",
                mode: "normal",
                mapLock: false,
                systemLock: false,
                revision: null,
                contentRevision: null,
                readAt,
                ready,
                listen,
            };
        }
        const { row } = known;
        return {
            source: "database",
            mode: row.mode,
            mapLock: row.mapLock,
            systemLock: row.systemLock,
            revision: row.revision,
            contentRevision: row.contentRevision,
            readAt,
            ready,
            listen,
        };
    }

    /**
     * Wer die Sperre wann und warum gesetzt hat, aus dem zuletzt gelesenen Stand (für 423 `map_locked`/`system_locked`, SYS-4);
     * `undefined`, solange die Zeile nicht frisch gelesen ist.
     */
    lockSetter(lock: SystemLock): SystemSetter | undefined {
        if (this.snapshot().source !== "database" || this.#known?.source !== "database") return undefined;
        return lock === "map" ? this.#known.row.mapLockSetter : this.#known.row.systemLockSetter;
    }

    /**
     * Meldet jeden Wechsel des wirksamen Zustands (Quelle, Stellung, Sperren, Revision) nach einem Lesen, auch den nach `unknown`; gibt
     * die Abmeldung zurück. `/ws` prüft daraufhin seine offenen Verbindungen neu (SYS-0001 §4.4).
     */
    onChange(listener: SystemStateListener): () => void {
        this.#listeners.add(listener);
        return () => void this.#listeners.delete(listener);
    }

    /**
     * Hört auf zu lesen und zu hören. Auf das Abmelden des Kanals wartet es nicht: Bei toter Datenbank hinge das Schließen sonst bis zur
     * Zeitgrenze der Verbindung; die Verbindung selbst schließt danach `database.end()` (`app.ts`).
     */
    async close(): Promise<void> {
        this.#closed = true;
        clearInterval(this.#timer);
        const unlisten = this.#unlisten;
        this.#unlisten = undefined;
        void unlisten?.().catch(() => undefined);
    }

    async #tick(): Promise<void> {
        if (this.#closed) return;
        if (this.#unlisten === undefined) void this.#subscribe();
        await this.refresh();
    }

    #schedule(): Promise<void> {
        if (this.#current === undefined) return this.#begin();
        this.#queued ??= this.#current.then(() => {
            this.#queued = undefined;
            return this.#begin();
        });
        return this.#queued;
    }

    #begin(): Promise<void> {
        const reading: Promise<void> = this.#read().finally(() => {
            if (this.#current === reading) this.#current = undefined;
        });
        this.#current = reading;
        return reading;
    }

    async #read(): Promise<void> {
        if (this.#closed) return;
        const seq = ++this.#readSeq;
        let recovered = false;
        try {
            const row = await readStateRow(this.#database);
            if (this.#closed || seq < this.#appliedSeq) return;
            this.#appliedSeq = seq;
            if (row === undefined) {
                this.#failed = true;
                this.#report("row_missing");
                return;
            }
            recovered = this.#failed;
            this.#known = { source: "database", row };
            this.#readAt = this.#now();
            this.#failed = false;
        } catch (error) {
            if (this.#closed || seq < this.#appliedSeq) return;
            this.#appliedSeq = seq;
            if (isMissingTable(error)) {
                this.#known = { source: "unprovisioned" };
                this.#readAt = this.#now();
                this.#failed = false;
            } else {
                this.#failed = true;
                this.#report(codeOf(error));
                return;
            }
        }
        this.#report(undefined);
        // Nach einem Ausfall kann das Abonnement still verloren sein (siehe oben): neu hören.
        if (recovered) void this.#resubscribe();
    }

    /** Eine Zeile je Wechsel der Quelle, nie eine je Takt. */
    #report(code: string | undefined): void {
        this.#emit();
        const source = this.snapshot().source;
        if (source === this.#lastSource) return;
        this.#lastSource = source;
        if (source === "unknown") {
            this.#log?.warn({ code }, "system: Betriebszustand unbekannt, Schreibwege antworten 503");
        } else if (source === "unprovisioned") {
            this.#log?.warn({}, "system: Tabelle system_state fehlt (vor migrate), es gilt Normal");
        } else {
            this.#log?.info(
                { revision: this.#known?.source === "database" ? this.#known.row.revision : null },
                "system: Betriebszustand gelesen",
            );
        }
    }

    /** Ruft die Hörer, wenn sich der wirksame Zustand seit dem letzten Lesen geändert hat. Ein scheiternder Hörer hält niemanden auf. */
    #emit(): void {
        const next = this.snapshot();
        const previous = this.#emitted;
        this.#emitted = next;
        if (previous === undefined || stateKey(previous) === stateKey(next)) return;
        for (const listener of this.#listeners) {
            try {
                listener(previous, next);
            } catch (error) {
                this.#log?.warn({ err: error }, "system: Hörer des Betriebszustands gescheitert");
            }
        }
    }

    /** Höchstens ein Versuch zur Zeit; scheitert er, versucht es der nächste Takt. */
    async #subscribe(): Promise<void> {
        if (this.#unlisten !== undefined || this.#closed) return;
        this.#subscribing ??= this.#listenOnce().finally(() => {
            this.#subscribing = undefined;
        });
        await this.#subscribing;
    }

    async #listenOnce(): Promise<void> {
        try {
            const subscription = await this.#database.listen(
                SYSTEM_CHANNEL,
                () => void this.refresh(),
                () => this.#onListen(),
            );
            if (this.#closed) {
                await subscription.unlisten();
                return;
            }
            this.#unlisten = () => subscription.unlisten();
        } catch (error) {
            this.#log?.warn({ code: codeOf(error) }, "system: LISTEN nicht möglich, der Takt liest weiter");
        }
    }

    /** postgres.js ruft das beim ersten `LISTEN` und nach jedem Wiederverbinden; danach sind Meldungen verloren: neu lesen. */
    #onListen(): void {
        this.#generation += 1;
        this.#lastResyncAt = this.#now();
        if (this.#generation > 1) void this.refresh();
    }

    async #resubscribe(): Promise<void> {
        const unlisten = this.#unlisten;
        this.#unlisten = undefined;
        await unlisten?.().catch(() => undefined);
        await this.#subscribe();
    }
}

/** Die Antwortform (Zeitpunkte als ISO-Zeichenkette). */
export function effectiveView(snapshot: SystemStateSnapshot): SystemEffectiveState {
    return {
        source: snapshot.source,
        mode: snapshot.mode,
        mapLock: snapshot.mapLock,
        systemLock: snapshot.systemLock,
        revision: snapshot.revision,
        contentRevision: snapshot.contentRevision,
        readAt: snapshot.readAt?.toISOString() ?? null,
        ready: snapshot.ready,
    };
}
