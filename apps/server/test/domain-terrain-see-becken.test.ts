import { describe, expect, it } from "vitest";
import { TREFFEN } from "@avesmaps3d/shared";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { LakeBody } from "../src/terrain/domain/lake-bodies.ts";
import { beckenSchutz, hebeSeeRaender, type BeckenSchutz } from "../src/terrain/domain/see-becken.ts";

/**
 * Das Becken um jeden See (OPS-000086, Vali 2026-11-06: „seen mit und ohne eigene höhe sollen ein etwas weiteres becken bekommen“). Problemfälle: Der See fällt zu
 * einer Seite ab; das Becken frisst die Wand; ein Graben bleibt am Ufer; Fluss, Meer oder der See selbst ändern sich; ein Punkt mit eigener Höhe verliert sie.
 */

const CELL = 0.1;
const N = 120;
const BREITE = TREFFEN.seeRandE;
const LEER: BeckenSchutz = { punkte: [], stuecke: [] };

/** Ein Raster N × N ab (0, 0), Zeile 0 im Süden; `grund` nach Karteneinheiten. */
function feld(grund: (x: number, y: number) => number): StoredRaster {
    const samples = new Uint16Array(N * N);
    for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) samples[j * N + i] = grund(i * CELL, j * CELL);
    return { cell: CELL, originX: 0, originY: 0, width: N, height: N, samples };
}
const sued = (x: number, y: number): number => Math.round(y / CELL) * N + Math.round(x / CELL);
const nord = (x: number, y: number): number => (N - 1 - Math.round(y / CELL)) * N + Math.round(x / CELL);
/** Der See über dem Rechteck, auf `spiegel` gesetzt, wie `flattenDomainLakes` es täte. */
function see(r: StoredRaster, x0: number, y0: number, x1: number, y1: number, spiegel: number): LakeBody {
    const cells: number[] = [];
    for (let y = y0; y <= y1 + 1e-9; y += CELL)
        for (let x = x0; x <= x1 + 1e-9; x += CELL) {
            cells.push(nord(x, y));
            r.samples[sued(x, y)] = spiegel;
        }
    return { cells: Int32Array.from(new Set(cells)).sort(), area: 0, part: 0 };
}
/** Jede Zelle außer dem See darf sich ändern. */
const alles = (body: LakeBody): Uint8Array => {
    const mask = new Uint8Array(N * N).fill(1);
    for (const k of body.cells) mask[k] = 0;
    return mask;
};

describe("Das Becken um jeden See", () => {
    it("🔴 ein See am Hang: talseits ein ebener Rand auf dem Spiegel, dann ein Hang; bergseits bleibt die Wand, nichts steigt über den Spiegel", () => {
        // Nach Süden fällt das Gelände: bei y = 6 gerade auf 1.500, je E um 200 Schritt.
        const r = feld((_x, y) => 1500 + (y - 6) * 200);
        const vorher = Float64Array.from(r.samples);
        const body = see(r, 4, 5, 8, 7, 1500);
        hebeSeeRaender(r, [body], alles(body), BREITE, LEER);
        // Talseits: bis `breite` der Spiegel (ein Hauch Rundung am Raster), dann fällt es höchstens mit `steil`, stetig, bis ins Gelände.
        for (const d of [0.1, 0.5, 1, BREITE - 0.1]) expect(r.samples[sued(6, 5 - d)]).toBe(1500);
        const quer = Array.from({ length: 30 }, (_, i) => r.samples[sued(6, 5 - BREITE - 0.1 * i)]!);
        for (let i = 1; i < quer.length; i += 1) {
            expect(quer[i]!).toBeLessThanOrEqual(quer[i - 1]!);
            expect(quer[i - 1]! - quer[i]!).toBeLessThanOrEqual(TREFFEN.steil * 3000 * 0.1 + 1);
        }
        // Bergseits lag alles schon über dem Spiegel: unverändert, auch die Wand.
        for (const d of [0.1, 1, 3]) expect(r.samples[sued(6, 7 + d)]).toBe(vorher[sued(6, 7 + d)]);
        // Nichts wird über den Spiegel gehoben, was vorher darunter lag.
        for (let k = 0; k < r.samples.length; k += 1)
            if (r.samples[k] !== vorher[k]) expect(r.samples[k]).toBeLessThanOrEqual(1500);
    });

    it("🔴 ein See ohne eigene Höhe: Der Spiegel kommt aus dem Raster, das Ufer direkt am See ist kein Graben", () => {
        const r = feld(() => 400);
        const body = see(r, 5, 5, 7, 7, 900);
        const gehoben = hebeSeeRaender(r, [body], alles(body), BREITE, LEER);
        expect(gehoben).toBeGreaterThan(0);
        expect(r.samples[sued(4.9, 6)]).toBe(900);
        expect(r.samples[sued(7.1, 6)]).toBe(900);
        expect(r.samples[sued(6, 7.1)]).toBe(900);
    });

    it("🔴 der See bleibt, und was die Maske sperrt (Fluss, Meer) auch; zwei Seen rechnen jeder mit seinem Spiegel", () => {
        const r = feld(() => 300);
        const a = see(r, 2, 2, 3, 3, 800);
        const b = see(r, 8, 8, 9, 9, 500);
        const mask = new Uint8Array(N * N).fill(1);
        for (const k of [...a.cells, ...b.cells]) mask[k] = 0;
        // Ein Fluss durch den Rand des ersten Sees: Seine Spalte ist gesperrt.
        for (let y = 0; y <= 2; y += CELL) mask[nord(2.5, y)] = 0;
        const vorherFluss = r.samples[sued(2.5, 1.5)];
        hebeSeeRaender(r, [a, b], mask, BREITE, LEER);
        expect(r.samples[sued(2.5, 2.5)]).toBe(800);
        expect(r.samples[sued(8.5, 8.5)]).toBe(500);
        expect(r.samples[sued(2.5, 1.5)]).toBe(vorherFluss);
        expect(r.samples[sued(2.7, 1.5)]).toBe(800);
        expect(r.samples[sued(8.5, 7.5)]).toBe(500);
    });

    it("🔴 ein Punkt mit eigener Höhe behält sie, um einen Fluss mit eigenen Höhen bleibt das Umland; das Ufer des Sees schützt nichts", () => {
        const r = feld(() => 300);
        const body = see(r, 5, 5, 7, 7, 800);
        const mulde = { x: 4, y: 6, h: 320, vorrang: 2 };
        const fluss = [
            { x: 8, y: 6, h: 300, vorrang: 0, wasser: "fluss" as const },
            { x: 9, y: 6, h: 280, vorrang: 0, wasser: "fluss" as const },
        ];
        const ufer = { x: 7, y: 6, h: 800, vorrang: 0, wasser: "see" as const };
        const schutz = beckenSchutz({
            rueckennetz: [
                {
                    id: "g",
                    geometry: { type: "Polygon", coordinates: [] },
                    deckel: 0,
                    ziele: {
                        punkte: [mulde, fluss[0]!, fluss[1]!, ufer],
                        strecken: [
                            [1, 2],
                            [3, 3],
                        ],
                    },
                },
            ],
        });
        expect(schutz.punkte).toEqual([mulde]);
        expect(schutz.stuecke).toHaveLength(1);
        hebeSeeRaender(r, [body], alles(body), BREITE, schutz);
        expect(r.samples[sued(4, 6)]).toBe(300);
        expect(r.samples[sued(8, 6)]).toBe(300);
        // Abseits von beiden steht der Rand.
        expect(r.samples[sued(6, 4)]).toBe(800);
    });
});
