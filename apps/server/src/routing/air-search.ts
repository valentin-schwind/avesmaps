import type { Wegfindungswerte } from "@avesmaps3d/shared";
import { werte } from "./einstellungen.ts";
import { AXIS_OF_DIRECTION, axisOf, stepExtra, turnExtra, type AirCostField } from "./air-field.ts";
import type { AirFrame } from "./air-obstacles.ts";
import { pullStraight } from "./sea-search.ts";

/**
 * Die Suche des Flugs um die Gebirge (WI-0051, F2): A* auf dem Hindernisraster eines Fensters
 * (`air-obstacles.ts`), gebaut wie die Suche der freien Seefahrt (`sea-search.ts`): acht Nachbarn, der
 * schräge Schritt √2 Zellen lang, Achter-Abstand als Schätzung, Heap mit verspätetem Löschen, typisierte
 * Felder, straff gezogen mit derselben Galoppsuche (`pullStraight`).
 *
 * - **Gesperrt heißt teuer, nicht unpassierbar.** Ein Stück über fremdem Gebirge kostet `BLOCKED_WEIGHT`
 *   Stück Umweg mehr: Der Flug meidet es, solange es irgendwie geht, und findet trotzdem immer einen Weg.
 * - **Das Kostenfeld (F4b):** Hat das Raster ein Feld (`AirGrid.field`, `air-field.ts`), kostet jeder Schritt zusätzlich,
 *   was das Fliegen dort über der Reisehöhe kostet: Halten und Steigen über der Standardflughöhe, in Karteneinheiten
 *   Strecke. Beides ist nie negativ, die Schätzung (Achter-Abstand) bleibt zulässig. Ohne Feld ist die Suche die von F2.
 * - **Das Gebirge eines Wegpunkts ist nur zehnfach teuer** (`HOME_FACTOR`, Betreiber 2026-09-28, F-E3 = B):
 *   das gesperrte Gelände, in dem Start oder Ziel liegen, samt dem Ring um ein Tal, in dem sie liegen. So
 *   verlässt der Flug es dort, wo die ganze Reise am kürzesten wird, auch zum Ziel hin, und nicht am
 *   nächsten Rand.
 * - **Ein schräger Schritt** an einer gesperrten Ecke vorbei zählt ganz zum Preis der Ecke: Er schnitte das
 *   Gelände an.
 * - **Nische:** ein offener Teil (über vier Seiten) mit weniger als `POCKET_CELLS` Zellen, der nicht an den
 *   Rand des Fensters reicht - ein Tal ringsum im Gebirge. Im Datenstand vom 2026-09-28 hat der größte
 *   48 Zellen (Grenze 1.800 Schritt).
 * - **Die Linie** läuft über Zellmitten, ihre Enden sitzen auf den Wegpunkten, und sie wird straff gezogen:
 *   Ein gerades Stück ersetzt die Treppe, wenn es nach demselben Preis nicht teurer ist als sie.
 *
 * Eine Instanz sucht einmal: Sie markiert die Heimat der beiden Wegpunkte in ihrem Raster.
 */

export interface AirGrid extends AirFrame {
    /**
     * Je Zelle: 0 offen, 1 gesperrt (`blockedCells`); `AirSearch` setzt das Gebirge der Wegpunkte auf 2.
     */
    blocked: Uint8Array;
    /** Das Kostenfeld der Abwägung (F4b): Was Halten und Steigen über der Reisehöhe zusätzlich kosten. */
    field?: AirCostField;
}

/** So viele Karteneinheiten Umweg wiegt eine Karteneinheit über fremdem Gebirge auf: praktisch unpassierbar. */
export const BLOCKED_WEIGHT = 10_000;
/**
 * So viel kostet eine Karteneinheit über dem Gebirge, in dem ein Wegpunkt liegt (Betreiber 2026-09-28,
 * wörtlich „2. B“: „Der Flug darf in Richtung Ziel aus dem Gebirge hinaus, wenn die Reise dadurch deutlich
 * kürzer wird“). Der Flug nimmt eine Einheit mehr über seinen eigenen Bergen, wenn er dafür mehr als neun
 * Einheiten Umweg in freier Luft spart - „deutlich“, aber nicht um jeden Preis: Den nächsten Rand verlässt er
 * weiter, wenn der Weg zum Ziel dort kaum länger ist.
 */
