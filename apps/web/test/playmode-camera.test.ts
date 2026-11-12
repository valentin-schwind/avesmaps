import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { FLIGHT_PITCH } from "../src/map/camera/camera-math.ts";
import { AVENTURIA, fromRenderLngLat, type RouteResponse, type RouteSegment } from "@avesmaps3d/shared";
import { buildTimeline } from "../src/route-planner/journey-timeline.ts";
import { PLAY_SECONDS, usePlaymode } from "../src/route-planner/use-playmode.ts";
import type { Camera, CameraState } from "../src/map/camera/camera.ts";
import {
    createTravelerView,
    DEAD_ZONE,
    keepInBand,
    LOOK_AHEAD_PX,
    mapUnitsPerPixel,
    outsideDeadZone,
    SPIELRAUM_PX,
    spielraumPx,
    FLIGHT_ZOOM,
} from "../src/map/traveler-view.ts";

/**
 * Die Folgekamera des Playmodes in 3D (WI-0053, Betreiber 2026-09-27: „die Kamera ruhiger …
 * insbesondere bei gebirgen, wo es wild hin- und hergeht“): Sie blickt ein Stück Weg voraus, nicht
 * eine Zeit, und lässt kleine Abweichungen liegen. Karte und Kamera sind hier ein Protokoll.
 */

/**
 * Wie viel länger die Wiedergabe heute dauert als bei den Messungen in diesen Fällen (12 s für eine kurze Reise, 4 Reisestunden je
 * Sekunde): seit 2026-10-18 die halbe Geschwindigkeit (Betreiber), also doppelt so lang. Die Zeiten der Fälle rechnen damit.
 */
const DAUER = PLAY_SECONDS.min / 12;

/** Eine Reise über diese Linie, ein Abschnitt je Stück, jedes gleich lang in der Zeit. */
function routeAlong(points: [number, number][], hoursEach: number): RouteResponse {
    const segments = points.slice(1).map((to, index): RouteSegment => {
        const from = points[index] as [number, number];
        return {
            index,
            edge_id: `e${String(index)}`,
            public_id: "",
            from_node: "a",
            to_node: "b",
            from_node_id: "a",
            to_node_id: "b",
            subtype: "Gebirgspass",
            path_name: "",
            transport_type: "groupFoot",
            distance_units: Math.hypot(to[0] - from[0], to[1] - from[1]),
            cost_units: hoursEach,
            cost_factor: 1,
            travel_hours: hoursEach,
            flow_time_factor: 1,
            flow_state: "none",
            synthetic: false,
            offroad: false,
            geometry: { type: "LineString", coordinates: [from, to] },
        };
    });
    const [sx, sy] = points[0] as [number, number];
    const [ex, ey] = points[points.length - 1] as [number, number];
    const hours = hoursEach * segments.length;
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: "A", name: "A" },
            { id: "B", name: "B" },
        ],
        legs: [],
        segments,
        distance_units: segments.reduce((sum, segment) => sum + segment.distance_units, 0),
        travel_hours: hours,
        travel_days: hours / 8,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: hours,
        miles_per_unit: 3,
        air_legs_units: [0],
        stages: [
            {
                index: 0,
                leg_index: 0,
                segment_start: 0,
                segment_count: segments.length,
                type: "Gebirgspass",
                transport: "groupFoot",
                flow_state: null,
                path_names: [],
                from: { point: "place", place_id: "A", name: "A", x: sx, y: sy },
                to: { point: "place", place_id: "B", name: "B", x: ex, y: ey },
                distance_units: 0,
                travel_hours: hours,
                rest_hours: 0,
            },
        ],
        warnings: [],
    };
}

/**
 * Ein Pass mit Kehren nach Norden (Karten-y wächst nach Norden): 24 Stücke zu je 1,25 Einheiten
 * Nordgang und 0,9 Einheiten zur Seite, abwechselnd - rund 90 px je Kehre auf Flughöhe, wie auf dem
 * Pass zwischen Greifenfurt und Lowangen gemessen. Jedes Stück weicht 36° von Norden ab.
 */
