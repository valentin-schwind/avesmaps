import { riverLinesNear, type FordLine, type RiverLine, type Rivers } from "./rivers.ts";
import { NO_GROUND, type Ground } from "./ground.ts";
import { KIND_MOUNTAIN, reliefPlane, type ReliefPlane, type ReliefWorld } from "./relief.ts";
import type { VehicleBarrier } from "./vehicle-barrier.ts";
import { werte } from "./einstellungen.ts";
import type { Edges, Water } from "./water.ts";

/**
 * Das Raster des gebogenen Gangs querfeldein (WI-0030 R7, MCS-021): Legacys `offroad-grid.php` und
 * `offroad-data.php` (avesmaps@770c80e), ohne Boden und Höhe. Gesucht wird darauf in
 * `offroad-search.ts`.
 *
 * - **Die Kiste** umfasst die Punkte samt Rand, damit der Weg um ein Hindernis ausbeulen kann. Ihre
 *   Zelle ist 0,25 Einheiten breit; über 150.000 Zellen verdoppelt sie sich, für diese eine Anfrage.
 * - **Gesperrt** sind Meer und See (jede Zelle, die ihre Fläche berührt) und jeder Fluss (jede Zelle,
 *   die seine Linie berührt, samt der Eckzellen - sonst schlüpfte der Achter-Schritt diagonal durch).
 *   Land kommt nicht ins Raster: Küste, Inselgruppe und Lücken sind begehbar (Entscheidung g).
 * - **Ein Bach sperrt nicht.** Er bremst, wer in seinem Bett watet, und kostet je Querung (Furt).
 * - **Der Boden bremst** (WI-0030 R8): Wald, Sumpf, Dschungel, Wüste, Tundra mit ihrem Faktor, jede
 *   berührte Zelle, überlagert per Maximum - auch mit dem Bachbett (Legacy `offroad-data.php`).
 * - **Freigeräumt** wird im Umkreis der Küstentoleranz um den Kartenpunkt: Ein Punkt am Ufer oder direkt
 *   am Fluss wäre sonst eingemauert (Entscheidung g). 🔴 Einen Fluss räumt nur frei, wer ihn queren
 *   darf (Betreiber 2026-09-24, WI-0030 m): Sonst bleibt er Wand bis auf die eigene Zelle der Enden.
 *   Wer ihn quert, zahlt dafür wie an einer Furt (`walls`). 🔴 Ebenso ein See (Betreiber 2026-09-25,
 *   WI-0030 o): Den räumt nur Legacys Küstenregel frei, der letzte Rückfall.
 *
 * Die Ebenen entstehen je Anfrage und gehören ihr allein; Kiste und Deckel begrenzen sie.
 * ⭐ Legacy hält jede Ebene als ein Byte je Zelle, weil ein PHP-Feld 33 Byte je Zahl kostet. Hier sind es
 * typisierte Felder: Der Watfaktor bleibt ungerundet, statt auf Vielfache von 0,04 zu fallen.
 */

/** Zellbreite in Karteneinheiten (Legacy `AVESMAPS_ROUTE_OFFROAD_CELL_MAPUNITS`, Owner 31.08.2026). */
export const CELL_UNITS = 0.25;
/** So viele Zellen hat eine Kiste höchstens; darüber verdoppelt sich die Zelle (`…_CELL_LIMIT`). */
export const CELL_LIMIT = 150_000;
/** Rand der Kiste: 30 % der Diagonale, mindestens 2 Einheiten (`…_BOX_MARGIN_FRACTION`, `…_MIN`). */
const MARGIN_FRACTION = 0.3;
const MARGIN_MIN = 2;
/** Linien werden in Schritten unter einer halben Zelle abgetastet: So wird keine Zelle übersprungen. */
const LINE_STEP = 0.4;
/** Ein Bachstück als Zahl: Linie mal diesem Wert plus Stück. Eine Linie hat weit weniger Stücke. */
const SEGMENT_STRIDE = 65_536;
/** Was eine Zelle sperrt: Meer oder See, oder ein Fluss - nur den räumt `freeAround` nicht immer frei. */
export const WATER = 1;
export const WALL = 2;
/**
 * Gesperrtes Land der Wagen (WI-0258, `vehicle-barrier.ts`): Wald, Sumpf und die anderen Landschaften, die nicht offen sind,
 * und die Gebirgsflächen. Ein eigenes Bit neben `WATER` und `WALL`: `freeAround` räumt es nie frei (es vergleicht auf
 * Gleichheit mit `WATER` und `WALL`), und es verlangt keinen eigenen Lauf für ein Ziel am Rand (`hasBlockedNear`).
 */
