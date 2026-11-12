import type { GateProfile } from "../config.ts";
import { isNotProvisioned, type Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { holdsRestrictedAccess, modeKnown } from "../system/restricted-access.ts";
import type { SystemStateStore } from "../system/state-store.ts";
import { watchAuthChanges, type ChangeWatchLogger, type ChangeWatchOptions } from "./change-watch.ts";
import { sessionCookieName, type AuthConfig } from "./config.ts";
import { parseCookies } from "./cookies.ts";
import { AUTH_NOT_READY } from "./plugin.ts";
import { loadSession, type SessionRecord } from "./session-store.ts";
import { isWellFormedToken, tokenHash } from "./tokens.ts";

/**
 * Die Tür (WI-0120 R6, AUTH-0001 §4.5; WI-0127 SYS-3, SYS-0001 §4.3): Nginx fragt per `auth_request` für JEDE Anfrage
 * `GET /api/auth/gate`, auch für jede Kachel. Die Antwort folgt aus Bereitschaft, Profil (`AUTH_GATE`), Betriebszustand und Sitzung
 * (Claudio 2026-10-10, Matrix bestätigt: 204 durch, 401 → 302 `/anmelden` nur für HTML, 403 → Wartungsseite, alles andere → Störung):
 *
 * | Profil              | Stellung      | ohne Sitzung | Sitzung ohne Zugangsrecht | mit `access_restricted_mode` und 2. Faktor | nicht bereit |
 * |---------------------|---------------|--------------|---------------------------|--------------------------------------------|--------------|
 * | `members` (Stage)   | Normal        | 401          | 204                       | 204                                        | 503          |
 * | `members`           | Eingeschränkt | 401          | 403                       | 204                                        | 503          |
 * | `public` (Prod.)    | Normal        | 204          | 204                       | 204                                        | 503          |
 * | `public`            | Eingeschränkt | 403          | 403                       | 204                                        | 503          |
 *
 * Im Profil `public` bei Normalbetrieb liest die Tür kein Cookie und fragt keine Datenbank: eine Speicherabfrage je Türfrage.
 *
 * - **Bereit** heißt, was der Betriebszustand im Speicher sagt (`SystemStateStore`, SYS-0001 §3.2): Das Lesen der einen Zeile im Takt
 *   von 5 s ist zugleich der Pool-Ping, gelungen höchstens zwei Takte zuvor, und der Zustand ist bekannt. 🔴 Die Tür fragt dafür nie
 *   die Datenbank; die Bereitschaft umgeht den Speicher der Sitzungen nicht, sie steht vor ihm.
 * - **Unbekannter Zustand** gilt wie eingeschränkt (fail-closed). Heute ist ein unbekannter Zustand immer auch „nicht bereit“ (der
 *   Speicher hält sich ohne gelesenen Zustand nie für bereit), die Tür antwortet dann also 503; die Regel steht trotzdem hier, damit
 *   ein bereiter, aber unbekannter Zustand nie wie Normal durchgeht.
 * - **Im eingeschränkten Betrieb** zählt Recht und zweiter Faktor (`holdsRestrictedAccess`), nicht die 60-Minuten-Frische von Stufe V.
 * - **`?nur=bereitschaft`** (`readiness`): nur die Bereitschaft, ohne Sitzung und Stellung; für die freien Einstiegsseiten auf
 *   Production (`/_bereitschaft` im vhost, Claudio), damit auch sie bei toter Datenbank die Störungsseite zeigen.
 *
 * Damit nicht jede Kachel eine Datenbankfrage auslöst (Claudio 2026-10-09, Punkt 6), merkt sich die Tür je Token, ob die Sitzung gilt
 * und ob sie das Zugangsrecht trägt, und nur sie: Alle übrigen Routen lesen Sitzung und Rechte weiter bei jeder Anfrage (AUTH-0001
 * §6.1); der eingeschränkte Betrieb der Anwendung (`system/restricted-mode.ts`) fragt denselben Speicher.
 *
 * - **offen** höchstens 30 s je Token-Hash, nie über das Ende der Sitzung hinaus (seit 2026-10-10 sind Sitzungen unbefristet, eine
 *   Grenze hat nur noch der Notzugang mit 60 Minuten);
 * - **zu** 5 s für ein wohlgeformtes, unbekanntes Token, damit zufällige Cookies die Datenbank nicht treiben; ein falsch
 *   geformtes Token erreicht die Datenbank nie;
 * - **Entzug sofort:** Jede Änderung, die eine Sitzung beendet oder Rechte ändert, meldet die Datenbank auf dem Kanal der
 *   Migration 0081 (Abmelden, Sperren, Herabstufen, Zugang entziehen, Erneuerung verlangen); die Einträge dieser Person
 *   fallen heraus. Nach einem Wiederverbinden von `LISTEN` fällt alles heraus (die Meldungen dazwischen sind verloren), ebenso
 *   bei jedem Wechsel von Stellung oder Revision des Betriebszustands (SYS-0001 §4.3). Abmelden über diese Instanz löscht den Eintrag
 *   zusätzlich sofort, ohne auf die Meldung zu warten;
 * - höchstens 5000 Einträge, darüber fallen die ältesten.
 *
 * 🔴 **Die Tür prüft nur, sie verändert nichts** (Claudio 2026-10-09, Abstimmung Punkt 1): kein `UPDATE` von
 * `last_seen_at`, keine Erneuerung, kein `Set-Cookie`. Nginx verwirft die Kopfzeilen der Unteranfrage; ein neues Cookie käme
 * nie im Browser an, und die Person wäre beim nächsten Klick draußen. Eine zur Erneuerung markierte Sitzung gilt an der Tür
 * weiter; erneuert wird beim nächsten gewöhnlichen Aufruf (die Seite fragt beim Laden `/api/auth/session`).
 *
 * 🪤 Ohne `LISTEN` (etwa ein Pooler im Transaktionsmodus) bleibt ein Entzug an der Tür bis zu 30 s blind; die Routen mit
 * Rechten prüfen weiter jede Anfrage selbst.
 */

export const GATE_OPEN_MS = 30_000;
export const GATE_CLOSED_MS = 5_000;
export const GATE_MAX_ENTRIES = 5_000;

/** Die Antwort der Tür; Nginx: 204 durch, 401 → 302 `/anmelden` (nur HTML), 403 → Wartungsseite, 503 → Störungsseite. */
export type GateStatus = 204 | 401 | 403 | 503;

/** Was die Tür von einer Sitzung weiß: ob sie gilt und ob sie im eingeschränkten Betrieb hineinkommt. */
export interface GateAccess {
    readonly open: boolean;
    readonly restricted: boolean;
}

const CLOSED: GateAccess = { open: false, restricted: false };

interface GateEntry extends GateAccess {
    readonly personId: string | null;
    readonly until: number;
}

export interface GateCacheOptions {
    openMs?: number;
    closedMs?: number;
    maxEntries?: number;
    now?: () => number;
}

/** Das gemerkte Urteil der Tür je Token-Hash; ohne Datenbank, ohne Uhr von außen nur für Tests. */
export class GateCache {
    readonly #entries = new Map<string, GateEntry>();
    readonly #byPerson = new Map<string, Set<string>>();
    readonly #openMs: number;
    readonly #closedMs: number;
    readonly #maxEntries: number;
    readonly #now: () => number;
    /** Zählt jeden Entzug: Ein Urteil, das während eines Entzugs gelesen wurde, wird nicht gemerkt. */
    #epoch = 0;

    constructor(options: GateCacheOptions = {}) {
        this.#openMs = options.openMs ?? GATE_OPEN_MS;
        this.#closedMs = options.closedMs ?? GATE_CLOSED_MS;
        this.#maxEntries = options.maxEntries ?? GATE_MAX_ENTRIES;
        this.#now = options.now ?? Date.now;
    }

    get size(): number {
        return this.#entries.size;
    }

    /** Der Stand der Entzüge; vor dem Lesen der Datenbank holen und an `remember` geben. */
    epoch(): number {
        return this.#epoch;
    }

    /** Das gemerkte Urteil oder `undefined`, wenn die Datenbank gefragt werden muss. */
    lookup(key: string): GateAccess | undefined {
        const entry = this.#entries.get(key);
        if (entry === undefined) return undefined;
        if (entry.until > this.#now()) return { open: entry.open, restricted: entry.restricted };
        this.#drop(key);
        return undefined;
    }

    /** Merkt das Urteil zu einer gelesenen Sitzung, außer es kam seit `epoch` ein Entzug dazwischen. */
    remember(
        key: string,
        session:
            | Pick<SessionRecord, "personId" | "expiresAt" | "idleExpiresAt" | "role" | "grants" | "assurance">
            | undefined,
        epoch: number,
    ): void {
        if (epoch !== this.#epoch) return;
        const now = this.#now();
        const until =
            session === undefined
                ? now + this.#closedMs
                : Math.min(now + this.#openMs, session.expiresAt.getTime(), session.idleExpiresAt.getTime());
        if (until <= now) return;
        this.#drop(key);
        this.#makeRoom(now);
        const personId = session?.personId ?? null;
        this.#entries.set(key, { ...accessOf(session), personId, until });
        if (personId !== null) {
            const keys = this.#byPerson.get(personId) ?? new Set<string>();
            keys.add(key);
            this.#byPerson.set(personId, keys);
        }
    }

    /** Abmelden: dieses eine Token sofort vergessen. */
    forget(key: string): void {
        this.#epoch += 1;
        this.#drop(key);
    }

    /** Entzug über `NOTIFY`: alles dieser Person vergessen. */
    forgetPerson(personId: string): void {
        this.#epoch += 1;
        for (const key of this.#byPerson.get(personId) ?? []) this.#entries.delete(key);
        this.#byPerson.delete(personId);
    }

    /** Wiederverbinden von `LISTEN` oder ein Wechsel des Betriebszustands: alles vergessen. */
    clear(): void {
        this.#epoch += 1;
        this.#entries.clear();
        this.#byPerson.clear();
    }

    #drop(key: string): void {
        const entry = this.#entries.get(key);
        if (entry === undefined) return;
        this.#entries.delete(key);
        if (entry.personId === null) return;
        const keys = this.#byPerson.get(entry.personId);
        keys?.delete(key);
        if (keys?.size === 0) this.#byPerson.delete(entry.personId);
    }

    #makeRoom(now: number): void {
        if (this.#entries.size < this.#maxEntries) return;
        for (const [key, entry] of this.#entries) if (entry.until <= now) this.#drop(key);
        // Eine Map zählt in Einfügereihenfolge: vorn stehen die ältesten.
        for (const key of this.#entries.keys()) {
            if (this.#entries.size < this.#maxEntries) break;
            this.#drop(key);
        }
    }
}

function accessOf(session: Pick<SessionRecord, "role" | "grants" | "assurance"> | undefined): GateAccess {
    if (session === undefined) return CLOSED;
    return { open: true, restricted: holdsRestrictedAccess(session) };
}

/** Was die Tür vom Betriebszustand braucht: den Stand im Speicher und die Meldung jedes Wechsels. */
export type GateState = Pick<SystemStateStore, "snapshot" | "onChange">;

export interface Gate {
    /** Die Türfrage: 204, 401, 403 oder 503 (Matrix oben). Liest höchstens einmal die Datenbank und schreibt nie. */
    decide(cookieHeader: string | undefined): Promise<GateStatus>;
    /** `?nur=bereitschaft`: 204, wenn diese Instanz bereit ist, sonst 503; ohne Sitzung und Stellung, ohne Datenbank. */
    readiness(): GateStatus;
    /** Was die Sitzung hinter diesem Cookie an der Tür gilt, aus demselben Speicher (für den eingeschränkten Betrieb der Anwendung). */
    access(cookieHeader: string | undefined): Promise<GateAccess>;
    /** Abmelden über diese Instanz: das Token sofort vergessen. */
    forget(cookieHeader: string | undefined): void;
    close(): Promise<void>;
}

export interface GateDeps {
    database: Database | undefined;
    config: AuthConfig;
    /** `AUTH_GATE`; ohne Wert `members` (`config.ts`, `gateProfile`). */
    profile?: GateProfile | undefined;
    /** Der Betriebszustand dieser Instanz; ohne ihn (keine Datenbank) ist die Tür nie bereit. */
    state?: GateState | undefined;
    cache?: GateCache;
    log?: ChangeWatchLogger;
    /** Für Tests: der Takt des Wächters über `LISTEN`. */
    watch?: ChangeWatchOptions;
}

export function createGate({
    database,
    config,
    profile = "members",
    state,
    cache = new GateCache(),
    log,
    watch: watchOptions,
}: GateDeps): Gate {
    let watch: Promise<() => Promise<void>> | undefined;
    const watching = (db: Database): Promise<() => Promise<void>> =>
        (watch ??= watchAuthChanges(
            db,
            (personId) => cache.forgetPerson(personId),
            log,
            () => cache.clear(),
            watchOptions,
        ));
    // Jeder Wechsel von Stellung oder Revision leert den Speicher (SYS-0001 §4.3), wie ein Wiederverbinden von `LISTEN`.
    const unwatchState = state?.onChange((previous, next) => {
        if (previous.mode !== next.mode || previous.revision !== next.revision) cache.clear();
    });
    const tokenOf = (cookieHeader: string | undefined): string | undefined => {
        const token = parseCookies(cookieHeader).get(sessionCookieName(config));
        return isWellFormedToken(token) ? token : undefined;
    };
    const ready = (): boolean => state?.snapshot().ready === true;

    async function access(cookieHeader: string | undefined): Promise<GateAccess> {
        const environment = config.environment;
        const token = tokenOf(cookieHeader);
        if (database === undefined || environment === undefined || token === undefined) return CLOSED;
        const key = tokenHash(token).toString("base64url");
        const known = cache.lookup(key);
        if (known !== undefined) return known;
        // Erst hören, dann lesen: Ein Entzug zwischen Lesen und Merken darf nicht ungehört vorbeigehen.
        await watching(database);
        const epoch = cache.epoch();
        let session: SessionRecord | undefined;
        try {
            session = await loadSession(database, token, environment);
        } catch (error) {
            if (isNotProvisioned(error)) {
                throw new ApiError(503, "auth_unavailable", AUTH_NOT_READY);
            }
            throw error;
        }
        cache.remember(key, session, epoch);
        return accessOf(session);
    }

    return {
        async decide(cookieHeader) {
            const snapshot = state?.snapshot();
            if (snapshot?.ready !== true) return 503;
            const normal = modeKnown(snapshot) && snapshot.mode === "normal";
            // Production im Normalbetrieb: keine Sitzung, kein Cookie, keine Datenbank, nur diese eine Speicherabfrage.
            if (normal && profile === "public") return 204;
            const verdict = await access(cookieHeader);
            if (normal) return verdict.open ? 204 : 401;
            // Eingeschränkt oder unbekannt: nur mit Zugangsrecht. Ohne Sitzung schickt `members` zur Anmeldung, `public` zur Wartung.
            if (verdict.restricted) return 204;
            return profile === "members" && !verdict.open ? 401 : 403;
        },
        readiness() {
            return ready() ? 204 : 503;
        },
        access,
        forget(cookieHeader) {
            const token = tokenOf(cookieHeader);
            if (token !== undefined) cache.forget(tokenHash(token).toString("base64url"));
        },
        async close() {
            unwatchState?.();
            await (
                await watch
            )?.();
        },
    };
}
