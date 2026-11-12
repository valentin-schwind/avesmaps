import stringify from "fast-json-stringify";
import { RouteSegment } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { compactProfile, pathElevationProfile, type ProfilePoint } from "../src/routing/elevation-profile.ts";
import { NO_SLOPE } from "../src/routing/slope.ts";

describe("route elevation measurements", () => {
    it("serializes both measured heights and gaps through the production response schema", () => {
        const serialize = stringify(RouteSegment.properties.elevation_profile);
        expect(
            JSON.parse(
                serialize([
                    [0, 100],
                    [1, null],
                ]),
            ),
        ).toEqual([
            [0, 100],
            [1, null],
        ]);
    });
    const slope = { ...NO_SLOPE, steps: new Float64Array([300, 3000, 1, 100, 0, -100, 3000, 1, 400, 3000]) };
    it("keeps actual distance, height and direction", () => {
        expect(pathElevationProfile(slope, true, 2)).toEqual([
            [0, 100],
            [1, 400],
            [2, 300],
        ]);
        expect(pathElevationProfile(slope, false, 2)).toEqual([
            [0, 300],
            [1, 400],
            [2, 100],
        ]);
    });
    it("clips and interpolates a partial path without including distant peaks", () => {
        expect(pathElevationProfile(slope, true, 0.5, { from: 0.25, to: 0.75 })).toEqual([
            [0, 175],
            [0.5, 325],
        ]);
        expect(pathElevationProfile(slope, false, 0.5, { from: 0.25, to: 0.75 })).toEqual([
            [0, 325],
            [0.5, 175],
        ]);
    });
    it("keeps unknown intervals as gaps, including when reversed", () => {
        const gapped = { ...NO_SLOPE, steps: new Float64Array([100, 1000, 1, 200, 1000]) };
        expect(pathElevationProfile(gapped, true, 1).filter((p) => p[1] === null)).toHaveLength(2);
        expect(pathElevationProfile(gapped, false, 1).filter((p) => p[1] === null)).toHaveLength(2);
        expect(pathElevationProfile(NO_SLOPE, true, 1)).toEqual([]);
    });
    it("bounds output while retaining narrow peaks and valleys", () => {
        const points: ProfilePoint[] = Array.from({ length: 10000 }, (_, i) => [
            i,
            i === 5321 ? 5000 : i === 5322 ? 0 : 100,
        ]);
        const result = compactProfile(points);
        expect(result.length).toBeLessThanOrEqual(256);
        expect(result).toContainEqual([5321, 5000]);
        expect(result).toContainEqual([5322, 0]);
        expect(result[0]).toEqual(points[0]);
        expect(result.at(-1)).toEqual(points.at(-1));
        points[5320] = [5320, null];
        const gapped = compactProfile(points);
        expect(gapped.length).toBeLessThanOrEqual(256);
        expect(gapped).toContainEqual([5321, 5000]);
        expect(gapped).toContainEqual([5322, 0]);
        const peak = gapped.findIndex((point) => point[0] === 5321 && point[1] === 5000);
        expect(gapped[peak - 1]![1]).toBeNull();
        expect(gapped[peak + 1]![1]).toBeNull();
    });

    it("keeps separated gaps under strong compression in both travel directions", () => {
        const gaps = [
            [2070, 2090],
            [2120, 2140],
            [4700, 4850],
            [7800, 7950],
        ];
        const points: ProfilePoint[] = Array.from({ length: 10001 }, (_, distance) => [
            distance,
            gaps.some(([from, to]) => distance >= from! && distance <= to!) ? null : distance % 701,
        ]);
        for (const forward of [true, false]) {
            const directed: ProfilePoint[] = forward
                ? points
                : [...points].reverse().map(([distance, height]) => [10000 - distance, height]);
            const result = compactProfile(directed, 60);
            expect(result.length).toBeLessThanOrEqual(60);
            expect(result[0]![0]).toBe(0);
            expect(result.at(-1)![0]).toBe(10000);
            for (const [index, [distance, height]] of result.entries()) {
                expect(distance).toBeGreaterThanOrEqual(result[index - 1]?.[0] ?? 0);
                if (height !== null) expect(height).toBe(points[forward ? distance : 10000 - distance]![1]);
                const previous = result[index - 1];
                if (height !== null && previous && previous[1] !== null) {
                    // Every drawn interval must be completely covered by measured input, not just its ends.
                    expect(directed.slice(previous[0], distance + 1).every((point) => point[1] !== null)).toBe(true);
                }
            }
            for (const [from, to] of gaps) {
                const left = forward ? from! : 10000 - to!;
                const right = forward ? to! : 10000 - from!;
                const before = result.findLastIndex(([distance, height]) => distance < left && height !== null);
                const after = result.findIndex(([distance, height]) => distance > right && height !== null);
                expect(before).toBeGreaterThanOrEqual(0);
                expect(after).toBeGreaterThan(before);
                expect(result.slice(before + 1, after).some((point) => point[1] === null)).toBe(true);
            }
        }
    });
});
