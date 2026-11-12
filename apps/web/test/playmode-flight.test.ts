import { describe, expect, it } from "vitest";
import { MercatorCoordinate, type Map as MapLibreMap } from "maplibre-gl";
import {
    AIR_EDGE_PREFIX,
    AIR_TYPE,
    AVENTURIA,
    toRenderLngLat,
    type RouteResponse,
    type RouteSegment,
} from "@avesmaps3d/shared";
import { createCamera, FOLLOW_HEIGHT_SECONDS } from "../src/map/camera/camera.ts";
import type { Camera } from "../src/map/camera/camera.ts";
import {
    buildFlightTracks,
    flightPointAt,
    flightProfile,
    MERCATOR_PER_SCHRITT,
    projectToScreen,
} from "../src/map/flight-path.ts";
import type { TravelerPosition } from "../src/map/traveler-layer.ts";
import { createTravelerView } from "../src/map/traveler-view.ts";
import { buildTimeline } from "../src/route-planner/journey-timeline.ts";

/**
 * Der Pfeil des Playmodes fliegt auf der Flugbahn mit (WI-0051 F3, Betreiber 2026-09-28: „im playmode läuft der
 * pfeil noch am boden entlang, er soll in der luft mitfliegen“): seine Stelle auf dem Flug, die Höhe der Bahn
 * darüber aus demselben Profil, und die Kamera, die ihm in die Höhe folgt. Flach bleibt alles wie vorher.
 */

/** Punin → Perricum mit dem Hippogriff, der F2-Weg vom 2026-09-28: gerundet, also viele kleine Stücke. */
const UMWEG: [number, number][] = [
    [518.257, 441.229],
    [579.5, 498.531],
    [584.467, 501.499],
    [631.281, 507.328],
];

function segment(index: number, points: [number, number][], subtype: string, hours: number): RouteSegment {
    const flight = subtype === AIR_TYPE;
    return {
        index,
        edge_id: flight ? `${AIR_EDGE_PREFIX}${String(index)}` : `e${String(index)}`,
        public_id: "",
        from_node: "a",
        to_node: "b",
        from_node_id: "a",
        to_node_id: "b",
        subtype,
        path_name: "",
        transport_type: flight ? "griffin" : "groupFoot",
        distance_units: 10,
        cost_units: hours,
        cost_factor: 1,
        travel_hours: hours,
        flow_time_factor: 1,
        flow_state: "none",
        synthetic: false,
        offroad: false,
        geometry: { type: "LineString", coordinates: points },
    };
}

/** Erst ein Stück zu Fuß, dann der Flug: zwei Etappen, der Flug ist Abschnitt 1. */
function route(): RouteResponse {
    const place = (name: string): RouteResponse["stages"][number]["from"] => ({
        point: "place",
        place_id: name,
        name,
        x: 0,
        y: 0,
    });
    const segments = [
        segment(0, [[510, 441.229], UMWEG[0] as [number, number]], "Strasse", 2),
        segment(1, UMWEG, AIR_TYPE, 6),
    ];
    return {
        found: true,
        failed_leg_index: null,
        air: {
            profile: "griffin",
            speed_mph: 50,
            altitude_schritt: 800,
            max_above_ground_schritt: 8000,
            ceiling_schritt: 5000,
        },
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [],
        legs: [],
        segments,
        distance_units: 20,
        travel_hours: 8,
        travel_days: 1,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: 8,
        miles_per_unit: 3,
        air_legs_units: [],
        stages: segments.map((s, index) => ({
            index,
            leg_index: index,
            segment_start: s.index,
            segment_count: 1,
            type: s.subtype,
            transport: s.transport_type,
            flow_state: null,
            path_names: [],
            from: place("A"),
            to: place("B"),
            distance_units: 10,
            travel_hours: s.travel_hours,
            rest_hours: 0,
        })),
        warnings: [],
    };
}

const mercator = (point: { x: number; y: number }): { x: number; y: number } => {
    const at = MercatorCoordinate.fromLngLat(toRenderLngLat(AVENTURIA.coordinateSpace, point));
    return { x: at.x, y: at.y };
};

