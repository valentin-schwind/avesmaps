import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, mapPointId, parseMapPointId } from "@avesmaps3d/shared";
import { pointIsOnLand } from "../src/routing/land.ts";
import {
    chordIsDry,
    directEdgeAllowed,
    exitCandidates,
    exitReach,
    firstRoadEntry,
    landPathExits,
    nearestExitNodes,
    offroadCost,
    offroadPathBetween,
    offroadRamp,
    offroadTransport,
    roadLines,
} from "../src/routing/map-points.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND, prepareGround } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { chordCrossesRivers, fordFactor, NO_RIVERS, prepareRivers, type RiverRow } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type OffroadTerrain, type RouteRequest } from "../src/routing/router.ts";
import { RouteService } from "../src/routing/service.ts";
import { revisionOf } from "./support/routing-revision.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Der Gang zu einem Kartenpunkt (WI-0030, Legacys „Hierher reisen“, `offroad-leg.php`,
 * avesmaps@770c80e): Landprüfung, die vier Absagen, der nächste erreichbare Ausstieg, der Gang um
 * Wasser und Flüsse (R7), Bäche als Furt, der Längenaufschlag und die Gerade zwischen zwei
 * Kartenpunkten. Raster und Suche selbst prüft `offroad-search.test.ts`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
/** Querfeldein zu Fuß (WdE S. 160–162, WI-0258) und Stunden je Zeiteinheit (3 Meilen × 1,19). */
const QUERFELDEIN = 3.1237;
const STUNDEN_JE_ZEIT = 3 * 1.19;

function quadrat(minX: number, minY: number, maxX: number, maxY: number) {
    return prepareWater([
        {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [minX, minY],
                        [maxX, minY],
                        [maxX, maxY],
                        [minX, maxY],
                        [minX, minY],
                    ],
                ],
            },
            minX,
            minY,
            maxX,
            maxY,
        },
    ]);
}

function fluss(coordinates: [number, number][], extra: Partial<RiverRow> = {}): RiverRow {
    return { coordinates, isBach: false, flowDirection: null, flowFactor: null, ...extra };
}

function ort(id: string, x: number, y: number, extra: Partial<RouteNode> = {}): RouteNode {
    return { id, name: id, kind: "place", isHidden: false, x, y, ...extra };
}

/** Ein gezeichneter Weg ohne eigene Liste der Mittel. */
function weg(id: string, subtype: string, coordinates: [number, number][]) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    };
}

/** Eine Straße von A (100|100) nach B (120|100) mit Stützpunkten bei 105, 110 und 115. */
const network = buildRouteNetwork(
    [ort("A", 100, 100), ort("B", 120, 100)],
    [
        {
            public_id: "strasse",
            name: "Reichsweg",
            subtype: "Strasse",
            coordinates: JSON.stringify({
                type: "LineString",
                coordinates: [
                    [100, 100],
                    [105, 100],
                    [110, 100],
                    [115, 100],
                    [120, 100],
                ],
            }),
            allowed_transports: null,
            transport_domain: null,
            flow_direction: null,
            flow_factor: null,
        },
    ],
);

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
/** Alles Land, und im Osten ein Meer. */
const meer = quadrat(200, 90, 220, 110);
const land = quadrat(0, 0, 300, 300);
const gelaende: OffroadTerrain = { land, rivers: NO_RIVERS };

const P = mapPointId({ x: 111, y: 104 });
const abfolge = (route: ReturnType<typeof findRoute>): string[] =>
    route.segments.map((segment) => `${segment.subtype}:${segment.from_node}>${segment.to_node}`);

describe("Die Kennung eines Kartenpunkts", () => {
    it("ist seine Lage auf drei Stellen, und sie liest sich zurück", () => {
        expect(mapPointId({ x: 504.5301, y: -1.0004 })).toBe("p:504.53:-1");
        expect(parseMapPointId("p:504.53:-1")).toEqual({ x: 504.53, y: -1 });
        expect(parseMapPointId("aaaaaaaa-0000-4000-8000-000000000001")).toBeNull();
        expect(parseMapPointId("p:1:2:3")).toBeNull();
    });
});

describe("Land", () => {
    it("ist Kontinent oder Insel - und Wasser schlägt Land", () => {
        expect(pointIsOnLand(50, 50, land, meer)).toBe(true);
        expect(pointIsOnLand(210, 100, land, meer)).toBe(false);
        // Wo keine Fläche etwas sagt, ist kein Land.
        expect(pointIsOnLand(400, 400, land, meer)).toBe(false);
        // Ohne Landdaten ist nichts Land: die sichere Richtung.
        expect(pointIsOnLand(50, 50, NO_WATER, NO_WATER)).toBe(false);
    });
});

