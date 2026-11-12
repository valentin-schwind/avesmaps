import { distanceTransform, fillArea, type AreaGeometry } from "../hydrology/water.ts";
import type { Grid } from "../hydrology/grid.ts";

export function initialHeight(
    g: Grid,
    areas: readonly AreaGeometry[],
    maximum: number,
    radius: number,
): { land: Uint8Array; height: Float32Array; coastDistance: Float32Array } {
    if (!(maximum > 0) || !(radius > 0)) throw new RangeError("Invalid continental shape parameters");
    const land = new Uint8Array(g.n * g.n);
    for (const geometry of areas)
        fillArea(g, geometry, (k) => {
            land[k] = 1;
        });
    const edge = (k: number): boolean => {
        if (!land[k]) return true;
        const x = k % g.n;
        const y = Math.floor(k / g.n);
        return (
            x === 0 ||
            y === 0 ||
            x === g.n - 1 ||
            y === g.n - 1 ||
            !land[k - 1] ||
            !land[k + 1] ||
            !land[k - g.n] ||
            !land[k + g.n]
        );
    };
    const height = new Float32Array(land.length);
    distanceTransform(g, edge, height);
    const coastDistance = height.slice();
    for (let k = 0; k < height.length; k += 1) {
        const t = Math.min(1, ((height[k] as number) * g.cell) / radius);
        height[k] = land[k] ? maximum * t * t * (3 - 2 * t) : 0;
    }
    return { land, height, coastDistance };
}
