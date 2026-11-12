import { describe, expect, it } from "vitest";
import { gleicheNaehteAn, type GebirgsNaht } from "../src/terrain/domain/naht.ts";
import { grid, SEA } from "../src/terrain/hydrology/grid.ts";
import type { AreaGeometry } from "../src/terrain/hydrology/water.ts";

/**
 * Die Naht zwischen zwei angedockten Flächen (OPS-000089, Vali 2026-11-07: „soll es so aussehen als ob die gebirge zusammengehören“).
 *
 * Problemfälle: An der Grenze bleibt eine Stufe; die Korrektur reicht weiter als ihre Breite und ändert das ganze Gebirge; eine Hochebene gibt ihre Höhe auf; Meer wird angehoben; das Muster
 * der Flächen geht verloren; eine Naht zählt einen Rand, an dem nichts anliegt.
 */

const N = 512;
const g = grid(N); // Zellweite 2 E
const quadrat = (x0: number, y0: number, x1: number, y1: number): AreaGeometry =>
    ({
        type: "Polygon",
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    }) as AreaGeometry;

// Links 1.000, rechts 2.000, geteilt bei x = 500 (Zeile 0 im Norden, also y = 1024 − …).
const LINKS = quadrat(300, 400, 500, 600);
const RECHTS = quadrat(500, 400, 700, 600);
const zelle = (x: number, y: number): number => Math.floor((1024 - y) / g.cell) * N + Math.floor(x / g.cell);

function feld(ripple = 0): { height: Float32Array; classes: Uint8Array } {
    const height = new Float32Array(N * N);
    const classes = new Uint8Array(N * N);
    for (let j = 0; j < N; j += 1)
        for (let i = 0; i < N; i += 1) {
            const x = (i + 0.5) * g.cell;
            const y = 1024 - (j + 0.5) * g.cell;
            if (y < 400 || y > 600 || x < 300 || x > 700) continue;
            height[j * N + i] = (x < 500 ? 1000 : 2000) + ripple * Math.sin(y / 3);
        }
    return { height, classes };
}
const paar = (bFest = false): GebirgsNaht[] => [{ a: LINKS, b: RECHTS, bFest }];

describe("Naht zwischen angedockten Flächen", () => {
    it("🔴 zwei Gebirge treffen sich in der Mitte, ohne Stufe, und weiter weg bleibt alles", () => {
        const { height, classes } = feld();
        expect(gleicheNaehteAn(g, height, classes, paar(), 20)).toBeGreaterThan(0);
        const li = height[zelle(499, 500)]!;
        const re = height[zelle(501, 500)]!;
        expect(Math.abs(li - re)).toBeLessThan(1);
        expect(li).toBeCloseTo(1500, -1);
        // Stetig: keine Stufe in der Breite, von der Grenze nach außen ansteigend bzw. fallend.
        for (let x = 501; x < 520; x += 2)
            expect(height[zelle(x + 2, 500)]!).toBeGreaterThanOrEqual(height[zelle(x, 500)]! - 0.01);
        // Hinter der Breite genau wie zuvor.
        expect(height[zelle(450, 500)]).toBe(1000);
        expect(height[zelle(550, 500)]).toBe(2000);
    });

    it("🔴 die Hochebene behält ihre Höhe, das Gebirge passt sich an", () => {
        const { height, classes } = feld();
        gleicheNaehteAn(g, height, classes, paar(true), 20);
        expect(height[zelle(501, 500)]).toBe(2000);
        expect(height[zelle(520, 500)]).toBe(2000);
        expect(height[zelle(499, 500)]!).toBeGreaterThan(1990);
        expect(height[zelle(450, 500)]).toBe(1000);
    });

    it("🔴 das Muster bleibt: Die Korrektur hebt die Flächen an, statt sie einzuebnen", () => {
        const { height, classes } = feld(50);
        const vorher = height[zelle(495, 509)]! - height[zelle(495, 491)]!;
        gleicheNaehteAn(g, height, classes, paar(), 20);
        const nachher = height[zelle(495, 509)]! - height[zelle(495, 491)]!;
        expect(Math.abs(nachher)).toBeGreaterThan(0.4 * Math.abs(vorher));
    });

    it("🔴 Meer bleibt, und ohne anliegende Flächen ändert sich nichts", () => {
        const { height, classes } = feld();
        for (let y = 402; y < 440; y += 2)
            for (let x = 480; x < 520; x += 2) {
                const k = zelle(x, y);
                classes[k]! |= SEA;
                height[k] = 0;
            }
        gleicheNaehteAn(g, height, classes, paar(), 20);
        expect(height[zelle(490, 420)]).toBe(0);
        expect(height[zelle(510, 420)]).toBe(0);

        const leer = feld();
        const vorher = leer.height.slice();
        expect(
            gleicheNaehteAn(
                g,
                leer.height,
                leer.classes,
                [{ a: LINKS, b: quadrat(800, 400, 900, 600), bFest: false }],
                20,
            ),
        ).toBe(0);
        expect(Array.from(leer.height)).toEqual(Array.from(vorher));
    });
});