describe("Flüsse und Bäche", () => {
    const rivers = prepareRivers(
        [
            fluss([
                [0, 10],
                [20, 10],
            ]),
            fluss(
                [
                    [0, 20],
                    [20, 20],
                ],
                { isBach: true },
            ),
            fluss(
                [
                    [0, 30],
                    [20, 30],
                ],
                { isBach: true, flowDirection: "forward", flowFactor: 3 },
            ),
        ],
        model,
    );

    it("🔴 die gerade Sehne scheitert an einem Fluss UND an einem Bach (Entscheidung i)", () => {
        expect(chordCrossesRivers(5, 5, 5, 15, rivers)).toBe(true);
        expect(chordCrossesRivers(5, 15, 5, 25, rivers)).toBe(true);
        expect(chordCrossesRivers(5, 12, 5, 18, rivers)).toBe(false);
    });

    it("ein Bach quert sich mit seinem Faktor: ohne Fließrichtung 1, sonst Strömung / 2, höchstens 10,2", () => {
        expect(rivers.fords.map((ford) => [ford.factor, ford.wade])).toEqual([
            [1, 3],
            [1.5, 4.5],
        ]);
        expect(fordFactor(model, { flowDirection: "forward", flowFactor: null })).toBe(1);
        expect(fordFactor(model, { flowDirection: "forward", flowFactor: 100 })).toBe(10.2);
    });
});

describe("Die Regeln des Ausstiegs", () => {
    const links = [
        {
            id: "strasse",
            coordinates: [
                [100, 100],
                [105, 100],
                [110, 100],
                [115, 100],
                [120, 100],
            ] as [number, number][],
        },
    ];

    it("bietet den Fußpunkt und jeden inneren Stützpunkt an, nie ein Wegende - und jeden Weg einmal", () => {
        const [set, ...rest] = landPathExits([...links, ...links], 111, 104);
        expect(rest).toHaveLength(0);
        expect(set?.cuts.map((cut) => [cut.x, cut.y])).toEqual([
            [111, 100],
            [110, 100],
            [115, 100],
            [105, 100],
        ]);
    });

    it("zieht Orte an einem Landweg vor, und nur ohne sie die übrigen", () => {
        const nodes = [
            { id: "Hafen", x: 111, y: 105, landPath: false },
            { id: "Dorf", x: 130, y: 104, landPath: true },
        ];
        expect(nearestExitNodes(nodes, 111, 104).map((node) => node.id)).toEqual(["Dorf"]);
        expect(nearestExitNodes(nodes.slice(0, 1), 111, 104).map((node) => node.id)).toEqual(["Hafen"]);
    });

    it("die erste Stufe reicht bis zum sechstnächsten Kandidaten; Wege gehen bei Gleichstand vor", () => {
        const sets = landPathExits(links, 111, 104);
        const nodes = nearestExitNodes(
            [
                { id: "A", x: 100, y: 100, landPath: true },
                { id: "B", x: 120, y: 100, landPath: true },
            ],
            111,
            104,
        );
        const reach = exitReach(sets, nodes);
        expect(reach).toBeCloseTo(Math.hypot(11, 4), 9);
        expect(exitCandidates(sets, nodes, reach).map((candidate) => candidate.kind)).toEqual([
            "cut",
            "cut",
            "cut",
            "cut",
            "node",
            "node",
        ]);
        expect(exitReach([], [])).toBe(Infinity);
    });

    it("die Kutsche fährt querfeldein (WI-0258, nur über offenes Land), ein Schiff nie", () => {
        expect(offroadTransport(model, "horseCarriage")).toEqual({ transport: "horseCarriage", speed: 2.6775 });
        expect(offroadTransport(model, "cargoShip")).toBe("offroad_transport_not_allowed");
        expect(offroadTransport(model, "groupFoot")).toEqual({ transport: "groupFoot", speed: QUERFELDEIN });
    });

    it("der Längenaufschlag wächst mit der Luftlinie und hört bei 2 auf", () => {
        // 4 Einheiten sind 12 Meilen: 1 + 0,006 × 12.
        expect(offroadRamp(model, 4)).toBeCloseTo(1.072, 9);
        expect(offroadRamp(model, 1000)).toBe(2);
    });

    it("🔴 eine trockene Sehne bleibt gerade, in beiden Modi (Entscheidung h)", () => {
        const welt = { water: NO_WATER, rivers: NO_RIVERS };
        for (const optimize of ["fastest", "shortest"] as const) {
            const gerade = offroadPathBetween(
                welt,
                offroadCost(model, { transport: "groupFoot", speed: QUERFELDEIN }, optimize),
                { x: 10, y: 0 },
                { x: 10, y: 4 },
            );
            expect(gerade?.points).toEqual([
                [10, 0],
                [10, 4],
            ]);
            expect(gerade?.distance).toBe(4);
            expect(gerade?.time).toBeCloseTo((4 / QUERFELDEIN) * offroadRamp(model, 4), 9);
        }
    });

    it("🔴 über einen Bach sucht der Gang: Die Furt kostet 15 Meilen und das Waten, wenn kein Umweg billiger ist", () => {
        const rivers = prepareRivers(
            [
                fluss(
                    [
                        [-100, 2],
                        [100, 2],
                    ],
                    { isBach: true },
                ),
            ],
            model,
        );
        const welt = { water: NO_WATER, rivers };
        expect(chordIsDry(welt, { x: 10, y: 0 }, { x: 10, y: 4 })).toBe(false);
        const furt = offroadPathBetween(
            welt,
            offroadCost(model, { transport: "groupFoot", speed: QUERFELDEIN }, "fastest"),
            { x: 10, y: 0 },
            { x: 10, y: 4 },
        );
        // Um den langen Bach herum führt kein Weg durch die Kiste: Die Suche watet hindurch.
        expect(furt?.distance).toBeCloseTo(4, 0);
        expect(furt?.time).toBeGreaterThan(((4 + 5) / QUERFELDEIN) * offroadRamp(model, 4));
    });

    it("an einem Fluss quer durch die Kiste und durch offenes Meer führt kein Weg", () => {
        const wand = prepareRivers(
            [
                fluss([
                    [-100, 2],
                    [100, 2],
                ]),
            ],
            model,
        );
        const zuFussZeit = offroadCost(model, { transport: "groupFoot", speed: QUERFELDEIN }, "fastest");
        expect(
            offroadPathBetween({ water: NO_WATER, rivers: wand }, zuFussZeit, { x: 10, y: 0 }, { x: 10, y: 4 }),
        ).toBeNull();
        const offenesMeer = quadrat(150, 0, 250, 200);
        expect(
            offroadPathBetween(
                { water: offenesMeer, rivers: NO_RIVERS },
                zuFussZeit,
                { x: 140, y: 100 },
                { x: 260, y: 100 },
            ),
        ).toBeNull();
    });

    it("zwei Kartenpunkte bekommen die Gerade bis 15 Meilen, oder wenn der andere näher ist als der Ausstieg", () => {
        const a = { x: 0, y: 0 };
        expect(directEdgeAllowed(model, a, { x: 5, y: 0 }, 1, 1)).toBe(true);
        expect(directEdgeAllowed(model, a, { x: 8, y: 0 }, 1, 1)).toBe(false);
        expect(directEdgeAllowed(model, a, { x: 8, y: 0 }, 1, 9)).toBe(true);
        expect(directEdgeAllowed(model, a, { x: 8, y: 0 }, Infinity, 1)).toBe(true);
    });
});

