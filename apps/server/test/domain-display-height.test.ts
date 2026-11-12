import { describe, expect, it } from "vitest";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import { generateDisplayHeights } from "../src/terrain/display-height/generate.ts";
import { MOUNTAIN, SEA } from "../src/terrain/hydrology/grid.ts";
import { unevenDisplayLakeList, unevenDisplayLakes } from "../src/terrain/display-height/verify.ts";

describe("Domain-DEM als einzige Quelle der Anzeigehöhen", () => {
    const size = 64;
    const samples = Uint16Array.from({ length: size * size }, (_, k) => k * 19);
    const domain: DomainHeightSource = {
        raster: { width: size, height: size, cell: 16, originX: 8, originY: 8, samples },
        fingerprint: "fixture",
        revision: "fixture",
        membershipFingerprint: "fixture",
        mountains: [],
    };

    it("übernimmt jede absolute Höhe exakt und kehrt nur die Zeilenrichtung um", () => {
        const result = generateDisplayHeights({ domain, water: [], landscapes: [] }, size);
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                expect(result.field[y * size + x]).toBe(samples[(size - 1 - y) * size + x]);
            }
        }
        expect(domain.raster.samples).toEqual(samples);
    });

    it("erzeugt weder eine synthetische Grundhöhe noch einen Relief-Hochpass", () => {
        const source = { ...domain, raster: { ...domain.raster, samples: new Uint16Array(size * size).fill(217) } };
        const result = generateDisplayHeights({ domain: source, water: [], landscapes: [] }, size);
        expect([...new Set(result.field)]).toEqual([217]);
    });

    it("weist eine abweichende Rastergröße zurück statt eine zweite Höhe zu interpolieren", () => {
        expect(() => generateDisplayHeights({ domain, water: [], landscapes: [] }, size * 2)).toThrow();
    });

    it("erhält Inselhöhe im überlagernden Meer und bestimmt Gebirge unabhängig von Höhe", () => {
        const geometry = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [0, 0],
                    [512, 0],
                    [512, 1024],
                    [0, 1024],
                    [0, 0],
                ],
            ],
        };
        const mountainGeometry = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [512, 0],
                    [1024, 0],
                    [1024, 1024],
                    [512, 1024],
                    [512, 0],
                ],
            ],
        };
        const source = {
            ...domain,
            raster: {
                ...domain.raster,
                samples: Uint16Array.from({ length: size * size }, (_, k) => (k % size < size / 2 ? 60 : 0)),
            },
            mountains: [{ geometry: mountainGeometry, minX: 512, minY: 0, maxX: 1024, maxY: 1024 }],
        };
        const result = generateDisplayHeights(
            {
                domain: source,
                water: [{ kind: "meer", geometry }],
                landscapes: [{ layer: "topographie", type: "insel", area: 512 * 1024, geometry }],
            },
            size,
        );
        expect(result.field[0]).toBe(60);
        expect(result.classes[0]! & (SEA | MOUNTAIN)).toBe(0);
        expect(result.field[size - 1]).toBe(0);
        expect(result.classes[size - 1]! & MOUNTAIN).toBe(MOUNTAIN);
    });

    it("prüft rasterbenachbarte separate Seen einzeln und erkennt Unebenheit innerhalb eines Sees", () => {
        const left = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [0, 0],
                    [512, 0],
                    [512, 1024],
                    [0, 1024],
                    [0, 0],
                ],
            ],
        };
        const right = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [512, 0],
                    [1024, 0],
                    [1024, 1024],
                    [512, 1024],
                    [512, 0],
                ],
            ],
        };
        const water = [
            { kind: "see" as const, geometry: left },
            { kind: "see" as const, geometry: right },
        ];
        const source = {
            ...domain,
            raster: {
                ...domain.raster,
                samples: Uint16Array.from({ length: size * size }, (_, k) => (k % size < size / 2 ? 98 : 124)),
            },
        };
        const { field, classes } = generateDisplayHeights({ domain: source, water, landscapes: [] }, size);
        expect(unevenDisplayLakes(field, classes, size, water)).toBe(0);
        field[0] = 99;
        expect(unevenDisplayLakes(field, classes, size, water)).toBe(1);
        // Betreiber 2026-10-03: Der Befund nennt den See (Nummer in der Reihenfolge der Wasserflächen) und seine Höhenspanne.
        const list = unevenDisplayLakeList(field, classes, size, water);
        expect(list.map((lake) => lake.index)).toEqual([0]);
        expect(list[0]?.high).toBeGreaterThan(list[0]?.low ?? Infinity);
    });
});
