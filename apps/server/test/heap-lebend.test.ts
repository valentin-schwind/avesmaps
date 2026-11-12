import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { beobachteLebendenHeap } from "../src/routing/heap-lebend.ts";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

/**
 * Der lebende Heap (WI-0298, Stufe 4): `heap_used_mb` im Protokoll zählt den Müll mit, den V8 bis zur nächsten großen Bereinigung liegen lässt, und
 * steigt darum bis kurz unter die Grenze, ohne dass etwas festgehalten wird. Erst der Stand gleich nach einer großen Bereinigung zeigt, was lebt.
 */
describe("lebender Heap", () => {
    it("misst nach einer großen Bereinigung ohne den Müll davor", async () => {
        const heap = beobachteLebendenHeap();
        try {
            expect(heap.mib()).toBeNull();
            let muell: { i: number; text: string }[] | null = Array.from({ length: 500_000 }, (_, i) => ({
                i,
                text: `x${String(i)}`,
            }));
            const mitMuell = v8.getHeapStatistics().used_heap_size;
            expect(muell.length).toBe(500_000);
            muell = null;
            gc();
            await vi.waitFor(() => expect(heap.mib()).not.toBeNull());
            expect((heap.mib() ?? Infinity) * 1048576).toBeLessThan(mitMuell - 10 * 1048576);
        } finally {
            heap.stop();
        }
    });
});
