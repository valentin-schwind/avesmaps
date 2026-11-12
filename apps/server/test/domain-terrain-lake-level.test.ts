import { describe, expect, it } from "vitest";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { domainIslands, domainWaterClasses, summitCores } from "../src/terrain/domain/constraints.ts";
import { lakeBodies } from "../src/terrain/domain/lake-bodies.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";
import { verifyDomainRaster } from "../src/terrain/domain/verify.ts";
import { grid, LAKE, SEA } from "../src/terrain/hydrology/grid.ts";

/**
 * Betreiber 2026-10-04: „seen [...] zu tief im gelände ‚versinken‘. z.b. der neunaugensee oder die seen im nebelmoor
 * sollten eigentlich nahezu flach sein“, dann „der tiefste zufluss bestimmt die seehöhe, ansonsten liegt der see auf der
 * niedrigsten landstelle unter ihm“.
 *
 * Gemessen an der fertigen Pipeline. Vorher (Generator 17) bekamen alle Teile einer Mehrfachfläche (Seen im Nebelmoor, Seen
 * des Totenmoors) das gemeinsame Minimum aller Teile, und ein Zufluss zog den See bis auf das tiefste Bett irgendwo flussauf
 * (Neunaugensee: Pandlaril, 9 E oberhalb, wegen des Gipfels „Der Daumen“).
 */

const SIZE = 256;

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

const big = polygon(480, 480, 672, 672);
/** Seen im Nebelmoor: eine Fläche aus sechs getrennten kleinen Seen, über das Land verteilt. */
const nest = {
    type: "MultiPolygon" as const,
    coordinates: [
        [300, 300],
        [390, 430],
        [330, 720],
        [720, 310],
        [780, 540],
        [820, 820],
    ].map(([x, y]) => polygon(x!, y!, x! + 36, y! + 36).coordinates),
};

function input(): DomainInputs {
    const continent = polygon(256, 256, 896, 896);
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [
            { kind: "meer", geometry: polygon(0, 0, 256, 1024) },
            { kind: "see", geometry: big },
            { kind: "see", geometry: nest },
        ],
        seeds: [],
        peaks: [],
        landscapes: [],
        rivers: {
            // Ein Fluss aus dem tiefen Küstenland in den großen See (vorher zog sein Bett den See auf 15 Schritt).
            rivers: [
                {
                    id: "inflow",
                    name: "Zufluss",
                    bach: false,
                    direction: "forward" as const,
                    coast: null,
                    coordinates: [
                        [270, 576],
                        [480, 576],
                    ] as [number, number][],
                },
            ],
            lakes: [{ id: "big", name: "Großer See", geometry: big }],
            fingerprint: "rivers",
        },
        fingerprint: "fixture",
    };
}

/** Spiegel (Median der Zellen) und Ufer (Median der Landzellen bis zwei Zellen um den See) jedes Sees. */
function measure(samples: Uint16Array, source: DomainInputs): { level: number; shore: number; cells: number }[] {
    const g = grid(SIZE);
    const classes = domainWaterClasses(g, source.water, domainIslands(source), summitCores(source));
    const at = (k: number): number => samples[(SIZE - 1 - Math.floor(k / SIZE)) * SIZE + (k % SIZE)]!;
    const median = (values: number[]): number => values.sort((a, b) => a - b)[values.length >> 1]!;
    return lakeBodies(g, source.water, classes).map((body) => {
        const inside = new Set(body.cells);
        const ring = new Set<number>();
        for (const k of body.cells) {
            const x = k % SIZE,
                y = (k - x) / SIZE;
            for (let dy = -2; dy <= 2; dy += 1)
                for (let dx = -2; dx <= 2; dx += 1) {
                    const nx = x + dx,
                        ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
                    const nk = ny * SIZE + nx;
                    if (!inside.has(nk) && !(classes[nk]! & (SEA | LAKE))) ring.add(nk);
                }
        }
        return { level: median([...inside].map(at)), shore: median([...ring].map(at)), cells: inside.size };
    });
}

describe("Seen liegen auf der niedrigsten Landstelle unter ihnen, je Gewässer (WI-0067, Betreiber 2026-10-04)", () => {
    const source = input();
    const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, SIZE);
    const lakes = measure(result.raster.samples, source);

    it("findet den großen See und die sechs getrennten Seen der Mehrfachfläche", () => {
        expect(lakes.length).toBe(7);
        expect(lakes.filter((lake) => lake.cells > 1000).length).toBe(1);
    });

    it("gibt jedem Teil einer Mehrfachfläche den Spiegel seiner eigenen niedrigsten Landstelle, nicht des Minimums aller Teile", () => {
        const small = lakes.filter((lake) => lake.cells < 100);
        expect(small.length).toBe(6);
        expect(new Set(small.map((lake) => lake.level)).size).toBeGreaterThan(1);
        // Ein kleiner See liegt am oder knapp unter seinem Ufer, nie in einer Grube (vorher: das Minimum aller sechs Teile).
        for (const lake of small)
            expect(Math.abs(lake.shore - lake.level), `${String(lake.level)}/${String(lake.shore)}`).toBeLessThan(120);
    });

    it("hält jeden See eben (die Prüfung zählt jedes Gewässer einzeln)", () => {
        expect(verifyDomainRaster(result.raster, source).errors.filter((error) => error.startsWith("lake:"))).toEqual(
            [],
        );
    });
});
