import { werte } from "./einstellungen.ts";
import {
    centreX,
    centreY,
    crossingUnits,
    forEachCellNear,
    freeAround,
    hasBlockedNear,
    indexOf,
    terrainAt,
    type FordPlanes,
    type OffroadBox,
    type OffroadPlanes,
} from "./offroad-grid.ts";
import { groundWithRelief, levelPlane, reliefGroundBetween, stepKind, type ReliefPlane } from "./relief.ts";

/**
 * Die Suche des gebogenen Gangs querfeldein (WI-0030 R7, MCS-021): Legacys A* und sein Mehrziel-Lauf
 * (`offroad-grid.php`, avesmaps@770c80e) auf dem Raster aus `offroad-grid.ts`, ohne Boden und Höhe.
 *
 * - **Acht Nachbarn**, der schräge Schritt ist √2 Zellen lang.
 * - **Ein Schritt kostet** Länge / Tempo mal Watfaktor (der größere beider Zellen, damit er nicht von
 *   der Richtung abhängt), dazu je geschnittenem Bach der Querungspreis und, wo ein Fluss freigeräumt
 *   ist, je geschnittenem Fluss sein Preis (WI-0030 m, `OffroadCost.rivers`). Unter „Kürzeste“ ist das
 *   Gewicht die Strecke: Waten bremst dort nicht, eine Furt kostet trotzdem - sie ist ein Hindernis,
 *   kein Untergrund.
 * - **Die Linie läuft über Zellmitten**, ihre Enden sitzen auf den echten Punkten. Dann wird sie straff
 *   gezogen (`pullTaut`, Betreiber 2026-09-24) und mit Douglas-Peucker 0,10 vereinfacht. Länge und Zeit
 *   werden an genau der Linie gemessen, die ausgeliefert wird, und die Zeit bekommt den Längenaufschlag
 *   der Luftlinie.
 *
 * 🔴 Unter gleich teuren Treppen ist Legacys Wahl Zufall (Rundung und PHPs Heap). Hier gewinnt die mit
 * den wenigsten Knicken - gleiche Kosten, aber wenige gerade Stücke, die sich gut straffen lassen.
 */

/** Douglas-Peucker in Karteneinheiten: 0,10 und nicht mehr - größer kürzt die Linie, und Länge ist Reisezeit. */
export const SIMPLIFY_EPSILON = 0.1;

/**
 * Wie weit die GEZEICHNETE Linie eines gesuchten Gangs von der gerechneten höchstens abweichen darf, in
 * Karteneinheiten (zwei Zellen zu 0,25). Die Treppe der Suche läuft im Gebirge Zelle für Zelle um Hänge, und
 * die Linie wird dort nicht gerader, weil jede Abkürzung über einen Hang mehr kostet (Steigung je Schritt, seit
 * dem Gelände aus dem Domain-Höhenmodell, 2026-10-02). Länge und Zeit gehören der Treppe; was die Karte zeichnet,
 * ist die Linie darunter, gerade genug für die Kurve (`OffroadPath.display`; Befund 2026-10-03: „querfeldeinrouten
 * sind nicht mehr geglättet“).
 */
export const DISPLAY_EPSILON = 0.5;

/**
 * Wie ein Fluss im Freiräum-Umkreis wirkt (WI-0030 m): „free“ wie Legacy (Entscheidung g), „blocked“ -
 * er bleibt Wand bis auf die eigene Zelle der Enden -, „priced“ - passierbar, je Querung `riverUnits`.
 */
export type RiverRule = "free" | "blocked" | "priced";

/**
 * Wie Meer und See am Ufer wirken (WI-0030 o): „coast“ wie Legacy - im Umkreis der Küstentoleranz
 * begehbar (Entscheidung g) -, „shore“ - Wand bis auf die eigene Zelle der Enden.
 */
export type WaterRule = "coast" | "shore";

export interface OffroadCost {
    /** Tempo querfeldein in Meilen je Stunde, um den Zeitfaktor überhöht - wie jede Kante. */
    speed: number;
    /** „Kürzeste“: Die Suche wiegt Strecke statt Zeit. */
    byDistance: boolean;
    /** Was eine Querung beim Querungsfaktor 1 kostet, in Karteneinheiten offenen Geländes. */
    crossingUnits: number;
    /** Der Längenaufschlag der Zeit, nach der Luftlinie der Etappe. */
    ramp: (airUnits: number) => number;
    rivers: RiverRule;
    /** Was eine Flussquerung kostet, in Karteneinheiten offenen Geländes; unter „free“ ohne Wirkung. */
    riverUnits: number;
    water: WaterRule;
}

/** Was um die Enden freigeräumt wird. */
const freeing = (cost: OffroadCost): { water: boolean; rivers: boolean } => ({
    water: cost.water === "coast",
    rivers: cost.rivers !== "blocked",
});

