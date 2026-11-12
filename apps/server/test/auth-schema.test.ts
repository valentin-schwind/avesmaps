import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * Das Schema `avesmaps_auth` (WI-0120 A2, Migration 0079, AUTH-0001 §5) und seine Rechte (`src/db/auth-grants.psql`): jede Tafel und
 * jede Funktion mit SECURITY DEFINER steht in der Vorlage, Bedingungen und Trigger des Schemas. Alles läuft in Transaktionen, die
 * zurückgerollt werden; der Test hinterlässt nichts.
 *
 * Was App- und Jobs-Rolle im Schema dürfen, prüft `auth-responsibility.test.ts` auf dem Wegwerf-Cluster mit den Rollen und Vorlagen des
 * VPS (bis WI-0189 hier per `SET ROLE` in Handrollen aus `scripts/dev/provision-auth-grants.ps1`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const GRANTS_FILE = fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url));
const ROLLBACK = "__zurueck__";

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Schema avesmaps_auth", { timeout: 45_000 }, () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    /** Führt `work` in einer Transaktion aus und rollt immer zurück. */
    async function rolledBack<T>(work: (tx: Database) => Promise<T>): Promise<T> {
        let result: T | undefined;
        try {
            await database.begin(async (tx) => {
                result = await work(tx as unknown as Database);
                throw new Error(ROLLBACK);
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
        }
        return result as T;
    }

    /** SQLSTATE einer Anweisung, die scheitern soll, ohne die Transaktion zu zerstören. */
    async function sqlState(tx: Database, sql: string): Promise<string> {
        await tx.unsafe("SAVEPOINT probe");
        try {
            await tx.unsafe(sql);
            await tx.unsafe("RELEASE SAVEPOINT probe");
            return "ok";
        } catch (error) {
            await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
            return (error as { code?: string }).code ?? "fehler";
        }
    }

    async function insertPerson(tx: Database, name = "Rondrikan"): Promise<string> {
        const [row] = await tx<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, created_via) VALUES (${name}, 'system') RETURNING id
        `;
        return row!.id;
    }

    it("🔴 jede Tabelle des Schemas steht in auth-grants.psql (fail-closed, keine vergessene Tabelle)", async () => {
        const grants = await readFile(GRANTS_FILE, "utf8");
        const tables = await database<{ name: string }[]>`
            SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'avesmaps_auth' AND c.relkind IN ('r', 'p') ORDER BY 1
        `;
        expect(tables.length).toBeGreaterThanOrEqual(13);
        const missing = tables
            .map((table) => table.name)
            .filter((name) => !grants.includes(`'${name}'`) && !grants.includes(`avesmaps_auth.${name}`));
        expect(missing).toEqual([]);
    });

    it("🔴 jede Funktion mit SECURITY DEFINER im Schema: in auth-grants.psql genannt, fester Suchpfad, PUBLIC ohne EXECUTE", async () => {
        const grants = await readFile(GRANTS_FILE, "utf8");
        const functions = await database<{ signature: string; config: string[] | null; open: boolean }[]>`
            SELECT p.oid::regprocedure::text AS signature, p.proconfig AS config,
                   has_function_privilege('public', p.oid, 'EXECUTE') AS open
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'avesmaps_auth' AND p.prosecdef ORDER BY 1
        `;
        // Die Karten gültiger Zugänge für den SVG-Bau (0324, Jobs-Rolle), Aufbewahrung (0082, Jobs-Rolle) und Schwärzen beim Auflösen (0083, App-Rolle).
        expect(functions.map((row) => row.signature)).toEqual([
            "avesmaps_auth.karten_zugang_karten()",
            "avesmaps_auth.purge_expired()",
            "avesmaps_auth.redact_person_events(uuid)",
        ]);
        for (const row of functions) {
            expect(grants, row.signature).toContain(`GRANT EXECUTE ON FUNCTION ${row.signature} TO`);
            expect({ config: row.config, open: row.open }, row.signature).toEqual({
                config: ["search_path=pg_catalog, pg_temp"],
                open: false,
            });
        }
    });

    it("🔴 die Revision zählt der Trigger, nicht die Anwendung (ADR-0020)", async () => {
        const revisions = await rolledBack(async (tx) => {
            const id = await insertPerson(tx);
            await tx`UPDATE avesmaps_auth.person SET display_name = 'Rondrikan II' WHERE id = ${id}`;
            await tx`UPDATE avesmaps_auth.person SET display_name = 'Rondrikan III', revision = 99 WHERE id = ${id}`;
            const [row] = await tx<{ revision: string }[]>`SELECT revision FROM avesmaps_auth.person WHERE id = ${id}`;
            return Number(row!.revision);
        });
        expect(revisions).toBe(3);
    });

    it("🔴 Discord-ID und Benutzername sind eindeutig, Hashes haben 32 Byte, Passwörter sind Argon2id", async () => {
        const states = await rolledBack(async (tx) => {
            const a = await insertPerson(tx, "A");
            const b = await insertPerson(tx, "B");
            const hash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA";
            return {
                discord: [
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES ('${a}', '123456789012345678')`,
                    ),
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES ('${b}', '123456789012345678')`,
                    ),
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES ('${b}', 'rondrikan')`,
                    ),
                ],
                login: [
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash) VALUES ('${a}', 'rondrikan', '${hash}')`,
                    ),
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash) VALUES ('${b}', 'rondrikan', '${hash}')`,
                    ),
                    await sqlState(
                        tx,
                        `INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash) VALUES ('${b}', 'hesindiane', 'klartext')`,
                    ),
                ],
                session: await sqlState(
                    tx,
                    `INSERT INTO avesmaps_auth.session (token_hash, person_id, environment, method, assurance, idle_expires_at, expires_at)
                     VALUES ('\\x00ff'::bytea, '${a}', 'test', 'password', 'basic', now(), now())`,
                ),
            };
        });
        expect(states.discord).toEqual(["ok", "23505", "23514"]);
        expect(states.login).toEqual(["ok", "23505", "23514"]);
        expect(states.session).toBe("23514");
    });

    it("🔴 ein Sonderrecht ist je Person und Umgebung höchstens einmal aktiv", async () => {
        const states = await rolledBack(async (tx) => {
            const a = await insertPerson(tx);
            const grant = `INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason) VALUES ('${a}', 'test', 'manage_system_settings', 'Vertretung')`;
            const first = await sqlState(tx, grant);
            const second = await sqlState(tx, grant);
            await tx.unsafe(`UPDATE avesmaps_auth.capability_grant SET revoked_at = now() WHERE person_id = '${a}'`);
            const again = await sqlState(tx, grant);
            return [first, second, again];
        });
        expect(states).toEqual(["ok", "23505", "ok"]);
    });

    it("🔴 die Aufbewahrung läuft mit den Rechten ihres Besitzers, mit festem Suchpfad, und PUBLIC darf sie nicht rufen", async () => {
        const [row] = await database<{ definer: boolean; config: string[] | null; open: boolean }[]>`
            SELECT p.prosecdef AS definer, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS open
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'avesmaps_auth' AND p.proname = 'purge_expired'
        `;
        expect(row).toEqual({ definer: true, config: ["search_path=pg_catalog, pg_temp"], open: false });
    });
});
