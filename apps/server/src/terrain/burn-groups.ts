import { createHash } from "node:crypto";
import type { StoredRaster } from "./dem-tiles.ts";
import { coneRadius, freePeakHeight, type ConeRule, type FreePeak } from "./peak-cone.ts";
import {
    ANCHOR_REACH,
    burnRivers,
    FLOOR_HALF_WIDTH,
    RIVER_BURN_VERSION,
    trenchReach,
    type RiverAnchor,
    type RiverBurnReport,
} from "./river-burn.ts";
import {
    buffersOf,
    conesAt,
    DEM_CELL,
    fieldOf,
    rasterHeight,
    sampleRuns,
    touchesField,
    type Field,
} from "./river-field.ts";
import { hashRiverInputs, rasterFingerprint } from "./river-inputs.ts";
import { buildRiverNetwork, RIVER_STEP, type RiverLake, type RiverRow } from "./river-network.ts";
import { type V12Geometry } from "@avesmaps3d/shared";

/**
 * Das Einbrennen der Flüsse in Gruppen (WI-0059, 4.1/4.2): Ein Lauf des Einbrennens rechnet nur die Gruppen neu,
 * deren Eingaben sich geändert haben, und liefert bytegleich, was ein Lauf über alle Raster zugleich lieferte.
 *
 * 🔴 Warum das gilt: Das Einbrennen (`burnRivers`) liest und schreibt Rasterzellen nur in der Nähe der Flüsse und
 * Seen, die ein Netz bilden; zwei Netze, die keine Raster teilen, beeinflussen einander nicht. Eine Gruppe ist deshalb
 * ein Zusammenhangsgebiet aus Flussnetzen (Knoten, T-Stöße, Seen) UND den Rastern, die eines davon erreicht:
 * - nah genug zum Lesen und Senken an einem Lauf (`touchesField`: Rand von zwei Zellen der Höhenkacheln),
 * - im Graben um einen Lauf (`trenchReach`, so tief wie das Gelände am Lauf höchstens ist),
 * - unter einem See, den ein Lauf berührt, samt dem Graben um sein Ufer.
 * Die Grenzen sind eine sichere obere Schranke (Chebyshev, dazu ein Abtastschritt für die Strecke zwischen zwei
 * Punkten); eine zu große Gruppe kostet nur Zeit, eine zu kleine wäre ein Fehler. `burn-groups.test.ts` rechnet
 * erfundene Landkarten mit vielen Gebirgen, Flüssen und Seen gruppenweise und im Ganzen und verlangt
 * dieselben Bytes.
 *
 * Der Fingerabdruck einer Gruppe hängt an allem, was sie liest: ihren Flüssen und Seen, dem V12-Stand ihrer Raster,
 * den Gipfeln im Gebirge, deren Zellen in ihren Rastern gesperrt sind (nur die Lage, nicht die Höhe), und den freien
 * Gipfeln, die einen ihrer Läufe berühren (Richtung b). Ändert sich ein Gipfel in einem anderen Netz, bleibt er gleich.
 */

/** Was in den Fingerabdruck eines Rasters eingeht, das kein Fluss und kein See erreicht: Es bleibt, wie V12 es liefert. */
export const UNBURNT = "unburnt";

/** Die Lesegrenze eines Laufs am Raster: derselbe Rand wie `touchesField`. */
const TOUCH_MARGIN = 2 * DEM_CELL;
/** So weit um ein Raster liegen Gipfel, deren Zellen gesperrt sein oder als Gipfel gemeldet werden können. */
const ANCHOR_PAD = ANCHOR_REACH + TOUCH_MARGIN;

