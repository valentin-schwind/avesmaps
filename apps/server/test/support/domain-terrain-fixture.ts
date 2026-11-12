import type { DomainInputs } from "../../src/terrain/domain/inputs.ts";

/**
 * Die kleine Domäne der Generatortests (Prototyp D, WI-0223): Kontinent mit Meer, See, Fluss, Gebirge samt Seed, Hügelland, Wald, einem
 * Gipfel im Gebirge und einem freien. Auf 256² (4 E je Zelle) rechnet sie in Sekunden.
 */
/** Ein achsenparalleles Rechteck als GeoJSON-Polygon. */
export function polygon(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): { type: "Polygon"; coordinates: [number, number][][] } {
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

export function fixture(extraPeaks: DomainInputs["peaks"] = []): DomainInputs {
    const continent = polygon(128, 128, 896, 896);
    const sea = polygon(0, 0, 128, 1024);
    const lake = polygon(600, 300, 640, 340);
    const width = 56;
    const height = 50;
    const seed = Uint16Array.from({ length: width * height }, (_, k) => {
        const x = k % width;
        const y = Math.floor(k / width);
        return Math.round(1400 + 900 * Math.exp(-(((y - 25) / 9) ** 2)) + 160 * Math.sin(x / 3) * Math.cos(y / 4));
    });
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [
            { kind: "meer", geometry: sea },
            { kind: "see", geometry: lake },
        ],
        seeds: [{ width, height, cell: 4, originX: 300, originY: 500, samples: seed }],
        peaks: [
            { id: "inner-peak", name: "inner peak", x: 410, y: 600, h: 3000 },
            { id: "free-peak", name: "free peak", x: 700, y: 250, h: 1200 },
            ...extraPeaks,
        ],
        landscapes: [
            { layer: "topographie", type: "meer", geometry: sea },
            { layer: "topographie", type: "see", geometry: lake },
            { layer: "topographie", type: "gebirge", geometry: polygon(300, 500, 520, 700) },
            { layer: "topographie", type: "huegelland", geometry: polygon(560, 520, 760, 700) },
            { layer: "vegetation", type: "wald", geometry: polygon(128, 128, 500, 400) },
        ],
        rivers: {
            rivers: [
                {
                    id: "river",
                    name: "river",
                    bach: false,
                    direction: "forward",
                    coast: null,
                    coordinates: [
                        [420, 480],
                        [300, 400],
                        [140, 300],
                        [100, 290],
                    ],
                },
            ],
            lakes: [],
            fingerprint: "river",
        },
        fingerprint: "fixture",
    };
}