/**
 * Die Flüsse als Querungen, wenn sie etwas kosten; unter „free“ keine. 🔴 Führt ein Fluss durch die
 * eigene Zelle eines Endes, liegt der Punkt AM Fluss: Dort kostet er nichts (`atEnds`). Das Raster weiß
 * nicht, auf welchem Ufer der Punkt in seiner Zelle steht - sonst zahlte ein Gang, der die Zellmitte
 * umrundet, am echten Punkt trotzdem.
 */
const wallsOf = (planes: { walls?: FordPlanes | null }, cost: OffroadCost): FordPlanes | null =>
    cost.rivers === "free" ? null : (planes.walls ?? null);

export interface OffroadPath {
    /** Die vereinfachte Linie; der erste und der letzte Punkt sind die echten Enden. */
    points: [number, number][];
    /** Länge der Linie in Karteneinheiten. */
    distance: number;
    /** Zeit in der Einheit jeder Kante: Länge / Tempo mal Watfaktor, dazu Furten, mal Längenaufschlag. */
    time: number;
    /**
     * Dieselbe Linie, wenn jeder Schritt eben wäre (WI-0049 S5d): dasselbe Gelände und derselbe Boden, nur
     * ohne Steigung. Für die Mehrzeit durch Steigung; fehlt, wo kein Gelände wirkt, dann ist sie `time`.
     */
    levelTime?: number;
    /**
     * Die Linie, die die Karte zeichnet, wo sie von `points` abweicht: die Treppe so weit begradigt, wie sie dabei
     * höchstens `DISPLAY_EPSILON` von ihr abweicht und keine gesperrte Zelle, keinen Bach und keinen Fluss
     * berührt. Länge, Zeit und Steigung gelten weiter an `points`. Fehlt, wo es nichts zu begradigen gibt.
     */
    display?: [number, number][];
}

type Point = { x: number; y: number };

/** Die acht Nachbarn als (Spalte, Zeile): erst die geraden, dann die schrägen. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];
/** Zwei Wege, deren Kosten sich um weniger unterscheiden, sind gleich teuer. */
const TIE = 1e-9;
/** Zustand einer Zelle in der Warteschlange: nie eingereiht, oder schon geschlossen. */
const UNSEEN = -1;
const CLOSED = -2;

/**
 * Die Felder eines Suchlaufs, ein Eintrag je Zelle. Läufe nacheinander in derselben Kiste teilen sie
 * sich: Jedes ufernahe Ziel bekommt einen eigenen A*, und jeder bekäme sonst bis zu 5 MB frisch.
 */
class SearchBuffers {
    readonly best: Float64Array;
    readonly cameFrom: Int32Array;
    readonly heading: Int8Array;
    readonly turns: Int32Array;
    /** Stelle einer Zelle im Heap, oder `UNSEEN` / `CLOSED`. */
    readonly slot: Int32Array;
    readonly heap: Int32Array;
    readonly key: Float64Array;

    constructor(cellCount: number) {
        this.best = new Float64Array(cellCount);
        this.cameFrom = new Int32Array(cellCount);
        this.heading = new Int8Array(cellCount);
        this.turns = new Int32Array(cellCount);
        this.slot = new Int32Array(cellCount);
        this.heap = new Int32Array(cellCount);
        this.key = new Float64Array(cellCount);
    }

    /** Leert die Felder für den nächsten Lauf. */
    reset(): void {
        this.best.fill(Infinity);
        this.cameFrom.fill(-1);
        this.heading.fill(-1);
        this.turns.fill(0);
        this.slot.fill(UNSEEN);
    }
}

/** Die offenen Zellen nach Schlüssel, jede höchstens einmal; bei Gleichstand die kleinere Zelle. */
class CellQueue {
    /** Stelle einer Zelle im Heap, oder `UNSEEN` / `CLOSED`. */
    readonly slot: Int32Array;
    private readonly heap: Int32Array;
    private readonly key: Float64Array;
    private size = 0;

    constructor(buffers: SearchBuffers) {
        this.slot = buffers.slot;
        this.heap = buffers.heap;
        this.key = buffers.key;
    }

    /** Reiht die Zelle ein oder senkt ihren Schlüssel. */
    offer(cell: number, key: number): void {
        this.key[cell] = key;
        let position = this.slot[cell] as number;
        if (position < 0) {
            position = this.size;
            this.size += 1;
        }
        this.rise(cell, position);
    }

    /** Die günstigste Zelle, geschlossen; -1, wenn keine mehr offen ist. */
    pop(): number {
        if (this.size === 0) return -1;
        const top = this.heap[0] as number;
        this.slot[top] = CLOSED;
        this.size -= 1;
        if (this.size > 0) this.sink(this.heap[this.size] as number, 0);
        return top;
    }

    private before(a: number, b: number): boolean {
        const left = this.key[a] as number;
        const right = this.key[b] as number;
        return left < right || (left === right && a < b);
    }