describe("Die Route zu einem Kartenpunkt", () => {
    const graph = buildRouteGraph(network, model, zuFuss, meer);

    it("steigt am nächsten Punkt des Weges aus und geht von dort querfeldein", () => {
        const route = findRoute(network, graph, ["A", P], gelaende);
        expect(route.refused).toBeNull();
        expect(abfolge(route)).toEqual(["Strasse:A>__wp_anchor_0", "Querfeldein:__wp_anchor_0>Kartenpunkt"]);
        const gang = route.segments[1];
        expect(gang).toMatchObject({ synthetic: true, offroad: true, cost_factor: 1, distance_units: 4 });
        expect(gang?.edge_id).toBe(`offroad-${P}`);
        expect(gang?.geometry.coordinates).toEqual([
            [111, 100],
            [111, 104],
        ]);
        // Ohne ×25, aber mit dem Längenaufschlag - und der steht in der gemeldeten Zeit.
        expect(gang?.travel_hours).toBeCloseTo((4 / QUERFELDEIN) * 1.072 * STUNDEN_JE_ZEIT, 9);
    });

    it("🔴 hinter einem Fluss biegt der Gang um sein Ende und steigt am Weg ein, den er zuerst erreicht (R7, q)", () => {
        const rivers = prepareRivers(
            [
                fluss([
                    [108.5, 102],
                    [114, 102],
                ]),
            ],
            model,
        );
        const route = findRoute(network, graph, ["A", P], { land, rivers });
        const gang = route.segments[route.segments.length - 1];
        const linie = gang?.geometry.coordinates ?? [];
        // Die gerade Sehne zum Fußpunkt (111|100) quert den Fluss; um sein Westende herum ist er
        // erreichbar. Den Reichsweg erreicht der Gang dort schon gleich hinter dem Flussende, früher als
        // den Fußpunkt - das Netz nimmt diesen Gang (WI-0030 q). Vor R7 rückte (105|100) nach.
        const [x, y] = linie[0] as [number, number];
        expect(y).toBeCloseTo(100, 9);
        expect(x).toBeGreaterThan(105);
        expect(x).toBeLessThan(111);
        expect(linie[linie.length - 1]).toEqual([111, 104]);
        expect(linie.length).toBeGreaterThan(2);
        expect(chordCrossesRivers(111, 100, 111, 104, rivers)).toBe(true);
        for (let index = 1; index < linie.length; index += 1) {
            const [x1, y1] = linie[index - 1] as [number, number];
            const [x2, y2] = linie[index] as [number, number];
            expect(chordCrossesRivers(x1, y1, x2, y2, rivers)).toBe(false);
        }
        expect(gang?.distance_units).toBeGreaterThan(4);
        expect(gang?.distance_units).toBeLessThan(Math.hypot(6, 4));
        // Die Zeit trägt den Längenaufschlag der Luftlinie, nicht der gelaufenen Strecke.
        const luft = Math.hypot(x - 111, y - 104);
        expect(gang?.travel_hours).toBeCloseTo(
            ((gang?.distance_units ?? 0) / QUERFELDEIN) * offroadRamp(model, luft) * STUNDEN_JE_ZEIT,
            9,
        );
    });

    it("🔴 fährt die Route durch einen Ausstieg, den sie nicht nimmt, bleibt der Weg ein Abschnitt (q)", () => {
        const rivers = prepareRivers(
            [
                fluss([
                    [108.5, 102],
                    [114, 102],
                ]),
            ],
            model,
        );
        const route = findRoute(network, graph, ["A", "B", P], { land, rivers });
        // Der Punkt teilt den Reichsweg zweimal: am Fußpunkt (111|100), seinem Ausstieg, und westlich
        // davon, wo er ihn früher erreicht (q). Von A nach B fährt die Route durch beide hindurch - ohne
        // Kreuzung dort, in einem Abschnitt.
        expect(abfolge(route)).toEqual([
            "Strasse:A>B",
            "Strasse:B>__wp_anchor_0",
            "Querfeldein:__wp_anchor_0>Kartenpunkt",
        ]);
        const strasse = route.segments[0];
        const linie = strasse?.geometry.coordinates ?? [];
        expect(linie).toHaveLength(7);
        expect(linie[0]).toEqual([100, 100]);
        expect(linie[4]).toEqual([111, 100]);
        expect(linie[6]).toEqual([120, 100]);
        expect(linie.every(([, y]) => y === 100)).toBe(true);
        expect(strasse?.distance_units).toBeCloseTo(20, 9);
        expect(route.legs.map((leg) => leg.segmentCount)).toEqual([1, 2]);
    });

    it("🔴 ein Bach auf der Sehne führt in die Suche: Ist der Umweg billiger als die Furt, geht sie herum (Entscheidung i)", () => {
        const kurzerBach = prepareRivers(
            [
                fluss(
                    [
                        [108.5, 102],
                        [114, 102],
                    ],
                    { isBach: true },
                ),
            ],
            model,
        );
        const linie = findRoute(network, graph, ["A", P], { land, rivers: kurzerBach }).segments.at(-1)?.geometry
            .coordinates;
        expect(linie?.length).toBeGreaterThan(2);
        // Ein Bach über die ganze Kiste: Herum führt kein Weg, der Gang watet und zahlt die Furt.
        const langerBach = prepareRivers(
            [
                fluss(
                    [
                        [80, 102],
                        [140, 102],
                    ],
                    { isBach: true },
                ),
            ],
            model,
        );
        const furt = findRoute(network, graph, ["A", P], { land, rivers: langerBach }).segments.at(-1);
        expect(furt?.geometry.coordinates[0]).toEqual([111, 100]);
        expect(furt?.travel_hours).toBeGreaterThan(((4 + 5) / QUERFELDEIN) * 1.072 * STUNDEN_JE_ZEIT);
    });

    it("🔴 um einen See biegt der Gang ebenso", () => {
        const mitSee = buildRouteGraph(network, model, zuFuss, quadrat(108.5, 101.5, 113.5, 102.5));
        const linie = findRoute(network, mitSee, ["A", P], gelaende).segments.at(-1)?.geometry.coordinates ?? [];
        // Um das Ufer herum, dann am Reichsweg, wo der Gang ihn zuerst erreicht.
        expect((linie[0] as [number, number])[1]).toBeCloseTo(100, 9);
        expect(linie.length).toBeGreaterThan(2);
    });

    it("🔴 eine trockene Sehne bleibt gerade, auch unter „Kürzeste“", () => {
        const kuerzeste = buildRouteGraph(network, model, { ...zuFuss, optimize: "shortest" }, meer);
        expect(findRoute(network, kuerzeste, ["A", P], gelaende).segments.at(-1)?.geometry.coordinates).toEqual([
            [111, 100],
            [111, 104],
        ]);
    });

    it("gilt auch als Start und als Zwischenziel", () => {
        const Q = mapPointId({ x: 104, y: 97 });
        const route = findRoute(network, graph, [P, "B", Q], gelaende);
        expect(route.found).toBe(true);
        expect(route.legs.map((leg) => [leg.from, leg.to])).toEqual([
            [P, "B"],
            ["B", Q],
        ]);
        expect(route.segments[0]).toMatchObject({ from_node: "Kartenpunkt", offroad: true });
    });

    it("zwei Kartenpunkte nah beieinander gehen die Gerade", () => {
        const Q = mapPointId({ x: 112, y: 106 });
        const route = findRoute(network, graph, [P, Q], gelaende);
        expect(abfolge(route)).toEqual(["Querfeldein:Kartenpunkt>Kartenpunkt"]);
        expect(route.segments[0]?.edge_id).toBe("offroad-direct-1");
    });

    it("🔴 liegt ein Fluss zwischen zwei Kartenpunkten, biegt auch ihre Direktkante um ihn", () => {
        const Q = mapPointId({ x: 111, y: 108 });
        const rivers = prepareRivers(
            [
                fluss([
                    [110, 106],
                    [112, 106],
                ]),
            ],
            model,
        );
        const route = findRoute(network, graph, [P, Q], { land, rivers });
        expect(abfolge(route)).toEqual(["Querfeldein:Kartenpunkt>Kartenpunkt"]);
        const linie = route.segments[0]?.geometry.coordinates ?? [];
        expect(linie[0]).toEqual([111, 104]);
        expect(linie[linie.length - 1]).toEqual([111, 108]);
        expect(linie.length).toBeGreaterThan(2);
        // Trennt ein breiter Fluss den zweiten Punkt von jedem Ausstieg, gibt es keine Reise dorthin.
        const breit = prepareRivers(
            [
                fluss([
                    [80, 106],
                    [140, 106],
                ]),
            ],
            model,
        );
        expect(findRoute(network, graph, [P, Q], { land, rivers: breit }).refused).toEqual({
            reason: "no_offroad_route",
            waypoint: Q,
        });
    });

    it("🔴 auch ohne Land: Der Punkt hängt am nächsten Ort, wie in Legacy", () => {
        const ohneLand = buildRouteGraph(
            network,
            model,
            { ...zuFuss, enabled: { land: false, river: true, sea: true } },
            meer,
        );
        const route = findRoute(network, ohneLand, ["B", P], gelaende);
        expect(abfolge(route)).toEqual(["Querfeldein:B>Kartenpunkt"]);
    });

    it("sagt ab, in Legacys Reihenfolge: erst der Punkt, dann das Mittel, dann die Ausstiege", () => {
        const imMeer = mapPointId({ x: 210, y: 100 });
        expect(findRoute(network, graph, ["A", imMeer], gelaende).refused).toEqual({
            reason: "point_not_on_land",
            waypoint: imMeer,
        });
        // Ohne Landdaten ist kein Punkt an Land.
        expect(findRoute(network, graph, ["A", P]).refused?.reason).toBe("point_not_on_land");
        const schiff = buildRouteGraph(network, model, {
            ...zuFuss,
            transports: { ...zuFuss.transports, land: "cargoShip" },
        });
        expect(findRoute(network, schiff, ["A", P], gelaende).refused?.reason).toBe("offroad_transport_not_allowed");
        const leer = buildRouteNetwork([], []);
        const Q = mapPointId({ x: 112, y: 106 });
        expect(findRoute(leer, buildRouteGraph(leer, model, zuFuss), [P, Q], gelaende).refused?.reason).toBe(
            "no_exit_node",
        );
        const ringsumFluss = prepareRivers(
            [
                fluss([
                    [90, 102],
                    [130, 102],
                ]),
            ],
            model,
        );
        expect(findRoute(network, graph, ["A", P], { land, rivers: ringsumFluss }).refused?.reason).toBe(
            "no_offroad_route",
        );
    });
});

