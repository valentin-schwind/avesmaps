import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { diffInputIndex, loadDomainInputIndex, readInputIndex } from "../src/terrain/domain/input-index.ts";

/**
 * Der Eingabeindex eines Masters (WI-0125): je Objekt Fingerabdruck und Rahmen, aus der Datenbank gelesen. Eine Änderung an Geometrie,
 * Höhe oder Art macht genau dieses Objekt anders; alles in einer Transaktion, die zurückrollt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Eingabeindex (terrain_local)", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl ?? "", { max: 2 });
        await migrate(database);
    });
    afterAll(() => database.end({ timeout: 5 }));

    it("🔴 nennt Flächen und Gipfel mit Rahmen, und eine Änderung trifft genau das geänderte Objekt", async () => {
        const rollback = new Error("Fixture zurückrollen");
        const AREA = "00000000-0000-4000-8000-000000012401";
        const PEAK = "00000000-0000-4000-8000-000000012402";
        try {
            await database.begin(async (tx) => {
                const [region] = await tx<{ id: number }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
                    VALUES ('00000000-0000-4000-8000-000000012400', 'aventuria', 'Testwald', 'vegetation', 'wald')
                    RETURNING id`;
                await tx`INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                    VALUES (${AREA}, 'aventuria', ${region?.id ?? 0}, ST_MakeEnvelope(100, 200, 140, 260, 0))`;
                await tx`INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, source_system)
                    VALUES (${PEAK}, 'aventuria', 'Testgipfel', 'berggipfel', ST_SetSRID(ST_MakePoint(575, 615), 0), 2000, 'test')`;

                const before = await loadDomainInputIndex(tx, "aventuria");
                expect(before.objects[`area:${AREA}`]?.slice(1)).toEqual([100, 200, 140, 260]);
                expect(before.objects[`peak:${PEAK}`]?.slice(1)).toEqual([575, 615, 575, 615]);
                // Gespeichert und wieder gelesen (jsonb) ist es derselbe Index.
                expect(readInputIndex(JSON.parse(JSON.stringify(before)))).toEqual(before);
                expect(readInputIndex({ v: 2, objects: {} })).toBeNull();

                await tx`UPDATE terrain_peak SET height_schritt = 2500 WHERE public_id = ${PEAK}`;
                await tx`UPDATE region_area SET geom = ST_MakeEnvelope(100, 200, 150, 260, 0) WHERE public_id = ${AREA}`;
                const after = await loadDomainInputIndex(tx, "aventuria");
                const changes = diffInputIndex(before, after);
                expect(changes.map((change) => change.key)).toEqual([`area:${AREA}`, `peak:${PEAK}`]);
                expect(changes[0]?.before?.slice(1)).toEqual([100, 200, 140, 260]);
                expect(changes[0]?.after?.slice(1)).toEqual([100, 200, 150, 260]);
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
    });
});
