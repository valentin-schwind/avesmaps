import { RIVER_STEP, type RiverLake, type RiverNetwork } from "./river-network.ts";
import { EPS, rasterHeight, RISE_TOLERANCE, type Field, type FieldRaster } from "./river-field.ts";
import { pointInGeometry } from "@avesmaps3d/shared";

/**
 * Die Seen beim Einbrennen (WI-0049 S6): ihr Spiegel, ihre Zellen im Gebirge und das Einebnen. Die Regel steht
 * an `burnRivers` (river-burn.ts); hier nur, was dafür an Seen gelesen und geschrieben wird.
 */

/**
 * Punkte im See auf einem Gitter von `RIVER_STEP`; ein See kleiner als eine Masche liefert seine Ecken. Ein See
 * fern jedes Gebirges braucht keine: Sein Spiegel ist 0 (`null`).
 */
export function lakePointsOf(field: Field, lakes: readonly RiverLake[]): (Float64Array | null)[] {
    return lakes.map((lake) => {
        const rings = (
            lake.geometry.type === "Polygon" ? [lake.geometry.coordinates] : lake.geometry.coordinates
        ) as number[][][][];
        const corners = rings.flat(2);
        const xs = corners.map((p) => p[0] as number);
        const ys = corners.map((p) => p[1] as number);
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (!field.rasters.some((r) => r.originX <= maxX && r.maxX >= minX && r.originY <= maxY && r.maxY >= minY)) {
            return null;
        }
        const columns: number[] = [];
        for (let x = minX; x <= maxX; x += RIVER_STEP) columns.push(x);
        const rows: number[] = [];
        for (let y = minY; y <= maxY; y += RIVER_STEP) rows.push(y);
        const inside = insideGrid(lake.geometry, columns, rows);
        const points: number[] = [];
        for (let i = 0; i < columns.length; i += 1)
            for (let j = 0; j < rows.length; j += 1)
                if (inside[j * columns.length + i]) points.push(columns[i]!, rows[j]!);
        if (points.length === 0) for (const p of corners) points.push(p[0] as number, p[1] as number);
        return Float64Array.from(points);
    });
}

/**
 * `pointInGeometry` for every grid point at once (WI-0067 performance): per row the same ray crossings as
 * `pointInRing` (identical arithmetic, so identical decisions), then a sweep over the ascending x values.
 * A lake of 100 E² has about 100.000 points; testing each against every edge cost seconds per burn.
 */
function insideGrid(geometry: RiverLake["geometry"], xs: readonly number[], ys: readonly number[]): Uint8Array {
    const polygons = (
        geometry.type === "Polygon"
            ? [geometry.coordinates]
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates
              : []
    ) as number[][][][];
    const result = new Uint8Array(xs.length * ys.length);
    const crossings: number[] = [];
    const parity = new Uint8Array(xs.length);
    const ringParity = (ring: number[][], y: number): Uint8Array => {
        crossings.length = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i]![0]!,
                yi = ring[i]![1]!,
                xj = ring[j]![0]!,
                yj = ring[j]![1]!;
            if (yi > y !== yj > y) crossings.push(((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi);
        }
        crossings.sort((a, b) => a - b);
        // Crossings strictly right of x toggle; xs ascend, so count those at or left of x with one pointer.
        let left = 0;
        for (let i = 0; i < xs.length; i += 1) {
            while (left < crossings.length && crossings[left]! <= xs[i]!) left += 1;
            parity[i] = (crossings.length - left) & 1;
        }
        return parity;
    };
    for (let j = 0; j < ys.length; j += 1) {
        const y = ys[j]!;
        const row = j * xs.length;
        for (const polygon of polygons) {
            if (!polygon.length) continue;
            const inPolygon = Uint8Array.from(ringParity(polygon[0]!, y));
            for (let h = 1; h < polygon.length; h += 1) {
                const hole = ringParity(polygon[h]!, y);
                for (let i = 0; i < xs.length; i += 1) if (hole[i]) inPolygon[i] = 0;
            }
            for (let i = 0; i < xs.length; i += 1) if (inPolygon[i]) result[row + i] = 1;
        }
    }
    return result;
}

/**
 * Der Spiegel eines Sees, wie er heute im Höhenmodell steht: sein tiefster Punkt (außerhalb der Gebirge 0). Mit
 * `median` (feste Seen der Domain) der mittlere Punkt: wenige Punkte am Ufer, die ein Flusstal gesenkt hat, ziehen
 * den Spiegel nicht herab.
 */
