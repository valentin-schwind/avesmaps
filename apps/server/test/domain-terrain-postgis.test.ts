import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { createFinding } from "../src/findings.ts";
import { migrate } from "../src/db/migrate.ts";
import { loadDomainInputs } from "../src/terrain/domain/inputs.ts";
import { initialHeight } from "../src/terrain/domain/shape.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { storeDomainRaster } from "../src/terrain/domain/store.ts";
import { burnRivers } from "../src/terrain/river-burn.ts";
import { activateDomainDem } from "../src/terrain/domain/activate.ts";
import { terrainRecipeCoverage } from "../src/terrain/domain/coverage.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";

const url = process.env["TEST_DATABASE_URL"];
const databaseSuite = url ? describe : describe.skip;
databaseSuite("Domain generator input against real PostgreSQL/PostGIS", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(url!);
        await migrate(database);
    });
    afterAll(async () => {
        await database.end({ timeout: 5 });
    });
    it("rejects activation without a verified publication and preserves the existing pointer", async () => {
        const before =
            await database`SELECT revision FROM terrain_dem WHERE map_domain_id = 'aventuria' AND is_current`;
        await expect(activateDomainDem(database, "aventuria", "missing-domain-fixture")).rejects.toThrow(/missing/i);
        const after = await database`SELECT revision FROM terrain_dem WHERE map_domain_id = 'aventuria' AND is_current`;
        expect(after).toEqual(before);
    });
    it("round-trips the full report as a JSON object with constraints and provenance", async () => {
        const rollback = new Error("rollback derived raster fixture");
        try {
            await database.begin(async (tx) => {
                const raster = {
                    width: 4096,
                    height: 4096,
                    cell: 0.25,
                    originX: 0.125,
                    originY: 0.125,
                    samples: new Uint16Array(4096 * 4096),
                };
                const report = {
                    ignoredPeaks: [],
                    masses: [{ before: 0, after: 0 }],
                    generator: "1",
                    burn: burnRivers([raster], { rivers: [], lakes: [] }),
                    provenance: { GENERATED_LEGACY_SEED: [], GENERATED_PEAK_FALLBACK: [] },
                    // Betreiber 2026-10-03: Randbedingungen stehen als Befunde im Bericht und überleben die Speicherung.
                    findings: [
                        createFinding("gelaende/see_nicht_eben", "Seen: 1 See ist nicht eben", { seen: 1 }, [
                            { table: "region_area (See)", publicId: "Eingabe-Nr. 328", name: "Höhen 60..5000 Schritt" },
                        ]),
                    ],
                };
                await storeDomainRaster(tx, "aventuria", "fixture-input", {
                    raster,
                    fingerprint: "fixture-json-report",
                    report,
                });
                const [stored] = await tx<{ report: typeof report; type: string }[]>`
                    SELECT report, jsonb_typeof(report) AS type FROM terrain_domain_raster
                    WHERE map_domain_id = 'aventuria' AND fingerprint = 'fixture-json-report'
                `;
                expect(stored!.type).toBe("object");
                expect(stored!.report).toEqual(report);
                expect(stored!.report.burn.converged).toBe(true);
                expect(stored!.report.findings[0]?.objects[0]?.publicId).toBe("Eingabe-Nr. 328");
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    });
    it("reads the actual continent geometry; changing only that geometry changes mask and fingerprint", async () => {
        const rollback = new Error("rollback synthetic domain fixture");
        try {
            await database.begin(async (tx) => {
                const [region] = await tx<{ id: number }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
                    VALUES ('00000000-0000-4000-8000-0000000067a1', 'aventuria', 'Aventurien', 'derographisch', 'kontinent')
                    RETURNING id
                `;
                await tx`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                    VALUES ('00000000-0000-4000-8000-0000000067a2', 'aventuria', ${region!.id}, ST_MakeEnvelope(256,256,768,768,0))
                `;
                const before = await loadDomainInputs(tx, "aventuria");
                const [materialRegion] = await tx<{ id: number }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
                    VALUES ('00000000-0000-4000-8000-0000000067a3', 'aventuria', 'Unmapped terrain fixture', 'vegetation', null)
                    RETURNING id
                `;
                await tx`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                    VALUES ('00000000-0000-4000-8000-0000000067a4', 'aventuria', ${materialRegion!.id}, ST_MakeEnvelope(300,300,400,400,0))
                `;
                const active = await loadDomainInputs(tx, "aventuria");
                expect(terrainRecipeCoverage(active.landscapes, AVENTURIA_TERRAIN_RECIPE).missing).toContainEqual({
                    layer: "vegetation",
                    type: null,
                    count: 1,
                    handling: "neutral-unmapped",
                });
                await tx`UPDATE region_area SET is_active = false WHERE public_id = '00000000-0000-4000-8000-0000000067a4'`;
                const inactive = await loadDomainInputs(tx, "aventuria");
                expect(inactive.landscapes).toEqual(before.landscapes);
                await tx`UPDATE region_area SET geom = ST_MakeEnvelope(256,256,896,768,0)
                    WHERE public_id = '00000000-0000-4000-8000-0000000067a2'`;
                const after = await loadDomainInputs(tx, "aventuria");
                expect(before.continent.id).toBe("00000000-0000-4000-8000-0000000067a2");
                expect(after.fingerprint).not.toBe(before.fingerprint);
                const first = initialHeight(grid(64), before.land, 300, 100);
                const second = initialHeight(grid(64), after.land, 300, 100);
                expect(second.land).not.toEqual(first.land);
                expect(second.height).not.toEqual(first.height);
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    });
});