describe("🔴 Einstieg an der ersten Straße (Betreiber 2026-09-24, WI-0030 n)", () => {
    const welt = { water: NO_WATER, rivers: NO_RIVERS };
    const wege = (...linien: [number, number][][]) =>
        roadLines(linien.map((coordinates, index) => ({ id: `weg-${String(index)}`, coordinates })));
    /** Ein Gang vom Ausstieg (0|0) zum Kartenpunkt (0|10), wie ihn die Suche liefert. */
    const gang: [number, number][] = [
        [0, 0],
        [0, 10],
    ];

    it("steigt ein, wo der Gang vom Punkt aus zuerst an einen Weg kommt", () => {
        const einstieg = firstRoadEntry(
            gang,
            wege(
                [
                    [-2, 5],
                    [2, 5],
                ],
                [
                    [-2, 8],
                    [2, 8],
                ],
            ),
            welt,
        );
        expect(einstieg).toMatchObject({ road: 1, segment: 0, t: 0.5, x: 0, y: 8, after: 1 });
        expect(einstieg?.via).toEqual([0, 8.5]);
    });

    it("nahe genügt: 0,5 E neben dem Weg, aber nicht über Wasser", () => {
        const daneben = wege([
            [0.3, 4],
            [0.3, 6],
        ]);
        expect(firstRoadEntry(gang, daneben, welt)).toMatchObject({ x: 0.3, y: 6 });
        const graben = { water: quadrat(0.1, -5, 0.25, 15), rivers: NO_RIVERS };
        expect(firstRoadEntry(gang, daneben, graben)).toBeNull();
    });

    it("🔴 „kurz vor dem Ausstieg“ misst der Gang, nicht die Luftlinie: Eine Schleife steigt am Weg ein", () => {
        // Um eine Quelle herum: Der Gang kreuzt 0,85 E neben dem Ausstieg einen Weg, hat aber noch 6,5 E vor sich.
        const schleife: [number, number][] = [
            [0, 0],
            [0, 3],
            [-0.8, 3],
            [-0.8, -3],
        ];
        const nebenAn = wege([
            [-1.2, 0.3],
            [-0.4, 0.3],
        ]);
        expect(firstRoadEntry(schleife, nebenAn, welt)).toMatchObject({ x: -0.8, y: 0.3, after: 3 });
    });

    it("wechselt kurz vor dem Ausstieg nicht mehr, und ohne Weg in Reichweite bleibt der Gang", () => {
        const amAusstieg = wege([
            [-2, 0.4],
            [2, 0.4],
        ]);
        expect(firstRoadEntry(gang, amAusstieg, welt)).toBeNull();
        const fern = wege([
            [3, 0],
            [3, 10],
        ]);
        expect(firstRoadEntry(gang, fern, welt)).toBeNull();
    });

    it("steigt am Weg ein, statt um einen See herum neben ihm her zum Ausstieg zu laufen", () => {
        // Der Kartenpunkt (111|110) liegt nördlich eines Sees; sein nächster Ausstieg (111|106) auf dem
        // Pfad südlich davon ist nur um das Ostufer erreichbar. Dort liegt der Pfad schon 0,5 E entfernt.
        const netz = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 120, 100), ort("D", 90, 106), ort("E", 140, 106)],
            [
                weg("strasse", "Strasse", [
                    [100, 100],
                    [110, 100],
                    [120, 100],
                ]),
                weg("pfad", "Pfad", [
                    [90, 106],
                    [140, 106],
                ]),
                weg("verbindung", "Weg", [
                    [140, 106],
                    [120, 100],
                ]),
            ],
        );
        const see = quadrat(95, 106.5, 118, 108.5);
        const route = findRoute(
            netz,
            buildRouteGraph(netz, model, zuFuss, see),
            ["A", mapPointId({ x: 111, y: 110 })],
            {
                land,
                rivers: NO_RIVERS,
            },
        );
        const gang = route.segments.at(-1);
        const [x, y] = gang?.geometry.coordinates[0] ?? [0, 0];
        expect(y).toBeCloseTo(106, 9);
        expect(x).toBeGreaterThan(118);
        expect(x).toBeLessThan(118.6);
        // Um das Ostufer und neben dem Pfad zurück wären es 16,8 E; eingestiegen rund 10.
        expect(gang?.distance_units).toBeLessThan(10.5);
        expect(route.segments.at(-2)?.to_node).toBe(gang?.from_node);
    });
});

