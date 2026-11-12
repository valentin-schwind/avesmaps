import { describe, expect, it } from "vitest";
import { buildMapPinLayer, MAP_PIN_IMAGE_ID } from "../src/map/map-pin-layer";
import { ROUTE_DROP_IMAGE_ID } from "../src/map/route-layers";
import { RUNTIME_IMAGES } from "../src/map/runtime-images";

describe("der Tropfen von „Was ist hier?“", () => {
    it("🔴 trägt ein eigenes Bild, nicht den Zieltropfen der Route (Betreiber 2026-10-09: „die leute wünschen sich eine unterscheidung“)", () => {
        const layer = buildMapPinLayer() as { layout?: Record<string, unknown> };
        expect(layer.layout?.["icon-image"]).toBe(MAP_PIN_IMAGE_ID);
        expect(MAP_PIN_IMAGE_ID).not.toBe(ROUTE_DROP_IMAGE_ID);
        // Die Spitze steht weiter genau auf der Stelle.
        expect(layer.layout?.["icon-anchor"]).toBe("bottom");
    });

    it("wird mit den Laufzeitbildern angemeldet, sonst zeichnete die Ebene nichts", () => {
        expect(RUNTIME_IMAGES.map(([id]) => id)).toContain(MAP_PIN_IMAGE_ID);
    });
});
