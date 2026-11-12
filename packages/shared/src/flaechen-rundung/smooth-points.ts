/**
 * Punkte des Kantennetzes (WI-0077): jede Koordinate genau einmal mit fester Kennung, und ein Gitter, das die Punkte in der
 * Nähe einer Stelle findet. Typisierte Felder statt Objekten: Das Netz trägt rund 480.000 Punkte (Satz map161832).
 */

/** Jede Koordinate genau einmal: `xs[id]`, `ys[id]`; gefunden über die Bits der Zahlen (offene Adressierung). */
export interface PointTable {
    xs: Float64Array;
    ys: Float64Array;
    count: number;
    slots: Int32Array;
    mask: number;
}

const hashScratch = new Float64Array(1);
const hashBits = new Uint32Array(hashScratch.buffer);

function hashXY(x: number, y: number): number {
    hashScratch[0] = x;
    let h = Math.imul((hashBits[0] as number) ^ 0x9e3779b9, 0x85ebca6b) ^ (hashBits[1] as number);
    hashScratch[0] = y;
    h = Math.imul(h ^ (hashBits[0] as number), 0xc2b2ae35) ^ Math.imul(hashBits[1] as number, 0x27d4eb2f);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h >>> 0;
}

/** Eine Tafel für höchstens `capacity` verschiedene Punkte. */
export function createPointTable(capacity: number): PointTable {
    let size = 16;
    while (size < 2 * capacity) size *= 2;
    return {
        xs: new Float64Array(Math.max(capacity, 1)),
        ys: new Float64Array(Math.max(capacity, 1)),
        count: 0,
        slots: new Int32Array(size).fill(-1),
        mask: size - 1,
    };
}

/** Die Kennung eines Punkts; ein neuer bekommt die nächste. */
export function pointId(table: PointTable, rawX: number, rawY: number): number {
    // -0 und 0 sind für PostGIS derselbe Punkt, ihre Bits nicht.
    const x = rawX === 0 ? 0 : rawX;
    const y = rawY === 0 ? 0 : rawY;
    let slot = hashXY(x, y) & table.mask;
    for (;;) {
        const id = table.slots[slot] as number;
        if (id < 0) {
            const created = table.count;
            table.xs[created] = x;
            table.ys[created] = y;
            table.slots[slot] = created;
            table.count += 1;
            return created;
        }
        if (table.xs[id] === x && table.ys[id] === y) return id;
        slot = (slot + 1) & table.mask;
    }
}

/** Die Tafel nimmt keine Punkte mehr auf: Die Suchtafel wird nicht mehr gebraucht. */
export function sealPointTable(table: PointTable): void {
    table.slots = new Int32Array(0);
    table.mask = 0;
}

const CELL_OFFSET = 8388608; // 2^23: Zellen ab −2^23 tragen
const CELL_SPAN = 16777216; // 2^24

/** Punkte nach Gitterzelle sortiert; die Punkte einer Zellspalte findet eine Binärsuche. */
export interface PointGrid {
    size: number;
    ids: Int32Array;
    keys: Float64Array;
}

function cellKey(cx: number, cy: number): number {
    return (cx + CELL_OFFSET) * CELL_SPAN + (cy + CELL_OFFSET);
}

/** Ein Gitter der Zellgröße `size` über die Punkte, für die `include` gilt. */
export function buildGrid(table: PointTable, size: number, include: (id: number) => boolean): PointGrid {
    let n = 0;
    for (let id = 0; id < table.count; id += 1) if (include(id)) n += 1;
    const ids = new Int32Array(n);
    const own = new Float64Array(table.count);
    let k = 0;
    for (let id = 0; id < table.count; id += 1) {
        if (!include(id)) continue;
        ids[k++] = id;
        own[id] = cellKey(Math.floor((table.xs[id] as number) / size), Math.floor((table.ys[id] as number) / size));
    }
    ids.sort((a, b) => (own[a] as number) - (own[b] as number) || a - b);
    const keys = new Float64Array(n);
    for (let q = 0; q < n; q += 1) keys[q] = own[ids[q] as number] as number;
    return { size, ids, keys };
}

function lowerBound(keys: Float64Array, value: number): number {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((keys[mid] as number) < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Der Bereich in `grid.ids` mit den Punkten der Zellen `cx`, `cy0`…`cy1` (eine Zellspalte), nach `range`. */
export function cellRange(grid: PointGrid, cx: number, cy0: number, cy1: number, range: Int32Array): void {
    range[0] = lowerBound(grid.keys, cellKey(cx, cy0));
    range[1] = lowerBound(grid.keys, cellKey(cx, cy1) + 0.5);
}

/** Lexikografisch nach x, dann y: negativ, wenn Punkt `a` vor Punkt `b` liegt. */
export function comparePoints(table: PointTable, a: number, b: number): number {
    const ax = table.xs[a] as number;
    const bx = table.xs[b] as number;
    return ax !== bx ? ax - bx : (table.ys[a] as number) - (table.ys[b] as number);
}
