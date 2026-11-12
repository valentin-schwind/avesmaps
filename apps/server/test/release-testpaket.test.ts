import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    TESTPAKET_SCHEMA,
    filtereInhaltsliste,
    migrationenAusBaum,
    migrationsname,
    pruefeTestpaketManifest,
    spieleTestpaketEin,
} from "../../../scripts/dev/release-testpaket.ts";
import { findePostgres, starteWegwerfDb, WEGWERF_DATENBANK, WEGWERF_ROLLE } from "../../../scripts/dev/wegwerf-db.ts";

/**
 * Das Testpaket des Release-Runners (WI-0248 R1, `scripts/dev/release-testpaket.ts`). Problemfälle: ein Paket ohne Manifest, im alten Format oder
 * aus einem Stand, den der Kandidat nicht kennt, muss rot sein, bevor etwas gebaut wird; der Dump läuft ohne Superuser ein (Erweiterungen und
 * die Daten von `spatial_ref_sys` entfallen in der Inhaltsliste); ein Fehler beim Einspielen nennt das Ende des Protokolls.
 */
const kandidat = ["0001_a.sql", "0002_b.sql", "0003_c.sql"].map(migrationsname);
const manifest = (felder: Record<string, unknown> = {}): string =>
    JSON.stringify({
        schema: TESTPAKET_SCHEMA,
        erstellt: "2026-10-23T08:00:00.000Z",
        quelle: { migrationen: ["0001_a", "0002_b"] },
        ...felder,
    });

describe("migrationsname und migrationenAusBaum", () => {
    it("liefert den Journal-Schlüssel aus Dateiname, Pfad oder Schlüssel", () => {
        expect(migrationsname("0216_x.sql")).toBe("0216_x");
        expect(migrationsname("apps/server/migrations/0216_x.sql")).toBe("0216_x");
        expect(migrationsname("apps\\server\\migrations\\0216_x.sql")).toBe("0216_x");
        expect(migrationsname("0216_x")).toBe("0216_x");
    });

    it("liest die Ausgabe von git ls-tree: nur .sql, sortiert, Zeilenenden egal", () => {
        const baum =
            "apps/server/migrations/0002_b.sql\r\napps/server/migrations/README.md\napps/server/migrations/0001_a.sql\n";
        expect(migrationenAusBaum(baum)).toEqual(["0001_a", "0002_b"]);
        expect(migrationenAusBaum("")).toEqual([]);
    });
});

describe("pruefeTestpaketManifest", () => {
    it("🔴 nimmt ein passendes Paket und nennt die Migrationen, die der Kandidat noch hinzufügt", () => {
        const p = pruefeTestpaketManifest(manifest(), kandidat);
        expect(p).toEqual({
            ok: true,
            erstellt: "2026-10-23T08:00:00.000Z",
            quelle: ["0001_a", "0002_b"],
            folgend: ["0003_c"],
        });
    });

    it("akzeptiert Dateinamen mit .sql und weitere Felder im Manifest", () => {
        const p = pruefeTestpaketManifest(
            manifest({ quelle: { migrationen: ["0001_a.sql", "0002_b.sql", "0003_c.sql"], host: "x" }, notiz: "y" }),
            kandidat,
        );
        expect(p.ok && p.folgend).toEqual([]);
    });

    it("🔴 ohne manifest.json: altes Testpaketformat", () => {
        const p = pruefeTestpaketManifest(undefined, kandidat);
        expect(p.ok).toBe(false);
        expect(!p.ok && p.grund).toContain("altes Testpaketformat");
    });

    it("🔴 Schema 1 oder ohne Schema: altes Testpaketformat; Schema 3: neuer als der Runner", () => {
        const alt = pruefeTestpaketManifest(manifest({ schema: 1 }), kandidat);
        expect(!alt.ok && alt.grund).toContain("altes Testpaketformat");
        const ohne = pruefeTestpaketManifest(JSON.stringify({ erstellt: "2026-10-23T08:00:00Z" }), kandidat);
        expect(!ohne.ok && ohne.grund).toContain("altes Testpaketformat");
        const neu = pruefeTestpaketManifest(manifest({ schema: 3 }), kandidat);
        expect(!neu.ok && neu.grund).toContain("neuer als der Runner");
    });

    it("🔴 eine Migration der Quelle fehlt im Kandidaten: Testpaket neuer als der Kandidat", () => {
        const p = pruefeTestpaketManifest(manifest({ quelle: { migrationen: ["0001_a", "0009_neu"] } }), kandidat);
        expect(p.ok).toBe(false);
        expect(!p.ok && p.grund).toContain("Testpaket neuer als der Kandidat");
        expect(!p.ok && p.grund).toContain("0009_neu");
    });

    it("die Meldung zählt viele fehlende Migrationen, nennt aber höchstens fünf", () => {
        const viele = Array.from({ length: 8 }, (_, i) => `01${String(i)}0_x`);
        const p = pruefeTestpaketManifest(manifest({ quelle: { migrationen: viele } }), kandidat);
        expect(!p.ok && p.grund).toContain("8 Migration(en)");
        expect(!p.ok && p.grund).toContain(", …");
    });

    it.each([
        ["kein JSON", "{kaputt"],
        ["kein Objekt", "[1]"],
        ["erstellt fehlt", JSON.stringify({ schema: 2, quelle: { migrationen: ["0001_a"] } })],
        ["erstellt keine ISO-Zeit", manifest({ erstellt: "gestern" })],
        ["quelle fehlt", JSON.stringify({ schema: 2, erstellt: "2026-10-23T08:00:00Z" })],
        ["migrationen leer", manifest({ quelle: { migrationen: [] } })],
        ["migrationen keine Texte", manifest({ quelle: { migrationen: [1, 2] } })],
    ])("verweigert: %s", (_name, text) => {
        expect(pruefeTestpaketManifest(text, kandidat).ok).toBe(false);
    });

    it("verweigert, wenn der Kandidat keine Migrationen kennt (Lesefehler statt stiller Prüfung)", () => {
        const p = pruefeTestpaketManifest(manifest(), []);
        expect(!p.ok && p.grund).toContain("Kandidat enthält keine Migrationen");
    });
});

