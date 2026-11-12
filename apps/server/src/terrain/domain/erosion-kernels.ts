import { blurColumns, blurRows, COLUMN_BLOCK } from "./blur.ts";
import { saturatedSteps } from "./uplift.ts";
import { rho8 } from "../hydrology/flow.ts";
import { LAKE, SEA, type Plane } from "../hydrology/grid.ts";
import { landscapeSampler } from "../hydrology/landscape.ts";
import { fensterLeser, type FensterFeld, type FormerhaltFenster } from "./formerhalt.ts";

/**
 * Die zellweise unabhängigen Teile der Domänenerosion (WI-0227) als Kerne über einen Bereich. Hauptthread und Worker rechnen dieselben
 * Funktionen; welcher Thread welchen Bereich nimmt, ändert kein Bit, weil jede Zelle (beim Kastenfilter jede Zeile oder Spalte) nur
 * ihren eigenen Wert schreibt. Was in Füllfolge laufen muss (Priority-Flood, Einzugsfläche, Einschneiden), bleibt im Hauptthread.
 */

/** Die Felder der Erosion. Mit Workern liegen die großen im gemeinsamen Speicher (`SharedArrayBuffer`). */
export interface ErosionFields {
    n: number;
    cell: number;
    height: Float32Array;
    /** Die Abflussfläche, in der Rückverteilung die Höhe zu Rundenbeginn. */
    surface: Float32Array;
    /** Hilfsfeld (zugleich die Einzugsfläche). */
    spare: Float32Array;
    classes: Uint8Array;
    locked: Uint8Array;
    weightSum: Float32Array | null;
    first: Float32Array | null;
    sum: Float32Array | null;
    /** Die Materialfelder (m × m), klein: in jedem Thread eine Kopie. */
    materials: { m: number; channelBias: Float32Array; diffusivity: Float32Array; upliftWeight: Float32Array };
    /** Formerhalt der Rückennetz-Gebirge (WI-0249 P2, `formerhalt.ts`): je Gebirge ein kleines Fenster, in jedem Thread eine Kopie. */
    formerhalt?: readonly FormerhaltFenster[];
}

/** Die großen Felder, die Kerne über eine Nummer ansprechen (Kastenfilter: welches Feld, welches Hilfsfeld). */
export const FLOAT_FIELDS = ["height", "surface", "spare", "first", "sum", "weightSum"] as const;
export type FloatField = (typeof FLOAT_FIELDS)[number];

export const KERNELS = [
    "surface",
    "diffuse",
    "rho8",
    "blurRows",
    "blurColumns",
    "satFirst",
    "satWeights",
    "satSecond",
    "satApply",
] as const;
export type Kernel = (typeof KERNELS)[number];

/** Teil `part` von `parts` über `[0, total)`. */
export function chunkOf(part: number, parts: number, total: number): [number, number] {
    return [Math.floor((total * part) / parts), Math.floor((total * (part + 1)) / parts)];
}

/** Über wie viele Einheiten ein Kern verteilt wird: Zellen, Zeilen oder Spalten. */
export function kernelSpan(kernel: Kernel, n: number): number {
    return kernel === "diffuse" || kernel === "rho8" || kernel === "blurRows" || kernel === "blurColumns" ? n : n * n;
}

