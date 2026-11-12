import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    dayOfYear,
    FREE_SEA_EDGE_PREFIX,
    ROUTE_FREE_SEA_LIMIT,
    RouteQuerystring,
    travelHoursFromTime,
    travelSpeed,
    type SeasonWindow,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { closureCells, combinedWindow, type SeaClosure } from "../src/routing/sea-closures.ts";
import { coastDistance, coastProfile } from "../src/routing/sea-coast.ts";
import { FreeSea } from "../src/routing/sea-free.ts";
import {
    clearOnMask,
    compactSeaGraph,
    decodeSeaGraph,
    encodeSeaGraph,
    waterMask,
} from "../src/routing/sea-graph-store.ts";
import { buildSeaGrid, nearestWaterCell, prepareNavigableWater } from "../src/routing/sea-grid.ts";
import { RouteService, type RoutingSource } from "../src/routing/service.ts";
import { revisionOf } from "./support/routing-revision.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";
import { areaEdges, NO_WATER } from "../src/routing/water.ts";

/**
 * Die freie Seefahrt im Planer (WI-0046, Schritt c): Das Schiff fährt über den Seegraphen von Hafen zu Hafen, nie über die
 * gezeichneten Seewege (seit WI-0153 Schnitt 7e auch nicht mehr als Vergleich oder Rückfall, Betreiber 2026-10-17).
 *
 * Ein Meer 0..40 x 0..20 mit einer kleinen Insel (19..21 x 2..3). West und Ost liegen an Land neben dem
 * Meer, verbunden durch einen weit geschwungenen Seeweg. Auf der Insel liegen ein Hafen und ein Dorf.
 */

const model = AVENTURIA_TRAVEL_MODEL;
type Ring = [number, number][];
const box = (minX: number, minY: number, maxX: number, maxY: number): Ring => [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
];
const water = prepareNavigableWater([
    {
        geometry: { type: "Polygon", coordinates: [box(0, 0, 40, 20), box(19, 2, 21, 3)] },
        minX: 0,
        minY: 0,
        maxX: 40,
        maxY: 20,
        regionName: "Meer",
        regionType: "meer",
        areaPublicId: "0",
    },
]);
const grid = buildSeaGrid(water, 0.5);

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });
const weg = (id: string, subtype: string, coordinates: [number, number][]) => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

const places = [ort("west", -0.5, 10.25), ort("ost", 40.5, 10.25), ort("insel", 20, 2.5), ort("dorf", 20.8, 2.9)];
const network = buildRouteNetwork(places, [
    weg("seeweg", "Seeweg", [
        [-0.5, 10.25],
        [20, 18],
        [40.5, 10.25],
    ]),
    weg("inselstrasse", "Strasse", [
        [20, 2.5],
        [20.8, 2.9],
    ]),
]);

/** Der Seegraph des Meeres für Frachter und Galeere, mit West, Ost und dem Inselhafen. */
function seaGraph(closures?: { list: SeaClosure[]; cells: Uint8Array }) {
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
    const transports = ["cargoShip", "galley"];
    graph.weigh(
        transports.map((transport) => coastProfile(model, transport)),
        coastDistance(grid),
    );
    const ports = ["west", "ost", "insel"].map((placeId) => {
        const place = places.find((candidate) => candidate.id === placeId) as RouteNode;
        const landing = nearestWaterCell(grid, place.x, place.y, 3) as { x: number; y: number };
        return { placeId, node: graph.attach(landing.x, landing.y) };
    });
    return compactSeaGraph(graph.snapshot(), transports, ports, waterMask(grid), closures);
}
const freeSea = new FreeSea(seaGraph());

const frei: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
const route = (request: RouteRequest, stations: string[]) =>
    findRoute(network, buildRouteGraph(network, model, request, NO_WATER, freeSea), stations);

