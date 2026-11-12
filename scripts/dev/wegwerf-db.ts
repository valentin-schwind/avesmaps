// Ein Wegwerf-Postgres für die Datenbanktests (WI-0224, Hauptorchestrierung 2026-10-18).
//
// 🔴 Anlass: 192 von 726 Testdateien brauchen eine Datenbank (187 die Testdatenbank, 5 die Entwicklungsdatenbank) und liefen in keinem
// automatischen Lauf: `vor-dem-push` nahm dem Testlauf die Datenbank, die Prüfung nach dem Push läuft ohne, ein Worktree hat kein `.env`.
// Ein seit D2 roter Test blieb so unbemerkt. Dieser Cluster gibt jedem Lauf eine eigene, leere Testdatenbank, ohne die geteilte
// Entwicklungs- oder Testdatenbank anzufassen.
//
// Rezept wie `scripts/dev/install-toolchain.ps1` (Rolle `avesmaps3d` ohne Sonderrechte als Besitzer der Datenbank `avesmaps3d_test`,
// PostGIS vom Superuser angelegt); die Tests spielen die Migrationen selbst ein (`migrate(database)` in jedem `beforeAll`, mit Journal).
//
// 🪤 `postgres.exe` wird DIREKT gestartet, nicht über `pg_ctl start`: Dann ist dieser Prozess der Besitzer, und `wegwerf-cluster.ts`
// (räumt Postmaster auf, deren Besitzer tot ist und an denen keine Verbindung offen ist) hält den laufenden Cluster nicht für verwaist.
// Bricht dieser Prozess hart ab, bleibt der Postmaster stehen; der nächste Lauf räumt ihn auf (Verzeichnis `<Temp>\avesmaps3d-testdb-…`).
// 🪤 `stdio: "ignore"` (keine Pipe): postgres hält eine geerbte Pipe offen, und der Aufrufer hängt.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WEGWERF_ROLLE = "avesmaps3d";
export const WEGWERF_DATENBANK = "avesmaps3d_test";

const exe = process.platform === "win32" ? ".exe" : "";

/**
 * Das Verzeichnis der PostgreSQL-Programme (`initdb`, `postgres`, `pg_ctl`, `psql`, `pg_isready`), wie `vps-cluster.ts` sie sucht:
 * `PG_BIN_DIR`, der Windows-Standard, der Linux-Standard, dann der Suchpfad. `undefined`, wenn keines vollständig ist.
 */
export function findePostgres(
    env: NodeJS.ProcessEnv = process.env,
    gibtEs: (pfad: string) => boolean = existsSync,
): string | undefined {
    const kandidaten = [
        env["PG_BIN_DIR"],
        "C:/tools/pgsql-18/bin",
        "/usr/lib/postgresql/18/bin",
        ...(env["PATH"] ?? "").split(delimiter),
    ];
    return kandidaten.find(
        (ordner) =>
            ordner !== undefined &&
            ordner !== "" &&
            ["initdb", "postgres", "pg_ctl", "psql", "pg_isready"].every((programm) =>
                gibtEs(join(ordner, `${programm}${exe}`)),
            ),
    );
}

/** Die Umgebung der Testläufe mit der Wegwerf-Datenbank: die Testdatenbank gesetzt, jede andere Datenbank des Aufrufers weg. */
export function umgebungMitTestdatenbank(env: NodeJS.ProcessEnv, url: string): NodeJS.ProcessEnv {
    const neu = { ...env };
    for (const name of ["DATABASE_URL", "JOBS_DATABASE_URL", "KANAL_DATABASE_URL"]) delete neu[name];
    neu["TEST_DATABASE_URL"] = url;
    return neu;
}

export interface WegwerfDb {
    /** Die Verbindung für `TEST_DATABASE_URL`. */
    readonly url: string;
    readonly port: number;
    /** Das Verzeichnis des Clusters (darunter `data` und das Protokoll). */
    readonly verzeichnis: string;
    /** Beendet den Cluster und löscht sein Verzeichnis; mehrfach aufrufbar. */
    stoppe(): void;
}

function freierPort(): Promise<number> {
    return new Promise((erfuellt, abgelehnt) => {
        const server = net.createServer();
        server.once("error", abgelehnt);
        server.listen(0, "127.0.0.1", () => {
            const adresse = server.address();
            const port = typeof adresse === "object" && adresse !== null ? adresse.port : 0;
            server.close(() => (port > 0 ? erfuellt(port) : abgelehnt(new Error("kein freier Port"))));
        });
    });
}

function warte(ms: number): Promise<void> {
    return new Promise((erfuellt) => setTimeout(erfuellt, ms));
}

/** Das Ende des Protokolls für die Fehlermeldung. */
function protokollEnde(datei: string): string {
    try {
        return readFileSync(datei, "utf8")
            .split(/\r?\n/)
            .filter((z) => z.trim() !== "")
            .slice(-8)
            .join(" | ");
    } catch {
        return "(kein Protokoll)";
    }
}

/** Das Skript, das Migrationen und Kartendomänen eines Stands einspielt (`wegwerf-db-saat.ts`). */
const SAAT_SKRIPT = fileURLToPath(new URL("./wegwerf-db-saat.ts", import.meta.url));

/**
 * Spielt die Migrationen und die Kartendomänen eines Stands in eine bestehende Datenbank ein (`wegwerf-db-saat.ts`). Auch auf einer Datenbank
 * mit Bestand richtig: `migrate` wendet nur die noch fehlenden Migrationen an (ein Prüfsummen-Widerspruch bei einer schon angewendeten bricht
 * ab) und `seedMapDomains` ist ein Upsert; es ist derselbe Schritt, den `db/cli.ts` bei Stage und Production nach einem Update ausführt (WI-0248).
 */
