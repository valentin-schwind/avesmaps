import { DX, DY, MAP_EXTENT, planeOf, SCHRITT_PER_UNIT, SEA, type Grid, type Plane } from "../hydrology/grid.ts";
import { accumulate, CellHeap, directionOf, priorityFlood, receiverOf, rho8 } from "../hydrology/flow.ts";
import { streamPowerHeight } from "@avesmaps3d/shared";
import type { MountainMorphology, TerrainRecipe } from "./recipes.ts";
import { raiseToSummit, type Summit } from "./summit-shape.ts";

/** Hochgebirge in einem Fenster: Gewicht je Zelle (0–1), Felsgrenzhang und die Gipfelformen. */
export interface AlpineTalus {
    weight: Float32Array;
    grade: number;
    summits: readonly Summit[];
}

/**
 * Talus transport with fixed boundary/constraint cells; grade is physical rise over run. `delta` is a
 * scratch buffer of the plane's size (the caller may lend one it no longer needs). With `alpine` the limit
 * steepens towards the rock grade in high cells, and summit cores are supported by their pyramid faces;
 * without it a fixed core supports only its direct neighbours, and talus spreads that into a round cone.
 */
export function relaxMountainSlopes(
    g: Grid | Plane,
    height: Float32Array,
    weight: Float32Array,
    locked: Uint8Array,
    maximumGrade: number,
    steps: number,
    delta: Float32Array = new Float32Array(height.length),
    alpine?: AlpineTalus,
): void {
    const { width, height: rows, cell, x0: gx0, y0: gy0 } = planeOf(g);
    // Only cells with weight move or receive talus: work on their bounding box. Sources stay off the edge.
    let x0 = width,
        x1 = -1,
        y0 = rows,
        y1 = -1;
    for (let y = 0; y < rows; y++)
        for (let x = 0; x < width; x++)
            if (weight[y * width + x]) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
            }
    const sx0 = Math.max(1, x0),
        sx1 = Math.min(width - 2, x1),
        sy0 = Math.max(1, y0),
        sy1 = Math.min(rows - 2, y1);
    for (let step = 0; step < steps; step++) {
        for (let y = y0; y <= y1; y++) delta.fill(0, y * width + x0, y * width + x1 + 1);
        for (let y = sy0; y <= sy1; y++)
            for (let x = sx0; x <= sx1; x++) {
                const k = y * width + x;
                if (!weight[k]) continue;
                for (let d = 0; d < 8; d++) {
                    const neighbour = (y + DY[d]!) * width + x + DX[d]!;
                    if (!weight[neighbour]) continue;
                    const distance = cell * SCHRITT_PER_UNIT * (d < 4 ? 1 : Math.SQRT2);
                    const grade = alpine
                        ? maximumGrade +
                          (alpine.grade - maximumGrade) * Math.min(alpine.weight[k]!, alpine.weight[neighbour]!)
                        : maximumGrade;
                    const excess = height[k]! - height[neighbour]! - grade * distance;
                    if (excess <= 0) continue;
                    const transfer = (excess / 8) * Math.min(weight[k]!, weight[neighbour]!);
                    if (!locked[k]) delta[k] = delta[k]! - transfer;
                    if (!locked[neighbour]) delta[neighbour] = delta[neighbour]! + transfer;
                }
            }
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const k = y * width + x;
                height[k] = Math.max(0, height[k]! + delta[k]!);
            }
        if (alpine) {
            for (const pyramid of alpine.summits)
                supportSummit(pyramid, height, weight, locked, width, rows, cell, gx0, gy0);
            continue;
        }
        for (let y = sy0; y <= sy1; y++)
            for (let x = sx0; x <= sx1; x++) {
                const k = y * width + x;
                if (!locked[k] || !weight[k]) continue;
                for (let d = 0; d < 8; d++) {
                    const neighbour = (y + DY[d]!) * width + x + DX[d]!;
                    if (locked[neighbour] || !weight[neighbour]) continue;
                    const drop = maximumGrade * cell * SCHRITT_PER_UNIT * (d < 4 ? 1 : Math.SQRT2);
                    height[neighbour] =
                        height[neighbour]! + weight[neighbour]! * Math.max(0, height[k]! - drop - height[neighbour]!);
                }
            }
    }
}

/** Raise movable interior cells around a summit core onto its pyramid faces, blended by their weight. */
function supportSummit(
    pyramid: Summit,
    height: Float32Array,
    weight: Float32Array,
    locked: Uint8Array,
    width: number,
    rows: number,
    cell: number,
    gx0: number,
    gy0: number,
): void {
    const reach = Math.ceil(pyramid.reach / cell) + 1;
    const cx = Math.floor(pyramid.x / cell) - gx0,
        cy = Math.floor((MAP_EXTENT - pyramid.y) / cell) - gy0;
    for (let y = Math.max(0, cy - reach); y <= Math.min(rows - 1, cy + reach); y++)
        for (let x = Math.max(0, cx - reach); x <= Math.min(width - 1, cx + reach); x++) {
            const k = y * width + x;
            if (locked[k] || !weight[k]) continue;
            const px = (gx0 + x + 0.5) * cell,
                py = MAP_EXTENT - (gy0 + y + 0.5) * cell;
            height[k] = height[k]! + weight[k]! * (raiseToSummit(pyramid, px, py, height[k]!) - height[k]!);
        }
}

