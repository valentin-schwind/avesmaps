import { describe, expect, it } from "vitest";
import { dunstAnteil, type DunstLage } from "../src/map/atmosphere/dunst-tiefe.ts";
import { WETTER_WEICHT, dunstUniforms, wetterSichtbar } from "../src/map/wetter/wetter-dunst.ts";

/**
 * Das Wetter weicht dem Dunst des Geländes (WI-0288; Betreiber 2026-11-08: „inkonsistent, dass labels … im Dunst verschwindet und die Wind-Icons … nicht“,
 * „auf distanz aus- und den dunst einzublenden“). Die Tiefe ist hier der Abstand z selbst (w-Zeile 0, 0, 1, 0), nah 10, fern 100.
 */

const lage = (deckkraft: number): DunstLage => ({
    zeile: [0, 0, 1, 0],
    nah: 10,
    fern: 100,
    beginn: 0.1,
    deckkraft,
    staerke: 0.8,
});

describe("Dunst des Geländes an einer Stelle", () => {
    it("🔴 wie die Kulisse: vor nah keiner, am fernen Ende die Deckkraft, dazwischen quadratisch ab dem Beginn", () => {
        expect(dunstAnteil(lage(0.8), 0, 0, 10)).toBe(0);
        expect(dunstAnteil(lage(0.8), 0, 0, 100)).toBeCloseTo(0.8, 6);
        // Tiefe 0,5 (w = 18,1818…): k = (0,5 − 0,1) / 0,9.
        const w = 10 / (1 - (0.5 * 90) / 100);
        expect(dunstAnteil(lage(0.8), 0, 0, w)).toBeCloseTo((0.4 / 0.9) ** 2 * 0.8, 6);
    });

    it("ohne Deckkraft (flacher als der Beginn des Dunsts) keiner", () => {
        expect(dunstAnteil(lage(0), 0, 0, 100)).toBe(0);
    });
});

describe("Das Wetter weicht dem Dunst", () => {
    it("🔴 vorn ganz da, am fernen Ende fort; flach geneigt bleibt alles", () => {
        expect(wetterSichtbar(lage(0.8), 0, 0, 10)).toBe(1);
        expect(wetterSichtbar(lage(0.8), 0, 0, 100)).toBe(0);
        expect(wetterSichtbar(lage(0), 0, 0, 100)).toBe(1);
        expect(wetterSichtbar(undefined, 0, 0, 100)).toBe(1);
    });

    it("vergeht zwischen ab und weg, gemessen am Höchstwert des Dunsts, und nimmt dabei stetig ab", () => {
        const tiefeFuer = (anteil: number): number => {
            // anteil = k² · Deckkraft / Stärke, bei voller Deckkraft k² = anteil.
            const tiefe = 0.1 + Math.sqrt(anteil) * 0.9;
            return 10 / (1 - (tiefe * 90) / 100);
        };
        expect(wetterSichtbar(lage(0.8), 0, 0, tiefeFuer(WETTER_WEICHT.ab - 0.01))).toBe(1);
        expect(wetterSichtbar(lage(0.8), 0, 0, tiefeFuer(WETTER_WEICHT.weg + 0.01))).toBe(0);
        let vorher = 1;
        for (let z = 10; z <= 100; z += 2) {
            const jetzt = wetterSichtbar(lage(0.8), 0, 0, z);
            expect(jetzt).toBeLessThanOrEqual(vorher);
            vorher = jetzt;
        }
    });

    it("die Uniforms des Shaders tragen dieselben Zahlen; ohne Lage kein Dunst", () => {
        expect(dunstUniforms(lage(0.6))).toEqual({
            uDZ: [0, 0, 1, 0],
            uDL: [10, 100, 0.1, 0.6],
            uDW: [0.8, WETTER_WEICHT.ab, WETTER_WEICHT.weg],
            uDF: [WETTER_WEICHT.flachVoll, WETTER_WEICHT.flachAus, WETTER_WEICHT.flachAb, WETTER_WEICHT.flachWeg],
            uDC: [WETTER_WEICHT.wolkenAb, WETTER_WEICHT.wolkenWeg],
        });
        expect(dunstUniforms(undefined).uDL[3]).toBe(0);
    });

    it("🔴 die Wolken vergehen früher als Icons, Teilchen und Schneedecke (Betreiber 2026-11-09: „Ja, früher weg“)", () => {
        expect(WETTER_WEICHT.wolkenAb).toBeLessThan(WETTER_WEICHT.ab);
        expect(WETTER_WEICHT.wolkenWeg).toBeLessThan(WETTER_WEICHT.weg);
        expect(WETTER_WEICHT.wolkenAb).toBeLessThan(WETTER_WEICHT.wolkenWeg);
    });
});
