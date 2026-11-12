import { constants, PerformanceObserver } from "node:perf_hooks";
import v8 from "node:v8";

export interface LebenderHeap {
    /** Der belegte Heap gleich nach der letzten großen Bereinigung dieses Threads in MiB; `null`, solange es noch keine gab. */
    mib(): number | null;
    stop(): void;
}

/**
 * Beobachtet die großen Bereinigungen (Mark-Compact) des eigenen Threads und merkt sich den belegten Heap gleich danach (WI-0298, Stufe 4).
 *
 * `heap_used_mb` und `heap_total_mb` im Protokoll zählen den Müll mit, den V8 bis zur nächsten großen Bereinigung liegen lässt; unter einer
 * Grenze wachsen beide bis kurz darunter, ohne dass etwas festgehalten wird. Gemessen am 2026-11-11 mit 90 Wegänderungen: lebend flach bei
 * 162 MiB, `heap_used_mb` beim Nachladen 160 bis 280. Erst dieser Wert zeigt, ob ein Thread über die Zeit wirklich mehr behält.
 *
 * Die Meldung kommt kurz nach der Bereinigung; was dazwischen neu belegt wird, ist klein gegen den Heap.
 */
export function beobachteLebendenHeap(): LebenderHeap {
    let lebend: number | null = null;
    const beobachter = new PerformanceObserver((liste) => {
        for (const eintrag of liste.getEntries()) {
            if ((eintrag as { detail?: { kind?: number } }).detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
                lebend = v8.getHeapStatistics().used_heap_size;
            }
        }
    });
    beobachter.observe({ entryTypes: ["gc"] });
    return {
        mib: () => (lebend === null ? null : Math.round(lebend / 1048576)),
        stop: () => beobachter.disconnect(),
    };
}
