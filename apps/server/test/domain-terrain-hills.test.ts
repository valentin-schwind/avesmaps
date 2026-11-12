import { describe, expect, it } from "vitest";
import { createHillField, hillCap } from "../src/terrain/domain/hills.ts";
import { sampleSmoothField } from "../src/terrain/domain/field.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
// Fixed morphology fixture; product amplitudes can be tuned independently.
const recipe = { ...AVENTURIA_TERRAIN_RECIPE.topographie.huegelland!.landform!, minimum: 200, maximum: 900 };
describe("hill macroforms without lattice structure", () => {
    it("has deterministic separated round caps, mostly low, with height-scaled radii", () => {
        const a = createHillField(recipe, 67001, 64);
        const b = createHillField(recipe, 67001, 64);
        expect(a.centres).toEqual(b.centres);
        expect(a.centres.length).toBeGreaterThan(80);
        expect(new Set(a.centres.map((p) => p.radius)).size).toBeGreaterThan(30);
        expect(a.centres.filter((p) => p.height <= 450).length / a.centres.length).toBeGreaterThan(0.75);
        expect(a.centres.some((p) => p.height > 850)).toBe(true);
        for (let i = 0; i < a.centres.length; i += 1) {
            const p = a.centres[i]!;
            expect(p.height).toBeGreaterThanOrEqual(200);
            expect(p.height).toBeLessThanOrEqual(900);
            expect(p.radius / p.height).toBeCloseTo(1.5 / 200, 12);
            for (const q of a.centres.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(2);
        }
    });
    it("is radial and compact with the specified bell and horizontal centre and rim", () => {
        for (const height of [200, 450, 900]) {
            const radius = (height * 1.5) / 200;
            const cap = { x: 0, y: 0, radius, height };
            expect(hillCap(cap, 0, 0)).toBe(height);
            expect(hillCap(cap, radius, 0)).toBe(0);
            expect(hillCap(cap, 2 * radius, 0)).toBe(0);
            for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
                expect(hillCap(cap, radius * 0.5 * Math.cos(angle), radius * 0.5 * Math.sin(angle))).toBeCloseTo(
                    height * 0.5625,
                    9,
                );
            }
            const eps = 0.00001;
            expect(Math.abs((hillCap(cap, eps, 0) - height) / eps)).toBeLessThan(0.01);
            expect(hillCap(cap, radius - eps, 0) / eps).toBeLessThan(0.01);
            const r = radius / Math.sqrt(3);
            const slope = (hillCap(cap, r - eps, 0) - hillCap(cap, r + eps, 0)) / (2 * eps);
            expect(slope).toBeCloseTo((8 * 200) / (3 * Math.sqrt(3) * 1.5), 5);
        }
    });
    it("forms rounded elevated hills and saddles before any erosion, without grid-locked stationary slopes", () => {
        const field = createHillField(recipe, 67001, 64);
        const values: number[] = [];
        let aligned = 0,
            other = 0;
        for (let y = 12; y < 52; y += 1)
            for (let x = 12; x < 52; x += 0.25) {
                const h = field.sample(x, y);
                values.push(h);
                const d = Math.abs(field.sample(x + 0.01, y) - field.sample(x - 0.01, y));
                if (x % 4 === 0) aligned += d;
                else other += d / 15;
            }
        expect(aligned / other).toBeGreaterThan(0.65);
        expect(aligned / other).toBeLessThan(1.5);
        expect(Math.max(...values)).toBeGreaterThan(700);
        expect(values.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
        expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(400);
    });
    it("samples auxiliary membership smoothly across cell borders without overshoot", () => {
        const values = Float32Array.from({ length: 64 }, (_, k) => (k % 8 >= 4 ? 1 : 0));
        const sample = (x: number) => sampleSmoothField({ m: 8, values }, 32, x, 16);
        const eps = 0.001;
        for (let x = 5.5; x < 26; x += 4) {
            const left = (sample(x) - sample(x - eps)) / eps,
                right = (sample(x + eps) - sample(x)) / eps;
            expect(Math.abs(left - right)).toBeLessThan(0.0001);
        }
        for (let x = 0; x < 32; x += 0.1) {
            expect(sample(x)).toBeGreaterThanOrEqual(0);
            expect(sample(x)).toBeLessThanOrEqual(1);
        }
    });
});
