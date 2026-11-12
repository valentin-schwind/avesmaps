import { describe, expect, it } from "vitest";
import { grid } from "../src/terrain/hydrology/grid.ts";
import { initialHeight } from "../src/terrain/domain/shape.ts";

const g = grid(128);
function square(from: number, to: number) {
    return {
        type: "Polygon",
        coordinates: [
            [
                [from, from],
                [to, from],
                [to, to],
                [from, to],
                [from, from],
            ],
        ],
    };
}

describe("WI-0067: continent-driven initial height", () => {
    it("starts at zero at the mask edge and grows smoothly to 300 inland", () => {
        const { height, land } = initialHeight(g, [square(128, 896)], 300, 100);
        const row = 64 * g.n;
        expect(height[row + 16]).toBe(0);
        expect(height[row + 64]).toBe(300);
        for (let x = 17; x <= 64; x += 1) expect(height[row + x]).toBeGreaterThanOrEqual(height[row + x - 1]!);
        expect(land[row]).toBe(0);
        expect(height[row]).toBe(0);
    });

    it("does not give a small island a 300-step plateau", () => {
        const { height } = initialHeight(g, [square(480, 544)], 300, 100);
        expect(Math.max(...height)).toBeLessThan(100);
    });

    it("changes when the supplied continent geometry changes", () => {
        expect(initialHeight(g, [square(128, 896)], 300, 100).height).not.toEqual(
            initialHeight(g, [square(400, 624)], 300, 100).height,
        );
    });
});
