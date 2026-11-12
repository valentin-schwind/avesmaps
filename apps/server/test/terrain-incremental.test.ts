import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    deriveLegacyTerrain as deriveTerrain,
    deriveTerrainSeeds,
    type DeriveTerrainReport,
} from "../src/terrain/derive.ts";
import { verifyLegacyTerrainDem as verifyTerrainDem } from "../src/terrain/verify-dem.ts";

/**
 * `derive:terrain` inkrementell (WI-0059): Nach einer lokalen Änderung rechnet der Lauf nur, was sie betrifft, und
 * liefert dieselben Bytes wie ein voller Lauf (`force`): Raster, Fingerabdrücke, Kacheln, Revision, Wegprofile.
 * Gegen echtes PostgreSQL und in einer eigenen Kartendomäne; die Gebirge sind klein, damit V12 schnell rechnet.
 *
 * Die Karte: zwei Gebirge nebeneinander (A, B) mit einem Fluss durch beide, ein Gebirge allein (C) mit eigenem
 * Fluss, ein freier Gipfel und ein Landweg durch A und B. A und B bilden eine Gruppe beim Einbrennen, C eine eigene.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "test-wi0059";
const id = (n: number): string => `00000000-0000-4000-8000-00000059${String(n).padStart(4, "0")}`;

const AREA = { a: id(1), b: id(2), c: id(3) };
const PEAK = { a1: id(11), a2: id(12), b1: id(13), b2: id(14), c1: id(15), c2: id(16), free: id(17) };
const PATH = { river: id(21), riverC: id(22), road: id(23) };

describeWithDatabase("derive:terrain inkrementell gegen PostgreSQL", () => {
    let database: Database;
    const options = { mapDomainId: DOMAIN, onlyCurrent: true, workers: 2 };

    async function cleanup(): Promise<void> {
        await database`DELETE FROM terrain_path_profile WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_raster WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_dem WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_control WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_peak WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM region_area WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM region WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM path WHERE map_domain_id = ${DOMAIN}`;
    }

    /** Alles, was ein Lauf ableitet, als Zeichenketten zum Vergleichen (ohne Zeitstempel). */
    async function state(): Promise<Record<string, string>> {
        const rasters = await database<{ area_id: string; fingerprint: string; s: string; v: string }[]>`
            SELECT area_id::text, fingerprint, md5(samples) AS s, md5(v12_samples) AS v
            FROM terrain_raster WHERE map_domain_id = ${DOMAIN} ORDER BY area_id
        `;
        const [dem] = await database<{ revision: string; fingerprint: string; tiles: string }[]>`
            SELECT d.revision, d.fingerprint,
                   (SELECT md5(string_agg(md5(png), ',' ORDER BY z, x, y)) FROM terrain_dem_tile t WHERE t.revision = d.revision) AS tiles
            FROM terrain_dem d WHERE d.map_domain_id = ${DOMAIN} AND d.is_current
        `;
        const profiles = await database<{ path_id: string; height_fingerprint: string; c: string }[]>`
            SELECT path_id::text, height_fingerprint, md5(pairs || samples) AS c
            FROM terrain_path_profile WHERE map_domain_id = ${DOMAIN} ORDER BY path_id
        `;
        const hash = (rows: unknown): string => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
        return {
            rasters: hash(rasters),
            samples: hash(rasters.map((row) => [row.area_id, row.s, row.v])),
            burnt: hash(rasters.map((row) => [row.area_id, row.s])),
            dem: JSON.stringify(dem),
            profiles: hash(profiles),
            profileContent: hash(profiles.map((row) => [row.path_id, row.c])),
        };
    }

    const bytesOfPeak = async (publicId: string, height: number): Promise<void> => {
        await database`UPDATE terrain_peak SET height_schritt = ${height}, updated_at = now() WHERE public_id = ${publicId}`;
    };

    /** Ein inkrementeller Lauf, dann ein voller über denselben Eingaben: Beide müssen denselben Stand hinterlassen. */
    async function incrementalEqualsFull(
        label: string,
        change: () => Promise<void>,
        run: (report: DeriveTerrainReport) => void,
    ): Promise<DeriveTerrainReport> {
        await change();
        const incremental = await deriveTerrain(database, options);
        const after = await state();
        run(incremental);
        const full = await deriveTerrain(database, { ...options, force: true });
        expect(full.computed, label).toBe(full.mountains);
        expect(full.burn.burnedGroups, label).toBe(full.burn.groups);
        expect(await state(), label).toEqual(after);
        expect(full.revisionChanged, label).toBe(false);
        return incremental;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
        await cleanup();
        const boxes = [
            [AREA.a, "Probe A", 400, 400, 412, 412],
            [AREA.b, "Probe B", 413, 400, 425, 412],
            [AREA.c, "Probe C", 500, 500, 512, 512],
        ] as const;
        for (const [publicId, name, x0, y0, x1, y1] of boxes) {
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (gen_random_uuid(), ${DOMAIN}, ${name}, 'topographie', 'gebirge', true)
                RETURNING id::text
            `;
            const [area] = await database<{ id: string }[]>`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${publicId}, ${DOMAIN}, ${Number(region?.id)}, ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0), true)
                RETURNING id::text
            `;
            await database`
                INSERT INTO terrain_control (area_id, map_domain_id, is_active) VALUES (${Number(area?.id)}, ${DOMAIN}, true)
            `;
        }
        const peaks = [
            [PEAK.a1, "Gipfel A1", 404, 404, 3200],
            [PEAK.a2, "Gipfel A2", 409, 408, 2600],
            [PEAK.b1, "Gipfel B1", 417, 404, 3600],
            [PEAK.b2, "Gipfel B2", 422, 408, 2400],
            [PEAK.c1, "Gipfel C1", 504, 504, 3000],
            [PEAK.c2, "Gipfel C2", 509, 508, 2200],
            [PEAK.free, "Freier Gipfel", 460, 460, 1800],
        ] as const;
        for (const [publicId, name, x, y, height] of peaks) {
            await database`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, is_active)
                VALUES (${publicId}, ${DOMAIN}, ${name}, 'berggipfel', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), ${height}, true)
            `;
        }
        const line = (points: string): string => `LINESTRING(${points})`;
        const paths = [
            [PATH.river, "Fluss AB", "Flussweg", line("402 411, 406 407, 411 405, 415 406, 420 403, 424 405")],
            [PATH.riverC, "Fluss C", "Flussweg", line("502 511, 506 507, 510 505")],
            [PATH.road, "Weg durch A und B", "Weg", line("401 401, 407 405, 414 404, 424 410")],
        ] as const;
        for (const [publicId, name, subtype, wkt] of paths) {
            await database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${publicId}, ${DOMAIN}, ${name}, ${subtype}, ST_GeomFromText(${wkt}, 0), 'test', true)
            `;
        }
    }, 60_000);

    afterAll(async () => {
        await cleanup();
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 erster Lauf rechnet alles, der zweite nichts und lässt den Stand, wie er ist", async () => {
        const first = await deriveTerrain(database, options);
        expect(first.mountains).toBe(3);
        expect(first.computed).toBe(3);
        expect(first.failed).toEqual([]);
        expect(first.revisionChanged).toBe(true);
        expect(first.burn.groups).toBe(2);
        expect(first.burn.burnedGroups).toBe(2);
        expect(first.scope).toEqual({ kind: "full" });
        const before = await state();
        // Das ungeschnittene Raster ist gespeichert, je Gebirge.
        const [stored] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM terrain_raster WHERE map_domain_id = ${DOMAIN} AND v12_samples IS NOT NULL AND v12_fingerprint IS NOT NULL
        `;
        expect(stored?.n).toBe(3);

        const second = await deriveTerrain(database, options);
        expect(second.computed).toBe(0);
        expect(second.unchanged).toBe(3);
        expect(second.burn).toEqual({ groups: 2, burnedGroups: 0, burnedRasters: 0 });
        expect(second.rivers).toBeNull();
        expect(second.revisionChanged).toBe(false);
        expect(second.revision).toBe(first.revision);
        expect(second.tiles).toBe(first.tiles);
        expect(second.bytes).toBe(first.bytes);
        expect(second.profiles.computed).toBe(0);
        expect(second.profiles.unchanged).toBe(first.profiles.paths);
        expect(second.changedTiles).toBeNull();
        expect(second.scope).toEqual({ kind: "bounds", bounds: null });
        expect(await state()).toEqual(before);
    }, 120_000);

    it("🔴 eine Gipfelhöhe: nur dieses Gebirge (V12) und seine Gruppe (Einbrennen); bytegleich zum vollen Lauf", async () => {
        const report = await incrementalEqualsFull(
            "Gipfel in A",
            () => bytesOfPeak(PEAK.a1, 3900),
            (r) => {
                expect(r.computed).toBe(1);
                expect(r.unchanged).toBe(2);
                expect(r.burn.burnedGroups).toBe(1);
                expect(r.burn.burnedRasters).toBe(2);
                expect(r.revisionChanged).toBe(true);
                expect(r.changedTiles).toBeGreaterThan(0);
                expect(r.scope.kind).toBe("bounds");
                // Der Weg durch A und B bekommt ein neues Profil, der Fluss keins (nur Landwege).
                expect(r.profiles.computed).toBe(1);
            },
        );
        // Die Kacheln, die sich geändert haben, liegen um die Gebirge A und B.
        const bounds = report.changedBounds;
        expect(bounds).not.toBeNull();
        expect(bounds?.minX).toBeLessThanOrEqual(413);
        expect(bounds?.maxX).toBeGreaterThanOrEqual(413);
    }, 180_000);

    it("🔴 ein Gipfel im einzelnen Gebirge C: nur C, die Gruppe von A und B bleibt", async () => {
        await incrementalEqualsFull(
            "Gipfel in C",
            () => bytesOfPeak(PEAK.c1, 3400),
            (r) => {
                expect(r.computed).toBe(1);
                expect(r.burn.burnedGroups).toBe(1);
                expect(r.burn.burnedRasters).toBe(1);
                // Der Weg liegt nicht an C: kein Profil neu.
                expect(r.profiles.computed).toBe(0);
            },
        );
    }, 180_000);

    it("🔴 ein Fluss verschoben: die Gebirge, die er berührt (V12), und ihre Gruppe; bytegleich zum vollen Lauf", async () => {
        await incrementalEqualsFull(
            "Fluss in A und B",
            async () => {
                await database`
                    UPDATE path SET geom = ST_Translate(geom, 0.4, -0.3), updated_at = now() WHERE public_id = ${PATH.river}
                `;
            },
            (r) => {
                expect(r.computed).toBe(2);
                expect(r.burn.burnedGroups).toBe(1);
                expect(r.revisionChanged).toBe(true);
            },
        );
    }, 180_000);

    it("🔴 ein freier Gipfel: keine Gebirge neu, nur Kacheln und die Profile an ihm; bytegleich zum vollen Lauf", async () => {
        await incrementalEqualsFull(
            "freier Gipfel",
            () => bytesOfPeak(PEAK.free, 2500),
            (r) => {
                expect(r.computed).toBe(0);
                expect(r.burn.burnedGroups).toBe(0);
                expect(r.revisionChanged).toBe(true);
                expect(r.profiles.computed).toBe(0);
            },
        );
    }, 180_000);

    it("ein Bereich oder eine Nennung begrenzt V12; alles andere bleibt stehen und rechnet der nächste volle Lauf nach", async () => {
        await bytesOfPeak(PEAK.a2, 2900);
        await bytesOfPeak(PEAK.c2, 2500);
        const before = await state();
        // Nichts geändert, nichts zu tun.
        const none = await deriveTerrain(database, { ...options, scope: { kind: "bounds", bounds: null } });
        expect(none.computed).toBe(0);
        expect(none.unchanged).toBe(3);
        expect(await state()).toEqual(before);
        // Nur C benannt: A bleibt veraltet (sein Raster bleibt, wie es ist).
        const [c] = await database<
            { name: string }[]
        >`SELECT name FROM region WHERE map_domain_id = ${DOMAIN} AND name = 'Probe C'`;
        const named = await deriveTerrain(database, { ...options, scope: { kind: "entities", ids: [c?.name ?? ""] } });
        expect(named.computed).toBe(1);
        expect(named.unchanged).toBe(2);
        // Ein Bereich um A und B: rechnet A (B ist aktuell), C bleibt.
        const box = await deriveTerrain(database, {
            ...options,
            scope: { kind: "bounds", bounds: { minX: 395, minY: 395, maxX: 430, maxY: 415 } },
        });
        expect(box.computed).toBe(1);
        // Jetzt ist alles aktuell: ein voller Lauf findet nichts mehr zu tun und ändert nichts.
        const settled = await state();
        const rest = await deriveTerrain(database, options);
        expect(rest.computed).toBe(0);
        expect(await state()).toEqual(settled);
        const full = await deriveTerrain(database, { ...options, force: true });
        expect(await state()).toEqual(settled);
        expect(full.revisionChanged).toBe(false);
    }, 240_000);

    it("🔴 verify:terrain-dem erkennt Veraltetes und ein fehlendes Raster, und ist nach dem Lauf grün", async () => {
        const failing = async (): Promise<string[]> => {
            const report = await verifyTerrainDem(database, DOMAIN);
            return report.checks.filter((entry) => !entry.passed).map((entry) => entry.name);
        };
        await deriveTerrain(database, options);
        expect(await failing()).toEqual([]);
        // Eine Eingabe ändert sich, der Lauf steht noch aus: Das Raster und die Profile sind veraltet.
        await bytesOfPeak(PEAK.b1, 3300);
        expect(await failing()).toContain("raster_je_gebirge");
        await deriveTerrain(database, options);
        expect(await failing()).toEqual([]);
        // Ein Gebirge ohne Raster fällt auf (nicht als „gleich“ durchgehen, weil beide Seiten fehlen).
        await database`DELETE FROM terrain_raster WHERE area_id = (SELECT id FROM region_area WHERE public_id = ${AREA.c})`;
        expect(await failing()).toContain("raster_je_gebirge");
        await deriveTerrain(database, options);
        expect(await failing()).toEqual([]);
        // Ein Profil zu einem anderen Höhenstand fällt auf.
        await database`UPDATE terrain_path_profile SET height_fingerprint = 'anderer' WHERE path_id = (SELECT id FROM path WHERE public_id = ${PATH.road})`;
        expect(await failing()).toContain("wegprofile_aktuell");
        await deriveTerrain(database, options);
        expect(await failing()).toEqual([]);
    }, 240_000);

    it("ein Gebirge ohne gespeichertes ungeschnittenes Raster (Stand vor Migration 0054) wird neu gerechnet", async () => {
        await database`UPDATE terrain_raster SET v12_fingerprint = NULL, v12_samples = NULL WHERE map_domain_id = ${DOMAIN}`;
        const before = await state();
        const report = await deriveTerrain(database, options);
        expect(report.computed).toBe(3);
        expect(report.revisionChanged).toBe(false);
        const after = await state();
        expect(after["burnt"]).toBe(before["burnt"]);
        expect(after["profileContent"]).toBe(before["profileContent"]);
        expect(after["samples"]).not.toBe(before["samples"]);
        expect(after["dem"]).toBe(before["dem"]);
    }, 120_000);
    it("V12-Seedphase publiziert keine Höhe, brennt keine Flüsse ein und überschreibt keine Wegprofile", async () => {
        const beforeDem =
            await database`SELECT revision, is_current FROM terrain_dem WHERE map_domain_id = ${DOMAIN} ORDER BY revision`;
        const beforeProfiles =
            await database`SELECT path_id, height_fingerprint, md5(pairs) FROM terrain_path_profile WHERE map_domain_id = ${DOMAIN} ORDER BY path_id`;
        const report = await deriveTerrainSeeds(database, { ...options, force: true });
        expect(report.burn.burnedGroups).toBe(0);
        expect(report.profiles.computed).toBe(0);
        expect(report.revisionChanged).toBe(false);
        const [raster] = await database<
            { total: number; changed: number }[]
        >`SELECT count(*)::int AS total, count(*) FILTER (WHERE samples <> v12_samples)::int AS changed FROM terrain_raster WHERE map_domain_id = ${DOMAIN}`;
        expect(raster!.total).toBeGreaterThan(0);
        expect(raster!.changed).toBe(0);
        expect(
            await database`SELECT revision, is_current FROM terrain_dem WHERE map_domain_id = ${DOMAIN} ORDER BY revision`,
        ).toEqual(beforeDem);
        expect(
            await database`SELECT path_id, height_fingerprint, md5(pairs) FROM terrain_path_profile WHERE map_domain_id = ${DOMAIN} ORDER BY path_id`,
        ).toEqual(beforeProfiles);
    });
});