/** The fixed inputs of one computation window; `classes` carries real SEA/LAKE bits and is overwritten. */
export interface DetailWindow {
    plane: Plane;
    /** Initial height: accepted terrain plus the fragments, refined in place. */
    height: Float32Array;
    /** 0 outside the refined interior: those cells are fixed Dirichlet boundaries. */
    weight: Float32Array;
    locked: Uint8Array;
    classes: Uint8Array;
    /**
     * Mass pool of each refinable cell (1-based; 0 outside): eroded mass returns within its own mountain
     * component, independent of how components were grouped. Without pools the whole window is one pool.
     */
    pools?: Int32Array;
    /** High-mountain shaping; without it the window refines like a uniform mid mountain. */
    alpine?: AlpineTalus;
}

/**
 * A bounded hydraulic refinement with Dirichlet boundaries: cells with weight 0 cannot change. Drainage and
 * catchment stay inside the window, eroded mass returns within its own pool (mountain component). Its edge is an open outlet like the map edge; the halo
 * keeps it away from the cells that change. Returns the refined height (the window's own buffer).
 */
export function erodeMountainDetails(
    window: DetailWindow,
    recipe: MountainMorphology["interior"],
    randomSeed: number,
    hydrology: TerrainRecipe["generator"],
    heap: CellHeap = new CellHeap(1024),
): Float32Array {
    const { plane, height, weight, locked, classes } = window;
    let pools = window.pools;
    if (!pools) {
        pools = new Int32Array(weight.length);
        for (let k = 0; k < weight.length; k++) if (weight[k]! > 0) pools[k] = 1;
    }
    const { width, height: rows, cell } = plane;
    let land = 0;
    for (let k = 0; k < classes.length; k++) if (!(classes[k]! & SEA)) land++;
    // Buffer lifetimes: `surface` is the drainage surface, then the diffusion source of the same round;
    // `area` lives from accumulation to stream power and is lent to the slope relaxation at the end.
    const surface = new Float32Array(height.length);
    const area = new Float32Array(height.length);
    const order = new Int32Array(land);
    let poolCount = 0;
    for (let k = 0; k < pools.length; k++) poolCount = Math.max(poolCount, pools[k]!);
    const poolWeight = new Float64Array(poolCount + 1);
    const poolLoss = new Float64Array(poolCount + 1);
    for (let k = 0; k < weight.length; k++) {
        const pool = pools[k]!;
        if (!locked[k] && weight[k]) poolWeight[pool] = poolWeight[pool]! + weight[k]!;
    }
    const diffusion = Math.min(0.2, (recipe.diffusion * hydrology.timeStep) / cell ** 2);
    for (let round = 0; round < recipe.iterations; round++) {
        surface.set(height);
        const count = priorityFlood(plane, surface, classes, hydrology.drainageStep, order, heap, [], randomSeed);
        rho8(plane, surface, classes, randomSeed);
        accumulate(plane, order, count, classes, area);
        poolLoss.fill(0);
        for (let i = 0; i < count; i++) {
            const k = order[i]!;
            if (!weight[k] || locked[k]) continue;
            const receiver = receiverOf(plane, k, classes);
            const direction = directionOf(classes, k);
            const next = streamPowerHeight(
                height[k]!,
                receiver < 0 ? height[k]! : height[receiver]!,
                area[k]!,
                recipe.streamPowerK,
                hydrology.streamPowerM,
                hydrology.timeStep,
                cell * (direction >= 4 && direction < 8 ? Math.SQRT2 : 1),
            );
            const change = weight[k]! * (height[k]! - next);
            height[k] = height[k]! - change;
            const pool = pools[k]!;
            poolLoss[pool] = poolLoss[pool]! + change;
        }
        // Eroded mass returns inside its own mountain component, never to a neighbouring or distant one.
        for (let k = 0; k < height.length; k++) {
            if (locked[k] || !weight[k]) continue;
            const total = poolWeight[pools[k]!]!;
            if (total > 0) height[k] = height[k]! + (poolLoss[pools[k]!]! * weight[k]!) / total;
        }
        surface.set(height);
        for (let y = 1; y < rows - 1; y++)
            for (let x = 1; x < width - 1; x++) {
                const k = y * width + x;
                if (!weight[k] || locked[k]) continue;
                const laplacian =
                    surface[k - 1]! + surface[k + 1]! + surface[k - width]! + surface[k + width]! - 4 * surface[k]!;
                // Bare rock creeps less than soil: diffusion fades towards the alpine factor in high cells.
                const rock = window.alpine ? 1 - window.alpine.weight[k]! * (1 - recipe.alpine.diffusion) : 1;
                height[k] = Math.max(0, surface[k]! + diffusion * rock * weight[k]! * laplacian);
            }
    }
    relaxMountainSlopes(
        plane,
        height,
        weight,
        locked,
        recipe.maximumGrade,
        recipe.relaxationSteps,
        area,
        window.alpine,
    );
    return height;
}
