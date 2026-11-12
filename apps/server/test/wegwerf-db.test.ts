import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    WEGWERF_DATENBANK,
    WEGWERF_ROLLE,
    findePostgres,
    starteWegwerfDb,
    umgebungMitTestdatenbank,
} from "../../../scripts/dev/wegwerf-db.ts";
import { createDatabase } from "../src/database.ts";
import { TESTDB_VAR } from "./support/test-umgebung.ts";

/**
 * Der Wegwerf-Postgres der Datenbanktests (`scripts/dev/wegwerf-db.ts`, WI-0224). Problemfälle: ein halber Satz PostgreSQL-Programme
 * zählt nicht; die Umgebung des Aufrufers darf keine fremde Datenbank in den Testlauf tragen; der Cluster hat die Rolle ohne
 * Sonderrechte und PostGIS und hinterlässt nach dem Beenden weder Prozess noch Verzeichnis.
 *
 * 🪤 Die Namen der Datenbankvariablen stehen hier zusammengesetzt, damit diese Datei nicht selbst als Datenbanktest zählt (die
 * Pfadregel erkennt sie am Quelltext).
 */
const ENTWICKLUNGSDB_VAR = ["DATABASE", "URL"].join("_");
const JOBS_VAR = ["JOBS", "DATABASE", "URL"].join("_");
const KANAL_VAR = ["KANAL", "DATABASE", "URL"].join("_");

describe("findePostgres", () => {
    it("🔴 nimmt PG_BIN_DIR, wenn dort alle fünf Programme liegen", () => {
        const gefunden = findePostgres({ PG_BIN_DIR: "X", PATH: "" }, (pfad) => pfad.startsWith(join("X", "")));
        expect(gefunden).toBe("X");
    });

    it("🔴 ein Ordner mit nur einem Teil der Programme zählt nicht; der erste vollständige im Suchpfad gewinnt", () => {
        const halb = join("Y", "initdb");
        const gefunden = findePostgres(
            { PATH: ["Y", "Z"].join(delimiter) },
            (pfad) => pfad.startsWith(halb) || pfad.startsWith(join("Z", "")),
        );
        expect(gefunden).toBe("Z");
    });

    it("kein vollständiger Ordner: undefined", () => {
        expect(findePostgres({ PG_BIN_DIR: "X", PATH: "" }, () => false)).toBeUndefined();
    });
});

describe("umgebungMitTestdatenbank", () => {
    it("🔴 setzt die Testdatenbank und nimmt jede andere Datenbank des Aufrufers weg", () => {
        const env = umgebungMitTestdatenbank(
            {
                [ENTWICKLUNGSDB_VAR]: "postgres://dev",
                [JOBS_VAR]: "postgres://jobs",
                [KANAL_VAR]: "postgres://kanal",
                [TESTDB_VAR]: "postgres://alt",
                PATH: "p",
            },
            "postgres://wegwerf",
        );
        expect(env[TESTDB_VAR]).toBe("postgres://wegwerf");
        expect(env[ENTWICKLUNGSDB_VAR]).toBeUndefined();
        expect(env[JOBS_VAR]).toBeUndefined();
        expect(env[KANAL_VAR]).toBeUndefined();
        expect(env["PATH"]).toBe("p");
    });

    it("verändert die übergebene Umgebung nicht", () => {
        const roh = { [ENTWICKLUNGSDB_VAR]: "postgres://dev" };
        umgebungMitTestdatenbank(roh, "postgres://wegwerf");
        expect(roh[ENTWICKLUNGSDB_VAR]).toBe("postgres://dev");
    });
});

const bin = findePostgres();

/** Ob an `127.0.0.1:port` noch jemand lauscht. */
function lauscht(port: number): Promise<boolean> {
    return new Promise((erfuellt) => {
        const verbindung = net.connect({ host: "127.0.0.1", port });
        verbindung.once("connect", () => {
            verbindung.destroy();
            erfuellt(true);
        });
        verbindung.once("error", () => erfuellt(false));
    });
}

// Ohne PostgreSQL-Programme überspringt die Probe sichtbar (wie `vps-cluster.ts`), statt still grün zu sein.
describe.skipIf(bin === undefined)("Wegwerf-Postgres", { timeout: 180_000 }, () => {
    it("🔴 startet leer mit Rolle ohne Sonderrechte und PostGIS und räumt nach dem Beenden alles weg", async () => {
        const db = await starteWegwerfDb({ bin: bin as string });
        let beendet = false;
        try {
            const verbindung = createDatabase(db.url, { max: 1 });
            try {
                const [zeile] = await verbindung<
                    { nutzer: string; datenbank: string; super: boolean; postgis: string }[]
                >`
                    SELECT current_user AS nutzer, current_database() AS datenbank,
                           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
                           postgis_version() AS postgis`;
                expect(zeile?.nutzer).toBe(WEGWERF_ROLLE);
                expect(zeile?.datenbank).toBe(WEGWERF_DATENBANK);
                expect(zeile?.super, "wie die Entwicklungsrolle: keine Sonderrechte").toBe(false);
                expect(zeile?.postgis).toMatch(/^\d/);
                const [tafeln] = await verbindung<{ n: string }[]>`
                    SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'`;
                expect(tafeln?.n, "leer: die Tests spielen die Migrationen selbst ein").toBe("0");
            } finally {
                await verbindung.end({ timeout: 5 });
            }
            expect(await lauscht(db.port)).toBe(true);
            db.stoppe();
            db.stoppe();
            beendet = true;
            expect(existsSync(db.verzeichnis), "Verzeichnis weg").toBe(false);
            expect(await lauscht(db.port), "Port frei").toBe(false);
        } finally {
            if (!beendet) db.stoppe();
        }
    });
});

describe.skipIf(bin === undefined)("Wegwerf-Postgres mit Saat", { timeout: 300_000 }, () => {
    it("🔴 spielt die Migrationen dieses Stands und die Kartendomänen ein (sonst scheitern Tests ohne eigenen Seed am Fremdschlüssel map_domain_id)", async () => {
        const wurzel = fileURLToPath(new URL("../../..", import.meta.url));
        const db = await starteWegwerfDb({ bin: bin as string, saat: wurzel });
        try {
            const verbindung = createDatabase(db.url, { max: 1 });
            try {
                const [zahlen] = await verbindung<{ migrationen: string; domaenen: string }[]>`
                    SELECT (SELECT count(*) FROM schema_migration)::text AS migrationen,
                           (SELECT count(*) FROM map_domain)::text AS domaenen`;
                expect(Number(zahlen?.migrationen), "alle Migrationen im Journal").toBeGreaterThan(100);
                expect(Number(zahlen?.domaenen), "mindestens die Domäne Aventurien").toBeGreaterThan(0);
            } finally {
                await verbindung.end({ timeout: 5 });
            }
        } finally {
            db.stoppe();
        }
    });

    it("ein Stand ohne Server-Quelltext: Start schlägt mit der Meldung fehl", async () => {
        const leer = mkdtempSync(join(tmpdir(), "avesmaps3d-ohnesaat-"));
        try {
            await expect(starteWegwerfDb({ bin: bin as string, saat: leer })).rejects.toThrow(
                /Migrationen und Kartendomänen nicht eingespielt/,
            );
        } finally {
            rmSync(leer, { recursive: true, force: true });
        }
    });
});