describe("Freie Seefahrt im Router (WI-0046)", () => {
    it("fährt frei von Hafen zu Hafen statt über den Seeweg, das Hafenstück gehört dazu", () => {
        const result = route(frei, ["west", "ost"]);
        expect(result.found).toBe(true);
        expect(result.segments).toHaveLength(1);
        const [segment] = result.segments;
        expect(segment).toMatchObject({
            edge_id: `${FREE_SEA_EDGE_PREFIX}west-ost`,
            subtype: "Seeweg",
            transport_type: "cargoShip",
            from_node_id: "west",
            to_node_id: "ost",
        });
        const line = segment?.geometry.coordinates ?? [];
        expect(line[0]).toEqual([-0.5, 10.25]);
        expect(line[line.length - 1]).toEqual([40.5, 10.25]);
        // Gemessen an der Linie vom Hafen zum Hafen, über den Seegraphen und nicht über den Bogen des Seewegs.
        let length = 0;
        for (let index = 1; index < line.length; index += 1) {
            const [ax, ay] = line[index - 1] as [number, number];
            const [bx, by] = line[index] as [number, number];
            length += Math.hypot(bx - ax, by - ay);
        }
        expect(segment?.distance_units).toBeCloseTo(length, 3);
        expect(length).toBeLessThan(42);
        // Die Zeichenlinie beginnt und endet am Hafen; auf offener See bleibt sie gerade.
        const display = segment?.display?.coordinates ?? [];
        expect(display[0]).toEqual([-0.5, 10.25]);
        expect(display[display.length - 1]).toEqual([40.5, 10.25]);
    });

    it("🔴 fährt ohne Seegraph nie über den gezeichneten Seeweg (WI-0153 Schnitt 7e)", () => {
        const result = findRoute(network, buildRouteGraph(network, model, frei, NO_WATER, null), ["west", "ost"]);
        expect(result.segments.some((segment) => segment.edge_id === "seeweg#0")).toBe(false);
    });

    it("🔴 kennt der Seegraph das Schiff nicht, gibt es keine Seereise und keinen Rückfall auf den Seeweg", () => {
        const result = route({ ...frei, transports: { ...frei.transports, sea: "fastShip" } }, ["west", "ost"]);
        expect(result.segments.some((segment) => segment.subtype === "Seeweg")).toBe(false);
    });

    it("wählt nach dem Küstenabstand und meldet die gefahrene Länge ohne Aufschlag", () => {
        const galley = route({ ...frei, transports: { ...frei.transports, sea: "galley" } }, ["west", "ost"]);
        const cargo = route(frei, ["west", "ost"]);
        const [segment] = galley.segments;
        // Die Galeere hält sich an die Küste: länger, und die Suche hat dafür einen Aufschlag bezahlt.
        expect(segment?.distance_units).toBeGreaterThan((cargo.segments[0]?.distance_units ?? 0) + 1);
        expect(segment?.cost_factor).toBeGreaterThan(1);
        // Ihre Zeichenlinie ist geglättet und bleibt zwischen den Anlegestellen über Wasser.
        const display = segment?.display?.coordinates ?? [];
        expect(display.length).toBeGreaterThan(4);
        for (let index = 2; index < display.length - 1; index += 1) {
            const [ax, ay] = display[index - 1] as [number, number];
            const [bx, by] = display[index] as [number, number];
            expect(clearOnMask(freeSea.graph.mask, ax, ay, bx, by)).toBe(true);
        }
        const speed = travelSpeed(model, "galley", "Seeweg") as number;
        expect(segment?.travel_hours).toBeCloseTo(
            travelHoursFromTime(model, (segment?.distance_units ?? 0) / speed),
            6,
        );
    });

    it("erreicht eine Insel ohne Seeweg über See und fährt dort auf der Straße weiter", () => {
        const result = route(frei, ["west", "dorf"]);
        expect(
            result.segments.map((segment) => `${segment.subtype}:${segment.from_node_id}>${segment.to_node_id}`),
        ).toEqual(["Seeweg:west>insel", "Strasse:insel>dorf"]);
        // Die See verbindet die Insel mit dem Festland: Es braucht keine Notverbindung dorthin.
        expect(result.segments.some((segment) => segment.synthetic)).toBe(false);
    });

    it("🔴 bricht nach ROUTE_FREE_SEA_LIMIT Seereisen ab, statt die ganze Reise zu rechnen (S-04, S-10)", () => {
        const stationen = (n: number) => Array.from({ length: n }, (_, index) => (index % 2 === 0 ? "west" : "ost"));
        expect(route(frei, stationen(ROUTE_FREE_SEA_LIMIT + 1)).tooLarge).toBeNull();
        const zuViel = route(frei, stationen(ROUTE_FREE_SEA_LIMIT + 2));
        expect(zuViel.tooLarge).toBe(`sea_legs:${String(ROUTE_FREE_SEA_LIMIT + 1)}`);
        expect(zuViel.segments).toEqual([]);
    });

    it("ohne See fährt auch der Schalter nicht übers Meer", () => {
        const result = route({ ...frei, enabled: { land: true, river: true, sea: false } }, ["west", "ost"]);
        expect(result.segments.some((segment) => segment.subtype === "Seeweg")).toBe(false);
    });
});

