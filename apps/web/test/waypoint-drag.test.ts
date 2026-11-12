import { describe, expect, it } from "vitest";
import { AVENTURIA, DESIGN_CANON, toRenderLngLat } from "@avesmaps3d/shared";
import { markerLift, nearestSnapTarget, placeHitFromFeature } from "../src/map/waypoint-drag.ts";

/**
 * Eine Wegpunktmarke ziehen und auf einem Ort einrasten lassen (WI-0052): welcher Ort fängt die Marke,
 * was aus ihm als Wegpunkt wird und wo das Namensschild steht.
 */

describe("Einrasten beim Ziehen einer Wegpunktmarke (WI-0052)", () => {
    it("der nächste Ort gewinnt, gemessen an seinem Mittelpunkt im Bild", () => {
        const near = { id: "a", screen: { x: 106, y: 100 } };
        const nearer = { id: "b", screen: { x: 101, y: 103 } };
        expect(nearestSnapTarget({ x: 100, y: 100 }, [near, nearer])?.id).toBe("b");
        expect(nearestSnapTarget({ x: 100, y: 100 }, [nearer, near])?.id).toBe("b");
    });

    it("ohne Ort in Reichweite kein Ziel", () => {
        expect(nearestSnapTarget({ x: 0, y: 0 }, [])).toBeUndefined();
    });

    it("🔴 der gezeichnete Ort wird ein Wegpunkt: Kennung, Name, Art und Lage in Kartenkoordinaten", () => {
        const lngLat = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 551.625, y: 532.969 });
        const hit = placeHitFromFeature({ public_id: "7f3c", name: "Gareth", subtype: "metropole" }, [
            lngLat.lng,
            lngLat.lat,
        ]);
        expect(hit).toMatchObject({ id: "7f3c", name: "Gareth", subtype: "metropole", hidden: false });
        expect(hit?.x).toBeCloseTo(551.625, 6);
        expect(hit?.y).toBeCloseTo(532.969, 6);
    });

    it("ein Feature ohne Kennung oder Namen fängt nichts", () => {
        expect(placeHitFromFeature({ name: "Gareth" }, [0, 0])).toBeUndefined();
        expect(placeHitFromFeature({ public_id: "7f3c" }, [0, 0])).toBeUndefined();
    });

    it("das Schild steht über der Marke: über dem Tropfen seine Höhe, über der Scheibe ihr Halbmesser", () => {
        const route = DESIGN_CANON.route;
        expect(markerLift(2, 3), "das Ziel ist ein Tropfen").toBe(route.markerDropHeight);
        expect(markerLift(0, 1), "ein Wegpunkt allein auch").toBe(route.markerDropHeight);
        expect(markerLift(0, 3), "Start und Zwischenhalt sind Scheiben").toBe(route.markerDisc / 2);
    });
});
