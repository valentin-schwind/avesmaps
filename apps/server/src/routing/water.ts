import type { Queryable } from "../database.ts";
import { werte } from "./einstellungen.ts";

/**
 * Offenes Wasser für die Route (WI-0017): Eine Querfeldein-Kante darf kein Meer und keinen See
 * queren. Legacys V13 (`water-areas.php`) auf Legacys V9-Kern (`ecosystem-line-intervals.php`),
 * avesmaps@bfec670, Zweig für Zweig übertragen - die halboffenen Vergleiche und die Lage der Probe
 * stehen dort, weil gemessene Fälle ohne sie falsch waren.
 *
 * Wasser sind die Flächen der Landschaftsregionen `meer` und `see` (`region_area`), nicht `kueste`
 * (das sperrte jeden Küstenweg), nicht `insel`.
 */

/**
 * Wasser näher als diese Strecke an einem Ende der Sehne ist Küstenzeichnung, keine Querung: Hafenorte
 * liegen auf der Küste, und das Meer ist großzügig über sie gezeichnet. Legacys Setzung
 * (AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE); eine Sehne unter 2 Einheiten ist damit nie nass.
 */
export const COAST_TOLERANCE = 1;
/** Wie viele nächste Kandidaten geprüft werden, wenn der nächste nass ist (Legacy: 25, gemessen). */
export const DRY_SEARCH_LIMIT = 25;
/** Zellbreite des Suchgitters in Karteneinheiten. */
const GRID_CELL = 32;
const EPSILON = 1e-9;

interface WaterArea {
    /** Alle Kanten aller Ringe, je vier Zahlen: x1, y1, x2, y2. */
    edges: Float64Array;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    /** Das Gitter über den Kanten (`edgeGridOf`), beim ersten Gebrauch gebaut; null bei wenigen Kanten. */
    grid?: EdgeGrid | null;
}

export interface Water {
    areas: WaterArea[];
    grid: Map<string, number[]>;
}

export const NO_WATER: Water = { areas: [], grid: new Map() };

type Position = [number, number];
type AreaGeometry = { type: string; coordinates?: unknown };
/** Kanten einer Fläche, je vier Zahlen; der Boden hält sie als 32-Bit-Zahlen (`ground.ts`). */
export type Edges = Float64Array | Float32Array;

/**
 * Jede Kante jedes Rings, Außenringe und Löcher gleich: Ein Loch braucht keinen Sonderfall, der
 * Strahltest zählt seine Kanten über die Parität mit. Der Schlusspunkt eines Rings wiederholt den
 * ersten und ergibt keine zusätzliche Kante. Was keine Fläche ist, hat keine Kanten.
 */
export function areaEdges(geometry: AreaGeometry): Float64Array {
    const rings =
        geometry.type === "Polygon"
            ? (geometry.coordinates as Position[][])
            : geometry.type === "MultiPolygon"
              ? (geometry.coordinates as Position[][][]).flat()
              : [];
    const values: number[] = [];
    for (const ring of rings) {
        for (let index = 0; index < ring.length - 1; index += 1) {
            const [x1, y1] = ring[index] as Position;
            const [x2, y2] = ring[index + 1] as Position;
            values.push(x1, y1, x2, y2);
        }
    }
    return Float64Array.from(values);
}

/**
 * Ein Gitter über den Kanten einer Fläche (WI-0117): Die Küste eines Meeres hat Tausende Kanten, und jede Sehne nahe an
 * ihr las früher alle. Das Gitter nennt zu einem Rechteck nur die Kanten, deren Kasten es berührt. Es ändert nichts am
 * Ergebnis: Die Schleife in `lineIntervals` verwirft ohnehin jede Kante, deren Kasten das Rechteck der Strecke nicht
 * berührt, und die Parität des Strahltests hängt nicht von der Reihenfolge der Kanten ab.
 */
export interface EdgeGrid {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Je Zelle die Nummern ihrer Kanten (CSR: `start`, `items`). Eine Kante steht in jeder Zelle, die ihr Kasten berührt. */
    start: Int32Array;
    items: Int32Array;
    /** Welche Kante in der laufenden Abfrage schon gesehen wurde (`mark`): Eine Kante steht in mehreren Zellen. */
    seen: Int32Array;
    mark: number;
    /** Die Kanten der letzten Abfrage. */
    found: Int32Array;
}