describe("Freie Seefahrt im Rechendienst", () => {
    const source = (withSea: boolean): RoutingSource & { seaLoads: number } => {
        const counter = {
            seaLoads: 0,
            revision: () => Promise.resolve(revisionOf("r1")),
            load: () =>
                Promise.resolve({
                    network,
                    water: NO_WATER,
                    land: NO_WATER,
                    rivers: NO_RIVERS,
                    ground: NO_GROUND,
                    climate: NO_CLIMATE,
                    revision: revisionOf("r1"),
                }),
            ...(withSea
                ? {
                      loadSea: () => {
                          counter.seaLoads += 1;
                          return Promise.resolve(freeSea.graph);
                      },
                  }
                : {}),
        };
        return counter;
    };
    const query = { ...frei, waypoints: ["west", "ost"] };

    it("lädt den Seegraphen einmal", async () => {
        const counted = source(true);
        const service = new RouteService({ mapDomain: "test", model, source: counted });
        const free = await service.route(query);
        await service.route(query);
        expect(counted.seaLoads).toBe(1);
        expect(free.ok && free.response.segments[0]?.edge_id).toBe(`${FREE_SEA_EDGE_PREFIX}west-ost`);
        expect(free.ok && free.response.warnings).toEqual([]);
    });

    it("antwortet bei zu vielen Seereisen route_too_large, wie bei zu vielen Abschnitten", async () => {
        const service = new RouteService({ mapDomain: "test", model, source: source(true) });
        const waypoints = Array.from({ length: ROUTE_FREE_SEA_LIMIT + 2 }, (_, index) =>
            index % 2 === 0 ? "west" : "ost",
        );
        expect(await service.route({ ...query, waypoints })).toEqual({
            ok: false,
            error: "route_too_large",
            detail: `sea_legs:${String(ROUTE_FREE_SEA_LIMIT + 1)}`,
        });
    });

    it("🔴 sagt es, wenn es keinen Seegraphen gibt, und fährt nicht über die Seewege (WI-0153 Schnitt 7e)", async () => {
        const service = new RouteService({ mapDomain: "test", model, source: source(false) });
        const outcome = await service.route(query);
        if (outcome.ok) {
            expect(outcome.response.warnings).toContain("free_sea_unavailable");
            expect(outcome.response.segments.some((segment) => segment.edge_id === "seeweg#0")).toBe(false);
        }
    });

    it("nimmt den Schalter in der Adresse an, nur mit bekannten Werten", () => {
        const base = { waypoints: "00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002" };
        expect(Value.Check(RouteQuerystring, { ...base, sea_routing: "free" })).toBe(true);
        expect(Value.Check(RouteQuerystring, { ...base, sea_routing: "frei" })).toBe(false);
    });
});

