import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { socketOption } from "./support/vps-cluster.ts";

/**
 * Jede Kachelfunktion läuft als Kachel-Rolle, so wie auf dem VPS (Hotfix Stage, WI-0062 Nachtrag
 * „Rechte der Kachelfunktionen“).
 *
 * 💣 Anlass: Auf Stage antworteten `territory_tile` und `territory_border_tile` mit 500, „permission
 * denied for function territory_band_for_zoom“. Lokal fiel es nicht auf, weil Martin hier als
 * Eigentümer verbindet, und kein Test rief eine Kachelfunktion als Kachel-Rolle auf.
 *
 * ⭐ Der Test stellt die Umgebung des VPS nach, statt sie zu beschreiben: ein Wegwerf-Cluster mit
 * den drei Rollen (`migrate`, `app`, `tiles`), die Migrationen als `migrate`, dann GENAU die
 * Anweisungen des Rechtewerkzeugs (`grants_sql_tmpl` in `ops/runtime/runtime-foundation.sh`, hier
 * gelesen und mit einer kleinen `\gexec`-Nachbildung ausgeführt, kein Abschrift). Danach ruft er jede
 * Funktion mit Martin-Signatur als `tiles` auf. Ändert jemand das Werkzeug, ändert sich dieser Test mit.
 *
 * 🪤 Ein Wegwerf-Cluster, weil die Rolle der Testdatenbank keine Rollen anlegen darf (CREATEROLE)
 * und PUBLIC dort noch EXECUTE auf neue Funktionen hat: die Datenbank, gegen die alle anderen Tests
 * laufen, kann diesen Fehler nicht zeigen. Ohne PostgreSQL-Binärdateien (`initdb`, `pg_ctl`) und
 * PostGIS im selben Paket wird der Test sichtbar übersprungen, nicht still grün.
 */

const ENV = "tilegrants";
const MIGRATE_ROLE = `avesmaps3d_${ENV}_migrate`;
const APP_ROLE = `avesmaps3d_${ENV}_app`;
const TILES_ROLE = `avesmaps3d_${ENV}_tiles`;
const DATABASE_NAME = `avesmaps3d_${ENV}`;

const exe = process.platform === "win32" ? ".exe" : "";

function findPostgresBin(): string | undefined {
    const candidates = [
        process.env["PG_BIN_DIR"],
        "C:/tools/pgsql-18/bin",
        "/usr/lib/postgresql/18/bin",
        ...(process.env["PATH"] ?? "").split(delimiter),
    ];
    return candidates.find(
        (directory) =>
            directory !== undefined &&
            directory !== "" &&
            existsSync(join(directory, `initdb${exe}`)) &&
            existsSync(join(directory, `pg_ctl${exe}`)),
    );
}

const postgresBin = findPostgresBin();
const describeWithCluster = postgresBin ? describe : describe.skip;

const foundationScript = fileURLToPath(new URL("../../../ops/runtime/runtime-foundation.sh", import.meta.url));

interface GrantStatement {
    sql: string;
    /** psql: die Ausgabe der Abfrage ist selbst die Liste der auszuführenden Anweisungen. */
    gexec: boolean;
}

/** `grants_sql_tmpl` aus dem Werkzeug, mit `${e}` ersetzt und in einzelne Anweisungen zerlegt. */
function readGrantStatements(): GrantStatement[] {
    const script = readFileSync(foundationScript, "utf8").replace(/\r\n/g, "\n");
    const template = /grants_sql_tmpl\(\) \{[^\n]*\n\s*cat <<'SQL'\n([\s\S]*?)\nSQL\n/.exec(script)?.[1];
    if (!template) {
        throw new Error("grants_sql_tmpl steht nicht mehr in ops/runtime/runtime-foundation.sh");
    }
    const statements: GrantStatement[] = [];
    let pending: string[] = [];
    for (const line of template.replace(/\$\{e\}/g, ENV).split("\n")) {
        if (/^\s*--/.test(line) || line.trim() === "") {
            continue;
        }
        pending.push(line);
        if (/\\gexec\s*$/.test(line)) {
            statements.push({ sql: pending.join("\n").replace(/\\gexec\s*$/, ""), gexec: true });
            pending = [];
        } else if (/;\s*$/.test(line)) {
            statements.push({ sql: pending.join("\n"), gexec: false });
            pending = [];
        }
    }
    if (pending.length > 0) {
        throw new Error(`grants_sql_tmpl: Anweisung ohne Ende: ${pending.join(" ")}`);
    }
    return statements;
}

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                address && typeof address === "object" ? resolve(address.port) : reject(new Error("kein Port")),
            );
        });
    });
}

