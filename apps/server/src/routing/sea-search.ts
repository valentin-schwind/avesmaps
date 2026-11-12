import { lineLength } from "./network.ts";
import type { SeaGrid } from "./sea-grid.ts";

/**
 * Die Suche des freien Seeroutings (WI-0046, Plan 6.31): A* auf dem Wasserraster aus `sea-grid.ts`,
 * von einer Anlegestelle zur anderen. Vorerst nur für den Vergleich neben den Seewegen (M1 A).
 *
 * - **Acht Nachbarn**, der schräge Schritt ist √2 Zellen lang und nur erlaubt, wenn beide Nachbarn der
 *   Ecke Wasser sind: Kein Schritt schneidet eine Ecke Land ab.
 * - **Gewicht ist die Strecke.** Das Schiff fährt überall gleich schnell (Wind später, Plan 6.33); die
 *   Zeit ist Länge durch das Tempo des Schiffs aus dem Reisemodell.
 * - **Schätzung** ist der Achter-Abstand zum Ziel, nie zu hoch. Bei gleicher Schätzung gewinnt der
 *   tiefere Knoten, dann die kleinere Zelle - das Ergebnis hängt nicht vom Zufall des Heaps ab.
 * - **Die Linie läuft über Zellmitten** und wird straff gezogen (`straighten`): Von jedem festen Punkt
 *   springt sie zum weitesten Punkt der Treppe, den eine gerade Linie ohne Landzelle erreicht. Die Länge
 *   wird an dieser Linie gemessen, nicht an der Treppe.
 *
 * Die Felder der Suche (etwa 5 Byte je Zelle) gehören der Instanz. Geleert werden je Lauf nur die
 * Zellen, die der vorige berührt hat: Eine kurze Suche kostet dann nicht das ganze Raster.
 */

const SQRT2 = Math.SQRT2;
/** Ein neuer Weg zu einer Zelle zählt erst, wenn er um mehr als das kürzer ist (Rundung der 32-Bit-Kosten). */
const IMPROVE = 1e-3;
const UNSEEN = 0;
const OPEN = 1;
const CLOSED = 2;

export interface SeaRoute {
    /** Die straffe Linie von Zellmitte zu Zellmitte. */
    points: [number, number][];
    /** Länge der Linie in Karteneinheiten. */
    distance: number;
    /** Wie viele Zellen die Suche geschlossen hat. */
    expanded: number;
}

export class SeaSearch {
    private readonly grid: SeaGrid;
    private readonly cost: Float32Array;
    /** Der Schritt, über den die Zelle erreicht wurde, als Nachbar-Nummer + 1; 0 am Start. */
    private readonly came: Uint8Array;
    private readonly state: Uint8Array;
    private readonly offsets: readonly number[];
    /** Die Zellen, die der letzte Lauf berührt hat. */
    private touched = new Int32Array(1 << 16);
    private touchedCount = 0;
    /** Der Heap mit verspätetem Löschen: Schätzung, Kosten und Zelle je Eintrag. */
    private heapKey = new Float64Array(1 << 16);
    private heapCost = new Float32Array(1 << 16);
    private heapCell = new Int32Array(1 << 16);
    private size = 0;

    constructor(grid: SeaGrid) {
        this.grid = grid;
        const cellCount = grid.cols * grid.rows;
        this.cost = new Float32Array(cellCount).fill(Infinity);
        this.came = new Uint8Array(cellCount);
        this.state = new Uint8Array(cellCount);
        const cols = grid.cols;
        // Erst die geraden, dann die schrägen Nachbarn (Spalte, Zeile): +x, -x, +y, -y, dann die Ecken.
        this.offsets = [1, -1, cols, -cols, cols + 1, cols - 1, -cols + 1, -cols - 1];
    }

    /** Was die Suche belegt, in Byte (ohne den Heap, der mit dem Rand der Suche wächst). */
    get bytes(): number {
        return this.cost.byteLength + this.came.byteLength + this.state.byteLength;
    }

