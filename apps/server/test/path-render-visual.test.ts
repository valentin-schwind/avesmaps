import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";

/**
 * Die Kachel zeichnet die GEGLÄTTETE Kurve, nicht die rohe Geometrie (Catmull-Rom, Migration 0024).
 *
 * 💣 Migration 0028 (Strömungspfeile) hat `path_render` neu geschrieben und dabei den Verweis auf
 * `path_visual` verloren: seitdem kam wieder die eckige Rohlinie in die Kachel, während die
 * Wegnamen weiter auf der geglätteten Kurve lagen — an jeder Biegung NEBEN der Straße. Bemerkt hat
 * es der Betreiber am Bild (2026-09-23), kein Test: der vorhandene prüfte nur das Koordinatensystem
 * der Sicht, nicht, WELCHE Geometrie sie ausliefert.
 *
 * 🪤 `CREATE OR REPLACE VIEW` schreibt die GANZE Sicht neu. Wer ihr eine Spalte anhängt, muss den
 * Rest aus der letzten Fassung abschreiben, nicht aus der ersten — genau das ist hier schiefgegangen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const QUELLE = "path-render-visual-test";
const PUBLIC_ID = "eeeeeeee-0000-4000-8000-000000000001";

describeWithDatabase("path_render liefert die gezeichnete Kurve", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        // Roh: ein rechter Winkel. Gezeichnet: eine Kurve mit einem Zwischenpunkt, der NICHT auf
        // der Rohlinie liegt — die beiden sind so eindeutig unterscheidbar.
        await database.unsafe(`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES ('${PUBLIC_ID}', 'aventuria', 'Kurventest', 'Strasse',
                    ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(500,500), ST_MakePoint(510,500), ST_MakePoint(510,510)]), 0),
                    '${QUELLE}', TRUE)
        `);
        await database.unsafe(`
            INSERT INTO path_visual (path_id, geom, source_fingerprint, algorithm_version)
            SELECT id,
                   ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(500,500), ST_MakePoint(507,502), ST_MakePoint(510,510)]), 0),
                   'test', 'test'
            FROM path WHERE public_id = '${PUBLIC_ID}'
        `);
    });

    afterAll(async () => {
        await database.unsafe(`DELETE FROM path WHERE source_system = '${QUELLE}'`);
        await database.end({ timeout: 5 });
    });

    it("🔴 liest path_visual, nicht path.geom", async () => {
        const [zeile] = await database<{ gleich_kurve: boolean; gleich_roh: boolean }[]>`
            SELECT
                ST_Equals(r.geom, map_domain_to_render('aventuria', v.geom)) AS gleich_kurve,
                ST_Equals(r.geom, map_domain_to_render('aventuria', p.geom)) AS gleich_roh
            FROM path_render r
            JOIN path p ON p.public_id = r.public_id
            JOIN path_visual v ON v.path_id = p.id
            WHERE r.public_id = ${PUBLIC_ID}
        `;
        expect(zeile?.gleich_kurve, "die Kachel zeichnet die geglättete Kurve").toBe(true);
        expect(zeile?.gleich_roh).toBe(false);
    });

    it("🪤 fällt ohne Kurve auf die Rohgeometrie zurück, statt den Weg zu verlieren", async () => {
        await database`DELETE FROM path_visual WHERE path_id = (SELECT id FROM path WHERE public_id = ${PUBLIC_ID})`;
        const zeilen = await database<{ gleich_roh: boolean }[]>`
            SELECT ST_Equals(r.geom, map_domain_to_render('aventuria', p.geom)) AS gleich_roh
            FROM path_render r JOIN path p ON p.public_id = r.public_id
            WHERE r.public_id = ${PUBLIC_ID}
        `;
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]?.gleich_roh).toBe(true);
    });

    it("trägt weiter die Fließrichtung (0028) und den Kollisionsrang am Ende", async () => {
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'path_render' ORDER BY ordinal_position
        `;
        const namen = spalten.map((s) => s.column_name);
        expect(namen).toContain("flow_direction");
        expect(namen).toContain("collision_rank");
    });
});
