import { randomBytes } from "node:crypto";
import type { Database } from "../database.ts";

/** Der Kanal aus Migration 0081: Jede Änderung, die eine Sitzung beendet oder Rechte ändert, meldet hier die Person. */
export const AUTH_CHANGE_CHANNEL = "avesmaps_auth_changed";
/** Takt der Probe, ob das Abonnement noch hört (wie der Takt des Betriebszustands, `system/state-store.ts`). */
export const AUTH_WATCH_TICK_MS = 5_000;

export interface ChangeWatchLogger {
    warn(fields: Record<string, unknown>, message: string): void;
    info?(fields: Record<string, unknown>, message: string): void;
}

export interface ChangeWatchOptions {
    /** Für Tests: ein kurzer Takt. */
    tickMs?: number;
}

const PERSON_ID = /^[0-9a-f-]{36}$/u;

/**
 * Hört auf Entzüge (WI-0120 A11, AUTH-0001 §8): `onChange` bekommt die Kennung der Person, deren Sitzung oder Rechte sich gerade
 * geändert haben. Eine eigene `LISTEN`-Verbindung je Instanz, wie der Kanal der Queue (`realtime/hub.ts`). Nutzer sind der Speicher
 * der Tür (`auth/gate.ts`) und der Einlass von `/ws` (`routes/realtime.ts`).
 *
 * 🔴 Nach jedem Wiederverbinden (Neustart von PostgreSQL, Netzfehler) sind die Meldungen dazwischen verloren: `onResync` prüft dann
 * alles neu, nicht erst im Takt (Claudio 2026-10-09, Punkt 9). postgres.js ruft `onlisten` beim ersten `LISTEN` und nach jedem
 * Wiederverbinden; der erste Aufruf ist kein Verlust.
 *
 * 🔴 **Taub heißt: jeder Takt gilt als Wiederverbinden** (WI-0127 SYS-3, Befund aus SYS-2 §9.5). Gemessen am 2026-10-10 (postgres.js
 * 3.4.9, `auth-change-watch.test.ts`): Nach einem Ausfall baut postgres.js `LISTEN` selbst neu auf (auch nach Abweisen, Hängen und
 * `FATAL 57P03` beim Hochfahren) und ruft dann `onlisten`; seit die Pause vor jedem Versuch auf 1 s gedeckelt ist (`reconnectBackoff`,
 * `62951ae9`), binnen 1 s nach der Rückkehr. Für immer verloren wäre das Abonnement nur, wenn ein Neuaufbau scheitert, ohne dass die
 * Verbindung danach noch einmal schließt (`listen(…).catch(() => {})` in postgres.js); nachgestellt hat sich das nicht, ausgeschlossen
 * ist es nicht, und ein Pooler kann `LISTEN` ebenso still verlieren. Selbst neu abonnieren (abmelden, `listen` erneut) braucht es
 * deshalb nicht, und es griffe in den Neuaufbau von postgres.js ein. Stattdessen schickt der Wächter im Takt eine Probe (`pg_notify` mit eigener Kennung) auf seinen Kanal: Nimmt die Datenbank sie an,
 * und sie kommt bis zum nächsten Takt nicht zurück, ist er **taub** und ruft in jedem Takt `onResync`, bis eine Probe wieder ankommt.
 * Die Tür vergisst dann alle 5 s statt alle 30 s, `/ws` prüft alle Verbindungen neu: Ein Entzug wirkt auch ohne `LISTEN` binnen eines
 * Takts. Eine Probe, die die Datenbank nicht annimmt (sie ist weg), sagt nichts über das Abonnement. Ein Abonnement, das beim Start nie
 * zustande kam, versucht jeder Takt erneut.
 *
 * Gibt die Abmeldung zurück; ohne `LISTEN` (etwa ein Pooler im Transaktionsmodus) bleibt nur der Takt, und das ist keine Panne.
 */
export async function watchAuthChanges(
    database: Database,
    onChange: (personId: string) => void,
    log?: ChangeWatchLogger,
    onResync?: () => void,
    options: ChangeWatchOptions = {},
): Promise<() => Promise<void>> {
    const watch = new AuthChangeWatch(database, onChange, log, onResync, options.tickMs ?? AUTH_WATCH_TICK_MS);
    await watch.start();
    return () => watch.close();
}