function serpentine(kehren = 24, anlauf = 0): [number, number][] {
    // `anlauf`: vorher so weit geradeaus auf der Achse der Kehren, nach Norden (eine Straße, die in den Pass führt).
    const points: [number, number][] =
        anlauf > 0
            ? [
                  [500.45, 600 - anlauf],
                  [500.45, 600],
              ]
            : [[500, 600]];
    for (let index = 1; index <= kehren; index += 1) points.push([500 + (index % 2) * 0.9, 600 + index * 1.25]);
    return points;
}

/** Playmode, Pfeil und Kamera zusammen, mit einer Uhr, die der Test weiterdreht - auf Flughöhe, 45° geneigt. */
function flight(route: RouteResponse) {
    let clock = 0;
    const state: CameraState = { bearing: 0, pitch: 45, zoom: 7 };
    let centre: [number, number] = [0, 0];
    let compass: (() => void) | undefined;
    let zoomChoice: ((zoom: number) => void) | undefined;
    const bearings: number[] = [];
    const handlers = new Map<string, (event: object) => void>();
    const gestures = new Map<string, Set<() => void>>();
    /** Mitte der Kamera und Pfeil je Bild, in Kartenkoordinaten. */
    const frames3d: { centre: { x: number; y: number }; arrow: { x: number; y: number }; bearing: number }[] = [];
    const map = {
        getZoom: () => state.zoom,
        getPitch: () => state.pitch,
        getBearing: () => state.bearing,
        getCenter: () => ({ lng: centre[0], lat: centre[1] }),
        getCanvas: () => ({ clientWidth: 1200, clientHeight: 800 }),
        getVerticalFieldOfView: () => 36.87,
        triggerRepaint: () => undefined,
        on: (type: string, handler: (event: object) => void) => handlers.set(type, handler),
        off: (type: string) => handlers.delete(type),
        getCanvasContainer: () => ({
            addEventListener: (type: string, handler: () => void) =>
                gestures.set(type, (gestures.get(type) ?? new Set()).add(handler)),
            removeEventListener: (type: string, handler: () => void) => gestures.get(type)?.delete(handler),
        }),
    } as unknown as MapLibreMap;
    /** Eine Zoomgeste: erst das Rad auf der Karte, dann MapLibres Zoomende - oder ein Zoom ohne Geste. */
    const zoomGesture = (zoom: number, gesture = true): void => {
        if (gesture) gestures.get("wheel")?.forEach((handler) => handler());
        state.zoom = zoom;
        handlers.get("zoomend")?.({});
    };
    const toMap = ([lng, lat]: [number, number]) => fromRenderLngLat(AVENTURIA.coordinateSpace, { lng, lat });
    const camera = {
        state: () => ({ ...state }),
        // Ohne Panel: der Bezug der Mitte ist leer (WI-0218).
        insets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
        onZoomChoice: (listener: (zoom: number) => void) => {
            zoomChoice = listener;
            return () => {
                zoomChoice = undefined;
            };
        },
        unfollow: () => undefined,
        claimNorth: (handler: () => void) => {
            compass = handler;
            return () => {
                compass = undefined;
            };
        },
        follow(
            center: [number, number],
            view?: { bearing?: number; zoom?: number; pitch?: number; ground?: [number, number] },
        ) {
            centre = center;
            if (view?.zoom !== undefined) state.zoom = view.zoom;
            if (view?.pitch !== undefined) state.pitch = view.pitch;
            if (view?.bearing !== undefined) {
                state.bearing = view.bearing;
                bearings.push(view.bearing);
            }
            if (view?.ground)
                frames3d.push({ centre: toMap(center), arrow: toMap(view.ground), bearing: state.bearing });
        },
    } as unknown as Camera;
    const view = createTravelerView(
        () => map,
        () => camera,
        () => clock,
    );
    let frames: ((time: number) => void)[] = [];
    const playmode = usePlaymode(shallowRef<RouteResponse | null>(route), {
        show: view.show,
        follow: view.follow,
        lookAhead: view.lookAhead,
        takeOff: view.takeOff,
        watch: view.watch,
        rejoin: view.rejoin,
        orbit: view.orbit,
        letGo: view.letGo,
        requestFrame: (callback) => frames.push(callback),
        cancelFrame: () => {
            frames = [];
        },
        reducedMotion: () => false,
    });
    /** Spielt `seconds` lang mit 30 Bildern je Sekunde. */
    const run = (seconds: number): void => {
        for (let step = 0; step < seconds * 30; step += 1) {
            clock += 1000 / 30;
            const pending = frames;
            frames = [];
            pending.forEach((callback) => callback(clock));
        }
    };
    return {
        playmode,
        bearings,
        frames3d,
        run,
        state,
        zoomGesture,
        compass: () => compass?.(),
        ringZoom: (zoom: number) => {
            state.zoom = zoom;
            zoomChoice?.(zoom);
        },
    };
}