export const HOME_FACTOR = 10;
/** Ein offener Teil mit weniger Zellen, der nicht an den Rand reicht, ist eine Nische (2.048 E² bei 0,5 E). */
export const POCKET_CELLS = 8192;

/** Was eine Zelle ist: offen, fremdes Gebirge, das Gebirge eines Wegpunkts. */
const OPEN = 0;
const FOREIGN = 1;
const HOME = 2;
/**
 * Der Preis je Karteneinheit, nach der Art der Zelle. 🪤 EINMAL je Suche gelesen (`this.weight`), nicht je Zelle:
 * Die Schleife unten läuft über Hunderttausende (WI-0153).
 */
const weightsOf = (w: Wegfindungswerte): readonly number[] => [1, 1 + w.blockedWeight, w.homeFactor];

const SQRT2 = Math.SQRT2;
/** So viele Ringe um ein Ziel im Gebirge misst `homeReach` höchstens (bei 0,5 E: 32 E). */
const REACH_RINGS = 64;
/** Ein neuer Weg zu einer Zelle zählt erst, wenn er um mehr als das kürzer ist. */
const IMPROVE = 1e-3;
/** Zustand je Zelle: Bits 0-3 der Schritt, über den sie erreicht wurde, plus 1 (0 am Start). */
const CAME = 0x0f;
const SEEN = 0x10;
const CLOSED = 0x20;

/** Die acht Nachbarn als (Spalte, Zeile): erst die geraden, dann die schrägen. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
];

const NEIGHBOUR_COLUMN = Int8Array.from(NEIGHBOURS, ([column]) => column);
const NEIGHBOUR_ROW = Int8Array.from(NEIGHBOURS, ([, row]) => row);

/** Der Weg der Suche als Zellen, vom ersten zum letzten Wegpunkt, und was er über der Sperre fliegt. */
export interface AirCells {
    cells: number[];
    /** Karteneinheiten über gesperrten Zellen, nach dem Maß der Suche; das eigene Gebirge der Wegpunkte dabei. */
    blocked: number;
    /** Karteneinheiten über fremdem Gebirge: Dort quert der Flug nur, wenn das Fenster ihm keinen anderen Weg lässt. */
    crossing: number;
    /**
     * So viele Karteneinheiten fliegt jeder Weg zwischen den beiden Wegpunkten mindestens über ihrem eigenen
     * Gebirge (die Scheiben aus `homeReach`, wenn sie einander nicht berühren). Wer einen günstigeren Weg sucht,
     * weiß damit, wie lang er höchstens ist.
     */
    reach: number;
}

export class AirSearch {
    private readonly grid: AirGrid;
    /** Die Kenngrößen dieser Suche, einmal gelesen (WI-0153). */
    private readonly w: Wegfindungswerte;
    private readonly weight: readonly number[];
    private readonly cost: Float32Array;
    private readonly state: Uint8Array;
    /** Nischen: 0 ungeprüft, 1 Nische, 2 offen; erst angelegt, wenn ein Wegpunkt nicht gesperrt liegt. */
    private pockets: Uint8Array | null = null;
    private heapKey = new Float64Array(1 << 12);
    private heapCost = new Float64Array(1 << 12);
    private heapCell = new Int32Array(1 << 12);
    private size = 0;

    constructor(grid: AirGrid) {
        this.w = werte();
        this.weight = weightsOf(this.w);
        this.grid = grid;
        this.cost = new Float32Array(grid.cols * grid.rows);
        this.state = new Uint8Array(grid.cols * grid.rows);
    }

    /** Was die Suche belegt, in Byte: Sperre, Kosten, Zustand und Nischen je Zelle. */
    get bytes(): number {
        return (
            this.grid.blocked.byteLength +
            this.cost.byteLength +
            this.state.byteLength +
            (this.pockets?.byteLength ?? 0)
        );
    }

