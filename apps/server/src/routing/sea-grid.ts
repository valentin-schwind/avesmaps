import { werte } from "./einstellungen.ts";
import { WATER_KINDS, type WaterKind } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { areaEdges, indexAreas } from "./water.ts";

/**
 * Das Wasserraster des freien Seeroutings (WI-0046, Plan 6.29-6.31): Meer und Seen der ganzen
 * Kartendomäne als ein Raster, einmal gebaut. Darauf sucht `sea-search.ts` den Weg zwischen zwei
 * Anlegestellen. Vorerst NUR für den Vergleich neben den Seewegen (M1 A); der Planer kennt es nicht.
 *
 * - **Wasser** sind die aktiven Flächen der Regionen `meer` und `see` (M3 B: auch die Binnenseen).
 *   Flüsse bleiben Wege, Küste und Flussdelta sind kein Wasser.
 * - **Befahrbar ist eine Zelle, deren Mitte im Wasser liegt.** Das ist die sichere Richtung für ein
 *   Schiff: Eine Zelle, die das Wasser nur streift, öffnete schmale Landzungen (Plan 6.31). Umgekehrt
 *   verschwände so eine Durchfahrt, die schmaler ist als eine Zelle.
 * - **Engstellen** (`connectNarrows`, Handover fjordhaefen 2026-11-09): Was in EINER gezeichneten Fläche
 *   zusammenhängt, hängt auch im Raster zusammen. Zerfällt eine Fläche in mehrere Wasserteile, weil ihre
 *   Einfahrt schmaler ist als eine Zelle (die Thorwaler Fjorde: 0,14 bis 0,38 E), sucht ein feineres Raster
 *   der Fläche den Weg durch die Engstelle, und die Zellen, durch die er führt, werden befahrbar. Zwei getrennt
 *   gezeichnete Flächen verbindet die Regel nicht, auch wenn sie sich berühren.
 * - **Zusammenhängend** sind Zellen über ihre vier Seiten. Die Suche geht auch schräg, aber nur, wenn
 *   beide Nachbarn der Ecke Wasser sind; so kann sie keine Ecke Land abschneiden, und der Zusammenhang
 *   über vier Seiten ist genau der, den sie erreicht.
 * - **Die Anlegestelle** eines Hafens ist die nächste befahrbare Zelle, höchstens `LANDING_REACH` von
 *   ihm entfernt (H1, Betreiber 2026-09-26). Gespeicherte Ausnahmen gibt es noch nicht.
 */

/** Zellbreite in Karteneinheiten (1 Einheit = 3 Meilen). Gemessen in WI-0046, siehe dort. */
export const SEA_CELL_UNITS = 0.5;
/** H1: So weit darf die Anlegestelle vom Hafen liegen, in Karteneinheiten (9 Meilen). */
export const LANDING_REACH = 3;

export const WATER_REGION_TYPES = WATER_KINDS;
export type WaterRegionType = WaterKind;

/** Ein zusammenhängendes Stück Wasser: ein Polygon samt Löchern, mit seinem Rahmen. */
export interface NavigablePolygon {
    edges: Float64Array;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface NavigableArea extends NavigablePolygon {
    /** Alle Kanten aller Ringe, je vier Zahlen: x1, y1, x2, y2 (`areaEdges`). */
    edges: Float64Array;
    regionName: string;
    regionType: WaterRegionType;
    areaPublicId: string;
    /** Die Glieder eines MultiPolygons einzeln, für die Engstellen; fehlt es, ist die Fläche ein Polygon. */
    polygons?: NavigablePolygon[];
}

export interface NavigableWater {
    areas: NavigableArea[];
    /** Das Suchgitter über den Flächen, wie in `water.ts` (`areasNear`, `areaIndexAt`). */
    grid: Map<string, number[]>;
}

export interface SeaGrid {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** 1, wo die Zellmitte in Meer oder See liegt. */
    water: Uint8Array;
    /** Der zusammenhängende Wasserteil je Zelle, ab 1; 0 an Land. */
    part: Int32Array;
    /** Zellen je Teil; Stelle 0 bleibt leer. */
    partCells: number[];
    /** Was `connectNarrows` verbunden hat; fehlt bei einem Raster ohne Engstellen. */
    narrows?: NarrowsReport;
}

type AreaGeometry = { type: string; coordinates?: unknown };
type Position = [number, number];

/** Die Glieder eines MultiPolygons mit mehr als einem Glied, je mit Kanten und Rahmen; sonst undefined. */
function polygonsOf(geometry: AreaGeometry): NavigablePolygon[] | undefined {
    if (geometry.type !== "MultiPolygon") return undefined;
    const members = geometry.coordinates as Position[][][];
    if (members.length < 2) return undefined;
    return members.map((rings) => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const ring of rings)
            for (const [x, y] of ring) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        return { edges: areaEdges({ type: "Polygon", coordinates: rings }), minX, minY, maxX, maxY };
    });
}

