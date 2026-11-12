import { describe, expect, it } from "vitest";
import { WETTER_BILDRATE_KLASSEN, WETTER_START_KLASSEN } from "@avesmaps3d/shared";
import { klassenGrenzen, medianUndMittel } from "../src/editor-panel/wetter-histogramm.ts";

/**
 * Median und Mittel der Wetter-Histogramme (WI-0288; Betreiber 2026-11-08: „median und mittelwert ins histogramm … farbig für die
 * kategorien“), geschätzt aus Klassen. Problemfälle: Die offene oberste Klasse hat keine Obergrenze; die Linie steht neben dem Balken,
 * zu dem der Wert gehört; eine leere Reihe liefert Unsinn statt nichts.
 */
describe("Grenzen der Klassen", () => {
    it("unterste, mittlere, offene oberste, Sekunden und Punktklassen", () => {
        expect(klassenGrenzen(WETTER_BILDRATE_KLASSEN, 0)).toEqual([0, 10]);
        expect(klassenGrenzen(WETTER_BILDRATE_KLASSEN, 3)).toEqual([30, 40]);
        expect(klassenGrenzen(WETTER_BILDRATE_KLASSEN, WETTER_BILDRATE_KLASSEN.length - 1)).toEqual([120, 130]);
        expect(klassenGrenzen(WETTER_START_KLASSEN, 2)).toEqual([2, 3]);
        expect(klassenGrenzen(WETTER_START_KLASSEN, WETTER_START_KLASSEN.length - 1)).toEqual([30, 40]);
        expect(klassenGrenzen(["20", "25"], 1, true)).toEqual([22.5, 27.5]);
    });
});

describe("Median und Mittel", () => {
    const klassen = ["u10", "10-20", "20-30", "ab30"];

    it("ohne Zählung nichts", () => {
        expect(medianUndMittel(klassen, [0, 0, 0, 0])).toBeUndefined();
    });

    it("alles in einer Klasse: Median in ihrer Mitte, Mittel ihre Mitte, beide über ihrem Balken", () => {
        const k = medianUndMittel(klassen, [0, 0, 8, 0])!;
        expect(k.median).toEqual({ wert: 25, lage: 2.5 });
        expect(k.mittel).toEqual({ wert: 25, lage: 2.5 });
    });

    it("🔴 linear in der Klasse, in der die Hälfte erreicht ist; das Mittel aus den Mitten", () => {
        // 10 Zählungen: 2 in <10, 6 in 10–20, 2 in 20–30. Die Hälfte (5) liegt 3/6 in 10–20, also bei 15.
        const k = medianUndMittel(klassen, [2, 6, 2, 0])!;
        expect(k.median.wert).toBeCloseTo(15);
        expect(k.median.lage).toBeCloseTo(1.5);
        // (2·5 + 6·15 + 2·25) / 10 = 15
        expect(k.mittel.wert).toBeCloseTo(15);
        expect(k.mittel.lage).toBeCloseTo(1.5);
    });

    it("ein Ausreißer in der offenen Klasse zieht das Mittel, nicht den Median", () => {
        const k = medianUndMittel(klassen, [0, 9, 0, 1])!;
        expect(k.median.wert).toBeLessThan(20);
        // (9·15 + 1·35) / 10 = 17
        expect(k.mittel.wert).toBeCloseTo(17);
        expect(k.mittel.wert).toBeGreaterThan(k.median.wert);
    });
});