    /**
     * Der günstigste Weg von Zelle `from` zu Zelle `to`. Nie null: Jede Zelle ist erreichbar, gesperrte nur
     * teuer. Zuvor wird das Gebirge der beiden Wegpunkte zu ihrer Heimat (`HOME_FACTOR`).
     */
    route(from: number, to: number): AirCells {
        this.markHome(from);
        this.markHome(to);
        const cells = from === to ? [from] : this.trace(this.search(from, to));
        const { cols, cell } = this.grid;
        const apart = Math.hypot((to % cols) - (from % cols), Math.floor(to / cols) - Math.floor(from / cols)) * cell;
        const reaches = this.homeReach(from) + this.homeReach(to);
        return {
            cells,
            blocked: this.lengthOver(cells, (kind) => kind !== OPEN),
            crossing: this.lengthOver(cells, (kind) => kind === FOREIGN),
            reach: reaches <= apart ? reaches : 0,
        };
    }

    /**
     * Die Heimat eines Wegpunkts: das Gebirge, in dem er liegt, oder, liegt er in einer Nische, jedes Gebirge,
     * das an sie grenzt - der Ring um sein Tal.
     */
    private markHome(cell: number): void {
        const { blocked, cols, rows } = this.grid;
        if (blocked[cell] !== OPEN) {
            this.fillHome(cell);
            return;
        }
        if (this.open(cell)) return;
        const pockets = this.pockets as Uint8Array;
        // Die Nische noch einmal abgehen (sie ist klein) und jedes angrenzende Gebirge zur Heimat machen.
        const queue = [cell];
        const seen = new Set(queue);
        for (let head = 0; head < queue.length; head += 1) {
            const index = queue[head] as number;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            for (let direction = 0; direction < 8; direction += 1) {
                const nextColumn = column + (NEIGHBOUR_COLUMN[direction] as number);
                const nextRow = row + (NEIGHBOUR_ROW[direction] as number);
                if (nextColumn < 0 || nextRow < 0 || nextColumn >= cols || nextRow >= rows) continue;
                const next = nextRow * cols + nextColumn;
                if (blocked[next] === FOREIGN) this.fillHome(next);
                else if (direction < 4 && pockets[next] === 1 && !seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
    }

    /** Macht das ganze Gebirge um `start` zur Heimat, über acht Nachbarn (die Ränder einer Nische hängen schräg zusammen). */
    private fillHome(start: number): void {
        const { blocked, cols, rows } = this.grid;
        if (blocked[start] !== FOREIGN) return;
        blocked[start] = HOME;
        const queue = [start];
        for (let head = 0; head < queue.length; head += 1) {
            const index = queue[head] as number;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            for (let direction = 0; direction < 8; direction += 1) {
                const nextColumn = column + (NEIGHBOUR_COLUMN[direction] as number);
                const nextRow = row + (NEIGHBOUR_ROW[direction] as number);
                if (nextColumn < 0 || nextRow < 0 || nextColumn >= cols || nextRow >= rows) continue;
                const next = nextRow * cols + nextColumn;
                if (blocked[next] !== FOREIGN) continue;
                blocked[next] = HOME;
                queue.push(next);
            }
        }
    }

    /** Ist die offene Zelle Teil eines Teils, der keine Nische ist? */
    private open(cell: number): boolean {
        const { blocked, cols, rows } = this.grid;
        this.pockets ??= new Uint8Array(cols * rows);
        const pockets = this.pockets;
        if (pockets[cell] !== 0) return pockets[cell] === 2;
        // Breitensuche über vier Seiten, bis der Teil zu groß ist oder den Rand berührt.
        const queue = [cell];
        pockets[cell] = 3;
        let wide = false;
        for (let head = 0; head < queue.length && !wide; head += 1) {
            const index = queue[head] as number;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            if (row === 0 || column === 0 || row === rows - 1 || column === cols - 1) {
                wide = true;
                break;
            }
            for (const next of [index + 1, index - 1, index + cols, index - cols]) {
                if (blocked[next] !== OPEN) continue;
                // Ein Nachbar aus einer früheren Suche, die offen war: derselbe Teil, also offen.
                if (pockets[next] === 2) wide = true;
                if (pockets[next] !== 0) continue;
                pockets[next] = 3;
                queue.push(next);
            }
            if (queue.length > this.w.pocketCells) wide = true;
        }
        const mark = wide ? 2 : 1;
        for (const index of queue) pockets[index] = mark;
        return wide;
    }

    /** Karteneinheiten entlang einer Zellfolge über Zellen der Art `kind`, nach dem Maß der Suche. */
    private lengthOver(cells: readonly number[], counts: (kind: number) => boolean): number {
        const { blocked, cols, cell } = this.grid;
        let sum = 0;
        for (let index = 1; index < cells.length; index += 1) {
            const from = cells[index - 1] as number;
            const to = cells[index] as number;
            const dy = Math.floor(to / cols) - Math.floor(from / cols);
            const dx = to - from - dy * cols;
            const at = (other: number): number => (counts(blocked[other] as number) ? 1 : 0);
            let share = (at(from) + at(to)) / 2;
            // Schräg an einer solchen Ecke vorbei zählt der ganze Schritt.
            if (dx !== 0 && dy !== 0 && (at(from + dx) === 1 || at(from + dy * cols) === 1)) share = 1;
            sum += share * (dx !== 0 && dy !== 0 ? SQRT2 : 1) * cell;
        }
        return sum;
    }

    /**
     * A* von `from` nach `to`, nach Preis plus Schätzung; liefert `to`. Die Schätzung ist der Achter-Abstand,
     * und liegt das Ziel im Gebirge, dazu der Aufschlag auf das Stück, das jeder Weg in der Scheibe um das Ziel
     * fliegt, die ganz Gebirge ist (`homeReach`). Ohne ihn ginge die Suche jede offene Zelle ab, die billiger
     * ist als das Gebirge vor dem Ziel (gemessen: 172 statt 50 ms bei einem Ziel tief im Gebirge).
     */
    private search(from: number, to: number): number {
        const { cols, rows, cell, blocked } = this.grid;
        const { state, cost } = this;
        const goalColumn = to % cols;
        const goalRow = Math.floor(to / cols);
        const reach = this.homeReach(to);
        const surcharge = this.w.homeFactor - 1;
        const estimate = (column: number, row: number): number => {
            const dx = Math.abs(column - goalColumn);
            const dy = Math.abs(row - goalRow);
            const octile = (dx + dy + (SQRT2 - 2) * Math.min(dx, dy)) * cell;
            if (reach === 0) return octile;
            return octile + surcharge * Math.min(reach, Math.hypot(dx, dy) * cell);
        };
        cost[from] = 0;
        state[from] = SEEN;
        this.push(estimate(from % cols, Math.floor(from / cols)), 0, from);
        const straight = cell;
        const diagonal = cell * SQRT2;
        // Das Kostenfeld (F4b): was ein Schritt über der Standardflughöhe kostet (`stepExtra`) und was eine Ecke zwischen zwei
        // Achsen (`turnExtra`).
        const { field } = this.grid;
        while (this.size > 0) {
            const reached = this.heapCost[0] as number;
            const index = this.pop();
            // Kosten stehen in 32 Bit, im Heap wie im Feld gleich gerundet: Ein älterer Eintrag ist teurer.
            if (((state[index] as number) & CLOSED) !== 0 || reached > (cost[index] as number)) continue;
            state[index] = (state[index] as number) | CLOSED;
            if (index === to) return to;
            const row = Math.floor(index / cols);
            const column = index - row * cols;
            const inner = row > 0 && column > 0 && row < rows - 1 && column < cols - 1;
            const cameDirection = (state[index] as number) & CAME;
            const cameAxis = cameDirection === 0 ? -1 : (AXIS_OF_DIRECTION[cameDirection - 1] as number);
            const here = this.weight[blocked[index] as number] as number;
            for (let direction = 0; direction < 8; direction += 1) {
                const dc = NEIGHBOUR_COLUMN[direction] as number;
                const dr = NEIGHBOUR_ROW[direction] as number;
                if (!inner) {
                    const nextColumn = column + dc;
                    const nextRow = row + dr;
                    if (nextColumn < 0 || nextRow < 0 || nextColumn >= cols || nextRow >= rows) continue;
                }
                const next = index + dr * cols + dc;
                const known = state[next] as number;
                if ((known & CLOSED) !== 0) continue;
                // Je Hälfte der Preis ihrer Zelle; schräg an einer teureren Ecke vorbei der Preis der Ecke.
                let weight = (here + (this.weight[blocked[next] as number] as number)) / 2;
                if (direction >= 4) {
                    const side = Math.max(
                        this.weight[blocked[index + dc] as number] as number,
                        this.weight[blocked[index + dr * cols] as number] as number,
                    );
                    if (side > weight) weight = side;
                }
                const length = direction < 4 ? straight : diagonal;
                let price = length * weight;
                if (field) {
                    const axis = AXIS_OF_DIRECTION[direction] as number;
                    price += stepExtra(field, axis, index, next, length);
                    if (cameAxis >= 0 && cameAxis !== axis) price += turnExtra(field, cameAxis, axis, index);
                }
                const nextCost = Math.fround(reached + price);
                const seen = (known & SEEN) !== 0;
                if (seen && nextCost >= (cost[next] as number) - IMPROVE) continue;
                cost[next] = nextCost;
                state[next] = SEEN | (direction + 1);
                this.push(nextCost + estimate(column + dc, row + dr), nextCost, next);
            }
        }
        // Jede Zelle ist erreichbar; ohne Ziel im Raster bliebe nur der Start.
        return from;
    }

    /**
     * Wie weit um einen Wegpunkt alles das Gebirge seiner Heimat ist, in Karteneinheiten: Ring um Ring nach
     * außen, bis eine Zelle es nicht ist, höchstens `REACH_RINGS` Ringe; eine Zelle weniger, weil der Wegpunkt
     * irgendwo in seiner Zelle liegt. Jeder Weg von ihm fort oder zu ihm hin fliegt in dieser Scheibe über
     * Gebirge, bis zu ihrem Rand oder bis zum anderen Wegpunkt, wenn der darin liegt.
     */
    private homeReach(waypoint: number): number {
        const { blocked, cols, rows, cell } = this.grid;
        if (blocked[waypoint] !== HOME) return 0;
        const column = waypoint % cols;
        const row = Math.floor(waypoint / cols);
        for (let ring = 1; ring <= REACH_RINGS; ring += 1) {
            for (let dy = -ring; dy <= ring; dy += 1) {
                const step = dy === -ring || dy === ring ? 1 : 2 * ring;
                for (let dx = -ring; dx <= ring; dx += step) {
                    const x = column + dx;
                    const y = row + dy;
                    // Der Rand des Fensters zählt wie offenes Gelände: Dahinter weiß die Suche nichts.
                    if (x < 0 || y < 0 || x >= cols || y >= rows || blocked[y * cols + x] !== HOME) {
                        return Math.max(0, ring - 2) * cell;
                    }
                }
            }
        }
        return (REACH_RINGS - 1) * cell;
    }

    /** Die Zellen vom Start bis `cell`. */
    private trace(cell: number): number[] {
        const { cols } = this.grid;
        const cells = [cell];
        for (let index = cell; ;) {
            const came = (this.state[index] as number) & CAME;
            if (came === 0) break;
            const [dc, dr] = NEIGHBOURS[came - 1] as readonly [number, number];
            index -= dr * cols + dc;
            cells.push(index);
        }
        return cells.reverse();
    }

    private push(key: number, reached: number, cell: number): void {
        if (this.size === this.heapCell.length) {
            const grow = <T extends Float64Array | Int32Array>(array: T, make: (n: number) => T): T => {
                const bigger = make(array.length * 2);
                bigger.set(array);
                return bigger;
            };
            this.heapKey = grow(this.heapKey, (n) => new Float64Array(n));
            this.heapCost = grow(this.heapCost, (n) => new Float64Array(n));
            this.heapCell = grow(this.heapCell, (n) => new Int32Array(n));
        }
        const keys = this.heapKey;
        const costs = this.heapCost;
        const cells = this.heapCell;
        let position = this.size;
        this.size += 1;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if (!before(key, reached, cell, keys[parent] as number, costs[parent] as number, cells[parent] as number)) {
                break;
            }
            keys[position] = keys[parent] as number;
            costs[position] = costs[parent] as number;
            cells[position] = cells[parent] as number;
            position = parent;
        }
        keys[position] = key;
        costs[position] = reached;
        cells[position] = cell;
    }

    private pop(): number {
        const keys = this.heapKey;
        const costs = this.heapCost;
        const cells = this.heapCell;
        const top = cells[0] as number;
        this.size -= 1;
        const size = this.size;
        if (size === 0) return top;
        const key = keys[size] as number;
        const reached = costs[size] as number;
        const cell = cells[size] as number;
        let position = 0;
        for (;;) {
            let child = 2 * position + 1;
            if (child >= size) break;
            const right = child + 1;
            if (
                right < size &&
                before(
                    keys[right] as number,
                    costs[right] as number,
                    cells[right] as number,
                    keys[child] as number,
                    costs[child] as number,
                    cells[child] as number,
                )
            ) {
                child = right;
            }
            if (!before(keys[child] as number, costs[child] as number, cells[child] as number, key, reached, cell)) {
                break;
            }
            keys[position] = keys[child] as number;
            costs[position] = costs[child] as number;
            cells[position] = cells[child] as number;
            position = child;
        }
        keys[position] = key;
        costs[position] = reached;
        cells[position] = cell;
        return top;
    }
}

/** Kommt der Eintrag a vor b? Nach der Schätzung, bei Gleichstand der tiefere, dann die kleinere Zelle. */
function before(keyA: number, reachedA: number, cellA: number, keyB: number, reachedB: number, cellB: number): boolean {
    if (keyA !== keyB) return keyA < keyB;
    if (reachedA !== reachedB) return reachedA > reachedB;
    return cellA < cellB;
}

/**
 * Was eine gerade Strecke nach dem Preis der Suche kostet, in Karteneinheiten: in Vierteln einer Zelle
 * abgetastet; ein Viertel kostet seine Länge mal dem höchsten Preis seiner beiden Zellen und, bei einem
 * schrägen Übergang, der beiden Eckzellen (wie `clearOverWater` der freien Seefahrt). Über offenem Gelände
 * ist das die Länge. Sobald es mehr ist als `enough`, endet die Zählung: Wer nur fragt, ob es höchstens so
 * viel ist, braucht den Rest nicht. Mit Kostenfeld (`AirGrid.field`, F4b) kommt der Preis über der Reisehöhe dazu: Halten
 * je Viertel nach dem Überstand der Zelle (gemittelt mit dem des Viertels davor), Steigen bei jedem Zellwechsel, auf der
 * Achse, die der Richtung der Strecke am nächsten liegt - dieselbe Rechnung wie der Schritt der Suche. `fromAxis` ist die
 * Achse der Strecke davor (-1: keine); wechselt sie, zählt das Steigen von deren Stand auf den dieser Achse am Anfang.
 */
export function costAlong(
    grid: AirGrid,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    enough = Infinity,
    fromAxis = -1,
): number {
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length > 0)) return 0;
    const { minX, minY, cell, cols, rows, blocked, field } = grid;
    // 🪤 EINMAL je Strecke gelesen, nicht je Schritt (WI-0153).
    const weight = weightsOf(werte());
    const steps = Math.max(1, Math.ceil(length / (cell * 0.25)));
    const piece = length / steps;
    const at = (column: number, row: number): number =>
        column >= 0 && row >= 0 && column < cols && row < rows
            ? (weight[blocked[row * cols + column] as number] as number)
            : 1;
    // Das Kostenfeld: Achse der Strecke, Preis je Schritt Überstand und je Schritt Steigen.
    const altitudes = field ? (field.altitude[axisOf(bx - ax, by - ay)] as Uint16Array) : null;
    const standard = field?.rule.standard ?? 0;
    const holdPerStep = field ? (field.rule.holdFactor / field.rule.scale) * piece : 0;
    const climbPerSchritt = field ? field.rule.climbFactor / field.rule.schritt : 0;
    const over = (column: number, row: number): number => {
        if (!field || !altitudes || column < 0 || row < 0 || column >= cols || row >= rows) return 0;
        const index = row * cols + column;
        return Math.max(0, (altitudes[index] as number) - (field.ground[index] as number) - standard);
    };
    const rise = (column: number, row: number): number =>
        altitudes && column >= 0 && row >= 0 && column < cols && row < rows
            ? (altitudes[row * cols + column] as number)
            : 0;
    let previousColumn = Math.floor((ax - minX) / cell);
    let previousRow = Math.floor((ay - minY) / cell);
    let previousWeight = at(previousColumn, previousRow);
    let previousOver = over(previousColumn, previousRow);
    let sum = 0;
    // Kam der Flug zuvor auf einer anderen Achse an, steht die Bahn in der ersten Zelle dort anders: Das Steigen von seinem
    // Stand auf den dieser Achse zählt (wie an einer Ecke der Suche), sonst wäre jede Ecke eine kostenlose neue Hülle.
    if (field && fromAxis >= 0 && fromAxis !== axisOf(bx - ax, by - ay)) {
        if (previousColumn >= 0 && previousRow >= 0 && previousColumn < cols && previousRow < rows) {
            sum += turnExtra(field, fromAxis, axisOf(bx - ax, by - ay), previousRow * cols + previousColumn);
        }
    }
    for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const column = Math.floor((ax + (bx - ax) * t - minX) / cell);
        const row = Math.floor((ay + (by - ay) * t - minY) / cell);
        const here = at(column, row);
        let weight = here > previousWeight ? here : previousWeight;
        if (column !== previousColumn && row !== previousRow) {
            weight = Math.max(weight, at(previousColumn, row), at(column, previousRow));
        }
        sum += piece * weight;
        let hereOver = 0;
        if (field) {
            hereOver = over(column, row);
            sum += (previousOver + hereOver) * 0.5 * holdPerStep;
            if (column !== previousColumn || row !== previousRow) {
                const climb = Math.min(rise(column, row) - rise(previousColumn, previousRow), hereOver - previousOver);
                if (climb > 0) sum += climb * climbPerSchritt;
            }
        }
        if (sum > enough) return sum;
        previousColumn = column;
        previousRow = row;
        previousWeight = here;
        previousOver = hereOver;
    }
    return sum;
}

