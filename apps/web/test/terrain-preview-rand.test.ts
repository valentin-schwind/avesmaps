import { describe, expect, it } from "vitest";
import { AVENTURIA, createRenderProjection, WEB_MERCATOR_HALF_WORLD } from "@avesmaps3d/shared";
import { mischeVorschau, randGewicht, UEBERGANG_MINDESTENS_E } from "../src/map/terrain/terrain-preview";

/**
 * Die Höhenvorschau geht am Umriss in das bestehende Gelände über (Betreiber 2026-10-24: „die vorschau "stanzt" sich noch in die bestehende
 * topographie ein“). Ursache: Die Vorschau rechnet das Gebirge allein, mit 0 am Umriss; die Kachel nahm sie bis an den Umriss voll, also lag
 * das Gebirge am Rand um die Höhe des Landes tiefer als die Umgebung, eine Stufe. Das fertige Gelände stellt die Saat dagegen auf das Land
 * (`bette` bzw. Maximum in `initial-terrain.ts`), am Umriss gilt dort das Land. Jetzt gilt am Umriss die bestehende Höhe, nach innen geht
 * sie über die Breite, in der die Saat ansteigt, stetig in die Vorschau über.
 *
 * Problemfälle: Am Umriss steht die Vorschau statt der bestehenden Höhe; knapp innen springt die Höhe; außen ändert sich etwas.
 */
const space = AVENTURIA.coordinateSpace;
const projection = createRenderProjection(space);

/** Eine Kachel und ihr Rahmen in Karteneinheiten (wie `mischeVorschau` sie abtastet). */
function kachel(z: number, x: number, y: number) {
    const n = 2 ** z;
    const at = (u: number, v: number) =>
        projection.fromRender({ x: (2 * u - 1) * WEB_MERCATOR_HALF_WORLD, y: (1 - 2 * v) * WEB_MERCATOR_HALF_WORLD });
    const nw = at(x / n, y / n);
    const se = at((x + 1) / n, (y + 1) / n);
    return {
        tile: { z, x, y },
        min_x: Math.min(nw.x, se.x),
        max_x: Math.max(nw.x, se.x),
        min_y: Math.min(nw.y, se.y),
        max_y: Math.max(nw.y, se.y),
    };
}

const kodiere = (meter: number): [number, number, number] => {
    const wert = Math.round((meter + 10000) * 10);
    return [(wert >> 16) & 255, (wert >> 8) & 255, wert & 255];
};
const dekodiere = (rgba: Uint8ClampedArray, k: number): number =>
    (rgba[4 * k]! * 65536 + rgba[4 * k + 1]! * 256 + rgba[4 * k + 2]!) * 0.1 - 10000;

