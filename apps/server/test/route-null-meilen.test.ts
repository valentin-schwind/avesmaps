import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, buildRouteStages, type RouteLeg } from "@avesmaps3d/shared";
import { buildRouteNetwork, type PathRow, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { buildPlaceIndex } from "../src/routing/stage-context.ts";

/**
 * Betreiber 2026-10-11 (Stage, `?s=t8Vi3c6W`): „ein teilstück von 0 meilen findet sich zwischen moorbrück und gerrun … das
 * darf weder auf der karte noch im routenplaner in den etappen auftauchen.“
 *
 * Die Kette, am echten Router ohne Datenbank, mit den Wegenden aus dem Datenstand: Der Pfad von Moorbrück endet bei
 * (491,29999 | 501,26874), die Treidelstraße beginnt bei (491,3 | 501,269) - 0,00026 Einheiten daneben.
 *
 * 🔴 **Seit dem Fangradius (`END_SNAP`, Betreiber 2026-10-14, seit WI-0147 0,005) ist dieser Fall geheilt**, nicht nur versteckt: Die
 * beiden Enden liegen unter dem Radius und bekommen denselben Knoten. Es entsteht kein Stück querfeldein mehr, das der
 * Reiseplan anschließend verbergen müsste - die Route hat zwei Abschnitte statt drei.
 *
 * Der alte Stand steht hier zum Vergleich: Davor waren es zwei Netzteile, die Brückensuche (`componentBridges`) legte ein
 * Stück querfeldein dazwischen, und `mergeStageEntries` hielt es aus den Etappen heraus. Dass der Reiseplan keine Etappe
 * von 0,00 Meilen zeigt und die Summen stimmen, wird weiter geprüft - jetzt eben ohne die Brücke.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const MILES = model.meilenJeKarteneinheit.wert;
const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const ort = (id: string, name: string, x: number, y: number): RouteNode => ({
    id,
    name,
    kind: "place",
    isHidden: false,
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

/** Moorbrück → Gerrun; `strasseBeginn` ist der Anfang der Treidelstraße. */
function reise(strasseBeginn: [number, number]) {
    const network = buildRouteNetwork(
        [ort("moorbrueck", "Moorbrück", 495.70312, 500.40625), ort("gerrun", "Gerrun", 489.70846, 504.59446)],
        [
            weg("pfad", "Pfad", [
                [495.70312, 500.40622],
                [493.76381, 501.29584],
                [492.72989, 501.28424],
                [491.29999, 501.26874],
            ]),
            weg("treidelstrasse", "Strasse", [
                strasseBeginn,
                [491.156, 501.906],
                [489.922, 504.25],
                [489.708, 504.594],
            ]),
        ],
    );
    const waypoints = ["moorbrueck", "gerrun"];
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
    return { route, stages };
}

describe("Ein Stück querfeldein von 0,00 Meilen (Moorbrück → Gerrun)", () => {
    it("🔴 der Fangradius heilt die knapp verfehlten Wegenden: zwei Abschnitte, kein Stück querfeldein", () => {
        const { route } = reise([491.3, 501.269]);
        expect(route.found).toBe(true);
        // 0,00026 liegt unter `END_SNAP`: ein Knoten, keine Brücke.
        expect(route.segments.map((segment) => [segment.subtype, segment.synthetic])).toEqual([
            ["Pfad", false],
            ["Strasse", false],
        ]);
        expect(route.segments.some((segment) => segment.synthetic)).toBe(false);
    });

    it("🔴 der Reiseplan zeigt keine Etappe von 0,00 Meilen: EIN Marsch von Moorbrück nach Gerrun, die Summen bleiben", () => {
        const { route, stages } = reise([491.3, 501.269]);
        expect(stages.map((stage) => [stage.type, stage.from.name, stage.to.name])).toEqual([
            ["Pfad", "Moorbrück", "Gerrun"],
        ]);
        expect(stages.filter((stage) => stage.distance_units * MILES < 0.01)).toEqual([]);
        expect(stages.map((stage) => [stage.segment_start, stage.segment_count])).toEqual([[0, 2]]);
        const sum = (pick: (stage: (typeof stages)[number]) => number) =>
            stages.reduce((total, stage) => total + pick(stage), 0);
        expect(sum((stage) => stage.distance_units)).toBeCloseTo(route.distanceUnits, 12);
        expect(sum((stage) => stage.travel_hours)).toBeCloseTo(route.travelHours, 12);
    });

    it("der Reiseplan ist derselbe wie mit verbundenen Wegen, wie ihn der Wegeeditor herstellt", () => {
        const plan = (stages: ReturnType<typeof reise>["stages"]) =>
            stages.map((stage) => [stage.type, stage.from.name, stage.to.name, stage.path_names, stage.rest_hours]);
        const verfehlt = reise([491.3, 501.269]);
        const verbunden = reise([491.29999, 501.26874]);
        expect(verbunden.route.segments.some((segment) => segment.synthetic)).toBe(false);
        expect(plan(verfehlt.stages)).toEqual(plan(verbunden.stages));
    });

    it("eine echte Lücke (0,05 Einheiten, 0,15 Meilen) bleibt ihre eigene Querfeldein-Etappe", () => {
        const { stages } = reise([491.29999, 501.31874]);
        expect(stages.map((stage) => [stage.type, stage.from.point, stage.to.point])).toEqual([
            ["Pfad", "place", "exit"],
            ["Querfeldein", "exit", "join"],
            ["Strasse", "join", "place"],
        ]);
    });
});
