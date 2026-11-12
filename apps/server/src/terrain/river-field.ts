import { DEM_MAX_ZOOM, DEM_TILE_SIZE, type StoredRaster } from "./dem-tiles.ts";
import { coneHeightAt, coneRadius, freePeakHeight, type ConeRule, type FreePeak } from "./peak-cone.ts";
import type { RiverNetwork, RiverRun } from "./river-network.ts";

/**
 * Die Gebirgsraster beim Einbrennen (WI-0049 S6): lesen wie Routing und Kacheln, und senken.
 *
 * - `rasterHeight` liest wie das Routing (`reliefAt`): bilinear, eingeklemmt, das Maximum über die Raster.
 * - `demHeight` liest wie die Karte in 3D: dieselben Raster auf dem Gitter der Höhenkacheln (z3, `composeDem`),
 *   dort noch einmal bilinear.
 * - Gesenkt wird nur auf ganze Schritt, nie eine gesperrte Zelle (Gipfel im Gebirge).
 */

/**
 * So viel darf ein Lauf über einer früheren Stelle liegen: ein Schritt, die Auflösung der Raster. 🪤 Ohne
 * sie kriecht das Nachschneiden, wo ein Mäander dieselben Zellen zweimal liest: Das Senken flussab zieht
 * die Lesung flussauf um einen Bruchteil herab, und die nächste Runde senkt wieder einen ganzen Schritt
 * (gemessen: 181 Runden an der Weißwasser, statt 3).
 */
export const RISE_TOLERANCE = 1;

export const EPS = 1e-6;

const BUCKET = 16;

export interface FieldRaster extends StoredRaster {
    readOnly?: boolean;
    maxX: number;
    maxY: number;
    /** Zellen, die nie sinken: die vier um jeden Gipfel im Gebirge. */
    locked: Set<number>;
}

/** Die Gebirgsraster mit einem groben Eimergitter: Welche Raster liegen an einer Stelle? */
export interface Field {
    rasters: FieldRaster[];
    buckets: Map<number, number[]>;
}

/** Ein Gipfel im Gebirge: Seine Höhe ist Legacys Zahl und bleibt (`verify:terrain-dem`, Gipfel lesen ihre Höhe). */
export interface RiverAnchor {
    x: number;
    y: number;
}

/**
 * 🔴 Die Gipfel bleiben stehen. Gesperrt sind genau die vier Zellen, aus denen ein Gipfel seine Höhe liest
 * (wie `verify:terrain-dem`); so hält es auch V12, dessen Täler keinen Gipfelkern abtragen (`build.ts`).
 * Ohne Sperre trug ein Graben das Wallspitzhorn (5.000 Schritt, 0,3 E neben dem Sinop) auf 834 ab.
 */
function lockedCells(r: StoredRaster, anchors: readonly RiverAnchor[]): Set<number> {
    const locked = new Set<number>();
    for (const { x, y } of anchors) {
        const i = Math.floor((x - r.originX) / r.cell);
        const j = Math.floor((y - r.originY) / r.cell);
        for (const [di, dj] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ] as const) {
            if (i + di >= 0 && j + dj >= 0 && i + di < r.width && j + dj < r.height) {
                locked.add((j + dj) * r.width + i + di);
            }
        }
    }
    return locked;
}

export function fieldOf(
    rasters: readonly StoredRaster[],
    anchors: readonly RiverAnchor[] = [],
    readOnly: ReadonlySet<StoredRaster> = new Set(),
    /** Weitere Zellen des ersten Rasters, die nie sinken (die Seezellen fester Seen der Domain). */
    protectedCells?: ReadonlySet<number>,
): Field {
    const list = rasters.map((r, index) => {
        const locked = lockedCells(r, anchors);
        if (index === 0 && protectedCells) for (const k of protectedCells) locked.add(k);
        return {
            ...r,
            maxX: r.originX + (r.width - 1) * r.cell,
            maxY: r.originY + (r.height - 1) * r.cell,
            locked,
            readOnly: readOnly.has(r),
        };
    });
    const buckets = new Map<number, number[]>();
    list.forEach((r, index) => {
        for (let bx = Math.floor(r.originX / BUCKET); bx <= Math.floor(r.maxX / BUCKET); bx += 1) {
            for (let by = Math.floor(r.originY / BUCKET); by <= Math.floor(r.maxY / BUCKET); by += 1) {
                const key = bx * 4096 + by;
                buckets.set(key, [...(buckets.get(key) ?? []), index]);
            }
        }
    });
    return { rasters: list, buckets };
}

const bucketOf = (field: Field, x: number, y: number): readonly number[] =>
    field.buckets.get(Math.floor(x / BUCKET) * 4096 + Math.floor(y / BUCKET)) ?? [];