describe("Voraus heißt Strecke (WI-0053)", () => {
    it("der Punkt ein Stück Weg voraus, über Abschnitte hinweg und höchstens bis zum Ende", () => {
        const timeline = buildTimeline(
            routeAlong(
                [
                    [0, 0],
                    [0, 10],
                    [10, 10],
                ],
                5,
            ),
        );
        const start = timeline.ahead(0, 4);
        expect(start.x).toBeCloseTo(0, 9);
        expect(start.y).toBeCloseTo(4, 9);
        // Aus dem ersten Abschnitt in den zweiten: 8 + 5 = 13 Einheiten Weg.
        const across = timeline.ahead(0.4, 5);
        expect(across.x).toBeCloseTo(3, 9);
        expect(across.y).toBeCloseTo(10, 9);
        expect(timeline.ahead(0.9, 100)).toEqual({ x: 10, y: 10 });
    });

    it("die Vorausschau ist ein fester Weg auf dem Schirm: eine Zoomstufe näher, halb so viel Karte", () => {
        const here = { x: 500, y: 600 };
        const near = mapUnitsPerPixel(here, 8);
        expect(mapUnitsPerPixel(here, 7)).toBeCloseTo(near * 2, 12);
        expect(near).toBeGreaterThan(0);
    });
});

describe("Totzone (WI-0053)", () => {
    it("kleine Abweichungen bleiben liegen, gedreht wird nur um den Überschuss - auch über ±180°", () => {
        expect(outsideDeadZone(0, DEAD_ZONE - 1, DEAD_ZONE)).toBe(0);
        expect(outsideDeadZone(0, -(DEAD_ZONE - 1), DEAD_ZONE)).toBe(0);
        expect(outsideDeadZone(0, 25, DEAD_ZONE)).toBeCloseTo(25 - DEAD_ZONE, 9);
        expect(outsideDeadZone(0, -25, DEAD_ZONE)).toBeCloseTo(-(25 - DEAD_ZONE), 9);
        expect(Math.abs(outsideDeadZone(170, -170, DEAD_ZONE))).toBeCloseTo(170 + (20 - DEAD_ZONE), 9);
    });
});

