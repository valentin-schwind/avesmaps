import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { derivePathRunsFor, laufAufBach } from "../src/derive/path-runs.ts";

/**
 * Bachnamen tragen ihr Merkmal (WI-0177, Migration 0199; Befund der Kartenverwaltung WI-0221 §10). Problemfälle: Der Schriftlauf kennt
 * `is_bach` nicht, also stehen Bachnamen in Flussgröße und unter Band 4; ein Lauf auf dem Flussteil einer gemischten Kette (Ingval:
 * 1 Bach-, 18 Flussabschnitte) wird zum Bachnamen; Sicht oder Kachel liefern das Merkmal nicht aus.
 */

describe("laufAufBach: je Lauf, an seiner Mitte", () => {
    const bach = [
        [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ],
    ];
    it("🔴 die Mitte auf dem Bachabschnitt ist ein Bachname, auf dem Flussteil nicht", () => {
        expect(
            laufAufBach(
                [
                    { x: 20, y: 0 },
                    { x: 60, y: 0 },
                ],
                bach,
            ),
        ).toBe(true);
        expect(
            laufAufBach(
                [
                    { x: 120, y: 0 },
                    { x: 300, y: 0 },
                ],
                bach,
            ),
        ).toBe(false);
        // Über die Grenze hinweg entscheidet die Mitte: hier auf dem Flussteil.
        expect(
            laufAufBach(
                [
                    { x: 80, y: 0 },
                    { x: 200, y: 0 },
                ],
                bach,
            ),
        ).toBe(false);
    });
    it("ohne Bachabschnitte nie", () => {
        expect(
            laufAufBach(
                [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                ],
                [],
            ),
        ).toBe(false);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SOURCE = "test-wi0177-bachnamen";
const NAMEN = { gemischt: "W0199 Gemischter Fluss", bach: "W0199 Reiner Bach", fluss: "W0199 Reiner Fluss" } as const;

describeWithDatabase("Schriftläufe der Bachnamen (Migration 0199)", { timeout: 120_000 }, () => {
    let database: Database;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM path_label_run WHERE name = ANY(${Object.values(NAMEN)})`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
    }
    const weg = (name: string, bach: boolean, von: number, bis: number, y: number) => database`
        INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
        VALUES (gen_random_uuid(), 'aventuria', ${name}, 'Flussweg', TRUE, ${bach},
                ST_GeomFromText(${`LINESTRING(${String(von)} ${String(y)}, ${String(bis)} ${String(y)})`}, 0), ${SOURCE})
    `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await aufraeumen();
        // Eine gemischte Kette: links der Bach, rechts der Fluss, zusammenhängend.
        await weg(NAMEN.gemischt, true, 100, 400, 520);
        await weg(NAMEN.gemischt, false, 400, 900, 520);
        await weg(NAMEN.bach, true, 100, 700, 560);
        await weg(NAMEN.fluss, false, 100, 700, 600);
        await derivePathRunsFor(
            database,
            "aventuria",
            Object.values(NAMEN).map((name) => ({ name, subtype: "Flussweg" })),
        );
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    const laeufe = (name: string) =>
        database<{ is_bach: boolean | null; mitte: number }[]>`
            SELECT is_bach, ST_X(ST_LineInterpolatePoint(geom, 0.5)) AS mitte FROM path_label_run WHERE name = ${name}
        `;

    it("🔴 eine gemischte Kette: Läufe auf dem Bachteil sind Bachnamen, auf dem Flussteil Flussnamen", async () => {
        const runs = await laeufe(NAMEN.gemischt);
        expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) expect(run.is_bach).toBe(run.mitte < 400);
        expect(runs.some((r) => r.is_bach === false)).toBe(true);
    });

    it("🔴 ganz Bach: jeder Lauf; ganz Fluss: keiner; nie NULL nach der Ableitung", async () => {
        const bach = await laeufe(NAMEN.bach);
        const fluss = await laeufe(NAMEN.fluss);
        expect(bach.length).toBeGreaterThan(0);
        expect(fluss.length).toBeGreaterThan(0);
        expect(bach.every((r) => r.is_bach === true)).toBe(true);
        expect(fluss.every((r) => r.is_bach === false)).toBe(true);
    });

    it("🔴 OPS-000098: eine Kette ohne Namen endet leer, statt am Breitencheck zu scheitern", async () => {
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (gen_random_uuid(), 'aventuria', '', 'Weg', TRUE, FALSE, ST_GeomFromText('LINESTRING(100 640, 700 640)', 0), ${SOURCE})
        `;
        const bericht = await derivePathRunsFor(database, "aventuria", [{ name: "", subtype: "Weg" }]);
        expect(bericht).toMatchObject({ chains: 0, runs: 0 });
        const [zahl] = await database<{ n: string }[]>`
            SELECT count(*)::text AS n FROM path_label_run WHERE map_domain_id = 'aventuria' AND name = '' AND subtype = 'Weg'
        `;
        expect(zahl!.n).toBe("0");
    });

    it("🔴 Sicht und Kachel liefern das Merkmal aus", async () => {
        const [sicht] = await database<{ is_bach: boolean }[]>`
            SELECT is_bach FROM path_label_run_render WHERE name = ${NAMEN.bach} LIMIT 1
        `;
        expect(sicht?.is_bach).toBe(true);
        // Die Kachel an der Stelle eines Laufs, auf seiner obersten Stufe: Sie trägt die Eigenschaft `is_bach`.
        const [kachel] = await database<{ hat: boolean }[]>`
            WITH lauf AS (
                SELECT run_max_zoom AS z, ST_LineInterpolatePoint(geom, 0.5) AS p
                  FROM path_label_run_render WHERE name = ${NAMEN.bach} ORDER BY run_max_zoom DESC LIMIT 1
            ), xy AS (
                SELECT z,
                       floor((ST_X(p) + 20037508.342789244) / (2 * 20037508.342789244) * power(2, z))::int AS x,
                       floor((20037508.342789244 - ST_Y(p)) / (2 * 20037508.342789244) * power(2, z))::int AS y
                  FROM lauf
            )
            SELECT position(convert_to('is_bach', 'UTF8') IN path_label_run_tile(z, x, y)) > 0 AS hat FROM xy
        `;
        expect(kachel?.hat).toBe(true);
    });
});
