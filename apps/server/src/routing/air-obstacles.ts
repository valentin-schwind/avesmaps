import { coneRadius, freePeakHeight } from "../terrain/peak-cone.ts";
import { CONTINENTAL_MAX_HEIGHT } from "../terrain/continental.ts";
import { domainHeightAt } from "../terrain/domain/read.ts";
import { reliefAt, type TerrainHeights } from "./relief.ts";

/**
 * Die Hindernisse des Flugs (WI-0051, F2): Gelände, das höher liegt als die absolute Höchstflughöhe minus den
 * Mindestabstand (F-E1 = C; seit 2026-10-04 für alle Flugmittel 5.000 − 200 = 4.800 Schritt, davor je Flugmittel
 * Reisehöhe × 1.000 %). Gelesen wird dasselbe Gelände wie überall (`reliefAt`: Gebirgsraster und freie
 * Gipfelkegel und Kontinentalsockel).
 *
 * - **Ein Raster je Anfrage, nur über dem Fenster der Etappe**, nie eines auf Vorrat. Gebaut wird aus
 *   den Stützstellen der Gebirgsraster selbst, in ein paar Millisekunden.
 * - **Gesperrt ist eine Zelle, in der das Gelände irgendwo höher liegt** - die sichere Richtung für einen
 *   Flieger, wie „Mitte im Wasser“ für ein Schiff. Die Raster sind bilinear: Über `limit` liegt ein Punkt
 *   nur, wo eine Stützstelle über `limit` ihn mit Gewicht erreicht, also im offenen Quadrat von einer
 *   Rasterzelle um sie. Jede Zelle, die ein solches Quadrat schneidet, ist gesperrt. Ein Gipfelkegel sperrt
 *   den Kreis, in dem er höher ist.
 * - **Je Datenstand einmal** (`airTerrain`, verzögert beim ersten Flug): der höchste Wert je Raster, damit
 *   ein Raster unter der Grenze gar nicht erst gelesen wird.
 */

/** Zellbreite in Karteneinheiten, wie das Wasserraster der freien Seefahrt (1 Einheit = 3 Meilen). */
export const AIR_CELL_UNITS = 0.5;

type Raster = TerrainHeights["rasters"][number];
type Cone = TerrainHeights["cones"][number];

export interface AirTerrain {
    domainRaster?: Raster;
    domainMax?: number;
    continentalRaster?: Raster;
    heights: TerrainHeights;
    /** Der höchste Wert je Gebirgsraster, in der Reihenfolge von `heights.rasters`. */
    rasterMax: readonly number[];
}

export interface AirBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Ein Raster über einem Fenster: Zeile 0 im Süden wie überall, Zelle `cell` Karteneinheiten breit. */
export interface AirFrame {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
}

const prepared = new WeakMap<TerrainHeights, AirTerrain>();

/**
 * Der höchste Wert eines Rasters, mindestens 0. 🔴 Mit Zähler statt `for…of`: über das Domain-Raster (8.192 × 8.192
 * Stützstellen) war das Iterieren zehnmal so langsam (0,5 s statt 50 ms) - am Stück in der Schleife des Workers.
 */
function highestOf(samples: ArrayLike<number>): number {
    let highest = 0;
    // Die Länge einmal je Durchlauf gelesen: Der Test zählt an ihr, wie oft ein Gelände vorbereitet wird.
    const count = samples.length;
    for (let index = 0; index < count; index += 1) {
        const value = samples[index] as number;
        if (value > highest) highest = value;
    }
    return highest;
}

/** Das Gelände des Flugs zu einem Datenstand, beim ersten Aufruf vorbereitet. */
export function airTerrain(heights: TerrainHeights): AirTerrain {
    let terrain = prepared.get(heights);
    if (!terrain) {
        const rasterMax = heights.rasters.map((raster) => highestOf(raster.samples));
        const base = heights.continental?.raster;
        const domain = heights.domain?.raster;
        const domainMax = domain ? highestOf(domain.samples) : 0;
        terrain = {
            heights,
            rasterMax,
            ...(domain
                ? {
                      domainMax,
                      domainRaster: {
                          ...domain,
                          maxX: domain.originX + (domain.width - 1) * domain.cell,
                          maxY: domain.originY + (domain.height - 1) * domain.cell,
                      },
                  }
                : {}),
            ...(base
                ? {
                      continentalRaster: {
                          ...base,
                          maxX: base.originX + (base.width - 1) * base.cell,
                          maxY: base.originY + (base.height - 1) * base.cell,
                      },
                  }
                : {}),
        };
        prepared.set(heights, terrain);
    }
    return terrain;
}

