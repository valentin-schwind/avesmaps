import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    composeDem,
    decodeDemTile,
    demRevision,
    demTiles,
    DEM_MAX_ZOOM,
    DEM_TILE_SIZE,
} from "../src/terrain/dem-tiles.ts";
import { LEGACY_CONE } from "../src/terrain/peak-cone.ts";
import {
    carveValleys,
    generateVisualRelief,
    VISUAL_RELIEF_PARAMS,
    sparseTerrain,
    type TerrainSource,
    type VisualReliefInput,
} from "../src/terrain/visual-relief/generate.ts";
import { grid, LAKE, MOUNTAIN, SEA } from "../src/terrain/visual-relief/grid.ts";
import { landscapeStrength, paintOrder, type LandscapeArea } from "../src/terrain/visual-relief/landscape.ts";
import type { RiverChain, RiverRow } from "../src/terrain/visual-relief/rivers.ts";

/**
 * Die drei Fälle rechnen ein ganzes Gelände. Allein auf ruhigem Rechner unter 60 s, unter der Last paralleler Prüfläufe 70 bis 90 s, auch im
 * Nachlauf (Befund der Koordination 2026-10-19; das hielt vor-dem-push und den Sammellauf rot ohne Befund). Die Frist misst den Rechner, nicht
 * den Code: großzügig, aber endlich.
 */
const GELAENDE_FRIST_MS = 240_000;

/**
 * Das visuelle Relief (WI-0054) an einer kleinen erfundenen Welt: eine Insel mit See, Fluss und Berg.
 * Geprüft wird, was das Relief verspricht: Wasser eben, Flüsse fallen, Gebirge folgt dem Gelände,
 * gleiche Eingabe gleiches Bild, und dass es niemand außer der Schattierung liest.
 */

const N = 128;
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ],
];

/** Ein Berg als dünn besetztes Gelände auf dem 4096er-Gitter: Kegel um (650, 650), 3.000 Schritt. */
function cone(): TerrainSource {
    const cells: number[] = [];
    const heights: number[] = [];
    for (let gy = 0; gy < 4096; gy += 1) {
        const y = 1024 - (gy + 0.5) * 0.25;
        if (Math.abs(y - 650) > 40) continue;
        for (let gx = 0; gx < 4096; gx += 1) {
            const x = (gx + 0.5) * 0.25;
            const d = Math.hypot(x - 650, y - 650);
            if (d >= 40) continue;
            cells.push(gy * 4096 + gx);
            heights.push(3000 * (1 - d / 40));
        }
    }
    return sparseTerrain(Int32Array.from(cells), Float32Array.from(heights));
}

function world(): VisualReliefInput {
    // Meer mit einem Loch (die Insel 200..824), darin ein See.
    const sea = {
        kind: "meer" as const,
        geometry: { type: "Polygon", coordinates: [...square(0, 0, 1024, 1024), ...square(200, 200, 824, 824)] },
    };
    const lake = { kind: "see" as const, geometry: { type: "Polygon", coordinates: square(380, 560, 470, 640) } };
    const rivers: RiverRow[] = [
        // Vom Berg an den See, dann vom See zur Küste; Richtung bekannt.
        {
            coordinates: [
                [620, 620],
                [470, 600],
            ],
            isBach: false,
            flowDirection: "forward",
        },
        {
            coordinates: [
                [210, 300],
                [380, 590],
            ],
            isBach: false,
            flowDirection: "reverse",
        },
        {
            coordinates: [
                [700, 300],
                [520, 420],
            ],
            isBach: true,
            flowDirection: null,
        },
    ];
    return { terrain: cone(), water: [sea, lake], rivers, landscapes: [] };
}

