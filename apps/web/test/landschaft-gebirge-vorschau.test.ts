import { describe, expect, it } from "vitest";
import type { EditorGebirge } from "@avesmaps3d/shared";
import type { VorschauErgebnis } from "../src/gebirge-vorschau/auftrag.ts";
import { eingabeMitGipfeln, vorschauEcken, vorschauPixel } from "../src/landschaftseditor/gebirge-vorschau-bild.ts";

/**
 * Das Bild der Gebirge-Vorschau (WI-0178 P6, Fassung 16). Problemfälle: Norden steht unten (die Rechnung zählt vom Süden); außerhalb der
 * Fläche deckt das Bild die Karte; die Schummerung ist überhöht, ohne dass es jemand erfährt; das Bild sitzt eine halbe Zelle daneben;
 * die Gipfelhöhe aus der Gipfelliste erreicht die Vorschau nicht.
 */
const ERGEBNIS: VorschauErgebnis = {
    w: 2,
    hh: 2,
    cell: 1,
    bounds: { min_x: 10, min_y: 20, max_x: 11, max_y: 21 },
    // Zeile 0 ist der Süden: unten links und unten rechts in der Fläche, oben links draußen.
    eigen: Uint8Array.from([1, 1, 0, 1]),
    h: Float32Array.from([100, 200, 0, 500]),
    ms: 12,
};

describe("Bild der Gebirge-Vorschau (WI-0178 P6)", () => {
    it("🔴 Norden oben, außerhalb der Fläche durchsichtig", () => {
        const pixel = vorschauPixel(ERGEBNIS);
        const alpha = (spalte: number, zeile: number): number => pixel.rgba[(zeile * pixel.breite + spalte) * 4 + 3]!;
        // Bildzeile 0 ist der Norden (Rechenzeile 1): links draußen, rechts drin.
        expect([alpha(0, 0), alpha(1, 0)]).toEqual([0, 255]);
        expect([alpha(0, 1), alpha(1, 1)]).toEqual([255, 255]);
    });

    it("🔴 die Schummerung eines niedrigen Gebirges ist überhöht, und der Faktor wird genannt (höchstens 8)", () => {
        expect(vorschauPixel(ERGEBNIS).ueberhoehung).toBeCloseTo(4000 / 1500);
        const hoch = { ...ERGEBNIS, h: Float32Array.from([4000, 5000, 0, 6000]) };
        expect(vorschauPixel(hoch).ueberhoehung).toBe(1);
    });

    it("die Ecken liegen eine halbe Zelle außerhalb der Mittelpunkte: oben links, oben rechts, unten rechts, unten links", () => {
        expect(vorschauEcken(ERGEBNIS)).toEqual([
            [9.5, 21.5],
            [11.5, 21.5],
            [11.5, 19.5],
            [9.5, 19.5],
        ]);
    });

    it("🔴 die Gipfelhöhe aus der Gipfelliste geht an den Gipfel derselben Stelle", () => {
        const eingabe = {
            peaks: [
                { x: 5, y: 6, h: 3000 },
                { x: 7, y: 8, h: null },
            ],
        } as unknown as EditorGebirge["eingabe"];
        const gipfel = [
            {
                id: "a",
                name: "A",
                subtype: "berggipfel" as const,
                height: 3000,
                position: [5, 6] as [number, number],
                revision: 1,
            },
        ];
        expect(eingabeMitGipfeln(eingabe, gipfel, { a: 4200 }).peaks).toEqual([
            { x: 5, y: 6, h: 4200 },
            { x: 7, y: 8, h: null },
        ]);
        expect(eingabeMitGipfeln(eingabe, gipfel, {})).toBe(eingabe);
    });
});