/** Über dieser Höhe sperrt Gelände; es muss aber Gelände sein (Höhe über null). */
const floorOf = (limit: number): number => Math.max(0, limit);

/** Der Radius, in dem ein Gipfelkegel höher ist als `limit`; 0, wenn er es nirgends ist. */
function coneReach(cone: Cone, rule: TerrainHeights["rule"], limit: number): number {
    const height = freePeakHeight(cone);
    if (height <= floorOf(limit)) return 0;
    const radius = coneRadius(height, rule);
    // H · (1 - (d/R)²)³ > limit, und unter null zählt der ganze Kegel.
    return limit <= 0 ? radius : radius * Math.sqrt(1 - Math.cbrt(limit / height));
}

/** Das Rechteck um alles Gelände, das irgendwo höher liegt als `limit`; null, wenn keines so hoch ist. */
export function boundsAbove(terrain: AirTerrain, limit: number): AirBox | null {
    const floor = floorOf(limit);
    let box: AirBox | null = null;
    const add = (minX: number, minY: number, maxX: number, maxY: number): void => {
        box = box
            ? {
                  minX: Math.min(box.minX, minX),
                  minY: Math.min(box.minY, minY),
                  maxX: Math.max(box.maxX, maxX),
                  maxY: Math.max(box.maxY, maxY),
              }
            : { minX, minY, maxX, maxY };
    };
    if (terrain.domainRaster && (terrain.domainMax ?? 0) > floor) {
        const r = terrain.domainRaster;
        add(r.originX, r.originY, r.maxX, r.maxY);
    }
    terrain.heights.rasters.forEach((raster, index) => {
        if ((terrain.rasterMax[index] as number) > floor) add(raster.originX, raster.originY, raster.maxX, raster.maxY);
    });
    if (terrain.continentalRaster && floor < CONTINENTAL_MAX_HEIGHT) {
        const r = terrain.continentalRaster;
        add(r.originX, r.originY, r.maxX, r.maxY);
    }
    for (const cone of terrain.heights.cones) {
        const reach = coneReach(cone, terrain.heights.rule, limit);
        if (reach > 0) add(cone.x - reach, cone.y - reach, cone.x + reach, cone.y + reach);
    }
    return box;
}

/** Die Zeilen (oder Spalten), die das offene Intervall (a, b) schneiden, im Raster geklemmt. */
function span(a: number, b: number, origin: number, cell: number, count: number): [number, number] {
    return [Math.max(0, Math.floor((a - origin) / cell)), Math.min(count - 1, Math.ceil((b - origin) / cell) - 1)];
}

/** Markiert die Zellen eines Rasters, deren Gelände irgendwo höher liegt als `floor`. */
function markRaster(frame: AirFrame, blocked: Uint8Array, raster: Raster, floor: number): void {
    const { minX, minY, cell, cols, rows } = frame;
    const maxX = minX + cols * cell;
    const maxY = minY + rows * cell;
    const step = raster.cell;
    if (raster.originX - step > maxX || raster.maxX + step < minX) return;
    if (raster.originY - step > maxY || raster.maxY + step < minY) return;
    // Nur die Stützstellen, deren Quadrat ins Fenster reicht.
    const i0 = Math.max(0, Math.floor((minX - raster.originX) / step) - 1);
    const i1 = Math.min(raster.width - 1, Math.ceil((maxX - raster.originX) / step) + 1);
    const j0 = Math.max(0, Math.floor((minY - raster.originY) / step) - 1);
    const j1 = Math.min(raster.height - 1, Math.ceil((maxY - raster.originY) / step) + 1);
    const samples = raster.samples;
    for (let j = j0; j <= j1; j += 1) {
        const y = raster.originY + j * step;
        const [row0, row1] = span(
            Math.max(raster.originY, y - step),
            Math.min(raster.maxY, y + step),
            minY,
            cell,
            rows,
        );
        if (row0 > row1) continue;
        let index = j * raster.width + i0;
        for (let i = i0; i <= i1; i += 1, index += 1) {
            if ((samples[index] as number) <= floor) continue;
            const x = raster.originX + i * step;
            const [column0, column1] = span(
                Math.max(raster.originX, x - step),
                Math.min(raster.maxX, x + step),
                minX,
                cell,
                cols,
            );
            for (let row = row0; row <= row1; row += 1) {
                for (let column = column0; column <= column1; column += 1) blocked[row * cols + column] = 1;
            }
        }
    }
}

