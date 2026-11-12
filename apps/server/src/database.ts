import postgres from "postgres";

export type Database = postgres.Sql;

/**
 * Was eine Funktion annimmt, die sowohl an der Verbindung als auch INNERHALB einer Transaktion
 * laufen darf. `postgres.Sql` allein genuegt dafuer nicht: eine Transaktion hat kein `end()` und
 * kein `begin()`, ist also kein `Sql`. Wer den Unterschied wegcastet, kann versehentlich mitten in
 * einer Transaktion die Verbindung schliessen.
 */
export type Queryable = postgres.Sql | postgres.TransactionSql;

/** Zeitgrenzen einer Sitzung (Kap. 10.129), in Millisekunden. */
export interface SessionTimeouts {
    /** `statement_timeout`: keine einzelne Abfrage rechnet länger. */
    statementMs: number;
    /** `lock_timeout`: keine Abfrage wartet länger auf eine Sperre, etwa hinter einer Migration. */
    lockMs: number;
    /** `idle_in_transaction_session_timeout`: keine offene Transaktion bleibt länger untätig (Kap. 10.130). */
    idleInTransactionMs: number;
}

/**
 * Der Server: jede Abfrage bedient eine wartende Anfrage. Lokal braucht die längste legitime rund
 * 0,2 s; ohne Grenze hielt der Körper aus S-01 eine Verbindung 34 s fest (WI-0037, S-05). Die Werte
 * sind mit Claudio abgestimmt (Handover `2026-09-26-db-timeouts-abstimmung.md`) und liegen unter den
 * 60 s, nach denen Nginx aufgibt.
 */
export const SERVER_TIMEOUTS: SessionTimeouts = { statementMs: 5_000, lockMs: 2_000, idleInTransactionMs: 30_000 };

/** Der Routing-Worker: mehr Luft, weil er nach einem Import den ganzen Graphen neu lädt. */
export const WORKER_TIMEOUTS: SessionTimeouts = { statementMs: 15_000, lockMs: 2_000, idleInTransactionMs: 30_000 };

/**
 * Höchste Pause vor dem nächsten Verbindungsversuch nach einem Fehler, in Sekunden. postgres.js zählt die Fehlversuche für den
 * ganzen Pool samt `LISTEN` und wartet von Haus aus bis zu 20 s (`3 ** n / 100`). Seit der Betriebszustand im Takt liest und
 * hört (SYS-2), steigt der Zähler bei einem Ausfall in wenigen Sekunden so weit, dass jede Anfrage bis zu 20 s auf ihren Versuch
 * wartet, statt mit 503 abzuweisen, und die Anwendung nach der Rückkehr der Datenbank noch so lange tot bleibt (gemessen
 * 2026-10-10: 17,7 s für vier Anfragen gegen einen toten Port; Befund SYS-3: Tür bis rund 20 s auf 503).
 */
export const RECONNECT_BACKOFF_MAX_S = 1;

/** Wie postgres.js (Zufall gegen gleichzeitige Versuche, wachsend), aber gedeckelt. */
export function reconnectBackoff(retries: number): number {
    return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, RECONNECT_BACKOFF_MAX_S);
}

/**
 * Thin SQL access. The database schema and explicit SQL stay authoritative (chapter 4.14);
 * this is a connection helper, not an ORM.
 *
 * Ohne `timeouts` gilt keine Grenze: Importe, Ableitungen und Migrationen dürfen lange rechnen.
 * Die Grenzen gehen als Startparameter mit jeder Verbindung und haben Vorrang vor den Werten der Rolle.
 */
export function createDatabase(
    databaseUrl: string,
    options: { max?: number; timeouts?: SessionTimeouts; connectTimeoutS?: number } = {},
): Database {
    const { timeouts } = options;
    return postgres(databaseUrl, {
        max: options.max ?? 10,
        idle_timeout: 30,
        // Ein kurzer Wert für Werkzeuge, die nie einen Ablauf aufhalten dürfen (jobs-cli record).
        connect_timeout: options.connectTimeoutS ?? 10,
        backoff: reconnectBackoff,
        onnotice: () => {},
        ...(timeouts
            ? {
                  connection: {
                      statement_timeout: timeouts.statementMs,
                      lock_timeout: timeouts.lockMs,
                      idle_in_transaction_session_timeout: timeouts.idleInTransactionMs,
                  },
              }
            : {}),
    });
}

/**
 * Die Grenzen, die in einer Sitzung wirklich gelten, wie PostgreSQL sie meldet. Server und Worker
 * schreiben sie beim Start einmal ins Journal: Claudios Leserolle sieht die Einstellungen fremder
 * Sitzungen nicht, und nur so ist nach einem Rollout prüfbar, dass sie greifen.
 */
