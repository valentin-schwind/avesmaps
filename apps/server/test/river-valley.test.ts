import { describe, expect, it } from "vitest";
import { valleyGrade, valleyReach, valleyHeight } from "../src/terrain/river-valley.ts";

describe("Flusstäler im Gebirge (WI-0249, nur Fassung 19)", () => {
    const gebirge = { grade: 0.7, from: 1500, to: 3000 };

    it("ohne Angabe überall die Talflanke, mit ihr im Hochgebirge die Steilheit des Gebirges, weich dazwischen", () => {
        for (const h of [0, 1500, 2250, 9000]) expect(valleyGrade({ flankGrade: 0.1 }, h)).toBe(0.1);
        const tal = { flankGrade: 0.1, gebirge };
        expect(valleyGrade(tal, 300)).toBe(0.1);
        expect(valleyGrade(tal, 1500)).toBe(0.1);
        expect(valleyGrade(tal, 2250)).toBeCloseTo(0.4, 12);
        expect(valleyGrade(tal, 3000)).toBeCloseTo(0.7, 12);
        expect(valleyGrade(tal, 9000)).toBeCloseTo(0.7, 12);
        let vorher = 0;
        for (let h = 0; h <= 4000; h += 10) {
            const g = valleyGrade(tal, h);
            expect(g).toBeGreaterThanOrEqual(vorher);
            vorher = g;
        }
    });

    it("wird nie sanfter als die Talflanke", () => {
        expect(valleyGrade({ flankGrade: 0.1, gebirge: { ...gebirge, grade: 0.05 } }, 5000)).toBe(0.1);
        expect(valleyGrade({ flankGrade: 0.1, gebirge: { ...gebirge, grade: 0.1 } }, 5000)).toBe(0.1);
    });

    it("ein Einschnitt von 2.500 unter einem Massiv reicht 2 E statt 12,75 E weit", () => {
        const tal = { flankGrade: 0.1, gebirge };
        expect(valleyReach(0.25, 2500, valleyGrade({ flankGrade: 0.1 }, 3000))).toBeCloseTo(12.75, 12);
        expect(valleyReach(0.25, 2500, valleyGrade(tal, 3000))).toBeCloseTo(0.25 + 3750 / 2100, 12);
    });
});

describe("domain river valley profile", () => {
    it("keeps the floor exact and joins the uncut surface with a horizontal tangent", () => {
        const depth = 1500;
        const floor = 0.25;
        const reach = valleyReach(floor, depth, 0.1);
        expect(reach).toBe(7.75);
        expect(valleyHeight(2000, 2000, 500, floor, floor, 0.1)).toBe(500);
        expect(valleyHeight(2000, 2000, 500, reach, floor, 0.1)).toBe(2000);
        const eps = 0.00001;
        expect((valleyHeight(2000, 2000, 500, floor + eps, floor, 0.1) - 500) / eps).toBeLessThan(0.01);
        expect((2000 - valleyHeight(2000, 2000, 500, reach - eps, floor, 0.1)) / eps).toBeLessThan(0.01);
    });

    it("never raises ground, never cuts below the bed, and bounds the flat-ground flank grade", () => {
        let previous = 500;
        for (let d = 0; d <= 10; d += 0.01) {
            const h = valleyHeight(2000, 2000, 500, d, 0.25, 0.1);
            expect(h).toBeGreaterThanOrEqual(previous - 1e-8);
            expect((h - previous) / 30).toBeLessThanOrEqual(0.1 + 1e-8);
            previous = h;
            for (const old of [0, 300, 800, 2500]) {
                const value = valleyHeight(old, 2000, 500, d, 0.25, 0.1);
                expect(value).toBeLessThanOrEqual(old);
                expect(value).toBeGreaterThanOrEqual(Math.min(old, 500));
            }
        }
    });
});
