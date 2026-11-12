import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { CAMERA_DURATION, createCamera, fitMargin } from "../src/map/camera/camera.ts";
import { boundsMiddle, centreForOffset } from "../src/map/camera/camera-math.ts";
import { NO_INSETS, type Insets } from "../src/map/camera/visible-area.ts";

/** MapLibres senkrechtes Sichtfeld, wie es die Attrappe meldet. */
const FOV = 36.87;

/**
 * Die Kamera nach Absicht (WI-0039): Punkt zeigen, Ausschnitt zeigen, Ring und Tasten - und dass jeder
 * Befehl während einer Fahrt auf deren Ziel aufbaut. Wie es im Browser aussieht, zeigt
 * `e2e/camera-target.spec.ts`.
 */

interface View {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
}

interface Move extends View {
    how: "fly" | "ease";
    duration: number;
    essential: boolean;
}

/**
 * Eine Karte, die wie MapLibre fährt: Eine Fahrt läuft, bis `finish()` sie ans Ziel bringt; eine neue
 * Fahrt beendet die laufende mit `moveend`. Mit `reducedMotion` springt jede Fahrt sofort.
 */
function fakeMap(start: Partial<View> & { reducedMotion?: boolean } = {}) {
    const view: View = { center: [0, 0], zoom: 5, bearing: 0, pitch: 0, ...start };
    const moves: Move[] = [];
    const fits: { padding: Insets; bearing: number }[] = [];
    const listeners = new Map<string, Set<() => void>>();
    let running: View | undefined;
    const fire = (event: string) => listeners.get(event)?.forEach((listener) => listener());
    const stop = () => {
        if (!running) return;
        running = undefined;
        fire("moveend");
    };
    const move = (how: "fly" | "ease") => (options: Move) => {
        stop();
        moves.push({ ...options, how });
        const target = { center: options.center, zoom: options.zoom, bearing: options.bearing, pitch: options.pitch };
        if (start.reducedMotion) {
            Object.assign(view, target);
            fire("moveend");
        } else {
            running = target;
        }
    };
    const map = {
        // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
        painter: { transform: { maxPitchScaleFactor: () => 1 } },
        getCenter: () => ({ lng: view.center[0], lat: view.center[1] }),
        getZoom: () => view.zoom,
        getBearing: () => view.bearing,
        getPitch: () => view.pitch,
        getMinZoom: () => 0,
        getMaxZoom: () => 8,
        getVerticalFieldOfView: () => FOV,
        getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
        isMoving: () => running !== undefined,
        on: (event: string, listener: () => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(listener);
        },
        off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
        cameraForBounds: (_bounds: unknown, options: { padding: Insets; bearing: number }) => {
            fits.push(options);
            return { center: { lng: 1, lat: 2 }, zoom: 3, bearing: options.bearing };
        },
        flyTo: move("fly"),
        easeTo: move("ease"),
        // Ein Sprung beendet die laufende Fahrt, wie in MapLibre.
        jumpTo: () => stop(),
    };
    /** Die laufende Fahrt kommt an. */
    const finish = () => {
        if (!running) return;
        Object.assign(view, running);
        running = undefined;
        fire("moveend");
    };
    return { map: map as unknown as MapLibreMap, view, moves, fits, finish };
}

const GARETH: [number, number] = [10, 20];

describe("Punkt zeigen (E2): Mindestnähe, nie heraus", () => {
    it("aus weiter Ferne fährt die Karte bis zur Mindestnähe heran", () => {
        const { map, moves } = fakeMap({ zoom: 2.5 });
        createCamera(map).showPoint(GARETH, 5);
        expect(moves).toEqual([
            {
                how: "fly",
                center: GARETH,
                zoom: 5,
                bearing: 0,
                pitch: 0,
                duration: CAMERA_DURATION.point,
                essential: false,
            },
        ]);
    });

    it("🔴 wer schon näher ist, bleibt so nah - Gareth auf Zoom 7 bleibt Zoom 7", () => {
        const { map, moves } = fakeMap({ zoom: 7 });
        createCamera(map).showPoint(GARETH, 5);
        expect(moves[0]).toMatchObject({ center: GARETH, zoom: 7 });
    });

    it("in 3D bleiben Drehung und Neigung - nur die Grenze nach Zoom zählt", () => {
        const { map, moves } = fakeMap({ zoom: 7, bearing: 120, pitch: 45 });
        createCamera(map).showPoint(GARETH, 5);
        expect(moves[0]).toMatchObject({ zoom: 7, bearing: 120, pitch: 45 });
        const far = fakeMap({ zoom: 2, bearing: -30, pitch: 30 });
        createCamera(far.map).showPoint(GARETH, 4);
        // Auf Zoom 4 erlaubt die Grenze 45°: Die gewählten 30° bleiben.
        expect(far.moves[0]).toMatchObject({ zoom: 4, bearing: -30, pitch: 30 });
    });

    it("nie über den höchsten Zoom der Karte", () => {
        const { map, moves } = fakeMap({ zoom: 3 });
        createCamera(map).showPoint(GARETH, 9);
        expect(moves[0]?.zoom).toBe(8);
    });
});