export function lakeSurfaces(field: Field, points: readonly (Float64Array | null)[], median = false): Float64Array {
    return Float64Array.from(
        points.map((list) => {
            if (!list) return 0;
            if (median) {
                const heights = new Float64Array(list.length >> 1);
                for (let k = 0; k < list.length; k += 2) {
                    heights[k >> 1] = rasterHeight(field, list[k] as number, list[k + 1] as number);
                }
                return heights.sort()[heights.length >> 1] as number;
            }
            let low = Infinity;
            for (let k = 0; k < list.length; k += 2) {
                low = Math.min(low, rasterHeight(field, list[k] as number, list[k + 1] as number));
            }
            return low;
        }),
    );
}

export interface LakeCells {
    raster: number;
    cells: number[];
}

/** Die Rasterzellen jedes Sees (Zellen mit Höhe, deren Mitte im See liegt). */
export function lakeCellsOf(field: Field, lakes: readonly RiverLake[]): LakeCells[][] {
    return lakes.map((lake) => {
        const rings = lake.geometry.type === "Polygon" ? [lake.geometry.coordinates] : lake.geometry.coordinates;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of (rings as number[][][][]).flat(2)) {
            minX = Math.min(minX, point[0] as number);
            maxX = Math.max(maxX, point[0] as number);
            minY = Math.min(minY, point[1] as number);
            maxY = Math.max(maxY, point[1] as number);
        }
        const result: LakeCells[] = [];
        field.rasters.forEach((r, index) => {
            if (r.originX > maxX || r.maxX < minX || r.originY > maxY || r.maxY < minY) return;
            const cells: number[] = [];
            const i0 = Math.max(0, Math.ceil((minX - r.originX) / r.cell));
            const i1 = Math.min(r.width - 1, Math.floor((maxX - r.originX) / r.cell));
            const j0 = Math.max(0, Math.ceil((minY - r.originY) / r.cell));
            const j1 = Math.min(r.height - 1, Math.floor((maxY - r.originY) / r.cell));
            for (let j = j0; j <= j1; j += 1) {
                for (let i = i0; i <= i1; i += 1) {
                    const k = j * r.width + i;
                    if ((r.samples[k] as number) === 0) continue;
                    if (pointInGeometry([r.originX + i * r.cell, r.originY + j * r.cell], lake.geometry)) cells.push(k);
                }
            }
            if (cells.length > 0) result.push({ raster: index, cells });
        });
        return result;
    });
}

/** Die höchste Zelle jedes Sees im Gebirge; ohne Zellen −∞. */
export function lakeTops(field: Field, cells: readonly LakeCells[][]): Float64Array {
    return Float64Array.from(
        cells.map((list) => {
            let top = -Infinity;
            for (const { raster, cells: ks } of list) {
                const samples = (field.rasters[raster] as FieldRaster).samples;
                for (const k of ks) top = Math.max(top, samples[k] as number);
            }
            return top;
        }),
    );
}

/** Bringt die Seezellen im Gebirge auf den Spiegel (nur nach unten). */
export function levelLakes(field: Field, cells: readonly LakeCells[][], levels: Float64Array): number {
    let changed = 0;
    cells.forEach((list, l) => {
        const level = levels[l] as number;
        if (!Number.isFinite(level)) return;
        const target = Math.max(0, Math.floor(level + EPS));
        for (const { raster, cells: ks } of list) {
            if (field.rasters[raster]?.readOnly) continue;
            const { samples, locked } = field.rasters[raster] as FieldRaster;
            for (const k of ks) {
                if ((samples[k] as number) > level + RISE_TOLERANCE && !locked.has(k)) {
                    samples[k] = target;
                    changed += 1;
                }
            }
        }
    });
    return changed;
}

