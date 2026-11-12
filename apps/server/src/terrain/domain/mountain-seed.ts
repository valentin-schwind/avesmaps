import { DX, DY, type Grid } from "../hydrology/grid.ts";
import { distanceTransform } from "../hydrology/water.ts";
import { blur } from "./blur.ts";
import { distanceInfluence, type InfluenceRecipe } from "./influence.ts";
import { releaseIntermediates } from "./memory.ts";
import type { MountainMorphology } from "./recipes.ts";

/** Box blur of several fields that share one scratch buffer; the scratch ends with this call. */
function blurAll(n: number, radius: number, ...fields: Float32Array[]): void {
    const spare = new Float32Array(n * n);
    for (const field of fields) blur(field, spare, n, radius);
}

/** Limit added foothill macroheight by inward neighbours without eroding the existing baseline. */
function limitOutwardRise(
    g: Grid,
    field: Float32Array,
    baseline: Float32Array,
    mountains: Uint8Array,
    reach: number,
): void {
    const distance = new Float32Array(field.length);
    distanceTransform(g, (k) => mountains[k] !== 0, distance);
    const rises = (k: number): boolean =>
        !mountains[k] && field[k]! > baseline[k]! && (distance[k]! - 0.5) * g.cell < reach;
    let count = 0;
    for (let k = 0; k < field.length; k += 1) if (rises(k)) count += 1;
    // Only the cells that rise: a whole-grid index array would cost 64 MiB.
    const ordered = new Int32Array(count);
    count = 0;
    for (let k = 0; k < field.length; k += 1) if (rises(k)) ordered[count++] = k;
    ordered.sort((a, b) => distance[a]! - distance[b]! || a - b);
    for (const k of ordered) {
        const x = k % g.n,
            y = Math.floor(k / g.n);
        let weighted = 0,
            total = 0;
        for (let d = 0; d < 8; d += 1) {
            const nx = x + DX[d]!,
                ny = y + DY[d]!;
            if (nx < 0 || ny < 0 || nx >= g.n || ny >= g.n) continue;
            const neighbour = ny * g.n + nx;
            const drop = distance[k]! - distance[neighbour]!;
            if (!(drop > 0)) continue;
            const weight = drop / (d < 4 ? 1 : Math.SQRT2);
            weighted += weight * field[neighbour]!;
            total += weight;
        }
        if (total > 0) field[k] = Math.max(baseline[k]!, Math.min(field[k]!, weighted / total));
    }
}

type FoothillRecipe = Pick<MountainMorphology["foothills"], "reach" | "smoothing" | "hillTransition"> &
    Partial<Pick<MountainMorphology["foothills"], "macroRetention">>;

/**
 * Mountain macroheight blurred and normalized by the blurred mountain area; its weight field ends here.
 * 🪤 Plain loops, not `Float32Array.from(seed, map)`: with a mapping function V8 first builds a JS list of
 * all 16.7 million values (measured +832 MiB peak on 4096²).
 */
function normalizedMacro(g: Grid, seed: Float32Array, mountains: Uint8Array, smoothing: number): Float32Array {
    const broad = new Float32Array(seed.length);
    const weight = new Float32Array(seed.length);
    for (let k = 0; k < seed.length; k += 1)
        if (mountains[k]) {
            broad[k] = seed[k]!;
            weight[k] = 1;
        }
    blurAll(g.n, Math.max(1, Math.round(smoothing / g.cell)), broad, weight);
    for (let k = 0; k < seed.length; k += 1) broad[k] = weight[k]! > 0 ? Math.max(0, broad[k]! / weight[k]!) : 0;
    return broad;
}

/** The continued macroheight blended into hills, written over the normalized macro field in place. */
function continuedMacro(
    g: Grid,
    baseline: Float32Array,
    seed: Float32Array,
    mountains: Uint8Array,
    hills: Uint8Array,
    recipe: FoothillRecipe,
): Float32Array {
    const broad = normalizedMacro(g, seed, mountains, recipe.smoothing);
    releaseIntermediates();
    const falloff = distanceInfluence(g, mountains, { inward: 0, outward: recipe.reach });
    const hillWeight = distanceInfluence(g, hills, { inward: recipe.hillTransition, outward: recipe.hillTransition });
    for (let k = 0; k < broad.length; k += 1) {
        const v = baseline[k]!;
        if (!(broad[k]! > 0)) {
            broad[k] = v;
            continue;
        }
        const retention = 1 - (1 - (recipe.macroRetention ?? 1)) * falloff[k]! ** 2;
        const extended = broad[k]! * falloff[k]! * retention;
        broad[k] = v + Math.max(0, extended - v) * hillWeight[k]!;
    }
    return broad;
}

/** Continue the mountain's own macroheight, normalized by contributing mountain area, into nearby hills. */
export function extendMountainFoothills(
    g: Grid,
    baseline: Float32Array,
    seed: Float32Array,
    mountains: Uint8Array,
    hills: Uint8Array,
    recipe: FoothillRecipe,
): Float32Array {
    const result = continuedMacro(g, baseline, seed, mountains, hills, recipe);
    releaseIntermediates();
    limitOutwardRise(g, result, baseline, mountains, recipe.reach);
    return result;
}

/** Extends the seed's low frequencies while retaining interior ridges at their original resolution. */
export function mountainSeedField(
    g: Grid,
    seed: Float32Array,
    membership: Uint8Array,
    influence: InfluenceRecipe,
): Float32Array {
    const radius = Math.max(1, Math.round(influence.outward / (3 * g.cell)));
    const broad = seed.slice();
    const normalizer = new Float32Array(seed.length).fill(1);
    blurAll(g.n, radius, broad, normalizer);
    releaseIntermediates();
    const inside = distanceInfluence(g, membership, { inward: influence.inward, outward: 0 });
    const outside = distanceInfluence(g, membership, { inward: 0, outward: influence.outward });
    for (let k = 0; k < seed.length; k += 1) {
        const low = broad[k]! / normalizer[k]!;
        broad[k] = inside[k]! * seed[k]! + (1 - inside[k]!) * outside[k]! * low;
    }
    return broad;
}

/** Remove inherited sub-scale drainage grooves before the domain's own drainage is established. */
export function relaxMountainSeed(g: Grid, seed: Float32Array, smoothing: number): Float32Array {
    if (!(smoothing >= 0) || !Number.isFinite(smoothing)) throw new RangeError("Invalid seed smoothing");
    const result = seed.slice();
    const radius = Math.round(smoothing / g.cell);
    if (radius === 0) return result;
    const normalizer = new Float32Array(seed.length).fill(1);
    blurAll(g.n, radius, result, normalizer);
    for (let k = 0; k < result.length; k += 1) result[k] = Math.max(0, result[k]! / normalizer[k]!);
    return result;
}