describe("Höhenvorschau am Umriss", () => {
    it("🔴 Gewicht 0 am Umriss, 1 im Kern, stetig und ohne Sprung dazwischen", () => {
        const w = 40;
        const hh = 40;
        const cell = 0.25;
        const eigen = new Uint8Array(w * hh);
        for (let j = 4; j < hh - 4; j++) for (let i = 4; i < w - 4; i++) eigen[j * w + i] = 1;
        const g = randGewicht({ w, hh, cell, eigen });
        // Außerhalb 0, in der ersten Zelle der Fläche noch 0 (bis dorthin gilt die bestehende Höhe), in der Mitte 1.
        expect(g[2 * w + 2]).toBe(0);
        expect(g[20 * w + 4]).toBe(0);
        expect(g[20 * w + 5]).toBeGreaterThan(0);
        expect(g[20 * w + 20]).toBe(1);
        // Entlang einer Zeile von außen zur Mitte: monoton, kein Schritt größer als die Steigung des Übergangs zulässt.
        const breite = Math.max(UEBERGANG_MINDESTENS_E, 0.4 * 16 * cell);
        let vorher = 0;
        for (let i = 4; i <= 20; i++) {
            const jetzt = g[20 * w + i]!;
            expect(jetzt).toBeGreaterThanOrEqual(vorher);
            expect(jetzt - vorher).toBeLessThanOrEqual((1.5 * cell) / breite + 1e-6);
            vorher = jetzt;
        }
    });

    it("🔴 an einer Kachel: außen unverändert, am Umriss die bestehende Höhe, am Fuß keine Senke, im Kern die Vorschau", () => {
        const k = kachel(4, 7, 7);
        const pixel = 256;
        // Das Gebirge in der Mitte der Kachel, die Umgebung (bestehend) 6.000 Render-Meter. Wie die Saat: 0 an der ersten Zelle innen,
        // über `FUSS` Zellen auf 3.000 Schritt.
        const cell = (k.max_x - k.min_x) / 100;
        const w = 60;
        const hh = 60;
        const FUSS = 12;
        const bounds = {
            min_x: (k.min_x + k.max_x) / 2 - (w / 2) * cell,
            min_y: (k.min_y + k.max_y) / 2 - (hh / 2) * cell,
            max_x: (k.min_x + k.max_x) / 2 + (w / 2) * cell,
            max_y: (k.min_y + k.max_y) / 2 + (hh / 2) * cell,
        };
        const saat = (i: number, j: number) =>
            3000 * Math.min(1, Math.max(0, Math.min(i - 5, w - 6 - i, j - 5, hh - 6 - j)) / FUSS);
        const eigen = new Uint8Array(w * hh);
        const h = new Float32Array(w * hh);
        for (let j = 5; j < hh - 5; j++)
            for (let i = 5; i < w - 5; i++) {
                eigen[j * w + i] = 1;
                h[j * w + i] = saat(i, j);
            }
        const rgba = new Uint8ClampedArray(pixel * pixel * 4);
        const [r, g, b] = kodiere(6000);
        for (let p = 0; p < pixel * pixel; p++) rgba.set([r, g, b, 255], 4 * p);
        mischeVorschau(rgba, pixel, pixel, k.tile, { w, hh, cell, bounds, eigen, h });
        const zeile = pixel / 2;
        const hoehen = Array.from({ length: pixel }, (_, px) => dekodiere(rgba, zeile * pixel + px));
        // Außen (links der Fläche) unverändert.
        expect(hoehen[0]).toBeCloseTo(6000, 1);
        // Im Kern die Vorschau (3.000 Schritt, in Render-Metern rund 38.000); daraus Render-Meter je Schritt in dieser Zeile.
        const kern = hoehen[pixel / 2]!;
        expect(kern).toBeGreaterThan(30_000);
        const meterJeSchritt = kern / 3000;
        const uVon = (px: number) => (k.min_x + (k.max_x - k.min_x) * ((px + 0.5) / pixel) - bounds.min_x) / cell;
        // Am Umriss (zwischen der letzten Zelle außen und der ersten innen) die bestehende Höhe auf die Kodierung genau.
        const amUmriss = hoehen.filter((_, px) => {
            const u = uVon(px);
            return (u >= 4 && u <= 5) || (u >= w - 6 && u <= w - 5);
        });
        expect(amUmriss.length).toBeGreaterThan(1);
        for (const wert of amUmriss) expect(Math.abs(wert - 6000)).toBeLessThanOrEqual(0.1);
        // Am Fuß keine Senke unter die Umgebung (vorher fiel die Höhe am Umriss auf die Saat, hier 0), höchstens ein Hauch, wo die Saat noch
        // unter der Umgebung liegt und der Übergang schon greift.
        expect(Math.min(...hoehen)).toBeGreaterThan(6000 - 0.02 * (kern - 6000));
        // Wo die Saat über der Umgebung steht, gilt sie genau wie im fertigen Gelände (Maximum aus Land und Saat), auch am Fuß.
        let geprueft = 0;
        hoehen.forEach((wert, px) => {
            const u = uVon(px);
            if (u < 5 || u > w - 6) return;
            const i = Math.floor(u);
            const fx = u - i;
            const s = ((1 - fx) * saat(i, hh / 2) + fx * saat(Math.min(i + 1, w - 6), hh / 2)) * meterJeSchritt;
            if (s < 6001 || u > 5 + FUSS) return;
            geprueft++;
            expect(Math.abs(wert - s), `Pixel ${String(px)}`).toBeLessThanOrEqual(0.5);
        });
        expect(geprueft).toBeGreaterThan(10);
        // Knapp innen kein Sprung: Kein Schritt zwischen Nachbarn ist größer als ein Bruchteil des ganzen Hubs.
        let groessterSchritt = 0;
        for (let px = 1; px < pixel; px++)
            groessterSchritt = Math.max(groessterSchritt, Math.abs(hoehen[px]! - hoehen[px - 1]!));
        expect(groessterSchritt).toBeLessThan(0.1 * (kern - 6000));
    });
});
