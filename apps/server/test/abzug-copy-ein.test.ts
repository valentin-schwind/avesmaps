import { Readable } from "node:stream";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ladeStrom } from "../src/abzug/copy-ein.ts";

/**
 * `ladeStrom` gegen eine echte Datenbank (WI-0251). Die Tafel liegt nur in der Transaktion (`TEMP`), jeder Fall rollt zurück.
 *
 * 🔴 Fehlerbericht 2026-10-25: Ein Stage-Abzug scheiterte lokal an `public.adventure` (787 KB) mit „COPY abgelehnt“, obwohl die Daten gültig waren.
 * Bei einem großen Strom reicht postgres.js noch Daten an den Server, wenn die Quelle schon zu Ende ist; die Sonde dahinter wies postgres.js dann selbst
 * ab (`COPY_IN_PROGRESS`), und das las sich wie eine Absage des Servers.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Zeilen im Textformat, in Stücken von 64 KB wie ein Dateistrom (`createReadStream`) sie liefert. */
function zeilen(anzahl: number, falsch?: number): Readable {
    const text = "x".repeat(200);
    const alles = Buffer.from(
        Array.from({ length: anzahl }, (_, i) => `${String(i === falsch ? -1 : i)}\t${text}\n`).join(""),
    );
    return Readable.from(
        (function* () {
            for (let ab = 0; ab < alles.length; ab += 65_536) yield alles.subarray(ab, ab + 65_536);
        })(),
    );
}

describeWithDatabase("ladeStrom", () => {
    const sql = postgres(testDatabaseUrl ?? "", { max: 1, onnotice: () => {} });
    afterAll(async () => {
        await sql.end({ timeout: 5 });
    });

    /**
     * 🔴 Die Transaktion endet mit COMMIT, wie beim Einspielen (die Tafel fällt dabei weg): `sql.begin` merkt sich jede abgelehnte Abfrage der
     * Transaktion, auch eine abgefangene, und wirft sie erst am Ende (Fehlerbericht 2026-10-25: alle Tafeln geladen, dann `COPY_IN_PROGRESS`).
     */
    async function lade(quelle: Readable): Promise<number> {
        return sql.begin(async (tx) => {
            await tx.unsafe("CREATE TEMP TABLE probe (n int CHECK (n >= 0), t text) ON COMMIT DROP");
            await ladeStrom(tx, "COPY probe (n, t) FROM STDIN", quelle);
            const [zeile] = await tx.unsafe<{ n: string }[]>("SELECT count(*)::text AS n FROM probe");
            return Number(zeile?.n);
        });
    }

    it("🔴 lädt einen großen Strom vollständig, auch wenn die Quelle endet, bevor der Server alles hat", async () => {
        expect(await lade(zeilen(40_000))).toBe(40_000);
    });

    it("lädt einen kleinen Strom", async () => {
        expect(await lade(zeilen(3))).toBe(3);
    });

    it("🔴 meldet eine Absage des Servers mitten in einem großen Strom mit ihrem Grund, ohne unbehandelte Ablehnung", async () => {
        await expect(lade(zeilen(40_000, 20_000))).rejects.toThrow(/probe_n_check/u);
    });

    it("🔴 meldet eine Absage des Servers in der letzten Zeile, statt zu hängen", async () => {
        await expect(lade(zeilen(40_000, 39_999))).rejects.toThrow(/probe_n_check|COPY abgelehnt/u);
    });

    it("meldet eine Absage des Servers in einem kleinen Strom", async () => {
        await expect(lade(zeilen(3, 2))).rejects.toThrow(/probe_n_check|COPY abgelehnt/u);
    });
});
