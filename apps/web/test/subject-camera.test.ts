import { describe, expect, it, vi } from "vitest";
import {
    AVENTURIA,
    FLY_MAX_BAND,
    PLACE_ZOOM_FLOOR,
    SEARCH_FIT_MAX_ZOOM,
    renderZoomForBand,
    toRenderLngLat,
    type SubjectRef,
    type SubjectTarget,
} from "@avesmaps3d/shared";
import { flyToSubject } from "../src/info-panel/subject-camera.ts";
import type { Camera } from "../src/map/camera/camera.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";

/**
 * Die Kamera für einen Subject, der nicht von der Karte kam (WI-0063 4.6): nur über `camera.ts`, nur fliegen.
 */

const space = AVENTURIA.coordinateSpace;
const pos = (x: number, y: number): [number, number] => {
    const { lng, lat } = toRenderLngLat(space, { x, y });
    return [lng, lat];
};

function camera(): {
    showPoint: ReturnType<typeof vi.fn<Camera["showPoint"]>>;
    showBounds: ReturnType<typeof vi.fn<Camera["showBounds"]>>;
    showView: ReturnType<typeof vi.fn<Camera["showView"]>>;
} {
    return {
        showPoint: vi.fn<Camera["showPoint"]>(),
        showBounds: vi.fn<Camera["showBounds"]>(),
        showView: vi.fn<Camera["showView"]>(),
    };
}

describe("das Ziel aus `detail.target`", () => {
    it("🔴 ein Ort: in die sichtbare Mitte, heran nur bis zur Mindestnähe (`showPoint`)", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "place", id: "x" }, { x: 551.625, y: 532.969, zoom: 5 });
        expect(cam.showPoint).toHaveBeenCalledWith(pos(551.625, 532.969), 5);
        expect(cam.showBounds).not.toHaveBeenCalled();
        expect(cam.showView).not.toHaveBeenCalled();
    });

    it("🔴 eine Landschaft und ein Weg mit Umriss: einpassen, gedeckelt wie die Suche", () => {
        const target: SubjectTarget = { x: 10, y: 10, zoom: 4, bounds: [0, 0, 20, 30] };
        const area = camera();
        flyToSubject(area, { kind: "area", id: "x" }, target);
        expect(area.showBounds).toHaveBeenCalledTimes(1);
        expect(area.showBounds.mock.calls[0]?.[1]).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft });
        const path = camera();
        flyToSubject(path, { kind: "path", chain: "Gardel:Flussweg" }, target);
        expect(path.showBounds.mock.calls[0]?.[1]).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
        // Der Umriss in Renderkoordinaten: Südwest und Nordost.
        const [southWest, northEast] = area.showBounds.mock.calls[0]?.[0] as [[number, number], [number, number]];
        expect(southWest[0]).toBeLessThan(northEast[0]);
        expect(southWest[1]).toBeLessThan(northEast[1]);
    });

    it("🔴 eine Kraftlinie mit Umriss fliegt höchstens bis Stufe 7, nie auf die neue Stufe 8 (WI-0129 R2)", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "powerline", anchor: "x" }, { x: 10, y: 10, zoom: 4, bounds: [9, 9, 9.2, 9.1] });
        expect(cam.showBounds.mock.calls[0]?.[1]).toEqual({ maxZoom: renderZoomForBand(FLY_MAX_BAND) });
        expect(renderZoomForBand(FLY_MAX_BAND)).toBe(8);
    });

    it("ohne Umriss fliegt eine Fläche zu Mitte und Zoom des Ziels (`showView`)", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "area", id: "x" }, { x: 10, y: 20, zoom: 4 });
        expect(cam.showView).toHaveBeenCalledWith(pos(10, 20), 4);
    });

    it("🔴 ein Klimaband fliegt wie der Sprung der Suche: Mitte und Zoom des Ziels, ein Band reicht von Rand zu Rand (`showView`)", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "climate", band: "gemaessigt" }, { x: 512, y: 560, zoom: renderZoomForBand(1) });
        expect(cam.showView).toHaveBeenCalledWith(pos(512, 560), renderZoomForBand(1));
        expect(cam.showPoint).not.toHaveBeenCalled();
        expect(cam.showBounds).not.toHaveBeenCalled();
    });

    it("ein Gebiet fliegt in das Band, in dem es als Fläche vor einem liegt (wie aus dem Planer)", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "territory", id: "x" }, { x: 10, y: 20, zoom: 5 });
        expect(cam.showView).toHaveBeenCalledTimes(1);
        expect(cam.showView.mock.calls[0]?.[0]).toEqual(pos(10, 20));
    });

    it("🔴 eine Kartenstelle hat kein Ziel in der Antwort: Sie liegt, wo man hinzeigte, mit dem Boden des Zooms", () => {
        const cam = camera();
        const point: SubjectRef = { kind: "mapPoint", x: 12.5, y: 40.25 };
        flyToSubject(cam, point, undefined);
        expect(cam.showPoint).toHaveBeenCalledWith(pos(12.5, 40.25), renderZoomForBand(PLACE_ZOOM_FLOOR));
    });

    it("ohne Ziel und ohne Kartenstelle bleibt die Kamera, wo sie ist", () => {
        const cam = camera();
        flyToSubject(cam, { kind: "place", id: "x" }, undefined);
        expect(cam.showPoint).not.toHaveBeenCalled();
        expect(cam.showView).not.toHaveBeenCalled();
    });
});

describe("der kurze Cache unter (revision, Schlüssel)", () => {
    const entry = (revision: string): { revision: string; value: number } => ({ revision, value: 1 });

    it("🔴 hält nur Einträge der jüngsten Revision, und ein Eintrag einer anderen Revision gilt nie", () => {
        const cache = createRevisionCache<{ revision: string; value: number }>({ ttlMs: 1000, size: 5, now: () => 0 });
        cache.set("a", entry("r1"));
        expect(cache.get("a")?.revision).toBe("r1");
        cache.set("b", entry("r2"));
        expect(cache.revision()).toBe("r2");
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")?.revision).toBe("r2");
    });

    it("läuft nach seiner Zeit ab und kennt eine Höchstzahl: der am längsten ungelesene geht zuerst", () => {
        let now = 0;
        const cache = createRevisionCache<{ revision: string; value: number }>({ ttlMs: 100, size: 2, now: () => now });
        cache.set("a", entry("r"));
        cache.set("b", entry("r"));
        cache.get("a");
        cache.set("c", entry("r"));
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBeDefined();
        now = 101;
        expect(cache.get("a")).toBeUndefined();
        cache.clear();
        expect(cache.get("c")).toBeUndefined();
    });
});