export const BARRIER = 4;

export interface OffroadBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    cell: number;
    cols: number;
    rows: number;
    cellCount: number;
    /** Die Zelle ist gröber als verlangt, weil die Kiste sonst über dem Deckel läge. */
    coarsened: boolean;
}

/** Die Kiste über zwei Punkten (oder einer Hülle): Rand dazu, auf ganze Zellen gebracht. */
export function buildOffroadBox(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    cell = werte().cellUnits,
    cellLimit = werte().cellLimit,
): OffroadBox {
    const margin = Math.max(MARGIN_MIN, Math.hypot(x2 - x1, y2 - y1) * MARGIN_FRACTION);
    const minX = Math.min(x1, x2) - margin;
    const minY = Math.min(y1, y2) - margin;
    const width = Math.max(x1, x2) + margin - minX;
    const height = Math.max(y1, y2) + margin - minY;
    const requested = cell > 0 ? cell : werte().cellUnits;
    let size = requested;
    let cols = Math.ceil(width / size) + 1;
    let rows = Math.ceil(height / size) + 1;
    // Verdoppeln, nicht einpassen: So bleibt die gemeldete Breite ein Vielfaches der verlangten.
    while (cols * rows > cellLimit) {
        size *= 2;
        cols = Math.ceil(width / size) + 1;
        rows = Math.ceil(height / size) + 1;
    }
    return {
        minX,
        minY,
        maxX: minX + cols * size,
        maxY: minY + rows * size,
        cell: size,
        cols,
        rows,
        cellCount: cols * rows,
        coarsened: size > requested,
    };
}

/** Die Spalte eines Kartenpunkts, in die Kiste geklemmt. */
export function columnOf(box: OffroadBox, x: number): number {
    const column = Math.floor((x - box.minX) / box.cell);
    return column < 0 ? 0 : column >= box.cols ? box.cols - 1 : column;
}

/** Die Zeile eines Kartenpunkts, in die Kiste geklemmt. */
export function rowOf(box: OffroadBox, y: number): number {
    const row = Math.floor((y - box.minY) / box.cell);
    return row < 0 ? 0 : row >= box.rows ? box.rows - 1 : row;
}

export function indexOf(box: OffroadBox, x: number, y: number): number {
    return rowOf(box, y) * box.cols + columnOf(box, x);
}

export const centreX = (box: OffroadBox, column: number): number => box.minX + (column + 0.5) * box.cell;
export const centreY = (box: OffroadBox, row: number): number => box.minY + (row + 0.5) * box.cell;

type Area = { edges: Edges; minX: number; minY: number; maxX: number; maxY: number };

/**
 * Jede Zelle, die eine Fläche berührt - die sichere Richtung für ein Hindernis und für einen Boden, der
 * bremst. Zwei Durchgänge (Legacy `avesmapsOffroadForEachTouchedCell`): das Innere nach Zellmitte, und
 * der Umriss in halben Zellschritten, damit nichts Schmaleres als eine Zelle durchrutscht.
 */
