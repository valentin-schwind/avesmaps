import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";

/**
 * Das Flussnetz für das Einbrennen (WI-0049 S6): jeder `Flussweg` als Lauf in Fließrichtung, dicht
 * abgetastet, samt seinen Verbindungen zu anderen Läufen und zu Seen.
 *
 * 🔴 Fließrichtung (Koordination 2026-09-28, dieselbe Regel wie das Relief, WI-0054):
 * - `forward` fließt vom ersten zum letzten Stützpunkt, `reverse` umgekehrt (Migration 0028).
 * - Ohne Angabe (a) erbt ein Lauf die Richtung verbundener Läufe, wenn Ende auf Anfang trifft;
 *   (b) sonst fließt er von der höheren zur tieferen Stelle an den Enden, gemessen im ungeschnittenen
 *   Gelände; (c) bei Gleichstand ist das küstennähere Ende die Mündung.
 *
 * Verbindungen: gleiche Endpunkte bilden einen Knoten. Eine Mündung auf dem Inneren eines anderen Laufs
 * (T-Stoß, bis `JOIN_TOLERANCE`) mündet dort, eine Quelle dort zweigt ab. Ein Ende in einem See oder bis
 * `JOIN_TOLERANCE` davor hängt am See; Punkte im See gehören zum See.
 */

type Position = [number, number];

/**
 * Abtastung der Läufe in Karteneinheiten: eine Achtelzelle der Gebirgsraster (0,25 E). Mit einer Viertelzelle
 * stiegen zwischen den Prüfpunkten, in den Kacheln fein nachgemessen, noch 19 Läufe um bis zu 5,5 Schritt.
 */
export const RIVER_STEP = 0.03125;
/** Bis zu diesem Abstand stößt ein Laufende an einen anderen Lauf oder einen See (Karteneinheiten). */
export const JOIN_TOLERANCE = 0.05;
/** Unterschied der Endhöhen in Schritt, ab dem (b) entscheidet; darunter gilt die Küste. */
const HEIGHT_TIE = 0.5;

export interface RiverRow {
    /** `path.id`. */
    id: string;
    /**
     * Die öffentliche Kennung des Weges (`path.public_id`), nur für Befunde: Wer einen Fluss nennt, nennt ihn mit ihr (WI-0131).
     * 🪤 Sie steht in keinem Fingerabdruck (`hashRiverInputs` zählt die Felder einzeln auf); `id` bleibt der Schlüssel der Rechnung.
     */
    publicId?: string;
    name: string;
    bach: boolean;
    direction: "forward" | "reverse" | null;
    coordinates: Position[];
    /** Abstand des ersten und letzten Stützpunkts zum Meer, nur für Läufe ohne Richtung. */
    coast: [number, number] | null;
}

export interface RiverLake {
    id: string;
    name: string;
    geometry: V12Geometry;
}

/** Woher die Fließrichtung eines Laufs kommt. */
export type DirectionSource = "daten" | "geerbt" | "gelaende" | "kueste" | "vorgabe";

export interface RiverRun {
    row: RiverRow;
    /** Geometrie gegen die Fließrichtung gelesen. */
    reversed: boolean;
    how: DirectionSource;
    /** Die Abtastpunkte in Fließrichtung. */
    xs: Float64Array;
    ys: Float64Array;
    /** Der See je Punkt (Index in `lakes`), sonst −1. */
    lake: Int32Array;
    startNode: number;
    endNode: number;
    startLake: number;
    endLake: number;
    /** T-Stoß der Mündung: Lauf und Punkt, in den sie mündet; sonst −1. */
    joinsRun: number;
    joinsAt: number;
    /** Abzweig der Quelle aus dem Inneren eines Laufs; sonst −1. */
    leavesRun: number;
    leavesAt: number;
}

export interface RiverNetwork {
    runs: RiverRun[];
    /** Nur die Seen, die ein Lauf berührt: Seen ohne Fluss bleiben, wie sie sind. */
    lakes: RiverLake[];
    /** Die Läufe flussab sortiert, soweit das Netz es zulässt (Kreise hinten). */
    order: number[];
    nodes: number;
}

const keyOf = (p: Position): string => `${String(Math.round(p[0] * 1e7))},${String(Math.round(p[1] * 1e7))}`;

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function boundsOf(points: readonly Position[]): Bounds {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of points) {
        b.minX = Math.min(b.minX, x);
        b.minY = Math.min(b.minY, y);
        b.maxX = Math.max(b.maxX, x);
        b.maxY = Math.max(b.maxY, y);
    }
    return b;
}

