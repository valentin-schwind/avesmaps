import { fbm, wertRauschen } from "@avesmaps3d/shared";
import { landscapeSampler } from "../hydrology/landscape.ts";
import { cellX, cellY, type Grid, type Plane } from "../hydrology/grid.ts";
import type { MaterialFields } from "./materials.ts";
import type { DetailRecipe, LandformRecipe } from "./recipes.ts";
import { createHillField, type HillFacing } from "./hills.ts";
import { sampleSmoothField } from "./field.ts";
import { hillFacing } from "./hill-facing.ts";

/** Do not alias fine octaves into broad hills on lower-resolution diagnostic grids. */
function octaveCount(wavelength: number, cell: number, maximum: number): number {
    return Math.max(1, Math.min(maximum, 1 + Math.floor(Math.log2(wavelength / (2 * cell)))));
}

export function detailHeight(recipe: DetailRecipe, seed: number, x: number, y: number, cell: number): number {
    const wavelength = Math.max(recipe.wavelength, 2 * cell);
    return (
        (recipe.amplitude *
            (1 + fbm(seed, x, y, wavelength, octaveCount(wavelength, cell, recipe.octaves), recipe.persistence))) /
        2
    );
}

export function createLandformSampler(
    recipe: LandformRecipe,
    seed: number,
    cell: number,
    facingAt?: (x: number, y: number) => HillFacing | undefined,
): (x: number, y: number) => number {
    if (recipe.kind === "hills") return createHillField(recipe, seed, 1024, facingAt).sample;
    const wavelength = Math.max(recipe.wavelength, 2 * cell);
    return (x, y) =>
        recipe.minimum + ((recipe.maximum - recipe.minimum) * (1 + wertRauschen(seed, x, y, wavelength * 8))) / 2;
}

/** Initial geological forms: later erosion, lakes, river burn and absolute peaks all see this height. */
export function addInitialDetails(
    g: Grid,
    land: Uint8Array,
    height: Float32Array,
    coastDistance: Float32Array,
    materials: MaterialFields,
    recipe: DetailRecipe,
    seed: number,
    /** Nur in diesem Fenster (WI-0223, ein lokaler Lauf übernimmt außen das Anfangsgelände des vorigen); die Werte je Zelle bleiben gleich. */
    only?: Plane,
): Float32Array | undefined {
    const hillDetails = materials.foothills ? new Float32Array(height.length) : undefined;
    const forms = materials.landforms.map((form) => ({
        ...form,
        sample: createLandformSampler(
            form.recipe,
            seed,
            g.cell,
            materials.foothills ? (x, y) => hillFacing(materials, x, y) : undefined,
        ),
    }));
    const read = landscapeSampler(materials.m, g.n);
    const [xa, xb, ya, yb] = only ? [only.x0, only.x0 + only.width, only.y0, only.y0 + only.height] : [0, g.n, 0, g.n];
    for (let y = ya; y < yb; y += 1) {
        for (let x = xa; x < xb; x += 1) {
            const k = y * g.n + x;
            if (!land[k]) continue;
            const t = Math.min(1, (coastDistance[k]! * g.cell) / recipe.coastFade);
            const fade = t * t * (3 - 2 * t);
            const px = cellX(g, x);
            const py = cellY(g, y);
            const strength = Math.min(1, read(materials.upliftWeight, x, y) / read(materials.diffusivity, x, y));
            let value = strength * detailHeight(recipe, seed, px, py, g.cell);
            for (const form of forms) {
                const weight =
                    form.recipe.kind === "hills"
                        ? sampleSmoothField({ m: materials.m, values: form.membership }, g.n, x, y)
                        : read(form.membership, x, y);
                if (weight > 0) {
                    const capScale =
                        form.recipe.kind === "hills" && materials.foothills
                            ? 1 -
                              (1 - materials.foothills.capAtMountain) *
                                  sampleSmoothField(
                                      { m: materials.m, values: materials.foothills.influence },
                                      g.n,
                                      x,
                                      y,
                                  )
                            : 1;
                    const contribution = weight * capScale * form.sample(px, py);
                    value += contribution;
                    if (hillDetails && form.recipe.kind === "hills")
                        hillDetails[k] = hillDetails[k]! + fade * contribution;
                }
            }
            height[k] = height[k]! + fade * value;
        }
    }
    return hillDetails;
}