class AuthChangeWatch {
    readonly #database: Database;
    readonly #onChange: (personId: string) => void;
    readonly #log: ChangeWatchLogger | undefined;
    readonly #onResync: (() => void) | undefined;
    readonly #tickMs: number;
    /** Die Kennung dieser Probe: Proben anderer Wächter (und Instanzen) auf demselben Kanal zählen nicht. */
    readonly #probeId = `probe:${randomBytes(9).toString("base64url")}`;
    #probeSeq = 0;
    /** Die angenommene Probe, die noch nicht zurück ist. */
    #pending: string | undefined;
    /** Eine angenommene Probe kam nicht zurück: Bis wieder eine ankommt, gilt jeder Takt als Wiederverbinden. */
    #deaf = false;
    #generation = 0;
    #unlisten: (() => Promise<void>) | undefined;
    #subscribing: Promise<void> | undefined;
    #warned = false;
    #timer: NodeJS.Timeout | undefined;
    /** Ein Takt zur Zeit: Hängt die Probe (Netz weg), überholt der nächste Takt sie nicht. */
    #ticking = false;
    #closed = false;

    constructor(
        database: Database,
        onChange: (personId: string) => void,
        log: ChangeWatchLogger | undefined,
        onResync: (() => void) | undefined,
        tickMs: number,
    ) {
        this.#database = database;
        this.#onChange = onChange;
        this.#log = log;
        this.#onResync = onResync;
        this.#tickMs = tickMs;
    }

    async start(): Promise<void> {
        this.#timer = setInterval(() => {
            if (this.#ticking) return;
            this.#ticking = true;
            void this.#tick().finally(() => {
                this.#ticking = false;
            });
        }, this.#tickMs);
        this.#timer.unref();
        await this.#subscribe(false);
    }

    async close(): Promise<void> {
        this.#closed = true;
        clearInterval(this.#timer);
        const unlisten = this.#unlisten;
        this.#unlisten = undefined;
        await unlisten?.().catch(() => undefined);
    }

    async #tick(): Promise<void> {
        if (this.#closed) return;
        if (this.#unlisten === undefined) {
            await this.#subscribe(true);
            return;
        }
        // Die Datenbank nahm die vorige Probe an, aber sie kam nicht zurück: taub. Meldungen können verloren sein, also neu prüfen.
        if (this.#pending !== undefined) {
            if (!this.#deaf) this.#log?.warn({}, "auth: LISTEN hört nicht, bis es zurück ist, prüft jeder Takt neu");
            this.#deaf = true;
            this.#onResync?.();
        }
        // Vor dem Senden erwarten: Die Probe kann über `LISTEN` zurück sein, bevor `pg_notify` antwortet.
        const probe = `${this.#probeId}:${String((this.#probeSeq += 1))}`;
        this.#pending = probe;
        try {
            await this.#database`SELECT pg_notify(${AUTH_CHANGE_CHANNEL}, ${probe})`;
        } catch {
            // Die Datenbank ist weg: Das sagt nichts über das Abonnement, postgres.js baut es selbst neu auf.
            if (this.#pending === probe) this.#pending = undefined;
        }
    }

    #receive(payload: string): void {
        if (PERSON_ID.test(payload)) {
            this.#onChange(payload);
            return;
        }
        if (payload !== this.#pending) return;
        this.#pending = undefined;
        if (!this.#deaf) return;
        this.#deaf = false;
        this.#log?.info?.({}, "auth: LISTEN hört wieder");
    }

    /** Höchstens ein Versuch zur Zeit; scheitert er, versucht es der nächste Takt. `resync`: Meldungen davor können verloren sein. */
    async #subscribe(resync: boolean): Promise<void> {
        if (this.#unlisten !== undefined || this.#closed) return;
        this.#subscribing ??= this.#listenOnce(resync).finally(() => {
            this.#subscribing = undefined;
        });
        await this.#subscribing;
    }

    async #listenOnce(resync: boolean): Promise<void> {
        // Ein Versuch, der scheiterte, kann von postgres.js später doch noch bedient werden; seine Meldungen zählen dann nicht doppelt.
        const generation = (this.#generation += 1);
        const current = (): boolean => generation === this.#generation && !this.#closed;
        let first = true;
        try {
            const subscription = await this.#database.listen(
                AUTH_CHANGE_CHANNEL,
                (payload) => {
                    if (current()) this.#receive(payload);
                },
                () => {
                    if (!current()) return;
                    if (!first) {
                        // postgres.js hat selbst neu gehört: Eine Probe von davor kann verloren sein, ohne dass etwas fehlt.
                        this.#pending = undefined;
                        this.#onResync?.();
                    }
                    first = false;
                },
            );
            if (this.#closed) {
                await subscription.unlisten();
                return;
            }
            this.#unlisten = () => subscription.unlisten();
            this.#warned = false;
            if (resync) this.#onResync?.();
        } catch (error) {
            if (this.#warned) return;
            this.#warned = true;
            this.#log?.warn({ err: error }, "auth: LISTEN nicht möglich, der Takt versucht es wieder");
        }
    }
}
