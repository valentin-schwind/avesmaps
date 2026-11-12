import { planeOf, type Grid, type Plane } from "../hydrology/grid.ts";
import { distanceTransform } from "../hydrology/water.ts";

export interface InfluenceRecipe {
    inward: number;
    outward: number;
}

/**
 * Signed Euclidean distance to the union boundary; never changes semantic membership. A one-sided ramp
 * skips the other distance field: there the clamped ramp is 0 (outside) or 1 (inside) for every distance.
 */
export function distanceInfluence(g: Grid | Plane, mask: Uint8Array, recipe: InfluenceRecipe): Float32Array {
    const { width, height, cell } = planeOf(g);
    if (
        mask.length !== width * height ||
        recipe.inward < 0 ||
        recipe.outward < 0 ||
        !Number.isFinite(recipe.inward + recipe.outward) ||
        recipe.inward + recipe.outward === 0
    )
        throw new RangeError("Invalid morphological influence");
    const inside = new Float32Array(mask.length);
    let outside: Float32Array | undefined;
    if (recipe.inward > 0) distanceTransform(g, (k) => mask[k] === 0, inside);
    if (recipe.outward > 0) {
        outside = new Float32Array(mask.length);
        distanceTransform(g, (k) => mask[k] !== 0, outside);
    }
    for (let k = 0; k < mask.length; k += 1) {
        if (mask[k] ? recipe.inward === 0 : !outside) {
            inside[k] = mask[k] ? 1 : 0;
            continue;
        }
        const signed = mask[k] ? (inside[k]! - 0.5) * cell : -(outside![k]! - 0.5) * cell;
        const t = Math.max(0, Math.min(1, (signed + recipe.outward) / (recipe.inward + recipe.outward)));
        inside[k] = t * t * (3 - 2 * t);
    }
    return inside;
}
