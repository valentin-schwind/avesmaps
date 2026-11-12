import { describe, expect, it } from "vitest";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { distanceInfluence } from "../src/terrain/domain/influence.ts";

describe("morphological distance influence", () => {
    const g = grid(128);
    const mask = Uint8Array.from({ length: g.n * g.n }, (_, k) => (k % g.n >= 64 ? 1 : 0));
    it("extends a smooth monotone foothill beyond the semantic boundary", () => {
        const field = distanceInfluence(g, mask, { inward: 32, outward: 64 });
        const row = 64 * g.n;
        expect(field[row + 54]).toBe(0);
        expect(field[row + 60]).toBeGreaterThan(0);
        expect(field[row + 60]).toBeLessThan(field[row + 64]!);
        expect(field[row + 70]).toBe(1);
        for (let x = 55; x < 70; x += 1) {
            expect(field[row + x + 1]).toBeGreaterThanOrEqual(field[row + x]!);
            expect(field[row + x + 1]! - field[row + x]!).toBeLessThan(0.13);
        }
        expect(mask[row + 60]).toBe(0);
    });
    it("keeps inward valley influence strictly inside its polygon", () => {
        const field = distanceInfluence(g, mask, { inward: 32, outward: 0 });
        expect(field[63]).toBe(0);
        expect(field[64]).toBeGreaterThan(0);
        expect(field[64]).toBeLessThan(field[65]!);
        expect(field[69]).toBe(1);
    });
    it("does not invent influence when a union is empty", () => {
        expect(
            distanceInfluence(g, new Uint8Array(mask.length), { inward: 16, outward: 64 }).every((v) => v === 0),
        ).toBe(true);
    });
    it("treats a hole as an inner boundary instead of filling its entire interior", () => {
        const ring = new Uint8Array(mask.length).fill(1);
        for (let y = 40; y < 88; y += 1) {
            for (let x = 40; x < 88; x += 1) ring[y * g.n + x] = 0;
        }
        const field = distanceInfluence(g, ring, { inward: 16, outward: 32 });
        expect(field[64 * g.n + 39]).toBeGreaterThan(field[64 * g.n + 40]!);
        expect(field[64 * g.n + 40]).toBeGreaterThan(0);
        expect(field[64 * g.n + 44]).toBe(0);
        expect(field[64 * g.n + 64]).toBe(0);
    });
});
