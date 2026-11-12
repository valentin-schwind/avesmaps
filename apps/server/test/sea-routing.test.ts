import { describe, expect, it } from "vitest";
import type { RouteLink } from "../src/routing/network.ts";
import {
    buildSeaGrid,
    cellAt,
    nearestWaterCell,
    prepareNavigableWater,
    type NavigableWater,
    type WaterRegionType,
} from "../src/routing/sea-grid.ts";
import { describeLandless, landlessPort } from "../src/routing/sea-landless.ts";
import { distanceToWater, judgeLanding, seawayEntries, type SeaPort } from "../src/routing/sea-ports.ts";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { coastDistance, coastFactor, coastProfile, smoothSeaLine } from "../src/routing/sea-coast.ts";
import {
    clearOnMask,
    compactSeaGraph,
    decodeSeaGraph,
    encodeSeaGraph,
    seaGraphRoute,
    waterMask,
    type SeaGraphPort,
} from "../src/routing/sea-graph-store.ts";
import { JumpPointSearch } from "../src/routing/sea-jps.ts";
import { clearOverWater, SeaSearch } from "../src/routing/sea-search.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";

/**
 * Das freie Seerouting neben den Seewegen (WI-0046, erster Schritt): Wasserraster, Anlegestelle nach H1,
 * A* über Wasser und das Urteil, wo die Regel ins falsche Wasser trifft.
 */

type Ring = [number, number][];
const box = (minX: number, minY: number, maxX: number, maxY: number): Ring => [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
];

function waters(...areas: { rings: Ring[]; type?: WaterRegionType; name?: string }[]): NavigableWater {
    return prepareNavigableWater(
        areas.map((area, index) => {
            const points = area.rings.flat();
            return {
                geometry: { type: "Polygon", coordinates: area.rings },
                minX: Math.min(...points.map(([x]) => x)),
                minY: Math.min(...points.map(([, y]) => y)),
                maxX: Math.max(...points.map(([x]) => x)),
                maxY: Math.max(...points.map(([, y]) => y)),
                regionName: area.name ?? `Wasser ${String(index)}`,
                regionType: area.type ?? "meer",
                areaPublicId: String(index),
            };
        }),
    );
}

const seaway = (id: string, from: string, to: string, coordinates: [number, number][]): RouteLink => ({
    id: `${id}#0`,
    pathPublicId: id,
    pathName: id,
    subtype: "Seeweg",
    from,
    to,
    coordinates,
    distance: 0,
    allowedTransports: null,
    transportDomain: null,
    flow: null,
});

