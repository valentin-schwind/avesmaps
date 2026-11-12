/**
 * Das Gitter des visuellen Reliefs (WI-0054): N × N Zellen über den Kartenraum 0..1024 E, Zeile 0 im
 * NORDEN wie `composeDem`. Das Ziel ist 4096² (0,25 E, die Zelle des Geländes); kleinere Gitter dienen
 * nur der Messung.
 */

/** Kantenlänge des Kartenraums in Karteneinheiten. */
export const MAP_EXTENT = 1024;
/** Eine Karteneinheit sind 3.000 Schritt. */
export const SCHRITT_PER_UNIT = 3000;

/** Die acht Nachbarn: erst die geraden, dann die schrägen. Die Richtung einer Zelle ist ein Index hierhin. */
export const DX: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1];

/** Zellklassen als Bits in einem `Uint8Array` je Zelle. */
export const SEA = 1;
export const LAKE = 2;
export const MOUNTAIN = 4;
/** Hilfsbit: der Spiegel dieses Sees ist in der laufenden Runde schon gesetzt. */
export const LEVEL_SET = 8;
/**
 * Die oberen vier Bits tragen die Abflussrichtung (`flow.ts`), damit sie kein eigenes Feld braucht
 * (16 MB bei 4096²). Während des Priority-Flood steht dort stattdessen `FLOODED`.
 */
export const DIRECTION_SHIFT = 4;
export const DIRECTION_BITS = 0xf0;
/** Hilfsbit des Priority-Flood: die Zelle ist schon im Heap oder erledigt. Liegt in den Richtungsbits. */
export const FLOODED = 16;

export interface Grid {
    n: number;
    /** Zellweite in Karteneinheiten. */
    cell: number;
}

/**
 * Ein rechteckiges Fenster desselben Gitters (WI-0067): eigene Breite und Höhe, gleiche Zellweite. `x0`/`y0`
 * sind die Spalte und Zeile seiner ersten Zelle im ganzen Gitter; ortsfeste Zufallswerte rechnen damit, damit
 * ein Fenster dieselben Werte sieht wie die ganze Karte. Die ganze Karte ist das Fenster ab (0, 0).
 */
export interface Plane {
    width: number;
    height: number;
    cell: number;
    x0: number;
    y0: number;
}

export function planeOf(g: Grid | Plane): Plane {
    return "n" in g ? { width: g.n, height: g.n, cell: g.cell, x0: 0, y0: 0 } : g;
}

export function grid(n: number): Grid {
    if (!Number.isInteger(n) || n < 64 || n > 8192 || (n & (n - 1)) !== 0) {
        throw new RangeError(`Gitter ${String(n)}: erlaubt sind Zweierpotenzen von 64 bis 8192`);
    }
    return { n, cell: MAP_EXTENT / n };
}

/** Mitte der Spalte `gx` in Karteneinheiten. */
export function cellX(g: Grid, gx: number): number {
    return (gx + 0.5) * g.cell;
}

/** Mitte der Zeile `gy` in Karteneinheiten (Zeile 0 im Norden). */
export function cellY(g: Grid, gy: number): number {
    return MAP_EXTENT - (gy + 0.5) * g.cell;
}