describe("🔴 Die Kamera im Gebirge (Betreiber 2026-09-27: „wild hin- und her“)", () => {
    it("auf einem Pass mit Kehren blickt sie ruhig den Pass hinauf, statt jede Kehre mitzuschwenken", () => {
        const { playmode, bearings, run } = flight(routeAlong(serpentine(), 0.5));
        playmode.play();
        run(1);
        const settled = bearings.length;
        run(9);
        const after = bearings.slice(settled);
        expect(after.length).toBeGreaterThan(200);
        // Jedes Stück weicht 36° von Norden ab; die Kamera bleibt nah an Norden und steht praktisch still.
        expect(Math.max(...after.map((bearing) => Math.abs(bearing)))).toBeLessThan(DEAD_ZONE);
        const turned = after
            .slice(1)
            .reduce((sum, bearing, index) => sum + Math.abs(bearing - (after[index] as number)), 0);
        expect(turned, `insgesamt ${turned.toFixed(1)}° gedreht`).toBeLessThan(5);
    });

    it("einer echten Biegung folgt sie, und sie beginnt schon vorher", () => {
        const points: [number, number][] = [];
        for (let index = 0; index <= 20; index += 1) points.push([500, 600 + index]);
        for (let index = 1; index <= 20; index += 1) points.push([500 + index, 620]);
        const { playmode, bearings, run } = flight(routeAlong(points, 0.5));
        // 40 Einheiten in der kürzesten Reise: Der Pfeil erreicht die Ecke nach der Hälfte, die Vorausschau schon eine Strecke früher.
        const reise = 12 * DAUER;
        const early = (LOOK_AHEAD_PX * mapUnitsPerPixel({ x: 500, y: 600 }, FLIGHT_ZOOM)) / (40 / reise);
        playmode.play();
        run(reise / 2 - early - 0.5);
        expect(Math.abs(bearings.at(-1) as number), "noch geradeaus nach Norden").toBeLessThan(1);
        run(early + 0.5);
        expect(bearings.at(-1) as number, "an der Ecke schon ein gutes Stück herum").toBeGreaterThan(20);
        run(reise / 2);
        // Genau nach Osten nur bis auf die Totzone: Der Blick bleibt am Rand des Gummibands stehen.
        expect(bearings.at(-1) as number, "am Ende nach Osten").toBeGreaterThan(90 - DEAD_ZONE - 1);
    });

    it("ein Sprung (Etappe, Anfang, „Bewegung reduzieren“) dreht sofort ganz, ohne Totzone", () => {
        // Zwei Schenkel, je doppelt so lang wie der Blick voraus: Am Anfang sieht die Kamera nur den ersten, bei drei Vierteln nur den zweiten.
        const ahead = LOOK_AHEAD_PX * mapUnitsPerPixel({ x: 500, y: 600 }, 7);
        const points: [number, number][] = [
            [500, 600],
            [500, 600 + 2 * ahead],
            [500 + 2 * ahead, 600 + 2.2 * ahead],
        ];
        const { playmode, bearings } = flight(routeAlong(points, 1));
        playmode.play();
        expect(bearings.at(-1)).toBeCloseTo(0, 6);
        playmode.seek(0.75);
        // Voraus liegt nur noch Osten (und ein Hauch Nord): Der Blick steht darauf, nicht 10° daneben.
        expect(bearings.at(-1) as number).toBeGreaterThan(80);
    });
});

