import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "../../src/database.ts";
import { migrate, migrationVersionen } from "../../src/db/migrate.ts";
import { seedMapDomains } from "../../src/db/seed-map-domains.ts";
import { spieleTestpaketEin } from "../../../../scripts/dev/release-testpaket.ts";

/**
 * Ein Wegwerf-Cluster mit den Rollen und Rechten des VPS (Muster `media-mam-grants.test.ts`, `tile-function-grants.test.ts`): alle
 * Rollen einer Umgebung, die das Werkzeug und die Vorlagen kennen (`ROLLEN`), die Default-Privilegien aus `sql_env` (gelesen, nicht
 * abgeschrieben, WI-0189), die Migrationen als `migrate`, dann
 * GENAU die Anweisungen des Rechtewerkzeugs (`grants_sql_tmpl` in `ops/runtime/runtime-foundation.sh`) und danach die Vorlagen unter
 * `apps/server/src/db/*.psql`, die Claudio übernimmt. Gelesen und mit einer kleinen `\gexec`-Nachbildung ausgeführt, keine Abschrift.
 *
 * 🪤 Ein Wegwerf-Cluster, weil die Rolle der Testdatenbank keine Rollen anlegen darf und dort die Default-Privilegien des VPS fehlen.
 * Ohne PostgreSQL-Binärdateien (`initdb`, `pg_ctl`) und PostGIS im selben Paket gibt `postgresBin` `undefined`: Der Test überspringt
 * sichtbar, statt still grün zu sein.
 */

export const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
export type Privilege = (typeof PRIVILEGES)[number];

/**
 * Die Rollen einer Umgebung auf dem VPS: `migrate`, `app`, `tiles` legt `sql_env` an, die übrigen `jobs-setup.sh`, `--set-news-agent`,
 * `--set-kanal-agent` und `dirigent-setup.sh`. Alle hier, damit jede Zeile der Vorlagen auch wirkt: Eine Vorlage überspringt eine fehlende
 * Rolle still, und dann prüfte kein Test ihre Rechte (Review L6-02).
 */
export const ROLLEN = ["migrate", "app", "tiles", "jobs", "news", "claudia", "claudio", "queue_read"] as const;
export type Rolle = (typeof ROLLEN)[number];

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

export const postgresBin = findPostgresBin();

/**
 * Unix-Socket im Wegwerf-Verzeichnis statt im Standard `/var/run/postgresql`: Den darf auf dem VPS nur die Gruppe `postgres`
 * beschreiben, und ohne einen Socket startet postgres gar nicht (Prüfung nach dem Push auf dem Server, Claudio 2026-10-17).
 * Verbunden wird weiter über TCP; unter Windows bleibt es beim Vorgabewert (kein Socket).
 */
export function socketOption(root: string): string {
    return process.platform === "win32" ? "" : ` -k ${root}`;
}

const foundationScript = fileURLToPath(new URL("../../../../ops/runtime/runtime-foundation.sh", import.meta.url));

interface GrantStatement {
    sql: string;
    /** psql: die Ausgabe der Abfrage ist selbst die Liste der auszuführenden Anweisungen. */
    gexec: boolean;
}

/** Zerlegt psql-Text (Kommentarzeilen weg, `${e}` ersetzt) in Anweisungen; `\gexec` beendet wie `;`. */
function splitPsql(text: string, source: string, environment: string): GrantStatement[] {
    const statements: GrantStatement[] = [];
    let pending: string[] = [];
    for (const line of text
        .replace(/\r\n/g, "\n")
        .replace(/\$\{e\}/g, environment)
        .split("\n")) {
        if (/^\s*--/.test(line) || line.trim() === "") continue;
        pending.push(line);
        if (/\\gexec\s*$/.test(line)) {
            statements.push({ sql: pending.join("\n").replace(/\\gexec\s*$/, ""), gexec: true });
            pending = [];
        } else if (/;\s*$/.test(line)) {
            statements.push({ sql: pending.join("\n"), gexec: false });
            pending = [];
        }
    }
    if (pending.length > 0) throw new Error(`${source}: Anweisung ohne Ende: ${pending.join(" ")}`);
    return statements;
}

