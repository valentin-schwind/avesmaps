import { describe, expect, it } from "vitest";
import { erosionWorkersFor, simulateDomainTerrain } from "../src/terrain/domain/generate.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { chunkOf } from "../src/terrain/domain/erosion-kernels.ts";
import { erosionExec, sharedFloat32 } from "../src/terrain/domain/erosion-pool.ts";
import type { loadDomainInputs } from "../src/terrain/domain/inputs.ts";

/**
 * WI-0227: Die Domänenerosion verteilt Kastenfilter, ρ8, Diffusion und Rückverteilung auf Worker. Das Gelände muss mit jeder Zahl von
 * Workern bytegleich sein, dazu Massen und der Bericht der Rückverteilung.
 */

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
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
    };
}

function input(): Awaited<ReturnType<typeof loadDomainInputs>> {
    const continent = polygon(256, 256, 896, 896);
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [{ kind: "meer", geometry: polygon(0, 0, 256, 1024) }],
        seeds: [
            {
                width: 64,
                height: 64,
                cell: 4,
                originX: 402,
                originY: 402,
                samples: Uint16Array.from({ length: 4096 }, (_, k) => 4000 + 30 * (k % 64) + 20 * Math.floor(k / 64)),
            },
        ],
        peaks: [{ id: "p", name: "Gipfel", x: 520, y: 520, h: 6200 }],
        landscapes: [
            { layer: "topographie", type: "gebirge", geometry: polygon(400, 400, 656, 656) },
            { layer: "vegetation", type: "wald", geometry: polygon(300, 650, 800, 850) },
        ],
        rivers: {
            rivers: [
                {
                    coordinates: [
                        [500, 700],
                        [420, 780],
                        [300, 820],
                    ],
                    bach: false,
                    direction: "forward",
                },
            ],
            lakes: [],
            fingerprint: "river",
        },
        fingerprint: "fixture",
    } as unknown as Awaited<ReturnType<typeof loadDomainInputs>>;
}

describe("Erosion mit Workern (WI-0227)", () => {
    for (const version of [17, 18]) {
        it(`🔴 Fassung ${String(version)}: mit 0, 1 und 2 Workern bytegleich, Massen und Rückverteilung gleich`, () => {
            const recipe = AVENTURIA_TERRAIN_RECIPES.get(version)!;
            const alone = simulateDomainTerrain(input(), recipe, 256, undefined, { erosionWorkers: 0 });
            for (const workers of [1, 2]) {
                const shared = simulateDomainTerrain(input(), recipe, 256, undefined, { erosionWorkers: workers });
                expect(Buffer.from(shared.raster.samples.buffer).equals(Buffer.from(alone.raster.samples.buffer))).toBe(
                    true,
                );
                expect(shared.masses).toEqual(alone.masses);
                expect(shared.uplift).toEqual(alone.uplift);
            }
        }, 120_000);
    }

    it("🔴 die Worker starten wirklich (sonst rechnete der Vergleich oben nur den Hauptthread)", () => {
        const n = 64;
        const shared = (): Float32Array => sharedFloat32(n * n);
        const height = shared();
        for (let k = 0; k < n * n; k += 1) height[k] = k % 97;
        const fields = {
            n,
            cell: 16,
            height,
            surface: shared(),
            spare: shared(),
            classes: new Uint8Array(new SharedArrayBuffer(n * n)),
            locked: new Uint8Array(new SharedArrayBuffer(n * n)),
            weightSum: null,
            first: null,
            sum: null,
            materials: {
                m: 4,
                channelBias: new Float32Array(16).fill(2),
                diffusivity: new Float32Array(16).fill(1),
                upliftWeight: new Float32Array(16).fill(1),
            },
        };
        const exec = erosionExec(fields, 2);
        try {
            expect(exec.threads).toBe(3);
            exec.run("surface");
            for (let k = 0; k < n * n; k += 1) expect(fields.surface[k]).toBe(height[k]! - 2);
        } finally {
            exec.close();
        }
    });

    it("teilt jeden Bereich lückenlos und ohne Überlappung", () => {
        for (const [parts, total] of [
            [3, 4096],
            [3, 7],
            [2, 1],
        ] as const) {
            let next = 0;
            for (let part = 0; part < parts; part += 1) {
                const [from, to] = chunkOf(part, parts, total);
                expect(from).toBe(next);
                next = to;
            }
            expect(next).toBe(total);
        }
    });

    it("Vorgabe 2 Worker ab 1024², kleinere Gitter allein, TERRAIN_EROSION_WORKERS von 0 bis 8", () => {
        expect(erosionWorkersFor(4096, {})).toBe(2);
        expect(erosionWorkersFor(512, {})).toBe(0);
        expect(erosionWorkersFor(4096, { TERRAIN_EROSION_WORKERS: "1" })).toBe(1);
        expect(erosionWorkersFor(4096, { TERRAIN_EROSION_WORKERS: "0" })).toBe(0);
        expect(erosionWorkersFor(4096, { TERRAIN_EROSION_WORKERS: "zwölf" })).toBe(2);
    });
});