    private rise(cell: number, start: number): void {
        let position = start;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            const other = this.heap[parent] as number;
            if (!this.before(cell, other)) break;
            this.heap[position] = other;
            this.slot[other] = position;
            position = parent;
        }
        this.heap[position] = cell;
        this.slot[cell] = position;
    }

    private sink(cell: number, start: number): void {
        let position = start;
        for (;;) {
            let child = 2 * position + 1;
            if (child >= this.size) break;
            if (child + 1 < this.size && this.before(this.heap[child + 1] as number, this.heap[child] as number)) {
                child += 1;
            }
            const other = this.heap[child] as number;
            if (!this.before(other, cell)) break;
            this.heap[position] = other;
            this.slot[other] = position;
            position = child;
        }
        this.heap[position] = cell;
        this.slot[cell] = position;
    }
}

/**
 * Ein Suchlauf auf dem Raster. Mit Ziel ist er Legacys A* (Schätzung: Luftlinie zur Zielmitte durch das
 * Tempo, mal dem kleinsten Faktor des Geländes `ReliefPlane.floor` - 1, außer auf offenem Land, wo eine Ebene unter
 * 1 liegt -, also nie zu hoch), ohne Ziel sein Mehrziel-Dijkstra.
 */
class GridSearch {
    readonly best: Float64Array;
    readonly cameFrom: Int32Array;
    private readonly box: OffroadBox;
    private readonly blocked: Uint8Array;
    private readonly fords: FordPlanes | null;
    private readonly walls: FordPlanes | null;
    /** Der Boden; nur unter „Schnellste“, unter „Kürzeste“ zählt die Strecke. */
    private readonly ground: Float32Array | null;
    /** Das Gelände (WI-0049 S5b); ebenso nur unter „Schnellste“. */
    private readonly relief: ReliefPlane | null;
    /** Der kleinste Faktor eines Schritts (`ReliefPlane.floor`, sonst 1): die Schätzung rechnet mit ihm. */
    private readonly floor: number;
    private readonly atEnds: ReadonlySet<number>;
    private readonly cost: OffroadCost;
    private readonly target: Point | null;
    private readonly heading: Int8Array;
    private readonly turns: Int32Array;
    private readonly queue: CellQueue;
    private readonly stepTime: Float64Array;

    constructor(
        box: OffroadBox,
        blocked: Uint8Array,
        fords: FordPlanes | null,
        walls: FordPlanes | null,
        ground: Float32Array | null,
        relief: ReliefPlane | null,
        atEnds: ReadonlySet<number>,
        cost: OffroadCost,
        target: Point | null,
        buffers: SearchBuffers,
    ) {
        this.box = box;
        this.blocked = blocked;
        this.fords = fords;
        this.walls = walls;
        this.ground = cost.byDistance ? null : ground;
        this.relief = cost.byDistance ? null : relief;
        this.floor = this.relief ? Math.min(1, this.relief.floor) : 1;
        this.atEnds = atEnds;
        this.cost = cost;
        this.target = target;
        buffers.reset();
        this.best = buffers.best;
        this.cameFrom = buffers.cameFrom;
        this.heading = buffers.heading;
        this.turns = buffers.turns;
        this.queue = new CellQueue(buffers);
        this.stepTime = Float64Array.from(
            NEIGHBOURS,
            ([column, row]) => (column !== 0 && row !== 0 ? box.cell * Math.SQRT2 : box.cell) / cost.speed,
        );
    }

    start(cell: number): void {
        this.best[cell] = 0;
        this.queue.offer(cell, 0);
    }

    /** Die nächste Zelle, geschlossen; -1, wenn nichts mehr erreichbar ist. */
    next(): number {
        return this.queue.pop();
    }

    isClosed(cell: number): boolean {
        return this.queue.slot[cell] === CLOSED;
    }

