import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { tileRevision } from "../src/terrain/dem-tiles.ts";
import { demTilesOfComputeTiles, manifestChecks, pyramidTileCount } from "../src/terrain/domain/verify-manifest.ts";

/**
 * Das Manifest einer Pyramide und der vorläufige Master (WI-0125, JOBS-0001 V2 und D6 = B): Jede Kachel trägt den Inhalts-Hash ihrer
 * Bytes; bei einem lokal veröffentlichten Master hat jede Kachel außerhalb des Fußabdrucks dieselbe Revision wie die Pyramide, auf
 * die er aufgesetzt wurde. Alles in einer Transaktion, die am Ende zurückrollt.
 */

describe("Rechenkacheln und DEM-Kacheln", () => {
    it("🔴 eine Rechenkachel (1024²) sind 2 × 2 Kacheln der Stufe 4 und je eine Kachel jeder gröberen Stufe", () => {
        const keys = demTilesOfComputeTiles([0], 4);
        expect([...keys].sort()).toEqual(["0/0/0", "1/0/0", "2/0/0", "3/0/0", "4/0/0", "4/0/1", "4/1/0", "4/1/1"]);
        // Rechenkachel 63 liegt unten rechts (ty 7, tx 7).
        expect(demTilesOfComputeTiles([63], 4).has("4/15/15")).toBe(true);
        expect(pyramidTileCount(4)).toBe(341);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Prüfung des Manifests (verify:terrain-dem)", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl ?? "", { max: 2 });
        await migrate(database);
    });
    afterAll(() => database.end({ timeout: 5 }));

    it("🔴 meldet einen vorläufigen Master als Befund und jede geänderte Kachel außerhalb seines Fußabdrucks", async () => {
        const rollback = new Error("Fixture zurückrollen");
        const samples = Buffer.alloc(4096 * 4096 * 2);
        const tile = (n: number): Buffer => Buffer.from([n, n + 1, n + 2]);
        try {
            await database.begin(async (tx) => {
                for (const [fingerprint, provisional, base, local] of [
                    ["wi0125-basis", false, null, null],
                    ["wi0125-lokal", true, "wi0125-basis", [0]],
                ] as const) {
                    await tx`INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, provisional, base_fingerprint, local_tiles)
                        VALUES ('aventuria', ${fingerprint}, 'wi0125', '1', 4096, ${samples}, '{}', ${provisional}, ${base}, ${local === null ? null : tx.array([...local], 21)})`;
                }
                for (const [revision, master] of [
                    ["a0124a000001", "wi0125-basis"],
                    ["a0124a000002", "wi0125-lokal"],
                ] as const) {
                    await tx`INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, domain_fingerprint, format)
                        VALUES (${revision}, 'aventuria', 'wi0125', 512, 4, 'mapbox', 3, 9, ${master}, 'webp')`;
                }
                // Basis: drei Kacheln. Lokal: 4/0/0 im Fußabdruck geändert (gewollt), 4/5/5 außerhalb geändert (Befund).
                await tx`INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES
                    ('a0124a000001', 4, 0, 0, ${tile(1)}), ('a0124a000001', 4, 5, 5, ${tile(2)}), ('a0124a000001', 0, 0, 0, ${tile(3)}),
                    ('a0124a000002', 4, 0, 0, ${tile(11)}), ('a0124a000002', 4, 5, 5, ${tile(12)}), ('a0124a000002', 0, 0, 0, ${tile(13)})`;

                const [row] = await tx<{ tile_revision: string }[]>`
                    SELECT tile_revision FROM terrain_dem_tile WHERE revision = 'a0124a000002' AND z = 4 AND x = 0 AND y = 0`;
                expect(row?.tile_revision).toBe(tileRevision(tile(11)));

                const base = await manifestChecks(tx, "aventuria", "a0124a000001", "wi0125-basis");
                expect(base.map((check) => [check.name, check.passed])).toEqual([
                    ["Manifest: jede Kachel trägt ihre Revision", false],
                ]);
                expect(base[0]?.detail).toContain("3 von 341 Kacheln, 0 mit falscher");

                const local = await manifestChecks(tx, "aventuria", "a0124a000002", "wi0125-lokal");
                expect(local.map((check) => [check.name, check.passed])).toEqual([
                    ["Manifest: jede Kachel trägt ihre Revision", false],
                    ["Master vorläufig (lokal veröffentlicht, voller Lauf ausstehend)", false],
                    ["Kacheln außerhalb des Fußabdrucks unverändert", false],
                ]);
                expect(local[2]?.offenders).toEqual(["4/5/5"]);
                expect(local[2]?.detail).toContain("3 Kacheln anders als in a0124a000001, davon 1 außerhalb");
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    });
});