describe("🔴 Gezeichnet endet der Gang auf der Straße (Betreiber 2026-09-25)", () => {
    it("am Knick liegt der Anker gezeichnet auf der Kurve der Karte; Wegstück und Gang schließen an", () => {
        const netz = buildRouteNetwork(
            [ort("A", 100, 100), ort("C", 110, 110)],
            [
                weg("knick", "Strasse", [
                    [100, 100],
                    [106, 100],
                    [110, 104],
                    [110, 110],
                ]),
            ],
        );
        const route = findRoute(
            netz,
            buildRouteGraph(netz, model, zuFuss),
            ["A", mapPointId({ x: 109, y: 101.5 })],
            gelaende,
        );
        const [stueck, gang] = route.segments;
        expect(gang?.offroad).toBe(true);
        // Roh endet der Gang auf der Rohlinie, gezeichnet auf der Kurve; gemessen wird weiter roh.
        expect(gang?.display?.coordinates[0]).not.toEqual(gang?.geometry.coordinates[0]);
        expect(gang?.display?.coordinates[0]).toEqual(stueck?.display?.coordinates.at(-1));
        expect(gang?.display?.coordinates.at(-1)).toEqual([109, 101.5]);
        expect(stueck?.display?.coordinates[0]).toEqual([100, 100]);
    });

    it("auf einem geraden Weg gibt es nichts anders zu zeichnen", () => {
        const route = findRoute(network, buildRouteGraph(network, model, zuFuss, meer), ["A", P], gelaende);
        expect(route.segments.at(-1)?.display).toBeUndefined();
    });
});

