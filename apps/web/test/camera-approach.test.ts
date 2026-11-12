import { afterEach, describe, expect, it, vi } from "vitest";
import { FLIGHT_MS, flightDuration } from "../src/map/camera/camera-math.ts";
import { createCamera, FOLLOW_EVENT } from "../src/map/camera/camera.ts";

/**
 * Die Kamera springt nie (Betreiber 2026-09-29, Design Guide §17): Der Anflug zur Folgestellung fliegt, richtet
 * seine Dauer nach der Entfernung, meldet die Ankunft - und nur die, wenn er die ganze Dauer geflogen ist.
 */

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("die Dauer eines Flugs richtet sich nach der Entfernung", () => {
    it("nie unter dem Punkt der Suche (0,75 s) und nie über 2,2 s", () => {
        expect(flightDuration(0, 0)).toBe(FLIGHT_MS.min);
        expect(flightDuration(0.01, 0)).toBe(FLIGHT_MS.min + 6);
        expect(flightDuration(1000, 8)).toBe(FLIGHT_MS.max);
        expect(FLIGHT_MS).toEqual({ min: 750, max: 2200 });
    });

    it("wächst mit der Strecke und mit den Zoomstufen, langsamer als die Strecke selbst", () => {
        const near = flightDuration(0.5, 0);
        const far = flightDuration(4, 0);
        const farther = flightDuration(8, 0);
        expect(far).toBeGreaterThan(near);
        expect(farther).toBeGreaterThan(far);
        // Die doppelte Strecke kostet nicht die doppelte Zeit.
        expect(farther - far).toBeLessThan(far - FLIGHT_MS.min);
        expect(flightDuration(1, 3)).toBeGreaterThan(flightDuration(1, 0));
        // Heraus- und Hineinzoomen kosten gleich viel.
        expect(flightDuration(1, -3)).toBe(flightDuration(1, 3));
    });

    it("eine ungültige Strecke gilt als keine", () => {
        expect(flightDuration(-5, 0)).toBe(FLIGHT_MS.min);
    });
});

