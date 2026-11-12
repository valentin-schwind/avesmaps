import { createHash } from "node:crypto";
import type { StoredRaster } from "../dem-tiles.ts";
import { accumulate, CellHeap, priorityFlood, receiverOf, rho8 } from "../hydrology/flow.ts";
import { DX, DY, LAKE, MAP_EXTENT, SCHRITT_PER_UNIT, SEA, type Grid, type Plane } from "../hydrology/grid.ts";
import { streamPowerHeight, fbm } from "@avesmaps3d/shared";
import type { TerrainRecipe } from "./recipes.ts";

/**
 * Feinstufe des Domain-Geländes in Kacheln (WI-0070, Betreiber 2026-10-03: „8x8 1k² maps“).
 *
 * Die grobe globale Stufe ist das abgenommene Domain-Gelände in der groben Auflösung: Maske, Grundform,
 * Gebirge, Flussnetz, Seespiegel und Gipfel. Die feine Stufe rechnet je Kachel (`tiles` × `tiles`) in voller
 * Auflösung auf einem Fenster mit `halo` Zellen Überlappung: weiche Interpolation der groben Höhe, Detail nach
 * der örtlichen Steigung, dann wenige Runden Abfluss, Einschneiden und Hangkriechen. Eine Kachel hängt nur
 * von der groben Stufe, der feinen Wassermaske und ortsfestem Zufall ab: Reihenfolge und Arbeiterzahl ändern
 * nichts. Nachbarn werden über `blend` Zellen je Seite weich verblendet (Zerlegung der Eins), ihre Summe
 * schreibt der Aufrufer in fester Kachelfolge.
 */

export type FineRecipe = NonNullable<TerrainRecipe["generator"]["fine"]>;

/** A tile's position and its computation window, all in fine grid cells (row 0 north). */
export interface FineTile {
    tx: number;
    ty: number;
    /** Core: the cells this tile owns. */
    c0: number;
    r0: number;
    size: number;
    /** Window = core plus halo, clipped to the map. */
    window: Plane;
}

export function fineTiles(n: number, recipe: FineRecipe, cell: number): FineTile[] {
    const size = n / recipe.tiles;
    const tiles: FineTile[] = [];
    for (let ty = 0; ty < recipe.tiles; ty += 1)
        for (let tx = 0; tx < recipe.tiles; tx += 1) {
            const c0 = tx * size,
                r0 = ty * size;
            const x0 = Math.max(0, c0 - recipe.halo),
                y0 = Math.max(0, r0 - recipe.halo);
            const x1 = Math.min(n, c0 + size + recipe.halo),
                y1 = Math.min(n, r0 + size + recipe.halo);
            tiles.push({ tx, ty, c0, r0, size, window: { width: x1 - x0, height: y1 - y0, cell, x0, y0 } });
        }
    return tiles;
}

/** Catmull-Rom interpolation of the coarse height (stored orientation), clamped to its 4×4 neighbourhood. */
export function coarseHeight(coarse: StoredRaster, x: number, y: number): number {
    const u = (x - coarse.originX) / coarse.cell,
        v = (y - coarse.originY) / coarse.cell;
    const i = Math.floor(u),
        j = Math.floor(v);
    const fu = u - i,
        fv = v - j;
    const weights = (t: number): [number, number, number, number] => {
        const t2 = t * t,
            t3 = t2 * t;
        return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
    };
    const wu = weights(fu),
        wv = weights(fv);
    let sum = 0,
        low = Infinity,
        high = -Infinity;
    for (let b = 0; b < 4; b += 1) {
        const jj = Math.max(0, Math.min(coarse.height - 1, j - 1 + b));
        let row = 0;
        for (let a = 0; a < 4; a += 1) {
            const ii = Math.max(0, Math.min(coarse.width - 1, i - 1 + a));
            const h = coarse.samples[jj * coarse.width + ii]!;
            row += wu[a]! * h;
            if (a === 1 || a === 2)
                if (b === 1 || b === 2) {
                    low = Math.min(low, h);
                    high = Math.max(high, h);
                }
        }
        sum += wv[b]! * row;
    }
    // Clamped to the four nearest samples: no new extremes, no ringing at coasts, lakes or summits.
    return Math.max(low, Math.min(high, sum));
}

/** Partition-of-unity weight along one axis: neighbouring tiles cross-fade over `blend` cells per side. */
function axisWeight(c: number, start: number, end: number, n: number, blend: number): number {
    const ramp = (s: number) => {
        const t = Math.max(0, Math.min(1, s));
        return t * t * (3 - 2 * t);
    };
    let w = 1;
    if (start > 0) w *= ramp((c - (start - blend) + 0.5) / (2 * blend));
    if (end < n) w *= 1 - ramp((c - (end - blend) + 0.5) / (2 * blend));
    return w;
}

export interface FineScratch {
    heap: CellHeap;
}

/**
 * Refine one tile. `classes` holds SEA/LAKE of the whole fine grid (row 0 north). Returns the window heights
 * already multiplied by the tile's blend weight, and the weight's support box inside the window.
 */
