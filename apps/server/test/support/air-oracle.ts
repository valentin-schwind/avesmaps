import { airTerrain, blockedCells, type AirBox, type AirFrame } from "../../src/routing/air-obstacles.ts";
import { POCKET_CELLS } from "../../src/routing/air-search.ts";
import { frameOver } from "../../src/routing/air-way.ts";
import { KIND_NONE, reliefAt, type TerrainHeights } from "../../src/routing/relief.ts";

/**
 * Die Prüfung der Höhenregel des Flugs (WI-0061, Plan 11.54 „Air Route respektiert Höhenregel“), unabhängig von der
 * Suche: Sie liest das Gelände mit `reliefAt` (Gebirgsraster und Gipfelkegel, wie jede Rechnung) und tastet die
 * Linie fein ab, alle 0,02 E. Die Regel (WI-0051, F2): Unter der Linie liegt nirgends Gelände, das höher ist als die
 * Höchstflughöhe minus den Mindestabstand (`limit`, in Schritt über dem Meer).
 *
 * 🔴 **Die begründeten Brücken** - nur dort darf die Linie über Gelände über der Grenze führen:
 *
 * 1. **Das Gebirge eines Wegpunkts, der selbst über der Grenze liegt.** Der Flug verlässt es (`HOME_FACTOR`): Als
 *    Heimat gilt jede gesperrte Zelle, die über acht Nachbarn mit der Zelle des Wegpunkts zusammenhängt.
 * 2. **Die eigene Zelle eines Wegpunkts, der selbst tiefer liegt** (0,5 E): Sie steht für die Suche frei, auch wenn
 *    das Gelände in ihr anderswo höher reicht.
 * 3. **Ein Wegpunkt in einer Nische** (ein Tal ringsum im Gebirge): Nur die an den abgeschlossenen offenen
 *    Teil angrenzenden Gebirgskomponenten sind Heimat. Auch diese Fälle werden vollständig geprüft.
 *
 * Die Zellen und die Sperre dazu sind die der Suche (`blockedCells`, `frameOver`); dass die Sperre kein Gelände über
 * der Grenze auslässt, prüft jede Probe selbst: Eine Probe über der Grenze in einer offenen Zelle ist ein Verstoß.
 */

export type Point = [number, number];

/** Wie fein die Linie abgetastet wird, in Karteneinheiten. */
export const PROBE = 0.02;

/**
 * Was über der Grenze zählt: mehr als `HEIGHT_EPS` Schritt. Die Raster sind bilinear; vier gleiche Stützwerte
 * rechnen als 100,00000000000001, und ein Raster genau auf der Grenze (100 Schritt Sockel bei einem eigenen
 * Flugmittel mit 30 Schritt Reisehöhe) ist kein Gelände darüber. Die Suche vergleicht die ganzen Stützwerte.
 */
export const HEIGHT_EPS = 1e-6;

export interface FlugBefund {
    /** Proben über der Grenze, die keine Brücke erklärt. */
    verstoesse: number;
    /** Die erste davon: Lage und Höhe. */
    erster: { x: number; y: number; hoehe: number } | null;
    /** Länge der Linie über Gelände über der Grenze, Brücken eingeschlossen, in Karteneinheiten. */
    ueberGrenze: number;
    /** Ein Wegpunkt liegt in einer Nische; rein diagnostisch, kein ausgelassener Fall. */
    nische: boolean;
}

/** Ein Rechteck um alle Punkte, um `rand` erweitert. */
export function boxAround(points: readonly Point[], rand: number): AirBox {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
        minX: Math.min(...xs) - rand,
        minY: Math.min(...ys) - rand,
        maxX: Math.max(...xs) + rand,
        maxY: Math.max(...ys) + rand,
    };
}

export class FlugOrakel {
    readonly frame: AirFrame;
    readonly limit: number;
    private readonly heights: TerrainHeights;
    private readonly blocked: Uint8Array;

    /** Die Sperre über `box` für diese Grenze; ein Orakel gilt für viele Linien im selben Fenster. */
    constructor(heights: TerrainHeights, limit: number, box: AirBox | AirFrame) {
        this.heights = heights;
        this.limit = limit;
        this.frame = "cell" in box ? box : frameOver(box);
        this.blocked = blockedCells(airTerrain(heights), this.frame, limit);
    }

    /** Die Höhe über der Grenze an einer Stelle, sonst null: Gelände muss es sein. */
    over(x: number, y: number): number | null {
        const here = reliefAt(this.heights, x, y);
        return here.kind !== KIND_NONE && here.height > this.limit + HEIGHT_EPS ? here.height : null;
    }