/** Markiert die Zellen, die dem Gipfel näher liegen als `reach`. */
function markCone(frame: AirFrame, blocked: Uint8Array, cone: Cone, reach: number): void {
    const { minX, minY, cell, cols, rows } = frame;
    const [row0, row1] = span(cone.y - reach, cone.y + reach, minY, cell, rows);
    const [column0, column1] = span(cone.x - reach, cone.x + reach, minX, cell, cols);
    for (let row = row0; row <= row1; row += 1) {
        const bottom = minY + row * cell;
        const dy = Math.max(0, bottom - cone.y, cone.y - (bottom + cell));
        for (let column = column0; column <= column1; column += 1) {
            const left = minX + column * cell;
            const dx = Math.max(0, left - cone.x, cone.x - (left + cell));
            if (Math.hypot(dx, dy) < reach) blocked[row * cols + column] = 1;
        }
    }
}

/**
 * Wie `markRaster`, nur mit dem Wert statt der 1: Jede Zelle behält das Höchste, was sie berührt (über `floor`). Zelle für
 * Zelle statt Stützstelle für Stützstelle: Zu jeder Spalte und jeder Zeile des Fensters werden einmal die Stützstellen
 * bestimmt, deren Quadrat (eine Rasterzelle um sie, offen, auf das Raster begrenzt) die Zelle schneidet; dann ist jede Zelle
 * das Maximum über wenige zusammenhängende Werte. Dieselben Zellen wie `markRaster`, nur ohne je Stützstelle neu zu rechnen,
 * wohin sie reicht (das Lesen über dem ganzen Land bei Grenze 0 wäre sonst der größte Posten einer Abwägung).
 */
function heightRaster(frame: AirFrame, cells: Float32Array, raster: Raster, floor: number): void {
    const { minX, minY, cell, cols, rows } = frame;
    const maxX = minX + cols * cell;
    const maxY = minY + rows * cell;
    const step = raster.cell;
    if (raster.originX - step > maxX || raster.maxX + step < minX) return;
    if (raster.originY - step > maxY || raster.maxY + step < minY) return;
    /** Die Stützstellen von `lo` bis `hi` (einschließlich), die die Zelle `k` eines Fensters schneiden; `hi < lo`, wo keine. */
    const supports = (origin: number, max: number, from: number, count: number, size: number): Int32Array => {
        const bounds = new Int32Array(2 * count);
        for (let k = 0; k < count; k += 1) {
            const low = from + k * cell;
            const high = low + cell;
            // Die Zelle muss das Raster (auf seinen Rand begrenzt) berühren, und die Stützstelle x liegt in (low - step, high + step).
            if (!(origin < high && max > low)) {
                bounds[2 * k] = 0;
                bounds[2 * k + 1] = -1;
                continue;
            }
            bounds[2 * k] = Math.max(0, Math.floor((low - step - origin) / step) + 1);
            bounds[2 * k + 1] = Math.min(size - 1, Math.ceil((high + step - origin) / step) - 1);
        }
        return bounds;
    };
    const across = supports(raster.originX, raster.maxX, minX, cols, raster.width);
    const down = supports(raster.originY, raster.maxY, minY, rows, raster.height);
    const { samples, width } = raster;
    for (let row = 0; row < rows; row += 1) {
        const j0 = down[2 * row] as number;
        const j1 = down[2 * row + 1] as number;
        if (j0 > j1) continue;
        for (let column = 0, at = row * cols; column < cols; column += 1, at += 1) {
            const i0 = across[2 * column] as number;
            const i1 = across[2 * column + 1] as number;
            let highest = floor;
            for (let j = j0; j <= j1; j += 1) {
                for (let i = i0, index = j * width + i0; i <= i1; i += 1, index += 1) {
                    const value = samples[index] as number;
                    if (value > highest) highest = value;
                }
            }
            if (highest > floor && highest > (cells[at] as number)) cells[at] = highest;
        }
    }
}

/** Wie `markCone`, mit der Höhe des Kegels an der nächsten Stelle der Zelle statt der 1. */
function heightCone(
    frame: AirFrame,
    cells: Float32Array,
    cone: Cone,
    rule: TerrainHeights["rule"],
    floor: number,
): void {
    const height = freePeakHeight(cone);
    if (height <= floor) return;
    const radius = coneRadius(height, rule);
    const { minX, minY, cell, cols, rows } = frame;
    const [row0, row1] = span(cone.y - radius, cone.y + radius, minY, cell, rows);
    const [column0, column1] = span(cone.x - radius, cone.x + radius, minX, cell, cols);
    for (let row = row0; row <= row1; row += 1) {
        const bottom = minY + row * cell;
        const dy = Math.max(0, bottom - cone.y, cone.y - (bottom + cell));
        for (let column = column0; column <= column1; column += 1) {
            const left = minX + column * cell;
            const dx = Math.max(0, left - cone.x, cone.x - (left + cell));
            const d = Math.hypot(dx, dy);
            if (d >= radius) continue;
            const u = 1 - (d / radius) * (d / radius);
            const value = height * u * u * u;
            const at = row * cols + column;
            if (value > floor && value > (cells[at] as number)) cells[at] = value;
        }
    }
}

