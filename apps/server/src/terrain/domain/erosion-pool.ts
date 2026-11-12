import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { blur } from "./blur.ts";
import {
    chunkOf,
    FLOAT_FIELDS,
    KERNELS,
    kernelContext,
    kernelSpan,
    runKernel,
    type ErosionFields,
    type FloatField,
    type Kernel,
} from "./erosion-kernels.ts";
import { redistributeSaturated, type SaturationFields } from "./uplift.ts";
import { rho8 } from "../hydrology/flow.ts";

/**
 * Wer die zellweise unabhängigen Teile der Domänenerosion rechnet (WI-0227): der Hauptthread allein oder zusätzlich Worker. Beide
 * liefern dasselbe Gelände; der Hauptthread allein rechnet genau wie vor WI-0227 (dieselben Funktionen über das Ganze).
 *
 * 🔴 Mit Workern: Die Felder liegen im gemeinsamen Speicher, der Hauptthread verteilt einen Kern auf alle Threads (er selbst nimmt den
 * letzten Teil) und wartet mit `Atomics.wait`, bis alle fertig sind. Die Rechnung bleibt synchron: kein `await`, kein Ereignis.
 * Claudio 2026-10-18: 2 Worker plus Hauptthread (3 von 4 Kernen), Profil der Jobart entsprechend.
 */
export interface ErosionExec {
    readonly threads: number;
    /** Ein Kern über alle Einheiten; zurück die Zählungen je Teil in fester Reihenfolge. */
    run(kernel: Kernel, args?: readonly number[]): number[];
    blur(field: FloatField, spare: FloatField, radius: number): void;
    rho8(seed: number): void;
    saturated(
        weightAt: (k: number) => number,
        radius: number,
        saturation: number,
    ): { clampedCells: number; unplacedLoss: number; saturatedCells: number };
    close(): void;
}

/** Der Hauptthread allein: dieselben Funktionen wie vor WI-0227, jeweils über das Ganze. */
export function inlineErosion(fields: ErosionFields): ErosionExec {
    const context = kernelContext(fields);
    const { n } = fields;
    return {
        threads: 1,
        run: (kernel, args = []) => [runKernel(context, kernel, 0, kernelSpan(kernel, n), args)],
        blur: (field, spare, radius) => blur(fields[field]!, fields[spare]!, n, radius),
        rho8: (seed) => rho8(context.plane, fields.surface, fields.classes, seed),
        saturated: (weightAt, radius, saturation) =>
            redistributeSaturated(
                fields.height,
                fields.surface,
                fields.spare,
                { first: fields.first!, sum: fields.sum! } satisfies SaturationFields,
                fields.weightSum!,
                weightAt,
                n,
                radius,
                saturation,
            ),
        close: () => undefined,
    };
}

/** Ein Feld derselben Länge im gemeinsamen Speicher, mit dem Inhalt von `source`. */
export function sharedCopy<T extends Float32Array | Uint8Array>(source: T): T {
    const Type = source.constructor as new (buffer: SharedArrayBuffer) => T;
    const copy = new Type(new SharedArrayBuffer(source.byteLength));
    copy.set(source as ArrayLike<number> & T);
    return copy;
}

export function sharedFloat32(length: number): Float32Array {
    return new Float32Array(new SharedArrayBuffer(length * 4));
}

/** Steuerblock: [Generation, fertig, Fehler, bereit]; die Generation −1 beendet die Worker. */
const GENERATION = 0;
const DONE = 1;
const FAILED = 2;
const READY = 3;
/** So lange wartet der Lauf auf den Start der Worker, sonst rechnet er allein. */
const READY_TIMEOUT_MS = 30_000;
/** So lange darf ein Kern in den Workern dauern (ein Durchgang des Filters auf 4096² braucht unter einer Sekunde). */
const RUN_TIMEOUT_MS = 600_000;

