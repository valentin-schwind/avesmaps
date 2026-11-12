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
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { socketOption } from "./support/vps-cluster.ts";

/**
 * Die Rechte an den MAM-Tabellen aus Migration 0086 (WI-0068 P1), so wie auf dem VPS.
 *
 * ⭐ Wie `tile-function-grants.test.ts`: ein Wegwerf-Cluster mit den Rollen des VPS (`migrate`, `app`, `tiles`, `jobs`) und den
 * Default-Privilegien aus `sql_env`, die Migrationen als `migrate`, dann GENAU die Anweisungen des Rechtewerkzeugs (`grants_sql_tmpl`
 * in `ops/runtime/runtime-foundation.sh`) und danach `apps/server/src/db/media-grants.psql`, die Vorlage für Claudios Zeilen. Gelesen
 * und mit einer kleinen `\gexec`-Nachbildung ausgeführt, keine Abschrift: Ändert jemand eine der beiden Dateien, ändert sich dieser Test
 * mit. Steht die Vorlage schon im Werkzeug, schadet der zweite Lauf nicht (REVOKE ist wiederholbar).
 *
 * 🔴 Die App darf an den Protokollen (Operation, Fachprotokoll, Provenienz) nur anhängen und am Notaus nie löschen; PUBLIC und die
 * Kachelrolle dürfen nichts, die Jobs-Rolle nur lesen. Jede Tabelle aus 0086 braucht hier eine Zusage, sonst fällt der Test.
 *
 * 🪤 Ein Wegwerf-Cluster, weil die Rolle der Testdatenbank keine Rollen anlegen darf und dort die Default-Privilegien des VPS fehlen.
 * Ohne PostgreSQL-Binärdateien (`initdb`, `pg_ctl`) und PostGIS im selben Paket wird der Test sichtbar übersprungen, nicht still grün.
 */

const ENV = "mamgrants";
const MIGRATE_ROLE = `avesmaps3d_${ENV}_migrate`;
const APP_ROLE = `avesmaps3d_${ENV}_app`;
const TILES_ROLE = `avesmaps3d_${ENV}_tiles`;
const JOBS_ROLE = `avesmaps3d_${ENV}_jobs`;
const DATABASE_NAME = `avesmaps3d_${ENV}`;

const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
type Privilege = (typeof PRIVILEGES)[number];

/** Was die App-Rolle an jeder Tabelle aus 0086 darf. Eine neue Tabelle ohne Zeile hier lässt den Test fallen. */
const APP_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    // Nur anhängen: ADR-0019 Nr. 2 und 5, WI-0068 §2 Nr. 7.
    media_operation: ["SELECT", "INSERT"],
    media_audit_event: ["SELECT", "INSERT"],
    media_ingest: ["SELECT", "INSERT"],
    // Setzen und aufheben, nie löschen: der Verlauf bleibt.
    media_publication_suspension: ["SELECT", "INSERT", "UPDATE"],
};

/**
 * Was die Jobs-Rolle daran darf: lesen, und seit dem Sammellauf der Duplikate (WI-0068, Migration 0151) Quittung und Fachprotokoll
 * anhängen; ändern oder löschen nie.
 */
const JOBS_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    media_operation: ["SELECT", "INSERT"],
    media_audit_event: ["SELECT", "INSERT"],
    media_ingest: ["SELECT"],
    media_publication_suspension: ["SELECT"],
};

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
const mediaGrants = fileURLToPath(new URL("../src/db/media-grants.psql", import.meta.url));
const migrationFile = fileURLToPath(new URL("../migrations/0086_media_mam.sql", import.meta.url));

interface GrantStatement {
    sql: string;
    /** psql: die Ausgabe der Abfrage ist selbst die Liste der auszuführenden Anweisungen. */
    gexec: boolean;
}

