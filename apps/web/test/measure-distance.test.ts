import { describe, expect, it } from "vitest";
import { AVENTURIA, canonColour, DESIGN_CANON } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import {
    isPending,
    measureMidpoint,
    measureMiles,
    measureText,
    withHandleAt,
    type Measurement,
} from "../src/measure/measure-state.ts";
import {
    buildMeasureHandleLayers,
    buildMeasureLineLayer,
    HANDLE_SIZE,
    measureHandleFeatures,
    measureLineFeatures,
    MEASURE_HANDLE_RING_LAYER_ID,
    withMeasure,
} from "../src/measure/measure-layers.ts";

/**
 * Das Messwerkzeug (WI-0095, Finding MCS-030): die benannten Fälle, die Legacy beschreibt.
 *
 * 🔴 **Die Zahlen sind Legacys eigene.** `js/routing/__tests__/air-distance.test.js` misst die Luftlinie
 * zwischen drei echten Orten (Koordinaten aus `GET /api/locations/` vom 2026-07-30) und erwartet 157,2 ·
 * 313,1 · 236,3 Meilen. Dieselbe Rechnung trägt dort den Drachenflug des Planers UND das Messwerkzeug
 * (`calculateScaledDistance`). Wenn unsere Messung dieselben Werte liefert, rechnet sie dasselbe.
 *
 * 🪤 Legacy schreibt seine Koordinaten als `[lat, lng]`, wir als `{ x, y }`. Für eine Luftlinie in der
 * Ebene ist das gleichgültig - `Math.hypot` ist in beiden Achsen symmetrisch -, also steht hier Legacys
 * erste Zahl als `y` und die zweite als `x`, und die Länge ist dieselbe.
 */

const point = (lat: number, lng: number) => ({ x: lng, y: lat });

const WEHRHEIM = point(572.74307, 558.5);
const LOWANGEN = point(663.625, 507.21875);
const GREIFENFURT = point(584.85355, 507.52209);

/** Dieselbe Toleranz wie Legacys Test. */
const near = (actual: number | undefined, expected: number): void => {
    expect(actual).toBeDefined();
    expect(Math.abs((actual ?? 0) - expected)).toBeLessThan(0.05);
};

