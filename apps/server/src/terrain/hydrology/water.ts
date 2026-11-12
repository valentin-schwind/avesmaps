import { cellX, cellY, MAP_EXTENT, planeOf, SEA, LAKE, type Grid, type Plane } from "./grid.ts";

/**
 * Wasser und Küste des visuellen Reliefs (WI-0054).
 *
 * Wasser sind dieselben Flächen wie im Routing (`routing/water.ts`): aktive `region_area` mit
 * `region_type` `meer` oder `see`, nicht `kueste`, keine Basemap-Pixel. Löcher einer Meerfläche
 * (Inseln) bleiben Land: gerade-ungerade je Fläche, die Flächen vereinigt.
 */

type Position = [number, number];

/** Eine Fläche als GeoJSON (Polygon oder MultiPolygon) in Karteneinheiten. */
export interface AreaGeometry {
    type: string;
    coordinates?: unknown;
}

export interface WaterArea {
    kind: "meer" | "see";
    geometry: AreaGeometry;
}

function ringsOf(geometry: AreaGeometry): Position[][] {
    if (geometry.type === "Polygon") return geometry.coordinates as Position[][];
    if (geometry.type === "MultiPolygon") return (geometry.coordinates as Position[][][]).flat();
    return [];
}

/** Alle Kanten aller Ringe, je vier Zahlen: x1, y1, x2, y2. */
function edgesOf(geometry: AreaGeometry): number[] {
    const edges: number[] = [];
    for (const ring of ringsOf(geometry)) {
        for (let i = 0; i + 1 < ring.length; i += 1) {
            const [ax, ay] = ring[i] as Position;
            const [bx, by] = ring[i + 1] as Position;
            edges.push(ax, ay, bx, by);
        }
    }
    return edges;
}

/**
 * Ruft `visit` für jede Zelle, deren Mitte in der Fläche liegt: gerade-ungerade über alle Ringe, ein
 * Loch bleibt also draußen.
 */
export function fillArea(g: Grid, geometry: AreaGeometry, visit: (k: number) => void): void {
    fillWindow(g, planeOf(g), geometry, visit);
}

/**
 * Wie `fillArea`, aber nur für die Zellen des Fensters `window`; `visit` bekommt den Index im Fenster.
 * Dieselbe Mittelpunktsregel, also genau dieselben Zellen wie auf der ganzen Karte.
 */
export function fillWindow(g: Grid, window: Plane, geometry: AreaGeometry, visit: (k: number) => void): void {
    const { cell } = g;
    const crossings: number[] = [];
    const edges = edgesOf(geometry);
    let low = Infinity;
    let high = -Infinity;
    for (let e = 0; e < edges.length; e += 4) {
        low = Math.min(low, edges[e + 1] as number, edges[e + 3] as number);
        high = Math.max(high, edges[e + 1] as number, edges[e + 3] as number);
    }
    const firstRow = Math.max(window.y0, Math.floor((MAP_EXTENT - high) / cell - 0.5));
    const lastRow = Math.min(window.y0 + window.height - 1, Math.ceil((MAP_EXTENT - low) / cell - 0.5));
    const firstColumn = window.x0;
    const lastColumn = window.x0 + window.width - 1;
    for (let gy = firstRow; gy <= lastRow; gy += 1) {
        const y = cellY(g, gy);
        crossings.length = 0;
        for (let e = 0; e < edges.length; e += 4) {
            const ay = edges[e + 1] as number;
            const by = edges[e + 3] as number;
            // Halboffen, damit ein Eckpunkt nur einmal zählt.
            if (ay > y === by > y) continue;
            const ax = edges[e] as number;
            const bx = edges[e + 2] as number;
            crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
            const from = Math.max(firstColumn, Math.ceil((crossings[i] as number) / cell - 0.5));
            const to = Math.min(lastColumn, Math.floor((crossings[i + 1] as number) / cell - 0.5 - 1e-9));
            const row = (gy - window.y0) * window.width - window.x0;
            for (let gx = from; gx <= to; gx += 1) visit(row + gx);
        }
    }
}

/**
 * Setzt `SEA` bzw. `LAKE` in `classes` für jede Zelle, deren Mitte im Wasser liegt. Meer gewinnt gegen
 * See, wo sich beide überlappen.
 */
export function rasterizeWater(g: Grid, areas: readonly WaterArea[], classes: Uint8Array): void {
    for (const area of areas) {
        const bit = area.kind === "see" ? LAKE : SEA;
        fillArea(g, area.geometry, (k) => {
            const current = classes[k] as number;
            if (current & SEA) return;
            classes[k] = bit === SEA ? (current & ~LAKE) | SEA : current | LAKE;
        });
    }
}

