import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA, createRenderProjection } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * The derived render projection exists twice: as SQL (map_domain_to_render, used by the tile
 * source) and as TypeScript (used by the client). ADR-0003 relies on both agreeing, so this test
 * compares them instead of trusting a comment.
 *
 * Without TEST_DATABASE_URL it skips visibly rather than passing silently (chapter 11.155).
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const samples = [
    { x: 0, y: 0 },
    { x: 1024, y: 1024 },
    { x: 512, y: 512 },
    { x: 551.625, y: 532.969 },
    { x: 480.89062, y: 536.78125 },
    { x: 0.001, y: 1023.999 },
];

describeWithDatabase("render projection parity", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("SQL and TypeScript produce the same render coordinates", async () => {
        const projection = createRenderProjection(AVENTURIA.coordinateSpace);

        for (const sample of samples) {
            const rows = await database<{ x: number; y: number; srid: number }[]>`
                SELECT
                    ST_X(geom) AS x,
                    ST_Y(geom) AS y,
                    ST_SRID(geom) AS srid
                FROM (
                    SELECT map_domain_to_render(
                        ${AVENTURIA.mapDomain},
                        ST_SetSRID(ST_MakePoint(${sample.x}, ${sample.y}), 0)
                    ) AS geom
                ) AS derived
            `;
            const expected = projection.toRender(sample);

            expect(rows[0]?.srid, `srid for ${sample.x}/${sample.y}`).toBe(3857);
            expect(rows[0]?.x, `x for ${sample.x}/${sample.y}`).toBeCloseTo(expected.x, 6);
            expect(rows[0]?.y, `y for ${sample.x}/${sample.y}`).toBeCloseTo(expected.y, 6);
        }
    });

    it("the tile source publishes derived geometry, the table keeps the authoritative one", async () => {
        const [columns] = await database<{ place_srid: number; render_srid: number }[]>`
            SELECT
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'place') AS place_srid,
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'place_render') AS render_srid
        `;

        expect(columns).toEqual({ place_srid: 0, render_srid: 3857 });
    });

    /**
     * 🔴 Abnahmekriterium 3 aus WI-0010: die Weggeometrie liegt in `aventuria-v1`, die Kachel
     * liefert abgeleitete Renderkoordinaten (ADR-0003).
     *
     * 💣 Dieser Nachweis fehlte für die Wege. Er stand nur für die Orte, und eine Linie ist kein
     * Punkt: sie hat Stützstellen, sie wird geglättet, und `path_visual` ist eine ZWEITE
     * Geometrie. Läge eine davon schon projiziert in der Tabelle, wäre die Glättung auf
     * Mercator-Koordinaten gerechnet — sichtbar erst weit im Norden, wo Mercator streckt.
     */
    it("🔴 hält Weg und Weganzeige in aventuria-v1 und gibt sie projiziert aus", async () => {
        const [columns] = await database<Record<string, number>[]>`
            SELECT
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'path') AS path_srid,
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'path_visual') AS visual_srid,
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'path_label_run') AS run_srid,
                (SELECT srid FROM geometry_columns WHERE f_table_name = 'path_render') AS render_srid
        `;

        expect(columns).toEqual({ path_srid: 0, visual_srid: 0, run_srid: 0, render_srid: 3857 });
    });
});