/** So oft rückt das Straffziehen die Knicke an die Ecken des Gebirges nach, höchstens. */
const SLIDE_ROUNDS = 4;
/** Halbierungen, mit denen ein Knick auf seinem Stück rückt: auf ein Tausendstel des Stücks genau. */
const SLIDE_STEPS = 10;
/** Rundung beim Vergleich zweier Preise. */
const SAME = 1e-9;

/**
 * Zieht die Treppe straff (`pullStraight`): Ein gerades Stück ersetzt die Treppe dazwischen, wenn es nach dem
 * Preis der Suche (`costAlong`) nicht teurer ist als sie - über offenem Gelände also, wenn es keine Sperre
 * berührt; über dem Gebirge eines Wegpunkts, wenn die gesparte Strecke den Aufschlag trägt. Danach fällt jeder
 * Knick, dessen Nachbarn einander ebenso ersetzen. Die Treppe beginnt und endet an den Wegpunkten, dazwischen
 * die Mitten aller Zellen der Suche.
 *
 * 🪤 **Die Treppe biegt oft erst hinter der Ecke ab.** Unter gleich teuren Treppen wählt die Suche irgendeine;
 * läuft sie an der Wand entlang über die Ecke hinaus, landet der Knick dort, und keine Stelle der Treppe
 * liegt an der Ecke (gemessen: 3 % Umweg an einer Wand). Deshalb rückt jeder Knick danach auf einem seiner
 * beiden Stücke zurück, so weit die Linie zum übernächsten Punkt nicht teurer wird - bis an die Ecke.
 */
