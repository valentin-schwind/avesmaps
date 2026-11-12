import { hash2 } from "@avesmaps3d/shared";
import { DIRECTION_BITS, DIRECTION_SHIFT, DX, DY, FLOODED, planeOf, SEA, type Grid, type Plane } from "./grid.ts";

/**
 * Das Fließnetz des visuellen Reliefs (WI-0054): Senken füllen, Abflussrichtung, Einzugsfläche.
 *
 * 🪤 Nicht V12s Heap und Senkenfüller: Die sind bitgenau an Legacys Gebirgsrechnung gebunden (MCS-025)
 * und arbeiten auf einem Gebirge mit Float64 je Zelle. Hier läuft dasselbe Verfahren einmal über die
 * ganze Karte (4096²) und muss mit wenig Speicher auskommen: Richtungen als ein Byte, die Reihenfolge
 * nur über Landzellen.
 */

/**
 * Richtung einer Zelle, in den oberen vier Bits ihrer Klasse: 0..7 ein Nachbar (`DX`/`DY`), `OUTLET`
 * fließt ins Meer oder über den Rand, `NONE` fließt nirgends hin.
 */
export const OUTLET = 8;
export const NONE = 15;

/** Die Richtung einer Zelle. */
export function directionOf(classes: Uint8Array, k: number): number {
    return ((classes[k] as number) & DIRECTION_BITS) >> DIRECTION_SHIFT;
}

/** Binärer Min-Heap über (Schlüssel, Zelle), bei Gleichstand die kleinere Zelle: dieselbe Folge in jedem Lauf. */
export class CellHeap {
    private keys: Float64Array;
    private cells: Int32Array;
    size = 0;
    /** Die größte Füllung seit dem Anlegen, für den Bericht. */
    peak = 0;

    constructor(capacity: number) {
        this.keys = new Float64Array(capacity);
        this.cells = new Int32Array(capacity);
    }

    // Sift with a hole instead of pairwise swaps (WI-0067 performance). Every cell enters at most once, so
    // (key, cell) is a strict total order: any correct heap pops the same sequence.

    push(key: number, cell: number): void {
        if (this.size === this.keys.length) {
            const keys = new Float64Array(this.keys.length * 2);
            keys.set(this.keys);
            const cells = new Int32Array(this.cells.length * 2);
            cells.set(this.cells);
            this.keys = keys;
            this.cells = cells;
        }
        const keys = this.keys;
        const cells = this.cells;
        let i = this.size;
        this.size += 1;
        if (this.size > this.peak) this.peak = this.size;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            const above = keys[parent] as number;
            if (!(key < above || (key === above && cell < (cells[parent] as number)))) break;
            keys[i] = above;
            cells[i] = cells[parent] as number;
            i = parent;
        }
        keys[i] = key;
        cells[i] = cell;
    }

    /** Die Zelle mit dem kleinsten Schlüssel. */
    pop(): number {
        const keys = this.keys;
        const cells = this.cells;
        const top = cells[0] as number;
        this.size -= 1;
        const n = this.size;
        if (n > 0) {
            const key = keys[n] as number;
            const cell = cells[n] as number;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n) break;
                const r = l + 1;
                let s = l;
                if (r < n) {
                    const kr = keys[r] as number;
                    const kl = keys[l] as number;
                    if (kr < kl || (kr === kl && (cells[r] as number) < (cells[l] as number))) s = r;
                }
                const ks = keys[s] as number;
                if (!(ks < key || (ks === key && (cells[s] as number) < cell))) break;
                keys[i] = ks;
                cells[i] = cells[s] as number;
                i = s;
            }
            keys[i] = key;
            cells[i] = cell;
        }
        return top;
    }
}

/**
 * Eine Schlange für Priority-Flood, die dieselbe Folge liefert wie `CellHeap` (WI-0227), nur schneller: Die Schlüssel kommen in
 * Eimer nach ihrer Größe, und nur der Eimer, aus dem gerade geholt wird, liegt in einem Heap. Das trägt, weil die Füllung nie einen
 * Schlüssel unter dem zuletzt geholten einreiht und (Schlüssel, Zelle) eine strenge Ordnung ist: Jede richtige Schlange holt dieselbe
 * Folge. Ein Eimer liegt vor einem anderen nur mit kleineren Schlüsseln (die Einteilung steigt mit dem Schlüssel); was in den
 * laufenden oder einen früheren Eimer fiele, geht in den Heap.
 */
export class FloodQueue {
    private readonly heap: CellHeap;
    private readonly cells: Int32Array[] = [];
    private readonly keys: Float64Array[] = [];
    private readonly counts: Int32Array;
    // 🪤 Keine Parametereigenschaft im Konstruktor: Node streift in Worker-Threads nur Typen ab und kennt sie nicht (WI-0227).
    private readonly buckets: number;
    private min = 0;
    private scale = 0;
    private current = -1;
    size = 0;
    peak = 0;