describe("Ausschnitt zeigen: einpassen, auch heraus", () => {
    it("passt mit Rand in die sichtbare Fläche ein, Drehung bleibt, 0,7 s", () => {
        const { map, moves, fits } = fakeMap({ zoom: 6, bearing: 30, pitch: 20 });
        const planer = { ...NO_INSETS, left: 350 };
        createCamera(map, { sync: () => planer, insets: () => planer, keepFree: () => planer }).showBounds([
            [0, 0],
            [1, 1],
        ]);
        // Sichtbar sind 930 × 720 px: 7 % sind 65 bzw. 50 px, links dazu die 350 px des Planers.
        expect(fits).toEqual([{ padding: { top: 50, right: 65, bottom: 50, left: 415 }, bearing: 30 }]);
        // Den Zoom gibt MapLibre (hier 3); die Mitte des Umrisses steht danach in der Mitte der Fläche, bei x = 815.
        const view = { zoom: 3, bearing: 30, pitch: 20 };
        expect(moves[0]).toEqual({
            how: "fly",
            center: centreForOffset(
                boundsMiddle([
                    [0, 0],
                    [1, 1],
                ]),
                175,
                0,
                view,
                FOV,
                720,
            ),
            ...view,
            duration: CAMERA_DURATION.fit,
            essential: false,
        });
    });

    it("legt die Neigung in die Grenze des neuen Zooms - im Überblick höchstens 30°", () => {
        const { map, moves } = fakeMap({ zoom: 7, pitch: 55 });
        createCamera(map).showBounds([
            [0, 0],
            [9, 9],
        ]);
        expect(moves[0]).toMatchObject({ zoom: 3, pitch: 30 });
    });

    it("🔴 eine Seitenleiste verschiebt die Mitte nicht, eingepasst wird trotzdem daneben (E4)", () => {
        // Breiter Schirm: Die Karte hat keinen Rand, aber der Planer deckt links 350 px.
        const { map, fits } = fakeMap({ zoom: 6 });
        const area = { sync: () => NO_INSETS, insets: () => NO_INSETS, keepFree: () => ({ ...NO_INSETS, left: 350 }) };
        createCamera(map, area).showBounds([
            [0, 0],
            [1, 1],
        ]);
        // Frei sind 930 × 720 px: 65 bzw. 50 px Rand, links dazu die 350 px der Seitenleiste.
        expect(fits[0]?.padding).toEqual({ top: 50, right: 65, bottom: 50, left: 415 });
    });

    it("🔴 ein kleiner Umriss holt höchstens bis zum Deckel heran (WI-0044, Legacy maxZoom)", () => {
        const { map, fits } = fakeMap({ zoom: 3 });
        createCamera(map).showBounds(
            [
                [0, 0],
                [1, 1],
            ],
            { maxZoom: 6 },
        );
        expect(fits[0]).toMatchObject({ maxZoom: 6 });
    });

    it("🔴 `minZoom` deckelt, wie weit ein großer Umriss hinauszoomt; seine Mitte rückt trotzdem in die freie Fläche („formmodus A“)", () => {
        const { map, moves } = fakeMap({ zoom: 7 });
        createCamera(map).showBounds(
            [
                [0, 0],
                [9, 9],
            ],
            { minZoom: 6 },
        );
        // Einpassen wollte 3; die Untergrenze lässt höchstens eine Stufe hinaus.
        expect(moves[0]).toMatchObject({ zoom: 6 });
    });

    it("der Rand ist mindestens 40 bzw. 32 px", () => {
        expect(fitMargin({ width: 300, height: 200 })).toEqual({ top: 32, right: 40, bottom: 32, left: 40 });
    });

    it("ein Ausschnitt mit eigenem Zoom (Weg, Landschaft) darf herauszoomen", () => {
        const { map, moves } = fakeMap({ zoom: 7 });
        createCamera(map).showView([3, 4], 4);
        expect(moves[0]).toMatchObject({ how: "fly", center: [3, 4], zoom: 4, duration: CAMERA_DURATION.point });
    });
});

