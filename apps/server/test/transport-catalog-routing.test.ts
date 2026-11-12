import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    CLOCK_START,
    dayOfYear,
    mapPointId,
    seaGraphTransport,
    snowlineHeight,
    travelHoursFromTime,
} from "@avesmaps3d/shared";
import { clockStep, type RouteTiming } from "../src/routing/closures.ts";
import { prepareGround } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteLink, type RouteNode } from "../src/routing/network.ts";
import { frozenBrooks, NO_RIVERS, prepareRivers } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type OffroadTerrain, type RouteRequest } from "../src/routing/router.ts";
import { coastDistance, coastProfile } from "../src/routing/sea-coast.ts";
import { FreeSea } from "../src/routing/sea-free.ts";
import { compactSeaGraph, waterMask, type CompactSeaGraph } from "../src/routing/sea-graph-store.ts";
import {
    buildSeaGrid,
    nearestWaterCell,
    prepareNavigableWater,
    type WaterRegionType,
} from "../src/routing/sea-grid.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";
import { blockedEdges, waterKindCells, watersReport } from "../src/routing/sea-waters.ts";
import { NO_SLOPE } from "../src/routing/slope.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Die neuen Transportmittel im Router (WI-0069): Strömung der Flussgaleere, Karren und Fuhrwerk nur auf Wegen,
 * der Schlitten nur auf Schnee oder Eis, die neuen Seeschiffe auf den Seereisen ihrer Klasse, das Ruderboot nur
 * auf Binnenseen.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const STUNDEN_JE_ZEIT = model.meilenJeKarteneinheit.wert * model.zeitfaktor.wert;
const LEGACY_LAND = ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"];

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

function weg(
    id: string,
    subtype: string,
    coordinates: [number, number][],
    extra: { allowed?: string[] | null; flow?: "forward" | "reverse" | null; factor?: number | null } = {},
) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: extra.allowed ?? null,
        transport_domain: extra.allowed ? (subtype === "Flussweg" ? "river" : "land") : null,
        flow_direction: extra.flow ?? null,
        flow_factor: extra.factor ?? null,
    };
}

const request = (transports: Partial<RouteRequest["transports"]>, enabled: Partial<RouteRequest["enabled"]>) => ({
    optimize: "fastest" as const,
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip", ...transports },
    enabled: { land: false, river: false, sea: false, ...enabled },
    minimizeTransfers: false,
});

describe("Flussgaleere", () => {
    const fluss = (factor: number | null, allowed: string[] | null = null) =>
        buildRouteNetwork(
            [ort("B", 110, 100), ort("C", 120, 100)],
            [
                weg(
                    "fluss",
                    "Flussweg",
                    [
                        [110, 100],
                        [120, 100],
                    ],
                    { flow: "forward", factor, allowed },
                ),
            ],
        );
    const upstream = (transport: string, factor: number | null, allowed: string[] | null = null) => {
        const network = fluss(factor, allowed);
        return findRoute(network, buildRouteGraph(network, model, request({ river: transport }, { river: true })), [
            "C",
            "B",
        ]);
    };

    it("🔴 ohne Faktor am Fluss rechnet sie stromauf 75 / 35, Kahn und Flusssegler weiter 2", () => {
        const galley = upstream("riverGalley", null);
        expect(galley.segments[0]).toMatchObject({ flow_state: "upstream", transport_type: "riverGalley" });
        expect(galley.segments[0]?.flow_time_factor).toBe(75 / 35);
        expect(galley.segments[0]?.cost_units).toBeCloseTo((10 / 7.44) * (75 / 35), 9);
        expect(upstream("riverSailer", null).segments[0]?.flow_time_factor).toBe(2);
        expect(upstream("riverBarge", null).segments[0]?.flow_time_factor).toBe(2);
    });

    it("🔴 ein am Weg gespeicherter Faktor bleibt maßgeblich, für jedes Mittel", () => {
        expect(upstream("riverGalley", 3).segments[0]?.flow_time_factor).toBe(3);
        expect(upstream("riverSailer", 3).segments[0]?.flow_time_factor).toBe(3);
    });

    it("erbt die Freigabe des Flusssseglers, nicht die des Kahns", () => {
        expect(upstream("riverGalley", null, ["riverSailer"]).found).toBe(true);
        expect(upstream("riverGalley", null, ["riverBarge"]).found).toBe(false);
    });

    it("🔴 das Ruderboot fährt auch Flüsse (Betreiber 2026-10-03): wo der Kahn darf, stromauf mit der Vorgabe 2", () => {
        const rowboat = upstream("rowboat", null);
        expect(rowboat.segments[0]).toMatchObject({ transport_type: "rowboat", flow_state: "upstream" });
        expect(rowboat.segments[0]?.flow_time_factor).toBe(2);
        expect(rowboat.segments[0]?.cost_units).toBeCloseTo((10 / 2.48) * 2, 9);
        expect(upstream("rowboat", null, ["riverBarge"]).found).toBe(true);
        expect(upstream("rowboat", null, ["riverSailer"]).found).toBe(false);
    });
});

