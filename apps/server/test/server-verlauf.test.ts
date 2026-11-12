import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseServerVerlauf } from "../src/besucher/server-verlauf.ts";
import { schreibeStichprobe, verdichteStunden } from "../src/system/stichprobe.ts";
import type { OsMesswerte } from "../src/system/messwerte.ts";

/**
 * Der Verlauf der Serverlast (WI-0141): die Verdichtung zu Stundenmitteln und was der Leseweg daraus macht.
 *
 * Die Fälle sind die Zusagen: Nur volle Stunden werden verdichtet, ein zweiter Lauf ändert nichts, die Spitze bleibt
 * neben dem Mittel stehen, und eine Lücke bleibt eine Lücke.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const werte = (last: number, belegt: number): OsMesswerte => ({
    last: { eins: last, fuenf: last, fuenfzehn: last },
    kerne: 4,
    speicher: { gesamt: 8_000_000_000, belegt, auslagerung: 0, auslagerungGesamt: 0 },
    laufzeit: { system: 1000, prozess: 100 },
    rss: 500_000_000,
});

describeWithDatabase("Serververlauf gegen die Datenbank", { timeout: 60_000 }, () => {
    let sql: Database;

    beforeAll(async () => {
        sql = createDatabase(testDatabaseUrl!);
        await migrate(sql);
    });

    beforeEach(async () => {
        await sql`DELETE FROM system_sample`;
        await sql`DELETE FROM system_hour`;
    });

    afterAll(async () => {
        await sql`DELETE FROM system_sample`;
        await sql`DELETE FROM system_hour`;
        await sql.end();
    });

    it("🔴 verdichtet nur abgeschlossene Stunden - die laufende wäre ein Mittel über zehn Minuten", async () => {
        const jetzt = new Date("2026-10-14T12:20:00Z");
        // Zwei Stichproben in der vollen Stunde 11, eine in der laufenden Stunde 12.
        await schreibeStichprobe(sql, werte(1, 1_000_000_000), new Date("2026-10-14T11:05:00Z"), 0.2);
        await schreibeStichprobe(sql, werte(3, 3_000_000_000), new Date("2026-10-14T11:45:00Z"), 0.6);
        await schreibeStichprobe(sql, werte(9, 9_000_000_000), new Date("2026-10-14T12:15:00Z"), 0.9);

        await verdichteStunden(sql, jetzt);
        const zeilen = await sql<
            { hour: Date; proben: number; cpu: number; cpu_max: number; load1: number }[]
        >`SELECT hour, proben, cpu, cpu_max, load1 FROM system_hour ORDER BY hour`;

        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]?.proben).toBe(2);
        expect(zeilen[0]?.cpu).toBeCloseTo(0.4, 3);
        // Die Spitze steht neben dem Mittel: Sie ist das, was der Betreiber sucht.
        expect(zeilen[0]?.cpu_max).toBeCloseTo(0.6, 3);
        expect(zeilen[0]?.load1).toBeCloseTo(2, 3);
    });

    it("ist wiederholbar: derselbe Lauf schreibt dieselbe Zeile, nicht die doppelte Summe", async () => {
        await schreibeStichprobe(sql, werte(2, 2_000_000_000), new Date("2026-10-14T09:05:00Z"), 0.5);
        const jetzt = new Date("2026-10-14T11:00:00Z");
        await verdichteStunden(sql, jetzt);
        await verdichteStunden(sql, jetzt);
        const [zeile] = await sql<{ proben: number; cpu: number }[]>`SELECT proben, cpu FROM system_hour`;
        expect(zeile?.proben).toBe(1);
        expect(zeile?.cpu).toBeCloseTo(0.5, 3);
    });

    it("🔴 eine Stunde ohne Messung bleibt leer, sie wird nicht zu null", async () => {
        await schreibeStichprobe(sql, werte(1, 1_000_000_000), new Date("2026-10-14T08:05:00Z"), null);
        await verdichteStunden(sql, new Date("2026-10-14T11:00:00Z"));
        const verlauf = await leseServerVerlauf(sql);
        // Die Stunde steht da (es gab eine Probe), aber ihr CPU-Wert ist unbekannt, nicht 0.
        expect(verlauf.stunden).toBe(1);
        expect(verlauf.tage[0]?.cpu).toBeNull();
        // Die Tafel hat sieben Zeilen zu vierundzwanzig Stunden, und fast alles ist eine Lücke.
        expect(verlauf.tafel).toHaveLength(7);
        expect(verlauf.tafel[0]).toHaveLength(24);
        expect(verlauf.tafel.flat().filter((wert) => wert !== null)).toHaveLength(0);
    });

    it("liefert die letzten 24 Stunden fein und die Tage verdichtet", async () => {
        const jetzt = new Date();
        const vorMinuten = (m: number): Date => new Date(jetzt.getTime() - m * 60_000);
        await schreibeStichprobe(sql, werte(1, 1_000_000_000), vorMinuten(90), 0.1);
        await schreibeStichprobe(sql, werte(2, 2_000_000_000), vorMinuten(30), 0.3);
        await verdichteStunden(sql, jetzt);

        const verlauf = await leseServerVerlauf(sql);
        expect(verlauf.tag.length).toBeGreaterThanOrEqual(2);
        expect(verlauf.tag.at(-1)?.ramGesamt).toBe(8_000_000_000);
        expect(verlauf.tage.length).toBeGreaterThanOrEqual(1);
    });
});