function ringsOf(geometry: V12Geometry): Position[][] {
    return geometry.type === "Polygon"
        ? (geometry.coordinates as Position[][])
        : (geometry.coordinates as Position[][][]).flat();
}

/** Abstand eines Punkts zu einer Strecke und die Lage des Fußpunkts (0..1). */
export function footOf(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): { d: number; t: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/** Liegt der Punkt im See oder höchstens `JOIN_TOLERANCE` davor? */
function nearLake(lake: RiverLake, bounds: Bounds, x: number, y: number): boolean {
    if (
        x < bounds.minX - JOIN_TOLERANCE ||
        x > bounds.maxX + JOIN_TOLERANCE ||
        y < bounds.minY - JOIN_TOLERANCE ||
        y > bounds.maxY + JOIN_TOLERANCE
    ) {
        return false;
    }
    if (pointInGeometry([x, y], lake.geometry)) return true;
    for (const ring of ringsOf(lake.geometry)) {
        for (let k = 1; k < ring.length; k += 1) {
            const [ax, ay] = ring[k - 1] as Position;
            const [bx, by] = ring[k] as Position;
            if (footOf(x, y, ax, ay, bx, by).d <= JOIN_TOLERANCE) return true;
        }
    }
    return false;
}

/** Die Punkte einer Linie alle höchstens `RIVER_STEP`, jeder Stützpunkt dabei. */
function densify(points: readonly Position[]): { xs: Float64Array; ys: Float64Array } {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 1; k < points.length; k += 1) {
        const [x0, y0] = points[k - 1] as Position;
        const [x1, y1] = points[k] as Position;
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / RIVER_STEP));
        for (let s = k === 1 ? 0 : 1; s <= steps; s += 1) {
            xs.push(x0 + ((x1 - x0) * s) / steps);
            ys.push(y0 + ((y1 - y0) * s) / steps);
        }
    }
    if (points.length === 1) {
        xs.push((points[0] as Position)[0]);
        ys.push((points[0] as Position)[1]);
    }
    return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/**
 * Richtet die Läufe nach der Regel oben aus.
 *
 * @param heightAt  das ungeschnittene Gelände in Schritt (Gebirge und freie Gipfel, außerhalb 0), für (b).
 */
export function orientRivers(
    rows: readonly RiverRow[],
    heightAt: (x: number, y: number) => number,
): { reversed: boolean; how: DirectionSource }[] {
    const first = rows.map((row) => keyOf(row.coordinates[0] as Position));
    const last = rows.map((row) => keyOf(row.coordinates[row.coordinates.length - 1] as Position));
    const at = new Map<string, number[]>();
    rows.forEach((_, index) => {
        for (const key of new Set([first[index] as string, last[index] as string])) {
            const list = at.get(key) ?? [];
            list.push(index);
            at.set(key, list);
        }
    });
    const result = rows.map((row) => ({
        reversed: row.direction === "reverse",
        how: (row.direction ? "daten" : "vorgabe") as DirectionSource,
        known: row.direction !== null,
    }));
    // (a) erben, solange sich etwas klärt. Mündung eines Nachbarn am Anfang oder seine Quelle am Ende
    // stimmen für „vorwärts“, das Umgekehrte für „rückwärts“.
    const mouthOf = (index: number): string => (result[index]?.reversed ? first[index] : last[index]) as string;
    const sourceOf = (index: number): string => (result[index]?.reversed ? last[index] : first[index]) as string;
    for (let changed = true; changed;) {
        changed = false;
        rows.forEach((_, index) => {
            const own = result[index];
            if (!own || own.known) return;
            let forward = 0;
            let backward = 0;
            const a = first[index] as string;
            const b = last[index] as string;
            for (const [key, isStart] of [
                [a, true],
                [b, false],
            ] as const) {
                for (const other of at.get(key) ?? []) {
                    if (other === index || !result[other]?.known) continue;
                    const mouthHere = mouthOf(other) === key;
                    const sourceHere = sourceOf(other) === key;
                    if (mouthHere) {
                        if (isStart) forward += 1;
                        else backward += 1;
                    }
                    if (sourceHere) {
                        if (isStart) backward += 1;
                        else forward += 1;
                    }
                }
            }
            if (forward > 0 && backward === 0) {
                result[index] = { reversed: false, how: "geerbt", known: true };
                changed = true;
            } else if (backward > 0 && forward === 0) {
                result[index] = { reversed: true, how: "geerbt", known: true };
                changed = true;
            }
        });
    }
    // (b) Gelände, (c) Küste; sonst bleibt die Geometrie.
    rows.forEach((row, index) => {
        if (result[index]?.known) return;
        const [ax, ay] = row.coordinates[0] as Position;
        const [bx, by] = row.coordinates[row.coordinates.length - 1] as Position;
        const ha = heightAt(ax, ay);
        const hb = heightAt(bx, by);
        if (Math.abs(ha - hb) > HEIGHT_TIE) {
            result[index] = { reversed: hb > ha, how: "gelaende", known: true };
        } else if (row.coast && row.coast[0] !== row.coast[1]) {
            result[index] = { reversed: row.coast[0] < row.coast[1], how: "kueste", known: true };
        } else {
            result[index] = { reversed: false, how: "vorgabe", known: true };
        }
    });
    return result.map(({ reversed, how }) => ({ reversed, how }));
}