/**
 * Das Höhenfeld eines Fensters: je Zelle das Höchste, was Gelände in ihr erreicht (dieselbe Berührung wie
 * `blockedCells`), aber nur über `floor`, sonst 0. Die Abwägung des Flugs (`air-weigh.ts`, F4b) liest damit mit Grenze 0
 * einmal den Boden über dem ganzen Fenster: aus ihm kommen die Sperre (`blockedFromHeights`) und der Bedarf der Bahn im
 * Kostenfeld (`air-field.ts`). Für jede Grenze `limit ≥ floor` gilt: `blockedFromHeights(heightCells(…, floor), limit)`
 * ist gleich `blockedCells(…, limit)` - ein Test hält das fest. Gelesen wird Zelle für Zelle (`heightRaster`).
 */
export function heightCells(terrain: AirTerrain, frame: AirFrame, floor: number): Float32Array {
    const cells = new Float32Array(frame.cols * frame.rows);
    const above = floorOf(floor);
    if (terrain.domainRaster && (terrain.domainMax ?? 0) > above) {
        heightRaster(frame, cells, terrain.domainRaster, above);
    }
    if (terrain.continentalRaster && above < CONTINENTAL_MAX_HEIGHT) {
        heightRaster(frame, cells, terrain.continentalRaster, above);
    }
    terrain.heights.rasters.forEach((raster, index) => {
        if ((terrain.rasterMax[index] as number) > above) heightRaster(frame, cells, raster, above);
    });
    for (const cone of terrain.heights.cones) heightCone(frame, cells, cone, terrain.heights.rule, above);
    return cells;
}

/**
 * Der Boden in der Mitte jeder Zelle des Rasters, in Schritt (bilinear, wie `groundHeightAt`): der Boden, den ein Flug durch
 * die Zelle im Mittel unter sich hat. Das Höhenfeld (`heightCells`) gibt dagegen das Höchste in der Zelle.
 */
export function centreHeights(terrain: AirTerrain, frame: AirFrame): Float32Array {
    const { minX, minY, cell, cols, rows } = frame;
    const { heights } = terrain;
    const out = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
        const y = minY + (row + 0.5) * cell;
        for (let column = 0, at = row * cols; column < cols; column += 1, at += 1) {
            const x = minX + (column + 0.5) * cell;
            out[at] = heights.domain ? domainHeightAt(heights.domain, x, y) : reliefAt(heights, x, y).height;
        }
    }
    return out;
}

/** Die Sperre bei der Grenze `limit` aus dem Höhenfeld: 1, wo die Zelle höher liegt (Grenze mindestens null). */
export function blockedFromHeights(cells: Float32Array, limit: number): Uint8Array {
    const blocked = new Uint8Array(cells.length);
    const floor = floorOf(limit);
    for (let index = 0; index < cells.length; index += 1) if ((cells[index] as number) > floor) blocked[index] = 1;
    return blocked;
}

/** Die Sperre eines Fensters: 1, wo Gelände in der Zelle höher liegt als `limit` Schritt. */
export function blockedCells(terrain: AirTerrain, frame: AirFrame, limit: number): Uint8Array {
    const blocked = new Uint8Array(frame.cols * frame.rows);
    const floor = floorOf(limit);
    if (terrain.domainRaster && (terrain.domainMax ?? 0) > floor)
        markRaster(frame, blocked, terrain.domainRaster, floor);
    if (terrain.continentalRaster && floor < CONTINENTAL_MAX_HEIGHT)
        markRaster(frame, blocked, terrain.continentalRaster, floor);
    terrain.heights.rasters.forEach((raster, index) => {
        if ((terrain.rasterMax[index] as number) > floor) markRaster(frame, blocked, raster, floor);
    });
    for (const cone of terrain.heights.cones) {
        const reach = coneReach(cone, terrain.heights.rule, limit);
        if (reach > 0) markCone(frame, blocked, cone, reach);
    }
    return blocked;
}