/**
 * Die Anweisungen von `sql_env` in der Datenbank der Umgebung (Schema, Default-Privilegien, PostGIS-Tafeln), ohne Rollen, Passwörter
 * und die Sonde von Martin: der Block zwischen der Zeile `\\connect $db` und `OPS-PROBE-BEGIN`, mit den Rollennamen dieses Clusters.
 */
function databaseStatements(environment: string, roles: Readonly<Record<Rolle, string>>): GrantStatement[] {
    const script = readFileSync(foundationScript, "utf8").replace(/\r\n/g, "\n");
    const start = script.indexOf("\\\\connect $db\n", script.indexOf("sql_env() {"));
    const end = script.indexOf("-- OPS-PROBE-BEGIN", start);
    if (start < 0 || end < 0) throw new Error("sql_env steht nicht mehr in ops/runtime/runtime-foundation.sh");
    const sql = script
        .slice(script.indexOf("\n", start) + 1, end)
        .replace(/\$mig\b/g, roles.migrate)
        .replace(/\$app\b/g, roles.app)
        .replace(/\$til\b/g, roles.tiles);
    const unbekannt = /\$[a-z_]+/.exec(sql)?.[0];
    if (unbekannt) throw new Error(`sql_env enthält eine unbekannte Variable: ${unbekannt}`);
    return splitPsql(sql, "sql_env", environment);
}