const workerFile = new URL(`./erosion-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

/** Worker für die Erosion; ohne Worker (0) oder wenn sie nicht starten, der Hauptthread allein. */
export function erosionExec(fields: ErosionFields, workers: number): ErosionExec {
    if (workers <= 0) return inlineErosion(fields);
    const control = new Int32Array(new SharedArrayBuffer(4 * 4));
    const args = new Float64Array(new SharedArrayBuffer(8 * 8));
    const results = new Float64Array(new SharedArrayBuffer(8 * workers));
    const threads: Worker[] = [];
    // Scheitert ein Worker (Laden oder Absturz), weckt er den Hauptthread mit „Fehler“, statt den Prozess zu beenden.
    const failed = (error: unknown): void => {
        console.warn(`Erosion: Worker gescheitert (${error instanceof Error ? error.message : String(error)})`);
        Atomics.store(control, FAILED, 1);
        Atomics.add(control, READY, workers);
        Atomics.add(control, DONE, workers);
        Atomics.notify(control, READY);
        Atomics.notify(control, DONE);
    };
    for (let index = 0; index < workers; index += 1) {
        const thread = new Worker(workerFile, { workerData: { fields, control, args, results, index, workers } });
        thread.on("error", failed);
        threads.push(thread);
    }
    const startedAt = Date.now();
    let ready = Atomics.load(control, READY);
    while (ready < workers && Date.now() - startedAt < READY_TIMEOUT_MS) {
        Atomics.wait(control, READY, ready, 200);
        ready = Atomics.load(control, READY);
    }
    if (ready < workers || Atomics.load(control, FAILED) !== 0) {
        // Ohne Worker rechnet der Hauptthread allein: dasselbe Gelände, nur langsamer.
        console.warn("Erosion: Worker nicht bereit, der Hauptthread rechnet allein");
        for (const thread of threads) void thread.terminate();
        return inlineErosion(fields);
    }
    for (const thread of threads) thread.unref();
    const context = kernelContext(fields);
    const { n } = fields;
    const parts = workers + 1;

    const run = (kernel: Kernel, kernelArgs: readonly number[] = []): number[] => {
        const total = kernelSpan(kernel, n);
        args[0] = KERNELS.indexOf(kernel);
        for (let i = 0; i < kernelArgs.length; i += 1) args[1 + i] = kernelArgs[i]!;
        Atomics.store(control, DONE, 0);
        Atomics.add(control, GENERATION, 1);
        Atomics.notify(control, GENERATION);
        const [from, to] = chunkOf(workers, parts, total);
        const own = runKernel(context, kernel, from, to, kernelArgs);
        const waitingSince = Date.now();
        let done = Atomics.load(control, DONE);
        while (done < workers) {
            if (Date.now() - waitingSince > RUN_TIMEOUT_MS)
                throw new Error(`Erosion: Worker antworten nicht im Kern ${kernel}`);
            Atomics.wait(control, DONE, done, 1000);
            done = Atomics.load(control, DONE);
        }
        if (Atomics.load(control, FAILED) !== 0) throw new Error(`Erosion: ein Worker scheiterte im Kern ${kernel}`);
        return [...Array.from(results), own];
    };
    const field = (name: FloatField): number => FLOAT_FIELDS.indexOf(name);
    const parallelBlur = (source: FloatField, spare: FloatField, radius: number): void => {
        if (radius === 0) return;
        for (let pass = 0; pass < 3; pass += 1) {
            run("blurRows", [field(source), field(spare), radius]);
            run("blurColumns", [field(spare), field(source), radius]);
        }
    };
    const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
    return {
        threads: parts,
        run,
        blur: parallelBlur,
        rho8: (seed) => void run("rho8", [seed]),
        // Wie `redistributeSaturated`, nur verteilt. `weightAt` rechnet jeder Thread selbst aus denselben Feldern (`kernelContext`).
        saturated: (_weightAt, radius, saturation) => {
            const unplacedLoss = sum(run("satFirst"));
            parallelBlur("first", "spare", radius);
            const saturatedCells = sum(run("satWeights", [saturation]));
            parallelBlur("sum", "first", radius);
            run("satSecond");
            parallelBlur("first", "surface", radius);
            const clampedCells = sum(run("satApply"));
            return { clampedCells, unplacedLoss, saturatedCells };
        },
        close: () => {
            Atomics.store(control, GENERATION, -1);
            Atomics.notify(control, GENERATION);
            for (const thread of threads) void thread.terminate();
        },
    };
}
