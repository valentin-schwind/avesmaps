import { createDatabase, type Database } from "../database.ts";
import { JobFailure } from "./handlers.ts";

/**
 * Die Datenbank eines Job-Prozesses, der selbst liest und schreibt (Gelände-Jobs, WI-0125): dieselbe Verbindung wie sein Worker
 * (`JOBS_DATABASE_URL`, die Jobs-Rolle mit Limit 6, sonst `DATABASE_URL`), mit höchstens zwei Verbindungen. Die Jobs-Rolle braucht
 * dafür Schreibrechte auf die abgeleiteten Tabellen des Geländes (Q10; auf dem VPS über Claudios `db-grants`).
 */
export async function withJobDatabase<T>(work: (database: Database) => Promise<T>): Promise<T> {
    const url = process.env["JOBS_DATABASE_URL"] ?? process.env["DATABASE_URL"];
    if (!url) throw new JobFailure("database_missing", "Weder JOBS_DATABASE_URL noch DATABASE_URL gesetzt", false);
    const database = createDatabase(url, { max: 2 });
    try {
        return await work(database);
    } finally {
        await database.end({ timeout: 5 });
    }
}

/** Die Kartendomäne eines Jobs; ohne sie kann ein Gelände-Job nichts. */
export function jobDomain(domain: string | null): string {
    if (!domain) throw new JobFailure("domain_missing", "Der Job nennt keine Kartendomäne", false);
    return domain;
}