describe("Anflug der Kamera", () => {
    interface Flight {
        options: {
            center: [number, number];
            zoom: number;
            bearing: number;
            pitch: number;
            duration: number;
            essential: boolean;
        };
        data: Record<string, unknown> | undefined;
    }

    /** Eine Karte, die Flüge protokolliert; `moving` sagt, ob ein Flug läuft (Dauer > 0). */
    function flyingMap(start: { zoom?: number; bearing?: number; pitch?: number } = {}) {
        const handlers = new Map<string, ((event: object) => void)[]>();
        const state = { zoom: start.zoom ?? 4, bearing: start.bearing ?? 0, pitch: start.pitch ?? 0, moving: false };
        const flights: Flight[] = [];
        const jumps: unknown[] = [];
        const eases: unknown[] = [];
        const stops = { count: 0 };
        const fire = (type: string, event: object = {}): void => {
            for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
        };
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getBearing: () => state.bearing,
            getPitch: () => state.pitch,
            getZoom: () => state.zoom,
            getMinZoom: () => 0,
            getMaxZoom: () => 12,
            getCenter: () => ({ lng: 0, lat: 0 }),
            getCanvas: () => ({ clientWidth: 1000, clientHeight: 800 }),
            project: (point: [number, number] | { lng: number; lat: number }) => {
                const [lng, lat] = Array.isArray(point) ? point : [point.lng, point.lat];
                return { x: lng * 100, y: lat * 100 };
            },
            isMoving: () => state.moving,
            on: (type: string, handler: (event: object) => void) => {
                handlers.set(type, [...(handlers.get(type) ?? []), handler]);
            },
            off: (type: string, handler: (event: object) => void) => {
                handlers.set(
                    type,
                    (handlers.get(type) ?? []).filter((known) => known !== handler),
                );
            },
            getTerrain: () => null,
            setCenterClampedToGround: () => undefined,
            flyTo: (options: Flight["options"], data?: Record<string, unknown>) => {
                flights.push({ options, data });
                state.moving = options.duration > 0;
                if (!state.moving) {
                    state.zoom = options.zoom;
                    fire("moveend", data ?? {});
                }
            },
            easeTo: (options: unknown) => eases.push(options),
            jumpTo: (options: unknown) => jumps.push(options),
            stop: () => {
                stops.count += 1;
                if (!state.moving) return;
                state.moving = false;
                fire("moveend", {});
            },
        };
        return { map: map as unknown as Parameters<typeof createCamera>[0], flights, jumps, eases, stops, state, fire };
    }

    it("🔴 fliegt zur Folgestellung, statt zu springen: eine Fahrt mit Dauer, nach Regeln der Kamera", () => {
        const { map, flights, jumps } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        void camera.approach([10, 5], { zoom: 7, bearing: 90, pitch: 30 });
        expect(jumps).toEqual([]);
        expect(flights).toHaveLength(1);
        const { options, data } = flights[0] as Flight;
        expect(options).toMatchObject({ center: [10, 5], zoom: 7, bearing: 90, pitch: 30, essential: false });
        // Eine echte Fahrt: mehr als das Mindestmaß, höchstens das Höchstmaß.
        expect(options.duration).toBeGreaterThanOrEqual(FLIGHT_MS.min);
        expect(options.duration).toBeLessThanOrEqual(FLIGHT_MS.max);
        // Sie trägt das Kennzeichen der Folge, damit MapLibre das Klemmen auf den Boden nicht noch einmal löst.
        expect(data?.[FOLLOW_EVENT]).toBe(true);
    });

    it("die Dauer folgt der Entfernung und dem Zoom", () => {
        const { map, flights } = flyingMap({ zoom: 4 });
        const camera = createCamera(map, undefined, () => 0);
        void camera.approach([1, 0], { zoom: 4 });
        void camera.approach([30, 0], { zoom: 4 });
        void camera.approach([30, 0], { zoom: 8 });
        const [near, far, zoomed] = flights.map((flight) => flight.options.duration) as [number, number, number];
        expect(far).toBeGreaterThan(near);
        expect(zoomed).toBeGreaterThan(far);
    });

    it("die Drehung bleibt, wo die Folge sie nicht selbst führt, und die Neigung bleibt in der Grenze des Zooms", () => {
        const { map, flights } = flyingMap({ zoom: 3, bearing: 33, pitch: 0 });
        const camera = createCamera(map, undefined, () => 0);
        void camera.approach([10, 5], { zoom: 3, pitch: 60 });
        // Im Überblick höchstens 30°.
        expect(flights[0]?.options).toMatchObject({ bearing: 33, pitch: 30 });
    });

    it("🔴 kommt an, wenn der Flug die ganze Dauer gelaufen ist", async () => {
        let clock = 0;
        const { map, flights, state, fire } = flyingMap();
        const camera = createCamera(map, undefined, () => clock);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        const duration = (flights[0] as Flight).options.duration;
        clock += duration;
        state.moving = false;
        fire("moveend", { [FOLLOW_EVENT]: true });
        await expect(arrived).resolves.toBe(true);
    });

    it("🔴 endet der Flug zu früh (eine Hand hat ihn angehalten), ist sie nicht angekommen", async () => {
        let clock = 0;
        const { map, state, fire } = flyingMap();
        const camera = createCamera(map, undefined, () => clock);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        clock += 200;
        state.moving = false;
        fire("moveend", {});
        await expect(arrived).resolves.toBe(false);
    });

    it("🔴 jede andere Bewegung nimmt dem Flug die Kamera: die Hand war schneller", async () => {
        const { map, fire } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        fire("movestart", { originalEvent: {} });
        await expect(arrived).resolves.toBe(false);
    });

    it("die eigene Fahrt und die Folge nehmen sie ihm nicht", async () => {
        let clock = 0;
        const { map, flights, state, fire } = flyingMap();
        const camera = createCamera(map, undefined, () => clock);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        fire("movestart", { [FOLLOW_EVENT]: true });
        clock += (flights[0] as Flight).options.duration;
        state.moving = false;
        fire("moveend", {});
        await expect(arrived).resolves.toBe(true);
    });

    it("🔴 während des Flugs folgt die Kamera nicht Bild für Bild, und keine andere Fahrt bricht ihn ab", () => {
        const { map, flights, jumps, eases } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        void camera.approach([10, 5], { zoom: 7 });
        camera.follow([50, 50]);
        camera.showPoint([70, 70], 9);
        expect(jumps).toEqual([]);
        expect(eases).toEqual([]);
        expect(flights).toHaveLength(1);
    });

    it("`unfollow` (Pause, freie Kamera) hält die Fahrt an und meldet, dass sie nicht ankam", async () => {
        const { map, stops } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        camera.unfollow();
        expect(stops.count).toBe(1);
        await expect(arrived).resolves.toBe(false);
    });

    it("ein neuer Anflug überholt den alten: Der alte kam nicht an", async () => {
        const { map, flights } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        const first = camera.approach([10, 5], { zoom: 7 });
        const second = camera.approach([20, 5], { zoom: 7 });
        await expect(first).resolves.toBe(false);
        expect(flights).toHaveLength(2);
        expect(second).toBeInstanceOf(Promise);
    });

    it("🔴 bei „Bewegung reduzieren“ springt die Kamera - dort ist das richtig - und meldet gleich die Ankunft", async () => {
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        const { map, flights } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        await expect(camera.approach([10, 5], { zoom: 7 })).resolves.toBe(true);
        expect(flights[0]?.options.duration).toBe(0);
    });

    it("liegt sie schon dort, gibt es nichts zu fliegen: gleich angekommen, ohne Wartezeit", async () => {
        const { map, flights } = flyingMap({ zoom: 7 });
        const camera = createCamera(map, undefined, () => 0);
        await expect(camera.approach([0, 0], { zoom: 7 })).resolves.toBe(true);
        expect(flights[0]?.options.duration).toBe(0);
    });

    it("nach der Ankunft gilt sie als folgend: Ring und Tasten fahren nicht dazwischen", async () => {
        let clock = 0;
        const { map, flights, state, fire, eases } = flyingMap();
        const camera = createCamera(map, undefined, () => clock);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        clock += (flights[0] as Flight).options.duration;
        state.moving = false;
        fire("moveend", {});
        await arrived;
        camera.zoomBy(1);
        expect(eases).toEqual([]);
    });

    it("destroy meldet den laufenden Flug als nicht angekommen und nimmt die Zuhörer ab", async () => {
        const { map, fire } = flyingMap();
        const camera = createCamera(map, undefined, () => 0);
        const arrived = camera.approach([10, 5], { zoom: 7 });
        camera.destroy();
        await expect(arrived).resolves.toBe(false);
        // Ein späteres Ereignis trifft niemanden mehr.
        expect(() => fire("moveend", {})).not.toThrow();
    });
});
