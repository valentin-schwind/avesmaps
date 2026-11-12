import { describe, expect, it } from "vitest";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { withAtmosphere } from "../src/map/atmosphere/atmosphere.ts";
import { farbe, installiereKulisse } from "../src/map/atmosphere/kulisse.ts";
import { KULISSEN_VORGABE, nebelDeckkraft } from "../src/map/atmosphere/kulisse-werte.ts";

/**
 * Himmel, Dunst und Fläche hinter der geneigten Karte (WI-0016, D6; neu WI-0290: Kulisse statt Dunstebene, Werte vom Betreiber).
 */

describe("Farben aus dem Kanon", () => {
    it("🔴 die Töne, die der Betreiber im Entwurf eingestellt hat", () => {
        expect(DESIGN_CANON.atmosphere).toEqual({ sky: "#2d75be", skyHorizon: "#b4d9f3", sea: "#1b5e8a" });
        expect(KULISSEN_VORGABE).toMatchObject({ zenit: "#2d75be", dunst: "#b4d9f3", meer: "#1b5e8a" });
    });

    it("🔴 MapLibres Nebel trägt den Ton des Horizonts: kein eigener, dunklerer Dunstton, der als Band stehen bliebe", () => {
        const sky = withAtmosphere({ version: 8, sources: {}, layers: [] }).sky;
        expect(sky?.["fog-color"]).toBe(DESIGN_CANON.atmosphere.skyHorizon);
        expect(sky?.["horizon-color"]).toBe(DESIGN_CANON.atmosphere.skyHorizon);
        expect(sky?.["sky-color"]).toBe(DESIGN_CANON.atmosphere.sky);
        expect(sky?.["fog-ground-blend"]).toBe(KULISSEN_VORGABE.beginn);
    });

    it("liest Hex als Anteile", () => {
        expect(farbe("#ff8000")).toEqual([1, 128 / 255, 0]);
    });
});

describe("Der Dunst kommt mit der Neigung", () => {
    const werte = { ab: 30, voll: 75, staerke: 0.8 };

    it("🔴 eingestellt: ab 55°, voll bei 75°, 80 % (Betreiber 2026-11-08: „den dunst ab neigung 55° kommen lassen“)", () => {
        expect(KULISSEN_VORGABE).toMatchObject({ ab: 55, voll: 75, staerke: 0.8, beginn: 0.1, verlauf: 15, rand: 30 });
        expect(nebelDeckkraft(KULISSEN_VORGABE, 55)).toBe(0);
        expect(nebelDeckkraft(KULISSEN_VORGABE, 50)).toBe(0);
        expect(nebelDeckkraft(KULISSEN_VORGABE, 65)).toBeCloseTo(0.4);
    });

    it("🔴 flacher als ab: keiner; ab voll: die eingestellte Stärke", () => {
        expect(nebelDeckkraft(werte, 0)).toBe(0);
        expect(nebelDeckkraft(werte, 30)).toBe(0);
        expect(nebelDeckkraft(werte, 75)).toBeCloseTo(0.8);
        expect(nebelDeckkraft(werte, 80)).toBeCloseTo(0.8);
    });

    it("dazwischen weich und steigend, in der Mitte die halbe Stärke", () => {
        expect(nebelDeckkraft(werte, 52.5)).toBeCloseTo(0.4);
        let vorher = 0;
        for (let neigung = 31; neigung <= 75; neigung++) {
            const jetzt = nebelDeckkraft(werte, neigung);
            expect(jetzt).toBeGreaterThan(vorher);
            vorher = jetzt;
        }
    });

    it("ab und voll gleich: ein Schritt statt Division durch null", () => {
        expect(nebelDeckkraft({ ab: 40, voll: 40, staerke: 1 }, 39)).toBe(0);
        expect(nebelDeckkraft({ ab: 40, voll: 40, staerke: 1 }, 41)).toBe(1);
    });
});

describe("Nebel nur auf dem ersten Texturstapel", () => {
    /** Eine Karte, an der die Kulisse ihre Nebelkurve einhängt; `stapel` ist MapLibres `_stacks` im laufenden Bild. */
    function karte(stapel: unknown[]) {
        // MapLibres eigene Kurve, die die Kulisse ersetzt.
        const sky: { calculateFogBlendOpacity?: (neigung: number) => number } = { calculateFogBlendOpacity: () => 1 };
        const map = {
            style: { _loaded: true, sky },
            painter: { renderToTexture: { _stacks: stapel } },
            getLayersOrder: () => [] as string[],
            getLayer: () => undefined,
            addLayer: () => undefined,
            moveLayer: () => undefined,
            on: () => undefined,
            triggerRepaint: () => undefined,
        };
        installiereKulisse(map as unknown as Parameters<typeof installiereKulisse>[0], () => undefined);
        return sky;
    }

    it("🔴 spätere Stapel (im Editor über den Namen) bekommen keinen Nebel mehr; er deckte sonst doppelt (Betreiber 2026-11-09: „milchig“)", () => {
        const stapel: unknown[] = [[]];
        const sky = karte(stapel);
        expect(sky.calculateFogBlendOpacity?.(70)).toBeCloseTo(nebelDeckkraft(KULISSEN_VORGABE, 70), 9);
        stapel.push([], []);
        expect(sky.calculateFogBlendOpacity?.(70)).toBe(0);
    });
});
