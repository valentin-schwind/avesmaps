import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Der Merker „gleichnamig“ an den Landschaftsnamen (WI-0135, Migration 0109).
 *
 * Betreiber 2026-10-11: „bei 2 flächen, die gleich heißen, in einer 2. zeile "steppe" oder "tiefebene" (klein, zentriert) unter
 * dem name“ und „das brauchen wir nur bei vegetation und topographie“. Der Stil zeigt die Art nur, wenn die Kachel den Merker
 * trägt; hier steht die Regel an der echten Relation, mit eigenem Bestand.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

interface Flaeche {
    key: string;
    name: string;
    layer: string;
    type: string;
    active?: boolean;
    area?: boolean;
    label?: boolean;
}

/** Je Fall eine eigene Kennungsreihe, damit kein fremder Bestand das Ergebnis färbt. */
const FLAECHEN: Flaeche[] = [
    { key: "01", name: "Zwillingsöde WI0135", layer: "vegetation", type: "steppe", label: true },
    { key: "02", name: "Zwillingsöde WI0135", layer: "topographie", type: "tiefebene" },
    { key: "03", name: "Zwillingsöde WI0135", layer: "derographisch", type: "region", label: true },
    { key: "04", name: "Einzelöde WI0135", layer: "vegetation", type: "steppe", label: true },
    { key: "05", name: "Flächenlose Öde WI0135", layer: "vegetation", type: "steppe", label: true },
    { key: "06", name: "Flächenlose Öde WI0135", layer: "topographie", type: "tiefebene", area: false },
    { key: "07", name: "Stillgelegte Öde WI0135", layer: "vegetation", type: "steppe", label: true },
    { key: "08", name: "Stillgelegte Öde WI0135", layer: "topographie", type: "tiefebene", active: false },
];

const regionId = (key: string): string => `00000000-0000-4000-8000-0000135a00${key}`;
const labelId = (key: string): string => `00000000-0000-4000-8000-0000135b00${key}`;
const areaId = (key: string): string => `00000000-0000-4000-8000-0000135c00${key}`;

describeWithDatabase("Landschaftsnamen: Merker „gleichnamig“ (WI-0135)", () => {
    let database: Database;

    const aufraeumen = async (): Promise<void> => {
        const regionen = FLAECHEN.map((flaeche) => regionId(flaeche.key));
        await database`UPDATE region SET primary_label_id = NULL WHERE public_id = ANY(${regionen}::uuid[])`;
        await database`DELETE FROM map_label WHERE public_id = ANY(${FLAECHEN.map((f) => labelId(f.key))}::uuid[])`;
        await database`DELETE FROM region_area WHERE public_id = ANY(${FLAECHEN.map((f) => areaId(f.key))}::uuid[])`;
        await database`DELETE FROM region WHERE public_id = ANY(${regionen}::uuid[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        for (const [index, flaeche] of FLAECHEN.entries()) {
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${regionId(flaeche.key)}, 'aventuria', ${flaeche.name}, ${flaeche.layer}, ${flaeche.type},
                        ${flaeche.active ?? true})
                RETURNING id::text
            `;
            const id = Number(region?.id);
            if (flaeche.area ?? true) {
                const x = 100 + index * 10;
                await database`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active, geometry_revision)
                    VALUES (${areaId(flaeche.key)}, 'aventuria', ${id},
                            ST_SetSRID(ST_MakeEnvelope(${x}, 100, ${x + 8}, 108), 0), true, 1)
                `;
            }
            if (flaeche.label === true) {
                await database`
                    INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active,
                                           label_size, label_min_zoom, label_max_zoom, label_priority, region_id)
                    VALUES (${labelId(flaeche.key)}, 'aventuria', ${flaeche.name},
                            ST_SetSRID(ST_MakePoint(${x0(index)}, 104), 0), true, 14, 2, 7, 3, ${id})
                `;
            }
        }
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    const merker = async (key: string): Promise<boolean | undefined> => {
        const [zeile] = await database<{ name_twin: boolean }[]>`
            SELECT name_twin FROM map_label_render WHERE public_id = ${labelId(key)}
        `;
        return zeile?.name_twin;
    };

    it("🔴 eine Steppe, die so heißt wie eine Tiefebene, trägt den Merker", async () => {
        expect(await merker("01")).toBe(true);
    });

    it("🔴 die Derographie nie, auch bei gleichem Namen (Betreiber: „nur bei vegetation und topographie“)", async () => {
        expect(await merker("03")).toBe(false);
    });

    it("ohne zweite gleichnamige Fläche kein Merker", async () => {
        expect(await merker("04")).toBe(false);
    });

    it("🪤 eine Region ohne aktive Fläche zählt nicht als Zwilling: Auf der Karte gibt es sie nicht", async () => {
        expect(await merker("05")).toBe(false);
    });

    it("🪤 eine stillgelegte Region zählt nicht als Zwilling", async () => {
        expect(await merker("07")).toBe(false);
    });

    it("der Merker ist nie NULL: ein Name ohne Region trägt false", async () => {
        const [zeile] = await database<{ ohne: string }[]>`
            SELECT count(*)::text AS ohne FROM map_label_render WHERE name_twin IS NULL
        `;
        expect(zeile?.ohne).toBe("0");
    });
});

/** Der Punkt eines Namens liegt in seiner Fläche. */
function x0(index: number): number {
    return 104 + index * 10;
}