export function prepareNavigableWater(
    rows: {
        geometry: AreaGeometry;
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        regionName: string;
        regionType: WaterRegionType;
        areaPublicId: string;
    }[],
): NavigableWater {
    const areas: NavigableArea[] = [];
    for (const row of rows) {
        const edges = areaEdges(row.geometry);
        if (edges.length === 0) continue;
        const polygons = polygonsOf(row.geometry);
        areas.push({
            edges,
            minX: row.minX,
            minY: row.minY,
            maxX: row.maxX,
            maxY: row.maxY,
            regionName: row.regionName,
            regionType: row.regionType,
            areaPublicId: row.areaPublicId,
            ...(polygons ? { polygons } : {}),
        });
    }
    return { areas, grid: indexAreas(areas) };
}

/** Meer und Seen der Kartendomäne, samt Region je Fläche. */
export async function loadNavigableWater(database: Queryable, mapDomainId: string): Promise<NavigableWater> {
    const rows = await database<
        {
            geometry: string;
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
            region_name: string;
            region_type: WaterRegionType;
            area_public_id: string;
        }[]
    >`
        SELECT ST_AsGeoJSON(a.geom) AS geometry,
               ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y,
               r.name AS region_name, r.region_type, a.public_id::text AS area_public_id
        FROM region_area a
        JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
          AND r.region_type IN ${database([...WATER_REGION_TYPES])}
        ORDER BY a.public_id
    `;
    return prepareNavigableWater(
        rows.map((row) => ({
            geometry: JSON.parse(row.geometry) as AreaGeometry,
            minX: row.min_x,
            minY: row.min_y,
            maxX: row.max_x,
            maxY: row.max_y,
            regionName: row.region_name,
            regionType: row.region_type,
            areaPublicId: row.area_public_id,
        })),
    );
}

/**
 * Jede Zelle, deren Mitte in der Fläche liegt: derselbe Strahltest wie `areasContainPoint` (halboffen,
 * Kreuzungen rechts der Mitte über die Parität), je Zeile einmal. Zwischen je zwei Kreuzungen liegt
 * eine Spanne; gefüllt wird nur sie, nicht die ganze Breite der Fläche.
 */