describe("visuelles Relief", () => {
    it("hält auch einen See ohne Fluss auf einem ansteigenden Sockel eben", () => {
        const input = world();
        const samples = Uint16Array.from({ length: N * N }, (_, k) => k % N);
        const result = generateVisualRelief(
            {
                ...input,
                rivers: [],
                continental: {
                    fingerprint: "sloping-base",
                    raster: { cell: 8, originX: 4, originY: 4, width: N, height: N, samples },
                },
            },
            N,
        );
        const values = new Set<number>();
        for (let k = 0; k < result.field.length; k += 1) {
            if ((result.classes[k] as number) & LAKE) values.add(result.field[k] as number);
        }
        expect(values.size).toBe(1);
    });
    const input = world();
    const result = generateVisualRelief(input, N);
    const { field, classes } = result;
    const at = (x: number, y: number): number =>
        field[Math.floor((1024 - y) / (1024 / N)) * N + Math.floor(x / (1024 / N))] as number;

    it("lässt das Meer exakt eben und die Insel Land", () => {
        let sea = 0;
        for (let k = 0; k < field.length; k += 1) {
            if ((classes[k] as number) & SEA) {
                sea += 1;
                expect(field[k]).toBe(0);
            }
        }
        expect(sea).toBeGreaterThan(0);
        expect((classes[Math.floor((1024 - 300) / 8) * N + Math.floor(300 / 8)] as number) & SEA).toBe(0);
        expect(at(300, 300)).toBeGreaterThan(0);
    });

    it("gibt jedem See genau einen Spiegel", () => {
        const levels = new Set<number>();
        for (let k = 0; k < field.length; k += 1) if ((classes[k] as number) & LAKE) levels.add(field[k] as number);
        expect(levels.size).toBe(1);
    });

    it("lässt bekannte Flüsse im Flachland nie bergauf laufen", () => {
        let steps = 0;
        for (const chain of result.chains) {
            for (let i = 0; i + 1 < chain.cells.length; i += 1) {
                const a = chain.cells[i] as number;
                const b = chain.cells[i + 1] as number;
                if (((classes[a] as number) | (classes[b] as number)) & (SEA | LAKE | MOUNTAIN)) continue;
                steps += 1;
                expect(field[b] as number).toBeLessThanOrEqual((field[a] as number) + 1e-3);
            }
        }
        expect(steps).toBeGreaterThan(10);
    });

    it("trägt im Gebirge das echte Gelände auf einem glatten Sockel", () => {
        expect(result.stats.mountainCells).toBeGreaterThan(50);
        // Gipfel gegen Fuß: der Unterschied ist der des Geländes, der Sockel trägt wenig bei.
        const rise = at(650, 650) - at(650, 614);
        expect(rise).toBeGreaterThan(2400);
        expect(rise).toBeLessThan(3200);
    });

    it("ist bei gleicher Eingabe bytegleich", () => {
        const again = generateVisualRelief(world(), N);
        expect(Buffer.from(again.field.buffer).equals(Buffer.from(field.buffer))).toBe(true);
    });
});

