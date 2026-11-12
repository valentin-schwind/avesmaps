import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
    ROUTING_WORKER_HEAP_ENV,
    ROUTING_WORKER_HEAP_MIB,
    routingWorkerHeapMib,
    routingWorkerOptions,
} from "../src/routing/runner.ts";

/**
 * Die Heap-Grenze des Routing-Workers (WI-0298): Ohne Grenze wählt V8 seinen größten Wachstumsfaktor und lässt rund 140 MB lebenden
 * Heap beim Neuladen eines Stands auf 430 bis 465 MB wachsen; den Speicher gibt der Prozess danach nicht zurück (Stage 1,3 GB RSS, das
 * Speichertor hielt die Warteschlange). Mit 512 MB blieb die Spitze lokal bei 270 bis 290 MB, ohne längeres Laden; unter 256 MB scheitert
 * das Neuladen.
 */
describe("Heap-Grenze des Routing-Workers", () => {
    it("gilt ohne Einstellung mit 512 MB", () => {
        expect(ROUTING_WORKER_HEAP_MIB).toBe(512);
        expect(routingWorkerHeapMib({})).toBe(512);
        expect(routingWorkerOptions("postgres://probe", {})).toEqual({
            workerData: { databaseUrl: "postgres://probe" },
            resourceLimits: { maxOldGenerationSizeMb: 512 },
        });
    });

    it("lässt sich über die Umgebung einstellen, mit Untergrenze 256 und Obergrenze 4096", () => {
        expect(routingWorkerHeapMib({ [ROUTING_WORKER_HEAP_ENV]: "768" })).toBe(768);
        expect(routingWorkerHeapMib({ [ROUTING_WORKER_HEAP_ENV]: " 1024 " })).toBe(1024);
        expect(routingWorkerHeapMib({ [ROUTING_WORKER_HEAP_ENV]: "64" })).toBe(256);
        expect(routingWorkerHeapMib({ [ROUTING_WORKER_HEAP_ENV]: "100000" })).toBe(4096);
    });

    it("nimmt eine unbrauchbare Einstellung als nicht gesetzt", () => {
        for (const raw of ["", "abc", "0", "-5", "NaN"]) {
            expect(routingWorkerHeapMib({ [ROUTING_WORKER_HEAP_ENV]: raw })).toBe(512);
        }
    });

    it("kommt bei einem echten Worker an", async () => {
        const options = routingWorkerOptions("postgres://probe", {});
        const worker = new Worker(
            `const { parentPort } = require("node:worker_threads"); parentPort.postMessage(require("node:v8").getHeapStatistics().heap_size_limit);`,
            { ...options, eval: true },
        );
        const limit = await new Promise<number>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
        });
        await worker.terminate();
        // Die Grenze des ganzen Heaps liegt über der des alten Raums (junger Raum, Code), aber weit unter der Vorgabe von V8 (2 bis 4 GB).
        expect(limit / 1048576).toBeGreaterThanOrEqual(512);
        expect(limit / 1048576).toBeLessThan(1024);
    });
});
