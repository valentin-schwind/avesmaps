import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    buildMountainRaster,
    flussHoeheAn,
    flussMarken,
    pointInGeometry,
    rueckennetzRegler,
    seePlatz,
    seeSpiegel,
    type V12Input,
} from "@avesmaps3d/shared";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { burnRivers, gepinnteLaeufe, risingRivers, type RiverBurnInput } from "../src/terrain/river-burn.ts";
import { buildRiverNetwork, type RiverRow } from "../src/terrain/river-network.ts";

/**
 * Eigene Höhen an Flüssen und Seen eines Gebirges (WI-0249; Vali 2026-10-25: „die höhe von seen und flüssen, welche das gebirge durchqueren,
 * sollen ebenfalls in ihrer höhe verändert werden können … durchquert ein fluss einen see, gilt für die beiden an der stelle nur die höhe des
 * sees“; Vali wählte A, 2026-10-26: nur im Gelände der Fassung 19, nach Lage gespeichert). Rein, ohne Datenbank.
 *
 * Problemfälle: Ohne eigene Höhen ändert sich irgendetwas (Saat, Einbrennen); ein gesetzter Seespiegel gilt nicht für den ganzen See oder
 * wird vom Zufluss gezogen; ein gesetzter Flusspunkt wird von „Flüsse fallen“ wieder abgeschnitten; zwischen zwei gesetzten Punkten springt
 * der Fluss; ein Flusspunkt im See gewinnt gegen den See; die Prüfung meldet einen gewollten Anstieg.
 */

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input };
const sha = (h: Float64Array) =>
    createHash("sha1")
        .update(Buffer.from(h.buffer, h.byteOffset, h.byteLength))
        .digest("hex")
        .slice(0, 12);
const regler = rueckennetzRegler(AVENTURIA_TERRAIN_RECIPES.get(19)?.gebirgsPresets ?? null, "kettengebirge", {});
const rechne = (zusatz: Partial<V12Input>) =>
    buildMountainRaster({ ...blutzinnen.input, zelle: 0.5, rueckennetz: regler, ...zusatz });
const zelle = (r: { w: number; cell: number; bounds: { min_x: number; min_y: number } }, x: number, y: number) =>
    Math.round((y - r.bounds.min_y) / r.cell) * r.w + Math.round((x - r.bounds.min_x) / r.cell);

describe("Wasserhöhen in der Saat (Rückennetz, Fassung 19)", () => {
    const fluss = blutzinnen.input.fluesse[0]!;
    const see = blutzinnen.input.seen[0]!;
    const drin = (x: number, y: number) => pointInGeometry([x, y], blutzinnen.input.geometry);
    const imSee = (x: number, y: number) => pointInGeometry([x, y], see.g);

    it("🔴 ohne eigene Höhen Zeichen für Zeichen wie zuvor (auch mit leeren Listen)", () => {
        const ohne = rechne({});
        expect(sha(rechne({ flussHoehen: [], seeHoehen: [] }).h)).toBe(sha(ohne.h));
    }, 120_000);

    it("🔴 ein eigener Seespiegel gilt für jede Zelle des Sees in der Fläche, auch höher als der Zufluss", () => {
        const platz = seePlatz(see.g);
        const r = rechne({ seeHoehen: [{ ...platz, h: 1777 }] });
        let zellen = 0;
        for (let j = 0; j < r.hh; j++)
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                const x = r.bounds.min_x + i * r.cell;
                const y = r.bounds.min_y + j * r.cell;
                if (!r.eigen[k] || !imSee(x, y)) continue;
                zellen++;
                expect(r.h[k]).toBe(1777);
            }
        expect(zellen).toBeGreaterThan(0);
        expect(seeSpiegel([see], [{ ...platz, h: 1777 }])).toEqual([1777]);
    }, 120_000);

    it("🔴 zwei gesetzte Flusspunkte: genau ihre Höhe, dazwischen linear, auch bergauf; ein Punkt im See zählt nicht", () => {
        const kandidaten = fluss.p.filter(([x, y]) => drin(x, y) && !imSee(x, y));
        expect(kandidaten.length).toBeGreaterThanOrEqual(2);
        const a = kandidaten[0]!;
        const b = kandidaten[1]!;
        const hoehen = [
            { x: a[0], y: a[1], h: 900 },
            { x: b[0], y: b[1], h: 1300 },
        ];
        const r = rechne({ flussHoehen: hoehen });
        expect(r.h[zelle(r, a[0], a[1])]).toBe(900);
        expect(r.h[zelle(r, b[0], b[1])]).toBe(1300);
        // Dazwischen: die Marken über die Bogenlänge.
        const marken = flussMarken(fluss.p, hoehen, [see]);
        expect(marken.map((m) => m.h)).toEqual([900, 1300]);
        const mitte = (marken[0]!.s + marken[1]!.s) / 2;
        expect(flussHoeheAn(marken, mitte, 0)).toBeCloseTo(1100, 6);
        // Ein Stützpunkt im See ist kein Flusspunkt: Dort gilt der See.
        const imSeePunkt = fluss.p.find(([x, y]) => imSee(x, y));
        if (imSeePunkt)
            expect(flussMarken(fluss.p, [{ x: imSeePunkt[0], y: imSeePunkt[1], h: 4000 }], [see])).toEqual([]);
    }, 120_000);
});