/** Ein Thread mit seinen Feldern: der Abtaster der Materialien und das Gewicht der Rückverteilung, wie im Hauptthread. */
export function kernelContext(fields: ErosionFields): {
    fields: ErosionFields;
    sample: (values: Float32Array, x: number, y: number) => number;
    weightAt: (k: number) => number;
    plane: Plane;
    sums: Float64Array;
    /** Die Diffusivität der Fenster des Formerhalts, NaN außerhalb; ohne Fenster nicht da. */
    fenster?: (feld: FensterFeld, x: number, y: number) => number;
} {
    const { n, classes, locked, materials } = fields;
    const sample = landscapeSampler(materials.m, n);
    const fenster = fields.formerhalt?.length ? fensterLeser(fields.formerhalt, n) : undefined;
    // Mit dem Formerhalt (WI-0249 P2, `hebungFolgt`) das Hebungsgewicht des Fensters, sonst das Materialfeld wie zuvor.
    const hebung = (x: number, y: number): number => {
        const eigen = fenster ? fenster("upliftWeight", x, y) : Number.NaN;
        return Number.isNaN(eigen) ? sample(materials.upliftWeight, x, y) : eigen;
    };
    const weightAt = (k: number): number =>
        locked[k] || classes[k]! & (SEA | LAKE) ? 0 : hebung(k % n, Math.floor(k / n));
    return {
        fields,
        sample,
        weightAt,
        plane: { width: n, height: n, cell: fields.cell, x0: 0, y0: 0 },
        sums: new Float64Array(COLUMN_BLOCK),
        ...(fenster ? { fenster } : {}),
    };
}

const fieldOf = (fields: ErosionFields, index: number): Float32Array => {
    const field = fields[FLOAT_FIELDS[index]!];
    if (!field) throw new Error(`Erosion: Feld ${String(FLOAT_FIELDS[index])} fehlt`);
    return field;
};

/**
 * Rechnet einen Kern über `[from, to)`. `args` je Kern: `diffuse` [Koeffizient], `rho8` [Saat], `blurRows`/`blurColumns` [Quelle, Ziel,
 * Radius] (Nummern aus `FLOAT_FIELDS`), `satWeights` [Sättigung]. Zurück kommt die Zählung des Bereichs (sonst 0).
 */
export function runKernel(
    context: ReturnType<typeof kernelContext>,
    kernel: Kernel,
    from: number,
    to: number,
    args: ArrayLike<number>,
): number {
    const { fields, sample } = context;
    const { n, height, surface, spare, classes, locked } = fields;
    switch (kernel) {
        case "surface": {
            const bias = fields.materials.channelBias;
            for (let k = from; k < to; k += 1) surface[k] = height[k]! - sample(bias, k % n, Math.floor(k / n));
            return 0;
        }
        case "diffuse": {
            // Wie bisher im Hauptthread: Koeffizient = (Diffusion × Zeitschritt) / Teilschritte, einmal gerechnet und übergeben.
            const coefficient = args[0]!;
            const diffusivity = fields.materials.diffusivity;
            const fenster = context.fenster;
            for (let y = Math.max(1, from); y < Math.min(n - 1, to); y += 1)
                for (let x = 1; x < n - 1; x += 1) {
                    const k = y * n + x;
                    if (locked[k] || classes[k]! & (SEA | LAKE)) continue;
                    const own = height[k]!;
                    const laplacian = height[k - 1]! + height[k + 1]! + height[k - n]! + height[k + n]! - 4 * own;
                    // Formerhalt (WI-0249 P2): im Fenster eines Rückennetz-Gebirges seine Diffusivität, sonst das Materialfeld wie zuvor.
                    const eigen = fenster ? fenster("diffusivity", x, y) : Number.NaN;
                    const d = Number.isNaN(eigen) ? sample(diffusivity, x, y) : eigen;
                    spare[k] = Math.max(0, own + coefficient * d * laplacian);
                }
            return 0;
        }
        case "rho8":
            rho8(context.plane, surface, classes, args[0]!, from, to);
            return 0;
        case "blurRows":
            blurRows(fieldOf(fields, args[0]!), fieldOf(fields, args[1]!), n, args[2]!, from, to);
            return 0;
        case "blurColumns":
            blurColumns(fieldOf(fields, args[0]!), fieldOf(fields, args[1]!), n, args[2]!, from, to, context.sums);
            return 0;
        case "satFirst":
            return saturatedSteps.first(height, surface, fields.weightSum!, fields.first!, from, to);
        case "satWeights":
            return saturatedSteps.weights(fields.first!, spare, fields.sum!, context.weightAt, args[0]!, from, to);
        case "satSecond":
            saturatedSteps.second(height, surface, fields.sum!, fields.first!, from, to);
            return 0;
        case "satApply":
            return saturatedSteps.apply(height, spare, fields.first!, from, to);
    }
}
