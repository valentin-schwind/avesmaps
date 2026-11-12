import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { AVENTURIA, canonColour, DESIGN_CANON, toRenderLngLat } from "@avesmaps3d/shared";
import {
    buildRouteBorderLayers,
    EMPTY_ROUTE_LAYER,
    ROUTE_BORDER_LAYER_IDS,
    ROUTE_BORDER_SOURCE_ID,
    ROUTE_CLICK_LAYERS,
    ROUTE_MARKER_LAYER_ID,
    routeBorderFeatures,
    updateRouteData,
    withRoute,
} from "../src/map/route-layers.ts";

/**
 * Die Marken der Grenzübertritte (WI-0065 Z3 C): dieselbe Sprache wie die Wegpunktmarke, nur kleiner, mit Farben und Maßen
 * aus dem Kanon. Hinweise gehen seit dem Betreiber-Nachtrag über den Interaktionskoordinator (M8).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const crossing = DESIGN_CANON.route.crossingMarker;

describe("Die Ebenen der Übertrittsmarken", () => {
    const layers = buildRouteBorderLayers();

    it("drei Kreisebenen auf einer eigenen Quelle: Rand, Körper mit goldenem Ring, dunkles Auge - von unten nach oben", () => {
        expect(layers.map((layer) => layer.id)).toEqual([...ROUTE_BORDER_LAYER_IDS]);
        for (const layer of layers) {
            expect(layer.type).toBe("circle");
            expect("source" in layer && layer.source).toBe(ROUTE_BORDER_SOURCE_ID);
        }
        const [rim, body, eye] = layers.map((layer) => layer.paint as Record<string, unknown>);
        expect(rim).toEqual({ "circle-radius": crossing.rim, "circle-color": canonColour("markerWaypointCore") });
        expect(body).toEqual({
            "circle-radius": crossing.body,
            "circle-color": canonColour("markerCrossing"),
            "circle-stroke-width": crossing.ring,
            "circle-stroke-color": canonColour("markerWaypointRing"),
        });
        expect(eye?.["circle-radius"]).toBe(crossing.eye);
        expect(eye?.["circle-color"]).toBe(canonColour("markerWaypointCore"));
    });

    it("das Bild folgt dem Wegpunkt: dunkler Rand und goldener Ring wie seine Scheibe, kleiner als sie", () => {
        expect(canonColour("markerWaypointCore")).toBe(DESIGN_CANON.colour["markerWaypointCore"]);
        expect(crossing.rim * 2).toBeLessThan(DESIGN_CANON.route.markerDisc);
        // Der Körper ist Pergament, nicht Rot (Rot heißt Wegpunkt) und nicht Gold (Gold heißt gewählt).
        expect(canonColour("markerCrossing")).not.toBe(canonColour("markerWaypoint"));
        expect(canonColour("markerCrossing")).not.toBe(canonColour("markerActive"));
    });

    it("🔴 die Karte bleibt hell: die Marke hat keinen Dunkelwert (Guide §23.1)", () => {
        expect(DESIGN_CANON.colourDark?.["markerCrossing"]).toBeUndefined();
    });

    it("in den Stil gehängt: die Quelle steht im Stil, die Ebenen über der Route und unter den Wegpunktmarken", () => {
        const base: StyleSpecification = {
            version: 8,
            sources: {},
            layers: [{ id: "grund", type: "background" }],
        };
        const style = withRoute(base, EMPTY_ROUTE_LAYER);
        expect(style.sources[ROUTE_BORDER_SOURCE_ID]).toMatchObject({ type: "geojson" });
        const ids = style.layers.map((layer) => layer.id);
        for (const id of ROUTE_BORDER_LAYER_IDS) expect(ids).toContain(id);
        expect(ids.indexOf(ROUTE_BORDER_LAYER_IDS[0])).toBeGreaterThan(ids.indexOf("route-line"));
        expect(ids.indexOf(ROUTE_BORDER_LAYER_IDS[2])).toBeLessThan(ids.indexOf(ROUTE_MARKER_LAYER_ID));
    });
});

describe("Was auf der Karte steht", () => {
    it("ein Punkt je Übertritt in Renderkoordinaten, in der Reihenfolge der Reise; ohne Angabe keiner", () => {
        expect(routeBorderFeatures(EMPTY_ROUTE_LAYER).features).toEqual([]);
        const data = {
            ...EMPTY_ROUTE_LAYER,
            borders: [
                { x: 100, y: 50 },
                { x: 320.5, y: 410.25 },
            ],
        };
        const features = routeBorderFeatures(data).features;
        expect(features.map((feature) => feature.properties.order)).toEqual([0, 1]);
        const expected = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 100, y: 50 });
        expect(features[0]?.geometry.coordinates).toEqual([expected.lng, expected.lat]);
    });

    it("die Daten wechseln, der Stil bleibt: updateRouteData setzt die Quelle neu", () => {
        const seen: unknown[] = [];
        const source = (name: string) => ({ setData: (data: unknown) => seen.push([name, data]) });
        const map = {
            getSource: (id: string) => source(id),
        } as unknown as Parameters<typeof updateRouteData>[0];
        updateRouteData(map, { ...EMPTY_ROUTE_LAYER, borders: [{ x: 1, y: 2 }] });
        const border = seen.find((entry) => (entry as [string, unknown])[0] === ROUTE_BORDER_SOURCE_ID) as
            [string, { features: unknown[] }] | undefined;
        expect(border?.[1].features).toHaveLength(1);
    });
});

describe("Die Übertrittsmarken verwenden den Koordinator", () => {
    it("sind keine Etappen-Klickebenen", () => {
        for (const id of ROUTE_BORDER_LAYER_IDS) expect(ROUTE_CLICK_LAYERS).not.toContain(id);
    });

    it("kein eigener Zuhörer an der Karte: die Datei der Ebenen hört nirgends auf `map.on(`", () => {
        const text = readFileSync(join(repositoryRoot, "apps/web/src/map/route-layers.ts"), "utf8");
        expect(text).not.toMatch(/\.on\(\s*["'](click|mousemove|mousedown|contextmenu)/);
    });
});