/** Quadrierter Abstand in einer Zeile (Felzenszwalb & Huttenlocher 2012). */
function transformLine(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q += 1) {
        const fq = (f[q] as number) + q * q;
        let s = (fq - ((f[v[k] as number] as number) + (v[k] as number) ** 2)) / (2 * q - 2 * (v[k] as number));
        while (s <= (z[k] as number)) {
            k -= 1;
            const p = v[k] as number;
            s = (fq - ((f[p] as number) + p * p)) / (2 * q - 2 * p);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
        while ((z[k + 1] as number) < q) k += 1;
        const p = v[k] as number;
        d[q] = (q - p) * (q - p) + (f[p] as number);
    }
}

/**
 * Euklidischer Abstand in Zellen zur nächsten Zelle mit `target`, geschrieben nach `out`. Ohne ein
 * zweites N²-Feld: erst die Spalten, dann die Zeilen, beide an Ort und Stelle. Auf einem Fenster zählt
 * nur, was im Fenster liegt.
 */
export function distanceTransform(g: Grid | Plane, target: (k: number) => boolean, out: Float32Array): void {
    const { width, height } = planeOf(g);
    const BIG = 1e12;
    const size = Math.max(width, height);
    const f = new Float64Array(size);
    const d = new Float64Array(size);
    const v = new Int32Array(size);
    const z = new Float64Array(size + 1);
    for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) f[y] = target(y * width + x) ? 0 : BIG;
        transformLine(f, height, d, v, z);
        for (let y = 0; y < height; y += 1) out[y * width + x] = d[y] as number;
    }
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) f[x] = out[y * width + x] as number;
        transformLine(f, width, d, v, z);
        for (let x = 0; x < width; x += 1) out[y * width + x] = Math.sqrt(d[x] as number);
    }
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Abstand jeder Landzelle zur Meeresküste in Karteneinheiten, nach `out` (Meer 0). Nahe der Küste
 * exakt zu den Kanten der Meerflächen, damit das Relief dort glatt ausläuft statt in Rastertreppen;
 * weiter drinnen genügt die Abstandstransformation.
 */
export function coastDistance(g: Grid, classes: Uint8Array, seas: readonly WaterArea[], out: Float32Array): void {
    const { n, cell } = g;
    distanceTransform(g, (k) => ((classes[k] as number) & SEA) !== 0, out);
    const BAND = 4;
    const BUCKET = 4;
    const buckets = new Map<number, number[]>();
    const edges: number[] = [];
    const perRow = Math.ceil(MAP_EXTENT / BUCKET) + 1;
    for (const area of seas) {
        const own = edgesOf(area.geometry);
        for (let e = 0; e < own.length; e += 4) {
            const id = edges.length / 4;
            const ax = own[e] as number;
            const ay = own[e + 1] as number;
            const bx = own[e + 2] as number;
            const by = own[e + 3] as number;
            edges.push(ax, ay, bx, by);
            for (let yy = Math.floor(Math.min(ay, by) / BUCKET); yy <= Math.floor(Math.max(ay, by) / BUCKET); yy += 1) {
                for (
                    let xx = Math.floor(Math.min(ax, bx) / BUCKET);
                    xx <= Math.floor(Math.max(ax, bx) / BUCKET);
                    xx += 1
                ) {
                    const key = yy * perRow + xx;
                    const list = buckets.get(key);
                    if (list) list.push(id);
                    else buckets.set(key, [id]);
                }
            }
        }
    }
    for (let gy = 0; gy < n; gy += 1) {
        for (let gx = 0; gx < n; gx += 1) {
            const k = gy * n + gx;
            if ((classes[k] as number) & SEA) {
                out[k] = 0;
                continue;
            }
            const cells = out[k] as number;
            if (cells > BAND) {
                out[k] = (cells - 0.5) * cell;
                continue;
            }
            const px = cellX(g, gx);
            const py = cellY(g, gy);
            const reach = (cells + 1) * cell;
            let best = Infinity;
            for (let yy = Math.floor((py - reach) / BUCKET); yy <= Math.floor((py + reach) / BUCKET); yy += 1) {
                for (let xx = Math.floor((px - reach) / BUCKET); xx <= Math.floor((px + reach) / BUCKET); xx += 1) {
                    for (const id of buckets.get(yy * perRow + xx) ?? []) {
                        const e = id * 4;
                        const d = segmentDistance(
                            px,
                            py,
                            edges[e] as number,
                            edges[e + 1] as number,
                            edges[e + 2] as number,
                            edges[e + 3] as number,
                        );
                        if (d < best) best = d;
                    }
                }
            }
            out[k] = Number.isFinite(best) ? best : (cells - 0.5) * cell;
        }
    }
}
