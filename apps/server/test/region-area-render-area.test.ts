import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die Fläche je Polygon in der Landschaftskachel (Migration 0052, WI-0043 Stufe 2): Ein Klick nimmt, wo sich
 * Flächen überlagern, die kleinste zuerst. `area` ist die Fläche des Polygons in E², auf 2 Stellen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("region_area_render.area", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 1 });
        await migrate(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("steht als letzte Spalte in der Sicht, als Zahl", async () => {
        const columns = await database<{ column_name: string; data_type: string }[]>`
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'region_area_render' ORDER BY ordinal_position
        `;
        expect(columns[columns.length - 1]).toEqual({ column_name: "area", data_type: "double precision" });
    });

    it("ist die Fläche des Polygons", async () => {
        const [row] = await database<{ checked: number; off: number }[]>`
            SELECT count(*)::int AS checked,
                   count(*) FILTER (WHERE abs(v.area - ST_Area(a.geom)) > 0.006)::int AS off
            FROM region_area_render v JOIN region_area a ON a.public_id = v.public_id
        `;
        expect(row?.off).toBe(0);
    });
});