export function forEachCellInside(
    grid: Pick<SeaGrid, "minX" | "minY" | "cell" | "cols" | "rows">,
    area: Pick<NavigableArea, "edges" | "minY" | "maxY">,
    visit: (index: number) => void,
): void {
    const { minX, minY, cell, cols, rows } = grid;
    const rowFrom = Math.max(0, Math.ceil((area.minY - minY) / cell - 0.5));
    const rowTo = Math.min(rows - 1, Math.floor((area.maxY - minY) / cell - 0.5));
    if (rowFrom > rowTo) return;
    const crossings: number[][] = Array.from({ length: rowTo - rowFrom + 1 }, () => []);
    const edges = area.edges;
    for (let offset = 0; offset < edges.length; offset += 4) {
        const x1 = edges[offset] as number;
        const y1 = edges[offset + 1] as number;
        const x2 = edges[offset + 2] as number;
        const y2 = edges[offset + 3] as number;
        if (y1 === y2) continue;
        const first = Math.max(rowFrom, Math.ceil((Math.min(y1, y2) - minY) / cell - 0.5));
        const last = Math.min(rowTo, Math.floor((Math.max(y1, y2) - minY) / cell - 0.5));
        for (let row = first; row <= last; row += 1) {
            const y = minY + (row + 0.5) * cell;
            if (y1 > y === y2 > y) continue;
            (crossings[row - rowFrom] as number[]).push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
    }
    for (let row = rowFrom; row <= rowTo; row += 1) {
        const list = crossings[row - rowFrom] as number[];
        if (list.length < 2) continue;
        const xs = Float64Array.from(list).sort();
        // Eine Mitte liegt innen, wenn rechts von ihr eine ungerade Zahl Kreuzungen liegt: in [xs[2k], xs[2k+1]).
        for (let pair = 0; pair + 1 < xs.length; pair += 2) {
            const from = Math.max(0, Math.ceil(((xs[pair] as number) - minX) / cell - 0.5));
            const to = Math.min(cols - 1, Math.ceil(((xs[pair + 1] as number) - minX) / cell - 0.5) - 1);
            for (let column = from; column <= to; column += 1) visit(row * cols + column);
        }
    }
}

/**
 * Rastert das Wasser über seinem eigenen Rechteck und bestimmt die zusammenhängenden Teile. Danach verbindet es die Teile
 * einer Fläche, die nur eine Engstelle trennt (`connectNarrows`); `narrows: false` lässt das aus (Vergleich, Tests).
 */
export function buildSeaGrid(
    water: NavigableWater,
    cell = werte().seaCellUnits,
    options: { narrows?: boolean } = {},
): SeaGrid {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const area of water.areas) {
        minX = Math.min(minX, area.minX);
        minY = Math.min(minY, area.minY);
        maxX = Math.max(maxX, area.maxX);
        maxY = Math.max(maxY, area.maxY);
    }
    if (water.areas.length === 0) {
        return {
            minX: 0,
            minY: 0,
            cell,
            cols: 0,
            rows: 0,
            water: new Uint8Array(0),
            part: new Int32Array(0),
            partCells: [0],
        };
    }
    // Eine Zelle Rand: Die Suche braucht an keinem Rand einen Sonderfall, der Rand ist nie Wasser.
    minX = Math.floor(minX / cell) * cell - cell;
    minY = Math.floor(minY / cell) * cell - cell;
    const cols = Math.ceil((maxX - minX) / cell) + 2;
    const rows = Math.ceil((maxY - minY) / cell) + 2;
    const frame = { minX, minY, cell, cols, rows };
    const cells = new Uint8Array(cols * rows);
    for (const area of water.areas) {
        forEachCellInside(frame, area, (index) => {
            cells[index] = 1;
        });
    }
    for (let column = 0; column < cols; column += 1) {
        cells[column] = 0;
        cells[(rows - 1) * cols + column] = 0;
    }
    for (let row = 0; row < rows; row += 1) {
        cells[row * cols] = 0;
        cells[row * cols + cols - 1] = 0;
    }
    const labels = labelParts(cells, cols);
    if (options.narrows === false) return { ...frame, water: cells, ...labels };
    const narrows = connectNarrows({ ...frame, water: cells, ...labels }, water);
    // Neu beschriftet nur, wenn Zellen dazukamen: Ohne Engstelle bleibt das Raster Zelle für Zelle, wie es war.
    const { part, partCells } = narrows.cells > 0 ? labelParts(cells, cols) : labels;
    return { ...frame, water: cells, part, partCells, narrows };
}

/** So weit über den Rahmen eines Wasserteils hinaus sucht `connectNarrows` die Engstelle, in Karteneinheiten. */
export const NARROWS_REACH = 8;
/** So viel feiner ist das Raster der Engstellen: zehn Teile je Zellbreite, bei 0,5 E also 0,05 E. */
export const NARROWS_SUBDIVISION = 10;
/** Mehr feine Zellen bekommt kein Fenster; ein größeres bleibt unverbunden und zählt in `unresolved`. */
const NARROWS_MAX_CELLS = 4_000_000;

export interface NarrowsReport {
    /** So oft wurden zwei Wasserteile einer Fläche verbunden. */
    joined: number;
    /** So viele Zellen wurden dafür befahrbar, deren Mitte an Land liegt. */
    cells: number;
    /** So viele Teile blieben getrennt: kein Weg im feinen Raster oder das Fenster zu groß. */
    unresolved: number;
}

/**
 * Die Engstellen (Handover fjordhaefen 2026-11-09): Zerfällt EINE gezeichnete Fläche (ein Polygon samt Löchern, dessen
 * Inneres zusammenhängt) im Raster in mehrere Wasserteile, verbindet es sie durch die Fläche selbst. Je Teil außer dem
 * größten der Fläche, vom kleinsten an: ein feines Raster der Fläche um den Teil (`NARROWS_SUBDIVISION`, Rand
 * `NARROWS_REACH`), darin die kürzeste Breitensuche vom Teil zum nächsten anderen; jede Zelle, durch die der Weg führt,
 * wird befahrbar. Das wiederholt sich, bis der Teil am größten hängt oder keinen Weg mehr findet. Ändert `grid.water`
 * und `grid.part` (die Teile verbundener Stücke heißen danach noch verschieden; `buildSeaGrid` beschriftet neu).
 *
 * - **Nur innerhalb einer Fläche:** Zwei Flächen, die sich berühren, bleiben, wie das Raster sie trennt; so wird ein See
 *   neben der Küste nie zum Meer.
 * - **Gewässerart und Sperrgebiete** tragen die neuen Zellen nicht (`waterKindCells`, `closureCells` prüfen die Mitte):
 *   Ein Weg durch sie führt auf beiden Seiten durch Zellen derselben Fläche, und die tragen beides.
 * - **Über Land** liegt eine Linie durch die neuen Zellen höchstens eine halbe Zellendiagonale, nicht eine halbe Zelle:
 *   Das gezeichnete Wasser liegt in jeder von ihnen, ihre Mitte nicht.
 */
