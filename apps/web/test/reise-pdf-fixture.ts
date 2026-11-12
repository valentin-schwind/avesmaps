import type {
    RouteResponse,
    RouteSegment,
    RouteStage,
    RouteStagePoint,
    RouteUnterwegsEintrag,
} from "@avesmaps3d/shared";
import type { PlannerOptions } from "../src/route-planner/planner-model.ts";
import type { LandscapeEntry, LandscapeLines, TerritoryEntry } from "../src/route-planner/route-landscapes.ts";

/**
 * Eine kleine Reise für die Tests von „Reise als PDF“ (WI-0306): Gareth über Elenvina nach Havena, acht Reisestunden am Tag, Abreise am
 * 3. Peraine. Vier Etappen zu Lande bis Elenvina (4 + 4 + 4 + 2 Stunden; die Uhr bucht die Nacht von 16 Stunden vor der dritten), dann eine
 * Flussfahrt. Die Rast steht so in `rest_hours`, wie der Server sie bucht (`buildRouteStages`).
 */

export const ort = (name: string, extra: Partial<RouteStagePoint> = {}): RouteStagePoint => ({
    point: "place",
    place_id: name,
    name,
    x: 1,
    y: 2,
    ...extra,
});

const datum = (day: number): NonNullable<RouteStage["start_date"]> => ({
    month: "peraine",
    day,
    nameless: false,
    season: "fruehling",
    years_passed: 0,
});

export function etappe(
    index: number,
    von: RouteStagePoint,
    nach: RouteStagePoint,
    extra: Partial<RouteStage> = {},
): RouteStage {
    return {
        index,
        leg_index: 0,
        segment_start: index,
        segment_count: 1,
        type: "Strasse",
        transport: "groupFoot",
        flow_state: null,
        path_names: ["Reichsstraße 3"],
        from: von,
        to: nach,
        distance_units: 4,
        travel_hours: 4,
        rest_hours: 0,
        ...extra,
    };
}

const abschnitt = (index: number): RouteSegment =>
    ({
        index,
        edge_id: `e${String(index)}`,
        public_id: "",
        subtype: "Strasse",
        path_name: "",
        synthetic: false,
        distance_units: 4,
        travel_hours: 4,
        geometry: {
            type: "LineString",
            coordinates: [
                [index, 0],
                [index + 1, 1],
            ],
        },
        elevation_profile: [
            [0, 100 + index * 20],
            [4, 120 + index * 20],
        ],
    }) as unknown as RouteSegment;

export function reise(): RouteResponse {
    const gareth = ort("Gareth", { subtype: "metropole", territory: { id: "t-ag", name: "Alt-Gareth" } });
    const weyring = ort("Weyring");
    const ettingen = ort("Ettingen");
    const hornau = ort("Hornau");
    const elenvina = ort("Elenvina", { subtype: "grossstadt" });
    const havena = ort("Havena", { subtype: "metropole" });
    const stages: RouteStage[] = [
        etappe(0, gareth, weyring, {
            start_date: datum(3),
            end_date: datum(3),
            ground: { condition: "aufgeweicht", percent: 20 },
        }),
        etappe(1, weyring, ettingen, { start_date: datum(3), end_date: datum(3) }),
        etappe(2, ettingen, hornau, { rest_hours: 16, start_date: datum(4), end_date: datum(4) }),
        etappe(3, hornau, elenvina, { travel_hours: 2, distance_units: 2, start_date: datum(4), end_date: datum(4) }),
        etappe(4, elenvina, havena, {
            leg_index: 1,
            type: "Flussweg",
            transport: "riverSailer",
            flow_state: "downstream",
            path_names: ["Der Große Fluss"],
            travel_hours: 2,
            distance_units: 10,
            start_date: datum(4),
            end_date: datum(4),
        }),
    ];
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "t",
        routing_graph_revision: "r",
        waypoints: [
            { id: "Gareth", name: "Gareth" },
            { id: "Elenvina", name: "Elenvina" },
            { id: "Havena", name: "Havena" },
        ],
        legs: [],
        segments: stages.map((s) => abschnitt(s.segment_start)),
        distance_units: 24,
        travel_hours: 16,
        travel_days: 2,
        hours_per_day: 8,
        rest_hours: 16,
        total_hours: 32,
        miles_per_unit: 2,
        air_legs_units: [100, 50],
        stages,
        departure: datum(3),
        arrival: datum(4),
        warnings: [],
    } as unknown as RouteResponse;
}

export const optionen = (): PlannerOptions =>
    ({
        optimize: "fastest",
        minimizeTransfers: false,
        hurry: false,
        enabled: { land: true, river: true, sea: false },
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        hoursPerDay: 8,
        lodging: "bett",
    }) as unknown as PlannerOptions;

const gegend = (name: string): LandscapeEntry => ({
    key: name,
    name,
    art: "",
    type: "region",
    share: 0.5,
    target: null,
});
const gebiet = (id: string, name: string, parentId: string | null): TerritoryEntry => ({ id, name, parentId });

export function landschaften(): LandscapeLines {
    const kette = [
        gebiet("reich", "Heiliges Neues Kaiserreich", null),
        gebiet("garetien", "Königreich Garetien", "reich"),
        gebiet("raulsmark", "Baronie Kaiserlich Raulsmark", "garetien"),
    ];
    return {
        route: [gegend("Mittelaventurien"), gegend("Herz des Kontinents"), gegend("Der große Fluss")],
        stages: [
            [gegend("Mittelaventurien"), gegend("Herz des Kontinents")],
            [gegend("Mittelaventurien"), gegend("Goldene Au")],
            [gegend("Mittelaventurien")],
            [gegend("Mittelaventurien")],
            [gegend("Mittelaventurien"), gegend("Der große Fluss")],
        ],
        territories: [kette, kette, kette, kette, [gebiet("havena", "Havena", null)]],
        sprachen: [
            [{ ref: { kind: "sprache", id: "garethi" }, name: "Garethi", anteil: 0.97, farbe: "#000" }],
            [],
            [],
            [],
            [],
        ],
        routeSprachen: [{ ref: { kind: "sprache", id: "garethi" }, name: "Garethi", anteil: 0.95, farbe: "#000" }],
    } as unknown as LandscapeLines;
}

const UUID = "00000000-0000-4000-8000-0000000000";
export const vorkommen = (): RouteUnterwegsEintrag[] => [
    { id: `${UUID}01`, name: "Alaun", kind: "ware", etappen: [0, 1], gegend: "Herz des Kontinents" },
    { id: `${UUID}02`, name: "Aal", kind: "fauna", etappen: [4], gegend: "Der große Fluss" },
    { id: `${UUID}03`, name: "Auerochse", kind: "fauna", etappen: [0] },
];