export interface BurnGroup {
    /** Indizes in der Rasterliste, aufsteigend. */
    rasters: number[];
    /** Indizes in der Flussliste, aufsteigend: das ganze Flussnetz, nicht nur die Läufe am Gebirge. */
    rivers: number[];
    /** Indizes in der Seenliste, aufsteigend: die Seen, die ein Lauf der Gruppe berührt. */
    lakes: number[];
    /** Indizes der freien Gipfel, deren Kegel einen Lauf der Gruppe berührt. */
    peaks: number[];
    /** Indizes der Gipfel im Gebirge, die in der Nähe eines Rasters der Gruppe stehen. */
    anchors: number[];
}

export interface BurnPlanInput {
    /** Die ungeschnittenen Raster, wie V12 sie liefert (werden nicht verändert). */
    rasters: readonly StoredRaster[];
    rivers: readonly RiverRow[];
    lakes: readonly RiverLake[];
    peaks: readonly FreePeak[];
    rule: ConeRule;
    anchors: readonly RiverAnchor[];
}

/** Ein Zusammenhangsgebiet für Union-Find: einmal Zahl, einmal Ordnung. */
class Sets {
    private readonly parent: number[];

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, i) => i);
    }

    find(i: number): number {
        let root = i;
        while (this.parent[root] !== root) root = this.parent[root] as number;
        let node = i;
        while (this.parent[node] !== root) {
            const next = this.parent[node] as number;
            this.parent[node] = root;
            node = next;
        }
        return root;
    }

    union(a: number, b: number): void {
        const ra = this.find(a);
        const rb = this.find(b);
        // Die kleinere Nummer bleibt Wurzel: stabil, unabhängig von der Reihenfolge der Aufrufe.
        if (ra < rb) this.parent[rb] = ra;
        else if (rb < ra) this.parent[ra] = rb;
    }
}

interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const rasterBox = (r: StoredRaster): Box => ({
    minX: r.originX,
    minY: r.originY,
    maxX: r.originX + (r.width - 1) * r.cell,
    maxY: r.originY + (r.height - 1) * r.cell,
});

const grow = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });

const boxesTouch = (a: Box, b: Box): boolean =>
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const inBox = (b: Box, x: number, y: number): boolean => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

function geometryBox(geometry: V12Geometry): Box {
    const rings = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as number[][][][];
    const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const point of rings.flat(2)) {
        box.minX = Math.min(box.minX, point[0] as number);
        box.maxX = Math.max(box.maxX, point[0] as number);
        box.minY = Math.min(box.minY, point[1] as number);
        box.maxY = Math.max(box.maxY, point[1] as number);
    }
    return box;
}

/** Das größte Sample eines Rasters: eine obere Schranke für jede Tiefe eines Einschnitts in ihm. */
function maxSample(samples: Uint16Array): number {
    let max = 0;
    for (let k = 0; k < samples.length; k += 1) if ((samples[k] as number) > max) max = samples[k] as number;
    return max;
}

/**
 * Teilt Flüsse, Seen und Raster in Gruppen, die einander nicht beeinflussen. Raster, die kein Fluss und kein See
 * erreicht, gehören zu keiner Gruppe (sie bleiben, wie V12 sie liefert).
 */