    /**
     * Der kürzeste Weg über Wasser zwischen zwei befahrbaren Zellen; null, wenn keiner besteht oder
     * jeder länger wäre als `maxDistance` (Karteneinheiten).
     */
    find(from: number, to: number, maxDistance = Infinity): SeaRoute | null {
        const { grid } = this;
        if (grid.water[from] !== 1 || grid.water[to] !== 1 || grid.part[from] !== grid.part[to]) return null;
        const { cols, water } = grid;
        const limit = maxDistance / grid.cell;
        const goalColumn = to % cols;
        const goalRow = Math.floor(to / cols);
        const estimate = (index: number): number => {
            const dx = Math.abs((index % cols) - goalColumn);
            const dy = Math.abs(Math.floor(index / cols) - goalRow);
            return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
        };
        for (let index = 0; index < this.touchedCount; index += 1) {
            const cell = this.touched[index] as number;
            this.cost[cell] = Infinity;
            this.state[cell] = UNSEEN;
        }
        this.touchedCount = 0;
        this.size = 0;
        this.touch(from);
        this.cost[from] = 0;
        this.came[from] = 0;
        this.state[from] = OPEN;
        this.push(estimate(from), 0, from);
        let expanded = 0;
        while (this.size > 0) {
            const key = this.heapKey[0] as number;
            const reached = this.heapCost[0] as number;
            const index = this.pop();
            if (this.state[index] === CLOSED || reached > (this.cost[index] as number)) continue;
            if (key > limit) return null;
            this.state[index] = CLOSED;
            expanded += 1;
            if (index === to) return this.finish(from, to, expanded);
            for (let step = 0; step < 8; step += 1) {
                const next = index + (this.offsets[step] as number);
                if (water[next] !== 1 || this.state[next] === CLOSED) continue;
                if (step >= 4) {
                    // Schräg nur, wenn beide Nachbarn der Ecke Wasser sind.
                    const dx = step === 4 || step === 6 ? 1 : -1;
                    const dy = step < 6 ? cols : -cols;
                    if (water[index + dx] !== 1 || water[index + dy] !== 1) continue;
                }
                const nextCost = (this.cost[index] as number) + (step < 4 ? 1 : SQRT2);
                if (nextCost >= (this.cost[next] as number) - IMPROVE) continue;
                if (this.state[next] === UNSEEN) this.touch(next);
                this.cost[next] = nextCost;
                this.came[next] = step + 1;
                this.state[next] = OPEN;
                this.push(nextCost + estimate(next), nextCost, next);
            }
        }
        return null;
    }

    private touch(cell: number): void {
        if (this.touchedCount === this.touched.length) {
            const bigger = new Int32Array(this.touched.length * 2);
            bigger.set(this.touched);
            this.touched = bigger;
        }
        this.touched[this.touchedCount] = cell;
        this.touchedCount += 1;
    }

    private finish(from: number, to: number, expanded: number): SeaRoute {
        const cells: number[] = [to];
        let index = to;
        while (index !== from) {
            index -= this.offsets[(this.came[index] as number) - 1] as number;
            cells.push(index);
        }
        cells.reverse();
        const { grid } = this;
        const stairs = cells.map((cell): [number, number] => [
            grid.minX + ((cell % grid.cols) + 0.5) * grid.cell,
            grid.minY + (Math.floor(cell / grid.cols) + 0.5) * grid.cell,
        ]);
        const points = straighten(grid, stairs);
        return { points, distance: lineLength(points), expanded };
    }

    private push(key: number, reached: number, cell: number): void {
        if (this.size === this.heapCell.length) {
            const grow = <T extends Float64Array | Float32Array | Int32Array>(array: T, make: (n: number) => T): T => {
                const bigger = make(array.length * 2);
                bigger.set(array);
                return bigger;
            };
            this.heapKey = grow(this.heapKey, (n) => new Float64Array(n));
            this.heapCost = grow(this.heapCost, (n) => new Float32Array(n));
            this.heapCell = grow(this.heapCell, (n) => new Int32Array(n));
        }
        let position = this.size;
        this.size += 1;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if (!this.before(key, reached, cell, parent)) break;
            this.move(parent, position);
            position = parent;
        }
        this.heapKey[position] = key;
        this.heapCost[position] = reached;
        this.heapCell[position] = cell;
    }

    private pop(): number {
        const top = this.heapCell[0] as number;
        this.size -= 1;
        if (this.size === 0) return top;
        const key = this.heapKey[this.size] as number;
        const reached = this.heapCost[this.size] as number;
        const cell = this.heapCell[this.size] as number;
        let position = 0;
        for (;;) {
            let child = 2 * position + 1;
            if (child >= this.size) break;
            if (child + 1 < this.size && this.entryBefore(child + 1, child)) child += 1;
            if (
                !this.before(
                    this.heapKey[child] as number,
                    this.heapCost[child] as number,
                    this.heapCell[child] as number,
                    -1,
                    key,
                    reached,
                    cell,
                )
            ) {
                break;
            }
            this.move(child, position);
            position = child;
        }
        this.heapKey[position] = key;
        this.heapCost[position] = reached;
        this.heapCell[position] = cell;
        return top;
    }

    private move(from: number, to: number): void {
        this.heapKey[to] = this.heapKey[from] as number;
        this.heapCost[to] = this.heapCost[from] as number;
        this.heapCell[to] = this.heapCell[from] as number;
    }

    private entryBefore(a: number, b: number): boolean {
        return this.before(this.heapKey[a] as number, this.heapCost[a] as number, this.heapCell[a] as number, b);
    }

    /** Kommt der Eintrag (key, reached, cell) vor den an Stelle `slot` (oder vor den übergebenen)? */
    private before(
        key: number,
        reached: number,
        cell: number,
        slot: number,
        otherKey = this.heapKey[slot] as number,
        otherReached = this.heapCost[slot] as number,
        otherCell = this.heapCell[slot] as number,
    ): boolean {
        if (key !== otherKey) return key < otherKey;
        if (reached !== otherReached) return reached > otherReached;
        return cell < otherCell;
    }
}

