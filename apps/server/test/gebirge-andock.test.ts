import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMountainRaster, rasterSamples, type V12Input, type V12Raster } from "@avesmaps3d/shared";

/**
 * Das Gebirge läuft an einer gemeinsamen Grenze nicht aus (OPS-000089, Vali 2026-11-07: „An gemeinsamen Grenzen fällt nichts mehr ab.“): Das Rechengebiet wächst um einen Streifen hinter
 * die Kante, gespeichert wird nur die eigene Fläche (`mitAndockStreifen`).
 *
 * Problemfälle: An der Kante bleibt der Abfall; der Streifen landet im gespeicherten Raster und überdeckt den Nachbarn; ein freier Rand verliert seinen Abfall; ein Gebirge ohne Kanten
 * ändert sein Raster und damit seine Saat. Beide Saatarten: V12 (ohne gezeichnete Kämme) und Rückennetz.
 */

const quadrat = (x0: number, y0: number, x1: number, y1: number): V12Input["geometry"] => ({
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
});

/** V12: ein Gebirge 40 × 40 mit einem Gipfel in der Mitte; rechts, bei x = 40, die Grenze. */
const v12 = (): V12Input => ({
    bounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 40 },
    geometry: quadrat(0, 0, 40, 40),
    peaks: [{ x: 20, y: 20, h: 3000 }],
    kurve: null,
    fluesse: [],
    seen: [],
    regler: { maximalhoehe: 3000 },
    saat: 7,
    zelle: 0.5,
});

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input };

const an = (r: V12Raster, x: number, y: number): number => {
    const i = Math.round((x - r.bounds.min_x) / r.cell);
    const j = Math.round((y - r.bounds.min_y) / r.cell);
    return r.h[j * r.w + i] as number;
};
const eigene = (r: V12Raster): number => r.eigen.reduce((n: number, v: number) => n + v, 0);

describe("Gemeinsame Grenze in der Saat", () => {
    const kante: V12Input["andock"] = {
        kanten: [
            [
                [40, 0],
                [40, 40],
            ],
        ],
        streifen: 6,
    };

    it("🔴 V12: an der Kante steht Höhe, der freie Rand fällt weiter ab, gespeichert wird nur die eigene Fläche", () => {
        const ohne = buildMountainRaster(v12());
        const mit = buildMountainRaster({ ...v12(), andock: kante });
        expect(an(ohne, 39.5, 20)).toBeLessThan(an(mit, 39.5, 20));
        // An der Kante deutlich über dem, was ohne sie dort steht, und über dem freien Rand gegenüber.
        expect(an(mit, 39.5, 20)).toBeGreaterThan(5 * Math.max(1, an(ohne, 39.5, 20)));
        expect(an(mit, 39.5, 20)).toBeGreaterThan(3 * an(mit, 0.5, 20));
        // Der Streifen rechnet mit, steht aber nirgends.
        expect(mit.bounds.max_x).toBe(46);
        expect(eigene(mit)).toBe(eigene(ohne));
        const samples = rasterSamples(mit);
        for (let k = 0; k < samples.length; k += 1) if (!mit.eigen[k]) expect(samples[k]).toBe(0);
        expect(an(mit, 43, 20)).toBe(0);
    });

    it("🔴 ohne Kanten dasselbe Raster, Zelle für Zelle (die Saat bleibt)", () => {
        const a = buildMountainRaster(v12());
        const b = buildMountainRaster(v12());
        expect(a.bounds).toEqual(v12().bounds);
        expect(Array.from(a.h)).toEqual(Array.from(b.h));
    });

    it("🔴 Rückennetz: die gezeichnete Form läuft an der Kante nicht aus", () => {
        const input = blutzinnen.input;
        const ring =
            (input.geometry.coordinates as number[][][][])[0]?.[0] ?? (input.geometry.coordinates as number[][][])[0]!;
        // Eine Strecke des Umrisses, lang genug für ein paar Zellen.
        let beste = 1;
        for (let s = 1; s < ring.length; s += 1) {
            const l = (q: number): number =>
                Math.hypot(ring[q]![0]! - ring[q - 1]![0]!, ring[q]![1]! - ring[q - 1]![1]!);
            if (l(s) > l(beste)) beste = s;
        }
        const p = ring[beste - 1]! as [number, number];
        const q = ring[beste]! as [number, number];
        const ohne = buildMountainRaster(input);
        const mit = buildMountainRaster({ ...input, andock: { kanten: [[p, q]], streifen: 6 } });
        // Die eigenen Zellen in der ersten Reihe an dieser Strecke, ohne den Rest des Umrisses.
        const nahe = (r: V12Raster): number[] => {
            const werte: number[] = [];
            const dx = q[0] - p[0];
            const dy = q[1] - p[1];
            const l2 = dx * dx + dy * dy;
            for (let j = 0; j < r.hh; j += 1)
                for (let i = 0; i < r.w; i += 1) {
                    const k = j * r.w + i;
                    if (!r.eigen[k]) continue;
                    const px = r.bounds.min_x + i * r.cell - p[0];
                    const py = r.bounds.min_y + j * r.cell - p[1];
                    const t = (px * dx + py * dy) / l2;
                    if (t < 0.2 || t > 0.8) continue;
                    if (Math.hypot(px - t * dx, py - t * dy) <= r.cell * 1.5) werte.push(r.h[k] as number);
                }
            return werte;
        };
        const mittel = (w: number[]): number => w.reduce((s, v) => s + v, 0) / Math.max(1, w.length);
        expect(nahe(ohne).length).toBeGreaterThan(0);
        expect(mittel(nahe(mit))).toBeGreaterThan(mittel(nahe(ohne)) + 100);
        expect(eigene(mit)).toBe(eigene(ohne));
    }, 120_000);
});
