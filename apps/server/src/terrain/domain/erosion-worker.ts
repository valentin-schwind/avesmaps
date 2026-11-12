import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { workerData } from "node:worker_threads";
import type { ErosionFields } from "./erosion-kernels.ts";

/**
 * Ein Worker der Domänenerosion (WI-0227, `erosion-pool.ts`): wartet auf eine neue Generation im Steuerblock, rechnet seinen Teil des
 * Kerns über die gemeinsamen Felder und meldet „fertig“. Generation −1 beendet ihn. Er schickt keine Nachrichten; alles läuft über den
 * gemeinsamen Speicher, damit der Hauptthread synchron bleiben kann.
 *
 * 🪤 Die Kerne kommen per `import()`: Scheitert das Laden (etwa an einer Syntax, die Node in Worker-Threads nicht abstreift), meldet der
 * Worker „Fehler“ und „bereit“ über den Steuerblock, und der Hauptthread rechnet sofort allein, statt auf ein Ereignis zu warten, das er
 * blockiert nie bekäme.
 */

const { fields, control, args, results, index, workers } = workerData as {
    fields: ErosionFields;
    control: Int32Array;
    args: Float64Array;
    results: Float64Array;
    index: number;
    workers: number;
};
const GENERATION = 0;
const DONE = 1;
const FAILED = 2;
const READY = 3;

// Erst die Generation lesen, dann „bereit“ melden: Sonst könnte der erste Auftrag dazwischen kommen und hier verloren gehen.
let seen = Atomics.load(control, GENERATION);
let kernels: typeof import("./erosion-kernels.ts");
try {
    kernels = (await import(
        new URL(`./erosion-kernels${extname(fileURLToPath(import.meta.url))}`, import.meta.url).href
    )) as typeof import("./erosion-kernels.ts");
} catch (error) {
    console.warn(
        `Erosion: Worker ${String(index)} lädt nicht (${error instanceof Error ? error.message : String(error)})`,
    );
    Atomics.store(control, FAILED, 1);
    Atomics.add(control, READY, 1);
    Atomics.notify(control, READY);
    process.exit(0);
}
const { chunkOf, KERNELS, kernelContext, kernelSpan, runKernel } = kernels;
const context = kernelContext(fields);
Atomics.add(control, READY, 1);
Atomics.notify(control, READY);
for (;;) {
    Atomics.wait(control, GENERATION, seen);
    seen = Atomics.load(control, GENERATION);
    if (seen < 0) break;
    const kernel = KERNELS[args[0]!]!;
    try {
        const [from, to] = chunkOf(index, workers + 1, kernelSpan(kernel, fields.n));
        results[index] = runKernel(context, kernel, from, to, args.subarray(1));
    } catch (error) {
        console.warn(
            `Erosion: Worker ${String(index)} scheiterte (${error instanceof Error ? error.message : String(error)})`,
        );
        Atomics.store(control, FAILED, 1);
    }
    Atomics.add(control, DONE, 1);
    Atomics.notify(control, DONE);
}