/** Zellbreite des Kantengitters in Karteneinheiten. */
const EDGE_CELL = 4;
/** Unter so vielen Kanten lohnt das Gitter nicht. */
const EDGE_GRID_MIN = 64;
const EDGE_GRID_MAX_CELLS = 1 << 20;

/** Baut das Gitter; null bei wenigen Kanten (`minEdges`) oder Kanten ohne endliche Koordinaten. */
export function buildEdgeGrid(edges: Edges, minEdges = EDGE_GRID_MIN): EdgeGrid | null {
    const count = edges.length / 4;
    if (count < minEdges || count === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let offset = 0; offset < edges.length; offset += 4) {
        minX = Math.min(minX, edges[offset] as number, edges[offset + 2] as number);
        maxX = Math.max(maxX, edges[offset] as number, edges[offset + 2] as number);
        minY = Math.min(minY, edges[offset + 1] as number, edges[offset + 3] as number);
        maxY = Math.max(maxY, edges[offset + 1] as number, edges[offset + 3] as number);
    }
    if (!Number.isFinite(minX + maxX + minY + maxY)) return null;
    let cell = EDGE_CELL;
    let cols = Math.floor((maxX - minX) / cell) + 1;
    let rows = Math.floor((maxY - minY) / cell) + 1;
    while (cols * rows > EDGE_GRID_MAX_CELLS) {
        cell *= 2;
        cols = Math.floor((maxX - minX) / cell) + 1;
        rows = Math.floor((maxY - minY) / cell) + 1;
    }
    const cells = cols * rows;
    /** Die Zellen, die der Kasten der Kante berührt: Spalten c0 bis c1, Zeilen r0 bis r1. */
    const spans = (offset: number): [number, number, number, number] => {
        const x1 = edges[offset] as number;
        const y1 = edges[offset + 1] as number;
        const x2 = edges[offset + 2] as number;
        const y2 = edges[offset + 3] as number;
        return [
            Math.floor((Math.min(x1, x2) - minX) / cell),
            Math.floor((Math.max(x1, x2) - minX) / cell),
            Math.floor((Math.min(y1, y2) - minY) / cell),
            Math.floor((Math.max(y1, y2) - minY) / cell),
        ];
    };
    // Zwei Durchgänge: erst zählen, dann füllen.
    const start = new Int32Array(cells + 1);
    for (let offset = 0; offset < edges.length; offset += 4) {
        const [c0, c1, r0, r1] = spans(offset);
        for (let r = r0; r <= r1; r += 1) {
            for (let c = c0; c <= c1; c += 1) start[r * cols + c + 1] = (start[r * cols + c + 1] as number) + 1;
        }
    }
    for (let index = 0; index < cells; index += 1)
        start[index + 1] = (start[index + 1] as number) + (start[index] as number);
    const items = new Int32Array(start[cells] as number);
    const fill = start.slice(0, cells);
    for (let offset = 0; offset < edges.length; offset += 4) {
        const [c0, c1, r0, r1] = spans(offset);
        for (let r = r0; r <= r1; r += 1) {
            for (let c = c0; c <= c1; c += 1) {
                const at = r * cols + c;
                items[fill[at] as number] = offset / 4;
                fill[at] = (fill[at] as number) + 1;
            }
        }
    }
    return {
        minX,
        minY,
        cell,
        cols,
        rows,
        start,
        items,
        seen: new Int32Array(count),
        mark: 0,
        found: new Int32Array(count),
    };
}

const gridColumn = (grid: EdgeGrid, x: number): number => Math.floor((x - grid.minX) / grid.cell);
const gridRow = (grid: EdgeGrid, y: number): number => Math.floor((y - grid.minY) / grid.cell);

/** Die Nummern aller Kanten, deren Kasten das Rechteck berührt, in `grid.found`; liefert ihre Zahl. */
function edgesTouching(grid: EdgeGrid, minX: number, maxX: number, minY: number, maxY: number): number {
    const c0 = Math.max(0, gridColumn(grid, minX));
    const c1 = Math.min(grid.cols - 1, gridColumn(grid, maxX));
    const r0 = Math.max(0, gridRow(grid, minY));
    const r1 = Math.min(grid.rows - 1, gridRow(grid, maxY));
    grid.mark += 1;
    let count = 0;
    for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
            const at = r * grid.cols + c;
            for (let item = grid.start[at] as number; item < (grid.start[at + 1] as number); item += 1) {
                const edge = grid.items[item] as number;
                if (grid.seen[edge] === grid.mark) continue;
                grid.seen[edge] = grid.mark;
                grid.found[count] = edge;
                count += 1;
            }
        }
    }
    return count;
}

