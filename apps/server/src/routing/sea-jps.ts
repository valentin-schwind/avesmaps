import type { SeaGrid } from "./sea-grid.ts";
import { straighten, type SeaRoute } from "./sea-search.ts";

/**
 * Jump Point Search auf dem Wasserraster (WI-0046, Benchmark): dieselbe Suche wie `SeaSearch`, acht
 * Nachbarn, schräg nur mit beiden Nachbarn der Ecke im Wasser, Gewicht die Strecke - aber über offenes
 * Wasser in Sprüngen statt Zelle für Zelle (Harabor und Grastien 2011, in der Fassung ohne
 * Eckenschneiden). Offen sind nur die Sprungpunkte, darum hält die Suche ihre Kosten in einer Map statt
 * in Feldern über das ganze Raster: Sie braucht nur das Raster selbst.
 *
 * Die Linie zwischen zwei Sprungpunkten ist gerade oder schräg und liegt ganz im Wasser; sie wird wie
 * bei `SeaSearch` straff gezogen.
 */

const SQRT2 = Math.SQRT2;

export class JumpPointSearch {
    private readonly grid: SeaGrid;

    constructor(grid: SeaGrid) {
        this.grid = grid;
    }

    private wet(column: number, row: number): boolean {
        const { grid } = this;
        return (
            column >= 0 &&
            row >= 0 &&
            column < grid.cols &&
            row < grid.rows &&
            grid.water[row * grid.cols + column] === 1
        );
    }

    /** Der nächste Sprungpunkt von (x, y) in Richtung (dx, dy), oder -1. Ohne Rekursion: Läufe sind lang. */
    private jump(startX: number, startY: number, dx: number, dy: number, goal: number): number {
        let x = startX;
        let y = startY;
        for (;;) {
            if (!this.wet(x, y)) return -1;
            const index = y * this.grid.cols + x;
            if (index === goal) return index;
            if (dx !== 0 && dy !== 0) {
                // Schräg: ein Sprungpunkt, wo ein gerader Lauf von hier einen findet.
                if (this.jump(x + dx, y, dx, 0, goal) >= 0 || this.jump(x, y + dy, 0, dy, goal) >= 0) return index;
            } else if (dx !== 0) {
                if (
                    (this.wet(x, y - 1) && !this.wet(x - dx, y - 1)) ||
                    (this.wet(x, y + 1) && !this.wet(x - dx, y + 1))
                ) {
                    return index;
                }
            } else if (
                (this.wet(x - 1, y) && !this.wet(x - 1, y - dy)) ||
                (this.wet(x + 1, y) && !this.wet(x + 1, y - dy))
            ) {
                return index;
            }
            // Weiter nur, wenn der nächste Schritt keine Ecke schneidet.
            if (!this.wet(x + dx, y) || !this.wet(x, y + dy)) return -1;
            x += dx;
            y += dy;
        }
    }