describe("filtereInhaltsliste", () => {
    const inhalt = [
        ";",
        "; Archive created at 2026-10-23 10:09:46",
        "7; 2615 21749 SCHEMA - avesmaps_auth avesmaps3d",
        "2; 3079 16386 EXTENSION - postgis ",
        "9916; 0 0 COMMENT - EXTENSION postgis ",
        "1324; 1255 22199 FUNCTION avesmaps_auth notify_change() avesmaps3d",
        "6817; 0 16705 TABLE DATA public spatial_ref_sys postgres",
        "9818; 0 22061 TABLE DATA avesmaps_auth access_link avesmaps3d",
        "9820; 0 22062 TABLE DATA public spatial_ref_sys_extra avesmaps3d",
        "",
    ].join("\r\n");

    it("🔴 lässt Erweiterung, deren Kommentar und die Daten von spatial_ref_sys aus und nennt die Erweiterungen", () => {
        const r = filtereInhaltsliste(inhalt);
        expect(r.erweiterungen).toEqual(["postgis"]);
        expect(r.ausgelassen).toBe(3);
        const zeilen = r.liste.split("\n");
        expect(zeilen).toContain("; ausgelassen (Superuser): 2; 3079 16386 EXTENSION - postgis ");
        expect(zeilen).toContain("; ausgelassen (Superuser): 9916; 0 0 COMMENT - EXTENSION postgis ");
        expect(zeilen).toContain("; ausgelassen (Superuser): 6817; 0 16705 TABLE DATA public spatial_ref_sys postgres");
    });

    it("lässt alles andere unverändert, auch eine ähnlich benannte Tabelle", () => {
        const zeilen = filtereInhaltsliste(inhalt).liste.split("\n");
        expect(zeilen).toContain("7; 2615 21749 SCHEMA - avesmaps_auth avesmaps3d");
        expect(zeilen).toContain("1324; 1255 22199 FUNCTION avesmaps_auth notify_change() avesmaps3d");
        expect(zeilen).toContain("9818; 0 22061 TABLE DATA avesmaps_auth access_link avesmaps3d");
        expect(zeilen).toContain("9820; 0 22062 TABLE DATA public spatial_ref_sys_extra avesmaps3d");
        expect(zeilen).toContain("; Archive created at 2026-10-23 10:09:46");
    });

    it("🔴 ein Erweiterungsname mit Sonderzeichen wird nie in SQL getragen", () => {
        expect(() => filtereInhaltsliste('5; 1 2 EXTENSION - x";drop')).toThrow("Unzulässiger Erweiterungsname");
    });
});

const bin = findePostgres();