describe("Die Stelle des Pfeils auf seinem Abschnitt", () => {
    it("die Zeitleiste nennt Abschnitt und Anteil seiner Länge", () => {
        const timeline = buildTimeline(route());
        // 2 von 8 Stunden zu Fuß, dann 6 im Flug.
        expect(timeline.at(0.125)).toMatchObject({ segment: 0, along: 0.5 });
        expect(timeline.at(0.25)).toMatchObject({ segment: 0, along: 1 });
        expect(timeline.at(0.625)).toMatchObject({ segment: 1, along: 0.5 });
        expect(timeline.at(1)).toMatchObject({ segment: 1, along: 1 });
    });

    it("🔴 derselbe Anteil trifft auf der Bahn dieselbe Stelle: Karte und Mercator messen die Form gleich", () => {
        const r = route();
        const timeline = buildTimeline(r);
        const [track] = buildFlightTracks({ route: r, stale: false, selectedStage: null, waypoints: [] });
        if (!track) throw new Error("kein Flug");
        const profil = new Float32Array(track.x.length);
        for (const fraction of [0.3, 0.45, 0.5, 0.625, 0.8, 0.95]) {
            const at = timeline.at(fraction);
            const pfeil = mercator(at);
            const bahn = flightPointAt(track, profil, at.along);
            // Die Bahn ist in 400 Proben abgetastet: Sie liegt höchstens einen Bruchteil einer Probe daneben.
            const probe = track.length / (track.x.length - 1);
            expect(Math.hypot(bahn.x - pfeil.x, bahn.y - pfeil.y)).toBeLessThan(0.05 * probe);
        }
    });
});

describe("Die Höhe des Pfeils ist die der Bahn", () => {
    const [track] = buildFlightTracks({ route: route(), stale: false, selectedStage: null, waypoints: [] });
    if (!track) throw new Error("kein Flug");
    // Ein Kamm von 3.000 Schritt in der Mitte; dasselbe Profil wie die Flugbahn, mit halber Überhöhung.
    const n = track.x.length;
    for (let k = 0; k < n; k += 1) {
        track.ground[k] = 3000 * MERCATOR_PER_SCHRITT * Math.max(0, 1 - Math.abs(k - n / 2) / (0.1 * n));
    }
    const profil = flightProfile(track, 0.5);

    it("🔴 an jeder Probe genau das gezeichnete Profil, dazwischen linear", () => {
        for (const k of [0, 1, 57, Math.floor(n / 2), n - 2, n - 1]) {
            expect(flightPointAt(track, profil, k / (n - 1)).z).toBeCloseTo(profil[k] as number, 15);
        }
        const mitte = flightPointAt(track, profil, (10.5 / (n - 1)) as number);
        expect(mitte.z).toBeCloseTo(((profil[10] as number) + (profil[11] as number)) / 2, 15);
    });

    it("🔴 Start und Ziel auf dem Boden: kein Sprung beim Wechsel zwischen Land und Flug", () => {
        expect(flightPointAt(track, profil, 0).z).toBe((track.ground[0] as number) * 0.5);
        expect(flightPointAt(track, profil, 1).z).toBe((track.ground[n - 1] as number) * 0.5);
        // Unterwegs steht er über dem Boden, über dem Kamm samt Zuschlag.
        expect(flightPointAt(track, profil, 0.5).z).toBeGreaterThan((track.ground[Math.floor(n / 2)] as number) * 0.5);
    });

    it("außerhalb von 0 bis 1 bleibt er an den Enden", () => {
        expect(flightPointAt(track, profil, -1)).toEqual(flightPointAt(track, profil, 0));
        expect(flightPointAt(track, profil, 2)).toEqual(flightPointAt(track, profil, 1));
    });

    it("auf den Schirm mit derselben Matrix wie die Bahn; hinter der Kamera keiner", () => {
        const eins = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        expect(projectToScreen(eins, { x: 0, y: 0, z: 0 }, 800, 600)).toEqual({ x: 400, y: 300 });
        expect(projectToScreen(eins, { x: 1, y: 1, z: 0 }, 800, 600)).toEqual({ x: 800, y: 0 });
        const hinten = [...eins];
        hinten[15] = -1;
        expect(projectToScreen(hinten, { x: 0, y: 0, z: 0 }, 800, 600)).toBeUndefined();
    });
});

