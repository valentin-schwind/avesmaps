import { planeOf, type Grid, type Plane } from "../hydrology/grid.ts";
import { hash2 } from "@avesmaps3d/shared";
import { distanceInfluence } from "./influence.ts";
import type { MountainMorphology } from "./recipes.ts";

interface CrestPoint {
    x: number;
    y: number;
    height: number;
}

/**
 * Placed fragments as flat splat records: centre cell, then both crest ends (x, y, height), the radius and
 * the crest sharpness. Coordinates are grid space (row 0 at y = 0), exactly as the placement draws them.
 */
export interface MountainFragments {
    count: number;
    /** Grid cell of the fragment centre that owns each splat. */
    centres: Int32Array;
    /** Eight numbers per splat: ax, ay, ah, bx, by, bh, radius, sharpness. */
    splats: Float64Array;
}

const SPLAT = 8;

/**
 * Compact cross-section around a short, irregular crest segment. Sharpness 0 is the rounded bell
 * `(1 − d²)²`; towards 1 a segment becomes the tent `1 − d` with a knife-edge crest line (alpine arête), and
 * a single point a small pyramid with 3–4 faces inscribed in the circle (a tent around a point is a cone).
 */
function splat(
    plane: Plane,
    delta: Float32Array,
    a: CrestPoint,
    b: CrestPoint,
    radius: number,
    sharpness: number,
): void {
    const { cell, x0: wx, y0: wy, width, height } = plane;
    const dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
    const x0 = Math.max(wx, Math.floor((Math.min(a.x, b.x) - radius) / cell));
    const x1 = Math.min(wx + width - 1, Math.ceil((Math.max(a.x, b.x) + radius) / cell));
    const y0 = Math.max(wy, Math.floor((Math.min(a.y, b.y) - radius) / cell));
    const y1 = Math.min(wy + height - 1, Math.ceil((Math.max(a.y, b.y) + radius) / cell));
    const facets = sharpness > 0 && length2 === 0 ? pointFacets(a) : undefined;
    for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
            const px = (x + 0.5) * cell,
                py = (y + 0.5) * cell;
            const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length2)) : 0;
            const d2 = ((px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2) / (radius * radius);
            if (d2 >= 1) continue;
            const blend = t * t * (3 - 2 * t);
            let profile = (1 - d2) ** 2;
            if (sharpness > 0) {
                let sharp = 1 - Math.sqrt(d2);
                if (facets) {
                    let gauge = 0;
                    for (let i = 0; i < facets.length; i += 2)
                        gauge = Math.max(gauge, (px - a.x) * facets[i]! + (py - a.y) * facets[i + 1]!);
                    sharp = Math.max(0, 1 - gauge / (radius * facets.apothem));
                }
                profile = (1 - sharpness) * profile + sharpness * sharp;
            }
            const h = (a.height + (b.height - a.height) * blend) * profile;
            const k = (y - wy) * width + x - wx;
            delta[k] = Math.max(delta[k]!, h);
        }
}

/** Face normals of a faceted point, deterministic from its position; corners touch the circle. */
function pointFacets(a: CrestPoint): Float64Array & { apothem: number } {
    const ix = Math.round(a.x * 256),
        iy = Math.round(a.y * 256);
    const faces = 3 + Math.floor(2 * hash2(8311, ix, iy));
    const turn = 2 * Math.PI * hash2(8312, ix, iy);
    const normals = new Float64Array(2 * faces) as Float64Array & { apothem: number };
    for (let i = 0; i < faces; i += 1) {
        normals[2 * i] = Math.cos(turn + (2 * Math.PI * i) / faces);
        normals[2 * i + 1] = Math.sin(turn + (2 * Math.PI * i) / faces);
    }
    normals.apothem = Math.cos(Math.PI / faces);
    return normals;
}

/**
 * Random sequential inhibition over the whole grid; neither the buckets nor polygon iteration place the
 * features. `heightAt` reads the seed height of an allowed cell; the result depends only on cells near a
 * candidate, so any window around a mountain draws exactly the fragments the whole map would draw there.
 */