export function refineTile(
    g: Grid,
    tile: FineTile,
    coarse: StoredRaster,
    classes: Uint8Array,
    recipe: FineRecipe,
    seed: number,
    scratch: FineScratch,
): Float32Array {
    const { window: w } = tile;
    const size = w.width * w.height;
    const height = new Float32Array(size);
    const local = new Uint8Array(size);
    const cell = g.cell;
    // 1. Smooth coarse height and its water classes.
    for (let y = 0; y < w.height; y += 1)
        for (let x = 0; x < w.width; x += 1) {
            const k = y * w.width + x;
            const gk = (w.y0 + y) * g.n + w.x0 + x;
            local[k] = classes[gk]! & (SEA | LAKE);
            if (local[k]! & SEA) continue;
            const mx = (w.x0 + x + 0.5) * cell,
                my = MAP_EXTENT - (w.y0 + y + 0.5) * cell;
            height[k] = coarseHeight(coarse, mx, my);
        }
    // 2. Detail by local steepness: flat land stays calm, slopes get rills and spurs to erode.
    const { detail, erosion } = recipe;
    const base = height.slice();
    for (let y = 1; y < w.height - 1; y += 1)
        for (let x = 1; x < w.width - 1; x += 1) {
            const k = y * w.width + x;
            if (local[k]) continue;
            const gx = (base[k + 1]! - base[k - 1]!) / (2 * cell * SCHRITT_PER_UNIT);
            const gy = (base[k + w.width]! - base[k - w.width]!) / (2 * cell * SCHRITT_PER_UNIT);
            const steep = Math.min(1, Math.hypot(gx, gy) / detail.relief);
            if (!(steep > 0)) continue;
            const mx = (w.x0 + x + 0.5) * cell,
                my = MAP_EXTENT - (w.y0 + y + 0.5) * cell;
            const noise = fbm(seed + 80101, mx, my, detail.wavelength, detail.octaves, detail.persistence);
            height[k] = Math.max(1, height[k]! + detail.amplitude * steep * noise);
        }
    // 3. A few rounds of flow, incision and creep; window edges and the sea are open outlets, lakes fixed.
    if (erosion.iterations > 0) {
        const surface = new Float32Array(size);
        const order = new Int32Array(size);
        const area = new Float32Array(size);
        const flow = new Uint8Array(size);
        const next = new Float32Array(size);
        for (let round = 0; round < erosion.iterations; round += 1) {
            surface.set(height);
            flow.set(local);
            const count = priorityFlood(w, surface, flow, erosion.fill, order, scratch.heap, [], seed + 80111);
            rho8(w, surface, flow, seed + 80113 + round);
            accumulate(w, order, count, flow, area);
            for (let i = 0; i < count; i += 1) {
                const k = order[i]!;
                if (local[k]) continue;
                const r = receiverOf(w, k, flow);
                if (r < 0) continue;
                const diagonal = k % w.width !== r % w.width && Math.floor(k / w.width) !== Math.floor(r / w.width);
                const distance = (diagonal ? Math.SQRT2 : 1) * cell;
                height[k] = streamPowerHeight(
                    height[k]!,
                    height[r]!,
                    area[k]!,
                    erosion.streamPowerK,
                    erosion.exponent,
                    1,
                    distance,
                );
            }
            next.set(height);
            for (let y = 1; y < w.height - 1; y += 1)
                for (let x = 1; x < w.width - 1; x += 1) {
                    const k = y * w.width + x;
                    if (local[k]) continue;
                    let sum = 0,
                        count4 = 0;
                    for (let d = 0; d < 4; d += 1) {
                        const nk = (y + DY[d]!) * w.width + x + DX[d]!;
                        if (local[nk]! & SEA) continue;
                        sum += height[nk]!;
                        count4 += 1;
                    }
                    if (count4 > 0) next[k] = height[k]! + erosion.diffusion * (sum / count4 - height[k]!);
                }
            height.set(next);
        }
    }
    // 4. Never far from the coarse form; weight for the cross-fade.
    for (let y = 0; y < w.height; y += 1) {
        const wy = axisWeight(w.y0 + y, tile.r0, tile.r0 + tile.size, g.n, recipe.blend);
        for (let x = 0; x < w.width; x += 1) {
            const k = y * w.width + x;
            if (local[k]! & SEA) {
                height[k] = 0;
                continue;
            }
            const limited = Math.max(
                base[k]! - erosion.maximumChange,
                Math.min(base[k]! + erosion.maximumChange, height[k]!),
            );
            height[k] = limited * wy * axisWeight(w.x0 + x, tile.c0, tile.c0 + tile.size, g.n, recipe.blend);
        }
    }
    return height;
}

/**
 * Last fine composition before the global constraints (grid orientation, sea 0, land at least 1) with the
 * fingerprint of every tile's inputs. A later run recomputes only the tiles whose inputs changed and their
 * neighbours, and gets the same bytes as a full run (WI-0070, „kachelweise Änderungen“).
 */