describe("Die Kamera folgt dem Pfeil in die Höhe", () => {
    /** Eine Karte mit Gelände, deren Boden unter dem Pfeil 1.000 m hoch ist. */
    function terrainMap() {
        const elevations: (number | undefined)[] = [];
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getBearing: () => 0,
            getPitch: () => 45,
            getZoom: () => 7,
            isMoving: () => false,
            getTerrain: () => ({}),
            queryTerrainElevation: () => 1000,
            getCenterElevation: () => 1000,
            setCenterClampedToGround: () => undefined,
            on: () => undefined,
            off: () => undefined,
            jumpTo: (options: { elevation?: number }) => elevations.push(options.elevation),
        };
        return { map: map as unknown as Parameters<typeof createCamera>[0], elevations };
    }

    it("🔴 mit `altitude` hält sie die Höhe der Bahn statt des Bodens, weich wie über Gelände", () => {
        let clock = 0;
        const { map, elevations } = terrainMap();
        const camera = createCamera(map, undefined, () => clock);
        camera.follow([1, 2], { bearing: 0, ground: [1, 2], settle: true });
        expect(elevations.at(-1)).toBe(1000);
        clock += 16;
        camera.follow([1, 2], { bearing: 0, ground: [1, 2], altitude: 21_000 });
        expect((elevations.at(-1) as number) - 1000).toBeCloseTo(
            20_000 * (1 - Math.exp(-0.016 / FOLLOW_HEIGHT_SECONDS)),
            6,
        );
        for (let frame = 0; frame < 600; frame += 1) {
            clock += 16;
            camera.follow([1, 2], { bearing: 0, ground: [1, 2], altitude: 21_000 });
        }
        expect(elevations.at(-1) as number).toBeCloseTo(21_000, 0);
        // Ohne Höhe geht sie wieder zum Boden, ebenso weich.
        clock += 16;
        camera.follow([1, 2], { bearing: 0, ground: [1, 2] });
        expect(elevations.at(-1) as number).toBeGreaterThan(20_000);
    });
});

describe("Der Playmode reicht die Höhe durch, nur geneigt", () => {
    function view(pitch: number) {
        const calls: { altitude?: number; ground?: [number, number] }[] = [];
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            // Der Blickraum des Playmodes rechnet mit dem Sichtfeld (`behindCentre`).
            getVerticalFieldOfView: () => 36.87,
            getZoom: () => 7,
            getPitch: () => pitch,
            getBearing: () => 0,
            getCenter: () => ({ lng: 0, lat: 0 }),
            getCanvas: () => ({ clientWidth: 1200, clientHeight: 800 }),
            triggerRepaint: () => undefined,
        } as unknown as MapLibreMap;
        const camera = {
            state: () => ({ bearing: 0, pitch, zoom: 7 }),
            insets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
            follow: (_center: [number, number], options?: { altitude?: number; ground?: [number, number] }) =>
                calls.push(options ?? {}),
        } as unknown as Camera;
        const asked: TravelerPosition[] = [];
        const traveler = createTravelerView(
            () => map,
            () => camera,
            () => 0,
            (position) => {
                asked.push(position);
                return position.segment === 1 ? { x: 0, y: 0, z: 1e-6, meters: 4321 } : undefined;
            },
        );
        return { traveler, calls, asked };
    }
    const aufDemFlug = { x: 580, y: 498, heading: 45, segment: 1, along: 0.5 };

    it("🔴 geneigt folgt die Kamera der Höhe der Bahn; der Pfeil behält Abschnitt und Anteil", () => {
        const { traveler, calls } = view(45);
        traveler.show(aufDemFlug);
        expect(traveler.current()).toMatchObject({ segment: 1, along: 0.5 });
        traveler.follow(aufDemFlug, true, 45);
        expect(calls.at(-1)).toMatchObject({ altitude: 4321 });
        // Auf einem Landweg ohne Höhe: wie bisher nur der Boden.
        traveler.follow({ ...aufDemFlug, segment: 0 }, false, 45);
        expect(calls.at(-1)?.altitude).toBeUndefined();
        expect(calls.at(-1)?.ground).toBeDefined();
    });

    it("🔴 flach wie bisher: weder Boden noch Höhe", () => {
        const { traveler, calls, asked } = view(0);
        traveler.follow(aufDemFlug, true, 45);
        expect(calls.at(-1)).toEqual({});
        expect(asked).toEqual([]);
    });
});