export function placeMountainFragments(
    g: Grid,
    mountains: Uint8Array,
    heightAt: (k: number) => number,
    recipe: MountainMorphology["fragments"],
    randomSeed: number,
    /** Crest sharpness from the seed height at the centre; rounded everywhere without it. */
    sharpnessAt: (seedHeight: number) => number = () => 0,
): MountainFragments {
    const extent = g.n * g.cell,
        spacing = recipe.spacing,
        n = Math.ceil(extent / spacing);
    const attempts = Math.ceil(recipe.attempts * (extent / spacing) ** 2);
    if (!Number.isSafeInteger(attempts) || attempts > 10_000_000)
        throw new RangeError("Mountain fragments exceed bounded work");
    // Only occupied buckets exist: a dense array of n² lists cost ~50 MB heap for the interior spacing.
    const buckets = new Map<number, CrestPoint[]>();
    let centres = new Int32Array(1024);
    let splats = new Float64Array(1024 * SPLAT);
    let count = 0;
    let sharpness = 0;
    const record = (centre: number, a: CrestPoint, b: CrestPoint, radius: number): void => {
        if (count === centres.length) {
            const nextCentres = new Int32Array(centres.length * 2);
            nextCentres.set(centres);
            centres = nextCentres;
            const nextSplats = new Float64Array(splats.length * 2);
            nextSplats.set(splats);
            splats = nextSplats;
        }
        centres[count] = centre;
        splats.set([a.x, a.y, a.height, b.x, b.y, b.height, radius, sharpness], count * SPLAT);
        count += 1;
    };
    for (let i = 0; i < attempts; i += 1) {
        const random = (channel: number) => hash2(randomSeed + 8107, i, channel);
        const x = random(0) * extent,
            y = random(1) * extent;
        const k = Math.floor(y / g.cell) * g.n + Math.floor(x / g.cell);
        if (!mountains[k]) continue;
        const seedHeight = heightAt(k);
        if (!(seedHeight > 0)) continue;
        const bx = Math.floor(x / spacing),
            by = Math.floor(y / spacing);
        let near = false;
        for (let yy = Math.max(0, by - 1); yy <= Math.min(n - 1, by + 1) && !near; yy += 1)
            for (let xx = Math.max(0, bx - 1); xx <= Math.min(n - 1, bx + 1) && !near; xx += 1)
                near = (buckets.get(yy * n + xx) ?? []).some(
                    (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < spacing * spacing,
                );
        if (near) continue;
        const height = seedHeight * recipe.relativeHeight * (0.3 + 0.7 * random(2));
        sharpness = sharpnessAt(seedHeight);
        const centre = { x, y, height };
        const bucket = buckets.get(by * n + bx);
        if (bucket) bucket.push(centre);
        else buckets.set(by * n + bx, [centre]);
        const radius = recipe.radiusMinimum + (recipe.radiusMaximum - recipe.radiusMinimum) * random(3);
        // Diagnostic grids must not alias a sub-cell massif into an isolated raster spike.
        if (radius < 2 * g.cell) continue;
        if (random(4) < recipe.massifFraction) {
            record(k, centre, centre, radius);
            continue;
        }
        const length = recipe.lengthMinimum + (recipe.lengthMaximum - recipe.lengthMinimum) * random(5);
        const angle = 2 * Math.PI * random(6),
            cos = Math.cos(angle),
            sin = Math.sin(angle);
        const points = 3 + Math.floor(4 * random(7));
        let previous: CrestPoint | undefined;
        for (let j = 0; j < points; j += 1) {
            const along = length * (j / (points - 1) - 0.5);
            const across = (random(10 + j * 4) - 0.5) * length * recipe.warp;
            const point = {
                x: x + cos * along - sin * across,
                y: y + sin * along + cos * across,
                height: height * (0.35 + 0.65 * random(11 + j * 4)),
            };
            record(k, point, point, radius);
            if (previous && random(12 + j * 4) >= recipe.interruption) record(k, previous, point, radius);
            previous = point;
        }
    }
    return { count, centres: centres.subarray(0, count), splats: splats.subarray(0, count * SPLAT) };
}

/** Greatest distance of any splatted cell from its fragment centre, in map units. */
export function fragmentReach(recipe: MountainMorphology["fragments"]): number {
    return (recipe.lengthMaximum * (1 + recipe.warp)) / 2 + recipe.radiusMaximum;
}

/** Maximum of all splats owned by `owns(centre)` into `delta`, which covers exactly `plane`. */
export function renderMountainFragments(
    plane: Plane,
    fragments: MountainFragments,
    delta: Float32Array,
    owns: (centre: number) => boolean = () => true,
): void {
    const s = fragments.splats;
    for (let i = 0; i < fragments.count; i += 1) {
        if (!owns(fragments.centres[i]!)) continue;
        const o = i * SPLAT;
        splat(
            plane,
            delta,
            { x: s[o]!, y: s[o + 1]!, height: s[o + 2]! },
            { x: s[o + 3]!, y: s[o + 4]!, height: s[o + 5]! },
            s[o + 6]!,
            s[o + 7]!,
        );
    }
}

/** Whole-grid fragments on a seed; the domain seed phase uses this form. */
export function addMountainFragments(
    g: Grid,
    seed: Float32Array,
    mountains: Uint8Array,
    recipe: MountainMorphology["fragments"],
    randomSeed: number,
): Float32Array {
    const fragments = placeMountainFragments(g, mountains, (k) => seed[k]!, recipe, randomSeed);
    const delta = new Float32Array(seed.length);
    renderMountainFragments(planeOf(g), fragments, delta);
    const inside = distanceInfluence(g, mountains, { inward: recipe.inward, outward: 0 });
    for (let k = 0; k < delta.length; k += 1) inside[k] = seed[k]! + delta[k]! * inside[k]!;
    return inside;
}