export function connectNarrows(grid: SeaGrid, water: NavigableWater): NarrowsReport {
    const { cell, cols: width, minX, minY } = grid;
    const count = grid.partCells.length;
    // Der Rahmen je Wurzel in Zellen; wächst beim Vereinen und mit jeder neuen Zelle.
    const left = new Int32Array(count).fill(width);
    const right = new Int32Array(count).fill(-1);
    const top = new Int32Array(count).fill(grid.rows);
    const bottom = new Int32Array(count).fill(-1);
    const grow = (root: number, index: number): void => {
        const column = index % width;
        const row = Math.floor(index / width);
        left[root] = Math.min(left[root] as number, column);
        right[root] = Math.max(right[root] as number, column);
        top[root] = Math.min(top[root] as number, row);
        bottom[root] = Math.max(bottom[root] as number, row);
    };
    for (let index = 0; index < grid.water.length; index += 1) {
        const id = grid.part[index] as number;
        if (id !== 0) grow(id, index);
    }
    const parent = Int32Array.from({ length: count }, (_, id) => id);
    const find = (id: number): number => {
        let root = id;
        while (parent[root] !== root) root = parent[root] as number;
        while (parent[id] !== root) {
            const next = parent[id] as number;
            parent[id] = root;
            id = next;
        }
        return root;
    };
    const unite = (root: number, other: number): void => {
        parent[other] = root;
        left[root] = Math.min(left[root] as number, left[other] as number);
        right[root] = Math.max(right[root] as number, right[other] as number);
        top[root] = Math.min(top[root] as number, top[other] as number);
        bottom[root] = Math.max(bottom[root] as number, bottom[other] as number);
    };
    const report: NarrowsReport = { joined: 0, cells: 0, unresolved: 0 };
    const margin = Math.ceil(NARROWS_REACH / cell);
    const k = NARROWS_SUBDIVISION;
    for (const area of water.areas) {
        for (const polygon of area.polygons ?? [area]) {
            const cellsOf = new Map<number, number>();
            forEachCellInside(grid, polygon, (index) => {
                const id = grid.part[index] as number;
                if (id !== 0) cellsOf.set(id, (cellsOf.get(id) ?? 0) + 1);
            });
            if (cellsOf.size < 2) continue;
            const parts = [...cellsOf.keys()].sort(
                (a, b) => (grid.partCells[a] as number) - (grid.partCells[b] as number) || a - b,
            );
            const main = parts[parts.length - 1] as number;
            // Der Rahmen der Fläche in Zellen: Außerhalb liegt kein Wasser von ihr.
            const frameLeft = Math.max(1, Math.floor((polygon.minX - minX) / cell));
            const frameRight = Math.min(width - 2, Math.floor((polygon.maxX - minX) / cell));
            const frameTop = Math.max(1, Math.floor((polygon.minY - minY) / cell));
            const frameBottom = Math.min(grid.rows - 2, Math.floor((polygon.maxY - minY) / cell));
            for (const start of parts.slice(0, -1)) {
                while (find(start) !== find(main)) {
                    const root = find(start);
                    const c0 = Math.max(frameLeft, (left[root] as number) - margin);
                    const c1 = Math.min(frameRight, (right[root] as number) + margin);
                    const r0 = Math.max(frameTop, (top[root] as number) - margin);
                    const r1 = Math.min(frameBottom, (bottom[root] as number) + margin);
                    const fineCols = (c1 - c0 + 1) * k;
                    const fineRows = (r1 - r0 + 1) * k;
                    if (fineCols <= 0 || fineRows <= 0 || fineCols * fineRows > NARROWS_MAX_CELLS) {
                        report.unresolved += 1;
                        break;
                    }
                    const path = narrowPath(grid, polygon, { c0, r0, fineCols, fineRows }, (index) => {
                        const id = grid.part[index] as number;
                        return id === 0 ? null : find(id) === root;
                    });
                    if (!path) {
                        report.unresolved += 1;
                        break;
                    }
                    for (const index of path.cells) {
                        if (grid.water[index] === 1) continue;
                        grid.water[index] = 1;
                        grid.part[index] = root;
                        grow(root, index);
                        report.cells += 1;
                    }
                    unite(root, find(grid.part[path.end] as number));
                    report.joined += 1;
                }
            }
        }
    }
    return report;
}