export async function sessionLimits(database: Queryable): Promise<Record<string, string>> {
    const [row] = await database<{ statement_timeout: string; lock_timeout: string; idle: string }[]>`
        SELECT current_setting('statement_timeout') AS statement_timeout,
               current_setting('lock_timeout') AS lock_timeout,
               current_setting('idle_in_transaction_session_timeout') AS idle
    `;
    return {
        statement_timeout: row?.statement_timeout ?? "?",
        lock_timeout: row?.lock_timeout ?? "?",
        idle_in_transaction_session_timeout: row?.idle ?? "?",
    };
}

/**
 * Verbindungsfehler von postgres.js und Node: Die Datenbank ist nicht erreichbar, die Anfrage war
 * nicht falsch.
 */
const CONNECTION_ERROR_CODES = new Set([
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_DESTROYED",
    "CONNECTION_ENDED",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
]);

/**
 * SQLSTATE, bei denen die Datenbank gerade nicht bedienbar ist: Klasse 08 (Verbindung), 28 (Anmeldung),
 * 53 (Ressourcen, etwa zu viele Verbindungen), 57 (Abbruch, darunter `statement_timeout` 57014 und
 * Herunterfahren), dazu `lock_timeout` (55P03) und `idle_in_transaction_session_timeout` (25P03).
 */
function isUnavailableSqlState(code: string): boolean {
    return /^(08|28|53|57)/.test(code) || code === "55P03" || code === "25P03";
}

/**
 * 🔴 Trifft die Zeitgrenze einen GEOS-Aufruf (ST_Union, ST_Intersection), meldet PostGIS den Abbruch
 * nicht als 57014, sondern als `XX000` „lwgeom_…: GEOS Error: InterruptedException: Interrupted!“
 * (WI-0037 S-01, lokal nachgestellt: 8 von 35 Abbrüchen der Landschaftsabfrage). Nur DIESES XX000 ist
 * ein Abbruch; jedes andere bleibt ein Fehler (500).
 */
const GEOS_INTERRUPTED = /GEOS Error: InterruptedException/;

/** Ob ein Fehler bedeutet „Datenbank gerade nicht bedienbar“ (503) statt „etwas ist kaputt“ (500). */
export function isDatabaseUnavailable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "string") return false;
    if (CONNECTION_ERROR_CODES.has(code)) return true;
    if (!(error instanceof postgres.PostgresError)) return false;
    return isUnavailableSqlState(code) || (code === "XX000" && GEOS_INTERRUPTED.test(error.message));
}

/** Ob PostgreSQL die Anweisung abgebrochen hat (`statement_timeout`, `pg_cancel_backend`): 57014, mitten in GEOS das XX000 oben. */
export function isStatementCancelled(error: unknown): boolean {
    if (!(error instanceof postgres.PostgresError)) return false;
    return error.code === "57014" || (error.code === "XX000" && GEOS_INTERRUPTED.test(error.message));
}

/**
 * Ob eine Anweisung an `lock_timeout` scheiterte (55P03): Die Datenbank ist da, nur hielt jemand die Zeile länger als 2 s (Stage 2026-10-19:
 * Speichern eines Gebiets während der Ableitung). Weiter 503, aber als `database_busy` statt „nicht erreichbar“ (`error-handler.ts`), und
 * eine Operation an der Karte versucht es noch einmal (`mitSperrWiederholung`).
 */
export function isLockTimeout(error: unknown): boolean {
    return error instanceof postgres.PostgresError && error.code === "55P03";
}

/** SQLSTATE 40P01: PostgreSQL hat diese Transaktion als Opfer eines Deadlocks abgebrochen. */
export function isDeadlock(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "40P01";
}

/** Was einer Instanz noch fehlt: Tabelle (42P01), Schema (3F000), Funktion (42883), Recht (42501). */
const NOT_PROVISIONED_CODES = new Set(["42P01", "3F000", "42883", "42501"]);

/**
 * Ob ein Fehler heißt „Schema oder Recht fehlt noch“: Der Korridor startet Fastify vor `migrate` und `db-grants` (Claudio
 * 2026-10-09). Die Anmeldung antwortet dann 503 statt 500 (`auth/plugin.ts`, `error-handler.ts`); anderswo bleibt es ein Fehler.
 */
export function isNotProvisioned(error: unknown): boolean {
    return error instanceof postgres.PostgresError && NOT_PROVISIONED_CODES.has(error.code);
}

/** Wie oft der Abbruch einer Transaktion wiederholt wird, solange sie noch läuft, in Millisekunden. */
const CANCEL_RETRY_MS = 50;