describe("Stärke je Landschaft (Generator 3)", () => {
    const polygon = (x0: number, y0: number, x1: number, y1: number): LandscapeArea["geometry"] => ({
        type: "Polygon",
        coordinates: square(x0, y0, x1, y1),
    });
    const desert: LandscapeArea = { layer: "vegetation", type: "wueste", area: 0, geometry: polygon(0, 0, 512, 1024) };
    const hills: LandscapeArea = {
        layer: "topographie",
        type: "huegelland",
        area: 0,
        geometry: polygon(512, 0, 1024, 1024),
    };
    const { landscapeStrength: table } = VISUAL_RELIEF_PARAMS;

    it("geht an der Grenze weich über, statt zu springen", () => {
        const g = grid(1024);
        const { m, values } = landscapeStrength(g, new Uint8Array(1024 * 1024), [desert, hills], VISUAL_RELIEF_PARAMS);
        const row = 512 * m;
        expect(values[row + 100]).toBeCloseTo(table.wueste as number, 5);
        expect(values[row + 900]).toBeCloseTo(table.huegelland as number, 5);
        let step = 0;
        for (let x = 1; x < m; x += 1)
            step = Math.max(step, Math.abs((values[row + x] as number) - (values[row + x - 1] as number)));
        // Hart wären es 0,85 auf einer Zelle; der Übergang verteilt sie über rund 20 E.
        expect(step).toBeLessThan(0.12);
        expect(step).toBeGreaterThan(0.02);
    });

    it("lässt das Meer die Küste nicht herunterziehen", () => {
        const g = grid(1024);
        const classes = new Uint8Array(1024 * 1024);
        for (let y = 0; y < 1024; y += 1) for (let x = 0; x < 100; x += 1) classes[y * 1024 + x] = SEA;
        const { values } = landscapeStrength(g, classes, [desert, hills], VISUAL_RELIEF_PARAMS);
        expect(values[512 * 1024 + 100]).toBeCloseTo(table.wueste as number, 5);
    });

    it("nimmt die Landform vor der Vegetation, die kleinere Fläche vor der größeren, die Insel zuletzt", () => {
        const island: LandscapeArea = { layer: "topographie", type: "insel", area: 50, geometry: polygon(0, 0, 1, 1) };
        const forest: LandscapeArea = { layer: "vegetation", type: "wald", area: 10, geometry: polygon(0, 0, 1, 1) };
        const valley: LandscapeArea = { layer: "topographie", type: "tal", area: 5, geometry: polygon(0, 0, 1, 1) };
        const upland: LandscapeArea = {
            layer: "topographie",
            type: "huegelland",
            area: 90,
            geometry: polygon(0, 0, 1, 1),
        };
        // Gemalt wird in dieser Folge, die spätere Fläche gewinnt.
        expect(paintOrder([valley, forest, upland, island]).map((a) => a.type)).toEqual([
            "insel",
            "wald",
            "huegelland",
            "tal",
        ]);
    });

    it("macht die Wüste flacher als das Hügelland", () => {
        const input = world();
        const left: LandscapeArea = { ...desert, geometry: polygon(230, 250, 430, 450) };
        const right: LandscapeArea = { ...hills, geometry: polygon(560, 230, 800, 430) };
        const { field: relief, classes: cls } = generateVisualRelief({ ...input, landscapes: [left, right] }, N);
        const cell = 1024 / N;
        const roughness = (x0: number, y0: number, x1: number, y1: number): number => {
            let sum = 0;
            let count = 0;
            for (let gy = Math.ceil((1024 - y1) / cell); gy < Math.floor((1024 - y0) / cell); gy += 1) {
                for (let gx = Math.ceil(x0 / cell); gx < Math.floor(x1 / cell); gx += 1) {
                    const k = gy * N + gx;
                    if (((cls[k] as number) | (cls[k + 1] as number)) & (SEA | LAKE | MOUNTAIN)) continue;
                    sum += Math.abs((relief[k + 1] as number) - (relief[k] as number));
                    count += 1;
                }
            }
            return sum / count;
        };
        // Innen, mit Abstand zum Übergang.
        const flat = roughness(260, 280, 400, 420);
        const hilly = roughness(590, 260, 770, 400);
        expect(hilly / flat).toBeGreaterThan(3);
    });
});