describe("Spielraum statt Rutschen (WI-0053 Stufe 2, Betreiber: „3“)", () => {
    /** Seitlich und vorwärts eines Punkts gegenüber der Mitte, im Blick der Kamera. */
    const inView = (point: { x: number; y: number }, centre: { x: number; y: number }, bearing: number) => {
        const b = (bearing * Math.PI) / 180;
        const dx = point.x - centre.x;
        const dy = point.y - centre.y;
        return { side: dx * Math.cos(b) - dy * Math.sin(b), ahead: dx * Math.sin(b) + dy * Math.cos(b) };
    };

    it("vorwärts genau mit dem Pfeil, seitlich erst über den Spielraum hinaus - in jeder Blickrichtung", () => {
        const anchor = { x: 10, y: 20 };
        // Blick nach Norden: seitlich ist Ost-West.
        expect(keepInBand(anchor, { x: 10.5, y: 23 }, 0, 1)).toEqual({ x: 10, y: 23 });
        const pulled = keepInBand(anchor, { x: 11.5, y: 23 }, 0, 1);
        expect(pulled.x).toBeCloseTo(10.5, 9);
        expect(pulled.y).toBeCloseTo(23, 9);
        // Blick nach Osten: seitlich ist Nord-Süd, vorwärts geht nach Osten. 1,5 südlich, 0,5 davon zieht nach.
        const east = keepInBand(anchor, { x: 13, y: 18.5 }, 90, 1);
        expect(east.x).toBeCloseTo(13, 9);
        expect(east.y).toBeCloseTo(19.5, 9);
    });

    it("🔴 auf dem Pass mit Kehren fährt die Kamera geradeaus, der Pfeil pendelt im Spielraum", () => {
        // So lang, dass der Blick voraus in den gemessenen zehn Sekunden nie über das Ende des Passes reicht (dort dreht die Kamera auf
        // die letzte Richtung, und das ist kein Rutschen); je Kehre länger, damit der Pfeil so schnell kriecht wie auf dem kurzen Pass.
        // 🪤 Mit einer Straße davor: Begann die Fahrt mitten in den Kehren, stand der erste Blick (ein Sprung, ohne Totzone) auf der Sehne
        // zu einem Punkt voraus, je nach dessen Lage in der Kehre bis 5° neben der Achse, und blieb dort (Totzone). Die Mitte lief dann
        // schräg zum Blick, und das Ergebnis hing an der Länge des Vorausblicks (gemessen 2026-10-17: 450 grün, 500 rot, 566 grün, 700 rot).
        const ahead = LOOK_AHEAD_PX * mapUnitsPerPixel({ x: 500, y: 600 }, 7);
        const { playmode, frames3d, run } = flight(routeAlong(serpentine(64, 2 * ahead), 2));
        playmode.play();
        run(1);
        const settled = frames3d.length;
        run(9 * DAUER);
        const after = frames3d.slice(settled);
        const band = SPIELRAUM_PX * mapUnitsPerPixel({ x: 500, y: 600 }, 7);
        let centreSide = 0;
        let arrowSide = 0;
        after.slice(1).forEach((frame, index) => {
            const before = after[index]!;
            centreSide += Math.abs(inView(frame.centre, before.centre, frame.bearing).side);
            arrowSide += Math.abs(inView(frame.arrow, before.arrow, frame.bearing).side);
            // Der Pfeil bleibt im Spielraum neben der Mitte und in immer gleichem Abstand vor ihr.
            expect(Math.abs(inView(frame.arrow, frame.centre, frame.bearing).side)).toBeLessThanOrEqual(band + 1e-9);
        });
        // Jede Kehre schob die Karte bisher um 0,9 Einheiten zur Seite (rund 58 px); jetzt fast nichts mehr.
        expect(arrowSide).toBeGreaterThan(10);
        expect(centreSide, `Mitte seitlich ${centreSide.toFixed(2)} gegen Pfeil ${arrowSide.toFixed(2)}`).toBeLessThan(
            arrowSide * 0.05,
        );
    });

    it("🔴 der Spielraum ist eine Bodenstrecke: bei Zoom 7 80 px, darüber mitwachsend, darunter nie kleiner (WI-0248 S2)", () => {
        expect(spielraumPx(7)).toBe(SPIELRAUM_PX);
        expect(spielraumPx(8)).toBeCloseTo(2 * SPIELRAUM_PX, 9);
        expect(spielraumPx(9)).toBeCloseTo(4 * SPIELRAUM_PX, 9);
        expect(spielraumPx(5)).toBe(SPIELRAUM_PX);
        // Dieselbe Strecke auf dem Boden, gleich bei welchem Zoom ab 7.
        const boden = (zoom: number): number => spielraumPx(zoom) * mapUnitsPerPixel({ x: 500, y: 600 }, zoom);
        expect(boden(8)).toBeCloseTo(boden(7), 9);
        expect(boden(10)).toBeCloseTo(boden(7), 9);
    });

    it("ein Sprung setzt die Mitte wieder genau hinter den Pfeil", () => {
        const { playmode, frames3d, run } = flight(routeAlong(serpentine(), 0.5));
        playmode.play();
        run(3);
        playmode.seek(0.5);
        const last = frames3d.at(-1)!;
        expect(Math.abs(inView(last.arrow, last.centre, last.bearing).side)).toBeLessThan(1e-6);
    });
});