    /** Entspannt die Nachbarn einer geschlossenen Zelle. */
    expand(current: number): void {
        const { box, blocked, cost, fords, walls, ground: floor, relief } = this;
        const cols = box.cols;
        const row = Math.floor(current / cols);
        const column = current - row * cols;
        const wade = fords?.wade;
        // Watfaktor und Boden je Zelle, der größere; der Schritt zahlt den größeren seiner beiden Zellen.
        const factorOf = (cell: number): number => {
            const wading = wade && !cost.byDistance ? (wade[cell] as number) || 1 : 1;
            const soil = floor ? (floor[cell] as number) || 1 : 1;
            return wading > soil ? wading : soil;
        };
        const currentFactor = factorOf(current);
        const base = this.best[current] as number;
        const heading = this.heading[current] as number;
        const turns = this.turns[current] as number;
        for (let direction = 0; direction < NEIGHBOURS.length; direction += 1) {
            const [columnStep, rowStep] = NEIGHBOURS[direction] as readonly [number, number];
            const nextColumn = column + columnStep;
            const nextRow = row + rowStep;
            if (nextColumn < 0 || nextRow < 0 || nextColumn >= cols || nextRow >= box.rows) continue;
            const next = nextRow * cols + nextColumn;
            if (blocked[next] !== 0 || this.queue.slot[next] === CLOSED) continue;

            const nextFactor = factorOf(next);
            let ground = currentFactor > nextFactor ? currentFactor : nextFactor;
            // Das Gelände zählt wie ein Boden, der größte Faktor gewinnt (WI-0049 S5b). Wo kein Boden bremst (ground 1),
            // gilt der Faktor des Geländes auch unter 1: Auf offenem Land ist P / μ_offen für eine Ebene kleiner als 1
            // (F5). Die Schätzung der Suche rechnet deshalb mit `floor`.
            if (relief) {
                const kind = stepKind(relief.kind[current] as number, relief.kind[next] as number);
                if (kind !== 0) {
                    const run = columnStep !== 0 && rowStep !== 0 ? box.cell * Math.SQRT2 : box.cell;
                    const slope = relief.step(
                        kind,
                        relief.height[current] as number,
                        relief.height[next] as number,
                        run,
                    );
                    ground = groundWithRelief(ground, kind, slope);
                }
            }
            // 🔴 Der Querungspreis ist kein Faktor: Er überlebt „Kürzeste“ und wirkt in beiden Modi.
            let crossing = 0;
            const atFord = wade !== undefined && (wade[current] !== 0 || wade[next] !== 0);
            const atWall =
                walls !== null &&
                (walls.wade[current] !== 0 || walls.wade[next] !== 0) &&
                !this.atEnds.has(current) &&
                !this.atEnds.has(next);
            if (atFord || atWall) {
                const x1 = centreX(box, column);
                const y1 = centreY(box, row);
                const x2 = centreX(box, nextColumn);
                const y2 = centreY(box, nextRow);
                if (atFord) crossing += crossingUnits(box, fords, cost.crossingUnits, current, next, x1, y1, x2, y2);
                if (atWall) crossing += crossingUnits(box, walls, cost.riverUnits, current, next, x1, y1, x2, y2);
                crossing /= cost.speed;
            }
            const candidate = base + (this.stepTime[direction] as number) * ground + crossing;
            const candidateTurns = turns + (heading >= 0 && heading !== direction ? 1 : 0);
            const known = this.best[next] as number;
            if (candidate < known - TIE) {
                this.best[next] = candidate;
                this.cameFrom[next] = current;
                this.heading[next] = direction;
                this.turns[next] = candidateTurns;
                this.queue.offer(next, candidate + this.estimate(nextColumn, nextRow));
            } else if (candidate <= known + TIE && candidateTurns < (this.turns[next] as number)) {
                // Gleich teuer: Es gewinnt der Weg mit weniger Knicken.
                this.cameFrom[next] = current;
                this.heading[next] = direction;
                this.turns[next] = candidateTurns;
            }
        }
    }

    /** Die Zellen von `from` zurück bis `to`, beide eingeschlossen. */
    trace(from: number, to: number): number[] {
        const cells = [from];
        for (let cell = from; cell !== to;) {
            cell = this.cameFrom[cell] as number;
            cells.push(cell);
        }
        return cells;
    }

    private estimate(column: number, row: number): number {
        if (!this.target) return 0;
        return (
            (Math.hypot(this.target.x - centreX(this.box, column), this.target.y - centreY(this.box, row)) /
                this.cost.speed) *
            this.floor
        );
    }
}

/**
 * Berührt der freigeräumte Kreis um ein Ziel die abgesuchte Gegend des Punkts, samt ihrer Nachbarn?
 * Ist die Gegend ganz abgesucht, ist das genau die Frage, ob der eigene A* des Ziels ankommt: Sein
 * Raster ist das gemeinsame plus dieser Kreis, und jeder Weg zum Punkt muss die Gegend betreten.
 */
function touchesRegion(box: OffroadBox, search: GridSearch, goal: Point): boolean {
    const touches = (index: number): boolean => {
        const row = Math.floor(index / box.cols);
        const column = index - row * box.cols;
        for (let nextRow = row - 1; nextRow <= row + 1; nextRow += 1) {
            if (nextRow < 0 || nextRow >= box.rows) continue;
            for (let nextColumn = column - 1; nextColumn <= column + 1; nextColumn += 1) {
                if (nextColumn < 0 || nextColumn >= box.cols) continue;
                if (search.isClosed(nextRow * box.cols + nextColumn)) return true;
            }
        }
        return false;
    };
    return touches(indexOf(box, goal.x, goal.y)) || forEachCellNear(box, goal.x, goal.y, touches);
}

const centreOf = (box: OffroadBox, cell: number): [number, number] => {
    const row = Math.floor(cell / box.cols);
    return [centreX(box, cell - row * box.cols), centreY(box, row)];
};

/**
 * Der günstigste Weg von `from` nach `to`, oder null (Legacy `avesmapsOffroadFindPath`). Um beide Enden
 * wird freigeräumt, in einer eigenen Kopie der Sperre: Ein Hafen liegt IN seinem Meer, und ein Punkt am
 * Fluss wäre sonst von der ersten Zelle an eingemauert.
 */
export function findPath(planes: OffroadPlanes, cost: OffroadCost, from: Point, to: Point): OffroadPath | null {
    return findPathOn(planes, planes.blocked as Uint8Array, cost, from, to);
}