// Ohne PostgreSQL-Programme überspringt die Probe sichtbar (wie `wegwerf-db.test.ts`), statt still grün zu sein.
describe.skipIf(bin === undefined)("spieleTestpaketEin", { timeout: 180_000 }, () => {
    it("🔴 spielt einen vollständigen Dump als Besitzer ohne Sonderrechte in eine leere Datenbank ein und meldet einen zweiten Versuch laut", async () => {
        const programme = bin as string;
        const arbeit = mkdtempSync(join(tmpdir(), "release-testpaket-"));
        const db = await starteWegwerfDb({ bin: programme, temp: arbeit });
        try {
            const psql = (datenbank: string, sql: string, rolle = "postgres"): string => {
                const lauf = spawnSync(
                    join(programme, "psql"),
                    [
                        "-h",
                        "127.0.0.1",
                        "-p",
                        String(db.port),
                        "-U",
                        rolle,
                        "-d",
                        datenbank,
                        "-At",
                        "-v",
                        "ON_ERROR_STOP=1",
                        "-c",
                        sql,
                    ],
                    { encoding: "utf8" },
                );
                if (lauf.status !== 0) throw new Error(lauf.stderr);
                return lauf.stdout.trim();
            };
            // Quelle: Journal, eine Tabelle mit PostGIS-Spalte und Daten, angelegt von der App-Rolle wie auf Stage.
            psql(
                WEGWERF_DATENBANK,
                "CREATE TABLE schema_migration (version text PRIMARY KEY, checksum text NOT NULL); INSERT INTO schema_migration VALUES ('0001_a', 'x'); " +
                    "CREATE TABLE ort (id int PRIMARY KEY, name text, geom geometry(Point, 4326)); " +
                    "INSERT INTO ort VALUES (1, 'Gareth', ST_SetSRID(ST_MakePoint(1, 2), 4326)), (2, 'Havena', NULL)",
                WEGWERF_ROLLE,
            );
            const dump = join(arbeit, "daten.dump");
            const gesichert = spawnSync(join(programme, "pg_dump"), ["-Fc", "--dbname", db.url, "-f", dump], {
                encoding: "utf8",
            });
            expect(gesichert.status, gesichert.stderr).toBe(0);
            // Ziel: leer und OHNE PostGIS, Besitzer ist die Rolle ohne Sonderrechte.
            psql(
                "postgres",
                `CREATE DATABASE ziel OWNER ${WEGWERF_ROLLE} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
            );
            const ziel = db.url.replace(`/${WEGWERF_DATENBANK}`, "/ziel");
            const optionen = {
                bin: programme,
                url: ziel,
                port: db.port,
                datenbank: "ziel",
                dump,
                arbeitsordner: arbeit,
                env: process.env,
            };

            const erster = await spieleTestpaketEin(optionen);
            expect(erster.erweiterungen).toEqual(["postgis"]);
            expect(psql("ziel", "SELECT count(*) FROM ort")).toBe("2");
            expect(psql("ziel", "SELECT ST_AsText(geom) FROM ort WHERE id = 1")).toBe("POINT(1 2)");
            expect(psql("ziel", "SELECT version FROM schema_migration")).toBe("0001_a");
            expect(
                psql("ziel", "SELECT tableowner FROM pg_tables WHERE tablename = 'ort'"),
                "Besitzer ist die App-Rolle",
            ).toBe(WEGWERF_ROLLE);

            // Zweiter Versuch in dieselbe Datenbank: Objekte existieren schon → rot, mit dem Ende des Protokolls.
            await expect(spieleTestpaketEin(optionen)).rejects.toThrow(
                /korpus-laden: pg_restore Exit \d+: .*already exists/s,
            );
        } finally {
            db.stoppe();
            rmSync(arbeit, { recursive: true, force: true });
        }
    });

    it("ein Archiv, das keines ist, wird mit klarem Satz abgewiesen", async () => {
        const arbeit = mkdtempSync(join(tmpdir(), "release-testpaket-kaputt-"));
        try {
            const dump = join(arbeit, "daten.dump");
            writeFileSync(dump, "kein Archiv");
            await expect(
                spieleTestpaketEin({
                    bin: bin as string,
                    url: "postgres://x@127.0.0.1:1/x",
                    port: 1,
                    datenbank: "x",
                    dump,
                    arbeitsordner: arbeit,
                    env: process.env,
                }),
            ).rejects.toThrow("kein lesbares pg_dump-Archiv");
        } finally {
            rmSync(arbeit, { recursive: true, force: true });
        }
    });
});
