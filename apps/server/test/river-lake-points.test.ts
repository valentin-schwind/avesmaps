import { describe, expect, it } from "vitest";
import { fieldOf } from "../src/terrain/river-field.ts";
import { lakePointsOf } from "../src/terrain/river-lakes.ts";
import { RIVER_STEP, type RiverLake } from "../src/terrain/river-network.ts";
import { pointInGeometry } from "@avesmaps3d/shared";

/** WI-0067 performance: the row sweep of lake points decides exactly like `pointInGeometry`. */

function reference(lake: RiverLake): number[] {
    const corners = (
        (lake.geometry.type === "Polygon" ? [lake.geometry.coordinates] : lake.geometry.coordinates) as number[][][][]
    ).flat(2);
    const xs = corners.map((p) => p[0]!),
        ys = corners.map((p) => p[1]!);
    const points: number[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += RIVER_STEP)
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += RIVER_STEP)
            if (pointInGeometry([x, y], lake.geometry)) points.push(x, y);
    return points;
}

describe("lake points", () => {
    it("match point-in-polygon for an irregular lake with a hole and a second part, on vertices and edges", () => {
        const ring = Array.from({ length: 41 }, (_, i) => {
            const a = (2 * Math.PI * i) / 40;
            const r = 1.1 + 0.35 * Math.sin(5 * a) + 0.2 * Math.cos(3 * a);
            return [10.5 + r * Math.cos(a), 10.25 + r * Math.sin(a)];
        });
        ring[40] = ring[0]!;
        const hole = [
            [10.25, 10.0],
            [10.75, 10.0],
            [10.75, 10.5],
            [10.25, 10.5],
            [10.25, 10.0],
        ];
        const lake: RiverLake = {
            id: "l",
            name: "Lake",
            geometry: {
                type: "MultiPolygon",
                coordinates: [
                    [ring, hole],
                    [
                        [
                            [13, 9],
                            [14.03125, 9],
                            [13.5, 10.0625],
                            [13, 9],
                        ],
                    ],
                ],
            } as RiverLake["geometry"],
        };
        const field = fieldOf([
            { cell: 0.25, originX: 0, originY: 0, width: 81, height: 81, samples: new Uint16Array(81 * 81) },
        ]);
        const [points] = lakePointsOf(field, [lake]);
        expect(Array.from(points!)).toEqual(reference(lake));
        expect(points!.length).toBeGreaterThan(1000);
    });
});