/** Wie `findPath` auf einem eigenen Raster; in `buffers`, wenn der Aufrufer sie weiterreicht. */
function findPathOn(
    planes: OffroadPlanes,
    grid: Uint8Array,
    cost: OffroadCost,
    from: Point,
    to: Point,
    buffers = new SearchBuffers(planes.box.cellCount),
): OffroadPath | null {
    const { box } = planes;
    const start = indexOf(box, from.x, from.y);
    const goal = indexOf(box, to.x, to.y);
    if (start === goal)
        return finishPath(
            planes,
            cost,
            [
                [from.x, from.y],
                [to.x, to.y],
            ],
            true,
        );
    const blocked = grid.slice();
    freeAround(box, blocked, from.x, from.y, freeing(cost));
    freeAround(box, blocked, to.x, to.y, freeing(cost));
    const [goalX, goalY] = centreOf(box, goal);
    const atEnds = new Set([start, goal]);
    const target = { x: goalX, y: goalY };
    const search = new GridSearch(
        box,
        blocked,
        planes.fords,
        wallsOf(planes, cost),
        planes.ground,
        planes.relief ?? null,
        atEnds,
        cost,
        target,
        buffers,
    );
    search.start(start);
    for (;;) {
        const cell = search.next();
        if (cell < 0) return null;
        if (cell === goal) break;
        search.expand(cell);
    }
    const points = search
        .trace(goal, start)
        .reverse()
        .map((cell) => centreOf(box, cell));
    points[0] = [from.x, from.y];
    points[points.length - 1] = [to.x, to.y];
    return finishPath(planes, cost, pullTaut(planes, blocked, cost, points), true);
}

/**
 * Der erste der Ziele, in ihrer Reihenfolge, den ein Weg vom Punkt aus erreicht - mit seinem Weg vom
 * Ziel zum Punkt (Legacy `avesmapsOffroadFindPathsFromPoint`, dann die Regel „der nächste erreichbare
 * Ausstieg“). Die Ziele kommen nach Luftlinie geordnet.
 *
 * - **Ein Lauf für alle**, vom Punkt aus, ohne Schätzung. Er endet, sobald kein offenes Ziel mehr vor
 *   dem besten erreichten liegt - Legacy läuft, bis alle stehen, und wählt danach denselben.
 * - **Freigeräumt wird im gemeinsamen Raster nur um den Punkt.** Ein Ziel mit Wasser oder Fluss im
 *   Umkreis bekommt einen eigenen A* auf einer eigenen Kopie; sonst öffnete sein Freiräumen den See für
 *   alle anderen.
 * - 🔴 **Auch dieser eigene A* zahlt jede Furt** (Betreiber 2026-09-24: „eigentlich sollte das nicht“).
 *   Legacys Code übergibt ihm die Furten nicht (`offroad-grid.php:1044`, MCS-021 Widerspruch 2) - dort
 *   querte ein Ausstieg am Ufer jeden Bach umsonst.
 */