describe("🔴 Der Boden bremst den Gang (Betreiber 2026-09-24, WI-0030 R8)", () => {
    // Ein Sumpf zwischen dem Kartenpunkt und dem Fußpunkt seines Ausstiegs auf dem Reichsweg.
    const sumpf = prepareGround([
        {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [109, 101.5],
                        [113, 101.5],
                        [113, 102.5],
                        [109, 102.5],
                        [109, 101.5],
                    ],
                ],
            },
            minX: 109,
            minY: 101.5,
            maxX: 113,
            maxY: 102.5,
            factor: 7.5,
        },
    ]);
    const terrain = { land, rivers: NO_RIVERS, ground: sumpf };

    it("die Tafel: GA-Werte, Legacys Werte ohne GA-Zeile, Urwald wie Dschungel (Betreiber 2026-09-25)", () => {
        expect(model.bodenfaktor.wert).toEqual({
            wald: 1.4,
            suempfe_moore: 7,
            dschungel: 4.2,
            urwald: 4.2,
            wueste: 1.4,
            tundra: 1,
            schlucht: 2.6,
            flussdelta: 2,
            wadi: 1.5,
            auenlandschaft: 1.3,
            hochebene: 1.1,
        });
    });

    it("unter „Schnellste“ geht der Gang um den Sumpf herum, statt ihn gerade zu durchqueren", () => {
        const gang = findRoute(network, buildRouteGraph(network, model, zuFuss, meer), ["A", P], terrain).segments.at(
            -1,
        );
        const linie = (gang?.geometry.coordinates ?? []) as [number, number][];
        expect(linie.length).toBeGreaterThan(2);
        for (let index = 1; index < linie.length; index += 1) {
            const [x1, y1] = linie[index - 1] as [number, number];
            const [x2, y2] = linie[index] as [number, number];
            for (let step = 1; step < 50; step += 1) {
                const x = x1 + ((x2 - x1) * step) / 50;
                const y = y1 + ((y2 - y1) * step) / 50;
                expect(x > 109.3 && x < 112.7 && y > 101.6 && y < 102.4).toBe(false);
            }
        }
        // Gerade hindurch kostete der Meter Sumpf siebeneinhalbmal so viel.
        expect(gang?.travel_hours).toBeLessThan(((4 + 6.5) / QUERFELDEIN) * 1.1 * STUNDEN_JE_ZEIT);
    });

    it("unter „Kürzeste“ zählt die Strecke: gerade hindurch", () => {
        const kuerzeste = buildRouteGraph(network, model, { ...zuFuss, optimize: "shortest" }, meer);
        expect(findRoute(network, kuerzeste, ["A", P], terrain).segments.at(-1)?.geometry.coordinates).toEqual([
            [111, 100],
            [111, 104],
        ]);
    });
});

