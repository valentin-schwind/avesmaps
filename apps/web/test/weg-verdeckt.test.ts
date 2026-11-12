import { describe, expect, it } from "vitest";
import { istVerdeckt, sichtbarerAnteil } from "../src/wegeditor/weg-verdeckt";

/**
 * Ein Klick in der Wege-Liste fliegt nur, wenn der Weg ganz oder fast ganz verdeckt ist (Betreiber 2026-10-19 „Ja, wenn verdeckt“).
 * Problemfälle: Ein sichtbarer Weg fliegt (dann gälte D17 nicht mehr); ein Weg unter dem Fenster bleibt dort; ein flacher Weg (ohne
 * Höhe) gilt als verdeckt, nur weil sein Rahmen keine Fläche hat.
 */
const FREI = { left: 0, top: 0, width: 800, height: 1000 };

describe("Weg verdeckt", () => {
    it("🔴 ganz unter dem Fenster rechts: verdeckt; ganz in der freien Fläche: nicht", () => {
        expect(istVerdeckt({ left: 900, top: 100, right: 1500, bottom: 600 }, FREI)).toBe(true);
        expect(istVerdeckt({ left: 100, top: 100, right: 500, bottom: 600 }, FREI)).toBe(false);
    });

    it("🔴 fast ganz verdeckt (ein Zehntel frei) fliegt, zur Hälfte frei nicht", () => {
        expect(sichtbarerAnteil({ left: 740, top: 100, right: 1340, bottom: 600 }, FREI)).toBeCloseTo(0.1);
        expect(istVerdeckt({ left: 740, top: 100, right: 1340, bottom: 600 }, FREI)).toBe(true);
        expect(istVerdeckt({ left: 500, top: 100, right: 1100, bottom: 600 }, FREI)).toBe(false);
    });

    it("ein waagrechter Weg ohne Höhe zählt nach seiner Länge", () => {
        expect(istVerdeckt({ left: 100, top: 300, right: 700, bottom: 300 }, FREI)).toBe(false);
        expect(istVerdeckt({ left: 900, top: 300, right: 1500, bottom: 300 }, FREI)).toBe(true);
    });
});