export function nearestReachable(
    planes: OffroadPlanes,
    cost: OffroadCost,
    point: Point,
    goals: readonly Point[],
    roadAt: ((road: number, x: number, y: number) => [number, number] | null) | null = null,
): { index: number; path: OffroadPath; roads: { road: number; at: [number, number]; path: OffroadPath }[] } | null {
    const { box } = planes;
    const blocked = (planes.blocked as Uint8Array).slice();
    freeAround(box, blocked, point.x, point.y, freeing(cost));
    const start = indexOf(box, point.x, point.y);

    const isolated: number[] = [];
    const open = new Map<number, number[]>();
    let found = Infinity;
    goals.forEach((goal, index) => {
        if (hasBlockedNear(box, blocked, goal.x, goal.y)) {
            isolated.push(index);
            return;
        }
        const cell = indexOf(box, goal.x, goal.y);
        if (cell === start) {
            found = Math.min(found, index);
            return;
        }
        const waiting = open.get(cell);
        if (waiting) waiting.push(index);
        else open.set(cell, [index]);
    });
    const lowestOpen = (): number => Math.min(Infinity, ...[...open.values()].flat());

    const atEnds = new Set([start, ...open.keys()]);
    const shared = new SearchBuffers(box.cellCount);
    const search = new GridSearch(
        box,
        blocked,
        planes.fords,
        wallsOf(planes, cost),
        planes.ground,
        planes.relief ?? null,
        atEnds,
        cost,
        null,
        shared,
    );
    search.start(start);
    let waitingFor = lowestOpen();
    let exhausted = false;
    // Je Landweg die erste Zelle, die der Lauf schließt: wo man ihn zu Fuß am schnellsten erreicht
    // (WI-0030 q), in der Reihenfolge der Kosten.
    const firstByRoad = new Map<number, number>();
    const explore = (toTheEnd: boolean): void => {
        while (toTheEnd || waitingFor < found) {
            const cell = search.next();
            if (cell < 0) {
                exhausted = true;
                return;
            }
            const road = (planes.roads?.[cell] ?? 0) - 1;
            if (road >= 0 && !firstByRoad.has(road)) firstByRoad.set(road, cell);
            const reached = open.get(cell);
            if (reached) {
                open.delete(cell);
                found = Math.min(found, ...reached);
                waitingFor = lowestOpen();
            }
            search.expand(cell);
        }
    };
    explore(false);
    // Liegt ein Ziel mit eigenem Lauf vorn, wird die Gegend des Punkts zu Ende abgesucht: Dann sagt
    // schon sein freigeräumter Kreis, ob sein A* ankommen kann - ein A*, der scheitern muss, sucht
    // sonst die ganze Gegenseite ab (gemessen bis 300 ms an einer Insel).
    if (!exhausted && isolated.some((index) => index < found)) explore(true);

    // Die eigenen A* der ufernahen Ziele laufen nacheinander und teilen sich ihre Felder.
    let spare: SearchBuffers | undefined;
    for (const index of isolated) {
        if (index > found) break;
        const goal = goals[index] as Point;
        if (!touchesRegion(box, search, goal)) continue;
        spare ??= new SearchBuffers(box.cellCount);
        const path = findPathOn(planes, blocked, cost, goal, point, spare);
        if (path) return { index, path, roads: roadPaths(goal) };
    }
    if (found === Infinity) return null;

    const goal = goals[found] as Point;
    return { index: found, path: traced(indexOf(box, goal.x, goal.y), [goal.x, goal.y]), roads: roadPaths(goal) };

    /** Der Weg des Laufs von einer Zelle zurück zum Punkt, mit `end` statt ihrer Mitte - die Richtung des Reisenden. */
    function traced(cell: number, end: [number, number]): OffroadPath {
        const points = cell === start ? [] : search.trace(cell, start).map((each) => centreOf(box, each));
        if (points.length < 2) points.splice(0, points.length, [0, 0], [0, 0]);
        points[0] = end;
        points[points.length - 1] = [point.x, point.y];
        return finishPath(planes, cost, pullTaut(planes, blocked, cost, points), true);
    }

    /** Die Landwege, die der Lauf vor dem gewählten Ziel erreicht hat, je Weg die erste Stelle. */
    function roadPaths(goal: Point): { road: number; at: [number, number]; path: OffroadPath }[] {
        if (!roadAt) return [];
        const goalCell = indexOf(box, goal.x, goal.y);
        const paths: { road: number; at: [number, number]; path: OffroadPath }[] = [];
        for (const [road, cell] of firstByRoad) {
            if (cell === goalCell) continue;
            const [x, y] = centreOf(box, cell);
            const at = roadAt(road, x, y);
            if (at) paths.push({ road, at, path: traced(cell, at) });
            if (paths.length === ROAD_ALTERNATIVES) break;
        }
        return paths;
    }
}

/** So viele Landwege bietet ein Gang höchstens zusätzlich an (WI-0030 q), die zuerst erreichten. */
const ROAD_ALTERNATIVES = 6;

/** Wie ein gerades Stück das Raster berührt: frei, durch ein Bachbett, oder durch eine gesperrte Zelle. */
const CLEAR = 0;
const WET = 1;
const BLOCKED = 2;

/**
 * Jede Zelle, die die Strecke berührt, in Vierteln einer Zelle abgetastet, samt der Eckzellen eines
 * schrägen Schritts - strenger als die Suche, die zwischen zwei gesperrten Ecken hindurchgeht.
 */
function sightline(
    box: OffroadBox,
    grid: Uint8Array,
    fords: FordPlanes | null,
    walls: FordPlanes | null,
    ground: Float32Array | null,
    relief: ReliefPlane | null,
    from: Point,
    to: Point,
): number {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (box.cell * 0.25)));
    let result = CLEAR;
    const blockedAt = (column: number, row: number): boolean => {
        if (column < 0 || row < 0 || column >= box.cols || row >= box.rows) return true;
        const index = row * box.cols + column;
        if (grid[index] !== 0) return true;
        if (
            (fords && fords.wade[index] !== 0) ||
            (walls && walls.wade[index] !== 0) ||
            (ground && ground[index] !== 0) ||
            (relief && relief.kind[index] !== 0)
        ) {
            result = WET;
        }
        return false;
    };
    let previousColumn = -1;
    let previousRow = -1;
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const column = Math.floor((from.x + (to.x - from.x) * t - box.minX) / box.cell);
        const row = Math.floor((from.y + (to.y - from.y) * t - box.minY) / box.cell);
        if (column === previousColumn && row === previousRow) continue;
        if (blockedAt(column, row)) return BLOCKED;
        if (previousColumn >= 0 && column !== previousColumn && row !== previousRow) {
            if (blockedAt(previousColumn, row) || blockedAt(column, previousRow)) return BLOCKED;
        }
        previousColumn = column;
        previousRow = row;
    }
    return result;
}

