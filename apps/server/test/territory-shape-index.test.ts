import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die Gebiete an einem Punkt (Kontext eines Orts, Gipfels, Kartenpunkts; `pointContext` in `subjects/context.ts`) und an einer
 * Linie (`routeTerritories`) suchen in `territory_shape.geom`. Ohne Index ist das ein Scan über alle Formen, den PostgreSQL unter
 * Last mit einem Parallel-Worker rechnet; dessen Start kostete auf Windows 50–230 ms, unter Last bis 2 s, und die Grenze der
 * Subjects ist 1 s (Befund 2026-10-04: 503 für Gareth, Migration 0071).
 *
 * Geprüft wird, dass der Planer für genau diese Bedingung einen Index auf `geom` findet. 🪤 Die Testdatenbank hat kaum Formen,
 * der Planer nähme dort den Scan ohnehin; mit `enable_seqscan = off` bleibt er nur dann beim Scan, wenn es keinen Index gibt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

interface PlanNode {
    "Node Type": string;
    "Index Name"?: string;
    Plans?: PlanNode[];
}

function indexNames(node: PlanNode): string[] {
    return [...(node["Index Name"] ? [node["Index Name"]] : []), ...(node.Plans ?? []).flatMap(indexNames)];
}

describeWithDatabase("territory_shape: Index auf der Form (Migration 0071)", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    async function planOf(statement: string): Promise<PlanNode> {
        return database.begin(async (transaction) => {
            await transaction.unsafe("SET LOCAL enable_seqscan = off");
            const [row] = await transaction.unsafe<{ "QUERY PLAN": { Plan: PlanNode }[] }[]>(
                `EXPLAIN (FORMAT JSON) ${statement}`,
            );
            return row!["QUERY PLAN"][0]!.Plan;
        });
    }

    it("🔴 die Gebiete an einem Punkt kommen aus dem Index, nicht aus einem Scan aller Formen", async () => {
        const plan = await planOf(`
            SELECT DISTINCT sh.territory_id::text AS territory_id
            FROM territory_shape sh
            WHERE ST_Intersects(sh.geom, ST_SetSRID(ST_MakePoint(551.625, 532.969), 0))
        `);
        expect(indexNames(plan)).toContain("territory_shape_geom_gist");
    });

    it("die Gebiete an einer Linie ebenso (`routeTerritories`: `sh.geom && s.geom`)", async () => {
        const plan = await planOf(`
            SELECT sh.territory_id
            FROM territory_shape sh
            WHERE sh.geom && ST_GeomFromText('LINESTRING(540 520,560 540)')
              AND ST_Intersects(sh.geom, ST_GeomFromText('LINESTRING(540 520,560 540)'))
        `);
        expect(indexNames(plan)).toContain("territory_shape_geom_gist");
    });
});