describe("Karren und Fuhrwerk", () => {
    const strecke = (subtype: string, allowed: string[] | null) =>
        buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100)],
            [
                weg(
                    "w",
                    subtype,
                    [
                        [100, 100],
                        [110, 100],
                    ],
                    { allowed },
                ),
            ],
        );
    const fahrt = (transport: string, subtype: string, allowed: string[] | null) => {
        const network = strecke(subtype, allowed);
        return findRoute(network, buildRouteGraph(network, model, request({ land: transport }, { land: true })), [
            "A",
            "B",
        ]);
    };

    it("🔴 fahren Weg, Straße und Pass, wo die Kutsche darf - mit dem Tempo ihrer Tagesleistung", () => {
        const cart = fahrt("cart", "Weg", LEGACY_LAND);
        expect(cart.found).toBe(true);
        expect(cart.segments[0]?.transport_type).toBe("cart");
        expect(cart.travelHours).toBeCloseTo((10 / 2.975) * STUNDEN_JE_ZEIT, 9);
        expect(fahrt("wagon", "Gebirgspass", null).found).toBe(true);
        expect(fahrt("wagon", "Reichsstrasse", LEGACY_LAND).found).toBe(true);
        // Ohne die Kutsche in der Liste fahren sie dort nicht - die Legacy-Freigabe wird nicht erweitert. Seit WI-0258
        // kommen sie querfeldein über offenes Land von A nach B (Brücke), aber nie auf dem Weg.
        const withoutCarriage = LEGACY_LAND.filter((transport) => transport !== "horseCarriage");
        const abseits = fahrt("cart", "Weg", withoutCarriage);
        expect(abseits.segments.length).toBeGreaterThan(0);
        expect(abseits.segments.every((segment) => segment.subtype === "Querfeldein")).toBe(true);
    });

    it("🔴 nie auf Pfad oder Wüstenpfad, auch nicht mit der Kutsche in der Liste; ohne Weg die Notbrücke querfeldein", () => {
        for (const subtype of ["Pfad", "Wuestenpfad"]) {
            for (const transport of ["cart", "wagon"]) {
                for (const list of [null, LEGACY_LAND]) {
                    // Seit WI-0258 erreichen sie B querfeldein (Brücke), der Weg selbst bleibt ihnen verschlossen.
                    const segments = fahrt(transport, subtype, list).segments;
                    expect(segments.length, `${transport} ${subtype}`).toBeGreaterThan(0);
                    expect(
                        segments.every((segment) => segment.subtype === "Querfeldein"),
                        `${transport} ${subtype}`,
                    ).toBe(true);
                }
            }
        }
        // Ohne Weg gibt es für sie die Notbrücke querfeldein (WI-0258, E2); wohin sie führt, sperrt `vehicle-barrier.ts`.
        const network = buildRouteNetwork([ort("A", 100, 100), ort("B", 110, 100)], []);
        const graph = buildRouteGraph(network, model, request({ land: "wagon" }, { land: true }));
        expect(graph.synthetic).toMatchObject({ transport: "wagon" });
    });
});