describe("Kodierung der Kacheln", () => {
    const raster = {
        cell: 0.25,
        originX: 510,
        originY: 510,
        width: 5,
        height: 5,
        samples: new Uint16Array(25).fill(3000),
    };
    const peaks = [
        { x: 512.06, y: 511.94, h: 4000 },
        { x: 300.3, y: 700.7, h: 1500 },
    ];

    it(
        "bleibt für das Gelände ohne Angabe bytegleich (Revision seit WI-0142, auf einen Schritt gerundet)",
        () => {
            // Die Stufen dürfen das Gelände nicht ändern. Neu gepinnt mit der Rundung auf einen Schritt (WI-0142,
            // DEM_TILE_VERSION 6); davor d9dfa4655d2d mit voller Zehntelmeter-Kodierung (WI-0073, WebP), davor
            // 7bf28bc14098 mit PNG und z4 (WI-0070), davor e2c5427a0f82 mit z3, gerechnet mit dem Code vor WI-0054.
            expect(demRevision(demTiles(composeDem([raster], peaks, LEGACY_CONE)))).toBe("afb73b20812e");
        },
        GELAENDE_FRIST_MS,
    );

    it(
        "🔴 die Rundung auf einen Schritt spart Bytes, ohne das Gelände zu verstellen (WI-0142)",
        () => {
            const dem = composeDem([raster], peaks, LEGACY_CONE);
            const roh = demTiles(dem, { quantMeters: 0 }).reduce((summe, kachel) => summe + kachel.image.length, 0);
            const gerundet = demTiles(dem).reduce((summe, kachel) => summe + kachel.image.length, 0);
            // 🪤 Nur die Richtung: Dieses Prüfgelände ist ein glatter Kegel und spart damit knapp 2 %. Was die Rundung
            // wirklich bringt, zeigt echtes Gelände - an vier Gebirgskacheln des 8k-Stands waren es 61 % der rohen Bytes
            // (WI-0142). Ein Rückfall auf die rohe Kodierung fällt hier trotzdem auf.
            expect(gerundet, "kleiner als ohne Rundung").toBeLessThan(roh);

            // Die Höhe bleibt im Rahmen eines Schritts.
            // 🪤 Gerundet wird in Render-Metern, und der Ausgleich der Breite (cos) macht ein Raster dort etwas mehr als
            // einen Schritt; die halbe Schrittweite liegt deshalb knapp über 0,5. Auf der groben Stufe 0 kommt die
            // Mittelung von 256 Werten je Pixel dazu.
            const stufen = decodeDemTile(demTiles(dem).find((kachel) => kachel.z === 0)?.image as Buffer, 0, 0);
            const stufenRoh = decodeDemTile(
                demTiles(dem, { quantMeters: 0 }).find((kachel) => kachel.z === 0)?.image as Buffer,
                0,
                0,
            );
            let groessteAbweichung = 0;
            for (let i = 0; i < stufen.length; i += 1) {
                groessteAbweichung = Math.max(groessteAbweichung, Math.abs((stufen[i] ?? 0) - (stufenRoh[i] ?? 0)));
            }
            expect(groessteAbweichung, "höchstens ein Schritt").toBeLessThanOrEqual(1);
        },
        GELAENDE_FRIST_MS,
    );

    it(
        "liest sich mit Stufen zurück, monoton",
        () => {
            const dem = composeDem([raster], peaks, LEGACY_CONE);
            const tiles = demTiles(dem, { quantMeters: 5 });
            const size = DEM_TILE_SIZE << DEM_MAX_ZOOM;
            const gx = Math.floor(512.06 / (1024 / size));
            const gy = Math.floor((1024 - 511.94) / (1024 / size));
            const tile = tiles.find(
                (t) =>
                    t.z === DEM_MAX_ZOOM &&
                    t.x === Math.floor(gx / DEM_TILE_SIZE) &&
                    t.y === Math.floor(gy / DEM_TILE_SIZE),
            );
            const heights = decodeDemTile(tile?.image as Buffer, DEM_MAX_ZOOM, tile?.y ?? 0);
            const value = heights[(gy % DEM_TILE_SIZE) * DEM_TILE_SIZE + (gx % DEM_TILE_SIZE)] as number;
            // 5 Render-Meter sind hier weniger als ein halber Schritt.
            expect(Math.abs(value - (dem[gy * size + gx] as number))).toBeLessThan(0.5);
        },
        GELAENDE_FRIST_MS,
    );
});

