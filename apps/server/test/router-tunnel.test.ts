import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, mapPointId } from "@avesmaps3d/shared";
import { buildRouteNetwork, type PathRow, type RouteNode } from "../src/routing/network.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type OffroadTerrain, type RouteRequest } from "../src/routing/router.ts";
import { techNodeId } from "../src/routing/topology.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Der Tunnel in der Wegfindung (WI-0177, Migration 0172; Betreiber 2026-10-18, wörtlich: „der tunnel hat doch eine einschränkung:
 * er ist davon ausgenommen, dass man von/auf ihn querfeldein kann“). Entlang eines Tunnels steigt kein Gang querfeldein ein oder
 * aus; betreten und verlassen wird er an seinen Enden, über anschließende Wege oder Orte.
 *
 * Problemfälle: Ein Kartenpunkt nahe der Tunnelmitte springt in den Tunnel; ein Ort ohne Weg bekommt seinen Fußpunkt im Tunnel; eine
 * Brücke zwischen Netzteilen endet an einem Knoten im Berg; der Tunnel ist gar nicht mehr befahrbar. Jeder Fall rechnet auch ohne
 * das Merkmal, damit der Test zeigt, dass er beißt.
 */

const model = AVENTURIA_TRAVEL_MODEL;

function ort(id: string, x: number, y: number): RouteNode {
    return { id, name: id, kind: "place", isHidden: false, x, y };
}

function weg(id: string, subtype: string, coordinates: [number, number][], tunnel = false): PathRow {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
        ...(tunnel ? { is_tunnel: true } : {}),
    };
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: false, sea: false },
    minimizeTransfers: false,
};

/** Alles Land. */
const land = prepareWater([
    {
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [300, 0],
                    [300, 300],
                    [0, 300],
                    [0, 0],
                ],
            ],
        },
        minX: 0,
        minY: 0,
        maxX: 300,
        maxY: 300,
    },
]);
const gelaende: OffroadTerrain = { land, rivers: NO_RIVERS };

const abfolge = (route: ReturnType<typeof findRoute>): string[] =>
    route.segments.map((segment) => `${segment.subtype}:${segment.from_node}>${segment.to_node}`);

/**
 * Ein Tunnel von A (100|100) nach B (120|100) mit Stützpunkten bei 105, 110 und 115, dahinter eine Zufahrt von B nach D (130|100).
 * A liegt am blinden Ende des Tunnels, B an seinem Ausgang.
 */
const netz = (tunnel: boolean, extra: RouteNode[] = []) =>
    buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 120, 100), ort("D", 130, 100), ...extra],
        [
            weg(
                "tunnel",
                "Strasse",
                [
                    [100, 100],
                    [105, 100],
                    [110, 100],
                    [115, 100],
                    [120, 100],
                ],
                tunnel,
            ),
            weg("zufahrt", "Strasse", [
                [120, 100],
                [130, 100],
            ]),
        ],
    );

