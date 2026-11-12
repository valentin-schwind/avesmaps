import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { createCamera } from "../src/map/camera/camera.ts";
import {
    boundsMiddle,
    centreForOffset,
    groundOffset,
    locationAtOffset,
    shiftCenter,
} from "../src/map/camera/camera-math.ts";
import { NO_INSETS, type Insets } from "../src/map/camera/visible-area.ts";

/**
 * Der Fluchtpunkt bleibt in der Bildmitte, die Ziele landen in der freien Fläche (WI-0218; Betreiber 2026-10-17 über die
 * Orchestrierung: „ok, aber beachte dass bei angedockten editoren ein klick auf die ziel objekte ebenfalls nicht in der bildmitte
 * erfolgen sollen“). Wie es im Browser in 3D aussieht, zeigt `e2e/kamera-fluchtpunkt.spec.ts`.
 */

/** MapLibres senkrechtes Sichtfeld (36,87°) und eine Karte von 1280 × 720 px. */
const FOV = 36.87;
const HEIGHT = 720;

/**
 * Das Orakel: die geschlossene Formel, mit der der Playmode bis zur Nachbesserung von WI-0218 seinen Blickraum rechnete (`behindCentre`),
 * unabhängig von `groundOffset` hergeleitet. Wie weit die Mitte vor einem Punkt liegen muss, der `below` Bildpunkte unter ihr steht.
 */
function behindCentre(below: number, pitch: number, fov: number, height: number): number {
    const distance = (0.5 * height) / Math.tan((fov * Math.PI) / 360);
    const tilt = (pitch * Math.PI) / 180;
    return distance * Math.sin(tilt) - distance * Math.cos(tilt) * Math.tan(tilt - Math.atan(below / distance));
}

describe("die Lochkamera: wo eine Stelle des Bildes auf dem Boden liegt", () => {
    it("flach ist es die Verschiebung selbst", () => {
        expect(groundOffset(120, -40, 0, FOV, HEIGHT)).toEqual({ right: 120, ahead: 40 });
    });

    it("geneigt ist die Bildzeile durch die Mitte maßstabsgleich: quer neben der Mitte bleibt quer", () => {
        const ground = groundOffset(-300, 0, 60, FOV, HEIGHT);
        expect(ground?.right).toBeCloseTo(-300, 9);
        expect(ground?.ahead).toBeCloseTo(0, 9);
    });

    it("🔴 geneigt liegt eine Stelle über der Mitte weiter weg als flach - wie `behindCentre` im Playmode", () => {
        const ground = groundOffset(0, -200, 60, FOV, HEIGHT);
        expect(ground?.ahead).toBeGreaterThan(200);
        expect(ground?.ahead).toBeCloseTo(-behindCentre(-200, 60, FOV, HEIGHT), 9);
        expect(groundOffset(0, 150, 45, FOV, HEIGHT)?.ahead).toBeCloseTo(-behindCentre(150, 45, FOV, HEIGHT), 9);
    });

    it("ein Punkt unter der Mitte: flach dieselbe Strecke, geneigt mehr Boden (der Blickraum des Playmodes)", () => {
        expect(-(groundOffset(0, 96, 0, FOV, 800)?.ahead ?? 0)).toBeCloseTo(96, 6);
        const at45 = -(groundOffset(0, 96, 45, FOV, 800)?.ahead ?? 0);
        expect(at45).toBeGreaterThan(96);
        expect(-(groundOffset(0, 96, 60, FOV, 800)?.ahead ?? 0)).toBeGreaterThan(at45);
        // Gegenrechnung: der Punkt so weit hinter der Mitte erscheint genau 96 px unter ihr.
        const distance = 400 / Math.tan((FOV * Math.PI) / 360);
        const tilt = Math.PI / 4;
        const angle = tilt - Math.atan((distance * Math.sin(tilt) - at45) / (distance * Math.cos(tilt)));
        expect(distance * Math.tan(angle)).toBeCloseTo(96, 6);
    });

    it("über dem Horizont gibt es keinen Boden", () => {
        expect(groundOffset(0, -2000, 80, FOV, HEIGHT)).toBeUndefined();
    });

    it("hin und zurück ist wieder derselbe Ort, auch gedreht und geneigt", () => {
        const view = { zoom: 6, bearing: 33, pitch: 55 };
        const centre = centreForOffset([10, 20], -300, -120, view, FOV, HEIGHT);
        const [lng, lat] = locationAtOffset(centre, -300, -120, view, FOV, HEIGHT);
        expect(lng).toBeCloseTo(10, 9);
        expect(lat).toBeCloseTo(20, 9);
    });

    it("die Mitte eines Umrisses ist die Mercator-Mitte, nicht die Mitte der Grade", () => {
        const [lng, lat] = boundsMiddle([
            [0, 0],
            [10, 60],
        ]);
        expect(lng).toBe(5);
        expect(lat).toBeGreaterThan(30);
        // Mercator: 2 · atan(e^((0 + ln tan 75°) / 2)) − 90° = 35,26°.
        expect(lat).toBeCloseTo(35.26, 2);
    });
});

interface View {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
}