export interface TransactionOptions {
    /**
     * `SET LOCAL jit = off`: JIT gilt nur in dieser Transaktion nicht, die Verbindung hat danach wieder die
     * Einstellung des Servers. Für Abfragen, deren Planer sich verschätzt: Über den Schwellen von
     * `jit_above_cost` (100 000) übersetzt PostgreSQL sonst jeden Ausdruck, und das kostete bei den
     * Gebieten einer Route 0,66 von 1,0 s (Stage, WI-0065). Lokal gibt es kein LLVM, dort bleibt es ohne Wirkung.
     */
    jitOff?: boolean;
    /**
     * Bricht die laufende Abfrage ab, sobald das Signal feuert, und lässt die Arbeit mit dem Fehler des
     * Abbruchs (57014) enden: Wer die Antwort nicht mehr abwartet, soll die Datenbank nicht weiter
     * beschäftigen. Ist es schon gefeuert, beginnt nichts (`signal.reason`).
     */
    signal?: AbortSignal;
}

/**
 * Hält den Abbruch bereit, solange die Transaktion läuft; der Rückgabewert beendet ihn.
 *
 * Gebrochen wird mit `pg_cancel_backend` auf dem Backend der Transaktion, aus dem Pool. 🪤 Nicht mit
 * `query.cancel()` von postgres.js: Es wirft sein Versprechen weg, und scheitert die Verbindung für den
 * Abbruch (Datenbank gerade weg), ist das eine unbehandelte Zurückweisung, die den Prozess beendet.
 *
 * 🪤 Der Beginn der Transaktion geht als Text hin und her: Als `timestamptz`-Parameter machte postgres.js ein
 * `Date` daraus und schnitte die Mikrosekunden ab, und der Vergleich unten träfe nie.
 *
 * 🔴 Zwei Sicherungen gegen den Abbruch der falschen Arbeit: Er trifft nur dieses Backend UND diese
 * Transaktion (`xact_start`), und nur, solange es rechnet (`state = 'active'`). Zwischen zwei Abfragen
 * trifft ein Abbruch ins Leere; deshalb wird er wiederholt, bis die Transaktion endet. Danach schickt
 * niemand mehr einen: Ein Abbruch für ein längst beendetes Backend träfe die nächste, fremde Abfrage
 * derselben Verbindung.
 */
async function cancelOnAbort(
    database: Database,
    transaction: postgres.TransactionSql,
    signal: AbortSignal,
): Promise<() => void> {
    const [backend] = await transaction<{ pid: number; started: string }[]>`
        SELECT pg_backend_pid() AS pid, transaction_timestamp()::text AS started
    `;
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const cancel = (): void => {
        if (stopped) return;
        // Scheitert der Abbruch selbst, bleibt die Zeitgrenze der Abfrage der Rückhalt.
        void database`
            SELECT pg_cancel_backend(pid) FROM pg_stat_activity
            WHERE pid = ${backend?.pid ?? 0} AND xact_start = ${backend?.started ?? ""}::text::timestamptz AND state = 'active'
        `.catch(() => {});
        timer = setTimeout(cancel, CANCEL_RETRY_MS);
    };
    const stop = (): void => {
        stopped = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    return stop;
}

/**
 * Eine Arbeit in einer Transaktion mit eigener Zeitgrenze (`SET LOCAL statement_timeout`): Sie gilt nur
 * dort, die Verbindung hat danach wieder die Grenze ihres Pools. Ein Abbruch ist 57014 oder, mitten in
 * GEOS, das XX000 oben; beides wird 503. Mit `options` dazu JIT aus und/oder der Abbruch durch ein Signal.
 */
export async function withStatementTimeout<T>(
    database: Database,
    statementMs: number,
    work: (transaction: postgres.TransactionSql) => Promise<T>,
    options: TransactionOptions = {},
): Promise<T> {
    const { signal, jitOff = false } = options;
    signal?.throwIfAborted();
    // Ein Halter statt einer Variablen: TypeScript sieht eine Zuweisung im Rückruf unten nicht.
    const cancelling: { stop?: () => void } = {};
    try {
        return (await database.begin(async (transaction) => {
            // Ein Parameter geht in SET nicht; die Zahl ist unsere eigene und ganzzahlig.
            await transaction.unsafe(
                `SET LOCAL statement_timeout = ${String(Math.round(statementMs))}${jitOff ? "; SET LOCAL jit = off" : ""}`,
            );
            if (signal) {
                cancelling.stop = await cancelOnAbort(database, transaction, signal);
                // Ging das Signal während der Vorbereitung, beginnt die Arbeit gar nicht erst.
                signal.throwIfAborted();
            }
            return work(transaction);
        })) as T;
    } finally {
        cancelling.stop?.();
    }
}

export interface DatabaseProbe {
    isReachable: boolean;
    detail: string;
}

export async function probeDatabase(database: Database): Promise<DatabaseProbe> {
    try {
        const rows = await database<{ postgis_version: string }[]>`SELECT postgis_version() AS postgis_version`;
        const version = rows[0]?.postgis_version ?? "unknown";
        return { isReachable: true, detail: `postgis ${version}` };
    } catch (error) {
        // The message must stay free of connection strings and credentials (chapter 10.92).
        return { isReachable: false, detail: error instanceof Error ? error.name : "unknown error" };
    }
}