/**
 * Zieht die Linie der Suche straff (Betreiber 2026-09-24: „mit catmull rom glätten“, Entscheidung l):
 * Von jedem festen Punkt springt die Linie zum weitesten Punkt der Treppe, den sie ohne gesperrte Zelle
 * erreicht - durch ein Bachbett nur, wenn sie dabei nicht teurer wird als die Treppe, die sie ersetzt
 * (Waten, Furt). So läuft der Gang schräg um das Hindernis statt im 45°-Zickzack der Zellen.
 *
 * Entschieden hat die Suche; die Linie wird nur kürzer, nie teurer. Legacy zeichnet die Treppe; die
 * Längen gesuchter Gänge liegen hier deshalb etwas unter Legacys.
 */
function pullTaut(
    planes: OffroadPlanes,
    grid: Uint8Array,
    cost: OffroadCost,
    points: [number, number][],
): [number, number][] {
    if (points.length <= 2) return points;
    const at = (index: number): Point => {
        const [x, y] = points[index] as [number, number];
        return { x, y };
    };
    const ends = new Set([
        indexOf(planes.box, (points[0] as [number, number])[0], (points[0] as [number, number])[1]),
        indexOf(
            planes.box,
            (points[points.length - 1] as [number, number])[0],
            (points[points.length - 1] as [number, number])[1],
        ),
    ]);
    const priced = { ground: !cost.byDistance, crossings: true, atEnds: ends };
    const upTo = [0];
    for (let index = 1; index < points.length; index += 1) {
        upTo.push((upTo[index - 1] as number) + segmentCost(planes, cost, at(index - 1), at(index), priced));
    }
    const pulled: [number, number][] = [points[0] as [number, number]];
    let anchor = 0;
    while (anchor < points.length - 1) {
        let reach = anchor + 1;
        for (let candidate = anchor + 2; candidate < points.length; candidate += 1) {
            const seen = sightline(
                planes.box,
                grid,
                planes.fords,
                wallsOf(planes, cost),
                cost.byDistance ? null : planes.ground,
                cost.byDistance ? null : (planes.relief ?? null),
                at(anchor),
                at(candidate),
            );
            if (seen === BLOCKED) break;
            if (seen === WET) {
                const straight = segmentCost(planes, cost, at(anchor), at(candidate), priced);
                if (straight > (upTo[candidate] as number) - (upTo[anchor] as number) + TIE) continue;
            }
            reach = candidate;
        }
        pulled.push(points[reach] as [number, number]);
        anchor = reach;
    }
    return pulled;
}

/**
 * Was ein gerades Stück kostet, in der Einheit jeder Kante und ohne Längenaufschlag: in halben
 * Zellschritten abgetastet, mit dem Watfaktor, wo `ground` gilt, und jeder Querung, die es schneidet.
 */
function segmentCost(
    planes: Pick<OffroadPlanes, "box" | "fords"> & {
        walls?: FordPlanes | null;
        ground?: Float32Array | null;
        relief?: ReliefPlane | null;
    },
    cost: OffroadCost,
    from: Point,
    to: Point,
    options: { ground: boolean; crossings: boolean; atEnds?: ReadonlySet<number> },
): number {
    const { box, fords } = planes;
    const walls = wallsOf(planes, cost);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length <= 0) return 0;
    const steps = Math.max(1, Math.ceil(length / (box.cell * 0.5)));
    const stepLength = length / steps;
    let time = 0;
    let previousX = from.x;
    let previousY = from.y;
    for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        let factor = options.ground ? terrainAt({ box, fords, ground: planes.ground ?? null }, x, y) : 1;
        if (options.ground && planes.relief) {
            factor = reliefGroundBetween(box, planes.relief, factor, previousX, previousY, x, y);
        }
        time += (stepLength / cost.speed) * factor;
        if (options.crossings) {
            const fromCell = indexOf(box, previousX, previousY);
            const toCell = indexOf(box, x, y);
            let price = crossingUnits(box, fords, cost.crossingUnits, fromCell, toCell, previousX, previousY, x, y);
            if (walls && !options.atEnds?.has(fromCell) && !options.atEnds?.has(toCell)) {
                price += crossingUnits(box, walls, cost.riverUnits, fromCell, toCell, previousX, previousY, x, y);
            }
            time += price / cost.speed;
        }
        previousX = x;
        previousY = y;
    }
    return time;
}

/**
 * Vereinfacht die Linie und misst Länge und Zeit an genau ihr (Legacy `avesmapsOffroadFinishPath`):
 * nicht aus den Kosten der Suche, denn die gehören zur Treppe, nicht zur Linie darunter. Abgetastet
 * wird in halben Zellschritten - so zahlt die Linie das Waten, wo sie durch ein Bachbett läuft, und
 * jede Querung, die sie wirklich schneidet (`withCrossings`).
 *
 * Der Längenaufschlag gilt der Luftlinie der Etappe, nicht der gelaufenen Strecke: Für feste Enden ist
 * er eine Konstante und verschiebt kein Minimum der Suche. Die Länge trägt ihn nie.
 */
