import { describe, expect, it } from "vitest";
import type { RouteResponse, RouteSegment, RouteStage } from "@avesmaps3d/shared";
import { segmentShape } from "../src/map/route-layers.ts";
import { buildTimeline, mapHeading, stageDots } from "../src/route-planner/journey-timeline.ts";

/**
 * Die Zeitleiste des Playmodes (Kap. 6.41): Lage, Richtung, Etappe, Meilen und Tage zu jedem
 * Zeitpunkt einer Reise - reine Rechnung über ein fertiges Routenergebnis.
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

function route(): RouteResponse {
    // Zwei Etappen: 10 Einheiten nach Osten in 4 Stunden, dann 10 nach Norden in 12 Stunden.
    const segments = [segment(0, [0, 0], [10, 0], 4), segment(1, [10, 0], [10, 10], 12)];
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: "a", name: "A" },
            { id: "c", name: "C" },
        ],
        legs: [],
        segments,
        distance_units: 20,
        travel_hours: 16,
        travel_days: 2,
        hours_per_day: 8,
        rest_hours: 16,
        total_hours: 32,
        miles_per_unit: 3,
        air_legs_units: [14.1],
        stages: [
            {
                index: 0,
                leg_index: 0,
                segment_start: 0,
                segment_count: 1,
                type: "Strasse",
                transport: "groupFoot",
                flow_state: null,
                path_names: [],
                from: point("A", 0, 0),
                to: point("B", 10, 0),
                distance_units: 10,
                travel_hours: 4,
                rest_hours: 0,
            },
            {
                index: 1,
                leg_index: 0,
                segment_start: 1,
                segment_count: 1,
                type: "Strasse",
                transport: "groupFoot",
                flow_state: null,
                path_names: [],
                from: point("B", 10, 0),
                to: point("C", 10, 10),
                distance_units: 10,
                travel_hours: 12,
                rest_hours: 16,
            },
        ],
        warnings: [],
    };
}

describe("Die Zeitleiste einer Reise", () => {
    it("läuft über die Reisezeit: Die Etappengrenze liegt bei 4 von 16 Stunden", () => {
        const timeline = buildTimeline(route());
        expect(timeline.totalHours).toBe(16);
        expect(timeline.stageStarts).toEqual([0, 0.25]);
        expect(timeline.at(0)).toMatchObject({ x: 0, y: 0, stage: 0, miles: 0, days: 0 });
        // Nach 2 von 16 Stunden ist die Hälfte der ersten Etappe geschafft.
        expect(timeline.at(2 / 16)).toMatchObject({ x: 5, y: 0, stage: 0 });
        expect(timeline.at(1)).toMatchObject({ x: 10, y: 10, stage: 1 });
    });

    it("zählt Meilen und Tage mit, die Rast verteilt über die Etappe", () => {
        const timeline = buildTimeline(route());
        expect(timeline.totalMiles).toBeCloseTo(60, 9);
        // 16 Stunden Reise und 16 Stunden Rast sind 32 Stunden: 1⅓ Tage.
        expect(timeline.totalDays).toBeCloseTo(32 / 24, 9);
        expect(timeline.at(1).days).toBeCloseTo(32 / 24, 9);
        expect(timeline.at(0.25).miles).toBeCloseTo(30, 9);
    });

    it("die Richtung folgt dem Weg auf der Karte: erst nach Osten, dann nach Norden", () => {
        const timeline = buildTimeline(route());
        expect(timeline.at(0.1).heading).toBeCloseTo(mapHeading({ x: 0, y: 0 }, { x: 10, y: 0 }), 6);
        const east = timeline.at(0.1).heading;
        const north = timeline.at(0.9).heading;
        // Ein Viertel Drehung gegen den Uhrzeigersinn, gleich wie die Karte die Achsen legt.
        expect(Math.abs(((east - north + 540) % 360) - 180)).toBeCloseTo(90, 0);
    });

    it("hält den Anteil in der Zeitleiste", () => {
        const timeline = buildTimeline(route());
        expect(timeline.at(-1)).toEqual(timeline.at(0));
        expect(timeline.at(2)).toEqual(timeline.at(1));
    });
});

describe("Die Etappenpunkte auf der Leiste", () => {
    it("stehen an jedem Etappenanfang außer dem ersten, solange Platz ist", () => {
        expect(stageDots([0, 0.25, 0.5], 0.03)).toEqual([0.25, 0.5]);
    });

    it("🔴 zu enge werden einer, von links gezählt - keine Kette ohne Lücke", () => {
        expect(stageDots([0, 0.1, 0.11, 0.12, 0.14, 0.5], 0.03)).toEqual([0.1, 0.14, 0.5]);
    });

    it("ohne gemessene Leiste stehen alle", () => {
        expect(stageDots([0, 0.1, 0.101], 0)).toEqual([0.1, 0.101]);
    });
});

describe("Ein gebogener Gang querfeldein (Betreiber 2026-09-24: „kann diese auch mit catmull rom glätten“)", () => {
    // Ein Knick um ein Hindernis, wie ihn die Suche querfeldein liefert.
    const corner: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
    ];
    const bent = (): RouteSegment => ({
        ...segment(0, [0, 0], [10, 10], 16),
        synthetic: true,
        offroad: true,
        geometry: { type: "LineString", coordinates: corner },
    });

    /** Abstand eines Punkts zu einer Linie aus Punkten. */
    function distance(point: { x: number; y: number }, line: readonly { x: number; y: number }[]): number {
        let best = Number.POSITIVE_INFINITY;
        for (let index = 1; index < line.length; index += 1) {
            const a = line[index - 1]!;
            const b = line[index]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = dx * dx + dy * dy;
            const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
            best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
        }
        return best;
    }

    it("wird geglättet wie ein Weg und läuft durch jeden seiner Punkte; zwei Punkte bleiben eine gerade Sehne", () => {
        const shape = segmentShape(bent());
        expect(shape.length).toBeGreaterThan(corner.length);
        for (const [x, y] of corner) {
            expect(shape.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-9)).toBe(true);
        }
        const chord = segmentShape({ geometry: { type: "LineString", coordinates: [corner[0]!, corner[1]!] } });
        expect(chord).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ]);
    });

    it("🔴 zeichnet die Wegkurve des Servers, wo er sie liefert (`display`); gemessen bleibt geometry", () => {
        // Befund A (?s=kaHjKVsP): Das Wegstück glättete für sich allein und lag neben der gezeichneten
        // Straße; der Gang schien sie zu überqueren.
        const display = {
            type: "LineString" as const,
            coordinates: [
                [0, 0],
                [5, 0.3],
                [10, 0],
            ] as [number, number][],
        };
        const shape = segmentShape({ ...bent(), display });
        expect(shape[0]).toEqual({ x: 0, y: 0 });
        expect(shape.at(-1)).toEqual({ x: 10, y: 0 });
        expect(shape.some((p) => Math.hypot(p.x - 5, p.y - 0.3) < 1e-9)).toBe(true);
        // Ohne `display` gilt geometry, wie bisher (der Test davor).
        expect(shape.some((p) => Math.hypot(p.x - corner[2]![0], p.y - corner[2]![1]) < 1e-9)).toBe(false);
    });

    it("der Pfeil fährt die gezeichnete, geglättete Linie ab und schneidet keine Kurve", () => {
        const base = route();
        const timeline = buildTimeline({
            ...base,
            segments: [bent()],
            stages: [{ ...base.stages[0]!, segment_count: 1, travel_hours: 16 }],
        });
        const drawn = segmentShape(bent());
        const raw = corner.map(([x, y]) => ({ x, y }));
        const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((fraction) => timeline.at(fraction));
        for (const position of samples) expect(distance(position, drawn)).toBeLessThan(1e-9);
        // Die Glättung wirkt: Irgendwo liegt der Pfeil neben dem rohen Knick.
        expect(Math.max(...samples.map((position) => distance(position, raw)))).toBeGreaterThan(0.05);
    });
});