describe("Ein Befehl während einer Fahrt baut auf ihrem Ziel auf", () => {
    it("🔴 „+“ während des Suchflugs landet am Ziel der Suche, eine Stufe näher", () => {
        const { map, moves } = fakeMap({ zoom: 3, center: [0, 0] });
        const camera = createCamera(map);
        camera.showPoint(GARETH, 5);
        camera.zoomBy(1);
        expect(moves[1]).toMatchObject({ how: "ease", center: GARETH, zoom: 6, duration: CAMERA_DURATION.button });
    });

    it("auch das Verschieben: der Schritt geht vom Ziel aus, nicht vom halben Weg", () => {
        const { map, moves } = fakeMap({ zoom: 3, center: [0, 0] });
        const camera = createCamera(map);
        camera.showPoint(GARETH, 5);
        camera.panBy(100, 0);
        const shifted = moves[1]?.center ?? [0, 0];
        expect(shifted[0]).toBeGreaterThan(GARETH[0]);
        expect(shifted[1]).toBeCloseTo(GARETH[1], 6);
        // Zweimal schnell hintereinander: doppelt so weit.
        camera.panBy(100, 0);
        const twice = moves[2]?.center ?? [0, 0];
        expect(twice[0] - GARETH[0]).toBeCloseTo(2 * (shifted[0] - GARETH[0]), 6);
    });

    it("zweimal schnell drehen dreht zweimal - 30°, nicht 20°", () => {
        const { map, moves } = fakeMap();
        const camera = createCamera(map);
        camera.rotateBy(15);
        camera.rotateBy(15);
        expect(moves[1]?.bearing).toBe(30);
    });

    it("ist die Fahrt angekommen, gilt wieder der echte Stand", () => {
        const { map, moves, finish, view } = fakeMap({ zoom: 3 });
        const camera = createCamera(map);
        camera.showPoint(GARETH, 5);
        finish();
        view.center = [50, 50];
        camera.zoomBy(1);
        expect(moves[1]).toMatchObject({ center: [50, 50], zoom: 6 });
    });

    it("🪤 bei „Bewegung reduzieren“ springt die Karte - es bleibt kein altes Ziel stehen", () => {
        const { map, moves, view } = fakeMap({ zoom: 3, reducedMotion: true });
        const camera = createCamera(map);
        camera.showPoint(GARETH, 5);
        expect(view).toMatchObject({ center: GARETH, zoom: 5 });
        view.center = [50, 50];
        camera.zoomBy(1);
        expect(moves[1]).toMatchObject({ center: [50, 50], zoom: 6 });
    });

    it("die sichtbare Fläche wird vor jedem Befehl gemessen - ohne das Ziel zu verlieren", () => {
        const { map, moves } = fakeMap({ zoom: 3 });
        let syncs = 0;
        const area = {
            sync: () => {
                syncs += 1;
                return NO_INSETS;
            },
            insets: () => NO_INSETS,
            keepFree: () => NO_INSETS,
        };
        const camera = createCamera(map, area);
        camera.showPoint(GARETH, 5);
        camera.zoomBy(1);
        expect(syncs).toBe(2);
        expect(moves[1]).toMatchObject({ center: GARETH, zoom: 6 });
    });

    it("🔴 auf der Kurve kippt „+“ mit (Betreiber 2026-11-08/09), sonst bleibt die Neigung", () => {
        const { map, moves, finish } = fakeMap({ zoom: 6, pitch: 45 });
        const camera = createCamera(map);
        camera.zoomBy(1);
        camera.zoomBy(1);
        expect(moves.map((move) => move.pitch)).toEqual([55, 65]);
        finish();
        const { map: frei, moves: freieSchritte } = fakeMap({ zoom: 5, pitch: 50 });
        createCamera(frei).zoomBy(1);
        expect(freieSchritte[0]?.pitch).toBe(50);
    });

    it("zoomt nicht über die Grenzen der Karte hinaus - der nächste Schritt heraus wirkt sofort", () => {
        const { map, moves } = fakeMap({ zoom: 7.5 });
        const camera = createCamera(map);
        camera.zoomBy(1);
        camera.zoomBy(-1);
        expect(moves.map((move) => move.zoom)).toEqual([8, 7]);
    });
});