/**
 * Der kürzeste Weg durch das feine Raster der Fläche, von einer Wasserzelle des eigenen Teils zur nächsten Wasserzelle
 * eines anderen. `mine` sagt je Zelle des groben Rasters: null an Land, true im eigenen Teil, false in einem anderen.
 * Liefert die Zellen des groben Rasters, durch die der Weg führt, und die Zelle, an der er ankommt; null ohne Weg.
 */
function narrowPath(
    grid: SeaGrid,
    polygon: NavigablePolygon,
    window: { c0: number; r0: number; fineCols: number; fineRows: number },
    mine: (index: number) => boolean | null,
): { cells: number[]; end: number } | null {
    const { c0, r0, fineCols, fineRows } = window;
    const k = NARROWS_SUBDIVISION;
    const fine = grid.cell / k;
    const inside = new Uint8Array(fineCols * fineRows);
    forEachCellInside(
        {
            minX: grid.minX + c0 * grid.cell,
            minY: grid.minY + r0 * grid.cell,
            cell: fine,
            cols: fineCols,
            rows: fineRows,
        },
        polygon,
        (index) => {
            inside[index] = 1;
        },
    );
    // Die grobe Zelle einer feinen: über die Stelle, nie über Koordinaten, damit keine Rundung sie verschiebt.
    const coarse = (index: number): number =>
        (r0 + Math.floor(Math.floor(index / fineCols) / k)) * grid.cols + c0 + Math.floor((index % fineCols) / k);
    const previous = new Int32Array(inside.length).fill(-2);
    const queue = new Int32Array(inside.length);
    let head = 0;
    let tail = 0;
    for (let index = 0; index < inside.length; index += 1) {
        if (inside[index] === 1 && mine(coarse(index)) === true) {
            previous[index] = -1;
            queue[tail++] = index;
        }
    }
    let end = -1;
    const visit = (from: number, next: number): boolean => {
        if (inside[next] !== 1 || previous[next] !== -2) return false;
        previous[next] = from;
        if (mine(coarse(next)) === false) {
            end = next;
            return true;
        }
        queue[tail++] = next;
        return false;
    };
    while (head < tail && end < 0) {
        const index = queue[head++] as number;
        const column = index % fineCols;
        if (column + 1 < fineCols && visit(index, index + 1)) break;
        if (column > 0 && visit(index, index - 1)) break;
        if (index + fineCols < inside.length && visit(index, index + fineCols)) break;
        if (index >= fineCols && visit(index, index - fineCols)) break;
    }
    if (end < 0) return null;
    const cells: number[] = [];
    for (let index = end; index >= 0; index = previous[index] as number) {
        const at = coarse(index);
        if (cells[cells.length - 1] !== at) cells.push(at);
    }
    return { cells, end: coarse(end) };
}

/** Die Teile über vier Seiten, in Zellreihenfolge entdeckt. */
function labelParts(water: Uint8Array, cols: number): { part: Int32Array; partCells: number[] } {
    const part = new Int32Array(water.length);
    const partCells = [0];
    const queue = new Int32Array(water.length);
    for (let start = 0; start < water.length; start += 1) {
        if (water[start] === 0 || part[start] !== 0) continue;
        const id = partCells.length;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        part[start] = id;
        const visit = (next: number): void => {
            // Der Rand ist nie Wasser; ein Schritt über ihn hinaus kommt nicht vor.
            if (water[next] === 1 && part[next] === 0) {
                part[next] = id;
                queue[tail++] = next;
            }
        };
        while (head < tail) {
            const index = queue[head++] as number;
            visit(index + 1);
            visit(index - 1);
            visit(index + cols);
            visit(index - cols);
        }
        partCells.push(tail);
    }
    return { part, partCells };
}

export const cellX = (grid: SeaGrid, index: number): number => grid.minX + ((index % grid.cols) + 0.5) * grid.cell;
export const cellY = (grid: SeaGrid, index: number): number =>
    grid.minY + (Math.floor(index / grid.cols) + 0.5) * grid.cell;

