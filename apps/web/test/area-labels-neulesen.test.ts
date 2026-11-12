import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installAreaLabels, NEULESEN_ABSTAND_MS, type AreaLabelSpec } from "../src/map/area-labels";

/**
 * Wie oft die Flächennamen ihre Formen neu lesen (WI-0266): neue Kacheln höchstens einmal je `NEULESEN_ABSTAND_MS`, ein neuer Stil sofort,
 * eine reine Verschiebung gar nicht. Gemessen auf der Stage kostete ein Zug mit Neulesen 11 bis 45 ms, einer ohne 2 bis 5 ms.
 */

type Handler = (event: { sourceId?: string; tile?: unknown }) => void;

function fakeMap() {
    const handlers = new Map<string, Handler[]>();
    let zoom = 4;
    const lesungen: string[] = [];
    const map = {
        on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
        off: (name: string, handler: Handler) =>
            handlers.set(
                name,
                (handlers.get(name) ?? []).filter((h) => h !== handler),
            ),
        getLayer: () => ({}),
        getSource: () => ({ setData: () => undefined }),
        getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
        getZoom: () => zoom,
        querySourceFeatures: (source: string) => {
            lesungen.push(source);
            return [];
        },
        _camera: {
            transform: {
                screenPointToMercatorCoordinate: (p: { x: number; y: number }) => ({ x: p.x / 1e4, y: p.y / 1e4 }),
                locationToScreenPoint: () => ({ x: 0, y: 0 }),
            },
        },
    };
    return {
        map: map as unknown as MapLibreMap,
        lesungen,
        feuer: (name: string, event: { sourceId?: string; tile?: unknown } = {}) =>
            (handlers.get(name) ?? []).forEach((h) => h(event)),
        zoome: (z: number) => {
            zoom = z;
        },
    };
}

const SPEC: AreaLabelSpec = {
    sourceId: "flaechen",
    sourceLayer: "flaechen_render",
    fillLayerId: "flaechen-fill",
    labelSourceId: "flaechen-namen",
    labelLayerId: "flaechen-namen",
    bandOf: () => undefined,
    ausweichen: false,
};

describe("Flächennamen lesen ihre Formen gedrosselt neu (WI-0266)", () => {
    let jetzt = 0;
    beforeEach(() => {
        vi.useFakeTimers();
        jetzt = 1_000;
        vi.spyOn(performance, "now").mockImplementation(() => jetzt);
        vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0) as unknown as number);
        vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /** Ein Bild: Zeit voran und die anstehenden Züge laufen lassen. */
    const bild = (ms = 16): void => {
        jetzt += ms;
        vi.advanceTimersByTime(ms);
    };
    /** Die Formen eines Lesens: die Flächen und die Meere. */
    const lesezahl = (lesungen: string[]): number => lesungen.filter((q) => q === "flaechen").length;

    it("🔴 viele neue Kacheln während einer Bewegung: ein Lesen je Abstand, nicht eines je Bild", () => {
        const karte = fakeMap();
        const labels = installAreaLabels(karte.map, SPEC, { insets: () => ({}) });
        bild();
        expect(lesezahl(karte.lesungen)).toBe(1);
        for (let i = 0; i < 12; i++) {
            karte.feuer("sourcedata", { sourceId: "flaechen", tile: {} });
            karte.feuer("move");
            bild();
        }
        // 12 Bilder zu 16 ms = 192 ms < 250 ms: noch kein zweites Lesen, dann genau eines.
        expect(lesezahl(karte.lesungen)).toBe(1);
        bild(NEULESEN_ABSTAND_MS);
        expect(lesezahl(karte.lesungen)).toBe(2);
        labels.remove();
    });

    it("🔴 ruht die Kamera nach neuen Kacheln, holt ein Zug das Lesen nach", () => {
        const karte = fakeMap();
        const labels = installAreaLabels(karte.map, SPEC, { insets: () => ({}) });
        bild();
        karte.feuer("sourcedata", { sourceId: "flaechen", tile: {} });
        bild();
        expect(lesezahl(karte.lesungen)).toBe(1);
        bild(NEULESEN_ABSTAND_MS);
        expect(lesezahl(karte.lesungen)).toBe(2);
        labels.remove();
    });

    it("eine reine Verschiebung liest nicht neu, ein Zoom schon", () => {
        const karte = fakeMap();
        const labels = installAreaLabels(karte.map, SPEC, { insets: () => ({}) });
        bild();
        karte.feuer("moveend");
        bild(NEULESEN_ABSTAND_MS + 16);
        expect(lesezahl(karte.lesungen)).toBe(1);
        karte.zoome(5);
        karte.feuer("moveend");
        bild(NEULESEN_ABSTAND_MS + 16);
        expect(lesezahl(karte.lesungen)).toBe(2);
        labels.remove();
    });

    it("ein neuer Stil liest sofort, auch kurz nach dem letzten Lesen", () => {
        const karte = fakeMap();
        const labels = installAreaLabels(karte.map, SPEC, { insets: () => ({}) });
        bild();
        karte.feuer("styledata");
        bild();
        expect(lesezahl(karte.lesungen)).toBe(2);
        labels.remove();
    });

    it("nach dem Abmelden wartet kein nachgeholter Zug mehr", () => {
        const karte = fakeMap();
        const labels = installAreaLabels(karte.map, SPEC, { insets: () => ({}) });
        bild();
        karte.feuer("sourcedata", { sourceId: "flaechen", tile: {} });
        bild();
        labels.remove();
        bild(NEULESEN_ABSTAND_MS * 2);
        expect(lesezahl(karte.lesungen)).toBe(1);
    });
});
