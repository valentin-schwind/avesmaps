import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { fixedLakeBurn, flattenDomainLakes } from "../src/terrain/domain/lakes.ts";
import { AVENTURIA_TERRAIN_RECIPE, type TerrainRecipe } from "../src/terrain/domain/recipes.ts";
import { verifyDomainRaster } from "../src/terrain/domain/verify.ts";
import { burnRivers, RISE_TOLERANCE, risingRivers } from "../src/terrain/river-burn.ts";

/**
 * WI-0067 Optimierung P0.3: nach der ganzen Pipeline gelten die fachlichen Postconditions, und die finalen
 * Wasser-/Fluss-/Gipfelschritte sind die letzten Schreiboperationen.
 */

const SIZE = 512;

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon" as const,
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    };
}

/** V12-like seed: an east-west ridge, 0 outside its own extent. */
function ridgeSeed(): StoredRaster {
    const cell = 1,
        originX = 300,
        originY = 350,
        width = 401,
        height = 301;
    const samples = new Uint16Array(width * height);
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            const x = originX + i * cell,
                y = originY + j * cell;
            samples[j * width + i] = Math.round(2600 - 6 * Math.abs(y - 500) + 200 * Math.sin(x / 23));
        }
    return { cell, originX, originY, width, height, samples };
}

const lake = polygon(400, 560, 430, 590);
const peak = { id: "summit", name: "Summit", x: 620.3, y: 500.2, h: 2900 };
/** A known summit 12 E beside the deeply cut crossing river: the final valley profile reaches its flank. */
const besideRiver = { id: "beside", name: "Beside", x: 512.3, y: 520.2, h: 3200 };
const crossing: [number, number][] = [
    [500, 300],
    [500, 500],
    [500, 700],
];

function input(): DomainInputs {
    const continent = polygon(200, 0, 1024, 1024);
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [
            { kind: "meer", geometry: polygon(0, 0, 200, 1024) },
            { kind: "see", geometry: lake },
        ],
        seeds: [ridgeSeed()],
        peaks: [peak, besideRiver],
        landscapes: [
            { layer: "topographie", type: "gebirge", geometry: polygon(300, 350, 700, 650) },
            { layer: "topographie", type: "huegelland", geometry: polygon(300, 350, 360, 650) },
        ],
        rivers: {
            rivers: [
                { id: "cross", name: "Cross", bach: false, direction: "forward", coast: null, coordinates: crossing },
                {
                    id: "outflow",
                    name: "Outflow",
                    bach: false,
                    direction: "forward",
                    coast: null,
                    coordinates: [
                        [415, 590],
                        [415, 700],
                    ],
                },
            ],
            lakes: [{ id: "lake", name: "Lake", geometry: lake }],
            fingerprint: "rivers",
        },
        fingerprint: "fixture",
    };
}

function recipe(): TerrainRecipe {
    const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
    // Grade 0.05 = 300 Schritt per 2-E cell, so the support flank is resolvable on this coarse grid.
    Object.assign(value.mountainMorphology.interior, { iterations: 6, inward: 4, halo: 32, maximumGrade: 0.05 });
    Object.assign(value.mountainMorphology.interior.alpine, { maximumGrade: 0.05 });
    // A plain cone of the same grade: no outline, profile or relief noise on this coarse grid.
    Object.assign(value.mountainMorphology.interior.alpine.summit, {
        grade: { minimum: 0.05, maximum: 0.05 },
        profile: { minimum: 1, maximum: 1 },
        outline: { minimum: 0, maximum: 0 },
        relief: { minimum: 0, maximum: 0 },
    });
    Object.assign(value.mountainMorphology.interior.fragments, {
        spacing: 10,
        radiusMinimum: 4,
        radiusMaximum: 6,
        lengthMinimum: 4,
        lengthMaximum: 10,
        inward: 2,
    });
    return value;
}

/** Bilinear reader in the stored orientation, independent of the production readers. */
function heightAt(r: StoredRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell,
        fy = (y - r.originY) / r.cell;
    const i = Math.max(0, Math.min(Math.floor(fx), r.width - 2)),
        j = Math.max(0, Math.min(Math.floor(fy), r.height - 2));
    const tx = fx - i,
        ty = fy - j,
        s = r.samples;
    return (
        s[j * r.width + i]! * (1 - tx) * (1 - ty) +
        s[j * r.width + i + 1]! * tx * (1 - ty) +
        s[(j + 1) * r.width + i]! * (1 - tx) * ty +
        s[(j + 1) * r.width + i + 1]! * tx * ty
    );
}

