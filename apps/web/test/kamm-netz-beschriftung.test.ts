import { describe, expect, it } from "vitest";
import type { PunktHoehen } from "@avesmaps3d/shared";
import { formatNumber } from "../src/i18n/i18n";
import { hoehenBeschriftung, hoeheIn, type FlaechenRaster } from "../src/landschaftseditor/kamm-netz-hoehen";
import type { GebirgsNetz } from "../src/landschaftseditor/kamm-netz";

/**
 * Die Höhen über den Punkten im Kammeditor (WI-0249). Vali wählte 2026-10-26: Die Zahl am Punkt zeigt die Höhe des Geländes; erst ein
 * gesetzter oder gezogener Wert wird eigen und wird getroffen (`treffen.ts`). Problemfälle: ein Punkt ohne eigene Höhe zeigt eine Vorgabe
 * statt des Geländes; eine zweite Zeile oder ein Zeichen vor der Zahl; eine erfundene Zahl ohne Vorschau.
 */

const zahl = (h: number): string => formatNumber(h, 0);

/** Ein Raster 3 × 3 von (0, 0) bis (2, 2), Zellweite 1, überall in der Fläche; Höhe je Zelle aus `h(i, j)`. */
function raster(h: (i: number, j: number) => number, eigen: (i: number, j: number) => boolean = () => true) {
    const w = 3;
    const hh = 3;
    const r: FlaechenRaster = {
        w,
        hh,
        cell: 1,
        bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 2 },
        eigen: new Uint8Array(w * hh),
        h: new Float32Array(w * hh),
    };
    for (let j = 0; j < hh; j++)
        for (let i = 0; i < w; i++) {
            r.eigen[j * w + i] = eigen(i, j) ? 1 : 0;
            r.h[j * w + i] = h(i, j);
        }
    return r;
}

const NETZ: GebirgsNetz = {
    kaemme: [
        {
            punkte: [
                [0, 0],
                [2, 2],
            ],
            rang: "haupt",
            hoehen: [2300, null],
        },
    ],
    nebengipfel: [{ x: 1, y: 1, h: 2300 }],
};
const HOEHEN: PunktHoehen = {
    linien: [
        [
            { h: 2300, eigen: true },
            { h: 2300, eigen: false },
        ],
    ],
    nebengipfel: [{ h: 2300, eigen: true }],
    mulden: [],
};

describe("Höhe der Fläche am Punkt (`hoeheIn`)", () => {
    it("bilinear zwischen den Zellen, nur Zellen der Fläche, außerhalb keine", () => {
        const r = raster((i) => 1000 * i);
        expect(hoeheIn(r, 0.5, 0.5)).toBeCloseTo(500, 6);
        expect(hoeheIn(r, 2, 2)).toBeCloseTo(2000, 6);
        expect(hoeheIn(r, -0.1, 1)).toBeUndefined();
        const halb = raster(
            (i) => 1000 * i,
            (i) => i > 0,
        );
        // Die Zelle außerhalb der Fläche zählt nicht mit: nur die Nachbarn in der Fläche.
        expect(hoeheIn(halb, 0.5, 1)).toBeCloseTo(1000, 6);
        expect(
            hoeheIn(
                raster(
                    () => 0,
                    () => false,
                ),
                1,
                1,
            ),
        ).toBeUndefined();
    });
});

describe("Beschriftung der Höhen (`hoehenBeschriftung`)", () => {
    it("🔴 eine Zahl je Punkt: die eigene Höhe kräftig, ohne eigene die Höhe des Geländes aus der Vorschau blass", () => {
        const r = raster(() => 1700);
        const marken = hoehenBeschriftung(NETZ, HOEHEN, true, [], r).features.map((f) => f.properties);
        // Anfang (eigen 2300), Ende ohne eigene Höhe (das Gelände: 1700, nicht die Vorgabe 2300), Nebengipfel (eigen 2300).
        expect(marken).toEqual([
            { text: zahl(2300), eigen: true },
            { text: zahl(1700), eigen: false },
            { text: zahl(2300), eigen: true },
        ]);
    });

    it("ohne Vorschau steht an einem Punkt ohne eigene Höhe keine Zahl", () => {
        const marken = hoehenBeschriftung(NETZ, HOEHEN, true, []).features.map((f) => f.properties);
        expect(marken).toEqual([
            { text: zahl(2300), eigen: true },
            { text: zahl(2300), eigen: true },
        ]);
    });

    it("ein Fluss ohne eigene Höhe zeigt das Gelände, mit eigener die eigene", () => {
        const fluss = {
            art: "fluss" as const,
            name: "Bach",
            punkte: [
                { x: 1, y: 0 },
                { x: 2, y: 0 },
            ],
            herkunft: 0,
            ab: 0,
        };
        const netz: GebirgsNetz = { ...NETZ, flussHoehen: [{ x: 2, y: 0, h: 900 }] };
        const r = raster(() => 1700);
        const marken = hoehenBeschriftung(netz, HOEHEN, true, [], r, { teile: [fluss] }).features.map(
            (f) => f.properties,
        );
        expect(marken.slice(-2)).toEqual([
            { text: zahl(1700), eigen: false },
            { text: zahl(900), eigen: true },
        ]);
    });

    it("ohne „Höhen beschriften“ nur die gezogenen Punkte", () => {
        const marken = hoehenBeschriftung(NETZ, HOEHEN, false, [{ nr: 0, index: 0 }]).features.map((f) => f.properties);
        expect(marken).toEqual([{ text: zahl(2300), eigen: true }]);
        expect(hoehenBeschriftung(NETZ, HOEHEN, false, []).features).toEqual([]);
    });
});