describe("Sperrzeiten der freien See (S5)", () => {
    const window = (from_month: string, to_month: string): SeasonWindow => ({
        from_month,
        from_day: 1,
        to_month,
        to_day: 30,
    });
    const summer = window("praios", "efferd");
    const golf = window("peraine", "boron");
    const notWinter = window("peraine", "hesinde");

    it("schneidet die Fenster der Gebiete zu einem, auch über den Jahreswechsel", () => {
        expect(combinedWindow([])).toBeUndefined();
        expect(combinedWindow([golf])).toEqual(golf);
        expect(combinedWindow([golf, notWinter])).toEqual(golf);
        expect(combinedWindow([notWinter, summer])).toEqual(summer);
        // Kein gemeinsamer Tag: nie befahrbar.
        expect(combinedWindow([summer, window("travia", "boron")])).toBeNull();
        // Zwei Stücke (1. Praios bis 30. Praios und 1. Efferd bis 30. Boron): Das längere gilt.
        expect(combinedWindow([window("praios", "boron"), window("efferd", "praios")])).toEqual(
            window("efferd", "boron"),
        );
    });

    // Das ganze Meer vereist, befahrbar nur im Sommer.
    const icing: SeaClosure = {
        name: "Vereisung (test)",
        kind: "vereisung",
        zone: "test",
        reason: "vereisung",
        windows: { cargoShip: summer, galley: summer },
    };
    const frozen = decodeSeaGraph(
        encodeSeaGraph(
            seaGraph({
                list: [icing],
                cells: closureCells(grid, [
                    {
                        closure: 0,
                        edges: areaEdges({ type: "Polygon", coordinates: [box(0, 0, 40, 20)] }),
                        minY: 0,
                        maxY: 20,
                    },
                ]),
            }),
        ),
    );
    const frozenSea = new FreeSea(frozen);
    const timing = (month: "firun" | "praios") => ({
        departure: dayOfYear(month, 1),
        hoursPerDay: 8,
        climate: NO_CLIMATE,
    });
    const frozenRoute = (month: "firun" | "praios" | null) =>
        findRoute(
            network,
            buildRouteGraph(network, model, frei, NO_WATER, frozenSea),
            ["west", "ost"],
            undefined,
            month === null ? null : timing(month),
        );

    it("merkt sich je Hafenpaar die Gebiete auf dem Weg, auch nach Schreiben und Lesen", () => {
        expect(frozen.closures).toEqual([icing]);
        // West - Ost fährt durch das vereiste Meer, für beide Schiffe.
        for (const bits of frozen.pairClosures) expect(bits[0 * 3 + 1]).toBe(1);
    });

    it("sperrt die Seereise im Winter und nennt das Gebiet im Bericht", () => {
        const winter = frozenRoute("firun");
        expect(winter.found).toBe(false);
        expect(winter.seasonClosed).toBe(true);
        expect(winter.closures[0]?.avoided[0]).toMatchObject({
            path_name: "Vereisung (test)",
            subtype: "Seeweg",
            reason: "vereisung",
            open_from: { month: "praios", day: 1 },
            open_to: { month: "efferd", day: 30 },
        });
    });

    it("fährt im Sommer und nennt ohne Reisebeginn die Sperrzeit", () => {
        const sommer = frozenRoute("praios");
        expect(sommer.found).toBe(true);
        expect(sommer.segments[0]?.edge_id).toBe(`${FREE_SEA_EDGE_PREFIX}west-ost`);
        const ohne = frozenRoute(null);
        expect(ohne.seasonalWays).toEqual([
            expect.objectContaining({ path_name: "Vereisung (test)", open_from: { month: "praios", day: 1 } }),
        ]);
        // Die Etappe selbst trägt keinen Namen: Der Reiseplan zeigt die Sperrgebiete nicht.
        expect(ohne.segments[0]?.path_name).toBe("");
    });
});