describe("Schlitten", () => {
    const network = buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 110, 100)],
        [
            weg("strasse", "Strasse", [
                [100, 100],
                [110, 100],
            ]),
        ],
    );
    const timing = (month: Parameters<typeof dayOfYear>[0], zone: string): RouteTiming => ({
        departure: dayOfYear(month, 1),
        hoursPerDay: 8,
        climate: { bands: [], zoneOf: () => zone },
    });
    const fahrt = (transport: string, time: RouteTiming | null) =>
        findRoute(
            network,
            buildRouteGraph(network, model, request({ land: transport }, { land: true })),
            ["A", "B"],
            undefined,
            time,
        );

    it("🔴 ohne Reisebeginn fährt er nicht: Schnee wird nie angenommen", () => {
        expect(fahrt("sleigh", null).found).toBe(false);
        expect(fahrt("horseCarriage", null).found).toBe(true);
    });

    it("🔴 im Winter auf Schnee fährt er mit seinen 42 Meilen am Tag (Kaleschka, WdE), ohne Abzug", () => {
        const winter = fahrt("sleigh", timing("firun", "gemaessigt"));
        expect(winter.found).toBe(true);
        expect(winter.segments[0]?.transport_type).toBe("sleigh");
        expect(winter.travelHours).toBeCloseTo((10 / 6.2475) * STUNDEN_JE_ZEIT, 9);
        expect(fahrt("sleigh", timing("firun", "boreal")).found).toBe(true);
        expect(fahrt("sleigh", timing("firun", "polar")).found).toBe(true);
        // Die Gruppe zu Fuß bremst derselbe Schnee weiter (leichter Schnee auf der Straße: 30 → 25 Meilen am Tag, WdE).
        const foot = fahrt("groupFoot", timing("firun", "gemaessigt"));
        expect(foot.travelHours).toBeCloseTo((10 / 4.4625) * STUNDEN_JE_ZEIT * (30 / 25), 9);
    });

    it("🔴 Frühling, Sommer, Herbst nie, auch nicht auf polarem Eis; im Winter nur, wo Schnee liegt", () => {
        const sommer = fahrt("sleigh", timing("praios", "gemaessigt"));
        expect(sommer.found).toBe(false);
        expect(sommer.seasonClosed).toBe(false);
        expect(fahrt("sleigh", timing("peraine", "gemaessigt")).found).toBe(false);
        expect(fahrt("sleigh", timing("travia", "boreal")).found).toBe(false);
        // Polares Eis im Frühling und Herbst: kein Winter (Betreiber 2026-10-03 „nur mit Winterschnee“).
        expect(fahrt("sleigh", timing("peraine", "polar")).found).toBe(false);
        expect(fahrt("sleigh", timing("travia", "polar")).found).toBe(false);
        // Winter ohne Schnee in den Subtropen und Tropen.
        expect(fahrt("sleigh", timing("firun", "subtropen_winterfeucht")).found).toBe(false);
        expect(fahrt("sleigh", timing("firun", "tropisch")).found).toBe(false);
    });

    describe("im Gebirge über der Schneegrenze zu jeder Jahreszeit", () => {
        // Am 1. Praios liegt die Schneegrenze der gemäßigten Zone bei 2.500 Schritt (Frühling 1.700, Sommer 3.100).
        const passage = (lowest: number, mountain: 0 | 1, transport = "sleigh") => {
            const link: RouteLink = {
                id: "pass#0",
                pathPublicId: "pass",
                pathName: "Pass",
                subtype: "Gebirgspass",
                from: "A",
                to: "B",
                coordinates: [
                    [100, 100],
                    [101, 100],
                ],
                distance: 1,
                allowedTransports: null,
                transportDomain: null,
                flow: null,
                // Zwei Abtastschritte: Anstieg, Strecke, Gebirge an beiden Enden, Höhe am Anfang, Lage.
                slope: {
                    ...NO_SLOPE,
                    known: true,
                    steps: Float64Array.from([
                        200,
                        1500,
                        mountain,
                        lowest,
                        0,
                        -100,
                        1500,
                        mountain,
                        lowest + 200,
                        1500,
                    ]),
                },
            };
            const edge = { link, transport, time: 1, costFactor: 1, distance: 1, forward: true, synthetic: false };
            return clockStep(model, timing("praios", "gemaessigt"), CLOCK_START, edge);
        };

        it("🔴 ganz im Gebirge und ganz über der Grenze: auch im Hochsommer", () => {
            expect(snowlineHeight(model, "gemaessigt", dayOfYear("praios", 1))).toBe(2500);
            expect(passage(2600, 1).usable).toBe(true);
            // Der tiefste Punkt zählt: 2.400 liegt unter der Grenze.
            expect(passage(2400, 1).usable).toBe(false);
            // Über der Grenze, aber nicht in einer Gebirgsfläche: kein ewiger Schnee.
            expect(passage(2600, 0).usable).toBe(false);
            // Für jedes andere Mittel ist das kein Thema.
            expect(passage(2400, 0, "groupFoot").usable).toBe(true);
        });

        it("ein Gang querfeldein ohne Höhenprofil braucht das Gelände; ohne Gelände liegt er nie im Bergschnee", () => {
            const link: RouteLink = {
                id: "gang",
                pathPublicId: "",
                pathName: "",
                subtype: "Querfeldein",
                from: "A",
                to: "B",
                coordinates: [
                    [100, 100],
                    [101, 100],
                ],
                distance: 1,
                allowedTransports: null,
                transportDomain: null,
                flow: null,
            };
            const edge = {
                link,
                transport: "sleigh",
                time: 1,
                costFactor: 1,
                distance: 1,
                forward: true,
                synthetic: true,
            };
            expect(clockStep(model, timing("praios", "gemaessigt"), CLOCK_START, edge).usable).toBe(false);
            expect(clockStep(model, timing("firun", "gemaessigt"), CLOCK_START, edge).usable).toBe(true);
        });
    });

    describe("querfeldein im Winter ungebremst", () => {
        const strasse = buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 120, 100)],
            [
                weg("strasse", "Strasse", [
                    [100, 100],
                    [110, 100],
                    [120, 100],
                ]),
            ],
        );
        const quadrat = (minX: number, minY: number, maxX: number, maxY: number) => ({
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
        });
        const land = prepareWater([quadrat(0, 0, 300, 300)]);
        const wald = prepareGround([{ ...quadrat(105, 101, 118, 110), factor: 1.5 }]);
        const bach = prepareRivers(
            [
                {
                    coordinates: [
                        [105, 102],
                        [118, 102],
                    ],
                    isBach: true,
                    flowDirection: null,
                    flowFactor: null,
                },
            ],
            model,
        );
        const P = mapPointId({ x: 111, y: 104 });
        const gang = (transport: string, terrain: OffroadTerrain, time: RouteTiming | null) => {
            const route = findRoute(
                strasse,
                buildRouteGraph(strasse, model, request({ land: transport }, { land: true })),
                ["A", P],
                terrain,
                time,
            );
            return route.segments.at(-1)?.travel_hours ?? Number.NaN;
        };
        const offen: OffroadTerrain = { land, rivers: NO_RIVERS };
        const zaeh: OffroadTerrain = { land, rivers: bach, ground: wald };

        it("🔴 zugefrorene Bäche quert der Schlitten ohne Aufenthalt, die Gruppe zu Fuß nicht (WI-0258: Wald bremst ihn wie jeden)", () => {
            const winter = timing("firun", "gemaessigt");
            const nurBach: OffroadTerrain = { land, rivers: bach };
            const nurWald: OffroadTerrain = { land, rivers: NO_RIVERS, ground: wald };
            const schlitten = gang("sleigh", offen, winter);
            expect(Number.isFinite(schlitten)).toBe(true);
            expect(gang("sleigh", nurBach, winter)).toBeCloseTo(schlitten, 9);
            expect(gang("groupFoot", nurBach, winter)).toBeGreaterThan(gang("groupFoot", offen, winter) + 0.1);
            // Der Wald (Faktor 1,5) bremst beide.
            expect(gang("sleigh", nurWald, winter)).toBeGreaterThan(schlitten + 0.1);
            expect(gang("groupFoot", zaeh, winter)).toBeGreaterThan(gang("groupFoot", offen, winter) + 0.1);
        });

        it("im Sommer gibt es auch querfeldein keinen Schlitten", () => {
            const route = findRoute(
                strasse,
                buildRouteGraph(strasse, model, request({ land: "sleigh" }, { land: true })),
                ["A", P],
                offen,
                timing("praios", "gemaessigt"),
            );
            expect(route.found).toBe(false);
        });

        it("die Bäche frieren zu, die Flüsse bleiben Wände", () => {
            const rivers = prepareRivers(
                [
                    {
                        coordinates: [
                            [0, 0],
                            [10, 0],
                        ],
                        isBach: true,
                        flowDirection: null,
                        flowFactor: null,
                    },
                    {
                        coordinates: [
                            [0, 5],
                            [10, 5],
                        ],
                        isBach: false,
                        flowDirection: null,
                        flowFactor: null,
                    },
                ],
                model,
            );
            const frozen = frozenBrooks(rivers);
            expect(frozen.fords).toEqual([]);
            expect(frozen.walls).toBe(rivers.walls);
            expect([...frozen.grid.values()].flat().every((line) => line >= 0)).toBe(true);
            expect(frozenBrooks(rivers)).toBe(frozen);
        });
    });
});

