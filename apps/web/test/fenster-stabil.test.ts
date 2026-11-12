import { describe, expect, it } from "vitest";
import { stabileHoehe, vorgabeEckeKlasse } from "../src/fenster/fenster-lage.ts";

/**
 * Die stabile Höhe eines Fensters ohne Browser (WI-0272, Entwurf 8; Betreiber 2026-11-01: „die abmessungen des dialogs müssen stabil bleiben sonst verschwindet der upload button unten“):
 * das Gemessene plus Luft, höchstens die Höhe der Ansicht davor, auf eine gerade Zahl gerundet. Dass die Hülle sie misst, hält und gleiten lässt, zeigen `fenster-huelle.test.ts` (Quelltext)
 * und `e2e/reisebild-einreichen.spec.ts` (Browser).
 */

describe("🔴 die gehaltene Höhe einer Ansicht", () => {
    it("das Gemessene plus die Luft für das, was später dazukommt", () => {
        expect(stabileHoehe(900, 52)).toBe(952);
        expect(stabileHoehe(900, 0)).toBe(900);
    });

    it("🔴 die Bestätigung ist nie höher als das Formular davor (der Deckel), auch mit Luft", () => {
        expect(stabileHoehe(600, 52, 952)).toBe(652);
        expect(stabileHoehe(990, 52, 952)).toBe(952);
        expect(stabileHoehe(950, 52, 952)).toBe(952);
    });

    it("🔴 immer eine gerade Zahl: Steht das Fenster mit `translate` in der Mitte, setzte eine ungerade Höhe es auf halbe Bildpunkte, und die Schrift würde weich", () => {
        for (const gemessen of [601, 602, 733.5, 984.4]) expect(stabileHoehe(gemessen, 0) % 2).toBe(0);
        expect(stabileHoehe(601, 0)).toBe(602);
        expect(stabileHoehe(600.4, 0)).toBe(600);
        // Ein ungerader Deckel gilt hart: gerade, und nie darüber.
        expect(stabileHoehe(900, 52, 951)).toBe(950);
    });

    it("keine negative Luft und keine negative Höhe", () => {
        expect(stabileHoehe(500, -40)).toBe(500);
        expect(stabileHoehe(-3, 0)).toBe(0);
    });
});

describe("die Vorgabe oben-mitte für den schmalen Balken im Wählmodus", () => {
    it("ist eine gelöste Vorgabe wie mitte, und eine gemerkte Box schlägt sie", () => {
        expect(vorgabeEckeKlasse("geloest", undefined, "oben-mitte")).toBe("avm-fenster--oben-mitte");
        expect(vorgabeEckeKlasse("geloest", undefined, "mitte")).toBe("avm-fenster--mitte");
        expect(
            vorgabeEckeKlasse("geloest", { left: 0, top: 0, width: 520, height: 300 }, "oben-mitte"),
        ).toBeUndefined();
        expect(vorgabeEckeKlasse("versenkt", undefined, "oben-mitte")).toBeUndefined();
    });
});
