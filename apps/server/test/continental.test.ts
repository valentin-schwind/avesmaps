import { describe, expect, it } from "vitest";
import { coastalRidge, continentalHeight, continentalRise } from "../src/terrain/continental.ts";
import { generateContinentalBase } from "../src/terrain/continental-generate.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";
import { sampleAt } from "../src/terrain/path-profiles.ts";
import { chordAbove, lineShape, reliefAt, type TerrainHeights } from "../src/routing/relief.ts";
import { airTerrain, blockedCells } from "../src/routing/air-obstacles.ts";
import { composeDem } from "../src/terrain/dem-tiles.ts";
import { DEM_CELL, demHeight, fieldOf, lowerDemAt } from "../src/terrain/river-field.ts";

const square = (lo: number, hi: number): number[][] => [
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
    [lo, lo],
];
const water = [
    { kind: "meer" as const, geometry: { type: "Polygon", coordinates: [square(0, 1024), square(200, 824)] } },
    { kind: "see" as const, geometry: { type: "Polygon", coordinates: [square(360, 400)] } },
];

describe("fachlicher Kontinentalsockel", () => {
    it("bildet einen erhöhten Küstenrand mit Abfall zum Meer und ins Hinterland", () => {
        expect(coastalRidge(0)).toBe(0);
        expect(coastalRidge(1)).toBe(50);
        expect(coastalRidge(9)).toBe(0);
        expect(coastalRidge(0.5)).toBeLessThan(coastalRidge(1));
        expect(coastalRidge(1)).toBeGreaterThan(coastalRidge(4));
        expect(coastalRidge(4)).toBeGreaterThan(coastalRidge(8));
        expect(coastalRidge(0.001)).toBeLessThan(0.001);
        expect(coastalRidge(8.999)).toBeLessThan(0.001);
    });
    it("hebt Hochebenen eben an und formt im Hügelland breite, begrenzte Kuppen", () => {
        const area = {
            layer: "topographie" as const,
            area: 160000,
            geometry: { type: "Polygon", coordinates: [square(300, 700)] },
        };
        const plateau = generateContinentalBase(
            water,
            [{ x: 500, y: 500, h: 350 }],
            { rivers: [], lakes: [] },
            512,
            [],
            [{ ...area, type: "hochebene" }],
        );
        expect(continentalHeight(plateau, 450, 450)).toBe(450);
        expect(continentalHeight(plateau, 500, 500)).toBeLessThanOrEqual(350);
        const hills = generateContinentalBase(
            water,
            [],
            { rivers: [], lakes: [] },
            512,
            [],
            [{ ...area, type: "huegelland" }],
        );
        const values: number[] = [];
        for (let x = 430; x < 470; x += 1) {
            const height = continentalHeight(hills, x, 450);
            values.push(height);
            expect(height).toBeGreaterThanOrEqual(350);
            expect(height).toBeLessThanOrEqual(400);
            if (values.length > 1) expect(Math.abs(height - (values[values.length - 2] as number))).toBeLessThan(10);
        }
        expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(5);
        const heights: TerrainHeights = {
            rasters: [],
            cones: [],
            rule: DEFAULT_CONE,
            continental: plateau,
            mu: { FOOT: { mountain: 1, peak: 1 }, EQUID: { mountain: 1, peak: 1 }, WHEEL: { mountain: 1, peak: 1 } },
        };
        expect(
            [...blockedCells(airTerrain(heights), { minX: 440, minY: 440, cell: 1, cols: 4, rows: 4 }, 400)].every(
                Boolean,
            ),
        ).toBe(true);
    });
    it("schneidet an einer festen Bergflanke nur den Sockel für die bilineare Kachel nach", () => {
        // On the DEM grid, halfway between its first two cell centres: the bilinear tile reads both rasters.
        const shape = { cell: DEM_CELL, originX: DEM_CELL / 2, originY: DEM_CELL / 2, width: 2, height: 2 };
        const mountain = { ...shape, samples: Uint16Array.from([0, 300, 0, 300]) };
        const base = { ...shape, samples: new Uint16Array(4).fill(200) };
        const field = fieldOf([mountain, base], [], new Set([mountain]));
        const at = DEM_CELL;
        expect(demHeight(field, DEM_CELL, at)).toBe(250);
        expect(lowerDemAt(field, DEM_CELL, at, 180)).toBeGreaterThan(0);
        expect(demHeight(field, DEM_CELL, at)).toBeLessThanOrEqual(181);
        expect([...mountain.samples]).toEqual([0, 300, 0, 300]);
    });
    const continental = generateContinentalBase(water, [{ x: 600, y: 600, h: 50 }], { rivers: [], lakes: [] }, 128);
    it("erreicht im Inneren 300, bleibt im Meer 0 und läuft an beiden Enden mit flacher Tangente aus", () => {
        expect(continentalRise(0)).toBe(0);
        expect(continentalRise(100)).toBe(300);
        expect(continentalRise(200)).toBe(300);
        expect(continentalRise(0.001)).toBeLessThan(0.001);
        expect(300 - continentalRise(99.999)).toBeLessThan(0.001);
        expect(continentalHeight(continental, 100, 500)).toBe(0);
        expect(continentalHeight(continental, 500, 500)).toBe(300);
        expect(continentalHeight(continental, 220, 500)).toBeLessThan(continentalHeight(continental, 250, 500));
    });
    it("begräbt auch bekannte Gipfel unter 300 Schritt nicht", () => {
        expect(continentalHeight(continental, 600, 600)).toBeLessThanOrEqual(50);
    });
    it("hält Seen ohne Zu- oder Abfluss eben", () => {
        const values = new Set<number>();
        for (let y = 372; y < 396; y += 8)
            for (let x = 372; x < 396; x += 8) values.add(continentalHeight(continental, x, y));
        expect(values.size).toBe(1);
    });
    it("liefert Routing und Wegprofil dieselbe Höhe, ohne Flachland zum Gebirge zu erklären", () => {
        const result = reliefAt({ rasters: [], cones: [], rule: DEFAULT_CONE, continental }, 500, 500);
        expect(result.height).toBe(300);
        const profile = sampleAt({ rasters: [], peaks: [], rule: DEFAULT_CONE, continental }, 500, 500);
        expect(profile).toEqual({ height: result.height, mountain: false });
    });
    it("ist bei denselben Eingaben bytegleich", () => {
        expect(
            generateContinentalBase(water, [{ x: 600, y: 600, h: 50 }], { rivers: [], lakes: [] }, 128).fingerprint,
        ).toBe(continental.fingerprint);
    });
    it("liefert auch der 3D-Kachel dieselbe Höhe", () => {
        const dem = composeDem([], [], DEFAULT_CONE, continental, 4096);
        expect(dem[2095 * 4096 + 2000]).toBeCloseTo(continentalHeight(continental, 500.125, 500.125), 4);
    });
    it("berücksichtigt den Sockel bei direkter Flugprüfung, Hindernisraster und Höhenprofil", () => {
        const heights: TerrainHeights = {
            rasters: [],
            cones: [],
            rule: DEFAULT_CONE,
            continental,
            mu: {
                FOOT: { mountain: 1, peak: 1 },
                EQUID: { mountain: 1, peak: 1 },
                WHEEL: { mountain: 1, peak: 1 },
            },
        };
        expect(chordAbove(heights, { x: 480, y: 480 }, { x: 500, y: 500 }, 299)).toBe(true);
        expect(chordAbove(heights, { x: 480, y: 480 }, { x: 500, y: 500 }, 300)).toBe(false);
        const frame = { minX: 480, minY: 480, cell: 1, cols: 4, rows: 4 };
        expect([...blockedCells(airTerrain(heights), frame, 299)].every(Boolean)).toBe(true);
        expect([...blockedCells(airTerrain(heights), frame, 300)].some(Boolean)).toBe(false);
        expect(
            lineShape(heights, [
                [480, 480],
                [500, 500],
            ])?.highest,
        ).toBe(300);
    });
});