describe("Neue Seeschiffe und Ruderboot im freien Seerouting", () => {
    type Ring = [number, number][];
    const box = (minX: number, minY: number, maxX: number, maxY: number): Ring => [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
    ];
    const area = (ring: Ring, regionType: WaterRegionType, id: string) => {
        const xs = ring.map(([x]) => x);
        const ys = ring.map(([, y]) => y);
        return {
            geometry: { type: "Polygon", coordinates: [ring] },
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
            regionName: id,
            regionType,
            areaPublicId: id,
        };
    };
    // Ein Meer, ein abgeschlossener See weit östlich und ein See, der ans Meer stößt.
    const water = prepareNavigableWater([
        area(box(0, 0, 40, 20), "meer", "meer"),
        area(box(60, 0, 80, 10), "see", "binnensee"),
        area(box(40, 8, 46, 12), "see", "haff"),
    ]);
    const grid = buildSeaGrid(water, 0.5);
    const places = [
        ort("west", -0.5, 10.25),
        ort("nord", 20, 20.5),
        ort("seeWest", 59.5, 5),
        ort("seeOst", 80.5, 5),
        ort("haff", 46.5, 10),
        ort("haffNord", 43, 12.5),
    ];
    const network = buildRouteNetwork(places, []);
    const transports = ["cargoShip", "galley", "rowboat"];
    const visibility = new VisibilityGraph(grid, [
        box(0, 0, 40, 20).slice(0, 4),
        box(60, 0, 80, 10).slice(0, 4),
        box(40, 8, 46, 12).slice(0, 4),
    ]);
    visibility.weigh(
        transports.map((transport) => coastProfile(model, transport)),
        coastDistance(grid),
    );
    const ports = places.map((place) => {
        const landing = nearestWaterCell(grid, place.x, place.y, 3) as { x: number; y: number };
        return { placeId: place.id, node: visibility.attach(landing.x, landing.y) };
    });
    const snapshot = visibility.snapshot();
    const blocked = blockedEdges(snapshot, transports, model, grid, waterKindCells(grid, water));
    const graph: CompactSeaGraph = compactSeaGraph(snapshot, transports, ports, waterMask(grid), undefined, blocked);
    const report = watersReport(graph, model);
    const freeSea = new FreeSea(graph);
    const pair = (transport: string, from: string, to: string): number => {
        const count = ports.length;
        const index = graph.transports.indexOf(transport);
        const a = places.findIndex((place) => place.id === from);
        const b = places.findIndex((place) => place.id === to);
        return graph.pairs[index]?.[a * count + b] as number;
    };
    const fahrt = (sea: string, from: string, to: string) =>
        findRoute(network, buildRouteGraph(network, model, { ...request({ sea }, { sea: true }) }, NO_WATER, freeSea), [
            from,
            to,
        ]);

    it("🔴 das Ruderboot fährt auf jedem Binnensee, auch im Haff am Meer, aber nie hinaus aufs Meer", () => {
        expect(blocked.map((edges) => edges !== null)).toEqual([false, false, true]);
        expect(report).toEqual([{ transport: "rowboat", ports: 4 }]);
        expect(Number.isFinite(pair("rowboat", "seeWest", "seeOst"))).toBe(true);
        expect(Number.isFinite(pair("rowboat", "haff", "haffNord"))).toBe(true);
        expect(pair("rowboat", "west", "nord")).toBeNaN();
        expect(pair("rowboat", "west", "haff")).toBeNaN();
        expect(pair("rowboat", "haffNord", "nord")).toBeNaN();
        // Galeeren und Segler fahren Meer und See mit ihren Werten von See.
        expect(Number.isFinite(pair("galley", "seeWest", "seeOst"))).toBe(true);
        expect(Number.isFinite(pair("galley", "west", "haff"))).toBe(true);
        expect(pair("rowboat", "seeWest", "seeOst")).toBe(pair("galley", "seeWest", "seeOst"));

        const lake = fahrt("rowboat", "seeWest", "seeOst");
        expect(lake.found).toBe(true);
        expect(lake.segments[0]?.transport_type).toBe("rowboat");
        expect(fahrt("rowboat", "haff", "haffNord").found).toBe(true);
        expect(fahrt("rowboat", "west", "nord").found).toBe(false);
        expect(fahrt("rowboat", "west", "haff").found).toBe(false);
        // Auch die Linie gibt es nur mit Seereise: Der Graph kennt das Meer, das Ruderboot darf nicht hinaus.
        expect(freeSea.fleet("rowboat", 2.48, network.nodes)?.line("west", "nord")).toBeNull();
        expect(freeSea.fleet("rowboat", 2.48, network.nodes)?.line("seeWest", "seeOst")).not.toBeNull();
        expect(freeSea.fleet("galley", 10.41, network.nodes)?.line("west", "nord")).not.toBeNull();
    });

    it("🔴 die Kurierdromone fährt die Seereisen der Galeere mit ihrem eigenen Tempo", () => {
        expect(seaGraphTransport(model, "courierDromone")).toBe("galley");
        const galley = fahrt("galley", "west", "haff");
        const dromone = fahrt("courierDromone", "west", "haff");
        expect(dromone.found).toBe(true);
        expect(dromone.segments[0]?.transport_type).toBe("courierDromone");
        expect(dromone.segments[0]?.geometry).toEqual(galley.segments[0]?.geometry);
        const distance = dromone.segments[0]?.distance_units ?? 0;
        expect(dromone.travelHours).toBeCloseTo(travelHoursFromTime(model, distance / 9.92), 6);
        expect(galley.travelHours).toBeCloseTo(travelHoursFromTime(model, distance / 10.41), 6);
        // Je Stunde rudert die Galeere schneller (70 / 8 gegen 200 / 24), die Dromone rastet dafür nie.
        expect(dromone.travelHours).toBeGreaterThan(galley.travelHours);
    });

    it("ein Schiff, dessen Seereisen der Graph nicht hält, fährt nicht frei (abgeleitet vor dem Reisemodell)", () => {
        // Dieser Testgraph hält keine Seereisen für den Schnellsegler.
        expect(freeSea.fleet("fastShip", 1, network.nodes)).toBeNull();
        expect(fahrt("fastShip", "west", "nord").found).toBe(false);
    });

    it("🔴 die Sperrzeit eines Gebiets gilt für den Erben wie für sein Schiff, unter dem eigenen Namen", () => {
        const window = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 } as const;
        const closed = new FreeSea({
            ...graph,
            closures: [{ name: "Golf", kind: "meer", reason: "vereisung", windows: { galley: window } }],
            pairClosures: graph.pairClosures.map((bits) => bits.map(() => 1)),
        });
        const fleet = closed.fleet("courierDromone", 9.92, network.nodes, "galley");
        expect(fleet?.hasClosures).toBe(true);
        const seasons: Record<string, unknown>[] = [];
        fleet?.hops("west", (_to, _distance, _cost, passage) => {
            if (passage.seasons) seasons.push(passage.seasons);
        });
        expect(seasons.length).toBeGreaterThan(0);
        expect(seasons.every((entry) => Object.keys(entry).join() === "courierDromone")).toBe(true);
    });
});
