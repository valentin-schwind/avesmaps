import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { FLIGHT_PITCH } from "../src/map/camera/camera-math.ts";
import type { Camera } from "../src/map/camera/camera.ts";
import { FLIGHT_ZOOM, createTravelerView } from "../src/map/traveler-view.ts";

/**
 * Der Anflug zum Pfeil (Betreiber 2026-09-29: die Kamera springt nie): Die Ansicht rechnet die Folgestellung
 * und schickt die Kamera im Flug dorthin. Der Flug endet dort, wo das erste Folgebild beginnt - Flughöhe und
 * Neigung trägt er selbst, die Steigfahrt des Starts (`takeOff`) ist damit erledigt.
 */

interface Recorded {
    approaches: { centre: [number, number]; view: { bearing?: number; pitch?: number; zoom?: number } | undefined }[];
    follows: { centre: [number, number]; view: { bearing?: number; pitch?: number; zoom?: number } | undefined }[];
}

function setup(state: { zoom: number; pitch: number; bearing: number }) {
    const recorded: Recorded = { approaches: [], follows: [] };
    let zoomChoice: ((zoom: number) => void) | undefined;
    const map = {
        getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
        getZoom: () => state.zoom,
        getPitch: () => state.pitch,
        getBearing: () => state.bearing,
        getCenter: () => ({ lng: 0, lat: 0 }),
        getVerticalFieldOfView: () => 36.87,
        triggerRepaint: () => undefined,
        on: () => undefined,
        off: () => undefined,
        getCanvasContainer: () => new EventTarget(),
    } as unknown as MapLibreMap;
    const camera = {
        state: () => ({ ...state }),
        // Ohne Panel: der Bezug der Mitte ist leer (WI-0218).
        insets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
        follow: (centre: [number, number], view?: Recorded["follows"][number]["view"]) =>
            recorded.follows.push({ centre, view }),
        approach: (centre: [number, number], view?: Recorded["approaches"][number]["view"]) => {
            recorded.approaches.push({ centre, view });
            return Promise.resolve(true);
        },
        onZoomChoice: (listener: (zoom: number) => void) => {
            zoomChoice = listener;
            return () => undefined;
        },
    } as unknown as Camera;
    const view = createTravelerView(
        () => map,
        () => camera,
        () => 0,
    );
    return { view, recorded, chooseZoom: (zoom: number) => zoomChoice?.(zoom) };
}

const at = { x: 500, y: 500, heading: 90 };
const renderAt = (): [number, number] => {
    const { lng, lat } = toRenderLngLat(AVENTURIA.coordinateSpace, at);
    return [lng, lat];
};

describe("Anflug der Ansicht", () => {
    it("🔴 in 2D fliegt die Kamera zur Mitte über dem Pfeil, auf Flughöhe - der Zoom geht nicht erst im nächsten Bild", () => {
        const { view, recorded } = setup({ zoom: 4, pitch: 0, bearing: 0 });
        view.takeOff(false);
        void view.approach(at, 90);
        expect(recorded.follows).toEqual([]);
        expect(recorded.approaches).toEqual([{ centre: renderAt(), view: { zoom: FLIGHT_ZOOM } }]);
    });

    it("🔴 in 3D fliegt sie in die Folgestellung: Blick in Fahrtrichtung, Neigung bis zum Anschlag, Mitte vor dem Pfeil", () => {
        const { view, recorded } = setup({ zoom: 4, pitch: 40, bearing: 0 });
        view.takeOff(false);
        void view.approach(at, 90);
        const flight = recorded.approaches[0];
        expect(flight?.view).toEqual({ bearing: 90, pitch: FLIGHT_PITCH, zoom: FLIGHT_ZOOM });
        // Die Mitte liegt vor dem Pfeil, in Fahrtrichtung, nicht auf ihm.
        const [lng] = flight?.centre as [number, number];
        expect(lng).toBeGreaterThan(renderAt()[0]);
    });

    it("die Steigfahrt ist mit dem Flug erledigt: Das erste Folgebild danach ändert den Zoom nicht mehr", () => {
        const { view, recorded } = setup({ zoom: 4, pitch: 0, bearing: 0 });
        view.takeOff(false);
        void view.approach(at, 90);
        view.follow(at, false, 90);
        expect(recorded.follows).toEqual([{ centre: renderAt(), view: undefined }]);
    });

    it("ein selbst gewählter Zoom ist die Flughöhe dieser Reise, auch für den Anflug", () => {
        const { view, recorded, chooseZoom } = setup({ zoom: 4, pitch: 0, bearing: 0 });
        // Der Start hört auf den Zoom (`takeOff`), und gewählt zählt er, sobald der Pfeil auf der Karte ist.
        view.takeOff(false);
        view.show(at);
        chooseZoom(9);
        void view.approach(at, 90);
        expect(recorded.approaches[0]?.view).toEqual({ zoom: 9 });
    });

    it("ohne Steigfahrt (ein Sprung der Leiste) bleiben Zoom und Neigung, wie sie sind", () => {
        const { view, recorded } = setup({ zoom: 6, pitch: 0, bearing: 0 });
        void view.approach(at, 90);
        expect(recorded.approaches).toEqual([{ centre: renderAt(), view: {} }]);
    });

    it("ohne Karte oder Kamera gibt es nichts zu fliegen: angekommen", async () => {
        const view = createTravelerView(
            () => undefined,
            () => undefined,
        );
        await expect(view.approach(at, 90)).resolves.toBe(true);
    });
});
