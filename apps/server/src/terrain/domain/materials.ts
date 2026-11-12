import { grid, type Grid } from "../hydrology/grid.ts";
import { fillArea, type AreaGeometry } from "../hydrology/water.ts";
import type { LandformRecipe, MaterialRecipe, MaterialRecipes } from "./recipes.ts";
import { distanceInfluence } from "./influence.ts";
import { blur } from "./blur.ts";

export interface MaterialArea {
    layer: "topographie" | "vegetation";
    type: string | null;
    geometry: AreaGeometry;
}

export interface MaterialFields {
    m: number;
    upliftWeight: Float32Array;
    erodibility: Float32Array;
    diffusivity: Float32Array;
    runoff: Float32Array;
    channelBias: Float32Array;
    landforms: { recipe: LandformRecipe; membership: Float32Array }[];
    foothills?: { influence: Float32Array; capInfluence: Float32Array; asymmetry: number; capAtMountain: number };
}

const FACTORS = ["upliftWeight", "erodibility", "diffusivity", "runoff"] as const;

export function composeMaterials(
    g: Grid,
    land: Uint8Array,
    areas: readonly MaterialArea[],
    recipes: MaterialRecipes,
    blurUnits: number,
    coarse = 1024,
): MaterialFields {
    if (land.length !== g.n * g.n || !Number.isFinite(blurUnits) || blurUnits < 0)
        throw new RangeError("Invalid material grid");
    const m = Math.min(g.n, coarse);
    const cg = grid(m);
    const count = m * m;
    const factor = g.n / m;
    const weight = new Float64Array(count);
    for (let y = 0; y < g.n; y += 1) {
        for (let x = 0; x < g.n; x += 1) {
            if (!land[y * g.n + x]) continue;
            const k = Math.floor(y / factor) * m + Math.floor(x / factor);
            weight[k] = (weight[k] as number) + 1 / (factor * factor);
        }
    }
    const groups = new Map<string, { recipe: MaterialRecipe; areas: MaterialArea[] }>();
    for (const area of areas) {
        const table = recipes[area.layer];
        const recipe = area.type === null || !Object.hasOwn(table, area.type) ? undefined : table[area.type];
        if (!recipe) continue;
        const key = `${area.layer}/${area.type}`;
        const group = groups.get(key) ?? { recipe, areas: [] };
        group.areas.push(area);
        groups.set(key, group);
    }
    const result: MaterialFields = {
        m,
        upliftWeight: new Float32Array(count),
        erodibility: new Float32Array(count),
        diffusivity: new Float32Array(count),
        runoff: new Float32Array(count),
        channelBias: new Float32Array(count),
        landforms: [],
    };
    const logs = FACTORS.map(() => new Float64Array(count));
    const mountain = groups.get("topographie/gebirge");
    const foothills = recipes.mountainMorphology?.foothills;
    let mountainFraction: Float32Array | undefined;
    if (mountain && foothills && groups.has("topographie/huegelland")) {
        const mask = new Uint8Array(count);
        for (const area of mountain.areas)
            fillArea(cg, area.geometry, (k) => {
                mask[k] = weight[k]! > 0 ? 1 : 0;
            });
        const influence = distanceInfluence(cg, mask, { inward: 0, outward: foothills.reach });
        const interior = distanceInfluence(cg, mask, { inward: foothills.hillTransition, outward: 0 });
        // A loop, not `Float32Array.from(influence, map)`: that first lists every value as a JS array.
        const capInfluence = new Float32Array(count);
        for (let k = 0; k < count; k += 1) capInfluence[k] = influence[k]! * (1 - interior[k]!);
        result.foothills = {
            influence,
            capInfluence,
            asymmetry: foothills.hillAsymmetry,
            capAtMountain: foothills.capAtMountain,
        };
        mountainFraction = mountain.recipe.influence
            ? distanceInfluence(cg, mask, mountain.recipe.influence)
            : Float32Array.from(mask);
    }
    const bias = new Float64Array(count);
    const membership = new Float64Array(count);
    const denominator = weight.slice();
    const spare = new Float64Array(count);
    const radius = Math.round(blurUnits / cg.cell);
    blur(denominator, spare, m, radius);
    for (const key of [...groups.keys()].sort()) {
        const group = groups.get(key)!;
        membership.fill(0);
        for (const area of group.areas)
            fillArea(cg, area.geometry, (k) => {
                membership[k] = weight[k] as number;
            });
        let influence: Float32Array | undefined;
        if (group.recipe.influence) {
            const present = new Uint8Array(count);
            for (let k = 0; k < count; k += 1) if (membership[k]! > 0) present[k] = 1;
            influence = distanceInfluence(cg, present, group.recipe.influence);
        }
        if (!influence) blur(membership, spare, m, radius);
        const form = group.recipe.landform ? new Float32Array(count) : undefined;
        for (let k = 0; k < count; k += 1) {
            const w = denominator[k] as number;
            const fraction = influence
                ? weight[k]! > 0
                    ? influence[k]!
                    : 0
                : w > 0
                  ? Math.min(1, Math.max(0, (membership[k] as number) / w))
                  : 0;
            if (form) form[k] = fraction;
            const inherited = key === "topographie/huegelland" ? (result.foothills?.influence[k] ?? 0) : 0;
            const blend =
                key === "topographie/huegelland" && result.foothills
                    ? result.foothills.capInfluence[k]! ** foothills!.erosionFocus
                    : 0;
            for (let p = 0; p < FACTORS.length; p += 1) {
                const field = logs[p]!;
                const name = FACTORS[p]!;
                let logarithm = Math.log(group.recipe[name]);
                if (inherited > 0 && name !== "upliftWeight") {
                    logarithm =
                        (1 - inherited) * logarithm +
                        inherited * (1 - mountainFraction![k]!) * Math.log(mountain!.recipe[name]);
                }
                if (blend > 0) {
                    logarithm =
                        (1 - blend) * logarithm +
                        blend *
                            (Math.log(foothills!.material[name]) -
                                mountainFraction![k]! * Math.log(mountain!.recipe[name]));
                }
                field[k] = (field[k] as number) + fraction * logarithm;
            }
            const channel =
                blend > 0
                    ? (1 - blend) * group.recipe.channelBias +
                      blend * (foothills!.material.channelBias - mountainFraction![k]! * mountain!.recipe.channelBias)
                    : group.recipe.channelBias;
            bias[k] = (bias[k] as number) + fraction * channel;
        }
        if (form) result.landforms.push({ recipe: group.recipe.landform!, membership: form });
    }
    for (let k = 0; k < count; k += 1) {
        for (let p = 0; p < FACTORS.length; p += 1) result[FACTORS[p]!][k] = Math.exp(logs[p]![k] as number);
        result.channelBias[k] = bias[k] as number;
    }
    return result;
}