function grantStatements(environment: string, templates: readonly string[]): GrantStatement[] {
    const script = readFileSync(foundationScript, "utf8").replace(/\r\n/g, "\n");
    const tool = /grants_sql_tmpl\(\) \{[^\n]*\n\s*cat <<'SQL'\n([\s\S]*?)\nSQL\n/.exec(script)?.[1];
    if (!tool) throw new Error("grants_sql_tmpl steht nicht mehr in ops/runtime/runtime-foundation.sh");
    return [
        ...splitPsql(tool, "grants_sql_tmpl", environment),
        ...templates.map((file) => splitPsql(readFileSync(file, "utf8"), file, environment)).flat(),
    ];
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

export interface VpsCluster {
    readonly roles: Readonly<Record<Rolle, string>>;
    /** Superuser in der Datenbank der Umgebung. */
    readonly admin: Database;
    /** Die Migrationsrolle (Besitzerin der Objekte). */
    readonly migrator: Database;
    /** Die App-Rolle, angemeldet wie Fastify und `avesmaps3d-auth <env>`. */
    readonly app: Database;
    /** Die Jobs-Rolle, angemeldet wie der Worker. */
    readonly jobs: Database;
    /** Was eine Rolle an einer Tabelle in `public` darf. */
    granted(role: string, table: string): Promise<Privilege[]>;
    /** SQLSTATE je Anweisung als diese Verbindung; jede in einem Sicherungspunkt, alles am Ende zurückgerollt. */
    codesAs(connection: Database, statements: string[]): Promise<string[]>;
    /** Das Rechtewerkzeug noch einmal, wie nach jeder Migration (etwa nachdem der Test eine Rolle wie `avesmaps3d_stats` angelegt hat). */
    regrant(): Promise<void>;
    /** Das Protokoll des Servers: Dort steht jeder Fehler, auch einer, den die Anwendung abfängt (`schreibwege-app-rolle.test.ts`). */
    readonly logFile: string;
    /** Der Dump, mit dem der Cluster gestartet wurde (`startVpsCluster`, Option `dump`); `undefined`: leere Datenbank mit den Migrationen. */
    readonly dump: string | undefined;
    stop(): Promise<void>;
}

/**
 * Prüft nach dem Einspielen eines Dumps, dass der Kandidat sein Migrationsjournal lesen kann (WI-0264 S2). `migrate` meldet einen
 * Prüfsummen-Widerspruch selbst; DAS fängt es nicht: eine Migration im Journal, die der Kandidat gar nicht kennt (der Dump stammt aus
 * einem neueren Stand). Dann liefe `migrate` stumm weiter und der Test prüfte ein Schema, das der Kandidat nicht beschreibt.
 */
export function pruefeDumpJournal(journal: readonly string[], kandidat: readonly string[], dump: string): void {
    if (journal.length === 0)
        throw new Error(`Dump ${dump}: schema_migration ist leer oder fehlt, kein Dump einer migrierten Datenbank`);
    const bekannt = new Set(kandidat);
    const fremd = journal.filter((version) => !bekannt.has(version));
    if (fremd.length > 0)
        throw new Error(
            `Dump ${dump} ist neuer als der Kandidat: ${String(fremd.length)} Migration(en) im Journal fehlen im Kandidaten (${fremd.slice(0, 5).join(", ")}${fremd.length > 5 ? ", …" : ""})`,
        );
}

/**
 * Startet den Cluster, legt Rollen und Datenbank an wie `sql_env`, migriert als `migrate` und vergibt die Rechte wie
 * `avesmaps3d-db-grants`: erst `grants_sql_tmpl`, dann `templates` (Pfade der Vorlagen unter `apps/server/src/db/`). Mit
 * `mapDomains` legt die Migrationsrolle danach die Kartendomänen an wie der Import.
 *
 * Mit `dump` (ein `pg_dump -Fc`, etwa `daten.dump` des Testpakets, WI-0264 S2) läuft zwischen `sql_env` und den Migrationen ein
 * Einspielen auf echten Daten: Der Dump kommt als `migrate` in die leere Datenbank (`spieleTestpaketEin`, dasselbe Einspielen wie im
 * Release-Test: ohne Besitzer und Rechte, Erweiterungen vom Superuser), die Besitzerin ist also die Migrationsrolle wie auf dem VPS. Danach
 * wendet `migrate` nur die Migrationen an, die der Dump noch nicht kennt, und das Rechtewerkzeug vergibt die Rechte (`regrant`). Journal und
 * Prüfsummen des Dumps prüft `pruefeDumpJournal` und `migrate` laut, nichts davon wird übersprungen.
 */
export async function startVpsCluster(
    environment: string,
    templates: readonly string[],
    options: { mapDomains?: boolean; dump?: string } = {},
): Promise<VpsCluster> {
    if (postgresBin === undefined) throw new Error("Keine PostgreSQL-Binärdateien gefunden");
    // Vor dem ersten Prozess: Ein falscher Pfad soll in einer Sekunde scheitern, nicht nach dem Anlauf eines Clusters.
    if (options.dump !== undefined && !existsSync(options.dump))
        throw new Error(`Dump nicht gefunden: ${options.dump}`);
    const bin = (name: string): string => join(postgresBin, `${name}${exe}`);
    const roles = Object.fromEntries(ROLLEN.map((rolle) => [rolle, `avesmaps3d_${environment}_${rolle}`])) as Record<
        Rolle,
        string
    >;
    const databaseName = `avesmaps3d_${environment}`;
    const root = await mkdtemp(join(tmpdir(), `avesmaps3d-${environment}-`));
    const dataDirectory = join(root, "data");
    const logFile = join(root, "postgres.log");
    const port = await freePort();
    const url = (user: string, database: string): string => `postgres://${user}@127.0.0.1:${port}/${database}`;
    const opened: Database[] = [];
    let started = false;
    const stop = async (): Promise<void> => {
        await Promise.all(opened.map((database) => database.end({ timeout: 5 })));
        if (started) execFileSync(bin("pg_ctl"), ["-D", dataDirectory, "-m", "immediate", "stop"], { stdio: "ignore" });
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    };
    try {
        // `stdio: "ignore"`: postgres hält sonst die geerbte Pipe offen, und der Aufruf hängt.
        execFileSync(
            bin("initdb"),
            ["-D", dataDirectory, "-U", "postgres", "--auth=trust", "--locale=C", "--encoding=UTF8"],
            { stdio: "ignore" },
        );
        execFileSync(
            bin("pg_ctl"),
            [
                "-D",
                dataDirectory,
                "-o",
                `-p ${port} -c listen_addresses=127.0.0.1${socketOption(root)} -c fsync=off -c synchronous_commit=off`,
                "-l",
                logFile,
                "-w",
                "start",
            ],
            { stdio: "ignore" },
        );
        started = true;

        // Bereitstellung wie `sql_env` im Werkzeug, dazu die Jobs-Rolle (ops/jobs/jobs-setup.sh legt sie dort an).
        const postgres = createDatabase(url("postgres", "postgres"), { max: 1 });
        for (const role of Object.values(roles)) {
            await postgres.unsafe(
                `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
            );
        }
        await postgres.unsafe(
            `CREATE DATABASE ${databaseName} OWNER ${roles.migrate} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
        );
        await postgres.unsafe(`REVOKE ALL ON DATABASE ${databaseName} FROM PUBLIC`);
        await postgres.unsafe(`GRANT CONNECT ON DATABASE ${databaseName} TO ${Object.values(roles).join(", ")}`);
        await postgres.end({ timeout: 5 });

        const admin = createDatabase(url("postgres", databaseName), { max: 1 });
        opened.push(admin);
        // Schema, Default-Privilegien und PostGIS-Tafeln genau wie `sql_env` (gelesen, WI-0189; vorher hier abgeschrieben).
        for (const statement of databaseStatements(environment, roles)) await admin.unsafe(statement.sql);

        const migrator = createDatabase(url(roles.migrate, databaseName), { max: 1 });
        opened.push(migrator);
        if (options.dump !== undefined) {
            // Als `migrate` in die Datenbank der Umgebung (nicht als Superuser): Besitz und Default-Privilegien wie bei den Migrationen.
            await spieleTestpaketEin({
                bin: postgresBin,
                url: url(roles.migrate, databaseName),
                port,
                datenbank: databaseName,
                dump: options.dump,
                arbeitsordner: root,
                env: process.env,
            });
            const journal = await migrator<{ version: string }[]>`SELECT version FROM schema_migration`.catch(
                (error: unknown) => {
                    // 42P01: keine Tabelle `schema_migration`; `pruefeDumpJournal` benennt das. Jeder andere Fehler bleibt ein Fehler.
                    if ((error as { code?: string }).code === "42P01") return [] as { version: string }[];
                    throw error;
                },
            );
            pruefeDumpJournal(
                journal.map((row) => row.version),
                await migrationVersionen(),
                options.dump,
            );
        }
        try {
            await migrate(migrator);
        } catch (error) {
            // Mit Dump heißt ein Fehler hier meist: Prüfsumme einer schon angewendeten Migration weicht ab, oder eine neue bricht an den Daten.
            if (options.dump === undefined) throw error;
            throw new Error(`Migrationen des Kandidaten auf dem Dump ${options.dump}: ${(error as Error).message}`, {
                cause: error,
            });
        }
        // Wie `avesmaps3d-db-grants`: als Superuser, nach der Migration.
        const regrant = async (): Promise<void> => {
            for (const statement of grantStatements(environment, templates)) {
                if (statement.gexec) {
                    const rows = await admin.unsafe(statement.sql);
                    for (const row of rows) await admin.unsafe(String(Object.values(row)[0]));
                } else {
                    await admin.unsafe(statement.sql);
                }
            }
        };
        await regrant();
        const app = createDatabase(url(roles.app, databaseName), { max: 2 });
        const jobs = createDatabase(url(roles.jobs, databaseName), { max: 1 });
        opened.push(app, jobs);
        if (options.mapDomains) await seedMapDomains(migrator);
        const granted = async (role: string, table: string): Promise<Privilege[]> => {
            const rows = await admin.unsafe<{ privilege: Privilege; ok: boolean }[]>(
                `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
                [role, `public.${table}`, [...PRIVILEGES]] as never[],
            );
            return rows.filter((row) => row.ok).map((row) => row.privilege);
        };
        const codesAs = async (connection: Database, statements: string[]): Promise<string[]> => {
            const codes: string[] = [];
            try {
                await connection.begin(async (tx) => {
                    for (const sql of statements) {
                        await tx.unsafe("SAVEPOINT probe");
                        try {
                            await tx.unsafe(sql);
                            await tx.unsafe("RELEASE SAVEPOINT probe");
                            codes.push("ok");
                        } catch (error) {
                            await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                            codes.push((error as { code?: string }).code ?? "fehler");
                        }
                    }
                    throw new Error("__zurueck__");
                });
            } catch (error) {
                if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
            }
            return codes;
        };
        return { roles, admin, migrator, app, jobs, granted, codesAs, regrant, logFile, dump: options.dump, stop };
    } catch (error) {
        await stop().catch(() => undefined);
        throw error;
    }
}