function forEachTouchedCell(box: OffroadBox, area: Area, mark: (index: number) => void): void {
    if (area.minX > box.maxX || area.maxX < box.minX || area.minY > box.maxY || area.maxY < box.minY) return;
    const { cell, cols, rows } = box;
    const edges = area.edges;
    const rowFrom = Math.max(0, Math.floor((area.minY - box.minY) / cell) - 1);
    const rowTo = Math.min(rows - 1, Math.ceil((area.maxY - box.minY) / cell) + 1);
    const columnFrom = Math.max(0, Math.floor((area.minX - box.minX) / cell) - 1);
    const columnTo = Math.min(cols - 1, Math.ceil((area.maxX - box.minX) / cell) + 1);

    // Das Innere: derselbe Strahltest wie `areasContainPoint`, aber je Zeile einmal. Jede Kante trägt
    // ihren Schnitt in die Zeilen ein, deren Mitte sie überspannt; eine Zellmitte liegt innen, wenn
    // rechts von ihr eine ungerade Zahl Schnitte liegt.
    if (rowFrom <= rowTo && columnFrom <= columnTo) {
        const crossings: number[][] = Array.from({ length: rowTo - rowFrom + 1 }, () => []);
        for (let offset = 0; offset < edges.length; offset += 4) {
            const x1 = edges[offset] as number;
            const y1 = edges[offset + 1] as number;
            const x2 = edges[offset + 2] as number;
            const y2 = edges[offset + 3] as number;
            if (y1 === y2) continue;
            const first = Math.max(rowFrom, Math.ceil((Math.min(y1, y2) - box.minY) / cell - 0.5) - 1);
            const last = Math.min(rowTo, Math.floor((Math.max(y1, y2) - box.minY) / cell - 0.5) + 1);
            for (let row = first; row <= last; row += 1) {
                const y = centreY(box, row);
                if (y1 > y === y2 > y) continue;
                (crossings[row - rowFrom] as number[]).push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
            }
        }
        for (let row = rowFrom; row <= rowTo; row += 1) {
            const list = crossings[row - rowFrom] as number[];
            if (list.length === 0) continue;
            const xs = Float64Array.from(list).sort();
            let passed = 0;
            for (let column = columnFrom; column <= columnTo; column += 1) {
                const x = centreX(box, column);
                while (passed < xs.length && (xs[passed] as number) <= x) passed += 1;
                if ((xs.length - passed) % 2 === 1) mark(row * cols + column);
            }
        }
    }

    // Der Umriss, in halben Zellschritten.
    const half = cell * 0.5;
    for (let offset = 0; offset < edges.length; offset += 4) {
        const x1 = edges[offset] as number;
        const y1 = edges[offset + 1] as number;
        const x2 = edges[offset + 2] as number;
        const y2 = edges[offset + 3] as number;
        if (Math.max(x1, x2) < box.minX || Math.min(x1, x2) > box.maxX) continue;
        if (Math.max(y1, y2) < box.minY || Math.min(y1, y2) > box.maxY) continue;
        const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / half);
        for (let step = 0; step <= steps; step += 1) {
            const t = steps === 0 ? 0 : step / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            if (x < box.minX || y < box.minY || x > box.maxX || y > box.maxY) continue;
            mark(indexOf(box, x, y));
        }
    }
}

/**
 * Jede Zelle, die eine Linie berührt, samt der beiden Eckzellen eines Treppenschritts (Legacy
 * `avesmapsOffroadForEachLineCell`): Zwischen zwei diagonal benachbarten Zellen schlüpfte der
 * Achter-Schritt sonst hindurch - an einer Wand wäre die Sperre wirkungslos, an einer Furt die Querung
 * gratis. `mark` bekommt Zelle und Stück der Linie. Wie in Legacy fallen Stützstellen außerhalb der
 * Kiste auf ihren Rand.
 */
function forEachLineCell(
    box: OffroadBox,
    coordinates: readonly [number, number][],
    mark: (index: number, segment: number) => void,
): void {
    const step = box.cell * LINE_STEP;
    for (let segment = 0; segment < coordinates.length - 1; segment += 1) {
        const [ax, ay] = coordinates[segment] as [number, number];
        const [bx, by] = coordinates[segment + 1] as [number, number];
        if (Math.max(ax, bx) < box.minX || Math.min(ax, bx) > box.maxX) continue;
        if (Math.max(ay, by) < box.minY || Math.min(ay, by) > box.maxY) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        let previousColumn = -1;
        let previousRow = -1;
        for (let sample = 0; sample <= steps; sample += 1) {
            const t = sample / steps;
            const column = columnOf(box, ax + (bx - ax) * t);
            const row = rowOf(box, ay + (by - ay) * t);
            mark(row * box.cols + column, segment);
            if (previousColumn >= 0 && previousColumn !== column && previousRow !== row) {
                mark(row * box.cols + previousColumn, segment);
                mark(previousRow * box.cols + column, segment);
            }
            previousColumn = column;
            previousRow = row;
        }
    }
}