/**
 * Der nächste Punkt eines anderen Laufs bis `JOIN_TOLERANCE`. Geprüft werden nur Läufe, deren Hüllrechteck
 * nahe genug liegt; ein Suchgitter über alle Strecken kostete 40 MB für rund 1.000 Enden.
 */
function nearestInterior(
    runs: readonly RiverRun[],
    boxes: readonly Bounds[],
    self: number,
    x: number,
    y: number,
): { run: number; at: number } | null {
    let best: { run: number; at: number; d: number } | null = null;
    runs.forEach((run, r) => {
        const b = boxes[r] as Bounds;
        if (
            r === self ||
            x < b.minX - JOIN_TOLERANCE ||
            x > b.maxX + JOIN_TOLERANCE ||
            y < b.minY - JOIN_TOLERANCE ||
            y > b.maxY + JOIN_TOLERANCE
        ) {
            return;
        }
        for (let i = 1; i < run.xs.length; i += 1) {
            const foot = footOf(
                x,
                y,
                run.xs[i - 1] as number,
                run.ys[i - 1] as number,
                run.xs[i] as number,
                run.ys[i] as number,
            );
            if (foot.d > JOIN_TOLERANCE || (best && foot.d >= best.d)) continue;
            best = { run: r, at: foot.t < 0.5 ? i - 1 : i, d: foot.d };
        }
    });
    return best ? { run: (best as { run: number }).run, at: (best as { at: number }).at } : null;
}

