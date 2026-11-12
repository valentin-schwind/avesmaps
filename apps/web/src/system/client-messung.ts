import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * Was der Browser über sich selbst weiß (WI-0138 V15, Messfenster).
 *
 * - **Bilder je Sekunde**: gezählt über `requestAnimationFrame`, gemittelt über eine Sekunde. Die einzige dieser Zahlen, die
 *   jeder Browser kennt.
 * - **Hauptthread**: der Anteil der Zeit, in der ein Bild länger als sein Takt brauchte. Das ist keine CPU-Messung des
 *   Rechners — die gibt es im Browser nicht —, sondern die Last **unserer** Seite: Wer 60 Bilder schafft, hat 0 %;
 *   wer bei 30 hängt, hat 50 %. 🔴 Deshalb heißt die Zahl im Fenster „Hauptthread“ und nicht „CPU“.
 * - **Speicher**: `performance.memory.usedJSHeapSize`, nur in Chromium. Anderswo steht „unbekannt“, nie 0.
 *
 * Nichts davon verlässt den Browser: Das Messfenster zeigt die Werte, es meldet sie nirgends.
 */

interface SpeicherGebend {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
}

export interface ClientMesswerte {
    /** Bilder je Sekunde, über die letzte Sekunde gemittelt. */
    fps: Ref<number | null>;
    /** Anteil 0 bis 1, wie weit die Bildrate unter dem Takt des Bildschirms liegt. */
    last: Ref<number | null>;
    /** Belegter JS-Speicher in Byte; ohne Browserunterstützung `null`. */
    speicher: Ref<number | null>;
    speicherGrenze: Ref<number | null>;
    halt(): void;
}

/** Der Takt des Bildschirms, geschätzt aus der schnellsten gemessenen Sekunde; Vorgabe 60. */
const TAKT_VORGABE = 60;

export function messeClient(): ClientMesswerte {
    const fps = ref<number | null>(null);
    const last = ref<number | null>(null);
    const speicher = ref<number | null>(null);
    const speicherGrenze = ref<number | null>(null);
    let bilder = 0;
    let fenster = performance.now();
    let hoechsteRate = 0;
    let laeuft = true;
    let angefordert = 0;

    const tick = (): void => {
        if (!laeuft) return;
        bilder += 1;
        const jetzt = performance.now();
        const vergangen = jetzt - fenster;
        if (vergangen >= 1000) {
            const rate = (bilder * 1000) / vergangen;
            fps.value = Math.round(rate);
            hoechsteRate = Math.max(hoechsteRate, rate);
            const takt = Math.max(TAKT_VORGABE, Math.round(hoechsteRate));
            last.value = Math.max(0, Math.min(1, 1 - rate / takt));
            const gemessen = (performance as unknown as SpeicherGebend).memory;
            speicher.value = gemessen?.usedJSHeapSize ?? null;
            speicherGrenze.value = gemessen?.jsHeapSizeLimit ?? null;
            bilder = 0;
            fenster = jetzt;
        }
        angefordert = requestAnimationFrame(tick);
    };
    angefordert = requestAnimationFrame(tick);

    const halt = (): void => {
        laeuft = false;
        cancelAnimationFrame(angefordert);
    };
    onBeforeUnmount(halt);
    return { fps, last, speicher, speicherGrenze, halt };
}
