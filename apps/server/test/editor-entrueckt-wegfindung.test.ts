import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, buildRouteStages, type RouteLeg } from "@avesmaps3d/shared";
import { buildRouteNetwork, type PathRow, type RouteNode } from "../src/routing/network.ts";
import { reportName } from "../src/routing/route-result.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { buildPlaceIndex } from "../src/routing/stage-context.ts";

/**
 * „Entrückt“ in der Wegfindung (WI-0128 E21, EDIT-0001 D21; Betreiber 2026-10-10: „im Limbus und nicht auf der Route“): Die Route
 * führt weiter durch den Ort, aber Reiseplan und Vermerke NENNEN ihn nicht.
 *
 * Problemfälle: Der Ort liegt mitten auf der Route und würde dort eine Etappe schließen; die Kantenfolge darf sich nicht ändern
 * (der Graph liest das Merkmal nicht); wer den Ort selbst als Ziel setzt, hat ihn gefunden und sieht ihn.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const ort = (id: string, name: string, x: number, y: number, entrueckt = false): RouteNode => ({
    id,
    name,
    kind: "place",
    isHidden: false,
    ...(entrueckt ? { isWithdrawn: true } : {}),
    subtype: "dorf",
    x,
    y,
});

const weg = (id: string, subtype: string, coordinates: [number, number][]): PathRow => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

/** Arras → Limbusheim → Brückendorf: ein Pfad bis Limbusheim, dann eine Straße. */
function reise(entrueckt: boolean, waypoints = ["arras", "brueckendorf"]) {
    const network = buildRouteNetwork(
        [
            ort("arras", "Arras", 100, 100),
            ort("limbus", "Limbusheim", 102, 100, entrueckt),
            ort("brueckendorf", "Brückendorf", 104, 100),
        ],
        [
            weg("pfad", "Pfad", [
                [100, 100],
                [101, 100.2],
                [102, 100],
            ]),
            weg("strasse", "Strasse", [
                [102, 100],
                [103, 99.8],
                [104, 100],
            ]),
        ],
    );
    const route = findRoute(network, buildRouteGraph(network, model, zuFuss), waypoints);
    const legs: RouteLeg[] = route.legs.map((leg) => ({
        from: leg.from,
        to: leg.to,
        segment_start: leg.segmentStart,
        segment_count: leg.segmentCount,
        distance_units: leg.distanceUnits,
        travel_hours: leg.travelHours,
    }));
    const index = buildPlaceIndex(network);
    const stages = buildRouteStages(
        route.segments,
        legs,
        { model, waypointIds: waypoints, placeAt: index.placeAt, placeNear: index.placeNear },
        { hoursPerDay: 8 },
    );
    return { network, route, stages };
}

const namen = (stages: ReturnType<typeof reise>["stages"]): string[] =>
    stages.flatMap((stage) => [stage.from.name, stage.to.name]);

describe("ein entrückter Ort auf der Route (E21)", () => {
    it("Gegenprobe: ohne das Merkmal schließt Limbusheim eine Etappe und steht im Reiseplan", () => {
        const { stages } = reise(false);
        expect(namen(stages)).toContain("Limbusheim");
    });

    it("🔴 mit dem Merkmal nennt der Reiseplan ihn nicht, und die Route bleibt dieselbe", () => {
        const normal = reise(false);
        const entrueckt = reise(true);
        expect(entrueckt.route.found).toBe(true);
        expect(namen(entrueckt.stages)).not.toContain("Limbusheim");
        expect(namen(entrueckt.stages)).toEqual(expect.arrayContaining(["Arras", "Brückendorf"]));
        // Der Graph liest das Merkmal nicht: dieselbe Kantenfolge, dieselbe Länge, dieselbe Zeit.
        expect(entrueckt.route.segments.map((segment) => segment.edge_id)).toEqual(
            normal.route.segments.map((segment) => segment.edge_id),
        );
        expect(entrueckt.route.distanceUnits).toBeCloseTo(normal.route.distanceUnits, 12);
        expect(entrueckt.route.travelHours).toBeCloseTo(normal.route.travelHours, 12);
    });

    it("wer ihn selbst als Ziel setzt, sieht ihn: ein Wegpunkt der Anfrage wird genannt", () => {
        const { stages } = reise(true, ["arras", "limbus", "brueckendorf"]);
        expect(namen(stages)).toContain("Limbusheim");
    });

    it("der Vermerk einer Sperre nennt ihn nicht, wo die Route nur durchfährt (`reportName`)", () => {
        const { network } = reise(true);
        const name = reportName(network, new Set(["arras", "brueckendorf"]));
        expect(name("limbus")).toBe("");
        expect(name("arras")).toBe("Arras");
    });

    it("🔴 ist er selbst Station der Anfrage, nennt ihn auch der Vermerk - eine Antwort, eine Auskunft über denselben Ort", () => {
        const { network } = reise(true, ["arras", "limbus"]);
        expect(reportName(network, new Set(["arras", "limbus"]))("limbus")).toBe("Limbusheim");
    });
});
