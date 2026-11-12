import { describe, expect, it } from "vitest";
import { rahmenRaender } from "../src/map/gradnetz-rahmen";

const KARTE = { left: 0, top: 0, width: 2000, height: 950 };

describe("Rahmen des Gradnetzes (WI-0273)", () => {
    it("weicht einem angedockten Fenster aus, nicht einem schwebenden Panel", () => {
        const raender = rahmenRaender(KARTE, [
            // Der Reiseplaner oben links deckt die linke Kante nur zur Hälfte (Bild der Stage, 2026-10-31).
            { edge: "left", box: { left: 0, top: 0, width: 270, height: 480 } },
            // Der Editor rechts über die ganze Höhe.
            { edge: "right", box: { left: 1690, top: 0, width: 310, height: 950 } },
        ]);
        expect(raender).toEqual({ top: 0, right: 310, bottom: 0, left: 0 });
    });
});