/**
 * `pointInEdges` über das Gitter: Gezählt werden nur die Kanten, die den Strahl nach +x kreuzen können - die, deren Kasten
 * eine Zelle seiner Zeile rechts vom Punkt berührt (eine Spalte Zugabe links, gegen die Rundung der Zellnummer).
 */
function pointInGrid(x: number, y: number, edges: Edges, grid: EdgeGrid): boolean {
    const row = gridRow(grid, y);
    if (row < 0 || row >= grid.rows) return false;
    const c0 = Math.max(0, gridColumn(grid, x) - 1);
    grid.mark += 1;
    let inside = false;
    for (let c = c0; c < grid.cols; c += 1) {
        const at = row * grid.cols + c;
        for (let item = grid.start[at] as number; item < (grid.start[at + 1] as number); item += 1) {
            const edge = grid.items[item] as number;
            if (grid.seen[edge] === grid.mark) continue;
            grid.seen[edge] = grid.mark;
            const offset = edge * 4;
            const x1 = edges[offset] as number;
            const y1 = edges[offset + 1] as number;
            const x2 = edges[offset + 2] as number;
            const y2 = edges[offset + 3] as number;
            if (y1 > y === y2 > y) continue;
            if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) > x) inside = !inside;
        }
    }
    return inside;
}

/** Strahl nach +x, Kreuzungen über die Parität; halboffen, damit ein Eckpunkt nur einmal zählt. */
export function pointInEdges(x: number, y: number, edges: Edges): boolean {
    let inside = false;
    for (let offset = 0; offset < edges.length; offset += 4) {
        const x1 = edges[offset] as number;
        const y1 = edges[offset + 1] as number;
        const x2 = edges[offset + 2] as number;
        const y2 = edges[offset + 3] as number;
        if (y1 > y === y2 > y) continue;
        if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) > x) inside = !inside;
    }
    return inside;
}

/**
 * Wo die Strecke a + t·r (t in [0, 1)) die Kante ab `offset` schneidet: das t, sonst -1. `box` ist der Kasten der Strecke
 * (minX, maxX, minY, maxY); berührt ihn der Kasten der Kante nicht, gibt es keinen Schnitt.
 */
function cutOf(
    ax: number,
    ay: number,
    rx: number,
    ry: number,
    box: readonly [number, number, number, number],
    edges: Edges,
    offset: number,
): number {
    const ex1 = edges[offset] as number;
    const ey1 = edges[offset + 1] as number;
    const ex2 = edges[offset + 2] as number;
    const ey2 = edges[offset + 3] as number;
    if (Math.min(ex1, ex2) > box[1] || Math.max(ex1, ex2) < box[0]) return -1;
    if (Math.min(ey1, ey2) > box[3] || Math.max(ey1, ey2) < box[2]) return -1;
    const sx = ex2 - ex1;
    const sy = ey2 - ey1;
    const denominator = rx * sy - ry * sx;
    if (denominator === 0) return -1; // parallel oder deckungsgleich: kein einzelner Schnitt
    const qx = ex1 - ax;
    const qy = ey1 - ay;
    const t = (qx * sy - qy * sx) / denominator;
    if (t < 0 || t >= 1) return -1;
    const u = (qx * ry - qy * rx) / denominator;
    // 💣 Halboffen auf beiden Seiten: Eine Linie durch eine Polygonecke träfe sonst beide
    // Kanten, schaltete zweimal um, und die Durchfahrt verschwände.
    if (u < 0 || u >= 1) return -1;
    return t;
}

/**
 * Wo eine Linie durch eine Fläche läuft, als Bogenlänge vom Linienanfang. Mit `grid` (`buildEdgeGrid(edges)`) liest sie
 * nur die Kanten nahe der Linie statt aller; das Ergebnis ist dasselbe.
 */
