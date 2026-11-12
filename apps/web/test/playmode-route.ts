import type { RouteResponse, RouteSegment, RouteStage } from "@avesmaps3d/shared";

/**
 * Eine Reise für die Tests des Playmodes: drei Etappen zu je 20 Reisestunden, ohne Karte und ohne Server.
 */

function segment(index: number, from: [number, number], to: [number, number], hours: number): RouteSegment {
    return {
        index,
        edge_id: `e${String(index)}`,
        public_id: "",
        from_node: "a",
        to_node: "b",
        from_node_id: "a",
        to_node_id: "b",
        subtype: "Strasse",
        path_name: "",
        transport_type: "groupFoot",
        distance_units: Math.hypot(to[0] - from[0], to[1] - from[1]),
        cost_units: hours,
        cost_factor: 1,
        travel_hours: hours,
        flow_time_factor: 1,
        flow_state: "none",
        synthetic: false,
        offroad: false,
        geometry: { type: "LineString", coordinates: [from, to] },
    };
}

const point = (name: string, x: number, y: number): RouteStage["from"] => ({
    point: "place",
    place_id: name,
    name,
    x,
    y,
});

function stage(index: number, hours: number, from: RouteStage["from"], to: RouteStage["from"]): RouteStage {
    return {
        index,
        leg_index: 0,
        segment_start: index,
        segment_count: 1,
        type: "Strasse",
        transport: "groupFoot",
        flow_state: null,
        path_names: [],
        from,
        to,
        distance_units: 10,
        travel_hours: hours,
        rest_hours: 0,
    };
}

/** Drei Etappen zu je 20 Reisestunden: 60 Stunden, also 15 s Wiedergabe. */
export function journeyRoute(): RouteResponse {
    const a = point("A", 0, 0);
    const b = point("B", 10, 0);
    const c = point("C", 20, 0);
    const d = point("D", 30, 0);
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: "A", name: "A" },
            { id: "D", name: "D" },
        ],
        legs: [],
        segments: [segment(0, [0, 0], [10, 0], 20), segment(1, [10, 0], [20, 0], 20), segment(2, [20, 0], [30, 0], 20)],
        distance_units: 30,
        travel_hours: 60,
        travel_days: 7.5,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: 60,
        miles_per_unit: 3,
        air_legs_units: [30],
        stages: [stage(0, 20, a, b), stage(1, 20, b, c), stage(2, 20, c, d)],
        warnings: [],
    };
}