describe("Isolation", () => {
    // 🔴 Das Relief ist keine Höhe: Routing, Steigung, Flug und das Gelände dürfen es nicht lesen.
    const root = join(import.meta.dirname, "..", "src");
    function files(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
                ? files(join(dir, entry.name))
                : entry.name.endsWith(".ts")
                  ? [join(dir, entry.name)]
                  : [],
        );
    }

    it("hat nach dem Domain-Cutover keine produktiven Leser mehr", () => {
        const readers = files(root)
            .filter((file) => !file.includes(join("terrain", "visual-relief")))
            .filter((file) => /visual-relief|terrain_visual_relief/.test(readFileSync(file, "utf8")))
            .map((file) => file.slice(root.length + 1));
        // app.ts meldet nur die Kachelroute an.
        expect(readers).toEqual([]);
    });
});

describe("Täler", () => {
    it("🔴 ein tieferer Nachbarfluss zieht eine Flusszelle nicht hinab (sonst stiege der Lauf wieder an)", () => {
        // Regression WI-0054 V5: Zwei Läufe eine Zelle nebeneinander, gegenläufig. Vorher stempelte der
        // tiefere Lauf B seinen Hang auch auf die Zellen von A, und A lief 385-mal bergauf (bis 236 Schritt).
        const g = grid(64);
        const n = g.n;
        const h = new Float32Array(n * n).fill(200);
        const a: number[] = [];
        const b: number[] = [];
        for (let x = 5; x <= 30; x += 1) {
            a.push(10 * n + x);
            h[10 * n + x] = 100 - 2 * (x - 5);
        }
        for (let x = 30; x >= 5; x -= 1) {
            b.push(11 * n + x);
            h[11 * n + x] = 10 + 2 * (x - 5);
        }
        const chains: RiverChain[] = [
            { cells: Int32Array.from(a), bach: false },
            { cells: Int32Array.from(b), bach: false },
        ];
        const depth = chains.map((chain) => new Float32Array(chain.cells.length));
        carveValleys(g, h, new Float32Array(n * n), new Uint8Array(n * n), chains, depth, {
            ...VISUAL_RELIEF_PARAMS,
            valleyWidth: 40,
        });
        for (const chain of chains) {
            for (let i = 0; i + 1 < chain.cells.length; i += 1) {
                expect(h[chain.cells[i + 1] as number] as number).toBeLessThanOrEqual(
                    h[chain.cells[i] as number] as number,
                );
            }
        }
    });

    it("🔴 gleicht die Böden an, bis nichts mehr fällt, auch über viele Zusammenflüsse", () => {
        // Regression WI-0054 Generator 3: Vier feste Durchgänge reichten auf der echten Karte nicht mehr (ein Lauf
        // 12,8 Schritt bergauf). Hier sechs Läufe hintereinander, der unterste zuerst gelistet: Jeder
        // Durchgang reicht den tiefen Boden des obersten nur einen Lauf weiter.
        const g = grid(64);
        const n = g.n;
        const h = new Float32Array(n * n).fill(200);
        for (let x = 0; x < n; x += 1) h[10 * n + x] = 100 - x;
        const chains: RiverChain[] = [];
        for (let level = 0; level < 6; level += 1) {
            const start = 5 + 2 * (5 - level);
            chains.push({ cells: Int32Array.from([0, 1, 2], (i) => 10 * n + start + i), bach: false });
        }
        const depth = chains.map((chain, c) => new Float32Array(chain.cells.length).fill(c === 5 ? 500 : 0));
        carveValleys(g, h, new Float32Array(n * n), new Uint8Array(n * n), chains, depth, VISUAL_RELIEF_PARAMS);
        for (const chain of chains) {
            for (let i = 0; i + 1 < chain.cells.length; i += 1) {
                expect(h[chain.cells[i + 1] as number] as number).toBeLessThanOrEqual(
                    h[chain.cells[i] as number] as number,
                );
            }
        }
    });
});
