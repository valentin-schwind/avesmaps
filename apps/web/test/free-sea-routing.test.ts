import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_SEA_EDGE_PREFIX } from "@avesmaps3d/shared";
import { segmentShape } from "../src/map/route-layers.ts";
import { DEFAULT_OPTIONS } from "../src/route-planner/planner-model.ts";
import { routeQuery } from "../src/route-planner/route-client.ts";

/**
 * Die Seefahrt im Planer (WI-0046): frei über das Wasser, ohne Seewege. Den Vergleichsschalter `?seerouting=wege` gibt es seit
 * WI-0153 Schnitt 7e nicht mehr (Betreiber 2026-10-17). Die geglättete Seelinie des Servers wird gezeichnet, wie sie ist.
 */

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Seefahrt ohne Seewege (WI-0153 Schnitt 7e)", () => {
    it("🔴 die Anfrage nennt nie die Seewege, auch nicht mit dem früheren Schalter in der Adresse", () => {
        expect(new URLSearchParams(routeQuery(["a", "b"], DEFAULT_OPTIONS)).has("sea_routing")).toBe(false);
        vi.stubGlobal("location", { search: "?seerouting=wege" });
        expect(new URLSearchParams(routeQuery(["a", "b"], DEFAULT_OPTIONS)).has("sea_routing")).toBe(false);
    });
});

describe("Zeichenlinie der freien Seefahrt", () => {
    const geometry = {
        type: "LineString" as const,
        coordinates: [
            [0, 0],
            [10, 0],
            [10, 10],
        ] as [number, number][],
    };
    const display = {
        type: "LineString" as const,
        coordinates: [
            [0, 0],
            [8, 0.5],
            [9.5, 2],
            [10, 10],
        ] as [number, number][],
    };

    it("zeichnet die geglättete Linie des Servers ohne zweites Glätten", () => {
        const shape = segmentShape({ edge_id: `${FREE_SEA_EDGE_PREFIX}a-b`, geometry, display });
        expect(shape.map(({ x, y }) => [x, y])).toEqual(display.coordinates);
    });

    it("glättet jeden anderen Abschnitt wie bisher", () => {
        const shape = segmentShape({ edge_id: "seeweg#0", geometry, display });
        expect(shape.length).toBeGreaterThan(display.coordinates.length);
    });
});
