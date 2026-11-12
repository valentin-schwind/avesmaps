import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import {
    calibrate,
    familyFactor,
    pairSteps,
    sampleOffsets,
    SLOPE_FAMILIES,
    slopeTimeFactor,
    sumPairs,
    type SlopeSums,
} from "../src/routing/slope.ts";
import { chordAbove, KIND_NONE, reliefAt } from "../src/routing/relief.ts";
import { profileLine, sampleAt, type HeightSample, type HeightSource } from "../src/terrain/path-profiles.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import { domainMountainMask } from "../src/terrain/domain/read.ts";
import { airTerrain, blockedCells, boundsAbove } from "../src/routing/air-obstacles.ts";

const model = AVENTURIA_TRAVEL_MODEL;
const distance = 2;

function profile(sample: (x: number, y: number) => HeightSample | null): SlopeSums {
    const { pairs, samples } = profileLine(
        [
            [0, 0],
            [distance, 0],
        ],
        sample,
        model.steigung.wert.steilAb,
    );
    const offsets = sampleOffsets(samples, 1);
    if (!offsets) throw new Error("Expected a complete height profile");
    return { ...sumPairs(pairs, 0, 1), steps: pairSteps(samples, offsets, 0, 1, [distance * 3000]) };
}

function wave(x: number): number {
    return 1000 + 800 * Math.sin(Math.PI * x);
}

