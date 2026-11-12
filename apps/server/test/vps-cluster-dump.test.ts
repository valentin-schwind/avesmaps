import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresBin, pruefeDumpJournal, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Option `dump` von `startVpsCluster` (WI-0264 S2): ein `pg_dump` kommt als `migrate` in den Cluster, BEVOR die Migrationen des Kandidaten
 * laufen, danach folgen `regrant` und die Kartendomänen. Der echte Dump (`daten.dump` des Testpakets, rund 1 GB) ist hier zu groß; ein
 * Dump eines migrierten Wegwerf-Clusters (ohne das Schema `avesmaps_ops` der Sonde, das `sql_env` selbst anlegt) prüft denselben Weg und die
 * drei Wege, auf denen das Einspielen laut scheitern muss: Datei fehlt, Dump neuer als der Kandidat, Prüfsumme einer angewendeten Migration weicht ab.
 */

const ENV = "dumpprobe";
const describeWithCluster = postgresBin ? describe : describe.skip;

describe("Dump im Cluster: das Journal des Dumps gegen die Migrationen des Kandidaten (ohne Datenbank)", () => {
    const kandidat = ["0001_a", "0002_b", "0003_c"];

    it("ein Journal, das der Kandidat vollständig oder bis auf neuere Migrationen kennt, ist in Ordnung", () => {
        expect(() => pruefeDumpJournal(["0001_a", "0002_b"], kandidat, "x.dump")).not.toThrow();
        expect(() => pruefeDumpJournal(kandidat, kandidat, "x.dump")).not.toThrow();
    });

    it("ein Journal mit einer Migration, die der Kandidat nicht kennt, ist rot und nennt sie", () => {
        expect(() => pruefeDumpJournal(["0001_a", "0009_neu"], kandidat, "x.dump")).toThrow(
            /neuer als der Kandidat.*0009_neu/u,
        );
    });

    it("ein leeres Journal ist rot, statt still alle Migrationen anzuwenden", () => {
        expect(() => pruefeDumpJournal([], kandidat, "x.dump")).toThrow(/schema_migration ist leer oder fehlt/u);
    });
});

describeWithCluster("Dump im Cluster: Einspielen vor den Migrationen (Wegwerf-Cluster)", () => {
    let ordner: string;
    let gut: string;
    let zukunft: string;
    let pruefsumme: string;

    beforeAll(async () => {
        ordner = mkdtempSync(join(tmpdir(), "avesmaps3d-dumpprobe-"));
        const quelle: VpsCluster = await startVpsCluster(ENV, [], { mapDomains: true });
        try {
            const optionen = quelle.admin.options;
            const adresse = `postgres://postgres@127.0.0.1:${String(optionen.port[0])}/${String(optionen.database)}`;
            const dumpe = (name: string): string => {
                const datei = join(ordner, name);
                execFileSync(join(postgresBin!, process.platform === "win32" ? "pg_dump.exe" : "pg_dump"), [
                    "-Fc",
                    "-N",
                    "avesmaps_ops",
                    "-f",
                    datei,
                    adresse,
                ]);
                return datei;
            };
            // Eine Tafel, die nur der Dump kennt: Sie beweist, dass der Inhalt ankommt und dass die Migrationsrolle sie besitzt.
            await quelle.migrator`CREATE TABLE dump_marke AS SELECT 42 AS wert`;
            gut = dumpe("gut.dump");
            await quelle.admin`INSERT INTO schema_migration (version, checksum) VALUES ('9999_zukunft', 'x')`;
            zukunft = dumpe("zukunft.dump");
            await quelle.admin`DELETE FROM schema_migration WHERE version = '9999_zukunft'`;
            await quelle.admin`UPDATE schema_migration SET checksum = 'verfaelscht' WHERE version = (SELECT min(version) FROM schema_migration)`;
            pruefsumme = dumpe("pruefsumme.dump");
        } finally {
            await quelle.stop();
        }
    }, 180_000);

    afterAll(() => {
        if (ordner !== undefined) rmSync(ordner, { recursive: true, force: true });
    });

    it("spielt den Dump als Besitzerin ein, wendet nichts doppelt an und liefert die Daten", async () => {
        const cluster = await startVpsCluster(ENV, [], { mapDomains: true, dump: gut });
        try {
            const [marke] = await cluster.admin<{ wert: number; besitzerin: string }[]>`
                SELECT m.wert, t.tableowner AS besitzerin FROM dump_marke m, pg_tables t WHERE t.tablename = 'dump_marke'
            `;
            expect(marke).toEqual({ wert: 42, besitzerin: cluster.roles.migrate });
            expect(cluster.dump).toBe(gut);
            // Das Journal wurde nicht verdoppelt: Jede Version steht einmal da.
            const [journal] = await cluster.admin<{ n: number; verschieden: number }[]>`
                SELECT count(*)::int AS n, count(DISTINCT version)::int AS verschieden FROM schema_migration
            `;
            expect(journal!.n).toBe(journal!.verschieden);
        } finally {
            await cluster.stop();
        }
    }, 120_000);

    it("eine fehlende Datei scheitert sofort, ohne einen Cluster zu starten", async () => {
        await expect(startVpsCluster(ENV, [], { dump: join(ordner, "gibt-es-nicht.dump") })).rejects.toThrow(
            /Dump nicht gefunden/u,
        );
    });

    it("ein Dump neuer als der Kandidat scheitert laut", async () => {
        await expect(startVpsCluster(ENV, [], { dump: zukunft })).rejects.toThrow(
            /neuer als der Kandidat.*9999_zukunft/u,
        );
    }, 120_000);

    it("eine abweichende Prüfsumme einer angewendeten Migration scheitert laut und nennt den Dump", async () => {
        await expect(startVpsCluster(ENV, [], { dump: pruefsumme })).rejects.toThrow(
            /Migrationen des Kandidaten auf dem Dump .*pruefsumme\.dump.*different checksum/u,
        );
    }, 120_000);
});
