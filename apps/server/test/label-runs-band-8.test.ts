import { VECTOR_TILE_MAX_ZOOM } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { deriveRegion, runCeilingBand, runFloorZoom, type RegionInput } from "../src/derive/label-runs.ts";
import { storeRuns } from "../src/derive/refresh-label-curve.ts";
import { verifyRuns } from "../src/derive/verify-runs.ts";

/**
 * Die Schriftläufe bei Zielmaximum 8 (WI-0129, Betreiber 2026-10-10 E2 A).
 *
 * Legacys „bis 7“ steht im Ziel als 8. Die Karte zeigt Stufe 8 aus der Vektorkachel der Stufe 7 (MapLibre 8, Überzoom, E1 A);
 * Läufe für eine höhere Kachelstufe fragt niemand ab. Deshalb rechnet die Ableitung bis zur höchsten ausgelieferten Kachel, und
 * ein Maximum 8 ergibt dieselben Läufe und denselben Fingerabdruck wie 7: keine Neuableitung, keine neuen Zeilen, kein Name
 * anders verteilt. Gemessen am Bestand (Discovery zoomstufe-8 §7.4): ungedeckelt kämen 123 nie ausgelieferte Läufe dazu.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const REGION_PUBLIC_ID = "00000000-0000-4000-8000-000000129a01";
const LABEL_PUBLIC_ID = "00000000-0000-4000-8000-000000129b01";
const AREA_PUBLIC_ID = "00000000-0000-4000-8000-000000129c01";
const NAME = "Bandprobe";

describe("runCeilingBand: die Läufe enden an der höchsten ausgelieferten Kachel", () => {
    it("🔴 ein Zielmaximum 8 rechnet wie 7 (MapLibre 8 = Stufe 7), kleinere Maxima bleiben", () => {
        expect(runCeilingBand(8)).toBe(7);
        expect(runCeilingBand(7)).toBe(7);
        expect(runCeilingBand(3)).toBe(3);
    });
});

describe("runFloorZoom: die unterste Stufe hält bis zum kleinsten Zoom (WI-0129 §17d)", () => {
    it("🔴 ein Band ab Stufe 0 beginnt mit Kachel 0, ein Band ab Stufe n mit Kachel n+1", () => {
        // Die Karte zoomt am Telefon bis MapLibre 0,71 hinaus (Kachel 0, Zoomanzeige 0). Läufe erst ab Kachel 1 ließen dort einen
        // Kurvennamen ab Stufe 0 fehlen, wie den Punktnamen „Aventurien“.
        expect(runFloorZoom(0)).toBe(0);
        expect(runFloorZoom(1)).toBe(2);
        expect(runFloorZoom(3)).toBe(4);
    });
});

describeWithDatabase("Schriftläufe bei Zielmaximum 8, gegen PostGIS", () => {
    let database: Database;
    let regionId = 0;
    let labelId = 0;

    const input = (labelMaxZoom: number, labelMinZoom = 3): RegionInput => ({
        regionId,
        regionPublicId: REGION_PUBLIC_ID,
        name: NAME,
        styleLabelId: labelId,
        labelText: NAME,
        labelSize: 18,
        labelType: null,
        labelMinZoom,
        labelMaxZoom,
        curveMax: 2,
        curveDegree: 3,
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active, label_curve_enabled, label_curve_max)
            VALUES (${REGION_PUBLIC_ID}, 'aventuria', ${NAME}, 'topographie', true, true, 2)
            ON CONFLICT (public_id) DO UPDATE SET label_curve_max = 2
            RETURNING id::text
        `;
        regionId = Number(region?.id);
        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active, geometry_revision)
            VALUES (${AREA_PUBLIC_ID}, 'aventuria', ${regionId},
                    ST_SetSRID(ST_GeomFromText('POLYGON((400 300, 440 300, 440 306, 400 306, 400 300))'), 0), true, 1)
        `;
        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active, label_size, label_min_zoom, label_max_zoom,
                                   label_priority, region_id)
            VALUES (${LABEL_PUBLIC_ID}, 'aventuria', ${NAME}, ST_SetSRID(ST_MakePoint(420, 303), 0), true, 18, 3, 8, 3, ${regionId})
            ON CONFLICT (public_id) DO UPDATE SET region_id = ${regionId}, label_min_zoom = 3, label_max_zoom = 8
            RETURNING id::text
        `;
        labelId = Number(label?.id);
        await database`UPDATE region SET primary_label_id = ${labelId} WHERE id = ${regionId}`;
    }, 120_000);

    afterAll(async () => {
        await database`DELETE FROM landscape_label_run WHERE region_id = ${regionId}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE id = ${regionId}`;
        await database`DELETE FROM map_label WHERE id = ${labelId}`;
        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        await database`DELETE FROM region WHERE id = ${regionId}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 Maximum 8 und Maximum 7 ergeben dieselben Läufe und denselben Fingerabdruck, keinen Lauf über der Kachelstufe", async () => {
        const sieben = await deriveRegion(database, input(7));
        const acht = await deriveRegion(database, input(8));
        expect(sieben.skipped).toBeUndefined();
        expect(acht.runs.length).toBeGreaterThan(0);
        expect(acht.runs).toEqual(sieben.runs);
        expect(acht.fingerprint, "keine Neuableitung nach dem Import").toBe(sieben.fingerprint);
        expect(Math.max(...acht.runs.map((run) => run.runMaxZoom))).toBe(VECTOR_TILE_MAX_ZOOM);
    });

    it("🔴 verify:runs meldet bei Maximum 8 keine Lücke, obwohl die Läufe an der Kachelstufe enden", async () => {
        const acht = await deriveRegion(database, input(8));
        await storeRuns(database, input(8), acht);
        const report = await verifyRuns(database);
        const luecken = report.checks.find((check) => check.name === "I2_baender_lueckenlos");
        expect((luecken?.offenders ?? []).filter((line) => line.startsWith(NAME))).toEqual([]);
    });

    it("🔴 ein Band ab Stufe 0 hat Läufe ab Kachel 0, und verify:runs meldet dort keine Lücke (WI-0129 §17d)", async () => {
        await database`UPDATE map_label SET label_min_zoom = 0 WHERE id = ${labelId}`;
        try {
            const abNull = await deriveRegion(database, input(8, 0));
            expect(abNull.skipped).toBeUndefined();
            expect(Math.min(...abNull.runs.map((run) => run.runMinZoom))).toBe(0);
            await storeRuns(database, input(8, 0), abNull);
            const report = await verifyRuns(database);
            const luecken = report.checks.find((check) => check.name === "I2_baender_lueckenlos");
            expect((luecken?.offenders ?? []).filter((line) => line.startsWith(NAME))).toEqual([]);
        } finally {
            await database`UPDATE map_label SET label_min_zoom = 3 WHERE id = ${labelId}`;
        }
    });
});