describe("Wasserraster", () => {
    it("zählt eine Zelle, deren Mitte im Wasser liegt, und lässt die Insel aus", () => {
        // Ein Meer 0..20 mit einer Insel 8..12 als Loch.
        const grid = buildSeaGrid(waters({ rings: [box(0, 0, 20, 20), box(8, 8, 12, 12)] }), 1);
        expect(grid.water[cellAt(grid, 2.5, 2.5)]).toBe(1);
        expect(grid.water[cellAt(grid, 10.5, 10.5)]).toBe(0);
        expect(grid.partCells.length - 1).toBe(1);
    });

    it("trennt zwei Seen und eine getrennt gezeichnete Durchfahrt, die schmaler ist als eine Zelle", () => {
        // Zwei Becken, verbunden durch einen Kanal von 0,3 Einheiten Breite zwischen den Zellmitten, jedes eine eigene Fläche:
        // Die Engstellen verbinden nur innerhalb einer Fläche.
        const grid = buildSeaGrid(
            waters({ rings: [box(0, 0, 10, 10)] }, { rings: [box(20, 0, 30, 10)] }, { rings: [box(10, 4.1, 20, 4.4)] }),
            1,
        );
        expect(grid.part[cellAt(grid, 5, 5)]).not.toBe(grid.part[cellAt(grid, 25, 5)]);
        // Mit einem Kanal über eine ganze Zellreihe hängen sie zusammen.
        const wide = buildSeaGrid(
            waters({ rings: [box(0, 0, 10, 10)] }, { rings: [box(20, 0, 30, 10)] }, { rings: [box(10, 4, 20, 5.2)] }),
            1,
        );
        expect(wide.part[cellAt(wide, 5, 5)]).toBe(wide.part[cellAt(wide, 25, 5)]);
    });

    // Ein Fjord als Teil des Meeres (Handover fjordhaefen 2026-11-09, Orvil): EIN Polygon aus Meer 0..10, einer Einfahrt
    // von 0,3 E zwischen den Zellmitten, 6 E lang, und dem Becken 16..26.
    const fjord = waters({
        rings: [
            [
                [0, 0],
                [10, 0],
                [10, 4.1],
                [16, 4.1],
                [16, 0],
                [26, 0],
                [26, 10],
                [16, 10],
                [16, 4.4],
                [10, 4.4],
                [10, 10],
                [0, 10],
                [0, 0],
            ],
        ],
    });

    it("verbindet eine Fläche durch ihre Engstelle: der Fjord hängt am Meer", () => {
        const before = buildSeaGrid(fjord, 1, { narrows: false });
        expect(before.part[cellAt(before, 5, 5)]).not.toBe(before.part[cellAt(before, 21, 5)]);
        const grid = buildSeaGrid(fjord, 1);
        expect(grid.part[cellAt(grid, 5, 5)]).toBe(grid.part[cellAt(grid, 21, 5)]);
        expect(grid.partCells.length - 1).toBe(1);
        // Befahrbar wird die eine Zellreihe, in der die Einfahrt liegt, nicht mehr.
        expect(grid.narrows).toEqual({ joined: 1, cells: 6, unresolved: 0 });
        for (let x = 10.5; x < 16; x += 1) expect(grid.water[cellAt(grid, x, 4.5)]).toBe(1);
        expect(grid.water[cellAt(grid, 13.5, 3.5)]).toBe(0);
        expect(grid.water[cellAt(grid, 13.5, 5.5)]).toBe(0);
        expect(new SeaSearch(grid).find(cellAt(grid, 5.5, 5.5), cellAt(grid, 21.5, 5.5))).not.toBeNull();
    });

    it("gibt einem Hafen im Fjord die Anlegestelle im Meer, nicht im abgetrennten Becken", () => {
        const grid = buildSeaGrid(fjord, 1);
        const landing = nearestWaterCell(grid, 21, 11, 3, 10);
        expect(landing?.part).toBe(grid.part[cellAt(grid, 5, 5)]);
        // Ohne Engstellen ist das Becken (100 Zellen) groß genug für die Anlegestelle, aber vom Meer getrennt.
        const before = buildSeaGrid(fjord, 1, { narrows: false });
        expect(nearestWaterCell(before, 21, 11, 3, 10)?.part).not.toBe(before.part[cellAt(before, 5, 5)]);
    });

    it("verbindet zwei Wasser nicht über eine Ecke", () => {
        const grid = buildSeaGrid(waters({ rings: [box(0, 0, 5, 5)] }, { rings: [box(5, 5, 10, 10)] }), 1);
        const a = cellAt(grid, 4.5, 4.5);
        const b = cellAt(grid, 5.5, 5.5);
        expect(grid.part[a]).not.toBe(grid.part[b]);
        expect(new SeaSearch(grid).find(a, b)).toBeNull();
    });
});

describe("Anlegestelle nach H1", () => {
    const grid = buildSeaGrid(waters({ rings: [box(0, 0, 10, 10)] }), 0.5);

    it("ist die nächste befahrbare Zelle, höchstens drei Einheiten entfernt", () => {
        const landing = nearestWaterCell(grid, 12, 5);
        expect(landing).not.toBeNull();
        expect(landing?.x).toBeCloseTo(9.75);
        expect(landing?.y).toBeCloseTo(4.75);
        expect(nearestWaterCell(grid, 13.5, 5)).toBeNull();
    });

    it("misst den Abstand zum gezeichneten Wasser, nicht zum Raster", () => {
        const water = waters({ rings: [box(0, 0, 10, 10)] });
        expect(distanceToWater(water, 5, 5)).toBe(0);
        expect(distanceToWater(water, 12, 5)).toBeCloseTo(2);
        expect(distanceToWater(water, 80, 5)).toBe(Infinity);
    });
});