export function spieleSaatEin(wurzel: string, url: string): void {
    const saat = spawnSync(process.execPath, [SAAT_SKRIPT, wurzel], {
        cwd: wurzel,
        env: { ...process.env, TEST_DATABASE_URL: url },
        encoding: "utf8",
    });
    if (saat.status !== 0) {
        const ende = `${saat.stdout}\n${saat.stderr}`.trim().split(/\r?\n/).slice(-6).join(" | ");
        throw new Error(`Migrationen und Kartendomänen nicht eingespielt: ${ende}`);
    }
}

/**
 * Startet einen Cluster mit Testdatenbank und PostGIS; wirft mit dem Ende des Protokolls, wenn er nicht hochkommt. Mit `saat` (die Wurzel
 * eines Stands) spielt er danach dessen Migrationen und die Kartendomänen ein, wie `db/cli.ts` es für eine echte Datenbank tut: Ohne die
 * Kartendomänen scheitern Tests, die keine selbst anlegen (Fremdschlüssel `map_domain_id`); gemessen 2026-10-18 an sechs Dateien.
 */
export async function starteWegwerfDb(optionen: {
    /** Das Verzeichnis der PostgreSQL-Programme (`findePostgres`). */
    readonly bin: string;
    readonly temp?: string;
    /** Die Wurzel des Stands (Arbeitskopie oder Kopie), dessen Migrationen und Kartendomänen eingespielt werden; ohne: leere Datenbank. */
    readonly saat?: string;
}): Promise<WegwerfDb> {
    const { bin } = optionen;
    const programm = (name: string): string => join(bin, `${name}${exe}`);
    const verzeichnis = mkdtempSync(join(optionen.temp ?? tmpdir(), "avesmaps3d-testdb-"));
    const daten = join(verzeichnis, "data");
    const protokoll = join(verzeichnis, "postgres.log");
    let kind: ChildProcess | undefined;
    let gestoppt = false;

    const stoppe = (): void => {
        if (gestoppt) return;
        gestoppt = true;
        if (kind !== undefined && kind.exitCode === null) {
            spawnSync(programm("pg_ctl"), ["stop", "-D", daten, "-m", "immediate", "-t", "30"], { stdio: "ignore" });
            if (kind.exitCode === null) kind.kill();
        }
        try {
            rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        } catch {
            // Ein Rest im Temp-Ordner ist harmlos; der Cluster selbst ist beendet.
        }
    };
    process.once("exit", stoppe);

    try {
        const init = spawnSync(
            programm("initdb"),
            ["-D", daten, "-U", "postgres", "--auth=trust", "--locale=C", "--encoding=UTF8"],
            { stdio: "ignore" },
        );
        if (init.status !== 0) throw new Error(`initdb scheiterte (Status ${String(init.status)})`);
        const port = await freierPort();
        const log = openSync(protokoll, "a");
        try {
            kind = spawn(
                programm("postgres"),
                [
                    "-D",
                    daten,
                    "-p",
                    String(port),
                    "-c",
                    "listen_addresses=127.0.0.1",
                    ...(process.platform === "win32" ? [] : ["-k", verzeichnis]),
                    "-c",
                    "fsync=off",
                    "-c",
                    "synchronous_commit=off",
                    "-c",
                    "full_page_writes=off",
                    "-c",
                    "max_connections=200",
                ],
                { stdio: ["ignore", log, log], windowsHide: true },
            );
        } finally {
            closeSync(log);
        }
        const start = Date.now();
        for (;;) {
            if (kind.exitCode !== null) {
                throw new Error(`postgres endete vor dem Start: ${protokollEnde(protokoll)}`);
            }
            const bereit = spawnSync(programm("pg_isready"), ["-h", "127.0.0.1", "-p", String(port)], {
                stdio: "ignore",
            });
            if (bereit.status === 0) break;
            if (Date.now() - start > 60_000)
                throw new Error(`postgres kam in 60 s nicht hoch: ${protokollEnde(protokoll)}`);
            await warte(250);
        }
        const psql = (datenbank: string, sql: string): void => {
            const lauf = spawnSync(
                programm("psql"),
                [
                    "-h",
                    "127.0.0.1",
                    "-p",
                    String(port),
                    "-U",
                    "postgres",
                    "-d",
                    datenbank,
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-c",
                    sql,
                ],
                { encoding: "utf8" },
            );
            if (lauf.status !== 0) throw new Error(`psql scheiterte bei „${sql}“: ${(lauf.stderr ?? "").trim()}`);
        };
        psql("postgres", `CREATE ROLE ${WEGWERF_ROLLE} LOGIN`);
        psql(
            "postgres",
            `CREATE DATABASE ${WEGWERF_DATENBANK} OWNER ${WEGWERF_ROLLE} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
        );
        psql(WEGWERF_DATENBANK, "CREATE EXTENSION postgis");
        const url = `postgres://${WEGWERF_ROLLE}@127.0.0.1:${String(port)}/${WEGWERF_DATENBANK}`;
        if (optionen.saat !== undefined) spieleSaatEin(optionen.saat, url);
        return {
            url,
            port,
            verzeichnis,
            stoppe,
        };
    } catch (fehler) {
        stoppe();
        throw fehler;
    }
}
