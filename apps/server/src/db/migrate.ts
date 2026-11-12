import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Database } from "../database.ts";

export interface AppliedMigration {
    version: string;
    checksum: string;
}

/** Wie lange eine Migration höchstens auf eine Sperre wartet (abgestimmt mit Claudio, WI-0037). */
export const MIGRATION_LOCK_TIMEOUT = "5s";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

function checksumOf(sql: string): string {
    // Line endings differ between Windows checkouts and the Linux runtime, so they must not
    // change the checksum of an already applied migration.
    return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

/**
 * Nur die Namen der Migrationen dieses Release, ohne ihr SQL zu lesen (Systemzustand, Betreiber 2026-10-14).
 * `readMigrations` lädt jede Datei und rechnet Prüfsummen; für die Anzeige alle 30 s wäre das Verschwendung.
 */
export async function migrationVersionen(): Promise<string[]> {
    const namen = await readdir(migrationsDirectory);
    return namen
        .filter((name) => name.endsWith(".sql"))
        .map((name) => name.replace(/\.sql$/u, ""))
        .sort();
}

async function readMigrations(): Promise<{ version: string; sql: string; checksum: string }[]> {
    const fileNames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    const migrations = [];
    for (const fileName of fileNames) {
        const sql = await readFile(new URL(fileName, `file://${migrationsDirectory.replace(/\\/g, "/")}`), "utf8");
        migrations.push({ version: fileName.replace(/\.sql$/, ""), sql, checksum: checksumOf(sql) });
    }
    return migrations;
}

/**
 * Ein Fehler, der in EINER Zeile sagt, welche Migration woran scheiterte. Der Deploy zeigt nur die
 * letzten drei Zeilen der Ausgabe; Claudio unterscheidet daran „Sperre belegt, wiederholen“ (55P03)
 * von einem echten Fehler (Handover `2026-09-26-db-timeouts-antwort.md`).
 */
export function migrationFailure(version: string, error: unknown): Error {
    const code = (error as { code?: unknown } | undefined)?.code;
    const sqlState = typeof code === "string" ? ` (SQLSTATE ${code})` : "";
    const retry = code === "55P03" ? " - lock_timeout, eine Sperre war belegt: wiederholen" : "";
    // Eine Zeile, auch wenn die Meldung selbst umbricht.
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, " ");
    return new Error(`migration ${version} failed${sqlState}${retry}: ${message}`, { cause: error });
}

/**
 * Applies pending migrations in order, each in its own transaction (chapter 4.15).
 * An already applied migration whose file changed aborts the run: a schema that was deployed
 * somewhere must not be edited in place, it gets a follow-up migration instead.
 */
export async function migrate(database: Database): Promise<string[]> {
    await database`
        CREATE TABLE IF NOT EXISTS schema_migration (
            version TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;

    const applied = await database<AppliedMigration[]>`SELECT version, checksum FROM schema_migration`;
    const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));
    const migrations = await readMigrations();
    const executed: string[] = [];

    for (const migration of migrations) {
        const knownChecksum = appliedByVersion.get(migration.version);
        if (knownChecksum === migration.checksum) {
            continue;
        }
        if (knownChecksum !== undefined) {
            throw new Error(
                `migration ${migration.version} was applied with a different checksum; ` +
                    "add a follow-up migration instead of editing an applied one",
            );
        }
        try {
            await database.begin(async (transaction) => {
                // Eine Migration wartet nicht ohne Ende hinter einem Leser: Hinter ihrer eigenen wartenden
                // Sperre stauten sich sonst alle anderen Verbindungen (WI-0037, S-05). Rechnen darf sie lange.
                // `SET LOCAL` nimmt keine Parameter; `set_config(…, true)` ist dasselbe.
                await transaction`SELECT set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, true)`;
                await transaction.unsafe(migration.sql);
                await transaction`
                    INSERT INTO schema_migration (version, checksum)
                    VALUES (${migration.version}, ${migration.checksum})
                `;
            });
        } catch (error) {
            throw migrationFailure(migration.version, error);
        }
        executed.push(migration.version);
    }

    return executed;
}