/**
 * Die Sperre: Meer und See (`WATER`), Flüsse (`WALL`, sie gehen vor) der Kiste, dazu das gesperrte Land eines Wagens
 * (`BARRIER`, jede Zelle, die eine Sperrfläche berührt oder deren Mitte in einer Gebirgsfläche liegt).
 */
export function blockedPlane(
    box: OffroadBox,
    water: Water,
    walls: readonly RiverLine[],
    barrier: VehicleBarrier | null = null,
    relief: ReliefPlane | null = null,
): Uint8Array {
    const blocked = new Uint8Array(box.cellCount);
    for (const area of water.areas) {
        forEachTouchedCell(box, area, (index) => {
            blocked[index] = WATER;
        });
    }
    for (const wall of walls) {
        forEachLineCell(box, wall.coordinates, (index) => {
            blocked[index] = WALL;
        });
    }
    if (barrier) {
        for (const area of barrier.areas) {
            forEachTouchedCell(box, area, (index) => {
                blocked[index] = (blocked[index] as number) | BARRIER;
            });
        }
        if (barrier.mountains && relief) {
            for (let index = 0; index < box.cellCount; index += 1) {
                if (relief.kind[index] === KIND_MOUNTAIN) blocked[index] = (blocked[index] as number) | BARRIER;
            }
        }
    }
    return blocked;
}

/** Was die Bäche einer Kiste ausmacht: der Watfaktor je Zelle und, je Zelle, die Bachstücke darin. */
export interface FordPlanes {
    /** Watfaktor je Zelle; 0 heißt: kein Bach, es gilt 1. Wo zwei Bäche liegen, der teurere. */
    wade: Float64Array;
    /** Je Bachzelle die Bachstücke, die sie berühren (`Linie * SEGMENT_STRIDE + Stück`). */
    cells: Map<number, number[]>;
    fords: readonly FordLine[];
}

/** Die Bäche der Kiste; null, wenn keiner sie berührt. */
export function fordPlanes(box: OffroadBox, fords: readonly FordLine[]): FordPlanes | null {
    const wade = new Float64Array(box.cellCount);
    const cells = new Map<number, number[]>();
    fords.forEach((ford, line) => {
        forEachLineCell(box, ford.coordinates, (index, segment) => {
            if ((wade[index] as number) < ford.wade) wade[index] = ford.wade;
            const code = line * SEGMENT_STRIDE + segment;
            const list = cells.get(index);
            if (!list) cells.set(index, [code]);
            else if (!list.includes(code)) list.push(code);
        });
    });
    return cells.size === 0 ? null : { wade, cells, fords };
}

/** Der Watfaktor an einer Stelle; 1, wo kein Bach liegt. */
export function wadeAt(box: OffroadBox, fords: FordPlanes | null, x: number, y: number): number {
    if (!fords) return 1;
    const factor = fords.wade[indexOf(box, x, y)] as number;
    return factor === 0 ? 1 : factor;
}

/**
 * Der Boden der Kiste: je Zelle der Faktor der bremsenden Landschaft, die sie berührt, der größte bei
 * mehreren; 0 heißt offener Boden. Null, wenn keine Fläche die Kiste berührt.
 */
export function groundPlane(box: OffroadBox, ground: Ground): Float32Array | null {
    let plane: Float32Array | null = null;
    for (const area of ground.areas) {
        if (area.minX > box.maxX || area.maxX < box.minX || area.minY > box.maxY || area.maxY < box.minY) continue;
        const cells = (plane ??= new Float32Array(box.cellCount));
        forEachTouchedCell(box, area, (index) => {
            if ((cells[index] as number) < area.factor) cells[index] = area.factor;
        });
    }
    return plane;
}

/** Was eine Zelle bremst: der größere von Watfaktor und Boden, 1 auf offenem Boden. */
export function terrainAt(planes: Pick<OffroadPlanes, "box" | "fords" | "ground">, x: number, y: number): number {
    const wade = wadeAt(planes.box, planes.fords, x, y);
    const ground = planes.ground ? (planes.ground[indexOf(planes.box, x, y)] as number) : 0;
    return ground > wade ? ground : wade;
}