describe("Wasserhöhen im Gelände (Einbrennen der Flüsse, nur mit Angabe)", () => {
    const CELL = 0.25;
    /** Ein Tal von West nach Ost, 1.000 → 800 Schritt. */
    const tal = (): StoredRaster => {
        const w = 41;
        const samples = new Uint16Array(w * w);
        for (let j = 0; j < w; j++)
            for (let i = 0; i < w; i++)
                samples[j * w + i] = Math.round(1000 - 20 * i * CELL + 300 * Math.abs(j * CELL - 5));
        return { cell: CELL, originX: 0, originY: 0, width: w, height: w, samples };
    };
    const linie: [number, number][] = [
        [1, 5],
        [3, 5],
        [5, 5],
        [7, 5],
        [9, 5],
    ];
    const rows: RiverRow[] = [
        { id: "f", name: "Probefluss", bach: false, direction: "forward", coordinates: linie, coast: null },
    ];
    const input: RiverBurnInput = { rivers: rows, lakes: [] };
    const lies = (r: StoredRaster, x: number, y: number) => {
        const i = Math.floor((x - r.originX) / r.cell);
        const j = Math.floor((y - r.originY) / r.cell);
        return r.samples[j * r.width + i]!;
    };

    it("🔴 ohne Angabe Zeichen für Zeichen wie zuvor", () => {
        const a = tal();
        const b = tal();
        burnRivers([a], input);
        burnRivers([b], input, { flussPunkte: [] });
        expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true);
    });

    it("🔴 ein gesetzter Stützpunkt trägt genau seine Höhe, auch über dem Lauf davor; flussab fällt es von ihm aus", () => {
        const r = tal();
        const punkte = [{ x: 5, y: 5, h: 1400 }];
        const bericht = burnRivers([r], input, { flussPunkte: punkte });
        expect(lies(r, 5, 5)).toBe(1400);
        // Flussab fällt der Fluss von dort (höchstens so hoch wie der Punkt).
        expect(lies(r, 7, 5)).toBeLessThanOrEqual(1400);
        // Der gewollte Anstieg ist kein Befund, weder im Bericht noch in der Prüfung.
        expect(bericht.unresolved).toEqual([]);
        expect(risingRivers([r], input, { flussPunkte: punkte }).rising).toEqual([]);
        // Ohne die Angabe meldet die Prüfung ihn.
        expect(risingRivers([r], input).rising.length).toBe(1);
    });

    it("zwischen zwei gesetzten Stützpunkten linear, an ihnen genau", () => {
        const network = buildRiverNetwork(rows, [], () => 0);
        const pins = gepinnteLaeufe(network, [
            { x: 3, y: 5, h: 1000 },
            { x: 7, y: 5, h: 1200 },
        ])!;
        const run = network.runs[0]!;
        const at = (x: number) => {
            const i = Array.from(run.xs).findIndex((v) => Math.abs(v - x) < 1e-9);
            return pins[0]![i]!;
        };
        expect(at(3)).toBe(1000);
        expect(at(7)).toBe(1200);
        expect(at(5)).toBeCloseTo(1100, 6);
        expect(Number.isNaN(at(1))).toBe(true);
        expect(Number.isNaN(at(9))).toBe(true);
    });
});