export interface FineCache {
    size: number;
    fingerprints: string[];
    composite: Uint16Array;
}

/** What a tile reads: the coarse samples under its window (with the interpolation margin) and its water. */
export function tileFingerprints(
    coarse: StoredRaster,
    g: Grid,
    classes: Uint8Array,
    recipe: FineRecipe,
    seed: number,
    version: string,
): string[] {
    const head = JSON.stringify({ recipe, seed, version, coarse: [coarse.width, coarse.cell, coarse.originX] });
    return fineTiles(g.n, recipe, g.cell).map((tile) => {
        const w = tile.window;
        const hash = createHash("sha256").update(head);
        // Window in map units → coarse columns and rows (stored orientation), two cells of margin.
        const x0 = w.x0 * g.cell,
            x1 = (w.x0 + w.width) * g.cell;
        const y0 = MAP_EXTENT - (w.y0 + w.height) * g.cell,
            y1 = MAP_EXTENT - w.y0 * g.cell;
        const i0 = Math.max(0, Math.floor((x0 - coarse.originX) / coarse.cell) - 2),
            i1 = Math.min(coarse.width - 1, Math.ceil((x1 - coarse.originX) / coarse.cell) + 2);
        const j0 = Math.max(0, Math.floor((y0 - coarse.originY) / coarse.cell) - 2),
            j1 = Math.min(coarse.height - 1, Math.ceil((y1 - coarse.originY) / coarse.cell) + 2);
        for (let j = j0; j <= j1; j += 1) {
            const row = coarse.samples.subarray(j * coarse.width + i0, j * coarse.width + i1 + 1);
            hash.update(new Uint8Array(row.buffer, row.byteOffset, row.byteLength));
        }
        for (let y = 0; y < w.height; y += 1)
            hash.update(classes.subarray((w.y0 + y) * g.n + w.x0, (w.y0 + y) * g.n + w.x0 + w.width));
        return hash.digest("hex");
    });
}

/**
 * Compose the fine raster from its tiles, reusing an earlier composition where nothing changed. Tiles are
 * summed in their fixed order whatever is recomputed, so incremental and full runs agree byte for byte.
 */
export function composeFine(
    coarse: StoredRaster,
    g: Grid,
    classes: Uint8Array,
    recipe: FineRecipe,
    seed: number,
    version: string,
    cache?: FineCache,
    onTile?: (tile: FineTile, ms: number) => void,
): { cache: FineCache; computed: number } {
    const tiles = fineTiles(g.n, recipe, g.cell);
    const fingerprints = tileFingerprints(coarse, g, classes, recipe, seed, version);
    const usable = cache !== undefined && cache.size === g.n && cache.fingerprints.length === tiles.length;
    const dirty = tiles.map((_, i) => !usable || cache.fingerprints[i] !== fingerprints[i]);
    const per = recipe.tiles;
    // A dirty tile's cross-fade reaches into its neighbours: they are summed again too.
    const needed = tiles.map((tile) => {
        for (let dy = -1; dy <= 1; dy += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
                const tx = tile.tx + dx,
                    ty = tile.ty + dy;
                if (tx >= 0 && ty >= 0 && tx < per && ty < per && dirty[ty * per + tx]) return true;
            }
        return false;
    });
    const acc = new Float32Array(g.n * g.n);
    const largest = Math.max(...tiles.map((t) => t.window.width * t.window.height));
    const scratch: FineScratch = { heap: new CellHeap(largest) };
    let computed = 0;
    tiles.forEach((tile, i) => {
        if (!needed[i]) return;
        const start = performance.now();
        const part = refineTile(g, tile, coarse, classes, recipe, seed, scratch);
        computed += 1;
        const { window: w } = tile;
        for (let y = 0; y < w.height; y += 1) {
            const row = (w.y0 + y) * g.n + w.x0;
            for (let x = 0; x < w.width; x += 1) acc[row + x] = acc[row + x]! + part[y * w.width + x]!;
        }
        onTile?.(tile, performance.now() - start);
    });
    const composite = usable ? cache.composite.slice() : new Uint16Array(g.n * g.n);
    // Recompose the cells a dirty tile's weight reaches: there every contributor was summed above.
    tiles.forEach((tile, i) => {
        if (!dirty[i]) return;
        const c0 = Math.max(0, tile.c0 - recipe.blend),
            c1 = Math.min(g.n, tile.c0 + tile.size + recipe.blend);
        const r0 = Math.max(0, tile.r0 - recipe.blend),
            r1 = Math.min(g.n, tile.r0 + tile.size + recipe.blend);
        for (let y = r0; y < r1; y += 1)
            for (let x = c0; x < c1; x += 1) {
                const k = y * g.n + x;
                composite[k] = classes[k]! & SEA ? 0 : Math.max(1, Math.min(65535, Math.round(acc[k]!)));
            }
    });
    return { cache: { size: g.n, fingerprints, composite }, computed };
}