describe("Selbst gewählter Zoom bleibt (WI-0053, Betreiber 2026-09-27: „wär schön wenn er bleibt“)", () => {
    it("🔴 wer mit Rad oder Fingern zoomt, behält die Zoomstufe: ▶ geht nicht mehr auf die Flughöhe zurück", () => {
        const { playmode, run, state, zoomGesture } = flight(routeAlong(serpentine(), 0.5));
        state.zoom = 5;
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(FLIGHT_ZOOM, 6);
        // Das Rad hält die Wiedergabe an (app.vue) und zoomt heran.
        playmode.pause();
        zoomGesture(8.5);
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(8.5, 6);
        // Auch nach einer Fahrt des Planers (ohne Geste) kommt ▶ auf die gewählte Stufe zurück.
        playmode.pause();
        zoomGesture(6, false);
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(8.5, 6);
    });

    it("🔴 auch Ring und Tasten wählen die Flughöhe (Betreiber 2026-09-27: „zoom soll auch erhalten bleiben ja“)", () => {
        const { playmode, run, state, ringZoom } = flight(routeAlong(serpentine(), 0.5));
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(FLIGHT_ZOOM, 6);
        ringZoom(8);
        playmode.pause();
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(8, 6);
    });

    it("eine neue Route beginnt wieder auf der üblichen Flughöhe, ein Zoom vor der Wiedergabe zählt nicht", async () => {
        const { playmode, run, state, zoomGesture } = flight(routeAlong(serpentine(), 0.5));
        // Vor dem ersten ▶ ist kein Pfeil auf der Karte: Umschauen ist keine Wahl der Flughöhe.
        zoomGesture(9);
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(FLIGHT_ZOOM, 6);
        playmode.pause();
        zoomGesture(8);
        playmode.toStart();
        playmode.play();
        run(2);
        expect(state.zoom).toBeCloseTo(8, 6);
    });
});

describe("3D-Flug geneigt bis zum Anschlag (Betreiber 2026-09-27: „und die neigung aufs maximum“)", () => {
    it("🔴 ▶ in 3D neigt mit dem Steigen auf die höchste Neigung, in 2D bleibt es flach", () => {
        const tilted = flight(routeAlong(serpentine(), 0.5));
        tilted.state.zoom = 5;
        tilted.playmode.play();
        tilted.run(2);
        expect(tilted.state.zoom).toBeCloseTo(FLIGHT_ZOOM, 6);
        expect(tilted.state.pitch).toBeCloseTo(FLIGHT_PITCH, 6);
        const flat = flight(routeAlong(serpentine(), 0.5));
        flat.state.pitch = 0;
        flat.playmode.play();
        flat.run(2);
        expect(flat.state.pitch).toBe(0);
    });
});

describe("Freie Kamera (WI-0053, Betreiber 2026-09-27: „wär schön wenn sie weiterläuft“)", () => {
    it("🔴 der Kompass holt die Kamera weich zurück: erst vom freien Blick aus, nach 0,75 s wieder in Fahrtrichtung", () => {
        const { playmode, bearings, run, state, compass } = flight(routeAlong(serpentine(), 0.5));
        playmode.play();
        run(1);
        // Jemand dreht die Karte: Die Wiedergabe läuft, die Kamera folgt nicht mehr.
        playmode.interrupt();
        const followed = bearings.length;
        state.bearing = 150;
        run(1);
        expect(bearings).toHaveLength(followed);
        expect(playmode.playing.value).toBe(true);
        compass();
        // Das erste Bild zurück steht noch auf dem freien Blick - kein Sprung.
        expect(bearings.at(-1) as number).toBeCloseTo(150, 6);
        run(0.2);
        const between = bearings.at(-1) as number;
        expect(between).toBeLessThan(150);
        expect(between).toBeGreaterThan(DEAD_ZONE);
        run(1);
        expect(Math.abs(bearings.at(-1) as number), "wieder in Fahrtrichtung (Norden)").toBeLessThan(DEAD_ZONE);
    });
});