export function planBurnGroups(input: BurnPlanInput): BurnGroup[] {
    const { rasters, rivers, lakes, peaks, rule, anchors } = input;
    if (rasters.length === 0 || rivers.length === 0) return [];
    const field: Field = fieldOf(rasters, anchors);
    const terrainAt = (x: number, y: number): number => Math.max(rasterHeight(field, x, y), conesAt(peaks, rule, x, y));
    const network = buildRiverNetwork(rivers, lakes, terrainAt);
    const near = network.runs.map((run) => touchesField(field, run));
    const heights = sampleRuns(field, network, near, buffersOf(network));

    const runCount = network.runs.length;
    const lakeCount = network.lakes.length;
    // Knoten: erst die Läufe, dann die Raster, dann die Seen des Netzes.
    const rasterNode = (i: number): number => runCount + i;
    const lakeNode = (l: number): number => runCount + rasters.length + l;
    const sets = new Sets(runCount + rasters.length + lakeCount);

    // Das Flussnetz: gleiche Knoten, T-Stöße und Seen.
    const owner = new Map<number, number>();
    network.runs.forEach((run, r) => {
        for (const node of [run.startNode, run.endNode]) {
            if (node < 0) continue;
            const known = owner.get(node);
            if (known === undefined) owner.set(node, r);
            else sets.union(r, known);
        }
        if (run.joinsRun >= 0) sets.union(r, run.joinsRun);
        if (run.leavesRun >= 0) sets.union(r, run.leavesRun);
        const touched = new Set<number>([run.startLake, run.endLake, ...run.lake].filter((l) => l >= 0));
        for (const l of touched) sets.union(r, lakeNode(l));
    });

    // Die Raster eines Laufs: alle, die er liest, senkt oder mit seinem Graben erreicht.
    const boxes = rasters.map(rasterBox);
    const maxes = rasters.map((r) => maxSample(r.samples));
    network.runs.forEach((run, r) => {
        if (!near[r]) return;
        let high = 0;
        for (const h of heights[r] as Float64Array) high = Math.max(high, h);
        const reach = Math.max(TOUCH_MARGIN, trenchReach(FLOOR_HALF_WIDTH, high)) + RIVER_STEP;
        const runBox: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (let i = 0; i < run.xs.length; i += 1) {
            runBox.minX = Math.min(runBox.minX, run.xs[i] as number);
            runBox.maxX = Math.max(runBox.maxX, run.xs[i] as number);
            runBox.minY = Math.min(runBox.minY, run.ys[i] as number);
            runBox.maxY = Math.max(runBox.maxY, run.ys[i] as number);
        }
        boxes.forEach((box, i) => {
            const wide = grow(box, reach);
            if (!boxesTouch(runBox, wide)) return;
            for (let p = 0; p < run.xs.length; p += 1) {
                if (inBox(wide, run.xs[p] as number, run.ys[p] as number)) {
                    sets.union(r, rasterNode(i));
                    return;
                }
            }
        });
    });

    // Die Raster eines Sees: die unter seinem Umriss, dazu der Graben um sein Ufer (so tief wie seine höchste Zelle).
    network.lakes.forEach((lake, l) => {
        const box = geometryBox(lake.geometry);
        let top = 0;
        boxes.forEach((raster, i) => {
            if (boxesTouch(box, raster)) top = Math.max(top, maxes[i] as number);
        });
        const wide = grow(box, trenchReach(0, top) + RIVER_STEP);
        boxes.forEach((raster, i) => {
            if (boxesTouch(wide, raster)) sets.union(lakeNode(l), rasterNode(i));
        });
    });

    const rowIndex = new Map(rivers.map((row, index) => [row, index]));
    const lakeIndex = new Map(lakes.map((lake, index) => [lake, index]));
    const found = new Map<number, BurnGroup & { runs: number[] }>();
    const groupOf = (root: number): BurnGroup & { runs: number[] } => {
        let group = found.get(root);
        if (!group) {
            group = { rasters: [], rivers: [], lakes: [], peaks: [], anchors: [], runs: [] };
            found.set(root, group);
        }
        return group;
    };
    rasters.forEach((_, i) => groupOf(sets.find(rasterNode(i))).rasters.push(i));
    network.runs.forEach((run, r) => {
        const group = found.get(sets.find(r));
        if (!group) return;
        group.rivers.push(rowIndex.get(run.row) as number);
        group.runs.push(r);
    });
    network.lakes.forEach((lake, l) => {
        found.get(sets.find(lakeNode(l)))?.lakes.push(lakeIndex.get(lake) as number);
    });

    const groups: BurnGroup[] = [];
    for (const group of found.values()) {
        // Ein Raster allein, das kein Lauf und kein See erreicht: kein Einbrennen.
        if (group.rivers.length === 0) continue;
        group.rivers.sort((a, b) => a - b);
        group.lakes.sort((a, b) => a - b);
        const padded = group.rasters.map((i) => grow(boxes[i] as Box, ANCHOR_PAD));
        group.anchors = anchors.flatMap((a, index) => (padded.some((box) => inBox(box, a.x, a.y)) ? [index] : []));
        group.peaks = peaks.flatMap((peak, index) => {
            const radius = coneRadius(freePeakHeight(peak), rule);
            const touches = group.runs.some((r) => {
                const run = network.runs[r];
                if (!run) return false;
                for (let p = 0; p < run.xs.length; p += 1) {
                    if (
                        Math.abs((run.xs[p] as number) - peak.x) < radius &&
                        Math.abs((run.ys[p] as number) - peak.y) < radius
                    ) {
                        return true;
                    }
                }
                return false;
            });
            return touches ? [index] : [];
        });
        groups.push({
            rasters: group.rasters,
            rivers: group.rivers,
            lakes: group.lakes,
            peaks: group.peaks,
            anchors: group.anchors,
        });
    }
    return groups.sort((a, b) => (a.rasters[0] as number) - (b.rasters[0] as number));
}

