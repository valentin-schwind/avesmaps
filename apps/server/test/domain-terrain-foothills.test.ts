import { describe, expect, it } from "vitest";
import { mountainSeedField } from "../src/terrain/domain/mountain-seed.ts";
import { extendMountainFoothills } from "../src/terrain/domain/mountain-seed.ts";
import { grid } from "../src/terrain/hydrology/grid.ts";

describe("mountain seed foothills", () => {
    it("extends mountain macroheight only into nearby hills, without a hill-height cap", () => {
        const g = grid(128);
        const mountains = Uint8Array.from({ length: g.n * g.n }, (_, k) => (k % g.n >= 64 ? 1 : 0));
        const hills = Uint8Array.from(mountains, (_, k) => (k % g.n < 70 ? 1 : 0));
        const seed = Float32Array.from(mountains, (v) => v * 4000);
        const baseline = mountainSeedField(g, seed, mountains, { inward: 16, outward: 24 });
        const result = extendMountainFoothills(g, baseline, seed, mountains, hills, {
            reach: 64,
            smoothing: 32,
            hillTransition: 16,
        });
        expect(result[63]).toBeGreaterThan(2000);
        expect(result[57]).toBeGreaterThan(0);
        expect(result[50]).toBe(0);
        expect(Math.abs(result[63]! - result[64]!)).toBeLessThan(500);
        expect(
            extendMountainFoothills(g, baseline, seed, mountains, new Uint8Array(hills.length), {
                reach: 64,
                smoothing: 32,
                hillTransition: 16,
            }),
        ).toEqual(baseline);
        expect(mountains[63]).toBe(0);
    });
    it("continues a steep seed across the polygon boundary without moving semantic membership", () => {
        const g = grid(128);
        const mask = Uint8Array.from({ length: g.n * g.n }, (_, k) => (k % g.n >= 64 ? 1 : 0));
        const seed = Float32Array.from(mask, (value) => value * 4000);
        const result = mountainSeedField(g, seed, mask, { inward: 32, outward: 64 });
        expect(result[63]).toBeGreaterThan(500);
        expect(result[50]).toBe(0);
        expect(result[74]).toBe(4000);
        expect(Math.abs(result[64]! - result[63]!)).toBeLessThan(800);
        expect(mask[63]).toBe(0);
        expect(seed[63]).toBe(0);
    });
});

it("continues the boundary macroheight downhill instead of re-averaging a separate outer crest", () => {
    const g = grid(128);
    const mountains = Uint8Array.from({ length: g.n * g.n }, (_, k) => (k % g.n >= 64 ? 1 : 0));
    const seed = Float32Array.from(mountains, (v, k) => v * Math.max(600, 5000 - 600 * ((k % g.n) - 64)));
    const result = extendMountainFoothills(
        g,
        new Float32Array(seed.length),
        seed,
        mountains,
        new Uint8Array(seed.length).fill(1),
        { reach: 64, smoothing: 32, hillTransition: 16 },
    );
    for (let x = 57; x < 64; x++) {
        expect(result[64 * g.n + x]!).toBeLessThanOrEqual(result[64 * g.n + x + 1]! + 0.01);
    }
});

it("does not erode existing terrain when no hill extension is requested", () => {
    const g = grid(128);
    const mountains = Uint8Array.from({ length: g.n * g.n }, (_, k) => (k % g.n >= 64 ? 1 : 0));
    const seed = Float32Array.from(mountains, (v) => v * 4000);
    const baseline = Float32Array.from(seed, (v, k) => v + ((k % g.n) % 3) * 200);
    expect(
        extendMountainFoothills(g, baseline, seed, mountains, new Uint8Array(seed.length), {
            reach: 64,
            smoothing: 32,
            hillTransition: 16,
        }),
    ).toEqual(baseline);
});

it("relaxes inherited narrow parallel seed grooves while preserving a broad planar slope", async () => {
    const { relaxMountainSeed } = await import("../src/terrain/domain/mountain-seed.ts");
    const g = grid(128);
    const plane = Float32Array.from({ length: g.n * g.n }, (_, k) => 2000 + 10 * Math.floor(k / g.n));
    const grooves = Float32Array.from(plane, (h, k) => h + ((k % g.n) % 2 ? 200 : -200));
    const before = grooves.slice();
    const relaxed = relaxMountainSeed(g, grooves, 16);
    expect(grooves).toEqual(before);
    for (let y = 16; y < 112; y++)
        for (let x = 16; x < 112; x++) {
            expect(Math.abs(relaxed[y * g.n + x]! - plane[y * g.n + x]!)).toBeLessThan(3);
        }
    expect(relaxMountainSeed(g, plane, 0)).toEqual(plane);
});
