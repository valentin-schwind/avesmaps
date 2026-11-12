import { grid, MAP_EXTENT, SEA, type Grid } from "./grid.ts";
import { fillArea, type AreaGeometry } from "./water.ts";

/**
 * Die Stärke des Reliefs je Landschaftsart (WI-0054 Blatt 3, Generator 3, Betreiber 2026-09-28: „Wüsten und Ebenen sehr
 * flach, Hügelland hügelig, das Spektrum definierst du; die Übergänge nicht so scharf, sie gehen
 * ineinander über“).
 *
 * Ein Faktor je Zelle auf dem groben Gitter. Er skaliert die Hebung U und die Tiefe der Täler, also die
 * Steigung und damit die Schattierung. 1 ist das abgenommene Bild von Generator 2.
 *
 * Welche Art gilt, wo sich Flächen überlagern:
 * 1. eine Landform der Topographie (Hügelland, Tiefebene, Tal …);
 * 2. sonst die Vegetation (Wüste, Wald, Steppe …);
 * 3. sonst eine Insel;
 * 4. sonst der Rückfall.
 * Innerhalb einer Stufe gewinnt die kleinere Fläche: Ein Tal im Hügelland ist ein Tal.
 *
 * Der Übergang ist eine normierte Faltung nur über Land: dreimal ein Kastenfilter (≈ Gauß). Das Meer
 * zieht an der Küste nichts herunter.
 */

export interface LandscapeArea {
    layer: "topographie" | "vegetation";
    type: string;
    /** Fläche in E², nur für die Reihenfolge. */
    area: number;
    geometry: AreaGeometry;
}

/** Bilinear an den Zellmitten; damit bleiben grobe Landschaftsübergänge im feinen Raster glatt. */
export function sampleLandscape(field: { m: number; values: Float32Array }, n: number, x: number, y: number): number {
    const u = Math.max(0, Math.min(field.m - 1, ((x + 0.5) * field.m) / n - 0.5));
    const v = Math.max(0, Math.min(field.m - 1, ((y + 0.5) * field.m) / n - 0.5));
    const i = Math.min(field.m - 2, Math.floor(u));
    const j = Math.min(field.m - 2, Math.floor(v));
    const tx = u - i;
    const ty = v - j;
    const k = j * field.m + i;
    const south = (field.values[k] as number) + ((field.values[k + 1] as number) - (field.values[k] as number)) * tx;
    const north =
        (field.values[k + field.m] as number) +
        ((field.values[k + field.m + 1] as number) - (field.values[k + field.m] as number)) * tx;
    return south + (north - south) * ty;
}

/**
 * `sampleLandscape` für viele Abfragen auf demselben feinen Gitter (WI-0067 Laufzeit): Spalten- und
 * Zeilenanteil stehen einmal je Gitterlinie in einer Tafel, gerechnet mit denselben Ausdrücken. Die
 * Werte sind deshalb bitgleich zu `sampleLandscape`.
 */
export function landscapeSampler(m: number, n: number): (values: Float32Array, x: number, y: number) => number {
    const base = new Int32Array(n);
    const fraction = new Float64Array(n);
    for (let x = 0; x < n; x += 1) {
        const u = Math.max(0, Math.min(m - 1, ((x + 0.5) * m) / n - 0.5));
        base[x] = Math.min(m - 2, Math.floor(u));
        fraction[x] = u - (base[x] as number);
    }
    return (values, x, y) => {
        const tx = fraction[x] as number;
        const ty = fraction[y] as number;
        const k = (base[y] as number) * m + (base[x] as number);
        const south = (values[k] as number) + ((values[k + 1] as number) - (values[k] as number)) * tx;
        const north = (values[k + m] as number) + ((values[k + m + 1] as number) - (values[k + m] as number)) * tx;
        return south + (north - south) * ty;
    };
}

/** Sagt über die Landform nichts: eine Insel kann flach oder bergig sein. */
const WEAK_TOPOGRAPHY: ReadonlySet<string> = new Set(["insel"]);

function rank(area: LandscapeArea): number {
    if (area.layer === "vegetation") return 2;
    return WEAK_TOPOGRAPHY.has(area.type) ? 1 : 3;
}

/** Die Flächen in der Reihenfolge, in der sie gemalt werden: Die spätere überschreibt. */
export function paintOrder(areas: readonly LandscapeArea[]): LandscapeArea[] {
    return areas
        .map((area, index) => ({ area, index }))
        .sort((a, b) => rank(a.area) - rank(b.area) || b.area.area - a.area.area || a.index - b.index)
        .map((entry) => entry.area);
}

/** Ein gleitendes Mittel mit Radius `r` über eine Zeile oder Spalte (`stride`), Ränder abgeschnitten. */
function boxLine(src: Float32Array, dst: Float32Array, start: number, stride: number, m: number, r: number): void {
    let sum = 0;
    for (let i = 0; i < Math.min(r, m); i += 1) sum += src[start + i * stride] as number;
    for (let i = 0; i < m; i += 1) {
        if (i + r < m) sum += src[start + (i + r) * stride] as number;
        if (i - r - 1 >= 0) sum -= src[start + (i - r - 1) * stride] as number;
        dst[start + i * stride] = sum;
    }
}

function blur(values: Float32Array, spare: Float32Array, m: number, r: number): void {
    for (let pass = 0; pass < 3; pass += 1) {
        for (let y = 0; y < m; y += 1) boxLine(values, spare, y * m, 1, m, r);
        for (let x = 0; x < m; x += 1) boxLine(spare, values, x, m, m, r);
    }
}

/**
 * Das Faktorfeld auf dem groben Gitter (`m` ≤ 1024, 1 E je Zelle bei 4096²). `classes` ist das feine
 * Gitter; nur `SEA` wird gelesen.
 */
export function landscapeStrength(
    g: Grid,
    classes: Uint8Array,
    areas: readonly LandscapeArea[],
    params: { landscapeStrength: Readonly<Record<string, number>>; landscapeFallback: number; landscapeBlur: number },
    coarse = 1024,
): { m: number; values: Float32Array } {
    const m = Math.min(g.n, coarse);
    const f = g.n / m;
    const cg = grid(m);
    const factor = new Float32Array(m * m).fill(params.landscapeFallback);
    for (const area of paintOrder(areas)) {
        const value = params.landscapeStrength[area.type];
        if (value === undefined) continue;
        fillArea(cg, area.geometry, (k) => {
            factor[k] = value;
        });
    }
    // Gewicht: der Landanteil der groben Zelle.
    const weight = new Float32Array(m * m);
    for (let gy = 0; gy < g.n; gy += 1) {
        for (let gx = 0; gx < g.n; gx += 1) {
            if ((classes[gy * g.n + gx] as number) & SEA) continue;
            const k = Math.floor(gy / f) * m + Math.floor(gx / f);
            weight[k] = (weight[k] as number) + 1 / (f * f);
        }
    }
    for (let k = 0; k < factor.length; k += 1) factor[k] = (factor[k] as number) * (weight[k] as number);
    const r = Math.max(1, Math.round(params.landscapeBlur / (MAP_EXTENT / m)));
    const spare = new Float32Array(m * m);
    blur(factor, spare, m, r);
    blur(weight, spare, m, r);
    for (let k = 0; k < factor.length; k += 1) {
        const w = weight[k] as number;
        factor[k] = w > 1e-6 ? (factor[k] as number) / w : params.landscapeFallback;
    }
    return { m, values: factor };
}