describe("WI-0067: absolute height and mountain travel cost", () => {
    it("detects a narrow bilinear summit between the flight chord probes", () => {
        const domain: DomainHeightSource = {
            fingerprint: "narrow-summit",
            revision: "narrow-summit",
            membershipFingerprint: "empty",
            mountains: [],
            raster: {
                cell: 0.25,
                originX: 0,
                originY: 0,
                width: 2,
                height: 2,
                samples: Uint16Array.from([0, 10000, 10000, 0]),
            },
        };
        const heights = {
            domain,
            rasters: [],
            cones: [],
            rule: DEFAULT_CONE,
            mu: { FOOT: { mountain: 1, peak: 1 }, EQUID: { mountain: 1, peak: 1 }, WHEEL: { mountain: 1, peak: 1 } },
        };
        const from = { x: 0, y: 0 },
            to = { x: 0.24, y: 0.24 };
        expect(chordAbove(heights, from, to, 4999)).toBe(true);
        expect(chordAbove(heights, to, from, 4999)).toBe(true);
        expect(chordAbove(heights, from, to, 5000)).toBe(false);
    });
    const flat = profile(() => ({ height: 1000, mountain: false }));
    const calibration = calibrate([{ subtype: "Strasse", distance, sums: flat }], model);

    it("a domain peak outside mountains remains a flight obstacle", () => {
        const domain: DomainHeightSource = {
            fingerprint: "peak",
            revision: "peak",
            membershipFingerprint: "empty",
            mountains: [],
            raster: {
                cell: 0.25,
                originX: 0.125,
                originY: 0.125,
                width: 3,
                height: 3,
                samples: Uint16Array.from([0, 0, 0, 0, 1200, 0, 0, 0, 0]),
            },
        };
        const terrain = airTerrain({
            domain,
            rasters: [],
            cones: [],
            rule: DEFAULT_CONE,
            mu: { FOOT: { mountain: 1, peak: 1 }, EQUID: { mountain: 1, peak: 1 }, WHEEL: { mountain: 1, peak: 1 } },
        });
        expect(boundsAbove(terrain, 1000)).not.toBeNull();
        expect([...blockedCells(terrain, { minX: 0, minY: 0, cell: 0.25, cols: 3, rows: 3 }, 1000)]).toContain(1);
        expect(boundsAbove(terrain, 1200)).toBeNull();
    });

    it("reads absolute domain heights and mountain membership independently, including zero height", () => {
        const domain: DomainHeightSource = {
            fingerprint: "domain",
            revision: "revision",
            membershipFingerprint: "membership",
            raster: {
                cell: 1,
                originX: 0,
                originY: 0,
                width: 3,
                height: 2,
                samples: Uint16Array.from([1200, 0, 0, 1200, 0, 0]),
            },
            mountains: [
                {
                    minX: 1,
                    minY: 0,
                    maxX: 2,
                    maxY: 1,
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [1, 0],
                                [2, 0],
                                [2, 1],
                                [1, 1],
                                [1, 0],
                            ],
                        ],
                    },
                },
            ],
        };
        const source: HeightSource = { domain, rasters: [], peaks: [], rule: DEFAULT_CONE };
        expect(sampleAt(source, 0, 0.5)).toEqual({ height: 1200, mountain: false });
        expect(sampleAt(source, 1.5, 0.5)).toEqual({ height: 0, mountain: true });
        expect(reliefAt({ domain, rasters: [], cones: [], rule: DEFAULT_CONE }, 1.5, 0.5)).toEqual({
            height: 0,
            kind: 1,
        });
        expect([...domainMountainMask(domain)]).toEqual([0, 1, 0, 0, 0, 0]);
        expect(domainMountainMask({ ...domain, mountains: [...domain.mountains, ...domain.mountains] })).toEqual(
            domainMountainMask(domain),
        );
    });

    it("normalizes only the mountain part of a mixed pass, independently of outside terrain", () => {
        const mixed = profile((x) => ({ height: wave(x), mountain: x >= 1 }));
        const passCalibration = calibrate([{ subtype: "Gebirgspass", distance, sums: mixed }], model);
        for (const family of SLOPE_FAMILIES) {
            const mean =
                (slopeTimeFactor("Gebirgspass", distance, mixed, true, model, passCalibration, family) +
                    slopeTimeFactor("Gebirgspass", distance, mixed, false, model, passCalibration, family)) /
                2;
            expect(mean).toBeCloseTo(1, 12);
        }
    });

    for (const family of SLOPE_FAMILIES) {
        it(`${family}: 🔴 outside mountains the mountain calibration (street, pass) does not leak in; the Wegart's own outside calibration holds its mean`, () => {
            // F5c (Betreiber 2026-10-04 „F5: C“, revidiert ADR-0016): Außerhalb der Gebirge kostet jeder Schritt P / μ_aussen der
            // Wegart. μ_aussen kommt aus den Schritten außerhalb, nie aus Straße oder Pass im Gebirge.
            const rolling = profile((x) => ({ height: wave(x), mountain: false }));
            const own = calibrate(
                [
                    { subtype: "Strasse", distance, sums: rolling },
                    { subtype: "Gebirgspass", distance, sums: rolling },
                ],
                model,
            );
            const biased = structuredClone(own);
            biased[family].street = 7;
            biased[family].gaSlope["Gebirgspass"] = 3;
            for (const subtype of ["Strasse", "Gebirgspass"]) {
                for (const forward of [true, false]) {
                    expect(slopeTimeFactor(subtype, distance, rolling, forward, model, biased, family)).toBe(
                        slopeTimeFactor(subtype, distance, rolling, forward, model, own, family),
                    );
                }
                const mean =
                    (slopeTimeFactor(subtype, distance, rolling, true, model, own, family) +
                        slopeTimeFactor(subtype, distance, rolling, false, model, own, family)) /
                    2;
                expect(mean).toBeCloseTo(1, 12);
            }
        });
        it(`${family}: 🔴 a rolling road outside mountains costs on the slope and saves on the plain, the mean of the Wegart stays`, () => {
            const rolling = profile((x) => ({ height: wave(x), mountain: false }));
            const own = calibrate([{ subtype: "Strasse", distance, sums: rolling }], model);
            const factors = [true, false].map((forward) =>
                slopeTimeFactor("Strasse", distance, rolling, forward, model, own, family),
            );
            // Die Bezugszeit (jeder Schritt eben) ist unter dem Mittel: μ_aussen > 1.
            const level = slopeTimeFactor("Strasse", distance, rolling, true, model, own, family, null, true);
            expect(level).toBeLessThan(1);
            expect(Math.max(...factors)).toBeGreaterThan(level);
            expect((factors[0] as number) + (factors[1] as number)).toBeCloseTo(2, 12);
            // Ein ebenes Stück derselben Wegart unter derselben Eichung geht schneller als das Mittel.
            expect(slopeTimeFactor("Strasse", distance, flat, true, model, own, family)).toBeCloseTo(level, 12);
            expect(rolling.highest).toBeGreaterThan(flat.highest);
        });

        it(`${family}: the same waves inside mountains increase travel time`, () => {
            const rolling = profile((x) => ({ height: wave(x), mountain: true }));
            expect(slopeTimeFactor("Strasse", distance, rolling, true, model, calibration, family)).toBeGreaterThan(
                slopeTimeFactor("Strasse", distance, flat, true, model, calibration, family),
            );
        });

        it(`${family}: only mountain steps contribute on a mixed path`, () => {
            const mixed = profile((x) => ({ height: wave(x), mountain: x >= 1 }));
            const neutralOutside = profile((x) => ({ height: x < 1 ? 1000 : wave(x), mountain: x >= 1 }));
            for (const forward of [true, false]) {
                expect(familyFactor(family, mixed, distance * 3, forward, model)).toBeCloseTo(
                    familyFactor(family, neutralOutside, distance * 3, forward, model),
                    12,
                );
            }
        });
    }

    it("a free peak changes absolute height and, since F5c, land travel time like any other slope outside mountains", () => {
        const source: HeightSource = {
            rasters: [],
            peaks: [{ x: 1, y: 0, h: 1200 }],
            rule: DEFAULT_CONE,
        };
        expect(sampleAt(source, 1, 0)).toEqual({ height: 1200, mountain: false });
        expect(
            reliefAt({ rasters: [], cones: [{ x: 1, y: 0, h: 1200, radius: 2 }], rule: DEFAULT_CONE }, 1, 0),
        ).toEqual({
            height: 1200,
            kind: KIND_NONE,
        });
        const peakProfile = profile((x, y) => sampleAt(source, x, y) ?? { height: 0, mountain: false });
        // Die Straße über dem Kegel kostet bergauf mehr als die ebene, und die Eichung hält das Mittel (hin und zurück).
        const own = calibrate([{ subtype: "Strasse", distance, sums: peakProfile }], model);
        const up = slopeTimeFactor("Strasse", distance, peakProfile, true, model, own);
        const down = slopeTimeFactor("Strasse", distance, peakProfile, false, model, own);
        expect(Math.max(up, down)).toBeGreaterThan(slopeTimeFactor("Strasse", distance, flat, true, model, own));
        expect(up + down).toBeCloseTo(2, 12);
    });
});
