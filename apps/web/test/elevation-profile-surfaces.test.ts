import { describe, expect, it } from "vitest";
import type { RouteResponse } from "@avesmaps3d/shared";
import { elevationChartData, hasElevationProfile, profileLines } from "../src/route-planner/elevation-profile-model";
import {
    airHeightAt,
    nearestRunPoint,
    segmentRuns,
    surfaceTone,
    SURFACE_TONES,
} from "../src/route-planner/elevation-profile-surfaces";

/**
 * Die Höhenlinie nach Art (WI-0065 Nachtrag 2026-10-03, Betreiber: „A. Durchgehend zeichnen … hellbraun bei land, blau
 * bei fluss, dunkelblau bei meer, rot bei luft (eine zweite linie über dem profil)“).
 */

type Profile = [number, number | null][];
const segment = (
    subtype: string,
    distance: number,
    elevation_profile: Profile,
    elevation_surface?: string,
    air_profile?: [number, number][],
) => ({
    subtype,
    distance_units: distance,
    travel_hours: distance,
    elevation_profile,
    ...(elevation_surface ? { elevation_surface } : {}),
    ...(air_profile ? { air_profile } : {}),
});
const route = (...segments: ReturnType<typeof segment>[]): RouteResponse =>
    ({ miles_per_unit: 3, stages: [], segments }) as unknown as RouteResponse;

/** Land bis zum Fluss (1 E), der Fluss fällt (2 E), das Meer (4 E), dann wieder Land (1 E): die Reise des Betreibers. */
const journey = route(
    segment(
        "Strasse",
        1,
        [
            [0, 20],
            [0.5, 90],
            [1, 150],
        ],
        "land",
    ),
    segment(
        "Flussweg",
        2,
        [
            [0, 150],
            [1, 70],
            [2, 4],
        ],
        "river",
    ),
    segment(
        "Seeweg",
        4,
        [
            [0, 0],
            [4, 0],
        ],
        "sea",
    ),
    segment(
        "Pfad",
        1,
        [
            [0, 3],
            [1, 12],
        ],
        "land",
    ),
);

describe("Läufe nach Art", () => {
    it("🔴 jeder Abschnitt zeichnet in der Art, die der Server meldet: Land, Fluss, Meer, Land", () => {
        const { runs } = elevationChartData(journey);
        expect(runs.map((run) => run.kind)).toEqual(["land", "river", "sea", "land"]);
        expect(runs.map((run) => surfaceTone(run.kind))).toEqual(["land", "river", "sea", "land"]);
    });

    it("🔴 durchgehend: ohne Lücke an Land↔Wasser-Übergängen, von der ersten bis zur letzten Meile", () => {
        const { runs, distance } = elevationChartData(journey);
        expect(runs[0]!.points[0]![0]).toBe(0);
        expect(runs.at(-1)!.points.at(-1)![0]).toBeCloseTo(distance, 9);
        expect(distance).toBe(24);
        for (let i = 1; i < runs.length; i += 1) {
            // Das Ende eines Laufs liegt auf der Meile, an der der nächste beginnt: nichts bleibt offen.
            expect(runs[i]!.points[0]![0]).toBeCloseTo(runs[i - 1]!.points.at(-1)![0], 9);
        }
    });

    it("🔴 der Fluss fällt stromab, das Meer liegt auf 0 und die Höhe springt am Ufer nicht über das Gelände hinaus", () => {
        const [, river, sea] = elevationChartData(journey).runs;
        const heights = river!.points.map(([, height]) => height);
        expect(heights).toEqual([...heights].sort((a, b) => b - a));
        expect(river!.points[0]![1]).toBe(150);
        expect(river!.points.at(-1)![1]).toBe(4);
        expect(sea!.points.every(([, height]) => height === 0)).toBe(true);
    });

    it("ohne Angabe der Art gilt Land: ein Landweg von vor dem Nachtrag zeichnet wie bisher", () => {
        const old = route(
            segment("Strasse", 1, [
                [0, 20],
                [1, 90],
            ]),
        );
        expect(elevationChartData(old).runs.map((run) => run.kind)).toEqual(["land"]);
    });

    it("eine Lücke beendet den Lauf, ohne dass die Linie darüber gezogen wird", () => {
        const gapped = route(
            segment(
                "Strasse",
                3,
                [
                    [0, 10],
                    [1, null],
                    [2, 30],
                    [3, 40],
                ],
                "land",
            ),
        );
        const { runs, terrain } = elevationChartData(gapped);
        expect(runs.map((run) => run.points)).toEqual([
            [[0, 10]],
            [
                [6, 30],
                [9, 40],
            ],
        ]);
        expect(profileLines(terrain)).toHaveLength(2);
    });

    it("Abschnitte ohne Linie (kein Höhenmodell) bleiben Lücken und bilden keinen Lauf", () => {
        const none = route(
            segment(
                "Strasse",
                1,
                [
                    [0, 20],
                    [1, 90],
                ],
                "land",
            ),
            {
                subtype: "Flussweg",
                distance_units: 2,
                travel_hours: 2,
            } as ReturnType<typeof segment>,
        );
        const data = elevationChartData(none);
        expect(data.runs).toHaveLength(1);
        expect(data.partial).toBe(true);
    });

    it("ein Binnensee zeichnet in der Farbe des Flusses, das Meer eigen", () => {
        expect(SURFACE_TONES).toEqual({ land: "land", river: "river", lake: "river", sea: "sea" });
        expect(surfaceTone("lake")).toBe(surfaceTone("river"));
        expect(surfaceTone("sea")).not.toBe(surfaceTone("river"));
    });

    it("hat ein Profil, wenn nur Wasserabschnitte Linien tragen (Flug und Wasser zählen mit)", () => {
        expect(
            hasElevationProfile(
                route(
                    segment(
                        "Seeweg",
                        4,
                        [
                            [0, 0],
                            [4, 0],
                        ],
                        "sea",
                    ),
                ),
            ),
        ).toBe(true);
        expect(
            hasElevationProfile(
                route(
                    segment(
                        "Flug",
                        4,
                        [
                            [0, 12],
                            [4, 3],
                        ],
                        "land",
                        [
                            [0, 12],
                            [4, 3],
                        ],
                    ),
                ),
            ),
        ).toBe(true);
    });
});