/** Die Lage der Gipfel im Gebirge nahe der Gruppe, geordnet: Nur die Lage sperrt Zellen, nicht die Höhe. */
function anchorPositions(group: BurnGroup, input: BurnPlanInput): [number, number][] {
    return group.anchors
        .map((i): [number, number] => [(input.anchors[i] as RiverAnchor).x, (input.anchors[i] as RiverAnchor).y])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Der Fingerabdruck einer Gruppe: alles, was ihr Einbrennen liest. */
export function groupFingerprint(group: BurnGroup, input: BurnPlanInput, rasterKeys: readonly string[]): string {
    const rows = group.rivers.map((i) => input.rivers[i] as RiverRow);
    const lakes = group.lakes.map((i) => input.lakes[i] as RiverLake);
    return (
        createHash("sha256")
            .update(`${RIVER_BURN_VERSION}|r:${hashRiverInputs(rows, lakes)}`)
            // Sortiert: Die Reihenfolge der Gebirge und Gipfel in den Listen ist keine Eingabe.
            .update(
                `|m:${group.rasters
                    .map((i) => rasterKeys[i])
                    .sort()
                    .join(",")}`,
            )
            .update(`|a:${JSON.stringify(anchorPositions(group, input))}`)
            .update(`|p:${JSON.stringify(group.peaks.map((i) => input.peaks[i]))}|c:${JSON.stringify(input.rule)}`)
            .digest("hex")
    );
}

export interface BurnRaster {
    areaId: number;
    /** Der Fingerabdruck der V12-Rechnung, deren Ergebnis `raster` ist. */
    v12Fingerprint: string;
    /** Das Raster wie V12 es liefert, vor dem Einbrennen. Wird nicht verändert. */
    raster: StoredRaster;
}

export interface BurnStored {
    fingerprint: string;
    samples: Uint16Array;
}

export interface BurnedRaster {
    areaId: number;
    /** Was in `terrain_raster.fingerprint` steht (`rasterFingerprint`). */
    fingerprint: string;
    /** Das eingebrannte Raster. */
    samples: Uint16Array;
    /** Dieser Lauf hat die Gruppe des Rasters neu eingebrannt. */
    burned: boolean;
    /** Fingerabdruck oder Inhalt weichen vom Gespeicherten ab: zu schreiben. */
    changed: boolean;
}

export interface BurnRun {
    rasters: BurnedRaster[];
    /** Gruppen insgesamt, neu eingebrannte, und die Raster darin. */
    groups: number;
    burnedGroups: number;
    burnedRasters: number;
    /** Die Berichte der neu eingebrannten Gruppen, zusammengelegt; `null`, wenn keine brannte. */
    report: RiverBurnReport | null;
}

export interface BurnInput extends Omit<BurnPlanInput, "rasters"> {
    rasters: readonly BurnRaster[];
    /** Der gespeicherte Stand je Raster (Fingerabdruck und eingebrannte Samples). */
    stored: ReadonlyMap<number, BurnStored>;
    /** Alle Gruppen neu einbrennen, auch die aktuellen; oder nur die, in denen eines dieser Gebirge (`areaId`) liegt. */
    force?: boolean | ReadonlySet<number>;
}

/** Die Fingerabdrücke, die jedes Raster haben muss, damit es zu den Eingaben passt; ohne zu brennen. */
export function targetFingerprints(input: BurnInput): { groups: BurnGroup[]; targets: string[] } {
    const plan: BurnPlanInput = { ...input, rasters: input.rasters.map((entry) => entry.raster) };
    const groups = planBurnGroups(plan);
    const keys = input.rasters.map((entry) => `${String(entry.areaId)}=${entry.v12Fingerprint}`);
    const targets = input.rasters.map((entry) => rasterFingerprint(entry.v12Fingerprint, UNBURNT));
    const groupKeys = groups.map((group) => groupFingerprint(group, plan, keys));
    groups.forEach((group, g) => {
        for (const i of group.rasters) {
            targets[i] = rasterFingerprint((input.rasters[i] as BurnRaster).v12Fingerprint, groupKeys[g] as string);
        }
    });
    return { groups, targets };
}

const copyOf = (raster: StoredRaster): StoredRaster => ({ ...raster, samples: Uint16Array.from(raster.samples) });

const sameSamples = (a: Uint16Array, b: Uint16Array): boolean =>
    a.length === b.length &&
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/**
 * Brennt die Flüsse ein, nur wo es nötig ist: Eine Gruppe, deren Raster alle mit dem heutigen Fingerabdruck gespeichert
 * sind, bleibt, wie sie ist. Jede andere wird aus dem ungeschnittenen Stand ihrer Raster neu gebrannt. Das Ergebnis ist
 * bytegleich zu dem eines Laufs, der alle Gruppen brennt (`force`).
 */
export function burnRasters(input: BurnInput): BurnRun {
    const { rivers, lakes, peaks, rule, anchors } = input;
    const { groups, targets } = targetFingerprints(input);
    const out: (BurnedRaster | undefined)[] = input.rasters.map(() => undefined);
    const reports: RiverBurnReport[] = [];
    let burnedGroups = 0;
    let burnedRasters = 0;

    groups.forEach((group) => {
        const forced =
            input.force === true ||
            (input.force instanceof Set &&
                group.rasters.some((i) =>
                    (input.force as ReadonlySet<number>).has((input.rasters[i] as BurnRaster).areaId),
                ));
        const stale =
            forced ||
            group.rasters.some((i) => {
                const entry = input.rasters[i] as BurnRaster;
                const stored = input.stored.get(entry.areaId);
                return !stored || stored.fingerprint !== targets[i];
            });
        if (!stale) {
            for (const i of group.rasters) {
                const entry = input.rasters[i] as BurnRaster;
                const stored = input.stored.get(entry.areaId) as BurnStored;
                out[i] = {
                    areaId: entry.areaId,
                    fingerprint: targets[i] as string,
                    samples: stored.samples,
                    burned: false,
                    changed: false,
                };
            }
            return;
        }
        burnedGroups += 1;
        burnedRasters += group.rasters.length;
        const working = group.rasters.map((i) => copyOf((input.rasters[i] as BurnRaster).raster));
        reports.push(
            burnRivers(
                working,
                {
                    rivers: group.rivers.map((i) => rivers[i] as RiverRow),
                    lakes: group.lakes.map((i) => lakes[i] as RiverLake),
                },
                {
                    peaks: group.peaks.map((i) => peaks[i] as FreePeak),
                    rule,
                    anchors: group.anchors.map((i) => anchors[i] as RiverAnchor),
                },
            ),
        );
        group.rasters.forEach((i, k) => {
            const entry = input.rasters[i] as BurnRaster;
            const stored = input.stored.get(entry.areaId);
            const samples = (working[k] as StoredRaster).samples;
            out[i] = {
                areaId: entry.areaId,
                fingerprint: targets[i] as string,
                samples,
                burned: true,
                changed: !stored || stored.fingerprint !== targets[i] || !sameSamples(stored.samples, samples),
            };
        });
    });

    input.rasters.forEach((entry, i) => {
        if (out[i]) return;
        const stored = input.stored.get(entry.areaId);
        if (
            input.force !== true &&
            !(input.force instanceof Set && input.force.has(entry.areaId)) &&
            stored &&
            stored.fingerprint === targets[i]
        ) {
            out[i] = {
                areaId: entry.areaId,
                fingerprint: targets[i] as string,
                samples: stored.samples,
                burned: false,
                changed: false,
            };
            return;
        }
        const samples = Uint16Array.from(entry.raster.samples);
        out[i] = {
            areaId: entry.areaId,
            fingerprint: targets[i] as string,
            samples,
            burned: false,
            changed: !stored || stored.fingerprint !== targets[i] || !sameSamples(stored.samples, samples),
        };
    });

    return {
        rasters: out as BurnedRaster[],
        groups: groups.length,
        burnedGroups,
        burnedRasters,
        report: mergeBurnReports(reports),
    };
}

/** Legt die Berichte der Gruppen zusammen: Zahlen addiert, Befunde vereint und nach Wert geordnet. */
export function mergeBurnReports(reports: readonly RiverBurnReport[]): RiverBurnReport | null {
    const first = reports[0];
    if (!first) return null;
    const byValue = (a: { value: number }, b: { value: number }): number => b.value - a.value;
    const stats = (pick: (r: RiverBurnReport) => RiverBurnReport["rasters"]): RiverBurnReport["rasters"] => ({
        risingBefore: reports.reduce((sum, r) => sum + pick(r).risingBefore, 0),
        risingAfter: reports.reduce((sum, r) => sum + pick(r).risingAfter, 0),
        riseBefore: reports.reduce((sum, r) => sum + pick(r).riseBefore, 0),
        riseAfter: reports.reduce((sum, r) => sum + pick(r).riseAfter, 0),
        aboveAfter: Math.max(...reports.map((r) => pick(r).aboveAfter)),
    });
    return {
        runs: reports.reduce((sum, r) => sum + r.runs, 0),
        withHeight: reports.reduce((sum, r) => sum + r.withHeight, 0),
        rasters: stats((r) => r.rasters),
        tiles: stats((r) => r.tiles),
        rounds: Math.max(...reports.map((r) => r.rounds)),
        converged: reports.every((r) => r.converged),
        changedCells: reports.reduce((sum, r) => sum + r.changedCells, 0),
        deepest: Math.max(...reports.map((r) => r.deepest)),
        directions: {
            daten: reports.reduce((sum, r) => sum + r.directions.daten, 0),
            geerbt: reports.reduce((sum, r) => sum + r.directions.geerbt, 0),
            gelaende: reports.reduce((sum, r) => sum + r.directions.gelaende, 0),
            kueste: reports.reduce((sum, r) => sum + r.directions.kueste, 0),
            vorgabe: reports.reduce((sum, r) => sum + r.directions.vorgabe, 0),
        },
        undirected: reports.flatMap((r) => r.undirected),
        uphill: reports.flatMap((r) => r.uphill).sort(byValue),
        deepCuts: reports.flatMap((r) => r.deepCuts).sort(byValue),
        coneRises: reports.flatMap((r) => r.coneRises).sort(byValue),
        peakRises: reports.flatMap((r) => r.peakRises).sort(byValue),
        unresolved: reports.flatMap((r) => r.unresolved).sort(byValue),
        lakes: reports.flatMap((r) => r.lakes),
    };
}