export function lineIntervals(
    coordinates: readonly Position[],
    edges: Edges,
    grid: EdgeGrid | null = null,
): { enter: number; exit: number }[] {
    if (coordinates.length < 2 || edges.length === 0) return [];
    const cumulative = [0];
    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const [ax, ay] = coordinates[index] as Position;
        const [bx, by] = coordinates[index + 1] as Position;
        cumulative.push((cumulative[index] as number) + Math.hypot(bx - ax, by - ay));
    }
    const total = cumulative[cumulative.length - 1] as number;
    if (!(total > 0)) return [];

    const cuts: number[] = [];
    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const [ax, ay] = coordinates[index] as Position;
        const [bx, by] = coordinates[index + 1] as Position;
        const rx = bx - ax;
        const ry = by - ay;
        const segmentLength = Math.hypot(rx, ry);
        if (segmentLength === 0) continue;
        const box = [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)] as const;
        if (grid) {
            const near = edgesTouching(grid, box[0], box[1], box[2], box[3]);
            for (let at = 0; at < near; at += 1) {
                const t = cutOf(ax, ay, rx, ry, box, edges, (grid.found[at] as number) * 4);
                if (t >= 0) cuts.push((cumulative[index] as number) + t * segmentLength);
            }
        } else {
            for (let offset = 0; offset < edges.length; offset += 4) {
                const t = cutOf(ax, ay, rx, ry, box, edges, offset);
                if (t >= 0) cuts.push((cumulative[index] as number) + t * segmentLength);
            }
        }
    }
    cuts.sort((left, right) => left - right);
    const marks = [0, ...cuts, total];

    // 💣 Innen oder außen wird in der Mitte der ersten Spanne MIT Länge bestimmt, nie am Linienanfang:
    // Ein Anfang genau auf einer Kante ist die eine Stelle, an der der Strahltest nicht antworten kann.
    let probeIndex = 0;
    while (
        probeIndex < marks.length - 1 &&
        (marks[probeIndex + 1] as number) - (marks[probeIndex] as number) <= EPSILON
    ) {
        probeIndex += 1;
    }
    if (probeIndex >= marks.length - 1) return [];
    const probe = pointAt(
        coordinates,
        cumulative,
        ((marks[probeIndex] as number) + (marks[probeIndex + 1] as number)) / 2,
    );
    const insideAtProbe = grid ? pointInGrid(probe[0], probe[1], edges, grid) : pointInEdges(probe[0], probe[1], edges);

    const intervals: { enter: number; exit: number }[] = [];
    for (let index = 0; index < marks.length - 1; index += 1) {
        const inside = (index - probeIndex) % 2 === 0 ? insideAtProbe : !insideAtProbe;
        const enter = marks[index] as number;
        const exit = marks[index + 1] as number;
        if (inside && exit - enter > EPSILON) intervals.push({ enter, exit });
    }
    return intervals;
}

function pointAt(coordinates: readonly Position[], cumulative: readonly number[], distance: number): Position {
    const last = cumulative[cumulative.length - 1] as number;
    const clamped = Math.min(Math.max(distance, 0), last);
    for (let index = 0; index < cumulative.length - 1; index += 1) {
        const end = cumulative[index + 1] as number;
        if (clamped <= end) {
            const start = cumulative[index] as number;
            const t = end === start ? 0 : (clamped - start) / (end - start);
            const [ax, ay] = coordinates[index] as Position;
            const [bx, by] = coordinates[index + 1] as Position;
            return [ax + t * (bx - ax), ay + t * (by - ay)];
        }
    }
    return coordinates[coordinates.length - 1] as Position;
}

const cellKey = (x: number, y: number): string => `${String(x)}:${String(y)}`;

/** Flächen und ein Gitter darüber, einmal gebaut. */
export function prepareWater(
    rows: { geometry: AreaGeometry; minX: number; minY: number; maxX: number; maxY: number }[],
): Water {
    const areas: WaterArea[] = [];
    for (const row of rows) {
        const edges = areaEdges(row.geometry);
        if (edges.length === 0) continue;
        areas.push({ edges, minX: row.minX, minY: row.minY, maxX: row.maxX, maxY: row.maxY });
    }
    return { areas, grid: indexAreas(areas) };
}

/** Das Suchgitter über Flächen: je Gitterzelle die Flächen, deren Rechteck sie berührt. */
export function indexAreas(
    areas: readonly { minX: number; minY: number; maxX: number; maxY: number }[],
): Map<string, number[]> {
    const grid = new Map<string, number[]>();
    areas.forEach((area, index) => {
        for (let x = Math.floor(area.minX / GRID_CELL); x <= Math.floor(area.maxX / GRID_CELL); x += 1) {
            for (let y = Math.floor(area.minY / GRID_CELL); y <= Math.floor(area.maxY / GRID_CELL); y += 1) {
                const bucket = grid.get(cellKey(x, y)) ?? [];
                bucket.push(index);
                grid.set(cellKey(x, y), bucket);
            }
        }
    });
    return grid;
}