describe("Die Zweipunktmessung rechnet Legacys Luftlinie", () => {
    it("Wehrheim → Greifenfurt sind 157,2 Meilen (Legacys eigener Erwartungswert)", () => {
        near(measureMiles({ start: WEHRHEIM, end: GREIFENFURT }), 157.2);
    });

    it("Wehrheim → Lowangen sind 313,1 Meilen, Lowangen → Greifenfurt 236,3", () => {
        near(measureMiles({ start: WEHRHEIM, end: LOWANGEN }), 313.1);
        near(measureMiles({ start: LOWANGEN, end: GREIFENFURT }), 236.3);
    });

    it("eine Karteneinheit sind drei Meilen - derselbe Faktor wie im Reisemodell", () => {
        expect(measureMiles({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBe(3);
        expect(AVENTURIA.coordinateSpace.distance.milesPerUnit).toBe(3);
    });

    it("die Richtung ist gleichgültig, und zwei gleiche Punkte messen null", () => {
        expect(measureMiles({ start: WEHRHEIM, end: GREIFENFURT })).toBe(
            measureMiles({ start: GREIFENFURT, end: WEHRHEIM }),
        );
        expect(measureMiles({ start: WEHRHEIM, end: WEHRHEIM })).toBe(0);
    });

    it("der Wert steht in der MITTE der Strecke (Legacys arithmetisches Mittel)", () => {
        expect(measureMidpoint({ start: { x: 10, y: 20 }, end: { x: 30, y: 60 } })).toEqual({ x: 20, y: 40 });
    });
});

describe("Die Kette gibt es nicht: genau zwei Punkte", () => {
    it("solange der zweite Punkt fehlt, wartet die Messung und hat weder Wert noch Linie", () => {
        const pending: Measurement = { start: WEHRHEIM };
        expect(isPending(pending)).toBe(true);
        expect(measureMiles(pending)).toBeUndefined();
        expect(measureText(pending)).toBeUndefined();
        expect(measureMidpoint(pending)).toBeUndefined();
        // Gezeichnet wird nur der erste Griff - keine Linie, wie bei Legacy vor dem zweiten Klick.
        expect(features(measureLineFeatures(pending))).toHaveLength(0);
        expect(features(measureHandleFeatures(pending))).toHaveLength(1);
    });

    it("mit beiden Punkten wartet sie nicht mehr - ein weiterer Klick verlängert nichts", () => {
        const done: Measurement = { start: WEHRHEIM, end: GREIFENFURT };
        expect(isPending(done)).toBe(false);
        // Es gibt keine Stütze dazwischen: zwei Griffe, eine Linie aus zwei Punkten.
        expect(features(measureHandleFeatures(done))).toHaveLength(2);
        const line = features(measureLineFeatures(done))[0];
        expect((line?.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
    });

    it("einen Griff verschieben ändert nur ihn, und der Wert rechnet mit", () => {
        const done: Measurement = { start: WEHRHEIM, end: GREIFENFURT };
        const moved = withHandleAt(done, "end", LOWANGEN);
        expect(moved.start).toEqual(WEHRHEIM);
        near(measureMiles(moved), 313.1);
        const movedStart = withHandleAt(done, "start", LOWANGEN);
        expect(movedStart.end).toEqual(GREIFENFURT);
        near(measureMiles(movedStart), 236.3);
    });
});

describe("Abbrechen", () => {
    it("ohne Messung gibt es weder Linie noch Griff noch Wartezustand", () => {
        expect(isPending(undefined)).toBe(false);
        expect(measureMiles(undefined)).toBeUndefined();
        expect(measureText(undefined)).toBeUndefined();
        expect(features(measureLineFeatures(undefined))).toHaveLength(0);
        expect(features(measureHandleFeatures(undefined))).toHaveLength(0);
    });
});

describe("Die Einheit: Meilen, eine Stelle, keine Grenze", () => {
    it("jede Entfernung steht in Meilen - es gibt keinen Wechsel auf Spann oder Schritt", () => {
        setLocale("de");
        // Ein Hundertstel einer Karteneinheit (0,03 Meilen) rundet auf 0,0 - und bleibt Meilen.
        expect(measureText({ start: { x: 0, y: 0 }, end: { x: 0.01, y: 0 } })).toBe("0,0 Meilen");
        expect(measureText({ start: { x: 0, y: 0 }, end: { x: 0.04, y: 0 } })).toBe("0,1 Meilen");
        expect(measureText({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBe("3,0 Meilen");
        // Die ganze Breite Aventuriens, immer noch in Meilen und mit Tausenderpunkt.
        expect(measureText({ start: { x: 0, y: 0 }, end: { x: 1024, y: 0 } })).toBe("3.072,0 Meilen");
    });

    it("die Sprache der Seite schreibt das Trennzeichen (Legacy `formatDecimalNumber`)", () => {
        setLocale("de");
        expect(measureText({ start: WEHRHEIM, end: GREIFENFURT })).toBe("157,2 Meilen");
        setLocale("en");
        expect(measureText({ start: WEHRHEIM, end: GREIFENFURT })).toBe("157.2 miles");
        setLocale("de");
    });
});

describe("Der Stil kommt aus dem Kanon", () => {
    it("die Linie ist weiß, vier Pixel breit und gestrichelt wie Legacy", () => {
        const layer = buildMeasureLineLayer();
        const paint = layer.type === "line" ? layer.paint : undefined;
        expect(paint?.["line-color"]).toBe(canonColour("routeHalo"));
        expect(paint?.["line-width"]).toBe(DESIGN_CANON.mapSelection.lineWidth);
        expect(DESIGN_CANON.mapSelection.lineWidth).toBe(4);
        // Legacys „10 8" px in Vielfachen der Breite: 10/4 und 8/4.
        expect(paint?.["line-dasharray"]).toEqual([2.5, 2]);
        expect(DESIGN_CANON.measure.lineDash[0] * DESIGN_CANON.mapSelection.lineWidth).toBe(10);
        expect(DESIGN_CANON.measure.lineDash[1] * DESIGN_CANON.mapSelection.lineWidth).toBe(8);
    });

    it("der Griff ist ein weißer Ring von 24 px mit braunem Saum und braunem Kern von 8 px", () => {
        expect(HANDLE_SIZE).toBe(24);
        const [ring, core] = buildMeasureHandleLayers();
        const ringPaint = ring?.type === "circle" ? ring.paint : undefined;
        const corePaint = core?.type === "circle" ? core.paint : undefined;
        // Außen 24 px insgesamt: MapLibre zeichnet den Saum außerhalb des Radius.
        expect(Number(ringPaint?.["circle-radius"]) * 2 + 2 * Number(ringPaint?.["circle-stroke-width"])).toBe(24);
        expect(ringPaint?.["circle-color"]).toBe(canonColour("routeHalo"));
        expect(ringPaint?.["circle-stroke-width"]).toBe(DESIGN_CANON.route.haloWidth);
        expect(ringPaint?.["circle-stroke-color"]).toBe(canonColour("accentBrown"));
        expect(Number(corePaint?.["circle-radius"]) * 2).toBe(8);
        expect(corePaint?.["circle-color"]).toBe(canonColour("accentBrown"));
    });

    it("die Linie liegt unter den Symbolen, die Griffe über allem (Legacys Panes 460 und 520)", () => {
        const style = withMeasure(
            {
                version: 8,
                sources: {},
                layers: [
                    { id: "route-line", type: "line", source: "route" },
                    { id: "place-circle", type: "circle", source: "places" },
                    { id: "place-label", type: "symbol", source: "places" },
                ],
            } as never,
            { start: WEHRHEIM, end: GREIFENFURT },
        );
        const ids = style.layers.map((layer) => layer.id);
        expect(ids).toEqual([
            "route-line",
            "measure-line",
            "place-circle",
            "place-label",
            MEASURE_HANDLE_RING_LAYER_ID,
            "measure-handle-core",
        ]);
    });
});

/** Die Features einer GeoJSON-Quelle, egal wie der MapLibre-Typ sie beschreibt. */
function features(data: unknown): { geometry: unknown; properties: Record<string, unknown> }[] {
    return (data as { features?: { geometry: unknown; properties: Record<string, unknown> }[] }).features ?? [];
}