/** Schneiden sich die Strecken? Berührung zählt mit (Legacy `avesmapsOffroadSegmenteSchneiden`). */
function segmentsTouch(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): boolean {
    const denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(denominator) < 1e-12) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Was ein Schritt von Zelle `from` nach Zelle `to` an Querungen kostet, in Karteneinheiten
 * (Legacy `avesmapsOffroadFurtSchnittpreis`): je Bach, dessen Linie er wirklich schneidet, einmal
 * `units` mal Querungsfaktor. Wer längs im Bachbett läuft, quert nicht - das Waten bezahlt er über den
 * Watfaktor.
 *
 * Das Tor ist die Ebene: Trägt keine der beiden Zellen einen Bach, kann der Schritt keinen schneiden.
 * Gefragt werden dann nur die Bachstücke der Zellen, durch die der Schritt läuft - Legacy fragt jede
 * Linie der Kiste, mit demselben Ergebnis.
 */
export function crossingUnits(
    box: OffroadBox,
    fords: FordPlanes | null,
    units: number,
    from: number,
    to: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): number {
    if (!fords || (fords.wade[from] === 0 && fords.wade[to] === 0)) return 0;
    const fromRow = Math.floor(from / box.cols);
    const toRow = Math.floor(to / box.cols);
    const fromColumn = from - fromRow * box.cols;
    const toColumn = to - toRow * box.cols;
    const touched = [from, to];
    // Ein schräger Schritt läuft durch eine der beiden Eckzellen.
    if (fromRow !== toRow && fromColumn !== toColumn) {
        touched.push(fromRow * box.cols + toColumn, toRow * box.cols + fromColumn);
    }
    let price = 0;
    const counted: number[] = [];
    for (const index of touched) {
        for (const code of fords.cells.get(index) ?? []) {
            const line = Math.floor(code / SEGMENT_STRIDE);
            if (counted.includes(line)) continue;
            const ford = fords.fords[line] as FordLine;
            const segment = code - line * SEGMENT_STRIDE;
            const [cx, cy] = ford.coordinates[segment] as [number, number];
            const [dx, dy] = ford.coordinates[segment + 1] as [number, number];
            if (segmentsTouch(x1, y1, x2, y2, cx, cy, dx, dy)) {
                price += units * ford.factor;
                counted.push(line);
            }
        }
    }
    return price;
}

/**
 * Räumt die eigene Zelle frei und im Umkreis der Küstentoleranz, was `free` erlaubt: Meer und See
 * (`water`, WI-0030 o) und Flüsse (`rivers`, WI-0030 m). Sonst liegt ein Punkt am Ufer frei, bleibt
 * aber auf seiner Seite.
 */
export function freeAround(
    box: OffroadBox,
    blocked: Uint8Array,
    x: number,
    y: number,
    free: { water: boolean; rivers: boolean } = { water: true, rivers: true },
): void {
    blocked[indexOf(box, x, y)] = 0;
    forEachCellNear(box, x, y, (index) => {
        const value = blocked[index];
        if ((value === WATER && free.water) || (value === WALL && free.rivers)) blocked[index] = 0;
        return false;
    });
}

/**
 * Liegt im Umkreis der Küstentoleranz eine gesperrte Zelle? Ein solches Ziel bekommt einen eigenen
 * Lauf: Im gemeinsamen Raster öffnete sein Freiräumen den See für die Etappen aller anderen (Legacy
 * `avesmapsOffroadHasBlockedNear`, gemessen 14,01 statt 21,90 Einheiten quer durch einen See).
 */
export function hasBlockedNear(box: OffroadBox, blocked: Uint8Array, x: number, y: number): boolean {
    // Das gesperrte Land der Wagen bleibt auch nach dem Freiräumen gesperrt: Es braucht keinen eigenen Lauf.
    return forEachCellNear(box, x, y, (index) => ((blocked[index] as number) & (WATER | WALL)) !== 0);
}