describe("Häfen ohne Anlegestelle und ihr Grund (WI-0060)", () => {
    // Ein Meer, davor ein Streifen Meer schmaler als eine Zelle, weiter weg ein See unter der Mindestfläche (9 Zellen, 2,25 E²).
    const water = waters(
        { rings: [box(0, 0, 10, 10)] },
        { rings: [box(14, 2.3, 22, 2.45)] },
        { rings: [box(30, 0, 31.5, 1.5)], type: "see" },
    );
    const grid = buildSeaGrid(water, 0.5);
    const settings = { cell: 0.5, minArea: 10 };
    const port = (name: string, x: number, y: number): SeaPort => ({ id: name.toLowerCase(), name, x, y });

    it("findet für alle vier keine Anlegestelle mit der Mindestfläche, für den am See aber ohne sie", () => {
        for (const [x, y] of [
            [33, 0.75],
            [16, 2.9],
            [14, 7],
            [95, 5],
        ] as const) {
            expect(nearestWaterCell(grid, x, y, 3, 10)).toBeNull();
        }
        expect(nearestWaterCell(grid, 33, 0.75, 3, 0)).not.toBeNull();
    });

    it("nennt das zu kleine Gewässer mit dem Abstand zu seiner nächsten Zelle", () => {
        const klein = landlessPort(grid, water, port("Klein", 33, 0.75));
        expect(klein).toMatchObject({ id: "klein", name: "Klein", reason: "gewaesser_zu_klein" });
        expect(klein.distance).toBeCloseTo(1.75);
        expect(describeLandless(klein, settings)).toBe(
            "Gewässer zu klein: befahrbares Wasser 1,8 E entfernt, aber nur ein abgetrenntes Stück unter 10 E²",
        );
    });

    it("nennt Wasser, das schmaler ist als eine Zelle, mit dem Abstand zum gezeichneten Wasser", () => {
        const schmal = landlessPort(grid, water, port("Schmal", 16, 2.9));
        expect(schmal.reason).toBe("wasser_zu_schmal");
        expect(schmal.distance).toBeCloseTo(0.45);
        expect(describeLandless(schmal, settings)).toMatch(
            /^Wasser zu schmal: Meer oder See 0,[45] E entfernt, aber schmaler als das Raster der Seefahrt \(0,5 E\)$/,
        );
    });

    it("nennt fernes Wasser mit Abstand, und ohne Wasser in 50 E nur das", () => {
        const fern = landlessPort(grid, water, port("Fern", 14, 7));
        expect(fern.reason).toBe("wasser_fern");
        expect(fern.distance).toBeCloseTo(4);
        expect(describeLandless(fern, settings)).toBe("kein Meer und kein See in 3 E, das nächste 4,0 E entfernt");
        const weit = landlessPort(grid, water, port("Weit", 95, 5));
        expect(weit).toMatchObject({ reason: "wasser_fern", distance: null });
        expect(describeLandless(weit, settings)).toBe("kein Meer und kein See in 50 E");
    });

    it("sagt bei einem Eintrag ohne Grund (Seegraph vor WI-0060), dass er fehlt", () => {
        expect(describeLandless({ id: "alt", name: "Alt" }, settings)).toBe("Grund nicht gespeichert");
    });
});

