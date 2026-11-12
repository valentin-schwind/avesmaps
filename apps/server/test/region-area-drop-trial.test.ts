import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Der Probestempel `region_area.is_trial` ist abgeschafft (WI-0048). Migration 0046 löscht die Spalte,
 * bricht aber ab, falls doch eine Fläche den Stempel trägt. Den Wächter prüft dieser Test gegen echtes
 * PostgreSQL: Er legt die Spalte in einer Transaktion wieder an, lässt die Migration laufen und rollt
 * zurück. Die Datenbank bleibt dabei, wie sie war.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIGRATION = new URL("../migrations/0046_region_area_drop_trial.sql", import.meta.url);
const ID = "00000000-0000-4000-8000-0000000048b1";
/** Beendet eine Transaktion absichtlich mit ROLLBACK. */
const ROLLBACK = new Error("rollback");

describeWithDatabase("Migration 0046: Probestempel entfällt", () => {
    let database: Database;
    let sql: string;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        sql = await readFile(MIGRATION, "utf8");
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    async function hasColumn(query: Queryable): Promise<boolean> {
        const [row] = await query<{ present: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'region_area' AND column_name = 'is_trial'
            ) AS present
        `;
        return row?.present ?? false;
    }

    it("🔴 die Spalte gibt es nach dem Migrieren nicht mehr", async () => {
        expect(await hasColumn(database)).toBe(false);
    });

    it("🔴 bricht ab, wenn eine Fläche den Stempel trägt, und behält die Spalte", async () => {
        const outcome = await database
            .begin(async (transaction) => {
                await transaction`ALTER TABLE region_area ADD COLUMN is_trial BOOLEAN NOT NULL DEFAULT FALSE`;
                const [region] = await transaction<{ id: string }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                    VALUES (${ID}, 'aventuria', 'Probe', 'topographie', 'meer', true)
                    RETURNING id::text
                `;
                await transaction`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_trial)
                    VALUES (gen_random_uuid(), 'aventuria', ${Number(region?.id)},
                            ST_GeomFromText('POLYGON((700 700,710 700,710 710,700 710,700 700))'), true)
                `;
                await transaction.unsafe(sql);
                throw ROLLBACK;
            })
            .catch((error: unknown) => error);
        expect(outcome).not.toBe(ROLLBACK);
        expect(String((outcome as Error).message)).toContain("1 Flaeche(n) tragen den Probestempel");
        expect(await hasColumn(database), "zurückgerollt").toBe(false);
    });

    it("🔴 löscht die Spalte, wenn keine Fläche gestempelt ist, und ein zweiter Lauf ändert nichts", async () => {
        const outcome = await database
            .begin(async (transaction) => {
                await transaction`ALTER TABLE region_area ADD COLUMN is_trial BOOLEAN NOT NULL DEFAULT FALSE`;
                expect(await hasColumn(transaction)).toBe(true);
                await transaction.unsafe(sql);
                expect(await hasColumn(transaction)).toBe(false);
                await transaction.unsafe(sql);
                throw ROLLBACK;
            })
            .catch((error: unknown) => error);
        expect(outcome).toBe(ROLLBACK);
    });
});