    constructor(capacity: number, buckets = 1024) {
        this.buckets = buckets;
        this.heap = new CellHeap(capacity);
        this.counts = new Int32Array(buckets);
        for (let i = 0; i < buckets; i += 1) {
            this.cells.push(new Int32Array(16));
            this.keys.push(new Float64Array(16));
        }
    }

    /** Vor jeder Füllung: der Bereich der Schlüssel, über den die Eimer gleich breit verteilt werden. Leert die Schlange. */
    prepare(min: number, max: number): void {
        this.min = min;
        this.scale = max > min ? this.buckets / (max - min) : 0;
        this.current = -1;
        this.counts.fill(0);
        this.heap.size = 0;
        this.size = 0;
    }

    private bucketOf(key: number): number {
        const i = Math.floor((key - this.min) * this.scale);
        return i > 0 ? (i < this.buckets ? i : this.buckets - 1) : 0;
    }

    push(key: number, cell: number): void {
        this.size += 1;
        if (this.size > this.peak) this.peak = this.size;
        const i = this.bucketOf(key);
        if (i <= this.current) {
            this.heap.push(key, cell);
            return;
        }
        const count = this.counts[i] as number;
        let cells = this.cells[i] as Int32Array;
        let keys = this.keys[i] as Float64Array;
        if (count === cells.length) {
            const grownCells = new Int32Array(count * 2);
            grownCells.set(cells);
            const grownKeys = new Float64Array(count * 2);
            grownKeys.set(keys);
            this.cells[i] = cells = grownCells;
            this.keys[i] = keys = grownKeys;
        }
        cells[count] = cell;
        keys[count] = key;
        this.counts[i] = count + 1;
    }

    pop(): number {
        if (this.heap.size === 0) {
            let i = this.current + 1;
            while ((this.counts[i] as number) === 0) i += 1;
            this.current = i;
            const cells = this.cells[i] as Int32Array;
            const keys = this.keys[i] as Float64Array;
            const count = this.counts[i] as number;
            for (let j = 0; j < count; j += 1) this.heap.push(keys[j] as number, cells[j] as number);
            this.counts[i] = 0;
        }
        this.size -= 1;
        return this.heap.pop();
    }
}

/**
 * Der Zufall des Anstiegs in `priorityFlood` je Zelle, vorab für viele Füllungen derselben Fläche (WI-0227): `hash2` × 2³², als
 * ganze Zahl genau, also bytegleich zur Rechnung je Zelle. 4 Byte je Zelle (64 MB bei 4096²).
 */
export function floodNoise(g: Grid | Plane, seed: number): Uint32Array {
    const { width, height, x0, y0 } = planeOf(g);
    const noise = new Uint32Array(width * height);
    for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) noise[y * width + x] = hash2(seed, x0 + x, y0 + y) * 4294967296;
    return noise;
}

/**
 * Priority-Flood (Barnes 2014) vom Meer aus, an Ort und Stelle: `surface` ist danach gefüllt, jede
 * Senke bis zu ihrem Überlauf plus `eps` je Zelle. `order` bekommt die Landzellen in Füllfolge; die ist
 * aufsteigend gefüllt und damit topologisch für jede Abflussrichtung auf der gefüllten Fläche.
 * Zurück kommt die Zahl der Landzellen. Der Heap wird über die Runden wiederverwendet; „erledigt“ ist
 * ein Bit in `classes` statt eines eigenen Feldes. `sinks` sind weitere Abflüsse im Land: Mündungen, die
 * laut Daten im oder am Gebirge enden (`mouthSinks`). Auf einem Fenster (`Plane`) ist dessen Rand offen wie
 * der Kartenrand: Randzellen sind Abflüsse auf ihrer eigenen Höhe.
 */