export function finishPath(
    planes: Pick<OffroadPlanes, "box" | "fords"> & {
        walls?: FordPlanes | null;
        ground?: Float32Array | null;
        relief?: ReliefPlane | null;
        /** Die gesperrten Zellen der Kiste; mit ihnen wird die gezeichnete Linie begradigt (`straightenForDisplay`). */
        blocked?: Uint8Array | null;
    },
    cost: OffroadCost,
    raw: readonly [number, number][],
    withCrossings: boolean,
): OffroadPath {
    const points = simplifyLine(raw, werte().simplifyEpsilon);
    const [firstX, firstY] = points[0] as [number, number];
    const [lastX, lastY] = points[points.length - 1] as [number, number];
    const atEnds = new Set([indexOf(planes.box, firstX, firstY), indexOf(planes.box, lastX, lastY)]);
    let distance = 0;
    let time = 0;
    let flat = 0;
    // Die Bezugslinie der Mehrzeit (S5d): dasselbe Gelände, aber jeder Schritt eben.
    const plain = planes.relief ? { ...planes, relief: levelPlane(planes.relief) } : null;
    for (let index = 1; index < points.length; index += 1) {
        const [fromX, fromY] = points[index - 1] as [number, number];
        const [toX, toY] = points[index] as [number, number];
        const from = { x: fromX, y: fromY };
        const to = { x: toX, y: toY };
        const options = { ground: true, crossings: withCrossings, atEnds };
        distance += Math.hypot(toX - fromX, toY - fromY);
        time += segmentCost(planes, cost, from, to, options);
        if (plain) flat += segmentCost(plain, cost, from, to, options);
    }
    const ramp = cost.ramp(Math.hypot(lastX - firstX, lastY - firstY));
    const display = straightenForDisplay(planes, cost, points);
    return {
        points,
        distance,
        time: time * ramp,
        ...(plain ? { levelTime: flat * ramp } : {}),
        ...(display ? { display } : {}),
    };
}

/**
 * Die gezeichnete Linie eines gesuchten Gangs: Douglas-Peucker mit `DISPLAY_EPSILON`, aber ein Stück ersetzt nur, wer
 * über freies Gelände läuft - `sightline` ohne Boden und Höhe, also ohne gesperrte Zelle, Furt und Fluss. Wo das
 * nicht geht, bleibt die Treppe. Null, wenn die Linie danach nicht kürzer ist als `points` (oder ohne Sperre).
 */
function straightenForDisplay(
    planes: Pick<OffroadPlanes, "box" | "fords"> & { walls?: FordPlanes | null; blocked?: Uint8Array | null },
    cost: OffroadCost,
    points: readonly [number, number][],
): [number, number][] | null {
    const grid = planes.blocked;
    if (!grid || points.length <= 2) return null;
    const walls = wallsOf(planes, cost);
    const open = (from: [number, number], to: [number, number]): boolean =>
        sightline(
            planes.box,
            grid,
            planes.fords,
            walls,
            null,
            null,
            { x: from[0], y: from[1] },
            { x: to[0], y: to[1] },
        ) === CLEAR;
    const line = simplifyLine(points, werte().displayEpsilon, open);
    return line.length < points.length ? line : null;
}

/**
 * Douglas-Peucker mit einem echten Epsilon in Karteneinheiten (Legacy
 * `avesmapsSimplifyLineDouglasPeucker`). Die beiden Enden bleiben immer stehen. Mit `accepts` ersetzt eine gerade
 * Linie ihr Stück nur, wenn sie von Punkt zu Punkt angenommen wird; sonst wird dort geteilt wie bei zu großer
 * Abweichung.
 */
export function simplifyLine(
    points: readonly [number, number][],
    epsilon: number,
    accepts?: (from: [number, number], to: [number, number]) => boolean,
): [number, number][] {
    const count = points.length;
    if (count <= 2 || epsilon <= 0) return [...points];
    const keep = new Uint8Array(count);
    keep[0] = 1;
    keep[count - 1] = 1;
    const stack: [number, number][] = [[0, count - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop() as [number, number];
        if (last <= first + 1) continue;
        const [x1, y1] = points[first] as [number, number];
        const [x2, y2] = points[last] as [number, number];
        const deltaX = x2 - x1;
        const deltaY = y2 - y1;
        const lengthSquared = deltaX * deltaX + deltaY * deltaY;
        let worst = -1;
        let worstIndex = -1;
        for (let index = first + 1; index < last; index += 1) {
            const [px, py] = points[index] as [number, number];
            let distance: number;
            if (lengthSquared <= 0) {
                distance = Math.hypot(px - x1, py - y1);
            } else {
                const t = Math.max(0, Math.min(1, ((px - x1) * deltaX + (py - y1) * deltaY) / lengthSquared));
                distance = Math.hypot(px - (x1 + t * deltaX), py - (y1 + t * deltaY));
            }
            if (distance > worst) {
                worst = distance;
                worstIndex = index;
            }
        }
        const refused =
            worst <= epsilon &&
            accepts !== undefined &&
            !accepts(points[first] as [number, number], points[last] as [number, number]);
        if ((worst > epsilon || refused) && worstIndex > 0) {
            keep[worstIndex] = 1;
            stack.push([first, worstIndex], [worstIndex, last]);
        }
    }
    return points.filter((_, index) => keep[index] === 1);
}
