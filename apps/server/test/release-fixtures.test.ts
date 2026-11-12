// Das Testpaket des Release-Tests (WI-0248 R2, `scripts/dev/release-fixtures.ts`): reine Regeln, die Klassifizierung der Anmeldetabellen
// und ein Bau gegen eine Wegwerf-Datenbank (Ausschluss der Geheimnisse, Manifest, Abbruch bei fremder Migration, Aufräumen).
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    GEHEIME_TABELLEN,
    UNGEHEIME_AUTH_TABELLEN,
    baueTestpaket,
    datenbankAdresse,
    fehlendeMigrationen,
    istPaketFuer,
    leseEnvDatei,
    leseManifest,
    messeOrdner,
    pgUmgebung,
    reinige,
    standardOptionen,
    zuLoeschendePakete,
    type FixtureOptionen,
} from "../../../scripts/dev/release-fixtures.ts";
import {
    liesManifest,
    migrationenAusBaum,
    pruefeTestpaketManifest,
    spieleTestpaketEin,
} from "../../../scripts/dev/release-testpaket.ts";
import { findePostgres, starteWegwerfDb, WEGWERF_DATENBANK, type WegwerfDb } from "../../../scripts/dev/wegwerf-db.ts";

const migrationen = fileURLToPath(new URL("../migrations/", import.meta.url));

describe("Anmelde- und Sitzungstabellen bleiben aus dem Paket", () => {
    it("jede Tabelle im Schema avesmaps_auth ist als geheim (leer) oder ungeheim (mit Daten) eingestuft", () => {
        const angelegt = new Set<string>();
        for (const datei of readdirSync(migrationen).filter((n) => n.endsWith(".sql"))) {
            const sql = readFileSync(join(migrationen, datei), "utf8");
            for (const t of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(avesmaps_auth\.[a-z_]+)/gi))
                if (t[1] !== undefined) angelegt.add(t[1].toLowerCase());
        }
        const eingestuft = new Set<string>([...GEHEIME_TABELLEN, ...UNGEHEIME_AUTH_TABELLEN]);
        // Eine neue Auth-Tabelle muss hier bewusst eingeordnet werden: trägt sie Token, Hashes, Schlüssel oder Zustand einer Anmeldung?
        expect([...angelegt].filter((t) => !eingestuft.has(t))).toEqual([]);
        // Und keine Einstufung zeigt auf eine Tabelle, die es nicht gibt (Tippfehler würden sonst unbemerkt nichts ausschließen).
        expect([...eingestuft].filter((t) => !angelegt.has(t))).toEqual([]);
        expect(GEHEIME_TABELLEN.filter((t) => (UNGEHEIME_AUTH_TABELLEN as readonly string[]).includes(t))).toEqual([]);
    });

    it("die Geheimnisliste enthält Sitzungen, Passkeys, Passwort-Hashes und OAuth-Zustand", () => {
        for (const t of ["session", "passkey_credential", "password_login", "oauth_flow"])
            expect(GEHEIME_TABELLEN).toContain(`avesmaps_auth.${t}`);
    });
});

