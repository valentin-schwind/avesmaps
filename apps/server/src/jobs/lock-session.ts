import type postgres from "postgres";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";

/**
 * Die eine Sitzung des Ausführers für die **geteilte** Sperre der Domäne (JOBS-0001 4.8, `derive-lock.ts`): Ein Job, dessen Art
 * sie hält (`holdsSharedDomainLock`), nimmt sie vor dem Claim; die exklusiven Ableitungen (ein Zug, `derive:terrain`) weichen,
 * solange er läuft. Advisory Locks zählen je Sitzung mit (zweimal genommen heißt zweimal freigeben).
 *
 * 🔴 Die Sperre des PLANERS steht hier nicht mehr (WI-0163): Geplant wird im Dirigenten (`jobs/dirigent/`), der Ausführer führt
 * genau einen Auftrag aus und plant nichts.
 *
 * Die Verbindung wird erst reserviert, wenn ein Job die Sperre braucht. Stirbt sie, hat PostgreSQL die Sperre freigegeben. Das ist
 * kein Datenrisiko, denn auch der Heartbeat scheitert dann und die Lease läuft ab (Fencing).
 *
 * 🪤 `createDatabase` schließt ruhende Verbindungen nach 30 s; ein kurzes `SELECT 1` alle 10 s hält die reservierte Verbindung
 * und damit die Sperre (wie in `derive-lock.ts`).
 */

const KEEPALIVE_MS = 10_000;

export class LockSession {
    private readonly database: Database;
    private readonly deriveScope: string;
    private connection: postgres.ReservedSql | undefined;
    private keepalive: ReturnType<typeof setInterval> | undefined;
    private shared = 0;
    private busy: Promise<unknown> = Promise.resolve();

    constructor(database: Database, deriveScope: string) {
        this.database = database;
        this.deriveScope = deriveScope;
    }

    /** Wie viele Jobs gerade die geteilte Sperre über diese Sitzung halten. */
    sharedCount(): number {
        return this.shared;
    }

    /** Alle Befehle der Sitzung nacheinander (Nehmen und Freigeben dürfen sich nicht überholen). */
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.busy.then(work, work);
        this.busy = next.catch(() => undefined);
        return next;
    }

    private drop(): void {
        if (this.keepalive) clearInterval(this.keepalive);
        this.keepalive = undefined;
        const connection = this.connection;
        this.connection = undefined;
        this.shared = 0;
        if (connection) {
            // 🪤 Eine Verbindung, die ihre Sperren behält und in den Pool zurückgeht, hielte sie fest: erst alles freigeben.
            void connection`SELECT pg_advisory_unlock_all()`
                .catch(() => undefined)
                .then(() => {
                    try {
                        connection.release();
                    } catch {
                        // Die Verbindung ist ohnehin weg.
                    }
                });
        }
    }

    /** Die reservierte Verbindung, beim ersten Bedarf geholt; `undefined`, wenn keine zu bekommen ist. */
    private async open(): Promise<postgres.ReservedSql | undefined> {
        if (this.connection) return this.connection;
        try {
            this.connection = await this.database.reserve();
        } catch {
            return undefined;
        }
        this.keepalive = setInterval(() => {
            const alive = this.connection;
            if (alive) alive`SELECT 1`.catch(() => undefined);
        }, KEEPALIVE_MS);
        this.keepalive.unref();
        return this.connection;
    }

    /** Nimmt die geteilte Sperre der Domäne für einen Job. `false`: ein exklusiver Halter (ein Zug) hat sie, oder keine Verbindung. */
    acquireShared(): Promise<boolean> {
        return this.serial(async () => {
            const connection = await this.open();
            if (!connection) return false;
            try {
                const [row] = await connection<{ ok: boolean }[]>`
                    SELECT pg_try_advisory_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${this.deriveScope})) AS ok
                `;
                if (row?.ok === true) {
                    this.shared += 1;
                    return true;
                }
                return false;
            } catch {
                this.drop();
                return false;
            }
        });
    }

    /** Gibt die geteilte Sperre eines Jobs zurück. */
    releaseShared(): Promise<void> {
        return this.serial(async () => {
            const connection = this.connection;
            if (!connection || this.shared === 0) return;
            this.shared -= 1;
            try {
                await connection`
                    SELECT pg_advisory_unlock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${this.deriveScope}))
                `;
            } catch {
                this.drop();
            }
        });
    }

    /** Gibt alles frei und die Verbindung zurück. */
    release(): Promise<void> {
        return this.serial(async () => {
            const connection = this.connection;
            if (!connection) return;
            try {
                // `unlock_all` statt je einer Freigabe: eine geteilte Sperre, die mehrfach genommen wurde, zählt mehrfach.
                await connection`SELECT pg_advisory_unlock_all()`;
            } catch {
                // Schließt die Sitzung, gibt PostgreSQL ohnehin alles frei.
            }
            this.drop();
        });
    }
}