describe("🔴 Ein See bleibt Wand (Betreiber 2026-09-25, WI-0030 o)", () => {
    it("auch nahe dem Kartenpunkt: Der Gang geht um den See, statt ihn zu durchqueren", () => {
        // Der See liegt 0,6 E unter dem Punkt, zwischen ihm und dem Reichsweg. Legacy räumt ihn dort frei.
        const see = quadrat(109.5, 102.6, 112.5, 103.4);
        const gang = findRoute(network, buildRouteGraph(network, model, zuFuss, see), ["A", P], gelaende).segments.at(
            -1,
        );
        const linie = (gang?.geometry.coordinates ?? []) as [number, number][];
        expect(linie.length).toBeGreaterThan(2);
        for (let index = 1; index < linie.length; index += 1) {
            const [x1, y1] = linie[index - 1] as [number, number];
            const [x2, y2] = linie[index] as [number, number];
            for (let step = 0; step <= 50; step += 1) {
                const x = x1 + ((x2 - x1) * step) / 50;
                const y = y1 + ((y2 - y1) * step) / 50;
                expect(x > 109.5 && x < 112.5 && y > 102.6 && y < 103.4).toBe(false);
            }
        }
    });
});

describe("🔴 Ein Fluss nahe Punkt und Ausstieg (Betreiber 2026-09-24, WI-0030 m)", () => {
    // Ein Fluss quer durch die Kiste (y = 101,5), der Kartenpunkt 0,7 E nördlich davon. Legacy räumt den
    // Fluss dort frei und geht gratis hinüber zum Reichsweg (y = 100).
    const quer = prepareRivers(
        [
            fluss([
                [60, 101.5],
                [160, 101.5],
            ]),
        ],
        model,
    );
    const P = mapPointId({ x: 111, y: 102.2 });

    it("der Punkt bekommt den Ausstieg diesseits und die bezahlte Querung; das Netz wählt die schnellere Reise", () => {
        const netz = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 120, 100), ort("C", 100, 108), ort("D", 120, 108)],
            [
                weg("reichsweg", "Strasse", [
                    [100, 100],
                    [110, 100],
                    [120, 100],
                ]),
                weg("nordweg", "Weg", [
                    [100, 108],
                    [120, 108],
                ]),
                weg("bruecke", "Weg", [
                    [120, 100],
                    [120, 108],
                ]),
            ],
        );
        const graph = buildRouteGraph(netz, model, zuFuss);
        // Von Norden bleibt die Reise diesseits: Nordweg, dann der Gang zum Punkt.
        const vonNorden = findRoute(netz, graph, ["C", P], { land, rivers: quer }).segments.at(-1);
        expect(vonNorden?.edge_id).toBe(`offroad-${P}`);
        expect(vonNorden?.geometry.coordinates).toEqual([
            [111, 108],
            [111, 102.2],
        ]);
        // Von Süden läge die Brücke 26 E Weg entfernt; die bezahlte Querung ist schneller.
        const vonSueden = findRoute(netz, graph, ["A", P], { land, rivers: quer }).segments.at(-1);
        expect(vonSueden?.edge_id).toBe(`offroad-${P}-quer`);
        expect(vonSueden?.geometry.coordinates[0]).toEqual([111, 100]);
        expect(vonSueden?.travel_hours).toBeGreaterThan((15 / QUERFELDEIN) * STUNDEN_JE_ZEIT);
    });

    it("ist diesseits keiner erreichbar, quert der Gang und zahlt den dreifachen Bachpreis", () => {
        const route = findRoute(network, buildRouteGraph(network, model, zuFuss), ["A", P], { land, rivers: quer });
        const gang = route.segments.at(-1);
        expect(gang?.geometry.coordinates[0]).toEqual([111, 100]);
        // Zu Fuß 3 × 15 Meilen = 15 Einheiten offenes Gelände, zusätzlich zum Weg selbst.
        expect(gang?.travel_hours).toBeGreaterThan(((2.2 + 15) / QUERFELDEIN) * STUNDEN_JE_ZEIT);
        expect(gang?.travel_hours).toBeLessThan(((2.5 + 15) / QUERFELDEIN) * 1.1 * STUNDEN_JE_ZEIT);
    });

    it("die Direktkante zweier Punkte beiderseits quert, zahlt aber; Notverbindungen queren frei wie Legacy", () => {
        const welt = { water: NO_WATER, rivers: quer };
        const von = { x: 111, y: 102.2 };
        const nach = { x: 111, y: 100.8 };
        const mittel = { transport: "groupFoot", speed: QUERFELDEIN };
        const bepreist = offroadPathBetween(welt, offroadCost(model, mittel, "fastest", "priced"), von, nach);
        const frei = offroadPathBetween(welt, offroadCost(model, mittel, "fastest", "free"), von, nach);
        expect(bepreist?.time).toBeGreaterThan(15 / QUERFELDEIN);
        expect(frei?.time).toBeLessThan(2 / QUERFELDEIN);
        expect(offroadPathBetween(welt, offroadCost(model, mittel, "fastest", "blocked"), von, nach)).toBeNull();
    });

    it("der Preis hängt am Reisemittel: Einzelreiter 15 Meilen, Karawane 90", () => {
        const preis = (transport: string) =>
            offroadCost(model, { transport, speed: 1 }, "fastest", "priced").riverUnits *
            model.meilenJeKarteneinheit.wert;
        expect(preis("groupFoot")).toBe(45);
        expect(preis("lightRider")).toBe(15);
        expect(preis("caravan")).toBe(90);
    });
});