/** Zerlegt psql-Text (Kommentarzeilen weg, `${e}` ersetzt) in Anweisungen; `\gexec` beendet wie `;`. */
function splitPsql(text: string, source: string): GrantStatement[] {
    const statements: GrantStatement[] = [];
    let pending: string[] = [];
    for (const line of text
        .replace(/\r\n/g, "\n")
        .replace(/\$\{e\}/g, ENV)
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

function readGrantStatements(): GrantStatement[] {
    const script = readFileSync(foundationScript, "utf8").replace(/\r\n/g, "\n");
    const template = /grants_sql_tmpl\(\) \{[^\n]*\n\s*cat <<'SQL'\n([\s\S]*?)\nSQL\n/.exec(script)?.[1];
    if (!template) throw new Error("grants_sql_tmpl steht nicht mehr in ops/runtime/runtime-foundation.sh");
    return [
        ...splitPsql(template, "grants_sql_tmpl"),
        ...splitPsql(readFileSync(mediaGrants, "utf8"), "media-grants.psql"),
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

describeWithCluster("MAM-Tabellen: Rechte der Rollen wie auf dem VPS (Wegwerf-Cluster)", () => {
    const bin = (name: string): string => join(postgresBin as string, `${name}${exe}`);
    let root = "";
    let dataDirectory = "";
    let port = 0;
    let started = false;
    let admin: Database | undefined;
    let migrator: Database | undefined;
    let app: Database | undefined;
    let jobs: Database | undefined;

    const url = (user: string, database: string): string => `postgres://${user}@127.0.0.1:${port}/${database}`;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-mamgrants-"));
        dataDirectory = join(root, "data");
        port = await freePort();
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
                join(root, "postgres.log"),
                "-w",
                "start",
            ],
            { stdio: "ignore" },
        );
        started = true;

        // Bereitstellung wie `sql_env` im Werkzeug, dazu die Jobs-Rolle (ops/jobs/jobs-setup.sh legt sie dort an).
        const postgres = createDatabase(url("postgres", "postgres"), { max: 1 });
        for (const role of [MIGRATE_ROLE, APP_ROLE, TILES_ROLE, JOBS_ROLE]) {
            await postgres.unsafe(
                `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
            );
        }
        await postgres.unsafe(
            `CREATE DATABASE ${DATABASE_NAME} OWNER ${MIGRATE_ROLE} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
        );
        await postgres.unsafe(`REVOKE ALL ON DATABASE ${DATABASE_NAME} FROM PUBLIC`);
        await postgres.unsafe(
            `GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${MIGRATE_ROLE}, ${APP_ROLE}, ${TILES_ROLE}, ${JOBS_ROLE}`,
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
        // Wie `avesmaps3d-db-grants`: als Superuser, nach der Migration.
        for (const statement of readGrantStatements()) {
            if (statement.gexec) {
                const rows = await admin.unsafe(statement.sql);
                for (const row of rows) await admin.unsafe(String(Object.values(row)[0]));
            } else {
                await admin.unsafe(statement.sql);
            }
        }
        app = createDatabase(url(APP_ROLE, DATABASE_NAME), { max: 1 });
        jobs = createDatabase(url(JOBS_ROLE, DATABASE_NAME), { max: 1 });
        await seedMapDomains(migrator);
    }, 180_000);

    afterAll(async () => {
        await Promise.all([
            app?.end({ timeout: 5 }),
            jobs?.end({ timeout: 5 }),
            migrator?.end({ timeout: 5 }),
            admin?.end({ timeout: 5 }),
        ]);
        if (started) {
            execFileSync(bin("pg_ctl"), ["-D", dataDirectory, "-m", "immediate", "stop"], { stdio: "ignore" });
        }
        if (root !== "") {
            await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        }
    }, 60_000);

    async function granted(role: string, table: string): Promise<Privilege[]> {
        const rows = await (admin as Database).unsafe<{ privilege: Privilege; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
            [role, `public.${table}`, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    /** SQLSTATE einer Anweisung als App-Rolle; die Transaktion wird immer zurückgerollt. */
    const asApp = (statements: string[]): Promise<string[]> => asRole(app as Database, statements);

    /** Dasselbe als eine andere Rolle (Jobs-Rolle). */
    async function asRole(connection: Database, statements: string[]): Promise<string[]> {
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
    }

    it("jede Tabelle aus 0086 hat hier eine Zusage", () => {
        const created = [...readFileSync(migrationFile, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
            (match) => match[1] as string,
        );
        expect(created.sort()).toEqual(Object.keys(APP_MAY).sort());
    });

    it("🔴 die App darf an den Protokollen nur anhängen und am Notaus nie löschen; PUBLIC und Kachelrolle nichts, Jobs nur lesen und anhängen", async () => {
        for (const [table, may] of Object.entries(APP_MAY)) {
            expect(await granted(APP_ROLE, table), `App an ${table}`).toEqual(may);
            expect(await granted("public", table), `PUBLIC an ${table}`).toEqual([]);
            expect(await granted(TILES_ROLE, table), `Kachelrolle an ${table}`).toEqual([]);
            expect(await granted(JOBS_ROLE, table), `Jobs-Rolle an ${table}`).toEqual(JOBS_MAY[table]);
        }
        // Die bestehenden Medientabellen behalten, was sie hatten: Revision und Trigger brauchen kein neues Recht.
        for (const table of ["media_asset", "media_gallery", "media_gallery_item", "place_media", "publication_rule"]) {
            expect(await granted(APP_ROLE, table), table).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
        }
        // Typbilder (0113): die App schreibt die Tafel samt Folge, der Abgleich (Jobs-Rolle) liest sie über `readUsages`; der Sammellauf
        // der Duplikate (Jobs-Rolle, 0151) hängt den ★ um (UPDATE), anlegen oder löschen nie.
        expect(await granted(APP_ROLE, "media_type_image")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
        expect(await granted(JOBS_ROLE, "media_type_image")).toEqual(["SELECT", "UPDATE"]);
        expect(await granted(TILES_ROLE, "media_type_image")).toEqual([]);
        // Reisebilder (0293): Die App legt die Verwendung an, ändert und löscht sie. Der Abgleich liest sie über `readUsages`, mehr braucht die Jobs-Rolle nicht:
        // Reisebilder nehmen an keiner Zusammenführung teil, kein Sammellauf hängt sie um (kein UPDATE in `media-grants.psql`).
        expect(await granted(APP_ROLE, "photobox_media")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
        expect(await granted(JOBS_ROLE, "photobox_media")).toEqual(["SELECT"]);
        expect(await granted(TILES_ROLE, "photobox_media")).toEqual([]);
        expect(await granted("public", "photobox_media")).toEqual([]);
        const [folge] = await (admin as Database).unsafe<{ ok: boolean }[]>(
            `SELECT has_sequence_privilege($1, 'public.media_type_image_id_seq', 'USAGE') AS ok`,
            [APP_ROLE] as never[],
        );
        expect(folge!.ok).toBe(true);
    });

    it("🔴 PUBLIC und die Kachelrolle lesen nichts Privates der Medien: Entstehung samt Prompt, Rechte, Belege, Dateien, Herkunft (R8)", async () => {
        // Inventur WI-0068 R8 (2026-10-18): Die Zusage oben galt nur den Tafeln aus 0086 und den Typbildern. Öffentlich liest niemand eine
        // Medientafel direkt: Besucher sehen Bilder nur über den Resolver der App (Policy) und Nginx unter /media/.
        const privat = [
            "media_asset",
            "media_file",
            "media_rights",
            "media_rights_evidence",
            "media_creation",
            "media_legacy_source",
            "media_merge",
            "media_merge_move",
            "media_gallery",
            "media_gallery_item",
            "place_media",
            "territory_media",
            "adventure_media",
            "citymap_media",
            "place_media_gallery",
            "publication_rule",
        ];
        for (const table of privat) {
            expect(await granted("public", table), `PUBLIC an ${table}`).toEqual([]);
            expect(await granted(TILES_ROLE, table), `Kachelrolle an ${table}`).toEqual([]);
        }
    });

    it("🔴 als App-Rolle: anhängen geht, ändern und löschen nicht; die Trigger der Revision laufen mit ihren Rechten", async () => {
        const db = migrator as Database;
        const [asset] = await db<{ id: string; public_id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref) VALUES ('image', 'editor_upload', 'mamgrants', 'a')
            RETURNING id, public_id`;
        const [gallery] = await db<{ id: string }[]>`
            INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES ('editorial', 'mamgrants', 'g') RETURNING id`;
        const [item] = await db<{ id: string }[]>`
            INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${gallery?.id ?? ""}, ${asset?.id ?? ""}, 0)
            RETURNING id`;
        // Das Original des Assets: der Notaus gilt seinen Bytes (der Trigger, der das prüft, läuft mit den Rechten des Besitzers).
        const bytes = "ab".repeat(32);
        await db`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
            VALUES (${asset?.id ?? ""}, 'source', 'private_source', ${`private/source/sha256/ab/ab/${bytes}.png`}, 'image/png', 10, ${bytes})`;
        const op = "6d616d74-0000-4000-8000-0000000000aa";
        const receipt = `{"operationId":"${op}","status":"applied","environment":"test","affected":[],"derivedWork":[],"warnings":[]}`;
        const person = "7e570000-0000-4000-8000-00000000000a";
        const codes = await asApp([
            `INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id)
             VALUES ('${op}', sha256('x'::bytea), '${receipt}', 'gallery.reorder', 'test', 'person', '${person}')`,
            `INSERT INTO media_audit_event (operation_id, action, media_gallery_public_id)
             SELECT '${op}', 'gallery.reordered', public_id FROM media_gallery WHERE id = ${gallery?.id ?? "0"}`,
            `INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id) VALUES (${asset?.id ?? "0"}, 'editor_upload', '${person}')`,
            `INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
             VALUES ('${bytes}', ${asset?.id ?? "0"}, 'Abmahnung', '${person}')`,
            `UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = '${person}' WHERE media_asset_id = ${asset?.id ?? "0"}`,
            `UPDATE media_gallery_item SET sort_order = 3 WHERE id = ${item?.id ?? "0"}`,
            `UPDATE media_asset SET title = 'Hafen' WHERE id = ${asset?.id ?? "0"}`,
            `UPDATE media_operation SET action = 'gallery.other' WHERE operation_id = '${op}'`,
            `DELETE FROM media_audit_event`,
            `UPDATE media_ingest SET actor_person_id = NULL`,
            `DELETE FROM media_ingest`,
            `DELETE FROM media_publication_suspension`,
            `TRUNCATE media_operation CASCADE`,
            // Die Revision zählt auch, wenn die App ändert: die Galerie über ihren Eintrag, das Asset über den Titel.
            `DO $$ BEGIN
                 IF (SELECT revision FROM media_gallery WHERE id = ${gallery?.id ?? "0"}) < 3
                    OR (SELECT revision FROM media_asset WHERE id = ${asset?.id ?? "0"}) <> 2 THEN
                     RAISE EXCEPTION 'Revision nicht gezählt' USING ERRCODE = 'P0001';
                 END IF;
             END $$`,
        ]);
        expect(codes).toEqual([
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "42501",
            "42501",
            "42501",
            "42501",
            "42501",
            "42501",
            "ok",
        ]);
    });

    it("🔴 Konto auflösen (0088): die App ruft redact_person_media und schwärzt so, was sie selbst nicht ändern darf; sonst niemand", async () => {
        const callable = async (role: string): Promise<boolean> => {
            const [row] = await (admin as Database).unsafe<{ ok: boolean }[]>(
                `SELECT has_function_privilege($1, 'public.redact_person_media(uuid)', 'EXECUTE') AS ok`,
                [role],
            );
            return row?.ok ?? false;
        };
        // Aus den Default-Privilegien des Werkzeugs (`sql_env`), ohne Zeile in media-grants.psql; PUBLIC nahm die Migration weg.
        expect(await callable(APP_ROLE)).toBe(true);
        expect(await callable("public")).toBe(false);
        expect(await callable(TILES_ROLE)).toBe(false);
        expect(await callable(JOBS_ROLE)).toBe(false);

        const op = "6d616d74-0000-4000-8000-0000000000bb";
        const receipt = `{"operationId":"${op}","status":"applied","environment":"test","affected":[],"derivedWork":[],"warnings":[]}`;
        const person = "7e570000-0000-4000-8000-00000000000b";
        const codes = await asApp([
            `INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id)
             VALUES ('${op}', sha256('x'::bytea), '${receipt}', 'suspension.set', 'test', 'person', '${person}')`,
            `INSERT INTO media_audit_event (operation_id, action, media_asset_public_id, details)
             VALUES ('${op}', 'suspension.set', gen_random_uuid(), '{"reason": "Mail von Rondrikan", "assets": 2}')`,
            `UPDATE media_audit_event SET details = '{}'::jsonb WHERE operation_id = '${op}'`,
            `SELECT redact_person_media('${person}')`,
            `DO $$ BEGIN
                 IF (SELECT details ->> 'reason' FROM media_audit_event WHERE operation_id = '${op}') <> '[geschwärzt]'
                    OR (SELECT (details ->> 'assets')::int FROM media_audit_event WHERE operation_id = '${op}') <> 2
                    OR (SELECT request_hash FROM media_operation WHERE operation_id = '${op}') IS NOT NULL THEN
                     RAISE EXCEPTION 'nicht geschwärzt' USING ERRCODE = 'P0001';
                 END IF;
             END $$`,
        ]);
        expect(codes).toEqual(["ok", "ok", "42501", "ok", "ok"]);
    });

    it("🔴 Abgleich der Medien (WI-0068 P4a, 0090): die App reiht media_settle über job_enqueue ein, die Jobs-Rolle schreibt Dateizeilen und technischen Zustand, sonst nichts am Asset", async () => {
        const db = migrator as Database;
        const [asset] = await db<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref) VALUES ('image', 'editor_upload', 'mamgrants', 'settle')
            RETURNING id`;
        const id = asset?.id ?? "0";
        const bytes = "cd".repeat(32);
        expect(
            await asApp([
                `SELECT * FROM job_enqueue('media_settle', 1::smallint, 'aventuria', '7e570000-0000-4000-8000-00000000000c',
                                          '{"asset": "7e570000-0000-4000-8000-00000000000d", "role": "coat"}'::jsonb)`,
                `SELECT * FROM job_enqueue('probe', 1::smallint, 'aventuria', 'a', '{}'::jsonb)`,
                `INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, byte_size, sha256)
                 VALUES (${id}, 'source', 'private_source', 'private/source/sha256/cd/cd/${bytes}.png', 'image/png', 10, '${bytes}')`,
            ]),
        ).toEqual(["ok", "42501", "ok"]);
        expect(
            await asRole(jobs as Database, [
                `SELECT 1 FROM media_asset WHERE id = ${id} FOR UPDATE`,
                `INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                         derivative_recipe, recipe_version)
                 VALUES (${id}, 'coat', 'published', 'published/sha256/cd/cd/${bytes}.webp', 'image/webp', 10, 10, 10, '${bytes}', 'coat', '1')`,
                `DELETE FROM media_file WHERE media_asset_id = ${id} AND storage_class = 'published'`,
                `UPDATE media_asset SET technical_state = 'ok', updated_at = now() WHERE id = ${id}`,
                // T2b: die Messung der Ecken am Original darf der Abgleich schreiben, sonst nichts an der Dateizeile.
                `UPDATE media_file SET corners_transparent = true WHERE media_asset_id = ${id} AND storage_class = 'private_source'`,
                // D2: ebenso der Wahrnehmungs-Hash des Originals (0196).
                `UPDATE media_file SET perceptual_hash = '0123456789abcdef' WHERE media_asset_id = ${id} AND storage_class = 'private_source'`,
                // WI-0275: Das Original eines angenommenen Kartenvorschlags fällt weg; der Lauf stempelt die Zeile (0308).
                `UPDATE media_file SET bytes_deleted_at = now() WHERE media_asset_id = ${id} AND storage_class = 'private_source'`,
                // WI-0189 B2: den Zustand der Datei eines Notaus schreibt der Job media_quarantine, die Entscheidung nie.
                `UPDATE media_publication_suspension SET file_state = 'pending' WHERE false`,
                `UPDATE media_publication_suspension SET reason = 'fremd' WHERE false`,
                `UPDATE media_file SET sha256 = '${bytes}' WHERE media_asset_id = ${id}`,
                `UPDATE media_asset SET title = 'Fremd' WHERE id = ${id}`,
                `UPDATE media_rights SET clearance_state = 'cleared'`,
                // Quittungen schreibt die Jobs-Rolle seit dem Sammellauf der Duplikate (Fall unten), ändern oder löschen nie.
                `UPDATE media_operation SET receipt = '{}' WHERE false`,
            ]),
        ).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "42501", "42501", "42501", "42501", "42501"]);
    });

    it("🔴 Sammellauf der Duplikate (WI-0068, 0151): die Jobs-Rolle hängt Verwendungen um und schreibt Zusammenführung und Protokoll, löscht aber nichts", async () => {
        expect(
            await asApp([
                `SELECT * FROM job_enqueue('media_merge_all', 1::smallint, 'aventuria', '7e570000-0000-4000-8000-00000000000c',
                                          '{"groups": []}'::jsonb)`,
            ]),
        ).toEqual(["ok"]);
        expect(
            await asRole(jobs as Database, [
                `UPDATE place_media SET updated_at = now() WHERE false`,
                `UPDATE media_gallery_item SET retired_at = now() WHERE false`,
                `UPDATE media_type_image SET retired_at = now() WHERE false`,
                `UPDATE media_gallery SET origin = 'editor' WHERE false`,
                `INSERT INTO media_merge (merged_asset_id, kept_asset_id, source_sha256, merged_by_person)
                 SELECT 1, 2, 'x', gen_random_uuid() WHERE false`,
                `INSERT INTO media_merge_move (merge_id, target_table, target_id, kind) SELECT 1, 'place_media', 1, 'umgehaengt' WHERE false`,
                `INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind)
                 SELECT gen_random_uuid(), sha256('x'::bytea), '{}', 'a.b', 'test', 'system' WHERE false`,
                `SELECT * FROM job_enqueue('media_settle', 1::smallint, 'aventuria', '7e570000-0000-4000-8000-00000000000c',
                                          '{"asset": "7e570000-0000-4000-8000-00000000000d", "role": "coat"}'::jsonb, 90::smallint)`,
                // Nichts davon darf sie löschen, und die Galerie nur in ihrer Herkunft ändern.
                `DELETE FROM place_media WHERE false`,
                `DELETE FROM media_merge WHERE false`,
                `DELETE FROM media_merge_move WHERE false`,
                `DELETE FROM media_audit_event WHERE false`,
                `UPDATE media_gallery SET title = 'Fremd' WHERE false`,
            ]),
        ).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "42501", "42501", "42501", "42501", "42501"]);
    });

    it("🔴 Aufbewahrung der Reisebilder (WI-0272 S2, 0284): nur die Jobs-Rolle ruft photobox_aufbewahren; App, Kachelrolle und PUBLIC nicht", async () => {
        const callable = async (role: string): Promise<boolean> => {
            const [row] = await (admin as Database).unsafe<{ ok: boolean }[]>(
                `SELECT has_function_privilege($1, 'public.photobox_aufbewahren(timestamptz)', 'EXECUTE') AS ok`,
                [role],
            );
            return row?.ok ?? false;
        };
        // Die Default-Privilegien (`sql_env`) gäben der App das Recht; media-grants.psql nimmt es ihr, die Migration PUBLIC.
        expect(await callable(JOBS_ROLE)).toBe(true);
        expect(await callable(APP_ROLE)).toBe(false);
        expect(await callable(TILES_ROLE)).toBe(false);
        expect(await callable("public")).toBe(false);
        const aufruf = `SELECT * FROM photobox_aufbewahren(now())`;
        expect(await asApp([aufruf])).toEqual(["42501"]);
        expect(await asRole(jobs as Database, [aufruf])).toEqual(["ok"]);
    });

    it("🔴 Aufbewahrung der Kartenvorschläge (WI-0275 B2, 0296): nur die Jobs-Rolle ruft kartenvorschlag_aufbewahren; App, Kachelrolle und PUBLIC nicht", async () => {
        const callable = async (role: string): Promise<boolean> => {
            const [row] = await (admin as Database).unsafe<{ ok: boolean }[]>(
                `SELECT has_function_privilege($1, 'public.kartenvorschlag_aufbewahren(timestamptz)', 'EXECUTE') AS ok`,
                [role],
            );
            return row?.ok ?? false;
        };
        expect(await callable(JOBS_ROLE)).toBe(true);
        expect(await callable(APP_ROLE)).toBe(false);
        expect(await callable(TILES_ROLE)).toBe(false);
        expect(await callable("public")).toBe(false);
        const aufruf = `SELECT * FROM kartenvorschlag_aufbewahren(now())`;
        expect(await asApp([aufruf])).toEqual(["42501"]);
        expect(await asRole(jobs as Database, [aufruf])).toEqual(["ok"]);
    });
});