export function pullTautOverTerrain(grid: AirGrid, stairs: readonly [number, number][]): [number, number][] {
    if (stairs.length <= 2) return [...stairs];
    const along: Along = (a, b, enough) => costAlong(grid, a[0], a[1], b[0], b[1], enough);
    const upTo = [0];
    for (let index = 1; index < stairs.length; index += 1) {
        upTo.push(
            (upTo[index - 1] as number) +
                along(stairs[index - 1] as [number, number], stairs[index] as [number, number]),
        );
    }
    const kept = pullStraight(stairs.length, (from, to) => {
        const replaced = (upTo[to] as number) - (upTo[from] as number) + SAME;
        return along(stairs[from] as [number, number], stairs[to] as [number, number], replaced) <= replaced;
    });
    const points = kept.map((index) => stairs[index] as [number, number]);
    const replaces: Replaces = (a, b, replaced) => along(a, b, replaced + SAME) <= replaced + SAME;
    dropCorners(points, along, replaces);
    for (let round = 0; round < SLIDE_ROUNDS; round += 1) {
        if (!slideCorners(points, along, replaces)) break;
        dropCorners(points, along, replaces);
    }
    return points;
}

type Point = readonly [number, number];
/** Was die Strecke von a nach b kostet; mit `enough` nur so weit gezählt, bis es mehr ist. */
type Along = (a: Point, b: Point, enough?: number) => number;
/** Darf die gerade Linie von a nach b ein Stück ersetzen, das `replaced` kostet? */
type Replaces = (a: Point, b: Point, replaced: number) => boolean;

