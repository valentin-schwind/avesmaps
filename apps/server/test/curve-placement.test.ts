import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { deriveRegion, type RegionInput } from "../src/derive/label-runs.ts";
import { maxDeviationAngle, pathLength } from "../src/derive/curve-fit.ts";
import { mapUnitsPerPixel } from "../src/derive/run-geometry.ts";

const testUrl = process.env["TEST_DATABASE_URL"];
const withDatabase = testUrl ? describe : describe.skip;
const publicId = "00000000-0000-4000-8000-0000000116a1";

function crescentWkt(): string {
    const arc = (radius: number) =>
        Array.from({ length: 121 }, (_, index) => {
            const angle = (-0.75 + (1.5 * index) / 120) * Math.PI;
            return `${500 + radius * Math.cos(angle)} ${500 + radius * Math.sin(angle)}`;
        });
    const outer = arc(58);
    return `MULTIPOLYGON(((${[...outer, ...arc(42).reverse(), outer[0]].join(",")})),((400 400,401 400,401 401,400 401,400 400)))`;
}

withDatabase("Kurvenwahl auf konkaver mehrteiliger Fläche (WI-0116)", () => {
    let database: Database;
    let regionId: number;
    const input = (name = "Testgebirgssichel"): RegionInput => ({
        regionId,
        regionPublicId: publicId,
        name,
        styleLabelId: 0,
        labelText: "Testgebirge",
        labelSize: 20,
        labelType: "gebirge",
        labelMinZoom: 2,
        labelMaxZoom: 7,
        curveMax: 2,
        curveDegree: 3,
    });
    beforeAll(async () => {
        database = createDatabase(testUrl as string);
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id=${publicId})`;
        await database`DELETE FROM region WHERE public_id=${publicId}`;
        const [region] = await database<
            { id: string }[]
        >`INSERT INTO region (public_id,map_domain_id,name,region_layer,is_active) VALUES (${publicId},'aventuria','Testgebirgssichel','topographie',TRUE) RETURNING id::text`;
        regionId = Number(region?.id);
        await database`INSERT INTO region_area (public_id,map_domain_id,region_id,geom,is_active,geometry_revision) VALUES (gen_random_uuid(),'aventuria',${regionId},ST_GeomFromText(${crescentWkt()},0),TRUE,1)`;
    });
    afterAll(async () => {
        await database`DELETE FROM region_area WHERE region_id=${regionId}`;
        await database`DELETE FROM region WHERE id=${regionId}`;
        await database.end({ timeout: 5 });
    });

    it("legt beide Namen in die Sichel und bewahrt Länge, Beruhigung und alle Zoombänder", async () => {
        const result = await deriveRegion(database, input());
        expect(result.skipped).toBeUndefined();
        expect(new Set(result.runs.map((run) => run.runMinZoom))).toEqual(new Set([3, 4, 5, 6, 7, 8]));
        for (const run of result.runs) {
            if (run.runMinZoom >= 4) expect(run.instanceCount).toBe(2);
            const line = `LINESTRING(${run.points.map((point) => `${point.x} ${point.y}`).join(",")})`;
            const [coverage] = await database<
                { share: number }[]
            >`SELECT ST_Length(ST_Intersection(ST_GeomFromText(${line},0),geom))/ST_Length(ST_GeomFromText(${line},0)) share FROM region_area WHERE region_id=${regionId}`;
            expect(coverage?.share, `z${run.runMinZoom} i${run.instance}`).toBeGreaterThan(0.5);
            expect(pathLength(run.points)).toBeGreaterThanOrEqual(
                result.nameWidthPixels * mapUnitsPerPixel(run.runMinZoom) * (1 - 1e-6),
            );
            expect(maxDeviationAngle(run.points)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
        }
    });

    it("bewahrt namentliche Abnahmen und entwertet bei Wechsel des Abnahmestatus den Fingerabdruck", async () => {
        const reviewed = await deriveRegion(database, input("Dragwallthal"));
        const corrected = await deriveRegion(database, input());
        expect(reviewed.runs).not.toEqual(corrected.runs);
        expect(reviewed.fingerprint).not.toBe(corrected.fingerprint);
        expect((await deriveRegion(database, input("Dragwallthal"))).runs).toEqual(reviewed.runs);
    });

    it("lässt den Bogen einer konkaven Einzelfläche unabhängig vom Namen unverändert", async () => {
        try {
            await database`UPDATE region_area SET geom = ST_GeometryN(geom, 1) WHERE region_id = ${regionId}`;
            const [shape] = await database<{ concave: boolean }[]>`
                SELECT NOT ST_Contains(geom, ST_Centroid(geom)) AS concave FROM region_area WHERE region_id = ${regionId}
            `;
            expect(shape?.concave).toBe(true);
            const original = await deriveRegion(database, input("Dragwallthal"));
            expect((await deriveRegion(database, input())).runs).toEqual(original.runs);
        } finally {
            await database`UPDATE region_area SET geom = ST_GeomFromText(${crescentWkt()}, 0) WHERE region_id = ${regionId}`;
        }
    });
});