describe("2D ↔ 3D während der Wiedergabe (Betreiber 2026-09-27: „flitzt der pfeil davon“)", () => {
    it("🔴 kippt man in 3D, dreht die Kamera weich in Fahrtrichtung und der Pfeil gleitet unter die Mitte", () => {
        const east: [number, number][] = [];
        for (let index = 0; index <= 40; index += 1) east.push([500 + index, 600]);
        const { playmode, bearings, frames3d, run, state } = flight(routeAlong(east, 0.5));
        state.pitch = 0;
        playmode.play();
        run(1);
        expect(bearings).toEqual([]);
        // Der 3D-Knopf neigt in der Folge (camera.ts), hier Bild für Bild nachgestellt.
        for (let frame = 1; frame <= 30; frame += 1) {
            state.pitch = frame * 2;
            run(1 / 30);
        }
        // Die Drehung beginnt beim Blick der Karte (Norden) und springt nie ...
        expect(Math.abs(bearings[0] as number)).toBeLessThan(DEAD_ZONE);
        bearings.slice(1).forEach((bearing, index) => {
            expect(Math.abs(bearing - (bearings[index] as number))).toBeLessThan(5);
        });
        // ... und der Pfeil rückt stetig von der Mitte nach unten, ohne Sprung an der Grenze zu 2D.
        const behind = frames3d.map(({ centre, arrow, bearing }) => {
            const b = (bearing * Math.PI) / 180;
            return (
                ((centre.x - arrow.x) * Math.sin(b) + (centre.y - arrow.y) * Math.cos(b)) / mapUnitsPerPixel(arrow, 7)
            );
        });
        expect(behind[0] as number).toBeLessThan(10);
        behind.slice(1).forEach((value, index) => {
            expect(Math.abs(value - (behind[index] as number))).toBeLessThan(15);
        });
        run(6);
        expect(bearings.at(-1) as number, "am Ende in Fahrtrichtung Osten").toBeGreaterThan(90 - DEAD_ZONE - 1);
    });
});

describe("🔴 Am Ziel in den Vogelflug ohne Sprung (Betreiber 2026-10-17: „am ende des routeflugs im den übergang in den helikopter-flug kein sprung“)", () => {
    it("die Mitte gleitet aus der Folge (voraus, Pfeil darunter) in den Kreis um das Ziel, Bild für Bild ohne Satz", () => {
        const points: [number, number][] = [];
        for (let index = 0; index <= 20; index += 1) points.push([500, 600 + index]);
        const { playmode, frames3d, run } = flight(routeAlong(points, 0.5));
        playmode.play();
        run(12 * DAUER + 2);
        const centres = frames3d.map((frame) => frame.centre);
        const steps = centres.slice(1).map((c, index) => Math.hypot(c.x - centres[index]!.x, c.y - centres[index]!.y));
        // Der Pfeil fährt 20 Einheiten in der kürzesten Reise, je Bild höchstens rund 0,06; voraus stand die Mitte rund zwei Einheiten vor ihm. Ein Satz dorthin
        // wäre ein Bild mit zwei Einheiten.
        expect(Math.max(...steps), "größter Schritt der Mitte von Bild zu Bild").toBeLessThan(0.25);
        // Und am Ende steht die Mitte auf dem Ziel, wie der Vogelflug es will.
        const last = frames3d.at(-1)!;
        expect(Math.hypot(last.centre.x - 500, last.centre.y - 620)).toBeLessThan(1e-6);
    });
});

