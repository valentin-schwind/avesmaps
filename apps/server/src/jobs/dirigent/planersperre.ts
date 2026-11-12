import type postgres from "postgres";
import { JOB_PLANNER_LOCK_CLASS } from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";

/**
 * Die Planersperre einer Umgebung (JOBS-0001 4.8, WI-0163 §5.3): ein Advisory Lock `(avesmaps3d:job-worker, <Domäne>)` auf einer
 * eigens reservierten Verbindung. Wer ihn hält, plant diese Umgebung; die anderen lesen nur. 🔴 Derselbe Schlüssel wie beim Worker
 * bis WI-0163: Während des Übergangs schließen alter Worker und Dirigent einander aus, und `isPlannerActive` (`overview.ts`) sieht
 * den Dirigenten wie früher den Worker. Ein Advisory Lock braucht kein Recht an einer Tafel; die Leserolle darf ihn nehmen.
 *
 * Seit WI-0163 Teil A hält `LockSession` nur noch die geteilte Sperre der Domäne für den Ausführer; die Wahl des Planers lebt hier.
 *
 * Stirbt die Verbindung, hat PostgreSQL die Sperre freigegeben: Der nächste Takt erkennt es (`SELECT 1`) und versucht es neu.
 * 🪤 `createDatabase` schließt ruhende Verbindungen nach 30 s; ein `SELECT 1` alle 10 s hält die reservierte Verbindung.
 */

const KEEPALIVE_MS = 10_000;

export class Planersperre {
    private readonly database: Database;
    private readonly scope: string;
    private connection: postgres.ReservedSql | undefined;
    private keepalive: ReturnType<typeof setInterval> | undefined;
    private busy: Promise<unknown> = Promise.resolve();

    constructor(database: Database, scope: string) {
        this.database = database;
        this.scope = scope;
    }

    gehalten(): boolean {
        return this.connection !== undefined;
    }

    /** Alle Befehle nacheinander: Ein Takt und das Beenden dürfen sich nicht überholen. */
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.busy.then(work, work);
        this.busy = next.catch(() => undefined);
        return next;
    }

    private loslassen(): void {
        if (this.keepalive) clearInterval(this.keepalive);
        this.keepalive = undefined;
        const connection = this.connection;
        this.connection = undefined;
        if (connection) {
            // 🪤 Eine Verbindung, die ihre Sperre behält und in den Pool zurückgeht, hielte den Planer fest: erst freigeben.
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

    /** Hält dieser Dirigent die Sperre, oder bekommt er sie jetzt? Eine tote Verbindung wird erkannt und verworfen. */
    sichern(): Promise<boolean> {
        return this.serial(async () => {
            if (this.connection) {
                try {
                    await this.connection`SELECT 1`;
                    return true;
                } catch {
                    this.loslassen();
                }
            }
            let connection: postgres.ReservedSql;
            try {
                connection = await this.database.reserve();
            } catch {
                return false;
            }
            try {
                const [row] = await connection<{ ok: boolean }[]>`
                    SELECT pg_try_advisory_lock(hashtext(${JOB_PLANNER_LOCK_CLASS}), hashtext(${this.scope})) AS ok
                `;
                if (row?.ok !== true) {
                    connection.release();
                    return false;
                }
            } catch {
                try {
                    connection.release();
                } catch {
                    // Verbindung schon weg.
                }
                return false;
            }
            this.connection = connection;
            this.keepalive = setInterval(() => {
                const alive = this.connection;
                if (alive) alive`SELECT 1`.catch(() => undefined);
            }, KEEPALIVE_MS);
            this.keepalive.unref();
            return true;
        });
    }

    /** Gibt die Sperre frei und die Verbindung zurück. */
    freigeben(): Promise<void> {
        return this.serial(async () => {
            const connection = this.connection;
            if (!connection) return;
            try {
                await connection`SELECT pg_advisory_unlock_all()`;
            } catch {
                // Schließt die Sitzung, gibt PostgreSQL ohnehin alles frei.
            }
            this.loslassen();
        });
    }
}
