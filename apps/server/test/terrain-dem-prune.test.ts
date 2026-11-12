import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { pruneTerrainDem } from "../src/terrain/derive.ts";
import { loadContinentalBase } from "../src/terrain/continental.ts";

/**
 * Das Aufräumen der Revisionen des Höhenmodells (WI-0049; Betreiber 2026-09-28: Stage und lokale Datenbank
 * sollen nicht mit temporären Daten zuwachsen; dieselbe Regel wie das Relief, `visual-relief-prune.test.ts`).
 * Es löscht, deshalb gegen echtes PostgreSQL und in einer eigenen Kartendomäne, damit parallele Läufe die
 * Revisionen von `aventuria` nicht berühren.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "test-wi0049-prune";
const PNG = Buffer.from([137, 80, 78, 71]);

describeWithDatabase("Aufräumen der Geländerevisionen", () => {
    let database: Database;

    /** Legt Revisionen an: die aktuelle (…01) und abgelöste mit ihrem Alter in Stunden (…02 vorige, …03 älter, …04 alt). */
    async function seed(current: string | null, superseded: Record<string, number>): Promise<void> {
        await database`DELETE FROM terrain_dem WHERE map_domain_id = ${DOMAIN}`;
        const rows = [
            ...(current ? [{ revision: current, hours: null as number | null }] : []),
            ...Object.entries(superseded).map(([revision, hours]) => ({ revision, hours })),
        ];
        for (const row of rows) {
            await database`
                INSERT INTO terrain_dem (
                    revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current,
                    superseded_at
                ) VALUES (
                    ${row.revision}, ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, ${PNG.length}, ${row.hours === null},
                    ${row.hours === null ? null : new Date(Date.now() - row.hours * 3_600_000)}
                )
            `;
            await database`INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES (${row.revision}, 0, 0, 0, ${PNG})`;
        }
    }

    async function left(): Promise<string[]> {
        const rows = await database<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE map_domain_id = ${DOMAIN} ORDER BY revision
        `;
        return rows.map((row) => row.revision);
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        // Eine eigene Domäne als Kopie von `aventuria`: Der Fremdschlüssel verlangt sie.
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
    });

    beforeEach(async () => {
        await database`DELETE FROM terrain_dem WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_domain_raster WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_continental_base WHERE map_domain_id = ${DOMAIN}`;
    });

    afterAll(async () => {
        await database`DELETE FROM terrain_dem WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_domain_raster WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_continental_base WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
        await database.end({ timeout: 5 });
    });

    it("protects parallel domain masters before activation, then keeps only referenced current/previous masters", async () => {
        await seed("a0049a000001", { a0049a000002: 2 });
        for (const fingerprint of ["current-domain", "previous-domain", "unpublished-domain"]) {
            await database`INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report)
                VALUES (${DOMAIN}, ${fingerprint}, ${fingerprint}, '1', 4096, decode(repeat('0000',4096*4096),'hex'), '{}')`;
        }
        const masters = async (): Promise<string[]> =>
            (
                await database<{ fingerprint: string }[]>`
            SELECT fingerprint FROM terrain_domain_raster WHERE map_domain_id = ${DOMAIN} ORDER BY fingerprint
        `
            ).map((row) => row.fingerprint);
        await pruneTerrainDem(database, DOMAIN, false);
        expect(await masters()).toEqual(["current-domain", "previous-domain", "unpublished-domain"]);
        await database`UPDATE terrain_dem SET domain_fingerprint = 'current-domain' WHERE revision = 'a0049a000001'`;
        await database`UPDATE terrain_dem SET domain_fingerprint = 'previous-domain' WHERE revision = 'a0049a000002'`;
        await pruneTerrainDem(database, DOMAIN, false);
        expect(await masters()).toEqual(["current-domain", "previous-domain"]);
        await pruneTerrainDem(database, DOMAIN, true);
        expect(await masters()).toEqual(["current-domain"]);
        expect(await left()).toEqual(["a0049a000001"]);
    });

    it("veröffentlicht den Sockel nur am aktuellen DEM und räumt ausschließlich ungebundene Sockel auf", async () => {
        await seed("a0049a000001", { a0049a000002: 2 });
        for (const fingerprint of ["current-base", "previous-base", "unpublished-base"]) {
            await database`
                INSERT INTO terrain_continental_base (map_domain_id, fingerprint, input_fingerprint, size, samples)
                VALUES (${DOMAIN}, ${fingerprint}, ${fingerprint}, 4096, decode(repeat('0000', 4096 * 4096), 'hex'))
            `;
        }
        expect(await loadContinentalBase(database, DOMAIN)).toBeUndefined();
        await database`UPDATE terrain_dem SET continental_fingerprint = 'current-base' WHERE revision = 'a0049a000001'`;
        await database`UPDATE terrain_dem SET continental_fingerprint = 'previous-base' WHERE revision = 'a0049a000002'`;
        expect((await loadContinentalBase(database, DOMAIN))?.fingerprint).toBe("current-base");
        await pruneTerrainDem(database, DOMAIN, false);
        const retained = await database<{ fingerprint: string }[]>`
            SELECT fingerprint FROM terrain_continental_base WHERE map_domain_id = ${DOMAIN} ORDER BY fingerprint
        `;
        expect(retained.map((row) => row.fingerprint)).toEqual(["current-base", "previous-base"]);
        await pruneTerrainDem(database, DOMAIN, true);
        const remaining = await database<{ fingerprint: string }[]>`
            SELECT fingerprint FROM terrain_continental_base WHERE map_domain_id = ${DOMAIN}
        `;
        expect(remaining.map((row) => row.fingerprint)).toEqual(["current-base"]);
    });

    it("Stage: behält die aktuelle und die vorige, Älteres sofort, samt Kacheln", async () => {
        await seed("a0049a000001", { a0049a000002: 2, a0049a000003: 3, a0049a000004: 72 });
        expect(await pruneTerrainDem(database, DOMAIN, false)).toEqual(["a0049a000003", "a0049a000004"]);
        expect(await left()).toEqual(["a0049a000001", "a0049a000002"]);
        const [tiles] = await database<{ count: number }[]>`
            SELECT count(*)::int AS count FROM terrain_dem_tile WHERE revision IN ('a0049a000003', 'a0049a000004')
        `;
        expect(tiles?.count).toBe(0);
    });

    it("Stage: die vorige nur für die Übergangszeit, einen Tag", async () => {
        await seed("a0049a000001", { a0049a000002: 25 });
        expect(await pruneTerrainDem(database, DOMAIN, false)).toEqual(["a0049a000002"]);
        expect(await left()).toEqual(["a0049a000001"]);
    });

    it("lokal: nur die aktuelle bleibt", async () => {
        await seed("a0049a000001", { a0049a000002: 1, a0049a000004: 72 });
        expect(await pruneTerrainDem(database, DOMAIN, true)).toEqual(["a0049a000002", "a0049a000004"]);
        expect(await left()).toEqual(["a0049a000001"]);
    });

    it("🔴 ohne aktuelle Revision bleibt alles stehen", async () => {
        await seed(null, { a0049a000002: 1, a0049a000004: 72 });
        expect(await pruneTerrainDem(database, DOMAIN, true)).toEqual([]);
        expect(await pruneTerrainDem(database, DOMAIN, false)).toEqual([]);
        expect(await left()).toEqual(["a0049a000002", "a0049a000004"]);
    });
});