describeWithCluster("Kachelfunktionen als Kachel-Rolle (Wegwerf-Cluster wie der VPS)", () => {
    const bin = (name: string): string => join(postgresBin as string, `${name}${exe}`);
    let root = "";
    let dataDirectory = "";
    let port = 0;
    let started = false;
    let admin: Database | undefined;
    let migrator: Database | undefined;
    let tiles: Database | undefined;
    let statements: GrantStatement[] = [];

    const url = (user: string, database: string): string => `postgres://${user}@127.0.0.1:${port}/${database}`;

    /** Wie `avesmaps3d-db-grants`: als Superuser, nach jeder Migration. */
    async function applyGrants(): Promise<void> {
        for (const statement of statements) {
            if (statement.gexec) {
                const rows = await (admin as Database).unsafe(statement.sql);
                for (const row of rows) {
                    await (admin as Database).unsafe(String(Object.values(row)[0]));
                }
            } else {
                await (admin as Database).unsafe(statement.sql);
            }
        }
    }

    /** Ein Aufruf als Kachel-Rolle, z5/17/15; Fehler kommen als Text zurück statt zu werfen. */
    async function callAsTiles(name: string, withQuery: boolean): Promise<string | undefined> {
        const call = withQuery ? `${name}(5, 17, 15, '{}'::json)` : `${name}(5, 17, 15)`;
        try {
            await (tiles as Database).unsafe(`SELECT length(${call})`);
            return undefined;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    beforeAll(async () => {
        statements = readGrantStatements();
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-tilegrants-"));
        dataDirectory = join(root, "data");
        port = await freePort();
        // `stdio: "ignore"`: postgres hält sonst die geerbte Pipe offen, und der Aufruf hängt.
        execFileSync(
            bin("initdb"),
            ["-D", dataDirectory, "-U", "postgres", "--auth=trust", "--locale=C", "--encoding=UTF8"],
            {
                stdio: "ignore",
            },
        );
        execFileSync(
            bin("pg_ctl"),
            [
                "-D",
                dataDirectory,
                "-o",
                `-p ${port} -c listen_addresses=127.0.0.1${socketOption(root)} -c fsync=off -c synchronous_commit=off`,
                "-l",
                join(root, "postgres.log"),
                "-w",
                "start",
            ],
            { stdio: "ignore" },
        );
        started = true;

        // Bereitstellung wie `sql_env` im Werkzeug (run-sql-test.sh prüft dort das Original): drei Rollen
        // ohne Sonderrechte, Datenbank der Migrations-Rolle, PUBLIC ohne Zugriff, kein EXECUTE für PUBLIC
        // auf Funktionen der Migrations-Rolle.
        const postgres = createDatabase(url("postgres", "postgres"), { max: 1 });
        for (const role of [MIGRATE_ROLE, APP_ROLE, TILES_ROLE]) {
            await postgres.unsafe(
                `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
            );
        }
        await postgres.unsafe(
            `CREATE DATABASE ${DATABASE_NAME} OWNER ${MIGRATE_ROLE} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
        );
        await postgres.unsafe(`REVOKE ALL ON DATABASE ${DATABASE_NAME} FROM PUBLIC`);
        await postgres.unsafe(
            `GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${MIGRATE_ROLE}, ${APP_ROLE}, ${TILES_ROLE}`,
        );
        await postgres.end({ timeout: 5 });

        admin = createDatabase(url("postgres", DATABASE_NAME), { max: 1 });
        await admin.unsafe("CREATE EXTENSION IF NOT EXISTS postgis");
        await admin.unsafe("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await admin.unsafe(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
        await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}, ${TILES_ROLE}`);
        await admin.unsafe(
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
        );
        await admin.unsafe(
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${APP_ROLE}`,
        );
        await admin.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
        await admin.unsafe(
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${APP_ROLE}`,
        );
        await admin.unsafe(
            `GRANT SELECT ON spatial_ref_sys, geometry_columns, geography_columns TO ${APP_ROLE}, ${TILES_ROLE}`,
        );

        migrator = createDatabase(url(MIGRATE_ROLE, DATABASE_NAME), { max: 1 });
        await migrate(migrator);
        await applyGrants();
        tiles = createDatabase(url(TILES_ROLE, DATABASE_NAME), { max: 1 });
    }, 120_000);

    afterAll(async () => {
        await Promise.all([tiles?.end({ timeout: 5 }), migrator?.end({ timeout: 5 }), admin?.end({ timeout: 5 })]);
        if (started) {
            execFileSync(bin("pg_ctl"), ["-D", dataDirectory, "-m", "immediate", "stop"], { stdio: "ignore" });
        }
        if (root !== "") {
            await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        }
    }, 60_000);

    it("🔴 führt jede Kachelfunktion als Kachel-Rolle ohne Rechtefehler aus", async () => {
        // Die Funktionen, die Martin an ihrer Signatur findet: (z, x, y[, query json]) -> bytea. Dieselbe
        // Auswahl wie im Rechtewerkzeug.
        const functions = await (admin as Database)<{ proname: string; pronargs: number }[]>`
            SELECT p.proname, p.pronargs
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'bytea'::regtype
              AND pg_get_userbyid(p.proowner) = ${MIGRATE_ROLE}
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
              AND p.pronargs IN (3, 4) AND p.proargtypes[0] = 'integer'::regtype AND p.proargtypes[1] = 'integer'::regtype
              AND p.proargtypes[2] = 'integer'::regtype AND (p.pronargs = 3 OR p.proargtypes[3] = 'json'::regtype)
            ORDER BY p.proname
        `;
        const names = functions.map((row) => row.proname);
        // Eine leere Menge wäre grün, ohne etwas zu prüfen.
        expect(names, "Martin findet die bekannten Kachelfunktionen").toEqual(
            expect.arrayContaining([
                "landscape_label_run_tile",
                "path_label_run_tile",
                "terrain_contour_tile",
                "territory_border_tile",
                "territory_tile",
            ]),
        );

        const failures: string[] = [];
        for (const row of functions) {
            const message = await callAsTiles(row.proname, row.pronargs === 4);
            if (message !== undefined) {
                failures.push(`${row.proname}: ${message}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it("🪤 das Attribut gehört an die KACHELFUNKTION: SECURITY DEFINER an der Hilfsfunktion hilft nicht", async () => {
        // Die Lage von `territory_tile`, nachgebaut: eine Kachelfunktion ruft in PL/pgSQL eine eigene
        // Hilfsfunktion auf. Das Rechtewerkzeug findet den Aufruf nicht (er steht in keiner `pg_depend`).
        const db = migrator as Database;
        try {
            await db.unsafe(`
                CREATE FUNCTION probe_tile_helper(z integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT z $$;
                CREATE FUNCTION probe_tile(z integer, x integer, y integer) RETURNS bytea LANGUAGE plpgsql STABLE AS $$
                DECLARE wanted integer := probe_tile_helper(z);
                BEGIN RETURN ''::bytea; END;
                $$;
            `);
            await applyGrants();
            expect(
                await callAsTiles("probe_tile", false),
                "als Aufrufer scheitert der Aufruf der Hilfsfunktion",
            ).toMatch(/permission denied for function probe_tile_helper/);

            // Das Attribut an der Hilfsfunktion ändert, mit wessen Rechten ihr Rumpf läuft, nicht, wer sie
            // aufrufen darf. Der Aufruf kommt weiter von der Kachel-Rolle.
            await db.unsafe(
                "ALTER FUNCTION probe_tile_helper(integer) SECURITY DEFINER SET search_path = public, pg_temp",
            );
            await applyGrants();
            expect(await callAsTiles("probe_tile", false), "Hilfsfunktion allein reicht nicht").toMatch(
                /permission denied for function probe_tile_helper/,
            );

            // An der Kachelfunktion läuft der Rumpf als Eigentümerin: der Aufruf der Hilfsfunktion kommt von ihr.
            await db.unsafe(
                "ALTER FUNCTION probe_tile(integer, integer, integer) SECURITY DEFINER SET search_path = public, pg_temp",
            );
            await applyGrants();
            expect(await callAsTiles("probe_tile", false), "Kachelfunktion mit SECURITY DEFINER läuft").toBeUndefined();
        } finally {
            await db.unsafe("DROP FUNCTION IF EXISTS probe_tile(integer, integer, integer)");
            await db.unsafe("DROP FUNCTION IF EXISTS probe_tile_helper(integer)");
        }
    });
});
