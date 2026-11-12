import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL as model,
    buildRouteTravelCosts,
    RouteBorders,
    RouteCosts,
    RouteResponse,
    RouteTravelCosts,
    type BorderCount,
    type RouteStage,
} from "../src/index.ts";

/**
 * `travel_costs` im Result (WI-0065 U2): das Schema und was es verwirft. Der Server serialisiert die Antwort nach
 * genau diesem Schema, und Fastifys Serialisierer lässt ein Feld STILL weg, das das Schema nicht kennt; der
 * HTTP-Test dazu gehört in U4. Hier steht, dass das Schema die richtige Form beschreibt und nichts durchlässt,
 * was es nicht kennt.
 */

type Stage = Pick<RouteStage, "type" | "transport" | "flow_state" | "distance_units" | "travel_hours">;
const strasse: Stage[] = [
    { type: "Strasse", transport: "groupFoot", flow_state: null, distance_units: 20, travel_hours: 20 },
];

const twoBorders: BorderCount = {
    count: 2,
    harbourTollUnknown: false,
    crossings: [
        {
            from: { id: "kaiserreich", name: "Heiliges Neues Kaiserreich", shortName: "Mittelreich" },
            to: { id: "aranien", name: "Mhaharanyat Aranien", shortName: "Aranien" },
            x: 551.6,
            y: 533,
        },
        {
            from: { id: "aranien", name: "Mhaharanyat Aranien", shortName: "Aranien" },
            to: { id: "kalifat", name: "Kalifat", shortName: "Kalifat" },
            x: 600,
            y: 480.25,
        },
    ],
};

const travelCosts = (borders: BorderCount | null) =>
    buildRouteTravelCosts(
        model,
        { stages: strasse, total_hours: 52 },
        { landTransport: "groupFoot", hoursPerDay: 8 },
        borders,
        borders === null ? null : 1049,
    );

/** Die kleinste gültige Antwort: die Pflichtfelder mit leeren Listen. */
const base: RouteResponse = {
    found: true,
    failed_leg_index: null,
    map_domain: "aventuria",
    travel_model_version: "0123456789ab",
    routing_graph_revision: "revision",
    waypoints: [],
    legs: [],
    segments: [],
    distance_units: 0,
    travel_hours: 0,
    travel_days: 0,
    hours_per_day: 8,
    rest_hours: 0,
    total_hours: 0,
    miles_per_unit: 3,
    air_legs_units: [],
    stages: [],
    warnings: [],
};

const withCosts = (travel_costs: unknown): unknown => ({ ...base, travel_costs });