describe("Suche über Wasser", () => {
    it("fährt um eine Insel herum, nie über sie, und zieht die Linie straff", () => {
        const grid = buildSeaGrid(waters({ rings: [box(0, 0, 30, 20), box(10, 2, 20, 18)] }), 0.5);
        const search = new SeaSearch(grid);
        const route = search.find(cellAt(grid, 5, 10), cellAt(grid, 25, 10));
        expect(route).not.toBeNull();
        const points = route?.points ?? [];
        for (let index = 1; index < points.length; index += 1) {
            const [ax, ay] = points[index - 1] as [number, number];
            const [bx, by] = points[index] as [number, number];
            expect(clearOverWater(grid, ax, ay, bx, by)).toBe(true);
        }
        // Um die Insel an einer Längsseite entlang: mindestens 2 · √(5² + 8²) + 10 ≈ 28,9; gerade wären es 20.
        const around = 2 * Math.hypot(5, 8) + 10;
        expect(route?.distance).toBeGreaterThan(around);
        expect(route?.distance).toBeLessThan(around * 1.03);
        expect(points.length).toBeLessThan(8);
    });

    it("geht über offenes Wasser gerade", () => {
        const grid = buildSeaGrid(waters({ rings: [box(0, 0, 40, 40)] }), 0.5);
        const route = new SeaSearch(grid).find(cellAt(grid, 2, 3), cellAt(grid, 37, 31));
        expect(route?.points).toHaveLength(2);
        expect(route?.distance).toBeCloseTo(Math.hypot(35, 28), 5);
    });

    it("bricht ab, wenn jeder Weg länger wäre als erlaubt, und rechnet danach wieder richtig", () => {
        const grid = buildSeaGrid(waters({ rings: [box(0, 0, 30, 20), box(10, 2, 20, 18)] }), 0.5);
        const search = new SeaSearch(grid);
        expect(search.find(cellAt(grid, 5, 10), cellAt(grid, 25, 10), 15)).toBeNull();
        expect(search.find(cellAt(grid, 5, 10), cellAt(grid, 25, 10))?.distance).toBeGreaterThan(18);
    });
});

describe("Urteil über die Anlegestelle", () => {
    // Ein See links vom Hafen, näher als das Meer rechts von ihm. Sein Seeweg führt ins Meer.
    const water = waters(
        { rings: [box(0, 0, 9, 10)], type: "see", name: "See" },
        { rings: [box(11.5, -20, 40, 30)], name: "Meer" },
    );
    const grid = buildSeaGrid(water, 0.5);
    const search = new SeaSearch(grid);
    const port: SeaPort = { id: "hafen", name: "Hafen", x: 10, y: 5 };

    it("nimmt die Regel, wo der Seeweg ins selbe Wasser führt", () => {
        const links = [
            seaway("west", "hafen", "fern", [
                [10, 5],
                [5, 5],
                [2, 2],
            ]),
        ];
        const judgement = judgeLanding(grid, search, port, links);
        expect(judgement.verdict).toBe("regel");
        expect(judgement.rule?.part).toBe(grid.part[cellAt(grid, 5, 5)]);
    });

    it("schlägt den Eintritt des Seewegs vor, wo die Regel den See trifft", () => {
        const links = [
            seaway("ost", "hafen", "fern", [
                [10, 5],
                [15, 5],
                [30, 5],
            ]),
        ];
        const judgement = judgeLanding(grid, search, port, links);
        expect(judgement.verdict).toBe("anderes_wasser");
        expect(judgement.proposed?.part).toBe(grid.part[cellAt(grid, 20, 5)]);
        expect(judgement.proposed?.x).toBeGreaterThanOrEqual(11.5);
    });

    it("liest einen Seeweg vom Hafen aus, auch wenn er rückwärts gespeichert ist", () => {
        const links = [
            seaway("ost", "fern", "hafen", [
                [30, 5],
                [15, 5],
                [10, 5],
            ]),
        ];
        const { entries } = seawayEntries(grid, "hafen", links);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.x).toBeLessThan(12.5);
    });

    it("nennt Seewege in zwei Gewässer mehrdeutig", () => {
        const links = [
            seaway("west", "hafen", "a", [
                [10, 5],
                [5, 5],
            ]),
            seaway("ost", "hafen", "b", [
                [10, 5],
                [20, 5],
            ]),
        ];
        expect(judgeLanding(grid, search, port, links).verdict).toBe("mehrdeutig");
    });

    it("kennt Häfen ohne Seeweg und Häfen fern vom Wasser", () => {
        expect(judgeLanding(grid, search, port, []).verdict).toBe("ohne_seeweg");
        expect(judgeLanding(grid, search, { ...port, id: "binnen", y: 60 }, []).verdict).toBe("fern");
    });
});

