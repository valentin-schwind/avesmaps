import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { deriveTerrainSeeds } from "../src/terrain/derive.ts";
import { loadMountainJobs } from "../src/terrain/inputs.ts";
import { leseGebirgsZusatz } from "../src/terrain/gebirge-zusatz.ts";

/**
 * Der Geländelauf liest gezeichnete Kämme (WI-0247, Bauplan „Gebirge aus gezeichneten Kämmen“ Schritt 3): Mit mindestens einem Kamm
 * trägt die Eingabe Netz, Pässe und Regler des Rückennetzes, ohne bleibt sie Zeichen für Zeichen die der V12. Der gefundene Talboden
 * wird gemerkt (Migration 0213) und gilt weiter, wenn sich nur Täler ändern.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eigene Kennungen (…0247…), damit der Test keinen fremden Bestand berührt. */
const ID = {
    region: "00000000-0000-4000-8000-0000000247a1",
    gebirge: "00000000-0000-4000-8000-0000000247a2",
};

describeWithDatabase("Geländelauf mit Rückennetz", () => {
    let database: Database;
    let areaId = 0;

    async function cleanup(): Promise<void> {
        await database`DELETE FROM terrain_raster WHERE area_id IN (SELECT id FROM region_area WHERE public_id = ${ID.gebirge})`;
        await database`DELETE FROM terrain_control WHERE area_id IN (SELECT id FROM region_area WHERE public_id = ${ID.gebirge})`;
        await database`DELETE FROM region_area WHERE public_id = ${ID.gebirge}`;
        await database`DELETE FROM region WHERE public_id = ${ID.region}`;
    }

    const job = async () => {
        const [gefunden] = await loadMountainJobs(database, "aventuria", [ID.gebirge]);
        if (!gefunden) throw new Error("Probegebirge fehlt");
        return gefunden;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanup();
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (${ID.region}, 'aventuria', 'Probe Rückennetz', 'topographie', 'gebirge', true)
            RETURNING id::text
        `;
        const [area] = await database<{ id: string }[]>`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${ID.gebirge}, 'aventuria', ${Number(region?.id)}, ST_MakeEnvelope(960, 960, 976, 970, 0), true)
            RETURNING id::text
        `;
        areaId = Number(area?.id);
        await database`
            INSERT INTO terrain_control (area_id, map_domain_id, source_system, maximalhoehe, talbreite)
            VALUES (${areaId}, 'aventuria', 'avesmaps3d', 2000, 1.5)
        `;
    });

    afterAll(async () => {
        await cleanup();
        await database.end({ timeout: 5 });
    });

    it("lässt ein Gebirge ohne Kamm bei der V12, mit Kamm trägt die Eingabe Netz und Regler des Rückennetzes", async () => {
        const ohne = await job();
        expect(ohne.input.kaemme).toBeUndefined();
        expect(ohne.input.rueckennetz).toBeUndefined();
        expect(ohne.talbodenFingerprint).toBeNull();
        expect(Object.keys(ohne.input)).toEqual([
            "bounds",
            "geometry",
            "peaks",
            "kurve",
            "fluesse",
            "seen",
            "regler",
            "saat",
        ]);

        await database`
            INSERT INTO terrain_ridge_edge (area_id, map_domain_id, ordinal, rang, geom)
            VALUES (${areaId}, 'aventuria', 0, 'haupt', ST_GeomFromText('LINESTRING(962 965, 968 966, 974 964)', 0)),
                   (${areaId}, 'aventuria', 1, 'neben', ST_GeomFromText('LINESTRING(968 966, 969 961)', 0))
        `;
        await database`
            INSERT INTO terrain_ridge_point (area_id, map_domain_id, ordinal, geom, height_schritt)
            VALUES (${areaId}, 'aventuria', 0, ST_GeomFromText('POINT(968 966)', 0), 1800)
        `;
        await database`UPDATE terrain_control SET grat = 0.12 WHERE area_id = ${areaId}`;
        const mit = await job();
        expect(mit.input.kaemme).toEqual([
            {
                rang: "haupt",
                punkte: [
                    [962, 965],
                    [968, 966],
                    [974, 964],
                ],
            },
            {
                rang: "neben",
                punkte: [
                    [968, 966],
                    [969, 961],
                ],
            },
        ]);
        expect(mit.input.nebengipfel).toEqual([{ x: 968, y: 966, h: 1800 }]);
        expect(mit.input.paesse).toEqual([]);
        expect(mit.input.rueckennetz?.form.grat).toBe(0.12);
        expect(mit.input.rueckennetz?.talbodenFest).toBeNull();
        expect(mit.fingerprint).not.toBe(ohne.fingerprint);
        expect(mit.talbodenFingerprint).not.toBeNull();

        // Nur Täler geändert: Die Eingabe ist eine andere, die Form für den Talboden dieselbe.
        await database`UPDATE terrain_control SET talbreite = 2.5 WHERE area_id = ${areaId}`;
        const taeler = await job();
        expect(taeler.fingerprint).not.toBe(mit.fingerprint);
        expect(taeler.talbodenFingerprint).toBe(mit.talbodenFingerprint);
    });

    it("rechnet das Gebirge mit dem Rückennetz und merkt sich den gefundenen Talboden", async () => {
        const bericht = await deriveTerrainSeeds(database, { only: [ID.gebirge], force: true });
        expect(bericht.failed).toEqual([]);
        const [zeile] = await database<
            {
                rueckennetz_talboden: number | null;
                rueckennetz_talboden_fingerprint: string | null;
                max_schritt: number;
            }[]
        >`
            SELECT rueckennetz_talboden, rueckennetz_talboden_fingerprint, max_schritt
            FROM terrain_raster WHERE area_id = ${areaId}
        `;
        expect(zeile?.rueckennetz_talboden).toBeGreaterThan(0);
        expect(zeile?.rueckennetz_talboden_fingerprint).toBe((await job()).talbodenFingerprint);
        expect(zeile?.max_schritt).toBeGreaterThan(0);
    }, 120_000);

    it("liest Täler und Mulden getrennt von Nebengipfeln und erneuert ihren Talboden-Fingerabdruck", async () => {
        const vorher = await job();
        await database`
            INSERT INTO terrain_valley_edge (area_id, map_domain_id, ordinal, geom)
            VALUES (${areaId}, 'aventuria', 0, ST_GeomFromText('LINESTRING(964 962, 970 968)', 0))
        `;
        await database`
            INSERT INTO terrain_hollow_point (area_id, map_domain_id, ordinal, geom, height_schritt)
            VALUES (${areaId}, 'aventuria', 0, ST_GeomFromText('POINT(970 968)', 0), NULL),
                   (${areaId}, 'aventuria', 1, ST_GeomFromText('POINT(964 962)', 0), 0)
        `;
        const mit = await job();
        expect(mit.input.kaemme?.at(-1)?.rang).toBe("tal");
        expect(mit.input.nebengipfel).toEqual([{ x: 968, y: 966, h: 1800 }]);
        expect(mit.input.mulden).toEqual([
            { x: 970, y: 968, h: null },
            { x: 964, y: 962, h: 0 },
        ]);
        expect(mit.fingerprint).not.toBe(vorher.fingerprint);
        expect(mit.talbodenFingerprint).not.toBe(vorher.talbodenFingerprint);
    });

    it("rechnet auch nur mit Mulden im Rückennetz und markiert die Fläche für die ungeglättete Übernahme", async () => {
        await database`DELETE FROM terrain_ridge_edge WHERE area_id = ${areaId}`;
        await database`DELETE FROM terrain_ridge_point WHERE area_id = ${areaId}`;
        await database`DELETE FROM terrain_valley_edge WHERE area_id = ${areaId}`;
        await database`UPDATE terrain_control SET durchschnittshoehe = 1000 WHERE area_id = ${areaId}`;
        const nurMulden = await job();
        expect(nurMulden.input.kaemme).toEqual([]);
        expect(nurMulden.input.mulden).toHaveLength(2);
        expect(nurMulden.input.rueckennetz?.mittelZiel).toBe(1000);
        const bericht = await deriveTerrainSeeds(database, { only: [ID.gebirge], force: true });
        expect(bericht.failed).toEqual([]);
        const [raster] = await database<
            { rueckennetz_talboden: number | null; rueckennetz_talboden_fingerprint: string | null }[]
        >`
            SELECT rueckennetz_talboden, rueckennetz_talboden_fingerprint FROM terrain_raster WHERE area_id = ${areaId}
        `;
        expect(raster?.rueckennetz_talboden).not.toBeNull();
        expect(raster?.rueckennetz_talboden_fingerprint).toBe(nurMulden.talbodenFingerprint);
        await database`DELETE FROM terrain_hollow_point WHERE area_id = ${areaId}`;
        const leer = await job();
        expect(leer.input.rueckennetz).toBeUndefined();
        expect(leer.input.mulden).toBeUndefined();
        const zusatz = await leseGebirgsZusatz(database, [String(areaId)]);
        expect(zusatz.get(String(areaId))?.netz).toEqual({ kaemme: [], nebengipfel: [] });
    }, 120_000);
});