/** Jede Zelle, deren Mitte höchstens die Küstentoleranz entfernt liegt; `visit` kann abbrechen. */
export function forEachCellNear(box: OffroadBox, x: number, y: number, visit: (index: number) => boolean): boolean {
    const column = columnOf(box, x);
    const row = rowOf(box, y);
    // Die eingestellte Küstentoleranz (WI-0214): Hier stand die Konstante, während `map-points.ts` den Wert las.
    const tolerance = werte().coastTolerance;
    const reach = Math.ceil(tolerance / box.cell);
    for (let nextRow = row - reach; nextRow <= row + reach; nextRow += 1) {
        if (nextRow < 0 || nextRow >= box.rows) continue;
        for (let nextColumn = column - reach; nextColumn <= column + reach; nextColumn += 1) {
            if (nextColumn < 0 || nextColumn >= box.cols) continue;
            if (Math.hypot(centreX(box, nextColumn) - x, centreY(box, nextRow) - y) > tolerance) continue;
            if (visit(nextRow * box.cols + nextColumn)) return true;
        }
    }
    return false;
}

/** Die Ebenen einer Kiste. Ohne Sperre wird nur gemessen, nicht gesucht. */
export interface OffroadPlanes {
    box: OffroadBox;
    blocked: Uint8Array | null;
    fords: FordPlanes | null;
    /**
     * Die Flüsse als Querungen, wo sie freigeräumt sind (WI-0030 m): Faktor 1, kein Waten. Den Preis
     * trägt die Suche (`OffroadCost.riverUnits`); nur mit Sperre.
     */
    walls: FordPlanes | null;
    /** Der Boden je Zelle (`groundPlane`), oder null ohne bremsende Landschaft in der Kiste. */
    ground: Float32Array | null;
    /** Je Zelle der Landweg, der sie berührt, als Nummer + 1 (`roadPlane`, WI-0030 q); nur mit Sperre. */
    roads: Int32Array | null;
    /** Höhe und Art je Zelle (WI-0049 S5b); null ohne Gebirge oder Gipfel in der Kiste. */
    relief?: ReliefPlane | null;
}

/**
 * Die Landwege der Kiste als Ziele der Suche (WI-0030 q): jede Zelle, durch die ein Weg läuft. Nur was
 * in der Kiste liegt - anders als eine Wand fällt ein Weg draußen nicht auf den Rand.
 */
export function roadPlane(box: OffroadBox, lines: readonly (readonly [number, number][])[]): Int32Array | null {
    let plane: Int32Array | null = null;
    const step = box.cell * LINE_STEP;
    for (const [number, line] of lines.entries()) {
        for (let segment = 0; segment < line.length - 1; segment += 1) {
            const [ax, ay] = line[segment] as [number, number];
            const [bx, by] = line[segment + 1] as [number, number];
            if (Math.max(ax, bx) < box.minX || Math.min(ax, bx) > box.maxX) continue;
            if (Math.max(ay, by) < box.minY || Math.min(ay, by) > box.maxY) continue;
            const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
            for (let sample = 0; sample <= steps; sample += 1) {
                const x = ax + ((bx - ax) * sample) / steps;
                const y = ay + ((by - ay) * sample) / steps;
                if (x < box.minX || y < box.minY || x > box.maxX || y > box.maxY) continue;
                const cells = (plane ??= new Int32Array(box.cellCount));
                const index = indexOf(box, x, y);
                if (cells[index] === 0) cells[index] = number + 1;
            }
        }
    }
    return plane;
}

/** Baut die Ebenen der Kiste; die Sperre nur, wenn gesucht wird. */
export function buildPlanes(
    box: OffroadBox,
    water: Water,
    rivers: Rivers,
    options: { search: boolean },
    ground: Ground = NO_GROUND,
    roads: readonly (readonly [number, number][])[] = [],
    heights: ReliefWorld | null = null,
    barrier: VehicleBarrier | null = null,
): OffroadPlanes {
    const lines = riverLinesNear(rivers, box.minX, box.minY, box.maxX, box.maxY);
    const relief = heights ? reliefPlane(box, heights.terrain, heights.model, heights.transport) : null;
    return {
        box,
        blocked: options.search ? blockedPlane(box, water, lines.walls, barrier, relief) : null,
        fords: fordPlanes(box, lines.fords),
        walls: options.search
            ? fordPlanes(
                  box,
                  lines.walls.map((wall) => ({ ...wall, factor: 1, wade: 1 })),
              )
            : null,
        ground: groundPlane(box, ground),
        roads: options.search && roads.length > 0 ? roadPlane(box, roads) : null,
        relief,
    };
}