describe("🔴 Vor dem Ziel bremst die Kamera aus, der Vogelflug dreht weich an (WI-0218, Messung Gareth → Perricum)", () => {
    /** Geschwindigkeit der Mitte nach Norden je Bild (Karteneinheiten je Sekunde, 30 Bilder je Sekunde) und Drehrate in Grad je Sekunde. */
    const verlauf = (frames3d: { centre: { x: number; y: number }; bearing: number }[]) => ({
        nord: frames3d.slice(1).map((frame, index) => (frame.centre.y - frames3d[index]!.centre.y) * 30),
        dreh: frames3d.slice(1).map((frame, index) => {
            const d = frame.bearing - frames3d[index]!.bearing;
            return (((d + 540) % 360) - 180) * 30;
        }),
    });

    it("🔴 die Mitte hält nicht in einem Bild an und rutscht nie zurück; am Ende steht das Ziel in der Mitte", () => {
        const points: [number, number][] = [];
        for (let index = 0; index <= 20; index += 1) points.push([500, 600 + index]);
        const { playmode, frames3d, run } = flight(routeAlong(points, 0.5));
        playmode.play();
        run(12 * DAUER + 4);
        const { nord } = verlauf(frames3d);
        // Die Reisegeschwindigkeit nach dem Steigen, vor dem Auslauf.
        const reise = nord[150]!;
        expect(reise, "die Reise fährt nach Norden").toBeGreaterThan(0.25);
        const ab = nord.slice(120);
        expect(Math.min(...ab), "nie rückwärts").toBeGreaterThan(-0.02 * reise);
        // Vorher: von voller Fahrt auf null in einem Bild. Jetzt gleichmäßig über rund eine halbe Sekunde (mehr als drei Zehntel).
        const ruck = ab.slice(1).map((v, index) => Math.abs(v - ab[index]!));
        expect(Math.max(...ruck), "größte Änderung von Bild zu Bild").toBeLessThan(reise / 9);
        const last = frames3d.at(-1)!;
        expect(Math.hypot(last.centre.x - 500, last.centre.y - 620)).toBeLessThan(1e-6);
    });

    it("🔴 der Vogelflug dreht aus der Drehung der Folge an, nicht in einem Bild auf volle Fahrt", () => {
        const points: [number, number][] = [];
        for (let index = 0; index <= 20; index += 1) points.push([500, 600 + index]);
        const { playmode, frames3d, run } = flight(routeAlong(points, 0.5));
        playmode.play();
        run(12 * DAUER + 6);
        const { dreh } = verlauf(frames3d);
        const ende = dreh.slice(150);
        expect(Math.max(...ende), "am Ende kreist sie").toBeGreaterThan((360 / 45) * 0.95);
        const sprung = ende.slice(1).map((rate, index) => Math.abs(rate - ende[index]!));
        // Ohne Anlauf sprang die Drehung in einem Bild von 0 auf 8 °/s.
        expect(Math.max(...sprung), "größter Sprung der Drehrate von Bild zu Bild").toBeLessThan(1);
    });

    it("🔴 biegt der Weg vor dem Ziel ab, schwenkt die Kamera nicht hinterher", () => {
        // Nach Norden, auf den letzten zwei Einheiten scharf nach Osten in den Ort.
        const points: [number, number][] = [];
        for (let index = 0; index <= 20; index += 1) points.push([500, 600 + index]);
        points.push([501, 620], [502, 620]);
        const { playmode, frames3d, run } = flight(routeAlong(points, 0.5));
        playmode.play();
        run(12 * DAUER + 2);
        const { dreh } = verlauf(frames3d);
        // Die letzten drei Sekunden der Reise vor dem Vogelflug.
        const reiseEnde = frames3d.findIndex((frame, index) => index > 0 && frame.centre.y >= 620 - 1e-9);
        const vorher = dreh.slice(Math.max(0, reiseEnde - 90), reiseEnde);
        // Die Kamera dreht einmal weich auf die Richtung der letzten Strecke, statt der Biegung nachzujagen: gemessen 10,5 °/s, ohne den
        // festen Kurs vor dem Ziel 17,3 °/s (Flughöhe 8, 2026-10-18).
        expect(Math.max(...vorher.map(Math.abs)), "größte Drehrate vor dem Ziel").toBeLessThan(13);
    });
});