describe("Benchmark-Verfahren: Jump Point Search und Sichtbarkeitsgraph", () => {
    // Meer 0..30 × 0..20 mit einer Insel 10..20 × 2..18: um sie herum mindestens 2 · √(5² + 8²) + 10.
    const water = waters({ rings: [box(0, 0, 30, 20), box(10, 2, 20, 18)] });
    const grid = buildSeaGrid(water, 0.5);
    const around = 2 * Math.hypot(5, 8) + 10;
    const clear = (points: readonly [number, number][]): boolean =>
        points.every((point, index) => {
            const previous = points[index - 1];
            return !previous || clearOverWater(grid, previous[0], previous[1], point[0], point[1]);
        });

    it("JPS findet denselben Weg wie A*, über Wasser", () => {
        const from = cellAt(grid, 5, 10);
        const to = cellAt(grid, 25, 10);
        const jump = new JumpPointSearch(grid).find(from, to);
        const astar = new SeaSearch(grid).find(from, to);
        expect(jump).not.toBeNull();
        expect(clear(jump?.points ?? [])).toBe(true);
        expect(jump?.distance).toBeGreaterThan(around);
        expect(Math.abs((jump?.distance ?? 0) - (astar?.distance ?? 0))).toBeLessThan(0.5);
        expect(new JumpPointSearch(grid).find(cellAt(grid, 2, 3), cellAt(grid, 8, 17))?.points).toHaveLength(2);
    });

    it("der Sichtbarkeitsgraph fährt über die Ecken der Insel, auch zu einem später angehängten Hafen", () => {
        // Wasser liegt links: der Außenring gegen, die Insel im Uhrzeigersinn.
        const graph = new VisibilityGraph(grid, [
            [
                [0, 0],
                [30, 0],
                [30, 20],
                [0, 20],
            ],
            [
                [10, 2],
                [10, 18],
                [20, 18],
                [20, 2],
            ],
        ]);
        expect(graph.stats.corners).toBe(4);
        const west = graph.attach(5.25, 10.25);
        const east = graph.attach(25.25, 10.25);
        const route = graph.route(west, east);
        expect(route).not.toBeNull();
        expect(clear(route?.points ?? [])).toBe(true);
        expect(route?.distance).toBeGreaterThan(around);
        expect(route?.distance).toBeLessThan(around * 1.03);
        // Ein neuer Hafen braucht keinen Neubau; der Weg dorthin führt über die Nordwestecke der Insel.
        const north = graph.attach(15.25, 19.25);
        const toNorth = graph.route(west, north)?.distance ?? Infinity;
        expect(toNorth).toBeGreaterThan(Math.hypot(4.75, 7.75) + Math.hypot(5.25, 1.25));
        expect(toNorth).toBeLessThan(15.5);
    });
});

