import { renderZoomForBand } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAxisGraph, longestPath, pathLength, resample } from "../src/derive/chordal-axis.ts";
import { fitCurve } from "../src/derive/curve-fit.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    deriveRegion,
    displayedNameWidth,
    interiorTriangles,
    placeRuns,
    shapeOf,
    trianglesOf,
    type DerivedRun,
    type RegionInput,
} from "../src/derive/label-runs.ts";
import { storeRuns } from "../src/derive/refresh-label-curve.ts";
import { mapUnitsPerPixel } from "../src/derive/run-geometry.ts";
import { verifyRuns, type RunCheck } from "../src/derive/verify-runs.ts";

/**
 * Konkave Einzelflächen: `verify:runs` I5 nennt einen Befund, keinen Fehler (Syrrenauen, 2026-09-30).
 *
 * 💣 Anlass: Syrrenauen (Legacy-Stand map157077) ist EIN Polygon von 3,4 Einheiten Fläche in einer Hüllbox von 3,6 × 4,4,
 * gebogen, sein Schwerpunkt liegt außerhalb. Legacys Verfahren (Polynomfit im Hauptachsenframe) legt den Lauf über die
 * Biegung; I5 wurde auf Stage rot. Betreiber: „sie sollen ihren Bogen beibehalten“. Die Ableitung ändert den Bogen
 * deshalb NICHT, und I5 führt einen solchen Lauf als benannten Befund statt als Fehler.
 *
 * Die Form kam mit einem Legacy-Zug und liegt lokal nicht vor: die Fixture bildet sie aus den Zahlen des Befunds nach
 * (Fläche, Hüllbox, ein Ring, Schwerpunkt außerhalb), ohne Legacy-Abruf.
 *
 * ⭐ Die Regel nennt keine Region: EIN Polygon mit Schwerpunkt außerhalb. Die Gegenproben halten fest, dass I5 für alles
 * andere scharf bleibt: eine Fläche mit Schwerpunkt innen und mehrere Teilflächen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const REGION_PUBLIC_ID = "00000000-0000-4000-8000-0000000004d1";
const LABEL_PUBLIC_ID = "00000000-0000-4000-8000-0000000004e1";
const AREA_PUBLIC_ID = "00000000-0000-4000-8000-0000000004f1";
const SECOND_AREA_PUBLIC_ID = "00000000-0000-4000-8000-0000000004f2";
const REGION_NAME = "Konkavprobe";

/** Ort der Fixtures, wie Syrrenauen weit im Osten der Karte. */
const CX = 524;
const CY = 514;

function polygonWkt(ring: readonly (readonly [number, number])[]): string {
    const closed = [...ring, ring[0] as readonly [number, number]];
    return `POLYGON((${closed.map(([x, y]) => `${String(x)} ${String(y)}`).join(",")}))`;
}

