import { describe, expect, it } from "vitest";
import type { RouteResponse } from "@avesmaps3d/shared";
import {
    snowHeight,
    profileLines,
    elevationChartData,
    hasElevationProfile,
} from "../src/route-planner/elevation-profile-model";

describe("has an elevation profile", () => {
    const route = (...profiles: ([number, number | null][] | undefined)[]): RouteResponse =>
        ({
            miles_per_unit: 3,
            stages: [],
            segments: profiles.map((elevation_profile) => ({
                distance_units: 1,
                travel_hours: 1,
                elevation_profile,
            })),
        }) as unknown as RouteResponse;
    it("is false without profile points, so no profile box is offered", () => {
        expect(hasElevationProfile(route())).toBe(false);
        expect(hasElevationProfile(route(undefined, undefined))).toBe(false);
        expect(hasElevationProfile(route([], undefined))).toBe(false);
    });
    it("is false when every measurement is a gap, because the chart would have nothing to draw", () => {
        expect(
            hasElevationProfile(
                route([
                    [0, null],
                    [1, null],
                ]),
            ),
        ).toBe(false);
    });
    it("is true as soon as one segment carries a measured height, and agrees with the chart", () => {
        const measured = route(undefined, [
            [0, null],
            [0.5, 120],
            [1, 80],
        ]);
        expect(hasElevationProfile(measured)).toBe(true);
        expect(profileLines(elevationChartData(measured).terrain).length > 0).toBe(true);
        const gaps = route([[0, null]]);
        expect(profileLines(elevationChartData(gaps).terrain).length > 0).toBe(hasElevationProfile(gaps));
    });
});

describe("the line is continuous from the first to the last mile", () => {
    // Zieht der Router an einer Naht eine Lücke zu, geht die Strecke auf `distance_units`, das Profil endet früher
    // (`route-result.ts`: `segmentUnits = link.distance + lueckeUnits`). Das Diagramm schließt dort an.
    const route = (...segments: { distance: number; surface?: string; profile?: [number, number | null][] }[]) =>
        ({
            miles_per_unit: 3,
            stages: [],
            segments: segments.map((segment) => ({
                distance_units: segment.distance,
                travel_hours: 1,
                elevation_surface: segment.surface ?? "land",
                elevation_profile: segment.profile,
            })),
        }) as unknown as RouteResponse;

    it("starts the next run where the previous one ends when the profile stops short of the segment", () => {
        const { runs } = elevationChartData(
            route(
                {
                    distance: 1,
                    surface: "river",
                    profile: [
                        [0, 100],
                        [0.8, 90],
                    ],
                },
                {
                    distance: 1,
                    surface: "land",
                    profile: [
                        [0, 70],
                        [1, 60],
                    ],
                },
            ),
        );
        expect(runs.map((run) => run.kind)).toEqual(["river", "land"]);
        expect(runs[0]!.points.at(-1)![0]).toBeCloseTo(2.4, 9);
        // Der zweite Lauf beginnt auf der Meile, an der der erste endet, in seiner eigenen Höhe; danach seine Messwerte ab der Naht (Meile 3).
        expect(runs[1]!.points[0]![0]).toBeCloseTo(runs[0]!.points.at(-1)![0], 9);
        expect(runs[1]!.points.map(([, height]) => height)).toEqual([70, 70, 60]);
        expect(runs[1]!.points.slice(1)).toEqual([
            [3, 70],
            [6, 60],
        ]);
    });

    it("adds no point where nothing gaps: the shore step stays a step", () => {
        const { runs } = elevationChartData(
            route(
                {
                    distance: 1,
                    surface: "river",
                    profile: [
                        [0, 100],
                        [1, 4],
                    ],
                },
                {
                    distance: 1,
                    surface: "sea",
                    profile: [
                        [0, 0],
                        [1, 0],
                    ],
                },
            ),
        );
        expect(runs[1]!.points).toEqual([
            [3, 0],
            [6, 0],
        ]);
    });

    it("leaves a run alone when the profile of the previous segment ends in a gap", () => {
        const { runs } = elevationChartData(
            route(
                {
                    distance: 1,
                    profile: [
                        [0, 100],
                        [0.5, 90],
                        [0.8, null],
                    ],
                },
                {
                    distance: 1,
                    profile: [
                        [0, 90],
                        [1, 80],
                    ],
                },
            ),
        );
        expect(runs[1]!.points).toEqual([
            [3, 90],
            [6, 80],
        ]);
    });

    it("does not bridge a segment that starts with unknown height, nor one after a segment without profile", () => {
        const { runs } = elevationChartData(
            route(
                {
                    distance: 1,
                    profile: [
                        [0, 100],
                        [0.8, 90],
                    ],
                },
                {
                    distance: 1,
                    profile: [
                        [0, null],
                        [0.5, 70],
                        [1, 60],
                    ],
                },
                { distance: 1 },
                {
                    distance: 1,
                    profile: [
                        [0, 50],
                        [1, 40],
                    ],
                },
            ),
        );
        expect(runs[1]!.points[0]).toEqual([4.5, 70]);
        expect(runs[2]!.points).toEqual([
            [9, 50],
            [12, 40],
        ]);
    });
});