describe("Küstenfahrt je Schiffstyp und Glättung (S7)", () => {
    // Ein Meer 0..40 × 0..20 mit einer kleinen Insel an der Südküste: Ihre Ecken sind der Umweg entlang der Küste.
    const water = waters({ rings: [box(0, 0, 40, 20), box(19, 2, 21, 3)] });
    const grid = buildSeaGrid(water, 0.5);
    const field = coastDistance(grid);
    const galley = coastProfile(AVENTURIA_TRAVEL_MODEL, "galley");
    const fast = coastProfile(AVENTURIA_TRAVEL_MODEL, "fastShip");

    it("kostet nichts im bevorzugten Abstand und mehr zu nah oder zu weit draußen", () => {
        expect(coastFactor(galley, (galley.near + galley.far) / 2)).toBe(1);
        expect(coastFactor(galley, 0)).toBeCloseTo(1 + galley.nearPenalty);
        expect(coastFactor(galley, 2 * galley.far)).toBeCloseTo(1 + galley.farPenalty);
    });

    it("misst den Abstand zur Küste je Zelle", () => {
        expect(field[cellAt(grid, 10.25, 10.25)]).toBeCloseTo(10, 0);
        expect(field[cellAt(grid, 0.25, 10.25)]).toBeLessThan(1);
    });

    it("lässt die Galeere an der Küste entlang fahren und den Schnellsegler geradeaus", () => {
        const graph = new VisibilityGraph(grid, [
            [
                [0, 0],
                [40, 0],
                [40, 20],
                [0, 20],
            ],
            [
                [19, 2],
                [19, 3],
                [21, 3],
                [21, 2],
            ],
        ]);
        graph.weigh([galley, fast], field);
        const west = graph.attach(1.25, 10.25);
        const east = graph.attach(38.75, 10.25);
        const byGalley = graph.route(west, east, 0);
        const byFast = graph.route(west, east, 1);
        expect(byFast?.distance).toBeCloseTo(37.5, 1);
        expect(byGalley?.distance).toBeGreaterThan((byFast?.distance ?? 0) + 1);
    });

    it("glättet ohne harte Ecken, lässt die Enden stehen und bleibt über Wasser", () => {
        const raw: [number, number][] = [
            [1, 10],
            [2, 10],
            [20, 4],
            [38, 10],
            [39, 10],
        ];
        const { points } = smoothSeaLine((ax, ay, bx, by) => clearOverWater(grid, ax, ay, bx, by), raw);
        expect(points[0]).toEqual([1, 10]);
        expect(points[points.length - 1]).toEqual([39, 10]);
        const turn = (a: [number, number], b: [number, number], c: [number, number]): number => {
            const first = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const second = Math.atan2(c[1] - b[1], c[0] - b[0]);
            return Math.abs(((second - first + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        };
        for (let index = 2; index < points.length; index += 1) {
            expect(
                turn(
                    points[index - 2] as [number, number],
                    points[index - 1] as [number, number],
                    points[index] as [number, number],
                ),
            ).toBeLessThan(0.35);
        }
        for (let index = 1; index < points.length; index += 1) {
            const [ax, ay] = points[index - 1] as [number, number];
            const [bx, by] = points[index] as [number, number];
            expect(clearOverWater(grid, ax, ay, bx, by)).toBe(true);
        }
    });
});

describe("Seegraph im Speicher des Workers (sea-graph-store)", () => {
    const water = waters({ rings: [box(0, 0, 40, 20), box(19, 2, 21, 3)] });
    const grid = buildSeaGrid(water, 0.5);
    const profiles = [coastProfile(AVENTURIA_TRAVEL_MODEL, "galley"), coastProfile(AVENTURIA_TRAVEL_MODEL, "fastShip")];
    const build = (): { graph: VisibilityGraph; ports: SeaGraphPort[] } => {
        const graph = new VisibilityGraph(grid, [
            [
                [0, 0],
                [40, 0],
                [40, 20],
                [0, 20],
            ],
            [
                [19, 2],
                [19, 3],
                [21, 3],
                [21, 2],
            ],
        ]);
        graph.weigh(profiles, coastDistance(grid));
        const ports = [
            { placeId: "west", node: graph.attach(1.25, 10.25) },
            { placeId: "ost", node: graph.attach(38.75, 10.25) },
        ];
        return { graph, ports };
    };

    it("übersteht Schreiben und Lesen und rechnet dieselben Wege wie der Sichtbarkeitsgraph", () => {
        const { graph, ports } = build();
        const compact = decodeSeaGraph(
            encodeSeaGraph(compactSeaGraph(graph.snapshot(), ["galley", "fastShip"], ports, waterMask(grid))),
        );
        expect(compact.ports).toEqual(ports);
        for (const transport of [0, 1]) {
            const expected = graph.route((ports[0] as SeaGraphPort).node, (ports[1] as SeaGraphPort).node, transport);
            const stored = (compact.pairs[transport] as Float32Array)[0 * 2 + 1] as number;
            expect(stored).toBeCloseTo(expected?.distance ?? Number.NaN, 1);
            const route = seaGraphRoute(compact, 0, 1, transport);
            expect(route?.distance).toBeCloseTo(stored, 3);
            for (let index = 1; index < (route?.points.length ?? 0); index += 1) {
                const [ax, ay] = route?.points[index - 1] as [number, number];
                const [bx, by] = route?.points[index] as [number, number];
                expect(clearOnMask(compact.mask, ax, ay, bx, by)).toBe(true);
            }
        }
        // Die Galeere folgt der Küste, der Schnellsegler fährt gerade.
        expect((compact.pairs[0] as Float32Array)[1] as number).toBeGreaterThan(
            ((compact.pairs[1] as Float32Array)[1] as number) + 1,
        );
    });

    it("liest die Wassermaske wie das Raster", () => {
        const mask = waterMask(grid);
        expect(clearOnMask(mask, 2, 10, 38, 10)).toBe(true);
        expect(clearOnMask(mask, 20, 1, 20, 4)).toBe(false);
    });
});