/** Lässt jeden Knick fallen, dessen Nachbarn die gerade Linie zueinander ersetzen darf. */
function dropCorners(points: [number, number][], along: Along, replaces: Replaces): void {
    for (let changed = true; changed;) {
        changed = false;
        for (let index = 1; index + 1 < points.length; index += 1) {
            const before = points[index - 1] as [number, number];
            const here = points[index] as [number, number];
            const after = points[index + 1] as [number, number];
            if (replaces(before, after, along(before, here) + along(here, after))) {
                points.splice(index, 1);
                changed = true;
                index -= 1;
            }
        }
    }
}

/**
 * Rückt jeden Knick auf einem seiner Stücke zum Nachbarn hin, so weit die Linie von dort zum anderen Nachbarn
 * das Stück ersetzen darf, und nimmt die kürzere der beiden Möglichkeiten. Wahr, wenn ein Knick gerückt ist.
 */
function slideCorners(points: [number, number][], along: Along, replaces: Replaces): boolean {
    let moved = false;
    const at = (from: readonly [number, number], to: readonly [number, number], s: number): [number, number] => [
        from[0] + (to[0] - from[0]) * s,
        from[1] + (to[1] - from[1]) * s,
    ];
    for (let index = 1; index + 1 < points.length; index += 1) {
        const before = points[index - 1] as [number, number];
        const corner = points[index] as [number, number];
        const after = points[index + 1] as [number, number];
        // Der Knick rückt auf dem Stück von `anchor` zu ihm; die Linie läuft dann von dort zu `other`.
        const slide = (anchor: [number, number], other: [number, number]): [number, number] => {
            const rest = along(corner, other);
            let far = 0;
            let near = 1;
            for (let step = 0; step < SLIDE_STEPS; step += 1) {
                const s = (far + near) / 2;
                const point = at(anchor, corner, s);
                if (replaces(point, other, along(point, corner) + rest)) near = s;
                else far = s;
            }
            return at(anchor, corner, near);
        };
        const toBefore = slide(before, after);
        const toAfter = slide(after, before);
        // Verglichen wird nach dem Preis, nicht nach der Länge: Über dem Gebirge eines Wegpunkts zählt er mit.
        const now = along(before, corner) + along(corner, after);
        const viaBefore = along(before, toBefore) + along(toBefore, after);
        const viaAfter = along(before, toAfter) + along(toAfter, after);
        const best = viaBefore <= viaAfter ? toBefore : toAfter;
        if (Math.min(viaBefore, viaAfter) < now - SAME) {
            points[index] = best;
            moved = true;
        }
    }
    return moved;
}
