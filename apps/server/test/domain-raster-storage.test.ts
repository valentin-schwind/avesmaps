import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { storeDomainRaster } from "../src/terrain/domain/store.ts";

/**
 * Das Domain-Raster liegt unkomprimiert in `terrain_domain_raster` (WI-0071 Nachtrag 3).
 *
 * 🪤 Die Hilfstabelle von `storeDomainRaster` hatte die Vorgabe `STORAGE EXTENDED` und komprimierte das Master (pglz,
 * 128 → 42 MiB); `INSERT … SELECT` in die `EXTERNAL`-Spalte ließ den Wert komprimiert, denn `EXTERNAL` komprimiert nichts
 * und entpackt auch nichts. Jedes `substring()` des Routing-Laders entpackte dann alles vor seiner Scheibe: auf Stage
 * 17,8 s statt 0,9 s für `heights`. Der Test legt ein komprimierbares Master ab (glatt wie ein Höhenmodell) und fragt,
 * wie die Zeile daliegt.
 */

/** Der Bericht gehört nicht zur Sache; `storeDomainRaster` legt ihn nur ab. */
type StoreResult = Parameters<typeof storeDomainRaster>[3];

const url = process.env["TEST_DATABASE_URL"];
const databaseSuite = url ? describe : describe.skip;

/** Eine glatte Fläche: komprimiert sich gut, wenn irgendwo komprimiert wird. */
function smoothRaster(size: number, salt: number): Uint16Array {
    const samples = new Uint16Array(size * size);
    for (let index = 0; index < samples.length; index += 1)
        samples[index] = ((index % size) >> 4) + (index >> 17) + salt;
    return samples;
}

databaseSuite("storeDomainRaster legt das Raster unkomprimiert ab", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(url ?? "");
        await migrate(database);
    });
    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 die Zeile ist nicht komprimiert, auch beim zweiten Aufruf in derselben Transaktion, und die Bytes stimmen", async () => {
        const rollback = new Error("rollback raster storage fixture");
        const size = 4096;
        const rasters = [smoothRaster(size, 0), smoothRaster(size, 7)];
        try {
            await database.begin(async (tx) => {
                for (const [index, samples] of rasters.entries()) {
                    await storeDomainRaster(tx, "aventuria", "fixture-input", {
                        raster: { width: size, height: size, cell: 0.25, originX: 0.125, originY: 0.125, samples },
                        fingerprint: `fixture-uncompressed-${String(index)}`,
                        report: {},
                    } as unknown as StoreResult);
                }
                const stored = await tx<
                    { fingerprint: string; raw: number; stored: number; compression: string | null; md5: string }[]
                >`
                    SELECT fingerprint, octet_length(samples) AS raw, pg_column_size(samples) AS stored,
                        pg_column_compression(samples) AS compression, md5(samples) AS md5
                    FROM terrain_domain_raster
                    WHERE map_domain_id = 'aventuria' AND fingerprint LIKE 'fixture-uncompressed-%'
                    ORDER BY fingerprint
                `;
                expect(stored).toHaveLength(2);
                for (const [index, row] of stored.entries()) {
                    // Nicht komprimiert: kein Verfahren, und die gespeicherte Größe ist die Länge.
                    expect(row.compression, row.fingerprint).toBeNull();
                    expect(row.stored, row.fingerprint).toBeGreaterThanOrEqual(row.raw);
                    expect(row.raw).toBe(size * size * 2);
                    // Und es ist das, was hineingegangen ist.
                    const bytes = Buffer.from((rasters[index] as Uint16Array).buffer);
                    expect(row.md5, row.fingerprint).toBe(createHash("md5").update(bytes).digest("hex"));
                }
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    }, 120_000);
});