/** Die vier Zellen und Gewichte des bilinearen Lesens, eingeklemmt wie `reliefAt` (routing/relief.ts). */
function corners(r: FieldRaster, x: number, y: number): [number, number, number, number, number, number] {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    const i = Math.min(Math.max(0, Math.floor(fx)), Math.max(0, r.width - 2));
    const j = Math.min(Math.max(0, Math.floor(fy)), Math.max(0, r.height - 2));
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    return [j * r.width + i, j * r.width + right, up * r.width + i, up * r.width + right, tx, ty];
}

/** Dasselbe wie über `corners`, aber ohne ein Feld je Aufruf: Es läuft für jeden Abtastpunkt jeder Runde. */
function bilinear(r: FieldRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    const i = Math.min(Math.max(0, Math.floor(fx)), Math.max(0, r.width - 2));
    const j = Math.min(Math.max(0, Math.floor(fy)), Math.max(0, r.height - 2));
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    const s = r.samples;
    return (
        (s[j * r.width + i] as number) * (1 - tx) * (1 - ty) +
        (s[j * r.width + right] as number) * tx * (1 - ty) +
        (s[up * r.width + i] as number) * (1 - tx) * ty +
        (s[up * r.width + right] as number) * tx * ty
    );
}

const inside = (r: FieldRaster, x: number, y: number): boolean =>
    x >= r.originX && y >= r.originY && x <= r.maxX && y <= r.maxY;

/** Die Höhe der Gebirge an einer Stelle: das Maximum über die Raster, sonst 0 (wie Routing und Kacheln). */
export function rasterHeight(field: Field, x: number, y: number): number {
    let best = 0;
    for (const index of bucketOf(field, x, y)) {
        const r = field.rasters[index] as FieldRaster;
        if (!inside(r, x, y)) continue;
        const value = bilinear(r, x, y);
        if (value > best) best = value;
    }
    return best;
}

/**
 * Setzt die vier Zellen jedes Rasters, das hier liest, auf die ganze Zahl `value` und sperrt sie (WI-0249: eigene Höhe an einem Fluss, Fassung 19).
 * Danach liest die Stelle genau `value`, und kein Einschneiden senkt sie. Gibt die geänderten Zellen.
 */
export function setzeAt(field: Field, x: number, y: number, value: number): number {
    const target = Math.max(0, Math.min(65535, Math.round(value)));
    let changed = 0;
    for (const index of bucketOf(field, x, y)) {
        const r = field.rasters[index] as FieldRaster;
        if (r.readOnly || !inside(r, x, y)) continue;
        const [a, b, c, d] = corners(r, x, y);
        for (const k of [a, b, c, d]) {
            if (r.samples[k] !== target) {
                r.samples[k] = target;
                changed += 1;
            }
            r.locked.add(k);
        }
    }
    return changed;
}

/** Senkt die vier Zellen jedes Rasters, das hier höher als `limit` liest, auf die ganze Zahl darunter. */
export function lowerAt(field: Field, x: number, y: number, limit: number): number {
    const target = Math.max(0, Math.floor(limit + EPS));
    let changed = 0;
    for (const index of bucketOf(field, x, y)) {
        const r = field.rasters[index] as FieldRaster;
        if (r.readOnly || !inside(r, x, y) || bilinear(r, x, y) <= limit + EPS) continue;
        const [a, b, c, d] = corners(r, x, y);
        for (const k of [a, b, c, d]) {
            if ((r.samples[k] as number) > target && !r.locked.has(k)) {
                r.samples[k] = target;
                changed += 1;
            }
        }
    }
    return changed;
}

export function conesAt(peaks: readonly FreePeak[], rule: ConeRule, x: number, y: number): number {
    let best = 0;
    for (const peak of peaks) {
        const radius = coneRadius(freePeakHeight(peak), rule);
        if (Math.abs(x - peak.x) >= radius || Math.abs(y - peak.y) >= radius) continue;
        best = Math.max(best, coneHeightAt(peak, x, y, rule));
    }
    return best;
}

const DEM_SIZE = DEM_TILE_SIZE << DEM_MAX_ZOOM;

export const DEM_CELL = 1024 / DEM_SIZE;

/**
 * Die vier Punkte des Kachelgitters (z3, 4.096², Zeile 0 im Norden) um eine Stelle, mit Gewicht: So liest die
 * Karte die Höhenkacheln. Ein Punkt des Gitters trägt, was `composeDem` dort schreibt.
 */
function demCorners(x: number, y: number): [number, number, number][] {
    const fx = x / DEM_CELL - 0.5;
    const fy = (1024 - y) / DEM_CELL - 0.5;
    const i = Math.min(Math.max(0, Math.floor(fx)), DEM_SIZE - 2);
    const j = Math.min(Math.max(0, Math.floor(fy)), DEM_SIZE - 2);
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const at = (gi: number, gj: number, w: number): [number, number, number] => [
        (gi + 0.5) * DEM_CELL,
        1024 - (gj + 0.5) * DEM_CELL,
        w,
    ];
    return [
        at(i, j, (1 - tx) * (1 - ty)),
        at(i + 1, j, tx * (1 - ty)),
        at(i, j + 1, (1 - tx) * ty),
        at(i + 1, j + 1, tx * ty),
    ];
}

