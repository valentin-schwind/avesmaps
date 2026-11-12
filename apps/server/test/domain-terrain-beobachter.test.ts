import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { HoehenSicht } from "../src/terrain/domain/beobachter.ts";
import { generateDomainTerrain, simulateDomainTerrain } from "../src/terrain/domain/generate.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { computeLocalTerrain } from "../src/terrain/domain/local.ts";
import { AVENTURIA_TERRAIN_RECIPES, type TerrainRecipe } from "../src/terrain/domain/recipes.ts";

/**
 * WI-0249 P1: Der Beobachter (`beobachter.ts`) sieht das Höhenfeld nach jeder Phase und ändert nichts. Ohne ihn und mit ihm (nur lesend)
 * kommt dasselbe Gelände heraus, Bit für Bit: Fingerabdruck und Bericht gleich.
 */

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon" as const,
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    };
}

const RN = polygon(200, 200, 360, 360);
const V12 = polygon(600, 600, 760, 760);

/** Je Gebirge eine Saat mit Rücken im Abstand von 16 E (gespeicherte Ausrichtung, Zeile 0 im Süden). */
function seed(x0: number): StoredRaster {
    const width = 40;
    const samples = new Uint16Array(width * width);
    for (let k = 0; k < samples.length; k++)
        samples[k] = Math.round(1600 + 500 * Math.cos(((k % width) * 2 * Math.PI) / 4));
    return { width, height: width, cell: 4, originX: x0 + 2, originY: x0 + 2, samples };
}

function domain(): DomainInputs {
    const continent = polygon(0, 0, 1024, 1024);
    return {
        continent: { id: "land", fingerprint: "land", geometry: continent },
        land: [continent],
        seeds: [seed(200), seed(600)],
        peaks: [{ id: "p", name: "Gipfel", x: 280, y: 280, h: 2200 }],
        fingerprint: "fixture",
        water: [],
        landscapes: [
            { layer: "topographie", type: "gebirge", geometry: RN },
            { layer: "topographie", type: "gebirge", geometry: V12 },
        ],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        rueckennetz: [{ id: "rn", geometry: RN, deckel: 2100 }],
    };
}

/** Fassung 19 auf 256² mit einer feinen Stufe auf 512² in 2 × 2 Kacheln: Jede Phase des Laufs kommt vor. */
function recipe(): TerrainRecipe {
    const value = structuredClone(AVENTURIA_TERRAIN_RECIPES.get(19)!);
    // Die Fassung kennt nur 4096² und 8192² (Literaltypen); für den Test kleiner, wie die Werte anderer Fixtures (`Object.assign`).
    Object.assign(value.generator, { size: 256, iterations: 3 });
    Object.assign(value.generator.fine!, { size: 512, tiles: 2, halo: 16, blend: 8 });
    return value;
}

describe("WI-0249: Beobachter des Domain-Geländes", () => {
    it("ändert nichts: Fingerabdruck und Bericht wie ohne Beobachter", () => {
        const ohne = generateDomainTerrain(domain(), recipe());
        const phasen: string[] = [];
        const summen: string[] = [];
        let letzte: HoehenSicht | null = null;
        const mit = generateDomainTerrain(
            domain(),
            recipe(),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            (phase, sicht) => {
                phasen.push(phase);
                expect(sicht.hoehe.length).toBe(sicht.n * sicht.n);
                expect(sicht.cell).toBeCloseTo(1024 / sicht.n, 12);
                summen.push(createHash("sha1").update(Buffer.from(sicht.hoehe.buffer)).digest("hex"));
                letzte = sicht;
            },
        );
        expect(mit.fingerprint).toBe(ohne.fingerprint);
        expect(mit.report).toEqual(ohne.report);
        const runde = (r: number) => [`erosion-${r}/stream`, `erosion-${r}/diffusion`, `erosion-${r}/uplift`];
        const schluss = ["constraints/water", "constraints/cap", "constraints/summits"];
        expect(phasen).toEqual([
            "landforms",
            "initial",
            "seed",
            ...runde(1),
            ...runde(2),
            ...runde(3),
            "erosion",
            "mountain-interior",
            ...schluss,
            "fine-tiles",
            ...schluss,
        ]);
        // Der letzte Blick ist das fertige Raster; die Phasen der Erosion sehen jede ein anderes Feld.
        expect(letzte!.zeile0).toBe("sued");
        expect(letzte!.n).toBe(512);
        expect(Array.from(letzte!.hoehe)).toEqual(Array.from(mit.raster.samples));
        expect(new Set(summen.slice(3, 12)).size).toBe(9);
    }, 60_000);

    it("sieht auch den lokalen Lauf, ohne und mit Stand der groben Stufe, und ändert nichts (WI-0249 P6)", async () => {
        const base = new Uint16Array(512 * 512);
        const tiles = [0, 1, 2, 3];
        const ohne = await computeLocalTerrain(domain(), recipe(), { tiles, base });
        const phasen: string[] = [];
        const mit = await computeLocalTerrain(domain(), recipe(), {
            tiles,
            base,
            beobachter: (phase) => phasen.push(phase),
        });
        expect(Array.from(mit.raster.samples)).toEqual(Array.from(ohne.raster.samples));
        const runde = (r: number) => [`erosion-${r}/stream`, `erosion-${r}/diffusion`, `erosion-${r}/uplift`];
        const schluss = ["constraints/water", "constraints/cap", "constraints/summits"];
        const grob = [
            "landforms",
            "initial",
            "seed",
            ...runde(1),
            ...runde(2),
            ...runde(3),
            "erosion",
            "mountain-interior",
        ];
        expect(phasen).toEqual([...grob, ...schluss, "fine-tiles", ...schluss]);
        // Mit Stand rechnet die grobe Stufe im Fenster (`localCoarse`); der Beobachter sieht dieselben Phasen.
        const stand = () => ({ initial: ohne.state!.initial.slice(), interior: ohne.state!.interior.slice() });
        const lokalOhne = await computeLocalTerrain(domain(), recipe(), { tiles: [0], base, previous: stand() });
        const lokalPhasen: string[] = [];
        const lokalMit = await computeLocalTerrain(domain(), recipe(), {
            tiles: [0],
            base,
            previous: stand(),
            beobachter: (phase) => lokalPhasen.push(phase),
        });
        expect(Array.from(lokalMit.raster.samples)).toEqual(Array.from(lokalOhne.raster.samples));
        expect(lokalPhasen).toEqual([...grob, ...schluss, "fine-tiles", ...schluss]);
    }, 120_000);

    it("sieht die grobe Stufe im Gitter der Erosion, Zeile 0 im Norden", () => {
        const sichten: { phase: string; zeile0: string; n: number }[] = [];
        const ohne = simulateDomainTerrain(domain(), recipe(), 256);
        const mit = simulateDomainTerrain(domain(), recipe(), 256, undefined, {
            beobachter: (phase, sicht) => sichten.push({ phase, zeile0: sicht.zeile0, n: sicht.n }),
        });
        expect(Array.from(mit.raster.samples)).toEqual(Array.from(ohne.raster.samples));
        expect(mit.masses).toEqual(ohne.masses);
        expect(sichten.every((s) => s.zeile0 === "nord" && s.n === 256)).toBe(true);
        expect(sichten.at(-1)!.phase).toBe("erosion");
    }, 60_000);
});