/**
 * Hebt den Einlauf jedes festen Sees auf seinen Spiegel (WI-0249 P7; nur Fassung 19, `generator.lakes.inletDepth`). Seit das
 * Hangkriechen schwächer ist, schneiden schärfere Rinnen vor einzelnen Mündungen tiefer als der Spiegel: Der Bach in den Blutsee
 * (Trollzacken, Lauf T16) lag 6 bis 7 E vor der Mündung bis 38 Schritt unter ihm, hinter einer Strecke genau auf dem Spiegel. Das
 * Einbrennen senkt nur und nie unter den Spiegel (`bedsOf`); die Mulde blieb, und der Fluss stieg aus ihr in den See an.
 *
 * Der Einlauf ist die Strecke eines Zuflusses von der Mündung flussauf, solange er auf oder unter dem Spiegel liest; er endet an der
 * ersten Stelle darüber, an einem anderen See und wo `frei` nein sagt (eigene Höhen). Gerufen wird, wenn das Nachschneiden steht: Dann
 * liegt der Fluss flussab einer Mulde auf dem Spiegel, auch durch einen Riegel hindurch, und der Einlauf reicht bis in sie.
 *
 * Jede Zelle unter dem Spiegel, aus der eine Stelle des Einlaufs liest (Abstand bis `reach`), steigt eben auf den Spiegel, wie ein
 * Einlauf des Sees; gesperrte Zellen (Gipfel, Seen, eigene Höhen) und Zellen auf 0 bleiben. Liegt eine davon mehr als `depth` Schritt
 * unter ihm, bleibt der ganze Einlauf, wie er ist: Dann kommt der Fluss aus einem tieferen Tal (Daten), und der Anstieg bleibt ein
 * Befund statt eines Damms. Senken neben dem See, aus denen kein Einlauf liest, bleiben. Gibt die gehobenen Zellen.
 */
export function hebeEinlaeufe(
    field: Field,
    network: RiverNetwork,
    near: readonly boolean[],
    levels: Float64Array,
    depth: number,
    reach: number,
    frei: (run: number, at: number) => boolean,
): number {
    let changed = 0;
    network.runs.forEach((run, r) => {
        if (!near[r]) return;
        const entries: { lake: number; at: number }[] = [];
        for (let i = 1; i < run.lake.length; i += 1) {
            const l = run.lake[i] as number;
            if (l >= 0 && run.lake[i - 1] !== l) entries.push({ lake: l, at: i });
        }
        if (run.endLake >= 0 && (run.lake[run.lake.length - 1] as number) < 0)
            entries.push({ lake: run.endLake, at: run.lake.length });
        for (const { lake, at } of entries) {
            const level = levels[lake] as number;
            if (!(level > 0) || !Number.isFinite(level)) continue;
            let from = at;
            while (from > 0) {
                const j = from - 1;
                if ((run.lake[j] as number) >= 0 || !frei(r, j)) break;
                if (rasterHeight(field, run.xs[j] as number, run.ys[j] as number) > level + RISE_TOLERANCE) break;
                from = j;
            }
            if (from === at) continue;
            // Dieselbe ganze Zahl wie das Senken (`lowerAt`): Was das Nachschneiden auf den Spiegel schneidet, hebt dies nicht nach.
            const target = Math.floor(level + EPS);
            const cells = field.rasters.map(() => new Set<number>());
            let deepest = 0;
            for (let j = from; j < at; j += 1) {
                const x = run.xs[j] as number;
                const y = run.ys[j] as number;
                field.rasters.forEach((raster, ri) => {
                    if (raster.readOnly) return;
                    const i0 = Math.max(0, Math.ceil((x - reach - raster.originX) / raster.cell));
                    const i1 = Math.min(raster.width - 1, Math.floor((x + reach - raster.originX) / raster.cell));
                    const j0 = Math.max(0, Math.ceil((y - reach - raster.originY) / raster.cell));
                    const j1 = Math.min(raster.height - 1, Math.floor((y + reach - raster.originY) / raster.cell));
                    for (let cj = j0; cj <= j1; cj += 1) {
                        const dy = raster.originY + cj * raster.cell - y;
                        for (let ci = i0; ci <= i1; ci += 1) {
                            const k = cj * raster.width + ci;
                            const value = raster.samples[k] as number;
                            if (value === 0 || value >= target || raster.locked.has(k)) continue;
                            if (Math.hypot(raster.originX + ci * raster.cell - x, dy) > reach) continue;
                            (cells[ri] as Set<number>).add(k);
                            deepest = Math.max(deepest, target - value);
                        }
                    }
                });
            }
            if (deepest === 0 || deepest > depth) continue;
            cells.forEach((list, ri) => {
                const samples = (field.rasters[ri] as FieldRaster).samples;
                for (const k of list) samples[k] = target;
                changed += list.size;
            });
        }
    });
    return changed;
}