/**
 * Die Höhe der Gebirge, wie die Höhenkacheln sie an einer Stelle zeigen: bilinear über ihr Gitter. Ohne die
 * freien Gipfel; die schneidet das Einbrennen nicht (`coneRises`). Ohne Feld je Aufruf wie `demCorners`.
 */
export function demHeight(field: Field, x: number, y: number): number {
    const fx = x / DEM_CELL - 0.5;
    const fy = (1024 - y) / DEM_CELL - 0.5;
    const i = Math.min(Math.max(0, Math.floor(fx)), DEM_SIZE - 2);
    const j = Math.min(Math.max(0, Math.floor(fy)), DEM_SIZE - 2);
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const x0 = (i + 0.5) * DEM_CELL;
    const x1 = x0 + DEM_CELL;
    const y0 = 1024 - (j + 0.5) * DEM_CELL;
    const y1 = y0 - DEM_CELL;
    let sum = 0;
    if (tx < 1 && ty < 1) sum += (1 - tx) * (1 - ty) * rasterHeight(field, x0, y0);
    if (tx > 0 && ty < 1) sum += tx * (1 - ty) * rasterHeight(field, x1, y0);
    if (tx < 1 && ty > 0) sum += (1 - tx) * ty * rasterHeight(field, x0, y1);
    if (tx > 0 && ty > 0) sum += tx * ty * rasterHeight(field, x1, y1);
    return sum;
}

/** Senkt die Raster unter den vier Gitterpunkten um eine Stelle auf `limit`. */
export function lowerDemAt(field: Field, x: number, y: number, limit: number): number {
    let changed = 0;
    for (const [gx, gy, w] of demCorners(x, y)) {
        if (w > 0 && rasterHeight(field, gx, gy) > limit + EPS) changed += lowerAt(field, gx, gy, limit);
    }
    // Ein fester Berghang kann eine Ecke über dem Bett halten. Dann trägt die gegenüberliegende
    // Sockelecke zur Überhöhung der bilinearen Kachel bei, obwohl sie selbst unter dem Bett liegt.
    if (field.rasters.some((r) => r.readOnly)) {
        for (const [gx, gy, w] of demCorners(x, y)) {
            const excess = demHeight(field, x, y) - limit;
            if (w <= 0 || excess <= RISE_TOLERANCE) continue;
            let fixed = 0;
            let mutable = 0;
            for (const index of bucketOf(field, gx, gy)) {
                const r = field.rasters[index] as FieldRaster;
                if (!inside(r, gx, gy)) continue;
                const value = bilinear(r, gx, gy);
                if (r.readOnly) fixed = Math.max(fixed, value);
                else mutable = Math.max(mutable, value);
            }
            if (mutable > fixed) changed += lowerAt(field, gx, gy, Math.max(fixed, mutable - excess / w));
        }
    }
    return changed;
}

/**
 * Berührt der Lauf überhaupt ein Raster, samt dem Rand, den die Kacheln noch lesen? Sonst ist er überall 0 und
 * muss nicht gelesen werden.
 */
export function touchesField(field: Field, run: RiverRun): boolean {
    const margin = 2 * DEM_CELL;
    return field.rasters.some((r) => {
        for (let i = 0; i < run.xs.length; i += 1) {
            const x = run.xs[i] as number;
            const y = run.ys[i] as number;
            if (x >= r.originX - margin && x <= r.maxX + margin && y >= r.originY - margin && y <= r.maxY + margin) {
                return true;
            }
        }
        return false;
    });
}

/** Je Lauf ein Feld seiner Punktzahl; einmal angelegt und in jeder Runde wieder beschrieben. */
export const buffersOf = (network: RiverNetwork): Float64Array[] =>
    network.runs.map((run) => new Float64Array(run.xs.length));

/**
 * Das Gelände je Abtastpunkt, nur für Läufe am Gebirge; die übrigen bleiben 0. So, wie die Raster es zeigen,
 * oder mit `tiles` so, wie die Höhenkacheln es zeigen. Schreibt in `into`.
 */
export function sampleRuns(
    field: Field,
    network: RiverNetwork,
    near: readonly boolean[],
    into: Float64Array[],
    tiles = false,
): Float64Array[] {
    network.runs.forEach((run, r) => {
        const heights = into[r] as Float64Array;
        if (!near[r]) {
            heights.fill(0);
            return;
        }
        for (let i = 0; i < heights.length; i += 1) {
            const x = run.xs[i] as number;
            const y = run.ys[i] as number;
            heights[i] = tiles ? demHeight(field, x, y) : rasterHeight(field, x, y);
        }
    });
    return into;
}