describe("Der Dienst mit Kartenpunkten", () => {
    const service = new RouteService({
        mapDomain: "aventuria",
        model,
        source: {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network,
                water: meer,
                land,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        },
    });
    const query = { ...zuFuss, hoursPerDay: 8 };

    it("nennt den Punkt „Kartenpunkt“ und endet die Reise dort, nicht an einer Markierung", async () => {
        const outcome = await service.route({ ...query, waypoints: ["A", P] });
        if (!outcome.ok) throw new Error(outcome.error);
        const route = outcome.response;
        expect(route.waypoints).toEqual([
            { id: "A", name: "A" },
            { id: P, name: "Kartenpunkt" },
        ]);
        const last = route.stages[route.stages.length - 1];
        expect(last).toMatchObject({ type: "Querfeldein", to: { point: "point", place_id: P, x: 111, y: 104 } });
        // Der gewollte Gang ist keine Notverbindung: keine Warnung. Diese Welt hat keinen Seegraphen; seit WI-0153 Schnitt 7e sagt
        // die Antwort das (`free_sea_unavailable`), statt über gezeichnete Seewege zu fahren.
        expect(route.warnings).toEqual(["free_sea_unavailable"]);
        expect(route.air_legs_units[0]).toBeCloseTo(Math.hypot(11, 4), 9);
    });

    it("gibt die Absage mit dem Punkt zurück", async () => {
        const imMeer = mapPointId({ x: 210, y: 100 });
        expect(await service.route({ ...query, waypoints: ["A", imMeer] })).toEqual({
            ok: false,
            error: "point_not_on_land",
            detail: imMeer,
        });
    });
});