describe("Tunnel: kein Zugang querfeldein entlang des Abschnitts (WI-0177)", () => {
    const P = mapPointId({ x: 111, y: 104 });

    it("🔴 ein Kartenpunkt nahe der Tunnelmitte: ohne Tunnel steigt der Gang dort aus, mit Tunnel erst an seinem Ende", () => {
        const offen = netz(false);
        const ohne = findRoute(offen, buildRouteGraph(offen, model, zuFuss), ["D", P], gelaende);
        expect(abfolge(ohne)).toEqual([
            "Strasse:D>B",
            "Strasse:B>__wp_anchor_0",
            "Querfeldein:__wp_anchor_0>Kartenpunkt",
        ]);

        const berg = netz(true);
        const mit = findRoute(berg, buildRouteGraph(berg, model, zuFuss), ["D", P], gelaende);
        expect(mit.refused).toBeNull();
        expect(mit.segments.map((segment) => segment.public_id)).not.toContain("tunnel");
        expect(abfolge(mit)).toEqual(["Strasse:D>B", "Querfeldein:B>Kartenpunkt"]);
        expect(mit.segments.at(-1)?.geometry.coordinates[0]).toEqual([120, 100]);
    });

    it("🔴 Gegenfall: Betreten und Verlassen an den Enden geht, der Tunnel bleibt befahrbar", () => {
        const berg = netz(true);
        // Von A am blinden Ende durch den ganzen Tunnel, am Ausgang B hinaus querfeldein.
        const route = findRoute(berg, buildRouteGraph(berg, model, zuFuss), ["A", P], gelaende);
        expect(abfolge(route)).toEqual(["Strasse:A>B", "Querfeldein:B>Kartenpunkt"]);
        expect(route.segments[0]).toMatchObject({ public_id: "tunnel", distance_units: 20 });
        // Tempo und Mittel bleiben die der Wegart: dieselbe Fahrt ohne das Merkmal dauert gleich lang.
        const offen = netz(false);
        const durch = findRoute(offen, buildRouteGraph(offen, model, zuFuss), ["A", "D"]);
        const durchBerg = findRoute(berg, buildRouteGraph(berg, model, zuFuss), ["A", "D"]);
        expect(abfolge(durchBerg)).toEqual(abfolge(durch));
        expect(durchBerg.travelHours).toBeCloseTo(durch.travelHours, 9);
    });

    it("🔴 ein Ort ohne Weg nahe am Tunnel bekommt seinen Fußpunkt nicht im Tunnel, sondern am Ausgang", () => {
        const C = ort("C", 114, 103);
        const offen = netz(false, [C]);
        expect(abfolge(findRoute(offen, buildRouteGraph(offen, model, zuFuss), ["D", "C"]))).toEqual([
            "Strasse:D>B",
            "Strasse:B>__wp_anchor_0",
            "Querfeldein:__wp_anchor_0>C",
        ]);
        const berg = netz(true, [C]);
        expect(abfolge(findRoute(berg, buildRouteGraph(berg, model, zuFuss), ["D", "C"]))).toEqual([
            "Strasse:D>B",
            "Querfeldein:B>C",
        ]);
    });

    it("🔴 eine Brücke zwischen Netzteilen endet nicht an einem Knoten im Berg", () => {
        // Zwei Tunnelstücke, Ende an Ende: Der Knoten dazwischen (110|100) liegt im Berg. Der Bericht nennt einen technischen Knoten
        // nicht, also steht er nur in der Kennung der Brücke. Ein Pfad nördlich davon ist ein eigener
        // Netzteil; seine Brücke führte ohne das Merkmal auf diesen Knoten, mit ihm an ein Ende.
        const knoten = techNodeId("110.00000:100.00000");
        const baue = (tunnel: boolean) =>
            buildRouteNetwork(
                [ort("A", 100, 100), ort("B", 120, 100), ort("E", 110, 105), ort("F", 110, 115)],
                [
                    weg(
                        "tunnel-a",
                        "Strasse",
                        [
                            [100, 100],
                            [110, 100],
                        ],
                        tunnel,
                    ),
                    weg(
                        "tunnel-b",
                        "Strasse",
                        [
                            [110, 100],
                            [120, 100],
                        ],
                        tunnel,
                    ),
                    weg("pfad", "Pfad", [
                        [110, 105],
                        [110, 115],
                    ]),
                ],
            );
        const offen = baue(false);
        const ohne = findRoute(offen, buildRouteGraph(offen, model, zuFuss), ["A", "F"], {
            land: NO_WATER,
            rivers: NO_RIVERS,
        });
        expect(ohne.segments.some((segment) => segment.synthetic && segment.edge_id.includes(knoten))).toBe(true);
        const berg = baue(true);
        const mit = findRoute(berg, buildRouteGraph(berg, model, zuFuss), ["A", "F"], {
            land: NO_WATER,
            rivers: NO_RIVERS,
        });
        expect(mit.found).toBe(true);
        expect(mit.segments.some((segment) => segment.synthetic && segment.edge_id.includes(knoten))).toBe(false);
    });
});