describe("WI-0067 final constraint postconditions after the whole pipeline", () => {
    const phases: string[] = [];
    const result = generateDomainTerrain(input(), recipe(), SIZE, (name) => phases.push(name));
    const r = result.raster;

    it("refines mountain interiors before the final river, lake and peak constraints", () => {
        expect(result.report.mountainInterior?.changedCells ?? 0).toBeGreaterThan(0);
        const interior = phases.indexOf("mountain-interior");
        expect(interior).toBeGreaterThan(-1);
        expect(interior).toBeLessThan(phases.indexOf("constraints"));
        expect(phases.indexOf("constraints")).toBeLessThan(phases.indexOf("verify"));
    });

    it("keeps sea exactly zero, lakes exactly flat and known peaks exact", () => {
        for (let j = 0; j < SIZE; j++)
            for (let i = 0; i < SIZE; i++)
                if ((i + 0.5) * r.cell < 200) expect(r.samples[j * SIZE + i], `sea ${String(i)}`).toBe(0);
        const levels = new Set<number>();
        for (let j = 0; j < SIZE; j++)
            for (let i = 0; i < SIZE; i++) {
                const x = (i + 0.5) * r.cell,
                    y = (j + 0.5) * r.cell;
                if (x > 400 && x < 430 && y > 560 && y < 590) levels.add(r.samples[j * SIZE + i]!);
            }
        expect(levels.size).toBe(1);
        const pi = Math.floor((peak.x - r.originX) / r.cell),
            pj = Math.floor((peak.y - r.originY) / r.cell);
        for (const dy of [0, 1]) for (const dx of [0, 1]) expect(r.samples[(pj + dy) * SIZE + pi + dx]).toBe(peak.h);
        expect(verifyDomainRaster(r, input()).errors).toEqual([]);
    });

    it("keeps a talus flank around a summit whose surroundings the final river valley cut", () => {
        const pi = Math.floor((besideRiver.x - r.originX) / r.cell),
            pj = Math.floor((besideRiver.y - r.originY) / r.cell);
        for (const dy of [0, 1])
            for (const dx of [0, 1]) expect(r.samples[(pj + dy) * SIZE + pi + dx]).toBe(besideRiver.h);
        let ring = 0;
        for (let dj = -1; dj <= 2; dj++)
            for (let di = -1; di <= 2; di++)
                if (di < 0 || di > 1 || dj < 0 || dj > 1) ring = Math.max(ring, r.samples[(pj + dj) * SIZE + pi + di]!);
        // Not a 2×2 needle: the next ring stands on the 300-Schritt-per-cell support flank.
        expect(ring).toBeGreaterThanOrEqual(besideRiver.h - 300 * Math.SQRT2 - 1);
        expect(result.report.summits?.supportCells ?? 0).toBeGreaterThan(0);
    });

    it("cuts the crossing river through the refined ridge and never lets it rise in flow direction", () => {
        expect(risingRivers([r], input().rivers, { anchors: [peak, besideRiver], lakes: "fixed" }).rising).toEqual([]);
        let low = Infinity,
            worst = 0;
        for (let y = 300; y <= 700; y += 0.05) {
            const h = heightAt(r, 500, y);
            worst = Math.max(worst, h - low);
            low = Math.min(low, h);
        }
        expect(worst).toBeLessThanOrEqual(RISE_TOLERANCE + 1e-9);
        // The bed is the upstream minimum: the ridge (~2.600 Schritt) is cut down to the river's source level.
        expect(heightAt(r, 500, 500)).toBeLessThanOrEqual(heightAt(r, 500, 300) + RISE_TOLERANCE);
        expect(heightAt(r, 540, 500)).toBeGreaterThan(heightAt(r, 500, 500) + 500);
    });

    it("is already the fixpoint of the final river burn and lake levelling", () => {
        const copy = { ...r, samples: r.samples.slice() };
        const source = input();
        const { bodies, ...fixedLakes } = fixedLakeBurn(SIZE, source.water, [peak, besideRiver]);
        const burn = burnRivers([copy], source.rivers, {
            anchors: [peak, besideRiver],
            peaks: [],
            riverValley: recipe().riverValley,
            ...fixedLakes,
        });
        expect(burn.changedCells).toBe(0);
        expect(flattenDomainLakes(copy, source.water, [peak, besideRiver], [], bodies).changedCells).toBe(0);
        expect(copy.samples).toEqual(r.samples);
    });
});

describe("a summit at a lake shore (Stage 2026-10-03, lake:328)", () => {
    // Outside the lake polygon (x ≤ 430), but one column of its four sampling cells has its centre inside it.
    const shore = { id: "shore", name: "Shore", x: 430.5, y: 575, h: 2600 };
    const source = (): DomainInputs => ({ ...input(), peaks: [peak, besideRiver, shore] });

    it("keeps the summit exact and the lake level without its sampling cells", { timeout: 120_000 }, () => {
        const result = generateDomainTerrain(source(), recipe(), SIZE);
        const r = result.raster;
        const i = Math.floor((shore.x - r.originX) / r.cell),
            j = Math.floor((shore.y - r.originY) / r.cell);
        for (const dy of [0, 1]) for (const dx of [0, 1]) expect(r.samples[(j + dy) * SIZE + i + dx]).toBe(shore.h);
        expect(verifyDomainRaster(r, source()).errors).toEqual([]);
    });
});