/**
 * Liegt die gerade Strecke ganz über befahrbaren Zellen? In Vierteln einer Zelle abgetastet, samt der
 * beiden Eckzellen eines schrägen Übergangs - strenger als die Suche.
 */
export function clearOverWater(grid: SeaGrid, ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (grid.cell * 0.25)));
    const wet = (column: number, row: number): boolean =>
        column >= 0 && row >= 0 && column < grid.cols && row < grid.rows && grid.water[row * grid.cols + column] === 1;
    let previousColumn = -1;
    let previousRow = -1;
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const column = Math.floor((ax + (bx - ax) * t - grid.minX) / grid.cell);
        const row = Math.floor((ay + (by - ay) * t - grid.minY) / grid.cell);
        if (column === previousColumn && row === previousRow) continue;
        if (!wet(column, row)) return false;
        if (previousColumn >= 0 && column !== previousColumn && row !== previousRow) {
            if (!wet(previousColumn, row) || !wet(column, previousRow)) return false;
        }
        previousColumn = column;
        previousRow = row;
    }
    return true;
}

/**
 * Zieht die Treppe straff: Von jedem festen Punkt zum weitesten Punkt, den eine gerade Linie über
 * Wasser erreicht. Gesucht wird in wachsenden Sprüngen und dann halbierend; so kostet eine lange,
 * freie Strecke nur wenige Prüfungen. Jede gewählte Strecke ist geprüft - die Linie quert kein Land.
 */
export function straighten(grid: SeaGrid, stairs: readonly [number, number][]): [number, number][] {
    if (stairs.length <= 2) return [...stairs];
    const clear = (from: number, to: number): boolean => {
        const [ax, ay] = stairs[from] as [number, number];
        const [bx, by] = stairs[to] as [number, number];
        return clearOverWater(grid, ax, ay, bx, by);
    };
    return pullStraight(stairs.length, clear).map((index) => stairs[index] as [number, number]);
}

/**
 * Das Straffziehen selbst, für jede Treppe mit `count` Punkten: die Stellen, die stehen bleiben, von 0 bis
 * `count - 1`. `clear(a, b)` sagt, ob die gerade Linie von Punkt a zu Punkt b die Treppe dazwischen ersetzen
 * darf. Auch der Flug zieht so (WI-0051, `air-search.ts`).
 */
export function pullStraight(count: number, clear: (from: number, to: number) => boolean): number[] {
    const last = count - 1;
    const result = [0];
    let anchor = 0;
    while (anchor < last) {
        // Der Nachbar auf der Treppe ist immer frei: Die Suche schneidet keine Ecke.
        let good = anchor + 1;
        let bad = -1;
        let jump = 1;
        while (bad < 0 && good < last) {
            const probe = Math.min(last, good + jump);
            if (clear(anchor, probe)) good = probe;
            else bad = probe;
            jump *= 2;
        }
        while (bad > good + 1) {
            const middle = (good + bad) >> 1;
            if (clear(anchor, middle)) good = middle;
            else bad = middle;
        }
        result.push(good);
        anchor = good;
    }
    return result;
}