function arc(cx: number, cy: number, radius: number, from: number, to: number, steps = 60): [number, number][] {
    const points: [number, number][] = [];
    for (let index = 0; index <= steps; index += 1) {
        const angle = from + ((to - from) * index) / steps;
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
    return points;
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Ein C nach links geöffnet, +-130 Grad um die x-Achse: Fläche 3,4, Hüllbox 3,6 x 4,4 - die Zahlen des Befunds. */
function cShape(): string {
    const half = radians(130);
    return polygonWkt([...arc(CX + 1.4, CY, 2.2, -half, half), ...arc(CX + 1.4, CY, 1.83, half, -half)]);
}

/** Ein Rechteck: Schwerpunkt innen. */
function rectangleShape(): string {
    return polygonWkt([
        [CX - 4, CY - 1],
        [CX + 4, CY - 1],
        [CX + 4, CY + 1],
        [CX - 4, CY + 1],
    ]);
}

/** Ein Lappen von 3 x 1,2 Einheiten mit linker Kante bei `x`. */
function lobeShape(x: number): string {
    return polygonWkt([
        [x, CY],
        [x + 3, CY],
        [x + 3, CY + 1.2],
        [x, CY + 1.2],
    ]);
}

describeWithDatabase("verify:runs I5 und die konkave Einzelfläche", () => {
    let database: Database;
    let regionId = 0;
    let labelId = 0;

    // Wie Syrrenauen: ein Band, in dem der Name erst auf hohen Stufen steht (Läufe auf z7 und z8).
    const input = (): RegionInput => ({
        regionId,
        regionPublicId: REGION_PUBLIC_ID,
        name: REGION_NAME,
        styleLabelId: labelId,
        labelText: "Syrrenauen",
        labelSize: 18,
        labelType: null,
        labelMinZoom: 6,
        labelMaxZoom: 7,
        curveMax: 3,
        curveDegree: 3,
    });

    async function setAreas(...wkts: string[]): Promise<void> {
        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        const ids = [AREA_PUBLIC_ID, SECOND_AREA_PUBLIC_ID];
        for (const [index, wkt] of wkts.entries()) {
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active, geometry_revision)
                VALUES (${ids[index] as string}, 'aventuria', ${regionId}, ST_SetSRID(ST_GeomFromText(${wkt}), 0), true, 1)
            `;
        }
    }

    async function partIds(): Promise<string[]> {
        const rows = await database<{ public_id: string }[]>`
            SELECT public_id::text FROM region_area WHERE region_id = ${regionId} AND is_active ORDER BY ST_Area(geom) DESC
        `;
        return rows.map((row) => row.public_id);
    }

    /** Die Ableitung Schritt für Schritt, wie Legacy sie legt: Achse, Polynomfit, Platzierung. Die Referenz für „unverändert“. */
    async function legacyRuns(): Promise<DerivedRun[]> {
        const region = input();
        const shape = await shapeOf(database, await partIds());
        if (!shape) {
            throw new Error("keine vereinfachte Form");
        }
        const inside = await interiorTriangles(database, await trianglesOf(database, shape), shape);
        const axis = longestPath(buildAxisGraph(inside));
        const curve = fitCurve(resample(axis, 120), 120, region.curveDegree);
        return placeRuns(curve, {
            nameWidthPixels: displayedNameWidth(region),
            gapPixels: 2.0 * region.labelSize,
            lowest: renderZoomForBand(region.labelMinZoom),
            highest: renderZoomForBand(region.labelMaxZoom),
            wanted: Math.max(1, Math.min(3, region.curveMax)),
            labelSize: region.labelSize,
        });
    }

    /** Der Anteil der Lauflänge über der Fläche, kleinster über alle Läufe (dieselbe Messung wie I5). */
    async function smallestInsideShare(runs: readonly DerivedRun[]): Promise<number> {
        const wkts = runs.map(
            (run) => `LINESTRING(${run.points.map((point) => `${String(point.x)} ${String(point.y)}`).join(",")})`,
        );
        const [row] = await database<{ share: number }[]>`
            SELECT min(ST_Length(ST_Intersection(ST_GeomFromText(w, 0), shape.geom)) / ST_Length(ST_GeomFromText(w, 0))) AS share
            FROM unnest(${wkts}::text[]) AS w
            CROSS JOIN LATERAL (
                SELECT ST_Union(a.geom) AS geom FROM region_area a WHERE a.region_id = ${regionId} AND a.is_active
            ) shape
        `;
        return Number(row?.share);
    }

    /** Legt Läufe von Hand in den Bestand, wie `derive:runs` sie schriebe, und liefert die genannte Prüfung. */
    async function storeAndCheck(
        runs: DerivedRun[],
        name = "I5_laeuft_in_der_flaeche",
        nameWidthPixels = 100,
    ): Promise<RunCheck> {
        await storeRuns(database, input(), {
            regionId,
            name: REGION_NAME,
            runs,
            fingerprint: "verify-runs-concave-test",
            curveLength: 1,
            nameWidthPixels,
        });
        const report = await verifyRuns(database);
        const found = report.checks.find((entry) => entry.name === name);
        if (!found) {
            throw new Error(`Prüfung ${name} fehlt im Bericht`);
        }
        return found;
    }

    const line = (fromX: number, toX: number, y: number): DerivedRun => ({
        instance: 0,
        instanceCount: 1,
        runMinZoom: 7,
        runMaxZoom: 7,
        points: [
            { x: fromX, y },
            { x: toX, y },
        ],
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        // Eigener Bestand: I5 misst den ganzen Bestand, was schon in der Testdatenbank liegt, darf das Ergebnis nicht färben.
        await database`DELETE FROM landscape_label_run`;
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active, label_curve_enabled, label_curve_max)
            VALUES (${REGION_PUBLIC_ID}, 'aventuria', ${REGION_NAME}, 'topographie', true, true, 3)
            ON CONFLICT (public_id) DO UPDATE SET label_curve_max = 3
            RETURNING id::text
        `;
        regionId = Number(region?.id);
        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active,
                                   label_size, label_min_zoom, label_max_zoom, label_priority, region_id)
            VALUES (${LABEL_PUBLIC_ID}, 'aventuria', 'Syrrenauen', ST_SetSRID(ST_MakePoint(524, 514), 0), true,
                    18, 6, 7, 3, ${regionId})
            ON CONFLICT (public_id) DO UPDATE SET region_id = ${regionId}
            RETURNING id::text
        `;
        labelId = Number(label?.id);
        await database`UPDATE region SET primary_label_id = ${labelId} WHERE id = ${regionId}`;
    });

    afterAll(async () => {
        await database`DELETE FROM landscape_label_run WHERE region_id = ${regionId}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE id = ${regionId}`;
        await database`DELETE FROM map_label WHERE id = ${labelId}`;
        await database`DELETE FROM region_area WHERE region_id = ${regionId}`;
        await database`DELETE FROM region WHERE id = ${regionId}`;
        await database.end({ timeout: 5 });
    });

    it("die Fixture hat die Zahlen des Befunds: ein Ring, Fläche 3,4, Hüllbox 3,6 x 4,4, Schwerpunkt außerhalb", async () => {
        await setAreas(cShape());
        const [row] = await database<
            { area: number; width: number; height: number; rings: number; polygons: number; centroid_inside: boolean }[]
        >`
            SELECT ST_Area(geom) AS area, ST_XMax(geom) - ST_XMin(geom) AS width, ST_YMax(geom) - ST_YMin(geom) AS height,
                   ST_NumInteriorRings(geom) + 1 AS rings, ST_NumGeometries(geom) AS polygons,
                   ST_Contains(geom, ST_Centroid(geom)) AS centroid_inside
            FROM region_area WHERE region_id = ${regionId}
        `;
        expect(row?.area).toBeCloseTo(3.4, 1);
        expect(row?.width).toBeCloseTo(3.6, 1);
        expect(row?.height).toBeCloseTo(4.4, 1);
        expect(row?.rings).toBe(1);
        expect(row?.polygons).toBe(1);
        expect(row?.centroid_inside).toBe(false);
    });

    it("🔴 der Bogen bleibt, wie Legacys Verfahren ihn legt, und I5 nennt einen Befund statt eines Fehlers", async () => {
        await setAreas(cShape());
        const result = await deriveRegion(database, input());
        expect(result.skipped).toBeUndefined();
        expect(new Set(result.runs.map((run) => run.runMinZoom)), "Läufe auf z7 und z8 wie Syrrenauen").toEqual(
            new Set([7, 8]),
        );
        // Die Ableitung ist Legacys Verfahren, Schritt für Schritt, ohne Abhilfe für die Biegung.
        expect(result.runs).toEqual(await legacyRuns());
        // Und sie liegt über der Biegung, mehrheitlich außerhalb - genau das ist der Befund von Stage.
        expect(await smallestInsideShare(result.runs), "der Lauf liegt über der Biegung").toBeLessThan(0.5);

        const i5 = await storeAndCheck(result.runs);
        expect(i5.passed, "kein Fehler").toBe(true);
        expect(i5.offenders, "keine Abweichler").toBeUndefined();
        expect(i5.findings?.length, "je Lauf ein Befund").toBe(result.runs.length);
        for (const finding of i5.findings ?? []) {
            expect(finding).toMatch(new RegExp(`^${REGION_NAME} @z[78]: \\d\\.\\d+ innen \\(konkave Einzelfläche`));
        }
    });

    it("🔴 eine Fläche mit Schwerpunkt innen und einem Lauf daneben bleibt ein FEHLER (I5 ist scharf)", async () => {
        await setAreas(rectangleShape());
        const i5 = await storeAndCheck([line(CX - 3, CX + 3, CY + 5)]);
        expect(i5.passed).toBe(false);
        expect(i5.offenders?.[0]).toMatch(new RegExp(`^${REGION_NAME} @z7: 0\\.000 innen`));
        expect(i5.findings).toBeUndefined();
    });

    it("🔴 mehrere Teilflächen bleiben scharf, auch wenn der Schwerpunkt zwischen ihnen liegt", async () => {
        await setAreas(lobeShape(CX), lobeShape(CX + 5));
        // Ein Lauf über die Lücke, zu einem Drittel innen: bei einem Polygon mit Schwerpunkt außerhalb wäre das ein
        // Befund, bei zwei Teilen ist es ein Fehler.
        const i5 = await storeAndCheck([line(CX + 2.5, CX + 5.5, CY + 0.6)]);
        expect(i5.passed).toBe(false);
        expect(i5.offenders?.[0]).toMatch(new RegExp(`^${REGION_NAME} @z7: 0\\.3\\d\\d innen`));
        expect(i5.findings).toBeUndefined();
    });

    it("🔴 I2: ein Einzellauf, der seinen Namen nicht trägt, ist ein Fehler", async () => {
        // Befund 2026-10-11: MapLibre setzt einen Namen, der länger ist als seine Linie, gar nicht, und das Punktlabel der
        // Region schweigt (`has_curve_run`). Die Ausnahme für den Einzellauf ließ genau das durch (Dairuchsee z5).
        await setAreas(rectangleShape());
        // Name 100 px auf z7 sind 1,5625 Einheiten, der Lauf hat eine.
        const i2 = await storeAndCheck([line(CX - 0.5, CX + 0.5, CY)], "I2_laenger_als_der_name");
        expect(i2.passed).toBe(false);
        expect(i2.offenders?.[0]).toBe(`${REGION_NAME} @z7: 1.00 < 1.56`);
    });

    it("🔴 ist die Fläche zu klein für den Namen, wird der Lauf verlängert, und I5 misst das Kurvenstück", async () => {
        // Wie Efferdstränen auf z3: Der Name ist länger als die ganze Fläche. Der Lauf muss hinausragen, damit er ihn trägt;
        // die angesetzten Stücke liegen draußen, die Kurve selbst liegt innen.
        await setAreas(rectangleShape());
        const region = { ...input(), labelMinZoom: 2 };
        const result = await deriveRegion(database, region);
        expect(result.skipped).toBeUndefined();
        const z3 = result.runs.filter((run) => run.runMinZoom === 3);
        expect(z3, "auf z3 ein einzelner Name").toHaveLength(1);
        const needed = result.nameWidthPixels * mapUnitsPerPixel(3);
        expect(needed, "der Name ist länger als die Fläche").toBeGreaterThan(8);
        for (const run of result.runs) {
            expect(pathLength(run.points), `z${String(run.runMinZoom)} trägt den Namen`).toBeGreaterThanOrEqual(
                result.nameWidthPixels * mapUnitsPerPixel(run.runMinZoom),
            );
        }
        expect(await smallestInsideShare(z3), "der verlängerte Lauf liegt mehrheitlich draußen").toBeLessThan(0.5);

        const i5 = await storeAndCheck(result.runs, "I5_laeuft_in_der_flaeche", result.nameWidthPixels);
        expect(i5.passed, i5.offenders?.join("; ")).toBe(true);
        expect(i5.offenders).toBeUndefined();
        const i2 = await storeAndCheck(result.runs, "I2_laenger_als_der_name", result.nameWidthPixels);
        expect(i2.passed, i2.offenders?.join("; ")).toBe(true);
    });

    it("ein Lauf, der mehrheitlich innen liegt, ist weder Fehler noch Befund", async () => {
        await setAreas(rectangleShape());
        const i5 = await storeAndCheck([line(CX - 3, CX + 3, CY)]);
        expect(i5.passed).toBe(true);
        expect(i5.offenders).toBeUndefined();
        expect(i5.findings).toBeUndefined();
    });
});