/** Eine Karte wie in `camera-intent.test.ts`: Eine Fahrt läuft, bis `finish()` sie ans Ziel bringt. */
function fakeMap(start: Partial<View> = {}) {
    const view: View = { center: [0, 0], zoom: 6, bearing: 0, pitch: 0, ...start };
    const moves: (View & { around?: [number, number] })[] = [];
    const listeners = new Map<string, Set<() => void>>();
    let running: View | undefined;
    const fire = (event: string) => listeners.get(event)?.forEach((listener) => listener());
    const move = (options: View & { around?: [number, number] }) => {
        if (running) {
            running = undefined;
            fire("moveend");
        }
        moves.push(options);
        running = { center: options.center, zoom: options.zoom, bearing: options.bearing, pitch: options.pitch };
    };
    const map = {
        painter: { transform: { maxPitchScaleFactor: () => 1 } },
        getCenter: () => ({ lng: view.center[0], lat: view.center[1] }),
        getZoom: () => view.zoom,
        getBearing: () => view.bearing,
        getPitch: () => view.pitch,
        getMinZoom: () => 0,
        getMaxZoom: () => 8,
        getVerticalFieldOfView: () => FOV,
        getCanvas: () => ({ clientWidth: 1280, clientHeight: HEIGHT }),
        isMoving: () => running !== undefined,
        on: (event: string, listener: () => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(listener);
        },
        off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
        flyTo: move,
        easeTo: move,
        jumpTo: () => undefined,
    };
    return { map: map as unknown as MapLibreMap, moves };
}

/** Ein angedockter Editor rechts, 600 px: Die Mitte der freien Fläche liegt bei x = 340, 300 px links der Bildmitte. */
const EDITOR: Insets = { ...NO_INSETS, right: 600 };
const area = (insets: Insets) => ({ sync: () => insets, insets: () => insets, keepFree: () => insets });
const GARETH: [number, number] = [10, 20];

describe("🔴 WI-0218: die Ziele landen in der freien Fläche, der Fluchtpunkt bleibt in der Bildmitte", () => {
    it("ein Punkt (Doppelklick, Enter, Klick auf ein Ziel, Suche) landet geneigt in der Mitte neben dem Editor", () => {
        const { map, moves } = fakeMap({ zoom: 6, pitch: 50 });
        void createCamera(map, area(EDITOR)).showPoint(GARETH, 5);
        const landed = moves[0]!;
        const at = locationAtOffset(landed.center, -300, 0, landed, FOV, HEIGHT);
        expect(at[0]).toBeCloseTo(GARETH[0], 9);
        expect(at[1]).toBeCloseTo(GARETH[1], 9);
        expect(landed).toMatchObject({ zoom: 6, pitch: 50 });
    });

    it("🔴 ein Panel unten (Telefon): geneigt liegt die freie Mitte weiter weg als die flache Rechnung", () => {
        const { map, moves } = fakeMap({ zoom: 6, pitch: 50 });
        void createCamera(map, area({ ...NO_INSETS, bottom: 300 })).showPoint(GARETH, 5);
        const flat = shiftCenter(GARETH, 0, 150, 6, 0);
        // Die Mitte der Karte liegt südlich des Ziels, und zwar weiter als die 150 px der flachen Rechnung.
        expect(moves[0]!.center[1]).toBeLessThan(flat[1]);
    });

    it("🔴 Ring und Tasten drehen um die Mitte der freien Fläche: Was dort liegt, bleibt dort", () => {
        const { map, moves } = fakeMap({ zoom: 6, pitch: 40, center: GARETH });
        createCamera(map, area(EDITOR)).rotateBy(15);
        const step = moves[0]!;
        const pivot = locationAtOffset(GARETH, -300, 0, { zoom: 6, bearing: 0, pitch: 40 }, FOV, HEIGHT);
        // MapLibre hält den Ort fest (`around`), und am Ende steht die Mitte dort, wo er an seiner Stelle bleibt.
        expect(step.around).toEqual(pivot);
        expect(step.bearing).toBe(15);
        const after = locationAtOffset(step.center, -300, 0, step, FOV, HEIGHT);
        expect(after[0]).toBeCloseTo(pivot[0], 9);
        expect(after[1]).toBeCloseTo(pivot[1], 9);
    });

    it("mitten in einer Fahrt baut der Schritt auf ihrem Ziel auf, ohne festzuhalten, was gerade dort vorbeifliegt", () => {
        const { map, moves } = fakeMap({ zoom: 4 });
        const camera = createCamera(map, area(EDITOR));
        void camera.showPoint(GARETH, 5);
        camera.zoomBy(1);
        const zoomed = moves[1]!;
        expect(zoomed.around).toBeUndefined();
        expect(zoomed.zoom).toBe(6);
        // Das Ziel der Suche steht nach dem Zoom weiter in der freien Mitte.
        const at = locationAtOffset(zoomed.center, -300, 0, zoomed, FOV, HEIGHT);
        expect(at[0]).toBeCloseTo(GARETH[0], 9);
        expect(at[1]).toBeCloseTo(GARETH[1], 9);
    });

    it("Verschieben verschiebt nur: kein Festhalten, dieselbe Strecke wie ohne Editor", () => {
        const { map, moves } = fakeMap({ center: GARETH });
        createCamera(map, area(EDITOR)).panBy(100, 0);
        expect(moves[0]!.around).toBeUndefined();
        expect(moves[0]!.center).toEqual(shiftCenter(GARETH, 100, 0, 6, 0));
    });

    it("ohne Panel bleibt alles beim Alten: die Mitte der Karte, kein Festhalten", () => {
        const { map, moves } = fakeMap({ center: GARETH, pitch: 40 });
        const camera = createCamera(map, area(NO_INSETS));
        camera.rotateBy(15);
        void camera.showPoint([1, 2], 5);
        expect(moves[0]).toMatchObject({ center: GARETH, bearing: 15 });
        expect(moves[0]!.around).toBeUndefined();
        expect(moves[1]!.center).toEqual([1, 2]);
    });

    it("die Kamera nennt den Bezug, auf den sie zielt (für den Playmode)", () => {
        const { map } = fakeMap();
        expect(createCamera(map, area(EDITOR)).insets()).toEqual(EDITOR);
        expect(createCamera(map).insets()).toEqual(NO_INSETS);
    });
});