/** Baut das Netz: Richtung, Abtastung, Knoten, T-Stöße, Seen, Reihenfolge. */
export function buildRiverNetwork(
    rows: readonly RiverRow[],
    lakes: readonly RiverLake[],
    heightAt: (x: number, y: number) => number,
): RiverNetwork {
    const usable = rows.filter((row) => row.coordinates.length >= 2);
    const directions = orientRivers(usable, heightAt);
    const lakeBounds = lakes.map((lake) => boundsOf(ringsOf(lake.geometry).flat()));
    const touched = new Set<number>();
    const lakeAt = (x: number, y: number, near: boolean): number => {
        for (let l = 0; l < lakes.length; l += 1) {
            const b = lakeBounds[l] as Bounds;
            const lake = lakes[l] as RiverLake;
            if (near ? nearLake(lake, b, x, y) : x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
                if (near || pointInGeometry([x, y], lake.geometry)) return l;
            }
        }
        return -1;
    };

    const nodeIds = new Map<string, number>();
    const endpointCount = new Map<string, number>();
    for (const row of usable) {
        for (const p of [row.coordinates[0], row.coordinates[row.coordinates.length - 1]] as Position[]) {
            endpointCount.set(keyOf(p), (endpointCount.get(keyOf(p)) ?? 0) + 1);
        }
    }
    const nodeOf = (p: Position): number => {
        const key = keyOf(p);
        if ((endpointCount.get(key) ?? 0) < 2) return -1;
        let id = nodeIds.get(key);
        if (id === undefined) {
            id = nodeIds.size;
            nodeIds.set(key, id);
        }
        return id;
    };

    const runs: RiverRun[] = usable.map((row, index) => {
        const direction = directions[index] as { reversed: boolean; how: DirectionSource };
        const points = direction.reversed ? [...row.coordinates].reverse() : row.coordinates;
        const { xs, ys } = densify(points);
        const lake = new Int32Array(xs.length).fill(-1);
        for (let i = 0; i < xs.length; i += 1) {
            const l = lakeAt(xs[i] as number, ys[i] as number, false);
            lake[i] = l;
            if (l >= 0) touched.add(l);
        }
        const start = points[0] as Position;
        const end = points[points.length - 1] as Position;
        const startLake = lakeAt(start[0], start[1], true);
        const endLake = lakeAt(end[0], end[1], true);
        if (startLake >= 0) touched.add(startLake);
        if (endLake >= 0) touched.add(endLake);
        return {
            row,
            reversed: direction.reversed,
            how: direction.how,
            xs,
            ys,
            lake,
            startNode: nodeOf(start),
            endNode: nodeOf(end),
            startLake,
            endLake,
            joinsRun: -1,
            joinsAt: -1,
            leavesRun: -1,
            leavesAt: -1,
        };
    });

    // T-Stöße: nur Enden, die keinen anderen Endpunkt treffen.
    const boxes = usable.map((row) => boundsOf(row.coordinates));
    runs.forEach((run, r) => {
        const n = run.xs.length - 1;
        if (run.endNode < 0 && run.endLake < 0) {
            const hit = nearestInterior(runs, boxes, r, run.xs[n] as number, run.ys[n] as number);
            if (hit) {
                run.joinsRun = hit.run;
                run.joinsAt = hit.at;
            }
        }
        if (run.startNode < 0 && run.startLake < 0) {
            const hit = nearestInterior(runs, boxes, r, run.xs[0] as number, run.ys[0] as number);
            if (hit) {
                run.leavesRun = hit.run;
                run.leavesAt = hit.at;
            }
        }
    });

    // Nur berührte Seen bleiben; die Indizes werden verdichtet.
    const kept = [...touched].sort((a, b) => a - b);
    const remap = new Map(kept.map((old, index) => [old, index]));
    const at = (l: number): number => (l >= 0 ? (remap.get(l) ?? -1) : -1);
    for (const run of runs) {
        for (let i = 0; i < run.lake.length; i += 1) run.lake[i] = at(run.lake[i] as number);
        run.startLake = at(run.startLake);
        run.endLake = at(run.endLake);
    }

    return { runs, lakes: kept.map((l) => lakes[l] as RiverLake), order: flowOrder(runs), nodes: nodeIds.size };
}

/** Die Läufe flussab (Kahn); was in Kreisen hängt, kommt in der Reihenfolge der Eingabe hinten dran. */
function flowOrder(runs: readonly RiverRun[]): number[] {
    const next = runs.map(() => new Set<number>());
    const byStartNode = new Map<number, number[]>();
    const lakeOut = new Map<number, number[]>();
    runs.forEach((run, r) => {
        if (run.startNode >= 0) byStartNode.set(run.startNode, [...(byStartNode.get(run.startNode) ?? []), r]);
        const outs = new Set<number>();
        if (run.startLake >= 0) outs.add(run.startLake);
        for (let i = 1; i < run.lake.length; i += 1) {
            if ((run.lake[i - 1] as number) >= 0 && run.lake[i] !== run.lake[i - 1])
                outs.add(run.lake[i - 1] as number);
        }
        for (const l of outs) lakeOut.set(l, [...(lakeOut.get(l) ?? []), r]);
    });
    runs.forEach((run, r) => {
        const add = (target: number): void => {
            if (target !== r && target >= 0) (next[r] as Set<number>).add(target);
        };
        for (const target of byStartNode.get(run.endNode) ?? []) add(target);
        add(run.joinsRun);
        if (run.leavesRun >= 0) (next[run.leavesRun] as Set<number>).add(r);
        const ins = new Set<number>();
        if (run.endLake >= 0) ins.add(run.endLake);
        for (let i = 0; i < run.lake.length; i += 1) if ((run.lake[i] as number) >= 0) ins.add(run.lake[i] as number);
        for (const l of ins) for (const target of lakeOut.get(l) ?? []) add(target);
    });
    const incoming = runs.map(() => 0);
    next.forEach((targets) => targets.forEach((t) => (incoming[t] = (incoming[t] as number) + 1)));
    const queue = runs.map((_, r) => r).filter((r) => incoming[r] === 0);
    const order: number[] = [];
    const seen = new Set<number>();
    while (queue.length > 0) {
        const r = queue.shift() as number;
        order.push(r);
        seen.add(r);
        for (const t of next[r] as Set<number>) {
            incoming[t] = (incoming[t] as number) - 1;
            if (incoming[t] === 0) queue.push(t);
        }
    }
    runs.forEach((_, r) => {
        if (!seen.has(r)) order.push(r);
    });
    return order;
}