    /** Die Richtungen, in die von einem Sprungpunkt weitergesprungen wird. */
    private directions(x: number, y: number, dx: number, dy: number): [number, number][] {
        if (dx === 0 && dy === 0) {
            const all: [number, number][] = [];
            for (const [ax, ay] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ] as const) {
                if (this.wet(x + ax, y + ay)) all.push([ax, ay]);
            }
            for (const [ax, ay] of [
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1],
            ] as const) {
                if (this.wet(x + ax, y) && this.wet(x, y + ay)) all.push([ax, ay]);
            }
            return all;
        }
        const out: [number, number][] = [];
        if (dx !== 0 && dy !== 0) {
            if (this.wet(x, y + dy)) out.push([0, dy]);
            if (this.wet(x + dx, y)) out.push([dx, 0]);
            if (this.wet(x, y + dy) && this.wet(x + dx, y)) out.push([dx, dy]);
        } else if (dx !== 0) {
            const up = this.wet(x, y + 1);
            const down = this.wet(x, y - 1);
            if (this.wet(x + dx, y)) {
                out.push([dx, 0]);
                if (up) out.push([dx, 1]);
                if (down) out.push([dx, -1]);
            }
            if (up) out.push([0, 1]);
            if (down) out.push([0, -1]);
        } else {
            const right = this.wet(x + 1, y);
            const left = this.wet(x - 1, y);
            if (this.wet(x, y + dy)) {
                out.push([0, dy]);
                if (right) out.push([1, dy]);
                if (left) out.push([-1, dy]);
            }
            if (right) out.push([1, 0]);
            if (left) out.push([-1, 0]);
        }
        // Ein schräger Schritt ist nur erlaubt, wenn beide Nachbarn der Ecke Wasser sind.
        return out.filter(([ax, ay]) => ax === 0 || ay === 0 || (this.wet(x + ax, y) && this.wet(x, y + ay)));
    }

    /** Der kürzeste Weg über Wasser zwischen zwei befahrbaren Zellen; null, wenn keiner besteht. */
    find(from: number, to: number): SeaRoute | null {
        const { grid } = this;
        if (grid.water[from] !== 1 || grid.water[to] !== 1 || grid.part[from] !== grid.part[to]) return null;
        const cols = grid.cols;
        const goalX = to % cols;
        const goalY = Math.floor(to / cols);
        const estimate = (x: number, y: number): number => {
            const dx = Math.abs(x - goalX);
            const dy = Math.abs(y - goalY);
            return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
        };
        const cost = new Map<number, number>([[from, 0]]);
        const parent = new Map<number, number>();
        const closed = new Set<number>();
        const heap = new Heap();
        heap.push(estimate(from % cols, Math.floor(from / cols)), 0, from);
        let expanded = 0;
        while (heap.size > 0) {
            const [, reached, index] = heap.pop();
            if (closed.has(index) || reached > (cost.get(index) as number)) continue;
            closed.add(index);
            expanded += 1;
            if (index === to) return this.finish(parent, from, to, expanded);
            const x = index % cols;
            const y = Math.floor(index / cols);
            const back = parent.get(index);
            const dx = back === undefined ? 0 : Math.sign(x - (back % cols));
            const dy = back === undefined ? 0 : Math.sign(y - Math.floor(back / cols));
            for (const [ax, ay] of this.directions(x, y, dx, dy)) {
                const point = this.jump(x + ax, y + ay, ax, ay, to);
                if (point < 0 || closed.has(point)) continue;
                const px = point % cols;
                const py = Math.floor(point / cols);
                const steps = Math.max(Math.abs(px - x), Math.abs(py - y));
                const next = reached + (ax !== 0 && ay !== 0 ? steps * SQRT2 : steps);
                if (next >= (cost.get(point) ?? Infinity) - 1e-9) continue;
                cost.set(point, next);
                parent.set(point, index);
                heap.push(next + estimate(px, py), next, point);
            }
        }
        return null;
    }

    private finish(parent: Map<number, number>, from: number, to: number, expanded: number): SeaRoute {
        const { grid } = this;
        const cells = [to];
        let index = to;
        while (index !== from) {
            index = parent.get(index) as number;
            cells.push(index);
        }
        cells.reverse();
        // Zwischen zwei Sprungpunkten liegt ein gerader oder schräger Lauf; aufgefüllt zur Treppe, damit
        // das Straffziehen dieselben Ecken schneiden kann wie bei A*.
        const stairs: number[] = [cells[0] as number];
        for (let step = 1; step < cells.length; step += 1) {
            const target = cells[step] as number;
            let current = stairs[stairs.length - 1] as number;
            const dx = Math.sign((target % grid.cols) - (current % grid.cols));
            const dy = Math.sign(Math.floor(target / grid.cols) - Math.floor(current / grid.cols));
            while (current !== target) {
                current += dy * grid.cols + dx;
                stairs.push(current);
            }
        }
        const points = straighten(
            grid,
            stairs.map((cell): [number, number] => [
                grid.minX + ((cell % grid.cols) + 0.5) * grid.cell,
                grid.minY + (Math.floor(cell / grid.cols) + 0.5) * grid.cell,
            ]),
        );
        let distance = 0;
        for (let step = 1; step < points.length; step += 1) {
            const [ax, ay] = points[step - 1] as [number, number];
            const [bx, by] = points[step] as [number, number];
            distance += Math.hypot(bx - ax, by - ay);
        }
        return { points, distance, expanded };
    }
}

/** Ein Heap aus (Schätzung, Kosten, Zelle); bei gleicher Schätzung der tiefere Knoten, dann die kleinere Zelle. */
class Heap {
    private readonly items: [number, number, number][] = [];

    get size(): number {
        return this.items.length;
    }

    push(key: number, reached: number, cell: number): void {
        const items = this.items;
        items.push([key, reached, cell]);
        let position = items.length - 1;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if (!Heap.before(items[position] as [number, number, number], items[parent] as [number, number, number]))
                break;
            [items[position], items[parent]] = [
                items[parent] as [number, number, number],
                items[position] as [number, number, number],
            ];
            position = parent;
        }
    }

    pop(): [number, number, number] {
        const items = this.items;
        const top = items[0] as [number, number, number];
        const last = items.pop() as [number, number, number];
        if (items.length > 0) {
            items[0] = last;
            let position = 0;
            for (;;) {
                let child = 2 * position + 1;
                if (child >= items.length) break;
                const right = items[child + 1];
                if (right && Heap.before(right, items[child] as [number, number, number])) child += 1;
                if (!Heap.before(items[child] as [number, number, number], items[position] as [number, number, number]))
                    break;
                [items[position], items[child]] = [
                    items[child] as [number, number, number],
                    items[position] as [number, number, number],
                ];
                position = child;
            }
        }
        return top;
    }

    private static before(a: [number, number, number], b: [number, number, number]): boolean {
        if (a[0] !== b[0]) return a[0] < b[0];
        if (a[1] !== b[1]) return a[1] > b[1];
        return a[2] < b[2];
    }
}