/** Die Zelle eines Kartenpunkts; -1 außerhalb des Rasters. */
export function cellAt(grid: SeaGrid, x: number, y: number): number {
    const column = Math.floor((x - grid.minX) / grid.cell);
    const row = Math.floor((y - grid.minY) / grid.cell);
    if (column < 0 || row < 0 || column >= grid.cols || row >= grid.rows) return -1;
    return row * grid.cols + column;
}

export interface Landing {
    cell: number;
    x: number;
    y: number;
    /** Vom Hafen zur Mitte der Zelle, in Karteneinheiten. */
    distance: number;
    part: number;
}

/**
 * Die nächste befahrbare Zelle, höchstens `reach` entfernt (H1); null, wenn keine so nah liegt. Bei
 * gleichem Abstand die kleinere Zelle - das Ergebnis hängt nicht von der Suchreihenfolge ab.
 * `minArea` (Karteneinheiten²) lässt Wasserteile aus, die kleiner sind: Splitter eines schmalen Sees
 * neben der Küste sind kein Wasser, auf dem ein Schiff anlegt.
 */
export function nearestWaterCell(
    grid: SeaGrid,
    x: number,
    y: number,
    reach = werte().landingReach,
    minArea = 0,
): Landing | null {
    const minCells = minArea / (grid.cell * grid.cell);
    const span = Math.ceil(reach / grid.cell) + 1;
    const column = Math.floor((x - grid.minX) / grid.cell);
    const row = Math.floor((y - grid.minY) / grid.cell);
    let best: Landing | null = null;
    for (let nextRow = Math.max(0, row - span); nextRow <= Math.min(grid.rows - 1, row + span); nextRow += 1) {
        for (
            let nextColumn = Math.max(0, column - span);
            nextColumn <= Math.min(grid.cols - 1, column + span);
            nextColumn += 1
        ) {
            const index = nextRow * grid.cols + nextColumn;
            if (grid.water[index] !== 1) continue;
            if ((grid.partCells[grid.part[index] as number] as number) < minCells) continue;
            const cx = grid.minX + (nextColumn + 0.5) * grid.cell;
            const cy = grid.minY + (nextRow + 0.5) * grid.cell;
            const distance = Math.hypot(cx - x, cy - y);
            if (distance > reach) continue;
            if (!best || distance < best.distance || (distance === best.distance && index < best.cell)) {
                best = { cell: index, x: cx, y: cy, distance, part: grid.part[index] as number };
            }
        }
    }
    return best;
}

/**
 * Welche Anlegestellen sind Nachbarn über Wasser? Jede befahrbare Zelle gehört zur Anlegestelle, die
 * sie über die wenigsten Schritte erreicht (Breitensuche von allen zugleich, über vier Seiten); zwei
 * Anlegestellen sind Nachbarn, wenn ihre Gebiete aneinanderstoßen. Das braucht keine Seewege - so ließe
 * sich ein Seenetz aus dem Wasser selbst ableiten. Liefert Paare von Stellen in `sources`.
 */
export function waterNeighbours(grid: SeaGrid, sources: readonly number[]): [number, number][] {
    const owner = new Int32Array(grid.water.length).fill(-1);
    const queue = new Int32Array(grid.water.length);
    let head = 0;
    let tail = 0;
    sources.forEach((cell, source) => {
        if (grid.water[cell] !== 1 || owner[cell] !== -1) return;
        owner[cell] = source;
        queue[tail++] = cell;
    });
    const pairs = new Set<number>();
    const meet = (a: number, b: number): void => {
        if (a !== b) pairs.add(Math.min(a, b) * sources.length + Math.max(a, b));
    };
    const visit = (from: number, next: number): void => {
        if (grid.water[next] !== 1) return;
        const theirs = owner[next] as number;
        if (theirs === -1) {
            owner[next] = owner[from] as number;
            queue[tail++] = next;
        } else meet(owner[from] as number, theirs);
    };
    while (head < tail) {
        const cell = queue[head++] as number;
        visit(cell, cell + 1);
        visit(cell, cell - 1);
        visit(cell, cell + grid.cols);
        visit(cell, cell - grid.cols);
    }
    return [...pairs]
        .sort((a, b) => a - b)
        .map((key): [number, number] => [Math.floor(key / sources.length), key % sources.length]);
}

/** Was das Raster im Speicher belegt, in Byte. */
export const seaGridBytes = (grid: SeaGrid): number => grid.water.byteLength + grid.part.byteLength;