export function priorityFlood(
    g: Grid | Plane,
    surface: Float32Array,
    classes: Uint8Array,
    eps: number,
    order: Int32Array,
    heap: CellHeap | FloodQueue,
    sinks: readonly number[] = [],
    seed = 54054,
    noise?: Uint32Array,
): number {
    const { width, height, x0, y0 } = planeOf(g);
    const isDone = (k: number): boolean => ((classes[k] as number) & (FLOODED | SEA)) !== 0;
    const markDone = (k: number): void => {
        classes[k] = (classes[k] as number) | FLOODED;
    };
    let low = Infinity;
    let high = -Infinity;
    for (let k = 0; k < width * height; k += 1) {
        classes[k] = (classes[k] as number) & ~DIRECTION_BITS;
        if ((classes[k] as number) & SEA) surface[k] = 0;
        const value = surface[k] as number;
        if (value < low) low = value;
        if (value > high) high = value;
    }
    if (heap instanceof FloodQueue) heap.prepare(low, high);
    // Saat: Land am Meer und am Kartenrand.
    for (let gy = 0; gy < height; gy += 1) {
        for (let gx = 0; gx < width; gx += 1) {
            const k = gy * width + gx;
            if (isDone(k)) continue;
            let seed = gx === 0 || gy === 0 || gx === width - 1 || gy === height - 1;
            for (let d = 0; d < 8 && !seed; d += 1) {
                const nk = (gy + (DY[d] as number)) * width + gx + (DX[d] as number);
                if ((classes[nk] as number) & SEA) seed = true;
            }
            if (seed) {
                markDone(k);
                heap.push(surface[k] as number, k);
            }
        }
    }
    for (const k of sinks) {
        if (isDone(k)) continue;
        markDone(k);
        heap.push(surface[k] as number, k);
    }
    let count = 0;
    while (heap.size > 0) {
        const k = heap.pop();
        order[count] = k;
        count += 1;
        const gx = k % width;
        const gy = (k - gx) / width;
        const level = surface[k] as number;
        for (let d = 0; d < 8; d += 1) {
            const nx = gx + (DX[d] as number);
            const ny = gy + (DY[d] as number);
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nk = ny * width + nx;
            if (isDone(nk)) continue;
            markDone(nk);
            const own = surface[nk] as number;
            // Gleich hohe Füllschalen bilden gerade, parallele Rinnen. Positives, ortsfestes
            // Gefälle bricht sie auf; mindestens eine Float32-Stufe hält die Folge azyklisch.
            const unit = noise ? (noise[nk] as number) / 4294967296 : hash2(seed, x0 + nx, y0 + ny);
            const rise = Math.max(eps * (0.1 + 2 * unit), Math.abs(level) * 2 ** -22);
            const filled = Math.fround(Math.max(own, level + rise));
            surface[nk] = filled;
            heap.push(filled, nk);
        }
    }
    return count;
}

/**
 * Stochastischer D8-Abfluss: alle acht Gefälle erhalten denselben Zufallsbereich.
 * Nur gerade Nachbarn zu verstärken sperrt auf achsenparallelen Hängen die Diagonalen
 * vollständig aus. Die geometrische Distanz bleibt für jeden Nachbarn erhalten.
 * Nur die Zeilen `[from, to)` (WI-0227): Jede Zelle schreibt allein ihre Richtung und liest von den Nachbarn nur Höhe und Meer,
 * darum dürfen Threads die Zeilen unter sich aufteilen.
 */
export function rho8(
    g: Grid | Plane,
    filled: Float32Array,
    classes: Uint8Array,
    seed: number,
    from = 0,
    to = planeOf(g).height,
): void {
    const { width, height, x0, y0 } = planeOf(g);
    for (let gy = from; gy < to; gy += 1) {
        for (let gx = 0; gx < width; gx += 1) {
            const k = gy * width + gx;
            const own = (classes[k] as number) & ~DIRECTION_BITS;
            if (own & SEA) {
                classes[k] = own | (NONE << DIRECTION_SHIFT);
                continue;
            }
            const h = filled[k] as number;
            let best = 0;
            let choice = NONE;
            let edge = false;
            for (let d = 0; d < 8; d += 1) {
                const nx = gx + (DX[d] as number);
                const ny = gy + (DY[d] as number);
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                    edge = true;
                    continue;
                }
                const nk = ny * width + nx;
                const sea = ((classes[nk] as number) & SEA) !== 0;
                const drop = h - (sea ? 0 : (filled[nk] as number));
                if (!(drop > 0)) continue;
                const rho = hash2(seed + d * 7919, x0 + gx, y0 + gy);
                const slope = (drop / (d < 4 ? 1 : Math.SQRT2)) * (0.5 + rho);
                if (slope > best) {
                    best = slope;
                    choice = sea ? OUTLET : d;
                }
            }
            classes[k] = own | ((choice === NONE && edge ? OUTLET : choice) << DIRECTION_SHIFT);
        }
    }
}

/** Die Empfängerzelle oder −1 (Meer, Rand, keine). */
export function receiverOf(g: Grid | Plane, k: number, classes: Uint8Array): number {
    const d = directionOf(classes, k);
    if (d >= 8) return -1;
    return k + (DY[d] as number) * ("n" in g ? g.n : g.width) + (DX[d] as number);
}

/** Einzugsfläche in E² je Landzelle, in umgekehrter Füllfolge weitergereicht, nach `area`. */
export function accumulate(
    g: Grid | Plane,
    order: Int32Array,
    count: number,
    classes: Uint8Array,
    area: Float32Array,
    source?: (k: number) => number,
): void {
    const cellArea = g.cell * g.cell;
    area.fill(0);
    for (let i = 0; i < count; i += 1) {
        const k = order[i] as number;
        area[k] = source ? cellArea * source(k) : cellArea;
    }
    for (let i = count - 1; i >= 0; i -= 1) {
        const k = order[i] as number;
        const r = receiverOf(g, k, classes);
        if (r >= 0) area[r] = (area[r] as number) + (area[k] as number);
    }
}