describe("🔴 Das Schema von travel_costs", () => {
    it("eine Antwort mit den Kosten aller vier Stufen und den Grenzen ist gültig", () => {
        const response: RouteResponse = { ...base, travel_costs: travelCosts(twoBorders) };
        expect(Value.Check(RouteResponse, response)).toBe(true);
        expect(Value.Check(RouteTravelCosts, response.travel_costs)).toBe(true);
    });

    it("eine Antwort ohne das Feld ist gültig: es ist optional (Flug, found: false, ältere Server)", () => {
        expect(Value.Check(RouteResponse, base)).toBe(true);
        expect(Value.Check(RouteResponse, { ...base, found: false })).toBe(true);
    });

    it("🔴 null Grenzen (Gebiete nicht abgeleitet) sind gültig, ebenso der Zoll null mit Status UNKNOWN", () => {
        const unknown = travelCosts(null);
        expect(Value.Check(RouteResponse, withCosts(unknown))).toBe(true);
        expect(unknown.by_lodging.bett.rows.at(-1)).toEqual({
            key: "tolls",
            heller: null,
            status: "UNKNOWN",
            count: 0,
        });
    });

    it("die Grenzen tragen Kennung und Name beider Gebiete und den Ort", () => {
        expect(Value.Check(RouteBorders, travelCosts(twoBorders).borders)).toBe(true);
    });

    describe("was das Schema verwirft", () => {
        const clone = () => structuredClone(travelCosts(twoBorders)) as unknown as Record<string, unknown>;

        it("einen unbekannten Schlüssel auf jeder Ebene", () => {
            const top = clone();
            top["extra"] = 1;
            expect(Value.Check(RouteResponse, withCosts(top))).toBe(false);

            const level = clone();
            (level["by_lodging"] as Record<string, unknown>)["palast"] = (
                level["by_lodging"] as Record<string, unknown>
            )["bett"];
            expect(Value.Check(RouteResponse, withCosts(level))).toBe(false);

            const costs = clone();
            ((costs["by_lodging"] as Record<string, Record<string, unknown>>)["bett"] as Record<string, unknown>)[
                "extra"
            ] = true;
            expect(Value.Check(RouteResponse, withCosts(costs))).toBe(false);

            const crossing = clone();
            ((crossing["borders"] as { crossings: Record<string, unknown>[] }).crossings[0] as Record<string, unknown>)[
                "extra"
            ] = 1;
            expect(Value.Check(RouteResponse, withCosts(crossing))).toBe(false);
        });

        it("eine fehlende Stufe", () => {
            const partial = clone();
            delete (partial["by_lodging"] as Record<string, unknown>)["zimmer"];
            expect(Value.Check(RouteResponse, withCosts(partial))).toBe(false);
        });

        it("einen unbekannten Posten, einen unbekannten Status, einen Betrag als Text", () => {
            const rowOf = (costs: Record<string, unknown>): Record<string, unknown> =>
                (
                    (costs["by_lodging"] as Record<string, { rows: Record<string, unknown>[] }>)["bett"] as {
                        rows: Record<string, unknown>[];
                    }
                ).rows[0] as Record<string, unknown>;

            const key = clone();
            rowOf(key)["key"] = "hafenzoll";
            expect(Value.Check(RouteResponse, withCosts(key))).toBe(false);

            const status = clone();
            rowOf(status)["status"] = "GUESSED";
            expect(Value.Check(RouteResponse, withCosts(status))).toBe(false);

            const amount = clone();
            rowOf(amount)["heller"] = "12";
            expect(Value.Check(RouteResponse, withCosts(amount))).toBe(false);
        });

        it("das Jahr als Text und die Zahl der Grenzen mit Nachkommastellen", () => {
            const year = clone();
            year["territory_year_bf"] = "1049";
            expect(Value.Check(RouteResponse, withCosts(year))).toBe(false);

            const fraction = clone();
            (fraction["borders"] as Record<string, unknown>)["count"] = 1.5;
            expect(Value.Check(RouteResponse, withCosts(fraction))).toBe(false);
        });

        it("der Hinweis auf den Hafenzoll ist Pflicht und ein Wahrheitswert", () => {
            const missing = clone();
            delete (missing["borders"] as Record<string, unknown>)["harbour_toll_unknown"];
            expect(Value.Check(RouteResponse, withCosts(missing))).toBe(false);

            const text = clone();
            (text["borders"] as Record<string, unknown>)["harbour_toll_unknown"] = "ja";
            expect(Value.Check(RouteResponse, withCosts(text))).toBe(false);

            const set = clone();
            (set["borders"] as Record<string, unknown>)["harbour_toll_unknown"] = true;
            expect(Value.Check(RouteResponse, withCosts(set))).toBe(true);
        });

        it("das Feld fehlt nicht halb: borders und by_lodging sind Pflicht, sobald travel_costs da ist", () => {
            const noBorders = clone();
            delete noBorders["borders"];
            expect(Value.Check(RouteResponse, withCosts(noBorders))).toBe(false);

            const noYear = clone();
            delete noYear["territory_year_bf"];
            expect(Value.Check(RouteResponse, withCosts(noYear))).toBe(false);
        });
    });
});

describe("🪤 Kein $id an Teilen, die mehrfach vorkommen", () => {
    // Fastifys Serialisierer weist eine Kennung ab, die „auf mehr als ein Schema“ zeigt: Die ganze Route würde 500
    // (siehe `RouteStagePoint`). `RouteCosts` steht vier Mal in `by_lodging`, die Grenzen zwei Mal je Übertritt.
    it("RouteCosts, RouteBorders und RouteTravelCosts tragen keine Kennung", () => {
        for (const schema of [RouteCosts, RouteBorders, RouteTravelCosts]) {
            expect(schema).not.toHaveProperty("$id");
        }
        const byLodging = RouteTravelCosts.properties.by_lodging.properties;
        for (const level of Object.values(byLodging)) expect(level).not.toHaveProperty("$id");
        const crossing = RouteBorders.properties.crossings.items.properties;
        expect(crossing.from).not.toHaveProperty("$id");
        expect(crossing.to).not.toHaveProperty("$id");
    });
});