describe("seasonal snow-line approximation", () => {
    it("uses the encountered climate and season, including a zero-height polar limit", () => {
        expect(snowHeight("gemaessigt", 45)).toBe(3100);
        expect(snowHeight("gemaessigt", 225)).toBe(500);
        expect(snowHeight("boreal", 225)).toBe(0);
        expect(snowHeight("tropisch", 225)).toBe(4500);
        expect(snowHeight("polar", 45)).toBe(0);
        expect(snowHeight("missing", 45)).toBeNull();
    });
    it("interpolates between seasonal midpoints and wraps through nameless days and new year", () => {
        expect(snowHeight("gemaessigt", 90)).toBe(2600);
        expect(snowHeight("gemaessigt", 370)).toBe(snowHeight("gemaessigt", 5));
        expect(Math.abs(snowHeight("gemaessigt", 365)! - snowHeight("gemaessigt", 1)!)).toBeLessThanOrEqual(100);
    });
    it("does not join known heights over missing measurements", () => {
        expect(
            profileLines([
                [0, 200],
                [1, 300],
                [2, null],
                [3, 100],
                [4, 0],
            ]),
        ).toEqual([
            [
                [0, 200],
                [1, 300],
            ],
            [
                [3, 100],
                [4, 0],
            ],
        ]);
    });
});

it("advances the snow-line date through a long journey and changes zones between segments", () => {
    const route = {
        miles_per_unit: 3,
        segments: [
            {
                distance_units: 1,
                travel_hours: 100,
                climate_zone: "gemaessigt",
                elevation_profile: [
                    [0, 100],
                    [1, 200],
                ],
            },
            {
                distance_units: 1,
                travel_hours: 100,
                climate_zone: "polar",
                elevation_profile: [
                    [0, 200],
                    [1, 0],
                ],
            },
        ],
        stages: [
            {
                segment_start: 0,
                segment_count: 2,
                start_date: { month: "rondra", day: 15, nameless: false, years_passed: 0, season: "sommer" },
                end_date: { month: "tsa", day: 15, nameless: false, years_passed: 0, season: "winter" },
            },
        ],
    } as unknown as RouteResponse;
    const data = elevationChartData(route);
    const lines = profileLines(data.snow);
    expect(lines[0]![0]![1]).toBe(3100);
    expect(lines[0]!.at(-1)![1]).toBe(2100);
    expect(lines[1]!.every((point) => point[1] === 0)).toBe(true);
    expect(data.distance).toBe(6);
    expect(data.partial).toBe(false);
});

it("advances a journey through nameless days into the next year without reversing the season", () => {
    const route = {
        miles_per_unit: 3,
        segments: Array.from({ length: 2 }, () => ({
            distance_units: 8,
            travel_hours: 96,
            climate_zone: "gemaessigt",
            elevation_profile: [
                [0, 100],
                [4, null],
                [8, 200],
            ],
        })),
        stages: [
            {
                segment_start: 0,
                segment_count: 1,
                start_date: { month: "rahja", day: 29, nameless: false, years_passed: 0, season: "fruehling" },
                end_date: { month: "", day: 3, nameless: true, years_passed: 0, season: "fruehling" },
            },
            {
                segment_start: 1,
                segment_count: 1,
                start_date: { month: "", day: 3, nameless: true, years_passed: 0, season: "fruehling" },
                end_date: { month: "praios", day: 2, nameless: false, years_passed: 1, season: "sommer" },
            },
        ],
    } as unknown as RouteResponse;
    const data = elevationChartData(route);
    const snow = profileLines(data.snow);
    expect(snow).toHaveLength(2);
    for (let segment = 0; segment < 2; segment++) {
        expect(snow[segment]).toEqual(
            Array.from({ length: 9 }, (_, step) => [
                segment * 24 + step * 3,
                snowHeight("gemaessigt", 359 + segment * 4 + step / 2),
            ]),
        );
    }
    expect(data.distance).toBe(48);
    expect(data.partial).toBe(true);
    expect(profileLines(data.terrain)).toEqual([[[0, 100]], [[24, 200]], [[24, 100]], [[48, 200]]]);
});