    /** Liegt ein Wegpunkt selbst über der Grenze? */
    above(point: Point): boolean {
        return this.over(point[0], point[1]) !== null;
    }

    cellOf(x: number, y: number): number {
        const { minX, minY, cell, cols, rows } = this.frame;
        const column = Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
        const row = Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
        return row * cols + column;
    }

    /** Sperre und Zelle: ein Wegpunkt ohne Sperre unter seinen Füßen ist der Normalfall. */
    isBlocked(x: number, y: number): boolean {
        return this.blocked[this.cellOf(x, y)] === 1;
    }

    /** Prüft die Linie von `from` nach `to` gegen die Regel und ihre Brücken. */
    pruefe(from: Point, to: Point, line: readonly Point[]): FlugBefund {
        const { cols, rows } = this.frame;
        const work = this.blocked.slice();
        const ends = [from, to];
        const free = ends.filter((point) => !this.above(point));
        const home = ends.filter((point) => this.above(point));
        // Was die Suche vorfindet: die Zelle eines tieferen Wegpunkts steht frei.
        const ownCells = new Set(free.map(([x, y]) => this.cellOf(x, y)));
        for (const cell of ownCells) work[cell] = 0;
        const pockets = free.map(([x, y]) => this.enclosed(work, this.cellOf(x, y))).filter((cells) => cells !== null);
        const nische = pockets.length > 0;
        // Die Heimat: das Gebirge über acht Nachbarn von der Zelle jedes Wegpunkts über der Grenze.
        const heimat = new Uint8Array(work.length);
        const queue: number[] = [];
        for (const [x, y] of home) {
            const start = this.cellOf(x, y);
            if (work[start] === 1 && heimat[start] === 0) {
                heimat[start] = 1;
                queue.push(start);
            }
        }
        // Independent component boundary classification, without calling the router's home marking.
        for (const pocket of pockets) {
            for (const cell of pocket) {
                const row = Math.floor(cell / cols);
                const column = cell % cols;
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const x = column + dx,
                            y = row + dy;
                        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
                        const next = y * cols + x;
                        if (work[next] === 1 && heimat[next] === 0) {
                            heimat[next] = 1;
                            queue.push(next);
                        }
                    }
                }
            }
        }
        for (let head = 0; head < queue.length; head += 1) {
            const index = queue[head] as number;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const nextColumn = column + dx;
                    const nextRow = row + dy;
                    if (nextColumn < 0 || nextRow < 0 || nextColumn >= cols || nextRow >= rows) continue;
                    const next = nextRow * cols + nextColumn;
                    if (work[next] === 1 && heimat[next] === 0) {
                        heimat[next] = 1;
                        queue.push(next);
                    }
                }
            }
        }
        let verstoesse = 0;
        let ueberGrenze = 0;
        let erster: FlugBefund["erster"] = null;
        for (let index = 1; index < line.length; index += 1) {
            const [x0, y0] = line[index - 1] as Point;
            const [x1, y1] = line[index] as Point;
            const length = Math.hypot(x1 - x0, y1 - y0);
            const steps = Math.max(1, Math.ceil(length / PROBE));
            for (let step = 0; step <= steps; step += 1) {
                const f = step / steps;
                const x = x0 + (x1 - x0) * f;
                const y = y0 + (y1 - y0) * f;
                const height = this.over(x, y);
                if (height === null) continue;
                ueberGrenze += length / steps;
                const cell = this.cellOf(x, y);
                if (ownCells.has(cell) || heimat[cell] === 1) continue;
                verstoesse += 1;
                erster ??= { x, y, hoehe: height };
            }
        }
        return { verstoesse, erster, ueberGrenze, nische };
    }

    /** Liegt die offene Zelle in einem Teil, den die Suche eine Nische nennt: klein und nicht am Rand des Fensters? */
    private enclosed(work: Uint8Array, start: number): number[] | null {
        const { cols, rows } = this.frame;
        const seen = new Set<number>([start]);
        const queue = [start];
        for (let head = 0; head < queue.length; head += 1) {
            const index = queue[head] as number;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            if (row === 0 || column === 0 || row === rows - 1 || column === cols - 1) return null;
            if (queue.length > POCKET_CELLS) return null;
            for (const next of [index + 1, index - 1, index + cols, index - cols]) {
                if (work[next] !== 0 || seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return queue;
    }
}