describe("Flug: Gelände darunter, rote Linie darüber", () => {
    const flight = route(
        segment(
            "Flug",
            10,
            [
                [0, 40],
                [2, 60],
                [4, 8],
                [5, 0],
                [8, 0],
                [10, 0],
            ],
            "land",
            [
                [0, 40],
                [1, 800],
                [8, 800],
                [10, 0],
            ],
        ),
    );

    it("🔴 liefert die Flughöhe als eigene Linie in Meilen über der Reise", () => {
        const { air } = elevationChartData(flight);
        expect(profileLines(air)).toEqual([
            [
                [0, 40],
                [3, 800],
                [24, 800],
                [30, 0],
            ],
        ]);
    });

    it("🔴 unter dem Flug ist das Gelände Land, wo es über 0 liegt, und Meer, wo das Modell 0 hat; die Linie reißt am Ufer nicht", () => {
        const { runs } = elevationChartData(flight);
        expect(runs.map((run) => run.kind)).toEqual(["land", "sea"]);
        // Der Meerlauf beginnt am letzten Landpunkt (Meile 12, 8 Schritt), nicht erst am ersten Nullpunkt.
        expect(runs[0]!.points.at(-1)).toEqual([12, 8]);
        expect(runs[1]!.points[0]).toEqual([12, 8]);
        expect(runs[1]!.points.at(-1)).toEqual([30, 0]);
    });

    it("die Flughöhe an einer Stelle: zwischen zwei Punkten linear, außerhalb der Bahn nichts", () => {
        const { air } = elevationChartData(flight);
        const lines = profileLines(air);
        expect(airHeightAt(lines, 0)).toBe(40);
        expect(airHeightAt(lines, 1.5)).toBeCloseTo(40 + (760 * 1.5) / 3, 9);
        expect(airHeightAt(lines, 10)).toBe(800);
        expect(airHeightAt(lines, 30)).toBe(0);
        expect(airHeightAt(lines, 31)).toBeNull();
        expect(airHeightAt([], 1)).toBeNull();
        // Eine Landreise hat keine rote Linie.
        expect(elevationChartData(journey).air).toEqual([]);
    });

    it("zwei Flugabschnitte tragen je eine Linie, die an ihren Wegpunkten aneinanderstößt", () => {
        const two = route(
            segment(
                "Flug",
                2,
                [
                    [0, 10],
                    [2, 30],
                ],
                "land",
                [
                    [0, 10],
                    [1, 500],
                    [2, 30],
                ],
            ),
            segment(
                "Flug",
                2,
                [
                    [0, 30],
                    [2, 20],
                ],
                "land",
                [
                    [0, 30],
                    [1, 500],
                    [2, 20],
                ],
            ),
        );
        const lines = profileLines(elevationChartData(two).air);
        expect(lines).toHaveLength(2);
        expect(lines[0]!.at(-1)![0]).toBe(lines[1]![0]![0]);
        expect(airHeightAt(lines, 6)).toBe(30);
    });
});

describe("Messpunkt unter dem Zeiger", () => {
    it("nimmt den nächsten Punkt über alle Läufe und nennt seine Art", () => {
        const { runs } = elevationChartData(journey);
        // Am Ufer teilen zwei Läufe die Meile 3: Der Zeiger entscheidet, über welchem er steht.
        expect(nearestRunPoint(runs, 3.1)).toEqual({ point: [3, 150], kind: "river" });
        expect(nearestRunPoint(runs, 2.9)).toEqual({ point: [3, 150], kind: "land" });
        expect(nearestRunPoint(runs, 15)?.kind).toBe("sea");
        expect(nearestRunPoint([], 1)).toBeNull();
    });

    it("segmentRuns setzt Abstände und Meilen um", () => {
        expect(
            segmentRuns(
                {
                    elevation_profile: [
                        [0, 5],
                        [2, 7],
                    ],
                    elevation_surface: "river",
                },
                10,
                3,
            ),
        ).toEqual([
            {
                kind: "river",
                points: [
                    [10, 5],
                    [16, 7],
                ],
            },
        ]);
        expect(segmentRuns({}, 0, 3)).toEqual([]);
    });
});