/**
 * Die Flächen aus JEDER Gitterzelle, die das Rechteck berührt. 💣 Eine lange Sehne trifft das Meer oft
 * erst in ihrer letzten Zelle.
 */
export function areasNear(
    grid: Map<string, number[]>,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): Set<number> {
    const found = new Set<number>();
    for (let x = Math.floor(minX / GRID_CELL); x <= Math.floor(maxX / GRID_CELL); x += 1) {
        for (let y = Math.floor(minY / GRID_CELL); y <= Math.floor(maxY / GRID_CELL); y += 1) {
            for (const index of grid.get(cellKey(x, y)) ?? []) found.add(index);
        }
    }
    return found;
}

/**
 * Liegt der Punkt in einer der Flächen? Das Gitter grenzt nur ein, entschieden wird an Kasten und
 * Kanten (Legacy `avesmapsRouteAreasContainPoint`). Dieselbe Frage an Wasser und an Land (`land.ts`).
 */
export function areasContainPoint(x: number, y: number, areas: Water): boolean {
    return areaIndexAt(x, y, areas) !== null;
}

/** Welche der Flächen den Punkt enthält, als ihr Index; null außerhalb aller. */
export function areaIndexAt(x: number, y: number, areas: Water): number | null {
    for (const index of areas.grid.get(cellKey(Math.floor(x / GRID_CELL), Math.floor(y / GRID_CELL))) ?? []) {
        const area = areas.areas[index] as WaterArea;
        if (area.minX > x || area.maxX < x || area.minY > y || area.maxY < y) continue;
        if (pointInEdges(x, y, area.edges)) return index;
    }
    return null;
}

/**
 * Am Ufer, wo ein See Wand bleibt (Betreiber 2026-09-25, WI-0030 o): So viel Wasser an den Enden einer
 * Sehne zählt nicht - eine Zelle des Rasters, für ein Ende, das auf der Uferlinie liegt.
 */
export const SHORE_TOLERANCE = 0.25;

/** Das Kantengitter der Fläche, beim ersten Gebrauch gebaut (null bei wenigen Kanten). */
function edgeGridOf(area: WaterArea): EdgeGrid | null {
    if (area.grid === undefined) area.grid = buildEdgeGrid(area.edges);
    return area.grid;
}

/**
 * Läuft die gerade Sehne durch offenes Wasser? Die nassen Stücke werden auf [T, Länge - T] beschnitten;
 * was übrig bleibt, ist eine Querung. Ohne Wasser immer nein. T ist Legacys Küstentoleranz, am Ufer
 * `SHORE_TOLERANCE`.
 */
export function chordCrossesWater(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    water: Water,
    tolerance = werte().coastTolerance,
): boolean {
    if (water.areas.length === 0) return false;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const low = tolerance;
    const high = length - tolerance;
    if (high <= low) return false;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const candidates = areasNear(water.grid, minX, minY, maxX, maxY);
    const chord: Position[] = [
        [x1, y1],
        [x2, y2],
    ];
    for (const index of candidates) {
        const area = water.areas[index] as WaterArea;
        if (area.minX > maxX || area.maxX < minX || area.minY > maxY || area.maxY < minY) continue;
        for (const interval of lineIntervals(chord, area.edges, edgeGridOf(area))) {
            if (Math.min(interval.exit, high) > Math.max(interval.enter, low)) return true;
        }
    }
    return false;
}

/** Die Meer- und Seeflächen der Kartendomäne. */
export async function loadWater(database: Queryable, mapDomainId: string): Promise<Water> {
    const rows = await database<{ geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]>`
        SELECT ST_AsGeoJSON(a.geom) AS geometry,
               ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
        FROM region_area a
        JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.region_type IN ('meer', 'see')
        ORDER BY a.public_id
    `;
    return prepareWater(
        rows.map((row) => ({
            geometry: JSON.parse(row.geometry) as AreaGeometry,
            minX: row.min_x,
            minY: row.min_y,
            maxX: row.max_x,
            maxY: row.max_y,
        })),
    );
}