describe("Verbindung ohne Kennwort in der Kommandozeile", () => {
    it("zerlegt die Adresse in PG*-Umgebungsvariablen und streicht fremde", () => {
        const env = pgUmgebung("postgres://alice:p%40ss%3Aw@127.0.0.1:5439/meine_db?sslmode=disable", {
            PATH: "x",
            DATABASE_URL: "postgres://alt",
            PGPASSWORD: "alt",
            PGSERVICE: "alt",
        });
        expect(env).toMatchObject({
            PATH: "x",
            PGHOST: "127.0.0.1",
            PGPORT: "5439",
            PGUSER: "alice",
            PGPASSWORD: "p@ss:w",
            PGDATABASE: "meine_db",
            PGSSLMODE: "disable",
        });
        expect(env["DATABASE_URL"]).toBeUndefined();
        expect(env["PGSERVICE"]).toBeUndefined();
    });

    it("kennt Vorgabeport, IPv6 und Adressen ohne Anmeldedaten", () => {
        expect(pgUmgebung("postgresql://[::1]/d", {})).toMatchObject({
            PGHOST: "::1",
            PGPORT: "5432",
            PGDATABASE: "d",
        });
        expect(pgUmgebung("postgres://h/d", {})["PGPASSWORD"]).toBeUndefined();
    });

    it.each(["kein url", "mysql://h/d", "postgres://h/", "postgres:///d"])(
        "lehnt %s ab, ohne die Adresse zu nennen",
        (adresse) => {
            let meldung = "";
            try {
                pgUmgebung(adresse, {});
            } catch (e) {
                meldung = e instanceof Error ? e.message : "";
            }
            expect(meldung).not.toBe("");
            expect(meldung).not.toContain(adresse);
        },
    );

    it("schwärzt Adresse und Kennwort in Meldungen", () => {
        const adresse = "postgres://alice:geheim123@127.0.0.1:5432/db";
        const text = `connection to ${adresse} failed: password geheim123 rejected`;
        expect(reinige(text, adresse)).toBe("connection to *** failed: password *** rejected");
    });

    it("liest DATABASE_URL aus der Umgebung vor der .env und nennt den Wert nie im Fehler", () => {
        const ordner = mkdtempSync(join(tmpdir(), "fixtures-env-"));
        try {
            const datei = join(ordner, ".env");
            writeFileSync(datei, "# Kommentar\nFOO=bar\nDATABASE_URL='postgres://u:p@h/aus_datei'\n");
            expect(leseEnvDatei(readFileSync(datei, "utf8"))).toEqual({
                FOO: "bar",
                DATABASE_URL: "postgres://u:p@h/aus_datei",
            });
            expect(datenbankAdresse(datei, {})).toBe("postgres://u:p@h/aus_datei");
            expect(datenbankAdresse(datei, { DATABASE_URL: "postgres://u:p@h/aus_umgebung" })).toBe(
                "postgres://u:p@h/aus_umgebung",
            );
            expect(() => datenbankAdresse(join(ordner, "fehlt.env"), {})).toThrow(/DATABASE_URL fehlt/);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

describe("Regeln des Pakets", () => {
    it("meldet Migrationen der Quelle, die der Kandidat nicht kennt", () => {
        expect(fehlendeMigrationen(["0001_a", "0002_b"], ["0001_a", "0002_b", "0003_c"])).toEqual([]);
        expect(fehlendeMigrationen(["0001_a", "0005_neu"], ["0001_a", "0002_b"])).toEqual(["0005_neu"]);
    });

    it("behält die jüngsten Pakete und das neue immer", () => {
        const pakete = [
            { name: "a", erstellt: 1 },
            { name: "b", erstellt: 4 },
            { name: "c", erstellt: 2 },
            { name: "d", erstellt: 3 },
            { name: "e", erstellt: 5 },
        ];
        expect(zuLoeschendePakete(pakete, 3, "e").sort()).toEqual(["a", "c"]);
        // Auch ein altes „neu“ bleibt: Es ist das, was eben gebaut wurde.
        expect(zuLoeschendePakete(pakete, 3, "a").sort()).toEqual(["c", "d"]);
        expect(zuLoeschendePakete(pakete.slice(0, 2), 3, "a")).toEqual([]);
    });

    it("liest Argumente und lehnt eine unvollständige SHA ab", () => {
        const o = standardOptionen(["--commit", "a".repeat(40), "--aus", "C:/x", "--neu"], () => undefined, {});
        expect(o.commit).toBe("a".repeat(40));
        expect(o.neu).toBe(true);
        expect(o.ziel.replace(/\\/g, "/")).toMatch(/\/x\/release-fixtures$/);
        expect(o.tiles.replace(/\\/g, "/")).toMatch(/\/x\/tiles\/aventuria$/);
        expect(o.media.replace(/\\/g, "/")).toMatch(/\/x\/media$/);
        expect(() => standardOptionen(["--commit", "abc"], () => undefined, {})).toThrow(/vollständige SHA/);
    });
});

describe("Dateien des Pakets", () => {
    let ordner = "";
    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "fixtures-dateien-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    it("zählt Dateien und Bytes rekursiv", () => {
        const quelle = join(ordner, "quelle");
        mkdirSync(join(quelle, "z", "x"), { recursive: true });
        writeFileSync(join(quelle, "a.bin"), "12345");
        writeFileSync(join(quelle, "z", "x", "b.bin"), "123");
        expect(messeOrdner(quelle)).toEqual({ dateien: 2, bytes: 8 });
    });

    it("lehnt einen Verweis in der Quelle ab (der Runner nähme ihn nicht an)", () => {
        const quelle = join(ordner, "mit-verweis");
        const ziel = join(ordner, "ziel-des-verweises");
        mkdirSync(quelle);
        mkdirSync(ziel);
        try {
            symlinkSync(ziel, join(quelle, "verweis"), "junction");
        } catch {
            return; // Ohne Recht für Verweise lässt sich der Fall hier nicht herstellen.
        }
        expect(() => messeOrdner(quelle)).toThrow(/Verweis/);
    });

    it("erkennt ein vollständiges Paket nur mit passendem Manifest und allen drei Teilen", () => {
        const sha = "d".repeat(40);
        const paket = join(ordner, "paket");
        mkdirSync(join(paket, "tiles"), { recursive: true });
        mkdirSync(join(paket, "media"));
        writeFileSync(join(paket, "daten.dump"), "x");
        expect(istPaketFuer(paket, sha)).toBe(false); // ohne Manifest
        writeFileSync(
            join(paket, "manifest.json"),
            JSON.stringify({ schema: 2, commit: sha, erstellt: "2026-10-23T00:00:00Z" }),
        );
        expect(istPaketFuer(paket, sha)).toBe(true);
        expect(istPaketFuer(paket, "e".repeat(40))).toBe(false);
        writeFileSync(join(paket, "manifest.json"), JSON.stringify({ schema: 1, commit: sha }));
        expect(istPaketFuer(paket, sha)).toBe(false);
        writeFileSync(join(paket, "manifest.json"), "kein json");
        expect(leseManifest(paket)).toBeUndefined();
    });

    it("lässt ein vollständiges Paket für denselben Commit unberührt, ohne Datenbank anzufassen", () => {
        const sha = "f".repeat(40);
        const ziel = join(ordner, "ziel");
        const paket = join(ziel, sha);
        mkdirSync(join(paket, "tiles"), { recursive: true });
        mkdirSync(join(paket, "media"));
        writeFileSync(join(paket, "daten.dump"), "x");
        writeFileSync(
            join(paket, "manifest.json"),
            JSON.stringify({ schema: 2, commit: sha, erstellt: "2026-10-23T00:00:00Z" }),
        );
        const zeilen: string[] = [];
        const o: FixtureOptionen = {
            commit: sha,
            daten: ordner,
            tiles: join(ordner, "gibt-es-nicht"),
            media: join(ordner, "gibt-es-nicht"),
            ziel,
            werkzeug: ordner,
            envDatei: join(ordner, "gibt-es-nicht.env"),
            neu: false,
            protokoll: (z) => zeilen.push(z),
        };
        expect(baueTestpaket(o)).toBe(paket);
        expect(zeilen.join("\n")).toContain("unverändert");
    });
});

describe("Bau gegen eine Wegwerf-Datenbank", () => {
    const bin = findePostgres();
    let db: WegwerfDb | undefined;
    let wurzel = "";
    let werkzeug = "";
    let tiles = "";
    let media = "";
    const commits: string[] = [];
    const exe = process.platform === "win32" ? ".exe" : "";

    const psql = (sql: string): void => {
        const lauf = spawnSync(
            join(bin ?? "", `psql${exe}`),
            ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db?.url ?? "", "-c", sql],
            {
                encoding: "utf8",
            },
        );
        if (lauf.status !== 0) throw new Error(`psql: ${lauf.stderr}`);
    };
    const git = (...args: string[]): string =>
        execFileSync("git", ["-C", werkzeug, ...args], {
            encoding: "utf8",
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: "T",
                GIT_AUTHOR_EMAIL: "t@t",
                GIT_COMMITTER_NAME: "T",
                GIT_COMMITTER_EMAIL: "t@t",
            },
            windowsHide: true,
        }).trim();
    const optionen = (commit: string): FixtureOptionen => ({
        commit,
        daten: wurzel,
        tiles,
        media,
        ziel: join(wurzel, "release-fixtures"),
        werkzeug,
        envDatei: join(wurzel, "gibt-es-nicht.env"),
        umgebung: { ...process.env, DATABASE_URL: db?.url ?? "" },
        neu: false,
        protokoll: () => undefined,
    });

    beforeAll(async () => {
        // Kein stilles Überspringen: Ein Test, der ohne PostgreSQL nichts prüft, wäre im Release-Lauf (null Übersprungene) grün und leer.
        if (bin === undefined)
            throw new Error("PostgreSQL-Programme (initdb, pg_dump, psql) nicht gefunden: PG_BIN_DIR setzen");
        wurzel = mkdtempSync(join(tmpdir(), "fixtures-bau-"));
        db = await starteWegwerfDb({ bin });
        psql(
            "CREATE TABLE schema_migration (version text PRIMARY KEY, checksum text, applied_at timestamptz DEFAULT now())",
        );
        psql("INSERT INTO schema_migration (version, checksum) VALUES ('0001_a', 'x'), ('0002_b', 'y')");
        psql("CREATE SCHEMA avesmaps_auth");
        psql("CREATE TABLE avesmaps_auth.session (id int, token_hash text)");
        psql("INSERT INTO avesmaps_auth.session VALUES (1, 'GEHEIMER-TOKEN')");
        psql("CREATE TABLE avesmaps_auth.person (id int, display_name text)");
        psql("INSERT INTO avesmaps_auth.person VALUES (1, 'SICHTBARE-PERSON')");
        werkzeug = join(wurzel, "werkzeug");
        mkdirSync(join(werkzeug, "apps", "server", "migrations"), { recursive: true });
        execFileSync("git", ["init", "--quiet", werkzeug], { windowsHide: true });
        writeFileSync(join(werkzeug, "apps", "server", "migrations", "0001_a.sql"), "SELECT 1;");
        writeFileSync(join(werkzeug, "apps", "server", "migrations", "0002_b.sql"), "SELECT 2;");
        git("add", ".");
        for (let i = 0; i < 5; i += 1) {
            git("commit", "--quiet", "--allow-empty", "-m", `Stand ${String(i)}`);
            commits.push(git("rev-parse", "HEAD"));
        }
        tiles = join(wurzel, "tiles-quelle");
        media = join(wurzel, "media-quelle");
        mkdirSync(join(tiles, "z0"), { recursive: true });
        mkdirSync(media);
        writeFileSync(join(tiles, "z0", "0.pbf"), "kachel");
        writeFileSync(join(media, "bild.jpg"), "bild");
    }, 120_000);

    afterAll(() => {
        db?.stoppe();
        if (wurzel !== "") rmSync(wurzel, { recursive: true, force: true });
    });

    it("baut ein Paket mit Schema und Daten, aber ohne die Daten der Geheimnistabellen", () => {
        const sha = commits[0] ?? "";
        const paket = baueTestpaket(optionen(sha));
        expect(paket).toBe(join(wurzel, "release-fixtures", sha));
        const manifest = leseManifest(paket);
        expect(manifest).toMatchObject({
            schema: 2,
            commit: sha,
            quelle: { migrationen: ["0001_a", "0002_b"] },
        });
        expect(manifest?.groessen.tiles).toEqual({ dateien: 1, bytes: 6 });
        expect(manifest?.groessen.media).toEqual({ dateien: 1, bytes: 4 });
        expect(manifest?.groessen["daten.dump"]).toBeGreaterThan(0);
        expect(JSON.stringify(manifest)).not.toContain("postgres://");
        expect(readFileSync(join(paket, "tiles", "z0", "0.pbf"), "utf8")).toBe("kachel");
        expect(readFileSync(join(paket, "media", "bild.jpg"), "utf8")).toBe("bild");
        const text = execFileSync(join(bin ?? "", `pg_restore${exe}`), ["--file=-", join(paket, "daten.dump")], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
        expect(text).toContain("CREATE TABLE avesmaps_auth.session"); // das Schema bleibt
        expect(text).toContain("SICHTBARE-PERSON");
        expect(text).toContain("0002_b"); // das Migrationsjournal geht mit
        expect(text).not.toContain("GEHEIMER-TOKEN");
        expect(istPaketFuer(paket, sha)).toBe(true);
        expect(readdirSync(join(wurzel, "release-fixtures")).filter((n) => n.startsWith(".bau-"))).toEqual([]);
    }, 120_000);

    it("erfüllt den Vertrag des Runners: Manifest geprüft, Dump als Besitzer eingespielt, Geheimnistabellen leer", async () => {
        const paket = join(wurzel, "release-fixtures", commits[0] ?? "");
        // Dieselben Funktionen wie im Runner (`release-testpaket.ts`): erst das Manifest gegen die Migrationen des Kandidaten, dann das Einspielen.
        const pruefung = pruefeTestpaketManifest(
            liesManifest(paket),
            migrationenAusBaum(git("ls-tree", "--name-only", commits[0] ?? "", "apps/server/migrations/")),
        );
        expect(pruefung).toMatchObject({ ok: true, quelle: ["0001_a", "0002_b"], folgend: [] });
        const ziel = await starteWegwerfDb({ bin: bin ?? "" });
        try {
            const arbeit = mkdtempSync(join(wurzel, "einspielen-"));
            await spieleTestpaketEin({
                bin: bin ?? "",
                url: ziel.url,
                port: ziel.port,
                datenbank: WEGWERF_DATENBANK,
                dump: join(paket, "daten.dump"),
                arbeitsordner: arbeit,
                env: process.env,
            });
            const abfrage = spawnSync(
                join(bin ?? "", `psql${exe}`),
                [
                    "-X",
                    "-A",
                    "-t",
                    "-d",
                    ziel.url,
                    "-c",
                    "SELECT (SELECT display_name FROM avesmaps_auth.person) || (SELECT count(*) FROM avesmaps_auth.session) || (SELECT count(*) FROM schema_migration)",
                ],
                { encoding: "utf8" },
            );
            expect(abfrage.stdout.trim()).toBe("SICHTBARE-PERSON02");
        } finally {
            ziel.stoppe();
        }
    }, 120_000);

    it("bricht vorab ab, wenn die Quelle eine Migration kennt, die der Kandidat nicht kennt", () => {
        psql("INSERT INTO schema_migration (version, checksum) VALUES ('0003_nur_in_der_quelle', 'z')");
        const sha = commits[1] ?? "";
        expect(() => baueTestpaket(optionen(sha))).toThrow(/0003_nur_in_der_quelle/);
        expect(existsSync(join(wurzel, "release-fixtures", sha))).toBe(false);
        expect(readdirSync(join(wurzel, "release-fixtures")).filter((n) => n.startsWith(".bau-"))).toEqual([]);
        psql("DELETE FROM schema_migration WHERE version = '0003_nur_in_der_quelle'");
    }, 120_000);

    it("behält nur die drei jüngsten Pakete und fasst Fremdes nicht an", () => {
        const fremdOrdner = join(wurzel, "release-fixtures", "irgendwas");
        const fremdSha = join(wurzel, "release-fixtures", "1".repeat(40)); // SHA-förmiger Name, aber ohne Manifest
        mkdirSync(fremdOrdner, { recursive: true });
        mkdirSync(fremdSha);
        for (const sha of commits.slice(2)) baueTestpaket(optionen(sha));
        // Gebaut wurden commits[0] (Test 1) und commits[2..4]; behalten werden die drei jüngsten.
        const vorhanden = readdirSync(join(wurzel, "release-fixtures"))
            .filter((n) => /^[0-9a-f]{40}$/.test(n) && leseManifest(join(wurzel, "release-fixtures", n)) !== undefined)
            .sort();
        expect(vorhanden).toEqual(commits.slice(2).sort());
        expect(existsSync(fremdOrdner)).toBe(true);
        expect(existsSync(fremdSha)).toBe(true);
    }, 180_000);
});
